#!/usr/bin/env node
// Monatlicher Ticket-Drift-Lauf (factory#28, ADR 0033): prüft die offenen Tickets deterministisch gegen den Checkout (Pfade, Zeilen, Blocker, Duplikate, Rückstellungen) und legt genau einen
// Bericht ab: Stdout, Step-Summary und das eine Bericht-Issue "🔎 Ticket-Drift-Bericht <JJJJ-MM>" (Marker im Body). Er schließt, labelt und kommentiert kein Ticket; die Bewertung macht ein Agent nach
// `.agents/skills/factory/ticket-drift.md`. Mechanik: docs/agent-harness.md (Fabrik) § 2.2.
//   node scripts/ticket-drift.mjs [--dry-run]    # --dry-run schreibt nur Stdout/Step-Summary
// Schreibaufrufe (nur im echten Lauf): `gh issue edit <bericht-nr> --body-file -` (offener, ungeclaimter Bericht), `gh issue create` (kein Bericht offen, aber Befunde) und danach
// `board-place.mjs --top <neue nr>` (ohne PROJECT_TOKEN nur eine Warnung). Ein geclaimter Bericht bleibt unberührt. Exit: 0 Bericht erzeugt, 1 Fehler (auch ≥ 1000 offene Issues: fail-closed), 2 Aufruffehler.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerMeldung, ghJson, ghText } from "./gh-cli.mjs";
import { inboxStart } from "./inbox-start-lib.mjs";
import { labelAus, spracheAus, zielRepoFuer } from "./projekt-config-lib.mjs";
import { gleichesRepo, zerlegeRepo } from "./repo-form.mjs";
import { BERICHT_MARKER, berichtText, pruefe } from "./ticket-drift-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const BOARD_PLACE = fileURLToPath(new URL("./board-place.mjs", import.meta.url));
const LIMIT = 1000;
const FELDER = "number,title,body,author,labels,assignees,updatedAt,blockedBy,comments";

/** Git-Sicht auf den Checkout: Existenz und Zeilenzahl über das Dateisystem, Verlauf über `git log` (`--` vor jedem Pfad). `git(args)` ist die Test-Naht. */
export function gitSicht(wurzel = WURZEL, git = (args) => execFileSync("git", args, { cwd: wurzel, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })) {
  const tops = new Set(git(["ls-files"]).split("\n").filter((p) => p.includes("/")).map((p) => p.split("/")[0]));
  const shallow = git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
  const cache = new Map();
  const zeilen = (p) => {
    if (!cache.has(p)) cache.set(p, readFileSync(join(wurzel, p), "utf8").split("\n").length - 1);
    return cache.get(p);
  };
  return {
    tops,
    shallow,
    sha: git(["rev-parse", "--short", "HEAD"]).trim(),
    git: {
      shallow,
      existiert: (p) => existsSync(join(wurzel, p)),
      zeilen,
      letzteAenderung: (p) => git(["log", "-1", "--format=%cI", "--", p]).trim() || null,
      geaendertSeit: (p, seit) => git(["log", `--since=${seit}`, "--format=%H", "--", p]).trim() !== "",
    },
  };
}

/** Die Standard-Schreibnähte: `gh` mit Body über stdin und der Board-Aufruf. */
const ghSchreibenStandard = (args, input) => ghText(args, { stdio: ["pipe", "pipe", "pipe"], exec: (c, a, o) => execFileSync(c, a, { ...o, input }) });
const platziereStandard = (nr, token) => execFileSync(process.execPath, [BOARD_PLACE, "--top", String(nr)], { env: { ...process.env, GH_TOKEN: token }, stdio: "inherit" });

/** Wählt das Ziel: offenes Bericht-Issue (Marker im Body, nicht verschoben), sonst Neuanlage (nur mit Befunden). Rückgabe `{ art: "edit"|"create"|"nichts", nr? }`. */
export function waehleZiel(issues, hatBefunde) {
  const bericht = issues.filter((i) => String(i.body ?? "").includes(BERICHT_MARKER)).sort((a, b) => a.number - b.number)[0];
  if (bericht) return bericht.assignees?.length ? { art: "nichts", nr: bericht.number } : { art: "edit", nr: bericht.number };
  return hatBefunde ? { art: "create" } : { art: "nichts" };
}

/** Schreibt den Bericht in das Ziel; die einzigen Schreibaufrufe des Skripts. */
function schreibe(ziel, text, { config, repo, datum, env, ghSchreiben, platziere, log }) {
  if (ziel.art === "nichts") return log(ziel.nr ? `Bericht #${ziel.nr} ist geclaimt: unberührt.` : "Keine Befunde, kein Bericht-Issue.");
  if (ziel.art === "edit") {
    ghSchreiben(["issue", "edit", String(ziel.nr), "--body-file", "-"], text);
    return log(`Bericht #${ziel.nr} aktualisiert.`);
  }
  const label = labelAus(config, "harness");
  const mitLabel = gleichesRepo(zielRepoFuer([label], config), repo) ? ["--label", label] : [];
  const url = ghSchreiben(["issue", "create", "--title", `🔎 Ticket-Drift-Bericht ${datum.slice(0, 7)}`, "--body-file", "-", ...mitLabel], text);
  const nr = Number(/(\d+)\s*$/.exec(String(url))?.[1]);
  if (!Number.isInteger(nr) || nr <= 0) throw new Error(`Bericht angelegt, Nummer nicht lesbar: ${String(url).slice(0, 200)}`);
  log(`Bericht #${nr} angelegt.`);
  if (!env.PROJECT_TOKEN) return log("::warning::PROJECT_TOKEN fehlt: der Bericht steht nicht oben im Board.");
  platziere(nr, env.PROJECT_TOKEN);
}

/** Lädt die offenen Issues (fail-closed bei Limit), prüft und baut den Bericht. Rückgabe `{ issues, ergebnis, text, datum }`. */
function erzeuge({ config, repo, ghLesen, sicht, heute }) {
  const issues = ghLesen(["issue", "list", "--state", "open", "--limit", String(LIMIT), "--json", FELDER]);
  if (!Array.isArray(issues) || issues.length >= LIMIT) throw new Error(`Issue-Liste unvollständig (${Array.isArray(issues) ? issues.length : "kein Array"} von höchstens ${LIMIT}): kein Bericht`);
  const s = sicht ?? gitSicht();
  const ergebnis = pruefe(issues, { config, owner: zerlegeRepo(repo).owner, tops: s.tops, git: s.git, sprache: spracheAus(config).spezifikation });
  const datum = heute ?? new Date().toISOString().slice(0, 10);
  return { issues, ergebnis, datum, text: berichtText(ergebnis, { sha: s.sha, datum }) };
}

/** Einstieg. `deps` (Tests): `ladeConfig`, `ladeLibs` (liefert `REPO`), `ghLesen(args)`, `ghSchreiben(args, input)`, `platziere(nr, token)`, `sicht` (von `gitSicht`), `env`, `heute`, `schreibeSummary(pfad, text)`, `log`, `err`. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { ladeConfig, ladeLibs, ghLesen = (args) => ghJson(args), ghSchreiben = ghSchreibenStandard, platziere = platziereStandard, env = process.env, log = console.log, err = console.error } = deps;
  const start = await inboxStart(argv, { skript: "ticket-drift", praefix: "Ticket-Drift: Projekt-Config nicht lesbar: ", ladeConfig, ladeLibs, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, config, libs } = start;
  const repo = libs.REPO;
  try {
    const { issues, ergebnis, text, datum } = erzeuge({ config, repo, ghLesen, sicht: deps.sicht, heute: deps.heute });
    log(text);
    if (env.GITHUB_STEP_SUMMARY) (deps.schreibeSummary ?? ((p, t) => appendFileSync(p, t)))(env.GITHUB_STEP_SUMMARY, text);
    if (!trocken) schreibe(waehleZiel(issues, ergebnis.befunde.length > 0), text, { config, repo, datum, env, ghSchreiben, platziere, log });
    return 0;
  } catch (e) {
    log(fehlerMeldung(e, { praefix: "::error::Ticket-Drift: " }));
    return 1;
  }
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
