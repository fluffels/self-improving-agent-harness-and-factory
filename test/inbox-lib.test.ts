import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/inbox-lib.mjs";
import { FREMD_OWNER } from "./support/fremd-config";

const L = raw as unknown as {
  vertrauteIssues: (s: unknown, owner: string) => { title: string }[];
  offeneTitel: (s: unknown, owner: string) => string[];
  platziereOben: (nr: number, art: string, token?: string) => void;
  sammelticketNummern: (offene: { number: number; titel: string }[]) => number[];
  ladeSammelKontext: (io: { ladeOffene: () => unknown; ladeKommentare: (nr: number) => { user: unknown; body: string; extra?: string }[] }) => { rohe: unknown; offene: { number: number }[]; kommentare: { user: unknown; body: string }[] };
};

const OWNER = FREMD_OWNER;
const issue = (title: string, user: unknown, extra: Record<string, unknown> = {}) => ({ title, user, ...extra });
const bot = { login: "github-actions[bot]", type: "Bot" };

describe("offeneTitel", () => {
  test("Owner und github-actions[bot] zählen, ein Fremder mit gleichem Titel nicht", () => {
    const seiten = [
      [issue("🔒 Security: A", bot), issue("🔒 Security: B", { login: FREMD_OWNER, type: "User" }), issue("🔒 Security: C", { login: "fremd", type: "User" })],
      [issue("🔒 Security: D", null), issue("🔒 Security: E", { login: "github-actions[bot]", type: "User" })],
    ];
    expect(L.offeneTitel(seiten, OWNER)).toEqual(["🔒 Security: A", "🔒 Security: B"]);
  });
  test("PRs fallen weg, auch vertraute", () => {
    expect(L.offeneTitel([[issue("PR", bot, { pull_request: {} })]], OWNER)).toEqual([]);
  });
  test("null-Einträge in den Seiten werden übersprungen, ohne zu werfen", () => {
    expect(L.offeneTitel([[null, issue("🔒 Security: A", bot), undefined]], OWNER)).toEqual(["🔒 Security: A"]);
  });
  test("keine Seitenliste wirft (nie still „keine Titel“)", () => {
    expect(() => L.offeneTitel({}, OWNER)).toThrow();
  });
});

describe("platziereOben", () => {
  test("ohne Token wirft es, bevor etwas startet", () => {
    expect(() => L.platziereOben(1, "security", "")).toThrow(/PROJECT_TOKEN/);
  });
  test("#78: mit repo steht --repo <repo> vor --notfall, ohne repo kein --repo", () => {
    const P = raw as unknown as { platziereOben: (nr: number, art: string, token: string, repo: string | undefined, exec: (...a: unknown[]) => void) => void };
    const aufrufe: string[][] = [];
    const exec = (...a: unknown[]) => void aufrufe.push((a[1] as string[]).slice(1));
    P.platziereOben(5, "security", "t", "zz-org/ziel", exec);
    P.platziereOben(6, "security", "t", undefined, exec);
    expect(aufrufe[0]).toEqual(["--repo", "zz-org/ziel", "--notfall", "security", "--top", "5"]);
    expect(aufrufe[1]).toEqual(["--notfall", "security", "--top", "6"]);
  });
});

describe("sammelticketNummern und ladeSammelKontext (Z3)", () => {
  const T = "Harness-Härtung (gesammelt)";
  test("nur der exakte Titel zählt, auch geclaimte; andere Titel und leere Liste → leer", () => {
    expect(L.sammelticketNummern([{ number: 3, titel: T }, { number: 4, titel: "Langfuse-Befunde (gesammelt)" }, { number: 5, titel: T + " x" }, { number: 9, titel: T }])).toEqual([3, 9]);
    expect(L.sammelticketNummern([])).toEqual([]);
  });
  test("lädt Kommentare nur der Sammeltickets, ungefiltert (user, body), und liefert rohe und normalisierte Seiten", () => {
    const rohe = [[
      { number: 3, title: T, user: bot, assignees: [], created_at: "2026-10-01T00:00:00Z" },
      { number: 4, title: "anderes", user: bot, assignees: [], created_at: "2026-10-01T00:00:00Z" },
    ]];
    const abgefragt: number[] = [];
    const k = L.ladeSammelKontext({
      ladeOffene: () => rohe,
      ladeKommentare: (nr) => {
        abgefragt.push(nr);
        return [{ user: { login: "fremd", type: "User" }, body: "- [ ] x", extra: "fällt weg" }];
      },
    });
    expect(abgefragt).toEqual([3]);
    expect(k.rohe).toBe(rohe);
    expect(k.offene.map((i) => i.number)).toEqual([3, 4]);
    expect(k.kommentare).toEqual([{ user: { login: "fremd", type: "User" }, body: "- [ ] x" }]);
  });
  test("ein werfender Abruf wirft weiter (kein stilles Leer)", () => {
    expect(() => L.ladeSammelKontext({ ladeOffene: () => { throw new Error("gh kaputt"); }, ladeKommentare: () => [] })).toThrow(/gh kaputt/);
  });
});

describe("Ziel-Repo der Sammelticket-Zeilen (#76)", () => {
  test("ladeSammelKontext reicht das Ziel-Repo an den Kommentar-Abruf und liefert dessen Owner", () => {
    const rohe = [[{ number: 3, title: "Harness-Härtung (gesammelt)", user: bot, assignees: [], created_at: "2026-10-01T00:00:00Z" }]];
    const repos: string[] = [];
    const k = L.ladeSammelKontext({
      ladeOffene: () => rohe,
      ladeKommentare: ((nr: number, repo: string) => (repos.push(repo), [])) as unknown as (nr: number) => { user: unknown; body: string }[],
    }) as unknown as { owner: string };
    expect(repos).toHaveLength(1);
    expect(repos[0]).toMatch(/^[^/]+\/[^/]+$/);
    expect(k.owner).toBe(repos[0]?.split("/")[0]);
  });
});

describe("Token für das Ziel-Repo (#78 L13a)", () => {
  test("ladeSammelKontext reicht den Ziel-Token an Offenen- und Kommentar-Abruf", () => {
    const rohe = [[{ number: 3, title: "Harness-Härtung (gesammelt)", user: bot, assignees: [], created_at: "2026-10-01T00:00:00Z" }]];
    const tokens: unknown[] = [];
    L.ladeSammelKontext({
      token: "ziel-token",
      ladeOffene: ((t: unknown) => (tokens.push(t), rohe)) as unknown as () => unknown,
      ladeKommentare: ((_nr: number, _repo: string, t: unknown) => (tokens.push(t), [])) as unknown as (nr: number) => { user: unknown; body: string }[],
    } as unknown as Parameters<typeof L.ladeSammelKontext>[0]);
    expect(tokens).toEqual(["ziel-token", "ziel-token"]);
  });
  test("postZeilen übergibt den Token an gh", () => {
    const P = raw as unknown as { postZeilen: (nr: number, text: string, repo: string, token: string | undefined, exec: (...a: unknown[]) => string) => unknown };
    const aufrufe: { env?: Record<string, string> }[] = [];
    P.postZeilen(5, "x", "zz-org/ziel", "ziel-token", ((_c: unknown, _a: unknown, o: { env?: Record<string, string> }) => (aufrufe.push(o), "")) as never);
    expect(aufrufe[0]?.env?.GH_TOKEN).toBe("ziel-token");
  });
});

describe("waehleSammelticket: das Repo muss owner/name sein (#78)", () => {
  test("ein Repo ohne diese Form wirft mit Fix-Zeile, statt einen falschen Owner zu vertrauen", () => {
    const W = raw as unknown as { waehleSammelticket: (offene: unknown[], repo: string, api: (a: string[]) => unknown) => unknown };
    const offene = [{ number: 5, titel: "Harness-Härtung (gesammelt)", assignees: [], createdAt: "2026-10-01T00:00:00Z" }];
    for (const kaputt of ["ohneOwner", "a/b/c", "/b", ""]) expect(() => W.waehleSammelticket(offene, kaputt, () => ({})), kaputt).toThrow(/owner.name[^]*Fix:/);
  });
});

describe("waehleSammelticket (#76): Vertrauen über den Owner des Ziel-Repos", () => {
  const W = raw as unknown as { waehleSammelticket: (offene: unknown[], repo: string, api: (a: string[]) => unknown) => { number: number } | null };
  const offene = [{ number: 5, titel: "Harness-Härtung (gesammelt)", assignees: [], createdAt: "2026-10-01T00:00:00Z" }];
  const einzel = (login: string) => (args: string[]) => ({ state: "open", assignees: [], user: { login, type: "User" }, args });
  test("ein Ticket des Owners des Ziel-Repos wird gewählt, das Einzelabruf-Repo ist das Ziel-Repo", () => {
    const abgerufen: string[][] = [];
    const r = W.waehleSammelticket(offene, "own-a/ziel", (args) => (abgerufen.push(args), einzel("own-a")(args)));
    expect(r?.number).toBe(5);
    expect(abgerufen[0]).toEqual(["api", "repos/own-a/ziel/issues/5"]);
  });
  test("Negativfall: ein Ticket eines anderen Autors wird nicht gewählt", () => {
    expect(W.waehleSammelticket(offene, "own-a/ziel", einzel("fremd"))).toBeNull();
  });
});
