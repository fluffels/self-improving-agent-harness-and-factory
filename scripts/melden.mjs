#!/usr/bin/env node
/* Meldet Harness-Befunde an die Meldestelle (factory#153): jede Zeile wird ein Eintrag im jüngsten ungeclaimten Harness-Sammelticket der Meldestelle
 * (Schlüssel `meldestelle` der Projekt-Config, Standard das Repo des Boards mit Rolle `factory`), mit dem Factory-Stand als Fußzeile. Vor dem Senden läuft
 * `check-internalrefs --text`; bei einem Treffer wird nichts gesendet.
 *
 *   node scripts/melden.mjs [--ziel harness|refactoring] --zeile "<Klasse>: <Befund> Beleg: <…>" [--zeile "…" …] [--dry-run]
 *
 * `--ziel refactoring` (factory#595): Code-Befunde außerhalb des Slices gehen ins jüngste ungeclaimte Refactoring-Sammelticket des eigenen Repos (Titel
 * „Refactoring (gesammelt)“, im Übergang auch der alte Titel), ohne Factory-Fußzeile, mit demselben Eingangsfilter und derselben Sperrprüfung. Ist das Ticket abgeschaltet
 * (`labels.refactoring: false`, in der Fabrik ohne Schlüssel) oder gilt kein Standard-an, endet der Lauf mit Exit 0 und „abgeschaltet“, nichts wird gepostet.
 *
 * Eine Zeile ohne Listenpräfix bekommt `- [ ] `. Format (Eingangsfilter, factory#269): `<Klasse>[ (<Schutzbereich>)]: <Befund> Beleg: <Fundstelle|Fehlerausgabe|Messwert>`
 * mit Klasse `Defekt|Blocker|Kosmetik|Hypothese`; Kosmetik und Hypothese bekommen `Verfall: <heute + 28 Tage>` ergänzt (Regel: AGENTS.md § Harness-Befunde sind Zeilen). Eine Zeile
 * ohne Klasse oder Beleg, mit unbekannter Klasse oder schon verfallen wird abgelehnt (Exit 2, nichts gepostet). Exit 0: gesendet (bzw. Trockenlauf); 1: Treffer der Sperrprüfung, kein ungeclaimtes Sammelticket oder Post
 * fehlgeschlagen (jeweils mit Fix); 2: Aufruf- oder Config-Fehler. Nur Harness-Befunde gehören hierher; Projekt-Befunde bleiben im eigenen Repo,
 * Sicherheitsbefunde laufen über SECURITY.md (docs/erstbezug.md (Fabrik) › Meldestelle). Logik pur in `meldung-lib.mjs`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fehlerText, ghJson, schreibrechtText } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeBoardLibs } from "./inbox-start-lib.mjs";
import { bereiteMeldung, keinSammelticketText, meldestelleZugang } from "./meldung-lib.mjs";
import { ladeProjektConfig, refactoringEinstellung } from "./projekt-config-lib.mjs";
import { mitVerfall, pruefeBefundZeile, REFACTORING_TITEL_AKZEPTIERT } from "./sammelticket-titel.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const STANDARD = { ladeConfig: () => ladeProjektConfig({ rootDir: WURZEL }), ladeLibs: ladeBoardLibs, env: process.env, log: console.log, err: console.error, bereite: (zeilen, opt) => bereiteMeldung(zeilen, { wurzel: WURZEL, ...opt }), api: ghJson, heute: () => new Date().toISOString().slice(0, 10), bezieher: () => istBezieher(WURZEL) };
const AUFRUF = 'Aufruf: node scripts/melden.mjs [--ziel harness|refactoring] --zeile "<Klasse>: <Befund> Beleg: <…>" [--zeile "…" …] [--dry-run]';

/** Pur: die Zeile als Listenpunkt `- [ ] …` (ein vorhandenes Präfix `- [ ] ` bleibt, nie doppelt); Zeilenumbrüche werden Leerzeichen. */
export const alsListenpunkt = (zeile) => {
  const einzeilig = String(zeile).replace(/\s*\r?\n\s*/g, " ").trim();
  return /^- \[ \] /.test(einzeilig) ? einzeilig : `- [ ] ${einzeilig}`;
};

const BEISPIEL = '--zeile "Defekt: <Befund> Beleg: <Fundstelle|Fehlerausgabe|Messwert>"';

/** Pur: prüft jede Zeile (Listenpunkt, Verfall ergänzt) gegen `pruefeBefundZeile`; `{ zeilen }` oder `{ fehler }` (Text mit Format und Beispiel). */
export function pruefeZeilen(roh, heute) {
  const zeilen = roh.map((z) => mitVerfall(alsListenpunkt(z), heute));
  const mangel = zeilen.map((z) => ({ z, r: pruefeBefundZeile(z, { heute }) })).find((m) => !m.r.ok);
  if (mangel === undefined) return { zeilen };
  return { fehler: `Zeile abgelehnt: ${mangel.r.fehler}\n  ${mangel.z}\nFormat: <Klasse>[ (<Schutzbereich>)]: <Befund> Beleg: <…> (AGENTS.md § Harness-Befunde sind Zeilen)\nBeispiel: ${BEISPIEL}` };
}

/** Pur: liest und prüft den Aufruf; `{ ziel, zeilen, trocken }` oder `{ fehler }` (fertiger Fehlertext, Exit 2). */
function leseAufruf(argv, heute) {
  const { werte, fehler } = flagsLesen(argv, { zeile: { type: "string", multiple: true }, ziel: { type: "string" }, "dry-run": { type: "boolean" } });
  const ziel = werte?.ziel ?? "harness";
  if (fehler || !["harness", "refactoring"].includes(ziel) || !werte.zeile?.length || werte.zeile.some((z) => z.trim() === "")) {
    return { fehler: `${fehler?.text ?? "--zeile fehlt, ist leer oder --ziel ist unbekannt"}\n${AUFRUF}` };
  }
  const geprueft = pruefeZeilen(werte.zeile, heute);
  if (geprueft.fehler) return { fehler: `::error::melden: ${geprueft.fehler}` };
  return { ziel, zeilen: geprueft.zeilen, trocken: werte["dry-run"] === true };
}

/** Einstieg. `deps` (Tests): `ladeConfig`, `ladeLibs`, `env`, `log`, `err`, `bereite(zeilen, { herkunft })` (Standard `bereiteMeldung`), `api` (Standard `ghJson`, mit Token der Meldestelle), `heute()` (Standard heutiges ISO-Datum), `bezieher()` (Standard `istBezieher`, nur für `--ziel refactoring`). Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { ladeConfig, ladeLibs, env, log, err, bereite, api, heute, bezieher } = { ...STANDARD, ...deps };
  const aufruf = leseAufruf(argv, heute());
  if (aufruf.fehler) {
    err(aufruf.fehler);
    return AUFRUF_EXIT;
  }
  const { ziel, zeilen, trocken } = aufruf;
  const refactoring = ziel === "refactoring";
  const start = await starte({ refactoring, ladeConfig, ladeLibs, bezieher, log });
  if (start.fehler) {
    err(`::error::melden: Projekt-Config nicht lesbar: ${start.fehler}`);
    return AUFRUF_EXIT;
  }
  if (start.libs === undefined) return 0;
  const { libs } = start;
  // Refactoring: eigenes Repo, keine Factory-Fußzeile, kein Rückfall auf die Meldestelle; Harness: Meldestelle samt Herkunft.
  const zugang = refactoring ? { stelle: libs.REPO, token: undefined, herkunft: null } : meldestelleZugang({ stelle: libs.MELDESTELLE, eigenes: libs.REPO, env });
  const meldung = bereite(zeilen, { ...(refactoring ? { stand: null } : {}), herkunft: zugang.herkunft, eigenes: libs.REPO });
  if (!meldung.ok) {
    err(`::error::melden: ${meldung.grund}`);
    return 1;
  }
  const optionen = { trocken, log, err, api, ...(refactoring ? { titel: REFACTORING_TITEL_AKZEPTIERT, art: "refactoring" } : {}) };
  return sende(libs, zugang, meldung.text, optionen);
}

/** Lädt Config und Libs; `{ libs }`, `{ fehler }` (Text) oder `{}` (Refactoring abgeschaltet: Hinweis ist geloggt, Exit 0). */
async function starte({ refactoring, ladeConfig, ladeLibs, bezieher, log }) {
  try {
    const config = ladeConfig();
    const aus = refactoring ? refactoringAus(config, bezieher()) : null;
    if (aus) {
      log(aus);
      return {};
    }
    return { libs: await ladeLibs() };
  } catch (e) {
    return { fehler: fehlerText(e) };
  }
}

/** Der Log-Text, wenn das Refactoring-Ziel abgeschaltet ist (`labels.refactoring: false`, in der Fabrik ohne Schlüssel), sonst `null`. */
function refactoringAus(config, bezieher) {
  const { an, quelle } = refactoringEinstellung(config, { bezieher });
  if (an) return null;
  if (quelle === "aus") return "refactoring: abgeschaltet (labels.refactoring: false), nichts gepostet";
  return "refactoring: abgeschaltet (kein Schlüssel labels.refactoring und kein Bezieher), nichts gepostet; Harness-Befunde gehen mit --ziel harness an die Meldestelle";
}

/** Postet `text` an das jüngste ungeclaimte Sammelticket (`titel`, Standard Harness) von `stelle`; Exit-Code wie `main`. */
function sende(libs, { stelle: MELDESTELLE, token }, text, { trocken, log, err, api, titel = undefined, art = "harness" }) {
  const { ladeSammelKontext, postZeilen, waehleSammelticket } = libs;
  try {
    const { offene } = ladeSammelKontext({ repo: MELDESTELLE, token, ...(titel ? { titel } : {}) });
    const nr = waehleSammelticket(offene, MELDESTELLE, (a) => api(a, { token }), titel)?.number;
    if (!nr) {
      err(`::error::melden: ${keinSammelticketText({ fuer: `in ${MELDESTELLE}`, art })}`);
      return 1;
    }
    if (trocken) {
      log(`[dry-run] Meldung an ${MELDESTELLE}#${nr}:\n${text}`);
      return 0;
    }
    postZeilen(nr, text, MELDESTELLE, token);
    log(`Meldung in ${MELDESTELLE}#${nr} gepostet.`);
    return 0;
  } catch (e) {
    err(`::error::melden: Meldung nicht gesendet: ${schreibrechtText(e, MELDESTELLE) ?? fehlerText(e)}\nFix: Token mit Issues-Recht an ${MELDESTELLE} (MELDESTELLE_TOKEN oder gh-Login) prüfen`);
    return 1;
  }
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
