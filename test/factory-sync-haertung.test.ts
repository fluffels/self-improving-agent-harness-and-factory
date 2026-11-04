/* Sync-Härtung (#145): Werkzeug-Hinweis bei unbekannter Manifest-Version (L4) und Hinweis auf abweichende Test-Hilfe-Kopien im Ziel (L7). Pur über Speicher-Leser. */
import { describe, expect, test } from "vitest";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSync from "../scripts/factory-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTag from "../scripts/release-tag-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawExt from "../scripts/besitz-extraktion.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

const pc = rawPc as unknown as { ROLLEN_PFADE: Record<string, string>; PROJEKT_ROLLEN: string[] };
const ROLLEN = Object.entries(pc.ROLLEN_PFADE).filter(([r]) => !pc.PROJEKT_ROLLEN.includes(r)).map(([, p]) => p);

type Lies = (p: string) => string | null;
const sync = rawSync as unknown as { planeSync(a: { quelleLies: Lies; zielLies: Lies }): { fehler: string[]; meldungen: string[] } };
const tag = rawTag as unknown as { WERKZEUG_HINWEIS: string };
const ext = rawExt as unknown as { EXTRAKTION_PFAD: string; testHilfeKopienAbweichend(a: { quelleLies: Lies; zielLies: Lies }): string[] };

const leser = (m: Record<string, string>): Lies => (p) => m[p] ?? null;
const manifest = (version: number) => JSON.stringify({ version, eintraege: [] });

describe("L4: Versionsfehler trägt den Werkzeug-Hinweis", () => {
  test("version 4 unbekannt: Fehler mit WERKZEUG_HINWEIS", () => {
    const p = sync.planeSync({ quelleLies: leser({ ".factory/besitz.json": manifest(4) }), zielLies: leser({}) });
    expect(p.fehler.join("\n")).toContain("version 4 unbekannt");
    expect(p.fehler.join("\n")).toContain(tag.WERKZEUG_HINWEIS);
  });
  test("anderer Manifest-Fehler (version 3, unbekannter Ring): kein Hinweis", () => {
    const p = sync.planeSync({ quelleLies: leser({ ".factory/besitz.json": JSON.stringify({ version: 3, eintraege: [{ pfad: "x", ring: "zz", quelle: "t" }] }) }), zielLies: leser({}) });
    expect(p.fehler.length).toBeGreaterThan(0);
    expect(p.fehler.join("\n")).not.toContain(tag.WERKZEUG_HINWEIS);
  });
});

describe("L2: versionUnbekannt aus MANIFEST_VERSIONEN", () => {
  const b = rawBesitz as unknown as { MANIFEST_VERSIONEN: number[]; versionUnbekannt: (m: string) => boolean; pruefeManifest(m: unknown, l: Lies): string[] };
  test("nur die Versions-Meldung zählt, jede bekannte Version nicht", () => {
    const meldungen = b.pruefeManifest({ version: 9, eintraege: [] }, () => "t");
    expect(meldungen.some(b.versionUnbekannt)).toBe(true);
    expect(b.versionUnbekannt("x: unbekannte art 'besitz'")).toBe(false);
    for (const v of b.MANIFEST_VERSIONEN) expect(b.pruefeManifest({ version: v, eintraege: [] }, () => "t").some(b.versionUnbekannt)).toBe(false);
    expect(b.MANIFEST_VERSIONEN).not.toContain(9);
  });
});

const LISTE = (eintraege: unknown[]) => JSON.stringify({ version: 1, eintraege });
const HILFE = { muster: "test/support/a.ts", art: "test-hilfe", grund: "g" };
const quelleMit = (eintraege: object[], extra: Record<string, string> = {}) => leser({ [ext.EXTRAKTION_PFAD]: LISTE(eintraege), "test/support/a.ts": "x\n", ...extra });

describe("L7: testHilfeKopienAbweichend", () => {
  test("gleich: nichts", () => {
    expect(ext.testHilfeKopienAbweichend({ quelleLies: quelleMit([HILFE]), zielLies: leser({ "test/support/a.ts": "x\n" }) })).toEqual([]);
  });
  test("abweichend: Hinweis mit Pfad", () => {
    const r = ext.testHilfeKopienAbweichend({ quelleLies: quelleMit([HILFE]), zielLies: leser({ "test/support/a.ts": "y\n" }) });
    expect(r).toEqual(["Projektkopie test/support/a.ts weicht von der Quelle ab (Test-Hilfe, nicht verteilt; von Hand abgleichen oder entfernen)"]);
  });
  test("Quelle CRLF, Ziel LF: nichts", () => {
    expect(ext.testHilfeKopienAbweichend({ quelleLies: quelleMit([HILFE], { "test/support/a.ts": "x\r\n" }), zielLies: leser({ "test/support/a.ts": "x\n" }) })).toEqual([]);
  });
  test("nur CRLF: nichts", () => {
    expect(ext.testHilfeKopienAbweichend({ quelleLies: quelleMit([HILFE]), zielLies: leser({ "test/support/a.ts": "x\r\n" }) })).toEqual([]);
  });
  test("im Ziel fehlend: nichts", () => {
    expect(ext.testHilfeKopienAbweichend({ quelleLies: quelleMit([HILFE]), zielLies: leser({}) })).toEqual([]);
  });
  test("Glob und andere art ignoriert", () => {
    const liste = [{ muster: "test/support/*.ts", art: "test-hilfe", grund: "g" }, { muster: "test/support/a.ts", art: "fixture", grund: "g" }, { ring: "x", art: "nur-factory", grund: "g" }];
    expect(ext.testHilfeKopienAbweichend({ quelleLies: quelleMit(liste, { "test/support/*.ts": "q\n" }), zielLies: leser({ "test/support/a.ts": "y\n", "test/support/*.ts": "z\n" }) })).toEqual([]);
  });
  test("Eintraege ohne Liste, Nicht-Objekte und Hilfe ohne Quelldatei: nichts, kein Absturz", () => {
    const ziel = leser({ "test/support/a.ts": "y\n" });
    expect(ext.testHilfeKopienAbweichend({ quelleLies: leser({ [ext.EXTRAKTION_PFAD]: JSON.stringify({ eintraege: "x" }) }), zielLies: ziel })).toEqual([]);
    expect(ext.testHilfeKopienAbweichend({ quelleLies: leser({ [ext.EXTRAKTION_PFAD]: LISTE([null, 5, { art: "test-hilfe", grund: "g" }, HILFE]) }), zielLies: ziel })).toEqual([]);
    expect(ext.testHilfeKopienAbweichend({ quelleLies: leser({ [ext.EXTRAKTION_PFAD]: LISTE([HILFE]) }), zielLies: ziel })).toEqual([]);
  });
  test("Quelle ohne Liste oder mit kaputtem JSON: leer", () => {
    expect(ext.testHilfeKopienAbweichend({ quelleLies: leser({}), zielLies: leser({ "test/support/a.ts": "y\n" }) })).toEqual([]);
    expect(ext.testHilfeKopienAbweichend({ quelleLies: leser({ [ext.EXTRAKTION_PFAD]: "{kaputt" }), zielLies: leser({}) })).toEqual([]);
  });
  test("planeSync meldet den Hinweis", () => {
    const besitz = JSON.stringify({ version: 3, eintraege: ROLLEN.map((pfad) => ({ pfad, ring: "kern", quelle: "t" })) });
    const rollen = Object.fromEntries(ROLLEN.map((r) => [r, "rolle\n"]));
    const quelle = quelleMit([HILFE], { ".factory/besitz.json": besitz, ...rollen });
    const ziel = leser({ "test/support/a.ts": "y\n", ...Object.fromEntries(pc.PROJEKT_ROLLEN.map((r) => [pc.ROLLEN_PFADE[r], "x\n"])) });
    const p = sync.planeSync({ quelleLies: quelle, zielLies: ziel });
    expect(p.fehler).toEqual([]);
    expect(p.meldungen.join("\n")).toContain("Projektkopie test/support/a.ts weicht von der Quelle ab");
  });
});

describe("L12: begriffeAus ohne Abschluss-Skill", () => {
  const besitz = rawBesitz as unknown as { begriffeAus(c: unknown): Record<string, RegExp> };
  const config = (rawPc as unknown as { ladeProjektConfig: (o: { rootDir: string }) => Record<string, unknown> }).ladeProjektConfig({ rootDir: fileURLToPath(new URL("../", import.meta.url)) });
  test("skills.abschluss null: kein Skill-Muster, das das Wort null trifft", () => {
    const b = besitz.begriffeAus({ ...config, skills: { abschluss: null } });
    expect(b.Skill).toBeUndefined();
  });
  test("andere Skills bleiben, null wird übersprungen", () => {
    const b = besitz.begriffeAus({ ...config, skills: { abschluss: null, anders: "mein-skill" } });
    expect("ist null hier").not.toMatch(b.Skill);
    expect("ein mein-skill hier").toMatch(b.Skill);
  });
});
