/* Required-Check-Shadowing-Wächter (quellprojekt#1172) – jeder Required-Check-Kontext hat genau eine Quelle.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (quellprojekt#1165).
 *
 * Das Ruleset `main-schutz` gleicht die Required-Checks nur über den **Namen** ab (kein App-/
 * Workflow-Pinning; auch mit `integration_id` kämen alle Runs von github-actions). Legt ein PR eine
 * neue Workflow-Datei mit einem gleichnamigen Job daneben (z.B. `sleep 120; exit 0`), wertet GitHub
 * bei gleichem Namen + SHA den zuletzt fertigen Run – ein roter echter Check würde grün überschrieben.
 * Die Kontexte stehen im Ruleset (Spiegel: .github/ruleset-main-schutz.json); Gate-Config-Änderungen sind seit ADR 0014 nur noch auditpflichtig.
 *
 * Evaluiert in quellprojekt#1172 und bewusst verworfen: (a) ein Check prüft per API, dass nur ein Run seines
 * Namens existiert – sein Rot würde vom Fake-Run genauso überschrieben; (b) ein Commit-Status mit
 * eigenem Kontext aus dem pull_request_target-Lauf – braucht `statuses: write` (weicht die rein
 * lesenden Permissions auf) und ein Fake-Workflow kann denselben Kontext ebenso grün posten.
 * In-Repo lässt sich die Lücke nicht schließen, nur verteuern: dieser Wächter macht einen
 * gleichnamigen Job **lokal** in `npm run verify` rot, wo kein Run-Timing ihn überschreiben kann.
 * Ein bewusster Angriff muss also einen roten Wächter ignorieren – sichtbar intentional, passend
 * zum Speed-Bump-Charakter der Leitplanken (quellprojekt#723).
 *
 * Die Zähllogik (`beansprucht`, `quellenJeKontext`, `verstoesse`, `istWorkflowDatei`) und der Blockform-Leser stehen in scripts/workflow-blockform.mjs (factory#148):
 * der Harness-Doctor prüft denselben Punkt `Required-Check-Quellen` in jedem Bezieher, ohne `yaml` (der Wochenlauf hat kein `npm ci`). Dieser Test behält den Unit-Anteil und
 * hält den Leser per Differenztest gegen die `yaml`-Bibliothek ehrlich: der Leser liefert exakt die Namen von `yaml` oder „nicht lesbar“, nie weniger.
 *
 * Bewusst über-approximierend (fail-closed, wie der Substring-Abgleich der Leitplanken-Pfade): gezählt wird
 * der `name:` jedes Jobs und jedes Schritts, der mit einem Kontext **beginnt**. Enthält der Name `${{`,
 * zählt er als Treffer, sobald sein wörtliches Präfix davor ein Anfang des Kontexts ist (ein komplett
 * dynamischer Name passt damit auf jeden Kontext). Lieber ein Fehlalarm als ein still durchgerutschter
 * Doppelgänger. Job-Keys ohne `name:` sind kein Weg: Keys erlauben weder Leerzeichen noch Klammern, die
 * Kontexte schon.
 * Ehrliche Grenze: Wirkung nur lokal – in CI läuft dieser Test im Job „Tests, Typecheck & Builds", der per
 * demselben Trick ebenfalls überschreibbar ist.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import { parse } from "yaml";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rulesetSpiegel from "../../scripts/docs-gen/ruleset-spiegel.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as projektConfig from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as blockform from "../../scripts/workflow-blockform.mjs";

interface Workflow {
  pfad: string;
  text: string;
}
interface Lesung {
  namen?: string[];
  fehler?: { zeile: number; konstrukt: string };
}
const { blockformNamen, istWorkflowDatei, quellenJeKontext, verstoesse } = blockform as unknown as {
  blockformNamen: (text: string) => Lesung;
  istWorkflowDatei: (datei: string) => boolean;
  quellenJeKontext: (workflows: Workflow[], kontexte: readonly string[]) => { treffer: Map<string, string[]>; nichtLesbar: { pfad: string; zeile: number; konstrukt: string }[] };
  verstoesse: (workflows: Workflow[], kontexte: readonly string[]) => string[];
};

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

/** Die Required-Check-Kontexte **genau so, wie das Ruleset `main-schutz` sie führt**, gelesen aus dem geschützten Spiegel,
 *  dessen Pfad der Schlüssel `rulesetSpiegel` der Projekt-Config nennt (Z1): dieselbe Quelle speist das Leitplanken-Diagramm (docs/diagramme). Die Wahrheit ist das
 *  out-of-repo-Ruleset (`gh api repos/{owner}/{repo}/rulesets/<id>`, ID: Feld `id` im Spiegel); ändert sich dort ein Kontext, zieht der PR den Spiegel nach. */
const spiegelPfad = (projektConfig as unknown as { ladeProjektConfig: () => { rulesetSpiegel?: string } }).ladeProjektConfig().rulesetSpiegel;
if (!spiegelPfad) throw new Error("rulesetSpiegel fehlt in der Projekt-Config (.factory/projekt.json)");
const RULESET_SPIEGEL = join(ROOT, spiegelPfad);
// Dieselbe Eingangsprüfung wie der Generator `leitplanken-schichten` (quellprojekt#1411): ein Modul statt zweier Kopien.
const pruefeRulesetSpiegel = (rulesetSpiegel as unknown as { pruefeRulesetSpiegel: (roh: unknown, pfad: string) => { requiredChecks: string[] } }).pruefeRulesetSpiegel;
function leseKontexte(json: string): string[] {
  return pruefeRulesetSpiegel(JSON.parse(json), "Spiegel").requiredChecks;
}
const REQUIRED_CONTEXTS: readonly string[] = leseKontexte(readFileSync(RULESET_SPIEGEL, "utf8"));

/** Die Referenz: liest die `name:`-Werte aller Jobs und Schritte mit der YAML-Bibliothek (Schema `failsafe`: jeder Skalar bleibt ein Text, `name: 1.0` bleibt `1.0`;
 *  der Workflow-Name auf oberster Ebene zählt nicht; ein Parse-Fehler wirft). */
function yamlNamen(workflow: string): string[] {
  const doc = parse(workflow, { schema: "failsafe" }) as { jobs?: unknown } | null;
  const jobs = doc?.jobs;
  if (jobs === null || typeof jobs !== "object") return [];
  const werte: string[] = [];
  const nimm = (w: unknown) => {
    if (typeof w === "string" && w.trim() !== "") werte.push(w.trim());
  };
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (job === null || typeof job !== "object") continue;
    const j = job as { name?: unknown; steps?: unknown };
    nimm(j.name);
    if (Array.isArray(j.steps)) {
      for (const schritt of j.steps) {
        if (schritt !== null && typeof schritt === "object") nimm((schritt as { name?: unknown }).name);
      }
    }
  }
  return werte;
}

function echteWorkflows(): Workflow[] {
  return readdirSync(WORKFLOW_DIR)
    .filter(istWorkflowDatei)
    .map((f) => ({ pfad: f, text: readFileSync(join(WORKFLOW_DIR, f), "utf8") }));
}

const wf = (...eintraege: [string, string][]): Workflow[] => eintraege.map(([pfad, text]) => ({ pfad, text }));

const MIT_RAUTE = `jobs:
  beispiel:
    name: Beispiel-Check (Zusatz, #903)
    runs-on: ubuntu-latest
`;

/** Lesbare Formen mit der erwarteten Namensliste; der Differenztest gleicht jede gegen `yaml` ab. */
const LESBAR: Record<string, [string, string[]]> = {
  "plain wird an ' #' abgeschnitten": [MIT_RAUTE, ["Beispiel-Check (Zusatz,"]],
  "doppelt gequotet bleibt vollständig, auch mit ' #'": [`jobs:\n  a:\n    name: "A (X, #903)"\n`, ["A (X, #903)"]],
  "einfach gequotet": [`jobs:\n  a:\n    name: 'B'\n`, ["B"]],
  "einfach gequotet mit ''": [`jobs:\n  a:\n    name: 'It''s'\n`, ["It's"]],
  "Step-Namen mit Listen-Präfix und tiefer Einrückung": [`jobs:\n    a:\n        steps:\n          - name: Schritt\n`, ["Schritt"]],
  "Kommentare, Workflow-Name und leere Werte zählen nicht": [`name: Workflow\n# name: A\njobs:\n  a:\n    # name: B\n    name:\n`, []],
  "Block-Skalar |": [`jobs:\n  a:\n    name: |\n      Block-Name\n`, ["Block-Name"]],
  "Block-Skalar >- gefaltet": [`jobs:\n  a:\n    name: >-\n      Erste\n      Zweite\n`, ["Erste Zweite"]],
  "Block-Skalar > mit Leerzeile": [`jobs:\n  a:\n    name: >\n      Erste\n\n      Zweite\n`, ["Erste\nZweite"]],
  "Block-Skalar |+ und Einrückungs-Indikator": [`jobs:\n  a:\n    name: |+2\n        eingerückt\n    steps:\n      - name: S\n`, ["eingerückt", "S"]],
  "Block-Skalar mit Kommentar im Kopf": [`jobs:\n  a:\n    name: | # Kopf\n      Text\n`, ["Text"]],
  "YAML-Escapes im gequoteten Namen": [`jobs:\n  a:\n    name: "Tests,\\x20Typecheck\\u0021\\t\\/"\n`, ["Tests, Typecheck!\t/"]],
  "mehrere Jobs, CRLF": [`jobs:\r\n  a:\r\n    name: Eins\r\n  b:\r\n    name: Zwei\r\n`, ["Eins", "Zwei"]],
  "BOM und Dokumentstart": [`\uFEFF---\njobs:\n  a:\n    name: Mit BOM\n`, ["Mit BOM"]],
  "erst name, dann Step-Namen, auch wenn steps zuerst steht": [`jobs:\n  a:\n    steps:\n      - name: Schritt\n    name: Job\n`, ["Job", "Schritt"]],
  "kompakte Steps auf Höhe von steps": [`jobs:\n  a:\n    steps:\n    - name: A\n      run: x\n    - name: B\n`, ["A", "B"]],
  "Strich allein und Strich mit mehreren Leerzeichen": [`jobs:\n  a:\n    steps:\n      -\n        name: A\n      -   name: B\n          run: x\n`, ["A", "B"]],
  "gequoteter Schlüssel": [`jobs:\n  "a":\n    "name": X\n    'steps':\n      - "name": Y\n`, ["X", "Y"]],
  "Wert erst in der Folgezeile": [`jobs:\n  a:\n    name:\n      Später\n`, ["Später"]],
  "mehrzeiliger plain-Skalar": [`jobs:\n  a:\n    name: Erste\n      Zweite\n\n      Dritte\n    runs-on: x\n`, ["Erste Zweite\nDritte"]],
  "mehrzeilig doppelt gequotet": [`jobs:\n  a:\n    name: "Erste  \n      Zweite\\\n      Dritte"\n`, ["Erste Zweite" + "Dritte"]],
  "mehrzeilig einfach gequotet": [`jobs:\n  a:\n    name: 'Erste\n\n      Zweite'\n`, ["Erste\nZweite"]],
  "Name mit Kommentar dahinter": [`jobs:\n  a:\n    name: "Q" # Kommentar\n`, ["Q"]],
  "nicht gelesene Werte dürfen Flow, Anker und Block-Skalare sein": [
    `on:\n  workflow_dispatch: {}\n  push:\n    branches: [main]\nenv: &e\n  X: 1\njobs:\n  a:\n    name: A\n    needs: [b, c]\n    env: *e\n    steps:\n      - run: |\n          echo "name: Fremd"\n          name: Noch fremder\n      - uses: x/y@v1\n        with:\n          name: Nein\n`,
    ["A"],
  ],
  "Liste auf Schlüsselhöhe bei nicht gelesenem Schlüssel": [`jobs:\n  a:\n    name: A\n    needs:\n    - b\n    - c\n    steps:\n      - name: S\n`, ["A", "S"]],
  "keine jobs und leere Eingabe": [`on: push\n`, []],
  "typisierte Skalare bleiben Text (failsafe)": [`jobs:\n  a:\n    name: 1.0\n    steps:\n      - name: true\n`, ["1.0", "true"]],
  "Datei ohne abschließenden Zeilenumbruch": [`jobs:\n  a:\n    name: X`, ["X"]],
  "Job-Name hinter kompakten Steps auf Höhe von steps": [`jobs:\n  a:\n    steps:\n    - name: A\n    name: Audit\n`, ["Audit", "A"]],
  "leerer Job vor dem nächsten Job": [`jobs:\n  a:\n  b:\n    name: X\n`, ["X"]],
  "leeres jobs": [`jobs:\non: push\n`, []],
  "Kommentare hinter jobs: und steps:": [`jobs: # c\n  a:\n    steps: # c\n      - name: S\n`, ["S"]],
  "Kommentar hinter dem Dokumentstart": [`--- # c\njobs:\n  a:\n    name: A\n`, ["A"]],
  "leeres name vor einem Geschwister-Schlüssel": [`jobs:\n  a:\n    name:\n    runs-on: x\n`, []],
  "leerer Strich vor dem nächsten Step": [`jobs:\n  a:\n    steps:\n      -\n      - name: S\n`, ["S"]],
};

/** Nur für den Differenztest: Eingaben, bei denen der Leser exakt `yaml` trifft oder „nicht lesbar“ meldet (nie abstürzen, nie abweichen). */
const NUR_DIFFERENZ: Record<string, string> = {
  "Text nach gequotetem Wert": 'jobs:\n  a:\n    name: "A" B\n',
  "gequotete Folgezeile flacher eingerückt": 'jobs:\n  a:\n    name: "A\n  B"\n',
  "Strich im plain-Wert": "jobs:\n  a:\n    name: - x\n",
  "Indikator @ am Wertanfang": "jobs:\n  a:\n    name: @x\n",
  "Indikator Komma am Wertanfang": "jobs:\n  a:\n    name: ,x\n",
  "Tab hinter dem Strich": "jobs:\n  a:\n    steps:\n      -\tname: X\n",
  "Kommentar im Schlüssel": "jobs:\n  a:\n    kaputt #c: y\n",
  "plain mit Kommentar und tieferer Folgezeile": "jobs:\n  a:\n    name: A # c\n      B\n",
  "Hex-Escape über den Zeilenumbruch": 'jobs:\n  a:\n    name: "A\\x4\n      B"\n',
  "Backslash im einfach gequoteten Wert": "jobs:\n  a:\n    name: 'a\\b'\n",
  "Tab im gefalteten Quote": 'jobs:\n  a:\n    name: "A\n  B\t C"\n',
  "Backslash am Zeilenende vor Leerzeile": 'jobs:\n  a:\n    name: "A\\\n\n      B"\n',
  "Kommentarzeile unter plain-Wert": "jobs:\n  a:\n    name: A\n      # c\n    runs-on: x\n",
  "gefaltet mit tiefer eingerückter Zeile": "jobs:\n  a:\n    name: >\n      A\n        B\n      C\n",
  "leerer Block-Skalar vor Geschwister": "jobs:\n  a:\n    name: |\n    runs-on: x\n",
  "kaputter Block-Skalar-Kopf": "jobs:\n  a:\n    name: |x\n",
  "Codepunkt über U+10FFFF": 'jobs:\n  a:\n    name: "\\U00110000"\n',
  "Escape-Tabelle N": 'jobs:\n  a:\n    name: "\\N"\n',
};

/** Formen, die der Leser nicht liest: Text, Zeile, Konstrukt (geschlossene Liste im Kopfkommentar des Moduls). */
const NICHT_LESBAR: Record<string, [string, number, RegExp]> = {
  "Flow-Collection als Job": ["jobs:\n  a: { name: X }\n", 2, /Flow-Collection als Job/],
  "Flow-Collection als steps": ["jobs:\n  a:\n    steps: [ { name: S } ]\n", 3, /Flow-Collection als steps/],
  "Flow-Collection als Step": ["jobs:\n  a:\n    steps:\n      - { name: S }\n", 4, /Flow-Collection als Step/],
  "Flow-Collection als name-Wert": ["jobs:\n  a:\n    name: [x]\n", 3, /Flow-Collection als name-Wert/],
  "Flow-Collection als jobs": ["jobs: { a: {} }\n", 1, /Flow-Collection als jobs/],
  "Anker am Job": ["jobs:\n  a: &x\n    name: X\n", 2, /Anker als Job/],
  "Alias als Job": ["jobs:\n  a: *x\n", 2, /Alias als Job/],
  "Anker am Schlüssel": ["jobs:\n  &a x:\n    name: X\n", 2, /Anker/],
  "Tag am name-Wert": ["jobs:\n  a:\n    name: !!str X\n", 3, /Tag/],
  "Anker am name-Wert": ["jobs:\n  a:\n    name: &n X\n", 3, /Anker/],
  "Alias am Step": ["jobs:\n  a:\n    steps:\n      - *s\n", 4, /Alias als Step/],
  "Merge-Schlüssel": ["jobs:\n  a:\n    <<: *base\n", 3, /Merge-Schlüssel/],
  "?-Schlüssel": ["jobs:\n  a:\n    ? name\n    : X\n", 3, /\?-Schlüssel/],
  "Tab in der Einrückung": ["jobs:\n  a:\n\tname: X\n", 3, /Tab in der Einrückung/],
  "zweites Dokument": ["jobs:\n  a:\n    name: X\n---\njobs:\n  b:\n    name: Y\n", 4, /zweites Dokument/],
  Direktive: ["%YAML 1.2\n---\njobs:\n", 1, /Direktive/],
  "Flow-/JSON-Form oben": ['{ "jobs": { "a": { "name": "X" } } }\n', 1, /Flow-\/JSON-Form oben/],
  "Flow-Liste oben": ["[a]\n", 1, /Flow-\/JSON-Form oben/],
  "unbekanntes Escape": ['jobs:\n  a:\n    name: "A\\qB"\n', 3, /unbekanntes Escape/],
  "zu kurzes Hex-Escape": ['jobs:\n  a:\n    name: "A\\x4"\n', 3, /unbekanntes Escape/],
  "Liste als jobs": ["jobs:\n  - a\n", 2, /Liste als jobs/],
  "Liste als jobs auf Schlüsselhöhe": ["jobs:\n- a\n", 2, /Liste als jobs/],
  "Liste als Job": ["jobs:\n  a:\n  - name: X\n", 3, /Liste als Job/],
  "doppelter Schlüssel": ["jobs:\n  a:\n    name: X\n    name: Y\n", 4, /doppelter Schlüssel/],
  "Zeile ohne Schlüssel": ["jobs:\n  a:\n    name: X\n    kaputt\n", 4, /Zeile ohne Schlüssel/],
  "falsche Einrückung": ["jobs:\n  a:\n    name: X\n   runs-on: y\n", 4, /falsche Einrückung/],
  "unbeendetes Quote": ['jobs:\n  a:\n    name: "X\n', 3, /unbeendetes Quote/],
  "Doppelpunkt im plain-Wert": ["jobs:\n  a:\n    name: A: B\n", 3, /plain-Wert/],
  "Flow-Klammer schließt auf Schlüsselhöhe": ["jobs:\n  a:\n    runs-on: x\n    env: {\n    }\n", 5, /Flow-Collection/],
  "Block-Skalar auf der Folgezeile": ["jobs:\n  a:\n    name:\n      | \n        X\n", 4, /Block-Skalar auf der Folgezeile/],
  "Dokumentstart mit Inhalt": ["--- text\njobs:\n", 1, /Dokumentstart mit Inhalt/],
  "steps als Mapping": ["jobs:\n  a:\n    steps:\n      name: X\n", 4, /steps ist keine Block-Sequenz/],
};

/** Alle Texte, die der Differenztest gegen `yaml` abgleicht. */
const FIXTURES: Record<string, string> = {
  MIT_RAUTE,
  ...Object.fromEntries(Object.entries(LESBAR).map(([k, [text]]) => [k, text])),
  ...Object.fromEntries(Object.entries(NICHT_LESBAR).map(([k, [text]]) => [k, text])),
  ...NUR_DIFFERENZ,
  "kaputtes YAML": "jobs:\n  a: [\n",
  Block_Doppelgaenger: "jobs:\n  x:\n    name: |\n      Beispiel-Check (Zusatz, #5)\n",
  Flow_Doppelgaenger: 'jobs:\n  x: { name: "Beispiel-Check (Zusatz, #5)" }\n',
};

describe("blockformNamen – liest name: in Blockform", () => {
  for (const [titel, [text, erwartet]] of Object.entries(LESBAR)) {
    test(titel, () => {
      assert.deepEqual(blockformNamen(text), { namen: erwartet });
    });
  }
  test("leere Eingabe und reine Kommentare ergeben keine Namen", () => {
    assert.deepEqual(blockformNamen(""), { namen: [] });
    assert.deepEqual(blockformNamen("# nur ein Kommentar\n"), { namen: [] });
  });
});

describe("blockformNamen – nicht lesbare Formen sind nie still grün", () => {
  for (const [titel, [text, zeile, konstrukt]] of Object.entries(NICHT_LESBAR)) {
    test(titel, () => {
      const r = blockformNamen(text);
      assert.equal(r.namen, undefined, "kein Namens-Ergebnis");
      assert.equal(r.fehler?.zeile, zeile);
      assert.match(r.fehler?.konstrukt ?? "", konstrukt);
    });
  }
});

describe("blockformNamen gegen die yaml-Bibliothek (Differenztest)", () => {
  /** Wirft `yaml`, muss der Leser „nicht lesbar“ melden; sonst liefert er exakt dieselben Namen oder „nicht lesbar“ (nie weniger). */
  function gleich(titel: string, text: string): void {
    let referenz: string[] | null;
    try {
      referenz = yamlNamen(text);
    } catch {
      referenz = null;
    }
    const r = blockformNamen(text);
    if (referenz === null) assert.ok(r.fehler, `${titel}: yaml wirft, der Leser muss „nicht lesbar“ melden`);
    else if (r.namen) assert.deepEqual(r.namen, referenz, `${titel}: Namen weichen von yaml ab`);
  }
  test("jede Fixture", () => {
    for (const [titel, text] of Object.entries(FIXTURES)) gleich(titel, text);
  });
  test("jede lesbare Fixture hat eine Referenz, die der Leser trifft (kein leerer Vergleich)", () => {
    for (const [titel, [text, erwartet]] of Object.entries(LESBAR)) {
      assert.deepEqual(yamlNamen(text), erwartet, titel);
    }
  });
  test("jede echte Workflow-Datei ist lesbar und ergibt exakt die Namen von yaml", () => {
    const dateien = echteWorkflows();
    assert.ok(dateien.length > 0);
    for (const { pfad, text } of dateien) {
      const r = blockformNamen(text);
      assert.ok(r.namen, `${pfad}: nicht lesbar (${r.fehler?.zeile}: ${r.fehler?.konstrukt})`);
      assert.deepEqual(r.namen, yamlNamen(text), pfad);
    }
  });
});

describe("verstoesse – gleichnamige Fremd-Jobs werden erkannt (quellprojekt#1172)", () => {
  const K = ["Beispiel-Check (Zusatz,"];

  test("genau eine Quelle ⇒ kein Verstoß", () => {
    assert.deepEqual(verstoesse(wf(["beispiel.yml", MIT_RAUTE]), K), []);
  });
  test("zweite Datei mit wortgleichem Job ⇒ Verstoß mit beiden Fundstellen", () => {
    const v = verstoesse(wf(["beispiel.yml", MIT_RAUTE], ["fake.yml", MIT_RAUTE]), K);
    assert.equal(v.length, 1);
    assert.match(v[0], /2 Quellen.*beispiel\.yml.*fake\.yml/);
  });
  test("Variante mit anderer Ticketnummer (#999) parst auf denselben Kontext ⇒ Verstoß", () => {
    const fake = `jobs:\n  x:\n    name: Beispiel-Check (Zusatz, #999)\n`;
    assert.equal(verstoesse(wf(["beispiel.yml", MIT_RAUTE], ["fake.yml", fake]), K).length, 1);
  });
  test("gequotete Variante mit Zusatz beginnt mit dem Kontext ⇒ Verstoß (fail-closed)", () => {
    const fake = `jobs:\n  x:\n    name: "Beispiel-Check (Zusatz, #903)"\n`;
    assert.equal(verstoesse(wf(["beispiel.yml", MIT_RAUTE], ["fake.yml", fake]), K).length, 1);
  });
  test("zweiter gleichnamiger Job in DERSELBEN Datei ⇒ Verstoß", () => {
    const doppelt = `${MIT_RAUTE}  fake:\n    name: Beispiel-Check (Zusatz, #1)\n`;
    assert.equal(verstoesse(wf(["beispiel.yml", doppelt]), K).length, 1);
  });
  test("Block-Skalar-Doppelgänger ⇒ Verstoß; Flow-Doppelgänger ⇒ nicht lesbar", () => {
    const block = `jobs:\n  x:\n    name: |\n      Beispiel-Check (Zusatz, #5)\n`;
    const flow = `jobs:\n  x: { name: "Beispiel-Check (Zusatz, #5)" }\n`;
    assert.equal(verstoesse(wf(["beispiel.yml", MIT_RAUTE], ["fake.yml", block]), K).length, 1);
    const r = quellenJeKontext(wf(["beispiel.yml", MIT_RAUTE], ["fake.yml", flow]), K);
    assert.equal(r.nichtLesbar.length, 1);
    assert.equal(r.nichtLesbar[0].pfad, "fake.yml");
    assert.equal(r.nichtLesbar[0].zeile, 2);
  });
  test("dynamischer Name mit Kontext-Präfix ⇒ Verstoß (fail-closed); fremdes Präfix nicht", () => {
    const dyn = (n: string) => `jobs:\n  x:\n    name: "${n}"\n`;
    assert.equal(verstoesse(wf(["beispiel.yml", MIT_RAUTE], ["fake.yml", dyn("Beispiel-Check ${{ matrix.x }}")]), K).length, 1);
    assert.equal(verstoesse(wf(["beispiel.yml", MIT_RAUTE], ["fake.yml", dyn("${{ matrix.x }}")]), K).length, 1);
    assert.deepEqual(verstoesse(wf(["beispiel.yml", MIT_RAUTE], ["ok.yml", dyn("Anderes ${{ matrix.x }}")]), K), []);
  });
  test("Kontext ganz ohne Quelle ⇒ Verstoß (sonst prüfte der Wächter nach Umbenennung ins Leere)", () => {
    assert.match(verstoesse(wf(["ci.yml", "jobs:\n  a:\n    name: Anderes\n"]), K)[0], /0 Quellen/);
  });
  test("ohne jede Workflow-Datei hat jeder Kontext 0 Quellen", () => {
    assert.match(verstoesse([], K)[0], /0 Quellen/);
  });
});

test("istWorkflowDatei zählt .yml UND .yaml, aber nichts anderes", () => {
  assert.ok(istWorkflowDatei("ci.yml"));
  assert.ok(istWorkflowDatei("fake.yaml"));
  assert.ok(!istWorkflowDatei("README.md"));
  assert.ok(!istWorkflowDatei("ci.yml.bak"));
});

describe("Ruleset-Spiegel – Form (Z1)", () => {
  test("leere, fehlende oder nicht-textuelle Kontext-Liste wirft", () => {
    const mit = (checks: string) => `{"name":"n","bypassActors":[],"requiredChecks":${checks}}`;
    assert.throws(() => leseKontexte('{"name":"n","bypassActors":[]}'), /nicht leere Liste/);
    assert.throws(() => leseKontexte(mit("[]")), /nicht leere Liste/);
    assert.throws(() => leseKontexte(mit('"x"')), /nicht leere Liste/);
    assert.throws(() => leseKontexte(mit('["a",3]')), /nicht leere Liste aus Texten/);
    assert.throws(() => leseKontexte(mit('[" "]')), /nicht leere Liste aus Texten/);
    assert.deepEqual(leseKontexte(mit('["a"]')), ["a"]);
  });
  test("Name und Bypass-Liste fehlen oder sind kaputt: wirft (eine Eingangsprüfung für Generator und Wächter)", () => {
    assert.throws(() => leseKontexte('{"requiredChecks":["a"],"bypassActors":[]}'), /name fehlt/);
    assert.throws(() => leseKontexte('{"name":" ","requiredChecks":["a"],"bypassActors":[]}'), /name fehlt/);
    assert.throws(() => leseKontexte('{"name":"n","requiredChecks":["a"]}'), /bypassActors muss eine Liste sein/);
    assert.throws(() => leseKontexte('{"name":"n","requiredChecks":["a"],"bypassActors":{}}'), /bypassActors muss eine Liste sein/);
  });
  test("codeScanning: optional (fehlt → leer), kaputt wirft (#92 L2)", () => {
    const mit = (cs: string) => `{"name":"n","requiredChecks":["a"],"bypassActors":[],"codeScanning":${cs}}`;
    const lies = (j: string) => (pruefeRulesetSpiegel(JSON.parse(j), "Spiegel") as unknown as { codeScanning: unknown[] }).codeScanning;
    assert.deepEqual(lies('{"name":"n","requiredChecks":["a"],"bypassActors":[]}'), []);
    assert.equal(lies(mit('[{"tool":"CodeQL","sicherheitsSchwelle":"high_or_higher","alertSchwelle":"errors"}]')).length, 1);
    assert.throws(() => leseKontexte(mit('"x"')), /codeScanning muss eine Liste sein/);
    assert.throws(() => leseKontexte(mit("[null]")), /codeScanning\[0\]/);
    assert.throws(() => leseKontexte(mit('[{"tool":"","sicherheitsSchwelle":"a","alertSchwelle":"b"}]')), /codeScanning\[0\]/);
    assert.throws(() => leseKontexte(mit('[{"tool":"CodeQL","sicherheitsSchwelle":" ","alertSchwelle":"b"}]')), /codeScanning\[0\]/);
    assert.throws(() => leseKontexte(mit('[{"tool":"CodeQL","sicherheitsSchwelle":"a"}]')), /codeScanning\[0\]/);
  });
  test("der echte Spiegel nennt den Ruleset-Namen und hat die Bypass-Liste", () => {
    const r = JSON.parse(readFileSync(RULESET_SPIEGEL, "utf8")) as { name?: unknown; bypassActors?: unknown };
    assert.equal(r.name, "main-schutz");
    assert.ok(Array.isArray(r.bypassActors));
  });
});


describe("echte Workflows – jeder Required-Check-Kontext hat genau eine Quelle", () => {
  test("die Kontext-Liste ist nicht leer und es gibt Workflow-Dateien", () => {
    assert.ok(REQUIRED_CONTEXTS.length > 0);
    assert.ok(echteWorkflows().length > 0, `keine Workflows unter ${WORKFLOW_DIR}`);
  });
  test("keine echte Workflow-Datei ist nicht lesbar (sonst zählt sie nicht mit)", () => {
    assert.deepEqual(quellenJeKontext(echteWorkflows(), REQUIRED_CONTEXTS).nichtLesbar, []);
  });
  test("kein Required-Check-Name wird von einem zweiten Job beansprucht", () => {
    const v = verstoesse(echteWorkflows(), REQUIRED_CONTEXTS);
    assert.deepEqual(
      v,
      [],
      `Required-Check-Shadowing (quellprojekt#1172): ein Job-Name entspricht einem Required-Check-Kontext des Rulesets ` +
        `\`main-schutz\` mehr (oder weniger) als einmal. Ein gleichnamiger Job könnte den echten Check grün ` +
        `überschreiben. Job umbenennen – oder, bei Umbenennung des echten Checks, Ruleset UND ` +
        `den Spiegel .github/ruleset-main-schutz.json nachziehen.\n${v.join("\n")}`,
    );
  });
});

describe("Blatt-Modul – der Blockform-Leser importiert nur Node-Builtins", () => {
  test("keine Importe außer node:…", () => {
    const quelle = readFileSync(join(ROOT, "scripts", "workflow-blockform.mjs"), "utf8");
    const importe = [...quelle.matchAll(/^\s*(?:import|export)\b[^\n]*\bfrom\s+["']([^"']+)["']/gm)].map((m) => m[1]);
    assert.deepEqual(importe.filter((p) => !p.startsWith("node:")), []);
    assert.ok(!/\bimport\s*\(|\brequire\s*\(/.test(quelle), "kein dynamischer Import");
  });
});
