/* Größenstufe (factory#271): Stufe S (klein) wird aus dem Diff berechnet; die Nachweis-Wächter akzeptieren nur dann die kleinere Besetzung.
 * Logik aus scripts/groessenstufe-lib.mjs, scripts/groessenstufe.mjs, check-review-nachweis.mjs und check-abnahme-nachweis.mjs importiert;
 * die Wächter laufen gegen ein echtes git-Repo im Temp-Ordner (Verdrahtung: der Wächter rechnet die Stufe selbst, der Umsetzer behauptet sie nie). */
import { afterEach, describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/groessenstufe-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../scripts/groessenstufe.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as reviewRaw from "../scripts/check-review-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as abnahmeRaw from "../scripts/check-abnahme-nachweis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as nlRaw from "../scripts/nachweis-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../scripts/slice-override.mjs";
import { echteSprache } from "./support/echte-sprache";
import { FREMD } from "./support/fremd-config";

type Eintrag = { pfad: string | null; zeilen?: number | null };
type Ergebnis = { stufe: "S" | "voll"; gruende: string[] };
const lib = libRaw as unknown as {
  GROESSENSTUFE_S: { maxDateien: number; maxZeilen: number };
  GRUNDSCHUTZ: string[];
  bestimmeSweeptiefe: (p: unknown, r: unknown) => { tiefe: "voll" | "stichprobe"; gruende: string[] };
  risikoMusterAus: (c: unknown) => unknown;
  parseNumstatNoRenames: (t: string) => { pfad: string | null; zeilen: number | null }[];
  bestimmeGroessenstufe: (o: { eintraege: Eintrag[] | null; muster: string[] | null; prognose?: boolean }) => Ergebnis;
  groessenstufeAusGit: (git: (a: string[]) => string, base: string, head?: string, o?: { ladeMuster?: () => string[]; zweiPunkt?: boolean }) => Ergebnis;
  ladeLeitplankenMuster: (quelle?: string) => string[];
};
const cli = cliRaw as unknown as { laufe: (argv: string[], o?: { git?: (a: string[]) => string; ladeMuster?: () => string[]; ladeRisiko?: () => unknown; env?: Record<string, string> }) => { code: number; ausgabe: string } };
const nl = nlRaw as unknown as { kleinGrund: (g: string) => { art: string; begruendung?: string } | null; parseNachweis: (t: string, z: unknown) => { plan: { art: string; grund?: string } | null; review: { lenses: string[] } | null } };
type Zeilen = { plan: string; planer: string; review: string; abnahme: string; praefix: string };
const { commitZeilen } = sliceRaw as unknown as { commitZeilen: (p: string, pl: string) => Zeilen };

const PL = FREMD.agenten.planer;
const Z = commitZeilen(FREMD.praefixe.commitZeile, PL);
const MUSTER = ["/src/save/", "/.github/workflows/*.yml"];
const eins = (pfad: string, zeilen = 1): Eintrag => ({ pfad, zeilen });
const stufe = (eintraege: Eintrag[], muster: string[] | null = MUSTER, prognose = false) => lib.bestimmeGroessenstufe({ eintraege, muster, prognose });

describe("bestimmeGroessenstufe: Kriterium (K1)", () => {
  test("die Grenzen stehen in einer Konstante: 3 Dateien, 60 Zeilen", () => {
    expect(lib.GROESSENSTUFE_S).toEqual({ maxDateien: 3, maxZeilen: 60 });
  });
  test("eine Doku-Datei mit einer Zeile ist S", () => {
    expect(stufe([eins("docs/x.md")])).toMatchObject({ stufe: "S", gruende: [] });
  });
  test("Grenze: 3 Dateien und 60 Zeilen sind S, 4 Dateien oder 61 Zeilen sind voll", () => {
    expect(stufe([eins("docs/a.md", 20), eins("docs/b.md", 20), eins("docs/c.md", 20)]).stufe).toBe("S");
    expect(stufe([eins("docs/a.md", 5), eins("docs/b.md", 5), eins("docs/c.md", 5), eins("docs/d.md", 1)])).toMatchObject({ stufe: "voll", gruende: [expect.stringMatching(/4 Dateien/)] });
    expect(stufe([eins("docs/a.md", 61)])).toMatchObject({ stufe: "voll", gruende: [expect.stringMatching(/61 Zeilen/)] });
    expect(stufe([eins("docs/a.md", 60)]).stufe).toBe("S");
  });
  test("auch reines Markdown hat keinen Freibetrag", () => {
    expect(stufe([eins("docs/a.md", 400)]).stufe).toBe("voll");
  });
  test("die Prognose kennt keine Zeilen: nur Dateizahl und Pfade zählen", () => {
    expect(stufe([{ pfad: "docs/a.md" }, { pfad: "src/b.ts" }], MUSTER, true).stufe).toBe("S");
    expect(stufe([{ pfad: "docs/a.md" }], MUSTER, false).stufe).toBe("voll");
    expect(stufe([{ pfad: "src/save/a.ts" }], MUSTER, true).stufe).toBe("voll");
  });
});

describe("bestimmeGroessenstufe: Negativfall, nie S (K5)", () => {
  const EINZEILER = [
    ".github/workflows/ci.yml",
    "scripts/check-size.mjs",
    "AGENTS.md",
    "docs/AGENTS.md",
    ".claude/agents/x.md",
    ".agents/skills/x/SKILL.md",
    ".githooks/pre-push",
    ".factory/besitz.json",
    ".mcp.json",
    "test/harness/x.test.ts",
    "package.json",
    "package-lock.json",
    "src/save/slot.ts",
  ];
  for (const pfad of EINZEILER) {
    test(`${pfad} mit einer Zeile ist voll`, () => {
      const r = stufe([eins(pfad)]);
      expect(r.stufe).toBe("voll");
      expect(r.gruende.join()).toMatch(/geschützten Pfad/);
    });
  }
  test("ein Umzug aus einem geschützten Pfad (delete plus add per --no-renames) ist voll", () => {
    const eintraege = lib.parseNumstatNoRenames("0\t5\tscripts/alt.mjs\n5\t0\tdocs/neu.md\n");
    expect(stufe(eintraege).stufe).toBe("voll");
  });
  test("ein geschützter Pfad unter mehreren harmlosen macht den ganzen Diff voll", () => {
    expect(stufe([eins("docs/a.md"), eins("docs/b.md"), eins("scripts/x.mjs")]).stufe).toBe("voll");
  });
  test("fail-closed: Binärdatei, leere Liste, fehlende Schutzliste, Eintrag ohne Pfad, von git quotierter Pfad", () => {
    expect(stufe([{ pfad: "docs/bild.png", zeilen: null }]).gruende.join()).toMatch(/binär/);
    expect(stufe([]).stufe).toBe("voll");
    expect(stufe(null as unknown as Eintrag[]).stufe).toBe("voll");
    expect(stufe([eins("docs/a.md")], []).stufe).toBe("voll");
    expect(stufe([eins("docs/a.md")], null).stufe).toBe("voll");
    expect(stufe([{ pfad: null, zeilen: null }]).stufe).toBe("voll");
    expect(stufe([eins('"docs/\\303\\244.md"')]).stufe).toBe("voll");
  });
  test("GRUNDSCHUTZ trägt die Harness-Pfade (geschlossene Liste)", () => {
    expect(lib.GRUNDSCHUTZ).toEqual(expect.arrayContaining(["AGENTS.md", "/.claude/", "/.agents/", "/scripts/", "/test/harness/", "/.github/", "/package.json"]));
  });
  test("die echte protected-paths.json ist ladbar und gilt ohne den Grundschutz (Gate-Pfad bleibt voll)", () => {
    const echt = lib.ladeLeitplankenMuster();
    expect(echt.length).toBeGreaterThan(10);
    expect(lib.bestimmeGroessenstufe({ eintraege: [eins("scripts/check-x.mjs")], muster: echt }).stufe).toBe("voll");
  });
});

describe("parseNumstatNoRenames und groessenstufeAusGit", () => {
  test("mehrstellige Zählungen werden summiert (12 + 30 = 42, ein S-Diff mit 10 bis 60 Zeilen bleibt S)", () => {
    expect(lib.parseNumstatNoRenames("12\t30\tdocs/a.md\n")).toEqual([{ pfad: "docs/a.md", zeilen: 42 }]);
    expect(stufe(lib.parseNumstatNoRenames("12\t30\tdocs/a.md\n")).stufe).toBe("S");
  });
  test("ohne Text (undefined) ist die Liste leer; eine halb-binäre Zeile (- und Zahl) ist binär", () => {
    expect(lib.parseNumstatNoRenames(undefined as unknown as string)).toEqual([]);
    expect(lib.parseNumstatNoRenames("-\t3\tbild.bin\n3\t-\tbild2.bin\n")).toEqual([
      { pfad: "bild.bin", zeilen: null },
      { pfad: "bild2.bin", zeilen: null },
    ]);
  });
  test("ohne lesbare Zeilenzahl (fehlend, Text, Bruch) ist der Diff voll, in der Prognose nicht", () => {
    for (const zeilen of [undefined, "5", 1.5, Number.NaN]) expect(stufe([{ pfad: "docs/a.md", zeilen: zeilen as unknown as number }]).stufe, String(zeilen)).toBe("voll");
    expect(stufe([{ pfad: "docs/a.md", zeilen: null }], MUSTER, true).stufe).toBe("S");
  });
  test("ein Pfad aus Leerraum ist kein Pfad (voll); die Prognose ignoriert angegebene Zeilen", () => {
    expect(stufe([{ pfad: "   ", zeilen: 1 }]).stufe).toBe("voll");
    expect(stufe([{ pfad: "docs/a.md", zeilen: 400 }], MUSTER, true).stufe).toBe("S");
  });
  test("ladeLeitplankenMuster wirft bei kaputtem JSON und bei fehlender Datei, liest sonst alle String-Listen", () => {
    const dir = mkdtempSync(join(tmpdir(), "stufe-"));
    dirs.push(dir);
    writeFileSync(join(dir, "kaputt.json"), "{nicht json");
    writeFileSync(join(dir, "ok.json"), JSON.stringify({ a: ["/x/"], b: ["/y/"], c: 5 }));
    expect(() => lib.ladeLeitplankenMuster(join(dir, "kaputt.json"))).toThrow(/kein gültiges JSON/);
    expect(() => lib.ladeLeitplankenMuster(join(dir, "fehlt.json"))).toThrow();
    expect(lib.ladeLeitplankenMuster(join(dir, "ok.json"))).toEqual(["/x/", "/y/"]);
  });
  test("ohne head zählt der Aufruf bis HEAD", () => {
    const aufrufe: string[] = [];
    lib.groessenstufeAusGit((a) => (a[0] === "show" ? "" : aufrufe.push(a.join(" ")), "1\t0\tdocs/a.md\n"), "B", undefined, { ladeMuster: () => MUSTER });
    expect(aufrufe).toEqual(["-c core.quotepath=off diff --numstat --no-renames B...HEAD"]);
  });
  test("Zeilen werden summiert, Binärdateien sind null, Müll hat keinen Pfad", () => {
    expect(lib.parseNumstatNoRenames("3\t4\tdocs/a.md\n-\t-\tbild.png\nkaputt\n\n")).toEqual([
      { pfad: "docs/a.md", zeilen: 7 },
      { pfad: "bild.png", zeilen: null },
      { pfad: null, zeilen: null },
    ]);
  });
  test("der git-Aufruf zählt mit --no-renames über base...head, mit zweiPunkt über base..head", () => {
    const aufrufe: string[] = [];
    const git = (a: string[]) => {
      if (a[0] !== "show") aufrufe.push(a.join(" "));
      return "1\t0\tdocs/a.md\n";
    };
    expect(lib.groessenstufeAusGit(git, "B", "H", { ladeMuster: () => MUSTER }).stufe).toBe("S");
    lib.groessenstufeAusGit(git, "B", "H", { ladeMuster: () => MUSTER, zweiPunkt: true });
    expect(aufrufe).toEqual(["-c core.quotepath=off diff --numstat --no-renames B...H", "-c core.quotepath=off diff --numstat --no-renames B..H"]);
  });
  test("ein git-Fehler und ein Ladefehler der Schutzliste sind voll (fail-closed)", () => {
    const wirft = () => {
      throw new Error("kaputt");
    };
    expect(lib.groessenstufeAusGit(wirft, "B", "H", { ladeMuster: () => MUSTER })).toMatchObject({ stufe: "voll", gruende: [expect.stringMatching(/git-Fehler/)] });
    expect(lib.groessenstufeAusGit(() => "1\t0\tdocs/a.md\n", "B", "H", { ladeMuster: wirft })).toMatchObject({ stufe: "voll", gruende: [expect.stringMatching(/Schutzliste nicht ladbar/)] });
  });
});

describe("CLI groessenstufe.mjs", () => {
  const git = (a: string[]) => {
    if (a[0] === "rev-parse") return "b".repeat(40);
    return "2\t1\tdocs/a.md\n";
  };
  const o = { git, ladeMuster: () => MUSTER, env: { FACTORY_DIFF_BASE: "b".repeat(40) } };
  test("ohne Argument: Diff gegen die Basis; Ausgabe STUFE: S, Exit 0", () => {
    expect(cli.laufe([], o)).toEqual({ code: 0, ausgabe: "STUFE: S\nRISIKO: doku — nur *.md\nSWEEP: stichprobe — nur Doku und Testdateien, Risikoklasse nicht hoch" });
  });
  test("--commit rechnet <sha>^..<sha>", () => {
    const aufrufe: string[] = [];
    cli.laufe(["--commit", "abc1234"], { ...o, git: (a) => (a[0] === "show" ? "" : aufrufe.push(a.join(" ")), "1\t0\tdocs/a.md\n") });
    expect(aufrufe).toEqual(["-c core.quotepath=off diff --numstat --no-renames abc1234^..abc1234"]);
  });
  test("--pfade ist die Prognose; ein geschützter Pfad gibt voll samt Grund, --json liefert das Objekt", () => {
    expect(cli.laufe(["--pfade", "docs/x.md", "docs/y.md"], o).ausgabe).toBe("STUFE: S\nRISIKO: doku — nur *.md\nSWEEP: stichprobe — nur Doku und Testdateien, Risikoklasse nicht hoch");
    expect(cli.laufe(["--pfade", "docs/x.md", "scripts/y.mjs"], o).ausgabe).toMatch(/^STUFE: voll — scripts\/y\.mjs liegt in einem geschützten Pfad/);
    expect(JSON.parse(cli.laufe(["--pfade", "scripts/y.mjs", "--json"], o).ausgabe)).toMatchObject({ stufe: "voll" });
  });
  test("--pfade normalisiert Backslashes und ./: ein geschützter Pfad in Windows-Schreibweise ist voll", () => {
    expect(cli.laufe(["--pfade", ".\\scripts\\x.mjs"], o).ausgabe).toMatch(/^STUFE: voll/);
    expect(cli.laufe(["--pfade", "./scripts/x.mjs"], o).ausgabe).toMatch(/^STUFE: voll/);
    expect(cli.laufe(["--pfade", "./docs/x.md"], o).ausgabe).toBe("STUFE: S\nRISIKO: doku — nur *.md\nSWEEP: stichprobe — nur Doku und Testdateien, Risikoklasse nicht hoch");
  });
  test("als Prozess: STUFE-Zeile mit Exit 0, Aufruf-Fehler mit Exit 2 und Aufrufzeile", () => {
    const skript = fileURLToPath(new URL("../scripts/groessenstufe.mjs", import.meta.url));
    expect(execFileSync("node", [skript, "--pfade", "docs/x.md"], { encoding: "utf8" }).trim()).toBe("STUFE: S\nRISIKO: doku — nur *.md\nSWEEP: stichprobe — nur Doku und Testdateien, Risikoklasse nicht hoch");
    const fehler = spawnSync("node", [skript, "--unbekannt"], { encoding: "utf8" });
    expect(fehler.status).toBe(2);
    expect(fehler.stderr).toMatch(/Aufruf: node scripts\/groessenstufe\.mjs/);
  });
  describe("RISIKO-Zeile (factory#333)", () => {
    const STD = lib.risikoMusterAus({});
    const mit = { ...o, ladeRisiko: () => STD };
    test("ohne Argument, --commit und --pfade: zweite Zeile RISIKO", () => {
      const authGit = () => "1\t0\tsrc/auth/x.ts\n";
      expect(cli.laufe([], { ...mit, git: (a) => (a[0] === "rev-parse" ? "b".repeat(40) : authGit()) }).ausgabe).toBe(
        "STUFE: voll — Risikoklasse hoch: src/auth/x.ts trifft *auth* (Standardliste)\nRISIKO: hoch — src/auth/x.ts trifft *auth* (Standardliste)\nSWEEP: voll — src/auth/x.ts trifft *auth* (Standardliste)",
      );
      expect(cli.laufe(["--commit", "abc"], { ...mit, git: authGit }).ausgabe).toMatch(/\nRISIKO: hoch — src\/auth\/x\.ts trifft \*auth\*/);
      expect(cli.laufe(["--pfade", "src/a.ts"], mit).ausgabe).toBe("STUFE: S\nRISIKO: normal — kein Pfad trifft ein Risiko-Muster (Standardliste)\nSWEEP: voll — src/a.ts ist Code oder Konfiguration");
    });
    test("--json trägt risiko mit allen Treffern, der Text höchstens fünf plus Zahl der weiteren", () => {
      const j = JSON.parse(cli.laufe(["--pfade", "src/auth/x.ts", "--json"], mit).ausgabe) as { risiko: unknown };
      expect(j.risiko).toMatchObject({ klasse: "hoch", quelle: "Standardliste", treffer: [{ pfad: "src/auth/x.ts", muster: "*auth*" }] });
      const viele = Array.from({ length: 7 }, (_, i) => `src/auth/${i}.ts`);
      const zeile = cli.laufe(["--pfade", ...viele], mit).ausgabe.split("\n")[1];
      expect(zeile).toMatch(/RISIKO: hoch — .*\(\+2 weitere\)$/);
      expect(zeile.split("; ")).toHaveLength(5);
      expect((JSON.parse(cli.laufe(["--pfade", ...viele, "--json"], mit).ausgabe) as { risiko: { treffer: unknown[] } }).risiko.treffer).toHaveLength(7);
    });
    test("Textfenster: genau 5 Gründe ohne weitere, 6 mit (+1 weitere)", () => {
      const pfade = (n: number) => Array.from({ length: n }, (_, i) => `src/auth/${i}.ts`);
      expect(cli.laufe(["--pfade", ...pfade(5)], mit).ausgabe.split("\n")[1]).not.toMatch(/weitere/);
      expect(cli.laufe(["--pfade", ...pfade(6)], mit).ausgabe.split("\n")[1]).toMatch(/\(\+1 weitere\)$/);
    });
    test("fail-closed-Zweige tragen RISIKO: hoch (Schutzliste nicht ladbar, keine Basis)", () => {
      const wirft = () => { throw new Error("x"); };
      expect(cli.laufe(["--pfade", "src/a.ts"], { ...mit, ladeMuster: wirft }).ausgabe).toMatch(/\nRISIKO: hoch — Schutzliste nicht ladbar/);
      expect(cli.laufe([], { ...mit, git: () => "", env: {} }).ausgabe).toMatch(/\nRISIKO: hoch — keine Vergleichs-Basis/);
    });
    test("als Prozess ohne Injektion: Standardliste der Repo-Config, hoch bei src/auth/x.ts", () => {
      const skript = fileURLToPath(new URL("../scripts/groessenstufe.mjs", import.meta.url));
      const aus = execFileSync("node", [skript, "--pfade", "src/auth/x.ts"], { encoding: "utf8" });
      expect(aus).toMatch(/\nRISIKO: hoch — src\/auth\/x\.ts trifft \*auth\* \(Standardliste\)/);
    });
    test("ein Ladefehler der Risiko-Muster ist hoch (fail-closed), kein Absturz", () => {
      const r = cli.laufe(["--pfade", "src/a.ts"], { ...o, ladeRisiko: () => { throw new Error("kaputt"); } });
      expect(r.code).toBe(0);
      expect(r.ausgabe).toMatch(/^STUFE: voll — Risikoklasse hoch: Projekt-Config nicht ladbar: kaputt\nRISIKO: hoch/);
      const c = cli.laufe(["--commit", "abc"], { ...o, git: () => "1\t0\tsrc/a.ts\n", ladeRisiko: () => { throw new Error("kaputt"); } });
      expect(c.ausgabe).toMatch(/\nRISIKO: hoch — Projekt-Config nicht ladbar: kaputt/);
    });
  });
  test("Aufruf-Fehler: Exit 2; keine Basis und Ladefehler: voll statt Absturz", () => {
    expect(cli.laufe(["--pfade"], o).code).toBe(2);
    expect(cli.laufe(["--commit"], o).code).toBe(2);
    expect(cli.laufe(["--unbekannt"], o).code).toBe(2);
    expect(cli.laufe(["docs/x.md"], o).code).toBe(2);
    expect(cli.laufe(["--commit", "abc", "docs/x.md"], o).code).toBe(2);
    expect(cli.laufe(["--commit", "abc", "--pfade", "docs/x.md"], o).code).toBe(2);
    expect(cli.laufe([], { ...o, git: () => "", env: {} }).ausgabe).toMatch(/voll — keine Vergleichs-Basis/);
    expect(cli.laufe(["--pfade", "docs/x.md"], { ...o, ladeMuster: () => { throw new Error("x"); } }).ausgabe).toMatch(/voll — Schutzliste nicht ladbar/);
  });
});

describe("kleinGrund und parseNachweis: skizze und ohne — klein", () => {
  test("klein mit Begründung, ohne Begründung, anderer Grund", () => {
    expect(nl.kleinGrund("klein: Status-Zeile")).toEqual({ art: "klein", begruendung: "Status-Zeile" });
    expect(nl.kleinGrund("klein")).toEqual({ art: "klein-ohne-begruendung" });
    expect(nl.kleinGrund("klein:   ")).toEqual({ art: "klein-ohne-begruendung" });
    expect(nl.kleinGrund("Revert eines PR")).toBeNull();
    expect(nl.kleinGrund("kleinlich: x")).toBeNull();
    expect(nl.kleinGrund("klein : x")).toEqual({ art: "klein", begruendung: "x" });
    expect(nl.kleinGrund(undefined as unknown as string)).toBeNull();
  });
  test("Plan-Zeile: skizze wird erkannt, ein anderer Zusatz bleibt ungültig", () => {
    expect(nl.parseNachweis(`${Z.plan}: ${PL} — skizze`, Z).plan).toEqual({ art: "skizze" });
    expect(nl.parseNachweis(`${Z.plan}: ${PL} — skizze2`, Z).plan).toMatchObject({ art: "ungueltig" });
    expect(nl.parseNachweis(`${Z.plan}: vor${PL} — skizze`, Z).plan).toMatchObject({ art: "ungueltig" });
    expect(nl.parseNachweis(`${Z.plan}: ${PL} - skizze`, Z).plan).toEqual({ art: "skizze" });
    expect(nl.parseNachweis(`${Z.plan}: ${PL} – skizze`, Z).plan).toEqual({ art: "skizze" });
    expect(nl.parseNachweis(`${Z.plan}: ${PL} —— skizze`, Z).plan).toEqual({ art: "skizze" });
    expect(nl.parseNachweis("kein Nachweis", Z).plan).toBeNull();
    expect(nl.parseNachweis(`${Z.plan}: ohne — klein: x`, Z).plan).toEqual({ art: "ohne", grund: "klein: x" });
  });
});

// ── Wächter gegen ein echtes git-Repo ───────────────────────────────────────────
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Temp-Repo: Basis-Commit, dann je `aenderungen` (Pfad → Text) ein Commit, dann der Nachweis-Commit mit `nachweis`. Liefert Git-Funktion und Basis. */
function repo(aenderungen: Record<string, string>, nachweis: string) {
  const dir = mkdtempSync(join(tmpdir(), "stufe-"));
  dirs.push(dir);
  const git = (a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.org", "-c", "commit.gpgsign=false", ...a], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"]);
  writeFileSync(join(dir, "README.md"), "x\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "basis"]);
  const base = git(["rev-parse", "HEAD"]).trim();
  for (const [pfad, text] of Object.entries(aenderungen)) {
    mkdirSync(dirname(join(dir, pfad)), { recursive: true });
    writeFileSync(join(dir, pfad), text);
  }
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "umsetzung"]);
  const head = git(["rev-parse", "HEAD"]).trim();
  git(["commit", "-q", "--allow-empty", "-m", nachweis.replaceAll("<HEAD>", head)]);
  return { git, base };
}

describe("check-review-nachweis rechnet die Stufe selbst (K3, K4, K5)", () => {
  const pruefe = (aenderungen: Record<string, string>, nachweis: string) => {
    const { git, base } = repo(aenderungen, nachweis);
    return (reviewRaw as { checkReviewNachweis: (o: unknown) => { ok: boolean; fehler: string[] } }).checkReviewNachweis({ runGit: git, env: { FACTORY_DIFF_BASE: base }, ladeZeilen: () => Z });
  };
  const nach = (plan: string, lenses: string, blocker = lenses.split(",").map((l) => `${l}:0`).join(",")) => `${Z.plan}: ${plan}\n${Z.review}: head=<HEAD> runden=1 lenses=${lenses} blocker=${blocker} verdikt=ok`;
  const KLEIN = { "src/a.ts": "export const a = 1;\n" };
  const DREI = "architektur,requirement-treue,test-adaequanz";

  test("S mit Code: kombiniert, Skizze und ohne — klein sind grün", () => {
    expect(pruefe(KLEIN, nach(`${PL} — skizze`, "kombiniert")).fehler).toEqual([]);
    expect(pruefe(KLEIN, nach("ohne — klein: Ein-Zeilen-Änderung", "kombiniert")).fehler).toEqual([]);
  });
  test("S: der volle Satz und der volle Planer bleiben grün", () => {
    expect(pruefe(KLEIN, nach(PL, DREI)).fehler).toEqual([]);
  });
  test("S mit Markdown: kombiniert genügt nicht, doku bleibt die Pflicht", () => {
    const md = { "docs/a.md": "# a\n" };
    expect(pruefe(md, nach(PL, "doku")).fehler).toEqual([]);
    expect(pruefe(md, nach(PL, "kombiniert")).fehler.join()).toMatch(/lenses fehlt doku/);
  });
  test("voll (4 Dateien): kombiniert, skizze und ohne — klein sind rot", () => {
    const gross = { "src/a.ts": "1\n", "src/b.ts": "1\n", "src/c.ts": "1\n", "src/d.ts": "1\n" };
    const f = pruefe(gross, nach(`${PL} — skizze`, "kombiniert")).fehler.join("\n");
    expect(f).toMatch(/lenses fehlt .*kombiniert genügt nur bei Größenstufe S/);
    expect(f).toMatch(/"skizze" gilt nur bei Größenstufe S/);
    expect(pruefe(gross, nach("ohne — klein: x", DREI)).fehler.join()).toMatch(/"ohne — klein" gilt nur bei Größenstufe S/);
    expect(pruefe(gross, nach(PL, DREI)).fehler).toEqual([]);
  });
  test("K5 Ende-zu-Ende: eine Zeile in einem Gate- oder Agenten-Pfad ist voll, kombiniert und skizze sind rot", () => {
    for (const pfad of ["scripts/check-x.mjs", ".claude/agents/x.md", ".github/workflows/x.yml", "AGENTS.md"]) {
      const f = pruefe({ [pfad]: "x\n" }, nach(`${PL} — skizze`, "kombiniert")).fehler.join("\n");
      expect(f, pfad).toMatch(/gilt nur bei Größenstufe S/);
      expect(f, pfad).toMatch(/kombiniert genügt nur bei Größenstufe S/);
    }
  });
  test("eine ungültige Plan-Zeile nennt die Skizze als erlaubte Form", () => {
    expect(pruefe(KLEIN, nach("murks", DREI)).fehler.join()).toMatch(/ungültig: "murks" \(erlaubt: .*— skizze/);
  });
  test("klein ohne Begründung ist auch bei S rot; ein anderer Grund bleibt bei voll grün", () => {
    expect(pruefe(KLEIN, nach("ohne — klein", "kombiniert")).fehler.join()).toMatch(/braucht eine Begründung/);
    expect(pruefe({ "scripts/x.mjs": "x\n" }, nach("ohne — Revert eines PR", DREI)).fehler).toEqual([]);
  });
  test("K4: wächst der Diff nach einem S-Nachweis, wird der Nachweis rot", () => {
    const { git, base } = repo(KLEIN, nach(`${PL} — skizze`, "kombiniert"));
    const r = (reviewRaw as { checkReviewNachweis: (o: unknown) => { ok: boolean; fehler: string[] } }).checkReviewNachweis;
    expect(r({ runGit: git, env: { FACTORY_DIFF_BASE: base }, ladeZeilen: () => Z }).ok).toBe(true);
    // gleicher Nachweis, aber 4 Dateien im Diff: die Stufe wird neu berechnet
    const { git: git2, base: base2 } = repo({ ...KLEIN, "src/b.ts": "1\n", "src/c.ts": "1\n", "src/d.ts": "1\n" }, nach(`${PL} — skizze`, "kombiniert"));
    expect(r({ runGit: git2, env: { FACTORY_DIFF_BASE: base2 }, ladeZeilen: () => Z }).ok).toBe(false);
  });
});

describe("check-abnahme-nachweis: entfaellt — klein nur bei berechnetem S (K3)", () => {
  const CONFIG = { repo: FREMD.repo, praefixe: { commitZeile: FREMD.praefixe.commitZeile }, agenten: { planer: PL }, sprache: echteSprache() };
  const AK = "## Akzeptanzkriterien\n1. eins\n2. zwei\n";
  const pruefe = (aenderungen: Record<string, string>, abnahme: string, body = AK) => {
    const { git, base } = repo(aenderungen, `${Z.plan}: ${PL}\n${Z.review}: head=<HEAD> runden=1 lenses=kombiniert verdikt=ok\n${Z.abnahme}: ${abnahme}`);
    return (abnahmeRaw as { checkAbnahmeNachweis: (o: unknown) => { ok: boolean; fehler: string[] } }).checkAbnahmeNachweis({
      runGit: git,
      gh: () => ({ body }),
      env: { FACTORY_DIFF_BASE: base, FACTORY_PR_BODY: "Closes #9" },
      ladeConfig: () => CONFIG,
    });
  };
  const KLEIN = { "docs/a.md": "# a\n" };

  test("S: entfaellt — klein: <Begründung> ist mit Kriterien grün", () => {
    expect(pruefe(KLEIN, "entfaellt — klein: nichts zu beobachten").fehler).toEqual([]);
  });
  test("voll: dieselbe Zeile ist mit Kriterien rot (Gate-Pfad mit einer Zeile, Diff über der Grenze)", () => {
    expect(pruefe({ "scripts/check-x.mjs": "x\n" }, "entfaellt — klein: nichts zu beobachten").fehler.join()).toMatch(/nicht erlaubt.*nur bei Größenstufe S.*voll/);
    expect(pruefe({ "docs/a.md": "x\n".repeat(61) }, "entfaellt — klein: nichts zu beobachten").ok).toBe(false);
  });
  test("S: ein anderer entfaellt-Grund und klein ohne Begründung bleiben mit Kriterien rot", () => {
    const f = pruefe(KLEIN, "entfaellt — nicht nötig").fehler.join();
    expect(f).toMatch(/nicht erlaubt/);
    expect(f).not.toMatch(/Ausnahme/);
    expect(pruefe(KLEIN, "entfaellt — klein").fehler.join()).toMatch(/Ausnahme.*mit Begründung/);
    expect(pruefe(KLEIN, "entfaellt — klein").ok).toBe(false);
  });
  test("ohne Kriterien bleibt entfaellt bei jeder Stufe grün", () => {
    expect(pruefe({ "scripts/check-x.mjs": "x\n" }, "entfaellt — kein Kriterium", "kein Kriterium hier").fehler).toEqual([]);
  });
});

describe("Nachweis-Wächter: Bestandsverhalten ohne Stufe (Default voll)", () => {
  test("bewerteAbnahme ohne stufe lässt entfaellt — klein bei einem Ticket mit Kriterien nicht durch", () => {
    const nachweis = nl.parseNachweis(`${Z.abnahme}: entfaellt — klein: x`, Z);
    const f = (abnahmeRaw as { bewerteAbnahme: (o: unknown) => string[] }).bewerteAbnahme({
      nachweis,
      ticket: { nr: 9, kriterien: [{ k: "K1", text: "a" }, { k: "K2", text: "b" }] },
      marker: null,
      abnahmeHead: null,
      zeilen: Z,
    });
    expect(f.join()).toMatch(/nicht erlaubt/);
  });
  test("die Meldung nennt den Kombi-Hinweis nur, wenn kombiniert im Satz steht", () => {
    const nachweis = nl.parseNachweis(`${Z.plan}: ${PL}\n${Z.review}: head=${"a".repeat(40)} runden=1 lenses=architektur verdikt=ok`, Z);
    const f = (reviewRaw as { bewerteNachweis: (o: unknown) => string[] }).bewerteNachweis({ nachweis, dateien: ["src/x.ts"], headBekannt: true, headImSlice: true, zeilen: Z });
    expect(f.join()).toMatch(/lenses fehlt/);
    expect(f.join()).not.toMatch(/kombiniert genügt/);
  });
  test("bewerteNachweis ohne stufe behandelt kombiniert wie einen fehlenden Code-Satz", () => {
    const nachweis = nl.parseNachweis(`${Z.plan}: ${PL}\n${Z.review}: head=${"a".repeat(40)} runden=1 lenses=kombiniert verdikt=ok`, Z);
    const f = (reviewRaw as { bewerteNachweis: (o: unknown) => string[] }).bewerteNachweis({ nachweis, dateien: ["src/x.ts"], headBekannt: true, headImSlice: true, zeilen: Z });
    expect(f.join()).toMatch(/lenses fehlt/);
  });
});

describe("Sweep-Tiefe (factory#272)", () => {
  const std = lib.risikoMusterAus({});
  const tiefe = (pfade: unknown, risiko: unknown = std) => lib.bestimmeSweeptiefe(pfade, risiko).tiefe;
  test("Negativfälle: Guard-, Parser-, Gate-Code und Konfiguration bleiben voll", () => {
    expect(tiefe(["scripts/parse-zeilen.mjs", "test/parse-zeilen.test.ts"])).toBe("voll");
    expect(tiefe(["scripts/x-guard.mjs", "docs/a.md"])).toBe("voll");
    expect(tiefe([".github/workflows/ci.yml"])).toBe("voll");
    expect(tiefe(["test/support/liste.ts", "test/harness/a.test.ts"])).toBe("voll");
    expect(tiefe(["test/harness/verbleib-liste.json", "docs/a.md"])).toBe("voll");
    expect(lib.bestimmeSweeptiefe(["scripts/x.mjs"], std).gruende).toEqual(["scripts/x.mjs ist Code oder Konfiguration"]);
  });
  test("Risikoklasse hoch hat Vorrang vor Doku und Testdatei", () => {
    expect(tiefe(["docs/a.md", "test/harness/session-x.test.ts"])).toBe("voll");
  });
  test("fail-closed: leere, fehlende, leere oder quotierte Pfade und fehlende Risiko-Muster sind voll", () => {
    for (const p of [[], null, [""], ['"q"']]) expect(tiefe(p)).toBe("voll");
    expect(tiefe(["test/x.test.ts"], { muster: null, quelle: "Projekt-Config", fehler: ["kaputt"] })).toBe("voll");
  });
  test("Positiv: nur Doku und Testdateien, Risikoklasse nicht hoch, ist stichprobe", () => {
    expect(tiefe(["docs/a.md", ".agents/skills/x/SKILL.md", "test/harness/x.test.ts"])).toBe("stichprobe");
    expect(tiefe(["docs/a.md"])).toBe("stichprobe");
  });
  test("ein Treffer in einer injizierten Projekt-Risikoliste macht voll", () => {
    const eigen = lib.risikoMusterAus({ risiko: { hoch: ["*billing*"] } });
    expect(tiefe(["test/billing.test.ts", "docs/a.md"], eigen)).toBe("voll");
    expect(tiefe(["test/billing.test.ts", "docs/a.md"])).toBe("stichprobe");
  });
  test("TESTDATEI: nur *.test.* und *.spec.* mit js/ts-Endung (auch mjs, cts) zählen, alles andere ist voll", () => {
    for (const p of ["test/a.test.ts", "test/a.spec.js", "test/a.test.mjs", "test/a.spec.cts"]) expect(tiefe([p]), p).toBe("stichprobe");
    for (const p of ["test/a.test.ts.bak", "test/atest.ts", "test/a.tests.ts", "test/a.test.tsx", "test/a.test-ts", "test/a.test.json", "test/a.test"]) expect(tiefe([p]), p).toBe("voll");
  });
  test("die injizierte Risikoliste wirkt über bestimmeGroessenstufe und die CLI (Verdrahtung, kein Default)", () => {
    const eigen = lib.risikoMusterAus({ risiko: { hoch: ["*billing*"] } });
    const o = { git: () => "b".repeat(40), ladeMuster: () => MUSTER, env: { FACTORY_DIFF_BASE: "b".repeat(40) } };
    const pfade = ["--pfade", "test/billing.test.ts", "docs/a.md"];
    expect(cli.laufe(pfade, { ...o, ladeRisiko: () => eigen }).ausgabe).toMatch(/\nSWEEP: voll — /);
    expect(cli.laufe(pfade, { ...o, ladeRisiko: () => lib.risikoMusterAus({}) }).ausgabe).toMatch(/\nSWEEP: stichprobe — /);
    const e = [eins("test/billing.test.ts"), eins("docs/a.md")];
    expect(lib.bestimmeGroessenstufe({ eintraege: e, muster: MUSTER, risiko: eigen } as never)).toMatchObject({ sweep: { tiefe: "voll" } });
  });
  test("bestimmeGroessenstufe trägt sweep, auch bei Eintrag null oder ohne Liste", () => {
    expect(lib.bestimmeGroessenstufe({ eintraege: null, muster: MUSTER })).toMatchObject({ sweep: { tiefe: "voll" } });
    expect(stufe([null as unknown as Eintrag])).toMatchObject({ sweep: { tiefe: "voll" } });
  });
  test("bestimmeGroessenstufe: der Sweep hängt nicht von der Schutzliste ab (leere Liste: Stufe voll, Sweep nach den Pfaden)", () => {
    expect(stufe([eins("docs/x.md")])).toMatchObject({ sweep: { tiefe: "stichprobe" } });
    expect(stufe([eins("docs/x.md")], null)).toMatchObject({ sweep: { tiefe: "stichprobe" } });
    expect(stufe([])).toMatchObject({ sweep: { tiefe: "voll" } });
  });
  test("groessenstufeAusGit: Schutzliste nicht ladbar und git-Fehler tragen sweep voll", () => {
    const wirft = () => {
      throw new Error("kaputt");
    };
    expect(lib.groessenstufeAusGit(() => "1\t0\tdocs/a.md\n", "b", "HEAD", { ladeMuster: wirft })).toMatchObject({ sweep: { tiefe: "voll" } });
    expect(lib.groessenstufeAusGit(wirft, "b", "HEAD", { ladeMuster: () => MUSTER })).toMatchObject({ sweep: { tiefe: "voll" } });
  });
  test("CLI: dritte Zeile SWEEP, JSON-Feld sweep, fail-closed-Zweige voll", () => {
    const o = { git: () => "b".repeat(40), ladeMuster: () => MUSTER, env: { FACTORY_DIFF_BASE: "b".repeat(40) } };
    expect(cli.laufe(["--pfade", "scripts/x.mjs", "test/x.test.ts"], o).ausgabe).toMatch(/\nSWEEP: voll — scripts\/x\.mjs ist Code oder Konfiguration$/);
    expect(JSON.parse(cli.laufe(["--pfade", "docs/x.md", "--json"], o).ausgabe)).toMatchObject({ sweep: { tiefe: "stichprobe" } });
    const wirft = () => {
      throw new Error("kaputt");
    };
    expect(cli.laufe(["--pfade", "docs/a.md"], { ...o, ladeMuster: wirft }).ausgabe).toMatch(/\nSWEEP: voll — Schutzliste nicht ladbar/);
    expect(cli.laufe([], { ...o, git: () => "", env: {} }).ausgabe).toMatch(/\nSWEEP: voll — keine Vergleichs-Basis/);
    expect((cliRaw as unknown as { sweepZeile: (e: object) => string }).sweepZeile({})).toBe("SWEEP: voll — nicht berechnet");
  });
});
