// Blatt-Modul (nur Node-Builtins) und Lib ohne Direktaufruf-Guard; `check-context-size.mjs` und `factory-sync.mjs` importieren sie (Konvention #1398: Einstiege importieren nicht voneinander).
/* Kontext-Budget (SSOT): Zeichen-Budget je Root-Kontextdatei und die Zählung. `check-context-size.mjs` misst damit das Repo, `factory-sync.mjs` warnt damit
 * im Trockenlauf und beim Sync, bevor der Sync-PR im Ziel rot wird. Grenze: es gilt das Budget des ausführenden Werkzeugs (Checklisten-Trockenlauf: das der Quelle;
 * eigenes Werkzeug des Beziehers: sein altes); ändert der neue Tag das Budget, stimmt der Hinweis dort erst nach dem Sync. Alles pur, nur Builtins. */

/** Zeichen-Budget je Root-Kontextdatei (repo-relativer Pfad, #1064). Kalibriert am Bestand
 *  bei der Umstellung von Zeilen auf Zeichen (AGENTS.md 73.612, CLAUDE.md 18.068 Zeichen) +
 *  kleine Kopffreiheit. Das ist KEIN Aufweichen: das alte Zeilen-Budget hat die Größe nie
 *  gemessen. Im zweiten #1064-Slice wurde AGENTS.md auf ~24k Zeichen gekürzt
 *  (Langbegründung nach Factory-Seite docs/agent-harness.md §3a) und das Budget auf 28.000 gezogen
 *  (Ist + ~15 %, wie beim ersten Kalibrieren; Ratchet nach unten). Mit #1078 (Slice A1) sind
 *  die Nachschlage-Tabellen der CLAUDE.md on-demand nach docs/referenz/ gezogen; seit #1087 ist
 *  CLAUDE.md gelöscht (AGENTS.md wird nativ geladen) und ihr Eintrag entfallen – dass sie nicht
 *  zurückkehrt, bewacht (im Factory-Repo) test/harness/agents-md-native.test.ts.
 *  Weitere immer geladene Dateien (z.B. README) können hier bei Bedarf ergänzt werden. */
export const CONTEXT_BUDGETS = [
  { file: "AGENTS.md", budget: 28_000 },
];

/** Zeichen eines Textes, zeilenenden-neutral (CRLF zählt wie LF). */
export function countChars(text) {
  return text.replace(/\r/g, "").length;
}

/**
 * Pur: die Kontextdateien aus `budgets`, die über ihrem Budget liegen, als `[{ file, chars, budget }]`. `lies(datei)` liefert den Text oder `null` (fehlt: zählt nicht);
 * `ausnahmen` = geduldete Dateien (`ausnahmen.kontext` der Projekt-Config, `[{ datei }]`), die nie gemeldet werden.
 */
export function ueberBudget({ lies, budgets = CONTEXT_BUDGETS, ausnahmen = [] }) {
  const geduldet = new Set(ausnahmen.map((a) => a.datei));
  const treffer = [];
  for (const { file, budget } of budgets) {
    if (geduldet.has(file)) continue;
    const text = lies(file);
    const chars = text === null ? 0 : countChars(text);
    if (chars > budget) treffer.push({ file, chars, budget });
  }
  return treffer;
}

/** Anteil des Budgets, unter dem der Rest als knapp gilt (factory#215 L12). */
export const KNAPP_ANTEIL = 0.05;

/**
 * Pur: die Kontextdateien, die noch im Budget liegen, deren Rest aber unter `anteil` des Budgets liegt, als `[{ file, chars, budget, rest }]`.
 * Über Budget zählt nicht (das meldet `ueberBudget`); `lies`/`ausnahmen` wie dort.
 */
export function knappeBudgets({ lies, budgets = CONTEXT_BUDGETS, ausnahmen = [], anteil = KNAPP_ANTEIL }) {
  const geduldet = new Set(ausnahmen.map((a) => a.datei));
  const treffer = [];
  for (const { file, budget } of budgets) {
    if (geduldet.has(file)) continue;
    const text = lies(file);
    if (text === null) continue;
    const chars = countChars(text);
    const rest = budget - chars;
    if (rest >= 0 && rest < budget * anteil) treffer.push({ file, chars, budget, rest });
  }
  return treffer;
}

/** Zeichen-Budget des Kern-Blocks von AGENTS.md (zwischen den Besitz-Markern `kern`, ohne den Projekt-Block): Ratchet auf den Ist-Wert, wächst nur bewusst per reviewtem Commit
 *  (factory#208 L19: der Kern wuchs zwischen zwei Tags um ~1,1k Zeichen und brachte einen Bezieher über sein Gesamtbudget). */
export const KERN_BLOCK_BUDGET = 15_437; // factory#269: +450 für den Eingangsfilter der Harness-Zeilen (Klasse, Beleg, Verfall); Raum sinkt gleich

/** Raum, den der Kern jedem Bezieher außerhalb des Kern-Blocks in AGENTS.md lässt (Projekt-Block samt Projektwerten): `KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM` ist genau das Gesamtbudget von AGENTS.md, ohne Lücke
 *  (factory#177: ein Bezieher mit 12.309 Zeichen Rest, Stand 2026-11-06, sprengte mit dem Kern von 16.572 sein Gesamtbudget). Der Raum sinkt nur zusammen mit einem bewusst erhöhten `KERN_BLOCK_BUDGET`; wächst ein Rest darüber, ist das ein Befund an den Bezieher.
 *  Lückenlos, damit der Probe-Erstbezug (`probe-erstbezug.mjs`, factory#234) mit vollem Raum und einem Kern ein Zeichen über dem Kern-Budget das Gesamtbudget reißt.
 *  Grenze: gerechnet wird mit dem Kern der Fabrik; im Bezieher trägt der Kern zusätzlich die Projektwert-Tabelle (wenige Dutzend Zeichen mehr). */
export const PROJEKT_BLOCK_RAUM = 12_563;

/** Pur: Meldung, wenn Kern-Budget plus Projekt-Raum das Gesamtbudget von `AGENTS.md` übersteigt, sonst `null` (die Raum-Invariante, geprüft in `test/kern-block-budget.test.ts`). */
export function kernRaumBefund({ kern, raum, gesamt }) {
  if (kern + raum <= gesamt) return null;
  return `Kern-Budget ${kern} + Projekt-Raum ${raum} = ${kern + raum} > Gesamtbudget ${gesamt} von AGENTS.md: ein Bezieher mit Raum-großem Projekt-Block liefe nach dem Sync rot.`;
}

/** Zeichen des Blocks zwischen `marker.start` und `marker.ende` (zeilenenden-neutral) oder `null`, wenn ein Marker fehlt oder das Ende vor dem Start steht. Die Marker gibt der Aufrufer vor (`markerStart`/`markerEnde` aus `besitz-lib.mjs`), die Lib bleibt Blatt. */
export function kernBlockZeichen(text, { start, ende }) {
  const a = text.indexOf(start);
  const b = text.indexOf(ende);
  return a < 0 || b < a ? null : countChars(text.slice(a, b));
}

/** Pur: Meldung, wenn der Kern-Block das Budget überschreitet oder seine Marker fehlen (fail-closed); `null` sonst und immer außerhalb der Fabrik (im Bezieher gilt sein Gesamtbudget, der Kern kommt per Sync). `marker` = `{ start, ende }` (Pflicht). */
export function kernBlockBefund({ text, fabrik, budget = KERN_BLOCK_BUDGET, marker }) {
  if (!fabrik) return null;
  const chars = kernBlockZeichen(text, marker);
  if (chars === null) return `Kern-Block von AGENTS.md nicht messbar: Marker ${marker.start} und ${marker.ende} fehlen oder stehen verdreht.`;
  if (chars <= budget) return null;
  return `Kern-Block von AGENTS.md ${chars} Zeichen > Kern-Block-Budget ${budget}. Kern-Regeln kürzen oder auslagern; das Budget (KERN_BLOCK_BUDGET in scripts/kontext-budget-lib.mjs) wächst nur bewusst per reviewtem Commit.`;
}

/** Zeichen-Budget je Agenten- und Skill-Datei (factory#307): `.claude/agents/*.md`, `.agents/skills/<name>/**` (SKILL.md und Zusatzdateien). Nur die verteilten Pfade aus dem Besitz-Manifest stehen hier (der Kern nennt keine Fabrik-Dateien);
 *  jede andere Datei dieser Ordner, auch eine projekt-eigene im Bezieher, bekommt `AGENTEN_SKILL_DEFAULT_BUDGET`. Gemessen OHNE Projektwerte (Block und Werte der Frontmatter-Zeilen; sie wachsen mit der Projekt-Config, nicht mit dem Kern).
 *  Kalibriert am 2026-11-11 (main e31542f): Ist + 10 %, aufgerundet auf 500 Zeichen. Ratchet: ein Budget sinkt nur, wächst es gegenüber der Merge-Base, wird `test/harness/kontext-budget-ratchet.test.ts` rot.
 *  Je Eintrag genau eine Zeile `{ file: "<pfad>", budget: <zahl> },` (der Ratchet-Test liest sie). Verfall: Prüftermin laut Wiedervorlage `regeln-verfall-2027-03` (ADR 0027). */
export const AGENTEN_SKILL_BUDGETS = [
  { file: ".agents/skills/factory/SKILL.md", budget: 1_500 },
  { file: ".agents/skills/factory/ablauf.md", budget: 37_500 },
  { file: ".agents/skills/factory/plattform-windows.md", budget: 2_500 },
  { file: ".agents/skills/factory/umsetzer-browser.md", budget: 2_000 },
  { file: ".agents/skills/factory/umsetzer-fortsetzung.md", budget: 5_000 },
  { file: ".agents/skills/factory/umsetzer-gruppen.md", budget: 3_500 },
  { file: ".agents/skills/factory/umsetzer-guard-proben.md", budget: 2_500 },
  { file: ".agents/skills/factory/umsetzer-pr-merge.md", budget: 4_000 },
  { file: ".agents/skills/review-lenses/SKILL.md", budget: 10_000 },
  { file: ".agents/skills/review-lenses/ablauf-abnahme-fix.md", budget: 1_500 },
  { file: ".agents/skills/review-lenses/ablauf-klasse-hoch.md", budget: 2_500 },
  { file: ".agents/skills/review-lenses/ablauf-merge-main.md", budget: 6_000 },
  { file: ".agents/skills/review-lenses/ablauf-nachweis.md", budget: 3_000 },
  { file: ".agents/skills/review-lenses/ablauf-zusatzpass.md", budget: 2_000 },
  { file: ".agents/skills/review-lenses/brille-architektur.md", budget: 2_000 },
  { file: ".agents/skills/review-lenses/brille-doku.md", budget: 2_000 },
  { file: ".agents/skills/review-lenses/brille-kombiniert.md", budget: 2_000 },
  { file: ".agents/skills/review-lenses/brille-requirement-treue.md", budget: 4_000 },
  { file: ".agents/skills/review-lenses/brille-sicherheit.md", budget: 2_500 },
  { file: ".agents/skills/review-lenses/brille-test-adaequanz.md", budget: 7_500 },
  { file: ".claude/agents/explore.md", budget: 1_500 },
  { file: ".claude/agents/factory-gruppe.md", budget: 7_500 },
  { file: ".claude/agents/factory-lens.md", budget: 12_000 },
  { file: ".claude/agents/factory-planer.md", budget: 17_500 },
  { file: ".claude/agents/factory-umsetzer.md", budget: 19_460 },
  { file: ".claude/agents/holdout-abnahme.md", budget: 7_000 },
  { file: ".claude/agents/holdout-szenario.md", budget: 3_500 },
];

/** Budget für jede Agenten- und Skill-Datei ohne Eintrag (gleich dem größten Budget der Liste, `test/agenten-skill-budget.test.ts` verlangt das). */
export const AGENTEN_SKILL_DEFAULT_BUDGET = 37_500;

/** Zeichen eines Textes ohne den Block von `marker.start` bis einschließlich `marker.ende` (zeilenenden-neutral); fehlt ein Marker oder steht das Ende vor dem Start, zählt der ganze Text. Die Marker gibt der Aufrufer vor (Blatt). */
export function zeichenOhneBlock(text, { start, ende }) {
  const a = text.indexOf(start);
  const b = text.indexOf(ende);
  if (a < 0 || b < a) return countChars(text);
  return countChars(text.slice(0, a) + text.slice(b + ende.length));
}
