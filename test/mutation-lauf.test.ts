/* Mutationslauf (factory#299): Diff zu Zeilenbereichen, Bericht-Parser fail-closed, Ausgabe und Ablauf. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/mutation-lauf.mjs";

interface Bereich { datei: string; von: number; bis: number }
interface Mutant { datei: string; zeile: number; mutator: string; ersatz?: string; status: string }
interface Lauf { status?: number | null; error?: Error }
interface Io {
  lade: () => unknown; git: (a: string[]) => string; spawn: (...a: unknown[]) => Lauf; lies: (p: string) => string; schreibe: (p: string, t: string) => void;
  tempOrdner: () => string; entferne: (p: string) => void; env: Record<string, string>; wurzel: string; out: (t: string) => void; err: (t: string) => void;
}
const lib = raw as unknown as {
  istTestPfad(p: string): boolean;
  bereicheAusDiff(diff: string, quellen: unknown): Bereich[];
  berichtLesen(text: string, wurzel: string): { mutanten?: Mutant[]; fehler?: string };
  aufBereicheFiltern(m: Mutant[], b: Bereich[]): { mutanten: Mutant[]; verworfen: number };
  formatiere(m: Mutant[], verworfen?: number): string[];
  cli(argv: string[], io: Io): number;
};

const QUELLEN = { wurzeln: ["src"], endungen: [".mjs", ".ts"], ohne: [] };
const WURZEL = "/w";
const hunk = (datei: string, kopf: string) => `diff --git a/${datei} b/${datei}\n--- a/${datei}\n+++ b/${datei}\n${kopf}\n+x\n`;

describe("Diff zu Zeilenbereichen", () => {
  test("zusammenhängende Zeilen werden ein Bereich, getrennte bleiben getrennt (bis inklusiv)", () => {
    const d = `${hunk("src/a.mjs", "@@ -1,0 +3,2 @@")}@@ -9 +10,0 @@\n@@ -20 +21,3 @@\n+y\n@@ -30 +30 @@\n+z\n`;
    assert.deepEqual(lib.bereicheAusDiff(d, QUELLEN), [
      { datei: "src/a.mjs", von: 3, bis: 4 },
      { datei: "src/a.mjs", von: 21, bis: 23 },
      { datei: "src/a.mjs", von: 30, bis: 30 },
    ]);
  });
  test("Dateien und Zeilen kommen sortiert heraus, auch wenn der Diff sie umgekehrt liefert (numerisch, nicht textuell)", () => {
    const d = `${hunk("src/b.mjs", "@@ -1 +9 @@")}@@ -1 +100 @@\n+y\n${hunk("src/a.mjs", "@@ -1 +2 @@")}`;
    assert.deepEqual(lib.bereicheAusDiff(d, QUELLEN), [
      { datei: "src/a.mjs", von: 2, bis: 2 },
      { datei: "src/b.mjs", von: 9, bis: 9 },
      { datei: "src/b.mjs", von: 100, bis: 100 },
    ]);
    const rueck = `${hunk("src/a.mjs", "@@ -1 +11 @@")}@@ -1 +3 @@\n+y\n@@ -1 +10 @@\n+z\n`;
    assert.deepEqual(lib.bereicheAusDiff(rueck, QUELLEN), [{ datei: "src/a.mjs", von: 3, bis: 3 }, { datei: "src/a.mjs", von: 10, bis: 11 }]);
  });
  test("istTestPfad: der Punkt vor test/spec und das Dateiende sind Teil des Musters", () => {
    assert.equal(lib.istTestPfad("src/atest.mjs"), false);
    assert.equal(lib.istTestPfad("src/a.test.mjs.bak"), true);
    assert.equal(lib.istTestPfad("src/a.test"), false);
  });
  test("Zeilen direkt hintereinander aus zwei Hunks verschmelzen zu einem Bereich", () => {
    const d = `${hunk("src/a.mjs", "@@ -1,0 +3,2 @@")}@@ -9 +5,2 @@\n+y\n`;
    assert.deepEqual(lib.bereicheAusDiff(d, QUELLEN), [{ datei: "src/a.mjs", von: 3, bis: 6 }]);
  });
  test("Umbenennung mit Hunk zählt unter dem neuen Namen, ohne Hunk gar nicht", () => {
    const mit = "diff --git a/src/alt.mjs b/src/neu.mjs\nsimilarity index 90%\nrename from src/alt.mjs\nrename to src/neu.mjs\n--- a/src/alt.mjs\n+++ b/src/neu.mjs\n@@ -2 +2 @@\n+x\n";
    assert.deepEqual(lib.bereicheAusDiff(mit, QUELLEN), [{ datei: "src/neu.mjs", von: 2, bis: 2 }]);
    const ohne = "diff --git a/src/alt.mjs b/src/neu.mjs\nsimilarity index 100%\nrename from src/alt.mjs\nrename to src/neu.mjs\n";
    assert.deepEqual(lib.bereicheAusDiff(ohne, QUELLEN), []);
  });
  test("gelöschte Datei und reine Löschung tragen nichts bei", () => {
    const geloescht = "diff --git a/src/weg.mjs b/src/weg.mjs\ndeleted file mode 100644\n--- a/src/weg.mjs\n+++ /dev/null\n@@ -1,3 +0,0 @@\n-a\n";
    assert.deepEqual(lib.bereicheAusDiff(geloescht, QUELLEN), []);
    assert.deepEqual(lib.bereicheAusDiff(hunk("src/a.mjs", "@@ -4,2 +3,0 @@"), QUELLEN), []);
  });
  test("Tests, test/support, Nicht-Code und Dateien außerhalb der Wurzeln sind ausgeschlossen", () => {
    const quellen = { wurzeln: ["src", "test"], endungen: [".mjs", ".ts"], ohne: [] };
    const d = ["src/a.test.mjs", "src/b.spec.ts", "src/tests/c.mjs", "src/__tests__/d.mjs", "test/support/x.mjs", "src/README.md", "docs/x.mjs", "src/ok.mjs"].map((f) => hunk(f, "@@ -1 +1 @@")).join("");
    assert.deepEqual(lib.bereicheAusDiff(d, quellen), [{ datei: "src/ok.mjs", von: 1, bis: 1 }]);
  });
  test("reiner Markdown-Diff ergibt keine Bereiche", () => {
    assert.deepEqual(lib.bereicheAusDiff(hunk("docs/a.md", "@@ -1 +1 @@"), QUELLEN), []);
  });
  test("istTestPfad: Segment und Dateimuster, aber nicht der Dateiname test.mjs allein", () => {
    for (const p of ["test/a.mjs", "a/tests/b.mjs", "a/__tests__/b.mjs", "a/b.test.mjs", "a/b.spec.ts", "test/support/x.ts"]) assert.equal(lib.istTestPfad(p), true, p);
    for (const p of ["src/test.mjs", "src/attest/a.mjs", "src/b.mjs", "src/contest.ts"]) assert.equal(lib.istTestPfad(p), false, p);
  });
});

const m = (extra: Record<string, unknown> = {}) => ({ id: "1", mutatorName: "ConditionalExpression", replacement: "true", status: "Survived", location: { start: { line: 5, column: 1 }, end: { line: 5, column: 9 } }, ...extra });
const bericht = (files: unknown) => JSON.stringify({ schemaVersion: "2", files });

describe("Bericht-Parser fail-closed", () => {
  test("kaputtes JSON, fehlendes files, kein Array, unbekannter Status, fehlende Zeile sind Fehler", () => {
    for (const t of ["", "{", "[]", "null", "{}", JSON.stringify({ files: [] }), bericht({ "src/a.mjs": {} }), bericht({ "src/a.mjs": { mutants: {} } }),
      bericht({ "src/a.mjs": { mutants: [m({ status: "Wat" })] } }), bericht({ "src/a.mjs": { mutants: [m({ status: undefined })] } }), bericht({ "src/a.mjs": { mutants: [m({ location: {} })] } })]) {
      const r = lib.berichtLesen(t, WURZEL);
      assert.equal(typeof r.fehler, "string", t);
      assert.equal(r.mutanten, undefined, t);
    }
  });
  test("ein leerer Bericht ohne Dateien ist gültig und ergibt null Mutanten", () => {
    assert.deepEqual(lib.berichtLesen(bericht({}), WURZEL), { mutanten: [] });
  });
  test("Schlüssel werden normalisiert: absolut, Windows-Trenner, ./-Präfix", () => {
    const files = { "/w/src/a.mjs": { mutants: [m()] }, "src\\b.mjs": { mutants: [m()] }, "./src/c.mjs": { mutants: [m()] }, "/w/src/d.mjs": { mutants: [m()] } };
    const r = lib.berichtLesen(bericht(files), "/w");
    assert.deepEqual(r.mutanten?.map((x) => x.datei), ["src/a.mjs", "src/b.mjs", "src/c.mjs", "src/d.mjs"]);
    assert.deepEqual(lib.berichtLesen(bericht({ "C:\\w\\src\\a.mjs": { mutants: [m()] } }), "C:\\w").mutanten?.map((x) => x.datei), ["src/a.mjs"]);
  });
  test("alle bekannten Status werden akzeptiert", () => {
    const s = ["Killed", "Survived", "NoCoverage", "Timeout", "CompileError", "RuntimeError", "Ignored", "Pending"];
    const r = lib.berichtLesen(bericht({ "src/a.mjs": { mutants: s.map((status) => m({ status })) } }), WURZEL);
    assert.equal(r.mutanten?.length, s.length);
  });
});

const mu = (extra: Partial<Mutant> = {}): Mutant => ({ datei: "src/a.mjs", zeile: 5, mutator: "ConditionalExpression", ersatz: "true", status: "Survived", ...extra });

describe("Filter und Ausgabe", () => {
  test("Mutanten außerhalb der Bereiche (Zeile, Datei, Rand inklusiv) werden verworfen und gezählt", () => {
    const b = [{ datei: "src/a.mjs", von: 5, bis: 7 }];
    const r = lib.aufBereicheFiltern([mu({ zeile: 4 }), mu({ zeile: 5 }), mu({ zeile: 7 }), mu({ zeile: 8 }), mu({ datei: "src/b.mjs", zeile: 6 })], b);
    assert.deepEqual(r.mutanten.map((x) => x.zeile), [5, 7]);
    assert.equal(r.verworfen, 3);
  });
  test("mehrere Bereiche: ein Treffer in irgendeinem genügt, Datei und Zeile müssen im selben Bereich liegen", () => {
    const b = [{ datei: "src/a.mjs", von: 1, bis: 2 }, { datei: "src/b.mjs", von: 10, bis: 12 }];
    const r = lib.aufBereicheFiltern([mu({ zeile: 2 }), mu({ datei: "src/b.mjs", zeile: 11 }), mu({ datei: "src/a.mjs", zeile: 11 }), mu({ datei: "src/b.mjs", zeile: 2 })], b);
    assert.deepEqual(r.mutanten.map((x) => `${x.datei}:${x.zeile}`), ["src/a.mjs:2", "src/b.mjs:11"]);
  });
  test("Zeilenformat, Abschnitte, Sortierung und Summenzeile", () => {
    const z = lib.formatiere([
      mu({ datei: "src/b.mjs", zeile: 2 }), mu({ zeile: 9, mutator: "StringLiteral", ersatz: '""' }), mu({ zeile: 3, status: "NoCoverage" }),
      mu({ status: "Killed" }), mu({ status: "Killed" }), mu({ status: "Timeout" }), mu({ status: "CompileError" }),
    ]);
    assert.deepEqual(z, [
      "überlebt (2):", "src/a.mjs:9 | StringLiteral | \"\"", "src/b.mjs:2 | ConditionalExpression | true",
      "ohne Abdeckung (1):", "src/a.mjs:3 | ConditionalExpression | true",
      "Mutanten: 7 · getötet 2 · überlebt 2 · ohne Abdeckung 1 · Timeout 1 · sonstige 1",
    ]);
  });
  test("Maskierung von |, Zeilenumbruch und Leerraum, fehlender Ersatz, Kürzung auf 80 Zeichen, Verworfen-Zusatz", () => {
    const lang = "x".repeat(200);
    const z = lib.formatiere([mu({ ersatz: "a | b\n  c" }), mu({ zeile: 6, ersatz: undefined }), mu({ zeile: 7, ersatz: lang })], 4);
    assert.equal(z[1], "src/a.mjs:5 | ConditionalExpression | a \\| b c");
    assert.equal(z[2], "src/a.mjs:6 | ConditionalExpression | –");
    assert.equal(z[3], `src/a.mjs:7 | ConditionalExpression | ${"x".repeat(79)}…`);
    assert.equal(z[4], "Mutanten: 3 · getötet 0 · überlebt 3 · ohne Abdeckung 0 · Timeout 0 · sonstige 0 · außerhalb der Bereiche verworfen 4");
  });
  test("Kürzung: genau 80 Zeichen bleiben ganz, 81 werden auf 79 plus Auslassung gekürzt; gleiche Datei sortiert numerisch", () => {
    const z = lib.formatiere([mu({ zeile: 10, ersatz: "y".repeat(80) }), mu({ zeile: 9, ersatz: "y".repeat(81) }), mu({ zeile: 100 })]);
    assert.equal(z[1], `src/a.mjs:9 | ConditionalExpression | ${"y".repeat(79)}…`);
    assert.equal(z[2], `src/a.mjs:10 | ConditionalExpression | ${"y".repeat(80)}`);
    assert.equal(z[3], "src/a.mjs:100 | ConditionalExpression | true");
  });
  test("ohne Überlebende gibt es nur die Summenzeile", () => {
    assert.deepEqual(lib.formatiere([mu({ status: "Killed" })]), ["Mutanten: 1 · getötet 1 · überlebt 0 · ohne Abdeckung 0 · Timeout 0 · sonstige 0"]);
  });
});

const DIFF = hunk("src/a.mjs", "@@ -4 +5,3 @@");
const KONFIG = { struktur: { quelle: "src", endungen: [".mjs"] }, befehle: { mutation: "werkzeug" } };

/** Fake-Umgebung: protokolliert Aufrufe; `bericht` ist der Text, den das „Werkzeug“ (der Spawn) hinterlässt (null = nichts schreiben). */
const umgebung = (o: { config?: unknown; diff?: string; basis?: string | null; lauf?: Lauf; bericht?: string | null; alt?: string } = {}) => {
  const log = { git: [] as string[][], spawn: [] as unknown[][], out: [] as string[], err: [] as string[], entfernt: [] as string[], dateien: new Map<string, string>() };
  const io: Io = {
    lade: () => o.config ?? KONFIG,
    git: (a) => {
      log.git.push(a);
      if (a[0] === "diff") return o.diff ?? DIFF;
      if (o.basis === null) throw new Error("keine Basis");
      return `${o.basis ?? "abc123"}\n`;
    },
    spawn: (...a) => {
      log.spawn.push(a);
      const env = (a[2] as { env: Record<string, string> }).env;
      if (o.bericht !== null && o.bericht !== undefined) log.dateien.set(env.FACTORY_MUTATION_BERICHT, o.bericht);
      return o.lauf ?? { status: 0 };
    },
    lies: (p) => {
      const t = log.dateien.get(p);
      if (t === undefined) throw new Error(`ENOENT ${p}`);
      return t;
    },
    schreibe: (p, t) => { log.dateien.set(p, t); },
    tempOrdner: () => { log.dateien.set("/alt/bericht.json", o.alt ?? ""); return "/tmp/m1"; },
    entferne: (p) => { log.entfernt.push(p); },
    env: { PATH: "x" },
    wurzel: WURZEL,
    out: (t) => log.out.push(t),
    err: (t) => log.err.push(t),
  };
  return { io, log };
};
const gutBericht = bericht({ "/w/src/a.mjs": { mutants: [m({ location: { start: { line: 5 } } }), m({ status: "Killed", location: { start: { line: 6 } } }), m({ location: { start: { line: 99 } } })] } });

describe("Ablauf", () => {
  test("nicht eingerichtet: Exit 0, Meldung, git und Spawn nie aufgerufen", () => {
    const { io, log } = umgebung({ config: { struktur: { quelle: "src" } } });
    assert.equal(lib.cli([], io), 0);
    assert.deepEqual(log.out, ["mutation: nicht eingerichtet"]);
    assert.equal(log.git.length, 0);
    assert.equal(log.spawn.length, 0);
  });
  test("keine Basis: Exit 1 mit Fix, kein Spawn", () => {
    const { io, log } = umgebung({ basis: null });
    assert.equal(lib.cli([], io), 1);
    assert.match(log.err.join("\n"), /Fix: FACTORY_DIFF_BASE/);
    assert.equal(log.spawn.length, 0);
  });
  test("reiner Markdown-Diff: „keine Code-Zeilen“, Exit 0, kein Spawn", () => {
    const { io, log } = umgebung({ diff: hunk("docs/a.md", "@@ -1 +1 @@") });
    assert.equal(lib.cli([], io), 0);
    assert.deepEqual(log.out, ["mutation: keine Code-Zeilen"]);
    assert.equal(log.spawn.length, 0);
  });
  test("unbekanntes Argument: Exit 2", () => {
    const { io, log } = umgebung();
    assert.equal(lib.cli(["--x"], io), 2);
    assert.match(log.err.join("\n"), /Fix:/);
  });
  test("Werkzeug-Exit ≠ 0, Signal und Startfehler enden mit Exit 1 ohne Summenzeile", () => {
    for (const lauf of [{ status: 3 }, { status: null }, { error: new Error("boom") }]) {
      const { io, log } = umgebung({ lauf, bericht: gutBericht });
      assert.equal(lib.cli([], io), 1, JSON.stringify(lauf));
      assert.ok(!log.out.some((z) => z.startsWith("Mutanten:")));
      assert.deepEqual(log.entfernt, ["/tmp/m1"]);
    }
  });
  test("fehlender, kaputter oder unvollständiger Bericht: Exit 1, nie die Summenzeile „keine Mutanten“", () => {
    for (const b of [null, "{", "{}", bericht({ "/w/src/a.mjs": { mutants: [m({ status: "Wat" })] } })]) {
      const { io, log } = umgebung({ bericht: b });
      assert.equal(lib.cli([], io), 1, String(b));
      assert.equal(log.out.length, 0, String(b));
      assert.match(log.err.join("\n"), /Fix:/);
    }
  });
  test("ein vorhandener alter Bericht wird nie gelesen: der Berichtspfad liegt im frischen Ordner", () => {
    const { io, log } = umgebung({ bericht: null, alt: gutBericht });
    assert.equal(lib.cli([], io), 1);
    const env = (log.spawn[0][2] as { env: Record<string, string> }).env;
    assert.equal(env.FACTORY_MUTATION_BERICHT, "/tmp/m1/bericht.json");
    assert.equal(log.out.length, 0);
  });
  test("Erfolg: Bereiche-JSON im Vertragsschema, Umgebung, Zeilen, Summenzeile, Exit 0, Ordner entfernt", () => {
    const { io, log } = umgebung({ bericht: gutBericht });
    assert.equal(lib.cli([], io), 0);
    const [exe, args, opt] = log.spawn[0] as [string, string[], { cwd: string; env: Record<string, string>; stdio: unknown[] }];
    assert.equal(exe, process.execPath);
    assert.deepEqual(args, ["/w/scripts/gate-befehl.mjs", "mutation"]);
    assert.equal(opt.cwd, "/w");
    assert.equal(opt.env.PATH, "x");
    assert.deepEqual(opt.stdio, ["ignore", 2, 2]);
    assert.deepEqual(JSON.parse(log.dateien.get(opt.env.FACTORY_MUTATION_BEREICHE) ?? ""), { version: 1, bereiche: [{ datei: "src/a.mjs", von: 5, bis: 7 }] });
    assert.deepEqual(log.out, ["überlebt (1):", "src/a.mjs:5 | ConditionalExpression | true", "Mutanten: 2 · getötet 1 · überlebt 1 · ohne Abdeckung 0 · Timeout 0 · sonstige 0 · außerhalb der Bereiche verworfen 1"]);
    assert.deepEqual(log.entfernt, ["/tmp/m1"]);
    assert.deepEqual(log.git[1], ["diff", "-U0", "-M", "--no-color", "--no-ext-diff", "abc123...HEAD"]);
  });
  test("Smoke im echten Repo: eine Fremd-Config ohne befehle.mutation ist nicht eingerichtet (Exit 0)", () => {
    const wurzel = fileURLToPath(new URL("../", import.meta.url));
    const env = { ...process.env, VITEST: "1", FACTORY_PROJEKT_WURZEL: wurzel, FACTORY_PROJEKT_CONFIG: "test/fixtures/projekt-fremd.json" };
    const r = spawnSync(process.execPath, ["scripts/mutation-lauf.mjs"], { cwd: wurzel, encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), "mutation: nicht eingerichtet");
  });
});
