/* Besitz-Profil (factory#519): Blatt-Lib für Wahl, Form- und Manifest-Prüfung. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/profil-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../scripts/besitz-lib.mjs";

const lib = raw as unknown as {
  PROFIL_STANDARD: string;
  gewaehltesProfil(c: unknown): string;
  profilGewaehlt(e: { profil?: string }, p: string): boolean;
  profilFormFehler(c: unknown): string[];
  profilImportErlaubt(von: { profil?: string }, nach: { profil?: string }): boolean;
  profilFehler(e: Record<string, unknown>): string[];
  istSicherheitsEinstieg(p: string): boolean;
};
const pruefeManifest = (rawBesitz as unknown as { pruefeManifest: (m: unknown, lies: (p: string) => string | null) => string[] }).pruefeManifest;

describe("Wahl", () => {
  test("ohne Schlüssel gilt voll, ungültiger Wert fällt auf voll zurück", () => {
    expect(lib.gewaehltesProfil({})).toBe("voll");
    expect(lib.gewaehltesProfil({ profil: "minimal" })).toBe("minimal");
    expect(lib.gewaehltesProfil({ profil: "klein" })).toBe("voll");
    expect(lib.gewaehltesProfil(null)).toBe(lib.PROFIL_STANDARD);
  });
  test("nur profil voll fällt bei minimal weg", () => {
    expect(lib.profilGewaehlt({ profil: "voll" }, "minimal")).toBe(false);
    expect(lib.profilGewaehlt({ profil: "voll" }, "voll")).toBe(true);
    expect(lib.profilGewaehlt({}, "minimal")).toBe(true);
  });
});

describe("Formfehler der Config", () => {
  test("gültig oder fehlend ist leer", () => {
    expect(lib.profilFormFehler({})).toEqual([]);
    expect(lib.profilFormFehler({ profil: "minimal" })).toEqual([]);
  });
  test("unbekannter Name und falscher Typ melden mit Fix", () => {
    for (const w of ["klein", 5, null, ["minimal"]]) {
      const f = lib.profilFormFehler({ profil: w });
      expect(f).toHaveLength(1);
      expect(f[0]).toContain("Fix:");
      expect(f[0]).toContain(JSON.stringify(w));
    }
  });
});

describe("Import-Regel", () => {
  test("eine Einheit ohne profil importiert keine Einheit mit profil", () => {
    expect(lib.profilImportErlaubt({}, { profil: "voll" })).toBe(false);
    expect(lib.profilImportErlaubt({ profil: "voll" }, { profil: "voll" })).toBe(true);
    expect(lib.profilImportErlaubt({ profil: "voll" }, {})).toBe(true);
    expect(lib.profilImportErlaubt({}, {})).toBe(true);
  });
});

describe("Manifest-Fehler des Felds profil", () => {
  const ok = { pfad: "scripts/a.mjs", ring: "kern", profil: "voll" };
  test("gültig und nicht gesetzt sind leer", () => {
    expect(lib.profilFehler(ok)).toEqual([]);
    expect(lib.profilFehler({ pfad: "scripts/a.mjs", ring: "kern" })).toEqual([]);
  });
  test.each([
    ["anderer Wert", { ...ok, profil: "minimal" }],
    ["Workflow", { ...ok, pfad: ".github/workflows/x.yml" }],
    ["pflichtChecks", { ...ok, pflichtChecks: ["x"] }],
    ["modul", { ...ok, modul: "codeql" }],
    ["Ring oberflaeche", { ...ok, ring: "oberflaeche" }],
    ["block", { ...ok, block: "b" }],
    ["schluessel", { ...ok, schluessel: "k" }],
    ["art", { ...ok, art: "vorlage" }],
  ])("Verbot: %s", (_n, e) => {
    expect(lib.profilFehler(e as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});

describe("pruefeManifest", () => {
  const manifest = (e: Record<string, unknown>) => ({ version: 3, eintraege: [{ pfad: "scripts/a.mjs", ring: "kern", quelle: "x", ...e }] });
  const lies = () => "x";
  test("profil voll an einer Datei ist gültig", () => {
    expect(pruefeManifest(manifest({ profil: "voll" }), lies)).toEqual([]);
  });
  test("profil an einem Workflow ist ein Manifest-Fehler", () => {
    const f = pruefeManifest(manifest({ pfad: ".github/workflows/x.yml", profil: "voll" }), lies);
    expect(f.join("\n")).toContain("profil nicht an einem Workflow");
  });
});

describe("Sicherheits-Einstiege", () => {
  test.each(["scripts/pretooluse-hook.mjs", "scripts/check-arch.mjs", "scripts/risikostufe-lib.mjs", ".github/workflows/ci.yml", "x/review-lenses/SKILL.md", ".claude/agents/rolle.md"])("%s ist Einstieg", (p) => {
    expect(lib.istSicherheitsEinstieg(p)).toBe(true);
  });
  test.each([".agents/skills/review-lenses/brille-x.md", ".githooks/post-commit"])("%s ist Einstieg (tiefer Pfad)", (p) => {
    expect(lib.istSicherheitsEinstieg(p)).toBe(true);
  });
  test.each(["scripts/sub/check-x.mjs", "x/scripts/check-a.mjs", "scripts/check-a.mjs.bak", "scripts/check-aXmjs"])("%s ist kein Einstieg (Muster verankert, * nur ein Segment)", (p) => {
    expect(lib.istSicherheitsEinstieg(p)).toBe(false);
  });
  test.each(["scripts/cockpit.mjs", "scripts/codex-lib.mjs", "docs/x.md"])("%s ist kein Einstieg", (p) => {
    expect(lib.istSicherheitsEinstieg(p)).toBe(false);
  });
});
