/* ECHTE_PLACE_IO von board-place (#97 Runde 1, #101 L6a): die echte Verdrahtung reicht das Ziel-Repo und die Optionen an `gh` durch.
 * gh wird gemockt (`ghText` und `ghJson`); geprüft werden die Argumente, die an `gh` gehen, und die Ergebnisse der Methoden. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Aufruf = { args: string[]; opt: unknown };
const aufrufe: Aufruf[] = [];
let textAntwort: (q: string) => string = () => JSON.stringify({ data: { repository: { i0: null } } });
let jsonAntwort: (args: string[]) => unknown = () => ({});
vi.mock("../scripts/gh-cli.mjs", async (orig) => {
  const echt = await orig<Record<string, unknown>>();
  return {
    ...echt,
    ghText: (args: string[], opt?: unknown) => {
      aufrufe.push({ args, opt });
      return textAntwort(args.join(" "));
    },
    ghJson: (args: string[], opt?: unknown) => {
      aufrufe.push({ args, opt });
      return jsonAntwort(args);
    },
  };
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";

type Board = { projectId: string; statusFeldNodeId: string; todoOptionId: string };
const P = rawPlace as unknown as {
  ECHTE_PLACE_IO: {
    itemsUeberIssues: (b: unknown, n: number[], o: object, repo: string) => unknown[];
    loadItems: (b: unknown, o: { repo: string; token?: string }) => unknown[];
    ladeLabels: (nr: number, repo: string) => string[] | null;
    addToBoardTodo: (b: unknown, nodeId: string, o: object) => string;
    setPosition: (b: unknown, id: string, after: string | null) => void;
    entferneVomBoard: (b: unknown, id: string) => void;
    positionOderWarnung: unknown;
    schlafe: () => Promise<void>;
    log: (z: string) => void;
    warn: (z: string) => void;
  };
};
const L = rawLib as unknown as { boardFuerRolle: (r: string) => Board; zielRepo: (r: string) => string; positionOderWarnung: unknown };
const flach = () => aufrufe.map((a) => a.args.join(" ")).join("\n");

beforeEach(() => {
  aufrufe.length = 0;
  textAntwort = () => JSON.stringify({ data: { repository: { i0: null } } });
  jsonAntwort = () => ({});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("ECHTE_PLACE_IO.itemsUeberIssues (#97)", () => {
  test("das Ziel-Repo (4. Argument) steht in der GraphQL-Abfrage, nicht das eigene", () => {
    P.ECHTE_PLACE_IO.itemsUeberIssues(L.boardFuerRolle("factory"), [7], {}, "zz-org/ziel");
    const q = flach();
    expect(q).toContain('repository(owner:"zz-org"');
    expect(q).toContain('name:"ziel"');
  });
});

describe("ECHTE_PLACE_IO: die übrigen Methoden (#101 L6a)", () => {
  const factory = L.boardFuerRolle("factory");

  test("loadItems liest die Items des Boards (Seiten-Abruf auf das Board, Optionen unverändert), gefiltert aufs Repo", () => {
    textAntwort = () => "[[]]";
    expect(P.ECHTE_PLACE_IO.loadItems(factory, { repo: L.zielRepo("factory"), token: "t" })).toEqual([]);
    expect(aufrufe[0].opt).toEqual({ token: "t" });
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0].args.slice(0, 3)).toEqual(["api", "--paginate", "--slurp"]);
    expect(aufrufe[0].args[3]).toContain("/items?per_page=100");
  });
  test("ladeLabels: Namen aus Objekten und Strings; ein Ladefehler ergibt null statt eines Wurfs", () => {
    jsonAntwort = () => ({ labels: [{ name: "a" }, "b"] });
    expect(P.ECHTE_PLACE_IO.ladeLabels(7, "zz-org/ziel")).toEqual(["a", "b"]);
    expect(aufrufe[0].args).toEqual(["api", "repos/zz-org/ziel/issues/7"]);
    jsonAntwort = () => ({});
    expect(P.ECHTE_PLACE_IO.ladeLabels(7, "zz-org/ziel")).toEqual([]);
    jsonAntwort = () => { throw new Error("404"); };
    expect(P.ECHTE_PLACE_IO.ladeLabels(7, "zz-org/ziel")).toBeNull();
  });
  test("setPosition und entferneVomBoard schicken die Mutation mit Board-, Item- und Anker-ID", () => {
    P.ECHTE_PLACE_IO.setPosition(factory, "ITEM_1", "ITEM_0");
    P.ECHTE_PLACE_IO.setPosition(factory, "ITEM_1", null);
    P.ECHTE_PLACE_IO.entferneVomBoard(factory, "ITEM_9");
    const [pos, spitze, weg] = aufrufe.map((a) => a.args.join(" "));
    expect(pos).toContain("updateProjectV2ItemPosition");
    expect(pos).toContain(`p=${factory.projectId}`);
    expect(pos).toContain("i=ITEM_1");
    expect(pos).toContain("a=ITEM_0");
    expect(spitze).not.toContain("a=");
    expect(weg).toContain("deleteProjectV2Item");
    expect(weg).toContain("i=ITEM_9");
  });
  test("addToBoardTodo holt das Issue ins Board und setzt Todo (zwei Mutationen), Rückgabe ist die Item-ID", () => {
    textAntwort = (q) => (q.includes("addProjectV2ItemById") ? JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "PVTI_z9" } } } }) : "{}");
    expect(P.ECHTE_PLACE_IO.addToBoardTodo(factory, "I_abc", { repo: L.zielRepo("factory"), token: "t" })).toBe("PVTI_z9");
    const [add, status] = aufrufe.map((a) => a.args.join(" "));
    expect(add).toContain("c=I_abc");
    expect(aufrufe.map((a) => a.opt)).toEqual([{ token: "t" }, { token: "t" }]);
    expect(status).toContain("updateProjectV2ItemFieldValue");
    expect(status).toContain("i=PVTI_z9");
    expect(status).toContain(`o=${factory.todoOptionId}`);
  });
  test("positionOderWarnung ist die der Board-Lib", () => {
    expect(P.ECHTE_PLACE_IO.positionOderWarnung).toBe(L.positionOderWarnung);
  });
  test("schlafe wartet eine Sekunde, log und warn gehen auf stdout bzw. stderr", async () => {
    vi.useFakeTimers();
    let fertig = false;
    const p = P.ECHTE_PLACE_IO.schlafe().then(() => { fertig = true; });
    await vi.advanceTimersByTimeAsync(999);
    expect(fertig).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(fertig).toBe(true);
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    P.ECHTE_PLACE_IO.log("a");
    P.ECHTE_PLACE_IO.warn("b");
    expect(out).toHaveBeenCalledWith("a");
    expect(err).toHaveBeenCalledWith("b");
  });
});
