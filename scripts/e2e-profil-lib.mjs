// e2e-Gate-Profil (factory#246): `node scripts/e2e-profil.mjs matrix` liest den optionalen Block `e2e` der Projekt-Config und schreibt zwei Zeilen
// für `$GITHUB_OUTPUT`: `aktiv=true|false` und `browser=<kompaktes JSON>`. Ohne Block: `aktiv=false`, `browser=[]`, Exit 0, keine Meldung.
// Lib ohne Direktaufruf-Guard; der Config-Lader wird injiziert (kein Zyklus mit der Config-Lib).
import { AUFRUF_EXIT } from "./flag-lib.mjs";
import { pruefeE2e } from "./projekt-config-bloecke.mjs";

/** Pur: Ausgabezeilen für `$GITHUB_OUTPUT` zur Config. Wirft bei Formfehlern des Profils (Text samt Fix-Zeile). */
export function matrixZeilen(config) {
  const fehler = pruefeE2e(config.e2e, config.befehle);
  if (fehler.length > 0) throw new Error(`e2e-Profil in der Projekt-Config ungültig: ${fehler.join("; ")}`);
  const browser = config.e2e?.browser ?? [];
  return [`aktiv=${config.e2e !== undefined}`, `browser=${JSON.stringify(browser)}`];
}

/** Einstieg: `matrix`; gibt den Exit-Code zurück (2 bei Aufruf- oder Config-Fehler samt Fix-Zeile auf stderr). */
export function cli(argv, { lade, out = console.log, err = console.error }) {
  if (argv.length !== 1 || argv[0] !== "matrix") {
    err("Aufruf: node scripts/e2e-profil.mjs matrix\nFix: genau das Unterkommando matrix angeben.");
    return AUFRUF_EXIT;
  }
  let zeilen;
  try {
    zeilen = matrixZeilen(lade());
  } catch (e) {
    err(`${e.message}\nFix: den Block e2e und befehle.e2e der Projekt-Config korrigieren.`);
    return AUFRUF_EXIT;
  }
  for (const z of zeilen) out(z);
  return 0;
}
