/* Skript-Verweis-Wächter (factory#507 L3): kein toter Verweis auf ein Skript im Besitz.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Ein Sync löscht abgelöste Kern-Dateien im Ziel nie (`factory-sync.mjs`: „im Ziel nicht gelöscht“); eine Referenz auf ein entferntes Skript bleibt
 * dort stehen und bricht erst zur Laufzeit. Der Wächter prüft, dass jedes Ziel existiert. Geschlossene Scan-Liste:
 *   (a) `scripts/**` (`.mjs`, `.cjs`): relative Spezifizierer in `import … from "<rel>"`, `import "<rel>"`, `import("<rel>")` und `require("<rel>")`
 *       mit Literal (Auslegung: `importeAus` in `scripts/besitz-extraktion.mjs`, endungslos über `.mjs`/`.cjs`/`.js`);
 *   (b) `node scripts/<pfad>.(mjs|cjs)` in `.github/workflows/*.yml`, in den Werten von `package.json` › `scripts` und in Hook-`command` und
 *       `args` von `.claude/settings.json` (fehlt die Datei, wird sie übersprungen).
 * Grenzen (nicht erkannt): berechnete Spezifizierer, `tsx` und `npx`, `npm run`-Ketten, Skripte außerhalb von `scripts/`, Markdown (das prüft
 * `check:docdrift`); Text in Kommentaren zählt mit (fail-closed, dann den Kommentar umschreiben).
 * Verfall: Prüftermin laut `.github/wiedervorlagen.json` (ADR 0027).
 */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { hookSkripte, kandidatenPfade, relativeImporte } from "./hook-importe";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SKRIPT_AUFRUF = /(?:^|[\s;&|(`"'])node\s+(?:\.\/)?(scripts\/[\w./-]+\.(?:mjs|cjs))\b/gm;
const TS = (p: string): string => p.split("\\").join("/");

/** Pur (a): die relativen Importe von `datei` (Repo-Pfad), deren Ziel nicht existiert (Repo-Pfade der Ziele). */
export function toteImporte(datei: string, text: string, existiert: (pfad: string) => boolean): string[] {
  return relativeImporte(text)
    .map((spec) => posix.normalize(posix.join(posix.dirname(datei), spec)))
    .filter((ziel) => !kandidatenPfade(ziel).some(existiert));
}

/** Pur (b): die `node scripts/<x>.(mjs|cjs)`-Aufrufe in `text`, deren Ziel nicht existiert. */
export function toteAufrufe(text: string, existiert: (pfad: string) => boolean): string[] {
  return [...new Set([...text.matchAll(SKRIPT_AUFRUF)].map((m) => m[1]))].filter((ziel) => !existiert(ziel)).sort();
}

/** Pur (b): die Werte von `package.json` › `scripts` als ein Text (Namen zählen nicht). */
const packageSkripte = (text: string): string => Object.values((JSON.parse(text) as { scripts?: Record<string, string> }).scripts ?? {}).join("\n");

/** Pur (b): Hook-`command` und `args` aus `.claude/settings.json` als ein Text: jeder Eintrag steht als `node <Pfad>`, wie ihn der Hook startet. */
function settingsAufrufe(text: string): string {
  const aufrufe: string[] = [];
  for (const m of text.matchAll(/"command"\s*:\s*"([^"]*)"/g)) aufrufe.push(m[1].replaceAll("${CLAUDE_PROJECT_DIR}/", ""));
  for (const s of hookSkripte(text)) aufrufe.push(`node ${s}`);
  return aufrufe.join("\n");
}

describe("toteImporte (Fixtures im Speicher)", () => {
  const vorhanden = new Set(["scripts/a.mjs", "scripts/lib/b.mjs", "scripts/c.cjs", "scripts/d.js"]);
  const ex = (p: string) => vorhanden.has(p);
  const tot = (text: string, datei = "scripts/x.mjs") => toteImporte(datei, text, ex);

  test("toter relativer Import ist rot, existierendes Ziel grün", () => {
    expect(tot('import { f } from "./weg.mjs";')).toEqual(["scripts/weg.mjs"]);
    expect(tot('import { f } from "./a.mjs";')).toEqual([]);
  });
  test("Auflösung relativ zur importierenden Datei (Unterordner, ../)", () => {
    expect(tot('import "../a.mjs";', "scripts/lib/y.mjs")).toEqual([]);
    expect(tot('import "./b.mjs";', "scripts/lib/y.mjs")).toEqual([]);
    expect(tot('import "./a.mjs";', "scripts/lib/y.mjs")).toEqual(["scripts/lib/a.mjs"]);
  });
  test("dynamischer import(), require und Seiteneffekt-Import werden je gelesen", () => {
    expect(tot('const m = await import("./weg1.mjs");')).toEqual(["scripts/weg1.mjs"]);
    expect(tot('const m = require("./weg2.cjs");')).toEqual(["scripts/weg2.cjs"]);
    expect(tot('import "./weg3.mjs";')).toEqual(["scripts/weg3.mjs"]);
  });
  test("endungsloser Spezifizierer löst über .mjs, .cjs, .js auf", () => {
    expect(tot('require("./c");')).toEqual([]);
    expect(tot('require("./d");')).toEqual([]);
    expect(tot('require("./nirgends");')).toEqual(["scripts/nirgends"]);
  });
  test("harmlose Nachbarn: Bare-Paket und node:-Builtin sind grün", () => {
    expect(tot('import { parse } from "yaml";\nimport fs from "node:fs";')).toEqual([]);
  });
});

describe("toteAufrufe (Fixtures im Speicher)", () => {
  const ex = (p: string) => p === "scripts/da.mjs" || p === "scripts/lib/da.cjs";
  test("Workflow-Text: toter Aufruf rot, vorhandener grün, mehrzeilig und hinter Trennern erkannt", () => {
    expect(toteAufrufe("run: node scripts/weg.mjs", ex)).toEqual(["scripts/weg.mjs"]);
    expect(toteAufrufe("run: node scripts/da.mjs", ex)).toEqual([]);
    expect(toteAufrufe("run: |\n  echo hi\n  X=1 node ./scripts/weg2.mjs --a && node scripts/lib/da.cjs", ex)).toEqual(["scripts/weg2.mjs"]);
  });
  test("package.json: nur die Werte von scripts zählen, ein toter Aufruf ist rot", () => {
    const roh = JSON.stringify({ name: "node scripts/namens-trick.mjs", scripts: { a: "node scripts/weg.mjs --x", b: "node scripts/da.mjs" } });
    expect(toteAufrufe(packageSkripte(roh), ex)).toEqual(["scripts/weg.mjs"]);
    expect(toteAufrufe(packageSkripte("{}"), ex)).toEqual([]);
  });
  test("settings.json: Hook-args und statusLine-command mit totem Skript sind rot", () => {
    const settings = JSON.stringify({
      statusLine: { type: "command", command: "node scripts/weg-status.mjs" },
      stop: { type: "command", command: "node ${CLAUDE_PROJECT_DIR}/scripts/weg-cmd.mjs" },
      hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/scripts/weg-hook.mjs"] }, { type: "command", command: "node", args: ["${CLAUDE_PROJECT_DIR}/scripts/da.mjs"] }] }] },
    });
    expect(toteAufrufe(settingsAufrufe(settings), ex)).toEqual(["scripts/weg-cmd.mjs", "scripts/weg-hook.mjs", "scripts/weg-status.mjs"]);
  });
  test("berechnete Pfade und andere Aufrufer werden nicht erkannt (bekannte Grenze)", () => {
    expect(toteAufrufe('node "$SKRIPT"\nnode scripts/${x}.mjs\ntsx scripts/weg.mjs\nnpm run weg', ex)).toEqual([]);
  });
});

/** Alle `.mjs`/`.cjs` unter `scripts/` (Repo-Pfade), ohne `node_modules`. */
function skriptDateien(): string[] {
  return readdirSync(`${ROOT}scripts`, { recursive: true, encoding: "utf8" })
    .map(TS)
    .filter((p) => /\.(mjs|cjs)$/.test(p) && !p.split("/").includes("node_modules"))
    .map((p) => `scripts/${p}`)
    .sort();
}

describe("echter Baum", () => {
  const existiert = (pfad: string): boolean => existsSync(`${ROOT}${pfad}`);
  const lies = (pfad: string): string => readFileSync(`${ROOT}${pfad}`, "utf8");

  test("(a) kein relativer Import in scripts/** zeigt auf eine fehlende Datei", () => {
    const tot = skriptDateien().flatMap((d) => toteImporte(d, lies(d), existiert).map((z) => `${d} → ${z}`));
    expect(tot).toEqual([]);
  });
  test("(b) kein node scripts/<x> in Workflows, package.json und Hook-Config zeigt auf eine fehlende Datei", () => {
    const tot: string[] = [];
    for (const d of readdirSync(`${ROOT}.github/workflows`).filter((n) => /\.ya?ml$/.test(n))) {
      for (const z of toteAufrufe(lies(`.github/workflows/${d}`), existiert)) tot.push(`.github/workflows/${d} → ${z}`);
    }
    if (existiert("package.json")) for (const z of toteAufrufe(packageSkripte(lies("package.json")), existiert)) tot.push(`package.json → ${z}`);
    if (existiert(".claude/settings.json")) for (const z of toteAufrufe(settingsAufrufe(lies(".claude/settings.json")), existiert)) tot.push(`.claude/settings.json → ${z}`);
    expect(tot).toEqual([]);
  });
  test("der Scan sieht Dateien (kein stiller Leerlauf)", () => {
    expect(skriptDateien().length).toBeGreaterThan(50);
    expect(readdirSync(`${ROOT}.github/workflows`).length).toBeGreaterThan(5);
  });
});
