#!/usr/bin/env node
/**
 * Aufgeteiltes Epic (factory#507 L4): bleibt offen, zugewiesen und im Board-Status „In Progress“ und steht direkt unter dem Kopf (🚨/🔒 gehen
 * vor), bis es mit dem letzten Kind schließt (Workflow `epic-abschluss.yml`).
 *
 *   node scripts/epic.mjs aufgeteilt <nr>   # prüft, dass das Epic Kinder hat, setzt den Board-Status auf „In Progress“ und rückt es unter den Kopf
 *
 * Ohne Kinder Exit 1, ohne die Status-Option „In Progress“ Exit 2 (je mit Fix-Zeile); steht Status oder Position schon richtig, keine Mutation.
 * Geschrieben wird nur Status und Position des Board-Items (nie Issue, Assignee oder Lock); das Board folgt der Trennregel (`boardRolleFuer`),
 * das Repo ist `repo` der Config. Das io teilt sich diese Datei mit `board-status.mjs` (dort `macheIo`, Lib `board-status-io.mjs`).
 */
import { AUFRUF_EXIT, direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerText } from "./gh-cli.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { macheIo, setzeStatusAuf } from "./board-status-io.mjs";

export { macheIo };
export const ZIEL_STATUS = "In Progress";
const AUFRUF = "Aufruf: node scripts/epic.mjs aufgeteilt <nr>";

/** Pur: prüft den Aufruf (`aufgeteilt <nr>`); `{ fehler }` oder `{ nr }`. Läuft vor jedem I/O. */
export function pruefe(argv) {
  const [befehl, nr, ...rest] = argv;
  if (befehl !== "aufgeteilt") return { fehler: `unbekannter Befehl ${befehl === undefined ? "(keiner)" : `„${befehl}“`}` };
  const r = flagsLesen(argv.slice(1), {}, { positionale: true });
  if (r.fehler) return { fehler: r.fehler.text };
  if (rest.length || !/^[1-9]\d{0,9}$/.test(nr ?? "")) return { fehler: "<nr> fehlt oder ist keine positive Ganzzahl" };
  return { nr: Number(nr) };
}

/** Ausführung mit eingespritztem `io` (`laden(nr)`, `setzeStatus(itemId, optionId)`, `positionPlan(itemId)`, `setzePosition(itemId, afterId)`); Ergebnis `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const p = pruefe(argv);
  if (p.fehler) return { code: AUFRUF_EXIT, out: "", err: `${p.fehler}\n${AUFRUF}\n` };
  const fehl = (code, text, fix) => ({ code, out: "", err: `✖ ${text}\nFix: ${fix}\n` });
  try {
    const s = io.laden(p.nr);
    if (!(s.kinder > 0)) return fehl(1, `#${p.nr} hat keine Kinder`, `erst Kinder per node scripts/spezifikation.mjs anlegen … --epic ${p.nr}, dann erneut aufrufen`);
    if (!s.itemId) return fehl(1, `#${p.nr} steht nicht im Board`, `das Issue ins Board holen (gh project item-add ${s.boardNummer} --owner ${s.besitzer} --url <Issue-URL>), dann erneut aufrufen`);
    const st = setzeStatusAuf(p.nr, s, io, ZIEL_STATUS);
    if (st.fehler) return fehl(...st.fehler);
    const plan = io.positionPlan(s.itemId);
    if (!plan.noetig) return { code: 0, out: st.zeile, err: "" };
    io.setzePosition(s.itemId, plan.afterId);
    return { code: 0, out: `${st.zeile}#${p.nr}: Position direkt unter dem Kopf\n`, err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `✖ ${fehlerText(e)}\nFix: gh-Anmeldung und Projekt-Config prüfen\n` };
  }
}

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe,
    fehlerErgebnis: (_argv, vorab) => ({ code: AUFRUF_EXIT, out: "", err: `${vorab.fehler}\n${AUFRUF}\n` }),
    io: () => macheIo(ladeProjektConfig()),
    fuehreAus,
  });
}
