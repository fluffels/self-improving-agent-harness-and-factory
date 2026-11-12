/* Diff-Coverage-Wächter (#1021) — geänderte Zeilen pro PR müssen getestet sein.
 *
 * Harness-Test in derselben Familie wie test/diffsize.test.ts und test/bundle.test.ts:
 * er prüft das Verhalten der TOOLING-Logik über deren öffentliche Exporte (importiert
 * aus scripts/check-diffcoverage.mjs — EINE Quelle der Wahrheit, kein Drift zwischen
 * Test und CLI). git und Dateisystem bleiben unangetastet: `runGit`/`readFile` sind
 * injiziert, damit der Test ohne Repo-/Coverage-Zustand deterministisch läuft. Das
 * Warum des Gates steht in AGENTS.md › Abdeckung und Bundle.
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:diffcoverage)
 */
import { describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { FREMD, projektConfig } from "./support/fremd-config";
import { fixture } from "./support/tmp-fixture";

// #101: node:child_process ersetzt, damit der Standardweg ohne runGit (execFileSync mit GIT_OPTIONEN) prüfbar ist, ohne git zu starten.
const execFileSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), execFileSync: execFileSyncMock }));

// Schicht-SSOT (bewusst CommonJS, siehe scripts/layers.cjs) — damit der Floor-Test
// unten an die ECHTEN Schicht-Buckets gebunden ist statt an vier abgeschriebene Namen.
const requireCjs = createRequire(import.meta.url);
const { LAYERS, SCHICHT_MODELL } = requireCjs("../scripts/layers.cjs") as { LAYERS: Record<string, string>; SCHICHT_MODELL: { quellwurzel: string; schichten: { id: string; wurzeln: string[] }[] } };

// Quellwurzel und Schicht-Wurzeln kommen aus der Projekt-Config und den Schichtdaten des Repos, nie als Literal: der Test gilt für jedes Repo, das die Kern-Skripte nutzt.
const Q = projektConfig().struktur.quelle;
const wurzelVon = (schicht: string): string => SCHICHT_MODELL.schichten.find((s) => s.id === schicht)?.wurzeln[0] ?? "";
/** Eine Datei der Präsentations- und eine der Anwendungs-Schicht (die Wurzeln stehen in `SCHICHT_MODELL`). */
const PRAES = `${Q}/${wurzelVon(LAYERS.PRESENTATION)}/worldscene/clustersync.ts`;
const ANW = `${Q}/${wurzelVon(LAYERS.APPLICATION)}/idb.ts`;

type Env = Record<string, string | undefined>;
type RunGit = (args: string[]) => string;
type Changed = Map<string, Set<number>>;
type Lcov = Map<string, Map<number, number>>;
type Bucket = { covered: number; total: number; pct: number; floor: number | null; below: boolean };
type Quellen = { wurzeln: string[]; endungen: string[]; ohne?: string[] };
type Bericht = { format: string; pfad: string; basis?: string };
type Verdict = { buckets: Record<string, Bucket>; missing: string[]; below: string[] };

/** Die öffentliche Oberfläche des Wächters, wie dieser Test sie nutzt. */
type CheckDiffCoverageModule = {
  LAYER_DIFF_FLOORS: Record<string, number | null>;
  SCHICHT_FIX: string;
  LCOV_PATH: string;
  GIT_OPTIONEN: { encoding: string; maxBuffer: number };
  normalizePath: (p: string) => string;
  isMeasured: (path: string, quelle?: string) => boolean;
  parseDiffLines: (text: string) => Changed;
  parseLcov: (text: string) => Lcov;
  parseLcovBranches: (text: string) => Map<string, Map<number, { total: number; taken: number }>>;
  teilweiseGetestet: (
    changed: Changed,
    lcov: Lcov,
    branches: Map<string, Map<number, { total: number; taken: number }>>,
  ) => { path: string; line: number; taken: number; total: number }[];
  evaluateByLayer: (
    changed: Changed,
    lcov: Lcov,
    optionen?: { floors?: Record<string, number | null>; quelle?: string | Quellen; berichteJe?: Map<string, string[]> },
  ) => Verdict & { buckets: Record<string, Bucket & { files: { path: string; berichte: string[] }[] }> };
  pfadAngaben: (quellen: string | Quellen) => string[];
  fehlenderBerichtText: (fehlend: string[]) => string;
  ohneMessung: (r: Record<string, unknown>, o: { zeilen: Record<string, string>; quelle: string | Quellen; colors: Record<"red" | "green" | "dim", (s: string) => string> }) => number | null;
  messfehlerText: (r: Record<string, unknown>, red: (s: string) => string) => string | null;
  rotZeilen: (b: { files: { path: string; uncovered: number[]; berichte?: string[] }[] }) => string[];
  mehrdeutigText: (m: { pfad: string; schluessel: string; kandidaten: string[] }[]) => string;
  checkDiffCoverage: (opts: { quelle?: string | Quellen; berichte?: Bericht[]; rootDir?: string; runGit: RunGit; readFile?: (p: string) => string; env?: Env; zeilen?: Record<string, string> }) => Record<string, unknown>;
};

// Tooling-Skript ohne Declaration-File (scripts/ ist nicht im tsconfig-include). Der
// Namespace wird EINMAL auf die Oberfläche oben festgelegt, statt jeden Zugriff einzeln
// zu casten — sonst meldet der typbewusste Linter (#868) lauter no-unsafe-member-access.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkCovRaw from "../scripts/check-diffcoverage.mjs";

const {
  LAYER_DIFF_FLOORS,
  SCHICHT_FIX,
  LCOV_PATH,
  GIT_OPTIONEN,
  isMeasured,
  parseDiffLines,
  teilweiseGetestet,
  evaluateByLayer,
  pfadAngaben,
  fehlenderBerichtText,
  mehrdeutigText,
  messfehlerText,
  rotZeilen,
  ohneMessung,
  checkDiffCoverage: checkDiffCoverageRoh,
} = checkCovRaw as CheckDiffCoverageModule;
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as covRaw from "../scripts/coverage-berichte.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as relRaw from "../scripts/relativ-pfad.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
const { parseLcov, parseLcovBranches } = covRaw as unknown as Pick<CheckDiffCoverageModule, "parseLcov" | "parseLcovBranches">;
const { normalizePath } = relRaw as unknown as Pick<CheckDiffCoverageModule, "normalizePath">;
const { commitZeilen, commitZeilenAus } = sliceRaw as unknown as {
  commitZeilen: (praefix: string, planer: string) => Record<string, string>;
  commitZeilenAus: (config: unknown) => Record<string, string>;
};
/** Zeilen der Fremd-Config; ein anderes Präfix (AB-) darf deren Zeile nicht zählen lassen. */
const ZEILEN = commitZeilenAus(FREMD);
const ZEILEN_AB = commitZeilen("AB-", FREMD.agenten.planer);
/** Zeilen der echten Config: nur für den Standardpfad ohne injizierte Zeilen. */
const ECHT = commitZeilenAus(projektConfig());
/** Der Wächter mit den Zeilen der Fremd-Config; ein Test ohne eigene `zeilen` liest damit nie die echte Projekt-Config. */
const checkDiffCoverage = (o: Parameters<CheckDiffCoverageModule["checkDiffCoverage"]>[0]) => checkDiffCoverageRoh({ zeilen: ZEILEN, ...o });

/** Hängt an einen Fake-git einen Slice-Commit mit `line` als Message (Override-Trailer, #1269). */
function mitTrailer(runGit: RunGit, line: string): RunGit {
  return (args) => (args[0] === "log" ? `chore: bewusst

${line}
` : runGit(args));
}

/** Minimaler `git diff -U0`-Ausschnitt bzw. lcov-Block für eine Datei. */
function diffFor(path: string, hunks: string[]): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...hunks].join("\n");
}
function lcovFor(path: string, hits: Record<number, number>): string {
  return [`TN:`, `SF:${path}`, ...Object.entries(hits).map(([l, n]) => `DA:${l},${n}`), `end_of_record`].join("\n");
}

describe("Diff-Coverage: Git-Optionen (#97 L11j)", () => {
  test("maxBuffer ist mindestens 256 MiB, damit ein breiter Diff nicht an ENOBUFS scheitert", () => {
    assert.ok(GIT_OPTIONEN.maxBuffer >= 256 * 1024 * 1024);
    assert.equal(GIT_OPTIONEN.encoding, "utf8");
  });
  test("ohne runGit ruft der Standardweg git mit GIT_OPTIONEN auf (nicht nur {encoding})", () => {
    execFileSyncMock.mockReset();
    execFileSyncMock.mockImplementation((_cmd: string, args: string[]) => (args[0] === "diff" ? "" : "basesha"));
    checkDiffCoverage({ readFile: () => "", env: { FACTORY_DIFF_BASE: "basesha" } } as unknown as Parameters<typeof checkDiffCoverage>[0]);
    const aufrufe = execFileSyncMock.mock.calls as unknown[][];
    assert.ok(aufrufe.length > 0, "der Standardweg muss execFileSync nutzen");
    for (const [befehl, , optionen] of aufrufe) {
      assert.equal(befehl, "git");
      assert.deepEqual(optionen, GIT_OPTIONEN);
    }
    assert.ok(aufrufe.some(([, args]) => (args as string[])[0] === "diff"), "der Diff-Aufruf läuft über denselben Weg");
  });
});

describe("Diff-Coverage: Diff-Parsing", () => {
  test("Hunk-Header liefert genau die Zeilen der NEUEN Seite", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -1,0 +2,3 @@", "+a", "+b", "+c"]));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])], [2, 3, 4]);
  });

  test("Hunk ohne Zeilenzahl (`+5`) meint genau eine Zeile", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -5 +5 @@", "-alt", "+neu"]));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])], [5]);
  });

  test("reine Löschung (+c,0) fügt KEINE Zeile hinzu — sonst zählte gelöschter Code als ungetestet", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -10,3 +9,0 @@", "-weg", "-weg", "-weg"]));
    assert.equal(changed.has("src/sim/pods.ts"), false);
  });

  test("gelöschte Datei (+++ /dev/null) wird übersprungen", () => {
    const text = ["diff --git a/src/sim/alt.ts b/src/sim/alt.ts", "--- a/src/sim/alt.ts", "+++ /dev/null", "@@ -1,2 +0,0 @@", "-x", "-y"].join(
      "\n",
    );
    assert.equal(parseDiffLines(text).size, 0);
  });

  test("Windows-Backslash-Pfade werden auf POSIX normalisiert (sonst matcht der lcov-Pfad nie)", () => {
    const changed = parseDiffLines(
      ["diff --git a/src\\sim\\pods.ts b/src\\sim\\pods.ts", "--- a/src\\sim\\pods.ts", "+++ b/src\\sim\\pods.ts", "@@ -0,0 +1 @@", "+x"].join(
        "\n",
      ),
    );
    assert.equal(changed.has("src/sim/pods.ts"), true);
  });

  test("INHALTS-Zeilen, die wie Header aussehen, kapern den Datei-Pfad NICHT", () => {
    // Als Header gelesen, fielen die folgenden Hunks unter einem Phantom-Pfad still aus
    // der Messung. Der zweite Fall sieht sogar wie ein vollständiges Header-PAAR aus —
    // nur die Bindung an `diff --git` fängt ihn.
    const changed = parseDiffLines(
      diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+++ inhalt mit plus", "+b", "@@ -9,0 +30 @@", "+c"]),
    );
    assert.deepEqual([...changed.keys()], ["src/sim/pods.ts"]);
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])].sort((a, b) => a - b), [1, 2, 30]);

    const paar = parseDiffLines(
      diffFor("src/sim/pods.ts", ["@@ -20,1 +20,2 @@", "--- a/alt", "+++ b/phantom", "@@ -30,0 +40 @@", "+x"]),
    );
    assert.deepEqual([...paar.keys()], ["src/sim/pods.ts"]);
  });

  test("gelöschte Datei leckt nicht in die nächste (echter /dev/null-Fall mit folgendem Hunk)", () => {
    const changed = parseDiffLines(
      [
        "diff --git a/src/sim/alt.ts b/src/sim/alt.ts",
        "--- a/src/sim/alt.ts",
        "+++ /dev/null",
        "@@ -1,2 +1,2 @@", // count > 0: NUR die /dev/null-Abzweigung kann das verwerfen
        "-x",
        diffFor("src/sim/neu.ts", ["@@ -0,0 +1 @@", "+y"]),
      ].join("\n"),
    );
    assert.deepEqual([...changed.keys()], ["src/sim/neu.ts"]);
  });

  test("Umbenennung zählt den NEUEN Pfad, ein Binärdatei-Block leckt nicht in die Folgedatei", () => {
    const rename = parseDiffLines(
      ["diff --git a/src/sim/alt.ts b/src/sim/neu.ts", "--- a/src/sim/alt.ts", "+++ b/src/sim/neu.ts", "@@ -0,0 +1 @@", "+x"].join("\n"),
    );
    assert.deepEqual([...rename.keys()], ["src/sim/neu.ts"]);
    const binaer = parseDiffLines(
      ["diff --git a/a.png b/a.png", "Binary files a/a.png and b/a.png differ", diffFor("src/sim/p.ts", ["@@ -0,0 +1 @@", "+x"])].join("\n"),
    );
    assert.deepEqual([...binaer.keys()], ["src/sim/p.ts"]);
  });

  test("CRLF-Zeilenenden (Windows-git) werden verarbeitet", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -0,0 +1 @@", "+x"]).replace(/\n/g, "\r\n"));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])], [1]);
  });

  test("mehrere Hunks derselben Datei werden vereinigt", () => {
    const changed = parseDiffLines(diffFor("src/sim/pods.ts", ["@@ -0,0 +1,2 @@", "+a", "+b", "@@ -9,0 +20,1 @@", "+c"]));
    assert.deepEqual([...(changed.get("src/sim/pods.ts") ?? [])].sort((a, b) => a - b), [1, 2, 20]);
  });
});

describe("Diff-Coverage: lcov-Parsing", () => {
  test("DA-Records werden je Datei als Zeile→Treffer gelesen", () => {
    const lcov = parseLcov(lcovFor("src/sim/pods.ts", { 1: 3, 2: 0 }));
    assert.equal(lcov.get("src/sim/pods.ts")?.get(1), 3);
    assert.equal(lcov.get("src/sim/pods.ts")?.get(2), 0);
  });

  test("SF-Pfade mit Backslashes (v8-Reporter unter Windows) werden normalisiert", () => {
    const lcov = parseLcov(lcovFor("src\\sim\\pods.ts", { 1: 1 }));
    assert.equal(lcov.has("src/sim/pods.ts"), true);
  });

  test("mehrere Records bleiben getrennt", () => {
    const lcov = parseLcov([lcovFor("src/sim/a.ts", { 1: 1 }), lcovFor("src/sim/b.ts", { 1: 0 })].join("\n"));
    assert.equal(lcov.size, 2);
    assert.equal(lcov.get("src/sim/b.ts")?.get(1), 0);
  });

  test("kaputter Report: DA vor SF, leere und unparsbare DA-Zeilen werden verworfen statt zu werfen", () => {
    assert.deepEqual([...parseLcov("DA:1,1\nDA:2,0").keys()], []);
    const lcov = parseLcov(["TN:", "SF:src/sim/a.ts", "DA:", "DA:x,y", "DA:3,1", "end_of_record"].join("\n"));
    assert.deepEqual([...(lcov.get("src/sim/a.ts")?.keys() ?? [])], [3]);
    // DA ohne Trefferzahl gilt als UNgetestet — im Zweifel streng, nicht lasch.
    assert.equal(parseLcov(["SF:src/sim/b.ts", "DA:3", "end_of_record"].join("\n")).get("src/sim/b.ts")?.get(3), 0);
    assert.equal(parseLcov("").size, 0); // leerer Report: leere Abbildung, kein Absturz
  });

  test("fehlendes end_of_record vermischt zwei Dateien nicht (SF: schaltet um)", () => {
    const lcov = parseLcov(["SF:src/sim/a.ts", "DA:1,1", "SF:src/sim/b.ts", "DA:2,0"].join("\n"));
    assert.deepEqual([...(lcov.get("src/sim/a.ts")?.keys() ?? [])], [1]);
    assert.deepEqual([...(lcov.get("src/sim/b.ts")?.keys() ?? [])], [2]);
  });

});

describe("Diff-Coverage: Zweig-Sicht, nur berichtend (#1425)", () => {
  const P = `${Q}/sim/argocd.ts`;
  const lcov = (da: Record<number, number>, brda: string[]) =>
    [`SF:${P}`, ...Object.entries(da).map(([l, n]) => `DA:${l},${n}`), ...brda, `end_of_record`].join("\n");

  test("BRDA: `-` und 0 sind ungenommen, n > 0 genommen; kaputte Records und Windows-Pfade stören nicht", () => {
    const text = [
      lcov({ 5: 3 }, ["BRDA:5,0,0,2", "BRDA:5,0,1,-", "BRDA:5,1,0,0", "BRDA:kaputt", "BRDA:5,0,0", "BRDA:x,0,0,1"]),
      `SF:${Q}\\sim\\x.ts`,
      "BRDA:9,0,0,1",
      "end_of_record",
    ].join("\n");
    const b = parseLcovBranches(text);
    assert.deepEqual(b.get(P)?.get(5), { total: 3, taken: 1 });
    assert.deepEqual(b.get(`${Q}/sim/x.ts`)?.get(9), { total: 1, taken: 1 });
    assert.equal(b.get(P)?.size, 1);
  });

  test("BRDA außerhalb eines SF-Blocks (vor dem ersten SF und nach end_of_record) wird ignoriert", () => {
    assert.equal(parseLcovBranches("BRDA:1,0,0,1").size, 0);
    const b = parseLcovBranches([`SF:${Q}/a.ts`, "BRDA:1,0,0,1", "end_of_record", "BRDA:2,0,0,1"].join("\n"));
    assert.deepEqual([...(b.get(`${Q}/a.ts`)?.keys() ?? [])], [1]);
  });

  test("meldet geänderte, ausgeführte Zeile mit ungenommenem Zweig", () => {
    const text = lcov({ 7: 4 }, ["BRDA:7,0,0,4", "BRDA:7,0,1,0"]);
    const r = teilweiseGetestet(new Map([[P, new Set([7])]]), parseLcov(text), parseLcovBranches(text));
    assert.deepEqual(r, [{ path: P, line: 7, taken: 1, total: 2 }]);
  });

  test("meldet NICHT: ungeänderte Zeile, nicht ausgeführte Zeile (DA 0), alle Zweige genommen, .d.ts, außerhalb der Quellwurzel", () => {
    const text = [
      lcov({ 7: 4, 8: 0, 9: 2 }, ["BRDA:7,0,0,4", "BRDA:7,0,1,0", "BRDA:8,0,0,0", "BRDA:9,0,0,1", "BRDA:9,0,1,1"]),
      `SF:${Q}/t.d.ts`,
      "DA:1,1",
      "BRDA:1,0,0,0",
      "end_of_record",
      "SF:außerhalb/x.mjs",
      "DA:1,1",
      "BRDA:1,0,0,0",
      "end_of_record",
    ].join("\n");
    const changed: Changed = new Map([
      [P, new Set([8, 9])], // Zeile 7 nicht geändert
      [`${Q}/t.d.ts`, new Set([1])],
      ["außerhalb/x.mjs", new Set([1])],
    ]);
    assert.deepEqual(teilweiseGetestet(changed, parseLcov(text), parseLcovBranches(text)), []);
  });

  test("Ende-zu-Ende: `partial` im Ergebnis, `failed` bleibt unberührt", () => {
    const text = lcov({ 1: 2 }, ["BRDA:1,0,0,2", "BRDA:1,0,1,0"]).replace(P, `${Q}/sim/pods.ts`);
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      readFile: () => text,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, false);
    assert.deepEqual(r.partial, [{ path: `${Q}/sim/pods.ts`, line: 1, taken: 1, total: 2 }]);
  });
});

describe("Diff-Coverage: Bewertung pro Schicht", () => {
  test("ungetestete Domänen-Zeile drückt den Bucket unter den Floor (rot)", () => {
    const changed = new Map([[`${Q}/sim/pods.ts`, new Set([1, 2, 3, 4, 5])]]);
    const lcov = new Map([[`${Q}/sim/pods.ts`, new Map([[1, 2], [2, 1], [3, 1], [4, 1], [5, 0]])]]);
    const v = evaluateByLayer(changed, lcov);
    assert.equal(v.buckets["domaene"].covered, 4);
    assert.equal(v.buckets["domaene"].total, 5);
    assert.equal(v.below.includes("domaene"), true);
  });

  test("Alter Aufruf mit einer Floor-Map als drittem Argument wirft TypeError, statt die Floors still zu ignorieren (L14)", () => {
    const pfad = `${Q}/sim/pods.ts`;
    const changed = new Map([[pfad, new Set([1, 2])]]);
    const lcov = new Map([[pfad, new Map([[1, 1], [2, 0]])]]);
    const alt = { domaene: 50 } as unknown as Parameters<typeof evaluateByLayer>[2];
    assert.throws(() => evaluateByLayer(changed, lcov, alt), (e: Error) => e instanceof TypeError && /domaene/.test(e.message) && /floors/.test(e.message));
    const mehrere = { floors: { domaene: 50 }, zusatz: 1, anders: 2 } as unknown as Parameters<typeof evaluateByLayer>[2];
    assert.throws(() => evaluateByLayer(changed, lcov, mehrere), /zusatz, anders/);
    assert.doesNotThrow(() => evaluateByLayer(changed, lcov, { floors: { domaene: 50 }, quelle: Q, berichteJe: new Map() }));
    assert.doesNotThrow(() => evaluateByLayer(changed, lcov, {}));
  });

  test("Optionsobjekt: floors überschreibt den Floor der Schicht, berichteJe nennt die Berichte der Datei (factory#220 L47)", () => {
    const pfad = `${Q}/sim/pods.ts`;
    const changed = new Map([[pfad, new Set([1, 2])]]);
    const lcov = new Map([[pfad, new Map([[1, 1], [2, 0]])]]);
    assert.equal(evaluateByLayer(changed, lcov).below.includes("domaene"), true, "mit dem Standard-Floor rot");
    const v = evaluateByLayer(changed, lcov, { floors: { domaene: 50 }, berichteJe: new Map([[pfad, ["a/lcov.info"]]]) });
    assert.equal(v.buckets["domaene"].floor, 50);
    assert.deepEqual(v.below, []);
    assert.deepEqual(v.buckets["domaene"].files.map((f) => f.berichte), [["a/lcov.info"]]);
    assert.deepEqual(evaluateByLayer(changed, lcov).buckets["domaene"].files.map((f) => f.berichte), [[]]);
  });

  test("Gegenprobe: dieselben Zeilen MIT Treffern sind grün (der Test misst wirklich Coverage)", () => {
    const changed = new Map([[`${Q}/sim/pods.ts`, new Set([1, 2, 3, 4, 5])]]);
    const lcov = new Map([[`${Q}/sim/pods.ts`, new Map([[1, 2], [2, 1], [3, 1], [4, 1], [5, 1]])]]);
    assert.deepEqual(evaluateByLayer(changed, lcov).below, []);
  });

  test("dieselbe ungetestete Zeile in der PRÄSENTATION ist NICHT rot (Grafik/DOM ist unit-untestbar)", () => {
    const changed = new Map([[PRAES, new Set([1, 2, 3, 4, 5])]]);
    const lcov = new Map([[PRAES, new Map([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]])]]);
    const v = evaluateByLayer(changed, lcov);
    assert.equal(v.buckets["praesentation"].total, 5);
    assert.equal(v.buckets["praesentation"].covered, 0);
    assert.deepEqual(v.below, []);
  });

  test("Zeilen ohne DA-Record (Kommentar/Typ/Leerzeile) zählen NICHT in den Nenner", () => {
    const changed = new Map([[`${Q}/sim/pods.ts`, new Set([1, 2, 3])]]);
    const lcov = new Map([[`${Q}/sim/pods.ts`, new Map([[2, 1]])]]);
    const v = evaluateByLayer(changed, lcov);
    assert.equal(v.buckets["domaene"].total, 1);
    assert.equal(v.buckets["domaene"].covered, 1);
  });

  test("geänderte src-Datei ohne lcov-Record wird gemeldet statt still übersprungen (Gaming-Vektor)", () => {
    const changed = new Map([[`${Q}/sim/neu.ts`, new Set([1])]]);
    const v = evaluateByLayer(changed, new Map());
    assert.deepEqual(v.missing, [`${Q}/sim/neu.ts`]);
  });

  test("Nicht-.ts unter src (Content-JSON) fällt aus der Messung — kein ausführbarer Code", () => {
    const changed = new Map([[`${Q}/content/data/quests/ole.json`, new Set([1, 2])]]);
    const v = evaluateByLayer(changed, new Map());
    assert.deepEqual(v.missing, []);
    assert.equal(v.buckets["domaene"].total, 0);
  });

  test("leerer Bucket ist nie rot (keine Division durch null)", () => {
    const v = evaluateByLayer(new Map(), new Map());
    assert.deepEqual(v.below, []);
    assert.equal(v.buckets["domaene"].total, 0);
  });

  test("Anwendungs-Bucket hat einen eigenen, niedrigeren Floor als die Domäne", () => {
    const changed = new Map([[ANW, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]]);
    // 85 % — unter dem Domänen-Floor (90), über dem Anwendungs-Floor (80).
    const hits = new Map<number, number>();
    for (let i = 1; i <= 10; i++) hits.set(i, i <= 8 ? 1 : 0);
    const v = evaluateByLayer(changed, new Map([[ANW, hits]]));
    assert.equal(v.buckets["anwendung"].pct, 80);
    assert.deepEqual(v.below, []);
  });
});

describe("Diff-Coverage: Floors + Override (Ratchet-Disziplin)", () => {
  test("Floors sind festgeschrieben: Domäne 90, Anwendung 80, Präsentation/Einstieg nur berichtend", () => {
    assert.equal(LAYER_DIFF_FLOORS["domaene"], 90);
    assert.equal(LAYER_DIFF_FLOORS["anwendung"], 80);
    assert.equal(LAYER_DIFF_FLOORS["praesentation"], null);
    assert.equal(LAYER_DIFF_FLOORS["einstieg"], null);
  });

  test("JEDE Schicht der SSOT hat einen Floor-Eintrag — eine neue Schicht fällt nicht still in 'berichtend'", () => {
    assert.deepEqual(Object.keys(LAYER_DIFF_FLOORS).sort(), [...Object.values(LAYERS)].sort());
  });

  test("Erzeuger-Vertrag: vite.config.ts schreibt das lcov, das dieser Wächter liest", () => {
    // Ohne diese Bindung könnte der `lcovonly`-Reporter entfernt werden, ohne dass ein
    // Test rot wird — das Gate liefe dann in der CI auf „noReport" statt zu messen.
    const viteConfig = readFileSync(fileURLToPath(new URL("../vite.config.ts", import.meta.url)), "utf8");
    assert.match(viteConfig, /reporter:\s*\[[^\]]*"lcovonly"/);
    assert.match(viteConfig, /reportsDirectory:\s*"coverage"/);
    assert.equal(normalizePath(LCOV_PATH).endsWith("coverage/lcov.info"), true);
  });

  test("Typdeklarationen (.d.ts) fallen aus der Messung — sie enthalten keine ausführbare Zeile", () => {
    assert.equal(isMeasured(`${Q}/vite-env.d.ts`), false);
    assert.equal(isMeasured(`${Q}/sim/pods.ts`), true);
    assert.equal(isMeasured("außerhalb/check-size.mjs"), false);
  });

  test("#1942: auch .mts, .mjs, .cjs und .js unter der Quellwurzel sind Gegenstand der Messung (Factory-Repo: Quellwurzel scripts), Typdeklarationen und Daten nicht", () => {
    for (const endung of ["ts", "mts", "mjs", "cjs", "js"]) assert.equal(isMeasured(`scripts/x.${endung}`, "scripts"), true, endung);
    for (const nein of ["scripts/x.d.ts", "scripts/x.d.mts", "scripts/x.d.cts", "scripts/x.json", "scripts/x.md", "scripts/x.mjs.map", "test/x.mjs", "scriptsx/y.mjs"]) assert.equal(isMeasured(nein, "scripts"), false, nein);
    assert.equal(isMeasured("außerhalb/check-size.mjs"), false, "ein Skript außerhalb der Quellwurzel bleibt außerhalb");
  });

  test("eigener Override-Schlüssel (#1269): ein Diffsize-Trailer gilt hier nicht", () => {
    assert.equal(ZEILEN.diffcovOverride, `${FREMD.praefixe.commitZeile}Diffcov-Override`);
    const runGit = mitTrailer(
      (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      `${ZEILEN.diffsizeOverride}: #1021 falsches Gate`,
    );
    const r = checkDiffCoverage({ runGit, readFile: () => lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 0 }), env: { FACTORY_DIFF_BASE: "basesha" } });
    assert.equal(r.allowed, false);
    assert.equal(r.failed, true);
  });

  test("versetzte Override-Zeilen (#1390 Z7): mit Strich oder eingerückt zählen nicht, werden aber gemeldet; eine gültige daneben wirkt", () => {
    const basis: RunGit = (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha");
    const readFile = () => lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 0 });
    const env = { FACTORY_DIFF_BASE: "basesha" };
    const versetzt = [`- ${ZEILEN.diffcovOverride}: #1390 mit Strich`, `  ${ZEILEN.diffcovOverride}: #1390 eingerückt`];
    const r = checkDiffCoverage({ runGit: mitTrailer(basis, versetzt.join("\n")), readFile, env });
    assert.equal(r.allowed, false, "die versetzten Zeilen zählen nicht als Override");
    assert.equal(r.failed, true);
    assert.deepEqual(r.versetzteOverrides, [`- ${ZEILEN.diffcovOverride}: #1390 mit Strich`, `${ZEILEN.diffcovOverride}: #1390 eingerückt`]);
    const gueltig = `${ZEILEN.diffcovOverride}: #1390 bewusst`;
    const beides = checkDiffCoverage({ runGit: mitTrailer(basis, `${versetzt.join("\n")}\n${gueltig}`), readFile, env });
    assert.equal(beides.allowed, true);
    assert.equal(beides.failed, false);
    assert.deepEqual(checkDiffCoverage({ runGit: mitTrailer(basis, gueltig), readFile, env }).versetzteOverrides, []);
  });
});

describe("Diff-Coverage: Ende-zu-Ende mit injizierter IO", () => {
  const lcovOk = lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 1 });

  test("keine auflösbare Basis (flacher Checkout) → No-op-grün, statt main rot zu machen", () => {
    const r = checkDiffCoverage({
      runGit: () => {
        throw new Error("kein origin/main");
      },
      readFile: () => lcovOk,
      env: {},
    });
    assert.equal(r.skipped, true);
  });

  test("Diff sprengt den Puffer (ENOBUFS) → ROT 'Diff nicht lesbar', nicht still grün (#78 L3a)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => {
        if (args[0] !== "diff") return "basesha";
        throw Object.assign(new Error("spawnSync git ENOBUFS"), { code: "ENOBUFS" });
      },
      readFile: () => lcovOk,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, true);
    assert.equal(r.skipped, false);
    assert.equal(r.diffUnlesbar, true);
  });

  test("anderer Diff-Fehler (flacher Checkout, Basis fehlt) bleibt No-op-grün (#78 L3a)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => {
        if (args[0] !== "diff") return "basesha";
        throw Object.assign(new Error("bad revision"), { code: "128" });
      },
      readFile: () => lcovOk,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, false);
    assert.equal(r.skipped, true);
  });

  test("fehlendes lcov → ROT mit Hinweis, nicht still grün (ein Gate, das nichts gemessen hat)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      readFile: () => {
        throw new Error("ENOENT");
      },
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.skipped, false);
    assert.equal(r.noReport, true);
    assert.equal(r.failed, true); // die Leitregel: nichts gemessen ⇒ niemals grün
  });

  test("Präfix aus der Config (#1741): mit AB- zählt die Override-Zeile der Fremd-Config nicht, die AB-Zeile schon", () => {
    const runGit: RunGit = (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha");
    const readFile = () => lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 0 });
    const env = { FACTORY_DIFF_BASE: "basesha" };
    const fremd = checkDiffCoverage({ runGit: mitTrailer(runGit, `${ZEILEN.diffcovOverride}: #1021 bewusst`), readFile, env, zeilen: ZEILEN_AB });
    assert.equal(fremd.failed, true, "die Zeile der Fremd-Config zählt bei AB- nicht");
    const ab = checkDiffCoverage({ runGit: mitTrailer(runGit, "AB-Diffcov-Override: #1021 bewusst"), readFile, env, zeilen: ZEILEN_AB });
    assert.equal(ab.failed, false);
  });

  test("Standardpfad: ohne injizierte `zeilen` liest der Wächter die Projekt-Config", () => {
    const runGit: RunGit = (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha");
    const readFile = () => lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 0 });
    const env = { FACTORY_DIFF_BASE: "basesha" };
    const echt = checkDiffCoverageRoh({ runGit: mitTrailer(runGit, `${ECHT.diffcovOverride}: #1021 bewusst`), readFile, env });
    assert.equal(echt.failed, false, "die Zeile des echten Präfixes lässt den Slice durch");
    const ohne = checkDiffCoverageRoh({ runGit, readFile, env });
    assert.equal(ohne.failed, true);
  });

  test("ungetesteter Domänen-Slice → rot; Override mit Begründung lässt ihn bewusst durch", () => {
    const runGit: RunGit = (args) =>
      args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha";
    const readFile = () => lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 0 });
    const rot = checkDiffCoverage({ runGit, readFile, env: { FACTORY_DIFF_BASE: "basesha" } });
    assert.equal(rot.failed, true);
    const geduldet = checkDiffCoverage({
      runGit: mitTrailer(runGit, `${ZEILEN.diffcovOverride}: #1021 bewusst`),
      readFile,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(geduldet.failed, false);
    assert.equal(geduldet.allowed, true);
    assert.equal(geduldet.reason, "#1021 bewusst");
  });

  test("ungültige Override-Zeile (ohne #<nr>) lässt nichts durch und wird gemeldet", () => {
    const r = checkDiffCoverage({
      runGit: mitTrailer(
        (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
        `${ZEILEN.diffcovOverride}: einfach so`,
      ),
      readFile: () => lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 0 }),
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.allowed, false);
    assert.deepEqual(r.invalidOverrides, [`${ZEILEN.diffcovOverride}: einfach so`]);
  });

  test("gesetztes Override bei grünem Slice wird als STALE gemeldet (rot)", () => {
    const r = checkDiffCoverage({
      runGit: mitTrailer(
        (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
        `${ZEILEN.diffcovOverride}: #1021 unnötig`,
      ),
      readFile: () => lcovOk,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.stale, true);
    assert.equal(r.failed, true);
  });

  test("geänderte src-Datei fehlt im Report → ROT (Anti-Gaming: Code verstecken)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/versteckt.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      readFile: () => lcovFor(`${Q}/sim/andere.ts`, { 1: 1 }),
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, true);
    assert.deepEqual(r.missing, [`${Q}/sim/versteckt.ts`]);
  });

  test("ein Messfehler (missing) ist NICHT über das Override abkürzbar — nur neu messen hilft", () => {
    const r = checkDiffCoverage({
      runGit: mitTrailer(
        (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/versteckt.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
        `${ZEILEN.diffcovOverride}: #1021 durchwinken`,
      ),
      readFile: () => lcovFor(`${Q}/sim/andere.ts`, { 1: 1 }),
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, true);
    assert.equal(r.allowed, false);
    // ... und das Override gilt dabei NICHT als stale (es gibt ja ein echtes Problem).
    assert.equal(r.stale, false);
  });

  test("below UND missing zugleich: beide werden gemeldet, der Lauf ist rot", () => {
    const runGit: RunGit = (args) =>
      args[0] === "diff"
        ? [
            diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]),
            diffFor(`${Q}/sim/versteckt.ts`, ["@@ -0,0 +1 @@", "+z"]),
          ].join("\n")
        : "basesha";
    const r = checkDiffCoverage({
      runGit,
      readFile: () => lcovFor(`${Q}/sim/pods.ts`, { 1: 1, 2: 0 }),
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, true);
    assert.deepEqual(r.below, ["domaene"]);
    assert.deepEqual(r.missing, [`${Q}/sim/versteckt.ts`]);
  });

  test("reiner Doku-/Tooling-Slice braucht KEINEN Coverage-Report (grün statt rot)", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor("docs/agent-harness.md", ["@@ -0,0 +1 @@", "+text"]) : "basesha"),
      readFile: () => {
        throw new Error("ENOENT — es gab nichts zu messen");
      },
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, false);
    assert.equal(r.nothingToMeasure, true);
  });

  test("Doku-Slice mit dem Diffcov-Override ist stale → rot (#1309); ohne Trailer bleibt er grün", () => {
    const runGit: RunGit = (args) => (args[0] === "diff" ? diffFor("docs/agent-harness.md", ["@@ -0,0 +1 @@", "+text"]) : "basesha");
    const lesen = () => {
      throw new Error("ENOENT");
    };
    const r = checkDiffCoverage({ runGit: mitTrailer(runGit, `${ZEILEN.diffcovOverride}: #1021 unnötig`), readFile: lesen, env: { FACTORY_DIFF_BASE: "basesha" } });
    assert.equal(r.nothingToMeasure, true);
    assert.equal(r.stale, true);
    assert.equal(r.failed, true, "nichts zu messen heißt nichts durchzulassen: der Trailer ist überflüssig");
    const ohne = checkDiffCoverage({ runGit, readFile: lesen, env: { FACTORY_DIFF_BASE: "basesha" } });
    assert.equal(ohne.failed, false);
    const fremd = checkDiffCoverage({ runGit: mitTrailer(runGit, `${ZEILEN.diffsizeOverride}: #1021 anderes Gate`), readFile: lesen, env: { FACTORY_DIFF_BASE: "basesha" } });
    assert.equal(fremd.failed, false, "ein fremder Schlüssel macht diesen Slice nicht stale");
  });

  test("nicht messbarer Diff (git wirft trotz Basis) degradiert zu grün, statt main rot zu machen", () => {
    const r = checkDiffCoverage({
      runGit: (args) => {
        if (args[0] === "diff") throw new Error("bad revision");
        return "basesha";
      },
      readFile: () => lcovOk,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.skipped, true);
    assert.equal(r.failed, false);
  });

  test("gemessen wird der EIGENE Slice (Drei-Punkt gegen die Merge-Base), nicht base..HEAD", () => {
    // Sonst zählen Änderungen, die main NACH dem Abzweigen bekam, als Additionen
    // dieses Slices — fremder Code im Nenner, potenziell falsches Rot.
    const gesehen: string[][] = [];
    checkDiffCoverage({
      runGit: (args) => {
        gesehen.push(args);
        return args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha";
      },
      readFile: () => lcovOk,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    // Pinnt zugleich `-U0` (Kontextzeilen zählten sonst als geändert mit) und den Scope.
    assert.deepEqual(gesehen.find((a) => a[0] === "diff"), ["diff", "-U0", "basesha...HEAD", "--", Q]);
  });

  test("vollständig getesteter Slice ist grün", () => {
    const r = checkDiffCoverage({
      runGit: (args) => (args[0] === "diff" ? diffFor(`${Q}/sim/pods.ts`, ["@@ -0,0 +1,2 @@", "+x", "+y"]) : "basesha"),
      readFile: () => lcovOk,
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.failed, false);
    assert.equal(r.skipped, false);
  });
});

describe("Diff-Coverage: Quellwurzel aus der Struktur-Config (#1860)", () => {
  test("isMeasured misst nur unter der übergebenen Quellwurzel, mit Segmentgrenze", () => {
    assert.equal(isMeasured("lib/a.ts", "lib"), true);
    assert.equal(isMeasured("lib/sub/a.ts", "lib"), true);
    assert.equal(isMeasured(`${Q}/a.ts`, "lib"), false);
    assert.equal(isMeasured("library/a.ts", "lib"), false);
    assert.equal(isMeasured("lib/a.d.ts", "lib"), false);
    assert.equal(isMeasured("lib/a.mjs", "lib"), true);
  });
  test("ohne Angabe gilt struktur.quelle der Projekt-Config", () => {
    assert.equal(isMeasured(`${Q}/sim/pods.ts`), true);
    assert.equal(isMeasured("lib/a.ts"), false);
  });
  test("checkDiffCoverage fragt den Diff mit der übergebenen Quellwurzel ab und misst dort", () => {
    const calls: string[][] = [];
    const r = checkDiffCoverage({
      quelle: "lib",
      runGit: (args) => {
        calls.push(args);
        return args[0] === "diff" ? diffFor("lib/a.ts", ["@@ -0,0 +1 @@", "+x"]) : "basesha";
      },
      readFile: () => "TN:\nSF:lib/a.ts\nDA:1,0\nend_of_record\n",
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(calls.find((a) => a[0] === "diff")?.at(-1), "lib");
    assert.equal(r.nothingToMeasure, undefined);
    assert.equal(r.missing && (r.missing as string[]).length, 0);
  });
  test("checkDiffCoverage gibt die Quellwurzel an die Bewertung weiter: die Zeile unter lib zählt, nicht grün ohne Messung", () => {
    const r = checkDiffCoverage({
      quelle: "lib",
      runGit: (args) => (args[0] === "diff" ? diffFor("lib/a.ts", ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      readFile: () => "TN:\nSF:lib/a.ts\nDA:1,0\nend_of_record\n",
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    const buckets = Object.values(r.buckets as Record<string, { total: number; covered: number }>);
    assert.equal(buckets.reduce((s, b) => s + b.total, 0), 1);
    assert.equal(buckets.reduce((s, b) => s + b.covered, 0), 0);
  });
  test("checkDiffCoverage meldet einen ungenommenen Zweig unter der übergebenen Quellwurzel", () => {
    const r = checkDiffCoverage({
      quelle: "lib",
      runGit: (args) => (args[0] === "diff" ? diffFor("lib/a.ts", ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      readFile: () => "TN:\nSF:lib/a.ts\nDA:1,1\nBRDA:1,0,0,1\nBRDA:1,0,1,0\nend_of_record\n",
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.deepEqual(r.partial, [{ path: "lib/a.ts", line: 1, taken: 1, total: 2 }]);
  });
  test("Änderung nur unter src ist bei quelle=lib nichts zu messen", () => {
    const r = checkDiffCoverage({
      quelle: "lib",
      runGit: (args) => (args[0] === "diff" ? diffFor(`${Q}/a.ts`, ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      env: { FACTORY_DIFF_BASE: "basesha" },
    });
    assert.equal(r.nothingToMeasure, true);
  });
});

describe("Diff-Coverage über mehrere Berichte und Quellwurzeln (factory#185)", () => {
  const { layerOf } = requireCjs("../scripts/layers.cjs") as { layerOf: (p: string) => string };
  const JAVA: Quellen = { wurzeln: ["*/src/main/java"], endungen: [".java"] };
  const XML = readFileSync(fileURLToPath(new URL("./fixtures/jacoco/jacoco.xml", import.meta.url)), "utf8");
  const JACOCO: Bericht[] = [{ format: "jacoco", pfad: "*/target/site/jacoco/jacoco.xml" }];
  const PFAD_A = "modul-a/src/main/java/de/beispiel/Rechner.java";
  const PFAD_B = "modul-b/src/main/java/de/beispiel/Rechner.java";
  const ENV = { FACTORY_DIFF_BASE: "basesha" };
  const baum = (extra: Record<string, string> = {}): string => fixture({ "modul-a/target/site/jacoco/jacoco.xml": XML, [PFAD_A]: "x", ...extra });
  /** Ein Diff, der die genannten Zeilen von `pfad` als neu ausweist. */
  const diffZeilen = (pfad: string, zeilen: number[]): string => diffFor(pfad, zeilen.flatMap((z) => [`@@ -0,0 +${z} @@`, "+x"]));
  const lauf = (o: { zeilen: number[]; pfad?: string; extra?: Record<string, string>; berichte?: Bericht[]; quelle?: string | Quellen; trailer?: string }) => {
    const pfad = o.pfad ?? PFAD_A;
    const basis: RunGit = (args) => (args[0] === "diff" ? diffZeilen(pfad, o.zeilen) : "basesha");
    return checkDiffCoverage({
      quelle: o.quelle ?? JAVA,
      berichte: o.berichte ?? JACOCO,
      rootDir: baum(o.extra),
      runGit: o.trailer === undefined ? basis : mitTrailer(basis, o.trailer),
      env: ENV,
    });
  };

  test("Vorbedingung: die Java-Datei fällt in eine Schicht mit Floor (sonst wäre der Rot-Test vakuös)", () => {
    assert.notEqual(LAYER_DIFF_FLOORS[layerOf(PFAD_A)], null);
  });
  test("eine ungedeckte geänderte Zeile in einer .java-Datei (JaCoCo-Fixture) ist rot und nennt die Schicht", () => {
    const r = lauf({ zeilen: [5] });
    assert.equal(r.failed, true);
    assert.deepEqual(r.below, [layerOf(PFAD_A)]);
    const bucket = (r.buckets as Record<string, { files: { path: string; uncovered: number[] }[] }>)[layerOf(PFAD_A)];
    assert.deepEqual(bucket.files, [{ path: PFAD_A, total: 1, covered: 0, uncovered: [5], berichte: ["modul-a/target/site/jacoco/jacoco.xml"] }]);
  });
  test("eine gedeckte Zeile ist grün, ein Zweig mit cb < mb+cb steht unter „teilweise getestet“", () => {
    const gedeckt = lauf({ zeilen: [3] });
    assert.equal(gedeckt.failed, false);
    const teil = lauf({ zeilen: [7] });
    assert.equal(teil.failed, false);
    assert.deepEqual(teil.partial, [{ path: PFAD_A, line: 7, taken: 1, total: 2 }]);
  });
  test("eine Zeile ohne <line> im Bericht (Kommentar, Leerzeile) zählt nicht", () => {
    const r = lauf({ zeilen: [4] });
    assert.equal(r.failed, false);
    assert.deepEqual(r.partial, []);
  });
  test("ein mehrdeutiger JaCoCo-Pfad (zwei Module, derselbe Schlüssel) ist rot, nennt beide Kandidaten und lässt sich nicht per Override durchwinken", () => {
    const extra = { [PFAD_B]: "y" };
    const rot = lauf({ zeilen: [3], extra });
    assert.equal(rot.failed, true);
    const m = rot.mehrdeutig as { pfad: string; schluessel: string; kandidaten: string[] }[];
    assert.equal(m.length, 1);
    assert.equal(m[0].schluessel, "de/beispiel/Rechner.java");
    assert.deepEqual(m[0].kandidaten, [PFAD_A, PFAD_B]);
    assert.deepEqual(rot.missing, []);
    const mitOverride = lauf({ zeilen: [3], extra, trailer: `${ZEILEN.diffcovOverride}: #185 bewusst` });
    assert.equal(mitOverride.failed, true);
    assert.equal(mitOverride.stale, false);
  });
  test("mehrdeutigText nennt Pfad, Schlüssel, Kandidaten und den Fix", () => {
    const t = mehrdeutigText([{ pfad: PFAD_A, schluessel: "de/beispiel/Rechner.java", kandidaten: [PFAD_A, PFAD_B] }]);
    assert.match(t, /de\/beispiel\/Rechner\.java[\s\S]*modul-b/);
    assert.match(t, /Fix: [^\n]*struktur\.quelle/);
  });
  test("ohneMessung: nichts zu messen grün (mit Wurzeln und Endungen im Text), stale rot, Diff nicht lesbar rot, sonst null", () => {
    const aus: string[] = [];
    const log = vi.spyOn(console, "log").mockImplementation((s: string) => void aus.push(s));
    const err = vi.spyOn(console, "error").mockImplementation((s: string) => void aus.push(s));
    try {
      const id = (s: string): string => s;
      const o = { zeilen: ZEILEN, quelle: JAVA, colors: { red: id, green: id, dim: id } };
      assert.equal(ohneMessung({ nothingToMeasure: true, stale: false, invalidOverrides: [] }, o), 0);
      assert.match(aus.join("\n"), /ok — dieser Slice ändert keinen gemessenen Quellcode \(Wurzeln: \*\/src\/main\/java; Endungen: \.java\)/);
      assert.equal(ohneMessung({ nothingToMeasure: true, stale: true, reason: "x", invalidOverrides: [] }, o), 1);
      assert.equal(ohneMessung({ diffUnlesbar: true }, o), 1);
      assert.match(aus.join("\n"), /Diff nicht lesbar/);
      assert.equal(ohneMessung({}, o), null);
    } finally {
      log.mockRestore();
      err.mockRestore();
    }
  });
  test("messfehlerText unterscheidet fehlenden Bericht, fehlende Datei im Bericht und mehrdeutigen Pfad; ohne Messfehler gibt es null", () => {
    const rot = (s: string): string => s;
    const leer = { noReport: false, missing: [], mehrdeutig: [] };
    assert.equal(messfehlerText(leer, rot), null);
    assert.match(messfehlerText({ ...leer, noReport: true, fehlendeBerichte: ["a/jacoco.xml"] }, rot) ?? "", /Kein Coverage-Bericht[\s\S]*Erwartet: a\/jacoco\.xml[\s\S]*gate-befehl\.mjs coverage/);
    assert.match(messfehlerText({ ...leer, missing: ["x/A.java"] }, rot) ?? "", /fehlen im Coverage-Bericht:\n {4}x\/A\.java[\s\S]*gate-befehl\.mjs coverage/);
    assert.match(messfehlerText({ ...leer, mehrdeutig: [{ pfad: PFAD_A, schluessel: "k", kandidaten: [PFAD_A, PFAD_B] }] }, rot) ?? "", /mehrdeutigem JaCoCo-Pfad[\s\S]*Fix:/);
  });
  test("ein fehlender Bericht (Glob ohne Treffer) ist noReport und nennt das Muster; der Text nennt den Befehl", () => {
    const rootDir = fixture({ [PFAD_A]: "x" });
    const r = checkDiffCoverage({ quelle: JAVA, berichte: JACOCO, rootDir, runGit: (a) => (a[0] === "diff" ? diffZeilen(PFAD_A, [5]) : "basesha"), env: ENV });
    assert.equal(r.failed, true);
    assert.equal(r.noReport, true);
    assert.deepEqual(r.fehlendeBerichte, ["*/target/site/jacoco/jacoco.xml"]);
    const text = fehlenderBerichtText(r.fehlendeBerichte);
    assert.match(text, /Erwartet: \*\/target\/site\/jacoco\/jacoco\.xml/);
    assert.match(text, /node scripts\/gate-befehl\.mjs coverage/);
  });
  test("jeder konfigurierte Bericht ist Pflicht: ein vorhandener lcov rettet einen fehlenden JaCoCo-Bericht nicht", () => {
    const rootDir = fixture({ "coverage/lcov.info": "SF:x.ts\nDA:1,1\nend_of_record\n", [PFAD_A]: "x" });
    const berichte = [{ format: "lcov", pfad: "coverage/lcov.info" }, ...JACOCO];
    const r = checkDiffCoverage({ quelle: JAVA, berichte, rootDir, runGit: (a) => (a[0] === "diff" ? diffZeilen(PFAD_A, [3]) : "basesha"), env: ENV });
    assert.equal(r.noReport, true);
    assert.deepEqual(r.fehlendeBerichte, ["*/target/site/jacoco/jacoco.xml"]);
  });
  test("lcov mit basis frontend misst frontend/src/a.ts; ohne basis fehlt die Datei im Bericht", () => {
    const rootDir = fixture({ "coverage/lcov.info": "SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n" });
    const quelle = { wurzeln: ["frontend/src"], endungen: [".ts"] };
    const runGit: RunGit = (a) => (a[0] === "diff" ? diffFor("frontend/src/a.ts", ["@@ -0,0 +1 @@", "+x"]) : "basesha");
    const mit = checkDiffCoverage({ quelle, berichte: [{ format: "lcov", pfad: "coverage/lcov.info", basis: "frontend" }], rootDir, runGit, env: ENV });
    assert.equal(mit.failed, false);
    const ohne = checkDiffCoverage({ quelle, berichte: [{ format: "lcov", pfad: "coverage/lcov.info" }], rootDir, runGit, env: ENV });
    assert.deepEqual(ohne.missing, ["frontend/src/a.ts"]);
    assert.equal(ohne.failed, true);
  });
  test("gemischter Lauf: lcov (Frontend) und JaCoCo (Backend) in einem Slice", () => {
    const rootDir = baum({ "coverage/lcov.info": "SF:src/a.ts\nDA:1,1\nend_of_record\n" });
    const quelle = { wurzeln: ["*/src/main/java", "frontend/src"], endungen: [".java", ".ts"] };
    const berichte = [...JACOCO, { format: "lcov", pfad: "coverage/lcov.info", basis: "frontend" }];
    const diff = [diffZeilen(PFAD_A, [3]), diffZeilen("frontend/src/a.ts", [1])].join("\n");
    const r = checkDiffCoverage({ quelle, berichte, rootDir, runGit: (a) => (a[0] === "diff" ? diff : "basesha"), env: ENV });
    assert.equal(r.failed, false);
    const dateien = Object.values(r.buckets as Record<string, { files: { path: string }[] }>).flatMap((b) => b.files.map((f) => f.path));
    assert.deepEqual(dateien.sort(), ["frontend/src/a.ts", PFAD_A]);
  });
  test("die Pfadangaben des Diffs: wörtlich unverändert, Glob als :(glob)<wurzel>/**; die Endungsliste filtert", () => {
    assert.deepEqual(pfadAngaben("lib"), ["lib"]);
    assert.deepEqual(pfadAngaben({ wurzeln: ["*/src/main/java", "lib"], endungen: [".java"] }), [":(glob)*/src/main/java/**", "lib"]);
    const gesehen: string[][] = [];
    const r = checkDiffCoverage({
      quelle: JAVA,
      berichte: JACOCO,
      rootDir: baum(),
      runGit: (a) => (gesehen.push(a), a[0] === "diff" ? diffFor("modul-a/src/main/java/de/beispiel/Doku.md", ["@@ -0,0 +1 @@", "+x"]) : "basesha"),
      env: ENV,
    });
    assert.deepEqual(gesehen.find((a) => a[0] === "diff"), ["diff", "-U0", "basesha...HEAD", "--", ":(glob)*/src/main/java/**"]);
    assert.equal(r.nothingToMeasure, true);
  });
  test("struktur.ohne nimmt Dateien aus der Messung", () => {
    const r = lauf({ zeilen: [5], quelle: { ...JAVA, ohne: ["*/src/main/java/de/**"] } });
    assert.equal(r.nothingToMeasure, true);
  });
});

describe("Diff-Coverage: Rot nennt Datei, Zeile und Bericht (factory#208)", () => {
  const bucket = {
    files: [
      { path: "a/src/main/java/de/A.java", uncovered: [3, 7], berichte: ["a/target/jacoco.xml"] },
      { path: "b/src/main/java/de/B.java", uncovered: [] },
      { path: "c/src/main/java/de/C.java", uncovered: [12], berichte: ["coverage/lcov.info", "coverage/zweit.info"] },
    ],
  };

  test("je Datei mit ungetesteten Zeilen eine Zeile (Datei, Zeilen und der Bericht dieser Datei, nicht alle Berichte)", () => {
    const z = rotZeilen(bucket);
    assert.deepEqual(z, [
      "    a/src/main/java/de/A.java: ungetestet in Zeile 3, 7 (aus a/target/jacoco.xml)",
      "    c/src/main/java/de/C.java: ungetestet in Zeile 12 (aus coverage/lcov.info, coverage/zweit.info)",
    ]);
  });
  test("ohne bekannten Bericht keine Klammer", () => {
    assert.deepEqual(rotZeilen({ files: [{ path: "y.ts", uncovered: [2] }] }), ["    y.ts: ungetestet in Zeile 2"]);
  });
  test("zwei lcov-Berichte zur selben Datei: beide stehen an ihr, ein Bericht ohne die Datei nicht", () => {
    const lcov = "SF:src/a.ts\nDA:1,0\nend_of_record\n";
    const rootDir = fixture({ "c/eins.info": lcov, "c/zwei.info": lcov, "c/drei.info": "SF:src/b.ts\nDA:1,1\nend_of_record\n" });
    const berichte = ["eins", "zwei", "drei"].map((n) => ({ format: "lcov", pfad: `c/${n}.info` }));
    const r = checkDiffCoverage({ quelle: { wurzeln: ["src"], endungen: [".ts"] }, berichte, rootDir, runGit: (a) => (a[0] === "diff" ? diffFor("src/a.ts", ["@@ -0,0 +1 @@", "+x"]) : "basesha"), env: { FACTORY_DIFF_BASE: "basesha" } });
    const dateien = Object.values(r.buckets as Record<string, { files: { path: string; berichte: string[] }[] }>).flatMap((b) => b.files);
    assert.deepEqual(dateien.map((f) => [f.path, f.berichte]), [["src/a.ts", ["c/eins.info", "c/zwei.info"]]]);
  });

  test("Datei ohne ungetestete Zeile kommt nicht vor; ohne Treffer bleibt die Liste leer (kein Bericht ohne Anlass)", () => {
    assert.deepEqual(rotZeilen({ files: [{ path: "x.java", uncovered: [], berichte: ["r.xml"] }] }), []);
  });
});

describe("Schichtdaten fehlen oder sind kaputt (#238 L21a): Fix-Zeile statt Stacktrace, Exit 2, fail-closed", () => {
  const lade = (checkCovRaw as unknown as { ladeSchichten: (w: string) => { LAYERS?: unknown; layerOf?: unknown; fehler?: string } }).ladeSchichten;
  const GUT = "module.exports = { LAYERS: { DOMAIN: 'd', APPLICATION: 'a' }, layerOf: () => 'd' };\n";
  const wurzel = (config: string | null, layers: string | null): string =>
    fixture({ ...(config === null ? {} : { "scripts/docs-gen/config.json": config }), ...(layers === null ? {} : { "scripts/l.cjs": layers }) }) + "/";

  test("gültig: LAYERS und layerOf, kein Fehler", () => {
    const r = lade(wurzel('{"schichten":{"layers":"scripts/l.cjs"}}', GUT));
    assert.equal(r.fehler, undefined);
    assert.deepEqual(r.LAYERS, { DOMAIN: "d", APPLICATION: "a" });
  });
  test("LAYERS ohne einen Schlüssel mit Floor (DOMAIN, APPLICATION): Fehler mit Schlüssel, Pfad und Fix (L7)", () => {
    const cfg = '{"schichten":{"layers":"scripts/l.cjs"}}';
    for (const [fehlt, js] of [
      ["APPLICATION", "module.exports = { LAYERS: { DOMAIN: 'd' }, layerOf: () => 'd' };\n"],
      ["DOMAIN", "module.exports = { LAYERS: { APPLICATION: 'a' }, layerOf: () => 'a' };\n"],
    ]) {
      const f = lade(wurzel(cfg, js)).fehler ?? "";
      assert.match(f, new RegExp(`scripts/l\\.cjs: LAYERS hat den Schlüssel ${fehlt} nicht`), fehlt);
      assert.ok(f.includes(SCHICHT_FIX), f);
    }
  });
  test("LAYER_DIFF_FLOORS führt nur vorhandene Schlüssel, nie undefined (L7)", () => {
    assert.ok(!("undefined" in LAYER_DIFF_FLOORS), Object.keys(LAYER_DIFF_FLOORS).join(","));
  });
  test("SCHICHT_FIX nennt schichten-kern.cjs und die Seite der Schichtdatei; jeder scripts/-Pfad darin ist Kern-Besitz (L8)", () => {
    assert.match(SCHICHT_FIX, /scripts\/schichten-kern\.cjs/);
    assert.match(SCHICHT_FIX, /docs\/erstbezug\.md/);
    assert.ok(!SCHICHT_FIX.includes("scripts/layers.cjs"), SCHICHT_FIX);
    const manifest = JSON.parse(readFileSync(new URL("../.factory/besitz.json", import.meta.url), "utf8")) as { eintraege: { pfad: string; ring: string }[] };
    const kern = new Set(manifest.eintraege.filter((e) => e.ring === "kern").map((e) => e.pfad));
    // config.json gehört dem Projekt (es trägt dort den Pfad ein), die anderen genannten Dateien muss ein Bezieher per Sync haben.
    const pfade = (SCHICHT_FIX.match(/scripts\/[\w./-]+\.(?:cjs|mjs|json)/g) ?? []).filter((p) => p !== "scripts/docs-gen/config.json");
    assert.ok(pfade.length > 0);
    for (const p of pfade) assert.ok(kern.has(p), `${p} ist kein Kern-Besitz`);
  });
  test("verify:full fährt die Abdeckung über den Gate-Befehl, nicht über test:coverage (L9)", () => {
    const v = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> }).scripts["verify:full"] ?? "";
    assert.ok(v.includes("gate-befehl.mjs coverage"), v);
    assert.ok(!v.includes("test:coverage"), v);
  });
  test("fremde Schicht-ID: evaluateByLayer wirft mit Pfad, Schicht-ID und Fix (L7)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "diffcov-fremd-"));
    try {
      cpSync(fileURLToPath(new URL("../scripts", import.meta.url)), join(tmp, "scripts"), { recursive: true });
      cpSync(fileURLToPath(new URL("../.factory", import.meta.url)), join(tmp, ".factory"), { recursive: true });
      writeFileSync(join(tmp, "scripts", "fremd.cjs"), "const L = require('./layers.cjs');\nmodule.exports = { LAYERS: L.LAYERS, layerOf: () => 'fremd' };\n");
      const cfgPfad = join(tmp, "scripts", "docs-gen", "config.json");
      const cfg = JSON.parse(readFileSync(cfgPfad, "utf8")) as { schichten: { layers: string } };
      cfg.schichten.layers = "scripts/fremd.cjs";
      writeFileSync(cfgPfad, JSON.stringify(cfg));
      const skript = pathToFileURL(join(tmp, "scripts", "check-diffcoverage.mjs")).href;
      const probe = `import(${JSON.stringify(skript)}).then((m) => { try { m.evaluateByLayer(new Map([["scripts/a.mjs", new Set([1])]]), new Map([["scripts/a.mjs", new Map([[1, 1]])]]), { quelle: { wurzeln: ["scripts"], endungen: [".mjs"] } }); console.log("kein Wurf"); } catch (e) { console.log("WURF " + e.message); } });`;
      const f = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", cwd: tmp });
      assert.match(f.stdout, /^WURF Schicht-ID "fremd" für scripts\/a\.mjs steht nicht in LAYERS/, f.stdout + f.stderr);
      assert.ok(f.stdout.includes(SCHICHT_FIX), f.stdout);
      // CLI: ein echter Diff mit einer Datei in der fremden Schicht endet mit Exit 2, ✖-Zeile und Fix, ohne Stacktrace.
      const git = (...a: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd: tmp, encoding: "utf8" });
      git("init", "-q");
      git("add", "-A");
      git("commit", "-q", "-m", "basis");
      writeFileSync(join(tmp, "scripts", "a.mjs"), "export const a = 1;\n");
      mkdirSync(join(tmp, "coverage"), { recursive: true });
      writeFileSync(join(tmp, "coverage", "lcov.info"), "TN:\nSF:scripts/a.mjs\nDA:1,1\nend_of_record\n");
      git("add", "-A");
      git("commit", "-q", "-m", "aenderung");
      const cli = spawnSync(process.execPath, [join(tmp, "scripts", "check-diffcoverage.mjs")], { encoding: "utf8", cwd: tmp, env: { ...process.env, FACTORY_DIFF_BASE: "HEAD~1" } });
      assert.equal(cli.status, 2, cli.stdout + cli.stderr);
      assert.match(cli.stderr, /✖ check:diffcoverage: Schicht-ID "fremd" für scripts\/a\.mjs/);
      assert.ok(cli.stderr.includes(`Fix: ${SCHICHT_FIX}`), cli.stderr);
      assert.ok(!/\n\s+at /.test(cli.stderr), cli.stderr);
      // Ein anderer Fehler der Schichtdatei bleibt ein Wurf (kein Exit 2 mit Fix-Zeile, die ihn falsch erklärte).
      writeFileSync(join(tmp, "scripts", "fremd.cjs"), "const L = require('./layers.cjs');\nmodule.exports = { LAYERS: L.LAYERS, layerOf: () => { throw new Error('boom'); } };\n");
      const wurf = spawnSync(process.execPath, [join(tmp, "scripts", "check-diffcoverage.mjs")], { encoding: "utf8", cwd: tmp, env: { ...process.env, FACTORY_DIFF_BASE: "HEAD~1" } });
      assert.notEqual(wurf.status, 2, wurf.stderr);
      assert.ok(/\n\s+at /.test(wurf.stderr) && wurf.stderr.includes("boom"), wurf.stderr);
      // LAYERS nur mit den Floor-Schlüsseln: LAYER_DIFF_FLOORS hat nur diese, keinen Schlüssel "undefined".
      writeFileSync(join(tmp, "scripts", "fremd.cjs"), "module.exports = { LAYERS: { DOMAIN: 'd', APPLICATION: 'a' }, layerOf: () => 'd' };\n");
      const keys = spawnSync(process.execPath, ["-e", `import(${JSON.stringify(skript)}).then((m) => console.log(JSON.stringify(m.LAYER_DIFF_FLOORS)))`], { encoding: "utf8", cwd: tmp });
      assert.equal(keys.stdout.trim(), JSON.stringify({ d: 90, a: 80 }), keys.stderr);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
  test("config.json fehlt oder ist kein JSON: Fehler mit Pfad der Config", () => {
    assert.match(lade(wurzel(null, GUT)).fehler ?? "", /scripts\/docs-gen\/config\.json nicht lesbar/);
    assert.match(lade(wurzel("{kaputt", GUT)).fehler ?? "", /scripts\/docs-gen\/config\.json nicht lesbar/);
  });
  test("schichten.layers fehlt: Fehler", () => {
    assert.equal(lade(wurzel("{}", GUT)).fehler, "scripts/docs-gen/config.json: schichten.layers fehlt");
  });
  test("Schichtdatei fehlt, wirft oder exportiert nicht LAYERS und layerOf: Fehler mit Pfad", () => {
    const cfg = '{"schichten":{"layers":"scripts/l.cjs"}}';
    assert.match(lade(wurzel(cfg, null)).fehler ?? "", /scripts\/l\.cjs nicht ladbar/);
    assert.match(lade(wurzel(cfg, "throw new Error('boom');\n")).fehler ?? "", /scripts\/l\.cjs nicht ladbar \(boom\)/);
    assert.match(lade(wurzel(cfg, "module.exports = {};\n")).fehler ?? "", /scripts\/l\.cjs exportiert LAYERS und layerOf nicht/);
    // jede Teilbedingung einzeln
    for (const js of ["module.exports = { LAYERS: { A: 1 } };\n", "module.exports = { layerOf: () => 'x' };\n", "module.exports = { LAYERS: null, layerOf: () => 'x' };\n", "module.exports = { LAYERS: 'x', layerOf: () => 'x' };\n"]) {
      assert.match(lade(wurzel(cfg, js)).fehler ?? "", /scripts\/l\.cjs exportiert LAYERS und layerOf nicht/, js);
    }
  });

  test("CLI: Exit 2, ✖-Zeile mit Fix: (schichten.layers, Vorlage scripts/layers.cjs), kein Stacktrace", () => {
    const tmp = mkdtempSync(join(tmpdir(), "diffcov-cli-"));
    try {
      cpSync(fileURLToPath(new URL("../scripts", import.meta.url)), join(tmp, "scripts"), { recursive: true });
      writeFileSync(join(tmp, "scripts", "docs-gen", "config.json"), "{}\n");
      const r = spawnSync(process.execPath, [join(tmp, "scripts", "check-diffcoverage.mjs")], { encoding: "utf8", cwd: tmp });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /✖ check:diffcoverage: scripts\/docs-gen\/config\.json: schichten\.layers fehlt/);
      assert.match(r.stderr, /Fix: .*schichten\.layers.*scripts\/schichten-kern\.cjs.*docs\/erstbezug\.md/);
      assert.ok(!/\n\s+at /.test(r.stderr), r.stderr);
      // fail-closed: wer die Auswertung trotzdem importiert, bekommt beim Schicht-Zugriff den Fehler statt einer stillen Schicht.
      const skript = pathToFileURL(join(tmp, "scripts", "check-diffcoverage.mjs")).href;
      const probe = `import(${JSON.stringify(skript)}).then((m) => { try { m.evaluateByLayer(new Map([["scripts/a.mjs", new Set([1])]]), new Map([["scripts/a.mjs", new Map([[1, 1]])]]), { quelle: { wurzeln: ["scripts"], endungen: [".mjs"] } }); console.log("kein Wurf"); } catch (e) { console.log("WURF " + e.message); } });`;
      const f = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8", cwd: tmp });
      assert.match(f.stdout, /^WURF Schichtdaten nicht ladbar: scripts\/docs-gen\/config\.json: schichten\.layers fehlt/, f.stdout + f.stderr);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
