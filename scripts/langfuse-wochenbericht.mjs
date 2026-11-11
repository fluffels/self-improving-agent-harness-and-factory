// Kein Shebang: wird per `node scripts/langfuse-wochenbericht.mjs` gestartet UND von test/langfuse-wochenbericht.test.ts importiert.
/**
 * Langfuse-Wochenbericht (factory#313, Kind 1 von factory#278): Kosten, Datenlücken, Erfassungsprobe, Summe und Δ der letzten
 * vollen Woche (Mo bis So, UTC) samt Urteil „Agent-Lauf nötig“ nach den Schwellen `langfuseWochenbericht` der Projekt-Config.
 *
 *   node scripts/langfuse-wochenbericht.mjs [--woche <Montag>] [--export <datei>…] [--ablegen] [--json]
 *   node scripts/langfuse-wochenbericht.mjs --rezept [--woche <Montag>] [--rolle <name>…]
 *
 * Ohne `--export` liest der Live-Weg Langfuse selbst (eigenes, dynamisch geladenes Modul `langfuse-wochenbericht-live.mjs`, liest den
 * Secret-Key). Mit `--export` und `--rezept` bleibt die CLI schlüsselfrei: ihre statische Import-Hülle enthält weder `langfuse-api` noch
 * `langfuse-zugang` (ein Test hält das fest). `--ablegen` schreibt `<montag>.md` und `<montag>.json` nach
 * `~/.claude/state/langfuse-wochenbericht/<owner>__<repo>/`.
 * Exit 0 Bericht, keine Schwelle überschritten; 3 Bericht, Agent-Lauf nötig; 4 kein Bericht (Langfuse unerreichbar oder keine Daten
 * der Woche; Warnung auf stderr, `.json` mit `status`, keine `.md`); 1 Fehler; 2 Aufruffehler.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flagsLesen, AUFRUF_EXIT } from "./flag-lib.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";
import { ladeProjektConfig, repoName, repoOwner } from "./projekt-config-lib.mjs";
import { agentenNamen } from "./langfuse-auswertung.mjs";
import { RUHEFRIST_MS, letzteVolleWoche, ordneExporte, projektFilterAus, pruefeAbgeschlossen, renderWochenbericht, wochenAuswertung, wochenJson, wochenRezept } from "./langfuse-wochenbericht-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
export const EXIT_KEIN_BERICHT = 4;
export const EXIT_AGENT_LAUF = 3;

export const aufrufHilfe = () =>
  "Aufruf: node scripts/langfuse-wochenbericht.mjs [--woche <Montag>] [--export <datei>…] [--ablegen] [--json]\n" +
  "        node scripts/langfuse-wochenbericht.mjs --rezept [--woche <Montag>] [--rolle <name>…]\n" +
  "Exit 0 Bericht, 3 Agent-Lauf nötig, 4 kein Bericht, 1 Fehler, 2 Aufruffehler. Schwellen und Grenzen: " +
  factorySeiteIn(WURZEL, "docs/model-routing.md", "langfuse-wochenbericht-factory313") + ".";

export function parseArgs(argv) {
  const optionen = {
    woche: { type: "string" },
    export: { type: "string", multiple: true },
    ablegen: { type: "boolean" },
    json: { type: "boolean" },
    rezept: { type: "boolean" },
    rolle: { type: "string", multiple: true },
  };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = { woche: werte.woche, exporte: werte.export ?? [], ablegen: werte.ablegen === true, json: werte.json === true, rezept: werte.rezept === true, rollen: werte.rolle ?? [] };
  if (fehler) a.fehler = fehler.text;
  return a;
}

/** Projekt-Eingaben aus der Repo-Wurzel: Repo, Schwellen aus der Config, Projekt-Tags aus `.claude/settings.json` (`CC_LANGFUSE_TRACE_TAGS`). */
export function ladeProjekt(wurzel = WURZEL, lies = readFileSync) {
  const config = ladeProjektConfig({ rootDir: wurzel });
  let tags = [];
  try {
    const roh = JSON.parse(lies(join(wurzel, ".claude", "settings.json"), "utf8"))?.env?.CC_LANGFUSE_TRACE_TAGS;
    tags = typeof roh === "string" ? roh.split(",").map((t) => t.trim()).filter(Boolean) : [];
  } catch {
    tags = []; // keine oder kaputte Settings: der Filter trägt dann nur den Repo-Namen
  }
  return { owner: repoOwner(config), repo: repoName(config), schwellen: config.langfuseWochenbericht, tags, wurzel };
}

function exporteLesen(pfade, lies) {
  return pfade.map((pfad) => {
    try {
      return { json: JSON.parse(lies(pfad, "utf8")), pfad };
    } catch (e) {
      throw new Error(`--export ${pfad}: kein lesbares JSON (${e.message})`, { cause: e });
    }
  });
}

const dateien = (home, p) => {
  const ordner = join(home, ".claude", "state", "langfuse-wochenbericht", `${p.owner}__${p.repo}`);
  return { ordner, md: (m) => join(ordner, `${m}.md`), json: (m) => join(ordner, `${m}.json`) };
};

/** Exit 4: Warnung auf stderr; mit `--ablegen` die `.json` mit Status und Grund, eine alte `.md` entfällt. */
function keinBericht(args, deps, p, montag, status, grund) {
  const obj = { status, woche: montag, grund };
  const warnung = `WARNUNG Langfuse-Wochenbericht ${montag}: kein Bericht (${status}): ${grund}`;
  if (args.ablegen) {
    const d = dateien(deps.home ?? homedir(), p);
    (deps.mkdir ?? mkdirSync)(d.ordner, { recursive: true });
    (deps.entferne ?? ((f) => rmSync(f, { force: true })))(d.md(montag));
    (deps.schreibe ?? writeFileSync)(d.json(montag), JSON.stringify(obj, null, 2) + "\n");
  }
  return { exitCode: EXIT_KEIN_BERICHT, stdout: args.json ? JSON.stringify(obj, null, 2) : "", stderr: warnung };
}

function rezeptAusgeben(args, deps, p, montag, jetzt) {
  const rollen = [...agentenNamen(deps.agenten ?? join(p.wurzel, ".claude", "agents")), ...args.rollen];
  const { filter } = projektFilterAus({ tags: p.tags, repoName: p.repo });
  return { exitCode: 0, stdout: JSON.stringify(wochenRezept({ montag, jetzt: jetzt.toISOString(), rollen, projektFilter: filter }), null, 2), stderr: "" };
}

async function holeExporte(args, deps, p, montag, jetzt, filter) {
  if (args.exporte.length) return { status: "ok", exporte: exporteLesen(args.exporte, deps.lies ?? readFileSync) };
  const rollen = [...agentenNamen(deps.agenten ?? join(p.wurzel, ".claude", "agents")), ...args.rollen];
  const rezepte = wochenRezept({ montag, jetzt: jetzt.toISOString(), rollen, projektFilter: filter });
  const live = await (deps.ladeLive ?? (() => import("./langfuse-wochenbericht-live.mjs")))();
  return live.ladeLiveExporte({ rezepte, env: deps.env ?? process.env, home: deps.home ?? homedir(), fetchImpl: deps.fetchImpl });
}

/** Ablauf ohne `process.exit` (testbar): `{ exitCode, stdout, stderr }`. */
export async function auswerten(args, deps = {}) {
  const aufruf = (text) => ({ exitCode: AUFRUF_EXIT, stdout: "", stderr: `${text}\n${aufrufHilfe()}` });
  if (args.fehler) return aufruf(args.fehler);
  const jetzt = deps.jetzt ?? new Date();
  let montag;
  try {
    montag = args.woche ?? letzteVolleWoche(new Date(jetzt.getTime() - RUHEFRIST_MS));
    pruefeAbgeschlossen(montag, jetzt.toISOString());
  } catch (e) {
    return aufruf(e.message);
  }
  try {
    const p = deps.projekt ?? ladeProjekt();
    if (args.rezept) return rezeptAusgeben(args, deps, p, montag, jetzt);
    const { filter, vermerk } = projektFilterAus({ tags: p.tags, repoName: p.repo });
    const geholt = await holeExporte(args, deps, p, montag, jetzt, filter);
    if (geholt.status !== "ok") return keinBericht(args, deps, p, montag, geholt.status, geholt.grund);
    const geordnet = ordneExporte(geholt.exporte, { montag, projektFilter: filter });
    const gesamtW = geordnet.woche.find((e) => e.art === "gesamt");
    if (gesamtW.zeilen.reduce((s, z) => s + z.count, 0) === 0) return keinBericht(args, deps, p, montag, "keine-daten", `0 Generations der Woche unter dem Projektfilter ${JSON.stringify(filter)}`);
    const a = wochenAuswertung(geordnet, { schwellen: p.schwellen, vermerk });
    const md = renderWochenbericht(montag, filter, a);
    const json = wochenJson(montag, filter, a);
    if (args.ablegen) {
      const d = dateien(deps.home ?? homedir(), p);
      (deps.mkdir ?? mkdirSync)(d.ordner, { recursive: true });
      (deps.schreibe ?? writeFileSync)(d.md(montag), md + "\n");
      (deps.schreibe ?? writeFileSync)(d.json(montag), JSON.stringify(json, null, 2) + "\n");
    }
    return { exitCode: a.urteil.agentLaufNoetig ? EXIT_AGENT_LAUF : 0, stdout: args.json ? JSON.stringify(json, null, 2) : md, stderr: "" };
  } catch (e) {
    return { exitCode: 1, stdout: "", stderr: `Fehler: ${e.message}` };
  }
}

async function main() {
  const { exitCode, stdout, stderr } = await auswerten(parseArgs(process.argv.slice(2)));
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  process.exitCode = exitCode;
}

if (istDirektaufruf(import.meta.url)) await main();
