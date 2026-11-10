/* Harness-Doctor, Punkt `Ruleset-Spiegel` (factory#247 L3): vergleicht den Spiegel in Git mit dem Ruleset auf dem Server. Je Zweig ein Test:
 * OK, LÜCKE je Feld, NICHT PRÜFBAR (fail-closed: kein Admin-Recht, Endpunkt-Fehler, fehlende ID). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeRulesetSpiegel as raw } from "../scripts/harness-doctor-ruleset.mjs";

interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string }
type Lesen = (args: string[]) => unknown;
const pruefe = raw as (e: { spiegel: unknown; repo: string; lesen: Lesen }) => Ergebnis;

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
    { type: "required_status_checks", parameters: { required_status_checks: [{ context: "B" }, { context: "A" }] } },
    { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL", security_alerts_threshold: "high_or_higher", alerts_threshold: "errors" }] } },
  ],
  bypass_actors: [],
  ...ueber,
});
const lauf = (antwort: unknown, spiegel: unknown = SPIEGEL) => pruefe({ spiegel, repo: "o/r", lesen: () => antwort });

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
  test("Code-Scanning-Schwelle weicht ab", () => {
    const x = lauf(live({ rules: [
      { type: "required_status_checks", parameters: { required_status_checks: [{ context: "A" }, { context: "B" }] } },
      { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL", security_alerts_threshold: "none", alerts_threshold: "errors" }] } },
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
  test("Spiegel ohne id", () => {
    const { id: _id, ...ohne } = SPIEGEL;
    void _id;
    const x = lauf(live(), ohne);
    expect(x.nichtPruefbar).toBe(true);
    expect(x.befund).toContain("id");
  });
  test("Antwort ist kein Objekt", () => {
    expect(lauf(null).nichtPruefbar).toBe(true);
  });
});
