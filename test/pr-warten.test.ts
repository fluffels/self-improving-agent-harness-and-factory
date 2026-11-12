/* PR-Warten (#1559): Kern pur, kein gh-Aufruf, kein echter Schlaf. */
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/pr-warten.mjs";

type Erg = { exit: number; zeilen: string[] };
const P = raw as unknown as {
  bewerte: (pr: object, pflicht?: readonly string[] | null) => Erg;
  konfliktStand: (seit: number | null, jetzt: number) => { bestaetigt: boolean; seit: number };
  warten: (e: { hole: () => object; pflicht?: () => readonly string[]; aktualisiere?: () => void; schlafe: (ms: number) => void; jetzt: () => number; maxMs: number; intervallMs: number }) => Erg;
  parseArgs: (a: string[]) => { pr: string | null; maxSekunden: number; intervall: number };
  MAX_SEKUNDEN_STANDARD: number;
};

const lauf = (name: string, status: string, conclusion: string | null = null, url = `https://x/runs/${name}`) => ({ __typename: "CheckRun", name, status, conclusion, detailsUrl: url });
const ctx = (context: string, state: string) => ({ __typename: "StatusContext", context, state, targetUrl: "https://y" });
const offen = (rollup: object[], extra: object = {}) => ({ state: "OPEN", mergeable: "MERGEABLE", autoMergeRequest: { mergeMethod: "SQUASH" }, statusCheckRollup: rollup, ...extra });

describe("bewerte", () => {
  test("MERGED → Exit 0 mit kurzem SHA", () => {
    expect(P.bewerte({ state: "MERGED", mergeCommit: { oid: "abcdef1234567" }, statusCheckRollup: [] })).toEqual({ exit: 0, zeilen: ["MERGED abcdef1"] });
  });
  test.each(["FAILURE", "CANCELLED", "TIMED_OUT"])("roter CheckRun (%s) → Exit 1, eine Zeile je rotem Check", (c) => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS"), lauf("b", "COMPLETED", c), lauf("c", "COMPLETED", "FAILURE")]));
    expect(r.exit).toBe(1);
    expect(r.zeilen.filter((z) => z.startsWith("ROT "))).toEqual(["ROT b https://x/runs/b", "ROT c https://x/runs/c"]);
  });
  test.each(["FAILURE", "ERROR"])("roter StatusContext (%s) → Exit 1", (s) => {
    expect(P.bewerte(offen([ctx("ci", s)])).exit).toBe(1);
  });
  test("Negativ: SKIPPED und NEUTRAL sind nicht rot", () => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SKIPPED"), lauf("b", "COMPLETED", "NEUTRAL"), lauf("c", "COMPLETED", "SUCCESS")]));
    expect(r.exit).toBe(2);
    expect(r.zeilen[0]).toBe("OFFEN 3/3 grün, Merge steht aus");
  });
  test("wartende Checks → Exit 2 mit Namen und x/y", () => {
    const r = P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS"), lauf("b", "IN_PROGRESS"), ctx("ci", "PENDING")]));
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/3 grün, wartend: b, ci"] });
  });
  test("Rot hat Vorrang vor wartenden Checks", () => {
    expect(P.bewerte(offen([lauf("a", "IN_PROGRESS"), lauf("b", "COMPLETED", "FAILURE")])).exit).toBe(1);
  });
  test("CONFLICTING → Exit 3, CLOSED → Exit 3", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS")], { mergeable: "CONFLICTING" }))).toEqual({ exit: 3, zeilen: ["KONFLIKT"] });
    expect(P.bewerte({ state: "CLOSED", statusCheckRollup: [] })).toEqual({ exit: 3, zeilen: ["GESCHLOSSEN"] });
  });
  test("grün ohne Auto-Merge → Exit 3, leerer Rollup ist nicht grün", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "SUCCESS")], { autoMergeRequest: null }))).toEqual({ exit: 3, zeilen: ["GRÜN OHNE AUTO-MERGE"] });
    expect(P.bewerte(offen([], { autoMergeRequest: null })).exit).toBe(2);
  });
});

describe("bewerte: Check-Kategorie Pflicht gegen sonstig (#1663 L17)", () => {
  const PFLICHT = ["Tests, Typecheck & Builds"];
  const gruen = lauf(PFLICHT[0], "COMPLETED", "SUCCESS");
  const hinweis = (n: string) => `HINWEIS ${n} https://x/runs/${n} (kein Pflicht-Check, kein Merge-Gate)`;
  test("rotes Nicht-Pflicht-Check bei sonst grünem Stand: Exit 2 mit Merge steht aus plus HINWEIS", () => {
    const r = P.bewerte(offen([gruen, lauf("CodeQL", "COMPLETED", "FAILURE")]), PFLICHT);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus", hinweis("CodeQL")] });
  });
  test("rotes Nicht-Pflicht-Check plus roter Pflicht-Check: nur der Pflicht-Check ist ROT, dazu HINWEIS", () => {
    const r = P.bewerte(offen([lauf("Deploy", "COMPLETED", "FAILURE"), lauf(PFLICHT[0], "COMPLETED", "FAILURE")]), PFLICHT);
    expect(r.exit).toBe(1);
    expect(r.zeilen).toEqual([`ROT ${PFLICHT[0]} https://x/runs/${PFLICHT[0]}`, hinweis("Deploy")]);
  });
  test("laufendes Nicht-Pflicht-Check blockiert nicht und wird nicht als wartend gezählt", () => {
    const r = P.bewerte(offen([gruen, lauf("CodeQL-Analyse (actions)", "IN_PROGRESS")]), PFLICHT);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus"] });
  });
  test("grünes Nicht-Pflicht-Check ohne Auto-Merge zählt nicht zum grünen Stand", () => {
    const r = P.bewerte(offen([gruen, lauf("Deploy", "COMPLETED", "SUCCESS")], { autoMergeRequest: null }), PFLICHT);
    expect(r).toEqual({ exit: 3, zeilen: ["GRÜN OHNE AUTO-MERGE"] });
  });
  test("nur Nicht-Pflicht-Checks zählen wie ein leerer Rollup", () => {
    const r = P.bewerte(offen([lauf("Deploy", "COMPLETED", "SUCCESS")], { autoMergeRequest: null }), PFLICHT);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 0/0 grün, wartend: Checks starten"] });
  });
  test("rotes Nicht-Pflicht-Check plus laufender Pflicht-Check: wartend plus HINWEIS", () => {
    const r = P.bewerte(offen([gruen, lauf("b", "IN_PROGRESS"), lauf("Deploy", "COMPLETED", "FAILURE")]), [...PFLICHT, "b"]);
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 1/2 grün, wartend: b", hinweis("Deploy")] });
  });
  test("MERGED bleibt ohne HINWEIS", () => {
    const r = P.bewerte({ state: "MERGED", mergeCommit: { oid: "abcdef1234567" }, statusCheckRollup: [lauf("Deploy", "COMPLETED", "FAILURE")] }, PFLICHT);
    expect(r).toEqual({ exit: 0, zeilen: ["MERGED abcdef1"] });
  });
  test.each(["XTests, Typecheck & Builds", "tests, typecheck & builds"])("Negativ: Namensvergleich ist exakt, %s ist kein Pflicht-Check", (n) => {
    const r = P.bewerte(offen([lauf(n, "COMPLETED", "FAILURE")]), PFLICHT);
    expect(r.zeilen[0]).not.toMatch(/^ROT/);
  });
  test.each([null, undefined, []])("Fail-closed: ohne Pflicht-Liste (%j) gatet jedes rote Check", (pflicht) => {
    const r = P.bewerte(offen([gruen, lauf("CodeQL", "COMPLETED", "FAILURE")]), pflicht);
    expect(r).toEqual({ exit: 1, zeilen: ["ROT CodeQL https://x/runs/CodeQL"] });
  });
  test("Konflikt mit rotem Nicht-Pflicht-Check: KONFLIKT plus HINWEIS", () => {
    const r = P.bewerte(offen([lauf("Deploy", "COMPLETED", "FAILURE")], { mergeable: "CONFLICTING" }), PFLICHT);
    expect(r).toEqual({ exit: 3, zeilen: ["KONFLIKT", hinweis("Deploy")] });
  });
});

describe("warten: Pflicht-Checks holen (#1663 L17)", () => {
  const u = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  const rot = offen([lauf("Pflicht", "COMPLETED", "SUCCESS"), lauf("Deploy", "COMPLETED", "FAILURE")]);
  test("die Pflicht-Liste kommt aus dem Aufruf und wird nur einmal geholt", () => {
    let n = 0;
    const r = P.warten({ hole: () => rot, pflicht: () => (n++, ["Pflicht"]), ...u(), maxMs: 90_000, intervallMs: 30_000 });
    expect(r.zeilen[0]).toBe("OFFEN 1/1 grün, Merge steht aus");
    expect(n).toBe(1);
  });
  test("Fehler beim Holen der Pflicht-Liste: fail-closed, alle Checks gaten", () => {
    const r = P.warten({
      hole: () => rot,
      pflicht: () => {
        throw new Error("gh down");
      },
      ...u(),
      maxMs: 90_000,
      intervallMs: 30_000,
    });
    expect(r.exit).toBe(1);
    expect(r.zeilen).toEqual(["ROT Deploy https://x/runs/Deploy"]);
  });
});

describe("konfliktStand: KONFLIKT erst nach zweiter Abfrage im Abstand (#1663 L33)", () => {
  test("erste Abfrage: unbestätigt, merkt sich den Zeitpunkt", () => {
    expect(P.konfliktStand(null, 5000)).toEqual({ bestaetigt: false, seit: 5000 });
  });
  test("zweite Abfrage unter 15 s: weiter unbestätigt, der erste Zeitpunkt bleibt", () => {
    expect(P.konfliktStand(5000, 19_999)).toEqual({ bestaetigt: false, seit: 5000 });
  });
  test("zweite Abfrage ab genau 15 s: bestätigt", () => {
    expect(P.konfliktStand(5000, 20_000).bestaetigt).toBe(true);
  });
});

describe("warten", () => {
  const uhr = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  test("endet beim ersten Ergebnis ≠ Exit 2, schläft zwischen den Abfragen", () => {
    const u = uhr();
    const folge = [offen([lauf("a", "IN_PROGRESS")]), offen([lauf("a", "COMPLETED", "FAILURE")])];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], ...u, maxMs: 240_000, intervallMs: 30_000 });
    expect(r.exit).toBe(1);
    expect(u.jetzt()).toBe(30_000);
  });
  test("Zeitbudget abgelaufen → Exit 2 mit letzter Zeile, kein Schlaf über das Budget hinaus", () => {
    const u = uhr();
    const r = P.warten({ hole: () => offen([lauf("a", "IN_PROGRESS")]), ...u, maxMs: 90_000, intervallMs: 30_000 });
    expect(r.exit).toBe(2);
    expect(u.jetzt()).toBeLessThanOrEqual(90_000);
  });
  test("ein gh-Fehler wird überbrückt, drei in Folge → Exit 3", () => {
    const u = uhr();
    let n = 0;
    const ok = P.warten({
      hole: () => {
        if (n++ === 0) throw new Error("API down");
        return { state: "MERGED", mergeCommit: { oid: "abc1234" }, statusCheckRollup: [] };
      },
      ...u,
      maxMs: 240_000,
      intervallMs: 30_000,
    });
    expect(ok.exit).toBe(0);
    const u2 = uhr();
    const aus = P.warten({
      hole: () => {
        throw new Error("API down\nzweite Zeile");
      },
      ...u2,
      maxMs: 240_000,
      intervallMs: 30_000,
    });
    expect(aus).toEqual({ exit: 3, zeilen: ["GH-FEHLER API down"] });
  });
});

describe("warten: Konflikt wird erst nach zweiter Abfrage gemeldet (#1663 L33)", () => {
  const konflikt = offen([lauf("a", "IN_PROGRESS")], { mergeable: "CONFLICTING" });
  const uhr = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  test("flackernder Konflikt (einmal CONFLICTING, dann MERGEABLE): kein KONFLIKT", () => {
    const folge = [konflikt, offen([lauf("a", "COMPLETED", "FAILURE")])];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], ...uhr(), maxMs: 240_000, intervallMs: 30_000 });
    expect(r.exit).toBe(1);
  });
  test("zweimal CONFLICTING im Abstand von mindestens 15 s: KONFLIKT, genau zwei Abfragen", () => {
    const u = uhr();
    let n = 0;
    const r = P.warten({ hole: () => (n++, konflikt), ...u, maxMs: 240_000, intervallMs: 5_000 });
    expect(r).toEqual({ exit: 3, zeilen: ["KONFLIKT"] });
    expect(n).toBe(2);
    expect(u.jetzt()).toBeGreaterThanOrEqual(15_000);
  });
  test("ein kleines Budget verhindert die Bestätigung nicht: trotzdem zwei Abfragen", () => {
    let n = 0;
    const r = P.warten({ hole: () => (n++, konflikt), ...uhr(), maxMs: 1_000, intervallMs: 30_000 });
    expect(r.exit).toBe(3);
    expect(n).toBe(2);
  });
});

describe("parseArgs", () => {
  test("PR-Nummer und Optionen, Standardwerte", () => {
    expect(P.parseArgs(["12"])).toEqual({ pr: "12", maxSekunden: 150, intervall: 30 });
    expect(P.parseArgs(["--max-sekunden", "60", "--intervall", "10", "7"])).toEqual({ pr: "7", maxSekunden: 60, intervall: 10 });
  });
});

describe("Fail-closed und Fehlerzähler (Grenzfälle)", () => {
  test("COMPLETED mit unbekannter oder fehlender conclusion ist rot, nie grün", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "STALE")])).exit).toBe(1);
    expect(P.bewerte(offen([lauf("a", "COMPLETED", null)])).exit).toBe(1);
  });
  test("StatusContext SUCCESS ist grün, ohne __typename wird er am Feld context erkannt", () => {
    expect(P.bewerte(offen([ctx("ci", "SUCCESS")]))).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus"] });
    expect(P.bewerte(offen([{ context: "ci", state: "FAILURE", targetUrl: "u" }])).zeilen).toEqual(["ROT ci u"]);
  });
  test("Fehler, Erfolg, Fehler, Fehler sind kein Exit 3: der Zähler wird nach einem Erfolg zurückgesetzt", () => {
    let n = 0;
    const antworten: (object | Error)[] = [new Error("a"), offen([lauf("x", "IN_PROGRESS")]), new Error("b"), new Error("c"), { state: "MERGED", mergeCommit: { oid: "abc1234" }, statusCheckRollup: [] }];
    let t = 0;
    const r = P.warten({
      hole: () => {
        const a = antworten[n++];
        if (a instanceof Error) throw a;
        return a;
      },
      jetzt: () => t,
      schlafe: (ms) => void (t += ms),
      maxMs: 600_000,
      intervallMs: 30_000,
    });
    expect(r.exit).toBe(0);
  });
  test("läuft das Budget nach einem gh-Fehler ab, steht GH-FEHLER mit Exit 2 da", () => {
    let t = 0;
    const r = P.warten({
      hole: () => {
        throw new Error("down");
      },
      jetzt: () => t,
      schlafe: (ms) => void (t += ms),
      maxMs: 40_000,
      intervallMs: 30_000,
    });
    expect(r).toEqual({ exit: 2, zeilen: ["GH-FEHLER down"] });
  });
  test("das Budget wird genau ausgeschöpft: letzter Poll vor Ablauf, kein Schlaf darüber hinaus", () => {
    let t = 0;
    P.warten({ hole: () => offen([lauf("a", "IN_PROGRESS")]), jetzt: () => t, schlafe: (ms) => void (t += ms), maxMs: 90_000, intervallMs: 30_000 });
    expect(t).toBe(60_000);
  });
});

describe("warten: Pflicht-Liste neu holen und Konflikt-Reset (#1663 T2, T3)", () => {
  const uhr = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  const rot = offen([lauf("Pflicht", "COMPLETED", "SUCCESS"), lauf("Deploy", "COMPLETED", "FAILURE")]);
  test("nach einem Fehlschlag wird die Pflicht-Liste neu geholt: zweite Abfrage meldet HINWEIS statt ROT", () => {
    let n = 0;
    const folge = [offen([lauf("Pflicht", "IN_PROGRESS")]), rot];
    let i = 0;
    const r = P.warten({
      hole: () => folge[i++],
      pflicht: () => {
        n++;
        if (n === 1) throw new Error("gh down");
        return ["Pflicht"];
      },
      ...uhr(),
      maxMs: 60_000,
      intervallMs: 30_000,
    });
    expect(n).toBe(2);
    expect(r.exit).toBe(2);
    expect(r.zeilen.join("|")).toContain("HINWEIS Deploy");
  });
  test("eine leere Pflicht-Liste wird nicht gecacht (fail-closed bleibt, nächste Abfrage holt neu)", () => {
    let n = 0;
    const folge = [offen([lauf("Pflicht", "IN_PROGRESS")]), rot];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], pflicht: () => (n++, n === 1 ? [] : ["Pflicht"]), ...uhr(), maxMs: 60_000, intervallMs: 30_000 });
    expect(n).toBe(2);
    expect(r.exit).toBe(2);
  });
  test("Konflikt, dann konfliktfreie Abfrage, dann Konflikt: die Zeit der ersten Beobachtung ist zurückgesetzt (vier Abfragen)", () => {
    const konflikt = offen([lauf("a", "IN_PROGRESS")], { mergeable: "CONFLICTING" });
    const folge = [konflikt, offen([lauf("a", "IN_PROGRESS")]), konflikt, konflikt];
    let i = 0;
    const r = P.warten({ hole: () => folge[i++], ...uhr(), maxMs: 240_000, intervallMs: 5_000 });
    expect(r).toEqual({ exit: 3, zeilen: ["KONFLIKT"] });
    expect(i).toBe(4);
  });
});

describe("holePflicht (#1663 T4)", () => {
  const H = raw as unknown as { holePflicht: (pr: string, gh: (a: string[], o: object) => string) => string[] };
  test("Exit 8 bei laufenden Checks: das JSON in stdout des Fehlers liefert die Namen", () => {
    const gh = () => {
      throw Object.assign(new Error("exit 8"), { stdout: '[{"name":"A"},{"name":"B"}]' });
    };
    expect(H.holePflicht("7", gh)).toEqual(["A", "B"]);
  });
  test("Fehler ohne JSON in stdout wird weitergeworfen", () => {
    const gh = () => {
      throw Object.assign(new Error("kaputt"), { stdout: "kein json" });
    };
    expect(() => H.holePflicht("7", gh)).toThrow("kaputt");
  });
  test("stdout beginnt mit [, ist aber kein gültiges JSON: wirft (fail-closed)", () => {
    const gh = () => {
      throw Object.assign(new Error("exit 8"), { stdout: "[{kaputt" });
    };
    expect(() => H.holePflicht("7", gh)).toThrow(SyntaxError);
  });
  test("Erfolg: Namen aus der JSON-Ausgabe, Aufruf mit --required", () => {
    let args: string[] = [];
    expect(H.holePflicht("7", (a) => ((args = a), '[{"name":"C"}]'))).toEqual(["C"]);
    expect(args).toContain("--required");
  });
});

describe("bewerte: Rerun überschreibt den früheren Lauf (#1740 L34)", () => {
  const wf = (name: string, workflowName: string, status: string, conclusion: string | null, startedAt: string) => ({ __typename: "CheckRun", name, workflowName, status, conclusion, startedAt, completedAt: startedAt, detailsUrl: `https://x/${name}/${startedAt}` });
  const alt = "2026-10-15T10:00:00Z";
  const neu = "2026-10-15T11:00:00Z";
  test("älterer CANCELLED plus neuerer SUCCESS desselben Workflows ist nicht rot (Reihenfolge egal)", () => {
    for (const rollup of [[wf("verify", "CI", "COMPLETED", "CANCELLED", alt), wf("verify", "CI", "COMPLETED", "SUCCESS", neu)], [wf("verify", "CI", "COMPLETED", "SUCCESS", neu), wf("verify", "CI", "COMPLETED", "CANCELLED", alt)]]) {
      expect(P.bewerte(offen(rollup))).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus"] });
    }
  });
  test("älterer CANCELLED plus neuerer laufender Lauf (Nullwert startedAt) ist OFFEN, nicht rot", () => {
    const r = P.bewerte(offen([wf("verify", "CI", "COMPLETED", "CANCELLED", alt), wf("verify", "CI", "QUEUED", null, "0001-01-01T00:00:00Z")]));
    expect(r).toEqual({ exit: 2, zeilen: ["OFFEN 0/1 grün, wartend: verify"] });
  });
  test("Gleichstand: bei gleichem Stempel gewinnt der spätere Eintrag; ohne startedAt zählt completedAt", () => {
    expect(P.bewerte(offen([wf("verify", "CI", "COMPLETED", "CANCELLED", alt), wf("verify", "CI", "COMPLETED", "SUCCESS", alt)])).exit).toBe(2);
    expect(P.bewerte(offen([wf("verify", "CI", "COMPLETED", "SUCCESS", alt), wf("verify", "CI", "COMPLETED", "CANCELLED", alt)])).exit).toBe(1);
    const ohneStart = (conclusion: string, completedAt: string) => ({ __typename: "CheckRun", name: "verify", workflowName: "CI", status: "COMPLETED", conclusion, startedAt: "", completedAt, detailsUrl: "u" });
    expect(P.bewerte(offen([ohneStart("SUCCESS", neu), ohneStart("CANCELLED", alt)])).exit).toBe(2);
  });
  test("Negativ: alleinstehender CANCELLED bleibt rot (fail-closed)", () => {
    expect(P.bewerte(offen([wf("verify", "CI", "COMPLETED", "CANCELLED", alt)])).exit).toBe(1);
  });
  test("CANCELLED durch Concurrency-Ablösung (anderer Check desselben Workflows läuft noch) ist OFFEN (factory#114 L12)", () => {
    const r = P.bewerte(offen([wf("Security-Audit (npm audit)", "CI", "COMPLETED", "CANCELLED", alt), wf("verify", "CI", "IN_PROGRESS", null, "0001-01-01T00:00:00Z")]));
    expect(r.exit).toBe(2);
    expect(r.zeilen[0]).toContain("wartend: Security-Audit (npm audit), verify");
  });
  test("Negativ L12: ein laufender StatusContext löst einen CANCELLED-CheckRun ohne Workflow nicht ab (bleibt rot)", () => {
    const app = { __typename: "CheckRun", name: "app-check", status: "COMPLETED", conclusion: "CANCELLED", startedAt: alt, completedAt: alt, detailsUrl: "https://x/app" };
    const r = P.bewerte(offen([app, ctx("ext/status", "PENDING")]));
    expect(r.exit).toBe(1);
    expect(r.zeilen.join(" ")).toContain("ROT app-check");
  });
  test("gesperrter CANCELLED ohne laufenden Geschwister-Lauf: ROT plus HINWEIS auf leeren Commit statt `gh run rerun`", () => {
    const r = P.bewerte(offen([wf("verify", "CI", "COMPLETED", "CANCELLED", alt)]));
    expect(r.exit).toBe(1);
    const h = r.zeilen.filter((z) => z.startsWith("HINWEIS verify"));
    expect(h).toHaveLength(1);
    expect(h[0]).toContain("kein `gh run rerun`");
    expect(h[0]).toContain("leerer Commit mit Push");
  });
  test("Negativ: FAILURE und ein abgelöster CANCELLED (Geschwister läuft) bekommen keinen Rerun-HINWEIS", () => {
    expect(P.bewerte(offen([wf("verify", "CI", "COMPLETED", "FAILURE", alt)])).zeilen.join("\n")).not.toContain("rerun");
    expect(P.bewerte(offen([wf("a", "CI", "COMPLETED", "CANCELLED", alt), wf("verify", "CI", "IN_PROGRESS", null, "0001-01-01T00:00:00Z")])).zeilen.join("\n")).not.toContain("rerun");
  });
  test("CANCELLED auf einem Check außerhalb der Pflichtliste: nur der Nicht-Pflicht-HINWEIS, kein Rerun-HINWEIS, kein Gate", () => {
    const r = P.bewerte(offen([wf("verify", "CI", "COMPLETED", "SUCCESS", alt), wf("sonst", "CI", "COMPLETED", "CANCELLED", alt)]), ["verify"]);
    expect(r.exit).toBe(2);
    const text = r.zeilen.join("\n");
    expect(text).toContain("HINWEIS sonst ");
    expect(text).toContain("(kein Pflicht-Check, kein Merge-Gate)");
    expect(text).not.toContain("rerun");
    expect(text).not.toContain("leerer Commit");
  });
  test("StatusContext gilt nicht als abgelöst: ein roter Status bleibt ROT neben einem laufenden CheckRun", () => {
    const run = { __typename: "CheckRun", name: "app", status: "IN_PROGRESS", conclusion: null, startedAt: "0001-01-01T00:00:00Z", detailsUrl: "https://x/app" };
    const r = P.bewerte(offen([ctx("ext/status", "FAILURE"), run]));
    expect(r.exit).toBe(1);
    expect(r.zeilen.join(" ")).toContain("ROT ext/status");
  });
  test("Negativ L12: CANCELLED mit allen Geschwistern fertig bleibt rot; Geschwister eines anderen Workflows lösen nicht ab", () => {
    expect(P.bewerte(offen([wf("audit", "CI", "COMPLETED", "CANCELLED", alt), wf("verify", "CI", "COMPLETED", "SUCCESS", alt)])).exit).toBe(1);
    expect(P.bewerte(offen([wf("audit", "CI", "COMPLETED", "CANCELLED", alt), wf("verify", "Nightly", "IN_PROGRESS", null, "0001-01-01T00:00:00Z")])).exit).toBe(1);
  });
  test("Negativ: neuerer FAILURE nach älterem SUCCESS ist rot", () => {
    expect(P.bewerte(offen([wf("verify", "CI", "COMPLETED", "SUCCESS", alt), wf("verify", "CI", "COMPLETED", "FAILURE", neu)])).exit).toBe(1);
  });
  test("gleicher Name in anderem Workflow zählt getrennt: roter Lauf bleibt rot", () => {
    expect(P.bewerte(offen([wf("build", "CI", "COMPLETED", "CANCELLED", alt), wf("build", "Nightly", "COMPLETED", "SUCCESS", neu)])).exit).toBe(1);
  });
  test("StatusContext je context: der spätere Eintrag gilt", () => {
    expect(P.bewerte(offen([ctx("ci", "FAILURE"), ctx("ci", "SUCCESS")])).exit).toBe(2);
    expect(P.bewerte(offen([ctx("ci", "SUCCESS"), ctx("ci", "FAILURE")])).exit).toBe(1);
  });
});

describe("parseArgs: strikt (#1790)", () => {
  const PF = P as unknown as { parseArgs: (a: string[]) => { pr: string | null; maxSekunden: number; intervall: number; fehler?: string } };
  test("alle Flags gesetzt: Form ohne fehler-Feld", () => {
    expect(PF.parseArgs(["--max-sekunden", "60", "--intervall", "10", "7"])).toEqual({ pr: "7", maxSekunden: 60, intervall: 10 });
  });
  test("unbekanntes Flag, Flag ohne Wert, doppeltes Flag und zweites Positionsargument setzen fehler", () => {
    expect(PF.parseArgs(["--bogus"]).fehler).toMatch(/Unbekanntes Argument: --bogus/);
    expect(PF.parseArgs(["--intervall"]).fehler).toMatch(/--intervall braucht einen Wert/);
    expect(PF.parseArgs(["--intervall", "5", "--intervall", "6"]).fehler).toMatch(/--intervall ist doppelt/);
    expect(PF.parseArgs(["12", "13"]).fehler).toBe("Unbekanntes Argument: 13");
  });
  test("nicht-numerische PR-Nummer ist ein Aufruf-Fehler, fehlende nur pr null", () => {
    expect(PF.parseArgs(["abc"]).fehler).toBe("PR-Nummer erwartet, nicht abc");
    expect(PF.parseArgs(["1a"]).fehler).toMatch(/PR-Nummer/);
    expect(PF.parseArgs(["a1"]).fehler).toBe("PR-Nummer erwartet, nicht a1");
    expect(PF.parseArgs([])).toEqual({ pr: null, maxSekunden: 150, intervall: 30 });
  });
});

describe("Code-Scanning-Werkzeuge aus den Ruleset-Regeln (#92 L2)", () => {
  const C = raw as unknown as {
    codeScanningWerkzeuge: (regeln: unknown) => string[];
    pflichtListe: (basis: readonly string[], werkzeuge: readonly string[]) => string[];
    holeWerkzeuge: (pr: string, gh: (a: string[], o: object) => string) => { werkzeuge: string[]; hinweis: string | null };
    mitHinweis: (r: Erg, hinweis: string | null) => Erg;
  };
  const regel = (...tools: string[]) => ({ type: "code_scanning", parameters: { code_scanning_tools: tools.map((tool) => ({ tool, alerts_threshold: "errors", security_alerts_threshold: "high_or_higher" })) } });
  test("Regel da: Werkzeugname", () => expect(C.codeScanningWerkzeuge([{ type: "deletion" }, regel("CodeQL")])).toEqual(["CodeQL"]));
  test("Regel fehlt: leer", () => expect(C.codeScanningWerkzeuge([{ type: "required_status_checks", parameters: {} }])).toEqual([]));
  test("mehrere Regeln und Werkzeuge", () => expect(C.codeScanningWerkzeuge([regel("CodeQL", "Semgrep"), regel("Trivy")])).toEqual(["CodeQL", "Semgrep", "Trivy"]));
  test.each([null, "x", {}, [null], [{ type: "code_scanning" }], [{ type: "code_scanning", parameters: { code_scanning_tools: "kaputt" } }], [{ type: "code_scanning", parameters: { code_scanning_tools: [{}, null, { tool: " " }] } }]])("kaputte Regeln (%j): leer, kein Absturz", (r) => {
    expect(C.codeScanningWerkzeuge(r)).toEqual([]);
  });
  test("rotes CodeQL mit Regel → ROT", () => {
    const r = P.bewerte(offen([lauf("Tests", "COMPLETED", "SUCCESS"), lauf("CodeQL", "COMPLETED", "FAILURE")]), C.pflichtListe(["Tests"], ["CodeQL"]));
    expect(r.exit).toBe(1);
    expect(r.zeilen).toEqual(["ROT CodeQL https://x/runs/CodeQL"]);
  });
  test("Negativ: rotes CodeQL ohne Regel → nur HINWEIS", () => {
    const r = P.bewerte(offen([lauf("Tests", "COMPLETED", "SUCCESS"), lauf("CodeQL", "COMPLETED", "FAILURE")]), C.pflichtListe(["Tests"], []));
    expect(r.exit).toBe(2);
    expect(r.zeilen.some((z) => z.startsWith("HINWEIS CodeQL"))).toBe(true);
    expect(r.zeilen.some((z) => z.startsWith("ROT"))).toBe(false);
  });
  test("leere Pflicht-Liste bleibt leer (fail-closed), auch mit Werkzeugen", () => expect(C.pflichtListe([], ["CodeQL"])).toEqual([]));
  test("holeWerkzeuge liest Basis-Branch und Regeln", () => {
    const aufrufe: string[][] = [];
    const gh = (a: string[]) => (aufrufe.push(a), a[0] === "pr" ? JSON.stringify({ baseRefName: "trunk" }) : JSON.stringify([regel("CodeQL")]));
    expect(C.holeWerkzeuge("7", gh)).toEqual({ werkzeuge: ["CodeQL"], hinweis: null });
    expect(aufrufe[1].join(" ")).toContain("rules/branches/trunk");
  });
  test("nicht lesbare Regeln: keine Werkzeuge, HINWEIS, kein Absturz", () => {
    const gh = (a: string[]) => {
      if (a[0] === "pr") return JSON.stringify({ baseRefName: "main" });
      throw new Error("HTTP 403\nrest");
    };
    expect(C.holeWerkzeuge("7", gh)).toEqual({ werkzeuge: [], hinweis: "HINWEIS Ruleset-Regeln nicht lesbar: HTTP 403" });
  });
  describe("lauf: die echte Verdrahtung aus holeWerkzeuge, holePflicht und warten", () => {
    const L = raw as unknown as { lauf: (a: { pr: string; maxSekunden: number; intervall: number }, d: { gh: (a: string[], o?: object) => string; schlafe: (ms: number) => void; jetzt: () => number; schreibe?: (p: string, t: string) => void; meldeFehler?: (z: string) => void; repo?: string | null }) => Erg; diagnosePfad: (pr: string, repo?: string | null) => string; repoDerConfig: (lade?: () => { repo?: string }) => string | null };
    const stand = offen([lauf("Tests", "COMPLETED", "SUCCESS"), lauf("CodeQL", "COMPLETED", "FAILURE")]);
    const ghMit = (regeln: () => string) => (a: string[]) => {
      if (a[0] === "api") return regeln();
      if (a.includes("--required")) return JSON.stringify([{ name: "Tests" }]);
      return a.includes("baseRefName") ? JSON.stringify({ baseRefName: "main" }) : JSON.stringify(stand);
    };
    const uhr = () => {
      let t = 0;
      return { schlafe: (ms: number) => void (t += ms), jetzt: () => t, schreibe: () => undefined, meldeFehler: () => undefined };
    };
    const arg = { pr: "7", maxSekunden: 60, intervall: 30 };
    test("Regel gesetzt, CodeQL rot: ROT, Exit 1", () => {
      expect(L.lauf(arg, { gh: ghMit(() => JSON.stringify([regel("CodeQL")])), ...uhr() })).toEqual({ exit: 1, zeilen: ["ROT CodeQL https://x/runs/CodeQL"] });
    });
    test("keine Regel: das rote CodeQL ist nur ein HINWEIS, kein ROT", () => {
      const r = L.lauf(arg, { gh: ghMit(() => "[]"), ...uhr() });
      expect(r.exit).toBe(2);
      expect(r.zeilen.some((z) => z.startsWith("ROT"))).toBe(false);
      expect(r.zeilen.some((z) => z.startsWith("HINWEIS CodeQL"))).toBe(true);
    });
    test("Regeln nicht lesbar: HINWEIS-Zeile steht als letzte Zeile, CodeQL gatet nicht", () => {
      const r = L.lauf(arg, {
        gh: ghMit(() => {
          throw new Error("HTTP 403");
        }),
        ...uhr(),
      });
      expect(r.exit).toBe(2);
      expect(r.zeilen.at(-1)).toBe("HINWEIS Ruleset-Regeln nicht lesbar: HTTP 403");
      expect(r.zeilen.some((z) => z.startsWith("ROT"))).toBe(false);
    });
    test("Exit 2: letzter Rohstand in die Diagnose-Datei im OS-Temp, Pfad auf stderr, stdout-Zeilen unverändert", () => {
      const geschrieben: [string, string][] = [];
      const err: string[] = [];
      const r = L.lauf(arg, { gh: ghMit(() => "[]"), ...uhr(), schreibe: (p, t) => void geschrieben.push([p, t]), meldeFehler: (z) => void err.push(z), repo: null });
      expect(r.exit).toBe(2);
      expect(geschrieben).toHaveLength(1);
      expect(geschrieben[0][0]).toBe(L.diagnosePfad("7"));
      expect(geschrieben[0][0]).toBe(join(tmpdir(), "pr-warten-7.json"));
      expect(JSON.parse(geschrieben[0][1])).toEqual({ state: stand.state, mergeable: stand.mergeable, statusCheckRollup: stand.statusCheckRollup });
      expect(err).toEqual([`Diagnose: ${L.diagnosePfad("7")}`]);
      expect(r.zeilen.some((z) => z.startsWith("Diagnose"))).toBe(false);
    });
    test("L10b: das Repo steckt im Dateinamen, zwei Repos mit gleicher PR-Nummer überschreiben sich nicht", () => {
      expect(L.diagnosePfad("7", "alpha/eins")).toBe(join(tmpdir(), "pr-warten-alpha-eins-7.json"));
      expect(L.diagnosePfad("7", "beta/eins")).not.toBe(L.diagnosePfad("7", "alpha/eins"));
      expect(L.diagnosePfad("7", "kein-repo")).toBe(L.diagnosePfad("7", null));
      const geschrieben: string[] = [];
      L.lauf(arg, { gh: ghMit(() => "[]"), ...uhr(), schreibe: (p) => void geschrieben.push(p), meldeFehler: () => {}, repo: "alpha/eins" });
      expect(geschrieben).toEqual([L.diagnosePfad("7", "alpha/eins")]);
    });
    test("L10b: ohne Angabe nimmt lauf das Repo der Projekt-Config, ohne lesbare Config bleibt es beim Namen ohne Repo", () => {
      const geschrieben: string[] = [];
      L.lauf(arg, { gh: ghMit(() => "[]"), ...uhr(), schreibe: (p) => void geschrieben.push(p), meldeFehler: () => {} });
      expect(geschrieben[0]).toMatch(/pr-warten-[^/\\]+-[^/\\]+-7\.json$/);
      expect(L.repoDerConfig(() => ({ repo: "a/b" }))).toBe("a/b");
      expect(L.repoDerConfig(() => ({}))).toBeNull();
      expect(L.repoDerConfig(() => { throw new Error("keine Config"); })).toBeNull();
    });
    test("Negativ: bei Exit 1 keine Diagnose-Datei; ein Schreibfehler ändert das Ergebnis nicht", () => {
      const geschrieben: string[] = [];
      L.lauf(arg, { gh: ghMit(() => JSON.stringify([regel("CodeQL")])), ...uhr(), schreibe: (p) => void geschrieben.push(p) });
      expect(geschrieben).toEqual([]);
      const r = L.lauf(arg, {
        gh: ghMit(() => "[]"),
        ...uhr(),
        schreibe: () => {
          throw new Error("EACCES");
        },
      });
      expect(r.exit).toBe(2);
    });
  });
  test("mitHinweis hängt die Zeile an außer bei MERGED", () => {
    expect(C.mitHinweis({ exit: 2, zeilen: ["OFFEN"] }, "HINWEIS x")).toEqual({ exit: 2, zeilen: ["OFFEN", "HINWEIS x"] });
    expect(C.mitHinweis({ exit: 0, zeilen: ["MERGED a"] }, "HINWEIS x")).toEqual({ exit: 0, zeilen: ["MERGED a"] });
    expect(C.mitHinweis({ exit: 2, zeilen: ["OFFEN"] }, null)).toEqual({ exit: 2, zeilen: ["OFFEN"] });
  });
});

describe("CLI: Aufruftext nennt den Standard des Zeitbudgets (factory#347 L4)", () => {
  test("ohne PR-Nummer: Exit 3 und der Text trägt denselben Standardwert wie parseArgs", () => {
    const r = spawnSync(process.execPath, ["scripts/pr-warten.mjs"], { encoding: "utf8" });
    expect(r.status).toBe(3);
    expect(r.stderr).toContain(`--max-sekunden ${P.parseArgs([]).maxSekunden}]`);
  });
});

describe("bewerte: Branch hinter main (factory#375 L1)", () => {
  const gruen = [lauf("a", "COMPLETED", "SUCCESS")];
  test("BEHIND mit grünen Checks: Exit 2 HINTER MAIN, aktualisieren", () => {
    const r = P.bewerte(offen(gruen, { mergeStateStatus: "BEHIND" }));
    expect(r).toEqual({ exit: 2, zeilen: ["HINTER MAIN"], aktualisieren: true });
  });
  test("BEHIND mit rotem Check: ROT hat Vorrang", () => {
    expect(P.bewerte(offen([lauf("a", "COMPLETED", "FAILURE")], { mergeStateStatus: "BEHIND" })).exit).toBe(1);
  });
  test("BEHIND mit Konflikt: KONFLIKT hat Vorrang", () => {
    expect(P.bewerte(offen(gruen, { mergeStateStatus: "BEHIND", mergeable: "CONFLICTING" })).zeilen).toEqual(["KONFLIKT"]);
  });
  test("CLEAN bleibt: Merge steht aus", () => {
    expect(P.bewerte(offen(gruen, { mergeStateStatus: "CLEAN" }))).toEqual({ exit: 2, zeilen: ["OFFEN 1/1 grün, Merge steht aus"] });
  });
  test("BEHIND mit laufendem Check: weiter OFFEN, kein Update", () => {
    expect(P.bewerte(offen([lauf("a", "IN_PROGRESS")], { mergeStateStatus: "BEHIND" })).zeilen[0]).toMatch(/^OFFEN 0\/1/);
  });
});

describe("warten: Branch aktualisieren (factory#375 L1)", () => {
  const u = () => {
    let t = 0;
    return { jetzt: () => t, schlafe: (ms: number) => void (t += ms) };
  };
  const hinten = offen([lauf("a", "COMPLETED", "SUCCESS")], { mergeStateStatus: "BEHIND" });
  test("ein Aufruf je Lauf; wieder BEHIND: kein zweiter Aufruf, am Ende HINTER MAIN", () => {
    let n = 0;
    const r = P.warten({ hole: () => hinten, aktualisiere: () => void n++, ...u(), maxMs: 90_000, intervallMs: 30_000 });
    expect(n).toBe(1);
    expect(r).toMatchObject({ exit: 2, zeilen: ["HINTER MAIN"] });
  });
  test("nach dem Update liefert hole den neuen Stand: weiter gepollt", () => {
    let n = 0;
    const r = P.warten({ hole: () => (n++ === 0 ? hinten : offen([lauf("a", "COMPLETED", "SUCCESS")])), aktualisiere: () => undefined, ...u(), maxMs: 90_000, intervallMs: 30_000 });
    expect(r.zeilen).toEqual(["OFFEN 1/1 grün, Merge steht aus"]);
  });
  test("kurzes Budget: Update läuft trotzdem, Ergebnis AKTUALISIERT mit Exit 2", () => {
    let n = 0;
    const r = P.warten({ hole: () => hinten, aktualisiere: () => void n++, ...u(), maxMs: 10_000, intervallMs: 30_000 });
    expect(n).toBe(1);
    expect(r.zeilen[0]).toBe("AKTUALISIERT");
    expect(r.exit).toBe(2);
  });
  test("aktualisiere wirft: Exit 3 AKTUALISIEREN FEHLGESCHLAGEN mit erster Zeile", () => {
    const r = P.warten({
      hole: () => hinten,
      aktualisiere: () => {
        throw new Error("boom\nzweite Zeile");
      },
      ...u(),
      maxMs: 90_000,
      intervallMs: 30_000,
    });
    expect(r).toEqual({ exit: 3, zeilen: ["AKTUALISIEREN FEHLGESCHLAGEN boom"] });
  });
  test("ohne aktualisiere-Naht bleibt es bei HINTER MAIN", () => {
    expect(P.warten({ hole: () => hinten, ...u(), maxMs: 10_000, intervallMs: 30_000 }).zeilen).toEqual(["HINTER MAIN"]);
  });
});

describe("parseArgs: Standardbudget (factory#375 L39)", () => {
  test("Standard ist die exportierte Konstante", () => {
    expect(P.parseArgs(["5"]).maxSekunden).toBe(P.MAX_SEKUNDEN_STANDARD);
    expect(P.MAX_SEKUNDEN_STANDARD).toBe(150);
  });
});
