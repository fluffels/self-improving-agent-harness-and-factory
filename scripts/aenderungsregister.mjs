// Kein Shebang: wird per `node scripts/aenderungsregister.mjs` gestartet UND von test/aenderungsregister.test.ts importiert.
/**
 * Änderungsregister, Wirkungsprüfung (factory#572, Teil 2/9 von factory#518): Teil 0 der Analyse, ohne Agent.
 *
 *   node scripts/aenderungsregister.mjs [--export <datei>…] [--json] [--ablage <pfad>] [--heute JJJJ-MM-TT] [--nach <nr>] [--trocken] [--register <datei>]
 *
 * Wertet jede fällige Zeile aus `.github/aenderungsregister.json` zeitbasiert aus (Nachher-Fenster: Änderungsdatum bis Prüftermin gegen die Basis),
 * Fabrik und Bezieher getrennt, und schreibt mit `--ablage` das Urteil als `aenderungsregister-<heute>.json` und `.md` in den Schnappschuss
 * (außerhalb des Repos; ein Ablageordner im Repo wird verweigert). Messpunkte kommen nur aus Exportdateien (Format: docs/model-routing.md ›
 * Änderungsregister), nie aus dem Netz und nie mit dem Langfuse-Secret-Key (ein Test hält die Import-Hülle fest). Nur ein Verstoß der
 * Qualitäts-Toleranz legt ein Ticket an (`spezifikation.mjs anlegen`, dedupliziert über den Marker im Body, Pflicht `--nach <nr>`); sonst bleibt
 * es bei Bericht und Schnappschuss, ohne `gh`-Aufruf. FABRIK-EIGEN: das Skript wird nie an Bezieher verteilt und bricht dort ab (Exit 4).
 * Exit 0 Bericht (auch mit Lücken), 1 Lese- oder Registerfehler, 2 Aufruffehler, 3 Verstoß ohne `--nach` oder Ticket-Anlage gescheitert, 4 Abbruch im Bezieher.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { ghJson } from "./gh-cli.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { istDatum, leseMesspunkte, markerFuer, pruefeRegister, renderMarkdown, ticketBody, ticketGruppen, auswertung } from "./aenderungsregister-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const REGISTER = join(WURZEL, ".github", "aenderungsregister.json");
const WEIL = "Qualitätsverstoß einer geprüften Änderung: kleine, entblockende Entscheidung vor Features, Rückfall-Frist läuft";

export const aufrufHilfe = () =>
  "Aufruf: node scripts/aenderungsregister.mjs [--export <datei>…] [--json] [--ablage <pfad>] [--heute JJJJ-MM-TT] [--nach <nr>] [--trocken] [--register <datei>]\n" +
  "Ein Verstoß legt nur mit --nach <nr> ein Ticket an (--trocken nennt es nur). Doku: docs/model-routing.md › Änderungsregister (factory#518).";

export function parseArgs(argv) {
  const optionen = {
    export: { type: "string", multiple: true },
    json: { type: "boolean" },
    ablage: { type: "string" },
    heute: { type: "string" },
    nach: { type: "string" },
    trocken: { type: "boolean" },
    register: { type: "string" },
  };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = { exporte: werte.export ?? [], json: werte.json === true, ablage: werte.ablage, heute: werte.heute, nach: werte.nach, trocken: werte.trocken === true, register: werte.register ?? REGISTER };
  if (fehler) a.fehler = fehler.text;
  else if (a.heute !== undefined && !istDatum(a.heute)) a.fehler = `--heute: Datum JJJJ-MM-TT erwartet, nicht ${a.heute}`;
  else if (a.nach !== undefined && !/^#?\d+$/.test(a.nach)) a.fehler = "--nach braucht eine Ticketnummer";
  return a;
}

const projekt = () => JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8"));

/** Standard-Abhängigkeiten (Tests speisen eigene ein): Tickets zur Id (alle Zustände) und Anlage über `spezifikation.mjs anlegen`. */
const standardDeps = () => {
  const p = projekt();
  return {
    heute: new Date().toISOString().slice(0, 10),
    repo: p.repo,
    eigenerRepoTag: String(p.repo).split("/").pop(),
    label: p.labels?.harness,
    bezieher: istBezieher(WURZEL) || istBezieher(process.cwd()),
    lies: readFileSync,
    schreibe: (pfad, text) => {
      mkdirSync(join(pfad, ".."), { recursive: true });
      writeFileSync(pfad, text);
    },
    ladeTickets: (repo, id) => ghJson(["issue", "list", "--repo", repo, "--search", `aenderungsregister:${id} in:body`, "--state", "all", "--limit", "20", "--json", "number,state,body"]),
    legeAn: ({ titel, body, nach, label }) => {
      const ordner = mkdtempSync(join(tmpdir(), "aenderungsregister-"));
      try {
        const datei = join(ordner, "body.md");
        writeFileSync(datei, body);
        const args = ["scripts/spezifikation.mjs", "anlegen", "--titel", titel, "--body-datei", datei, ...(label ? ["--label", label] : []), "--nach", String(nach).replace(/^#/, ""), "--weil", WEIL];
        return execFileSync(process.execPath, args, { cwd: WURZEL, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      } finally {
        rmSync(ordner, { recursive: true, force: true });
      }
    },
  };
};

const imRepo = (pfad) => {
  const rel = relative(WURZEL, resolve(pfad));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

function lese(args, lies) {
  let register;
  try {
    register = JSON.parse(lies(args.register, "utf8"));
  } catch (e) {
    throw new Error(`Register ${args.register}: kein lesbares JSON (${e.message})`, { cause: e });
  }
  const fehler = pruefeRegister(register?.zeilen);
  if (fehler.length > 0) throw new Error(`Register ungültig:\n${fehler.join("\n")}`);
  const exporte = args.exporte.map((pfad) => {
    try {
      return leseMesspunkte(JSON.parse(lies(pfad, "utf8")), pfad);
    } catch (e) {
      throw new Error(e.message.startsWith(pfad) ? e.message : `--export ${pfad}: ${e.message}`, { cause: e });
    }
  });
  return { register, exporte };
}

/** Je Gruppe: bestehendes Ticket nennen oder anlegen (`trocken`: nur nennen). Wirft bei gescheiterter Anlage. */
function tickets(gruppen, args, d) {
  return gruppen.map((g) => {
    const bestehend = g.ids.flatMap((id) => d.ladeTickets(d.repo, id).filter((t) => String(t.body ?? "").includes(markerFuer(id))));
    if (bestehend.length > 0) return `${g.ids.join(", ")}: Ticket #${bestehend[0].number} besteht (${String(bestehend[0].state).toLowerCase()}), kein zweites angelegt`;
    if (args.trocken) return `${g.ids.join(", ")}: würde ein Ticket anlegen (--trocken)`;
    const { titel, body } = ticketBody(g);
    return `${g.ids.join(", ")}: Ticket angelegt: ${d.legeAn({ titel, body, nach: args.nach, label: d.label })}`;
  });
}

/** Ablauf ohne `process.exit` (testbar): `{ exitCode, text }`. `deps` (Tests): `heute`, `repo`, `eigenerRepoTag`, `label`, `bezieher`, `lies`, `schreibe`, `ladeTickets`, `legeAn`. */
export function auswerten(args, deps = {}) {
  const d = { ...standardDeps(), ...deps };
  if (d.bezieher) return { exitCode: 4, text: "Abbruch: fabrik-eigen. Das Änderungsregister wird nie an Bezieher verteilt und läuft dort nie." };
  if (args.fehler) return { exitCode: AUFRUF_EXIT, text: `${args.fehler}\n${aufrufHilfe()}` };
  if (args.ablage !== undefined && imRepo(args.ablage)) return { exitCode: AUFRUF_EXIT, text: `--ablage liegt im Repo (${args.ablage}): der Schnappschuss gehört außerhalb des Repos.\n${aufrufHilfe()}` };
  let geladen;
  try {
    geladen = lese(args, d.lies);
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}` };
  }
  const heute = args.heute ?? d.heute;
  const ergebnis = auswertung(geladen.register, geladen.exporte, { heute, eigenerRepoTag: d.eigenerRepoTag });
  const gruppen = ticketGruppen(ergebnis, geladen.register);
  if (gruppen.length > 0 && !args.trocken && args.nach === undefined) {
    return { exitCode: 3, text: `Verstoß bei ${gruppen.map((g) => g.ids.join("+")).join(", ")}: ohne --nach <nr> wird nichts angelegt.\n${renderMarkdown(ergebnis)}` };
  }
  let vermerke;
  try {
    vermerke = tickets(gruppen, args, d);
  } catch (e) {
    return { exitCode: 3, text: `Ticket-Anlage gescheitert: ${e.message}\n${renderMarkdown(ergebnis)}` };
  }
  const md = renderMarkdown(ergebnis, vermerke);
  const json = JSON.stringify({ ...ergebnis, tickets: vermerke }, null, 2);
  if (args.ablage !== undefined) {
    d.schreibe(join(args.ablage, `aenderungsregister-${heute}.json`), `${json}\n`);
    d.schreibe(join(args.ablage, `aenderungsregister-${heute}.md`), `${md}\n`);
  }
  return { exitCode: 0, text: args.json ? json : md };
}

function main() {
  const { exitCode, text } = auswerten(parseArgs(process.argv.slice(2)));
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}

if (istDirektaufruf(import.meta.url)) main();
