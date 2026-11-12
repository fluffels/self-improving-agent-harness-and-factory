/* e2e-Gate-Profil (factory#246): Matrix-Leser für die CI und Drift des Rezepts auf der Kern-Seite. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/e2e-profil-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { E2E_UMGEBUNG } from "../scripts/gate-befehl-lib.mjs";

const lib = raw as unknown as { cli(argv: string[], o: { lade: () => unknown; out: (t: string) => void; err: (t: string) => void }): number };
const WURZEL = fileURLToPath(new URL("../", import.meta.url));

const lauf = (argv: string[], config: unknown) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = lib.cli(argv, { lade: () => config, out: (t) => out.push(t), err: (t) => err.push(t) });
  return { code, out, err };
};

describe("node scripts/e2e-profil.mjs matrix", () => {
  test("Negativfall: ohne Block aktiv=false, browser=[], Exit 0, stderr leer", () => {
    for (const config of [{}, { befehle: { verify: "x" } }]) {
      const r = lauf(["matrix"], config);
      assert.equal(r.code, 0);
      assert.deepEqual(r.out, ["aktiv=false", "browser=[]"]);
      assert.deepEqual(r.err, []);
    }
  });
  test("mit Block: aktiv=true und die browser-Zeile ist valides JSON gleich der Liste", () => {
    const r = lauf(["matrix"], { e2e: { browser: ["chromium", "firefox"] }, befehle: { e2e: "lauf" } });
    assert.equal(r.code, 0);
    assert.equal(r.out[0], "aktiv=true");
    assert.deepEqual(JSON.parse(r.out[1].replace(/^browser=/, "")), ["chromium", "firefox"]);
    assert.equal(r.out.length, 2);
    assert.deepEqual(r.err, []);
  });
  test("Config-Fehler (Block ohne Befehl): Exit 2 mit Fix, keine Ausgabe", () => {
    const r = lauf(["matrix"], { e2e: { browser: ["chromium"] } });
    assert.equal(r.code, 2);
    assert.match(r.err.join("\n"), /Fix:/);
    assert.deepEqual(r.out, []);
  });
  test("unbekanntes oder fehlendes Unterkommando: Exit 2 mit Fix", () => {
    for (const argv of [["bogus"], [], ["matrix", "x"]]) {
      const r = lauf(argv, {});
      assert.equal(r.code, 2, JSON.stringify(argv));
      assert.match(r.err.join("\n"), /Fix:/);
    }
  });
  test("Produktionsweg: in diesem Repo (ohne Block) Exit 0 und die zwei Zeilen", () => {
    const r = spawnSync(process.execPath, ["scripts/e2e-profil.mjs", "matrix"], { cwd: WURZEL, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "aktiv=false\nbrowser=[]\n");
    assert.equal(r.stderr, "");
  });
});

describe("Rezept-Drift: YAML-Block der Kern-Seite", () => {
  const seite = readFileSync(WURZEL + "docs/factory/schichten-ohne-unit-tests.md", "utf8");
  const yaml = /```yaml\n([\s\S]*?)```/.exec(seite)?.[1] ?? "";
  test("nennt Matrix-Leser, Läufer und die Umgebungsvariable", () => {
    assert.ok(yaml.length > 0, "kein yaml-Block");
    assert.match(yaml, /e2e-profil\.mjs matrix/);
    assert.match(yaml, /gate-befehl\.mjs e2e/);
    assert.ok(yaml.includes((E2E_UMGEBUNG as { browser: string }).browser));
  });
  test("kein ${{ in einer run:-Zeile (Skript-Injektion)", () => {
    const run = yaml.split("\n").filter((z) => /^\s*(-\s+)?run:/.test(z));
    assert.ok(run.length > 0);
    for (const z of run) assert.doesNotMatch(z, /\$\{\{/);
  });
});
