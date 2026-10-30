/* Guard-Liste (#112): je geänderter Funktion die Anker (Verzweigungs- und Guard-Stellen) der Diff-Zeilen. Kern ist pur; die CLI-Hülle
 * `lauf` bekommt git und Dateizugriff injiziert. Jedes Muster hat einen Positivfall, dazu Negativfälle (Kommentar, String, Vergleichs-Fehlgriffe). */
import { tmpdir } from "node:os";
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ankerRoh from "../scripts/anker-liste.mjs";

type Eintrag = { datei: string; funktion: string; zeile: number; anker: { zeile: number; muster: string }[] };
interface Lauf {
  code: number;
  out: string;
  err: string;
}
interface Umgebung {
  git: (args: string[]) => string;
  lesen: (pfad: string) => string | undefined;
  istQuelle: (pfad: string) => boolean;
}
const ankerListe = ankerRoh as unknown as {
  guardListe: (a: { diffText: string; neueDateien?: { pfad: string; inhalt: string }[]; lies: (pfad: string) => string | undefined; istQuelle: (pfad: string) => boolean }) => Eintrag[];
  formatiere: (e: Eintrag[]) => string;
  lauf: (argv: string[], u: Umgebung) => Lauf;
  echteUmgebung: () => Umgebung;
  MUSTER: { name: string }[];
};
const { guardListe, formatiere, lauf, MUSTER, echteUmgebung } = ankerListe;
const istQuelle = (p: string) => p.startsWith("scripts/") && p.endsWith(".mjs");

/** Eine neue Datei mit allen Zeilen als Diff-Zeilen. */
const neu = (inhalt: string, pfad = "scripts/a.mjs"): Eintrag[] => guardListe({ diffText: "", neueDateien: [{ pfad, inhalt }], lies: () => undefined, istQuelle });
const muster = (zeile: string) => neu(`function f() {\n${zeile}\n}`)[0]?.anker.map((a) => a.muster) ?? [];

describe("guardListe: Musterliste", () => {
  const FAELLE: [string, string][] = [
    ["if", "  if (a) return;"],
    ["if", "  } else if (b) {"],
    ["switch", "  switch (a) {"],
    ["case", "    case 1:"],
    ["ternär", "  const x = a ? 1 : 2;"],
    ["??", "  const x = a ?? 1;"],
    ["??=", "  a ??= 1;"],
    ["?.", "  const x = a?.b;"],
    ["||", "  const x = a || 1;"],
    ["&&", "  const x = a && b;"],
    ["||=", "  a ||= 1;"],
    ["&&=", "  a &&= 1;"],
    ["catch", "  } catch (e) {"],
    ["throw", "  throw new Error(a);"],
    ["Regex-Literal", "  const r = /^a+$/;"],
    ["new RegExp", "  const r = new RegExp(a);"],
    ["<", "  const x = a < b;"],
    ["<=", "  const x = a <= b;"],
    [">", "  const x = a > b;"],
    [">=", "  const x = a >= b;"],
    [".filter(", "  const x = l.filter(g);"],
    [".find(", "  const x = l.find(g);"],
    [".findIndex(", "  const x = l.findIndex(g);"],
    [".some(", "  const x = l.some(g);"],
    [".every(", "  const x = l.every(g);"],
  ];
  test.each(FAELLE)("%s ist ein Anker", (name, zeile) => {
    expect(muster(zeile)).toContain(name);
  });

  test("die Tabelle hat genau die getesteten Muster (neues Muster braucht einen Positivfall)", () => {
    expect([...new Set(MUSTER.map((m) => m.name))].sort()).toEqual([...new Set(FAELLE.map(([n]) => n))].sort());
  });

  test("Default-Parameter im Funktionskopf, auch bei Arrow", () => {
    expect(neu("function f(a, b = 2) {\n}")[0]?.anker.map((a) => a.muster)).toEqual(["Default-Parameter"]);
    expect(neu("const g = (a = 1) => a;")[0]?.anker.map((a) => a.muster)).toEqual(["Default-Parameter"]);
    expect(neu("function f(a, b) {\n}")).toEqual([]);
  });

  test("Negativfälle: Kommentar, Blockkommentar, String, Template, =>, Generics, ===, Optional-Parameter", () => {
    for (const z of [
      "  // if (a) ?? b",
      "  /* a || b */",
      "  * a && b",
      '  const s = "a ?? b || c";',
      "  const s = 'if (x) throw';",
      "  const s = `a ? b : c ${1}`;",
      "  const f = (a) => a;",
      "  const l: Array<string> = [];",
      "  const x = a === b;",
      "  const y = a?: string;",
      "  const h = a // b || c",
      "  const x = a / b;",
    ]) {
      expect(muster(z), z).toEqual([]);
    }
  });

  test("zusammengesetzte Zuweisungen liefern nur ihr eigenes Muster, nicht das der Kurzform", () => {
    expect(muster("  a ??= 1;")).toEqual(["??="]);
    expect(muster("  a ||= 1;")).toEqual(["||="]);
    expect(muster("  a &&= 1;")).toEqual(["&&="]);
    expect(muster("  const x = a ?.5 : 1;")).toEqual([]);
  });

  test("Default-Parameter nur im Funktionskopf und nicht bei ==, !=, <=, >=, =>", () => {
    expect(muster("  g(a = 1);")).toEqual([]);
    expect(neu("function f(a) { return g(a === b && a !== c && a <= d && a >= e); }")[0]?.anker.map((a) => a.muster)).not.toContain("Default-Parameter");
    expect(neu("const g = (a, b) => h(a === b || a !== b);")[0]?.anker.map((a) => a.muster)).not.toContain("Default-Parameter");
  });

  test("Default-Parameter: ungleich (!=) und Zuweisung im Rumpf hinter der Kopfklammer zählen nicht, geschachtelte Klammer im Kopf schon", () => {
    for (const z of ["function f(a) { return g(a != b); }", "function f(a) { x.y = g(a); }", "const f = (a) => { a.b = c(); };", "const s = (o) => (o.x = 1);", "const g = x => y = 1;", "const s = o => (o.x = 1);", "const g = x => h(y = 1);"]) {
      expect(neu(z)[0]?.anker.map((a) => a.muster) ?? [], z).not.toContain("Default-Parameter");
    }
    expect(neu("function f(a = g(1)) {\n}")[0]?.anker.map((a) => a.muster)).toEqual(["Default-Parameter"]);
    // Das `=` steht erst hinter einer inneren Klammer: nur die Tiefenzählung findet es.
    expect(neu("function f(cb: () => void = noop) {\n}")[0]?.anker.map((a) => a.muster)).toEqual(["Default-Parameter"]);
    // Kopf ohne schließende Klammer auf der Zeile (mehrzeilig): der Rest der Zeile zählt.
    expect(neu("function f(a = 1,\n  b) {\n}")[0]?.anker.map((a) => a.muster)).toEqual(["Default-Parameter"]);
  });

  test("ein Regex-Literal am Zeilenanfang verbirgt seine Zeichen ebenfalls", () => {
    expect(muster("  /a?.b|c && d/,")).toEqual(["Regex-Literal"]);
    expect(muster("  /a?.b|c && d/.test(x);")).toEqual(["Regex-Literal"]);
  });

  test("mehrzeiliger Blockkommentar wird übersprungen, der Code danach zählt wieder", () => {
    const r = neu("function f() {\n/*\n a || b\n*/\n  if (x) return;\n}");
    expect(r[0]?.anker).toEqual([{ zeile: 5, muster: "if" }]);
  });

  test("ein Regex-Literal verbirgt seine Zeichen vor den anderen Mustern", () => {
    expect(muster("  const r = /a?.b|c\\s*\\?\\s/;")).toEqual(["Regex-Literal"]);
  });

  test("eine Zeile mit zwei Mustern liefert beide, in Tabellenreihenfolge je Zeile", () => {
    expect(muster("  if (a ?? b) return;")).toEqual(["if", "??"]);
  });
});

describe("guardListe: Auswahl der Zeilen und Dateien", () => {
  const DATEI = "function a() {\n  if (x) return 1;\n  if (y) return 2;\n}\n";
  const diff = (pfad: string, kopf: string) => `diff --git a/${pfad} b/${pfad}\n--- a/${pfad}\n+++ b/${pfad}\n${kopf}\n`;

  test("nur Zeilen der Diff-Hunks zählen, entfernte Zeilen nicht", () => {
    const r = guardListe({ diffText: diff("scripts/a.mjs", "@@ -2,1 +3,0 @@\n@@ -2 +3 @@"), neueDateien: [], lies: () => DATEI, istQuelle });
    expect(r).toEqual([{ datei: "scripts/a.mjs", funktion: "a", zeile: 1, anker: [{ zeile: 3, muster: "if" }] }]);
  });

  test("reine Löschung (+c,0) liefert nichts", () => {
    expect(guardListe({ diffText: diff("scripts/a.mjs", "@@ -2,2 +1,0 @@"), neueDateien: [], lies: () => DATEI, istQuelle })).toEqual([]);
  });

  test("Datei außerhalb der Quelle, Testdatei und nicht lesbare Datei fehlen", () => {
    const gesamt = diff("test/a.test.ts", "@@ -0,0 +1,4 @@") + diff("scripts/weg.mjs", "@@ -0,0 +1,4 @@");
    expect(guardListe({ diffText: gesamt, neueDateien: [{ pfad: "docs/x.mjs", inhalt: DATEI }], lies: () => undefined, istQuelle })).toEqual([]);
  });

  test("Testdatei im Diff fehlt, auch wenn sie lesbar ist und Anker trägt (Quell-Filter, nicht nur Lesbarkeit)", () => {
    expect(guardListe({ diffText: diff("test/a.test.ts", "@@ -0,0 +1,4 @@"), lies: () => DATEI, istQuelle })).toEqual([]);
  });

  test("ohne neueDateien (Default) wird nur der Diff ausgewertet", () => {
    const r = guardListe({ diffText: diff("scripts/a.mjs", "@@ -0,0 +2,1 @@"), lies: () => DATEI, istQuelle });
    expect(r[0]?.anker).toEqual([{ zeile: 2, muster: "if" }]);
  });

  test("nicht lesbare neue Datei (kein Inhalt) fehlt, statt zu werfen", () => {
    const leer = { pfad: "scripts/n.mjs" } as unknown as { pfad: string; inhalt: string };
    expect(guardListe({ diffText: "", neueDateien: [leer], lies: () => undefined, istQuelle })).toEqual([]);
  });

  test("neue ungetrackte Datei: alle Zeilen; Windows-Pfad wird normalisiert", () => {
    const r = guardListe({ diffText: "", neueDateien: [{ pfad: "scripts\\neu.mjs", inhalt: DATEI }], lies: () => undefined, istQuelle });
    expect(r[0]?.datei).toBe("scripts/neu.mjs");
    expect(r[0]?.anker.map((a) => a.zeile)).toEqual([2, 3]);
  });

  test("neue Datei hat Vorrang vor derselben Datei im Diff", () => {
    const r = guardListe({ diffText: diff("scripts/a.mjs", "@@ -0,0 +2,1 @@"), neueDateien: [{ pfad: "scripts/a.mjs", inhalt: DATEI }], lies: () => "if (x) {}", istQuelle });
    expect(r[0]?.anker).toHaveLength(2);
  });
});

describe("guardListe: Funktionszuordnung", () => {
  const ZUORDNUNG = [
    "if (m) {}", // 1 Modulebene
    "function deklariert() {", // 2
    "  if (a) {}", // 3
    "}",
    "export const pfeil = async (a) => {", // 5
    "  if (b) {}", // 6
    "};",
    "const ausdruck = function () {", // 8
    "  if (c) {}", // 9
    "};",
    "class K {", // 11
    "  methode(a) {", // 12
    "    if (d) {}", // 13
    "    const innen = () => {", // 14
    "      if (e) {}", // 15
    "    };",
    "  }",
    "}",
  ].join("\n");

  test("Modulebene, Deklaration, Arrow, Funktionsausdruck, Methode und verschachtelte Funktion", () => {
    const r = neu(ZUORDNUNG);
    expect(r.map((e) => [e.funktion, e.zeile, e.anker.map((a) => a.zeile)])).toEqual([
      ["(Modulebene)", 1, [1]],
      ["deklariert", 2, [3]],
      ["pfeil", 5, [6]],
      ["ausdruck", 8, [9]],
      ["methode", 12, [13]],
      ["innen", 14, [15]],
    ]);
  });

  test.each(["if", "for", "while", "switch", "catch", "return"])("%s-Zeile mit Block ist kein Methodenkopf", (wort) => {
    const r = neu(`function f() {\n  ${wort} (a) {\n    g(a || b);\n  }\n}`);
    expect(r.map((e) => e.funktion)).toEqual(["f"]);
  });

  test("Arrow ohne Klammern und gleichnamige Methoden zweier Klassen", () => {
    expect(neu("const g = x => {\n  if (x) return;\n};").map((e) => e.funktion)).toEqual(["g"]);
    const r = neu("class A {\n  m() {\n    if (a) {}\n  }\n}\nclass B {\n  m() {\n    if (b) {}\n  }\n}");
    expect(r.map((e) => [e.funktion, e.zeile])).toEqual([["m", 2], ["m", 7]]);
  });
});

describe("formatiere und lauf", () => {
  const eintrag = (anker: { zeile: number; muster: string }[]): Eintrag => ({ datei: "scripts/a.mjs", funktion: "f", zeile: 10, anker });

  test("eine Zeile je Funktion mit gruppierten Mustern plus Summe", () => {
    const text = formatiere([eintrag([{ zeile: 41, muster: "if" }, { zeile: 47, muster: "if" }, { zeile: 52, muster: "??" }, { zeile: 60, muster: ">=" }])]);
    expect(text).toBe("scripts/a.mjs:10 f: 4 Anker (if×2 :41,:47; ?? :52; >= :60)\nSumme: 4 Anker in 1 Funktion\n");
  });

  test("ohne Anker eine Leermeldung, Summe zählt Mehrzahl", () => {
    expect(formatiere([])).toBe("Guard-Liste: keine Anker im Diff.\n");
    expect(formatiere([eintrag([{ zeile: 1, muster: "if" }]), eintrag([{ zeile: 2, muster: "if" }])])).toContain("Summe: 2 Anker in 2 Funktionen");
  });

  const git = (antworten: Record<string, string>) => (args: string[]) => {
    const schluessel = args.join(" ");
    const treffer = Object.keys(antworten).find((k) => schluessel.startsWith(k));
    if (treffer === undefined) throw new Error(`unerwartet: ${schluessel}`);
    return antworten[treffer];
  };
  const kopf = "diff --git a/scripts/a.mjs b/scripts/a.mjs\n--- a/scripts/a.mjs\n+++ b/scripts/a.mjs\n@@ -0,0 +1 @@\n";
  const umgebung = (extra: Record<string, string> = {}) => ({
    git: git({ "rev-parse": "abc\n", "diff -U0 abc": kopf, "ls-files": "scripts/neu.mjs\ndocs/x.md\n", ...extra }),
    lesen: (p: string) => (p === "scripts/neu.mjs" ? "if (n) {}\n" : "if (a) {}\n"),
    istQuelle,
  });

  test("echteUmgebung: git im Repo, lesbare Datei als Text, fehlende Datei undefined, Quelle aus der Projekt-Config", () => {
    const u = echteUmgebung();
    expect(u.git(["rev-parse", "--is-inside-work-tree"]).trim()).toBe("true");
    expect(u.lesen("package.json")).toContain('"name"');
    expect(u.lesen("gibt/es/nicht.mjs")).toBeUndefined();
    expect(u.istQuelle("scripts/anker-liste.mjs")).toBe(true);
    expect(u.istQuelle("test/anker-liste.test.ts")).toBe(false);
  });

  test("echteUmgebung ist im Repo-Root verankert, auch wenn der Aufruf aus einem anderen Verzeichnis kommt", () => {
    const vorher = process.cwd();
    process.chdir(tmpdir());
    try {
      const u = echteUmgebung();
      expect(u.git(["rev-parse", "--is-inside-work-tree"]).trim()).toBe("true");
      expect(u.lesen("package.json")).toContain('"name"');
    } finally {
      process.chdir(vorher);
    }
  });

  test("lauf liest ungetrackte Nicht-Quelldateien gar nicht erst", () => {
    const lesen = vi.fn((p: string) => (p === "scripts/neu.mjs" ? "if (n) {}\n" : "if (a) {}\n"));
    lauf(["--basis", "HEAD"], { ...umgebung(), lesen });
    expect(lesen.mock.calls.map((c) => c[0])).not.toContain("docs/x.md");
    expect(lesen.mock.calls.map((c) => c[0])).toContain("scripts/neu.mjs");
  });

  test("lauf: Diff plus ungetrackte Quelldateien, docs bleibt draußen", () => {
    const r = lauf(["--basis", "HEAD"], umgebung());
    expect(r.code).toBe(0);
    expect(r.out).toBe("scripts/a.mjs:1 (Modulebene): 1 Anker (if :1)\nscripts/neu.mjs:1 (Modulebene): 1 Anker (if :1)\nSumme: 2 Anker in 2 Funktionen\n");
  });

  test("lauf --json gibt die Rohstruktur aus", () => {
    const r = lauf(["--basis", "HEAD", "--json"], umgebung());
    expect(JSON.parse(r.out)).toHaveLength(2);
  });

  test("lauf ohne auflösbare Basis: Exit 1 mit Fix-Zeile", () => {
    const r = lauf([], { ...umgebung(), git: () => { throw new Error("nein"); } });
    expect(r.code).toBe(1);
    expect(r.out).toBe("");
    expect(r.err).toMatch(/^✖ anker-liste: keine Vergleichs-Basis auflösbar\nFix: /);
  });

  test("lauf: --basis hat Vorrang vor FACTORY_DIFF_BASE, ohne --basis gilt die Umgebung", () => {
    vi.stubEnv("FACTORY_DIFF_BASE", "envref");
    try {
      const aufrufe: string[] = [];
      const g = git({ "rev-parse": "abc\n", "diff -U0 abc": kopf, "ls-files": "" });
      const protokoll = (args: string[]) => (aufrufe.push(args.join(" ")), g(args));
      lauf(["--basis", "x"], { ...umgebung(), git: protokoll });
      lauf([], { ...umgebung(), git: protokoll });
      expect(aufrufe.filter((a) => a.startsWith("rev-parse"))).toEqual(["rev-parse --verify --quiet x^{commit}", "rev-parse --verify --quiet envref^{commit}"]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test("lauf mit unbekanntem Flag: Exit 2 mit Aufrufzeile", () => {
    const r = lauf(["--bogus"], umgebung());
    expect(r.code).toBe(2);
    expect(r.err).toBe("✖ anker-liste: Unbekanntes Argument: --bogus\nAufruf: node scripts/anker-liste.mjs [--basis <ref>] [--json]\n");
  });
});
