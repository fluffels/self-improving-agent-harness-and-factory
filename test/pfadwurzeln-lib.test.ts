/* Produktbezug-Hinweis der Ticket-Auswahl (factory#220 L44): `fehlendePfadwurzeln` liefert die ersten Pfadsegmente aus Inline-Code-Pfaden eines Bodys, die im Repo fehlen. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/pfadwurzeln-lib.mjs";

const M = raw as unknown as {
  fehlendePfadwurzeln: (body: string, existiert: (wurzel: string) => boolean) => string[];
  pfadHinweis: (nr: number, body: string, existiert: ((wurzel: string) => boolean) | undefined) => string[];
};
const VORHANDEN = new Set(["scripts", "docs", "test", ".github"]);
const existiert = (w: string) => VORHANDEN.has(w);

describe("fehlendePfadwurzeln", () => {
  test("liefert nur Wurzeln, die fehlen, sortiert und ohne Dublette; vorhandene Wurzeln (auch neue Dateien darunter) nie", () => {
    const body = "Siehe `src/game/main.ts` und `src/ui/x.ts`, `e2e/smoke.spec.ts`, aber `scripts/neu.mjs` und `.github/workflows/a.yml` sowie `docs/neu/seite.md`.";
    expect(M.fehlendePfadwurzeln(body, existiert)).toEqual(["e2e", "src"]);
  });

  test("ausgenommen: Platzhalter <…>, URLs, absolute Pfade, ~, .., Befehle mit Leerraum, Repo-Verweise mit #, Label mit :, Text ohne Inline-Code", () => {
    const ausnahmen = ["`<ordner>/datei`", "`https://example.org/a/b`", "`/etc/hosts`", "`~/x/y`", "`../fremd/x`", "`a/../b`", "`git log a/b`", "`org/repo#5`", "`area:x/y`", "src/ohne/code.ts im Fließtext", "`C:\\x\\y`", "`ohneSchrägstrich`"];
    for (const a of ausnahmen) expect(M.fehlendePfadwurzeln(a, existiert), a).toEqual([]);
  });

  test("Satzzeichen am Ende stört nicht, ein Pfad mit Anker (#) ist ausgenommen, ein Ordner mit Schlussstrich zählt", () => {
    expect(M.fehlendePfadwurzeln("`src/a.ts.` `e2e/x.md#anker` `produkt/`", existiert)).toEqual(["produkt", "src"]);
  });

  test("leerer oder fehlender Body: keine Wurzel", () => {
    expect(M.fehlendePfadwurzeln("", existiert)).toEqual([]);
    expect(M.fehlendePfadwurzeln(undefined as unknown as string, existiert)).toEqual([]);
  });
});

describe("pfadHinweis", () => {
  test("eine Zeile mit Nummer und Wurzeln, ohne Wurzeln oder ohne Prüfer leer", () => {
    expect(M.pfadHinweis(12, "`src/a.ts` `e2e/b.ts`", existiert)).toEqual(["#12 nennt Pfade ohne Wurzel im Repo (e2e, src): Produktbezug prüfen, ggf. Ticket ins Produkt-Repo übertragen"]);
    expect(M.pfadHinweis(12, "`scripts/a.mjs`", existiert)).toEqual([]);
    expect(M.pfadHinweis(12, "`src/a.ts`", undefined)).toEqual([]);
  });
  test("mehr als fünf Wurzeln werden mit … gekürzt", () => {
    const body = ["a", "b", "c", "d", "e", "f", "g"].map((w) => `\`${w}/x\``).join(" ");
    expect(M.pfadHinweis(1, body, existiert)[0]).toContain("(a, b, c, d, e, …)");
  });
});
