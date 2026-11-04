// Design-Schritt (factory#172): optionaler Block `design` der Projekt-Config, rein, einziger Import das Blatt `relativ-pfad.mjs` (kein Zyklus).
// Ein Ticket mit dem Design-Label (`design.label`) geht erst in die Auswahl, wenn es auch das Freigabe-Label (`design.freigabe`) trägt;
// `design.system` ist der Pfad der Design-System-Seite (Tokens, Komponenten). Ohne Block gibt es den Schritt nicht.
// Grenze: das Freigabe-Label lässt sich nicht nach Autor prüfen (alle Agenten laufen unter demselben Konto); die Regel steht im Text.

import { istRelativPosix } from "./relativ-pfad.mjs";

const SCHLUESSEL = ["label", "freigabe", "system"];
const istText = (w) => typeof w === "string" && w.trim() !== "";
const gleich = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Pur: Formfehler des optionalen Blocks `design` (leer = gültig, auch ohne Block). */
export function pruefeDesign(block) {
  if (block === undefined) return [];
  if (block === null || typeof block !== "object" || Array.isArray(block)) return ["design muss ein Objekt mit label, freigabe und system sein"];
  const fehler = SCHLUESSEL.filter((k) => !istText(block[k])).map((k) => `design.${k} muss ein nicht-leerer String sein`);
  if (istText(block.system) && !istRelativPosix(block.system)) fehler.push("design.system muss ein relativer POSIX-Pfad sein (kein absoluter Pfad, kein `..`, kein Backslash)");
  if (fehler.length === 0 && gleich(block.label, block.freigabe)) fehler.push("design.label und design.freigabe müssen verschieden sein");
  return fehler;
}

/** Pur: `{ label, freigabe, system }` oder `null` ohne Block; ein unvollständiger Block wirft (kein stiller Standardwert). */
export function designAus(config) {
  const block = config?.design;
  if (block === undefined) return null;
  const fehler = pruefeDesign(block);
  if (fehler.length > 0) throw new Error(`design in der Projekt-Config ungültig: ${fehler.join("; ")}`);
  return { label: block.label, freigabe: block.freigabe, system: block.system };
}

/** Pur: `""` (Ticket darf weiter) oder der Grund, dass der Design-Entwurf fehlt. Label-Vergleich ohne Groß-/Kleinschreibung. */
export function designGrund(labels, config) {
  const d = designAus(config);
  if (d === null) return "";
  const hat = (l) => labels.some((x) => gleich(String(x), l));
  return hat(d.label) && !hat(d.freigabe) ? `Design-Entwurf nicht freigegeben (Design-Label ${d.label} ohne Freigabe-Label ${d.freigabe})` : "";
}
