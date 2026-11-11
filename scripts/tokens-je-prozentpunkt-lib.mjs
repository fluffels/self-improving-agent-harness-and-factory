// Kein Shebang, kein Direktaufruf: Lib für `factory-kennzahlen.mjs` (factory#290, Konvention #1398: gemeinsamer Code steht in einer Lib).
/**
 * Tokens je Abo-Prozentpunkt (pp): die Tokens der lokalen Transkripte (`transkript-calls.mjs`, keine zweite Zählung) zwischen zwei Punkten des
 * Kontingent-Verlaufs (`abo-kontingent-lib.mjs` › `verlaufAus`, `gueltigeFolge`) geteilt durch den Zuwachs des Limits (7-Tage und 5-Stunden getrennt).
 * Pur (der Lader reicht die Sitzungen herein): `callsAus`, `strecken`, `isoWoche`, `tokensJeProzentpunkt`, `tokensJeProzentpunktAbschnitt`.
 * Ein Zeitraum ohne Verlauf, ohne Calls oder mit zu wenig Zuwachs ist eine Lücke bzw. „nicht aussagekräftig“ mit Grund, nie 0 und nie ∞.
 * Die gewichtete Variante rechnet mit Listenpreisen (`preise.mjs`) und ist eine Schätzung. Grenzen: docs/model-routing.md (Fabrik) › „Tokens je Abo-Prozentpunkt“.
 */
import { gueltigeFolge, verlaufAus } from "./abo-kontingent-lib.mjs";
import { median, quartil } from "./mess-lib.mjs";
import { callsDerSitzung } from "./transkript-calls.mjs";

/** Mindest-Zuwachs je Kette: bei ganzzahligen Prozenten (Rundung ±1 pp je Kette) bleibt der Rundungsfehler höchstens 20 %. */
export const SCHWELLE_PP = 5;
export const LIMITS = [
  ["sevenDay", "7-Tage-Limit"],
  ["fiveHour", "5-Stunden-Limit"],
];
const ARTEN = ["input", "output", "cacheRead", "cacheWrite5m", "cacheWrite1h"];

const runde = (x) => Math.round(x * 100) / 100;
const summe = (liste, f) => liste.reduce((s, x) => s + f(x), 0);
const tagVon = (ms) => new Date(ms).toISOString().slice(0, 10);

/** ISO-Woche (UTC) als `JJJJ-Www`. */
export function isoWoche(ms) {
  const d = new Date(ms);
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7) + 3);
  const erster = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const woche = 1 + Math.round(((t - erster) / 864e5 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(woche).padStart(2, "0")}`;
}

/** Schlanke, nach Zeit sortierte Calls aller Sitzungen (je Sitzung `callsDerSitzung`); Calls ohne lesbaren Zeitstempel zählen in `ohneZeit`. */
export function callsAus(sitzungen) {
  const calls = [];
  let ohneZeit = 0;
  let anzahl = 0;
  for (const s of sitzungen) {
    anzahl += 1;
    for (const c of callsDerSitzung(s).calls) {
      const t = Date.parse(c.ts);
      if (!Number.isFinite(t)) {
        ohneZeit += 1;
        continue;
      }
      const cw1 = Math.min(c.cacheWrite1h || 0, c.cacheWrite || 0);
      calls.push({ t, model: c.model, input: c.input, output: c.output, cacheRead: c.cacheRead, cacheWrite5m: (c.cacheWrite || 0) - cw1, cacheWrite1h: cw1, cost: c.costGeschaetzt ?? null });
    }
  }
  return { calls: calls.sort((a, b) => a.t - b.t), sitzungen: anzahl, ohneZeit };
}

/**
 * Abschnitte zwischen aufeinanderfolgenden Verlaufspunkten eines Limits, nur ganz in `[von, bis]`. Reset (`resetsAt` des Vorpunkts <= Stand): Abschnitt
 * ausgelassen, neue Kette. Veraltete Punkte (`gueltigeFolge` aus `abo-kontingent-lib.mjs`: Rückgang ohne Reset, Nachzügler aus einem früheren Fenster) werden
 * übersprungen und gezählt (nur die in `[von, bis]`), der Zuwachs rechnet vom Vorpunkt.
 * Ergebnis `{ punkte, liste: [{ von, bis, delta, kette, pos }], reset, veraltet }` (`punkte` = alle Punkte des Limits im Bereich). Pur.
 */
export function strecken(punkte, limit, { von, bis }) {
  const { folge, veraltet: alt } = gueltigeFolge(punkte, limit);
  const imBereich = (p) => p.stand >= von && p.stand <= bis;
  const ps = folge.filter(imBereich);
  const liste = [];
  let [reset, kette, ref] = [0, 0, ps[0]];
  for (const q of ps.slice(1)) {
    if (ref[limit].resetsAt * 1000 <= q.stand) {
      reset += 1;
      kette += 1;
    } else liste.push({ von: ref.stand, bis: q.stand, delta: runde(q[limit].pct - ref[limit].pct), kette, pos: liste.length });
    ref = q;
  }
  const veraltet = alt.filter(imBereich).length;
  return { punkte: punkte.filter((p) => p[limit] && imBereich(p)).length, liste, reset, veraltet };
}

/** Index des ersten Calls mit `t > grenze` (Calls sortiert). */
function ersterNach(calls, grenze) {
  let [a, b] = [0, calls.length];
  while (a < b) {
    const m = (a + b) >> 1;
    if (calls[m].t > grenze) b = m;
    else a = m + 1;
  }
  return a;
}

/** Summen eines Abschnitts: Tokens je Modell und Art, roh (Summe aller Arten), Listenpreis-Wert in $ und Modelle ohne Preis. */
function summiere(cs) {
  const modelle = new Map();
  const ohnePreis = new Set();
  let wert = 0;
  for (const c of cs) {
    const e = modelle.get(c.model) ?? Object.fromEntries(ARTEN.map((a) => [a, 0]));
    for (const a of ARTEN) e[a] += c[a] || 0;
    modelle.set(c.model, e);
    if (c.cost === null) ohnePreis.add(String(c.model));
    else wert += c.cost;
  }
  return { modelle, ohnePreis, wert, roh: summe([...modelle.values()], (e) => summe(ARTEN, (a) => e[a])) };
}

/** Hängt jedem Abschnitt Calls, Summen und Zeiträume an; Zuwachs ohne Calls wird `ohneCalls` (nie gezählt). Gibt auch die Calls außerhalb aller gezählten Abschnitte zurück. */
function belege(liste, calls) {
  const belegt = new Set();
  const mit = liste.map((s) => {
    const [a, b] = [ersterNach(calls, s.von), ersterNach(calls, s.bis)];
    for (let i = a; i < b; i += 1) belegt.add(i);
    const n = b - a;
    return { ...s, n, ...summiere(calls.slice(a, b)), ohneCalls: s.delta > 0 && n === 0, tag: tagVon(s.bis), woche: isoWoche(s.bis) };
  });
  return { mit, ohneVerlauf: calls.filter((_, i) => !belegt.has(i)) };
}

/** Zahl der lückenlosen Läufe (gleiche Kette, aufeinanderfolgende Positionen): je Lauf ±1 pp Rundung. */
const laeufe = (gruppe) => gruppe.filter((s, i) => i === 0 || s.kette !== gruppe[i - 1].kette || s.pos !== gruppe[i - 1].pos + 1).length;

const nachSchluessel = (liste, f) => {
  const m = new Map();
  for (const x of liste) (m.get(f(x)) ?? m.set(f(x), []).get(f(x))).push(x);
  return m;
};

/** Bewertung eines Zeitraums (Abschnitte `gruppe`, `callsOhne` = Calls ohne Verlauf): `{ luecke }`, `{ …, unklar }` oder Kennzahl mit Spanne. */
function bewerte(gruppe, callsOhne) {
  const hinweis = callsOhne > 0 ? ` (${callsOhne} Calls ohne Verlauf)` : "";
  if (!gruppe.length) return { luecke: `keine Kontingent-Punkte${hinweis}` };
  const gueltig = gruppe.filter((s) => !s.ohneCalls);
  const ohneCallsPp = runde(summe(gruppe.filter((s) => s.ohneCalls), (s) => s.delta));
  if (!gueltig.length) return { luecke: `Zuwachs ohne Calls (${ohneCallsPp} pp): Transkripte fehlen oder der Verbrauch lag außerhalb dieser Maschine` };
  const tokens = summe(gueltig, (s) => s.roh);
  if (tokens === 0) return { luecke: `keine Calls im Zeitraum (Transkripte fehlen oder Verbrauch nur außerhalb dieser Maschine)${hinweis}` };
  const [zuwachs, k] = [runde(summe(gueltig, (s) => s.delta)), laeufe(gueltig)];
  const basis = { tokens, zuwachs, k, ohneCallsPp, abschnitte: gueltig.length };
  if (zuwachs < SCHWELLE_PP * k) return { ...basis, unklar: true };
  const ohnePreis = [...new Set(gueltig.flatMap((s) => [...s.ohnePreis]))];
  const wert = summe(gueltig, (s) => s.wert);
  return {
    ...basis,
    jePp: tokens / zuwachs,
    hundert: (100 * tokens) / zuwachs,
    spanne: [(100 * tokens) / (zuwachs + k), (100 * tokens) / (zuwachs - k)],
    gewichtet: ohnePreis.length ? { luecke: `kein Preis für ${ohnePreis.join(", ")}` } : { jePp: wert / zuwachs, hundert: (100 * wert) / zuwachs },
  };
}

const verteilung = (w) => ({ n: w.length, median: median(w), q1: quartil(w, 0.25), q3: quartil(w, 0.75) });
const streuung = (tage) => {
  const ok = tage.filter((t) => t.jePp !== undefined);
  const [roh, gew] = [verteilung(ok.map((t) => t.jePp)), verteilung(ok.filter((t) => t.gewichtet.jePp !== undefined).map((t) => t.gewichtet.jePp))];
  const iqr = (v) => (v.median ? (v.q3 - v.q1) / v.median : null);
  return { roh, gewichtet: gew, iqrRoh: iqr(roh), iqrGewichtet: iqr(gew) };
};

/** Zeilen je Zeitraum-Schlüssel (Tag oder Woche) samt Calls ohne Verlauf; Wochenzeilen tragen die Verteilung ihrer aussagekräftigen Tage. */
function zeilenJe(gueltig, ohneVerlauf, schluessel) {
  const sg = nachSchluessel(gueltig, (s) => s[schluessel === "tag" ? "tag" : "woche"]);
  const cg = nachSchluessel(ohneVerlauf, (c) => (schluessel === "tag" ? tagVon(c.t) : isoWoche(c.t)));
  return [...new Set([...sg.keys(), ...cg.keys()])].sort().map((k) => ({ schluessel: k, ...bewerte(sg.get(k) ?? [], cg.get(k)?.length ?? 0) }));
}

function limitErgebnis(punkte, calls, limit, fenster) {
  const st = strecken(punkte, limit, fenster);
  const imFenster = calls.slice(ersterNach(calls, fenster.von - 1), ersterNach(calls, fenster.bis));
  if (st.punkte < 2) return { luecke: `weniger als 2 Verlaufspunkte für dieses Limit im Zeitraum (${st.punkte}; ${imFenster.length} Calls ohne Verlauf)` };
  const { mit, ohneVerlauf } = belege(st.liste, imFenster);
  const gueltig = mit.filter((s) => !s.ohneCalls);
  const tage = zeilenJe(mit, ohneVerlauf, "tag");
  const wochen = zeilenJe(mit, ohneVerlauf, "woche").map((w) => ({ ...w, tage: streuung(tage.filter((x) => isoWoche(Date.parse(x.schluessel)) === w.schluessel)) }));
  const tabelle = new Map();
  for (const s of gueltig) for (const [m, e] of s.modelle) for (const a of ARTEN) (tabelle.get(m) ?? tabelle.set(m, Object.fromEntries(ARTEN.map((x) => [x, 0]))).get(m))[a] += e[a];
  return {
    tage,
    wochen,
    gesamt: bewerte(mit, ohneVerlauf.length),
    streuung: streuung(tage),
    tabelle: [...tabelle].map(([modell, e]) => ({ modell, ...e })),
    ausgelassen: { reset: st.reset, veraltet: st.veraltet, ohneCallsN: mit.filter((s) => s.ohneCalls).length, ohneCallsPp: runde(summe(mit.filter((s) => s.ohneCalls), (s) => s.delta)), callsOhneVerlauf: ohneVerlauf.length },
  };
}

/**
 * Wertet `[von, bis]` (ms) aus. `verlaufText` = Kontingent-Verlauf (JSON-Zeilen), `calls` = Ergebnis von `callsAus` (`.calls`). Je Limit ein Ergebnis
 * oder `{ luecke }`. Pur.
 */
export function tokensJeProzentpunkt({ verlaufText, calls, von, bis }) {
  const { punkte, kaputt } = verlaufAus(verlaufText);
  return { kaputt, limits: Object.fromEntries(LIMITS.map(([l]) => [l, limitErgebnis(punkte, calls, l, { von, bis })])) };
}

const tok = (x) => (x >= 1e6 ? `${(x / 1e6).toFixed(2)} Mio` : x >= 1e3 ? `${Math.round(x / 1e3)} Tsd` : String(Math.round(x))).replace(".", ",");
/** Dollar-Text: ab 0,01 zwei Nachkommastellen, darunter zwei geltende Ziffern (höchstens 6 Stellen), 0 bleibt $0,00, darunter „< $0,000001“. */
export const usd = (x) => {
  if (x === 0 || x >= 0.01) return `$${x.toFixed(2)}`.replace(".", ",");
  if (x < 0.000001) return "< $0,000001";
  return `$${x.toFixed(Math.min(6, 1 - Math.floor(Math.log10(x))))}`.replace(".", ",");
};
const verhaeltnis = (x) => (x === null ? "–" : String(runde(x)).replace(".", ","));
const GEW = "(Schätzung, Listenpreis-Gewichte, ungesichert)";

/** Zellen einer Kennzahl: Tokens, Zuwachs, je pp, 100 %, gewichtet; eine Lücke ist eine einzige Zelle. */
function kennzahlZellen(z) {
  if (z.luecke) return [`Lücke: ${z.luecke}`];
  const kopf = [tok(z.tokens), `${z.zuwachs} pp (±${z.k})`];
  if (z.unklar) return [...kopf, `nicht aussagekräftig (unter ${SCHWELLE_PP * z.k} pp)`];
  const g = z.gewichtet.luecke ? `Lücke: ${z.gewichtet.luecke}` : `${usd(z.gewichtet.jePp)} je pp, 100 % ≈ ${usd(z.gewichtet.hundert)}`;
  return [...kopf, `${tok(z.jePp)} je pp`, `${tok(z.hundert)} (${tok(z.spanne[0])} bis ${tok(z.spanne[1])})`, g];
}
const zeile = (z) => `| ${z.schluessel} | ${Object.assign(Array(5).fill(""), kennzahlZellen(z)).join(" | ")} |`;

const verteilungText = (v, einheit) => (v.n ? `Median ${einheit(v.median)}, Q1 bis Q3 ${einheit(v.q1)} bis ${einheit(v.q3)} (n=${v.n})` : "keine aussagekräftigen Tage");

function limitAbschnitt(name, r) {
  if (r.luecke) return [`**${name}:** Lücke: ${r.luecke}`, ""];
  const kopf = (erste) => [`| ${erste} | Tokens roh | Zuwachs | Tokens je pp | 100 % ≈ (Spanne) | Listenpreis-Wert ${GEW} |`, "|---|---|---|---|---|---|"];
  const a = r.ausgelassen;
  const s = r.streuung;
  return [
    `**${name}:**`,
    "",
    ...kopf("Tag"),
    ...r.tage.map(zeile),
    "",
    ...kopf("Woche"),
    ...r.wochen.flatMap((w) => [zeile(w), ...(w.tage.roh.n ? [`| ↳ Tageswerte | ${verteilungText(w.tage.roh, tok)} | | | | |`] : [])]),
    "",
    `- Streuung der Tageswerte roh: ${verteilungText(s.roh, tok)}, IQR/Median ${verhaeltnis(s.iqrRoh)}; gewichtet ${GEW}: ${verteilungText(s.gewichtet, usd)}, IQR/Median ${verhaeltnis(s.iqrGewichtet)}`,
    `- Gesamt: ${kennzahlZellen(r.gesamt).join("; ")}`,
    `- Ausgelassen: Reset ${a.reset}, Zuwachs ohne Calls ${a.ohneCallsPp} pp (${a.ohneCallsN}), veraltete Punkte ${a.veraltet}, Calls ohne Verlauf ${a.callsOhneVerlauf}`,
    ...(r.tabelle.length ? ["", "| Modell | input | output | cache_read | cache_creation 5m | cache_creation 1h |", "|---|---|---|---|---|---|", ...r.tabelle.map((t) => `| ${t.modell} | ${ARTEN.map((x) => tok(t[x])).join(" | ")} |`)] : []),
    "",
  ];
}

/** Markdown-Zeilen des Abschnitts „Tokens je Abo-Prozentpunkt“; `{ luecke }` ergibt eine Lückenzeile. Pur. */
export function tokensJeProzentpunktAbschnitt(t) {
  if (t.luecke) return [`- Lücke: ${t.luecke}`];
  return [
    ...LIMITS.flatMap(([l, name]) => limitAbschnitt(name, t.limits[l])),
    ...(t.kaputt > 0 ? [`- Datenlücken im Verlauf: ${t.kaputt} kaputte Zeilen übersprungen`] : []),
    ...(t.aufbau ? [`- Quelle: ${t.aufbau.sitzungen} Sitzungen, ${t.aufbau.calls} Calls${t.aufbau.ohneZeit ? `, ${t.aufbau.ohneZeit} ohne Zeitstempel` : ""}`] : []),
  ];
}
