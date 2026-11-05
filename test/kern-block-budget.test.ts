/* Kern-Block-Budget (factory#188 Vor-Tag-Probe, Sammelticket factory#208 L19): der Kern-Block von AGENTS.md (zwischen den Besitz-Markern `kern`)
 * wächst nur bewusst. Das Budget ist ein Ratchet auf den Ist-Wert und gilt nur in der Fabrik (ohne Sync-Stand); im Bezieher entscheidet dessen Gesamtbudget. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lib from "../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as check from "../scripts/check-context-size.mjs";

const KERN_BLOCK_BUDGET: number = lib.KERN_BLOCK_BUDGET;
const kernBlockZeichen: (text: string) => number | null = lib.kernBlockZeichen;
const kernBlockBefund: (a: { text: string; bezieher: boolean; budget?: number }) => string | null = lib.kernBlockBefund;
const kernBlockPruefung: (wurzel: string) => string | null = check.kernBlockPruefung;

const START = "<!-- factory-besitz:start kern -->";
const ENDE = "<!-- factory-besitz:ende kern -->";
const mitKern = (inhalt: string): string => `# Kopf\n${START}\n${inhalt}\n${ENDE}\nProjekt`;

describe("Kern-Block-Budget", () => {
  test("zählt nur den Block zwischen den Markern, CRLF wie LF", () => {
    const lf = mitKern("abc");
    assert.equal(kernBlockZeichen(lf), `${START}\nabc\n`.length);
    assert.equal(kernBlockZeichen(lf.replace(/\n/g, "\r\n")), kernBlockZeichen(lf));
  });

  test("fehlender oder verdrehter Marker: null (fail-closed in der Prüfung)", () => {
    assert.equal(kernBlockZeichen("# ohne Marker"), null);
    assert.equal(kernBlockZeichen(`${ENDE}\nx\n${START}`), null);
    assert.match(String(kernBlockBefund({ text: "# ohne Marker", bezieher: false })), /Marker/);
  });

  test("Grenze exakt: Budget == Zeichen grün, eins weniger rot; Befund nennt Zahlen", () => {
    const text = mitKern("x".repeat(50));
    const n = kernBlockZeichen(text) as number;
    assert.equal(kernBlockBefund({ text, bezieher: false, budget: n }), null);
    assert.match(String(kernBlockBefund({ text, bezieher: false, budget: n - 1 })), new RegExp(`${n}.*${n - 1}`));
  });

  test("Bezieher (Sync-Stand vorhanden) wird übersprungen, auch bei fehlenden Markern", () => {
    assert.equal(kernBlockBefund({ text: mitKern("x".repeat(500)), bezieher: true, budget: 1 }), null);
    assert.equal(kernBlockBefund({ text: "# ohne Marker", bezieher: true }), null);
  });

  test("Prüfung liest AGENTS.md und den Sync-Stand der Wurzel", () => {
    const dir = mkdtempSync(join(tmpdir(), "kernbudget-"));
    try {
      writeFileSync(join(dir, "AGENTS.md"), mitKern("x".repeat(KERN_BLOCK_BUDGET)));
      assert.match(String(kernBlockPruefung(dir)), /Kern-Block/);
      mkdirSync(join(dir, ".factory"));
      writeFileSync(join(dir, ".factory", "sync-stand.json"), JSON.stringify({ version: 2 }));
      assert.equal(kernBlockPruefung(dir), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("der echte Kern-Block liegt im Budget und das Budget ist ein Ratchet auf den Ist-Wert (Abstand < 100 Zeichen)", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "AGENTS.md"), "utf8");
    const n = kernBlockZeichen(text) as number;
    assert.ok(n <= KERN_BLOCK_BUDGET, `Kern-Block ${n} > Budget ${KERN_BLOCK_BUDGET}`);
    assert.ok(KERN_BLOCK_BUDGET - n < 100, `Budget ${KERN_BLOCK_BUDGET} liegt weit über dem Ist ${n}: nachziehen (Ratchet)`);
  });
});
