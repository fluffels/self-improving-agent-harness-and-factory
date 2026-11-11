/**
 * Native GitHub-Kanten (blocked by, Unteraufgabe; factory#202 L1): Die Blocker-Textzeile im Body bleibt maßgeblich, die native Kante kommt zusätzlich,
 * damit das Projekt-Board das Blocked-Icon zeigt (ein Board-Feld braucht es dafür nicht). Gemeinsam genutzt von `spezifikation.mjs`,
 * `sammelticket-anlegen.mjs` und `blocker-migration.mjs`. Die Unteraufgabe (`addSubIssue`) setzt `spezifikation.mjs anlegen --epic <nr>`: das neue Ticket wird Kind des Epics.
 */
import { fehlerText, ghJson, tokenFuerZiel } from "./gh-cli.mjs";

export const ADD_BLOCKED_BY = "mutation($i:ID!,$b:ID!){ addBlockedBy(input:{issueId:$i, blockingIssueId:$b}) { issue { number } } }";

export const ADD_SUB_ISSUE = "mutation($i:ID!,$s:ID!){ addSubIssue(input:{issueId:$i, subIssueId:$s}) { issue { number } } }";

const einzeilig = (t) => String(t).replace(/\s*\n\s*/g, " ").trim();

/** Setzt die native Kante `issueNodeId` ← `blockerNodeId` (GraphQL-Mutation); `opts` = Token-Optionen des Ziel-Repos. */
export function addBlockedBy({ issueNodeId, blockerNodeId, opts }, gh = ghJson) {
  return gh(["api", "graphql", "-f", `query=${ADD_BLOCKED_BY}`, "-f", `i=${issueNodeId}`, "-f", `b=${blockerNodeId}`], opts);
}

/** Echte Naht: Blocker (`{ repo, nummer }`) per REST nach `node_id` auflösen und die Kante setzen. `eigenes` = Repo dieses Checkouts (Token-Wahl). */
export function echteVerknuepfung({ gh = ghJson, env = process.env, eigenes }) {
  return ({ issueNodeId, blocker, repo }) => {
    const knoten = gh(["api", `repos/${blocker.repo}/issues/${blocker.nummer}`], { token: tokenFuerZiel({ ziel: blocker.repo, eigenes, env }) }).node_id;
    addBlockedBy({ issueNodeId, blockerNodeId: knoten, opts: { token: tokenFuerZiel({ ziel: repo, eigenes, env }) } }, gh);
  };
}

/** Echte Naht: das Epic (Nummer im Ziel-Repo) per REST nach `node_id` auflösen und das neue Ticket (`issueNodeId`) als Unteraufgabe anhängen. */
export function echteEpicVerknuepfung({ gh = ghJson, env = process.env, eigenes }) {
  return ({ issueNodeId, epic, repo }) => {
    const opts = { token: tokenFuerZiel({ ziel: repo, eigenes, env }) };
    const epicNodeId = gh(["api", `repos/${repo}/issues/${epic}`], opts).node_id;
    gh(["api", "graphql", "-f", `query=${ADD_SUB_ISSUE}`, "-f", `i=${epicNodeId}`, "-f", `s=${issueNodeId}`], opts);
  };
}

/** Hängt das neue Ticket als Unteraufgabe an das Epic `epic` (nur mit `--epic`). Fehler: Warnungstext (Exit bleibt 0), sonst `""`. */
export function verknuepfeEpic(neu, epic, repo, io) {
  if (epic == null) return "";
  try {
    io.verknuepfeEpic({ issueNodeId: neu.node_id, epic, repo });
    return "";
  } catch (e) {
    return `⚠ Unteraufgabe von #${epic} nicht gesetzt (${einzeilig(fehlerText(e))}), Kante von Hand: Issue #${neu.number} im Epic als Unteraufgabe hinzufügen\n`;
  }
}

/** Setzt je Blocker die native GitHub-Abhängigkeit (nur für das neue Ticket, die Blocker-Zeile bleibt maßgeblich): Zahl = Ziel-Repo, `{ repo, nummer }` = genanntes Repo. Fehler: Warnungstext (Exit bleibt 0), sonst `""`. */
export function verknuepfeBlocker(neu, blocker, repo, io) {
  let warnungen = "";
  for (const b of blocker) {
    const ref = typeof b === "number" ? { repo, nummer: b } : b;
    try {
      io.verknuepfeBlocker({ issueNodeId: neu.node_id, blocker: ref, repo });
    } catch (e) {
      warnungen += `⚠ native Abhängigkeit nicht gesetzt (${ref.repo}#${ref.nummer}: ${einzeilig(fehlerText(e))}), die Blocker-Zeile im Body bleibt maßgeblich\n`;
    }
  }
  return warnungen;
}
