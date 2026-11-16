/**
 * Freigabe, Ablage und Datenschutz-Grenzen der Token-Analyse (factory#518, Teil 5/9). Fabrik-eigen, nicht im Besitz, nie in einem Bezieher.
 *   node scripts/token-analyse-freigabe.mjs pruefen | lesen <k> <git|wc …> | ablegen --eingabe <kennzahlen.json>
 * `FACTORY_ANALYSE_FREIGABE`: Datei außerhalb des Repos, ein absoluter Pfad je Bezieher-Checkout. `FACTORY_ANALYSE_ABLAGE`: Ordner außerhalb von
 * Repo, Worktrees und Bezieher-Checkouts. Gelesen wird nur aus Checkouts des angemeldeten Kontos (`gh api user`) über die Allowlist der Lib;
 * die Ausgabe nennt nur `Bezieher <k>`. Exit: 0 gut oder Teil 6 entfällt mit Hinweis, 1 Abbruch, 2 Aufruf oder Bezieher.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import {
  bezieherLabel,
  befehlMitSchutz,
  enthaeltNamen,
  letzterSchnappschuss,
  pruefeAblage,
  pruefeBefehl,
  pruefeBezieher,
  remoteEigentuemer,
  schnappschussMarkdown,
  schnappschussName,
} from "./token-analyse-freigabe-lib.mjs";

import { REPO_WURZEL, ablageFehler, abhaengigkeiten, ladeListe, realMitVorfahr, standardRunner } from "./token-analyse-ablage-lib.mjs";

export { realMitVorfahr, standardRunner }; // von den Tests und früheren Aufrufern hier erwartet
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

function pruefeEinen(wurzel, login) {
  const konfig = liesGitConfig(wurzel);
  return pruefeBezieher({ istCheckout: konfig !== null, eigentuemer: konfig === null ? null : remoteEigentuemer(konfig), login });
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

/** Lesender Befehl für „Bezieher k“ über die Allowlist (Teil 6); bei `git` setzt der Aufruf `-C <Wurzel>` selbst, der Aufrufer kennt keinen Pfad. */
export function lesen(env, k, argv, deps) {
  const p = pruefen(env, deps);
  if (p.code !== 0) return { code: p.code, zeilen: p.zeilen };
  if (!p.freigegeben.some((x) => x.k === k)) return { code: 2, zeilen: [`${bezieherLabel(k)} nicht freigegeben`] };
  const wurzel = p.freigegeben.find((x) => x.k === k).wurzel;
  const voll = argv[0] === "git" ? ["git", "-C", wurzel, ...argv.slice(1)] : argv;
  const r = fuehreFreigegebenAus(k, voll, p.freigegeben, { runner: deps?.runner });
  if (r.abgelehnt) return { code: 2, zeilen: [`abgelehnt: ${r.abgelehnt}`] };
  return { code: r.status === 0 ? 0 : 1, zeilen: r.stdout.split(/\r?\n/).filter((z) => z !== "") };
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
  if (befehl === "lesen" && /^[1-9]\d*$/.test(flag ?? "") && argv.length >= 3) return lesen(env, Number(flag), argv.slice(2), deps);
  if (befehl === "ablegen" && flag === "--eingabe" && eingabe && argv.length === 3) return ablegen(env, eingabe, deps);
  return { code: 2, zeilen: ["Aufruf: node scripts/token-analyse-freigabe.mjs (pruefen | lesen <k> <git|wc …> | ablegen --eingabe <datei>)"] };
}

if (istDirektaufruf(import.meta.url)) {
  const r = cli(process.argv.slice(2));
  process.stdout.write(`${r.zeilen.join("\n")}\n`);
  process.exitCode = r.code;
}
