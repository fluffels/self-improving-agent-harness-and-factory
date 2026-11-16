#!/usr/bin/env node
/**
 * Auslöser der Token-Analyse (factory#578, Teil 8/9 von factory#518).
 *
 *   node scripts/token-analyse-ausloesen.mjs --anlass <monatlich|manuell|kosten> [--grund <text>] [--dry-run]
 *   node scripts/token-analyse-ausloesen.mjs --fortschreiben [--heute JJJJ-MM-TT]
 *
 * Ist ein Analyse-Ticket offen (Titel enthält `💸 Token-Analyse` oder Body-Zeile `<!-- token-analyse -->`), gibt es nur einen Kommentar mit dem
 * Anlass (und den Marker im Titel, falls er fehlt); sonst wird ein Ticket angelegt (Label `labels.harness`) und per
 * `board-place.mjs --notfall token-analyse --top` ganz oben einsortiert. Der Body trägt den Wiedervorlage-Marker des anstehenden Monatseintrags,
 * damit `wiedervorlage.mjs` kein zweites Ticket anlegt. `--fortschreiben` (Skill-Schluss) löscht den Monatseintrag und schreibt den nächsten.
 * Einstieg für factory#516 (Token-Budget je Ticket): `--anlass kosten --grund "<ticket, wert>"`, nie ein Abbruch des Laufs.
 * FABRIK-EIGEN: nie an Bezieher verteilt, bricht dort ab (Exit 4). Doku: docs/ticket-reihenfolge.md › Token-Analyse auslösen.
 * Exit 0 ok, 1 gh- oder Dateifehler, 2 Aufruffehler, 4 Abbruch im Bezieher.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { ladeProjektConfig, labelAus } from "./projekt-config-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { ANLAESSE, fortschreiben, istDatum, planeAusloesung } from "./token-analyse-ausloesen-lib.mjs";

const REPO_WURZEL = fileURLToPath(new URL("..", import.meta.url));
const DATEI = fileURLToPath(new URL("../.github/wiedervorlagen.json", import.meta.url));
const BOARD_PLACE = fileURLToPath(new URL("./board-place.mjs", import.meta.url));

export const aufrufHilfe = () =>
  "Aufruf: node scripts/token-analyse-ausloesen.mjs --anlass <monatlich|manuell|kosten> [--grund <text>] [--dry-run]\n" +
  "       node scripts/token-analyse-ausloesen.mjs --fortschreiben [--heute JJJJ-MM-TT]";

/** Pur: liest die Argumente; `{ fehler }` bei einem Aufruffehler. */
export function parseArgs(argv) {
  const r = flagsLesen(argv, { anlass: { type: "string" }, grund: { type: "string" }, "dry-run": { type: "boolean" }, fortschreiben: { type: "boolean" }, heute: { type: "string" } });
  if (r.fehler) return { fehler: r.fehler.text };
  const w = r.werte;
  if (w.fortschreiben) {
    if (w.anlass !== undefined || w.grund !== undefined || w["dry-run"]) return { fehler: "--fortschreiben verträgt sich nicht mit --anlass, --grund und --dry-run" };
    if (w.heute !== undefined && !istDatum(w.heute)) return { fehler: `--heute ist kein gültiges Datum (JJJJ-MM-TT): ${w.heute}` };
    return { modus: "fortschreiben", heute: w.heute };
  }
  if (w.heute !== undefined) return { fehler: "--heute gilt nur mit --fortschreiben" };
  if (w.anlass === undefined) return { fehler: "--anlass fehlt" };
  if (!ANLAESSE.includes(w.anlass)) return { fehler: `unbekannter Anlass „${w.anlass}“ (erlaubt: ${ANLAESSE.join(", ")})` };
  return { modus: "ausloesen", anlass: w.anlass, grund: w.grund, trocken: Boolean(w["dry-run"]) };
}

const standardGh = {
  offene: () => ghJson(["issue", "list", "--state", "open", "--limit", "1000", "--json", "number,title,body"]),
  text: (args) => ghText(args),
  platziere: (nr) => execFileSync(process.execPath, [BOARD_PLACE, "--notfall", "token-analyse", "--top", String(nr)], { stdio: "inherit" }),
  label: () => labelAus(ladeProjektConfig(), "harness"),
  lies: () => JSON.parse(readFileSync(DATEI, "utf8")),
  schreibe: (liste) => writeFileSync(DATEI, `${JSON.stringify(liste, null, 2)}\n`),
};

function taktFortschreiben(opts, { gh, heute, log }) {
  const liste = fortschreiben(gh.lies(), opts.heute ?? heute);
  gh.schreibe(liste);
  log(`Takt fortgeschrieben: ${liste.filter((e) => e.art === "analyse-takt" && e.id.startsWith("token-analyse-")).map((e) => `${e.id} (${e.faellig})`).join(", ")}`);
  return 0;
}

function kommentiere(plan, trocken, { gh, log }) {
  log(`${trocken ? "[dry-run] würde kommentieren" : "Kommentiere"}: #${plan.nummer} (${plan.kommentar})`);
  if (plan.titelNeu) log(`${trocken ? "[dry-run] würde den Titel setzen" : "Setze Titel"}: ${plan.titelNeu}`);
  if (trocken) return 0;
  if (plan.titelNeu) gh.text(["issue", "edit", String(plan.nummer), "--title", plan.titelNeu]);
  gh.text(["issue", "comment", String(plan.nummer), "--body", plan.kommentar]);
  return 0;
}

/** Ein Lauf mit eingespeisten Nähten (`deps.gh`: offene, text, platziere, label, lies, schreibe); liefert den Exit-Code. */
export function lauf(opts, { gh = standardGh, heute = new Date().toISOString().slice(0, 10), log = console.log, err = console.error } = {}) {
  if (opts.modus === "fortschreiben") return taktFortschreiben(opts, { gh, heute, log });
  const plan = planeAusloesung({ offene: gh.offene(), anlass: opts.anlass, heute, eintraege: gh.lies(), grund: opts.grund });
  if (plan.hinweis) log(`::warning::${plan.hinweis}`);
  if (plan.art === "kommentieren") return kommentiere(plan, opts.trocken, { gh, log });
  if (opts.trocken) {
    log(`[dry-run] würde anlegen: ${plan.titel}`);
    return 0;
  }
  const url = gh.text(["issue", "create", "--title", plan.titel, "--label", gh.label(), "--body", plan.body]).trim();
  const nr = Number(url.split("/").pop());
  log(`Angelegt: #${nr}`);
  try {
    gh.platziere(nr);
  } catch (e) {
    err(`Board-Position für #${nr} nicht gesetzt: ${fehlerText(e)}`);
    return 1;
  }
  return 0;
}

/** Einstieg: die Bezieher-Sperre steht vor den Argumenten. `deps` (Tests): `bezieher`, `gh`, `heute`, `log`, `err`. Rückgabe: Exit-Code. */
export function main(argv = process.argv.slice(2), { bezieher = istBezieher(process.cwd()) || istBezieher(REPO_WURZEL), ...deps } = {}) {
  const err = deps.err ?? console.error;
  if (bezieher) {
    err("token-analyse-ausloesen ist fabrik-eigen und läuft nicht in einem Bezieher.");
    return 4;
  }
  const opts = parseArgs(argv);
  if (opts.fehler) {
    err(`${opts.fehler}\n${aufrufHilfe()}`);
    return AUFRUF_EXIT;
  }
  try {
    return lauf(opts, deps);
  } catch (e) {
    err(`token-analyse-ausloesen: ${fehlerText(e)}`);
    return 1;
  }
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
