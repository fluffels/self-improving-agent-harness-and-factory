/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#571, Änderungsregister). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libModul from "../../scripts/aenderungsregister-lib.mjs";

const WURZEL = join(__dirname, "..", "..");
type Zeile = Record<string, unknown>;
type Ledger = { datum: string; pr: string; text: string };
type Katalog = Record<string, { quelle: string; art: string; parameter?: string }>;
const lib = libModul as unknown as {
  QUELLEN: string[];
  ARTEN: string[];
  PARAMETER: Record<string, string[]>;
  MESSGROESSEN: Katalog;
  PFLICHTFELDER: string[];
  standardPruefTermin: (datum: string) => string;
  pruefeRegister: (zeilen: unknown) => string[];
  ledgerZeilen: (text: string) => Ledger[];
  pruefeAdrVerweise: (zeilen: Zeile[], ledger: Ledger[]) => string[];
  pruefeLedgerIds: (ledger: Ledger[], ids: string[], einfuehrung?: string) => string[];
  VERFALL_PFLICHTFELDER: string[];
  FREIE_PARAMETER: string[];
  fangquote: (zeile: Zeile, zeilen: Zeile[], punkte: Zeile[]) => { wert?: number; laeufe?: number; faenge?: number; luecke?: string };
  leseMesspunkte: (json: unknown, pfad: string) => { quelle: string; punkte: Zeile[] };
  auswertung: (register: { zeilen: Zeile[] }, exporte: unknown[], o: Record<string, unknown>) => { zeilen: unknown[] };
};

const basis = (): Zeile => ({
  id: "beispiel-1",
  datum: "2026-11-16",
  aenderung: "Beispieländerung",
  wirkung: "Beispielwirkung",
  messgroesse: "kosten-je-ticket-rolle",
  parameter: "planer",
  basis: { fenster: "4 Wochen vor Merge", wert: null },
  toleranz: { qualitaetsmass: "nacharbeit-quote", richtung: "steigt", schwelle: 2, einheit: "prozentpunkte" },
  rueckfall: "Revert per PR",
  pruefTermin: "2026-12-14",
  mindestdaten: { n: 10, einheit: "tickets" },
  adr: { datum: "2026-11-16", pr: "factory#1" },
});
const mit = (aenderung: Zeile): Zeile => ({ ...basis(), ...aenderung });
const fehler = (z: Zeile | Zeile[]): string[] => lib.pruefeRegister(Array.isArray(z) ? z : [z]);

describe("Schema des Änderungsregisters", () => {
  it("eine gültige Basiszeile hat keine Fehler (Gegenbeweis)", () => {
    expect(fehler(basis())).toEqual([]);
  });

  it("eine unbekannte Messgröße ist rot", () => {
    expect(fehler(mit({ messgroesse: "erfunden" })).join("\n")).toMatch(/unbekannte Messgröße erfunden/);
  });

  it("Freitext als toleranz ist rot", () => {
    expect(fehler(mit({ toleranz: "Nacharbeit darf nicht steigen" })).join("\n")).toMatch(/toleranz: Objekt/);
  });

  it("ein Kostenmaß als qualitaetsmass, eine unbekannte Richtung und eine nicht numerische Schwelle sind rot", () => {
    const t = basis().toleranz as Zeile;
    expect(fehler(mit({ toleranz: { ...t, qualitaetsmass: "kosten-je-ticket" } })).join("\n")).toMatch(/kein Qualitätsmaß/);
    expect(fehler(mit({ toleranz: { ...t, richtung: "seitwaerts" } })).join("\n")).toMatch(/richtung/);
    expect(fehler(mit({ toleranz: { ...t, schwelle: "zwei" } })).join("\n")).toMatch(/schwelle/);
  });

  it.each(lib.PFLICHTFELDER)("fehlendes Pflichtfeld %s ist rot", (feld) => {
    const z = basis();
    delete z[feld];
    expect(fehler(z).join("\n")).toContain(`Pflichtfeld ${feld} fehlt`);
  });

  it("ein Prüftermin ≠ Datum + 28 Tage ist ohne pruefTerminGrund rot, mit Grund grün", () => {
    expect(fehler(mit({ pruefTermin: "2026-12-20" })).join("\n")).toMatch(/weicht vom Standard 2026-12-14/);
    expect(fehler(mit({ pruefTermin: "2026-12-20", pruefTerminGrund: "Merge erst am 22." }))).toEqual([]);
    const leer = fehler(mit({ pruefTermin: "2026-12-20", pruefTerminGrund: "  " })).join("\n");
    expect(leer).toMatch(/weicht vom Standard/);
    expect(leer).toMatch(/pruefTerminGrund: nicht leerer Text/);
    expect(fehler(mit({ pruefTermin: "2026-13-01", pruefTerminGrund: "x" })).join("\n")).toMatch(/pruefTermin: Datum/);
  });

  it("standardPruefTermin: Monatswechsel, Jahreswechsel, Schaltjahr", () => {
    expect(lib.standardPruefTermin("2026-11-16")).toBe("2026-12-14");
    expect(lib.standardPruefTermin("2026-12-10")).toBe("2027-01-07");
    expect(lib.standardPruefTermin("2028-02-10")).toBe("2028-03-09");
    expect(lib.standardPruefTermin("2027-02-10")).toBe("2027-03-10");
  });

  it("doppelte id ist rot", () => {
    expect(fehler([basis(), basis()]).join("\n")).toMatch(/id beispiel-1: doppelt/);
  });

  it("Parameter: fehlt bei kosten-je-ticket-rolle, gesetzt bei kosten-je-ticket, Rolle mit Projektpräfix: rot", () => {
    const ohne = basis();
    delete ohne.parameter;
    expect(fehler(ohne).join("\n")).toMatch(/verlangt den Parameter rolle/);
    expect(fehler(mit({ messgroesse: "kosten-je-ticket" })).join("\n")).toMatch(/hat keinen Parameter/);
    expect(fehler(mit({ parameter: "sih-planer" })).join("\n")).toMatch(/nicht in rolle/);
  });

  it("ein unbekanntes Zusatzfeld und ein String als basis.wert sind rot", () => {
    expect(fehler(mit({ zusatz: 1 })).join("\n")).toMatch(/unbekannte Felder zusatz/);
    expect(fehler(mit({ basis: { fenster: "x", wert: "5" } })).join("\n")).toMatch(/basis.wert/);
  });

  it("ungültige id, Datum und mindestdaten sind rot", () => {
    expect(fehler(mit({ id: "Gross_Schrift" })).join("\n")).toMatch(/id: nur/);
    expect(fehler(mit({ datum: "2026-02-30" })).join("\n")).toMatch(/datum/);
    expect(fehler(mit({ mindestdaten: { n: 0, einheit: "tickets" } })).join("\n")).toMatch(/mindestdaten.n/);
  });
});

const ADR = `# ADR

## Kontext

| Datum | Was | PR |
|---|---|---|
| 2020-01-01 | andere Tabelle | #1 |

## Gelockert

| Datum | Was | Evidenz | PR | Rückfall-Trigger |
|---|---|---|---|---|
| 2026-11-16 | alt mit | Pipe im Text | e | factory#1 | Trigger |
| 2026-11-17 | neu \`x\` | e | factory#2 | Register: \`beispiel-1\` |

## Danach

| 2030-01-01 | a | b | c | d |
`;

describe("Teilobjekte, Skalare und Nicht-Objekte", () => {
  const t = (): Zeile => basis().toleranz as Zeile;
  const faelle: [string, Zeile, RegExp][] = [
    ["basis kein Objekt", { basis: 5 }, /basis: Objekt/],
    ["basis Zusatzfeld", { basis: { fenster: "x", wert: null, extra: 1 } }, /basis: unbekannte Felder extra/],
    ["basis.fenster leer", { basis: { fenster: "", wert: null } }, /basis.fenster/],
    ["mindestdaten kein Objekt", { mindestdaten: 5 }, /mindestdaten: Objekt/],
    ["mindestdaten Zusatzfeld", { mindestdaten: { n: 1, einheit: "prs", extra: 1 } }, /mindestdaten: unbekannte Felder extra/],
    ["mindestdaten.n keine Ganzzahl", { mindestdaten: { n: 1.5, einheit: "prs" } }, /mindestdaten.n/],
    ["mindestdaten.einheit unbekannt", { mindestdaten: { n: 1, einheit: "stunden" } }, /mindestdaten.einheit/],
    ["adr kein Objekt", { adr: 5 }, /adr: Objekt/],
    ["adr Zusatzfeld", { adr: { datum: "2026-11-16", pr: "factory#1", extra: 1 } }, /adr: unbekannte Felder extra/],
    ["adr.datum ungültig", { adr: { datum: "2026-13-01", pr: "factory#1" } }, /adr.datum/],
    ["adr.pr leer", { adr: { datum: "2026-11-16", pr: "" } }, /adr.pr/],
    ["toleranz null", { toleranz: null }, /toleranz: Objekt/],
    ["toleranz Zusatzfeld", { toleranz: { ...t(), extra: 1 } }, /toleranz: unbekannte Felder extra/],
    ["toleranz.qualitaetsmass unbekannt", { toleranz: { ...t(), qualitaetsmass: "erfunden" } }, /toleranz.qualitaetsmass: unbekannte Messgröße/],
    ["toleranz.einheit unbekannt", { toleranz: { ...t(), einheit: "stunden" } }, /toleranz.einheit/],
    ["aenderung leer", { aenderung: " " }, /aenderung: nicht leerer Text/],
    ["wirkung leer", { wirkung: "" }, /wirkung: nicht leerer Text/],
    ["rueckfall leer", { rueckfall: " " }, /rueckfall: nicht leerer Text/],
    ["id mit Unterstrich am Ende", { id: "abc_X" }, /id: nur/],
    ["id leer", { id: "" }, /id: nur/],
    ["id Zahl", { id: 5 }, /id: nur/],
  ];
  it.each(faelle)("%s ist rot", (_name, aenderung, muster) => {
    expect(fehler(mit(aenderung)).join("\n")).toMatch(muster);
  });

  it("Nicht-Objekte: Register keine Liste, Zeile null oder Array", () => {
    expect(lib.pruefeRegister("x").join("\n")).toMatch(/Liste erwartet/);
    expect(lib.pruefeRegister([null]).join("\n")).toMatch(/Objekt erwartet/);
    expect(lib.pruefeRegister([[]]).join("\n")).toMatch(/Objekt erwartet/);
    expect(lib.pruefeAdrVerweise([{ id: "ohne-adr" }], [])).toEqual([]);
    expect(() => lib.standardPruefTermin("kein-datum")).toThrow(/kein Datum/);
  });
});

describe("Ledger in ADR 0027", () => {
  const ledger = lib.ledgerZeilen(ADR);

  it("ledgerZeilen liest nur die Tabelle unter ## Gelockert; PR ist die vorletzte Zelle", () => {
    expect(ledger.map((l) => [l.datum, l.pr])).toEqual([["2026-11-16", "factory#1"], ["2026-11-17", "factory#2"]]);
  });

  it("adr auf eine nicht existierende Ledger-Zeile ist rot, auf eine existierende grün", () => {
    expect(lib.pruefeAdrVerweise([basis()], ledger)).toEqual([]);
    expect(lib.pruefeAdrVerweise([mit({ adr: { datum: "2026-11-16", pr: "factory#9" } })], ledger).join("\n")).toMatch(/zeigt auf keine Ledger-Zeile/);
  });

  it("adr mit abweichendem Datum bei gleichem PR ist rot", () => {
    expect(lib.pruefeAdrVerweise([mit({ adr: { datum: "2026-11-15", pr: "factory#1" } })], ledger).join("\n")).toMatch(/zeigt auf keine Ledger-Zeile/);
  });

  it("ledgerZeilen: ohne Überschrift, Unterüberschrift, Suffix, zu wenige Zellen, fehlende Pipe, Abbruch bei Überschrift", () => {
    const tab = "| 2026-11-16 | a | b | factory#1 | c |";
    expect(lib.ledgerZeilen(tab)).toEqual([]);
    expect(lib.ledgerZeilen(`### Gelockert\n\n${tab}`)).toEqual([]);
    expect(lib.ledgerZeilen(`## Gelockert (alt)\n\n${tab}`)).toEqual([]);
    expect(lib.ledgerZeilen(`## Gelockert\n\n| 2026-11-16 |\n`)).toEqual([]);
    expect(lib.ledgerZeilen(`## Gelockert\n\n2026-11-16 | a | b | factory#1 | c |`)).toEqual([]);
    expect(lib.ledgerZeilen(`## Gelockert\n\n${tab}\n## Ende\n${tab}`)).toHaveLength(1);
    expect(lib.ledgerZeilen(`## Gelockert\n\n${tab}\n#### Ende\n${tab}`)).toHaveLength(1);
  });

  it("Ledger-Zeile ab EINFUEHRUNG ohne Register-Id ist rot, mit unbekannter Id rot, davor ohne Id grün", () => {
    expect(lib.pruefeLedgerIds(ledger, ["beispiel-1"], "2026-11-17")).toEqual([]);
    expect(lib.pruefeLedgerIds(ledger, ["beispiel-1"], "2026-11-16").join("\n")).toMatch(/fehlt `Register: <id>`/);
    expect(lib.pruefeLedgerIds(ledger, ["andere"], "2026-11-17").join("\n")).toMatch(/steht nicht im Änderungsregister/);
  });
});

describe("Messgrößen-Katalog", () => {
  const eintraege = Object.entries(lib.MESSGROESSEN);

  it("jede Quelle und Art ist bekannt, jeder Parameter hat eine Liste", () => {
    for (const [, e] of eintraege) {
      expect(lib.QUELLEN).toContain(e.quelle);
      expect(lib.ARTEN).toContain(e.art);
      expect(e.parameter === undefined || lib.FREIE_PARAMETER.includes(e.parameter) || Array.isArray(lib.PARAMETER[e.parameter])).toBe(true);
    }
  });

  it("alle Startgrößen und die Fangquote sind vorhanden", () => {
    expect(Object.keys(lib.MESSGROESSEN).sort()).toEqual(["blocker-schwere-brille", "ci-fix-runden", "fangquote", "kosten-je-ticket", "kosten-je-ticket-rolle", "nacharbeit-quote"]);
  });

  it("fangquote: Qualitätsmaß der Quelle gate-fundquote mit dem freien Parameter ziel (factory#607)", () => {
    expect(lib.MESSGROESSEN.fangquote).toMatchObject({ quelle: "gate-fundquote", art: "qualitaet", parameter: "ziel" });
    expect(lib.QUELLEN).toContain("gate-fundquote");
    expect(fehler(mit({ messgroesse: "fangquote", parameter: "test/harness/a.test.ts" }))).toEqual([]);
    const ohne = mit({ messgroesse: "fangquote" });
    delete ohne.parameter;
    expect(fehler(ohne).join("\n")).toMatch(/verlangt den Parameter ziel/);
    expect(fehler(mit({ messgroesse: "fangquote", parameter: " " })).join("\n")).toMatch(/parameter: nicht leerer Text/);
  });
});

describe("Realdaten: Register und ADR 0027", () => {
  const register = JSON.parse(readFileSync(join(WURZEL, ".github/aenderungsregister.json"), "utf8")) as { version: number; zeilen: Zeile[] };
  const ledger = lib.ledgerZeilen(readFileSync(join(WURZEL, "docs/adr/0027-regeln-lockern.md"), "utf8"));

  it("das Register hat mindestens eine Zeile und ist schemagültig", () => {
    expect(register.version).toBe(1);
    expect(register.zeilen.length).toBeGreaterThan(0);
    expect(lib.pruefeRegister(register.zeilen)).toEqual([]);
  });

  it("jede Registerzeile zeigt auf eine Ledger-Zeile, jede neue Ledger-Zeile nennt eine Register-Id", () => {
    expect(ledger.length).toBeGreaterThan(10);
    expect(lib.pruefeAdrVerweise(register.zeilen, ledger)).toEqual([]);
    expect(lib.pruefeLedgerIds(ledger, register.zeilen.map((z) => String(z.id)))).toEqual([]);
  });
});

const verfall = (z: Zeile = {}): Zeile => ({ id: "w-a", art: "verfall", ziel: "test/harness/a.test.ts", aufgenommen: "2026-11-16", ablauf: "2027-05-16", messgroesse: "fangquote", ...z });
const regel = (z: Zeile = {}): Zeile => verfall({ id: "r-x", ziel: "AGENTS.md#kein-gruen-durch-aufweichen", durch: ["w-a"], ...z });

describe("Zeilenart verfall (factory#607)", () => {
  it("ein Wächter und eine Regel mit durch sind gültig (Gegenbeweis)", () => {
    expect(lib.pruefeRegister([verfall(), regel()])).toEqual([]);
    expect(lib.pruefeRegister([verfall(), regel({ durch: undefined })])).toEqual([]); // Regel ohne durch: gültig, Fangquote ist eine Lücke
  });

  it.each(lib.VERFALL_PFLICHTFELDER.filter((f) => f !== "art"))("fehlendes Pflichtfeld %s ist rot", (feld) => {
    const z = verfall();
    delete z[feld];
    expect(lib.pruefeRegister([z]).join("\n")).toContain(`Pflichtfeld ${feld} fehlt`);
  });

  const faelle: [string, Zeile[], RegExp][] = [
    ["unbekanntes Feld", [verfall({ zusatz: 1 })], /unbekannte Felder zusatz/],
    ["Messgröße ≠ fangquote", [verfall({ messgroesse: "ci-fix-runden" })], /nur fangquote/],
    ["ablauf nicht nach aufgenommen", [verfall({ ablauf: "2026-11-16" })], /ablauf: muss nach aufgenommen/],
    ["ungültiges Datum", [verfall({ aufgenommen: "2026-02-30" })], /aufgenommen: Datum/],
    ["leeres ziel", [verfall({ ziel: " " })], /ziel: Pfad oder Anker/],
    ["ungültige id", [verfall({ id: "Gross_X" })], /id: nur/],
    ["id mit Unterstrich", [verfall({ id: "x_y" })], /id: nur/],
    ["id mit Fremdzeichen am Anfang", [verfall({ id: "Xa" })], /id: nur/],
    ["id mit Fremdzeichen am Ende", [verfall({ id: "aX" })], /id: nur/],
    ["ungültiges ablauf-Datum", [verfall({ ablauf: "2027-13-01" })], /ablauf: Datum/],
    ["durch-Id mit Unterstrich", [verfall({ id: "w_a-x" }), regel({ durch: ["w_a"] })], /durch: nicht leere Liste/],
    ["durch bei einem Wächter (Pfad ohne Anker)", [verfall({ durch: ["w-a"] })], /durch: nur bei Regeln/],
    ["durch leer", [verfall(), regel({ durch: [] })], /durch: nicht leere Liste/],
    ["durch kein Array", [verfall(), regel({ durch: "w-a" })], /durch: nicht leere Liste/],
    ["durch nennt eine unbekannte Id", [regel({ durch: ["fehlt"] })], /durch fehlt nennt keinen Wächter/],
    ["durch nennt eine Regel statt eines Wächters", [verfall(), regel(), regel({ id: "r-y", durch: ["r-x"] })], /durch r-x nennt keinen Wächter/],
  ];
  it.each(faelle)("%s ist rot", (_n, zeilen, muster) => {
    expect(lib.pruefeRegister(zeilen).join("\n")).toMatch(muster);
  });

  it("doppelte Ids gelten auch zwischen den Zeilenarten", () => {
    expect(lib.pruefeRegister([verfall(), verfall()]).join("\n")).toMatch(/id w-a: doppelt/);
    expect(lib.pruefeRegister([basis(), verfall({ id: "beispiel-1" })]).join("\n")).toMatch(/id beispiel-1: doppelt/);
  });

  it("eine Zeile mit art ≠ verfall bleibt eine Wirkungszeile: art ist dort ein unbekanntes Feld", () => {
    expect(fehler(mit({ art: "wirkung" })).join("\n")).toMatch(/unbekannte Felder art/);
  });

  it("die Wirkungsprüfung ignoriert Verfall-Zeilen (kein Urteil, kein Absturz)", () => {
    const e = lib.auswertung({ zeilen: [basis(), verfall(), regel()] }, [], { heute: "2027-01-01", eigenerRepoTag: "x" });
    expect(e.zeilen).toHaveLength(1);
  });
});

describe("Feld eingefroren bei Wächter-Zeilen (factory#611)", () => {
  it("ein Wächter mit eingefroren-Datum ist gültig (Gegenbeweis)", () => {
    expect(lib.pruefeRegister([verfall({ eingefroren: "2026-11-20" })])).toEqual([]);
    expect(lib.pruefeRegister([verfall({ eingefroren: "2026-11-16" })]), "am Aufnahmetag erlaubt").toEqual([]);
  });

  const faelle: [string, Zeile[], RegExp][] = [
    ["ungültiges Datum", [verfall({ eingefroren: "2026-02-30" })], /eingefroren: Datum JJJJ-MM-TT/],
    ["kein Datum", [verfall({ eingefroren: true })], /eingefroren: Datum JJJJ-MM-TT/],
    ["bei einer Regel (Anker #)", [verfall(), regel({ eingefroren: "2026-11-20" })], /eingefroren: nur bei Wächtern/],
    ["vor aufgenommen", [verfall({ eingefroren: "2026-11-15" })], /eingefroren: nicht vor aufgenommen/],
    ["Glob im Ziel", [verfall({ ziel: "test/harness/*.test.ts", eingefroren: "2026-11-20" })], /eingefroren: nur bei einem einzelnen Wächter/],
    ["Ziel ohne test/harness-Wächterpfad", [verfall({ ziel: "scripts/x.mjs", eingefroren: "2026-11-20" })], /eingefroren: nur bei einem einzelnen Wächter/],
    ["Extglob im Ziel", [verfall({ ziel: "test/harness/!(x).test.ts", eingefroren: "2026-11-20" })], /eingefroren: nur bei einem einzelnen Wächter/],
    ["Ziel mit Präfix davor", [verfall({ ziel: "x/test/harness/a.test.ts", eingefroren: "2026-11-20" })], /eingefroren: nur bei einem einzelnen Wächter/],
    ["Ziel mit Endung dahinter", [verfall({ ziel: "test/harness/a.test.ts.bak", eingefroren: "2026-11-20" })], /eingefroren: nur bei einem einzelnen Wächter/],
    ["Ziel in Unterordner", [verfall({ ziel: "test/harness/sub/a.test.ts", eingefroren: "2026-11-20" })], /eingefroren: nur bei einem einzelnen Wächter/],
  ];
  it.each(faelle)("%s ist rot", (_n, zeilen, muster) => {
    expect(lib.pruefeRegister(zeilen).join("\n")).toMatch(muster);
  });
});

describe("Fangquote je Wächter und Regel (factory#607)", () => {
  const pt = (einheitId: string, wert: number, parameter = "test/harness/a.test.ts", tag = "2026-12-01"): Zeile => ({ messgroesse: "fangquote", parameter, zeitpunkt: `${tag}T10:00:00.000Z`, einheitId, wert });
  const zeilen = [verfall(), regel()];

  it("Wächter: Anteil der Läufe mit Fang", () => {
    const p = [pt("1", 1), pt("2", 0), pt("3", 0), pt("4", 0)];
    expect(lib.fangquote(zeilen[0], zeilen, p)).toEqual({ wert: 0.25, laeufe: 4, faenge: 1 });
  });

  it("ein Wächter ohne einen einzigen Fang hat die Quote 0 (echte Null, nur mit Messpunkten)", () => {
    expect(lib.fangquote(zeilen[0], zeilen, [pt("1", 0), pt("2", 0)])).toMatchObject({ wert: 0, laeufe: 2 });
  });

  it("Negativfall: Regel ohne durch ist eine Lücke, nie 0", () => {
    const ohne = regel({ durch: undefined });
    expect(lib.fangquote(ohne, [verfall(), ohne], [pt("1", 1)])).toEqual({ luecke: "kein erzwingender Wächter (durch)" });
  });

  it("Negativfall: ohne Messpunkte im Fenster (Logs fehlen) ist es eine Lücke mit Grund, nie 0", () => {
    expect(lib.fangquote(zeilen[0], zeilen, [])).toEqual({ luecke: "keine Messpunkte im Fenster (Logs fehlen)" });
    expect(lib.fangquote(zeilen[0], zeilen, [pt("1", 1, "test/harness/a.test.ts", "2026-11-15")]).luecke).toMatch(/keine Messpunkte/); // vor aufgenommen
    expect(lib.fangquote(zeilen[0], zeilen, [pt("1", 1, "test/harness/a.test.ts", "2027-05-17")]).luecke).toMatch(/keine Messpunkte/); // nach ablauf
    expect(lib.fangquote(zeilen[0], zeilen, [pt("1", 1, "test/harness/anderer.test.ts")]).luecke).toMatch(/keine Messpunkte/);
  });

  it("die Fenstergrenzen aufgenommen und ablauf zählen beide mit", () => {
    expect(lib.fangquote(zeilen[0], zeilen, [pt("1", 1, "test/harness/a.test.ts", "2026-11-16")])).toMatchObject({ laeufe: 1 });
    expect(lib.fangquote(zeilen[0], zeilen, [pt("1", 1, "test/harness/a.test.ts", "2027-05-16")])).toMatchObject({ laeufe: 1 });
  });

  it("ein Punkt einer anderen Messgröße mit gleichem parameter zählt nicht", () => {
    expect(lib.fangquote(zeilen[0], zeilen, [{ ...pt("1", 1), messgroesse: "ci-fix-runden" }]).luecke).toMatch(/keine Messpunkte/);
  });

  it("Regel: Fang, wenn mindestens einer der Wächter in durch im Lauf rot war", () => {
    const z = [verfall(), verfall({ id: "w-b", ziel: "test/harness/b.test.ts" }), regel({ durch: ["w-a", "w-b"] })];
    const p = [pt("1", 1), pt("1", 0, "test/harness/b.test.ts"), pt("2", 0), pt("2", 1, "test/harness/b.test.ts"), pt("3", 0), pt("3", 0, "test/harness/b.test.ts")];
    expect(lib.fangquote(z[2], z, p)).toEqual({ wert: 2 / 3, laeufe: 3, faenge: 2 });
  });

  it("Regel mit durch auf eine unbekannte Id oder eine Regel ist eine Lücke", () => {
    expect(lib.fangquote(regel({ durch: ["fehlt"] }), zeilen, [pt("1", 1)]).luecke).toMatch(/keinen Wächter/);
    expect(lib.fangquote(regel({ durch: ["r-x"] }), [verfall(), regel(), regel({ id: "r-y", durch: ["r-x"] })], [pt("1", 1)]).luecke).toMatch(/keinen Wächter/);
  });
});

describe("Messpunkte-Export der Quelle gate-fundquote (factory#607)", () => {
  const export_ = (extra: Record<string, unknown> = {}) => ({
    art: "fangquote-messpunkte",
    quelle: "gate-fundquote",
    punkte: [{ messgroesse: "fangquote", parameter: "test/harness/a.test.ts", zeitpunkt: "2026-11-20T10:00:00.000Z", einheitId: "ci:1:5", wert: 1 }],
    ...extra,
  });

  it("der Export des Kern-Skripts besteht leseMesspunkte, auch mit luecke ohne Punkte", () => {
    const e = lib.leseMesspunkte(export_(), "x.json");
    expect(e.quelle).toBe("gate-fundquote");
    expect(e.punkte[0]).toMatchObject({ messgroesse: "fangquote", parameter: "test/harness/a.test.ts", wert: 1 });
    expect(lib.leseMesspunkte(export_({ punkte: [], luecke: "keine Logs im Fenster" }), "x.json").punkte).toEqual([]);
  });

  it("die Kennung der Register-Exporte bleibt gültig, jede andere art ist rot", () => {
    expect(lib.leseMesspunkte(export_({ art: "aenderungsregister-messpunkte" }), "x.json").quelle).toBe("gate-fundquote");
    expect(() => lib.leseMesspunkte(export_({ art: "irgendwas" }), "x.json")).toThrow(/art .* erwartet/);
    expect(() => lib.leseMesspunkte(export_({ punkte: [{ messgroesse: "fangquote", parameter: "a", zeitpunkt: "2026-11-20", einheitId: "x", wert: "1" }] }), "x.json")).toThrow(/wert/);
  });
});
