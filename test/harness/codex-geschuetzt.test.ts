/* @harness-waechter: kein Seiteneffekt vor vollständiger Freigabe (#84). */
import { expect, test, vi } from "vitest";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fakeInventar, type Inventar } from "../support/codex-fixture";
// @ts-expect-error: Node-Skripte ohne Declaration.
import * as raw from "../../scripts/codex-geschuetzt.mjs";
type Aktion = { tool_name: string; cwd: string; tool_input: Record<string, unknown> };
type Optionen = { executor: (a: Aktion) => unknown; inventar: () => Promise<unknown>; guard: (a: Aktion) => Promise<unknown>; timeoutMs?: number };
const c = raw as unknown as { geschuetzteAktion: (a: Aktion, o: Optionen) => Promise<unknown>; nativesInventar: (s: string, fn: Inventar) => Promise<unknown>; hookBefehl: () => string };
const aktion: Aktion = { tool_name: "exec_command", cwd: process.cwd(), tool_input: { cmd: "echo fixture", shell: "powershell" } };
const gueltig = { version: "0.164.0", geschlossen: true, hooks: [{ eventName: "preToolUse", enabled: true, trustStatus: "trusted" }], errors: [] };
const inventar = () => Promise.resolve(structuredClone(gueltig));
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
test.each([null, { ...gueltig, hooks: [] }, { ...gueltig, hooks: {} }, { ...gueltig, hooks: [...gueltig.hooks, ...gueltig.hooks] }, { ...gueltig, hooks: [{ ...gueltig.hooks[0], trustStatus: "untrusted" }] }])("fehlende/untrusted Registrierung stoppt vor Guard und Executor", async i => {
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
  { ...gueltig, version: "0.165.0" },
  { ...gueltig, geschlossen: false },
  { ...gueltig, errors: ["fixture"] },
  { ...gueltig, errors: {} },
  { version: "0.164.0", geschlossen: true, hooks: [{ eventName: "postToolUse", enabled: true, trustStatus: "trusted" }], errors: [] },
  { version: "0.164.0", geschlossen: true, hooks: [{ eventName: "preToolUse", enabled: false, trustStatus: "trusted" }], errors: [] },
])("ungeeignetes natives Inventar startet keinen Guard", async i => {
  const guard = vi.fn(), executor = vi.fn();
  await expect(c.geschuetzteAktion(aktion, { executor, inventar: () => Promise.resolve(i), guard })).rejects.toThrow();
  expect(guard).not.toHaveBeenCalled(); expect(executor).not.toHaveBeenCalled();
});
test("managed Registrierung ist zulässig", async () => {
  const executor = vi.fn(), i = { ...gueltig, hooks: [{ ...gueltig.hooks[0], trustStatus: "managed" }] };
  await c.geschuetzteAktion(aktion, { executor, inventar: () => Promise.resolve(i), guard: () => Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow"}' }) });
  expect(executor).toHaveBeenCalledOnce();
});
test.each([null, { code: 0, stdout: "null" }])("null Guardantwort/Entscheidung stoppt", async r => {
  const executor = vi.fn(); await expect(c.geschuetzteAktion(aktion, { executor, inventar, guard: () => Promise.resolve(r) })).rejects.toThrow(); expect(executor).not.toHaveBeenCalled();
});
test.each(["ok", "mehrdeutig", "errors", "befehl", "hookfehlt", "trust", "post", "mcp"])("native Inventarfolge mit echtem Kindprozess: %s", async mode => {
  const h = { ...gueltig.hooks[0], command: c.hookBefehl(), key: "fixture", currentHash: "sha256:fixture" }, e = { hooks: [h], errors: [] as string[] };
  const initial = mode === "mehrdeutig" ? { data: [e, e] } : { data: [{ ...e, errors: mode === "errors" ? ["fixture"] : [], hooks: mode === "hookfehlt" ? [] : [{ ...h, command: mode === "befehl" ? "fremd" : h.command }] }] };
  const antworten = { "hooks/list": [initial, { data: [{ ...e, hooks: [{ ...h, trustStatus: mode === "post" ? "untrusted" : "trusted" }] }] }], "config/value/write": {}, "mcpServerStatus/list": { data: mode === "mcp" ? [{}] : [] } };
  const state: { root?: string } = {}, executor = vi.fn();
  const result = c.geschuetzteAktion(aktion, { executor, inventar: () => c.nativesInventar("fixture", fakeInventar(mode, antworten, state)), guard: () => Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow"}' }) });
  expect(await result.then(() => true, () => false)).toBe(mode === "ok");
  expect(executor).toHaveBeenCalledTimes(mode === "ok" ? 1 : 0); expect(state.root).toBeTypeOf("string"); expect(existsSync(state.root ?? "")).toBe(false);
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
test("öffentliche Host-CLI akzeptiert weder Werkzeugwrapper noch kaputtes JSON", () => {
  for (const input of ["{", JSON.stringify({ ...aktion, tool_name: "functions.exec" })]) {
    const r = spawnSync(process.execPath, ["scripts/codex-geschuetzt.mjs"], { encoding: "utf8", input });
    expect(r.status).toBe(1); expect(r.stderr).toContain("gestoppt:");
  }
});
test.skipIf(!process.env.CODEX_SCHUTZ_PROBE)("öffentliche Host-CLI mit echtem Inventar, Guardprozess und Shell-Executor", () => {
  const tool_input = process.platform === "win32" ? { shell: "powershell", cmd: "Write-Output HOST_CLI_OK" } : { shell: "bash", cmd: "printf HOST_CLI_OK" };
  const r = spawnSync(process.execPath, ["scripts/codex-geschuetzt.mjs"], { encoding: "utf8", input: JSON.stringify({ ...aktion, tool_input }) });
  const ergebnis = JSON.parse(r.stdout) as { code: number; stdout: string };
  expect(r.status).toBe(0); expect(ergebnis.code).toBe(0); expect(ergebnis.stdout).toContain("HOST_CLI_OK");
});
