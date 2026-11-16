// Kein Shebang: wird per `node scripts/fangquote-export.mjs` gestartet UND von test/fangquote-export.test.ts importiert.
/**
 * Fangquote-Export (factory#607, Teil 1/4 von factory#517): zählt je Wächter-Testdatei die roten Läufe und gibt einen Messpunkte-Export der Quelle
 * `gate-fundquote` im Format des Änderungsregisters aus (`fangquoteExport`). Der Mittelwert je Datei ist die Fangquote (1 = Lauf mit Fang, 0 = Lauf ohne).
 *
 *   node scripts/fangquote-export.mjs [--waechter-dir <ordner>] [--von <ISO>] [--bis <ISO>] [--ci <workflow>] [--transkript <datei>]… [--ci-log <datei>]…
 *
 * Die Zählung selbst (Regel 7) steht im Kern-Skript `gate-fundquote.mjs`; dieses Skript kennt nur das Register-Format und ist deshalb FABRIK-EIGEN
 * (nie an Bezieher verteilt, bricht dort mit Exit 4 ab). Wächter sind die Testdateien (`*.test.*`) unter `--waechter-dir` (Standard `test/harness`).
 * Fehlen die Logs im Fenster, trägt der Export `luecke` mit Grund und keine Punkte (nie eine 0). Grenze: eine Wächter-Datei, die erst später entstand,
 * bekommt auch für frühere Läufe eine 0 (die Quote ist dort nach unten verzerrt).
 * Exit 0 Export auf stdout, 1 `gh` scheitert, 2 Aufruffehler, 4 Abbruch im Bezieher.
 */
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { fangquoteExport } from "./aenderungsregister-lib.mjs";
import { sammle, standardZugriffe, waechterLuecke, waechterPunkte } from "./gate-fundquote.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const STANDARD_ORDNER = "test/harness";
const TESTDATEI = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Testdateien unter `ordner` (rekursiv), als `/`-Pfade relativ zur Repo-Wurzel, sortiert. */
export const waechterDateien = (ordner, { wurzel = WURZEL, liste = (p) => readdirSync(p, { recursive: true }) } = {}) =>
  liste(join(wurzel, ordner))
    .map((p) => relative(wurzel, join(wurzel, ordner, String(p))).replace(/\\/g, "/"))
    .filter((p) => TESTDATEI.test(p))
    .sort();

/**
 * Ablauf ohne `process.exit` (testbar): `{ exitCode, text }`. `deps` (Tests): `bezieher`, `dateien`, plus die Zugriffe von `gate-fundquote.mjs`
 * (`pkg`, `findeSessions`, `ladeSession`, `gh`, `liesDatei`, `err`, `jetzt`).
 */
export function lauf(argv, deps = {}) {
  const bezieher = deps.bezieher ?? (istBezieher(WURZEL) || istBezieher(process.cwd()));
  if (bezieher) return { exitCode: 4, text: "Abbruch: fabrik-eigen. Der Fangquote-Export wird nie an Bezieher verteilt und läuft dort nie." };
  const fehler = [];
  const s = sammle(argv, { ...standardZugriffe(), ...deps, err: (t) => fehler.push(t) }, { "waechter-dir": { type: "string" } });
  if (s.exit !== undefined) return { exitCode: s.exit, text: fehler.join("\n") };
  const ordner = s.werte["waechter-dir"] ?? STANDARD_ORDNER;
  const laeufe = [...s.transkript, ...s.ci.laeufe];
  const dateien = deps.dateien ?? waechterDateien(ordner);
  const punkte = waechterPunkte(laeufe, dateien);
  const luecke = dateien.length === 0 ? `keine Testdateien unter ${ordner}` : waechterLuecke(laeufe);
  return { exitCode: 0, text: JSON.stringify(fangquoteExport(dateien.length === 0 ? [] : punkte, { luecke }), null, 2) };
}

if (istDirektaufruf(import.meta.url)) {
  const r = lauf(process.argv.slice(2));
  (r.exitCode === 0 ? console.log : console.error)(r.text);
  process.exitCode = r.exitCode;
}
