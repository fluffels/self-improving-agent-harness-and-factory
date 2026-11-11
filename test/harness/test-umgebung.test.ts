/* Test-Umgebungs-Wächter (factory#332) – Prozess-Tests erben keine Zugangs-Variablen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Regel: vite.config.ts lädt test/support/zugaenge-entfernen.ts als setupFiles; sie löscht LANGFUSE_*, GH_TOKEN und
 * GITHUB_TOKEN aus process.env jedes Testworkers, damit auch ein Kindprozess (spawnSync, Skript-Lauf) nie einen echten
 * Zugang erbt (kein Live-Weg, kein Dispatch durch eine Regression).
 * Grenze: das Setup entfernt nur Umgebungsvariablen. Zugänge in Keyring, Dateien (~/.config/gh) oder selbst gesetzte
 * Fake-Werte, die ein Test absichtlich einsetzt, bleiben unberührt; ein Test mit Kind-Umgebung räumt sie selbst.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { istZugang } from "../support/zugaenge";

const WURZEL = join(__dirname, "..", "..");

describe("Test-Umgebung ohne Zugangs-Variablen", () => {
  it("vite.config.ts lädt das Setup zugaenge-entfernen.ts", () => {
    const text = readFileSync(join(WURZEL, "vite.config.ts"), "utf8");
    expect(text).toMatch(/setupFiles:\s*\[[^\]]*test\/support\/zugaenge-entfernen\.ts/u);
  });

  it("istZugang erkennt LANGFUSE_*, GH_TOKEN, GITHUB_TOKEN und sonst nichts", () => {
    expect(["LANGFUSE_SECRET_KEY", "LANGFUSE_HOST", "GH_TOKEN", "GITHUB_TOKEN"].filter(istZugang)).toHaveLength(4);
    expect(["PATH", "HOME", "GITHUB_ACTIONS", "NOT_LANGFUSE_X"].filter(istZugang)).toEqual([]);
  });

  it("process.env des Testworkers hat keinen Zugangs-Schlüssel", () => {
    expect(Object.keys(process.env).filter(istZugang)).toEqual([]);
  });

  it("das Setup löscht gesetzte Zugangs-Variablen, unabhängig von der Umgebung des Laufs", async () => {
    process.env.LANGFUSE_PROBE = "x";
    process.env.GH_TOKEN = "x";
    process.env.GITHUB_TOKEN = "x";
    process.env.NICHT_ZUGANG = "x";
    vi.resetModules();
    await import("../support/zugaenge-entfernen");
    expect(Object.keys(process.env).filter(istZugang)).toEqual([]);
    expect(process.env.NICHT_ZUGANG).toBe("x");
    delete process.env.NICHT_ZUGANG;
  });

  it("ein Kindprozess sieht keinen Zugangs-Schlüssel", () => {
    const r = spawnSync(process.execPath, ["-e", "console.log(Object.keys(process.env).filter(k => k.startsWith('LANGFUSE_') || k === 'GH_TOKEN' || k === 'GITHUB_TOKEN').join(','))"], { encoding: "utf8" });
    expect(r.stdout.trim()).toBe("");
  });
});
