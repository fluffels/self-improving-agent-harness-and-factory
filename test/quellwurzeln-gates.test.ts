/* Leser der Quellwurzeln (factory#181): check:size, check:anysuppress, strukturOrdnerBefunde und die Leser, die die Listenform noch nicht kennen. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { join, relative, sep } from "node:path";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSize from "../scripts/check-size.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawAny from "../scripts/check-any-suppressions.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBasis from "../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawQl from "../scripts/quellwurzeln-lib.mjs";

type Quellen = string |{ wurzeln: string[]; endungen: string[]; ohne?: string[] };
type Sized = { file: string; loc: number };
const collectSizes = (rawSize as unknown as { collectSizes: (root?: string, q?: Quellen) => Sized[] }).collectSizes;
const collectSuppressions = (rawAny as unknown as { collectSuppressions: (root: string, q: Quellen) => Record<string, number> }).collectSuppressions;
const strukturOrdnerBefunde = (rawBasis as unknown as { strukturOrdnerBefunde: (root: string, s: { quelle: string | string[] }, k?: string[]) => string[] }).strukturOrdnerBefunde;
const pc = rawPc as unknown as { ladeProjektConfig: () => { struktur: object }; strukturAus: (c: unknown) => unknown };

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const nachDatei = (a: Sized, b: Sized): number => a.file.localeCompare(b.file);

/** Wörtliche Kopie der bisherigen Sammelfunktion (alter Walker, alte Regex), als Referenz für „dieselbe Dateimenge wie vorher“. */
const QUELLDATEI = /\.(ts|mts|cts|js|mjs|cjs)$/;
function alteSammlung(rootDir: string, quelle: string): Sized[] {
  const out: Sized[] = [];
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && QUELLDATEI.test(ent.name)) {
        const lines = readFileSync(abs, "utf8").split(/\r?\n/);
        if (lines[lines.length - 1] === "") lines.pop();
        out.push({ file: relative(rootDir, abs).split(sep).join("/"), loc: lines.length });
      }
    }
  };
  walk(join(rootDir, quelle));
  return out.sort((a, b) => b.loc - a.loc);
}

describe("check:size über Quellwurzeln und Endungsliste (factory#181)", () => {
  test("Negativfall: die Factory-Config (String, ohne endungen) liefert dieselbe Dateimenge wie die bisherige Sammelfunktion", () => {
    const quelle = (pc.ladeProjektConfig().struktur as { quelle: string }).quelle;
    assert.equal(typeof quelle, "string");
    const alt = alteSammlung(WURZEL, quelle).sort(nachDatei);
    assert.ok(alt.length > 10);
    assert.deepEqual(collectSizes().sort(nachDatei), alt);
  });
  test("Negativfall: gemischtes Fixture gleich der alten Sammlung (auch .d.ts, Daten und Doku ausgeschlossen)", () => {
    const d = fixture({ "lib/a.ts": "x\n", "lib/s/b.mts": "x\nx\n", "lib/c.cjs": "x", "lib/d.d.ts": "x", "lib/e.json": "{}", "lib/f.md": "x", "lib/g.tsx": "x" });
    assert.deepEqual(collectSizes(d, "lib").sort(nachDatei), alteSammlung(d, "lib").sort(nachDatei));
  });
  test("Liste, Glob und eigene Endungen: ohne gilt für check:size nicht", () => {
    const d = fixture({
      "a/src/main/java/X.java": "x\n", "a/src/main/java/ATest.java": "x\n", "b/src/main/java/Y.java": "x\n",
      "web/app.spec.ts": "x\n", "web/app.ts": "x\n", "web/data.json": "{}",
    });
    const q = { wurzeln: ["*/src/main/java", "web"], endungen: [".java", ".ts"], ohne: ["**/*Test.java", "**/*.spec.ts"] };
    const dateien = collectSizes(d, q).map((s) => s.file).sort();
    assert.deepEqual(dateien, ["a/src/main/java/ATest.java", "a/src/main/java/X.java", "b/src/main/java/Y.java", "web/app.spec.ts", "web/app.ts"]);
  });
});

describe("check:anysuppress über Quellwurzeln (factory#181)", () => {
  const disable = "// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst a: any = 1;\n";
  test("zwei Wurzeln, nur .ts, ohne gilt; Endungsliste ohne .ts prüft nichts; String-Form wie bisher", () => {
    const d = fixture({ "a/x.ts": disable, "a/x.spec.ts": disable, "b/y.ts": disable, "b/Z.java": disable, "c/w.ts": disable, "a/sauber.ts": "const a = 1;\n" });
    const q = { wurzeln: ["a", "b"], endungen: [".java", ".ts"], ohne: ["**/*.spec.ts"] };
    assert.deepEqual(collectSuppressions(d, q), { "a/x.ts": 1, "b/y.ts": 1 });
    assert.deepEqual(collectSuppressions(d, { ...q, endungen: [".java"] }), {});
    assert.deepEqual(collectSuppressions(d, "a"), { "a/x.spec.ts": 1, "a/x.ts": 1 });
  });
});

describe("strukturOrdnerBefunde mit Liste (factory#181)", () => {
  test("Listeneintrag fehlt: Befund nennt struktur.quelle[i], .gitkeep und Fix", () => {
    const d = fixture({ "a/x.ts": "x" });
    const b = strukturOrdnerBefunde(d, { quelle: ["a", "fehlt"] });
    assert.equal(b.length, 1);
    assert.match(b[0], /struktur\.quelle\[1\][\s\S]*Fix:[\s\S]*\.gitkeep/);
  });
  test("Glob ohne Ordner-Treffer: Befund mit struktur.quelle[i] und Fix", () => {
    const d = fixture({ "a/x.ts": "x", "datei-nur": "x" });
    const b = strukturOrdnerBefunde(d, { quelle: ["a", "nix-*/src", "datei-*"] });
    assert.equal(b.length, 2);
    assert.match(b[0], /struktur\.quelle\[1\][\s\S]*nix-\*\/src[\s\S]*keinen Ordner[\s\S]*Fix:/);
    assert.match(b[1], /struktur\.quelle\[2\]/);
  });
  test("Glob mit Treffer und wörtliche Einträge: kein Befund", () => {
    const d = fixture({ "a/src/x.ts": "x", "b/src/y.ts": "x", "lib/z.ts": "x" });
    assert.deepEqual(strukturOrdnerBefunde(d, { quelle: ["*/src", "lib"] }), []);
  });
});

/** Startet ein Skript mit einer Config, die die echte Config mit anderem `struktur` ist (Muster: Kindlauf mit injizierter Config). */
function lauf(skript: string, struktur: object, env: Record<string, string> = {}): { status: number | null; ausgabe: string } {
  const echt = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as object;
  const d = fixture({ "c.json": JSON.stringify({ ...echt, struktur }) });
  const r = spawnSync(process.execPath, [join(WURZEL, "scripts", skript)], {
    encoding: "utf8",
    env: { ...process.env, FACTORY_PROJEKT_CONFIG: join(d, "c.json"), VITEST: "true", FACTORY_PROJEKT_WURZEL: WURZEL, ...env },
  });
  return { status: r.status, ausgabe: `${r.stdout}${r.stderr}` };
}

describe("check:size CLI: rote Formen mit Fix-Zeile (factory#181)", () => {
  const doku = { moduldoku: null };
  test.each([
    ["Endung ohne Punkt", { quelle: "scripts", endungen: ["java"], ...doku }, /struktur\.endungen\[0\]/],
    ["Pfad mit ..", { quelle: ["a/../b"], ...doku }, /struktur\.quelle\[0\]/],
    ["Glob ohne Treffer", { quelle: ["gibt-es-nicht-*/src"], ...doku }, /gibt-es-nicht-\*\/src[\s\S]*keinen Ordner/],
  ])("%s", (_name, struktur, muster) => {
    const r = lauf("check-size.mjs", struktur);
    assert.equal(r.status, 1, r.ausgabe);
    assert.match(r.ausgabe, muster);
    assert.match(r.ausgabe, /Fix:/);
  });
});

describe("CLI-Verdrahtung der Listenform (factory#181)", () => {
  const liste = { quelle: ["scripts", "test"], moduldoku: null };
  test("check:size misst auch die zweite Wurzel: eine Datei über dem Budget dort macht das Gate rot", () => {
    const r = lauf("check-size.mjs", liste);
    assert.equal(r.status, 1, r.ausgabe);
    assert.match(r.ausgabe, /✖ test\/[^\n]*Zeilen > Budget/);
  });
  test("check:anysuppress zählt auch die zweite Wurzel: neue Disables dort sind rot gegen die Baseline", () => {
    const r = lauf("check-any-suppressions.mjs", liste);
    assert.equal(r.status, 1, r.ausgabe);
    assert.match(r.ausgabe, /test\/any-suppressions\.test\.ts/);
  });
});

describe("wurzelPraefixe und isMeasured über Liste, Glob und Endungsliste (factory#185)", () => {
  const wurzelPraefixe = (rawQl as unknown as { wurzelPraefixe: (p: string, w: string[]) => string[] }).wurzelPraefixe;
  const isMeasured = (rawBasis as unknown as { isMeasured: (p: string, q: Quellen) => boolean }).isMeasured;
  const java = { wurzeln: ["*/src/main/java"], endungen: [".java"] };

  test("wörtliche Wurzel: nur ein echtes Ordner-Präfix zählt", () => {
    assert.deepEqual(wurzelPraefixe("scripts/a.mjs", ["scripts", "test"]), ["scripts"]);
    assert.deepEqual(wurzelPraefixe("scripts-x/a.mjs", ["scripts"]), []);
  });
  test("Glob-Wurzel liefert das getroffene Präfix, mehrere Wurzeln mischen sich", () => {
    assert.deepEqual(wurzelPraefixe("modul-a/src/main/java/de/X.java", ["*/src/main/java", "docs"]), ["modul-a/src/main/java"]);
    assert.deepEqual(wurzelPraefixe("docs/x.md", ["*/src/main/java", "docs"]), ["docs"]);
  });
  test("ab dem ersten Glob-Segment zählen Punkt-Ordner und node_modules nicht", () => {
    assert.deepEqual(wurzelPraefixe(".versteckt/src/main/java/X.java", ["*/src/main/java"]), []);
    assert.deepEqual(wurzelPraefixe("node_modules/src/main/java/X.java", ["*/src/main/java"]), []);
    assert.deepEqual(wurzelPraefixe("a/.b/src/main/java/X.java", ["**/src/main/java"]), []);
    // ein wörtlicher Präfix vor dem Glob darf mit Punkt beginnen
    assert.deepEqual(wurzelPraefixe(".claude/x/src/a.ts", [".claude/*/src"]), [".claude/x/src"]);
  });
  test("eine Datei direkt unter dem Ordner, den ein Glob trifft, ist keine Wurzel dieser Datei", () => {
    assert.deepEqual(wurzelPraefixe("src/a.ts", ["src/*"]), []);
    assert.deepEqual(wurzelPraefixe("src/x/a.ts", ["src/*"]), ["src/x"]);
  });
  test("isMeasured: Endungsliste, Glob-Wurzel und ohne-Glob", () => {
    assert.equal(isMeasured("modul-a/src/main/java/de/X.java", java), true);
    assert.equal(isMeasured("modul-a/src/main/java/de/X.kt", java), false);
    assert.equal(isMeasured("modul-a/src/test/java/de/X.java", java), false);
    assert.equal(isMeasured("modul-a/src/main/java/gen/X.java", { ...java, ohne: ["*/src/main/java/gen/**"] }), false);
    assert.equal(isMeasured("modul-a/src/main/java/de/X.java", { ...java, ohne: ["*/src/main/java/gen/**"] }), true);
  });
  test("isMeasured: String-Form mit Standard-Endungen, Typdeklarationen nie", () => {
    assert.equal(isMeasured("src/a.ts", "src"), true);
    assert.equal(isMeasured("src/a.cts", "src"), true);
    assert.equal(isMeasured("src/a.d.ts", "src"), false);
    assert.equal(isMeasured("src/a.d.cts", "src"), false);
    assert.equal(isMeasured("src/a.json", "src"), false);
    assert.equal(isMeasured("src/a.d.ts", { wurzeln: ["src"], endungen: [".ts", ".d.ts"] }), false);
  });
});

describe("check:diffcoverage und anker-liste lesen die Listenform (factory#185)", () => {
  const liste = { quelle: ["scripts", "test"], moduldoku: "docs/module" };
  test("check:diffcoverage mit Liste: keine „noch nicht unterstützt“-Meldung, die Wurzeln stehen in der Ausgabe", () => {
    // Basis = HEAD: leerer Diff, also deterministisch „nichts zu messen“ (die Messung selbst prüft test/diffcoverage.test.ts).
    const r = lauf("check-diffcoverage.mjs", liste, { FACTORY_DIFF_BASE: "HEAD" });
    assert.equal(r.status, 0, r.ausgabe);
    assert.doesNotMatch(r.ausgabe, /noch nicht unterstützt/);
    assert.match(r.ausgabe, /Wurzeln: scripts, test; Endungen: \.ts/);
  });
  test("check:diffcoverage mit kaputtem coverage-Block: Exit 1, Meldung mit Fix-Zeile", () => {
    const echt = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as object;
    const d = fixture({ "c.json": JSON.stringify({ ...echt, coverage: { berichte: [{ format: "xml", pfad: "a" }] } }) });
    const r = spawnSync(process.execPath, [join(WURZEL, "scripts", "check-diffcoverage.mjs")], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_PROJEKT_CONFIG: join(d, "c.json"), VITEST: "true", FACTORY_PROJEKT_WURZEL: WURZEL, FACTORY_DIFF_BASE: "HEAD" },
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /coverage\.berichte\[0\]\.format[\s\S]*Fix:/);
  });
  test("anker-liste echteUmgebung nimmt die Liste: istQuelle trifft Wurzeln und Hilfsdateien außerhalb der Wurzeln (Ordner-Klausel), nicht Doku", () => {
    const echt = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as object;
    const d = fixture({ "c.json": JSON.stringify({ ...echt, struktur: { ...liste, quelle: ["scripts", "lib"] } }) });
    const code = `import(${JSON.stringify(pathToFileURL(join(WURZEL, "scripts", "anker-liste.mjs")).href)}).then((m) => { const u = m.echteUmgebung(); console.log(JSON.stringify([u.istQuelle("test/support/x.ts"), u.istQuelle("scripts/a.mjs"), u.istQuelle("docs/a.md")])); process.exit(0); }, (e) => { console.error(e.message); process.exit(3); })`;
    const r = spawnSync(process.execPath, ["-e", code], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_PROJEKT_CONFIG: join(d, "c.json"), VITEST: "true", FACTORY_PROJEKT_WURZEL: WURZEL },
    });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim()), [true, true, false]);
  });
  test("strukturAus nimmt die String-Form und die Liste", () => {
    assert.deepEqual(pc.strukturAus({ struktur: { quelle: "lib", moduldoku: null } }), { quelle: "lib", moduldoku: null });
    assert.deepEqual(pc.strukturAus({ struktur: liste }), { quelle: liste.quelle, moduldoku: liste.moduldoku });
  });
});
