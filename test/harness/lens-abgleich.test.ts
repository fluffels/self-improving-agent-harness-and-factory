/* Lens-Struktur im Skill (#1309, #1311, factory#308) – der Skill `review-lenses` hält je Brille eine eigene Datei `brille-<Schlüssel>.md`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Die Prüfpunkte jeder Review-Brille stehen als Aufzählung in der Datei `.agents/skills/review-lenses/brille-<Schlüssel>.md`
 * (tool-neutral); `SKILL.md` trägt keine Prüfpunkte mehr, die Lens liest ihre Brille selbst vom Stand `origin/main`
 * (Lesebefehl in `.claude/agents/factory-lens.md`). Dieser Wächter verlangt vier Brillen, je mit Überschrift,
 * `Regel-Ausschnitt:`-Zeile und mindestens einem Prüfpunkt, damit eine umbenannte Überschrift oder ein leerer Abschnitt nicht still
 * eine Brille entfernt (die Orchestrierung, der Lens-Auftrag-Guard und der Nachweis-Wächter hängen an diesen vier Brillen).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Skript.
import * as nachweisRaw from "../../scripts/nachweis-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Skript.
import * as codexRollenRaw from "../../scripts/codex-rollen.mjs";

const WURZEL = new URL("../../", import.meta.url);
const lies = (pfad: string) => readFileSync(new URL(pfad, WURZEL), "utf8").replace(/\r\n/g, "\n");
const SKILL = lies(".agents/skills/review-lenses/SKILL.md");
const LENS_DEF = lies(".claude/agents/factory-lens.md");
const BRILLEN_ORDNER = ".agents/skills/review-lenses";

/** Unabhängig abgeschriebene Liste: Schlüssel, Überschrift (Anfang der ersten Zeile) und Zeilenform der Prüfpunkte je Brille. */
const BRILLEN: { key: string; kopf: string; punkt: RegExp }[] = [
  { key: "architektur", kopf: "**Lens 1 — Architektur.**", punkt: /^- / },
  { key: "requirement-treue", kopf: "**Lens 2 — Requirement-Treue.**", punkt: /^- / },
  { key: "test-adaequanz", kopf: "**Lens 3 — Test-Adäquanz.**", punkt: /^- / },
  { key: "kombiniert", kopf: "**Lens K — Kombiniert**", punkt: /^- / },
  { key: "doku", kopf: "**Lens 4 — Doku**", punkt: /^\d+\. / },
];

const brille = (key: string) => lies(`${BRILLEN_ORDNER}/brille-${key}.md`);
/** Die Prüfpunkte einer Brillen-Datei. */
const punkte = (text: string, punkt: RegExp): string[] => text.split("\n").filter((z) => punkt.test(z));

describe("Brillen-Dateien (factory#308)", () => {
  for (const b of BRILLEN) {
    test(`${b.key}: Datei beginnt mit ihrer Überschrift, trägt den Regel-Ausschnitt und mindestens einen Prüfpunkt`, () => {
      const text = brille(b.key);
      assert.ok(text.startsWith(b.kopf), "Überschrift fehlt oder umbenannt: BRILLEN mitziehen");
      assert.match(text, /^Regel-Ausschnitt: .+$/m);
      assert.ok(punkte(text, b.punkt).length > 0, "Brille ohne Prüfpunkte");
    });
  }

  test("Orakel: die Menge der brille-*.md, die Liste im Test und BEKANNTE_LENSES sind gleich", () => {
    const dateien = readdirSync(new URL(`${BRILLEN_ORDNER}/`, WURZEL))
      .filter((d) => /^brille-.+\.md$/.test(d))
      .map((d) => d.replace(/^brille-|\.md$/g, ""))
      .sort();
    const erwartet = BRILLEN.map((b) => b.key).sort();
    assert.deepEqual(dateien, erwartet, "eine fünfte Brille: BRILLEN und den Nachweis-Wächter mitziehen");
    assert.deepEqual([...(nachweisRaw as { BEKANNTE_LENSES: string[] }).BEKANNTE_LENSES].sort(), erwartet);
  });

  test("keine Brille trägt einen Selbstcheck-Block (den fährt der Umsetzer, nicht die Lens)", () => {
    for (const b of BRILLEN) assert.doesNotMatch(brille(b.key), /Selbstcheck/, b.key);
  });

  test("SKILL.md trägt keine Brillen-Überschrift und keinen Prüfpunkt einer Brille mehr (Red-Green: ein zurückkopierter Punkt wird gefunden)", () => {
    const doppelt = (skill: string) => {
      const skillZeilen = new Set(skill.split("\n").map((z) => z.trim()).filter((z) => z.length >= 40));
      return BRILLEN.flatMap((b) => punkte(brille(b.key), b.punkt).map((z) => z.trim()).filter((z) => z.length >= 40 && skillZeilen.has(z)));
    };
    assert.equal(SKILL.split("\n").filter((z) => /^\*\*Lens \d+ — /.test(z)).length, 0);
    assert.deepEqual(doppelt(SKILL), []);
    const punkt = punkte(brille("architektur"), /^- /).find((z) => z.length >= 40) ?? "";
    assert.equal(doppelt(`${SKILL}\n${punkt}\n`).length, 1, "die Erkennung greift");
  });

  test("die Doku-Brille läuft ohne Test-Brille; die Sabotage-Probe verlangt einen sauberen Stand (bleibt im Skill)", () => {
    assert.match(brille("doku"), /Test-Adäquanz entfällt, weil es ohne Code nichts zu sabotieren gibt/);
    assert.match(SKILL, /git status --porcelain\s+# MUSS leer sein/);
  });

  test("fehlende Brillen-Datei wird laut gemeldet", () => {
    assert.throws(() => brille("gibt-es-nicht"), /ENOENT/);
  });
});

describe("Brille vom Stand origin/main (factory#308, AK3)", () => {
  /** Der Lesebefehl aus der Lens-Definition: genau einer, sonst wirft die Funktion (kein stilles Leer-Grün). */
  const lesebefehl = (text: string): string[] => {
    const treffer = [...text.matchAll(/`(git -C <Arbeitsverzeichnis> show [^`]+)`/g)].map((m) => m[1]);
    if (treffer.length !== 1) throw new Error(`Lesebefehl der Brille: ${treffer.length} Treffer statt genau einem`);
    return treffer[0].split(" ").slice(1);
  };

  test("die Lens-Definition nennt genau einen Lesebefehl `git show origin/main:…/brille-<Brille>.md`, nie `HEAD:` oder einen Pfad im Worktree", () => {
    const args = lesebefehl(LENS_DEF);
    assert.equal(args[3], `origin/main:${BRILLEN_ORDNER}/brille-<Brille>.md`);
    assert.throws(() => lesebefehl("kein Befehl"), /0 Treffer/);
    assert.throws(() => lesebefehl("`git -C <Arbeitsverzeichnis> show a` und `git -C <Arbeitsverzeichnis> show b`"), /2 Treffer/);
  });

  test("der Befehl liefert den Stand von origin/main, nicht den Feature-Commit und nicht den Arbeitsbaum", () => {
    const tmp = mkdtempSync(join(tmpdir(), "brille-main-"));
    try {
      const git = (...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      const datei = join(tmp, BRILLEN_ORDNER, "brille-architektur.md");
      mkdirSync(join(tmp, BRILLEN_ORDNER), { recursive: true });
      git("init", "-q");
      writeFileSync(datei, "STAND-MAIN");
      git("add", "-A");
      git("commit", "-q", "-m", "main");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      writeFileSync(datei, "STAND-PR");
      git("commit", "-q", "-am", "feature");
      writeFileSync(datei, "STAND-ARBEITSBAUM");
      const args = lesebefehl(LENS_DEF).map((a) => a.replace("<Arbeitsverzeichnis>", tmp).replace("<Brille>", "architektur"));
      assert.equal(git(...args), "STAND-MAIN");
      // Gegenprobe: derselbe Befehl mit `HEAD:` liest den Feature-Stand: der Test unterscheidet die Stände wirklich.
      assert.equal(git(...args.map((a) => a.replace("origin/main:", "HEAD:"))), "STAND-PR");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
      assert.equal(existsSync(tmp), false);
    }
  });
});

describe("Beide Laufzeiten erreichen die Brille (factory#308, AK4)", () => {
  test("Fallback general-purpose: der Skill lässt die Lens-Definition und damit ihre Brille vom Stand origin/main lesen, der Prompt beginnt mit `Brille:`", () => {
    assert.match(SKILL, /`Brille: <…> ·`/);
    assert.match(SKILL, /`git -C <Arbeitsverzeichnis> show origin\/main:\.claude\/agents\/factory-lens\.md`/);
  });

  test("Codex-Lens: die Rolle liest dieselbe Lens-Definition und hat eine Shell (`git show` geht); die Quelle liegt im Repo", () => {
    const m = codexRollenRaw as { rollenFuer: (config: unknown) => { name: string; quelle: string; ohneShell: boolean }[] };
    const rollen = m.rollenFuer({ agenten: { planer: "p-x", umsetzer: "u-x", lens: "l-x", gruppe: "g-x" } });
    const lens = rollen.find((r) => r.name === "l-x");
    assert.equal(lens?.quelle, "factory-lens");
    assert.equal(lens?.ohneShell, false, "die Lens-Rolle braucht die Shell für den Lesebefehl der Brille");
    assert.ok(existsSync(new URL(`.claude/agents/${lens?.quelle}.md`, WURZEL)));
    // Gegenprobe: die Rolle ohne Shell (Szenario-Agent) ist erkennbar, der Test unterscheidet also.
    assert.equal(rollen.find((r) => r.name === "holdout-szenario")?.ohneShell, true);
  });
});

describe("Bedingte Ablauf-Dateien des Review-Skills (factory#309)", () => {
  const ERWARTET = ["ablauf-abnahme-fix.md", "ablauf-merge-main.md", "ablauf-nachweis.md", "ablauf-zusatzpass.md"];
  /** Die Menge der in `skill` mit vollem Pfad genannten `ablauf-*.md` (sortiert). */
  const genannt = (skill: string): string[] =>
    [...new Set([...skill.matchAll(/\.agents\/skills\/review-lenses\/(ablauf-[a-z-]+\.md)/g)].map((m) => m[1]))].sort();
  /** Befund-Text: Dateien im Ordner und Verweise im Kern müssen übereinstimmen (leer = grün). */
  const abgleich = (skill: string, dateien: string[]): string[] => {
    const out: string[] = [];
    for (const d of dateien) if (!genannt(skill).includes(d)) out.push(`verwaist: ${d} steht in SKILL.md nicht mit vollem Pfad`);
    for (const g of genannt(skill)) if (!dateien.includes(g)) out.push(`Verweis ohne Datei: ${g}`);
    return out;
  };
  const imOrdner = (): string[] =>
    readdirSync(new URL(`${BRILLEN_ORDNER}/`, WURZEL))
      .filter((d) => /^ablauf-.+\.md$/.test(d))
      .sort();

  test("die Menge der ablauf-*.md ist genau die erwartete und der Kern nennt jede mit vollem Pfad", () => {
    assert.deepEqual(imOrdner(), ERWARTET, "eine neue bedingte Datei: ERWARTET, Besitz-Manifest und Budget mitziehen");
    assert.deepEqual(genannt(SKILL), ERWARTET);
    assert.deepEqual(abgleich(SKILL, imOrdner()), []);
  });

  test("Negativfall: ein entfernter Verweis und eine verwaiste Datei werden rot", () => {
    const ohneVerweis = SKILL.split(".agents/skills/review-lenses/ablauf-zusatzpass.md").join("");
    assert.match(abgleich(ohneVerweis, imOrdner()).join("\n"), /verwaist: ablauf-zusatzpass\.md/);
    assert.match(abgleich(SKILL, [...imOrdner(), "ablauf-neu.md"]).join("\n"), /verwaist: ablauf-neu\.md/);
    assert.match(abgleich(`${SKILL}\n.agents/skills/review-lenses/ablauf-weg.md`, imOrdner()).join("\n"), /Verweis ohne Datei: ablauf-weg\.md/);
  });
});
