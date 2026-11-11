/* Projekt-Wächter gegen Textreste des entfernten Mutations-Projektanteils (factory#317, ADR 0022-Fortschreibung zu factory#299).
 *
 * Projekt-Test: steht nicht in .factory/extraktion.json und zieht nicht in Bezieher-Repos. Der Mutationslauf-Kern
 * (`scripts/mutation-lauf.mjs`, Gate-Befehl `mutation`) bleibt opt-in; der Projektanteil (Adapter-Config, Werkzeug-Abhängigkeiten,
 * Aufruf) ist entfernt, weil die Messung „nicht brauchbar (Bedingung 3)“ ergab (`docs/mutation-messung-2026-11.md`).
 * Ausnahmen: `docs/adr/` (historisch, schon in AUSNAHMEN), die Messseite (datierter Befund) und dieser Test (trägt die Muster).
 *
 * Bewusste Grenze: freie Umschreibungen ohne einen der Namen („Mutationswerkzeug des Projekts“) fängt der Scan nicht.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { type Rest, findeReste, getrackteTextdateien, meldungMitFix } from "./support/entfernte-pfade";

const MESSSEITE = "docs/mutation-messung-2026-11.md";
const DIESER_TEST = "test/entfernte-pfade-projekt.test.ts";

const RESTE: Rest[] = [
  { name: "Mutations-Adapter-Config", muster: /stryker\.config\.mjs/, fix: "die Datei ist entfernt (factory#317); den Verweis streichen, der Kern bleibt opt-in über befehle.mutation der Bezieher" },
  { name: "Mutations-Werkzeugpaket", muster: /@stryker-mutator\//, fix: "die Abhängigkeit ist entfernt (factory#317); Bezieher installieren ihr Werkzeug selbst" },
  { name: "Mutations-Werkzeugaufruf", muster: /npx stryker\b/, fix: "den Aufruf nicht mehr als Projektbefehl eintragen; befehle.mutation ist im Projekt nicht gesetzt" },
];

const scan = () => getrackteTextdateien().filter((d) => d.pfad !== MESSSEITE && d.pfad !== DIESER_TEST);

describe("Keine Textreste des entfernten Mutations-Projektanteils (factory#317)", () => {
  test("das Repo ist frei von Resten außerhalb der begründeten Ausnahmen", () => {
    const dateien = scan();
    assert.ok(dateien.length > 200, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    const treffer = findeReste(dateien, RESTE);
    assert.deepEqual(treffer, [], `${meldungMitFix(treffer, RESTE)}\nTreffer: ${treffer.join(", ")}`);
  });

  test.each(RESTE.map((r) => [r.name, r] as const))("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (_n, r) => {
    const probe = r.name === "Mutations-Werkzeugaufruf" ? "npx stryker run" : r.name === "Mutations-Adapter-Config" ? "stryker.config.mjs" : "@stryker-mutator/core";
    assert.equal(findeReste([{ pfad: "docs/x.md", inhalt: probe }], RESTE).length, 1);
  });

  test("jede Regel nennt einen konkreten Fix-Hinweis", () => {
    for (const r of RESTE) assert.ok(r.fix.length > 10, `Regel ${r.name} ohne Fix-Hinweis`);
  });
});
