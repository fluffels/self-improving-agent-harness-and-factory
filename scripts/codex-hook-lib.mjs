// Strikter Codex-Adapter; gemeinsame pure Guards, kein fail-open Dispatcher.
import { isAbsolute } from "node:path";
import { decide, resolveGitContext } from "./worktree-guard-hook.mjs";
import { bewertePowerShell } from "./worktree-guard-powershell.mjs";
import { bewerte as bewerteGh } from "./gh-guard-hook.mjs";
import { bewerteStdinSkript } from "./stdin-skript-guard.mjs";
import { lensAuftragBlockade } from "./lens-auftrag-guard.mjs";
import { holdoutAuftragBlockade } from "./holdout-auftrag-guard.mjs";
import { abschlussBlockade } from "./umsetzer-abschluss.mjs";

const text = s => typeof s === "string" && s.trim() !== "";
const objekt = o => o !== null && typeof o === "object" && !Array.isArray(o);
export function normalisiere(data) {
  if (!objekt(data) || !text(data.cwd) || !isAbsolute(data.cwd) || !objekt(data.tool_input)) throw new Error("Ungültige Codex-Payload/cwd");
  if (!text(data.tool_name)) throw new Error("Toolname fehlt");
  return structuredClone(data);
}
function shellEntscheidung(a, root) {
  const i = a.tool_input;
  if (!text(i.cmd) || !["bash", "powershell"].includes(i.shell)) throw new Error("Bekannte Shell und cmd erforderlich");
  if (Object.keys(i).some(k => !["cmd", "shell"].includes(k))) throw new Error("Unbekannter Shell-Wrapper/Parameter");
  if (!resolveGitContext(a.cwd, root).relevant) throw new Error("cwd ist kein Checkout dieses Repos");
  // Die zusätzlichen ask-Regeln der Claude-Settings gelten nicht nativ für Codex.
  // Bis zu deren vollständiger Abbildung bleibt der GitHub-CLI-Pfad ganz geschlossen.
  if (/\bgh(?:\.exe)?\b/i.test(i.cmd)) throw new Error("GitHub-CLI benötigt zusätzliches kontrolliertes Freigabeprofil");
  const args = { command: i.cmd, cwd: a.cwd, repoRoot: root };
  return [i.shell === "bash" ? decide(args) : bewertePowerShell(args), bewerteGh(i.cmd, { shell: i.shell }), bewerteStdinSkript(i.cmd)];
}
function agentEntscheidung(a, config) {
  const i = a.tool_input;
  if (a.tool_name === "spawn_agent") {
    if (!text(i.agent_type) || !text(i.message) || i.fork_turns !== "none") throw new Error("Explizite Rolle, Nachricht und fork_turns=none erforderlich");
    return [lensAuftragBlockade({ subagentType: i.agent_type, prompt: i.message }, { config }), holdoutAuftragBlockade({ tool: "Agent", subagentType: i.agent_type, text: i.message })];
  }
  if (!text(i.target) || !text(i.message)) throw new Error("Nachrichtenempfänger/Text fehlt");
  return [holdoutAuftragBlockade({ tool: "SendMessage", text: i.message })];
}
export function bewerteAktion(data, root, config) {
  const a = normalisiere(data);
  let entscheidungen;
  if (a.tool_name === "exec_command") entscheidungen = shellEntscheidung(a, root);
  else if (["spawn_agent", "send_message", "followup_task"].includes(a.tool_name)) entscheidungen = agentEntscheidung(a, config);
  else if (a.tool_name === "apply_patch") {
    // Keine eigene partielle Patchgrammatik: bis zu vollständiger Erfassung ALLER Pfade verweigern.
    throw new Error("apply_patch ohne vollständigen Pfad-Executor nicht unterstützt");
  } else if (a.tool_name === "abschluss") {
    entscheidungen = [abschlussBlockade({ hookEvent: "PreToolUse", toolName: "SubagentHandback", agentType: a.agent_type, lastMessage: a.tool_input.message }, { config })];
  } else throw new Error("Werkzeugpfad nicht unterstützt (auch write_stdin, Datei/MCP und functions.exec)");
  const grund = entscheidungen.find(e => typeof e === "string" || e?.block || e?.ask);
  return grund ? { entscheidung: "deny", grund: typeof grund === "string" ? grund : grund.reason } : { entscheidung: "allow" };
}
