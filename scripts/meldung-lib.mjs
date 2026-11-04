/**
 * Meldungen an die Meldestelle (factory#153): der eine Weg, auf dem ein Bezieher Harness-Befunde an sein Eingangs-Repo schickt (Schlüssel `meldestelle`
 * der Projekt-Config, Standard das Repo des Boards mit Rolle `factory`). Drei Bausteine, alle pur bis auf die Prüfung:
 *  - `factoryStand`/`meldungsText`: jede Meldung trägt als letzte Zeile den Factory-Stand aus `.factory/sync-stand.json` (Tag und Commit); ohne Sync-Stand
 *    (das Repo ist selbst upstream) bleibt der Text unverändert, ein unlesbarer Stand sperrt das Senden (`bereiteMeldung`: keine Meldung ohne Herkunftsangabe, Fix-Zeile nennt die Datei).
 *  - `textSauber`: startet `check-internalrefs.mjs --text` als Kindprozess; nur Exit 0 ist sauber, alles andere (Treffer, Aufruffehler, Signal, Startfehler)
 *    sperrt das Senden (fail-closed). Das Skript nennt den Begriff nie.
 *  - `meldestelleToken`: das Token gegen die Meldestelle (`MELDESTELLE_TOKEN`, Rückfall `PROJECT_TOKEN`); das eigene Repo braucht keins.
 * `bereiteMeldung` ist der Einstieg für alle Schreiber (`melden.mjs`, `harness-doctor-melden.mjs`, `spezifikation.mjs gescheitert`): kein Treffer, kein Post.
 * Der Wächter in `test/meldung-lib.test.ts` verlangt, dass jedes Skript, das `postZeilen` aufruft, `bereiteMeldung` nutzt; Grenze: direkte Kommentar-Posts zur
 * Ticket-Pflege und Doku-Snippets fasst er nicht. Kein Import von `board-lib`/`inbox-lib` (Zyklus): Repo und Token reicht der Aufrufer herein.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tokenFuerZiel } from "./gh-cli.mjs";
import { gleichesRepo } from "./repo-form.mjs";
import { STAND_PFAD, liesSyncStand } from "./sync-stand-lib.mjs";

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRUEFER = join(WURZEL, "scripts", "check-internalrefs.mjs");

/** Pur: die Stand-Zeile (`factory: v0.6.0 (abc1234)`) zu einem Sync-Stand `{ zustand, stand }` (`liesSyncStand`); `null` ohne Sync-Stand (kein Bezieher). */
export function factoryStand({ zustand, stand }) {
  if (zustand === "fehlt") return null;
  if (zustand !== "ok") return "factory: unbekannt (Sync-Stand unlesbar)";
  const quelle = stand?.quelle ?? {};
  const tag = typeof quelle.tag === "string" && quelle.tag !== "" ? quelle.tag : "ohne Tag";
  const commit = typeof quelle.commit === "string" && quelle.commit !== "" ? quelle.commit.slice(0, 7) : "unbekannt";
  return `factory: ${tag} (${commit})`;
}

/** Pur: der Kommentartext aus den Zeilen und der Stand-Zeile (`null` = ohne Fußzeile). */
export const meldungsText = (zeilen, stand) => (stand === null ? zeilen.join("\n") : `${zeilen.join("\n")}\n\n${stand}`);

/** Pur: Token gegen die Meldestelle `stelle`. Das eigene Repo (`eigenes`) braucht keins (`undefined` = Standard-`GH_TOKEN`); ein fremdes `MELDESTELLE_TOKEN`, sonst `PROJECT_TOKEN`. */
export function meldestelleToken({ stelle, eigenes, env }) {
  if (gleichesRepo(stelle, eigenes)) return undefined;
  return env.MELDESTELLE_TOKEN || tokenFuerZiel({ ziel: stelle, eigenes, env });
}

/** `check-internalrefs --text` als Kindprozess; nur Exit 0 ist sauber. `exec` ist die Test-Naht (Standard `spawnSync`). */
export function textSauber(text, exec = spawnSync) {
  const res = exec(process.execPath, [PRUEFER, "--text"], { input: text, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"], cwd: WURZEL });
  return res?.error === undefined && res?.signal == null && res?.status === 0;
}

/**
 * Die Meldung zu den Zeilen: `{ ok: true, text }` oder `{ ok: false, grund }`, wenn die Sperrprüfung anschlägt. `pruefe(text)` (Standard `textSauber`) sieht den
 * ganzen Text samt Stand-Zeile; `stand` ist die Stand-Zeile (`null`: keine; Standard: aus `.factory/sync-stand.json` unter `wurzel`, ist die Datei dann unlesbar, wird nichts gesendet).
 */
export function bereiteMeldung(zeilen, { wurzel = WURZEL, pruefe = textSauber, stand = undefined } = {}) {
  let zeile = stand;
  if (zeile === undefined) {
    const gelesen = liesSyncStand(wurzel);
    if (gelesen.zustand === "kaputt") return { ok: false, grund: `Meldung nicht gesendet: ${STAND_PFAD} ist nicht lesbar (kein JSON-Objekt), die Meldung hätte keine Herkunftsangabe
Fix: die Datei reparieren (git checkout -- ${STAND_PFAD} oder factory-update erneut ausführen)` };
    zeile = factoryStand(gelesen);
  }
  const text = meldungsText(zeilen, zeile);
  if (!pruefe(text)) return { ok: false, grund: "Meldung nicht gesendet: check-internalrefs --text meldet einen Treffer\nFix: die Zeile neutral formulieren (die Sache benennen, keine internen Namen)" };
  return { ok: true, text };
}
