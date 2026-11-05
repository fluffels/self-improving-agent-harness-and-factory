/* Nachliefer-Aufträge ohne Key (factory#213): Auftrag ablegen (Agentenkontext, ohne Zugang und Netz) und vom SessionStart-Hook ausführen lassen.
 *
 * @harness-waechter – sichert die Regel „Kein Secret-Key im Agentenlauf“ für den Auslöse-Weg: der Agent-Aufruf läuft ohne Key und ohne Netz, nur der Hook-Kind-Prozess liest den Key.
 * Weder ~/.claude noch Langfuse werden angefasst: Temp-Ordner, injiziertes lauf/Uhr; der Prozess-Test biegt das Home um.
 */
import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixture } from "../support/tmp-fixture";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawAuftrag from "../../scripts/langfuse-auftrag.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNach from "../../scripts/langfuse-nachliefern.mjs";

type Args = { ausloeser: string | null; session: string | null; aktuell: string | null; beendet: string | null; auftrag: string | null; fehler: string | null };
type Ergebnis = { exitCode: number; text: string; protokoll: Record<string, unknown> & { sessions: { status: string }[] } };
type Lauf = (a: Args, o: { now: number }) => Promise<Ergebnis>;
const A = rawAuftrag as unknown as {
  AUFTRAG_DATEI: string;
  AUFTRAG_ALTER_MS: number;
  auftragLegen: (dir: string, session: unknown, now?: number) => boolean;
  auftraegeLesen: (dir: string, now?: number) => string[];
  auftragErledigen: (dir: string, session: string) => void;
  auftragAufruf: (argv: string[], dir: string, now?: number) => { exitCode: number; text: string };
  AUFRUFHILFE: string;
};
const N = rawNach as unknown as {
  parseArgs: (a: string[]) => Args;
  hookLauf: (a: Args, o: { stateDir: string; lauf: Lauf; schlafen: (ms: number) => Promise<void>; uhr: () => number; pid: number }) => Promise<{ lock: string; ergebnis: Ergebnis | null }>;
};

const T0 = Date.parse("2026-11-05T10:00:00Z");
const SKRIPT_DIR = fileURLToPath(new URL("../../scripts/", import.meta.url));
const NACHLIEFERN = join(SKRIPT_DIR, "langfuse-nachliefern.mjs");
const AUFTRAG = join(SKRIPT_DIR, "langfuse-auftrag.mjs");
const dateiVon = (dir: string) => join(dir, A.AUFTRAG_DATEI);
const auftraegeAus = (datei: string) => (JSON.parse(readFileSync(datei, "utf8")) as { auftraege: Record<string, string> }).auftraege;

describe("Auftragsdatei", () => {
  test("ablegen, lesen (älteste zuerst), erledigen; gleiche Session zweimal ist ein Eintrag", () => {
    const dir = join(fixture({}), "state");
    expect(A.auftragLegen(dir, "s1", T0 + 1000)).toBe(true);
    expect(A.auftragLegen(dir, "s2", T0)).toBe(true);
    expect(A.auftragLegen(dir, "s3", T0 + 3000)).toBe(true);
    expect(A.auftragLegen(dir, "s1", T0 + 2000)).toBe(true);
    expect(A.auftraegeLesen(dir, T0 + 5000)).toEqual(["s2", "s1", "s3"]);
    A.auftragErledigen(dir, "s3");
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
    // fremd geformter Inhalt (Zeichenkette statt Objekt) wird beim Ablegen nicht übernommen
    writeFileSync(dateiVon(dir), JSON.stringify({ auftraege: null }));
    expect(A.auftraegeLesen(dir, T0)).toEqual([]);
    writeFileSync(dateiVon(dir), JSON.stringify({ auftraege: "text" }));
    expect(A.auftragLegen(dir, "neu", T0)).toBe(true);
    expect(Object.keys(auftraegeAus(dateiVon(dir)))).toEqual(["neu"]);
    expect(A.auftraegeLesen(dir, T0)).toEqual(["neu"]);
  });

  test("ein ungültiger Schlüssel in der Datei wird nicht als Auftrag gelesen; Erledigen ohne Eintrag schreibt nichts", () => {
    const dir = join(fixture({}), "state");
    mkdirSync(dir, { recursive: true });
    writeFileSync(dateiVon(dir), JSON.stringify({ auftraege: { "--json": new Date(T0).toISOString(), gut: new Date(T0).toISOString() } }));
    expect(A.auftraegeLesen(dir, T0)).toEqual(["gut"]);
    const leer = join(fixture({}), "state2");
    A.auftragErledigen(leer, "x");
    expect(existsSync(dateiVon(leer))).toBe(false);
  });
});

describe("SessionStart-Hook führt Aufträge aus", () => {
  const START = ["--ausloeser", "sessionstart", "--aktuell", "cur"];
  const ergebnis = (status: string, exitCode = 0): Ergebnis => ({ exitCode, text: "", protokoll: { zugang: true, geprueft: 1, gesendet: 0, spans: 0, dubletten: 0, wuerdeSenden: 0, uebrig: 0, fehler: [], sessions: status ? [{ status }] : [] } });
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

  test("der Auftrags-Lauf steht mit Auslöser auftrag im Log; ein verfallener Auftrag läuft nicht (Uhr des Hooks)", async () => {
    const a = aufbau();
    A.auftragLegen(a.stateDir, "frisch", T0 - 1000);
    A.auftragLegen(a.stateDir, "verfallen", T0 - A.AUFTRAG_ALTER_MS);
    await a.fahre(START);
    expect(a.aufrufe).toEqual(["sessionstart:null:cur", "null:frisch:cur"]);
    const zeilen = readFileSync(join(a.stateDir, "langfuse-abgleich.log"), "utf8").trim().split("\n").map((z) => JSON.parse(z) as { ausloeser: string; session: string | null });
    expect(zeilen.map((z) => [z.ausloeser, z.session])).toEqual([["sessionstart", "cur"], ["auftrag", "frisch"]]);
  });

  test("SessionEnd führt keine Aufträge aus", async () => {
    const a = aufbau();
    A.auftragLegen(a.stateDir, "alt1", T0 - 1000);
    await a.fahre(["--ausloeser", "sessionend", "--session", "s1", "--beendet", "s1"]);
    expect(a.aufrufe).toEqual(["sessionend:s1:null"]);
    expect(A.auftraegeLesen(a.stateDir, T0)).toEqual(["alt1"]);
  });
});

describe("auftragAufruf (Einstieg)", () => {
  test("genau eine gültige Session-ID legt ab; keine, mehrere oder eine ungültige ID (auch ein Flag) legen nichts ab und enden mit Exit 2", () => {
    const dir = join(fixture({}), "state");
    for (const argv of [[], ["a", "b"], ["--json"], ["a b"], ["--auftrag", "abc"]]) {
      const r = A.auftragAufruf(argv, dir, T0);
      expect(r.exitCode).toBe(2);
      expect(r.text).toContain(A.AUFRUFHILFE);
    }
    expect(existsSync(dateiVon(dir))).toBe(false);
    expect(A.auftragAufruf(["abc-1"], dir, T0)).toEqual({ exitCode: 0, text: "Auftrag abgelegt: abc-1 (der nächste SessionStart-Lauf liefert nach)" });
    expect(A.auftraegeLesen(dir, T0)).toEqual(["abc-1"]);
  });
});

describe("Der Agent-Einstieg liest nie einen Key (Negativfall der Maintainerin, factory#213)", () => {
  const spezifizierer = (datei: string): string[] => [...readFileSync(datei, "utf8").matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g)].map((m) => m[1]);
  const fahre = (skript: string, home: string, args: string[]) =>
    spawnSync(process.execPath, [skript, ...args], { encoding: "utf8", timeout: 30_000, env: { ...process.env, USERPROFILE: home, HOME: home, LANGFUSE_PUBLIC_KEY: "", LANGFUSE_SECRET_KEY: "", LANGFUSE_BASE_URL: "" } });

  test("Import-Hülle: langfuse-auftrag.mjs zieht nur Node-Builtins und direktaufruf.mjs (nur Builtins), nie langfuse-zugang oder langfuse-api", () => {
    const eigene = spezifizierer(AUFTRAG);
    expect(eigene.length).toBeGreaterThan(0);
    expect(eigene.filter((m) => !m.startsWith("node:") && m !== "./direktaufruf.mjs")).toEqual([]);
    expect(spezifizierer(join(SKRIPT_DIR, "direktaufruf.mjs")).filter((m) => !m.startsWith("node:"))).toEqual([]);
    // Gegenprobe: der Nachlieferer selbst zieht den Zugang, die Hülle unterscheidet also wirklich.
    expect(spezifizierer(NACHLIEFERN)).toEqual(expect.arrayContaining(["./langfuse-zugang.mjs", "./langfuse-api.mjs"]));
  });

  test("ohne jeden Zugang: Exit 0, Auftrag liegt im Zustandsordner, kein Lauf (kein Log, kein Ledger)", () => {
    const home = fixture({});
    const r = fahre(AUFTRAG, home, ["abc-123"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Auftrag abgelegt: abc-123");
    const state = join(home, ".claude", "state");
    expect(auftraegeAus(dateiVon(state))).toHaveProperty("abc-123");
    expect(existsSync(join(state, "langfuse-abgleich.log"))).toBe(false);
    expect(existsSync(join(state, "langfuse-abgleich.json"))).toBe(false);
  });

  test("Gegenprobe: der Nachlieferer ohne Key scheitert an der Zugangsprüfung (Exit 2, Meldung nennt den Auftrag-Einstieg)", () => {
    const r = fahre(NACHLIEFERN, fixture({}), ["--trocken"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Kein Langfuse-Zugang");
    expect(r.stderr).toContain("node scripts/langfuse-auftrag.mjs <session-id>");
  });

  test("ungültige Aufrufe über den Prozess: Exit 2, nichts abgelegt", () => {
    const home = fixture({});
    for (const args of [["a b"], [], ["a", "b"], ["--auftrag", "x"]]) {
      const r = fahre(AUFTRAG, home, args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("Aufruf: node scripts/langfuse-auftrag.mjs <session-id>");
      expect(r.stdout).toBe("");
    }
    expect(existsSync(dateiVon(join(home, ".claude", "state")))).toBe(false);
  });

  test("ein Import des Moduls startet den Einstieg nicht (Direktaufruf-Guard): keine Ausgabe, Exit 0, nichts angelegt", () => {
    const home = fixture({});
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", `import ${JSON.stringify(pathToFileURL(AUFTRAG).href)};`], { encoding: "utf8", timeout: 30_000, env: { ...process.env, USERPROFILE: home, HOME: home } });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe("");
    expect(existsSync(join(home, ".claude"))).toBe(false);
  });
});
