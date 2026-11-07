/* Leser der Coverage-Berichte (factory#185): Config-Prüfung, lcov mit basis, JaCoCo-XML (statisches Fixture), Berichtsdateien per Glob und das Mischen/Auflösen in ladeAbdeckung. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/coverage-berichte.mjs";

type Bericht = { format: string; pfad: string; basis?: string };
type Zweig = { total: number; taken: number };
type Jacoco = Map<string, { zeilen: Map<number, number>; zweige: Map<number, Zweig> }>;
type Abdeckung = { abdeckung: Map<string, Map<number, number>>; zweige: Map<string, Map<number, Zweig>>; fehlend: string[]; mehrdeutig: { pfad: string; schluessel: string; kandidaten: string[] }[] };
type Quellen = { wurzeln: string[]; endungen: string[]; ohne?: string[] };
const m = raw as unknown as {
  STANDARD_BERICHTE: Bericht[];
  berichteMaengel: (c: unknown) => string[];
  berichteAus: (c: unknown) => Bericht[];
  parseLcov: (t: string, basis?: string) => Map<string, Map<number, number>>;
  parseLcovBranches: (t: string, basis?: string) => Map<string, Map<number, Zweig>>;
  parseJacoco: (t: string) => Jacoco;
  berichtDateien: (root: string, pfad: string) => string[];
  jacocoZuordnen: (o: {
    berichte: { bestand: Jacoco; pfad: string }[];
    messDateien: string[];
    quellen: Quellen;
    rootDir: string;
    wurzelOrdner?: string[];
    existiert?: (p: string) => boolean;
    abdeckung: Map<string, Map<number, number>>;
    zweige: Map<string, Map<number, Zweig>>;
    mehrdeutig: unknown[];
    berichteJe: Map<string, string[]>;
  }) => void;
  ladeAbdeckung: (o: { berichte: Bericht[]; rootDir: string; lies: (p: string) => string; messDateien: string[]; quellen: Quellen; wurzelOrdner?: string[]; existiert?: (p: string) => boolean }) => Abdeckung;
};

const XML = readFileSync(fileURLToPath(new URL("./fixtures/jacoco/jacoco.xml", import.meta.url)), "utf8");
const JAVA: Quellen = { wurzeln: ["*/src/main/java"], endungen: [".java"] };
const lies = (p: string): string => readFileSync(p, "utf8");

describe("berichteAus und berichteMaengel", () => {
  test("ohne Block gilt der Standard (als Kopie)", () => {
    const a = m.berichteAus({});
    assert.deepEqual(a, [{ format: "lcov", pfad: "coverage/lcov.info" }]);
    a[0].pfad = "x";
    assert.equal(m.STANDARD_BERICHTE[0].pfad, "coverage/lcov.info");
  });
  test("gültige Liste mit Glob und basis", () => {
    const c = { berichte: [{ format: "jacoco", pfad: "*/target/site/jacoco/jacoco.xml" }, { format: "lcov", pfad: "frontend/coverage/lcov.info", basis: "frontend" }] };
    assert.deepEqual(m.berichteMaengel(c), []);
    assert.deepEqual(m.berichteAus({ coverage: c }), c.berichte);
  });
  test.each([
    [{}, /coverage.berichte muss eine nicht-leere Liste/],
    [{ berichte: [] }, /nicht-leere Liste/],
    [{ berichte: [{ format: "xml", pfad: "a" }] }, /format muss "lcov" oder "jacoco" sein/],
    [{ berichte: [{ format: "lcov" }] }, /coverage.berichte\[0\].pfad muss ein nicht-leerer String sein/],
    [{ berichte: [{ format: "lcov", pfad: "/abs/lcov.info" }] }, /pfad muss ein repo-relativer POSIX-Pfad sein/],
    [{ berichte: [{ format: "jacoco", pfad: "a.xml", basis: "x" }] }, /basis gilt nur bei format "lcov"/],
    [{ berichte: [{ format: "lcov", pfad: "a", basis: "../x" }] }, /basis muss ein wörtlicher repo-relativer POSIX-Ordner sein/],
    [{ berichte: [{ format: "lcov", pfad: "a", basis: "*" }] }, /basis muss ein wörtlicher/],
    [{ berichte: [{ format: "lcov", pfad: "a", basis: 5 }] }, /basis muss ein wörtlicher/],
    [{ berichte: [{ format: "lcov", pfad: "a" }, { format: "lcov", pfad: "a" }] }, /steht doppelt/],
    [{ berichte: ["a"] }, /muss ein Objekt/],
  ])("Mangel %#: Meldung mit Fix-Zeile", (c, muster) => {
    assert.match(m.berichteMaengel(c).join(" "), muster);
    assert.throws(() => m.berichteAus({ coverage: c }), (e: Error) => muster.test(e.message) && /in der Projekt-Config\nFix:/.test(e.message));
  });
  test("derselbe lcov-Pfad mit anderer basis ist keine Dublette", () => {
    const c = { berichte: [{ format: "lcov", pfad: "a/lcov.info", basis: "x" }, { format: "lcov", pfad: "a/lcov.info", basis: "y" }] };
    assert.deepEqual(m.berichteMaengel(c), []);
  });
  test("coverage kein Objekt ist ein Mangel", () => {
    assert.match(m.berichteMaengel("x").join(" "), /coverage muss ein Objekt/);
  });
});

describe("parseLcov mit basis", () => {
  const text = ["SF:src/a.ts", "DA:1,2", "BRDA:1,0,0,1", "BRDA:1,0,1,-", "end_of_record", "SF:/abs/b.ts", "DA:4,0", "end_of_record", "SF:src\\w.ts", "DA:2,1", "end_of_record"].join("\n");
  test("ohne basis bleiben die Pfade wie im Bericht (Trenner POSIX)", () => {
    assert.deepEqual([...m.parseLcov(text).keys()], ["src/a.ts", "/abs/b.ts", "src/w.ts"]);
  });
  test("mit basis steht basis/ vor relativen Pfaden, ein absoluter bleibt", () => {
    const r = m.parseLcov(text, "frontend");
    assert.deepEqual([...r.keys()], ["frontend/src/a.ts", "/abs/b.ts", "frontend/src/w.ts"]);
    // ein Windows-Laufwerkspfad ist absolut und bekommt kein basis
    assert.deepEqual([...m.parseLcov("SF:C:\\x\\a.ts\nDA:1,1\nend_of_record", "frontend").keys()], ["C:/x/a.ts"]);
    assert.equal(r.get("frontend/src/a.ts")?.get(1), 2);
    assert.deepEqual(m.parseLcovBranches(text, "frontend").get("frontend/src/a.ts")?.get(1), { total: 2, taken: 1 });
  });
});

describe("parseJacoco am statischen Fixture", () => {
  const r = m.parseJacoco(XML);
  test("einzeiliges XML mit DOCTYPE, group und counter-Rauschen: Zeilen je paket/Datei", () => {
    assert.deepEqual([...r.keys()].sort(), ["Haupt.java", "de/beispiel/Rechner.java"]);
    const z = r.get("de/beispiel/Rechner.java")!.zeilen;
    assert.deepEqual([...z.entries()], [[3, 4], [5, 0], [7, 3]]);
  });
  test("mb und cb ergeben die Zweige (nur bei mb+cb > 0)", () => {
    assert.deepEqual([...r.get("de/beispiel/Rechner.java")!.zweige.entries()], [[7, { total: 2, taken: 1 }]]);
  });
  test("Default-Paket ergibt den Dateinamen allein", () => {
    assert.equal(r.get("Haupt.java")!.zeilen.get(1), 1);
  });
  test("eine line außerhalb von sourcefile und kaputte nr werden ignoriert, umbrochenes XML geht auch", () => {
    const t = `<package name="p">\n<line nr="9" mi="0" ci="1" mb="0" cb="0"/>\n<sourcefile name="A.java">\n<line nr="x" ci="1"/>\n<line nr="2" mi="1" ci="0" mb="0" cb="0"/>\n</sourcefile>\n<line nr="8" ci="5"/>\n</package>`;
    const e = m.parseJacoco(t).get("p/A.java")!;
    assert.deepEqual([...e.zeilen.entries()], [[2, 0]]);
  });
  test("zwei sourcefile-Einträge derselben Datei addieren ihre Treffer und mischen Zweige per max", () => {
    const t = `<package name="p"><sourcefile name="A.java"><line nr="1" ci="1"/><line nr="2" ci="1" mb="0" cb="2"/></sourcefile></package><package name="p"><sourcefile name="A.java"><line nr="1" ci="2"/><line nr="2" ci="1" mb="2" cb="1"/></sourcefile></package>`;
    const e = m.parseJacoco(t).get("p/A.java")!;
    assert.equal(e.zeilen.get(1), 3);
    assert.equal(e.zweige.has(1), false);
    assert.deepEqual(e.zweige.get(2), { total: 3, taken: 2 });
  });
});

describe("berichtDateien", () => {
  const baum = () => fixture({
    "modul-b/target/site/jacoco/jacoco.xml": "b",
    "modul-a/target/site/jacoco/jacoco.xml": "a",
    ".versteckt/target/site/jacoco/jacoco.xml": "v",
    "node_modules/x/target/site/jacoco/jacoco.xml": "n",
    "modul-a/target/site/jacoco/anderes.xml": "o",
    "lcov.info": "l",
  });
  test("ein Glob über zwei Module liefert sortiert beide, ohne Punkt-Ordner und node_modules", () => {
    const d = baum();
    assert.deepEqual(m.berichtDateien(d, "*/target/site/jacoco/jacoco.xml"), ["modul-a/target/site/jacoco/jacoco.xml", "modul-b/target/site/jacoco/jacoco.xml"]);
  });
  test("ein Dateiname-Glob ohne Ordner trifft die Root-Datei", () => {
    const d = baum();
    assert.deepEqual(m.berichtDateien(d, "*.info"), ["lcov.info"]);
  });
  test("ein wörtlicher Pfad ergibt sich selbst, auch wenn es ihn nicht gibt", () => {
    const d = baum();
    assert.deepEqual(m.berichtDateien(d, "coverage/lcov.info"), ["coverage/lcov.info"]);
  });
  test("ein Glob ohne Treffer ist leer", () => {
    const d = baum();
    assert.deepEqual(m.berichtDateien(d, "*/nix/*.xml"), []);
  });
});

describe("ladeAbdeckung", () => {
  const java = "modul-a/src/main/java/de/beispiel/Rechner.java";
  const baum = {
    "modul-a/target/site/jacoco/jacoco.xml": XML,
    "modul-a/src/main/java/de/beispiel/Rechner.java": "x",
    "coverage/lcov.info": "SF:src/a.ts\nDA:1,1\nBRDA:1,0,0,1\nBRDA:1,0,1,0\nend_of_record\n",
  };
  const jacocoBericht = { format: "jacoco", pfad: "*/target/site/jacoco/jacoco.xml" };

  test("JaCoCo wird per Suffix auf den Repo-Pfad aufgelöst; Zeilen und Zweige kommen an", () => {
    const d = fixture(baum);
    const r = m.ladeAbdeckung({ berichte: [jacocoBericht], rootDir: d, lies: lies, messDateien: [java], quellen: JAVA });
    assert.deepEqual(r.fehlend, []);
    assert.deepEqual(r.mehrdeutig, []);
    assert.deepEqual([...r.abdeckung.get(java)!.entries()], [[3, 4], [5, 0], [7, 3]]);
    assert.deepEqual(r.zweige.get(java)!.get(7), { total: 2, taken: 1 });
  });
  test("lcov und JaCoCo mischen sich in einem Lauf (lcov mit basis)", () => {
    const d = fixture(baum);
    const berichte = [jacocoBericht, { format: "lcov", pfad: "coverage/lcov.info", basis: "frontend" }];
    const r = m.ladeAbdeckung({ berichte, rootDir: d, lies: lies, messDateien: [java, "frontend/src/a.ts"], quellen: JAVA });
    assert.equal(r.abdeckung.get("frontend/src/a.ts")!.get(1), 1);
    assert.deepEqual(r.zweige.get("frontend/src/a.ts")!.get(1), { total: 2, taken: 1 });
    assert.equal(r.abdeckung.get(java)!.get(3), 4);
  });
  test("derselbe Pfad in zwei Berichten wird gemischt (Hits addiert, Zweige per max), nicht mehrdeutig", () => {
    const d = fixture({
      "a/lcov.info": "SF:src/a.ts\nDA:1,1\nDA:2,0\nDA:3,1\nBRDA:2,0,0,0\nBRDA:2,0,1,0\nBRDA:3,0,0,1\nBRDA:3,0,1,0\nend_of_record\n",
      "b/lcov.info": "SF:src/a.ts\nDA:1,2\nDA:2,1\nDA:3,1\nBRDA:2,0,0,1\nBRDA:2,0,1,0\nBRDA:3,0,0,1\nBRDA:3,0,1,0\nend_of_record\n",
    });
    const berichte = [{ format: "lcov", pfad: "a/lcov.info" }, { format: "lcov", pfad: "b/lcov.info" }];
    const r = m.ladeAbdeckung({ berichte, rootDir: d, lies: lies, messDateien: ["src/a.ts"], quellen: { wurzeln: ["src"], endungen: [".ts"] } });
    assert.deepEqual([...r.abdeckung.get("src/a.ts")!.entries()], [[1, 3], [2, 1], [3, 2]]);
    assert.deepEqual(r.zweige.get("src/a.ts")!.get(2), { total: 2, taken: 1 });
    // derselbe Zweig in beiden Berichten genommen: max (1), nicht Summe (2)
    assert.deepEqual(r.zweige.get("src/a.ts")!.get(3), { total: 2, taken: 1 });
    assert.deepEqual(r.mehrdeutig, []);
  });
  test("berichteJe: dieselbe Berichtsdatei über zwei überlappende Einträge steht je Datei nur einmal, zwei Dateien in Lesereihenfolge (factory#215)", () => {
    const d = fixture({
      "a/lcov.info": "SF:src/a.ts\nDA:1,1\nend_of_record\n",
      "a/zweit.info": "SF:src/a.ts\nDA:1,1\nend_of_record\n",
    });
    const quellen = { wurzeln: ["src"], endungen: [".ts"] };
    const ueberlappend = [{ format: "lcov", pfad: "a/*.info" }, { format: "lcov", pfad: "a/lcov.info" }];
    const r = m.ladeAbdeckung({ berichte: ueberlappend, rootDir: d, lies: lies, messDateien: ["src/a.ts"], quellen }) as unknown as { berichteJe: Map<string, string[]> };
    assert.deepEqual(r.berichteJe.get("src/a.ts")!.map((p) => p.replace(/^.*[\\/]a[\\/]/, "a/")), ["a/lcov.info", "a/zweit.info"]);
  });
  test("jacocoZuordnen: bei zwei gleichen Beständen meldet jedes { bestand, pfad }-Paar seinen eigenen Pfad (kein indexOf auf den ersten, factory#220 L47)", () => {
    const bestand: Jacoco = new Map([["de/x/A.java", { zeilen: new Map([[3, 1]]), zweige: new Map() }]]);
    const abdeckung = new Map<string, Map<number, number>>();
    const berichteJe = new Map<string, string[]>();
    m.jacocoZuordnen({
      berichte: [{ bestand, pfad: "a/jacoco.xml" }, { bestand, pfad: "b/jacoco.xml" }],
      messDateien: ["src/de/x/A.java"],
      quellen: { wurzeln: ["src"], endungen: [".java"] },
      rootDir: "/nie",
      wurzelOrdner: ["src"],
      existiert: () => true,
      abdeckung,
      zweige: new Map(),
      mehrdeutig: [],
      berichteJe,
    });
    assert.deepEqual(berichteJe.get("src/de/x/A.java"), ["a/jacoco.xml", "b/jacoco.xml"]);
    assert.equal(abdeckung.get("src/de/x/A.java")!.get(3), 2, "beide Berichte tragen ihre Hits bei");
  });
  test("Multi-Modul: ein Glob mit zwei Berichten liest beide; eine Datei des zweiten Moduls wird gemessen, dieselbe Datei in beiden Berichten gemischt", () => {
    const foo = "modul-b/src/main/java/de/anders/Foo.java";
    const xmlB = `<report name="b"><package name="de/anders"><sourcefile name="Foo.java"><line nr="2" mi="0" ci="5" mb="0" cb="0"/></sourcefile></package><package name="de/beispiel"><sourcefile name="Rechner.java"><line nr="3" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>`;
    const d = fixture({ ...baum, "modul-b/target/site/jacoco/jacoco.xml": xmlB, [foo]: "z" });
    const r = m.ladeAbdeckung({ berichte: [jacocoBericht], rootDir: d, lies, messDateien: [foo, java], quellen: JAVA });
    assert.deepEqual(r.fehlend, []);
    assert.deepEqual(r.mehrdeutig, []);
    assert.equal(r.abdeckung.get(foo)!.get(2), 5);
    // Rechner.java steht in beiden Berichten (modul-a: ci 4, modul-b: ci 1), die einzige existierende Datei ist die in modul-a: Hits addiert
    assert.equal(r.abdeckung.get(java)!.get(3), 5);
  });
  test("fehlende Berichte: wörtlicher Pfad und Glob ohne Treffer stehen in fehlend", () => {
    const d = fixture({});
    const berichte = [{ format: "lcov", pfad: "coverage/lcov.info" }, jacocoBericht];
    const r = m.ladeAbdeckung({ berichte, rootDir: d, lies: lies, messDateien: [java], quellen: JAVA });
    assert.deepEqual(r.fehlend, ["coverage/lcov.info", "*/target/site/jacoco/jacoco.xml"]);
  });
  test("zwei Dateien zum selben JaCoCo-Schlüssel sind mehrdeutig (Kandidaten genannt), nichts wird zugeordnet", () => {
    const d = fixture({ ...baum, "modul-b/src/main/java/de/beispiel/Rechner.java": "y" });
    const r = m.ladeAbdeckung({ berichte: [jacocoBericht], rootDir: d, lies: lies, messDateien: [java], quellen: JAVA });
    assert.equal(r.mehrdeutig.length, 1);
    assert.equal(r.mehrdeutig[0].schluessel, "de/beispiel/Rechner.java");
    assert.deepEqual(r.mehrdeutig[0].kandidaten, ["modul-a/src/main/java/de/beispiel/Rechner.java", "modul-b/src/main/java/de/beispiel/Rechner.java"]);
    assert.equal(r.abdeckung.has(java), false);
  });
  test("ein Schlüssel, den kein Bericht kennt, wird nicht aufgelöst (auch nicht mehrdeutig)", () => {
    const d = fixture({ ...baum, "modul-a/src/main/java/de/beispiel/Neu.java": "z", "modul-b/src/main/java/de/beispiel/Neu.java": "z" });
    const r = m.ladeAbdeckung({ berichte: [jacocoBericht], rootDir: d, lies: lies, messDateien: ["modul-a/src/main/java/de/beispiel/Neu.java"], quellen: JAVA });
    assert.deepEqual(r.mehrdeutig, []);
    assert.equal(r.abdeckung.has("modul-a/src/main/java/de/beispiel/Neu.java"), false);
  });
  test("wurzelOrdner und existiert sind injizierbar; ohne JaCoCo-Bericht wird das Dateisystem für die Auflösung nie befragt", () => {
    const d = fixture(baum);
    let gefragt = 0;
    const r = m.ladeAbdeckung({ berichte: [{ format: "lcov", pfad: "coverage/lcov.info" }], rootDir: d, lies: lies, messDateien: ["src/a.ts"], quellen: { wurzeln: ["src"], endungen: [".ts"] }, existiert: () => (gefragt++, true) });
    assert.equal(gefragt, 0);
    assert.equal(r.abdeckung.get("src/a.ts")!.get(1), 1);
    const r2 = m.ladeAbdeckung({ berichte: [jacocoBericht], rootDir: d, lies: lies, messDateien: [java], quellen: JAVA, wurzelOrdner: ["modul-a/src/main/java", "modul-b/src/main/java"], existiert: () => true });
    assert.equal(r2.mehrdeutig.length, 1);
  });
  test("lies bekommt den absoluten Pfad im rootDir", () => {
    const d = fixture(baum);
    const gesehen: string[] = [];
    m.ladeAbdeckung({ berichte: [{ format: "lcov", pfad: "coverage/lcov.info" }], rootDir: d, lies: (p) => (gesehen.push(p), readFileSync(p, "utf8")), messDateien: [], quellen: JAVA });
    assert.deepEqual(gesehen, [join(d, "coverage", "lcov.info")]);
  });
});
