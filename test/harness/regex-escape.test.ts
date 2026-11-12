/* Regex-Escape-Wächter (factory#347 L37): CodeQL meldet `js/incomplete-sanitization` für ein Escape, das nur den ersten Treffer oder
 * den Backslash nicht maskiert. Dieser Scan ist der lokale Vorabcheck, damit die Meldung nicht erst auf dem PR auftaucht.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Geschlossene Musterliste über alle getrackten `*.js|mjs|cjs|ts` (ohne node_modules, dist, .claude/worktrees):
 *  - M1 „Escape ohne Backslash“: ein einzeiliger Aufruf mit Regex-Literal MIT `g`, dessen Ersatz-Literal mit einem Escape-Backslash beginnt,
 *    ohne dass dieselbe Zeile den Backslash selbst maskiert (ein Regex-Literal mit `\\` in der Quelle).
 *  - M2 „nur erster Treffer“: ein einzeiliger Aufruf mit Text-Literal oder Regex-Literal OHNE `g` (nicht an `^` verankert),
 *    dessen Ersatz-Literal mit einem Escape-Backslash beginnt.
 * Behebung: `escapeRe` aus `test/support/regex.ts` (oder `escapeRegex` aus `scripts/regex-lib.mjs`).
 *
 * Grenze: nur einzeilige Aufrufe mit Literal-Argumenten. Nicht gesehen: Ersatzfunktionen, Variablen als Argument, der `RegExp`-Konstruktor,
 * mehrzeilige Aufrufe. Kein Ersatz für CodeQL, nur ein Vorabcheck. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
import { escapeRe } from "../support/regex";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const BS = String.fromCharCode(92);
const BS2 = BS + BS;

/** `.replace(<Literal>, <Literal mit führendem Escape-Backslash>`; Gruppen: Regex-Quelle, Flags, Text-Literal (doppelt/einfach). */
const AUFRUF = new RegExp(
  [
    "\\.replace\\(\\s*(?:",
    "\\/((?:\\\\.|\\[(?:\\\\.|[^\\]\\\\\\n])*\\]|[^/\\\\\\n\\[])+)\\/([a-z]*)",
    "|\"((?:\\\\.|[^\"\\\\\\n])*)\"",
    "|'((?:\\\\.|[^'\\\\\\n])*)'",
    // Ersatz: Anführungszeichen, Escape-Backslash, danach weder Ende noch weiterer Backslash (ein reiner Pfadtrenner-Tausch ist kein Escape)
    ")\\s*,\\s*([\"'`])\\\\\\\\(?![\"'`\\\\])",
  ].join(""),
  "g",
);
/** Das Regex-Literal-Argument eines `.replace(`-Aufrufs (Gruppe 1 = Quelle); dieselbe Teilgrammatik wie in AUFRUF, damit `\/` und Klassen stimmen. */
const REGEX_ARG = new RegExp("\\.replace\\(\\s*\\/((?:\\\\.|\\[(?:\\\\.|[^\\]\\\\\\n])*\\]|[^/\\\\\\n\\[])+)\\/[a-z]*", "g");
/** Maskiert irgendein `.replace(`-Regex-Literal der Zeile den Backslash selbst? Die Quelle wird in Escape-Paare zerlegt, ein Paar aus zwei Backslashes zählt. */
const maskiertBackslash = (zeile: string): boolean => [...zeile.matchAll(REGEX_ARG)].some((m) => (m[1].match(/\\.|[^\\]/g) ?? ([] as string[])).includes(BS2));

/** Die Befunde einer Zeile (leer = sauber). Pur. */
export function befunde(zeile: string): string[] {
  const out: string[] = [];
  for (const m of zeile.matchAll(AUFRUF)) {
    const [, quelle, flags] = m;
    const istRegex = quelle !== undefined;
    if (istRegex && flags.includes("g")) {
      if (!maskiertBackslash(zeile)) out.push("M1 Escape ohne Backslash");
    } else if (!istRegex || !quelle.startsWith("^")) {
      out.push("M2 nur erster Treffer");
    }
  }
  return out;
}

const dateien = (): string[] =>
  execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.js", "*.mjs", "*.cjs", "*.ts"], { cwd: WURZEL, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })
    .split("\n")
    .filter((p) => p && !/^(node_modules|dist|\.claude\/worktrees)\//.test(p));

/** Ein Aufruf für den Negativ- und Positiv-Test; Fixtures entstehen zur Laufzeit, damit der Scan sie nicht selbst findet. */
const aufruf = (arg: string, ersatz: string): string => ["s.replace(", arg, ', "', ersatz, '")'].join("");

describe("Regex-Escape: Muster erkennen (Red-Green-Fixtures)", () => {
  test("M1: globaler Escape ohne Backslash ist ein Befund", () => {
    assert.deepEqual(befunde(aufruf("/" + BS + "$/g", BS2 + "$")), ["M1 Escape ohne Backslash"]);
    assert.deepEqual(befunde(aufruf("/[.*]/g", BS2 + "$&")), ["M1 Escape ohne Backslash"]);
  });
  test("M2: Text-Literal und Regex ohne g als Escape ist ein Befund", () => {
    assert.deepEqual(befunde(aufruf('"."', BS2 + ".")), ["M2 nur erster Treffer"]);
    assert.deepEqual(befunde(aufruf("'.'", BS2 + ".")), ["M2 nur erster Treffer"]);
    assert.deepEqual(befunde(aufruf("/[.*]/", BS2 + "$&")), ["M2 nur erster Treffer"]);
  });
  test("Randformen: Template- und Einfach-Literal als Ersatz, Escape in Klasse und Text-Literal, Leerraum", () => {
    assert.deepEqual(befunde("s.replace(/" + BS + "." + "/g, `" + BS2 + ".`)"), ["M1 Escape ohne Backslash"]);
    assert.deepEqual(befunde("s.replace(\".\", " + "\x27" + BS2 + ".\x27)"), ["M2 nur erster Treffer"]);
    assert.deepEqual(befunde(aufruf("/[" + BS + ".*]/g", BS2 + "$&")), ["M1 Escape ohne Backslash"]);
    assert.deepEqual(befunde(aufruf("\"" + BS + "t\"", BS2 + "t")), ["M2 nur erster Treffer"]);
    assert.deepEqual(befunde("s.replace( /[.*]/g , \"" + BS2 + "$&\")"), ["M1 Escape ohne Backslash"]);
    assert.deepEqual(befunde("s.replace('" + BS + "t', '" + BS2 + "t')"), ["M2 nur erster Treffer"]);
    // Pfadtrenner-Tausch mit Einfach- und Template-Literal ist ebenfalls kein Escape
    assert.deepEqual(befunde("s.replace(/" + BS + "//g, '" + BS2 + "')"), []);
    assert.deepEqual(befunde("s.replace(/" + BS + "//g, `" + BS2 + "`)"), []);
    // mehrere Flags
    assert.deepEqual(befunde(aufruf("/[.*]/gi", BS2 + "$&")), ["M1 Escape ohne Backslash"]);
    // verdoppelter Backslash im Ersatz (maskiert den Backslash selbst) ist kein Escape
    assert.deepEqual(befunde(aufruf("/" + BS + "//", BS2 + BS2)), []);
  });
  test("sauber: volle Klasse mit Backslash, Folge von Escapes, Ersatz ohne Escape, Ersatzfunktion, Verankerung", () => {
    assert.deepEqual(befunde(aufruf("/[.*+?^${}()|[]" + BS2 + "]/g", BS2 + "$&")), []);
    assert.deepEqual(befunde("t.replace(/" + BS2 + "/g, " + '"' + BS2 + BS2 + '")' + ".replace(/" + BS + '|/g, "' + BS2 + '|")'), []);
    assert.deepEqual(befunde(aufruf("/(a)/g", "$1")), []);
    assert.deepEqual(befunde("s.replace(/[.*]/g, (m) => m)"), []);
    assert.deepEqual(befunde(aufruf("/^" + BS + "//", BS2 + "/")), []);
    // klassische escapeRegExp-Formen mit maskiertem Schrägstrich sind sauber (Escape-Paare, nicht Teilstrings)
    assert.deepEqual(befunde("s.replace(/[-" + BS + "/" + BS2 + "^$*+?.()|[" + BS + "]{}]/g, '" + BS2 + "$&')"), []);
    assert.deepEqual(befunde("s.replace(/[.*+?^${}()|[" + BS + "]" + BS2 + BS + "/]/g, '" + BS2 + "$&')"), []);
    // ein `.split` mit maskiertem Backslash auf derselben Zeile entlastet das `.replace` nicht
    assert.deepEqual(befunde("const p = x.split(/" + BS2 + "/, 2), e = s.replace(/[.*]/g, \"" + BS2 + "$&\");"), ["M1 Escape ohne Backslash"]);
    // MASKIERT_BACKSLASH: Leerraum nach der Klammer und vor dem Komma, mehrere Flags (Fehlalarm-Schutz)
    assert.deepEqual(befunde("s.replace( /[.*]" + BS2 + "/g, \"" + BS2 + "$&\")"), []);
    assert.deepEqual(befunde("s.replace(/[.*]" + BS2 + "/g , \"" + BS2 + "$&\")"), []);
    assert.deepEqual(befunde(aufruf("/[.*+?^${}()|[]" + BS2 + "]/gi", BS2 + "$&")), []);
    // Pfadtrenner-Tausch (Ersatz ist nur der Backslash selbst) ist kein Escape
    assert.deepEqual(befunde(aufruf("/" + BS + "//g", BS2)), []);
  });
  test("escapeRe maskiert Punkt und Backslash überall (der Fix für beide Fundstellen)", () => {
    assert.equal(escapeRe("a.b.c"), "a" + BS + ".b" + BS + ".c");
    assert.equal(escapeRe(BS), BS2);
    assert.ok(new RegExp(escapeRe("docs/model-routing.md")).test("docs/model-routing.md"));
    assert.ok(!new RegExp(escapeRe("a.b")).test("axb"));
  });
});

describe("Regex-Escape: Scan über alle getrackten Quellen", () => {
  test("Leerlauf-Schutz: der Scan sieht Skripte, Tests und die bekannte Escape-Fundstelle", () => {
    const d = dateien();
    assert.ok(d.length > 300, `nur ${d.length} Dateien`);
    assert.ok(d.includes("scripts/pfad-glob.mjs"));
    assert.ok(d.includes("test/harness/regex-escape.test.ts"));
    assert.ok(/replace\(\/\[.+\\\\\]\/g/.test(readFileSync(WURZEL + "scripts/pfad-glob.mjs", "utf8")), "Referenz-Escape in pfad-glob.mjs nicht mehr gefunden");
  });
  test("kein einzeiliger Escape ohne Backslash oder mit nur erstem Treffer", () => {
    const treffer: string[] = [];
    for (const pfad of dateien()) {
      readFileSync(WURZEL + pfad, "utf8")
        .split("\n")
        .forEach((zeile, i) => {
          for (const b of befunde(zeile)) treffer.push(`${pfad}:${i + 1}: ${b} (${zeile.trim().slice(0, 100)})`);
        });
    }
    assert.deepEqual(treffer, [], "Behebung: escapeRe aus test/support/regex.ts");
  });
});
