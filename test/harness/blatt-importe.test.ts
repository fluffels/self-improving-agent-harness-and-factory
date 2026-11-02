/* Blatt-Importe-Wächter (factory#114): Blatt-Module werden direkt importiert, ihre Namen werden nicht über einen Re-Export weitergereicht.
 *
 * Ein Blatt-Modul besitzt seine Namen (`repo-form.mjs`: `istRepoForm` …, `sync-stand-lib.mjs`: `STAND_PFAD` …, `relativ-pfad.mjs`: `istRelativPosix`). Reicht eine Lib sie per
 * `export { … }` weiter, wächst deren Import-Hülle um Abnehmer, die den Blatt-Besitz nicht kennen, und der Besitz wird unauffindbar.
 * Rot wird jedes `export { … }` (mit oder ohne `from`) und jedes `export * from` in `scripts/**` (`.mjs`), das einen Namen aus einem
 * Blatt-Modul weiterreicht. Ausnahmen nur in der schrumpfenden `ALLOWLIST` (Datei -> `#<nr>` des offenen Tickets); ein Eintrag ohne
 * Befund ist selbst rot (Liste nur kürzen).
 *
 * Blatt ist, wer als erste Zeile `// Blatt-Modul …` trägt (Glossar „Blatt-Modul“); die Liste wird daraus abgeleitet, ein neues Blatt braucht nur die Kopfzeile.
 * Zweiter Block: ein Blatt-Modul importiert nur `node:`-Builtins oder andere Blätter (Negativfixtures unten).
 * Entscheidung (L13): der eigene Import-Parser bleibt, weil die Namen der Bindungen gebraucht werden (Re-Export-Erkennung); `importeAus` liefert nur Spezifizierer.
 * Grenzen: Ein Blatt ohne diese Kopfzeile wird nicht erkannt (die Kopfzeile ist die Anmeldung, nicht die Importprüfung). Erkannt werden nur Imports und Exports in Klammerform mit doppelten
 * Anführungszeichen; `import * as ns` samt `export { ns }` und ein Re-Export über ein Zwischenmodul (das selbst kein Blatt ist) nicht.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { dateienUnter } from "../support/dateien";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

/** Die Kopfzeile, die ein Skript zum Blatt-Modul macht (factory#127): die erste Zeile beginnt mit `// Blatt-Modul`. */
export const BLATT_KOPF = /^\/\/ Blatt-Modul(?![\w-])/;

/** Pur: trägt der Text die Blatt-Kopfzeile (nur die allererste Zeile zählt)? */
export const istBlatt = (text: string): boolean => BLATT_KOPF.test(text);

/** Bestehende Re-Exports (Datei -> offenes Ticket). Nur kürzen; ein Eintrag ohne Befund lässt den Test rot werden. */
export const ALLOWLIST: Record<string, string> = {};

/** Pur: Meldungen (leer = grün) zur ALLOWLIST: jeder Eintrag trägt ein `#<nr>` und hat noch einen Befund (`funde(datei)`). */
export function allowlistMeldungen(allowlist: Record<string, string>, funde: (datei: string) => string[]): string[] {
  return Object.entries(allowlist).flatMap(([datei, ticket]) => [
    ...(/^#\d+/.test(ticket) ? [] : [`${datei}: Eintrag ohne #<nr> des offenen Tickets`]),
    ...(funde(datei).length > 0 ? [] : [`${datei}: Eintrag ohne Befund, streichen`]),
  ]);
}

/** Die Namen, die ein Blatt-Modul selbst deklariert (`export const|function|class|let NAME`). */
export function blattNamen(text: string): Set<string> {
  return new Set([...text.matchAll(/^export\s+(?:async\s+)?(?:const|let|function\*?|class)\s+([\w$]+)/gm)].map((m) => m[1]));
}

/** `a`, `a as b` -> `{ lokal: "a", aussen: "b" }`. */
const posten = (liste: string): { lokal: string; aussen: string }[] =>
  liste.split(",").map((t) => t.trim()).filter(Boolean).map((t) => {
    const [lokal = "", aussen = lokal] = t.split(/\s+as\s+/);
    return { lokal, aussen };
  });

/** Befunde einer Datei: weitergereichte Blatt-Namen. Pur. `blaetter`: Repo-Pfad des Blatts -> seine Namen. */
export function reexportFunde(pfad: string, text: string, blaetter: Record<string, Set<string>>): string[] {
  const aufloesen = (spec: string): string => posix.join(dirname(pfad), spec);
  const importiert = new Map<string, string>(); // lokaler Name -> Blatt-Pfad
  for (const m of text.matchAll(/^import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/gm)) {
    const blatt = aufloesen(m[2]);
    const namen = blaetter[blatt];
    if (!namen) continue;
    for (const { lokal, aussen } of posten(m[1])) if (namen.has(lokal)) importiert.set(aussen, blatt);
  }
  const funde: string[] = [];
  for (const m of text.matchAll(/^export\s*\{([^}]*)\}(?:\s*from\s*"([^"]+)")?/gm)) {
    const quelle = m[2] === undefined ? undefined : aufloesen(m[2]);
    for (const { lokal } of posten(m[1])) {
      const aus = quelle === undefined ? importiert.get(lokal) : blaetter[quelle]?.has(lokal) ? quelle : undefined;
      if (aus) funde.push(`${pfad}: ${lokal} (aus ${aus})`);
    }
  }
  for (const m of text.matchAll(/^export\s*\*(?:\s*as\s+[\w$]+)?\s*from\s*"([^"]+)"/gm)) {
    const quelle = aufloesen(m[1]);
    if (blaetter[quelle]) funde.push(`${pfad}: export * (aus ${quelle})`);
  }
  return funde;
}

/** Pur: Meldungen zu den Importen eines Blatt-Moduls: jeder statische Import und Re-Export muss `node:` oder ein anderes Blatt (aufgelöster Repo-Pfad in `blaetter`) sein. */
export function blattImportMeldungen(pfad: string, text: string, blaetter: readonly string[]): string[] {
  const spezifizierer = [...text.matchAll(/^(?:import|export)\b[^"';]*?\bfrom\s*"([^"]+)"|^import\s*"([^"]+)"/gm)].map((m) => m[1] ?? m[2]);
  return spezifizierer
    .filter((spec) => !spec.startsWith("node:") && !(spec.startsWith(".") && blaetter.includes(posix.join(dirname(pfad), spec))))
    .map((spec) => `${pfad}: importiert "${spec}" (ein Blatt-Modul importiert nur node:-Builtins oder andere Blätter)`);
}

const mjsPfade = (rel: string): string[] => dateienUnter(WURZEL, rel, /\.mjs$/);
const lies = (pfad: string): string => readFileSync(join(WURZEL, pfad), "utf8");

/** Geschlossene Liste der Blatt-Module (Repo-Pfade): jedes Skript unter `scripts/` mit der Kopfzeile `// Blatt-Modul`, abgeleitet statt von Hand geführt. */
const BLAETTER = mjsPfade("scripts").filter((p) => istBlatt(lies(p)));
const echteBlaetter = (): Record<string, Set<string>> => Object.fromEntries(BLAETTER.map((b) => [b, blattNamen(lies(b))]));

describe("Blatt-Importe (factory#114)", () => {
  test("kein Skript reicht einen Blatt-Namen per Re-Export weiter (außer der ALLOWLIST)", () => {
    const blaetter = echteBlaetter();
    // Leerlauf-Schutz: die Blätter besitzen Namen, der Scan sieht Unterordner.
    expect(blaetter["scripts/repo-form.mjs"]?.has("istRepoForm")).toBe(true);
    expect(blaetter["scripts/sync-stand-lib.mjs"]?.has("STAND_PFAD")).toBe(true);
    expect(blaetter["scripts/relativ-pfad.mjs"]?.has("istRelativPosix")).toBe(true);
    const pfade = mjsPfade("scripts");
    expect(pfade.length).toBeGreaterThan(20);
    expect(pfade.some((p) => p.split("/").length > 2)).toBe(true);
    const funde = pfade.flatMap((p) => reexportFunde(p, lies(p), blaetter)).filter((f) => !Object.hasOwn(ALLOWLIST, f.slice(0, f.indexOf(":"))));
    expect(funde).toEqual([]);
  });

  test("die ALLOWLIST schrumpft nur: jeder Eintrag trägt ein #<nr> und hat noch einen Befund", () => {
    const blaetter = echteBlaetter();
    expect(allowlistMeldungen(ALLOWLIST, (datei) => reexportFunde(datei, lies(datei), blaetter))).toEqual([]);
  });

  describe("ALLOWLIST-Prüfung (Fixtures)", () => {
    const funde = (datei: string): string[] => (datei === "scripts/mit-befund.mjs" ? ["x"] : []);
    test("Eintrag mit #<nr> und Befund ist grün", () => {
      expect(allowlistMeldungen({ "scripts/mit-befund.mjs": "#12 Rest" }, funde)).toEqual([]);
    });
    test("Eintrag ohne Befund ist rot", () => {
      expect(allowlistMeldungen({ "scripts/ohne.mjs": "#12" }, funde)).toEqual(["scripts/ohne.mjs: Eintrag ohne Befund, streichen"]);
    });
    test("Eintrag ohne #<nr> ist rot", () => {
      expect(allowlistMeldungen({ "scripts/mit-befund.mjs": "später" }, funde)).toEqual(["scripts/mit-befund.mjs: Eintrag ohne #<nr> des offenen Tickets"]);
    });
  });

  describe("Blatt-Erkennung über die Kopfzeile (factory#127)", () => {
    test("die abgeleitete Liste enthält die bekannten Blätter (kein Leerlauf)", () => {
      for (const b of ["scripts/relativ-pfad.mjs", "scripts/repo-form.mjs", "scripts/sync-stand-lib.mjs", "scripts/harness-doctor-ergebnis.mjs"]) expect(BLAETTER, b).toContain(b);
    });
    test("nur die erste Zeile `// Blatt-Modul` zählt; ein Blatt ohne Kopfzeile wird nicht erkannt", () => {
      expect(istBlatt("// Blatt-Modul ohne Importe (#101): x\nexport const a = 1;")).toBe(true);
      expect(istBlatt("// Blatt-Modul: nur Builtins")).toBe(true);
      expect(istBlatt("export const a = 1;\n// Blatt-Modul")).toBe(false);
      expect(istBlatt("// Kein Blatt-Modul, nur Prosa")).toBe(false);
      expect(istBlatt("// Blatt-Modulgrenze")).toBe(false);
      expect(istBlatt("/* Blatt-Modul */")).toBe(false);
    });
  });

  test("jedes Blatt-Modul importiert nur node:-Builtins oder andere Blätter", () => {
    expect(BLAETTER.length).toBeGreaterThan(3);
    expect(BLAETTER.flatMap((b) => blattImportMeldungen(b, lies(b), BLAETTER))).toEqual([]);
  });

  describe("blattImportMeldungen (Fixtures)", () => {
    const BL = ["scripts/a.mjs", "scripts/b.mjs"];
    const m = (text: string, pfad = "scripts/a.mjs") => blattImportMeldungen(pfad, text, BL);
    test("erlaubt: node:-Builtins und andere Blätter, auch mehrzeilig und als Re-Export", () => {
      expect(m('import { x } from "node:fs";\nimport { y } from "./b.mjs";\nexport { z } from "./b.mjs";')).toEqual([]);
      expect(m('import {\n  x,\n  y,\n} from "./b.mjs";')).toEqual([]);
    });
    test("Negativ: ein Nicht-Blatt, ein Paket und ein Seiteneffekt-Import sind Funde", () => {
      expect(m('import { x } from "./lib.mjs";')).toEqual(['scripts/a.mjs: importiert "./lib.mjs" (ein Blatt-Modul importiert nur node:-Builtins oder andere Blätter)']);
      expect(m('import { parse } from "yaml";')).toHaveLength(1);
      expect(m('import "./seiteneffekt.mjs";')).toHaveLength(1);
      expect(m('export * from "./lib.mjs";')).toHaveLength(1);
    });
    test("Unterordner werden relativ zur Datei aufgelöst", () => {
      expect(m('import { x } from "../a.mjs";', "scripts/sub/c.mjs")).toEqual([]);
      expect(m('import { x } from "./a.mjs";', "scripts/sub/c.mjs")).toHaveLength(1);
    });
  });

  describe("reexportFunde (Fixtures)", () => {
    const B = { "scripts/leaf.mjs": new Set(["A", "B"]) };
    const f = (text: string, pfad = "scripts/lib.mjs") => reexportFunde(pfad, text, B);
    test("Re-Export mit from wird gefunden, auch mit Alias und mehrzeilig", () => {
      expect(f('export { A } from "./leaf.mjs";')).toEqual(["scripts/lib.mjs: A (aus scripts/leaf.mjs)"]);
      expect(f('export { B as C } from "./leaf.mjs";')).toEqual(["scripts/lib.mjs: B (aus scripts/leaf.mjs)"]);
      expect(f('export {\n  A,\n  B,\n} from "./leaf.mjs";')).toHaveLength(2);
    });
    test("Import und Export ohne from wird gefunden, auch mit Import-Alias", () => {
      expect(f('import { A, X } from "./leaf.mjs";\nexport { A, X };')).toEqual(["scripts/lib.mjs: A (aus scripts/leaf.mjs)"]);
      expect(f('import { A as Z } from "./leaf.mjs";\nexport { Z };')).toEqual(["scripts/lib.mjs: Z (aus scripts/leaf.mjs)"]);
    });
    test("export * from wird gefunden, auch mit Namensraum", () => {
      expect(f('export * from "./leaf.mjs";')).toHaveLength(1);
      expect(f('export * as ns from "./leaf.mjs";')).toHaveLength(1);
    });
    test("Pfade aus Unterordnern werden relativ zur Datei aufgelöst", () => {
      expect(f('export { A } from "../leaf.mjs";', "scripts/sub/lib.mjs")).toHaveLength(1);
      expect(f('export { A } from "./leaf.mjs";', "scripts/sub/lib.mjs")).toEqual([]);
    });
    test("kein Befund: direkter Import ohne Export, Export eigener Namen, Re-Export aus einem Nicht-Blatt, Namen nicht aus dem Blatt", () => {
      expect(f('import { A } from "./leaf.mjs";\nexport const x = A;')).toEqual([]);
      expect(f("const A = 1;\nexport { A };")).toEqual([]);
      expect(f('export { A } from "./anders.mjs";')).toEqual([]);
      expect(f('export { X } from "./leaf.mjs";')).toEqual([]);
      expect(f('import { X } from "./leaf.mjs";\nexport { X };')).toEqual([]);
      expect(f('import { A } from "./anders.mjs";\nexport { A };')).toEqual([]);
    });
    test("blattNamen liest const, function, async function, class und let, aber keine Klammer-Exports", () => {
      expect([...blattNamen("export const A = 1;\nexport function b() {}\nexport async function c() {}\nexport class D {}\nexport let e;\nexport { f };")].sort()).toEqual(["A", "D", "b", "c", "e"]);
    });
  });
});
