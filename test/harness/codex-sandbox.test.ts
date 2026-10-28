/* @harness-waechter: native Schreibgrenze vor jeder Hostaktion, ohne Fallback (#84). */
import { afterEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error: Node-Skript ohne Declaration.
import * as raw from "../../scripts/codex-sandbox.mjs";
const fsFault = vi.hoisted(() => ({ stage: "", profil: "", canary: "", created: [] as string[] }));
vi.mock("node:fs", async importOriginal => {
  const fs = await importOriginal<typeof import("node:fs")>();
  const fehler = () => Object.assign(new Error("fixture ENOSPC"), { code: "ENOSPC" });
  return { ...fs,
    mkdtempSync: (...args: Parameters<typeof fs.mkdtempSync>) => {
      const prefix = String(args[0]), art = prefix.includes("codex-schreibgrenze-") ? "canary" : prefix.includes("codex-schutz-") ? "profil" : "";
      if (art !== "" && fsFault.stage === art) throw fehler();
      const dir = fs.mkdtempSync(...args);
      if (fsFault.stage !== "" && art !== "") { fsFault[art] = String(dir); fsFault.created.push(String(dir)); }
      return dir;
    },
    mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) => {
      if ((fsFault.stage === "mkdir" && String(args[0]).endsWith(".codex")) || (fsFault.stage === "roaming" && String(args[0]).endsWith("Roaming")) || (fsFault.stage === "local" && String(args[0]).endsWith("Local"))) throw fehler();
      return fs.mkdirSync(...args);
    },
    writeFileSync: (...args: Parameters<typeof fs.writeFileSync>) => {
      if ((fsFault.stage === "config" && String(args[0]).endsWith("config.toml")) || (fsFault.stage === "marker" && String(args[0]).endsWith("marker.txt"))) throw fehler();
      return fs.writeFileSync(...args);
    },
  };
});
type Params = { command: string[]; cwd: string; sandboxPolicy: unknown; env: Record<string, string>; timeoutMs: number };
type Rpc = (method: string, params: Params) => Promise<Record<string, unknown>>;
type Profil = { root: string; env: Record<string, string> };
type Aktion = { cwd: string; tool_input: { cmd: string; shell: string } };
type Abfragen = (s: string, p: Profil, fn: (rpc: Rpc, init: { userAgent: string }) => Promise<unknown>, opts: { timeoutMs: number }) => Promise<unknown>;
type SandboxSchritt = { ausfuehren: (rpc: Rpc, init: { userAgent: string }) => Promise<unknown>; initialisieren: () => void; entfernen: () => void };
const c = raw as unknown as { pruefeCwdGrenze: (rest: string) => void; sandboxAktion: (a: Aktion, deps?: { root: string; abfragen?: Abfragen }) => Promise<{ code: number; stdout: string; stderr: string }>; sandboxVorbereiten: (a: Aktion, deps: { root: string; p: Profil }) => SandboxSchritt };
const temps: string[] = [];
afterEach(() => { fsFault.stage = ""; fsFault.profil = ""; fsFault.canary = ""; for (const dir of [...temps.splice(0), ...fsFault.created.splice(0)]) rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs(); });
const temp = () => { const dir = mkdtempSync(join(tmpdir(), "codex-sandbox-test-")); temps.push(dir); return dir; };
const aktion = (cwd: string): Aktion => ({ cwd, tool_input: { cmd: "Write-Output FIXTURE_OK", shell: "powershell" } });
const denial = (rpcCode: unknown = -32603, rpcMessage: unknown = "exec failed: sandbox error: sandbox denied exec error, exit code: 1") => Object.assign(new Error("RPC verweigert"), { rpcCode, rpcMessage });
test("Sandboxschritt nutzt die bestehende Sitzung und überlässt Cleanup ihrem Besitzer", async () => {
  const root = temp(), profilRoot = temp(), p = { root: profilRoot, env: {} }, calls: Params[] = [];
  const schritt = c.sandboxVorbereiten(aktion(root), { root, p });
  schritt.initialisieren();
  const rpc: Rpc = (_method, args) => {
    calls.push(args);
    if (calls.length === 1) { writeFileSync(args.command[3], "SANDBOX_KONTROLLE"); return Promise.resolve({ exitCode: 1 }); }
    return Promise.resolve({ exitCode: 0, stdout: "FIXTURE_OK", stderr: "" });
  };
  try {
    expect(await schritt.ausfuehren(rpc, { userAgent: "fixture/0.164.0 " })).toEqual({ code: 0, stdout: "FIXTURE_OK", stderr: "" });
    expect(calls).toHaveLength(2); expect(calls[0].sandboxPolicy).toEqual(calls[1].sandboxPolicy);
    expect(existsSync(dirname(calls[0].command[4]))).toBe(true); expect(existsSync(profilRoot)).toBe(true);
  } finally { schritt.entfernen(); }
  expect(existsSync(dirname(calls[0].command[4]))).toBe(false); expect(existsSync(profilRoot)).toBe(true);
});
test.each(["..", `..${sep}nachbar`, tmpdir()])("relative cwd-Grenze verweigert %s", rest => { expect(() => c.pruefeCwdGrenze(rest)).toThrow("außerhalb"); });
test.each(["", "unterordner", "..prefix"])("relative cwd-Grenze erlaubt %s", rest => { expect(() => c.pruefeCwdGrenze(rest)).not.toThrow(); });
test.each(["profil", "mkdir", "roaming", "local", "config", "canary", "marker"])("Initialisierungsfehler %s hinterlässt keine Ressourcen und startet keinen Server", async stage => {
  const root = temp(), abfragen = vi.fn(); fsFault.stage = stage;
  await expect(c.sandboxAktion(aktion(root), { root, abfragen })).rejects.toThrow("fixture ENOSPC");
  expect(abfragen).not.toHaveBeenCalled();
  expect(fsFault.profil === "" || !existsSync(fsFault.profil)).toBe(true);
  expect(fsFault.canary === "" || !existsSync(fsFault.canary)).toBe(true);
});
test("kombinierter Host bereinigt auch Markerinitialisierungsfehler erst nach Sitzungsende", async () => {
  // @ts-expect-error: Node-Skript ohne Declaration.
  const host = await import("../../scripts/codex-geschuetzt.mjs") as { hookBefehl: () => string; geschuetzterHost: (a: unknown, o: unknown) => Promise<unknown> };
  fsFault.stage = "marker"; let closed = false;
  const abfragen: Abfragen = async (_s, p, fn) => {
    const h = { eventName: "preToolUse", enabled: true, trustStatus: "trusted", command: host.hookBefehl(), key: "fixture", currentHash: "fixture" };
    const rpc = (method: string) => Promise.resolve(method === "hooks/list" ? { data: [{ hooks: [h], errors: [] }] } : method === "mcpServerStatus/list" ? { data: [] } : {});
    try { return await (fn as unknown as (call: (method: string) => Promise<unknown>, init: unknown, phase: () => void) => Promise<unknown>)(rpc, { userAgent: "fixture/0.164.0 " }, () => {}); }
    finally { expect(existsSync(p.root)).toBe(true); expect(existsSync(fsFault.canary)).toBe(true); closed = true; }
  };
  await expect(host.geschuetzterHost({ ...aktion(process.cwd()), tool_name: "exec_command" }, { abfragen, guard: () => Promise.resolve({ code: 0, stdout: '{"entscheidung":"allow"}' }) })).rejects.toThrow("fixture ENOSPC");
  expect(closed).toBe(true); expect(existsSync(fsFault.canary)).toBe(false); expect(existsSync(fsFault.profil)).toBe(false);
});

function fixture(mode = "ok") {
  const calls: Params[] = [], state = { profil: "", marker: "", kontrolle: "" };
  const abfragen: Abfragen = async (_s, p, fn, opts) => {
    state.profil = p.root; expect(opts.timeoutMs).toBe(40000);
    expect(readFileSync(join(p.env.CODEX_HOME, "config.toml"), "utf8")).toContain('sandbox="unelevated"');
    return fn((method, args) => {
      expect(method).toBe("command/exec"); calls.push(args);
      if (calls.length === 1) {
        expect(args.command).toHaveLength(5);
        state.kontrolle = args.command[3]; state.marker = args.command[4];
        if (mode !== "kontrolle-fehlt") writeFileSync(state.kontrolle, mode === "kontrolle-text" ? "falsch" : "SANDBOX_KONTROLLE");
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
  expect(f.calls).toHaveLength(2);
  for (const a of f.calls) {
    expect(a.sandboxPolicy).toEqual({ type: "workspaceWrite", writableRoots: [root], excludeSlashTmp: true, excludeTmpdirEnvVar: true, networkAccess: false });
    expect(a.cwd).toBe(root); expect(a.env).not.toHaveProperty("OPENAI_API_KEY"); expect(a).not.toHaveProperty("outputBytesCap");
  }
  expect(f.calls[0].command.slice(0, 2)).toEqual([process.execPath, "-e"]);
  expect(f.calls[0].command[2]).toContain("writeFileSync(process.argv[1]");
  expect(f.calls[0].command[2]).toContain("writeFileSync(process.argv[2]");
  expect(f.calls[1].command).toEqual(["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Write-Output FIXTURE_OK"]);
  expect(f.calls[1].timeoutMs).toBe(30000); expect(existsSync(f.state.profil)).toBe(false); expect(existsSync(dirname(f.state.marker))).toBe(false);
});
test.each(["version", "kontrolle-fehlt", "kontrolle-text", "allow", "marker", "canary-typ", "rpc-code", "rpc-typ", "rpc-text", "rpc-throw", "exit-typ", "stdout-typ", "stderr-typ"])("Sandboxfehler %s stoppt und räumt auf", async mode => {
  const root = temp(), f = fixture(mode);
  await expect(c.sandboxAktion(aktion(root), { root, abfragen: f.abfragen })).rejects.toThrow();
  expect(f.calls.length).toBe(mode === "version" ? 0 : mode.endsWith("-typ") && mode !== "canary-typ" && mode !== "rpc-typ" ? 2 : 1);
  expect(existsSync(f.state.profil)).toBe(false);
  expect(f.state.marker === "" || !existsSync(dirname(f.state.marker))).toBe(true);
});

test("ignorierte Sandbox: echtes Kontrollprogramm verändert Außenmarker und stoppt vor Nutzeraktion", async () => {
  const root = temp(); let calls = 0, profil = "", marker = "";
  const abfragen: Abfragen = (_s, p, fn) => {
    profil = p.root;
    return fn((_method, args) => {
      calls++;
      if (calls > 1) return Promise.resolve({ exitCode: 0, stdout: "NUTZERAKTION_ERREICHT", stderr: "" });
      marker = args.command[4];
      const r = spawnSync(args.command[0], args.command.slice(1), { cwd: args.cwd, env: args.env, encoding: "utf8" });
      expect(readFileSync(args.command[3], "utf8")).toBe("SANDBOX_KONTROLLE");
      expect(readFileSync(marker, "utf8")).toBe("UEBERNOMMEN");
      return Promise.resolve({ exitCode: r.status, stdout: r.stdout, stderr: r.stderr });
    }, { userAgent: "fixture/0.164.0 " });
  };
  await expect(c.sandboxAktion(aktion(root), { root, abfragen })).rejects.toThrow("Sandbox-Schreibgrenze nicht durchgesetzt");
  expect(calls).toBe(1); expect(existsSync(profil)).toBe(false); expect(existsSync(dirname(marker))).toBe(false);
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
  expect(f.calls[1].cwd).toBe(sub); expect(f.calls[1].command).toEqual(["bash", "--noprofile", "--norc", "-c", "echo FIXTURE_OK"]);
  expect(f.calls[1].sandboxPolicy).toMatchObject({ writableRoots: [root] });
});
const nativesInput = (file: string) => process.platform === "win32"
  ? { shell: "powershell", cmd: `Set-Content -LiteralPath '${file.replaceAll("'", "''")}' -Value INNEN` }
  : { shell: "bash", cmd: `printf INNEN > ${JSON.stringify(file)}` };

test.skipIf(!process.env.CODEX_SCHUTZ_PROBE)("native Sandbox: echter Innenwrite erlaubt", async () => {
  const root = temp(), inside = join(root, "innen.txt");
  expect((await c.sandboxAktion({ cwd: root, tool_input: nativesInput(inside) }, { root })).code).toBe(0);
  expect(readFileSync(inside, "utf8").trim()).toBe("INNEN");
});

test.skipIf(!process.env.CODEX_SCHUTZ_PROBE)("native Sandbox: echter Außenwrite verweigert", async () => {
  const root = temp(), outside = temp(), marker = join(outside, "aussen.txt"); writeFileSync(marker, "unveraendert");
  await expect(c.sandboxAktion({ cwd: root, tool_input: nativesInput(marker) }, { root })).rejects.toThrow();
  expect(readFileSync(marker, "utf8")).toBe("unveraendert");
});
