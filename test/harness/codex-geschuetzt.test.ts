/* @harness-waechter: kein Seiteneffekt vor vollständiger Freigabe (#84). */
import { expect, test, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fakeInventar, type Inventar, type Profil, type Rpc } from "../support/codex-fixture";
// @ts-expect-error: Node-Skripte ohne Declaration.
import * as raw from "../../scripts/codex-geschuetzt.mjs";
type Aktion = { tool_name: string; cwd: string; tool_input: Record<string, unknown> };
type Optionen = { executor: (a: Aktion) => unknown; inventar: () => Promise<unknown>; guard: (a: Aktion) => Promise<unknown>; timeoutMs?: number };
type HostTransport = (s: string, p: Profil, fn: (rpc: Rpc, init: { userAgent: string }, phase: (ms: number) => void) => Promise<unknown>, opts: { timeoutMs: number }) => Promise<unknown>;
const c = raw as unknown as { geschuetzteAktion: (a: Aktion, o: Optionen) => Promise<unknown>; geschuetzterHost: (a: Aktion, o: { abfragen: HostTransport; guard: Optionen["guard"] }) => Promise<unknown>; nativesInventar: (s: string, fn: Inventar) => Promise<unknown>; hookBefehl: () => string };
const aktion: Aktion = { tool_name: "exec_command", cwd: process.cwd(), tool_input: { cmd: "echo fixture", shell: "powershell" } };
const gueltig = { version: "0.164.0", geschlossen: true, hooks: [{ eventName: "preToolUse", enabled: true, trustStatus: "trusted" }], errors: [] };
const inventar = () => Promise.resolve(structuredClone(gueltig));
test("Host verwendet ein frisches kombiniertes Profil und eine geordnete Sitzung pro Aufruf", async () => {
  const profiles: string[] = [], phases: number[] = [], methods: string[] = [], policies: unknown[] = [];
  let closed = false, marker = "";
  const guard = vi.fn(() => { expect(methods.filter(m => m === "command/exec")).toHaveLength(0); return Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow"}' }); });
  const abfragen: HostTransport = async (_s, p, fn, opts) => {
    closed = false; profiles.push(p.root); expect(opts.timeoutMs).toBe(5000);
    expect(readFileSync(join(p.env.CODEX_HOME, "config.toml"), "utf8")).toContain('sandbox="unelevated"');
    expect(readFileSync(join(p.env.CODEX_HOME, "hooks.json"), "utf8")).toContain("PreToolUse");
    const h = { ...gueltig.hooks[0], command: c.hookBefehl(), key: "fixture", currentHash: "fixture" };
    const rpc: Rpc = (method, params) => {
      methods.push(method); expect(closed).toBe(false);
      if (method === "hooks/list") return Promise.resolve({ data: [{ hooks: [h], errors: [] }] });
      if (method === "mcpServerStatus/list") return Promise.resolve({ data: [] });
      if (method === "command/exec") {
        const a = params as { command: string[]; sandboxPolicy: unknown }; policies.push(a.sandboxPolicy);
        if (a.command[1] === "-e") { writeFileSync(a.command[3], "SANDBOX_KONTROLLE"); marker = a.command[4]; return Promise.resolve({ exitCode: 1 }); }
        return Promise.resolve({ exitCode: 0, stdout: "HOST_OK", stderr: "" });
      }
      return Promise.resolve({});
    };
    try { return await fn(rpc, { userAgent: "fixture/0.164.0 " }, ms => { phases.push(ms); }); }
    finally { expect(existsSync(p.root)).toBe(true); expect(existsSync(marker)).toBe(true); closed = true; }
  };
  for (let i = 0; i < 2; i++) {
    methods.length = 0; policies.length = 0;
    expect(await c.geschuetzterHost(aktion, { abfragen, guard })).toEqual({ code: 0, stdout: "HOST_OK", stderr: "" });
    expect(closed).toBe(true); expect(existsSync(profiles[i])).toBe(false); expect(existsSync(marker)).toBe(false);
    expect(methods).toEqual(["hooks/list", "config/value/write", "hooks/list", "mcpServerStatus/list", "command/exec", "command/exec"]);
    expect(policies[0]).toEqual(policies[1]);
  }
  expect(profiles[0]).not.toBe(profiles[1]); expect(phases).toEqual([3000, 40000, 3000, 40000]); expect(guard).toHaveBeenCalledTimes(2);
});
test("kombinierter Host startet genau einen echten Fixture-Server und wartet auf dessen close", async () => {
  const state: { root?: string; starts?: number; closes?: number; methods?: string[] } = {};
  const h = { ...gueltig.hooks[0], command: c.hookBefehl(), key: "fixture", currentHash: "fixture" };
  const abfragen = fakeInventar("host", { "hooks/list": [{ data: [{ hooks: [h], errors: [] }] }, { data: [{ hooks: [h], errors: [] }] }], "config/value/write": {}, "mcpServerStatus/list": { data: [] } }, state);
  expect(await c.geschuetzterHost(aktion, { abfragen, guard: () => Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow"}' }) })).toEqual({ code: 0, stdout: "HOST_FIXTURE_OK", stderr: "" });
  expect(state.starts).toBe(1); expect(state.closes).toBe(1); expect(state.methods?.filter(m => m === "initialize")).toHaveLength(1);
  expect(state.methods?.filter(m => m === "command/exec")).toHaveLength(2); expect(existsSync(state.root!)).toBe(false);
});
function hostFehler(mode: string) {
  const state = { root: "", marker: "", closed: false, commands: 0 };
  const guard = vi.fn(() => {
    if (mode === "guard-error") return Promise.reject(Error("fixture guard"));
    if (mode === "guard-late") return new Promise(r => setTimeout(() => r({ code: 0, stdout: '{"entscheidung":"allow"}' }), 3500));
    return Promise.resolve({ code: 0, stdout: mode === "guard-deny" ? '{"entscheidung":"deny"}' : '{"entscheidung":"allow"}' });
  });
  const abfragen: HostTransport = async (_s, p, fn) => {
    state.root = p.root;
    const h = { ...gueltig.hooks[0], command: c.hookBefehl(), key: "fixture", currentHash: "fixture", trustStatus: mode === "untrusted" ? "untrusted" : "trusted" };
    const rpc: Rpc = (method, params) => {
      if (method === "hooks/list") return Promise.resolve({ data: [{ hooks: mode === "missing" ? [] : [h], errors: [] }] });
      if (method === "config/value/write" && mode === "trust") throw Error("fixture trust");
      if (method === "mcpServerStatus/list") return Promise.resolve({ data: mode === "mcp" ? [{}] : [] });
      if (method === "command/exec") {
        state.commands++;
        const a = params as { command: string[] };
        if (a.command[1] !== "-e") return Promise.resolve({ exitCode: 0, stdout: "UNEXPECTED_USER", stderr: "" });
        state.marker = a.command[4];
        writeFileSync(a.command[3], mode === "positive" ? "falsch" : "SANDBOX_KONTROLLE");
        if (mode === "outside") writeFileSync(state.marker, "UEBERNOMMEN");
        if (mode === "rpc") throw Error("fixture RPC");
        return Promise.resolve({ exitCode: mode === "control-allow" ? 0 : 1 });
      }
      return Promise.resolve({});
    };
    try { return await fn(rpc, { userAgent: mode === "version" ? "fixture/0.165.0 " : "fixture/0.164.0 " }, () => {}); }
    finally { expect(existsSync(p.root)).toBe(true); expect(state.marker === "" || existsSync(state.marker)).toBe(true); state.closed = true; }
  };
  return { state, guard, abfragen };
}
test.each(["missing", "untrusted", "trust", "version", "mcp", "guard-error", "guard-deny", "positive", "outside", "control-allow", "rpc"])("gemeinsamer Host stoppt Phase %s vor Nutzeraktion und bereinigt nach Transportende", async mode => {
  const f = hostFehler(mode);
  await expect(c.geschuetzterHost(aktion, f)).rejects.toThrow();
  const control = ["positive", "outside", "control-allow", "rpc"].includes(mode);
  expect(f.state.commands).toBe(control ? 1 : 0); expect(f.guard).toHaveBeenCalledTimes(control || mode.startsWith("guard-") ? 1 : 0);
  expect(f.state.closed).toBe(true); expect(existsSync(f.state.root)).toBe(false); expect(f.state.marker === "" || !existsSync(f.state.marker)).toBe(true);
});
test("späte Guardfreigabe nach 3000ms erreicht keinen command/exec", async () => {
  vi.useFakeTimers(); const f = hostFehler("guard-late");
  let failed = false;
  try {
    const result = c.geschuetzterHost(aktion, f).catch((e: unknown) => { failed = true; return (e as Error).message; });
    await vi.advanceTimersByTimeAsync(3000); expect(failed).toBe(true); expect(await result).toBe("Guard-Frist überschritten");
    await vi.advanceTimersByTimeAsync(500); expect(f.state.commands).toBe(0); expect(f.state.closed).toBe(true); expect(existsSync(f.state.root)).toBe(false);
  } finally { vi.useRealTimers(); }
});
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
  await expect(c.geschuetzterHost({ ...aktion, tool_name }, { abfragen: inv, guard })).rejects.toThrow();
  expect(inv).not.toHaveBeenCalled(); expect(guard).not.toHaveBeenCalled();
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
test.skipIf(!process.env.CODEX_SCHUTZ_PROBE)("öffentliche Host-CLI verweigert normalen externen Fixture-Schreibzugriff", () => {
  const dir = mkdtempSync(join(tmpdir(), "codex-externe-fixture-")), marker = join(dir, "geschuetzt.txt");
  try {
    writeFileSync(marker, "unveraendert");
    const tool_input = process.platform === "win32"
      ? { shell: "powershell", cmd: `Set-Content -LiteralPath '${marker.replaceAll("'", "''")}' -Value UEBERNOMMEN` }
      : { shell: "bash", cmd: `printf UEBERNOMMEN > ${JSON.stringify(marker)}` };
    const r = spawnSync(process.execPath, ["scripts/codex-geschuetzt.mjs"], { encoding: "utf8", input: JSON.stringify({ ...aktion, tool_input }) });
    expect(readFileSync(marker, "utf8")).toBe("unveraendert");
    expect(r.status === 0 ? (JSON.parse(r.stdout) as { code: number }).code : r.status).not.toBe(0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
