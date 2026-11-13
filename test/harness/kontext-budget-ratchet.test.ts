/* Budget-Ratchet-Wächter (factory#307, erweitert in factory#237): ein Zeichen-Budget darf gegenüber der Diff-Basis (Merge-Base) nur mit Beleg steigen; es gibt genau EINE Ratchet-Mechanik für alle Budgets.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft: `AGENTEN_SKILL_BUDGETS` (je Datei), `AGENTEN_SKILL_DEFAULT_BUDGET`, `CONTEXT_BUDGETS` (Schlüssel `CONTEXT_BUDGETS:<datei>`), `KERN_BLOCK_BUDGET`, `PROJEKT_BLOCK_RAUM` (alle aus `scripts/kontext-budget-lib.mjs`) und `MODULE_AGENTS_BUDGET` (aus `scripts/check-context-size.mjs`).
 * `budgetWerte` leitet die Werte aus dem QUELLTEXT ab (auch aus dem der Basis, ohne ihn zu importieren); ein Test hält den Parser gleich dem Import (Formatdrift wird rot, nicht still leer). Pflicht-Literale: eine Skalar-Konstante, die als Ausdruck statt als Zahl-Literal
 * geschrieben ist, bleibt dem Parser unsichtbar und macht den Test rot (sonst ließe sich ein Budget am Ratchet vorbeirechnen). Ein Schlüssel, den die Basis nicht kennt (neue Datei, neue Konstante), gilt mit seinem Ist-Wert (`erlaubteBudgets`): ein neuer Eintrag ist keine Anhebung von 0.
 * Ohne Diff-Basis lokal entfällt der Test, in der CI ist das rot (fail-closed, `diffBasisModus`).
 *
 * Regel: Anheben eines Budgets ist rot, es sei denn ein Commit der Diff-Strecke trägt eine Zeile `<Präfix>Budget-Beleg: <https-Link zur Messung> <Begründung>` (Schlüssel `budgetBeleg` aus `commitZeilen`); eine gültige Zeile gibt alle Anhebungen der Strecke frei.
 * Senken ist frei, mit einer Ausnahme: `PROJEKT_BLOCK_RAUM` darf nicht sinken (das bricht den Kontext-Vertrag der Bezieher), außer mit Beleg UND nicht leerer `<Präfix>Bezieher-Migration:`-Zeile; Steigen ist frei. Ein git-Fehler beim Lesen der Commits gilt als „kein Beleg“ (fail-closed).
 * Kein Werkzeug hebt ein Budget an: ein Scan über `scripts/**`, `.github/workflows/*.yml` und `.claude/hooks/**` verlangt, dass der Beleg-Schlüssel nur in `scripts/slice-override.mjs` steht und keine Schreib-Funktion die Lib oder `check-context-size` anfasst.
 * Grenze: der Scan kennt eine geschlossene Muster-Liste; indirekte Pfade (zusammengesetzte Dateinamen, Shell-Umleitung) erkennt er nicht, ihre Wirkung fängt der Ratchet gegen die Basis ab. Wer ein Budget anhebt UND die Datei um den Betrag wachsen lässt, ist ohne Beleg rot.
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
import { AGENTEN_SKILL_BUDGETS as rawBudgets, AGENTEN_SKILL_DEFAULT_BUDGET as rawDefault, CONTEXT_BUDGETS as rawContext, KERN_BLOCK_BUDGET as rawKern, PROJEKT_BLOCK_RAUM as rawRaum } from "../../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { MODULE_AGENTS_BUDGET as rawModul } from "../../scripts/check-context-size.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { ladeCommitZeilen as rawLadeZeilen } from "../../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { zeilenRe as rawZeilenRe } from "../../scripts/nachweis-lib.mjs";
import { diffBasisModus } from "../support/baseline-zaehlung";
import { basisTexte } from "../support/git-batch";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const LIB = "scripts/kontext-budget-lib.mjs";
const CHECK = "scripts/check-context-size.mjs";
const SLICE = "scripts/slice-override.mjs";
const DEFAULT_SCHLUESSEL = "AGENTEN_SKILL_DEFAULT_BUDGET";
const RAUM = "PROJEKT_BLOCK_RAUM";
/** Skalar-Konstanten: müssen als Zahl-Literal im Quelltext stehen (Pflicht-Literale). */
const SKALARE = [DEFAULT_SCHLUESSEL, "KERN_BLOCK_BUDGET", RAUM, "MODULE_AGENTS_BUDGET"];
const zeilenRe = rawZeilenRe as (key: string) => RegExp;
const ladeZeilen = rawLadeZeilen as () => { budgetBeleg: string; bezieherMigration: string };

type Werte = Record<string, number>;

const zahl = (s: string): number => Number(s.replace(/_/g, ""));

/** Pur: `{ file, budget }`-Einträge der Liste `name` im Quelltext, Schlüssel = `prefix` + Datei. */
function listenWerte(quelltext: string, name: string, prefix: string): Werte {
  const out: Werte = {};
  const liste = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\n\\];`).exec(quelltext);
  for (const m of (liste?.[1] ?? "").matchAll(/\{ file: "([^"]+)", budget: ([\d_]+) \}/g)) out[prefix + m[1]] = zahl(m[2]);
  return out;
}

/** Pur: die Budget-Werte aus Quelltext (Lib, optional `check-context-size` angehängt): Listen je Datei, dazu die Skalare; was fehlt oder kein Zahl-Literal ist, fehlt im Ergebnis (`{}` ohne alles). */
function budgetWerte(quelltext: string): Werte {
  const out: Werte = { ...listenWerte(quelltext, "AGENTEN_SKILL_BUDGETS", ""), ...listenWerte(quelltext, "CONTEXT_BUDGETS", "CONTEXT_BUDGETS:") };
  for (const name of SKALARE) {
    const m = new RegExp(`export const ${name} = ([\\d_]+);`).exec(quelltext);
    if (m) out[name] = zahl(m[1]);
  }
  return out;
}

/** Pur: die Skalar-Konstanten, die der Parser nicht als Literal fand (Ausdruck, umbenannt, entfernt). */
function fehlendeSkalare(werte: Werte): string[] {
  return SKALARE.filter((k) => !(k in werte));
}

/** Pur: Beleg-Zeilen des Schlüssels in einem Text (Commit-Messages): gültig ist nur `<https-Link> <Begründung>`; `ungueltig` nennt die übrigen Treffer (Hinweis für den Autor). */
function belegZeilen(text: string, key: string): { gueltig: string[]; ungueltig: string[] } {
  const gueltig: string[] = [];
  const ungueltig: string[] = [];
  for (const m of text.replace(/\r/g, "").matchAll(zeilenRe(key))) (/^https:\/\/\S+\s+\S/.test(m[2].trim()) ? gueltig : ungueltig).push(m[2].trim());
  return { gueltig, ungueltig };
}

/** Pur: Verstöße gegen die Budget-Regeln: Anhebung ohne gültigen Beleg; Senken des Projekt-Raums ohne Beleg und ohne Bezieher-Migration. */
function budgetVerstoesse(ist: Werte, basis: Werte, frei: { beleg: boolean; migration: boolean }): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(ist)) {
    if (!(k in basis)) continue;
    if (k === RAUM) {
      if (v < basis[k] && !(frei.beleg && frei.migration)) out.push(`${k} ${v} unter dem Wert an der Diff-Basis (${basis[k]}): Senken bricht den Kontext-Vertrag der Bezieher, braucht Budget-Beleg UND Bezieher-Migration`);
    } else if (v > basis[k] && !frei.beleg) out.push(`${k} ${v} über dem Wert an der Diff-Basis (${basis[k]}): Anheben braucht eine Commit-Zeile Budget-Beleg: <https-Link zur Messung> <Begründung>`);
  }
  return out;
}

/** Pur: die Verstöße gegen die Regel „kein Werkzeug hebt ein Budget an“ über `dateien` (Pfad → Text): der Beleg-Schlüssel nur im Slice-Override-Modul, keine Schreib-Funktion auf Lib oder Gate-Skript. */
function werkzeugVerstoesse(dateien: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [pfad, text] of dateien) {
    if (pfad !== SLICE && /budgetBeleg|Budget-Beleg/.test(text)) out.push(`${pfad}: nennt den Beleg-Schlüssel (nur ${SLICE} darf ihn kennen)`);
    if (/(writeFileSync|appendFileSync|writeFile|copyFileSync|renameSync)\([^\n]*(kontext-budget-lib|check-context-size)/.test(text)) out.push(`${pfad}: schreibt in die Budget-Datei (kein Werkzeug hebt ein Budget an)`);
  }
  return out;
}

const UMFANG = /^(scripts\/.*\.(mjs|cjs)|\.github\/workflows\/[^/]+\.yml|\.claude\/hooks\/.*)$/;

describe("Budget-Ratchet", () => {
  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;
  const quellen = (lies: (pfad: string) => string): string => `${lies(LIB)}\n${lies(CHECK)}`;
  const istWerte = (): Werte => budgetWerte(quellen((p) => readFileSync(WURZEL + p, "utf8")));

  /** Beleg und Migration der Diff-Strecke aus den Commit-Messages; ein git-Fehler heißt „kein Beleg“ (fail-closed). */
  function freigaben(runner: (args: string[]) => string): { beleg: boolean; migration: boolean; ungueltig: string[] } {
    let nachrichten: string;
    try {
      nachrichten = runner(["log", "--reverse", "--format=%B", `${basis}..HEAD`]);
    } catch {
      return { beleg: false, migration: false, ungueltig: [] };
    }
    const zeilen = ladeZeilen();
    const beleg = belegZeilen(nachrichten, zeilen.budgetBeleg);
    const migration = [...nachrichten.replace(/\r/g, "").matchAll(zeilenRe(zeilen.bezieherMigration))].some((m) => m[2].trim() !== "");
    return { beleg: beleg.gueltig.length > 0, migration, ungueltig: beleg.ungueltig };
  }

  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("kein Budget wurde gegenüber der Diff-Basis ohne Beleg angehoben (der Projekt-Raum auch nicht ohne Beleg und Bezieher-Migration gesenkt)", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (FACTORY_DIFF_BASE/origin/main fehlt)");
    const alt = basisTexte((args, input) => execFileSync("git", args, { cwd: WURZEL, input, maxBuffer: 64 * 1024 * 1024 }), basis, [LIB, CHECK]);
    const ist = istWerte();
    assert.ok(Object.keys(ist).length > 1, "der Ist-Stand liefert Budgets (der Parser passt zum Format)");
    const frei = freigaben(git);
    const verstoesse = budgetVerstoesse(ist, budgetWerte(quellen((p) => alt.get(p) ?? "")), frei);
    const hinweis = frei.ungueltig.length > 0 ? `\nUngültige Beleg-Zeilen (erwartet: <https-Link> <Begründung>): ${frei.ungueltig.join(" | ")}` : "";
    assert.deepEqual(verstoesse, [], `Budget-Verstöße${hinweis}`);
  });

  test("Pflicht-Literale: jede Skalar-Konstante steht als Zahl-Literal im Quelltext (ein Ausdruck würde den Ratchet umgehen)", () => {
    assert.deepEqual(fehlendeSkalare(istWerte()), []);
  });

  test("kein Werkzeug hebt ein Budget an: der Beleg-Schlüssel steht nur im Slice-Override-Modul, keine Schreib-Funktion zielt auf die Budget-Dateien", () => {
    const dateien = new Map<string, string>();
    for (const pfad of git(["ls-files", "-co", "--exclude-standard", "--", "scripts", ".github/workflows", ".claude/hooks"]).split("\n")) {
      if (UMFANG.test(pfad)) dateien.set(pfad, readFileSync(WURZEL + pfad, "utf8"));
    }
    assert.ok(dateien.has(SLICE) && dateien.size > 50, "der Scan sieht die Skripte");
    assert.deepEqual(werkzeugVerstoesse(dateien), []);
  });

  describe("Mechanik", () => {
    test("budgetWerte liest Lib und Gate-Skript wie der Import (Formatdrift wird hier rot)", () => {
      const erwartet: Werte = { [DEFAULT_SCHLUESSEL]: rawDefault as number, KERN_BLOCK_BUDGET: rawKern as number, [RAUM]: rawRaum as number, MODULE_AGENTS_BUDGET: rawModul as number };
      for (const b of rawBudgets as { file: string; budget: number }[]) erwartet[b.file] = b.budget;
      for (const b of rawContext as { file: string; budget: number }[]) erwartet["CONTEXT_BUDGETS:" + b.file] = b.budget;
      assert.deepEqual(istWerte(), erwartet);
    });

    test("budgetWerte: Unterstriche in Zahlen, mehrere Einträge, Kontext-Budgets, Skalare; fehlender Block ergibt {}", () => {
      const text = 'export const AGENTEN_SKILL_BUDGETS = [\n  { file: "a.md", budget: 1_500 },\n  { file: "b/c.md", budget: 20 },\n];\nexport const AGENTEN_SKILL_DEFAULT_BUDGET = 45_500;\nexport const CONTEXT_BUDGETS = [\n  { file: "AGENTS.md", budget: 28_000 },\n];\nexport const KERN_BLOCK_BUDGET = 15_200; // x\nexport const MODULE_AGENTS_BUDGET = 12_000;\n';
      assert.deepEqual(budgetWerte(text), { "a.md": 1500, "b/c.md": 20, [DEFAULT_SCHLUESSEL]: 45_500, "CONTEXT_BUDGETS:AGENTS.md": 28_000, KERN_BLOCK_BUDGET: 15_200, MODULE_AGENTS_BUDGET: 12_000 });
      assert.deepEqual(budgetWerte("export const ANDERES = 1;"), {});
      assert.deepEqual(budgetWerte(""), {});
    });

    test("Pflicht-Literale: ein Ausdruck statt Zahl wird als fehlend gemeldet (AK4: der Raum lässt sich nicht ableiten)", () => {
      assert.deepEqual(fehlendeSkalare(budgetWerte("export const PROJEKT_BLOCK_RAUM = 28_000 - KERN_BLOCK_BUDGET;")).includes(RAUM), true);
      assert.deepEqual(fehlendeSkalare({ [DEFAULT_SCHLUESSEL]: 1, KERN_BLOCK_BUDGET: 1, [RAUM]: 1, MODULE_AGENTS_BUDGET: 1 }), []);
    });

    const keinBeleg = { beleg: false, migration: false };
    test("Anheben ohne Beleg wird gemeldet; Senken, Gleichstand, neue und entfallene Schlüssel nicht", () => {
      const basisWerte = { "a.md": 100, "b.md": 100, "c.md": 100, "alt.md": 100 };
      assert.deepEqual(budgetVerstoesse({ "a.md": 101 }, basisWerte, keinBeleg).length, 1);
      assert.match(budgetVerstoesse({ "a.md": 101 }, basisWerte, keinBeleg)[0], /a\.md.*101.*100/);
      assert.deepEqual(budgetVerstoesse({ "a.md": 100, "b.md": 99 }, basisWerte, keinBeleg), []);
      assert.deepEqual(budgetVerstoesse({ "neu.md": 5000 }, basisWerte, keinBeleg), [], "ein neuer Eintrag ist keine Anhebung von 0");
      assert.deepEqual(budgetVerstoesse({ "a.md": 100 }, { "a.md": 100, "alt.md": 1 }, keinBeleg), [], "ein entfallener Schlüssel bleibt unbeachtet");
      assert.equal(budgetVerstoesse({ [DEFAULT_SCHLUESSEL]: 46_000 }, { [DEFAULT_SCHLUESSEL]: 45_500 }, keinBeleg).length, 1, "auch der Default zählt");
      assert.equal(budgetVerstoesse({ MODULE_AGENTS_BUDGET: 12_001 }, { MODULE_AGENTS_BUDGET: 12_000 }, keinBeleg).length, 1, "auch das Modul-Budget zählt");
      assert.equal(budgetVerstoesse({ "CONTEXT_BUDGETS:AGENTS.md": 28_001 }, { "CONTEXT_BUDGETS:AGENTS.md": 28_000 }, keinBeleg).length, 1, "auch das Gesamtbudget zählt");
    });

    test("ein gültiger Beleg gibt die Anhebung frei", () => {
      assert.deepEqual(budgetVerstoesse({ "a.md": 101, KERN_BLOCK_BUDGET: 15_201 }, { "a.md": 100, KERN_BLOCK_BUDGET: 15_200 }, { beleg: true, migration: false }), []);
    });

    test("Projekt-Raum: Steigen frei, Senken nur mit Beleg UND Bezieher-Migration; Anheben von Kern und Senken des Raums melden zwei Verstöße", () => {
      const basisWerte = { [RAUM]: 12_800, KERN_BLOCK_BUDGET: 15_200 };
      assert.deepEqual(budgetVerstoesse({ [RAUM]: 12_801, KERN_BLOCK_BUDGET: 15_200 }, basisWerte, keinBeleg), []);
      assert.deepEqual(budgetVerstoesse({ [RAUM]: 12_800, KERN_BLOCK_BUDGET: 15_200 }, basisWerte, keinBeleg), [], "Gleichstand ist kein Senken");
      assert.equal(budgetVerstoesse({ [RAUM]: 12_799, KERN_BLOCK_BUDGET: 15_200 }, basisWerte, keinBeleg).length, 1);
      assert.equal(budgetVerstoesse({ [RAUM]: 12_799, KERN_BLOCK_BUDGET: 15_200 }, basisWerte, { beleg: true, migration: false }).length, 1, "Beleg allein genügt für den Raum nicht");
      assert.equal(budgetVerstoesse({ [RAUM]: 12_799, KERN_BLOCK_BUDGET: 15_200 }, basisWerte, { beleg: false, migration: true }).length, 1, "Migration allein genügt nicht");
      assert.deepEqual(budgetVerstoesse({ [RAUM]: 12_799, KERN_BLOCK_BUDGET: 15_200 }, basisWerte, { beleg: true, migration: true }), []);
      const zwei = budgetVerstoesse({ [RAUM]: 12_799, KERN_BLOCK_BUDGET: 15_201 }, basisWerte, keinBeleg);
      assert.equal(zwei.length, 2);
      assert.ok(zwei.some((m) => m.startsWith(RAUM)) && zwei.some((m) => m.startsWith("KERN_BLOCK_BUDGET")));
    });

    test("ein Basis-Text ohne Block (die Quelle kannte die Budgets noch nicht) erlaubt jeden Ist-Wert", () => {
      assert.deepEqual(budgetVerstoesse({ "a.md": 9999, [DEFAULT_SCHLUESSEL]: 45_500 }, budgetWerte("export const X = 1;"), keinBeleg), []);
    });

    test("belegZeilen: Link plus Begründung gültig (auch mit Squash-Präfix); ohne Link, nur Link, eingerückt, falscher Schlüssel ungültig bzw. unsichtbar", () => {
      const k = "SIH-Budget-Beleg";
      const text = [
        `${k}: https://example.org/messung Kern wächst wegen X`,
        `* ${k}: https://example.org/m2 Grund`,
        `${k}: nur eine Begründung`,
        `${k}: https://example.org/nur-link`,
        `  ${k}: https://example.org/m3 eingerückt`,
        `${k}:`,
        `SIH-Budget-Belege: https://example.org/m4 Grund`,
      ].join("\n");
      const r = belegZeilen(text, k);
      assert.deepEqual(r.gueltig, ["https://example.org/messung Kern wächst wegen X", "https://example.org/m2 Grund"]);
      assert.deepEqual(r.ungueltig, ["nur eine Begründung", "https://example.org/nur-link", ""]);
      const streng = belegZeilen(["SIH-Budget-Beleg: http://example.org/m Grund", "SIH-Budget-Beleg: siehe https://example.org/m Grund", "SIH-Budget-Beleg: https:// Grund"].join("\n"), k);
      assert.deepEqual(streng.gueltig, [], "nur https, der Link steht vorn und hat einen Host");
      assert.equal(streng.ungueltig.length, 3);
      assert.deepEqual(belegZeilen("Text ohne Zeile", k), { gueltig: [], ungueltig: [] });
    });

    test("freigaben: Beleg und Migration aus den Commit-Messages; git-Fehler und leere Strecke heißen kein Beleg (fail-closed)", () => {
      const z = ladeZeilen();
      const mit = (nachricht: string) => freigaben(() => nachricht);
      assert.deepEqual(mit(`Titel\n\n${z.budgetBeleg}: https://example.org/m Grund\n${z.bezieherMigration}: Raum sinkt`), { beleg: true, migration: true, ungueltig: [] });
      assert.equal(mit(`${z.budgetBeleg}: https://example.org/m Grund`).migration, false);
      assert.equal(mit(`${z.bezieherMigration}:   `).migration, false, "leere Migrationszeile zählt nicht");
      assert.equal(mit(`${z.budgetBeleg}: nur Text`).beleg, false);
      assert.deepEqual(mit(`${z.budgetBeleg}: nur Text`).ungueltig, ["nur Text"]);
      assert.deepEqual(freigaben(() => { throw new Error("git kaputt"); }), { beleg: false, migration: false, ungueltig: [] });
      assert.equal(mit("").beleg, false);
    });

    test("Werkzeug-Scan: der Beleg-Schlüssel außerhalb des Slice-Override-Moduls und eine Schreib-Funktion auf die Budget-Dateien werden gemeldet, sonst nichts", () => {
      assert.deepEqual(werkzeugVerstoesse(new Map([[SLICE, "budgetBeleg: x"], ["scripts/a.mjs", "const x = 1;"]])), []);
      assert.equal(werkzeugVerstoesse(new Map([["scripts/a.mjs", "z.budgetBeleg"]])).length, 1);
      assert.equal(werkzeugVerstoesse(new Map([[".github/workflows/x.yml", "run: echo Budget-Beleg"]])).length, 1);
      assert.equal(werkzeugVerstoesse(new Map([["scripts/a.mjs", 'writeFileSync("scripts/kontext-budget-lib.mjs", t)']])).length, 1);
      assert.equal(werkzeugVerstoesse(new Map([["scripts/a.mjs", 'renameSync(tmp, join(r, "check-context-size.mjs"))']])).length, 1);
      for (const fn of ["appendFileSync", "writeFile", "copyFileSync"]) assert.equal(werkzeugVerstoesse(new Map([["scripts/a.mjs", `${fn}("scripts/kontext-budget-lib.mjs", t)`]])).length, 1, fn);
      assert.deepEqual(werkzeugVerstoesse(new Map([["scripts/a.mjs", 'readFileSync("scripts/kontext-budget-lib.mjs")']])), [], "Lesen ist erlaubt");
    });

    test("Umfang des Scans: Skripte, Workflows und Hooks, nichts darüber hinaus", () => {
      for (const p of ["scripts/a.mjs", "scripts/x/b.cjs", ".github/workflows/ci.yml", ".claude/hooks/h.sh"]) assert.ok(UMFANG.test(p), p);
      for (const p of ["test/a.test.ts", "scripts/a.json", "docs/x.md", ".github/workflows/sub/ci.yml", "scripts/a.mjs.bak", "test/scripts/a.mjs", "x.github/workflows/ci.yml"]) assert.ok(!UMFANG.test(p), p);
    });
  });
});
