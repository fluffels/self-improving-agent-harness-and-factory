// Kein Shebang: wird per `node scripts/langfuse-wochenbericht.mjs` gestartet UND von test/langfuse-wochenbericht.test.ts importiert.
/**
 * Langfuse-Wochenbericht (factory#313, Kind 1 von factory#278): Kosten, Datenlücken, Erfassungsprobe, Summe und Δ der letzten
 * vollen Woche (Mo bis So, UTC) samt Urteil „Agent-Lauf nötig“ nach den Schwellen `langfuseWochenbericht` der Projekt-Config.
 *
 *   node scripts/langfuse-wochenbericht.mjs [--woche <Montag>] [--export <datei>…] [--ablegen] [--json]
 *   node scripts/langfuse-wochenbericht.mjs --rezept [--woche <Montag>] [--rolle <name>…]
 *   node scripts/langfuse-wochenbericht.mjs --ausloeser sessionstart [--wurzel <Repo-Wurzel>]   (Wochenbericht-Lauf, factory#314)
 *
 * Ohne `--export` liest der Live-Weg Langfuse selbst (eigenes, dynamisch geladenes Modul `langfuse-wochenbericht-live.mjs`, liest den
 * Secret-Key). Mit `--export` und `--rezept` bleibt die CLI schlüsselfrei: ihre statische Import-Hülle enthält weder `langfuse-api` noch
 * `langfuse-zugang` (ein Test hält das fest). `--ablegen` schreibt `<montag>.md` und `<montag>.json` nach
 * `~/.claude/state/langfuse-wochenbericht/<owner>__<repo>/`.
 * Kosten je Merge (factory#324): `kostenAnstiegProzent` misst das Δ der Kosten je gemergtem PR; die Zahl der Merges holt die CLI per `gh`-Suche
 * (`deps.gh`, kein Secret-Key, `--export` und `--rezept` bleiben schlüsselfrei); nicht ermittelbar ist Exit 1.
 * `--ausloeser` ist der automatische Wochenbericht-Lauf (`wochenberichtLauf`): das losgelöste Kind des SessionStart-Hooks
 * (`langfuse-abgleich-hook.mjs`) liest den Secret-Key über den Live-Weg, kein Agent startet es. Er arbeitet nur mit dem Config-Schlüssel
 * `langfuseWochenbericht`, ab Dienstag nach dem Wochenende, einmal je Woche (atomarer Claim), schreibt nichts auf stdout und löst Meldungen per
 * `gh workflow run board-takt.yml -f langfuse_anlass=…` aus; Mechanik: docs/model-routing.md (Wochenbericht-Lauf).
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
import { ladeProjektConfig, langfuseZiel, repoName, repoOwner } from "./projekt-config-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { ghText } from "./gh-cli.mjs";
import { lockFreigeben, lockNehmen, logAnhaengen } from "./langfuse-lock.mjs";
import { agentenNamen } from "./agenten-namen.mjs";
import { RUHEFRIST_MS, anlassText, letzteVolleWoche, mergeAnzahl, mergeSucheArgs, ordneExporte, projektFilterAus, pruefeAbgeschlossen, renderWochenbericht, wochenAuswertung, wochenberichtAblage, wochenberichtTermin, wochenFenster, wochenJson, wochenRezept, wochenStand } from "./langfuse-wochenbericht-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
export const EXIT_KEIN_BERICHT = 4;
export const EXIT_AGENT_LAUF = 3;

export const aufrufHilfe = () =>
  "Aufruf: node scripts/langfuse-wochenbericht.mjs [--woche <Montag>] [--export <datei>…] [--ablegen] [--json]\n" +
  "        node scripts/langfuse-wochenbericht.mjs --rezept [--woche <Montag>] [--rolle <name>…]\n" +
  "        node scripts/langfuse-wochenbericht.mjs --ausloeser sessionstart [--wurzel <Repo-Wurzel>]\n" +
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
    ausloeser: { type: "string" },
    wurzel: { type: "string" },
  };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = { woche: werte.woche, exporte: werte.export ?? [], ablegen: werte.ablegen === true, json: werte.json === true, rezept: werte.rezept === true, rollen: werte.rolle ?? [], ausloeser: werte.ausloeser, wurzel: werte.wurzel };
  if (fehler) a.fehler = fehler.text;
  else if (a.ausloeser !== undefined && a.ausloeser !== "sessionstart") a.fehler = `--ausloeser kennt nur "sessionstart", war ${JSON.stringify(a.ausloeser)}`;
  return a;
}

/** Projekt-Eingaben aus der Repo-Wurzel: Repo, Schwellen aus der Config, Projekt-Tags aus `.claude/settings.json` (`CC_LANGFUSE_TRACE_TAGS`). */
export function ladeProjekt(wurzel = WURZEL, lies = readFileSync) {
  const config = ladeProjektConfig({ rootDir: wurzel });
  return { owner: repoOwner(config), repo: repoName(config), schwellen: config.langfuseWochenbericht, tags: projektTags(wurzel, lies), wurzel, config };
}

/** Projekt-Tags aus `env.CC_LANGFUSE_TRACE_TAGS` der Settings (komma-getrennt); ohne lesbare Settings leer (der Filter trägt dann nur den Repo-Namen). */
function projektTags(wurzel, lies) {
  try {
    const roh = JSON.parse(lies(join(wurzel, ".claude", "settings.json"), "utf8"))?.env?.CC_LANGFUSE_TRACE_TAGS;
    return typeof roh === "string" ? roh.split(",").map((t) => t.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
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
  const ordner = wochenberichtAblage(`${p.owner}/${p.repo}`, home);
  return { ordner, md: (m) => join(ordner, `${m}.md`), json: (m) => join(ordner, `${m}.json`) };
};

/** Exit 4: Warnung auf stderr; mit `--ablegen` die `.json` mit Status und Grund, eine alte `.md` entfällt. */
function keinBericht(args, deps, p, montag, status, grund) {
  grund = ohneSchluessel(grund);
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

/** Exit 0 oder 3 mit Markdown bzw. JSON; mit `--ablegen` schreibt es `.md` und `.json`. */
function berichtAusgeben(args, deps, p, montag, a, filter) {
  const md = renderWochenbericht(montag, filter, a);
  const json = wochenJson(montag, filter, a);
  if (args.ablegen) {
    const d = dateien(deps.home ?? homedir(), p);
    (deps.mkdir ?? mkdirSync)(d.ordner, { recursive: true });
    (deps.schreibe ?? writeFileSync)(d.md(montag), md + "\n");
    (deps.schreibe ?? writeFileSync)(d.json(montag), JSON.stringify(json, null, 2) + "\n");
  }
  return { exitCode: a.urteil.agentLaufNoetig ? EXIT_AGENT_LAUF : 0, stdout: args.json ? JSON.stringify(json, null, 2) : md, stderr: "" };
}

const ghEcht = (args) => ghText(args, { timeout: 60_000 });
/** `gh` der Merge-Suche: die injizierte Naht, sonst das echte `gh` (manueller Aufruf ohne `deps`). */
export const ghDer = (deps) => deps.gh ?? ghEcht;
export { ghEcht };

/** Gemergte PRs des Repos der Config in Woche und Vorwoche (`gh`-Suche, kein Secret-Key); wirft, wenn nicht ermittelbar (factory#324). */
function mergesDerWochen(gh, p, montag) {
  const f = wochenFenster(montag);
  const zaehle = (von, bis) => mergeAnzahl(gh(mergeSucheArgs({ owner: p.owner, repo: p.repo, von, bis })));
  return { woche: zaehle(f.von, f.bis), vorwoche: zaehle(f.vorVon, f.vorBis) };
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
    const merges = mergesDerWochen(ghDer(deps), p, montag);
    return berichtAusgeben(args, deps, p, montag, wochenAuswertung(geordnet, { schwellen: p.schwellen, vermerk, merges }), filter);
  } catch (e) {
    return { exitCode: 1, stdout: "", stderr: `Fehler: ${e.message}` };
  }
}

// ── Wochenbericht-Lauf (factory#314) ─────────────────────────────────────────

const SCHLUESSEL_MUSTER = [/sk-lf-\S+/g, /pk-lf-\S+/g, /Basic\s+[A-Za-z0-9+/=_-]{8,}/g, /LANGFUSE_\w*SECRET\w*=\S*/g];
/** Schwärzt Langfuse-Schlüsselmuster (geschlossene Liste), bevor Text in .json oder Log landet; liest keine env-Werte. */
export const ohneSchluessel = (text) => SCHLUESSEL_MUSTER.reduce((t, m) => t.replace(m, "[geschwärzt]"), String(text));
const entpfade = (text, home) => ohneSchluessel(String(text).split(home).join("~")).split("\n")[0].slice(0, 300);

/** Stand der Woche aus ihrer `<montag>.json` (fehlt oder kaputt: `offen`) samt dem Inhalt. */
function standLesen(k) {
  try {
    const json = JSON.parse(k.lies(k.d.json(k.montag), "utf8"));
    return { stand: wochenStand(json), json };
  } catch {
    return { stand: "offen", json: null };
  }
}

/** Ergänzt die `<montag>.json` um `zusatz` (Status, Warnung, Anlass); ohne vorhandene Datei entsteht sie aus `basis`. */
function jsonErgaenzen(k, basis, zusatz) {
  const aktuell = standLesen(k).json ?? basis;
  k.mkdir(k.d.ordner, { recursive: true });
  k.schreibe(k.d.json(k.montag), JSON.stringify({ ...aktuell, ...zusatz }, null, 2) + "\n");
}

/** Löst die Meldung aus (Dispatch gegen den Board-Takt des Ziel-Repos); `true` bei Erfolg, nie ein Wurf. */
function dispatch(k, text) {
  try {
    const ziel = langfuseZiel(k.p.config, { bezieher: k.istBezieher(k.wurzel) });
    k.gh(["workflow", "run", "board-takt.yml", "--repo", ziel.repo, "-f", `langfuse_anlass=${text}`]);
    return true;
  } catch {
    return false;
  }
}

/** Meldung auslösen und bei Erfolg die Woche als `gemeldet` festhalten; scheitert der Dispatch, bleibt der Stand und der nächste Start wiederholt. */
function melde(k, basis, text) {
  if (!dispatch(k, text)) return { status: "dispatch-fehler", anlass: text };
  jsonErgaenzen(k, basis, { status: "gemeldet", anlass: text });
  return { status: "gemeldet", anlass: text };
}

/** Commits der Woche auf main des Repos (`null`: nicht ermittelbar, nie als „keine“ werten). */
function commitsDerWoche(k) {
  try {
    const f = wochenFenster(k.montag);
    const roh = k.gh(["api", `repos/${k.p.owner}/${k.p.repo}/commits?sha=main&since=${f.von}&until=${f.bis}&per_page=1`]);
    const liste = JSON.parse(roh);
    return Array.isArray(liste) ? liste.length : null;
  } catch {
    return null;
  }
}

/** Exit 4 des Auswertens: `unerreichbar` (ab Donnerstag melden) oder `keine-daten` (mit Commits melden, ohne `ruhe`). */
function keinBerichtFolge(k, obj) {
  const basis = { status: obj.status, woche: k.montag, grund: obj.grund };
  if (obj.status === "unerreichbar") {
    if (!k.termin.meldenAb) {
      jsonErgaenzen(k, basis, { warnung: "Langfuse unerreichbar, neuer Versuch beim nächsten SessionStart" });
      return { status: "offen", grund: "unerreichbar" };
    }
    return melde(k, basis, anlassText({ art: "fehlt", montag: k.montag, klasse: "unerreichbar" }));
  }
  const commits = commitsDerWoche(k);
  if (commits === null) {
    jsonErgaenzen(k, basis, { warnung: "Commits der Woche nicht ermittelbar, neuer Versuch beim nächsten SessionStart" });
    return { status: "offen", grund: "commits-unbekannt" };
  }
  if (commits === 0) {
    jsonErgaenzen(k, basis, { status: "ruhe", warnung: "Woche ohne Daten und ohne Commits auf main" });
    return { status: "ruhe" };
  }
  return melde(k, basis, anlassText({ art: "ohne-daten", montag: k.montag }));
}

/** Auswerten fehlgeschlagen (Exit 1 oder 2): `fehler` festhalten, ab Donnerstag melden. */
function fehlerFolge(k, r) {
  const basis = { status: "fehler", woche: k.montag, grund: entpfade(r.stderr, k.home) };
  jsonErgaenzen(k, basis, { ...basis, warnung: "Auswerten fehlgeschlagen, neuer Versuch beim nächsten SessionStart" });
  return k.termin.meldenAb ? melde(k, basis, anlassText({ art: "fehlt", montag: k.montag, klasse: "fehler" })) : { status: "fehler", grund: basis.grund };
}

/** Der Lauf unter Claim: Stand lesen, ggf. nur melden, sonst auswerten und je Ausgang festhalten. */
async function arbeite(k) {
  const { stand, json } = standLesen(k);
  if (stand === "erledigt") return { status: "erledigt" };
  if (stand === "melden") return melde(k, json, anlassText({ art: "schwelle", montag: k.montag, gruende: json.urteil.gruende }));
  const r = await k.auswerten({ woche: k.montag, ablegen: true, json: true, exporte: [], rezept: false, rollen: [] }, k.auswertenDeps);
  let obj = null;
  try {
    obj = JSON.parse(r.stdout);
  } catch {
    // kein JSON: nur bei Exit 0, 3 oder 4 ein Fehler, sonst steht der Grund auf stderr
  }
  if (r.exitCode === 0 && obj?.status === "bericht") return { status: "bericht" };
  if (r.exitCode === 3 && obj?.status === "bericht") return melde(k, obj, anlassText({ art: "schwelle", montag: k.montag, gruende: obj.urteil.gruende }));
  if (r.exitCode === 4 && obj) return keinBerichtFolge(k, obj);
  return fehlerFolge(k, { ...r, stderr: r.stderr || "unerwartete Ausgabe des Auswertens" });
}

/**
 * Der automatische Wochenbericht-Lauf (factory#314) ohne `process.exit` und ohne stdout; liefert den Exit-Code (0, außer bei einem Wurf). Jede Station schreibt
 * genau eine Logzeile nach `~/.claude/state/langfuse-wochenbericht.log` (ohne absolute Pfade). Nähte: `jetzt`, `home`, `env`, `projekt`, `auswerten`, `gh`,
 * `istBezieher`, `lies`, `schreibe`, `mkdir`, `lockNehmen`, `lockFreigeben`.
 */
export async function wochenberichtLauf(args, deps = {}) {
  const n = { ...echteNaehte(), ...deps };
  const termin = wochenberichtTermin(n.jetzt);
  const logDatei = join(n.home, ".claude", "state", "langfuse-wochenbericht.log");
  const log = (z) => logAnhaengen(logDatei, { zeit: n.jetzt.toISOString(), ausloeser: args.ausloeser, woche: termin.montag, ...z });
  try {
    const wurzel = args.wurzel ?? WURZEL;
    const p = n.projekt ?? ladeProjekt(wurzel, n.lies);
    const repo = `${p.owner}/${p.repo}`;
    const k = { ...n, p, wurzel, termin, montag: termin.montag, d: dateien(n.home, p), auswertenDeps: { gh: n.gh, jetzt: n.jetzt, projekt: p, home: n.home, env: n.env, ladeLive: n.ladeLive, fetchImpl: n.fetchImpl } };
    const frueh = fruehAbbruch(k);
    if (frueh) {
      log({ repo, status: frueh });
      return 0;
    }
    const claim = join(k.d.ordner, `${k.montag}.claim`);
    if (n.lockNehmen(claim, { now: n.jetzt.getTime() }) === "belegt") {
      log({ repo, status: "belegt" });
      return 0;
    }
    let ergebnis;
    try {
      ergebnis = await arbeite(k);
    } finally {
      n.lockFreigeben(claim);
    }
    log({ repo, ...ergebnis });
    return 0;
  } catch (e) {
    try {
      log({ status: "fehler", grund: entpfade(e?.message ?? e, n.home) });
    } catch {
      // das Log selbst ist nicht beschreibbar: nichts mehr zu tun
    }
    return 1;
  }
}

/** Die echten Nähte des Laufs; `deps` überschreibt sie (Tests). Als Funktion, damit `jetzt` und `env` je Aufruf frisch sind. */
const echteNaehte = () => ({ jetzt: new Date(), home: homedir(), env: process.env, gh: ghEcht, istBezieher, auswerten, lies: readFileSync, schreibe: writeFileSync, mkdir: mkdirSync, lockNehmen, lockFreigeben });

/** Gründe, den Lauf vor dem Claim zu beenden: `aus` (kein Config-Schlüssel), `nicht-faellig`, `erledigt`, `kein-zugang` (kein öffentlicher Langfuse-Key in der Umgebung des Kindes); sonst `null`. */
function fruehAbbruch(k) {
  if (!k.p.schwellen) return "aus";
  if (!k.termin.faellig) return "nicht-faellig";
  if (standLesen(k).stand === "erledigt") return "erledigt";
  return k.env.LANGFUSE_PUBLIC_KEY ? null : "kein-zugang";
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.ausloeser && !args.fehler) {
    process.exitCode = await wochenberichtLauf(args);
    return;
  }
  const { exitCode, stdout, stderr } = await auswerten(args);
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  process.exitCode = exitCode;
}

if (istDirektaufruf(import.meta.url)) await main();
