/* Das importfreie Blatt der Sammelticket-Titel (factory#220 L9): keine Importe (kein Config-Laden beim Import), `board-lib` exportiert dieselben Werte weiter. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { importeAus } from "./harness/hook-importe";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as blatt from "../scripts/sammelticket-titel.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { exporteAus } from "../scripts/tag-takt.mjs";

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

  const boardText = readFileSync(new URL("../scripts/board-lib.mjs", import.meta.url), "utf8");
  test("board-lib exportiert die Titel unverändert weiter (Re-Export wird von exporteAus als vorhanden erkannt)", () => {
    for (const n of ["SAMMELTICKET_TITEL", "LANGFUSE_SAMMELTICKET_TITEL", "CODEQUALITAET_SAMMELTICKET_TITEL", "SAMMELTICKET_TITEL_LISTE"] as const) {
      expect(boardLib[n]).toBe(blatt[n]);
      expect(exporteAus(boardText).has(n)).toBe(true);
    }
  });
});
