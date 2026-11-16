#!/usr/bin/env node
// Code-Analyse (Monatslauf, factory#596): legt ohne Modell genau ein Takt-Ticket „🧭 Code-Analyse <JJJJ-MM>“ im EIGENEN Repo an; ein normaler Agentenlauf arbeitet es ab
// (Code-Funde als Zeilen per `melden.mjs --ziel refactoring`, Sicherheitsfunde als Notfall-Issue `🔒 Security:`). Vorbild und Schwester: `sicherheitspruefung.mjs`.
//   node scripts/code-analyse.mjs [--dry-run]    # --dry-run schreibt nichts, gibt Ticket und Entscheidung auf stdout aus
// Geschrieben wird nur mit dem Standard-`GH_TOKEN` (`github.token`): `gh issue create --repo <eigenes>` und danach `platziereAmEnde` (ohne PROJECT_TOKEN nur eine Warnung). Weicht `GITHUB_REPOSITORY`
// vom Repo der Projekt-Config ab, endet der Lauf mit Exit 1 vor jedem Schreibaufruf. Ist schon ein Takt-Ticket offen, kommt nur eine Log-Zeile. Ist das Refactoring-Ticket abgeschaltet
// (`labels.refactoring: false`, oder Fabrik/ohne Schlüssel im Nicht-Bezieher), trägt das Ticket nur die Sicherheitsanalyse und weist den Code-Teil als abgeschaltet aus.
// Exit: 0 normal, 1 Lauf- oder Schreibfehler (auch ≥ 1000 offene Issues: fail-closed), 2 Aufruf- oder Config-Fehler. Mechanik: docs/ticket-reihenfolge.md (Fabrik) § Code-Analyse (Monatslauf, factory#596).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { entscheide, istTicket, ticketText, titel } from "./code-analyse-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerMeldung, fehlerText, ghText } from "./gh-cli.mjs";
import { bestaetigeAnlegen, frischeIssues, inboxStart, offeneIssues } from "./inbox-start-lib.mjs";
import { labelAus, refactoringEinstellung, zielRepoFuer } from "./projekt-config-lib.mjs";
import { gleichesRepo, zerlegeRepo } from "./repo-form.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const TIMEOUT = 30000;
const schreibenStandard = (args, input) => ghText(args, { stdio: ["pipe", "pipe", "pipe"], exec: (c, a, o) => execFileSync(c, a, { ...o, input }) });
const STANDARD = { schreibe: schreibenStandard, bezieher: () => istBezieher(WURZEL), env: process.env, log: console.log, err: console.error };

/** Legt das Takt-Ticket im eigenen Repo an (der einzige Schreibaufruf mit Inhalt) und sortiert es ans Ende der Todo-Spalte. */
function lege(d, { titel: kopf, text }) {
  const { repo, config, schreibe, log, env, libs } = d;
  const label = labelAus(config, "dependabotInbox");
  const mitLabel = gleichesRepo(zielRepoFuer([label], config), repo) ? ["--label", label] : [];
  const url = schreibe(["issue", "create", "--repo", repo, "--title", kopf, "--body-file", "-", ...mitLabel], text);
  const nr = Number(/\/issues\/(\d+)\s*$/.exec(String(url))?.[1]);
  if (!Number.isInteger(nr) || nr <= 0) throw new Error(`Ticket angelegt, Nummer nicht lesbar: ${String(url).slice(0, 200)}`);
  log(`Code-Analyse: Takt-Ticket #${nr} angelegt.`);
  if (!env.PROJECT_TOKEN) return log("::warning::PROJECT_TOKEN fehlt: das Ticket steht nicht im Board.");
  try {
    libs.platziereAmEnde(nr, env.PROJECT_TOKEN);
  } catch (e) {
    log(`::warning::Ticket #${nr} angelegt, aber nicht ans Ende der Todo-Spalte sortiert: ${fehlerText(e)}`);
  }
}

/** Entscheidung samt Zweitabfrage (REST, fail-closed): ein offenes Takt-Ticket verhindert das Anlegen. */
function entscheideLauf({ gh, repo, config }) {
  const owner = zerlegeRepo(repo).owner;
  const e0 = entscheide({ offene: offeneIssues(gh, repo), owner, config });
  return bestaetigeAnlegen(e0, { zweit: () => frischeIssues(gh, repo), passt: (i) => istTicket(i, owner, config), was: "Takt-Ticket der Code-Analyse" });
}

/** Einstieg. `deps` (Tests): `ladeConfig`, `ladeLibs` (liefert `platziereAmEnde`), `gh(args)` (lesend), `schreibe(args, input)` (der einzige Schreibweg), `bezieher()`, `env`, `heute`, `log`, `err`. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { ladeConfig, ladeLibs, schreibe, bezieher, env, log, err } = { ...STANDARD, ...deps };
  const start = await inboxStart(argv, { skript: "code-analyse", praefix: "Code-Analyse: Projekt-Config nicht lesbar: ", ladeConfig, ladeLibs, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, config, libs } = start;
  const repo = config.repo;
  if (env.GITHUB_REPOSITORY && !gleichesRepo(env.GITHUB_REPOSITORY, repo)) {
    log(`::error::Code-Analyse: GITHUB_REPOSITORY (${env.GITHUB_REPOSITORY}) ist nicht das Repo der Projekt-Config (${repo}); der Lauf schreibt nur ins eigene Repo, nichts getan. Fix: den Workflow im eigenen Repo laufen lassen.`);
    return 1;
  }
  const gh = deps.gh ?? ((args) => ghText(args, { token: env.PROJECT_TOKEN, timeout: TIMEOUT }));
  try {
    const datum = deps.heute ?? new Date().toISOString().slice(0, 10);
    const e = entscheideLauf({ gh, repo, config });
    for (const w of e.warnungen) log(`::warning::${w}`);
    const text = ticketText({ datum, refactoring: refactoringEinstellung(config, { bezieher: bezieher() }) });
    if (trocken) log(`[dry-run] ${titel(datum)}\n${text}\n[dry-run] Entscheidung: ${e.aktion} (${e.grund})`);
    else if (e.aktion === "nichts") log(`Code-Analyse: nichts zu tun (${e.grund}).`);
    else lege({ repo, config, schreibe, log, env, libs }, { titel: titel(datum), text });
    return 0;
  } catch (e) {
    log(fehlerMeldung(e, { praefix: "Code-Analyse: " }));
    return 1;
  }
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
