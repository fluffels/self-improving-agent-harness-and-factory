// Kein Shebang: Lib ohne Einstieg (factory#395), von `audit-verzeichnisse.mjs` und `audit-einordnung.mjs` genutzt; nur Node-Builtins.
/**
 * Bausteine für npm audit je Lockfile-Verzeichnis: die Wurzel plus `audit.verzeichnisse` der Projekt-Config. Das Verzeichnis ist repo-relativ
 * (die Config-Prüfung `pruefeAudit` lehnt absolute Pfade und `..` ab) und wird als cwd übergeben, nie in eine Shell-Zeile.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const WURZEL = fileURLToPath(new URL("..", import.meta.url));

/** Pur: Wurzel (`.`) und die Verzeichnisse aus `audit.verzeichnisse`. */
export const auditVerzeichnisse = (config) => [".", ...(config?.audit?.verzeichnisse ?? [])];

/** `npm audit --json` in `verzeichnis` (relativ zur Repo-Wurzel). Bei Funden endet npm mit Exit 1 und gültigem JSON auf stdout. */
export function npmAuditJson(verzeichnis, extra = [], { fuehreAus = execFileSync, wurzel = WURZEL } = {}) {
  let text;
  try {
    text = fuehreAus("npm", ["audit", "--json", ...extra], { cwd: resolve(wurzel, verzeichnis), encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32" });
  } catch (err) {
    text = err?.stdout ? String(err.stdout) : "";
    if (!text) throw err;
  }
  return JSON.parse(text);
}
