/* Langfuse im Bezieher: Status-Ticket und Sammelticket „Langfuse-Befunde (gesammelt)“ laufen im Bezieher ohne Projektwort der Quell-Config.
 * Geprüft gegen die echte Config der Quelle (`begriffeAus` samt `projektliterale` und `seitenliterale`; Owner, Repo, Board-ID, Label teilen sich Quelle und Ziel):
 * kein Treffer im Text. Links auf das Factory-Repo sind Herkunft und werden vorher maskiert (wie in test/harness/factory-seiten.test.ts).
 * Der Sync-Stand der Repo-Wurzel wird vorgetäuscht (Bezieher: Tag und Quelle), jede andere Wurzel liest den echten. */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test, vi } from "vitest";

const REPO_WURZEL = resolve(fileURLToPath(new URL("..", import.meta.url)));

vi.mock("../scripts/sync-stand-lib.mjs", async (original) => {
  const echt = await original<Record<string, unknown>>();
  return {
    ...echt,
    istBezieher: (wurzel: string) => resolve(wurzel) === REPO_WURZEL || (echt.istBezieher as (w: string) => boolean)(wurzel),
    liesSyncStand: (wurzel: string) =>
      resolve(wurzel) === REPO_WURZEL ? { stand: { quelle: { tag: "v9.9.9", repo: "q/quelle" } } } : (echt.liesSyncStand as (w: string) => unknown)(wurzel),
  };
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawStatus from "../scripts/langfuse-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSammel from "../scripts/sammelticket-anlegen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as langfuseZielRaw from "../scripts/projekt-config-lib.mjs";
import { FREMD, projektConfig } from "./support/fremd-config";
import { fixture } from "./support/tmp-fixture";

type Config = ReturnType<typeof projektConfig>;
const { begriffeAus } = rawBesitz as unknown as { begriffeAus: (c: Config) => Record<string, RegExp> };
const { statusBody } = rawStatus as unknown as { statusBody: (a: { vorgaenger: null; jetzt: string; repo: string; wurzel?: string }) => string };
const { sammelticketBody } = rawSammel as unknown as { sammelticketBody: (a: { art: string }) => string };

const GETEILT = new Set(["Owner", "Repo", "Board-ID", "Label"]);

/** Herkunftsbezüge raus (Markdown-Link mit http(s)-Ziel samt Linktext, nackte URL, `repo#nr`): sie dürfen auf das Factory-Repo zeigen. */
function maskiere(text: string): string {
  return text
    .replace(/\[[^\]\n]*\]\(<?https?:\/\/[^)\s>]*>?[^)\n]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:[\w.-]+\/)?[\w.-]+#\d+/g, " ");
}

/** Die Begriffe, die ein Bezieher-Text nie tragen darf: Präfixe, Agenten, Branch, Worktree, `projektliterale` und `seitenliterale` der Quell-Config. */
function verboten(config: Config): Record<string, RegExp> {
  const mitZusatz = { ...config, projektliterale: { ...config.projektliterale, ...config.seitenliterale } };
  return Object.fromEntries(Object.entries(begriffeAus(mitZusatz)).filter(([name]) => !GETEILT.has(name)));
}

/** Namen der Begriffe, die im maskierten Text treffen. */
function treffer(text: string, begriffe: Record<string, RegExp>): string[] {
  const m = maskiere(text);
  return Object.entries(begriffe).filter(([, re]) => new RegExp(re.source, re.flags).test(m)).map(([name]) => name);
}

/** Wurzel eines Beziehers: der Sync-Stand nennt Tag und Quell-Repo (Räumen übernimmt der Helfer). */
const bezieher = () => fixture({ ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1.2.3", repo: "fabrik/quelle" } }) });

describe("Langfuse-Tickets im Bezieher: ohne Projektwort", () => {
  const begriffe = verboten(projektConfig());
  const statusText = () => statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z", repo: "zz-org/bezieher", wurzel: bezieher() });
  const sammelText = () => sammelticketBody({ art: "langfuse" });

  test("die Begriffsliste ist nicht leer (sonst prüft der Test nichts)", () => {
    expect(Object.keys(begriffe).length).toBeGreaterThan(3);
  });

  test("Status-Ticket: kein Begriff der Quell-Config, die Links zeigen auf das Factory-Repo", () => {
    const status = statusText();
    expect(treffer(status, begriffe)).toEqual([]);
    expect(status).toContain("https://github.com/fabrik/quelle/blob/v1.2.3/docs/model-routing.md#langfuse-status-überprüfen-1293");
  });

  test("Sammelticket „Langfuse-Befunde“: kein Begriff der Quell-Config, Link auf die Factory-Seite", () => {
    const sammel = sammelText();
    expect(treffer(sammel, begriffe)).toEqual([]);
    expect(sammel).toContain("https://github.com/q/quelle/blob/v9.9.9/docs/ticket-reihenfolge.md#langfuse-befunde-gesammelt");
  });

  test("Probe des Prüfers: ein injiziertes Projektliteral wird gefunden, ein Link auf das Factory-Repo nicht", () => {
    const literal = Object.values(projektConfig().projektliterale ?? {})[0] ?? "";
    expect(literal).not.toBe("");
    expect(treffer(`${statusText()}\nUnser ${literal} läuft`, begriffe).length).toBeGreaterThan(0);
    expect(treffer(`[Seite](https://github.com/x/${literal}/blob/v1/docs/a.md)`, begriffe)).toEqual([]);
  });
});

describe("Prüfliste „Langfuse-Status überprüfen“ (docs/model-routing.md): bezieherfest", () => {
  const seite = readFileSync(join(REPO_WURZEL, "docs", "model-routing.md"), "utf8");
  const start = seite.indexOf("### Langfuse-Status überprüfen (#1293)");
  const ende = seite.indexOf("### Langfuse-Erfassung belegen");
  const liste = seite.slice(start, ende);
  /** Der Text vor der Verdichtungstabelle: Einleitung und Punkte 1 bis 11 samt Satz über die Verdichtungszeile. */
  const vorTabelle = liste.slice(0, liste.indexOf("| Zeitraum |"));

  test("Abschnitt gefunden", () => {
    expect(start).toBeGreaterThan(0);
    expect(ende).toBeGreaterThan(start);
  });

  test("die Verdichtungszeile gehört nur ins Factory-Repo, im Bezieher in den Bericht-Kommentar (die Seite liegt nur im Factory-Repo)", () => {
    expect(vorTabelle).not.toContain("hierher kommt je Lauf");
    expect(vorTabelle).toMatch(/im Factory-Repo hierher/);
    expect(vorTabelle).toMatch(/im Bezieher[^.]*nur in den Bericht-Kommentar/);
  });

  test("Labels stehen als Platzhalter, Quellprojekt-Zielwerte sind als Factory-Wert gekennzeichnet", () => {
    expect(vorTabelle).not.toMatch(/`area:harness`|`status:festgefahren`|--label status:festgefahren/);
    expect(vorTabelle).toContain("<labels.harness>");
    expect(vorTabelle).toContain("<labels.festgefahren>");
    expect(vorTabelle).toMatch(/1,38 \$ geschätzt \(Factory-Wert/);
    expect(vorTabelle).toMatch(/Factory-Vergleichswert[^.]*4,08/);
  });
});

// ── factory#195: Ziel (Repo, Board, Label), Body und CLI im Bezieher ──────────
const FABRIK = "zz-org/zz-fabrik";
/** Mit fremdem Factory-Board darf `labels.dependabotInbox` nicht das Harness-Label sein (Schema), darum ein eigenes. */
const mitFactoryRepo = (repo: string | undefined) => ({ ...FREMD, labels: repo ? { ...FREMD.labels, dependabotInbox: "bereich:zz-inbox" } : FREMD.labels, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo } : b)) });
const ZIEL = langfuseZielRaw as unknown as {
  langfuseZiel: (c: unknown, o?: { bezieher?: boolean }) => { rolle: string; repo: string; label: string | null };
  cli: (argv: string[], o: { rootDir: string; out: (s: string) => void; err: (s: string) => void }) => number;
};

describe("langfuseZiel (factory#195)", () => {
  const h = FREMD.labels.harness;
  test("Upstream mit eigenem Factory-Board: der heutige Wert (Factory-Board, eigenes Repo, Harness-Label)", () => {
    expect(ZIEL.langfuseZiel(mitFactoryRepo(undefined))).toEqual({ rolle: "factory", repo: FREMD.repo, label: h });
    expect(ZIEL.langfuseZiel(mitFactoryRepo(undefined), { bezieher: false })).toEqual({ rolle: "factory", repo: FREMD.repo, label: h });
  });
  test("Upstream mit fremdem Factory-Board: das fremde Repo mit Harness-Label (unverändert, auch wenn es ein Bezieher wäre, der Aufrufer entscheidet über bezieher)", () => {
    expect(ZIEL.langfuseZiel(mitFactoryRepo(FABRIK))).toEqual({ rolle: "factory", repo: FABRIK, label: h });
  });
  test("Bezieher mit fremdem Factory-Board: das eigene Repo auf dem Produkt-Board ohne Label", () => {
    expect(ZIEL.langfuseZiel(mitFactoryRepo(FABRIK), { bezieher: true })).toEqual({ rolle: "produkt", repo: FREMD.repo, label: null });
  });
  test("Bezieher mit Factory-Board im eigenen Repo (auch andere Schreibweise): factory mit Harness-Label", () => {
    expect(ZIEL.langfuseZiel(mitFactoryRepo(undefined), { bezieher: true })).toEqual({ rolle: "factory", repo: FREMD.repo, label: h });
    expect(ZIEL.langfuseZiel(mitFactoryRepo(FREMD.repo.toUpperCase()), { bezieher: true }).rolle).toBe("factory");
  });
  test("Bezieher, dessen Boards das eigene Repo nicht führen: wirft mit Fix-Zeile", () => {
    const keins = { ...FREMD, boards: FREMD.boards.map((b) => ({ ...b, repo: FABRIK })) };
    expect(() => ZIEL.langfuseZiel(keins, { bezieher: true })).toThrow(/Fix: ein Board in boards\[\] muss das eigene Repo führen/);
  });
});

describe("--langfuse-repo (factory#195)", () => {
  const SYNC = { ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1.2.3", repo: "fabrik/quelle" } }) };
  const lauf = (dateien: Record<string, string>, config: unknown, extra: string[] = []) => {
    const root = fixture({ ...dateien, "c.json": JSON.stringify(config) });
    const out: string[] = [];
    const err: string[] = [];
    const code = ZIEL.cli(["--config", join(root, "c.json"), "--langfuse-repo", ...extra], { rootDir: root, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out, err };
  };
  test("mit Sync-Stand das eigene Repo, auch bei fremdem Factory-Board", () => {
    expect(lauf(SYNC, mitFactoryRepo(FABRIK))).toEqual({ code: 0, out: [FREMD.repo], err: [] });
  });
  test("kaputter Sync-Stand zählt als Bezieher (fail-closed, factory#154)", () => {
    expect(lauf({ ".factory/sync-stand.json": "{ kein json" }, mitFactoryRepo(FABRIK))).toEqual({ code: 0, out: [FREMD.repo], err: [] });
  });
  test("ohne Sync-Stand (Upstream) dasselbe wie --ziel-repo <Harness-Label>", () => {
    const cfg = mitFactoryRepo(FABRIK);
    const r = lauf({}, cfg);
    expect(r.out).toEqual([FABRIK]);
    const ziel = fixture({ "c.json": JSON.stringify(cfg) });
    const gleich: string[] = [];
    ZIEL.cli(["--config", join(ziel, "c.json"), "--ziel-repo", FREMD.labels.harness], { rootDir: ziel, out: (s) => gleich.push(s), err: () => undefined });
    expect(r.out).toEqual(gleich);
  });
  test("nicht ladbare Config: Exit 1 mit ✖-Zeile, nichts auf stdout", () => {
    const root = fixture({});
    const out: string[] = [];
    const err: string[] = [];
    const code = ZIEL.cli(["--config", join(root, "gibt-es-nicht.json"), "--langfuse-repo"], { rootDir: root, out: (s) => out.push(s), err: (s) => err.push(s) });
    expect(code).toBe(1);
    expect(out).toEqual([]);
    expect(err[0]).toMatch(/^✖ /);
  });
  test("ein überzähliges Argument ist ein Aufruffehler (Exit 2)", () => {
    expect(lauf(SYNC, FREMD, ["x"]).code).toBe(2);
  });
});

describe("Body im Bezieher: Befund-Weg (factory#195, ADR 0031 Punkt 4)", () => {
  const bezieherStatus = () => statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z", repo: "zz-org/bezieher", wurzel: bezieher() });
  test("Harness-Befunde gehen erst durch check-internalrefs --text, dann über den Bezieher-Weg; Projekt-Befunde bleiben im eigenen Sammelticket", () => {
    const text = bezieherStatus();
    expect(text).toContain("node scripts/check-internalrefs.mjs --text");
    expect(text).toContain("Langfuse-Befunde (gesammelt)");
    expect(text).toContain("#langfuse-befunde-gesammelt");
    expect(text).toContain("node scripts/sammelticket-anlegen.mjs langfuse --top");
    expect(treffer(text, verboten(projektConfig()))).toEqual([]);
  });
  test("Negativfall Upstream: der Body ohne Sync-Stand nennt die Anonymitätsprüfung nicht und behält den bisherigen Abschluss", () => {
    const text = statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z", repo: "zz-org/upstream", wurzel: fixture({}) });
    expect(text).not.toContain("check-internalrefs");
    expect(text).toContain("per `board-place.mjs --top` nach oben");
  });
});
