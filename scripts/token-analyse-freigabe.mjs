/**
 * Freigabe, Ablage und Datenschutz-Grenzen der Token-Analyse (factory#518, Teil 5/9). Fabrik-eigen, nicht im Besitz, nie in einem Bezieher.
 *
 *   node scripts/token-analyse-freigabe.mjs pruefen
 *   node scripts/token-analyse-freigabe.mjs ablegen --eingabe <kennzahlen.json>
 *
 * `FACTORY_ANALYSE_FREIGABE`: Datei außerhalb des Repos, ein absoluter Pfad je Bezieher-Checkout (nur lokal, nie committet).
 * `FACTORY_ANALYSE_ABLAGE`: Ordner außerhalb von Repo, Worktrees und Bezieher-Checkouts für die Analyse-Schnappschüsse.
 * Gelesen wird nur aus Checkouts, die Git-Checkouts sind und dem angemeldeten Konto gehören (`gh api user`, die einzige Netzabfrage),
 * nur über die Allowlist der Lib; die Ausgabe nennt nur `Bezieher <k>`. Exit: 0 gut oder Teil 6 entfällt mit Hinweis, 1 Abbruch, 2 Aufruf oder Bezieher.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ghText } from "./gh-cli.mjs";
import { umgebungsWert } from "./projekt-config-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import {
  SCHUTZ_UMGEBUNG,
  bezieherLabel,
  befehlMitSchutz,
  enthaeltNamen,
  letzterSchnappschuss,
  parseFreigabeliste,
  pruefeAblage,
  pruefeBefehl,
  pruefeBezieher,
  remoteEigentuemer,
  schnappschussMarkdown,
  schnappschussName,
} from "./token-analyse-freigabe-lib.mjs";

const REPO_WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GROSSER_PUFFER = 64 * 1024 * 1024;

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

/** Text der `.git/config` (bei Worktree-Dateien dem `gitdir:` folgen, nur lesend); `null`, wenn es kein Checkout ist. */
export function liesGitConfig(wurzel) {
  try {
    const g = join(wurzel, ".git");
    if (statSync(g).isDirectory()) return readFileSync(join(g, "config"), "utf8");
    const treffer = /^gitdir:\s*(.+)$/m.exec(readFileSync(g, "utf8"));
    if (!treffer) return null;
    const gitdir = resolve(wurzel, treffer[1].trim());
    const common = existsSync(join(gitdir, "commondir")) ? resolve(gitdir, readFileSync(join(gitdir, "commondir"), "utf8").trim()) : gitdir;
    return readFileSync(join(common, "config"), "utf8");
  } catch {
    return null;
  }
}

/** Der einzige Prozessaufruf: ohne Shell, mit Schutz-Umgebung. Tests injizieren einen Mitschnitt. */
export function standardRunner(argv, { cwd } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", shell: false, cwd, env: { ...process.env, ...SCHUTZ_UMGEBUNG }, maxBuffer: GROSSER_PUFFER, windowsHide: true });
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

function abhaengigkeiten(deps = {}) {
  const repoWurzel = deps.repoWurzel ?? REPO_WURZEL;
  return {
    repoWurzel: realMitVorfahr(repoWurzel),
    worktrees: (deps.worktrees ?? standardWorktrees(repoWurzel)).map(realMitVorfahr),
    login: () => (deps.login === undefined ? standardLogin() : deps.login),
    runner: deps.runner ?? standardRunner,
  };
}

/** Liest die Freigabeliste; `{ hinweis }` wenn Variable oder Datei fehlen, `{ fehler }` bei kaputter Liste. */
function ladeListe(env) {
  const pfad = (umgebungsWert(env, "FACTORY_ANALYSE_FREIGABE") ?? "").trim();
  if (!pfad) return { hinweis: "Hinweis: Teil 6 entfällt (keine Freigabeliste: FACTORY_ANALYSE_FREIGABE nicht gesetzt)" };
  if (!existsSync(pfad)) return { hinweis: "Hinweis: Teil 6 entfällt (keine Freigabeliste: Datei fehlt)" };
  try {
    return { listePfad: pfad, pfade: parseFreigabeliste(readFileSync(pfad, "utf8")) };
  } catch (e) {
    return { fehler: `Freigabeliste ungültig: ${e.message}` };
  }
}

function pruefeEinen(wurzel, login) {
  const konfig = liesGitConfig(wurzel);
  return pruefeBezieher({ istCheckout: konfig !== null, eigentuemer: konfig === null ? null : remoteEigentuemer(konfig), login });
}

function ablageFehler(env, d, bezieherWurzeln) {
  const roh = (umgebungsWert(env, "FACTORY_ANALYSE_ABLAGE") ?? "").trim();
  if (!roh) return { fehler: "FACTORY_ANALYSE_ABLAGE nicht gesetzt: nichts geschrieben" };
  const ablage = realMitVorfahr(roh);
  const p = pruefeAblage({ ablage, repoWurzel: d.repoWurzel, worktrees: d.worktrees, bezieherWurzeln });
  return p.ok ? { ablage } : { fehler: `${p.grund}: abgebrochen, nichts geschrieben` };
}

/**
 * Freigabestatus je „Bezieher k“ plus Ablageprüfung. Liefert `{ code, zeilen, freigegeben: [{ k, wurzel }] }`; `freigegeben` ist leer, wenn Teil 6 entfällt.
 */
export function pruefen(env, deps) {
  const liste = ladeListe(env);
  if (liste.hinweis) return { code: 0, zeilen: [liste.hinweis], freigegeben: [] };
  if (liste.fehler) return { code: 1, zeilen: [liste.fehler], freigegeben: [] };
  const d = abhaengigkeiten(deps);
  const wurzeln = liste.pfade.map(realMitVorfahr);
  const ort = pruefeAblage({ ablage: realMitVorfahr(liste.listePfad), repoWurzel: d.repoWurzel, worktrees: d.worktrees, bezieherWurzeln: wurzeln, art: "Freigabeliste" });
  if (!ort.ok) return { code: 1, zeilen: [`${ort.grund}: abgebrochen`], freigegeben: [] };
  const ablage = ablageFehler(env, d, wurzeln);
  if (ablage.fehler) return { code: 1, zeilen: [ablage.fehler], freigegeben: [] };
  const login = d.login();
  if (!login) return { code: 0, zeilen: ["Hinweis: Teil 6 entfällt (angemeldetes Konto nicht ermittelbar: gh api user)"], freigegeben: [] };
  const zeilen = [];
  const freigegeben = [];
  wurzeln.forEach((wurzel, i) => {
    const k = i + 1;
    const p = pruefeEinen(wurzel, login);
    zeilen.push(`${bezieherLabel(k)}: ${p.ok ? "freigegeben" : `abgebrochen (${p.grund})`}`);
    if (p.ok) freigegeben.push({ k, wurzel });
  });
  return { code: 0, zeilen, freigegeben };
}

/**
 * Führt einen lesenden Befehl für einen freigegebenen „Bezieher k“ aus (Teil 6). Alles außerhalb der Allowlist oder für einen nicht
 * freigegebenen Bezieher wird abgelehnt, ohne dass ein Prozess startet.
 */
export function fuehreFreigegebenAus(k, argv, freigegeben, deps = {}) {
  const eintrag = freigegeben.find((f) => f.k === k);
  if (!eintrag) return { abgelehnt: `${bezieherLabel(k)} nicht freigegeben` };
  const real = deps.real ?? realMitVorfahr;
  const p = pruefeBefehl(argv, { wurzel: eintrag.wurzel, real });
  if (!p.ok) return { abgelehnt: p.grund };
  return (deps.runner ?? standardRunner)(befehlMitSchutz(argv), { cwd: eintrag.wurzel });
}

function leseEingabe(pfad) {
  const e = JSON.parse(readFileSync(pfad, "utf8"));
  const heute = new Date().toISOString().slice(0, 10);
  if (!e || typeof e.kennzahlen !== "object" || e.kennzahlen === null || Array.isArray(e.kennzahlen)) throw new Error("kennzahlen fehlt");
  return { datum: e.datum ?? heute, anzahlBezieher: Number.isInteger(e.anzahlBezieher) ? e.anzahlBezieher : 0, kennzahlen: e.kennzahlen };
}

function vorherAus(ordner, dateien) {
  const name = letzterSchnappschuss(dateien);
  try {
    return name ? JSON.parse(readFileSync(join(ordner, name), "utf8")) : null;
  } catch {
    return null;
  }
}

/** Legt den Analyse-Schnappschuss (`.json` und `.md`) in der Ablage ab; prüft zuerst Ablage und Namensleck. */
export function ablegen(env, eingabePfad, deps) {
  const liste = ladeListe(env);
  if (liste.fehler) return { code: 1, zeilen: [`${liste.fehler}: abgebrochen, nichts geschrieben`] };
  const pfade = liste.pfade ?? [];
  const d = abhaengigkeiten(deps);
  const ablage = ablageFehler(env, d, pfade.map(realMitVorfahr));
  if (ablage.fehler) return { code: 1, zeilen: [ablage.fehler] };
  let eingabe;
  try {
    eingabe = leseEingabe(eingabePfad);
  } catch (e) {
    return { code: 2, zeilen: [`Eingabe ungültig: ${e.message}`] };
  }
  mkdirSync(ablage.ablage, { recursive: true });
  const dateien = readdirSync(ablage.ablage);
  const md = schnappschussMarkdown({ ...eingabe, vorher: vorherAus(ablage.ablage, dateien) });
  const json = `${JSON.stringify({ version: 1, datum: eingabe.datum, anzahlBezieher: eingabe.anzahlBezieher, kennzahlen: eingabe.kennzahlen }, null, 2)}\n`;
  if (enthaeltNamen(md + json, pfade)) return { code: 1, zeilen: ["Schnappschuss enthält einen Namen aus der Freigabeliste: abgebrochen, nichts geschrieben"] };
  const name = schnappschussName(eingabe.datum, dateien);
  writeFileSync(join(ablage.ablage, `${name}.json`), json, { flag: "wx" });
  writeFileSync(join(ablage.ablage, `${name}.md`), md, { flag: "wx" });
  return { code: 0, zeilen: [`Analyse-Schnappschuss abgelegt: ${name}`] };
}

/** Einstieg: die Bezieher-Sperre steht zuerst (die Analyse läuft nur in der Fabrik und schreibt nie in einen Bezieher). */
export function cli(argv, env = process.env, deps = {}) {
  if (istBezieher(deps.repoWurzel ?? REPO_WURZEL)) return { code: 2, zeilen: ["token-analyse-freigabe läuft nur in der Fabrik, nicht in einem Bezieher"] };
  const [befehl, flag, eingabe] = argv;
  if (befehl === "pruefen" && argv.length === 1) return pruefen(env, deps);
  if (befehl === "ablegen" && flag === "--eingabe" && eingabe && argv.length === 3) return ablegen(env, eingabe, deps);
  return { code: 2, zeilen: ["Aufruf: node scripts/token-analyse-freigabe.mjs (pruefen | ablegen --eingabe <datei>)"] };
}

if (istDirektaufruf(import.meta.url)) {
  const r = cli(process.argv.slice(2));
  process.stdout.write(`${r.zeilen.join("\n")}\n`);
  process.exitCode = r.code;
}
