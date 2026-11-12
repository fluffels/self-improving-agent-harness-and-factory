import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { importHuelle } from "./support/import-huelle";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/langfuse-wochenbericht-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as otlpRaw from "../scripts/langfuse-otlp.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../scripts/langfuse-wochenbericht.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as liveRaw from "../scripts/langfuse-wochenbericht-live.mjs";

/** Das echte `gh` erreicht nie ein Test: `ghText` ist gemockt, geprüft wird nur, mit welchen Argumenten der Rückfall (`deps.gh` fehlt) es ruft (factory#324). */
const ghMockAufrufe = vi.hoisted(() => [] as string[][]);
vi.mock("../scripts/gh-cli.mjs", async (orig) => {
  const echt = await orig<Record<string, unknown>>();
  return { ...echt, ghText: (args: string[]) => { ghMockAufrufe.push(args); return JSON.stringify({ total_count: 7, incomplete_results: false }); } };
});

type Abfr = { view: string; filters: unknown[]; fromTimestamp: string; toTimestamp: string };
type Rez = { art: string; name: string; abfrage: Abfr };
type Ist = { erfassungLueckenMax: number | null; kostenAnstiegProzent: number | null; unzugeordnetProzent: number | null };
type Urteil = { konfiguriert: boolean; agentLaufNoetig: boolean; gruende: unknown[]; hinweise: string[] };
const W = libRaw as unknown as {
  RUHEFRIST_MS: number;
  KEINE_SCHWELLEN: string;
  wochenFenster: (m: string) => { von: string; bis: string; vorVon: string; vorBis: string };
  letzteVolleWoche: (d: Date) => string;
  projektFilterAus: (o: { tags?: string[]; repoName: string; environment?: string }) => { filter: unknown; vermerk: string | null };
  wochenRezept: (o: { montag: string; jetzt: string; rollen?: string[]; projektFilter: unknown }) => Rez[];
  erfassungsprobe: (o: { sessionsW: unknown[]; sessionsV: unknown[]; scores: unknown[] }) => Record<string, number | null>;
  urteil: (s: Record<string, number> | undefined, i: Ist) => Urteil;
};
type Ergebnis = { exitCode: number; stdout: string; stderr: string };
type Wb = Record<string, unknown>;
const E = libRaw as unknown as {
  pruefeAbgeschlossen: (m: string, jetzt: string) => void;
  ordneExporte: (roh: Array<{ json: unknown; pfad: string }>, o: { montag: string; projektFilter: unknown }) => unknown;
  kennzahlen: (b: Wb, bV: Wb, merges?: { woche: number; vorwoche: number } | null) => { deltaProzent: number | null; unzugeordnetProzent: number | null; deltaJeMergeProzent: number | null; jeMerge: number | null; jeMergeVorwoche: number | null; merges: { woche: number; vorwoche: number } | null };
  mergeSucheArgs: (o: { owner: string; repo: string; von: string; bis: string }) => string[];
  mergeAnzahl: (t: string) => number;
};
const ordneSatz = (dateien: Satz) => E.ordneExporte(Object.values(dateien).map((json, i) => ({ json, pfad: `p${i}` })), { montag: MONTAG, projektFilter: PF });
const C = cliRaw as unknown as { parseArgs: (a: string[]) => unknown; auswerten: (a: unknown, d?: Record<string, unknown>) => Promise<Ergebnis> };
const { parseArgs, auswerten } = C;
const CLI = cliRaw as unknown as { ladeProjekt: (w?: string, lies?: (p: string, e: string) => string) => { owner: string; repo: string; tags: string[]; schwellen?: Record<string, number> } };
const ladeLiveExporte = (liveRaw as unknown as { ladeLiveExporte: (o: Record<string, unknown>) => Promise<{ status: string }> }).ladeLiveExporte;

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
const scoreExp = (f: typeof F, rows: Array<[string, string, number]>) => ({ art: "erfassung", abfrage: { view: "scores-numeric", filters: [SCORE_FILTER], fromTimestamp: f.vorVon, toTimestamp: "2026-11-11T11:30:00.000Z" }, data: rows.map(([sessionId, name, avg_value]) => ({ sessionId, name, avg_value })) });

const lese = <T,>(t: string): T => JSON.parse(t) as T;
type Satz = Record<string, unknown>;
function satz(opt: { kostenW?: number; kostenV?: number; sessionsW?: Array<[string, string]>; sessionsV?: Array<[string, string]>; scores?: Array<[string, string, number]>; luecke?: boolean; f?: typeof F } = {}): Satz {
  const f = opt.f ?? F;
  return {
    "gesamtW.json": exp("gesamt", f.von, f.bis, gesamtW(opt.kostenW ?? 20)),
    "tageW.json": exp("tage", f.von, f.bis, tage(f.von, opt.luecke)),
    "gesamtV.json": exp("gesamt", f.vorVon, f.vorBis, [g("Claude Code Turn", "LLM Call", "claude-opus-5-5", "default", 10, opt.kostenV ?? 20)]),
    "sessW.json": sess("sessions", f.von, f.bis, opt.sessionsW ?? [["s1", "Claude Code Turn"], ["s2", "Claude Code Turn"]]),
    "sessV.json": sess("sessions", f.vorVon, f.vorBis, opt.sessionsV ?? [["s0", "Claude Code Turn"]]),
    "scores.json": scoreExp(f, opt.scores ?? [["s1", "erfassung", 1], ["s2", "erfassung", 1], ["s0", "erfassung", 1], ["s1", "erfassung_hook", 0.5], ["s2", "erfassung_hook", 1]]),
  };
}

const PROJEKT = { owner: "own", repo: "repo", schwellen: undefined as Satz | undefined, tags: ["factory"], wurzel: process.cwd() };
function lauf(argv: string[], dateien: Satz, deps: Satz = {}) {
  const lies = (p: string) => (p in dateien ? (typeof dateien[p] === "string" ? dateien[p] : JSON.stringify(dateien[p])) : (() => { throw new Error("ENOENT " + p); })());
  return auswerten(parseArgs([...argv, ...(argv.includes("--rezept") ? [] : Object.keys(dateien).flatMap((p) => ["--export", p]))]), { jetzt: JETZT, projekt: PROJEKT, lies, gh: GH, ...deps });
}
const temps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "wb-"));
  temps.push(d);
  return d;
};
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});
const fehler = async (dateien: Satz, text: string) => {
  const r = await lauf([], dateien);
  expect(r.exitCode).toBe(1);
  expect(r.stderr).toContain(text);
};
const SCHWELLEN = { erfassungLueckenMax: 0, kostenAnstiegProzent: 50, unzugeordnetProzent: 90 };
/** `gh`-Stub der Merge-Suche (factory#324): Woche (Montag 2026-11-02) und Vorwoche liefern je die übergebene Zahl; echtes `gh` erreicht nie einen Test. */
const ghMerges = (woche: number, vorwoche: number) => (args: string[]) => {
  const q = args.find((a) => a.startsWith("q=")) ?? "";
  return JSON.stringify({ total_count: q.includes("merged:2026-11-02T") ? woche : vorwoche, incomplete_results: false });
};
const GH = ghMerges(10, 10);

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

type Otlp = {
  bauePayloads: (s: string, e: unknown[], o: object) => { chunks: { payload: { resourceSpans: { scopeSpans: { spans: { attributes: { key: string; value: { arrayValue?: { values: { stringValue: string }[] } } }[] }[] }[] }[] } }[] };
  projektTagsAus: (roh: unknown) => string[];
  codexProjektTag: (repoName: string) => string;
  projektFilterTags: (o: { tags?: string[]; repoName: string }) => string[];
};
const OTLP = otlpRaw as unknown as Otlp;
const sendeTags = (env: object, ticket: string | null): string[] => {
  const e = { id: "g1", traceId: "t".repeat(32), session: "s1", messageId: "m1", model: "claude-opus-5-5", ts: "2026-11-01T10:00:00.000Z", usage: { input: 1, output: 0, cacheRead: 0, cacheCreation: 0 }, rolle: null, ticket };
  const span = OTLP.bauePayloads("s1", [e], { env, project: "repo", repoName: "repo" }).chunks[0].payload.resourceSpans[0].scopeSpans[0].spans[0];
  return span.attributes.find((a) => a.key === "langfuse.trace.tags")!.value.arrayValue!.values.map((v) => v.stringValue);
};

describe("Tag-Schema, einzige Quelle (factory#406)", () => {
  test("Charakterisierung: Sendetags = [repo, ...Projekt-Tags getrimmt ohne Leere, abgleich, ...Tickets]", () => {
    expect(sendeTags({ CC_LANGFUSE_TRACE_TAGS: " x, ,y" }, "factory#9")).toEqual(["repo", "x", "y", "abgleich", "factory#9"]);
    expect(sendeTags({}, null)).toEqual(["repo", "abgleich"]);
  });
  test("projektTagsAus: kommagetrennt, getrimmt, ohne Leere; kein Text gibt []", () => {
    expect(OTLP.projektTagsAus(" x, ,y")).toEqual(["x", "y"]);
    for (const roh of [undefined, null, 5, ""]) expect(OTLP.projektTagsAus(roh)).toEqual([]);
  });
  test("codexProjektTag und projektFilterTags: Filter enthält Settings-Tags, Repo-Name und project:<Repo> ohne Dublette", () => {
    expect(OTLP.codexProjektTag("repo")).toBe("project:repo");
    expect(OTLP.projektFilterTags({ tags: ["x", "repo"], repoName: "repo" })).toEqual(["x", "repo", "project:repo"]);
    expect(OTLP.projektFilterTags({ repoName: "repo" })).toEqual(["repo", "project:repo"]);
  });
  test("Vertrag: jedes projektbezogene Sendetag und das Codex-Tag liegt im Projektfilter", () => {
    const tags = OTLP.projektTagsAus("x,y");
    const filter = W.projektFilterAus({ tags, repoName: "repo" }).filter as { value: string[] };
    for (const t of [...sendeTags({ CC_LANGFUSE_TRACE_TAGS: "x,y" }, null).filter((t) => t !== "abgleich"), OTLP.codexProjektTag("repo")]) expect(filter.value).toContain(t);
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
    expect(v?.abfrage).toMatchObject({ fromTimestamp: F.vorVon, toTimestamp: F.vorBis });
    const s = rez.find((r: { art: string }) => r.art === "erfassung");
    expect(s?.abfrage).toMatchObject({ view: "scores-numeric", fromTimestamp: F.vorVon, toTimestamp: "2026-11-11T11:30:00.000Z" });
    expect(s?.abfrage.filters[0]).toEqual(SCORE_FILTER);
    expect(rez.filter((r: { art: string }) => r.art === "sessions")).toHaveLength(2);
  });
});

describe("Bericht", () => {
  test("Abschnitte je Rolle und Modell, Datenlücke Tag, Summe, Δ und Probe stehen im Markdown", async () => {
    const r = await lauf([], satz({ kostenW: 40, kostenV: 20, luecke: true }));
    expect(r.stdout).toContain("# Langfuse-Wochenbericht 2026-11-02");
    expect(r.stdout).toMatch(/^### Je Rolle/m);
    expect(r.stdout).toMatch(/^### Je Modell/m);
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
    expect(r.stdout).toMatch(/^Agent-Lauf nötig\.$/m);
    expect(r.stdout).toContain("kostenAnstiegProzent: Ist 400.0, Soll höchstens 50");
    const ruhig = await lauf([], satz({ kostenW: 25, kostenV: 20 }), { projekt: { ...PROJEKT, schwellen: { kostenAnstiegProzent: 50 } } });
    expect(ruhig.exitCode).toBe(0);
    expect(ruhig.stdout).toMatch(/^kein Agent-Lauf nötig\.$/m);
  });
  test("Erfassungslücke aus der Vorwoche löst Exit 3 aus", async () => {
    const r = await lauf([], satz({ sessionsV: [["v9", "Claude Code Turn"]] }), { projekt: { ...PROJEKT, schwellen: { erfassungLueckenMax: 0 } } });
    expect(r.exitCode).toBe(3);
    const j = await lauf(["--json"], satz({ sessionsV: [["v9", "Claude Code Turn"]] }), { projekt: { ...PROJEKT, schwellen: { erfassungLueckenMax: 0 } } });
    expect(lese<{ urteil: { agentLaufNoetig: boolean } }>(j.stdout).urteil.agentLaufNoetig).toBe(true);
  });
});

describe("Fehler (Exit 1)", () => {
  test("Export ohne Projektfilter, fehlender Pflicht-Export, kaputtes JSON, abgeschnittener Export", async () => {
    const ohne = satz();
    ohne["gesamtW.json"] = exp("gesamt", F.von, F.bis, gesamtW(), [TYPE]);
    await fehler(ohne, "Projektfilter fehlt");
    const fehlt = satz();
    delete fehlt["scores.json"];
    await fehler(fehlt, "Pflicht-Export fehlt: erfassung");
    await fehler({ ...satz(), "kaputt.json": "{nicht json" }, "kein lesbares JSON");
    const voll = satz();
    voll["sessW.json"] = { ...(voll["sessW.json"] as object), data: "kein Array" };
    await fehler(voll, "kein Array");
    const anderer = satz();
    anderer["sessW.json"] = sess("sessions", F.von, F.bis, [["s1", "Claude Code Turn"]]);
    (anderer["sessW.json"] as { abfrage: { filters: unknown[] } }).abfrage.filters = [TYPE];
    await fehler(anderer, "Projektfilter fehlt");
  });
  test("Export am Zeilenlimit (genau 1000 Zeilen): Exit 4, Status abgeschnitten, grund nennt den Export; 999 bleibt Bericht", async () => {
    const zeilen = Array.from({ length: 1000 }, (_, i) => [`s${i}`, "Claude Code Turn"] as [string, string]);
    const sessions = satz();
    sessions["sessW.json"] = sess("sessions", F.von, F.bis, zeilen);
    const r = await lauf(["--json"], sessions);
    expect(r.exitCode).toBe(4);
    expect(lese<{ status: string; woche: string }>(r.stdout)).toMatchObject({ status: "abgeschnitten", woche: MONTAG });
    expect(lese<{ grund: string }>(r.stdout).grund).toContain("sessW.json");
    expect(r.stderr).toContain("abgeschnitten");
    const gesamt = satz();
    gesamt["gesamtW.json"] = exp("gesamt", F.von, F.bis, Array.from({ length: 1000 }, () => g("Claude Code Turn", "LLM Call", "claude-opus-5-5", "default", 1, 1)));
    const r2 = await lauf(["--json"], gesamt);
    expect(r2.exitCode).toBe(4);
    expect(lese<{ status: string }>(r2.stdout)).toMatchObject({ status: "abgeschnitten" });
    expect(lese<{ grund: string }>(r2.stdout).grund).toContain("gesamtW.json");
    const knapp = satz();
    knapp["sessW.json"] = sess("sessions", F.von, F.bis, zeilen.slice(0, 999));
    expect((await lauf([], knapp)).exitCode).not.toBe(4);
  });
  test("ein Export mit fremdem Fenster wird abgelehnt", async () => {
    await fehler({ ...satz(), "alt.json": exp("gesamt", "2026-01-05T00:00:00.000Z", "2026-01-12T00:00:00.000Z", gesamtW()) }, "weder zur Woche noch zur Vorwoche");
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
    const fetchImpl = (url: string) => { urls.push(url); return Promise.reject(new Error("ECONNREFUSED")); };
    const r = await auswerten(parseArgs(["--ablegen", "--json"]), { jetzt: JETZT, projekt: PROJEKT, home, env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk", LANGFUSE_BASE_URL: "http://127.0.0.1:9" }, fetchImpl });
    const ordner = join(home, ".claude", "state", "langfuse-wochenbericht", "own__repo");
    expect(r.exitCode).toBe(4);
    expect(r.stderr).toContain("unerreichbar");
    expect(lese<{ status: string }>(r.stdout).status).toBe("unerreichbar");
    expect(lese<{ status: string }>(readFileSync(join(ordner, `${MONTAG}.json`), "utf8")).status).toBe("unerreichbar");
    expect(existsSync(join(ordner, `${MONTAG}.md`))).toBe(false);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.includes("/api/public/health"))).toBe(true);
  });
  test("Health 503 ist unerreichbar, nie eine Abfrage", async () => {
    const urls: string[] = [];
    const r = await ladeLiveExporte({ rezepte: [{ art: "gesamt", name: "x", abfrage: {} }], env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }, home: tmp(), fetchImpl: (u: string) => { urls.push(u); return Promise.resolve({ status: 503, ok: false }); } });
    expect(r.status).toBe("unerreichbar");
    expect(urls).toHaveLength(1);
  });
  test("Live mit Health 200 und leeren Daten ergibt keine-daten; fehlender Zugang ist Exit 1", async () => {
    const fetchImpl = (url: string) => Promise.resolve(url.includes("/health") ? { status: 200, ok: true } : { ok: true, status: 200, json: () => Promise.resolve({ data: [] }) });
    const r = await auswerten(parseArgs(["--json"]), { jetzt: JETZT, projekt: PROJEKT, home: tmp(), env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }, fetchImpl });
    expect(r.exitCode).toBe(4);
    expect(lese<{ status: string }>(r.stdout).status).toBe("keine-daten");
    const ohneKey = await auswerten(parseArgs([]), { jetzt: JETZT, projekt: PROJEKT, home: tmp(), env: {}, fetchImpl });
    expect(ohneKey.exitCode).toBe(1);
  });
  test("Live mit Daten liefert einen Bericht", async () => {
    const fetchImpl = (url: string) => {
      if (url.includes("/health")) return Promise.resolve({ status: 200, ok: true });
      const q = lese<{ fromTimestamp: string; view: string; dimensions?: Array<{ field: string }>; timeDimension?: unknown; filters: Array<{ type: string }> }>(decodeURIComponent(url.split("query=")[1]));
      const von = q.fromTimestamp;
      const data = q.view === "scores-numeric" ? [{ sessionId: "s1", name: "erfassung", avg_value: 1 }]
        : q.dimensions?.[0]?.field === "sessionId" ? [{ sessionId: "s1", traceName: "Claude Code Turn", count_count: 2 }]
        : q.timeDimension ? tage(von)
        : q.filters.some((x) => x.type === "stringObject") ? []
        : [{ ...g("Claude Code Turn", "LLM Call", "claude-opus-5-5", "default", 4, 2), min_latency: 1 }];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data }) });
    };
    const r = await auswerten(parseArgs([]), { jetzt: JETZT, projekt: PROJEKT, home: tmp(), env: { LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" }, fetchImpl, gh: GH });
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
    expect(lese<unknown[]>(rez.stdout).length).toBeGreaterThan(10);
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
  test("die Lib importiert nur die pure Auswertungs-Lib und das pure Tag-Schema", () => {
    const imports = readFileSync("scripts/langfuse-wochenbericht-lib.mjs", "utf8").match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(2);
    expect(imports.some((i) => i.includes("./langfuse-auswertung-lib.mjs"))).toBe(true);
    expect(imports.some((i) => i.includes("./langfuse-otlp.mjs"))).toBe(true);
  });
});

describe("Randfälle (Guards)", () => {
  test("Ruhefrist: genau 30 min nach Wochenende ist erlaubt, eine Sekunde früher nicht", () => {
    expect(() => E.pruefeAbgeschlossen(MONTAG, "2026-11-09T00:30:00.000Z")).not.toThrow();
    expect(() => E.pruefeAbgeschlossen(MONTAG, "2026-11-09T00:29:59.000Z")).toThrow(/noch nicht abgeschlossen/);
  });
  test("negatives Δ trägt das Minuszeichen; Summe ohne Kosten der Woche macht Anteil unzugeordnet nicht bewertbar", async () => {
    const r = await lauf([], satz({ kostenW: 10, kostenV: 20 }));
    expect(r.stdout).toContain("Δ -50.0 %");
    const k = E.kennzahlen({ bereinigt: { cost: 0, count: 0 }, unzugeordnet: { cost: 0 } }, { bereinigt: { cost: 5, count: 3 } });
    expect(k).toMatchObject({ deltaProzent: -100, unzugeordnetProzent: null });
  });
  test("Eigene Exporte: Fenster fehlt, Score-Filter fehlt und Projektfilter an sessions fehlen sind Fehler; jeder fehlende Pflicht-Export steht im Text", async () => {
    const a = satz();
    a["sessW.json"] = { art: "sessions", abfrage: { filters: [TYPE, PF] }, data: [] };
    await fehler(a, "Fenster (fromTimestamp/toTimestamp) fehlt");
    const b = satz();
    b["scores.json"] = { ...(b["scores.json"] as Wb), abfrage: { filters: [], fromTimestamp: F.vorVon, toTimestamp: F.bis } };
    await fehler(b, "Filter name any of [erfassung, erfassung_hook] fehlt");
    const c = satz();
    c["sessV.json"] = sess("sessions", F.vorVon, F.vorBis, []);
    (c["sessV.json"] as { abfrage: { filters: unknown[] } }).abfrage.filters = [TYPE];
    await fehler(c, "Projektfilter fehlt oder weicht ab");
    const d = satz();
    delete d["sessV.json"];
    delete d["tageW.json"];
    await fehler(d, "Pflicht-Export fehlt: tage der Woche, sessions der Vorwoche");
    const e = satz();
    e["sessW.json"] = { ...(e["sessW.json"] as Wb), data: "x" };
    await fehler(e, "data fehlt oder ist kein Array");
  });
  test("ohne Hook-Scores steht Ø erfassung_hook als „–“", async () => {
    const r = await lauf([], satz({ scores: [["s1", "erfassung", 1], ["s2", "erfassung", 1], ["s0", "erfassung", 1]] }));
    expect(r.stdout).toContain("Ø erfassung_hook –.");
  });
  test("Sessions ohne ID, Scores mit fremdem Namen oder ohne Zahl zählen nicht", () => {
    const p = W.erfassungsprobe({
      sessionsW: [{ sessionId: null, traceName: "Claude Code Turn" }, { sessionId: " ", traceName: "Claude Code Turn" }, { sessionId: "a", traceName: "Claude Code Turn" }],
      sessionsV: [],
      scores: [{ sessionId: "a", name: "anderes", avg_value: 1 }, { sessionId: "a", name: "erfassung", avg_value: "x" }, { sessionId: "", name: "erfassung", avg_value: 1 }],
    });
    expect(p).toMatchObject({ n: 1, k: 0, m: 0, j: 1 });
  });
  test("ladeProjekt liest Repo und Schwellen aus der Config, Tags aus den Settings; fehlende oder falsche Settings ergeben keine Tags", () => {
    const echt = CLI.ladeProjekt();
    expect(echt.repo).toBe("self-improving-agent-harness-and-factory");
    expect(echt.owner).toBe("fluffels");
    expect(echt.schwellen).toEqual(expect.any(Object));
    expect(Array.isArray(echt.tags)).toBe(true);
    expect(CLI.ladeProjekt(process.cwd(), () => JSON.stringify({ env: { CC_LANGFUSE_TRACE_TAGS: "a, b ,," } })).tags).toEqual(["a", "b"]);
    expect(CLI.ladeProjekt(process.cwd(), () => { throw new Error("ENOENT"); }).tags).toEqual([]);
    expect(CLI.ladeProjekt(process.cwd(), () => JSON.stringify({ env: { CC_LANGFUSE_TRACE_TAGS: 5 } })).tags).toEqual([]);
  });
  test("ladeProjekt: unlesbare Settings ergeben einen Vermerk ohne Pfad, ein fehlender Schlüssel keinen", () => {
    const V = (lies: (p: string, e: string) => string) => (CLI.ladeProjekt(process.cwd(), lies) as unknown as { tags: string[]; tagsVermerk?: string }).tagsVermerk;
    expect(V(() => { throw new Error("ENOENT /x/y"); })).toBe("Projekt-Tags nicht lesbar (.claude/settings.json: fehlt), Filter nur über den Repo-Namen");
    expect(V(() => "{nicht json")).toBe("Projekt-Tags nicht lesbar (.claude/settings.json: kein gültiges JSON), Filter nur über den Repo-Namen");
    expect(V(() => JSON.stringify({ env: { CC_LANGFUSE_TRACE_TAGS: 5 } }))).toBe("Projekt-Tags nicht lesbar (.claude/settings.json: kein Text), Filter nur über den Repo-Namen");
    expect(V(() => JSON.stringify({ env: {} }))).toBeNull();
    expect(V(() => JSON.stringify({ env: { CC_LANGFUSE_TRACE_TAGS: "a" } }))).toBeNull();
  });
  test("tagsVermerk steht im Bericht (Markdown und JSON) und im Grund von keine-daten; ohne Vermerk bleibt die Ausgabe gleich", async () => {
    const mit = { ...PROJEKT, tagsVermerk: "Projekt-Tags nicht lesbar (.claude/settings.json: fehlt), Filter nur über den Repo-Namen" };
    const md = await lauf([], satz(), { projekt: mit });
    expect(md.stdout).toContain("Projekt-Tags nicht lesbar");
    const js = await lauf(["--json"], satz(), { projekt: mit });
    expect(lese<{ vermerk: string }>(js.stdout).vermerk).toContain("; Projekt-Tags nicht lesbar");
    const leer = satz();
    leer["gesamtW.json"] = exp("gesamt", F.von, F.bis, []);
    const kd = await lauf(["--json"], leer, { projekt: mit });
    expect(lese<{ grund: string }>(kd.stdout).grund).toContain("; Projekt-Tags nicht lesbar");
    const ohne = await lauf(["--json"], leer);
    expect(lese<{ grund: string }>(ohne.stdout).grund).not.toContain("Projekt-Tags");
    const normal = await lauf(["--json"], satz());
    expect(lese<{ vermerk: string }>(normal.stdout).vermerk).not.toContain("; ");
  });
  test("als Prozess: Aufruffehler ist Exit 2 ohne Netz, --rezept gibt JSON aus", () => {
    const a = spawnSync("node", ["scripts/langfuse-wochenbericht.mjs", "--woche", "2026-11-03"], { encoding: "utf8" });
    expect(a.status).toBe(2);
    expect(a.stderr).toContain("kein Montag");
    const b = spawnSync("node", ["scripts/langfuse-wochenbericht.mjs", "--rezept", "--woche", MONTAG], { encoding: "utf8" });
    expect(b.status).toBe(0);
    expect(lese<unknown[]>(b.stdout).length).toBeGreaterThan(10);
  });
});

describe("Verdrahtung und Guards (Runde 1)", () => {
  test("ohne --woche gilt die Ruhefrist: Montag 00:10Z liefert den Bericht der Woche davor", async () => {
    const f2 = W.wochenFenster("2026-10-26");
    const r = await lauf([], satz({ f: f2 }), { jetzt: new Date("2026-11-09T00:10:00Z") });
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("# Langfuse-Wochenbericht 2026-10-26");
  });
  test("unzugeordnetProzent: Anteil ohne Rolle über Soll gibt Exit 3 mit Ist, auf Soll nicht", async () => {
    const hoch = await lauf([], satz(), { projekt: { ...PROJEKT, schwellen: { unzugeordnetProzent: 50 } } });
    expect(hoch.exitCode).toBe(3);
    expect(hoch.stdout).toContain("unzugeordnetProzent: Ist 100.0, Soll höchstens 50");
    expect((await lauf([], satz(), { projekt: { ...PROJEKT, schwellen: { unzugeordnetProzent: 100 } } })).exitCode).toBe(0);
  });
  test("--rezept trägt den Projektfilter in jeder observations-Abfrage und nimmt --rolle in die Metadaten-Abfragen", async () => {
    const r = await lauf(["--rezept", "--rolle", "sonderrolle"], {});
    const rez = lese<Rez[]>(r.stdout);
    for (const x of rez.filter((y) => y.abfrage.view === "observations")) expect(x.abfrage.filters).toContainEqual(PF);
    const rollen = rez.filter((x) => x.art === "metadaten").flatMap((x) => x.abfrage.filters.map((y) => (y as { value?: string }).value));
    expect(rollen).toContain("sonderrolle");
  });
  test("Exit 4 ohne --ablegen schreibt nichts und gibt ohne --json keinen stdout aus", async () => {
    const home = tmp();
    const s = satz();
    s["gesamtW.json"] = exp("gesamt", F.von, F.bis, []);
    const r = await lauf([], s, { home });
    expect(r).toMatchObject({ exitCode: 4, stdout: "" });
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });
  test("jeder fehlende Pflicht-Export wird einzeln erkannt", async () => {
    for (const [datei, name] of [["gesamtW.json", "gesamt der Woche"], ["gesamtV.json", "gesamt der Vorwoche"], ["sessW.json", "sessions der Woche"]] as const) {
      const s = satz();
      delete s[datei];
      await fehler(s, `Pflicht-Export fehlt: ${name}`);
    }
    const falsch = satz();
    falsch["scores.json"] = { ...(falsch["scores.json"] as Wb), abfrage: { filters: [SCORE_FILTER], fromTimestamp: F.von, toTimestamp: F.bis } };
    await fehler(falsch, "Pflicht-Export fehlt: erfassung");
  });
  test("Fenster mit nur einem Zeitstempel und ein falscher Score-Namensfilter sind Fehler", async () => {
    const a = satz();
    a["sessW.json"] = { art: "sessions", abfrage: { filters: [TYPE, PF], fromTimestamp: F.von }, data: [] };
    await fehler(a, "Fenster (fromTimestamp/toTimestamp) fehlt");
    const b = satz();
    b["sessW.json"] = { art: "sessions", abfrage: { filters: [TYPE, PF], toTimestamp: F.bis }, data: [] };
    await fehler(b, "Fenster (fromTimestamp/toTimestamp) fehlt");
    const c = satz();
    c["scores.json"] = { ...(c["scores.json"] as Wb), abfrage: { filters: [{ ...SCORE_FILTER, value: ["x"] }], fromTimestamp: F.vorVon, toTimestamp: F.bis } };
    await fehler(c, "Filter name any of [erfassung, erfassung_hook] fehlt");
  });
  test("Projektfilter: environment verlangt String-Typ und -Wert; leere und Nicht-String-Tags fallen heraus", () => {
    const E2 = libRaw as unknown as { projektFilterAus: (o: { tags?: unknown[]; repoName: string }) => { filter: { value: string[] } } };
    expect(E2.projektFilterAus({ tags: ["", 5, "x"], repoName: "r" }).filter.value).toEqual(["x", "r", "project:r"]);
  });
  test("Codex-Mischsession: nur Sessions, deren Zeilen alle Codex sind, fallen heraus, unabhängig von der Reihenfolge", () => {
    const p = W.erfassungsprobe({
      sessionsW: [{ sessionId: "a", traceName: "Claude Code Turn" }, { sessionId: "a", traceName: "Codex: x" }, { sessionId: "b", traceName: "Codex: x" }, { sessionId: "b", traceName: "Claude Code Turn" }, { sessionId: "c", traceName: "Codex: x" }],
      sessionsV: [],
      scores: [],
    });
    expect(p).toMatchObject({ n: 2 });
  });
});

describe("Verdrahtung und Guards (Runde 2)", () => {
  test("kennzahlen: Anteil unzugeordnet und Δ sind echte Quotienten", () => {
    const k = E.kennzahlen({ bereinigt: { cost: 20, count: 3 }, unzugeordnet: { cost: 5 } }, { bereinigt: { cost: 10, count: 2 } });
    expect(k).toMatchObject({ unzugeordnetProzent: 25, deltaProzent: 100 });
  });
  test("Score-Namensfilter verlangt die Spalte name", async () => {
    const c = satz();
    c["scores.json"] = { ...(c["scores.json"] as Wb), abfrage: { filters: [{ ...SCORE_FILTER, column: "traceName" }], fromTimestamp: F.vorVon, toTimestamp: F.bis } };
    await fehler(c, "Filter name any of [erfassung, erfassung_hook] fehlt");
  });
  test("--rolle gelangt im Live-Weg in die Rezepte", async () => {
    let rezepte: Rez[] = [];
    const ladeLive = () => Promise.resolve({ ladeLiveExporte: (o: { rezepte: Rez[] }) => { rezepte = o.rezepte; return Promise.resolve({ status: "unerreichbar", grund: "x" }); } });
    const r = await auswerten(parseArgs(["--rolle", "sonderrolle"]), { jetzt: JETZT, projekt: PROJEKT, ladeLive });
    expect(r.exitCode).toBe(4);
    const werte = rezepte.filter((x) => x.art === "metadaten").flatMap((x) => x.abfrage.filters.map((y) => (y as { value?: string }).value));
    expect(werte).toContain("sonderrolle");
  });
  test("kein Bericht (Exit 4): grund in Ausgabe und stderr ohne Key-Muster", async () => {
    const ladeLive = () => Promise.resolve({ ladeLiveExporte: () => Promise.resolve({ status: "unerreichbar", grund: "401 sk-lf-geheim123 pk-lf-oeffentlich" }) });
    const r = await auswerten(parseArgs([]), { jetzt: JETZT, projekt: PROJEKT, ladeLive });
    expect(r.exitCode).toBe(4);
    expect(r.stdout + r.stderr).not.toMatch(/sk-lf-geheim123|pk-lf-oeffentlich/);
    expect(r.stderr).toContain("[geschwärzt]");
  });
  test("Ruhefrist an der Aufrufstelle: um 00:40Z Montag gilt schon die gerade beendete Woche", async () => {
    const r = await lauf([], satz(), { jetzt: new Date("2026-11-09T00:40:00Z") });
    expect(r.stdout).toContain("# Langfuse-Wochenbericht 2026-11-02");
  });
});

describe("Datenlücken des Wochenberichts (Abnahme-Fix)", () => {
  test("Zeilen ohne Rolle oder Modell und fehlende Tage stehen unter Datenlücken, auch im JSON", async () => {
    const r = await lauf([], satz({ luecke: true }));
    expect(r.stdout).toMatch(/^### Datenlücken$[\s\S]*^- Tage ohne Daten: 2026-11-05$[\s\S]*^- Zeilen ohne Rolle oder Modell: 16 Calls \(20\.00 \$\)$/m);
    const j = lese<{ datenluecken: string[] }>((await lauf(["--json"], satz({ luecke: true }))).stdout);
    expect(j.datenluecken).toContain("Zeilen ohne Rolle oder Modell: 16 Calls (20.00 $)");
    expect(j.datenluecken).toContain("Tage ohne Daten: 2026-11-05");
  });
  test("ohne Zeilen ohne Rolle oder Modell steht keine solche Zeile", async () => {
    const s = satz();
    const zeilen = gesamtW().map((z) => ({ ...z, min_latency: 1 }));
    s["metaW.json"] = exp("metadaten", F.von, F.bis, zeilen, [TYPE, PF, { column: "metadata", key: "agent_type", operator: "=", value: "Plan", type: "stringObject" }]);
    const r = await lauf([], s);
    expect(r.stderr).toBe("");
    expect(r.stdout).not.toContain("Zeilen ohne Rolle oder Modell");
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

describe("Kosten je Merge (factory#324)", () => {
  const SCHWELLEN_KOSTEN = { ...SCHWELLEN, unzugeordnetProzent: 100 };
  const bw = (cost: number, count = 5) => ({ bereinigt: { cost, count }, unzugeordnet: { cost: 0, count: 0 } });
  test("mergeSucheArgs: Fenster der Woche von Montag 00:00:00 bis Sonntag 23:59:59, Repo und per_page", () => {
    const args = E.mergeSucheArgs({ owner: "own", repo: "repo", von: F.von, bis: F.bis });
    expect(args).toEqual(["api", "-X", "GET", "search/issues", "-f", "q=repo:own/repo is:pr is:merged merged:2026-11-02T00:00:00+00:00..2026-11-08T23:59:59+00:00", "-f", "per_page=1"]);
  });
  test("mergeAnzahl: gültige Antwort zählt, alles andere wirft", () => {
    expect(E.mergeAnzahl('{"total_count":56,"incomplete_results":false}')).toBe(56);
    expect(E.mergeAnzahl('{"total_count":0,"incomplete_results":false}')).toBe(0);
    const falsch: Array<[string, RegExp]> = [
      ["kein json", /kein JSON/],
      ["null", /unvollständig/],
      ['{"total_count":5,"incomplete_results":true}', /unvollständig/],
      ['{"total_count":5}', /unvollständig/],
      ['{"incomplete_results":false}', /total_count/],
      ['{"total_count":-1,"incomplete_results":false}', /total_count/],
      ['{"total_count":"5","incomplete_results":false}', /total_count/],
      ['{"total_count":1.5,"incomplete_results":false}', /total_count/],
    ];
    for (const [t, muster] of falsch) expect(() => E.mergeAnzahl(t), t).toThrow(muster);
  });
  test("Beleg-Woche 2026-11-02: Summe +152,5 %, je Merge -9,8 %, kein Agent-Lauf", () => {
    const k = E.kennzahlen(bw(995.23), bw(394.21), { woche: 56, vorwoche: 20 });
    expect(k.deltaProzent).toBeCloseTo(152.5, 1);
    expect(k.deltaJeMergeProzent).toBeCloseTo(-9.8, 1);
    expect(k.jeMerge).toBeCloseTo(17.77, 2);
    expect(k.jeMergeVorwoche).toBeCloseTo(19.71, 2);
    const u = W.urteil({ erfassungLueckenMax: 0, kostenAnstiegProzent: 50, unzugeordnetProzent: 90 }, { erfassungLueckenMax: 0, kostenAnstiegProzent: k.deltaJeMergeProzent, unzugeordnetProzent: 0 });
    expect(u.agentLaufNoetig).toBe(false);
  });
  test("Beleg-Woche über auswerten: Summe weit über 50 %, je Merge darunter ergibt Exit 0 (Red-Green: Urteil auf die Summe zurückdrehen macht rot)", async () => {
    const r = await lauf(["--json"], satz({ kostenW: 995.23, kostenV: 394.21 }), { gh: ghMerges(56, 20), projekt: { ...PROJEKT, schwellen: SCHWELLEN_KOSTEN } });
    expect(r.exitCode).toBe(0);
    expect(lese<{ summe: { deltaProzent: number } }>(r.stdout).summe.deltaProzent).toBeGreaterThan(150);
  });
  test("strenger: Kosten flach, Merges halbiert, je Merge +100 %: Lauf nötig (Ende zu Ende über auswerten)", async () => {
    const k = E.kennzahlen(bw(20), bw(20), { woche: 5, vorwoche: 10 });
    expect(k.deltaJeMergeProzent).toBeCloseTo(100, 5);
    const r = await lauf(["--json"], satz({ kostenW: 20, kostenV: 20 }), { gh: ghMerges(5, 10), projekt: { ...PROJEKT, schwellen: SCHWELLEN_KOSTEN } });
    expect(r.exitCode).toBe(3);
    expect(lese<{ urteil: { gruende: Array<{ schwelle: string }> } }>(r.stdout).urteil.gruende.map((x) => x.schwelle)).toEqual(["kostenAnstiegProzent"]);
  });
  test("0 Merges in der Woche bei Kosten: Nenner 1 löst aus; beide Wochen 0: Rückfall auf Summen-Δ; Merges null: nicht bewertbar", () => {
    expect(E.kennzahlen(bw(20), bw(20), { woche: 0, vorwoche: 10 }).deltaJeMergeProzent).toBeCloseTo(900, 5);
    expect(E.kennzahlen(bw(20), bw(20), { woche: 10, vorwoche: 0 }).deltaJeMergeProzent).toBeCloseTo(-90, 5);
    expect(E.kennzahlen(bw(30), bw(20), { woche: 0, vorwoche: 0 }).deltaJeMergeProzent).toBeCloseTo(50, 5);
    const ohne = E.kennzahlen(bw(30), bw(20));
    expect(ohne).toMatchObject({ deltaJeMergeProzent: null, jeMerge: null, merges: null, deltaProzent: 50 });
    expect(E.kennzahlen(bw(30), bw(0, 0), { woche: 3, vorwoche: 3 }).deltaJeMergeProzent).toBeNull();
    expect(E.kennzahlen(bw(30), bw(0, 4), { woche: 3, vorwoche: 3 }).deltaJeMergeProzent).toBeNull();
    expect(E.kennzahlen(bw(30), bw(5, 0), { woche: 3, vorwoche: 3 }).deltaProzent).toBeNull();
    expect(E.kennzahlen(bw(30), bw(5, 0), { woche: 3, vorwoche: 3 }).deltaJeMergeProzent).toBeNull();
  });
  test("ohne Merges: Urteil meldet kostenAnstiegProzent nicht bewertbar", () => {
    const lib = libRaw as unknown as { wochenAuswertung: (g: unknown, o: Record<string, unknown>) => { urteil: Urteil } };
    const geordnet = ordneSatz(satz());
    const a = lib.wochenAuswertung(geordnet, { schwellen: SCHWELLEN });
    expect(a.urteil.hinweise).toContain("kostenAnstiegProzent: nicht bewertbar");
  });
  test("manueller Aufruf ohne deps.gh nimmt das echte gh, eine injizierte Naht gewinnt (Red-Green: `?? ghEcht` entfernen macht rot)", () => {
    const k = cliRaw as unknown as { ghDer: (d: Record<string, unknown>) => unknown; ghEcht: unknown };
    const stub = () => "";
    expect(k.ghDer({})).toBe(k.ghEcht);
    expect(typeof k.ghEcht).toBe("function");
    expect(k.ghDer({ gh: stub })).toBe(stub);
  });
  test("auswerten ohne deps.gh (manueller Aufruf) ruft das echte gh mit den Such-Argumenten beider Wochen (Red-Green: Aufrufstelle auf deps.gh umstellen macht rot)", async () => {
    ghMockAufrufe.length = 0;
    const r = await lauf(["--json"], satz(), { gh: undefined });
    expect(r.exitCode).toBe(0);
    expect(ghMockAufrufe.map((a) => a.find((x) => x.startsWith("q=")))).toEqual([
      "q=repo:own/repo is:pr is:merged merged:2026-11-02T00:00:00+00:00..2026-11-08T23:59:59+00:00",
      "q=repo:own/repo is:pr is:merged merged:2026-10-26T00:00:00+00:00..2026-11-01T23:59:59+00:00",
    ]);
    expect(lese<{ summe: { merges: unknown } }>(r.stdout).summe.merges).toEqual({ woche: 7, vorwoche: 7 });
  });
  test("Markdown: ohne Merges und bei Vorwoche ohne Kosten steht der Grund in der Zeile Kosten je Merge", async () => {
    const lib = libRaw as unknown as { wochenAuswertung: (g: unknown, o: Record<string, unknown>) => unknown; renderWochenbericht: (m: string, f: unknown, a: unknown) => string };
    const ohne = lib.renderWochenbericht(MONTAG, PF, lib.wochenAuswertung(ordneSatz(satz()), { schwellen: SCHWELLEN }));
    expect(ohne).toContain("Gemergte PRs: nicht ermittelt, Kosten je Merge nicht bewertbar.");
    const ohneKosten = (await lauf([], satz({ kostenV: 0 }))).stdout;
    expect(ohneKosten).toMatch(/^Gemergte PRs:.*Δ – \(Vorwoche ohne Kosten, nicht bewertbar\)/m);
    expect(ohneKosten).toContain("Gemergte PRs: Woche 10, Vorwoche 10;");
  });
  test("auswerten: Markdown trägt die Zeile Kosten je Merge, JSON summe.merges; gh-Aufrufe für Woche und Vorwoche", async () => {
    const aufrufe: string[][] = [];
    const gh = (a: string[]) => { aufrufe.push(a); return ghMerges(10, 8)(a); };
    const md = await lauf([], satz(), { gh });
    expect(md.stdout).toContain("Gemergte PRs: Woche 10, Vorwoche 8; Kosten je Merge 2.00 $ (Vorwoche 2.50 $), Δ -20.0 %");
    expect(aufrufe).toHaveLength(2);
    expect(aufrufe[0].join(" ")).toContain("repo:own/repo");
    const js = lese<{ summe: { merges: { woche: number; vorwoche: number } } }>((await lauf(["--json"], satz(), { gh: ghMerges(10, 8) })).stdout);
    expect(js.summe.merges).toEqual({ woche: 10, vorwoche: 8 });
  });
  test("gh wirft oder liefert incomplete: Exit 1, mit --ablegen keine .md", async () => {
    for (const gh of [() => { throw new Error("gh kaputt"); }, () => '{"total_count":3,"incomplete_results":true}']) {
      const home = tmp();
      const r = await lauf(["--ablegen"], satz(), { gh, home });
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toMatch(/gh kaputt|Merges nicht ermittelbar/);
      expect(existsSync(join(home, ".claude", "state", "langfuse-wochenbericht", "own__repo", `${MONTAG}.md`))).toBe(false);
    }
  });
});
