import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeAudit } from "../scripts/projekt-config-bloecke.mjs";

const pruefe = pruefeAudit as (b: unknown) => string[];

describe("pruefeAudit (factory#395 L54)", () => {
  test("ohne Block, leere Liste und gültige Verzeichnisse: keine Fehler", () => {
    expect(pruefe(undefined)).toEqual([]);
    expect(pruefe({ verzeichnisse: [] })).toEqual([]);
    expect(pruefe({ verzeichnisse: ["frontend", "tools/web"] })).toEqual([]);
  });

  test.each(["/etc", "C:/x", "../x", "a/../b", "a\\b", ".", "", "  ", "a//b", "a/"])("lehnt %j ab", (p) => {
    expect(pruefe({ verzeichnisse: [p] }).join("\n")).toMatch(/audit\.verzeichnisse\[0\]/);
  });

  test("Nicht-Text, kein Objekt, unbekannter Schlüssel, fehlende Liste und Doppelte sind Fehler", () => {
    expect(pruefe({ verzeichnisse: [3] }).join("\n")).toMatch(/audit\.verzeichnisse\[0\] muss ein nicht-leerer/);
    for (const kein of [null, [], "x", 3]) expect(pruefe(kein).join("\n")).toMatch(/audit muss ein Objekt/);
    expect(pruefe({ verzeichnisse: [], extra: 1 }).join("\n")).toMatch(/audit\.extra ist kein bekannter Schlüssel/);
    expect(pruefe({}).join("\n")).toMatch(/audit\.verzeichnisse muss eine Liste/);
    expect(pruefe({ verzeichnisse: "frontend" }).join("\n")).toMatch(/audit\.verzeichnisse muss eine Liste/);
    expect(pruefe({ verzeichnisse: ["a", "a"] }).join("\n")).toMatch(/audit\.verzeichnisse enthält a doppelt/);
  });
});
