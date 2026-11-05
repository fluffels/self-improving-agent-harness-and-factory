/* Nachliefer-Aufträge ohne Key (factory#213): Auftrag ablegen (Agentenkontext, ohne Zugang und Netz) und vom SessionStart-Hook ausführen lassen.
 *
 * @harness-waechter – sichert die Regel „Kein Secret-Key im Agentenlauf“ für den Auslöse-Weg: der Agent-Aufruf läuft ohne Key und ohne Netz, nur der Hook-Kind-Prozess liest den Key.
 * Weder ~/.claude noch Langfuse werden angefasst: Temp-Ordner, injiziertes lauf/Uhr; der Prozess-Test biegt das Home um.
 */
import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixture } from "../support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawAuftrag from "../../scripts/langfuse-auftrag.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNach from "../../scripts/langfuse-nachliefern.mjs";

type Args = { ausloeser: string | null; session: string | null; aktuell: string | null; beendet: string | null; auftrag: string | null; fehler: string | null };
type Ergebnis = { exitCode: number; text: string; protokoll: { sessions: { status: string }[] } };
type Lauf = (a: Args, o: { now: number }) => Promise<Ergebnis>;
const A = rawAuftrag as unknown as {
  AUFTRAG_DATEI: string;
  AUFTRAG_ALTER_MS: number;
  auftragLegen: (dir: string, session: unknown, now?: number) => boolean;
  auftraegeLesen: (dir: string, now?: number) => string[];
  auftragErledigen: (dir: string, session: string) => void;
};
const N = rawNach as unknown as {
  parseArgs: (a: string[]) => Args;
  hookLauf: (a: Args, o: { stateDir: string; lauf: Lauf; schlafen: (ms: number) => Promise<void>; uhr: () => number; pid: number }) => Promise<{ lock: string; ergebnis: Ergebnis | null }>;
};

const T0 = Date.parse("2026-11-05T10:00:00Z");
const SKRIPT = fileURLToPath(new URL("../../scripts/langfuse-nachliefern.mjs", import.meta.url));
const dateiVon = (dir: string) => join(dir, A.AUFTRAG_DATEI);

describe("Auftragsdatei", () => {
  test("ablegen, lesen (älteste zuerst), erledigen; gleiche Session zweimal ist ein Eintrag", () => {
    const dir = join(fixture({}), "state");
    expect(A.auftragLegen(dir, "s2", T0 + 1000)).toBe(true);
    expect(A.auftragLegen(dir, "s1", T0)).toBe(true);
    expect(A.auftragLegen(dir, "s1", T0 + 2000)).toBe(true);
    expect(A.auftraegeLesen(dir, T0 + 5000)).toEqual(["s2", "s1"]);
    A.auftragErledigen(dir, "s2");
    expect(A.auftraegeLesen(dir, T0 + 5000)).toEqual(["s1"]);
    A.auftragErledigen(dir, "unbekannt");
    expect(A.auftraegeLesen(dir, T0 + 5000)).toEqual(["s1"]);
  });

  test("eine ungültige Session-ID legt nichts ab (Negativfall)", () => {
    const dir = join(fixture({}), "state");
    for (const id of ["--json", "", "a b", "../x", null, 42]) expect(A.auftragLegen(dir, id, T0)).toBe(false);
    expect(existsSync(dateiVon(dir))).toBe(false);
  });

  test("ein verfallener Auftrag zählt nicht, eine kaputte oder fremd geformte Datei liest als leer", () => {
    const dir = join(fixture({}), "state");
    A.auftragLegen(dir, "alt", T0);
    expect(A.auftraegeLesen(dir, T0 + A.AUFTRAG_ALTER_MS - 1)).toEqual(["alt"]);
    expect(A.auftraegeLesen(dir, T0 + A.AUFTRAG_ALTER_MS)).toEqual([]);
    writeFileSync(dateiVon(dir), "{kaputt");
    expect(A.auftraegeLesen(dir, T0)).toEqual([]);
    writeFileSync(dateiVon(dir), JSON.stringify({ auftraege: ["x"] }));
    expect(A.auftraegeLesen(dir, T0)).toEqual([]);
    writeFileSync(dateiVon(dir), JSON.stringify(null));
    expect(A.auftraegeLesen(dir, T0)).toEqual([]);
    expect(() => A.auftragLegen(dir, "neu", T0)).not.toThrow();
    expect(A.auftraegeLesen(dir, T0)).toEqual(["neu"]);
  });
});

describe("SessionStart-Hook führt Aufträge aus", () => {
  const START = ["--ausloeser", "sessionstart", "--aktuell", "cur"];
  const ergebnis = (status: string, exitCode = 0): Ergebnis => ({ exitCode, text: "", protokoll: { sessions: status ? [{ status }] : [] } });
  const aufbau = (statusJeSession: Record<string, string> = {}, exitCode = 0) => {
    const stateDir = join(fixture({}), "state");
    const aufrufe: string[] = [];
    const lauf: Lauf = (a) => {
      aufrufe.push(`${a.ausloeser}:${a.session}:${a.aktuell}`);
      return Promise.resolve(ergebnis(statusJeSession[a.session ?? ""] ?? "gesendet", exitCode));
    };
    const fahre = (args: string[]) => N.hookLauf(N.parseArgs(args), { stateDir, lauf, schlafen: () => Promise.resolve(), uhr: () => T0, pid: 7 });
    return { stateDir, aufrufe, fahre };
  };

  test("ohne Aufträge läuft nur der Haupt-Lauf (Negativfall)", async () => {
    const a = aufbau();
    await a.fahre(START);
    expect(a.aufrufe).toEqual(["sessionstart:null:cur"]);
  });

  test("ein Auftrag wird je Session außerhalb des Fensters (--session) ausgeführt und danach entfernt; Haupt-Ergebnis bleibt der Rückgabewert", async () => {
    const a = aufbau();
    A.auftragLegen(a.stateDir, "alt1", T0 - 1000);
    const r = await a.fahre(START);
    expect(a.aufrufe).toEqual(["sessionstart:null:cur", "null:alt1:cur"]);
    expect(A.auftraegeLesen(a.stateDir, T0)).toEqual([]);
    expect(r.ergebnis?.protokoll.sessions).toEqual([{ status: "gesendet" }]);
  });

  test.each([["mehrdeutig"], ["läuft"], ["Fehler"], ["aktuell"]])("Status %s: der Auftrag bleibt für den nächsten Start", async (status) => {
    const a = aufbau({ alt1: status });
    A.auftragLegen(a.stateDir, "alt1", T0 - 1000);
    await a.fahre(START);
    expect(A.auftraegeLesen(a.stateDir, T0)).toEqual(["alt1"]);
  });

  test("Lauf mit Fehlerexit: der Auftrag bleibt; eine unbekannte Session (kein Treffer) erledigt ihn", async () => {
    const rot = aufbau({}, 1);
    A.auftragLegen(rot.stateDir, "alt1", T0 - 1000);
    await rot.fahre(START);
    expect(A.auftraegeLesen(rot.stateDir, T0)).toEqual(["alt1"]);
    const leer = aufbau({ alt1: "" });
    A.auftragLegen(leer.stateDir, "alt1", T0 - 1000);
    await leer.fahre(START);
    expect(A.auftraegeLesen(leer.stateDir, T0)).toEqual([]);
  });

  test("belegter Lock: der Auftrag bleibt, es läuft nichts", async () => {
    const a = aufbau();
    A.auftragLegen(a.stateDir, "alt1", T0 - 1000);
    mkdirSync(a.stateDir, { recursive: true });
    writeFileSync(join(a.stateDir, "langfuse-abgleich.lock"), JSON.stringify({ pid: 4242, zeit: T0 }));
    await a.fahre(START);
    expect(a.aufrufe).toEqual([]);
    expect(A.auftraegeLesen(a.stateDir, T0)).toEqual(["alt1"]);
  });

  test("SessionEnd führt keine Aufträge aus", async () => {
    const a = aufbau();
    A.auftragLegen(a.stateDir, "alt1", T0 - 1000);
    await a.fahre(["--ausloeser", "sessionend", "--session", "s1", "--beendet", "s1"]);
    expect(a.aufrufe).toEqual(["sessionend:s1:null"]);
    expect(A.auftraegeLesen(a.stateDir, T0)).toEqual(["alt1"]);
  });
});

describe("--auftrag im Agentenkontext liest nie einen Key", () => {
  const fahre = (home: string, args: string[]) =>
    spawnSync(process.execPath, [SKRIPT, ...args], { encoding: "utf8", timeout: 30_000, env: { ...process.env, USERPROFILE: home, HOME: home, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", LANGFUSE_BASE_URL: "" } });

  test("ohne jeden Zugang: Exit 0, Auftrag liegt im Zustandsordner, kein Lauf (kein Log, kein Ledger); ein Lauf mit Zugangsprüfung scheiterte hier mit Exit 2", () => {
    const home = fixture({});
    const r = fahre(home, ["--auftrag", "abc-123"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Auftrag abgelegt: abc-123");
    const state = join(home, ".claude", "state");
    expect(JSON.parse(readFileSync(dateiVon(state), "utf8")).auftraege).toHaveProperty("abc-123");
    expect(existsSync(join(state, "langfuse-abgleich.log"))).toBe(false);
    expect(existsSync(join(state, "langfuse-abgleich.json"))).toBe(false);
    // Gegenprobe: derselbe Prozess ohne --auftrag will den Zugang und scheitert ohne Key (Exit 2): der Auftrag-Pfad liest ihn also wirklich nie.
    expect(fahre(home, ["--trocken"]).status).toBe(2);
  });

  test("ungültige Session-ID: Exit 2, nichts abgelegt", () => {
    const home = fixture({});
    const r = fahre(home, ["--auftrag", "a b"]);
    expect(r.status).toBe(2);
    expect(existsSync(dateiVon(join(home, ".claude", "state")))).toBe(false);
  });
});
