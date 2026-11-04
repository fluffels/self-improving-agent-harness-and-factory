/* statusBody ohne `wurzel` (der Produktionsaufruf in fuehreStatusAus) liest den Sync-Stand der Repo-Wurzel (factory#157): der Sync-Stand wird hier nur für genau
 * diese Wurzel vorgetäuscht, jede andere Wurzel liest den echten. So scheitert der Test, wenn der Default von `wurzel` nicht an die Repo-Wurzel gebunden ist. */
import { describe, expect, test, vi } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
import * as raw from "../scripts/langfuse-takt.mjs";
const T = raw as unknown as { statusBody: (a: { vorgaenger: null; jetzt: string; repo?: string }) => string };

describe("statusBody: Standard-Wurzel", () => {
  test("ohne wurzel zählt der Sync-Stand der Repo-Wurzel: Link auf den Sync-Tag der Quelle", () => {
    const body = T.statusBody({ vorgaenger: null, jetzt: "2026-10-07T00:00:00Z", repo: "beispiel/bezieher" });
    expect(body).toContain("https://github.com/q/quelle/blob/v9.9.9/docs/model-routing.md#langfuse-status-überprüfen-1293");
    expect(body).not.toContain("beispiel/bezieher/blob");
  });
});
