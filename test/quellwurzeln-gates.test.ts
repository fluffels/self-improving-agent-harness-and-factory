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

type Quellen = string | { wurzeln: string[]; endungen: string[]; ohne?: string[] };
type Sized = { file: string; loc: number };
const collectSizes = (rawSize as unknown as { collectSizes: (root?: string, q?: Quellen) => Sized[] }).collectSizes;
const collectSuppressions = (rawAny as unknown as { collectSuppressions: (root: string, q: Quellen) => Record<string, number> }).collectSuppressions;
const strukturOrdnerBefunde = (rawBasis as unknown as { strukturOrdnerBefunde: (root: string, s: { quelle: string | string[] }, k?: string[]) => string[] }).strukturOrdnerBefunde;
const pc = rawPc as unknown as { ladeProjektConfig: () => { struktur: object }; strukturAus: (c: unknown, o?: { listeErlaubt?: boolean }) => unknown };

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
function lauf(skript: string, struktur: object): { status: number | null; ausgabe: string } {
  const echt = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as object;
  const d = fixture({ "c.json": JSON.stringify({ ...echt, struktur }) });
  const r = spawnSync(process.execPath, [join(WURZEL, "scripts", skript)], {
    encoding: "utf8",
    env: { ...process.env, FACTORY_PROJEKT_CONFIG: join(d, "c.json"), VITEST: "true", FACTORY_PROJEKT_WURZEL: WURZEL },
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

describe("Leser ohne Listenform werfen mit klarer Meldung (factory#181)", () => {
  const liste = { quelle: ["scripts", "test"], moduldoku: "docs/module" };
  test.each(["check-diffcoverage.mjs"])("%s: Exit 1 und „noch nicht unterstützt“", (skript) => {
    const r = lauf(skript, liste);
    assert.equal(r.status, 1, r.ausgabe);
    assert.match(r.ausgabe, /noch nicht unterstützt[\s\S]*Fix:/);
  });
  test("anker-liste echteUmgebung wirft wie diffcoverage (Entscheidung: bis zur Umstellung der Messgrenze, factory#185)", () => {
    const echt = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")) as object;
    const d = fixture({ "c.json": JSON.stringify({ ...echt, struktur: liste }) });
    const code = `import(${JSON.stringify(pathToFileURL(join(WURZEL, "scripts", "anker-liste.mjs")).href)}).then((m) => m.echteUmgebung()).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(3); })`;
    const r = spawnSync(process.execPath, ["-e", code], {
      encoding: "utf8",
      env: { ...process.env, FACTORY_PROJEKT_CONFIG: join(d, "c.json"), VITEST: "true", FACTORY_PROJEKT_WURZEL: WURZEL },
    });
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.match(r.stderr, /noch nicht unterstützt/);
  });
  test("strukturAus wirft bei der Liste, nimmt aber die String-Form und mit listeErlaubt (check:docmap) auch die Liste", () => {
    assert.throws(() => pc.strukturAus({ struktur: liste }), /noch nicht unterstützt[\s\S]*Fix:/);
    assert.deepEqual(pc.strukturAus({ struktur: { quelle: "lib", moduldoku: null } }), { quelle: "lib", moduldoku: null });
    assert.deepEqual(pc.strukturAus({ struktur: liste }, { listeErlaubt: true }), { quelle: liste.quelle, moduldoku: liste.moduldoku });
  });
});
