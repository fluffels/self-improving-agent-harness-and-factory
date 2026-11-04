/* `ohneZugang()` in langfuse-abgleich.mjs und langfuse-nachliefern.mjs (factory#162 L19): der Hinweis baut seinen Factory-Link erst beim Aufruf,
 * der Modul-Import liest den Sync-Stand nicht (Muster `natives()` in sandbox-doctor.mjs). Die Probe zählt die Leseaufrufe von `liesSyncStand`. */
import { afterEach, describe, expect, test, vi } from "vitest";

const aufrufe = vi.hoisted(() => ({ n: 0 }));
vi.mock("../scripts/sync-stand-lib.mjs", async (original) => {
  const echt = await original<Record<string, (...a: unknown[]) => unknown>>();
  return { ...echt, liesSyncStand: (...a: unknown[]) => { aufrufe.n++; return echt.liesSyncStand(...a); } };
});

type Modul = { ohneZugang: () => string; OHNE_ZUGANG?: unknown };

describe.each(["../scripts/langfuse-abgleich.mjs", "../scripts/langfuse-nachliefern.mjs"])("%s", (pfad) => {
  afterEach(() => {
    vi.resetModules();
    aufrufe.n = 0;
  });

  test("der Import liest keinen Sync-Stand, erst der Aufruf von ohneZugang()", async () => {
    vi.resetModules();
    aufrufe.n = 0;
    const m = (await import(/* @vite-ignore */ pfad)) as Modul;
    expect(aufrufe.n).toBe(0);
    expect(m.OHNE_ZUGANG).toBeUndefined();
    const text = m.ohneZugang();
    expect(text).toContain("Kein Langfuse-Zugang");
    expect(aufrufe.n).toBeGreaterThan(0);
  });
});
