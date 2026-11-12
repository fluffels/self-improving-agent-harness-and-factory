/* Harness-Doctor, Punkt `Ruleset-Spiegel` (factory#247 L3): vergleicht den Spiegel in Git mit dem Ruleset auf dem Server. Je Zweig ein Test:
 * OK, LÜCKE je Feld, NICHT PRÜFBAR (fail-closed: kein Admin-Recht, Endpunkt-Fehler, fehlende ID). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pinPunkt, pruefeRulesetSpiegel as raw, rulesetPunkte as rawPunkte } from "../scripts/harness-doctor-ruleset.mjs";

interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string }
type Lesen = (args: string[]) => unknown;
const pruefe = raw as (e: { spiegel: unknown; repo: string; lesen: Lesen }) => Ergebnis;

const punkte = rawPunkte as (e: { spiegel: unknown; repo: string; lesen?: Lesen }) => Ergebnis[];

const SPIEGEL = {
  id: 7,
  name: "main-schutz",
  requiredChecks: ["A", "B"],
  codeScanning: [{ tool: "CodeQL", sicherheitsSchwelle: "high_or_higher", alertSchwelle: "errors" }],
  bypassActors: [],
};
const live = (ueber: Record<string, unknown> = {}) => ({
  name: "main-schutz",
  rules: [
    { type: "required_status_checks", parameters: { required_status_checks: [{ context: "B", integration_id: 15368 }, { context: "A", integration_id: 15368 }] } },
    { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL", security_alerts_threshold: "high_or_higher", alerts_threshold: "errors" }] } },
  ],
  bypass_actors: [],
  ...ueber,
});
const lauf = (antwort: unknown, spiegel: unknown = SPIEGEL) => pruefe({ spiegel, repo: "o/r", lesen: () => antwort });

describe("Ruleset-Spiegel: Punkt nur auf Anforderung (rulesetPunkte)", () => {
  const { id: _id, ...ohneId } = SPIEGEL;
  void _id;
  test("mit lesen und id: nur der Spiegel-Punkt (der Pin-Punkt kommt aus rules/branches, factory#375 L51)", () => {
    let n = 0;
    const x = punkte({ spiegel: SPIEGEL, repo: "o/r", lesen: () => (n++, live()) });
    expect(x.map((e) => e.punkt)).toEqual(["Ruleset-Spiegel"]);
    expect(n).toBe(1);
  });
  test("ohne lesen (Wochenlauf, --einrichten): kein Punkt", () => {
    expect(punkte({ spiegel: SPIEGEL, repo: "o/r" })).toEqual([]);
  });
  test("Spiegel ohne id: kein Punkt", () => {
    expect(punkte({ spiegel: ohneId, repo: "o/r", lesen: () => live() })).toEqual([]);
  });
  test("ohne Spiegel: kein Punkt", () => {
    expect(punkte({ spiegel: undefined, repo: "o/r", lesen: () => live() })).toEqual([]);
  });
});

describe("Ruleset-Spiegel: OK", () => {
  test("alles gleich, Reihenfolge der Checks egal", () => {
    const x = lauf(live());
    expect(x.punkt).toBe("Ruleset-Spiegel");
    expect(x.ok).toBe(true);
  });
  test("liest repos/<repo>/rulesets/<id> aus dem Spiegel", () => {
    let args: string[] = [];
    pruefe({ spiegel: SPIEGEL, repo: "o/r", lesen: (a) => ((args = a), live()) });
    expect(args).toEqual(["api", "repos/o/r/rulesets/7"]);
  });
});

describe("Ruleset-Spiegel: LÜCKE je Feld", () => {
  test("Name weicht ab", () => {
    const x = lauf(live({ name: "anders" }));
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBeUndefined();
    expect(x.befund).toContain("name");
  });
  test("Required Check fehlt live", () => {
    const x = lauf(live({ rules: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "A" }] } }] }));
    expect(x.ok).toBe(false);
    expect(x.befund).toContain("requiredChecks");
  });
  test.each([["fehlt", undefined], ["ist ein Objekt statt einer Liste", {}]])("Antwort, deren `rules` %s: Lücke requiredChecks, kein Wurf", (_name, rules) => {
    const antwort: Record<string, unknown> = live();
    if (rules === undefined) delete antwort.rules;
    else antwort.rules = rules;
    const x = lauf(antwort);
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBeUndefined();
    expect(x.befund).toContain("requiredChecks");
  });
  test.each([["security_alerts_threshold", "none", "errors"], ["alerts_threshold", "high_or_higher", "none"]])("Code-Scanning-Schwelle weicht ab (%s)", (_feld, sec, alert) => {
    const x = lauf(live({ rules: [
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "A" }, { context: "B" }] } },
      { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL", security_alerts_threshold: sec, alerts_threshold: alert }] } },
    ] }));
    expect(x.ok).toBe(false);
    expect(x.befund).toContain("codeScanning");
  });
  test("Bypass-Akteur live, Spiegel leer", () => {
    const x = lauf(live({ bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always" }] }));
    expect(x.ok).toBe(false);
    expect(x.befund).toContain("bypassActors");
  });
});

describe("Ruleset-Spiegel: NICHT PRÜFBAR (fail-closed)", () => {
  test("bypass_actors fehlt (kein Admin-Recht)", () => {
    const { bypass_actors: _weg, ...ohne } = live();
    void _weg;
    const x = lauf(ohne);
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBe(true);
    expect(x.befund).toContain("bypass_actors");
  });
  test("Endpunkt wirft", () => {
    const x = pruefe({ spiegel: SPIEGEL, repo: "o/r", lesen: () => { throw new Error("HTTP 404"); } });
    expect(x.nichtPruefbar).toBe(true);
    expect(x.befund).toContain("404");
  });
  test("Antwort ist kein Objekt", () => {
    expect(lauf(null).nichtPruefbar).toBe(true);
  });
});


describe("Required-Check-Pin (factory#375 L51): integration_id je Required Check aus rules/branches", () => {
  const regel = (checks: unknown[]) => ({ type: "required_status_checks", parameters: { required_status_checks: checks } });
  const pin = (wert: unknown) => pinPunkt({ wert }) as Ergebnis[];
  test("ohne integration_id: Lücke mit den Kontexten und Fix-Text", () => {
    const x = pin([regel([{ context: "Zeta" }, { context: "Beta", integration_id: 15368 }, { context: "Gamma", integration_id: null }, { context: "Alpha" }])])[0];
    expect(x?.punkt).toBe("Required-Check-Pin");
    expect(x?.ok).toBe(false);
    expect(x?.nichtPruefbar).toBeUndefined();
    expect(x?.befund).toContain("Alpha, Gamma, Zeta");
    expect(x?.befund).not.toContain("Beta");
    expect(x?.fix).toContain("integration_id");
    expect(x?.fix).toContain("check-runs");
    expect(x?.fix).toContain("Pre-Flight");
  });
  test("alle gepinnt: OK", () => {
    const x = pin([regel([{ context: "A", integration_id: 15368 }])]);
    expect(x).toHaveLength(1);
    expect(x[0]?.ok).toBe(true);
  });
  test("keine required_status_checks-Regel: kein Ergebnis", () => {
    expect(pin([])).toEqual([]);
    expect(pin([{ type: "pull_request" }])).toEqual([]);
  });
  test("Regel ohne parameters oder wert kein Array: kein Ergebnis", () => {
    expect(pin([{ type: "required_status_checks" }])).toEqual([]);
    expect(pin(null)).toEqual([]);
  });
  test("andere Regel mit gleichnamigem Parameter zählt nicht", () => {
    const fremd = { type: "code_scanning", parameters: { required_status_checks: [{ context: "X" }] } };
    expect(pin([fremd, regel([{ context: "A", integration_id: 1 }])])[0]?.ok).toBe(true);
  });
  test("Lesefehler aus hole: nicht prüfbar mit Grund", () => {
    const x = (pinPunkt({ fehler: "HTTP 403" }) as Ergebnis[])[0];
    expect(x?.punkt).toBe("Required-Check-Pin");
    expect(x?.nichtPruefbar).toBe(true);
    expect(x?.befund).toContain("HTTP 403");
  });
});
