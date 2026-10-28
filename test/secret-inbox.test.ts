import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/secret-inbox.mjs";

type Befund = { quelle: string; typ: string; ort: string; commit: string; kennung: string };
type Ort = { path?: string; start_line?: number; commit_sha?: string } | null;
type Plan = { art: string; nummer?: number; body?: string; neue?: string[]; ungelesen?: string[]; schliessen?: number[] };
const S = raw as unknown as {
  ZIEL_TITEL: string;
  CHECK_TITEL: string;
  befundeAusGitleaks: (b: unknown) => Befund[];
  befundeAusAlerts: (l: unknown, orte?: Map<number, Ort>) => Befund[];
  issueBody: (b: Befund[]) => string;
  checkBody: (repo?: string) => string;
  plane: (a: { befunde: Befund[]; offenesIssue: { number: number; body: string } | null; gelesen?: Set<string> }) => Plan;
  planeCheck: (a: { offene: { number: number }[]; repo?: string }) => Plan;
  statusAus: (e: unknown) => string | null;
  lauf: (a: { io: Record<string, unknown>; trocken?: boolean }) => number;
  main: (argv: string[], deps: Record<string, unknown>) => Promise<number>;
};

// Offensichtlich fiktive, zusammengesetzte Werte: kein Scanner soll anschlagen, der Test prüft nur, dass sie nie im Text landen.
const WERT = ["ghp", "_", "FIKTIV", "NUR", "TESTWERT"].join("");
const MATCH = ["token", " = ", `"${WERT}"`].join("");
const gl = (o: Record<string, unknown> = {}) => ({
  RuleID: "github-pat",
  File: "src/a.ts",
  StartLine: 7,
  Commit: "0123456789abcdef0123456789abcdef01234567",
  Fingerprint: "0123456789abcdef:src/a.ts:github-pat:7",
  Secret: WERT,
  Match: MATCH,
  ...o,
});
const alert = (o: Record<string, unknown> = {}) => ({ number: 4, state: "open", secret_type_display_name: "GitHub Personal Access Token", html_url: "https://example.invalid/alerts/4", secret: WERT, ...o });

describe("Feldauswahl", () => {
  test("gitleaks: nur Regel, Datei:Zeile, Commit (gekürzt), Fingerprint", () => {
    expect(S.befundeAusGitleaks([gl()])).toEqual([{ quelle: "gitleaks", typ: "github-pat", ort: "src/a.ts:7", commit: "0123456789ab", kennung: "0123456789abcdef:src/a.ts:github-pat:7" }]);
  });
  test("Alerts: nur offene, mit Typ, Nummer, URL und erstem Fundort", () => {
    const orte = new Map<number, Ort>([[4, { path: "x.env", start_line: 2, commit_sha: "abcdef0123456789" }]]);
    expect(S.befundeAusAlerts([alert(), alert({ number: 5, state: "resolved" })], orte)).toEqual([
      { quelle: "github-alert", typ: "GitHub Personal Access Token", ort: "x.env:2", commit: "abcdef012345", kennung: "#4 https://example.invalid/alerts/4" },
    ]);
  });
  test("Alert ohne Fundort bekommt `-`", () => expect(S.befundeAusAlerts([alert()])[0].ort).toBe("-"));
  test("keine Liste wirft", () => {
    expect(() => S.befundeAusGitleaks({})).toThrow();
    expect(() => S.befundeAusGitleaks(null)).toThrow();
    expect(() => S.befundeAusAlerts("x")).toThrow();
    expect(() => S.befundeAusAlerts([alert({ number: "4" })])).toThrow();
  });
  test("fehlende Felder: Zeile `?`, leere Zelle `-`, Eintrag null wirft nicht", () => {
    expect(S.befundeAusGitleaks([{ RuleID: "r" }, null])).toEqual([
      { quelle: "gitleaks", typ: "r", ort: "-:?", commit: "-", kennung: "-" },
      { quelle: "gitleaks", typ: "-", ort: "-:?", commit: "-", kennung: "-" },
    ]);
    expect(S.befundeAusAlerts([alert()], new Map([[4, { path: "x" }]]))[0].ort).toBe("x:?");
    expect(S.befundeAusAlerts([null, alert()])).toHaveLength(1);
  });
  test("Tabellenzellen: Pipes und Umbrüche werden entschärft", () => {
    const [b] = S.befundeAusGitleaks([gl({ File: "a|b\nc`d" })]);
    expect(b.ort).toBe("a b c d:7");
  });
});

describe("Negativfall: der Wert landet nie im Text", () => {
  const befunde = [...S.befundeAusGitleaks([gl()]), ...S.befundeAusAlerts([alert()])];
  test("weder Wert noch Match in Befunden und Body", () => {
    const text = JSON.stringify(befunde) + S.issueBody(befunde);
    expect(text).not.toContain(WERT);
    expect(text).not.toContain("FIKTIV");
    expect(text).not.toContain(MATCH);
  });
  test("auch das ganze Log eines Laufs bleibt wertfrei", () => {
    const log: string[] = [];
    const io = io0({ ladeBericht: () => JSON.stringify([gl()]), ladeAlerts: () => [alert()], log: (m: string) => log.push(m) });
    S.lauf({ io, trocken: true });
    S.lauf({ io });
    expect(log.join("\n") + JSON.stringify(io.gesehen)).not.toContain("FIKTIV");
  });
  test("Wächter der Probe: ein Durchreichen der Rohfelder würde den Wert zeigen", () => {
    expect(JSON.stringify([gl()])).toContain(WERT);
  });
});

describe("plane (Secret-Ticket)", () => {
  const b = S.befundeAusGitleaks([gl()]);
  test("Fund ohne Ticket: anlegen, Body mit fester Reihenfolge", () => {
    const p = S.plane({ befunde: b, offenesIssue: null });
    expect(p.art).toBe("anlegen");
    const body = p.body ?? "";
    expect(body).toContain("| gitleaks | github-pat | src/a.ts:7 |");
    const i1 = body.indexOf("1. **Beim Anbieter widerrufen");
    const i2 = body.indexOf("2. **Erst danach");
    const i3 = body.indexOf("3. **Historie erst zuletzt");
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
    expect(body).toContain(".gitleaksignore");
  });
  test("unveränderter Fund: nichts; neuer Fund: aktualisieren mit neuer Kennung", () => {
    const body = S.issueBody(b);
    expect(S.plane({ befunde: b, offenesIssue: { number: 9, body } }).art).toBe("nichts");
    const mehr = [...b, ...S.befundeAusGitleaks([gl({ Fingerprint: "neu:fp", StartLine: 9 })])];
    const p = S.plane({ befunde: mehr, offenesIssue: { number: 9, body } });
    expect(p).toMatchObject({ art: "aktualisieren", nummer: 9, neue: ["neu:fp"] });
  });
  test("0 Funde: offenes Ticket wird geschlossen, ohne Ticket nichts", () => {
    expect(S.plane({ befunde: [], offenesIssue: { number: 9, body: S.issueBody(b) } })).toEqual({ art: "schliessen", nummer: 9 });
    expect(S.plane({ befunde: [], offenesIssue: null }).art).toBe("nichts");
  });
  test("fail-closed: nicht lesbare Quelle der Tabelle hält das Ticket offen", () => {
    const body = S.issueBody(S.befundeAusAlerts([alert()]));
    const p = S.plane({ befunde: [], offenesIssue: { number: 9, body }, gelesen: new Set(["gitleaks"]) });
    expect(p).toMatchObject({ art: "nichts", nummer: 9, ungelesen: ["github-alert"] });
    expect(S.plane({ befunde: [], offenesIssue: { number: 9, body }, gelesen: new Set(["gitleaks", "github-alert"]) }).art).toBe("schliessen");
  });
  test("viele Funde werden gekürzt", () => {
    const viele = S.befundeAusGitleaks(Array.from({ length: 60 }, (_, i) => gl({ Fingerprint: `fp${i}` })));
    expect(S.issueBody(viele)).toContain("… und 10 weitere");
  });
});

describe("Prüf-Ticket", () => {
  test("keins offen: anlegen; eins: wiederverwenden; mehrere: genau das kleinste bleibt", () => {
    expect(S.planeCheck({ offene: [] }).art).toBe("anlegen");
    expect(S.planeCheck({ offene: [{ number: 12 }] })).toEqual({ art: "nichts", nummer: 12, schliessen: [] });
    expect(S.planeCheck({ offene: [{ number: 30 }, { number: 12 }, { number: 20 }] })).toEqual({ art: "nichts", nummer: 12, schliessen: [20, 30] });
  });
  test("Text: Checkliste der vier Tabs, `--jq` ohne Feld secret, Schließ-Regeln", () => {
    const t = S.checkBody("o/r");
    for (const tab of ["Secret-Scanning-Tab", "Code-Scanning-Tab", "Dependabot-Alerts", "Security-Advisories"]) expect(t).toContain(tab);
    expect(t).toContain("secret-scanning/alerts --jq '.[] | {number,state,secret_type_display_name,html_url}'");
    expect(t).not.toMatch(/\{[^}]*\bsecret\b[^}]*\}/);
    expect(t).toContain("schließt sich NIE selbst");
    expect(t).toContain("`revoked`");
    expect(t).toContain("`false_positive`");
    expect(t).toContain("schließt sich selbst, sobald der Fund behoben ist");
    expect(t.match(/^- \[ \]/gm)).toHaveLength(4);
  });
});

/** Test-IO mit Aufzeichnung der Aktionen. */
function io0(o: Record<string, unknown> = {}) {
  const gesehen: unknown[] = [];
  return {
    repo: "o/r",
    gesehen,
    ladeAlerts: () => [],
    ladeOrt: () => null,
    ladeKontext: () => ({ offenesIssue: null, checkIssues: [] }),
    projectToken: "t",
    log: () => {},
    legeIssueAn: (titel: string, body: string) => (gesehen.push(["anlegen", titel, body]), "77"),
    sortiereEin: (nr: string, art: string) => (gesehen.push(["oben", nr, art]), true),
    aktualisiere: (nr: number, body: string) => gesehen.push(["aktualisieren", nr, body]),
    kommentiere: (nr: number, text: string) => gesehen.push(["kommentar", nr, text]),
    schliesse: (nr: number, text: string) => gesehen.push(["schliessen", nr, text]),
    ...o,
  } as Record<string, unknown> & { gesehen: unknown[] };
}

describe("lauf", () => {
  const bericht = (liste: unknown[]) => () => JSON.stringify(liste);
  test("Fund: legt beide Tickets an und sortiert beide ganz oben ein", () => {
    const io = io0({ ladeBericht: bericht([gl()]) });
    expect(S.lauf({ io })).toBe(0);
    const titel = io.gesehen.filter((g) => (g as string[])[0] === "anlegen").map((g) => (g as string[])[1]);
    expect(titel).toEqual([S.ZIEL_TITEL, S.CHECK_TITEL]);
    expect(io.gesehen.filter((g) => (g as string[])[0] === "oben").map((g) => (g as string[])[2])).toEqual(["security", "security-tabs"]);
  });
  test("Idempotenz: genau ein Prüf-Ticket offen, kein zweites angelegt, Doppelte geschlossen", () => {
    const io = io0({ ladeBericht: bericht([]), ladeKontext: () => ({ offenesIssue: null, checkIssues: [{ number: 5 }, { number: 8 }] }) });
    expect(S.lauf({ io })).toBe(0);
    expect(io.gesehen.some((g) => (g as string[])[0] === "anlegen")).toBe(false);
    expect(io.gesehen).toEqual([["schliessen", 8, expect.any(String)]]);
  });
  test("ohne PROJECT_TOKEN: Ticket entsteht, Warnung statt Einsortieren", () => {
    const log: string[] = [];
    const io = io0({ ladeBericht: bericht([]), projectToken: "", log: (m: string) => log.push(m) });
    expect(S.lauf({ io })).toBe(0);
    expect(log.some((m) => m.startsWith("::warning::PROJECT_TOKEN fehlt"))).toBe(true);
  });
  test("Einsortieren schlägt fehl: Exit 1", () => {
    expect(S.lauf({ io: io0({ ladeBericht: bericht([]), sortiereEin: () => false }) })).toBe(1);
  });
  test("403 und 404 der Alerts: GRENZE-Zeile, Lauf geht mit gitleaks weiter", () => {
    for (const status of ["403", "404"]) {
      const log: string[] = [];
      const io = io0({
        ladeBericht: bericht([gl()]),
        ladeAlerts: () => {
          throw new Error(`gh: Resource not accessible (HTTP ${status})`);
        },
        log: (m: string) => log.push(m),
      });
      expect(S.lauf({ io })).toBe(0);
      expect(log).toContain(`GRENZE GitHub-Secret-Alerts nicht lesbar (${status}): Token mit „Secret scanning alerts: read“ nötig`);
      expect(io.gesehen.some((g) => (g as string[])[1] === S.ZIEL_TITEL)).toBe(true);
    }
  });
  test("anderer Alert-Fehler (500): Exit 1", () => {
    const io = io0({
      ladeBericht: bericht([]),
      ladeAlerts: () => {
        throw new Error("HTTP 500");
      },
    });
    expect(S.lauf({ io })).toBe(1);
  });
  test("Alerts ohne Listenform: Exit 1 (nie still „keine Funde“)", () => {
    expect(S.lauf({ io: io0({ ladeBericht: bericht([]), ladeAlerts: () => ({}) }) })).toBe(1);
  });
  test("offene Tickets nicht lesbar: Exit 1, nichts geändert", () => {
    const io = io0({
      ladeBericht: bericht([gl()]),
      ladeKontext: () => {
        throw new Error("HTTP 500");
      },
    });
    expect(S.lauf({ io })).toBe(1);
    expect(io.gesehen).toEqual([]);
  });
  test("ungültiger oder nicht lesbarer Bericht: Exit 1, nichts geändert", () => {
    for (const lade of [() => "{kein json", () => "{}", () => "null", () => {
      throw new Error("ENOENT");
    }]) {
      const io = io0({ ladeBericht: lade });
      expect(S.lauf({ io })).toBe(1);
      expect(io.gesehen).toEqual([]);
    }
  });
  test("0 Funde: offenes Secret-Ticket wird geschlossen", () => {
    const body = S.issueBody(S.befundeAusGitleaks([gl()]));
    const io = io0({ ladeBericht: bericht([]), ladeKontext: () => ({ offenesIssue: { number: 3, body }, checkIssues: [{ number: 5 }] }) });
    expect(S.lauf({ io })).toBe(0);
    expect(io.gesehen).toEqual([["schliessen", 3, expect.any(String)]]);
  });
  test("Alert-Ticket bleibt bei 403 offen (Quelle nicht lesbar)", () => {
    const body = S.issueBody(S.befundeAusAlerts([alert()]));
    const io = io0({
      ladeBericht: bericht([]),
      ladeAlerts: () => {
        throw new Error("HTTP 403");
      },
      ladeKontext: () => ({ offenesIssue: { number: 3, body }, checkIssues: [{ number: 5 }] }),
    });
    expect(S.lauf({ io })).toBe(0);
    expect(io.gesehen).toEqual([]);
  });
  test("bestehendes Ticket mit neuem Fund: aktualisieren plus Kommentar", () => {
    const body = S.issueBody(S.befundeAusGitleaks([gl()]));
    const io = io0({ ladeBericht: bericht([gl(), gl({ Fingerprint: "neu:fp" })]), ladeKontext: () => ({ offenesIssue: { number: 3, body }, checkIssues: [{ number: 5 }] }) });
    expect(S.lauf({ io })).toBe(0);
    expect(io.gesehen.map((g) => (g as string[])[0])).toEqual(["aktualisieren", "kommentar"]);
  });
  test("--dry-run ändert nichts", () => {
    const log: string[] = [];
    const io = io0({ ladeBericht: bericht([gl()]), log: (m: string) => log.push(m) });
    expect(S.lauf({ io, trocken: true })).toBe(0);
    expect(io.gesehen).toEqual([]);
    expect(log.some((m) => m.startsWith("[dry-run] Secret-Ticket: anlegen"))).toBe(true);
  });
  test("ohne Bericht: nur Alerts, gitleaks-Ticket bleibt offen", () => {
    const body = S.issueBody(S.befundeAusGitleaks([gl()]));
    const io = io0({ ladeBericht: undefined, ladeKontext: () => ({ offenesIssue: { number: 3, body }, checkIssues: [{ number: 5 }] }) });
    expect(S.lauf({ io })).toBe(0);
    expect(io.gesehen).toEqual([]);
  });
});

describe("statusAus", () => {
  test("liest HTTP-Status aus Meldung oder stderr", () => {
    expect(S.statusAus(new Error("x (HTTP 403)"))).toBe("403");
    expect(S.statusAus({ stderr: "gh: Not Found (HTTP 404)" })).toBe("404");
    expect(S.statusAus(new Error("kaputt"))).toBeNull();
  });
});

describe("plane: Kennungen und Body-Vergleich", () => {
  const fp = (s: string) => gl({ Fingerprint: `0123456789abcdef:src/a.ts:github-pat:${s}` });
  test("neue Kennung wird exakt erkannt, auch wenn sie Teilstring einer alten ist (…:1 in …:12)", () => {
    const alt = S.befundeAusGitleaks([fp("12")]);
    const neu = S.befundeAusGitleaks([fp("12"), fp("1")]);
    const plan = S.plane({ befunde: neu, offenesIssue: { number: 3, body: S.issueBody(alt) } });
    expect(plan.art).toBe("aktualisieren");
    expect(plan.neue).toEqual([neu[1].kennung]);
  });
  test("Body mit CRLF (von Hand bearbeitet) gilt als unverändert", () => {
    const befunde = S.befundeAusGitleaks([gl()]);
    const body = S.issueBody(befunde).replace(/\n/g, "\r\n");
    expect(S.plane({ befunde, offenesIssue: { number: 3, body } })).toEqual({ art: "nichts", nummer: 3 });
  });
  test("Fenster: 50 Funde ohne Restzeile, 51 mit „und 1 weitere“", () => {
    const viele = (n: number) => S.befundeAusGitleaks(Array.from({ length: n }, (_, i) => gl({ Fingerprint: `fp:${i}` })));
    expect(S.issueBody(viele(50))).not.toMatch(/^… und \d+ weitere/m);
    expect(S.issueBody(viele(51))).toMatch(/^… und 1 weitere/m);
  });
});

describe("lauf: Fehlerpfade der Ticket-Aktionen und Log-Zweige", () => {
  const werfe = () => {
    throw new Error("HTTP 500");
  };
  const mitTicket = (befunde: unknown[], body: string) => ({ ladeBericht: () => JSON.stringify(befunde), ladeKontext: () => ({ offenesIssue: { number: 3, body }, checkIssues: [{ number: 5 }] }) });
  const bodyMit = (...f: unknown[]) => S.issueBody(S.befundeAusGitleaks(f));
  test("Anlegen wirft: Exit 1", () => {
    expect(S.lauf({ io: io0({ ladeBericht: () => JSON.stringify([gl()]), legeIssueAn: werfe }) })).toBe(1);
  });
  test("Aktualisieren wirft: Exit 1", () => {
    expect(S.lauf({ io: io0({ ...mitTicket([gl(), gl({ Fingerprint: "n:1" })], bodyMit(gl())), aktualisiere: werfe }) })).toBe(1);
  });
  test("Kommentar zu neuen Funden wirft: Exit 1", () => {
    expect(S.lauf({ io: io0({ ...mitTicket([gl(), gl({ Fingerprint: "n:1" })], bodyMit(gl())), kommentiere: werfe }) })).toBe(1);
  });
  test("Schließen des Secret-Tickets wirft: Exit 1", () => {
    expect(S.lauf({ io: io0({ ...mitTicket([], bodyMit(gl())), schliesse: werfe }) })).toBe(1);
  });
  test("Schließen eines doppelten Prüf-Tickets wirft: Exit 1", () => {
    const io = io0({ ladeBericht: () => "[]", ladeKontext: () => ({ offenesIssue: null, checkIssues: [{ number: 5 }, { number: 8 }] }), schliesse: werfe });
    expect(S.lauf({ io })).toBe(1);
  });
  test("verschwundener Fund: aktualisiert, aber kein leerer „Neu seit“-Kommentar", () => {
    const io = io0(mitTicket([gl()], bodyMit(gl(), gl({ Fingerprint: "alt:2" }))));
    expect(S.lauf({ io })).toBe(0);
    expect(io.gesehen.map((g) => (g as string[])[0])).toEqual(["aktualisieren"]);
  });
  test("Quelle nicht lesbar: Warnung nennt Ticket und Quelle; sonst „nichts Neues“ im Log", () => {
    const log: string[] = [];
    const body = S.issueBody(S.befundeAusAlerts([alert()]));
    const io = io0({ ladeBericht: () => "[]", ladeAlerts: werfe, log: (m: string) => log.push(m), ladeKontext: () => ({ offenesIssue: { number: 3, body }, checkIssues: [{ number: 5 }] }) });
    S.lauf({ io });
    expect(log).toContain("::warning::Ticket #3 bleibt offen: Quelle(n) github-alert in diesem Lauf nicht lesbar.");
    const still: string[] = [];
    S.lauf({ io: io0({ ladeBericht: () => "[]", log: (m: string) => still.push(m), ladeKontext: () => ({ offenesIssue: null, checkIssues: [{ number: 5 }] }) }) });
    expect(still).toContain("Secret-Inbox: nichts Neues.");
  });
});

describe("main über Deps", () => {
  const config = { labels: { harness: "area:test" } };
  type Aufruf = { args: string[]; opt: unknown };
  function aufbau(o: { libs?: Record<string, unknown>; rohe?: unknown[]; offene?: unknown[]; bericht?: unknown[] } = {}) {
    const aufrufe: Aufruf[] = [];
    const platziert: unknown[][] = [];
    const log: string[] = [];
    const rohe = o.rohe ?? [];
    const offene = o.offene ?? [];
    const gh = {
      text: (args: string[], opt: unknown) => {
        aufrufe.push({ args, opt });
        if (args[0] === "issue" && args[1] === "create") return "https://github.com/o/ziel/issues/77\n";
        return args.includes("--slurp") ? "[[]]" : "";
      },
      json: (args: string[], opt: unknown) => (aufrufe.push({ args, opt }), { body: "" }),
    };
    const libs = {
      OWNER: "o",
      REPO: "o/r",
      ZIEL: "o/ziel",
      zielToken: () => "zt",
      ladeSammelKontext: () => ({ rohe, offene }),
      vertrauteIssues: (r: { user: { login: string } }[], owner: string) => r.filter((i) => i.user.login === owner),
      platziereOben: (...a: unknown[]) => platziert.push(a),
      ...o.libs,
    };
    const deps = { ladeConfig: () => config, ladeLibs: () => Promise.resolve(libs), lies: () => JSON.stringify(o.bericht ?? [gl()]), gh, log: (m: string) => log.push(m), err: (m: string) => log.push(m) };
    const erstellt = () => aufrufe.filter((a) => a.args[0] === "issue" && a.args[1] === "create").map((a) => a.args[a.args.indexOf("--title") + 1]);
    return { deps, aufrufe, platziert, log, erstellt };
  }
  const mitToken = async <T,>(fn: () => Promise<T>) => {
    const alt = process.env.PROJECT_TOKEN;
    process.env.PROJECT_TOKEN = "pt";
    try {
      return await fn();
    } finally {
      if (alt === undefined) delete process.env.PROJECT_TOKEN;
      else process.env.PROJECT_TOKEN = alt;
    }
  };
  test("ein fremdes Issue mit passendem Titel täuscht weder Secret- noch Prüf-Ticket vor (#1433)", async () => {
    const fremd = (number: number, titel: string) => ({ rohe: { number, title: titel, user: { login: "fremd" } }, offen: { number, titel } });
    const f = [fremd(5, S.CHECK_TITEL), fremd(6, S.ZIEL_TITEL)];
    const a = aufbau({ rohe: f.map((x) => x.rohe), offene: f.map((x) => x.offen) });
    expect(await mitToken(() => S.main(["--bericht", "b.json"], a.deps))).toBe(0);
    expect(a.erstellt()).toEqual([S.ZIEL_TITEL, S.CHECK_TITEL]);
    expect(a.aufrufe.some((x) => x.args.includes("PATCH") || x.args[1] === "close")).toBe(false);
  });
  test("ein vertrautes offenes Prüf-Ticket wird wiederverwendet (nicht neu angelegt)", async () => {
    const a = aufbau({ rohe: [{ number: 5, title: S.CHECK_TITEL, user: { login: "o" } }], offene: [{ number: 5, titel: S.CHECK_TITEL }] });
    expect(await mitToken(() => S.main(["--bericht", "b.json"], a.deps))).toBe(0);
    expect(a.erstellt()).toEqual([S.ZIEL_TITEL]);
  });
  test("Ziel-Repo ≠ eigenes Repo: Anlegen, Einsortieren und Token gehen ins Ziel-Repo, Alerts kommen aus dem eigenen", async () => {
    const a = aufbau();
    expect(await mitToken(() => S.main(["--bericht", "b.json"], a.deps))).toBe(0);
    const anlegen = a.aufrufe.filter((x) => x.args[1] === "create");
    expect(anlegen).toHaveLength(2);
    for (const c of anlegen) {
      expect(c.args[c.args.indexOf("--repo") + 1]).toBe("o/ziel");
      expect(c.opt).toEqual({ token: "zt" });
    }
    expect(a.platziert.map((p) => [p[1], p[3]])).toEqual([["security", "o/ziel"], ["security-tabs", "o/ziel"]]);
    expect(a.aufrufe.some((x) => x.args.some((s) => s.includes("repos/o/r/secret-scanning/alerts")))).toBe(true);
  });
  test("ohne ZIEL und zielToken in den Libs gilt das eigene Repo", async () => {
    const a = aufbau({ libs: { ZIEL: undefined, zielToken: undefined } });
    expect(await mitToken(() => S.main(["--bericht", "b.json"], a.deps))).toBe(0);
    const c = a.aufrufe.find((x) => x.args[1] === "create")!;
    expect(c.args[c.args.indexOf("--repo") + 1]).toBe("o/r");
    expect(c.opt).toEqual({ token: undefined });
    expect(a.platziert.map((p) => p[3])).toEqual([undefined, undefined]);
  });
  test("unbekanntes Flag, --bericht ohne Wert und nicht lesbare Config: Exit 2", async () => {
    expect(await S.main(["--gibtsnicht"], aufbau().deps)).toBe(2);
    expect(await S.main(["--bericht"], aufbau().deps)).toBe(2);
    const a = aufbau();
    const kaputt = () => {
      throw new Error("kaputt");
    };
    expect(await S.main([], { ...a.deps, ladeConfig: kaputt })).toBe(2);
  });
});

describe("main über Deps: bestehendes Secret-Ticket im Ziel-Repo", () => {
  const ticket = { rohe: [{ number: 6, title: "🔒 Security: Secret rotieren/widerrufen", user: { login: "o" } }], offene: [{ number: 6, titel: "🔒 Security: Secret rotieren/widerrufen" }] };
  const lauf = async (bericht: unknown[]) => {
    const aufrufe: { args: string[]; opt: unknown }[] = [];
    const gh = {
      text: (args: string[], opt: unknown) => (aufrufe.push({ args, opt }), args.includes("--slurp") ? "[[]]" : "https://github.com/o/ziel/issues/77\n"),
      json: (args: string[], opt: unknown) => (aufrufe.push({ args, opt }), { body: S.issueBody(S.befundeAusGitleaks([gl()])) }),
    };
    const libs = { OWNER: "o", REPO: "o/r", ZIEL: "o/ziel", zielToken: () => "zt", ladeSammelKontext: () => ({ ...ticket }), vertrauteIssues: (r: { user: { login: string } }[]) => r.filter((i) => i.user.login === "o"), platziereOben: () => undefined };
    const code = await S.main(["--bericht", "b.json"], { ladeConfig: () => ({ labels: { harness: "area:test" } }), ladeLibs: () => Promise.resolve(libs), lies: () => JSON.stringify(bericht), gh, log: () => {}, err: () => {} });
    return { code, aufrufe: aufrufe.filter((a) => !a.args.includes("--slurp")) };
  };
  test("neuer Fund: Ticket lesen, aktualisieren und kommentieren im Ziel-Repo mit Ziel-Token", async () => {
    const { code, aufrufe } = await lauf([gl(), gl({ Fingerprint: "neu:fp" })]);
    expect(code).toBe(0);
    const ziele = aufrufe.map((a) => a.args.join(" "));
    expect(ziele.some((a) => a === "api repos/o/ziel/issues/6")).toBe(true);
    expect(ziele.some((a) => a.startsWith("api -X PATCH repos/o/ziel/issues/6 "))).toBe(true);
    expect(ziele.some((a) => a.startsWith("api repos/o/ziel/issues/6/comments "))).toBe(true);
    for (const a of aufrufe.filter((x) => x.args.some((s) => s.includes("repos/o/ziel")))) expect(a.opt).toEqual({ token: "zt" });
  });
  test("keine Funde mehr: Schließen im Ziel-Repo", async () => {
    const { code, aufrufe } = await lauf([]);
    expect(code).toBe(0);
    const zu = aufrufe.find((a) => a.args[1] === "close");
    expect(zu?.args).toEqual(expect.arrayContaining(["6", "--repo", "o/ziel"]));
    expect(zu?.opt).toEqual({ token: "zt" });
  });
});

describe("main über Deps: Ticket des Ziel-Owners (Ziel-Owner ≠ eigener Owner)", () => {
  test("ein Ticket vom Owner des Ziel-Repos gilt als eigenes: es wird aktualisiert, nicht neu angelegt", async () => {
    const titel = "🔒 Security: Secret rotieren/widerrufen";
    const aufrufe: string[][] = [];
    const gh = {
      text: (args: string[]) => (aufrufe.push(args), args.includes("--slurp") ? "[[]]" : "https://github.com/z/ziel/issues/77\n"),
      json: () => ({ body: S.issueBody(S.befundeAusGitleaks([gl()])) }),
    };
    const libs = {
      OWNER: "o",
      REPO: "o/r",
      ZIEL: "z/ziel",
      ladeSammelKontext: () => ({ rohe: [{ number: 6, title: titel, user: { login: "z" } }], offene: [{ number: 6, titel }], owner: "z" }),
      vertrauteIssues: (r: { user: { login: string } }[], owner: string) => r.filter((i) => i.user.login === owner),
      platziereOben: () => undefined,
    };
    const deps = { ladeConfig: () => ({ labels: { harness: "area:test" } }), ladeLibs: () => Promise.resolve(libs), lies: () => JSON.stringify([gl(), gl({ Fingerprint: "neu:fp" })]), gh, log: () => {}, err: () => {} };
    expect(await S.main(["--bericht", "b.json"], deps)).toBe(0);
    expect(aufrufe.some((a) => a.includes("PATCH") && a.includes("repos/z/ziel/issues/6"))).toBe(true);
    expect(aufrufe.filter((a) => a[1] === "create").map((a) => a[a.indexOf("--title") + 1])).not.toContain(titel);
  });
});
