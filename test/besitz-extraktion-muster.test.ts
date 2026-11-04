/* musterRegex (scripts/besitz-extraktion.mjs, factory#193): `*` bleibt im Segment, alle anderen Zeichen sind wörtlich;
 * die Maskierung kommt aus `escapeRegex` (scripts/ticket-namen.mjs). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { musterRegex } from "../scripts/besitz-extraktion.mjs";

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
