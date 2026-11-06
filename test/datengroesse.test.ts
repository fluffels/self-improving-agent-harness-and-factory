/* Datenbudget von check:size (factory#7): Block `datengroesse` der Projekt-Config, Urteil je Datei, Split-Empfehlung, Verdrahtung in check:size.
 * Fixtures tragen bewusst neutrale Namen (`daten/`, `a.json`): der Kern kennt kein Projektwort. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";
import { kopiereScripts } from "./support/scripts-kopie";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as bloeckeRoh from "../scripts/projekt-config-bloecke.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRoh from "../scripts/datengroesse-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as pcRoh from "../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sizeRoh from "../scripts/check-size.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as basisRoh from "../scripts/check-basis.mjs";

type Urteil = { datei: string; loc: number; art: string; text: string };
type Deckel = { datei: string; max: number; grund: string };
type Block = { pfade: string[]; budget: number; endungen: string[]; hinweis: string | null; deckel: Deckel[] };

const pruefeDatengroesse = (bloeckeRoh as unknown as { pruefeDatengroesse: (d: unknown) => string[] }).pruefeDatengroesse;
const pruefeDatenGroessen = (libRoh as unknown as { pruefeDatenGroessen: (s: { file: string; loc: number }[], o: { budget: number; deckel?: Deckel[] }) => Urteil[] }).pruefeDatenGroessen;
const splitEmpfehlung = (libRoh as unknown as { splitEmpfehlung: (t: string, o: { loc: number; budget: number; json?: boolean; hinweis?: string }) => string }).splitEmpfehlung;
const pc = pcRoh as unknown as { datengroesseAus: (c: unknown) => Block | null; pruefeProjektConfig: (w: unknown) => string[]; ladeProjektConfig: () => Record<string, unknown> };
const datenBefunde = (sizeRoh as unknown as { datenBefunde: (root: string, b: Block) => { rot: string[]; info: string[] } }).datenBefunde;
const strukturOrdnerBefunde = (basisRoh as unknown as { strukturOrdnerBefunde: (r: string, s: object, k?: string[], block?: string) => string[] }).strukturOrdnerBefunde;

const zeilen = (n: number): string => "x\n".repeat(n);
const gueltig = { pfade: ["daten"], budget: 100 };

describe("pruefeDatengroesse (Form des Blocks)", () => {
  test("minimal und voll gültig", () => {
    assert.deepEqual(pruefeDatengroesse(gueltig), []);
    assert.deepEqual(
      pruefeDatengroesse({ pfade: ["daten", "mehr/**"], budget: 5, endungen: [".json", ".yaml"], hinweis: "Teilung nach Einheit", deckel: [{ datei: "daten/a.json", max: 200, grund: "#9 Split" }] }),
      [],
    );
  });
  test("untere Grenze: budget 1 und max 1 sind gültig", () => {
    assert.deepEqual(pruefeDatengroesse({ pfade: ["d"], budget: 1, deckel: [{ datei: "d/a.json", max: 1, grund: "#1 x" }] }), []);
  });
  test("kein Objekt, unbekannter Schlüssel", () => {
    assert.match(pruefeDatengroesse("x").join(), /datengroesse muss ein Objekt/);
    assert.match(pruefeDatengroesse(null).join(), /datengroesse muss ein Objekt/);
    assert.deepEqual(pruefeDatengroesse(undefined), []);
    assert.match(pruefeDatengroesse({ ...gueltig, zufall: 1 }).join(), /datengroesse\.zufall ist kein bekannter Schlüssel/);
  });
  test("pfade: Pflicht, nicht leer, nur gültige Globs", () => {
    assert.match(pruefeDatengroesse({ budget: 5 }).join(), /datengroesse\.pfade muss eine nicht-leere Liste/);
    assert.match(pruefeDatengroesse({ pfade: [], budget: 5 }).join(), /datengroesse\.pfade muss eine nicht-leere Liste/);
    assert.match(pruefeDatengroesse({ pfade: "daten", budget: 5 }).join(), /datengroesse\.pfade muss eine nicht-leere Liste/);
    assert.match(pruefeDatengroesse({ pfade: ["/abs"], budget: 5 }).join(), /datengroesse\.pfade/);
  });
  test("budget: positive Ganzzahl", () => {
    for (const b of [0, -1, 1.5, "100", undefined]) assert.match(pruefeDatengroesse({ pfade: ["daten"], budget: b }).join(), /datengroesse\.budget muss eine positive Ganzzahl/, String(b));
  });
  test("endungen, hinweis", () => {
    assert.match(pruefeDatengroesse({ ...gueltig, endungen: ["json"] }).join(), /datengroesse\.endungen\[0\] muss eine Endung mit Punkt/);
    assert.match(pruefeDatengroesse({ ...gueltig, endungen: [] }).join(), /datengroesse\.endungen muss eine nicht-leere Liste/);
    assert.match(pruefeDatengroesse({ ...gueltig, hinweis: "  " }).join(), /datengroesse\.hinweis muss ein nicht-leerer String/);
  });
  test("deckel: Liste, Ticket im Grund, keine Doppelten, max positive Ganzzahl", () => {
    assert.match(pruefeDatengroesse({ ...gueltig, deckel: "x" }).join(), /datengroesse\.deckel muss eine Liste/);
    assert.match(pruefeDatengroesse({ ...gueltig, deckel: [{ datei: "daten/a.json", max: 200, grund: "ohne Nummer" }] }).join(), /deckel\[0\]\.grund muss ein Ticket #<nr> nennen/);
    const doppelt = { datei: "daten/a.json", max: 200, grund: "#9 x" };
    assert.match(pruefeDatengroesse({ ...gueltig, deckel: [doppelt, doppelt] }).join(), /deckel\[1\]\.datei „daten\/a\.json“ steht doppelt/);
    for (const m of [0, 1.5, "200", undefined]) {
      assert.match(pruefeDatengroesse({ ...gueltig, deckel: [{ datei: "daten/a.json", max: m, grund: "#9 x" }] }).join(), /deckel\[0\]\.max muss eine positive Ganzzahl/, String(m));
    }
    for (const e of ["x", null]) assert.deepEqual(pruefeDatengroesse({ ...gueltig, deckel: [e] }), ["datengroesse.deckel[0] muss ein Objekt { datei, grund } sein"], String(e));
  });
});

describe("datengroesseAus und pruefeProjektConfig", () => {
  test("ohne Block null (Datenbudget aus), mit Block normalisiert", () => {
    assert.equal(pc.datengroesseAus({}), null);
    assert.equal(pc.datengroesseAus(undefined), null);
    assert.deepEqual(pc.datengroesseAus({ datengroesse: gueltig }), { pfade: ["daten"], budget: 100, endungen: [".json"], hinweis: null, deckel: [] });
    const voll = { pfade: ["d"], budget: 3, endungen: [".yaml"], hinweis: "h", deckel: [{ datei: "d/a.yaml", max: 9, grund: "#1 x" }] };
    assert.deepEqual(pc.datengroesseAus({ datengroesse: voll }), voll);
  });
  test("kaputter Block wirft mit Fix-Zeile", () => {
    assert.throws(() => pc.datengroesseAus({ datengroesse: { pfade: ["daten"] } }), /datengroesse\.budget[\s\S]*Fix:/);
  });
  test("pruefeProjektConfig lehnt einen kaputten Block ab, den Standard nimmt sie an", () => {
    const basis = pc.ladeProjektConfig();
    assert.deepEqual(pc.pruefeProjektConfig({ ...basis, datengroesse: gueltig }), []);
    assert.match(pc.pruefeProjektConfig({ ...basis, datengroesse: { pfade: [], budget: 0 } }).join(), /datengroesse\.pfade/);
  });
});

describe("pruefeDatenGroessen (Urteile)", () => {
  const budget = 100;
  const a = (loc: number) => [{ file: "daten/a.json", loc }];
  const deckel = [{ datei: "daten/a.json", max: 300, grund: "#9 Split" }];
  test("Grenze: loc == budget grün, budget+1 rot", () => {
    assert.deepEqual(pruefeDatenGroessen(a(100), { budget }), []);
    const u = pruefeDatenGroessen(a(101), { budget });
    assert.equal(u.length, 1);
    assert.equal(u[0].art, "ueber-budget");
    assert.match(u[0].text, /daten\/a\.json: 101 Zeilen > Datenbudget 100 ohne Deckel/);
  });
  test("Deckel: gleich = geduldet, darüber rot, darunter rot (senken)", () => {
    assert.equal(pruefeDatenGroessen(a(300), { budget, deckel })[0].art, "geduldet");
    assert.equal(pruefeDatenGroessen(a(301), { budget, deckel })[0].art, "ueber-max");
    const unter = pruefeDatenGroessen(a(299), { budget, deckel })[0];
    assert.equal(unter.art, "unter-max");
    assert.match(unter.text, /Deckel auf 299 senken/);
  });
  test("Deckel ohne Datei oder mit Datei unter Budget ist stale", () => {
    const fehlt = pruefeDatenGroessen([], { budget, deckel });
    assert.equal(fehlt[0].art, "stale");
    assert.match(fehlt[0].text, /existiert nicht mehr/);
    assert.deepEqual(pruefeDatenGroessen(a(101), { budget, deckel }).map((x) => x.art), ["unter-max"], "budget+1 mit Deckel ist nicht stale");
    const klein = pruefeDatenGroessen(a(100), { budget, deckel });
    assert.equal(klein[0].art, "stale");
    assert.match(klein[0].text, /liegt nicht mehr über 100 Zeilen/);
  });
  test("andere Datei ohne Deckel bleibt rot neben einer gedeckelten", () => {
    const u = pruefeDatenGroessen([...a(300), { file: "daten/b.json", loc: 150 }], { budget, deckel });
    assert.deepEqual(u.map((x) => [x.datei, x.art]), [["daten/a.json", "geduldet"], ["daten/b.json", "ueber-budget"]]);
  });
});

describe("splitEmpfehlung", () => {
  const obj = (n: number, tief = 1) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, Array.from({ length: tief * (i + 1) }, (_, j) => ({ j }))]));
  test("Objekt mit mehreren Schlüsseln: Teilung der obersten Ebene, größte drei absteigend, Mindestzahl Dateien", () => {
    const t = JSON.stringify(obj(5), null, 2);
    const e = splitEmpfehlung(t, { loc: 250, budget: 100 });
    assert.match(e, /mindestens 3 Dateien zu je ≤ 100 Zeilen/);
    assert.match(e, /Teilungsebene \$: 5 Schlüssel; größte: k4 \(≈\d+ Zeilen\), k3 \(≈\d+ Zeilen\), k2 \(≈\d+ Zeilen\)\./);
    assert.doesNotMatch(e, /k1 \(/);
    assert.doesNotMatch(e, /Projekt-Hinweis/);
  });
  test("ein einzelner Wrapper-Schlüssel um ein Array: Abstieg, Ort steht im Text", () => {
    const t = JSON.stringify({ liste: [{ a: 1 }, { a: 2 }] }, null, 2);
    const e = splitEmpfehlung(t, { loc: 150, budget: 100 });
    assert.match(e, /Teilungsebene \$\.liste: 2 Einträge/);
    assert.match(e, /\[0\] \(≈3 Zeilen\)/);
  });
  test("ein Kind allein über dem Budget: eine Ebene tiefer teilen", () => {
    const t = JSON.stringify({ gross: Array.from({ length: 60 }, (_, i) => ({ i })), klein: [] }, null, 2);
    assert.match(splitEmpfehlung(t, { loc: 400, budget: 50 }), /gross liegt allein über dem Budget: eine Ebene tiefer teilen/);
    assert.doesNotMatch(splitEmpfehlung(JSON.stringify({ a: [], b: [] }, null, 2), { loc: 400, budget: 50 }), /eine Ebene tiefer/);
  });
  test("ungültiges JSON, Skalar, Nicht-JSON-Endung und nicht weiter gliederbare Struktur: generische Teilung", () => {
    assert.match(splitEmpfehlung("{ kaputt", { loc: 300, budget: 100 }), /mindestens 3 Dateien[\s\S]*nach inhaltlicher Einheit teilen/i);
    assert.match(splitEmpfehlung("42", { loc: 300, budget: 100 }), /nach inhaltlicher Einheit teilen/i);
    assert.match(splitEmpfehlung(JSON.stringify({ a: [], b: [] }), { loc: 300, budget: 100, json: false }), /nach inhaltlicher Einheit teilen/i);
    assert.doesNotMatch(splitEmpfehlung(JSON.stringify({ a: [], b: [] }), { loc: 300, budget: 100, json: false }), /Teilungsebene/);
    assert.match(splitEmpfehlung(JSON.stringify({ nur: 1 }), { loc: 300, budget: 100 }), /lässt sich nicht weiter gliedern/);
  });
  test("null als Wert, leeres Kind und Array in Array: kein Absturz, richtiger Ort", () => {
    assert.match(splitEmpfehlung("null", { loc: 300, budget: 100 }), /nach inhaltlicher Einheit teilen/i);
    assert.match(splitEmpfehlung(JSON.stringify({ w: null }), { loc: 300, budget: 100 }), /Struktur unter \$ lässt sich nicht weiter gliedern/);
    assert.match(splitEmpfehlung(JSON.stringify({ a: [] }), { loc: 300, budget: 100 }), /Struktur unter \$\.a lässt sich nicht weiter gliedern/);
    assert.match(splitEmpfehlung(JSON.stringify([[{ a: 1 }, { a: 2 }]]), { loc: 300, budget: 100 }), /Teilungsebene \$\[0\]: 2 Einträge/);
  });
  test("Kind genau auf dem Budget ist nicht über dem Budget, eines mehr schon", () => {
    const mit = (n: number) => splitEmpfehlung(JSON.stringify({ g: Array.from({ length: n }, (_, i) => i), k: [] }, null, 2), { loc: 400, budget: 100 });
    assert.match(mit(98), /g \(≈100 Zeilen\)/);
    assert.doesNotMatch(mit(98), /eine Ebene tiefer/);
    assert.match(mit(99), /g liegt allein über dem Budget: eine Ebene tiefer teilen/);
  });
  test("der Projekt-Hinweis wird angehängt", () => {
    assert.match(splitEmpfehlung("{ kaputt", { loc: 300, budget: 100, hinweis: "Teilung je Einheit X" }), /Projekt-Hinweis: Teilung je Einheit X$/);
  });
  test("Mindestzahl rundet auf", () => {
    assert.match(splitEmpfehlung("{ kaputt", { loc: 101, budget: 100 }), /mindestens 2 Dateien/);
    assert.match(splitEmpfehlung("{ kaputt", { loc: 200, budget: 100 }), /mindestens 2 Dateien/);
  });
});

describe("strukturOrdnerBefunde mit eigenem Block", () => {
  test("die Meldung nennt den Blocknamen statt struktur", () => {
    const d = fixture({ "x.txt": "x" });
    const b = strukturOrdnerBefunde(d, { pfade: ["daten"] }, ["pfade"], "datengroesse");
    assert.equal(b.length, 1);
    assert.match(b[0], /^datengroesse\.pfade\[0\] in \.factory\/projekt\.json nennt „daten\/“/);
    assert.match(b[0], /oder datengroesse\.pfade in/);
    assert.doesNotMatch(b[0], /struktur/);
    assert.match(strukturOrdnerBefunde(d, { pfade: ["d*"] }, ["pfade"], "datengroesse")[0], /^datengroesse\.pfade\[0\].*Glob[\s\S]*aus datengroesse\.pfade in/);
  });
});

describe("datenBefunde", () => {
  const block = (extra: Partial<Block> = {}): Block => ({ pfade: ["daten"], budget: 10, endungen: [".json"], hinweis: null, deckel: [], ...extra });
  const wurzel = () => fixture({ "daten/klein.json": zeilen(10), "daten/gross.json": JSON.stringify({ a: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], b: [1] }, null, 2), "daten/notiz.txt": JSON.stringify({ a: Array.from({ length: 60 }, (_, i) => i), b: [1, 2] }, null, 2), "andere/riesig.json": zeilen(500) });
  test("rot nur für die große JSON-Datei unter dem Datenpfad, mit Split-Empfehlung und Hinweis", () => {
    const { rot, info } = datenBefunde(wurzel(), block({ hinweis: "Projekttext" }));
    assert.equal(rot.length, 1);
    assert.match(rot[0], /^daten\/gross\.json: \d+ Zeilen > Datenbudget 10 ohne Deckel\n {2}Split-Empfehlung: Teilen in mindestens/);
    assert.match(rot[0], /Teilungsebene \$: 2 Schlüssel; größte: a \(/);
    assert.match(rot[0], /Projekt-Hinweis: Projekttext/);
    assert.deepEqual(info, []);
  });
  test("Datei darunter bleibt grün (Budget groß genug)", () => {
    assert.deepEqual(datenBefunde(wurzel(), block({ budget: 1000 })), { rot: [], info: [] });
  });
  test("eigene Endungen: .txt wird dann gemessen und bekommt die generische Empfehlung", () => {
    const { rot } = datenBefunde(wurzel(), block({ endungen: [".txt"] }));
    assert.equal(rot.length, 1);
    assert.match(rot[0], /^daten\/notiz\.txt: \d+ Zeilen/);
    assert.doesNotMatch(rot[0], /Teilungsebene/);
    assert.match(rot[0], /nach inhaltlicher Einheit teilen/i);
  });
  test("Deckel: gleich geduldet (info), darüber rot mit Rebase-Hinweis, darunter rot", () => {
    const d = wurzel();
    const gemessen = Number(/: (\d+) Zeilen/.exec(datenBefunde(d, block()).rot[0])?.[1]);
    const mit = (max: number) => datenBefunde(d, block({ deckel: [{ datei: "daten/gross.json", max, grund: "#9 Split" }] }));
    assert.deepEqual(mit(gemessen).rot, []);
    assert.match(mit(gemessen).info[0], /Deckel .* – #9 Split/);
    assert.match(mit(gemessen - 1).rot[0], /Deckel .*teilen statt wachsen[\s\S]*datengroesse\.deckel[\s\S]*Split-Empfehlung/);
    assert.match(mit(gemessen + 1).rot[0], /Deckel auf \d+ senken[\s\S]*datengroesse\.deckel/);
    assert.doesNotMatch(mit(gemessen + 1).rot[0], /Split-Empfehlung/);
  });
  test("stale Deckel und fehlender Datenordner sind rot", () => {
    const stale = datenBefunde(wurzel(), block({ budget: 1000, deckel: [{ datei: "daten/weg.json", max: 5, grund: "#9 x" }] }));
    assert.match(stale.rot.join(), /Deckel-Eintrag stale: daten\/weg\.json/);
    const fehlt = datenBefunde(wurzel(), block({ pfade: ["gibtesnicht"] }));
    assert.match(fehlt.rot[0], /datengroesse\.pfade\[0\][\s\S]*Fix:/);
  });
});

describe("check:size als Kindlauf (Verdrahtung, No-op ohne Block)", { timeout: 60_000 }, () => {
  const repo = (datengroesse: unknown): string => {
    const d = fixture({ "lib/klein.ts": "x\n", "daten/a.json": JSON.stringify({ a: [1, 2, 3], b: [4] }, null, 2) });
    kopiereScripts(d);
    mkdirSync(join(d, ".factory"));
    const rest = { ...pc.ladeProjektConfig() };
    delete rest.ausnahmen;
    delete rest.datengroesse;
    const config = { ...rest, struktur: { quelle: "lib", moduldoku: null }, ...(datengroesse === undefined ? {} : { datengroesse }) };
    writeFileSync(join(d, ".factory", "projekt.json"), JSON.stringify(config));
    return d;
  };
  const lauf = (d: string) => {
    const r = spawnSync(process.execPath, [join(d, "scripts", "check-size.mjs")], { encoding: "utf8", cwd: d, timeout: 30_000 });
    return { status: r.status, text: `${r.stderr}${r.stdout}` };
  };
  test("ohne Block: grün und keine Daten-Meldung", () => {
    const r = lauf(repo(undefined));
    assert.equal(r.status, 0, r.text);
    assert.doesNotMatch(r.text, /Daten|daten/);
  });
  test("Datei über dem Budget: Exit 1 mit Split-Empfehlung und Deckel-Hinweis", () => {
    const r = lauf(repo({ pfade: ["daten"], budget: 3, hinweis: "Projekttext" }));
    assert.equal(r.status, 1, r.text);
    assert.match(r.text, /✖ daten\/a\.json: \d+ Zeilen > Datenbudget 3 ohne Deckel/);
    assert.match(r.text, /Split-Empfehlung: Teilen in mindestens/);
    assert.match(r.text, /Projekt-Hinweis: Projekttext/);
    assert.match(r.text, /einfrieren unter datengroesse\.deckel/);
  });
  test("Datei darunter: Exit 0 mit grüner Datenzeile", () => {
    const r = lauf(repo({ pfade: ["daten"], budget: 1000 }));
    assert.equal(r.status, 0, r.text);
    assert.match(r.text, /✔ Datendateien ≤ 1000 Zeilen \(0 Deckel\)/);
  });
  test("fehlender Datenordner: Exit 1 mit Fix-Zeile; kaputter Block: Exit 1 mit Fix-Zeile", () => {
    const fehlt = lauf(repo({ pfade: ["gibtesnicht"], budget: 5 }));
    assert.equal(fehlt.status, 1, fehlt.text);
    assert.match(fehlt.text, /datengroesse\.pfade\[0\][\s\S]*Fix:/);
    const kaputt = lauf(repo({ pfade: ["daten"] }));
    assert.equal(kaputt.status, 1, kaputt.text);
    assert.match(kaputt.text, /datengroesse\.budget[\s\S]*Fix:/);
  });
});
