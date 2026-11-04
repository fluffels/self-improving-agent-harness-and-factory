import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { projektBlock, projektBlockZeilen } from "./projekt-block";

const START = "<!-- factory-projekt:start -->";
const ENDE = "<!-- factory-projekt:ende -->";

describe("projektBlock", () => {
  test("liefert den Inhalt zwischen den Markern, ohne Marker, bis zum ersten Ende danach", () => {
    assert.equal(projektBlock(`vorn\n${START}\nA\n${ENDE}\nhinten\n${ENDE}`), "\nA\n");
    assert.equal(projektBlock(`${START}${ENDE}`), "");
  });
  test("ohne Start, ohne Ende oder mit Ende nur vor dem Start: null", () => {
    assert.equal(projektBlock("nichts"), null);
    assert.equal(projektBlock(`${START}\nNur Start`), null);
    assert.equal(projektBlock(`${ENDE}\n${START}\nx`), null);
    assert.equal(projektBlock(`${ENDE}\nx`), null);
    assert.equal(projektBlock(`${"x".repeat(40)}${ENDE}`), null, "Ende ohne Start");
  });
});

describe("projektBlockZeilen", () => {
  test("liefert die 0-basierten Zeilen von Start- bis Ende-Marker, beide eingeschlossen", () => {
    assert.deepEqual(projektBlockZeilen(`a\n${START}\nB\nC\n${ENDE}\nd`), [1, 4]);
    assert.deepEqual(projektBlockZeilen(`${START}\n${ENDE}`), [0, 1]);
    assert.deepEqual(projektBlockZeilen(`${START}${ENDE}`), [0, 0]);
  });
  test("fehlt ein Marker oder steht das Ende vor dem Start: null (fail-closed)", () => {
    assert.equal(projektBlockZeilen("nichts"), null);
    assert.equal(projektBlockZeilen(`a\n${START}\nNur Start`), null);
    assert.equal(projektBlockZeilen(`${ENDE}\n${START}\nx`), null);
    assert.equal(projektBlockZeilen(`${ENDE}\nx`), null);
  });
});
