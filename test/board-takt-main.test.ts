/* Einstieg `main(env, nähte)` des Board-Takts (#101 L4e, L6c): die Umgebung kommt aus dem injizierten `env`, nie aus `process.env`. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-takt.mjs";
import { FREMD } from "./support/fremd-config";

type Env = Record<string, string>;
type Aufruf = { jetzt: Date; dry: boolean; repo: string; ausloeser: string; token?: string; io: { env: Env; marker?: string }; config: unknown };
const T = raw as unknown as {
  ECHTE_IO: { env: unknown };
  main: (env: Env, n: Record<string, unknown>) => number;
};

function aufbau(ergebnis: { fehler: boolean } = { fehler: false }) {
  const lauf: Aufruf[] = [];
  const kontingent: { name: string; opt: unknown }[] = [];
  const err: string[] = [];
  const naehte = {
    argv: [] as string[],
    io: { marker: "m" },
    kontingent: (name: string, opt: unknown) => { kontingent.push({ name, opt }); },
    lauf: (a: Aufruf) => { lauf.push(a); return ergebnis; },
    ladeConfig: () => FREMD,
    err: (s: string) => err.push(s),
    jetzt: () => new Date("2026-10-08T12:00:00Z"),
  };
  return { naehte, lauf, kontingent, err };
}

describe("board-takt main", () => {
  test("das injizierte env gibt Token, Auslöser und io.env vor (nicht process.env); Kontingent mit dem Token", () => {
    const a = aufbau();
    const env = { PROJECT_TOKEN: "pt", GITHUB_EVENT_NAME: "push" };
    expect(T.main(env, a.naehte)).toBe(0);
    expect(a.kontingent).toEqual([{ name: "board-takt", opt: { token: "pt" } }]);
    expect(a.lauf).toHaveLength(1);
    expect(a.lauf[0]).toMatchObject({ dry: false, ausloeser: "push", token: "pt", config: FREMD });
    expect(a.lauf[0].io.env).toBe(env);
    expect(a.lauf[0].io.marker).toBe("m");
    expect(a.lauf[0].jetzt).toEqual(new Date("2026-10-08T12:00:00Z"));
  });
  test("ohne Token und Event: schedule, kein Kontingent, --dry-run kommt an", () => {
    const a = aufbau();
    a.naehte.argv = ["--dry-run"];
    expect(T.main({}, a.naehte)).toBe(0);
    expect(a.kontingent).toEqual([]);
    expect(a.lauf[0]).toMatchObject({ dry: true, ausloeser: "schedule", token: undefined });
  });
  test("Fehler im Lauf: Exit 1", () => {
    expect(T.main({}, aufbau({ fehler: true }).naehte)).toBe(1);
  });
  test("falscher Aufruf: Meldung auf err, Exit 2, weder Kontingent noch Lauf", () => {
    const a = aufbau();
    a.naehte.argv = ["--bogus"];
    expect(T.main({ PROJECT_TOKEN: "pt" }, a.naehte)).toBe(2);
    expect(a.err[0]).toContain("board-takt: Unbekanntes Argument: --bogus");
    expect(a.err[0]).toContain("Aufruf: node scripts/board-takt.mjs [--dry-run]");
    expect([a.kontingent, a.lauf]).toEqual([[], []]);
  });
  test("ECHTE_IO bringt die Prozess-Umgebung als env mit (Standard, wenn main kein io bekommt)", () => {
    expect(T.ECHTE_IO.env).toBe(process.env);
  });
});

describe("ersterCommitDatum (#101 L31)", () => {
  const E = raw as unknown as { ersterCommitDatum: (git: (a: string[]) => string) => string | null };
  test("fragt die Root-Commits von HEAD ab und nimmt das früheste Datum (auch bei verschiedenen Zeitzonen)", () => {
    const argumente: string[][] = [];
    const git = (a: string[]) => (argumente.push(a), "2026-10-26T19:26:44+01:00\r\n2026-10-26T17:00:00Z\n\n");
    expect(E.ersterCommitDatum(git)).toBe("2026-10-26T17:00:00Z");
    expect(argumente).toEqual([["log", "--max-parents=0", "--format=%cI", "HEAD"]]);
  });
  test("git wirft oder liefert nichts Lesbares: null", () => {
    expect(E.ersterCommitDatum(() => { throw new Error("shallow"); })).toBeNull();
    expect(E.ersterCommitDatum(() => "")).toBeNull();
    expect(E.ersterCommitDatum(() => "kein Datum\n")).toBeNull();
  });
  test("ECHTE_IO trägt die Funktion als ersterCommitDatum", () => {
    expect((raw as { ECHTE_IO: { ersterCommitDatum: unknown } }).ECHTE_IO.ersterCommitDatum).toBe(E.ersterCommitDatum);
  });
});
