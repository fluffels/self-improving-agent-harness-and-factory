#!/usr/bin/env node
/* Langfuse-Vorbedingung (#1663 L36): ohne erreichbares Langfuse startet kein Entwicklungslauf, sonst wird nichts getrackt.
 *
 *   node scripts/langfuse-vorbedingung.mjs                 prüft GET <Langfuse>/api/public/health; Exit 0 = erreichbar, 1 = aus, 2 = Aufruffehler
 *   node scripts/langfuse-vorbedingung.mjs --sessionstart  SessionStart-Hook: Exit immer 0, bei Ausfall steht die Warnung als JSON auf stdout (`systemMessage` für die Nutzerin, `additionalContext` für die Session)
 *   node scripts/langfuse-vorbedingung.mjs --json         maschinenlesbar für das Cockpit: stdout `{"erreichbar":bool,"grund":string|null}`, Exit-Codes wie ohne Flag; nicht mit --sessionstart kombinierbar (Exit 2)
 *
 * Aufrufer: der Ticket-Skill (Schritt 0); bewusst NICHT im Board-Takt.
 * MCP-Spur (factory#320 L4): der Langfuse-MCP verbindet nur beim Session-Start, Health allein sagt darüber nichts. Im Standardmodus prüft das Skript nach grüner Health die Logs `mcp-logs-langfuse` der letzten 24 h
 * (Zeilen mit `sessionId` = `$CLAUDE_CODE_SESSION_ID`, ab dem letzten `Starting connection`): Verbindungsfehler ohne späteren Erfolg → Exit 1 mit Hinweis `/mcp` → langfuse neu verbinden.
 * Nicht prüfbar (keine Session-ID, kein Log, Verbindungsstart unter anderer Session-ID, etwa nach Resume) heißt Exit 0, nie eine falsche Sperre; `--sessionstart` und `--json` bleiben bei der Health.
 * Adresse: `LANGFUSE_BASE_URL` (Umgebung, sonst Plugin-Optionen der User-Settings via `basisUrlAus` aus langfuse-zugang.mjs, nie Secret-Dateien), sonst http://localhost:3000. Reines Node-Skript (nur Builtins); die Bewertung ist pur, fetch wird injiziert. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hauptWurzelAus, ordnerSlug } from "./arbeitsplatz-lib.mjs";
import { umgebungsWert } from "./projekt-config-lib.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { basisUrlAus, langfuseBasisUrl } from "./langfuse-zugang.mjs";

export const HEALTH_PFAD = "/api/public/health";
export const FRIST_MS = 3000;
const HINWEIS = "Langfuse aus, bitte starten (lokal: Rancher Desktop prüfen, notfalls `rdctl shutdown` und `rdctl start`, FAQ „Langfuse lokal aus“).";

/** Urteil aus HTTP-Status oder Verbindungsfehler; ohne beides gilt es als nicht erreichbar. Pur. */
export function bewerteHealth({ status, fehler } = {}) {
  if (status === 200) return { ok: true, grund: "Langfuse erreichbar (HTTP 200)" };
  if (typeof status === "number") return { ok: false, grund: `Langfuse antwortet mit HTTP ${status}` };
  if (fehler) return { ok: false, grund: `Langfuse nicht erreichbar: ${fehler}` };
  return { ok: false, grund: "Langfuse nicht erreichbar: keine Antwort" };
}

/** Basis-URL aus der Umgebung ohne Schrägstrich am Ende. Pur. */
export const basisUrl = langfuseBasisUrl;

/** Fragt den Health-Endpunkt mit Frist ab und bewertet die Antwort. Wirft nie. */
export async function pruefeLangfuse({ baseUrl, fetchImpl = fetch, fristMs = FRIST_MS }) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), fristMs);
  try {
    const res = await fetchImpl(`${baseUrl}${HEALTH_PFAD}`, { signal: abbruch.signal });
    return bewerteHealth({ status: res.status });
  } catch (e) {
    if (abbruch.signal.aborted) return bewerteHealth({ fehler: `Timeout nach ${fristMs} ms` });
    return bewerteHealth({ fehler: e?.cause?.code ?? e?.code ?? e?.message ?? String(e) });
  } finally {
    clearTimeout(uhr);
  }
}

const MCP_FENSTER_MS = 24 * 3600 * 1000;
const MCP_FEHLER = /Connection failed|version negotiation probe failed|ECONNREFUSED/;

/** Zeitstempel und Netzcode der Zeile (`ECONNREFUSED` …); ohne Netzcode „Verbindungsfehler“. Pur. */
const fehlerZeile = (z) => ({ zeit: z.timestamp, code: /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)\b/.exec(z.debug)?.[1] ?? "Verbindungsfehler" });

/** Basisordner der Claude-Code-Logs je Plattform (`FACTORY_MCP_LOG_DIR` hat Vorrang), wie in mcp-ausfall.mjs; ein Einstiegsskript importiert nicht aus einem anderen. */
function logBasisOrdner({ env, home }) {
  const dir = umgebungsWert(env, "FACTORY_MCP_LOG_DIR");
  if (dir) return dir;
  if (process.platform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "claude-cli-nodejs", "Cache");
  if (process.platform === "darwin") return join(home, "Library", "Caches", "claude-cli-nodejs");
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "claude-cli-nodejs");
}

/**
 * Urteil über die MCP-Spur der Session aus den JSONL-Zeilen des Langfuse-MCP-Logs: ab dem letzten `Starting connection` der Session entscheidet das letzte Ergebnis
 * (`Successfully connected` = ok, Verbindungsfehler = nicht ok mit `{zeit, code}`). Fremde Session, keine Zeilen, keine Session-ID, Start ohne Ergebnis: `null` (nicht prüfbar). Kaputte Zeilen entfallen. Pur.
 */
export function bewerteMcpSpur(zeilen, sessionId) {
  if (!sessionId) return null;
  const eigene = [];
  for (const text of zeilen) {
    try {
      const z = JSON.parse(text);
      if (z?.sessionId === sessionId && typeof z.debug === "string") eigene.push(z);
    } catch {
      // kaputte Zeile überspringen
    }
  }
  const start = eigene.findLastIndex((z) => z.debug.startsWith("Starting connection"));
  if (start < 0) return null;
  const ergebnis = eigene.slice(start + 1).filter((z) => z.debug.startsWith("Successfully connected") || MCP_FEHLER.test(z.debug));
  const letzte = ergebnis.at(-1);
  if (!letzte) return null;
  if (letzte.debug.startsWith("Successfully connected")) return { ok: true };
  const { zeit, code } = fehlerZeile(letzte);
  return { ok: false, grund: `Langfuse-MCP verband nicht (${zeit}, ${code})`, zeit, code };
}

/** JSONL-Zeilen der Langfuse-MCP-Logs des Projekts (Hauptcheckout und Worktrees), nur Dateien der letzten 24 h; Pfade über die Helfer von mcp-ausfall.mjs. Wirft nie. */
export function mcpZeilenLesen({ env, home, jetzt, wurzel, fs = { readdirSync, statSync, readFileSync } }) {
  const basis = logBasisOrdner({ env, home });
  const haupt = ordnerSlug(hauptWurzelAus(wurzel));
  const zeilen = [];
  try {
    for (const ordner of fs.readdirSync(basis).filter((n) => n === haupt || n.startsWith(`${haupt}--claude-worktrees-`))) {
      const dir = join(basis, ordner, "mcp-logs-langfuse");
      for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
        if (fs.statSync(join(dir, f)).mtimeMs < jetzt - MCP_FENSTER_MS) continue;
        zeilen.push(...fs.readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean));
      }
    }
  } catch {
    // Log nicht lesbar: nicht prüfbar, keine Sperre
  }
  return zeilen;
}

/** Sperr-Urteil der MCP-Spur dieser Session (`ok:false`) oder `null`; ein werfender Leser ergibt `null`. */
function mcpSperre({ env, home, mcpZeilen, sessionstart }) {
  if (sessionstart || !env.CLAUDE_CODE_SESSION_ID) return null;
  const lesen = mcpZeilen ?? (() => mcpZeilenLesen({ env, home, jetzt: Date.now(), wurzel: process.cwd() }));
  try {
    const u = bewerteMcpSpur(lesen(), env.CLAUDE_CODE_SESSION_ID);
    return u?.ok === false ? u : null;
  } catch {
    return null;
  }
}

/** Exit bei erreichbarer Health: Sperre der MCP-Spur (mit Hinweis auf stderr) → 1, sonst 0. */
function mcpExit(spur, err) {
  if (!spur) return 0;
  err(`Langfuse erreichbar, aber der Langfuse-MCP dieser Session verband nicht (${spur.zeit}, ${spur.code}); \`/mcp\` → langfuse neu verbinden, dann erneut prüfen.`);
  return 1;
}

const USAGE = "Aufruf: node scripts/langfuse-vorbedingung.mjs [--sessionstart | --json]";

export async function main(argv = process.argv.slice(2), env = process.env, out = console.log, err = console.error, { fetchImpl = fetch, fristMs = FRIST_MS, home = homedir(), lies, mcpZeilen } = {}) {
  const { werte, fehler } = flagsLesen(argv, { sessionstart: { type: "boolean" }, json: { type: "boolean" } });
  const aufrufFehler = fehler?.text ?? (werte.sessionstart && werte.json ? "--json und --sessionstart schließen sich aus" : null);
  if (aufrufFehler) {
    err(`${aufrufFehler}. ${USAGE}`);
    return AUFRUF_EXIT;
  }
  const sessionstart = werte.sessionstart === true;
  const urteil = await pruefeLangfuse({ baseUrl: basisUrl({ LANGFUSE_BASE_URL: basisUrlAus(env, home, lies) }), fetchImpl, fristMs });
  if (werte.json === true) {
    out(JSON.stringify({ erreichbar: urteil.ok, grund: urteil.ok ? null : urteil.grund }));
    return urteil.ok ? 0 : 1;
  }
  if (urteil.ok) return mcpExit(mcpSperre({ env, home, mcpZeilen, sessionstart }), err);
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
