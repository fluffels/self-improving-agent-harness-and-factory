/** Lib der Sicherheitsprüfung (factory#388): Soll-Liste, Filter, Alerts, CodeQL, Bericht, Entscheidung. Reine Funktionen. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sicherheitspruefung-lib.mjs";

type Erg = { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; soll?: string; fix?: string };
type Soll = { punkte: string[]; manifeste: unknown[]; codeql: Record<string, string>; ausnahmen: { pfad: string; grund: string }[]; codeqlOhne: { sprache: string; grund: string }[] };
const L = raw as unknown as {
  ladeSollListe: (t: string) => Soll;
  filtere: (e: Erg[], p: string[]) => Erg[];
  pruefeAlerts: (a: { status: number | null; admin: boolean; repo: string }) => Erg;
  sollSprachen: (a: Record<string, unknown>) => string[];
  istSprachen: (a: Record<string, unknown>) => { sprachen?: string[]; fehler?: string; state?: string };
  pruefeCodeql: (a: Record<string, unknown>) => Erg;
  zelle: (t: string) => string;
  berichtTitel: (d: string) => string;
  berichtText: (a: Record<string, unknown>) => string;
  istTicket: (i: Record<string, unknown>, o: string, c: Record<string, unknown>) => boolean;
  entscheide: (a: Record<string, unknown>) => { aktion: string; grund: string };
  MARKER: string;
  TITEL_PRAEFIX: string;
  BERICHT_MAX: number;
};

const KERN = { punkte: ["Secret Scanning", "Required-Check", "Dependabot Alerts"], manifeste: [{ oekosystem: "npm", datei: "package.json" }], codeql: { JavaScript: "javascript-typescript", TypeScript: "javascript-typescript", Java: "java-kotlin" } };
const liste = (w: Record<string, unknown>) => JSON.stringify(w);

describe("ladeSollListe", () => {
  test("führt kern und projekt zusammen", () => {
    const s = L.ladeSollListe(liste({ kern: KERN, projekt: { punkte: ["PVR", "Secret Scanning"], manifeste: [{ oekosystem: "mix", datei: "mix.exs" }], ausnahmen: [{ pfad: "fixtures", grund: "Testdaten" }], codeqlOhne: [{ sprache: "python", grund: "Skripte" }] } }));
    expect(s.punkte).toEqual(["Secret Scanning", "Required-Check", "Dependabot Alerts", "PVR"]);
    expect(s.manifeste).toHaveLength(2);
    expect(s.ausnahmen[0].grund).toBe("Testdaten");
  });
  test("projekt ist optional", () => {
    expect(L.ladeSollListe(liste({ kern: KERN })).ausnahmen).toEqual([]);
  });
  test.each([
    ["kein JSON", "{"],
    ["kern fehlt", liste({ projekt: {} })],
    ["unbekannter Punkt", liste({ kern: { ...KERN, punkte: ["Erfunden"] } })],
    ["unbekannter Punkt im Projekt", liste({ kern: KERN, projekt: { punkte: ["Erfunden"] } })],
    ["Ausnahme ohne Grund", liste({ kern: KERN, projekt: { ausnahmen: [{ pfad: "x" }] } })],
    ["Ausnahme mit leerem Grund", liste({ kern: KERN, projekt: { ausnahmen: [{ pfad: "x", grund: " " }] } })],
    ["codeqlOhne ohne Grund", liste({ kern: KERN, projekt: { codeqlOhne: [{ sprache: "go" }] } })],
    ["unbekannter Schlüssel im Projekt", liste({ kern: KERN, projekt: { punkt: [] } })],
    ["unbekannter Schlüssel oben", liste({ kern: KERN, extra: 1 })],
    ["Ausnahme ohne Pfad", liste({ kern: KERN, projekt: { ausnahmen: [{ grund: "g" }] } })],
    ["Ausnahme kein Objekt", liste({ kern: KERN, projekt: { ausnahmen: ["x"] } })],
    ["Ausnahmen keine Liste", liste({ kern: KERN, projekt: { ausnahmen: {} } })],
    ["projekt kein Objekt", liste({ kern: KERN, projekt: "x" })],
    ["projekt eine Liste", liste({ kern: KERN, projekt: [] })],
    ["Manifest ohne Datei", liste({ kern: KERN, projekt: { manifeste: [{ oekosystem: "mix" }] } })],
  ])("Konfigurationsfehler: %s", (_n, text) => {
    expect(() => L.ladeSollListe(text)).toThrow(/Fix:/);
  });
});

describe("filtere", () => {
  const e: Erg[] = [{ punkt: "Secret Scanning", ok: true }, { punkt: "Required-Check build", ok: false }, { punkt: "Required-Check-Pin", ok: false }, { punkt: "Langfuse", ok: false }];
  test("Präfix mit Leerzeichen: Required-Check trifft Required-Check <ctx>, nicht Required-Check-Pin", () => {
    expect(L.filtere(e, ["Required-Check"]).map((x) => x.punkt)).toEqual(["Required-Check build"]);
    expect(L.filtere(e, ["Required-Check-Pin", "Secret Scanning"]).map((x) => x.punkt)).toEqual(["Secret Scanning", "Required-Check-Pin"]);
  });
  test("fehlt das Ergebnis eines Pflichtpunkts → nicht prüfbar; ein fehlender Kann-Punkt nicht", () => {
    const r = L.filtere([], ["Push Protection", "Required-Check"]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ punkt: "Push Protection", ok: false, nichtPruefbar: true });
  });
});

describe("pruefeAlerts", () => {
  test.each([
    [204, true, true, false],
    [404, true, false, false],
    [404, false, false, true],
    [403, true, false, true],
    [null, true, false, true],
  ])("Status %s, Admin %s", (status, admin, ok, nicht) => {
    const r = L.pruefeAlerts({ status, admin, repo: "o/r" });
    expect(r.ok).toBe(ok);
    expect(r.nichtPruefbar === true).toBe(nicht);
  });
  test("404 mit Admin-Recht nennt den schreibenden Befehl nur als Text nach Pre-Flight-Freigabe", () => {
    expect(L.pruefeAlerts({ status: 404, admin: true, repo: "o/r" }).fix).toMatch(/Pre-Flight-Freigabe: gh api -X PUT repos\/o\/r\/vulnerability-alerts/);
  });
});

describe("CodeQL-Sprachen", () => {
  const kern = KERN.codeql;
  test("Soll aus languages, actions bei Workflows, abzüglich codeqlOhne", () => {
    expect(L.sollSprachen({ languages: { JavaScript: 1, TypeScript: 2, Shell: 3, Java: 4 }, kern, workflows: true })).toEqual(["actions", "java-kotlin", "javascript-typescript"]);
    expect(L.sollSprachen({ languages: { Java: 4 }, kern, workflows: true, ohne: [{ sprache: "java-kotlin" }, { sprache: "actions" }] })).toEqual([]);
  });
  test("Ist aus dem Modul codeql oder dem Default-Setup (normalisiert)", () => {
    expect(L.istSprachen({ config: { module: ["codeql"], codeql: { sprachen: ["javascript-typescript", "actions"] } } }).sprachen).toEqual(["javascript-typescript", "actions"]);
    expect(L.istSprachen({ config: {}, defaultSetup: { wert: { state: "configured", languages: ["javascript", "typescript", "java", "kotlin", "c", "cpp"] } } }).sprachen).toEqual(["javascript-typescript", "javascript-typescript", "java-kotlin", "java-kotlin", "c-cpp", "c-cpp"]);
    expect(L.istSprachen({ config: {}, defaultSetup: { wert: { state: "not-configured", languages: ["java"] } } })).toEqual({ sprachen: [], state: "not-configured" });
    expect(L.istSprachen({ config: {}, defaultSetup: { fehler: "HTTP 403" } }).fehler).toBe("HTTP 403");
  });
  test("fehlende Sprache → Lücke mit Soll; vollständig → gut; nicht lesbar → nicht prüfbar", () => {
    const basis = { languages: { Java: 1, JavaScript: 1 }, kern, workflows: true, ohne: [] };
    const luecke = L.pruefeCodeql({ ...basis, ist: { sprachen: ["javascript-typescript", "actions"] } });
    expect(luecke).toMatchObject({ ok: false });
    expect(luecke.befund).toContain("java-kotlin");
    expect(luecke.soll).toContain("java-kotlin");
    expect(L.pruefeCodeql({ ...basis, ohne: [{ sprache: "java-kotlin" }], ist: { sprachen: ["javascript-typescript", "actions"] } })).toEqual({ punkt: "CodeQL-Sprachen", ok: true });
    expect(L.pruefeCodeql({ ...basis, ist: { fehler: "HTTP 403" } })).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(L.pruefeCodeql({ ...basis, languages: undefined, ist: { sprachen: [] } })).toMatchObject({ nichtPruefbar: true });
  });
});

describe("Bericht", () => {
  test("zelle maskiert | Backtick Umbruch Klammern und @", () => {
    const z = L.zelle("a|b`c\nd<x>@e");
    expect(z).not.toMatch(/[`\n<>]/);
    expect(z).toContain("a\\|b");
    expect(z).not.toContain("@e");
    expect(L.zelle("x".repeat(1000)).length).toBeLessThan(500);
  });
  const abw: Erg[] = [{ punkt: "Required-Check build", ok: false, befund: "fehlt", fix: "ergänzen" }, { punkt: "Dependabot-Abdeckung npm /a|b", ok: false, befund: "kein Eintrag", soll: "ein Eintrag", fix: "x" }];
  test("Tabelle mit Ist, Soll, Fix, Marker und Ausnahmen mit Grund", () => {
    const t = L.berichtText({ abweichungen: abw, ausnahmen: [{ pfad: "fixtures", grund: "Testdaten" }], codeqlOhne: [{ sprache: "python", grund: "Skripte" }], datum: "2026-11-12" });
    expect(t.startsWith(L.MARKER)).toBe(true);
    expect(t).toContain("| Punkt | Ist | Soll | Fix |");
    expect(t).toContain("| Required-Check build | fehlt | alle Pflicht-Checks im Ruleset | ergänzen |");
    expect(t).toContain("npm /a\\|b | kein Eintrag | ein Eintrag | x |");
    expect(t).toContain("Dependabot-Ausnahme `fixtures`: Testdaten");
    expect(t).toContain("CodeQL ohne `python`: Skripte");
    expect(L.berichtTitel("2026-11-12")).toBe("🛡️ Sicherheitsprüfung 2026-11");
  });
  test("Länge gedeckelt", () => {
    const viele = Array.from({ length: 4000 }, (_, i) => ({ punkt: `P${i}`, ok: false, befund: "b".repeat(100), fix: "f".repeat(100) }));
    const t = L.berichtText({ abweichungen: viele, datum: "2026-11-12" });
    expect(t.length).toBeLessThanOrEqual(L.BERICHT_MAX);
    expect(t).toContain("gekürzt");
  });
});

describe("entscheide", () => {
  const config = { labels: { forum: "forum" } };
  const abw = [{ punkt: "x", ok: false }];
  const ticket = (extra: Record<string, unknown> = {}) => ({ number: 7, title: `${L.TITEL_PRAEFIX}2026-10`, body: `${L.MARKER}\nText`, user: { login: "o", type: "User" }, labels: [], ...extra });
  test("keine Abweichung → nichts", () => {
    expect(L.entscheide({ abweichungen: [], offene: [], owner: "o", config }).aktion).toBe("nichts");
  });
  test("Negativfall: offenes vertrautes Ticket (auch anderer Monat) → nichts", () => {
    const e = L.entscheide({ abweichungen: abw, offene: [ticket()], owner: "o", config });
    expect(e.aktion).toBe("nichts");
    expect(e.grund).toContain("#7");
  });
  test("Ticket eines Fremden mit Marker zählt nicht; Fremdeingang-Label zählt nicht", () => {
    expect(L.entscheide({ abweichungen: abw, offene: [ticket({ user: { login: "fremd", type: "User" } })], owner: "o", config }).aktion).toBe("anlegen");
    expect(L.istTicket(ticket({ labels: ["forum"] }), "o", config)).toBe(false);
  });
  test("Titel oder Marker fehlt → zählt nicht; sonst anlegen", () => {
    expect(L.istTicket(ticket({ title: "anderes" }), "o", config)).toBe(false);
    expect(L.istTicket(ticket({ body: "ohne" }), "o", config)).toBe(false);
    expect(L.entscheide({ abweichungen: abw, offene: [], owner: "o", config }).aktion).toBe("anlegen");
  });
});
