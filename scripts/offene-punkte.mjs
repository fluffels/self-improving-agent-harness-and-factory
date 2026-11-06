#!/usr/bin/env node
/* Offene Punkte der Maintainerin (factory#152): listet aus GitHub, wofür sie gebraucht wird: `entscheidung-noetig`-Hand-offs (Label `labels.entscheidung`),
 * Issues und PRs mit dem Festgefahren-Label, nicht eintragbare Befunde und Bezieher-Befunde, je mit Link. Labels und Repo kommen aus der Projekt-Config.
 *
 *   node scripts/offene-punkte.mjs [--json] [--wurzel <pfad>]
 *
 * Exit 0: alle Gruppen prüfbar (auch mit offenen Punkten); 1: mindestens eine Gruppe NICHT PRÜFBAR (nie leer und grün); 2: Aufruf- oder Config-Fehler (mit Fix).
 * Logik und JSON-Vertrag: `offene-punkte-lib.mjs`; Mechanik und Gruppen: docs/ticket-reihenfolge.md › Offene Punkte der Maintainerin.
 */
import { resolve } from "node:path";
import { fehlerText, ghJson } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flach, issueKommentare } from "./fremdtext-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { alsJson, alsText, baueSicht, exitCode, sammeltickets } from "./offene-punkte-lib.mjs";

const AUFRUF = "Aufruf: node scripts/offene-punkte.mjs [--json] [--wurzel <pfad>]";
/** Die Titel der Sammeltickets kommen lazy aus `board-lib` (sein Import lädt die Config des Repos und bricht bei einem Fehler ab). */
const ladeSammelTitel = async () => (await import("./board-lib.mjs")).SAMMELTICKET_TITEL_LISTE;
const STANDARD = { ladeConfig: (wurzel) => ladeProjektConfig({ rootDir: wurzel }), api: ghJson, ladeTitel: ladeSammelTitel, log: console.log, err: console.error };

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
async function sammleSicht({ config, api, ladeTitel }) {
  const repo = config.repo;
  let issues;
  try {
    issues = flach(api(["api", "--paginate", "--slurp", `repos/${repo}/issues?state=open&per_page=100`]));
  } catch (e) {
    issues = { fehler: fehlerText(e) };
  }
  if (!Array.isArray(issues)) return baueSicht({ config, issues });
  let sammel = null;
  try {
    sammel = sammeltickets(issues, await ladeTitel(), String(repo).split("/")[0]);
  } catch {
    sammel = null;
  }
  return baueSicht({ config, issues, sammel, kommentare: sammel === null ? new Map() : kommentareDer(sammel, repo, api) });
}

/** Einstieg. `deps` (Tests): `ladeConfig(wurzel)`, `api` (Standard `ghJson`), `ladeTitel`, `log`, `err`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { ladeConfig, api, ladeTitel, log, err } = { ...STANDARD, ...deps };
  const { werte, fehler } = flagsLesen(argv, { json: { type: "boolean" }, wurzel: { type: "string" } });
  if (fehler) {
    err(`${fehler.text}\n${AUFRUF}`);
    return AUFRUF_EXIT;
  }
  let config;
  try {
    config = ladeConfig(resolve(werte.wurzel ?? process.cwd()));
  } catch (e) {
    err(`::error::offene-punkte: Projekt-Config nicht lesbar: ${fehlerText(e)}\nFix: --wurzel auf ein Projekt mit .factory/projekt.json zeigen lassen`);
    return AUFRUF_EXIT;
  }
  const sicht = await sammleSicht({ config, api, ladeTitel });
  log(werte.json === true ? alsJson(sicht) : alsText(sicht));
  return exitCode(sicht);
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
