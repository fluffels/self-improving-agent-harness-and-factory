// Nativer command/exec-Pfad; nie auf ungeschützte Prozessausführung zurückfallen.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFIL, profil, mitInventar } from "./codex-prozess-lib.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const KONTROLL_PROGRAMM = "const f=require('node:fs');f.writeFileSync(process.argv[1],'SANDBOX_KONTROLLE');f.writeFileSync(process.argv[2],'UEBERNOMMEN')";
export const SANDBOX_PROFIL = `${PROFIL}\n[windows]\nsandbox="unelevated"\n`;
export const SANDBOX_MS = 40000;
export function pruefeCwdGrenze(rest) {
  if (rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest)) throw new Error("cwd außerhalb des Host-Worktrees");
}
export function sandboxVorbereiten(a, { root = ROOT, p }) {
  root = realpathSync(root);
  const cwd = realpathSync(a.cwd); pruefeCwdGrenze(relative(root, cwd));
  let canary;
  try {
    canary = mkdtempSync(join(tmpdir(), "codex-schreibgrenze-"));
    const marker = join(canary, "marker.txt"), kontrolle = join(p.root, "kontrolle.txt");
    const sandboxPolicy = { type: "workspaceWrite", writableRoots: [root], excludeSlashTmp: true, excludeTmpdirEnvVar: true, networkAccess: false };
    return { initialisieren: () => writeFileSync(marker, "unveraendert"), entfernen: () => rmSync(canary, { recursive: true, force: true }), ausfuehren: async (rpc, init) => {
      if (!init.userAgent.includes("/0.164.0 ")) throw new Error("Nicht geprüfte Sandbox-Version");
      let verboten;
      try {
        verboten = await rpc("command/exec", { command: [process.execPath, "-e", KONTROLL_PROGRAMM, kontrolle, marker], cwd, sandboxPolicy: structuredClone(sandboxPolicy), env: { ...p.env }, timeoutMs: 3000 });
      }
      catch (e) {
        if (e.rpcCode !== -32603 || typeof e.rpcMessage !== "string" || !e.rpcMessage.startsWith("exec failed: sandbox error: sandbox denied exec error")) throw e;
        verboten = { exitCode: 1 };
      }
      if (readFileSync(kontrolle, "utf8") !== "SANDBOX_KONTROLLE") throw new Error("Sandbox-Kontrolle fehlgeschlagen");
      if (!Number.isInteger(verboten.exitCode) || verboten.exitCode === 0 || readFileSync(marker, "utf8") !== "unveraendert") throw new Error("Sandbox-Schreibgrenze nicht durchgesetzt");
      const shells = { bash: ["bash", "--noprofile", "--norc", "-c"], powershell: ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] };
      const r = await rpc("command/exec", { command: [...shells[a.tool_input.shell], a.tool_input.cmd], cwd, sandboxPolicy: structuredClone(sandboxPolicy), env: { ...p.env }, timeoutMs: 30000 });
      if (!Number.isInteger(r.exitCode) || typeof r.stdout !== "string" || typeof r.stderr !== "string") throw new Error("Ungültiges Sandbox-Ergebnis");
      return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    } };
  } catch (e) { if (canary) rmSync(canary, { recursive: true, force: true }); throw e; }
}
export async function sandboxAktion(a, { root = ROOT, abfragen = mitInventar } = {}) {
  const p = profil(SANDBOX_PROFIL); let schritt;
  try {
    schritt = sandboxVorbereiten(a, { root, p });
    schritt.initialisieren();
    return await abfragen("codex", p, schritt.ausfuehren, { timeoutMs: SANDBOX_MS });
  } finally { try { schritt?.entfernen(); } finally { p.entfernen(); } }
}
