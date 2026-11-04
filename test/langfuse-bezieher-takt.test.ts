/* Langfuse-Takt im Bezieher (factory#195, ADR 0031 Punkt 4): das Status-Ticket entsteht im eigenen Repo auf dem eigenen Board, der Harness-Teil bleibt bei der Fabrik.
 * `fuehreTaktAus` nimmt seine I/O injiziert (Fakes wie test/board-takt-lauf.test.ts); Upstream (`bezieher` falsch) bleibt unverändert (Negativfall). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTakt from "../scripts/board-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawStatus from "../scripts/langfuse-takt.mjs";
import { FREMD, FREMD_OWNER } from "./support/fremd-config";

const FABRIK = "zz-org/zz-fabrik";
const STATUS = "Langfuse-Status überprüfen";
const JETZT = new Date("2026-10-08T12:00:00Z");

type Ctx = { ziel?: { rolle: string; label: string | null }; items?: unknown[]; vorgaenger?: unknown };
interface Aufrufe {
  status: Ctx[];
  harness: number;
  suche: string[];
  commitRepos: string[];
  ladeRepos: { rolle: string; repo?: string }[];
  zweit: { label: string | null }[];
  log: string[];
}
interface Opt {
  bezieher?: boolean;
  offen?: unknown[];
  suche?: unknown | Error;
  commits?: unknown[];
  token?: string;
}
type Io = Record<string, unknown>;
const takt = rawTakt as unknown as { fuehreTaktAus: (a: { jetzt: Date; repo: string; token?: string; io: Io; config: unknown; bezieher?: boolean; ausloeser?: string }) => { fehler: boolean } };
const status = rawStatus as unknown as {
  vorgaengerAusSuche: (a: { antwort: unknown; offene: { number: number }[] }) => { vorgaenger: { number: number; closedAt: string; createdAt: string } | null; unklar: number[] };
  statusSucheAnfrage: (repo: string) => string[];
  fuehreStatusAus: (e: { aktion: string; nr?: number }, c: Record<string, unknown>) => { ok: boolean; nr?: number };
};

/** Config eines Beziehers: das Factory-Board führt das Repo der Fabrik, das Produkt-Board das eigene. */
const bezieherConfig = { repo: FREMD.repo, labels: { harness: FREMD.labels.harness, forum: FREMD.labels.forum }, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo: FABRIK } : b)) };
const commit = (n: number) => ({ author: { login: FREMD_OWNER }, commit: { message: `feat(sim): s${n} (#${200 + n})`, committer: { date: "2026-10-06T10:00:00Z" } } });
const fuenf = [1, 2, 3, 4, 5].map(commit);
const treffer = (number: number, state: string, extra: Record<string, unknown> = {}) => ({ number, title: STATUS, state, createdAt: "2026-10-02T00:00:00Z", closedAt: null, ...extra });
const antwort = (...nodes: unknown[]) => ({ data: { search: { nodes } } });

function lauf(opt: Opt = {}) {
  const a: Aufrufe = { status: [], harness: 0, suche: [], commitRepos: [], ladeRepos: [], zweit: [], log: [] };
  const io: Io = {
    ghJson: (args: string[]) => {
      const text = args.join(" ");
      if (text.includes("graphql")) {
        a.suche.push(text);
        if (opt.suche instanceof Error) throw opt.suche;
        return opt.suche ?? antwort();
      }
      if (text.includes("/commits")) {
        a.commitRepos.push(/repos\/([^/]+\/[^/]+)\/commits/.exec(text)?.[1] ?? "?");
        return [opt.commits ?? fuenf];
      }
      return [[]];
    },
    loadOpenIssuePages: () => [(opt.offen ?? []).map((n) => n)],
    loadItems: (rolle: string, o: { repo?: string }) => (a.ladeRepos.push({ rolle, repo: o.repo }), []),
    frischeOffeneIssues: (z: { label: string | null }) => (a.zweit.push({ label: z.label }), []),
    itemsUeberIssues: (_r: string, n: number[]) => n.map(() => null),
    addToBoardTodo: () => "ITEM",
    fuehreStatusAus: (_e: unknown, ctx: Ctx) => (a.status.push(ctx), { ok: true, nr: 77, itemId: "I77" }),
    fuehreHarnessAus: () => (a.harness++, true),
    ersterCommitDatum: () => null,
    env: {},
    log: (z: string) => a.log.push(z),
  };
  const r = takt.fuehreTaktAus({ jetzt: JETZT, repo: FREMD.repo, token: "token" in opt ? opt.token : "t", io, config: bezieherConfig, bezieher: opt.bezieher ?? true });
  return { r, a, log: a.log.join("\n") };
}

describe("Takt im Bezieher: Status-Ticket im eigenen Repo (factory#195)", () => {
  test("Status-Ticket: Ziel ist das Produkt-Board ohne Label, die Liste kommt vom Produkt-Board, der Harness-Teil entfällt", () => {
    const { r, a, log } = lauf();
    expect(a.status).toHaveLength(1);
    expect(a.status[0]?.ziel).toEqual({ rolle: "produkt", repo: FREMD.repo, label: null });
    expect(a.harness).toBe(0);
    expect(log).toContain(`Bezieher: Status-Ticket auf dem produkt-Board von ${FREMD.repo}; Harness-Sammelticket und Quote pflegt ${FABRIK}`);
    expect(log).not.toContain("Factory-Teil übersprungen");
    expect(log).not.toMatch(/Harness-Sammelticket:|Produktquote/);
    expect(r.fehler).toBe(false);
  });

  test("gezählt werden nur die Commits des eigenen Repos, die Zweitabfrage vor dem Anlegen läuft ohne Label", () => {
    const { a } = lauf();
    expect(a.commitRepos).toEqual([FREMD.repo]);
    expect(a.zweit).toEqual([{ label: null }]);
  });

  test("die Titelsuche läuft im eigenen Repo", () => {
    const { a } = lauf();
    expect(a.suche).toHaveLength(1);
    expect(a.suche[0]).toContain(`repo:${FREMD.repo} `);
  });

  test("Suche meldet ein offenes Status-Ticket, das die offene Liste nicht kennt: nichts anlegen (fail-closed) mit Warnung, der Wächter läuft trotzdem", () => {
    const { r, a, log } = lauf({ suche: antwort(treffer(40, "OPEN")) });
    expect(a.status).toHaveLength(0);
    expect(log).toMatch(/::warning::Status-Ticket ausgelassen \(fail-closed\).*#40/);
    expect(a.ladeRepos.map((l) => l.rolle).sort()).toEqual(["factory", "produkt"]);
    expect(r.fehler).toBe(false);
  });

  test("scheitert die Suche, entfällt das Status-Ticket mit Warnung, der Lauf bleibt grün", () => {
    const { r, a, log } = lauf({ suche: new Error("HTTP 502") });
    expect(a.status).toHaveLength(0);
    expect(log).toMatch(/::warning::Status-Ticket ausgelassen \(fail-closed\): Suche nach früheren Status-Tickets fehlgeschlagen/);
    expect(r.fehler).toBe(false);
  });

  test("ein Vorgänger, der vor zwei Stunden geschlossen wurde: kein neues Ticket (Mindestabstand 24 h)", () => {
    const { a, log } = lauf({ suche: antwort(treffer(41, "CLOSED", { closedAt: "2026-10-08T10:00:00Z" })) });
    expect(a.status).toHaveLength(0);
    expect(log).toContain("Status-Ticket (schedule): nichts");
  });

  test("ein offenes Status-Ticket, das auch die offene Liste kennt, ist kein Widerspruch: das Ticket wird hochgeholt, kein zweites angelegt", () => {
    const offen = [{ number: 40, title: STATUS, state: "open", user: { login: FREMD_OWNER }, assignees: [], created_at: "2026-10-02T00:00:00Z" }];
    const { log } = lauf({ suche: antwort(treffer(40, "OPEN")), offen });
    expect(log).toContain("Status-Ticket (schedule): nach-oben #40");
    expect(log).not.toContain("fail-closed");
  });

  test("ohne Token: keine Board-Abfrage, das Status-Ticket wird angelegt (es braucht die Liste nicht)", () => {
    const { r, a } = lauf({ token: "" });
    expect(a.ladeRepos).toEqual([]);
    expect(a.status).toHaveLength(1);
    expect(r.fehler).toBe(false);
  });

  test("Negativfall Upstream: bezieher falsch, gleiche Config: Factory-Teil übersprungen wie bisher, kein Status-Ticket, keine Suche", () => {
    const { a, log, r } = lauf({ bezieher: false });
    expect(log).toContain(`Factory-Teil übersprungen: Factory-Board führt ${FABRIK}, der Takt dort pflegt Status- und Sammelticket`);
    expect(a.status).toHaveLength(0);
    expect(a.suche).toHaveLength(0);
    expect(a.commitRepos).toEqual([]);
    expect(r.fehler).toBe(false);
  });
});

describe("vorgaengerAusSuche", () => {
  const offene = (...n: number[]) => n.map((number) => ({ number }));

  test("nur der exakte Titel zählt, der jüngste geschlossene Treffer gewinnt", () => {
    const r = status.vorgaengerAusSuche({
      antwort: antwort(
        treffer(10, "CLOSED", { closedAt: "2026-09-01T00:00:00Z" }),
        treffer(12, "CLOSED", { closedAt: "2026-09-20T00:00:00Z" }),
        { number: 13, title: `${STATUS} (Entwurf)`, state: "CLOSED", createdAt: "2026-09-21T00:00:00Z", closedAt: "2026-09-30T00:00:00Z" },
      ),
      offene: offene(),
    });
    expect(r).toEqual({ vorgaenger: { number: 12, closedAt: "2026-09-20T00:00:00Z", createdAt: "2026-10-02T00:00:00Z" }, unklar: [] });
  });

  test("state ohne Groß-/Kleinschreibung; ein offener Treffer in der Liste ist kein Vorgänger und kein Widerspruch", () => {
    const r = status.vorgaengerAusSuche({ antwort: antwort(treffer(10, "closed", { closedAt: "2026-09-01T00:00:00Z" }), treffer(11, "open")), offene: offene(11) });
    expect(r.vorgaenger?.number).toBe(10);
    expect(r.unklar).toEqual([]);
  });

  test("OPEN in der Suche, aber nicht in der Liste: unklar; ein in der Liste stehendes CLOSED wird kein Vorgänger", () => {
    expect(status.vorgaengerAusSuche({ antwort: antwort(treffer(11, "OPEN")), offene: offene() }).unklar).toEqual([11]);
    expect(status.vorgaengerAusSuche({ antwort: antwort(treffer(12, "CLOSED", { closedAt: "2026-09-01T00:00:00Z" })), offene: offene(12) }).vorgaenger).toBeNull();
  });

  test("ohne Treffer: kein Vorgänger; unerwartete Antwortform wirft", () => {
    expect(status.vorgaengerAusSuche({ antwort: antwort(), offene: offene() })).toEqual({ vorgaenger: null, unklar: [] });
    expect(() => status.vorgaengerAusSuche({ antwort: {}, offene: offene() })).toThrow(/Antwortform/);
  });

  test("die Suchanfrage nennt Repo und Titel als Variable (keine Interpolation in die Abfrage)", () => {
    const args = status.statusSucheAnfrage("o/n");
    expect(args.slice(0, 2)).toEqual(["api", "graphql"]);
    expect(args.join(" ")).toContain(`q=repo:o/n is:issue in:title "${STATUS}"`);
    expect(args.find((z) => z.startsWith("query="))).not.toContain("o/n");
  });
});

describe("fuehreStatusAus mit ziel (factory#195)", () => {
  const ausfuehren = (ctx: Record<string, unknown>) => {
    const posts: string[] = [];
    const r = status.fuehreStatusAus(
      { aktion: "anlegen" },
      { repo: "o/n", vorgaenger: null, jetzt: "2026-10-08T12:00:00Z", token: undefined, config: bezieherConfig, io: { gh: (args: string[]) => (posts.push(args.join(" ")), { number: 5, node_id: "N5" }) }, ...ctx },
    );
    return { r, post: posts[0] ?? "" };
  };

  test("label null: der POST trägt kein labels[]", () => {
    const { r, post } = ausfuehren({ ziel: { rolle: "produkt", label: null } });
    expect(r.ok).toBe(true);
    expect(post).toContain("repos/o/n/issues");
    expect(post).not.toContain("labels[]");
  });

  test("ziel mit Label: der POST trägt es", () => {
    expect(ausfuehren({ ziel: { rolle: "factory", label: "area:x" } }).post).toContain("labels[]=area:x");
  });

  test("ohne ziel (Upstream): labels[] = Harness-Label der Config wie bisher", () => {
    expect(ausfuehren({}).post).toContain(`labels[]=${FREMD.labels.harness}`);
  });
});
