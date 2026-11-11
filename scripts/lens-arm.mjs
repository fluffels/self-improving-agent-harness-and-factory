// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * A/B-Arm der Lens je Ticket (factory#235): Arm A ist die Lens mit Root-Kontext (`agenten.lens` der Projekt-Config), Arm B die Lens
 * „Kern je Rolle“ (`LENS_B`, ohne Root-Kontextdatei). Beide laufen im selben Fenster an echten Tickets; die Zuordnung ist
 * deterministisch nach Ticket-Parität (gerade = A, ungerade = B), damit sie weder vom Orchestrator noch von einer Laune abhängt.
 * Ein Bezieher kennt die Arm-B-Definition nicht und läuft immer in Arm A.
 *
 *   node scripts/lens-arm.mjs <nr> [--json]    gibt den Agententyp für den Lens-Spawn dieses Tickets aus (`--json`: `{arm, typ}`)
 *
 * Exit 0 bei Erfolg, 1 ohne nutzbare Projekt-Config (fail-closed), 2 bei einem Aufruf-Fehler (Nummer keine Ganzzahl > 0).
 * `armeZuordnen` ist die Prüfseite der Messung: ein Ticket mit Läufen in beiden Typen oder in keinem ist ungültig.
 * Pure Funktionen; nur das CLI liest die Config und den Sync-Stand.
 */
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";

/** Agentenname der Arm-B-Lens (`.claude/agents/lens-kern-je-rolle.md`): bewusst neutral, dieses Skript gehört zum Kern. */
export const LENS_B = "lens-kern-je-rolle";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const AUFRUF = "Aufruf: node scripts/lens-arm.mjs <nr> [--json] (nr: Ganzzahl > 0)";

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

/** Rechnet `argv`; `config` und `bezieher` injizierbar. Liefert `{code, ausgabe}`. */
export function laufe(argv, { config, bezieher = () => istBezieher(WURZEL) } = {}) {
  const r = flagsLesen(argv, { json: { type: "boolean" } }, { positionale: true });
  if (r.fehler) return { code: AUFRUF_EXIT, ausgabe: `${r.fehler.text}\n${AUFRUF}` };
  const [nummer, ...rest] = r.positionale;
  if (rest.length > 0 || !/^[1-9]\d*$/.test(nummer ?? "")) return { code: AUFRUF_EXIT, ausgabe: AUFRUF };
  const { namen, grund } = namenOderGrund("Lens-Arm", config ? { config } : {});
  if (grund) return { code: 1, ausgabe: grund };
  const arm = lensArm(Number(nummer), { namen, bezieher: bezieher() });
  return { code: 0, ausgabe: r.werte.json ? JSON.stringify(arm) : arm.typ };
}

function main(argv = process.argv.slice(2)) {
  const r = laufe(argv);
  (r.code === 0 ? console.log : console.error)(r.ausgabe);
  process.exit(r.code);
}

if (istDirektaufruf(import.meta.url)) main();
