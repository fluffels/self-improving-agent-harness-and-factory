// Einstieg: node scripts/codex-probe.mjs vorbereiten --codex-version <x.y.z> [--langfuse-url <MCP-URL>] [--langfuse-auth env|host]
//           | auftraege (nach dem lokalen Umsetzungs-Commit: Patch, erwarteter HEAD, fertige Aufträge für Lens und Abnahme)
//           | auswerten --belege <Export.json> --bericht <Bericht.json> | aufraeumen   (Abnahmeweg: docs/codex/probe.md, factory#366, factory#456).
// Isolierter Probe-Lebenslauf der Codex-Gesamtabnahme (Worktree `codex-probe` vom Standardzweig des Repos). Startet Codex nie, liest keine Secrets, schreibt nie in eine globale Konfiguration;
// Befehle laufen nur über `deps.git` (git) und `deps.setup` (node + codex-setup.mjs im Probe-Worktree).
// Bekannte Grenze des Quelltext-Wächters (test/harness/codex-probe.test.ts): er prüft eine geschlossene Musterliste (Umgebung, Home-Ordner, Prozessstart mit Literal `codex`), keine Obfuskation.
import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseWorktreeBloecke } from "./worktree-aufraeumen.mjs";
import { befehlLesen } from "./flag-lib.mjs";
import { HEX_HEAD } from "./nachweis-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { standardzweigVon } from "./arbeitsplatz-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { LANGFUSE_AUTH_MODI, pruefeAusgabe } from "./codex-lib.mjs";
import { CLI_VERSION_MUSTER, PROBE_NAME, PROBE_TICKET_NR, PROBE_ORDNER, STANDARD_LANGFUSE_URL, auftraegeText, berichtVorlage, checklisteText, checklistenPunkte, fixtureHooks, hookVariante, probeRepo, probeTicket, startweg } from "./codex-probe-lib.mjs";
import { auswerten, auswertungExit } from "./codex-probe-auswertung.mjs";

const BEFEHLE = {
  vorbereiten: { optionen: { "langfuse-url": { type: "string" }, "langfuse-auth": { type: "string" }, "codex-version": { type: "string" } }, positionale: 0 },
  auftraege: { optionen: {}, positionale: 0 },
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
function schreibeProbe({ haupt, probe, config, stand }) {
  const ordner = join(probe, PROBE_ORDNER);
  mkdirSync(ordner, { recursive: true });
  const dateien = { ".gitignore": "*\n", ...fixtureHooks(), "ticket.md": probeTicket({ haupt, probe, config }), "checkliste.md": checklisteText({ haupt, probe, config, stand }), "bericht-vorlage.json": berichtVorlage(checklistenPunkte(config), { version: stand.version, startweg: stand.startweg }), "stand.json": `${JSON.stringify(stand, null, 2)}\n` };
  for (const [name, inhalt] of Object.entries(dateien)) writeFileSync(join(ordner, name), inhalt, { flag: "wx" });
  const hooks = join(probe, ".codex", "hooks.json");
  writeFileSync(hooks, hookVariante(readFileSync(hooks, "utf8")));
}
/** Legt Worktree, Setup und Probe-Dateien an und liefert den Stand `{ basis, version, startweg }`; wirft bei jedem Fehler (der Aufrufer baut zurück). */
function anlegen(o, { git, setup, url, auth, version }) {
  for (const args of [["fetch", "origin"], ["worktree", "add", "--no-track", "-b", PROBE_NAME, o.probe, o.basis]]) {
    const r = git(args, o.haupt);
    if (r.status !== 0) throw new Error(`git ${args[0]} ${args[1] ?? ""} scheiterte: ${r.stderr.trim()}`);
  }
  const s = setup(o.probe, ["--langfuse-url", url, ...(auth ? ["--langfuse-auth", auth] : []), "--write"]);
  if (s.status !== 0) throw new Error(`codex-setup scheiterte: ${s.stderr.trim()}`);
  const basis = git(["rev-parse", "HEAD"], o.probe).stdout.trim();
  const stand = { basis, version, startweg: startweg(o.probe) };
  schreibeProbe({ ...o, stand });
  const lose = git(["status", "--porcelain"], o.probe).stdout.trim();
  if (lose !== "") throw new Error(`Probe-Worktree nach vorbereiten nicht sauber: ${lose.split(/\r?\n/).join("; ")}`);
  return stand;
}
function vorbereiten(werte, { root, out, err, git, setup, lade }) {
  const version = werte["codex-version"];
  if (version === undefined || !CLI_VERSION_MUSTER.test(version)) { err("--codex-version <x.y.z> erforderlich (die zu prüfende CLI-Version, etwa 0.167.0)"); return 2; }
  const url = werte["langfuse-url"] ?? STANDARD_LANGFUSE_URL;
  if (werte["langfuse-auth"] !== undefined && !LANGFUSE_AUTH_MODI.includes(werte["langfuse-auth"])) { err(`--langfuse-auth: ${LANGFUSE_AUTH_MODI.join(" oder ")} erforderlich`); return 2; }
  const o = ort(root, git, lade);
  if (o.fehler) { err(`Codex-Probe gestoppt: ${o.fehler}`); return 1; }
  const maengel = vorbereitenMaengel({ ...o, git });
  if (maengel.length > 0) { for (const m of maengel) err(`Codex-Probe gestoppt: ${m}`); return 1; }
  try {
    const stand = anlegen(o, { git, setup, url, auth: werte["langfuse-auth"], version });
    out(checklisteText({ ...o, stand }));
    return 0;
  } catch (e) {
    const { rest } = raeumen({ ...o, git });
    err(`Codex-Probe gestoppt: ${e.message}; zurückgebaut${rest.length ? `, Rest: ${rest.join("; ")}` : ""}`);
    return 1;
  }
}
/** Prüft den Stand vor `auftraege`: `{ fehler }` oder `{ stand, head }`; Quelle ist `stand.json` aus `vorbereiten`. */
function auftragsStand(o, git) {
  if (!vorhanden(o.probe)) return { fehler: `Probe-Worktree fehlt: ${o.probe} (zuerst vorbereiten)` };
  let stand;
  try { stand = JSON.parse(readFileSync(join(o.probe, PROBE_ORDNER, "stand.json"), "utf8")); } catch { return { fehler: `${PROBE_ORDNER}/stand.json fehlt oder ist kein JSON (zuerst vorbereiten)` }; }
  if (typeof stand?.basis !== "string" || !HEX_HEAD.test(stand.basis)) return { fehler: `${PROBE_ORDNER}/stand.json ungültig (basis fehlt oder ist kein Commit-Hash, zuerst vorbereiten)` };
  const lose = git(["status", "--porcelain"], o.probe).stdout.trim();
  if (lose !== "") return { fehler: `Probe-Worktree nicht sauber, Umsetzung zuerst lokal auf ${PROBE_NAME} committen: ${lose.split(/\r?\n/).join("; ")}` };
  const head = git(["rev-parse", "HEAD"], o.probe).stdout.trim();
  if (head === stand.basis) return { fehler: "Kein Commit über der Probe-Basis: die Umsetzung zuerst lokal committen" };
  if (git(["merge-base", "--is-ancestor", stand.basis, head], o.probe).status !== 0) return { fehler: "Die Probe-Basis ist kein Vorfahr von HEAD (Historie verändert)" };
  return { stand, head };
}
function auftraege(_werte, { root, out, err, git, lade, tmp }) {
  const o = ort(root, git, lade);
  if (o.fehler) { err(`Codex-Probe gestoppt: ${o.fehler}`); return 1; }
  const { fehler, stand, head } = auftragsStand(o, git);
  if (fehler) { err(`Codex-Probe gestoppt: ${fehler}`); return 1; }
  const diff = git(["diff", `${stand.basis}..${head}`], o.probe);
  if (diff.status !== 0) { err(`Codex-Probe gestoppt: git diff scheiterte: ${diff.stderr.trim()}`); return 1; }
  const scratchpad = join(tmp, `codex-probe-${NUMMER}-abnahme`);
  writeFileSync(join(o.probe, PROBE_ORDNER, "review.patch"), diff.stdout);
  writeFileSync(join(o.probe, PROBE_ORDNER, "checkliste.md"), checklisteText({ ...o, stand, head, scratchpad }));
  out(auftraegeText({ probe: o.probe, basis: stand.basis, head, scratchpad }).join("\n"));
  return 0;
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
const UNTERBEFEHL = { vorbereiten, auftraege, auswerten: auswertenBefehl, aufraeumen };
export function main(argv = process.argv.slice(2), root = process.cwd(), out = console.log, err = console.error, deps = {}) {
  const { befehl, werte, fehler } = befehlLesen(argv, BEFEHLE);
  if (fehler) { err(fehler.text); return 2; }
  const kontext = { root, out, err, git: deps.git ?? gitStandard, setup: deps.setup ?? setupStandard, lade: deps.lade ?? ladeProjektConfig, tmp: deps.tmp ?? tmpdir() };
  try { return UNTERBEFEHL[befehl](werte, kontext); } catch (e) { err(`Codex-Probe gestoppt: ${e.message}`); return 1; }
}
if (istDirektaufruf(import.meta.url)) process.exitCode = main(process.argv.slice(2), process.cwd());
