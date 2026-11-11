/** Test-Setup (vite.config.ts › setupFiles): entfernt Zugangs-Variablen aus process.env, bevor ein Test läuft (Wächter: test/harness/test-umgebung.test.ts). */
import { istZugang } from "./zugaenge";

for (const k of Object.keys(process.env)) if (istZugang(k)) delete process.env[k];
