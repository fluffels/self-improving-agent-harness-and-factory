// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * Größenstufe des Diffs (factory#271): `S` (klein) oder `voll`. Die Regel (Kriterium, Grundschutz, Fail-closed-Fälle) steht in
 * `groessenstufe-lib.mjs`; dieses Skript ist der Einstieg für Umsetzer, Planer und Hauptchat. Rechnet dasselbe wie die Nachweis-Wächter.
 *
 *   node scripts/groessenstufe.mjs                 Diff gegen die Vergleichs-Basis (wie die Gates, `resolveBase`) bis HEAD
 *   node scripts/groessenstufe.mjs --commit <sha>  ein einzelner Commit (`<sha>^..<sha>`), etwa für die Nachmessung
 *   node scripts/groessenstufe.mjs --pfade <p…>    Prognose des Planers aus geplanten Pfaden (ohne Zeilen: nur Dateizahl und Pfade)
 *   --json                                         `{stufe, gruende}` als JSON
 *
 * Ausgabe: `STUFE: S` oder `STUFE: voll — <Gründe>`; Exit 0 bei jeder berechneten Stufe, 1 bei einem Aufruf-Fehler. Ein Fehler beim Rechnen
 * (git, Schutzliste) ist `voll` (fail-closed), kein Absturz.
 */
import { execFileSync } from "node:child_process";
import { resolveBase } from "./check-basis.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { bestimmeGroessenstufe, groessenstufeAusGit, ladeLeitplankenMuster } from "./groessenstufe-lib.mjs";

const AUFRUF = "Aufruf: node scripts/groessenstufe.mjs [--commit <sha> | --pfade <pfad…>] [--json]";

/** Die Zeile für Menschen: `STUFE: S` bzw. `STUFE: voll — <Gründe>`. Pur. */
export const stufeZeile = ({ stufe, gruende }) => (stufe === "S" ? "STUFE: S" : `STUFE: voll — ${gruende.join("; ")}`);

/** Rechnet die Stufe zu `argv`; `git` und `ladeMuster` injizierbar. Liefert `{code, ausgabe}` (Exit-Code und stdout/stderr-Text). */
export function laufe(argv, { git = (a) => execFileSync("git", a, { encoding: "utf8" }), ladeMuster = ladeLeitplankenMuster, env = process.env } = {}) {
  const json = argv.includes("--json");
  const rest = argv.filter((a) => a !== "--json");
  const antwort = (r) => ({ code: 0, ausgabe: json ? JSON.stringify(r) : stufeZeile(r) });
  if (rest[0] === "--pfade") {
    const pfade = rest.slice(1);
    if (pfade.length === 0 || pfade.some((p) => p.startsWith("--"))) return { code: 1, ausgabe: AUFRUF };
    try {
      return antwort(bestimmeGroessenstufe({ eintraege: pfade.map((pfad) => ({ pfad: pfad.replace(/\\/g, "/").replace(/^\.\//, "") })), muster: ladeMuster(), prognose: true }));
    } catch (e) {
      return antwort({ stufe: "voll", gruende: [`Schutzliste nicht ladbar: ${e instanceof Error ? e.message : String(e)}`] });
    }
  }
  if (rest[0] === "--commit") {
    if (rest.length !== 2 || rest[1].startsWith("--")) return { code: 1, ausgabe: AUFRUF };
    return antwort(groessenstufeAusGit(git, `${rest[1]}^`, rest[1], { ladeMuster, zweiPunkt: true }));
  }
  if (rest.length > 0) return { code: 1, ausgabe: AUFRUF };
  const base = resolveBase(git, env);
  if (!base) return antwort({ stufe: "voll", gruende: ["keine Vergleichs-Basis auflösbar"] });
  return antwort(groessenstufeAusGit(git, base, "HEAD", { ladeMuster }));
}

function main(argv = process.argv.slice(2)) {
  const r = laufe(argv);
  (r.code === 0 ? console.log : console.error)(r.ausgabe);
  process.exit(r.code);
}

if (istDirektaufruf(import.meta.url)) main();
