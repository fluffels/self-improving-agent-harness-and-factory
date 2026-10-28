/* ECHTE_PLACE_IO von board-place (#97 Runde 1): die echte Verdrahtung reicht das Ziel-Repo als 4. Argument an `itemsUeberIssues` durch.
 * gh wird gemockt; geprüft wird die GraphQL-Abfrage, die an `gh` geht. */
import { beforeEach, describe, expect, test, vi } from "vitest";

const aufrufe: string[][] = [];
vi.mock("../scripts/gh-cli.mjs", async (orig) => {
  const echt = await orig<Record<string, unknown>>();
  return {
    ...echt,
    ghText: (args: string[]) => {
      aufrufe.push(args);
      return JSON.stringify({ data: { repository: { i0: null } } });
    },
  };
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPlace from "../scripts/board-place.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";

const P = rawPlace as unknown as { ECHTE_PLACE_IO: { itemsUeberIssues: (b: unknown, n: number[], o: object, repo: string) => unknown[] } };
const L = rawLib as unknown as { boardFuerRolle: (r: string) => unknown };

beforeEach(() => {
  aufrufe.length = 0;
});

describe("ECHTE_PLACE_IO.itemsUeberIssues (#97)", () => {
  test("das Ziel-Repo (4. Argument) steht in der GraphQL-Abfrage, nicht das eigene", () => {
    P.ECHTE_PLACE_IO.itemsUeberIssues(L.boardFuerRolle("factory"), [7], {}, "zz-org/ziel");
    const q = aufrufe.map((a) => a.join(" ")).join("\n");
    expect(q).toContain('repository(owner:"zz-org"');
    expect(q).toContain('name:"ziel"');
  });
});
