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
 * Ausgabe: `STUFE: S` oder `STUFE: voll — <Gründe>`; Exit 0 bei jeder berechneten Stufe, 2 bei einem Aufruf-Fehler (`AUFRUF_EXIT`). Ein Fehler beim Rechnen
 * (git, Schutzliste) ist `voll` (fail-closed), kein Absturz.
 */
import { execFileSync } from "node:child_process";
import { resolveBase } from "./check-basis.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { bestimmeGroessenstufe, groessenstufeAusGit, ladeLeitplankenMuster } from "./groessenstufe-lib.mjs";

const AUFRUF = "Aufruf: node scripts/groessenstufe.mjs [--commit <sha> | --pfade <pfad…>] [--json]";
const FLAGS = { commit: { type: "string" }, pfade: { type: "boolean" }, json: { type: "boolean" } };

/** Die Zeile für Menschen: `STUFE: S` bzw. `STUFE: voll — <Gründe>`. Pur. */
export const stufeZeile = ({ stufe, gruende }) => (stufe === "S" ? "STUFE: S" : `STUFE: voll — ${gruende.join("; ")}`);

const normPfad = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Zulässige Aufrufe: nichts, `--commit <sha>` allein oder `--pfade` mit mindestens einem Pfad (Positionsargumente gehören nur zu `--pfade`). Pur. */
const aufrufGueltig = (commit, pfade, pos) => (commit !== undefined ? !pfade && pos.length === 0 : pfade ? pos.length > 0 : pos.length === 0);

/** Rechnet die Stufe zu `argv`; `git`, `ladeMuster` und `env` injizierbar. Liefert `{code, ausgabe}` (Exit-Code und stdout/stderr-Text). */
export function laufe(argv, { git = (a) => execFileSync("git", a, { encoding: "utf8" }), ladeMuster = ladeLeitplankenMuster, env = process.env } = {}) {
  const r = flagsLesen(argv, FLAGS, { positionale: true });
  if (r.fehler) return { code: AUFRUF_EXIT, ausgabe: `${r.fehler.text}\n${AUFRUF}` };
  const { commit, pfade, json } = r.werte;
  const pos = r.positionale;
  if (!aufrufGueltig(commit, pfade, pos)) return { code: AUFRUF_EXIT, ausgabe: AUFRUF };
  const antwort = (e) => ({ code: 0, ausgabe: json ? JSON.stringify(e) : stufeZeile(e) });
  if (pfade) {
    try {
      return antwort(bestimmeGroessenstufe({ eintraege: pos.map((pfad) => ({ pfad: normPfad(pfad) })), muster: ladeMuster(), prognose: true }));
    } catch (e) {
      return antwort({ stufe: "voll", gruende: [`Schutzliste nicht ladbar: ${e instanceof Error ? e.message : String(e)}`] });
    }
  }
  if (commit !== undefined) return antwort(groessenstufeAusGit(git, `${commit}^`, commit, { ladeMuster, zweiPunkt: true }));
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
