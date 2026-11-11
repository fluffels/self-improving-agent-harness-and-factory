// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * Größenstufe des Diffs (factory#271): `S` (klein) oder `voll`. Die Regel (Kriterium, Grundschutz, Fail-closed-Fälle) steht in
 * `groessenstufe-lib.mjs`; dieses Skript ist der Einstieg für Umsetzer, Planer und Hauptchat. Rechnet dasselbe wie die Nachweis-Wächter.
 *
 *   node scripts/groessenstufe.mjs                 Diff gegen die Vergleichs-Basis (wie die Gates, `resolveBase`) bis HEAD
 *   node scripts/groessenstufe.mjs --commit <sha>  ein einzelner Commit (`<sha>^..<sha>`), etwa für die Nachmessung
 *   node scripts/groessenstufe.mjs --pfade <p…>    Prognose des Planers aus geplanten Pfaden (ohne Zeilen: nur Dateizahl und Pfade)
 *   --json                                         `{stufe, gruende, risiko, sweep}` als JSON (`risiko` mit allen Treffern)
 *
 * Ausgabe, drei Zeilen (die dritte `SWEEP: voll | stichprobe — <Grund>`, factory#272: die Sweep-Tiefe der Test-Lens, `stichprobe` nur für Doku- und Testdateien-Diffs ohne Risikoklasse hoch; fehlt sie, gilt `voll`): `STUFE: S` oder `STUFE: voll — <Gründe>`, dazu `RISIKO: hoch | normal | doku — <Grund>` (factory#333: die Risikoklasse aus Pfadmustern der
 * Projekt-Config `risiko.hoch`, sonst der Standardliste; Klasse hoch ist nie `S`; reiner `*.md`-Diff ist `doku`); Exit 0 bei jeder berechneten Stufe, 2 bei einem Aufruf-Fehler (`AUFRUF_EXIT`). Ein Fehler beim Rechnen
 * (git, Schutzliste) ist `voll` (fail-closed), kein Absturz.
 */
import { execFileSync } from "node:child_process";
import { resolveBase } from "./check-basis.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { bestimmeGroessenstufe, groessenstufeAusGit, ladeLeitplankenMuster, ladeRisikoMuster } from "./groessenstufe-lib.mjs";

const AUFRUF = "Aufruf: node scripts/groessenstufe.mjs [--commit <sha> | --pfade <pfad…>] [--json]";
const FLAGS = { commit: { type: "string" }, pfade: { type: "boolean" }, json: { type: "boolean" } };

/** Die Zeile für Menschen: `STUFE: S` bzw. `STUFE: voll — <Gründe>`. Pur. */
export const stufeZeile = ({ stufe, gruende }) => (stufe === "S" ? "STUFE: S" : `STUFE: voll — ${gruende.join("; ")}`);

const MAX_TREFFER_TEXT = 5;

/** Die Risiko-Zeile für Menschen: `RISIKO: <klasse> — <Gründe>`, im Text höchstens `MAX_TREFFER_TEXT` Gründe plus Zahl der weiteren (`--json` trägt alle). Pur. */
export const risikoZeile = ({ klasse, gruende }) => {
  const rest = gruende.length - MAX_TREFFER_TEXT;
  return `RISIKO: ${klasse} — ${gruende.slice(0, MAX_TREFFER_TEXT).join("; ")}${rest > 0 ? ` (+${rest} weitere)` : ""}`;
};

/** Die Sweep-Zeile für Menschen (factory#272): `SWEEP: <tiefe> — <Gründe>`; fehlt `sweep`, ist es `voll` (fail-closed). Pur. */
export const sweepZeile = ({ sweep }) => (sweep ? `SWEEP: ${sweep.tiefe} — ${sweep.gruende.join("; ")}` : "SWEEP: voll — nicht berechnet");

const ladeFehler = (e) => ({ muster: null, quelle: "Projekt-Config", fehler: [`Projekt-Config nicht ladbar: ${e instanceof Error ? e.message : String(e)}`] });

const normPfad = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/** Zulässige Aufrufe: nichts, `--commit <sha>` allein oder `--pfade` mit mindestens einem Pfad (Positionsargumente gehören nur zu `--pfade`). Pur. */
const aufrufGueltig = (commit, pfade, pos) => (commit !== undefined ? !pfade && pos.length === 0 : pfade ? pos.length > 0 : pos.length === 0);

/** Prognose aus geplanten Pfaden; ein Ladefehler der Schutzliste oder der Risiko-Muster ist `voll` (fail-closed). */
function prognose(pos, ladeMuster, ladeRisiko) {
  const meldung = (e) => (e instanceof Error ? e.message : String(e));
  let risiko;
  try {
    risiko = ladeRisiko();
  } catch (e) {
    risiko = ladeFehler(e);
  }
  try {
    return bestimmeGroessenstufe({ eintraege: pos.map((pfad) => ({ pfad: normPfad(pfad) })), muster: ladeMuster(), prognose: true, risiko });
  } catch (e) {
    const grund = `Schutzliste nicht ladbar: ${meldung(e)}`;
    return { stufe: "voll", gruende: [grund], risiko: { klasse: "hoch", quelle: risiko.quelle, treffer: [], gruende: [grund] }, sweep: { tiefe: "voll", gruende: [grund] } };
  }
}

/** Rechnet die Stufe zu `argv`; `git`, `ladeMuster`, `ladeRisiko` und `env` injizierbar. Liefert `{code, ausgabe}` (Exit-Code und stdout/stderr-Text). */
export function laufe(argv, { git = (a) => execFileSync("git", a, { encoding: "utf8" }), ladeMuster = ladeLeitplankenMuster, ladeRisiko = () => ladeRisikoMuster(), env = process.env } = {}) {
  const r = flagsLesen(argv, FLAGS, { positionale: true });
  if (r.fehler) return { code: AUFRUF_EXIT, ausgabe: `${r.fehler.text}\n${AUFRUF}` };
  const { commit, pfade, json } = r.werte;
  const pos = r.positionale;
  if (!aufrufGueltig(commit, pfade, pos)) return { code: AUFRUF_EXIT, ausgabe: AUFRUF };
  const antwort = (e) => ({ code: 0, ausgabe: json ? JSON.stringify(e) : `${stufeZeile(e)}\n${risikoZeile(e.risiko)}\n${sweepZeile(e)}` });
  const fehlRisiko = (grund) => ({ klasse: "hoch", quelle: "Projekt-Config", treffer: [], gruende: [grund] });
  if (pfade) return antwort(prognose(pos, ladeMuster, ladeRisiko));
  if (commit !== undefined) return antwort(groessenstufeAusGit(git, `${commit}^`, commit, { ladeMuster, ladeRisiko, zweiPunkt: true }));
  const base = resolveBase(git, env);
  if (!base) {
    const grund = "keine Vergleichs-Basis auflösbar";
    return antwort({ stufe: "voll", gruende: [grund], risiko: fehlRisiko(grund), sweep: { tiefe: "voll", gruende: [grund] } });
  }
  return antwort(groessenstufeAusGit(git, base, "HEAD", { ladeMuster, ladeRisiko }));
}

function main(argv = process.argv.slice(2)) {
  const r = laufe(argv);
  (r.code === 0 ? console.log : console.error)(r.ausgabe);
  process.exit(r.code);
}

if (istDirektaufruf(import.meta.url)) main();
