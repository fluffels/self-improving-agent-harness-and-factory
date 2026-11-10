/* Harness-Doctor, Punkt `Git-Hooks` (factory#247 L1): reiner Punkt mit eingespeister Lese-Naht, dazu der Standard gegen ein echtes, frisch angelegtes git-Repo (Konfiguration von Nutzer und System ausgeblendet). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { gitHooksPunkt as rawHooks, gitHooksStandard as rawHooksStandard } from "../scripts/harness-doctor-githooks.mjs";

interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string; hinweis?: string }
const gitHooksPunkt = rawHooks as (a: { lesen: () => string | null }) => Ergebnis;
const gitHooksStandard = rawHooksStandard as (a: { rootDir: string; exec?: (cmd: string, args: string[], o: unknown) => { status: number | null; stdout: string; error?: Error } }) => () => string | null;

/** Wirft einen beliebigen Wert (auch Nicht-Error): die Lese-Nähte können alles werfen. */
const wirf = (wert: unknown): never => {
  throw wert;
};

afterEach(() => vi.unstubAllEnvs());

describe("Git-Hooks", () => {
  test(".githooks gesetzt: OK", () => {
    expect(gitHooksPunkt({ lesen: () => ".githooks" })).toEqual({ punkt: "Git-Hooks", ok: true });
    expect(gitHooksPunkt({ lesen: () => ".githooks\n" })).toEqual({ punkt: "Git-Hooks", ok: true });
  });
  test("nicht gesetzt (null oder leer): Lücke mit dem Befehl als Fix", () => {
    for (const w of [null, "", "  \n"]) {
      const p = gitHooksPunkt({ lesen: () => w });
      expect(p.ok).toBe(false);
      expect(p.nichtPruefbar).toBeUndefined();
      expect(p.befund).toContain("nicht gesetzt");
      expect(p.fix).toBe("git config core.hooksPath .githooks");
    }
  });
  test("anderer Wert: Lücke, der Befund nennt den Wert", () => {
    const p = gitHooksPunkt({ lesen: () => ".husky" });
    expect(p.ok).toBe(false);
    expect(p.befund).toContain(".husky");
    expect(p.fix).toBe("git config core.hooksPath .githooks");
  });
  test("Lesefehler: NICHT PRÜFBAR", () => {
    const p = gitHooksPunkt({ lesen: () => { throw new Error("git fehlt"); } });
    expect(p.nichtPruefbar).toBe(true);
    expect(p.befund).toContain("git fehlt");
  });
  test("Lesefehler als Text oder null statt Error", () => {
    expect(gitHooksPunkt({ lesen: () => wirf("kaputt") }).befund).toContain("kaputt");
    expect(gitHooksPunkt({ lesen: () => wirf(null) }).nichtPruefbar).toBe(true);
  });
  test("echtes git: der Standard liest den gesetzten Wert und meldet ungesetzt als null (globale und System-Konfiguration ausgeblendet)", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "hooks-"));
    try {
      const leer = join(wurzel, "leere-config");
      writeFileSync(leer, "");
      vi.stubEnv("GIT_CONFIG_GLOBAL", leer);
      vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
      const repo = join(wurzel, "repo");
      execFileSync("git", ["init", "-q", repo]);
      const lesen = gitHooksStandard({ rootDir: repo });
      expect(lesen()).toBeNull();
      execFileSync("git", ["-C", repo, "config", "core.hooksPath", ".githooks"]);
      expect(lesen()).toBe(".githooks");
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
  describe("gitHooksStandard liest `git config core.hooksPath` im Prüf-Root", () => {
    const stand = (r: { status: number | null; stdout?: string; error?: Error }) => {
      const aufrufe: unknown[][] = [];
      const lesen = gitHooksStandard({ rootDir: "/wurzel", exec: (c, a, o) => { aufrufe.push([c, a, o]); return { stdout: "", ...r }; } });
      return { aufrufe, lesen };
    };
    test("Wert, ungesetzt (Exit 1), Fehler", () => {
      const a = stand({ status: 0, stdout: ".githooks\n" });
      expect(a.lesen()).toBe(".githooks");
      expect(a.aufrufe[0][0]).toBe("git");
      expect(a.aufrufe[0][1]).toEqual(["-C", "/wurzel", "config", "--get", "core.hooksPath"]);
      expect(stand({ status: 1 }).lesen()).toBeNull();
      expect(() => stand({ status: 128, stdout: "" }).lesen()).toThrow(/128/);
      expect(() => stand({ status: null, error: new Error("ENOENT") }).lesen()).toThrow(/ENOENT/);
    });
  });
});
