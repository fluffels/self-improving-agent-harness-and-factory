/* Gemeinsamer Start der Inbox-Skripte (#1837 L16): Aufruf-Check vor dem Config-Laden, Config- und Lib-Fehler als einheitliche `::error::`-Meldung. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/inbox-start-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBoard from "../scripts/board-lib.mjs";

interface Start { trocken?: boolean; config?: unknown; libs?: unknown; code?: number }
type Deps = { skript: string; praefix: string; ladeConfig?: () => unknown; ladeLibs?: () => Promise<unknown>; log: (s: string) => void; err: (s: string) => void };
const L = rawLib as unknown as { inboxStart: (argv: string[], deps: Deps) => Promise<Start>; ladeBoardLibs: () => Promise<unknown> };

function deps(extra: Partial<Deps> = {}) {
  const log: string[] = [];
  const err: string[] = [];
  const geladen = { config: 0, libs: 0 };
  const d: Deps = {
    skript: "demo",
    praefix: "Demo: Projekt-Config nicht lesbar: ",
    ladeConfig: () => { geladen.config++; return { c: 1 }; },
    ladeLibs: () => { geladen.libs++; return Promise.resolve({ l: 1 }); },
    log: (s) => log.push(s),
    err: (s) => err.push(s),
    ...extra,
  };
  return { d, log, err, geladen };
}

describe("inboxStart", () => {
  test("Gutfall: Config und Libs geladen, trocken aus --dry-run", async () => {
    const { d, log, err } = deps();
    expect(await L.inboxStart(["--dry-run"], d)).toEqual({ trocken: true, config: { c: 1 }, libs: { l: 1 } });
    expect((await L.inboxStart([], d)).trocken).toBe(false);
    expect([log, err]).toEqual([[], []]);
  });

  test("Aufruf-Fehler: Aufrufzeile auf err, Code 2, weder Config noch Libs geladen", async () => {
    const { d, log, err, geladen } = deps();
    expect(await L.inboxStart(["--bogus"], d)).toEqual({ code: 2 });
    expect(err).toEqual(["Unbekanntes Argument: --bogus\nAufruf: node scripts/demo.mjs [--dry-run]"]);
    expect(log).toEqual([]);
    expect(geladen).toEqual({ config: 0, libs: 0 });
  });

  test("Config-Fehler: ::error:: mit Präfix, Code 2, Libs nie importiert", async () => {
    const { d, log, geladen } = deps({ ladeConfig: () => { throw new Error("Projekt-Config fehlt: x\nFix: anlegen"); } });
    expect(await L.inboxStart([], d)).toEqual({ code: 2 });
    expect(log).toEqual(["::error::Demo: Projekt-Config nicht lesbar: Projekt-Config fehlt: x\nFix: anlegen"]);
    expect(geladen.libs).toBe(0);
  });

  test("Lib-Import-Fehler: gleiche Meldungsform, Code 2", async () => {
    const { d, log } = deps({ ladeLibs: () => Promise.reject(new Error("Import kaputt")) });
    expect(await L.inboxStart([], d)).toEqual({ code: 2 });
    expect(log).toEqual(["::error::Demo: Projekt-Config nicht lesbar: Import kaputt"]);
  });
});

describe("ladeProjektOderAbbruch (board-lib, Config-Fehler beim Import)", () => {
  const B = rawBoard as unknown as { ladeProjektOderAbbruch: (lade: () => unknown, naehte: { exit: (c: number) => never; err: (s: string) => void }) => unknown };
  const stopp = (c: number): never => { throw new Error(`exit ${c}`); };

  test("Gutfall: liefert die Config, ruft weder exit noch err", () => {
    const err: string[] = [];
    expect(B.ladeProjektOderAbbruch(() => ({ repo: "a/b" }), { exit: stopp, err: (s) => err.push(s) })).toEqual({ repo: "a/b" });
    expect(err).toEqual([]);
  });

  test("Config-Fehler: ✖-Zeile mit Meldung samt Fix auf err und Exit 2 (Aufruf-/Config-Fehler, nicht 1)", () => {
    const err: string[] = [];
    expect(() => B.ladeProjektOderAbbruch(() => { throw new Error("Projekt-Config fehlt: x\nFix: anlegen"); }, { exit: stopp, err: (s) => err.push(s) })).toThrow("exit 2");
    expect(err).toEqual(["✖ Projekt-Config fehlt: x\nFix: anlegen"]);
  });

  test("ein Nicht-Error als Wurf wird als Text gemeldet", () => {
    const err: string[] = [];
    // Absicht: genau der Nicht-Error-Wurf ist der Zweig unter Test.
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    expect(() => B.ladeProjektOderAbbruch(() => { throw "kaputt"; }, { exit: stopp, err: (s) => err.push(s) })).toThrow("exit 2");
    expect(err).toEqual(["✖ kaputt"]);
  });
});

describe("zielZugang", () => {
  const Z = rawLib as unknown as { zielZugang: (l: Record<string, unknown>) => { ziel: string; zielOpt: { token: string | undefined } } };
  test("Ziel-Repo und dessen Token, wenn die Libs sie liefern", () => {
    expect(Z.zielZugang({ REPO: "o/r", ZIEL: "o/ziel", zielToken: () => "t" })).toEqual({ ziel: "o/ziel", zielOpt: { token: "t" } });
  });
  test("ohne ZIEL und zielToken: eigenes Repo, kein Token", () => {
    expect(Z.zielZugang({ REPO: "o/r" })).toEqual({ ziel: "o/r", zielOpt: { token: undefined } });
  });
});

describe("zielAktionen und vertrauterOwner", () => {
  const A = rawLib as unknown as {
    zielAktionen: (a: { gh: { text: (a: string[], o: unknown) => string; json: (a: string[], o: unknown) => unknown }; libs: Record<string, unknown>; label?: string }) => Record<string, (...a: unknown[]) => unknown>;
    vertrauterOwner: (k: { owner?: string }, l: { OWNER: string }) => string;
  };
  const aufbau = (libs: Record<string, unknown> = {}, label?: string) => {
    const aufrufe: { args: string[]; opt: unknown }[] = [];
    const platziert: unknown[][] = [];
    const gh = {
      text: (args: string[], opt: unknown) => (aufrufe.push({ args, opt }), "https://github.com/o/ziel/issues/77\n"),
      json: (args: string[], opt: unknown) => (aufrufe.push({ args, opt }), { body: "alt" }),
    };
    const alle = { REPO: "o/r", ZIEL: "o/ziel", zielToken: () => "zt", platziereOben: (...a: unknown[]) => platziert.push(a), ...libs };
    return { aktion: A.zielAktionen({ gh, libs: alle, label }), aufrufe, platziert };
  };
  test("alle Aktionen gehen mit dem Ziel-Token ins Ziel-Repo, nie ins eigene", () => {
    const { aktion, aufrufe } = aufbau({}, "L");
    expect(aktion.holeBody(6)).toBe("alt");
    expect(aktion.legeIssueAn("T", "B")).toBe("77");
    aktion.aktualisiere(6, "neu");
    aktion.kommentiere(6, "k");
    aktion.schliesse(6, "weg");
    expect(aufrufe.map((a) => a.args.join(" "))).toEqual([
      "api repos/o/ziel/issues/6",
      "issue create --repo o/ziel --title T --label L --body B",
      "api -X PATCH repos/o/ziel/issues/6 -f body=neu",
      "api repos/o/ziel/issues/6/comments -f body=k",
      "issue close 6 --repo o/ziel --reason completed --comment weg",
    ]);
    for (const a of aufrufe) expect(a.opt).toEqual({ token: "zt" });
  });
  test("aktualisiere: -f title= nur mit Titel, vor dem Body (#101 L18)", () => {
    const { aktion, aufrufe } = aufbau();
    aktion.aktualisiere(6, "neu", "Neuer Titel");
    aktion.aktualisiere(6, "neu", undefined);
    expect(aufrufe.map((a) => a.args.join(" "))).toEqual([
      "api -X PATCH repos/o/ziel/issues/6 -f title=Neuer Titel -f body=neu",
      "api -X PATCH repos/o/ziel/issues/6 -f body=neu",
    ]);
  });
  test("ohne Label kein --label", () => {
    const { aktion, aufrufe } = aufbau();
    aktion.legeIssueAn("T", "B");
    expect(aufrufe[0].args).not.toContain("--label");
  });
  test("platziere: Ziel-Repo als viertes Argument, beim eigenen Repo keines", () => {
    const a = aufbau();
    a.aktion.platziere(5, "security");
    expect(a.platziert).toEqual([[5, "security", process.env.PROJECT_TOKEN, "o/ziel"]]);
    const b = aufbau({ ZIEL: undefined });
    b.aktion.platziere(5, "security");
    expect(b.platziert[0][3]).toBeUndefined();
  });
  test("vertrauterOwner: Owner des Ziel-Repos, sonst der eigene", () => {
    expect(A.vertrauterOwner({ owner: "z" }, { OWNER: "o" })).toBe("z");
    expect(A.vertrauterOwner({}, { OWNER: "o" })).toBe("o");
  });
});

describe("bestaetigeAnlegen (#101 L17, fail-closed, gemeinsam für Status- und Tag-Takt)", () => {
  type E = { aktion: string; grund: string; warnungen: string[] };
  const B = rawLib as unknown as { bestaetigeAnlegen: (e: E, a: { zweit: () => unknown; passt: (i: { number: number; titel: string }) => boolean; was?: string }) => E };
  const anlegen: E = { aktion: "anlegen", grund: "g", warnungen: ["alt"] };
  const passt = (i: { titel: string }) => i.titel === "X";
  test("Zweitabfrage wirft: nichts, alte Warnung bleibt, Fehlertext in der Warnung", () => {
    const r = B.bestaetigeAnlegen(anlegen, { zweit: () => { throw new Error("Rate-Limit"); }, passt });
    expect(r.aktion).toBe("nichts");
    expect(r.warnungen).toHaveLength(2);
    expect(r.warnungen[0]).toBe("alt");
    expect(r.warnungen[1]).toContain("Rate-Limit");
  });
  test("keine Liste (undefined, null, Objekt): wie ein Fehler, nichts", () => {
    for (const antwort of [undefined, null, {}]) expect(B.bestaetigeAnlegen(anlegen, { zweit: () => antwort, passt }).aktion, JSON.stringify(antwort) ?? "undefined").toBe("nichts");
  });
  test("Treffer: nichts mit Nummern in Grund und Warnung, das Wort `was` in der Warnung", () => {
    const r = B.bestaetigeAnlegen(anlegen, { zweit: () => [{ number: 9, titel: "X" }, { number: 10, titel: "Y" }], passt, was: "Demo-Ticket" });
    expect(r.aktion).toBe("nichts");
    expect(r.grund).toContain("#9");
    expect(r.grund).not.toContain("#10");
    expect(r.warnungen[1]).toContain("Demo-Ticket #9");
  });
  test("kein Treffer: dieselbe Entscheidung zurück; andere Aktionen fragen nie", () => {
    expect(B.bestaetigeAnlegen(anlegen, { zweit: () => [{ number: 1, titel: "Y" }], passt })).toBe(anlegen);
    const nichts: E = { aktion: "nach-oben", grund: "g", warnungen: [] };
    expect(B.bestaetigeAnlegen(nichts, { zweit: () => { throw new Error("nie fragen"); }, passt })).toBe(nichts);
  });
});
