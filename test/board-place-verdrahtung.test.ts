/* Verdrahtung von `board-place` main (#78 L13h): das Ziel-Repo (`--repo`, Standard das eigene) erreicht jeden Modus; Exit-Codes laufen über `beende`. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-place.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as boardLib from "../scripts/board-lib.mjs";

const main = (raw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<unknown> }).main;
const EIGENES = (boardLib as unknown as { REPO: string }).REPO;

function aufbau(extra: Record<string, unknown> = {}) {
  const aufrufe: { was: string; args?: Record<string, unknown> }[] = [];
  const exits: number[] = [];
  const deps = {
    kontingent: () => undefined,
    ladeConfig: () => ({ marker: "config" }),
    einsortieren: (args: Record<string, unknown>, config: unknown) => void aufrufe.push({ was: "einsortieren", args: { ...args, config } }),
    reportMissing: (repo: string) => void aufrufe.push({ was: "missing", args: { repo } }),
    umziehen: (args: Record<string, unknown>) => void aufrufe.push({ was: "umzug", args }),
    mitWiederholung: (fn: () => unknown) => fn(),
    beende: (c: number) => void exits.push(c),
    ...extra,
  };
  return { aufrufe, exits, deps };
}

describe("main: das Ziel-Repo wird an jeden Modus durchgereicht", () => {
  test("--repo geht an einsortieren, missing und umzug", async () => {
    const a = aufbau();
    await main(["--repo", "zz-org/ziel", "--top", "5"], a.deps);
    await main(["--repo", "zz-org/ziel", "--missing"], a.deps);
    await main(["--repo", "zz-org/ziel", "--umzug"], a.deps);
    expect(a.aufrufe.map((x) => [x.was, x.args?.repo])).toEqual([["einsortieren", "zz-org/ziel"], ["missing", "zz-org/ziel"], ["umzug", "zz-org/ziel"]]);
    expect(a.aufrufe[0]?.args?.config).toEqual({ marker: "config" });
    expect(a.exits).toEqual([]);
  });
  test("ohne --repo gilt das eigene Repo", async () => {
    const a = aufbau();
    await main(["--top", "5"], a.deps);
    await main(["--missing"], a.deps);
    expect(a.aufrufe.map((x) => x.args?.repo)).toEqual([EIGENES, EIGENES]);
  });
});

describe("main: Fehlerwege laufen über beende", () => {
  test("falscher Aufruf und Repo ohne owner/name: Exit 2, nichts ausgeführt", async () => {
    for (const argv of [["--quatsch"], ["--repo", "ohneOwner", "--top", "5"], []]) {
      const a = aufbau({ kontingent: () => { throw new Error("nie"); } });
      await main(argv, a.deps);
      expect(a.exits, argv.join(" ")).toEqual([2]);
      expect(a.aufrufe).toEqual([]);
    }
  });
  test("Fehler mit exitCode: Meldung und dieser Code; Fehler ohne: Code 1", async () => {
    const mit = aufbau({ einsortieren: () => { throw Object.assign(new Error("Anker fehlt"), { exitCode: 2 }); } });
    await main(["--top", "5"], mit.deps);
    expect(mit.exits).toEqual([2]);
    const ohne = aufbau({ umziehen: () => { throw new Error("Command failed"); } });
    await main(["--umzug"], ohne.deps);
    expect(ohne.exits).toEqual([1]);
  });
});
