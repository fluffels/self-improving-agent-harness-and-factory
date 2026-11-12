/* Guard-Liste (#112): je geänderter Funktion die Anker (Verzweigungs- und Guard-Stellen) der Diff-Zeilen. Kern ist pur; die CLI-Hülle
 * `lauf` bekommt git und Dateizugriff injiziert. Jedes Muster hat einen Positivfall, dazu Negativfälle (Kommentar, String, Vergleichs-Fehlgriffe). */
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ankerRoh from "../scripts/anker-liste.mjs";

const normal = (p: string) => realpathSync(p).replace(/\\/g, "/");
const repoWurzel = normal(fileURLToPath(new URL("..", import.meta.url)));
const wurzel = (u: { git: (a: string[]) => string }) => normal(u.git(["rev-parse", "--show-toplevel"]).trim());

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
  MUSTER_SHELL: { name: string }[];
};
const { guardListe, formatiere, lauf, MUSTER, MUSTER_SHELL, echteUmgebung } = ankerListe;
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

  test("Ausdrücke in ${…} eines einzeiligen Template-Literals zählen (klammerbalanciert), der Text außerhalb und Strings darin nicht", () => {
    expect(muster('  const s = `x ${a ? "x" : "y"}`;')).toEqual(["ternär"]);
    expect(muster("  const s = `x ${b ?? c}`;")).toEqual(["??"]);
    expect(muster("  const s = `${f({ a: 1 }) || d} und ${g ?? h}`;")).toEqual(["??", "||"]);
    expect(muster("  const s = `a ? b : c`;")).toEqual([]);
    expect(muster('  const s = `${f("a ? b")}`;')).toEqual([]);
    expect(muster("  const s = `${f({ a: 1 }) || d} und a ? b : c`;")).toEqual(["||"]);
    expect(muster('  const s = "${a ?? b}";')).toEqual([]);
  });
  test("Regex-Literal nach => zählt als Anker „Regex-Literal“, sein Inhalt (etwa ??) nicht (factory#280 L14); Division und echtes ?? bleiben", () => {
    expect(muster("  const g = (s) => /a ?? b/.test(s);")).toEqual(["Regex-Literal"]);
    expect(muster("  const g = (s) => /^x+$/.test(s);")).toEqual(["Regex-Literal"]);
    expect(muster("  const h = (s) => a / b ?? c / d;")).toEqual(["??"]);
    expect(muster("  const k = (s) => s ?? 1;")).toEqual(["??"]);
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

  test("Default-Parameter: Vergleiche im Default (<=, >=, !=) sind kein zweiter Anker", () => {
    for (const z of ["function f(a = b <= c) {\n}", "function f(a = b >= c) {\n}", "function f(a = b != c) {\n}"]) {
      expect(neu(z)[0]?.anker.map((a) => a.muster).filter((m) => m === "Default-Parameter"), z).toEqual(["Default-Parameter"]);
    }
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

  test("Default-Parameter: je Default ein Anker (factory#263), Vergleich und Pfeil im Default zählen nicht mit", () => {
    const zahl = (z: string) => (neu(z)[0]?.anker ?? []).filter((a) => a.muster === "Default-Parameter").length;
    expect(zahl("function f(a = 1, b = 2) {\n}")).toBe(2);
    expect(zahl("const g = ({ x = 1, y } = {}) => x;")).toBe(2);
    expect(zahl("function f(a = x === y) {\n}")).toBe(1);
    expect(zahl("function f(cb = () => 1) {\n}")).toBe(1);
    expect(zahl("function f(a, b) {\n}")).toBe(0);
    expect(ankerListe.formatiere(neu("function f(a = 1, b = 2) {\n}"))).toContain("Default-Parameter×2 :1,:1");
  });

  test("Verdrahtung reiner Helfer an der Aufrufstelle ist kein Anker (bewusste Grenze, die Lens prüft sie)", () => {
    expect(neu("function f(x) {\n  const r = g({\n    opt: helfer(x),\n  });\n}")).toEqual([]);
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

  test("der Direktaufruf-Block `if (istDirektaufruf(` zählt als (Modulebene), nicht zur vorigen Funktion (factory#208)", () => {
    const r = neu("function f() {\n  if (a) {}\n}\nif (istDirektaufruf(import.meta.url)) {\n  try {\n    g();\n  } catch (e) {}\n}");
    expect(r.map((e) => [e.funktion, e.zeile, e.anker.map((a) => a.zeile)])).toEqual([
      ["f", 1, [2]],
      ["(Modulebene)", 4, [4, 7]],
    ]);
  });

  // factory#396 L64: die Modulebene-Grenze ist eine geschlossene Liste aus Spalte 0.
  test("Modulebene-Grenze: `const` in Spalte 0 nach einer einzeiligen Funktion beendet sie (Defekt L64, STATUS_PFADE)", () => {
    const r = neu("const f = (x) => x;\nconst LISTE = [\n  /a/,\n  /b/,\n];");
    expect(r.map((e) => [e.funktion, e.zeile, e.anker.map((a) => a.zeile)])).toEqual([["(Modulebene)", 3, [3, 4]]]);
  });

  test.each([
    ["schließendes }", "function g() {\n  if (a) {}\n}\nfoo(a || b);"],
    ["class", "function g() { if (a) {} }\nclass K {\n  x = a || b;\n}"],
    ["let", "function g() { if (a) {} }\nlet y = a || b;"],
    ["var", "function g() { if (a) {} }\nvar y = a || b;"],
  ])("Modulebene-Grenze %s: der Anker danach gehört nicht zu g", (_n, quelle) => {
    const r = neu(quelle);
    expect(r.map((e) => [e.funktion, e.anker.map((a) => a.muster)])).toEqual([
      ["g", ["if"]],
      ["(Modulebene)", ["||"]],
    ]);
  });

  test("Modulebene-Grenze: `export const` und der Direktaufruf-Block nach einer einzeiligen Funktion beenden sie, `variante(` und `main();` nicht", () => {
    const e = neu("function g() { if (a) {} }\nexport const L = [\n  /a/,\n];");
    expect(e.map((x) => [x.funktion, x.anker.map((a) => a.zeile)])).toEqual([["g", [1]], ["(Modulebene)", [3]]]);
    const d = neu("function g() { if (a) {} }\nif (istDirektaufruf(x)) {\n  g(a || b);\n}");
    expect(d.map((x) => [x.funktion, x.anker.map((a) => a.muster)])).toEqual([["g", ["if"]], ["(Modulebene)", ["if", "||"]]]);
    const v = neu("function g() { if (a) {} }\nvariante(a || b);");
    expect(v.map((x) => [x.funktion, x.anker.map((a) => a.muster)])).toEqual([["g", ["if", "||"]]]);
  });

  test("Modulebene-Grenze Negativfall: eingerücktes } und const im Rumpf beenden die Funktion nicht; ein Kopf in Spalte 0 bleibt Kopf", () => {
    const r = neu("function f() {\n  if (a) {\n  }\n  const z = 1;\n  if (b) {}\n}");
    expect(r.map((e) => [e.funktion, e.anker.map((a) => a.zeile)])).toEqual([["f", [2, 5]]]);
    const k = neu("function davor() {}\nexport const h = (a) => {\n  if (a) {}\n};");
    expect(k.map((e) => [e.funktion, e.zeile])).toEqual([["h", 2]]);
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

describe("guardListe: einzeilige Köpfe (Methode, Eigenschaft)", () => {
  const mehrzeilig = "function a() {\n  if (x) {\n    y();\n  }\n}\n";
  test.each([
    ["Klassenmethode", "  inherit(x) { return x ?? 1; }"],
    ["Objekt-Eigenschaft Pfeil", "  inherit: (x) => x ?? 1,"],
    ["Objekt-Eigenschaft async Pfeil", "  inherit: async (x) => x ?? 1,"],
    ["Objekt-Eigenschaft function", "  inherit: function (x) { return x ?? 1; },"],
    ["Kontrolle const", "const inherit = (x) => x ?? 1;"],
    ["Objekt-Eigenschaft Pfeil ohne Klammern", "  inherit: x => x ?? 1,"],
  ])("%s: der ??-Anker gehört zu inherit, nicht zu a", (_n, zeile) => {
    const r = neu(`${mehrzeilig}${zeile}\n`);
    expect(r.map((e) => [e.funktion, e.anker.map((a) => a.muster)])).toEqual([
      ["a", ["if"]],
      ["inherit", ["??"]],
    ]);
  });

  // factory#162 L8: jede Kopf-Form liefert ihren Namen als Funktion des Ankers (nicht `(Modulebene)` oder die Vorgängerfunktion).
  test.each([
    ["generische Deklaration", "function f<T>(x: T): T {"],
    ["generischer Pfeil", "const f = <T>(x: T): T => {"],
    ["Pfeil mit Typannotation", "const f: Fn = (x) => {"],
    ["export default function", "export default function f(x) {"],
    ["async-Deklaration", "export async function f(x) {"],
    ["Generator", "function* f(x) {"],
    ["async Pfeil", "const f = async (x) => {"],
    ["einzeilige Methode", "  f(x) { return x ?? 1; }"],
    ["Methode mit async", "  async f(x) {"],
    ["statische Methode", "  static f(x) {"],
    ["statische async Methode", "  static async f(x) {"],
    ["Methode mit Rückgabetyp", "  f(x): number {"],
  ])("Kopf-Form %s", (_n, kopf) => {
    const ein = kopf.endsWith("}") && !kopf.endsWith("=> {") ? "" : "\n  return x ?? 1;\n}";
    const klasse = kopf.startsWith("  ");
    const quelle = klasse ? `class K {\n${kopf}${ein}\n}\n` : `function davor() {}\n${kopf}${ein}\n`;
    const r = neu(quelle);
    const mitAnker = r.filter((e) => e.anker.some((a) => a.muster === "??"));
    expect(mitAnker.map((e) => e.funktion), kopf).toEqual(["f"]);
  });

  test("Kontrollfluss-Zeile mit Block bleibt kein Kopf", () => {
    const r = neu("function a() {\n  if (x) { g(y ?? 1); }\n}\n");
    expect(r.map((e) => e.funktion)).toEqual(["a"]);
  });
});

describe("istGemessen", () => {
  const istGemessen = (ankerRoh as unknown as { istGemessen: (p: string, q: string) => boolean }).istGemessen;
  test.each(["test/support/x.ts", "scripts/a.mjs"])("%s ist gemessen", (p) => expect(istGemessen(p, "scripts")).toBe(true));
  test("Listenform: die Ordner-Klausel nimmt die Endungsliste und ohne des Projekts plus die JS/TS-Familie, sonst nichts", () => {
    const java = { wurzeln: ["*/src/main/java"], endungen: [".java"] };
    const gem = istGemessen as unknown as (p: string, q: unknown) => boolean;
    expect(gem("modul-a/src/main/java/de/X.java", java)).toBe(true);
    expect(gem("modul-a/src/test/java/de/Hilfe.java", java)).toBe(true);
    expect(gem("test/support/x.json", { wurzeln: ["scripts"], endungen: [".ts"] })).toBe(false);
    expect(gem("modul-a/src/test/java/de/Hilfe.java", { ...java, ohne: ["*/src/test/**"] })).toBe(false);
  });
  test.each(["test/x.test.ts", "test/support/x.spec.ts", "docs/a.md", "src/a.d.ts", "vite.config.ts", "test/x.test.mjs", "scripts/a.test.mjs"])("%s ist nicht gemessen", (p) =>
    expect(istGemessen(p, "scripts")).toBe(false),
  );
});

describe("Shell (*.sh, factory#396 L2)", () => {
  const istShell = (p: string) => p.endsWith(".sh");
  const sh = (inhalt: string): Eintrag[] => guardListe({ diffText: "", neueDateien: [{ pfad: "betrieb/x.sh", inhalt }], lies: () => undefined, istQuelle: istShell });
  const namen = (zeile: string) => sh(`f() {\n${zeile}\n}`)[0]?.anker.map((a) => a.muster) ?? [];
  const SHELL_FAELLE: [string, string][] = [
    ["if", "  if [[ -f x ]]; then"],
    ["if", "  elif [ -d y ]; then"],
    ["[[", "  [[ -f x ]] && echo a"],
    ["case", '  case "$1" in'],
    ["&&", "  a && b"],
    ["||", "  a || b"],
  ];
  test.each(SHELL_FAELLE)("%s ist ein Anker", (name, zeile) => expect(namen(zeile)).toContain(name));

  test("die Shell-Tabelle hat genau die getesteten Muster", () => {
    expect([...new Set(MUSTER_SHELL.map((m) => m.name))].sort()).toEqual([...new Set(SHELL_FAELLE.map(([n]) => n))].sort());
  });

  test("Kombinationen: if samt [[, elif als if, && und || nebeneinander", () => {
    expect(namen("  if [[ -f x ]]; then")).toEqual(["if", "[["]);
    expect(namen("  a && b || c")).toEqual(["&&", "||"]);
  });

  test.each([
    "  # if [ -f x ]; then",
    "  #!/bin/bash",
    '  echo "a && b"',
    "  echo 'if x'",
    "  n=${#arr[@]}",
    '  echo "$#"',
    "  x=$# # a || b",
    "  echo if-not",
  ])("Negativfall ohne Anker: %s", (z) => expect(namen(z), z).toEqual([]));

  test("$# und ${#a[@]} sind Code, kein Kommentarbeginn: der Anker dahinter zählt", () => {
    expect(namen("  if [ $# -gt 0 ]; then")).toEqual(["if"]);
    expect(namen("  n=${#arr[@]} && x")).toEqual(["&&"]);
  });

  test("Kommentare in Spalte 0, Wortgrenzen, Escape im String und function name() {", () => {
    expect(sh("# if [ -f x ]; then\n# a && b\n")).toEqual([]);
    expect(namen("  diff a b")).toEqual([]);
    expect(namen("  notif x")).toEqual([]);
    expect(namen("  echo showcase x")).toEqual([]);
    expect(namen("  lowercase x")).toEqual([]);
    expect(namen("  x[[ -f y")).toEqual([]);
    expect(sh("[[ -f x ]] || exit 1\n").map((e) => e.anker.map((a) => a.muster))).toEqual([["[[", "||"]]);
    expect(namen('  echo "a \\" && b"')).toEqual([]);
    expect(namen('  echo "q \\" || x \\" y"')).toEqual([]);
    const r = sh("function b() {\n  c || d\n}\n");
    expect(r.map((e) => [e.funktion, e.zeile])).toEqual([["b", 1]]);
  });

  test("Shebang in Zeile 1 ist kein Anker; ein Case-Zweig mit * am Anfang zählt als Code (kein Blockkommentar)", () => {
    expect(sh("#!/bin/bash\nset -e\n")).toEqual([]);
    expect(namen("  *) a || b ;;")).toEqual(["||"]);
  });

  test("Köpfe name() {, function name { und } in Spalte 0 als Modulebene", () => {
    const r = sh("a() {\n  if x; then\n  fi\n}\nfunction b {\n  c || d\n}\ne && f\n");
    expect(r.map((e) => [e.funktion, e.zeile, e.anker.map((a) => a.muster)])).toEqual([
      ["a", 1, ["if"]],
      ["b", 5, ["||"]],
      ["(Modulebene)", 8, ["&&"]],
    ]);
  });

  test("ein Kommentar mit Funktionskopf ist kein Kopf", () => {
    const r = sh("a() {\n}\n# b() {\nc && d\n");
    expect(r.map((e) => e.funktion)).toEqual(["(Modulebene)"]);
  });

  test("istGemessen: .sh nur in der Ordner-Klausel; Root-Datei, ohne und Tests nicht", () => {
    const gem = (ankerRoh as unknown as { istGemessen: (p: string, q: unknown) => boolean }).istGemessen;
    expect(gem("betrieb/x.sh", "scripts")).toBe(true);
    expect(gem("scripts/x.sh", "scripts")).toBe(true);
    expect(gem("x.sh", "scripts")).toBe(false);
    expect(gem("betrieb/x.sh", { wurzeln: ["scripts"], endungen: [".mjs"], ohne: ["betrieb/**"] })).toBe(false);
  });
});

describe("istGemessen: JS/TS-Familie zusätzlich zu struktur.endungen", () => {
  const gem = (ankerRoh as unknown as { istGemessen: (p: string, q: unknown) => boolean }).istGemessen;
  const java = { quelle: "backend/src", wurzeln: ["backend/src"], endungen: [".java"] };
  test.each(["tools/x.mjs", "scripts/layers.cjs", "backend/src/A.java"])("%s ist gemessen", (p) => expect(gem(p, java)).toBe(true));
  test.each(["tools/x.test.mjs", "README.md", "x.mjs"])("%s ist nicht gemessen", (p) => expect(gem(p, java)).toBe(false));
  test("ohne greift auch für die Familie", () => expect(gem("tools/x.mjs", { ...java, ohne: ["tools/**"] })).toBe(false));
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
    expect(wurzel(u)).toBe(repoWurzel);
    expect(u.lesen("package.json")).toContain('"name"');
    expect(u.lesen("gibt/es/nicht.mjs")).toBeUndefined();
    expect(u.istQuelle("scripts/anker-liste.mjs")).toBe(true);
    expect(u.istQuelle("test/support/baseline-zaehlung.ts")).toBe(true);
    expect(u.istQuelle("test/anker-liste.test.ts")).toBe(false);
  });

  test("echteUmgebung ist im Repo-Root verankert, auch wenn der Aufruf aus einem anderen Verzeichnis kommt", () => {
    const vorher = process.cwd();
    process.chdir(tmpdir());
    try {
      const u = echteUmgebung();
      expect(wurzel(u)).toBe(repoWurzel);
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
