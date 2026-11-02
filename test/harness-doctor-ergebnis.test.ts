import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { ausFehler as rawAusFehler, gut as rawGut, luecke as rawLuecke, nichtPruefbar as rawNichtPruefbar } from "../scripts/harness-doctor-ergebnis.mjs";

interface Punkt { punkt: string; ok: boolean; hinweis?: string; befund?: string; fix?: string; link?: string; aktion?: unknown; nichtPruefbar?: boolean }
const gut = rawGut as (p: string, hinweis?: string) => Punkt;
const luecke = rawLuecke as (p: string, b: string, f: string, link?: string, aktion?: unknown) => Punkt;
const nichtPruefbar = rawNichtPruefbar as (p: string, g: string, f: string, link?: string) => Punkt;
const ausFehler = rawAusFehler as (p: string, was: string, q: { fehler: string; fix?: string }, std: string, link?: string) => Punkt;

describe("Doctor-Ergebnisform (factory#127)", () => {
  test("gut: nur gesetzte Felder erscheinen", () => {
    expect(gut("P")).toStrictEqual({ punkt: "P", ok: true });
    expect(gut("P", "h")).toStrictEqual({ punkt: "P", ok: true, hinweis: "h" });
  });

  test("luecke: link und aktion nur wenn gesetzt", () => {
    expect(luecke("P", "b", "f")).toStrictEqual({ punkt: "P", ok: false, befund: "b", fix: "f" });
    expect(luecke("P", "b", "f", "l", { art: "label" })).toStrictEqual({ punkt: "P", ok: false, befund: "b", fix: "f", link: "l", aktion: { art: "label" } });
  });

  test("nichtPruefbar: Marker, Grund als Befund, link nur wenn gesetzt", () => {
    expect(nichtPruefbar("P", "g", "f")).toStrictEqual({ punkt: "P", ok: false, nichtPruefbar: true, befund: "g", fix: "f" });
    expect(nichtPruefbar("P", "g", "f", "l").link).toBe("l");
  });

  test("ausFehler: quelle.fix hat Vorrang vor dem Standard-Fix", () => {
    expect(ausFehler("P", "Was", { fehler: "x" }, "std")).toMatchObject({ nichtPruefbar: true, befund: "Was nicht lesbar (x)", fix: "std" });
    expect(ausFehler("P", "Was", { fehler: "x", fix: "eigen" }, "std").fix).toBe("eigen");
  });
});
