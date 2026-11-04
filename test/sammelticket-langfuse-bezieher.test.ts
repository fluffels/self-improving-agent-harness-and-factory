/* Sammelticket „Langfuse-Befunde (gesammelt)“ im Bezieher (factory#195, ADR 0031 Punkt 4): es entsteht im eigenen Repo auf dem eigenen Board, ohne Harness-Label.
 * Upstream (ohne Sync-Stand) behält Repo, Board und Label wie bisher (Negativfall). Technik wie test/sammelticket-anlegen.test.ts (Nähte von `main`). */
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sammelticket-anlegen.mjs";
import { FREMD } from "./support/fremd-config";
import { fixture } from "./support/tmp-fixture";

const FABRIK = "zz-org/zz-fabrik";
type Ziel = { rolle: string; repo: string; owner: string };
const X = raw as unknown as {
  zielFuerArt: (c: unknown, art: string, o?: { bezieher?: boolean }) => { label: string | null; ziel: Ziel | null };
  legeAn: (a: { repo: string; titel: string; body: string; harness: string | null }, api: (args: string[]) => unknown) => { number: number };
  main: (argv: string[], deps: Record<string, unknown>) => Promise<void>;
};
const lib = rawLib as unknown as { boardFuerRolle: (rolle: string) => { projectId: string } };
const fremd = { ...FREMD, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo: FABRIK } : b)) };

describe("zielFuerArt", () => {
  test("langfuse im Bezieher: eigenes Repo, Produkt-Board, kein Label", () => {
    expect(X.zielFuerArt(fremd, "langfuse", { bezieher: true })).toEqual({ label: null, ziel: { rolle: "produkt", repo: FREMD.repo, owner: FREMD.repo.split("/")[0] } });
  });

  test("langfuse upstream: wie sammelZiel (Repo des Factory-Boards, Harness-Label), auch mit fremdem Factory-Board", () => {
    expect(X.zielFuerArt(fremd, "langfuse")).toEqual({ label: FREMD.labels.harness, ziel: { rolle: "factory", repo: FABRIK, owner: "zz-org" } });
    expect(X.zielFuerArt(FREMD, "langfuse", { bezieher: false }).ziel?.repo).toBe(FREMD.repo);
  });

  test("harness und codequalitaet bleiben auch im Bezieher unverändert (Ziel der Fabrik bzw. kein Label, kein Ziel)", () => {
    expect(X.zielFuerArt(fremd, "harness", { bezieher: true }).ziel?.repo).toBe(FABRIK);
    expect(X.zielFuerArt(FREMD, "codequalitaet", { bezieher: true })).toEqual({ label: null, ziel: null });
  });

  test("ein Bezieher, dessen Boards das eigene Repo nicht führen, wirft mit Fix-Zeile", () => {
    const keins = { ...FREMD, boards: FREMD.boards.map((b) => ({ ...b, repo: FABRIK })) };
    expect(() => X.zielFuerArt(keins, "langfuse", { bezieher: true })).toThrow(/Fix:/);
  });
});

describe("legeAn ohne Label", () => {
  test("harness null: der POST trägt kein labels[], und es gibt keinen Label-Fehler", () => {
    const aufrufe: string[][] = [];
    const r = X.legeAn({ repo: "o/n", titel: "T", body: "B", harness: null }, (args) => (aufrufe.push(args), { number: 3, labels: [] }));
    expect(r.number).toBe(3);
    expect(aufrufe[0]?.join(" ")).not.toContain("labels[]");
  });

  test("mit Label bleibt es beim Label-Fehler, wenn das Ziel es verwirft", () => {
    expect(() => X.legeAn({ repo: "o/n", titel: "T", body: "B", harness: "area:x" }, () => ({ number: 3, labels: [] }))).toThrow(/ohne Label area:x/);
  });
});

describe("main langfuse (factory#195)", () => {
  const lauf = async (bezieher: boolean | { wurzel: string }) => {
    const angelegt: { repo: string; harness: string | null }[] = [];
    const boards: unknown[] = [];
    await X.main(["langfuse"], {
      ladeConfig: () => fremd,
      ...(typeof bezieher === "boolean" ? { bezieher } : { wurzel: bezieher.wurzel }),
      log: () => undefined,
      kontingent: () => undefined,
      findeVorhandenes: () => null,
      legeAn: (a: { repo: string; harness: string | null }) => (angelegt.push(a), { number: 9, node_id: "N9" }),
      addToBoardTodo: (board: unknown) => (boards.push(board), "ITEM"),
      loadItems: () => [],
      setPosition: () => undefined,
      schliesseWennDublette: () => false,
      sleep: () => Promise.resolve(),
    });
    return { angelegt, boards };
  };

  test("im Bezieher: legeAn bekommt das eigene Repo ohne Label, das Item kommt aufs Produkt-Board", async () => {
    const { angelegt, boards } = await lauf(true);
    expect(angelegt).toEqual([expect.objectContaining({ repo: FREMD.repo, harness: null })]);
    expect(boards).toEqual([lib.boardFuerRolle("produkt")]);
  });

  test("der Bezieher wird am Sync-Stand der Wurzel erkannt (ohne injiziertes bezieher)", async () => {
    const mit = await lauf({ wurzel: fixture({ ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1", repo: "f/q" } }) }) });
    expect(mit.angelegt).toEqual([expect.objectContaining({ repo: FREMD.repo, harness: null })]);
    const ohne = await lauf({ wurzel: fixture({}) });
    expect(ohne.angelegt).toEqual([expect.objectContaining({ repo: FABRIK })]);
  });

  test("kein Board führt das eigene Repo: ✖-Zeile und Exit 2 statt Stacktrace, nichts wird angelegt", async () => {
    const keins = { ...FREMD, boards: FREMD.boards.map((b) => ({ ...b, repo: FABRIK })) };
    const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ende = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`exit ${String(code)}`);
    }) as never);
    try {
      let angelegt = 0;
      await expect(X.main(["langfuse"], { ladeConfig: () => keins, bezieher: true, log: () => undefined, kontingent: () => undefined, legeAn: () => (angelegt++, { number: 1 }) })).rejects.toThrow("exit 2");
      expect(fehler.mock.calls.flat().join(" ")).toMatch(/^✖ Kein Board der Config führt das eigene Repo/);
      expect(angelegt).toBe(0);
    } finally {
      fehler.mockRestore();
      ende.mockRestore();
    }
  });

  test("Negativfall Upstream: das Repo des Factory-Boards, Harness-Label, Factory-Board", async () => {
    const { angelegt, boards } = await lauf(false);
    expect(angelegt).toEqual([expect.objectContaining({ repo: FABRIK, harness: FREMD.labels.harness })]);
    expect(boards).toEqual([lib.boardFuerRolle("factory")]);
    expect(lib.boardFuerRolle("produkt").projectId).not.toBe(lib.boardFuerRolle("factory").projectId);
  });
});
