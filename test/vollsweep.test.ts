/* Vollsweep (factory#280 L5/L7): Mutationen für Regex-Literale und Bedingungen, Ausweis syntaxungültiger Mutationen, Runner mit eingespritztem fs/spawn.
 * Jede Mutationsart der geschlossenen Liste hat einen Positiv- und einen Negativfall (Maskierung, Klasse, Gruppenpräfix). */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as roh from "../scripts/vollsweep.mjs";

interface Mut {
  quelle: string;
  flags: string;
  art: string;
}
interface Ergebnis {
  code: number;
  out: string;
  err: string;
}
interface Spawn {
  status: number | null;
  stdout: string;
  stderr: string;
}
interface Deps {
  lies: (p: string) => string;
  schreibe: (p: string, t: string) => void;
  spawn: (cmd: string, args: string[], opt: { cwd: string }) => Spawn;
}
const sweep = roh as unknown as {
  regexLiterale: (text: string) => { von: number; bis: number; quelle: string; flags: string }[];
  mutationenRegex: (quelle: string, flags: string) => Mut[];
  mutationenBedingung: (zeile: string) => { von: number; bis: number; such: string; ersatz: string }[];
  regexUngueltig: (quelle: string, flags: string) => boolean;
  ausgabeSyntaxfehler: (text: string) => boolean;
  lauf: (argv: string[], deps: Deps) => Ergebnis;
};
const { regexLiterale, mutationenRegex, mutationenBedingung, regexUngueltig, ausgabeSyntaxfehler, lauf } = sweep;

const quellen = (q: string, f = "") => mutationenRegex(q, f).filter((m) => m.flags === f).map((m) => m.quelle).sort();
const flagsVon = (q: string, f: string) => mutationenRegex(q, f).filter((m) => m.quelle === q).map((m) => m.flags).sort();

describe("regexLiterale", () => {
  test("findet ein Literal samt Flags mit Position, ein Divisionszeichen nicht", () => {
    const text = "const r = /a+/gi;\nconst q = x / 2 / y;";
    const l = regexLiterale(text);
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ quelle: "a+", flags: "gi" });
    expect(text.slice(l[0]!.von, l[0]!.bis)).toBe("/a+/gi");
    expect(l[0]!.zeile).toBe(1);
  });
  test("Zeilennummer und Offset stimmen in späteren Zeilen; Kommentarzeilen (//, /*, *) bleiben außen", () => {
    const text = "x();\n// a = /c1/;\n  /* a = /c2/;\n * a = /c3/;\nconst r = /ok/;";
    const l = regexLiterale(text);
    expect(l.map((x) => [x.zeile, x.quelle])).toEqual([[5, "ok"]]);
    expect(text.slice(l[0]!.von, l[0]!.bis)).toBe("/ok/");
  });
});

describe("mutationenRegex", () => {
  test("Anker ^, $ und \\b werden je einzeln entfernt, maskierte und Klassen-Zeichen nicht", () => {
    expect(quellen("^a$")).toEqual(["^a", "a$"]);
    expect(quellen("\\bfoo\\b")).toEqual(["\\bfoo", "foo\\b"].sort());
    expect(quellen("\\^a\\$")).toEqual([]);
    expect(quellen("[$^]")).toEqual(["[$]", "[^$^]", "[^]"].sort());
  });

  test("Klasse: je Element entfernen, Negation in beide Richtungen, Bereich und Escape sind je ein Element", () => {
    expect(quellen("[abc]")).toEqual(["[^abc]", "[ab]", "[ac]", "[bc]"].sort());
    expect(quellen("[^ab]")).toEqual(["[ab]", "[^a]", "[^b]"].sort());
    expect(quellen("[a-z\\d]")).toEqual(["[^a-z\\d]", "[a-z]", "[\\d]"].sort());
    expect(quellen("[a]")).toEqual(["[^a]"]);
  });

  test("Quantor: Grenzen ±1, + und * tauschen, ? entfällt, einzeln und feste Wiederholung", () => {
    expect(quellen("a{2,5}")).toEqual(["a{1,5}", "a{3,5}", "a{2,4}", "a{2,6}"].sort());
    expect(quellen("a{2}")).toEqual(["a{1}", "a{3}"].sort());
    expect(quellen("a{2,}")).toEqual(["a{1,}", "a{3,}"].sort());
    expect(quellen("a{x}")).toEqual([]);
    expect(quellen("a{0,3}")).toEqual(["a{1,3}", "a{0,2}", "a{0,4}"].sort());
    expect(quellen("a+")).toEqual(["a*"]);
    expect(quellen("a*")).toEqual(["a+"]);
    expect(quellen("a?")).toEqual(["a"]);
  });

  test("Quantor mit Lazy-Zeichen: das ? hinter + ist ein eigener Schritt", () => {
    expect(quellen("a+?")).toEqual(["a*?", "a+"].sort());
  });

  test("ein Quantor, der ungültig würde ({2,2} → {2,1}), wird erzeugt und von regexUngueltig erkannt", () => {
    const q = quellen("a{2,2}");
    expect(q).toContain("a{2,1}");
    expect(regexUngueltig("a{2,1}", "")).toBe(true);
  });

  test("Alternative: je Zweig streichen, auch in Gruppen; ohne | keine Zweig-Mutation", () => {
    expect(quellen("a|b|c")).toEqual(["a|b", "a|c", "b|c"].sort());
    expect(quellen("x(a|b)y")).toEqual(["x(a)y", "x(b)y"].sort());
    expect(quellen("[a|b]")).toEqual(["[^a|b]", "[|b]", "[ab]", "[a|]"].sort());
  });

  test("optionale Gruppe (…)? wird zur Pflichtgruppe, ein Lookahead-Präfix ?= ist kein Quantor", () => {
    expect(quellen("(ab)?c")).toEqual(["(ab)c"]);
    expect(quellen("(?:ab)?")).toEqual(["(?:ab)"]);
    expect(quellen("a(?=b)")).toEqual([]);
    expect(quellen("(?<n>a)")).toEqual([]);
  });

  test("Gruppenpräfixe (?:, ?=, ?!, ?<=, ?<!, ?<name>) gehören zur Gruppe: nur die zwei Zweig-Streichungen, kein Quantor-Fund", () => {
    for (const auf of ["(", "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<n>"]) {
      expect(quellen(`x${auf}a|b)y`), auf).toEqual([`x${auf}a)y`, `x${auf}b)y`].sort());
    }
  });

  test("Klassenelemente: Hex-, Unicode- und Zeichen-Escapes sind je ein Element (Groß-/Kleinschreibung der Ziffern, feste Länge)", () => {
    const elemente = ["\\x4a", "\\x4A", "\\x41", "\\u00e9", "\\u00E9", "\\u0041", "c"];
    const erwartet = [`[^${elemente.join("")}]`, ...elemente.map((_, k) => `[${elemente.filter((__, j) => j !== k).join("")}]`)];
    expect(quellen(`[${elemente.join("")}]`)).toEqual(erwartet.sort());
  });

  test("Quantor-Grenzen: Null-Grenzen entfallen, `{x}` und `{,3}` sind keine Quantoren, ein späteres {2} verschiebt nichts", () => {
    expect(quellen("a{0,0}")).toEqual(["a{0,1}", "a{1,0}"].sort());
    expect(quellen("a{0}")).toEqual(["a{1}"]);
    expect(quellen("a{,3}")).toEqual([]);
    expect(quellen("a{x}b{2}")).toEqual(["a{x}b{1}", "a{x}b{3}"].sort());
  });

  test("Flags: jedes einmal entfernt, Quelle unverändert", () => {
    expect(flagsVon("a", "gi")).toEqual(["g", "i"]);
    expect(flagsVon("a", "")).toEqual([]);
  });

  test("keine Mutation gleicht dem Original, keine doppelt; jede trägt eine Art", () => {
    const alle = mutationenRegex("^(a|b)+?[xy]{1,2}$", "gi");
    const schluessel = alle.map((m) => `${m.quelle}/${m.flags}`);
    expect(new Set(schluessel).size).toBe(schluessel.length);
    expect(schluessel).not.toContain("^(a|b)+?[xy]{1,2}$/gi");
    expect(alle.every((m) => m.art.length > 0)).toBe(true);
  });
});

describe("mutationenBedingung", () => {
  const ersetzt = (zeile: string) => mutationenBedingung(zeile).map((m) => zeile.slice(0, m.von) + m.ersatz + zeile.slice(m.bis));
  test("if (b) wird if (true) und if (false), verschachtelte Klammern bleiben ganz", () => {
    expect(ersetzt("  if (f(a) > (b)) return;")).toEqual(["  if (true) return;", "  if (false) return;"]);
    expect(mutationenBedingung("  if (a && b) {")[0]!.such).toBe("if (a && b)");
  });
  test("auch } else if (b) {", () => {
    expect(ersetzt("  } else if (x) {")).toEqual(["  } else if (true) {", "  } else if (false) {"]);
  });
  test("steht schon true oder false, entfällt diese Richtung; ohne if nichts; unausgeglichene Klammer nichts", () => {
    expect(ersetzt("  if (true) x();")).toEqual(["  if (false) x();"]);
    expect(ersetzt("  if (false) x();")).toEqual(["  if (true) x();"]);
    expect(ersetzt("  const x = 1;")).toEqual([]);
    expect(ersetzt("  if (a &&")).toEqual([]);
    expect(ersetzt("  notif (a) b();")).toEqual([]);
    expect(ersetzt("  $if (a) b();")).toEqual([]);
  });
  test("Abstand: if(b) ohne und if  (b) mit mehreren Leerzeichen", () => {
    expect(ersetzt("if(a) b();")).toEqual(["if (true) b();", "if (false) b();"]);
    expect(ersetzt("if   (a) b();")).toEqual(["if (true) b();", "if (false) b();"]);
  });
  test("Klammern in Strings zählen nicht (', \", `, auch mit Escape), mehrere if in einer Zeile", () => {
    expect(mutationenBedingung(String.raw`if (x === ")") y();`)[0]!.such).toBe(String.raw`if (x === ")")`);
    expect(mutationenBedingung("if (x === ')') y();")[0]!.such).toBe("if (x === ')')");
    expect(mutationenBedingung("if (x === `)`) y();")[0]!.such).toBe("if (x === `)`)");
    expect(mutationenBedingung(String.raw`if (x === "\")") y();`)[0]!.such).toBe(String.raw`if (x === "\")")`);
    expect(mutationenBedingung(String.raw`if (x === "\\") y();`)[0]!.such).toBe(String.raw`if (x === "\\")`);
    expect(mutationenBedingung("if (a) { if (b) c(); }").map((m) => m.such)).toEqual(["if (a)", "if (a)", "if (b)", "if (b)"]);
  });
});

describe("Syntaxfehler-Erkennung", () => {
  test("regexUngueltig: wirft new RegExp, dann ungültig", () => {
    expect(regexUngueltig("[", "")).toBe(true);
    expect(regexUngueltig("a", "zz")).toBe(true);
    expect(regexUngueltig("a+", "g")).toBe(false);
  });
  test("ausgabeSyntaxfehler: geschlossene Musterliste der Testausgabe", () => {
    expect(ausgabeSyntaxfehler("SyntaxError: Invalid regular expression")).toBe(true);
    expect(ausgabeSyntaxfehler("Error: Transform failed with 1 error")).toBe(true);
    expect(ausgabeSyntaxfehler("Unexpected token '}'")).toBe(true);
    expect(ausgabeSyntaxfehler("AssertionError: expected 1 to be 2")).toBe(false);
    expect(ausgabeSyntaxfehler("")).toBe(false);
  });
});

describe("lauf", () => {
  const W = "/r/.claude/worktrees/sih-1";
  const DATEI = `${W}/scripts/x.mjs`;
  const QUELLE = "const a = 1;\nconst r = /^a+$/;\nif (a) b();\n";

  interface Aufbau {
    deps: Deps;
    dateien: Record<string, string>;
    aufrufe: string[];
    tests: string[];
  }
  const aufbau = (opt: { gruen?: string[]; diffVorher?: string; diffNachher?: string; ausgabe?: string; basisRot?: boolean; datei?: string; kaputt?: string[] } = {}): Aufbau => {
    const datei = opt.datei ?? DATEI;
    const dateien: Record<string, string> = { [datei]: QUELLE, [`${W}/test/x.test.ts`]: "" };
    const aufrufe: string[] = [];
    const tests: string[] = [];
    let git = 0;
    const deps: Deps = {
      lies: (p) => dateien[p] ?? "",
      schreibe: (p, t) => {
        dateien[p] = t;
      },
      spawn: (cmd, args, { cwd }) => {
        aufrufe.push(`${cmd} ${args.join(" ")} @${cwd}`);
        if (cmd === "git") return { status: 0, stdout: git++ === 0 ? (opt.diffVorher ?? "") : (opt.diffNachher ?? ""), stderr: "" };
        if (args[0] === "--check") return { status: (opt.kaputt ?? []).some((k) => dateien[datei]!.includes(k)) ? 1 : 0, stdout: "", stderr: "SyntaxError" };
        tests.push(dateien[datei]!);
        const inhalt = dateien[datei]!;
        if (inhalt === QUELLE) return { status: opt.basisRot ? 1 : 0, stdout: "", stderr: "" };
        const gruen = (opt.gruen ?? []).some((g) => inhalt.includes(g));
        return { status: gruen ? 0 : 1, stdout: opt.ausgabe ?? "", stderr: "" };
      },
    };
    return { deps, dateien, aufrufe, tests };
  };
  const argv = (...extra: string[]) => ["--wurzel", W, "--datei", "scripts/x.mjs", "--test", "test/x.test.ts", ...extra];

  test("Aufruf-Fehler: --wurzel relativ, fehlende Flags, schlechte --zeilen, Wurzel kein Worktree: Exit 2, ohne Dateizugriff", () => {
    const a = aufbau();
    const faelle = [
      ["--wurzel", "rel/pfad", "--datei", "x", "--test", "t"],
      ["--datei", "x", "--test", "t"],
      ["--wurzel", W, "--test", "t"],
      ["--wurzel", W, "--datei", "x"],
      argv("--zeilen", "5-2"),
      argv("--zeilen", "abc"),
      ["--wurzel", "/r", "--datei", "scripts/x.mjs", "--test", "t"],
      ["--wurzel", "/r/.claude/worktrees", "--datei", "scripts/x.mjs", "--test", "t"],
      ["--wurzel", W, "--datei", "../ausserhalb.mjs", "--test", "t"],
    ];
    for (const f of faelle) {
      const r = lauf(f, a.deps);
      expect(r.code, f.join(" ")).toBe(2);
      expect(r.err).toMatch(/vollsweep/);
    }
    expect(a.aufrufe).toEqual([]);
  });

  test("Ausgabe: Zeile mit Gesamtzahl, je Mutation `<datei> | <such> → <ersatz> | <test> | rot|grün`, Datei danach unverändert", () => {
    const a = aufbau({ gruen: ["/^a*$/"] });
    const r = lauf(argv("--zeilen", "2-2"), a.deps);
    expect(r.code).toBe(0);
    const zeilen = r.out.trim().split("\n");
    expect(zeilen[0]).toMatch(/^vollsweep: 3 Mutationen/);
    expect(zeilen).toContain("scripts/x.mjs | /^a+$/ → /a+$/ | test/x.test.ts | rot");
    expect(zeilen).toContain("scripts/x.mjs | /^a+$/ → /^a+/ | test/x.test.ts | rot");
    expect(zeilen).toContain("scripts/x.mjs | /^a+$/ → /^a*$/ | test/x.test.ts | grün");
    expect(a.dateien[DATEI]).toBe(QUELLE);
    expect(zeilen.at(-1)).toMatch(/rot 2 · grün 1 · ungültig 0/);
  });

  test("Bedingungen nur in --zeilen: ohne --zeilen keine, mit Zeile 3 die zwei if-Mutationen", () => {
    const ohne = lauf(argv(), aufbau().deps);
    expect(ohne.out).not.toMatch(/if \(a\)/);
    const mit = lauf(argv("--zeilen", "3"), aufbau({ gruen: ["if (false) b()"] }).deps);
    expect(mit.out).toContain("scripts/x.mjs | if (a) → if (true) | test/x.test.ts | rot");
    expect(mit.out).toContain("scripts/x.mjs | if (a) → if (false) | test/x.test.ts | grün");
    expect(mit.out).not.toMatch(/\/\^a\+\$\//);
  });

  test("ein if in einer Kommentarzeile wird nicht mutiert", () => {
    const a = aufbau();
    a.dateien[DATEI] = QUELLE.replace("const a = 1;", "// if (a) wird erklärt\n * if (b) auch");
    const roh0 = a.dateien[DATEI];
    const orig = a.deps.spawn;
    a.deps.spawn = (cmd, args, opt) => (cmd === "git" ? orig(cmd, args, opt) : { status: a.dateien[DATEI] === roh0 ? 0 : 1, stdout: "", stderr: "" });
    const r = lauf(argv("--zeilen", "1-5"), a.deps);
    expect(r.out).toMatch(/^vollsweep: 5 Mutationen/);
    expect(r.out).not.toMatch(/if \(b\)|wird erklärt/);
  });

  test("--wurzel relativ, aber mit Worktree-Segment: Exit 2 wegen „absolut“", () => {
    const r = lauf(["--wurzel", "rel/.claude/worktrees/sih-1", "--datei", "scripts/x.mjs", "--test", "t"], aufbau().deps);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/absolut/);
  });

  test("--zeilen: a und a-b gelten, alles andere (3-, x3, 3x, 3-4x, 0, 5-2) ist Exit 2", () => {
    for (const ok of ["2", "2-3"]) expect(lauf(argv("--zeilen", ok), aufbau().deps).code, ok).toBe(0);
    for (const schlecht of ["3-", "x3", "3x", "3-4x", "0", "5-2", "4-x"]) expect(lauf(argv("--zeilen", schlecht), aufbau().deps).code, schlecht).toBe(2);
  });

  test("eine ungültige Regex-Mutation wird nie geschrieben", () => {
    const a = aufbau();
    a.dateien[DATEI] = "const q = /a{2,2}/;\n";
    const geschrieben: string[] = [];
    const schreibe = a.deps.schreibe;
    a.deps.schreibe = (p, t) => {
      geschrieben.push(t);
      schreibe(p, t);
    };
    const orig = a.deps.spawn;
    a.deps.spawn = (cmd, args, opt) => (cmd === "git" ? orig(cmd, args, opt) : { status: 0, stdout: "", stderr: "" });
    lauf(argv(), a.deps);
    expect(geschrieben.some((t) => t.includes("{2,1}") || t.includes("{3,2}"))).toBe(false);
    expect(geschrieben.some((t) => t.includes("{1,2}"))).toBe(true);
  });

  test("`node --check` nur für .mjs, .cjs und .js (nicht .ts, nicht .mjs.ts)", () => {
    const check = (name: string) => {
      const a = aufbau({ datei: `${W}/scripts/${name}` });
      lauf(["--wurzel", W, "--datei", `scripts/${name}`, "--test", "test/x.test.ts"], a.deps);
      return a.aufrufe.some((c) => c.includes("--check"));
    };
    expect([check("a.mjs"), check("a.cjs"), check("a.js")]).toEqual([true, true, true]);
    expect([check("a.ts"), check("a.mjs.ts"), check("a.json")]).toEqual([false, false, false]);
  });

  test("Prozess-Start: ohne Argumente Exit 2 mit Aufrufzeile auf stderr, nichts auf stdout", () => {
    const r = spawnSync("node", [fileURLToPath(new URL("../scripts/vollsweep.mjs", import.meta.url))], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Aufruf: node scripts\/vollsweep\.mjs --wurzel/);
    expect(r.stdout).toBe("");
  });

  test("ohne --zeilen werden alle Regex-Literale der Datei gesweept", () => {
    const r = lauf(argv(), aufbau().deps);
    expect(r.out).toMatch(/\/\^a\+\$\/ → /);
  });

  test("ungültige Regex-Mutation: `ungültig` ohne Testlauf, zählt nicht als rot", () => {
    const a = aufbau();
    a.dateien[DATEI] = "const q = /a{2,2}/;\n";
    const roh0 = a.dateien[DATEI];
    a.deps.spawn = ((orig) => (cmd, args, opt) => {
      const r = orig(cmd, args, opt);
      return cmd === "git" || args[0] === "--check" ? r : { ...r, status: a.dateien[DATEI] === roh0 ? 0 : 1 };
    })(a.deps.spawn);
    const r = lauf(argv(), a.deps);
    expect(r.out).toContain("scripts/x.mjs | /a{2,2}/ → /a{2,1}/ | test/x.test.ts | ungültig");
    expect(r.out).toMatch(/rot 2 · grün 0 · ungültig 2/);
    expect(a.tests.every((t) => !t.includes("{2,1}"))).toBe(true);
  });

  test(".mjs: `node --check` schlägt fehl ⇒ ungültig, ohne Testlauf", () => {
    const a = aufbau({ kaputt: ["/^a*$/"] });
    const r = lauf(argv("--zeilen", "2"), a.deps);
    expect(r.out).toContain("scripts/x.mjs | /^a+$/ → /^a*$/ | test/x.test.ts | ungültig");
    expect(a.tests.some((t) => t.includes("/^a*$/"))).toBe(false);
  });

  test(".ts: rote Mutation mit Syntaxfehler in der Testausgabe ⇒ ungültig, sonst rot", () => {
    const a = aufbau({ datei: `${W}/scripts/y.ts`, ausgabe: "Error: Transform failed" });
    const r = lauf(["--wurzel", W, "--datei", "scripts/y.ts", "--test", "test/x.test.ts"], a.deps);
    expect(r.out).toMatch(/\| ungültig$/m);
    expect(r.out).not.toMatch(/\| rot$/m);
    const b = aufbau({ datei: `${W}/scripts/y.ts`, ausgabe: "AssertionError" });
    expect(lauf(["--wurzel", W, "--datei", "scripts/y.ts", "--test", "test/x.test.ts"], b.deps).out).toMatch(/\| rot$/m);
  });

  test("Tests laufen über gate-befehl testGezielt der Wurzel mit cwd = Wurzel; git diff --stat vorher und nachher", () => {
    const a = aufbau();
    lauf(argv("--zeilen", "2"), a.deps);
    expect(a.aufrufe.some((c) => c === `node ${W}/scripts/gate-befehl.mjs testGezielt ${W}/test/x.test.ts @${W}`)).toBe(true);
    expect(a.aufrufe[0]).toBe(`git -C ${W} diff --stat -- ${DATEI} @${W}`);
    expect(a.aufrufe.filter((c) => c.startsWith("git ")).length).toBe(2);
  });

  test("Test schon ohne Mutation rot: Exit 1, keine Mutation gefahren", () => {
    const a = aufbau({ basisRot: true });
    const r = lauf(argv(), a.deps);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/ohne Mutation rot/);
    expect(a.tests).toHaveLength(1);
  });

  test("Datei schon vor dem Lauf geändert: Exit 2, nichts geschrieben", () => {
    const a = aufbau({ diffVorher: " scripts/x.mjs | 2 +-\n" });
    const r = lauf(argv(), a.deps);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Zwischen-Commit/);
    expect(a.tests).toHaveLength(0);
  });

  test("Datei danach geändert (diff --stat nicht leer): Exit 1 mit Hinweis", () => {
    const a = aufbau({ diffNachher: " scripts/x.mjs | 2 +-\n" });
    const r = lauf(argv("--zeilen", "2"), a.deps);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/weicht nach dem Sweep vom Stand ab/);
  });

  test("Wirft der Test-Spawn, wird die Datei trotzdem zurückgeschrieben", () => {
    const a = aufbau();
    const orig = a.deps.spawn;
    let n = 0;
    a.deps.spawn = (cmd, args, opt) => {
      if (cmd !== "git" && args[0] !== "--check" && n++ === 1) throw new Error("kaputt");
      return orig(cmd, args, opt);
    };
    expect(() => lauf(argv("--zeilen", "2"), a.deps)).toThrow(/kaputt/);
    expect(a.dateien[DATEI]).toBe(QUELLE);
  });
});
