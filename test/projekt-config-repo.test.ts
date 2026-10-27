/* zerlegeRepo / repoName / repoOwner (#1821 L13/L20): eine Zerlegung von `repo`, kaputte Form wirft mit Fix-Zeile. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/projekt-config-lib.mjs";

interface Lib {
  zerlegeRepo(repo: unknown): { owner: string; name: string };
  repoName(config: unknown): string;
  repoOwner(config: unknown): string;
}
const lib = raw as unknown as Lib;

describe("zerlegeRepo", () => {
  test("owner/name wird zerlegt", () => {
    assert.deepEqual(lib.zerlegeRepo("a/b"), { owner: "a", name: "b" });
  });
  for (const kaputt of ["x", "a/b/c", "", "/b", "a/", "a /b", 5, undefined]) {
    test(`wirft mit Fix-Zeile bei ${JSON.stringify(kaputt)}`, () => {
      assert.throws(() => lib.zerlegeRepo(kaputt), /owner\/name[\s\S]*Fix:/);
    });
  }
});

describe("repoName / repoOwner", () => {
  test("liefern Namens- und Besitzerteil", () => {
    assert.equal(lib.repoName({ repo: "o/n" }), "n");
    assert.equal(lib.repoOwner({ repo: "o/n" }), "o");
  });
  test("werfen ohne gültiges repo", () => {
    assert.throws(() => lib.repoOwner({ repo: "x" }), /Fix:/);
    assert.throws(() => lib.repoName({}), /Fix:/);
    assert.throws(() => lib.repoOwner(undefined), /Fix:/);
  });
});

/* Ziel-Repo für Harness-Befunde (#76, ADR 0022 F10): das Repo, dessen Issues das Board der Rolle führt. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREMD } from "./support/fremd-config";

interface ZielLib {
  zielRepoFuer(labels: unknown, config: unknown): string;
  fremdesBoardText(rolle: string, repo: string, config: unknown): string | null;
  repoAusUrl(url: unknown): string;
  cli(argv: string[], o?: { out?: (s: string) => void; err?: (s: string) => void }): number;
}
const ziel = raw as unknown as ZielLib;
const FABRIK = "zz-org/zz-fabrik";
const mitFactoryRepo = (repo?: string) => ({ ...FREMD, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? (repo ? { ...b, repo } : { ...b, repo: undefined }) : b)) });

describe("zielRepoFuer", () => {
  test("das Harness-Label geht an das Repo des Factory-Boards, ein Produkt-Label bleibt im eigenen Repo (AK5)", () => {
    const c = mitFactoryRepo(FABRIK);
    assert.equal(ziel.zielRepoFuer([FREMD.labels.harness], c), FABRIK);
    assert.equal(ziel.zielRepoFuer(["bug"], c), FREMD.repo);
    assert.equal(ziel.zielRepoFuer([], c), FREMD.repo);
  });
  test("ohne boards[].repo gilt das eigene Repo (AK1)", () => {
    assert.equal(ziel.zielRepoFuer([FREMD.labels.harness], mitFactoryRepo()), FREMD.repo);
  });
});

describe("fremdesBoardText", () => {
  test("null beim eigenen Repo (auch ohne Groß-/Kleinschreibung), sonst Text mit Rolle, geführtem Repo und Fix", () => {
    const c = mitFactoryRepo(FABRIK);
    assert.equal(ziel.fremdesBoardText("factory", FABRIK.toUpperCase(), c), null);
    assert.equal(ziel.fremdesBoardText("produkt", FREMD.repo, c), null);
    const t = ziel.fremdesBoardText("factory", FREMD.repo, c) ?? "";
    assert.match(t, new RegExp(`factory-Board.*${FABRIK}, nicht die von ${FREMD.repo}[\\s\\S]*Fix:`));
  });
});

describe("repoAusUrl", () => {
  test("zieht owner/name aus der API-URL; leer bei kaputter oder fehlender URL", () => {
    assert.equal(ziel.repoAusUrl("https://api.github.com/repos/zz-org/zz-demo"), "zz-org/zz-demo");
    assert.equal(ziel.repoAusUrl(""), "");
    assert.equal(ziel.repoAusUrl(undefined), "");
    assert.equal(ziel.repoAusUrl("https://x/zz-demo"), "");
  });
});

describe("projekt-config --ziel-repo", () => {
  const lauf = (argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    return { code: ziel.cli(argv, { out: (s) => out.push(s), err: (s) => err.push(s) }), out, err };
  };
  const datei = (c: unknown) => {
    const p = join(mkdtempSync(join(tmpdir(), "ziel-")), "c.json");
    writeFileSync(p, JSON.stringify(c));
    return p;
  };
  test("gibt das Ziel-Repo zum Label aus (Harness: Factory-Board-Repo, Produkt: eigenes Repo)", () => {
    const p = datei(mitFactoryRepo(FABRIK));
    assert.deepEqual(lauf(["--config", p, "--ziel-repo", FREMD.labels.harness]), { code: 0, out: [FABRIK], err: [] });
    assert.deepEqual(lauf(["--config", p, "--ziel-repo", "bug"]).out, [FREMD.repo]);
  });
  test("ohne Label (oder mit überzähligem Argument) Exit 2", () => {
    const p = datei(FREMD);
    assert.equal(lauf(["--config", p, "--ziel-repo", ""]).code, 2);
    assert.equal(lauf(["--config", p, "--ziel-repo", "x", "labels.harness"]).code, 2);
  });
});
