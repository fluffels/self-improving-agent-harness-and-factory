/* Wächter gegen Textreste entfernter Pfade (#1067, ADR 0028) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Der Ticket-Workflow und sein Einstiegs-Skill sind entfernt; dass die Dateien fehlen, prüft der
 * Absenz-Test in model-routing.test.ts. Beim Entfernen blieben aber Sätze in Doku, Kommentaren und Wächtern stehen, die
 * den Pfad als vorhanden beschrieben: drei Review-Pässe fanden nacheinander je einen neuen Rest, weil jeder nur nach
 * seinem eigenen Muster suchte. Dieser Test scannt alle getrackten Dateien auf die Namen und Umschreibungen des
 * entfernten Pfads. Ausnahmen sind begründet (AUSNAHMEN): ADRs sind historisch und werden nie umgeschrieben, der
 * Absenz-Test nennt die Namen absichtlich, dieser Wächter trägt die Muster selbst. Datierte Messungen und Entscheidungen
 * in lebenden Seiten stehen zwischen den Markern `<!-- schnappschuss:start -->` und `<!-- schnappschuss:ende -->` (je allein
 * auf der Zeile); der Scan überspringt den Block, ein Start ohne Ende, ein Ende ohne Start oder ein verschachtelter Start ist ein Fund.
 *
 * Bewusste Grenze: freie Umschreibungen ohne einen der Namen („orchestrierter Workflow, der dieselben Phasen fährt“)
 * fängt der Scan nicht; das Wort „Workflow“ allein wäre zu breit (GitHub-Actions-Workflows, generische Mechanik).
 *
 * Dazu (factory#399): der Phasen-Schnitt ist zurückgebaut (Befehl `uebergeben`, Token `uebergabe`, `SCHNITT:`/`UEBERGABE:`, Prompt-Zeilen `Schnitt:`/`Einstieg:`); `RESTE_SCHNITT` scannt
 * die Namen. Bewusste Grenze: der Name „Phasen-Schnitt“ und freie Umschreibungen werden nicht gescannt, er bleibt in Messberichten erlaubt (die Messskripte `kontext-treiber`/`subagent-laeufe` stehen in `AUSNAHMEN_SCHNITT`).
 *
 * Dazu (factory#236): die A/B-Messung Kern je Rolle ist beendet, Arm A bleibt; der Arm-B-Typ, `lens-arm` samt Bibliothek, `LENS_B`, `lensArm`, `lensTypen` und die Wiedervorlage `kern-je-rolle-ab-235` sind eine geschlossene Namensliste (`RESTE`).
 * Bewusste Grenze: freie Umschreibungen („Arm-B-Lens“, „A/B Kern je Rolle“) werden nicht gescannt, „Kern je Rolle“ bleibt als Variantenname erlaubt; der Typname selbst steht nur in ADR 0035.
 *
 * Ein künftiger harmloser Gebrauch eines dieser Wörter braucht einen Eintrag in `REGEL_AUSNAHMEN`.
 *
 * Dazu (#1748): die Agenten-Dateien heißen nach der Rolle (`factory-planer.md` usw.), das Ticket-Skill-Verzeichnis `factory-ticket/`; die alten
 * Namen mit Projektwort und ein Platzhalter als Dateiname (`<agenten.…>.md`) sind Rückfälle.
 *
 * Die Muster, die an der Projekthistorie hängen (der alte Skill- und Workflow-Name aus dem Repo-Namen, das alte Ticket-Skill-Verzeichnis), prüft
 * `entfernte-pfade-projekt.test.ts` (Projekt-Test, zieht nicht in das Factory-Repo); Scan und Schnappschuss-Blöcke liegen in `test/support/entfernte-pfade.ts`.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type Datei, type Rest, AUSNAHMEN, findeReste, getrackteTextdateien, meldungMitFix, REGEL_AUSNAHMEN, SCHNAPPSCHUSS_ENDE, SCHNAPPSCHUSS_START } from "../support/entfernte-pfade";
import { FREMD, projektConfig } from "../support/fremd-config";
import { escapeRe as esc } from "../support/regex";

// Die Namen kommen aus der echten Projekt-Config, nicht aus Literalen: der Scan liest die echten Repo-Dateien.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lockRaw from "../../scripts/ticket-lock.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lockLibRaw from "../../scripts/ticket-lock-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abschlussRaw from "../../scripts/umsetzer-abschluss.mjs";

const C = projektConfig();
const ROLLEN_AGENTEN = [C.agenten.planer, C.agenten.umsetzer, C.agenten.lens, C.agenten.gruppe];

/** Namen und Umschreibungen des entfernten Ticket-Workflows und seines Einstiegs-Skills. */
export const RESTE: Rest[] = [
  { name: "Workflow-Auftrag", muster: /Workflow-Auftrag/, fix: "vom Auftrag des Ticket-Skills sprechen, ein Workflow-Auftrag existiert nicht mehr" },
  { name: "Workflow-Variante", muster: /Workflow-Variante/, fix: "die Variante streichen, es gibt nur den Skill-Ablauf" },
  { name: "cleanup-Agent des Workflows", muster: /im Workflow der `?cleanup/, fix: "das Aufräumen dem Skill-Ablauf zuschreiben, nicht einem Workflow" },
  { name: "beruehrtHarness", muster: /beruehrtHarness/, fix: "den Bezeichner entfernen, das Feld gibt es nicht mehr" },
  { name: "urteilFehler (entfernter Export von nachweis-lib)", muster: /urteilFehler/, fix: "den Export aus nachweis-lib nicht mehr nennen, er ist entfernt" },
  { name: "Konstante NACH_MERGE_PRAEFIX", muster: /\bNACH_MERGE_PRAEFIX\b/, fix: "sprache.spezifikation.nachMerge aus der Projekt-Config nutzen, die Konstante ist entfernt" },
  { name: "zeichenOhneBlock (entfernter Export von kontext-budget-lib)", muster: /zeichenOhneBlock/, fix: "ohneProjektwerte aus projektwert-lib nutzen, der Export ist entfernt (L17, factory#405)" },
  { name: "Konstante FACTORY_LABEL", muster: /\bFACTORY_LABEL\b/, fix: "die Konstante aus board-lib nicht mehr nennen, sie ist entfernt" },
  { name: "Ausnahmeliste des Flag-Parser-Wächters", muster: /noch nicht migrierten Skripte stehen dort/, fix: "die Ausnahmeliste gibt es nicht mehr, den Ist-Zustand des Wächters beschreiben" },
  { name: "Docs-Gen-Schlüssel diagramme.ruleset", muster: /diagramme\.ruleset/, fix: "den Schlüssel aus der Docs-Gen-Konfiguration nicht mehr nennen, er ist entfernt" },
  { name: "alte Agenten-Dateinamen", muster: new RegExp(`(?:${ROLLEN_AGENTEN.map(esc).join("|")})\\.md`), fix: "den Rollen-Pfad .claude/agents/factory-<rolle>.md nennen" },
  { name: "Ticket-Ablauf am alten Ort", muster: /\.claude\/skills\/factory\/ablauf\.md/, fix: "den Ticket-Ablauf unter .agents/skills/factory/ablauf.md nennen (Skill-Quelle, #1850)" },
  {
    name: "Platzhalter als Dateiname, die Datei heißt nach der Rolle",
    muster: /<agenten\.[A-Za-z]+>\.md|skills\/<agenten\.ticketSkill>\//,
    fix: "den Rollen-Pfad .claude/agents/factory-<rolle>.md ausschreiben statt eines Platzhalters",
  },
  {
    name: "Härtungs-Takt nach Merge-Zahl",
    muster: /\bHARNESS_TAKT_MERGES\b|\bharnessTaktAusCommits\b|\bmergesSeitAbschluss\b|(?:nach 5|fünf) Ticket-Merges jeder Art|Ticket-Merges seit dem Abschluss des letzten Sammeltickets hinter den Kopf/,
    fix: "den Härtungs-Takt nach Füllstand beschreiben: HARNESS_TAKT_KOMMENTARE offene Befund-Zeilen in Kommentaren vertrauter Nicht-Bot-Autoren im Harness-Sammelticket (#1888, factory#411)",
  },
  {
    name: "Füllstand in Befund-Kommentaren",
    muster: /Befund-Kommentar/,
    fix: "den Füllstand in offenen Befund-Zeilen beschreiben: `befundKommentare` zählt die `- [ ]`-Zeilen vertrauter Nicht-Bot-Autoren (Fortschreibung factory#411 zu ADR 0016)",
  },
  {
    name: "Klemmung und Selbstkorrektur des Sammeltickets",
    muster: /\bklemmeAnker\b|\bplanMitKorrektur\b|\bpositionOderWarnung\b|\bsammelblock\b|"auf-position"|Nie vor das ungeclaimte Sammelticket/,
    fix: "das Harness-Sammelticket holt der Board-Takt ab dem Füllstand an die Spitze (hinter 🚨/🔒), board-place klemmt und korrigiert nicht (Fortschreibung #162 zu ADR 0016)",
  },
  // Der Altnamen-Rückfall der Kern-Umgebungsvariablen ist entfernt (#1872): gelesen wird nur FACTORY_<NAME>.
  {
    name: "Altnamen-Rückfall",
    muster: /\b(?:altNameZuPraefix|ladeAltPraefix|standardAltPraefix)\b/,
    fix: "Kern-Variablen nur als FACTORY_<NAME> lesen; gesetzte Altnamen meldet harness-doctor --pruefen",
  },
  {
    name: "Baseline der Kern-Test-Literale",
    muster: /kern-test-literale-baseline/,
    fix: "für Kern-Tests gilt die Null-Regel ohne Baseline: Projektwerte aus FREMD bzw. projektConfig() nehmen, Projektinhalt in einen projekt-test",
  },
  {
    name: "alter Titel des Tag-Tickets",
    muster: /Tag [^\n`"]{0,12}setzen und syncen/,
    fix: "den Titel „🏷️ Tag v<x> setzen“ nennen (factory#220); das Tag-Ticket heißt nicht mehr „setzen und syncen“",
  },
  {
    name: "Baseline der Kern-Links",
    muster: /kern-links-baseline/,
    fix: "Kern-Links werden ohne Baseline durch Factory-Seiten mit Anker gedeckt (kern-links.test.ts, check:factorylinks): ADRs nur als Text, Ziel mit Anker anlegen (factory#132)",
  },
  {
    name: "Spielquote-Bibliothek (heißt produktquote-lib)",
    muster: /spielquote-lib|\bSPIEL_QUOTE\b|\bzaehleSpielMerges\b/,
    fix: "den Kern-Begriff Produktquote nutzen: scripts/produktquote-lib.mjs, PRODUKT_QUOTE, zaehleProduktMerges (#1942)",
  },
  {
    name: "A/B Kern je Rolle: Arm-B-Typ und Arm-Wahl (beendet)",
    muster: /lens-kern-je-rolle|lens-arm\.mjs|lens-arm-lib|\bLENS_B\b|\blensArm\b|\blensTypen\b|kern-je-rolle-ab-235/,
    fix: "die A/B-Messung ist beendet und Arm A bleibt (factory#236, ADR 0035): den Arm-B-Typ, lens-arm und die Wiedervorlage nicht mehr nennen; der Spawn-Typ ist agenten.lens",
  },
  {
    name: "Wächter agents-refs (aufgegangen im Kern-Verweis-Wächter)",
    muster: /agents-refs/,
    fix: "Kern-Verweise auf AGENTS.md prüft test/harness/besitz-abschnittsverweise.test.ts (factory#245), den Wächter nicht mehr nennen",
  },
];

const reste = (dateien: Datei[]): string[] => findeReste(dateien, RESTE);
const meldungKern = (treffer: string[]): string => meldungMitFix(treffer, RESTE);

/** Entfernte Dateien, die nie wieder angelegt werden dürfen (exakter Pfad, je Eintrag der Grund). */
export const ENTFERNTE_DATEIEN: { pfad: string; grund: string }[] = [
  { pfad: "test/harness/kern-test-literale-baseline.json", grund: "Null-Regel der Kern-Tests (#1903)" },
  { pfad: "test/harness/umsetzer-bedingte-dateien.test.ts", grund: "aufgegangen in test/harness/bedingte-dateien.test.ts (factory#405)" },
  { pfad: "test/harness/kern-links-baseline.json", grund: "Kern-Links: Deckung per Anker-Stub statt Baseline (factory#132)" },
  { pfad: ".claude/agents/lens-kern-je-rolle.md", grund: "A/B Kern je Rolle beendet (factory#236, ADR 0035)" },
  { pfad: "scripts/lens-arm.mjs", grund: "A/B Kern je Rolle beendet (factory#236, ADR 0035)" },
  { pfad: "scripts/lens-arm-lib.mjs", grund: "A/B Kern je Rolle beendet (factory#236, ADR 0035)" },
  { pfad: "test/harness/lens-arm.test.ts", grund: "A/B Kern je Rolle beendet (factory#236, ADR 0035)" },
];

/** Meldungen für wieder angelegte entfernte Dateien; leer = sauber. */
export function entfernteDateien(pfade: string[]): string[] {
  return ENTFERNTE_DATEIEN.filter((e) => pfade.includes(e.pfad)).map((e) => `${e.pfad}: entfernte Datei wieder angelegt (${e.grund})`);
}

describe("Keine Textreste des entfernten Ticket-Workflows (#1067, ADR 0028)", () => {
  test("das Repo ist frei von Resten außerhalb der begründeten Ausnahmen", () => {
    const dateien = getrackteTextdateien();
    assert.ok(dateien.length > 200, "Dateiliste unerwartet klein: git ls-files fehlgeschlagen?");
    const treffer = reste(dateien);
    assert.deepEqual(treffer, [], `${meldungKern(treffer)}\nTreffer: ${treffer.join(", ")}`);
  });

  describe("entfernte Dateien (#1903)", () => {
    test("im echten Repo ist keine entfernte Datei wieder angelegt", () => {
      assert.deepEqual(entfernteDateien(getrackteTextdateien().map((d) => d.pfad)), []);
    });
    test("Negativfall: eine wieder angelegte Baseline-Datei ist genau eine Meldung mit Pfad und Grund", () => {
      const meldungen = entfernteDateien(["README.md", ENTFERNTE_DATEIEN[0].pfad]);
      assert.equal(meldungen.length, 1);
      assert.ok(meldungen[0].startsWith(ENTFERNTE_DATEIEN[0].pfad) && meldungen[0].includes("Null-Regel"));
    });
    test("ein Nachbarpfad mit ähnlichem Namen löst nicht aus", () => {
      assert.deepEqual(entfernteDateien(["test/harness/kern-test-literale.json"]), []);
    });
  });

  test("jede Regel nennt einen konkreten Fix-Hinweis", () => {
    for (const r of RESTE) assert.ok(r.fix.length > 10, `Regel ${r.name} ohne Fix-Hinweis`);
  });

  test("die Meldung nennt den Fix der getroffenen Regel und nur den", () => {
    const treffer = reste([{ pfad: "docs/x.md", inhalt: "import { altNameZuPraefix } from lib" }]);
    const meldung = meldungKern(treffer);
    const regel = RESTE.find((r) => r.name === "Altnamen-Rückfall");
    assert.ok(regel && meldung.includes(regel.fix));
    assert.ok(!meldung.includes(RESTE[0].fix));
  });

  test("Ticket-Ablauf am alten Ort: der alte Pfad ist ein Fund, der neue Pfad und eine ADR nicht", () => {
    const alt = ".claude/skills/factory/ablauf.md";
    assert.deepEqual(reste([{ pfad: "docs/x.md", inhalt: `Lies ${alt}` }]), ["docs/x.md:1: Ticket-Ablauf am alten Ort"]);
    assert.deepEqual(reste([{ pfad: "docs/x.md", inhalt: "Lies .agents/skills/factory/ablauf.md und ../.agents/skills/factory/ablauf.md" }]), []);
    assert.deepEqual(reste([{ pfad: "docs/adr/0022-x.md", inhalt: alt }]), []);
  });

  test.each(["scripts/spielquote-lib.mjs", "SPIEL_QUOTE", "zaehleSpielMerges"])("Negativfall: der entfernte Name %s wird gefunden, der neue nicht", (name) => {
    assert.deepEqual(reste([{ pfad: "docs/c.md", inhalt: name }]), ["docs/c.md:1: Spielquote-Bibliothek (heißt produktquote-lib)"]);
    assert.deepEqual(reste([{ pfad: "docs/c.md", inhalt: "scripts/produktquote-lib.mjs PRODUKT_QUOTE zaehleProduktMerges" }]), []);
  });

  test.each(["lens-kern-je-rolle", "scripts/lens-arm.mjs", "lens-arm-lib", "LENS_B", "lensArm(nr)", "lensTypen(namen)", "kern-je-rolle-ab-235"])(
    "Negativfall: der Name %s der beendeten A/B-Messung wird gefunden, der Lens-Typ der Config nicht (factory#236)",
    (name) => {
      assert.deepEqual(reste([{ pfad: "docs/ab.md", inhalt: name }]), ["docs/ab.md:1: A/B Kern je Rolle: Arm-B-Typ und Arm-Wahl (beendet)"]);
      assert.deepEqual(reste([{ pfad: "docs/ab.md", inhalt: `subagent_type: "${C.agenten.lens}", Kern je Rolle` }]), []);
      assert.deepEqual(reste([{ pfad: "docs/ab.md", inhalt: "LENS_BUDGET lensArmee lensTypenListe" }]), [], "Wortgrenzen: ein Name, der ein Wort nur enthält, ist kein Fund");
      assert.deepEqual(reste([{ pfad: "docs/ab.md", inhalt: "ALT_LENS_B getlensArm altlensTypen" }]), [], "Wortgrenzen: ein Wortzeichen davor ist kein Fund");
    },
  );

  // Je Alternative der Muster ein Literal: sonst bliebe ein gestrichener Name unbemerkt
  test.each(["altNameZuPraefix", "ladeAltPraefix", "standardAltPraefix"])("Negativfall: der Name %s wird gefunden", (name) => {
    assert.deepEqual(reste([{ pfad: "docs/b.md", inhalt: `export ${name}()` }]), ["docs/b.md:1: Altnamen-Rückfall"]);
  });

  describe("Schnappschuss-Block", () => {
    const rest = "der Workflow-Auftrag gleicht ab";
    const datum = "Stand 2026-10-01";
    const start = SCHNAPPSCHUSS_START;
    const ende = SCHNAPPSCHUSS_ENDE;
    const pruefe = (inhalt: string) => reste([{ pfad: "docs/s.md", inhalt }]);

    test("ein Rest im datierten Block ist kein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}\n${ende}`), []);
    });
    test("ein Rest nach dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}\n${ende}\n${rest}`), [`docs/s.md:5: Workflow-Auftrag`]);
    });
    test("ein Rest vor dem Block ist ein Fund", () => {
      assert.deepEqual(pruefe(`${rest}\n${start}\n${datum}\n${ende}`), [`docs/s.md:1: Workflow-Auftrag`]);
    });
    test("ein Start ohne Ende ist ein Fund (fail-closed)", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${rest}`), ["docs/s.md:1: Schnappschuss-Block ohne Ende"]);
    });
    test("ein verschachtelter Start ist ein Fund", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${start}\n${ende}`), ["docs/s.md:3: Schnappschuss-Block verschachtelt"]);
    });
    test("Marker nur allein auf der Zeile (getrimmt) zählen", () => {
      assert.deepEqual(pruefe(`  ${start}  \n${datum}\n${rest}\n${ende}`), []);
      assert.equal(pruefe(`Text ${start}\n${rest}`).length, 1);
    });
    test("ein Block ohne ISO-Datum ist ein Fund (Schnappschuss ist datiert)", () => {
      assert.deepEqual(pruefe(`${start}\n${rest}\n${ende}`), ["docs/s.md:1: Schnappschuss-Block ohne Datum"]);
    });
    test("ein Ende-Marker ohne Start ist ein eigener Fund, kein Datum-Fund (nur ein offener Block braucht ein Datum)", () => {
      assert.deepEqual(pruefe(`${ende}\n${datum}`), ["docs/s.md:1: Schnappschuss-Ende ohne Start"]);
      assert.deepEqual(pruefe(`${start}\n${datum}\n${ende}\n${ende}`), ["docs/s.md:4: Schnappschuss-Ende ohne Start"]);
    });
    test("ein leerer Block ist ein Fund, ein Datum außerhalb des Blocks zählt nicht", () => {
      assert.deepEqual(pruefe(`${start}\n${ende}`), ["docs/s.md:1: Schnappschuss-Block ohne Datum"]);
      assert.deepEqual(pruefe(`2026-10-01\n${start}\n${rest}\n${ende}\n2026-10-02`), ["docs/s.md:2: Schnappschuss-Block ohne Datum"]);
    });
    test("die Funde stehen nach Zeile sortiert, auch wenn Marker-Funde vor den Rest-Funden gesammelt werden", () => {
      assert.deepEqual(pruefe(`${rest}\n${start}\n${rest}\n${ende}`), ["docs/s.md:1: Workflow-Auftrag", "docs/s.md:2: Schnappschuss-Block ohne Datum"]);
      assert.deepEqual(pruefe(`${rest}\n${datum}\n${ende}`), ["docs/s.md:1: Workflow-Auftrag", "docs/s.md:3: Schnappschuss-Ende ohne Start"]);
    });
    test("ein unvollständiges Datum zählt nicht", () => {
      assert.deepEqual(pruefe(`${start}\n2026-10\n${rest}\n${ende}`), ["docs/s.md:1: Schnappschuss-Block ohne Datum"]);
    });
    test("mehrere Blöcke werden einzeln geprüft", () => {
      assert.deepEqual(pruefe(`${start}\n${datum}\n${ende}\n${start}\n${rest}\n${ende}`), ["docs/s.md:4: Schnappschuss-Block ohne Datum"]);
    });
    test("die Meldung erklärt Marker-Fehler", () => {
      assert.ok(meldungKern(pruefe(`${start}\n${rest}`)).includes("Schnappschuss-Block"));
      assert.ok(meldungKern(pruefe(`${start}\n${rest}\n${ende}`)).includes("Datum"));
    });
  });

  test.each(RESTE.map((r) => [r.name, r] as const))("Negativfall: ein eingeschleuster Rest wird gefunden (%s)", (_name, r) => {
    const beispiele: Record<string, string> = {
      "Workflow-Auftrag": "der Workflow-Auftrag gleicht ab",
      "Workflow-Variante": "Workflow-Variante nur weich gesichert",
      "cleanup-Agent des Workflows": "im Workflow der `cleanup`-Agent trägt ein",
      beruehrtHarness: "Auftrag beruehrtHarness",
      "urteilFehler (entfernter Export von nachweis-lib)": "import { urteilFehler } from nachweis-lib",
      "Konstante NACH_MERGE_PRAEFIX": "import { NACH_MERGE_PRAEFIX } from spezifikation-lib",
      "zeichenOhneBlock (entfernter Export von kontext-budget-lib)": "import { zeichenOhneBlock } from kontext-budget-lib",
      "Konstante FACTORY_LABEL": "import { FACTORY_LABEL } from board-lib",
      "Ausnahmeliste des Flag-Parser-Wächters": "die noch nicht migrierten Skripte stehen dort als Liste",
      "Docs-Gen-Schlüssel diagramme.ruleset": "config.diagramme.ruleset fehlt",
      "alte Agenten-Dateinamen": `Definition in .claude/agents/${C.agenten.lens}.md`,
      "Ticket-Ablauf am alten Ort": "Lies .claude/skills/factory/ablauf.md",
      "Platzhalter als Dateiname, die Datei heißt nach der Rolle": "Lies .claude/agents/<agenten.lens>.md",
      "Altnamen-Rückfall": "const alt = altNameZuPraefix(name, praefix);",
      "Härtungs-Takt nach Merge-Zahl": "export const HARNESS_TAKT_MERGES = 5;",
      "Füllstand in Befund-Kommentaren": "ab 10 Befund-Kommentaren holt der Takt das Sammelticket",
      "Spielquote-Bibliothek (heißt produktquote-lib)": "import { SPIEL_QUOTE } from board-takt",
      "Baseline der Kern-Test-Literale": "gelesen aus test/harness/kern-test-literale-baseline.json",
      "alter Titel des Tag-Tickets": "Kopf-Ticket „🏷️ Tag v1.3.0 setzen und syncen“",
      "Baseline der Kern-Links": "gelesen aus test/harness/kern-links-baseline.json",
      "Wächter agents-refs (aufgegangen im Kern-Verweis-Wächter)": "siehe test/harness/agents-refs.test.ts",
      "Klemmung und Selbstkorrektur des Sammeltickets": "planMitKorrektur(items, args, n)",
      "A/B Kern je Rolle: Arm-B-Typ und Arm-Wahl (beendet)": "spawnt lens-kern-je-rolle für ungerade Tickets",
    };
    const text = beispiele[r.name];
    assert.ok(text, `Beispiel fehlt für ${r.name}`);
    const treffer = reste([{ pfad: "docs/beispiel.md", inhalt: `vorher\n${text}\nnachher` }]);
    assert.deepEqual(treffer, [`docs/beispiel.md:2: ${r.name}`]);
  });

  // Je Alternative der Muster mit „|“ ein eigenes Beispiel (#1748): sonst bliebe eine gestrichene Alternative unbemerkt
  test.each([
    ["alte Agenten-Dateinamen", `.claude/agents/${C.agenten.planer}.md`],
    ["alte Agenten-Dateinamen", `.claude/agents/${C.agenten.umsetzer}.md`],
    ["alte Agenten-Dateinamen", `.claude/agents/${C.agenten.gruppe}.md`],
    ["Klemmung und Selbstkorrektur des Sammeltickets", "klemmeAnker(items, null)"],
    ["Klemmung und Selbstkorrektur des Sammeltickets", "positionOderWarnung()"],
    ["Klemmung und Selbstkorrektur des Sammeltickets", "const k = sammelblock(items)"],
    ["Klemmung und Selbstkorrektur des Sammeltickets", 'aktion: "auf-position"'],
    ["Klemmung und Selbstkorrektur des Sammeltickets", "Nie vor das ungeclaimte Sammelticket: --top klemmt"],
    ["Härtungs-Takt nach Merge-Zahl", "harnessTaktAusCommits({ items })"],
    ["Härtungs-Takt nach Merge-Zahl", "entscheideHarnessTakt({ mergesSeitAbschluss: 5 })"],
    ["Härtungs-Takt nach Merge-Zahl", "holt es nach 5 Ticket-Merges jeder Art"],
    ["Härtungs-Takt nach Merge-Zahl", "nach fünf Ticket-Merges jeder Art"],
    ["Härtungs-Takt nach Merge-Zahl", "nach 10 Ticket-Merges seit dem Abschluss des letzten Sammeltickets hinter den Kopf"],
    ["Platzhalter als Dateiname, die Datei heißt nach der Rolle", ".claude/skills/<agenten.ticketSkill>/SKILL.md"],
  ])("Negativfall: jede Alternative wird gefunden (%s: %s)", (name, text) => {
    assert.deepEqual(reste([{ pfad: "docs/b.md", inhalt: text }]), [`docs/b.md:1: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn des Altnamen-Musters lösen nicht aus (altEnvName, Wortgrenze)", () => {
    assert.deepEqual(reste([{ pfad: "docs/x.md", inhalt: "altEnvName und altEnvPraefix, xaltNameZuPraefixy" }]), []);
  });

  test("Ausnahmen: ADRs und der Absenz-Test dürfen die Namen tragen, andere Pfade nicht", () => {
    const text = "der Workflow-Auftrag gleicht ab";
    assert.deepEqual(reste([{ pfad: "docs/adr/0028-ein-ticket-ablauf.md", inhalt: text }]), []);
    assert.deepEqual(reste([{ pfad: "test/harness/model-routing.test.ts", inhalt: text }]), []);
    assert.ok(reste([{ pfad: "docs/modul.md", inhalt: text }]).length > 0);
  });

  test("jede Ausnahme nennt einen Grund", () => {
    for (const a of REGEL_AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.pfad} ohne Grund`);
    for (const a of AUSNAHMEN) assert.ok(a.grund.length > 10, `Ausnahme ${a.praefix} ohne Grund`);
  });
});

// ---- Phasen-Schnitt zurückgebaut (factory#399) ----

/** Namen des zurückgebauten Phasen-Schnitts; die Liste ist geschlossen (je Regel ein Beispiel im Negativfall-Test). */
export const RESTE_SCHNITT: Rest[] = [
  { name: "Befehl uebergeben", muster: /\buebergeben\b/, fix: "den Befehl gibt es nicht mehr: ticket-lock kennt claim, pruefe, uebernehmen, gestoppt, freigeben, wiederherstellen, lebenszeichen, erzwingen" },
  { name: "Token und Lock-Feld uebergabe", muster: /\buebergabe\b/, fix: "das Ergebnis-Token und das Lock-Feld sind entfernt: gültig sind gemergt, entscheidung-noetig, festgefahren, abgebrochen, abnahme" },
  { name: "Berichtszeile SCHNITT:", muster: /\bSCHNITT:/, fix: "die Berichtszeile SCHNITT: ist entfernt, der Umsetzer arbeitet immer bis zum Merge" },
  { name: "Berichtszeile UEBERGABE:", muster: /\bUEBERGABE:/, fix: "die Berichtszeile UEBERGABE: ist entfernt" },
  { name: "Prompt-Zeile Schnitt: oder Einstieg:", muster: /\b(?:Schnitt|Einstieg): (?:pr|verify)(?![\wäöüß])|`(?:Schnitt|Einstieg):/, fix: "die Prompt-Zeilen Schnitt:/Einstieg: gibt es nicht mehr; eine Fortsetzung beginnt mit Schritt 1 des Umsetzer-Ablaufs" },
  { name: "Bezeichner des Schnitts", muster: /\b(?:uebergabeBlockade|uebergabeOffen|uebergabeStand|frischeUebergabe|SCHNITTE)\b/, fix: "den Bezeichner entfernen, es gibt ihn nicht mehr" },
  { name: "Einstieg nach Übergabe", muster: /Einstieg nach Übergabe/, fix: "den Abschnitt gibt es nicht mehr" },
];

/** Die Messskripte werten Alt-Transkripte des beendeten Schnitts aus (Entscheidung factory#272) und dürfen die Namen tragen. */
export const AUSNAHMEN_SCHNITT = [
  ...AUSNAHMEN,
  { praefix: "scripts/kontext-treiber.mjs", grund: "misst Alt-Transkripte des beendeten Schnitts (--je-ticket)" },
  { praefix: "test/kontext-treiber.test.ts", grund: "Tests der Messung von Alt-Transkripten des beendeten Schnitts" },
  { praefix: "scripts/subagent-laeufe.mjs", grund: "misst Alt-Transkripte des beendeten Schnitts (schnittZeile)" },
  { praefix: "test/subagent-laeufe.test.ts", grund: "Tests der Messung von Alt-Transkripten des beendeten Schnitts" },
];

describe("Keine Reste des Phasen-Schnitts (factory#399)", () => {
  const schnitt = (inhalt: string, pfad = "docs/x.md") => findeReste([{ pfad, inhalt }], RESTE_SCHNITT, AUSNAHMEN_SCHNITT);

  test("das Repo ist frei von Resten außerhalb der begründeten Ausnahmen", () => {
    const treffer = findeReste(getrackteTextdateien(), RESTE_SCHNITT, AUSNAHMEN_SCHNITT);
    assert.deepEqual(treffer, [], `${meldungMitFix(treffer, RESTE_SCHNITT)}\nTreffer: ${treffer.join(", ")}`);
  });

  test.each([
    ["Befehl uebergeben", "ticket-lock uebergeben 1 --nonce x"],
    ["Token und Lock-Feld uebergabe", "ERGEBNIS: uebergabe"],
    ["Token und Lock-Feld uebergabe", 'lock.uebergabe = { gesetzt }'],
    ["Berichtszeile SCHNITT:", "SCHNITT: pr"],
    ["Berichtszeile UEBERGABE:", "UEBERGABE: Worktree"],
    ["Prompt-Zeile Schnitt: oder Einstieg:", "Prompt mit Schnitt: pr"],
    ["Prompt-Zeile Schnitt: oder Einstieg:", "Einstieg: verify"],
    ["Prompt-Zeile Schnitt: oder Einstieg:", "Schnitt: pr, danach Merge"],
    ["Prompt-Zeile Schnitt: oder Einstieg:", "Einstieg: verify (Fortsetzung)"],
    ["Prompt-Zeile Schnitt: oder Einstieg:", "Prompt mit `Schnitt:`"],
    ["Prompt-Zeile Schnitt: oder Einstieg:", "Prompt mit `Einstieg:`"],
    ["Bezeichner des Schnitts", "uebergabeBlockade(x)"],
    ["Bezeichner des Schnitts", "uebergabeOffen"],
    ["Bezeichner des Schnitts", "uebergabeStand"],
    ["Bezeichner des Schnitts", "frischeUebergabe"],
    ["Bezeichner des Schnitts", "SCHNITTE.includes(x)"],
    ["Einstieg nach Übergabe", "## Einstieg nach Übergabe"],
  ])("Negativfall: %s wird gefunden (%s)", (name, text) => {
    assert.deepEqual(schnitt(`a\n${text}\nb`), [`docs/x.md:2: ${name}`]);
  });

  test("Negativfall: harmlose Nachbarn lösen nicht aus", () => {
    const nachbarn = ["uebergabeProbleme", "uebergabeKennzahlen", "ABSCHNITTE", "Übergabe mit Umlaut", "// Einstieg: liest die Datei", "/^Schnitt:/ ohne Backtick", "Einstieg: prüfe den Lock", "Einstieg: prompt", "Schnitt: verifyLauf", "Einstieg: pröbe", "Schnitt: prß", "QuerSchnitt: pr", "die uebergebenen Werte", "zuuebergeben", "Schnitt: präzise", "ABSCHNITT: x", "Zwischenuebergabe", "SCHNITTEN", "ABUEBERGABE: x", "Phasen-Schnitt im Messbericht"];
    assert.deepEqual(schnitt(nachbarn.join("\n")), []);
  });

  test("Ausnahmen: Messskripte, ADRs und dieser Wächter dürfen die Namen tragen, andere Pfade nicht", () => {
    assert.deepEqual(schnitt("ERGEBNIS: uebergabe", "scripts/kontext-treiber.mjs"), []);
    assert.deepEqual(schnitt("ERGEBNIS: uebergabe", "docs/adr/fortschreibungen/0028.md"), []);
    assert.equal(schnitt("ERGEBNIS: uebergabe", "scripts/ticket-lock.mjs").length, 1);
  });

  const ROOT = fileURLToPath(new URL("../../", import.meta.url));
  const lock = lockRaw as unknown as { fuehreAus: (a: string[], d: object) => { code: number; stdout?: string; stderr?: string } };
  test("Negativfall: ticket-lock uebergeben endet mit Exit 2 (unbekannter Befehl), in der Funktion und als CLI", () => {
    const r = lock.fuehreAus(["uebergeben", "1", "--nonce", "x"], {});
    assert.equal(r.code, 2);
    assert.match(JSON.stringify(r), /unbekannter Befehl/);
    const cli = spawnSync(process.execPath, ["scripts/ticket-lock.mjs", "uebergeben", "1", "--nonce", "x"], { cwd: ROOT, encoding: "utf8" });
    assert.equal(cli.status, 2, cli.stderr);
    assert.ok(!/\| uebergeben/.test(cli.stderr), "USAGE nennt uebergeben nicht mehr");
  });

  test("Negativfall: ERGEBNIS: uebergabe ist ein ungültiges Token, auch im Hook", () => {
    const abschluss = abschlussRaw as unknown as {
      ERGEBNIS_WERTE: string[];
      parseErgebnis: (t: string) => { token: string | null };
      abschlussBlockade: (i: object, d: object) => string | null;
    };
    const text = "ERGEBNIS: uebergabe\nPR: -\nBEFUNDE: keine";
    assert.equal(abschluss.parseErgebnis(text).token, null);
    assert.ok(!abschluss.ERGEBNIS_WERTE.includes("uebergabe"));
    const g = abschluss.abschlussBlockade({ hookEvent: "PreToolUse", toolName: "SubagentHandback", agentType: FREMD.agenten.umsetzer, lastMessage: text }, { config: FREMD, prDateien: () => [] });
    assert.match(g ?? "", /kein gültiges ERGEBNIS-Token/);
  });

  test("Altformat: ein Lock mit Feld uebergabe wird gelesen, aber nicht mehr gewertet", () => {
    const lib = lockLibRaw as unknown as { oeffentlicheSicht: (l: object) => Record<string, unknown>; lebenszeichenMs: (l: object) => number | null };
    const alt = { erstellt: "2026-01-01T00:00:00Z", uebergabe: { gesetzt: "2026-06-01T00:00:00Z", verbraucht: null } };
    assert.ok(!("uebergabeStand" in lib.oeffentlicheSicht(alt)));
    assert.equal(lib.lebenszeichenMs(alt), Date.parse("2026-01-01T00:00:00Z"));
  });
});
