/* Harness-Doctor, Sicherheitspunkte (factory#116): `pruefeSicherheit` ist pur. Jeder Test verfälscht genau eine Quelle und erwartet genau diesen Punkt;
 * die Negativfälle (Endpunkt-Fehler, fehlendes Feld) dürfen nie OK ergeben. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { analysePunkt as rawAnalyse, LINK_SICHERHEIT as rawLinks, SICHERHEIT_PUNKTE as rawPunkte, pruefeSicherheit as rawPruefe } from "../scripts/harness-doctor-sicherheit.mjs";

type Quelle = { wert?: unknown; fehler?: string; fix?: string };
interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string; link?: string; hinweis?: string }
interface Eingabe { repo: Quelle; actions: Quelle; regeln: Quelle; pvr: Quelle; spiegel?: unknown; branch?: string; privat?: boolean }
const pruefe = rawPruefe as (e: Eingabe) => Ergebnis[];
const PUNKTE = rawPunkte as string[];
const LINKS = rawLinks as Record<string, string>;
const analysePunkt = rawAnalyse as (punkt: string, repo: Quelle) => Ergebnis;

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
    expect(luecken[0].fix).not.toMatch(/PATCH|POST/);
    const nennt = /gh api -X PUT/.test(luecken[0].fix ?? "");
    expect(nennt).toBe(punkt === "PVR" || punkt === "SHA-Pinning");
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

  test("Regeln mit Antwort null: kein Wurf, Code-Scanning ist nicht prüfbar (keine belegte Lücke), nicht OK", () => {
    const e = gesund();
    e.regeln = { wert: null };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBe(true);
    expect(x.befund).toMatch(/Regeln auf main.*keine Liste/);
  });

  test("ein Punkt ohne Zuordnung ist nicht prüfbar statt Wurf", () => {
    const x = analysePunkt("Unbekannt", { wert: {} });
    expect(x).toMatchObject({ punkt: "Unbekannt", ok: false, nichtPruefbar: true });
    expect(x.befund).toMatch(/Unbekannt.*keine Prüfung/);
  });

  test("security_and_analysis fehlt: Grund und Fix nennen das Admin-Recht", () => {
    const e = gesund();
    e.repo = { wert: {} };
    const x = je(e, "Secret Scanning");
    expect(x.befund).toMatch(/sichtbar nur mit Admin-Recht/);
    expect(x.fix).toMatch(/Admin-Recht/);
    expect(x.link).toBe(LINKS["Secret Scanning"]);
  });

  test("ein Fix der Quelle (fataler Token) gilt für alle Punkte", () => {
    const q = { fehler: "gh nicht angemeldet oder ohne Zugriff", fix: "erst den Token-Punkt beheben" };
    const r = pruefe({ repo: q, actions: q, regeln: q, pvr: q, spiegel: SPIEGEL });
    expect(r).toHaveLength(8);
    for (const x of r) {
      expect(x.ok).toBe(false);
      expect(x.nichtPruefbar).toBe(true);
      expect(x.fix).toBe("erst den Token-Punkt beheben");
      expect(x.link).toBe(LINKS[x.punkt]);
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

describe("pruefeSicherheit: Fix-Texte mit Befehl nach Pre-Flight (L10)", () => {
  test("PVR nennt den PUT-Befehl und die Pre-Flight-Freigabe", () => {
    const e = gesund();
    e.pvr = { wert: { enabled: false } };
    const x = je(e, "PVR");
    expect(x.fix).toContain("nach Pre-Flight-Freigabe: gh api -X PUT repos/<repo>/private-vulnerability-reporting");
  });

  test("SHA-Pinning übernimmt allowed_actions aus der gelesenen Antwort", () => {
    const e = gesund();
    e.actions = { wert: { enabled: true, allowed_actions: "selected", sha_pinning_required: false } };
    const x = je(e, "SHA-Pinning");
    expect(x.fix).toContain("gh api -X PUT repos/<repo>/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true");
  });

  test("SHA-Pinning ohne allowed_actions in der Antwort: Platzhalter statt geratenem Wert", () => {
    const e = gesund();
    e.actions = { wert: { sha_pinning_required: false } };
    expect(je(e, "SHA-Pinning").fix).toContain("-f allowed_actions=<Ist-Wert aus der Antwort>");
  });
});

describe("pruefeSicherheit: Persönliches Konto kennt die Schalter nicht (L33)", () => {
  const aus = (typ: string): Eingabe => {
    const e = gesund();
    e.repo = { wert: { owner: { type: typ }, security_and_analysis: sa(["secret_scanning_non_provider_patterns", "secret_scanning_validity_checks"]) } };
    return e;
  };
  test.each(["Non-Provider-Patterns", "Validity Checks"])("User: %s ist OK mit Hinweis", (punkt) => {
    const x = je(aus("User"), punkt);
    expect(x.ok).toBe(true);
    expect(x.hinweis).toContain("für Repos eines persönlichen Kontos nicht angeboten");
  });
  test.each(["Non-Provider-Patterns", "Validity Checks"])("Organisation: %s bleibt Lücke mit Secret-Protection-Fix", (punkt) => {
    const x = je(aus("Organization"), punkt);
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBeUndefined();
    expect(x.fix).toContain("GitHub Secret Protection nötig");
  });
  test("ohne owner.type bleibt es eine Lücke (kein Beleg für ein persönliches Konto)", () => {
    const e = aus("User");
    e.repo = { wert: { security_and_analysis: sa(["secret_scanning_validity_checks"]) } };
    expect(je(e, "Validity Checks").ok).toBe(false);
  });
  test("Dependabot Security Updates bleibt auch im persönlichen Konto eine Lücke", () => {
    const e = gesund();
    e.repo = { wert: { owner: { type: "User" }, security_and_analysis: sa(["dependabot_security_updates"]) } };
    expect(je(e, "Dependabot Security Updates").ok).toBe(false);
  });
});

describe("pruefeSicherheit: Code-Scanning vergleicht auch die Schwellen (L3)", () => {
  const spiegelMitSchwelle = { name: "rs", codeScanning: [{ tool: "CodeQL", sicherheitsSchwelle: "high_or_higher", alertSchwelle: "errors" }] };
  const regel = (sec: string, alert: string) => ({ type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL", security_alerts_threshold: sec, alerts_threshold: alert }] } });
  test("gleiche Schwellen: gut", () => {
    const e = gesund();
    e.spiegel = spiegelMitSchwelle;
    e.regeln = { wert: [regel("high_or_higher", "errors")] };
    expect(je(e, "Code-Scanning").ok).toBe(true);
  });
  test("Spiegel ohne Schwelle: die Live-Schwelle wird nicht verglichen", () => {
    const e = gesund();
    e.regeln = { wert: [regel("none", "none")] };
    expect(je(e, "Code-Scanning").ok).toBe(true);
  });
  test("abweichende Sicherheits-Schwelle: Lücke", () => {
    const e = gesund();
    e.spiegel = spiegelMitSchwelle;
    e.regeln = { wert: [regel("none", "errors")] };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(false);
    expect(x.befund).toMatch(/security_alerts_threshold.*none.*high_or_higher/);
  });
  test("abweichende Alert-Schwelle: Lücke", () => {
    const e = gesund();
    e.spiegel = spiegelMitSchwelle;
    e.regeln = { wert: [regel("high_or_higher", "none")] };
    const x = je(e, "Code-Scanning");
    expect(x.ok).toBe(false);
    expect(x.befund).toMatch(/alerts_threshold.*none.*errors/);
  });
});
