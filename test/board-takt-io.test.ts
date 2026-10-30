/* Die echte Verdrahtung der Takt-Skripte trifft das Board, das die Rolle bzw. die Trennregel vorgibt (#1693 L51, zwei Boards #1729): `ECHTE_IO` in
 * board-takt löst die Rolle über `boardFuerRolle` auf, der Default-Parameter `setze` in `fuehreHarnessAus` und `imBoardAnlegen`/`setze` in langfuse-takt
 * schreiben ins Factory-Board (Harness-Arbeit). Kein Wrapper vertauscht die Boards. gh wird gemockt; geprüft werden die Argumente, die an `gh` gehen. */
import { beforeEach, describe, expect, test, vi } from "vitest";

const aufrufe: string[][] = [];
let issueAntwort: unknown = null;
vi.mock("../scripts/gh-cli.mjs", async (orig) => {
  const echt = await orig<Record<string, unknown>>();
  return {
    ...echt,
    ghText: (args: string[]) => {
      aufrufe.push(args);
      const q = args.join(" ");
      if (q.includes("addProjectV2ItemById")) return JSON.stringify({ data: { addProjectV2ItemById: { item: { id: "ITEM_x" } } } });
      if (q.includes("projectItems")) return JSON.stringify(issueAntwort);
      return "[]";
    },
  };
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTakt from "../scripts/board-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLangfuse from "../scripts/langfuse-takt.mjs";
import { FREMD } from "./support/fremd-config";

type Board = { projectId: string; nummer: number; statusFeldId: number | string; statusFeldNodeId: string; todoOptionId: string };
const L = rawLib as unknown as { boardFuerRolle: (r: string) => Board; zielRepo: (r: string) => string };
const produkt = L.boardFuerRolle("produkt");
const factory = L.boardFuerRolle("factory");
const T = rawTakt as unknown as {
  ECHTE_IO: {
    itemsUeberIssues: (r: string, n: number[], o: { repo?: string }) => Array<{ id: string } | null>;
    addToBoardTodo: (r: string, nodeId: string, o: object) => string;
    loadItems: (r: string, o: object) => unknown[];
  };
  fuehreHarnessAus: (h: object, items: object[], token: string, io: { log: () => void }) => boolean;
};
const LF = rawLangfuse as unknown as {
  fuehreStatusAus: (e: object, o: object) => { ok: boolean; itemId: string | null };
};
const flach = () => aufrufe.map((a) => a.join(" ")).join("\n");

/** GraphQL-Antwort: Issue #7 steht in beiden Boards, mit je eigener Item-ID. */
const issueInBeidenBoards = {
  data: {
    repository: {
      i0: {
        number: 7,
        title: "T",
        state: "OPEN",
        assignees: { nodes: [] },
        projectItems: { nodes: [{ id: "ITEM_fremd", project: { id: factory.projectId } }, { id: "ITEM_produkt", project: { id: produkt.projectId } }] },
      },
    },
  },
};

/** Beweist: ein Schreibzugriff ging an das gewünschte Board und nie an das andere. */
function nur(soll: Board, fremd: Board): void {
  const t = flach();
  expect(t).toContain(`p=${soll.projectId}`);
  expect(t).not.toContain(fremd.projectId);
}

beforeEach(() => {
  aufrufe.length = 0;
  issueAntwort = issueInBeidenBoards;
});

describe("ECHTE_IO in board-takt löst die Rolle auf das richtige Board auf", () => {
  test("itemsUeberIssues ordnet je Rolle das Item des eigenen Boards zu", () => {
    expect(T.ECHTE_IO.itemsUeberIssues("produkt", [7], { repo: "zz-org/ziel" })[0]?.id).toBe("ITEM_produkt");
    expect(flach(), "das Ziel-Repo geht als 4. Argument an board-lib (L11 j)").toContain('repository(owner:"zz-org",name:"ziel")');
    expect(T.ECHTE_IO.itemsUeberIssues("factory", [7], { repo: "zz-org/ziel" })[0]?.id).toBe("ITEM_fremd");
  });
  test("itemsUeberIssues: steht das Issue nur im anderen Board, liefert es null (Negativfall)", () => {
    issueAntwort = { data: { repository: { i0: { ...issueInBeidenBoards.data.repository.i0, projectItems: { nodes: [{ id: "ITEM_fremd", project: { id: factory.projectId } }] } } } } };
    expect(T.ECHTE_IO.itemsUeberIssues("produkt", [7], { repo: "zz-org/ziel" })).toEqual([null]);
  });
  test("itemsUeberIssues ohne repo wirft mit Fix-Zeile (kein stiller Standard, L11 g)", () => {
    expect(() => T.ECHTE_IO.itemsUeberIssues("produkt", [7], {})).toThrow(/repo fehlt\nFix:/);
  });
  test("itemsUeberIssues: unbekannte Rolle wirft", () => {
    expect(() => T.ECHTE_IO.itemsUeberIssues("nirgends", [7], { repo: "zz-org/ziel" })).toThrow(/Unbekannte Board-Rolle/);
  });
  test.each([
    ["produkt", produkt, factory],
    ["factory", factory, produkt],
  ] as const)("addToBoardTodo (%s) sendet projectId, Status-Feld und Todo-Option des eigenen Boards", (rolle, soll, fremd) => {
    expect(T.ECHTE_IO.addToBoardTodo(rolle, "I_node", { repo: L.zielRepo(rolle) })).toBe("ITEM_x");
    nur(soll, fremd);
    expect(flach()).toContain(`f=${soll.statusFeldNodeId}`);
    expect(flach()).not.toContain(fremd.statusFeldNodeId);
  });
  test.each([
    ["produkt", produkt, factory],
    ["factory", factory, produkt],
  ] as const)("loadItems (%s) liest Pfad und Status-Feld des eigenen Boards", (rolle, soll, fremd) => {
    T.ECHTE_IO.loadItems(rolle, { repo: L.zielRepo(rolle) });
    const t = flach();
    expect(t).toContain(`/projectsV2/${soll.nummer}/items`);
    expect(t).toContain(`fields=${soll.statusFeldId}`);
    expect(t).not.toContain(`/projectsV2/${fremd.nummer}/items`);
  });
});

describe("Default-Wrapper der Takt-Skripte schreiben ins Factory-Board", () => {
  test("fuehreHarnessAus: Default `setze` setzt die Position im Factory-Board", () => {
    expect(T.fuehreHarnessAus({ nr: 5, afterId: "ITEM_a" }, [{ number: 5, id: "ITEM_5" }], "tok", { log: () => {} })).toBe(true);
    nur(factory, produkt);
    expect(flach()).toContain("i=ITEM_5");
  });
  test("langfuse-takt fuehreStatusAus: Default `imBoardAnlegen` und `setze` treffen das Factory-Board", () => {
    const r = LF.fuehreStatusAus(
      { aktion: "nach-oben", nr: 9 },
      { repo: L.zielRepo("factory"), vorgaenger: null, jetzt: new Date("2026-10-16T00:00:00Z"), token: "tok", items: [], config: FREMD, io: { gh: () => ({ node_id: "I_n" }) } },
    );
    expect(r).toMatchObject({ ok: true, itemId: "ITEM_x" });
    nur(factory, produkt);
    const t = flach();
    expect(t).toContain("updateProjectV2ItemPosition");
    expect(t).toContain(`o=${factory.todoOptionId}`);
  });
  test("langfuse-takt fuehreStatusAus (#101 L31): start landet im Body des angelegten Status-Tickets", () => {
    const bodies: string[] = [];
    const gh = (args: string[]) => {
      bodies.push(args.filter((a) => a.startsWith("body=")).join(""));
      return { number: 11, node_id: "I_n" };
    };
    LF.fuehreStatusAus({ aktion: "anlegen" }, { repo: "zz-org/ziel", vorgaenger: null, jetzt: new Date("2026-10-16T00:00:00Z"), token: "", items: [], config: FREMD, io: { gh }, start: "2026-10-01T08:00:00Z" });
    expect(bodies[0]).toContain("seit dem ersten Commit auf main (2026-10-01T08:00:00Z)");
  });
  test("langfuse-takt fuehreStatusAus (#78 L14): ein 404 beim Lesen und ein 403 beim Anlegen sind klare Meldungen mit dem Ziel-Repo", () => {
    const http = (code: string) => () => { throw Object.assign(new Error("Command failed: gh api x"), { stderr: `gh: ${code}` }); };
    const lauf = (aktion: string, gh: () => never) =>
      LF.fuehreStatusAus({ aktion, nr: 9 }, { repo: "zz-org/ziel", vorgaenger: null, jetzt: new Date("2026-10-16T00:00:00Z"), token: "tok", items: [], config: FREMD, io: { gh } });
    expect(() => lauf("nach-oben", http("HTTP 404: Not Found"))).toThrow(/kein Lesezugriff auf zz-org\/ziel/);
    expect(() => lauf("anlegen", http("HTTP 403: Forbidden"))).toThrow(/keine Schreibrechte auf zz-org\/ziel/);
    expect(() => lauf("nach-oben", http("HTTP 500"))).toThrow(/HTTP 500/);
  });
});
