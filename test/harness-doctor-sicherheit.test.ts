/* Harness-Doctor, Sicherheitspunkte (factory#116): `pruefeSicherheit` ist pur. Jeder Test verfälscht genau eine Quelle und erwartet genau diesen Punkt;
 * die Negativfälle (Endpunkt-Fehler, fehlendes Feld) dürfen nie OK ergeben. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { LINK_SICHERHEIT as rawLinks, SICHERHEIT_PUNKTE as rawPunkte, pruefeSicherheit as rawPruefe } from "../scripts/harness-doctor-sicherheit.mjs";

type Quelle = { wert?: unknown; fehler?: string; fix?: string };
interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string; link?: string; hinweis?: string }
interface Eingabe { repo: Quelle; actions: Quelle; regeln: Quelle; pvr: Quelle; spiegel?: unknown; branch?: string; privat?: boolean }
const pruefe = rawPruefe as (e: Eingabe) => Ergebnis[];
const PUNKTE = rawPunkte as string[];
const LINKS = rawLinks as Record<string, string>;

const SA_SCHLUESSEL: Record<string, string> = {
  "Secret Scanning": "secret_scanning",
  "Push Protection": "secret_scanning_push_protection",
  "Non-Provider-Patterns": "secret_scanning_non_provider_patterns",
  "Validity Checks": "secret_scanning_validity_checks",
  "Dependabot Security Updates": "dependabot_security_updates",
};
const sa = (aus: string[] = []) => Object.fromEntries(Object.values(SA_SCHLUESSEL).map((k) => [k, { status: aus.includes(k) ? "disabled" : "enabled" }]));
const cs = (...tools: string[]) => ({ type: "code_scanning", parameters: { code_scanning_tools: tools.map((tool) => ({ tool })) } });
const SPIEGEL = { name: "main-schutz", codeScanning: [{ tool: "CodeQL" }] };
const gesund = (): Eingabe => ({
  repo: { wert: { security_and_analysis: sa() } },
  actions: { wert: { sha_pinning_required: true } },
  regeln: { wert: [cs("CodeQL")] },
  pvr: { wert: { enabled: true } },
  spiegel: SPIEGEL,
});
const je = (e: Eingabe, punkt: string): Ergebnis => pruefe(e).find((r) => r.punkt === punkt) as Ergebnis;

describe("pruefeSicherheit: gesund", () => {
  test("immer genau acht Punkte in fester Reihenfolge, alle OK", () => {
    const r = pruefe(gesund());
    expect(r.map((x) => x.punkt)).toEqual(PUNKTE);
    expect(PUNKTE).toEqual(["Secret Scanning", "Push Protection", "Non-Provider-Patterns", "Validity Checks", "PVR", "Dependabot Security Updates", "Code-Scanning", "SHA-Pinning"]);
    expect(r.every((x) => x.ok === true)).toBe(true);
  });
});

describe("pruefeSicherheit: ausgeschaltet ist eine Lücke mit Klickpfad, ohne schreibenden Befehl", () => {
  const faelle: [string, (e: Eingabe) => void][] = [
    ...Object.entries(SA_SCHLUESSEL).map(([punkt, k]): [string, (e: Eingabe) => void] => [punkt, (e) => (e.repo = { wert: { security_and_analysis: sa([k]) } })]),
    ["PVR", (e) => (e.pvr = { wert: { enabled: false } })],
    ["SHA-Pinning", (e) => (e.actions = { wert: { sha_pinning_required: false } })],
    ["Code-Scanning", (e) => (e.regeln = { wert: [cs("Anderes")] })],
  ];
  test.each(faelle)("%s", (punkt, verfaelsche) => {
    const e = gesund();
    verfaelsche(e);
    const r = pruefe(e);
    const luecken = r.filter((x) => !x.ok);
    expect(luecken.map((x) => x.punkt)).toEqual([punkt]);
    expect(luecken[0].nichtPruefbar).toBeUndefined();
    expect(luecken[0].fix).toMatch(/\S/);
    expect(luecken[0].fix).not.toMatch(/gh api|PATCH|PUT|POST/);
    expect(luecken[0].link).toBe(LINKS[punkt]);
    expect(luecken[0].link).toMatch(/^https:\/\//);
  });
});

describe("pruefeSicherheit: Negativfall, nie OK ohne Beleg", () => {
  const FEHLER = ["HTTP 403: Resource not accessible by integration", "HTTP 404: Not Found", "error connecting to api.github.com"];
  test.each(FEHLER)("Repo-Endpunkt antwortet mit %s: die fünf security_and_analysis-Punkte sind nicht prüfbar", (fehler) => {
    const e = gesund();
    e.repo = { fehler };
    const r = pruefe(e);
    for (const punkt of Object.keys(SA_SCHLUESSEL)) {
      const x = r.find((y) => y.punkt === punkt) as Ergebnis;
      expect(x.ok).not.toBe(true);
      expect(x.nichtPruefbar).toBe(true);
      expect(x.befund).toContain(fehler);
      expect(x.fix).toMatch(/Fix|prüfen/);
    }
    expect(r.filter((x) => !x.ok)).toHaveLength(5);
  });

  const SA_FALSCH: [string, unknown][] = [
    ["security_and_analysis fehlt (kein Admin-Recht)", {}],
    ["security_and_analysis ist null", { security_and_analysis: null }],
    ["Antwort null", null],
    ["security_and_analysis ist leer", { security_and_analysis: {} }],
    ["Status unbekannt", { security_and_analysis: Object.fromEntries(Object.values(SA_SCHLUESSEL).map((k) => [k, { status: "paused" }])) }],
    ["Schlüssel ohne status", { security_and_analysis: Object.fromEntries(Object.values(SA_SCHLUESSEL).map((k) => [k, {}])) }],
  ];
  test.each(SA_FALSCH)("%s: fünf Punkte nicht prüfbar", (_, wert) => {
    const e = gesund();
    e.repo = { wert };
    const r = pruefe(e).filter((x) => Object.keys(SA_SCHLUESSEL).includes(x.punkt));
    expect(r).toHaveLength(5);
    for (const x of r) {
      expect(x.ok).toBe(false);
      expect(x.nichtPruefbar).toBe(true);
      expect(x.befund).toMatch(/\S/);
    }
  });

  test("ein einzelner fehlender Schlüssel trifft nur diesen Punkt", () => {
    const e = gesund();
    const s = sa() as Record<string, unknown>;
    delete s.secret_scanning_validity_checks;
    e.repo = { wert: { security_and_analysis: s } };
    const x = pruefe(e).filter((r) => !r.ok);
    expect(x.map((r) => r.punkt)).toEqual(["Validity Checks"]);
    expect(x[0].nichtPruefbar).toBe(true);
  });

  test("SHA-Pinning: Fehler und fehlendes Feld sind nicht prüfbar", () => {
    for (const actions of [{ fehler: "HTTP 404: Not Found" }, { wert: {} }, { wert: null }, { wert: { sha_pinning_required: "ja" } }]) {
      const e = gesund();
      e.actions = actions;
      const x = je(e, "SHA-Pinning");
      expect(x.ok).toBe(false);
      expect(x.nichtPruefbar).toBe(true);
      expect(x.fix).toMatch("fehler" in actions ? /Admin-Recht/ : /in den Einstellungen von Hand prüfen/);
    }
  });

  test("PVR: 422, 404 und leere Antwort sind nicht prüfbar", () => {
    for (const pvr of [{ fehler: "HTTP 422: Unprocessable" }, { fehler: "HTTP 404: Not Found" }, { wert: {} }, { wert: null }, { wert: { enabled: "true" } }]) {
      const e = gesund();
      e.pvr = pvr;
      const x = je(e, "PVR");
      expect(x.ok).toBe(false);
      expect(x.nichtPruefbar).toBe(true);
    }
  });

  test("Regeln nicht lesbar: Code-Scanning nicht prüfbar, kein OK", () => {
    const e = gesund();
    e.regeln = { fehler: "HTTP 404: Not Found" };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBe(true);
    expect(x.befund).toContain("HTTP 404");
  });

  test("Regeln mit Antwort null: kein Wurf, Code-Scanning ist Lücke, nicht OK", () => {
    const e = gesund();
    e.regeln = { wert: null };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(false);
  });

  test("security_and_analysis fehlt: Grund und Fix nennen das Admin-Recht", () => {
    const e = gesund();
    e.repo = { wert: {} };
    const x = je(e, "Secret Scanning");
    expect(x.befund).toMatch(/sichtbar nur mit Admin-Recht/);
    expect(x.fix).toMatch(/Admin-Recht/);
  });

  test("ein Fix der Quelle (fataler Token) gilt für alle Punkte", () => {
    const q = { fehler: "gh nicht angemeldet oder ohne Zugriff", fix: "erst den Token-Punkt beheben" };
    const r = pruefe({ repo: q, actions: q, regeln: q, pvr: q, spiegel: SPIEGEL });
    expect(r).toHaveLength(8);
    for (const x of r) {
      expect(x.ok).toBe(false);
      expect(x.nichtPruefbar).toBe(true);
      expect(x.fix).toBe("erst den Token-Punkt beheben");
    }
  });
});

describe("pruefeSicherheit: Code-Scanning gegen den Spiegel", () => {
  test("zwei fehlende Werkzeuge ergeben eine Zeile", () => {
    const e = gesund();
    e.spiegel = { name: "rs", codeScanning: [{ tool: "CodeQL" }, { tool: "Semgrep" }] };
    e.regeln = { wert: [] };
    const x = pruefe(e).filter((r) => r.punkt === "Code-Scanning");
    expect(x).toHaveLength(1);
    expect(x[0].befund).toMatch(/"CodeQL", "Semgrep" fehlt/);
    expect(x[0].fix).toContain('Ruleset "rs"');
    expect(x[0].befund).toContain("auf main");
    expect(x[0].fix).toContain('Ruleset "rs"');
    expect(x[0].befund).not.toMatch(/private Repos/);
  });

  test("nur eines von zwei Werkzeugen vorhanden: das fehlende wird genannt", () => {
    const e = gesund();
    e.spiegel = { codeScanning: [{ tool: "CodeQL" }, { tool: "Semgrep" }] };
    e.regeln = { wert: [cs("CodeQL")] };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(false);
    expect(x.befund).toMatch(/"Semgrep"/);
    expect(x.fix).toMatch(/das Ruleset/);
    expect(x.befund).not.toMatch(/"CodeQL"/);
  });

  test("Regel ohne parameters zählt als kein Werkzeug", () => {
    const e = gesund();
    e.regeln = { wert: [{ type: "code_scanning" }] };
    expect(je(e, "Code-Scanning").ok).toBe(false);
  });

  test("Spiegel ohne Werkzeug und live keins: Lücke", () => {
    const e = gesund();
    e.spiegel = { name: "rs" };
    e.regeln = { wert: [] };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBeUndefined();
  });

  test("Spiegel ohne Werkzeug, live eins: OK mit Hinweis", () => {
    const e = gesund();
    e.spiegel = undefined;
    e.regeln = { wert: [cs("CodeQL")] };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(true);
    expect(x.hinweis).toMatch(/codeScanning/);
  });

  test("privates Repo: der Befund nennt die Grenze der Rulesets", () => {
    const e = gesund();
    e.privat = true;
    e.regeln = { wert: [] };
    expect(je(e, "Code-Scanning").befund).toMatch(/private Repos auf GitHub Free/);
  });
});
