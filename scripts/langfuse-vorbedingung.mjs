#!/usr/bin/env node
/* Langfuse-Vorbedingung (#1663 L36): ohne erreichbares Langfuse startet kein Entwicklungslauf, sonst wird nichts getrackt.
 *
 *   node scripts/langfuse-vorbedingung.mjs                 prüft GET <Langfuse>/api/public/health; Exit 0 = erreichbar, 1 = aus, 2 = Aufruffehler
 *   node scripts/langfuse-vorbedingung.mjs --sessionstart  SessionStart-Hook: Exit immer 0, bei Ausfall steht die Warnung als JSON auf stdout (`systemMessage` für die Nutzerin, `additionalContext` für die Session)
 *   node scripts/langfuse-vorbedingung.mjs --json         maschinenlesbar für das Cockpit: stdout `{"erreichbar":bool,"grund":string|null}`, bei erreichbarem Langfuse dazu `mcp`; Exit folgt nur der Health-Prüfung (0 erreichbar, 1 aus; ein getrennter MCP bleibt 0), 2 bei Aufruffehler; nicht mit --sessionstart kombinierbar (Exit 2)
 *
 * Aufrufer: der Ticket-Skill (Schritt 0); bewusst NICHT im Board-Takt.
 * MCP-Verbindung der Session (factory#323 L1/L7/L18): der Langfuse-MCP verbindet nur beim Session-Start, Health allein sagt darüber nichts. Nach grüner Health (Standard- und --json-Modus, nicht bei --sessionstart: Race beim Start) wertet das Skript
 * die Logs `mcp-logs-langfuse` der letzten 24 h aus (Lib mcp-log-lib.mjs): getrennt (letzter Verbindungsversuch fehlgeschlagen) → Exit 1 mit Hinweis `/mcp` → langfuse neu verbinden oder Session neu starten; bei abweichender MCP-URL (Host/Port) nennt der Hinweis das.
 * Die Session-ID wechselt nach /clear oder Resume (Prozess und Log-Datei bleiben), Sub-Agenten teilen sie: Ohne eigenen `Starting connection` zählt die Log-Datei mit eigenen Zeilen (`prozess`); ohne jede eigene Zeile der jüngste Versuch im Projekt (Rückfall auf eine fremde Session: getrennt bleibt getrennt, verbunden wird nicht prüfbar). Nur unter Claude Code (`CLAUDECODE=1`); sonst, ohne Log oder bei Lesefehler steht „nicht prüfbar (Grund)“ auf stderr, Exit 0. `--json` bekommt additiv das Feld `mcp` und behält den Exit der Health-Prüfung (Cockpit-Vertrag).
 * Adresse: `LANGFUSE_BASE_URL` (Umgebung, sonst Plugin-Optionen der User-Settings via `basisUrlAus` aus langfuse-zugang.mjs, nie Secret-Dateien), sonst http://localhost:3000. Datenschutz (ADR 0019): zeigt die Basis-URL nicht auf Loopback (localhost, *.localhost, 127.0.0.1, ::1), steht „Datenschutz: LANGFUSE_BASE_URL zeigt auf <host> (nicht lokal, ADR 0019)“ (nur der Host) auf stderr, bei --sessionstart in der systemMessage, bei --json als Feld `basisLokal`; der Exit ändert sich nie (Cockpit-Vertrag). Unparsebar gilt als nicht lokal.
 * Reines Node-Skript (nur Builtins); die Bewertung ist pur, fetch wird injiziert. */
import { homedir } from "node:os";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { basisUrlAus, langfuseBasisUrl } from "./langfuse-zugang.mjs";
import { istArbeitsplatzGeladen, leseLogDateien, logBasis, mcpVerbindung, serverOrdner, urlAbweichung } from "./mcp-log-lib.mjs";
import { FRIST_MS, pruefeLangfuse } from "./langfuse-health.mjs";

const HINWEIS = "Langfuse aus, bitte starten (lokal: Rancher Desktop prüfen, notfalls `rdctl shutdown` und `rdctl start`, FAQ „Langfuse lokal aus“).";

/** Host einer Basis-URL, unparsebar: `null`. Pur. */
function hostVon(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Zeigt die Basis-URL auf Loopback (localhost, *.localhost, 127.0.0.1, ::1)? Unparsebar: false (fail-closed). Pur. */
export function basisUrlLokal(url) {
  const host = hostVon(url);
  return host !== null && (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]");
}

/** Datenschutz-Hinweis für ein nicht lokales Ziel (nur Host, nie Pfad, Query oder Keys). Pur. */
const datenschutzHinweis = (url) => `Datenschutz: LANGFUSE_BASE_URL zeigt auf ${hostVon(url) ?? "ein unbekanntes Ziel"} (nicht lokal, ADR 0019)`;

const MCP_FENSTER_MS = 24 * 3600 * 1000;

/** JSONL-Zeilen der Langfuse-MCP-Logs des Projekts (Hauptcheckout und Worktrees) der letzten 24 h, je Log-Datei eine Liste; kein Log-Ordner: `null`. */
function langfuseZeilen({ env, home, jetzt, wurzel }) {
  const basis = logBasis({ plattform: process.platform, env, home });
  const dateien = leseLogDateien({ basis, wurzel, seitMs: jetzt - MCP_FENSTER_MS, mitArbeitsplatz: istArbeitsplatzGeladen(), ordnerFilter: (o) => o === serverOrdner("langfuse") });
  return dateien?.map((d) => d.zeilen) ?? null;
}

const nichtPruefbar = (grund) => ({ status: "nicht-pruefbar", grund });

/**
 * Urteil über die Langfuse-MCP-Verbindung dieser Session (`{ status, grund, … }`, Form wie `mcpVerbindung` aus mcp-log-lib.mjs, bei `getrennt` samt `abweichung`).
 * Nur unter Claude Code (`CLAUDECODE=1`, die Logs sind dessen Interna); sonst, ohne Log oder bei einem Lesefehler `nicht-pruefbar` mit Grund, nie eine Sperre. `lesen` liefert die Zeilen (flach oder je Log-Datei eine Liste) oder `null`.
 */
export function mcpUrteil({ env, basisUrl: basis, lesen, jetzt }) {
  if (env.CLAUDECODE !== "1") return nichtPruefbar("keine Claude-Code-Session");
  let zeilen;
  try {
    zeilen = lesen();
  } catch {
    return nichtPruefbar("MCP-Log nicht lesbar");
  }
  if (!zeilen) return nichtPruefbar("kein MCP-Log gefunden");
  const dateien = zeilen.every(Array.isArray) ? zeilen : undefined;
  const u = mcpVerbindung(dateien ? dateien.flat() : zeilen, { sessionId: env.CLAUDE_CODE_SESSION_ID, seit: new Date(jetzt - MCP_FENSTER_MS).toISOString(), dateien });
  return u.status === "getrennt" ? { ...u, abweichung: urlAbweichung(u.url, basis) } : u;
}

/** Hinweis bei fehlender Verbindung: Code und Zeit, Weg zur Reparatur, bei Rückfall und abweichender Adresse der jeweilige Zusatz. Pur. */
function mcpHinweis(u) {
  const zusatz = [
    u.quelle === "rueckfall" ? "Diese Session hat keinen eigenen Verbindungsstart im Log, bewertet wurde der jüngste im Projekt." : "",
    u.abweichung ? `${u.abweichung}.` : "",
  ].filter(Boolean);
  return [`Langfuse-MCP-Verbindung dieser Session fehlt (${u.code}, ${u.zeit}): \`/mcp\` → langfuse neu verbinden oder Session neu starten, erst dann Ticket starten.`, ...zusatz].join(" ");
}

/** Exit bei erreichbarem Langfuse: getrennt → 1 mit Hinweis (mit `--json` Exit 0, das Urteil steht im Feld `mcp`), nicht prüfbar → 0 mit einer Zeile (außer `--json`), sonst 0. */
function mcpAbschluss(u, json, err) {
  if (u.status === "getrennt") {
    if (!json) err(mcpHinweis(u));
    return json ? 0 : 1; // --json: Exit bleibt die Health-Aussage (Cockpit-Vertrag `erreichbar === (Exit 0)`), das Urteil steht im Feld `mcp`
  }
  if (u.status === "nicht-pruefbar" && !json) err(`Langfuse-MCP-Verbindung der Session nicht prüfbar (${u.grund}).`);
  return 0;
}

/** MCP-Prüfung bei erreichbarem Langfuse: Urteil, bei `--json` als Feld `mcp`, Exit nach `mcpAbschluss`. `mcpZeilen` und `jetzt` sind Naht für Tests. */
function mcpLauf({ env, home, baseUrl, json, out, err, mcpZeilen, jetzt = Date.now() }) {
  const basisLokal = basisUrlLokal(baseUrl);
  const lesen = mcpZeilen ?? (() => langfuseZeilen({ env, home, jetzt, wurzel: env.CLAUDE_PROJECT_DIR || process.cwd() }));
  const mcp = mcpUrteil({ env, basisUrl: baseUrl, lesen, jetzt });
  if (json) out(JSON.stringify({ erreichbar: true, grund: null, basisLokal, mcp }));
  if (!json && !basisLokal) err(datenschutzHinweis(baseUrl));
  return mcpAbschluss(mcp, json, err);
}

const USAGE = "Aufruf: node scripts/langfuse-vorbedingung.mjs [--sessionstart | --json]";

/** Liest den Aufruf (`--sessionstart`, `--json`): `{ sessionstart, json }` oder `{ fehler }` (Text samt Aufrufzeile). Pur. */
function aufrufLesen(argv) {
  const { werte, fehler } = flagsLesen(argv, { sessionstart: { type: "boolean" }, json: { type: "boolean" } });
  const text = fehler?.text ?? (werte.sessionstart && werte.json ? "--json und --sessionstart schließen sich aus" : null);
  return text ? { fehler: `${text}. ${USAGE}` } : { sessionstart: werte.sessionstart === true, json: werte.json === true };
}

/** Ausgabe und Exit ohne MCP-Prüfung (Ausfall, `--json`, `--sessionstart`): Exit 0 erreichbar, 1 aus (`--sessionstart` immer 0); der Datenschutz-Hinweis ändert den Exit nie. */
function ausgabe({ urteil, baseUrl, sessionstart, json, out, err }) {
  const basisLokal = basisUrlLokal(baseUrl);
  if (json) {
    out(JSON.stringify({ erreichbar: urteil.ok, grund: urteil.ok ? null : urteil.grund, basisLokal }));
    return urteil.ok ? 0 : 1;
  }
  const datenschutz = basisLokal ? "" : datenschutzHinweis(baseUrl);
  if (sessionstart) {
    const teile = [urteil.ok ? "" : `WARNUNG Langfuse-Vorbedingung: ${urteil.grund}. ${HINWEIS} Ohne Langfuse startet kein Ticket.`, datenschutz].filter(Boolean);
    if (teile.length === 0) return 0;
    const warnung = teile.join(" ");
    out(JSON.stringify({ systemMessage: warnung, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: warnung } }));
    return 0;
  }
  if (urteil.ok) return 0;
  err(`${urteil.grund}. ${HINWEIS}`);
  if (datenschutz) err(datenschutz);
  return 1;
}

export async function main(argv = process.argv.slice(2), env = process.env, out = console.log, err = console.error, { fetchImpl = fetch, fristMs = FRIST_MS, home = homedir(), lies, ...mcpOptionen } = {}) {
  const aufruf = aufrufLesen(argv);
  if (aufruf.fehler) {
    err(aufruf.fehler);
    return AUFRUF_EXIT;
  }
  const { sessionstart, json } = aufruf;
  const baseUrl = langfuseBasisUrl({ LANGFUSE_BASE_URL: basisUrlAus(env, home, lies) });
  const urteil = await pruefeLangfuse({ baseUrl, fetchImpl, fristMs });
  if (urteil.ok && !sessionstart) return mcpLauf({ env, home, baseUrl, json, out, err, ...mcpOptionen });
  return ausgabe({ urteil, baseUrl, sessionstart, json, out, err });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
