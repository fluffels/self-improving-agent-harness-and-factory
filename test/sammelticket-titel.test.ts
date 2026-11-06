/* Das importfreie Blatt der Sammelticket-Titel (factory#220 L9): keine Importe (kein Config-Laden beim Import), `board-lib` exportiert dieselben Werte weiter. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { importeAus } from "./harness/hook-importe";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as blattRaw from "../scripts/sammelticket-titel.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardLibRaw from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as produktquoteRaw from "../scripts/produktquote-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { exporteAus as exporteAusRaw } from "../scripts/tag-takt.mjs";

type Blatt = { SAMMELTICKET_TITEL: string; LANGFUSE_SAMMELTICKET_TITEL: string; CODEQUALITAET_SAMMELTICKET_TITEL: string; SAMMELTICKET_TITEL_LISTE: string[]; NICHT_EINTRAGBAR_PRAEFIX: string; BEFUND_ZEILE: RegExp; BEFUND_ZEILE_OFFEN: RegExp };
const blatt = blattRaw as unknown as Blatt;
const boardLib = boardLibRaw as unknown as Record<string, unknown>;
const produktquote = produktquoteRaw as unknown as Pick<Blatt, "BEFUND_ZEILE" | "BEFUND_ZEILE_OFFEN">;
const exporteAus = exporteAusRaw as (text: string) => Set<string>;
const NAMEN = ["SAMMELTICKET_TITEL", "LANGFUSE_SAMMELTICKET_TITEL", "CODEQUALITAET_SAMMELTICKET_TITEL", "SAMMELTICKET_TITEL_LISTE"] as const;

describe("sammelticket-titel", () => {
  test("das Blatt hat keinen Import", () => {
    const quelle = readFileSync(new URL("../scripts/sammelticket-titel.mjs", import.meta.url), "utf8");
    expect(importeAus(quelle)).toEqual([]);
  });

  test("die Liste enthält genau die drei Titel, das Präfix endet mit Leerzeichen", () => {
    expect(blatt.SAMMELTICKET_TITEL_LISTE).toEqual([blatt.SAMMELTICKET_TITEL, blatt.LANGFUSE_SAMMELTICKET_TITEL, blatt.CODEQUALITAET_SAMMELTICKET_TITEL]);
    expect(blatt.SAMMELTICKET_TITEL).toBe("Harness-Härtung (gesammelt)");
    expect(blatt.NICHT_EINTRAGBAR_PRAEFIX).toBe("Nicht eintragbar: ");
  });

  test("Zeilenerkennung: eine Quelle im Blatt, produktquote-lib exportiert dieselben Objekte, meldung-lib trägt keine Kopie des Regex (L45)", () => {
    expect(produktquote.BEFUND_ZEILE).toBe(blatt.BEFUND_ZEILE);
    expect(produktquote.BEFUND_ZEILE_OFFEN).toBe(blatt.BEFUND_ZEILE_OFFEN);
    for (const z of ["- [ ] a", "  * [ ] b", "-   [ ] c"]) expect(blatt.BEFUND_ZEILE_OFFEN.test(z)).toBe(true);
    for (const z of ["- [x] a", "[ ] a", "text - [ ] a"]) expect(blatt.BEFUND_ZEILE_OFFEN.test(z)).toBe(false);
    expect(blatt.BEFUND_ZEILE.test("- [x] a")).toBe(true);
    const meldung = readFileSync(new URL("../scripts/meldung-lib.mjs", import.meta.url), "utf8");
    expect(meldung).toContain('from "./sammelticket-titel.mjs"');
    expect(meldung).not.toContain(String.raw`\[ \]`);
  });

  const boardText = readFileSync(new URL("../scripts/board-lib.mjs", import.meta.url), "utf8");
  test("board-lib exportiert die Titel unverändert weiter (Re-Export wird von exporteAus als vorhanden erkannt)", () => {
    for (const n of NAMEN) {
      expect(boardLib[n]).toBe(blatt[n]);
      expect(exporteAus(boardText).has(n)).toBe(true);
    }
  });
});
