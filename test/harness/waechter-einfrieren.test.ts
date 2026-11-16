/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#611, Regel-Verfall 4/4 von factory#517).
 *
 * Ein „eingefrorener“ Wächter läuft nicht mehr in verify (vite.config.ts: test.exclude), bleibt aber als Datei erhalten. Einzige Quelle der
 * Liste ist das Änderungsregister (Verfall-Zeile mit Feld `eingefroren`). Diese Datei verhindert, dass der Hebel etwas Falsches abschaltet:
 *   (a) die eingefrorene Datei existiert, (b) sie steht nicht in der Sicherheits-Ausnahmeliste (ADR 0027 Punkt 6),
 *   (c) sie ist kein Durch-Wächter einer Regel, (d) sie ist nicht verteilt (kern-test: der Bezieher behielte sie veraltet),
 *   (e) sie ist keiner der Selbstschutz-Wächter, (f) exclude in der Config ist genau die Standardliste plus die eingefrorenen Ziele.
 *
 * Grenze: Den Fang-Teil des Urteils (kein Fang in 30 Tagen) prüft dieser Test nicht, die Fangquote braucht gh (in Vitest gesperrt);
 * er steht als Messwert im PR und ist Urteilsregel des Ticketlaufs. Eine Datei, die nicht unter test/harness/ liegt, kann der Validator
 * des Registers (`eingefroren`) gar nicht erst annehmen.
 */
import { describe, it, expect } from "vitest";
import { configDefaults } from "vitest/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libModul from "../../scripts/waechter-einfrieren-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as regelVerfallModul from "../../scripts/regel-verfall-lib.mjs";

const WURZEL = join(__dirname, "..", "..");
type Zeile = Record<string, unknown>;
type Extraktion = { muster: string; art: string }[];
type Ausnahme = { ziel: string };
const lib = libModul as unknown as {
  SELBSTSCHUTZ: string[];
  pruefeEingefroreneZiele: (e: { zeilen: Zeile[]; extraktion: Extraktion; ausnahmen?: Ausnahme[] }) => string[];
  excludeListe: (standard: string[], zeilen: Zeile[], extraktion: Extraktion, ausnahmen?: Ausnahme[]) => string[];
};
const SICHERHEITS_AUSNAHMEN = (regelVerfallModul as unknown as { SICHERHEITS_AUSNAHMEN: Ausnahme[] }).SICHERHEITS_AUSNAHMEN;
const SELBSTSCHUTZ = lib.SELBSTSCHUTZ;

type Eingabe = {
  zeilen: Zeile[];
  extraktion: Extraktion;
  ausnahmen: Ausnahme[];
  existiert: (pfad: string) => boolean;
  exclude: string[];
  standardExclude: string[];
};

/** Befunde (leer = grün) zu den eingefrorenen Wächtern des Registers und zur exclude-Liste der Config. */
function pruefeEinfrieren(e: Eingabe): string[] {
  const eingefroren = e.zeilen.filter((z) => z.art === "verfall" && z.eingefroren !== undefined).map((z) => ({ id: String(z.id), ziel: String(z.ziel) }));
  const aus = lib.pruefeEingefroreneZiele({ zeilen: e.zeilen, extraktion: e.extraktion, ausnahmen: e.ausnahmen });
  for (const { id, ziel } of eingefroren) if (!e.existiert(ziel)) aus.push(`${id}: ${ziel} fehlt (eingefroren heißt: Datei bleibt erhalten)`);
  const soll = [...e.standardExclude, ...eingefroren.map((x) => x.ziel)];
  const fehlt = soll.filter((s) => !e.exclude.includes(s));
  const zuviel = e.exclude.filter((x) => !soll.includes(x));
  if (fehlt.length > 0) aus.push(`exclude in vite.config.ts lässt aus dem Register aus: ${fehlt.join(", ")}`);
  if (zuviel.length > 0) aus.push(`exclude in vite.config.ts schaltet ohne Registerzeile ab: ${zuviel.join(", ")}`);
  return aus;
}

const WAECHTER = "test/harness/beispiel.test.ts";
const zeile = (z: Zeile = {}): Zeile => ({ id: "w-b", art: "verfall", ziel: WAECHTER, aufgenommen: "2026-11-16", ablauf: "2027-05-16", messgroesse: "fangquote", eingefroren: "2026-11-20", ...z });
const eingabe = (z: Partial<Eingabe> = {}): Eingabe => ({
  zeilen: [zeile()],
  extraktion: [],
  ausnahmen: [{ ziel: "test/harness/sicher.test.ts" }],
  existiert: () => true,
  exclude: ["**/node_modules/**", WAECHTER],
  standardExclude: ["**/node_modules/**"],
  ...z,
});

describe("pruefeEinfrieren (Fixtures)", () => {
  it("ein eingefrorener Wächter mit passender exclude-Liste ist gültig (Gegenbeweis)", () => {
    expect(pruefeEinfrieren(eingabe())).toEqual([]);
    expect(pruefeEinfrieren(eingabe({ zeilen: [zeile({ eingefroren: undefined })], exclude: ["**/node_modules/**"] })), "nichts eingefroren").toEqual([]);
  });

  it("eine Sicherheits-Ausnahme eingefroren ist rot (Negativfall)", () => {
    const z = zeile({ ziel: "test/harness/sicher.test.ts" });
    expect(pruefeEinfrieren(eingabe({ zeilen: [z], exclude: ["**/node_modules/**", "test/harness/sicher.test.ts"] })).join("\n")).toMatch(/Sicherheits-Ausnahmeliste/);
  });

  it("ein verteilter Wächter (kern-test) eingefroren ist rot", () => {
    const x: Extraktion = [{ muster: WAECHTER, art: "kern-test" }];
    expect(pruefeEinfrieren(eingabe({ extraktion: x })).join("\n")).toMatch(/verteilt/);
    expect(pruefeEinfrieren(eingabe({ extraktion: [{ muster: "test/harness/*.test.ts", art: "kern-test" }] })).join("\n")).toMatch(/verteilt/);
  });

  it("ein Wächter, den eine Regel als durch nennt, ist rot", () => {
    const regel = { id: "r-x", art: "verfall", ziel: "AGENTS.md#x", aufgenommen: "2026-11-16", ablauf: "2027-05-16", messgroesse: "fangquote", durch: ["w-b"] };
    expect(pruefeEinfrieren(eingabe({ zeilen: [zeile(), regel] })).join("\n")).toMatch(/Durch-Wächter/);
  });

  it.each(SELBSTSCHUTZ)("der Selbstschutz-Wächter %s eingefroren ist rot", (ziel) => {
    expect(pruefeEinfrieren(eingabe({ zeilen: [zeile({ ziel })], exclude: ["**/node_modules/**", ziel] })).join("\n")).toMatch(/schützt den Einfrier-Hebel/);
  });

  it("ein passender Extraktionseintrag mit art projekt-test blockiert nicht (Gegenbeweis zu verteilt)", () => {
    expect(pruefeEinfrieren(eingabe({ extraktion: [{ muster: WAECHTER, art: "projekt-test" }] }))).toEqual([]);
    expect(pruefeEinfrieren(eingabe({ extraktion: [{ muster: "test/harness/*.test.ts", art: "projekt-test" }, { muster: "test/harness/*.test.ts", art: "kern-test" }] })), "erster Treffer gewinnt wie im Gate").toEqual([]);
  });

  it("excludeListe: eingefrorenes Ziel landet im exclude, nichts Eingefrorenes lässt die Standardliste unverändert", () => {
    expect(lib.excludeListe(["a"], [zeile()], [])).toEqual(["a", WAECHTER]);
    expect(lib.excludeListe(["a"], [zeile({ eingefroren: undefined })], [])).toEqual(["a"]);
  });

  it("excludeListe wirft fail-closed bei Sicherheits-Ausnahme, Selbstschutz und Glob-Ziel", () => {
    expect(() => lib.excludeListe([], [zeile({ ziel: "test/harness/fremdtext-gate.test.ts" })], [])).toThrow(/Sicherheits-Ausnahmeliste/);
    expect(() => lib.excludeListe([], [zeile({ ziel: SELBSTSCHUTZ[0] })], [])).toThrow(/schützt den Einfrier-Hebel/);
    expect(() => lib.excludeListe([], [zeile({ ziel: "test/harness/!(x).test.ts" })], [])).toThrow(/kein einzelner Wächter/);
  });

  it("eine fehlende Datei ist rot", () => {
    expect(pruefeEinfrieren(eingabe({ existiert: () => false })).join("\n")).toMatch(/fehlt/);
  });

  it("exclude weicht vom Register ab: in beide Richtungen rot", () => {
    expect(pruefeEinfrieren(eingabe({ exclude: ["**/node_modules/**"] })).join("\n")).toMatch(/lässt aus dem Register aus/);
    expect(pruefeEinfrieren(eingabe({ zeilen: [zeile({ eingefroren: undefined })] })).join("\n")).toMatch(/ohne Registerzeile/);
    expect(pruefeEinfrieren(eingabe({ exclude: ["**/node_modules/**", WAECHTER, "test/harness/heimlich.test.ts"] })).join("\n")).toMatch(/heimlich/);
  });
});

describe("echtes Register und echte vite.config.ts", () => {
  it("eingefrorene Wächter und exclude der Config stimmen überein, keine Ausnahme und kein Selbstschutz ist betroffen", async () => {
    const register = JSON.parse(readFileSync(join(WURZEL, ".github", "aenderungsregister.json"), "utf8")) as { zeilen: Zeile[] };
    const extraktion = (JSON.parse(readFileSync(join(WURZEL, ".factory", "extraktion.json"), "utf8")) as { eintraege: Extraktion }).eintraege;
    const cfg = (await import("../../vite.config")) as unknown as { default: { test: { exclude: string[] } } };
    expect(
      pruefeEinfrieren({
        zeilen: register.zeilen,
        extraktion,
        ausnahmen: SICHERHEITS_AUSNAHMEN,
        existiert: (p) => existsSync(join(WURZEL, p)),
        exclude: cfg.default.test.exclude,
        standardExclude: [...configDefaults.exclude],
      }),
    ).toEqual([]);
  });
});

describe("vite.config.ts bleibt als Projektdatei beim Bezieher ladbar (Probe-Erstbezug)", () => {
  const quelle = readFileSync(join(WURZEL, "vite.config.ts"), "utf8");

  it("lädt die Fabrik-Lib weder per statischem Import noch per Literal (der Bündler löste es beim Bezieher ohne die Datei auf)", () => {
    expect(quelle).not.toMatch(/import\s[^;]*from\s+"\.\/scripts\//);
    expect(quelle).not.toMatch(/import\(\s*"\.\/scripts\//);
    expect(quelle).toMatch(/import\(\/\* @vite-ignore \*\/ new URL\(lib, import\.meta\.url\)\.href\)/);
  });

  it("fällt ohne Register, Extraktionsliste oder Lib auf die Standardliste zurück (schaltet nie einen Test ab)", () => {
    expect(quelle).toMatch(/noetig\.every\(\(p\) => existsSync\(new URL\(p, import\.meta\.url\)\)\)\) return \[\.\.\.configDefaults\.exclude\]/);
    expect(quelle).toMatch(/const noetig = \[[^\]]*aenderungsregister\.json[^\]]*extraktion\.json[^\]]*lib\]/);
  });
});
