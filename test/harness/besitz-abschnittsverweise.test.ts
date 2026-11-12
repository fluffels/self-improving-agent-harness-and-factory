/* Kern-Verweis-Wächter: Bezieher-Sicht auf Verweise in Besitz-Text (factory#177, Vor-Tag-Probe; factory#245 vereinigt den früheren Wächter für Verweise auf AGENTS.md und Regel 7 (3) aus `ticket-ablauf`).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/. Die Scans stehen in `kern-verweise.ts`.
 *
 * Regel: Kein Verweis aus verteiltem Besitz-Text darf in einem Bezieher ins Leere zeigen. Umfang: verteilte Manifest-Einheiten ohne JSON-Schlüssel,
 * Endungen .md/.mjs/.cjs/.js, nur innerhalb der Besitz-Spannen; ADRs und Dateien mit Datum im Namen sind wie im Gate ausgenommen; Code wird NICHT maskiert
 * (ein Verweis in Inline-Code oder Fence zählt wie jeder andere); fehlt das Ziel eines normalen Verweises, bleibt es still (das meldet check:docdrift).
 *   (i)   Verweise auf AGENTS.md und den Projekt-Block (Formenliste unten): nur Titel des Kern-Blocks bzw. der Projekt-Block-Vorlage (Bezieher-Eigenes).
 *   (ii)  Ziel ist selbst eine ganze Besitz-Datei: kommt unverändert an, übersprungen.
 *   (iii) jedes andere Ziel, die STRENGE FORM: der Verweis ist der Link-Text eines Markdown-Links `[<pfad>.md › A](<relativ>/<pfad>.md#<anker>)` auf dieselbe
 *         Seite, der Anker steht in der Ankerliste `KERN_LINK_ANKER` (`kern-link-anker.json`), es ist genau ein Segment, und das Segment trifft die Überschrift
 *         des Ankers. Die Ankerliste garantiert pro Anker die Überschrift im Bezieher (Anker-Stubs, `stub-anker` von check:factorylinks). Alles andere
 *         schreibt der Text als Fabrik-Form `<pfad>.md (Fabrik) › A` (auch `§`, auch Ketten): die Regex von check:docdrift erkennt sie nicht (Pfad, Leerzeichen,
 *         Trenner), also prüft der Bezieher sie nie; in der Fabrik prüft dieser Wächter sie gegen die VOLLE Seite (Überschriften und Fettdruck-Anfänge).
 *         Die Fabrik-Form gilt in den Besitz-Spannen aller Manifest-Einheiten, auch im Ring oberflaeche; ein fehlendes Ziel ist ein Fund.
 *
 * Formenliste der Verweise auf AGENTS.md (geschlossen, Abgleich mit `abschnittTrifft` gegen die Titel, Wortgrenze wie in check:docdrift):
 *   (1) `AGENTS.md § A` / `› A` (Muster 8), (2) `AGENTS.md (§ A`, (3) `Projekt-Block › A` / `§ A`: in allen Kern-Einheiten (Besitz-Spannen), Ziel Kern-Block bzw. Vorlage
 *   (fehlt sie, der Projekt-Block der eigenen AGENTS.md); (4) ein bares `§ A` im selben Absatz erbt die Zieldatei des letzten `<datei> § …`, (5) `AGENTS.md „A"` (auch `AGENTS.md § „A"`, Muster 8 sieht `„` nicht):
 *   nur in Dateien unter .claude/ und .agents/ (absatzweise, `…` trennt Fragmente). Dateien außerhalb des Kerns (.claude/, .agents/, nicht verteilt): alle Formen
 *   gegen die ganze AGENTS.md. Ein `CLAUDE.md`-Ziel ist immer rot (die Datei ist verboten).
 *
 * Ankerliste: sortiertes JSON `test/harness/kern-link-anker.json`; sie wächst nur zusammen mit einer `SIH-Bezieher-Migration:`-Zeile, `tag-takt` führt neue Einträge seit dem
 * Basis-Tag im Tag-Ticket als Bezieher-Migration auf. Gleichstand gilt für Links aus `.md`-Quellen (Sync-Verhalten); Link-Anker aus Skripten müssen in der Liste stehen
 * (Teilmenge). Ein Eintrag, den kein Besitz-Text mehr setzt, ist rot (streichen).
 *
 * Grenzen (geschlossen): nur Muster 8 und die Formen oben (andere Verweisarten decken Anker-Stubs ab; Test-Pfade und `.yml` sind im Bezieher still). Der Ring oberflaeche reist
 * nie in einen Bezieher (ADR 0029): keine strenge Form, nur die Fabrik-Form-Prüfung. Ob die Bezieher-Seite die Überschrift wirklich trägt, sieht nur die Vor-Tag-Probe.
 * Zusätzliche Überschriften auf einer eigenen Bezieher-Seite zählen nicht.
 *
 * Zweite Regel (factory#177): Besitz-Text nennt `npm run <x>` (und `npm test`) nur für die Grundausstattung jedes Beziehers
 * (`BEZIEHER_NPM_SKRIPTE` aus `test/support/bezieher-npm-skripte.ts`, geschlossen); alles andere steht als `node scripts/<x>.mjs`, denn ein Bezieher hat das npm-Skript nicht
 * (Fund „Totes Kommando“ von check:docdrift). Umfang: nur .md in verteilten Einheiten, nur Besitz-Spannen; die .mjs-Laufzeittexte
 * deckt `kern-laufzeittexte.test.ts` mit derselben Liste ab. Grenze: ob ein Bezieher ein Skript wirklich hat, sieht nur die Vor-Tag-Probe; die Liste wächst nur zusammen
 * mit einer `SIH-Bezieher-Migration:`-Zeile.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../../scripts/check-docdrift.mjs";
import { BEZIEHER_NPM_SKRIPTE } from "../support/bezieher-npm-skripte";
import { fixture } from "../support/tmp-fixture";
import { repoDateien } from "./repo-texte";
import {
  ANKERLISTE,
  type Einheit,
  STRENG_MELDUNG,
  abgeleitet,
  absatzVerweise,
  besitzDateien,
  ladeKernLinkAnker,
  musterVerweise,
  scanneAgents,
  scanneFabrik,
  scanneLinkAnker,
  strengMeldung,
  strengeFunde,
  tote,
  titelVon,
  vergleicheAnker,
  verweiseNachMuster,
  vorlageOderProjektBlock,
  FABRIK_VERWEIS,
  PROJEKT_BLOCK_VERWEIS,
  AGENTS_KLAMMER_VERWEIS,
} from "./kern-verweise";

const drift = rawDrift as unknown as {
  abschnittVerweise: (text: string, o: { istMarkdown: boolean }) => { pfad: string; segmente: string[]; index: number }[];
  parseNpmRunMentions: (md: string) => Set<string>;
  ABSCHNITT_VERWEIS: RegExp;
};

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MANIFEST = (eintraege: Einheit[]): string => JSON.stringify({ version: 3, eintraege });
const KERN = (inhalt: string): string => `# Kopf\n<!-- factory-besitz:start kern -->\n${inhalt}\n<!-- factory-besitz:ende kern -->\n## Projekt\n`;
const funde = (r: { funde: { datei: string; ziel: string; segment: string }[] }): string[] => r.funde.map((f) => `${f.datei} -> ${f.ziel}: ${f.segment}`);

describe("Strenge Form: Verweise auf Fabrik-Seiten (Regel iii)", () => {
  const SEITE = "# Seite\n\n## Echte Überschrift\n\n## Andere\n";
  const LISTE = new Set(["docs/seite.md#echte-überschrift", "docs/seite.md#andere"]);
  const mit = (skill: string, pfad = "skill.md", seite = SEITE): string =>
    fixture({ ".factory/besitz.json": MANIFEST([{ pfad, ring: "kern" }]), [pfad]: skill, "docs/seite.md": seite });
  const grund = (wurzel: string, erlaubt = LISTE): string[] => strengeFunde(wurzel, erlaubt).funde.map((f) => f.grund.slice(0, 3));

  test("ein Link-Text mit Anker der Ankerliste ist grün, jeder Verweis wird gezählt", () => {
    const wurzel = mit("Siehe [docs/seite.md › Echte Überschrift](docs/seite.md#echte-überschrift) und [docs/seite.md § Andere](docs/seite.md#andere)\n");
    assert.deepEqual(strengeFunde(wurzel, LISTE), { funde: [], verweise: 2 });
  });

  test("ein reiner Textverweis ist rot, die Meldung nennt alle drei Wege samt Fabrik-Form und AGENTS.md § (L12c)", () => {
    const wurzel = mit("Siehe docs/seite.md › Echte Überschrift\n");
    assert.deepEqual(grund(wurzel), ["(a)"]);
    for (const teil of ["(Fabrik)", "AGENTS.md §", "kern-link-anker.json", "SIH-Bezieher-Migration:"]) assert.ok(STRENG_MELDUNG.includes(teil), teil);
    assert.ok(strengMeldung(strengeFunde(wurzel, LISTE).funde).includes(STRENG_MELDUNG));
  });

  test("ein Anker außerhalb der Ankerliste ist rot (Negativfall)", () => {
    const wurzel = mit("Siehe [docs/seite.md › Andere](docs/seite.md#andere)\n");
    assert.deepEqual(grund(wurzel, new Set(["docs/seite.md#echte-überschrift"])), ["(c)"]);
    assert.deepEqual(grund(wurzel, new Set()), ["(c)"]);
  });

  test("ein Link auf eine andere Seite, ein Segment, das die Anker-Überschrift verfehlt, und eine Kette sind rot", () => {
    assert.deepEqual(grund(mit("[docs/seite.md › Andere](docs/andere.md#x)\n"), new Set(["docs/andere.md#x"])), ["(b)"]);
    assert.deepEqual(grund(mit("[docs/seite.md › Andere](docs/seite.md#echte-überschrift)\n")), ["(e)"]);
    assert.deepEqual(grund(mit("[docs/seite.md › Echte Überschrift › Andere](docs/seite.md#echte-überschrift)\n")), ["(d)"]);
    assert.deepEqual(grund(mit("[docs/seite.md › Echte Überschrift](docs/seite.md#gibt-es-nicht)\n"), new Set(["docs/seite.md#gibt-es-nicht"])), ["(e)"]);
  });

  test("ein Verweis in Inline-Code oder Code-Fence zählt (nicht maskiert) und ist rot, auch ein Link darin", () => {
    assert.deepEqual(grund(mit("`docs/seite.md › Echte Überschrift`\n")), ["(a)"]);
    assert.deepEqual(grund(mit("```\n[docs/seite.md › Echte Überschrift](docs/seite.md#echte-überschrift)\n```\n")), ["(a)"]);
  });

  test("eine Überschrift im Code-Fence der Zielseite ist kein Anker (rot)", () => {
    const wurzel = mit("[docs/seite.md › Nur im Fence](docs/seite.md#nur-im-fence)\n", "skill.md", "# Seite\n\n```\n## Nur im Fence\n```\n");
    assert.deepEqual(grund(wurzel, new Set(["docs/seite.md#nur-im-fence"])), ["(e)"]);
  });

  test("Skriptdatei (.mjs): ein Link im Kommentar ist grün, ein Textverweis rot", () => {
    assert.deepEqual(strengeFunde(mit("// siehe [docs/seite.md › Andere](../docs/seite.md#andere)\n", "scripts/x.mjs"), LISTE).funde, []);
    assert.deepEqual(grund(mit("// siehe docs/seite.md › Andere\n", "scripts/x.mjs")), ["(a)"]);
  });

  test("ein Ziel relativ zur verweisenden Datei wird aufgelöst, der Anker steht dann mit dem aufgelösten Pfad in der Liste", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: ".agents/skills/x/SKILL.md", ring: "kern" }]),
      ".agents/skills/x/SKILL.md": "Siehe [seite.md › Echte Überschrift](seite.md#echte-überschrift)\n",
      ".agents/skills/x/seite.md": SEITE,
    });
    assert.deepEqual(strengeFunde(wurzel, new Set([".agents/skills/x/seite.md#echte-überschrift"])), { funde: [], verweise: 1 });
    assert.deepEqual(grund(wurzel), ["(c)"]);
  });

  test("übersprungen: Ziel AGENTS.md, Ziel ganze Besitz-Datei, fehlendes Ziel, außerhalb der Spanne, ADR, Datum, nicht verteilte Einheit", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([
        { pfad: "AGENTS.md", block: "kern", ring: "kern" },
        { pfad: "skill.md", ring: "kern" },
        { pfad: "docs/ganz.md", ring: "kern" },
        { pfad: "docs/adr/0001-x.md", ring: "kern" },
        { pfad: "notiz-2026-01-01.md", ring: "kern" },
        { pfad: "ober.md", ring: "oberflaeche" },
      ]),
      "AGENTS.md": KERN("Kern: AGENTS.md § Regel.") + "Projekt: docs/seite.md › Andere\n",
      "skill.md": "docs/ganz.md › Fett\nAGENTS.md § Regel\ndocs/fehlt.md › X\n",
      "docs/ganz.md": "**Fett** Text.\n",
      "docs/adr/0001-x.md": "docs/seite.md › Andere\n",
      "notiz-2026-01-01.md": "docs/seite.md › Andere\n",
      "ober.md": "docs/seite.md › Andere\n",
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(strengeFunde(wurzel, LISTE), { funde: [], verweise: 0 });
  });

  test("Innerhalb der Block-Spanne einer Datei wird geprüft", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Siehe docs/seite.md › Andere."),
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(grund(wurzel), ["(a)"]);
  });

  test("echtes Repo: jeder Kern-Verweis auf eine Fabrik-Seite hat die strenge Form (und der Scan ist nicht leer)", () => {
    const r = strengeFunde(ROOT, new Set(ladeKernLinkAnker(ROOT)));
    assert.ok(r.verweise >= 10, `Scan extrahiert nur ${r.verweise} Verweise: Muster oder Umfang kaputt (Leerlauf)`);
    assert.deepEqual(r.funde, [], strengMeldung(r.funde));
  });
});

describe("Fabrik-Form `<pfad>.md (Fabrik) › A` in Besitz-Text", () => {
  const SEITE_FETT = "# Seite\n\n## Echte Überschrift\n\n**Fetter Abschnitt** Text.\n";
  const fabrik = (ring: string, text: string, seite: string | null = SEITE_FETT): string =>
    fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring }]),
      "skill.md": text,
      ...(seite === null ? {} : { "docs/seite.md": seite }),
    });

  test("Überschrift und Fettdruck-Abschnitt der Fabrik-Seite treffen (grün), gezählt wird jeder Verweis", () => {
    const wurzel = fabrik("kern", "Siehe docs/seite.md (Fabrik) › Echte Überschrift\nund docs/seite.md (Fabrik) § Fetter Abschnitt\n");
    assert.deepEqual(scanneFabrik(wurzel), { funde: [], verweise: 2 });
  });

  test("ein Abschnitt, den die Fabrik-Seite nicht trägt, ist rot; fehlt die Seite, ist das ein Fund", () => {
    assert.deepEqual(scanneFabrik(fabrik("kern", "Siehe docs/seite.md (Fabrik) › Gibt es nicht\n")).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
    assert.deepEqual(scanneFabrik(fabrik("kern", "Siehe docs/fehlt.md (Fabrik) › Irgendwas\n", null)).funde, [{ datei: "skill.md", ziel: "docs/fehlt.md (fehlt)", segment: "Irgendwas" }]);
  });

  test("Ring oberflaeche: ein normaler Verweis ist kein Fund (reist nie), der Fabrik-Verweis wird geprüft", () => {
    const normal = fabrik("oberflaeche", "Siehe docs/seite.md › Fetter Abschnitt\n");
    assert.deepEqual(strengeFunde(normal, new Set()), { funde: [], verweise: 0 });
    assert.deepEqual(scanneFabrik(normal), { funde: [], verweise: 0 });
    const wurzel = fabrik("oberflaeche", "Siehe docs/seite.md (Fabrik) › Gibt es nicht\n");
    assert.deepEqual(scanneFabrik(wurzel).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
  });

  test("Kette: jedes Segment wird geprüft, der Fund nennt das tote Segment; ein Platzhalter-Segment ist kein Fund", () => {
    assert.deepEqual(scanneFabrik(fabrik("kern", "Siehe docs/seite.md (Fabrik) › Echte Überschrift › Fetter Abschnitt\n")), { funde: [], verweise: 1 });
    const rot = fabrik("kern", "Siehe docs/seite.md (Fabrik) › Echte Überschrift › Gibt es nicht\n");
    assert.deepEqual(scanneFabrik(rot).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
    assert.deepEqual(scanneFabrik(fabrik("kern", "Siehe docs/seite.md (Fabrik) › <Abschnitt>\n")).funde, []);
  });

  test("außerhalb der Besitz-Spanne (Projekt-Teil von AGENTS.md) wird ein Fabrik-Verweis ignoriert, innerhalb geprüft", () => {
    const aussen = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Kern.") + "Projekt: docs/seite.md (Fabrik) › Gibt es nicht\n",
      "docs/seite.md": SEITE_FETT,
    });
    assert.deepEqual(scanneFabrik(aussen), { funde: [], verweise: 0 });
    const innen = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Siehe docs/seite.md (Fabrik) › Gibt es nicht."),
      "docs/seite.md": SEITE_FETT,
    });
    assert.deepEqual(scanneFabrik(innen).funde, [{ datei: "AGENTS.md", ziel: "docs/seite.md", segment: "Gibt es nicht." }]);
  });

  test("Markdown: Fabrik-Verweis in Inline-Code oder Code-Fence zählt nicht, Inline-Code beendet das Segment", () => {
    const code = fabrik("kern", "`docs/seite.md (Fabrik) › Gibt es nicht`\n\n```\ndocs/seite.md (Fabrik) › Gibt es nicht\n```\n");
    assert.deepEqual(scanneFabrik(code), { funde: [], verweise: 0 });
    const ende = fabrik("kern", "Siehe docs/seite.md (Fabrik) › Gibt es nicht `Echte Überschrift`\n");
    assert.deepEqual(scanneFabrik(ende).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
  });

  test("Skriptdatei (.mjs): ein Fabrik-Verweis in Backticks wird nicht maskiert, sondern geprüft; ein Ziel relativ zur Datei wird aufgelöst", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "scripts/x.mjs", ring: "kern" }, { pfad: ".agents/skills/x/SKILL.md", ring: "kern" }]),
      "scripts/x.mjs": "// siehe `docs/seite.md (Fabrik) › Gibt es nicht`\n",
      "docs/seite.md": SEITE_FETT,
      ".agents/skills/x/SKILL.md": "Siehe seite.md (Fabrik) › Gibt es nicht\n",
      ".agents/skills/x/seite.md": SEITE_FETT,
    });
    assert.deepEqual(funde(scanneFabrik(wurzel)).sort(), [".agents/skills/x/SKILL.md -> .agents/skills/x/seite.md: Gibt es nicht", "scripts/x.mjs -> docs/seite.md: Gibt es nicht"]);
  });

  test("Vertrag: check:docdrift erkennt die Fabrik-Form nicht (kein Verweis, der Bezieher prüft sie nie)", () => {
    assert.deepEqual(drift.abschnittVerweise("docs/x.md (Fabrik) › A", { istMarkdown: false }), []);
    assert.deepEqual(drift.abschnittVerweise("docs/x.md (Fabrik) § A", { istMarkdown: true }), []);
  });

  test("echtes Repo: Fabrik-Verweise treffen alle (und der Scan ist nicht leer)", () => {
    const { funde: f, verweise } = scanneFabrik(ROOT);
    assert.ok(verweise >= 15, `Scan extrahiert nur ${verweise} Fabrik-Verweise: Muster oder Umfang kaputt (Leerlauf)`);
    assert.deepEqual(f, [], `Fabrik-Verweise ohne Treffer in der Fabrik-Seite:\n${funde({ funde: f }).join("\n")}`);
  });
});

describe("Muster aus ABSCHNITT_VERWEIS abgeleitet (factory#245 L12b)", () => {
  test("Vertrag: jede abgeleitete Form hat die Quelle der Original-Regex mit ersetztem Vorspann und dieselben Flags", () => {
    const quelle = drift.ABSCHNITT_VERWEIS.source;
    for (const re of [FABRIK_VERWEIS, PROJEKT_BLOCK_VERWEIS, AGENTS_KLAMMER_VERWEIS]) {
      assert.notEqual(re.source, quelle);
      assert.equal(re.flags, drift.ABSCHNITT_VERWEIS.flags);
      assert.ok(re.source.endsWith(quelle.slice(quelle.indexOf("(›|§)") + "(›|§)".length)), "der Abschnittstext-Teil bleibt gleich");
    }
  });

  test("abgeleitet wirft, wenn der Vorspann nicht mehr in der Quelle steht; verweiseNachMuster liest wie abschnittVerweise", () => {
    const orig = drift.ABSCHNITT_VERWEIS;
    assert.ok(abgeleitet(String.raw`(X) (›|§)`) instanceof RegExp);
    assert.throws(() => abgeleitet(String.raw`(X) (›|§)`, /ohne Vorspann/g), /Vorspann/);
    assert.equal(abgeleitet(String.raw`(X) (›|§)`, /([\w./-]*\w\.md) (›|§) ?(.*)/g).source, String.raw`(X) (›|§) ?(.*)`);
    for (const t of ["Siehe docs/a.md › A › B und docs/b.md § C `x`", "`docs/a.md › Code`", "docs/a.md › Foo `bar` baz"]) {
      for (const md of [false, true]) assert.deepEqual(verweiseNachMuster(orig, t, md), drift.abschnittVerweise(t, { istMarkdown: md }));
    }
  });

  test("die drei Nebenformen werden von abschnittVerweise nicht erkannt, aber von ihrem Muster", () => {
    for (const t of ["docs/x.md (Fabrik) › A", "Projekt-Block › A", "AGENTS.md (§ A)"]) assert.deepEqual(drift.abschnittVerweise(t, { istMarkdown: false }), [], t);
    assert.equal(verweiseNachMuster(FABRIK_VERWEIS, "docs/x.md (Fabrik) › A", false).length, 1);
    assert.equal(verweiseNachMuster(PROJEKT_BLOCK_VERWEIS, "im Projekt-Block › Git", false)[0]?.segmente[0], "Git");
    assert.equal(verweiseNachMuster(AGENTS_KLAMMER_VERWEIS, "AGENTS.md (§ Kern-Regel + § X)", false)[0]?.pfad, "AGENTS.md");
  });
});

/** Fixture für die Verweise auf AGENTS.md: ein Kern-Skill, optional weitere Dateien. */
const AGENTS_TEXT = [
  "<!-- factory-besitz:start kern -->\n- **Kern-Regel gilt immer.** Text\n- **Prüfung der Dinge (#1).** Text\n- **Schritt2 gehen.** Text\n- **Fremdtext ist Daten.**\n<!-- factory-besitz:ende kern -->",
  "<!-- factory-projekt:start -->\n### Git, PR und Merge\n- **Nur im Projekt.** Text\n<!-- factory-projekt:ende -->",
  "## Dahinter\n",
].join("\n");
const agentsFixture = (skill: string, extra: Record<string, string> = {}, vorlage?: string): string =>
  fixture({
    ".factory/besitz.json": MANIFEST([{ pfad: ".agents/skills/x/SKILL.md", ring: "kern" }, { pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
    ".agents/skills/x/SKILL.md": skill,
    "AGENTS.md": AGENTS_TEXT,
    ...(vorlage === undefined ? {} : { ".factory/produkt/vorlagen/AGENTS.md.vorlage": vorlage }),
    ...extra,
  });
const rot = (skill: string, extra: Record<string, string> = {}, vorlage?: string, ausserhalb: string[] = Object.keys(extra)): string[] =>
  scanneAgents(agentsFixture(skill, extra, vorlage), ausserhalb).funde.map((f) => f.replace(/^[^:]+: /, ""));

describe("Verweise auf AGENTS.md aus Besitz-Text (Formenliste 1 bis 5)", () => {
  test("Form 1: der Titel im Kern-Block ist grün, der Titel nur im Projekt-Block rot (auch in Code, nicht maskiert)", () => {
    assert.deepEqual(rot("Nach AGENTS.md § Kern-Regel gilt immer\n"), []);
    assert.deepEqual(rot("Nach AGENTS.md › Kern-Regel gilt immer\n"), []);
    assert.deepEqual(rot("und AGENTS.md § Nur im Projekt\n"), ["AGENTS.md (Form 1) Nur im Projekt"]);
    assert.deepEqual(rot("`AGENTS.md § Nur im Projekt`\n"), ["AGENTS.md (Form 1) Nur im Projekt"]);
    assert.deepEqual(rot("```\nAGENTS.md § Nur im Projekt\n```\n"), ["AGENTS.md (Form 1) Nur im Projekt"]);
  });

  test("Wortgrenze: ein abgeschnittenes Wort („Pr“, „Schritt“, „Fremd“) ist rot, das ganze Wort grün", () => {
    for (const t of ["Pr", "Schritt", "Fremd"]) assert.equal(rot(`AGENTS.md § ${t})\n`).length, 1, t);
    assert.deepEqual(rot("AGENTS.md § Prüfung der Dinge)\n"), []);
    assert.deepEqual(rot("AGENTS.md § Fremdtext ist Daten)\n"), []);
  });

  test("Segmentende an Komma, Semikolon, Doppelpunkt, eckiger Klammer und Zeilenende", () => {
    for (const ende of [", danach mehr", "; weiter", ": weiter", "]\nweiter", "\nund Erfundenes"]) assert.deepEqual(rot(`AGENTS.md § Fremdtext ist Daten${ende}\n`), [], ende);
  });

  test("ein erfundener Abschnitt und ein Prosa-Anhängsel an einem echten Titel sind rot", () => {
    assert.equal(rot("AGENTS.md § Erfundener Abschnitt Xyzzy\n").length, 1);
    assert.equal(rot("(AGENTS.md § Fremdtext gilt weiter)\n").length, 1);
  });

  test("Form 2: `AGENTS.md (§ X` trifft den Kern-Block, ein Projekt-Titel ist rot", () => {
    assert.deepEqual(rot("(AGENTS.md (§ Fremdtext ist Daten)\n"), []);
    assert.deepEqual(rot("(AGENTS.md (§ Nur im Projekt)\n"), ["AGENTS.md (Form 2) Nur im Projekt)"]);
  });

  test("Form 3: `Projekt-Block › X` trifft die Vorlage bzw. den eigenen Projekt-Block, nie den Kern-Block; ein volles Segment mit Komma zählt", () => {
    assert.deepEqual(rot("Projekt-Block › Git, PR und Merge\n"), []);
    assert.deepEqual(rot("Projekt-Block › Nur im Projekt\n"), []);
    assert.equal(rot("Projekt-Block › Kern-Regel gilt immer\n").length, 1, "der Kern-Block zählt nicht als Projekt-Block");
    assert.equal(rot("Projekt-Block › Nur im Projekt\n", {}, "- **Anderes.**").length, 1, "die Vorlage gilt, wo sie liegt");
    assert.deepEqual(rot("Projekt-Block › Anderes\n", {}, "- **Anderes.**"), []);
    assert.equal(rot("AGENTS.md § Anderes\n", {}, "- **Anderes.**").length, 1, "streng: ein Vorlagen-Titel trifft `AGENTS.md §` nicht");
    assert.equal(rot("Projekt-Block › Gibt es nicht\n").length, 1);
  });

  test("Formen 4 und 5: bares § erbt die Zieldatei im Absatz, `AGENTS.md „X“` zitiert; Absatzgrenze und fremdes `*.md §` setzen zurück", () => {
    assert.deepEqual(rot("AGENTS.md (§ Kern-Regel gilt immer + § Fremdtext ist Daten)\n"), []);
    assert.deepEqual(rot("AGENTS.md § Kern-Regel gilt immer\n- § Nur im Projekt — Text\n"), ["AGENTS.md (Form 4) Nur im Projekt"]);
    assert.deepEqual(rot("AGENTS.md „Nur im Projekt“ und AGENTS.md „Fremdtext ist Daten“\n"), ["AGENTS.md (Form 5) Nur im Projekt"]);
    assert.deepEqual(rot("AGENTS.md § Kern-Regel gilt immer\n\n§ Anderer Absatz\n"), []);
    assert.deepEqual(rot("siehe docs/agent-harness.md § 2.5 und § Irgendwas\n"), []);
    assert.deepEqual(rot("AGENTS.md + CLAUDE.md liegen bereits im Kontext.\n"), []);
    assert.deepEqual(absatzVerweise("AGENTS.md § „Alpha … Beta“").map((v) => v.segmente), [["Alpha", "Beta"]]);
  });

  test("Formen 4 und 5 gelten nur unter .claude/ und .agents/ (W8), die Formen 1 bis 3 überall im Kern", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "docs/x.md", ring: "kern" }, { pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "docs/x.md": "AGENTS.md § Kern-Regel gilt immer und § Nur im Projekt\n\nAGENTS.md „Nur im Projekt“\n",
      "AGENTS.md": AGENTS_TEXT,
    });
    assert.deepEqual(scanneAgents(wurzel, []).funde, []);
    const f1 = fixture({ ".factory/besitz.json": MANIFEST([{ pfad: "docs/x.md", ring: "kern" }, { pfad: "AGENTS.md", block: "kern", ring: "kern" }]), "docs/x.md": "AGENTS.md § Nur im Projekt\n", "AGENTS.md": AGENTS_TEXT });
    assert.equal(scanneAgents(f1, []).funde.length, 1);
  });

  test("ein Verweis außerhalb der Besitz-Spanne (Projekt-Teil der AGENTS.md) wird ignoriert", () => {
    assert.deepEqual(scanneAgents(agentsFixture("x\n", {}), []).verweise, { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Kern.") + "Projekt: AGENTS.md § Gibt es nicht\n",
    });
    assert.deepEqual(scanneAgents(wurzel, []), { funde: [], verweise: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, dateien: new Set() });
  });

  test("außerhalb des Kerns: alle Formen gegen die ganze AGENTS.md (auch Projekt-Titel), CLAUDE.md ist rot", () => {
    const extra = { ".claude/hooks/h.mjs": "// AGENTS.md § Nur im Projekt\n// AGENTS.md § Nirgends\n// CLAUDE.md § Befehle\n" };
    assert.deepEqual(rot("x\n", extra), ["AGENTS.md (Form 1) Nirgends", "CLAUDE.md (Form 1) Befehle"]);
    assert.deepEqual(rot("x\n", { ".claude/hooks/h.mjs": "AGENTS.md „Nur im Projekt“ und Projekt-Block › Git, PR und Merge\n" }), []);
  });

  test("Formen 4 und 5 im Detail: Zitat nach bares §, Erbe nur durch `<datei> §`, Klammerform, Terminatoren, Normalisierung", () => {
    assert.deepEqual(absatzVerweise("AGENTS.md § Kern\n§ „Alpha Beta“").map((v) => [v.form, v.segmente]), [[4, ["Alpha Beta"]]]);
    assert.deepEqual(absatzVerweise("AGENTS.md › Foo bar\n§ Baz qux"), [], "› erbt nicht");
    assert.deepEqual(absatzVerweise("AGENTS.md „Foo bar“\n§ Baz qux").map((v) => v.form), [5], "ein Zitat erbt nicht");
    assert.deepEqual(rot("(AGENTS.md (§ Kern-Regel gilt immer + § Erfundenes Xyz)\n"), ["AGENTS.md (Form 4) Erfundenes Xyz"]);
    for (const t of [",", ";", ":", "(", "[", "]", "+", "—", "§", "›", ".", ")", "„", '"', "“"]) {
      const segmente = absatzVerweise(`AGENTS.md § Kern-Regel\n§ Fremdtext ist Daten${t} nachher`).flatMap((v) => v.segmente);
      assert.ok(segmente.includes("Fremdtext ist Daten"), `Terminator ${t}: ${segmente.join("|")}`);
    }
    assert.deepEqual(absatzVerweise("AGENTS.md „Foo  **bar**“").map((v) => v.segmente), [["Foo bar"]]);
    assert.deepEqual(absatzVerweise("AGENTS.md § Kern\n§ `Foo`  bar").map((v) => v.segmente), [["Foo bar"]]);
  });

  test("außerhalb des Kerns gelten auch die Absatzformen; ein Pfad mit .claude/ mitten im Pfad ist kein .claude/-Pfad (W8)", () => {
    const f = rot("x\n", { ".claude/hooks/h.mjs": "AGENTS.md § Kern-Regel gilt immer\n- § Nirgends Xyz\n" });
    assert.deepEqual(f, ["AGENTS.md (Form 4) Nirgends Xyz"]);
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "docs/.claude/x.md", ring: "kern" }, { pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "docs/.claude/x.md": "AGENTS.md § Kern-Regel gilt immer\n- § Nirgends Xyz\n",
      "AGENTS.md": AGENTS_TEXT,
    });
    assert.deepEqual(scanneAgents(wurzel, []).funde, []);
  });

  test("Skript-Anker: ein Link in einem Kern-.mjs wird mit der Skript-Endung gefunden (Teilmenge), der Standard zählt nur .md", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "scripts/x.mjs", ring: "kern" }]),
      "scripts/x.mjs": "// [a](../docs/seite.md#neu)\n",
      "docs/seite.md": "# Seite\n",
    });
    const skript = scanneLinkAnker(wurzel, /\.(mjs|cjs|js)$/);
    assert.deepEqual([...skript.anker], ["docs/seite.md#neu"]);
    assert.equal(skript.links, 1);
    assert.deepEqual(scanneLinkAnker(wurzel), { anker: new Set(), links: 0 });
    assert.equal(vergleicheAnker(skript.anker, new Set(), true).length, 1, "ein nicht gelisteter Skript-Anker ist rot");
    assert.deepEqual(vergleicheAnker(skript.anker, new Set(["docs/seite.md#neu"]), true), []);
  });

  test("ein Verweis mit ../ aus der Wurzel hinaus wird nicht aufgelöst (nie außerhalb der Wurzel lesen)", () => {
    const aussen = fixture({
      "inner/.factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "inner/skill.md": "Siehe ../ausserhalb.md § Fett\n",
      "ausserhalb.md": "**Fett** Text.\n",
    });
    assert.deepEqual(strengeFunde(`${aussen}/inner`, new Set()), { funde: [], verweise: 0 });
  });

  test("Grenzen der Extraktion: leerer Abschnittstext und Fragmente unter 3 Zeichen zählen nicht, ab 3 Zeichen ja", () => {
    assert.deepEqual(verweiseNachMuster(drift.ABSCHNITT_VERWEIS, "docs/a.md § ", false), []);
    assert.deepEqual(absatzVerweise("AGENTS.md „ab“"), []);
    assert.deepEqual(absatzVerweise("AGENTS.md „abc“").map((v) => v.segmente), [["abc"]]);
  });

  test("außerhalb des Kerns: eine Kern-Datei in der Liste wird nicht doppelt gezählt, eine fehlende Datei übersprungen", () => {
    const wurzel = agentsFixture("AGENTS.md § Kern-Regel gilt immer\n");
    const einmal = scanneAgents(wurzel, []).verweise[1];
    assert.equal(einmal, 1);
    assert.equal(scanneAgents(wurzel, [".agents/skills/x/SKILL.md", ".claude/fehlt.md"]).verweise[1], einmal);
  });

  test("Titel: Kern-Block, Vorlage bzw. Projekt-Block; ohne Projekt-Block bleibt die Vorlage leer (streng)", () => {
    assert.equal(vorlageOderProjektBlock("- **Vorlagen-Titel.**", AGENTS_TEXT), "- **Vorlagen-Titel.**");
    assert.match(vorlageOderProjektBlock(null, AGENTS_TEXT), /Nur im Projekt/);
    assert.doesNotMatch(vorlageOderProjektBlock(null, AGENTS_TEXT), /Dahinter|Kern-Regel/);
    assert.equal(vorlageOderProjektBlock(null, "- **Kern-Titel.**"), "");
    assert.equal(vorlageOderProjektBlock(null, "<!-- factory-projekt:ende -->\n<!-- factory-projekt:start -->\nx"), "");
    assert.equal(vorlageOderProjektBlock(null, "<!-- factory-projekt:start -->\n- **Nur Start.**\nRest"), "");
    const t = titelVon(AGENTS_TEXT, null);
    assert.equal(tote(musterVerweise("AGENTS.md § Dahinter"), t.kern).length, 1);
    assert.equal(tote(musterVerweise("AGENTS.md § Dahinter"), t.ganz).length, 0);
  });

  test("echtes Repo: jeder Verweis auf AGENTS.md trifft (alle Formen 1 bis 5 kommen vor, Leerlauf-Schutz)", () => {
    const ausserhalb = repoDateien().filter((f) => /^\.(claude|agents)\//.test(f) && /\.(md|js|mjs|cjs|ts)$/.test(f));
    const scan = scanneAgents(ROOT, ausserhalb);
    for (const form of [1, 2, 3, 4, 5] as const) assert.ok(scan.verweise[form] > 0, `keine Verweise der Form ${form} gefunden: Extraktion kaputt oder Form ausgestorben?`);
    assert.ok(scan.verweise[1] >= 20, `nur ${scan.verweise[1]} Verweise der Form 1: Muster oder Umfang kaputt (Leerlauf)`);
    assert.ok([...scan.dateien].some((d) => d.startsWith(".claude/agents/")) && [...scan.dateien].some((d) => d.startsWith(".agents/skills/")));
    assert.deepEqual(scan.funde, [], "Diese Verweise zeigen ins Leere: den Titel des Kern-Blocks (AGENTS.md § …) bzw. des Projekt-Blocks (Projekt-Block › …) wörtlich übernehmen");
  });
});

/** Gemerkte `npm run`-Namen in Besitz-Spannen verteilter `.md`-Einheiten, die ein Bezieher nicht hat. */
function scanneKommandos(wurzel: string): { funde: { datei: string; name: string }[]; erwaehnungen: number } {
  const funde: { datei: string; name: string }[] = [];
  let erwaehnungen = 0;
  for (const { datei, text, spannen } of besitzDateien(wurzel, /\.md$/).dateien) {
    const innen = spannen.map(([a, b]) => text.slice(a, b + 1)).join("\n");
    for (const name of drift.parseNpmRunMentions(innen)) {
      erwaehnungen++;
      if (!BEZIEHER_NPM_SKRIPTE.has(name)) funde.push({ datei, name });
    }
  }
  return { funde, erwaehnungen };
}

const NPM_MANIFEST = (ring: string, pfad = "skill.md"): string => MANIFEST([{ pfad, ring }]);

describe("npm-Kommandos in Besitz-Text aus Sicht des Beziehers", () => {
  test("ein Kommando außerhalb der Grundausstattung in Kern-.md ist ein Fund", () => {
    const wurzel = fixture({ ".factory/besitz.json": NPM_MANIFEST("kern"), "skill.md": "Starte `npm run neu`.\n" });
    assert.deepEqual(scanneKommandos(wurzel).funde, [{ datei: "skill.md", name: "neu" }]);
  });

  test("ein Kommando der Grundausstattung ist kein Fund", () => {
    const wurzel = fixture({ ".factory/besitz.json": NPM_MANIFEST("kern"), "skill.md": "Starte `npm run check:docdrift`.\n" });
    assert.deepEqual(scanneKommandos(wurzel), { funde: [], erwaehnungen: 1 });
  });

  test("npm test in Kern-.md ist ein Fund (Name test)", () => {
    const wurzel = fixture({ ".factory/besitz.json": NPM_MANIFEST("kern"), "skill.md": "Dann `npm test`.\n" });
    assert.deepEqual(scanneKommandos(wurzel).funde, [{ datei: "skill.md", name: "test" }]);
  });

  test("Block-Spanne: im Kern-Block ein Fund, im Projekt-Teil von AGENTS.md keiner", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Kern mit `npm run imkern`.") + "Projekt: `npm run improjekt`\n",
    });
    assert.deepEqual(scanneKommandos(wurzel).funde, [{ datei: "AGENTS.md", name: "imkern" }]);
  });

  test("Orakel: die Erlaubnisliste ist genau die Grundausstattung (wächst nur mit SIH-Bezieher-Migration:-Zeile)", () => {
    const quelle = ["check:docdrift", "check:docmap", "check:factorydrift", "check:internalrefs", "check:size", "skills:sync"];
    assert.deepEqual([...BEZIEHER_NPM_SKRIPTE].sort(), quelle);
  });

  test("eine nicht verteilte Einheit (Ring oberflaeche) wird ignoriert", () => {
    const wurzel = fixture({ ".factory/besitz.json": NPM_MANIFEST("oberflaeche"), "skill.md": "Starte `npm run neu`.\n" });
    assert.deepEqual(scanneKommandos(wurzel), { funde: [], erwaehnungen: 0 });
  });

  test("Grenze: ein Kommando in Kern-.mjs-Text wird bewusst nicht gescannt", () => {
    const wurzel = fixture({ ".factory/besitz.json": NPM_MANIFEST("kern", "scripts/x.mjs"), "scripts/x.mjs": "// npm run neu\n" });
    assert.deepEqual(scanneKommandos(wurzel), { funde: [], erwaehnungen: 0 });
  });

  test("echtes Repo: Besitz-Text nennt nur Grundausstattungs-Skripte (und der Scan ist nicht leer)", () => {
    const { funde: f, erwaehnungen } = scanneKommandos(ROOT);
    assert.ok(erwaehnungen >= 5, `Scan findet nur ${erwaehnungen} Erwähnungen: Umfang kaputt (Leerlauf)`);
    assert.deepEqual(f, [], `npm-Kommandos, die ein Bezieher nicht hat (stattdessen node scripts/<x>.mjs):\n${f.map((x) => `${x.name} <- ${x.datei}`).join("\n")}`);
  });
});

describe("Ankerliste kern-link-anker.json (factory#220 L34)", () => {
  const manifest = (...e: Einheit[]): string => MANIFEST(e);

  test("ein Anker auf eine Fabrik-Seite in Kern-.md wird gefunden, der Pfad relativ zur Datei aufgelöst, ein Doppel zählt als Link, nicht als Anker", () => {
    const wurzel = fixture({
      ".factory/besitz.json": manifest({ pfad: ".agents/skills/x/SKILL.md", ring: "kern" }),
      ".agents/skills/x/SKILL.md": "Siehe [Seite](../../../docs/seite.md#ein-abschnitt) und [nochmal](../../../docs/seite.md#ein-abschnitt) sowie [andere](../../../docs/andere.md#zwei).\n",
      "docs/seite.md": "# Seite\n",
      "docs/andere.md": "# Andere\n",
    });
    const r = scanneLinkAnker(wurzel);
    assert.deepEqual([...r.anker].sort(), ["docs/andere.md#zwei", "docs/seite.md#ein-abschnitt"]);
    assert.equal(r.links, 3);
  });

  test("außerhalb der Besitz-Spanne, im Code-Fence, ohne Anker, extern, nicht-docs, fehlendes Ziel, ganze Besitz-Datei und nicht verteilte Einheit zählen nicht", () => {
    const wurzel = fixture({
      ".factory/besitz.json": manifest(
        { pfad: "AGENTS.md", block: "kern", ring: "kern" },
        { pfad: "skill.md", ring: "kern" },
        { pfad: "docs/ganz.md", ring: "kern" },
        { pfad: "frei.md", ring: "oberflaeche" },
      ),
      "AGENTS.md": KERN("Im Kern: [x](docs/seite.md) [y](https://example.org/a.md#b) [z](README.md#k) [f](docs/fehlt.md#a) [g](docs/ganz.md#g)") + "Projekt: [p](docs/seite.md#nur-projekt)\n",
      "skill.md": "```\n[c](docs/seite.md#im-fence)\n```\nFrei: [a](docs/ganz.md#ganz)\n",
      "frei.md": "[o](docs/seite.md#nur-fabrik)\n",
      "README.md": "# R\n",
      "docs/seite.md": "# Seite\n",
      "docs/ganz.md": "# Ganz\n",
    });
    assert.deepEqual(scanneLinkAnker(wurzel), { anker: new Set(), links: 0 });
  });

  test("ADR und Datei mit Datum im Namen sind wie in den anderen Regeln ausgenommen", () => {
    const wurzel = fixture({
      ".factory/besitz.json": manifest({ pfad: "docs/adr/0001-x.md", ring: "kern" }, { pfad: "notiz-2026-01-01.md", ring: "kern" }),
      "docs/adr/0001-x.md": "[a](../seite.md#a)\n",
      "notiz-2026-01-01.md": "[a](docs/seite.md#a)\n",
      "docs/seite.md": "# Seite\n",
    });
    assert.deepEqual(scanneLinkAnker(wurzel), { anker: new Set(), links: 0 });
  });

  test("ein neuer Anker ist rot mit dem Weg, ein entfernter Eintrag wird gemeldet, Gleichstand grün (beide Richtungen)", () => {
    const erlaubt = new Set(["docs/a.md#eins", "docs/a.md#alt"]);
    assert.deepEqual(vergleicheAnker(new Set(["docs/a.md#eins", "docs/a.md#alt"]), erlaubt), []);
    assert.deepEqual(vergleicheAnker(new Set(["docs/a.md#eins", "docs/a.md#alt", "docs/b.md#neu"]), erlaubt), [
      "docs/b.md#neu: neuen Anker in kern-link-anker.json aufnehmen und eine `SIH-Bezieher-Migration:`-Zeile schreiben (Bezieher mit eigener Seite brauchen die Überschrift)",
    ]);
    assert.deepEqual(vergleicheAnker(new Set(["docs/a.md#eins"]), erlaubt), ["docs/a.md#alt: kein Besitz-Text setzt diesen Anker mehr, aus kern-link-anker.json streichen"]);
    assert.deepEqual(vergleicheAnker(new Set(["docs/a.md#eins"]), erlaubt, true), [], "Skripte: nur neue Anker zählen (Teilmenge)");
  });

  test("Orakel: die Liste ist sortiert, nur docs-Anker, ohne Doppelte", () => {
    const liste = ladeKernLinkAnker(ROOT);
    assert.deepEqual(liste, [...liste].sort(), "alphabetisch halten");
    assert.ok(liste.every((a) => /^docs\/[^#]+\.md#[^#\s]+$/.test(a)));
    assert.equal(new Set(liste).size, liste.length);
    assert.ok(existsSync(ROOT + ANKERLISTE));
    assert.ok(Array.isArray(JSON.parse(readFileSync(ROOT + ANKERLISTE, "utf8"))));
  });

  test("echtes Repo: Besitz-Text setzt nur Anker der Liste (Gleichstand für .md, Teilmenge für Skripte) und der Scan ist nicht leer", () => {
    const erlaubt = new Set(ladeKernLinkAnker(ROOT));
    const { anker, links } = scanneLinkAnker(ROOT);
    assert.ok(links >= 10, `Scan findet nur ${links} Links: Umfang kaputt (Leerlauf)`);
    assert.ok(scanneLinkAnker(ROOT, /\.(mjs|cjs|js)$/).links > 0, "Skript-Scan findet keine Links: Umfang kaputt (Leerlauf)");
    assert.deepEqual(vergleicheAnker(anker, erlaubt), []);
    assert.deepEqual(vergleicheAnker(scanneLinkAnker(ROOT, /\.(mjs|cjs|js)$/).anker, erlaubt, true), []);
  });

  test("AK3: entfernt man einen Eintrag aus der Liste, meldet der Vergleich ihn (jeder Eintrag einzeln)", () => {
    const erlaubt = ladeKernLinkAnker(ROOT);
    const { anker } = scanneLinkAnker(ROOT);
    for (const weg of erlaubt) {
      const meldungen = vergleicheAnker(anker, new Set(erlaubt.filter((a) => a !== weg)));
      assert.ok(meldungen.some((m) => m.startsWith(`${weg}: `)), `ohne ${weg} bleibt der Vergleich still`);
    }
  });
});
