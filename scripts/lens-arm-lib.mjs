// Blatt-Modul ohne Direktaufruf: Guards und Messskripte importieren es (Einstiegsskripte importieren nicht voneinander); das CLI ist `lens-arm.mjs`.
/**
 * A/B-Arm der Lens je Ticket (factory#235): Arm A ist die Lens mit Root-Kontext (`agenten.lens` der Projekt-Config), Arm B die Lens
 * „Kern je Rolle“ (`LENS_B`, ohne Root-Kontextdatei). Beide laufen im selben Fenster an echten Tickets; die Zuordnung ist
 * deterministisch nach Ticket-Parität (gerade = A, ungerade = B), damit sie weder vom Orchestrator noch von einer Laune abhängt.
 * Ein Bezieher kennt die Arm-B-Definition nicht und läuft immer in Arm A. `armeZuordnen` ist die Prüfseite der Messung:
 * ein Ticket mit Läufen in beiden Typen oder in keinem ist ungültig. Nur pure Funktionen, keine Imports.
 */

/** Agentenname der Arm-B-Lens (`.claude/agents/lens-kern-je-rolle.md`): bewusst neutral, dieses Skript gehört zum Kern. */
export const LENS_B = "lens-kern-je-rolle";

/** Beide Lens-Typen, Arm A zuerst. Pur. */
export const lensTypen = (namen) => [namen.agenten.lens, LENS_B];

/** Arm und Agententyp für ein Ticket: gerade = A, ungerade = B; ein Bezieher immer A. Pur. */
export function lensArm(nr, { namen, bezieher = false }) {
  const b = !bezieher && Number(nr) % 2 === 1;
  return b ? { arm: "B", typ: LENS_B } : { arm: "A", typ: namen.agenten.lens };
}

/**
 * Ordnet Tickets ihrem Typ zu. `typenJeTicket`: `Map` oder Objekt `{ ticket: [Typ…] }` mit den Typen, in denen das Ticket Läufe hat.
 * Ein Ticket mit genau einem Typ kommt in `gruppen[typ]`, eines mit mehreren (`beide`) oder ohne (`keiner`) in `ungueltig`. Pur.
 */
export function armeZuordnen(typenJeTicket) {
  const eintraege = typenJeTicket instanceof Map ? [...typenJeTicket] : Object.entries(typenJeTicket).map(([t, v]) => [Number(t), v]);
  const gruppen = {};
  const ungueltig = [];
  for (const [ticket, rohTypen] of eintraege) {
    const typen = [...new Set(rohTypen)].sort();
    if (typen.length === 1) (gruppen[typen[0]] ??= []).push(ticket);
    else ungueltig.push({ ticket, grund: typen.length === 0 ? "keiner" : "beide", typen });
  }
  return { gruppen, ungueltig };
}
