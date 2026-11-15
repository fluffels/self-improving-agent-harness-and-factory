/* Basis-Nachlauf-Wächter (factory#499 L7): schließt das Fenster zwischen letztem Einmergen von main und Auto-Merge.
 * Alle Fälle laufen über injizierte io (git, gate, out, err, env); kein echtes git, kein echtes Gate.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
// Tooling-Skript ohne Declaration-File: Oberfläche einmal festlegen (kein no-unsafe-call).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/check-basis-nachlauf.mjs";

type Env = Record<string, string | undefined>;
interface Io {
  git: (args: string[]) => string;
  gate: (befehl: string, env: Env) => number;
  out: (z: string) => void;
  err: (z: string) => void;
}
type Spawn = (cmd: string, args: string[], opts: Record<string, unknown>) => { status: number | null; stdout?: string; stderr?: string };
const { MAX_RUNDEN, echteIo, fuehreAus, naechsterSchritt } = raw as unknown as {
  echteIo: (spawn: Spawn, cwd: string) => { git: (a: string[]) => string; gate: (b: string, e: Env) => number };
  MAX_RUNDEN: number;
  fuehreAus: (env: Env, io: Io) => number;
  naechsterSchritt: (a: { getestet: string; aktuell: string; runde: number; max: number }) => string;
};

function aufbau(opts: { head1?: string; fetchTips?: string[]; mergeFehler?: boolean; gateExit?: number[]; head2Fehlt?: boolean; fetchWirft?: boolean; abortWirft?: boolean; env?: Env }) {
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
      if (a.includes("merge --abort")) {
        if (opts.abortWirft) throw new Error("kein Merge im Gang");
        return "";
      }
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
    const verify = t.gateAufrufe[1];
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

  test("e) Merge scheitert ohne laufenden Merge (--abort wirft): trotzdem Exit 1 mit Konflikt-Meldung", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["ccc"], mergeFehler: true, abortWirft: true });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.match(t.fehler.join("\n"), /einmergen, Konflikt lösen, pushen/);
  });

  test("abweichende Basis-Ref: fetch, Meldungen e/f und Merge-Identität nutzen sie; install bekommt die Diff-Basis", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["ccc"], mergeFehler: true, env: { FACTORY_BASIS_REF: "release/x" } });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.deepEqual(t.gitAufrufe.find((a) => a.includes("fetch")), ["fetch", "--no-tags", "origin", "--", "release/x"]);
    assert.match(t.fehler.join("\n"), /neuem release\/x .*origin\/release\/x einmergen/);
    const g = aufbau({ head1: "aaa", fetchTips: ["ccc"], gateExit: [0, 1], env: { FACTORY_BASIS_REF: "release/x", FACTORY_COVERAGE: "1" } });
    assert.equal(fuehreAus(g.io.env, g.io), 1);
    assert.match(g.fehler.join("\n"), /semantischer Konflikt mit neuem release\/x .*origin\/release\/x einmergen/);
    const install = g.gateAufrufe[0];
    assert.deepEqual([install.befehl, install.env.FACTORY_DIFF_BASE, install.env.FACTORY_COVERAGE], ["install", "ccc", undefined]);
    const merge = g.gitAufrufe.find((a) => a.includes("--no-ff"))!;
    assert.deepEqual(merge.slice(0, 4), ["-c", "user.name=basis-nachlauf", "-c", "user.email=basis-nachlauf@invalid"]);
    assert.deepEqual(merge.slice(4), ["merge", "--no-edit", "--no-ff", "ccc"]);
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

  test("install rot: Exit 1, kein verifyKompakt", () => {
    const t = aufbau({ head1: "aaa", fetchTips: ["ccc"], gateExit: [1] });
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.deepEqual(
      t.gateAufrufe.map((g) => g.befehl),
      ["install"],
    );
    assert.match(t.fehler.join("\n"), /install/);
  });

  test("h) Fehler ohne Error-Objekt: Meldung nennt den Wert", () => {
    const t = aufbau({ fetchTips: ["aaa"] });
    t.io.git = () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw "kaputt-als-text";
    };
    assert.equal(fuehreAus(t.io.env, t.io), 1);
    assert.match(t.fehler.join("\n"), /kaputt-als-text/);
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

describe("echteIo (injizierter spawn)", () => {
  const aufrufe: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
  const mit = (r: { status: number | null; stdout?: string; stderr?: string }): Spawn => (cmd, args, opts) => (aufrufe.push({ cmd, args, opts }), r);
  test("git: liefert stdout im angegebenen Verzeichnis; Status ≠ 0 wirft mit stderr", () => {
    assert.equal(echteIo(mit({ status: 0, stdout: "abc\n" }), "/w").git(["rev-parse", "HEAD"]), "abc\n");
    assert.deepEqual([aufrufe.at(-1)!.cmd, aufrufe.at(-1)!.opts.cwd], ["git", "/w"]);
    assert.throws(() => echteIo(mit({ status: 128, stderr: " fatal: x \n" }), "/w").git(["fetch"]), /git fetch schlug fehl: fatal: x$/);
    assert.throws(() => echteIo(mit({ status: null }), "/w").git(["fetch"]), /schlug fehl/);
  });
  test("gate: reicht Befehl, Umgebung und cwd durch; Status null zählt als 1", () => {
    assert.equal(echteIo(mit({ status: 0 }), "/w").gate("install", { A: "1" }), 0);
    const a = aufrufe.at(-1)!;
    assert.deepEqual(a.args, ["scripts/gate-befehl.mjs", "install"]);
    assert.deepEqual([a.opts.cwd, a.opts.env, a.opts.stdio], ["/w", { A: "1" }, "inherit"]);
    assert.deepEqual([3, null].map((status) => echteIo(mit({ status }), "/w").gate("verifyKompakt", {})), [3, 1]);
  });
});
