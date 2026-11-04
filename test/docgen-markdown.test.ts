/* Helfer `mermaidText` und `ganzzahlKonstante` der Doku-Generatoren (#1370). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as md from "../scripts/docs-gen/markdown.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ketten from "../scripts/docs-gen/npm-ketten.mjs";

const api = md as unknown as {
  cell: (v: unknown) => string;
  renderTable: (header: string[], rows: string[][]) => string;
  mermaidText: (s: string) => string;
  ganzzahlKonstante: (root: string, datei: string, name: string) => string;
};

describe("mermaidText", () => {
  test("escaped #, &, Anführungszeichen, < und > als Entity-Codes", () => {
    assert.equal(api.mermaidText('a#b&c"d<e>f'), "a#35;b#amp;c#quot;d#lt;e#gt;f");
  });
  test("# wird zuerst ersetzt: erzeugte Entity-Codes werden nicht doppelt escaped", () => {
    assert.equal(api.mermaidText("&"), "#amp;");
    assert.ok(!api.mermaidText('"').includes("#35;"));
  });
  test("Zeilenumbrüche werden zu Leerzeichen, harmloser Text bleibt gleich", () => {
    assert.equal(api.mermaidText("a\r\nb"), "a b");
    assert.equal(api.mermaidText("Docker – Ö?"), "Docker – Ö?");
  });
});

describe("cell", () => {
  test("escaped | und Zeilenumbrüche; Backslashes bleiben literal (Code-Spans, #1663 H6)", () => {
    assert.equal(api.cell("a|b\nc"), "a\\|b c");
    assert.equal(api.cell("`a\\b`"), "`a\\b`");
  });

  // GFM-Teilung einer Tabellenzeile: `\|` ist stets eine maskierte Pipe (auch hinter einem Backslash, belegt per GitHub-Markdown-API:
  // `a\\|b` in einer Zelle bleibt EINE Zelle), jede andere `|` trennt. Rückwandeln `\|` -> `|` liefert den Zelleninhalt.
  const gfmZellen = (zeile: string): string[] => {
    const zellen: string[] = [""];
    const innen = zeile.slice(2, -2);
    for (let i = 0; i < innen.length; i++) {
      if (innen[i] === "\\" && innen[i + 1] === "|") {
        zellen[zellen.length - 1] += "|";
        i++;
      } else if (innen[i] === "|") zellen.push("");
      else zellen[zellen.length - 1] += innen[i];
    }
    return zellen.map((z) => z.trim());
  };
  for (const wert of ["a|b", "a\\|b", "a\\", "\\", "`x|y`", "|", "||"]) {
    test(`renderTable erzeugt für ${JSON.stringify(wert)} genau zwei Datenzellen, der Inhalt bleibt erhalten`, () => {
      const zeilen = api.renderTable(["h1", "h2"], [[wert, "z"]]).split("\n");
      assert.deepEqual(gfmZellen(zeilen[2]), [wert.trim(), "z"]);
    });
  }
});

describe("ganzzahlKonstante", () => {
  const f = (inhalt: string) => fixture({ "k.ts": inhalt });
  test("liest export const und const mit Semikolon oder Kommentar", () => {
    assert.equal(api.ganzzahlKonstante(f("export const MAX_X = 7;\n"), "k.ts", "MAX_X"), "7");
    assert.equal(api.ganzzahlKonstante(f("const MAX_X = 12 // Notiz\n"), "k.ts", "MAX_X"), "12");
  });
  test("wirft bei fehlender Datei, fehlender, doppelter oder nicht-literaler Konstante", () => {
    assert.throws(() => api.ganzzahlKonstante(f(""), "weg.ts", "MAX_X"), /weg\.ts nicht gefunden/);
    assert.throws(() => api.ganzzahlKonstante(f("const ANDERE = 1;\n"), "k.ts", "MAX_X"), /MAX_X fehlt in k\.ts/);
    assert.throws(() => api.ganzzahlKonstante(f("const MAX_X = 1;\nconst MAX_X = 2;\n"), "k.ts", "MAX_X"), /steht mehrfach/);
    assert.throws(() => api.ganzzahlKonstante(f("const MAX_X = 1 + 2;\n"), "k.ts", "MAX_X"), /kein Ganzzahl-Literal/);
  });
  test("Namen mit Regex-Sonderzeichen werden wörtlich genommen", () => {
    assert.throws(() => api.ganzzahlKonstante(f("const MAXAX = 1;\n"), "k.ts", "MAX.X"), /fehlt/);
  });
});

describe("leseJson (#1411)", () => {
  const leseJson = (md as unknown as { leseJson: (root: string, rel: string, was: string) => unknown }).leseJson;
  test("liest relativ und absolut", () => {
    const root = fixture({ "a.json": '{"x":1}' });
    assert.deepEqual(leseJson(root, "a.json", "Datei"), { x: 1 });
    assert.deepEqual(leseJson("/gibt/es/nicht", join(root, "a.json"), "Datei"), { x: 1 });
  });
  test("fehlende Datei und kaputtes JSON werfen mit sprechender Meldung", () => {
    const root = fixture({ "kaputt.json": "{ x" });
    assert.throws(() => leseJson(root, "weg.json", "Config"), /Config weg\.json nicht gefunden/);
    assert.throws(() => leseJson(root, "kaputt.json", "Config"), /kaputt\.json ist kein gültiges JSON/);
    assert.throws(() => leseJson(root, join(root, "kaputt.json"), "Config"), /kein gültiges JSON/);
  });
});

describe("kettenSchritte (#1411)", () => {
  const kettenSchritte = (ketten as unknown as { kettenSchritte: (s: Record<string, string>, c: string[], k: string) => string[] }).kettenSchritte;
  test("löst verschachtelte Ketten auf und zählt je Schritt einmal", () => {
    const scripts = { verify: "npm run a && npm run b && npm test && npm run a", b: "npm run c && npm run d" };
    assert.deepEqual(kettenSchritte(scripts, ["verify"], "verify"), ["a", "c", "d", "test"]);
  });
  test("Kettennamen aus `chains` werden weder aufgelöst noch als Schritt gezählt", () => {
    assert.deepEqual(kettenSchritte({ verify: "npm run a", full: "npm run verify && npm run z" }, ["verify", "full"], "full"), ["z"]);
  });
});

describe("pruefeMermaid: Größenwächter (#1411)", () => {
  const m = md as unknown as { pruefeMermaid: (t: string, was?: string) => void; mermaidBloecke: (t: string) => string[] };
  const front = "---\nconfig:\n  theme: base\n---\n";
  const kanten = (n: number) => Array.from({ length: n }, (_, i) => `  a${i} --> b${i}`).join("\n");
  test("Zeichengrenze 50_000 gilt, 50_001 wirft", () => {
    const rumpf = "sequenceDiagram\n";
    m.pruefeMermaid(rumpf + "x".repeat(50_000 - rumpf.length));
    assert.throws(() => m.pruefeMermaid(rumpf + "x".repeat(50_001 - rumpf.length)), /50001 Zeichen/);
  });
  test("Kantengrenze 500 gilt, 501 wirft (flowchart und graph)", () => {
    m.pruefeMermaid(`flowchart TB\n${kanten(500)}`);
    assert.throws(() => m.pruefeMermaid(`flowchart TB\n${kanten(501)}`), /501 Kanten/);
    assert.throws(() => m.pruefeMermaid(`graph LR\n${kanten(501)}`), /501 Kanten/);
  });
  test("`--!>` zählt als Kante (fail-closed): 501 davon werfen, 500 nicht (#1663 T6)", () => {
    const bang = (n: number) => Array.from({ length: n }, (_, i) => `  a${i} --!> b${i}`).join("\n");
    m.pruefeMermaid(`flowchart TB\n${bang(500)}`);
    assert.throws(() => m.pruefeMermaid(`flowchart TB\n${bang(501)}`), /501 Kanten/);
  });
  test("alle Link-Enden zählen, auch gepunktet, dick und ohne Pfeil", () => {
    const sieben = ["a --> b", "a ==> b", "a .-> b", "a --- b", "a === b", "a -.- b", "a ~~~ b", "a --x b", "a --o b"].join("\n");
    assert.throws(() => m.pruefeMermaid(`flowchart TB\n${sieben}\n${kanten(492)}`), /501 Kanten/);
    m.pruefeMermaid(`flowchart TB\n${sieben}\n${kanten(491)}`);
  });
  test("das --- des Frontmatters zählt nicht; andere Diagrammarten werden nicht nach Kanten gezählt", () => {
    m.pruefeMermaid(`${front}flowchart TB\n${kanten(500)}`);
    assert.throws(() => m.pruefeMermaid(`${front}flowchart TB\n${kanten(501)}`), /501 Kanten/);
    m.pruefeMermaid(`sequenceDiagram\n${kanten(900)}`);
  });
  test("mermaidBloecke liefert nur geschlossene mermaid-Fences", () => {
    assert.deepEqual(m.mermaidBloecke("x\n```mermaid\nflowchart TB\n```\n```ts\nlet a;\n```\n```mermaid\noffen"), ["flowchart TB"]);
  });
});

// Externe Link-Stellen, Code-Maske und Schnappschuss-Marker (factory#130).
const ext = md as unknown as {
  codeMaskiert: (s: string) => string;
  externeLinkStellen: (s: string) => { start: number; ende: number; url: string }[];
  linkStellen: (s: string) => { start: number; ende: number }[];
  SCHNAPPSCHUSS_START: string;
  SCHNAPPSCHUSS_ENDE: string;
  schnappschussBloecke: (z: string[]) => { bloecke: [number, number][]; fehler: { zeile: number; art: string }[] };
};

describe("codeMaskiert (factory#130)", () => {
  test("behält die Länge und die Zeilenumbrüche, auch bei CRLF, Fence und Inline-Code", () => {
    const text = ["a `x` b", "```", "[l](u)", "```", "ende"].join("\r\n");
    const m = ext.codeMaskiert(text);
    assert.equal(m.length, text.length);
    assert.equal(m.split("\r\n").length, 5);
    assert.ok(!m.includes("[l]") && !m.includes("`x`"));
    assert.ok(m.includes("ende"));
  });
});

describe("externeLinkStellen (factory#130)", () => {
  test("Inline-Link, Bild, spitze Klammern mit Leerzeichen und Autolink; die Spanne ist die URL im Original", () => {
    const text = "[a](https://x.de/a) ![b](https://x.de/b.png) [c](<https://x.de/c d>) <https://x.de/e>";
    const s = ext.externeLinkStellen(text);
    assert.deepEqual(
      s.map((x) => x.url),
      ["https://x.de/a", "https://x.de/b.png", "https://x.de/c d", "https://x.de/e"],
    );
    for (const x of s) assert.equal(text.slice(x.start, x.ende), x.url);
  });
  test("`[t](<url>)` zählt einmal, nicht zusätzlich als Autolink", () => {
    assert.equal(ext.externeLinkStellen("[t](<https://x.de/y>)").length, 1);
  });
  test("ein Autolink direkt hinter einem Inline-Link bleibt erhalten, die Liste ist nach Position sortiert", () => {
    const text = "[a](https://x/a)<https://x/b> <https://x/c> [d](https://x/d)";
    assert.deepEqual(
      ext.externeLinkStellen(text).map((x) => x.url),
      ["https://x/a", "https://x/b", "https://x/c", "https://x/d"],
    );
  });
  test("Code-Fences und Inline-Code zählen nicht, relative Ziele fehlen", () => {
    const text = ["```", "[a](https://x.de/fence)", "```", "`[b](https://x.de/inline)` [c](rel.md) [d](https://x.de/echt)"].join("\n");
    assert.deepEqual(
      ext.externeLinkStellen(text).map((x) => x.url),
      ["https://x.de/echt"],
    );
  });
  test("Aufteilung: jeder Inline-Link steht in genau einer der beiden Listen (intern: linkStellen, extern: externeLinkStellen)", () => {
    const text = "[i](a.md) [e](https://x.de) [m](mailto:a@b.de) [p](//cdn/x) ![b](b.png) [s](<c d.md>)";
    const intern = ext.linkStellen(text).length;
    const extern = ext.externeLinkStellen(text).length;
    assert.equal(intern, 3);
    assert.equal(extern, 3, "https, mailto und protokoll-relativ sind die externen Ziele");
  });
});

describe("Schnappschuss-Marker (factory#130)", () => {
  test("sind die Kern-Konstanten", () => {
    assert.equal(ext.SCHNAPPSCHUSS_START, "<!-- schnappschuss:start -->");
    assert.equal(ext.SCHNAPPSCHUSS_ENDE, "<!-- schnappschuss:ende -->");
  });
});

describe("schnappschussBloecke (eine Auslegung für beide Wächter)", () => {
  const S = ext.SCHNAPPSCHUSS_START;
  const E = ext.SCHNAPPSCHUSS_ENDE;
  const lauf = (...z: string[]) => ext.schnappschussBloecke(z);
  test("geschlossene Blöcke, Marker getrimmt", () => {
    assert.deepEqual(lauf("a", `  ${S} `, "x", E, "b", S, E), { bloecke: [[1, 3], [5, 6]], fehler: [] });
  });
  test("Marker nur allein auf der Zeile", () => {
    assert.deepEqual(lauf(`Text ${S}`, E), { bloecke: [], fehler: [{ zeile: 1, art: "ende-ohne-start" }] });
  });
  test("verschachtelt: der zweite Start ist der Fund, der Block bleibt der erste", () => {
    assert.deepEqual(lauf(S, S, E), { bloecke: [[0, 2]], fehler: [{ zeile: 1, art: "verschachtelt" }] });
  });
  test("Ende ohne Start", () => {
    assert.deepEqual(lauf(S, E, E), { bloecke: [[0, 1]], fehler: [{ zeile: 2, art: "ende-ohne-start" }] });
  });
  test("Start ohne Ende: Fund auf der Start-Zeile, kein Block", () => {
    assert.deepEqual(lauf("a", S, "b"), { bloecke: [], fehler: [{ zeile: 1, art: "ohne-ende" }] });
  });
});
