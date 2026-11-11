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
  luecke?: string; streuung: { roh: { n: number }; gewichtet: { n: number }; iqrRoh: number | null; iqrGewichtet: number | null }; tage: Kennzahl[]; wochen: Kennzahl[]; gesamt: Kennzahl; tabelle: Record<string, number | string>[];
  ausgelassen: { reset: number; veraltet: number; ohneCallsN: number; ohneCallsPp: number; callsOhneVerlauf: number };
};
const L = raw as unknown as {
  tokensJeProzentpunkt: (a: { verlaufText: string; calls: Call[]; von: number; bis: number }) => { kaputt: number; limits: { sevenDay: Limit; fiveHour: Limit } };
  tokensJeProzentpunktAbschnitt: (t: unknown) => string[];
  strecken: (p: unknown[], l: string, f: { von: number; bis: number }) => { liste: { delta: number }[]; veraltet: number; reset: number };
  callsAus: (s: unknown[]) => { calls: Call[]; sitzungen: number; ohneZeit: number };
  isoWoche: (ms: number) => string;
  usd: (x: number) => string;
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
    expect(r.gesamt.spanne[0]).toBeCloseTo(200_000 / 22, 6);
    expect(r.gesamt.spanne[1]).toBeCloseTo(200_000 / 18, 6);
    expect(r.ausgelassen).toMatchObject({ reset: 1, callsOhneVerlauf: 1 });
  });

  test("zwei Ketten zu je 4 pp: die Schwelle wächst mit k (8 pp < 5 · 2), also nicht aussagekräftig", () => {
    const r1 = (T0 + 150 * 60_000) / 1000;
    const g = sieben(
      [p(T0 + H, 10, r1), p(T0 + 2 * H, 14, r1), p(T0 + 3 * H, 2), p(T0 + 4 * H, 6)],
      [c(T0 + 90 * 60_000, { input: 1000 }), c(T0 + 210 * 60_000, { input: 1000 })],
    ).gesamt;
    expect(g).toMatchObject({ zuwachs: 8, k: 2, unklar: true });
    expect(g.jePp).toBeUndefined();
  });

  test("Reset genau beim Stand des nächsten Punkts ist ein Reset (Grenze), ohne Abschnitt: Lücke ohne Calls-Hinweis", () => {
    const r = sieben([p(T0 + H, 10, (T0 + 2 * H) / 1000), p(T0 + 2 * H, 15)], []);
    expect(r.ausgelassen.reset).toBe(1);
    expect(r.gesamt.luecke).toBe("keine Kontingent-Punkte");
  });

  test("veraltete Nachzügler: ein Punkt aus dem alten Fenster nach dem Reset und einer mit resetsAt genau beim Stand zählen nicht", () => {
    const r1 = (T0 + 150 * 60_000) / 1000;
    const nachReset = [
      { stand: T0 + H, sevenDay: { pct: 70, resetsAt: r1 } },
      { stand: T0 + 3 * H, sevenDay: { pct: 2, resetsAt: RESET } },
      { stand: T0 + 4 * H, sevenDay: { pct: 80, resetsAt: r1 } },
      { stand: T0 + 5 * H, sevenDay: { pct: 4, resetsAt: RESET } },
    ];
    const s = L.strecken(nachReset, "sevenDay", { von: T0, bis: T0 + D });
    expect(s).toMatchObject({ reset: 1, veraltet: 1 });
    expect(s.liste.map((x) => x.delta)).toEqual([2]);
    const genau = [
      { stand: T0 + H, sevenDay: { pct: 10, resetsAt: (T0 + 2 * H) / 1000 } },
      { stand: T0 + 2 * H, sevenDay: { pct: 20, resetsAt: (T0 + 2 * H) / 1000 } },
    ];
    expect(L.strecken(genau, "sevenDay", { von: T0, bis: T0 + D })).toMatchObject({ veraltet: 1, reset: 0, liste: [] });
    const frueherer = [
      { stand: T0 + H, sevenDay: { pct: 10, resetsAt: RESET } },
      { stand: T0 + 2 * H, sevenDay: { pct: 20, resetsAt: (T0 + 5 * D) / 1000 } },
    ];
    expect(L.strecken(frueherer, "sevenDay", { von: T0, bis: T0 + D })).toMatchObject({ veraltet: 1, liste: [] });
    const eineSekunde = [frueherer[0], { stand: T0 + 2 * H, sevenDay: { pct: 20, resetsAt: RESET - 1 } }];
    expect(L.strecken(eineSekunde, "sevenDay", { von: T0, bis: T0 + D })).toMatchObject({ veraltet: 1, liste: [] });
  });
});

describe("strecken: veraltet nur im Bereich", () => {
  test("ein veralteter Punkt vor von zählt nicht mit, der Vorpunkt vor von bestimmt die Folge, punkte zählt alle Punkte im Bereich", () => {
    const pk = [
      { stand: T0, sevenDay: { pct: 50, resetsAt: RESET } },
      { stand: T0 + H, sevenDay: { pct: 40, resetsAt: RESET } },
      { stand: T0 + 3 * H, sevenDay: { pct: 45, resetsAt: RESET } },
      { stand: T0 + 4 * H, sevenDay: { pct: 44, resetsAt: RESET } },
      { stand: T0 + 5 * H, sevenDay: { pct: 52, resetsAt: RESET } },
      { stand: T0 + 6 * H, sevenDay: { pct: 53, resetsAt: RESET } },
    ];
    const s = L.strecken(pk, "sevenDay", { von: T0 + 2 * H, bis: T0 + D });
    expect(s).toMatchObject({ punkte: 4, veraltet: 2, reset: 0 });
    expect(s.liste.map((x) => x.delta)).toEqual([1]); // 45 und 44 sind veraltet (< 50, der Vorpunkt vor von), 40 vor von zählt nicht mit
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
    expect(g.jePp).toBe(unklar ? undefined : 200);
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
    expect(L.strecken(punkte, "sevenDay", { von: T0 + 90 * 60_000, bis: T0 + 10 * D }).liste).toHaveLength(1);
  });

  test("ein Call genau am Anfangspunkt gehört zum Vorgänger, einer genau am Endpunkt zum Abschnitt", () => {
    const g = sieben([p(T0 + H, 0), p(T0 + 2 * H, 10)], [c(T0 + H, { input: 1_000_000 }), c(T0 + 2 * H, { input: 1000 })]).gesamt;
    expect(g.tokens).toBe(1000);
  });

  test("Läufe: ein Abschnitt ohne Calls zwischen zwei gezählten trennt sie (k = 2)", () => {
    const g = sieben([p(T0 + H, 0), p(T0 + 2 * H, 10), p(T0 + 3 * H, 20), p(T0 + 4 * H, 30)], [c(T0 + 90 * 60_000, { input: 1000 }), c(T0 + 210 * 60_000, { input: 1000 })]).gesamt;
    expect(g).toMatchObject({ tokens: 2000, zuwachs: 20, k: 2, ohneCallsPp: 10 });
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
    expect(r.tage[1].luecke).toBe("keine Kontingent-Punkte (1 Calls ohne Verlauf)");
    const f = lauf([p(T0 + H, 10, RESET, "fiveHour"), p(T0 + 2 * H, 20, RESET, "fiveHour")], [c(T0 + 90 * 60_000, { input: 1000 })]).limits;
    expect(f.sevenDay.luecke).toMatch(/weniger als 2 Verlaufspunkte/);
    expect(lauf([p(T0 + H, 10)], []).limits.sevenDay.luecke).toBe("weniger als 2 Verlaufspunkte für dieses Limit im Zeitraum (1; 0 Calls ohne Verlauf)");
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
    const s = sieben(verlauf, [c(T0 + 90 * 60_000, a), c(T0 + 100 * 60_000, { ...b, model: "C", cost: null })]).streuung;
    expect([s.roh.n, s.gewichtet.n]).toEqual([1, 0]);
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
    // ein fünfter Tag mit 1 pp ist nicht aussagekräftig und bleibt aus der Verteilung
    pts.push(p(T0 + 4 * D + H, 40), p(T0 + 4 * D + 2 * H, 41));
    calls.push(c(T0 + 4 * D + 90 * 60_000, { input: 5000 }));
    expect(sieben(pts, calls).wochen[0].tage.roh.n).toBe(4);
  });

  test.each([
    [Date.UTC(2026, 10, 1), "2026-W44"],
    [Date.UTC(2026, 10, 2), "2026-W45"],
    [Date.UTC(2026, 11, 31), "2026-W53"],
    [Date.UTC(2027, 0, 1), "2026-W53"],
    [Date.UTC(2027, 0, 4), "2027-W01"],
  ])("isoWoche(%i) = %s", (ms, woche) => expect(L.isoWoche(ms)).toBe(woche));
});

describe("Zeitraum, Sortierung, Streuung und Wochen", () => {
  const RF = (T0 + 60 * D) / 1000;
  const tag = (i: number, tokens: number, cost = 0) => ({
    pts: [p(T0 + i * D + H, 10 * i, RF), p(T0 + i * D + 2 * H, 10 * i + 10, RF)],
    call: c(T0 + i * D + 90 * 60_000, { input: tokens, cost }),
  });
  const aus = (ts: ReturnType<typeof tag>[], extra: Call[] = []) => lauf(ts.flatMap((x) => x.pts), [...ts.map((x) => x.call), ...extra], T0 + 30 * D).limits.sevenDay;
  const vier = (kosten: number) => [100_000, 200_000, 300_000, 400_000].map((t, i) => tag(i, t, t / kosten));

  test("Calls vor von und nach bis zählen nicht, Calls genau auf den Grenzen schon", () => {
    const bis = T0 + 3 * D;
    const r = lauf([p(T0 + H, 0, RF), p(T0 + 2 * H, 10, RF)], [c(T0 - 1), c(T0), c(T0 + 90 * 60_000, { input: 1000 }), c(bis), c(bis + 1)], bis).limits.sevenDay;
    expect(r.ausgelassen.callsOhneVerlauf).toBe(2);
    expect(r.tage.map((t) => t.schluessel)).toEqual(["2026-11-02", "2026-11-05"]);
  });

  test("Verlaufspunkte genau auf von und bis zählen mit", () => {
    const bis = T0 + D;
    const g = lauf([p(T0, 0, RF), p(T0 + H, 10, RF), p(bis, 20, RF)], [c(T0 + 30 * 60_000, { input: 1000 }), c(T0 + 2 * H, { input: 1000 })], bis).limits.sevenDay.gesamt;
    expect(g).toMatchObject({ tokens: 2000, zuwachs: 20 });
  });

  test("callsAus sortiert nach Zeit, auch wenn die Sitzungen in umgekehrter Reihenfolge kommen", () => {
    const ev = (ts: string) => ({ type: "assistant", timestamp: ts, uuid: ts, message: { id: ts, role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "x" }] } });
    const spaet = "2026-11-02T12:00:00Z";
    const frueh = "2026-11-02T10:00:00Z";
    const r = L.callsAus([{ id: "a", main: [ev(spaet)], subagents: [] }, { id: "b", main: [ev(frueh)], subagents: [] }]);
    expect(r.calls.map((x) => x.t)).toEqual([Date.parse(frueh), Date.parse(spaet)]);
  });

  test("Streuung roh und gewichtet: IQR/Median aus vier Tageswerten (Handwerte), auch im Text", () => {
    const r = aus(vier(50_000));
    expect(r.streuung.iqrRoh).toBeCloseTo(0.6, 6);
    expect(r.streuung.iqrGewichtet).toBeCloseTo(0.6, 6);
    const text = L.tokensJeProzentpunktAbschnitt(lauf(vier(50_000).flatMap((x) => x.pts), vier(50_000).map((x) => x.call), T0 + 30 * D)).join("\n");
    expect(text).toContain("- Streuung der Tageswerte roh: Median 25 Tsd, Q1 bis Q3 18 Tsd bis 33 Tsd (n=4), IQR/Median 0,6; gewichtet (Schätzung, Listenpreis-Gewichte, ungesichert): Median $0,50, Q1 bis Q3 $0,35 bis $0,65 (n=4), IQR/Median 0,6");
    expect(text).toContain("| ↳ Tageswerte | Median 25 Tsd, Q1 bis Q3 18 Tsd bis 33 Tsd (n=4) | | | | |");
    expect(text).toContain("| Modell | input | output | cache_read | cache_creation 5m | cache_creation 1h |");
    expect(text).toContain("| m | 1,00 Mio | 0 | 0 | 0 | 0 |");
  });

  test("usd: ab 0,01 zwei Nachkommastellen, darunter zwei geltende Ziffern, 0 bleibt $0,00, unter 1e-6 eine Untergrenze", () => {
    expect(L.usd(0.5)).toBe("$0,50");
    expect(L.usd(0.01)).toBe("$0,01");
    expect(L.usd(0.0085)).toBe("$0,0085");
    expect(L.usd(0.00123)).toBe("$0,0012");
    expect(L.usd(0.000012345)).toBe("$0,000012");
    expect(L.usd(0)).toBe("$0,00");
    expect(L.usd(0.0000004)).toBe("< $0,000001");
    expect(L.usd(0.000001)).toBe("$0,000001");
  });

  test("Preis 0 ergibt Median 0: IQR/Median ist null und steht als Strich, ohne aussagekräftige Tage als Text", () => {
    const g = aus(vier(Infinity)).streuung;
    expect([g.iqrRoh !== null, g.iqrGewichtet]).toEqual([true, null]);
    const text = L.tokensJeProzentpunktAbschnitt(lauf(vier(Infinity).flatMap((x) => x.pts), vier(Infinity).map((x) => x.call), T0 + 30 * D)).join("\n");
    expect(text).toContain("Median $0,00, Q1 bis Q3 $0,00 bis $0,00 (n=4), IQR/Median –");
    const klein = L.tokensJeProzentpunktAbschnitt(lauf([p(T0 + H, 0), p(T0 + 2 * H, 2)], [c(T0 + 90 * 60_000, { input: 500 })])).join("\n");
    expect(klein).toContain("- Streuung der Tageswerte roh: keine aussagekräftigen Tage, IQR/Median –; gewichtet");
  });

  test("Wochen: jede Woche zeigt nur ihre eigene Verteilung; Calls ohne Verlauf in einer Woche ohne Punkte ergeben eine Wochenzeile mit Lücke", () => {
    const r = aus([...vier(1e9), tag(7, 1_000_000), tag(8, 2_000_000)], [c(T0 + 15 * D + H)]);
    expect(r.wochen.map((w) => w.schluessel)).toEqual(["2026-W45", "2026-W46", "2026-W47"]);
    expect(r.wochen[0].tage.roh.n).toBe(4);
    expect(r.wochen[1].tage.roh).toMatchObject({ n: 2, median: 150_000 });
    expect(r.wochen[2].luecke).toBe("keine Kontingent-Punkte (1 Calls ohne Verlauf)");
  });

  test("Ausgelassen: veralteter Punkt und Abschnitt mit Zuwachs ohne Calls stehen mit Werten ungleich 0", () => {
    const t = lauf([p(T0 + H, 10, RF), p(T0 + 2 * H, 20, RF), p(T0 + 3 * H, 15, RF), p(T0 + 4 * H, 30, RF)], [c(T0 + 90 * 60_000, { input: 1000 })]);
    expect(L.tokensJeProzentpunktAbschnitt(t).join("\n")).toContain("- Ausgelassen: Reset 0, Zuwachs ohne Calls 10 pp (1), veraltete Punkte 1, Calls ohne Verlauf 0");
  });

  test("die Zeile Ausgelassen nennt alle Zähler mit Wert", () => {
    const r1 = (T0 + 150 * 60_000) / 1000;
    const t = lauf([p(T0 + H, 10, r1), p(T0 + 2 * H, 20, r1), p(T0 + 3 * H, 2), p(T0 + 4 * H, 12)], [c(T0 + 90 * 60_000, { input: 1000 }), c(T0 + 150 * 60_000, { input: 5 }), c(T0 + 210 * 60_000, { input: 1000 })]);
    expect(L.tokensJeProzentpunktAbschnitt(t).join("\n")).toContain("- Ausgelassen: Reset 1, Zuwachs ohne Calls 0 pp (0), veraltete Punkte 0, Calls ohne Verlauf 1");
  });
});

describe("Abschnitt", () => {
  test("Lücken, nicht aussagekräftig und Kennzahl erscheinen als Text, gewichtete Werte mit Schätzungs-Hinweis; Lücke des Ganzen", () => {
    const t = lauf([p(T0 + H, 0), p(T0 + 2 * H, 10), p(T0 + D + H, 10)], [c(T0 + 90 * 60_000, { input: 1_000_000, cost: 1 })]);
    const text = L.tokensJeProzentpunktAbschnitt(t).join("\n");
    expect(text).toContain("7-Tage-Limit");
    expect(text).toContain("100 Tsd je pp");
    expect(text).toContain("Schätzung, Listenpreis-Gewichte, ungesichert");
    expect(text).toContain("5-Stunden-Limit:** Lücke");
    expect(text).toContain("1,00 Mio");
    expect(L.tokensJeProzentpunktAbschnitt({ luecke: "kein Verlauf" })).toEqual(["- Lücke: kein Verlauf"]);
    const mehr = L.tokensJeProzentpunktAbschnitt({ ...t, kaputt: 2, aufbau: { sitzungen: 3, calls: 7, ohneZeit: 1 } }).join("\n");
    expect(mehr).toContain("2 kaputte Zeilen");
    expect(mehr).toContain("3 Sitzungen, 7 Calls, 1 ohne Zeitstempel");
    expect(L.tokensJeProzentpunktAbschnitt({ ...t, aufbau: { sitzungen: 3, calls: 7, ohneZeit: 0 } }).join("\n")).not.toContain("ohne Zeitstempel");
  });

  test("nicht aussagekräftig, Preis-Lücke und ein Limit ohne gültigen Abschnitt (keine Modelltabelle) erscheinen im Text", () => {
    const klein = L.tokensJeProzentpunktAbschnitt(lauf([p(T0 + H, 0), p(T0 + 2 * H, 2)], [c(T0 + 90 * 60_000, { input: 500, cost: null })])).join("\n");
    expect(klein).toContain("500 | 2 pp (±1) | nicht aussagekräftig (unter 5 pp)");
    const preis = L.tokensJeProzentpunktAbschnitt(lauf([p(T0 + H, 0), p(T0 + 2 * H, 10)], [c(T0 + 90 * 60_000, { input: 500, cost: null })])).join("\n");
    expect(preis).toContain("Lücke: kein Preis für m");
    const leer = L.tokensJeProzentpunktAbschnitt(lauf([p(T0 + H, 0), p(T0 + 2 * H, 10)], [])).join("\n");
    expect(leer).toContain("Zuwachs ohne Calls (10 pp)");
    expect(leer).not.toContain("| Modell |");
  });
});

describe("keine zweite Token-Zählung (AK1)", () => {
  const zeile = (id: string, ts: string, model: string, out: number) =>
    JSON.stringify({ type: "assistant", timestamp: ts, uuid: `${id}-${out}`, message: { id, role: "assistant", model, usage: { input_tokens: 7, cache_read_input_tokens: 11, cache_creation_input_tokens: 13, cache_creation: { ephemeral_1h_input_tokens: 5 }, output_tokens: out }, content: [{ type: "text", text: "x" }] } });

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
    expect({ input: sum("input"), cacheRead: sum("cacheRead") }).toEqual({ input: 21, cacheRead: 33 }); // Handwerte: je Call 7 und 11, drei Calls nach der Dublette
    expect(lib.calls.map((x) => [x.cacheWrite5m, x.cacheWrite1h])).toEqual([[8, 5], [8, 5], [8, 5]]);
    expect({ input: sum("input"), cacheWrite: sum("cacheWrite5m") + sum("cacheWrite1h"), cacheRead: sum("cacheRead"), output: sum("output") }).toEqual({
      input: basis.input, cacheWrite: basis.cacheWrite, cacheRead: basis.cacheRead, output: basis.output,
    });
  });
});

describe("callsAus", () => {
  test("ein Call ohne lesbaren Zeitstempel zählt nicht in die Abschnitte, sondern in ohneZeit", () => {
    const ohne = { type: "assistant", uuid: "u1", message: { id: "x1", role: "assistant", model: "claude-opus-5-5", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "x" }] } };
    const r = L.callsAus([{ id: "s", main: [ohne], subagents: [] }]);
    expect(r).toMatchObject({ calls: [], sitzungen: 1, ohneZeit: 1 });
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
