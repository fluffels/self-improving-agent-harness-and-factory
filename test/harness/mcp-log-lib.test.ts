/* @harness-waechter
 * MCP-Log-Lib (factory#323 L1/L7/L18): Bewertung der Langfuse-MCP-Verbindung aus den Claude-Code-Logs (verbunden, getrennt, nicht prüfbar, Rückfall ohne eigenen Start),
 * Fenstergrenze, Lesen nur der `.jsonl`-Dateien, Worktree-Ordner → Hauptcheckout, URL-Abweichung. Die Pfad-Helfer testet `mcp-ausfall.test.ts`.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface. */
import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für die .mjs-Lib.
import * as raw from "../../scripts/mcp-log-lib.mjs";

type Urteil = { status: string; grund: string; quelle: string; url?: string | null; code?: string; zeit?: string };
type Datei = { ordner: string; suffix: string; zeilen: string[] };
type Lib = {
  mcpVerbindung: (zeilen: string[], o: { sessionId?: string; seit: string; dateien?: string[][] }) => Urteil;
  urlAbweichung: (mcpUrl: string | null, basisUrl: string) => string | null;
  istArbeitsplatzGeladen: (config?: unknown) => boolean;
  leseLogDateien: (o: { basis: string; wurzel: string; seitMs: number; mitArbeitsplatz?: boolean; ordnerFilter?: (o: string) => boolean }) => Datei[] | null;
};
const l = raw as unknown as Lib;

const SID = "sess-1";
const SEIT = "2026-11-11T08:00:00.000Z";
const zeile = (debug: string, zeit: string, sessionId = SID) => JSON.stringify({ debug, timestamp: zeit, sessionId, cwd: "/x" });
const INIT = (zeit: string, sid = SID, url = "http://localhost:3000/api/public/mcp") => zeile(`Initializing HTTP transport to ${url}`, zeit, sid);
const START = (zeit: string, sid = SID) => zeile("Starting connection with timeout of 30000ms", zeit, sid);
const ERFOLG = (zeit: string, sid = SID) => zeile("Successfully connected (transport: http) in 46ms", zeit, sid);
const REFUSED = (zeit: string, sid = SID) => zeile("HTTP Connection failed after 19ms: ECONNREFUSED: Unable to connect (code: ECONNREFUSED, errno: none)", zeit, sid);
const OHNE_CODE = (zeit: string, sid = SID) => zeile("Connection failed after 5ms: kaputt", zeit, sid);

describe("mcpVerbindung", () => {
  test("letzter Start mit Erfolg: verbunden, mit der MCP-URL aus dem Log", () => {
    const z = [INIT("2026-11-11T09:00:00.000Z"), START("2026-11-11T09:00:00.001Z"), ERFOLG("2026-11-11T09:00:00.050Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT })).toMatchObject({ status: "verbunden", quelle: "session", url: "http://localhost:3000/api/public/mcp" });
  });
  test("letzter Start mit ECONNREFUSED ohne späteren Erfolg: getrennt mit Code und Zeit", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), REFUSED("2026-11-11T09:00:01.000Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT })).toMatchObject({ status: "getrennt", code: "ECONNREFUSED", zeit: "2026-11-11T09:00:01.000Z" });
  });
  test("Fehler ohne Netzcode: Code „Verbindungsfehler“ (Rückfall der Fehlerzeile)", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), OHNE_CODE("2026-11-11T09:00:01.000Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT })).toMatchObject({ status: "getrennt", code: "Verbindungsfehler" });
  });
  test("`version negotiation probe failed` zählt als Verbindungsfehler: getrennt", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), zeile("version negotiation probe failed: ECONNREFUSED", "2026-11-11T09:00:01.000Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT }).status).toBe("getrennt");
  });
  test("Werkzeugfehler mitten im Text (ECONNREFUSED, Connection failed) nach dem Erfolg sperrt nicht: verbunden", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), ERFOLG("2026-11-11T09:00:00.050Z"), zeile("Tool x: ECONNREFUSED beim Aufruf", "2026-11-11T09:30:00.000Z"), zeile("Tool y: HTTP Connection failed nach 5ms", "2026-11-11T09:31:00.000Z"), zeile("Tool z: version negotiation probe failed", "2026-11-11T09:32:00.000Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT }).status).toBe("verbunden");
  });
  test("Fehler, dann erfolgreiche Neuverbindung: verbunden", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), REFUSED("2026-11-11T09:00:01.000Z"), START("2026-11-11T09:00:05.000Z"), ERFOLG("2026-11-11T09:00:05.050Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT }).status).toBe("verbunden");
  });
  test("Erfolg, danach ein Fehler ohne Neuverbindung: getrennt", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), ERFOLG("2026-11-11T09:00:00.050Z"), REFUSED("2026-11-11T10:00:00.000Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT }).status).toBe("getrennt");
  });
  test("neuer Start ohne Ergebnis nach altem Fehler: nicht prüfbar statt alter Fehler", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), REFUSED("2026-11-11T09:00:01.000Z"), START("2026-11-11T09:05:00.000Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT })).toMatchObject({ status: "nicht-pruefbar", grund: "Verbindungsstart ohne Ergebnis" });
  });
  test("kein Start, keine Zeilen und kaputte Zeilen: nicht prüfbar", () => {
    expect(l.mcpVerbindung([], { sessionId: SID, seit: SEIT })).toMatchObject({ status: "nicht-pruefbar", grund: "kein Verbindungsstart im Fenster" });
    expect(l.mcpVerbindung(["{kaputt", "null", "7"], { sessionId: SID, seit: SEIT }).status).toBe("nicht-pruefbar");
  });
  test("Subagent ohne eigenen Start: Rückfall auf den jüngsten Start im Fenster, bewertet (nicht nicht prüfbar)", () => {
    const z = [START("2026-11-11T09:00:00.000Z", "haupt"), ERFOLG("2026-11-11T09:00:00.050Z", "haupt"), START("2026-11-11T09:30:00.000Z", "andere"), REFUSED("2026-11-11T09:30:01.000Z", "andere")];
    expect(l.mcpVerbindung(z, { sessionId: "sub", seit: SEIT })).toMatchObject({ status: "getrennt", quelle: "rueckfall", code: "ECONNREFUSED" });
    expect(l.mcpVerbindung(z.slice(0, 2), { sessionId: "sub", seit: SEIT })).toMatchObject({ status: "verbunden", quelle: "rueckfall" });
  });
  test("eigene Zeilen der Session ohne eigenen Start (nur Werkzeug-Zeilen): ebenfalls Rückfall", () => {
    const z = [START("2026-11-11T09:00:00.000Z", "haupt"), ERFOLG("2026-11-11T09:00:00.050Z", "haupt"), zeile("Tool 'x' completed successfully in 5ms", "2026-11-11T09:10:00.000Z", "sub")];
    expect(l.mcpVerbindung(z, { sessionId: "sub", seit: SEIT })).toMatchObject({ status: "verbunden", quelle: "rueckfall" });
  });
  test("ohne Session-ID gilt ebenfalls der Rückfall", () => {
    expect(l.mcpVerbindung([START("2026-11-11T09:00:00.000Z"), ERFOLG("2026-11-11T09:00:00.050Z")], { seit: SEIT })).toMatchObject({ status: "verbunden", quelle: "rueckfall" });
  });
  test("hat die Session einen eigenen Start, zählt nur sie, auch wenn eine fremde Session jünger ist", () => {
    const z = [START("2026-11-11T09:00:00.000Z"), ERFOLG("2026-11-11T09:00:00.050Z"), START("2026-11-11T09:30:00.000Z", "andere"), REFUSED("2026-11-11T09:30:01.000Z", "andere")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT })).toMatchObject({ status: "verbunden", quelle: "session" });
  });
  describe("Zuordnung zur Prozess-Datei (Session-ID-Wechsel nach /clear oder Resume)", () => {
    const alt = [START("2026-11-11T09:00:00.000Z", "sid-alt"), REFUSED("2026-11-11T09:00:01.000Z", "sid-alt"), zeile("Tool 'x' completed successfully in 5ms", "2026-11-11T09:10:00.000Z", "sid-neu")];
    const fremd = [START("2026-11-11T09:30:00.000Z", "sid-fremd"), ERFOLG("2026-11-11T09:30:00.050Z", "sid-fremd")];
    const urteil = (dateien: string[][], sessionId = "sid-neu") => l.mcpVerbindung(dateien.flat(), { sessionId, seit: SEIT, dateien });
    test("neue Session-ID ohne Start in der Prozess-Datei: deren Ausfall zählt, nicht der Erfolg einer fremden Datei", () => {
      expect(urteil([alt, fremd])).toMatchObject({ status: "getrennt", quelle: "prozess", code: "ECONNREFUSED" });
    });
    test("Reconnect später in der Prozess-Datei: verbunden (quelle prozess)", () => {
      const re = [...alt, START("2026-11-11T09:20:00.000Z", "sid-alt"), ERFOLG("2026-11-11T09:20:00.050Z", "sid-alt")];
      expect(urteil([re, fremd])).toMatchObject({ status: "verbunden", quelle: "prozess" });
    });
    test("mehrere Prozess-Dateien mit eigenen Zeilen: die mit den jüngsten eigenen Zeilen zählt, unabhängig von der Listenfolge", () => {
      const jung = [START("2026-11-11T09:20:00.000Z", "sid-alt"), ERFOLG("2026-11-11T09:20:00.050Z", "sid-alt"), zeile("Tool 'x' completed successfully in 5ms", "2026-11-11T09:25:00.000Z", "sid-neu")];
      expect(urteil([jung, alt])).toMatchObject({ status: "verbunden", quelle: "prozess" });
      expect(urteil([alt, jung])).toMatchObject({ status: "verbunden", quelle: "prozess" });
    });
    test("eigener Start vorhanden: quelle session, auch mit Dateien", () => {
      const eigen = [START("2026-11-11T09:00:00.000Z", "sid-neu"), ERFOLG("2026-11-11T09:00:00.050Z", "sid-neu")];
      expect(urteil([eigen, [START("2026-11-11T09:30:00.000Z", "x"), REFUSED("2026-11-11T09:30:01.000Z", "x")]])).toMatchObject({ status: "verbunden", quelle: "session" });
    });
    test("keine eigene Zeile, fremde Session verbunden: nicht prüfbar", () => {
      expect(urteil([fremd])).toMatchObject({ status: "nicht-pruefbar", grund: "nur fremde Session verbunden" });
    });
    test("keine eigene Zeile, fremde Session getrennt: bleibt getrennt (streng)", () => {
      expect(urteil([[START("2026-11-11T09:30:00.000Z", "sid-fremd"), REFUSED("2026-11-11T09:30:01.000Z", "sid-fremd")]])).toMatchObject({ status: "getrennt", quelle: "rueckfall" });
    });
  });
  test("Fenstergrenze: ein Start genau an `seit` zählt, eine Millisekunde davor nicht", () => {
    const an = [START("2026-11-11T08:00:00.000Z"), REFUSED("2026-11-11T08:00:00.500Z")];
    expect(l.mcpVerbindung(an, { sessionId: SID, seit: SEIT }).status).toBe("getrennt");
    const davor = [START("2026-11-11T07:59:59.999Z"), REFUSED("2026-11-11T08:00:00.500Z")];
    expect(l.mcpVerbindung(davor, { sessionId: SID, seit: SEIT }).status).toBe("nicht-pruefbar");
  });
  test("die Zeilen werden nach Zeitstempel geordnet (Dateien mehrerer Worktree-Ordner gemischt)", () => {
    const z = [ERFOLG("2026-11-11T09:00:00.050Z"), REFUSED("2026-11-11T09:00:01.000Z"), START("2026-11-11T09:00:00.000Z")];
    expect(l.mcpVerbindung(z, { sessionId: SID, seit: SEIT }).status).toBe("getrennt");
  });
});

describe("istArbeitsplatzGeladen", () => {
  test("Block `arbeitsplatz` ja, sonst nein; ein Zugriffsfehler der Config ergibt nein statt Wurf; ohne Angabe zählt die geladene Config", () => {
    expect(l.istArbeitsplatzGeladen({ arbeitsplatz: { wurzel: "/ap" } })).toBe(true);
    expect(l.istArbeitsplatzGeladen({})).toBe(false);
    expect(l.istArbeitsplatzGeladen({ get arbeitsplatz(): never { throw new Error("kaputt"); } })).toBe(false);
    expect(l.istArbeitsplatzGeladen()).toBe(false);
  });
});

describe("urlAbweichung", () => {
  test("gleicher Host und Port: keine Abweichung (Standardport und Pfad egal)", () => {
    expect(l.urlAbweichung("http://localhost:3000/api/public/mcp", "http://localhost:3000")).toBeNull();
    expect(l.urlAbweichung("https://lf.example/api/public/mcp", "https://lf.example:443")).toBeNull();
  });
  test("derselbe Host mit http und https hat andere Standardports: Abweichung", () => {
    expect(l.urlAbweichung("http://lf.example/x", "https://lf.example")).toContain("lf.example:80");
  });
  test.each([
    ["http://localhost:3000/x", "http://127.0.0.1:3000", "localhost:3000", "127.0.0.1:3000"],
    ["http://localhost:3000/x", "http://localhost:4000", "localhost:3000", "localhost:4000"],
    ["http://[::1]:3000/x", "http://localhost:3000", "[::1]:3000", "localhost:3000"],
  ])("%s gegen %s weicht ab und nennt beide Seiten", (mcp, basis, a, b) => {
    const t = l.urlAbweichung(mcp, basis);
    expect(t).toContain(a);
    expect(t).toContain(b);
  });
  test("unlesbare URL: keine Abweichung", () => {
    expect(l.urlAbweichung("kaputt", "http://localhost:3000")).toBeNull();
    expect(l.urlAbweichung("http://localhost:3000", "kaputt")).toBeNull();
    expect(l.urlAbweichung(null, "http://localhost:3000")).toBeNull();
  });
});

describe("leseLogDateien", () => {
  const SEIT_MS = Date.parse("2026-11-11T08:00:00.000Z");
  const baue = () => {
    const basis = mkdtempSync(join(tmpdir(), "mcp-log-lib-"));
    const ablegen = (projekt: string, server: string, name: string, text: string, zeit: Date | number) => {
      const dir = join(basis, projekt, server);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, name), text);
      utimesSync(join(dir, name), zeit, zeit);
    };
    return { basis, ablegen };
  };
  const NEU = new Date("2026-11-11T09:00:00.000Z");

  test("nur `.jsonl` zählt, `.json` und `.txt` bleiben draußen", () => {
    const { basis, ablegen } = baue();
    ablegen("-dev-proj", "mcp-logs-langfuse", "a.jsonl", "eins\n\nzwei\n", NEU);
    ablegen("-dev-proj", "mcp-logs-langfuse", "b.json", "nein\n", NEU);
    ablegen("-dev-proj", "mcp-logs-langfuse", "c.txt", "nein\n", NEU);
    expect(l.leseLogDateien({ basis, wurzel: "/dev/proj", seitMs: SEIT_MS })).toEqual([{ ordner: "mcp-logs-langfuse", suffix: "", zeilen: ["eins", "zwei"] }]);
  });
  test("Worktree-Wurzel führt in die Ordner des Hauptcheckouts und seiner Worktrees, nie in Namensvettern", () => {
    const { basis, ablegen } = baue();
    ablegen("-dev-proj", "mcp-logs-langfuse", "a.jsonl", "haupt\n", NEU);
    ablegen("-dev-proj--claude-worktrees-wt-1", "mcp-logs-langfuse", "a.jsonl", "wt\n", NEU);
    ablegen("-dev-proj2", "mcp-logs-langfuse", "a.jsonl", "fremd\n", NEU);
    const r = l.leseLogDateien({ basis, wurzel: "/dev/proj/.claude/worktrees/wt-1", seitMs: SEIT_MS }) ?? [];
    expect(r.map((d) => d.zeilen[0]).sort()).toEqual(["haupt", "wt"]);
    expect(r.find((d) => d.zeilen[0] === "wt")?.suffix).toBe("--claude-worktrees-wt-1");
  });
  test("Fenstergrenze der Datei: mtime knapp nach `seit` zählt, eine Millisekunde davor nicht", () => {
    const { basis, ablegen } = baue();
    // Sekunden als Float mit Bruchteil unter einer Millisekunde: `utimesSync(Date)` rundet auf Linux ab (FAQ „mtime-Vergleich … flaky“), die mtime läge sonst knapp unter `seit`.
    ablegen("-dev-proj", "mcp-logs-langfuse", "an.jsonl", "an\n", SEIT_MS / 1000 + 0.0005);
    ablegen("-dev-proj", "mcp-logs-langfuse", "davor.jsonl", "davor\n", (SEIT_MS - 1) / 1000);
    expect((l.leseLogDateien({ basis, wurzel: "/dev/proj", seitMs: SEIT_MS }) ?? []).map((d) => d.zeilen[0])).toEqual(["an"]);
  });
  test("im Arbeitsplatz führt eine Worktree-Wurzel `<wurzel>/.claude/worktrees/<repo>/<name>` zu den Ordnern der Wurzel", () => {
    const { basis, ablegen } = baue();
    ablegen("-ap", "mcp-logs-langfuse", "a.jsonl", "ap\n", NEU);
    const wt = "/ap/.claude/worktrees/web/wt-1";
    expect((l.leseLogDateien({ basis, wurzel: wt, seitMs: SEIT_MS, mitArbeitsplatz: true }) ?? []).map((d) => d.zeilen[0])).toEqual(["ap"]);
    expect(l.leseLogDateien({ basis, wurzel: wt, seitMs: SEIT_MS })).toEqual([]);
  });
  test("ordnerFilter wählt die Server-Ordner", () => {
    const { basis, ablegen } = baue();
    ablegen("-dev-proj", "mcp-logs-langfuse", "a.jsonl", "lf\n", NEU);
    ablegen("-dev-proj", "mcp-logs-anderer", "a.jsonl", "x\n", NEU);
    const r = l.leseLogDateien({ basis, wurzel: "/dev/proj", seitMs: SEIT_MS, ordnerFilter: (o) => o === "mcp-logs-langfuse" }) ?? [];
    expect(r.map((d) => d.zeilen[0])).toEqual(["lf"]);
  });
  test("Basisordner fehlt: null (nicht prüfbar), kein Wurf", () => {
    expect(l.leseLogDateien({ basis: join(tmpdir(), "gibt-es-nicht-mcp-log-lib"), wurzel: "/dev/proj", seitMs: SEIT_MS })).toBeNull();
  });
});
