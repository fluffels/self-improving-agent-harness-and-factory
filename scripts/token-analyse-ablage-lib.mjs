// Kein Shebang: Lib ohne Einstieg. Geteilte Ablage-, Listen- und Prozess-Helfer der Token-Analyse (factory#518): Freigabe und Ticket-Anlage nutzen sie, kein Skript importiert aus einem Einstiegsskript.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ghText } from "./gh-cli.mjs";
import { umgebungsWert } from "./projekt-config-lib.mjs";
import { SCHUTZ_UMGEBUNG, parseFreigabeliste, pruefeAblage } from "./token-analyse-freigabe-lib.mjs";

export const REPO_WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Realpath, auch für einen Pfad, den es noch nicht gibt (nächster vorhandener Vorfahr plus Rest). */
export function realMitVorfahr(pfad) {
  const abs = resolve(pfad);
  const rest = [];
  for (let cur = abs; ; cur = dirname(cur)) {
    if (existsSync(cur)) return join(realpathSync.native(cur), ...rest.reverse());
    if (dirname(cur) === cur) return abs;
    rest.push(basename(cur));
  }
}

/** Der einzige Prozessaufruf: ohne Shell, mit Schutz-Umgebung. Tests injizieren einen Mitschnitt. */
export function standardRunner(argv, { cwd } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", shell: false, cwd, env: { ...process.env, ...SCHUTZ_UMGEBUNG }, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function standardLogin() {
  try {
    return ghText(["api", "user", "--jq", ".login"], { timeout: 20000 }).trim() || null;
  } catch {
    return null;
  }
}

function standardWorktrees(repoWurzel) {
  const r = standardRunner(["git", "-C", repoWurzel, "worktree", "list", "--porcelain"]);
  return r.stdout.split(/\r?\n/).filter((z) => z.startsWith("worktree ")).map((z) => z.slice("worktree ".length));
}

export function abhaengigkeiten(deps = {}) {
  const repoWurzel = deps.repoWurzel ?? REPO_WURZEL;
  return {
    repoWurzel: realMitVorfahr(repoWurzel),
    worktrees: (deps.worktrees ?? standardWorktrees(repoWurzel)).map(realMitVorfahr),
    login: () => (deps.login === undefined ? standardLogin() : deps.login),
    runner: deps.runner ?? standardRunner,
  };
}

/** Liest die Freigabeliste; `{ hinweis }` wenn Variable oder Datei fehlen, `{ fehler }` bei kaputter Liste. */
export function ladeListe(env) {
  const pfad = (umgebungsWert(env, "FACTORY_ANALYSE_FREIGABE") ?? "").trim();
  if (!pfad) return { hinweis: "Hinweis: Teil 6 entfällt (keine Freigabeliste: FACTORY_ANALYSE_FREIGABE nicht gesetzt)" };
  if (!existsSync(pfad)) return { hinweis: "Hinweis: Teil 6 entfällt (keine Freigabeliste: Datei fehlt)" };
  try {
    return { listePfad: pfad, pfade: parseFreigabeliste(readFileSync(pfad, "utf8")) };
  } catch (e) {
    return { fehler: `Freigabeliste ungültig: ${e.message}` };
  }
}

export function ablageFehler(env, d, bezieherWurzeln) {
  const roh = (umgebungsWert(env, "FACTORY_ANALYSE_ABLAGE") ?? "").trim();
  if (!roh) return { fehler: "FACTORY_ANALYSE_ABLAGE nicht gesetzt: nichts geschrieben" };
  const ablage = realMitVorfahr(roh);
  const p = pruefeAblage({ ablage, repoWurzel: d.repoWurzel, worktrees: d.worktrees, bezieherWurzeln });
  return p.ok ? { ablage } : { fehler: `${p.grund}: abgebrochen, nichts geschrieben` };
}

