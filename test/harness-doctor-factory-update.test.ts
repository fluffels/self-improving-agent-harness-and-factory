/* Harness-Doctor, Punkt `Factory-Update` (factory#220 L39): nur im Bezieher; die Datei `.github/workflows/factory-update.yml` muss da sein und der Workflow `active`.
 * Jeder Zweig hat seinen Test; `lesen` ist die gh-Naht (kein Netz), `existiert` und `bezieher` sind injiziert. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/harness-doctor-factory-update.mjs";

type Ergebnis = { punkt: string; ok: boolean; befund?: string; fix?: string; nichtPruefbar?: boolean };
type Lesen = (args: string[], token?: string) => unknown;
interface Lib {
  factoryUpdatePunkt(a: { rootDir: string; config: unknown; lesen: Lesen; existiert?: (p: string) => boolean; bezieher?: (w: string) => boolean; vorAbbruch?: boolean }): Ergebnis[];
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
    expect(p?.fix).toContain("factory:sync");
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
    expect(f({ rootDir: "/x", config: undefined, vorAbbruch: true })).toEqual([{ punkt: "Eins", ok: true }]);
    expect(aufrufe).toEqual([]);
  });
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
    mkdirSync(join(bezieher, ".factory"), { recursive: true });
    writeFileSync(join(bezieher, ".factory", "sync-stand.json"), "{}");
    mkdirSync(join(bezieher, ".github", "workflows"), { recursive: true });
    writeFileSync(join(bezieher, ".github", "workflows", "factory-update.yml"), "name: x\n");
    const { lesen } = lesenMit({ state: "disabled_inactivity" });
    const f = doctor.dateienStandard({ env: {}, lesen, pruefe: () => [{ punkt: "Eins", ok: true }] });
    expect(f({ rootDir: fabrik, config }).map((p) => p.punkt)).toEqual(["Eins"]);
    const e = f({ rootDir: bezieher, config });
    expect(e.map((p) => p.punkt)).toEqual(["Eins", "Factory-Update"]);
    expect(e[1]).toMatchObject({ ok: false });
  });
});
