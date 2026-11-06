/* istBezieher (factory#202 L20): Bezieher ist, wer einen Sync-Stand hat; ein kaputter Stand zählt mit (fail-closed), nur eine fehlende Datei macht ein Projekt zur Fabrik. */
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sync-stand-lib.mjs";

const T = raw as unknown as { istBezieher: (wurzel: string) => boolean };

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

function wurzelMit(stand: string | null): string {
  const w = mkdtempSync(join(tmpdir(), "sih-bezieher-"));
  temps.push(w);
  if (stand !== null) {
    mkdirSync(join(w, ".factory"));
    writeFileSync(join(w, ".factory", "sync-stand.json"), stand);
  }
  return w;
}

describe("istBezieher", () => {
  test("ohne Sync-Stand: keine Fabrik-Bezieher", () => {
    expect(T.istBezieher(wurzelMit(null))).toBe(false);
  });
  test("mit Sync-Stand: Bezieher", () => {
    expect(T.istBezieher(wurzelMit('{"quelle":{"tag":"v1"}}'))).toBe(true);
  });
  test("nicht lesbarer Sync-Stand (Ordner statt Datei) zählt wie ein fehlender", () => {
    const w = wurzelMit(null);
    mkdirSync(join(w, ".factory"), { recursive: true });
    mkdirSync(join(w, ".factory", "sync-stand.json"));
    expect(T.istBezieher(w)).toBe(false);
  });
  test("kaputter Sync-Stand zählt als Bezieher (fail-closed)", () => {
    expect(T.istBezieher(wurzelMit("{kaputt"))).toBe(true);
  });
});
