/* Fitness-Function (Konvention #1398): ein Einstiegsskript (hat einen Direktaufruf-Guard und läuft per `node scripts/<name>.mjs`)
 * importiert nichts aus einem anderen Einstiegsskript. Gemeinsamer Code gehört in eine Lib ohne Guard (`ticket-refs.mjs`, `mess-lib.mjs` …).
 * Warum: ein Import aus einem Einstiegsskript zieht dessen Modul-Toplevel und Abhängigkeiten mit (bei Hook-Skripten Latenz und
 * Fehlerflächen) und koppelt zwei CLIs aneinander; in einem Bezieher bricht das die Konvention dort.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Kein Bestand: jeder Importeur zählt, auch eine Lib; der Test fordert `paare == []`. Ein Einstiegsskript darf aus Libs importieren,
 * nie umgekehrt und nie aus einem anderen Einstieg.
 *
 * Bekannte Grenzen der Erkennung: `GUARD` kennt nur `istDirektaufruf(import.meta.url)` aus `direktaufruf.mjs`. `IMPORT` ist eine
 * geschlossene Liste für relative Importe `./<name>.mjs` aus `scripts/*.mjs` (oberste Ebene): `from "…"`/`from '…'`, Seiteneffekt-Import
 * `import "…"` und `import("…")` mit Literal. Nicht erkannt: Unterordner, `../`, berechnete Spezifizierer.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const SKRIPTE = new URL("../../scripts/", import.meta.url);

/** Direktaufruf-Guard: `istDirektaufruf(import.meta.url)`. */
const GUARD = /istDirektaufruf\(import\.meta\.url\)/;
/** Relative Importe: `from "./x.mjs"` (auch `'`), `import "./x.mjs"` und `import("./x.mjs")`. */
const IMPORT = /(?:\bfrom\s+|\bimport\s*\(?\s*)["']\.\/([\w-]+)\.mjs["']/g;

type Quelle = Record<string, string>;

/** Einstiegsskripte unter den Quelltexten (Name ohne Endung). Pur. */
export function einstiegsskripte(quellen: Quelle): Set<string> {
  return new Set(Object.entries(quellen).filter(([, text]) => GUARD.test(text)).map(([name]) => name));
}

/** Alle Paare `importeur -> ziel`, bei denen das Ziel ein Einstiegsskript ist; der Importeur ist ein Einstieg oder eine Lib. Pur. */
export function einstiegsPaare(quellen: Quelle): string[] {
  const einstiege = einstiegsskripte(quellen);
  const paare = new Set<string>();
  for (const [name, text] of Object.entries(quellen)) {
    for (const m of text.matchAll(IMPORT)) if (einstiege.has(m[1]) && m[1] !== name) paare.add(`${name} -> ${m[1]}`);
  }
  return [...paare].sort();
}

const lade = (): Quelle =>
  Object.fromEntries(
    readdirSync(SKRIPTE)
      .filter((n) => n.endsWith(".mjs"))
      .map((n) => [n.replace(/\.mjs$/, ""), readFileSync(new URL(n, SKRIPTE), "utf8")]),
  );

describe("Einstiegsskripte importieren nicht voneinander (#1398)", () => {
  const quellen = lade();
  const paare = einstiegsPaare(quellen);

  test("die Erkennung findet die Einstiegsskripte (Plausibilität)", () => {
    expect(einstiegsskripte(quellen).size).toBeGreaterThanOrEqual(40);
    expect(einstiegsskripte(quellen).has("ticket-lock")).toBe(true);
    expect(einstiegsskripte(quellen).has("mess-lib")).toBe(false);
    expect(einstiegsskripte(quellen).has("ticket-refs")).toBe(false);
  });

  test("kein Skript importiert aus einem Einstiegsskript (kein Bestand)", () => {
    expect(paare).toEqual([]);
  });
});

describe("Erkennung und Bewertung (Negativfälle gegen die Funktionen selbst)", () => {
  const guard = "if (istDirektaufruf(import.meta.url)) main();";
  test("ein Import aus einem Einstiegsskript wird als Paar erkannt, aus einer Lib nicht", () => {
    const quellen: Quelle = {
      a: `import { x } from "./b.mjs";\nimport { y } from "./lib.mjs";\n${guard}`,
      b: guard,
      lib: "export const y = 1;",
    };
    expect(einstiegsPaare(quellen)).toEqual(["a -> b"]);
  });
  test("auch eine Lib als Importeur zählt: Lib -> Einstieg ist ein Paar", () => {
    expect(einstiegsPaare({ a: 'import { x } from "./b.mjs";', b: guard })).toEqual(["a -> b"]);
  });
  test("Einstieg -> Lib und Lib -> Lib sind keine Paare", () => {
    const a = `import { x } from "./l1.mjs";\n${guard}`;
    expect(einstiegsPaare({ a, l1: 'import { y } from "./l2.mjs";', l2: "export const y = 1;" })).toEqual([]);
  });
  test("ein Selbstimport zählt nicht", () => {
    expect(einstiegsPaare({ a: `import { x } from "./a.mjs";\n${guard}` })).toEqual([]);
  });
  test("einfache Anführungszeichen, Seiteneffekt-Import und import() mit Literal werden erkannt", () => {
    expect(einstiegsPaare({ a: "import { x } from './b.mjs';", b: guard })).toEqual(["a -> b"]);
    expect(einstiegsPaare({ a: 'import "./b.mjs";', b: guard })).toEqual(["a -> b"]);
    expect(einstiegsPaare({ a: 'const m = await import("./b.mjs");', b: guard })).toEqual(["a -> b"]);
  });
  test("Importe aus node:-Modulen und Unterordnern sind keine Paare", () => {
    expect(einstiegsPaare({ a: 'import { x } from "node:fs";\nimport { y } from "../b.mjs";', b: guard })).toEqual([]);
  });
});
