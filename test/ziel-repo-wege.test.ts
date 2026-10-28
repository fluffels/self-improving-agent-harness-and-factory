/* Ziel-Repo-Wege (#97 G2): der Quoten-Leser mit Token je Repo und die Pflicht des Repos in den Board-Lesern (kein stiller Standard). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as quote from "../scripts/produktquote-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardLib from "../scripts/board-lib.mjs";

const Q = quote as unknown as { quotenCommitLeser: (a: { gh: (args: string[], o: { token?: string }) => unknown[]; repo: string; since: string; env: Record<string, string> }) => (r: string) => unknown[] };
const B = boardLib as unknown as { loadOpenIssuePages: (repo?: string, o?: object) => unknown; loadOpenIssueNumbers: (repo?: string) => unknown; itemsUeberIssues: (b: unknown, n: number[], o: object, repo?: string) => unknown; boardFuerRolle: (r: string) => unknown };

describe("quotenCommitLeser (#97 L11 b/d)", () => {
  const aufrufe: { args: string[]; token?: string }[] = [];
  const gh = (args: string[], o: { token?: string }) => (aufrufe.push({ args, token: o.token }), [[{ n: 1 }], [{ n: 2 }]]);
  test("liest die Commits von main seit `since`, flach, mit dem Token des Ziel-Repos aus der übergebenen env", () => {
    const lies = Q.quotenCommitLeser({ gh, repo: "zz-org/a", since: "2026-10-01T00:00:00Z", env: { PROJECT_TOKEN: "pt" } });
    expect(lies("zz-org/b")).toEqual([{ n: 1 }, { n: 2 }]);
    expect(lies("ZZ-ORG/A")).toHaveLength(2);
    expect(aufrufe[0]?.args.at(-1)).toBe("repos/zz-org/b/commits?sha=main&since=2026-10-01T00:00:00Z&per_page=100");
    expect(aufrufe.map((a) => a.token)).toEqual(["pt", undefined]);
  });
});

describe("Board-Leser verlangen das Repo (#97 L11 g)", () => {
  test("loadOpenIssuePages, loadOpenIssueNumbers und itemsUeberIssues ohne repo werfen mit Fix-Zeile, bevor sie gh rufen", () => {
    expect(() => B.loadOpenIssuePages()).toThrow(/loadOpenIssuePages: repo fehlt\nFix:/);
    expect(() => B.loadOpenIssueNumbers()).toThrow(/loadOpenIssuePages: repo fehlt\nFix:/);
    expect(() => B.itemsUeberIssues(B.boardFuerRolle("factory"), [1], {})).toThrow(/itemsUeberIssues: repo fehlt\nFix:/);
  });
});
