/* Kern-Block-Budget (factory#188 Vor-Tag-Probe, Sammelticket factory#208 L19): der Kern-Block von AGENTS.md (zwischen den Besitz-Markern `kern`)
 * wächst nur bewusst. Das Budget ist ein Ratchet auf den Ist-Wert und gilt nur in der Fabrik (ohne Sync-Stand); im Bezieher entscheidet dessen Gesamtbudget. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { kopiereScripts } from "./support/scripts-kopie";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { CONTEXT_BUDGETS, KERN_BLOCK_BUDGET as rawBudget, kernBlockBefund as rawBefund, kernBlockZeichen as rawZeichen } from "../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { kernBlockPruefung as rawPruefung } from "../scripts/check-context-size.mjs";

const KERN_BLOCK_BUDGET = rawBudget as number;
const kernBlockZeichen = rawZeichen as (text: string, marker: { start: string; ende: string }) => number | null;
const kernBlockBefund = rawBefund as (a: { text: string; fabrik: boolean; budget?: number; marker?: { start: string; ende: string } }) => string | null;
const kernBlockPruefung = rawPruefung as (wurzel: string, konstanten?: { kern: number; raum: number; gesamt: number }) => string | null;

const START = "<!-- factory-besitz:start kern -->";
const ENDE = "<!-- factory-besitz:ende kern -->";
const MARKER = { start: START, ende: ENDE };
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
    assert.equal(kernBlockZeichen(lf, MARKER), `${START}\nabc\n`.length);
    assert.equal(kernBlockZeichen(lf.replace(/\n/g, "\r\n"), MARKER), kernBlockZeichen(lf, MARKER));
  });

  test("fehlender oder verdrehter Marker: null (fail-closed in der Prüfung)", () => {
    assert.equal(kernBlockZeichen("# ohne Marker", MARKER), null);
    assert.equal(kernBlockZeichen(`${ENDE}\nx\n${START}`, MARKER), null);
    assert.match(String(kernBlockBefund({ text: "# ohne Marker", fabrik: true, marker: MARKER })), /Marker/);
  });

  test("Marker kommen vom Aufrufer: eigene Marker zählen, die Standard-Marker dann nicht (fail-closed, Befund nennt die übergebenen)", () => {
    const eigen = { start: "<<a>>", ende: "<<b>>" };
    assert.equal(kernBlockZeichen("<<a>>xy<<b>>", eigen), "<<a>>xy".length);
    assert.equal(kernBlockZeichen(mitKern("x"), eigen), null);
    assert.match(String(kernBlockBefund({ text: mitKern("x"), fabrik: true, marker: eigen })), /<<a>> und <<b>>/);
  });

  test("Grenze exakt: Budget == Zeichen grün, eins weniger rot; Befund nennt Zahlen", () => {
    const text = mitKern("x".repeat(50));
    const n = kernBlockZeichen(text, MARKER) as number;
    assert.equal(kernBlockBefund({ text, fabrik: true, budget: n, marker: MARKER }), null);
    assert.match(String(kernBlockBefund({ text, fabrik: true, budget: n - 1, marker: MARKER })), new RegExp(`${n}.*${n - 1}`));
  });

  test("außerhalb der Fabrik wird übersprungen, auch bei fehlenden Markern", () => {
    assert.equal(kernBlockBefund({ text: mitKern("x".repeat(500)), fabrik: false, budget: 1, marker: MARKER }), null);
    assert.equal(kernBlockBefund({ text: "# ohne Marker", fabrik: false, marker: MARKER }), null);
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

  test("factory#220 G6.4: Prüfung in der Fabrik mit echten Markern und Block im Budget ist grün (null); ein Zeichen über dem Budget rot", () => {
    temp((dir) => {
      datei(dir, ".factory/besitz.json", "{}");
      datei(dir, "AGENTS.md", mitKern("x".repeat(100)));
      assert.equal(kernBlockPruefung(dir), null);
      datei(dir, "AGENTS.md", mitKern("x".repeat(KERN_BLOCK_BUDGET)));
      assert.match(String(kernBlockPruefung(dir)), /Kern-Block/);
    });
  });

  test("Gate check:contextsize (CLI): Kern-Block über Budget in der Fabrik ist rot, im Bezieher grün (die Verdrahtung, nicht nur die pure Prüfung)", { timeout: 60_000 }, () => {
    temp((dir) => {
      const wurzel = join(import.meta.dirname, "..");
      kopiereScripts(dir);
      datei(dir, ".factory/projekt.json", readFileSync(join(wurzel, ".factory", "projekt.json"), "utf8"));
      datei(dir, ".factory/besitz.json", "{}");
      datei(dir, "AGENTS.md", mitKern("x".repeat(KERN_BLOCK_BUDGET)));
      const lauf = () => {
        const r = spawnSync(process.execPath, [join(dir, "scripts", "check-context-size.mjs")], { encoding: "utf8", cwd: dir, timeout: 30_000 });
        return { status: r.status, text: `${r.stderr}${r.stdout}` };
      };
      const fabrik = lauf();
      assert.equal(fabrik.status, 1, fabrik.text);
      assert.match(fabrik.text, /✖ [^\n]*Kern-Block/);
      datei(dir, ".factory/sync-stand.json", JSON.stringify({ version: 2 }));
      const bezieher = lauf();
      assert.equal(bezieher.status, 0, bezieher.text);
    });
  });

  test("Prüfung ohne AGENTS.md in der Fabrik: Befund (fehlende Marker, fail-closed)", () => {
    temp((dir) => {
      datei(dir, ".factory/besitz.json", "{}");
      assert.match(String(kernBlockPruefung(dir)), /Marker/);
    });
  });

  test("Raum-Vertrag im Gate: Konstanten mit Lücke oder Überschreitung sind in der Fabrik rot, im Bezieher nie (Wächter: test/harness/raum-vertrag.test.ts)", () => {
    temp((dir) => {
      datei(dir, ".factory/besitz.json", "{}");
      datei(dir, "AGENTS.md", mitKern("x".repeat(100)));
      const gesamt = (CONTEXT_BUDGETS as { file: string; budget: number }[])[0].budget;
      const mitKonstanten = (kern: number, raum: number) => kernBlockPruefung(dir, { kern, raum, gesamt });
      assert.equal(mitKonstanten(KERN_BLOCK_BUDGET, gesamt - KERN_BLOCK_BUDGET), null);
      assert.match(String(mitKonstanten(KERN_BLOCK_BUDGET, gesamt - KERN_BLOCK_BUDGET - 1)), /Lücke von 1 Zeichen/);
      assert.match(String(mitKonstanten(KERN_BLOCK_BUDGET, gesamt - KERN_BLOCK_BUDGET + 1)), /> Gesamtbudget/);
      datei(dir, ".factory/sync-stand.json", JSON.stringify({ version: 2 }));
      assert.equal(mitKonstanten(KERN_BLOCK_BUDGET, 1), null, "im Bezieher gilt sein Gesamtbudget");
    });
  });

  test("der echte Kern-Block liegt im Budget und das Budget ist ein Ratchet auf den Ist-Wert (Abstand < 100 Zeichen)", () => {
    const text = readFileSync(join(import.meta.dirname, "..", "AGENTS.md"), "utf8");
    const n = kernBlockZeichen(text, MARKER) as number;
    assert.ok(n <= KERN_BLOCK_BUDGET, `Kern-Block ${n} > Budget ${KERN_BLOCK_BUDGET}`);
    assert.ok(KERN_BLOCK_BUDGET - n < 100, `Budget ${KERN_BLOCK_BUDGET} liegt weit über dem Ist ${n}: nachziehen (Ratchet)`);
  });
});
