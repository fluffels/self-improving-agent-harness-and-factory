/* factory#208 L13: EINE Schrittnamen-Konstante in regex-lib.mjs; verify-lauf, check:docdrift und die Doku-Erkennung akzeptieren dieselben Namen (auch mit Punkt). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ketten from "../scripts/docs-gen/npm-ketten.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as drift from "../scripts/check-docdrift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as markdown from "../scripts/docs-gen/markdown.mjs";

const k = ketten as { parseChain: (s: string) => string[]; SCHRITT_RE: RegExp; ketteAusPackage: (p: unknown, c: string[], n: string) => string[] };
const d = drift as { parseVerifyChain: (s: Record<string, string>) => string[]; findDocumentedVerifyChains: (md: string) => string[][] };
const m = markdown as { parseNpmRunMentions: (md: string) => Set<string> };

describe("gemeinsamer Schrittname", () => {
  test("die Konstante erlaubt Punkt, Doppelpunkt, Bindestrich und lehnt Shell-Zeichen ab", () => {
    expect(k.SCHRITT_RE.test("check:a.b-c_d")).toBe(true);
    expect(k.SCHRITT_RE.test("a;b")).toBe(false);
    expect(k.SCHRITT_RE.test("")).toBe(false);
  });

  test("ein Name mit Punkt läuft durch verify-lauf UND check:docdrift (kein Auseinanderlaufen)", () => {
    const scripts = { verify: "npm run typecheck && npm run check:x.y && npm test", typecheck: "tsc", "check:x.y": "node a", test: "vitest" };
    expect(k.ketteAusPackage({ scripts }, ["verify"], "verify")).toContain("check:x.y");
    expect(d.parseVerifyChain(scripts)).toContain("check:x.y");
  });

  test("ein Shell-Zeichen im Namen lässt beide Prüfer rot werden", () => {
    const scripts = { verify: "npm run typecheck && echo hi && npm test", typecheck: "tsc", test: "vitest" };
    expect(() => d.parseVerifyChain(scripts)).toThrow(/Skriptnamen/);
  });

  test("die Doku-Erkennung (Kette im Text, npm run) kennt Namen mit Punkt", () => {
    expect(d.findDocumentedVerifyChains("typecheck → check:x.y → test")).toEqual([["typecheck", "check:x.y", "test"]]);
    expect([...m.parseNpmRunMentions("`npm run check:x.y`")]).toEqual(["check:x.y"]);
  });

  test("ein Satzpunkt hinter dem Namen gehört nicht dazu (Fließtext, auch vor Klammer)", () => {
    expect([...m.parseNpmRunMentions("Danach npm run lint:prune. Dann weiter.")]).toEqual(["lint:prune"]);
    expect([...m.parseNpmRunMentions("(npm run skills:sync.)")]).toEqual(["skills:sync"]);
    expect(k.SCHRITT_RE.test("verify.")).toBe(false);
  });

  test("L67: node scripts/gate-befehl.mjs <name> ist ein Kettenschritt gate-befehl:<name>", () => {
    expect(k.parseChain("npm run verify && node scripts/gate-befehl.mjs coverage")).toEqual(["verify", "gate-befehl:coverage"]);
    const scripts = { verify: "npm run lint", lint: "eslint .", "verify:full": "npm run verify && node scripts/gate-befehl.mjs coverage && npm run check:x", "check:x": "node x" };
    expect(k.ketteAusPackage({ scripts }, ["verify", "verify:full"], "verify:full")).toEqual(["gate-befehl:coverage", "check:x"]);
  });

  test("L67: mehrere Leerzeichen zwischen den Teilen ergeben denselben Token", () => {
    expect(k.parseChain("node  scripts/gate-befehl.mjs  coverage")).toEqual(["gate-befehl:coverage"]);
  });

  test.each([
    "node scripts/gate-befehl.mjs coverage; rm x",
    "node scripts/gate-befehl.mjs testGezielt a.ts",
    "node scripts/gate-befehl.mjs coverage --zeigen",
    "node scripts/gate-befehl.mjs a|b",
    "node scripts/gate-befehl.mjs",
    "echo hi; node scripts/gate-befehl.mjs coverage",
    "node scripts/gate-befehl.mjs 1x",
    "node scripts/gate-befehl.mjs _x",
  ])("L67 Negativ: %s bleibt ein Fehler", (schritt) => {
    const scripts = { verify: "npm run lint", lint: "eslint .", "verify:full": "npm run verify && " + schritt };
    expect(() => k.ketteAusPackage({ scripts }, ["verify", "verify:full"], "verify:full")).toThrow(/Shell-Zeichen/);
  });
});
