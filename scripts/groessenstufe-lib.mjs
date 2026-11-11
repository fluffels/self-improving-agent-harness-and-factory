// Kein Shebang, kein Direktaufruf: Lib der Größenstufe (factory#271). Das Einstiegsskript `groessenstufe.mjs` ruft sie auf, ebenso die
// Nachweis-Wächter (Konvention #1398: Einstiegsskripte importieren nicht voneinander; der Glob /scripts/*-lib.mjs gehört in protected-paths).
/**
 * Größenstufe eines Diffs (factory#271): die eine Stelle (SSOT) für „klein“. Gleiche Pflicht, kleinere Besetzung: Stufe `S` darf mit
 * Planer-Skizze (oder `Plan: ohne — klein: <Begründung>`), einer Kombi-Lens statt drei Brillen und ohne Abnahme bei nicht beobachtbarem
 * Verhalten auskommen; alles andere ist `voll`. Die Stufe wird aus dem Diff berechnet (Umsetzer und Wächter rechnen dasselbe), nie behauptet.
 *
 * Kriterium `S`, alle Bedingungen gemeinsam:
 *  - höchstens `GROESSENSTUFE_S.maxDateien` Dateien und `GROESSENSTUFE_S.maxZeilen` Zeilen (hinzugefügt + gelöscht laut
 *    `git diff --numstat --no-renames`, ohne Ausnahme für generierte Dateien, auch reines Markdown hat keinen Freibetrag);
 *  - kein Pfad aus `.github/protected-paths.json` (alle Gruppen) und keiner aus `GRUNDSCHUTZ` (Harness-Pfade, Gates, Hooks, Agenten, Skills,
 *    Abhängigkeiten), auch bei einer einzigen Zeile; ein Umzug zählt als Löschen plus Anlegen (`--no-renames`), trifft also den alten Pfad mit.
 * Fail-closed (immer `voll`): leere oder nicht lesbare Dateiliste, Binärdatei (numstat `-`), ein von git quotierter Pfad, nicht ladbare
 * Schutzliste, git-Fehler. Die Schutzliste kommt vom Arbeitsbaum; eine Änderung an `.github/` ist wegen `GRUNDSCHUTZ` ohnehin `voll`.
 * Die Prognose (`prognose: true`, Planer vor der Umsetzung) kennt keine Zeilen und prüft nur Dateizahl und Pfade.
 */
import { readFileSync } from "node:fs";
import { schutzlistenMuster, trifftLeitplanke } from "./besitz-extraktion.mjs";

/** Obergrenzen der Stufe S (Summe über den ganzen Diff). */
export const GROESSENSTUFE_S = Object.freeze({ maxDateien: 3, maxZeilen: 60 });

/** Pfade, die nie Stufe S sind, auch wenn `.github/protected-paths.json` sie nicht (oder in einem Bezieher anders) nennt (Muster wie CODEOWNERS, `trifftLeitplanke`). */
export const GRUNDSCHUTZ = Object.freeze([
  "AGENTS.md",
  "/.claude/",
  "/.agents/",
  "/.githooks/",
  "/.github/",
  "/.factory/",
  "/.codex/",
  "/.mcp.json",
  "/scripts/",
  "/test/harness/",
  "/package.json",
  "/package-lock.json",
]);

/**
 * Liest `git diff --numstat --no-renames` (Zeile `<hinzu>\t<weg>\t<pfad>`) in `[{pfad, zeilen}]`; `zeilen` ist die Summe, bei Binärdateien (`-`) `null`.
 * Eine Zeile, die nicht passt, wird ein Eintrag mit `pfad: null` (der Aufrufer wertet sie fail-closed). Pur.
 */
export function parseNumstatNoRenames(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((z) => z.trim() !== "")
    .map((z) => {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(z);
      if (!m) return { pfad: null, zeilen: null };
      return { pfad: m[3], zeilen: m[1] === "-" || m[2] === "-" ? null : Number(m[1]) + Number(m[2]) };
    });
}

/** Gründe, warum ein einzelner Eintrag den Diff `voll` macht (leer = unauffällig). */
function eintragsGruende(e, muster, prognose) {
  if (typeof e?.pfad !== "string" || e.pfad.trim() === "") return ["Dateiliste nicht lesbar (Eintrag ohne Pfad)"];
  if (e.pfad.startsWith('"')) return [`Pfad von git quotiert (${e.pfad}): nicht prüfbar`];
  const gruende = [];
  if (trifftLeitplanke(e.pfad, muster)) gruende.push(`${e.pfad} liegt in einem geschützten Pfad (Leitplanke, Gate, Hook, Agent oder Skill)`);
  if (!prognose && !Number.isInteger(e.zeilen)) gruende.push(`${e.pfad} ist binär oder ohne lesbare Zeilenzahl (Zeilen nicht zählbar)`);
  return gruende;
}

/**
 * Bestimmt die Größenstufe. `eintraege`: `[{pfad, zeilen}]` (`zeilen` `null` = binär; bei `prognose` darf es fehlen); `muster`: die Muster aus
 * `.github/protected-paths.json` (Pflicht, ein leeres Array ist ein Ladefehler und wird `voll`); `GRUNDSCHUTZ` kommt immer dazu.
 * Liefert `{stufe: "S" | "voll", gruende: [...]}`; `gruende` ist bei `S` leer. Pur.
 */
export function bestimmeGroessenstufe({ eintraege, muster, prognose = false }) {
  if (!Array.isArray(muster) || muster.length === 0) return { stufe: "voll", gruende: ["Schutzliste (protected-paths) leer oder nicht geladen"] };
  if (!Array.isArray(eintraege) || eintraege.length === 0) return { stufe: "voll", gruende: ["keine Dateiliste (leer oder nicht lesbar)"] };
  const alle = [...muster, ...GRUNDSCHUTZ];
  const gruende = eintraege.flatMap((e) => eintragsGruende(e, alle, prognose));
  if (eintraege.length > GROESSENSTUFE_S.maxDateien) gruende.push(`${eintraege.length} Dateien (höchstens ${GROESSENSTUFE_S.maxDateien})`);
  if (!prognose) {
    const summe = eintraege.reduce((a, e) => a + e.zeilen, 0);
    if (summe > GROESSENSTUFE_S.maxZeilen) gruende.push(`${summe} Zeilen (höchstens ${GROESSENSTUFE_S.maxZeilen})`);
  }
  return { stufe: gruende.length === 0 ? "S" : "voll", gruende };
}

/** Leitplanken-Muster: Vereinigung der String-Arrays in `.github/protected-paths.json` des Arbeitsbaums; wirft, wenn die Datei fehlt oder kein JSON ist. */
export function ladeLeitplankenMuster(quelle = new URL("../.github/protected-paths.json", import.meta.url)) {
  const muster = schutzlistenMuster(readFileSync(quelle, "utf8"));
  if (muster === null) throw new SyntaxError(".github/protected-paths.json: kein gültiges JSON");
  return muster;
}

/**
 * Die Größenstufe des Diffs `base...head` über die injizierte git-Funktion (`git(args)` liefert stdout, wirft bei Fehler). Fail-closed:
 * ein Fehler beim Laden der Schutzliste oder bei git ist `voll` mit dem Grund. Mit `zweiPunkt` gilt `base..head` (für einen einzelnen Commit `sha^..sha`).
 */
export function groessenstufeAusGit(git, base, head = "HEAD", { ladeMuster = ladeLeitplankenMuster, zweiPunkt = false } = {}) {
  let muster;
  try {
    muster = ladeMuster();
  } catch (e) {
    return { stufe: "voll", gruende: [`Schutzliste nicht ladbar: ${e instanceof Error ? e.message : String(e)}`] };
  }
  try {
    const ausgabe = git(["diff", "--numstat", "--no-renames", `${base}${zweiPunkt ? ".." : "..."}${head}`]);
    return bestimmeGroessenstufe({ eintraege: parseNumstatNoRenames(ausgabe), muster });
  } catch (e) {
    return { stufe: "voll", gruende: [`git-Fehler beim Zählen des Diffs: ${e instanceof Error ? e.message : String(e)}`] };
  }
}
