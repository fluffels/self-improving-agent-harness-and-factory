/* Harness-Doctor, Punkt `Meldestelle` (factory#208 L8): nur bei einer fremden Meldestelle; Token, Lesbarkeit, Issues aktiv, nie still grün. `lesen` ist die gh-Naht (kein Netz). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/harness-doctor-meldestelle.mjs";

type Ergebnis = { punkt: string; ok: boolean; befund?: string; fix?: string; nichtPruefbar?: boolean };
interface Lib {
  meldestellePunkt(a: { config: unknown; env: Record<string, string | undefined>; lesen: (args: string[], token?: string) => unknown }): Ergebnis[];
  mitMeldestelle(dateien: (a: { rootDir: string; config: unknown }) => Ergebnis[], o: { env: Record<string, string | undefined>; lesen: (args: string[], token?: string) => unknown }): (a: { rootDir: string; config: unknown }) => Ergebnis[];
}
const lib = raw as unknown as Lib;

const eigen = { repo: "acme/proj", boards: [{ rolle: "factory" }] };
const fremd = { repo: "acme/proj", meldestelle: "eingang/privat", boards: [{ rolle: "factory" }] };
const lesenOk = (antwort: unknown) => {
  const aufrufe: unknown[][] = [];
  return { aufrufe, lesen: (a: string[], t?: string) => (aufrufe.push([a, t]), antwort) };
};

describe("meldestellePunkt", () => {
  test("eigene Meldestelle (Standard: Repo des Factory-Boards = eigenes Repo): kein Punkt, kein Aufruf", () => {
    const { aufrufe, lesen } = lesenOk({});
    expect(lib.meldestellePunkt({ config: eigen, env: {}, lesen })).toEqual([]);
    expect(lib.meldestellePunkt({ config: { ...eigen, meldestelle: "ACME/proj" }, env: {}, lesen })).toEqual([]);
    expect(aufrufe).toEqual([]);
  });
  test("keine oder unlesbare Config: kein Punkt (nichts zu prüfen)", () => {
    const { lesen } = lesenOk({});
    for (const config of [undefined, null, "x", {}, { repo: "acme/proj", boards: "kaputt" }]) expect(lib.meldestellePunkt({ config, env: {}, lesen }), JSON.stringify(config)).toEqual([]);
  });
  test("fremde Stelle über das Factory-Board (ohne Schlüssel meldestelle): der Punkt entsteht", () => {
    const { lesen } = lesenOk({ has_issues: true });
    const cfg = { repo: "acme/proj", boards: [{ rolle: "factory", repo: "fabrik/kern" }] };
    expect(lib.meldestellePunkt({ config: cfg, env: { PROJECT_TOKEN: "pt" }, lesen })).toEqual([{ punkt: "Meldestelle", ok: true }]);
  });
  test("in Actions ohne MELDESTELLE_TOKEN und PROJECT_TOKEN: Lücke mit Fix, kein Aufruf", () => {
    const { aufrufe, lesen } = lesenOk({ has_issues: true });
    const [p] = lib.meldestellePunkt({ config: fremd, env: { GITHUB_ACTIONS: "true", MELDESTELLE_TOKEN: "" }, lesen });
    expect(p).toMatchObject({ punkt: "Meldestelle", ok: false });
    expect(p?.nichtPruefbar).toBeUndefined();
    expect(p?.befund).toContain("eingang/privat");
    expect(p?.befund).toMatch(/weder MELDESTELLE_TOKEN noch PROJECT_TOKEN/);
    expect(p?.fix).toContain("MELDESTELLE_TOKEN");
    expect(aufrufe).toEqual([]);
  });
  test("lokal ohne Token gilt das gh-Login: gelesen wird ohne Token", () => {
    const { aufrufe, lesen } = lesenOk({ has_issues: true });
    expect(lib.meldestellePunkt({ config: fremd, env: {}, lesen })).toEqual([{ punkt: "Meldestelle", ok: true }]);
    expect(aufrufe).toEqual([[["api", "repos/eingang/privat"], undefined]]);
  });
  test("MELDESTELLE_TOKEN schlägt PROJECT_TOKEN; PROJECT_TOKEN ist der Rückfall", () => {
    const a = lesenOk({ has_issues: true });
    lib.meldestellePunkt({ config: fremd, env: { GITHUB_ACTIONS: "true", MELDESTELLE_TOKEN: "mt", PROJECT_TOKEN: "pt" }, lesen: a.lesen });
    const b = lesenOk({ has_issues: true });
    lib.meldestellePunkt({ config: fremd, env: { GITHUB_ACTIONS: "true", PROJECT_TOKEN: "pt" }, lesen: b.lesen });
    expect(a.aufrufe[0]?.[1]).toBe("mt");
    expect(b.aufrufe[0]?.[1]).toBe("pt");
  });
  test("Lesefehler (403, 404, Netz): nicht prüfbar mit erster Fehlerzeile und Fix, nie grün", () => {
    const lesen = () => { throw new Error("HTTP 404: Not Found\nzweite Zeile"); };
    const [p] = lib.meldestellePunkt({ config: fremd, env: { PROJECT_TOKEN: "pt" }, lesen });
    expect(p).toMatchObject({ punkt: "Meldestelle", ok: false, nichtPruefbar: true });
    expect(p?.befund).toContain("HTTP 404: Not Found");
    expect(p?.befund).not.toContain("zweite Zeile");
    expect(p?.fix).toMatch(/Token/);
  });
  test("has_issues false, fehlend oder archiviert: Lücke; nur has_issues true ist grün", () => {
    const e = { PROJECT_TOKEN: "pt" };
    const aus = lib.meldestellePunkt({ config: fremd, env: e, lesen: () => ({ has_issues: false }) })[0];
    expect(aus).toMatchObject({ ok: false });
    expect(aus?.nichtPruefbar).toBeUndefined();
    expect(aus?.befund).toMatch(/Issues nicht aktiviert/);
    expect(lib.meldestellePunkt({ config: fremd, env: e, lesen: () => ({}) })[0]?.ok).toBe(false);
    expect(lib.meldestellePunkt({ config: fremd, env: e, lesen: () => null })[0]?.ok).toBe(false);
    const arch = lib.meldestellePunkt({ config: fremd, env: e, lesen: () => ({ has_issues: true, archived: true }) })[0];
    expect(arch).toMatchObject({ ok: false });
    expect(arch?.befund).toMatch(/archiviert/);
  });
});

describe("mitMeldestelle", () => {
  test("hängt den Punkt hinter die Dateipunkte; ohne fremde Stelle bleibt die Liste gleich; die Config kommt aus dem Aufruf", () => {
    const dateien = () => [{ punkt: "A", ok: true }];
    const { lesen } = lesenOk({ has_issues: true });
    const f = lib.mitMeldestelle(dateien, { env: { PROJECT_TOKEN: "pt" }, lesen });
    expect(f({ rootDir: "/x", config: fremd }).map((p) => p.punkt)).toEqual(["A", "Meldestelle"]);
    expect(f({ rootDir: "/x", config: eigen }).map((p) => p.punkt)).toEqual(["A"]);
  });
});
