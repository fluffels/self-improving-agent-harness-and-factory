/* `einsortieren` und `umziehen` von board-place (#97 L7 a): die I/O ist injizierbar (`io`, Standard `ECHTE_PLACE_IO`), die Verdrahtung läuft mit Fakes ohne Netz. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-place.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lib from "../scripts/board-lib.mjs";
import { FREMD } from "./support/fremd-config";

type Item = { id: string; contentId: string; number: number; repo: string; status: string; title: string; assignees: string[]; state: string; labels: string[]; body: string; autor: null; blockedBy: number };
type Board = { projectId: string };
const P = raw as unknown as {
  ECHTE_PLACE_IO: Record<string, unknown>;
  einsortieren: (args: object, config: unknown, io?: object) => Promise<void>;
  umziehen: (args: object, config: unknown, io?: object) => Promise<void>;
};
const L = lib as unknown as { boardFuerRolle: (r: string) => Board };
const PRODUKT = L.boardFuerRolle("produkt");
const FACTORY = L.boardFuerRolle("factory");

const item = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, contentId: `C${number}`, number, repo: FREMD.repo, status: "Todo", title: `T${number}`, assignees: [], state: "open", labels: [], body: "", autor: null, blockedBy: 0, ...extra });

function fake(listen: { produkt: Item[]; factory: Item[] }, extra: Record<string, unknown> = {}) {
  const proto: { was: string; args: unknown[] }[] = [];
  const log: string[] = [];
  const io = {
    loadItems: (board: Board, opts: { repo: string }) => (proto.push({ was: "loadItems", args: [board.projectId, opts] }), board.projectId === PRODUKT.projectId ? listen.produkt : listen.factory),
    ladeLabels: (nr: number, repo: string) => (proto.push({ was: "ladeLabels", args: [nr, repo] }), []),
    itemsUeberIssues: (board: Board, nummern: number[], opts: object, repo: string) => (proto.push({ was: "itemsUeberIssues", args: [board.projectId, nummern, opts, repo] }), nummern.map(() => null)),
    addToBoardTodo: () => "NEU",
    setPosition: (board: Board, id: string, after: string | null) => void proto.push({ was: "setPosition", args: [board.projectId, id, after] }),
    entferneVomBoard: (board: Board, id: string) => void proto.push({ was: "entferne", args: [board.projectId, id] }),
    positionOderWarnung: () => null,
    schlafe: () => (proto.push({ was: "schlafe", args: [] }), Promise.resolve()),
    log: (z: string) => void log.push(z),
    warn: (z: string) => void log.push(`WARN ${z}`),
    ...extra,
  };
  return { io, proto, log };
}

describe("einsortieren mit Fake-IO", () => {
  test("hinter den Anker: Items werden im Ziel-Repo gelesen, die Position auf dem Produkt-Board gesetzt, mit Pause", async () => {
    const { io, proto } = fake({ produkt: [item(1), item(2), item(5)], factory: [] });
    await P.einsortieren({ anchor: 1, numbers: [5], dry: false, repo: FREMD.repo }, FREMD, io);
    expect(proto.filter((p) => p.was === "loadItems").map((p) => p.args[1])).toEqual([{ repo: FREMD.repo }, { repo: FREMD.repo }]);
    expect(proto.filter((p) => p.was === "setPosition").map((p) => p.args)).toEqual([[PRODUKT.projectId, "I5", "I1"]]);
    expect(proto.filter((p) => p.was === "schlafe")).toHaveLength(1);
  });
  test("Trockenlauf setzt nichts und schläft nicht", async () => {
    const { io, proto, log } = fake({ produkt: [item(1), item(5)], factory: [] });
    await P.einsortieren({ anchor: 1, numbers: [5], dry: true, repo: FREMD.repo }, FREMD, io);
    expect(proto.some((p) => p.was === "setPosition" || p.was === "schlafe")).toBe(false);
    expect(log.join("\n")).toContain("#5 → hinter Vorgänger");
  });
  test("ein Item, das nur GraphQL kennt: das Ziel-Repo geht als 4. Argument an itemsUeberIssues", async () => {
    const { io, proto } = fake({ produkt: [item(1)], factory: [] });
    await P.einsortieren({ anchor: 1, numbers: [5], dry: true, repo: FREMD.repo }, FREMD, io).catch(() => undefined);
    const q = proto.find((p) => p.was === "itemsUeberIssues");
    expect(q?.args.slice(1)).toEqual([[5], {}, FREMD.repo]);
  });
  test("ein Ziel-Repo, das das Board nicht führt, bricht vor jedem Schreiben ab", async () => {
    const { io, proto } = fake({ produkt: [item(1), item(5)], factory: [] });
    await expect(P.einsortieren({ anchor: 1, numbers: [5], dry: false, repo: "zz-org/ziel" }, FREMD, io)).rejects.toThrow(/nicht die von zz-org\/ziel/);
    expect(proto.some((p) => p.was === "setPosition")).toBe(false);
  });
  test("ohne io gilt die echte I/O (Standardparameter), erkennbar an ECHTE_PLACE_IO mit allen Schlüsseln", () => {
    expect(Object.keys(P.ECHTE_PLACE_IO).sort()).toEqual(["addToBoardTodo", "entferneVomBoard", "itemsUeberIssues", "ladeLabels", "loadItems", "log", "positionOderWarnung", "schlafe", "setPosition", "warn"]);
  });
});

describe("umziehen mit Fake-IO", () => {
  test("nichts zu tun: eine Meldung, keine Mutation", async () => {
    const { io, proto, log } = fake({ produkt: [item(1)], factory: [] });
    await P.umziehen({ dry: false, repo: FREMD.repo }, FREMD, io);
    expect(log.join("\n")).toMatch(/Umzug: nichts zu tun|Umzug: 0 umziehen/);
    expect(proto.some((p) => p.was === "setPosition" || p.was === "entferne")).toBe(false);
  });
  test("ein Harness-Item auf dem Produkt-Board zieht um: aufnehmen, positionieren, erst dann vom Quell-Board entfernen", async () => {
    const harness = item(7, { labels: [FREMD.labels.harness] });
    const { io, proto, log } = fake({ produkt: [harness], factory: [] });
    await P.umziehen({ dry: false, repo: FREMD.repo }, FREMD, io);
    const reihe = proto.map((p) => p.was).filter((w) => w === "setPosition" || w === "entferne");
    expect(reihe).toEqual(["setPosition", "entferne"]);
    expect(proto.find((p) => p.was === "entferne")?.args).toEqual([PRODUKT.projectId, "I7"]);
    expect(proto.find((p) => p.was === "setPosition")?.args[0]).toBe(FACTORY.projectId);
    expect(log.join("\n")).toMatch(/Umzug: 1 umziehen, 0 entfernen, 0 gemeldet/);
  });
});
