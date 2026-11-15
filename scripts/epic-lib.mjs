// Kein Shebang: Lib ohne Einstieg, nur reine Funktionen (Epic-Abschluss, factory#507 L4).
import { gleichesRepo } from "./repo-form.mjs";

/**
 * Epic-Abschluss, pure Logik: ein aufgeteiltes Epic schließt erst mit seinem letzten Kind; jedes `CLOSED` zählt (auch „not planned“), eine
 * unvollständig gelesene Kinderliste (mehr Kinder, als die Abfrage liefert) schließt nie (fail-closed).
 *
 * Bekannte Grenzen: Kinder nur im Body ohne native Unteraufgaben-Kante werden nicht erkannt; ein Kind, das nach dem Schließen des Epics wieder
 * geöffnet wird, öffnet das Epic nicht; ein Close durch `GITHUB_TOKEN` löst keinen `issues.closed`-Lauf aus (verschachtelte Epics
 * kaskadieren erst im täglichen Lauf oder über `EPIC-REST` in `claims-pruefen`).
 */

/** Pur: `{ total, offen, vollstaendig }` aus der GraphQL-Antwort `subIssues` (`total` = totalCount, `zustaende` = Zustände der gelesenen Knoten). */
export function kinderStand({ total, zustaende }) {
  const liste = Array.isArray(zustaende) ? zustaende : [];
  const n = Number.isInteger(total) && total >= 0 ? total : 0;
  return { total: n, offen: liste.filter((z) => z !== "CLOSED").length, vollstaendig: n <= liste.length };
}

/**
 * Pur: was geschieht mit dem Elternteil `parent` eines gerade geschlossenen Kindes in `repo`? `{ aktion: "schliessen" | "offen" | "nichts", grund }`.
 * `parent`: `{ number, state, repository: { nameWithOwner }, subIssues: { totalCount, nodes: [{ state }] } }` oder `null`/`undefined` (kein Elternteil).
 */
export function abschlussEntscheidung({ repo, parent }) {
  if (!parent || typeof parent !== "object") return { aktion: "nichts", grund: "kein Elternteil" };
  if (!gleichesRepo(parent.repository?.nameWithOwner, repo)) return { aktion: "nichts", grund: "Elternteil in einem anderen Repo" };
  if (parent.state !== "OPEN") return { aktion: "nichts", grund: "Elternteil nicht offen" };
  const stand = kinderStand({ total: parent.subIssues?.totalCount, zustaende: (parent.subIssues?.nodes ?? []).map((k) => k?.state) });
  if (stand.total === 0) return { aktion: "nichts", grund: "Elternteil ohne Kinder" };
  if (!stand.vollstaendig) return { aktion: "nichts", grund: "Kinderliste unvollständig gelesen" };
  if (stand.offen > 0) return { aktion: "offen", grund: `${stand.offen} von ${stand.total} Kindern offen` };
  return { aktion: "schliessen", grund: `alle ${stand.total} Kinder geschlossen` };
}
