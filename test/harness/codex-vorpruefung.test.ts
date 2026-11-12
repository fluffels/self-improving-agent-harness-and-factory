/* @harness-waechter: Freigabe nur über die Freigabetabelle mit fünf Belegen, Offline-Belege allein schalten nichts frei. */
import { afterEach, expect, test, vi } from "vitest";
const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async (orig) => ({ ...(await orig<typeof import("node:child_process")>()), spawnSync: spawnMock }));
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-vorpruefung.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as lib0 from "../../scripts/codex-lib.mjs";
type Naht = { fetchImpl?: unknown; fristMs?: number; env?: Record<string, string>; out: (s: string) => void; err: (s: string) => void; lade: () => unknown; root: string; codexVersion?: () => string | null; freigaben?: unknown; werkzeug?: () => unknown[] };
const p = raw as unknown as { main: (a: string[], n: Naht) => Promise<number>; tracingMaengel: (n: Record<string, unknown>) => Promise<string[]>; installierteCodexVersion: (n: { plattform: string; spawn: (...a: unknown[]) => unknown }) => string | null };
const gesund = { fetchImpl: () => Promise.resolve({ status: 200 }), env: { LANGFUSE_BASE_URL: "http://lf.test" } }; // kein Test trifft das echte Netz
const SPERRE = "Nachweise 1, 2, 3, 4, 5";
const config = { repo: "owner/probe", agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g" } };
const temps: string[] = [];
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });
/** Wurzel ohne `.codex/agents` und `.mcp.json`, aber mit der Soll-Hook-Registrierung: die Tests lesen nie den ungetrackten Zustand des Checkouts. */
function leerRoot() { const d = mkdtempSync(join(tmpdir(), "codex-leer-")); temps.push(d); mkdirSync(join(d, ".codex")); writeFileSync(join(d, ".codex", "hooks.json"), lib.hookRegistrierung()); return d; }
function datei(text: string) { const d = mkdtempSync(join(tmpdir(), "codex-vorpruefung-")); temps.push(d); const p = join(d, "belege.json"); writeFileSync(p, text); return p; }
test("ohne und mit selbst attestierten Belegen gesperrt", async () => {
  const out: string[] = [], err: string[] = [];
  const naht = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s), lade: () => config, root: leerRoot(), codexVersion: () => "0.164.0", ...gesund });
  expect(await p.main([], naht())).toBe(1);
  expect(await p.main(["--belege", datei('{"tracing":true}')], naht())).toBe(1);
  expect(out.at(-1)).toContain('"autonom":false'); expect(out.at(-1)).toContain(SPERRE); expect(err).toEqual([]);
});
test("Direktaufruf ohne Naht (wie der CLI-Einstieg) stürzt nicht ab: Aufruf-Fehler endet mit Exit 2", async () => {
  const stumm = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    expect(await (raw as unknown as { main: (a: string[]) => Promise<number> }).main(["--unbekannt"])).toBe(2);
    expect(stumm).toHaveBeenCalled();
  } finally {
    stumm.mockRestore();
  }
});
test("auch vollständige diagnostische Belege erteilen keine autonome Freigabe", async () => {
  const rollen = [...Object.values(config.agenten), "explore", "holdout-szenario", "holdout-abnahme"];
  const row = (id: string, rolle?: string) => ({ id, type: "GENERATION", sessionId: "probe", tags: ["project:probe"], usageDetails: { input: 1, output: 1 }, metadata: { agent_id: id, agent_role: rolle ? "subagent" : "main", parent_thread_id: rolle ? "main" : "", "agent_source.subagent.thread_spawn.agent_role": rolle } });
  const b = { version: "0.164.0", sessionId: "probe", rollen, tools: ["playwright", "langfuse"], observations: [row("main"), ...rollen.map(r => row(r, r)), { ...row("tool"), type: "TOOL" }] };
  const out: string[] = [], err: string[] = [];
  expect(await p.main(["--belege", datei(JSON.stringify(b))], { out: s => out.push(s), err: s => err.push(s), lade: () => config, root: leerRoot(), codexVersion: () => "0.164.0", ...gesund })).toBe(1);
  const result = JSON.parse(out[0]) as { autonom: boolean; maengel: string[] };
  expect(result.autonom).toBe(false); expect(result.maengel).toHaveLength(1); expect(result.maengel[0]).toContain(SPERRE); expect(err).toEqual([]);
});
const mcp = { mcpServers: { playwright: { command: "npx", args: ["x"] } } };
const lib = lib0 as unknown as { hookRegistrierung: () => string; lokaleHookMaengel: (r: string) => string[]; lokaleRollenMaengel: (r: string, c: unknown, m: unknown) => string[]; setupDateien: (m: unknown, c: unknown, e: string) => Record<string, string>; pruefeAusgabe: (r: string) => string; quellDatei: (r: string, p: string) => string };
function projekt(rollen: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "codex-rollen-")); temps.push(d);
  mkdirSync(join(d, ".codex", "agents"), { recursive: true }); writeFileSync(join(d, ".mcp.json"), JSON.stringify(mcp));
  for (const [n, t] of Object.entries(rollen)) writeFileSync(join(d, ".codex", "agents", n), t);
  return d;
}
test("lokale Rollen: aktuell, veraltet, verwaist und fehlender Ordner", async () => {
  const soll = Object.entries(lib.setupDateien(mcp, config, "http://localhost/")).filter(([k]) => k.startsWith(".codex/agents/")).map(([k, t]) => [k.split("/").pop() as string, t] as const);
  const [name, text] = soll[0];
  expect(lib.lokaleRollenMaengel(projekt(Object.fromEntries(soll)), config, mcp)).toEqual([]);
  const veraltet = lib.lokaleRollenMaengel(projekt({ ...Object.fromEntries(soll), [name]: `${text}# alt\n` }), config, mcp);
  expect(veraltet).toHaveLength(1); expect(veraltet[0]).toContain("veraltet"); expect(veraltet[0]).toContain(name);
  const verwaist = lib.lokaleRollenMaengel(projekt({ ...Object.fromEntries(soll), "weg.toml": "x" }), config, mcp);
  expect(verwaist).toHaveLength(1); expect(verwaist[0]).toContain("verwaist"); expect(verwaist[0]).toContain("weg.toml");
  const leer = mkdtempSync(join(tmpdir(), "codex-rollen-")); temps.push(leer);
  expect(lib.lokaleRollenMaengel(leer, config, mcp)).toEqual([]);
});
test("lokale Hook-Registrierung (factory#364): fehlt, weicht ab, ist Symlink oder steht inline in config.toml, je ein Mangel; Soll meldet nichts", async () => {
  const d = leerRoot();
  expect(lib.lokaleHookMaengel(d)).toEqual([]);
  const fehlt = mkdtempSync(join(tmpdir(), "codex-hook-leer-")); temps.push(fehlt);
  expect(lib.lokaleHookMaengel(fehlt)).toHaveLength(1); expect(lib.lokaleHookMaengel(fehlt)[0]).toContain("fehlt");
  writeFileSync(join(d, ".codex", "hooks.json"), lib.hookRegistrierung().replace("30", "600"));
  expect(lib.lokaleHookMaengel(d)[0]).toContain("weicht vom Soll ab");
  writeFileSync(join(d, ".codex", "hooks.json"), lib.hookRegistrierung());
  writeFileSync(join(d, ".codex", "config.toml"), "[agents]\nenabled = true\n");
  expect(lib.lokaleHookMaengel(d)).toEqual([]);
  writeFileSync(join(d, ".codex", "config.toml"), "[[hooks.PreToolUse]]\nmatcher = \"x\"\n");
  expect(lib.lokaleHookMaengel(d)[0]).toContain("inline");
  const l = mkdtempSync(join(tmpdir(), "codex-hook-link-")); temps.push(l);
  mkdirSync(join(l, ".codex")); symlinkSync(join(d, ".codex", "hooks.json"), join(l, ".codex", "hooks.json"));
  expect(() => lib.lokaleHookMaengel(l)).toThrow("Symlink");
});
test("lokale Hook-Registrierung: inline [hooks] in jeder Schreibweise und an beliebiger Stelle, Ordner statt Datei und config.toml als Symlink", async () => {
  const d = leerRoot();
  const toml = (text: string) => { writeFileSync(join(d, ".codex", "config.toml"), text); return lib.lokaleHookMaengel(d); };
  for (const text of ["# Kopf\n[agents]\nenabled = true\n\n[hooks]\n", "[agents]\n  [hooks]\n", "[agents]\n[ hooks.PreToolUse ]\n", "[agents]\n[[hooks.PreToolUse]]\n"]) expect(toml(text), text).toHaveLength(1);
  for (const text of ["[agents]\n[hooksx]\n", "# [hooks]\n[agents]\n", "[agents]\nname = \"[hooks]\"\n"]) expect(toml(text), text).toEqual([]);
  rmSync(join(d, ".codex", "hooks.json")); mkdirSync(join(d, ".codex", "hooks.json"));
  expect(lib.lokaleHookMaengel(d).join()).toContain("weicht vom Soll ab");
  const l = leerRoot(); rmSync(join(l, ".codex", "config.toml"), { force: true });
  const ziel = join(l, "echt.toml"); writeFileSync(ziel, "x"); symlinkSync(ziel, join(l, ".codex", "config.toml"));
  expect(() => lib.lokaleHookMaengel(l)).toThrow("Symlink");
});
test("Vorprüfung: mit .codex/agents wird der Hook-Mangel zusätzlich zu den Rollen-Mängeln gemeldet", async () => {
  const soll = Object.fromEntries(Object.entries(lib.setupDateien(mcp, config, "http://localhost/")).filter(([k]) => k.startsWith(".codex/agents/")).map(([k, t]) => [k.split("/").pop() as string, t]));
  const d = projekt({ ...soll, "weg.toml": "x" });
  const r = await lauf([], { root: d, codexVersion: () => null });
  expect(r.maengel?.some((m) => m.includes("Codex-Rolle verwaist"))).toBe(true);
  expect(r.maengel?.some((m) => m.includes("Codex-Hook-Registrierung fehlt"))).toBe(true);
});
test("Vorprüfung: fehlende Hook-Registrierung ist ein Mangel auch ohne .codex/agents", async () => {
  const fehlt = mkdtempSync(join(tmpdir(), "codex-hook-leer-")); temps.push(fehlt);
  const r = await lauf([], { root: fehlt, codexVersion: () => null });
  expect(r).toMatchObject({ code: 1, autonom: false }); expect(r.maengel?.join()).toContain(".codex/hooks.json");
});
test("lokale Rollen: ein Ordner an der Stelle einer Rollen-Datei ist veraltet, kein Absturz", async () => {
  const soll = Object.keys(lib.setupDateien(mcp, config, "http://localhost/")).filter(k => k.startsWith(".codex/agents/")).map(k => k.split("/").pop() as string);
  const d = projekt({}); mkdirSync(join(d, ".codex", "agents", soll[0]));
  const m = lib.lokaleRollenMaengel(d, config, mcp);
  expect(m).toHaveLength(1); expect(m[0]).toContain("veraltet"); expect(m[0]).toContain(soll[0]);
});
/** Verlinkter Vorfahre oberhalb der Wurzel (macOS: /var -> /private/var), plattformneutral nachgebaut. */
function unterVerlinktemVorfahren() {
  const d = mkdtempSync(join(tmpdir(), "codex-link-")); temps.push(d);
  const real = join(d, "real"); mkdirSync(join(real, "repo", ".codex", "agents"), { recursive: true });
  writeFileSync(join(real, "repo", ".mcp.json"), JSON.stringify(mcp));
  symlinkSync(real, join(d, "link"), "junction");
  return { d, root: join(d, "link", "repo") };
}
test("Wurzel unter verlinktem Vorfahren ist erlaubt (Guard prüft nur unterhalb der Wurzel)", async () => {
  const { root } = unterVerlinktemVorfahren();
  expect(lib.lokaleRollenMaengel(root, config, mcp)).toEqual([]);
  expect(lib.pruefeAusgabe(root)).toBe(root);
  expect(lib.quellDatei(root, ".mcp.json")).toBe(join(root, ".mcp.json"));
});
test("Symlink innerhalb der Wurzel bleibt ein Fehler", async () => {
  const { d, root } = unterVerlinktemVorfahren();
  const ziel = join(d, "anderswo"); mkdirSync(ziel);
  rmSync(join(root, ".codex", "agents"), { recursive: true }); symlinkSync(ziel, join(root, ".codex", "agents"), "junction");
  expect(() => lib.lokaleRollenMaengel(root, config, mcp)).toThrow(/Symlink/);
  const quelle = join(d, "q.json"); writeFileSync(quelle, "{}"); rmSync(join(root, ".mcp.json")); symlinkSync(quelle, join(root, ".mcp.json"));
  expect(() => lib.quellDatei(root, ".mcp.json")).toThrow(/Symlink/);
  expect(() => lib.pruefeAusgabe(join(d, "link-direkt"))).not.toThrow();
  symlinkSync(ziel, join(d, "link-direkt"), "junction");
  expect(() => lib.pruefeAusgabe(join(d, "link-direkt"))).toThrow(/Symlink/);
});
test("Vorprüfung meldet verwaiste Rolle in root", async () => {
  const d = projekt({ "alt.toml": "x" }); const out: string[] = [];
  expect(await p.main([], { out: s => out.push(s), err: () => undefined, lade: () => config, root: d, codexVersion: () => "0.164.0", ...gesund })).toBe(1);
  expect((JSON.parse(out[0]) as { maengel: string[] }).maengel.join("\n")).toContain("verwaist");
});
test("Aufruf-, Lese-, JSON- und Configfehler sind geschlossen", async () => {
  const out: string[] = [], err: string[] = [];
  const naht = (lade: () => unknown = () => config) => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s), lade, root: leerRoot(), codexVersion: () => "0.164.0", ...gesund });
  expect(await p.main(["--issue", "79"], naht())).toBe(2);
  expect(await p.main(["--belege", `${datei("{}")}fehlt`], naht())).toBe(1);
  expect(await p.main(["--belege", datei("{")], naht())).toBe(1);
  expect(await p.main([], naht(() => { throw new Error("Config unlesbar"); }))).toBe(1);
  expect(out).toEqual([]); expect(err).toHaveLength(4);
});

const URL_OK = "https://api.github.com/repositories/1/pulls/1";
const beleg = { beleg: URL_OK };
const tabelle = (nachweise: Record<string, unknown> = { 1: beleg, 2: beleg, 3: beleg, 4: beleg, 5: beleg }) => ({ "9.9.9": { diagnose: URL_OK, nachweise } });
function belegeFuer(version: string) {
  const rollen = [...Object.values(config.agenten), "explore", "holdout-szenario", "holdout-abnahme"];
  const row = (id: string, rolle?: string) => ({ id, type: "GENERATION", sessionId: "probe", tags: ["project:probe"], usageDetails: { input: 1, output: 1 }, metadata: { agent_id: id, agent_role: rolle ? "subagent" : "main", parent_thread_id: rolle ? "main" : "", "agent_source.subagent.thread_spawn.agent_role": rolle } });
  return datei(JSON.stringify({ version, sessionId: "probe", rollen, tools: ["playwright", "langfuse"], observations: [row("main"), ...rollen.map(r => row(r, r)), { ...row("tool"), type: "TOOL" }] }));
}
async function lauf(belege: string[], n: Partial<Naht>) {
  const out: string[] = [];
  const code = await p.main(belege, { out: s => out.push(s), err: () => undefined, lade: () => config, root: leerRoot(), werkzeug: () => [], ...gesund, ...n });
  return { code, ...(JSON.parse(out[0] ?? "{}") as { autonom?: boolean; maengel?: string[] }) };
}
test("Freigabe: alle fünf Belege, passende Version und kein anderer Mangel ergeben Exit 0", async () => {
  const ok = await lauf(["--belege", belegeFuer("9.9.9")], { codexVersion: () => "9.9.9", freigaben: tabelle() });
  expect(ok).toMatchObject({ code: 0, autonom: true, maengel: [] });
  const werkzeug = await lauf(["--belege", belegeFuer("9.9.9")], { codexVersion: () => "9.9.9", freigaben: tabelle(), werkzeug: () => [{ text: "T", fix: "F" }] });
  expect(werkzeug).toMatchObject({ code: 1, autonom: false });
});
test("Freigabe: ein offener oder leerer Nachweis sperrt und nennt genau seine Nummer", async () => {
  const b = ["--belege", belegeFuer("9.9.9")];
  const offen = await lauf(b, { codexVersion: () => "9.9.9", freigaben: tabelle({ 1: beleg, 2: beleg, 3: "offen", 4: beleg, 5: beleg }) });
  expect(offen.code).toBe(1); expect(offen.autonom).toBe(false);
  expect(offen.maengel?.join()).toContain("Nachweise 3 "); expect(offen.maengel?.join()).not.toMatch(/Nachweise [^3]/);
  const leer = await lauf(b, { codexVersion: () => "9.9.9", freigaben: tabelle({ 1: beleg, 2: { beleg: "" }, 3: beleg, 4: beleg, 5: beleg }) });
  expect(leer.code).toBe(1); expect(leer.maengel).toHaveLength(2);
  expect(leer.maengel?.join("\n")).toContain("Nachweis 2"); expect(leer.maengel?.join("\n")).toContain("Nachweise 2 ");
  const ohneBelege = await lauf([], { codexVersion: () => "9.9.9", freigaben: tabelle() });
  expect(ohneBelege.code).toBe(1); expect(ohneBelege.autonom).toBe(false);
});
test("Freigabe: Version fehlt in der Tabelle, weicht ab oder ist nicht ermittelbar, je ein eigener Mangel", async () => {
  const nichtDrin = await lauf(["--belege", belegeFuer("9.9.8")], { codexVersion: () => "9.9.8", freigaben: tabelle() });
  expect(nichtDrin.code).toBe(1); expect(nichtDrin.maengel).toEqual([expect.stringContaining("nicht in der Freigabetabelle")]);
  const weicht = await lauf(["--belege", belegeFuer("9.9.8")], { codexVersion: () => "9.9.9", freigaben: tabelle() });
  expect(weicht.code).toBe(1); expect(weicht.maengel).toEqual([expect.stringContaining("weicht von der belegten Version 9.9.8 ab")]);
  const keine = await lauf(["--belege", belegeFuer("9.9.9")], { codexVersion: () => null, freigaben: tabelle() });
  expect(keine.code).toBe(1); expect(keine.maengel).toEqual([expect.stringMatching(/nicht ermittelbar.*PATH/)]);
});
test("installierteCodexVersion: Aufruf je Plattform und Ausgabe-Auswertung", async () => {
  const stub = (r: unknown) => { const calls: unknown[][] = []; return { calls, spawn: (...a: unknown[]) => { calls.push(a); return r; } }; };
  const win = stub({ status: 0, stdout: "codex-cli 0.164.0\n" });
  expect(p.installierteCodexVersion({ plattform: "win32", spawn: win.spawn })).toBe("0.164.0");
  expect(win.calls[0][0]).toBe("codex.cmd"); expect(win.calls[0][1]).toEqual(["--version"]); expect(win.calls[0][2]).toMatchObject({ shell: true, timeout: 10000 });
  const lin = stub({ status: 0, stdout: "codex-cli 1.2.3" });
  expect(p.installierteCodexVersion({ plattform: "linux", spawn: lin.spawn })).toBe("1.2.3");
  expect(lin.calls[0][0]).toBe("codex"); expect(lin.calls[0][2]).toMatchObject({ shell: false });
  expect(p.installierteCodexVersion({ plattform: "linux", spawn: stub({ error: { code: "ENOENT" }, status: null }).spawn })).toBeNull();
  expect(p.installierteCodexVersion({ plattform: "linux", spawn: stub({ status: 1, stdout: "codex-cli 1.2.3" }).spawn })).toBeNull();
  expect(p.installierteCodexVersion({ plattform: "linux", spawn: stub({ status: 0, stdout: "kaputt" }).spawn })).toBeNull();
  expect(p.installierteCodexVersion({ plattform: "linux", spawn: stub({ status: 0 }).spawn })).toBeNull();
  expect(p.installierteCodexVersion({ plattform: "linux", spawn: stub({ status: 0, stdout: "codex-cli 1.2.3", error: { code: "ETIMEDOUT" } }).spawn })).toBeNull();
  for (const [roh, soll] of [["codex-cli 10.2.3", "10.2.3"], ["codex-cli 0.164.10", "0.164.10"], ["codex-cli 1.20.30", "1.20.30"]]) expect(p.installierteCodexVersion({ plattform: "linux", spawn: stub({ status: 0, stdout: roh }).spawn }), roh).toBe(soll);
  for (const roh of ["codex-cli 1.2.3.4", "codex-cli x1.2.3", "codex-cli 1.2.3x", "codex-cli 1x2x3", "codex-cli 1x2.3", "codex-cli 1.2x3"]) expect(p.installierteCodexVersion({ plattform: "linux", spawn: stub({ status: 0, stdout: roh }).spawn }), roh).toBeNull();
});
test("Belege-Datei mit null: kein Absturz, Mangel statt Fehlerpfad", async () => {
  const r = await lauf(["--belege", datei("null")], { codexVersion: () => "9.9.9", freigaben: tabelle() });
  expect(r.code).toBe(1); expect(r.maengel?.join("\n")).toContain("belegten Version keine");
});
test("Standard-Verdrahtung: ohne Naht fragt main die echte Versionsabfrage (codex --version) ab", async () => {
  spawnMock.mockReturnValue({ status: 0, stdout: "codex-cli 9.9.9\n" });
  const ok = await lauf(["--belege", belegeFuer("9.9.9")], { freigaben: tabelle() });
  expect(ok).toMatchObject({ code: 0, autonom: true });
  const win = process.platform === "win32";
  expect(spawnMock).toHaveBeenCalledWith(win ? "codex.cmd" : "codex", ["--version"], expect.objectContaining({ shell: win }));
  spawnMock.mockReturnValue({ status: null, error: { code: "ENOENT" } });
  const weg = await lauf(["--belege", belegeFuer("9.9.9")], { freigaben: tabelle() });
  expect(weg.code).toBe(1); expect(weg.maengel).toEqual([expect.stringContaining("nicht ermittelbar")]);
});

const ausfall = (stub: unknown, extra: Record<string, unknown> = {}) => ({ fetchImpl: stub, env: { LANGFUSE_BASE_URL: "http://lf.test" }, fristMs: 20, ...extra });
const ausfaelle: [string, unknown][] = [
  ["Verbindung verweigert", () => Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))],
  ["Frist überschritten", (_u: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("abort"))))],
  ["HTTP 503", () => Promise.resolve({ status: 503 })],
  ["ungültige Antwort ohne Status", () => Promise.resolve({})],
];
for (const [name, stub] of ausfaelle) {
  test(`Tracing-Ausfall (${name}): Mangel \"Tracing-Ausfall\" und Exit 1, auch bei sonst vollständiger Freigabe`, async () => {
    const r = await lauf(["--belege", belegeFuer("9.9.9")], { codexVersion: () => "9.9.9", freigaben: tabelle(), ...ausfall(stub) });
    expect(r.code).toBe(1); expect(r.autonom).toBe(false);
    expect(r.maengel).toHaveLength(1); expect(r.maengel?.[0]).toMatch(/^Tracing-Ausfall: /);
  });
}
test("Tracing: erreichbar (HTTP 200) ergibt keinen Mangel, die Abfrage geht an <LANGFUSE_BASE_URL>/api/public/health", async () => {
  const urls: string[] = [];
  const fetchImpl = (u: string) => { urls.push(u); return Promise.resolve({ status: 200 }); };
  expect(await p.tracingMaengel(ausfall(fetchImpl))).toEqual([]);
  expect(urls).toEqual(["http://lf.test/api/public/health"]);
  const ok = await lauf(["--belege", belegeFuer("9.9.9")], { codexVersion: () => "9.9.9", freigaben: tabelle(), ...ausfall(fetchImpl) });
  expect(ok).toMatchObject({ code: 0, autonom: true });
});
test("Tracing: werfende Prüfung ergibt einen Mangel, kein Absturz; Standardfrist ist FRIST_MS", async () => {
  const werfend = await p.tracingMaengel({ ...ausfall(() => Promise.resolve({})), lies: () => "{}", home: "/x", env: null });
  expect(werfend).toHaveLength(1); expect(werfend[0]).toContain("Health-Prüfung gescheitert");
  vi.useFakeTimers();
  try {
    const hang = p.tracingMaengel({ fetchImpl: (_u: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("abort")))), env: { LANGFUSE_BASE_URL: "http://lf.test" } });
    await vi.advanceTimersByTimeAsync(2999);
    let fertig = false; void hang.then(() => { fertig = true; });
    await vi.advanceTimersByTimeAsync(0); expect(fertig).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await hang)[0]).toContain("Timeout nach 3000 ms");
  } finally {
    vi.useRealTimers();
  }
});
