// Begrenzte Kindprozesse mit expliziter Umgebung; keine Auth-/Config-Dateien übernehmen.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export const PROFIL = 'web_search="disabled"\n[features]\napps=false\nplugins=false\nremote_plugin=false\nmemories=false\nshell_tool=false\nrequest_permissions_tool=false\nmulti_agent=false\ncode_mode_host=false\ngoals=false\nview_image=false\n';
export function umgebung(home) {
  const env = { HOME: home, USERPROFILE: home, CODEX_HOME: join(home, ".codex"), APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata") };
  for (const key of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
export function profil(config = PROFIL) {
  const root = mkdtempSync(join(tmpdir(), "codex-schutz-")), home = join(root, "home"), env = umgebung(home);
  mkdirSync(env.CODEX_HOME, { recursive: true });
  writeFileSync(join(env.CODEX_HOME, "config.toml"), config);
  return { root, env, entfernen: () => rmSync(root, { recursive: true, force: true }) };
}
export function beenden(child, { platform = process.platform, treeKill = execFileSync, killGroup = process.kill } = {}) {
  if (child.exitCode !== null || child.signalCode || !child.pid) return;
  if (platform === "win32") {
    try { treeKill("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); } catch { child.kill(); }
  } else {
    try { killGroup(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  }
}
export function prozess(file, args, { cwd, env, input = "", timeoutMs = 3000, maxBytes = 1_000_000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "", bytes = 0, fehler;
    const stop = e => { fehler = e; beenden(child); };
    const timer = setTimeout(() => stop(new Error("Prozess-Frist überschritten")), timeoutMs);
    const sammeln = key => b => {
      bytes += b.length;
      if (bytes > maxBytes) { stop(new Error("Prozess-Ausgabe zu groß")); return; }
      if (key === "out") stdout += b; else stderr += b;
    };
    child.stdout.on("data", sammeln("out")); child.stderr.on("data", sammeln("err"));
    child.on("error", stop); child.stdin.on("error", stop);
    child.on("close", code => { clearTimeout(timer); if (fehler) reject(fehler); else resolve({ code, stdout, stderr }); });
    child.stdin.end(input);
  });
}
/** Nur feste administrative RPCs; Modell-/Shell-RPCs werden hier nie angeboten. */
export async function mitInventar(codex, p, fn, { start = spawn, timeoutMs = 5000 } = {}) {
  const child = start(codex, ["--strict-config", "app-server", "--stdio"], { cwd: p.root, env: p.env, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map(); let seq = 0, bytes = 0;
  const stop = e => { for (const waiter of pending.values()) waiter.reject(e); pending.clear(); beenden(child); };
  const timer = setTimeout(() => stop(new Error("Inventar-Frist überschritten")), timeoutMs);
  child.on("error", stop); child.stdin.on("error", stop); child.stderr.on("data", () => {});
  child.on("close", () => stop(new Error("Inventar-Prozess beendet")));
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    try {
      bytes += Buffer.byteLength(line);
      if (bytes > 1_000_000) throw new Error("Inventar zu groß");
      const m = JSON.parse(line), waiter = pending.get(m.id);
      if (waiter) { pending.delete(m.id); if (m.error) waiter.reject(new Error("Inventar-RPC fehlgeschlagen")); else waiter.resolve(m.result); }
    } catch (e) { stop(e); }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  try {
    const init = await rpc("initialize", { clientInfo: { name: "harness_schutz", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write('{"method":"initialized","params":{}}\n');
    return await fn(rpc, init);
  } finally {
    clearTimeout(timer); lines.close(); child.stdin.end(); beenden(child);
    await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once("close", resolve); });
  }
}
