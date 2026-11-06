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

  test("außerhalb der Besitz-Spanne (Projekt-Teil von AGENTS.md) ist kein Fund", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Kern ohne Kommando.") + "Projekt: `npm run neu`\n",
    });
    assert.deepEqual(scanneKommandos(wurzel).funde, []);
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
