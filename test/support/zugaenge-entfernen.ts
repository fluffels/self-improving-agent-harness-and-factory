/** Test-Setup (vite.config.ts › setupFiles): entfernt Zugangs-Variablen aus process.env und sperrt gh über ein leeres GH_CONFIG_DIR, bevor ein Test läuft (Wächter: test/harness/test-umgebung.test.ts).
 * Grenze: wirkt nur, wenn die Kind-Umgebung aus process.env abgeleitet ist (geerbt oder `env: { ...process.env, … }`); eine von Grund auf gebaute Umgebung (`env: { PATH: … }`) verliert die Sperre. */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { istZugang } from "./zugaenge";

for (const k of Object.keys(process.env)) if (istZugang(k)) delete process.env[k];
process.env.GH_CONFIG_DIR = join(tmpdir(), "factory-gh-gesperrt");
mkdirSync(process.env.GH_CONFIG_DIR, { recursive: true });
