/**
 * Ticket-Drift-Lauf (factory#28, ADR 0033): Prüfungen der Lib, Verhaltenstest der Schreibgrenze und Wächter.
 * @probe-echte-dateien liest die echten Quellen `scripts/ticket-drift*.mjs` und `.github/workflows/ticket-drift.yml`.
 * Bewusste Grenze des statischen Wächters: er sucht verbotene gh-Verben als Wort in den Quellen; ein zur Laufzeit zusammengesetztes Verb erkennt nur der Verhaltenstest (Recorder).
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/ticket-drift-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as skriptRaw from "../scripts/ticket-drift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cfgRaw from "../scripts/projekt-config-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const lies = (p: string) => readFileSync(`${WURZEL}${p}`, "utf8");

type Issue = Record<string, unknown> & { number: number };
type Git = { shallow: boolean; existiert: (p: string) => boolean; zeilen: (p: string) => number; letzteAenderung: (p: string) => string | null; geaendertSeit: (p: string, s: string) => boolean };
type Ergebnis = { befunde: { nr: number; klasse: string; text: string }[]; geprueft: number; uebersprungen: number[]; hinweise: string[] };
const L = libRaw as unknown as {
  verweiseAus: (b: string, t: Set<string>) => { pfad: string; von: number | null; bis: number | null }[];
  pruefe: (i: Issue[], c: Record<string, unknown>) => Ergebnis;
  berichtText: (e: Ergebnis, o: { sha: string; datum: string }) => string;
  BERICHT_MARKER: string;
  BERICHT_MAX: number;
};
const S = skriptRaw as unknown as { gitSicht: (w: string, g?: (a: string[]) => string) => { tops: Set<string>; shallow: boolean; sha: string; git: Git }; main: (a: string[], d: Record<string, unknown>) => Promise<number>; waehleZiel: (i: Issue[], b: boolean, p: { owner: string; config: unknown }) => { art: string; nr?: number } };

const C = cfgRaw as unknown as { ladeProjektConfig: () => { labels: { forum: string; harness: string } } & Record<string, unknown>; zielRepoFuer: (l: string[], c: unknown) => string; spracheAus: (c: unknown) => { spezifikation: { blocker: string } } };
const config = C.ladeProjektConfig();
const sprache = C.spracheAus(config).spezifikation;
const TOPS = new Set(["scripts", "docs", "test"]);
const git = (extra: Partial<Git> = {}): Git => ({ shallow: false, existiert: () => true, zeilen: () => 100, letzteAenderung: () => null, geaendertSeit: () => false, ...extra });
const ctx = (g: Git) => ({ config, owner: "o", tops: TOPS, git: g, sprache });
const issue = (number: number, extra: Record<string, unknown> = {}): Issue => ({
  number, title: `Titel ${number}`, body: "", author: { login: "o", is_bot: false }, labels: [], assignees: [], updatedAt: "2026-10-01T00:00:00Z", blockedBy: { nodes: [] }, comments: [], ...extra,
});
const klassen = (e: Ergebnis) => e.befunde.map((b) => `${b.nr}:${b.klasse}`);

describe("verweiseAus", () => {
  test.each([
    ["`scripts/a.mjs`", ["scripts/a.mjs"]],
    ["`scripts/a.mjs:12`", ["scripts/a.mjs"]],
    ["`docs/x.md:3-9`", ["docs/x.md"]],
    ["`../scripts/x`", []],
    ["`scripts/../../etc/passwd`", []],
    ["`/etc/passwd`", []],
    ["`scripts/<nr>.mjs`", []],
    ["`scripts/*.mjs`", []],
    ["`@user/x`", []],
    ["`README.md`", []],
    ["`scripts/a-b_C.mjs`", ["scripts/a-b_C.mjs"]],
    ["`docs/`", []],
    ["`scripts//a.mjs`", []],
    ["`scripts/a.mjs:5` `scripts/a.mjs:5`", ["scripts/a.mjs"]],
    ["~~~\n`scripts/a.mjs`\n~~~", []],
    ["```\n`scripts/a.mjs`\n```\n`docs/x.md`\n```\nx\n```", ["docs/x.md"]],
    ["`scripts`", []],
    ["`unbekannt/x.md`", []],
    ["```\n`scripts/a.mjs`\n```", []],
  ])("%s", (body, erwartet) => {
    expect(L.verweiseAus(body, TOPS).map((v) => v.pfad)).toEqual(erwartet);
  });
  test("Zeilen von und bis", () => {
    expect(L.verweiseAus("`docs/x.md:3-9`", TOPS)[0]).toMatchObject({ von: 3, bis: 9 });
  });
});

describe("pruefe: Pfade und Zeilen", () => {
  const body = "Siehe `scripts/a.mjs:50`.";
  test.each([
    ["entfernt", git({ existiert: () => false, letzteAenderung: () => "2026-09-01T10:00:00+02:00" }), ["1:pfad-entfernt"]],
    ["nie vorhanden", git({ existiert: () => false }), []],
    ["hinter Dateiende", git({ zeilen: () => 10 }), ["1:zeile-ausserhalb"]],
    ["seit updatedAt geändert", git({ geaendertSeit: () => true }), ["1:zeile-verschoben"]],
    ["shallow: kein Git-Befund", git({ shallow: true, existiert: () => false, letzteAenderung: () => "2026-09-01T10:00:00Z", geaendertSeit: () => true }), []],
    ["unverändert", git(), []],
    ["shallow mit vorhandenem Pfad: keine Verschiebung", git({ shallow: true, geaendertSeit: () => true }), []],
    ["genau am Dateiende", git({ zeilen: () => 50 }), []],
    ["eine Zeile davor", git({ zeilen: () => 49 }), ["1:zeile-ausserhalb"]],
  ])("%s", (_n, g, erwartet) => {
    expect(klassen(L.pruefe([issue(1, { body })], ctx(g)))).toEqual(erwartet);
  });
  test("shallow nennt den Hinweis", () => {
    expect(L.pruefe([issue(1, { body })], ctx(git({ shallow: true }))).hinweise[0]).toMatch(/Shallow/);
  });
});

describe("pruefe: Blocker", () => {
  const blockerZeile = (nr: string) => `${sprache.blocker} ${nr}`;
  test.each([
    ["Text, geschlossen", { body: blockerZeile("#9") }, ["1:blocker-zu"]],
    ["Text, offen", { body: blockerZeile("#2") }, []],
    ["Text, offen aber Fremdeingang (übersprungen)", { body: blockerZeile("#5") }, []],
    ["nativ CLOSED", { blockedBy: { nodes: [{ number: 7, state: "CLOSED" }] } }, ["1:blocker-zu"]],
    ["nativ OPEN", { blockedBy: { nodes: [{ number: 7, state: "OPEN" }] } }, []],
    ["nativ ohne Zustand", { blockedBy: { nodes: [{ number: 7 }] } }, []],
    ["nativ CLOSED ohne Nummer", { blockedBy: { nodes: [{ state: "CLOSED" }] } }, []],
    ["fremdes Repo übersprungen", { body: blockerZeile("x/y#9") }, []],
  ])("%s", (_n, extra, erwartet) => {
    const andere = [issue(2, { title: "Ganz anderer Gegenstand hier" }), issue(5, { title: "Fremdes Thema dort", author: { login: "fremd", is_bot: false } })];
    expect(klassen(L.pruefe([issue(1, extra), ...andere], ctx(git())))).toEqual(erwartet);
  });
});

describe("pruefe: Duplikate", () => {
  const paar = (a: string, b: string) => [issue(1, { title: a }), issue(2, { title: b })];
  test.each([
    ["ähnliches Paar einmal", paar("Wiederkehrender Ticket-Drift-Check Routine einrichten", "Ticket-Drift-Check wiederkehrend Routine einrichten"), ["1:duplikat"]],
    ["genau 0,6 trifft", paar("alpha bravo charlie delta", "alpha bravo charlie echo"), ["1:duplikat"]],
    ["0,5 trifft nicht", paar("alpha bravo charlie delta", "alpha bravo charlie echo foxtrot"), []],
    ["genau drei Wörter genügen", paar("alpha bravo charlie", "alpha bravo charlie"), ["1:duplikat"]],
    ["Wörter mit drei Zeichen zählen", paar("abc def ghi", "abc def ghi"), ["1:duplikat"]],
    ["Groß-/Kleinschreibung egal", paar("ALPHA BRAVO CHARLIE", "alpha bravo charlie"), ["1:duplikat"]],
    ["Ziffern zählen als Wörter", paar("alpha bravo 1234", "alpha bravo 1234"), ["1:duplikat"]],
    ["Stoppwörter zählen nicht", paar("alpha bravo charlie und oder mit", "alpha bravo charlie"), ["1:duplikat"]],
    ["Serie", paar("Umbau 1/6: Cache Layer Schnitt vorbereiten", "Umbau 2/6: Cache Layer Schnitt vorbereiten"), []],
    ["nur ein Titel mit Serie", paar("Umbau 1/6: Cache Layer Schnitt vorbereiten", "Cache Layer Schnitt vorbereiten Umbau"), ["1:duplikat"]],
    ["zu kurz", paar("Cache leeren", "Cache leeren"), []],
    ["kurze Wörter zählen nicht", paar("ui ux db io Wartung", "ui ux db io Pflege"), []],
    ["Sammeltickets", paar("Harness-Härtung (gesammelt)", "Harness-Härtung (gesammelt)"), []],
    ["verschieden", paar("Wiederkehrender Ticket-Drift-Check Routine", "Browser Screenshot Vergleich Werkzeug"), []],
  ])("%s", (_n, issues, erwartet) => {
    expect(klassen(L.pruefe(issues, ctx(git())))).toEqual(erwartet);
  });
  test("mehrere Duplikate einer Nummer: nach Text sortiert", () => {
    const gleich = (nr: number) => issue(nr, { title: "alpha bravo charlie" });
    expect(L.pruefe([gleich(1), gleich(9), gleich(10)], ctx(git())).befunde.map((b) => `${b.nr}:${b.text}`)).toEqual(["1:Titel ähnlich zu #10 (1.00)", "1:Titel ähnlich zu #9 (1.00)", "9:Titel ähnlich zu #10 (1.00)"]);
  });
  test("Fremdeingang taucht in keinem Duplikat auf", () => {
    const fremd = { author: { login: "fremd", is_bot: false } };
    expect(L.pruefe([issue(1, { title: "alpha bravo charlie" }), issue(2, { title: "alpha bravo charlie", ...fremd })], ctx(git())).befunde).toEqual([]);
  });
});

describe("pruefe: Rückstellung und Eingang", () => {
  const k = (login: string, body: string, createdAt: string, assoc = "NONE") => ({ author: { login }, authorAssociation: assoc, body, createdAt });
  test.each([
    ["Marker zurückgestellt", [k("o", "Zurückgestellt: Kosten", "2026-10-05T00:00:00Z", "OWNER")], ["1:rueckstellung"]],
    ["Marker zurückstellen", [k("o", "Bitte zurückstellen", "2026-10-05T00:00:00Z", "OWNER")], ["1:rueckstellung"]],
    ["Marker Pause-Symbol", [k("o", "⏸ später", "2026-10-05T00:00:00Z", "OWNER")], ["1:rueckstellung"]],
    ["danach vertraut", [k("o", "⏸ später", "2026-10-05T00:00:00Z", "OWNER"), k("o", "Wieder dran", "2026-10-06T00:00:00Z", "OWNER")], []],
    ["Reihenfolge nach createdAt, nicht nach Listenposition", [k("o", "Wieder dran", "2026-10-06T00:00:00Z", "OWNER"), k("o", "⏸ später", "2026-10-05T00:00:00Z", "OWNER")], []],
    ["Marker fremder Hand", [k("fremd", "zurückgestellt", "2026-10-05T00:00:00Z")], []],
    ["Association OWNER", [k("andere", "zurückgestellt", "2026-10-05T00:00:00Z", "OWNER")], ["1:rueckstellung"]],
    ["App-Kommentar", [k("app/github-actions", "zurückgestellt", "2026-10-05T00:00:00Z")], ["1:rueckstellung"]],
    ["Bot-Login mit [bot]", [k("dependabot[bot]", "zurückgestellt", "2026-10-05T00:00:00Z")], ["1:rueckstellung"]],
    ["ohne Kommentare", [], []],
  ])("%s", (_n, comments, erwartet) => {
    expect(klassen(L.pruefe([issue(1, { comments })], ctx(git())))).toEqual(erwartet);
  });
  test.each([
    ["Bot-Autor vertraut", { author: { login: "app/github-actions", is_bot: true } }, 1, []],
    ["Fremder Login mit Bot-Flag ohne app/ ist Bot, aber unbekannt", { author: { login: "fremd-bot", is_bot: true } }, 0, [1]],
    ["Fremder Login ohne Bot-Flag", { author: { login: "fremd-bot", is_bot: false } }, 0, [1]],
    ["Forum-Label trotz Owner-Autor", { labels: [{ name: config.labels.forum }] }, 0, [1]],
  ])("Eingang: %s", (_n, extra, geprueft, uebersprungen) => {
    const e = L.pruefe([issue(1, extra)], ctx(git()));
    expect([e.geprueft, e.uebersprungen]).toEqual([geprueft, uebersprungen]);
  });
  test("100 Kommentare: Hinweis auf möglich abgeschnittene Liste", () => {
    const viele = Array.from({ length: 100 }, () => k("o", "x", "2026-10-05T00:00:00Z", "OWNER"));
    expect(L.pruefe([issue(1, { comments: viele })], ctx(git())).hinweise).toEqual(["#1: Kommentarliste möglicherweise abgeschnitten"]);
    expect(L.pruefe([issue(1, { comments: viele.slice(1) })], ctx(git())).hinweise).toEqual([]);
  });
  test("Fremdeingang: nur als Nummer übersprungen, sortiert", () => {
    const fremd = (nr: number) => issue(nr, { author: { login: "geheim-login", is_bot: false }, body: "`scripts/a.mjs:50`", title: "Zitat-Titel" });
    const e = L.pruefe([fremd(7), fremd(5)], ctx(git({ existiert: () => false, letzteAenderung: () => "2026-01-01T00:00:00Z" })));
    expect(e.uebersprungen).toEqual([5, 7]);
    expect(e.befunde).toEqual([]);
    const text = L.berichtText(e, { sha: "abc", datum: "2026-11-12" });
    expect(text).toContain("#5, #7");
    expect(text).not.toMatch(/geheim-login|Zitat-Titel/);
  });
  test("Bericht-Issue selbst wird übersprungen", () => {
    const g = git({ existiert: () => false, letzteAenderung: () => "2026-01-01T00:00:00Z" });
    const bericht = issue(9, { title: "🔎 Ticket-Drift-Bericht 2026-10", body: `${L.BERICHT_MARKER}\n\`scripts/a.mjs:50\``, author: { login: "app/github-actions", is_bot: true } });
    expect(L.pruefe([bericht], ctx(g)).uebersprungen).toEqual([9]);
    expect(klassen(L.pruefe([{ ...bericht, title: "Ticket über den Lauf" }], ctx(g)))).toEqual(["9:pfad-entfernt"]);
  });
});

describe("pruefe: Befund-Texte, Verdrahtung, Sortierung", () => {
  const body = "`scripts/a.mjs:50`";
  test.each([
    ["pfad-entfernt", git({ existiert: () => false, letzteAenderung: () => "2026-09-01T10:00:00+02:00" }), "`scripts/a.mjs` fehlt, zuletzt geändert 2026-09-01"],
    ["zeile-ausserhalb", git({ zeilen: () => 10 }), "`scripts/a.mjs:50` liegt hinter dem Dateiende (10 Zeilen)"],
    ["zeile-verschoben", git({ geaendertSeit: () => true }), "`scripts/a.mjs` seit 2026-10-01 geändert, Zeile 50 prüfen"],
  ])("%s: ganze Zeile", (_k, g, text) => {
    expect(L.pruefe([issue(1, { body })], ctx(g)).befunde.map((b) => b.text)).toEqual([text]);
  });
  test("Blocker-, Duplikat- und Rückstellungstext", () => {
    const e = L.pruefe(
      [issue(1, { title: "alpha bravo charlie", body: `${sprache.blocker} #9`, comments: [{ author: { login: "o" }, authorAssociation: "OWNER", body: "zurückgestellt", createdAt: "2026-10-05T00:00:00Z" }] }), issue(2, { title: "alpha bravo charlie" })],
      ctx(git()),
    );
    expect(e.befunde.map((b) => `${b.klasse}|${b.text}`)).toEqual(["blocker-zu|Blocker #9 ist geschlossen", "duplikat|Titel ähnlich zu #2 (1.00)", "rueckstellung|zurückgestellt seit 2026-10-05, Begründung prüfen (Kein Parken)"]);
  });
  test("updatedAt und Pfad gelangen an geaendertSeit; Bereich hinter dem Dateiende", () => {
    const aufrufe: string[][] = [];
    L.pruefe([issue(1, { body })], ctx(git({ geaendertSeit: (p, s) => (aufrufe.push([p, s]), false) })));
    expect(aufrufe).toEqual([["scripts/a.mjs", "2026-10-01T00:00:00Z"]]);
    expect(klassen(L.pruefe([issue(1, { body: "`docs/x.md:3-9`" })], ctx(git({ zeilen: () => 5 }))))).toEqual(["1:zeile-ausserhalb"]);
  });
  test("Pfad ohne Zeile: kein zeile-verschoben", () => {
    expect(L.pruefe([issue(1, { body: "`scripts/a.mjs`" })], ctx(git({ geaendertSeit: () => true }))).befunde).toEqual([]);
  });
  test("innerhalb der Klasse nach Nummer sortiert", () => {
    const blockiert = (nr: number) => issue(nr, { title: `Gegenstand${nr} eigen`, body: `${sprache.blocker} #99` });
    expect(klassen(L.pruefe([blockiert(3), blockiert(1)], ctx(git())))).toEqual(["1:blocker-zu", "3:blocker-zu"]);
  });
  test("Klassen in Berichtsreihenfolge sortiert", () => {
    const e = L.pruefe([issue(1, { body: `${sprache.blocker} #99` }), issue(2, { body: "`scripts/a.mjs:50`" })], ctx(git({ zeilen: () => 10 })));
    expect(klassen(e)).toEqual(["2:zeile-ausserhalb", "1:blocker-zu"]);
  });
});

describe("berichtText", () => {
  const e = (befunde: Ergebnis["befunde"], extra: Partial<Ergebnis> = {}): Ergebnis => ({ befunde, geprueft: 3, uebersprungen: [], hinweise: [], ...extra });
  test("sortiert, mit Marker, ohne leere Klassen", () => {
    const t = L.berichtText(e([{ nr: 4, klasse: "blocker-zu", text: "b" }, { nr: 2, klasse: "pfad-entfernt", text: "a" }]), { sha: "abc", datum: "2026-11-12" });
    expect(t.startsWith(L.BERICHT_MARKER)).toBe(true);
    expect(t).not.toContain("weitere Befunde");
    expect(t.indexOf("pfad-entfernt")).toBeLessThan(t.indexOf("blocker-zu"));
    expect(t).not.toContain("## rueckstellung");
    expect(t).toContain("## blocker-zu (1)\n- #4: b\n");
  });
  test("Hinweise stehen im Bericht", () => {
    expect(L.berichtText(e([], { hinweise: ["Shallow-Klon: Git-Prüfungen ausgesetzt"] }), { sha: "abc", datum: "2026-11-12" })).toContain("Hinweis: Shallow-Klon: Git-Prüfungen ausgesetzt");
  });
  test("keine Befunde", () => {
    const t = L.berichtText(e([]), { sha: "abc", datum: "2026-11-12" });
    expect(t).toContain("keine Befunde");
    expect(t).toContain("übersprungen (Fremdeingang, Bericht): keine.");
  });
  test("Kürzung mit exakter Restzahl", () => {
    const viele = Array.from({ length: 3000 }, (_, i) => ({ nr: i + 1, klasse: "blocker-zu", text: "Blocker #99999 ist geschlossen, bitte prüfen" }));
    const t = L.berichtText(e(viele), { sha: "abc", datum: "2026-11-12" });
    const gezeigt = t.split("\n").filter((z) => z.startsWith("- #")).length;
    expect(t.length).toBeLessThanOrEqual(L.BERICHT_MAX);
    expect(gezeigt).toBeGreaterThan(0);
    expect(t).toContain(`${3000 - gezeigt} weitere Befunde, vollständig in der Step-Summary`);
  });
});

describe("main: nur der Bericht entsteht (AK5)", () => {
  const MARKER = L.BERICHT_MARKER;
  const TITEL = "🔎 Ticket-Drift-Bericht 2026-10";
  const bot = { login: "app/github-actions", is_bot: true };
  const bericht = (nr: number, extra: Record<string, unknown> = {}) => issue(nr, { title: TITEL, body: MARKER, author: bot, ...extra });
  const fixture = (...berichte: Issue[]): Issue[] => [
    issue(1, { body: "`scripts/a.mjs:50`" }),
    issue(2, { body: `${sprache.blocker} #99` }),
    issue(3, { author: { login: "fremd", is_bot: false }, body: "`scripts/a.mjs:50`" }),
    issue(4, { comments: [{ author: { login: "o" }, authorAssociation: "OWNER", body: "zurückgestellt", createdAt: "2026-10-05T00:00:00Z" }] }),
    ...berichte,
  ];
  type Lauf = { code: number; aufrufe: string[][]; bodies: string[]; lesen: string[][]; out: string };
  /** Alle Nähte eingespeist; ein nicht vorgesehener Schreibaufruf wirft (nie ein echtes gh). */
  const lauf = async (issues: unknown, argv: string[] = [], env: Record<string, string> = { PROJECT_TOKEN: "t" }, antwort = "https://github.com/o/r/issues/77\n", REPO = "o/r"): Promise<Lauf> => {
    const r: Lauf = { code: -1, aufrufe: [], bodies: [], lesen: [], out: "" };
    const out: string[] = [];
    r.code = await S.main(argv, {
      ladeConfig: () => config,
      ladeLibs: () => Promise.resolve({ REPO, platziereAmEnde: (nr: number, token: string) => r.aufrufe.push(["board", String(nr), token]) }),
      ghLesen: (args: string[]) => { r.lesen.push(args); return issues; },
      ghSchreiben: (args: string[], input: string) => { r.aufrufe.push(["gh", ...args]); r.bodies.push(input); return antwort; },
      sicht: { tops: TOPS, sha: "abc", git: git({ zeilen: () => 10 }) },
      env, heute: "2026-11-12", log: (m: string) => out.push(m), err: (m: string) => out.push(m),
    });
    r.out = out.join("\n");
    return r;
  };
  const verboten = (aufrufe: string[][]) => aufrufe.flat().filter((a) => /^(close|comment|reopen|lock|--add-label|--remove-label|--add-assignee)$/.test(a));

  test("kein Bericht offen: genau create (mit Body) und Board-Aufruf mit Token", async () => {
    const r = await lauf(fixture());
    expect(r.code).toBe(0);
    expect(r.aufrufe.map((a) => a.slice(0, 3).join(" "))).toEqual(["gh issue create", "board 77 t"]);
    expect(r.bodies[0].startsWith(MARKER)).toBe(true);
    expect(r.bodies[0]).toContain("#2: Blocker #99 ist geschlossen");
    expect(r.aufrufe[0]).toEqual(["gh", "issue", "create", "--title", "🔎 Ticket-Drift-Bericht 2026-11", "--body-file", "-"]);
    expect(verboten(r.aufrufe)).toEqual([]);
  });
  test("Bericht offen, ungeclaimt: genau edit mit Titel-Monat und Body auf die Bericht-Nummer", async () => {
    const r = await lauf(fixture(bericht(40)));
    expect(r.aufrufe).toEqual([["gh", "issue", "edit", "40", "--title", "🔎 Ticket-Drift-Bericht 2026-11", "--body-file", "-"]]);
    expect(r.bodies[0]).toContain("#2: Blocker #99 ist geschlossen");
  });
  test("Bericht der Maintainerin (Owner aus REPO) ist Ziel", async () => {
    const r = await lauf(fixture(bericht(40, { author: { login: "o", is_bot: false } })));
    expect(r.aufrufe[0].slice(0, 4)).toEqual(["gh", "issue", "edit", "40"]);
  });
  test("mehrere Berichte: der mit der kleinsten Nummer", async () => {
    expect((await lauf(fixture(bericht(40), bericht(30)))).aufrufe[0].slice(0, 4)).toEqual(["gh", "issue", "edit", "30"]);
  });
  test("Bericht geclaimt: keine Schreibaufrufe", async () => {
    expect((await lauf(fixture(bericht(40, { assignees: [{ login: "o" }] })))).aufrufe).toEqual([]);
  });
  test.each([
    ["Marker eines Fremden", issue(30, { title: TITEL, body: MARKER, author: { login: "fremd", is_bot: false } })],
    ["Marker zitiert, anderer Titel", issue(30, { title: "Ticket über den Lauf", body: `Der Marker ${MARKER} steht im Bericht.` })],
    ["Titel und Bot, aber kein Marker im Body", issue(30, { title: TITEL, body: "", author: bot })],
    ["Fremder mit Forum-Label", issue(30, { title: TITEL, body: MARKER, labels: [{ name: config.labels.forum }] })],
  ])("kein Ziel: %s (Neuanlage statt edit)", async (_n, fremd) => {
    const r = await lauf(fixture(fremd));
    expect(r.aufrufe.map((a) => a.slice(0, 3).join(" "))).toEqual(["gh issue create", "board 77 t"]);
    expect(r.aufrufe.flat()).not.toContain("edit");
  });
  test("--dry-run: keine Schreibaufrufe, Bericht auf stdout", async () => {
    const r = await lauf(fixture(), ["--dry-run"]);
    expect(r.aufrufe).toEqual([]);
    expect(r.out).toContain(MARKER);
  });
  test("keine Befunde und kein Bericht: nichts geschrieben", async () => {
    expect((await lauf([issue(1)])).aufrufe).toEqual([]);
  });
  test("ohne PROJECT_TOKEN nur Warnung", async () => {
    const r = await lauf(fixture(), [], {});
    expect(r.aufrufe.map((a) => a[0])).toEqual(["gh"]);
    expect(r.out).toContain("::warning::");
  });
  test("gh issue list: Zustand, Limit und alle benötigten Felder", async () => {
    const r = await lauf(fixture(), ["--dry-run"]);
    expect(r.lesen).toHaveLength(1);
    expect(r.lesen[0].slice(0, 7)).toEqual(["issue", "list", "--state", "open", "--limit", "1000", "--json"]);
    expect(r.lesen[0][7].split(",").sort()).toEqual(["assignees", "author", "blockedBy", "body", "comments", "labels", "number", "title", "updatedAt"]);
  });
  test("999 Issues laufen, 1000 brechen ab, nichts geschrieben", async () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => issue(i + 1));
    expect((await lauf(n(999), ["--dry-run"])).code).toBe(0);
    const r = await lauf(n(1000));
    expect([r.code, r.aufrufe]).toEqual([1, []]);
  });
  test("gh liefert keine Liste: Exit 1 mit Meldung", async () => {
    const r = await lauf(null);
    expect([r.code, r.out.includes("unvollständig"), r.aufrufe]).toEqual([1, true, []]);
  });
  test("Aufruffehler: Exit 2, nichts geschrieben", async () => {
    const r = await lauf(fixture(), ["--unbekannt"]);
    expect([r.code, r.aufrufe, r.lesen]).toEqual([2, [], []]);
  });
  test("Label nur im eigenen Ziel-Repo, Nummer aus dem Ende der URL", async () => {
    const eigenes = C.zielRepoFuer([config.labels.harness], config);
    const eigeneIssues = [issue(2, { body: `${sprache.blocker} #99`, author: { login: eigenes.split("/")[0], is_bot: false } })];
    const fremdRepo = await lauf(fixture(), [], { PROJECT_TOKEN: "t" }, "https://github.com/user1/r/issues/77\n");
    const eigenRepo = await lauf(eigeneIssues, [], { PROJECT_TOKEN: "t" }, "https://github.com/user1/r/issues/77\n", eigenes);
    expect(fremdRepo.aufrufe[0]).not.toContain("--label");
    expect(eigenRepo.aufrufe[0].slice(-2)).toEqual(["--label", config.labels.harness]);
    expect([fremdRepo.aufrufe[1], eigenRepo.aufrufe[1]]).toEqual([["board", "77", "t"], ["board", "77", "t"]]);
  });
  test.each([["kaputt"], ["https://github.com/o/r/issues/0"], ["https://github.com/o/r/pull/12"]])("unlesbare Nummer %s: Exit 1, kein Board-Aufruf", async (antwort) => {
    const r = await lauf(fixture(), [], { PROJECT_TOKEN: "t" }, antwort);
    expect([r.code, r.aufrufe.map((a) => a[0])]).toEqual([1, ["gh"]]);
  });
  test("Step-Summary bekommt den Bericht", async () => {
    const summary: string[][] = [];
    const code = await S.main(["--dry-run"], { ladeConfig: () => config, ladeLibs: () => Promise.resolve({ REPO: "o/r" }), ghLesen: () => fixture(), sicht: { tops: TOPS, sha: "abc", git: git() }, env: { GITHUB_STEP_SUMMARY: "/x/summary" }, heute: "2026-11-12", schreibeSummary: (p: string, t: string) => summary.push([p, t]), ghSchreiben: () => { throw new Error("echter Schreibaufruf"); }, log: () => undefined, err: () => undefined });
    expect([code, summary.length, summary[0][0], summary[0][1].startsWith(MARKER)]).toEqual([0, 1, "/x/summary", true]);
  });
  test("waehleZiel", () => {
    expect(S.waehleZiel(fixture(bericht(40)), true, { owner: "o", config })).toEqual({ art: "edit", nr: 40 });
    expect(S.waehleZiel(fixture(), false, { owner: "o", config })).toEqual({ art: "nichts" });
  });
});

describe("Wächter", () => {
  test("Quellen nennen keine Schreibverben auf fremde Tickets", () => {
    const quellen = ["scripts/ticket-drift.mjs", "scripts/ticket-drift-lib.mjs"].map(lies).join("\n").split("\n").filter((z) => !/^\s*(\/\/|\*)/.test(z)).join("\n");
    const treffer = quellen.match(/["'`](close|comment|reopen|lock|unlock|delete|transfer|pin|unpin|--add-label|--remove-label|--add-assignee|--remove-assignee)["'`]/g);
    expect(treffer).toBeNull();
  });
  const wf = lies(".github/workflows/ticket-drift.yml");
  test("Workflow: Takt, Skript, Rechte genau, Eingaben nur per env", () => {
    expect(wf).toMatch(/cron:/);
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("node scripts/ticket-drift.mjs");
    const rechte = /\npermissions:\n((?: {2}.+\n)+)/.exec(wf)?.[1].trim().split("\n").map((z) => z.trim());
    expect(rechte).toEqual(["contents: read", "issues: write"]);
    expect(wf).toContain("fetch-depth: 0");
    expect(wf).toContain("persist-credentials: false");
    expect(wf).not.toMatch(/run:[^\n]*\$\{\{\s*inputs/);
    expect(wf).not.toMatch(/\n\s+run: \|[\s\S]*\$\{\{\s*inputs/);
  });
});

describe("gitSicht", () => {
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_DATE: DATUM, GIT_COMMITTER_DATE: DATUM } });
  const DATUM = "2026-09-01T10:00:00+00:00";
  test("echtes Wegwerf-Repo: gelöscht, geändert nach updatedAt, unverändert, Zeilenzahl, Verzeichnis", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "drift-"));
    try {
      git(wurzel, "init", "-q");
      git(wurzel, "config", "user.email", "t@example.org");
      git(wurzel, "config", "user.name", "t");
      mkdirSync(join(wurzel, "docs"));
      writeFileSync(join(wurzel, "docs", "alt.md"), "x\n");
      writeFileSync(join(wurzel, "docs", "stabil.md"), "eins\nzwei");
      writeFileSync(join(wurzel, "docs", "geaendert.md"), "a\n");
      writeFileSync(join(wurzel, "docs", "leer.md"), "");
      git(wurzel, "add", "-A");
      git(wurzel, "commit", "-q", "-m", "eins");
      rmSync(join(wurzel, "docs", "alt.md"));
      git(wurzel, "commit", "-q", "-a", "-m", "zwei");
      const sicht = S.gitSicht(wurzel);
      expect([...sicht.tops]).toEqual(["docs"]);
      expect([sicht.shallow, /^[0-9a-f]{7,}$/.test(sicht.sha)]).toEqual([false, true]);
      expect([sicht.git.existiert("docs/alt.md"), sicht.git.existiert("docs/stabil.md")]).toEqual([false, true]);
      expect(sicht.git.letzteAenderung("docs/alt.md")?.slice(0, 10)).toBe("2026-09-01");
      expect(sicht.git.letzteAenderung("docs/nie.md")).toBeNull();
      expect(sicht.git.geaendertSeit("docs/geaendert.md", "2026-08-01T00:00:00Z")).toBe(true);
      expect(sicht.git.geaendertSeit("docs/geaendert.md", "2026-10-01T00:00:00Z")).toBe(false);
      expect([sicht.git.zeilen("docs/stabil.md"), sicht.git.zeilen("docs/geaendert.md")]).toEqual([2, 1]);
      expect(sicht.git.zeilen("docs")).toBe(Number.POSITIVE_INFINITY);
      expect(sicht.git.zeilen("docs/leer.md")).toBe(0);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
  test("Shallow-Erkennung und -- vor dem Pfad über die Naht", () => {
    const aufrufe: string[][] = [];
    const fake = (flag: string) => (a: string[]) => {
      aufrufe.push(a);
      if (a[0] === "ls-files") return "README.md\ndocs/a.md\nscripts/x.mjs\n";
      if (a[0] === "rev-parse" && a[1] === "--is-shallow-repository") return flag;
      return a[0] === "rev-parse" ? "abc1234\n" : "";
    };
    expect([S.gitSicht("/nicht/da", fake("true\n")).shallow, S.gitSicht("/nicht/da", fake("false\n")).shallow]).toEqual([true, false]);
    expect([...S.gitSicht("/nicht/da", fake("false\n")).tops].sort()).toEqual(["docs", "scripts"]);
    const sicht = S.gitSicht("/nicht/da", fake("false\n"));
    sicht.git.letzteAenderung("docs/a.md");
    sicht.git.geaendertSeit("docs/a.md", "2026-10-01T00:00:00Z");
    const logs = aufrufe.filter((a) => a[0] === "log");
    expect(logs.map((a) => a.slice(-2))).toEqual([["--", "docs/a.md"], ["--", "docs/a.md"]]);
  });
});
