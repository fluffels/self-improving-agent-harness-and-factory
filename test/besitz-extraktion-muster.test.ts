/* musterRegex (scripts/besitz-extraktion.mjs, factory#193): `*` bleibt im Segment, alle anderen Zeichen sind wörtlich;
 * die Maskierung kommt aus `escapeRegex` (scripts/regex-lib.mjs). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { musterRegex, pflichtReviewMuster, schutzlistenMuster } from "../scripts/besitz-extraktion.mjs";

const re = (m: string): RegExp => (musterRegex as (muster: string) => RegExp)(m);

describe("musterRegex", () => {
  test("Sonderzeichen im Muster sind wörtlich", () => {
    const r = re("docs/a+b(c)[d]{e}^$|?.md");
    assert.ok(r.test("docs/a+b(c)[d]{e}^$|?.md"));
    assert.ok(!r.test("docs/aab(c)[d]{e}^$|?.md"));
    assert.ok(!r.test("docs/a+b(c)[d]{e}^$|?Xmd"));
  });

  test("der Stern steht für beliebig viele Zeichen außer dem Slash", () => {
    const r = re("scripts/check-*.mjs");
    assert.ok(r.test("scripts/check-size.mjs"));
    assert.ok(r.test("scripts/check-.mjs"));
    assert.ok(!r.test("scripts/check-a/b.mjs"));
    assert.ok(!r.test("scripts/checkXsize.mjs"));
    assert.ok(!r.test("xscripts/check-size.mjs"));
  });
});

describe("pflichtReviewMuster (factory#348)", () => {
  const prm = pflichtReviewMuster as (text: string) => string[] | null;
  const slm = schutzlistenMuster as (text: string) => string[] | null;

  test("mit Gruppe pflichtReview nur deren Einträge", () => {
    assert.deepEqual(prm(JSON.stringify({ gate: ["/a"], pflichtReview: ["/b", "/c"] })), ["/b", "/c"]);
  });

  test("ohne Gruppe die ganze Schutzliste (Vollspiegel)", () => {
    const text = JSON.stringify({ gate: ["/a"], harness: ["/b"] });
    assert.deepEqual(prm(text), slm(text));
    assert.deepEqual(prm(text), ["/a", "/b"]);
  });

  test("kaputtes JSON oder eine Gruppe, die kein Array ist, ergibt null", () => {
    assert.equal(prm("{kaputt"), null);
    assert.equal(prm(JSON.stringify({ gate: ["/a"], pflichtReview: "x" })), null);
  });

  test("Nicht-Strings in der Gruppe werden gefiltert", () => {
    assert.deepEqual(prm(JSON.stringify({ pflichtReview: ["/b", 3, null, "/c"] })), ["/b", "/c"]);
  });

  test("schutzlistenMuster enthält die Einträge von pflichtReview weiterhin", () => {
    assert.deepEqual(slm(JSON.stringify({ gate: ["/a"], pflichtReview: ["/b"] })), ["/a", "/b"]);
  });
});
