/* @harness-waechter
 * Regex-Hilfen der Kern-Tests (quellprojekt#1906): Escape und Ganzes-Wort-Matcher. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { escapeRe, ganzesWortRe } from "../support/regex";

describe("escapeRe", () => {
  test("Metazeichen wirken nur als Text", () => {
    assert.equal(new RegExp(`^${escapeRe("a.b+c(d)")}$`).test("a.b+c(d)"), true);
    assert.equal(new RegExp(`^${escapeRe("a.b")}$`).test("axb"), false);
  });
});

describe("ganzesWortRe", () => {
  test("trifft das ganze Wort, auch zwischen Nicht-Buchstaben", () => {
    assert.equal(ganzesWortRe(["alpha"]).test("Alpha.Scene"), true);
    assert.equal(ganzesWortRe(["alpha", "beta"]).test("im Beta"), true);
  });
  test("trifft nicht als Teil eines Worts (Buchstabe, Ziffer, Unterstrich, Umlaut davor oder dahinter)", () => {
    for (const s of ["alphax", "xalpha", "alpha2", "_alpha", "alphaä", "äalpha"]) assert.equal(ganzesWortRe(["alpha"]).test(s), false, s);
  });
  test("mehrere Wörter: die Wortgrenze gilt für jedes, nicht nur für das erste und letzte Ende", () => {
    for (const s of ["alphax", "xbeta", "xalpha", "betax"]) assert.equal(ganzesWortRe(["alpha", "beta"]).test(s), false, s);
    assert.equal(ganzesWortRe(["alpha", "beta"]).test("beta"), true);
  });
  test("Wörter mit Metazeichen werden maskiert", () => {
    assert.equal(ganzesWortRe(["a.b"]).test("axb"), false);
    assert.equal(ganzesWortRe(["a.b"]).test("a.b"), true);
  });
  test("Flags: Standard ignoriert Groß-/Kleinschreibung, eigene Flags gelten", () => {
    assert.equal(ganzesWortRe(["beta"]).test("BETA"), true);
    assert.equal(ganzesWortRe(["beta"], "u").test("BETA"), false);
  });
  test("Negativ: Flags ohne u werfen, statt still falsch zu matchen", () => {
    assert.throws(() => ganzesWortRe(["beta"], "i"), /flags müssen "u" enthalten/);
    assert.throws(() => ganzesWortRe(["beta"], ""), /flags müssen "u" enthalten/);
  });
});
