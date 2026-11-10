#!/usr/bin/env node
/* Werkzeug-Vorprüfung (factory#260 L7): fehlt dem Repo ein Werkzeug, das ein Ticketlauf braucht, stoppt der Lauf vor dem Claim,
 * nicht erst nach Plan und Commits (Vorbild: langfuse-vorbedingung.mjs). Ändert nichts, führt nur die deklarierten Prüfbefehle aus; ohne Modell-Tokens.
 *
 *   node scripts/werkzeug-vorpruefung.mjs   Exit 0 = alles da, 1 = Mangel (je Mangel eine `Mangel:`- und eine `Fix:`-Zeile auf stderr), 2 = Aufruffehler
 *
 * Drei Prüfungen:
 *   1. MCP-Server: jeder Server aus `tools:` der Agenten in `.claude/agents/*.md` (Form `mcp__<server>__<tool>` oder `mcp__<server>` ohne Tool) steht in `.mcp.json`, in USER_SCOPE_MCP_SERVER oder in `vorpruefung.userScopeServer` der Projekt-Config.
 *   2. Node-Version: `process.versions.node` ist mindestens `.nvmrc`, sonst mindestens `engines.node` (`>=x.y.z`) der `package.json`; ohne beides entfällt sie, eine unlesbare Angabe ist ein Mangel.
 *   3. Projekt-Werkzeuge: der optionale Block `vorpruefung.befehle` der Projekt-Config (`[{ name, befehl: [Programm, Argument…] }]`); jeder Befehl läuft mit 10 s Frist, ENOENT, Exit != 0 oder Timeout ist ein Mangel.
 * Bekannte Grenze: geprüft wird die Deklaration, nicht die laufende MCP-Verbindung (die belegt `mcp-ausfall.mjs`). Bei Codex prüft `required = true` die MCP-Verbindung nativ.
 * Reines Node-Skript (nur Builtins); Bewertung pur, Dateisystem und Prozess-Runner werden injiziert. */
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { werkzeugMaengel, USAGE } from "./werkzeug-lib.mjs";
export * from "./werkzeug-lib.mjs";

export function main(argv = process.argv.slice(2), { out = console.log, err = console.error, ...rest } = {}) {
  const { fehler } = flagsLesen(argv, {});
  if (fehler) { err(`${fehler.text}. ${USAGE}`); return AUFRUF_EXIT; }
  const maengel = werkzeugMaengel(rest);
  if (maengel.length === 0) { out("Werkzeug-Vorprüfung ok"); return 0; }
  for (const m of maengel) { err(`Mangel: ${m.text}`); err(`Fix: ${m.fix}`); }
  return 1;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
