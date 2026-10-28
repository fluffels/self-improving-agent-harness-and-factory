/* @harness-waechter: instrumentierte CLI-Verhaltensproben und echter Shell-Executor (#84). */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolve } from "node:path";

const io = vi.hoisted(() => ({ entry: "", input: "", lesefehler: false }));
vi.mock("../../scripts/direktaufruf.mjs", () => ({ istDirektaufruf: (url: string) => url.endsWith(`/${io.entry}`) }));
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return { ...fs, readFileSync: (...args: Parameters<typeof fs.readFileSync>) => {
    if (args[0] !== 0) return fs.readFileSync(...args);
    if (io.lesefehler) throw new Error("Fixture-stdin nicht lesbar");
    return io.input;
  } };
});

const vorher = { argv: process.argv, exitCode: process.exitCode };
beforeEach(() => { vi.resetModules(); io.entry = ""; io.input = ""; io.lesefehler = false; });
afterEach(() => { process.argv = vorher.argv; process.exitCode = vorher.exitCode; io.entry = ""; vi.restoreAllMocks(); });

async function cli(entry: string, args: string[], input: string) {
  io.entry = entry; io.input = input;
  process.argv = [process.execPath, resolve("scripts", entry), ...args]; process.exitCode = undefined;
  const out = vi.spyOn(console, "log").mockImplementation(() => {}), err = vi.spyOn(console, "error").mockImplementation(() => {});
  if (entry === "codex-hook.mjs") {
    // @ts-expect-error: Node-Skript ohne Declaration.
    await import("../../scripts/codex-hook.mjs");
  } else if (entry === "codex-fremdtext.mjs") {
    // @ts-expect-error: Node-Skript ohne Declaration.
    await import("../../scripts/codex-fremdtext.mjs");
  } else {
    // @ts-expect-error: Node-Skript ohne Declaration.
    await import("../../scripts/codex-geschuetzt.mjs");
  }
  return { code: process.exitCode, out: out.mock.calls.flat().join("\n"), err: err.mock.calls.flat().join("\n") };
}
const payload = () => JSON.stringify({ cwd: process.cwd(), tool_name: "exec_command", tool_input: { cmd: "echo safe", shell: "bash" } });

test("instrumentierter Hook: native Ausgabe und Hostausgabe bleiben verschieden", async () => {
  const native = await cli("codex-hook.mjs", [], payload());
  expect(native.code).toBe(0); expect(native.err).toBe("");
  expect(JSON.parse(native.out) as unknown).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "Vollständig geprüft" } });
  vi.restoreAllMocks(); vi.resetModules();
  const host = await cli("codex-hook.mjs", ["--host"], payload());
  expect(host.code).toBe(0); expect(JSON.parse(host.out) as unknown).toEqual({ entscheidung: "allow" });
});
test.each(["flag", "json", "stdin"])("instrumentierter Hook verweigert %s mit Exit2", async mode => {
  io.lesefehler = mode === "stdin";
  const r = await cli("codex-hook.mjs", mode === "flag" ? ["--unbekannt"] : [], mode === "json" ? "{" : payload());
  expect(r.code).toBe(2); expect(r.err).toBe("");
  expect(JSON.parse(r.out) as unknown).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  expect(r.out).toContain(mode === "stdin" ? "Fixture-stdin nicht lesbar" : "deny");
});
test.each([{ args: [] }, { args: ["https://example.test/v1"] }])("instrumentierte Fremdtext-CLI stoppt falschen Aufruf vor Codex", async ({ args }) => {
  const r = await cli("codex-fremdtext.mjs", args, "Fixture-Daten");
  expect(r.code).toBe(1); expect(r.out).toBe("");
  expect(r.err).toContain(args.length ? "Nur lokaler authfreier Provider" : "Aufruf:");
});
test.each(["{", JSON.stringify({ tool_name: "functions.exec", cwd: process.cwd(), tool_input: {} })])("instrumentierte Host-CLI verweigert vor Inventar", async input => {
  const r = await cli("codex-geschuetzt.mjs", [], input);
  expect(r.code).toBe(1); expect(r.out).toBe(""); expect(r.err).toContain("Codex-Aktion gestoppt:");
});
test("echter Default-Guard und Shell-Executor ohne installierte Codex-CLI", async () => {
  // @ts-expect-error: Node-Skript ohne Declaration.
  const raw: unknown = await import("../../scripts/codex-geschuetzt.mjs");
  const c = raw as { geschuetzteAktion: (a: unknown, o: { inventar: () => Promise<unknown> }) => Promise<{ code: number; stdout: string }> };
  const inventar = () => Promise.resolve({ version: "0.164.0", geschlossen: true, errors: [], hooks: [{ eventName: "preToolUse", enabled: true, trustStatus: "trusted" }] });
  const tool_input = process.platform === "win32" ? { shell: "powershell", cmd: "Write-Output PORTABLE_HOST_OK" } : { shell: "bash", cmd: "printf PORTABLE_HOST_OK" };
  const a = { tool_name: "exec_command", cwd: process.cwd(), tool_input };
  const r = await c.geschuetzteAktion(a, { inventar });
  expect(r.code).toBe(0); expect(r.stdout.trim()).toBe("PORTABLE_HOST_OK");
  await expect(c.geschuetzteAktion({ ...a, tool_input: { ...tool_input, cmd: "echo GH.EXE" } }, { inventar })).rejects.toThrow("Guard-Prozess nicht erfolgreich");
});
