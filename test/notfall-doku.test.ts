/* Notfall-Doku (#101 L19): die Zeile „Notfall-Marker beim Einsortieren“ in docs/ticket-reihenfolge.md nennt jeden Marker aus NOTFAELLE (scripts/board-lib.mjs).
 *
 * Gegenprobe zu test/board.test.ts (das bindet jeden Marker an seine `quelle`): hier hängt die Doku-Aufzählung an der Tabelle, damit eine neue Art nicht ohne Doku-Zeile landet.
 * Grenze: gelesen wird allein diese eine Zeile; die Kopf-Items-Zeile (Abschnitt „Kopf-Items“) und die Inbox-Zeile (Forum-Issues) werden nicht gescannt.
 * Geprüft wird das erste Token (bis zum ersten Leerraum) des Markers, denn die Doku kürzt (`🚨` statt `🚨 CI rot auf main`).
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";

const NOTFAELLE = (rawLib as unknown as { NOTFAELLE: { art: string; marker: string }[] }).NOTFAELLE;
const ZEILE = "- **Notfall-Marker beim Einsortieren:**";

describe("Notfall-Marker in docs/ticket-reihenfolge.md", () => {
  const zeilen = readFileSync(new URL("../docs/ticket-reihenfolge.md", import.meta.url), "utf8").split("\n").filter((l) => l.startsWith(ZEILE));

  test("die Zeile gibt es genau einmal", () => {
    expect(zeilen).toHaveLength(1);
  });

  test.each(NOTFAELLE.map((n) => [n.art, n.marker.trim().split(/\s+/)[0]]))("Art %s: das Token %s steht in der Zeile", (_art, token) => {
    expect(token).not.toBe("");
    expect(zeilen[0]).toContain(token);
  });
});
