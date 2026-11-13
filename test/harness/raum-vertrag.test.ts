/* Raum-Vertrag-Wächter (factory#237, ADR 0035 Variante A): AGENTS.md hat ein Gesamtbudget; der Kern-Block (Besitz-Marker `kern`) darf höchstens `KERN_BLOCK_BUDGET` Zeichen belegen und lässt jedem Bezieher
 * genau `PROJEKT_BLOCK_RAUM` für Projekt-Block und Projektwerte: `KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM` ist lückenlos das Gesamtbudget. Wächst der Kern über seine Grenze, wird dieser Test rot, `check:contextsize` rot
 * (beides im Pflicht-Check `build-test`) und der Probe-Erstbezug rot (Pflicht-Check `Probe-Erstbezug`); `tag-takt` sperrt den Tag, solange die CI rot ist (`ciCheckliste`).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Grenze: gerechnet wird mit dem Kern der Fabrik; im Bezieher trägt der Kern zusätzlich die Projektwert-Tabelle (wenige Dutzend Zeichen mehr). Ein Raum, der nur durch ein Absenken von `PROJEKT_BLOCK_RAUM` passt, bricht den
 * Vertrag und ist im Budget-Ratchet (`kontext-budget-ratchet.test.ts`) ohne Beleg und Bezieher-Migration rot.
 * Verfall: Prüftermin laut `.github/wiedervorlagen.json` (Eintrag `regeln-verfall-2027-03`, ADR 0027). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { CONTEXT_BUDGETS, KERN_BLOCK_BUDGET as rawBudget, PROJEKT_BLOCK_RAUM as rawRaum, kernBlockBefund as rawBefund, kernBlockZeichen as rawZeichen, kernRaumBefund as rawRaumBefund } from "../../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { markerEnde, markerStart } from "../../scripts/besitz-lib.mjs";

const KERN_BLOCK_BUDGET = rawBudget as number;
const PROJEKT_BLOCK_RAUM = rawRaum as number;
const kernRaumBefund = rawRaumBefund as (a: { kern: number; raum: number; gesamt: number }) => string | null;
const kernBlockZeichen = rawZeichen as (text: string, marker: { start: string; ende: string }) => number | null;
const kernBlockBefund = rawBefund as (a: { text: string; fabrik: boolean; budget?: number; marker: { start: string; ende: string } }) => string | null;
const MARKER = { start: markerStart("kern") as string, ende: markerEnde("kern") as string };
const GESAMT = (CONTEXT_BUDGETS as { file: string; budget: number }[]).find((b) => b.file === "AGENTS.md")?.budget as number;
const AGENTS = readFileSync(join(import.meta.dirname, "..", "..", "AGENTS.md"), "utf8");

/** Pur: AGENTS.md-Text, dessen Kern-Block um `extra` Zeichen größer ist (Füllzeichen vor dem Ende-Marker). */
const kernUm = (text: string, extra: number): string => text.replace(MARKER.ende, `${"x".repeat(extra)}${MARKER.ende}`);

describe("Raum-Vertrag (AGENTS.md)", () => {
  test("Kern-Budget plus Projekt-Raum ist lückenlos das Gesamtbudget (Probe-Erstbezug belegt sonst die Grenze nicht)", () => {
    assert.ok(GESAMT > 0, "AGENTS.md hat ein Budget in CONTEXT_BUDGETS");
    assert.equal(KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM, GESAMT);
    assert.equal(kernRaumBefund({ kern: KERN_BLOCK_BUDGET, raum: PROJEKT_BLOCK_RAUM, gesamt: GESAMT }), null);
  });

  test("der echte Kern-Block der Fabrik liegt im Budget, Kern plus voller Raum passt ins Gesamtbudget", () => {
    const n = kernBlockZeichen(AGENTS, MARKER) as number;
    assert.ok(n <= KERN_BLOCK_BUDGET, `Kern-Block ${n} > Budget ${KERN_BLOCK_BUDGET}`);
    assert.ok(n + PROJEKT_BLOCK_RAUM <= GESAMT, `Kern ${n} + Raum ${PROJEKT_BLOCK_RAUM} > Gesamtbudget ${GESAMT}`);
  });

  test("Red-Green: wächst der echte Kern-Block um ein Zeichen über sein Budget, wird der Vertrag verletzt (Befund, Kern plus Raum über dem Gesamtbudget)", () => {
    const n = kernBlockZeichen(AGENTS, MARKER) as number;
    const knapp = kernUm(AGENTS, KERN_BLOCK_BUDGET - n);
    assert.equal(kernBlockZeichen(knapp, MARKER), KERN_BLOCK_BUDGET);
    assert.equal(kernBlockBefund({ text: knapp, fabrik: true, marker: MARKER }), null, "genau am Budget: grün");
    const eins = kernUm(AGENTS, KERN_BLOCK_BUDGET - n + 1);
    const chars = kernBlockZeichen(eins, MARKER) as number;
    assert.equal(chars, KERN_BLOCK_BUDGET + 1);
    assert.match(String(kernBlockBefund({ text: eins, fabrik: true, marker: MARKER })), /Kern-Block-Budget/);
    assert.match(String(kernRaumBefund({ kern: chars, raum: PROJEKT_BLOCK_RAUM, gesamt: GESAMT })), new RegExp(`${GESAMT + 1}.*${GESAMT}`));
  });

  test("Raum-Gleichung, Grenzfälle exakt: Summe gleich Gesamtbudget grün, ein Zeichen mehr oder weniger rot (Überschreitung und Lücke); der Befund nennt die Zahlen", () => {
    assert.equal(kernRaumBefund({ kern: 15_000, raum: 13_000, gesamt: 28_000 }), null);
    assert.match(String(kernRaumBefund({ kern: 15_000, raum: 13_001, gesamt: 28_000 })), /28001.*28000/);
    assert.match(String(kernRaumBefund({ kern: 15_001, raum: 13_000, gesamt: 28_000 })), /28001.*28000/);
    assert.match(String(kernRaumBefund({ kern: 15_000, raum: 12_999, gesamt: 28_000 })), /Lücke von 1 Zeichen.*27999.*28000|27999.*28000.*Lücke von 1 Zeichen/);
    assert.match(String(kernRaumBefund({ kern: 14_999, raum: 13_000, gesamt: 28_000 })), /Lücke/);
  });
});
