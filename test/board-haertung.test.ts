/* Board-Skripte, Härtung (#1392): Query-Syntax-Wächter, freier Todo-Rang, Teilantwort-Verdrahtung, gemeinsame Helfer und die
 * Voraussetzung des Harness-Teils im Board-Takt.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTakt from "../scripts/board-takt.mjs";
import { projektConfig, FREMD_OWNER } from "./support/fremd-config";

const OWNER = FREMD_OWNER;

type Item = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
type Lib = {
  REPO: string;
  ALIAS_MAX: number;
  MUTATION_POSITION: string;
  MUTATION_ADD: string;
  MUTATION_STATUS: string;
  MUTATION_DELETE: string;
  aliasAbfrage: (nummern: number[], repo?: string) => { nummern: number[]; query: string }[];
  afterIdForPosition: (items: Item[], n: number, ohneNr?: number | null) => string | null;
  sammelticketKorrektur: (items: Item[], n: number) => { nr: number; afterId: string | null } | null;
  graphqlTeilantwort: (query: string, opts: unknown, run: (args: string[], opts: unknown) => string) => unknown;
  todoItem: (a: { id: string; number: number; title: string }) => Item;
  positionLautAgentsMd: () => number;
  sammelticketPosition: (text: string) => number;
  gh: unknown;
  ghJson: unknown;
};
const L = rawLib as unknown as Lib;
const takt = rawTakt as unknown as {
  harnessVoraussetzung: (a: { items: Item[] | null }) => { ok: boolean; fehler?: boolean; meldung?: string };
};

/** Klammern `{}` und `()` außerhalb von Strings: nie negativ, am Ende ausgeglichen. */
function klammernBalanciert(query: string): boolean {
  let geschweift = 0;
  let rund = 0;
  let imString = false;
  for (const c of query) {
    if (c === '"') imString = !imString;
    if (imString) continue;
    if (c === "{") geschweift++;
    else if (c === "}") geschweift--;
    else if (c === "(") rund++;
    else if (c === ")") rund--;
    if (geschweift < 0 || rund < 0) return false;
  }
  return geschweift === 0 && rund === 0 && !imString;
}

describe("GraphQL-Syntax-Wächter (#1392 Z10)", () => {
  test("die Hilfsfunktion erkennt eine überzählige und eine fehlende Klammer", () => {
    expect(klammernBalanciert("a{b(c){d}}")).toBe(true);
    expect(klammernBalanciert("a{b(c){d}}}")).toBe(false);
    expect(klammernBalanciert("a{b(c){d}")).toBe(false);
    expect(klammernBalanciert("a(b))(")).toBe(false);
    expect(klammernBalanciert('a{b:"}"}')).toBe(true); // Klammer im String zählt nicht
  });

  test("die Alias-Abfrage ist für eine Nummer und für mehr als ALIAS_MAX Nummern balanciert", () => {
    const eine = L.aliasAbfrage([1392]);
    expect(eine).toHaveLength(1);
    expect(klammernBalanciert(eine[0].query)).toBe(true);
    const viele = L.aliasAbfrage(Array.from({ length: L.ALIAS_MAX + 1 }, (_, i) => i + 1));
    expect(viele).toHaveLength(2);
    for (const b of viele) expect(klammernBalanciert(b.query), b.nummern.join(",")).toBe(true);
  });

  test("die vier Mutationen sind balanciert und tragen ihre Variablen", () => {
    for (const m of [L.MUTATION_POSITION, L.MUTATION_ADD, L.MUTATION_STATUS, L.MUTATION_DELETE]) expect(klammernBalanciert(m), m).toBe(true);
    expect(L.MUTATION_POSITION).toContain("updateProjectV2ItemPosition");
    expect(L.MUTATION_ADD).toContain("addProjectV2ItemById");
    expect(L.MUTATION_STATUS).toContain("updateProjectV2ItemFieldValue");
    expect(L.MUTATION_DELETE).toContain("deleteProjectV2Item");
  });
});

describe("freier Todo-Rang (#1392 Z11)", () => {
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const geclaimt = (number: number) => it(number, { assignees: [OWNER] });
  const SAMMEL = "Harness-Härtung (gesammelt)";

  test("geclaimte Todo-Items zählen im Rang nicht mit", () => {
    const items = [geclaimt(1), geclaimt(2), it(3), it(4), it(5)];
    expect(L.afterIdForPosition(items, 2)).toBe("I3"); // das 1. freie Item ist #3, nicht #1
    expect(L.afterIdForPosition(items, 3)).toBe("I4");
    expect(L.afterIdForPosition(items, 1)).toBeNull();
  });

  test("ohne freies Item: null; geschlossene und fremd-statusierte zählen nicht", () => {
    expect(L.afterIdForPosition([geclaimt(1), geclaimt(2)], 3)).toBeNull();
    expect(L.afterIdForPosition([it(1, { state: "closed" }), it(2, { status: "Done" }), it(3)], 2)).toBe("I3");
  });

  test("das Sammelticket hinter vier geclaimten Items ist nicht „Position 4“, sondern wird vor die freien gezogen", () => {
    const items = [geclaimt(1), geclaimt(2), geclaimt(3), geclaimt(4), it(5), it(6), it(7), it(8), it(9), it(10, { title: SAMMEL })];
    const k = L.sammelticketKorrektur(items, 4);
    expect(k).toMatchObject({ nr: 10 });
    expect(k?.afterId).toBe("I7"); // nach dem 3. freien Item (#5, #6, #7), also als 4. freies
  });

  test("ein Sammelticket, das schon als freies Item auf Position n oder davor steht, wandert nicht (auch nicht vor ein geclaimtes Item)", () => {
    expect(L.sammelticketKorrektur([it(1), geclaimt(2), it(3, { title: SAMMEL })], 4)).toBeNull();
    expect(L.sammelticketKorrektur([it(1), it(2), it(3), it(4, { title: SAMMEL })], 4)).toBeNull();
    expect(L.sammelticketKorrektur([it(1), it(2), it(3), it(4), it(5, { title: SAMMEL })], 4)).toMatchObject({ nr: 5 });
  });
});

describe("graphqlTeilantwort: Verdrahtung des Teilantwort-Pfads (#1392 Z20)", () => {
  const fehlerMitStdout = (stdout: string) => Object.assign(new Error("gh: exit 1"), { stdout });
  const teil = JSON.stringify({ data: { repository: { i0: null } }, errors: [{ type: "NOT_FOUND" }] });

  test("Erfolg: die Antwort wird geparst", () => {
    const run = vi.fn(() => JSON.stringify({ data: { repository: { i0: { number: 1 } } } }));
    expect(L.graphqlTeilantwort("q", {}, run)).toMatchObject({ data: { repository: { i0: { number: 1 } } } });
    expect(run).toHaveBeenCalledOnce();
  });

  test("Exit ≠ 0 mit NOT_FOUND auf stdout: die Teilantwort wird geliefert", () => {
    const run = () => {
      throw fehlerMitStdout(teil);
    };
    expect(L.graphqlTeilantwort("q", {}, run)).toMatchObject({ data: { repository: { i0: null } } });
  });

  test("Rate-Limit neben NOT_FOUND, kaputtes stdout und fehlendes stdout: der Fehler wird weitergeworfen", () => {
    const rate = JSON.stringify({ data: { repository: {} }, errors: [{ type: "NOT_FOUND" }, { type: "RATE_LIMITED" }] });
    for (const stdout of [rate, "kein json", ""]) {
      const run = () => {
        throw fehlerMitStdout(stdout);
      };
      expect(() => L.graphqlTeilantwort("q", {}, run), stdout).toThrow(/gh: exit 1/);
    }
    expect(() =>
      L.graphqlTeilantwort("q", {}, () => {
        throw new Error("Netz weg");
      }),
    ).toThrow(/Netz weg/);
  });

  test("Query und Optionen gehen unverändert an den Runner", () => {
    const run = vi.fn(() => JSON.stringify({ data: { repository: {} } }));
    L.graphqlTeilantwort("query{x}", { token: "t" }, run);
    expect(run).toHaveBeenCalledWith(["api", "graphql", "-f", "query=query{x}"], { token: "t" });
  });
});

describe("gemeinsame Helfer (#1392 Z22, Z23)", () => {
  test("todoItem: offenes, ungeclaimtes Todo-Item mit den übergebenen Feldern", () => {
    expect(L.todoItem({ id: "ITEM_x", number: 7, title: "T" })).toEqual({ id: "ITEM_x", number: 7, status: "Todo", title: "T", assignees: [], state: "open" });
  });

  test("positionLautAgentsMd liest die echte AGENTS.md und stimmt mit sammelticketPosition überein", () => {
    const text = readFileSync(new URL("../AGENTS.md", import.meta.url), "utf8");
    expect(L.positionLautAgentsMd()).toBe(L.sammelticketPosition(text));
    expect(L.positionLautAgentsMd()).toBeGreaterThanOrEqual(1);
  });

  test("gh und ghJson sind exportiert (eine Implementierung für alle Board-Skripte)", () => {
    expect(typeof L.gh).toBe("function");
    expect(typeof L.ghJson).toBe("function");
  });

  test("REPO: GITHUB_REPOSITORY oder das Repo der Projekt-Config, und die Alias-Abfrage nutzt es als Standard", () => {
    expect(L.REPO).toBe(process.env.GITHUB_REPOSITORY || projektConfig().repo);
    const [owner, name] = L.REPO.split("/");
    expect(L.aliasAbfrage([1])[0].query).toContain(`repository(owner:"${owner}",name:"${name}")`);
  });

  test("kein Board-Skript trägt das Repo fest verdrahtet (auch board-lib liest es aus der Projekt-Config)", () => {
    const repo = projektConfig().repo;
    for (const f of ["board-lib", "board-place", "board-takt", "sammelticket-anlegen", "langfuse-takt"]) {
      const quelle = readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8");
      const ohneUrls = quelle.replaceAll(`https://github.com/${repo}`, "");
      expect(ohneUrls, f).not.toContain(`repos/${repo}`);
      expect(ohneUrls, f).not.toContain(`"${repo}"`);
    }
  });
});

describe("Harness-Teil des Takts braucht nur die Board-Liste (#1392 Z24, factory#162)", () => {
  test("board-takt: ohne Token nur eine Warnung (kein Fehler), mit Token läuft der Teil; eine Position braucht der Takt nicht mehr", () => {
    const ohneToken = takt.harnessVoraussetzung({ items: null });
    expect(ohneToken).toMatchObject({ ok: false, fehler: false });
    expect(ohneToken.meldung).toMatch(/^::warning::/);
    expect(takt.harnessVoraussetzung({ items: [] })).toEqual({ ok: true });
  });
});
