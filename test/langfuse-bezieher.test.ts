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
import { projektConfig } from "./support/fremd-config";
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

  test("die Verdichtungszeile gehört nur ins Factory-Repo, im Bezieher in den Bericht-Kommentar (die Seite ist Factory-Besitz)", () => {
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
