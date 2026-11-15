#!/usr/bin/env node
/**
 * Board-Status der Items (factory#541 L6): der Claim setzt „In Progress“, Freigabe, Abbruch und ein geschlossener PR setzen „Todo“.
 *
 *   node scripts/board-status.mjs setze <nr> --status "In Progress"|"Todo"   # idempotent; Exit 1 ohne Board-Item, Exit 2 ohne die Status-Option
 *   node scripts/board-status.mjs abgleich                                     # offene Items auf „In Progress“ ohne Assignee und ohne offenen PR gehen auf „Todo“
 *
 * Ausgabe von `abgleich` je Zeile `STATUS #<nr>: In Progress → Todo`. Geschrieben wird nur das Status-Feld des Board-Items (nie Issue,
 * Assignee oder Lock); das Board folgt der Trennregel (`boardRolleFuer`), das Repo ist `repo` der Config. `macheIo` liegt in `board-status-io.mjs` und teilt sich
 * `epic.mjs` (Status und Position des aufgeteilten Epics).
 */
import { AUFRUF_EXIT, direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerText } from "./gh-cli.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { macheIo, setzeStatusAuf } from "./board-status-io.mjs";

export { macheIo };

export const STATUS_IN_ARBEIT = "In Progress";
export const STATUS_TODO = "Todo";
const AUFRUF = 'Aufruf: node scripts/board-status.mjs setze <nr> --status "In Progress"|"Todo"\n       node scripts/board-status.mjs abgleich';

/** Pur: prüft den Aufruf; `{ fehler }`, `{ befehl: "setze", nr, status }` oder `{ befehl: "abgleich" }`. Läuft vor jedem I/O. */
export function pruefe(argv) {
  const [befehl, ...rest] = argv;
  if (befehl === "abgleich") {
    const r = flagsLesen(rest, {});
    return r.fehler ? { fehler: r.fehler.text } : { befehl };
  }
  if (befehl !== "setze") return { fehler: `unbekannter Befehl ${befehl === undefined ? "(keiner)" : `„${befehl}“`}` };
  const r = flagsLesen(rest, { status: { type: "string" } }, { positionale: true, pflicht: ["status"] });
  if (r.fehler) return { fehler: r.fehler.text };
  const [nr, ...mehr] = r.positionale;
  if (mehr.length || !/^[1-9]\d{0,9}$/.test(nr ?? "")) return { fehler: "<nr> fehlt oder ist keine positive Ganzzahl" };
  if (![STATUS_IN_ARBEIT, STATUS_TODO].includes(r.werte.status)) return { fehler: `--status ist „${STATUS_IN_ARBEIT}“ oder „${STATUS_TODO}“` };
  return { befehl, nr: Number(nr), status: r.werte.status };
}

function setzeStatusFuer(p, io, fehl) {
  const s = io.laden(p.nr);
  if (!s.itemId) return fehl(1, `#${p.nr} steht nicht im Board`, `das Issue ins Board holen (gh project item-add ${s.boardNummer} --owner ${s.besitzer} --url <Issue-URL>), dann erneut aufrufen`);
  const st = setzeStatusAuf(p.nr, s, io, p.status);
  return st.fehler ? fehl(...st.fehler) : { code: 0, out: st.zeile, err: "" };
}

/** Pur: die Items, die der Abgleich auf Todo setzt: offen, „In Progress“, ohne Assignee, kein offener PR verweist darauf. */
export function abzugleichen(items, prIssues) {
  return items.filter((i) => i.state === "open" && i.status === STATUS_IN_ARBEIT && (i.assignees ?? []).length === 0 && !prIssues.includes(i.number));
}

function abgleichen(io, fehl) {
  const { boards, prIssues } = io.abgleichDaten();
  let out = "";
  for (const b of boards) {
    const treffer = abzugleichen(b.items, prIssues);
    if (treffer.length === 0) continue;
    const option = b.optionen.find((o) => o.name === STATUS_TODO);
    if (!option) return fehl(AUFRUF_EXIT, `das Status-Feld des Boards hat keine Option „${STATUS_TODO}“`, `im Board die Status-Option „${STATUS_TODO}“ anlegen, dann erneut aufrufen`);
    for (const i of treffer) {
      io.setzeStatusIn(b.projectId, b.feldId, i.id, option.id);
      out += `STATUS #${i.number}: ${STATUS_IN_ARBEIT} → ${STATUS_TODO}\n`;
    }
  }
  return { code: 0, out, err: "" };
}

/** Ausführung mit eingespritztem `io`; Ergebnis `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const p = pruefe(argv);
  if (p.fehler) return { code: AUFRUF_EXIT, out: "", err: `${p.fehler}\n${AUFRUF}\n` };
  const fehl = (code, text, fix) => ({ code, out: "", err: `✖ ${text}\nFix: ${fix}\n` });
  try {
    return p.befehl === "setze" ? setzeStatusFuer(p, io, fehl) : abgleichen(io, fehl);
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
