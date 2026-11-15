/* Basis-Nachlauf-Wächter (factory#499 L7): schließt das Fenster zwischen letztem Einmergen von main und Auto-Merge.
 * Alle Fälle laufen über injizierte io (git, gate, out, err, env); kein echtes git, kein echtes Gate.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// @ts-expect-error JS-Modul ohne Typen
import { MAX_RUNDEN, fuehreAus, naechsterSchritt } from "../scripts/check-basis-nachlauf.mjs";

type Env = Record<string, string | undefined>;

function aufbau(opts: { head1?: string; fetchTips?: string[]; mergeFehler?: boolean; gateExit?: number[]; head2Fehlt?: boolean; fetchWirft?: boolean; env?: Env }) {
  const gitAufrufe: string[][] = [];
  const gateAufrufe: { befehl: string; env: Env }[] = [];
  const aus: string[] = [];
  const fehler: string[] = [];
  const tips = [...(opts.fetchTips ?? [])];
  let aktuellerTip = "";
  const gateExits = [...(opts.gateExit ?? [])];
  const io = {
    git: (args: string[]) => {
      gitAufrufe.push(args);
      const a = args.join(" ");
      if (a.includes("fetch")) {
        if (opts.fetchWirft) throw new Error("fetch kaputt");
        aktuellerTip = tips.shift() ?? aktuellerTip;
        return "";
      }
      if (a === "rev-parse FETCH_HEAD") return aktuellerTip + "\n";
      if (a === "rev-parse HEAD^1") return (opts.head1 ?? "aaa") + "\n";
      if (a === "rev-parse HEAD^2") {
        if (opts.head2Fehlt) throw new Error("kein zweiter Elter");
        return "bbb\n";
      }
      if (a.includes("merge --abort")) return "";
      if (a.includes(" merge ")) {
        if (opts.mergeFehler) throw new Error("Konflikt");
        return "";
      }
      return "";
    },
    gate: (befehl: string, env: Env) => {
      gateAufrufe.push({ befehl, env });
      return gateExits.length ? gateExits.shift()! : 0;
    },
    out: (z: string) => aus.push(z),
    err: (z: string) => fehler.push(z),
    env: { FACTORY_BASIS_REF: "main", ...(opts.env ?? {}) } as Env,
  };
  return { io, gitAufrufe, gateAufrufe, aus, fehler };
}

describe("naechsterSchritt", () => {
  test("gleich: fertig; anders: merge; Obergrenze: abbruch", () => {
    assert.equal(naechsterSchritt({ getestet: "a", aktuell: "a", runde: 0, max: 3 }), "fertig");
    assert.equal(naechsterSchritt({ getestet: "a", aktuell: "b", runde: 2, max: 3 }), "merge");
    assert.equal(naechsterSchritt({ getestet: "a", aktuell: "b", runde: 3, max: 3 }), "abbruch");
    assert.equal(MAX_RUNDEN, 3);
  });
});

describe("fuehreAus", () => {
  test("a) ohne oder mit ungültiger Ref: Exit 2", () => {
    for (const ref of [undefined, "", "-x", "a..b", "a b"]) {
      const t = aufbau({ env: { FACTORY_BASIS_REF: ref } });
      assert.equal(fuehreAus(t.io.env, t.io), 2, String(ref));
      assert.equal(t.gitAufrufe.length, 0);
    }
  });

  test("b) Entwurf: Exit 0, kein git", () => {
    const t = aufbau({ env: { FACTORY_PR_DRAFT: "true" } });
    assert.equal(fuehreAus(t.io.env, t.io), 0);
    assert.match(t.aus.join("\n"), /entfällt \(Entwurf\)/);
    assert.equal(t.gitAufrufe.length, 0);
  });

  test("c) Basis unverändert: Exit 0, kein Gate", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["aaa"] });
    assert.equal(fuehreAus(t.io.env, t.io), 0);
    assert.equal(t.gateAufrufe.length, 0);
  });

  test("d) Basis bewegt: Merge, install, verifyKompakt mit neuer Diff-Basis, dann stabil", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["ccc", "ccc"], env: { FACTORY_COVERAGE: "1" } });
    assert.equal(fuehreAus(t.io.env, t.io), 0);
    assert.deepEqual(
      t.gateAufrufe.map((g) => g.befehl),
      ["install", "verifyKompakt"],
    );
    const verify = t.gateAufrufe[1]!;
    assert.equal(verify.env.FACTORY_DIFF_BASE, "ccc");
    assert.equal(verify.env.FACTORY_COVERAGE, undefined);
    const merge = t.gitAufrufe.find((a) => a.includes("merge") && !a.includes("--abort"))!;
    assert.ok(merge.includes("ccc"));
  });

  test("e) Merge-Konflikt: merge --abort, Exit 1 mit Weg, kein Gate", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["ccc"], mergeFehler: true });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.ok(t.gitAufrufe.some((a) => a.includes("--abort")));
    assert.equal(t.gateAufrufe.length, 0);
    assert.match(t.fehler.join("\n"), /origin\/main einmergen, Konflikt lösen, pushen/);
  });

  test("f) Gate rot: Exit 1, semantischer Konflikt", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["ccc"], gateExit: [0, 1] });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.match(t.fehler.join("\n"), /semantischer Konflikt mit neuem main/);
  });

  test("g) Basis bewegt sich in drei Runden weiter: Exit 1", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["c1", "c2", "c3", "c4"] });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.match(t.fehler.join("\n"), /Basis bewegt sich weiter, Lauf neu starten/);
    assert.equal(t.gateAufrufe.filter((g) => g.befehl === "verifyKompakt").length, MAX_RUNDEN);
  });

  test("h) fetch wirft: Exit 1, fail-closed", () => {
    const t = aufbau({ fetchWirft: true });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.equal(t.gateAufrufe.length, 0);
  });

  test("h) HEAD^2 fehlt (kein Merge-Ref): Exit 1", () => {
    const t = aufbau({ head2Fehlt: true, fetchTips: ["aaa"] });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
  });
});
