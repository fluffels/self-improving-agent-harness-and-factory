#!/usr/bin/env node
/**
 * Board-Status der Items (factory#541 L6): der Claim setzt „In Progress“, Freigabe, Abbruch und ein geschlossener PR setzen „Todo“.
 *
 *   node scripts/board-status.mjs setze <nr> --status "In Progress"|"Todo"   # idempotent; Exit 1 ohne Board-Item, Exit 2 ohne die Status-Option
 *   node scripts/board-status.mjs abgleich                                     # offene Items auf „In Progress“ ohne Assignee und ohne offenen PR gehen auf „Todo“
 *
 * Ausgabe von `abgleich` je Zeile `STATUS #<nr>: In Progress → Todo`. Geschrieben wird nur das Status-Feld des Board-Items (nie Issue,
 * Assignee oder Lock); das Board folgt der Trennregel (`boardRolleFuer`), das Repo ist `repo` der Config. `macheIo` teilt sich `epic.mjs`
 * (Status und Position des aufgeteilten Epics); diese Datei importiert `epic.mjs` nie (kein Zyklus).
 */
import { AUFRUF_EXIT, direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { zerlegeRepo } from "./repo-form.mjs";
import { boardDerRolle, boardRepo, boardRolleFuer, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { MUTATION_POSITION, MUTATION_STATUS, kopfEnde, loadItems, verschiebe } from "./board-lib.mjs";

export const STATUS_IN_ARBEIT = "In Progress";
export const STATUS_TODO = "Todo";
const AUFRUF = 'Aufruf: node scripts/board-status.mjs setze <nr> --status "In Progress"|"Todo"\n       node scripts/board-status.mjs abgleich';
const FRAGE_ISSUE =
  'query($o:String!,$n:String!,$k:Int!){ repository(owner:$o,name:$n){ issue(number:$k){ labels(first:30){ nodes{ name } } subIssues(first:1){ totalCount } projectItems(first:20){ nodes{ id project{ id } fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } } } } } } }';
const FRAGE_OPTIONEN = "query($f:ID!){ node(id:$f){ ... on ProjectV2SingleSelectField{ options{ id name } } } }";
const PR_LIMIT = "200";

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
  return { befehl, nr: Number(nr), status: r.werte.status };
}

function setzeStatusFuer(p, io, fehl) {
  const s = io.laden(p.nr);
  if (!s.itemId) return fehl(1, `#${p.nr} steht nicht im Board`, `das Issue ins Board holen (gh project item-add ${s.boardNummer} --owner ${s.besitzer} --url <Issue-URL>), dann erneut aufrufen`);
  if (s.status === p.status) return { code: 0, out: `#${p.nr}: Status ist schon „${p.status}“, nichts zu tun\n`, err: "" };
  const option = s.optionen.find((o) => o.name === p.status);
  if (!option) return fehl(AUFRUF_EXIT, `das Status-Feld des Boards hat keine Option „${p.status}“`, `im Board die Status-Option „${p.status}“ anlegen, dann erneut aufrufen`);
  io.setzeStatus(s.itemId, option.id);
  return { code: 0, out: `#${p.nr}: Status „${s.status ?? "leer"}“ → „${p.status}“\n`, err: "" };
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

/** Das echte io über `gh` für eine Projekt-Config (`exec` ist die Test-Naht von gh-cli). */
export function macheIo(config, { exec } = {}) {
  const { owner, name } = zerlegeRepo(config.repo);
  let ziel = null; // Board des zuletzt geladenen Issues (für setzeStatus und Position)
  const optionenVon = (feldId) => ghJson(["api", "graphql", "-f", `query=${FRAGE_OPTIONEN}`, "-f", `f=${feldId}`], { exec }).data.node?.options ?? [];
  const mutiere = (projectId, feldId, itemId, optionId) =>
    ghText(["api", "graphql", "-f", `query=${MUTATION_STATUS}`, "-f", `p=${projectId}`, "-f", `i=${itemId}`, "-f", `f=${feldId}`, "-f", `o=${optionId}`], { exec });
  return {
    laden(nr) {
      const issue = ghJson(["api", "graphql", "-f", `query=${FRAGE_ISSUE}`, "-f", `o=${owner}`, "-f", `n=${name}`, "-F", `k=${nr}`], { exec }).data.repository.issue;
      if (!issue) throw new Error(`#${nr} nicht gefunden in ${config.repo}`);
      const rolle = boardRolleFuer(issue.labels.nodes.map((l) => l.name), config, { repo: config.repo });
      const board = boardDerRolle(rolle, config);
      const item = issue.projectItems.nodes.find((n) => n?.project?.id === board.projectId);
      ziel = { board, projectId: board.projectId, feldId: board.statusFeldNodeId };
      return {
        kinder: issue.subIssues.totalCount,
        itemId: item?.id ?? null,
        status: item?.fieldValueByName?.name ?? null,
        optionen: optionenVon(board.statusFeldNodeId),
        boardNummer: board.nummer,
        besitzer: board.besitzer,
      };
    },
    setzeStatus(itemId, optionId) {
      mutiere(ziel.projectId, ziel.feldId, itemId, optionId);
    },
    /** Position des Items im zuletzt geladenen Board: `{ noetig, afterId }` für „direkt unter dem Kopf“ (`afterId` null = ganz oben). */
    positionPlan(itemId) {
      const items = loadItems(ziel.board, { repo: boardRepo(ziel.board, config), exec });
      const rest = items.filter((i) => i.id !== itemId);
      const ende = kopfEnde(rest);
      const afterId = ende > 0 ? rest[ende - 1].id : null;
      const neu = verschiebe(items, itemId, afterId);
      return { noetig: neu.some((i, k) => i.id !== items[k].id), afterId };
    },
    setzePosition(itemId, afterId) {
      const args = ["api", "graphql", "-f", `query=${MUTATION_POSITION}`, "-f", `p=${ziel.projectId}`, "-f", `i=${itemId}`];
      ghText(afterId === null ? args : [...args, "-f", `a=${afterId}`], { exec });
    },
    abgleichDaten() {
      const boards = config.boards.map((b) => ({
        projectId: b.projectId,
        feldId: b.statusFeldNodeId,
        optionen: optionenVon(b.statusFeldNodeId),
        items: loadItems(b, { repo: boardRepo(b, config), exec }),
      }));
      const prs = ghJson(["pr", "list", "--repo", config.repo, "--state", "open", "--limit", PR_LIMIT, "--json", "closingIssuesReferences"], { exec });
      return { boards, prIssues: prs.flatMap((p) => (p.closingIssuesReferences ?? []).map((r) => r.number)) };
    },
    setzeStatusIn: mutiere,
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
