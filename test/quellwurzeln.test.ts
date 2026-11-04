/* Quellwurzeln und Endungsliste der Projekt-Config (factory#181): `scripts/quellwurzeln-lib.mjs`. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/quellwurzeln-lib.mjs";

interface Quellen { quelle: string | string[]; wurzeln: string[]; endungen: string[]; ohne: string[] }
const lib = rawLib as unknown as {
  STANDARD_ENDUNGEN: string[];
  quellenMaengel: (s: unknown) => string[];
  quellenAus: (c: unknown) => Quellen;
  istGlob: (m: string) => boolean;
  ordnerZuMuster: (root: string, muster: string) => string[];
  quellDateien: (root: string, q: { wurzeln: string[]; endungen: string[]; ohne?: string[] }) => string[];
};

describe("quellenMaengel (factory#181)", () => {
  test("gültige Formen", () => {
    for (const s of [
      { quelle: "scripts" },
      { quelle: ["a/src", "*/src/main/java", "**/lib"] },
      { quelle: "a", endungen: [".java", ".ts", ".d.ts"] },
      { quelle: "a", ohne: ["**/*.spec.ts"] },
      { quelle: "a", ohne: [] },
    ]) assert.deepEqual(lib.quellenMaengel(s), [], JSON.stringify(s));
  });
  test("quelle: ungültige Formen sind rot", () => {
    for (const q of [[], [3], ["a", "a"], ["a/../b"], ["/abs"], "", " ", 3, undefined, "a/../b", "src/"]) {
      assert.ok(lib.quellenMaengel({ quelle: q }).length > 0, JSON.stringify(q));
    }
  });
  test("ein String mit Glob-Zeichen verlangt die Listenform", () => {
    assert.match(lib.quellenMaengel({ quelle: "*/src" }).join("|"), /als Liste schreiben/);
    assert.match(lib.quellenMaengel({ quelle: "a?" }).join("|"), /als Liste schreiben/);
  });
  test("endungen: Form, Punkt, Dubletten", () => {
    for (const e of ["java", [], ["java"], ["x.java"], [".java", ".java"], [".ja va"], [3], ["."], [".a."]]) {
      assert.match(lib.quellenMaengel({ quelle: "a", endungen: e }).join("|"), /struktur\.endungen/, JSON.stringify(e));
    }
  });
  test("ohne: Liste gültiger Globs", () => {
    for (const o of ["x", ["a/../b"], [3], ["a", "a"]]) {
      assert.match(lib.quellenMaengel({ quelle: "a", ohne: o }).join("|"), /struktur\.ohne/, JSON.stringify(o));
    }
  });
  test("kein Objekt (auch eine Liste): nichts zu prüfen (das meldet der Aufrufer)", () => {
    assert.deepEqual(lib.quellenMaengel(undefined), []);
    assert.deepEqual(lib.quellenMaengel(["x"]), []);
  });
});

describe("quellenAus (factory#181)", () => {
  test("wirft ohne Block und ohne quelle mit Fix-Zeile", () => {
    for (const c of [undefined, {}, { struktur: null }, { struktur: {} }, { struktur: { endungen: [".ts"] } }]) {
      assert.throws(() => lib.quellenAus(c), /struktur\.quelle fehlt[\s\S]*Fix:/, JSON.stringify(c));
    }
  });
  test("wirft bei kaputter Form mit Fix-Zeile", () => {
    assert.throws(() => lib.quellenAus({ struktur: { quelle: "a", endungen: ["java"] } }), /struktur\.endungen[\s\S]*Fix:/);
  });
  test("Standardwerte und Kopien", () => {
    const s = lib.quellenAus({ struktur: { quelle: "src" } });
    assert.deepEqual(s, { quelle: "src", wurzeln: ["src"], endungen: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"], ohne: [] });
    s.endungen.push(".x");
    assert.equal(lib.STANDARD_ENDUNGEN.length, 6, "Standard bleibt unverändert");
    const l = lib.quellenAus({ struktur: { quelle: ["a", "*/b"], endungen: [".java"], ohne: ["**/x"] } });
    assert.deepEqual([l.wurzeln, l.endungen, l.ohne], [["a", "*/b"], [".java"], ["**/x"]]);
  });
});

describe("ordnerZuMuster und quellDateien (factory#181)", () => {
  const baum = (): string => fixture({
    "a/src/main/java/X.java": "x",
    "b/src/main/java/Y.java": "x",
    "c/src/test/java/Z.java": "x",
    "lib/l.ts": "x",
    "x/lib/m.ts": "x",
    "x/y/lib/n.ts": "x",
    "node_modules/p/lib/o.ts": "x",
    ".h/lib/p.ts": "x",
    ".claude/q/src/r.ts": "x",
    "datei-nur": "x",
    "ab/f.ts": "x",
  });
  test("ein Glob trifft die passenden Ordner", () => {
    const d = baum();
    assert.deepEqual(lib.ordnerZuMuster(d, "*/src/main/java"), ["a/src/main/java", "b/src/main/java"]);
  });
  test("** trifft null oder mehr Ebenen, aber nie node_modules oder Punkt-Ordner", () => {
    const d = baum();
    assert.deepEqual(lib.ordnerZuMuster(d, "**/lib"), ["lib", "x/lib", "x/y/lib"]);
  });
  test("ein wörtlicher Punkt-Präfix wird aufgelöst", () => {
    assert.deepEqual(lib.ordnerZuMuster(baum(), ".claude/*/src"), [".claude/q/src"]);
  });
  test("fehlender Präfix und Glob, der nur eine Datei trifft: leer", () => {
    const d = baum();
    assert.deepEqual(lib.ordnerZuMuster(d, "gibts-nicht/*/src"), []);
    assert.deepEqual(lib.ordnerZuMuster(d, "datei-*"), []);
  });
  test("? steht für ein Zeichen im Segment", () => {
    assert.deepEqual(lib.ordnerZuMuster(baum(), "?/src"), ["a/src", "b/src", "c/src"]);
    assert.deepEqual(lib.ordnerZuMuster(baum(), "a?"), ["ab"]);
  });
  test("wörtlicher Pfad: nur ein vorhandener Ordner", () => {
    const d = baum();
    assert.deepEqual(lib.ordnerZuMuster(d, "lib"), ["lib"]);
    assert.deepEqual(lib.ordnerZuMuster(d, "datei-nur"), []);
    assert.deepEqual(lib.ordnerZuMuster(d, "nix"), []);
  });
  test("quellDateien: Endungsfilter, ohne, Dubletten und .d.ts", () => {
    const d = fixture({
      "a/src/A.java": "x", "a/src/ATest.java": "x", "a/src/app.spec.ts": "x", "a/src/t.d.ts": "x", "a/src/t.json": "x", "a/src/k.ts": "x",
    });
    const w = { wurzeln: ["a/src", "a"], endungen: [".java", ".ts"] };
    assert.deepEqual(lib.quellDateien(d, w), ["a/src/A.java", "a/src/ATest.java", "a/src/app.spec.ts", "a/src/k.ts", "a/src/t.d.ts"]);
    assert.deepEqual(lib.quellDateien(d, { ...w, ohne: ["**/*.spec.ts", "**/*Test.java"] }), ["a/src/A.java", "a/src/k.ts", "a/src/t.d.ts"]);
    assert.deepEqual(lib.quellDateien(d, { wurzeln: ["a/src"], endungen: [".d.ts"] }), ["a/src/t.d.ts"]);
  });
});
