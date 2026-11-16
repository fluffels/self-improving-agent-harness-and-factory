// Aufrufstatistik der Besitz-Skripte, -Skills und -Agenten aus Claude-Code-Transkripten (factory#519): was ein Projekt real nutzt, was ungenutzt bleibt, und der Footprint je Besitz-Profil.
// `node scripts/aufrufstatistik.mjs --transkripte <projekt-ordner> [--transkripte <weiterer>] [--seit JJJJ-MM-TT] [--json] [--footprint]`; Exit 0 ok, 2 Aufruf. Liest nur lokal, schreibt nichts.
// Die Ausgabe nennt nur Skript-, Skill- und Agentennamen mit Zahlen. Methode und Grenzen: `aufrufstatistik-lib.mjs` (Kopfkommentar).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { toolEventsFromTranscript } from "./brain-metrics.mjs";
import { ladeSessions } from "./transkript.mjs";
import { manifestAusText, MANIFEST_PFAD } from "./besitz-lib.mjs";
import { aufrufeAusEvents, footprint, formatiere, genutzteSkripte, skripteImText, summiere, ungenutzteEinheiten, verteilteEinheiten } from "./aufrufstatistik-lib.mjs";

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/;
const EINSTIEG_QUELLEN = [".claude/settings.json", "package.json"];

const liesIn = (wurzel) => (pfad) => {
  const voll = join(wurzel, ...pfad.split("/"));
  return existsSync(voll) && statSync(voll).isFile() ? readFileSync(voll, "utf8") : null;
};

const dateienIn = (wurzel, ordner) => {
  const voll = join(wurzel, ordner);
  return existsSync(voll) ? readdirSync(voll).map((n) => `${ordner}/${n}`) : [];
};

/** Zählung über alle Sessions der Ordner: `{ aufrufe, sessions }`. */
export function zaehleOrdner(ordner, seit) {
  const zaehlungen = [];
  for (const dir of ordner) {
    for (const s of ladeSessions(dir, seit)) {
      const events = [...toolEventsFromTranscript(s.main), ...s.subagents.flatMap((a) => toolEventsFromTranscript(a.zeilen))];
      zaehlungen.push(aufrufeAusEvents(events));
    }
  }
  return { aufrufe: summiere(zaehlungen), sessions: zaehlungen.length };
}

function footprintZeilen(eintraege, lies) {
  return ["voll", "minimal"].map((p) => {
    const f = footprint(eintraege, p, lies);
    return `Footprint ${p}: ${f.dateien} Dateien, ${f.zeilen} Zeilen, fester Kontext ca. ${f.kontextTokens} Tokens`;
  }).concat("Methode: verteilte Ganz-Datei-Einheiten (Standard-Module), Kontext = Zeichen von AGENTS.md, CLAUDE.md und den description-Zeilen verteilter Skills und Agenten / 4 (Schätzung, keine Messung)");
}

/** Fehlertext des Aufrufs oder `null`. */
function aufrufFehler(gelesen) {
  const w = gelesen.werte ?? {};
  if (gelesen.fehler) return gelesen.fehler.text;
  if (w.seit !== undefined && !ISO_TAG.test(w.seit)) return "--seit erwartet JJJJ-MM-TT";
  if ((w.transkripte ?? []).some((d) => !existsSync(d))) return "--transkripte: Ordner fehlt";
  return w.transkripte === undefined && !w.footprint ? "--transkripte <ordner> oder --footprint fehlt" : null;
}

/** Zählung, Genutzt-Hülle und Ungenutzt-Liste: `{ sessions, aufrufe, ungenutzt }`. */
function statistik({ transkripte, seit }, wurzel, eintraege, lies) {
  const { aufrufe, sessions } = zaehleOrdner(transkripte, seit);
  const einstiege = [...EINSTIEG_QUELLEN, ...dateienIn(wurzel, ".github/workflows"), ...dateienIn(wurzel, ".githooks"), ...dateienIn(wurzel, ".claude/agents")].flatMap((p) => skripteImText(lies(p)));
  const genutzt = genutzteSkripte({ direkt: Object.keys(aufrufe.skripte), einstiege, besitzPfade: eintraege.map((e) => e.pfad), lies });
  return { sessions, aufrufe, ungenutzt: ungenutzteEinheiten({ eintraege: verteilteEinheiten(eintraege, "voll"), genutzt, aufrufe }) };
}

/** Kommandozeile; Rückgabe = Exit-Code. */
export function cli(argv, { wurzel = join(dirname(fileURLToPath(import.meta.url)), ".."), out = (s) => console.log(s), err = (s) => console.error(s) } = {}) {
  const gelesen = flagsLesen(argv, { transkripte: { type: "string", multiple: true }, seit: { type: "string" }, json: { type: "boolean" }, footprint: { type: "boolean" } });
  const fehler = aufrufFehler(gelesen);
  if (fehler !== null) {
    err(`aufrufstatistik: ${fehler}`);
    err("Aufruf: node scripts/aufrufstatistik.mjs --transkripte <ordner> [--seit JJJJ-MM-TT] [--json] [--footprint]");
    return AUFRUF_EXIT;
  }
  const w = gelesen.werte;
  const lies = liesIn(wurzel);
  const eintraege = manifestAusText(lies(MANIFEST_PFAD)).manifest?.eintraege ?? [];
  const ausgabe = [];
  const json = {};
  if (w.transkripte !== undefined) {
    const st = statistik(w, wurzel, eintraege, lies);
    ausgabe.push(formatiere(st));
    Object.assign(json, st);
  }
  if (w.footprint) {
    ausgabe.push(...footprintZeilen(eintraege, lies));
    json.footprint = Object.fromEntries(["voll", "minimal"].map((p) => [p, footprint(eintraege, p, lies)]));
  }
  out(w.json ? JSON.stringify(json, null, 2) : ausgabe.join("\n"));
  return 0;
}

if (istDirektaufruf(import.meta.url)) {
  process.exitCode = cli(process.argv.slice(2));
}
