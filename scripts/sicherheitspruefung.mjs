#!/usr/bin/env node
// Sicherheitsprüfung (Monatslauf, factory#388, Fortschreibung ADR 0031): gleicht Sicherheits- und Konfigurationspunkte des EIGENEN Repos gegen die Soll-Liste `.github/sicherheitspruefung.json` ab
// (Dependabot-Abdeckung, Alerts und Security-Updates, CodeQL-Sprachen, Secret-Scanning samt Push-Protection, Ruleset und Spiegel, Required Checks) und legt bei Abweichungen genau ein Ticket an.
//   node scripts/sicherheitspruefung.mjs [--dry-run]    # --dry-run schreibt nichts, gibt Bericht und Entscheidung auf stdout aus
// Der Takt läuft im Repo selbst (Workflow aus dem Sync); die Fabrik schreibt nie in ein Bezieher-Repo. Gelesen wird mit `PROJECT_TOKEN` (nur GET), geschrieben wird mit dem Standard-`GH_TOKEN` (`github.token`)
// ausschließlich ins eigene Repo: `gh issue create --repo <eigenes>` und danach `platziereAmEnde` (Ende der Todo-Spalte; ohne PROJECT_TOKEN nur eine Warnung). Weicht `GITHUB_REPOSITORY` vom Repo der
// Projekt-Config ab, endet der Lauf mit Exit 1 vor jedem Schreibaufruf. Ist alles gleich dem Soll oder schon ein Ticket der Sicherheitsprüfung offen, kommt nur eine Log-Zeile: kein Ticket, kein Kommentar, keine Step-Summary.
// Exit: 0 normal, 1 Lauf- oder Schreibfehler (auch ≥ 1000 offene Issues: fail-closed), 2 Aufruf- oder Config-Fehler. Mechanik: docs/agent-harness.md (Fabrik) § 2.2.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerMeldung, fehlerText, ghText } from "./gh-cli.mjs";
import { pruefLauf } from "./harness-doctor-lib.mjs";
import { bestaetigeAnlegen, inboxStart } from "./inbox-start-lib.mjs";
import { labelAus, zielRepoFuer } from "./projekt-config-lib.mjs";
import { gleichesRepo, zerlegeRepo } from "./repo-form.mjs";
import { WORKFLOW, pruefeDependabot } from "./sicherheitspruefung-dependabot.mjs";
import { berichtText, berichtTitel, entscheide, filtere, istSprachen, istTicket, ladeSollListe, pruefeAlerts, pruefeCodeql } from "./sicherheitspruefung-lib.mjs";
import { nutzerAus } from "./ticket-drift-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const SOLL_PFAD = ".github/sicherheitspruefung.json";
const LIMIT = 1000;
const TIMEOUT = 30000;

const lesenStandard = (rel) => {
  try {
    return readFileSync(join(WURZEL, rel), "utf8");
  } catch {
    return null;
  }
};
const dateienStandard = () => execFileSync("git", ["ls-files"], { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n").filter(Boolean);
const schreibenStandard = (args, input) => ghText(args, { stdio: ["pipe", "pipe", "pipe"], exec: (c, a, o) => execFileSync(c, a, { ...o, input }) });

/** Liest eine API-Quelle als `{ wert }` oder `{ fehler }` (wirft nie). */
function quelle(lesen) {
  try {
    return { wert: lesen() };
  } catch (e) {
    return { fehler: fehlerText(e, 300).split("\n")[0] };
  }
}

/** HTTP-Status von `gh api <pfad>`: 204 bei leerer Antwort, sonst die Zahl aus der Fehlermeldung (`HTTP 404`), sonst `null`. */
function status(gh, pfad) {
  try {
    gh(["api", pfad]);
    return 204;
  } catch (e) {
    const m = /HTTP (\d{3})/.exec(fehlerText(e));
    return m ? Number(m[1]) : null;
  }
}

const PROJEKT_TOKEN_ZEILE = (repo) => ({
  punkt: "Secret PROJECT_TOKEN",
  ok: false,
  befund: "im Monatslauf leer: gelesen wird mit github.token, die Punkte mit Admin-Recht sind nicht prüfbar",
  soll: "Secret PROJECT_TOKEN gesetzt (PAT mit Admin-Recht und project-Scope)",
  fix: `Wert per stdin, ohne TTY: <wert-quelle> | gh secret set PROJECT_TOKEN --repo ${repo}`,
});

/** Relativer Pfad des `package.json` im Verzeichnis `verz` (`/` oder `/a/b`). */
const pkgPfad = (verz) => (verz === "/" ? "package.json" : `${verz.slice(1)}/package.json`);

/** Die Dependabot-Ergebnisse: Abdeckung der Manifeste gegen `dependabot.yml`. */
function dependabotErgebnisse({ soll, lese, liste }) {
  const lesePackageJson = (verz) => {
    try {
      return JSON.parse(lese(pkgPfad(verz)));
    } catch {
      return null;
    }
  };
  return pruefeDependabot({ dateien: liste, dependabotText: lese(".github/dependabot.yml"), lesePackageJson, projekt: { manifeste: soll.manifeste, ausnahmen: soll.ausnahmen } });
}

/** Das CodeQL-Ergebnis: Sprachen des Repos gegen die Sprachen der Config bzw. des Default-Setups. */
function codeqlErgebnis({ soll, repo, config, gh, liste }) {
  const languages = quelle(() => JSON.parse(gh(["api", `repos/${repo}/languages`])));
  const defaultSetup = (config.module ?? []).includes("codeql") ? undefined : quelle(() => JSON.parse(gh(["api", `repos/${repo}/code-scanning/default-setup`])));
  const workflows = liste.some((p) => WORKFLOW.test(p));
  return pruefeCodeql({ languages: languages.wert, kern: soll.codeql, workflows, ohne: soll.codeqlOhne, ist: istSprachen({ config, defaultSetup }) });
}

/** Alle Abweichungen dieses Laufs gegen die Soll-Liste: Doctor-Punkte (gefiltert) plus Dependabot-Abdeckung, Alerts und CodeQL-Sprachen. `d`: `{ soll, repo, config, gh, lese, doctor, dateien, env }`. */
function ermittle(d) {
  const { soll, repo, config, gh, lese, env } = d;
  const roh = d.doctor({ rootDir: WURZEL, gh, rulesetLesen: (a) => JSON.parse(gh(a)) }).ergebnis;
  const ergebnis = filtere(roh, soll.punkte);
  const liste = d.dateien();
  const hat = (p) => soll.punkte.includes(p);
  const alle = [...ergebnis];
  if (hat("Dependabot-Abdeckung")) alle.push(...dependabotErgebnisse({ soll, lese, liste }));
  if (hat("Dependabot Alerts")) alle.push(pruefeAlerts({ status: status(gh, `repos/${repo}/vulnerability-alerts`), admin: roh.some((r) => r.punkt === "Admin-Recht" && r.ok), repo }));
  if (hat("CodeQL-Sprachen")) alle.push(codeqlErgebnis({ soll, repo, config, gh, liste }));
  if (env.GITHUB_ACTIONS === "true" && !env.PROJECT_TOKEN) alle.push(PROJEKT_TOKEN_ZEILE(repo));
  return alle.filter((r) => !r.ok);
}

/** Offene Issues als `[{ number, title, body, user, labels }]` (fail-closed bei Limit). */
function offeneIssues(gh, repo) {
  const roh = JSON.parse(gh(["issue", "list", "--repo", repo, "--state", "open", "--limit", String(LIMIT), "--json", "number,title,body,author,labels"]));
  if (!Array.isArray(roh) || roh.length >= LIMIT) throw new Error(`Issue-Liste unvollständig (${Array.isArray(roh) ? roh.length : "kein Array"} von höchstens ${LIMIT}): kein Ticket`);
  return roh.map((i) => ({ number: i.number, title: i.title, body: i.body, user: nutzerAus(i.author), labels: (i.labels ?? []).map((l) => l.name) }));
}

/** Zweitabfrage vor dem Anlegen (REST, hinkt weniger als die Liste): offene Issues desselben Repos in der Normalform. */
const frischeIssues = (gh, repo) =>
  JSON.parse(gh(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=open&per_page=100`]))
    .flat()
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title, body: i.body, user: { login: i.user?.login, type: i.user?.type }, labels: (i.labels ?? []).map((l) => l.name) }));

/** Legt das Ticket im eigenen Repo an (der einzige Schreibaufruf mit Inhalt) und sortiert es ans Ende der Todo-Spalte. */
function lege(d, { titel, text }) {
  const { repo, config, schreibe, log, env, libs } = d;
  const label = labelAus(config, "dependabotInbox");
  const mitLabel = gleichesRepo(zielRepoFuer([label], config), repo) ? ["--label", label] : [];
  const url = schreibe(["issue", "create", "--repo", repo, "--title", titel, "--body-file", "-", ...mitLabel], text);
  const nr = Number(/\/issues\/(\d+)\s*$/.exec(String(url))?.[1]);
  if (!Number.isInteger(nr) || nr <= 0) throw new Error(`Ticket angelegt, Nummer nicht lesbar: ${String(url).slice(0, 200)}`);
  log(`Sicherheitsprüfung: Ticket #${nr} angelegt.`);
  if (!env.PROJECT_TOKEN) return log("::warning::PROJECT_TOKEN fehlt: das Ticket steht nicht im Board.");
  try {
    libs.platziereAmEnde(nr, env.PROJECT_TOKEN);
  } catch (e) {
    log(`::warning::Ticket #${nr} angelegt, aber nicht ans Ende der Todo-Spalte sortiert: ${fehlerText(e)}`);
  }
}

/** Standard-Nähte des Einstiegs (Tests überschreiben sie über `deps`). */
const STANDARD = { doctor: pruefLauf, schreibe: schreibenStandard, lese: lesenStandard, dateien: dateienStandard, env: process.env, log: console.log, err: console.error };

/** Die aktiven Ausnahmen und Abwahlen der Soll-Liste als Logzeilen (bei jedem Lauf sichtbar, auch ohne Ticket). */
const aktiveAbwahlen = (soll) => [
  ...soll.ausnahmen.map((a) => `Dependabot-Ausnahme ${a.pfad}: ${a.grund}`),
  ...soll.codeqlOhne.map((a) => `CodeQL ohne ${a.sprache}: ${a.grund}`),
  ...soll.punkteOhne.map((a) => `Punkt abgewählt ${a.punkt}: ${a.grund}`),
];

/** Gibt die Entscheidung aus (Trockenlauf: Bericht und Entscheidung, nichts geschrieben) oder legt das Ticket an. */
function ausfuehren({ trocken, e, titel, text }, io) {
  if (trocken) return io.log(`[dry-run] ${titel}\n${text}\n[dry-run] Entscheidung: ${e.aktion} (${e.grund})`);
  if (e.aktion === "nichts") return io.log(`Sicherheitsprüfung: nichts zu tun (${e.grund}).`);
  return lege(io, { titel, text });
}

/** Liest und prüft die Soll-Liste: `{ soll }` oder `{ fehler }` (Meldung samt Fix). */
function sollLaden(lese) {
  try {
    const text = lese(SOLL_PFAD);
    if (text === null) throw new Error(`${SOLL_PFAD} fehlt\nFix: die Datei per Sync beziehen (kern) und bei Bedarf einen Schlüssel projekt ergänzen`);
    return { soll: ladeSollListe(text) };
  } catch (e) {
    return { fehler: fehlerMeldung(e, { praefix: "Sicherheitsprüfung: Soll-Liste ungültig: " }) };
  }
}

/** Entscheidung samt Zweitabfrage: ohne Abweichung nichts, sonst gegen die offenen Issues und die frische REST-Liste (fail-closed). */
function entscheideLauf({ abweichungen, gh, repo, config }) {
  const owner = zerlegeRepo(repo).owner;
  const e0 = entscheide({ abweichungen, offene: abweichungen.length === 0 ? [] : offeneIssues(gh, repo), owner, config });
  return bestaetigeAnlegen(e0, { zweit: () => frischeIssues(gh, repo), passt: (i) => istTicket(i, owner, config), was: "Ticket der Sicherheitsprüfung" });
}

/**
 * Einstieg. `deps` (Tests): `ladeConfig`, `ladeLibs` (liefert `platziereAmEnde`), `doctor` (Prüflauf), `gh(args)` (lesend), `schreibe(args, input)` (der einzige Schreibweg), `lese(relPfad)` (Text oder null),
 * `dateien()`, `env`, `heute`, `log`, `err`.
 */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { ladeConfig, ladeLibs, doctor, schreibe, lese, dateien, env, log, err } = { ...STANDARD, ...deps };
  const start = await inboxStart(argv, { skript: "sicherheitspruefung", praefix: "Sicherheitsprüfung: Projekt-Config nicht lesbar: ", ladeConfig, ladeLibs, log, err });
  if (start.code !== undefined) return start.code;
  const { trocken, config, libs } = start;
  const repo = config.repo;
  if (env.GITHUB_REPOSITORY && !gleichesRepo(env.GITHUB_REPOSITORY, repo)) {
    log(`::error::Sicherheitsprüfung: GITHUB_REPOSITORY (${env.GITHUB_REPOSITORY}) ist nicht das Repo der Projekt-Config (${repo}); der Lauf schreibt nur ins eigene Repo, nichts getan. Fix: den Workflow im eigenen Repo laufen lassen.`);
    return 1;
  }
  const { soll, fehler } = sollLaden(lese);
  if (fehler) {
    log(fehler);
    return 2;
  }
  const gh = deps.gh ?? ((args) => ghText(args, { token: env.PROJECT_TOKEN, timeout: TIMEOUT }));
  try {
    const abweichungen = ermittle({ soll, repo, config, gh, lese, doctor, dateien, env });
    const datum = deps.heute ?? new Date().toISOString().slice(0, 10);
    const e = entscheideLauf({ abweichungen, gh, repo, config });
    for (const w of e.warnungen) log(`::warning::${w}`);
    for (const z of aktiveAbwahlen(soll)) log(`Sicherheitsprüfung: ${z}`);
    const text = berichtText({ abweichungen, ausnahmen: soll.ausnahmen, codeqlOhne: soll.codeqlOhne, punkteOhne: soll.punkteOhne, datum });
    ausfuehren({ trocken, e, titel: berichtTitel(datum), text }, { repo, config, schreibe, log, env, libs });
    return 0;
  } catch (e) {
    log(fehlerMeldung(e, { praefix: "Sicherheitsprüfung: " }));
    return 1;
  }
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
