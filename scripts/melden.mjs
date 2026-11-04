#!/usr/bin/env node
/* Meldet Harness-Befunde an die Meldestelle (factory#153): jede Zeile wird ein Eintrag im jüngsten ungeclaimten Harness-Sammelticket der Meldestelle
 * (Schlüssel `meldestelle` der Projekt-Config, Standard das Repo des Boards mit Rolle `factory`), mit dem Factory-Stand als Fußzeile. Vor dem Senden läuft
 * `check-internalrefs --text`; bei einem Treffer wird nichts gesendet.
 *
 *   node scripts/melden.mjs --zeile "<Befund>" [--zeile "<Befund>" …] [--dry-run]
 *
 * Eine Zeile ohne Listenpräfix bekommt `- [ ] `. Exit 0: gesendet (bzw. Trockenlauf); 1: Treffer der Sperrprüfung, kein ungeclaimtes Sammelticket oder Post
 * fehlgeschlagen (jeweils mit Fix); 2: Aufruf- oder Config-Fehler. Nur Harness-Befunde gehören hierher; Projekt-Befunde bleiben im eigenen Repo,
 * Sicherheitsbefunde laufen über SECURITY.md (docs/erstbezug.md › Meldestelle). Logik pur in `meldung-lib.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fehlerText, ghJson, schreibrechtText } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeBoardLibs } from "./inbox-start-lib.mjs";
import { bereiteMeldung, meldestelleToken } from "./meldung-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUFRUF = 'Aufruf: node scripts/melden.mjs --zeile "<Befund>" [--zeile "<Befund>" …] [--dry-run]';

/** Pur: die Zeile als Listenpunkt `- [ ] …` (ein vorhandenes Präfix `- [ ] ` bleibt, nie doppelt); Zeilenumbrüche werden Leerzeichen. */
export const alsListenpunkt = (zeile) => {
  const einzeilig = String(zeile).replace(/\s*\r?\n\s*/g, " ").trim();
  return /^- \[ \] /.test(einzeilig) ? einzeilig : `- [ ] ${einzeilig}`;
};

/** Einstieg. `deps` (Tests): `ladeConfig`, `ladeLibs`, `env`, `log`, `err`, `bereite` (Standard `bereiteMeldung`), `api` (Standard `ghJson`, mit Token der Meldestelle). Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), { ladeConfig = () => ladeProjektConfig({ rootDir: WURZEL }), ladeLibs = ladeBoardLibs, env = process.env, log = console.log, err = console.error, bereite = (zeilen) => bereiteMeldung(zeilen, { wurzel: WURZEL }), api = ghJson } = {}) {
  const { werte, fehler } = flagsLesen(argv, { zeile: { type: "string", multiple: true }, "dry-run": { type: "boolean" } });
  if (fehler || !werte.zeile?.length) {
    err(`${fehler?.text ?? "--zeile fehlt"}\n${AUFRUF}`);
    return AUFRUF_EXIT;
  }
  let libs;
  try {
    ladeConfig();
    libs = await ladeLibs();
  } catch (e) {
    err(`::error::melden: Projekt-Config nicht lesbar: ${fehlerText(e)}`);
    return AUFRUF_EXIT;
  }
  const meldung = bereite(werte.zeile.map(alsListenpunkt));
  if (!meldung.ok) {
    err(`::error::melden: ${meldung.grund}`);
    return 1;
  }
  const { MELDESTELLE, REPO, ladeSammelKontext, postZeilen, waehleSammelticket } = libs;
  const token = meldestelleToken({ stelle: MELDESTELLE, eigenes: REPO, env });
  try {
    const { offene } = ladeSammelKontext({ repo: MELDESTELLE, token });
    const nr = waehleSammelticket(offene, MELDESTELLE, (a) => api(a, { token }))?.number;
    if (!nr) {
      err(`::error::melden: kein ungeclaimtes Harness-Sammelticket in ${MELDESTELLE}\nFix: in der Fabrik node scripts/sammelticket-anlegen.mjs harness; im Bezieher die Zeile unter BEFUNDE im Bericht nennen`);
      return 1;
    }
    if (werte["dry-run"] === true) {
      log(`[dry-run] Meldung an ${MELDESTELLE}#${nr}:\n${meldung.text}`);
      return 0;
    }
    postZeilen(nr, meldung.text, MELDESTELLE, token);
    log(`Meldung in ${MELDESTELLE}#${nr} gepostet.`);
    return 0;
  } catch (e) {
    err(`::error::melden: Meldung nicht gesendet: ${schreibrechtText(e, MELDESTELLE) ?? fehlerText(e)}\nFix: Token mit Issues-Recht an ${MELDESTELLE} (MELDESTELLE_TOKEN oder gh-Login) prüfen`);
    return 1;
  }
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
