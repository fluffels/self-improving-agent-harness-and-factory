/* Harness-Doctor, Punkt `Factory-Update` (factory#220 L39): nur im Bezieher; die Datei `.github/workflows/factory-update.yml` muss da sein und der Workflow `active`.
 * Jeder Zweig hat seinen Test; `lesen` ist die gh-Naht (kein Netz), `existiert` und `bezieher` sind injiziert. */
import { rmSync } from "node:fs";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/harness-doctor-factory-update.mjs";

type Ergebnis = { punkt: string; ok: boolean; befund?: string; fix?: string; nichtPruefbar?: boolean };
type Lesen = (args: string[], token?: string) => unknown;
interface Lib {
  factoryUpdatePunkt(a: { rootDir: string; config: unknown; lesen: Lesen; existiert?: (p: string) => boolean; bezieher?: (w: string) => boolean; vorAbbruch?: boolean }): Ergebnis[];
  dependabotAusschlussPunkt(a: { rootDir: string; existiert?: (p: string) => boolean; lies?: (p: string) => string | null; bezieher?: (w: string) => boolean }): Ergebnis[];
  mitDependabotAusschluss(dateien: (a: { rootDir: string; config: unknown }) => Ergebnis[], o: { existiert?: (p: string) => boolean; lies?: (p: string) => string | null; bezieher?: (w: string) => boolean }): (a: { rootDir: string; config: unknown; vorAbbruch?: boolean }) => Ergebnis[];
  mitFactoryUpdate(dateien: (a: { rootDir: string; config: unknown }) => Ergebnis[], o: { lesen: Lesen; existiert?: (p: string) => boolean; bezieher?: (w: string) => boolean }): (a: { rootDir: string; config: unknown; vorAbbruch?: boolean }) => Ergebnis[];
}
const lib = raw as unknown as Lib;

const config = { repo: "acme/proj" };
const lesenMit = (antwort: unknown) => {
  const aufrufe: string[][] = [];
  return { aufrufe, lesen: ((a: string[]) => (aufrufe.push(a), antwort)) as Lesen };
};
const werfend: Lesen = () => {
  throw new Error("HTTP 404: Not Found");
};
const da = () => true;
const weg = () => false;
const ja = () => true;
const nein = () => false;

describe("factoryUpdatePunkt", () => {
  test("in der Fabrik (kein Bezieher): kein Punkt, kein Aufruf, auch bei fehlender Datei", () => {
    const { aufrufe, lesen } = lesenMit({ state: "active" });
    expect(lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen, existiert: weg, bezieher: nein })).toEqual([]);
    expect(aufrufe).toEqual([]);
  });
  test("Bezieher, Datei fehlt: Lücke mit Fix Sync, kein API-Aufruf", () => {
    const { aufrufe, lesen } = lesenMit({ state: "active" });
    const [p] = lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen, existiert: weg, bezieher: ja });
    expect(p).toMatchObject({ punkt: "Factory-Update", ok: false });
    expect(p?.nichtPruefbar).toBeUndefined();
    expect(p?.befund).toContain(".github/workflows/factory-update.yml");
    expect(p?.fix).toContain("scripts/factory-sync.mjs --quelle");
    expect(aufrufe).toEqual([]);
  });
  test("Datei da, Workflow active: OK, gefragt wird genau der Workflow des eigenen Repos", () => {
    const { aufrufe, lesen } = lesenMit({ state: "active" });
    expect(lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen, existiert: da, bezieher: ja })).toEqual([{ punkt: "Factory-Update", ok: true }]);
    expect(aufrufe).toEqual([["api", "repos/acme/proj/actions/workflows/factory-update.yml"]]);
  });
  test.each(["disabled_inactivity", "disabled_manually", "deleted", undefined, 3])("Workflow-Zustand %s: Lücke mit Fix Aktivieren", (state) => {
    const { lesen } = lesenMit({ state });
    const [p] = lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen, existiert: da, bezieher: ja });
    expect(p).toMatchObject({ punkt: "Factory-Update", ok: false });
    expect(p?.nichtPruefbar).toBeUndefined();
    expect(p?.befund).toContain(String(state));
    expect(p?.fix).toContain("gh workflow enable factory-update.yml");
    expect(p?.fix).toContain("Actions");
  });
  test("API-Fehler: NICHT PRÜFBAR, nie still grün", () => {
    const [p] = lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen: werfend, existiert: da, bezieher: ja });
    expect(p).toMatchObject({ punkt: "Factory-Update", ok: false, nichtPruefbar: true });
    expect(p?.befund).toContain("HTTP 404");
  });
  test("Antwort ohne Objekt (null): NICHT PRÜFBAR statt Absturz", () => {
    const { lesen } = lesenMit(null);
    expect(lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen, existiert: da, bezieher: ja })[0]).toMatchObject({ ok: false, nichtPruefbar: true });
  });
  test("Antwort ohne Objekt (Text, Zahl): NICHT PRÜFBAR; leeres repo: NICHT PRÜFBAR ohne Aufruf; Standard-existiert liest das Dateisystem", () => {
    for (const antwort of ["active", 7]) expect(lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen: lesenMit(antwort).lesen, existiert: da, bezieher: ja })[0], String(antwort)).toMatchObject({ ok: false, nichtPruefbar: true });
    const { aufrufe, lesen } = lesenMit({ state: "active" });
    expect(lib.factoryUpdatePunkt({ rootDir: "/x", config: { repo: "" }, lesen, existiert: da, bezieher: ja })[0]).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(aufrufe).toEqual([]);
    expect(lib.factoryUpdatePunkt({ rootDir: "/gibt/es/nicht", config, lesen, bezieher: ja })[0]).toMatchObject({ ok: false });
    expect(aufrufe).toEqual([]);
  });
  test("keine Config (undefined, null, Text): kein Punkt", () => {
    const { lesen } = lesenMit({ state: "active" });
    for (const c of [undefined, null, "x"]) expect(lib.factoryUpdatePunkt({ rootDir: "/x", config: c, lesen, existiert: da, bezieher: ja }), String(c)).toEqual([]);
  });
  test("Config ohne lesbares repo: NICHT PRÜFBAR ohne Aufruf; ohne Config oder im Vorab-Abbruch: kein Punkt", () => {
    const { aufrufe, lesen } = lesenMit({ state: "active" });
    expect(lib.factoryUpdatePunkt({ rootDir: "/x", config: { repo: 3 }, lesen, existiert: da, bezieher: ja })[0]).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(lib.factoryUpdatePunkt({ rootDir: "/x", config: undefined, lesen, existiert: da, bezieher: ja })).toEqual([]);
    expect(lib.factoryUpdatePunkt({ rootDir: "/x", config, lesen, existiert: weg, bezieher: ja, vorAbbruch: true })).toEqual([]);
    expect(aufrufe).toEqual([]);
  });
});

describe("mitFactoryUpdate", () => {
  test("hängt den Punkt an die Dateipunkte und reicht die Argumente unverändert durch", () => {
    const { lesen } = lesenMit({ state: "active" });
    const gesehen: unknown[] = [];
    const f = lib.mitFactoryUpdate((a) => (gesehen.push(a), [{ punkt: "Eins", ok: true }]), { lesen, existiert: da, bezieher: ja });
    const a = { rootDir: "/x", config };
    expect(f(a)).toEqual([{ punkt: "Eins", ok: true }, { punkt: "Factory-Update", ok: true }]);
    expect(gesehen).toEqual([a]);
  });
  test("Vorab-Abbruch: nur die Dateipunkte, der Punkt fehlt", () => {
    const { aufrufe, lesen } = lesenMit({ state: "active" });
    const f = lib.mitFactoryUpdate(() => [{ punkt: "Eins", ok: true }], { lesen, existiert: weg, bezieher: ja });
    expect(f({ rootDir: "/x", config, vorAbbruch: true })).toEqual([{ punkt: "Eins", ok: true }]);
    expect(f({ rootDir: "/x", config })).toHaveLength(2); // ohne Vorab-Abbruch käme die Lücke „Datei fehlt“ dazu: der Test oben ist nicht vakuös
    expect(aufrufe).toEqual([]);
  });
});

/* Punkt `Dependabot-Ausschluss` (factory#375 L5): Dependabot-PRs auf Besitz-Workflows scheitern an check:factorydrift. */
const eintrag = (pfad: string, extra: Record<string, unknown> = {}) => ({ pfad, ring: "kern", ...extra });
const manifest = (...e: unknown[]) => JSON.stringify({ version: 3, eintraege: e });
const BESITZ = [".github/workflows/codeql.yml", ".github/workflows/zizmor.yml"];
const MANI = manifest(eintrag(BESITZ[0], { modul: "codeql" }), eintrag(BESITZ[1], { modul: "zizmor" }), eintrag("scripts/x.mjs"), eintrag(".github/workflows/nur-fabrik.yml", { ring: "oberflaeche" }), eintrag(".github/workflows/ci.yml", { block: "b" }));
const actions = (exclude?: string[]) => `- package-ecosystem: github-actions\n  directory: /\n${exclude ? `  exclude-paths:\n${exclude.map((x) => `    - "${x}"\n`).join("")}` : ""}`;
const dependabot = (...eintraege: string[]) => `version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n${eintraege.map((e) => e.split("\n").filter(Boolean).map((z) => `  ${z}\n`).join("")).join("")}`;
const dateien = (inhalt: Record<string, string | null>) => ({
  existiert: (p: string) => Object.keys(inhalt).some((k) => p.endsWith(k) && inhalt[k] !== null),
  lies: (p: string) => Object.entries(inhalt).find(([k]) => p.endsWith(k))?.[1] ?? null,
});
const ALLE = { ".factory/besitz.json": MANI, ".github/workflows/codeql.yml": "x", ".github/workflows/zizmor.yml": "x", ".github/workflows/nur-fabrik.yml": "x", ".github/workflows/ci.yml": "x" };
const pruefe = (db: string | null, rest: Record<string, string | null> = ALLE, bezieher = ja) => lib.dependabotAusschlussPunkt({ rootDir: "/x", ...dateien({ ...rest, ".github/dependabot.yml": db }), bezieher });

describe("dependabotAusschlussPunkt", () => {
  test("Fabrik (kein Bezieher): kein Punkt", () => {
    expect(pruefe(dependabot(actions()), ALLE, nein)).toEqual([]);
  });
  test("ohne .github/dependabot.yml: OK", () => {
    expect(pruefe(null)).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("ohne Eintrag github-actions: OK", () => {
    expect(pruefe(dependabot())).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("Eintrag ohne exclude-paths bei zwei Besitz-Workflows: Lücke mit beiden Pfaden und Fix", () => {
    const [p] = pruefe(dependabot(actions()));
    expect(p).toMatchObject({ punkt: "Dependabot-Ausschluss", ok: false });
    expect(p?.nichtPruefbar).toBeUndefined();
    for (const w of BESITZ) expect(p?.befund).toContain(w);
    expect(p?.befund).not.toContain("nur-fabrik.yml");
    expect(p?.befund).not.toContain("ci.yml");
    expect(p?.fix).toContain("in .github/dependabot.yml je github-actions-Eintrag unter exclude-paths ergänzen: ");
    for (const w of BESITZ) expect(p?.fix).toContain(w);
    expect(p?.fix).toContain("scheitert an check:factorydrift, der Bump kommt per Factory-Update");
    expect(p?.fix).not.toContain("npm run");
  });
  test("alle ausgeschlossen: OK", () => {
    expect(pruefe(dependabot(actions(BESITZ)))).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("nur einer ausgeschlossen: Lücke nennt nur den fehlenden", () => {
    const [p] = pruefe(dependabot(actions([BESITZ[0]])));
    expect(p).toMatchObject({ ok: false });
    expect(p?.befund).toContain(BESITZ[1]);
    expect(p?.befund).not.toContain(BESITZ[0]);
  });
  test("zwei github-actions-Einträge, einer unvollständig: Lücke", () => {
    const [p] = pruefe(dependabot(actions(BESITZ), actions([BESITZ[0]])));
    expect(p).toMatchObject({ ok: false });
    expect(p?.befund).toContain(BESITZ[1]);
  });
  test("Glob-Einträge zählen nicht (dokumentierte Grenze)", () => {
    expect(pruefe(dependabot(actions([".github/workflows/*.yml"])))[0]).toMatchObject({ ok: false });
  });
  test("Manifest-Workflow fehlt im Projekt (abgewähltes Modul): nicht gefordert; fehlen alle: OK", () => {
    const [p] = pruefe(dependabot(actions([BESITZ[0]])), { ...ALLE, ".github/workflows/zizmor.yml": null });
    expect(p).toEqual({ punkt: "Dependabot-Ausschluss", ok: true });
    expect(pruefe(dependabot(actions()), { ...ALLE, ".github/workflows/zizmor.yml": null, ".github/workflows/codeql.yml": null })).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("Projekt-Workflow (nicht im Manifest) wird nie gefordert", () => {
    const mani = manifest(eintrag("scripts/x.mjs"));
    expect(pruefe(dependabot(actions()), { ...ALLE, ".factory/besitz.json": mani, ".github/workflows/projekt.yml": "x" })).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("kaputtes YAML: NICHT PRÜFBAR", () => {
    const [p] = pruefe("updates: [\n  - x: {");
    expect(p).toMatchObject({ punkt: "Dependabot-Ausschluss", ok: false, nichtPruefbar: true });
    expect(p?.befund).toContain(".github/dependabot.yml");
  });
  test("YAML ohne Liste updates (Text, Skalar): wie ohne github-actions-Eintrag OK", () => {
    expect(pruefe("version: 2\n")).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
    expect(pruefe("42\n")).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
    expect(pruefe("updates:\n  - 3\n  - null\n")).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("Manifest fehlt, kein JSON oder ohne Liste: NICHT PRÜFBAR", () => {
    for (const m of [null, "{", "{}"]) {
      const [p] = pruefe(dependabot(actions()), { ...ALLE, ".factory/besitz.json": m });
      expect(p, String(m)).toMatchObject({ punkt: "Dependabot-Ausschluss", ok: false, nichtPruefbar: true });
      expect(p?.befund).toContain(".factory/besitz.json");
    }
  });
  test("exclude-paths kein Array: zählt als nicht ausgeschlossen", () => {
    expect(pruefe(dependabot("- package-ecosystem: github-actions\n  exclude-paths: x\n"))[0]).toMatchObject({ ok: false });
  });
  test("exclude-paths als Text mit dem Pfad zählt nicht (kein Array)", () => {
    expect(pruefe(dependabot(`- package-ecosystem: github-actions\n  exclude-paths: ${BESITZ.join(" ")}\n`))[0]).toMatchObject({ ok: false });
  });
  test("leere oder null-Datei dependabot.yml: OK statt Absturz", () => {
    for (const leer of ["", "null\n"]) expect(pruefe(leer), JSON.stringify(leer)).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("ohne github-actions-Eintrag wird das Manifest nicht gebraucht (kaputt: trotzdem OK)", () => {
    expect(pruefe(dependabot(), { ...ALLE, ".factory/besitz.json": "{" })).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
  });
  test("Befund: Einzahl bei einem, Mehrzahl bei mehreren fehlenden Pfaden", () => {
    expect(pruefe(dependabot(actions([BESITZ[0]])))[0]?.befund).toContain("zizmor.yml fehlt unter");
    expect(pruefe(dependabot(actions()))[0]?.befund).toContain("zizmor.yml fehlen unter");
  });
  test("Standard-existiert und -lies lesen das Dateisystem", async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const w = mkdtempSync(join(tmpdir(), "doc-dep-"));
    aufraeumen.push(w);
    expect(lib.dependabotAusschlussPunkt({ rootDir: w, bezieher: ja })).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
    mkdirSync(join(w, ".github", "workflows"), { recursive: true });
    mkdirSync(join(w, ".factory"));
    writeFileSync(join(w, ".github", "dependabot.yml"), dependabot(actions()));
    const [ohne] = lib.dependabotAusschlussPunkt({ rootDir: w, bezieher: ja });
    expect(ohne).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(ohne?.befund).toContain("fehlt");
    writeFileSync(join(w, ".factory", "besitz.json"), MANI);
    writeFileSync(join(w, ".github", "workflows", "codeql.yml"), "x");
    const [mit] = lib.dependabotAusschlussPunkt({ rootDir: w, bezieher: ja });
    expect(mit).toMatchObject({ ok: false });
    expect(mit?.nichtPruefbar).toBeUndefined();
    expect(mit?.befund).toContain("codeql.yml");
    expect(mit?.befund).not.toContain("zizmor.yml");
  });
});

describe("mitDependabotAusschluss", () => {
  test("hängt den Punkt an; im Vorab-Abbruch fehlt er", () => {
    const f = lib.mitDependabotAusschluss(() => [{ punkt: "Eins", ok: true }], { ...dateien({ ...ALLE, ".github/dependabot.yml": dependabot(actions()) }), bezieher: ja });
    expect(f({ rootDir: "/x", config }).map((p) => p.punkt)).toEqual(["Eins", "Dependabot-Ausschluss"]);
    expect(f({ rootDir: "/x", config, vorAbbruch: true }).map((p) => p.punkt)).toEqual(["Eins"]);
  });
});

const aufraeumen: string[] = [];
afterEach(() => {
  for (const d of aufraeumen.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("dateienStandard (Verdrahtung von harness-doctor.mjs)", () => {
  test("Reihenfolge: Dateipunkte, dann Factory-Update; ein Bezieher mit Sync-Stand und der Datei bekommt den Punkt, die Fabrik nicht", async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    // @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
    const doctor = (await import("../scripts/harness-doctor.mjs")) as { dateienStandard(a: { env: Record<string, string>; lesen: Lesen; pruefe: (a: unknown) => Ergebnis[] }): (a: { rootDir: string; config: unknown }) => Ergebnis[] };
    const fabrik = mkdtempSync(join(tmpdir(), "doc-fu-fabrik-"));
    const bezieher = mkdtempSync(join(tmpdir(), "doc-fu-bez-"));
    aufraeumen.push(fabrik, bezieher);
    mkdirSync(join(bezieher, ".factory"), { recursive: true });
    writeFileSync(join(bezieher, ".factory", "sync-stand.json"), "{}");
    mkdirSync(join(bezieher, ".github", "workflows"), { recursive: true });
    writeFileSync(join(bezieher, ".github", "workflows", "factory-update.yml"), "name: x\n");
    const { lesen } = lesenMit({ state: "disabled_inactivity" });
    const f = doctor.dateienStandard({ env: {}, lesen, pruefe: () => [{ punkt: "Eins", ok: true }] });
    expect(f({ rootDir: fabrik, config }).map((p) => p.punkt)).toEqual(["Eins"]);
    const e = f({ rootDir: bezieher, config });
    expect(e.map((p) => p.punkt)).toEqual(["Eins", "Factory-Update", "Dependabot-Ausschluss"]);
    expect(e[1]).toMatchObject({ ok: false });
  });
});
