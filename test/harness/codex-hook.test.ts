/* @harness-waechter: strikte Codex-Abbildung gemeinsamer Guards (#84). */
import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
// @ts-expect-error: Node-Skripte ohne Declaration.
import * as raw from "../../scripts/codex-hook.mjs";
const c = raw as unknown as { pruefeHook: (s: string, r: string, cfg: unknown) => { entscheidung: string; grund?: string } };
const config = JSON.parse(readFileSync(".factory/projekt.json", "utf8")) as { agenten: { umsetzer: string; lens: string } };
const root = process.cwd();
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
  expect(pruefe(tool, { target: "umsetzer", message: "SZENARIEN #99" }).entscheidung).toBe("deny");
  expect(pruefe(tool, { target: "holdout-abnahme", message: "SZENARIEN #99" }).entscheidung).toBe("deny");
  expect(pruefe(tool, { message: "hello" }).entscheidung).toBe("deny");
  expect(pruefe(tool, { target: "umsetzer", message: "hello" }).entscheidung).toBe("allow");
});
test("Spawn: explizite Rolle, Holdout und Lens-Auftrag", () => {
  const spawn = (agent_type: string, message: string) => pruefe("spawn_agent", { agent_type, message, fork_turns: "none" });
  expect(spawn(config.agenten.umsetzer, "SZENARIEN #99").entscheidung).toBe("deny");
  expect(spawn("holdout-abnahme", "SZENARIEN #99").entscheidung).toBe("allow");
  expect(spawn(config.agenten.lens, "erwarteter HEAD: <head>").entscheidung).toBe("deny");
  expect(spawn(config.agenten.lens, "erwarteter HEAD: abc1234").entscheidung).toBe("allow");
  expect(pruefe("spawn_agent", { message: "hello" }).entscheidung).toBe("deny");
});
test("Patch und Abschluss ohne vollständigen kontrollierten Pfad verweigert", () => {
  expect(pruefe("apply_patch", { patch: "*** Begin Patch" }).entscheidung).toBe("deny");
  expect(pruefe("abschluss", { message: "fertig" }, { agent_type: config.agenten.umsetzer }).entscheidung).toBe("deny");
});
