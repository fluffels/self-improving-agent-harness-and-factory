/* @harness-waechter: kein Seiteneffekt vor vollständiger Freigabe (#84). */
import { expect, test, vi } from "vitest";
// @ts-expect-error: Node-Skripte ohne Declaration.
import * as raw from "../../scripts/codex-geschuetzt.mjs";
type Aktion = { tool_name: string; cwd: string; tool_input: Record<string, unknown> };
type Optionen = { executor: (a: Aktion) => unknown; inventar: () => Promise<unknown>; guard: (a: Aktion) => Promise<unknown>; timeoutMs?: number };
const c = raw as unknown as { geschuetzteAktion: (a: Aktion, o: Optionen) => Promise<unknown> };
const aktion: Aktion = { tool_name: "exec_command", cwd: process.cwd(), tool_input: { cmd: "echo fixture", shell: "powershell" } };
const inventar = () => Promise.resolve({ version: "0.164.0", geschlossen: true, hooks: [{ eventName: "preToolUse", enabled: true, trustStatus: "trusted" }], errors: [] });
test.each([
  ["throw", () => Promise.reject(Error("kaputt"))],
  ["hang", () => new Promise(() => {})],
  ["badJSON", () => Promise.resolve({ code: 0, stdout: "{" })],
  ["exit", () => Promise.resolve({ code: 2, stdout: '{"entscheidung":"allow"}' })],
  ["deny", () => Promise.resolve({ code: 0, stdout: '{"entscheidung":"deny"}' })],
])("Guard %s erreicht keinen Executor", async (_name, guard) => {
  const executor = vi.fn();
  await expect(c.geschuetzteAktion(aktion, { executor, inventar, guard, timeoutMs: 20 })).rejects.toThrow();
  expect(executor).not.toHaveBeenCalled();
});
test.each([{}, { version: "0.164.0", geschlossen: true, hooks: [] }, { version: "0.164.0", geschlossen: true, hooks: [{ eventName: "preToolUse", enabled: true, trustStatus: "untrusted" }], errors: [] }])("fehlende/untrusted Registrierung stoppt vor Guard und Executor", async i => {
  const guard = vi.fn(), executor = vi.fn();
  await expect(c.geschuetzteAktion(aktion, { executor, inventar: () => Promise.resolve(i), guard })).rejects.toThrow();
  expect(guard).not.toHaveBeenCalled(); expect(executor).not.toHaveBeenCalled();
});
test("vollständiges allow/Exit0 führt exakt die geprüfte Kopie einmal aus", async () => {
  const executor = vi.fn(() => "ausgeführt");
  const guard = vi.fn(() => Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow"}' }));
  expect(await c.geschuetzteAktion(aktion, { executor, inventar, guard })).toBe("ausgeführt");
  expect(executor).toHaveBeenCalledExactlyOnceWith(aktion);
});
test.each([
  { version: "0.165.0", geschlossen: true, hooks: [], errors: [] },
  { version: "0.164.0", geschlossen: false, hooks: [], errors: [] },
  { version: "0.164.0", geschlossen: true, hooks: [], errors: ["fixture"] },
  { version: "0.164.0", geschlossen: true, hooks: [{ eventName: "postToolUse", enabled: true, trustStatus: "trusted" }], errors: [] },
  { version: "0.164.0", geschlossen: true, hooks: [{ eventName: "preToolUse", enabled: false, trustStatus: "trusted" }], errors: [] },
])("ungeeignetes natives Inventar startet keinen Guard", async i => {
  const guard = vi.fn(), executor = vi.fn();
  await expect(c.geschuetzteAktion(aktion, { executor, inventar: () => Promise.resolve(i), guard })).rejects.toThrow();
  expect(guard).not.toHaveBeenCalled(); expect(executor).not.toHaveBeenCalled();
});
test.each(["write_stdin", "apply_patch", "spawn_agent", "send_message", "followup_task", "functions.exec", "mcp__fixture__write", "abschluss"])("Pfad %s stoppt vor Sitzungsstart", async tool_name => {
  const inv = vi.fn(inventar), guard = vi.fn(), executor = vi.fn();
  await expect(c.geschuetzteAktion({ ...aktion, tool_name }, { inventar: inv, guard, executor })).rejects.toThrow();
  expect(inv).not.toHaveBeenCalled(); expect(executor).not.toHaveBeenCalled();
});
test("hängerndes Inventar und unbekannte Entscheidung starten keinen Executor", async () => {
  const executor = vi.fn(), guard = vi.fn();
  await expect(c.geschuetzteAktion(aktion, { executor, inventar: () => new Promise(() => {}), guard, timeoutMs: 10 })).rejects.toThrow();
  expect(guard).not.toHaveBeenCalled();
  await expect(c.geschuetzteAktion(aktion, { executor, inventar, guard: () => Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow","tool_input":{}}' }) })).rejects.toThrow();
  expect(executor).not.toHaveBeenCalled();
});
test("Guard-/Aufrufermutation ändert die geprüfte Aktion nicht", async () => {
  const a = structuredClone(aktion), executor = vi.fn();
  await c.geschuetzteAktion(a, { executor, inventar, guard: pruefung => {
    a.tool_input.cmd = "caller-mutiert"; pruefung.tool_input.cmd = "guard-mutiert";
    return Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow"}' });
  } });
  expect(executor).toHaveBeenCalledExactlyOnceWith(aktion);
});
