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
    expect(text).toContain("`GRUPPE: abgebrochen` mit `OFFEN: Planwechsel (Stopp-Marke)`");
    expect(text).toContain("Zu Beginn jeder Zeile und bei jedem Commit im selben Shell-Aufruf");
    expect(text).toContain("nichts mehr editieren und nicht committen");
    expect(text).toContain("stoppt dich bei einem Planwechsel eine Marke");
    expect(text).not.toContain("stoppt ihn bei einem Planwechsel");
  });
  test("der Umsetzer setzt, wartet, sichert, nimmt zurück und räumt die Marke", () => {
    const text = lies(".claude/agents/factory-umsetzer.md");
    for (const teil of ["Marke `touch \"$(git", "stash push -u -m", "git revert --no-edit", "entferne die Marke (`rm -f` auf denselben Pfad)", "kein `TaskStop` am Gruppen-Umsetzer"]) expect(text).toContain(teil);
    expect(text).toContain("warte auf den Bericht der Gruppe");
    expect(text).toContain("warte, bis der Worktree ruht: `git -C <worktree> status --porcelain` und `git -C <worktree> diff HEAD` sind bei zwei Messungen im Abstand von 5 Minuten gleich");
    expect(text).not.toContain("kein neuer Commit auf dem Branch");
    expect(text).toContain("liegt dort eine verwaiste Marke");
    expect(text).toContain("vor der ersten Gruppe mit `rm -f` auf denselben Pfad");
  });
  test("der Hauptchat-Ablauf nennt seine Rolle beim Planwechsel und nach einem eigenen TaskStop", () => {
    const text = lies(".agents/skills/factory/ablauf.md");
    expect(text).toContain("**Planwechsel bei laufender Gruppe:**");
    expect(text).toContain("schicke ihm den neuen Plan per `SendMessage`");
    expect(text).toContain("setzt du danach selbst die Marke");
    expect(text).not.toContain("setzt er danach selbst die Marke");
  });
  test("das Glossar erklärt die Gruppen-Stopp-Marke", () => {
    const text = lies("docs/harness-glossar.md");
    expect(text).toContain("Gruppen-Stopp-Marke");
    expect(text).toContain("prüft sie zu Beginn jeder Zeile und vor jedem Commit");
    expect(text).toContain("meldet bei gesetzter Marke `abgebrochen`");
    expect(text).toContain("sobald der Worktree ruht (`git status --porcelain` und `git diff HEAD` bei zwei Messungen im Abstand von 5 Minuten gleich)");
  });
});
