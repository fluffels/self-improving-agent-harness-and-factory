/* Worktree-Setup-Wächter (#1119) – ein frischer Worktree wird mit `npm ci` bestückt,
 * nicht mit `npm install`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Hintergrund: `npm install` darf `package-lock.json` neu schreiben. In jedem Ticket-Lauf
 * wurde der Lockfile im frischen Worktree dirty und musste von Hand zurückgesetzt werden
 * (#998, #1107: einmal versehentlich mitcommittet). `npm ci` installiert exakt nach
 * Lockfile und schreibt ihn nie – identisch zur CI. Seit factory#186 nennen die Kern-Texte statt `npm ci` den Läufer
 * `node scripts/gate-befehl.mjs install` (Standard des Befehls `install`: `npm ci`); beide Formen zählen als die Installation.
 *
 * Geprüft wird je Texteinheit (Absatz bzw. einzelner Listenpunkt – eine ganze Liste ist
 * KEINE Einheit, sonst schlügen fremde Punkte derselben Liste an): jede Einheit, die einen
 * Worktree erwähnt und eine npm-Installation nennt, muss `npm ci` nennen und darf
 * `npm install` nicht nennen. Einheiten ohne Worktree-Bezug bleiben frei – die Regel „nach
 * Hand-Änderung an `package.json` → `npm install` + Lockfile mitcommitten" (AGENTS.md) ist
 * gewollt. Codeblöcke zählen bewusst mit: ein Befehl im Codeblock ist eine Anweisung.
 *
 * Gescannt wird das ganze Markdown-Inventar (dieselbe Quelle wie check:docdrift) plus
 * etwaige Workflow-Skripte – so fällt auch eine NEUE Datei mit der alten Anweisung auf. Die
 * PFLICHT_QUELLEN sind nur der Leerlauf-Schutz: dort muss die Anweisung gefunden werden.
 *
 * Grenze (bewusst): kein Semantik-Prüfer, nur die abgelegte Formulierung neben einem
 * Worktree-Bezug, und nur innerhalb EINER Einheit: steht „Worktree" im Elternpunkt und
 * `npm install` in einem Unterpunkt oder Folgeabsatz, sieht er das nicht. Erklärende
 * Erwähnungen von `npm install` neben einem Worktree-Bezug meldet er mit – solche Sätze
 * ohne den Befehl formulieren. Fitness-Function der test-only-Familie (wie
 * `test/harness/agents-md-native.test.ts`), ohne eigenes `scripts/check-*.mjs` (gate-config-geschützt).
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { workflowDateien } from "./repo-texte";
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gateRaw from "../../scripts/gate-befehl-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";

// Begründete Ausnahme wie in test/harness/agents-md-native.test.ts: das .mjs hat kein
// Declaration-File, der Namespace ist für tsc „error typed".
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const collectMarkdown: (rootDir?: string) => string[] = checkBasis.collectMarkdown;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Die Texte, die heute die Worktree-Anlage beschreiben (Leerlauf-Schutz). */
const PFLICHT_QUELLEN = [
  "AGENTS.md",
  ".agents/skills/review-lenses/SKILL.md",
  "docs/agent-harness-faq.md",
];

/** Der Läufer des Gate-Befehls `install` (factory#186), die Form der Kern-Texte. */
const LAEUFER_INSTALL = /gate-befehl\.mjs install\b/;

/** Mindestzahl gefundener Worktree-Installations-Absätze (Leerlauf-Schutz). */
const MIN_TREFFER = PFLICHT_QUELLEN.length;

/** Alles, was gescannt wird: Markdown-Inventar und Workflow-Skripte. */
function alleQuellen(): string[] {
  return [...collectMarkdown(ROOT), ...workflowDateien()];
}

/** Zerlegt Text in Absätze und innerhalb davon in einzelne Listenpunkte bzw. Tabellenzeilen. */
function einheiten(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .flatMap((absatz) => absatz.split(/\n(?=\s*(?:(?:[-*]|\d+\.) |\|))/));
}

interface Treffer {
  datei: string;
  absatz: string;
}

/** Einheiten mit Worktree-Bezug UND npm-Installationsbefehl. */
function worktreeInstallAbsaetze(datei: string, text: string): Treffer[] {
  return einheiten(text)
    .filter((a) => /worktree/i.test(a) && (/\bnpm (ci|install)\b/.test(a) || LAEUFER_INSTALL.test(a)))
    .map((absatz) => ({ datei, absatz }));
}

/** Verstöße: Worktree-Absatz ohne `npm ci` bzw. den Läufer `install` oder mit `npm install`. */
function verstoesse(treffer: Treffer[]): Treffer[] {
  return treffer.filter((t) => !(/\bnpm ci\b/.test(t.absatz) || LAEUFER_INSTALL.test(t.absatz)) || /\bnpm install\b/.test(t.absatz));
}

/** Der Standard des Gate-Befehls `install` muss `npm ci` bleiben, ein Projekt-Befehl darf nicht `npm install` sein (pur, testbar). */
function installBefehlFehler(befehl: string): string | null {
  return /^npm ci\b/.test(befehl) || !/\bnpm install\b/.test(befehl) ? null : `Gate-Befehl install nutzt npm install: ${befehl}`;
}

function alleTreffer(): Treffer[] {
  return alleQuellen().flatMap((d) => worktreeInstallAbsaetze(d, readFileSync(ROOT + d, "utf8")));
}

describe("Worktree-Setup nutzt npm ci (#1119)", () => {
  test("jede Quelle beschreibt die Worktree-Installation (Leerlauf-Schutz)", () => {
    const treffer = alleTreffer();
    assert.ok(treffer.length >= MIN_TREFFER, `nur ${treffer.length} Treffer, erwartet ≥ ${MIN_TREFFER}`);
    for (const d of PFLICHT_QUELLEN) {
      assert.ok(
        treffer.some((t) => t.datei === d),
        `${d}: keine Worktree-Installationsanweisung gefunden – Formulierung geändert?`,
      );
    }
  });

  test("kein Worktree-Absatz schreibt npm install vor", () => {
    const fehler = verstoesse(alleTreffer());
    assert.deepEqual(
      fehler.map((f) => `${f.datei}: ${f.absatz.slice(0, 120)}`),
      [],
    );
  });

  test("Negativfall: npm install im Worktree-Absatz wird gemeldet", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im frischen Worktree einmal `npm install`.");
    assert.equal(verstoesse(t).length, 1);
  });

  test("Negativfall: npm install neben npm ci im Worktree-Absatz wird gemeldet", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im Worktree `npm ci`, sonst `npm install`.");
    assert.equal(verstoesse(t).length, 1);
  });

  test("Grenzfall: npm install ohne Worktree-Bezug bleibt erlaubt", () => {
    const text = "Nach Hand-Änderung an `package.json` `npm install` und den Lockfile mitcommitten.";
    assert.deepEqual(worktreeInstallAbsaetze("x.md", text), []);
  });

  test("Grenzfall: fremder Listenpunkt mit Worktree-Bezug steckt npm install nicht an", () => {
    const text = [
      "- Nach Hand-Änderung an `package.json` `npm install` und den Lockfile mitcommitten.",
      "- Im frischen Worktree einmal `npm ci`.",
    ].join("\n");
    const t = worktreeInstallAbsaetze("x.md", text);
    assert.equal(t.length, 1);
    assert.deepEqual(verstoesse(t), []);
  });

  test("Grenzfall: fremde Tabellenzeile mit Worktree-Bezug steckt npm install nicht an", () => {
    const text = ["| Erstinstallation | `npm install` |", "| Worktree anlegen | `npm ci` |"].join("\n");
    const t = worktreeInstallAbsaetze("x.md", text);
    assert.equal(t.length, 1);
    assert.deepEqual(verstoesse(t), []);
  });

  test("Happy Path: der Läufer install im Worktree-Absatz ist ok", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im frischen Worktree einmal `node scripts/gate-befehl.mjs install`.");
    assert.equal(t.length, 1);
    assert.deepEqual(verstoesse(t), []);
  });

  test("Negativfall: Läufer neben npm install im Worktree-Absatz wird gemeldet", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im Worktree `node scripts/gate-befehl.mjs install`, sonst `npm install`.");
    assert.equal(verstoesse(t).length, 1);
  });

  test("Grenzfall: Läufer mit anderem Namen ist keine Installation", () => {
    assert.deepEqual(worktreeInstallAbsaetze("x.md", "Im Worktree `node scripts/gate-befehl.mjs verify`."), []);
  });

  test("Standard-Befehl install ist npm ci, ein Projekt-Befehl mit npm install wird gemeldet", () => {
    const standard = (gateRaw as unknown as { STANDARD_BEFEHLE: Record<string, string> }).STANDARD_BEFEHLE;
    assert.equal(installBefehlFehler(standard.install), null);
    assert.ok(installBefehlFehler("npm install --no-save"));
    const projekt = JSON.parse(readFileSync(ROOT + ".factory/projekt.json", "utf8")) as { befehle?: { install?: string } };
    if (projekt.befehle?.install !== undefined) assert.equal(installBefehlFehler(projekt.befehle.install), null);
  });

  test("Happy Path: npm ci im Worktree-Absatz ist ok", () => {
    const t = worktreeInstallAbsaetze("x.md", "Im frischen Worktree einmal `npm ci`.");
    assert.equal(t.length, 1);
    assert.deepEqual(verstoesse(t), []);
  });
});
