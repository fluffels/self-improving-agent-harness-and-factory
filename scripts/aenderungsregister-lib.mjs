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

const pruefeSkalare = (z, p) => {
  const f = [];
  if (z.id !== undefined && !(typeof z.id === "string" && /^[a-z0-9-]+$/.test(z.id))) f.push(`${p}id: nur [a-z0-9-] erwartet`);
  if (z.datum !== undefined && !istDatum(z.datum)) f.push(`${p}datum: Datum JJJJ-MM-TT erwartet`);
  for (const feld of ["aenderung", "wirkung", "rueckfall"]) if (z[feld] !== undefined && !istText(z[feld])) f.push(`${p}${feld}: nicht leerer Text erwartet`);
  if (z.pruefTerminGrund !== undefined && !istText(z.pruefTerminGrund)) f.push(`${p}pruefTerminGrund: nicht leerer Text erwartet`);
  return f;
};

const pruefeObjekte = (z, p) => {
  const f = [];
  if (z.messgroesse !== undefined) f.push(...pruefeMessgroesse(z, p));
  if (z.basis !== undefined) f.push(...pruefeBasis(z.basis, p));
  if (z.toleranz !== undefined) f.push(...pruefeToleranz(z.toleranz, p));
  if (z.pruefTermin !== undefined) f.push(...pruefePruefTermin(z, p));
  if (z.mindestdaten !== undefined) f.push(...pruefeMindestdaten(z.mindestdaten, p));
  if (z.adr !== undefined) f.push(...pruefeAdr(z.adr, p));
  return f;
};

const pruefeZeile = (z, i) => {
  const p = `Zeile ${i + 1}${istText(z?.id) ? ` (${z.id})` : ""}: `;
  if (!istObjekt(z)) return [`${p}Objekt erwartet`];
  const f = [];
  for (const feld of PFLICHTFELDER) if (z[feld] === undefined) f.push(`${p}Pflichtfeld ${feld} fehlt`);
  const unbekannt = Object.keys(z).filter((k) => !PFLICHTFELDER.includes(k) && !OPTIONALE_FELDER.includes(k));
  if (unbekannt.length > 0) f.push(`${p}unbekannte Felder ${unbekannt.join(", ")}`);
  return [...f, ...pruefeSkalare(z, p), ...pruefeObjekte(z, p)];
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

// ---------------------------------------------------------------------------------------------------------------------
// Auswertung (factory#572, Teil 2/9 von factory#518): Urteil je fälliger Registerzeile, Fabrik und Bezieher getrennt.
// Pur: `heute`, Exporte und Repo-Tag kommen als Parameter. Der Bericht nennt nie einen Repo-Tag und keinen Bezieher-Namen.
// ---------------------------------------------------------------------------------------------------------------------

/** Aggregation je Art der Messgröße: Kosten als Median, Qualität als Mittelwert (je Einheit-Id ein Wert, mehrere Punkte je Fenster). */
export const AGGREGATION = { kosten: "median", qualitaet: "mittelwert" };

/** Die fünf Urteile je Zeile. */
export const URTEILE = ["eingehalten", "Verstoß", "Lücke", "Überlappung", "noch nicht fällig"];

/**
 * Stichtag, ab dem Langfuse-Läufe einen Repo-Tag tragen (factory#523 setzt ihn). Bis dahin (`null`) ist der Bezieher-Teil immer eine Lücke.
 * Der Tag des Beziehers wird nie ausgegeben; unterschieden wird nur „eigener Tag“ (Fabrik) und „anderer Tag“ (Bezieher, anonym aggregiert).
 */
export const REPO_TAG_AB = null;

/** Grund der Lücke im Bezieher-Teil, solange es keinen Repo-Tag gibt. */
export const BEZIEHER_GRUND = "Repo-Tag fehlt (factory#523)";

const tagVon = (zeitpunkt) => zeitpunkt.slice(0, 10);
const tageZu = (datum, n) => {
  const m = DATUM.exec(datum);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n)).toISOString().slice(0, 10);
};

/** Pur: Marker im Ticket-Body, über den die Anlage dedupliziert (alle Zustände). */
export const markerFuer = (id) => `<!-- aenderungsregister:${id} -->`;

/** Pur: ein Messpunkte-Export `{ art: "aenderungsregister-messpunkte", quelle, punkte[] }` → `{ quelle, punkte }`; wirft bei jeder Formabweichung (nie ein Teilwert). */
export const leseMesspunkte = (json, pfad) => {
  const wirf = (text) => {
    throw new Error(`${pfad}: ${text}`);
  };
  if (!istObjekt(json) || json.art !== "aenderungsregister-messpunkte") wirf('art "aenderungsregister-messpunkte" erwartet');
  if (!QUELLEN.includes(json.quelle)) wirf(`quelle: ${QUELLEN.join(" | ")} erwartet`);
  if (!Array.isArray(json.punkte)) wirf("punkte: Liste erwartet");
  json.punkte.forEach((p, i) => {
    const w = `punkte[${i}]: `;
    if (!istObjekt(p)) wirf(`${w}Objekt erwartet`);
    if (!MESSGROESSEN[p.messgroesse]) wirf(`${w}unbekannte Messgröße ${String(p.messgroesse)}`);
    if (typeof p.zeitpunkt !== "string" || !istDatum(tagVon(p.zeitpunkt))) wirf(`${w}zeitpunkt: Datum JJJJ-MM-TT (optional mit Uhrzeit) erwartet`);
    if (!istText(p.einheitId)) wirf(`${w}einheitId: nicht leerer Text erwartet`);
    if (typeof p.wert !== "number" || !Number.isFinite(p.wert)) wirf(`${w}wert: Zahl erwartet`);
    for (const feld of ["parameter", "repoTag"]) if (p[feld] !== undefined && !istText(p[feld])) wirf(`${w}${feld}: nicht leerer Text erwartet`);
  });
  return { quelle: json.quelle, punkte: json.punkte.map((p) => ({ ...p, quelle: json.quelle })) };
};

/** Pur: Basisfenster `{ von, bis }` (inklusive) aus „<n> Wochen vor Merge“, sonst `null` (Freitext ist eine Lücke, nie geraten). */
export const basisFenster = (zeile) => {
  const m = /^(\d+) Wochen? vor Merge$/.exec(zeile.basis.fenster);
  if (!m || Number(m[1]) < 1) return null;
  return { von: tageZu(zeile.datum, -7 * Number(m[1])), bis: tageZu(zeile.datum, -1) };
};

/** Pur: Nachher-Fenster `{ von, bis }` (inklusive): Änderungsdatum bis Prüftermin. */
export const nachherFenster = (zeile) => ({ von: zeile.datum, bis: zeile.pruefTermin });

/** Pur: Aggregat laut `AGGREGATION` (`null` bei leerer Liste). */
export const aggregiere = (art, werte) => {
  if (werte.length === 0) return null;
  if (AGGREGATION[art] === "mittelwert") return werte.reduce((s, w) => s + w, 0) / werte.length;
  const s = [...werte].sort((a, b) => a - b);
  const mitte = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mitte] : (s[mitte - 1] + s[mitte]) / 2;
};

/** Pur: Abweichung `nach` gegen `basis` in der Einheit der Toleranz; `null` bei Prozent mit Basis 0 (nie geraten). */
export const abweichung = (basis, nach, einheit) => {
  if (einheit !== "prozent") return nach - basis;
  return basis === 0 ? null : ((nach - basis) / Math.abs(basis)) * 100;
};

const luecke = (kopf, grund) => ({ ...kopf, urteil: "Lücke", grund, messwert: null, basis: null, abweichung: null, kosten: null });

/** Pur: der Kontext je Bereich (`fabrik` | `bezieher`): Quelle → `{ punkte }` oder `{ grund }` (Lücke). */
export const bereichKontext = (exporte, bereich, { eigenerRepoTag, repoTagAb = REPO_TAG_AB }) => {
  const aus = {};
  for (const quelle of QUELLEN) {
    const punkte = exporte.filter((e) => e.quelle === quelle).flatMap((e) => e.punkte);
    if (exporte.every((e) => e.quelle !== quelle)) aus[quelle] = { grund: `Export fehlt (Quelle ${quelle})` };
    else if (bereich === "bezieher" && repoTagAb === null) aus[quelle] = { grund: BEZIEHER_GRUND };
    else if (quelle !== "langfuse") aus[quelle] = bereich === "fabrik" ? { punkte } : { grund: "Quelle nur in der Fabrik" };
    else if (punkte.some((p) => p.repoTag === undefined)) aus[quelle] = { grund: "Repo-Tag fehlt im Export (Quelle langfuse)" };
    else if (bereich === "fabrik") aus[quelle] = { punkte: punkte.filter((p) => p.repoTag === eigenerRepoTag) };
    else aus[quelle] = { punkte: punkte.filter((p) => p.repoTag !== eigenerRepoTag && tagVon(p.zeitpunkt) >= repoTagAb) };
  }
  return aus;
};

const aggregat = (kontext, mg, parameter, fenster, min) => {
  const k = kontext[MESSGROESSEN[mg].quelle];
  if (k.grund) return { grund: k.grund };
  const ps = k.punkte.filter((p) => p.messgroesse === mg && (parameter === undefined || p.parameter === parameter) && tagVon(p.zeitpunkt) >= fenster.von && tagVon(p.zeitpunkt) <= fenster.bis);
  const n = new Set(ps.map((p) => p.einheitId)).size;
  if (n < min.n) return { grund: `weniger Läufe als mindestdaten (${n} < ${min.n} ${min.einheit})` };
  return { wert: aggregiere(MESSGROESSEN[mg].art, ps.map((p) => p.wert)), n };
};

const qualitaetMessung = (zeile, kontext) => {
  const qm = zeile.toleranz.qualitaetsmass;
  const par = zeile.messgroesse === qm ? zeile.parameter : undefined;
  const nach = aggregat(kontext, qm, par, nachherFenster(zeile), zeile.mindestdaten);
  if (nach.grund) return { grund: `Nachher: ${nach.grund}` };
  let basis = { wert: zeile.basis.wert };
  if (zeile.basis.wert === null) {
    const bf = basisFenster(zeile);
    if (!bf) return { grund: `Basisfenster nicht auswertbar: ${zeile.basis.fenster}` };
    basis = aggregat(kontext, qm, par, bf, zeile.mindestdaten);
    if (basis.grund) return { grund: `Basis: ${basis.grund}` };
  }
  const abw = abweichung(basis.wert, nach.wert, zeile.toleranz.einheit);
  if (abw === null) return { grund: "Prozent bei Basis 0 nicht berechenbar" };
  return { basis: basis.wert, nach: nach.wert, abweichung: abw };
};

const kostenMessung = (zeile, kontext) => {
  if (MESSGROESSEN[zeile.messgroesse].art !== "kosten") return null;
  const bf = basisFenster(zeile);
  if (!bf) return { luecke: `Basisfenster nicht auswertbar: ${zeile.basis.fenster}` };
  const basis = aggregat(kontext, zeile.messgroesse, zeile.parameter, bf, zeile.mindestdaten);
  const nach = aggregat(kontext, zeile.messgroesse, zeile.parameter, nachherFenster(zeile), zeile.mindestdaten);
  if (basis.grund || nach.grund) return { luecke: basis.grund ?? nach.grund };
  return { basis: basis.wert, nach: nach.wert, vermerk: nach.wert >= basis.wert ? "Wirkung ausgeblieben" : null };
};

const verletzt = (toleranz, abw) => (toleranz.richtung === "steigt" ? abw > toleranz.schwelle : abw < -toleranz.schwelle);

/** Sonderregel „Funde je Brille“: mehr Funde nie ein Verstoß, weniger nur zusammen mit steigender Nacharbeit. */
const fundRegel = (zeile, kontext, q) => {
  if (zeile.toleranz.richtung === "steigt") return { urteil: "eingehalten", vermerk: verletzt(zeile.toleranz, q.abweichung) ? "mehr Funde (kein Verstoß)" : null };
  if (!verletzt(zeile.toleranz, q.abweichung)) return { urteil: "eingehalten" };
  const nach = aggregat(kontext, "nacharbeit-quote", undefined, nachherFenster(zeile), zeile.mindestdaten);
  const bf = basisFenster(zeile);
  const basis = bf ? aggregat(kontext, "nacharbeit-quote", undefined, bf, zeile.mindestdaten) : { grund: "Basisfenster nicht auswertbar" };
  const grund = nach.grund ?? basis.grund;
  if (grund) return { luecke: `Nacharbeit-Quote fehlt (weniger Funde zählen nur mit steigender Nacharbeit): ${grund}` };
  return nach.wert > basis.wert ? { urteil: "Verstoß", vermerk: "weniger Funde bei steigender Nacharbeit" } : { urteil: "eingehalten", vermerk: "weniger Funde, Nacharbeit steigt nicht" };
};

/** Pur: das Einzelurteil einer Zeile in einem Bereich (ohne Überlappung). Vorrang: noch nicht fällig > Lücke > eingehalten/Verstoß. */
export function urteilZeile(zeile, kontext, { heute, bereich, repoTagAb = REPO_TAG_AB }) {
  const kopf = { id: zeile.id, bereich, messgroesse: zeile.messgroesse, parameter: zeile.parameter ?? null, pruefTermin: zeile.pruefTermin, toleranz: zeile.toleranz };
  if (heute < zeile.pruefTermin) return { ...kopf, urteil: "noch nicht fällig", grund: `fällig ab ${zeile.pruefTermin}`, messwert: null, basis: null, abweichung: null, kosten: null };
  if (bereich === "bezieher" && (repoTagAb === null || repoTagAb > zeile.pruefTermin)) return luecke(kopf, BEZIEHER_GRUND);
  const q = qualitaetMessung(zeile, kontext);
  if (q.grund) return luecke(kopf, q.grund);
  const sonder = zeile.toleranz.qualitaetsmass === "blocker-schwere-brille" ? fundRegel(zeile, kontext, q) : null;
  if (sonder?.luecke) return luecke(kopf, sonder.luecke);
  const urteil = sonder ? sonder.urteil : verletzt(zeile.toleranz, q.abweichung) ? "Verstoß" : "eingehalten";
  return { ...kopf, urteil, vermerk: sonder?.vermerk ?? null, messwert: q.nach, basis: q.basis, abweichung: q.abweichung, kosten: kostenMessung(zeile, kontext) };
}

const rolleVon = (z) => (MESSGROESSEN[z.messgroesse]?.parameter === "rolle" ? z.parameter : undefined);

/** Pur: berühren die Fenster zweier Zeilen dieselbe Rolle oder Messgröße (samt Parameter oder gleiches Qualitätsmaß)? */
export const beruehren = (a, b) => {
  if (!(a.datum <= b.pruefTermin && b.datum <= a.pruefTermin)) return false;
  const rolle = rolleVon(a) !== undefined && rolleVon(a) === rolleVon(b);
  const mass = a.messgroesse === b.messgroesse && a.parameter === b.parameter;
  return rolle || mass || a.toleranz.qualitaetsmass === b.toleranz.qualitaetsmass;
};

/** Pur: Gruppen sich berührender Zeilen (Ids sortiert, Gruppen ab zwei Ids) aus `zeilen`. */
export const ueberlappungen = (zeilen) => {
  const gruppe = new Map(zeilen.map((z) => [z.id, new Set([z.id])]));
  for (const a of zeilen) {
    for (const b of zeilen) {
      if (a.id === b.id || !beruehren(a, b)) continue;
      const vereint = new Set([...gruppe.get(a.id), ...gruppe.get(b.id)]);
      for (const id of vereint) gruppe.set(id, vereint);
    }
  }
  return [...new Set(gruppe.values())].filter((g) => g.size > 1).map((g) => [...g].sort());
};

const BEREICHE = ["fabrik", "bezieher"];
const ausgewertet = (u) => u.urteil === "eingehalten" || u.urteil === "Verstoß";

/** Pur: `{ heute, zeilen: [{ id, fabrik, bezieher }] }`; Überlappung nur unter fälligen, ausgewerteten Zeilen eines Bereichs. */
export function auswertung(register, exporte, { heute, eigenerRepoTag, repoTagAb = REPO_TAG_AB }) {
  const einzel = {};
  for (const bereich of BEREICHE) {
    const kontext = bereichKontext(exporte, bereich, { eigenerRepoTag, repoTagAb });
    einzel[bereich] = new Map(register.zeilen.map((z) => [z.id, urteilZeile(z, kontext, { heute, bereich, repoTagAb })]));
    const berechtigt = register.zeilen.filter((z) => ausgewertet(einzel[bereich].get(z.id)));
    for (const ids of ueberlappungen(berechtigt)) {
      const verstoss = ids.some((id) => einzel[bereich].get(id).urteil === "Verstoß");
      for (const id of ids) {
        const u = einzel[bereich].get(id);
        einzel[bereich].set(id, { ...u, einzel: u.urteil, urteil: "Überlappung", mit: ids, verstoss });
      }
    }
  }
  return { heute, zeilen: register.zeilen.map((z) => ({ id: z.id, fabrik: einzel.fabrik.get(z.id), bezieher: einzel.bezieher.get(z.id) })) };
}

/** Pur: je Verstoß eine Gruppe; eine Überlappung mit Verstoß ist eine Gruppe mit allen Ids; gleiche Ids in beiden Bereichen eine Gruppe. */
export function ticketGruppen(ergebnis, register) {
  const gruppen = new Map();
  for (const z of ergebnis.zeilen) {
    for (const bereich of BEREICHE) {
      const u = z[bereich];
      const ueberlappung = u.urteil === "Überlappung" && u.verstoss === true;
      if (u.urteil !== "Verstoß" && !ueberlappung) continue;
      const ids = ueberlappung ? u.mit : [z.id];
      const key = ids.join(",");
      const g = gruppen.get(key) ?? { ids, ueberlappung, bereiche: [], urteile: [], zeilen: ids.map((id) => register.zeilen.find((r) => r.id === id)) };
      if (!g.bereiche.includes(bereich)) g.bereiche.push(bereich);
      g.urteile.push(u);
      gruppen.set(key, g);
    }
  }
  return [...gruppen.values()];
}

const zahl = (w) => (w === null ? "-" : String(Math.round(w * 100) / 100));
const bereichName = (b) => (b === "fabrik" ? "Fabrik" : "Bezieher (anonym aggregiert)");

/** Pur: Titel und Body des Verstoß-Tickets; je Id steht der Marker im Body, der Body besteht `pruefeEingang` (Ziel, Akzeptanzkriterien samt Negativfall). */
export function ticketBody(gruppe) {
  const ids = gruppe.ids.map((i) => `\`${i}\``).join(", ");
  const messwerte = gruppe.urteile
    .map((u) => `- ${bereichName(u.bereich)}, Zeile \`${u.id}\`${u.einzel ? ` (Einzelurteil ${u.einzel})` : ""}: ${u.toleranz.qualitaetsmass} Basis ${zahl(u.basis)}, nachher ${zahl(u.messwert)}, Abweichung ${zahl(u.abweichung)} ${u.toleranz.einheit}; Toleranz ${u.toleranz.richtung} um höchstens ${u.toleranz.schwelle} ${u.toleranz.einheit}${u.vermerk ? `; ${u.vermerk}` : ""}`)
    .join("\n");
  const rueckfall = gruppe.zeilen.map((z) => `- \`${z.id}\` (${z.aenderung}): ${z.rueckfall}`).join("\n");
  const entscheidung = gruppe.ueberlappung
    ? "Die Fenster mehrerer Zeilen berühren dieselbe Rolle oder Messgröße: kein automatischer Rückfall, erst die Zuordnung klären, welche Änderung die Verletzung trägt."
    : "Rückfall als Revert-PR nach ADR 0027 Punkt 4 (Revert des genannten Merge-Commits per PR mit Review; die Ledger-Zeile bleibt und bekommt den Vermerk „ausgelöst <Datum>, Revert #<pr>, Anlass“).";
  const body = [
    gruppe.ids.map(markerFuer).join("\n"),
    "",
    "## Ziel",
    `Die Wirkungsprüfung (Änderungsregister, factory#518) hat für ${ids} die Qualitäts-Toleranz verletzt. Entscheiden, ob die Änderung zurückgenommen wird; Kosten zählen dabei nicht, nur die Qualität.`,
    "",
    "## Messwerte",
    messwerte,
    "",
    "## Rückfall",
    entscheidung,
    rueckfall,
    "",
    "## Akzeptanzkriterien",
    "1. Der Rückfall ist entschieden: Revert-PR gemergt oder die Toleranz mit Beleg begründet bestätigt; die Entscheidung steht im Ticket.",
    "2. Die Ledger-Zeile in ADR 0027 trägt den Vermerk „ausgelöst“ oder die Begründung der Bestätigung.",
    "3. Negativfall: ein Revert ohne Review oder ohne Prüfung der Überlappung (mehrere Ids) gilt nicht als erledigt.",
    "",
    "## Begründung der Ausnahme",
    "Dieses Ticket ist eine ausdrückliche Ausnahme von „Harness-Befunde sind Zeilen“ (AGENTS.md): ein Qualitätsverstoß einer geprüften Änderung braucht eine Entscheidung mit Frist, keine Sammelzeile.",
  ].join("\n");
  return { titel: `Wirkungsprüfung: Verstoß ${gruppe.ids.join(", ")}`, body };
}

/** Pur: der Bericht als Markdown; `tickets` (optional) nennt je Gruppe-Schlüssel das Ergebnis der Anlage. */
export function renderMarkdown(ergebnis, tickets = []) {
  const z = ergebnis.zeilen.flatMap((r) =>
    BEREICHE.map((b) => {
      const u = r[b];
      const mit = u.mit ? ` mit ${u.mit.join(", ")}${u.verstoss ? " (Verstoß)" : ""}` : "";
      const werte = u.messwert === null ? `Grund: ${u.grund ?? "-"}` : `Messwert ${zahl(u.messwert)}, Basis ${zahl(u.basis)}, Toleranz ${u.toleranz.richtung} ${u.toleranz.schwelle} ${u.toleranz.einheit}${u.vermerk ? `, ${u.vermerk}` : ""}`;
      const kosten = u.kosten ? (u.kosten.luecke ? `; Kosten: Lücke (${u.kosten.luecke})` : `; Kosten ${zahl(u.kosten.basis)} → ${zahl(u.kosten.nach)}${u.kosten.vermerk ? ` (${u.kosten.vermerk})` : ""}`) : "";
      return `| ${r.id} | ${bereichName(b)} | ${u.urteil}${mit} | ${werte}${kosten} |`;
    }),
  );
  const t = tickets.length ? ["", "## Tickets", ...tickets.map((x) => `- ${x}`)] : [];
  return ["# Änderungsregister: Wirkungsprüfung", "", `Stand: ${ergebnis.heute}`, "", "| Zeile | Bereich | Urteil | Messung |", "| --- | --- | --- | --- |", ...z, ...t].join("\n");
}
