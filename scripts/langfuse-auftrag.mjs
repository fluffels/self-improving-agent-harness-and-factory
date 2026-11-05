// Kein Shebang, kein Direktaufruf: Lib für `langfuse-nachliefern.mjs` (Konvention: Einstiegsskripte importieren nicht voneinander). Importiert nur Builtins.
/**
 * Nachliefer-Aufträge (factory#213): ein Agent darf den Langfuse-Secret-Key nie lesen (AGENTS.md › Kein Secret-Key im Agentenlauf), also legt er nur einen
 * Auftrag ab (`node scripts/langfuse-nachliefern.mjs --auftrag <session>`: eine Session-ID in einer Zustandsdatei, ohne Zugang, ohne Netz). Ausgeführt wird er
 * vom nächsten SessionStart-Lauf des Hooks, der den Key im eigenen Prozess liest; der Lauf prüft die Session auch außerhalb des 7-Tage-Fensters.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const AUFTRAG_DATEI = "langfuse-nachliefer-auftraege.json";
/** Ein nie erledigter Auftrag (z.B. dauerhaft mehrdeutige Session) verfällt nach dieser Zeit. */
export const AUFTRAG_ALTER_MS = 7 * 86_400_000;
/** Session-IDs sind UUIDs; ein führendes `-` würde als Flag gelesen. */
export const SESSION_ID = /^[0-9A-Za-z][\w-]*$/;

function lies(stateDir) {
  try {
    const j = JSON.parse(readFileSync(join(stateDir, AUFTRAG_DATEI), "utf8"));
    return j && typeof j === "object" && j.auftraege && typeof j.auftraege === "object" ? j.auftraege : {};
  } catch {
    return {};
  }
}

function schreibe(stateDir, auftraege) {
  mkdirSync(stateDir, { recursive: true });
  const datei = join(stateDir, AUFTRAG_DATEI);
  writeFileSync(`${datei}.tmp`, JSON.stringify({ version: 1, auftraege }, null, 2) + "\n");
  renameSync(`${datei}.tmp`, datei);
}

/** Legt den Auftrag ab; `false` bei einer ungültigen Session-ID (nichts geschrieben). */
export function auftragLegen(stateDir, session, now = Date.now()) {
  if (typeof session !== "string" || !SESSION_ID.test(session)) return false;
  schreibe(stateDir, { ...lies(stateDir), [session]: new Date(now).toISOString() });
  return true;
}

/** Offene Aufträge (Session-IDs, älteste zuerst); verfallene und ungültige zählen nicht. */
export function auftraegeLesen(stateDir, now = Date.now()) {
  return Object.entries(lies(stateDir))
    .filter(([id, zeit]) => SESSION_ID.test(id) && now - Date.parse(zeit) < AUFTRAG_ALTER_MS)
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .map(([id]) => id);
}

/** Entfernt einen Auftrag (auch einen verfallenen); ohne Datei oder Eintrag nichts zu tun. */
export function auftragErledigen(stateDir, session) {
  const auftraege = lies(stateDir);
  if (!(session in auftraege)) return;
  delete auftraege[session];
  schreibe(stateDir, auftraege);
}
