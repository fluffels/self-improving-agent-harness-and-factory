/* Wächter: die Zeile „Kopf-Items zuerst“ in docs/ticket-reihenfolge.md nennt jede Kopf-Item-Art aus `NOTFAELLE` (factory#112, factory#114).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Eine neue Art in `NOTFAELLE` (board-lib.mjs) ohne Eintrag in der Anzeige-Map und ohne Namen in der Doku-Zeile lässt den Test rot werden;
 * eine Map-Art, die der Code nicht kennt, ebenso. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/board-lib.mjs";

const lib = rawLib as unknown as { NOTFAELLE: { art: string }[] };
const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

/** Anzeigename je Art in der Doku-Zeile; Notfälle (🚨, 🔒) tragen einen gemeinsamen Namen. */
export const ANZEIGE: Record<string, string> = {
  "rot-main": "Notfälle",
  security: "Notfälle",
  dependabot: "Dependabot",
  forum: "Forum",
  wiedervorlage: "Wiedervorlage",
  "security-tabs": "Prüf-Ticket",
  tag: "Tag-Ticket",
};
/** Das Status-Ticket ist kein Eintrag von `NOTFAELLE` (kommt über `STATUS_TITEL` dazu). */
const ZUSATZ = ["Status-Ticket"];

const zeile = (doku: string): string => doku.split("\n").find((z) => z.startsWith("1. **Kopf-Items zuerst:**")) ?? "";
/** Befunde: Arten ohne Map-Eintrag, Map-Arten ohne Code-Art, Namen, die in der Zeile fehlen. */
export function befunde(arten: string[], map: Record<string, string>, zusatz: string[], text: string): string[] {
  const fehlt = arten.filter((a) => !(a in map)).map((a) => `Art ohne Anzeige-Name: ${a}`);
  const unbekannt = Object.keys(map).filter((a) => !arten.includes(a)).map((a) => `Map-Art unbekannt: ${a}`);
  const namen = [...new Set([...Object.values(map), ...zusatz])];
  return [...fehlt, ...unbekannt, ...namen.filter((n) => !text.includes(n)).map((n) => `fehlt in der Zeile: ${n}`)];
}

describe("Kopf-Items-Zeile der Ticket-Reihenfolge (factory#112)", () => {
  const arten = lib.NOTFAELLE.map((n) => n.art);
  const text = zeile(readFileSync(`${WURZEL}docs/ticket-reihenfolge.md`, "utf8"));

  test("die echte Zeile nennt jede Art aus NOTFAELLE", () => {
    assert.ok(text !== "", "Zeile „1. **Kopf-Items zuerst:**“ nicht gefunden");
    assert.deepEqual(befunde(arten, ANZEIGE, ZUSATZ, text), []);
  });
  test("neue Art ohne Map-Eintrag ist rot", () => {
    assert.deepEqual(befunde([...arten, "neu"], ANZEIGE, ZUSATZ, text), ["Art ohne Anzeige-Name: neu"]);
  });
  test("unbekannte Map-Art ist rot", () => {
    assert.deepEqual(befunde(arten.filter((a) => a !== "tag"), ANZEIGE, ZUSATZ, text), ["Map-Art unbekannt: tag"]);
  });
  test("fehlender Name in der Zeile ist rot", () => {
    assert.deepEqual(befunde(arten, ANZEIGE, ZUSATZ, text.replaceAll("Forum", "")), ["fehlt in der Zeile: Forum"]);
    assert.deepEqual(befunde(arten, ANZEIGE, ZUSATZ, text.replaceAll("Status-Ticket", "")), ["fehlt in der Zeile: Status-Ticket"]);
  });
});
