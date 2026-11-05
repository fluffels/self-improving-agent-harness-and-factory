/* Kern-Block-Budget (factory#188 Vor-Tag-Probe, Sammelticket factory#208 L19): der Kern-Block von AGENTS.md (zwischen den Besitz-Markern `kern`)
 * wächst nur bewusst. Das Budget ist ein Ratchet auf den Ist-Wert und gilt nur in der Fabrik (ohne Sync-Stand); im Bezieher entscheidet dessen Gesamtbudget. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { KERN_BLOCK_BUDGET as rawBudget, kernBlockBefund as rawBefund, kernBlockZeichen as rawZeichen } from "../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { kernBlockPruefung as rawPruefung } from "../scripts/check-context-size.mjs";

const KERN_BLOCK_BUDGET = rawBudget as number;
const kernBlockZeichen = rawZeichen as (text: string) => number | null;
const kernBlockBefund = rawBefund as (a: { text: string; fabrik: boolean; budget?: number }) => string | null;
const kernBlockPruefung = rawPruefung as (wurzel: string) => string | null;

const START = "<!-- factory-besitz:start kern -->";
const ENDE = "<!-- factory-besitz:ende kern -->";
const mitKern = (inhalt: string): string => `# Kopf\n${START}\n${inhalt}\n${ENDE}\nProjekt`;

describe("Kern-Block-Budget", () => {
  const temp = (fn: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "kernbudget-"));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const datei = (dir: string, rel: string, inhalt: string): void => {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), inhalt);
  };

  test("zählt nur den Block zwischen den Markern, CRLF wie LF", () => {
    const lf = mitKern("abc");
    assert.equal(kernBlockZeichen(lf), `${START}\nabc\n`.length);
    assert.equal(kernBlockZeichen(lf.replace(/\n/g, "\r\n")), kernBlockZeichen(lf));
  });

  test("fehlender oder verdrehter Marker: null (fail-closed in der Prüfung)", () => {
    assert.equal(kernBlockZeichen("# ohne Marker"), null);
    assert.equal(kernBlockZeichen(`${ENDE}\nx\n${START}`), null);
    assert.match(String(kernBlockBefund({ text: "# ohne Marker", fabrik: true })), /Marker/);
  });

  test("Grenze exakt: Budget == Zeichen grün, eins weniger rot; Befund nennt Zahlen", () => {
    const text = mitKern("x".repeat(50));
    const n = kernBlockZeichen(text) as number;
    assert.equal(kernBlockBefund({ text, fabrik: true, budget: n }), null);
    assert.match(String(kernBlockBefund({ text, fabrik: true, budget: n - 1 })), new RegExp(`${n}.*${n - 1}`));
  });

  test("außerhalb der Fabrik wird übersprungen, auch bei fehlenden Markern", () => {
    assert.equal(kernBlockBefund({ text: mitKern("x".repeat(500)), fabrik: false, budget: 1 }), null);
    assert.equal(kernBlockBefund({ text: "# ohne Marker", fabrik: false }), null);
  });

  test("Prüfung: Fabrik = Besitz-Manifest da und kein Sync-Stand; Bezieher und ein Projekt ohne Manifest werden übersprungen", () => {
    temp((dir) => {
      datei(dir, "AGENTS.md", mitKern("x".repeat(KERN_BLOCK_BUDGET)));
      assert.equal(kernBlockPruefung(dir), null, "ohne Manifest keine Fabrik (Projekt vor dem ersten Sync)");
      datei(dir, ".factory/besitz.json", "{}");
      assert.match(String(kernBlockPruefung(dir)), /Kern-Block/);
      datei(dir, ".factory/sync-stand.json", JSON.stringify({ version: 2 }));
      assert.equal(kernBlockPruefung(dir), null, "mit Sync-Stand ist es ein Bezieher");
    });
  });

  test("Prüfung ohne AGENTS.md in der Fabrik: Befund (fehlende Marker, fail-closed)", () => {
    temp((dir) => {
      datei(dir, ".factory/besitz.json", "{}");
      assert.match(String(kernBlockPruefung(dir)), /Marker/);
    });
  });

  test("der echte Kern-Block liegt im Budget und das Budget ist ein Ratchet auf den Ist-Wert (Abstand < 100 Zeichen)", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "AGENTS.md"), "utf8");
    const n = kernBlockZeichen(text) as number;
    assert.ok(n <= KERN_BLOCK_BUDGET, `Kern-Block ${n} > Budget ${KERN_BLOCK_BUDGET}`);
    assert.ok(KERN_BLOCK_BUDGET - n < 100, `Budget ${KERN_BLOCK_BUDGET} liegt weit über dem Ist ${n}: nachziehen (Ratchet)`);
  });
});
