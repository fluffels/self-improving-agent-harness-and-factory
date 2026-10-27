/* Die Board-I/O benutzt das übergebene Board (#1728): ein Factory-Aufruf darf nie das Produkt-Board treffen.
 * gh wird gemockt; geprüft werden die Argumente, die an `gh` gehen. */
import { beforeEach, describe, expect, test, vi } from "vitest";

const aufrufe: string[][] = [];
let seiten: unknown[] = [];
vi.mock("../scripts/gh-cli.mjs", async (orig) => {
  const echt = await orig<Record<string, unknown>>();
  return {
    ...echt,
    ghText: (args: string[]) => {
      aufrufe.push(args);
      const q = args.join(" ");
      if (q.includes("/items?")) return JSON.stringify(seiten);
      if (q.includes("addProjectV2ItemById")) return JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "ITEM_x" } } } });
      return "[]";
    },
  };
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";

type Board = { projectId: string; besitzer: string; nummer: number; statusFeldId: number | string; statusFeldNodeId: string; todoOptionId: string };
const L = rawLib as unknown as {
  boardFuerRolle: (r: string) => Board;
  loadItemPages: (b: Board) => unknown;
  setPosition: (b: Board, i: string, a: string | null) => void;
  addToBoardTodo: (b: Board, n: string, o?: { pauseMs?: number; schlafe?: (ms: number) => void; repo?: string }) => string;
  loadItems: (b: Board, o?: { repo?: string }) => { number: number; repo: string }[];
  zielRepo: (rolle: string) => string;
};
const produkt = L.boardFuerRolle("produkt");
const factory = L.boardFuerRolle("factory");
const ZIEL = L.zielRepo("factory");
const flach = () => aufrufe.map((a) => a.join(" ")).join("\n");

beforeEach(() => {
  aufrufe.length = 0;
});

describe("Board-I/O nutzt das übergebene Board", () => {
  test("loadItemPages: Pfad und fields kommen vom Factory-Board, nichts vom Produkt-Board", () => {
    L.loadItemPages(factory);
    const t = flach();
    expect(t).toContain(`/projectsV2/${factory.nummer}/items`);
    expect(t).toContain(`fields=${factory.statusFeldId}`);
    expect(t).not.toContain(`/projectsV2/${produkt.nummer}/items`);
    expect(t).not.toContain(`fields=${produkt.statusFeldId}`);
  });
  test("setPosition: projectId des Factory-Boards", () => {
    L.setPosition(factory, "ITEM_a", "ITEM_b");
    const t = flach();
    expect(t).toContain(`p=${factory.projectId}`);
    expect(t).not.toContain(produkt.projectId);
  });
  test("addToBoardTodo: projectId, Status-Feld und Todo-Option vom Factory-Board, richtig zugeordnet", () => {
    expect(L.addToBoardTodo(factory, "I_node", { repo: ZIEL })).toBe("ITEM_x");
    const t = flach();
    expect(t).toContain(`p=${factory.projectId}`);
    expect(t).toContain(`f=${factory.statusFeldNodeId}`);
    expect(t).toContain(`o=${factory.todoOptionId}`);
    for (const fremd of [produkt.projectId, produkt.statusFeldNodeId]) expect(t).not.toContain(fremd);
  });
  test("addToBoardTodo: mit pauseMs schläft es zwischen Aufnehmen und Status, ohne (Standard 0) nicht", () => {
    L.addToBoardTodo(factory, "I_node", { repo: ZIEL, pauseMs: 1000, schlafe: (ms) => void aufrufe.push(["schlafe", String(ms)]) });
    const namen = aufrufe.map((a) => (a[0] === "schlafe" ? `schlafe(${a[1]})` : a.join(" ").includes("addProjectV2ItemById") ? "add" : "status"));
    expect(namen).toEqual(["add", "schlafe(1000)", "status"]);
    aufrufe.length = 0;
    L.addToBoardTodo(factory, "I_node", { repo: ZIEL, schlafe: (ms) => void aufrufe.push(["schlafe", String(ms)]) });
    expect(aufrufe.some((a) => a[0] === "schlafe")).toBe(false);
  });
});

describe("repo ist Pflicht und das Board-Repo gilt (#76)", () => {
  test("addToBoardTodo ohne repo oder mit fremdem Repo wirft vor jedem gh-Aufruf", () => {
    expect(() => L.addToBoardTodo(factory, "I_node")).toThrow(/repo fehlt[^]*Fix:/);
    expect(() => L.addToBoardTodo(factory, "I_node", { repo: "zz-org/zz-fremd" })).toThrow(/führt die Issues von [^]*nicht die von zz-org.zz-fremd[^]*Fix:/);
    expect(aufrufe).toEqual([]);
  });
  test("loadItems ohne repo wirft vor jedem gh-Aufruf", () => {
    expect(() => L.loadItems(factory)).toThrow(/repo fehlt[^]*Fix:/);
    expect(() => L.loadItems(factory, { repo: "" })).toThrow(/repo fehlt/);
    expect(aufrufe).toEqual([]);
  });
  test("loadItems behält nur die Items des Repos: dieselbe Nummer aus zwei Repos ergibt ein Item", () => {
    const item = (nr: number, repo: string) => ({ content_type: "Issue", node_id: `PVTI_${nr}${repo}`, content: { number: nr, repository_url: `https://api.github.com/repos/${repo}` } });
    seiten = [[item(7, "zz-org/zz-eins"), item(7, "zz-org/zz-zwei"), item(8, "ZZ-ORG/ZZ-EINS")]];
    expect(L.loadItems(factory, { repo: "zz-org/zz-eins" }).map((i) => [i.number, i.repo])).toEqual([[7, "zz-org/zz-eins"], [8, "ZZ-ORG/ZZ-EINS"]]);
    expect(L.loadItems(factory, { repo: "zz-org/zz-zwei" }).map((i) => i.number)).toEqual([7]);
    seiten = [];
  });
});
