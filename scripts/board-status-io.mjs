/**
 * Das echte Board-io über `gh` (factory#541): geteilt von `board-status.mjs` und `epic.mjs`; Einstiegsskripte importieren nie voneinander,
 * darum liegt es in dieser Lib ohne Direktaufruf-Guard.
 */
import { ghJson, ghText } from "./gh-cli.mjs";
import { zerlegeRepo } from "./repo-form.mjs";
import { boardDerRolle, boardRepo, boardRolleFuer } from "./projekt-config-lib.mjs";
import { MUTATION_POSITION, MUTATION_STATUS, kopfEnde, loadItems, verschiebe } from "./board-lib.mjs";

const FRAGE_ISSUE =
  'query($o:String!,$n:String!,$k:Int!){ repository(owner:$o,name:$n){ issue(number:$k){ labels(first:30){ nodes{ name } } subIssues(first:1){ totalCount } projectItems(first:20){ nodes{ id project{ id } fieldValueByName(name:"Status"){ ... on ProjectV2ItemFieldSingleSelectValue{ name } } } } } } }';
const FRAGE_OPTIONEN = "query($f:ID!){ node(id:$f){ ... on ProjectV2SingleSelectField{ options{ id name } } } }";
const PR_LIMIT = "200";

/**
 * Pur (geteilt von `board-status.mjs` und `epic.mjs`): setzt das Item `s` (Ergebnis von `io.laden`) auf den Status `ziel`;
 * `{ fehler: [code, text, fix] }` oder `{ zeile }` (Ausgabezeile). Steht der Status schon richtig, keine Mutation.
 */
export function setzeStatusAuf(nr, s, io, ziel) {
  if (s.status === ziel) return { zeile: `#${nr}: Status ist schon „${ziel}“, nichts zu tun\n` };
  const option = s.optionen.find((o) => o.name === ziel);
  if (!option) return { fehler: [2, `das Status-Feld des Boards hat keine Option „${ziel}“`, `im Board die Status-Option „${ziel}“ anlegen, dann erneut aufrufen`] };
  io.setzeStatus(s.itemId, option.id);
  return { zeile: `#${nr}: Status „${s.status ?? "leer"}“ → „${ziel}“\n` };
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
      // nur Boards des eigenen Repos: fremde Boards (Bezieher) schreibt die Fabrik nie, und PR-Nummern gelten nur je Repo
      const boards = config.boards.filter((b) => boardRepo(b, config) === config.repo).map((b) => ({
        projectId: b.projectId,
        feldId: b.statusFeldNodeId,
        optionen: optionenVon(b.statusFeldNodeId),
        items: loadItems(b, { repo: boardRepo(b, config), exec }),
      }));
      const prs = ghJson(["pr", "list", "--repo", config.repo, "--state", "open", "--limit", PR_LIMIT, "--json", "closingIssuesReferences"], { exec });
      if (prs.length >= Number(PR_LIMIT)) throw new Error(`mindestens ${PR_LIMIT} offene PRs: die Liste ist abgeschnitten, ein Abgleich wäre unsicher`);
      return { boards, prIssues: prs.flatMap((p) => (p.closingIssuesReferences ?? []).map((r) => r.number)) };
    },
    setzeStatusIn: mutiere,
  };
}
