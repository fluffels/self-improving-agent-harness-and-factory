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
    env: {},
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

describe("main: Token fürs Ziel-Repo (#97)", () => {
  test("ein fremdes Ziel-Repo nutzt PROJECT_TOKEN als GH_TOKEN, das eigene den Standard (undefined)", async () => {
    const fremd: Record<string, string> = { PROJECT_TOKEN: "pt" };
    await main(["--repo", "zz-org/ziel", "--top", "5"], aufbau({ env: fremd }).deps);
    expect(fremd.GH_TOKEN).toBe("pt");
    const eigen: Record<string, string> = { PROJECT_TOKEN: "pt" };
    await main(["--top", "5"], aufbau({ env: eigen }).deps);
    expect(eigen.GH_TOKEN).toBeUndefined();
    const ohne: Record<string, string> = {};
    await main(["--repo", "zz-org/ziel", "--top", "5"], aufbau({ env: ohne }).deps);
    expect(ohne.GH_TOKEN).toBeUndefined();
  });

  test("ohne Ziel-Token bleibt ein vorhandener Standard-GH_TOKEN unverändert (kein Überschreiben mit undefined)", async () => {
    const eigen: Record<string, string> = { GH_TOKEN: "std", PROJECT_TOKEN: "pt" };
    await main(["--top", "5"], aufbau({ env: eigen }).deps);
    expect(eigen.GH_TOKEN).toBe("std");
    const fremdOhne: Record<string, string> = { GH_TOKEN: "std" };
    await main(["--repo", "zz-org/ziel", "--top", "5"], aufbau({ env: fremdOhne }).deps);
    expect(fremdOhne.GH_TOKEN).toBe("std");
    expect(Object.keys(fremdOhne)).toEqual(["GH_TOKEN"]);
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

describe("--missing --json (factory#490)", () => {
  const P = (raw as unknown as { parseArgs: (a: string[]) => Record<string, unknown> | null }).parseArgs;
  const fehlendJson = (raw as unknown as { fehlendJson: (m: number[]) => string }).fehlendJson;

  test("parseArgs: --json nur mit --missing; ohne --json bleibt das Ergebnis unverändert", () => {
    expect(P(["--missing", "--json"])).toMatchObject({ missing: true, json: true });
    expect(P(["--json", "--missing"])).toMatchObject({ missing: true, json: true });
    expect(P(["--missing"])).toEqual({ missing: true, dry: false });
    expect(P(["--top", "5", "--json"])).toBeNull();
    expect(P(["--json"])).toBeNull();
  });
  test("fehlendAusgabe: JSON mit --json, sonst der Satz (leer und mit Nummern)", () => {
    const aus = (raw as unknown as { fehlendAusgabe: (m: number[], j: boolean) => string }).fehlendAusgabe;
    expect(JSON.parse(aus([5], true))).toEqual({ fehlend: [5] });
    expect(JSON.parse(aus([], true))).toEqual({ fehlend: [] });
    expect(aus([], false)).toBe("Alle offenen Issues stehen im Board.");
    expect(aus([5, 8], false)).toBe("Offen, aber nicht im Board: #5, #8");
  });
  test("reportMissing: json=true gibt JSON aus, sonst den Satz; ein Ladefehler bricht mit Exit 1 ab", () => {
    const rm = (raw as unknown as { reportMissing: (r: string, j: boolean, io: Record<string, unknown>) => void }).reportMissing;
    const rollen: unknown[] = [];
    const io = (log: (z: string) => void) => ({ ladeItems: (b: unknown) => (rollen.push(b), []), offene: () => [4, 6], ueberIssues: () => [{ number: 6 }], log });
    const aus: string[] = [];
    rm("acme/proj", true, io((z) => aus.push(z)));
    rm("acme/proj", false, io((z) => aus.push(z)));
    expect(aus).toHaveLength(2);
    expect(new Set(rollen.map((b) => JSON.stringify(b))).size).toBe(2); // beide Boards (Produkt und Fabrik) werden gelesen
    expect((JSON.parse(aus[0]) as { fehlend: unknown }).fehlend).toEqual([4]);
    expect(aus[1]).toBe("Offen, aber nicht im Board: #4");
    expect(() => void JSON.parse(aus[1])).toThrow();
  });
  test("main reicht json an reportMissing; fehlendJson trägt die Nummern unter fehlend", async () => {
    const gesehen: unknown[][] = [];
    const a = aufbau({ reportMissing: (...args: unknown[]) => void gesehen.push(args) });
    await main(["--missing", "--json"], a.deps);
    await main(["--missing"], a.deps);
    expect(gesehen.map((g) => g[1])).toEqual([true, false]);
    expect(JSON.parse(fehlendJson([3, 7]))).toEqual({ fehlend: [3, 7] });
    expect(JSON.parse(fehlendJson([]))).toEqual({ fehlend: [] });
  });
});
