/* Tokens je Abo-Prozentpunkt (factory#290): Fenster mit Reset, ohne Zuwachs, fehlende Transkripte und Snapshots, mehrere Modelle, Spanne,
 * Monotonie, Wochenverteilung, gleiche Summe wie token-baseline (keine zweite Zählung) und kein Langfuse-Schlüssel in der Import-Kette.
 * Grenze des Import-Scans: nur statische `import … from "./x.mjs"`-Zeilen, dynamische Imports sind nicht abgedeckt. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/tokens-je-prozentpunkt-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBase from "../scripts/token-baseline.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTr from "../scripts/transkript.mjs";

type Call = { t: number; model: string; input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number; cost: number | null };
type Kennzahl = {
  schluessel: string; luecke?: string; unklar?: boolean; tokens: number; zuwachs: number; k: number; ohneCallsPp: number;
  jePp: number; hundert: number; spanne: number[]; gewichtet: { jePp?: number; hundert?: number; luecke?: string };
  tage: { roh: { n: number; median: number; q1: number; q3: number } };
};
type Limit = {
  luecke?: string; tage: Kennzahl[]; wochen: Kennzahl[]; gesamt: Kennzahl; tabelle: Record<string, number | string>[];
  ausgelassen: { reset: number; veraltet: number; ohneCallsN: number; ohneCallsPp: number; callsOhneVerlauf: number };
};
const L = raw as unknown as {
  tokensJeProzentpunkt: (a: { verlaufText: string; calls: Call[]; von: number; bis: number }) => { kaputt: number; limits: { sevenDay: Limit; fiveHour: Limit } };
  tokensJeProzentpunktAbschnitt: (t: unknown) => string[];
  strecken: (p: unknown[], l: string, f: { von: number; bis: number }) => { liste: { delta: number }[]; veraltet: number };
  callsAus: (s: unknown[]) => { calls: Call[]; sitzungen: number; ohneZeit: number };
  isoWoche: (ms: number) => string;
};

const H = 3_600_000;
const D = 24 * H;
const T0 = Date.UTC(2026, 10, 2); // Montag, ISO-Woche 2026-W45
const RESET = (T0 + 7 * D) / 1000;
const p = (stand: number, pct: number, resetsAt = RESET, limit = "sevenDay") => JSON.stringify({ stand, [limit]: { pct, resetsAt } });
const c = (t: number, o: Partial<Call> = {}): Call => ({ t, model: "m", input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, cost: 0, ...o });
const lauf = (verlauf: string[], calls: Call[], bis = T0 + 10 * D) => L.tokensJeProzentpunkt({ verlaufText: verlauf.join("\n"), calls, von: T0, bis });
const sieben = (verlauf: string[], calls: Call[]) => lauf(verlauf, calls).limits.sevenDay;

describe("Reset und Ketten", () => {
  test("Abschnitt über den Reset ist ausgelassen, seine Calls zählen nicht; zwei Ketten (k = 2)", () => {
    const r1 = (T0 + 150 * 60_000) / 1000;
    const r = sieben(
      [p(T0 + H, 10, r1), p(T0 + 2 * H, 20, r1), p(T0 + 3 * H, 2), p(T0 + 4 * H, 12)],
      [c(T0 + 90 * 60_000, { input: 1000 }), c(T0 + 150 * 60_000, { input: 777_777 }), c(T0 + 210 * 60_000, { input: 1000 })],
    );
    expect(r.gesamt).toMatchObject({ tokens: 2000, zuwachs: 20, k: 2, jePp: 100 });
    expect(r.ausgelassen).toMatchObject({ reset: 1, callsOhneVerlauf: 1 });
  });
});

describe("Zuwachs und Schwelle", () => {
  test.each([
    [0, true],
    [4, true],
    [5, false],
  ])("Zuwachs %i pp bei k = 1: unklar = %s, nie 0 oder unendlich", (delta, unklar) => {
    const g = sieben([p(T0 + H, 50), p(T0 + 2 * H, 50 + delta)], [c(T0 + 90 * 60_000, { input: 1000 })]).gesamt;
    expect(g.unklar ?? false).toBe(unklar);
    expect(g.tokens).toBe(1000);
    if (unklar) expect(g).not.toHaveProperty("jePp");
    else expect(g.jePp).toBe(200);
  });

  test("Spanne: 1 Mio Tokens bei 10 pp und k = 1", () => {
    const g = sieben([p(T0 + H, 0), p(T0 + 2 * H, 10)], [c(T0 + 90 * 60_000, { input: 1_000_000 })]).gesamt;
    expect(g.jePp).toBe(100_000);
    expect(g.hundert).toBe(10_000_000);
    expect(g.spanne[0]).toBeCloseTo(9_090_909, 0);
    expect(g.spanne[1]).toBeCloseTo(11_111_111, 0);
  });

  test("Monotonie: ein veralteter Punkt (58, 57, 59) zählt nicht doppelt; Abschnitte über bis hinaus entfallen", () => {
    const r = sieben([p(T0 + H, 58), p(T0 + 2 * H, 57), p(T0 + 3 * H, 59)], [c(T0 + 150 * 60_000, { input: 1000 })]);
    expect(r.gesamt.zuwachs).toBe(1);
    expect(r.ausgelassen.veraltet).toBe(1);
    const punkte = [1, 2, 3].map((i) => ({ stand: T0 + i * H, sevenDay: { pct: 10 * i, resetsAt: RESET } }));
    expect(L.strecken(punkte, "sevenDay", { von: T0, bis: T0 + 150 * 60_000 }).liste).toHaveLength(1);
  });
});

describe("Datenlücken", () => {
  test("fehlende Transkripte: Tag 2 ist eine Lücke mit Grund, Tag 1 behält seinen Wert", () => {
    const r = sieben(
      [p(T0 + H, 10), p(T0 + 2 * H, 20), p(T0 + D + H, 30), p(T0 + D + 2 * H, 40)],
      [c(T0 + 90 * 60_000, { input: 2000 })],
    );
    expect(r.tage[0].jePp).toBe(200);
    expect(r.tage[1].luecke).toMatch(/Zuwachs ohne Calls \(20 pp\)/);
    expect(r.tage[1]).not.toHaveProperty("jePp");
  });

  test("ein Abschnitt mit Zuwachs und ohne Calls in einem gültigen Tag wird ausgelassen, sein Zuwachs steht nicht im Tageswert", () => {
    const r = sieben([p(T0 + H, 10), p(T0 + 2 * H, 20), p(T0 + 3 * H, 30)], [c(T0 + 90 * 60_000, { input: 1000 })]);
    expect(r.tage[0]).toMatchObject({ tokens: 1000, zuwachs: 10, jePp: 100, ohneCallsPp: 10 });
    expect(r.ausgelassen).toMatchObject({ ohneCallsN: 1, ohneCallsPp: 10 });
  });

  test("fehlende Snapshots: Calls an einem Tag ohne Punkte sind eine Lücke mit Zahl; nur fiveHour-Punkte lassen das 7-Tage-Limit zur Lücke werden", () => {
    const r = sieben([p(T0 + H, 10), p(T0 + 2 * H, 20)], [c(T0 + 90 * 60_000, { input: 1000 }), c(T0 + 2 * D + H, { input: 5 })]);
    expect(r.tage.map((t) => t.schluessel)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(r.tage[1].luecke).toMatch(/keine Kontingent-Punkte \(1 Calls ohne Verlauf\)/);
    const f = lauf([p(T0 + H, 10, RESET, "fiveHour"), p(T0 + 2 * H, 20, RESET, "fiveHour")], [c(T0 + 90 * 60_000, { input: 1000 })]).limits;
    expect(f.sevenDay.luecke).toMatch(/weniger als 2 Verlaufspunkte/);
    expect(f.fiveHour.gesamt.jePp).toBe(100);
  });

  test("keine Calls im Zeitraum (Zuwachs 0, Tokens 0): Lücke statt Wert", () => {
    expect(sieben([p(T0 + H, 10), p(T0 + 2 * H, 10)], []).gesamt.luecke).toMatch(/keine Calls im Zeitraum/);
  });
});

describe("Summen und Gewichte", () => {
  const verlauf = [p(T0 + H, 0), p(T0 + 2 * H, 10)];
  const a = { model: "A", input: 100, output: 50, cacheRead: 1000, cacheWrite5m: 200, cacheWrite1h: 300, cost: 0.5 };
  const b = { model: "B", input: 10, output: 5, cacheRead: 100, cacheWrite5m: 20, cacheWrite1h: 30, cost: 0.25 };

  test("mehrere Modelle im selben Fenster: Summen je Modell und Art, roh = Summe aller, gewichtet = Summe der Preise", () => {
    const r = sieben(verlauf, [c(T0 + 90 * 60_000, a), c(T0 + 100 * 60_000, b)]);
    expect(r.tabelle).toEqual([
      { modell: "A", input: 100, output: 50, cacheRead: 1000, cacheWrite5m: 200, cacheWrite1h: 300 },
      { modell: "B", input: 10, output: 5, cacheRead: 100, cacheWrite5m: 20, cacheWrite1h: 30 },
    ]);
    expect(r.gesamt.tokens).toBe(1815);
    expect(r.gesamt.gewichtet).toEqual({ jePp: 0.075, hundert: 7.5 });
  });

  test("ein Modell ohne Preis macht nur die gewichtete Variante zur Lücke, roh bleibt", () => {
    const g = sieben(verlauf, [c(T0 + 90 * 60_000, a), c(T0 + 100 * 60_000, { ...b, model: "C", cost: null })]).gesamt;
    expect(g.gewichtet.luecke).toBe("kein Preis für C");
    expect(g.jePp).toBe(181.5);
  });
});

describe("Woche und ISO-Woche", () => {
  test("Median und Quartile aus vier Tageswerten", () => {
    const pts: string[] = [];
    const calls: Call[] = [];
    [100_000, 200_000, 300_000, 400_000].forEach((tokens, i) => {
      pts.push(p(T0 + i * D + H, 10 * i), p(T0 + i * D + 2 * H, 10 * i + 10));
      calls.push(c(T0 + i * D + 90 * 60_000, { input: tokens }));
    });
    const w = sieben(pts, calls).wochen;
    expect(w).toHaveLength(1);
    expect(w[0].schluessel).toBe("2026-W45");
    expect(w[0].tage.roh).toEqual({ n: 4, median: 25_000, q1: 17_500, q3: 32_500 });
  });

  test.each([
    [Date.UTC(2026, 10, 1), "2026-W44"],
    [Date.UTC(2026, 10, 2), "2026-W45"],
    [Date.UTC(2026, 11, 31), "2026-W53"],
    [Date.UTC(2027, 0, 1), "2026-W53"],
    [Date.UTC(2027, 0, 4), "2027-W01"],
  ])("isoWoche(%i) = %s", (ms, woche) => expect(L.isoWoche(ms)).toBe(woche));
});

describe("Abschnitt", () => {
  test("Lücken, nicht aussagekräftig und Kennzahl erscheinen als Text, gewichtete Werte mit Schätzungs-Hinweis; Lücke des Ganzen", () => {
    const t = lauf([p(T0 + H, 0), p(T0 + 2 * H, 10), p(T0 + D + H, 10)], [c(T0 + 90 * 60_000, { input: 1_000_000, cost: 1 })]);
    const text = L.tokensJeProzentpunktAbschnitt(t).join("\n");
    expect(text).toContain("7-Tage-Limit");
    expect(text).toContain("100 Tsd je pp");
    expect(text).toContain("Schätzung, Listenpreis-Gewichte, ungesichert");
    expect(text).toContain("5-Stunden-Limit:** Lücke");
    expect(L.tokensJeProzentpunktAbschnitt({ luecke: "kein Verlauf" })).toEqual(["- Lücke: kein Verlauf"]);
  });
});

describe("keine zweite Token-Zählung (AK1)", () => {
  const zeile = (id: string, ts: string, model: string, out: number) =>
    JSON.stringify({ type: "assistant", timestamp: ts, uuid: `${id}-${out}`, message: { id, role: "assistant", model, usage: { input_tokens: 7, cache_read_input_tokens: 11, cache_creation_input_tokens: 13, output_tokens: out }, content: [{ type: "text", text: "x" }] } });

  test("dieselbe Session ergibt dieselben Summen wie token-baseline (Dublette in Haupt- und Subagent-Datei, zwei Modelle)", () => {
    const root = fixture({
      "p/s1.jsonl": [zeile("m1", "2026-11-02T10:00:00Z", "claude-opus-5-5", 3), zeile("m1", "2026-11-02T10:00:01Z", "claude-opus-5-5", 9), zeile("m2", "2026-11-02T10:01:00Z", "claude-opus-5-5", 4)].join("\n"),
      "p/s1/subagents/agent-1.jsonl": [zeile("m2", "2026-11-02T10:01:00Z", "claude-opus-5-5", 20), zeile("s1", "2026-11-02T10:02:00Z", "claude-sonnet-5-5", 6)].join("\n"),
    });
    const sitzungen = [...(rawTr as { ladeSessions: (d: string) => Iterable<unknown> }).ladeSessions(join(root, "p"))];
    const lib = L.callsAus(sitzungen);
    const B = rawBase as { summarize: (r: unknown) => { total: Record<string, number> }; readTranscriptSession: (i: string, r: string) => { calls: unknown[] } };
    const basis = B.summarize({ calls: B.readTranscriptSession("s1", root).calls }).total;
    const sum = (k: keyof Call) => lib.calls.reduce((s, x) => s + (x[k] as number), 0);
    expect(lib.calls).toHaveLength(3);
    expect({ input: sum("input"), cacheWrite: sum("cacheWrite5m") + sum("cacheWrite1h"), cacheRead: sum("cacheRead"), output: sum("output") }).toEqual({
      input: basis.input, cacheWrite: basis.cacheWrite, cacheRead: basis.cacheRead, output: basis.output,
    });
  });
});

describe("kein Langfuse-Schlüssel in der Import-Kette (AK8)", () => {
  test("die statische Import-Kette der Lib erreicht weder langfuse-api noch token-baseline noch langfuse-nachliefern", () => {
    const gesehen = new Set<string>();
    const pruefe = (datei: string) => {
      if (gesehen.has(datei)) return;
      gesehen.add(datei);
      const src = readFileSync(new URL(`../scripts/${datei}`, import.meta.url), "utf8");
      for (const m of src.matchAll(/from "\.\/([\w-]+\.mjs)"/g)) pruefe(m[1]);
    };
    pruefe("tokens-je-prozentpunkt-lib.mjs");
    expect(gesehen.size).toBeGreaterThan(3);
    for (const verboten of ["langfuse-api.mjs", "token-baseline.mjs", "langfuse-nachliefern.mjs"]) expect(gesehen.has(verboten)).toBe(false);
  });
});
