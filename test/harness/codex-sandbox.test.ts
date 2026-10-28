/* @harness-waechter: native Schreibgrenze vor jeder Hostaktion, ohne Fallback (#84). */
import { afterEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
// @ts-expect-error: Node-Skript ohne Declaration.
import * as raw from "../../scripts/codex-sandbox.mjs";
type Params = { command: string[]; cwd: string; sandboxPolicy: unknown; env: Record<string, string>; timeoutMs: number };
type Rpc = (method: string, params: Params) => Promise<Record<string, unknown>>;
type Profil = { root: string; env: Record<string, string> };
type Aktion = { cwd: string; tool_input: { cmd: string; shell: string } };
type Abfragen = (s: string, p: Profil, fn: (rpc: Rpc, init: { userAgent: string }) => Promise<unknown>, opts: { timeoutMs: number }) => Promise<unknown>;
const c = raw as unknown as { pruefeCwdGrenze: (rest: string) => void; sandboxAktion: (a: Aktion, deps?: { root: string; abfragen?: Abfragen }) => Promise<{ code: number; stdout: string; stderr: string }> };
const temps: string[] = [];
afterEach(() => { for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "codex-sandbox-test-")); temps.push(dir); return dir; };
const aktion = (cwd: string): Aktion => ({ cwd, tool_input: { cmd: "Write-Output FIXTURE_OK", shell: "powershell" } });
const denial = (rpcCode: unknown = -32603, rpcMessage: unknown = "exec failed: sandbox error: sandbox denied exec error, exit code: 1") => Object.assign(new Error("RPC verweigert"), { rpcCode, rpcMessage });
test.each(["..", `..${sep}nachbar`, tmpdir()])("relative cwd-Grenze verweigert %s", rest => { expect(() => c.pruefeCwdGrenze(rest)).toThrow("außerhalb"); });
test.each(["", "unterordner", "..prefix"])("relative cwd-Grenze erlaubt %s", rest => { expect(() => c.pruefeCwdGrenze(rest)).not.toThrow(); });

function fixture(mode = "ok") {
  const calls: Params[] = [], state = { profil: "", marker: "" };
  const abfragen: Abfragen = async (_s, p, fn, opts) => {
    state.profil = p.root; expect(opts.timeoutMs).toBe(40000);
    expect(readFileSync(join(p.env.CODEX_HOME, "config.toml"), "utf8")).toContain('sandbox="unelevated"');
    return fn((method, args) => {
      expect(method).toBe("command/exec"); calls.push(args);
      if (calls.length === 1) return Promise.resolve({ exitCode: mode === "kontrolle-exit" ? 1 : 0, stdout: mode === "kontrolle-text" ? "falsch" : "SANDBOX_KONTROLLE" });
      if (calls.length === 2) {
        state.marker = args.command[3];
        if (mode === "marker") writeFileSync(state.marker, "UEBERNOMMEN");
        if (mode === "rpc-deny") throw denial();
        if (mode === "rpc-code") throw denial(-32600);
        if (mode === "rpc-typ") throw denial(-32603, null);
        if (mode === "rpc-text") throw denial(-32603, "anderer Fehler");
        if (mode === "rpc-throw") throw new Error("Verbindung weg");
        return Promise.resolve({ exitCode: mode === "allow" ? 0 : mode === "canary-typ" ? "1" : 1 });
      }
      return Promise.resolve({ exitCode: mode === "exit-typ" ? 0.5 : 0, stdout: mode === "stdout-typ" ? null : "FIXTURE_OK", stderr: mode === "stderr-typ" ? null : "" });
    }, { userAgent: mode === "version" ? "fixture/0.165.0 " : "fixture/0.164.0 " });
  };
  return { abfragen, calls, state };
}
test.each(["ok", "rpc-deny"])("identische starre Policy für Kontrollen und Aktion: %s", async mode => {
  const root = temp(), f = fixture(mode); vi.stubEnv("OPENAI_API_KEY", "fixture-only");
  const a = { ...aktion(root), sandboxPolicy: { type: "dangerFullAccess" }, writableRoots: [tmpdir()] };
  expect(await c.sandboxAktion(a, { root, abfragen: f.abfragen })).toEqual({ code: 0, stdout: "FIXTURE_OK", stderr: "" });
  expect(f.calls).toHaveLength(3);
  for (const a of f.calls) {
    expect(a.sandboxPolicy).toEqual({ type: "workspaceWrite", writableRoots: [root], excludeSlashTmp: true, excludeTmpdirEnvVar: true, networkAccess: false });
    expect(a.cwd).toBe(root); expect(a.env).not.toHaveProperty("OPENAI_API_KEY"); expect(a).not.toHaveProperty("outputBytesCap");
  }
  expect(f.calls[2].command).toEqual(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Write-Output FIXTURE_OK"]);
  expect(f.calls[2].timeoutMs).toBe(30000); expect(existsSync(f.state.profil)).toBe(false); expect(existsSync(dirname(f.state.marker))).toBe(false);
});
test.each(["version", "kontrolle-exit", "kontrolle-text", "allow", "marker", "canary-typ", "rpc-code", "rpc-typ", "rpc-text", "rpc-throw", "exit-typ", "stdout-typ", "stderr-typ"])("Sandboxfehler %s stoppt und räumt auf", async mode => {
  const root = temp(), f = fixture(mode);
  await expect(c.sandboxAktion(aktion(root), { root, abfragen: f.abfragen })).rejects.toThrow();
  expect(f.calls.length).toBe(mode === "version" ? 0 : mode.startsWith("kontrolle") ? 1 : mode.endsWith("-typ") && mode !== "canary-typ" && mode !== "rpc-typ" ? 3 : 2);
  expect(existsSync(f.state.profil)).toBe(false);
  expect(f.state.marker === "" || !existsSync(dirname(f.state.marker))).toBe(true);
});
test("cwd außerhalb der kanonischen Hostwurzel startet keinen Server", async () => {
  const root = temp(), outside = temp(), abfragen = vi.fn();
  const link = join(root, "ausgang"); symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  await expect(c.sandboxAktion(aktion(outside), { root, abfragen })).rejects.toThrow("außerhalb");
  await expect(c.sandboxAktion(aktion(link), { root, abfragen })).rejects.toThrow("außerhalb"); expect(abfragen).not.toHaveBeenCalled();
});
test("Unterordner und Bash behalten dieselbe Hostwurzel", async () => {
  const root = temp(), sub = join(root, "unterordner"), f = fixture(); mkdirSync(sub);
  await c.sandboxAktion({ cwd: sub, tool_input: { shell: "bash", cmd: "echo FIXTURE_OK" } }, { root, abfragen: f.abfragen });
  expect(f.calls[2].cwd).toBe(sub); expect(f.calls[2].command).toEqual(["bash", "--noprofile", "--norc", "-c", "echo FIXTURE_OK"]);
  expect(f.calls[2].sandboxPolicy).toMatchObject({ writableRoots: [root] });
});
test.skipIf(!process.env.CODEX_SCHUTZ_PROBE)("native Sandbox: echter Innenwrite erlaubt und Außenwrite verweigert", async () => {
  const root = temp(), outside = temp(), inside = join(root, "innen.txt"), marker = join(outside, "aussen.txt"); writeFileSync(marker, "unveraendert");
  const input = (file: string) => process.platform === "win32"
    ? { shell: "powershell", cmd: `Set-Content -LiteralPath '${file.replaceAll("'", "''")}' -Value INNEN` }
    : { shell: "bash", cmd: `printf INNEN > ${JSON.stringify(file)}` };
  expect((await c.sandboxAktion({ cwd: root, tool_input: input(inside) }, { root })).code).toBe(0);
  expect(readFileSync(inside, "utf8").trim()).toBe("INNEN");
  await expect(c.sandboxAktion({ cwd: root, tool_input: input(marker) }, { root })).rejects.toThrow();
  expect(readFileSync(marker, "utf8")).toBe("unveraendert");
});
