import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import * as W from "../scripts/langfuse-wochenbericht-lib.mjs";
import { auswerten, parseArgs } from "../scripts/langfuse-wochenbericht.mjs";
import { ladeLiveExporte } from "../scripts/langfuse-wochenbericht-live.mjs";
import { importHuelle } from "./support/import-huelle";

const MONTAG = "2026-11-02";
const JETZT = new Date("2026-11-11T12:00:00Z");
const F = W.wochenFenster(MONTAG);
const { filter: PF } = W.projektFilterAus({ tags: ["factory"], repoName: "repo" });
const TYPE = { column: "type", operator: "=", value: "GENERATION", type: "string" };
const g = (traceName: string, name: string, modell: string, env: string, count: number, cost: number) => ({ traceName, name, providedModelName: modell, environment: env, count_count: count, sum_totalCost: cost });
const exp = (art: string, von: string, bis: string, data: unknown[], filters: unknown[] = [TYPE, PF]) => ({ art, abfrage: { view: "observations", filters, fromTimestamp: von, toTimestamp: bis }, data });
const tage = (von: string, mitLuecke = false) =>
  Array.from({ length: 7 }, (_, i) => ({ time_dimension: new Date(Date.parse(von) + i * 86400000).toISOString(), count_count: mitLuecke && i === 3 ? 0 : 5, sum_totalCost: mitLuecke && i === 3 ? null : 1 }));
const gesamtW = (cost = 20) => [g("Claude Code Turn", "LLM Call", "claude-opus-5-5", "default", 10, cost - 4), g("Abgleich", "Model response", "claude-sonnet-5-5", "repo", 6, 4)];
const SCORE_FILTER = { column: "name", operator: "any of", value: ["erfassung", "erfassung_hook"], type: "stringOptions" };
const sess = (art: string, von: string, bis: string, ids: Array<[string, string]>) => exp(art, von, bis, ids.map(([sessionId, traceName]) => ({ sessionId, traceName, count_count: 3 })));
const scoreExp = (rows: Array<[string, string, number]>) => ({ art: "erfassung", abfrage: { view: "scores-numeric", filters: [SCORE_FILTER], fromTimestamp: F.vorVon, toTimestamp: "2026-11-11T11:30:00.000Z" }, data: rows.map(([sessionId, name, avg_value]) => ({ sessionId, name, avg_value })) });

type Satz = Record<string, unknown>;
function satz(opt: { kostenW?: number; kostenV?: number; sessionsW?: Array<[string, string]>; sessionsV?: Array<[string, string]>; scores?: Array<[string, string, number]>; luecke?: boolean } = {}): Satz {
  return {
    "gesamtW.json": exp("gesamt", F.von, F.bis, gesamtW(opt.kostenW ?? 20)),
    "tageW.json": exp("tage", F.von, F.bis, tage(F.von, opt.luecke)),
    "gesamtV.json": exp("gesamt", F.vorVon, F.vorBis, [g("Claude Code Turn", "LLM Call", "claude-opus-5-5", "default", 10, opt.kostenV ?? 20)]),
    "sessW.json": sess("sessions", F.von, F.bis, opt.sessionsW ?? [["s1", "Claude Code Turn"], ["s2", "Claude Code Turn"]]),
    "sessV.json": sess("sessions", F.vorVon, F.vorBis, opt.sessionsV ?? [["s0", "Claude Code Turn"]]),
    "scores.json": scoreExp(opt.scores ?? [["s1", "erfassung", 1], ["s2", "erfassung", 1], ["s0", "erfassung", 1], ["s1", "erfassung_hook", 0.5], ["s2", "erfassung_hook", 1]]),
  };
}

const PROJEKT = { owner: "own", repo: "repo", schwellen: undefined as Satz | undefined, tags: ["factory"], wurzel: process.cwd() };
function lauf(argv: string[], dateien: Satz, deps: Satz = {}) {
  const lies = (p: string) => (p in dateien ? (typeof dateien[p] === "string" ? (dateien[p] as string) : JSON.stringify(dateien[p])) : (() => { throw new Error("ENOENT " + p); })());
  return auswerten(parseArgs([...argv, ...(argv.includes("--rezept") ? [] : Object.keys(dateien).flatMap((p) => ["--export", p]))]), { jetzt: JETZT, projekt: PROJEKT, lies, ...deps });
}
const tmp = () => mkdtempSync(join(tmpdir(), "wb-"));
const SCHWELLEN = { erfassungLueckenMax: 0, kostenAnstiegProzent: 50, unzugeordnetProzent: 90 };

describe("Woche", () => {
  test("letzteVolleWoche: Mittwoch ergibt den Montag der Vorwoche, Montag 00:10Z mit Ruhefrist den Montag davor", () => {
    expect(W.letzteVolleWoche(new Date("2026-11-11T12:00:00Z"))).toBe("2026-11-02");
    expect(W.letzteVolleWoche(new Date("2026-11-09T00:10:00Z"))).toBe("2026-11-02");
    expect(W.letzteVolleWoche(new Date(Date.parse("2026-11-09T00:10:00Z") - W.RUHEFRIST_MS))).toBe("2026-10-26");
  });
  test("--woche: Dienstag, offene Woche und Unsinn sind Aufruffehler (Exit 2)", async () => {
    for (const w of ["2026-11-03", "2026-11-09", "morgen", "2026-02-30"]) {
      const r = await auswerten(parseArgs(["--woche", w, "--export", "x"]), { jetzt: JETZT, projekt: PROJEKT });
      expect(r.exitCode).toBe(2);
    }
    expect((await auswerten(parseArgs(["--tippfehler"]), { jetzt: JETZT, projekt: PROJEKT })).exitCode).toBe(2);
  });
  test("wochenFenster: Mo 00:00Z bis nächster Mo, Vorwoche davor", () => {
    expect(F).toEqual({ von: "2026-11-02T00:00:00.000Z", bis: "2026-11-09T00:00:00.000Z", vorVon: "2026-10-26T00:00:00.000Z", vorBis: "2026-11-02T00:00:00.000Z" });
  });
});

describe("Projektfilter und Rezept", () => {
  test("Tags: Settings-Tags, Repo-Name und project:<Repo> ohne Dublette, mit Vermerk; environment gilt nur, wenn der Aufrufer ihn belegt", () => {
    const t = W.projektFilterAus({ tags: ["factory", "repo"], repoName: "repo" });
    expect(t.filter).toEqual({ column: "tags", operator: "any of", value: ["factory", "repo", "project:repo"], type: "arrayOptions" });
    expect(t.vermerk).toBe("nachgelieferte Calls ohne Tag fehlen");
    expect(W.projektFilterAus({ repoName: "repo", environment: "proj" })).toEqual({ filter: { column: "environment", operator: "=", value: "proj", type: "string" }, vermerk: null });
  });
  test("wochenRezept: Projektfilter in jeder observations-Abfrage, Fenster für Vorwoche und Scores", () => {
    const rez = W.wochenRezept({ montag: MONTAG, jetzt: JETZT.toISOString(), projektFilter: PF });
    for (const r of rez.filter((x: { abfrage: { view: string } }) => x.abfrage.view === "observations")) expect(r.abfrage.filters).toContainEqual(PF);
    const v = rez.find((r: { name: string }) => r.name === "gesamt Vorwoche");
    expect(v.abfrage).toMatchObject({ fromTimestamp: F.vorVon, toTimestamp: F.vorBis });
    const s = rez.find((r: { art: string }) => r.art === "erfassung");
    expect(s.abfrage).toMatchObject({ view: "scores-numeric", fromTimestamp: F.vorVon, toTimestamp: "2026-11-11T11:30:00.000Z" });
    expect(s.abfrage.filters[0]).toEqual(SCORE_FILTER);
    expect(rez.filter((r: { art: string }) => r.art === "sessions")).toHaveLength(2);
  });
});

describe("Bericht", () => {
  test("Abschnitte je Rolle und Modell, Datenlücke Tag, Summe, Δ und Probe stehen im Markdown", async () => {
    const r = await lauf([], satz({ kostenW: 40, kostenV: 20, luecke: true }));
    expect(r.stdout).toContain("# Langfuse-Wochenbericht 2026-11-02");
    expect(r.stdout).toContain("### Je Rolle");
    expect(r.stdout).toContain("### Je Modell");
    expect(r.stdout).toContain("claude-opus-5-5");
    expect(r.stdout).toContain("Tage ohne Daten: 2026-11-05");
    expect(r.stdout).toContain("Woche 40.00 $, Vorwoche 20.00 $, Δ +100.0 %");
    expect(r.stdout).toContain("2 Sessions (ohne Codex): 2 mit Score 1, 0 mit Score unter 1, 0 mit „Score ausstehend“. Ø erfassung_hook 0.75");
    expect(r.stdout).toContain("nachgelieferte Calls ohne Tag fehlen");
    expect(r.stdout).toContain(W.KEINE_SCHWELLEN);
    expect(r.exitCode).toBe(0);
  });
  test("Vorwoche ohne Kosten: Δ ist „–“ und die Schwelle wird nicht bewertet (kein Agent-Lauf)", async () => {
    const r = await lauf([], satz({ kostenV: 0 }), { projekt: { ...PROJEKT, schwellen: { erfassungLueckenMax: 0, kostenAnstiegProzent: 50 } } });
    expect(r.stdout).toContain("Δ – (Vorwoche ohne Kosten, nicht bewertbar)");
    expect(r.stdout).toContain("kostenAnstiegProzent: nicht bewertbar");
    expect(r.exitCode).toBe(0);
  });
});

describe("Erfassungsprobe", () => {
  const probe = (sW: Array<[string, string]>, sV: Array<[string, string]>, scores: Array<[string, string, number]>) =>
    W.erfassungsprobe({ sessionsW: sW.map(([sessionId, traceName]) => ({ sessionId, traceName })), sessionsV: sV.map(([sessionId, traceName]) => ({ sessionId, traceName })), scores: scores.map(([sessionId, name, avg_value]) => ({ sessionId, name, avg_value })) });
  const C = "Claude Code Turn";
  test("n/k/m/j und Ø Hook; j der Woche zählt nicht als Lücke, j der Vorwoche schon; Codex ist ausgenommen", () => {
    const p = probe(
      [["a", C], ["b", C], ["c", C], ["d", "Codex: x"], ["a", "Abgleich"]],
      [["v1", C], ["v2", C], ["a", C], ["v3", "Codex: x"]],
      [["a", "erfassung", 1], ["b", "erfassung", 0.5], ["v1", "erfassung", 1], ["a", "erfassung_hook", 0.5], ["b", "erfassung_hook", 1]],
    );
    expect(p).toMatchObject({ n: 3, k: 1, m: 1, j: 1, jVorwoche: 1, luecken: 2, hookMittel: 0.75 });
  });
  test("ohne Hook-Scores ist Ø Hook null; eine Session in beiden Wochen zählt nur in der Woche", () => {
    const p = probe([["a", C]], [["a", C]], []);
    expect(p).toMatchObject({ n: 1, j: 1, jVorwoche: 0, luecken: 0, hookMittel: null });
  });
});

describe("Urteil", () => {
  const ist = (l: number | null, k: number | null, u: number | null) => ({ erfassungLueckenMax: l, kostenAnstiegProzent: k, unzugeordnetProzent: u });
  test("ohne Block die Pflichtzeile, kein Agent-Lauf", () => {
    expect(W.urteil(undefined, ist(99, 99, 99))).toEqual({ konfiguriert: false, agentLaufNoetig: false, gruende: [], hinweise: [W.KEINE_SCHWELLEN] });
  });
  test("genau auf Soll ist nicht überschritten, knapp darüber schon, je Schwelle mit Ist und Soll", () => {
    expect(W.urteil(SCHWELLEN, ist(0, 50, 90)).agentLaufNoetig).toBe(false);
    for (const [i, name] of [[ist(1, 50, 90), "erfassungLueckenMax"], [ist(0, 50.01, 90), "kostenAnstiegProzent"], [ist(0, 50, 90.01), "unzugeordnetProzent"]] as const) {
      const u = W.urteil(SCHWELLEN, i);
      expect(u.agentLaufNoetig).toBe(true);
      expect(u.gruende).toEqual([{ schwelle: name, ist: i[name], soll: SCHWELLEN[name] }]);
    }
  });
  test("mehrere Gründe zugleich; fehlendes Feld heißt nicht gesetzt; null heißt nicht bewertbar", () => {
    expect(W.urteil(SCHWELLEN, ist(5, 99, 99)).gruende).toHaveLength(3);
    const u = W.urteil({ erfassungLueckenMax: 0 }, ist(0, 999, null));
    expect(u.hinweise).toEqual(["kostenAnstiegProzent: nicht gesetzt", "unzugeordnetProzent: nicht gesetzt"]);
    expect(W.urteil({ unzugeordnetProzent: 10 }, ist(0, 0, null)).hinweise).toContain("unzugeordnetProzent: nicht bewertbar");
  });
  test("CLI: Exit 3 mit Grund im Bericht, Exit 0 darunter", async () => {
    const r = await lauf([], satz({ kostenW: 100, kostenV: 20 }), { projekt: { ...PROJEKT, schwellen: { kostenAnstiegProzent: 50 } } });
    expect(r.exitCode).toBe(3);
    expect(r.stdout).toContain("Agent-Lauf nötig");
    expect(r.stdout).toContain("kostenAnstiegProzent: Ist 400.0, Soll höchstens 50");
    expect((await lauf([], satz({ kostenW: 25, kostenV: 20 }), { projekt: { ...PROJEKT, schwellen: { kostenAnstiegProzent: 50 } } })).exitCode).toBe(0);
  });
  test("Erfassungslücke aus der Vorwoche löst Exit 3 aus", async () => {
    const r = await lauf([], satz({ sessionsV: [["v9", "Claude Code Turn"]] }), { projekt: { ...PROJEKT, schwellen: { erfassungLueckenMax: 0 } } });
    expect(r.exitCode).toBe(3);
    expect(JSON.parse((await lauf(["--json"], satz({ sessionsV: [["v9", "Claude Code Turn"]] }), { projekt: { ...PROJEKT, schwellen: { erfassungLueckenMax: 0 } } })).stdout).urteil.agentLaufNoetig).toBe(true);
  });
});

describe("Fehler (Exit 1)", () => {
  test("Export ohne Projektfilter, fehlender Pflicht-Export, kaputtes JSON, abgeschnittener Export", async () => {
    const ohne = satz();
    ohne["gesamtW.json"] = exp("gesamt", F.von, F.bis, gesamtW(), [TYPE]);
    expect(await lauf([], ohne)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("Projektfilter fehlt") });
    const fehlt = satz();
    delete fehlt["scores.json"];
    expect(await lauf([], fehlt)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("Pflicht-Export fehlt: erfassung") });
    expect(await lauf([], { ...satz(), "kaputt.json": "{nicht json" })).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("kein lesbares JSON") });
    const voll = satz();
    voll["sessW.json"] = sess("sessions", F.von, F.bis, Array.from({ length: 1000 }, (_, i) => [`s${i}`, "Claude Code Turn"] as [string, string]));
    expect(await lauf([], voll)).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("abgeschnitten") });
  });
  test("ein Export mit fremdem Fenster wird abgelehnt", async () => {
    expect(await lauf([], { ...satz(), "alt.json": exp("gesamt", "2026-01-05T00:00:00.000Z", "2026-01-12T00:00:00.000Z", gesamtW()) })).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("weder zur Woche noch zur Vorwoche") });
  });
});

describe("Negativfälle (Exit 4)", () => {
  test("keine Daten der Woche: Warnung, .json mit status keine-daten, keine .md, alte .md entfernt", async () => {
    const home = tmp();
    const ordner = join(home, ".claude", "state", "langfuse-wochenbericht", "own__repo");
    mkdirSync(ordner, { recursive: true });
    writeFileSync(join(ordner, `${MONTAG}.md`), "alt");
    const s = satz();
    s["gesamtW.json"] = exp("gesamt", F.von, F.bis, []);
    const r = await lauf(["--ablegen"], s, { home });
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("WARNUNG");
    expect(r.stderr).toContain("keine-daten");
    expect(JSON.parse(readFileSync(join(ordner, `${MONTAG}.json`), "utf8"))).toMatchObject({ status: "keine-daten", woche: MONTAG });
    expect(existsSync(join(ordner, `${MONTAG}.md`))).toBe(false);
  });
  test("Langfuse unerreichbar (Live-Modul, Health scheitert): Exit 4, status unerreichbar, keine .md, keine Metrics-Abfrage", async () => {
    const home = tmp();
    const urls: string[] = [];
    const fetchImpl = async (url: string) => { urls.push(url); throw new Error("ECONNREFUSED"); };
    const r = await auswerten(parseArgs(["--ablegen", "--json"]), { jetzt: JETZT, projekt: PROJEKT, home, env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_BASE_URL: "http://127.0.0.1:9" }, fetchImpl });
    const ordner = join(home, ".claude", "state", "langfuse-wochenbericht", "own__repo");
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("unerreichbar");
    expect(JSON.parse(r.stdout).status).toBe("unerreichbar");
    expect(JSON.parse(readFileSync(join(ordner, `${MONTAG}.json`), "utf8")).status).toBe("unerreichbar");
    expect(existsSync(join(ordner, `${MONTAG}.md`))).toBe(false);
    expect(urls.every((u) => u.includes("/api/public/health"))).toBe(true);
  });
  test("Health 503 ist unerreichbar, nie eine Abfrage", async () => {
    const urls: string[] = [];
    const r = await ladeLiveExporte({ rezepte: [{ art: "gesamt", name: "x", abfrage: {} }], env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }, home: tmp(), fetchImpl: (async (u: string) => { urls.push(u); return { status: 503, ok: false }; }) as never });
    expect(r).toMatchObject({ status: "unerreichbar" });
    expect(urls).toHaveLength(1);
  });
  test("Live mit Health 200 und leeren Daten ergibt keine-daten; fehlender Zugang ist Exit 1", async () => {
    const fetchImpl = async (url: string) => (url.includes("/health") ? { status: 200, ok: true } : { ok: true, status: 200, json: async () => ({ data: [] }) });
    const r = await auswerten(parseArgs(["--json"]), { jetzt: JETZT, projekt: PROJEKT, home: tmp(), env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }, fetchImpl });
    expect(r.exitCode).toBe(4);
    expect(JSON.parse(r.stdout).status).toBe("keine-daten");
    const ohneKey = await auswerten(parseArgs([]), { jetzt: JETZT, projekt: PROJEKT, home: tmp(), env: {}, fetchImpl });
    expect(ohneKey.exitCode).toBe(1);
  });
  test("Live mit Daten liefert einen Bericht", async () => {
    const fetchImpl = async (url: string) => {
      if (url.includes("/health")) return { status: 200, ok: true };
      const q = JSON.parse(decodeURIComponent(url.split("query=")[1]));
      const von = q.fromTimestamp;
      const data = q.view === "scores-numeric" ? [{ sessionId: "s1", name: "erfassung", avg_value: 1 }]
        : q.dimensions?.[0]?.field === "sessionId" ? [{ sessionId: "s1", traceName: "Claude Code Turn", count_count: 2 }]
        : q.timeDimension ? tage(von)
        : q.filters.some((x: { type: string }) => x.type === "stringObject") ? []
        : [{ ...g("Claude Code Turn", "LLM Call", "claude-opus-5-5", "default", 4, 2), min_latency: 1 }];
      return { ok: true, status: 200, json: async () => ({ data }) };
    };
    const r = await auswerten(parseArgs([]), { jetzt: JETZT, projekt: PROJEKT, home: tmp(), env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }, fetchImpl });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("1 Sessions (ohne Codex): 1 mit Score 1");
  });
});

describe("Schlüsselgrenze", () => {
  test("--export und --rezept laden das Live-Modul nie", async () => {
    const ladeLive = () => { throw new Error("Live geladen"); };
    expect((await lauf([], satz(), { ladeLive })).exitCode).toBe(0);
    const rez = await lauf(["--rezept"], {}, { ladeLive });
    expect(rez.exitCode).toBe(0);
    expect(JSON.parse(rez.stdout).length).toBeGreaterThan(10);
  });
  test("die statische Import-Hülle der CLI enthält weder langfuse-api noch langfuse-zugang, keinen Key und kein fetch; der Live-Pfad ist ein eigenes, dynamisch geladenes Modul", () => {
    const lies = (p: string) => readFileSync(p, "utf8");
    const cli = lies("scripts/langfuse-wochenbericht.mjs");
    const statisch = [...cli.matchAll(/^import [^\n]* from "\.\/([^"]+)";$/gm)].map((m) => `scripts/${m[1]}`);
    expect(statisch).toContain("scripts/langfuse-wochenbericht-lib.mjs");
    const h = [...new Set(["scripts/langfuse-wochenbericht.mjs", ...statisch.flatMap((e) => importHuelle(e, lies))])];
    expect(h).toContain("scripts/langfuse-wochenbericht-lib.mjs");
    expect(h).not.toContain("scripts/langfuse-api.mjs");
    expect(h).not.toContain("scripts/langfuse-zugang.mjs");
    expect(h).not.toContain("scripts/langfuse-wochenbericht-live.mjs");
    for (const f of h) expect(lies(f)).not.toMatch(/LANGFUSE_SECRET_KEY|fetch\(/);
    expect(cli.match(/import\("\.\/langfuse-wochenbericht-live\.mjs"\)/g)).toHaveLength(1);
    expect(importHuelle("scripts/langfuse-wochenbericht-live.mjs", lies)).toContain("scripts/langfuse-zugang.mjs");
  });
  test("die Lib importiert nur die pure Auswertungs-Lib", () => {
    const imports = readFileSync("scripts/langfuse-wochenbericht-lib.mjs", "utf8").match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("./langfuse-auswertung-lib.mjs");
  });
});

describe("Ablage", () => {
  test("--ablegen schreibt <montag>.md und <montag>.json nach ~/.claude/state/langfuse-wochenbericht/<owner>__<repo>/", async () => {
    const home = tmp();
    const r = await lauf(["--ablegen"], satz(), { home });
    const ordner = join(home, ".claude", "state", "langfuse-wochenbericht", "own__repo");
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(ordner, `${MONTAG}.md`), "utf8")).toContain("# Langfuse-Wochenbericht");
    expect(JSON.parse(readFileSync(join(ordner, `${MONTAG}.json`), "utf8"))).toMatchObject({ status: "bericht", woche: MONTAG });
  });
  test("ohne --ablegen wird nichts geschrieben", async () => {
    const home = tmp();
    await lauf([], satz(), { home });
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });
});
