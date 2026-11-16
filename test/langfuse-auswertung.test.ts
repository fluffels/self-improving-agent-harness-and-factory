/* Langfuse-Auswertung (factory#289): Export lesen, Quellen, Rolle/Effort/Repo/Modell, „unzugeordnet“, Datenlücken, CLI, Wächter Secret-Key. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { importHuelle } from "./support/import-huelle";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/langfuse-auswertung-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../scripts/langfuse-auswertung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as agentenRoh from "../scripts/agenten-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { EFFORT_STUFEN as EFFORT_TRANSKRIPT } from "../scripts/transkript-calls.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { TRACE_NAME as TRACE_NAME_OTLP } from "../scripts/langfuse-otlp.mjs";

type Zeile = { name: string; count: number; cost: number; quellen: Record<string, number> };
type Tab = { zeilen: Zeile[]; summe: { count: number; cost: number }; davon: { unbekannt: { count: number; cost: number }; ohneSchluessel: { count: number; cost: number } } };
type Bericht = {
  vermerk: string;
  roh: { count: number; cost: number };
  leer: { count: number } | null;
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
type Abfr = { dimensions?: { field: string }[]; metrics?: { measure: string; aggregation: string }[]; timeDimension?: unknown; filters?: { column: string; key?: string; value: string }[]; config?: { row_limit: number } };
type Ex = { art: string; abfrage: { filters?: { column: string; key?: string; value: string }[]; config?: { row_limit: number } }; data: unknown[] };
const L = libRaw as unknown as {
  TRACE_NAME_ABGLEICH: string;
  EFFORT_STUFEN: string[];
  ROW_LIMIT: number;
  quelleVon: (t: string | null, n: string | null) => string;
  rezept: (o: { von: string; bis: string; rollen?: string[]; efforts?: string[]; codexRollen?: string[]; projektFilter?: unknown; repoTags?: string[] }) => { art: string; name: string; abfrage: Abfr & { fromTimestamp: string; toTimestamp: string } }[];
  leseExport: (j: unknown, pfad: string) => unknown;
  betrag: (p: { cost: number; count: number; ohnePreis?: number; modelle?: string[] }) => string;
  bericht: (e: unknown[]) => Bericht;
  renderMarkdown: (b: Bericht) => string;
  tagesLuecken: (von: string, bis: string, data: unknown[]) => string[];
};
const C = cliRaw as unknown as {
  parseArgs: (a: string[]) => unknown;
  auswerten: (a: unknown, d?: Record<string, unknown>) => { exitCode: number; text: string };
};
const agentenNamen = (agentenRoh as unknown as { agentenNamen: (ordner: string, deps?: unknown) => string[] }).agentenNamen;

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as configRoh from "../scripts/projekt-config-lib.mjs";
const { ladeProjektConfig: ladeConfigRoh, repoName: repoNameRoh } = configRoh as unknown as { ladeProjektConfig: (o: { rootDir: string }) => unknown; repoName: (c: unknown) => string };

const VON = "2026-11-01T00:00:00Z";
const BIS = "2026-11-04T00:00:00Z";
const FILTER = { column: "type", operator: "=", value: "GENERATION", type: "string" };
const LEER_FILTER = { column: "providedModelName", operator: "none of", value: ["claude"], type: "stringOptions" };
// Jeder Export außer `leer` trägt den Filter gegen die leeren Hook-Generations (factory#522); Negativfälle bauen die Abfrage von Hand.
const exp = (art: string, data: unknown[], filters: unknown[] = [FILTER], bis = BIS) => ({ art, abfrage: { view: "observations", filters: art === "leer" ? filters : [...filters, LEER_FILTER], fromTimestamp: VON, toTimestamp: bis }, data });
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
/** Kontroll-Export `leer` passend zu gesamt-Zeilen: je Modell die Calls, dazu `claude` mit den übergebenen Calls und Tokens. */
const leerVon = (zeilen: ReturnType<typeof g>[], claude = { count: 0, tokens: 0 }) => {
  const je = new Map<string, number>();
  for (const z of zeilen) je.set(String(z.providedModelName), (je.get(String(z.providedModelName)) ?? 0) + z.count_count);
  const rows: unknown[] = [...je].map(([m, c]) => ({ providedModelName: m, count_count: c, sum_totalCost: 1, sum_totalTokens: 100 }));
  if (claude.count > 0) rows.push({ providedModelName: "claude", count_count: claude.count, sum_totalCost: 0, sum_totalTokens: claude.tokens });
  return { ...exp("leer", rows), abfrage: { view: "observations", filters: [FILTER], dimensions: [{ field: "providedModelName" }], fromTimestamp: VON, toTimestamp: BIS } };
};
const leerOk = leerVon(gesamtRows, { count: 42, tokens: 0 });
/** Export `repo` (factory#523): ein Export je Repo-Tag mit `name` und dem Filter tags any of [<tag>, project:<tag>]. */
const repoEx = (tag: string, data: unknown[], filters: unknown[] = [FILTER]) => ({ ...exp("repo", data, [...filters, { column: "tags", operator: "any of", type: "arrayOptions", value: [tag, `project:${tag}`] }]), name: `repo ${tag}` });
const repoA = repoEx("repoA", [g(...R1, 10, 5, 3), g(...R2, 20, 10, 3)]);
const repoB = repoEx("repoB", [g(...R3, 4, 2, 7)]);
const basis = [gesamt, tageVoll, latenzOk, leerOk, repoA, repoB];
const alleRollen = [meta("agent_type", "Plan", [g(...R1, 10, 5, 3), g(...R2, 20, 10, 3)]), meta("agent_role", "main", [g(...R3, 4, 2, 7)])];
const alleEfforts = [meta("effort", "high", [g(...R1, 10, 5, 3), g(...R2, 20, 10, 3)]), meta("reasoning_effort", "high", [g(...R3, 4, 2, 7)])];
const unzZeile = (t: Tab) => t.zeilen[t.zeilen.length - 1];

describe("Quelle", () => {
  test("Abgleich ist nachgeliefert, Model response und Codex: sind codex, Plugin-Namen live, alles andere sonstige", () => {
    expect(L.quelleVon("Abgleich", "Call")).toBe("nachgeliefert");
    expect(L.quelleVon("Codex: repo-x", "Model response")).toBe("codex");
    expect(L.quelleVon("Codex: repo-x", "Anderes")).toBe("codex");
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
    for (const t of [b.rolle, b.effort, b.modell]) expect(unzZeile(t)).toMatchObject({ name: "unzugeordnet", count: 0, cost: 0 });
    expect(b.repo.zeilen.map((z) => z.name)).toEqual(["repoA", "repoB"]); // ohne Rest keine Zeile „ohne Repo-Tag“
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
    expect(b.rolle.davon.unbekannt).toMatchObject({ count: 10, cost: 5 });
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
  test("das Repo kommt nie aus environment: ohne Repo-Export steht alles unter „ohne Repo-Tag“, auch bei environment gleich Repo-Name", () => {
    const b = rep(exp("gesamt", [g(...R1, 1, 1), g("Abgleich", "Call", "claude-opus-5-5", "default", 2, 2), g("Abgleich", "Call", "claude-opus-5-5", "", 3, 3), g("Abgleich", "Call", "claude-opus-5-5", null, 4, 4)]), tageVoll);
    expect(b.repo.zeilen.map((z) => z.name)).toEqual(["ohne Repo-Tag"]);
    expect(unzZeile(b.repo)).toMatchObject({ count: 10, cost: 10 });
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
  test("Kosten null bei Calls (queryMetrics ohne Preis): Zeile zählt mit 0 $, der Bericht nennt die Lücke, nie eine stille 0", () => {
    const ohne = g(...R2, 3, 0);
    const b = rep(exp("gesamt", [g(...R1, 10, 5), { ...ohne, sum_totalCost: null }]), tageVoll);
    expect(b.roh).toEqual({ count: 13, cost: 5 });
    expect(b.luecken).toContain("Kosten unvollständig: 3 Calls in 1 Gruppen ohne Preis (claude-opus-5-5)");
    expect(L.renderMarkdown(b)).toContain("- Kosten unvollständig: 3 Calls in 1 Gruppen ohne Preis (claude-opus-5-5)");
    const zwei = rep(exp("gesamt", [{ ...g(...R2, 3, 0), sum_totalCost: null }, { ...g(...R1, 2, 0), sum_totalCost: null }, { ...g("X", "Y", null, null, 1, 0), sum_totalCost: null }, { ...g("Z", "Y", "claude-haiku-5-5", null, 1, 0), sum_totalCost: null }]), tageVoll);
    expect(zwei.luecken).toContain("Kosten unvollständig: 7 Calls in 4 Gruppen ohne Preis (claude-haiku-5-5, claude-opus-5-5, claude-sonnet-5-5, unzugeordnet)");
  });
  test("Kosten null ohne Calls, belegte Kosten, oder in einer ausgeschlossenen Gruppe: keine Lücke", () => {
    const leer = rep(exp("gesamt", [g(...R1, 10, 5), { ...g(...R2, 0, 0), sum_totalCost: null }]), tageVoll);
    expect(leer.luecken.join("\n")).not.toContain("Kosten unvollständig");
    expect(rep(gesamt, tageVoll).luecken.join("\n")).not.toContain("Kosten unvollständig");
    const audit = rep(exp("gesamt", [g(...R1, 10, 5), { ...g("Abgleich", "[duplicate audit] Call", "claude-opus-5-5", "repoA", 4, 0), sum_totalCost: null }]), tageVoll);
    expect(audit.luecken.join("\n")).not.toContain("Kosten unvollständig");
    const neg = rep(exp("gesamt", [g(...R1, 10, 5), { ...g(...R2, 4, 0), sum_totalCost: null }]), tageVoll, exp("latenz", [g(...R1, 10, 5, 0), g(...R2, 4, 0, -1)]));
    expect(neg.luecken.join("\n")).not.toContain("Kosten unvollständig");
  });
  test("Kosten null gilt auch für latenz und metadaten; Formfehler bleiben Formfehler", () => {
    const n = (r: object) => ({ ...r, sum_totalCost: null });
    expect(() => lese(exp("latenz", [n(g(...R1, 3, 0, 1))]))).not.toThrow();
    expect(() => lese(meta("agent_type", "Plan", [n(g(...R1, 3, 0, 1))]))).not.toThrow();
    expect(() => lese(exp("gesamt", [n(g(...R1, 3, 0))]))).not.toThrow();
    expect(() => lese(exp("gesamt", [{ ...g(...R1, 3, 0), sum_totalCost: "abc" }]))).toThrow(/ohne numerische Metriken/);
    expect(() => lese(exp("gesamt", [{ ...g(...R1, 3, 0), sum_totalCost: undefined }]))).toThrow(/ohne numerische Metriken/);
    expect(() => lese(exp("gesamt", [{ ...n(g(...R1, 3, 0)), count_count: null }]))).toThrow(/ohne numerische Metriken/);
  });
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
    const b = rep(gesamt, exp("tage", [{ time_dimension: "2026-11-01", count_count: 1 }, { time_dimension: "2026-11-03", count_count: 1 }]), latenzOk);
    expect(b.luecken).toContain("Tage ohne Daten: 2026-11-02");
    const md = L.renderMarkdown(b);
    expect(md).toContain("Gesamt (ohne Tag 2026-11-02): roh");
    expect(md).toContain("unzugeordnet (ohne Tag 2026-11-02): ");
    for (const t of ["Quelle", "Je Rolle", "Je Repo", "Je Effort", "Je Modell"]) expect(md).toContain(`## ${t} (ohne Tag 2026-11-02)`);
  });
  test("ein leerer Tag als Zeile mit count 0 und Kosten null (so liefert queryMetrics ihn) ist Datenlücke, auch ohne count_count", () => {
    const leerTag = { traceName: "Claude Code Turn", time_dimension: "2026-11-02", count_count: 0, sum_totalCost: null };
    const b = rep(gesamt, exp("tage", [{ time_dimension: "2026-11-01", count_count: 1, sum_totalCost: 1 }, leerTag, { time_dimension: "2026-11-03", count_count: 1, sum_totalCost: 1 }]), latenzOk);
    expect(b.luecken).toContain("Tage ohne Daten: 2026-11-02");
    expect(L.renderMarkdown(b)).toContain("Gesamt (ohne Tag 2026-11-02): roh");
    expect(JSON.stringify(b.luecken)).toContain("2026-11-02");
    expect(L.tagesLuecken(VON, "2026-11-02T00:00:00Z", [{ time_dimension: "2026-11-01" }])).toEqual(["2026-11-01"]);
  });
  test("ohne Tage-Export steht „Tage nicht geprüft“; mit allen Tagen kein Vermerk", () => {
    const b = rep(gesamt, latenzOk);
    expect(b.luecken).toContain("Tage nicht geprüft (Export tage fehlt)");
    expect(b.vermerk).toBe(" (Tage nicht geprüft)");
    expect(rep(...basis).vermerk).toBe("");
  });
  test("Tage werden nach UTC gegen das Fenster geprüft (halboffen, Offset-Zeiten)", () => {
    expect(L.tagesLuecken("2026-11-01T12:00:00Z", "2026-11-03T00:00:00Z", [])).toEqual(["2026-11-01", "2026-11-02"]);
    expect(L.tagesLuecken("2026-11-01T00:00:00+01:00", "2026-11-01T23:00:00Z", [{ time_dimension: "2026-11-01", count_count: 1 }])).toEqual(["2026-10-31"]);
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
  test("Modell <synthetic> zählt nicht (wie in Dashboards und Transkript, factory#583), claude-* bleibt gezählt", () => {
    const synth = g("Claude Code Turn", "Subagent LLM Call", "<synthetic>", "repoA", 1, 0);
    const echt = g("Claude Code Turn", "Subagent LLM Call", "claude-neu-9", "repoA", 3, 2);
    const b = rep(exp("gesamt", [...gesamtRows, synth, echt]), tageVoll);
    expect(b.modell.zeilen.map((z) => z.name)).not.toContain("<synthetic>");
    expect(b.modell.zeilen.find((z) => z.name === "claude-neu-9")).toMatchObject({ count: 3 });
    expect(rep(exp("gesamt", gesamtRows), tageVoll).bereinigt.count + 3).toBe(b.bereinigt.count);
    // der Kontroll-Export `leer` führt die Zeile ebenfalls, ohne dass die Kontrolle anschlägt
    const mitKontrolle = rep(exp("gesamt", [...gesamtRows, synth]), tageVoll, leerVon([...gesamtRows, synth], { count: 42, tokens: 0 }));
    expect(mitKontrolle.luecken.join("\n")).not.toMatch(/Kontrolle leere Hook-Generations/);
  });
  test("Determinismus: vertauschte Export- und Zeilenreihenfolge ergibt dieselbe Ausgabe", () => {
    const a = rep(...basis, ...alleRollen, ...alleEfforts);
    const rev = (e: { data: unknown[] }) => ({ ...e, data: [...e.data].reverse() });
    const b = rep(...[...basis, ...alleRollen, ...alleEfforts].reverse().map((e) => rev(e as { data: unknown[] })));
    expect(L.renderMarkdown(b)).toBe(L.renderMarkdown(a));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

describe("Rezept mit Projektfilter (factory#313)", () => {
  const TAGS = { column: "tags", operator: "any of", value: ["factory"], type: "arrayOptions" };
  const ENV = { column: "environment", operator: "=", value: "proj", type: "string" };
  test("ohne projektFilter bleibt die Ausgabe unverändert, mit Filter trägt jede Abfrage ihn und der Leser nimmt sie an", () => {
    const ohne = L.rezept({ von: VON, bis: BIS });
    for (const r of ohne) expect(r.abfrage.filters?.some((f: { column: string }) => f.column === "tags" || f.column === "environment")).toBe(false);
    for (const pf of [TAGS, ENV]) {
      const mit = L.rezept({ von: VON, bis: BIS, projektFilter: pf });
      expect(mit).toHaveLength(ohne.length);
      for (const r of mit) {
        expect(r.abfrage.filters).toContainEqual(pf);
        expect(() => lese({ art: r.art, abfrage: r.abfrage, data: [] })).not.toThrow();
      }
    }
  });
  test("ein ungültiger Filter wirft (stringObject, falscher Operator, leerer Wert, leere Liste, kein Objekt)", () => {
    const schlecht = [{ column: "metadata", key: "k", operator: "=", value: "v", type: "stringObject" }, { ...ENV, operator: "<>" }, { ...ENV, value: "" }, { ...TAGS, value: [] }, { ...TAGS, value: [""] }, "x", { ...TAGS, type: "string" }, { ...ENV, type: "arrayOptions" }, { ...ENV, value: 5 }, { ...TAGS, operator: "=" }, { ...TAGS, value: [5] }, { ...TAGS, value: "x" }];
    for (const pf of schlecht) expect(() => L.rezept({ von: VON, bis: BIS, projektFilter: pf })).toThrow(/projektFilter/);
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
  test("EFFORT_STUFEN gleicht der Quelle (die Lib importiert sie bewusst nicht); TRACE_NAME_ABGLEICH ist das importierte TRACE_NAME", () => {
    expect(L.EFFORT_STUFEN).toEqual(EFFORT_TRANSKRIPT);
    expect(L.TRACE_NAME_ABGLEICH).toBe(TRACE_NAME_OTLP);
  });
  test("die Import-Hülle von langfuse-otlp enthält weder langfuse-api noch langfuse-zugang", () => {
    const h = importHuelle("scripts/langfuse-otlp.mjs", (p) => readFileSync(p, "utf8"));
    expect(h).not.toContain("scripts/langfuse-api.mjs");
    expect(h).not.toContain("scripts/langfuse-zugang.mjs");
  });
});

describe("Wächter Secret-Key (AK8)", () => {
  test("die Import-Hülle der CLI enthält weder langfuse-api noch langfuse-zugang, keinen Key und kein fetch", () => {
    const h = importHuelle("scripts/langfuse-auswertung.mjs", (p) => readFileSync(p, "utf8"));
    expect(h).toContain("scripts/langfuse-auswertung-lib.mjs");
    expect(h).not.toContain("scripts/langfuse-api.mjs");
    expect(h).not.toContain("scripts/langfuse-zugang.mjs");
    for (const f of h) expect(readFileSync(f, "utf8")).not.toMatch(/LANGFUSE_SECRET_KEY|fetch\(/);
  });
  test("die Lib importiert nur langfuse-otlp (pur)", () => {
    const imports = readFileSync("scripts/langfuse-auswertung-lib.mjs", "utf8").match(/^import .*$/gm) ?? [];
    expect(imports).toHaveLength(1);
    expect(imports[0]).toContain("./langfuse-otlp.mjs");
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
    expect(b.luecken.join("\n")).toMatch(/Rolle: Exporte nicht konsistent \(0 Zeile\(n\) mit Rest unter 0 oder Kosten ohne Calls, 1 Zelle\(n\) ohne Gegenstück/);
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
  test("das Rezept nimmt abweichende Effort- und Codex-Listen (Default-Parameter nicht vakuös)", () => {
    const r = L.rezept({ von: VON, bis: BIS, efforts: ["min"], codexRollen: ["solo"] }).filter((x) => x.art === "metadaten").map((x) => `${x.abfrage.filters?.[1]?.key}=${x.abfrage.filters?.[1]?.value}`);
    expect(r).toContain("effort=min");
    expect(r).toContain("agent_role=solo");
    expect(r).not.toContain("effort=high");
    expect(r).not.toContain("agent_role=main");
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
    const b = rep(exp("gesamt", [g(...R1, 1, 1), g("Claude Code Turn", "Subagent LLM Call", "claude-sonnet-5-5", "repoA", 2, 2)]), tageVoll, repoEx("repoA", [g(...R1, 1, 1, 3), g("Claude Code Turn", "Subagent LLM Call", "claude-sonnet-5-5", "repoA", 2, 2, 3)]));
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

describe("Funde Runde 1", () => {
  test("ein Rest ohne Calls und mit positivem Rundungsrauschen ist keine Lücke", () => {
    const b = rep(exp("gesamt", [g(...R1, 10, 5.0000000000001)]), tageVoll, exp("latenz", [g(...R1, 10, 5.0000000000001, 0)]), meta("agent_type", "Plan", [g(...R1, 10, 5, 3)]), meta("effort", "high", [g(...R1, 10, 5, 3)]), repoEx("repoA", [g(...R1, 10, 5, 3)]), leerVon([g(...R1, 10, 5)]));
    expect(b.luecken).toEqual([]);
    expect(b.unzugeordnet.count).toBe(0);
  });
  test("ein Rest ohne Calls, aber mit Kosten ist eine Lücke, nie still verloren", () => {
    const b = rep(...basis, meta("agent_type", "Plan", [g(...R1, 10, 4, 3)]));
    expect(b.luecken.join("\n")).toMatch(/Rolle: Exporte nicht konsistent \(1 Zeile\(n\) mit Rest unter 0 oder Kosten ohne Calls/);
  });
  test("die Quellen-Spalten der Rollen- und Effort-Tabelle trennen Live, Nachgeliefert und Codex (Zellen und Rest)", () => {
    const b = rep(...basis, ...alleRollen, ...alleEfforts);
    expect(b.rolle.zeilen.find((z) => z.name === "Plan")?.quellen).toEqual({ live: 5, nachgeliefert: 10 });
    expect(b.rolle.zeilen.find((z) => z.name === "agent_role:main")?.quellen).toEqual({ codex: 2 });
    expect(b.effort.zeilen.find((z) => z.name === "effort:high")?.quellen).toEqual({ live: 5, nachgeliefert: 10 });
    const r = rep(...basis, meta("agent_type", "Plan", [g(...R1, 4, 2, 3)]));
    expect(unzZeile(r.rolle).quellen).toEqual({ live: 3, nachgeliefert: 10, codex: 2 });
  });
  test("Effort-Lücken stehen im Bericht: kein Export, negative Zelle, nicht konsistent", () => {
    expect(rep(...basis, ...alleRollen).luecken).toContain("Effort: kein Metadaten-Export, nichts zugeordnet (alles unzugeordnet)");
    const neg = rep(...basis, ...alleRollen, meta("effort", "high", [g(...R1, 10, 5, -1), g(...R2, 20, 10, 3)]));
    expect(neg.luecken.join("\n")).toMatch(/Effort: 1 Gruppe\(n\) mit negativer Latenz in einer Metadaten-Zelle, 10 Calls \(5\.00 \$\)/);
    expect(rep(...basis, ...alleRollen, meta("effort", "high", [g(...R1, 11, 5, 3)])).luecken.join("\n")).toMatch(/Effort: Exporte nicht konsistent/);
    expect(rep(...basis, ...alleRollen, ...alleEfforts).luecken).toEqual([]);
  });
  test("Gleitkomma: die Summe der Zellen einer Gruppe hängt nicht von der Exportreihenfolge ab", () => {
    const gesamtF = exp("gesamt", [g(...R1, 3, 0.6)]);
    const latF = exp("latenz", [g(...R1, 3, 0.6, 0)]);
    const zellen = (reihe: string[]) => reihe.map((w, i) => meta("agent_type", w, [g(...R1, 1, [0.1, 0.2, 0.3][i], 3)]));
    const a = rep(gesamtF, tageVoll, latF, ...zellen(["A", "B", "C"]));
    const c = rep(gesamtF, tageVoll, latF, meta("agent_type", "C", [g(...R1, 1, 0.3, 3)]), meta("agent_type", "B", [g(...R1, 1, 0.2, 3)]), meta("agent_type", "A", [g(...R1, 1, 0.1, 3)]));
    expect(JSON.stringify(c)).toBe(JSON.stringify(a));
  });
  test("eine Gruppe mit negativer Latenz und eine Metadaten-Zelle derselben Gruppe ergeben keine falsche Lücke", () => {
    const b = rep(gesamt, tageVoll, exp("latenz", [g(...R1, 10, 5, 0), g(...R2, 20, 10, -5), g(...R3, 4, 2, 7)]), ...alleRollen);
    expect(b.luecken.join("\n")).not.toMatch(/nicht konsistent/);
    expect(b.rolle.summe).toEqual({ count: 14, cost: 7 });
  });
  test("Tage: der Fensterstart zählt mit seinem Tag, ein Zeitstempel mit Uhrzeit zählt als dieser Tag", () => {
    expect(L.tagesLuecken("2026-11-01T12:00:00Z", "2026-11-02T06:00:00Z", [])).toEqual(["2026-11-01", "2026-11-02"]);
    expect(L.tagesLuecken(VON, "2026-11-02T00:00:00Z", [{ time_dimension: "2026-11-01T00:00:00.000Z", count_count: 1 }])).toEqual([]);
  });
  test("fehlende Schlüssel (nicht nur null oder leer) für Modell und Umgebung sind unzugeordnet", () => {
    const b = rep(exp("gesamt", [{ traceName: "Abgleich", name: "Call", count_count: 2, sum_totalCost: 1 }]), tageVoll);
    expect(b.modell.zeilen[0]).toMatchObject({ name: "unzugeordnet", count: 2 });
    expect(b.repo.zeilen[0]).toMatchObject({ name: "ohne Repo-Tag", count: 2 });
  });
  test("ein null-Eintrag in den Filtern wirft keinen TypeError", () => {
    const so = { column: "metadata", key: "agent_type", operator: "=", value: "Plan", type: "stringObject" };
    expect(() => lese(exp("gesamt", gesamtRows, [null, FILTER]))).not.toThrow();
    expect(() => lese(exp("metadaten", [], [FILTER, null, so]))).not.toThrow();
  });
  test("das Rezept enthält keine Abfrage doppelt, auch wenn eine Rolle schon eingebaut ist", () => {
    const namen = L.rezept({ von: VON, bis: BIS, rollen: ["Plan", "hauptchat", "x", "x"] }).map((r) => r.name);
    expect(new Set(namen).size).toBe(namen.length);
  });
  test("Rezept und Leser passen zusammen: Zeilen genau der angefragten Dimensionen und Metriken ergeben einen vollständigen Bericht ohne Lücke", () => {
    const werte: Record<string, string> = { traceName: "Claude Code Turn", name: "LLM Call", providedModelName: "claude-sonnet-5-5", environment: "repoA" };
    const zeilen = (a: Abfr): Record<string, unknown>[] => {
      const z: Record<string, unknown> = {};
      for (const d of a.dimensions ?? []) z[d.field] = werte[d.field];
      for (const m of a.metrics ?? []) z[m.aggregation === "count" ? "count_count" : `${m.aggregation}_${m.measure}`] = m.measure === "count" ? 10 : m.measure === "totalCost" ? 5 : 3;
      if (!a.timeDimension) return [z];
      return ["2026-11-01", "2026-11-02", "2026-11-03"].map((t) => ({ ...z, time_dimension: t }));
    };
    const rez = L.rezept({ von: VON, bis: BIS, repoTags: ["repoA"] });
    const nimm = (art: string, key?: string, wert?: string) => rez.find((r) => r.art === art && (key === undefined || (r.abfrage.filters?.[1]?.key === key && r.abfrage.filters[1].value === wert)));
    const wahl = [nimm("gesamt"), nimm("tage"), nimm("latenz"), nimm("leer"), nimm("metadaten", "agent_type", "hauptchat"), nimm("metadaten", "effort", "high"), nimm("repo")];
    const b = L.bericht(wahl.map((r) => lese({ art: r?.art, abfrage: r?.abfrage, data: r ? zeilen(r.abfrage) : [] })));
    expect(nimm("tage")?.abfrage.dimensions).toEqual([]);
    expect(b.luecken).toEqual([]);
    expect(b.unzugeordnet).toEqual({ count: 0, cost: 0 });
    expect(b.rolle.zeilen[0]).toMatchObject({ name: "hauptchat", count: 10 });
    expect(b.repo.zeilen.map((z) => z.name)).toEqual(["repoA"]);
  });
});

describe("Repo-Tag (factory#523)", () => {
  const ohneTag = ["Claude Code Turn", "LLM Call", "claude-haiku-5", "repoA"] as const; // environment gleich Repo-Name, aber ohne Repo-Tag
  test("Rezept: je Repo-Tag ein Export mit tags-Filter [Tag, project:Tag], Basis- und Leer-Filter, Dimensionen und Metriken; ohne repoTags keiner", () => {
    expect(L.rezept({ von: VON, bis: BIS }).some((r) => r.art === "repo")).toBe(false);
    const r = L.rezept({ von: VON, bis: BIS, repoTags: ["a", "b"] }).filter((x) => x.art === "repo");
    expect(r.map((x) => x.name)).toEqual(["repo a", "repo b"]);
    const f = r[0]?.abfrage.filters as unknown as { column: string; value: unknown }[];
    expect(f.at(-1)).toEqual({ column: "tags", operator: "any of", type: "arrayOptions", value: ["a", "project:a"] });
    expect(f.some((x) => x.column === "providedModelName")).toBe(true);
    expect(f.some((x) => x.column === "type")).toBe(true);
    expect(r[0]?.abfrage.dimensions?.map((d) => d.field)).toEqual(["traceName", "name", "providedModelName", "environment"]);
    expect(r[0]?.abfrage.metrics?.map((m) => m.measure)).toEqual(["count", "totalCost", "latency"]);
  });
  test("Rezept mit Projektfilter: der Repo-Export trägt beide tags-Filter und der Leser nimmt ihn an", () => {
    const pf = { column: "tags", operator: "any of", type: "arrayOptions", value: ["factory", "repoA", "project:repoA"] };
    const r = L.rezept({ von: VON, bis: BIS, projektFilter: pf, repoTags: ["repoA"] }).find((x) => x.art === "repo");
    expect(r?.abfrage.filters?.filter((x) => x.column === "tags")).toHaveLength(2);
    expect(() => lese({ art: "repo", abfrage: r?.abfrage, data: [] })).not.toThrow();
  });
  test("Leser: der Repo-Tag kommt aus dem tags-Filter, nicht aus name; ohne passenden oder mit mehreren Filtern ist es ein Formfehler", () => {
    expect(() => lese({ ...repoA, name: undefined })).not.toThrow();
    expect(rep(...basis.filter((e) => e !== repoA), { ...repoA, name: "egal" }).repo.zeilen.map((z) => z.name)).toContain("repoA");
    const mit = (filters: unknown[]) => ({ ...repoA, abfrage: { ...repoA.abfrage, filters } });
    const tags = (value: string[]) => ({ column: "tags", operator: "any of", type: "arrayOptions", value });
    expect(() => lese(mit([FILTER, LEER_FILTER]))).toThrow(/genau einen Filter tags any of/);
    expect(() => lese(mit([FILTER, LEER_FILTER, tags(["repoA"])]))).toThrow(/genau einen Filter tags any of/);
    expect(() => lese(mit([FILTER, LEER_FILTER, tags(["repoA", "project:anderes"])]))).toThrow(/genau einen Filter/);
    expect(() => lese(mit([FILTER, LEER_FILTER, tags(["repoA", "project:repoA"]), tags(["repoB", "project:repoB"])]))).toThrow(/genau einen Filter/);
    expect(() => lese(mit([FILTER, LEER_FILTER, tags(["factory", "repoA", "project:repoA"]), tags(["repoA", "project:repoA"])]))).not.toThrow();
    expect(() => lese(mit([FILTER, LEER_FILTER, { ...tags(["repoA", "project:repoA"]), operator: "none of" }]))).toThrow(/genau einen Filter/);
    expect(() => lese(mit([FILTER, LEER_FILTER, tags(["repoA", "project:repoA", "x"])]))).toThrow(/genau einen Filter/);
    expect(() => lese(mit([FILTER, LEER_FILTER, tags(["", "project:"])]))).toThrow(/genau einen Filter/);
    expect(() => lese(mit([FILTER, LEER_FILTER, tags(["repoA", "project:repoA"]), tags(["repoA", "project:repoA"])]))).not.toThrow(); // derselbe Tag zweimal ist kein Widerspruch
  });
  test("zwei Exporte desselben Repo-Tags sind mehrfach, verschiedene Tags nicht", () => {
    expect(() => rep(...basis, repoA)).toThrow(/Export repo repo=repoA mehrfach/);
    expect(() => rep(...basis)).not.toThrow();
  });
  test("Repo kommt aus dem Repo-Tag: eine Generation ohne Tag steht als Lücke „ohne Repo-Tag“ mit Anzahl, Kosten und Grund, nie unter einem Repo", () => {
    const b = rep(exp("gesamt", [...gesamtRows, g(...ohneTag, 3, 1.5)]), tageVoll, repoA, repoB);
    expect(b.repo.zeilen.map((z) => [z.name, z.count, z.cost])).toEqual([["repoA", 30, 15], ["repoB", 4, 2], ["ohne Repo-Tag", 3, 1.5]]);
    expect(unzZeile(b.repo).name).toBe("ohne Repo-Tag");
    const l = b.luecken.find((x) => x.startsWith("ohne Repo-Tag:"));
    expect(l).toContain("3 Calls, 1.50 $");
    expect(l).toContain("Session außerhalb eines Repos");
    expect(l).toContain("CC_LANGFUSE_TRACE_TAGS");
    expect(l).toContain("Daten vor dem Eintrag des Repo-Tags"); // der Kern trägt kein festes Datum
    expect(l).not.toContain("Stichtag");
    expect(b.luecken.filter((x) => x.startsWith("Repo:"))).toEqual([]);
    expect(L.renderMarkdown(b)).toContain("| ohne Repo-Tag | 3 |");
  });
  test("ohne Repo-Export: alle Calls ohne Repo-Tag mit Grund, keine Repo-Zeile außer der Lücke", () => {
    const b = rep(...basis.filter((e) => e.art !== "repo"));
    expect(b.repo.zeilen.map((z) => [z.name, z.count])).toEqual([["ohne Repo-Tag", 34]]);
    expect(b.luecken.find((x) => x.startsWith("ohne Repo-Tag:"))).toContain("34 Calls, 17.00 $ (Grund: kein Repo-Export");
    expect(b.luecken.filter((x) => /Repo/.test(x))).toHaveLength(1); // keine zweite Lücke „kein Metadaten-Export“
  });
  test("Kosten null (ohne Preis) in der Lücke: „Lücke: ohne Preis“ bzw. „mindestens“, nie 0 $", () => {
    const b = rep(exp("gesamt", [...gesamtRows, { ...g(...ohneTag, 3, 0), sum_totalCost: null }]), tageVoll, repoA, repoB);
    const l = b.luecken.find((x) => x.startsWith("ohne Repo-Tag:")) ?? "";
    expect(l).toContain("Lücke: ohne Preis (claude-haiku-5)");
    expect(l).not.toContain("0.00 $");
    expect(L.renderMarkdown(b)).toMatch(/\| ohne Repo-Tag \| 3 \|.*Lücke: ohne Preis/);
  });
  test("Mehrfachzuordnung (Generation mit zwei Repo-Tags) ist „Exporte nicht konsistent“, kein negatives Repo", () => {
    const b = rep(...basis, repoEx("repoC", [g(...R3, 4, 2, 7)]));
    expect(b.luecken.join("\n")).toMatch(/Repo: Exporte nicht konsistent/);
    expect(b.repo.zeilen.every((z) => z.count >= 0 && z.cost >= 0)).toBe(true);
  });
  test("ein Repo-Tag mit dem Wortlaut unbekannt ist ein Repo, nie „unzugeordnet“", () => {
    const b = rep(...basis.filter((e) => e !== repoA), repoEx("unbekannt", [g(...R1, 10, 5, 3), g(...R2, 20, 10, 3)]));
    expect(b.repo.zeilen.map((z) => z.name)).toContain("unbekannt");
    expect(b.repo.davon.unbekannt.count).toBe(0);
  });
  test("genau ein Call ohne Repo-Tag ist schon eine Lücke (Grenze 0/1)", () => {
    const b = rep(exp("gesamt", [...gesamtRows, g(...ohneTag, 1, 0.5)]), tageVoll, repoA, repoB);
    expect(b.luecken.find((x) => x.startsWith("ohne Repo-Tag:"))).toContain("1 Calls, 0.50 $");
  });
  test("ohne Calls ohne Repo-Tag: keine Zeile und keine Lücke", () => {
    const b = rep(...basis);
    expect(b.repo.zeilen.some((z) => z.name === "ohne Repo-Tag")).toBe(false);
    expect(b.luecken.some((x) => x.startsWith("ohne Repo-Tag"))).toBe(false);
  });
  test("negative Latenz in einer Repo-Zelle macht die Gruppe zur Lücke, nicht zum Repo", () => {
    const b = rep(...basis.filter((e) => e !== repoA), repoEx("repoA", [g(...R1, 10, 5, -1), g(...R2, 20, 10, 3)]));
    expect(b.luecken.join("\n")).toMatch(/Repo: 1 Gruppe\(n\) mit negativer Latenz/);
  });
});

describe("CLI", () => {
  const ordner: string[] = [];
  const neuerOrdner = () => {
    const d = mkdtempSync(join(tmpdir(), "auswertung-"));
    ordner.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
  });
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
    dateien["t.json"] = JSON.stringify(exp("tage", [{ time_dimension: "2026-11-01", count_count: 1 }]));
    const md = lauf(["--export", "g.json", "--export", "t.json"]);
    expect(md.exitCode).toBe(0);
    expect(md.text).toContain("## Datenlücken");
    expect(md.text).toContain("Tage ohne Daten: 2026-11-02, 2026-11-03");
    const js = lauf(["--export", "g.json", "--export", "t.json", "--json"]);
    expect((JSON.parse(js.text) as Bericht).roh).toEqual({ count: 34, cost: 17 });
  });
  test("--rezept liest die Agentennamen aus einem Agentenordner", () => {
    const dir = neuerOrdner();
    writeFileSync(join(dir, "a.md"), "---\nname: mein-agent\ndescription: x\n---\n");
    writeFileSync(join(dir, "b.txt"), "name: ignoriert\n");
    expect(agentenNamen(dir)).toEqual(["mein-agent"]);
    const r = C.auswerten(C.parseArgs(["--rezept", "--von", VON, "--bis", BIS, "--rolle", "extra", "--agenten", dir]));
    expect(r.exitCode).toBe(0);
    const werte = (JSON.parse(r.text) as { abfrage: Ex["abfrage"] }[]).map((x) => x.abfrage.filters?.[1]?.value);
    expect(werte).toEqual(expect.arrayContaining(["mein-agent", "extra"]));
  });
  test("--rezept enthält einen Export repo für das eigene Repo und je --repo-tag einen weiteren (factory#523)", () => {
    const namen = (argv: string[], deps: Record<string, unknown> = { repoName: "eigen" }) => (JSON.parse(C.auswerten(C.parseArgs(["--rezept", "--von", VON, "--bis", BIS, ...argv]), deps).text) as { art: string; name: string }[]).filter((x) => x.art === "repo").map((x) => x.name);
    expect(namen([])).toEqual(["repo eigen"]);
    expect(namen(["--repo-tag", "fremd", "--repo-tag", "eigen"])).toEqual(["repo eigen", "repo fremd"]);
  });
  test("--rezept ohne Injektion nimmt den Repo-Namen aus der Projekt-Config", () => {
    const r = JSON.parse(C.auswerten(C.parseArgs(["--rezept", "--von", VON, "--bis", BIS])).text) as { art: string; name: string }[];
    expect(r.filter((x) => x.art === "repo")).toHaveLength(1);
    const wurzel = fileURLToPath(new URL("../", import.meta.url));
    expect(r.find((x) => x.art === "repo")?.name).toBe(`repo ${repoNameRoh(ladeConfigRoh({ rootDir: wurzel }))}`);
  });
  test("rezept: bis allein, ungültige Zeiten, von gleich bis und ein fehlender Agentenordner sind Fehler", () => {
    erwarte(["--rezept", "--bis", BIS], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", "kaputt", "--bis", BIS], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", VON, "--bis", "kaputt"], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", VON, "--bis", VON], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", "2026", "--bis", "2026-03-01T00:00Z"], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", "2026-02-30T00:00Z", "--bis", "2026-04-01T00:00Z"], 2, "--rezept braucht");
    erwarte(["--rezept", "--von", "2026-02-01T00:00Z", "--bis", "2026-02-30T00:00Z"], 2, "--rezept braucht");
    const r = lauf(["--rezept", "--von", VON, "--bis", BIS, "--agenten", join(tmpdir(), "gibt-es-nicht-289")]);
    expect(r.exitCode).toBe(1);
    expect(r.text).toContain("Fehler:");
  });
  test("Agentenname: nur eine ganze Zeile name: <wort> zählt (kein Mittendrin, kein Mehrwort)", () => {
    const dir = neuerOrdner();
    writeFileSync(join(dir, "a.md"), "---\ndescription: x name: falsch\nname: richtig\n---\n");
    writeFileSync(join(dir, "b.md"), "---\nname: zwei woerter\n---\n");
    writeFileSync(join(dir, "c.md"), "---\nname:ohneleerzeichen\n---\n");
    writeFileSync(join(dir, "d.md"), "---\nname:   mitplatz   \n---\n");
    writeFileSync(join(dir, "e.md"), "---\nname:\n---\n");
    writeFileSync(join(dir, "f.md"), "---\r\nname: windows\r\n---\r\n");
    writeFileSync(join(dir, "g.md"), "---\nname:\tmittab\t\n---\n");
    writeFileSync(join(dir, "h.md"), "---\nname: \"gequotet\"\n---\n");
    writeFileSync(join(dir, "i.md"), "---\nname: 'einfach'\n---\n");
    writeFileSync(join(dir, "j.md"), "---\nname: it's\n---\n");
    writeFileSync(join(dir, "k.md"), "---\nname: a\"b\n---\n");
    expect(agentenNamen(dir)).toEqual(["a\"b", "einfach", "gequotet", "it's", "mitplatz", "mittab", "ohneleerzeichen", "richtig", "windows"]);
  });
  test("der Standard-Agentenordner ist .claude/agents des Repos und enthält Agenten", () => {
    const a = C.parseArgs([]) as { agenten: string };
    expect(isAbsolute(a.agenten)).toBe(true);
    expect(a.agenten).toMatch(/\.claude[\\/]agents$/);
    expect(agentenNamen(a.agenten).length).toBeGreaterThan(0);
  });
  test("agentenNamen nimmt eingespeiste Leser", () => {
    expect(agentenNamen("/x", { lies: () => "name: eingespeist\n", liste: () => ["a.md", "b.txt"] })).toEqual(["eingespeist"]);
  });
  test("eine Agentendatei ohne name wird übersprungen", () => {
    const dir = neuerOrdner();
    writeFileSync(join(dir, "ohne.md"), "---\ndescription: x\n---\n");
    writeFileSync(join(dir, "mit.md"), "---\nname: a\n---\n");
    expect(agentenNamen(dir)).toEqual(["a"]);
  });
  test("ohne eingespeiste Leser liest die CLI die echte Datei", () => {
    const dir = neuerOrdner();
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

describe("Leere Hook-Generations (factory#522)", () => {
  const rez = L.rezept({ von: VON, bis: BIS });
  const filtersVon = (r: { abfrage: Abfr }) => r.abfrage.filters ?? [];
  test("AK1: jede Kosten- und Zähl-Abfrage schließt das Modell claude aus, genau ein Export leer zählt es", () => {
    for (const r of rez.filter((x) => x.art !== "leer")) expect(filtersVon(r), `${r.art} ${r.name}`).toContainEqual(LEER_FILTER);
    const leer = rez.filter((r) => r.art === "leer");
    expect(leer).toHaveLength(1);
    expect(leer[0].abfrage.dimensions).toEqual([{ field: "providedModelName" }]);
    expect(leer[0].abfrage.metrics).toEqual([{ measure: "count", aggregation: "count" }, { measure: "totalCost", aggregation: "sum" }, { measure: "totalTokens", aggregation: "sum" }]);
    expect(filtersVon(leer[0]).some((f) => f.column === "providedModelName")).toBe(false);
    expect(filtersVon(leer[0])).toContainEqual(FILTER);
  });
  test("der Projektfilter hängt auch am Export leer", () => {
    const pf = { column: "environment", operator: "=", value: "repoA", type: "string" };
    const mit = L.rezept({ von: VON, bis: BIS, projektFilter: pf });
    expect(filtersVon(mit.find((r) => r.art === "leer")!)).toContainEqual(pf);
  });
  test("ein Export ohne den Filter (alter Export) ist ein Formfehler, jede Art", () => {
    const roh = (art: string) => ({ art, abfrage: { view: "observations", filters: [FILTER, { column: "metadata", key: "agent_type", operator: "=", value: "Plan", type: "stringObject" }], fromTimestamp: VON, toTimestamp: BIS }, data: [] });
    for (const art of ["gesamt", "tage", "latenz", "metadaten"]) expect(() => lese(roh(art)), art).toThrow(/Filter providedModelName none of \[claude\] fehlt/);
    const falsch = { ...exp("gesamt", gesamtRows), abfrage: { ...exp("gesamt", gesamtRows).abfrage, filters: [FILTER, { ...LEER_FILTER, value: ["gpt"] }] } };
    expect(() => lese(falsch)).toThrow(/none of \[claude\] fehlt/);
  });
  test("der Export leer braucht die Dimension providedModelName und darf nicht auf das Modell filtern", () => {
    const ok = leerVon(gesamtRows);
    expect(() => lese(ok)).not.toThrow();
    expect(() => lese({ ...ok, abfrage: { ...ok.abfrage, dimensions: [] } })).toThrow(/Dimension providedModelName/);
    expect(() => lese({ ...ok, abfrage: { ...ok.abfrage, filters: [FILTER, LEER_FILTER] } })).toThrow(/keinen Filter auf providedModelName/);
  });
  test("leer-Zeilen: fehlende oder nicht numerische Metriken sind ein Formfehler, Tokens null zählen 0", () => {
    const mit = (z: object) => ({ ...leerVon(gesamtRows), data: [z] });
    const gut = { providedModelName: "claude", count_count: 3, sum_totalCost: null, sum_totalTokens: null };
    expect(() => lese(mit(gut))).not.toThrow();
    for (const kaputt of [{ count_count: "x" }, { count_count: undefined }, { sum_totalTokens: undefined }, { sum_totalCost: "viel" }]) expect(() => lese(mit({ ...gut, ...kaputt }))).toThrow(/ohne numerische Metriken count_count, sum_totalCost und sum_totalTokens/);
    expect(() => lese({ ...leerVon(gesamtRows), data: Array.from({ length: L.ROW_LIMIT }, () => gut) })).toThrow(/abgeschnitten/);
  });
  test("AK1: die Zeile nennt n, nie in Summen, Rollen- oder Modell-Tabellen", () => {
    const b = rep(...basis, ...alleRollen, ...alleEfforts);
    expect(b.leer).toEqual({ count: 42 });
    const md = L.renderMarkdown(b);
    expect(md).toContain("leere Hook-Generations: 42 (nicht gezählt)");
    expect(md.split("\n").findIndex((z) => z.startsWith("leere Hook-Generations"))).toBe(md.split("\n").findIndex((z) => z.startsWith("Gesamt")) + 1);
    expect(b.roh).toEqual({ count: 34, cost: 17 });
    for (const t of [b.modell, b.rolle, b.quelle, b.repo, b.effort]) expect(t.zeilen.map((z) => z.name)).not.toContain("claude");
    expect(b.luecken).toEqual([]);
  });
  test("ohne Export leer: „nicht geprüft“ in der Zeile und als Datenlücke, nie eine stille 0", () => {
    const b = rep(gesamt, tageVoll, latenzOk);
    expect(b.leer).toBeNull();
    expect(L.renderMarkdown(b)).toContain("leere Hook-Generations: nicht geprüft (Export leer fehlt)");
    expect(b.luecken).toContain("leere Hook-Generations: nicht geprüft (Export leer fehlt)");
  });
  test("AK5 Negativfall: Modell claude mit Tokens über 0 wird nicht still gefiltert, sondern Datenlücke, und zählt nicht als leer", () => {
    const b = rep(gesamt, tageVoll, latenzOk, leerVon(gesamtRows, { count: 7, tokens: 500 }));
    expect(b.leer).toEqual({ count: 0 });
    expect(b.luecken).toContain("Modell claude mit Usage: 7 Calls, 500 Tokens (nicht in Summen, keine leeren Hook-Generations)");
    expect(L.renderMarkdown(b)).toContain("- Modell claude mit Usage: 7 Calls");
    const gemischt = { ...leerVon(gesamtRows), data: [...leerVon(gesamtRows).data, { providedModelName: "claude", count_count: 5, sum_totalCost: 0, sum_totalTokens: 0 }, { providedModelName: "claude", count_count: 2, sum_totalCost: 0, sum_totalTokens: 9 }] };
    expect(rep(gesamt, tageVoll, gemischt).leer).toEqual({ count: 5 });
  });
  test("AK5: eine echte Generation ohne Modell bleibt unzugeordnet (Summe und Modell-Tabelle), claude nie", () => {
    const ohneModell = g("Claude Code Turn", "LLM Call", null, "repoA", 6, 3);
    const rows = [...gesamtRows, ohneModell];
    const b = rep(exp("gesamt", rows), tageVoll, leerVon(rows, { count: 4, tokens: 0 }));
    expect(unzZeile(b.modell)).toMatchObject({ name: "unzugeordnet", count: 6 });
    expect(b.bereinigt.count).toBe(40);
    expect(b.leer).toEqual({ count: 4 });
    expect(b.luecken.join("\n")).not.toMatch(/claude|Kontrolle/);
  });
  test("Kontrolle: schließt der Filter Generations still aus (gesamt führt weniger Calls als der Export leer ohne claude), steht die Differenz als Datenlücke", () => {
    const b = rep(gesamt, tageVoll, latenzOk, leerVon([...gesamtRows, g("X", "Y", null, "repoA", 9, 1)], { count: 3, tokens: 0 }));
    expect(b.luecken.join("\n")).toMatch(/Kontrolle leere Hook-Generations: Export leer führt 43 Calls ohne Modell claude, gesamt 34 \(Differenz -9/);
    expect(b.leer).toEqual({ count: 3 });
  });
  test("claude mit Tokens 0 und Kosten null ist gültig und zählt als leer", () => {
    const ex = { ...leerVon(gesamtRows), data: [...leerVon(gesamtRows).data, { providedModelName: "claude", count_count: 11, sum_totalCost: null, sum_totalTokens: 0 }] };
    expect(rep(gesamt, tageVoll, latenzOk, ex).leer).toEqual({ count: 11 });
  });
});

describe("Preislücke (factory#522, AK4)", () => {
  const ohnePreis = (r: ReturnType<typeof g>): ReturnType<typeof g> => ({ ...r, sum_totalCost: null as unknown as number });
  const mitLeer = (rows: ReturnType<typeof g>[]) => [exp("gesamt", rows), tageVoll, leerVon(rows)];
  test("betrag: mit Preis die Zahl, komplett ohne Preis die Lücke, gemischt „mindestens“", () => {
    expect(L.betrag({ cost: 5, count: 3 })).toBe("5.00 $");
    expect(L.betrag({ cost: 0, count: 3, ohnePreis: 3, modelle: ["a", "b"] })).toBe("Lücke: ohne Preis (a, b)");
    expect(L.betrag({ cost: 1.234, count: 5, ohnePreis: 3, modelle: ["a"] })).toBe("mindestens 1.23 $, ohne 3 Calls");
    expect(L.betrag({ cost: 0, count: 0 })).toBe("0.00 $");
  });
  test("eine Basisgruppe ohne Preis: Modell-Zelle und Quell-Spalte zeigen die Lücke, nie 0.00 $", () => {
    const b = rep(...mitLeer([g(...R1, 10, 5), ohnePreis(g(...R2, 3, 0))]));
    const md = L.renderMarkdown(b);
    const zeile = md.split("\n").find((z) => z.startsWith("| claude-opus-5-5 |"))!;
    expect(zeile).toBe("| claude-opus-5-5 | 3 | 0.00 $ | Lücke: ohne Preis (claude-opus-5-5) | 0.00 $ | 0.00 $ | Lücke: ohne Preis (claude-opus-5-5) |");
    expect(b.luecken).toContain("Kosten unvollständig: 3 Calls in 1 Gruppen ohne Preis (claude-opus-5-5)");
  });
  test("gemischte Gesamtsumme: „mindestens x $, ohne k Calls“ in roh und bereinigt", () => {
    const md = L.renderMarkdown(rep(...mitLeer([g(...R1, 10, 5), ohnePreis(g(...R2, 3, 0))])));
    expect(md).toContain("Gesamt: roh mindestens 5.00 $, ohne 3 Calls (13 Calls), bereinigt mindestens 5.00 $, ohne 3 Calls (13 Calls;");
  });
  test("eine Zeile mit beiden Gruppen desselben Modells: mindestens-Form in der Σ-Zelle", () => {
    const md = L.renderMarkdown(rep(...mitLeer([g(...R1, 10, 5), ohnePreis(g("Fremd", "Call", "claude-sonnet-5-5", "repoA", 2, 0))])));
    expect(md).toContain("| claude-sonnet-5-5 | 12 |");
    expect(md).toContain("mindestens 5.00 $, ohne 2 Calls |");
  });
  test("zwei Gruppen derselben Zeile, die erste ohne Preis: die Zahl der Calls ohne Preis geht nicht verloren (Merge in teile)", () => {
    const b = rep(...mitLeer([ohnePreis(g("Claude Code Turn", "LLM Call", "claude-sonnet-5-5", null, 4, 0)), g("Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "", 6, 3)]));
    expect(L.renderMarkdown(b)).toContain("bereinigt mindestens 3.00 $, ohne 4 Calls (10 Calls;");
  });
  test("Rolle: Zelle komplett ohne Preis und Rest mit Preis stehen getrennt", () => {
    const rows = [ohnePreis(g(...R1, 4, 0)), g(...R2, 20, 10)];
    const b = rep(exp("gesamt", rows), tageVoll, leerVon(rows), meta("agent_type", "Plan", [ohnePreis(g(...R1, 4, 0, 3))]));
    const md = L.renderMarkdown(b);
    expect(md).toContain("| Plan | 4 | Lücke: ohne Preis (claude-sonnet-5-5) |");
    expect(b.rolle.zeilen.find((z) => z.name === "unzugeordnet")).toMatchObject({ count: 20, cost: 10 });
  });
  test("Rest einer Gruppe mit Teilpreis nie unter 0 Calls ohne Preis", () => {
    const rows = [ohnePreis(g(...R1, 4, 0))];
    const b = rep(exp("gesamt", rows), tageVoll, leerVon(rows), meta("agent_type", "Plan", [ohnePreis(g(...R1, 4, 0, 3))]));
    expect(L.renderMarkdown(b)).not.toContain("NaN");
    expect(L.renderMarkdown(b)).not.toContain("ohne -");
  });
});

describe("Preislücke und Filter, Nachschärfung Runde 1 (factory#522)", () => {
  const ohnePreis = (r: ReturnType<typeof g>): ReturnType<typeof g> => ({ ...r, sum_totalCost: null as unknown as number });
  const mitLeer = (rows: ReturnType<typeof g>[]) => [exp("gesamt", rows), tageVoll, leerVon(rows)];
  test("AK4: „unzugeordnet“ und „Davon unzugeordnet“ nennen Calls ohne Preis als Untergrenze, bei komplett fehlendem Preis die Lücke, nie 0 $", () => {
    const rows = [g(...R1, 10, 5), ohnePreis(g("Claude Code Turn", "LLM Call", null, "repoA", 6, 0))];
    const md = L.renderMarkdown(rep(...mitLeer(rows)));
    expect(md).toContain("unzugeordnet: 16 Calls (mindestens 5.00 $, ohne 6 Calls) ohne Rolle oder ohne Modell.");
    expect(md).toMatch(/Davon unzugeordnet: unbekannt 0 Calls \(0\.00 \$\); ohne Schlüssel oder Wert ohne Export 16 Calls \(mindestens 5\.00 \$, ohne 6 Calls\)/);
    const nur = L.renderMarkdown(rep(...mitLeer([ohnePreis(g("Claude Code Turn", "LLM Call", null, "repoA", 6, 0))])));
    expect(nur).toContain("unzugeordnet: 6 Calls (Lücke: ohne Preis (unzugeordnet)) ohne Rolle oder ohne Modell.");
    expect(nur).not.toMatch(/unzugeordnet: 6 Calls \(0\.00 \$\)/);
  });
  test("Audit-Kopien und negative Latenz ohne Preis stehen in der Gesamtzeile als Untergrenze oder Lücke", () => {
    const rows = [g(...R1, 10, 5), ohnePreis(g("Abgleich", "[duplicate audit] Call", "claude-opus-5-5", "repoA", 4, 0))];
    expect(L.renderMarkdown(rep(...mitLeer(rows)))).toContain("ohne doppelte Audit-Markierungen 4 Calls Lücke: ohne Preis (claude-opus-5-5))");
  });
  test("Rest ohne Rollen-Zelle: Gruppe komplett ohne Preis ergibt in Rolle „unzugeordnet“ die Lücke, eine Zelle nimmt nur einen Teil", () => {
    const rows = [ohnePreis(g(...R1, 4, 0))];
    const ganz = rep(...mitLeer(rows));
    expect(L.renderMarkdown(ganz)).toContain("| unzugeordnet | 4 | Lücke: ohne Preis (claude-sonnet-5-5) |");
    const teil = rep(exp("gesamt", rows), tageVoll, leerVon(rows), meta("agent_type", "Plan", [ohnePreis(g(...R1, 1, 0, 3))]));
    const md = L.renderMarkdown(teil);
    expect(md).toContain("| Plan | 1 | Lücke: ohne Preis (claude-sonnet-5-5) |");
    expect(md).toContain("| unzugeordnet | 3 | Lücke: ohne Preis (claude-sonnet-5-5) |");
  });
  test("Quell-Spalte: dasselbe Modell und dieselbe Quelle in zwei Repos addieren Preislücken (nicht nur die letzte Gruppe)", () => {
    const rows = [ohnePreis(g("Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "repoA", 2, 0)), g("Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "repoB", 3, 1.5)];
    const md = L.renderMarkdown(rep(...mitLeer(rows)));
    expect(md).toContain("| claude-sonnet-5-5 | 5 | mindestens 1.50 $, ohne 2 Calls |");
  });
  test("Formfehler: Filter any of statt none of, anderer Wert und Export leer mit falscher Dimension", () => {
    const mit = (f: unknown) => ({ ...gesamt, abfrage: { ...gesamt.abfrage, filters: [FILTER, f] } });
    expect(() => lese(mit({ ...LEER_FILTER, operator: "any of" }))).toThrow(/none of \[claude\] fehlt/);
    expect(() => lese(mit({ ...LEER_FILTER, value: ["claude-opus-5-5"] }))).toThrow(/none of \[claude\] fehlt/);
    const ok = leerVon(gesamtRows);
    expect(() => lese({ ...ok, abfrage: { ...ok.abfrage, dimensions: [{ field: "traceName" }] } })).toThrow(/Dimension providedModelName/);
  });
  test("leer-Zeile mit Tokens null zählt als leer (0 Tokens), nicht als Usage", () => {
    const ex = { ...leerVon(gesamtRows), data: [...leerVon(gesamtRows).data, { providedModelName: "claude", count_count: 3, sum_totalCost: null, sum_totalTokens: null }] };
    const b = rep(gesamt, tageVoll, latenzOk, ex);
    expect(b.leer).toEqual({ count: 3 });
    expect(b.luecken.join("\n")).not.toContain("mit Usage");
  });
});

describe("Preislücke in Gesamtzeile und Datenlücken, Nachschärfung Runde 2 (factory#522)", () => {
  const ohnePreis = (r: ReturnType<typeof g>): ReturnType<typeof g> => ({ ...r, sum_totalCost: null as unknown as number });
  test("negative Latenz ohne Preis: Gesamtzeile und Datenlücke zeigen die Lücke, nie 0.00 $", () => {
    const rows = [g(...R1, 10, 5), ohnePreis(g(...R2, 4, 0))];
    const b = rep(exp("gesamt", rows), tageVoll, leerVon(rows), exp("latenz", [g(...R1, 10, 5, 0), ohnePreis(g(...R2, 4, 0, -1))]));
    const md = L.renderMarkdown(b);
    expect(md).toContain("ohne negative Latenzen 4 Calls Lücke: ohne Preis (claude-opus-5-5),");
    expect(b.luecken.join("\n")).toContain("4 Calls (Lücke: ohne Preis (claude-opus-5-5)), aus allen Summen genommen");
    expect(b.luecken.join("\n")).not.toContain("(0.00 $)");
  });
  test("Rolle: Gruppe mit negativer Latenz in einer Metadaten-Zelle und ohne Preis: Datenlücke mit Lücke statt 0.00 $", () => {
    const rows = [ohnePreis(g(...R1, 4, 0)), g(...R2, 20, 10)];
    const b = rep(exp("gesamt", rows), tageVoll, leerVon(rows), meta("agent_type", "Plan", [ohnePreis(g(...R1, 4, 0, -1))]));
    expect(b.luecken.join("\n")).toContain("4 Calls (Lücke: ohne Preis (claude-sonnet-5-5)) aus den Summen genommen");
  });
  test("Davon unzugeordnet: Wert unbekannt ohne Preis zeigt die Lücke", () => {
    const rows = [ohnePreis(g(...R1, 4, 0))];
    const b = rep(exp("gesamt", rows), tageVoll, leerVon(rows), meta("agent_type", "unbekannt", [ohnePreis(g(...R1, 4, 0, 3))]));
    expect(L.renderMarkdown(b)).toContain("Davon unzugeordnet: unbekannt 4 Calls (Lücke: ohne Preis (claude-sonnet-5-5));");
  });
  test("Rest nach einer Zelle: die Calls ohne Preis der Zelle werden abgezogen, der Rest zeigt dann nur den $-Betrag", () => {
    const rows = [{ ...g(...R1, 10, 5), sum_totalCost: 5 }, ohnePreis(g("Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "repoB", 3, 0))];
    // Gesamtgruppe 1 (10 Calls, 5 $) und Gruppe 2 (3 ohne Preis) haben verschiedene Schlüssel; die Zelle nimmt nur Gruppe 2 vollständig.
    const b = rep(exp("gesamt", rows), tageVoll, leerVon(rows), meta("agent_type", "Plan", [ohnePreis(g("Claude Code Turn", "LLM Call", "claude-sonnet-5-5", "repoB", 3, 0, 3))]));
    const md = L.renderMarkdown(b);
    expect(md).toContain("| Plan | 3 | Lücke: ohne Preis (claude-sonnet-5-5) |");
    expect(md).toContain("| unzugeordnet | 10 | 5.00 $ |");
  });
});
