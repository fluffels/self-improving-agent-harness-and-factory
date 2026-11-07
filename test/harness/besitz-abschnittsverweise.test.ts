/* Bezieher-Sicht auf Abschnittsverweise in Besitz-Text (factory#177, Vor-Tag-Probe; Folge von factory#157).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Regel: Ein Abschnittsverweis (`<pfad>.md › A` / `§ A`, Muster 8 von check:docdrift) in verteiltem Besitz-Text muss so treffen,
 * wie ein Bezieher ihn sieht. check:docdrift prüft in der Fabrik gegen die VOLLE Seite und lässt dort auch Fettdruck-Anfänge
 * als Abschnitt gelten; im Bezieher ersetzt ein Anker-Stub (nur Überschriften) die Seite, und AGENTS.md trägt nur den Kern-Block.
 * Ein Verweis auf einen Fettdruck-Abschnitt war in der Fabrik grün und im Bezieher tot (drei Funde der ersten Vor-Tag-Probe).
 *   (i)   Ziel AGENTS.md: der Verweis trifft nur gegen Abschnitts-Titel des Kern-Blocks.
 *   (ii)  Ziel ist selbst eine ganze Besitz-Datei: kommt unverändert an, übersprungen.
 *   (iii) jedes andere Ziel: der Verweis trifft nur gegen Überschriften (kein Fettdruck-Anfang) der Fabrik-Seite.
 * Umfang: verteilte Manifest-Einheiten ohne JSON-Schlüssel, Endungen .md/.mjs/.cjs/.js, nur innerhalb der Besitz-Spannen;
 * ADRs und Dateien mit Datum im Namen sind wie im Gate ausgenommen; fehlt das Ziel, bleibt es still (das meldet check:docdrift).
 *
 * Grenze (bewusst): geprüft wird gegen die Überschriften der Fabrik-Seite. Eine Überschrift, die die Fabrik-Seite trägt, die
 * Projektanteil-Seite eines Beziehers aber nicht, sieht nur die Vor-Tag-Probe. Die strenge Form („nur Überschriften, deren Anker der
 * Kern verlinkt") hätte heute 21 Funde und steht als Zeile im Sammelticket.
 *
 * Zweite Regel (factory#177): Besitz-Text nennt `npm run <x>` (und `npm test`) nur für die Grundausstattung jedes Beziehers
 * (`BEZIEHER_NPM_SKRIPTE`, geschlossen); alles andere steht als `node scripts/<x>.mjs`, denn ein Bezieher hat das npm-Skript nicht
 * (Fund „Totes Kommando“ von check:docdrift). Umfang: nur .md in verteilten Einheiten, nur Besitz-Spannen; .mjs-Laufzeittexte
 * bewusst nicht. Grenze: ob ein Bezieher ein Skript wirklich hat, sieht nur die Vor-Tag-Probe; die Liste wächst nur zusammen
 * mit einer `SIH-Bezieher-Migration:`-Zeile.
 *
 * Dritte Regel (factory#220 L34): Link-Anker `docs/<x>.md#<anker>` in Besitz-Spannen verteilter `.md`-Einheiten auf eine Fabrik-Seite, die
 * nicht als ganze Datei verteilt wird, stehen in der geschlossenen Liste `KERN_LINK_ANKER` (neu: rot mit Weg; veraltet: rot). Ein Bezieher
 * mit eigener Seite braucht dort die Überschrift; die Liste wächst nur zusammen mit einer `SIH-Bezieher-Migration:`-Zeile und wandert ab 60
 * Ankern als JSON neben den Test (`test/harness/kern-link-anker.json`, gleiche Regel). Grenze (bewusst): ob die Bezieher-Seite die
 * Überschrift wirklich trägt, sieht nur die Vor-Tag-Probe; verlinkt wird nur über `[…](docs/<x>.md#<anker>)`, Verweise ohne Anker und
 * Ziele außerhalb von `docs/` bleiben unerfasst.
 *
 * Ausführen mit:  npm test
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../../scripts/check-docdrift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { fixture } from "../support/tmp-fixture";

interface Verweis {
  pfad: string;
  trenner: string;
  segmente: string[];
  index: number;
}
interface Einheit {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring?: string;
}
const drift = rawDrift as unknown as {
  abschnittVerweise: (text: string, o: { istMarkdown: boolean }) => Verweis[];
  abschnittTitel: (md: string) => string[][];
  abschnittTrifft: (segment: string, titel: string[][]) => boolean;
  stripFencedCode: (md: string) => string;
  parseNpmRunMentions: (md: string) => Set<string>;
  linkStellen: (md: string) => { start: number; path: string; anchor: string }[];
  linkZiel: (datei: string, pfad: string) => string;
};
const besitz = rawBesitz as unknown as {
  besitzSpannen: (einheiten: Einheit[], pfad: string, text: string) => [number, number][];
  einheitText: (e: { pfad: string; block?: string }, text: string) => string | null;
  wirdVerteilt: (e: Einheit) => boolean;
  istGanzeDatei: (e: Einheit) => boolean;
};

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

interface Fund {
  datei: string;
  ziel: string;
  segment: string;
}

interface BesitzDatei {
  datei: string;
  text: string;
  spannen: [number, number][];
}

/** Gemeinsame Ermittlung (Abschnittsverweise und npm-Kommandos): verteilte Besitz-Dateien samt Spannen. `wurzel` trägt `.factory/besitz.json`. */
function besitzDateien(wurzel: string, endung: RegExp): { lies: (p: string) => string | null; einheiten: Einheit[]; dateien: BesitzDatei[] } {
  const lies = (p: string): string | null => {
    const a = join(wurzel, p);
    return existsSync(a) && statSync(a).isFile() ? readFileSync(a, "utf8").replace(/\r/g, "") : null;
  };
  const manifest = JSON.parse(lies(".factory/besitz.json") ?? "{}") as { eintraege: Einheit[] };
  const einheiten = manifest.eintraege.filter(besitz.wirdVerteilt).filter((e) => e.schluessel === undefined);
  const dateien: BesitzDatei[] = [];
  for (const datei of new Set(einheiten.map((e) => e.pfad))) {
    if (!endung.test(datei) || /^docs\/adr\//.test(datei) || /\d{4}-\d{2}-\d{2}/.test(datei)) continue;
    const text = lies(datei);
    if (text !== null) dateien.push({ datei, text, spannen: besitz.besitzSpannen(einheiten, datei, text) });
  }
  return { lies, einheiten, dateien };
}

/** Alle Verweise aus Besitz-Text, die für einen Bezieher nicht treffen. `wurzel` trägt `.factory/besitz.json`. */
function scanne(wurzel: string): { funde: Fund[]; verweise: number } {
  const { lies, einheiten, dateien } = besitzDateien(wurzel, /\.(md|mjs|cjs|js)$/);
  const ganzeDateien = new Set(einheiten.filter(besitz.istGanzeDatei).map((e) => e.pfad));
  const agents = lies("AGENTS.md");
  const kernTitel = drift.abschnittTitel(agents === null ? "" : (besitz.einheitText({ pfad: "AGENTS.md", block: "kern" }, agents) ?? ""));
  const funde: Fund[] = [];
  let verweise = 0;
  for (const { datei, text, spannen } of dateien) {
    for (const v of drift.abschnittVerweise(text, { istMarkdown: datei.endsWith(".md") })) {
      if (!spannen.some(([a, b]) => v.index >= a && v.index <= b)) continue;
      const ziel = [v.pfad, posix.join(posix.dirname(datei), v.pfad)].find((p) => lies(p) !== null);
      if (ziel === undefined || (ziel !== "AGENTS.md" && ganzeDateien.has(ziel))) continue;
      verweise++;
      const titel =
        ziel === "AGENTS.md"
          ? kernTitel
          : drift.abschnittTitel(
              drift
                .stripFencedCode(lies(ziel) ?? "")
                .split("\n")
                .flatMap((z) => /^#{1,6}\s+.*\S\s*$/.exec(z) ?? [])
                .join("\n"),
            );
      const tot = v.segmente.find((s) => !drift.abschnittTrifft(s, titel));
      if (tot !== undefined) funde.push({ datei, ziel, segment: tot });
    }
  }
  return { funde, verweise };
}

const MANIFEST = (eintraege: Einheit[]): string => JSON.stringify({ version: 3, eintraege });
const KERN = (inhalt: string): string => `# Kopf\n<!-- factory-besitz:start kern -->\n${inhalt}\n<!-- factory-besitz:ende kern -->\n## Projekt\n`;

describe("Abschnittsverweise in Besitz-Text aus Sicht des Beziehers", () => {
  test("Fettdruck-Ziel ist rot, Überschrift grün (Ziel außerhalb von AGENTS.md)", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Siehe docs/seite.md › Fetter Abschnitt\nund docs/seite.md › Echte Überschrift\n",
      "docs/seite.md": "# Seite\n\n## Echte Überschrift\n\n**Fetter Abschnitt** Text.\n",
    });
    const { funde } = scanne(wurzel);
    assert.deepEqual(funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Fetter Abschnitt" }]);
  });

  test("AGENTS.md: ein Titel nur im Projekt-Block ist rot, im Kern-Block grün", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Nach AGENTS.md § Kern-Regel\nund AGENTS.md § Nur Projekt\n",
      "AGENTS.md": `${KERN("- **Kern-Regel** Text")}- **Nur Projekt** Text\n`,
    });
    const { funde } = scanne(wurzel);
    assert.deepEqual(funde, [{ datei: "skill.md", ziel: "AGENTS.md", segment: "Nur Projekt" }]);
  });

  test("ein Verweis außerhalb der Besitz-Spanne (Block einer Datei) wird ignoriert", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("- **Kern-Regel** Text") + "Projekt: docs/seite.md › Fetter Abschnitt\n",
      "docs/seite.md": "**Fetter Abschnitt** Text.\n",
    });
    assert.deepEqual(scanne(wurzel), { funde: [], verweise: 0 });
  });

  test("ein Verweis innerhalb der Block-Spanne wird gezählt und geprüft", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Siehe docs/seite.md › Fetter Abschnitt."),
      "docs/seite.md": "**Fetter Abschnitt** Text.\n",
    });
    assert.equal(scanne(wurzel).funde.length, 1);
  });

  test("Ziel ist eine ganze Besitz-Datei: Fettdruck-Abschnitt kommt an, grün", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([
        { pfad: "skill.md", ring: "kern" },
        { pfad: "docs/seite.md", ring: "kern" },
      ]),
      "skill.md": "Siehe docs/seite.md › Fetter Abschnitt.\n",
      "docs/seite.md": "**Fetter Abschnitt** Text.\n",
    });
    assert.deepEqual(scanne(wurzel), { funde: [], verweise: 0 });
  });

  test("fehlendes Ziel bleibt still, ADR und Datum im Namen sind ausgenommen", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([
        { pfad: "skill.md", ring: "kern" },
        { pfad: "docs/adr/0001-x.md", ring: "kern" },
        { pfad: "notiz-2026-01-01.md", ring: "kern" },
      ]),
      "skill.md": "Siehe docs/fehlt.md › Irgendwas.\n",
      "docs/adr/0001-x.md": "Siehe docs/seite.md › Fetter Abschnitt.\n",
      "notiz-2026-01-01.md": "Siehe docs/seite.md › Fetter Abschnitt.\n",
      "docs/seite.md": "**Fetter Abschnitt** Text.\n",
    });
    assert.deepEqual(scanne(wurzel), { funde: [], verweise: 0 });
  });

  test("Skriptdatei (.mjs) im Besitz wird gescannt", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "scripts/x.mjs", ring: "kern" }]),
      "scripts/x.mjs": "// siehe docs/seite.md › Fetter Abschnitt\n",
      "docs/seite.md": "**Fetter Abschnitt** Text.\n",
    });
    assert.equal(scanne(wurzel).funde.length, 1);
  });

  test("eine nur in der Fabrik liegende Einheit (Ring oberflaeche, nicht verteilt) wird ignoriert", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "oberflaeche" }]),
      "skill.md": "Siehe docs/seite.md › Fetter Abschnitt\n",
      "docs/seite.md": "**Fetter Abschnitt** Text.\n",
    });
    assert.deepEqual(scanne(wurzel), { funde: [], verweise: 0 });
  });

  test("ein Ziel relativ zur verweisenden Datei wird aufgelöst und geprüft", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: ".agents/skills/x/SKILL.md", ring: "kern" }]),
      ".agents/skills/x/SKILL.md": "Siehe seite.md › Fetter Abschnitt\n",
      ".agents/skills/x/seite.md": "**Fetter Abschnitt** Text.\n",
    });
    assert.deepEqual(scanne(wurzel).funde, [{ datei: ".agents/skills/x/SKILL.md", ziel: ".agents/skills/x/seite.md", segment: "Fetter Abschnitt" }]);
  });

  test("eine Überschrift im Code-Fence der Zielseite ist kein Abschnitt", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Siehe docs/seite.md › Nur im Fence\n",
      "docs/seite.md": "# Seite\n\n```\n## Nur im Fence\n```\n",
    });
    assert.deepEqual(scanne(wurzel).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Nur im Fence" }]);
  });

  test("echtes Repo: kein Besitz-Verweis, der für einen Bezieher ins Leere zeigt (und der Scan ist nicht leer)", () => {
    const { funde, verweise } = scanne(ROOT);
    assert.ok(verweise > 20, `Scan extrahiert nur ${verweise} Verweise: Muster oder Umfang kaputt (Leerlauf)`);
    assert.deepEqual(funde, [], `Verweise ohne Treffer in der Bezieher-Sicht:\n${funde.map((f) => `${f.datei} -> ${f.ziel}: ${f.segment}`).join("\n")}`);
  });
});

/** Skripte, die jedes Bezieher-Repo aus der Grundausstattung hat; nur diese darf Besitz-Text als `npm run <x>` nennen (alles andere: `node scripts/<x>.mjs`). */
const BEZIEHER_NPM_SKRIPTE = new Set(["check:docdrift", "check:docmap", "check:factorydrift", "check:internalrefs", "check:size", "skills:sync"]);

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
    const { funde, erwaehnungen } = scanneKommandos(ROOT);
    assert.ok(erwaehnungen >= 5, `Scan findet nur ${erwaehnungen} Erwähnungen: Umfang kaputt (Leerlauf)`);
    assert.deepEqual(funde, [], `npm-Kommandos, die ein Bezieher nicht hat (stattdessen node scripts/<x>.mjs):\n${funde.map((f) => `${f.name} <- ${f.datei}`).join("\n")}`);
  });
});

/**
 * Geschlossene Liste der Link-Anker (`docs/<x>.md#<anker>`), die verteilter Besitz-Text auf Fabrik-Seiten setzt, die als ganze Datei nicht verteilt werden
 * (factory#220 L34, strenge Form aus factory#177). Ein Bezieher mit eigener Seite braucht dort genau diese Überschrift. Wächter wie `BEZIEHER_NPM_SKRIPTE`;
 * die Liste wächst nur zusammen mit einer `SIH-Bezieher-Migration:`-Zeile und steht bei mehr als 60 Ankern als JSON neben dem Test (`test/harness/kern-link-anker.json`).
 */
const KERN_LINK_ANKER = new Set<string>([
  "docs/agent-harness-faq.md#der-auto-mode-blockt-die-sabotage-probe-der-test-lens-self-modification-was-tun",
  "docs/agent-harness-faq.md#wie-entferne-ich-einen-worktree-unter-windows-sauber-und-was-ist-mit-nodemodules",
  "docs/agent-harness-faq.md#wie-fahre-ich-einen-probe-lauf-und-warte-auf-sein-ergebnis",
  "docs/agent-harness-faq.md#wie-räume-ich-scratch-auf-wenn-befehle-blockiert-werden",
  "docs/agent-harness-faq.md#wie-verifiziere-ich-im-browser",
  "docs/agent-harness-faq.md#windows-und-git-bash-was-geht-beim-skripten-verloren",
  "docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd",
  "docs/agent-harness.md#4-die-sichere-autonomie-schleife",
  "docs/model-routing.md#1-phasen-matrix",
  "docs/model-routing.md#messen",
  "docs/model-routing.md#phasen-schnitt-vertrag-ab-regel-messrezept",
  "docs/model-routing.md#umsetzer-kontext",
  "docs/ticket-reihenfolge.md#am-ticket-ende",
  "docs/ticket-reihenfolge.md#langfuse-befunde-gesammelt",
  "docs/ticket-reihenfolge.md#sammelticket-mechanik",
  "docs/ticket-reihenfolge.md#wiederaufnahme-verwaister-claims",
]);

/** Ab dieser Zahl wandert `KERN_LINK_ANKER` in eine JSON-Datei neben dem Test (gleiche Regel). */
const KERN_LINK_ANKER_MAX_IM_TEST = 60;

const ANKER_MELDUNG = "neuen Anker in KERN_LINK_ANKER aufnehmen und eine `SIH-Bezieher-Migration:`-Zeile schreiben (Bezieher mit eigener Seite brauchen die Überschrift)";

/** Link-Anker `docs/<x>.md#<anker>` in Besitz-Spannen verteilter `.md`-Einheiten, deren Ziel keine ganze Besitz-Datei ist (die kommt mit ihren Überschriften an). */
function scanneLinkAnker(wurzel: string): { anker: Set<string>; links: number } {
  const { lies, einheiten, dateien } = besitzDateien(wurzel, /\.md$/);
  const ganzeDateien = new Set(einheiten.filter(besitz.istGanzeDatei).map((e) => e.pfad));
  const anker = new Set<string>();
  let links = 0;
  for (const { datei, text, spannen } of dateien) {
    for (const l of drift.linkStellen(text)) {
      if (l.anchor === "" || !l.path.endsWith(".md") || !spannen.some(([a, b]) => l.start >= a && l.start <= b)) continue;
      const ziel = drift.linkZiel(datei, l.path);
      if (!ziel.startsWith("docs/") || lies(ziel) === null || ganzeDateien.has(ziel)) continue;
      links++;
      anker.add(`${ziel}#${l.anchor}`);
    }
  }
  return { anker, links };
}

/** Meldungen (leer = grün): neue Anker und Einträge der Liste, die kein Besitz-Text mehr setzt. */
function vergleicheAnker(gefunden: Set<string>, erlaubt: Set<string>): string[] {
  return [
    ...[...gefunden].filter((a) => !erlaubt.has(a)).sort().map((a) => `${a}: ${ANKER_MELDUNG}`),
    ...[...erlaubt].filter((a) => !gefunden.has(a)).sort().map((a) => `${a}: kein Besitz-Text setzt diesen Anker mehr, aus KERN_LINK_ANKER streichen`),
  ];
}

describe("Link-Anker in Besitz-Text auf nicht verteilte Fabrik-Seiten (factory#220 L34)", () => {
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

  test("ein neuer Anker ist rot mit dem Weg, ein veralteter Listeneintrag ist rot, Gleichstand grün", () => {
    const erlaubt = new Set(["docs/a.md#eins", "docs/a.md#alt"]);
    assert.deepEqual(vergleicheAnker(new Set(["docs/a.md#eins", "docs/a.md#alt"]), erlaubt), []);
    assert.deepEqual(vergleicheAnker(new Set(["docs/a.md#eins", "docs/a.md#alt", "docs/b.md#neu"]), erlaubt), [
      "docs/b.md#neu: neuen Anker in KERN_LINK_ANKER aufnehmen und eine `SIH-Bezieher-Migration:`-Zeile schreiben (Bezieher mit eigener Seite brauchen die Überschrift)",
    ]);
    assert.deepEqual(vergleicheAnker(new Set(["docs/a.md#eins"]), erlaubt), ["docs/a.md#alt: kein Besitz-Text setzt diesen Anker mehr, aus KERN_LINK_ANKER streichen"]);
  });

  test("Orakel: die Liste ist sortiert, nur docs-Anker, ohne Doppelte und bleibt im Test, solange sie höchstens 60 Einträge trägt", () => {
    const liste = [...KERN_LINK_ANKER];
    assert.deepEqual(liste, [...liste].sort(), "alphabetisch halten");
    assert.ok(liste.every((a) => /^docs\/[^#]+\.md#[^#\s]+$/.test(a)));
    assert.ok(liste.length <= KERN_LINK_ANKER_MAX_IM_TEST, `mehr als ${KERN_LINK_ANKER_MAX_IM_TEST} Anker: Liste als JSON neben den Test (test/harness/kern-link-anker.json), gleiche Regel`);
  });

  test("echtes Repo: Besitz-Text setzt nur Anker der geschlossenen Liste (und der Scan ist nicht leer)", () => {
    const { anker, links } = scanneLinkAnker(ROOT);
    assert.ok(links >= 10, `Scan findet nur ${links} Links: Umfang kaputt (Leerlauf)`);
    assert.deepEqual(vergleicheAnker(anker, KERN_LINK_ANKER), []);
  });
});
