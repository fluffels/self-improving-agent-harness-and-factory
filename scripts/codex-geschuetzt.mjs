// Geschützter Einzelaktionshost; keine freie Engine-/App-Sitzung wird gestartet.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { normalisiere } from "./codex-hook-lib.mjs";
import { profil, prozess, mitInventar, umgebung } from "./codex-prozess-lib.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const HOOK = fileURLToPath(new URL("codex-hook.mjs", import.meta.url));
export const hookBefehl = () => `"${process.execPath}" "${HOOK}"`;
export function hookDatei() {
  return JSON.stringify({ hooks: { PreToolUse: [{ matcher: ".*", hooks: [{ type: "command", command: hookBefehl(), timeout: 3 }] }] } });
}
export async function nativesInventar(codex = "codex", abfragen = mitInventar) {
  const p = profil();
  writeFileSync(join(p.env.CODEX_HOME, "hooks.json"), hookDatei());
  try {
    return await abfragen(codex, p, async (rpc, init) => {
      const entry = async () => {
        const r = await rpc("hooks/list", { cwds: [p.root] });
        if (r.data.length !== 1) throw new Error("Mehrdeutiges Hook-Inventar");
        return r.data[0];
      };
      let e = await entry();
      const h = e.hooks[0];
      if (e.errors.length || e.hooks.length !== 1 || h.command !== hookBefehl()) throw new Error("Unerwartete Hook-Quelle");
      // Ausschließlich die eben selbst erzeugte Registrierung vertrauen, niemals beliebigen Profilen.
      await rpc("config/value/write", { keyPath: `hooks.state.${JSON.stringify(h.key)}`, value: { trusted_hash: h.currentHash }, mergeStrategy: "replace" });
      e = await entry();
      const mcp = await rpc("mcpServerStatus/list", {});
      return { version: init.userAgent.split("/")[1].split(" ")[0], geschlossen: mcp.data.length === 0, hooks: e.hooks, errors: e.errors };
    });
  } finally { p.entfernen(); }
}
export function pruefeInventar(i) {
  if (i?.version !== "0.164.0" || i.geschlossen !== true || !Array.isArray(i.errors) || i.errors.length !== 0) throw new Error("Geschlossenes natives Inventar fehlt");
  if (!Array.isArray(i.hooks) || i.hooks.length !== 1) throw new Error("Hook fehlt/mehrdeutig");
  const h = i.hooks[0];
  if (h.eventName !== "preToolUse" || h.enabled !== true || !["trusted", "managed"].includes(h.trustStatus)) throw new Error("Hook nicht vertrauenswürdig geladen");
}
async function frist(fn, ms) {
  let timer;
  try { return await Promise.race([Promise.resolve().then(fn), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Guard-Frist überschritten")), ms); })]); }
  finally { clearTimeout(timer); }
}
async function guardProzess(a) {
  return prozess(process.execPath, [HOOK, "--host"], { cwd: ROOT, env: umgebung(ROOT), input: JSON.stringify(a), timeoutMs: 3000 });
}
async function ausfuehren(a) {
  const shells = { bash: ["bash", ["--noprofile", "--norc", "-c"]], powershell: ["powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]] };
  const [file, args] = shells[a.tool_input.shell];
  // Hier läuft exakt der vorab geprüfte Befehl; keine stdin-Sitzung und kein späterer write_stdin.
  return prozess(file, [...args, a.tool_input.cmd], { cwd: a.cwd, env: process.env, timeoutMs: 30000 });
}
export async function geschuetzteAktion(aktion, { inventar = nativesInventar, guard = guardProzess, executor = ausfuehren, timeoutMs = 5000 } = {}) {
  const serialisiert = JSON.stringify(normalisiere(aktion));
  // Andere fachlich abgebildete Routen besitzen noch keinen kontrollierten Executor.
  if (aktion.tool_name !== "exec_command") throw new Error("Abhängiger Ablauf gestoppt: Executor für diesen Werkzeugpfad fehlt");
  pruefeInventar(await frist(inventar, timeoutMs));
  const r = await frist(() => guard(JSON.parse(serialisiert)), timeoutMs);
  if (r?.code !== 0) throw new Error("Guard-Prozess nicht erfolgreich");
  const d = JSON.parse(r.stdout);
  if (d?.entscheidung !== "allow" || Object.keys(d).some(k => !["entscheidung", "grund"].includes(k))) throw new Error("Keine vollständige Guard-Freigabe");
  return executor(JSON.parse(serialisiert));
}
if (istDirektaufruf(import.meta.url)) {
  try { console.log(JSON.stringify(await geschuetzteAktion(JSON.parse(readFileSync(0, "utf8"))))); }
  catch (e) { console.error(`Codex-Aktion gestoppt: ${e.message}`); process.exitCode = 1; }
}
