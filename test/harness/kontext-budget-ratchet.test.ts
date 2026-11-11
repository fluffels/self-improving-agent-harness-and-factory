/* Budget-Ratchet-Wächter (factory#307): ein Zeichen-Budget aus `scripts/kontext-budget-lib.mjs` darf gegenüber der Diff-Basis (Merge-Base) nicht steigen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft: `AGENTEN_SKILL_BUDGETS` (je Datei) und `AGENTEN_SKILL_DEFAULT_BUDGET`. `budgetWerte` leitet die Werte aus dem QUELLTEXT der Lib ab (auch aus dem der Basis, ohne sie zu importieren);
 * ein Test hält den Parser gleich dem Import (Formatdrift in der Lib wird rot, nicht still leer). Ein Schlüssel, den die Basis nicht kennt (neue Datei, neue Konstante), gilt mit seinem Ist-Wert
 * (`erlaubteBudgets`): ein neuer Eintrag ist keine Anhebung von 0. Ohne Diff-Basis lokal entfällt der Test, in der CI ist das rot (fail-closed, `diffBasisModus`).
 *
 * Erweiterung (factory#237): die Commit-Zeile `SIH-Budget-Beleg` und weitere Konstanten (`CONTEXT_BUDGETS`, `KERN_BLOCK_BUDGET`, `MODULE_AGENTS_BUDGET`) kommen in genau diesen Test; keine zweite Ratchet-Mechanik.
 * Grenze: wer ein Budget anhebt UND dieselbe Datei um den Betrag wachsen lässt, ist erst mit `SIH-Budget-Beleg` (factory#237) sichtbar; bis dahin ist die Anhebung hier immer rot.
 * Verfall: Prüftermin laut `.github/wiedervorlagen.json` (Eintrag `regeln-verfall-2027-03`, ADR 0027). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – .mjs ohne Typdeklaration
import * as checkBasis from "../../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { AGENTEN_SKILL_BUDGETS as rawBudgets, AGENTEN_SKILL_DEFAULT_BUDGET as rawDefault } from "../../scripts/kontext-budget-lib.mjs";
import { anhebungen, diffBasisModus } from "../support/baseline-zaehlung";
import { basisTexte } from "../support/git-batch";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const LIB = "scripts/kontext-budget-lib.mjs";
const DEFAULT_SCHLUESSEL = "AGENTEN_SKILL_DEFAULT_BUDGET";

type Werte = Record<string, number>;

const zahl = (s: string): number => Number(s.replace(/_/g, ""));

/** Pur: die Budget-Werte aus dem Quelltext der Lib: je Datei von `AGENTEN_SKILL_BUDGETS` ihr Budget, dazu `AGENTEN_SKILL_DEFAULT_BUDGET`; fehlt ein Block, bleibt er leer (`{}` ohne beide). */
function budgetWerte(quelltext: string): Werte {
  const out: Werte = {};
  const liste = /export const AGENTEN_SKILL_BUDGETS = \[([\s\S]*?)\n\];/.exec(quelltext);
  for (const m of (liste?.[1] ?? "").matchAll(/\{ file: "([^"]+)", budget: ([\d_]+) \}/g)) out[m[1]] = zahl(m[2]);
  const standard = /export const AGENTEN_SKILL_DEFAULT_BUDGET = ([\d_]+);/.exec(quelltext);
  if (standard) out[DEFAULT_SCHLUESSEL] = zahl(standard[1]);
  return out;
}

/** Pur: der erlaubte Höchstwert je Schlüssel des Ist-Stands: der Basiswert, für einen Schlüssel ohne Basiswert der Ist-Wert selbst. */
function erlaubteBudgets(ist: Werte, basis: Werte): Werte {
  return Object.fromEntries(Object.entries(ist).map(([k, v]) => [k, k in basis ? basis[k] : v]));
}

/** Pur: Meldungen für Budgets, die über dem Wert der Basis liegen. */
function budgetAnhebungen(ist: Werte, basis: Werte): string[] {
  return anhebungen({ budgets: ist }, { budgets: erlaubteBudgets(ist, basis) });
}

describe("Budget-Ratchet", () => {
  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;

  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("kein Budget der Lib wurde gegenüber der Diff-Basis angehoben", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (FACTORY_DIFF_BASE/origin/main fehlt)");
    const alt = basisTexte((args, input) => execFileSync("git", args, { cwd: WURZEL, input, maxBuffer: 64 * 1024 * 1024 }), basis, [LIB]).get(LIB) ?? "";
    const ist = budgetWerte(readFileSync(WURZEL + LIB, "utf8"));
    assert.ok(Object.keys(ist).length > 1, "der Ist-Stand der Lib liefert Budgets (der Parser passt zum Format)");
    assert.deepEqual(budgetAnhebungen(ist, budgetWerte(alt)), []);
  });

  describe("Mechanik", () => {
    test("budgetWerte liest die Lib wie der Import (Formatdrift der Lib wird hier rot)", () => {
      const erwartet: Werte = { [DEFAULT_SCHLUESSEL]: rawDefault as number };
      for (const b of rawBudgets as { file: string; budget: number }[]) erwartet[b.file] = b.budget;
      assert.deepEqual(budgetWerte(readFileSync(WURZEL + LIB, "utf8")), erwartet);
    });

    test("budgetWerte: Unterstriche in Zahlen, mehrere Einträge, fehlender Block ergibt {}", () => {
      const text = 'export const AGENTEN_SKILL_BUDGETS = [\n  { file: "a.md", budget: 1_500 },\n  { file: "b/c.md", budget: 20 },\n];\nexport const AGENTEN_SKILL_DEFAULT_BUDGET = 45_500;\n';
      assert.deepEqual(budgetWerte(text), { "a.md": 1500, "b/c.md": 20, [DEFAULT_SCHLUESSEL]: 45_500 });
      assert.deepEqual(budgetWerte("export const ANDERES = 1;"), {});
      assert.deepEqual(budgetWerte(""), {});
    });

    test("Anheben wird gemeldet; Senken, Gleichstand, neue und entfallene Schlüssel nicht", () => {
      const basisWerte = { "a.md": 100, "b.md": 100, "c.md": 100, "alt.md": 100 };
      assert.deepEqual(budgetAnhebungen({ "a.md": 101 }, basisWerte).length, 1);
      assert.match(budgetAnhebungen({ "a.md": 101 }, basisWerte)[0], /a\.md.*101.*100/);
      assert.deepEqual(budgetAnhebungen({ "a.md": 100, "b.md": 99 }, basisWerte), []);
      assert.deepEqual(budgetAnhebungen({ "neu.md": 5000 }, basisWerte), [], "ein neuer Eintrag ist keine Anhebung von 0");
      assert.deepEqual(budgetAnhebungen({ "a.md": 100 }, { "a.md": 100, "alt.md": 1 }), [], "ein entfallener Schlüssel bleibt unbeachtet");
      assert.equal(budgetAnhebungen({ [DEFAULT_SCHLUESSEL]: 46_000 }, { [DEFAULT_SCHLUESSEL]: 45_500 }).length, 1, "auch der Default zählt");
    });

    test("ein Basis-Text ohne Block (die Lib kannte die Budgets noch nicht) erlaubt jeden Ist-Wert", () => {
      assert.deepEqual(budgetAnhebungen({ "a.md": 9999, [DEFAULT_SCHLUESSEL]: 45_500 }, budgetWerte("export const X = 1;")), []);
    });
  });
});
