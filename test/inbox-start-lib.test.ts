/* Gemeinsamer Start der Inbox-Skripte (#1837 L16): Aufruf-Check vor dem Config-Laden, Config- und Lib-Fehler als einheitliche `::error::`-Meldung. */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawStand from "../scripts/sync-stand-lib.mjs";
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

describe("sicherheitsLibs (factory#153): Sicherheitsfunde bleiben im Bezieher im eigenen Repo", () => {
  type Fn = (...a: unknown[]) => unknown;
  type Libs = { REPO: string; ZIEL: string; SAMMELTICKET_TITEL_LISTE?: string[]; zielToken: Fn; ladeSammelKontext: Fn; postZeilen: Fn; waehleSammelticket: Fn; platziereAmEnde: Fn; frischeOffeneIssues?: Fn };
  const S = rawLib as unknown as { sicherheitsLibs: (libs: Libs, opt?: { bezieher?: boolean; gh?: { text: (a: string[]) => string }; log?: (s: string) => void }) => Libs; REST_TITEL: string };
  const aufbau = () => {
    const aufrufe: { name: string; args: unknown[] }[] = [];
    const libs: Libs = {
      REPO: "own-a/proj",
      ZIEL: "zz-org/fabrik",
      SAMMELTICKET_TITEL_LISTE: ["Harness-Härtung (gesammelt)"],
      zielToken: (...a: unknown[]) => (aufrufe.push({ name: "zielToken", args: a }), a[0] === "own-a/proj" ? undefined : "pt"),
      ladeSammelKontext: (...a: unknown[]) => (aufrufe.push({ name: "ladeSammelKontext", args: a }), { offene: [] }),
      postZeilen: (...a: unknown[]) => (aufrufe.push({ name: "postZeilen", args: a }), ""),
      waehleSammelticket: (...a: unknown[]) => (aufrufe.push({ name: "waehleSammelticket", args: a }), null),
      platziereAmEnde: (...a: unknown[]) => void aufrufe.push({ name: "platziereAmEnde", args: a }),
      frischeOffeneIssues: () => [],
    };
    return { libs, aufrufe };
  };
  const von = (aufrufe: { name: string; args: unknown[] }[], name: string) => aufrufe.filter((a) => a.name === name).map((a) => a.args);

  test("Fabrik (kein Bezieher): dieselben Libs, nichts ersetzt (Negativtest)", () => {
    const { libs } = aufbau();
    expect(S.sicherheitsLibs(libs, { bezieher: false })).toBe(libs);
  });

  test("Standard: ohne Angabe entscheidet der Sync-Stand dieses Repos (Bezieher: ersetzt, Fabrik: dieselben Libs)", () => {
    const { libs } = aufbau();
    const wurzel = fileURLToPath(new URL("..", import.meta.url));
    expect(S.sicherheitsLibs(libs) === libs).toBe(!(rawStand as unknown as { istBezieher: (w: string) => boolean }).istBezieher(wurzel));
  });

  test("Standard in einem echten Bezieher (Kopie der Skripte mit Sync-Stand): ohne Angabe wird ersetzt, ohne Sync-Stand nicht (der Default zeigt auf die Repo-Wurzel)", { timeout: 60_000 }, () => {
    const dir = mkdtempSync(join(tmpdir(), "sicherheitslibs-"));
    try {
      cpSync(join(fileURLToPath(new URL("..", import.meta.url)), "scripts"), join(dir, "scripts"), { recursive: true });
      writeFileSync(join(dir, "pruefe.mjs"), 'import { sicherheitsLibs } from "./scripts/inbox-start-lib.mjs";\nconst libs = { REPO: "acme/proj", ZIEL: "fabrik/eingang", zielToken: () => undefined };\nconsole.log(JSON.stringify(sicherheitsLibs(libs).ZIEL));\n');
      const lauf = () => spawnSync(process.execPath, [join(dir, "pruefe.mjs")], { encoding: "utf8", cwd: tmpdir(), timeout: 30_000 }).stdout.trim();
      expect(lauf()).toBe('"fabrik/eingang"');
      mkdirSync(join(dir, ".factory"));
      writeFileSync(join(dir, ".factory", "sync-stand.json"), JSON.stringify({ version: 2 }));
      expect(lauf()).toBe('"acme/proj"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Bezieher: ohne SAMMELTICKET_TITEL_LISTE der Libs besteht die Liste nur aus dem Rest-Ticket", () => {
    const { libs } = aufbau();
    delete libs.SAMMELTICKET_TITEL_LISTE;
    expect(S.sicherheitsLibs(libs, { bezieher: true }).SAMMELTICKET_TITEL_LISTE).toEqual([S.REST_TITEL]);
  });

  test("Bezieher: ZIEL ist das eigene Repo, der Ziel-Token der des eigenen Repos, das Rest-Ticket zählt als Sammelticket", () => {
    const { libs, aufrufe } = aufbau();
    const neu = S.sicherheitsLibs(libs, { bezieher: true });
    expect(neu.ZIEL).toBe("own-a/proj");
    expect(neu.zielToken()).toBeUndefined();
    expect(von(aufrufe, "zielToken")).toEqual([["own-a/proj"]]);
    expect(neu.SAMMELTICKET_TITEL_LISTE).toEqual(["Harness-Härtung (gesammelt)", S.REST_TITEL]);
    expect(neu.REPO).toBe("own-a/proj");
  });

  test("Bezieher: ladeSammelKontext liest das eigene Repo und das Rest-Ticket, ein übergebener Wert geht vor", () => {
    const { libs, aufrufe } = aufbau();
    const neu = S.sicherheitsLibs(libs, { bezieher: true });
    neu.ladeSammelKontext();
    neu.ladeSammelKontext({ ladeKommentare: () => [] });
    const [erst, zweit] = von(aufrufe, "ladeSammelKontext");
    expect(erst).toEqual([{ repo: "own-a/proj", titel: S.REST_TITEL }]);
    expect(Object.keys((zweit[0] as object)).sort()).toEqual(["ladeKommentare", "repo", "titel"]);
  });

  test("Bezieher: postZeilen geht standardmäßig ins eigene Repo ohne Fremd-Token, ein übergebenes Repo bleibt", () => {
    const { libs, aufrufe } = aufbau();
    const neu = S.sicherheitsLibs(libs, { bezieher: true });
    neu.postZeilen(8, "text");
    neu.postZeilen(9, "x", "zz-org/andere", "tok");
    expect(von(aufrufe, "postZeilen")).toEqual([[8, "text", "own-a/proj", undefined], [9, "x", "zz-org/andere", "tok"]]);
  });

  test("Bezieher: ein vorhandenes Rest-Ticket wird gewählt (Titel und eigenes Repo), nichts angelegt", () => {
    const { libs, aufrufe } = aufbau();
    libs.waehleSammelticket = (...a: unknown[]) => (aufrufe.push({ name: "waehleSammelticket", args: a }), { number: 8 });
    const gh = { text: () => { throw new Error("nichts anlegen"); } };
    const neu = S.sicherheitsLibs(libs, { bezieher: true, gh });
    expect(neu.waehleSammelticket([{ number: 8 }])).toEqual({ number: 8 });
    expect(von(aufrufe, "waehleSammelticket")).toEqual([[[{ number: 8 }], "own-a/proj", undefined, S.REST_TITEL]]);
    expect(von(aufrufe, "platziereAmEnde")).toEqual([]);
  });

  test("Bezieher: fehlt das Rest-Ticket, wird es im eigenen Repo ohne Label angelegt und ans Ende der Todo-Spalte sortiert", () => {
    const { libs, aufrufe } = aufbau();
    const gh: { args: string[][]; text: (a: string[]) => string } = { args: [], text: (a) => (gh.args.push(a), "https://github.com/own-a/proj/issues/41\n") };
    const neu = S.sicherheitsLibs(libs, { bezieher: true, gh });
    expect(neu.waehleSammelticket([])).toEqual({ number: 41 });
    expect(gh.args).toHaveLength(1);
    expect(gh.args[0].slice(0, 5)).toEqual(["issue", "create", "--repo", "own-a/proj", "--title"]);
    expect(gh.args[0][5]).toBe(S.REST_TITEL);
    expect(gh.args[0]).not.toContain("--label");
    expect(gh.args[0].join(" ")).not.toContain("🔒");
    expect(von(aufrufe, "platziereAmEnde")).toEqual([[41]]);
  });

  test("Bezieher: die Zweitabfrage kennt das Rest-Ticket schon (REST-Liste hinkt): nichts angelegt, Warnung, null", () => {
    const { libs, aufrufe } = aufbau();
    libs.frischeOffeneIssues = (...a: unknown[]) => (aufrufe.push({ name: "frischeOffeneIssues", args: a }), [{ number: 7, titel: S.REST_TITEL }]);
    const log: string[] = [];
    const gh = { text: () => { throw new Error("nichts anlegen"); } };
    const neu = S.sicherheitsLibs(libs, { bezieher: true, gh, log: (s) => log.push(s) });
    expect(neu.waehleSammelticket([])).toBeNull();
    expect(von(aufrufe, "frischeOffeneIssues")[0][0]).toEqual({ repo: "own-a/proj", anzahl: 50, mitBoard: false });
    expect(log.join("\n")).toMatch(/::warning::.*#7/);
    expect(von(aufrufe, "platziereAmEnde")).toEqual([]);
  });

  test("Bezieher: ein anderes offenes Ticket in der Zweitabfrage verhindert das Anlegen nicht", () => {
    const { libs } = aufbau();
    libs.frischeOffeneIssues = () => [{ number: 7, titel: "Etwas anderes" }];
    const neu = S.sicherheitsLibs(libs, { bezieher: true, gh: { text: () => "https://github.com/own-a/proj/issues/50" } });
    expect(neu.waehleSammelticket([])).toEqual({ number: 50 });
  });

  test("Bezieher: scheitert die Zweitabfrage, wird nichts angelegt (fail-closed), Warnung, null", () => {
    const { libs } = aufbau();
    libs.frischeOffeneIssues = () => { throw new Error("API weg"); };
    const log: string[] = [];
    const neu = S.sicherheitsLibs(libs, { bezieher: true, gh: { text: () => { throw new Error("nichts anlegen"); } }, log: (s) => log.push(s) });
    expect(neu.waehleSammelticket([])).toBeNull();
    expect(log.join("\n")).toMatch(/::warning::.*API weg/);
  });

  test("Bezieher: unerwartete Ausgabe von gh issue create wirft mit der Rohausgabe, statt NaN zu liefern", () => {
    const { libs, aufrufe } = aufbau();
    const neu = S.sicherheitsLibs(libs, { bezieher: true, gh: { text: () => "kaputte Ausgabe" } });
    expect(() => neu.waehleSammelticket([])).toThrow(/kaputte Ausgabe/);
    expect(von(aufrufe, "platziereAmEnde")).toEqual([]);
  });

  test("Bezieher: die Nummer 0 oder eine negative ist keine gültige Nummer und wirft", () => {
    const { libs } = aufbau();
    for (const roh of ["https://github.com/own-a/proj/issues/0", "https://github.com/own-a/proj/issues/-3"]) {
      expect(() => S.sicherheitsLibs(libs, { bezieher: true, gh: { text: () => roh } }).waehleSammelticket([])).toThrow(/Nummer fehlt/);
    }
  });

  test("Bezieher: scheitert das Einsortieren, bleibt das Ticket nutzbar und eine Warnung steht im Log", () => {
    const { libs } = aufbau();
    libs.platziereAmEnde = () => { throw new Error("PROJECT_TOKEN fehlt"); };
    const log: string[] = [];
    const neu = S.sicherheitsLibs(libs, { bezieher: true, gh: { text: () => "https://github.com/own-a/proj/issues/42" }, log: (s) => log.push(s) });
    expect(neu.waehleSammelticket([])).toEqual({ number: 42 });
    expect(log.join("\n")).toMatch(/::warning::.*#42.*nicht ans Ende.*PROJECT_TOKEN/);
  });
});
