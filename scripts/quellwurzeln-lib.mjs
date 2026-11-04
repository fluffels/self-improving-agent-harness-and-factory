// Blatt-Modul (factory#181): Quellwurzeln und Endungsliste der Projekt-Config (`struktur.quelle`, `struktur.endungen`, `struktur.ohne`).
// Importiert nur Node-Builtins, `pfad-glob.mjs` und `relativ-pfad.mjs`; nie `projekt-config-lib` oder `check-basis` (Zyklus), darum sagen die
// Meldungen „in der Projekt-Config“ ohne Dateipfad. Kein Projektliteral.
//
// Formen von `struktur.quelle`: ein String (ein wörtlicher Ordner, wie bisher) oder eine Liste von Ordnern bzw. Globs (Syntax von `pfad-glob.mjs`,
// etwa `*/src/main/java`). Globs lösen nur Ordner auf. Grenze beim Auflösen eines Globs (geschlossene Liste): `node_modules` und Ordner mit
// führendem `.` werden nie betreten; ein wörtlicher Präfix vor dem ersten Glob-Segment wird direkt genommen (auch `.claude/...`). Innerhalb einer
// aufgelösten Wurzel zählt jede Datei mit passender Endung, wie bisher.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { globMaengel, globRegex } from "./pfad-glob.mjs";
import { istRelativPosix } from "./relativ-pfad.mjs";

/** Endungen der JS/TS-Familie (`.d.ts` zählt über `.ts` mit); gilt, wenn `struktur.endungen` fehlt. */
export const STANDARD_ENDUNGEN = Object.freeze([".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

const ENDUNG = /^(\.[A-Za-z0-9_-]+)+$/;
const istText = (v) => typeof v === "string" && v.trim() !== "";
const istObjekt = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/** Pur: ob ein Eintrag Glob-Zeichen (`*` oder `?`) trägt. */
export function istGlob(muster) {
  return /[*?]/.test(muster);
}

function stringMaengel(quelle) {
  if (!istText(quelle)) return ["struktur.quelle muss ein nicht-leerer String (repo-relativer Pfad) oder eine Liste von Pfaden bzw. Globs sein"];
  if (!istRelativPosix(quelle)) return [`struktur.quelle muss ein repo-relativer POSIX-Pfad sein (ohne führenden / oder Laufwerk, ohne . und .., ohne Backslash, ohne End- oder Doppel-Slash): ${JSON.stringify(quelle)}`];
  if (istGlob(quelle)) return [`struktur.quelle ist ein wörtlicher Pfad und darf kein * oder ? tragen (Globs als Liste schreiben): ${JSON.stringify(quelle)}`];
  return [];
}

function endungenMaengel(liste) {
  if (liste === undefined) return [];
  if (!Array.isArray(liste) || liste.length === 0) return ["struktur.endungen muss eine nicht-leere Liste von Endungen mit Punkt sein (etwa .java, .ts)"];
  const gesehen = new Set();
  return liste.flatMap((e, i) => {
    if (typeof e !== "string" || !ENDUNG.test(e)) return [`struktur.endungen[${i}] muss eine Endung mit Punkt sein (etwa .java, .d.ts): ${JSON.stringify(e)}`];
    if (gesehen.has(e)) return [`struktur.endungen[${i}] „${e}“ steht doppelt`];
    gesehen.add(e);
    return [];
  });
}

/** Pur: Fehlertexte für `quelle`, `endungen` und `ohne` des Blocks `struktur`; leer = gültig. Ein fehlender Block ist hier kein Fehler (`quellenAus` verlangt ihn). */
export function quellenMaengel(struktur) {
  if (!istObjekt(struktur)) return [];
  const q = struktur.quelle;
  let quelle;
  if (Array.isArray(q)) quelle = q.length === 0 ? ["struktur.quelle darf als Liste nicht leer sein"] : globMaengel(q, "struktur.quelle");
  else quelle = stringMaengel(q);
  const ohne = struktur.ohne === undefined ? [] : globMaengel(struktur.ohne, "struktur.ohne");
  return [...quelle, ...endungenMaengel(struktur.endungen), ...ohne];
}

/** Die Quellwurzeln, Endungen und Ausschlüsse aus der Config: `{ quelle (roh), wurzeln, endungen, ohne }`; wirft mit Fix-Zeile bei fehlendem `quelle` oder kaputter Form (fail-closed). */
export function quellenAus(config) {
  const block = config?.struktur;
  const fix = "Fix: struktur.quelle (ein Pfad oder eine Liste von Pfaden bzw. Globs), optional struktur.endungen (etwa [\".java\"]) und struktur.ohne (Glob-Liste) in der Projekt-Config eintragen";
  if (!istObjekt(block) || block.quelle === undefined) throw new Error(`struktur.quelle fehlt in der Projekt-Config\n${fix}`);
  const fehler = quellenMaengel(block);
  if (fehler.length > 0) throw new Error(`${fehler.join("; ")} in der Projekt-Config\n${fix}`);
  return {
    quelle: block.quelle,
    wurzeln: typeof block.quelle === "string" ? [block.quelle] : [...block.quelle],
    endungen: [...(block.endungen ?? STANDARD_ENDUNGEN)],
    ohne: [...(block.ohne ?? [])],
  };
}

const istOrdner = (pfad) => {
  try {
    return statSync(pfad).isDirectory();
  } catch {
    return false;
  }
};

const uebersprungen = (name) => name === "node_modules" || name.startsWith(".");

function ordnerWalk(rootDir, rel, regex, treffer) {
  for (const ent of readdirSync(join(rootDir, ...rel.split("/").filter(Boolean)), { withFileTypes: true })) {
    if (!ent.isDirectory() || uebersprungen(ent.name)) continue;
    const kind = rel === "" ? ent.name : `${rel}/${ent.name}`;
    if (regex.test(kind)) treffer.push(kind);
    ordnerWalk(rootDir, kind, regex, treffer);
  }
}

/** Die Ordner (repo-relativ, POSIX, sortiert), die ein Eintrag von `struktur.quelle` trifft; ein wörtlicher Pfad ergibt sich selbst, wenn er ein Ordner ist, sonst `[]`. */
export function ordnerZuMuster(rootDir, muster) {
  if (!istGlob(muster)) return istOrdner(join(rootDir, ...muster.split("/"))) ? [muster] : [];
  const segmente = muster.split("/");
  const erstes = segmente.findIndex((s) => istGlob(s));
  const praefix = segmente.slice(0, erstes).join("/");
  if (praefix !== "" && !istOrdner(join(rootDir, ...praefix.split("/")))) return [];
  const treffer = [];
  ordnerWalk(rootDir, praefix, globRegex(muster), treffer);
  return treffer.sort();
}

function dateiWalk(rootDir, rel, dateien) {
  for (const ent of readdirSync(join(rootDir, ...rel.split("/")), { withFileTypes: true })) {
    const kind = `${rel}/${ent.name}`;
    if (ent.isDirectory()) dateiWalk(rootDir, kind, dateien);
    else if (ent.isFile()) dateien.push(kind);
  }
}

/** Alle Quelldateien (repo-relativ, POSIX, sortiert, ohne Dubletten) unter den Wurzeln mit einer der Endungen, abzüglich der `ohne`-Globs. */
export function quellDateien(rootDir, { wurzeln, endungen, ohne = [] }) {
  const ausgeschlossen = ohne.map(globRegex);
  const alle = new Set();
  for (const wurzel of wurzeln) {
    for (const ordner of ordnerZuMuster(rootDir, wurzel)) {
      const dateien = [];
      dateiWalk(rootDir, ordner, dateien);
      for (const d of dateien) {
        if (endungen.some((e) => d.endsWith(e)) && !ausgeschlossen.some((re) => re.test(d))) alle.add(d);
      }
    }
  }
  return [...alle].sort();
}
