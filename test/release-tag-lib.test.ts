/* Release-Tag-Lib (Folge #103, #109): Release-Tags zerlegen und vergleichen. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/release-tag-lib.mjs";

const { teile, vergleiche, vergleicheTags } = raw as {
  teile: (tag: unknown) => number[] | null;
  vergleiche: (a: string, b: string) => number;
  vergleicheTags: (tags: string[]) => string | null;
};

describe("teile", () => {
  test("zerlegt v1.2.3 und 1.2.3 in Major, Minor, Patch", () => {
    assert.deepEqual(teile("v1.2.3"), [1, 2, 3]);
    assert.deepEqual(teile("1.2.3"), [1, 2, 3]);
  });
  test("alles andere ist null: zu kurz, Pre-Release, Präfix, kein String", () => {
    for (const tag of ["v1.2", "v1.2.3-rc1", "xv1.2.3", "v1.2.3.4", undefined, 5]) assert.equal(teile(tag), null, String(tag));
  });
});

describe("vergleiche", () => {
  test("negativ, 0, positiv; numerisch statt textlich", () => {
    assert.ok(vergleiche("v1.2.3", "v1.2.4") < 0);
    assert.equal(vergleiche("v1.2.3", "1.2.3"), 0);
    assert.ok(vergleiche("v1.10.0", "v1.9.0") > 0);
    assert.ok(vergleiche("v2.0.0", "v1.99.99") > 0);
  });
});

describe("vergleicheTags", () => {
  test("liefert den höchsten Release-Tag, numerisch statt textlich; Pre-Release und Fremdtags zählen nicht", () => {
    assert.equal(vergleicheTags(["v1.9.0", "v1.10.0", "1.2.3", "v2.0.0-rc1", "latest", "v1.10", "xv3.0.0"]), "v1.10.0");
  });
  test("Tag ohne v zählt und kann der höchste sein; der Patch entscheidet bei gleichem Major und Minor", () => {
    assert.equal(vergleicheTags(["1.3.0", "v1.2.0"]), "1.3.0");
    assert.equal(vergleicheTags(["v1.0.0", "v1.0.1", "v1.0.0"]), "v1.0.1");
  });
  test("ohne Release-Tag null", () => {
    assert.equal(vergleicheTags(["latest", "v1.0.0-beta"]), null);
  });
});
