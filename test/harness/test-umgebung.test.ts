/* Test-Umgebungs-Wächter (factory#332) – Prozess-Tests erben keine Zugangs-Variablen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Regel: vite.config.ts lädt test/support/zugaenge-entfernen.ts als setupFiles; sie löscht LANGFUSE_*, GH_TOKEN,
 * GITHUB_TOKEN, PROJECT_TOKEN und die GH_/GITHUB_ENTERPRISE_TOKEN aus process.env jedes Testworkers und setzt
 * GH_CONFIG_DIR auf einen leeren Ordner (gh findet weder Keyring-Anmeldung noch ~/.config/gh), damit auch ein
 * Kindprozess (spawnSync, Skript-Lauf) nie einen echten Zugang erbt und kein gh-Schreibaufruf gelingt (factory#398).
 * Grenze: die Sperre wirkt nur, wenn die Kind-Umgebung aus process.env abgeleitet ist (geerbt oder
 * env: { ...process.env, … }); eine von Grund auf gebaute Umgebung (env: { PATH: … }) verliert sie. Selbst gesetzte
 * Fake-Werte, die ein Test absichtlich einsetzt, bleiben unberührt; ein Test mit Kind-Umgebung räumt sie selbst.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { istZugang } from "../support/zugaenge";

const WURZEL = join(__dirname, "..", "..");
const TOKEN_NAMEN = ["GH_TOKEN", "GITHUB_TOKEN", "PROJECT_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
const GH_FEHLT = spawnSync("gh", ["--version"]).status !== 0;

describe("Test-Umgebung ohne Zugangs-Variablen", () => {
  it("vite.config.ts lädt das Setup zugaenge-entfernen.ts", () => {
    const text = readFileSync(join(WURZEL, "vite.config.ts"), "utf8");
    expect(text).toMatch(/setupFiles:\s*\[[^\]]*test\/support\/zugaenge-entfernen\.ts/u);
  });

  it("istZugang erkennt LANGFUSE_*, GH_TOKEN, GITHUB_TOKEN und sonst nichts", () => {
    expect(["LANGFUSE_SECRET_KEY", "LANGFUSE_HOST", "GH_TOKEN", "GITHUB_TOKEN"].filter(istZugang)).toHaveLength(4);
    expect(["PATH", "HOME", "GITHUB_ACTIONS", "NOT_LANGFUSE_X"].filter(istZugang)).toEqual([]);
  });

  it("istZugang erkennt auch PROJECT_TOKEN und die Enterprise-Token", () => {
    expect(TOKEN_NAMEN.filter(istZugang)).toEqual(TOKEN_NAMEN);
    expect(["GH_HOST", "PROJECT_TOKENS", "GH_CONFIG_DIR"].filter(istZugang)).toEqual([]);
  });

  it("GH_CONFIG_DIR zeigt auf einen Ordner ohne hosts.yml (gh ohne Anmeldung)", () => {
    const dir = process.env.GH_CONFIG_DIR ?? "";
    expect(dir).not.toBe("");
    expect(existsSync(dir)).toBe(true);
    expect(existsSync(join(dir, "hosts.yml"))).toBe(false);
  });

  it.skipIf(GH_FEHLT)("echtes gh (Leseaufruf) ist abgemeldet: Exit 4 und 'gh auth login'", () => {
    const r = spawnSync("gh", ["api", "user"], { encoding: "utf8" });
    expect(r.status).toBe(4);
    expect(r.stderr).toMatch(/gh auth login/u);
  });

  it("process.env des Testworkers hat keinen Zugangs-Schlüssel", () => {
    expect(Object.keys(process.env).filter(istZugang)).toEqual([]);
  });

  it("das Setup löscht gesetzte Zugangs-Variablen, unabhängig von der Umgebung des Laufs", async () => {
    process.env.LANGFUSE_PROBE = "x";
    process.env.GH_TOKEN = "x";
    process.env.GITHUB_TOKEN = "x";
    process.env.PROJECT_TOKEN = "x";
    process.env.NICHT_ZUGANG = "x";
    vi.resetModules();
    await import("../support/zugaenge-entfernen");
    expect(Object.keys(process.env).filter(istZugang)).toEqual([]);
    expect(process.env.NICHT_ZUGANG).toBe("x");
    delete process.env.NICHT_ZUGANG;
  });

  it("ein Kindprozess sieht keinen Zugangs-Schlüssel, aber GH_CONFIG_DIR", () => {
    const skript = "const n = JSON.parse(process.argv[1]); console.log(Object.keys(process.env).filter(k => k.startsWith('LANGFUSE_') || n.includes(k)).join(',') + '|' + (process.env.GH_CONFIG_DIR ?? ''))";
    const r = spawnSync(process.execPath, ["-e", skript, JSON.stringify(TOKEN_NAMEN)], { encoding: "utf8", env: { ...process.env, PROJECT_TOKEN: "" } });
    expect(r.stdout.trim()).toBe(`PROJECT_TOKEN|${process.env.GH_CONFIG_DIR}`);
    const sauber = spawnSync(process.execPath, ["-e", skript, JSON.stringify(TOKEN_NAMEN)], { encoding: "utf8" });
    expect(sauber.stdout.trim()).toBe(`|${process.env.GH_CONFIG_DIR}`);
  });
});
