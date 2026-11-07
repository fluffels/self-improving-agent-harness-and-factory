/* Bezieher-Sicht auf Abschnittsverweise in Besitz-Text (factory#177, Vor-Tag-Probe; Folge von factory#157).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Regel: Kein Verweis aus verteiltem Besitz-Text darf in einem Bezieher ins Leere zeigen. Ein Abschnittsverweis
 * (`<pfad>.md › A` / `§ A`, Muster 8 von check:docdrift) trifft nur, was ein Bezieher sicher hat:
 *   (i)   Ziel AGENTS.md: nur Titel des Kern-Blocks (der Projekt-Block ist Bezieher-Eigenes).
 *   (ii)  Ziel ist selbst eine ganze Besitz-Datei: kommt unverändert an, übersprungen.
 *   (iii) jedes andere Ziel: nur Überschriften der Fabrik-Seite, deren Anker ein Kern-Link trägt (relativer `.md`-Link aus der
 *         Besitz-Spanne einer verteilten `.md`-Einheit, `kernLinkZiele`). Diese Anker garantieren Anker-Stubs und `stub-anker`
 *         von check:factorylinks; der Rest der Seite (Fettdruck-Anfänge, andere Überschriften) ist im Bezieher nicht garantiert.
 * Alles andere schreibt der Besitz-Text als Fabrik-Verweis `<pfad>.md (Fabrik) › A` (auch `§`): die Regex von check:docdrift
 * erkennt ihn nicht (Pfad, Leerzeichen, Trenner), also prüft der Bezieher ihn nie; in der Fabrik prüft dieser Wächter ihn gegen die
 * VOLLE Seite (Überschriften und Fettdruck-Anfänge), der Drift-Schutz bleibt. Ein Fabrik-Verweis gilt in den Besitz-Spannen aller
 * Manifest-Einheiten, auch im Ring oberflaeche; ein fehlendes Ziel ist ein Fund.
 * Umfang: verteilte Manifest-Einheiten ohne JSON-Schlüssel, Endungen .md/.mjs/.cjs/.js, nur innerhalb der Besitz-Spannen;
 * ADRs und Dateien mit Datum im Namen sind wie im Gate ausgenommen; fehlt das Ziel eines normalen Verweises, bleibt es still
 * (das meldet check:docdrift).
 *
 * Grenzen (geschlossen): nur Muster 8 (andere Verweisarten decken Anker-Stubs bzw. dieser Wächter unten ab; Test-Pfade und `.yml`
 * sind im Bezieher still). Der Ring oberflaeche reist nie in einen Bezieher (ADR 0029): keine strenge Regel, nur die
 * Fabrik-Verweis-Prüfung; liegt dort eine Kopie so einer Datei, ist sie Bezieher-Eigenes (Projekt-Text, Bezieher-Migration).
 * Kern-Links zählen nur aus `.md`-Quellen wie im Sync. Zusätzliche Überschriften auf einer eigenen Bezieher-Seite zählen nicht.
 *
 * Zweite Regel (factory#177): Besitz-Text nennt `npm run <x>` (und `npm test`) nur für die Grundausstattung jedes Beziehers
 * (`BEZIEHER_NPM_SKRIPTE`, geschlossen); alles andere steht als `node scripts/<x>.mjs`, denn ein Bezieher hat das npm-Skript nicht
 * (Fund „Totes Kommando“ von check:docdrift). Umfang: nur .md in verteilten Einheiten, nur Besitz-Spannen; .mjs-Laufzeittexte
 * bewusst nicht. Grenze: ob ein Bezieher ein Skript wirklich hat, sieht nur die Vor-Tag-Probe; die Liste wächst nur zusammen
 * mit einer `SIH-Bezieher-Migration:`-Zeile.
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
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLinks from "../../scripts/factory-links-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMarkdown from "../../scripts/docs-gen/markdown.mjs";
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
  slugify: (text: string) => string;
};
const links = rawLinks as unknown as {
  kernLinkZiele: (o: { besitz: Einheit[]; lies: (p: string) => string | null }) => { quelle: string; zeile: number; ziel: string; anker: string }[];
};
const markdown = rawMarkdown as unknown as { codeMaskiert: (md: string) => string };
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

/** Gemeinsame Ermittlung (Abschnittsverweise und npm-Kommandos): Besitz-Dateien samt Spannen. `wurzel` trägt `.factory/besitz.json`; `alle` nimmt auch nicht verteilte Einheiten (Ring oberflaeche) mit. */
function besitzDateien(wurzel: string, endung: RegExp, alle = false): { lies: (p: string) => string | null; einheiten: Einheit[]; verteilt: Einheit[]; dateien: BesitzDatei[] } {
  const lies = (p: string): string | null => {
    const a = join(wurzel, p);
    return existsSync(a) && statSync(a).isFile() ? readFileSync(a, "utf8").replace(/\r/g, "") : null;
  };
  const manifest = JSON.parse(lies(".factory/besitz.json") ?? "{}") as { eintraege: Einheit[] };
  const verteilt = manifest.eintraege.filter(besitz.wirdVerteilt);
  const einheiten = (alle ? manifest.eintraege : verteilt).filter((e) => e.schluessel === undefined);
  const dateien: BesitzDatei[] = [];
  for (const datei of new Set(einheiten.map((e) => e.pfad))) {
    if (!endung.test(datei) || /^docs\/adr\//.test(datei) || /\d{4}-\d{2}-\d{2}/.test(datei)) continue;
    const text = lies(datei);
    if (text !== null) dateien.push({ datei, text, spannen: besitz.besitzSpannen(einheiten, datei, text) });
  }
  return { lies, einheiten, verteilt, dateien };
}

/** Überschriften einer Seite (außerhalb von Fences) als `{ slug, zeile }`; Slugs wie GitHub (`-1` bei Duplikaten). */
function ueberschriften(md: string): { slug: string; zeile: string }[] {
  const gesehen = new Map<string, number>();
  return drift
    .stripFencedCode(md)
    .split("\n")
    .filter((z) => /^#{1,6}\s+.*\S\s*$/.test(z))
    .map((m) => {
      const basis = drift.slugify(m.replace(/^#{1,6}\s+/, ""));
      const n = gesehen.get(basis) ?? 0;
      gesehen.set(basis, n + 1);
      return { slug: n === 0 ? basis : `${basis}-${n}`, zeile: m };
    });
}

/** Alle Verweise aus Besitz-Text, die für einen Bezieher nicht treffen (Regeln (i)–(iii) im Kopfkommentar). `wurzel` trägt `.factory/besitz.json`. */
function scanne(wurzel: string): { funde: Fund[]; verweise: number } {
  const { lies, einheiten, verteilt, dateien } = besitzDateien(wurzel, /\.(md|mjs|cjs|js)$/);
  const ganzeDateien = new Set(einheiten.filter(besitz.istGanzeDatei).map((e) => e.pfad));
  const agents = lies("AGENTS.md");
  const kernTitel = drift.abschnittTitel(agents === null ? "" : (besitz.einheitText({ pfad: "AGENTS.md", block: "kern" }, agents) ?? ""));
  const kernAnker = new Map<string, Set<string>>();
  for (const k of links.kernLinkZiele({ besitz: verteilt, lies })) kernAnker.set(k.ziel, (kernAnker.get(k.ziel) ?? new Set<string>()).add(k.anker));
  const funde: Fund[] = [];
  let verweise = 0;
  for (const { datei, text, spannen } of dateien) {
    for (const v of drift.abschnittVerweise(text, { istMarkdown: datei.endsWith(".md") })) {
      if (!spannen.some(([a, b]) => v.index >= a && v.index <= b)) continue;
      const ziel = [v.pfad, posix.join(posix.dirname(datei), v.pfad)].find((p) => lies(p) !== null);
      if (ziel === undefined || (ziel !== "AGENTS.md" && ganzeDateien.has(ziel))) continue;
      verweise++;
      const garantiert = kernAnker.get(ziel) ?? new Set<string>();
      const titel =
        ziel === "AGENTS.md"
          ? kernTitel
          : drift.abschnittTitel(
              ueberschriften(lies(ziel) ?? "")
                .filter((h) => garantiert.has(h.slug))
                .map((h) => h.zeile)
                .join("\n"),
            );
      const tot = v.segmente.find((s) => !drift.abschnittTrifft(s, titel));
      if (tot !== undefined) funde.push({ datei, ziel, segment: tot });
    }
  }
  return { funde, verweise };
}

/** Fabrik-Verweis `<pfad>.md (Fabrik) › A`: Kopie von ABSCHNITT_VERWEIS in check-docdrift.mjs mit ` (Fabrik)` zwischen Pfad und Trenner (die Gate-Regex erkennt ihn darum nie). */
const FABRIK_VERWEIS = /(?<![\w./-])([\w./-]*\w\.md) \(Fabrik\) (›|§) ?([^\n`"“”„\]|]*)/g;

/** Fabrik-Verweise in Besitz-Spannen aller Manifest-Einheiten (auch Ring oberflaeche), geprüft gegen die VOLLE Fabrik-Seite (Überschriften und Fettdruck-Anfänge). Fehlt die Seite, ist das ein Fund. */
function scanneFabrik(wurzel: string): { funde: Fund[]; verweise: number } {
  const { lies, dateien } = besitzDateien(wurzel, /\.(md|mjs|cjs|js)$/, true);
  const funde: Fund[] = [];
  let verweise = 0;
  for (const { datei, text, spannen } of dateien) {
    const md = datei.endsWith(".md");
    const quelle = md ? markdown.codeMaskiert(text) : text;
    for (const m of quelle.matchAll(FABRIK_VERWEIS)) {
      if (!spannen.some(([a, b]) => m.index >= a && m.index <= b)) continue;
      verweise++;
      const start = m.index + m[0].length - m[3].length;
      const roh = md ? text.slice(start, start + m[3].length).split("`")[0] : m[3];
      const segmente = roh
        .split(" › ")
        .map((s) => s.trim())
        .filter((s) => s !== "" && !s.startsWith("<"));
      const ziel = [m[1], posix.join(posix.dirname(datei), m[1])].find((p) => lies(p) !== null);
      if (ziel === undefined) {
        funde.push({ datei, ziel: `${m[1]} (fehlt)`, segment: segmente[0] ?? "" });
        continue;
      }
      const titel = drift.abschnittTitel(lies(ziel) ?? "");
      const tot = segmente.find((s) => !drift.abschnittTrifft(s, titel));
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
      "skill.md": "Siehe docs/seite.md › Fetter Abschnitt\nund docs/seite.md › Echte Überschrift\nKern: [x](docs/seite.md#echte-überschrift)\n",
      "docs/seite.md": "# Seite\n\n## Echte Überschrift\n\n**Fetter Abschnitt** Text.\n",
    });
    const { funde } = scanne(wurzel);
    assert.deepEqual(funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Fetter Abschnitt" }]);
  });

  const SEITE = "# Seite\n\n## Echte Überschrift\n\n## Andere\n";

  test("eine Überschrift ohne Kern-Anker ist rot, mit Kern-Link auf ihren Anker grün", () => {
    const ohne = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Siehe docs/seite.md › Echte Überschrift\n",
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(scanne(ohne).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Echte Überschrift" }]);
    const mit = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Siehe docs/seite.md › Echte Überschrift\n[x](docs/seite.md#echte-überschrift)\n",
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(scanne(mit).funde, []);
  });

  test("der Kern-Link garantiert nur seinen Anker, nicht die Nachbar-Überschrift", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Siehe docs/seite.md › Andere\n[x](docs/seite.md#echte-überschrift)\n",
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(scanne(wurzel).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Andere" }]);
  });

  test("ein Kern-Link nur aus .mjs-Text gibt keine Garantie (der Sync verlinkt nur .md-Quellen)", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "scripts/x.mjs", ring: "kern" }]),
      "scripts/x.mjs": "// siehe docs/seite.md › Echte Überschrift\n// [x](docs/seite.md#echte-überschrift)\n",
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(scanne(wurzel).funde, [{ datei: "scripts/x.mjs", ziel: "docs/seite.md", segment: "Echte Überschrift" }]);
  });

  test("ein Kern-Link außerhalb der Block-Spanne gibt keine Garantie", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "AGENTS.md", block: "kern", ring: "kern" }]),
      "AGENTS.md": KERN("Siehe docs/seite.md › Echte Überschrift.") + "Projekt: [x](docs/seite.md#echte-überschrift)\n",
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(scanne(wurzel).funde, [{ datei: "AGENTS.md", ziel: "docs/seite.md", segment: "Echte Überschrift." }]);
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

  test("ein Kern-Link aus einer nicht verteilten Einheit (Ring oberflaeche) gibt keine Garantie", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([
        { pfad: "skill.md", ring: "kern" },
        { pfad: "ober.md", ring: "oberflaeche" },
      ]),
      "skill.md": "Siehe docs/seite.md › Echte Überschrift\n",
      "ober.md": "[x](docs/seite.md#echte-überschrift)\n",
      "docs/seite.md": SEITE,
    });
    assert.deepEqual(scanne(wurzel).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Echte Überschrift" }]);
  });

  test("doppelte Überschriften: der Kern-Link auf #foo-1 garantiert die zweite, #foo-2 gibt es nicht", () => {
    const seite = "# S\n\n## Foo\n\n## Foo\n";
    const mit = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Siehe docs/seite.md › Foo\n[x](docs/seite.md#foo-1)\n",
      "docs/seite.md": seite,
    });
    assert.deepEqual(scanne(mit).funde, []);
    const ohne = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "skill.md", ring: "kern" }]),
      "skill.md": "Siehe docs/seite.md › Foo\n[x](docs/seite.md#foo-2)\n",
      "docs/seite.md": seite,
    });
    assert.deepEqual(scanne(ohne).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Foo" }]);
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

describe("Fabrik-Verweise `<pfad>.md (Fabrik) › A` in Besitz-Text", () => {
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

  test("ein Abschnitt, den die Fabrik-Seite nicht trägt, ist rot", () => {
    const wurzel = fabrik("kern", "Siehe docs/seite.md (Fabrik) › Gibt es nicht\n");
    assert.deepEqual(scanneFabrik(wurzel).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
  });

  test("fehlt die Fabrik-Seite, ist das ein Fund", () => {
    const wurzel = fabrik("kern", "Siehe docs/fehlt.md (Fabrik) › Irgendwas\n", null);
    assert.deepEqual(scanneFabrik(wurzel).funde, [{ datei: "skill.md", ziel: "docs/fehlt.md (fehlt)", segment: "Irgendwas" }]);
  });

  test("Ring oberflaeche: ein normaler Verweis ist kein Fund (reist nie), der Fabrik-Verweis wird geprüft", () => {
    const normal = fabrik("oberflaeche", "Siehe docs/seite.md › Fetter Abschnitt\n");
    assert.deepEqual(scanne(normal), { funde: [], verweise: 0 });
    assert.deepEqual(scanneFabrik(normal), { funde: [], verweise: 0 });
    const wurzel = fabrik("oberflaeche", "Siehe docs/seite.md (Fabrik) › Gibt es nicht\n");
    assert.deepEqual(scanneFabrik(wurzel).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
  });

  test("Kette: jedes Segment wird geprüft, der Fund nennt das tote Segment", () => {
    assert.deepEqual(scanneFabrik(fabrik("kern", "Siehe docs/seite.md (Fabrik) › Echte Überschrift › Fetter Abschnitt\n")), { funde: [], verweise: 1 });
    const rot = fabrik("kern", "Siehe docs/seite.md (Fabrik) › Echte Überschrift › Gibt es nicht\n");
    assert.deepEqual(scanneFabrik(rot).funde, [{ datei: "skill.md", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
  });

  test("ein Platzhalter-Segment (`<…>`) ist kein Fund", () => {
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

  test("Skriptdatei (.mjs): ein Fabrik-Verweis in Backticks wird nicht maskiert, sondern geprüft", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: "scripts/x.mjs", ring: "kern" }]),
      "scripts/x.mjs": "// siehe `docs/seite.md (Fabrik) › Gibt es nicht`\n",
      "docs/seite.md": SEITE_FETT,
    });
    assert.deepEqual(scanneFabrik(wurzel).funde, [{ datei: "scripts/x.mjs", ziel: "docs/seite.md", segment: "Gibt es nicht" }]);
  });

  test("ein Ziel relativ zur verweisenden Datei wird aufgelöst (nicht als fehlend gemeldet)", () => {
    const wurzel = fixture({
      ".factory/besitz.json": MANIFEST([{ pfad: ".agents/skills/x/SKILL.md", ring: "kern" }]),
      ".agents/skills/x/SKILL.md": "Siehe seite.md (Fabrik) › Gibt es nicht\n",
      ".agents/skills/x/seite.md": SEITE_FETT,
    });
    assert.deepEqual(scanneFabrik(wurzel).funde, [{ datei: ".agents/skills/x/SKILL.md", ziel: ".agents/skills/x/seite.md", segment: "Gibt es nicht" }]);
  });

  test("Vertrag: check:docdrift erkennt die Fabrik-Form nicht (kein Verweis, der Bezieher prüft sie nie)", () => {
    assert.deepEqual(drift.abschnittVerweise("docs/x.md (Fabrik) › A", { istMarkdown: false }), []);
    assert.deepEqual(drift.abschnittVerweise("docs/x.md (Fabrik) § A", { istMarkdown: true }), []);
  });

  test("echtes Repo: Fabrik-Verweise treffen alle (und der Scan ist nicht leer)", () => {
    const { funde, verweise } = scanneFabrik(ROOT);
    assert.ok(verweise >= 15, `Scan extrahiert nur ${verweise} Fabrik-Verweise: Muster oder Umfang kaputt (Leerlauf)`);
    assert.deepEqual(funde, [], `Fabrik-Verweise ohne Treffer in der Fabrik-Seite:\n${funde.map((f) => `${f.datei} -> ${f.ziel}: ${f.segment}`).join("\n")}`);
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
