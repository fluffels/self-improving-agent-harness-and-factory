/* Fehlertext der gh-Aufrufe (Befund Lauf 2026-10-12, #1609): `fehlerText`/`fehlerMeldung` stehen einmal in scripts/gh-cli.mjs
 * und tragen die Ursache (Rest der Meldung, stderr) statt nur der ersten Zeile. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/gh-cli.mjs";

const G = raw as unknown as {
  fehlerText: (e: unknown, max?: number) => string;
  fehlerMeldung: (e: unknown, o?: { praefix?: string; zusatz?: string; max?: number }) => string;
};

describe("fehlerMeldung: der Log eines abgebrochenen Takts trägt die Ursache", () => {
  const F = (e: unknown, max?: number) => G.fehlerMeldung(e, { max });
  test("erste Zeile als ::error::, der Rest der Meldung folgt", () => {
    expect(F(new Error("Command failed: gh api x\ngh: HTTP 502\nServer Error"))).toBe("::error::Command failed: gh api x\ngh: HTTP 502\nServer Error");
  });
  test("stderr wird angehängt, wenn die Meldung ihn nicht schon trägt, sonst nicht doppelt", () => {
    const e = Object.assign(new Error("Command failed: gh api x"), { stderr: "  gh: API rate limit exceeded \n" });
    expect(F(e)).toBe("::error::Command failed: gh api x\ngh: API rate limit exceeded");
    const schon = Object.assign(new Error("Command failed: gh api x\ngh: HTTP 502"), { stderr: "gh: HTTP 502\n" });
    expect(F(schon)).toBe("::error::Command failed: gh api x\ngh: HTTP 502");
  });
  test("lange Ursache wird gekürzt, eine einzeilige Meldung bleibt eine Zeile, Nicht-Error-Wurf wirft nicht", () => {
    const lang = Object.assign(new Error("Command failed: x"), { stderr: "a".repeat(5000) });
    const text = F(lang, 100);
    expect(text.length).toBeLessThan(200);
    expect(text).toContain("(gekürzt)");
    expect(F(new Error("nur eine Zeile"))).toBe("::error::nur eine Zeile");
    expect(F("Text statt Error")).toBe("::error::Text statt Error");
    expect(F(undefined)).toBe("::error::undefined");
  });
  test("praefix steht hinter ::error::, zusatz in einer eigenen Zeile am Ende", () => {
    const e = Object.assign(new Error("Command failed: gh api x"), { stderr: "gh: HTTP 502" });
    expect(G.fehlerMeldung(e, { praefix: "Position nicht gesetzt: ", zusatz: "Wiederholung ist idempotent." })).toBe(
      "::error::Position nicht gesetzt: Command failed: gh api x\ngh: HTTP 502\nWiederholung ist idempotent.",
    );
  });
});

describe("fehlerText", () => {
  test("ohne ::error::, mehrzeilig mit stderr; ein String bleibt erhalten", () => {
    const e = Object.assign(new Error("a\nb"), { stderr: "c" });
    expect(G.fehlerText(e)).toBe("a\nb\nc");
    expect(G.fehlerText("AGENTS.md muss die Position genau einmal nennen\nZeile 2")).toBe("AGENTS.md muss die Position genau einmal nennen\nZeile 2");
  });
});

describe("schreibrechtText / fehlendeLabels (#76): fehlende Schreibrechte im Ziel-Repo sind eine klare Meldung", () => {
  const S = raw as unknown as { schreibrechtText: (e: unknown, repo: string) => string | null; fehlendeLabels: (a: unknown, l: string[]) => string[] };
  for (const muster of ["gh: HTTP 403: Forbidden", "gh: HTTP 404: Not Found", "Resource not accessible by integration", "Must have admin rights to Repository"]) {
    test(`erkennt: ${muster}`, () => {
      const t = S.schreibrechtText(Object.assign(new Error("Command failed: gh api x"), { stderr: muster }), "zz-org/zz-ziel");
      expect(t).toMatch(/keine Schreibrechte auf zz-org\/zz-ziel/);
      expect(t).toContain(muster.slice(0, 20));
      expect(t).toMatch(/nichts im eigenen Repo angelegt/);
    });
  }
  test("Groß-/Kleinschreibung egal, und der Rohtext wird auf 200 Zeichen gekürzt", () => {
    const t = S.schreibrechtText(new Error(`resource not accessible by integration ${"x".repeat(500)}`), "zz-org/zz-ziel") ?? "";
    expect(t).toMatch(/keine Schreibrechte auf zz-org\/zz-ziel/);
    expect(t).toContain("x".repeat(100));
    expect(t).not.toContain("x".repeat(300));
  });
  test("ein anderer Fehler (HTTP 500) ist keine Rechte-Meldung", () => {
    expect(S.schreibrechtText(new Error("Command failed\ngh: HTTP 500"), "zz-org/zz-ziel")).toBeNull();
  });
  test("fehlendeLabels nennt die Labels, die die Antwort nicht trägt (Strings und Objekte), und liefert [] bei vollständiger Antwort", () => {
    expect(S.fehlendeLabels({ labels: [{ name: "a" }, "b"] }, ["a", "b", "c"])).toEqual(["c"]);
    expect(S.fehlendeLabels({ labels: [{ name: "a" }] }, ["a"])).toEqual([]);
    expect(S.fehlendeLabels({}, ["a"])).toEqual(["a"]);
    expect(S.fehlendeLabels(null, ["a"])).toEqual(["a"]);
  });
});
