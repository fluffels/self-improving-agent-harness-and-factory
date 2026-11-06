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

/** Alle Verweise aus Besitz-Text, die für einen Bezieher nicht treffen. `wurzel` trägt `.factory/besitz.json`. */
function scanne(wurzel: string): { funde: Fund[]; verweise: number } {
  const lies = (p: string): string | null => {
    const a = join(wurzel, p);
    return existsSync(a) && statSync(a).isFile() ? readFileSync(a, "utf8").replace(/\r/g, "") : null;
  };
  const manifest = JSON.parse(lies(".factory/besitz.json") ?? "{}") as { eintraege: Einheit[] };
  const einheiten = manifest.eintraege.filter(besitz.wirdVerteilt).filter((e) => e.schluessel === undefined);
  const ganzeDateien = new Set(einheiten.filter(besitz.istGanzeDatei).map((e) => e.pfad));
  const agents = lies("AGENTS.md");
  const kernTitel = drift.abschnittTitel(agents === null ? "" : (besitz.einheitText({ pfad: "AGENTS.md", block: "kern" }, agents) ?? ""));
  const funde: Fund[] = [];
  let verweise = 0;
  for (const datei of new Set(einheiten.map((e) => e.pfad))) {
    if (!/\.(md|mjs|cjs|js)$/.test(datei) || /^docs\/adr\//.test(datei) || /\d{4}-\d{2}-\d{2}/.test(datei)) continue;
    const text = lies(datei);
    if (text === null) continue;
    const spannen = besitz.besitzSpannen(einheiten, datei, text);
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

  test("echtes Repo: kein Besitz-Verweis, der für einen Bezieher ins Leere zeigt (und der Scan ist nicht leer)", () => {
    const { funde, verweise } = scanne(ROOT);
    assert.ok(verweise > 20, `Scan extrahiert nur ${verweise} Verweise: Muster oder Umfang kaputt (Leerlauf)`);
    assert.deepEqual(funde, [], `Verweise ohne Treffer in der Bezieher-Sicht:\n${funde.map((f) => `${f.datei} -> ${f.ziel}: ${f.segment}`).join("\n")}`);
  });
});
