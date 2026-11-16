/* Lens-Auftrag-Guard R6 (factory#534)
 *
 * @harness-waechter – einziger Durchsetzer der Spawn-Sperre über dem Cap.
 *
 * Ein Lens-Auftrag mit Worktree `-lens-r<k>-` und k über MAX_REVIEW_PAESSE braucht das Kopf-Feld
 * `Zusatzpass: <Brille>:<Prüfpunkt> · Entscheidung: <X>, weil <Y>`. Grenze: nur der Review-Worktree `r`, nicht `m/a/c`. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

describe("R6 stufenabhängig: bei Risikostufe 1 sperrt schon `-lens-r3-` (factory#583)", () => {
  const ARBEIT = `/w/.claude/worktrees/${WT}7`;
  const mit = (stufe: number | "wirft", aufrufe: string[] = []) => (prompt: string) =>
    hook.dispatch(agent(prompt), "/w", undefined, undefined, {
      config: FREMD,
      risikostufeFuer: (pfad: string) => {
        aufrufe.push(pfad);
        if (stufe === "wirft") throw new Error("Stufe nicht bestimmbar");
        return stufe;
      },
    });
  test("Stufe 1: `-lens-r3-` ohne Feld wird abgewiesen, die Meldung nennt das tatsächliche Cap; r2 nicht", () => {
    const aufrufe: string[] = [];
    const r = mit(1, aufrufe)(kopf("r3-architektur"));
    assert.equal(r?.hookSpecificOutput.permissionDecision, "deny");
    assert.match(r?.hookSpecificOutput.permissionDecisionReason ?? "", /Runde 3, das Cap liegt bei 2 Pässen/);
    assert.deepEqual(aufrufe, [ARBEIT], "die Stufe kommt aus dem Arbeitsverzeichnis (der Lens-Worktree existiert beim Spawn noch nicht)");
    assert.equal(mit(1)(kopf("r2-architektur")), null);
  });
  test("Stufe 1: ein vollständiges Feld lässt `-lens-r3-` durch, ohne Stufenbestimmung", () => {
    const aufrufe: string[] = [];
    assert.equal(mit(1, aufrufe)(kopf("r3-architektur", FELD)), null);
    assert.deepEqual(aufrufe, []);
  });
  test("Stufe 2: `-lens-r3-` ohne Feld geht durch, `-lens-r4-` bleibt gesperrt und fragt die Stufe nicht", () => {
    assert.equal(mit(2)(kopf("r3-architektur")), null);
    const aufrufe: string[] = [];
    assert.match(mit(1, aufrufe)(kopf("r4-architektur"))?.hookSpecificOutput.permissionDecisionReason ?? "", /Cap liegt bei 3 Pässen/);
    assert.deepEqual(aufrufe, [], "über MAX_REVIEW_PAESSE startet kein Prozess");
  });
  test("Stufe nicht bestimmbar: bisheriges Verhalten (Cap MAX_REVIEW_PAESSE)", () => {
    assert.equal(mit("wirft")(kopf("r3-architektur")), null);
    assert.equal(mit("wirft")(kopf("r4-architektur"))?.hookSpecificOutput.permissionDecision, "deny");
    assert.equal(deny(kopf("r3-architektur")), null, "Standard-Kindprozess in einem fehlenden Arbeitsverzeichnis");
  });
  test("ein Arbeitsverzeichnis außerhalb von `.claude/worktrees/` oder mit `..` startet keinen Prozess; Laufwerk und Backslash gelten", () => {
    const mitArbeit = (arbeit: string) => `Brille: architektur · Arbeitsverzeichnis: ${arbeit} · Patch: /tmp/x/${WT}7-r1.patch · erwarteter HEAD: abc1234def · Sabotage-Worktree: /w/.claude/worktrees/${WT}7-lens-r3-architektur`;
    for (const arbeit of ["/tmp/fremd/" + WT + "7", "/w/../.claude/worktrees/" + WT + "7", "/w/.claude/worktrees/../x/" + WT + "7", WT + "7", "/w/.claude/worktrees/a/b", ""]) {
      const aufrufe: string[] = [];
      assert.equal(mit(1, aufrufe)(mitArbeit(arbeit)), null, arbeit);
      assert.deepEqual(aufrufe, [], arbeit);
    }
    for (const arbeit of ["C:\\w\\.claude\\worktrees\\" + WT + "7", "`/w/.claude/worktrees/" + WT + "7`"]) {
      const aufrufe: string[] = [];
      assert.equal(mit(1, aufrufe)(mitArbeit(arbeit))?.hookSpecificOutput.permissionDecision, "deny", arbeit);
      assert.equal(aufrufe.length, 1, arbeit);
    }
  });
  test("echter Kindprozess: ein Git-Worktree mit Codeänderung ergibt Stufe 1 und sperrt `-lens-r3-`, ein Feld lässt ihn durch", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "zusatzpass-"));
    const arbeit = join(wurzel, ".claude", "worktrees", `${WT}7`);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: arbeit, stdio: "ignore" });
    const alt = process.env.FACTORY_DIFF_BASE;
    delete process.env.FACTORY_DIFF_BASE;
    try {
      mkdirSync(join(arbeit, "scripts"), { recursive: true });
      git("init", "-q", "-b", "main");
      git("config", "user.email", "t@example.invalid");
      git("config", "user.name", "t");
      writeFileSync(join(arbeit, "scripts", "a.mjs"), "a\n");
      git("add", "-A");
      git("commit", "-qm", "basis");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("checkout", "-q", "-b", "f");
      writeFileSync(join(arbeit, "scripts", "a.mjs"), "a\nb\n");
      git("commit", "-qam", "aenderung");
      const prompt = `Brille: architektur · Arbeitsverzeichnis: ${arbeit} · Patch: /tmp/x/${WT}7-r1.patch · erwarteter HEAD: abc1234def · Sabotage-Worktree: ${arbeit}-lens-r3-architektur`;
      const r = deny(prompt);
      assert.equal(r?.hookSpecificOutput.permissionDecision, "deny");
      assert.match(r?.hookSpecificOutput.permissionDecisionReason ?? "", /Runde 3, das Cap liegt bei 2 Pässen/);
      assert.equal(deny(prompt.replace("Brille: architektur", `Brille: architektur${FELD}`)), null);
    } finally {
      if (alt !== undefined) process.env.FACTORY_DIFF_BASE = alt;
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
});
