// Kein Einstieg, kein Direktaufruf (Konvention quellprojekt#1398): Lib für `scripts/mcp-ausfall.mjs` und `scripts/langfuse-vorbedingung.mjs`; Pfade und Lesen der Claude-Code-MCP-Logs
// `<Cache>/<Projekt-Slug>/mcp-logs-<Server>/<Start>.jsonl` (undokumentierte Interna, Zeilen `{debug|error, timestamp, sessionId, cwd}`) und die Bewertung einer Verbindung.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { hauptWurzelAus, istArbeitsplatz, ordnerSlug } from "./arbeitsplatz-lib.mjs";
import { ladeProjektConfig, umgebungsWert } from "./projekt-config-lib.mjs";

/** Netzabbruch-Code in einer Logzeile (`ECONNRESET`, `fetch failed`, `socket`) oder `""`. Pur. */
export function netzCode(text) {
  const m = /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE)\b|fetch failed|\bsocket\b/i.exec(text);
  if (!m) return "";
  return m[1] ?? m[0].toLowerCase();
}

/** Ordnername, wie Claude Code ihn aus einem Pfad bildet. Pur. */
export const slug = ordnerSlug;

/** Basisordner der Claude-Code-Logs je Plattform; `FACTORY_MCP_LOG_DIR` hat Vorrang. Liest den Altpräfix lazy aus der Config (Fehler egal). */
export function logBasis({ plattform, env, home }) {
  const dir = umgebungsWert(env, "FACTORY_MCP_LOG_DIR");
  if (dir) return dir;
  if (plattform === "win32") return join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "claude-cli-nodejs", "Cache");
  if (plattform === "darwin") return join(home, "Library", "Caches", "claude-cli-nodejs");
  return join(env.XDG_CACHE_HOME || join(home, ".cache"), "claude-cli-nodejs");
}

/**
 * Pfad des Hauptcheckouts zu einer Wurzel, die auch ein Worktree darunter sein darf (`.claude/worktrees/<name>`). Mit `mitArbeitsplatz` (Config mit Block `arbeitsplatz`)
 * ist es die Arbeitsplatz-Wurzel und der Worktree liegt unter `.claude/worktrees/<repo>/<name>`; ohne die Angabe lässt der Aufbau `<repo>/<name>` den Pfad unverändert (er wäre sonst nicht von einem tieferen Pfad zu unterscheiden). Pur.
 */
export const hauptWurzel = (wurzel, mitArbeitsplatz = false) => hauptWurzelAus(wurzel, mitArbeitsplatz ? "arbeitsplatz" : "eingebettet");

/** Hat die Config (oder, ohne Angabe, die geladene) einen Block `arbeitsplatz`? Wirft nie (ohne lesbare Config `false`). */
export const istArbeitsplatzGeladen = (config) => {
  try {
    return istArbeitsplatz(config ?? ladeProjektConfig({ pruefen: false }));
  } catch {
    return false;
  }
};

/** Projekt-Ordner (Hauptcheckout und seine Worktrees) unter den Namen des Basisordners; Suffix `""` = Hauptcheckout. `mitArbeitsplatz` wie bei `hauptWurzel`. Pur. */
export function projektOrdner(namen, wurzel, mitArbeitsplatz = false) {
  const haupt = slug(hauptWurzel(wurzel, mitArbeitsplatz));
  const praefix = `${haupt}--claude-worktrees-`;
  return namen.filter((n) => n === haupt || n.startsWith(praefix)).map((n) => ({ ordner: n, suffix: n.slice(haupt.length) }));
}

/** Log-Ordnername eines Servers. Pur. */
export const serverOrdner = (name) => `mcp-logs-${slug(name)}`;

const versuche = (f, rueckfall) => {
  try {
    return f();
  } catch {
    return rueckfall;
  }
};

/** Die `.jsonl`-Dateien eines Server-Ordners, die ab `seitMs` geschrieben wurden (mtime), als Zeilenlisten; unlesbare Dateien entfallen. */
function dateiZeilen(dir, seitMs) {
  const dateien = versuche(() => readdirSync(dir).filter((f) => f.endsWith(".jsonl")), []);
  return dateien.flatMap((f) => versuche(() => (statSync(join(dir, f)).mtimeMs < seitMs ? [] : [readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean)]), []));
}

/**
 * Log-Dateien des Projekts (Hauptcheckout und Worktrees) ab `seitMs` als `[{ ordner, suffix, zeilen }]` (`ordner` = `mcp-logs-<Server>`, je Datei ein Eintrag);
 * `ordnerFilter(ordner)` wählt die Server-Ordner. Basisordner nicht lesbar: `null`. Wirft nie.
 */
export function leseLogDateien({ basis, wurzel, seitMs, mitArbeitsplatz = false, ordnerFilter = () => true }) {
  const namen = versuche(() => readdirSync(basis), null);
  if (!namen) return null;
  const alle = [];
  for (const p of projektOrdner(namen, wurzel, mitArbeitsplatz)) {
    for (const o of versuche(() => readdirSync(join(basis, p.ordner)), []).filter(ordnerFilter)) {
      for (const zeilen of dateiZeilen(join(basis, p.ordner, o), seitMs)) alle.push({ ordner: o, suffix: p.suffix, zeilen });
    }
  }
  return alle;
}

const START = /^Starting connection/;
const ERFOLG = /^Successfully connected/;
const FEHLER = /^(HTTP )?Connection failed|^version negotiation probe failed/;
const MCP_URL = /^Initializing HTTP transport to (\S+)/;

/** Ereignisse `[{ ms, text, sessionId }]` der `debug`-Zeilen ab `seitMs` (einschließlich), zeitlich geordnet; kaputte Zeilen entfallen. Pur. */
function ereignisse(zeilen, seitMs) {
  const aus = [];
  for (const roh of zeilen) {
    const z = versuche(() => JSON.parse(roh), null);
    const ms = Date.parse(z?.timestamp);
    if (typeof z?.debug === "string" && ms >= seitMs) aus.push({ ms, text: z.debug, sessionId: z.sessionId ?? "" });
  }
  return aus.sort((a, b) => a.ms - b.ms);
}

const nichtPruefbar = (grund) => ({ status: "nicht-pruefbar", grund });

/** Zeilen der Session, wenn sie einen eigenen Start haben, sonst alle (Rückfall: Subagent oder Resume ohne eigenen Start). Pur. */
function wahlZeilen(ev, sessionId) {
  const eigene = sessionId ? ev.filter((e) => e.sessionId === sessionId) : [];
  return eigene.some((e) => START.test(e.text)) ? { ev: eigene, quelle: "session" } : { ev, quelle: "rueckfall" };
}

/**
 * Urteil über die Verbindung eines MCP-Servers aus seinen JSONL-Zeilen: `{ status: "verbunden"|"getrennt"|"nicht-pruefbar", grund, quelle, url, code, zeit }`.
 * Es zählt der letzte `Starting connection` ab `seit`; danach entscheidet das letzte Ergebnis (`Successfully connected` = verbunden, Verbindungsfehler ohne spätere Neuverbindung = getrennt).
 * Hat die Session (`sessionId`) keinen eigenen Start, zählt der jüngste Start im Fenster (`quelle: "rueckfall"`, kann eine fremde Session sein). Kein Start oder Start ohne Ergebnis: nicht prüfbar. Pur.
 */
export function mcpVerbindung(zeilen, { sessionId, seit }) {
  const { ev, quelle } = wahlZeilen(ereignisse(zeilen, Date.parse(seit)), sessionId);
  const start = ev.findLastIndex((e) => START.test(e.text));
  if (start < 0) return { ...nichtPruefbar("kein Verbindungsstart im Fenster"), quelle };
  const letzte = ev.slice(start + 1).findLast((e) => ERFOLG.test(e.text) || FEHLER.test(e.text));
  if (!letzte) return { ...nichtPruefbar("Verbindungsstart ohne Ergebnis"), quelle };
  const url = ev.slice(0, start).findLast((e) => MCP_URL.test(e.text))?.text.match(MCP_URL)?.[1] ?? null;
  if (ERFOLG.test(letzte.text)) return { status: "verbunden", grund: "Verbindung steht", quelle, url };
  const code = netzCode(letzte.text) || "Verbindungsfehler";
  const zeit = new Date(letzte.ms).toISOString();
  return { status: "getrennt", grund: `Verbindung fehlgeschlagen (${code}, ${zeit})`, quelle, url, code, zeit };
}

const portVon = (u) => u.port || (u.protocol === "https:" ? "443" : "80");

/** Weicht die MCP-URL nach Host oder Port von der Langfuse-Basis-URL ab (`localhost` ≠ `127.0.0.1` ≠ `[::1]`)? Text der Abweichung oder `null`; unlesbare URL: `null`. Pur. */
export function urlAbweichung(mcpUrl, basisUrl) {
  const a = versuche(() => new URL(mcpUrl), null);
  const b = versuche(() => new URL(basisUrl), null);
  if (!a || !b || (a.hostname === b.hostname && portVon(a) === portVon(b))) return null;
  return `MCP-URL ${a.hostname}:${portVon(a)} weicht von der Langfuse-Basis-URL ${b.hostname}:${portVon(b)} ab`;
}
