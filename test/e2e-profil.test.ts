/* e2e-Gate-Profil (factory#246): Matrix-Leser für die CI und Drift des Rezepts auf der Kern-Seite. */
import { afterEach, describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/e2e-profil-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { E2E_UMGEBUNG } from "../scripts/gate-befehl-lib.mjs";

const lib = raw as unknown as { cli(argv: string[], o: { lade: () => unknown; out: (t: string) => void; err: (t: string) => void }): number };
const WURZEL = fileURLToPath(new URL("../", import.meta.url));

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

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
    assert.match(r.err.join("\n"), /e2e braucht befehle\.e2e[\s\S]*Fix:/);
    assert.deepEqual(r.out, []);
  });
  test("unbekanntes oder fehlendes Unterkommando: Exit 2 mit Fix", () => {
    for (const argv of [["bogus"], [], ["matrix", "x"]]) {
      const r = lauf(argv, {});
      assert.equal(r.code, 2, JSON.stringify(argv));
      assert.match(r.err.join("\n"), /Fix:/);
    }
  });
  test("Ladefehler: Exit 2, die Meldung des Laders unverändert, keine Ausgabe", () => {
    const out: string[] = [];
    const err: string[] = [];
    const code = lib.cli(["matrix"], { lade: () => { throw new Error("Projekt-Config kaputt\nFix: reparieren"); }, out: (t) => out.push(t), err: (t) => err.push(t) });
    assert.equal(code, 2);
    assert.deepEqual(err, ["Projekt-Config kaputt\nFix: reparieren"]);
    assert.deepEqual(out, []);
  });
  const spawnMit = (config: unknown) => {
    const d = mkdtempSync(join(tmpdir(), "e2e-profil-"));
    dirs.push(d);
    writeFileSync(join(d, "c.json"), JSON.stringify(config));
    return spawnSync(process.execPath, ["scripts/e2e-profil.mjs", "matrix"], { cwd: WURZEL, encoding: "utf8", env: { ...process.env, VITEST: "true", FACTORY_PROJEKT_WURZEL: WURZEL, FACTORY_PROJEKT_CONFIG: join(d, "c.json") } });
  };
  const fremd = () => JSON.parse(readFileSync(WURZEL + "test/fixtures/projekt-fremd.json", "utf8")) as Record<string, unknown>;
  test("Produktionsweg ohne Profil: Exit 0, die zwei Zeilen, stderr leer", () => {
    const r = spawnMit(fremd());
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, "aktiv=false\nbrowser=[]\n");
    assert.equal(r.stderr, "");
  });
  test("Produktionsweg mit Profil: aktiv=true und die Liste", () => {
    const r = spawnMit({ ...fremd(), e2e: { browser: ["a", "b"] }, befehle: { e2e: "x" } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'aktiv=true\nbrowser=["a","b"]\n');
  });
  test("Produktionsweg mit kaputter Config: Exit 2, Fix auf stderr, stdout leer", () => {
    const r = spawnMit({ ...fremd(), e2e: { browser: ["a"] } });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /e2e braucht befehle\.e2e[\s\S]*Fix:/);
    assert.equal(r.stdout, "");
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

describe("pruefeE2e nennt den Variablennamen aus E2E_UMGEBUNG (L57)", () => {
  type Pruefer = { pruefeE2e(e2e: unknown, befehle: unknown): string[] };
  afterEach(() => { vi.doUnmock("../scripts/gate-befehl-lib.mjs"); vi.resetModules(); });
  test("die Meldung trägt den Namen aus E2E_UMGEBUNG.browser", async () => {
    // @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
    const m = (await import("../scripts/projekt-config-bloecke.mjs")) as unknown as Pruefer;
    const meldung = m.pruefeE2e({ browser: ["a"] }, undefined).join("\n");
    assert.ok(meldung.includes((E2E_UMGEBUNG as unknown as { browser: string }).browser));
  });
  test("ein anderer Wert in E2E_UMGEBUNG erscheint in der Meldung (kein Literal im Prüfer)", async () => {
    vi.resetModules();
    vi.doMock("../scripts/gate-befehl-lib.mjs", () => ({ E2E_UMGEBUNG: { browser: "PROBE_E2E" } }));
    // @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
    const m = (await import("../scripts/projekt-config-bloecke.mjs")) as unknown as Pruefer;
    const meldung = m.pruefeE2e({ browser: ["a"] }, undefined).join("\n");
    assert.ok(meldung.includes("PROBE_E2E"));
    assert.ok(!meldung.includes("FACTORY_E2E_BROWSER"));
  });
});
