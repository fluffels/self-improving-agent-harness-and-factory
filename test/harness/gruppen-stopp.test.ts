import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Wächter für die Gruppen-Stopp-Marke (factory#283 L4): Ein Umsetzer kann seinen laufenden Gruppen-Agenten nicht per
 * TaskStop stoppen (nur der Besitzer darf), also stoppt eine Marke im Git-Verzeichnis des Worktrees die Gruppe
 * kooperativ. Geprüft wird nur das Vorkommen des Regeltexts in den Anweisungen (Gruppen-Agent, Umsetzer, Hauptchat-Ablauf,
 * Glossar), nicht, dass ein laufender Agent die Marke tatsächlich befolgt.
 */
const lies = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const MARKE = "gruppe-stopp";
const PFAD_OPTION = "--git-path";

describe("Gruppen-Stopp-Marke (factory#283 L4)", () => {
  test.each([".claude/agents/factory-gruppe.md", ".claude/agents/factory-umsetzer.md", ".agents/skills/factory/ablauf.md"])(
    "%s nennt Marke und Pfad-Auflösung",
    (rel) => {
      const text = lies(rel);
      expect(text).toContain(MARKE);
      expect(text).toContain(PFAD_OPTION);
    },
  );
  test("der Gruppen-Agent koppelt den Commit an die Marke und meldet den Abbruch", () => {
    const text = lies(".claude/agents/factory-gruppe.md");
    expect(text).toContain(`test ! -e "$(git -C <worktree> rev-parse --path-format=absolute --git-path ${MARKE})" && git -C <worktree> commit`);
    expect(text).toContain("GRUPPE: abgebrochen");
    expect(text).toContain("Planwechsel (Stopp-Marke)");
  });
  test("der Umsetzer setzt, wartet, sichert, nimmt zurück und räumt die Marke", () => {
    const text = lies(".claude/agents/factory-umsetzer.md");
    for (const teil of ["touch", "stash push -u", "git revert --no-edit", "rm -f", "kein `TaskStop`"]) expect(text).toContain(teil);
  });
  test("der Hauptchat-Ablauf nennt seine Rolle beim Planwechsel und nach einem eigenen TaskStop", () => {
    const text = lies(".agents/skills/factory/ablauf.md");
    expect(text).toContain("SendMessage");
    expect(text).toContain("setzt er danach selbst die Marke");
  });
  test("das Glossar erklärt die Gruppen-Stopp-Marke", () => {
    expect(lies("docs/harness-glossar.md")).toContain("Gruppen-Stopp-Marke");
  });
});
