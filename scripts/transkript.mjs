// Kein Shebang: wird von den Messskripten, vom Stop-Hook-Baustein und von Tests importiert.
/**
 * Neutrales Transkript-Lesen (#1331): drei Verbraucher teilen es (`brain-metrics.mjs`, `token-baseline.mjs`,
 * `umsetzer-abschluss.mjs`), darum steht es in keinem von ihnen. Reines Node-Skript ohne Abhängigkeiten.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

/** Transkript-JSONL → geparste Zeilen (leere und abgeschnittene Zeilen entfallen). Einmal parsen, dann an die Adapter reichen. */
export function transkriptZeilen(jsonlText) {
  const rows = [];
  for (const line of String(jsonlText).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // abgeschnittene letzte Zeile eines laufenden Transkripts
    }
  }
  return rows;
}

/**
 * Jüngste Assistant-Nachricht mit einer `ERGEBNIS:`-Zeile (#1342): entweder die `message` eines
 * `SubagentHandback`-Aufrufs oder ein Text-Block. Die Suche endet an der jüngsten User-Nachricht mit Text (factory#193: Fortsetzung
 * oder Hook-Feedback); `tool_result`-Einträge sind keine Grenze. `null`, wenn es keine gibt.
 */
export function letzteErgebnisNachricht(zeilen) {
  const hatErgebnis = (t) => typeof t === "string" && /^[ \t]*ERGEBNIS:/im.test(t);
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const msg = zeilen[i]?.message ?? zeilen[i];
    if ((msg?.role === "user" || zeilen[i]?.type === "user") && istTextNachricht(msg)) return null;
    if (msg?.role !== "assistant" && zeilen[i]?.type !== "assistant") continue;
    const kandidaten = berichtKandidaten(msg?.content);
    for (let j = kandidaten.length - 1; j >= 0; j--) if (hatErgebnis(kandidaten[j])) return kandidaten[j];
  }
  return null;
}

/** Eine User-Nachricht mit Text (Fortsetzung, Hook-Feedback) beginnt eine neue Runde; ein reines `tool_result` nicht. */
const istTextNachricht = (m) => typeof m?.content === "string" || (Array.isArray(m?.content) && m.content.some((b) => b?.type === "text"));

/** Texte, in denen ein Bericht stehen kann: String-Inhalt, Text-Blöcke und die `message` eines `SubagentHandback`-Aufrufs, in Reihenfolge. */
function berichtKandidaten(c) {
  if (typeof c === "string") return [c];
  if (!Array.isArray(c)) return [];
  return c.map((b) => (b?.type === "text" ? b.text : b?.type === "tool_use" && b.name === "SubagentHandback" ? b.input?.message : null));
}

/**
 * Eine Session aus ihrer Hauptdatei `<id>.jsonl` laden (#1392): die Zeilen der Hauptdatei und je Subagent
 * `<id>/subagents/<datei>.jsonl` samt Meta (`<datei>.meta.json`; fehlend oder kaputt ergibt `{}`). Eine EINZIGE Lese-Implementierung
 * für `token-baseline.mjs` und `hauptchat-zerlegung.mjs`. Liefert `{ id, main, subagents: [{ datei, meta, zeilen }] }`.
 */
export function ladeSessionDatei(pfad) {
  const id = basename(pfad).replace(/\.jsonl$/, "");
  const main = transkriptZeilen(readFileSync(pfad, "utf8"));
  const dir = join(dirname(pfad), id, "subagents");
  const subagents = [];
  if (existsSync(dir)) {
    for (const datei of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
      const metaPfad = join(dir, datei.replace(/\.jsonl$/, ".meta.json"));
      let meta = {};
      if (existsSync(metaPfad)) {
        try {
          meta = JSON.parse(readFileSync(metaPfad, "utf8")) ?? {};
        } catch {
          meta = {}; // kaputtes Meta: der Subagent bleibt lesbar, nur ohne agentType
        }
      }
      subagents.push({ datei, meta, zeilen: transkriptZeilen(readFileSync(join(dir, datei), "utf8")) });
    }
  }
  return { id, main, subagents };
}

/** Sessions eines Projektordners, eine nach der anderen (Generator): nur die gerade verarbeitete liegt im Speicher. */
export function* ladeSessions(dir, von) {
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const p = join(dir, f);
    if (von && statSync(p).mtimeMs < Date.parse(von)) continue;
    yield ladeSessionDatei(p);
  }
}

/** Repo-Pfad ohne Worktree-Suffix `.claude/worktrees/…` und ohne abschließende Schrägstriche (ein Worktree zählt als Hauptrepo). */
export function hauptrepoPfad(pfad) {
  return String(pfad)
    .replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, "")
    .replace(/[\\/]+$/, "");
}

/**
 * Projektordner-Name unter `~/.claude/projects` aus dem Repo-Pfad (#1572): Worktree-Suffix `.claude/worktrees/…` und
 * abschließende Schrägstriche entfallen (das Hauptrepo zählt), jedes Nicht-Alphanumerische wird `-`. EINE Ableitung für alle Messskripte.
 */
export function projektSlug(pfad) {
  return hauptrepoPfad(pfad).replace(/[^A-Za-z0-9]/g, "-");
}

/** Gehört der Ordnername zum Projekt `slug`: das Hauptrepo selbst oder einer seiner Worktrees; Geschwister (`<slug>-alt`) nicht. */
export function istProjektOrdner(name, slug) {
  return name === slug || String(name).startsWith(`${slug}--claude-worktrees-`);
}

/** Hauptrepo auch aus einem Worktree (`--git-common-dir` ohne `.git`); `null` ohne git. */
export function hauptrepoWurzel() {
  try {
    return execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim().replace(/[\\/]\.git[\\/]?$/, "");
  } catch {
    return null;
  }
}

/** Wurzel aller Claude-Code-Transkriptordner: `~/.claude/projects`. */
export function projekteWurzel() {
  return join(homedir(), ".claude", "projects");
}

/** Transkriptordner des Projekts: `slug` (z.B. aus `--projekt`) oder abgeleitet aus Hauptrepo bzw. cwd; git läuft nur ohne Slug. */
export function projektOrdner(slug) {
  return join(projekteWurzel(), slug ?? projektSlug(hauptrepoWurzel() ?? process.cwd()));
}
