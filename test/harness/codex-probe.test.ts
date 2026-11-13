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
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as guardRaw from "../../scripts/lens-auftrag-guard.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as nachweisRaw from "../../scripts/nachweis-lib.mjs";
import config from "../fixtures/projekt-probe.json";
const parseLensAuftrag = (guardRaw as unknown as { parseLensAuftrag: (t: string) => Record<string, string> }).parseLensAuftrag;
const HEX_HEAD = (nachweisRaw as unknown as { HEX_HEAD: RegExp }).HEX_HEAD;

type Res = { status: number; stdout: string; stderr: string };
type Deps = { tmp?: string; git?: (a: string[], cwd: string) => Res; setup?: (p: string, a: string[]) => { status: number; stderr: string }; lade?: () => unknown };
type Probe = { art: string; grund: string; codex: { tool_name: string; tool_input: Record<string, string> }; claude: { tool_name: string; tool_input: Record<string, string> } };
const cli = cliRaw as unknown as { main: (a: string[], r: string, o: (s: string) => void, e: (s: string) => void, d?: Deps) => number };
const hookRegistrierung = (codexLibRaw as unknown as { hookRegistrierung: () => string }).hookRegistrierung;
const lib = libRaw as unknown as { CLI_VERSION_MUSTER: RegExp; PROBE_TICKET_NR: number; PROBE_HOOK_TIMEOUT_S: number; MARKER_FEHLER: string; MARKER_TIMEOUT: string; checklistenPunkte: (c: unknown) => { id: string }[]; fixtureHooks: () => Record<string, string>; negativproben: (a: { haupt: string; probe: string; config: unknown }) => Probe[] };
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
  writeFileSync(join(haupt, ".gitignore"), "/.claude/worktrees/\n.codex/\n");
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
const VERSION = ["--codex-version", "9.9.9"];
const worktreeListe = () => git(haupt, "worktree", "list", "--porcelain");
const branchListe = () => git(haupt, "branch", "--list", "--format=%(refname:short)");
const unveraendert = () => { expect(worktreeListe()).not.toContain("codex-probe"); expect(branchListe()).not.toContain("codex-probe"); expect(calls.some((c) => c[0] === "fetch" || (c[0] === "worktree" && c[1] === "add"))).toBe(false); };

describe("vorbereiten und aufraeumen", () => {
  test("legt Worktree, Branch von origin/main, Probe-Dateien und Hook-Variante an; aufraeumen entfernt alles und ist wiederholbar", () => {
    const r = lauf(["vorbereiten", ...VERSION]);
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(worktreeListe()).toContain(`worktree ${probe}`);
    expect(git(haupt, "rev-parse", "codex-probe").trim()).toBe(git(haupt, "rev-parse", "origin/main").trim());
    expect(spawnSync("git", ["config", "branch.codex-probe.remote"], { cwd: haupt, encoding: "utf8" }).stdout).toBe("");
    const vorlage = (JSON.parse(readFileSync(join(probe, ".codex", "probe", "bericht-vorlage.json"), "utf8")) as { punkte: Record<string, object> }).punkte;
    expect(Object.keys(vorlage).filter((k) => "ausgabe" in vorlage[k]).sort()).toEqual(["dateiwerkzeug", "defekter-mcp", "tracing-ausfall"]);
    expect(readdirSync(join(probe, ".codex", "probe")).sort()).toEqual([".gitignore", "bericht-vorlage.json", "checkliste.md", "hook-fehler.mjs", "hook-timeout.mjs", "stand.json", "ticket.md"]);
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
    lauf(["vorbereiten", ...VERSION]);
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
    const r = lauf(["vorbereiten", ...VERSION]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("nicht sauber");
    unveraendert();
  });
  test("globale Codex-Konfiguration als Ziel: Exit 1 ohne Änderung", () => {
    vi.stubEnv("CODEX_HOME", `${haupt}/.claude/worktrees`);
    const r = lauf(["vorbereiten", ...VERSION]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Globale Codex-Konfiguration");
    unveraendert();
  });
  test("vorhandener Probe-Ordner: Exit 1 ohne Änderung, aufraeumen meldet den Ordner als Rest mit Exit 1", () => {
    mkdirSync(probe, { recursive: true });
    const r = lauf(["vorbereiten", ...VERSION]);
    expect(r.code).toBe(1);
    expect(r.err).toContain(probe);
    unveraendert();
    const a = lauf(["aufraeumen"]);
    expect(a.code).toBe(1);
    expect(a.err).toContain(probe);
    expect(existsSync(probe)).toBe(true);
  });
  test("Setup-Argumente: abweichende URL und --langfuse-auth werden durchgereicht", () => {
    expect(lauf(["vorbereiten", ...VERSION, "--langfuse-url", "https://x.example/mcp", "--langfuse-auth", "host"]).code).toBe(0);
    expect(calls.find((c) => c[0] === "setup")?.slice(2)).toEqual(["--langfuse-url", "https://x.example/mcp", "--langfuse-auth", "host", "--write"]);
  });
  test("Standardzweig des Repos (Arbeitsplatz-Config) ist die Basis, ein Repo außerhalb der Config stoppt mit Exit 1", () => {
    git(haupt, "switch", "-q", "-c", "develop"); writeFileSync(join(haupt, "d.txt"), "d"); git(haupt, "add", "-A"); git(haupt, "commit", "-q", "-m", "develop");
    git(haupt, "push", "-q", "origin", "develop"); git(haupt, "switch", "-q", "main");
    const mitBlock = (name: string) => ({ ...config, arbeitsplatz: { wurzel: tmp, repos: [{ name, pfad: "haupt", standardzweig: "develop" }] } });
    expect(lauf(["vorbereiten", ...VERSION], { lade: () => mitBlock("haupt") }).code).toBe(0);
    expect(git(haupt, "rev-parse", "codex-probe").trim()).toBe(git(haupt, "rev-parse", "origin/develop").trim());
    expect(lauf(["aufraeumen"], { lade: () => mitBlock("haupt") }).code).toBe(0);
    expect(lauf(["vorbereiten", ...VERSION], { lade: () => ({ ...config, arbeitsplatz: { wurzel: tmp, repos: [{ name: "x", pfad: "anderes" }] } }) }).code).toBe(1);
  });
  test("Fehlerzweige: kein Git-Repository und nicht ladbare Config ergeben Exit 1", () => {
    mkdirSync(join(tmp, "leer"));
    expect(cli.main(["aufraeumen"], join(tmp, "leer"), () => undefined, () => undefined, { git: echtGit, lade: () => config })).toBe(1);
    expect(lauf(["vorbereiten", ...VERSION], { lade: () => { throw new Error("kaputt"); } }).err).toContain("nicht ladbar");
  });
  test("vorhandener Branch codex-probe: Exit 1 ohne Änderung", () => {
    git(haupt, "branch", "codex-probe");
    const r = lauf(["vorbereiten", ...VERSION]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("Branch codex-probe");
    expect(calls.some((c) => c[0] === "fetch" || (c[0] === "worktree" && c[1] === "add"))).toBe(false);
  });
  test("git fetch scheitert: Exit 1 und kein Worktree, kein Branch", () => {
    const r = lauf(["vorbereiten", ...VERSION], { git: (a, cwd) => (a[0] === "fetch" ? { status: 1, stdout: "", stderr: "offline" } : echtGit(a, cwd)) });
    expect([r.code, r.err.includes("offline"), worktreeListe().includes("codex-probe"), branchListe().includes("codex-probe")]).toEqual([1, true, false, false]);
  });
  test("Setup scheitert: Rückbau, Exit 1 mit Ursache, nichts bleibt", () => {
    const r = lauf(["vorbereiten", ...VERSION], { setup: () => ({ status: 1, stderr: "kaputt" }) });
    expect(r.code).toBe(1);
    expect(r.err).toContain("kaputt");
    expect(worktreeListe()).not.toContain("codex-probe");
    expect(branchListe()).not.toContain("codex-probe");
    expect(existsSync(probe)).toBe(false);
  });
  test("Rest nach aufraeumen: ein vorgetäuschtes worktree remove ergibt Exit 1 mit Pfad", () => {
    lauf(["vorbereiten", ...VERSION]);
    const r = lauf(["aufraeumen"], { git: (a, cwd) => (a[0] === "worktree" && a[1] === "remove" ? { status: 0, stdout: "", stderr: "" } : echtGit(a, cwd)) });
    expect(r.code).toBe(1);
    expect(r.err).toContain(probe);
  });
  test("Worktree mit der Probe-Ticket-Nummer im Namen wird mitgeräumt, fremde Worktrees bleiben", () => {
    lauf(["vorbereiten", ...VERSION]);
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
  test("--codex-version fehlt oder ist keine Version x.y.z: Exit 2 ohne Änderung (factory#456)", () => {
    for (const a of [["vorbereiten"], ["vorbereiten", "--codex-version", "neu"], ["vorbereiten", "--codex-version", "0.167"], ["vorbereiten", "--codex-version", ""]]) expect(lauf(a).code, a.join(" ")).toBe(2);
    unveraendert();
  });
  test("vorbereiten: sauberer Probe-Worktree, Probe-Basis, Startweg und Version in Checkliste, Vorlage und stand.json (factory#456)", () => {
    const r = lauf(["vorbereiten", ...VERSION]);
    expect(r.code).toBe(0);
    expect(git(probe, "status", "--porcelain")).toBe("");
    const basis = git(haupt, "rev-parse", "origin/main").trim();
    const soll = `codex --cd ${JSON.stringify(probe)} --no-daemon -c check_for_update_on_startup=false`;
    const dir = join(probe, ".codex", "probe");
    expect(JSON.parse(readFileSync(join(dir, "stand.json"), "utf8"))).toEqual({ basis, version: "9.9.9", startweg: soll });
    const vorlage = JSON.parse(readFileSync(join(dir, "bericht-vorlage.json"), "utf8")) as { erwartet: unknown; startweg: string; versionVorStart: string };
    expect(vorlage).toMatchObject({ erwartet: { version: "9.9.9", startweg: soll }, startweg: "", versionVorStart: "" });
    for (const t of [r.out, readFileSync(join(dir, "checkliste.md"), "utf8")]) {
      for (const teil of ["9.9.9", soll, "--no-daemon", "check_for_update_on_startup=false", "codex --version", basis]) expect(t).toContain(teil);
      expect(t).toContain(`${soll} -c mcp_servers.defekt.command=`);
      expect(t).toContain("noch nicht erzeugt");
    }
    expect(readFileSync(join(dir, "ticket.md"), "utf8")).toContain("lokaler Commit auf dem Branch `codex-probe`");
  });
  test("CLI-Versionsmuster: nur x.y.z, auch mehrstellig, ohne Präfix und Zusatz", () => {
    for (const v of ["0.167.0", "10.20.30"]) expect(lib.CLI_VERSION_MUSTER.test(v), v).toBe(true);
    for (const v of ["0.167", "v1.2.3", "1.2.3-x", "1.2.3.4", "", "a.b.c"]) expect(lib.CLI_VERSION_MUSTER.test(v), v).toBe(false);
  });
  test("vorbereiten: ein unsauberer Probe-Worktree nach dem Setup baut zurück (Exit 1)", () => {
    const r = lauf(["vorbereiten", ...VERSION], { setup: (p) => { setupStub(p); writeFileSync(join(p, "lose.txt"), "x"); return { status: 0, stderr: "" }; } });
    expect(r.code).toBe(1);
    expect(r.err).toContain("nicht sauber");
    expect(worktreeListe()).not.toContain("codex-probe");
  });
  test("Quelltext-Wächter: kein process.env, kein homedir(, kein Prozessstart mit Literal codex (geschlossene Musterliste)", () => {
    for (const d of readdirSync("scripts").filter((n) => /^codex-probe.*\.mjs$/.test(n))) {
      const q = readFileSync(join("scripts", d), "utf8");
      expect(q, d).not.toMatch(/process\.env|homedir\(|\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync)\(\s*["'`]codex/);
    }
  });
});

describe("auftraege (factory#456): committeter Stand, erwarteter HEAD, fertige Aufträge", () => {
  const scratch = () => join(tmp, "scratch");
  const auftraege = () => lauf(["auftraege"], { tmp: scratch() });
  const umsetzen = () => { mkdirSync(join(probe, "codex-probe"), { recursive: true }); writeFileSync(join(probe, "codex-probe", "gruss.mjs"), "console.log('Hallo');\n"); };
  const committen = () => { git(probe, "add", "codex-probe"); git(probe, "commit", "-q", "-m", "Umsetzung"); return git(probe, "rev-parse", "HEAD").trim(); };
  test("ohne Probe: Exit 1 mit eigener Meldung", () => { const r = auftraege(); expect(r.code).toBe(1); expect(r.err).toContain("Probe-Worktree fehlt"); });
  test("Projekt-Config nicht ladbar: Exit 1", () => { const r = lauf(["auftraege"], { lade: () => { throw new Error("kaputt"); } }); expect(r.code).toBe(1); expect(r.err).toContain("nicht ladbar"); });
  test("git diff scheitert: Exit 1 ohne Patch", () => {
    lauf(["vorbereiten", ...VERSION]);
    umsetzen();
    committen();
    const r = lauf(["auftraege"], { tmp: scratch(), git: (a, cwd) => (a[0] === "diff" ? { status: 1, stdout: "", stderr: "kaputt" } : echtGit(a, cwd)) });
    expect(r.code).toBe(1);
    expect(r.err).toContain("git diff scheiterte");
    expect(existsSync(join(probe, ".codex", "probe", "review.patch"))).toBe(false);
  });
  test("ohne Temp-Vorgabe liegt der Scratchpad-Pfad im Temp-Ordner des Systems", () => {
    lauf(["vorbereiten", ...VERSION]);
    umsetzen();
    committen();
    expect(lauf(["auftraege"]).out).toContain(`Scratchpad: ${join(tmpdir(), `codex-probe-${lib.PROBE_TICKET_NR}-abnahme`)}`);
  });
  test("uncommittete Umsetzung: Exit 1 \"nicht sauber\", kein Patch", () => {
    lauf(["vorbereiten", ...VERSION]);
    umsetzen();
    const r = auftraege();
    expect(r.code).toBe(1);
    expect(r.err).toContain("nicht sauber");
    expect(existsSync(join(probe, ".codex", "probe", "review.patch"))).toBe(false);
  });
  test("kein Commit über der Basis: Exit 1", () => {
    lauf(["vorbereiten", ...VERSION]);
    const r = auftraege();
    expect(r.code).toBe(1);
    expect(r.err).toContain("Kein Commit");
  });
  test("ohne stand.json: Exit 1", () => {
    lauf(["vorbereiten", ...VERSION]);
    rmSync(join(probe, ".codex", "probe", "stand.json"));
    expect(auftraege().code).toBe(1);
  });
  test("Basis kein Vorfahr (Historie verändert): Exit 1", () => {
    lauf(["vorbereiten", ...VERSION]);
    writeFileSync(join(probe, "x.txt"), "x");
    git(probe, "add", "x.txt");
    git(probe, "commit", "-q", "-m", "x");
    git(probe, "checkout", "-q", "--orphan", "neu");
    git(probe, "commit", "-q", "-m", "wurzel", "--allow-empty");
    const r = auftraege();
    expect(r.code).toBe(1);
    expect(r.err).toContain("Vorfahr");
  });
  test("nach dem Commit: Exit 0, erwarteter HEAD und fertige Aufträge ohne Platzhalter, Lens-Auftrag besteht den Guard, Probe-Worktree bleibt sauber", () => {
    lauf(["vorbereiten", ...VERSION]);
    umsetzen();
    const head = committen();
    const r = auftraege();
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    const text = readFileSync(join(probe, ".codex", "probe", "checkliste.md"), "utf8");
    const bloecke = r.out.split("```").filter((_b, i) => i % 2 === 1).map((b) => b.trim());
    expect(bloecke).toHaveLength(2);
    const [lens, abnahme] = bloecke;
    for (const t of [lens, abnahme]) expect(t).not.toMatch(/<[^>]*>/);
    expect(lens).toContain(`erwarteter HEAD: ${head}`);
    expect(lens).toMatch(/^Brille: kombiniert · /);
    expect(parseLensAuftrag(lens)).toMatchObject({ "erwarteter HEAD": head, Arbeitsverzeichnis: probe, Patch: `${probe}/.codex/probe/review.patch` });
    expect(HEX_HEAD.test(head)).toBe(true);
    for (const teil of [`head: ${head}`, `Worktree: ${probe}`, `Scratchpad: ${scratch()}/codex-probe-${lib.PROBE_TICKET_NR}-abnahme`, "Kopf: ABNAHME #999999999 · holdout-abnahme", "--- Kriterien ---", "K3:"]) expect(abnahme).toContain(teil);
    expect(text).toContain(`erwarteter HEAD: ${head}`);
    expect(git(probe, "rev-parse", "HEAD").trim().startsWith(head)).toBe(true);
    expect(git(probe, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(probe, ".codex", "probe", "review.patch"), "utf8")).toContain("gruss.mjs");
    expect(existsSync(scratch())).toBe(false);
  });
  test("zweiter Commit und erneuter Lauf: neuer HEAD, Patch umfasst beide Commits", () => {
    lauf(["vorbereiten", ...VERSION]);
    umsetzen();
    committen();
    auftraege();
    writeFileSync(join(probe, "codex-probe", "zwei.mjs"), "x\n");
    const head2 = committen();
    const r = auftraege();
    expect(r.code).toBe(0);
    expect(r.out).toContain(head2);
    const patch = readFileSync(join(probe, ".codex", "probe", "review.patch"), "utf8");
    expect(patch).toContain("gruss.mjs");
    expect(patch).toContain("zwei.mjs");
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
