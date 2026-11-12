// Einstieg des e2e-Gate-Profils (factory#246): `node scripts/e2e-profil.mjs matrix >> "$GITHUB_OUTPUT"`.
// Die Logik steht in e2e-profil-lib.mjs (Einstiegsskripte importieren nicht voneinander, Lib ohne Direktaufruf-Guard).
import { cli } from "./e2e-profil-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

process.exitCode = cli(process.argv.slice(2), { lade: () => ladeProjektConfig() });
