/**
 * Ticket-Drift-Lauf (factory#28, ADR 0033): Prüfungen der Lib, Verhaltenstest der Schreibgrenze und Wächter.
 * @probe-echte-dateien liest die echten Quellen `scripts/ticket-drift*.mjs` und `.github/workflows/ticket-drift.yml`.
 * Bewusste Grenze des statischen Wächters: er sucht verbotene gh-Verben als Wort in den Quellen; ein zur Laufzeit zusammengesetztes Verb erkennt nur der Verhaltenstest (Recorder).
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const S = skriptRaw as unknown as { gitSicht: (w: string, g: (a: string[]) => string) => { tops: Set<string>; shallow: boolean; sha: string; git: Git }; main: (a: string[], d: Record<string, unknown>) => Promise<number>; waehleZiel: (i: Issue[], b: boolean) => { art: string; nr?: number } };

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
    ["nativ CLOSED", { blockedBy: { nodes: [{ number: 7, state: "CLOSED" }] } }, ["1:blocker-zu"]],
    ["nativ OPEN", { blockedBy: { nodes: [{ number: 7, state: "OPEN" }] } }, []],
    ["nativ ohne Zustand", { blockedBy: { nodes: [{ number: 7 }] } }, []],
    ["fremdes Repo übersprungen", { body: blockerZeile("x/y#9") }, []],
  ])("%s", (_n, extra, erwartet) => {
    expect(klassen(L.pruefe([issue(1, extra), issue(2, { title: "Ganz anderer Gegenstand hier" })], ctx(git())))).toEqual(erwartet);
  });
});

describe("pruefe: Duplikate", () => {
  const paar = (a: string, b: string, ex: Record<string, unknown> = {}) => [issue(1, { title: a, ...ex }), issue(2, { title: b, ...ex })];
  test.each([
    ["ähnliches Paar einmal", paar("Wiederkehrender Ticket-Drift-Check Routine einrichten", "Ticket-Drift-Check wiederkehrend Routine einrichten"), ["1:duplikat"]],
    ["Serie", paar("Umbau 1/6: Cache Layer Schnitt vorbereiten", "Umbau 2/6: Cache Layer Schnitt vorbereiten"), []],
    ["zu kurz", paar("Cache leeren", "Cache leeren"), []],
    ["kurze Wörter zählen nicht", paar("ui ux db io Wartung", "ui ux db io Pflege"), []],
    ["Sammeltickets", paar("Harness-Härtung (gesammelt)", "Harness-Härtung (gesammelt)"), []],
    ["nur ein Titel mit Serie", [issue(1, { title: "Umbau 1/6: Cache Layer Schnitt vorbereiten" }), issue(2, { title: "Cache Layer Schnitt vorbereiten Umbau" })], ["1:duplikat"]],
    ["verschieden", paar("Wiederkehrender Ticket-Drift-Check Routine", "Browser Screenshot Vergleich Werkzeug"), []],
  ])("%s", (_n, issues, erwartet) => {
    expect(klassen(L.pruefe(issues, ctx(git())))).toEqual(erwartet);
  });
});

describe("pruefe: Rückstellung und Fremdeingang", () => {
  const k = (login: string, body: string, createdAt: string, assoc = "NONE") => ({ author: { login }, authorAssociation: assoc, body, createdAt });
  test.each([
    ["vertraut zuletzt", [k("o", "Zurückgestellt: Kosten", "2026-10-05T00:00:00Z", "OWNER")], ["1:rueckstellung"]],
    ["danach vertraut", [k("o", "⏸ später", "2026-10-05T00:00:00Z", "OWNER"), k("o", "Wieder dran", "2026-10-06T00:00:00Z", "OWNER")], []],
    ["Marker fremder Hand", [k("fremd", "zurückgestellt", "2026-10-05T00:00:00Z")], []],
  ])("%s", (_n, comments, erwartet) => {
    expect(klassen(L.pruefe([issue(1, { comments })], ctx(git())))).toEqual(erwartet);
  });
  test("Kommentar mit Association OWNER gilt als vertraut", () => {
    expect(klassen(L.pruefe([issue(1, { comments: [k("andere", "zurückgestellt", "2026-10-05T00:00:00Z", "OWNER")] })], ctx(git())))).toEqual(["1:rueckstellung"]);
  });
  test("Kommentar eines Bots (app/…) gilt als vertraut", () => {
    expect(klassen(L.pruefe([issue(1, { comments: [k("app/github-actions", "zurückgestellt", "2026-10-05T00:00:00Z")] })], ctx(git())))).toEqual(["1:rueckstellung"]);
  });
  test.each([
    ["Bot-Autor vertraut", { author: { login: "app/github-actions", is_bot: true } }, 1, []],
    ["gleicher Login ohne Bot-Flag fremd", { author: { login: "app/github-actions", is_bot: false } }, 0, [1]],
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
  test("Fremdeingang: nur als Nummer übersprungen", () => {
    const fremd = issue(5, { author: { login: "geheim-login", is_bot: false }, body: "`scripts/a.mjs:50`", title: "Zitat-Titel" });
    const e = L.pruefe([fremd], ctx(git({ existiert: () => false, letzteAenderung: () => "2026-01-01T00:00:00Z" })));
    expect(e.uebersprungen).toEqual([5]);
    expect(e.befunde).toEqual([]);
    const text = L.berichtText(e, { sha: "abc", datum: "2026-11-12" });
    expect(text).toContain("#5");
    expect(text).not.toMatch(/geheim-login|Zitat-Titel/);
  });
  test("Bericht-Issue selbst wird übersprungen", () => {
    const e = L.pruefe([issue(9, { body: `${L.BERICHT_MARKER}\n\`scripts/a.mjs:50\`` })], ctx(git({ existiert: () => false, letzteAenderung: () => "2026-01-01T00:00:00Z" })));
    expect(e.uebersprungen).toEqual([9]);
  });
});

describe("berichtText", () => {
  const e = (befunde: Ergebnis["befunde"]): Ergebnis => ({ befunde, geprueft: 3, uebersprungen: [], hinweise: [] });
  test("sortiert, mit Marker", () => {
    const t = L.berichtText(e([{ nr: 4, klasse: "blocker-zu", text: "b" }, { nr: 2, klasse: "pfad-entfernt", text: "a" }]), { sha: "abc", datum: "2026-11-12" });
    expect(t.startsWith(L.BERICHT_MARKER)).toBe(true);
    expect(t).not.toContain("weitere Befunde");
    expect(t.indexOf("pfad-entfernt")).toBeLessThan(t.indexOf("blocker-zu"));
  });
  test("keine Befunde", () => {
    expect(L.berichtText(e([]), { sha: "abc", datum: "2026-11-12" })).toContain("keine Befunde");
  });
  test("Kürzung mit Hinweis", () => {
    const viele = Array.from({ length: 3000 }, (_, i) => ({ nr: i + 1, klasse: "blocker-zu", text: "Blocker #99999 ist geschlossen, bitte prüfen" }));
    const t = L.berichtText(e(viele), { sha: "abc", datum: "2026-11-12" });
    expect(t.length).toBeLessThanOrEqual(L.BERICHT_MAX);
    expect(t).toMatch(/\d+ weitere Befunde, vollständig in der Step-Summary/);
  });
});

describe("main: nur der Bericht entsteht (AK5)", () => {
  const MARKER = L.BERICHT_MARKER;
  const fixture = (bericht?: Record<string, unknown>): Issue[] => [
    issue(1, { body: "`scripts/a.mjs:50`" }),
    issue(2, { body: `${sprache.blocker} #99` }),
    issue(3, { author: { login: "fremd", is_bot: false }, body: "`scripts/a.mjs:50`" }),
    issue(4, { comments: [{ author: { login: "o" }, authorAssociation: "OWNER", body: "zurückgestellt", createdAt: "2026-10-05T00:00:00Z" }] }),
    ...(bericht ? [issue(40, { title: "🔎 Ticket-Drift-Bericht 2026-10", body: MARKER, ...bericht })] : []),
  ];
  const lauf = async (issues: Issue[], argv: string[] = [], env: Record<string, string> = { PROJECT_TOKEN: "t" }) => {
    const aufrufe: string[][] = [];
    const out: string[] = [];
    const code = await S.main(argv, {
      ladeConfig: () => config,
      ladeLibs: () => Promise.resolve({ REPO: "o/r" }),
      ghLesen: () => issues,
      ghSchreiben: (args: string[]) => { aufrufe.push(["gh", ...args]); return "https://github.com/o/r/issues/77\n"; },
      platziere: (nr: number) => aufrufe.push(["board", String(nr)]),
      sicht: { tops: TOPS, sha: "abc", git: git({ zeilen: () => 10, existiert: () => true }) },
      env, heute: "2026-11-12", log: (m: string) => out.push(m), err: (m: string) => out.push(m),
    });
    return { code, aufrufe, out: out.join("\n") };
  };
  const verboten = (aufrufe: string[][]) => aufrufe.flat().filter((a) => /^(close|comment|reopen|lock|--add-label|--remove-label|--add-assignee)$/.test(a));

  test("kein Bericht offen: genau create und board --top", async () => {
    const r = await lauf(fixture());
    expect(r.code).toBe(0);
    expect(r.aufrufe.map((a) => a.slice(0, 3).join(" "))).toEqual(["gh issue create", "board 77"]);
    expect(verboten(r.aufrufe)).toEqual([]);
  });
  test("Bericht offen, ungeclaimt: genau edit auf die Bericht-Nummer", async () => {
    const r = await lauf(fixture({ assignees: [] }));
    expect(r.aufrufe).toEqual([["gh", "issue", "edit", "40", "--body-file", "-"]]);
  });
  test("Bericht geclaimt: keine Schreibaufrufe", async () => {
    expect((await lauf(fixture({ assignees: [{ login: "o" }] }))).aufrufe).toEqual([]);
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
  test("1000 Issues: Exit 1, nichts geschrieben", async () => {
    const r = await lauf(Array.from({ length: 1000 }, (_, i) => issue(i + 1)));
    expect(r.code).toBe(1);
    expect(r.aufrufe).toEqual([]);
  });
  test("Anlage: Label nur im eigenen Ziel-Repo, Nummer der Antwort", async () => {
    const eigenes = C.zielRepoFuer([config.labels.harness], config);
    const ausgabe: string[][] = [];
    const lauf2 = (REPO: string) => S.main([], { ladeConfig: () => config, ladeLibs: () => Promise.resolve({ REPO }), ghLesen: () => [issue(2, { body: `${sprache.blocker} #99`, author: { login: REPO.split("/")[0], is_bot: false } })], ghSchreiben: (a: string[]) => { ausgabe.push(a); return "https://github.com/o/r/issues/5"; }, platziere: () => undefined, sicht: { tops: TOPS, sha: "abc", git: git() }, env: {}, heute: "2026-11-12", log: () => undefined, err: () => undefined });
    await lauf2("o/r");
    await lauf2(eigenes);
    expect(ausgabe.map((a) => a.includes("--label"))).toEqual([false, true]);
    expect(ausgabe[1]).toContain("🔎 Ticket-Drift-Bericht 2026-11");
  });
  test("unlesbare Nummer der Antwort: Exit 1, kein Board-Aufruf", async () => {
    const aufrufe: string[] = [];
    const code = await S.main([], { ladeConfig: () => config, ladeLibs: () => Promise.resolve({ REPO: "o/r" }), ghLesen: () => fixture(), ghSchreiben: () => "kaputt", platziere: () => aufrufe.push("board"), sicht: { tops: TOPS, sha: "abc", git: git() }, env: { PROJECT_TOKEN: "t" }, heute: "2026-11-12", log: () => undefined, err: () => undefined });
    expect([code, aufrufe]).toEqual([1, []]);
  });
  test("gh liefert keine Liste: Exit 1", async () => {
    const r = await lauf(null as unknown as Issue[]);
    expect([r.code, r.out.includes("unvollständig"), r.aufrufe]).toEqual([1, true, []]);
  });
  test("Step-Summary bekommt den Bericht", async () => {
    const summary: string[][] = [];
    const out = await S.main(["--dry-run"], { ladeConfig: () => config, ladeLibs: () => Promise.resolve({ REPO: "o/r" }), ghLesen: () => fixture(), sicht: { tops: TOPS, sha: "abc", git: git() }, env: { GITHUB_STEP_SUMMARY: "/x/summary" }, heute: "2026-11-12", schreibeSummary: (p: string, t: string) => summary.push([p, t]), log: () => undefined, err: () => undefined });
    expect([out, summary.length, summary[0][0], summary[0][1].startsWith(MARKER)]).toEqual([0, 1, "/x/summary", true]);
  });
  test("waehleZiel", () => {
    expect(S.waehleZiel(fixture({ assignees: [] }), true)).toEqual({ art: "edit", nr: 40 });
  });
});

describe("Wächter", () => {
  test("Quellen nennen keine Schreibverben auf fremde Tickets", () => {
    const quellen = ["scripts/ticket-drift.mjs", "scripts/ticket-drift-lib.mjs"].map(lies).join("\n").split("\n").filter((z) => !/^\s*(\/\/|\*)/.test(z)).join("\n");
    const treffer = quellen.match(/["'`](close|comment|reopen|lock|unlock|delete|transfer|pin|unpin|--add-label|--remove-label|--add-assignee|--remove-assignee)["'`]/g);
    expect(treffer).toBeNull();
  });
  const wf = lies(".github/workflows/ticket-drift.yml");
  test("Workflow: Takt, Skript, Rechte, Eingaben nur per env", () => {
    expect(wf).toMatch(/cron:/);
    expect(wf).toContain("workflow_dispatch");
    expect(wf).toContain("node scripts/ticket-drift.mjs");
    expect(wf).toMatch(/permissions:\n {2}contents: read\n {2}issues: write\n/);
    expect(wf).toContain("fetch-depth: 0");
    expect(wf).not.toMatch(/run:[^\n]*\$\{\{\s*inputs/);
    expect(wf).not.toMatch(/\n\s+run: \|[\s\S]*\$\{\{\s*inputs/);
  });
});

describe("gitSicht", () => {
  test("Top-Level, Shallow, Sha, Zeilen, Verlauf mit -- vor dem Pfad", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "drift-"));
    try {
      mkdirSync(join(wurzel, "docs"));
      writeFileSync(join(wurzel, "docs", "a.md"), "eins\nzwei\ndrei\n");
      const aufrufe: string[][] = [];
      const fake = (a: string[]) => {
        aufrufe.push(a);
        if (a[0] === "ls-files") return "README.md\ndocs/a.md\nscripts/x.mjs\n";
        if (a[0] === "rev-parse" && a[1] === "--is-shallow-repository") return "true\n";
        if (a[0] === "rev-parse") return "abc1234\n";
        return a[1] === "-1" ? "" : "h1\n";
      };
      const sicht = S.gitSicht(wurzel, fake);
      expect(S.gitSicht(wurzel, (a) => (a[0] === "rev-parse" && a[1] === "--is-shallow-repository" ? "false\n" : fake(a))).shallow).toBe(false);
      expect([...sicht.tops].sort()).toEqual(["docs", "scripts"]);
      expect([sicht.shallow, sicht.sha, sicht.git.existiert("docs/a.md"), sicht.git.existiert("docs/b.md"), sicht.git.zeilen("docs/a.md")]).toEqual([true, "abc1234", true, false, 3]);
      expect(sicht.git.letzteAenderung("docs/b.md")).toBeNull();
      expect(sicht.git.geaendertSeit("docs/a.md", "2026-10-01T00:00:00Z")).toBe(true);
      expect(aufrufe.filter((a) => a[0] === "log").every((a) => a[a.indexOf("--") + 1] !== undefined && a.indexOf("--") === a.length - 2)).toBe(true);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
});
