// Prüffunktionen (importiert nur skill-pfade.mjs): die EINE Quelle der Prüffunktionen für den Fitness-Anteil von model-routing
// (factory#150). Der Kern-Test test/harness/model-routing.test.ts und der Doctor-Punkt `Modell-Routing` (harness-doctor-dateien.mjs) lesen
// dieselben Definitionen. Funde tragen das Präfix ihrer Teilregel (a) bis (e).
// Grenzen: `routingPfade` liest je Ordner nur eine Ebene (Workflow-Skripte `.js`/`.mjs`/`.ts` direkt in .claude/workflows; Markdown, YAML und Unterordner dort bleiben ungeprüft); `parseFrontmatter` liest flach (`model:` und `effort:` oberste Ebene); Effort wird nur auf Anwesenheit geprüft; ein neuer
// Alias braucht einen Factory-Release (`MODELL_ALIASE`); geprüft wird die Claude-Code-Konfiguration, nicht die Modellwahl von Codex.
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";

/** Geschlossene Alias-Liste für `model:` im Agent-Frontmatter (docs/model-routing.md (Fabrik) › Geschlossene Alias-Liste für Agent-Frontmatter nennt genau diese; Wächter im Kern-Test). */
export const MODELL_ALIASE = Object.freeze(["opus", "sonnet", "haiku", "fable"]);

/** Trägt der Text eine feste Modell-ID (`model: claude-opus-5`, `"model": "claude-haiku-4-5-…"`)? */
export const hatHartenPin = (text) => /\bmodel["']?\s*:\s*["']?claude-(opus|sonnet|haiku|fable)-\d/i.test(text);

/**
 * Befunde zum Hauptchat-Modell in den Projekt-Settings (quellprojekt#1557): `model` muss genau `sonnet` sein (der Alias, nie eine feste ID),
 * und kein `env`-Schlüssel mit MODEL darf es überstimmen (`ANTHROPIC_MODEL` hat Vorrang vor dem Settings-`model`; generisch,
 * damit neue Variablennamen nicht durchrutschen); ebenso kein EFFORT-Schlüssel (`CLAUDE_CODE_EFFORT_LEVEL` überstimmt das
 * Agent-Frontmatter). Die 1h-TTL des Hauptchats bleibt Default: kein TTL-Schlüssel (docs/model-routing.md (Fabrik) § 5); `subagentPromptCacheTtl` überstimmt das Frontmatter jeder Rolle und ist ebenfalls verboten (die TTL je Rolle steht im Frontmatter, factory#312).
 */
export function hauptchatModellBefunde(settings) {
  const out = settings.model === "sonnet" ? [] : [`model=${JSON.stringify(settings.model ?? null)}`];
  for (const k of Object.keys(settings.env ?? {})) if (/MODEL|EFFORT|PROMPT_CACHE_TTL|PROMPT_CACHING/i.test(k)) out.push(`env.${k}`);
  if (settings.promptCacheTtl !== undefined) out.push("promptCacheTtl");
  if (settings.subagentPromptCacheTtl !== undefined) out.push("subagentPromptCacheTtl");
  if (settings.experimental?.cacheTtl !== undefined) out.push("experimental.cacheTtl");
  return out;
}

const zelleOhneCode = (z) => z.replace(/`/g, "").trim();

/** Fehltext zu einer Zielzelle ohne `Subagent \`name\``: mit Rückfall auf einen Namen ohne Backticks ein Format-Hinweis, sonst „nicht zuordenbar“. */
function zielFehler(ziel) {
  const roh = /Subagent\s+([\w-]+)/.exec(ziel)?.[1];
  return roh === undefined ? "Ziel „Subagent name“ in der letzten Zelle nicht zuordenbar" : `Subagent „${roh}“ ohne Backticks; Format: Subagent \`name\``;
}

/**
 * Prüft die Tabelle „Projekt-Phase“ (Rollen außerhalb des Kerns) generisch gegen die Frontmatter ihrer Subagenten: je Zeile nennt die
 * letzte Zelle „Subagent `name`“, die Datei ist `.claude/agents/<name>.md`; Alias (Spalte „Alias“) und Effort (Spalte „Effort Skill-Pfad“)
 * müssen dem Frontmatter gleichen. Ohne die Tabelle oder ohne Zeilen gibt es nichts zu prüfen (ein Projekt ohne eigene Rollen). Liefert die Verstöße.
 */
export function projektPhasenAbweichungen(doku, fmVon) {
  const zeilen = doku.split("\n");
  const kopf = zeilen.findIndex((z) => z.startsWith("| Projekt-Phase |"));
  if (kopf < 0) return [];
  const zellen = (z) => z.split("|").slice(1, -1).map((c) => c.trim());
  const spalten = zellen(zeilen[kopf]);
  const [iAlias, iEffort] = [spalten.indexOf("Alias"), spalten.indexOf("Effort Skill-Pfad")];
  if (iAlias < 0 || iEffort < 0) return [`Projekt-Phase: Spalte fehlt (Alias ${iAlias}, Effort Skill-Pfad ${iEffort})`];
  const fehler = [];
  for (let i = kopf + 2; i < zeilen.length && zeilen[i].startsWith("|"); i++) {
    const c = zellen(zeilen[i]);
    const phase = zelleOhneCode(c[0] ?? "");
    const ziel = c[c.length - 1];
    const name = /Subagent `([\w-]+)`/.exec(ziel)?.[1];
    if (name === undefined) {
      fehler.push(`${phase}: ${zielFehler(ziel)}`);
      continue;
    }
    const fm = fmVon(`.claude/agents/${name}.md`);
    if (fm === null) {
      fehler.push(`${phase}: Agentendatei .claude/agents/${name}.md fehlt`);
      continue;
    }
    const effort = zelleOhneCode(c[iEffort] ?? "");
    if (fm.effort !== effort) fehler.push(`${phase}: Effort „${effort}“ ≠ Frontmatter ${name} „${fm.effort}“`);
    const alias = zelleOhneCode(c[iAlias] ?? "");
    if (fm.model !== alias) fehler.push(`${phase}: Alias „${alias}“ ≠ Frontmatter ${name} „${fm.model}“`);
  }
  return fehler;
}

/** (a) für einen Projekt-Agenten: `model:` aus `MODELL_ALIASE`, `effort:` vorhanden und nicht `inherit`. `fm` ist das Frontmatter. Pur. */
export function projektAgentFunde(fm, pfad) {
  const funde = [];
  if (!MODELL_ALIASE.includes(fm.model)) funde.push(`(a) ${pfad}: model=${fm.model || "fehlt"}`);
  if (!fm.effort || fm.effort === "inherit") funde.push(`(a) ${pfad}: effort=${fm.effort || "fehlt"}`);
  return funde;
}

/** (c) über `[{ pfad, name }]` aller Agenten (auch der Besitz-Agenten): doppelter `name:` und Dateien ohne `name:`. Pur. */
export function doppelteNamen(eintraege) {
  const funde = eintraege.filter((e) => !e.name).map((e) => `(c) ${e.pfad} ohne name:`);
  const jeName = new Map();
  for (const e of eintraege.filter((x) => x.name)) jeName.set(e.name, [...(jeName.get(e.name) ?? []), e.pfad]);
  for (const [name, pfade] of jeName) if (pfade.length > 1) funde.push(`(c) name „${name}“ doppelt: ${pfade.join(", ")}`);
  return funde;
}

/**
 * Scan-Umfang von (b): `.claude/settings.json`, `.claude/agents/*.md`, `SKILL.md` je Skill in Zeiger-Wurzel und Quell-Verzeichnis,
 * `.claude/workflows/*.{js,mjs,ts}`. `liste(ordner)` liefert die Namen im Ordner oder `null` (fehlt/unlesbar; der Ordner fällt still raus).
 * Ob die Dateien existieren, prüft der Aufrufer (Lesen liefert `null`). Pur.
 */
export function routingPfade(liste) {
  const out = [".claude/settings.json"];
  const agenten = liste(".claude/agents") ?? [];
  out.push(...agenten.filter((f) => f.endsWith(".md")).map((f) => `.claude/agents/${f}`));
  for (const wurzel of [ZEIGER_WURZEL, QUELL_VERZEICHNIS]) out.push(...(liste(wurzel) ?? []).map((d) => `${wurzel}/${d}/SKILL.md`));
  out.push(...(liste(".claude/workflows") ?? []).filter((f) => /\.(js|mjs|ts)$/.test(f)).map((f) => `.claude/workflows/${f}`));
  return out;
}
