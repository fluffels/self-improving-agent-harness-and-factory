/* @harness-waechter
 * Langfuse-Vorbedingung (#1663 L36): ohne erreichbares Langfuse startet kein Entwicklungslauf, sonst wird nichts getrackt.
 * Bewertung (HTTP-Status, Verbindungsfehler, Timeout), Prüfung mit injiziertem fetch, Exit-Codes und die Kopplung
 * (SessionStart-Eintrag, Anker in AGENTS.md, Skills). Kein Netz: fetch ist ein Stub.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface. */
import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/langfuse-vorbedingung.mjs";

type Urteil = { ok: boolean; grund: string };
type Fetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ status: number }>;
type Vorbedingung = {
  HEALTH_PFAD: string;
  FRIST_MS: number;
  bewerteHealth: (e: { status?: number; fehler?: string }) => Urteil;
  basisUrl: (env: Record<string, string | undefined>) => string;
  pruefeLangfuse: (o: { baseUrl: string; fetchImpl?: Fetch; fristMs?: number }) => Promise<Urteil>;
  main: (argv: string[], env: Record<string, string | undefined>, out: (s: string) => void, err: (s: string) => void, o?: { fetchImpl?: Fetch; fristMs?: number; home?: string; lies?: (p: string) => string; mcpZeilen?: () => string[] | string[][] | null; jetzt?: number }) => Promise<number>;
};
const v = raw as unknown as Vorbedingung;
const WURZEL = process.cwd();
const lies = (p: string) => readFileSync(join(WURZEL, p), "utf8");

const antwort = (status: number): Fetch => () => Promise.resolve({ status });
const verbindungAbgelehnt: Fetch = () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }));
const haengt: Fetch = (_url, init) =>
  new Promise((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });

describe("bewerteHealth", () => {
  test("HTTP 200 ist erreichbar", () => {
    expect(v.bewerteHealth({ status: 200 })).toEqual({ ok: true, grund: "Langfuse erreichbar (HTTP 200)" });
  });
  test.each([500, 503, 404, 302])("HTTP %i ist nicht erreichbar und nennt den Status", (status) => {
    const u = v.bewerteHealth({ status });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain(String(status));
  });
  test("Verbindungsfehler ist nicht erreichbar und nennt ihn", () => {
    const u = v.bewerteHealth({ fehler: "ECONNREFUSED" });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain("ECONNREFUSED");
  });
  test("weder Status noch Fehler ist nicht erreichbar (fail-closed)", () => {
    expect(v.bewerteHealth({}).ok).toBe(false);
  });
});

describe("basisUrl", () => {
  test("LANGFUSE_BASE_URL gewinnt, Standard ist localhost:3000, ein Schrägstrich am Ende fällt weg", () => {
    expect(v.basisUrl({ LANGFUSE_BASE_URL: "http://x:4000/" })).toBe("http://x:4000");
    expect(v.basisUrl({})).toBe("http://localhost:3000");
  });
});

describe("pruefeLangfuse", () => {
  test("ruft /api/public/health und bewertet 200 als ok", async () => {
    let url = "";
    const f: Fetch = (u) => ((url = u), Promise.resolve({ status: 200 }));
    expect((await v.pruefeLangfuse({ baseUrl: "http://h:1", fetchImpl: f })).ok).toBe(true);
    expect(url).toBe(`http://h:1${v.HEALTH_PFAD}`);
    expect(v.HEALTH_PFAD).toBe("/api/public/health");
  });
  test("HTTP 500 ist nicht ok", async () => {
    expect((await v.pruefeLangfuse({ baseUrl: "http://h", fetchImpl: antwort(500) })).ok).toBe(false);
  });
  test("ECONNREFUSED ist nicht ok und nennt den Code", async () => {
    const u = await v.pruefeLangfuse({ baseUrl: "http://h", fetchImpl: verbindungAbgelehnt });
    expect(u.ok).toBe(false);
    expect(u.grund).toContain("ECONNREFUSED");
  });
  test("Timeout bricht ab und ist nicht ok", async () => {
    const u = await v.pruefeLangfuse({ baseUrl: "http://h", fetchImpl: haengt, fristMs: 20 });
    expect(u.ok).toBe(false);
    expect(u.grund).toMatch(/Timeout/);
  });
  test("die Frist beträgt 3 s", () => {
    expect(v.FRIST_MS).toBe(3000);
  });
});

const keineDatei = () => {
  throw new Error("keine Datei");
};

describe("main", () => {
  const lauf = async (argv: string[], fetchImpl: Fetch) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await v.main(argv, {}, (s) => out.push(s), (s) => err.push(s), { fetchImpl, fristMs: 20, home: "/h", lies: keineDatei });
    return { code, out, err };
  };
  test("erreichbar: Exit 0", async () => {
    expect((await lauf([], antwort(200))).code).toBe(0);
  });
  test("nicht erreichbar: Exit 1 und die Meldung „Langfuse aus, bitte starten“ auf stderr", async () => {
    const r = await lauf([], antwort(500));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("Langfuse aus, bitte starten");
  });
  test("--sessionstart: Exit 0 auch bei Ausfall, die Warnung steht auf stdout", async () => {
    const r = await lauf(["--sessionstart"], verbindungAbgelehnt);
    expect(r.code).toBe(0);
    expect(r.out.join("\n")).toContain("Langfuse aus, bitte starten");
  });
  test("--sessionstart: die Warnung ist JSON mit systemMessage (sichtbar) und additionalContext (Session), #1663 H1", async () => {
    const r = await lauf(["--sessionstart"], verbindungAbgelehnt);
    expect(r.out).toHaveLength(1);
    const j = JSON.parse(r.out[0]) as { systemMessage: string; hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    expect(j.systemMessage).toContain("Langfuse aus, bitte starten");
    expect(j.hookSpecificOutput.hookEventName).toBe("SessionStart");
    expect(j.hookSpecificOutput.additionalContext).toContain("Ohne Langfuse startet kein Ticket");
  });
  test("die Basis-URL kommt wie beim Abgleich-Hook auch aus den Plugin-Optionen der User-Settings; die Umgebung hat Vorrang", async () => {
    const settings = JSON.stringify({ pluginConfigs: { "langfuse@x": { options: { LANGFUSE_BASE_URL: "http://plugin:3000/" } } } });
    const lies = (pfad: string) => {
      if (pfad.includes("settings.json")) return settings;
      throw new Error("keine Datei");
    };
    const urls: string[] = [];
    const f: Fetch = (url) => (urls.push(url), Promise.resolve({ status: 200 }));
    await v.main([], {}, () => {}, () => {}, { fetchImpl: f, home: "/h", lies });
    await v.main([], { LANGFUSE_BASE_URL: "http://env:1" }, () => {}, () => {}, { fetchImpl: f, home: "/h", lies });
    expect(urls).toEqual(["http://plugin:3000/api/public/health", "http://env:1/api/public/health"]);
  });
  test("die Vorbedingung liest nie eine Secret-Datei (.langfuse-secret, agent-secrets.env)", async () => {
    const gelesen: string[] = [];
    const lies = (pfad: string) => {
      gelesen.push(pfad);
      throw new Error("keine Datei");
    };
    const urls: string[] = [];
    const f: Fetch = (url) => (urls.push(url), Promise.resolve({ status: 200 }));
    await v.main([], {}, () => {}, () => {}, { fetchImpl: f, home: "/h", lies });
    expect(urls).toEqual(["http://localhost:3000/api/public/health"]);
    expect(gelesen.length).toBeGreaterThan(0);
    expect(gelesen.filter((p) => /langfuse-secret|agent-secrets/.test(p))).toEqual([]);
  });
  test("--sessionstart: erreichbar bleibt still", async () => {
    const r = await lauf(["--sessionstart"], antwort(200));
    expect(r.code).toBe(0);
    expect(r.out).toEqual([]);
  });
  test("unbekanntes Argument: Exit 2", async () => {
    expect((await lauf(["--nope"], antwort(200))).code).toBe(2);
  });
  test("--json erreichbar: Exit 0 und {erreichbar:true, grund:null} auf stdout, stderr leer", async () => {
    const r = await lauf(["--json"], antwort(200));
    expect(r.code).toBe(0);
    expect(r.out.map((z) => JSON.parse(z) as unknown)).toEqual([{ erreichbar: true, grund: null, mcp: { status: "nicht-pruefbar", grund: "keine Claude-Code-Session" } }]);
    expect(r.err).toEqual([]);
  });
  test("--json nicht erreichbar: Exit 1, stdout nennt den Grund, stderr bleibt leer", async () => {
    const r = await lauf(["--json"], antwort(500));
    expect(r.code).toBe(1);
    expect(r.out.map((z) => JSON.parse(z) as unknown)).toEqual([{ erreichbar: false, grund: "Langfuse antwortet mit HTTP 500" }]);
    expect(r.err).toEqual([]);
  });
  test("--json zusammen mit --sessionstart ist ein Aufruf-Fehler (Exit 2, nichts auf stdout)", async () => {
    const r = await lauf(["--json", "--sessionstart"], antwort(200));
    expect(r.code).toBe(2);
    expect(r.out).toEqual([]);
    expect(r.err.join("\n")).toContain("--json");
  });
});

describe("MCP-Verbindung der Session (factory#323 L1/L7/L18)", () => {
  const JETZT = Date.parse("2026-11-11T10:00:00.000Z");
  const SID = "sess-1";
  const z = (debug: string, zeit: string, sessionId = SID) => JSON.stringify({ debug, timestamp: zeit, sessionId, cwd: "/x" });
  const START = (zeit: string, sid = SID) => z("Starting connection with timeout of 30000ms", zeit, sid);
  const ERFOLG = (zeit: string, sid = SID) => z("Successfully connected (transport: http) in 46ms", zeit, sid);
  const REFUSED = (zeit: string, sid = SID) => z("HTTP Connection failed after 19ms: ECONNREFUSED: Unable to connect (code: ECONNREFUSED, errno: none)", zeit, sid);
  const INIT = (url: string) => z(`Initializing HTTP transport to ${url}`, "2026-11-11T09:00:00.000Z");
  const CC = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: SID };
  const GETRENNT = [INIT("http://localhost:3000/api/public/mcp"), START("2026-11-11T09:00:00.001Z"), REFUSED("2026-11-11T09:00:00.020Z")];
  const VERBUNDEN = [START("2026-11-11T09:00:00.000Z"), ERFOLG("2026-11-11T09:00:00.050Z")];

  const lauf = async (argv: string[], env: Record<string, string | undefined>, mcpZeilen: (() => string[] | string[][] | null) | undefined, fetchImpl: Fetch = antwort(200)) => {
    const out: string[] = [];
    const err: string[] = [];
    let gelesen = 0;
    const lesen = mcpZeilen && (() => ((gelesen += 1), mcpZeilen()));
    const code = await v.main(argv, env, (s) => out.push(s), (s) => err.push(s), { fetchImpl, fristMs: 20, home: "/h", lies: keineDatei, mcpZeilen: lesen, jetzt: JETZT });
    return { code, out, err, gelesen: () => gelesen };
  };

  test("verbunden: Exit 0, stderr leer", async () => {
    const r = await lauf([], CC, () => VERBUNDEN);
    expect(r.code).toBe(0);
    expect(r.err).toEqual([]);
  });
  test("getrennt: Exit 1 mit Hinweis (Code, Zeit, /mcp, neu starten), stderr nennt „MCP-Verbindung der Session“", async () => {
    const r = await lauf([], CC, () => GETRENNT);
    expect(r.code).toBe(1);
    const t = r.err.join("\n");
    expect(t).toContain("Langfuse-MCP-Verbindung dieser Session fehlt (ECONNREFUSED, 2026-11-11T09:00:00.020Z)");
    expect(t).toContain("`/mcp` → langfuse neu verbinden oder Session neu starten, erst dann Ticket starten");
    expect(t).not.toContain("Spur");
  });
  test("getrennt mit abweichender Adresse: der Hinweis nennt die Abweichung zusätzlich", async () => {
    const r = await lauf([], { ...CC, LANGFUSE_BASE_URL: "http://127.0.0.1:3000" }, () => GETRENNT);
    expect(r.err.join("\n")).toContain("MCP-URL localhost:3000 weicht von der Langfuse-Basis-URL 127.0.0.1:3000 ab");
    const gleich = await lauf([], { ...CC, LANGFUSE_BASE_URL: "http://localhost:3000" }, () => GETRENNT);
    expect(gleich.err.join("\n")).not.toContain("weicht");
  });
  test("getrennt ohne MCP-URL im Log: Hinweis ohne Abweichung, endet nach „starten.“", async () => {
    const r = await lauf([], { ...CC, LANGFUSE_BASE_URL: "http://127.0.0.1:3000" }, () => GETRENNT.slice(1));
    expect(r.code).toBe(1);
    expect(r.err).toHaveLength(1);
    expect(r.err[0]).toMatch(/erst dann Ticket starten\.$/);
  });
  test("liest die echten Log-Dateien: Hauptcheckout-Ordner, nur Langfuse, Fenster ab jetzt − 24 h; ohne Ordner nicht prüfbar", async () => {
    const basis = mkdtempSync(join(tmpdir(), "vorb-logs-"));
    const wurzel = "/dev/vorb-proj";
    const dir = join(basis, "-dev-vorb-proj", "mcp-logs-langfuse");
    mkdirSync(dir, { recursive: true });
    const vor = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    writeFileSync(join(dir, "a.jsonl"), [START(vor(5)), REFUSED(vor(4))].join("\n"));
    const zwei = new Date(Date.now() - 2 * 3600 * 1000);
    utimesSync(join(dir, "a.jsonl"), zwei, zwei);
    // Ein anderer Server mit jüngerem Erfolg darf das Urteil nicht überstimmen.
    mkdirSync(join(basis, "-dev-vorb-proj", "mcp-logs-anderer"), { recursive: true });
    writeFileSync(join(basis, "-dev-vorb-proj", "mcp-logs-anderer", "b.jsonl"), [START(vor(2)), ERFOLG(vor(1))].join("\n"));
    const env = { ...CC, CLAUDE_PROJECT_DIR: `${wurzel}/.claude/worktrees/wt-1`, FACTORY_MCP_LOG_DIR: basis };
    const lauf2 = async (e: Record<string, string | undefined>) => {
      const err: string[] = [];
      const code = await v.main([], e, () => {}, (s) => err.push(s), { fetchImpl: antwort(200), home: "/h", lies: keineDatei });
      return { code, err: err.join("\n") };
    };
    const r = await lauf2(env);
    expect(r.code).toBe(1);
    expect(r.err).toContain("ECONNREFUSED");
    const leer = await lauf2({ ...env, FACTORY_MCP_LOG_DIR: join(basis, "gibt-es-nicht") });
    expect(leer).toEqual({ code: 0, err: "Langfuse-MCP-Verbindung der Session nicht prüfbar (kein MCP-Log gefunden)." });
  });
  test("liest die echten Log-Dateien je Prozess: neue Session-ID, Prozess-Datei getrennt, fremde Datei verbunden: Exit 1", async () => {
    const basis = mkdtempSync(join(tmpdir(), "vorb-logs2-"));
    const wurzel = "/dev/vorb-proj2";
    const dir = join(basis, "-dev-vorb-proj2", "mcp-logs-langfuse");
    mkdirSync(dir, { recursive: true });
    const vor = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    writeFileSync(join(dir, "prozess.jsonl"), [START(vor(30), "sid-alt"), REFUSED(vor(29), "sid-alt"), z("Tool 'x' completed successfully in 5ms", vor(20), "sid-neu")].join("\n"));
    writeFileSync(join(dir, "fremd.jsonl"), [START(vor(10), "sid-fremd"), ERFOLG(vor(9), "sid-fremd")].join("\n"));
    const env = { CLAUDECODE: "1", CLAUDE_CODE_SESSION_ID: "sid-neu", CLAUDE_PROJECT_DIR: wurzel, FACTORY_MCP_LOG_DIR: basis };
    const err: string[] = [];
    try {
      const code = await v.main([], env, () => {}, (s) => err.push(s), { fetchImpl: antwort(200), home: "/h", lies: keineDatei });
      expect(code).toBe(1);
      expect(err.join("\n")).toContain("ECONNREFUSED");
    } finally {
      rmSync(basis, { recursive: true, force: true });
    }
  });
  test("Rückfall (Session ohne eigenen Start): bewertet den jüngsten Start und sagt es", async () => {
    const r = await lauf([], { ...CC, CLAUDE_CODE_SESSION_ID: "subagent" }, () => GETRENNT);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("keinen eigenen Verbindungsstart");
  });
  test("Session-ID gewechselt (Prozess-Datei getrennt, fremde Datei verbunden): getrennt, Exit 1", async () => {
    const prozess = [...GETRENNT, z("Tool 'x' completed successfully in 5ms", "2026-11-11T09:10:00.000Z", "sid-neu")];
    const fremd = [START("2026-11-11T09:30:00.000Z", "sid-fremd"), ERFOLG("2026-11-11T09:30:00.050Z", "sid-fremd")];
    const r = await lauf([], { ...CC, CLAUDE_CODE_SESSION_ID: "sid-neu" }, () => [prozess, fremd]);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("ECONNREFUSED");
  });
  test("nicht prüfbar (Start ohne Ergebnis): Exit 0 und eine sichtbare Zeile auf stderr", async () => {
    const r = await lauf([], CC, () => [START("2026-11-11T09:00:00.000Z")]);
    expect(r.code).toBe(0);
    expect(r.err).toEqual(["Langfuse-MCP-Verbindung der Session nicht prüfbar (Verbindungsstart ohne Ergebnis)."]);
  });
  test("kein Log-Ordner: nicht prüfbar, Exit 0, sichtbar", async () => {
    const r = await lauf([], CC, () => null);
    expect(r.code).toBe(0);
    expect(r.err.join("\n")).toContain("nicht prüfbar (kein MCP-Log gefunden)");
  });
  test("werfender Leser: nicht prüfbar statt Absturz oder Sperre", async () => {
    const r = await lauf([], CC, () => {
      throw new Error("kaputt");
    });
    expect(r.code).toBe(0);
    expect(r.err.join("\n")).toContain("nicht prüfbar (MCP-Log nicht lesbar)");
  });
  test("ohne CLAUDECODE (Codex, Shell): nicht prüfbar, sichtbar, der Leser läuft nicht", async () => {
    const r = await lauf([], { CLAUDE_CODE_SESSION_ID: SID }, () => GETRENNT);
    expect(r.code).toBe(0);
    expect(r.err).toEqual(["Langfuse-MCP-Verbindung der Session nicht prüfbar (keine Claude-Code-Session)."]);
    expect(r.gelesen()).toBe(0);
  });
  test("Health aus: Exit 1 wie bisher, ohne MCP-Prüfung", async () => {
    const r = await lauf([], CC, () => VERBUNDEN, antwort(500));
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("Langfuse aus, bitte starten");
    expect(r.gelesen()).toBe(0);
  });
  test("--sessionstart prüft die MCP-Verbindung nicht (Race beim Start)", async () => {
    const r = await lauf(["--sessionstart"], CC, () => GETRENNT);
    expect(r.code).toBe(0);
    expect(r.out).toEqual([]);
    expect(r.gelesen()).toBe(0);
  });
  test("--json enthält `mcp` (additiv, `erreichbar` bleibt die Health-Aussage); getrennt ändert den Exit nicht (Cockpit-Vertrag erreichbar === Exit 0)", async () => {
    const r = await lauf(["--json"], CC, () => GETRENNT);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out[0]) as { erreichbar: boolean; grund: null; mcp: { status: string; code: string } };
    expect(j).toMatchObject({ erreichbar: true, grund: null, mcp: { status: "getrennt", code: "ECONNREFUSED" } });
    expect(r.err).toEqual([]);
    const ok = JSON.parse((await lauf(["--json"], CC, () => VERBUNDEN)).out[0]) as { mcp: { status: string } };
    expect(ok.mcp.status).toBe("verbunden");
  });
  test("eigener Fehlstart knapp innerhalb des 24-h-Fensters (23 h) zählt: getrennt, Exit 1", async () => {
    const jung = [START("2026-11-10T11:00:00.000Z"), REFUSED("2026-11-10T11:00:00.020Z")];
    const r = await lauf([], CC, () => jung);
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toContain("fehlt");
  });
  test("eigener Fehlstart älter als das 24-h-Fenster: kein getrennt, Exit 0 (Fenster an der Aufrufstelle verdrahtet)", async () => {
    const alt = [START("2026-11-10T08:00:00.000Z"), REFUSED("2026-11-10T08:00:00.020Z")];
    const r = await lauf([], CC, () => alt);
    expect(r.code).toBe(0);
    expect(r.err.join("\n")).not.toContain("fehlt");
  });
  test("--json bei Health aus: keine MCP-Prüfung, kein Feld `mcp`", async () => {
    const r = await lauf(["--json"], CC, () => GETRENNT, antwort(500));
    expect(Object.keys(JSON.parse(r.out[0]) as object)).toEqual(["erreichbar", "grund"]);
    expect(r.gelesen()).toBe(0);
  });
});

describe("Kopplung", () => {
  test("SessionStart ruft das Skript mit --sessionstart", () => {
    const s = JSON.parse(lies(".claude/settings.json")) as { hooks: { SessionStart: { matcher: string; hooks: { args?: string[] }[] }[] } };
    const gruppe = s.hooks.SessionStart.find((g) => g.matcher === "startup|resume|clear");
    const args = (gruppe?.hooks ?? []).map((h) => h.args ?? []).find((x) => x.some((a) => a.endsWith("scripts/langfuse-vorbedingung.mjs")));
    expect(args).toContain("--sessionstart");
  });
  test("AGENTS.md nennt das Skript bei „Langfuse-Erfassung erhalten“", () => {
    const zeile = lies("AGENTS.md").split("\n").find((z) => z.includes("Langfuse-Erfassung erhalten"));
    expect(zeile).toContain("scripts/langfuse-vorbedingung.mjs");
  });
  test.each([".agents/skills/factory/ablauf.md"])("%s ruft die Vorbedingung vor dem Start", (datei) => {
    // Der Aufruf gehört in Schritt 0 (Liste im Abschnitt „Im Hauptchat“), nicht irgendwohin in die Datei.
    const zeilen = lies(datei).split("\n");
    const start = zeilen.findIndex((z) => z.startsWith("0. "));
    const ende = zeilen.findIndex((z, i) => i > start && /^\d+\. /.test(z));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(zeilen.slice(start, ende < 0 ? undefined : ende).join("\n")).toContain("node scripts/langfuse-vorbedingung.mjs");
  });
  test("der Takt prüft sie nicht", () => {
    expect(lies(".github/workflows/board-takt.yml")).not.toContain("langfuse-vorbedingung");
  });
  test("das Glossar führt „Langfuse-Vorbedingung“", () => {
    expect(lies("docs/harness-glossar.md")).toContain("Langfuse-Vorbedingung");
  });
});
