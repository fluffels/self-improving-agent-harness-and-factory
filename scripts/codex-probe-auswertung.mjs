// Codex-Probe-Auswertung (factory#366): prüft Bericht-Schema und Belegdiagnose und ordnet die Punkte den fünf Nachweisen zu. Rein: kein I/O.
// Ergebnis je Nachweis `belegt|grenze|offen` (Rangfolge: offen vor grenze vor belegt); `autonom` ist immer false, die Übernahme in die Freigabetabelle entscheidet factory#368.
import { bewerteBelege } from "./codex-belege.mjs";
import { NACHWEIS_NUMMERN } from "./codex-freigaben.mjs";
import { checklistenPunkte } from "./codex-probe-lib.mjs";

const ERGEBNISSE = ["belegt", "grenze", "offen"];
const RANG = { belegt: 0, grenze: 1, offen: 2 };
const istObjekt = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v) => typeof v === "string" && v !== "";
const alle = () => [...NACHWEIS_NUMMERN];
/** Welche Nachweise ein Mangel der Belegdiagnose (`bewerteBelege`) betrifft, nach dem Meldungspräfix; Unbekanntes betrifft alle (fail-closed). */
export function nachweiseDerDiagnose(mangel) {
  const m = String(mangel);
  if (m.startsWith("Rolle fehlt im Laufzeitinventar")) return ["1"];
  if (m.startsWith("MCP fehlt im Laufzeitinventar")) return ["2"];
  if (m.startsWith("Langfuse: Rolle ")) return ["1", "4"];
  if (m.startsWith("Langfuse: ")) return ["4"];
  return alle();
}
function eintragMaengel(id, e) {
  if (!istObjekt(e)) return [`Bericht: Punkt ${id} ist kein Objekt`];
  const m = [];
  if (!ERGEBNISSE.includes(e.ergebnis)) m.push(`Bericht: Punkt ${id}: ergebnis muss belegt, grenze oder offen sein`);
  if (typeof e.beobachtung !== "string") m.push(`Bericht: Punkt ${id}: beobachtung muss Text sein`);
  if (!Array.isArray(e.observations) || e.observations.some((o) => typeof o !== "string")) m.push(`Bericht: Punkt ${id}: observations muss eine Liste von IDs sein`);
  if (e.ausgabe !== undefined && typeof e.ausgabe !== "string") m.push(`Bericht: Punkt ${id}: ausgabe muss Text sein`);
  return m;
}
/** Schema-Mängel des Berichts gegen die Belege und die Punkt-Liste; leere Liste = Schema gültig. */
export function berichtSchemaMaengel(bericht, belege, punkte) {
  if (!istObjekt(bericht)) return ["Bericht: kein JSON-Objekt"];
  const m = [];
  if (!text(bericht.version) || bericht.version !== belege?.version) m.push("Bericht: version fehlt oder weicht von den Belegen ab");
  if (!text(bericht.sessionId) || bericht.sessionId !== belege?.sessionId) m.push("Bericht: sessionId fehlt oder weicht von den Belegen ab");
  if (bericht.frischeSession !== true) m.push("Bericht: frischeSession muss true sein (neue CLI-Session, keine Fortsetzung)");
  if (!istObjekt(bericht.punkte)) return [...m, "Bericht: punkte fehlt oder ist kein Objekt"];
  const bekannt = new Set(punkte.map((p) => p.id));
  for (const [id, e] of Object.entries(bericht.punkte)) m.push(...(bekannt.has(id) ? eintragMaengel(id, e) : [`Bericht: unbekannter Punkt ${id}`]));
  return m;
}
const VERSION_MUSTER = /^\d+\.\d+\.\d+$/;
const ohneWeissraum = (v) => String(v ?? "").trim().replace(/\s+/g, " ");
/** Mängel der Erwartung (factory#456): `erwartet.version`/`erwartet.startweg` gegen die berichtete Version vor dem Start, in der Session (`/status`), im Export und den genannten Startweg. Ein Nicht-Objekt meldet das Schema. */
export function erwartungMaengel(bericht, belege) {
  if (!istObjekt(bericht)) return [];
  const e = istObjekt(bericht.erwartet) ? bericht.erwartet : {};
  const m = [];
  if (!text(e.version) || !VERSION_MUSTER.test(e.version)) m.push("Bericht: erwartet.version fehlt oder ist keine Version x.y.z");
  if (ohneWeissraum(e.startweg) === "") m.push("Bericht: erwartet.startweg fehlt (Vorlage von vorbereiten unverändert lassen)");
  if (m.length > 0) return m;
  const beobachtet = { vorStart: bericht.versionVorStart, session: bericht.version, export: belege?.version };
  if (Object.values(beobachtet).some((v) => v !== e.version)) m.push(`Bericht: CLI-Version weicht ab: erwartet ${e.version}, vor dem Start ${beobachtet.vorStart || "?"}, in der Session ${beobachtet.session || "?"}, im Export ${beobachtet.export ?? "?"}`);
  if (ohneWeissraum(bericht.startweg) === "") m.push("Bericht: Startweg nicht genannt (startweg leer)");
  else if (ohneWeissraum(bericht.startweg) !== ohneWeissraum(e.startweg)) m.push("Bericht: Startweg weicht vom erzeugten ab (erwartet der von vorbereiten ausgegebene Startbefehl)");
  return m;
}
/** Zeigt der Punkt auf einen Beleg: Observation-IDs im Export derselben Session, bei `ohneExport` ersatzweise eine nichtleere `ausgabe`. */
function hatVerweis(p, e, belege) {
  const ids = new Set((Array.isArray(belege?.observations) ? belege.observations : []).filter((o) => o?.sessionId === belege.sessionId).map((o) => o.id));
  if (e.observations.length > 0 && e.observations.every((id) => ids.has(id))) return true;
  return p.ohneExport && text(e.ausgabe);
}
/** Zustand eines Punkts `{ zustand, mangel? }`. */
function punktZustand(p, e, belege) {
  if (e === undefined) return { zustand: "offen", mangel: `Checklistenpunkt fehlt im Bericht: ${p.id}` };
  if (e.ergebnis === "offen") return { zustand: "offen", mangel: `Checklistenpunkt ${p.id} ist offen` };
  if (!hatVerweis(p, e, belege)) return { zustand: "offen", mangel: `Checklistenpunkt ${p.id} ohne Beleg-Verweis (Observation-IDs aus dem Export${p.ohneExport ? " oder ausgabe" : ""})` };
  return { zustand: e.ergebnis };
}
const schlechter = (a, b) => (RANG[b] > RANG[a] ? b : a);
/** Wertet Belege-Export und Bericht aus: `{ version, sessionId, nachweise: { "1".."5" }, maengel, autonom: false }`. */
export function auswerten({ belege, bericht, config }) {
  const punkte = checklistenPunkte(config);
  const nachweise = Object.fromEntries(NACHWEIS_NUMMERN.map((n) => [n, "belegt"]));
  const maengel = [];
  const setze = (n, z) => { nachweise[n] = schlechter(nachweise[n], z); };
  const schema = [...berichtSchemaMaengel(bericht, belege, punkte), ...erwartungMaengel(bericht, belege)];
  if (schema.length > 0) {
    maengel.push(...schema);
    for (const n of alle()) setze(n, "offen");
  } else {
    for (const p of punkte) {
      const { zustand, mangel } = punktZustand(p, bericht.punkte[p.id], belege);
      setze(String(p.nachweis), zustand);
      if (mangel) maengel.push(mangel);
    }
  }
  for (const d of bewerteBelege(belege, config)) {
    maengel.push(d);
    for (const n of nachweiseDerDiagnose(d)) setze(n, "offen");
  }
  return { version: belege?.version ?? null, sessionId: belege?.sessionId ?? null, nachweise, maengel, autonom: false };
}
/** Exit-Code der Auswertung: 1 bei mindestens einem offenen Nachweis, sonst 0. */
export const auswertungExit = (ergebnis) => (Object.values(ergebnis.nachweise).includes("offen") ? 1 : 0);
