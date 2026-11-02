/* Blatt-Importe-Wächter (factory#114): Blatt-Module werden direkt importiert, ihre Namen werden nicht über einen Re-Export weitergereicht.
 *
 * Ein Blatt-Modul besitzt seine Namen (`repo-form.mjs`: `istRepoForm` …, `sync-stand-lib.mjs`: `STAND_PFAD` …, `relativ-pfad.mjs`: `istRelativPosix`). Reicht eine Lib sie per
 * `export { … }` weiter, wächst deren Import-Hülle um Abnehmer, die den Blatt-Besitz nicht kennen, und der Besitz wird unauffindbar.
 * Rot wird jedes `export { … }` (mit oder ohne `from`) und jedes `export * from` in `scripts/**` (`.mjs`), das einen Namen aus einem
 * Blatt-Modul weiterreicht. Ausnahmen nur in der schrumpfenden `ALLOWLIST` (Datei -> `#<nr>` des offenen Tickets); ein Eintrag ohne
 * Befund ist selbst rot (Liste nur kürzen).
 *
 * Grenzen: Die Blatt-Liste ist geschlossen (`BLAETTER`). Erkannt werden nur Imports und Exports in Klammerform mit doppelten
 * Anführungszeichen; `import * as ns` samt `export { ns }` und ein Re-Export über ein Zwischenmodul (das selbst kein Blatt ist) nicht.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

/** Geschlossene Liste der Blatt-Module (Repo-Pfade). */
export const BLAETTER = ["scripts/relativ-pfad.mjs", "scripts/repo-form.mjs", "scripts/sync-stand-lib.mjs"];

/** Bestehende Re-Exports (Datei -> offenes Ticket). Nur kürzen; ein Eintrag ohne Befund lässt den Test rot werden. */
export const ALLOWLIST: Record<string, string> = {};

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

/** Alle .mjs unter `dir` rekursiv, als Repo-Pfade mit Präfix `rel`. */
function mjsPfade(rel: string): string[] {
  return readdirSync(join(WURZEL, rel), { withFileTypes: true }).flatMap((e) => {
    const pfad = `${rel}/${e.name}`;
    return e.isDirectory() ? mjsPfade(pfad) : e.name.endsWith(".mjs") ? [pfad] : [];
  });
}

const lies = (pfad: string): string => readFileSync(join(WURZEL, pfad), "utf8");
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
    for (const [datei, ticket] of Object.entries(ALLOWLIST)) {
      expect(ticket, datei).toMatch(/^#\d+/);
      expect(reexportFunde(datei, lies(datei), blaetter), `${datei}: Eintrag ohne Befund, streichen`).not.toEqual([]);
    }
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
