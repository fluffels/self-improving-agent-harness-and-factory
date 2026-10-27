/* @harness-waechter: strikte Codex-Abbildung gemeinsamer Guards (#84). */
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
// @ts-expect-error: Node-Skripte ohne Declaration.
import * as raw from "../../scripts/codex-hook.mjs";
// @ts-expect-error: Node-Skripte ohne Declaration.
import * as lib from "../../scripts/codex-hook-lib.mjs";
const normalisiere = (lib as unknown as { normalisiere: (o: unknown) => unknown }).normalisiere;
const c = raw as unknown as { pruefeHook: (s: string, r: string, cfg: unknown) => { entscheidung: string; grund?: string } };
const config = JSON.parse(readFileSync(".factory/projekt.json", "utf8")) as { agenten: { umsetzer: string; lens: string } };
const root = process.cwd();
const holdoutKopf = ["SZENARIEN", "#99"].join(" ");
const pruefe = (tool_name: string, tool_input: unknown, extra = {}) => c.pruefeHook(JSON.stringify({ cwd: root, tool_name, tool_input, ...extra }), root, config);
test.each(["", "{", "null", "[]", '{"cwd":"relative","tool_input":{}}', '{"cwd":"/tmp","tool_name":"x","tool_input":null}'])("kaputte Payload stoppt: %s", s => {
  expect(c.pruefeHook(s, root, config).entscheidung).toBe("deny");
});
test.each(["write_stdin", "functions.exec", "collaboration.list_agents", "read_file", "write_file", "mcp__fixture__write", "unknown"])("nicht erfasster Pfad %s stoppt", tool => {
  expect(pruefe(tool, {}).entscheidung).toBe("deny");
});
test.each([{ cmd: "echo safe" }, { cmd: "", shell: "bash" }, { cmd: "echo safe", shell: "zsh" }, { cmd: "echo safe", shell: "bash", workdir: "/tmp" }])("unklare Shell/Wrapper stoppt", i => {
  expect(pruefe("exec_command", i).entscheidung).toBe("deny");
});
test("Worktree-, GitHub- und Stdin-Regel am wirklichen Adapter", () => {
  const actualMain = dirname(resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim()));
  expect(pruefe("exec_command", { cmd: "git commit -m fixture", shell: "bash" }, { cwd: actualMain }).entscheidung).toBe("deny");
  expect(pruefe("exec_command", { cmd: "gh issue delete 99 --yes", shell: "bash" }).entscheidung).toBe("deny");
  expect(pruefe("exec_command", { cmd: "python - <<'PY'\nprint('fixture')\nPY", shell: "bash" }).entscheidung).toBe("deny");
  expect(pruefe("exec_command", { cmd: "echo safe", shell: "bash" }).entscheidung).toBe("allow");
  expect(pruefe("exec_command", { cmd: "Write-Output safe", shell: "powershell" }).entscheidung).toBe("allow");
  expect(pruefe("exec_command", { cmd: "Write-Output safe", shell: "powershell" }, { cwd: tmpdir() }).entscheidung).toBe("deny");
});
test.each(["send_message", "followup_task"])("Holdout-Nachricht an %s verweigert", tool => {
  expect(pruefe(tool, { target: "umsetzer", message: holdoutKopf }).entscheidung).toBe("deny");
  expect(pruefe(tool, { target: "holdout-abnahme", message: holdoutKopf }).entscheidung).toBe("deny");
  expect(pruefe(tool, { message: "hello" }).entscheidung).toBe("deny");
  expect(pruefe(tool, { target: "umsetzer", message: "hello" }).entscheidung).toBe("allow");
});
test("Spawn: explizite Rolle, Holdout und Lens-Auftrag", () => {
  const spawn = (agent_type: string, message: string) => pruefe("spawn_agent", { agent_type, message, fork_turns: "none" });
  expect(spawn(config.agenten.umsetzer, holdoutKopf).entscheidung).toBe("deny");
  expect(spawn("holdout-abnahme", holdoutKopf).entscheidung).toBe("allow");
  expect(spawn(config.agenten.lens, "erwarteter HEAD: <head>").entscheidung).toBe("deny");
  expect(spawn(config.agenten.lens, "erwarteter HEAD: abc1234").entscheidung).toBe("allow");
  expect(pruefe("spawn_agent", { message: "hello" }).entscheidung).toBe("deny");
});
test("CLI verweigert unbekannte Flags und liefert natives Denial", () => {
  const r = spawnSync(process.execPath, ["scripts/codex-hook.mjs", "--unbekannt"], { input: "{}", encoding: "utf8" });
  expect(r.status).toBe(2);
  expect(JSON.parse(r.stdout) as unknown).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
});
test.each([
  { cwd: "" }, { cwd: 1 }, { tool_name: "" }, { tool_name: " " }, { tool_name: 1 }, { tool_name: null },
  { tool_input: [] }, { tool_input: "cmd" },
])("isolierte Payload-Typ-/Textbedingung", extra => {
  expect(pruefe("exec_command", { cmd: "echo safe", shell: "bash" }, extra).entscheidung).toBe("deny");
  expect(() => normalisiere({ cwd: root, tool_name: "exec_command", tool_input: { cmd: "echo safe", shell: "bash" }, ...extra })).toThrow();
});
test.each([{ cmd: " ", shell: "bash" }, { cmd: 1, shell: "bash" }, { cmd: "echo safe", shell: null }])("isolierter Shelltyp/Leerraum", i => {
  expect(pruefe("exec_command", i).entscheidung).toBe("deny");
});
test.each([{ agent_type: config.agenten.umsetzer, message: "hello", fork_turns: "all" }, { agent_type: config.agenten.umsetzer, message: " ", fork_turns: "none" }, { agent_type: " ", message: "hello", fork_turns: "none" }])("isolierte Spawnbedingung", i => {
  expect(pruefe("spawn_agent", i).entscheidung).toBe("deny");
});
test.each(["", " ", 1])("Nachrichtentext mit gültigem Empfänger", message => {
  expect(pruefe("send_message", { target: "agent", message }).entscheidung).toBe("deny");
});
test.each([["echo GH.EXE", "deny"], ["echo ghx", "allow"], ["echo xgh", "allow"]])("gh-Wortgrenze %s", (cmd, expected) => {
  expect(pruefe("exec_command", { cmd, shell: "bash" }).entscheidung).toBe(expected);
});
test("PowerShell-Worktree und ask werden verweigert; CLI-allow/native/Host", () => {
  const main = dirname(resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim()));
  expect(pruefe("exec_command", { cmd: "git commit -m fixture", shell: "powershell" }, { cwd: main }).entscheidung).toBe("deny");
  expect(pruefe("exec_command", { cmd: 'git -C "$D" commit -m fixture', shell: "bash" }).entscheidung).toBe("deny");
  const input = JSON.stringify({ cwd: root, tool_name: "exec_command", tool_input: { cmd: "echo safe", shell: "bash" } });
  const host = spawnSync(process.execPath, ["scripts/codex-hook.mjs", "--host"], { input, encoding: "utf8" });
  expect(host.status).toBe(0); expect(JSON.parse(host.stdout) as unknown).toEqual({ entscheidung: "allow" });
  const native = spawnSync(process.execPath, ["scripts/codex-hook.mjs"], { input, encoding: "utf8" });
  expect(native.status).toBe(0); expect(JSON.parse(native.stdout) as unknown).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow", permissionDecisionReason: "Vollständig geprüft" } });
});
test("Patch und Abschluss ohne vollständigen kontrollierten Pfad verweigert", () => {
  expect(pruefe("apply_patch", { patch: "*** Begin Patch" }).entscheidung).toBe("deny");
  expect(pruefe("abschluss", { message: "fertig" }, { agent_type: config.agenten.umsetzer }).entscheidung).toBe("deny");
});
