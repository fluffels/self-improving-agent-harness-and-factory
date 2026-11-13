// Kein Shebang: dieses Skript wird ausschließlich über `node scripts/check-context-size.mjs`
// (npm run check:contextsize) gestartet UND von test/context-size.test.ts (im Factory-Repo) importiert. Ein
// `#!`-Token bricht sonst den Vitest/esbuild-Import (gleiche Falle wie bei check-size.mjs).
/**
 * Kontextdatei-Wächter (#719) – Frühwarnung, dass AGENTS.md zu groß wird.
 *
 * Seit #1088 zählt JEDE AGENTS.md im Repo, nicht nur die Wurzel: Claude Code (und andere
 * Tools) laden eine modul-lokale AGENTS.md automatisch, sobald dort eine Datei gelesen
 * wird. Ohne Messung wären sie eine neue, ungebremste On-Demand-Quelle – bei wachsendem Umfang
 * mit vielen Bereichen genau die Stelle, an die das Wurzel-Gate den Inhalt hindrängt.
 * Modul-lokale Dateien bekommen ohne eigenen Eintrag MODULE_AGENTS_BUDGET (Default statt
 * Pflicht-Registrierung: der Walk misst jede neue Datei ohnehin sofort, eine Registrierung
 * brächte nur einen Gate-Config-Diff pro Content-PR). Bewusst KEIN Summen-Gate: modul-lokale
 * Dateien laden nur bei Bedarf, ein Summen-Cap bestrafte genau das Auslagern, das das
 * Wurzel-Gate erzwingen soll – die Summe steht darum nur als INFO in der CLI.
 * Ladekette (factory#33): je Blatt-AGENTS.md gibt die CLI die Kette Wurzel + Vorfahren + Blatt mit
 * Zeichensumme aus, ebenfalls nur INFO. Entscheidung: kein Ketten-Budget als Gate, weil jedes Glied
 * schon ein Einzelbudget hat und ein Ketten-Cap entweder überflüssig ist (Wurzelbudget + Tiefe ×
 * MODULE_AGENTS_BUDGET) oder das Auslagern in tiefere Ebenen bestraft. Neu entscheiden, sobald eine Kette
 * Tiefe 2 erreicht oder ein Ablauf Codex in einem Unterordner startet (project_doc_max_bytes 32.768 Bytes).
 *
 * Hintergrund (#719): anders als src/-Module (check:size, #390) hatte die Wurzel-AGENTS.md,
 * die JEDE Agenten-Session vollständig lädt, kein eigenes Größen-Gate.
 * Jede neue Regel bekommt Begründung + Präzedenzfall-Verweis in AGENTS.md – einzeln
 * sinnvoll, akkumuliert aber unbegrenzt in einer Datei, die pro Session mitläuft (reiner
 * Token-Kostentreiber ohne Bremse). Der Auslagerungsmechanismus existiert schon
 * (modul-lokale AGENTS.md; on-demand-Tiefendocs unter struktur.moduldoku der Projekt-Config) – nur erzwang bisher nichts, ihn auch zu benutzen, BEVOR die
 * Wurzel wächst.
 *
 * Gemessen werden ZEICHEN, nicht Zeilen (#1064, vorher #977/#1061): in Markdown-Fließtext
 * ist eine „Zeile" ein Absatz – AGENTS.md stand bei 159/200 Zeilen schon bei 75k Zeichen,
 * das Zeilen-Gate war nie bindend, weil die Datei in die Breite wuchs. Zeichen sind der
 * beste Token-Proxy, der in die build-freie `verify`-Kette passt (echte Tokens bräuchten
 * Netz + API-Key bzw. einen Tokenizer als Dependency). Die Token-Zahl gibt die CLI nur als
 * grobe INFO aus (≈ Zeichen / CHARS_PER_TOKEN) – das Budget selbst bleibt in Zeichen.
 * CR (`\r`) zählt nicht mit: sonst misst ein Windows-Checkout (core.autocrlf) mehr als die CI.
 *
 * Bewusst ein reines Node-Skript (nur Builtins + der Walk aus check-basis.mjs), analog zu
 * check-size.mjs.
 * Die Mess-/Allowlist-Logik wird zusätzlich von test/context-size.test.ts (im Factory-Repo) importiert –
 * EINE Quelle der Wahrheit für Budget (hier) und Ausnahmen (`ausnahmen.kontext` der Projekt-Config).
 *
 * Agenten- und Skill-Dateien (factory#307): `.claude/agents/*.md` und `.agents/skills/<name>/**`.md haben je Datei ein Budget (`AGENTEN_SKILL_BUDGETS`, Default `AGENTEN_SKILL_DEFAULT_BUDGET`
 * für Dateien ohne Eintrag, auch projekt-eigene im Bezieher), gemessen ohne Projektwerte (Block und Werte der Frontmatter-Zeilen); `collectAgentSkillSizes`. Der Ratchet (ein Budget wächst nicht gegenüber der Merge-Base) steht
 * als Fabrik-Wächter in test/harness/kontext-budget-ratchet.test.ts. Bei einer Verletzung nennt `fixHinweis` für diese Dateien Kürzen bzw. Auslagern in eine bedingte Zusatzdatei (nicht „modul-lokale AGENTS.md“, die gilt nur für AGENTS.md).
 *
 * Ausführen mit:  npm run check:contextsize   (oder als Teil von: npm run verify)
 */

import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
// Derselbe Walk wie check:docdrift (#1091) – EINE Skip-Liste (node_modules, Builds,
// unversionierte .claude-Ordner inkl. .claude/worktrees). Änderungen dort wirken hier mit.
import { collectMarkdown } from "./check-basis.mjs";
import { collectMarkdown as collectMd } from "./docs-gen/markdown.mjs";
import { AGENTEN_SKILL_BUDGETS, AGENTEN_SKILL_DEFAULT_BUDGET, CONTEXT_BUDGETS, KERN_BLOCK_BUDGET, PROJEKT_BLOCK_RAUM, countChars, kernBlockBefund, kernRaumBefund } from "./kontext-budget-lib.mjs";
import { ohneProjektwerte } from "./projektwert-lib.mjs";
import { QUELL_VERZEICHNIS } from "./skill-pfade.mjs";
import { MANIFEST_PFAD, markerEnde, markerStart } from "./besitz-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { ausnahmenAus, ladeProjektConfig, PROJEKT_CONFIG } from "./projekt-config-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// CONTEXT_BUDGETS/countChars nicht weiterreichen: das Blatt gehört `kontext-budget-lib.mjs`, Abnehmer importieren dort (factory#114).

/** Default-Zeichen-Budget je modul-lokaler AGENTS.md ohne eigenen Eintrag in
 *  CONTEXT_BUDGETS (#1088). Kalibriert wie die Wurzel: größte modul-lokale AGENTS.md
 *  (~10.300 Zeichen) + ~15 % Kopffreiheit. Ratchet nur nach unten. */
export const MODULE_AGENTS_BUDGET = 12_000;

/** Grobe Umrechnung nur für die INFO-Ausgabe (deutscher Markdown-Text, ~4,2 Zeichen/Token).
 *  Modellabhängig und damit bewusst kein Budget-Maßstab. */
export const CHARS_PER_TOKEN = 4.2;

const istAgentsMd = (file) => file.split("/").pop() === "AGENTS.md";

/** Alle AGENTS.md im Repo (repo-relativer POSIX-Pfad, sortiert). */
export function collectAgentsFiles(rootDir = ROOT) {
  return collectMarkdown(rootDir).filter(istAgentsMd);
}

/** Zeichenzahl je Kontextdatei gegen ihr Budget: alle konfigurierten Dateien (auch
 *  fehlende, mit 0 Zeichen) plus jede gefundene AGENTS.md; ein expliziter Eintrag gewinnt
 *  über `moduleBudget`. `rootDir`/`budgets`/`moduleBudget` überschreibbar für Tests. */
export function collectContextSizes(rootDir = ROOT, budgets = CONTEXT_BUDGETS, moduleBudget = MODULE_AGENTS_BUDGET) {
  const budgetOf = new Map(budgets.map((b) => [b.file, b.budget]));
  const files = [...new Set([...budgets.map((b) => b.file), ...collectAgentsFiles(rootDir)])].sort();
  return files.map((file) => {
    const abs = join(rootDir, file);
    const chars = existsSync(abs) ? countChars(readFileSync(abs, "utf8")) : 0;
    return { file, chars, budget: budgetOf.get(file) ?? moduleBudget };
  });
}

// Ordner einer AGENTS.md; die Wurzel ("AGENTS.md" ist kürzer als der Schnitt) ergibt "".
const ordnerVon = (file) => file.slice(0, -"/AGENTS.md".length);
const istVorfahrOderSelbst = (a, b) => a === "" || b === a || b.startsWith(a + "/");

/** Ladekette je Blatt-AGENTS.md (factory#33): ein Blatt ist eine AGENTS.md, unter deren Ordner keine weitere liegt (ohne modul-lokale Datei die Wurzel); die Kette sind alle AGENTS.md, deren Ordner Vorfahr des Blatt-Ordners oder dieser selbst ist, von der Wurzel zum Blatt. Absteigend nach Summe, Gleichstand nach Blatt. Nur AGENTS.md-Einträge aus `sizes` zählen. */
export function ladeketten(sizes) {
  const agents = sizes.filter((s) => s.file === "AGENTS.md" || s.file.endsWith("/AGENTS.md")).map((s) => ({ ...s, ordner: ordnerVon(s.file) }));
  const blaetter = agents.filter((b) => !agents.some((o) => o.ordner !== b.ordner && istVorfahrOderSelbst(b.ordner, o.ordner)));
  return blaetter
    .map((b) => {
      const glieder = agents.filter((a) => istVorfahrOderSelbst(a.ordner, b.ordner)).sort((x, y) => (x.ordner < y.ordner ? -1 : 1));
      return { blatt: b.ordner, kette: glieder.map((g) => g.file), chars: glieder.reduce((sum, g) => sum + g.chars, 0) };
    })
    .sort((x, y) => y.chars - x.chars || (x.blatt < y.blatt ? -1 : 1));
}

const fmt = (n) => n.toLocaleString("de-DE");
const tokens = (n) => `≈ ${fmt(Math.round(n / CHARS_PER_TOKEN))} Tokens`;

/** INFO-Zeilen zur Ladekette (factory#33), je Blatt eine; jede Kette mit der Höchstsumme trägt den Suffix "längste Ladekette, kein Gate". */
export function ladekettenZeilen(ketten) {
  const hoechst = Math.max(0, ...ketten.map((k) => k.chars));
  return ketten.map(
    (k) => `• INFO Ladekette ${k.blatt || "AGENTS.md"}: ${fmt(k.chars)} Zeichen (${tokens(k.chars)}) = ${k.kette.join(" + ")}${k.chars === hoechst ? " ← längste Ladekette, kein Gate" : ""}`,
  );
}

/** Agenten- und Skill-Dateien (factory#307): `.claude/agents/*.md` (nur oberste Ebene) und `.agents/skills/<name>/**`.md rekursiv, ohne AGENTS.md (die misst `collectAgentsFiles`); repo-relativer POSIX-Pfad, sortiert. */
export function collectAgentSkillFiles(rootDir = ROOT) {
  const agenten = existsSync(join(rootDir, ".claude/agents"))
    ? readdirSync(join(rootDir, ".claude/agents"), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => `.claude/agents/${e.name}`)
    : [];
  return [...agenten, ...collectMd(rootDir, [QUELL_VERZEICHNIS])].filter((f) => !istAgentsMd(f)).sort();
}

/** Zeichenzahl je Agenten- und Skill-Datei gegen ihr Budget (Eintrag in `budgets`, sonst `defaultBudget`), gemessen OHNE Projektwerte (Block und Werte der Frontmatter-Zeilen); ein Eintrag ohne Datei wird übersprungen (nicht mit 0 gemeldet). */
export function collectAgentSkillSizes(rootDir = ROOT, budgets = AGENTEN_SKILL_BUDGETS, defaultBudget = AGENTEN_SKILL_DEFAULT_BUDGET) {
  const budgetOf = new Map(budgets.map((b) => [b.file, b.budget]));
  return collectAgentSkillFiles(rootDir).map((file) => ({
    file,
    chars: countChars(ohneProjektwerte(readFileSync(join(rootDir, file), "utf8"), file)),
    budget: budgetOf.get(file) ?? defaultBudget,
  }));
}

/** Agenten- oder Skill-Datei (nicht AGENTS.md): ihr Budget gehört dem Kern, die Fix-Zeile unterscheidet sich von der einer AGENTS.md. */
const istAgentSkill = (file) => !istAgentsMd(file) && (file.startsWith(".claude/agents/") || file.startsWith(QUELL_VERZEICHNIS + "/"));

/** Pur: Fix-Zeile zu den Budget-Verletzungen [{ file }] (leer ohne Verletzung): AGENTS.md → auslagern in modul-lokale AGENTS.md bzw. Tiefendoc; Agenten-/Skill-Datei → kürzen oder in eine bedingte Zusatzdatei bzw. Brain-Seite auslagern, das Budget nie anheben (Ratchet). */
export function fixHinweis(violations) {
  const teile = [];
  if (violations.some((v) => !istAgentSkill(v.file))) {
    teile.push(
      "Inhalt auslagern – bereichsspezifische Tiefe in eine modul-lokale AGENTS.md bzw. ein Modul-Tiefendoc (struktur.moduldoku der Projekt-Config) – oder, mit offenem Auslagerungs-Ticket (Harness: das Sammelticket), bewusst in " +
        "ausnahmen.kontext in " + PROJEKT_CONFIG + " aufnehmen (datei, grund mit #<nr>).",
    );
  }
  if (violations.some((v) => istAgentSkill(v.file))) {
    teile.push(
      `Agenten-/Skill-Datei: kürzen oder in eine bedingte Zusatzdatei unter ${QUELL_VERZEICHNIS}/<name>/ bzw. eine Brain-Seite auslagern; das Budget wächst nicht (Ratchet). ` +
        "Nur mit offenem Ticket ausnahmsweise unter ausnahmen.kontext in " + PROJEKT_CONFIG + " aufnehmen (datei, grund mit #<nr>).",
    );
  }
  return teile.join(" ");
}

/** Dateien strikt über ihrem eigenen Budget. */
export function findOversized(sizes) {
  return sizes.filter((s) => s.chars > s.budget);
}

/** Allowlist-Einträge, deren Datei nicht (mehr) über Budget liegt oder gar nicht gemessen
 *  wird – EINE Implementierung für CLI und Test. */
export function findStale(sizes, allowlist = ausnahmenAus(ladeProjektConfig()).kontext) {
  const oversized = new Set(findOversized(sizes).map((s) => s.file));
  return allowlist.filter((a) => !oversized.has(a.datei));
}

/** Gesamtbudget von AGENTS.md aus `CONTEXT_BUDGETS` (0, wenn der Eintrag fehlt: der Raum-Befund meldet dann die Lücke). */
const GESAMT_AGENTS = CONTEXT_BUDGETS.find((b) => b.file === "AGENTS.md")?.budget ?? 0;

/** Kern-Block-Budget und Raum-Vertrag der AGENTS.md in `rootDir`: Meldungen (mehrere mit Zeilenumbruch verbunden) oder `null`. Nur die Fabrik wird geprüft (Besitz-Manifest vorhanden, kein Sync-Stand); ein Bezieher oder ein Projekt ohne Manifest hat keinen Kern-Block zu hüten.
 *  Fehlt die Datei in der Fabrik, zählt das wie fehlende Marker (fail-closed). Der Raum-Vertrag (Kern-Budget plus Projekt-Raum ist genau das Gesamtbudget, factory#237) wird hier gegen die Konstanten geprüft, damit die Fabrik-CI vor einem Tag rot ist;
 *  `konstanten` ist eine Naht für Tests. */
export function kernBlockPruefung(rootDir = ROOT, konstanten = { kern: KERN_BLOCK_BUDGET, raum: PROJEKT_BLOCK_RAUM, gesamt: GESAMT_AGENTS }) {
  const abs = join(rootDir, "AGENTS.md");
  const text = existsSync(abs) ? readFileSync(abs, "utf8") : "";
  const fabrik = existsSync(join(rootDir, MANIFEST_PFAD)) && !istBezieher(rootDir);
  const befunde = [
    kernBlockBefund({ text, fabrik, budget: konstanten.kern, marker: { start: markerStart("kern"), ende: markerEnde("kern") } }),
    fabrik ? kernRaumBefund(konstanten) : null,
  ].filter((b) => b !== null);
  return befunde.length === 0 ? null : befunde.join("\n");
}

/** Alle Messwerte; ein kaputter Projektwert-Marker ergibt eine Gate-Meldung mit Ort und Fix statt eines Stacktraces: `melde(text)` beendet den Lauf (CLI: Exit 1, fail-closed). */
export function messeAlle(rootDir, melde) {
  const kontext = collectContextSizes(rootDir);
  try {
    return [...kontext, ...collectAgentSkillSizes(rootDir)];
  } catch (e) {
    return melde(`✖ ${e instanceof Error ? e.message : String(e)}\nFix: Projektwert-Marker in der genannten Zeile korrigieren, danach node scripts/projektwerte.mjs --write ausführen.`);
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main() {
  const tty = process.stdout.isTTY;
  const paint = (code, s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
  const red = (s) => paint("31", s);
  const green = (s) => paint("32", s);
  const dim = (s) => paint("2", s);

  let ALLOWLIST;
  try {
    ALLOWLIST = ausnahmenAus(ladeProjektConfig()).kontext;
  } catch (e) {
    console.error(red(`✖ ${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
  const sizes = messeAlle(ROOT, (text) => (console.error(red(text)), process.exit(1)));
  const allow = new Map(ALLOWLIST.map((a) => [a.datei, a.grund]));
  const oversized = findOversized(sizes);
  const oversizedFiles = new Set(oversized.map((s) => s.file));

  for (const s of sizes.filter((x) => !oversizedFiles.has(x.file)))
    console.log(dim(`• ${s.file}: ${fmt(s.chars)}/${fmt(s.budget)} Zeichen (${tokens(s.chars)})`));

  const violations = oversized.filter((s) => !allow.has(s.file));
  const allowed = oversized.filter((s) => allow.has(s.file));
  const stale = findStale(sizes, ALLOWLIST);

  for (const a of allowed)
    console.log(dim(`• geduldet: ${a.file} (${fmt(a.chars)} > ${fmt(a.budget)} Zeichen) – ${allow.get(a.file)}`));

  for (const v of violations) console.error(red(`✖ ${v.file}: ${fmt(v.chars)} Zeichen > Budget ${fmt(v.budget)} (${tokens(v.chars)})`));

  for (const s of stale)
    console.error(
      red(
        `✖ Ausnahme stale: ${s.datei} liegt nicht mehr über Budget – Eintrag unter ausnahmen.kontext in ${PROJEKT_CONFIG} entfernen.`,
      ),
    );

  const kernBefund = kernBlockPruefung();
  if (kernBefund) console.error(red(`✖ ${kernBefund}`));

  const zeilen = ladekettenZeilen(ladeketten(sizes));
  for (const z of zeilen) console.log(dim(z));

  const total = sizes.reduce((sum, s) => sum + s.chars, 0);
  console.log(dim(`• INFO: ${sizes.length} Kontextdatei(en), zusammen ${fmt(total)} Zeichen (${tokens(total)}), kein Gate.`));

  if (violations.length === 0 && stale.length === 0 && !kernBefund) {
    console.log(
      green(`✔ Kontextdateien im Budget (${sizes.length} geprüft, außer ${allowed.length} dokumentierte Ausnahme(n)).`),
    );
    return;
  }

  if (violations.length) console.error(`\n${violations.length} Kontextdatei(en) über dem Budget. ${fixHinweis(violations)}`);
  process.exit(1);
}

if (istDirektaufruf(import.meta.url)) main();
