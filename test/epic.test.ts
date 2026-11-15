/* Epic-Abschluss (factory#507 L4): pure Logik (`kinderStand`, `abschlussEntscheidung`), das Einstiegsskript `epic-abschluss.mjs` und `epic.mjs aufgeteilt` mit eingespritztem io. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/epic-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawAbschluss from "../scripts/epic-abschluss.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawEpic from "../scripts/epic.mjs";
import { FREMD } from "./support/fremd-config";

type Ergebnis = { code: number; out: string; err: string };
type Eltern = { number: number; state: string; repository: { nameWithOwner: string }; subIssues: { totalCount: number; nodes: { number?: number; state: string }[] } } | null | undefined;
interface Aus { aktion: string; grund: string }
const lib = rawLib as unknown as {
  kinderStand(a: { total?: number; zustaende?: string[] }): { total: number; offen: number; vollstaendig: boolean };
  abschlussEntscheidung(a: { repo: string; parent: Eltern }): Aus;
};
interface AbschlussIo { repo: string; elternteil(k: number): Eltern; offeneEpics(): Eltern[]; schliesse(nr: number, text: string): void }
const abschluss = rawAbschluss as unknown as {
  fuehreAus(argv: string[], io: AbschlussIo): Ergebnis;
  macheIo(repo: string, o?: { exec: (g: string, a: string[]) => string }): AbschlussIo;
};
interface EpicStand { kinder: number; itemId: string | null; status: string | null; optionen: { id: string; name: string }[]; boardNummer: number; besitzer: string }
interface EpicIo { laden(nr: number): EpicStand; setzeStatus(item: string, option: string): void }
const epic = rawEpic as unknown as {
  fuehreAus(argv: string[], io: EpicIo): Ergebnis;
  macheIo(config: unknown, o?: { exec: (g: string, a: string[]) => string }): EpicIo;
};

const REPO = "o/r";
const parent = (kinder: string[], extra: Record<string, unknown> = {}) => ({
  number: 20,
  state: "OPEN",
  repository: { nameWithOwner: REPO },
  subIssues: { totalCount: kinder.length, nodes: kinder.map((state) => ({ state })) },
  ...extra,
});

describe("kinderStand", () => {
  test("alle geschlossen: offen 0, vollständig", () => {
    assert.deepEqual(lib.kinderStand({ total: 2, zustaende: ["CLOSED", "CLOSED"] }), { total: 2, offen: 0, vollstaendig: true });
  });
  test("ein offenes Kind: offen 1", () => {
    assert.deepEqual(lib.kinderStand({ total: 2, zustaende: ["CLOSED", "OPEN"] }), { total: 2, offen: 1, vollstaendig: true });
  });
  test("mehr Kinder als gelesene Knoten: nicht vollständig", () => {
    assert.equal(lib.kinderStand({ total: 101, zustaende: Array(100).fill("CLOSED") }).vollstaendig, false);
  });
  test("fehlende Angaben ergeben 0 Kinder", () => {
    assert.deepEqual(lib.kinderStand({}), { total: 0, offen: 0, vollstaendig: true });
  });
});

describe("abschlussEntscheidung", () => {
  const e = (p: Eltern, repo = REPO) => lib.abschlussEntscheidung({ repo, parent: p });
  test("Elternteil offen und alle Kinder zu: schließen", () => {
    assert.deepEqual(e(parent(["CLOSED", "CLOSED"])), { aktion: "schliessen", grund: "alle 2 Kinder geschlossen" });
  });
  test("ein Kind noch offen: Epic bleibt offen (Negativfall)", () => {
    assert.deepEqual(e(parent(["CLOSED", "OPEN", "CLOSED"])), { aktion: "offen", grund: "1 von 3 Kindern offen" });
  });
  test("Elternteil schon geschlossen: nichts", () => {
    assert.equal(e(parent(["CLOSED"], { state: "CLOSED" })).aktion, "nichts");
  });
  test("kein Elternteil: nichts", () => {
    assert.equal(e(null).aktion, "nichts");
    assert.equal(e(undefined).aktion, "nichts");
  });
  test("Elternteil in anderem Repo: nichts mit Grund", () => {
    assert.deepEqual(e(parent(["CLOSED"], { repository: { nameWithOwner: "x/y" } })), { aktion: "nichts", grund: "Elternteil in einem anderen Repo" });
  });
  test("unvollständige Kinderliste: nichts", () => {
    const p = parent(["CLOSED"], { subIssues: { totalCount: 5, nodes: [{ state: "CLOSED" }] } });
    assert.deepEqual(e(p), { aktion: "nichts", grund: "Kinderliste unvollständig gelesen" });
  });
  test("Elternteil ohne Kinder: nichts", () => {
    assert.equal(e(parent([])).aktion, "nichts");
    assert.equal(e({ ...parent([]), subIssues: undefined } as unknown as Eltern).aktion, "nichts");
  });
});

/* ---- epic-abschluss.mjs ---- */

type Knoten = ReturnType<typeof parent>;
function io(welt: { eltern?: Knoten | null; alle?: Knoten[]; wirf?: boolean }) {
  const geschlossen: [number, string][] = [];
  return {
    geschlossen,
    io: {
      repo: REPO,
      elternteil: () => {
        if (welt.wirf) throw new Error("kein Netz");
        return welt.eltern ?? null;
      },
      offeneEpics: () => welt.alle ?? [],
      schliesse: (nr: number, text: string) => void geschlossen.push([nr, text]),
    },
  };
}
const kinder = (...zustaende: string[]) => ({ totalCount: zustaende.length, nodes: zustaende.map((state, k) => ({ number: 30 + k, state })) });

describe("epic-abschluss: fuehreAus", () => {
  test("letztes Kind zu: kommentiert nur mit Nummern und schließt genau einmal", () => {
    const w = io({ eltern: parent([], { subIssues: kinder("CLOSED", "CLOSED") }) });
    const r = abschluss.fuehreAus(["31"], w.io);
    assert.equal(r.code, 0);
    assert.match(r.out, /^EPIC #20: geschlossen \(alle 2 Kinder geschlossen\)$/m);
    assert.deepEqual(w.geschlossen, [[20, "Alle 2 Kinder geschlossen (#30, #31): Epic abgeschlossen."]]);
  });
  test("noch ein Kind offen: nichts wird geschlossen (Negativfall)", () => {
    const w = io({ eltern: parent([], { subIssues: kinder("CLOSED", "OPEN") }) });
    const r = abschluss.fuehreAus(["30"], w.io);
    assert.equal(r.code, 0);
    assert.match(r.out, /EPIC #20: bleibt offen \(1 von 2 Kindern offen\)/);
    assert.deepEqual(w.geschlossen, []);
  });
  test("zweiter Aufruf schließt nicht erneut (Elternteil schon zu)", () => {
    const w = io({ eltern: parent([], { state: "CLOSED", subIssues: kinder("CLOSED") }) });
    assert.match(abschluss.fuehreAus(["30"], w.io).out, /nichts zu tun \(Elternteil nicht offen\)/);
    assert.deepEqual(w.geschlossen, []);
  });
  test("Kind ohne Elternteil: nichts", () => {
    const w = io({});
    assert.match(abschluss.fuehreAus(["30"], w.io).out, /nichts zu tun \(kein Elternteil\)/);
  });
  test("--alle: von zwei Epics schließt nur das fertige", () => {
    const fertig = parent([], { number: 20, subIssues: kinder("CLOSED") });
    const offen = parent([], { number: 21, subIssues: kinder("CLOSED", "OPEN") });
    const w = io({ alle: [fertig, offen] });
    const r = abschluss.fuehreAus(["--alle"], w.io);
    assert.equal(r.code, 0);
    assert.deepEqual(w.geschlossen.map(([n]) => n), [20]);
    assert.match(r.out, /EPIC #21: bleibt offen/);
  });
  test("--alle ohne Epics: eigene Meldung", () => {
    assert.match(abschluss.fuehreAus(["--alle"], io({}).io).out, /Keine offenen Epics\./);
  });
  test("Aufruf-Fehler: Exit 2 vor jedem I/O (io wird nie berührt)", () => {
    const wirf = () => {
      throw new Error("I/O");
    };
    const sperre = { repo: REPO, elternteil: wirf, offeneEpics: wirf, schliesse: wirf };
    for (const argv of [[], ["abc"], ["0"], ["1", "2"], ["--alle", "5"], ["--unbekannt"], ["-5"]]) {
      const r = abschluss.fuehreAus(argv, sperre);
      assert.equal(r.code, 2, argv.join(" "));
      assert.match(r.err, /Aufruf: node scripts\/epic-abschluss\.mjs/);
    }
  });
  test("Fehler im io: Exit 1 mit Fix-Zeile", () => {
    const r = abschluss.fuehreAus(["30"], io({ wirf: true }).io);
    assert.equal(r.code, 1);
    assert.match(r.err, /✖ kein Netz[\s\S]*Fix:/);
  });
});

describe("epic-abschluss: macheIo über gh (exec-Naht)", () => {
  const antwort = (daten: unknown) => JSON.stringify({ data: daten });
  test("elternteil, offeneEpics (zwei Seiten) und schliesse rufen gh mit den erwarteten Argumenten", () => {
    const aufrufe: string[][] = [];
    const exec = (_gh: string, args: string[]) => {
      aufrufe.push(args);
      const a = args.join(" ");
      if (a.includes("issue(number:")) return antwort({ repository: { issue: { parent: { number: 20 } } } });
      if (a.includes("issues(states:OPEN")) {
        const zweite = a.includes("c=CUR");
        return antwort({
          repository: { issues: { pageInfo: { hasNextPage: !zweite, endCursor: "CUR" }, nodes: [{ number: zweite ? 2 : 1, subIssues: { totalCount: zweite ? 0 : 1 } }] } },
        });
      }
      return "";
    };
    const h = abschluss.macheIo(REPO, { exec });
    assert.deepEqual(h.elternteil(5), { number: 20 });
    assert.equal(aufrufe[0].includes("k=5"), true);
    assert.deepEqual(h.offeneEpics().map((e) => e?.number), [1]);
    h.schliesse(20, "Text");
    assert.deepEqual(aufrufe.slice(-2), [
      ["issue", "comment", "20", "--repo", REPO, "--body", "Text"],
      ["issue", "close", "20", "--repo", REPO, "--reason", "completed"],
    ]);
  });
  test("kein Elternteil: null; zu viele Seiten: Fehler; ungültiges Repo: wirft", () => {
    const leer = () => antwort({ repository: { issue: null } });
    assert.equal(abschluss.macheIo(REPO, { exec: leer }).elternteil(5), null);
    const endlos = () => antwort({ repository: { issues: { pageInfo: { hasNextPage: true, endCursor: "X" }, nodes: [] } } });
    assert.throws(() => abschluss.macheIo(REPO, { exec: endlos }).offeneEpics(), /mehr als 20 Seiten/);
    assert.throws(() => abschluss.macheIo("kaputt"), /owner\/name/);
  });
});

/* ---- epic.mjs aufgeteilt ---- */
type Stand = EpicStand;
const OPT = [{ id: "o-todo", name: "Todo" }, { id: "o-ip", name: "In Progress" }];
const stand = (extra: Partial<Stand> = {}): Stand => ({ kinder: 2, itemId: "item-1", status: "Todo", optionen: OPT, boardNummer: 2, besitzer: "b", ...extra });
function epicIo(s: Stand | Error) {
  const mutationen: [string, string][] = [];
  return {
    mutationen,
    io: {
      laden: () => {
        if (s instanceof Error) throw s;
        return s;
      },
      setzeStatus: (item: string, option: string) => void mutationen.push([item, option]),
    },
  };
}

describe("epic.mjs aufgeteilt: fuehreAus", () => {
  test("setzt den Status genau einmal mit der gefundenen Option-ID", () => {
    const w = epicIo(stand());
    const r = epic.fuehreAus(["aufgeteilt", "20"], w.io);
    assert.equal(r.code, 0);
    assert.match(r.out, /#20: Status „Todo“ → „In Progress“/);
    assert.deepEqual(w.mutationen, [["item-1", "o-ip"]]);
  });
  test("steht der Status schon richtig: keine Mutation", () => {
    const w = epicIo(stand({ status: "In Progress" }));
    const r = epic.fuehreAus(["aufgeteilt", "20"], w.io);
    assert.equal(r.code, 0);
    assert.deepEqual(w.mutationen, []);
  });
  test("ohne Kinder: Exit 1 mit Fix-Zeile, keine Mutation", () => {
    const w = epicIo(stand({ kinder: 0 }));
    const r = epic.fuehreAus(["aufgeteilt", "20"], w.io);
    assert.equal(r.code, 1);
    assert.match(r.err, /hat keine Kinder\nFix: erst Kinder per node scripts\/spezifikation\.mjs anlegen … --epic 20/);
    assert.deepEqual(w.mutationen, []);
  });
  test("Option „In Progress“ fehlt: Exit 2 mit Fix, keine Mutation", () => {
    const w = epicIo(stand({ optionen: [OPT[0]] }));
    const r = epic.fuehreAus(["aufgeteilt", "20"], w.io);
    assert.equal(r.code, 2);
    assert.match(r.err, /keine Option „In Progress“\nFix:/);
    assert.deepEqual(w.mutationen, []);
  });
  test("Epic nicht im Board: Exit 1 mit Fix", () => {
    const r = epic.fuehreAus(["aufgeteilt", "20"], epicIo(stand({ itemId: null })).io);
    assert.equal(r.code, 1);
    assert.match(r.err, /steht nicht im Board\nFix: .*gh project item-add 2 --owner b/);
  });
  test("Fehler beim Laden: Exit 1 mit Fix", () => {
    const r = epic.fuehreAus(["aufgeteilt", "20"], epicIo(new Error("kein Netz")).io);
    assert.equal(r.code, 1);
    assert.match(r.err, /✖ kein Netz/);
  });
  test("Aufruf-Fehler: Exit 2 vor jedem I/O", () => {
    const sperre = { laden: () => { throw new Error("I/O"); }, setzeStatus: () => { throw new Error("I/O"); } };
    for (const argv of [[], ["aufgeteilt"], ["aufgeteilt", "x"], ["aufgeteilt", "0"], ["aufgeteilt", "1", "2"], ["abschluss", "1"], ["aufgeteilt", "--x"]]) {
      const r = epic.fuehreAus(argv, sperre);
      assert.equal(r.code, 2, argv.join(" "));
      assert.match(r.err, /Aufruf: node scripts\/epic\.mjs aufgeteilt <nr>/);
    }
  });
});

describe("epic.mjs: macheIo über gh (exec-Naht)", () => {
  const config = { ...FREMD, repo: "zz-org/zz-repo" };
  const produkt = FREMD.boards.find((b) => b.rolle === "produkt");
  test("lädt Kinder, Item, Status und Optionen und setzt den Status mit der Mutation", () => {
    const aufrufe: string[][] = [];
    const exec = (_gh: string, args: string[]) => {
      aufrufe.push(args);
      const q = args.find((a) => a.startsWith("query=")) ?? "";
      if (q.includes("issue(number:")) {
        return JSON.stringify({ data: { repository: { issue: { labels: { nodes: [] }, subIssues: { totalCount: 3 }, projectItems: { nodes: [{ id: "item-x", project: { id: produkt?.projectId }, fieldValueByName: { name: "Todo" } }] } } } } });
      }
      if (q.includes("ProjectV2SingleSelectField")) return JSON.stringify({ data: { node: { options: OPT } } });
      return "";
    };
    // Ohne Harness-Label zählt die Rolle `produkt`.
    const h = epic.macheIo(config, { exec });
    const s = h.laden(20);
    assert.deepEqual({ kinder: s.kinder, itemId: s.itemId, status: s.status, optionen: s.optionen }, { kinder: 3, itemId: "item-x", status: "Todo", optionen: OPT });
    h.setzeStatus("item-x", "o-ip");
    const m = aufrufe.at(-1) ?? [];
    assert.ok(m.includes(`p=${produkt?.projectId}`) && m.includes("i=item-x") && m.includes("o=o-ip") && m.includes(`f=${produkt?.statusFeldNodeId}`));
  });
  test("Issue fehlt: Fehler; Item in fremdem Projekt: itemId null", () => {
    const leer = () => JSON.stringify({ data: { repository: { issue: null } } });
    assert.throws(() => epic.macheIo(config, { exec: leer }).laden(20), /nicht gefunden/);
    const fremd = (_g: string, args: string[]) =>
      (args.find((a) => a.startsWith("query=")) ?? "").includes("issue(number:")
        ? JSON.stringify({ data: { repository: { issue: { labels: { nodes: [] }, subIssues: { totalCount: 1 }, projectItems: { nodes: [{ id: "item-y", project: { id: "ANDERES" } }] } } } } })
        : JSON.stringify({ data: { node: null } });
    const s = epic.macheIo(config, { exec: fremd }).laden(20);
    assert.equal(s.itemId, null);
    assert.deepEqual(s.optionen, []);
  });
});
