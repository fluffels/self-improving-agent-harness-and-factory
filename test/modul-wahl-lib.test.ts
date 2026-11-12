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
  modulKopienBefunde(m: unknown, w: { gewaehlt: string[]; unbestimmt?: boolean }, o: { vorhanden(p: string): boolean; imStand(e: { pfad: string }): boolean; kopien: { datei: string; grund: string }[] }): { pfad: string; art: string; modul?: string }[];
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
  test("pflichtChecks sind an einer Moduleinheit erlaubt (der Doctor verlangt sie nur bei vorhandener Workflow-Datei, factory#339)", () => {
    expect(lib.modulFehler({ pfad: ".github/workflows/x.yml", modul: "x", pflichtChecks: ["Job"] })).toEqual([]);
  });
  test.each([
    ["kaputter Name", { modul: "Code QL", ring: "kern" }, "Name"],
    ["Name mit ungültigem Rest", { modul: "code ql", ring: "kern" }, "Name"],
    ["an einem Block", { modul: "codeql", ring: "kern", block: "b" }, "ganzen Datei"],
    ["an einem Schlüssel", { modul: "codeql", ring: "kern", schluessel: "k" }, "ganzen Datei"],
    ["mit art vorlage", { modul: "codeql", ring: "kern", art: "vorlage" }, "art"],
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

describe("modulKopien: Form (factory#244)", () => {
  const ok = { datei: "scripts/x.mjs", grund: "wird hier bewusst anders geführt" };
  test("gültig oder fehlend ist kein Fehler", () => {
    expect(lib.modulFormFehler({ modulKopien: [] })).toEqual([]);
    expect(lib.modulFormFehler({ modulKopien: [ok] })).toEqual([]);
    expect(lib.modulFormFehler({})).toEqual([]);
    expect(lib.modulFormFehler(undefined)).toEqual([]);
  });
  test.each([
    ["keine Liste", { modulKopien: "x" }, /modulKopien muss eine Liste/],
    ["Eintrag kein Objekt", { modulKopien: ["a"] }, /modulKopien\[0\] muss ein Objekt/],
    ["datei mit Backslash", { modulKopien: [{ ...ok, datei: "a\\b" }] }, /datei muss ein repo-relativer POSIX-Pfad/],
    ["datei absolut", { modulKopien: [{ ...ok, datei: "/a" }] }, /datei muss/],
    ["datei mit ..", { modulKopien: [{ ...ok, datei: "a/../b" }] }, /datei muss/],
    ["datei mit .", { modulKopien: [{ ...ok, datei: "a/./b" }] }, /datei muss/],
    ["datei mit leerem Segment", { modulKopien: [{ ...ok, datei: "a//b" }] }, /datei muss/],
    ["Eintrag ist eine Liste", { modulKopien: [[]] }, /modulKopien\[0\] muss ein Objekt/],
    ["Eintrag ist null", { modulKopien: [null] }, /modulKopien\[0\] muss ein Objekt/],
    ["grund leer", { modulKopien: [{ ...ok, grund: "  " }] }, /grund muss ein nicht leerer Text/],
    ["grund fehlt", { modulKopien: [{ datei: "a" }] }, /grund muss/],
    ["datei doppelt", { modulKopien: [ok, ok] }, /enthält scripts\/x\.mjs doppelt/],
  ])("%s ist ein Fehler mit Fix", (_n, c, re) => {
    const f = lib.modulFormFehler(c);
    expect(f.join("\n")).toMatch(re);
    for (const m of f) expect(m).toMatch(/\nFix: \S/);
  });
});

describe("modulKopienBefunde (factory#244)", () => {
  const m = { eintraege: [{ pfad: "a.yml", modul: "codeql" }, { pfad: "b.yml", modul: "zizmor" }, { pfad: "d.mjs" }] };
  const kopie = (datei: string) => ({ datei, grund: "bewusst" });
  const lauf = (o: { gewaehlt?: string[]; unbestimmt?: boolean; da?: string[]; stand?: string[]; kopien?: { datei: string; grund: string }[] }) =>
    lib.modulKopienBefunde(m, { gewaehlt: o.gewaehlt ?? [], unbestimmt: o.unbestimmt }, { vorhanden: (p) => (o.da ?? []).includes(p), imStand: (e) => (o.stand ?? []).includes(e.pfad), kopien: o.kopien ?? [] });
  test("(a) Datei, Modul nicht gewählt, nicht im Stand, ohne Grund: Befund", () => {
    expect(lauf({ da: ["a.yml"] })).toEqual([{ pfad: "a.yml", art: "ohne-grund", modul: "codeql" }]);
  });
  test("(b) mit Begründung kein Befund", () => {
    expect(lauf({ da: ["a.yml"], kopien: [kopie("a.yml")] })).toEqual([]);
  });
  test("ohne Datei kein Befund; Einheit ohne Modul nie", () => {
    expect(lauf({ da: ["d.mjs"] })).toEqual([]);
  });
  test("(c) begründeter Pfad, Modul gewählt: veralteter Eintrag", () => {
    expect(lauf({ gewaehlt: ["codeql"], da: ["a.yml"], kopien: [kopie("a.yml")] })).toEqual([{ pfad: "a.yml", art: "modul-gewaehlt" }]);
  });
  test("(d) begründeter Pfad ohne Moduleinheit", () => {
    expect(lauf({ da: ["d.mjs", "z.txt"], kopien: [kopie("d.mjs"), kopie("z.txt")] }).map((b) => b.art)).toEqual(["keine-moduleinheit", "keine-moduleinheit"]);
  });
  test("(e) begründeter Pfad ohne Datei", () => {
    expect(lauf({ kopien: [kopie("a.yml")] })).toEqual([{ pfad: "a.yml", art: "fehlt" }]);
  });
  test("(f) Pfad im Stand und Modul abgewählt: kein neuer Befund", () => {
    expect(lauf({ da: ["a.yml"], stand: ["a.yml"] })).toEqual([]);
  });
  test("liegt der Pfad bei zwei Modulen, genügt ein gewähltes für den veralteten Eintrag; ohne Manifest nichts", () => {
    const zwei = { eintraege: [{ pfad: "a.yml", modul: "codeql" }, { pfad: "a.yml", modul: "zizmor" }] };
    const o = { vorhanden: () => true, imStand: () => false, kopien: [kopie("a.yml")] };
    expect(lib.modulKopienBefunde(zwei, { gewaehlt: ["codeql"] }, o)).toEqual([{ pfad: "a.yml", art: "modul-gewaehlt" }]);
    expect(lib.modulKopienBefunde(undefined, { gewaehlt: [] }, { ...o, kopien: [] })).toEqual([]);
  });
  test("(g) unbestimmte Wahl: nichts", () => {
    expect(lauf({ unbestimmt: true, da: ["a.yml"], kopien: [kopie("zz")] })).toEqual([]);
  });
  test("(h) mit dem Standard aus gewaehlteModule ({} wählt nur dependabot-inbox) ist die Datei eines anderen Moduls ein Befund", () => {
    expect(lauf({ gewaehlt: lib.gewaehlteModule({}), da: ["b.yml"] }).map((b) => b.pfad)).toEqual(["b.yml"]);
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
