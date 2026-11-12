/* Harness-Doctor, Punkt `Factory-Update` (factory#220 L39): nur im Bezieher; die Datei `.github/workflows/factory-update.yml` muss da sein und der Workflow `active`.
 * Jeder Zweig hat seinen Test; `lesen` ist die gh-Naht (kein Netz), `existiert` und `bezieher` sind injiziert. */
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/harness-doctor-factory-update.mjs";

type Ergebnis = { punkt: string; ok: boolean; befund?: string; fix?: string; nichtPruefbar?: boolean };
type Lesen = (args: string[], token?: string) => unknown;
interface Lib {
  factoryUpdatePunkt(a: { rootDir: string; config: unknown; lesen: Lesen; existiert?: (p: string) => boolean; bezieher?: (w: string) => boolean; vorAbbruch?: boolean }): Ergebnis[];
  dependabotEintraege(text: string): { eintraege?: unknown[]; fehler?: string };
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
const actions = (exclude?: string[]) => `- package-ecosystem: github-actions\n  directory: /\n${exclude ? `  exclude-paths:\n${exclude.map((x) => `    - ${x}\n`).join("")}` : ""}`;
const dependabot = (...eintraege: string[]) => `version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n${eintraege.map((e) => e.split("\n").filter(Boolean).map((z) => `  ${z}\n`).join("")).join("")}`;
const dateien = (inhalt: Record<string, string | null>) => ({
  existiert: (p: string) => Object.keys(inhalt).some((k) => p.endsWith(k) && inhalt[k] !== null),
  lies: (p: string) => Object.entries(inhalt).find(([k]) => p.endsWith(k))?.[1] ?? null,
});
const ALLE = { ".factory/besitz.json": MANI, ".github/workflows/codeql.yml": "x", ".github/workflows/zizmor.yml": "x", ".github/workflows/nur-fabrik.yml": "x", ".github/workflows/ci.yml": "x" };
const pruefe = (db: string | null, rest: Record<string, string | null> = ALLE, bezieher = ja) => lib.dependabotAusschlussPunkt({ rootDir: "/x", ...dateien({ ...rest, ".github/dependabot.yml": db }), bezieher });
const OK = [{ punkt: "Dependabot-Ausschluss", ok: true }];
/** Eine echte Lücke: `ok: false`, aber nicht „nicht prüfbar“. */
const luecke = (p: Ergebnis | undefined, was: string) => {
  expect(p, was).toMatchObject({ ok: false });
  expect(p?.nichtPruefbar, was).toBeUndefined();
};
const nichtPruefbar = (...roh: string[]) => {
  for (const r of roh) expect(pruefe(r)[0], JSON.stringify(r)).toMatchObject({ punkt: "Dependabot-Ausschluss", ok: false, nichtPruefbar: true });
};

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
    luecke(pruefe(dependabot(actions([".github/workflows/*.yml"])))[0], "Glob");
    luecke(pruefe("updates:\n  - package-ecosystem: github-actions\n    exclude-paths:\n      - .github/workflows/*.yml\n")[0], "Glob plain");
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
  test("kaputtes YAML (Flow, unbeendet): NICHT PRÜFBAR", () => {
    const [p] = pruefe("updates: [\n  - x: {");
    expect(p).toMatchObject({ punkt: "Dependabot-Ausschluss", ok: false, nichtPruefbar: true });
    expect(p?.befund).toContain(".github/dependabot.yml");
  });
  test("ohne `updates` oder ohne Eintrag mit package-ecosystem: OK", () => {
    for (const roh of ["version: 2\n", "updates: []\n", "updates:\n", "updates:\n  - directory: /\n"]) expect(pruefe(roh), JSON.stringify(roh)).toEqual(OK);
  });
  test("keine `schlüssel: wert`-Zeile (Skalar, Quotes um den Schlüssel, Leerzeichen vor dem Doppelpunkt): NICHT PRÜFBAR statt falsch OK", () => {
    nichtPruefbar(
      "updates: x\n", "42\n", "null\n", "updates: null\n", "updates:\n  a: b\n", "updates:\n  - 3\n  - null\n", "updates:\n  - x\n", "updates:\n  -y\n", "updates:\n  xxpackage-ecosystem: github-actions\n",
      '    - package-ecosystem: x\n', "updates:\n  - package-ecosystem: x\n    foo\n",
      '  - "package-ecosystem": github-actions\n', "updates:\n  - 'package-ecosystem': github-actions\n", "updates:\n  - package-ecosystem : github-actions\n",
      'updates:\n  - package-ecosystem: x\n    "exclude-paths": y\n', "updates: []\nfoo:bar\n",
    );
  });
  test("Tab irgendwo (Einrückung, nach dem Doppelpunkt, vor dem Kommentar, nur Tabs) ist NICHT PRÜFBAR", () => {
    nichtPruefbar(
      "updates:\n\t- package-ecosystem: github-actions\n", "updates:\n  - package-ecosystem:\tgithub-actions\n", "updates:\n  - package-ecosystem: github-actions\t# x\n", "updates:\n\t\n",
    );
  });
  test("nicht gelesene Formen sind NICHT PRÜFBAR: Flow, Anker, Alias, doppelte Schlüssel, mehrzeilige Werte, Block-Skalar, schiefe Einrückung", () => {
    const aktion = "  - package-ecosystem: github-actions\n";
    const ex = (rest: string) => `updates:\n${aktion}    exclude-paths:${rest}\n`;
    const np = "updates:\n  - package-ecosystem: npm\n";
    nichtPruefbar(
      "updates: [\n  - x: {", "updates:\n  - {package-ecosystem: github-actions}\n", "updates:\n  - &a\n", "updates:\n  - package-ecosystem:\n", "updates:\n  -\n    package-ecosystem: github-actions\n",
      "updates:\n  - package-ecosystem: x\n  y\n", "updates: []\nupdates: []\n", "updates: []\n  - package-ecosystem: github-actions\n",
      ex(" *a"), ex(" [a,\n      b]"), ex(" [a, b]"), ex(" |\n      a"), ex(" []\n    exclude-paths: []"), ex(' [a,,b]'), ex(' "a'), ex(" x\n      y"),
      ex('\n      - "a'), ex('\n      -'), ex('\n      - # leer'), ex('\n      - "'), ex('\n      - "a"b"'), ex('\n      - "a\\b"'), ex('\n      - "a\''), ex("\n      - 'a'b'"), ex('\n      - ".github/workflows/codeql.yml"'), ex("\n      - '.github/workflows/codeql.yml'"), ex("\n      - a\n        - b"), ex("\n      a: b"),
      `updates:\n${aktion}   y: z\n`, `updates:\n${aktion}    package-ecosystem: npm\n`, `  updates:\n${aktion}`,
      `${np}    directory: /\n   y: z\n`, `${np}      y\n`, "updates:\n  - 3\n - 4\n", "updates:\n  - package-ecosystem: x\n - package-ecosystem: y\n",
    );
  });
  test("jedes Sonderzeichen am Wertanfang (Anker, Alias, Tag, Block-Skalar, Flow, Direktive, reserviert, ?-Schlüssel) ist NICHT PRÜFBAR", () => {
    for (const c of ["&", "*", "!", "|", ">", "{", "%", "@", "`", "?", "[", '"', "'"]) nichtPruefbar(`updates:\n  - package-ecosystem: ${c}x\n`);
  });
  test("gelesene Formen: Listenpunkt, eingerückte Kommentar- und Leerzeilen, Kommentare auch direkt hinter `schlüssel:`, --- am Anfang, CRLF", () => {
    const voll = `---\n# Kommentar\nupdates:\n  - package-ecosystem: github-actions # Aktionen\n    # eingerückter Kommentar\n    exclude-paths: # Besitz\n      # tiefer Kommentar\n      - .github/workflows/codeql.yml # a\n   \n      - .github/workflows/zizmor.yml\n\n`;
    for (const roh of [voll, voll.replace("updates:", "updates: # Liste"), voll.replaceAll("\n", "\r\n"), `${voll}version: 2\n`, `${voll}# Ende\n\n`]) expect(pruefe(roh), JSON.stringify(roh)).toEqual(OK);
    // echte Lücken (nicht „nicht prüfbar“): leere Liste, leerer Block, nur Kommentar, anderer Schlüssel
    const ga = "updates:\n  - package-ecosystem: github-actions\n";
    for (const rest of ["    exclude-paths: []\n", "    exclude-paths:\n", "    exclude-paths: # nichts\n", "    schedule:\n      interval: weekly\n"]) luecke(pruefe(`${ga}${rest}`)[0], rest);
    luecke(pruefe("updates:\n  - package-ecosystem: github-actions # Aktionen\n")[0], "Kommentar");
  });
  test("dependabotEintraege: nur NichtLesbar wird zu `{ fehler }`, jeder andere Fehler wird weitergeworfen", () => {
    expect(typeof lib.dependabotEintraege("42\n").fehler).toBe("string");
    expect(() => lib.dependabotEintraege(null as unknown as string)).toThrow(TypeError);
  });
  test("Fallback .github/dependabot.yaml, wenn die .yml fehlt (die .yml gilt zuerst); der Befund nennt die gelesene Datei", () => {
    const yaml = (inhalt: string) => pruefe(null, { ...ALLE, ".github/dependabot.yaml": inhalt })[0];
    luecke(yaml(dependabot(actions())), "yaml");
    expect(yaml(dependabot(actions()))?.befund).toContain("exclude-paths in .github/dependabot.yaml:");
    expect(yaml(dependabot(actions()))?.fix).toContain("in .github/dependabot.yaml je github-actions-Eintrag");
    expect(yaml("42\n")?.befund).toMatch(/^\.github\/dependabot\.yaml ist in dieser Form nicht lesbar/);
    expect(yaml("42\n")?.fix).toContain(".github/dependabot.yaml in die übliche Blockform");
    expect(pruefe(dependabot(), { ...ALLE, ".github/dependabot.yaml": dependabot(actions()) })).toEqual(OK);
  });
  test("Manifest fehlt, kein JSON oder ohne Liste: NICHT PRÜFBAR", () => {
    for (const m of [null, "{", "{}"]) {
      const [p] = pruefe(dependabot(actions()), { ...ALLE, ".factory/besitz.json": m });
      expect(p, String(m)).toMatchObject({ punkt: "Dependabot-Ausschluss", ok: false, nichtPruefbar: true });
      expect(p?.befund).toContain(".factory/besitz.json");
    }
  });
  test("exclude-paths kein Array: zählt als nicht ausgeschlossen", () => {
    luecke(pruefe(dependabot("- package-ecosystem: github-actions\n  exclude-paths: x\n"))[0], "Text");
  });
  test("exclude-paths als Text mit dem Pfad zählt nicht (kein Array)", () => {
    luecke(pruefe(dependabot(`- package-ecosystem: github-actions\n  exclude-paths: ${BESITZ.join(" ")}\n`))[0], "Text mit Pfaden");
  });
  test("leere oder Kommentar-Datei dependabot.yml: OK statt Absturz", () => {
    for (const leer of ["", "# nur Kommentar\n", "\n"]) expect(pruefe(leer), JSON.stringify(leer)).toEqual([{ punkt: "Dependabot-Ausschluss", ok: true }]);
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

/* Vertrag des Doctor-Wochenlaufs (harness-doctor.yml hat kein `npm ci`): der statische Importgraph von Doctor und Meldestellen-Lauf enthält nur `node:`-Builtins und lokale Module, nie ein npm-Paket wie `yaml`. */
const IMPORT = /\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
/** Entfernt Block- und Zeilenkommentare, die am Zeilenanfang beginnen (Prosa wie `import("…")` im JSDoc ist kein Import); ein `/*` mitten in einer Zeile (z. B. ein Glob im String) bleibt unberührt, damit kein Import verschwindet. */
const ohneZeilenKommentare = (text: string): string => text.replace(/^\s*\/\*[\s\S]*?\*\//gm, "").replace(/^\s*\/\/.*$/gm, "");
/** Alle Modulnamen, die der Importgraph ab `einstieg` anspricht, die kein `node:`-Builtin und kein lokales Modul sind. */
function externeImporte(einstieg: string, lese: (pfad: string) => string): string[] {
  const gesehen = new Set<string>();
  const extern = new Set<string>();
  const offen = [einstieg];
  for (let pfad = offen.pop(); pfad !== undefined; pfad = offen.pop()) {
    if (gesehen.has(pfad)) continue;
    gesehen.add(pfad);
    for (const m of ohneZeilenKommentare(lese(pfad)).matchAll(IMPORT)) {
      const name = m[1];
      if (name.startsWith("./") || name.startsWith("../")) offen.push(join(dirname(pfad), name));
      else if (!name.startsWith("node:")) extern.add(name);
    }
  }
  return [...extern].sort();
}
describe("Importgraph des Doctor-Wochenlaufs", () => {
  test("harness-doctor.mjs und harness-doctor-melden.mjs importieren transitiv nur node:-Builtins und lokale Module", () => {
    const skripte = join(import.meta.dirname, "..", "scripts");
    for (const einstieg of ["harness-doctor.mjs", "harness-doctor-melden.mjs"]) {
      expect(externeImporte(join(skripte, einstieg), (p) => readFileSync(p, "utf8")), einstieg).toEqual([]);
    }
  });
  test("der Graph-Leser folgt relativen Importen und findet ein npm-Paket (Prüfung des Prüfers)", () => {
    const dateien: Record<string, string> = {
      "/s/a.mjs": 'import { x } from "./b.mjs";\nimport fs from "node:fs";\nimport("./c.mjs");',
      "/s/b.mjs": 'import "../t/d.mjs";',
      "/s/c.mjs": 'import { parse } from "yaml";',
      "/t/d.mjs": 'export { y } from "ajv";',
    };
    expect(externeImporte("/s/a.mjs", (p) => dateien[p] ?? "")).toEqual(["ajv", "yaml"]);
    expect(externeImporte("/s/b.mjs", (p) => dateien[p] ?? "")).toEqual(["ajv"]);
  });
  test("Kommentar-Prosa mit import-Form ist kein Import, ein Glob mitten in der Zeile versteckt keinen echten Import", () => {
    const text = '/**\n * Beispiel: import("yaml") und from "ajv"\n */\n// import "zod";\nconst g = "scripts/*.mjs"; import { x } from "echt-extern";\n';
    expect(externeImporte("/s/k.mjs", () => text)).toEqual(["echt-extern"]);
  });
});

/* Allgemeiner Vertrag (factory#382 L65): jeder Workflow unter `.github/workflows/` OHNE Installationsschritt lädt über seine `node scripts/<x>.mjs`-Einstiege transitiv nur `node:`-Builtins und lokale Module.
 * Scan-Umfang (geschlossene Liste): Installation = eine Nicht-Kommentarzeile mit `npm ci`, `npm install`, `npm i ` oder `gate-befehl.mjs install`; Einstiege = `node scripts/<x>.mjs` und `node ./scripts/<x>.mjs`;
 * Importe nach dem IMPORT-Regex oben (statisches `from`, `import "…"`, dynamisches `import` mit Literal). Nicht erfasst: `require`, `createRequire`, dynamischer Import mit Variable, `npx`, `npm run`.
 * Schutz gegen leeres Grün: die Liste der geprüften Workflows ist nicht leer. */
const INSTALLATION = /\b(?:npm ci|npm install|npm i |gate-befehl\.mjs install)/;
const EINSTIEG = /\bnode\s+(?:\.\/)?(scripts\/[\w.-]+\.mjs)/g;
const ohneKommentare = (text: string): string => text.split(/\r?\n/).filter((z) => !/^\s*#/.test(z)).join("\n");
/** `null` bei Installationsschritt (dann hat der Workflow `node_modules`), sonst die Skript-Einstiege (relativ zur Repo-Wurzel). */
function einstiegeOhneInstallation(text: string): string[] | null {
  const code = ohneKommentare(text);
  if (INSTALLATION.test(code)) return null;
  return [...new Set([...code.matchAll(EINSTIEG)].map((m) => m[1]))].sort();
}
describe("Workflows ohne Installationsschritt (factory#382 L65)", () => {
  const wurzel = join(import.meta.dirname, "..");
  const dir = join(wurzel, ".github", "workflows");
  const geprueft = readdirSync(dir)
    .filter((n) => n.endsWith(".yml"))
    .map((n) => ({ name: n, einstiege: einstiegeOhneInstallation(readFileSync(join(dir, n), "utf8")) }))
    .filter((w): w is { name: string; einstiege: string[] } => w.einstiege !== null);

  test("die Liste der geprüften Workflows ist nicht leer (kein leeres Grün)", () => {
    expect(geprueft.length).toBeGreaterThan(0);
  });

  test.each(geprueft.map((w) => [w.name, w.einstiege] as const))("%s: Einstiege laden transitiv nur node:-Builtins und lokale Module", (_name, einstiege) => {
    for (const e of einstiege) expect(externeImporte(join(wurzel, e), (p) => readFileSync(p, "utf8")), e).toEqual([]);
  });

  test("Prüfung des Prüfers: ohne Installation wird ein yaml-Import rot, mit npm ci ist der Workflow ausgenommen, Kommentare zählen nicht", () => {
    const ohne = "steps:\n  - run: node scripts/a.mjs\n  - run: node ./scripts/b.mjs --x\n";
    expect(einstiegeOhneInstallation(ohne)).toEqual(["scripts/a.mjs", "scripts/b.mjs"]);
    expect(externeImporte("/s/a.mjs", () => 'import { parse } from "yaml";')).toEqual(["yaml"]);
    for (const install of ["npm ci", "npm install", "npm i --x", "node scripts/gate-befehl.mjs install"]) {
      expect(einstiegeOhneInstallation(`steps:\n  - run: ${install}\n  - run: node scripts/a.mjs\n`), install).toBeNull();
    }
    expect(einstiegeOhneInstallation("# kein npm ci nötig\nsteps:\n  - run: node scripts/a.mjs\n")).toEqual(["scripts/a.mjs"]);
  });
});
