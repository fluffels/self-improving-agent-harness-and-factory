/* Notfall-Doku (#101 L19): die Zeilen „Notfall-Marker beim Einsortieren“ und „Neues Item an die Spitze schieben“ in docs/ticket-reihenfolge.md nennen jeden Marker
 * aus NOTFAELLE (scripts/board-lib.mjs); die zweite Zeile nennt zusätzlich jede Art (`--notfall <art>`).
 *
 * Gegenprobe zu test/board.test.ts (das bindet jeden Marker an seine `quelle`): hier hängt die Doku-Aufzählung an der Tabelle, damit eine neue Art nicht ohne Doku-Zeile landet.
 * Grenze: gelesen werden allein diese zwei Zeilen; die Kopf-Items-Zeile (Abschnitt „Kopf-Items“) und die Inbox-Zeile (Forum-Issues) werden nicht gescannt.
 * Geprüft wird das erste Token (bis zum ersten Leerraum) des Markers, denn die Doku kürzt (`🚨` statt `🚨 CI rot auf main`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";

const NOTFAELLE = (rawLib as unknown as { NOTFAELLE: { art: string; marker: string }[] }).NOTFAELLE;
const text = readFileSync(new URL("../docs/ticket-reihenfolge.md", import.meta.url), "utf8").split("\n");
const ZEILEN = [
  { name: "Einsortieren", kopf: "- **Notfall-Marker beim Einsortieren:**", mitArt: false },
  { name: "Spitze schieben", kopf: "- **Neues Item an die Spitze schieben**", mitArt: true },
] as const;

describe.each(ZEILEN)("Notfall-Marker in docs/ticket-reihenfolge.md: Zeile $name", ({ kopf, mitArt }) => {
  const zeilen = text.filter((l) => l.startsWith(kopf));

  test("die Zeile gibt es genau einmal", () => {
    expect(zeilen).toHaveLength(1);
  });

  test.each(NOTFAELLE.map((n) => [n.art, n.marker.trim().split(/\s+/)[0]]))("Art %s: das Token %s steht in der Zeile", (_art, token) => {
    expect(token).not.toBe("");
    expect(zeilen[0]).toContain(token);
  });

  test.skipIf(!mitArt).each(NOTFAELLE.map((n) => n.art))("Art %s steht als Name in der Zeile (nur Zeile mit --notfall)", (art) => {
    expect(zeilen[0]).toContain(`\`${art}\``);
  });
});
