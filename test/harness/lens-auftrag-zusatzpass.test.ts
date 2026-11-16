/* Lens-Auftrag-Guard R6 (factory#534)
 *
 * @harness-waechter – einziger Durchsetzer der Spawn-Sperre über dem Cap.
 *
 * Ein Lens-Auftrag mit Worktree `-lens-r<k>-` und k über MAX_REVIEW_PAESSE braucht das Kopf-Feld
 * `Zusatzpass: <Brille>:<Prüfpunkt> · Entscheidung: <X>, weil <Y>`. Grenze: nur der Review-Worktree `r`, nicht `m/a/c`. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Hook-Skript.
import * as hookRaw from "../../scripts/pretooluse-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../../scripts/nachweis-lib.mjs";

const hook = hookRaw as unknown as { dispatch: (t: string, w: string, a?: unknown, b?: unknown, d?: unknown) => { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } | null };
const { zusatzpassKopfAus, MAX_REVIEW_PAESSE } = libRaw as unknown as { zusatzpassKopfAus: (p: string) => { brille: string; pruefpunkt: string; entscheidung: string; weil: string } | null; MAX_REVIEW_PAESSE: number };
const WT = FREMD.praefixe.worktree;
const agent = (prompt: string) => JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", cwd: "/w", tool_input: { subagent_type: FREMD.agenten.lens, description: "Lens", prompt } });
const deny = (prompt: string) => hook.dispatch(agent(prompt), "/w", undefined, undefined, { config: FREMD });
const kopf = (ende: string, zusatz = "") =>
  `Brille: architektur${zusatz} · Arbeitsverzeichnis: /w/.claude/worktrees/${WT}7 · Patch: /tmp/x/${WT}7-r1.patch · erwarteter HEAD: abc1234def · Sabotage-Worktree: /w/.claude/worktrees/${WT}7-lens-${ende}`;
const FELD = " · Zusatzpass: architektur:Blocker B1 offen · Entscheidung: Pass nötig, weil Vorpass-Blocker blieb";

describe("R6: Zusatzpass-Feld ab Pass über dem Cap (K1, K5)", () => {
  test("K5: `-lens-r4-` ohne Kopf-Feld wird abgewiesen, die Meldung nennt Format und Abhilfe; `-lens-r3-` ohne Feld nicht", () => {
    const r = deny(kopf("r4-architektur"));
    assert.equal(r?.hookSpecificOutput.permissionDecision, "deny");
    assert.match(r?.hookSpecificOutput.permissionDecisionReason ?? "", /Zusatzpass: <Brille>:<Prüfpunkt> · Entscheidung: <X>, weil <Y>.*ablauf-zusatzpass\.md/);
    assert.equal(deny(kopf("r3-architektur")), null);
    assert.equal(deny(kopf(`r${MAX_REVIEW_PAESSE}-architektur`)), null);
  });
  test("ein vollständiges Feld lässt den Auftrag durch", () => {
    assert.equal(deny(kopf("r4-architektur", FELD)), null);
    assert.equal(deny(kopf("r5-doku", FELD)), null);
  });
  test("unvollständige Felder werden abgewiesen (leer, Platzhalter, unbekannte Brille, ohne Prüfpunkt, ohne Entscheidung, ohne weil)", () => {
    for (const w of ["", "<Brille>:<Prüfpunkt> · Entscheidung: <X>, weil <Y>", "unbekannt:P1 · Entscheidung: X, weil Y", "architektur: · Entscheidung: X, weil Y", "architektur:P1", "architektur:P1 · Entscheidung: X", "architektur:P1 · Entscheidung: , weil Y"]) {
      assert.equal(deny(kopf("r4-architektur", ` · Zusatzpass: ${w}`))?.hookSpecificOutput.permissionDecision, "deny", w);
    }
  });
  test("das höchste k zählt, ein Platzhalter `r<runde>` und die Delta-Endungen m/a/c bleiben offen (bewusste Grenze)", () => {
    assert.equal(deny(kopf("r2-architektur") + ` · Zweiter: /w/.claude/worktrees/${WT}7-lens-r5-doku`)?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(deny(kopf("r<runde>-<brille>")), null);
    assert.equal(deny(kopf("r12-architektur"))?.hookSpecificOutput.permissionDecision, "deny"); // mehrstellige Runde
    for (const e of ["m4-architektur", "a1-architektur", "c2-architektur", "m9-doku"]) assert.equal(deny(kopf(e)), null, e);
  });
  test("ein Nicht-Lens-Spawn bleibt unberührt, ein kaputtes Payload fail-open", () => {
    const fremd = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Agent", cwd: "/w", tool_input: { subagent_type: "Explore", prompt: kopf("r4-x") } });
    assert.equal(hook.dispatch(fremd, "/w", undefined, undefined, { config: FREMD }), null);
    assert.equal(hook.dispatch("{kaputt", "/w", undefined, undefined, { config: FREMD }), null);
  });
});

describe("zusatzpassKopfAus", () => {
  test("lange Leerzeichen-Läufe laufen linear (kein ReDoS)", () => {
    const start = Date.now();
    assert.equal(zusatzpassKopfAus(`Zusatzpass: doku:${" ".repeat(3000)}`), null);
    assert.equal(zusatzpassKopfAus(`Zusatzpass: doku:P · Entscheidung: A, weil ${" ".repeat(3000)}`), null); // 3000 statt 50000: ein Rückfall auf kubische Laufzeit wird rot statt zu hängen
    assert.ok(Date.now() - start < 1000);
  });
  test("Brille als Schlüssel oder Anzeigename (Groß-/Kleinschreibung, Umlaut-Umschrift tolerant)", () => {
    for (const b of ["test-adaequanz", "Test-Adäquanz", "TEST-ADAEQUANZ", "Architektur", "Requirement-Treue", "Doku"]) {
      assert.ok(zusatzpassKopfAus(`Zusatzpass: ${b}:P1 · Entscheidung: A, weil B`), b);
      assert.equal(deny(kopf("r4-architektur", ` · Zusatzpass: ${b}:P1 · Entscheidung: A, weil B`)), null, b);
    }
    assert.equal(zusatzpassKopfAus("Zusatzpass: Test-Adäquanz:P1 · Entscheidung: A, weil B")?.brille, "test-adaequanz");
    assert.equal(zusatzpassKopfAus("Zusatzpass: Unbekannt:P1 · Entscheidung: A, weil B"), null);
  });
  test("Trenner: `·` ohne Leerzeichen gilt, „weil“ ohne Leerzeichen dahinter nicht", () => {
    assert.equal(zusatzpassKopfAus("Zusatzpass: doku:P·Entscheidung: A, weil B")?.weil, "B");
    assert.equal(zusatzpassKopfAus("Zusatzpass: doku:P · Entscheidung: A, weilB"), null);
  });
  test("liest die vier Teile, der letzte Treffer zählt, Teile mit Platzhalter ergeben null", () => {
    assert.deepEqual(zusatzpassKopfAus("Zusatzpass: doku:P2 · Entscheidung: A, B, weil C"), { brille: "doku", pruefpunkt: "P2", entscheidung: "A, B", weil: "C" });
    assert.equal(zusatzpassKopfAus("Zusatzpass: doku:P · Entscheidung: A, weil B\nZusatzpass: doku:P · Entscheidung: A, weil <Y>"), null); // gültig, dann ungültig: der letzte zählt
    assert.equal(zusatzpassKopfAus("Zusatzpass: doku:P · Entscheidung: A, weil <Y>\nZusatzpass: doku:P · Entscheidung: A, weil B")?.weil, "B");
    assert.equal(zusatzpassKopfAus("Zusatzpass: doku:P · Entscheidung: A, weil B\r\n · Plan: x")?.weil, "B"); // CRLF
    assert.equal(zusatzpassKopfAus("Zusatzpass: Vorspann doku:P · Entscheidung: A, weil B"), null);
    assert.equal(zusatzpassKopfAus("Zusatzpass: doku:a·b · Entscheidung: A, weil B"), null);
    assert.equal(zusatzpassKopfAus("Delta-Zusatzpass: doku:P · Entscheidung: A, weil B"), null);
    assert.equal(zusatzpassKopfAus(undefined as unknown as string), null);
  });
});
