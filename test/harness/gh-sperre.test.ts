/* gh-Sperre-Wächter (factory#541 L4): ein Vitest-Lauf erreicht über `gh` im PATH nie das Netz.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Regel: test/support/gh-sperre.ts (setupFiles) stellt eine Attrappe vor den PATH. */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { describe, expect, it } from "vitest";
import { erlaubt, GH_ECHT_ERLAUBT, ghAttrappe } from "../support/gh-sperre-regeln";

const WURZEL = join(__dirname, "..", "..");

describe("gh-Sperre im Vitest-Lauf", () => {
  it("gh api endet sofort mit Exit 1 und der Sperr-Meldung samt Argumenten", () => {
    const r = spawnSync("gh", ["api", "x"], { encoding: "utf8", timeout: 5000 });
    expect(r.status).toBe(1);
    expect(`${r.stderr}${r.stdout}`).toContain("gh im Vitest-Lauf gesperrt (test/support/gh-sperre.ts)");
    expect(`${r.stderr}${r.stdout}`).toContain("api x");
  });

  it("die Attrappe gibt es für sh und für win32 (gh.cmd)", () => {
    const sh = ghAttrappe("linux");
    const win = ghAttrappe("win32");
    expect(sh.datei).toBe("gh");
    expect(sh.inhalt).toMatch(/^#!\/bin\/sh/u);
    expect(sh.inhalt).toContain("exit 1");
    expect(win.datei).toBe("gh.cmd");
    expect(win.inhalt).toContain("exit /b 1");
    expect(win.inhalt).toContain("gh im Vitest-Lauf gesperrt (test/support/gh-sperre.ts)");
  });

  it("der Sperr-Ordner steht vorn im PATH", () => {
    expect(process.env.PATH?.split(delimiter)[0]).toMatch(/factory-gh-sperre-/u);
  });

  it("Testpfade der Ausnahmeliste behalten den Original-PATH, andere nicht", () => {
    expect(erlaubt(join(WURZEL, "test/ci-laeufe.test.ts"))).toBe(true);
    expect(erlaubt(String.raw`C:\w\test\harness\test-umgebung.test.ts`)).toBe(true);
    expect(erlaubt(join(WURZEL, "test/harness/gh-sperre.test.ts"))).toBe(false);
    expect(erlaubt(undefined)).toBe(false);
  });

  it("die Ausnahmeliste nennt nur existierende Testdateien", () => {
    for (const p of GH_ECHT_ERLAUBT) expect(() => readFileSync(join(WURZEL, p))).not.toThrow();
  });

  it("vite.config.ts lädt das Setup gh-sperre.ts", () => {
    expect(readFileSync(join(WURZEL, "vite.config.ts"), "utf8")).toMatch(/setupFiles:\s*\[[^\]]*test\/support\/gh-sperre\.ts/u);
  });
});
