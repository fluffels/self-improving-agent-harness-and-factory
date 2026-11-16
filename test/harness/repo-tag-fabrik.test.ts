/* Repo-Tag-Wächter (factory#523): die Live-Generations der Fabrik tragen den Repo-Namen als Tag, weil die Auswertung Repos über diesen Tag
 * trennt (`environment` trennt Projekte nicht). Der Repo-Name kommt aus `.factory/projekt.json`, kein Literal im Test.
 * Nur im Factory-Repo (`env` der `.claude/settings.json` steht nicht im Besitz-Manifest; Bezieher prüft der Harness-Doctor).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawConfig from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawOtlp from "../../scripts/langfuse-otlp.mjs";

const { ladeProjektConfig, repoName } = rawConfig as unknown as { ladeProjektConfig: (o: { rootDir: string }) => unknown; repoName: (c: unknown) => string };
const { projektTagsAus } = rawOtlp as unknown as { projektTagsAus: (roh: unknown) => string[] };
const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

describe("Repo-Tag in CC_LANGFUSE_TRACE_TAGS der Fabrik", () => {
  test("enthält den Namensteil von repo aus der Projekt-Config", () => {
    const name = repoName(ladeProjektConfig({ rootDir: WURZEL }));
    const settings = JSON.parse(readFileSync(join(WURZEL, ".claude", "settings.json"), "utf8")) as { env?: Record<string, unknown> };
    expect(name).not.toBe("");
    expect(projektTagsAus(settings.env?.CC_LANGFUSE_TRACE_TAGS)).toContain(name);
  });
});
