/* @harness-waechter: Codex-Probe-Lebenslauf (factory#366): vorbereiten, aufraeumen, Fixture-Hooks, Negativproben (Claude-Dispatcher und Codex-Adapter verweigern jede). Echtes Git in Temp-Ordnern, Codex wird nie gestartet. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as cliRaw from "../../scripts/codex-probe.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as libRaw from "../../scripts/codex-probe-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as codexLibRaw from "../../scripts/codex-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as adapterRaw from "../../scripts/codex-hook-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as dispatcherRaw from "../../scripts/pretooluse-dispatch.mjs";
import config from "../fixtures/projekt-probe.json";

type Res = { status: number; stdout: string; stderr: string };
type Deps = { git?: (a: string[], cwd: string) => Res; setup?: (p: string, a: string[]) => { status: number; stderr: string }; lade?: () => unknown };
type Probe = { art: string; grund: string; codex: { tool_name: string; tool_input: Record<string, string> }; claude: { tool_name: string; tool_input: Record<string, string> } };
const cli = cliRaw as unknown as { main: (a: string[], r: string, o: (s: string) => void, e: (s: string) => void, d?: Deps) => number };
const hookRegistrierung = (codexLibRaw as unknown as { hookRegistrierung: () => string }).hookRegistrierung;
const lib = libRaw as unknown as { PROBE_TICKET_NR: number; PROBE_HOOK_TIMEOUT_S: number; MARKER_FEHLER: string; MARKER_TIMEOUT: string; MARKER_SUBAGENT_STOPP: string; MARKER_HOOK_FORMAT: string; MARKER_TRACING: string; checklisteText: (a: { haupt: string; probe: string; config: unknown }) => string; checklistenPunkte: (c: unknown) => { id: string; nachweis: number; ohneExport: boolean; text: (k: { haupt: string; probe: string }) => string }[]; fixtureHooks: () => Record<string, string>; negativproben: (a: { haupt: string; probe: string; config: unknown }) => Probe[] };
const adapter = adapterRaw as unknown as { entscheide: (t: string, root: string, d?: Record<string, unknown>) => Promise<{ hookSpecificOutput: { permissionDecision: string } } | null>; CODEX_HOOK_WERKZEUGE: Record<string, string>; CODEX_HOOK_TIMEOUT_S: number };
const dispatcher = dispatcherRaw as unknown as { dispatch: (t: string, root: string) => { hookSpecificOutput: { permissionDecision: string } } | null };

const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...a], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const echtGit = (a: string[], cwd: string): Res => { const r = spawnSync("git", a, { cwd, encoding: "utf8" }); return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }; };
let [tmp, haupt, probe] = ["", "", ""];
let calls: string[][] = [];

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "cpx-")));
  const origin = join(tmp, "origin.git");
  haupt = join(tmp, "haupt");
  git(tmp, "init", "-q", "--bare", "-b", "main", origin);
  git(tmp, "init", "-q", "-b", "main", haupt);
  writeFileSync(join(haupt, ".gitignore"), "/.claude/worktrees/\n");
  git(haupt, "add", "-A");
  git(haupt, "commit", "-q", "-m", "init");
  git(haupt, "remote", "add", "origin", origin);
  git(haupt, "push", "-q", "origin", "main");
  probe = `${haupt}/.claude/worktrees/codex-probe`;
  calls = [];
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(tmp, { recursive: true, force: true }); });

const protokoll = (a: string[], cwd: string) => { calls.push(a); return echtGit(a, cwd); };
const setupStub = (p: string) => { mkdirSync(join(p, ".codex"), { recursive: true }); writeFileSync(join(p, ".codex", "hooks.json"), hookRegistrierung()); return { status: 0, stderr: "" }; };
function lauf(args: string[], d: Deps = {}) {
  const out: string[] = [], err: string[] = [];
  const code = cli.main(args, haupt, (x) => out.push(x), (x) => err.push(x), { git: protokoll, setup: (p, a) => { calls.push(["setup", p, ...a]); return setupStub(p); }, lade: () => config, ...d });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const worktreeListe = () => git(haupt, "worktree", "list", "--porcelain");
const branchListe = () => git(haupt, "branch", "--list", "--format=%(refname:short)");
const unveraendert = () => { expect(worktreeListe()).not.toContain("codex-probe"); expect(branchListe()).not.toContain("codex-probe"); expect(calls.some((c) => c[0] === "fetch" || (c[0] === "worktree" && c[1] === "add"))).toBe(false); };

describe("vorbereiten und aufraeumen", () => {
  test("legt Worktree, Branch von origin/main, Probe-Dateien und Hook-Variante an; aufraeumen entfernt alles und ist wiederholbar", () => {
    const r = lauf(["vorbereiten"]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(worktreeListe()).toContain(`worktree ${probe}`);
    expect(git(haupt, "rev-parse", "codex-probe").trim()).toBe(git(haupt, "rev-parse", "origin/main").trim());
    expect(spawnSync("git", ["config", "branch.codex-probe.remote"], { cwd: haupt, encoding: "utf8" }).stdout).toBe("");
    const vorlage = (JSON.parse(readFileSync(join(probe, ".codex", "probe", "bericht-vorlage.json"), "utf8")) as { punkte: Record<string, object> }).punkte;
    expect(Object.keys(vorlage).filter((k) => "ausgabe" in vorlage[k]).sort()).toEqual(["dateiwerkzeug", "defekter-mcp", "hook-format:agent", "hooks-geladen", "subagent-start", "tracing-ausfall"]);
    expect(readdirSync(join(probe, ".codex", "probe")).sort()).toEqual([".gitignore", "bericht-vorlage.json", "checkliste.md", "hook-fehler.mjs", "hook-protokoll.mjs", "hook-timeout.mjs", "hooks-soll.json", "hooks-variante.json", "ticket.md"]);
    type Hooks = { hooks: { PreToolUse: { matcher?: string; hooks: { timeout: number; command: string }[] }[]; SubagentStart?: { matcher?: string; hooks: { timeout: number; command: string }[] }[]; SessionStart?: { matcher?: string; hooks: { timeout: number; command: string }[] }[] } };
    const alle = JSON.parse(readFileSync(join(probe, ".codex", "hooks.json"), "utf8")) as Hooks;
    const hooks = alle.hooks.PreToolUse;
    const soll = (JSON.parse(hookRegistrierung()) as Hooks).hooks.PreToolUse;
    expect(readFileSync(join(probe, ".codex", "probe", "hooks-soll.json"), "utf8")).toBe(hookRegistrierung());
    expect(readFileSync(join(probe, ".codex", "probe", "hooks-variante.json"), "utf8")).toBe(readFileSync(join(probe, ".codex", "hooks.json"), "utf8"));
    const protokollEintrag = { hooks: [{ type: "command", command: "node .codex/probe/hook-protokoll.mjs", timeout: adapter.CODEX_HOOK_TIMEOUT_S }] };
    expect(hooks[0]).toEqual(protokollEintrag); // ohne matcher, zuerst
    expect(alle.hooks.SubagentStart).toEqual([protokollEintrag]);
    expect(alle.hooks.SessionStart).toEqual([protokollEintrag]);
    expect(hooks.slice(1, 1 + soll.length)).toEqual(soll);
    expect(hooks.slice(1 + soll.length).map((h) => [h.matcher, h.hooks[0].command, h.hooks[0].timeout])).toEqual([["^(Bash|exec_command)$", "node .codex/probe/hook-fehler.mjs", adapter.CODEX_HOOK_TIMEOUT_S], ["^(Bash|exec_command)$", "node .codex/probe/hook-timeout.mjs", lib.PROBE_HOOK_TIMEOUT_S]]);
    expect(calls.find((c) => c[0] === "setup")?.slice(2)).toEqual(["--langfuse-url", "http://localhost:3000/api/public/mcp", "--write"]);
    for (const p of lib.checklistenPunkte(config)) expect(r.out).toContain(`\`${p.id}\``);
    expect(r.out).not.toMatch(/npm run/);
    expect(git(haupt, "status", "--porcelain")).toBe("");
    expect(lauf(["aufraeumen"]).code).toBe(0);
    expect(worktreeListe()).not.toContain("codex-probe");
    expect(existsSync(probe)).toBe(false);
    expect(branchListe()).not.toContain("codex-probe");
    expect(lauf(["aufraeumen"]).code).toBe(0);
  });
  test("Probe-Ticket ist eine lokale Datei; nur git und codex-setup im Probe-Worktree laufen", () => {
    lauf(["vorbereiten"]);
    const ticket = readFileSync(join(probe, ".codex", "probe", "ticket.md"), "utf8");
    expect(ticket).toContain(String(lib.PROBE_TICKET_NR));
    expect(ticket).toContain("fremdtext:start");
    expect(calls.map((c) => c[0]).filter((n) => !["rev-parse", "status", "worktree", "branch", "fetch", "setup", "prune"].includes(n))).toEqual([]);
    expect(calls.find((c) => c[0] === "setup")?.[1]).toBe(probe);
  });
  test("Aufruffehler (unbekannter Befehl oder Flag, ungültiges --langfuse-auth): Exit 2 ohne Änderung", () => {
    for (const a of [[], ["unbekannt"], ["vorbereiten", "--gibts-nicht"], ["vorbereiten", "--langfuse-auth", "x"]]) expect(lauf(a).code, a.join(" ")).toBe(2);
    unveraendert();
  });
  test("unsauberer Hauptcheckout: Exit 1 ohne fetch und worktree add", () => {
    writeFileSync(join(haupt, "lose.txt"), "x");
    const r = lauf(["vorbereiten"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("nicht sauber");
    unveraendert();
  });
  test("globale Codex-Konfiguration als Ziel: Exit 1 ohne Änderung", () => {
    vi.stubEnv("CODEX_HOME", `${haupt}/.claude/worktrees`);
    const r = lauf(["vorbereiten"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Globale Codex-Konfiguration");
    unveraendert();
  });
  test("vorhandener Probe-Ordner: Exit 1 ohne Änderung, aufraeumen meldet den Ordner als Rest mit Exit 1", () => {
    mkdirSync(probe, { recursive: true });
    const r = lauf(["vorbereiten"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(probe);
    unveraendert();
    const a = lauf(["aufraeumen"]);
    expect(a.code).toBe(1);
    expect(a.err).toContain(probe);
    expect(existsSync(probe)).toBe(true);
  });
  test("Setup-Argumente: abweichende URL und --langfuse-auth werden durchgereicht", () => {
    expect(lauf(["vorbereiten", "--langfuse-url", "https://x.example/mcp", "--langfuse-auth", "host"]).code).toBe(0);
    expect(calls.find((c) => c[0] === "setup")?.slice(2)).toEqual(["--langfuse-url", "https://x.example/mcp", "--langfuse-auth", "host", "--write"]);
  });
  test("Standardzweig des Repos (Arbeitsplatz-Config) ist die Basis, ein Repo außerhalb der Config stoppt mit Exit 1", () => {
    git(haupt, "switch", "-q", "-c", "develop"); writeFileSync(join(haupt, "d.txt"), "d"); git(haupt, "add", "-A"); git(haupt, "commit", "-q", "-m", "develop");
    git(haupt, "push", "-q", "origin", "develop"); git(haupt, "switch", "-q", "main");
    const mitBlock = (name: string) => ({ ...config, arbeitsplatz: { wurzel: tmp, repos: [{ name, pfad: "haupt", standardzweig: "develop" }] } });
    expect(lauf(["vorbereiten"], { lade: () => mitBlock("haupt") }).code).toBe(0);
    expect(git(haupt, "rev-parse", "codex-probe").trim()).toBe(git(haupt, "rev-parse", "origin/develop").trim());
    expect(lauf(["aufraeumen"], { lade: () => mitBlock("haupt") }).code).toBe(0);
    expect(lauf(["vorbereiten"], { lade: () => ({ ...config, arbeitsplatz: { wurzel: tmp, repos: [{ name: "x", pfad: "anderes" }] } }) }).code).toBe(1);
  });
  test("Fehlerzweige: kein Git-Repository und nicht ladbare Config ergeben Exit 1", () => {
    mkdirSync(join(tmp, "leer"));
    expect(cli.main(["aufraeumen"], join(tmp, "leer"), () => undefined, () => undefined, { git: echtGit, lade: () => config })).toBe(1);
    expect(lauf(["vorbereiten"], { lade: () => { throw new Error("kaputt"); } }).err).toContain("nicht ladbar");
  });
  test("vorhandener Branch codex-probe: Exit 1 ohne Änderung", () => {
    git(haupt, "branch", "codex-probe");
    const r = lauf(["vorbereiten"]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Branch codex-probe");
    expect(calls.some((c) => c[0] === "fetch" || (c[0] === "worktree" && c[1] === "add"))).toBe(false);
  });
  test("git fetch scheitert: Exit 1 und kein Worktree, kein Branch", () => {
    const r = lauf(["vorbereiten"], { git: (a, cwd) => (a[0] === "fetch" ? { status: 1, stdout: "", stderr: "offline" } : echtGit(a, cwd)) });
    expect([r.code, r.err.includes("offline"), worktreeListe().includes("codex-probe"), branchListe().includes("codex-probe")]).toEqual([1, true, false, false]);
  });
  test("Setup scheitert: Rückbau, Exit 1 mit Ursache, nichts bleibt", () => {
    const r = lauf(["vorbereiten"], { setup: () => ({ status: 1, stderr: "kaputt" }) });
    expect(r.code).toBe(1);
    expect(r.err).toContain("kaputt");
    expect(worktreeListe()).not.toContain("codex-probe");
    expect(branchListe()).not.toContain("codex-probe");
    expect(existsSync(probe)).toBe(false);
  });
  test("Rest nach aufraeumen: ein vorgetäuschtes worktree remove ergibt Exit 1 mit Pfad", () => {
    lauf(["vorbereiten"]);
    const r = lauf(["aufraeumen"], { git: (a, cwd) => (a[0] === "worktree" && a[1] === "remove" ? { status: 0, stdout: "", stderr: "" } : echtGit(a, cwd)) });
    expect(r.code).toBe(1);
    expect(r.err).toContain(probe);
  });
  test("Worktree mit der Probe-Ticket-Nummer im Namen wird mitgeräumt, fremde Worktrees bleiben", () => {
    lauf(["vorbereiten"]);
    const lens = `${haupt}/.claude/worktrees/x-999999999-lens-r1`;
    const fremd = `${haupt}/.claude/worktrees/x-123`;
    git(haupt, "worktree", "add", "-q", "-b", "feature/x-999999999", lens, "origin/main");
    git(haupt, "worktree", "add", "-q", "-b", "feature/x-123", fremd, "origin/main");
    expect(lauf(["aufraeumen"]).code).toBe(0);
    expect(existsSync(lens)).toBe(false);
    expect(branchListe()).not.toContain("999999999");
    expect(existsSync(fremd)).toBe(true);
  });
  test("Worktree am Probe-Pfad mit fremdem Branch wird nicht gelöscht: Exit 1", () => {
    git(haupt, "worktree", "add", "-q", "-b", "feature/fremd", probe, "origin/main");
    const r = lauf(["aufraeumen"]);
    expect(r.code).toBe(1);
    expect(existsSync(probe)).toBe(true);
  });
  test("Quelltext-Wächter: kein process.env, kein homedir(, kein Prozessstart mit Literal codex (geschlossene Musterliste)", () => {
    for (const d of readdirSync("scripts").filter((n) => /^codex-probe.*\.mjs$/.test(n))) {
      const q = readFileSync(join("scripts", d), "utf8");
      expect(q, d).not.toMatch(/process\.env(?!\.LANGFUSE_BASE_URL\b)|homedir\(|\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*["'`]codex/);
    }
    // die einzige erlaubte Umgebungsvariable: genau einmal, nur im Protokoll-Hook der Lib
    const treffer = (d: string) => readFileSync(join("scripts", d), "utf8").split("process.env.LANGFUSE_BASE_URL").length - 1;
    const probeSkripte = readdirSync("scripts").filter((n) => /^codex-probe.*\.mjs$/.test(n));
    expect(Object.fromEntries(probeSkripte.map((d) => [d, treffer(d)]).filter(([, n]) => Number(n) > 0))).toEqual({ "codex-probe-lib.mjs": 1 });
  });
});

describe("Fixture-Hooks (echter Node-Start)", () => {
  const start = (datei: string, eingabe: string, timeout?: number) => {
    const ordner = join(tmp, "fix");
    mkdirSync(ordner, { recursive: true });
    for (const [n, q] of Object.entries(lib.fixtureHooks())) writeFileSync(join(ordner, n), q);
    return spawnSync(process.execPath, [join(ordner, datei)], { input: eingabe, encoding: "utf8", timeout });
  };
  test("jeder Fixture-Hook greift nur bei seinem Marker (Fehler: Exit 1, Timeout: ETIMEDOUT), sonst Exit 0 ohne Ausgabe", () => {
    const ohne = (datei: string, marker: string) => { const r = start(datei, `{"command":"echo ${marker}"}`, 8000); return [r.status, r.stdout, r.stderr]; };
    expect(start("hook-fehler.mjs", `{"command":"echo ${lib.MARKER_FEHLER}"}`).status).toBe(1);
    expect((start("hook-timeout.mjs", `{"command":"echo ${lib.MARKER_TIMEOUT}"}`, lib.PROBE_HOOK_TIMEOUT_S * 1000 + 500).error as NodeJS.ErrnoException).code).toBe("ETIMEDOUT");
    expect([ohne("hook-fehler.mjs", lib.MARKER_TIMEOUT), ohne("hook-timeout.mjs", lib.MARKER_FEHLER)]).toEqual([[0, "", ""], [0, "", ""]]);
  });
});

describe("Hook-Protokoll (factory#457, echter Node-Start)", () => {
  type Zeile = { lesbar: boolean; hook_event_name: string | null; tool_name: string | null; tool_input_schluessel: string[] | null; payload_schluessel: string[] | null; agent_type: string | null; task_name: string | null; message_zeile: string | null; langfuse: Record<string, unknown> };
  let ordner = "";
  beforeEach(() => {
    ordner = join(tmp, "prot");
    mkdirSync(ordner, { recursive: true });
    for (const [n, q] of Object.entries(lib.fixtureHooks())) writeFileSync(join(ordner, n), q);
  });
  const hook = (eingabe: string, env: Record<string, string> = {}) => spawnSync(process.execPath, [join(ordner, "hook-protokoll.mjs")], { input: eingabe, encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
  const zeilen = () => readFileSync(join(ordner, "hook-protokoll.jsonl"), "utf8").trim().split("\n").map((z) => JSON.parse(z) as Zeile);
  const v2 = (extra: Record<string, unknown> = {}) => JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "collaboration__spawn_agent", tool_input: { task_name: "t", message: "Erste Zeile\nZweite Zeile", agent_type: "sih-lens", fork_turns: "none", ...extra } });
  test("PreToolUse mit v2-tool_input: genau eine Zeile mit sortierten Schlüsseln, keine Ausgabe, Exit 0", () => {
    const r = hook(v2());
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
    expect(zeilen()).toEqual([{ lesbar: true, hook_event_name: "PreToolUse", tool_name: "collaboration__spawn_agent", tool_input_schluessel: ["agent_type", "fork_turns", "message", "task_name"], payload_schluessel: ["hook_event_name", "session_id", "tool_input", "tool_name"], agent_type: "sih-lens", task_name: "t", message_zeile: "Erste Zeile", langfuse: { gesetzt: false } }]);
  });
  test("message: nur die erste Zeile, höchstens 80 Zeichen", () => {
    hook(v2({ message: `${"x".repeat(120)}\nzweite` }));
    expect(zeilen()[0].message_zeile).toBe("x".repeat(80));
  });
  test("LANGFUSE_BASE_URL: nur der Ursprung; weitere Variablen, Userinfo, Pfad und Query stehen nie im Protokoll", () => {
    hook(v2(), { LANGFUSE_BASE_URL: "http://u:pw@127.0.0.1:9/p?q=geheim", LANGFUSE_SECRET_KEY: "sk-lf-dummy" });
    hook(v2(), { LANGFUSE_BASE_URL: "https://lf.example.test/x" });
    hook(v2(), { LANGFUSE_BASE_URL: "nicht lesbar \\ sk-lf-dummy" });
    const roh = readFileSync(join(ordner, "hook-protokoll.jsonl"), "utf8");
    for (const verboten of ["sk-lf-dummy", "pw", "u:", "/p", "geheim", "/x", "nicht lesbar"]) expect(roh, verboten).not.toContain(verboten);
    expect(zeilen().map((z) => z.langfuse)).toEqual([{ gesetzt: true, schema: "http", host: "127.0.0.1", port: "9" }, { gesetzt: true, schema: "https", host: "lf.example.test", port: "443" }, { gesetzt: true, lesbar: false }]);
  });
  test("SessionStart und ein Payload ohne tool_input: keine Ausgabe, Zeile mit null-Feldern", () => {
    const r = hook(JSON.stringify({ hook_event_name: "SessionStart", source: "startup" }));
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
    expect(zeilen()[0]).toMatchObject({ hook_event_name: "SessionStart", tool_input_schluessel: null, payload_schluessel: ["hook_event_name", "source"], agent_type: null, message_zeile: null });
  });
  test("SubagentStart: der Marker ergibt Exit 2 mit Grund, ohne Marker Exit 0; derselbe Marker in PreToolUse bleibt Exit 0", () => {
    const stopp = hook(JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "sih-lens", message: lib.MARKER_SUBAGENT_STOPP }));
    expect([stopp.status, stopp.stdout, stopp.stderr]).toEqual([2, "", expect.stringContaining("SubagentStart")]);
    expect(hook(JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "sih-lens" })).status).toBe(0);
    expect(hook(v2({ message: lib.MARKER_SUBAGENT_STOPP })).status).toBe(0);
    expect(zeilen().map((z) => z.hook_event_name)).toEqual(["SubagentStart", "SubagentStart", "PreToolUse"]);
  });
  test("kein JSON: Zeile lesbar false, Exit 0, keine Ausgabe", () => {
    const r = hook("das ist kein json");
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
    expect(zeilen()[0]).toMatchObject({ lesbar: false, payload_schluessel: null, tool_name: null });
  });
  test("Protokollziel ist ein Ordner (nicht schreibbar): Exit 0, keine Ausgabe", () => {
    mkdirSync(join(ordner, "hook-protokoll.jsonl"));
    const r = hook(v2());
    expect([r.status, r.stdout, r.stderr]).toEqual([0, "", ""]);
  });
  test("Ursprung: leere Variable gilt als nicht gesetzt, Schema ohne Standard-Port hat port null, Schema ohne Host ist unlesbar", () => {
    for (const url of ["", "ftp://h.example.test/x", "foo:bar"]) hook(v2(), { LANGFUSE_BASE_URL: url });
    expect(zeilen().map((z) => z.langfuse)).toEqual([{ gesetzt: false }, { gesetzt: true, schema: "ftp", host: "h.example.test", port: null }, { gesetzt: true, lesbar: false }]);
  });
  test("Payload ist ein Array oder eine Zahl: lesbar false, kein Wurf", () => {
    for (const roh of ["[1,2]", "7", "null"]) expect(hook(roh).status, roh).toBe(0);
    expect(zeilen().map((z) => [z.lesbar, z.payload_schluessel])).toEqual([[false, null], [false, null], [false, null]]);
  });
  test("Zeilenumbruch CRLF endet die message-Zeile; Felder der obersten Ebene (SubagentStart) gelten ohne tool_input", () => {
    hook(v2({ message: "eins\r\nzwei" }));
    hook(JSON.stringify({ hook_event_name: "SubagentStart", agent_type: "sih-lens", task_name: "t2", message: "oben\nunten" }));
    expect(zeilen().map((z) => [z.message_zeile, z.agent_type, z.task_name])).toEqual([["eins", "sih-lens", "t"], ["oben", "sih-lens", "t2"]]);
  });
  test("tool_input geht vor der obersten Ebene, wenn beide ein Feld tragen", () => {
    hook(JSON.stringify({ hook_event_name: "PreToolUse", agent_type: "oben", tool_input: { agent_type: "innen" } }));
    expect(zeilen()[0].agent_type).toBe("innen");
  });
  test("agent_type und task_name stehen nur im Protokoll, wenn sie Text sind", () => {
    hook(v2({ agent_type: 3, task_name: { a: 1 } }));
    expect(zeilen()[0]).toMatchObject({ agent_type: null, task_name: null });
  });
});

describe("Checkliste der Ladeprobe und der Hook-Beobachtung (factory#457)", () => {
  const text = () => lib.checklisteText({ haupt, probe, config });
  const punkt = (id: string) => lib.checklistenPunkte(config).find((p) => p.id === id)!.text({ haupt, probe });
  test("beginnt mit der Ladeprobe vor dem Vorspann; Kopierbefehle, /hooks, Shell-Negativprobe, Deny-Text, neu vertrauen, ohne --ephemeral", () => {
    const t = text();
    const lade = t.indexOf("Ladeprobe (zuerst");
    expect([lade > 0, lade < t.indexOf("Vorspann (von Hand"), lade < t.indexOf("Punkte:")]).toEqual([true, true, true]);
    for (const teil of ["hooks-soll.json','.codex/hooks.json'", "hooks-variante.json','.codex/hooks.json'", "ohne `-c`-Flags, ohne Wrapper", "/hooks", "Shell-Negativprobe", "Deny-Text wörtlich", "neu vertrauen", "ohne `--ephemeral`"]) expect(t, teil).toContain(teil);
  });
  test.each([
    ["hooks-geladen", "/hooks", "codex-probe-kein-remote", "Erwartet"],
    ["hook-format:agent", "grep codex-probe-hook-format .codex/probe/hook-protokoll.jsonl", "codex-probe-hook-format", "Erwartet"],
    ["subagent-start", "grep SubagentStart .codex/probe/hook-protokoll.jsonl", "codex-probe-subagent-stopp", "Erwartet"],
    ["tracing-ausfall", "grep codex-probe-tracing-ausfall .codex/probe/hook-protokoll.jsonl", "codex-probe-tracing-ausfall", "erwartet"],
  ])("Punkt %s nennt Befehl, Marker und erwartete Ausgabe; Nachweis und ohneExport", (id, befehl, marker, erwartet) => {
    const p = lib.checklistenPunkte(config).find((x) => x.id === id)!;
    expect([p.nachweis, p.ohneExport]).toEqual([id === "tracing-ausfall" ? 4 : 3, true]);
    for (const teil of [befehl, marker, erwartet]) expect(punkt(id), teil).toContain(teil);
    expect(text()).toContain(`\`${id}\``);
  });
  test("die Spawn-Punkte nennen die Rolle ohne Shell (aus der Agent-Negativprobe) und ihren Marker in der message", () => {
    const rolle = lib.negativproben({ haupt, probe, config }).find((n) => n.art === "agent")!.codex.tool_input.agent_type;
    for (const [id, marker] of [["hook-format:agent", lib.MARKER_HOOK_FORMAT], ["subagent-start", lib.MARKER_SUBAGENT_STOPP]]) {
      expect(punkt(id), id).toContain(`agent_type: "${rolle}"`);
      expect(punkt(id), id).toContain(`"\`${marker}\`, Zeilenumbruch`);
    }
    expect(lib.MARKER_TRACING).toBe("codex-probe-tracing-ausfall");
  });
  test("tracing-ausfall nennt die tote Adresse als erwarteten Ursprung in der Protokollzeile", () => {
    expect(punkt("tracing-ausfall")).toContain("http://127.0.0.1:9");
  });
});

describe("Negativproben (K3): der Claude-Dispatcher und der Codex-Adapter verweigern jede, sie bleiben auch bei durchgelassenem Hook folgenlos", () => {
  let wt = "";
  let proben: Probe[] = [];
  beforeEach(() => {
    mkdirSync(join(haupt, ".claude"), { recursive: true });
    writeFileSync(join(haupt, ".claude", "settings.json"), readFileSync(".claude/settings.json"));
    git(haupt, "add", "-A"); git(haupt, "commit", "-q", "-m", "settings");
    wt = join(tmp, "wt");
    git(haupt, "worktree", "add", "-q", "-b", "feature/probe-wt", wt);
    proben = lib.negativproben({ haupt, probe: wt, config });
  });
  test("die Arten sind genau die Werte der Werkzeugtabelle des Adapters", () => {
    expect(proben.map((p) => p.art).sort()).toEqual([...new Set(Object.values(adapter.CODEX_HOOK_WERKZEUGE))].sort());
  });
  test("Claude-Form: der Dispatcher verweigert jede Art", () => {
    for (const p of proben) expect(dispatcher.dispatch(JSON.stringify({ session_id: "s", cwd: wt, hook_event_name: "PreToolUse", ...p.claude }), haupt)?.hookSpecificOutput.permissionDecision, p.art).toBe("deny");
  });
  test("Codex-Form: der Adapter verweigert jede Art", async () => {
    for (const p of proben) expect((await adapter.entscheide(JSON.stringify({ session_id: "s", cwd: wt, hook_event_name: "PreToolUse", ...p.codex }), haupt, { health: () => Promise.resolve({ ok: true, grund: "ok" }) }))?.hookSpecificOutput.permissionDecision, p.art).toBe("deny");
  });
  test("folgenlos: der Push scheitert in git und legt keinen Ref an", () => {
    const vorher = git(haupt, "for-each-ref");
    const argv = (proben.find((p) => p.art === "shell") as Probe).codex.tool_input.command.split(" ").slice(1);
    expect(spawnSync("git", argv, { cwd: wt, encoding: "utf8" }).status).not.toBe(0);
    expect(git(haupt, "for-each-ref")).toBe(vorher);
  });
  test("folgenlos: das Schreibziel im verlinkten Worktree ist nicht schreibbar (.git ist dort eine Datei)", () => {
    const ziel = (proben.find((p) => p.art === "patch") as Probe).claude.tool_input.file_path;
    expect(() => writeFileSync(ziel, "x")).toThrow();
  });
  test("folgenlos: die Agent-Probe nennt eine Rolle ohne Shell und das nicht existierende Probe-Ticket", () => {
    const p = (proben.find((x) => x.art === "agent") as Probe).codex.tool_input;
    expect([p.agent_type, p.message.includes(String(lib.PROBE_TICKET_NR))]).toEqual(["holdout-szenario", true]);
  });
});
