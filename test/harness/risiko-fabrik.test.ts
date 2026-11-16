/* Risiko-Muster der Fabrik (Sammelzeile L1, factory#619) – die Fabrik-Config ERSETZT die Standardliste, darum hält dieser Wächter sie als Obermenge.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geschlossene Liste: (a) `risiko.hoch` in `.factory/projekt.json` enthält jedes Muster von `RISIKO_STANDARDLISTE`;
 * (b) es nennt `scripts/token-analyse-tickets.mjs`; (c) dieser Pfad ergibt Klasse hoch, ein gewöhnliches Skript bleibt normal.
 * Bekannte Grenze: nur die öffentliche Ticket-Brücke der Token-Analyse ist ergänzt; weitere Brücken mit Außenwirkung erfasst die Liste nicht (Sammelzeile).
 */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lib from "../../scripts/groessenstufe-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as konfig from "../../scripts/projekt-config-lib.mjs";

type Risiko = { muster: string[] | null; quelle: string };
const { RISIKO_STANDARDLISTE, risikoMusterAus, bestimmeRisikoklasse } = lib as unknown as {
  RISIKO_STANDARDLISTE: readonly string[];
  risikoMusterAus: (c: unknown) => Risiko;
  bestimmeRisikoklasse: (p: string[], r: Risiko) => { klasse: string };
};
const { ladeProjektConfig } = konfig as unknown as { ladeProjektConfig: (o: { pfad: string; pruefen: boolean }) => unknown };

const PFAD = fileURLToPath(new URL("../../.factory/projekt.json", import.meta.url));
const risiko = risikoMusterAus(ladeProjektConfig({ pfad: PFAD, pruefen: false }));

describe("Risiko-Muster der Fabrik", () => {
  test("die Fabrik-Liste ist Obermenge der Standardliste (Drift-Wächter)", () => {
    assert.equal(risiko.quelle, "Projekt-Config");
    for (const m of RISIKO_STANDARDLISTE) assert.ok(risiko.muster?.includes(m), `fehlt: ${m}`);
  });

  test("die öffentliche Ticket-Brücke der Token-Analyse ist Klasse hoch", () => {
    assert.ok(risiko.muster?.some((m) => m.endsWith("scripts/token-analyse-tickets.mjs")));
    assert.equal(bestimmeRisikoklasse(["scripts/token-analyse-tickets.mjs"], risiko).klasse, "hoch"); // Pfadform wie im Diff, ohne führenden Schrägstrich
  });

  test("Negativfall: ein gewöhnliches Skript bleibt normal", () => {
    assert.equal(bestimmeRisikoklasse(["scripts/board-lib.mjs"], risiko).klasse, "normal");
  });
});
