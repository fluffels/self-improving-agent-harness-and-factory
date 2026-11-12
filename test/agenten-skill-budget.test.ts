/* Budget je Agenten- und Skill-Datei (factory#307): Mechanik (Messung ohne Projektwerte, Collector, Default für Dateien ohne Eintrag; der Default ist das größte Budget der Liste, ein Bezieher mit größerer eigener Datei kürzt oder trägt ausnahmen.kontext ein), der Bezieher-Fall
 * mit verlängerter Projektwerte-Tabelle und die Fabrik-Invarianten (Manifest-Abgleich, Nachzieh-Ratchet). Der Ratchet gegen die Merge-Base steht in
 * test/harness/kontext-budget-ratchet.test.ts. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { kopiereScripts } from "./support/scripts-kopie";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { AGENTEN_SKILL_BUDGETS as rawBudgets, AGENTEN_SKILL_DEFAULT_BUDGET as rawDefault } from "../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { collectAgentSkillFiles as rawFiles, collectAgentSkillSizes as rawSizes, findOversized as rawOversized, fixHinweis as rawFix } from "../scripts/check-context-size.mjs";

type Eintrag = { file: string; budget: number };
type Groesse = { file: string; chars: number; budget: number };
const AGENTEN_SKILL_BUDGETS = rawBudgets as Eintrag[];
const DEFAULT = rawDefault as number;
const collectFiles = rawFiles as (wurzel: string) => string[];
const collectSizes = rawSizes as (wurzel: string, budgets?: Eintrag[], standard?: number) => Groesse[];
const findOversized = rawOversized as (sizes: Groesse[]) => Groesse[];
const fixHinweis = rawFix as (violations: { file: string }[]) => string;

const WURZEL = join(import.meta.dirname, "..");
const START = "<!-- factory:projektwerte:start -->";
const ENDE = "<!-- factory:projektwerte:end -->";

const temp = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), "agentenbudget-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const datei = (dir: string, rel: string, inhalt: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), inhalt);
};
/** Verlängert den Projektwerte-Block einer Datei um `n` Zeichen (eine Tabelle mit vielen Zeilen im Bezieher). */
const verlaengert = (text: string, n: number): string => text.replace(ENDE, `${"| `x` | `y` |\n".repeat(Math.ceil(n / 14))}${ENDE}`);

describe("collectAgentSkillFiles und collectAgentSkillSizes", () => {
  test("erfasst Agenten (nur oberste Ebene) und alle Skill-Dateien rekursiv, ohne AGENTS.md; fehlende Ordner geben eine leere Liste", () => {
    temp((dir) => {
      assert.deepEqual(collectFiles(dir), []);
      datei(dir, ".claude/agents/a.md", "x");
      datei(dir, ".claude/agents/unter/b.md", "x");
      datei(dir, ".claude/agents/c.txt", "x");
      datei(dir, ".claude/agents/ordner.md/x.txt", "x"); // ein Ordner namens *.md ist keine Datei
      datei(dir, ".agents/skills/s/SKILL.md", "x");
      datei(dir, ".agents/skills/s/tief/zusatz.md", "x");
      datei(dir, ".agents/skills/s/AGENTS.md", "x");
      datei(dir, ".agents/skills/s/skript.mjs", "x");
      assert.deepEqual(collectFiles(dir), [".agents/skills/s/SKILL.md", ".agents/skills/s/tief/zusatz.md", ".claude/agents/a.md"]);
    });
  });

  test("Dateien ohne Eintrag bekommen den Default; Grenzfall: genau Default grün, Default + 1 rot", () => {
    temp((dir) => {
      datei(dir, ".claude/agents/proj-eigen.md", "x".repeat(DEFAULT));
      datei(dir, ".agents/skills/proj/SKILL.md", "x".repeat(DEFAULT + 1));
      datei(dir, ".agents/skills/proj/tief/zusatz.md", "x");
      const sizes = collectSizes(dir);
      assert.deepEqual(sizes.map((s) => s.budget), [DEFAULT, DEFAULT, DEFAULT]);
      assert.deepEqual(findOversized(sizes).map((s) => s.file), [".agents/skills/proj/SKILL.md"]);
    });
  });

  test("ein Eintrag gewinnt über den Default; ein Eintrag ohne Datei wird nicht gemeldet (nicht mit 0)", () => {
    temp((dir) => {
      datei(dir, ".claude/agents/a.md", "x".repeat(11));
      const sizes = collectSizes(dir, [{ file: ".claude/agents/a.md", budget: 10 }, { file: ".claude/agents/fehlt.md", budget: 1 }], 99);
      assert.deepEqual(sizes, [{ file: ".claude/agents/a.md", chars: 11, budget: 10 }]);
      assert.equal(findOversized(sizes).length, 1);
    });
  });

  test("die Messung ignoriert den Projektwerte-Block (mit countChars statt ohneProjektwerte wären die echten Dateien rot)", () => {
    temp((dir) => {
      datei(dir, ".claude/agents/a.md", `kopf\n${START}\n${"| x |\n".repeat(50_000)}${ENDE}\nrest`);
      assert.deepEqual(collectSizes(dir).map((s) => s.chars), ["kopf\nrest".length]);
    });
  });
});

describe("fixHinweis (L4): Fix-Zeile je Art der Verletzung", () => {
  const agent = { file: ".claude/agents/x.md" };
  const skill = { file: ".agents/skills/s/tief/zusatz.md" };
  const agents = { file: "docs/AGENTS.md" };

  test("Agenten-/Skill-Verletzung: kürzen oder in bedingte Zusatzdatei/Brain-Seite auslagern, Ratchet und Ausnahme mit Ticket, keine modul-lokale AGENTS.md", () => {
    for (const v of [agent, skill]) {
      const t = fixHinweis([v]);
      assert.match(t, /kürzen/);
      assert.match(t, /\.agents\/skills\/<name>\//);
      assert.match(t, /Brain-Seite/);
      assert.match(t, /Ratchet/);
      assert.match(t, /ausnahmen\.kontext/);
      assert.match(t, /Ticket/);
      assert.doesNotMatch(t, /modul-lokale AGENTS\.md/);
    }
  });

  test("AGENTS.md-Verletzung: bisheriger Text (modul-lokale AGENTS.md, ausnahmen.kontext), kein Ratchet-Hinweis", () => {
    const t = fixHinweis([agents]);
    assert.match(t, /modul-lokale AGENTS\.md/);
    assert.match(t, /ausnahmen\.kontext/);
    assert.doesNotMatch(t, /Ratchet/);
  });

  test("AGENTS.md unter dem Skill-Verzeichnis und Pfade mit gleichem Präfix ohne Schrägstrich sind keine Agenten-/Skill-Dateien", () => {
    for (const file of [".agents/skills/s/AGENTS.md", ".agents/skillsX/s.md"]) {
      const t = fixHinweis([{ file }]);
      assert.match(t, /modul-lokale AGENTS\.md/);
      assert.doesNotMatch(t, /Ratchet/);
    }
  });

  test("L17: X-AGENTS.md unter .agents/skills zählt als Agenten-/Skill-Datei, genau AGENTS.md nicht (Dateinamen-Vergleich statt endsWith)", () => {
    const t = fixHinweis([{ file: ".agents/skills/proj/X-AGENTS.md" }]);
    assert.match(t, /Agenten-\/Skill-Datei: kürzen/);
    assert.doesNotMatch(t, /modul-lokale AGENTS\.md/);
    assert.match(fixHinweis([{ file: ".agents/skills/proj/AGENTS.md" }]), /modul-lokale AGENTS\.md/);
    temp((dir) => {
      datei(dir, ".agents/skills/proj/X-AGENTS.md", "x");
      datei(dir, ".agents/skills/proj/AGENTS.md", "x");
      assert.deepEqual(collectFiles(dir), [".agents/skills/proj/X-AGENTS.md"]);
    });
  });

  test("gemischt: beide Teile; ohne Verletzung leer", () => {
    const t = fixHinweis([agents, agent]);
    assert.match(t, /modul-lokale AGENTS\.md/);
    assert.match(t, /Ratchet/);
    assert.equal(fixHinweis([]), "");
  });
});

describe("Projektwert-Zeilen der Frontmatter (L3/L6b)", () => {
  const agent = (name: string, tabelle: string): string =>
    `---\n# factory:projektwert agenten.planer\nname: ${name}\n---\nrumpf\n${START}\n${tabelle}${ENDE}\nrest\n`;

  test("ein kurzer und ein langer name:-Wert samt unterschiedlich langem Block messen gleich (Fabrik = Bezieher, zeichengleich)", () => {
    temp((kurz) => {
      temp((lang) => {
        datei(kurz, ".claude/agents/planer.md", agent("a", "| x |\n"));
        datei(lang, ".claude/agents/planer.md", agent("ein-sehr-langer-projektname-planer", "| x |\n".repeat(40)));
        const chars = (d: string): number[] => collectSizes(d).map((s) => s.chars);
        assert.deepEqual(chars(lang), chars(kurz));
        assert.equal(chars(kurz)[0], `---\n# factory:projektwert agenten.planer\nname:\n---\nrumpf\nrest\n`.length);
      });
    });
  });

  test("ein kaputter Zeilen-Marker wirft (als Gate-Fehler)", () => {
    temp((dir) => {
      datei(dir, ".claude/agents/planer.md", `---\n# factory:projektwert agenten.planer\n---\nx\n`);
      assert.throws(() => collectSizes(dir), /planer\.md:2: .*Zeilen-Marker/);
    });
  });
});

describe("Bezieher: verlängerte Projektwerte-Tabelle und projekt-eigene Dateien", () => {
  /** Kopiert die echten Agenten- und Skill-Dateien der Fabrik, jeder Projektwerte-Block um 10.000 Zeichen verlängert. */
  const bezieherRepo = (dir: string): void => {
    for (const rel of AGENTEN_SKILL_BUDGETS.map((b) => b.file)) {
      datei(dir, rel, verlaengert(readFileSync(join(WURZEL, rel), "utf8"), 10_000));
    }
    datei(dir, ".claude/agents/proj-eigen.md", "eigener Agent\n");
    datei(dir, ".agents/skills/proj/SKILL.md", "eigener Skill\n");
    datei(dir, ".agents/skills/proj/tief/zusatz.md", "eigene Zusatzdatei\n");
  };

  test("kein Treffer über Budget, obwohl jede Datei um 10.000 Zeichen länger ist", () => {
    temp((dir) => {
      bezieherRepo(dir);
      const echte = AGENTEN_SKILL_BUDGETS.filter((b) => readFileSync(join(dir, b.file), "utf8").includes("<!-- factory:projektwerte:start -->"));
      assert.ok(echte.length >= 5, "mehrere Dateien tragen einen Projektwerte-Block (der Test wäre sonst vakuös)");
      for (const b of echte) assert.ok(readFileSync(join(dir, b.file), "utf8").length > readFileSync(join(WURZEL, b.file), "utf8").length + 9_000);
      assert.deepEqual(findOversized(collectSizes(dir)), []);
      assert.ok(collectSizes(dir).some((s) => s.file === ".agents/skills/proj/tief/zusatz.md" && s.budget === DEFAULT));
    });
  });

  test("CLI check-context-size: Exit 0 mit verlängerten Tabellen und eigenen Dateien (Bezieher), Exit 1 bei einer eigenen Datei über dem Default", { timeout: 60_000 }, () => {
    temp((dir) => {
      kopiereScripts(dir);
      datei(dir, ".factory/projekt.json", readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8"));
      datei(dir, ".factory/sync-stand.json", JSON.stringify({ version: 2 }));
      datei(dir, "AGENTS.md", "# Projekt\n");
      bezieherRepo(dir);
      const lauf = () => {
        const r = spawnSync(process.execPath, [join(dir, "scripts", "check-context-size.mjs")], { encoding: "utf8", cwd: dir, timeout: 30_000 });
        return { status: r.status, text: `${r.stderr}${r.stdout}` };
      };
      const ok = lauf();
      assert.equal(ok.status, 0, ok.text);
      datei(dir, ".agents/skills/proj/SKILL.md", "x".repeat(DEFAULT + 1));
      const rot = lauf();
      assert.equal(rot.status, 1, rot.text);
      assert.match(rot.text, /✖ \.agents\/skills\/proj\/SKILL\.md/);
      assert.match(rot.text, /Agenten-\/Skill-Datei: kürzen/);
      assert.doesNotMatch(rot.text, /modul-lokale AGENTS\.md/);
    });
  });
});

describe("CLI check-context-size: Gate-Meldung und Ausnahme im Bezieher (L17, L24)", () => {
  const bezieher = (dir: string): void => {
    kopiereScripts(dir);
    datei(dir, ".factory/projekt.json", readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8"));
    datei(dir, ".factory/sync-stand.json", JSON.stringify({ version: 2 }));
    datei(dir, "AGENTS.md", "# Projekt\n");
  };
  const lauf = (dir: string) => {
    const r = spawnSync(process.execPath, [join(dir, "scripts", "check-context-size.mjs")], { encoding: "utf8", cwd: dir, timeout: 30_000 });
    return { status: r.status, text: `${r.stderr}${r.stdout}` };
  };

  test("L17: ein kaputter Projektwert-Marker ergibt eine Gate-Meldung mit Ort und Fix-Zeile, keinen Stacktrace (fail-closed: Exit 1)", { timeout: 60_000 }, () => {
    temp((dir) => {
      bezieher(dir);
      datei(dir, ".agents/skills/proj/SKILL.md", `kopf\n${START}\nohne Ende\n`);
      const r = lauf(dir);
      assert.equal(r.status, 1, r.text);
      assert.match(r.text, /✖ .*\.agents\/skills\/proj\/SKILL\.md:\d+: Projektwert-Block hat kein Ende/);
      assert.match(r.text, /Fix: /);
      assert.doesNotMatch(r.text, /^\s+at /m);
    });
  });

  test("L24 Bezieher-Fall: eine eigene Datei über dem Default ist rot; mit ausnahmen.kontext (Ticket-Grund) geduldet, Exit 0", { timeout: 60_000 }, () => {
    temp((dir) => {
      bezieher(dir);
      const rel = ".agents/skills/proj/SKILL.md";
      datei(dir, rel, "x".repeat(DEFAULT + 1));
      assert.equal(lauf(dir).status, 1, "ohne Eintrag rot");
      const cfg = JSON.parse(readFileSync(join(dir, ".factory", "projekt.json"), "utf8")) as { ausnahmen?: Record<string, unknown> };
      cfg.ausnahmen = { ...cfg.ausnahmen, kontext: [{ datei: rel, grund: "#1 eigene Datei, wird geteilt" }] };
      datei(dir, ".factory/projekt.json", JSON.stringify(cfg));
      const ok = lauf(dir);
      assert.equal(ok.status, 0, ok.text);
      assert.match(ok.text, /geduldet: \.agents\/skills\/proj\/SKILL\.md/);
    });
  });
});

describe("Fabrik: Budget-Liste gegen Manifest und Ist", () => {
  test("ohne Argument misst der Collector das eigene Repo (Standard-Wurzel)", () => {
    assert.deepEqual(collectFiles(undefined as unknown as string), collectFiles(WURZEL));
    assert.deepEqual(collectSizes(undefined as unknown as string), collectSizes(WURZEL));
    assert.ok(collectFiles(undefined as unknown as string).includes(".claude/agents/factory-umsetzer.md"));
  });

  const manifest = JSON.parse(readFileSync(join(WURZEL, ".factory", "besitz.json"), "utf8")) as { eintraege: { pfad: string }[] };
  const pfade = manifest.eintraege.map((e) => e.pfad);

  test("die Budget-Liste nennt genau die verteilten Agenten- und Skill-Quelldateien des Besitz-Manifests (ohne die generierten Zeiger unter .claude/skills)", () => {
    const verteilt = pfade.filter((p) => /^(\.claude\/agents\/[^/]+\.md|\.agents\/skills\/.+\.md)$/.test(p)).sort();
    assert.ok(verteilt.length >= 10, "das Manifest wurde gelesen");
    assert.deepEqual(AGENTEN_SKILL_BUDGETS.map((b) => b.file).sort(), verteilt);
    for (const b of AGENTEN_SKILL_BUDGETS) assert.ok(existsSync(join(WURZEL, b.file)), `${b.file} existiert`);
  });

  test("je Datei: Ist <= Budget und Budget <= Ist + 10 %, aufgerundet auf 500 (Nachzieh-Ratchet: wer kürzt, senkt das Budget im selben PR)", () => {
    for (const s of collectSizes(WURZEL).filter((x) => AGENTEN_SKILL_BUDGETS.some((b) => b.file === x.file))) {
      assert.ok(s.chars <= s.budget, `${s.file}: ${s.chars} > ${s.budget}`);
      const obergrenze = Math.ceil((s.chars * 1.1) / 500) * 500;
      assert.ok(s.budget <= obergrenze, `${s.file}: Budget ${s.budget} liegt über Ist ${s.chars} + 10 % (${obergrenze}): nachziehen`);
    }
  });

  test("Default = größtes Budget der Liste (nachgezogen)", () => {
    assert.equal(
      DEFAULT,
      Math.max(...AGENTEN_SKILL_BUDGETS.map((b) => b.budget)),
      "Herleitung: eine Datei ohne Eintrag (auch eine projekt-eigene im Bezieher) wird nie größer als die größte Kern-Datei; der Default sinkt mit deren Budget und steigt nie (kontext-budget-ratchet)",
    );
  });
});

