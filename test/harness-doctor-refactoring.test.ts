/* Harness-Doctor, Punkt `Refactoring-Sammelticket` (factory#597): vorhanden → gut, fehlt → Lücke, abgeschaltet → Lücke (nie gut). `lesen` ist die gh-Naht (kein Netz). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/harness-doctor-refactoring.mjs";

type Ergebnis = { punkt: string; ok: boolean; befund?: string; fix?: string; nichtPruefbar?: boolean };
type Lesen = (args: string[]) => unknown;
interface Args { config: unknown; rootDir: string; lesen: Lesen; bezieher?: () => boolean; vorAbbruch?: boolean }
interface Lib {
  refactoringPunkt(a: Args): Ergebnis[];
  mitRefactoring(d: (a: { rootDir: string; config: unknown }) => Ergebnis[], o: { lesen: Lesen; bezieher: () => boolean }): (a: { rootDir: string; config: unknown }) => Ergebnis[];
}
const lib = raw as unknown as Lib;

const config = { repo: "acme/proj" };
const ja = () => true;
const nein = () => false;
const lesenOk = (antwort: unknown) => {
  const aufrufe: string[][] = [];
  return { aufrufe, lesen: (a: string[]) => (aufrufe.push(a), antwort) };
};
const issue = (title: string, extra: object = {}) => ({ number: 1, title, ...extra });

describe("refactoringPunkt", () => {
  test("Ticket mit neuem Titel offen → gut, ein Aufruf", () => {
    const { aufrufe, lesen } = lesenOk([[issue("Refactoring (gesammelt)")]]);
    expect(lib.refactoringPunkt({ config, rootDir: "x", lesen, bezieher: ja })).toEqual([{ punkt: "Refactoring-Sammelticket", ok: true }]);
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]).toContain("repos/acme/proj/issues?state=open&per_page=100");
  });
  test("nur Alttitel offen → gut", () => {
    const { lesen } = lesenOk([[issue("Codequalität (gesammelt)")]]);
    expect(lib.refactoringPunkt({ config, rootDir: "x", lesen, bezieher: ja })[0].ok).toBe(true);
  });
  test("kein passendes Issue (ein PR mit exaktem Titel zählt nicht) → Lücke mit Anlege-Befehl", () => {
    const { lesen } = lesenOk([[issue("Etwas anderes"), issue("Refactoring (gesammelt)", { pull_request: {} })]]);
    const [r] = lib.refactoringPunkt({ config, rootDir: "x", lesen, bezieher: ja });
    expect(r.ok).toBe(false);
    expect(r.nichtPruefbar).toBeUndefined();
    expect(r.fix).toContain("sammelticket-anlegen.mjs refactoring");
  });
  test("Negativfall: abgeschaltet → Lücke „abgeschaltet (ausgewiesen)“, nie gut, kein Aufruf", () => {
    const { aufrufe, lesen } = lesenOk([[issue("Refactoring (gesammelt)")]]);
    const [r] = lib.refactoringPunkt({ config: { ...config, labels: { refactoring: false } }, rootDir: "x", lesen, bezieher: ja });
    expect(r.ok).toBe(false);
    expect(r.befund).toContain("abgeschaltet (ausgewiesen)");
    expect(aufrufe).toEqual([]);
  });
  test("Label-String gilt wie an", () => {
    const { lesen } = lesenOk([[issue("Refactoring (gesammelt)")]]);
    expect(lib.refactoringPunkt({ config: { ...config, labels: { refactoring: "area:refactoring" } }, rootDir: "x", lesen, bezieher: ja })[0].ok).toBe(true);
  });
  test("lesen wirft → nicht prüfbar, nie gut", () => {
    const lesen = () => {
      throw new Error("HTTP 403\nzweite Zeile");
    };
    const [r] = lib.refactoringPunkt({ config, rootDir: "x", lesen, bezieher: ja });
    expect(r.ok).toBe(false);
    expect(r.nichtPruefbar).toBe(true);
    expect(r.befund).toContain("HTTP 403");
    expect(r.befund).not.toContain("zweite Zeile");
  });
  test("kein Bezieher → kein Punkt, kein Aufruf", () => {
    const { aufrufe, lesen } = lesenOk([]);
    expect(lib.refactoringPunkt({ config, rootDir: "x", lesen, bezieher: nein })).toEqual([]);
    expect(aufrufe).toEqual([]);
  });
  test("Vorab-Abbruch → nicht prüfbar, kein Aufruf", () => {
    const { aufrufe, lesen } = lesenOk([]);
    const [r] = lib.refactoringPunkt({ config: undefined, rootDir: "x", lesen, bezieher: ja, vorAbbruch: true });
    expect(r.nichtPruefbar).toBe(true);
    expect(aufrufe).toEqual([]);
  });
  test("Null-Einträge in einer Seite werfen nicht, der Treffer zählt", () => {
    const { lesen } = lesenOk([[null, issue("Refactoring (gesammelt)")]]);
    expect(lib.refactoringPunkt({ config, rootDir: "x", lesen, bezieher: ja })[0].ok).toBe(true);
  });
  test("Paginierung: Treffer auf Seite 2 → gut", () => {
    const { lesen } = lesenOk([[issue("a")], [issue("Refactoring (gesammelt)")]]);
    expect(lib.refactoringPunkt({ config, rootDir: "x", lesen, bezieher: ja })[0].ok).toBe(true);
  });
});

describe("mitRefactoring", () => {
  test("hängt den Punkt hinter die übrigen Dateipunkte", () => {
    const { lesen } = lesenOk([[issue("Refactoring (gesammelt)")]]);
    const davor: Ergebnis = { punkt: "Davor", ok: true };
    const f = lib.mitRefactoring(() => [davor], { lesen, bezieher: ja });
    expect(f({ rootDir: "x", config }).map((e) => e.punkt)).toEqual(["Davor", "Refactoring-Sammelticket"]);
  });
  test("vorAbbruch wird durchgereicht: nicht prüfbar mit Grund „Config nicht geladen“, kein Aufruf", () => {
    const { aufrufe, lesen } = lesenOk([]);
    const f = lib.mitRefactoring(() => [], { lesen, bezieher: ja }) as unknown as (a: { rootDir: string; config: unknown; vorAbbruch: boolean }) => Ergebnis[];
    const [r] = f({ rootDir: "x", config: undefined, vorAbbruch: true });
    expect(r.nichtPruefbar).toBe(true);
    expect(r.befund).toContain("Config nicht geladen");
    expect(aufrufe).toEqual([]);
  });
});
