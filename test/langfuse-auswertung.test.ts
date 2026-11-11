/* Langfuse-Auswertung (factory#289): Export lesen, Quellen, Rolle/Effort/Repo/Modell, „unzugeordnet“, Datenlücken, CLI, Wächter Secret-Key. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/langfuse-auswertung-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../scripts/langfuse-auswertung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { EFFORT_STUFEN as EFFORT_TRANSKRIPT } from "../scripts/transkript-calls.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { TRACE_NAME as TRACE_NAME_OTLP } from "../scripts/langfuse-otlp.mjs";

type Zeile = { name: string; count: number; cost: number; quellen: Record<string, number> };
type Tab = { zeilen: Zeile[]; summe: { count: number; cost: number }; davon: { unbekannt: { count: number; cost: number }; ohneSchluessel: { count: number; cost: number } } };
type Bericht = {
  vermerk: string;
  roh: { count: number; cost: number };
  bereinigt: { count: number; cost: number };
  audit: { count: number; cost: number };
  negativ: { gruppen: number; count: number; cost: number };
  quelle: Tab;
  modell: Tab;
  repo: Tab;
  rolle: Tab;
  effort: Tab;
  unzugeordnet: { count: number; cost: number };
  luecken: string[];
};
type Ex = { art: string; abfrage: { filters?: { column: string; key?: string; value: string }[]; config?: { row_limit: number } }; data: unknown[] };
const L = libRaw as unknown as {
  TRACE_NAME_ABGLEICH: string;
  EFFORT_STUFEN: string[];
  ROW_LIMIT: number;
  quelleVon: (t: string | null, n: string | null) => string;
  rezept: (o: { von: string; bis: string; rollen?: string[] }) => { art: string; name: string; abfrage: Ex["abfrage"] & { fromTimestamp: string; toTimestamp: string } }[];
  leseExport: (j: unknown, pfad: string) => unknown;
  bericht: (e: unknown[]) => Bericht;
  renderMarkdown: (b: Bericht) => string;
  tagesLuecken: (von: string, bis: string, data: unknown[]) => string[];
};
const C = cliRaw as unknown as {
  parseArgs: (a: string[]) => unknown;
  auswerten: (a: unknown, d?: Record<string, unknown>) => { exitCode: number; text: string };
  agentenNamen: (ordner: string) => string[];
};

const VON = "2026-11-01T00:00:00Z";
const BIS = "2026-11-04T00:00:00Z";
const FILTER = { column: "type", operator: "=", value: "GENERATION", type: "string" };
const exp = (art: string, data: unknown[], filters: unknown[] = [FILTER], bis = BIS) => ({ art, abfrage: { view: "observations", filters, fromTimestamp: VON, toTimestamp: bis }, data });
const g = (traceName: string | null, name: string, modell: string | null, env: string | null, count: number, cost: number, min?: number) => ({
  traceName, name, providedModelName: modell, environment: env, count_count: count, sum_totalCost: cost, ...(min === undefined ? {} : { min_latency: min }),
});
const meta = (key: string, wert: string, data: unknown[]) => exp("metadaten", data, [FILTER, { column: "metadata", key, operator: "=", value: wert, type: "stringObject" }]);
const lese = (j: unknown) => L.leseExport(j, "x.json");
const rep = (...js: unknown[]) => L.bericht(js.map(lese));

const R1 = ["Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "repoA"] as const; // 10 Calls, 5 $, live
const R2 = ["Abgleich", "Call", "claude-opus-5-5", "repoA"] as const; // 20 Calls, 10 $, nachgeliefert
const R3 = ["Codex: x", "Model response", "gpt-6.1-sol", "repoB"] as const; // 4 Calls, 2 $, codex
const gesamtRows = [g(...R1, 10, 5), g(...R2, 20, 10), g(...R3, 4, 2)];
const gesamt = exp("gesamt", gesamtRows);
const tageVoll = exp("tage", ["2026-11-01", "2026-11-02", "2026-11-03"].map((t) => ({ traceName: "Claude Code Turn", time_dimension: t, count_count: 1, sum_totalCost: 1 })));
const latenzOk = exp("latenz", [g(...R1, 10, 5, 0), g(...R2, 20, 10, 5), g(...R3, 4, 2, 7)]);
const basis = [gesamt, tageVoll, latenzOk];
const alleRollen = [meta("agent_type", "Plan", [g(...R1, 10, 5, 3), g(...R2, 20, 10, 3)]), meta("agent_role", "main", [g(...R3, 4, 2, 7)])];
const alleEfforts = [meta("effort", "high", [g(...R1, 10, 5, 3), g(...R2, 20, 10, 3)]), meta("reasoning_effort", "high", [g(...R3, 4, 2, 7)])];
const unzZeile = (t: Tab) => t.zeilen[t.zeilen.length - 1];

describe("Quelle", () => {
  test("Abgleich ist nachgeliefert, Model response und Codex: sind codex, Plugin-Namen live, alles andere sonstige", () => {
    expect(L.quelleVon("Abgleich", "Call")).toBe("nachgeliefert");
    expect(L.quelleVon("Codex: lumina", "Model response")).toBe("codex");
    expect(L.quelleVon("Codex: lumina", "Anderes")).toBe("codex");
    expect(L.quelleVon("Claude Code Turn", "Subagent LLM Call")).toBe("live");
    expect(L.quelleVon("Claude Code Turn", "[duplicate audit] LLM Call")).toBe("live");
    expect(L.quelleVon("Claude: usage reconciliation", "Call")).toBe("sonstige");
    expect(L.quelleVon(null, "Call")).toBe("sonstige");
  });
  test("sonstige bleibt eine sichtbare Spalte und Live/Nachgeliefert/Codex stehen getrennt", () => {
    const b = rep(exp("gesamt", [...gesamtRows, g("Fremd", "Call", "claude-haiku-5-5", "repoA", 1, 0.5)]), tageVoll, latenzOk);
    const q = Object.fromEntries(b.quelle.zeilen.map((z) => [z.name, z.cost]));
    expect(q).toMatchObject({ live: 5, nachgeliefert: 10, codex: 2, sonstige: 0.5 });
    expect(L.renderMarkdown(b)).toContain("| sonstige |");
  });
});

describe("unzugeordnet (AK7)", () => {
  test("steht mit 0, wenn alles zugeordnet ist (Gesamtzeile und jede Tabelle)", () => {
    const b = rep(...basis, ...alleRollen, ...alleEfforts);
    expect(b.unzugeordnet).toEqual({ count: 0, cost: 0 });
    for (const t of [b.rolle, b.effort, b.repo, b.modell]) expect(unzZeile(t)).toMatchObject({ name: "unzugeordnet", count: 0, cost: 0 });
    expect(L.renderMarkdown(b)).toContain("unzugeordnet: 0 Calls (0.00 $) ohne Rolle oder ohne Modell.");
  });
  test("ohne agent_type-Zelle geht der Rest nach unzugeordnet", () => {
    const b = rep(...basis, meta("agent_type", "Plan", [g(...R1, 4, 2, 3)]));
    expect(b.rolle.zeilen.find((z) => z.name === "Plan")).toMatchObject({ count: 4, cost: 2 });
    expect(unzZeile(b.rolle)).toMatchObject({ count: 30, cost: 15 });
    expect(b.unzugeordnet).toEqual({ count: 30, cost: 15 });
  });
  test("ohne jeden Rollen-Export ist alles unzugeordnet und die Lücke genannt", () => {
    const b = rep(...basis);
    expect(b.unzugeordnet).toEqual({ count: 34, cost: 17 });
    expect(b.luecken).toContain("Rolle: kein Metadaten-Export, nichts zugeordnet (alles unzugeordnet)");
  });
  test("der Wert unbekannt zählt als unzugeordnet, nie als Rolle", () => {
    const b = rep(...basis, meta("agent_type", "unbekannt", [g(...R1, 10, 5, 3)]), meta("agent_type", "Plan", [g(...R2, 20, 10, 3)]));
    expect(b.rolle.zeilen.map((z) => z.name)).not.toContain("unbekannt");
    expect(b.rolle.davon.unbekannt).toEqual({ count: 10, cost: 5 });
    expect(unzZeile(b.rolle)).toMatchObject({ count: 14, cost: 7 });
    expect(L.renderMarkdown(b)).toContain("Davon unzugeordnet: unbekannt 10 Calls (5.00 $)");
  });
  test("Modell null oder leer ist unzugeordnet, auch bei bekannter Rolle", () => {
    const ohne = ["Claude Code Turn", "LLM Call", null, "repoA"] as const;
    const leerModell = ["Claude Code Turn", "Subagent LLM Call", "", "repoA"] as const;
    const b = rep(exp("gesamt", [...gesamtRows, g(...ohne, 3, 1), g(...leerModell, 2, 1)]), tageVoll, latenzOk, ...alleRollen, meta("agent_type", "Explore", [g(...ohne, 3, 1, 3), g(...leerModell, 2, 1, 3)]));
    expect(b.modell.zeilen.find((z) => z.name === "unzugeordnet")).toMatchObject({ count: 5, cost: 2 });
    expect(b.unzugeordnet).toEqual({ count: 5, cost: 2 });
    expect(b.rolle.zeilen.find((z) => z.name === "Explore")).toMatchObject({ count: 5 });
  });
  test("Repo default oder leer ist unzugeordnet", () => {
    const b = rep(exp("gesamt", [g(...R1, 1, 1), g("Abgleich", "Call", "claude-opus-5-5", "default", 2, 2), g("Abgleich", "Call", "claude-opus-5-5", "", 3, 3), g("Abgleich", "Call", "claude-opus-5-5", null, 4, 4)]), tageVoll);
    expect(b.repo.zeilen.map((z) => z.name)).toEqual(["repoA", "unzugeordnet"]);
    expect(unzZeile(b.repo)).toMatchObject({ count: 9, cost: 9 });
  });
});

describe("Export lesen und prüfen", () => {
  test("Export ohne Filter type = GENERATION wirft (Spans mit unbekannt zählen nie)", () => {
    expect(() => lese(exp("gesamt", gesamtRows, []))).toThrow(/type = GENERATION/);
    expect(() => lese(exp("gesamt", gesamtRows, [{ column: "type", operator: "=", value: "SPAN" }]))).toThrow(/type = GENERATION/);
  });
  test("nacktes {data}, Array, unbekannte art und fehlendes Fenster werfen mit Hinweis aufs Rezept", () => {
    expect(() => lese({ data: gesamtRows })).toThrow(/selbstbeschreibend.*--rezept/);
    expect(() => lese(gesamtRows)).toThrow(/selbstbeschreibend/);
    expect(() => lese({ ...gesamt, art: "kosten" })).toThrow(/unbekannte art/);
    expect(() => lese({ ...gesamt, abfrage: { filters: [FILTER] } })).toThrow(/Fenster/);
    expect(() => lese({ ...gesamt, data: "x" })).toThrow(/data fehlt/);
  });
  test("ein Export mit row_limit Zeilen ist abgeschnitten und wirft, einer darunter nicht", () => {
    const viele = (n: number) => Array.from({ length: n }, (_, i) => g("T", `n${i}`, "m", "r", 1, 1));
    expect(() => lese(exp("gesamt", viele(L.ROW_LIMIT)))).toThrow(/abgeschnitten/);
    expect(() => lese(exp("latenz", viele(L.ROW_LIMIT)))).toThrow(/abgeschnitten/);
    expect(() => lese(exp("gesamt", viele(L.ROW_LIMIT - 1)))).not.toThrow();
  });
  test("eine Zeile ohne numerische Metriken oder ohne min_latency (außer gesamt) wirft, nie eine stille 0", () => {
    expect(() => lese(exp("gesamt", [{ ...g(...R1, 1, 1), sum_totalCost: undefined }]))).toThrow(/gesamt-Zeile 1 ohne numerische Metriken/);
    expect(() => lese(exp("gesamt", [{ ...g(...R1, 1, 1), count_count: null }]))).toThrow(/ohne numerische Metriken/);
    expect(() => lese(exp("gesamt", [g(...R1, 1, 1), { ...g(...R2, 1, 1), sum_totalCost: "viel" }]))).toThrow(/gesamt-Zeile 2/);
    expect(() => lese(exp("latenz", [g(...R1, 1, 1)]))).toThrow(/latenz-Zeile 1 ohne numerisches min_latency/);
    expect(() => lese(exp("latenz", [{ ...g(...R1, 1, 1), min_latency: null }]))).toThrow(/min_latency/);
    expect(() => lese(meta("agent_type", "Plan", [g(...R1, 1, 1)]))).toThrow(/metadaten-Zeile 1 ohne numerisches min_latency/);
    expect(() => lese(exp("gesamt", [null]))).toThrow(/ohne numerische Metriken/);
    expect(() => lese(exp("gesamt", [g(...R1, 0, 0)]))).not.toThrow();
  });
  test("metadaten braucht genau einen stringObject-Filter mit auswertbarem Schlüssel", () => {
    expect(() => lese(exp("metadaten", []))).toThrow(/genau einen stringObject-Filter/);
    expect(() => lese(meta("kosten", "x", []))).toThrow(/nicht auswertbar/);
    expect(() => lese(exp("metadaten", [], [FILTER, { column: "metadata", key: "agent_type", operator: "contains", value: "x", type: "stringObject" }]))).toThrow(/operator =/);
  });
  test("ungleiche Fenster, doppeltes gesamt, doppelter Metadaten-Export und fehlendes gesamt werfen", () => {
    expect(() => rep(gesamt, exp("tage", [], [FILTER], "2026-11-05T00:00:00Z"))).toThrow(/ungleiche Fenster/);
    expect(() => rep(gesamt, gesamt)).toThrow(/mehrfach/);
    expect(() => rep(gesamt, meta("agent_type", "Plan", []), meta("agent_type", "Plan", []))).toThrow(/mehrfach/);
    expect(() => rep(tageVoll)).toThrow(/gesamt fehlt/);
    expect(() => L.bericht([])).toThrow(/kein Export/);
  });
});

describe("Datenlücken und Bereinigung", () => {
  test("negative Latenz einer Gruppe: gezählt, aus allen Summen genommen, roh ungleich bereinigt, Lücke genannt", () => {
    const b = rep(gesamt, tageVoll, exp("latenz", [g(...R1, 10, 5, 0), g(...R2, 20, 10, -5), g(...R3, 4, 2, 7)]));
    expect(b.roh).toEqual({ count: 34, cost: 17 });
    expect(b.bereinigt).toEqual({ count: 14, cost: 7 });
    expect(b.negativ).toEqual({ gruppen: 1, count: 20, cost: 10 });
    expect(b.modell.zeilen.map((z) => z.name)).not.toContain("claude-opus-5-5");
    expect(b.luecken.join("\n")).toMatch(/negative Latenzen: 1 Gruppe\(n\).*20 Calls \(10\.00 \$\)/);
    expect(L.renderMarkdown(b)).toMatch(/roh 17\.00 \$ \(34 Calls\), bereinigt 7\.00 \$ .*ohne negative Latenzen 20 Calls 10\.00 \$/);
  });
  test("ohne Latenz-Export steht „nicht geprüft“, nie ein stilles 0", () => {
    const b = rep(gesamt, tageVoll);
    expect(b.luecken).toContain("negative Latenzen nicht geprüft (Export latenz fehlt)");
    expect(b.negativ.count).toBe(0);
  });
  test("negative min_latency in einer Metadaten-Zelle macht die Gruppe zur Lücke, auch ihren Rest", () => {
    const b = rep(...basis, meta("agent_type", "Plan", [g(...R1, 10, 5, -1)]));
    expect(b.luecken.join("\n")).toMatch(/Rolle: 1 Gruppe\(n\) mit negativer Latenz in einer Metadaten-Zelle, 10 Calls \(5\.00 \$\)/);
    expect(b.rolle.summe).toEqual({ count: 24, cost: 12 });
    expect(b.unzugeordnet).toEqual({ count: 24, cost: 12 });
  });
  test("ein Tag ohne Daten ist Datenlücke und jede Summe trägt „ohne Tag X“", () => {
    const b = rep(gesamt, exp("tage", [{ time_dimension: "2026-11-01" }, { time_dimension: "2026-11-03" }]), latenzOk);
    expect(b.luecken).toContain("Tage ohne Daten: 2026-11-02");
    const md = L.renderMarkdown(b);
    expect(md).toContain("Gesamt (ohne Tag 2026-11-02): roh");
    expect(md).toContain("unzugeordnet (ohne Tag 2026-11-02): ");
    for (const t of ["Quelle", "Je Rolle", "Je Repo", "Je Effort", "Je Modell"]) expect(md).toContain(`## ${t} (ohne Tag 2026-11-02)`);
  });
  test("ohne Tage-Export steht „Tage nicht geprüft“; mit allen Tagen kein Vermerk", () => {
    const b = rep(gesamt, latenzOk);
    expect(b.luecken).toContain("Tage nicht geprüft (Export tage fehlt)");
    expect(b.vermerk).toBe(" (Tage nicht geprüft)");
    expect(rep(...basis).vermerk).toBe("");
  });
  test("Tage werden nach UTC gegen das Fenster geprüft (halboffen, Offset-Zeiten)", () => {
    expect(L.tagesLuecken("2026-11-01T12:00:00Z", "2026-11-03T00:00:00Z", [])).toEqual(["2026-11-01", "2026-11-02"]);
    expect(L.tagesLuecken("2026-11-01T00:00:00+01:00", "2026-11-01T23:00:00Z", [{ time_dimension: "2026-11-01" }])).toEqual(["2026-10-31"]);
  });
  test("doppelte Audit-Markierung zählt einmal: die Kopie fällt aus bereinigt und aus den Tabellen", () => {
    const kopie = ["Claude Code Turn", "[duplicate audit] LLM Call", "claude-sonnet-5-5", "repoA"] as const;
    const b = rep(exp("gesamt", [...gesamtRows, g(...kopie, 2, 1)]), tageVoll, exp("latenz", [...latenzOk.data, g(...kopie, 2, 1, 0)]), meta("agent_type", "Plan", [g(...R1, 10, 5, 3), g(...kopie, 2, 1, 3)]));
    expect(b.roh).toEqual({ count: 36, cost: 18 });
    expect(b.bereinigt).toEqual({ count: 34, cost: 17 });
    expect(b.audit).toEqual({ count: 2, cost: 1 });
    expect(b.quelle.zeilen.find((z) => z.name === "live")).toMatchObject({ count: 10 });
    expect(b.luecken.join("\n")).not.toMatch(/nicht konsistent/);
    expect(L.renderMarkdown(b)).toContain("ohne doppelte Audit-Markierungen 2 Calls 1.00 $");
  });
  test("ein Rest unter 0 ist eine Datenlücke statt einer negativen Zahl", () => {
    const b = rep(...basis, meta("agent_type", "Plan", [g(...R1, 11, 6, 3)]));
    expect(b.luecken.join("\n")).toMatch(/Rolle: Exporte nicht konsistent \(1 Zeile\(n\) mit Rest unter 0/);
    expect(b.unzugeordnet.cost).toBeGreaterThanOrEqual(0);
    expect(b.rolle.summe.cost).toBeGreaterThanOrEqual(0);
    for (const z of b.rolle.zeilen) expect(z.cost).toBeGreaterThanOrEqual(0);
  });
  test("Dubletten Live/Nachgeliefert stehen als nicht abgezogen im Bericht", () => {
    expect(L.renderMarkdown(rep(...basis))).toContain("Dubletten Live/Nachgeliefert: nicht abgezogen (Stichprobe factory#286: keine belegt)");
  });
});

describe("Bericht", () => {
  test("Rolle, Effort, Repo und Modell tragen die Kosten; Codex-Rolle kommt aus agent_role", () => {
    const b = rep(...basis, ...alleRollen, ...alleEfforts);
    expect(Object.fromEntries(b.rolle.zeilen.map((z) => [z.name, z.cost]))).toMatchObject({ Plan: 15, "agent_role:main": 2 });
    expect(Object.fromEntries(b.effort.zeilen.map((z) => [z.name, z.cost]))).toMatchObject({ "effort:high": 15, "reasoning_effort:high": 2 });
    expect(Object.fromEntries(b.repo.zeilen.map((z) => [z.name, z.cost]))).toMatchObject({ repoA: 15, repoB: 2 });
    expect(b.modell.zeilen.find((z) => z.name === "claude-opus-5-5")).toMatchObject({ cost: 10, quellen: { nachgeliefert: 10 } });
  });
  test("Modell claude mit 0 $ bleibt eine sichtbare Zeile", () => {
    const b = rep(exp("gesamt", [...gesamtRows, g("Claude Code Turn", "Subagent LLM Call", "claude", "repoA", 7, 0)]), tageVoll);
    expect(b.modell.zeilen.find((z) => z.name === "claude")).toMatchObject({ count: 7, cost: 0 });
  });
  test("Determinismus: vertauschte Export- und Zeilenreihenfolge ergibt dieselbe Ausgabe", () => {
    const a = rep(...basis, ...alleRollen, ...alleEfforts);
    const rev = (e: { data: unknown[] }) => ({ ...e, data: [...e.data].reverse() });
    const b = rep(...[...basis, ...alleRollen, ...alleEfforts].reverse().map((e) => rev(e as { data: unknown[] })));
    expect(L.renderMarkdown(b)).toBe(L.renderMarkdown(a));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("Rezept", () => {
  const rez = L.rezept({ von: VON, bis: BIS, rollen: ["sih-umsetzer"] });
  test("jede Abfrage filtert type = GENERATION, nutzt row_limit 1000 und das Fenster; der Leser nimmt sie an", () => {
    for (const r of rez) {
      expect(r.abfrage.filters?.[0]).toMatchObject({ column: "type", value: "GENERATION" });
      expect(r.abfrage.config?.row_limit).toBe(1000);
      expect(r.abfrage).toMatchObject({ fromTimestamp: VON, toTimestamp: BIS });
      expect(() => lese({ art: r.art, abfrage: r.abfrage, data: [] })).not.toThrow();
    }
  });
  test("Rollenliste enthält hauptchat, unbekannt und die übergebenen Rollen; Effort-Liste gleich EFFORT_STUFEN", () => {
    const werte = (key: string) => rez.filter((r) => r.art === "metadaten").map((r) => r.abfrage.filters?.[1]).filter((f) => f?.key === key).map((f) => f?.value);
    expect(werte("agent_type")).toEqual(expect.arrayContaining(["hauptchat", "unbekannt", "Plan", "sih-umsetzer"]));
    expect(werte("effort")).toEqual(L.EFFORT_STUFEN);
    expect(werte("agent_role")).toEqual(["main", "subagent"]);
  });
  test("die lokalen Konstanten gleichen den Quellen (die Lib importiert sie bewusst nicht)", () => {
    expect(L.EFFORT_STUFEN).toEqual(EFFORT_TRANSKRIPT);
    expect(L.TRACE_NAME_ABGLEICH).toBe(TRACE_NAME_OTLP);
  });
});

describe("Wächter Secret-Key (AK8)", () => {
  const huelle = (start: string, gesehen = new Set<string>()): Set<string> => {
    if (gesehen.has(start)) return gesehen;
    gesehen.add(start);
    const text = readFileSync(join("scripts", start), "utf8");
    for (const m of text.matchAll(/from "\.\/([^"]+)"/g)) huelle(m[1], gesehen);
    return gesehen;
  };
  test("die Import-Hülle der CLI enthält weder langfuse-api noch langfuse-zugang, keinen Key und kein fetch", () => {
    const h = huelle("langfuse-auswertung.mjs");
    expect(h).toContain("langfuse-auswertung-lib.mjs");
    expect(h).not.toContain("langfuse-api.mjs");
    expect(h).not.toContain("langfuse-zugang.mjs");
    for (const f of h) expect(readFileSync(join("scripts", f), "utf8")).not.toMatch(/LANGFUSE_SECRET_KEY|fetch\(/);
  });
  test("die Lib importiert nichts", () => {
    expect(readFileSync("scripts/langfuse-auswertung-lib.mjs", "utf8")).not.toMatch(/^import /m);
  });
});

describe("Randfälle", () => {
  test("Köpfe: kein Objekt, nur ein Zeitstempel, falscher Filter (Operator, Spalte) werfen", () => {
    for (const j of [null, "x", 5]) expect(() => lese(j)).toThrow(/selbstbeschreibend/);
    expect(() => lese({ ...gesamt, abfrage: { filters: [FILTER], fromTimestamp: VON } })).toThrow(/Fenster/);
    expect(() => lese({ ...gesamt, abfrage: { filters: [FILTER], toTimestamp: BIS } })).toThrow(/Fenster/);
    expect(() => lese(exp("gesamt", gesamtRows, [{ ...FILTER, operator: "<>" }]))).toThrow(/type = GENERATION/);
    expect(() => lese(exp("gesamt", gesamtRows, [{ ...FILTER, column: "name" }]))).toThrow(/type = GENERATION/);
    expect(() => lese(exp("gesamt", gesamtRows, [{ ...FILTER, value: "generation" }]))).not.toThrow();
  });
  test("stringObject-Filter: zwei Filter, falsche Spalte, falscher Operator, Schlüssel oder Wert ohne Text werfen", () => {
    const so = { column: "metadata", key: "agent_type", operator: "=", value: "Plan", type: "stringObject" };
    expect(() => lese(exp("metadaten", [], [FILTER, so, so]))).toThrow(/genau einen stringObject-Filter \(gefunden: 2\)/);
    for (const kaputt of [{ column: "name" }, { operator: "contains" }, { key: undefined }, { value: 5 }]) {
      expect(() => lese(exp("metadaten", [], [FILTER, { ...so, ...kaputt }]))).toThrow(/column metadata, operator =, key und value als Text/);
    }
  });
  test("die Meldung bei doppeltem Metadaten-Export nennt Schlüssel und Wert", () => {
    expect(() => rep(gesamt, meta("agent_type", "Plan", []), meta("agent_type", "Plan", []))).toThrow(/agent_type=Plan/);
  });
  test("Tage: ein Fensterende genau um Mitternacht schließt den Tag aus", () => {
    expect(L.tagesLuecken("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z", [])).toEqual(["2026-11-01"]);
  });
  test("eine Zelle ohne Gegenstück in gesamt ist eine Lücke; eine Audit-Zelle ist es nicht", () => {
    const fremd = ["Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "repoZ"] as const;
    const b = rep(...basis, meta("agent_type", "Plan", [g(...fremd, 1, 1, 3)]));
    expect(b.luecken.join("\n")).toMatch(/Rolle: Exporte nicht konsistent \(0 Zeile\(n\) mit Rest unter 0, 1 Zelle\(n\) ohne Gegenstück/);
  });
  test("Rest: nur die Kosten über der Zelle (Calls gleich) und Rundungsrauschen unterscheiden Lücke und Null", () => {
    expect(rep(...basis, meta("agent_type", "Plan", [g(...R1, 10, 6, 3)])).luecken.join("\n")).toMatch(/1 Zeile\(n\) mit Rest unter 0/);
    const rauschen = rep(...basis, meta("agent_type", "Plan", [g(...R1, 9, 5.0000000000001, 3), g(...R2, 20, 10, 3)]), alleRollen[1]);
    expect(rauschen.luecken.join("\n")).not.toMatch(/nicht konsistent/);
    expect(unzZeile(rauschen.rolle)).toMatchObject({ count: 1, cost: 0 });
  });
  test("Rolle: ein Rest mit Calls aber 0 $ bleibt sichtbar (Calls zählen)", () => {
    const b = rep(...basis, meta("agent_type", "Plan", [g(...R1, 6, 5, 3)]));
    expect(unzZeile(b.rolle)).toMatchObject({ count: 4 + 20 + 4, cost: 10 + 2 });
  });
  test("gleiche Kosten sortieren nach Name; „Davon“ steht nur bei Rolle und Effort; „keine“ Lücken steht als Zeile", () => {
    const b = rep(exp("gesamt", [g(...R1, 1, 1), g("Abgleich", "Call", "b-modell", "repoA", 1, 1), g("Abgleich", "Call", "a-modell", "repoA", 1, 1)]), tageVoll);
    expect(b.modell.zeilen.map((z) => z.name)).toEqual(["a-modell", "b-modell", "claude-sonnet-5-5", "unzugeordnet"]);
    const md = L.renderMarkdown(rep(...basis, ...alleRollen, ...alleEfforts));
    expect(md.match(/Davon unzugeordnet/g)).toHaveLength(2);
    expect(md).toContain("- keine\n");
  });
  test("Zellen derselben Gruppe aus zwei Exporten (agent_type und agent_role) addieren sich", () => {
    const b = rep(...basis, meta("agent_type", "Plan", [g(...R1, 4, 2, 3)]), meta("agent_type", "Explore", [g(...R1, 3, 1, 3)]));
    expect(b.rolle.zeilen.find((z) => z.name === "Plan")).toMatchObject({ count: 4 });
    expect(b.rolle.zeilen.find((z) => z.name === "Explore")).toMatchObject({ count: 3 });
    expect(unzZeile(b.rolle)).toMatchObject({ count: 3 + 20 + 4 });
  });
  test("zwei Zeilen mit gleichem Schlüssel (null und leere Umgebung) werden summiert", () => {
    const b = rep(exp("gesamt", [g(...R1, 1, 1), g("Abgleich", "Call", "m", null, 2, 2), g("Abgleich", "Call", "m", "", 3, 3)]), tageVoll);
    expect(b.bereinigt).toEqual({ count: 6, cost: 6 });
    expect(b.modell.zeilen.find((z) => z.name === "m")).toMatchObject({ count: 5, cost: 5 });
  });
  test("ein unlesbares Fenster im Export wirft", () => {
    expect(() => lese({ ...gesamt, abfrage: { filters: [FILTER], fromTimestamp: "kaputt", toTimestamp: BIS } })).toThrow(/kein Zeitstempel/);
    expect(() => lese({ ...gesamt, abfrage: { filters: [FILTER], fromTimestamp: VON, toTimestamp: "kaputt" } })).toThrow(/kein Zeitstempel/);
  });
  test("ohne abfrage oder ohne filters wirft der Leser mit Meldung statt TypeError", () => {
    expect(() => lese({ art: "gesamt", data: [] })).toThrow(/type = GENERATION/);
    expect(() => lese({ art: "gesamt", abfrage: { fromTimestamp: VON, toTimestamp: BIS }, data: [] })).toThrow(/type = GENERATION/);
  });
  test("Quelle: Name allein genügt, auch mit Audit-Präfix; ein Name null stürzt nicht", () => {
    expect(L.quelleVon("Fremd", "Model response")).toBe("codex");
    expect(L.quelleVon("Fremd", "[duplicate audit] Model response")).toBe("codex");
    expect(L.quelleVon("Fremd", "[duplicate audit] Subagent LLM Call")).toBe("live");
    expect(L.quelleVon("Fremd", "Subagent LLM Call")).toBe("live");
    expect(L.quelleVon("Claude Code Turn", "Anderer Name")).toBe("live");
    expect(L.quelleVon("Abgleich", null)).toBe("nachgeliefert");
    expect(rep(exp("gesamt", [g("Fremd", null as unknown as string, "m", "r", 1, 1)]), tageVoll).quelle.zeilen.find((z) => z.name === "sonstige")).toMatchObject({ count: 1 });
  });
  test("das Rezept braucht keine Rollenliste", () => {
    expect(L.rezept({ von: VON, bis: BIS }).length).toBeGreaterThan(3);
  });
  test("Zelle mit anderer Darstellung von leer (null gegen leer) findet ihre Gruppe", () => {
    const leerEnv = ["Claude Code Turn", "LLM Call", "claude-sonnet-5-5", null] as const;
    const b = rep(exp("gesamt", [g(...leerEnv, 2, 1)]), tageVoll, meta("agent_type", "Plan", [g("Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "", 2, 1, 3)]));
    expect(b.luecken.join("\n")).not.toMatch(/nicht konsistent/);
    expect(b.rolle.zeilen.find((z) => z.name === "Plan")).toMatchObject({ count: 2 });
  });
  test("Gleitkomma: die Summe hängt nicht von der Zeilenreihenfolge ab", () => {
    const rows = [g("Abgleich", "Call", "m1", "r", 1, 0.1), g("Abgleich", "Call", "m2", "r", 1, 0.2), g("Abgleich", "Call", "m3", "r", 1, 0.3)];
    const a = rep(exp("gesamt", rows), tageVoll);
    const b = rep(exp("gesamt", [...rows].reverse()), tageVoll);
    expect(a.bereinigt.cost).toBe(b.bereinigt.cost);
    expect(a.repo.summe.cost).toBe(b.repo.summe.cost);
  });
  test("mehr Calls in den Zellen als in gesamt (Kosten gleich) ist eine Lücke", () => {
    expect(rep(...basis, meta("agent_type", "Plan", [g(...R1, 11, 5, 3)])).luecken.join("\n")).toMatch(/1 Zeile\(n\) mit Rest unter 0/);
  });
  test("Kosten je Quelle addieren sich über Zeilen derselben Tabellenzeile", () => {
    const b = rep(exp("gesamt", [g(...R1, 1, 1), g("Claude Code Turn", "Subagent LLM Call", "claude-sonnet-5-5", "repoA", 2, 2)]), tageVoll);
    expect(b.repo.zeilen.find((z) => z.name === "repoA")?.quellen.live).toBe(3);
  });
  test("Sortierung: Kosten absteigend, bei Gleichstand nach Name (unabhängig von der Zeilenfolge)", () => {
    const gleich = rep(exp("gesamt", [g("Abgleich", "Call", "z-modell", "r", 1, 1), g("Zzz", "Call", "a-modell", "r", 1, 1)]), tageVoll);
    expect(gleich.modell.zeilen.map((z) => z.name)).toEqual(["a-modell", "z-modell", "unzugeordnet"]);
    const teuer = rep(exp("gesamt", [g("Abgleich", "Call", "a-klein", "r", 1, 1), g("Zzz", "Call", "z-gross", "r", 1, 9)]), tageVoll);
    expect(teuer.modell.zeilen.map((z) => z.name)).toEqual(["z-gross", "a-klein", "unzugeordnet"]);
  });
  test("ein Modell-null-Call ohne Rollen-Zelle zählt in unzugeordnet nur einmal", () => {
    const b = rep(exp("gesamt", [g("Claude Code Turn", "LLM Call", null, "r", 3, 1)]), tageVoll);
    expect(b.unzugeordnet).toEqual({ count: 3, cost: 1 });
  });
});

describe("CLI", () => {
  const dateien: Record<string, string> = {};
  const lies = (p: string) => {
    if (!(p in dateien)) throw new Error(`ENOENT ${p}`);
    return dateien[p];
  };
  const lauf = (argv: string[]) => C.auswerten(C.parseArgs(argv), { lies });
  const erwarte = (argv: string[], exitCode: number, teil: string) => {
    const r = lauf(argv);
    expect(r.exitCode).toBe(exitCode);
    expect(r.text).toContain(teil);
  };
  test("unbekanntes Flag und fehlende Aufgabe sind Aufruffehler (Exit 2) mit Aufrufhilfe", () => {
    erwarte(["--gibtsnicht"], 2, "Unbekanntes Argument: --gibtsnicht");
    erwarte([], 2, "Weder --export noch --rezept");
    expect(lauf(["--rezept", "--von", VON])).toMatchObject({ exitCode: 2 });
    expect(lauf(["--rezept", "--von", BIS, "--bis", VON]).exitCode).toBe(2);
  });
  test("unlesbare Datei, unlesbares JSON und Formfehler sind Exit 1", () => {
    dateien["kaputt.json"] = "{";
    dateien["nackt.json"] = JSON.stringify({ data: [] });
    erwarte(["--export", "fehlt.json"], 1, "fehlt.json");
    erwarte(["--export", "kaputt.json"], 1, "--export kaputt.json: kein lesbares JSON");
    erwarte(["--export", "nackt.json"], 1, "selbstbeschreibend");
  });
  test("zwei Exporte ergeben Markdown, mit --json das Objekt; Datenlücken ändern den Exit nicht", () => {
    dateien["g.json"] = JSON.stringify(gesamt);
    dateien["t.json"] = JSON.stringify(exp("tage", [{ time_dimension: "2026-11-01" }]));
    const md = lauf(["--export", "g.json", "--export", "t.json"]);
    expect(md.exitCode).toBe(0);
    expect(md.text).toContain("## Datenlücken");
    expect(md.text).toContain("Tage ohne Daten: 2026-11-02, 2026-11-03");
    const js = lauf(["--export", "g.json", "--export", "t.json", "--json"]);
    expect((JSON.parse(js.text) as Bericht).roh).toEqual({ count: 34, cost: 17 });
  });
  test("--rezept liest die Agentennamen aus einem Agentenordner", () => {
    const dir = mkdtempSync(join(tmpdir(), "auswertung-"));
    writeFileSync(join(dir, "a.md"), "---\nname: mein-agent\ndescription: x\n---\n");
    writeFileSync(join(dir, "b.txt"), "name: ignoriert\n");
    expect(C.agentenNamen(dir)).toEqual(["mein-agent"]);
    const r = C.auswerten(C.parseArgs(["--rezept", "--von", VON, "--bis", BIS, "--rolle", "extra", "--agenten", dir]));
    expect(r.exitCode).toBe(0);
    const werte = (JSON.parse(r.text) as { abfrage: Ex["abfrage"] }[]).map((x) => x.abfrage.filters?.[1]?.value);
    expect(werte).toEqual(expect.arrayContaining(["mein-agent", "extra"]));
  });
  test("rezept: bis allein, ungültige Zeiten, von gleich bis und ein fehlender Agentenordner sind Fehler", () => {
    erwarte(["--rezept", "--bis", BIS], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", "kaputt", "--bis", BIS], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", VON, "--bis", "kaputt"], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", VON, "--bis", VON], 2, "--rezept braucht");
    const r = lauf(["--rezept", "--von", VON, "--bis", BIS, "--agenten", join(tmpdir(), "gibt-es-nicht-289")]);
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("Fehler:");
  });
  test("Agentenname: nur eine ganze Zeile name: <wort> zählt (kein Mittendrin, kein Mehrwort)", () => {
    const dir = mkdtempSync(join(tmpdir(), "auswertung-"));
    writeFileSync(join(dir, "a.md"), "---\ndescription: x name: falsch\nname: richtig\n---\n");
    writeFileSync(join(dir, "b.md"), "---\nname: zwei woerter\n---\n");
    writeFileSync(join(dir, "c.md"), "---\nname:ohneleerzeichen\n---\n");
    writeFileSync(join(dir, "d.md"), "---\nname:   mitplatz   \n---\n");
    expect(C.agentenNamen(dir)).toEqual(["mitplatz", "ohneleerzeichen", "richtig"]);
  });
  test("eine Agentendatei ohne name wird übersprungen", () => {
    const dir = mkdtempSync(join(tmpdir(), "auswertung-"));
    writeFileSync(join(dir, "ohne.md"), "---\ndescription: x\n---\n");
    writeFileSync(join(dir, "mit.md"), "---\nname: a\n---\n");
    expect(C.agentenNamen(dir)).toEqual(["a"]);
  });
  test("ohne eingespeiste Leser liest die CLI die echte Datei", () => {
    const dir = mkdtempSync(join(tmpdir(), "auswertung-"));
    writeFileSync(join(dir, "g.json"), JSON.stringify(gesamt));
    const r = C.auswerten(C.parseArgs(["--export", join(dir, "g.json")]));
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain("# Langfuse-Auswertung");
  });
  test("als Prozess: Bericht auf stdout mit Exit 0, Aufruffehler auf stderr mit Exit 2", () => {
    const ok = spawnSync("node", ["scripts/langfuse-auswertung.mjs", "--rezept", "--von", VON, "--bis", BIS], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toBeInstanceOf(Array);
    const schlecht = spawnSync("node", ["scripts/langfuse-auswertung.mjs", "--gibtsnicht"], { encoding: "utf8" });
    expect(schlecht.status).toBe(2);
    expect(schlecht.stderr).toContain("Aufruf: node scripts/langfuse-auswertung.mjs");
    expect(schlecht.stdout).toBe("");
  });
});
