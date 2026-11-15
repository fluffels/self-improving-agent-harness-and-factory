/* Filterdurchlauf (factory#532): Parser, Fixliste, Arme, Verwerfen und CLI. Kern aus scripts/lens-filter.mjs, Arm aus scripts/nachweis-lib.mjs. */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/lens-filter.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/nachweis-lib.mjs";

type Fix = { id: string; schwere: string; ort: string; brillen: string[]; befunde: string[] };
type Erg = { arm: string | null; fixliste: Fix[]; verworfen: { id: string; begruendung: string }[]; rundenZeile: string; pass: string };
const L = raw as unknown as {
  parseBerichte: (t: string) => { lens: string; funde: { schwere: string; befund: string; ort: string }[] }[];
  bildeFixliste: (l: unknown) => Fix[];
  verwerfe: (f: Fix[], a: { id: string; begruendung: string }[], arm: string | null) => { fixliste: Fix[]; verworfen: unknown[] };
  filtere: (o: { text: string; runde: number; ticket?: number | null; verwerfen?: { id: string; begruendung: string }[] }) => Erg;
  formatiere: (e: Erg) => string;
  liesArgumente: (a: string[]) => { runde: number; ticket: number | null; verwerfen: { id: string; begruendung: string }[] };
};
const { armAusTicket } = libRaw as unknown as { armAusTicket: (n: unknown) => string };
const SKRIPT = fileURLToPath(new URL("../scripts/lens-filter.mjs", import.meta.url));

const B = (name: string, ...zeilen: string[]) => `## Lens: ${name}\nVerdikt: x\n\n${zeilen.join("\n")}\n`;
const BLOCK = (ort: string, text = "Regression") => `- [❌ blockierend] ${text} — \`${ort}\` — Beleg`;
const SOLL = (ort: string, text = "Lücke") => `- [🔶 sollte]      ${text} — \`${ort}\` — Beleg`;
const HIN = (ort: string) => `- [⚠️ Hinweis]     Grenze — \`${ort}\` — Beleg`;

describe("armAusTicket", () => {
  test("durch 4 teilbar ⇒ vollablauf, sonst schlank", () => {
    for (const n of [4, 8, 532, 1000]) expect(armAusTicket(n)).toBe("vollablauf");
    for (const n of [1, 2, 3, 533, 534]) expect(armAusTicket(n)).toBe("schlank");
  });
  test("ungültige Nummern werfen", () => {
    for (const n of [0, -4, 1.5, Number.NaN, "532", null]) expect(() => armAusTicket(n)).toThrow();
  });
});

describe("parseBerichte", () => {
  test("liest Brillen, Schweren, Ort und Befund; Kombi-Lens und Umlaute", () => {
    const l = L.parseBerichte(B("Test-Adäquanz", BLOCK("a/b.mjs:12-14"), SOLL("x.ts:1"), HIN("y.ts:2")) + B("Kombiniert"));
    expect(l.map((x) => x.lens)).toEqual(["test-adaequanz", "kombiniert"]);
    expect(l[0].funde.map((f) => f.schwere)).toEqual(["blockierend", "sollte", "hinweis"]);
    expect(l[0].funde[0]).toMatchObject({ befund: "Regression", ort: "a/b.mjs:12-14" });
    expect(l[1].funde).toEqual([]);
  });
  test("Fehler: kein Lens-Block, unbekannte Brille, doppelte Brille", () => {
    expect(() => L.parseBerichte("nur Text")).toThrow(/kein Lens-Block/);
    expect(() => L.parseBerichte(B("Wetter"))).toThrow(/unbekannte Brille/);
    expect(() => L.parseBerichte(B("Doku") + B("doku"))).toThrow(/doppelt/);
  });
});

describe("Fixliste und Runde-Zeile", () => {
  const text = B("Architektur", SOLL("b.ts:2"), BLOCK("a.ts:1"), HIN("h.ts:1")) + B("Requirement-Treue", BLOCK("A.ts:1"), SOLL("c.ts:3")) + B("Test-Adäquanz");
  test("gleiche Fundstelle und Schwere über Brillen wird ein Eintrag, Reihenfolge Schwere dann Ort, Hinweise fehlen", () => {
    const e = L.filtere({ text, runde: 1 });
    expect(e.fixliste.map((f) => [f.id, f.schwere, f.ort, f.brillen])).toEqual([
      ["F1", "blockierend", "a.ts:1", ["architektur", "requirement-treue"]],
      ["F2", "sollte", "b.ts:2", ["architektur"]],
      ["F3", "sollte", "c.ts:3", ["requirement-treue"]],
    ]);
  });
  test("gleiche Fundstelle mit unterschiedlicher Schwere bleibt getrennt, die Schwere ändert der Filter nie", () => {
    const e = L.filtere({ text: B("Architektur", BLOCK("a.ts:1")) + B("Doku", SOLL("a.ts:1")), runde: 1 });
    expect(e.fixliste.map((f) => f.schwere)).toEqual(["blockierend", "sollte"]);
  });
  test("Runde-Zeile zählt je Brille über die Original-Funde, Brille ohne Funde :0", () => {
    expect(L.filtere({ text, runde: 2 }).rundenZeile).toBe(
      "Runde 2: lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:1,requirement-treue:1,test-adaequanz:0 sollte=architektur:1,requirement-treue:1,test-adaequanz:0 hinweis=architektur:1,requirement-treue:0,test-adaequanz:0",
    );
  });
  test("--runde muss eine ganze Zahl ≥ 1 sein", () => {
    expect(() => L.filtere({ text, runde: 0 })).toThrow(/--runde/);
    expect(() => L.filtere({ text, runde: Number.NaN })).toThrow(/--runde/);
  });
});

describe("Arme und Pass-Urteil", () => {
  test("ein Hinweis allein konvergiert in beiden Armen", () => {
    const t = B("Doku", HIN("x.md:1"));
    expect(L.filtere({ text: t, runde: 1 }).pass).toBe("konvergiert");
    expect(L.filtere({ text: t, runde: 1, ticket: 533 }).pass).toBe("konvergiert");
  });
  test("vollablauf: sollte löst Delta aus; ohne --ticket gleich, keine Arm-Zeile", () => {
    const t = B("Doku", SOLL("x.md:1"));
    expect(L.filtere({ text: t, runde: 1, ticket: 532 })).toMatchObject({ arm: "vollablauf", pass: "delta-noetig" });
    const ohne = L.filtere({ text: t, runde: 1 });
    expect(ohne).toMatchObject({ arm: null, pass: "delta-noetig" });
    expect(L.formatiere(ohne)).not.toMatch(/^arm=/m);
  });
  test("schlank: sollte verworfen mit Begründung konvergiert, blockierend nie; unverworfenes sollte (gefixt) zieht Delta nach", () => {
    const t = B("Doku", SOLL("x.md:1"));
    const e = L.filtere({ text: t, runde: 1, ticket: 533, verwerfen: [{ id: "F1", begruendung: "Bekannte Grenze, kein Verhaltensfehler" }] });
    expect(e).toMatchObject({ arm: "schlank", pass: "konvergiert", fixliste: [] });
    expect(e.verworfen).toHaveLength(1);
    expect(L.filtere({ text: t, runde: 1, ticket: 533 }).pass).toBe("delta-noetig");
    expect(L.formatiere(e)).toMatch(/arm=schlank\npass: konvergiert/);
  });
});

describe("Verwerfen: Negativfälle (K5)", () => {
  const fix = (): Fix[] => L.bildeFixliste(L.parseBerichte(B("Doku", BLOCK("a.md:1"), SOLL("b.md:2"))));
  test("blockierender Fund: Fehler, nichts verworfen (auch nicht der gültige zweite Auftrag)", () => {
    const f = fix();
    const vorher = JSON.stringify(f);
    expect(() => L.verwerfe(f, [{ id: "F2", begruendung: "gut" }, { id: "F1", begruendung: "gut" }], "schlank")).toThrow(/blockierend/);
    expect(JSON.stringify(f)).toBe(vorher);
  });
  test.each(["", "…", "...", "-", "  ", "<…>"])("leere Begründung %j: Fehler", (b) => {
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: b }], "schlank")).toThrow(/Begründung/);
  });
  test("unbekannte ID, doppelte ID und Arm vollablauf bzw. ohne Arm: Fehler", () => {
    expect(() => L.verwerfe(fix(), [{ id: "F9", begruendung: "x y" }], "schlank")).toThrow(/unbekannte/);
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: "x y" }, { id: "F2", begruendung: "x y" }], "schlank")).toThrow(/doppelt/);
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: "x y" }], "vollablauf")).toThrow(/nur im Arm schlank/);
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: "x y" }], null)).toThrow(/nur im Arm schlank/);
  });
});

describe("liesArgumente", () => {
  test("Argumente, Begründung darf = enthalten", () => {
    expect(L.liesArgumente(["--runde", "2", "--ticket", "533", "--verwerfen", "F1=a=b"])).toEqual({ runde: 2, ticket: 533, verwerfen: [{ id: "F1", begruendung: "a=b" }] });
  });
  test("Fehler: fehlender Wert, kaputtes Verwerfen, unbekanntes Argument", () => {
    expect(() => L.liesArgumente(["--runde"])).toThrow();
    expect(() => L.liesArgumente(["--verwerfen", "F1"])).toThrow(/F<k>=/);
    expect(() => L.liesArgumente(["--foo"])).toThrow(/unbekannt/);
  });
});

describe("CLI", () => {
  const lauf = (args: string[], input: string) => spawnSync(process.execPath, [SKRIPT, ...args], { input, encoding: "utf8" });
  const text = B("Doku", BLOCK("a.md:1"), SOLL("b.md:2"));
  test("Exit 0 mit Fixliste, Runde-Zeile, Arm und pass", () => {
    const r = lauf(["--runde", "1", "--ticket", "533", "--verwerfen", "F2=Kosmetik, kein Verhaltensfehler"], text);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/F1 \[blockierend\]/);
    expect(r.stdout).toMatch(/verworfen F2/);
    expect(r.stdout).toMatch(/Runde 1: lenses=doku blocker=doku:1 sollte=doku:1 hinweis=doku:0/);
    expect(r.stdout).toMatch(/pass: delta-noetig/);
  });
  test("Exit 2: Verwerfen eines blockierenden Funds, leere Begründung, fehlende --runde, kein Bericht", () => {
    expect(lauf(["--runde", "1", "--ticket", "533", "--verwerfen", "F1=guter Grund"], text).status).toBe(2);
    expect(lauf(["--runde", "1", "--ticket", "533", "--verwerfen", "F2=…"], text).status).toBe(2);
    expect(lauf([], text).status).toBe(2);
    expect(lauf(["--runde", "1"], "leer").status).toBe(2);
  });
});
