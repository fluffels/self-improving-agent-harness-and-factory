// Kein Shebang: Lib ohne Einstieg, pur (kein I/O). Gegenstück zum Einstieg `token-analyse-tickets.mjs`.
/**
 * Plan-Review, Ticket-Anlage und Folge-Ticket der Token-Analyse (factory#518, Teil 7/9). Fabrik-eigen, nicht im Besitz, nie in einem Bezieher.
 *
 * Eingabeformat (zwei JSON-Dateien, Autorenschaft getrennt):
 *  - Plan (Hauptchat): `{ version:1, lauf, datum, autoren:[<Session-Kennung>], teilberichtAutoren:[<agentId>], folge:{ nach, weil, label, unsicherheiten:[…], recherche:[…] },
 *    teile:[{ id, art:"zeile"|"ticket"|"probe-ticket", tragweite, zeile?, ticket?:{ titel, body, label, nach, weil, blocker?, ausnahme? }, vorabBewertung? }] }`.
 *  - Review (frischer Reviewer): `{ version:1, lauf, plan:"<Pfad>", status:"abgeschlossen"|"abgebrochen", urteile:[{ teil, durchgang:1|2, reviewer:{ kennung, modell, effort }, urteil, grund }] }`.
 * Ein Teil wird nur `anlegen`, wenn sein letztes Urteil `bestätigt` ist, die Kennung des Reviewers keine des Plans oder eines Teilberichts ist, Modell und Effort zur Tragweite
 * passen (`REVIEW_ROUTING`), ein Ticket eine erlaubte Ausnahme trägt und ein Probe-Ticket eine Vorab-Bewertung hat.
 * Grenze: die Kennungen sind selbst gemeldet; der Gleichheitstest fängt den typischen Fehler (der Hauptchat reviewt selbst), keinen Betrug.
 */
import { enthaeltNamen } from "./token-analyse-freigabe-lib.mjs";

/** Modell und Effort des Reviewers je Tragweite; die Tabelle in `docs/model-routing.md` ist gleich (Wächter `token-analyse-skill.test.ts`). */
export const REVIEW_ROUTING = {
  standard: { alias: "opus", effort: "high" },
  "rueckbau-lockerung": { alias: "fable", effort: "high" },
  abschaffung: { alias: "fable", effort: "high" },
  rollenwechsel: { alias: "fable", effort: "high" },
  leitplanke: { alias: "fable", effort: "high" },
  "sicherheit-gate": { alias: "fable", effort: "high" },
  "opus-blocker": { alias: "fable", effort: "high" },
};

export const URTEILE = ["bestätigt", "bedingt", "abgelehnt"];
export const ARTEN = ["zeile", "ticket", "probe-ticket"];
/** Erlaubte Ausnahmen vom Grundsatz „Harness-Befunde sind Zeilen“ (AGENTS.md): sonst wird aus einem Ticket-Entwurf eine Zeile. */
export const AUSNAHMEN = ["session-groesse", "notfall", "ausserhalb-harness"];
export const FOLGE_FRAGE = "was haben wir vergessen?";
export const FOLGE_PRUEFPUNKTE = [
  "Messgrößen-Liste des Änderungsregisters zeitgemäß (neue Modelle, Preise, Claude-Code-Funktionen, Empfehlungen)",
  "Toleranzen und Prüffristen sinnvoll",
  "Umstellungen ohne Registerzeile",
  "Messgrößen ohne Auswertbarkeit (Dauer-Lücke)",
  "fehlender Analysebereich",
  "eingebaute Claude-Code-Befehle",
];

const text = (v) => typeof v === "string" && v.trim() !== "";
const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const nummer = (v) => /^#?[1-9]\d*$/.test(String(v ?? ""));
const textListe = (v) => Array.isArray(v) && v.every(text);

function kopfFehler(plan) {
  const f = [];
  if (!text(plan.lauf)) f.push("Plan: lauf fehlt");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.datum ?? "")) f.push("Plan: datum JJJJ-MM-TT erwartet");
  if (!textListe(plan.autoren) || plan.autoren.length === 0) f.push("Plan: autoren fehlt");
  if (!textListe(plan.teilberichtAutoren)) f.push("Plan: teilberichtAutoren fehlt");
  const fo = plan.folge;
  if (!istObjekt(fo) || !nummer(fo.nach) || !["weil", "label"].every((x) => text(fo[x])) || !textListe(fo.unsicherheiten) || !textListe(fo.recherche)) f.push("Plan: folge braucht nach, weil, label, unsicherheiten[], recherche[]");
  return f;
}

function teilFehler(t, ids) {
  const id = istObjekt(t) && text(t.id) ? t.id : null;
  if (id === null || ids.includes(id)) return [`Plan: Teil ohne eindeutige id (${id ?? "?"})`];
  if (!ARTEN.includes(t.art)) return [`Plan: ${id}: art ${t.art} unbekannt`];
  if (!Object.hasOwn(REVIEW_ROUTING, t.tragweite)) return [`Plan: ${id}: tragweite ${t.tragweite} unbekannt`];
  if (t.art === "zeile") return text(t.zeile) ? [] : [`Plan: ${id}: zeile fehlt`];
  return ticketFehler(id, t.ticket, ids);
}

function planFehler(plan) {
  if (!istObjekt(plan) || plan.version !== 1) return ["Plan: version 1 erwartet"];
  const f = kopfFehler(plan);
  if (!Array.isArray(plan.teile) || plan.teile.length === 0) return [...f, "Plan: teile fehlt"];
  const ids = [];
  for (const t of plan.teile) {
    f.push(...teilFehler(t, ids));
    if (istObjekt(t) && text(t.id)) ids.push(t.id);
  }
  return f;
}

function ticketFehler(id, k, vorher) {
  if (!istObjekt(k) || !["titel", "body", "label", "weil"].every((s) => text(k[s])) || !(nummer(k.nach) || /^teil:/.test(String(k.nach)))) return [`Plan: ${id}: ticket braucht titel, body, label, nach, weil`];
  const verweise = [k.nach, ...(Array.isArray(k.blocker) ? k.blocker : [])].filter((v) => /^teil:/.test(String(v)));
  const unbekannt = verweise.filter((v) => !vorher.includes(String(v).slice(5)));
  return unbekannt.map((v) => `Plan: ${id}: Verweis ${v} nur auf frühere Teile`);
}

function urteilFehler(u, ids, gesehen) {
  const r = istObjekt(u) && istObjekt(u.reviewer) ? u.reviewer : {};
  if (!istObjekt(u) || !ids.includes(u.teil) || ![1, 2].includes(u.durchgang) || !URTEILE.includes(u.urteil) || !text(u.grund) || !["kennung", "modell", "effort"].every((x) => text(r[x]))) {
    return [`Review: ungültiges Urteil (${istObjekt(u) ? `${u.teil}/${u.durchgang}` : "?"})`];
  }
  const f = [];
  if (gesehen.has(`${u.teil}/${u.durchgang}`)) f.push(`Review: doppeltes Urteil ${u.teil}/${u.durchgang}`);
  if (u.durchgang === 2 && gesehen.get(`${u.teil}/1`) !== "bedingt") f.push(`Review: ${u.teil}: Durchgang 2 nur nach „bedingt“`);
  gesehen.set(`${u.teil}/${u.durchgang}`, u.urteil);
  return f;
}

function reviewFehler(plan, review) {
  if (!istObjekt(review) || review.version !== 1) return ["Review: version 1 erwartet"];
  const f = review.lauf === plan.lauf ? [] : ["Review: lauf weicht vom Plan ab"];
  if (!Array.isArray(review.urteile)) return [...f, "Review: urteile fehlt"];
  const ids = plan.teile.map((t) => t.id);
  const gesehen = new Map();
  for (const u of review.urteile) f.push(...urteilFehler(u, ids, gesehen));
  return f;
}

/** Formfehler von Plan und Review (leer = gut); ein Formfehler bricht den ganzen Lauf ab. Pur. */
export function pruefeEingabe(plan, review) {
  const f = planFehler(plan);
  return f.length > 0 ? f : reviewFehler(plan, review);
}

/** Ist die Ausnahme eines Ticket-Entwurfs eine der geschlossenen Liste? Pur. */
export const ausnahmeErlaubt = (teil) => AUSNAHMEN.includes(teil?.ticket?.ausnahme);

function einzelUrteil(teil, plan, urteile) {
  const sperre = new Set([...plan.autoren, ...plan.teilberichtAutoren]);
  const soll = REVIEW_ROUTING[teil.tragweite];
  const meine = urteile.filter((u) => u.teil === teil.id).sort((a, b) => a.durchgang - b.durchgang);
  if (meine.length === 0) return { ergebnis: "ungeprüft", grund: "kein Urteil" };
  if (meine.some((u) => sperre.has(u.reviewer.kennung))) return { ergebnis: "ungeprüft", grund: "Reviewer ist Autor von Plan oder Teilbericht" };
  if (meine.some((u) => u.reviewer.modell !== soll.alias || u.reviewer.effort !== soll.effort)) return { ergebnis: "ungeprüft", grund: `Modell oder Effort passt nicht zur Tragweite (${soll.alias}/${soll.effort})` };
  const letztes = meine[meine.length - 1];
  if (letztes.urteil === "abgelehnt") return { ergebnis: "abgelehnt", grund: letztes.grund };
  if (letztes.urteil === "bedingt") return { ergebnis: "bedingt", grund: letztes.grund };
  if (teil.art !== "zeile" && !ausnahmeErlaubt(teil)) return { ergebnis: "abgewiesen", grund: "kein Ticket ohne erlaubte Ausnahme (Befunde sind Zeilen)" };
  if (teil.art === "probe-ticket" && !text(teil.vorabBewertung)) return { ergebnis: "abgewiesen", grund: "Probe-Ticket ohne Vorab-Bewertung" };
  return { ergebnis: "anlegen", grund: letztes.grund };
}

/** Ergebnis je Planteil in Plan-Reihenfolge: `{ id, art, ergebnis: anlegen|abgelehnt|bedingt|ungeprüft|abgewiesen|zurückgestellt, grund }`. Setzt gültige Eingabe voraus. Pur. */
export function urteileJeTeil(plan, review) {
  const aus = [];
  for (const teil of plan.teile) {
    const e = einzelUrteil(teil, plan, review.urteile);
    const verweise = teil.art === "zeile" ? [] : [teil.ticket.nach, ...(teil.ticket.blocker ?? [])].filter((v) => /^teil:/.test(String(v)));
    const offen = verweise.find((v) => aus.find((a) => a.id === String(v).slice(5))?.ergebnis !== "anlegen");
    aus.push({ id: teil.id, art: teil.art, ...(e.ergebnis === "anlegen" && offen ? { ergebnis: "zurückgestellt", grund: `${offen} wird nicht angelegt` } : e) });
  }
  return aus;
}

/** Titel und Body des Folge-Tickets „Analyse-Optimierung <Datum>“ (besteht `pruefeEingang`). Pur. */
export function folgeTicketBody({ datum, unsicherheiten = [], recherche = [] }) {
  const liste = (l) => (l.length > 0 ? l.map((z) => `- ${z}`).join("\n") : "- keine Einträge");
  const body = [
    "## Ziel",
    `Die feste Frage dieser Analyse vom ${datum} beantworten: ${FOLGE_FRAGE} Fachlich geprüft wird das Änderungsregister samt Messgrößen, Toleranzen und Analysebereichen.`,
    "",
    "## Akzeptanzkriterien",
    `1. Die Frage „${FOLGE_FRAGE}“ ist beantwortet, jeder Prüfpunkt mit Beleg.`,
    ...FOLGE_PRUEFPUNKTE.map((p, i) => `${i + 2}. Prüfpunkt: ${p}.`),
    `${FOLGE_PRUEFPUNKTE.length + 2}. Negativfall: ein Prüfpunkt ohne Beleg gilt als nicht geprüft, nie als „nichts vergessen“.`,
    "",
    "## Quellen",
    "Unsicherheiten der Teilberichte:",
    liste(unsicherheiten),
    "Webrecherche:",
    liste(recherche),
    "",
  ].join("\n");
  return { titel: `Analyse-Optimierung ${datum}`, body };
}

const PFAD = /(?:^|[\s"'`(=])(?:\/(?:Users|home)\/|~\/|[A-Za-z]:[\\/]|\\\\)/;

/** Öffentlicher Text ohne absoluten Pfad und ohne Namen aus der Freigabeliste (`namen`: deren Pfade). Pur. */
export function oeffentlichSauber(t, namen = []) {
  if (PFAD.test(String(t))) return { ok: false, grund: "absoluter Pfad im Text" };
  if (enthaeltNamen(t, namen)) return { ok: false, grund: "Name aus der Freigabeliste im Text" };
  return { ok: true, grund: "" };
}

/** Abschnitt `## Plan-Review <lauf>` für den Schnappschuss: je Teil Ergebnis, Grund und Ticket oder Zeile. Pur. */
export function reviewAbschnittMarkdown(ergebnisse, lauf) {
  const zelle = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s+/g, " ");
  const zeilen = ergebnisse.map((e) => `| ${zelle(e.id)} | ${zelle(e.ergebnis)} | ${zelle(e.grund)} | ${zelle(e.verweis ?? "-")} |`);
  return ["", `## Plan-Review ${zelle(lauf)}`, "", "| Teil | Ergebnis | Grund | Ticket oder Zeile |", "|---|---|---|---|", ...zeilen, ""].join("\n");
}

/** Hängt den Abschnitt an den Markdown-Text; ein früherer Abschnitt mit derselben Überschrift (erneuter Aufruf desselben Laufs) wird ersetzt. Pur. */
export function abschnittEinsetzen(md, abschnitt) {
  const kopf = abschnitt.split("\n").find((z) => z.startsWith("## "));
  const zeilen = md.split("\n");
  const start = zeilen.findIndex((z) => z === kopf);
  if (start < 0) return `${md.replace(/\s+$/, "")}\n${abschnitt}`;
  const ende = zeilen.findIndex((z, i) => i > start && z.startsWith("## "));
  const davor = zeilen.slice(0, start).join("\n").replace(/\s+$/, "");
  return `${davor}\n${abschnitt}${ende < 0 ? "" : `\n${zeilen.slice(ende).join("\n")}`}`;
}
