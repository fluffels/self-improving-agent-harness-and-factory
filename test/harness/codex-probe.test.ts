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
const lib = libRaw as unknown as { PROBE_TICKET_NR: number; PROBE_HOOK_TIMEOUT_S: number; MARKER_FEHLER: string; MARKER_TIMEOUT: string; checklistenPunkte: (c: unknown) => { id: string }[]; fixtureHooks: () => Record<string, string>; negativproben: (a: { haupt: string; probe: string; config: unknown }) => Probe[] };
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
    expect(readdirSync(join(probe, ".codex", "probe")).sort()).toEqual([".gitignore", "bericht-vorlage.json", "checkliste.md", "hook-fehler.mjs", "hook-timeout.mjs", "ticket.md"]);
    type Hooks = { hooks: { PreToolUse: { matcher: string; hooks: { timeout: number; command: string }[] }[] } };
    const hooks = (JSON.parse(readFileSync(join(probe, ".codex", "hooks.json"), "utf8")) as Hooks).hooks.PreToolUse;
    const soll = (JSON.parse(hookRegistrierung()) as Hooks).hooks.PreToolUse;
    expect(hooks.slice(0, soll.length)).toEqual(soll);
    expect(hooks.slice(soll.length).map((h) => [h.matcher, h.hooks[0].command, h.hooks[0].timeout])).toEqual([["^(Bash|exec_command)$", "node .codex/probe/hook-fehler.mjs", adapter.CODEX_HOOK_TIMEOUT_S], ["^(Bash|exec_command)$", "node .codex/probe/hook-timeout.mjs", lib.PROBE_HOOK_TIMEOUT_S]]);
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
      expect(q, d).not.toMatch(/process\.env|homedir\(|\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*["'`]codex/);
    }
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
