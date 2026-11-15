/* Board-Status (factory#541 L6): `setze` und `abgleich` mit eingespritztem io und exec-Naht, ohne Netz. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-status.mjs";
import { FREMD } from "./support/fremd-config";

type Ergebnis = { code: number; out: string; err: string };
interface Stand { kinder: number; itemId: string | null; status: string | null; optionen: { id: string; name: string }[]; boardNummer: number; besitzer: string }
interface Item { id: string; number: number; status: string; state: string; assignees: string[] }
interface Daten { boards: { projectId: string; feldId: string; optionen: { id: string; name: string }[]; items: Item[] }[]; prIssues: number[] }
interface Io {
  laden(nr: number): Stand;
  setzeStatus(item: string, option: string): void;
  abgleichDaten(): Daten;
  setzeStatusIn(projectId: string, feldId: string, item: string, option: string): void;
}
const lib = raw as unknown as {
  fuehreAus(argv: string[], io: Io): Ergebnis;
  macheIo(config: unknown, o?: { exec: (g: string, a: string[]) => string }): Io;
};

const OPT = [{ id: "o-todo", name: "Todo" }, { id: "o-ip", name: "In Progress" }];
const stand = (extra: Partial<Stand> = {}): Stand => ({ kinder: 0, itemId: "item-1", status: "Todo", optionen: OPT, boardNummer: 2, besitzer: "b", ...extra });
const item = (number: number, extra: Partial<Item> = {}): Item => ({ id: `ITEM_${number}`, number, status: "In Progress", state: "open", assignees: [], ...extra });

function mitIo(s: Stand | Error, daten: Daten = { boards: [], prIssues: [] }) {
  const mutationen: string[][] = [];
  const io: Io = {
    laden: () => {
      if (s instanceof Error) throw s;
      return s;
    },
    setzeStatus: (i, o) => void mutationen.push([i, o]),
    abgleichDaten: () => daten,
    setzeStatusIn: (p, f, i, o) => void mutationen.push([p, f, i, o]),
  };
  return { io, mutationen };
}

describe("board-status setze", () => {
  test("setzt den Status mit der Option-ID des Namens", () => {
    const w = mitIo(stand());
    const r = lib.fuehreAus(["setze", "7", "--status", "In Progress"], w.io);
    assert.equal(r.code, 0);
    assert.match(r.out, /#7: Status „Todo“ → „In Progress“/);
    assert.deepEqual(w.mutationen, [["item-1", "o-ip"]]);
    const zurueck = mitIo(stand({ status: "In Progress" }));
    lib.fuehreAus(["setze", "7", "--status", "Todo"], zurueck.io);
    assert.deepEqual(zurueck.mutationen, [["item-1", "o-todo"]]);
  });
  test("idempotent: steht der Status schon richtig, keine Mutation", () => {
    const w = mitIo(stand({ status: "In Progress" }));
    const r = lib.fuehreAus(["setze", "7", "--status", "In Progress"], w.io);
    assert.equal(r.code, 0);
    assert.match(r.out, /schon „In Progress“/);
    assert.deepEqual(w.mutationen, []);
  });
  test("ohne Board-Item: Exit 1 mit Fix", () => {
    const w = mitIo(stand({ itemId: null }));
    const r = lib.fuehreAus(["setze", "7", "--status", "Todo"], w.io);
    assert.equal(r.code, 1);
    assert.match(r.err, /steht nicht im Board\nFix: /);
    assert.deepEqual(w.mutationen, []);
  });
  test("fehlende Status-Option: Exit 2; Ladefehler: Exit 1", () => {
    const w = mitIo(stand({ optionen: OPT.slice(0, 1) }));
    const r = lib.fuehreAus(["setze", "7", "--status", "In Progress"], w.io);
    assert.equal(r.code, 2);
    assert.match(r.err, /keine Option „In Progress“\nFix:/);
    assert.equal(lib.fuehreAus(["setze", "7", "--status", "Todo"], mitIo(new Error("kein Netz")).io).code, 1);
  });
  test("Aufruf-Fehler: Exit 2 vor jedem I/O", () => {
    const sperre = { laden: () => { throw new Error("I/O"); }, setzeStatus: () => { throw new Error("I/O"); }, abgleichDaten: () => { throw new Error("I/O"); }, setzeStatusIn: () => { throw new Error("I/O"); } };
    for (const argv of [[], ["x"], ["setze"], ["setze", "7"], ["setze", "x", "--status", "Todo"], ["setze", "0", "--status", "Todo"], ["setze", "7", "--status"], ["setze", "7", "--status", "Todo", "--x"], ["setze", "7", "--status", "Todo", "8"], ["abgleich", "--x"], ["abgleich", "5"]]) {
      const r = lib.fuehreAus(argv, sperre);
      assert.equal(r.code, 2, argv.join(" "));
      assert.match(r.err, /Aufruf: node scripts\/board-status\.mjs/);
    }
  });
});

describe("board-status abgleich", () => {
  const board = (items: Item[]) => ({ projectId: "P", feldId: "F", optionen: OPT, items });
  test("setzt nur offene, ungeclaimte In-Progress-Items ohne offenen PR auf Todo", () => {
    const daten: Daten = {
      boards: [board([item(1), item(2, { assignees: ["x"] }), item(3), item(4, { state: "closed" }), item(5, { status: "Todo" }), item(6)])],
      prIssues: [3],
    };
    const w = mitIo(stand(), daten);
    const r = lib.fuehreAus(["abgleich"], w.io);
    assert.equal(r.code, 0);
    assert.equal(r.out, "STATUS #1: In Progress → Todo\nSTATUS #6: In Progress → Todo\n");
    assert.deepEqual(w.mutationen, [["P", "F", "ITEM_1", "o-todo"], ["P", "F", "ITEM_6", "o-todo"]]);
  });
  test("nichts zu tun: keine Ausgabe, keine Mutation; Board ohne Todo-Option: Exit 2", () => {
    const w = mitIo(stand(), { boards: [board([item(2, { assignees: ["x"] })])], prIssues: [] });
    const r = lib.fuehreAus(["abgleich"], w.io);
    assert.deepEqual([r.code, r.out, w.mutationen], [0, "", []]);
    const ohne = mitIo(stand(), { boards: [{ ...board([item(1)]), optionen: OPT.slice(1) }], prIssues: [] });
    assert.equal(lib.fuehreAus(["abgleich"], ohne.io).code, 2);
  });
});

describe("board-status macheIo über gh (exec-Naht)", () => {
  const config = { ...FREMD, repo: "zz-org/zz-repo" };
  test("abgleichDaten liest Items beider Boards und die Issues offener PRs; setzeStatusIn mutiert", () => {
    const aufrufe: string[][] = [];
    const exec = (_g: string, args: string[]) => {
      aufrufe.push(args);
      if (args[0] === "pr") return JSON.stringify([{ closingIssuesReferences: [{ number: 9 }] }, { closingIssuesReferences: [] }]);
      const q = args.find((a) => a.startsWith("query=")) ?? "";
      if (q.includes("ProjectV2SingleSelectField")) return JSON.stringify({ data: { node: { options: OPT } } });
      if (args.some((a) => a.includes("/items?"))) {
        return JSON.stringify([[{ node_id: "ITEM_a", content_type: "Issue", content: { number: 9, state: "open", title: "t", repository_url: "https://api.github.com/repos/zz-org/zz-repo", assignees: [] }, fields: [] }]]);
      }
      return "";
    };
    const io = lib.macheIo(config, { exec });
    const d = io.abgleichDaten();
    assert.deepEqual(d.prIssues, [9]);
    assert.equal(d.boards.length, FREMD.boards.length);
    assert.equal(d.boards[0]?.items[0]?.number, 9);
    assert.deepEqual(d.boards[0]?.optionen, OPT);
    const pr = aufrufe.find((a) => a[0] === "pr") ?? [];
    assert.ok(pr.includes("--limit") && pr.includes("closingIssuesReferences") && pr.includes("zz-org/zz-repo"));
    io.setzeStatusIn("P", "F", "ITEM_a", "o-todo");
    const m = aufrufe.at(-1) ?? [];
    assert.ok(m.includes("p=P") && m.includes("f=F") && m.includes("i=ITEM_a") && m.includes("o=o-todo"));
  });
});
