/* zerlegeRepo / repoName / repoOwner (#1821 L13/L20): eine Zerlegung von `repo`, kaputte Form wirft mit Fix-Zeile. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as formRaw from "../scripts/repo-form.mjs";

interface Lib {
  repoName(config: unknown): string;
  repoOwner(config: unknown): string;
}
const lib = raw as unknown as Lib;
const form = formRaw as unknown as { zerlegeRepo(repo: unknown): { owner: string; name: string } }; // Blatt-Modul, direkt importiert (factory#114)

describe("zerlegeRepo", () => {
  test("owner/name wird zerlegt", () => {
    assert.deepEqual(form.zerlegeRepo("a/b"), { owner: "a", name: "b" });
  });
  for (const kaputt of ["x", "a/b/c", "", "/b", "a/", "a /b", 5, undefined]) {
    test(`wirft mit Fix-Zeile bei ${JSON.stringify(kaputt)}`, () => {
      assert.throws(() => form.zerlegeRepo(kaputt), /owner\/name[\s\S]*Fix:/);
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
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREMD } from "./support/fremd-config";

interface ZielLib {
  zielRepoFuer(labels: unknown, config: unknown): string;
  repoDerRolle(rolle: string, config: unknown): string | undefined;
  boardDerRolle(rolle: string, config: unknown): { rolle: string } | undefined;
  fremdesBoardText(rolle: string, repo: string, config: unknown): string | null;
  repoAusUrl(url: unknown): string;
  cli(argv: string[], o?: { out?: (s: string) => void; err?: (s: string) => void }): number;
}
const ziel = raw as unknown as ZielLib;
const FABRIK = "zz-org/zz-fabrik";
const mitFactoryRepo = (repo?: string) => ({ ...FREMD, labels: repo ? { ...FREMD.labels, dependabotInbox: "bereich:zz-inbox" } : FREMD.labels, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? (repo ? { ...b, repo } : { ...b, repo: undefined }) : b)) });

describe("repoDerRolle / boardDerRolle", () => {
  test("das Repo des Boards der Rolle, ohne boards[].repo das der Config, ohne Board das der Config", () => {
    assert.equal(ziel.repoDerRolle("factory", mitFactoryRepo(FABRIK)), FABRIK);
    assert.equal(ziel.repoDerRolle("factory", mitFactoryRepo()), FREMD.repo);
    assert.equal(ziel.repoDerRolle("gibtsnicht", mitFactoryRepo(FABRIK)), FREMD.repo);
    assert.equal(ziel.boardDerRolle("factory", mitFactoryRepo(FABRIK))?.rolle, "factory");
    assert.equal(ziel.boardDerRolle("factory", {}), undefined);
  });
});

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

/* Trennregel mit Issue-Repo (#238 L28/L29): das Harness-Label zählt nur zur Factory-Seite, wenn das Factory-Board das Repo des Issues führt. */
describe("boardRolleFuer mit { repo }", () => {
  const rolle = raw as unknown as { boardRolleFuer(labels: unknown, config: unknown, o?: { repo?: string }): string };
  const h = [FREMD.labels.harness];
  const bezieher = mitFactoryRepo(FABRIK); // Factory-Board führt FABRIK, Produkt-Board das eigene Repo
  test("Repo des Factory-Boards (auch in anderer Schreibweise) ergibt factory", () => {
    assert.equal(rolle.boardRolleFuer(h, bezieher, { repo: FABRIK }), "factory");
    assert.equal(rolle.boardRolleFuer(h, bezieher, { repo: FABRIK.toUpperCase() }), "factory");
  });
  test("fremdes Repo (Bezieher-Issue mit Harness-Label) ergibt produkt", () => {
    assert.equal(rolle.boardRolleFuer(h, bezieher, { repo: FREMD.repo }), "produkt");
  });
  test("Repo ohne Board bleibt produkt; das Produkt-Label bleibt produkt", () => {
    assert.equal(rolle.boardRolleFuer(h, bezieher, { repo: "zz-org/ohne-board" }), "produkt");
    assert.equal(rolle.boardRolleFuer(["bug"], bezieher, { repo: FABRIK }), "produkt");
  });
  test("ohne repo (oder leer) gilt das heutige Verhalten, in der Fabrik (beide Boards ein Repo) bleibt es unverändert", () => {
    assert.equal(rolle.boardRolleFuer(h, bezieher), "factory");
    assert.equal(rolle.boardRolleFuer(h, bezieher, { repo: "" }), "factory");
    assert.equal(rolle.boardRolleFuer(h, mitFactoryRepo(), { repo: FREMD.repo }), "factory");
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
  const ordner: string[] = [];
  afterEach(() => {
    for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const datei = (c: unknown) => {
    const d = mkdtempSync(join(tmpdir(), "ziel-"));
    ordner.push(d);
    const p = join(d, "c.json");
    writeFileSync(p, JSON.stringify(c));
    return p;
  };
  test("nicht ladbare Config: Exit 1 mit ✖-Zeile, nichts auf stdout (die Dependabot-Vorprüfung braucht den Nicht-Null-Exit)", () => {
    const d = mkdtempSync(join(tmpdir(), "ziel-"));
    ordner.push(d);
    const r = lauf(["--config", join(d, "gibt-es-nicht.json"), "--ziel-repo", "x"]);
    assert.equal(r.code, 1);
    assert.deepEqual(r.out, []);
    assert.match(r.err[0] ?? "", /^✖ /);
    writeFileSync(join(d, "kaputt.json"), "{ nicht json");
    assert.equal(lauf(["--config", join(d, "kaputt.json"), "--ziel-repo", "x"]).code, 1);
  });
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
