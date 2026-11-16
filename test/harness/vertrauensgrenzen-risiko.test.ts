import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error reines ES-Modul ohne Typen
import { bestimmeRisikoklasse, risikoMusterAus } from "../../scripts/groessenstufe-lib.mjs";

/**
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Wächter Risiko-Kopplung der Vertrauensgrenzen (factory#622 L8): Jedes Skript, das die Tabelle „Kanäle für Fremdtext“
 * in docs/sicherheit-agenten.md als Gate nennt, ergibt über `risiko.hoch` der Projekt-Config die Risikoklasse `hoch`.
 * Scan-Umfang geschlossen: nur die Tabelle „Kanal | Heutiges Gate“, darin nur Backtick-Pfade `scripts/….mjs`, die im
 * Repo existieren (Skripte nicht verteilter Module, etwa des Forums, werden übersprungen). Ungeprüft: andere Tabellen,
 * Prosa, Pfade außerhalb von scripts/.
 */
const wurzel = (rel: string): string => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

function tabellenSkripte(): string[] {
  const text = readFileSync(wurzel("docs/sicherheit-agenten.md"), "utf8");
  const start = text.indexOf("| Kanal | Heutiges Gate |");
  expect(start).toBeGreaterThan(-1);
  const zeilen = text.slice(start).split("\n");
  const tabelle: string[] = [];
  for (const z of zeilen) {
    if (!z.startsWith("|")) break;
    tabelle.push(z);
  }
  const pfade = tabelle.join("\n").match(/`scripts\/[\w./-]+\.mjs`/g) ?? [];
  return [...new Set(pfade.map((p) => p.slice(1, -1)))].filter((p) => existsSync(wurzel(p))).sort();
}

describe("Vertrauensgrenzen sind Risikoklasse hoch (factory#622 L8)", () => {
  const config = JSON.parse(readFileSync(wurzel(".factory/projekt.json"), "utf8"));
  const risiko = risikoMusterAus(config);
  const skripte = tabellenSkripte();

  test("die Tabelle nennt die Schlüsselskripte", () => {
    for (const s of ["scripts/fremdtext.mjs", "scripts/melden.mjs", "scripts/spezifikation.mjs", "scripts/sammelticket-anlegen.mjs"]) expect(skripte).toContain(s);
  });
  test.each(tabellenSkripte())("%s ist Risikoklasse hoch", (pfad) => {
    expect(bestimmeRisikoklasse([pfad], risiko).klasse).toBe("hoch");
  });
  test("ein unbeteiligtes Skript bleibt normal (Negativfall)", () => {
    expect(bestimmeRisikoklasse(["scripts/befehle-liste.mjs"], risiko).klasse).toBe("normal");
  });
});
