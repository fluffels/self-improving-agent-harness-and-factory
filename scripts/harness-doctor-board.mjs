// Blatt-Modul: importiert nur die Ergebnis-Form; die Lese-Naht `lesen(args)` reicht der Aufrufer (gh) herein.
/* Harness-Doctor, Punkt `Board-Ansicht` (factory#247 L7, L9): prüft je Board der Projekt-Config (`boards[]` mit `projectId`), ob die Ansicht zu den Abläufen passt, die `board-place` und die
 * Ticket-Auswahl voraussetzen:
 *   - die Standardansicht (kleinste `number`) filtert `-status:Done repo:<Repo des Boards>` (Repo: `board.repo`, sonst `repo` der Config): ohne den Filter zeigt das Board Fremd-Repos und Erledigtes;
 *   - die Standardansicht hat keine Sortierung (`sortByFields` leer): sonst ist die manuelle Reihenfolge, die `board-place` setzt, außer Kraft;
 *   - der Projekt-Workflow „Auto-archive items“ ist aktiv: sonst wächst die Ansicht mit erledigten Tickets.
 * Ein Ergebnis für alle Boards: Lücke, sobald ein Board abweicht; sonst nicht prüfbar, sobald eines nicht prüfbar ist; sonst OK. Keine Boards in der Config: kein Ergebnis.
 *
 * Nur lokal in `--pruefen`: die Abfrage braucht das Projekt-Leserecht des Kontos, das Token des Wochenlaufs reicht dafür nicht überall. Grenze (fail-closed): was GraphQL nicht liefert
 * (Lesefehler, Projekt nicht gefunden, `views`, `filter`, `sortByFields` oder `workflows` fehlen bzw. haben eine andere Form, kein `projectId`), macht das Board `NICHT PRÜFBAR`, nie grün.
 * Annahmen: die Abfrage liest `views(first: 20)` und `workflows(first: 30)` ohne Paginierung (mehr Ansichten oder Workflows liegen außerhalb des Blicks; die Standardansicht ist die mit der kleinsten `number` unter den gelesenen),
 * und der geforderte Filter ist fest `-status:Done` (ein Board mit anderem Statusnamen für „erledigt“ meldet eine Lücke).
 * Geprüft wird nur die Standardansicht; weitere Ansichten und deren Filter bleiben ungeprüft. Der Fix beschreibt den Handgriff in der Oberfläche (Ansichten ändert der Doctor nie selbst).
 */
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";

const PUNKT = "Board-Ansicht";
const AUTO_ARCHIV = "Auto-archive items";
const NODES = "{ nodes { number filter sortByFields(first: 10) { nodes { direction field { ... on ProjectV2FieldCommon { name } } } } } }";
export const BOARD_QUERY = `query($id: ID!) { node(id: $id) { ... on ProjectV2 { views(first: 20) ${NODES} workflows(first: 30) { nodes { name enabled } } } } }`;

const args = (projectId) => ["api", "graphql", "-f", `query=${BOARD_QUERY}`, "-f", `id=${projectId}`];
const bezeichnung = (b) => `Board ${b.rolle ?? "?"} (Nr. ${b.nummer ?? "?"})`;

/** Die Standardansicht (kleinste `number`) oder `null`. */
function standardAnsicht(views) {
  const liste = Array.isArray(views?.nodes) ? views.nodes.filter((v) => v && Number.isInteger(v.number)) : [];
  return liste.length === 0 ? null : liste.reduce((a, b) => (b.number < a.number ? b : a));
}

/** Abweichungen und Fixes einer gelesenen Antwort (`knoten` = `data.node`); `{ nicht: grund }`, wenn ein Feld nicht zu lesen ist. */
function bewerte(knoten, repo) {
  const ansicht = standardAnsicht(knoten.views);
  if (ansicht === null) return { nicht: "keine Ansicht in der Antwort (`views`)" };
  if (typeof ansicht.filter !== "string") return { nicht: "die Standardansicht liefert keinen Filter (`filter`)" };
  if (!Array.isArray(ansicht.sortByFields?.nodes)) return { nicht: "die Standardansicht liefert keine Sortierung (`sortByFields`)" };
  if (!Array.isArray(knoten.workflows?.nodes)) return { nicht: "die Antwort enthält keine Projekt-Workflows (`workflows`)" };
  const tokens = ansicht.filter.split(/\s+/).map((t) => t.toLowerCase());
  const befunde = [];
  const fixe = [];
  const soll = `-status:Done repo:${repo}`;
  if (!tokens.includes("-status:done") || !tokens.includes(`repo:${repo.toLowerCase()}`)) {
    befunde.push(`Filter der Standardansicht „${ansicht.filter}“ enthält nicht ${soll}`);
    fixe.push(`Ansicht ${ansicht.number}: Filter auf \`${soll}\` setzen`);
  }
  if (ansicht.sortByFields.nodes.length > 0) {
    befunde.push(`Sortierung gesetzt (${ansicht.sortByFields.nodes.map((s) => s?.field?.name ?? "?").join(", ")}): die manuelle Reihenfolge von board-place wirkt nicht`);
    fixe.push(`Ansicht ${ansicht.number}: Sortierung entfernen (Ansicht, Sortierung, „Manuell“), offene Tickets danach einmal per \`node scripts/board-place.mjs\` ordnen`);
  }
  if (!knoten.workflows.nodes.some((w) => w?.name === AUTO_ARCHIV && w.enabled === true)) {
    befunde.push(`Projekt-Workflow „${AUTO_ARCHIV}“ ist nicht aktiv oder fehlt`);
    fixe.push(`im Board unter Workflows „${AUTO_ARCHIV}“ aktivieren`);
  }
  return { befunde, fixe };
}

/** Ein Board: `{ nicht }` (nicht prüfbar), `{ befunde, fixe }` (leer = in Ordnung). */
function pruefeBoard(board, repo, lesen) {
  if (typeof board.projectId !== "string" || board.projectId === "") return { nicht: "kein `projectId` in der Projekt-Config: das Board lässt sich nicht abfragen" };
  let antwort;
  try {
    antwort = lesen(args(board.projectId));
  } catch (e) {
    return { nicht: `nicht lesbar (${String(e?.message ?? e).split("\n")[0]})` };
  }
  const knoten = antwort?.data?.node;
  if (knoten === null || typeof knoten !== "object") return { nicht: "Antwort ohne Projekt (kein Leserecht oder Projekt nicht gefunden)" };
  return bewerte(knoten, board.repo ?? repo);
}

/** Der Punkt `Board-Ansicht` als Liste: leer ohne Boards, sonst genau ein Ergebnis. `config` ist die geladene Projekt-Config, `lesen(args)` liefert die geparste GraphQL-Antwort (wirft bei Fehler). */
export function boardPunkte({ config, lesen }) {
  const boards = Array.isArray(config?.boards) ? config.boards.filter((b) => b && typeof b === "object") : [];
  if (boards.length === 0) return [];
  const je = boards.map((b) => ({ name: bezeichnung(b), ...pruefeBoard(b, config.repo, lesen) }));
  const abweichend = je.filter((r) => r.befunde?.length > 0);
  const offen = je.filter((r) => r.nicht !== undefined);
  if (abweichend.length > 0) {
    const text = [...abweichend.map((r) => `${r.name}: ${r.befunde.join("; ")}`), ...offen.map((r) => `${r.name}: nicht prüfbar (${r.nicht})`)].join(" | ");
    return [luecke(PUNKT, text, abweichend.flatMap((r) => r.fixe).join("; "))];
  }
  if (offen.length > 0) {
    return [nichtPruefbar(PUNKT, offen.map((r) => `${r.name}: ${r.nicht}`).join(" | "), "mit einem Konto mit Projekt-Leserecht prüfen (gh auth status, Scope `read:project`), `projectId` der Boards in der Projekt-Config eintragen, dann erneut prüfen")];
  }
  return [gut(PUNKT)];
}
