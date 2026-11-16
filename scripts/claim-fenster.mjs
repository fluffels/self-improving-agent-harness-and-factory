// Kein Shebang, kein Direktaufruf: Lib für `langfuse-abgleich-kern.mjs` (Nachlieferer, hook-tauglich) und `hauptchat-zerlegung.mjs`.
/**
 * Claim-Fenster (factory#524, ADR 0036): welchem Ticket gehört ein Call? Das Haupttranskript einer Session trägt die Ereignisse
 * Claim (`gh issue edit <nr> … --add-assignee`), Freigabe (`… --remove-assignee`) und Merge (`gh pr merge`); aus ihnen entsteht
 * je Zeitpunkt genau ein Zustand. Pur, nur Node-Builtins und lokale Libs ohne Netz und ohne `gh` (die Importhülle prüft ein Test);
 * importiert nie `hauptchat-zerlegung`, `langfuse-*` oder `gh-cli`.
 *
 * Zustandsautomat über die nach Zeit sortierten Ereignisse; ein Ereignis wirkt erst auf Calls NACH seiner Zeit (der Call, der den Claim
 * absetzt, ist noch `vor-claim`):
 *   Claim N      → Ticket N (ein Re-Claim desselben N ändert nichts, ein Claim M wechselt)
 *   Freigabe N   → `nach-freigabe`, wenn N das offene Ticket ist (sonst ohne Wirkung)
 *   Merge        → `nachlauf`, wenn ein Fenster offen ist
 * Quellen: Haupttranskript und Top-Level-Subagenten, weil Claim, Freigabe und der Merge im dokumentierten Ablauf auch vom Umsetzer (Top-Level-Subagent) abgesetzt werden; ein verschachtelter Agent (Lens, Gruppe) zählt nicht.
 * Bekannte Grenze: der Claim-Erkenner (`claimNummer`) ist nicht am Befehlsanfang verankert (geteilt mit der Hauptchat-Zerlegung); Freigabe und Merge sind es.
 * Gründe ohne Ticket: `vor-claim`, `nach-freigabe`, `nachlauf`, `ohne-zeit` (Call ohne gültigen Zeitstempel).
 */
import { toolPaare } from "./transkript.mjs";
import { claimNummer, freigabeNummer, istMerge } from "./mess-lib.mjs";

const SHELLS = new Set(["Bash", "PowerShell"]);

/** Tool-Aufrufe der Zeilen als `{ ts, tool, input }` (die Hülle des Nachlieferers kennt `transkript.mjs`, nicht `brain-metrics.mjs`). */
const aufrufe = (zeilen) => toolPaare(zeilen).map(({ use: { row, block } }) => ({ ts: row.timestamp, tool: block.name, input: block.input ?? {} }));

/** Claims der Tool-Events (Bash/PowerShell) als `{ nr, ts, turn }`; `turnVon(ev)` ordnet jedem Claim seinen Turn zu. */
export function claimsAus(events, turnVon) {
  const claims = [];
  for (const ev of events) {
    if (!SHELLS.has(ev.tool)) continue;
    const nr = claimNummer(ev.input?.command);
    if (nr) claims.push({ nr, ts: ev.ts, turn: turnVon(ev) });
  }
  return claims;
}

/**
 * Das Fenster-Protokoll einer geladenen Session (`ladeSessionDatei`): die Ereignisse `{ art: "claim" | "freigabe" | "merge", nr?, t }` aus Haupttranskript
 * und Top-Level-Subagenten (ohne `parentAgentId`; ein verschachtelter Agent zählt nicht), nach Zeit sortiert (stabil). Ereignisse ohne gültige Zeit entfallen.
 */
export function fensterAus(sitzung) {
  const events = [
    ...aufrufe(sitzung.main),
    ...(sitzung.subagents ?? []).filter((sa) => !sa.meta?.parentAgentId).flatMap((sa) => aufrufe(sa.zeilen)),
  ];
  const out = [];
  for (const ev of events) {
    if (!SHELLS.has(ev.tool)) continue;
    const t = Date.parse(ev.ts);
    if (!Number.isFinite(t)) continue;
    const command = ev.input?.command;
    const claim = claimNummer(command);
    if (claim) {
      out.push({ art: "claim", nr: claim, t });
      continue;
    }
    const freigabe = freigabeNummer(command);
    if (freigabe) out.push({ art: "freigabe", nr: freigabe, t });
    else if (istMerge(command)) out.push({ art: "merge", t });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Zustand nach einem Ereignis. */
function weiter(zustand, ev) {
  if (ev.art === "claim") return zustand.nr === ev.nr ? zustand : { nr: ev.nr, grund: null };
  if (ev.art === "freigabe") return zustand.nr === ev.nr ? { nr: null, grund: "nach-freigabe" } : zustand;
  return zustand.nr == null ? zustand : { nr: null, grund: "nachlauf" };
}

/** Das Ticket eines Zeitpunkts (ISO-Text oder Millisekunden): `{ nr, grund: null }` im offenen Fenster, sonst `{ nr: null, grund }` (`vor-claim`, `nach-freigabe`, `nachlauf`, `ohne-zeit`). */
export function ticketFuer(fenster, ts) {
  const t = typeof ts === "number" ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return { nr: null, grund: "ohne-zeit" };
  let zustand = { nr: null, grund: "vor-claim" };
  for (const ev of fenster) {
    if (ev.t >= t) break;
    zustand = weiter(zustand, ev);
  }
  return zustand;
}
