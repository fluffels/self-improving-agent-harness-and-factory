/**
 * Gemeinsamer Scan-Helfer der Text-Wächter (#1526): welche versionierten Dateien gibt es, was steht drin, und wie baut
 * man aus mehreren Mustern einen sicheren Vorfilter.
 * Reiner Helfer ohne eigenen Test-Marker (Präzedenz `hook-importe.ts`); liegt in test/harness/, damit eine Änderung
 * an der Scan-Logik eine Audit-Spur hinterlässt.
 *
 * Warum geteilt: `harness-approval`, `stop-verify-hook` und `playwright-mcp` scannten je mit eigener Mechanik
 * (`git ls-files` oder `readdirSync`, auch Ungetracktes), und jeder Wächter las ~770 Dateien (8 MB) neu. Unter
 * Parallellast riss das den 5-s-Timeout (#1508, #1526). Hier wird die Dateiliste und jeder Inhalt je Testdatei
 * (Modul-Instanz) einmal geladen. Nur versionierte Dateien zählen: die CI scannt ohnehin nur Versioniertes.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as leitplankenMuster from "../../scripts/leitplanken-muster.mjs";

// Begründete Ausnahme wie in test/harness/kern-verweise.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const scanDatei: (pfad: string) => boolean = leitplankenMuster.istScanDatei;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const listTrackedFiles: (rootDir?: string) => string[] = checkBasis.listTrackedFiles;

export const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

let dateienCache: string[] | undefined;
const inhaltCache = new Map<string, string>();

/** Alle versionierten Dateien (relativ, mit `/`), die auch auf der Platte liegen (gelöscht, aber noch im Index: nein). Einmal geladen. */
export function repoDateien(): string[] {
  dateienCache ??= listTrackedFiles(WURZEL).filter((f) => existsSync(WURZEL + f));
  return dateienCache;
}

/** Ordner der Workflow-Skripte (gleich `harness.workflows` in scripts/docs-gen/config.json, vom Test gehalten). */
export const WORKFLOW_ORDNER = ".claude/workflows";

/** Workflow-Skripte (`.js`/`.mjs`/`.ts`) unter `dir` (rekursiv, repo-relativ), nur versionierte; ohne den Ordner leer. */
export function workflowDateien(dir = WORKFLOW_ORDNER): string[] {
  return repoDateien().filter((f) => f.startsWith(dir + "/") && /\.(js|mjs|ts)$/.test(f));
}

/** Inhalt einer Datei (relativ zum Repo-Root), je Pfad einmal gelesen. */
export function lies(pfad: string): string {
  let text = inhaltCache.get(pfad);
  if (text === undefined) {
    text = readFileSync(WURZEL + pfad, "utf8");
    inhaltCache.set(pfad, text);
  }
  return text;
}

/**
 * Alle versionierten Textdateien im Agenten-Kontext (Pfad → Inhalt), die die Text-Wächter durchsuchen: Doku, Prompts, Skills,
 * Workflows, Hooks, Skripte, Wächter und jede `*.md`, nicht der Produktcode. Umfang und Scan-Endungen (`istScanDatei`) stehen in
 * scripts/leitplanken-muster.mjs, derselben Quelle wie der Doctor-Punkt `Leitplanken-Quelle`. Je Pfad einmal gelesen (gecachter Helfer).
 */
export function agentenKontextDateien(): Record<string, string> {
  const dateien: Record<string, string> = {};
  for (const f of repoDateien().filter(scanDatei)) dateien[f] = lies(f);
  return dateien;
}
