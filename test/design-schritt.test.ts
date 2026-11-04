import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/design-lib.mjs";

const D = raw as unknown as {
  pruefeDesign: (b: unknown) => string[];
  designAus: (c: unknown) => { label: string; freigabe: string; system: string } | null;
  designGrund: (labels: string[], c: unknown) => string;
};
const BLOCK = { label: "ui", freigabe: "design-ok", system: "docs/design/system.md" };
const CFG = { design: BLOCK };

describe("pruefeDesign", () => {
  test("gültiger Block ist grün", () => {
    expect(D.pruefeDesign(BLOCK)).toEqual([]);
    expect(D.pruefeDesign(undefined)).toEqual([]);
  });
  test("kein Objekt, fehlende oder leere Schlüssel, gleiche Labels", () => {
    expect(D.pruefeDesign("ui")[0]).toMatch(/Objekt/);
    expect(D.pruefeDesign(null)[0]).toMatch(/Objekt/);
    expect(D.pruefeDesign([])).toEqual(["design muss ein Objekt mit label, freigabe und system sein"]);
    for (const k of ["label", "freigabe", "system"]) {
      expect(D.pruefeDesign({ ...BLOCK, [k]: undefined }).join("|")).toContain(`design.${k} `);
      expect(D.pruefeDesign({ ...BLOCK, [k]: " " }).join("|")).toContain(`design.${k} `);
    }
    expect(D.pruefeDesign({ ...BLOCK, freigabe: "UI" }).join("|")).toMatch(/verschieden/);
  });
  test("design.system ist ein relativer POSIX-Pfad (Folge #172)", () => {
    for (const system of ["/abs", "..\\x", "../x", "C:/x", "a//b", "a/"]) {
      expect(D.pruefeDesign({ ...BLOCK, system }).join("|"), system).toMatch(/design\.system muss ein relativer POSIX-Pfad sein/);
    }
    expect(D.pruefeDesign({ ...BLOCK, system: "docs/design/system.md" })).toEqual([]);
  });
});

describe("designAus", () => {
  test("ohne Block null, mit Block die drei Werte, unvollständig wirft", () => {
    expect(D.designAus({})).toBeNull();
    expect(D.designAus(undefined)).toBeNull();
    expect(D.designAus(CFG)).toEqual(BLOCK);
    expect(() => D.designAus({ design: { label: "ui" } })).toThrow(/design\.freigabe/);
  });
});

describe("designGrund (K2, K3)", () => {
  test("ohne Block oder ohne Design-Label: kein Grund (läuft wie bisher)", () => {
    expect(D.designGrund(["ui"], {})).toBe("");
    expect(D.designGrund(["bug"], CFG)).toBe("");
    expect(D.designGrund(["design-ok"], CFG)).toBe("");
  });
  test("Design-Label ohne Freigabe nennt beide Labels (K3)", () => {
    const g = D.designGrund(["ui"], CFG);
    expect(g).toContain("Design-Entwurf nicht freigegeben");
    expect(g).toContain("ui");
    expect(g).toContain("design-ok");
  });
  test("beide Labels: frei; Groß-/Kleinschreibung zählt nicht", () => {
    expect(D.designGrund(["ui", "design-ok"], CFG)).toBe("");
    expect(D.designGrund(["UI"], CFG)).not.toBe("");
    expect(D.designGrund(["ui", "area:x"], CFG)).toContain("nicht freigegeben");
    expect(D.designGrund(["area:x", "ui", "design-ok"], CFG)).toBe("");
    expect(D.designGrund([" ui "], CFG)).not.toBe("");
    expect(D.designGrund(["ui"], { design: { label: " ui ", freigabe: "design-ok", system: "s" } })).toContain("nicht freigegeben");
    expect(D.pruefeDesign({ ...BLOCK, freigabe: "ui " }).join("|")).toMatch(/verschieden/);
    expect(D.designGrund(["UI", "Design-OK"], CFG)).toBe("");
  });
  test("unvollständiger Block wirft", () => {
    expect(() => D.designGrund(["ui"], { design: { label: "ui", freigabe: "x" } })).toThrow(/design\.system/);
  });
});

describe("Textanker (K2)", () => {
  const lies = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  test("Ablauf und Planer kennen den Schritt", () => {
    const ablauf = lies(".agents/skills/factory/ablauf.md");
    for (const s of ["design.label", "design.freigabe", "DESIGN-ENTWURF FEHLT"]) expect(ablauf).toContain(s);
    const planer = lies(".claude/agents/factory-planer.md");
    expect(planer).toContain("DESIGN-ENTWURF FEHLT #<nr> · <agenten.planer>");
    expect(planer).toContain("projekt-config.mjs design.label");
  });
});
