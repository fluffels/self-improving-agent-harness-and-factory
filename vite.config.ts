import { configDefaults, defineConfig } from "vitest/config";
import { availableParallelism } from "node:os";
import { readFileSync } from "node:fs";

// Eingefrorene Wächter (factory#611): einzige Quelle ist das Änderungsregister (Verfall-Zeile mit Feld `eingefroren`). Die Datei bleibt erhalten, läuft aber
// nicht mehr in verify. Wächter dieser Liste: test/harness/waechter-einfrieren.test.ts (Sicherheits-Ausnahmen, Durch-Wächter, verteilte und Selbstschutz-Wächter
// dürfen nie darin stehen; exclude muss genau Standardliste plus Register sein).
const eingefroren = (
  JSON.parse(readFileSync(new URL(".github/aenderungsregister.json", import.meta.url), "utf8")) as { zeilen: { art?: string; ziel?: string; eingefroren?: string }[] }
).zeilen.flatMap((z) => (z.art === "verfall" && z.eingefroren !== undefined && typeof z.ziel === "string" ? [z.ziel] : []));

// Nur die Test-Konfiguration: das Factory-Repo hat keinen Build. Die Tests laufen auf Node, die Worker-Zahl ist lokal begrenzt,
// damit parallele Läufe von Lenses und anderen Worktrees die Git-lastigen Tests nicht ins Zeitlimit treiben.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    exclude: [...configDefaults.exclude, ...eingefroren],
    // Zugangs-Variablen (LANGFUSE_*, GH_TOKEN, GITHUB_TOKEN) entfernt das Setup aus process.env, damit kein Prozess-Test einen echten Zugang erbt (Wächter: test/harness/test-umgebung.test.ts).
    // Die gh-Attrappe (PATH-Vorrang, Exit 1 mit "gh in Vitest gesperrt (Naht injizieren)") fängt jeden unbemerkten Netzaufruf eines Tests ab (factory#560; Wächter: test/gh-sperre.test.ts, test/harness/test-umgebung.test.ts).
    setupFiles: ["test/support/zugaenge-entfernen.ts", "test/support/gh-sperre-setup.ts"],
    // Coverage misst nur ein Lauf mit --coverage oder FACTORY_COVERAGE=1; lcovonly schreibt coverage/lcov.info, das check-diffcoverage.mjs gegen den Diff auswertet.
    coverage: {
      // factory#270: nur die CI schaltet es am Verify-Schritt ein (FACTORY_COVERAGE=1), damit sie die Suite einmal instrumentiert statt zweimal fährt; lokal bleibt verify uninstrumentiert, `--coverage` und test:coverage gehen weiter.
      enabled: process.env.FACTORY_COVERAGE === "1",
      provider: "v8",
      reporter: ["text", "json-summary", "lcovonly"],
      reportsDirectory: "coverage",
      // Deckungsgleich mit isMeasured (scripts/check-diffcoverage.mjs): ohne include zählt v8 nur im Testprozess geladene Dateien, eine nur als Kindprozess geprüfte Datei fehlte im lcov und machte check:diffcoverage hart rot (isMeasured in scripts/check-basis.mjs, Test in test/diffcoverage.test.ts) und mit der Standard-Endungsliste (STANDARD_ENDUNGEN in scripts/quellwurzeln-lib.mjs).
      include: ["scripts/**/*.{ts,mts,cts,mjs,cjs,js}"],
      exclude: ["scripts/**/*.d.{ts,mts,cts}"],
      // Aggregat-Floors (Ratchet, nur nach oben): abgerundet aus der ersten Messung mit include im Factory-Repo (Zeilen 89,33 %, Zweige 87,71 %; Fortschreibung 0022-1942-messbasis nennt sie maßgeblich). Kein Floor je Schicht: die Schichten des Factory-Repos sind klein; den Diff misst check:diffcoverage je Schicht.
      thresholds: { lines: 89, branches: 87 },
    },
    maxWorkers: process.env.CI ? undefined : Math.max(2, Math.floor(availableParallelism() / 4)),
  },
});
