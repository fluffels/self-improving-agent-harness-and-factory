#!/usr/bin/env node
/* Offene Punkte der Maintainerin (factory#152): listet aus GitHub, wofür sie gebraucht wird: `entscheidung-noetig`-Hand-offs (Label `labels.entscheidung`),
 * Issues und PRs mit dem Festgefahren-Label, nicht eintragbare Befunde und Bezieher-Befunde, je mit Link. Labels und Repo kommen aus der Projekt-Config.
 *
 *   node scripts/offene-punkte.mjs [--json] [--wurzel <pfad>]
 *
 * Exit 0: alle Gruppen prüfbar (auch mit offenen Punkten); 1: mindestens eine Gruppe NICHT PRÜFBAR (nie leer und grün); 2: Aufruf- oder Config-Fehler (mit Fix).
 * Logik, Gruppen und JSON-Vertrag: Kopf von `offene-punkte-lib.mjs`.
 */
import { resolve } from "node:path";
import { fehlerText, ghJson } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flach, issueKommentare } from "./fremdtext-lib.mjs";
import { ladeProjektConfig, meldestelleAus } from "./projekt-config-lib.mjs";
import { SAMMELTICKET_TITEL_LISTE } from "./sammelticket-titel.mjs";
import { alsJson, alsText, baueSicht, exitCode, sammeltickets } from "./offene-punkte-lib.mjs";

const AUFRUF = "Aufruf: node scripts/offene-punkte.mjs [--json] [--wurzel <pfad>]";
const STANDARD = { ladeConfig: (wurzel) => ladeProjektConfig({ rootDir: wurzel }), api: ghJson, log: console.log, err: console.error };

/** Die Kommentare je Sammelticket als Map Nummer → Liste oder `{ fehler }` (ein Abruffehler wirft nie). */
function kommentareDer(sammel, repo, api) {
  const karte = new Map();
  for (const t of sammel) {
    try {
      karte.set(t.number, issueKommentare(t.number, api, repo));
    } catch (e) {
      karte.set(t.number, { fehler: fehlerText(e) });
    }
  }
  return karte;
}

/** Liest die Quellen (jeder Fehler wird Daten, nie ein Absturz) und baut die Sicht. */
function sammleSicht({ config, api }) {
  const repo = config.repo;
  let issues;
  try {
    issues = flach(api(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=open&per_page=100`]));
  } catch (e) {
    issues = { fehler: fehlerText(e) };
  }
  if (!Array.isArray(issues)) return baueSicht({ config, issues });
  return baueSicht({ config, issues, ...bezieherQuelle({ config, repo, issues, api }) });
}

/** Die Quelle der Bezieher-Meldungen: das Harness-Sammelticket der Meldestelle (Schlüssel `meldestelle`, Standard das Repo des Factory-Boards). Weicht sie vom Config-Repo ab, werden ihre Issues zusätzlich gelesen; ist sie nicht bestimmbar oder nicht lesbar, steht `bezieherFehler` (nie "keine"). */
function bezieherQuelle({ config, repo, issues, api }) {
  let stelle;
  try {
    stelle = meldestelleAus(config) || repo;
  } catch (e) {
    return { bezieherFehler: `Meldestelle nicht bestimmbar: ${fehlerText(e)}` };
  }
  let quelle = issues;
  if (stelle !== repo) {
    try {
      quelle = flach(api(["api", "--paginate", "--slurp", `repos/${stelle}/issues?state=open&per_page=100`]));
    } catch (e) {
      return { bezieherFehler: `Meldestelle ${stelle} nicht lesbar: ${fehlerText(e)}` };
    }
  }
  const sammel = sammeltickets(quelle, SAMMELTICKET_TITEL_LISTE, String(stelle).split("/")[0]);
  return { sammel, kommentare: kommentareDer(sammel, stelle, api), stelleOwner: String(stelle).split("/")[0] };
}

/** Einstieg. `deps` (Tests): `ladeConfig(wurzel)`, `api` (Standard `ghJson`), `log`, `err`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { ladeConfig, api, log, err } = { ...STANDARD, ...deps };
  const { werte, fehler } = flagsLesen(argv, { json: { type: "boolean" }, wurzel: { type: "string" } });
  if (fehler) {
    err(`${fehler.text}\n${AUFRUF}`);
    return AUFRUF_EXIT;
  }
  let config;
  try {
    config = ladeConfig(resolve(werte.wurzel ?? process.cwd()));
  } catch (e) {
    err(`::error::offene-punkte: Projekt-Config nicht lesbar: ${fehlerText(e)}\nFix: --wurzel auf ein Projekt mit Projekt-Config zeigen lassen`);
    return AUFRUF_EXIT;
  }
  const sicht = sammleSicht({ config, api });
  log(werte.json === true ? alsJson(sicht) : alsText(sicht));
  return exitCode(sicht);
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
