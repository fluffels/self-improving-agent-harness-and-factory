// Kein Shebang: wird per `node scripts/langfuse-auswertung.mjs` gestartet UND von test/langfuse-auswertung.test.ts importiert.
/**
 * Langfuse-Auswertung (factory#289, Teil 5/5 von factory#274): Kostenbericht aus Exporten des Langfuse-MCP `queryMetrics`.
 *
 *   node scripts/langfuse-auswertung.mjs --rezept --von <ISO> --bis <ISO> [--rolle <name>…]
 *   node scripts/langfuse-auswertung.mjs --export <datei>… [--json]
 *
 * NUR OFFLINE: die CLI liest Exportdateien (und mit `--rezept` die Agentennamen aus `.claude/agents/*.md`), nie Netz und nie
 * den Langfuse-Secret-Key (ein Test hält die Import-Hülle fest). Die Rechenlogik steht pur in `langfuse-auswertung-lib.mjs`.
 * Exit 0 Bericht (auch mit Datenlücken), 1 Export- oder Lesefehler, 2 Aufruffehler.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flagsLesen, AUFRUF_EXIT } from "./flag-lib.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";
import { agentenNamen } from "./agenten-namen.mjs";
import { bericht, leseExport, renderMarkdown, rezept } from "./langfuse-auswertung-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));

export const aufrufHilfe = () =>
  "Aufruf: node scripts/langfuse-auswertung.mjs --export <datei> [--export <datei>…] [--json]\n" +
  "        node scripts/langfuse-auswertung.mjs --rezept --von <ISO> --bis <ISO> [--rolle <name>…] [--agenten <ordner>]\n" +
  "`bis` höchstens jetzt minus 30 min (Ruhefrist der Ingestion). Rezept und Grenzen: " +
  factorySeiteIn(WURZEL, "docs/model-routing.md", "langfuse-auswertung-factory289") + ".";

export function parseArgs(argv) {
  const optionen = {
    export: { type: "string", multiple: true },
    json: { type: "boolean" },
    rezept: { type: "boolean" },
    von: { type: "string" },
    bis: { type: "string" },
    rolle: { type: "string", multiple: true },
    agenten: { type: "string" },
  };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = {
    exporte: werte.export ?? [],
    json: werte.json === true,
    rezept: werte.rezept === true,
    von: werte.von,
    bis: werte.bis,
    rollen: werte.rolle ?? [],
    agenten: werte.agenten ?? join(WURZEL, ".claude", "agents"),
  };
  if (fehler) a.fehler = fehler.text;
  return a;
}

export { agentenNamen };

function rezeptAusgeben(args, deps) {
  if (Number.isNaN(Date.parse(args.von)) || Number.isNaN(Date.parse(args.bis)) || Date.parse(args.von) >= Date.parse(args.bis)) {
    return { exitCode: AUFRUF_EXIT, text: `--rezept braucht --von und --bis (ISO mit Zeitzone, von vor bis).\n${aufrufHilfe()}` };
  }
  try {
    const rollen = [...agentenNamen(args.agenten, deps), ...args.rollen];
    return { exitCode: 0, text: JSON.stringify(rezept({ von: args.von, bis: args.bis, rollen }), null, 2) };
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}` };
  }
}

function exporteLesen(args, lies) {
  return args.exporte.map((pfad) => {
    let json;
    try {
      json = JSON.parse(lies(pfad, "utf8"));
    } catch (e) {
      throw new Error(`--export ${pfad}: kein lesbares JSON (${e.message})`, { cause: e });
    }
    return leseExport(json, pfad);
  });
}

/** Ablauf ohne `process.exit` (testbar): `{ exitCode, text }`. */
export function auswerten(args, deps = {}) {
  const lies = deps.lies ?? readFileSync;
  if (args.fehler) return { exitCode: AUFRUF_EXIT, text: `${args.fehler}\n${aufrufHilfe()}` };
  if (args.rezept) return rezeptAusgeben(args, deps);
  if (!args.exporte.length) return { exitCode: AUFRUF_EXIT, text: `Weder --export noch --rezept angegeben.\n${aufrufHilfe()}` };
  try {
    const b = bericht(exporteLesen(args, lies));
    return { exitCode: 0, text: args.json ? JSON.stringify(b, null, 2) : renderMarkdown(b) };
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}` };
  }
}

function main() {
  const { exitCode, text } = auswerten(parseArgs(process.argv.slice(2)));
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}

if (istDirektaufruf(import.meta.url)) main();
