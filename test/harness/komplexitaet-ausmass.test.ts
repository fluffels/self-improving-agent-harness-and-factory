/* Komplexitäts-Ausmaß-Wächter (#145 L8, L10): `eslint-suppressions.json` friert den Bestand der Regeln `complexity`, `max-depth` und
 * `max-lines-per-function` je Datei nur als ANZAHL Verstöße ein. Ein Verstoß, der von 16 auf 40 wächst, bleibt für ESLint ein Verstoß: das Gate bleibt grün.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft: je Datei mit Einträgen einer der drei Regeln die Summe Σ(Wert − Grenze) über alle Verstöße je Regel. Die Grenzwerte kommen aus der echten
 * Config (`calculateConfigForFile`, keine zweite Zahl); gelintet wird mit einer minimalen Config aus nur diesen drei Regeln ohne Typinformation. Die Summe wird
 * exakt mit `komplexitaet-ausmass-baseline.json` verglichen: ein Anstieg ist rot („Ursache beheben, nie Baseline heben“), ein Rückgang ebenfalls („Baseline senken“),
 * ebenso ein veralteter Eintrag. Ein Test sperrt jede Anhebung gegen die Diff-Basis (`anhebungen` aus `test/support/baseline-zaehlung.ts`).
 *
 * Grenze: die Summe je Datei sieht nicht, wenn EINE Funktion wächst und eine ANDERE derselben Datei im gleichen Maß sinkt.
 *
 * Form (L10): `eslint-suppressions.json` muss ESLints eigener Ausgabe entsprechen (`JSON.stringify(…, null, 2)`, ohne End-Newline); sonst entsteht nach
 * `npm run lint:prune` ein Form-Diff. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint, type Linter } from "eslint";
import tseslint from "typescript-eslint";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore – .mjs ohne Typdeklaration
import * as checkBasis from "../../scripts/check-basis.mjs";
import { type Baseline, type VergleichsTexte, anhebungen, diffBasisModus, vergleiche as vergleicheZaehlung } from "../support/baseline-zaehlung";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = "test/harness/komplexitaet-ausmass-baseline.json";
const SUPPRESSIONS = "eslint-suppressions.json";
const REGELN = ["complexity", "max-depth", "max-lines-per-function"] as const;
type Regel = (typeof REGELN)[number];
/** Der Zahlenwert je Regel steht in der Meldung (an der echten ESLint-Ausgabe geprüft). */
const WERT: Record<Regel, RegExp> = {
  complexity: /complexity of (\d+)/,
  "max-depth": /too deeply \((\d+)\)/,
  "max-lines-per-function": /too many lines \((\d+)\)/,
};

const lesen = (pfad: string): string => readFileSync(WURZEL + pfad, "utf8");

/** Die Grenze je Regel aus der echten Config für eine Beispieldatei (Severity-Zahl/-Text weg, Option 1 bzw. `max`). */
export async function grenzen(eslint: ESLint, datei: string): Promise<Record<Regel, number>> {
  const cfg = (await eslint.calculateConfigForFile(datei)) as Linter.Config;
  const rules = cfg.rules ?? {};
  const grenze = (name: Regel): number => {
    const opt = (rules[name] as unknown[] | undefined)?.[1];
    const n = typeof opt === "object" && opt !== null ? (opt as { max: number }).max : opt;
    assert.equal(typeof n, "number", `${name} hat in der Config keine Grenze`);
    return n as number;
  };
  return { complexity: grenze("complexity"), "max-depth": grenze("max-depth"), "max-lines-per-function": grenze("max-lines-per-function") };
}

/** Σ(Wert − Grenze) je Regel (nur > 0) aus den Meldungen; eine Meldung ohne lesbaren Wert ist ein Fehler. */
export function ausmass(meldungen: { ruleId: string | null; message: string }[], grenze: Record<Regel, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of meldungen) {
    const regel = REGELN.find((r) => r === m.ruleId);
    if (!regel) continue;
    const wert = WERT[regel].exec(m.message)?.[1];
    assert.ok(wert, `Meldung ohne lesbaren Wert für ${regel}: ${m.message}`);
    out[regel] = (out[regel] ?? 0) + Number(wert) - grenze[regel];
  }
  return out;
}

const TEXTE: VergleichsTexte = {
  neu: (d, r, n) => `${d}: ${r} Ausmaß ${n} ohne Baseline-Eintrag. Fix: Ursache beheben (Funktion kürzen/teilen), nie die Baseline heben`,
  ueber: (d, r, n, b) => `${d}: ${r} Ausmaß ${n} statt ${b}. Fix: Ursache beheben (Funktion kürzen/teilen), nie die Baseline heben`,
  unter: (d, r, n, b) => `${d}: ${r} Ausmaß nur noch ${n}, die Baseline kennt ${b}. Fix: Baseline senken (${BASELINE})`,
  verwaist: (d, z) => Object.entries(z).map(([r, b]) => TEXTE.unter(d, r, 0, b)),
};

/** Meldungen (leer = grün): Ist gegen Baseline, exakt. */
export function vergleiche(ist: Baseline, baseline: Baseline): string[] {
  return vergleicheZaehlung(ist, baseline, TEXTE);
}

/** Die Dateien, die in `eslint-suppressions.json` einen Eintrag einer der drei Regeln haben. */
export function betroffeneDateien(suppressions: Record<string, Record<string, unknown>>): string[] {
  return Object.entries(suppressions)
    .filter(([, regeln]) => REGELN.some((r) => r in regeln))
    .map(([datei]) => datei)
    .sort();
}

/** Je Datei der Baseline der an der Diff-Basis erlaubte Stand (neue Datei: nichts erlaubt). */
export function erlaubteWerte(baseline: Baseline, alt: Baseline): Baseline {
  return Object.fromEntries(Object.keys(baseline).map((d) => [d, alt[d] ?? {}]));
}

/** Die Baseline an der Diff-Basis: `null`, wenn die Datei dort fehlt (`git cat-file -e` scheitert, der erste Stand gilt); ungültiges JSON wirft. */
export function basisBaseline(git: (args: string[]) => string, basis: string): Baseline | null {
  try {
    git(["cat-file", "-e", `${basis}:${BASELINE}`]);
  } catch {
    return null;
  }
  return JSON.parse(git(["show", `${basis}:${BASELINE}`])) as Baseline;
}

/** ESLints eigene Ausgabeform der Suppressions-Datei: 2 Leerzeichen, kein End-Newline. */
export function eslintForm(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

async function messeIst(): Promise<Baseline> {
  const echt = new ESLint({ cwd: WURZEL });
  const grenze = await grenzen(echt, "scripts/x.mjs");
  // das ganze Optionsobjekt der echten Config (auch skipBlankLines/skipComments), keine zweite Fassung
  const echteRegeln = ((await echt.calculateConfigForFile("scripts/x.mjs")) as Linter.Config).rules ?? {};
  const zeilenOptionen = (echteRegeln["max-lines-per-function"] as unknown[])[1] as Record<string, unknown>;
  const dateien = betroffeneDateien(JSON.parse(lesen(SUPPRESSIONS)) as Record<string, Record<string, unknown>>);
  const eslint = new ESLint({
    cwd: WURZEL,
    overrideConfigFile: true,
    overrideConfig: [
      { files: ["**/*.ts"], languageOptions: { parser: tseslint.parser } },
      {
        files: ["**/*.{js,mjs,cjs,ts}"],
        rules: {
          complexity: ["error", grenze.complexity],
          "max-depth": ["error", grenze["max-depth"]],
          "max-lines-per-function": ["error", zeilenOptionen],
        },
      },
    ],
  });
  const ist: Baseline = {};
  for (const datei of dateien) {
    const [ergebnis] = await eslint.lintFiles([datei]);
    const z = ausmass(ergebnis.messages, grenze);
    if (Object.keys(z).length > 0) ist[datei] = Object.fromEntries(Object.entries(z).sort(([a], [b]) => a.localeCompare(b)));
  }
  return ist;
}

describe("Komplexitäts-Ausmaß je Datei", () => {
  // Timeout 60 s: typbewusstes ESLint über alle Dateien des Repos, unter paralleler Last der Suite knapp über dem Vitest-Standard.
  test("das Ausmaß des Bestands entspricht exakt der Baseline (steigt nie, Rückgang senkt die Baseline)", { timeout: 60_000 }, async () => {
    const baseline = JSON.parse(lesen(BASELINE)) as Baseline;
    assert.deepEqual(vergleiche(await messeIst(), baseline), []);
  });

  test("die Baseline ist sortiert und kennt nur Werte > 0", () => {
    const baseline = JSON.parse(lesen(BASELINE)) as Baseline;
    assert.deepEqual(Object.keys(baseline), Object.keys(baseline).sort());
    for (const z of Object.values(baseline)) for (const n of Object.values(z)) assert.ok(n > 0);
  });

  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;

  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("die Baseline wurde gegen die Diff-Basis nicht angehoben", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (FACTORY_DIFF_BASE/origin/main fehlt)");
    // die Datei gibt es an der Basis noch nicht: der erste Stand gilt; ungültiges JSON an der Basis wirft (rot)
    const alt = basisBaseline(git, basis);
    if (alt === null) return;
    const baseline = JSON.parse(lesen(BASELINE)) as Baseline;
    assert.deepEqual(anhebungen(baseline, erlaubteWerte(baseline, alt)), []);
  });

  test("eslint-suppressions.json hat ESLints eigene Form (2 Leerzeichen, ohne End-Newline)", () => {
    const text = lesen(SUPPRESSIONS);
    assert.equal(text, eslintForm(text), "Form weicht ab: `npm run lint:prune` ausführen, Diff der Datei zeigt ESLints Form");
  });

  describe("Mechanik", () => {
    const g = { complexity: 15, "max-depth": 4, "max-lines-per-function": 120 };
    test("basisBaseline: fehlende Datei an der Basis → null (erster Stand gilt), gültig → Inhalt, kaputtes JSON wirft (factory#162 L3)", () => {
      const fake = (zeigt: string | null) => (args: string[]): string => {
        if (args[0] === "cat-file") {
          if (zeigt === null) throw new Error("fatal: path does not exist");
          return "";
        }
        assert.equal(args[0], "show");
        assert.equal(args[1], `abc:${BASELINE}`);
        return zeigt ?? "";
      };
      assert.equal(basisBaseline(fake(null), "abc"), null);
      assert.deepEqual(basisBaseline(fake('{"a.mjs":{"complexity":2}}'), "abc"), { "a.mjs": { complexity: 2 } });
      assert.throws(() => basisBaseline(fake("{kaputt"), "abc"), SyntaxError);
    });
    test("ausmass summiert Wert minus Grenze je Regel", () => {
      const z = ausmass(
        [
          { ruleId: "complexity", message: "Function 'a' has a complexity of 17. Maximum allowed is 15." },
          { ruleId: "complexity", message: "Function 'b' has a complexity of 16. Maximum allowed is 15." },
          { ruleId: "max-depth", message: "Blocks are nested too deeply (6). Maximum allowed is 4." },
          { ruleId: "max-lines-per-function", message: "Function 'c' has too many lines (130). Maximum allowed is 120." },
          { ruleId: "no-undef", message: "x" },
        ],
        g,
      );
      assert.deepEqual(z, { complexity: 3, "max-depth": 2, "max-lines-per-function": 10 });
    });
    test("eine Meldung ohne lesbaren Wert bricht", () => {
      assert.throws(() => ausmass([{ ruleId: "complexity", message: "kaputt" }], g));
    });
    test("Anstieg, Rückgang, neu und veraltet sind je rot, Gleichstand grün", () => {
      const b = { "a.mjs": { complexity: 3 } };
      assert.equal(vergleiche({ "a.mjs": { complexity: 4 } }, b).length, 1);
      assert.equal(vergleiche({ "a.mjs": { complexity: 2 } }, b).length, 1);
      assert.equal(vergleiche({ "a.mjs": { complexity: 3, "max-depth": 1 } }, b).length, 1);
      assert.equal(vergleiche({}, b).length, 1);
      assert.deepEqual(vergleiche(b, b), []);
    });
    test("Anhebung gegen die Basis: angehoben, gleich und neue Datei", () => {
      const alt = { "a.mjs": { complexity: 3 } };
      assert.equal(anhebungen({ "a.mjs": { complexity: 4 } }, erlaubteWerte({ "a.mjs": { complexity: 4 } }, alt)).length, 1);
      assert.deepEqual(anhebungen(alt, erlaubteWerte(alt, alt)), []);
      assert.equal(anhebungen({ "n.mjs": { complexity: 1 } }, erlaubteWerte({ "n.mjs": { complexity: 1 } }, alt)).length, 1);
    });
    test("betroffeneDateien nimmt nur Dateien mit einer der drei Regeln", () => {
      assert.deepEqual(betroffeneDateien({ "b.ts": { x: {} }, "a.mjs": { "max-depth": {} } }), ["a.mjs"]);
    });
    test("eslintForm: End-Newline und Einrückung 4 weichen ab", () => {
      const ok = '{\n  "a": {\n    "b": 1\n  }\n}';
      assert.equal(eslintForm(ok), ok);
      assert.notEqual(eslintForm(ok), ok + "\n");
      assert.notEqual(eslintForm(ok), JSON.stringify(JSON.parse(ok), null, 4));
    });
  });
});
