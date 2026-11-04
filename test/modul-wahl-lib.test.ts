/* Sicherheits-Module (factory#119): Blatt-Lib für Auswahl, Form- und Manifest-Prüfung. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/modul-wahl-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../scripts/besitz-lib.mjs";

interface Wahl {
  gewaehlt: string[];
  erlaubt: string[];
  nichtGewaehlt: string[];
  fehlt: boolean;
  fehler: string[];
}
const lib = raw as unknown as {
  MODUL_STANDARD: string[];
  modulNamenAus(m: unknown): string[];
  gewaehlteModule(c: unknown): string[];
  modulGewaehlt(e: { modul?: string }, g: string[]): boolean;
  modulImportErlaubt(von: { modul?: string }, nach: { modul?: string }): boolean;
  modulFormFehler(c: unknown): string[];
  modulWahl(c: unknown, m: unknown, o?: { configPfad: string }): Wahl;
  modulFehler(e: Record<string, unknown>): string[];
  manifestKenntModule(m: unknown): boolean;
  modulAufteilung(v: { pfad: string; modul?: string }[], id: (e: { pfad: string }) => string, w: { gewaehlt: string[]; unbestimmt: boolean }): { aktiv: { pfad: string }[]; abgewaehlt: Map<string, string>; modulIds: Set<string> };
};
const pruefeManifest = (rawBesitz as unknown as { pruefeManifest: (m: unknown, lies: (p: string) => string | null) => string[] }).pruefeManifest;

const manifest = { eintraege: [{ pfad: "a.yml", modul: "codeql" }, { pfad: "b.yml", modul: "zizmor" }, { pfad: "c.yml", modul: "codeql" }, { pfad: "d.mjs" }] };
const CODEQL_OK = { module: ["codeql"], codeql: { sprachen: ["python"] } };

describe("Auswahl", () => {
  test("ohne Schlüssel gilt der Standard", () => {
    expect(lib.gewaehlteModule({})).toEqual(["dependabot-inbox"]);
    expect(lib.gewaehlteModule({ module: ["zizmor"] })).toEqual(["zizmor"]);
    expect(lib.gewaehlteModule({ module: [] })).toEqual([]);
  });
  test("Namen sortiert und ohne Doppelte; Einheit ohne modul wird immer verteilt", () => {
    expect(lib.modulNamenAus(manifest)).toEqual(["codeql", "zizmor"]);
    expect(lib.modulGewaehlt({}, [])).toBe(true);
    expect(lib.modulGewaehlt({ modul: "codeql" }, [])).toBe(false);
    expect(lib.modulGewaehlt({ modul: "codeql" }, ["codeql"])).toBe(true);
  });
  test("Importregel: Kern importiert kein Modul, ein Modul nur sich selbst", () => {
    expect(lib.modulImportErlaubt({}, { modul: "codeql" })).toBe(false);
    expect(lib.modulImportErlaubt({ modul: "codeql" }, { modul: "zizmor" })).toBe(false);
    expect(lib.modulImportErlaubt({ modul: "codeql" }, { modul: "codeql" })).toBe(true);
    expect(lib.modulImportErlaubt({ modul: "codeql" }, {})).toBe(true);
  });
});

describe("modulFormFehler", () => {
  test("gültige Fälle", () => {
    expect(lib.modulFormFehler({})).toEqual([]);
    expect(lib.modulFormFehler({ module: [] })).toEqual([]);
    expect(lib.modulFormFehler({ module: ["zizmor"], codeql: { sprachen: ["python"] } })).toEqual([]);
    expect(lib.modulFormFehler({ codeql: { sprachen: ["python"] } })).toEqual([]);
    expect(lib.modulFormFehler(CODEQL_OK)).toEqual([]);
  });
  test.each([
    ["keine Liste", { module: "codeql" }],
    ["Großbuchstabe", { module: ["CodeQL"] }],
    ["kein Text", { module: [1] }],
    ["gültiger Anfang, ungültiger Rest", { module: ["codeQL"] }],
    ["Leerzeichen im Namen", { module: ["code ql"] }],
  ])("module ungültig: %s", (_n, c) => {
    const f = lib.modulFormFehler(c);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]).toContain("Fix:");
  });
  test("Doppelte", () => {
    expect(lib.modulFormFehler({ module: ["zizmor", "zizmor"] })[0]).toContain("doppelt");
  });
  test.each([
    ["ohne codeql", { module: ["codeql"] }],
    ["ohne sprachen", { module: ["codeql"], codeql: {} }],
    ["leere sprachen", { module: ["codeql"], codeql: { sprachen: [] } }],
    ["leere Sprache", { module: ["codeql"], codeql: { sprachen: [""] } }],
    ["sprachen keine Liste", { module: ["codeql"], codeql: { sprachen: "python" } }],
    ["codeql kein Objekt", { codeql: "python" }],
    ["codeql null", { codeql: null }],
    ["Sprache mit Sonderzeichen", { module: ["codeql"], codeql: { sprachen: ["c++"] } }],
  ])("codeql.sprachen fehlt oder ist ungültig: %s", (_n, c) => {
    const f = lib.modulFormFehler(c);
    expect(f.length).toBeGreaterThan(0);
    expect(f.join("\n")).toContain("codeql.sprachen");
    expect(f.join("\n")).toContain("Fix:");
  });
});

describe("modulWahl", () => {
  test("unbekannter Name: Fehler mit Fix und den wählbaren Namen", () => {
    const w = lib.modulWahl({ module: ["gibtsnicht"] }, manifest, { configPfad: "cfg.json" });
    expect(w.fehler).toHaveLength(1);
    expect(w.fehler[0]).toContain("gibtsnicht");
    expect(w.fehler[0]).toContain("cfg.json");
    expect(w.fehler[0]).toContain("Fix:");
    expect(w.fehler[0]).toContain("codeql, zizmor");
  });
  test("Teilwahl", () => {
    const w = lib.modulWahl({ module: ["zizmor"] }, manifest);
    expect(w).toMatchObject({ gewaehlt: ["zizmor"], nichtGewaehlt: ["codeql"], fehlt: false, fehler: [] });
    expect(lib.modulWahl({}, manifest).fehlt).toBe(true);
  });
});

describe("modulFehler (Manifest)", () => {
  test("gültig und ohne Feld", () => {
    expect(lib.modulFehler({ pfad: "x.yml", ring: "kern" })).toEqual([]);
    expect(lib.modulFehler({ pfad: "x.yml", ring: "kern", modul: "codeql" })).toEqual([]);
  });
  test.each([
    ["kaputter Name", { modul: "Code QL", ring: "kern" }, "Name"],
    ["Name mit ungültigem Rest", { modul: "code ql", ring: "kern" }, "Name"],
    ["an einem Block", { modul: "codeql", ring: "kern", block: "b" }, "ganzen Datei"],
    ["an einem Schlüssel", { modul: "codeql", ring: "kern", schluessel: "k" }, "ganzen Datei"],
    ["mit art vorlage", { modul: "codeql", ring: "kern", art: "vorlage" }, "art"],
    ["mit pflichtChecks", { modul: "codeql", ring: "kern", pflichtChecks: ["x"] }, "pflichtChecks"],
    ["im Ring oberflaeche", { modul: "codeql", ring: "oberflaeche" }, "oberflaeche"],
  ])("Fehler: %s", (_n, e, teil) => {
    expect(lib.modulFehler(e).join("\n")).toContain(teil);
  });
});

describe("manifestKenntModule und modulAufteilung", () => {
  const id = (e: { pfad: string }) => e.pfad;
  const verteilt = manifest.eintraege;
  test("kennt Module nur bei einem modul-Feld (auch ohne Manifest)", () => {
    expect(lib.manifestKenntModule(manifest)).toBe(true);
    expect(lib.manifestKenntModule({ eintraege: [{ pfad: "d.mjs" }] })).toBe(false);
    expect(lib.manifestKenntModule(null)).toBe(false);
    expect(lib.manifestKenntModule({})).toBe(false);
  });
  test("teilt nach der Wahl: gewählte und Einheiten ohne Modul aktiv, andere abgewählt", () => {
    const t = lib.modulAufteilung(verteilt, id, { gewaehlt: ["zizmor"], unbestimmt: false });
    expect(t.aktiv.map(id)).toEqual(["b.yml", "d.mjs"]);
    expect([...t.abgewaehlt]).toEqual([["a.yml", "codeql"], ["c.yml", "codeql"]]);
    expect([...t.modulIds]).toEqual(["a.yml", "b.yml", "c.yml"]);
  });
  test("unbestimmte Wahl: nur Einheiten ohne Modul aktiv, nichts abgewählt", () => {
    const t = lib.modulAufteilung(verteilt, id, { gewaehlt: [], unbestimmt: true });
    expect(t.aktiv.map(id)).toEqual(["d.mjs"]);
    expect(t.abgewaehlt.size).toBe(0);
    expect(t.modulIds.size).toBe(3);
  });
  test("Import-Regel: ein Modul importiert Kern-Einheiten (ghsa-lib), nie ein fremdes Modul", () => {
    const audit = { modul: "audit-einordnung" };
    expect(lib.modulImportErlaubt(audit, {})).toBe(true);
    expect(lib.modulImportErlaubt(audit, { modul: "codescanning-inbox" })).toBe(false);
    expect(lib.modulImportErlaubt({}, audit)).toBe(false);
  });
});

describe("pruefeManifest und modul", () => {
  const m = (version: number, modul?: string) => ({ version, eintraege: [{ pfad: "x.yml", ring: "kern", quelle: "q", ...(modul ? { modul } : {}) }] });
  const lies = () => "text";
  test("modul braucht Version 3", () => {
    expect(pruefeManifest(m(2, "codeql"), lies).join("\n")).toContain("modul braucht version 3");
    expect(pruefeManifest(m(3, "codeql"), lies)).toEqual([]);
    expect(pruefeManifest(m(3), lies)).toEqual([]);
  });
  test("modul mit Version 1 ist ein Fehler", () => {
    expect(pruefeManifest(m(1, "codeql"), lies).join("\n")).toContain("modul braucht version 3");
  });
  test("Version 4 ist unbekannt", () => {
    expect(pruefeManifest(m(4), lies).join("\n")).toContain("version 4 unbekannt");
  });
  test("Feldfehler eines modul-Eintrags erscheinen am Eintrag", () => {
    const k = { version: 3, eintraege: [{ pfad: "x.yml", ring: "kern", quelle: "q", modul: "Falsch" }] };
    expect(pruefeManifest(k, lies).join("\n")).toContain("modul muss ein Name");
  });
});

describe("modul mit Nicht-Text-Wert (#145): eine Einheit gilt als Moduleinheit nur mit Text", () => {
  const id = (e: { pfad: string }) => e.pfad;
  const fremd = { pfad: "x.yml", modul: 5 };
  const mitFremd = { eintraege: [...manifest.eintraege, fremd] };
  test("manifestKenntModule, modulNamenAus, modulGewaehlt und modulAufteilung behandeln modul: 5 gleich (keine Moduleinheit)", () => {
    expect(lib.modulNamenAus(mitFremd)).toEqual(["codeql", "zizmor"]);
    expect(lib.manifestKenntModule({ eintraege: [fremd] })).toBe(false);
    expect(lib.modulGewaehlt(fremd as never, [])).toBe(true);
    expect(lib.modulImportErlaubt({}, fremd as never)).toBe(true);
    expect(lib.modulImportErlaubt({ modul: "codeql" }, fremd as never)).toBe(true);
    for (const unbestimmt of [false, true]) {
      const t = lib.modulAufteilung([fremd] as never, id, { gewaehlt: [], unbestimmt });
      expect(t.aktiv.map(id)).toEqual(["x.yml"]);
      expect(t.abgewaehlt.size).toBe(0);
      expect(t.modulIds.size).toBe(0);
    }
  });
  test("modulFehler meldet den Wert trotzdem (Validierung prüft roh)", () => {
    expect(lib.modulFehler({ pfad: "x.yml", ring: "kern", modul: 5 }).join("\n")).toContain("Name");
  });
});

describe("jede Meldung trägt eine Fix-Zeile (#145)", () => {
  test("modulFormFehler und modulWahl().fehler", () => {
    const formen = [{ module: "x" }, { module: ["A"] }, { module: ["a", "a"] }, { module: ["codeql"] }, { codeql: null }, { codeql: { sprachen: "x" } }];
    const meldungen = [...formen.flatMap((c) => lib.modulFormFehler(c)), ...lib.modulWahl({ module: ["gibtsnicht", "auch-nicht"] }, manifest).fehler, ...lib.modulWahl({ module: ["x"] }, { eintraege: [] }).fehler];
    expect(meldungen.length).toBeGreaterThanOrEqual(8);
    for (const m of meldungen) expect(m).toMatch(/\nFix: \S/);
  });
});
