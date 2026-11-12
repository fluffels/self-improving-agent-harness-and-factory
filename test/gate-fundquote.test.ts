/* Gate-Fundquote (factory#39): Verhalten von scripts/gate-fundquote.mjs. Fixtures mit synthetischem Paket, IO ist injiziert. */
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gfModule from "../scripts/gate-fundquote.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { GATE_BEFEHL_NAMEN } from "../scripts/gate-befehl-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as vlModule from "../scripts/verify-lauf.mjs";

const vl = vlModule as { bericht: (e: Record<string, unknown>[], o: { modus: string; hinweis: string }) => string };

type Gate = { name: string; ergebnis: string; sek: number | null };
type Lauf = { quelle: string; id: string; gezaehlt: boolean; grund?: string; gates: Gate[] };
type Zahlen = { laeufe: number; gezaehlt: number; nichtGezaehlt: Record<string, number>; gates: { name: string; erreicht: number; rot: number; nichtErreicht: number; sessionsMitRot: number; medianSek: number | null }[] };
const gf = gfModule as {
  gateSatz: (pkg: unknown) => { gates: string[]; verify: string[]; paket: string };
  befehlsform: (c: string) => { art: string; aufrufe: number };
  laeufeAusTranskript: (z: unknown[], o: { sessionId: string; liesDatei: (p: string) => string; von?: number | null; bis?: number | null; ctx: Ctx }) => Lauf[];
  laeufeAusCiLog: (t: string, o: { id: string; ctx: Ctx }) => Lauf[];
  bewerteSumme: (t: string, o: { verify: string[] }) => { gates?: Gate[]; grund?: string } | null;
  zaehle: (l: Lauf[], g: string[]) => Zahlen;
  main: (argv: string[], deps?: Record<string, unknown>) => number;
};
type Ctx = { paket: string; gates: string[]; verify: string[] };

const pkg = {
  name: "beispiel",
  version: "1.0.0",
  scripts: {
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    "check:size": "node size.mjs",
    test: "vitest run",
    "test:coverage": "vitest run --coverage",
    "docs:gen": "node docs.mjs",
    verify: "npm run typecheck && npm run lint && npm run check:size && npm test",
    "verify:full": "npm run verify && npm run test:coverage",
  },
};
const ctx: Ctx = { paket: "beispiel", gates: ["typecheck", "lint", "check:size", "test", "test:coverage"], verify: ["typecheck", "lint", "check:size", "test"] };
const kopf = (s: string) => `> beispiel@1.0.0 ${s}\n> body ${s}\n\n`;
const ausgabe = (...s: string[]) => s.map(kopf).join("");
const T0 = Date.parse("2026-11-01T10:00:00.000Z");

type Aufruf = { command: string; array?: boolean; text?: string; fehler?: boolean; unterbrochen?: boolean; tool?: string; hintergrund?: boolean; ohneErgebnis?: boolean; ts?: number; id?: string };
function zeilen(aufrufe: Aufruf[]): unknown[] {
  const rows: unknown[] = [];
  aufrufe.forEach((a, i) => {
    const id = a.id ?? `t${i}`;
    const input: Record<string, unknown> = { command: a.command };
    if (a.hintergrund) input.run_in_background = true;
    rows.push({ type: "assistant", timestamp: new Date(a.ts ?? T0).toISOString(), message: { content: [{ type: "tool_use", id, name: a.tool ?? "Bash", input }] } });
    if (!a.ohneErgebnis) {
      rows.push({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: a.fehler === true, content: a.array ? [{ type: "text", text: a.text ?? "" }] : (a.text ?? "") }] }, toolUseResult: { interrupted: a.unterbrochen === true } });
    }
  });
  return rows;
}
const lies = () => "";
const laeufe = (a: Aufruf[], o: { von?: number | null; bis?: number | null; liesDatei?: (p: string) => string } = {}) =>
  gf.laeufeAusTranskript(zeilen(a), { sessionId: "sess1", liesDatei: o.liesDatei ?? lies, von: o.von, bis: o.bis, ctx });
const erg = (l: Lauf) => Object.fromEntries(l.gates.map((g) => [g.name, g.ergebnis]));
const json = (t: string) => JSON.parse(t) as { quellen: Record<string, Zahlen> };
const zeile = (z: Zahlen, name: string) => z.gates.find((g) => g.name === name)!;

describe("gateSatz", () => {
  test("verify plus Zusatzschritte von verify:full, ohne fremde Skripte", () => {
    const s = gf.gateSatz(pkg);
    expect(s.gates).toEqual(["typecheck", "lint", "check:size", "test", "test:coverage"]);
    expect(s.verify).toEqual(["typecheck", "lint", "check:size", "test"]);
    expect(s.gates).not.toContain("docs:gen");
  });
  test("das echte package.json: gateSatz wirft nicht, jedes Gate ist ein Skript oder ein Gate-Befehl (L68)", () => {
    const echt = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    const s = gf.gateSatz(echt);
    expect(s.gates).toContain("check:diffcoverage");
    expect(s.verify.length).toBeGreaterThan(0);
    const gateBefehle = s.gates.filter((g) => g.startsWith("gate-befehl:")).map((g) => g.slice("gate-befehl:".length));
    for (const n of gateBefehle) expect(GATE_BEFEHL_NAMEN as string[]).toContain(n);
    for (const g of s.gates.filter((x) => !x.startsWith("gate-befehl:"))) expect(echt.scripts[g], g).toBeTypeOf("string");
  });
  test("wirft ohne verify", () => {
    expect(() => gf.gateSatz({ name: "x", scripts: { lint: "eslint ." } })).toThrow(/verify/);
  });
  test("wirft bei Shell-Zeichen im Namen eines Zusatzschritts von verify:full", () => {
    const p = { ...pkg, scripts: { ...pkg.scripts, "verify:full": "npm run verify && npm run a;b" } };
    expect(() => gf.gateSatz(p)).toThrow(/Shell/);
  });
  test("wirft bei Shell-Zeichen im Namen eines verify-Schritts", () => {
    expect(() => gf.gateSatz({ ...pkg, scripts: { ...pkg.scripts, verify: "npm run lint && npm run a;b" } })).toThrow(/Shell/);
  });
  test("wirft ohne Paketnamen", () => {
    expect(() => gf.gateSatz({ scripts: { verify: "npm run lint", lint: "eslint ." } })).toThrow(/Namen/);
  });
});

describe("befehlsform", () => {
  test.each([
    "npm run verify",
    "cd /tmp/x && npm run lint 2>&1",
    "FOO=1 npm run lint -- --fix",
    "npm test",
    "npm run -s check:size && npm t",
    'node scripts/gate-befehl.mjs verifyKompakt',
    "node scripts/verify-lauf.mjs --changed",
    'cd "/tmp/mit leer" && npm run verify',
  ])("ok: %s", (c) => {
    expect(gf.befehlsform(c).art).toBe("ok");
  });
  test("Schrittname ohne Punkt am Ende (eine Quelle mit SCHRITT_NAME, factory#215): verify. ist keine Befehlsform, verify:kompakt schon", () => {
    expect(gf.befehlsform("npm run verify.").art).toBe("befehlsform");
    expect(gf.befehlsform("npm run verify:kompakt").art).toBe("ok");
  });
  test("Pipe", () => {
    expect(gf.befehlsform("npm run verify 2>&1 | tail -20").art).toBe("pipe");
  });
  test.each(["npm run lint; npm run test", "npm run lint || true", "git push", "npm run lint & npm test", "npm run lint\nnpm test", "echo $(npm run lint)", "npm run lint > out.txt", "node scripts/gate-befehl.mjs verify --zeigen"])("Befehlsform: %s", (c) => {
    expect(gf.befehlsform(c).art).toBe("befehlsform");
  });
  test.each(["npm run lint > x.txt", "npm run lint < x.txt", "npm run lint >x.txt", "npm run lint &> x.txt", "npm run lint 2> x.txt", "npm run lint 1>&2"])("Umleitung außerhalb von 2>&1 und 2>/dev/null: %s", (c) => {
    expect(gf.befehlsform(c).art).toBe("befehlsform");
  });
  test("2>&1 | tail ist Pipe, 2>/dev/null ist ok, gequotetes > ist kein Umleiten", () => {
    expect(gf.befehlsform("npm run lint 2>&1 | tail").art).toBe("pipe");
    expect(gf.befehlsform("npm run lint 2>/dev/null").art).toBe("ok");
    expect(gf.befehlsform('cd "a > b" && npm run lint').art).toBe("ok");
  });
  test("offenes Quote und nicht parsbare Eingabe: Befehlsform", () => {
    expect(gf.befehlsform("npm run lint 'x").art).toBe("befehlsform");
    expect(gf.befehlsform("if true; then npm run lint; fi").art).toBe("befehlsform");
    expect(gf.befehlsform("(npm run lint)").art).toBe("befehlsform");
    expect(gf.befehlsform("npm run lint <<EOF\nx\nEOF").art).toBe("befehlsform");
  });
  test("Operator, Hintergrund, Negation, Ersetzung und Umleitung hinter der Pipe: Befehlsform", () => {
    expect(gf.befehlsform("npm run lint || npm test").art).toBe("befehlsform");
    expect(gf.befehlsform("npm run lint &").art).toBe("befehlsform");
    expect(gf.befehlsform("! npm run lint").art).toBe("befehlsform");
    expect(gf.befehlsform("npm run lint $(date)").art).toBe("befehlsform");
    expect(gf.befehlsform("npm run lint | tail > x.txt").art).toBe("befehlsform");
  });
  test("Pipe: gewertet wird das erste Kommando", () => {
    expect(gf.befehlsform("git log | npm run lint").art).toBe("befehlsform");
    expect(gf.befehlsform("npm run lint | tail | head")).toEqual({ art: "pipe", aufrufe: 1 });
  });
  test("zählt die Gate-Aufrufe", () => {
    expect(gf.befehlsform("cd x && npm run lint && npm test").aufrufe).toBe(2);
  });
  test("ein reines Env-Segment ist neutral", () => {
    expect(gf.befehlsform("FOO=1 && npm run lint")).toEqual({ art: "ok", aufrufe: 1 });
  });
  test("ein Env-Segment mit mehreren Zuweisungen ist neutral", () => {
    expect(gf.befehlsform("A=1 B=2 && npm run lint")).toEqual({ art: "ok", aufrufe: 1 });
  });
  test("eine gequotete Zuweisung bleibt Env-Präfix, ein gequotetes Wort ist kein Befehl", () => {
    expect(gf.befehlsform('FOO="a b" npm run lint')).toEqual({ art: "ok", aufrufe: 1 });
    expect(gf.befehlsform('"npm" run lint')).toEqual({ art: "befehlsform", aufrufe: 0 });
  });
  test("Env-Präfix vor einem Fremdbefehl bleibt fremd, Env-Präfix vor einem Gate zählt", () => {
    expect(gf.befehlsform("FOO=1 git push && npm run lint")).toEqual({ art: "befehlsform", aufrufe: 1 });
    expect(gf.befehlsform("FOO=1 npm run lint").aufrufe).toBe(1);
  });
  test("viele Zuweisungen mit Fremdzeichen laufen linear (kein ReDoS)", () => {
    const t0 = Date.now();
    expect(gf.befehlsform("A=".repeat(50000) + " !").art).toBe("befehlsform");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe("Gate-Befehl-Schritt in verify:full (L67)", () => {
  const ctxFull: Ctx = { paket: "beispiel", gates: ["lint", "gate-befehl:coverage", "check:diffcoverage"], verify: ["lint"] };
  const voll = (...teile: string[]) => teile.join("");
  const lauf = (text: string, fehler = false) =>
    gf.laeufeAusTranskript(zeilen([{ command: "npm run verify:full", fehler, text: fehler ? "Exit code 1\n" + text : text }]), { sessionId: "s", liesDatei: lies, ctx: ctxFull });
  test("die gedruckte Zeile des Gate-Befehls zählt als Gate gate-befehl:coverage", () => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), "▶ Gate-Befehl coverage: npm run test:coverage\n", kopf("test:coverage"), kopf("check:diffcoverage"));
    expect(erg(lauf(text)[0])).toEqual({ lint: "gruen", "gate-befehl:coverage": "gruen", "check:diffcoverage": "gruen" });
  });
  test("ein Gate-Befehl, der nicht zum Gate-Satz gehört (verify), zählt nicht als Gate", () => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), "▶ Gate-Befehl verify: npm run verify\n", "▶ Gate-Befehl coverage: npm run test:coverage\n", kopf("check:diffcoverage"));
    expect(erg(lauf(text)[0])).toEqual({ lint: "gruen", "gate-befehl:coverage": "gruen", "check:diffcoverage": "gruen" });
  });
  test.each(["Fehler: ▶ Gate-Befehl coverage: npm run x\n", "▶ Gate-Befehl coverage npm run x\n"])("Negativ: Präfix mitten in der Zeile oder Name ohne Doppelpunkt zählt nicht (%j)", (zeile) => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), zeile, kopf("test:coverage"));
    expect(erg(lauf(text, true)[0])["gate-befehl:coverage"]).toBe("nicht-erreicht");
  });
  test("Negativ: ohne die gedruckte Zeile fehlt das Gate (nicht erreicht oder nicht gezählt)", () => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), kopf("test:coverage"));
    expect(erg(lauf(text, true)[0])["gate-befehl:coverage"]).toBe("nicht-erreicht");
  });
  test("ein rotes Coverage bleibt rot: der Folgekopf test:coverage ist verschachtelt und beendet das Gate nicht", () => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), "▶ Gate-Befehl coverage: npm run test:coverage\n", kopf("test:coverage"));
    expect(erg(lauf(text, true)[0])["gate-befehl:coverage"]).toBe("rot");
  });
  test("auch npm test als gedruckter Befehl macht den Folgekopf test verschachtelt (rot)", () => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), "▶ Gate-Befehl coverage: npm test\n", kopf("test"));
    expect(erg(lauf(text, true)[0])["gate-befehl:coverage"]).toBe("rot");
  });
  test("Negativ: ohne npm run in der Zeile endet das Gate an der fremden Kopfzeile (grün)", () => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), "▶ Gate-Befehl coverage: vitest run --coverage\n", kopf("test:coverage"));
    expect(erg(lauf(text, true)[0])["gate-befehl:coverage"]).toBe("gruen");
  });
  test("Negativ: eine Kopfzeile eines anderen Skripts als des Ziels ist nicht verschachtelt (grün)", () => {
    const text = voll(kopf("verify:full"), kopf("verify"), kopf("lint"), "▶ Gate-Befehl coverage: npm run test:coverage\n", kopf("docs:gen"));
    expect(erg(lauf(text, true)[0])["gate-befehl:coverage"]).toBe("gruen");
  });
  const GB = "▶ Gate-Befehl coverage: ";
  const namen = (text: string, c: Ctx = ctxFull) =>
    gf.laeufeAusTranskript(zeilen([{ command: "npm run verify:full", fehler: true, text: "Exit code 1\n" + text }]), { sessionId: "s", liesDatei: lies, ctx: c })[0].gates.map((g) => `${g.name}:${g.ergebnis}`);
  test("ein Folgekopf eines anderen Skripts setzt das Ziel zurück: ein späteres test:coverage ist nicht verschachtelt", () => {
    const text = voll(GB + "npm run test:coverage\n", kopf("lint"), kopf("test:coverage"));
    expect(namen(text)).toEqual(["gate-befehl:coverage:gruen", "lint:gruen"]);
  });
  test("die Kopfzeile eines fremden Pakets mit dem Skriptnamen des Ziels ist nicht verschachtelt (grün)", () => {
    const text = voll(GB + "npm run test:coverage\n", "> fremd@1.0.0 test:coverage\n> body\n\n");
    expect(namen(text)).toEqual(["gate-befehl:coverage:gruen"]);
  });
  test.each([
    ["vitest run --coverage", "test"], // kein npm
    ["npm testing", "test"], // `npm test` nur als ganzes Wort
    ["echo npm test", "test"], // nur am Zeilenanfang
    ["echo npm run test:coverage", "test:coverage"],
  ])("Negativ: Zeile %j macht den Folgekopf %s nicht verschachtelt (grün)", (rest, skript) => {
    expect(namen(voll(GB + rest + "\n", kopf(skript)))).toEqual(["gate-befehl:coverage:gruen"]);
  });
  test.each([["npm test", "test"], ["npm test -- x", "test"], ["  npm run test:coverage --silent", "test:coverage"]])("Positiv: Zeile %j macht den Folgekopf %s verschachtelt (rot)", (rest, skript) => {
    expect(namen(voll(GB + rest + "\n", kopf(skript)))).toEqual(["gate-befehl:coverage:rot"]);
  });
  test("verschachtelter Folgekopf zählt nicht noch einmal als eigenes Gate (auch wenn er im Gate-Satz steht)", () => {
    const c: Ctx = { paket: "beispiel", gates: ["lint", "gate-befehl:coverage", "test:coverage"], verify: ["lint"] };
    expect(namen(voll(kopf("verify:full"), kopf("verify"), kopf("lint"), GB + "npm run test:coverage\n", kopf("test:coverage")), c)).toEqual(["lint:gruen", "gate-befehl:coverage:rot"]);
  });
});

describe("Kopfzeilen im Transkript", () => {
  test("K5: die &&-Kette bricht beim ersten Rot ab, spätere Gates sind nicht erreicht und nie grün", () => {
    const l = laeufe([{ command: "npm run verify", fehler: true, text: `Exit code 1\n${ausgabe("verify", "typecheck", "lint")}` }]);
    expect(l).toHaveLength(1);
    expect(erg(l[0])).toEqual({ typecheck: "gruen", lint: "rot", "check:size": "nicht-erreicht", test: "nicht-erreicht" });
    const z = gf.zaehle(l, ctx.gates);
    expect(zeile(z, "typecheck")).toMatchObject({ erreicht: 1, rot: 0, nichtErreicht: 0 });
    expect(zeile(z, "lint")).toMatchObject({ erreicht: 1, rot: 1, sessionsMitRot: 1 });
    expect(zeile(z, "check:size")).toMatchObject({ erreicht: 0, rot: 0, nichtErreicht: 1 });
    expect(zeile(z, "test")).toMatchObject({ erreicht: 0, nichtErreicht: 1 });
  });
  test("grüne Kette: alle erreicht und grün", () => {
    const l = laeufe([{ command: "npm run verify", text: ausgabe("verify", "typecheck", "lint", "check:size", "test") }]);
    expect(Object.values(erg(l[0]))).toEqual(["gruen", "gruen", "gruen", "gruen"]);
  });
  test("verify:full: die Zusatzschritte gehören dazu", () => {
    const l = laeufe([{ command: "npm run verify:full", fehler: true, text: `Exit code 1\n${ausgabe("verify:full", "verify", "typecheck", "lint", "check:size", "test", "test:coverage")}` }]);
    expect(erg(l[0])["test:coverage"]).toBe("rot");
    expect(erg(l[0]).test).toBe("gruen");
  });
  test.each([
    ["Fehler ohne Exit code (Timeout)", { fehler: true, text: ausgabe("typecheck", "lint") }],
    ["unterbrochen", { unterbrochen: true, text: ausgabe("typecheck", "lint") }],
    ["ohne Ergebnis", { ohneErgebnis: true }],
    ["im Hintergrund", { hintergrund: true, text: "gestartet" }],
  ])("abgebrochen zählt nicht: %s", (_n, extra) => {
    const l = laeufe([{ command: "npm run lint && npm test", ...extra }]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "abgebrochen" });
    const z = gf.zaehle(l, ctx.gates);
    expect(z.gates.every((g) => g.erreicht === 0 && g.rot === 0)).toBe(true);
    expect(z.nichtGezaehlt).toEqual({ abgebrochen: 1 });
  });
  test("Quote ist mit und ohne abgebrochenen Lauf gleich", () => {
    const ok = { command: "npm run lint", text: ausgabe("lint") };
    const mit = gf.zaehle(laeufe([ok, { command: "npm run lint", unterbrochen: true, text: ausgabe("lint") }]), ctx.gates);
    const ohne = gf.zaehle(laeufe([ok]), ctx.gates);
    expect(mit.gates).toEqual(ohne.gates);
  });
  test("fremde Skripte tauchen nicht auf, ein Rot dort macht kein Gate rot", () => {
    const a = laeufe([{ command: "npm run docs:gen && npm run verify", text: ausgabe("docs:gen", "verify", "typecheck", "lint", "check:size", "test") }]);
    expect(Object.keys(erg(a[0]))).not.toContain("docs:gen");
    expect(Object.values(erg(a[0])).every((e) => e === "gruen")).toBe(true);
    const b = laeufe([{ command: "npm run lint && npm run docs:gen", fehler: true, text: `Exit code 1\n${ausgabe("lint", "docs:gen")}` }]);
    expect(erg(b[0])).toEqual({ lint: "gruen" });
    const c = laeufe([{ command: "npm run lint", text: "> anderes@2.0.0 lint\n> eslint\n" }]);
    expect(c).toEqual([]);
  });
  test("verify:full rot im verify-Teil: test:coverage ist nicht erreicht", () => {
    const l = laeufe([{ command: "npm run verify:full", fehler: true, text: `Exit code 1\n${ausgabe("verify:full", "verify", "typecheck", "lint")}` }]);
    expect(erg(l[0])).toEqual({ typecheck: "gruen", lint: "rot", "check:size": "nicht-erreicht", test: "nicht-erreicht", "test:coverage": "nicht-erreicht" });
  });
  test("Quote mit Fremdskript gleich der ohne", () => {
    const mit = laeufe([{ command: "npm run docs:gen && npm run lint", text: ausgabe("docs:gen", "lint") }]);
    const ohne = laeufe([{ command: "npm run lint", text: ausgabe("lint") }]);
    expect(gf.zaehle(mit, ctx.gates).gates).toEqual(gf.zaehle(ohne, ctx.gates).gates);
  });
  test("tool_result-Inhalt als Block-Liste, CRLF und Farbcodes werden gelesen", () => {
    const esc = String.fromCharCode(27);
    const text = `> beispiel@1.0.0 lint\r\n${esc}[32m> beispiel@1.0.0 test${esc}[0m\r\n`;
    const l = laeufe([{ command: "npm run lint && npm test", text, array: true }]);
    expect(erg(l[0])).toEqual({ lint: "gruen", test: "gruen" });
  });
  test("Pipe und andere Befehlsformen zählen nicht", () => {
    const l = laeufe([
      { command: "npm run lint 2>&1 | tail -20", text: ausgabe("lint") },
      { command: "npm run lint; npm test", text: ausgabe("lint", "test") },
      { command: "git push", fehler: true, text: `Exit code 1\n${ausgabe("lint")}` },
    ]);
    expect(l.map((x) => [x.gezaehlt, x.grund])).toEqual([[false, "Pipe"], [false, "Befehlsform"], [false, "Befehlsform"]]);
  });
  test("das PowerShell-Tool zählt nur über die Summenzeile", () => {
    const l = laeufe([{ tool: "PowerShell", command: "npm run lint", text: ausgabe("lint") }]);
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "Befehlsform" });
  });
  test("ein Befehl ohne Gate-Bezug erzeugt keinen Lauf", () => {
    expect(laeufe([{ command: "git status", text: "sauber" }, { command: "npm run docs:gen", text: ausgabe("docs:gen") }])).toEqual([]);
  });
  test("Kettenkopf von verify:kompakt ohne Summenzeile ist unvollständig", () => {
    const l = laeufe([{ command: "npm run verify:kompakt", text: ausgabe("verify:kompakt") }]);
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "unvollständig" });
  });
  test("doppelte tool_use-IDs zählen einmal", () => {
    const a = { id: "dup", command: "npm run lint", text: ausgabe("lint") };
    expect(gf.laeufeAusTranskript([...zeilen([a]), ...zeilen([a])], { sessionId: "s", liesDatei: lies, ctx })).toHaveLength(1);
  });
});

describe("Summenzeile", () => {
  const gruen = "verify:kompakt grün · 4/4 · 12 s · typecheck ok 3 s, lint übersprungen 0 s (keine Dateien), check:size ok 4 s, test ok 5 s (related 2 + 0 per Name) · hinweis";
  const rot = "── lint: rot (Exit 1, 7 s) ──\nfehler\n\nverify:kompakt ROT · 3/4 grün · 14 s · rot: lint";
  test("grün mit übersprungen: übersprungen ist nicht erreicht", () => {
    const l = laeufe([{ command: "npm run verify:kompakt", text: `> beispiel@1.0.0 verify:kompakt\n${gruen}\n` }]);
    expect(erg(l[0])).toEqual({ typecheck: "gruen", lint: "nicht-erreicht", "check:size": "gruen", test: "gruen" });
    expect(l[0].gates[0].sek).toBe(3);
  });
  test("rot mit Dauer aus den Blöcken", () => {
    const l = laeufe([{ command: "npm run verify:kompakt", fehler: true, text: `Exit code 1\n${rot}\n` }]);
    expect(erg(l[0])).toEqual({ typecheck: "gruen", lint: "rot", "check:size": "gruen", test: "gruen" });
    expect(l[0].gates.find((g) => g.name === "lint")!.sek).toBe(7);
  });
  test("rot mit falscher Kettenlänge: Kette geändert", () => {
    const l = laeufe([{ command: "npm run verify:kompakt", fehler: true, text: "Exit code 1\nverify:kompakt ROT · 3/5 grün · 14 s · rot: lint\n" }]);
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "Kette geändert" });
  });
  test("unlesbare grüne Zeile und falsche Grün-Zahl: nicht zählbar", () => {
    expect(gf.bewerteSumme("verify:kompakt grün · 4/4 · 12 s · nichts", { verify: ctx.verify })).toEqual({ grund: "unvollständig" });
    expect(gf.bewerteSumme("verify:kompakt ROT · 2/4 grün · 1 s · rot: lint", { verify: ctx.verify })).toEqual({ grund: "Kette geändert" });
  });
  test("changed rot mit rotem lint: lint zählt rot", () => {
    const l = laeufe([{ command: "npm run verify:changed", fehler: true, text: "Exit code 1\nverify:changed ROT · 3/4 grün · 9 s · rot: lint\n" }]);
    expect(erg(l[0])).toEqual({ typecheck: "gruen", lint: "rot", "check:size": "gruen", test: "gruen" });
  });
  test("Kettenkopf von verify:changed ohne Summenzeile ist unvollständig", () => {
    expect(laeufe([{ command: "npm run verify:changed", text: ausgabe("verify:changed") }])[0]).toMatchObject({ gezaehlt: false, grund: "unvollständig" });
  });
  test("PowerShell zählt über die Summenzeile", () => {
    const l = laeufe([{ tool: "PowerShell", command: "npm run verify:kompakt", text: `${gruen}\n` }]);
    expect(l[0].gezaehlt).toBe(true);
  });
  test("PowerShell: ein rotes verify:kompakt ohne Exit-code-Präfix gilt als abgebrochen", () => {
    const l = laeufe([{ tool: "PowerShell", command: "npm run verify:kompakt", fehler: true, text: "verify:kompakt ROT · 3/4 grün · 9 s · rot: lint\n" }]);
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "abgebrochen" });
  });
  test("Round-Trip: das Format, das verify-lauf erzeugt, wird gelesen", () => {
    const e = [
      { name: "typecheck", ok: true, ms: 3000 },
      { name: "lint", ok: false, exit: 1, ms: 7000, ausgabe: "fehler" },
      { name: "check:size", ok: true, ms: 0 },
      { name: "test", ok: true, ms: 5000, info: "related 2 + 0 per Name" },
    ];
    const rotText = vl.bericht(e, { modus: "changed", hinweis: "Lint und Test voll (x)" });
    const r = gf.bewerteSumme(rotText, { verify: ctx.verify });
    expect(r?.gates?.map((g) => [g.name, g.ergebnis, g.sek])).toEqual([["typecheck", "gruen", null], ["lint", "rot", 7], ["check:size", "gruen", null], ["test", "gruen", null]]);
    const gruenText = vl.bericht(e.map((x) => ({ ...x, ok: true })), { modus: "kompakt", hinweis: "h" });
    expect(gf.bewerteSumme(gruenText, { verify: ctx.verify })?.gates?.map((g) => [g.name, g.sek])).toEqual([["typecheck", 3], ["lint", 7], ["check:size", 0], ["test", 5]]);
  });
  test("Dauer mit Komma oder Dezimalpunkt wird gelesen", () => {
    const r = gf.bewerteSumme("verify:kompakt grün · 2/2 · 12 s · lint ok 6,0 s, test ok 6.5 s", { verify: ["lint", "test"] });
    expect(r?.gates?.map((g) => [g.name, g.sek])).toEqual([["lint", 6], ["test", 6.5]]);
  });
  test("Text vor oder nach einem Teil macht die grüne Zeile unvollständig (beide Grenzen der Teil-Regel)", () => {
    expect(gf.bewerteSumme("verify:kompakt grün · 2/2 · 12 s · lint ok 6 s, test ok 6 s kaputt", { verify: ["lint", "test"] })).toEqual({ grund: "unvollständig" });
    expect(gf.bewerteSumme("verify:kompakt grün · 2/2 · 12 s · lint ok 6 s, ?test ok 6 s", { verify: ["lint", "test"] })).toEqual({ grund: "unvollständig" });
  });
  test("ein Schrittname mit Punkt am Ende ist kein Teil (factory#215), verify:kompakt als Name schon", () => {
    expect(gf.bewerteSumme("verify:kompakt grün · 1/1 · 1 s · lint. ok 6 s", { verify: ["lint"] })).toEqual({ grund: "unvollständig" });
    expect(gf.bewerteSumme("verify:kompakt grün · 1/1 · 1 s · verify:kompakt ok 6 s", { verify: ["verify:kompakt"] })?.gates?.map((g) => g.name)).toEqual(["verify:kompakt"]);
  });
  test("ein unparsbarer Teil macht die grüne Zeile unvollständig, nicht teilweise gezählt", () => {
    expect(gf.bewerteSumme("verify:kompakt grün · 2/2 · 12 s · lint ok 6 s, test ok schnell", { verify: ["lint", "test"] })).toEqual({ grund: "unvollständig" });
  });
  test("rote Dauer mit Komma wird gelesen", () => {
    const r = gf.bewerteSumme("── lint: rot (Exit 1, 7,5 s) ──\nx\nverify:kompakt ROT · 1/2 grün · 9 s · rot: lint", { verify: ["lint", "test"] });
    expect(r?.gates?.find((g) => g.name === "lint")?.sek).toBe(7.5);
  });
  test("rotes Gate außerhalb der Kette: Kette geändert", () => {
    expect(gf.bewerteSumme("verify:kompakt ROT · 3/4 grün · 1 s · rot: fremd", { verify: ctx.verify })).toEqual({ grund: "Kette geändert" });
  });
  test("changed rot: ein grünes lint ist nicht belegt", () => {
    const l = laeufe([{ command: "npm run verify:changed", fehler: true, text: "Exit code 1\nverify:changed ROT · 3/4 grün · 9 s · rot: test\n" }]);
    expect(erg(l[0])).toEqual({ typecheck: "gruen", "check:size": "gruen", test: "rot" });
  });
  test("gepipt als letzte Zeile gezählt, vor den Kopfzeilen", () => {
    const l = laeufe([{ command: "npm run verify:kompakt 2>&1 | tail -3", text: `${ausgabe("lint")}${gruen}\n` }]);
    expect(l[0].gezaehlt).toBe(true);
    expect(l[0].gates).toHaveLength(4);
  });
  test("Summenzeile nicht als letzte Zeile oder anderer Befehl: nicht gezählt", () => {
    expect(laeufe([{ command: "npm run verify:kompakt", text: `${gruen}\nnoch etwas\n` }])).toEqual([]);
    const l = laeufe([{ command: "cat log.txt", text: `${ausgabe("lint")}${gruen}\n` }]);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "Befehlsform" });
  });
});

describe("persistierte Ausgabe", () => {
  const marker = (pfad: string) => `<persisted-output>\nOutput too large (84.7KB). Full output saved to: ${pfad}\n\nPreview (first 2KB):\n> beispiel@1.0.0 verify\n`;
  const voll = ausgabe("verify", "typecheck", "lint", "check:size", "test");
  test("Datei im eigenen Session-Ordner wird gelesen", () => {
    const liesDatei = vi.fn(() => voll);
    const l = laeufe([{ command: "npm run verify", text: marker("C:\\x\\proj\\sess1\\tool-results\\abc.txt") }], { liesDatei });
    expect(liesDatei).toHaveBeenCalledTimes(1);
    expect(Object.values(erg(l[0]))).toEqual(["gruen", "gruen", "gruen", "gruen"]);
  });
  test("fehlende Datei: unvollständig", () => {
    const liesDatei = vi.fn(() => {
      throw new Error("ENOENT");
    });
    const l = laeufe([{ command: "npm run verify", text: marker("/x/proj/sess1/tool-results/abc.txt") }], { liesDatei });
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "unvollständig" });
  });
  test.each(["/etc/passwd", "/x/proj/andere/tool-results/abc.txt", "/x/proj/sess1/tool-results/../../geheim.txt"])("Pfad außerhalb wird nicht gelesen: %s", (pfad) => {
    const liesDatei = vi.fn(() => voll);
    const l = laeufe([{ command: "npm run verify", text: marker(pfad) }], { liesDatei });
    expect(liesDatei).not.toHaveBeenCalled();
    expect(l[0]).toMatchObject({ gezaehlt: false, grund: "unvollständig" });
  });
});

describe("Fenster", () => {
  const a = (ts: number) => ({ command: "npm run lint", text: ausgabe("lint"), ts, id: `i${ts}` });
  test("Läufe außerhalb von von/bis zählen nicht", () => {
    const l = laeufe([a(T0 - 1000), a(T0), a(T0 + 5000)], { von: T0, bis: T0 + 5000 });
    expect(l).toHaveLength(1);
  });
  test("ohne Fenster zählt alles", () => {
    expect(laeufe([a(T0 - 1000), a(T0)])).toHaveLength(2);
  });
});

describe("CI-Log", () => {
  const z = (job: string, schritt: string, sek: number, text: string) => `${job}\t${schritt}\t${sek === 0 ? "" : "\uFEFF"}2026-11-01T10:00:${String(sek).padStart(2, "0")}.1234567Z ${text}`;
  const lauf = (extra: string[] = [], schritt = "Verify") => [
    z("Tests", schritt, 0, "##[group]Run npm run verify"),
    z("Tests", schritt, 1, "> beispiel@1.0.0 verify"),
    z("Tests", schritt, 2, "> beispiel@1.0.0 typecheck"),
    z("Tests", schritt, 12, "> beispiel@1.0.0 lint"),
    ...extra,
  ];
  test("grüner Schritt mit Dauer aus den Zeitstempeln", () => {
    const text = [...lauf([z("Tests", "Verify", 20, "> beispiel@1.0.0 check:size"), z("Tests", "Verify", 25, "> beispiel@1.0.0 test"), z("Tests", "Verify", 40, "fertig")])].join("\n");
    const l = gf.laeufeAusCiLog(text, { id: "77", ctx });
    expect(l).toHaveLength(1);
    expect(erg(l[0])).toEqual({ typecheck: "gruen", lint: "gruen", "check:size": "gruen", test: "gruen" });
    expect(l[0].gates.map((g) => g.sek)).toEqual([10, 8, 5, 15]);
  });
  test("roter Schritt: letzte Kopfzeile rot, der Rest nicht erreicht", () => {
    const text = lauf([z("Tests", "Verify", 30, "##[error]Process completed with exit code 1.")]).join("\n");
    const l = gf.laeufeAusCiLog(text, { id: "78", ctx });
    expect(erg(l[0])).toEqual({ typecheck: "gruen", lint: "rot", "check:size": "nicht-erreicht", test: "nicht-erreicht" });
    expect(l[0].gates.find((g) => g.name === "lint")!.sek).toBe(18);
  });
  test("abgebrochener Schritt zählt nicht", () => {
    const text = lauf([z("Tests", "Verify", 30, "##[error]The operation was canceled.")]).join("\n");
    expect(gf.laeufeAusCiLog(text, { id: "79", ctx })[0]).toMatchObject({ gezaehlt: false, grund: "abgebrochen" });
  });
  test("Format --log-failed mit UNKNOWN STEP: Schrittgrenze über ##[group]Run", () => {
    const text = [
      z("Tests", "UNKNOWN STEP", 0, "##[group]Run npm run lint"),
      z("Tests", "UNKNOWN STEP", 1, "> beispiel@1.0.0 lint"),
      z("Tests", "UNKNOWN STEP", 5, "##[error]Process completed with exit code 1."),
      z("Tests", "UNKNOWN STEP", 6, "##[group]Run npm test"),
      z("Tests", "UNKNOWN STEP", 7, "> beispiel@1.0.0 test"),
      z("Tests", "UNKNOWN STEP", 9, "fertig"),
    ].join("\n");
    const l = gf.laeufeAusCiLog(text, { id: "80", ctx });
    expect(l.map(erg)).toEqual([{ lint: "rot" }, { test: "gruen" }]);
  });
  test("Zeilen ohne Tab-Format und Schritte ohne Kopfzeile erzeugen keinen Lauf", () => {
    expect(gf.laeufeAusCiLog("irgendein Kopf\n" + z("Tests", "Checkout", 0, "##[group]Run actions/checkout"), { id: "81", ctx })).toEqual([]);
  });
});

describe("zaehle", () => {
  test("Median nur aus vorhandenen Dauern, Sessions mit Rot je Lauf einmal", () => {
    const g = (ergebnis: string, sek: number | null): Gate => ({ name: "lint", ergebnis, sek });
    const l: Lauf[] = [
      { quelle: "ci", id: "1", gezaehlt: true, gates: [g("rot", 10)] },
      { quelle: "ci", id: "1", gezaehlt: true, gates: [g("rot", 20)] },
      { quelle: "transkript", id: "1", gezaehlt: true, gates: [g("gruen", null)] },
      { quelle: "ci", id: "2", gezaehlt: true, gates: [g("nicht-erreicht", null)] },
      { quelle: "ci", id: "3", gezaehlt: false, grund: "Pipe", gates: [] },
    ];
    const z = gf.zaehle(l, ["lint"]);
    expect(zeile(z, "lint")).toEqual({ name: "lint", erreicht: 3, rot: 2, nichtErreicht: 1, sessionsMitRot: 1, medianSek: 15 });
    expect(z).toMatchObject({ laeufe: 5, gezaehlt: 4, nichtGezaehlt: { Pipe: 1 } });
  });
});

describe("main", () => {
  const sessionMit = (a: Aufruf[]) => ({ id: "sess1", main: zeilen(a), subagents: [] });
  const basis = (extra: Record<string, unknown> = {}) => {
    const log = vi.fn<(t: string) => void>();
    const err = vi.fn<(t: string) => void>();
    return { log, err, deps: { pkg: pkg, findeSessions: () => [], ladeSession: () => sessionMit([]), gh: () => "[]", liesDatei: lies, log, err, jetzt: () => T0 + 86_400_000, ...extra } };
  };
  test("Aufruf-Fehler: unbekanntes Flag, falsches Datum", () => {
    expect(gf.main(["--unbekannt"], basis().deps)).toBe(2);
    expect(gf.main(["--von", "gestern"], basis().deps)).toBe(2);
    // factory#426 L3: nur ISO-Zeitpunkte, nicht alles, was Date.parse annimmt
    expect(gf.main(["--von", "2026"], basis().deps)).toBe(2);
    expect(gf.main(["--bis", "2026-02-30"], basis().deps)).toBe(2);
  });
  test("ohne Skript verify: Exit 2 mit Hinweis", () => {
    const b = basis({ pkg: { name: "x", scripts: {} } });
    expect(gf.main([], b.deps)).toBe(2);
    expect(b.err.mock.calls[0][0]).toMatch(/verify/);
  });
  test("gh run list scheitert: Exit 1", () => {
    const b = basis({
      gh: () => {
        throw new Error("kaputt");
      },
    });
    expect(gf.main(["--ci", "ci.yml"], b.deps)).toBe(1);
  });
  test("1000 Treffer: Hinweis Fenster enger wählen; abgebrochene Läufe laden kein Log", () => {
    const liste = Array.from({ length: 1000 }, (_, i) => ({ databaseId: i, conclusion: "cancelled", createdAt: new Date(T0).toISOString() }));
    const gh = vi.fn(() => JSON.stringify(liste));
    const b = basis({ gh });
    expect(gf.main(["--ci", "ci.yml", "--von", new Date(T0 - 1000).toISOString()], b.deps)).toBe(0);
    expect(b.log.mock.calls[0][0]).toMatch(/Fenster enger wählen/);
    expect(b.log.mock.calls[0][0]).toMatch(/abgebrochen 1000/);
    expect(gh).toHaveBeenCalledTimes(1);
  });
  test("Läufe nur in Subagent-Dateien zählen mit", () => {
    const a = { command: "npm run lint", text: ausgabe("lint"), ts: T0 };
    const b = basis({ findeSessions: () => [{ id: "sess1", main: [], subagents: [{ zeilen: zeilen([a]) }] }] });
    gf.main(["--json"], b.deps);
    expect(json(b.log.mock.calls[0][0]).quellen.transkript.gezaehlt).toBe(1);
  });
  test("grüner CI-Lauf lädt das volle Log, Fenster mit beiden Grenzen, unter 1000 Läufen kein Hinweis", () => {
    const logText = ["Tests\tVerify\t2026-11-01T10:00:00.0000000Z ##[group]Run x", "Tests\tVerify\t2026-11-01T10:00:01.0000000Z > beispiel@1.0.0 lint", "Tests\tVerify\t2026-11-01T10:00:09.0000000Z fertig"].join("\n");
    const bis = T0 + 86_400_000;
    const liste = [{ databaseId: 1, conclusion: "success", createdAt: new Date(T0).toISOString() }, { databaseId: 2, conclusion: "success", createdAt: new Date(bis).toISOString() }];
    const gh = vi.fn((args: string[]) => (args[1] === "list" ? JSON.stringify(liste) : logText));
    const b = basis({ gh });
    expect(gf.main(["--ci", "ci.yml", "--von", new Date(T0).toISOString(), "--bis", new Date(bis).toISOString(), "--json"], b.deps)).toBe(0);
    const liste1 = gh.mock.calls[0][0];
    expect(liste1[liste1.indexOf("--created") + 1]).toBe("2026-11-01T10:00:00Z..2026-11-02T10:00:00Z");
    const views = gh.mock.calls.filter((c) => c[0][1] === "view");
    expect(views).toHaveLength(1);
    expect(views[0][0]).toEqual(["run", "view", "1", "--log"]);
    expect(json(b.log.mock.calls[0][0]).quellen.ci.gates.find((x) => x.name === "lint")).toMatchObject({ erreicht: 1, rot: 0, medianSek: 8 });
    expect(b.log.mock.calls[0][0]).not.toMatch(/enger wählen/);
  });
  test("CI-Lauf im Fenster wird geladen, außerhalb nicht; --json trennt die Quellen", () => {
    const log = ["Tests\tVerify\t2026-11-01T10:00:00.0000000Z ##[group]Run x", "Tests\tVerify\t2026-11-01T10:00:01.0000000Z > beispiel@1.0.0 lint", "Tests\tVerify\t2026-11-01T10:00:09.0000000Z ##[error]Process completed with exit code 1."].join("\n");
    const gh = vi.fn((args: string[]) => (args[1] === "list" ? JSON.stringify([{ databaseId: 5, conclusion: "failure", createdAt: new Date(T0).toISOString() }, { databaseId: 6, conclusion: "failure", createdAt: new Date(T0 - 9 * 86_400_000).toISOString() }]) : log));
    const b = basis({ gh });
    expect(gf.main(["--ci", "ci.yml", "--json"], b.deps)).toBe(0);
    const daten = json(b.log.mock.calls[0][0]);
    expect(daten.quellen.ci.gates.find((x) => x.name === "lint")).toMatchObject({ erreicht: 1, rot: 1 });
    expect(daten.quellen.transkript.gezaehlt).toBe(0);
    expect(gh.mock.calls.filter((c) => c[0][1] === "view")).toHaveLength(1);
  });
  test("--transkript liest die Datei ohne Fenster, --ci-log zählt unlesbare Logs im Fuß", () => {
    const a = { command: "npm run lint", text: ausgabe("lint"), ts: T0 - 30 * 86_400_000 };
    const ladeSession = vi.fn(() => sessionMit([a]));
    const liesDatei = vi.fn(() => {
      throw new Error("weg");
    });
    const b = basis({ ladeSession, liesDatei });
    expect(gf.main(["--transkript", "x.jsonl", "--ci-log", "log.txt"], b.deps)).toBe(0);
    expect(ladeSession).toHaveBeenCalledWith("x.jsonl");
    const text = b.log.mock.calls[0][0];
    expect(text).toMatch(/lint\s+erreicht\s+1 /);
    expect(text).toMatch(/CI-Log nicht lesbar 1/);
  });
  test("Standardfenster: sieben Tage vor jetzt", () => {
    const alt = { command: "npm run lint", text: ausgabe("lint"), ts: T0 + 86_400_000 - 8 * 86_400_000 };
    const neu = { command: "npm run lint", text: ausgabe("lint"), ts: T0 + 86_400_000 - 1000, id: "n" };
    const b = basis({ findeSessions: () => [sessionMit([alt, neu])] });
    gf.main(["--json"], b.deps);
    expect(json(b.log.mock.calls[0][0]).quellen.transkript.gezaehlt).toBe(1);
  });
});
