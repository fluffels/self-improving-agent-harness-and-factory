#!/usr/bin/env node
/**
 * npm audit je Lockfile-Verzeichnis (factory#395): die Wurzel plus die Verzeichnisse aus `audit.verzeichnisse` der Projekt-Config.
 * Ohne den Block prüft das Skript nur die Wurzel, wie das bisherige `npm audit`.
 *
 * Aufruf: node scripts/audit-verzeichnisse.mjs --audit-level <info|low|moderate|high|critical>
 * Exit: 0 alle Verzeichnisse sauber, 1 mindestens eines rot (alle werden geprüft, kein Abbruch beim ersten), 2 falsche Bedienung oder Config nicht lesbar.
 *
 * Wiederverwendet von `audit-einordnung.mjs` (`npmAuditJson`, `auditVerzeichnisse`). Das Verzeichnis ist repo-relativ (die Config-Prüfung
 * `pruefeAudit` lehnt absolute Pfade und `..` ab) und wird als cwd übergeben, nie in eine Shell-Zeile.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const STUFEN = ["info", "low", "moderate", "high", "critical"];
const EXIT_AUFRUF = 2;

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

/** Standard-Lauf: `npm audit --audit-level=<stufe>` mit sichtbarer Ausgabe; Rückgabe ist der Exit-Code von npm. */
function npmAuditStufe(verzeichnis, args) {
  try {
    execFileSync("npm", ["audit", ...args], { cwd: resolve(WURZEL, verzeichnis), stdio: "inherit", shell: process.platform === "win32" });
    return 0;
  } catch (err) {
    return typeof err?.status === "number" && err.status !== 0 ? err.status : 1;
  }
}

function stufeAusArgv(argv) {
  const [flag, stufe, ...rest] = argv;
  return flag === "--audit-level" && STUFEN.includes(stufe) && rest.length === 0 ? stufe : undefined;
}

/** Einstieg. `deps` (Tests): `ladeConfig()`, `fuehreAus(verzeichnis, args)` (liefert den Exit-Code), `log`, `err`. Rückgabe: Exit-Code. */
export function main(argv = process.argv.slice(2), { ladeConfig = () => ladeProjektConfig(), fuehreAus = npmAuditStufe, log = console.log, err = console.error } = {}) {
  const stufe = stufeAusArgv(argv);
  if (!stufe) {
    err(`✖ Aufruf: node scripts/audit-verzeichnisse.mjs --audit-level <${STUFEN.join("|")}>`);
    return EXIT_AUFRUF;
  }
  let config;
  try {
    config = ladeConfig();
  } catch (e) {
    err(`✖ Projekt-Config nicht lesbar: ${e instanceof Error ? e.message : e}`);
    return EXIT_AUFRUF;
  }
  const rot = auditVerzeichnisse(config).filter((v) => {
    log(`npm audit (${v}), Stufe ${stufe}`);
    return fuehreAus(v, [`--audit-level=${stufe}`]) !== 0;
  });
  if (rot.length > 0) log(`✖ Advisories ab ${stufe} in: ${rot.join(", ")}`);
  return rot.length > 0 ? 1 : 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
