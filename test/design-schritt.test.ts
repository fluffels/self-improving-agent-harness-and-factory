import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/design-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as schritt from "../scripts/design-schritt.mjs";

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
    expect(planer).toContain("design-schritt.mjs --issue <nr>");
    expect(planer).not.toContain("projekt-config.mjs design.label");
  });
});

describe("designZustand und design-schritt (factory#162 L47)", () => {
  const Z = raw as unknown as { designZustand: (d: unknown, labels: string[]) => string };
  test("ohne Block oder ohne Design-Label: aus; Design-Label ohne Freigabe: entwurf-fehlt; mit beiden: freigegeben", () => {
    expect(Z.designZustand(undefined, ["ui"])).toBe("aus");
    expect(Z.designZustand(BLOCK, ["area:x"])).toBe("aus");
    expect(Z.designZustand(BLOCK, [])).toBe("aus");
    expect(Z.designZustand(BLOCK, ["ui"])).toBe("entwurf-fehlt");
    expect(Z.designZustand(BLOCK, ["UI", "area:x"])).toBe("entwurf-fehlt");
    expect(Z.designZustand(BLOCK, ["ui", "design-ok"])).toBe("freigegeben");
    expect(Z.designZustand(BLOCK, ["design-ok"])).toBe("aus");
  });
  test("ein unvollständiger Block wirft (kein stiller Standardwert)", () => {
    expect(() => Z.designZustand({ label: "ui", freigabe: "x" }, ["ui"])).toThrow(/design\.system/);
  });
  test("designGrund und designZustand sind dieselbe Entscheidung", () => {
    for (const labels of [[], ["ui"], ["ui", "design-ok"], ["design-ok"]]) {
      expect(D.designGrund(labels, CFG) !== "").toBe(Z.designZustand(BLOCK, labels) === "entwurf-fehlt");
    }
  });
});

describe("scripts/design-schritt.mjs: lauf", () => {
  const S = schritt as unknown as {
    lauf: (argv: string[], u: { design: unknown; labels: (nr: string) => string[] }) => { code: number; out: string; err: string };
    echteQuellen: (lade: (o: { pruefen: boolean }) => { design?: unknown }) => { design: unknown; labels: (nr: string) => string[] };
  };
  const u = (labels: string[], design: unknown = BLOCK) => ({ design, labels: () => labels });
  test("Ausgabe design: <zustand>, Exit 3 nur bei entwurf-fehlt", () => {
    expect(S.lauf(["--issue", "5"], u(["x"]))).toEqual({ code: 0, out: "design: aus\n", err: "" });
    expect(S.lauf(["--issue", "5"], u(["ui", "design-ok"]))).toEqual({ code: 0, out: "design: freigegeben\n", err: "" });
    const r = S.lauf(["--issue", "5"], u(["ui"]));
    expect(r.code).toBe(3);
    expect(r.out).toBe("design: entwurf-fehlt\n");
    expect(S.lauf(["--issue", "5"], { design: undefined, labels: () => ["ui"] })).toEqual({ code: 0, out: "design: aus\n", err: "" });
  });
  test("die Labels kommen vom Ticket der Nummer", () => {
    const gesehen: string[] = [];
    S.lauf(["--issue", "162"], { design: BLOCK, labels: (nr) => (gesehen.push(nr), []) });
    expect(gesehen).toEqual(["162"]);
  });
  test("scheitert das Laden der Config, ist das Ergebnis Exit 2 ohne design-Zeile, nie ein stilles aus (L47)", () => {
    const q = S.echteQuellen(() => {
      throw new Error("kein gültiges JSON");
    });
    const r = S.lauf(["--issue", "1"], q);
    expect(r.code).toBe(2);
    expect(r.out).toBe("");
    expect(r.err).toContain("kein gültiges JSON");
  });
  test("Aufruf-Fehler (ohne --issue, keine Zahl, unbekannte Option) sind Exit 2; ein ungültiger Block ebenso", () => {
    for (const argv of [[], ["--issue"], ["--issue", "abc"], ["--issue", "0"], ["--issue", "1", "--x"], ["5"]]) {
      const r = S.lauf(argv, u([]));
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.out).toBe("");
      expect(r.err).toMatch(/design-schritt/);
    }
    const kaputt = S.lauf(["--issue", "1"], u(["ui"], { label: "ui" }));
    expect(kaputt.code).toBe(2);
    expect(kaputt.err).toContain("design.freigabe");
  });
});
