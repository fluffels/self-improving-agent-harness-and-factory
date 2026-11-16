// Kein Shebang: wird per `node scripts/regel-verfall.mjs` gestartet UND von test/harness/regel-verfall.test.ts importiert.
/**
 * Regel-Verfall (factory#608, Teil 2/4 von factory#517), ohne Agent, ohne Netz und Secret-Key:
 *
 *   node scripts/regel-verfall.mjs --kandidaten [--export <datei>…] [--heute JJJJ-MM-TT] [--json] [--register <datei>]
 *   node scripts/regel-verfall.mjs --generieren [--heute JJJJ-MM-TT] [--trocken] [--register <datei>]
 *
 * `--kandidaten` listet jedes Ziel mit `heute >= ablauf` und ohne Fang in den letzten 30 Tagen (Messpunkte-Export der Quelle gate-fundquote:
 * `node scripts/gate-fundquote.mjs --waechter-dir test/harness`); „nicht messbar“ (kein Wächter, keine Messpunkte) steht getrennt und ist nie Kandidat,
 * Ziele der Liste `SICHERHEITS_AUSNAHMEN` sind nie Kandidat. `--generieren` legt für jede `test/harness/*.test.ts` und jede fett markierte Regel in
 * `AGENTS.md` ohne Verfall-Zeile eine an (`ablauf` = `aufgenommen` + 30 Tage), bestehende Zeilen bleiben unberührt.
 * FABRIK-EIGEN: das Skript wird nie an Bezieher verteilt und bricht dort ab (Exit 4).
 * Exit 0 Bericht, 1 Lese- oder Registerfehler, 2 Aufruffehler, 4 Abbruch im Bezieher.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { istDatum, leseMesspunkte, pruefeRegister } from "./aenderungsregister-lib.mjs";
import { ankerAus, fehlendeZeilen, kandidaten, renderKandidaten } from "./regel-verfall-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const REGISTER = join(WURZEL, ".github", "aenderungsregister.json");

export const aufrufHilfe = () =>
  "Aufruf: node scripts/regel-verfall.mjs --kandidaten [--export <datei>…] [--heute JJJJ-MM-TT] [--json] [--register <datei>]\n" +
  "        node scripts/regel-verfall.mjs --generieren [--heute JJJJ-MM-TT] [--trocken] [--register <datei>]\n" +
  "Doku: Glossar-Zeilen Standard-Verfall und Sicherheits-Ausnahmeliste in docs/harness-glossar.md (factory#517).";

export function parseArgs(argv) {
  const optionen = {
    kandidaten: { type: "boolean" },
    generieren: { type: "boolean" },
    export: { type: "string", multiple: true },
    json: { type: "boolean" },
    heute: { type: "string" },
    trocken: { type: "boolean" },
    register: { type: "string" },
  };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = {
    kandidaten: werte.kandidaten === true,
    generieren: werte.generieren === true,
    exporte: werte.export ?? [],
    json: werte.json === true,
    heute: werte.heute,
    trocken: werte.trocken === true,
    register: werte.register ?? REGISTER,
  };
  if (fehler) a.fehler = fehler.text;
  else if (a.kandidaten === a.generieren) a.fehler = "genau einen Modus wählen: --kandidaten oder --generieren";
  else if (a.heute !== undefined && !istDatum(a.heute)) a.fehler = `--heute: Datum JJJJ-MM-TT erwartet, nicht ${a.heute}`;
  return a;
}

/** Wächter-Dateien: jede `test/harness/*.test.ts` (Pfad relativ zur Wurzel, sortiert). */
export const waechterPfade = (wurzel = WURZEL) =>
  readdirSync(join(wurzel, "test", "harness"))
    .filter((n) => n.endsWith(".test.ts"))
    .sort()
    .map((n) => `test/harness/${n}`);

/** Existiert das Ziel (Pfad, bei `#` auch der Anker als Überschrift oder bei `AGENTS.md` als fett markierte Regel)? */
export const zielExistiert = (ziel, wurzel = WURZEL) => {
  const [pfad, anker] = ziel.split("#");
  const voll = join(wurzel, pfad);
  if (!existsSync(voll)) return false;
  if (anker === undefined) return true;
  return pfad.endsWith(".md") && ankerAus(readFileSync(voll, "utf8"), pfad === "AGENTS.md").has(anker);
};

function ladeRegister(pfad, lies) {
  let register;
  try {
    register = JSON.parse(lies(pfad, "utf8"));
  } catch (e) {
    throw new Error(`Register ${pfad}: kein lesbares JSON (${e.message})`, { cause: e });
  }
  const fehler = pruefeRegister(register?.zeilen);
  if (fehler.length > 0) throw new Error(`Register ungültig:\n${fehler.join("\n")}`);
  return register;
}

function ladeExporte(pfade, lies) {
  const exporte = [];
  for (const pfad of pfade) {
    try {
      exporte.push(leseMesspunkte(JSON.parse(lies(pfad, "utf8")), pfad));
    } catch (e) {
      throw new Error(e.message.startsWith(pfad) ? e.message : `--export ${pfad}: ${e.message}`, { cause: e });
    }
  }
  return exporte;
}

/** Ablauf ohne `process.exit` (testbar): `{ exitCode, text }`. `deps` (Tests): `heute`, `bezieher`, `lies`, `schreibe`, `waechter`, `agentsText`. */
export function ausfuehren(args, deps = {}) {
  const d = {
    heute: new Date().toISOString().slice(0, 10),
    bezieher: istBezieher(WURZEL) || istBezieher(process.cwd()),
    lies: readFileSync,
    schreibe: writeFileSync,
    waechter: () => waechterPfade(),
    agentsText: () => readFileSync(join(WURZEL, "AGENTS.md"), "utf8"),
    ...deps,
  };
  if (d.bezieher) return { exitCode: 4, text: "Abbruch: fabrik-eigen. Der Regel-Verfall wird nie an Bezieher verteilt und läuft dort nie." };
  if (args.fehler) return { exitCode: AUFRUF_EXIT, text: `${args.fehler}\n${aufrufHilfe()}` };
  const heute = args.heute ?? d.heute;
  try {
    const register = ladeRegister(args.register, d.lies);
    if (args.generieren) {
      const neu = fehlendeZeilen({ zeilen: register.zeilen, waechterPfade: d.waechter(), agentsText: d.agentsText(), heute });
      if (!args.trocken && neu.length > 0) d.schreibe(args.register, `${JSON.stringify({ ...register, zeilen: [...register.zeilen, ...neu] }, null, 2)}\n`);
      return { exitCode: 0, text: `${args.trocken ? "Trocken: würde anlegen" : "Angelegt"}: ${neu.length} Verfall-Zeilen${neu.map((z) => `\n- ${z.id} (${z.ziel})`).join("")}` };
    }
    const ergebnis = kandidaten(register, ladeExporte(args.exporte, d.lies), { heute });
    return { exitCode: 0, text: args.json ? JSON.stringify(ergebnis, null, 2) : renderKandidaten(ergebnis) };
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}` };
  }
}

function main() {
  const { exitCode, text } = ausfuehren(parseArgs(process.argv.slice(2)));
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}

if (istDirektaufruf(import.meta.url)) main();
