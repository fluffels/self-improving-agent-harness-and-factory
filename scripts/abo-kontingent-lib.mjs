// Kein Shebang, kein Direktaufruf: Lib für `factory-kennzahlen.mjs` (factory#285, Konvention #1398: gemeinsamer Code steht in einer Lib).
/**
 * Abo-Kontingent je Ticket: Prozentpunkte (pp) des 7-Tage-Fensters zwischen Claim (assigned-Event) und Merge, aus dem Kontingent-Verlauf
 * (`budget-lib.mjs` › `haengeVerlaufAn`). Nicht zu verwechseln mit dem GitHub-API-Kontingent (`gh-kontingent.mjs`).
 * Pur, ohne I/O und ohne gh: `verlaufAus`, `gueltigeFolge`, `messfenster`, `zuwachsIm`, `teileZeitanteilig`, `kontrollzahl`, `claimAbfrage`, `claimsAusAntwort`,
 * `aboKontingent`, `aboKontingentAbschnitt`. Ein Ticket ohne Messfenster ist eine Lücke mit Grund, nie 0.
 * Grenzen: docs/model-routing.md (Fabrik) › „Nach einer Optimierung vergleichen“ und §6.
 */
import { median } from "./mess-lib.mjs";

/** Höchster Abstand eines Messpunkts zu Claim bzw. Merge. */
export const TOLERANZ_MS = 30 * 60_000;
const ASSIGNED_EVENT = "ASSIGNED_EVENT";
const CLAIMS_JE_TICKET = 20;

const zahl = (x) => typeof x === "number" && Number.isFinite(x);
const fensterOk = (w) => w && typeof w === "object" && zahl(w.pct) && w.pct >= 0 && w.pct <= 100 && zahl(w.resetsAt);
const runde = (x) => Math.round(x * 100) / 100;

/** Liest den Verlauf (JSON-Zeilen): `{ punkte, kaputt }`, sortiert nach `stand`; kaputte Zeilen werden übersprungen und gezählt. Pur. */
export function verlaufAus(text) {
  const punkte = [];
  let kaputt = 0;
  for (const zeile of String(text ?? "").split(/\r?\n/)) {
    if (!zeile.trim()) continue;
    try {
      const p = JSON.parse(zeile);
      const gueltig = p && typeof p === "object" && zahl(p.stand) && (fensterOk(p.sevenDay) || fensterOk(p.fiveHour));
      if (!gueltig) kaputt += 1;
      else punkte.push({ ...p, sevenDay: fensterOk(p.sevenDay) ? p.sevenDay : undefined, fiveHour: fensterOk(p.fiveHour) ? p.fiveHour : undefined });
    } catch {
      kaputt += 1;
    }
  }
  return { punkte: punkte.sort((a, b) => a.stand - b.stand), kaputt };
}

/**
 * Gültige Folge eines Limits (`sevenDay` oder `fiveHour`) aus den nach `stand` sortierten Punkten: `{ folge, veraltet }`. Der Vorpunkt ist der letzte
 * angenommene Punkt. Veraltet (übersprungen, der Zuwachs rechnet vom Vorpunkt; parallele Sessions schreiben nicht in Zeitfolge): ein Nachzügler aus einem
 * früheren Fenster (sein `resetsAt` liegt vor seinem Stand oder vor dem des Vorpunkts) und ein Rückgang ohne Reset (`pct` unter dem des Vorpunkts, solange
 * dessen `resetsAt` noch nicht erreicht ist). Die Regel gilt auch für den ersten Punkt (nur die Nachzügler-Bedingung). Punkte ohne das Limit werden übergangen. Pur.
 */
export function gueltigeFolge(punkte, limit) {
  const folge = [];
  const veraltet = [];
  let ref;
  for (const q of punkte) {
    const f = q[limit];
    if (!f) continue;
    const nachzuegler = f.resetsAt * 1000 <= q.stand || (ref && f.resetsAt < ref[limit].resetsAt);
    const rueckgang = ref && ref[limit].resetsAt * 1000 > q.stand && f.pct < ref[limit].pct;
    if (nachzuegler || rueckgang) veraltet.push(q);
    else {
      folge.push(q);
      ref = q;
    }
  }
  return { folge, veraltet };
}

/** Delta des 7-Tage-Fensters zwischen Claim und Merge (ms): `{ delta }` oder `{ luecke }` mit Grund. Pur. */
export function messfenster(punkte, { claim, merge }) {
  const sieben = gueltigeFolge(punkte, "sevenDay").folge;
  const start = sieben.filter((p) => p.stand <= claim).at(-1);
  if (!start || claim - start.stand > TOLERANZ_MS) return { luecke: "kein Punkt höchstens 30 min vor dem Claim" };
  const ende = sieben.find((p) => p.stand >= merge);
  if (!ende || ende.stand - merge > TOLERANZ_MS) return { luecke: "kein Punkt höchstens 30 min nach dem Merge" };
  if (start.sevenDay.resetsAt * 1000 <= ende.stand) return { luecke: "Fenster-Reset im Ticket-Fenster" };
  const delta = runde(ende.sevenDay.pct - start.sevenDay.pct);
  return delta < 0 ? { luecke: "negatives Delta im Verlauf" } : { delta };
}

/**
 * Teilt den Kontozuwachs auf gleichzeitig laufende Tickets: `fenster` = `[{ ticket, claim, merge, delta? }]` (ohne `delta` eine Lücke,
 * sie zählt trotzdem als gleichzeitig laufend), `zuwachs(a, b)` = Zuwachs in pp im Teilintervall. Der Zuwachs je Segment (zerschnitten an allen
 * Claim- und Merge-Zeiten) wird durch die Zahl der Tickets geteilt, die das Segment abdecken; die Summe der Anteile übersteigt so nie den
 * Zuwachs der Vereinigung der Fenster. Ein Fenster der Länge 0 behält sein `delta`. Ergebnis: Map Ticket → Anteil (nur Tickets mit Delta). Pur.
 */
export function teileZeitanteilig(fenster, zuwachs) {
  const grenzen = [...new Set(fenster.flatMap((f) => [f.claim, f.merge]))].sort((a, b) => a - b);
  const anteile = new Map();
  for (const f of fenster) {
    if (f.delta === undefined) continue;
    const laenge = f.merge - f.claim;
    if (laenge <= 0) {
      anteile.set(f.ticket, f.delta);
      continue;
    }
    let summe = 0;
    for (let i = 0; i + 1 < grenzen.length; i += 1) {
      const [a, b] = [grenzen[i], grenzen[i + 1]];
      if (a < f.claim || b > f.merge) continue;
      const k = fenster.filter((g) => g.claim <= a && g.merge >= b).length;
      summe += zuwachs(a, b) / k;
    }
    anteile.set(f.ticket, runde(summe));
  }
  return anteile;
}

/** Stand des 7-Tage-Fensters zur Zeit `t`, linear zwischen den Punkten davor und danach interpoliert; `null` ohne Punkt davor oder danach. Pur. */
function standBei(sieben, t) {
  const p = sieben.filter((x) => x.stand <= t).at(-1);
  const q = sieben.find((x) => x.stand >= t);
  if (!p || !q) return null;
  if (q.stand === p.stand) return p.sevenDay.pct;
  return p.sevenDay.pct + ((q.sevenDay.pct - p.sevenDay.pct) * (t - p.stand)) / (q.stand - p.stand);
}

/** Zuwachs in pp zwischen `a` und `b` (ms) aus den interpolierten Ständen, nie negativ; 0 ohne Stand. Pur. */
export function zuwachsIm(punkte, a, b) {
  const sieben = gueltigeFolge(punkte, "sevenDay").folge;
  const [x, y] = [standBei(sieben, a), standBei(sieben, b)];
  return x === null || y === null ? 0 : Math.max(0, y - x);
}

/**
 * Zeitraum-Quotient: Σ Zuwachs des 7-Tage-Fensters in [von, bis] geteilt durch die gemergten Tickets; `{ luecke }` bei < 2 Punkten oder 0 Tickets.
 * Rechnet über die gültige Folge (`gueltigeFolge`); `veraltet` zählt die veralteten Punkte in [von, bis]. Pur.
 */
export function kontrollzahl(punkte, { von, bis, anzahlTickets }) {
  if (anzahlTickets <= 0) return { luecke: "keine gemergten Tickets im Zeitraum" };
  const { folge: sieben, veraltet: alt } = gueltigeFolge(punkte, "sevenDay");
  const basis = sieben.filter((p) => p.stand < von).at(-1);
  const folge = [...(basis ? [basis] : []), ...sieben.filter((p) => p.stand >= von && p.stand <= bis)];
  if (folge.length < 2) return { luecke: "weniger als 2 Verlaufspunkte im Zeitraum" };
  let summe = 0;
  let resets = 0;
  for (let i = 1; i < folge.length; i += 1) {
    const [p, q] = [folge[i - 1], folge[i]];
    if (p.sevenDay.resetsAt * 1000 > q.stand) summe += q.sevenDay.pct - p.sevenDay.pct;
    else {
      summe += q.sevenDay.pct;
      resets += 1;
    }
  }
  const veraltet = alt.filter((p) => p.stand >= von && p.stand <= bis).length;
  return { summe: runde(summe), resets, veraltet, quotient: runde(summe / anzahlTickets), anzahlTickets, erster: folge[0].stand, letzter: folge.at(-1).stand };
}

/** GraphQL-Abfrage der letzten ASSIGNED_EVENTs für einen Block Ticket-Nummern (ein Alias `i<nr>` je Ticket). Pur. */
export function claimAbfrage(nummern) {
  const je = nummern
    .map((n) => `i${n}: issue(number: ${n}) { timelineItems(itemTypes: [${ASSIGNED_EVENT}], last: ${CLAIMS_JE_TICKET}) { nodes { ... on AssignedEvent { createdAt } } } }`)
    .join(" ");
  return `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${je} } }`;
}

/**
 * Claim je Ticket aus der GraphQL-Antwort: das letzte assigned-Event vor dem Merge. `mergeJeTicket` = Map Ticket → `mergedAt` (ISO).
 * Ergebnis: Map Ticket → `{ claim }` (ms) oder `{ luecke }`. Ein fehlender Alias wirft (der ganze Abschnitt wird zur Lücke). Pur.
 */
export function claimsAusAntwort(antwort, mergeJeTicket) {
  const repo = antwort?.data?.repository;
  if (!repo) throw new Error("GraphQL-Antwort ohne data.repository.");
  const aus = new Map();
  for (const [ticket, mergedAt] of mergeJeTicket) {
    const nodes = repo[`i${ticket}`]?.timelineItems?.nodes;
    if (!Array.isArray(nodes)) throw new Error(`GraphQL: Ticket #${ticket} ohne assigned-Events in der Antwort.`);
    const merge = Date.parse(mergedAt);
    const vorher = nodes.map((n) => Date.parse(n?.createdAt)).filter((t) => Number.isFinite(t) && t <= merge);
    aus.set(ticket, vorher.length ? { claim: Math.max(...vorher) } : { luecke: "kein assigned-Event vor dem Merge" });
  }
  return aus;
}

/**
 * Wertet den Zeitraum aus. `tickets` = Lauf-Zeilen `{ ticket, pr, gemergt, blocker, nacharbeit }`, `claims` = Map aus `claimsAusAntwort`,
 * `von`/`bis` in ms. Blocker-Quote über die gemessenen Tickets mit `blocker`-Feld, Folge-Quote über gemessene Tickets mit `fristAbgelaufen === true` (Feld aus `lauf-ergebnis.mjs`, dort die einzige Fristberechnung). Pur.
 */
export function aboKontingent({ tickets, punkte, kaputt, claims, von, bis }) {
  const rohe = tickets.map((t) => {
    const c = claims.get(t.ticket);
    const merge = Date.parse(t.gemergt);
    if (!c || c.luecke) return { t, luecke: c?.luecke ?? "kein Claim bekannt" };
    return { t, claim: c.claim, merge, ...messfenster(punkte, { claim: c.claim, merge }) };
  });
  const fenster = rohe.filter((r) => r.claim !== undefined).map((r) => ({ ticket: r.t.ticket, claim: r.claim, merge: r.merge, delta: r.delta }));
  const anteile = teileZeitanteilig(fenster, (a, b) => zuwachsIm(punkte, a, b));
  const zeilen = rohe.map((r) => ({ ticket: r.t.ticket, pr: r.t.pr, ...(anteile.has(r.t.ticket) ? { pp: anteile.get(r.t.ticket) } : { luecke: r.luecke }) }));
  const gemessen = rohe.filter((r) => anteile.has(r.t.ticket)).map((r) => r.t);
  const mitBlocker = gemessen.filter((t) => t.blocker !== null && t.blocker !== undefined);
  const mitFrist = gemessen.filter((t) => t.fristAbgelaufen === true);
  const istFolge = (t) => t.nacharbeit === "folge" || t.nacharbeit === "revert";
  return {
    zeilen,
    gemessen: gemessen.length,
    gesamt: tickets.length,
    median: median(zeilen.map((z) => z.pp).filter((x) => x !== undefined)),
    kontrolle: kontrollzahl(punkte, { von, bis, anzahlTickets: tickets.length }),
    blocker: { n: mitBlocker.filter((t) => t.blocker.some((b) => b.n > 0)).length, von: mitBlocker.length },
    folge: { n: mitFrist.filter(istFolge).length, von: mitFrist.length, offen: gemessen.length - mitFrist.length, offenMitFolge: gemessen.filter((t) => !mitFrist.includes(t) && istFolge(t)).length },
    kaputt,
  };
}

const pp = (x) => `${String(runde(x)).replace(".", ",")} pp`;
const quote = (a, b) => (b === 0 ? "–" : `${Math.round((a / b) * 100)} % (${a}/${b})`);
const datum = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/** Markdown-Zeilen des Abschnitts „Abo-Kontingent je Ticket“; `{ luecke }` ergibt eine Lückenzeile. Pur. */
export function aboKontingentAbschnitt(a) {
  if (a.luecke) return [`- Lücke: ${a.luecke}`];
  const k = a.kontrolle;
  const kontrolle = k.luecke
    ? `- Kontrollzahl: Lücke: ${k.luecke}`
    : `- Kontrollzahl: ${pp(k.quotient)} je Ticket (Σ Zuwachs ${pp(k.summe)}, ${k.anzahlTickets} Tickets, Resets ${k.resets}${k.veraltet > 0 ? `, veraltete Punkte ${k.veraltet}` : ""}, Verlauf ${datum(k.erster)} bis ${datum(k.letzter)})`;
  return [
    "| Ticket | PR | Abo-Kontingent |",
    "|---|---|---|",
    ...a.zeilen.map((z) => `| #${z.ticket} | #${z.pr} | ${z.pp !== undefined ? pp(z.pp) : `Lücke: ${z.luecke}`} |`),
    "",
    `- Gemessen: ${a.gemessen} von ${a.gesamt}; Median: ${a.median === null ? "–" : pp(a.median)} (obere Grenze: kontoweit gemessen)`,
    kontrolle,
    `- Blocker-Quote (Runde 1 mit Blocker): ${quote(a.blocker.n, a.blocker.von)}`,
    `- Folge-Quote (Nacharbeit, Frist abgelaufen): ${quote(a.folge.n, a.folge.von)}, offen: ${a.folge.offen}${a.folge.offenMitFolge > 0 ? `, davon schon mit Folge: ${a.folge.offenMitFolge}` : ""}`,
    ...(a.kaputt > 0 ? [`- Datenlücken im Verlauf: ${a.kaputt} kaputte Zeilen übersprungen`] : []),
  ];
}
