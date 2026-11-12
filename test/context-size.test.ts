/* Kontextdatei-Wächter (#719, jede AGENTS.md seit #1088) – Frühwarnung gegen eine unbegrenzt wachsende
 * AGENTS.md. Analog zu test/filesize.test.ts (#390), aber für die Datei(en), die JEDE
 * Agenten-Session vollständig lädt statt für src/-Module.
 *
 * Die Mess-/Allowlist-Logik wird aus scripts/check-context-size.mjs importiert – EINE
 * Quelle der Wahrheit (kein Auseinanderdriften zwischen Test und CLI).
 *
 * Ausführen mit:  npm test   (oder gezielt: npm run check:contextsize)
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { kopiereScripts } from "./support/scripts-kopie";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Reines Node-Tooling-Skript ohne Declaration-File (allowJs ist aus, scripts/ nicht im
// tsconfig-include) – der Laufzeit-Import genügt, die Typen deklarieren wir hier lokal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkContextSize from "../scripts/check-context-size.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as budgetLib from "../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as pcl from "../scripts/projekt-config-lib.mjs";

type Budget = { file: string; budget: number };
type Sized = { file: string; chars: number; budget: number };
type Allow = { datei: string; grund: string };

const CONTEXT_BUDGETS: Budget[] = budgetLib.CONTEXT_BUDGETS;
const ALLOWLIST: Allow[] = (pcl as unknown as { ausnahmenAus(c: unknown): { kontext: Allow[] }; ladeProjektConfig(): unknown }).ausnahmenAus((pcl as unknown as { ladeProjektConfig(): unknown }).ladeProjektConfig()).kontext;
const collectContextSizes: (rootDir?: string, budgets?: Budget[], moduleBudget?: number) => Sized[] = checkContextSize.collectContextSizes;
const findOversized: (sizes: Sized[]) => Sized[] = checkContextSize.findOversized;
// Neu mit #1064: sichtbarer Inline-Disable statt die Bulk-Baseline (Gate-Config) anzuheben,
// gleiches Muster wie test/harness/agents-md-native.test.ts.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const countChars: (text: string) => number = budgetLib.countChars;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const findStale: (sizes: Sized[], allowlist: Allow[]) => Allow[] = checkContextSize.findStale;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const MODULE_AGENTS_BUDGET: number = checkContextSize.MODULE_AGENTS_BUDGET;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const collectAgentsFiles: (rootDir?: string) => string[] = checkContextSize.collectAgentsFiles;

/** Legt Dateien (repo-relativer POSIX-Pfad → Inhalt) in einem Temp-Repo an. */
function withTempRepo(files: Record<string, string>, fn: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "contextsize-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, ...rel.split("/"));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const WURZEL = join(import.meta.dirname, "..");
const sizes = collectContextSizes();
const allowedFiles = new Set(ALLOWLIST.map((a) => a.datei));

describe("Root-Kontextdatei-Budget (#719, Zeichen seit #1064)", () => {
  test("kein Root-Kontextfile über seinem Zeichen-Budget (außer dokumentierten Ausnahmen)", () => {
    const violations = findOversized(sizes).filter((s) => !allowedFiles.has(s.file));
    assert.deepEqual(
      violations,
      [],
      `Root-Kontextdateien über Budget ohne Allowlist-Eintrag:\n` +
        violations.map((v) => `  ${v.file}: ${v.chars}/${v.budget}`).join("\n") +
        `\nInhalt auslagern (modul-lokale AGENTS.md / docs/module/*.md) oder – mit offenem Ticket – ` +
        `unter ausnahmen.kontext in .factory/projekt.json aufnehmen.`,
    );
  });

  test("Allowlist ist ehrlich: jeder Eintrag liegt wirklich noch über seinem Budget (sonst stale)", () => {
    // Sobald eine Auslagerung die Datei unter ihr Budget bringt, wird der Eintrag stale
    // und dieser Test bricht – das erinnert daran, die Ausnahme wieder zu entfernen.
    const stale = findStale(sizes, ALLOWLIST);
    assert.deepEqual(
      stale,
      [],
      `Stale Allowlist-Einträge (Datei nicht mehr über Budget oder unbekannt) – aus ` +
        `scripts/check-context-size.mjs entfernen:\n` +
        stale.map((a) => `  ${a.datei}`).join("\n"),
    );
  });

  test("jede konfigurierte Root-Kontextdatei existiert wirklich und wird gemessen", () => {
    for (const b of CONTEXT_BUDGETS) {
      const s = sizes.find((x) => x.file === b.file);
      assert.ok(s && s.chars > 0, `${b.file} sollte existieren und nicht leer sein`);
    }
  });

  test("Detektion greift wirklich (Red-Green): Budget 1 trifft jede Datei, Budget riesig keine", () => {
    // No-op-Schutz: ein Wächter, der immer grün ist, wäre wertlos.
    const tinyBudgets = CONTEXT_BUDGETS.map((b) => ({ ...b, budget: 1 }));
    const hugeBudgets = CONTEXT_BUDGETS.map((b) => ({ ...b, budget: 1_000_000 }));
    const tiny = findOversized(collectContextSizes(undefined, tinyBudgets, 1)).length;
    const huge = findOversized(collectContextSizes(undefined, hugeBudgets, 1_000_000)).length;
    assert.equal(tiny, sizes.length, "Budget 1 sollte für jede gemessene Datei einen Treffer liefern.");
    assert.equal(huge, 0, "Ein riesiges Budget sollte nichts melden.");
  });

  test("Zuwachs INNERHALB bestehender Zeilen schlägt an (#1061/#1064 – die Lücke der alten Zeilen-Metrik)", () => {
    // Genau der Fall, den das Zeilen-Budget nicht sah: gleiche Zeilenzahl, 5.000 Zeichen mehr.
    const dir = mkdtempSync(join(tmpdir(), "contextsize-"));
    try {
      const lines = Array.from({ length: 10 }, (_, i) => `- Regel ${i}: kurz.`);
      writeFileSync(join(dir, "AGENTS.md"), lines.join("\n"));
      const [before] = collectContextSizes(dir, [{ file: "AGENTS.md", budget: 0 }]);
      const budgets = [{ file: "AGENTS.md", budget: before.chars + 1_000 }];
      assert.deepEqual(findOversized(collectContextSizes(dir, budgets)), [], "Ausgangsstand liegt im Budget.");

      lines[3] += " " + "x".repeat(5_000);
      writeFileSync(join(dir, "AGENTS.md"), lines.join("\n"));
      const grown = findOversized(collectContextSizes(dir, budgets));
      assert.equal(grown.length, 1, "5.000 Zeichen Zuwachs in einer bestehenden Zeile muss rot werden.");
      assert.equal(grown[0].chars, before.chars + 5_001);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Grenze exakt: Budget == Zeichen ist grün, eins weniger ist rot", () => {
    const at: Sized[] = [{ file: "AGENTS.md", chars: 100, budget: 100 }];
    const over: Sized[] = [{ file: "AGENTS.md", chars: 100, budget: 99 }];
    assert.deepEqual(findOversized(at), []);
    assert.equal(findOversized(over).length, 1);
  });

  test("Stale-Erkennung (Red-Green): Eintrag für Datei im Budget oder ohne Messung ist stale, über Budget nicht", () => {
    const sized: Sized[] = [
      { file: "AGENTS.md", chars: 500, budget: 100 },
      { file: "CLAUDE.md", chars: 50, budget: 100 },
    ];
    const allow: Allow[] = [
      { datei: "AGENTS.md", grund: "#1 Auslagerung offen" },
      { datei: "CLAUDE.md", grund: "#2 längst erledigt" },
      { datei: "GIBTS-NICHT.md", grund: "#3 Tippfehler" },
    ];
    assert.deepEqual(
      findStale(sized, allow).map((a) => a.datei),
      ["CLAUDE.md", "GIBTS-NICHT.md"],
    );
  });

  test("Zählung ist zeilenenden-neutral: CRLF-Checkout (Windows/autocrlf) misst wie LF auf der CI", () => {
    const lf = ["a", "bb", "ccc"].join(String.fromCharCode(10));
    const crlf = ["a", "bb", "ccc"].join(String.fromCharCode(13, 10));
    assert.equal(countChars(crlf), countChars(lf));
    assert.equal(countChars(lf), lf.length);
  });
});

describe("Modul-lokale AGENTS.md im Budget (#1088)", () => {
  test("expliziter Eintrag gewinnt über das Default-Budget (Wurzel bleibt bei ihrem eigenen Budget)", () => {
    const root = sizes.find((x) => x.file === "AGENTS.md");
    const configured = CONTEXT_BUDGETS.find((b) => b.file === "AGENTS.md");
    assert.ok(root && configured);
    assert.equal(root.budget, configured.budget);
    assert.notEqual(root.budget, MODULE_AGENTS_BUDGET);
  });

  test("Walk findet verschachtelte AGENTS.md, sortiert + POSIX-Pfade, und ignoriert Builds/Deps/Worktrees", () => {
    withTempRepo(
      {
        "AGENTS.md": "wurzel",
        "src/b/AGENTS.md": "b",
        "src/a/tief/AGENTS.md": "a",
        "src/a/NOTAGENTS.md": "kein Treffer: anderer Name",
        "node_modules/pkg/AGENTS.md": "fremd",
        ".git/AGENTS.md": "intern",
        "dist/AGENTS.md": "Build",
        ".claude/worktrees/wt-1/AGENTS.md": "Repo-Kopie eines Parallel-Agenten",
        ".claude/AGENTS.md": "lose, unversioniert",
        ".claude/skills/x/AGENTS.md": "versioniert",
      },
      (dir) => {
        assert.deepEqual(collectAgentsFiles(dir), [
          ".claude/skills/x/AGENTS.md",
          "AGENTS.md",
          "src/a/tief/AGENTS.md",
          "src/b/AGENTS.md",
        ]);
      },
    );
  });

  test("Red-Green: ein um 5.000 Zeichen gewachsenes Modul-Doc wird rot, das Wurzel-Budget bleibt unberührt", () => {
    withTempRepo({ "AGENTS.md": "kurz", "src/x/AGENTS.md": "y".repeat(100) }, (dir) => {
      const budgets = [{ file: "AGENTS.md", budget: 1_000 }];
      assert.deepEqual(findOversized(collectContextSizes(dir, budgets, 100)), [], "Grenze exakt: == Budget ist grün.");
      writeFileSync(join(dir, "src", "x", "AGENTS.md"), "y".repeat(5_100));
      const over = findOversized(collectContextSizes(dir, budgets, 100));
      assert.deepEqual(over, [{ file: "src/x/AGENTS.md", chars: 5_100, budget: 100 }]);
    });
  });

  test("Ausgabe ist über konfigurierte und gefundene Dateien hinweg sortiert", () => {
    withTempRepo({ "AGENTS.md": "wurzel", ".claude/skills/x/AGENTS.md": "skill" }, (dir) => {
      const got = collectContextSizes(dir, [{ file: "AGENTS.md", budget: 100 }], 100).map((s) => s.file);
      assert.deepEqual(got, [".claude/skills/x/AGENTS.md", "AGENTS.md"]);
    });
  });

  test("konfigurierte, aber fehlende Datei wird trotzdem gemeldet (0 Zeichen) statt still zu verschwinden", () => {
    withTempRepo({ "src/x/AGENTS.md": "modul" }, (dir) => {
      const got = collectContextSizes(dir, [{ file: "AGENTS.md", budget: 10 }], 100);
      assert.deepEqual(got, [
        { file: "AGENTS.md", chars: 0, budget: 10 },
        { file: "src/x/AGENTS.md", chars: 5, budget: 100 },
      ]);
    });
  });

  test("Allowlist-Eintrag für eine Modul-Datei im Budget ist stale, über Budget nicht", () => {
    const sized: Sized[] = [
      { file: "src/a/AGENTS.md", chars: 50, budget: 100 },
      { file: "src/b/AGENTS.md", chars: 500, budget: 100 },
    ];
    const allow: Allow[] = [
      { datei: "src/a/AGENTS.md", grund: "#1 erledigt" },
      { datei: "src/b/AGENTS.md", grund: "#2 Auslagerung offen" },
    ];
    assert.deepEqual(findStale(sized, allow).map((a) => a.datei), ["src/a/AGENTS.md"]);
  });
});

// ── Ladekette je Blatt-AGENTS.md (factory#33) ────────────────────────────────
type Kette = { blatt: string; kette: string[]; chars: number };
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const ladeketten: (s: Sized[]) => Kette[] = checkContextSize.ladeketten;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const ladekettenZeilen: (k: Kette[]) => string[] = checkContextSize.ladekettenZeilen;

const groesse = (file: string, chars: number): Sized => ({ file, chars, budget: 1 });

describe("Ladekette je Blatt-AGENTS.md (factory#33)", () => {
  test("T1: Kette = Wurzel + Vorfahren + Blatt, absteigend nach Summe; Wurzel und Zwischenebene sind keine Blätter", () => {
    const ketten = ladeketten([
      groesse("AGENTS.md", 100), groesse("src/AGENTS.md", 50), groesse("src/a/AGENTS.md", 20),
      groesse("src/b/AGENTS.md", 30), groesse("docs/AGENTS.md", 10), groesse("README.md", 999), groesse(".agents/skills/x/SKILL.md", 999), groesse("foo/XAGENTS.md", 999),
    ]);
    assert.deepEqual(ketten, [
      { blatt: "src/b", kette: ["AGENTS.md", "src/AGENTS.md", "src/b/AGENTS.md"], chars: 180 },
      { blatt: "src/a", kette: ["AGENTS.md", "src/AGENTS.md", "src/a/AGENTS.md"], chars: 170 },
      { blatt: "docs", kette: ["AGENTS.md", "docs/AGENTS.md"], chars: 110 },
    ]);
  });

  test("T2: Präfix-Falle: src/a ist kein Vorfahr von src/ab", () => {
    const ketten = ladeketten([groesse("AGENTS.md", 10), groesse("src/a/AGENTS.md", 5), groesse("src/ab/AGENTS.md", 7)]);
    assert.deepEqual(ketten.map((k) => k.blatt).sort(), ["src/a", "src/ab"]);
    const ab = ketten.find((k) => k.blatt === "src/ab");
    assert.deepEqual(ab, { blatt: "src/ab", kette: ["AGENTS.md", "src/ab/AGENTS.md"], chars: 17 });
  });

  test("T1b: Eingabe in Code-Unit-Ordnung (tiefere Datei vor ihrem Vorfahren): Kette läuft trotzdem von der Wurzel zum Blatt", () => {
    const ketten = ladeketten([groesse("ADR/AGENTS.md", 1), groesse("AGENTS.md", 1), groesse("src/0/AGENTS.md", 1), groesse("src/AGENTS.md", 1)]);
    assert.deepEqual(ketten.find((k) => k.blatt === "src/0")?.kette, ["AGENTS.md", "src/AGENTS.md", "src/0/AGENTS.md"]);
    assert.deepEqual(ketten.find((k) => k.blatt === "ADR")?.kette, ["AGENTS.md", "ADR/AGENTS.md"]);
  });

  test("T3: nur Wurzel: genau eine Kette; Wurzel mit 0 Zeichen bleibt Glied", () => {
    assert.deepEqual(ladeketten([groesse("AGENTS.md", 0)]), [{ blatt: "", kette: ["AGENTS.md"], chars: 0 }]);
    assert.deepEqual(ladeketten([]), []);
  });

  test("T4: Zeilen: Suffix an jeder Höchstsumme, Format, kein npm run", () => {
    const zeilen = ladekettenZeilen(ladeketten([groesse("AGENTS.md", 1000), groesse("b/AGENTS.md", 234), groesse("a/AGENTS.md", 234), groesse("c/AGENTS.md", 5)]));
    assert.equal(zeilen.length, 3);
    assert.match(zeilen[0] ?? "", /Ladekette a: 1\.234 Zeichen .*= AGENTS\.md \+ a\/AGENTS\.md ← längste Ladekette, kein Gate$/);
    assert.match(zeilen[1] ?? "", /Ladekette b: 1\.234 .*← längste Ladekette, kein Gate$/);
    assert.doesNotMatch(zeilen[2] ?? "", /längste/);
    assert.doesNotMatch(zeilen.join("\n"), /npm run/);
    assert.deepEqual(ladekettenZeilen([]), []);
    assert.match(ladekettenZeilen(ladeketten([groesse("AGENTS.md", 5)]))[0] ?? "", /Ladekette AGENTS\.md: 5 Zeichen/);
  });

  test("T5: Walk: node_modules und Worktrees zählen nicht", () => {
    withTempRepo({
      "AGENTS.md": "a".repeat(10), "src/AGENTS.md": "b".repeat(5), "src/x/AGENTS.md": "c".repeat(2),
      "node_modules/x/AGENTS.md": "d".repeat(99), ".claude/worktrees/w/AGENTS.md": "e".repeat(99),
    }, (dir) => {
      const ketten = ladeketten(collectContextSizes(dir, [{ file: "AGENTS.md", budget: 100 }], 100));
      assert.deepEqual(ketten.map((k) => [k.blatt, k.chars]), [["src/x", 17]]);
    });
  });

  test("T6: CLI: lange Kette lässt check:contextsize nicht rot werden (AK2), Einzelbudget schon", { timeout: 60_000 }, () => {
    withTempRepo({
      "AGENTS.md": "x".repeat(20_000), "src/AGENTS.md": "x".repeat(11_000), "src/a/AGENTS.md": "x".repeat(11_000),
      ".factory/projekt.json": readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8"),
    }, (dir) => {
      kopiereScripts(dir);
      const lauf = () => {
        const r = spawnSync(process.execPath, [join(dir, "scripts", "check-context-size.mjs")], { encoding: "utf8", cwd: dir, timeout: 30_000 });
        return { status: r.status, text: `${r.stderr}${r.stdout}` };
      };
      const ok = lauf();
      assert.equal(ok.status, 0, ok.text);
      assert.match(ok.text, /Ladekette src\/a: 42\.000 Zeichen/);
      assert.match(ok.text, /längste/);
      writeFileSync(join(dir, "src/a/AGENTS.md"), "x".repeat(12_001));
      const rot = lauf();
      assert.equal(rot.status, 1, rot.text);
      assert.match(rot.text, /✖ src\/a\/AGENTS\.md/);
    });
  });
});
