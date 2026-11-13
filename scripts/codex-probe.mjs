// Einstieg: node scripts/codex-probe.mjs vorbereiten [--langfuse-url <MCP-URL>] [--langfuse-auth env|host]
//           | auswerten --belege <Export.json> --bericht <Bericht.json> | aufraeumen   (Abnahmeweg: docs/codex/probe.md, factory#366).
// Isolierter Probe-Lebenslauf der Codex-Gesamtabnahme (Worktree `codex-probe` vom Standardzweig des Repos). Startet Codex nie, liest keine Secrets, schreibt nie in eine globale Konfiguration;
// Befehle laufen nur über `deps.git` (git) und `deps.setup` (node + codex-setup.mjs im Probe-Worktree).
// Bekannte Grenze des Quelltext-Wächters (test/harness/codex-probe.test.ts): er prüft eine geschlossene Musterliste (Umgebung, Home-Ordner, Prozessstart mit Literal `codex`), keine Obfuskation.
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseWorktreeBloecke } from "./worktree-aufraeumen.mjs";
import { befehlLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { standardzweigVon } from "./arbeitsplatz-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { LANGFUSE_AUTH_MODI, pruefeAusgabe } from "./codex-lib.mjs";
import { PROBE_NAME, PROBE_TICKET_NR, PROBE_ORDNER, STANDARD_LANGFUSE_URL, berichtVorlage, checklisteText, checklistenPunkte, fixtureHooks, hookVariante, probeRepo, probeTicket } from "./codex-probe-lib.mjs";
import { auswerten, auswertungExit } from "./codex-probe-auswertung.mjs";

const BEFEHLE = {
  vorbereiten: { optionen: { "langfuse-url": { type: "string" }, "langfuse-auth": { type: "string" } }, positionale: 0 },
  auswerten: { optionen: { belege: { type: "string" }, bericht: { type: "string" } }, positionale: 0 },
  aufraeumen: { optionen: {}, positionale: 0 },
};
const NUMMER = String(PROBE_TICKET_NR);
const gitStandard = (args, cwd) => { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }; };
const setupStandard = (probe, args) => { const r = spawnSync(process.execPath, [join(probe, "scripts", "codex-setup.mjs"), ...args], { cwd: probe, encoding: "utf8" }); return { status: r.status ?? 1, stderr: r.stderr ?? "" }; };
const posix = (p) => String(p).replaceAll("\\", "/");
const echt = (p) => { try { return posix(realpathSync(p)); } catch { return posix(p); } };
const gleich = (a, b) => echt(a) === echt(b);
const vorhanden = (p) => lstatSync(p, { throwIfNoEntry: false }) !== undefined;
/** Registrierte Worktrees `[{ pfad, branch }]` (Parser: `parseWorktreeBloecke`; Branch leer bei losem HEAD). */
const worktrees = (git, haupt) => parseWorktreeBloecke(git(["worktree", "list", "--porcelain"], haupt).stdout).map((b) => ({ pfad: b.pfad, branch: b.branch ?? "" }));
const branches = (git, haupt, muster) => git(["branch", "--list", "--format=%(refname:short)", muster], haupt).stdout.split(/\r?\n/).filter(Boolean);
/** Hauptcheckout und Projekt-Config oder Fehlertext (nie ein Wurf). */
function ort(root, git, lade) {
  const r = git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  if (r.status !== 0) return { fehler: `Kein Git-Repository: ${root}` };
  const haupt = dirname(r.stdout.trim());
  try { const config = lade({ rootDir: haupt }); const repo = probeRepo(config, haupt); return { haupt, config, probe: `${repo.worktreeOrdner}/${PROBE_NAME}`, basis: `origin/${standardzweigVon(repo)}` }; } catch (e) { return { fehler: `Projekt-Config nicht ladbar: ${e.message}` }; }
}
/** Alle Vorprüfungen von `vorbereiten`, vor der ersten Änderung; Liste der Fundstellen (leer = alles frei). */
function vorbereitenMaengel({ haupt, probe, git }) {
  const m = [];
  try { pruefeAusgabe(probe, haupt); } catch (e) { m.push(`Probe-Ziel ungeeignet: ${e.message}`); }
  if (git(["status", "--porcelain"], haupt).stdout.trim() !== "") m.push(`Hauptcheckout ${haupt} ist nicht sauber (git status --porcelain)`);
  if (vorhanden(probe)) m.push(`Probe-Ordner existiert schon: ${probe} (zuerst node scripts/codex-probe.mjs aufraeumen)`);
  if (branches(git, haupt, PROBE_NAME).length > 0) m.push(`Branch ${PROBE_NAME} existiert schon (zuerst node scripts/codex-probe.mjs aufraeumen)`);
  return m;
}
/** Räumt Probe-Worktree, Probe-Branch und alles mit der Probe-Ticket-Nummer; `{ rest }` = Fundstellen, die nach dem Aufräumen bleiben. */
function raeumen({ haupt, probe, git }) {
  const rest = [];
  const eigene = (w) => (gleich(w.pfad, probe) ? w.branch === PROBE_NAME : `${w.pfad} ${w.branch}`.includes(NUMMER));
  for (const w of worktrees(git, haupt).filter((x) => gleich(x.pfad, probe) || `${x.pfad} ${x.branch}`.includes(NUMMER))) {
    if (!eigene(w)) { rest.push(`Worktree am Probe-Pfad gehört nicht zur Probe (Branch ${w.branch || "ohne"}), nichts gelöscht: ${w.pfad}`); continue; }
    if (git(["worktree", "remove", "--force", w.pfad], haupt).status !== 0) rest.push(`Worktree nicht entfernt: ${w.pfad}`);
  }
  git(["worktree", "prune"], haupt);
  for (const b of [...branches(git, haupt, PROBE_NAME), ...branches(git, haupt, `*${NUMMER}*`)]) git(["branch", "-D", b], haupt);
  for (const w of worktrees(git, haupt).filter((x) => gleich(x.pfad, probe) || `${x.pfad} ${x.branch}`.includes(NUMMER))) rest.push(`Worktree noch registriert: ${w.pfad}`);
  for (const b of [...branches(git, haupt, PROBE_NAME), ...branches(git, haupt, `*${NUMMER}*`)]) rest.push(`Branch noch vorhanden: ${b}`);
  if (vorhanden(probe)) rest.push(`Ordner noch vorhanden: ${probe} (Fix: node scripts/cleanup-worktrees.mjs --fix)`);
  return { rest: [...new Set(rest)] };
}
/** Schreibt die Probe-Dateien (Flag `wx`, nichts wird überschrieben) und ersetzt `.codex/hooks.json` durch die Variante. */
function schreibeProbe({ haupt, probe, config }) {
  const ordner = join(probe, PROBE_ORDNER);
  mkdirSync(ordner, { recursive: true });
  const dateien = { ".gitignore": "*\n", ...fixtureHooks(), "ticket.md": probeTicket({ haupt, probe, config }), "checkliste.md": checklisteText({ haupt, probe, config }), "bericht-vorlage.json": berichtVorlage(checklistenPunkte(config)) };
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(ordner, name), inhalt, { flag: "wx" });
  const hooks = join(probe, ".codex", "hooks.json");
  writeFileSync(hooks, hookVariante(readFileSync(hooks, "utf8")));
}
function vorbereiten(werte, { root, out, err, git, setup, lade }) {
  const url = werte["langfuse-url"] ?? STANDARD_LANGFUSE_URL;
  if (werte["langfuse-auth"] !== undefined && !LANGFUSE_AUTH_MODI.includes(werte["langfuse-auth"])) { err(`--langfuse-auth: ${LANGFUSE_AUTH_MODI.join(" oder ")} erforderlich`); return 2; }
  const o = ort(root, git, lade);
  if (o.fehler) { err(`Codex-Probe gestoppt: ${o.fehler}`); return 1; }
  const maengel = vorbereitenMaengel({ ...o, git });
  if (maengel.length > 0) { for (const m of maengel) err(`Codex-Probe gestoppt: ${m}`); return 1; }
  try {
    for (const args of [["fetch", "origin"], ["worktree", "add", "--no-track", "-b", PROBE_NAME, o.probe, o.basis]]) {
      const r = git(args, o.haupt);
      if (r.status !== 0) throw new Error(`git ${args[0]} ${args[1] ?? ""} scheiterte: ${r.stderr.trim()}`);
    }
    const s = setup(o.probe, ["--langfuse-url", url, ...(werte["langfuse-auth"] ? ["--langfuse-auth", werte["langfuse-auth"]] : []), "--write"]);
    if (s.status !== 0) throw new Error(`codex-setup scheiterte: ${s.stderr.trim()}`);
    schreibeProbe(o);
    out(checklisteText(o));
    return 0;
  } catch (e) {
    const { rest } = raeumen({ ...o, git });
    err(`Codex-Probe gestoppt: ${e.message}; zurückgebaut${rest.length ? `, Rest: ${rest.join("; ")}` : ""}`);
    return 1;
  }
}
function aufraeumen(_werte, { root, out, err, git, lade }) {
  const o = ort(root, git, lade);
  if (o.fehler) { err(`Codex-Probe gestoppt: ${o.fehler}`); return 1; }
  const { rest } = raeumen({ ...o, git });
  if (rest.length > 0) { for (const r of rest) err(`Codex-Probe: Rest nach aufraeumen: ${r}`); return 1; }
  out(`Codex-Probe aufgeräumt: kein Worktree, Ordner oder Branch mehr (${PROBE_NAME}).`);
  return 0;
}
const lesen = (pfad) => JSON.parse(readFileSync(pfad, "utf8"));
function auswertenBefehl(werte, { out, err, lade, root }) {
  if (werte.belege === undefined || werte.bericht === undefined) { err("auswerten braucht --belege <JSON-Datei> und --bericht <JSON-Datei>"); return 2; }
  let belege, bericht, config;
  try { belege = lesen(werte.belege); bericht = lesen(werte.bericht); config = lade({ rootDir: root }); } catch (e) { err(`Codex-Probe: Datei nicht lesbar oder kein JSON: ${e.message}`); return 2; }
  const ergebnis = auswerten({ belege, bericht, config });
  out(JSON.stringify(ergebnis));
  return auswertungExit(ergebnis);
}
const UNTERBEFEHL = { vorbereiten, auswerten: auswertenBefehl, aufraeumen };
export function main(argv = process.argv.slice(2), root = process.cwd(), out = console.log, err = console.error, deps = {}) {
  const { befehl, werte, fehler } = befehlLesen(argv, BEFEHLE);
  if (fehler) { err(fehler.text); return 2; }
  const kontext = { root, out, err, git: deps.git ?? gitStandard, setup: deps.setup ?? setupStandard, lade: deps.lade ?? ladeProjektConfig };
  try { return UNTERBEFEHL[befehl](werte, kontext); } catch (e) { err(`Codex-Probe gestoppt: ${e.message}`); return 1; }
}
if (istDirektaufruf(import.meta.url)) process.exitCode = main(process.argv.slice(2), process.cwd());
