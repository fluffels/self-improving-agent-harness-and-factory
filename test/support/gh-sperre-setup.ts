/** Test-Setup (vite.config.ts › setupFiles): stellt die gh-Attrappe vor PATH (factory#560), damit kein Test unbemerkt das echte gh und damit das Netz erreicht.
 * Reine Teile: gh-sperre.ts (Wächter: test/gh-sperre.test.ts, test/harness/test-umgebung.test.ts). Tests, die das echte gh brauchen, setzen `FACTORY_ORIGINAL_PATH` als PATH. */
import { tmpdir } from "node:os";
import { ghSperrePfad } from "./gh-sperre";

const sperre = ghSperrePfad(process.env, tmpdir());
if (sperre) {
  process.env.FACTORY_ORIGINAL_PATH = sperre.originalPath;
  process.env.PATH = sperre.path;
}
