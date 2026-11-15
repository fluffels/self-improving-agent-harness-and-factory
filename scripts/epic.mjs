#!/usr/bin/env node
/**
 * Aufgeteiltes Epic (factory#507 L4): bleibt offen, zugewiesen und im Board-Status „In Progress“ und schließt mit dem letzten Kind
 * (Workflow `epic-abschluss.yml`).
 *
 *   node scripts/epic.mjs aufgeteilt <nr>   # prüft, dass das Epic Kinder hat, und setzt den Board-Status auf „In Progress“
 *
 * Ohne Kinder Exit 1, ohne die Status-Option „In Progress“ Exit 2 (je mit Fix-Zeile); steht der Status schon richtig, keine Mutation. Geschrieben
 * wird nur das Status-Feld des Board-Items (nie Issue, Assignee oder Lock); das Board folgt der Trennregel (`boardRolleFuer`), das Repo ist `repo` der Config.
 */
import { AUFRUF_EXIT, direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { zerlegeRepo } from "./repo-form.mjs";
import { boardDerRolle, boardRolleFuer, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { MUTATION_STATUS } from "./board-lib.mjs";

export const ZIEL_STATUS = "In Progress";
const AUFRUF = "Aufruf: node scripts/epic.mjs aufgeteilt <nr>";
const FRAGE_ISSUE =
  'query($o:String!,$n:String!,$k:Int!){ repository(owner:$o,name:$n){ issue(number:$k){ labels(first:30){ nodes{ name } } subIssues(first:1){ totalCount } projectItems(first:20){ nodes{ id project{ id } fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } } } } } } }';
const FRAGE_OPTIONEN = "query($f:ID!){ node(id:$f){ ... on ProjectV2SingleSelectField{ options{ id name } } } }";

/** Pur: prüft den Aufruf (`aufgeteilt <nr>`); `{ fehler }` oder `{ nr }`. Läuft vor jedem I/O. */
export function pruefe(argv) {
  const [befehl, nr, ...rest] = argv;
  if (befehl !== "aufgeteilt") return { fehler: `unbekannter Befehl ${befehl === undefined ? "(keiner)" : `„${befehl}“`}` };
  const r = flagsLesen(argv.slice(1), {}, { positionale: true });
  if (r.fehler) return { fehler: r.fehler.text };
  if (rest.length || !/^[1-9]\d{0,9}$/.test(nr ?? "")) return { fehler: "<nr> fehlt oder ist keine positive Ganzzahl" };
  return { nr: Number(nr) };
}

/** Ausführung mit eingespritztem `io` (`laden(nr)`, `setzeStatus(itemId, optionId)`); Ergebnis `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const p = pruefe(argv);
  if (p.fehler) return { code: AUFRUF_EXIT, out: "", err: `${p.fehler}\n${AUFRUF}\n` };
  const fehl = (code, text, fix) => ({ code, out: "", err: `✖ ${text}\nFix: ${fix}\n` });
  try {
    const s = io.laden(p.nr);
    if (!(s.kinder > 0)) return fehl(1, `#${p.nr} hat keine Kinder`, `erst Kinder per node scripts/spezifikation.mjs anlegen … --epic ${p.nr}, dann erneut aufrufen`);
    if (!s.itemId) return fehl(1, `#${p.nr} steht nicht im Board`, `das Issue ins Board holen (gh project item-add ${s.boardNummer} --owner ${s.besitzer} --url <Issue-URL>), dann erneut aufrufen`);
    if (s.status === ZIEL_STATUS) return { code: 0, out: `#${p.nr}: Status ist schon „${ZIEL_STATUS}“, nichts zu tun\n`, err: "" };
    const option = s.optionen.find((o) => o.name === ZIEL_STATUS);
    if (!option) return fehl(AUFRUF_EXIT, `das Status-Feld des Boards hat keine Option „${ZIEL_STATUS}“`, `im Board die Status-Option „${ZIEL_STATUS}“ anlegen, dann erneut aufrufen`);
    io.setzeStatus(s.itemId, option.id);
    return { code: 0, out: `#${p.nr}: Status „${s.status ?? "leer"}“ → „${ZIEL_STATUS}“\n`, err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `✖ ${fehlerText(e)}\nFix: gh-Anmeldung und Projekt-Config prüfen\n` };
  }
}

/** Das echte io über `gh` für eine Projekt-Config (`exec` ist die Test-Naht von gh-cli). */
export function macheIo(config, { exec } = {}) {
  const { owner, name } = zerlegeRepo(config.repo);
  let ziel = null; // Board des zuletzt geladenen Epics (Projekt-ID, Status-Feld)
  return {
    laden(nr) {
      const issue = ghJson(["api", "graphql", "-f", `query=${FRAGE_ISSUE}`, "-f", `o=${owner}`, "-f", `n=${name}`, "-F", `k=${nr}`], { exec }).data.repository.issue;
      if (!issue) throw new Error(`#${nr} nicht gefunden in ${config.repo}`);
      const rolle = boardRolleFuer(issue.labels.nodes.map((l) => l.name), config, { repo: config.repo });
      const board = boardDerRolle(rolle, config);
      const item = issue.projectItems.nodes.find((n) => n?.project?.id === board.projectId);
      ziel = { projectId: board.projectId, feldId: board.statusFeldNodeId };
      const optionen = ghJson(["api", "graphql", "-f", `query=${FRAGE_OPTIONEN}`, "-f", `f=${board.statusFeldNodeId}`], { exec }).data.node?.options ?? [];
      return {
        kinder: issue.subIssues.totalCount,
        itemId: item?.id ?? null,
        status: item?.fieldValueByName?.name ?? null,
        optionen,
        boardNummer: board.nummer,
        besitzer: board.besitzer,
      };
    },
    setzeStatus(itemId, optionId) {
      ghText(["api", "graphql", "-f", `query=${MUTATION_STATUS}`, "-f", `p=${ziel.projectId}`, "-f", `i=${itemId}`, "-f", `f=${ziel.feldId}`, "-f", `o=${optionId}`], { exec });
    },
  };
}

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe,
    fehlerErgebnis: (_argv, vorab) => ({ code: AUFRUF_EXIT, out: "", err: `${vorab.fehler}\n${AUFRUF}\n` }),
    io: () => macheIo(ladeProjektConfig()),
    fuehreAus,
  });
}
