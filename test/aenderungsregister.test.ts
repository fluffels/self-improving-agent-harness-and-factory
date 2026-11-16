/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- Fixtures und Ergebnisse sind untypisiertes JSON */
/* Wirkungsprüfung des Änderungsregisters (factory#572): Urteile, Fund-Regel, Überlappung, Ticket-Dedupe, Bezieher-Abbruch. Nur Fixtures, kein Netz. */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importHuelle } from "./support/import-huelle";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libModul from "../scripts/aenderungsregister-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliModul from "../scripts/aenderungsregister.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as specModul from "../scripts/spezifikation-lib.mjs";
import { echteSpezifikation } from "./support/echte-sprache";

type Z = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Export = { quelle: string; punkte: Z[] };
const lib = libModul as unknown as {
  leseMesspunkte: (j: unknown, p: string) => Export;
  basisFenster: (z: Z) => { von: string; bis: string } | null;
  aggregiere: (art: string, w: number[]) => number | null;
  abweichung: (b: number, n: number, e: string) => number | null;
  urteilZeile: (z: Z, k: Z, o: Z) => Z;
  bereichKontext: (e: Export[], b: string, o: Z) => Z;
  ueberlappungen: (z: Z[]) => string[][];
  auswertung: (r: Z, e: Export[], o: Z) => { heute: string; zeilen: Z[] };
  ticketGruppen: (e: Z, r: Z) => Z[];
  ticketBody: (g: Z) => { titel: string; body: string };
  markerFuer: (id: string) => string;
  renderMarkdown: (e: Z, t?: string[]) => string;
  pruefeRegister: (z: unknown) => string[];
};
const cli = cliModul as unknown as { parseArgs: (a: string[]) => Z; anlegeArgumente: (a: Z) => string[]; auswerten: (a: Z, d?: Z) => { exitCode: number; text: string } };
const spec = specModul as unknown as { pruefeEingang: (i: Z, o: Z) => { art: string; fehlt?: string[] } };

const FIX = join(__dirname, "fixtures", "aenderungsregister");
const laden = (n: string): Z => JSON.parse(readFileSync(join(FIX, n), "utf8"));
const register = laden("register.json");
const exp = (n: string): Export => lib.leseMesspunkte(laden(n), n);
const FABRIK = exp("messpunkte-fabrik.json");
const LANGFUSE = exp("messpunkte-langfuse.json");
const O = { eigenerRepoTag: "fix-fabrik" };

const punkte = (mg: string, werte: number[], zeiten: string[], extra: Z = {}) => werte.map((wert, i) => ({ messgroesse: mg, zeitpunkt: zeiten[i], einheitId: `${mg}-${zeiten[i]}-${i}`, wert, ...extra }));
const BASIS_Z = ["2026-09-10", "2026-09-20"];
const NACH_Z = ["2026-10-10", "2026-10-20"];
/** Eine einzelne fällige Zeile (nur ein Qualitätsmaß), damit keine Überlappung dazwischenkommt. */
const zeile = (extra: Z = {}): Z => ({ ...register.zeilen[0], id: "solo", ...extra });
const nurQualitaet = (basis: number[], nach: number[], mg = "nacharbeit-quote", extra: Z = {}): Export[] => [
  { quelle: MG_QUELLE[mg], punkte: [...punkte(mg, basis, BASIS_Z, extra), ...punkte(mg, nach, NACH_Z, extra)] },
];
const MG_QUELLE: Record<string, string> = { "nacharbeit-quote": "lauf-ergebnis", "ci-fix-runden": "lauf-ergebnis", "blocker-schwere-brille": "lauf-ergebnis", "kosten-je-ticket-rolle": "langfuse" };
const solo = (z: Z, e: Export[], heute = "2026-11-16") => lib.auswertung({ zeilen: [z] }, e, { heute, ...O }).zeilen[0].fabrik as Z;

describe("Urteile je Zeile", () => {
  it("eingehalten: Abweichung innerhalb der Toleranz, mit Messwert, Basis, Toleranz", () => {
    const u = solo(zeile({ messgroesse: "ci-fix-runden", parameter: undefined }), nurQualitaet([10, 10], [11, 11]));
    expect(u).toMatchObject({ urteil: "eingehalten", messwert: 11, basis: 10, abweichung: 1, toleranz: { schwelle: 2 } });
  });
  it("Verstoß: Abweichung über der Schwelle (steigt); genau die Schwelle ist noch eingehalten", () => {
    const z = zeile({ messgroesse: "ci-fix-runden", parameter: undefined });
    expect(solo(z, nurQualitaet([10, 10], [12.5, 12.5])).urteil).toBe("Verstoß");
    expect(solo(z, nurQualitaet([10, 10], [12, 12])).urteil).toBe("eingehalten");
  });
  it("Verstoß bei richtung faellt: unter −Schwelle", () => {
    const z = zeile({ messgroesse: "ci-fix-runden", parameter: undefined, toleranz: { ...zeile().toleranz, richtung: "faellt" } });
    expect(solo(z, nurQualitaet([10, 10], [7, 7])).urteil).toBe("Verstoß");
    expect(solo(z, nurQualitaet([10, 10], [13, 13])).urteil).toBe("eingehalten");
  });
  it("Prozent: Basis 0 ist eine Lücke mit Grund, nie ein Wert", () => {
    const z = zeile({ messgroesse: "ci-fix-runden", parameter: undefined, toleranz: { ...zeile().toleranz, einheit: "prozent" } });
    const u = solo(z, nurQualitaet([0, 0], [1, 1]));
    expect(u).toMatchObject({ urteil: "Lücke", messwert: null, grund: "Prozent bei Basis 0 nicht berechenbar" });
    expect(lib.abweichung(10, 12, "prozent")).toBeCloseTo(20);
  });
  it("noch nicht fällig vor dem Prüftermin, am Prüftermin fällig", () => {
    expect(solo(zeile(), [], "2026-10-28").urteil).toBe("noch nicht fällig");
    expect(solo(zeile(), [], "2026-10-29").urteil).toBe("Lücke");
  });
  it("basis.wert ersetzt das Basis-Aggregat; Freitext-Fenster ohne basis.wert ist eine Lücke", () => {
    const z = zeile({ messgroesse: "ci-fix-runden", parameter: undefined });
    const nach = nurQualitaet([], [20, 20]);
    expect(solo({ ...z, basis: { fenster: "irgendwann", wert: 10 } }, nach).urteil).toBe("Verstoß");
    expect(solo({ ...z, basis: { fenster: "irgendwann", wert: null } }, nach)).toMatchObject({ urteil: "Lücke", messwert: null, grund: "Basisfenster nicht auswertbar: irgendwann" });
    expect(lib.basisFenster({ datum: "2026-10-01", basis: { fenster: "4 Wochen vor Merge" } })).toEqual({ von: "2026-09-03", bis: "2026-09-30" });
  });
  it("Aggregation: Kosten Median, Qualität Mittelwert", () => {
    expect(lib.aggregiere("kosten", [1, 100, 3])).toBe(3);
    expect(lib.aggregiere("kosten", [1, 3])).toBe(2);
    expect(lib.aggregiere("qualitaet", [1, 2, 6])).toBe(3);
    expect(lib.aggregiere("kosten", [])).toBeNull();
  });
});

describe("Negativfälle (AK 8): Lücke mit Grund, nie eingehalten, nie 0, übrige Zeilen laufen weiter", () => {
  const prüfe = (e: Export[], teil: RegExp) => {
    const erg = lib.auswertung(register, e, { heute: "2026-11-16", ...O });
    const f = erg.zeilen[0].fabrik as Z;
    expect(f.urteil).toBe("Lücke");
    expect(f.grund).toMatch(teil);
    expect(f.messwert).toBeNull();
    expect(erg.zeilen[1].fabrik.urteil).toBe("noch nicht fällig");
  };
  it("fehlender Export", () => prüfe([], /Export fehlt/));
  it("fehlender Repo-Tag (langfuse): die Kosten sind eine Lücke mit Grund, nie ein Wert", () => {
    const u = lib.auswertung(register, [FABRIK, exp("messpunkte-ohne-repotag.json")], { heute: "2026-11-16", ...O }).zeilen[0].fabrik as Z;
    expect(u.kosten).toEqual({ luecke: "Repo-Tag fehlt im Export (Quelle langfuse)" });
    const k = lib.bereichKontext([exp("messpunkte-ohne-repotag.json")], "fabrik", O);
    expect(k.langfuse).toEqual({ grund: "Repo-Tag fehlt im Export (Quelle langfuse)" });
  });
  it("weniger Läufe als mindestdaten", () => prüfe([exp("messpunkte-zu-wenig.json"), LANGFUSE], /weniger Läufe als mindestdaten \(1 < 2/));
  it("Kosten-Export fehlt: Urteil bleibt, Kosten sind eine Lücke", () => {
    const u = lib.auswertung(register, [FABRIK], { heute: "2026-11-16", ...O }).zeilen[0].fabrik as Z;
    expect(u.urteil).toBe("Überlappung");
    expect(u.kosten.luecke).toMatch(/Export fehlt/);
  });
});

describe("Kosten berichten, Qualität zählt", () => {
  const e = (nach: number[]): Export[] => [
    ...nurQualitaet([10, 10], [10, 10]),
    { quelle: "langfuse", punkte: [...punkte("kosten-je-ticket-rolle", [5, 5], BASIS_Z, { parameter: "planer", repoTag: "fix-fabrik" }), ...punkte("kosten-je-ticket-rolle", nach, NACH_Z, { parameter: "planer", repoTag: "fix-fabrik" })] },
  ];
  it("Ersparnis ausgeblieben: Vermerk, kein Verstoß, kein Ticket", () => {
    const erg = lib.auswertung({ zeilen: [zeile()] }, e([6, 6]), { heute: "2026-11-16", ...O });
    expect(erg.zeilen[0].fabrik).toMatchObject({ urteil: "eingehalten", kosten: { basis: 5, nach: 6, vermerk: "Wirkung ausgeblieben" } });
    expect(lib.ticketGruppen(erg, { zeilen: [zeile()] })).toEqual([]);
  });
  it("Ersparnis eingetreten: kein Vermerk", () => {
    expect(solo(zeile(), e([4, 4])).kosten.vermerk).toBeNull();
  });
});

describe("Fund-Regel (blocker-schwere-brille)", () => {
  const z = (richtung: string) => zeile({ messgroesse: "blocker-schwere-brille", parameter: "doku", toleranz: { qualitaetsmass: "blocker-schwere-brille", richtung, schwelle: 1, einheit: "absolut" } });
  const funde = (basis: number[], nach: number[], nacharbeit: [number[], number[]] | null): Export[] => [
    { quelle: "lauf-ergebnis", punkte: [...punkte("blocker-schwere-brille", basis, BASIS_Z, { parameter: "doku" }), ...punkte("blocker-schwere-brille", nach, NACH_Z, { parameter: "doku" }), ...(nacharbeit ? [...punkte("nacharbeit-quote", nacharbeit[0], BASIS_Z), ...punkte("nacharbeit-quote", nacharbeit[1], NACH_Z)] : [])] },
  ];
  it("mehr Funde sind nie ein Verstoß, nur ein Vermerk", () => {
    expect(solo(z("steigt"), funde([1, 1], [9, 9], null))).toMatchObject({ urteil: "eingehalten", vermerk: "mehr Funde (kein Verstoß)" });
  });
  it("weniger Funde ohne steigende Nacharbeit: eingehalten", () => {
    expect(solo(z("faellt"), funde([5, 5], [1, 1], [[10, 10], [10, 10]])).urteil).toBe("eingehalten");
  });
  it("weniger Funde mit steigender Nacharbeit: Verstoß", () => {
    expect(solo(z("faellt"), funde([5, 5], [1, 1], [[10, 10], [14, 14]])).urteil).toBe("Verstoß");
  });
  it("weniger Funde und Nacharbeit fehlt: Lücke", () => {
    expect(solo(z("faellt"), funde([5, 5], [1, 1], null))).toMatchObject({ urteil: "Lücke", messwert: null });
  });
});

describe("Überlappung", () => {
  it("die Fixture-Zeilen berühren sich: beide Ids im Urteil, Einzelurteil bleibt sichtbar", () => {
    const erg = lib.auswertung(register, [FABRIK, LANGFUSE], { heute: "2026-11-16", ...O });
    expect(erg.zeilen[0].fabrik).toMatchObject({ urteil: "Überlappung", mit: ["fix-faellig", "fix-ueberlappt"], verstoss: false, einzel: "eingehalten" });
    expect(erg.zeilen[2].fabrik.urteil).toBe("Überlappung");
    expect(erg.zeilen[1].fabrik.urteil).toBe("noch nicht fällig");
    expect(lib.renderMarkdown(erg)).toContain("fix-faellig, fix-ueberlappt");
  });
  it("Fenster ohne Berührung und ohne gemeinsame Rolle, Messgröße oder Maß überlappen nicht", () => {
    const a = register.zeilen[0];
    expect(lib.ueberlappungen([a, { ...register.zeilen[2], datum: "2026-11-10", pruefTermin: "2026-12-08" }])).toEqual([]);
    expect(lib.ueberlappungen([a, { ...register.zeilen[2], toleranz: { ...a.toleranz, qualitaetsmass: "ci-fix-runden" } }])).toEqual([]);
  });
  it("ein Verstoß in einer Überlappung: eine Gruppe mit allen Ids, ohne automatischen Rückfall", () => {
    const e = FABRIK.punkte.map((p) => (p.messgroesse === "nacharbeit-quote" && p.zeitpunkt.startsWith("2026-10") ? { ...p, wert: 30 } : p));
    const erg = lib.auswertung(register, [{ quelle: "lauf-ergebnis", punkte: e }, LANGFUSE], { heute: "2026-11-16", ...O });
    const gruppen = lib.ticketGruppen(erg, register);
    expect(gruppen).toHaveLength(1);
    expect(gruppen[0].ids).toEqual(["fix-faellig", "fix-ueberlappt"]);
    const t = lib.ticketBody(gruppen[0]);
    expect(t.body).toContain(lib.markerFuer("fix-faellig"));
    expect(t.body).toContain(lib.markerFuer("fix-ueberlappt"));
    expect(t.body).toContain("kein automatischer Rückfall");
  });
});

describe("Bezieher getrennt und anonym", () => {
  it("vor factory#523 (REPO_TAG_AB null) ist der Bezieher-Teil immer eine Lücke mit diesem Grund", () => {
    const erg = lib.auswertung(register, [FABRIK, LANGFUSE], { heute: "2026-11-16", ...O });
    expect(erg.zeilen[0].bezieher).toMatchObject({ urteil: "Lücke", grund: "Repo-Tag fehlt (factory#523)", messwert: null });
  });
  it("mit Stichtag: fremde Tags zählen aggregiert, der Tag steht nie im Bericht", () => {
    const erg = lib.auswertung(register, [FABRIK, LANGFUSE], { heute: "2026-11-16", ...O, repoTagAb: "2026-01-01" });
    const b = erg.zeilen[0].bezieher as Z;
    expect(b).toMatchObject({ bereich: "bezieher", urteil: "Lücke", messwert: null });
    expect(b.grund).toContain("Quelle nur in der Fabrik");
    expect(b.kosten).toMatchObject({ basis: 9, nach: 9, vermerk: "Wirkung ausgeblieben" });
    const k = lib.bereichKontext([LANGFUSE], "bezieher", { ...O, repoTagAb: "2026-01-01" });
    expect(k.langfuse.punkte).toHaveLength(4);
    const text = JSON.stringify(erg) + lib.renderMarkdown(erg);
    expect(text).not.toContain("fix-fremd");
    expect(text).not.toContain("fix-fabrik");
  });
  it("Quellen außerhalb von Langfuse gelten nur für die Fabrik", () => {
    const k = lib.bereichKontext([FABRIK], "bezieher", { ...O, repoTagAb: "2026-01-01" });
    expect(k["lauf-ergebnis"]).toEqual({ grund: "Quelle nur in der Fabrik" });
  });
});

describe("Messpunkte-Export: Form", () => {
  it("jede Formabweichung wirft, nie ein Teilwert", () => {
    const p = { messgroesse: "nacharbeit-quote", zeitpunkt: "2026-10-10", einheitId: "a", wert: 1 };
    const e = (x: Z) => ({ art: "aenderungsregister-messpunkte", quelle: "lauf-ergebnis", punkte: [{ ...p, ...x }] });
    expect(() => lib.leseMesspunkte(e({}), "x")).not.toThrow();
    for (const schlecht of [{ wert: "1" }, { wert: Infinity }, { zeitpunkt: "gestern" }, { zeitpunkt: 3 }, { einheitId: "" }, { messgroesse: "kosten-alles" }, { repoTag: 3 }, { parameter: "" }]) {
      expect(() => lib.leseMesspunkte(e(schlecht), "x")).toThrow(/punkte\[0\]/);
    }
    expect(() => lib.leseMesspunkte(null, "x")).toThrow(/art/);
    expect(() => lib.leseMesspunkte({ art: "aenderungsregister-messpunkte", quelle: "langfuse", punkte: [null] }, "x")).toThrow(/punkte\[0\]: Objekt erwartet/);
    expect(() => lib.leseMesspunkte({ art: "anders" }, "x")).toThrow(/art "aenderungsregister-messpunkte" erwartet/);
    expect(() => lib.leseMesspunkte({ art: "aenderungsregister-messpunkte", quelle: "magie", punkte: [] }, "x")).toThrow(/quelle/);
    expect(() => lib.leseMesspunkte({ art: "aenderungsregister-messpunkte", quelle: "langfuse" }, "x")).toThrow(/punkte/);
  });
  it("die Fixture-Register sind gültig", () => expect(lib.pruefeRegister(register.zeilen)).toEqual([]));
});

describe("Ticket nur bei Verstoß", () => {
  const verstoss = (): Export[] => nurQualitaet([10, 10], [30, 30], "ci-fix-runden");
  const reg = { zeilen: [zeile({ messgroesse: "ci-fix-runden", parameter: undefined, toleranz: { ...zeile().toleranz, qualitaetsmass: "ci-fix-runden" } })] };
  const dateien = (e: Export[]): Record<string, string> => ({ "reg.json": JSON.stringify(reg), "ex.json": JSON.stringify({ art: "aenderungsregister-messpunkte", quelle: e[0].quelle, punkte: e[0].punkte }) });
  const lauf = (e: Export[], extra: string[], deps: Z = {}) => {
    const f = dateien(e);
    const aufrufe: Z[] = [];
    const r = cli.auswerten(cli.parseArgs(["--register", "reg.json", "--export", "ex.json", "--heute", "2026-11-16", ...extra]), {
      lies: (p: string) => f[p] ?? "", repo: "o/r", eigenerRepoTag: "fix-fabrik", label: "area:harness", bezieher: false, heute: "2026-11-16",
      ladeTickets: () => { aufrufe.push({ art: "lade" }); return []; },
      legeAn: (a: Z) => { aufrufe.push({ art: "anlegen", ...a }); return "https://example.test/o/r/issues/99"; },
      schreibe: () => undefined, ...deps,
    });
    return { r, aufrufe };
  };
  it("Body besteht pruefeEingang (Ziel, Akzeptanzkriterien, Negativfall) und trägt den Marker", () => {
    const erg = lib.auswertung(reg, verstoss(), { heute: "2026-11-16", ...O });
    const g = lib.ticketGruppen(erg, reg);
    expect(g).toHaveLength(1);
    const t = lib.ticketBody(g[0]);
    expect(t.body).toContain("<!-- aenderungsregister:solo -->");
    expect(t.body).toContain("Revert-PR nach ADR 0027 Punkt 4");
    expect(spec.pruefeEingang({ nummer: 9999, titel: t.titel, body: t.body }, { hartAb: 1, sprache: echteSpezifikation() }).art).toBe("ok");
  });
  it("Verstoß ohne --nach: Exit 3, nichts angelegt, kein gh-Aufruf", () => {
    const { r, aufrufe } = lauf(verstoss(), []);
    expect(r.exitCode).toBe(3);
    expect(aufrufe).toEqual([]);
  });
  it("Verstoß mit --nach legt genau ein Ticket an", () => {
    const { r, aufrufe } = lauf(verstoss(), ["--nach", "5"]);
    expect(r.exitCode).toBe(0);
    expect(aufrufe.filter((a) => a.art === "anlegen")).toHaveLength(1);
    expect(aufrufe.find((a) => a.art === "anlegen")).toMatchObject({ nach: "5", label: "area:harness" });
    expect(r.text).toContain("Ticket angelegt");
  });
  it("zweite Auswertung bei vorhandenem Ticket (auch geschlossen) legt kein zweites an", () => {
    const { r, aufrufe } = lauf(verstoss(), ["--nach", "5"], { ladeTickets: () => [{ number: 7, state: "CLOSED", author: { login: "o" }, body: "x\n<!-- aenderungsregister:solo -->" }] });
    expect(r.exitCode).toBe(0);
    expect(aufrufe).toEqual([]);
    expect(r.text).toMatch(/Ticket #7 besteht/);
  });
  it("ein Ticket ohne den Marker der Id zählt nicht als Dublette", () => {
    const { aufrufe } = lauf(verstoss(), ["--nach", "5"], { ladeTickets: () => [{ number: 7, state: "OPEN", author: { login: "o" }, body: "<!-- aenderungsregister:andere -->" }] });
    expect(aufrufe.filter((a) => a.art === "anlegen")).toHaveLength(1);
  });
  it("--trocken legt nichts an und braucht kein --nach", () => {
    const { r, aufrufe } = lauf(verstoss(), ["--trocken"]);
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain("würde ein Ticket anlegen");
    expect(aufrufe.filter((a) => a.art === "anlegen")).toEqual([]);
  });
  it("scheitert die Anlage: Exit 3", () => {
    const { r } = lauf(verstoss(), ["--nach", "5"], { legeAn: () => { throw new Error("gh kaputt"); } });
    expect(r.exitCode).toBe(3);
    expect(r.text).toContain("gh kaputt");
  });
  it("ohne Verstoß (alles in der Toleranz) weder Ticket noch gh-Aufruf", () => {
    const { r, aufrufe } = lauf(nurQualitaet([10, 10], [11, 11], "ci-fix-runden"), ["--nach", "5"]);
    expect(r.exitCode).toBe(0);
    expect(aufrufe).toEqual([]);
  });
});

describe("CLI", () => {
  const basis = { bezieher: false, heute: "2026-11-16", eigenerRepoTag: "fix-fabrik", repo: "o/r", label: "x" };
  const args = ["--register", join(FIX, "register.json"), "--export", join(FIX, "messpunkte-fabrik.json")];
  it("Bezieher: Abbruch mit Exit 4 und Meldung, vor jeder Arbeit (auch bei Aufruffehlern)", () => {
    for (const a of [args, ["--unbekannt"]]) {
      const r = cli.auswerten(cli.parseArgs(a), { ...basis, bezieher: true, ladeTickets: () => { throw new Error("nie"); } });
      expect(r.exitCode).toBe(4);
      expect(r.text).toContain("fabrik-eigen");
    }
  });
  it("Aufruffehler: unbekannte Flagge, falsches Datum, falsches --nach: Exit 2", () => {
    for (const a of [["--unbekannt"], ["--heute", "morgen"], ["--nach", "x"]]) expect(cli.auswerten(cli.parseArgs(a), basis).exitCode).toBe(2);
  });
  it("Lesefehler: fehlende Exportdatei und ungültiges Register: Exit 1", () => {
    expect(cli.auswerten(cli.parseArgs([...args, "--export", join(FIX, "gibt-es-nicht.json")]), basis).exitCode).toBe(1);
    const r = cli.auswerten(cli.parseArgs(args), { ...basis, lies: () => JSON.stringify({ zeilen: [{ id: "x" }] }) });
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("Register ungültig");
  });
  it("Ablage im Repo wird verweigert (Exit 2), außerhalb entstehen .json und .md", () => {
    expect(cli.auswerten(cli.parseArgs([...args, "--ablage", join(__dirname, "..", "scratch")]), { ...basis, schreibe: () => undefined }).exitCode).toBe(2);
    const ordner = mkdtempSync(join(tmpdir(), "aenderungsregister-test-"));
    try {
      const r = cli.auswerten(cli.parseArgs([...args, "--ablage", ordner, "--trocken"]), { ...basis, ladeTickets: () => [] });
      expect(r.exitCode).toBe(0);
      expect(readdirSync(ordner).sort()).toEqual(["aenderungsregister-2026-11-16.json", "aenderungsregister-2026-11-16.md"]);
    } finally {
      rmSync(ordner, { recursive: true, force: true });
    }
  });
  it("--json gibt den Schnappschuss als JSON aus", () => {
    const r = cli.auswerten(cli.parseArgs([...args, "--json"]), basis);
    expect(JSON.parse(r.text).zeilen).toHaveLength(3);
  });
});

describe("Grenzen und Zweige (Review Runde 1)", () => {
  const qualitaetZeile = (extra: Z = {}): Z => zeile({ messgroesse: "ci-fix-runden", parameter: undefined, ...extra });
  const langfuse = (rows: Z[]): Export => ({ quelle: "langfuse", punkte: rows.map((r) => ({ messgroesse: "kosten-je-ticket-rolle", parameter: "planer", repoTag: "fix-fabrik", ...r })) });
  const q = (): Export => nurQualitaet([10, 10], [10, 10])[0];
  const kosten = (rows: Z[], z: Z = zeile()) => (solo(z, [q(), langfuse(rows)])).kosten as Z;
  const kost = (basis: number[], nach: number[], extra: Z = {}): Z[] => [
    ...basis.map((wert, i) => ({ zeitpunkt: BASIS_Z[i % 2], einheitId: `b${i}`, wert, ...extra })),
    ...nach.map((wert, i) => ({ zeitpunkt: NACH_Z[i % 2], einheitId: `n${i}`, wert, ...extra })),
  ];

  describe("Basisfenster und Argumente (Regex-Komponenten)", () => {
    const bf = (fenster: string) => lib.basisFenster({ datum: "2026-10-01", basis: { fenster } });
    it("nur „<n> Wochen vor Merge“ (n ≥ 1, ein oder mehrere Ziffern, Woche oder Wochen) ist auswertbar", () => {
      expect(bf("1 Woche vor Merge")).toEqual({ von: "2026-09-24", bis: "2026-09-30" });
      expect(bf("12 Wochen vor Merge")).toEqual({ von: "2026-07-09", bis: "2026-09-30" });
      for (const schlecht of ["x 4 Wochen vor Merge", "4 Wochen vor Merge!", "0 Wochen vor Merge", "4 Wochen", ""]) expect(bf(schlecht), schlecht).toBeNull();
    });
    it("--nach nimmt genau eine Ticketnummer (mit oder ohne #), sonst Aufruffehler", () => {
      for (const gut of ["5", "#5", "123"]) expect(cli.parseArgs(["--nach", gut]).fehler, gut).toBeUndefined();
      for (const schlecht of ["x5", "5x", "#", "5 5"]) expect(cli.parseArgs(["--nach", schlecht]).fehler, schlecht).toContain("--nach");
    });
    it("anlegeArgumente: #5 und 5 sind dieselbe Nummer, --label nur mit Label", () => {
      const a = cli.anlegeArgumente({ titel: "t", datei: "d", nach: "#5", label: "x" });
      expect(a[a.indexOf("--nach") + 1]).toBe("5");
      expect(a).toContain("--label");
      expect(cli.anlegeArgumente({ titel: "t", datei: "d", nach: "5", label: undefined })).not.toContain("--label");
    });
  });

  describe("Fenster, Zählung, Parameter (aggregat)", () => {
    it("Kosten zählen nur den Parameter der Zeile (planer), nicht andere Rollen", () => {
      const k = kosten([...kost([5, 5], [4, 4]), ...kost([100, 100], [100, 100], { parameter: "umsetzer", einheitId: "u" }).map((r, i) => ({ ...r, einheitId: `u${i}` }))]);
      expect(k).toMatchObject({ basis: 5, nach: 4 });
    });
    it("mindestdaten zählt verschiedene einheitId, nicht Punkte", () => {
      const doppelt = [...kost([5, 5], []), ...[0, 1, 2].map((i) => ({ zeitpunkt: NACH_Z[i % 2], einheitId: "t-1", wert: 4 }))];
      expect(kosten(doppelt).luecke).toContain("(1 < 2");
    });
    it("beide Fenstergrenzen sind inklusive (Änderungsdatum, Prüftermin, Basis von und bis)", () => {
      const rand = [
        { zeitpunkt: "2026-09-03", einheitId: "b1", wert: 5 },
        { zeitpunkt: "2026-09-30", einheitId: "b2", wert: 5 },
        { zeitpunkt: "2026-10-01", einheitId: "n1", wert: 4 },
        { zeitpunkt: "2026-10-29", einheitId: "n2", wert: 4 },
      ];
      expect(kosten(rand)).toMatchObject({ basis: 5, nach: 4 });
      const draussen = [...rand.slice(0, 2), { zeitpunkt: "2026-09-02", einheitId: "b0", wert: 99 }, { zeitpunkt: "2026-10-30", einheitId: "n0", wert: 99 }, ...rand.slice(2)];
      expect(kosten(draussen)).toMatchObject({ basis: 5, nach: 4 });
    });
  });

  describe("Lücken auf Basis- und Nachher-Seite (AK 8)", () => {
    it("Basis zu dünn bei vollem Nachher: Lücke mit Präfix „Basis:“", () => {
      expect(solo(qualitaetZeile(), nurQualitaet([10], [11, 11]))).toMatchObject({ urteil: "Lücke", messwert: null, grund: expect.stringMatching(/^Basis: weniger Läufe als mindestdaten \(1 < 2/) });
    });
    it("Nachher zu dünn bei voller Basis: Lücke mit Präfix „Nachher:“", () => {
      expect(solo(qualitaetZeile(), nurQualitaet([10, 10], [11]))).toMatchObject({ urteil: "Lücke", messwert: null, grund: expect.stringMatching(/^Nachher: weniger Läufe als mindestdaten \(1 < 2/) });
    });
    it("übrige Zeilen behalten ihr Urteil: eine Lücke neben einer ausgewerteten, fälligen Zeile", () => {
      const a = qualitaetZeile({ id: "a", toleranz: { ...zeile().toleranz, qualitaetsmass: "ci-fix-runden" } });
      const b = zeile({ id: "b", messgroesse: "nacharbeit-quote", parameter: undefined });
      const erg = lib.auswertung({ zeilen: [a, b] }, nurQualitaet([10, 10], [11, 11]), { heute: "2026-11-16", ...O });
      expect(erg.zeilen[0].fabrik).toMatchObject({ urteil: "Lücke", messwert: null });
      expect(erg.zeilen[1].fabrik).toMatchObject({ urteil: "eingehalten", messwert: 11 });
    });
  });

  describe("Kosten-Zweige", () => {
    it("eine Qualitätszeile hat kein Kostenfeld", () => {
      expect((solo(qualitaetZeile(), nurQualitaet([10, 10], [11, 11]))).kosten).toBeNull();
    });
    it("Freitext-Basis mit basis.wert: das Urteil steht, die Kosten sind eine Lücke mit Grund", () => {
      const z = zeile({ basis: { fenster: "irgendwann", wert: 10 } });
      const u = solo(z, [q(), langfuse(kost([5, 5], [4, 4]))]);
      expect(u.urteil).toBe("eingehalten");
      expect(u.kosten).toEqual({ luecke: "Basisfenster nicht auswertbar: irgendwann" });
    });
    it("fehlt die Basis oder das Nachher, ist es eine Lücke mit dem Grund der fehlenden Seite", () => {
      expect(kosten(kost([5], [4, 4])).luecke).toContain("(1 < 2");
      expect(kosten(kost([5, 5], [4])).luecke).toContain("(1 < 2");
    });
    it("gleiche Kosten sinken nicht: Wirkung ausgeblieben", () => {
      expect(kosten(kost([5, 5], [5, 5]))).toMatchObject({ basis: 5, nach: 5, vermerk: "Wirkung ausgeblieben" });
    });
  });

  describe("Fund-Regel: Grenzen und Zweige", () => {
    const z = zeile({ messgroesse: "blocker-schwere-brille", parameter: "doku", toleranz: { qualitaetsmass: "blocker-schwere-brille", richtung: "faellt", schwelle: 1, einheit: "absolut" } });
    const funde = (basis: number[], nach: number[], extra: Z[] = []): Export[] => [
      { quelle: "lauf-ergebnis", punkte: [...punkte("blocker-schwere-brille", basis, BASIS_Z, { parameter: "doku" }), ...punkte("blocker-schwere-brille", nach, NACH_Z, { parameter: "doku" }), ...extra] },
    ];
    it("genau an der Schwelle (−1 bei Schwelle 1) ist noch eingehalten, auch ohne Nacharbeit-Daten", () => {
      expect(solo(z, funde([5, 5], [4, 4])).urteil).toBe("eingehalten");
    });
    it("nicht verletzt: eingehalten, ohne die Nacharbeit zu brauchen", () => {
      expect(solo(z, funde([5, 5], [5, 5])).urteil).toBe("eingehalten");
    });
    it("fehlt die Nacharbeit der Basis (nur Nachher da): Lücke, nie eingehalten", () => {
      const u = solo(z, funde([5, 5], [1, 1], punkte("nacharbeit-quote", [14, 14], NACH_Z)));
      expect(u).toMatchObject({ urteil: "Lücke", messwert: null });
      expect(u.grund).toContain("Nacharbeit-Quote fehlt");
    });
    it("Richtung faellt bei normalem Maß: genau −Schwelle ist eingehalten, darunter Verstoß", () => {
      const n = qualitaetZeile({ toleranz: { ...zeile().toleranz, richtung: "faellt" } });
      expect(solo(n, nurQualitaet([10, 10], [8, 8])).urteil).toBe("eingehalten");
      expect(solo(n, nurQualitaet([10, 10], [7.9, 7.9])).urteil).toBe("Verstoß");
    });
  });

  describe("Bereich: Trennung und Stichtag", () => {
    it("Fabrik-Kosten zählen nur den eigenen Tag (die fremden Tags im selben Export verfälschen nichts)", () => {
      const erg = lib.auswertung(register, [FABRIK, LANGFUSE], { heute: "2026-11-16", ...O });
      expect((erg.zeilen[0].fabrik as Z).kosten).toMatchObject({ basis: 5, nach: 4 });
    });
    it("Stichtag: ein Punkt am Stichtag zählt, davor nicht", () => {
      const k = lib.bereichKontext([LANGFUSE], "bezieher", { ...O, repoTagAb: "2026-09-20" });
      expect((k.langfuse as Z).punkte).toHaveLength(3);
    });
    it("Stichtag nach dem Prüftermin: Lücke mit dem Bezieher-Grund, Kosten werden trotzdem berichtet", () => {
      const erg = lib.auswertung(register, [FABRIK, LANGFUSE], { heute: "2026-11-16", ...O, repoTagAb: "2026-11-01" });
      expect(erg.zeilen[0].bezieher).toMatchObject({ urteil: "Lücke", grund: "Repo-Tag fehlt (factory#523)" });
      expect(erg.zeilen[0].bezieher).toHaveProperty("kosten");
    });
  });

  describe("Überlappung: Berührung und Partner", () => {
    const a = register.zeilen[0] as Z;
    const kosten2 = (extra: Z): Z => ({ ...register.zeilen[2], messgroesse: "kosten-je-ticket-rolle", parameter: "planer", toleranz: { ...a.toleranz, qualitaetsmass: "ci-fix-runden" }, ...extra });
    it("gleiche Messgröße samt Parameter berührt auch bei anderem Qualitätsmaß", () => {
      expect(lib.ueberlappungen([a, kosten2({})])).toEqual([["fix-faellig", "fix-ueberlappt"]]);
    });
    it("gleiche Messgröße mit anderem Parameter und anderem Maß berührt nicht", () => {
      expect(lib.ueberlappungen([a, kosten2({ parameter: "umsetzer" })])).toEqual([]);
    });
    const verstoss = (): Export[] => [{ quelle: "lauf-ergebnis", punkte: FABRIK.punkte.map((p) => (p.messgroesse === "nacharbeit-quote" && p.zeitpunkt.startsWith("2026-10") ? { ...p, wert: 30 } : p)) }, LANGFUSE];
    const partner = (extra: Z) => ({ zeilen: [a, { ...a, id: "partner", ...extra }] });
    it("ein nicht fälliger Partner steht in mit: der Verstoß wird eine Überlappung, kein Einzel-Ticket mit Rückfall", () => {
      const reg = partner({ datum: "2026-10-20", pruefTermin: "2026-12-01" });
      const erg = lib.auswertung(reg, verstoss(), { heute: "2026-11-16", ...O });
      expect(erg.zeilen[1].fabrik.urteil).toBe("noch nicht fällig");
      expect(erg.zeilen[0].fabrik).toMatchObject({ urteil: "Überlappung", mit: ["fix-faellig", "partner"], verstoss: true, einzel: "Verstoß" });
      const g = lib.ticketGruppen(erg, reg);
      expect(g.map((x) => x.ids)).toEqual([["fix-faellig", "partner"]]);
      expect(lib.ticketBody(g[0]).body).toContain("kein automatischer Rückfall");
    });
    it("ein Partner mit Lücke steht ebenfalls in mit", () => {
      const reg = partner({ datum: "2026-10-20", pruefTermin: "2026-11-10" });
      const erg = lib.auswertung(reg, verstoss(), { heute: "2026-11-16", ...O });
      expect(erg.zeilen[1].fabrik.urteil).toBe("Lücke");
      expect(erg.zeilen[0].fabrik).toMatchObject({ urteil: "Überlappung", mit: ["fix-faellig", "partner"], verstoss: true });
    });
  });

  describe("CLI-Verdrahtung", () => {
    const basis = { bezieher: false, heute: "2026-11-16", eigenerRepoTag: "fix-fabrik", repo: "o/r", label: "x", schreibe: () => undefined, ladeTickets: () => [] };
    const dateien = ["--register", join(FIX, "register.json"), "--export", join(FIX, "messpunkte-fabrik.json"), "--export", join(FIX, "messpunkte-langfuse.json"), "--json"];
    it("--heute geht vor dem Standard-Datum", () => {
      const r = cli.auswerten(cli.parseArgs([...dateien, "--heute", "2026-10-28"]), basis);
      expect(JSON.parse(r.text).zeilen[0].fabrik.urteil).toBe("noch nicht fällig");
    });
    it("der eigene Repo-Tag erreicht die Auswertung (Fabrik-Kosten aus dem Langfuse-Export)", () => {
      const r = cli.auswerten(cli.parseArgs(dateien), basis);
      expect(JSON.parse(r.text).zeilen[0].fabrik.kosten).toMatchObject({ basis: 5, nach: 4 });
    });
    it("Ablage in der Repo-Wurzel selbst oder im Repo wird verweigert, ohne etwas zu schreiben", () => {
      const geschrieben: string[] = [];
      const d = { ...basis, schreibe: (p: string) => geschrieben.push(p) };
      for (const ziel of [join(__dirname, ".."), join(__dirname, "..", "scratch")]) expect(cli.auswerten(cli.parseArgs([...dateien, "--ablage", ziel]), d).exitCode, ziel).toBe(2);
      expect(geschrieben).toEqual([]);
    });
    it("ein Issue fremder Autorschaft mit dem Marker unterdrückt das Ticket nicht", () => {
      const reg = { zeilen: [zeile({ messgroesse: "ci-fix-runden", parameter: undefined, toleranz: { ...zeile().toleranz, qualitaetsmass: "ci-fix-runden" } })] };
      const f: Record<string, string> = { "reg.json": JSON.stringify(reg), "ex.json": JSON.stringify({ art: "aenderungsregister-messpunkte", quelle: "lauf-ergebnis", punkte: nurQualitaet([10, 10], [30, 30], "ci-fix-runden")[0].punkte }) };
      const angelegt: Z[] = [];
      const fremd = { number: 3, state: "OPEN", author: { login: "fremder" }, body: "<!-- aenderungsregister:solo -->" };
      const r = cli.auswerten(cli.parseArgs(["--register", "reg.json", "--export", "ex.json", "--nach", "5"]), { ...basis, lies: (p: string) => f[p], ladeTickets: () => [fremd], legeAn: (a: Z) => (angelegt.push(a), "u/99") });
      expect(r.exitCode).toBe(0);
      expect(angelegt).toHaveLength(1);
    });
  });
});

describe("Secret-Key-Schutz", () => {
  it("die Import-Hülle von CLI und Lib enthält weder langfuse-api noch langfuse-zugang, keinen Key und kein fetch", () => {
    const h = importHuelle("scripts/aenderungsregister.mjs", (p) => readFileSync(p, "utf8"));
    expect(h).toContain("scripts/aenderungsregister-lib.mjs");
    expect(h).not.toContain("scripts/langfuse-api.mjs");
    expect(h).not.toContain("scripts/langfuse-zugang.mjs");
    for (const f of h) expect(readFileSync(f, "utf8")).not.toMatch(/LANGFUSE_SECRET_KEY|fetch\(/);
  });
  it("die Lib ist pur: keine Imports", () => {
    expect(readFileSync("scripts/aenderungsregister-lib.mjs", "utf8")).not.toMatch(/^import /m);
  });
});
