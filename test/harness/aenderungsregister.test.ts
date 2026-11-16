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
    expect(fehler(mit({ pruefTermin: "2026-12-20", pruefTerminGrund: "  " })).length).toBeGreaterThan(0);
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

describe("Ledger in ADR 0027", () => {
  const ledger = lib.ledgerZeilen(ADR);

  it("ledgerZeilen liest nur die Tabelle unter ## Gelockert; PR ist die vorletzte Zelle", () => {
    expect(ledger.map((l) => [l.datum, l.pr])).toEqual([["2026-11-16", "factory#1"], ["2026-11-17", "factory#2"]]);
  });

  it("adr auf eine nicht existierende Ledger-Zeile ist rot, auf eine existierende grün", () => {
    expect(lib.pruefeAdrVerweise([basis()], ledger)).toEqual([]);
    expect(lib.pruefeAdrVerweise([mit({ adr: { datum: "2026-11-16", pr: "factory#9" } })], ledger).join("\n")).toMatch(/zeigt auf keine Ledger-Zeile/);
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
      expect(e.parameter === undefined || Array.isArray(lib.PARAMETER[e.parameter])).toBe(true);
    }
  });

  it("alle fünf Startgrößen sind vorhanden", () => {
    expect(Object.keys(lib.MESSGROESSEN).sort()).toEqual(["blocker-schwere-brille", "ci-fix-runden", "kosten-je-ticket", "kosten-je-ticket-rolle", "nacharbeit-quote"]);
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
