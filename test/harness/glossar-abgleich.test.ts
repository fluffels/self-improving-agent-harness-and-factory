/* Glossar-Abgleich im Agentenlauf (#1561 Z5, #1579) – Planer und Requirement-Treue-Lens prüfen neue Begriffe gegen docs/glossar.md (Spiel) und docs/harness-glossar.md (Harness).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Lens-Fassung steht in `review-lenses/brille-requirement-treue.md` (Lens-Struktur: lens-abgleich.test.ts); hier steht nur,
 * dass der Punkt überhaupt vorhanden ist und die Planer-Definition den Pflichtpunkt trägt.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const lies = (rel: string) => readFileSync(new URL(`../../${rel}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/** Höchstlänge einer Tabellenzeile des Harness-Glossars (Zeichen); längere Erklärungen gehören auf die Quell-Seite. */
const MAX_ZEILE = 1200;

describe("Glossar-Abgleich (#1561 Z5)", () => {
  test("der Planer führt den Glossar-Abgleich als Pflichtpunkt des Plans und je Epic-Kind", () => {
    const planer = lies(".claude/agents/factory-planer.md");
    assert.match(planer, /\*\*Glossar-Abgleich \(Pflicht\):\*\*[^\n]*docs\/glossar\.md[^\n]*keine neuen Begriffe/);
    assert.match(planer, /\*\*Glossar-Abgleich \(Pflicht\):\*\*[^\n]*docs\/harness-glossar\.md[^\n]*keine neuen Begriffe/);
    assert.match(planer, /je Kind der Glossar-Abgleich/);
    assert.match(planer, /keine neuen Begriffe“; neue Ein- oder Ausgabe[^\n]*hexagonalen Sicht[^\n]*`docs\/arc42-architektur\.md`/);
  });

  test("Erstbezug ohne Projekt-Glossar (L3): docs/glossar.md ist eine Vorlage im Besitz-Manifest, der Planer nennt den Fall", () => {
    const manifest = JSON.parse(lies(".factory/besitz.json")) as { eintraege: { pfad: string; ring: string; art?: string }[] };
    const eintrag = manifest.eintraege.find((e) => e.pfad === "docs/glossar.md");
    assert.ok(eintrag, "besitz.json hat keinen Eintrag docs/glossar.md");
    assert.equal(eintrag.art, "vorlage");
    assert.equal(eintrag.ring, "kern");
    assert.ok(existsSync(new URL("../../docs/glossar.md", import.meta.url)), "docs/glossar.md fehlt");
    assert.match(lies("docs/glossar.md"), /\| Begriff \| Bedeutung \|/);
    assert.match(lies(".claude/agents/factory-planer.md"), /fehlt `docs\/glossar\.md`[^\n]*legt der Sync die Vorlage an[^\n]*, Ergebnis je Begriff/);
    assert.match(lies("docs/erstbezug.md"), /docs\/glossar\.md[^\n]*Vorlage[^\n]*nie/);
  });

  test("keine Glossar-Tabellenzeile ist länger als die Grenze, Details stehen auf der verlinkten Brain-Seite", () => {
    const zeilen = lies("docs/harness-glossar.md").split("\n").filter((z) => z.startsWith("| "));
    assert.ok(zeilen.length > 20, "Tabellenzeilen gefunden");
    const zuLang = zeilen.filter((z) => z.length > MAX_ZEILE).map((z) => `${z.length}: ${z.slice(0, 40)}`);
    assert.deepEqual(zuLang, [], `Glossar-Zeile über ${MAX_ZEILE} Zeichen: Details auf die verlinkte Brain-Seite verschieben`);
  });

  test("die Requirement-Treue-Lens prüft neue Begriffe gegen das Glossar, in ihrer Brillen-Datei", () => {
    for (const rel of [".agents/skills/review-lenses/brille-requirement-treue.md"]) {
      const text = lies(rel).replace(/`/g, "");
      assert.match(text, /Neue Begriffe in Texten\/Bezeichnern gegen docs\/glossar\.md \(Projekt\) und docs\/harness-glossar\.md \(Harness\): ein Wort der Anti-Corruption-Layer des Projekts im falschen Text oder umgekehrt ist blockierend/, rel);
      assert.match(text, /Neue Ein- oder Ausgabe \(Speicher, Eingabeart, Export, Content-Quelle\) gegen die hexagonale Sicht in docs\/arc42-architektur\.md: fehlt der Adapter dort oder steht er in einer anderen Schicht, ist das blockierend/, rel);
      assert.match(text, /ein neu eingeführter Fachbegriff, der in keinem der beiden Glossare steht und im Diff nicht ergänzt wird \(auch ein Harness-Begriff in einem Harness-Text\), ist blockierend/, rel);
    }
  });
});
