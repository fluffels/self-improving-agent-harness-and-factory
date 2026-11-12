// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * CLI zur A/B-Wahl der Lens je Ticket (factory#235; Regel, Typen und Begründung: `lens-arm-lib.mjs`).
 *
 *   node scripts/lens-arm.mjs <nr> [--json]    gibt den Agententyp für den Lens-Spawn dieses Tickets aus (`--json`: `{arm, typ}`)
 *
 * Exit 0 bei Erfolg, 1 ohne nutzbare Projekt-Config (fail-closed), 2 bei einem Aufruf-Fehler (Nummer keine Ganzzahl > 0).
 * Regel, Typen und Prüfseite der Messung stehen in `lens-arm-lib.mjs`; dieses CLI liest nur die Config und den Sync-Stand.
 */
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { lensArm } from "./lens-arm-lib.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const AUFRUF = "Aufruf: node scripts/lens-arm.mjs <nr> [--json] (nr: Ganzzahl > 0)";

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
