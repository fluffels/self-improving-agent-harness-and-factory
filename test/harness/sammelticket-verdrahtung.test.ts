/* Verdrahtung des Sammelticket-Anlegers (#1663 L44d).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * `main` in scripts/sammelticket-anlegen.mjs ruft `korrekturFuer` für das NEUE Sammelticket auf (die Korrektur gilt dem neuen
 * Sammelticket `nr`). Gibt der Aufruf `nr` oder `position` nicht weiter, wird die Korrektur für das falsche Ticket oder an der
 * falschen Stelle berechnet, und kein Test der puren Funktion bemerkt es. Darum prüft dieser Wächter den Quelltext: jeder Aufruf
 * reicht `items`, `nr` und `position` durch. Grenze: erkannt werden Aufrufe mit Objekt-Literal; ein dynamisch gebautes Argument fiele durch (dann rot).
 *
 * Zweiter Block (factory#156): die Codequalität-Verdrahtung in `main` und `setzeErstePosition` (Ziel aus dem Label der Art, Platzierung über
 * `codequalitaetPlan`, Aufruf ohne `--top`). Grenze: die Prüfung hängt am Wortlaut; ein Umbenennen oder Umformatieren macht sie rot (fail-closed), nie leer grün.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { getrackteTextdateien } from "../support/entfernte-pfade";

const QUELLE = readFileSync(new URL("../../scripts/sammelticket-anlegen.mjs", import.meta.url), "utf8");
const PFLICHT = ["items", "nr", "position"];

/** Alle Aufrufe `korrekturFuer({ … })` (nicht die Definition) mit ihrer Argumentliste. */
function aufrufe(text: string): string[] {
  return [...text.matchAll(/(?<!function\s)\bkorrekturFuer\(\s*(\{[^}]*\})\s*\)/g)].map((m) => m[1]);
}

/** Pflichtfelder, die ein Aufruf nicht (als Kurzform oder `feld: …`) durchreicht. */
function fehlende(arg: string): string[] {
  const felder = arg.slice(1, -1).split(",").map((f) => f.split(":")[0].trim());
  return PFLICHT.filter((p) => !felder.includes(p));
}

describe("korrekturFuer ist in main verdrahtet", () => {
  test("der Prüfer erkennt einen fehlenden Parameter (Negativfall)", () => {
    expect(fehlende("{ items, position }")).toEqual(["nr"]);
    expect(fehlende("{ items, nr: neu, position }")).toEqual([]);
    expect(aufrufe("const k = korrekturFuer({ items, nr });")).toEqual(["{ items, nr }"]);
    expect(aufrufe("export function korrekturFuer({ items, nr, position }) {")).toEqual([]);
  });

  test("jeder Aufruf im Skript reicht items, nr und position durch, und es gibt mindestens einen in main", () => {
    const alle = aufrufe(QUELLE);
    expect(alle.length, "kein korrekturFuer-Aufruf mehr gefunden: der Wächter prüfte nichts").toBeGreaterThanOrEqual(2);
    for (const a of alle) expect(fehlende(a), a).toEqual([]);
    const main = QUELLE.slice(QUELLE.indexOf("async function legeNeuAn(")); // legeNeuAn und main
    expect(aufrufe(main).length, "main ruft korrekturFuer nicht mehr auf").toBeGreaterThanOrEqual(1);
  });
});

describe("Refactoring-Sammelticket ist in main verdrahtet (factory#156)", () => {
  /** Rumpf von `main` bzw. `setzeErstePosition`: ab der Definition bis zur nächsten Top-Level-Funktion. */
  const rumpf = (kopf: string): string => {
    const ab = QUELLE.slice(QUELLE.indexOf(kopf));
    return ab.slice(0, ab.search(/\n\}\n/));
  };

  test("das Ziel wird aus dem Label der Art gewählt (Produkt-Board bei refactoring), nicht aus dem Harness-Label", () => {
    const main = rumpf("export async function main(") + rumpf("async function legeNeuAn(");
    expect(main).toMatch(/const \{ label, ziel, quelle \} = zielOderAbbruch\(config, args\.art, d\.bezieher\);/);
    const zf = rumpf("export function zielFuerArt(");
    expect(zf).toMatch(/const label = sammelLabel\(config, art\);/);
    expect(zf).toMatch(/sammelZiel\(config, label\)/);
    expect(main).toMatch(/legeAn\(\{[^}]*harness: label\s*[,}][^}]*\}?\)/);
  });

  test("setzeErstePosition platziert refactoring über codequalitaetPlan und läuft auch ohne --top", () => {
    const f = rumpf("function setzeErstePosition(");
    expect(f).toMatch(/if \(!top && art !== "refactoring"\) return;/);
    expect(f).toMatch(/art === "refactoring" \? codequalitaetPlan\(items, nr\) : planFuerArgs\(/);
    const main = rumpf("export async function main(") + rumpf("async function legeNeuAn(");
    expect(main).toMatch(/\} else setzeErstePosition\(\{ art: args\.art,/); // bedingungslos: refactoring braucht kein --top
    expect(main).not.toMatch(/if \(args\.top\)\s*setzeErstePosition/);
  });
});

/* Scan-Wächter (factory#593): der Titel „Codequalität (gesammelt)“ ist umbenannt (Refactoring 1/5), der Alt-Titel wird im Übergang nur noch
 * erkannt, nie genannt oder angelegt. Dieser Test scannt alle getrackten Textdateien auf die geschlossene Musterliste (Konstantenname, wörtlicher
 * Alt-Titel, „Codequalität-Sammelticket“, alter Anker). Ausnahmen mit Grund: ADRs sind Historie, `scripts/sammelticket-titel.mjs` hält den Alt-Titel in
 * `REFACTORING_TITEL_AKZEPTIERT`, `docs/ticket-reihenfolge.md` und `docs/harness-glossar.md` führen ihn im Übergangssatz bzw. in der Verweiszeile, `test/` trägt Fixtures.
 * Bewusste Grenze: freie Umschreibungen und die Befundart „Codequalität“ als Wort werden nicht gescannt. */
describe("Alt-Titel des Refactoring-Sammeltickets nur im Übergang (factory#593)", () => {
  const MUSTER = ["CODEQUALITAET_SAMMELTICKET_TITEL", "Codequalität (gesammelt)", "Codequalität-Sammelticket", "#codequalität-gesammelt"];
  const ausgenommen = (pfad: string): boolean =>
    pfad.startsWith("docs/adr/") || pfad.startsWith("test/") || ["scripts/sammelticket-titel.mjs", "docs/ticket-reihenfolge.md", "docs/harness-glossar.md"].includes(pfad);
  const funde = (dateien: { pfad: string; inhalt: string }[]): string[] =>
    dateien.filter((d) => !ausgenommen(d.pfad)).flatMap((d) => MUSTER.filter((m) => d.inhalt.includes(m)).map((m) => `${d.pfad}: ${m}`));

  test("Negativfall: der Scan erkennt den Alt-Titel in einer Kern-Datei und lässt Ausnahmen durch", () => {
    expect(funde([{ pfad: "AGENTS.md", inhalt: "Sammelticket „Codequalität (gesammelt)“" }])).toEqual(["AGENTS.md: Codequalität (gesammelt)"]);
    expect(funde([{ pfad: "docs/adr/0026-x.md", inhalt: "Codequalität (gesammelt)" }, { pfad: "docs/ticket-reihenfolge.md", inhalt: "Codequalität (gesammelt)" }])).toEqual([]);
  });

  test("keine getrackte Textdatei außerhalb der Ausnahmen nennt den Alt-Titel", () => {
    const alle = getrackteTextdateien();
    expect(alle.length).toBeGreaterThan(100);
    expect(funde(alle)).toEqual([]);
  });
});
