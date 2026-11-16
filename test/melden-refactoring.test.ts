import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMelden from "../scripts/melden.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTitel from "../scripts/sammelticket-titel.mjs";

type Aufruf = { name: string; args: unknown[] };
type Ergebnis = { code: number; aufrufe: Aufruf[]; log: string; err: string };
const melden = rawMelden as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> };
const REFACTORING_TITEL_AKZEPTIERT = (rawTitel as unknown as { REFACTORING_TITEL_AKZEPTIERT: string[] }).REFACTORING_TITEL_AKZEPTIERT;
const HEUTE = "2026-11-10";


function lauf(argv: string[], opt: { config?: unknown; bezieher?: boolean; offen?: number | null; pruefeOk?: boolean } = {}): Promise<Ergebnis> {
  const aufrufe: Aufruf[] = [];
  const log: string[] = [];
  const err: string[] = [];
  const spy = (name: string, wert?: unknown) => (...args: unknown[]) => (aufrufe.push({ name, args }), wert);
  const libs = {
    MELDESTELLE: "fabrik/stelle",
    REPO: "eigen/repo",
    ladeSammelKontext: spy("ladeSammelKontext", { offen: true, offene: [] }),
    waehleSammelticket: spy("waehleSammelticket", opt.offen === null ? undefined : { number: opt.offen ?? 7 }),
    postZeilen: spy("postZeilen"),
  };
  const deps = {
    ladeConfig: () => opt.config ?? {},
    ladeLibs: () => (aufrufe.push({ name: "ladeLibs", args: [] }), Promise.resolve(libs)),
    env: {},
    log: (s: string) => log.push(s),
    err: (s: string) => err.push(s),
    heute: () => HEUTE,
    bezieher: () => opt.bezieher ?? true,
    bereite: (z: string[], o: unknown) => (aufrufe.push({ name: "bereite", args: [z, o] }), opt.pruefeOk === false ? { ok: false, grund: "internes Wort" } : { ok: true, text: z.join("\n") }),
  };
  return melden.main(argv, deps).then((code) => ({ code, aufrufe, log: log.join("\n"), err: err.join("\n") }));
}
const namen = (a: Aufruf[]) => a.map((x) => x.name);
const ARGV = ["--ziel", "refactoring", "--zeile", "Kosmetik: x Beleg: y1"];

describe("melden.mjs --ziel refactoring", () => {
  test("zielt auf das eigene Repo und die Refactoring-Titel, nie auf die Meldestelle", async () => {
    const r = await lauf(ARGV);
    expect(r.code).toBe(0);
    const wahl = r.aufrufe.find((a) => a.name === "waehleSammelticket")!;
    expect(wahl.args[1]).toBe("eigen/repo");
    expect(wahl.args[3]).toEqual(REFACTORING_TITEL_AKZEPTIERT);
    const kontext = r.aufrufe.find((a) => a.name === "ladeSammelKontext")!;
    expect(kontext.args[0]).toMatchObject({ repo: "eigen/repo", titel: REFACTORING_TITEL_AKZEPTIERT });
    expect((kontext.args[0] as { token?: unknown }).token).toBeUndefined();
    const post = r.aufrufe.find((a) => a.name === "postZeilen")!;
    expect(post.args[0]).toBe(7);
    expect(post.args[2]).toBe("eigen/repo");
    expect(post.args[3]).toBeUndefined();
    const bereite = r.aufrufe.find((a) => a.name === "bereite")!;
    expect(bereite.args[1]).toMatchObject({ stand: null, herkunft: null, eigenes: "eigen/repo" });
  });
  test("check-internalrefs: Treffer, Exit 1, kein Post", async () => {
    const r = await lauf(ARGV, { pruefeOk: false });
    expect(r.code).toBe(1);
    expect(namen(r.aufrufe)).not.toContain("postZeilen");
  });
  test("Kosmetik ohne Verfall bekommt heute plus 28 Tage", async () => {
    const r = await lauf(ARGV);
    expect(r.aufrufe.find((a) => a.name === "bereite")!.args[0]).toEqual(["- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-12-08"]);
  });
  test("Zeile ohne Klasse oder Beleg: Exit 2, nichts geladen, bereitet oder gepostet", async () => {
    const r = await lauf(["--ziel", "refactoring", "--zeile", "kaputt"]);
    expect(r.code).toBe(2);
    expect(r.aufrufe).toEqual([]);
  });
  test("labels.refactoring false: Exit 0 abgeschaltet, nichts gepostet, kein Fehler", async () => {
    const r = await lauf(ARGV, { config: { labels: { refactoring: false } } });
    expect(r.code).toBe(0);
    expect(r.log).toMatch(/abgeschaltet/);
    expect(r.err).toBe("");
    expect(r.aufrufe).toEqual([]);
  });
  test("Fabrik ohne Schlüssel: Exit 0 abgeschaltet mit Hinweis auf --ziel harness", async () => {
    const r = await lauf(ARGV, { bezieher: false });
    expect(r.code).toBe(0);
    expect(r.log).toMatch(/abgeschaltet/);
    expect(r.log).toMatch(/--ziel harness/);
    expect(r.err).toBe("");
    expect(r.aufrufe).toEqual([]);
  });
  test("kein ungeclaimtes Ticket: Exit 1 mit Fix für sammelticket-anlegen refactoring", async () => {
    const r = await lauf(ARGV, { offen: null });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/sammelticket-anlegen\.mjs refactoring/);
    expect(r.err).toMatch(/Refactoring/);
    expect(namen(r.aufrufe)).not.toContain("postZeilen");
  });
  test("unbekanntes Ziel: Exit 2 mit Aufrufzeile", async () => {
    const r = await lauf(["--ziel", "quatsch", "--zeile", "Kosmetik: x Beleg: y1"]);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/Aufruf:/);
    expect(r.aufrufe).toEqual([]);
  });
  test("ohne --ziel unverändert: Meldestelle", async () => {
    const r = await lauf(["--zeile", "Kosmetik: x Beleg: y1"]);
    expect(r.code).toBe(0);
    expect(r.aufrufe.find((a) => a.name === "waehleSammelticket")!.args[1]).toBe("fabrik/stelle");
    expect(r.aufrufe.find((a) => a.name === "postZeilen")!.args[2]).toBe("fabrik/stelle");
  });
});
