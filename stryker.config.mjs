// Projektanteil des Mutationslaufs (factory#299): Adapter für den Gate-Befehl `mutation` (`befehle.mutation` in .factory/projekt.json).
// Aufruf über `node scripts/mutation-lauf.mjs`: der Kern übergibt die Zeilenbereiche des Diffs als JSON-Datei und den Berichtspfad
// per Umgebungsvariable (Vertrag: docs/adr/fortschreibungen/0022-299-mutation-adapter.md). Die Namen stehen hier als Literale
// (kein Import aus dem Kern, damit die Datei auch in historische Stände kopierbar ist); der Vertragstest in test/gate-befehl.test.ts hält sie gleich.
import { readFileSync } from "node:fs";

const bereichePfad = process.env.FACTORY_MUTATION_BEREICHE;
const berichtPfad = process.env.FACTORY_MUTATION_BERICHT;
if (!bereichePfad || !berichtPfad) {
  throw new Error("FACTORY_MUTATION_BEREICHE und FACTORY_MUTATION_BERICHT fehlen (sonst mutiert das Werkzeug das ganze Projekt).\nFix: über node scripts/mutation-lauf.mjs aufrufen.");
}
const { bereiche } = JSON.parse(readFileSync(bereichePfad, "utf8"));

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  mutate: bereiche.map((b) => `${b.datei}:${b.von}-${b.bis}`),
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  reporters: ["json"],
  jsonReporter: { fileName: berichtPfad },
  tempDirName: ".stryker-tmp",
  cleanTempDir: true,
  logLevel: "warn",
};
