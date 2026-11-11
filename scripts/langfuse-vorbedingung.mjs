#!/usr/bin/env node
/* Langfuse-Vorbedingung (#1663 L36): ohne erreichbares Langfuse startet kein Entwicklungslauf, sonst wird nichts getrackt.
 *
 *   node scripts/langfuse-vorbedingung.mjs                 prüft GET <Langfuse>/api/public/health; Exit 0 = erreichbar, 1 = aus, 2 = Aufruffehler
 *   node scripts/langfuse-vorbedingung.mjs --sessionstart  SessionStart-Hook: Exit immer 0, bei Ausfall steht die Warnung als JSON auf stdout (`systemMessage` für die Nutzerin, `additionalContext` für die Session)
 *   node scripts/langfuse-vorbedingung.mjs --json         maschinenlesbar für das Cockpit: stdout `{"erreichbar":bool,"grund":string|null}`, Exit-Codes wie ohne Flag; nicht mit --sessionstart kombinierbar (Exit 2)
 *
 * Aufrufer: der Ticket-Skill (Schritt 0); bewusst NICHT im Board-Takt.
 * Bekannte Grenze: prüft nur /api/public/health, nicht die MCP-Verbindung der Session; die verbindet beim Session-Start vor Schritt 0 (Ausfall: mcp-ausfall.mjs).
 * Adresse: `LANGFUSE_BASE_URL` (Umgebung, sonst Plugin-Optionen der User-Settings via `basisUrlAus` aus langfuse-zugang.mjs, nie Secret-Dateien), sonst http://localhost:3000. Reines Node-Skript (nur Builtins); die Bewertung ist pur, fetch wird injiziert. */
import { homedir } from "node:os";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { basisUrlAus, langfuseBasisUrl } from "./langfuse-zugang.mjs";
import { istArbeitsplatzGeladen, leseLogDateien, logBasis, mcpVerbindung, serverOrdner, urlAbweichung } from "./mcp-log-lib.mjs";
import { FRIST_MS, HEALTH_PFAD, bewerteHealth, pruefeLangfuse } from "./langfuse-health.mjs";

export { FRIST_MS, HEALTH_PFAD, bewerteHealth, pruefeLangfuse };

const HINWEIS = "Langfuse aus, bitte starten (lokal: Rancher Desktop prüfen, notfalls `rdctl shutdown` und `rdctl start`, FAQ „Langfuse lokal aus“).";

/** Basis-URL aus der Umgebung ohne Schrägstrich am Ende. Pur. */
export const basisUrl = langfuseBasisUrl;

const MCP_FENSTER_MS = 24 * 3600 * 1000;

/** JSONL-Zeilen der Langfuse-MCP-Logs des Projekts (Hauptcheckout und Worktrees) der letzten 24 h; kein Log-Ordner: `null`. */
function langfuseZeilen({ env, home, jetzt, wurzel }) {
  const basis = logBasis({ plattform: process.platform, env, home });
  const dateien = leseLogDateien({ basis, wurzel, seitMs: jetzt - MCP_FENSTER_MS, mitArbeitsplatz: istArbeitsplatzGeladen(), ordnerFilter: (o) => o === serverOrdner("langfuse") });
  return dateien?.flatMap((d) => d.zeilen) ?? null;
}

const nichtPruefbar = (grund) => ({ status: "nicht-pruefbar", grund });

/**
 * Urteil über die Langfuse-MCP-Verbindung dieser Session (`{ status, grund, … }`, Form wie `mcpVerbindung` aus mcp-log-lib.mjs, bei `getrennt` samt `abweichung`).
 * Nur unter Claude Code (`CLAUDECODE=1`, die Logs sind dessen Interna); sonst, ohne Log oder bei einem Lesefehler `nicht-pruefbar` mit Grund, nie eine Sperre. `lesen` liefert die Zeilen oder `null`.
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
  const u = mcpVerbindung(zeilen, { sessionId: env.CLAUDE_CODE_SESSION_ID, seit: new Date(jetzt - MCP_FENSTER_MS).toISOString() });
  return u.status === "getrennt" ? { ...u, abweichung: u.url ? urlAbweichung(u.url, basis) : null } : u;
}

/** Hinweis bei fehlender Verbindung: Code und Zeit, Weg zur Reparatur, bei Rückfall und abweichender Adresse der jeweilige Zusatz. Pur. */
function mcpHinweis(u) {
  const zusatz = [
    u.quelle === "rueckfall" ? "Diese Session hat keinen eigenen Verbindungsstart im Log, bewertet wurde der jüngste im Projekt." : "",
    u.abweichung ? `${u.abweichung}.` : "",
  ].filter(Boolean);
  return [`Langfuse-MCP-Verbindung dieser Session fehlt (${u.code}, ${u.zeit}): \`/mcp\` → langfuse neu verbinden oder Session neu starten, erst dann Ticket starten.`, ...zusatz].join(" ");
}

/** Exit bei erreichbarem Langfuse: getrennt → 1 mit Hinweis, nicht prüfbar → 0 mit einer Zeile (außer `--json`, dort steht es im Feld `mcp`), sonst 0. */
function mcpAbschluss(u, json, err) {
  if (u.status === "getrennt") {
    if (!json) err(mcpHinweis(u));
    return 1;
  }
  if (u.status === "nicht-pruefbar" && !json) err(`Langfuse-MCP-Verbindung der Session nicht prüfbar (${u.grund}).`);
  return 0;
}

const USAGE = "Aufruf: node scripts/langfuse-vorbedingung.mjs [--sessionstart | --json]";

export async function main(argv = process.argv.slice(2), env = process.env, out = console.log, err = console.error, { fetchImpl = fetch, fristMs = FRIST_MS, home = homedir(), lies, mcpZeilen, jetzt = Date.now() } = {}) {
  const { werte, fehler } = flagsLesen(argv, { sessionstart: { type: "boolean" }, json: { type: "boolean" } });
  const aufrufFehler = fehler?.text ?? (werte.sessionstart && werte.json ? "--json und --sessionstart schließen sich aus" : null);
  if (aufrufFehler) {
    err(`${aufrufFehler}. ${USAGE}`);
    return AUFRUF_EXIT;
  }
  const sessionstart = werte.sessionstart === true;
  const baseUrl = basisUrl({ LANGFUSE_BASE_URL: basisUrlAus(env, home, lies) });
  const urteil = await pruefeLangfuse({ baseUrl, fetchImpl, fristMs });
  const json = werte.json === true;
  if (urteil.ok && !sessionstart) {
    const lesen = mcpZeilen ?? (() => langfuseZeilen({ env, home, jetzt, wurzel: env.CLAUDE_PROJECT_DIR || process.cwd() }));
    const mcp = mcpUrteil({ env, basisUrl: baseUrl, lesen, jetzt });
    if (json) out(JSON.stringify({ erreichbar: true, grund: null, mcp }));
    return mcpAbschluss(mcp, json, err);
  }
  if (json) {
    out(JSON.stringify({ erreichbar: urteil.ok, grund: urteil.ok ? null : urteil.grund }));
    return urteil.ok ? 0 : 1;
  }
  if (urteil.ok) return 0;
  const text = `${urteil.grund}. ${HINWEIS}`;
  if (sessionstart) {
    const warnung = `WARNUNG Langfuse-Vorbedingung: ${text} Ohne Langfuse startet kein Ticket.`;
    out(JSON.stringify({ systemMessage: warnung, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: warnung } }));
    return 0;
  }
  err(text);
  return 1;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
