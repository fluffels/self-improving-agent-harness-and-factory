/**
 * Änderungsregister (factory#571, Teil 1/9 von factory#518): reine Logik für `.github/aenderungsregister.json`.
 *
 * Jede Umstellung der Fabrik bekommt eine Registerzeile mit Datum, Änderung, erwarteter Wirkung, Messgröße, Basis, Toleranz,
 * Rückfall und Prüftermin. Die Ledger-Zeile in ADR 0027 bleibt der begründende Beleg, das Register trägt die Prüfung.
 * Die Lib ist pur (kein fs, kein process); gemessen wird hier nichts. Wächter: `test/harness/aenderungsregister.test.ts`.
 * Jede Prüffunktion liefert ein Array von Fehlertexten, leer heißt gültig.
 */

/** Erlaubte Quellen einer Messgröße. */
export const QUELLEN = ["langfuse", "transkript", "lauf-ergebnis", "factory-kennzahlen"];

/** Art einer Messgröße: Kostenmaß oder Qualitätsmaß (die Toleranz verlangt ein Qualitätsmaß). */
export const ARTEN = ["kosten", "qualitaet"];

/** Zulässige Werte der Parameter einer Messgröße; generisch, ohne Projektpräfix. */
export const PARAMETER = {
  rolle: ["planer", "umsetzer", "lens", "abnahme", "szenario"],
  brille: ["architektur", "requirement-treue", "test-adaequanz", "sicherheit", "doku"],
};

/** Messgrößen-Katalog (Startumfang): Schlüssel → { titel, quelle, art, parameter? }. */
export const MESSGROESSEN = {
  "kosten-je-ticket": { titel: "Median Kosten je Ticket (gesamt)", quelle: "langfuse", art: "kosten" },
  "kosten-je-ticket-rolle": { titel: "Median Kosten je Ticket je Rolle", quelle: "langfuse", art: "kosten", parameter: "rolle" },
  "nacharbeit-quote": { titel: "Nacharbeit-Quote (Revert oder `Folge #` binnen 14 Tagen)", quelle: "lauf-ergebnis", art: "qualitaet" },
  "ci-fix-runden": { titel: "CI-Fix-Runden je PR", quelle: "lauf-ergebnis", art: "qualitaet" },
  "blocker-schwere-brille": { titel: "Blocker nach Schwere je Brille", quelle: "lauf-ergebnis", art: "qualitaet", parameter: "brille" },
};

export const RICHTUNGEN = ["steigt", "faellt"];
export const EINHEITEN = ["prozentpunkte", "prozent", "absolut"];
export const MINDESTDATEN_EINHEITEN = ["prs", "tickets", "laeufe"];

/** Pflichtfelder einer Registerzeile (der Standard-Prüftermin hängt am Feld `datum`). */
export const PFLICHTFELDER = ["id", "datum", "aenderung", "wirkung", "messgroesse", "basis", "toleranz", "rueckfall", "pruefTermin", "mindestdaten", "adr"];
const OPTIONALE_FELDER = ["parameter", "pruefTerminGrund"];

/** Ab diesem Datum nennt jede neue Ledger-Zeile in ADR 0027 eine Register-Id (`Register: \`<id>\``). */
export const EINFUEHRUNG = "2026-11-17";

const istObjekt = (w) => typeof w === "object" && w !== null && !Array.isArray(w);
const istText = (w) => typeof w === "string" && w.trim() !== "";
const DATUM = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pur: ist `w` ein gültiges Kalenderdatum JJJJ-MM-TT? */
export const istDatum = (w) => {
  if (typeof w !== "string") return false;
  const m = DATUM.exec(w);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === w;
};

/** Pur: Standard-Prüftermin = Datum + 28 Kalendertage (UTC). */
export const standardPruefTermin = (datum) => {
  const m = DATUM.exec(datum);
  if (!m) throw new Error(`kein Datum JJJJ-MM-TT: ${String(datum)}`);
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 28));
  return d.toISOString().slice(0, 10);
};

const pruefeToleranz = (t, p) => {
  if (!istObjekt(t)) return [`${p}toleranz: Objekt { qualitaetsmass, richtung, schwelle, einheit } erwartet, kein Freitext`];
  const f = [];
  const unbekannt = Object.keys(t).filter((k) => !["qualitaetsmass", "richtung", "schwelle", "einheit"].includes(k));
  if (unbekannt.length > 0) f.push(`${p}toleranz: unbekannte Felder ${unbekannt.join(", ")}`);
  const mass = MESSGROESSEN[t.qualitaetsmass];
  if (!mass) f.push(`${p}toleranz.qualitaetsmass: unbekannte Messgröße ${String(t.qualitaetsmass)}`);
  else if (mass.art !== "qualitaet") f.push(`${p}toleranz.qualitaetsmass: ${t.qualitaetsmass} ist kein Qualitätsmaß`);
  if (!RICHTUNGEN.includes(t.richtung)) f.push(`${p}toleranz.richtung: ${RICHTUNGEN.join(" | ")} erwartet`);
  if (typeof t.schwelle !== "number" || !Number.isFinite(t.schwelle)) f.push(`${p}toleranz.schwelle: Zahl erwartet`);
  if (!EINHEITEN.includes(t.einheit)) f.push(`${p}toleranz.einheit: ${EINHEITEN.join(" | ")} erwartet`);
  return f;
};

const pruefeBasis = (b, p) => {
  if (!istObjekt(b)) return [`${p}basis: Objekt { fenster, wert } erwartet`];
  const f = [];
  const unbekannt = Object.keys(b).filter((k) => !["fenster", "wert"].includes(k));
  if (unbekannt.length > 0) f.push(`${p}basis: unbekannte Felder ${unbekannt.join(", ")}`);
  if (!istText(b.fenster)) f.push(`${p}basis.fenster: nicht leerer Text erwartet`);
  if (b.wert !== null && (typeof b.wert !== "number" || !Number.isFinite(b.wert))) f.push(`${p}basis.wert: Zahl oder null erwartet`);
  return f;
};

const pruefeMindestdaten = (m, p) => {
  if (!istObjekt(m)) return [`${p}mindestdaten: Objekt { n, einheit } erwartet`];
  const f = [];
  const unbekannt = Object.keys(m).filter((k) => !["n", "einheit"].includes(k));
  if (unbekannt.length > 0) f.push(`${p}mindestdaten: unbekannte Felder ${unbekannt.join(", ")}`);
  if (!Number.isInteger(m.n) || m.n < 1) f.push(`${p}mindestdaten.n: Ganzzahl ≥ 1 erwartet`);
  if (!MINDESTDATEN_EINHEITEN.includes(m.einheit)) f.push(`${p}mindestdaten.einheit: ${MINDESTDATEN_EINHEITEN.join(" | ")} erwartet`);
  return f;
};

const pruefeAdr = (a, p) => {
  if (!istObjekt(a)) return [`${p}adr: Objekt { datum, pr } erwartet`];
  const f = [];
  const unbekannt = Object.keys(a).filter((k) => !["datum", "pr"].includes(k));
  if (unbekannt.length > 0) f.push(`${p}adr: unbekannte Felder ${unbekannt.join(", ")}`);
  if (!istDatum(a.datum)) f.push(`${p}adr.datum: Datum JJJJ-MM-TT erwartet`);
  if (!istText(a.pr)) f.push(`${p}adr.pr: nicht leerer Text erwartet (wörtlich wie in der PR-Spalte des Ledgers)`);
  return f;
};

const pruefeMessgroesse = (z, p) => {
  const eintrag = MESSGROESSEN[z.messgroesse];
  if (!eintrag) return [`${p}messgroesse: unbekannte Messgröße ${String(z.messgroesse)}`];
  if (!eintrag.parameter) return z.parameter === undefined ? [] : [`${p}parameter: ${z.messgroesse} hat keinen Parameter`];
  if (z.parameter === undefined) return [`${p}parameter: ${z.messgroesse} verlangt den Parameter ${eintrag.parameter}`];
  return PARAMETER[eintrag.parameter].includes(z.parameter) ? [] : [`${p}parameter: ${String(z.parameter)} nicht in ${eintrag.parameter} (${PARAMETER[eintrag.parameter].join(", ")})`];
};

const pruefePruefTermin = (z, p) => {
  if (!istDatum(z.pruefTermin)) return [`${p}pruefTermin: Datum JJJJ-MM-TT erwartet`];
  if (!istDatum(z.datum)) return [];
  const standard = standardPruefTermin(z.datum);
  if (z.pruefTermin === standard) return [];
  return istText(z.pruefTerminGrund) ? [] : [`${p}pruefTermin: ${z.pruefTermin} weicht vom Standard ${standard} (Datum + 28 Tage) ab, ohne pruefTerminGrund`];
};

const pruefeZeile = (z, i) => {
  const p = `Zeile ${i + 1}${istText(z?.id) ? ` (${z.id})` : ""}: `;
  if (!istObjekt(z)) return [`${p}Objekt erwartet`];
  const f = [];
  for (const feld of PFLICHTFELDER) if (z[feld] === undefined) f.push(`${p}Pflichtfeld ${feld} fehlt`);
  const unbekannt = Object.keys(z).filter((k) => !PFLICHTFELDER.includes(k) && !OPTIONALE_FELDER.includes(k));
  if (unbekannt.length > 0) f.push(`${p}unbekannte Felder ${unbekannt.join(", ")}`);
  if (z.id !== undefined && !(typeof z.id === "string" && /^[a-z0-9-]+$/.test(z.id))) f.push(`${p}id: nur [a-z0-9-] erwartet`);
  if (z.datum !== undefined && !istDatum(z.datum)) f.push(`${p}datum: Datum JJJJ-MM-TT erwartet`);
  for (const feld of ["aenderung", "wirkung", "rueckfall"]) if (z[feld] !== undefined && !istText(z[feld])) f.push(`${p}${feld}: nicht leerer Text erwartet`);
  if (z.messgroesse !== undefined) f.push(...pruefeMessgroesse(z, p));
  if (z.basis !== undefined) f.push(...pruefeBasis(z.basis, p));
  if (z.toleranz !== undefined) f.push(...pruefeToleranz(z.toleranz, p));
  if (z.pruefTermin !== undefined) f.push(...pruefePruefTermin(z, p));
  if (z.pruefTerminGrund !== undefined && !istText(z.pruefTerminGrund)) f.push(`${p}pruefTerminGrund: nicht leerer Text erwartet`);
  if (z.mindestdaten !== undefined) f.push(...pruefeMindestdaten(z.mindestdaten, p));
  if (z.adr !== undefined) f.push(...pruefeAdr(z.adr, p));
  return f;
};

/** Pur: Schema des Registers (Liste der Zeilen). Doppelte Ids sind rot. */
export const pruefeRegister = (zeilen) => {
  if (!Array.isArray(zeilen)) return ["zeilen: Liste erwartet"];
  const fehler = zeilen.flatMap(pruefeZeile);
  const gesehen = new Set();
  for (const z of zeilen) {
    if (!istObjekt(z) || typeof z.id !== "string") continue;
    if (gesehen.has(z.id)) fehler.push(`id ${z.id}: doppelt`);
    gesehen.add(z.id);
  }
  return fehler;
};

/**
 * Pur: die Zeilen der Tabelle unter `## Gelockert` im ADR-Text als `{ datum, pr, text }`; andere Tabellen zählen nicht.
 * Datum ist die erste, PR die vorletzte Zelle (der Zelltext kann Pipes enthalten).
 */
export const ledgerZeilen = (adrText) => {
  const zeilen = String(adrText).split(/\r?\n/);
  const start = zeilen.findIndex((z) => /^##\s+Gelockert\s*$/.test(z));
  if (start < 0) return [];
  const aus = [];
  for (const zeile of zeilen.slice(start + 1)) {
    if (/^#{1,6}\s/.test(zeile)) break;
    if (!zeile.startsWith("|")) continue;
    const zellen = zeile.replace(/^\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
    if (zellen.length < 3 || !DATUM.test(zellen[0] ?? "")) continue;
    aus.push({ datum: zellen[0], pr: zellen[zellen.length - 2], text: zeile });
  }
  return aus;
};

/** Pur: jede Registerzeile braucht eine Ledger-Zeile mit gleichem Datum und gleichem PR (`adr`). */
export const pruefeAdrVerweise = (zeilen, ledger) =>
  zeilen.flatMap((z, i) => {
    const a = z?.adr;
    if (!istObjekt(a)) return [];
    const treffer = ledger.some((l) => l.datum === a.datum && l.pr === a.pr);
    return treffer ? [] : [`Zeile ${i + 1}${istText(z.id) ? ` (${z.id})` : ""}: adr ${String(a.datum)} / ${String(a.pr)} zeigt auf keine Ledger-Zeile in ADR 0027`];
  });

/** Pur: jede Ledger-Zeile mit Datum ab `einfuehrung` nennt `Register: \`<id>\`` mit einer Id des Registers. */
export const pruefeLedgerIds = (ledger, ids, einfuehrung = EINFUEHRUNG) =>
  ledger
    .filter((l) => l.datum >= einfuehrung)
    .flatMap((l) => {
      const m = /Register:\s*`([^`]+)`/.exec(l.text);
      if (!m) return [`Ledger-Zeile ${l.datum} / ${l.pr}: ab ${einfuehrung} fehlt \`Register: <id>\``];
      return ids.includes(m[1]) ? [] : [`Ledger-Zeile ${l.datum} / ${l.pr}: Register-Id ${m[1]} steht nicht im Änderungsregister`];
    });
