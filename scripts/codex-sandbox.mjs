// Nativer command/exec-Pfad; nie auf ungeschützte Prozessausführung zurückfallen.
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFIL, profil, mitInventar } from "./codex-prozess-lib.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const SANDBOX_PROFIL = `${PROFIL}\n[windows]\nsandbox="unelevated"\n`;
export function pruefeCwdGrenze(rest) {
  if (rest === ".." || rest.startsWith(`..${sep}`) || isAbsolute(rest)) throw new Error("cwd außerhalb des Host-Worktrees");
}
export async function sandboxAktion(a, { root = ROOT, abfragen = mitInventar } = {}) {
  root = realpathSync(root);
  const cwd = realpathSync(a.cwd); pruefeCwdGrenze(relative(root, cwd));
  const p = profil(SANDBOX_PROFIL), canary = mkdtempSync(join(tmpdir(), "codex-schreibgrenze-")), marker = join(canary, "marker.txt");
  writeFileSync(marker, "unveraendert");
  const sandboxPolicy = { type: "workspaceWrite", writableRoots: [root], excludeSlashTmp: true, excludeTmpdirEnvVar: true, networkAccess: false };
  try {
    return await abfragen("codex", p, async (rpc, init) => {
      if (!init.userAgent.includes("/0.164.0 ")) throw new Error("Nicht geprüfte Sandbox-Version");
      const exec = command => rpc("command/exec", { command, cwd, sandboxPolicy: structuredClone(sandboxPolicy), env: { ...p.env }, timeoutMs: 3000 });
      const kontrolle = await exec([process.execPath, "-e", "process.stdout.write('SANDBOX_KONTROLLE')"]);
      if (kontrolle.exitCode !== 0 || kontrolle.stdout !== "SANDBOX_KONTROLLE") throw new Error("Sandbox-Kontrolle fehlgeschlagen");
      let verboten;
      try { verboten = await exec([process.execPath, "-e", "require('node:fs').writeFileSync(process.argv[1],'UEBERNOMMEN')", marker]); }
      catch (e) {
        if (e.rpcCode !== -32603 || typeof e.rpcMessage !== "string" || !e.rpcMessage.startsWith("exec failed: sandbox error: sandbox denied exec error")) throw e;
        verboten = { exitCode: 1 };
      }
      if (!Number.isInteger(verboten.exitCode) || verboten.exitCode === 0 || readFileSync(marker, "utf8") !== "unveraendert") throw new Error("Sandbox-Schreibgrenze nicht durchgesetzt");
      const shells = { bash: ["bash", "--noprofile", "--norc", "-c"], powershell: ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command"] };
      const r = await rpc("command/exec", { command: [...shells[a.tool_input.shell], a.tool_input.cmd], cwd, sandboxPolicy: structuredClone(sandboxPolicy), env: { ...p.env }, timeoutMs: 30000 });
      if (!Number.isInteger(r.exitCode) || typeof r.stdout !== "string" || typeof r.stderr !== "string") throw new Error("Ungültiges Sandbox-Ergebnis");
      return { code: r.exitCode, stdout: r.stdout, stderr: r.stderr };
    }, { timeoutMs: 40000 });
  } finally { try { rmSync(canary, { recursive: true, force: true }); } finally { p.entfernen(); } }
}
