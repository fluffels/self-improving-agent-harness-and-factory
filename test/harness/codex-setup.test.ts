/* @harness-waechter: Codex-Konfiguration und ausschließlich lokale Setup-Dateien (#79). */
import { execFileSync } from "node:child_process";
import { afterEach, expect, test, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { homedir, tmpdir } from "node:os";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as cliRaw from "../../scripts/codex-setup.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import { LANGFUSE_LESE_TOOLS } from "../../scripts/langfuse-zugang.mjs";
const c = raw as unknown as { setupDateien: (m: unknown, c: unknown, u: string, a?: string) => Record<string, string>; schreibeSetup: (r: string, f: Record<string, string>) => string[] };
const cli = cliRaw as unknown as { main: (a: string[], r: string, o: (s: string) => void, e: (s: string) => void, d?: { istIgnoriert?: (p: string) => boolean }) => number };
const config = { agenten: { planer: "probe-planer", umsetzer: "probe-umsetzer", lens: "probe-lens", gruppe: "probe-gruppe" } };
const mcp = { mcpServers: { playwright: { command: "npx", args: ["--probe"] } } };
const endpoint = "https://example.test/api/public/mcp";
const temps: string[] = [];
function temp() { const p = mkdtempSync(join(tmpdir(), "codex-setup-")); temps.push(p); return p; }
afterEach(() => { vi.unstubAllEnvs(); for (const p of temps.splice(0)) rmSync(p, { force: true, recursive: true }); });
function quelle() {
  const root = temp();
  const original = JSON.parse(readFileSync(".factory/projekt.json", "utf8")) as { agenten: Record<string, string> };
  const cfg = { ...original, agenten: { ...original.agenten, ...config.agenten } };
  const pfade = ["AGENTS.md", "docs/codex/einstieg.md", "scripts/codex-hook.mjs", "scripts/codex-hook-lib.mjs", ...["factory-planer", "factory-umsetzer", "factory-lens", "factory-gruppe", "explore", "holdout-szenario", "holdout-abnahme"].map(n => `.claude/agents/${n}.md`)];
  for (const p of pfade) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), "Quelle"); }
  mkdirSync(join(root, ".factory")); writeFileSync(join(root, ".factory/projekt.json"), JSON.stringify(cfg));
  writeFileSync(join(root, ".mcp.json"), JSON.stringify(mcp)); return root;
}
// Standard: alles gilt als ignoriert (die 9-Datei-Annahmen der übrigen Tests); die Ignore-Tests (factory#397) übergeben `d` bzw. `null` (echte git-Prüfung).
function lauf(root: string, args: string[], d: { istIgnoriert?: (p: string) => boolean } | null = { istIgnoriert: () => true }) { const out: string[] = [], err: string[] = []; const code = cli.main(args, root, x => out.push(x), x => err.push(x), d ?? undefined); return { code, out, err }; }

test("Auth ist externer vollständiger Authorization-Header; keine Berechtigungsaufweichung", () => {
  const files = c.setupDateien(mcp, config, endpoint);
  expect(Object.keys(files)).toHaveLength(9);
  expect(files[".codex/config.toml"]).toContain('env_http_headers = { Authorization = "LANGFUSE_MCP_AUTHORIZATION" }');
  expect(files[".codex/config.toml"]).not.toMatch(/bearer_token_env_var|permissions|secret|Basic /);
  expect(files[".codex/config.toml"]).toContain('command = "npx"');
  expect(files[".codex/config.toml"]).toContain('args = ["--probe"]');
  expect(files[".codex/config.toml"]).toContain("required = true");
  expect(files).not.toHaveProperty(".codex/berechtigungen.toml.example");
});
test("Rollen reduzieren unterstützte Features ohne geerbte Sandbox/MCP zu überschreiben", () => {
  const files = c.setupDateien(mcp, config, endpoint);
  for (const [p, text] of Object.entries(files).filter(([p]) => p.includes("/agents/"))) {
    expect(text).toContain("apps = false"); expect(text).toContain("plugins = false");
    expect(text).toContain("memories = false"); expect(text).toContain("request_permissions_tool = false");
    expect(text).not.toMatch(/sandbox_mode|approval_policy|mcp_servers|model =/);
    expect(text.includes("shell_tool = false")).toBe(p.endsWith("holdout-szenario.toml"));
  }
  expect(files[".codex/agents/probe-lens.toml"]).toContain("isolierten");
  expect(files[".codex/agents/probe-planer.toml"]).toContain(".claude/agents/factory-planer.md");
});
test.each(["file:///tmp/x", "http://public.example.test", "https://user@example.test", "https://:secret@example.test", "https://example.test/?token=x", "https://example.test/#x", "garbage"])("ungeeigneter Endpunkt %s", u => {
  expect(() => c.setupDateien(mcp, config, u)).toThrow();
});
test.each(["http://localhost:8080/mcp", "http://127.0.0.1:8080/mcp", "http://[::1]:8080/mcp"])("lokaler Endpunkt %s", u => {
  expect(c.setupDateien(mcp, config, u)[".codex/config.toml"]).toContain(u);
});
test.each([{}, { mcpServers: {} }, { mcpServers: { playwright: { command: "", args: [] } } }, { mcpServers: { playwright: { command: 4, args: [] } } }, { mcpServers: { playwright: { command: "npx" } } }, { mcpServers: { playwright: { command: "npx", args: [4] } } }, { mcpServers: { playwright: { command: "npx", args: null } } }, { mcpServers: { playwright: { command: "npx", args: "--probe" } } }])("kaputte MCP-Quelle stoppt", m => {
  expect(() => c.setupDateien(m, config, endpoint)).toThrow(/Playwright/);
});
test.each([undefined, 4, "", "Planer", "planer_", "../escape", "a".repeat(65), "probe-lens", "1planer", "planer\n"])("ungültige Rolle %s", name => {
  expect(() => c.setupDateien(mcp, { agenten: { ...config.agenten, planer: name } }, endpoint)).toThrow(/Rollenname/);
});
test.each(["a", "a".repeat(64)])("erlaubte Namensgrenze", name => {
  expect(c.setupDateien(mcp, { agenten: { ...config.agenten, planer: name } }, endpoint)[`.codex/agents/${name}.toml`]).toBeTypeOf("string");
});
test("abweichender Playwright-Befehl wird übernommen; fehlende Rollentabelle stoppt", () => {
  expect(c.setupDateien({ mcpServers: { playwright: { command: "runner", args: [] } } }, config, endpoint)[".codex/config.toml"]).toContain('command = "runner"');
  expect(() => c.setupDateien(mcp, {}, endpoint)).toThrow(/Rollenname/);
});
test("langfuseAuth host: kein env_http_headers, aber required und Lese-Toolliste; env und Standard mit Header", () => {
  const host = c.setupDateien(mcp, config, endpoint, "host")[".codex/config.toml"];
  expect(host).not.toContain("env_http_headers");
  expect(host).toContain("required = true");
  expect(host).toContain(`enabled_tools = [${(LANGFUSE_LESE_TOOLS as string[]).map((t) => `"${t}"`).join(", ")}]\n`);
  expect(LANGFUSE_LESE_TOOLS).toEqual(["queryMetrics", "getMetricsSchema", "listObservations", "getObservation", "listModels"]);
  expect(c.setupDateien(mcp, config, endpoint, "env")[".codex/config.toml"]).toContain("env_http_headers");
  expect(c.setupDateien(mcp, config, endpoint)[".codex/config.toml"]).toContain("env_http_headers");
  expect(() => c.setupDateien(mcp, config, endpoint, "anders")).toThrow(/langfuseAuth/);
});
test("CLI --langfuse-auth: host ohne Header, ungültiger Wert Exit 2", () => {
  const root = quelle(), ziel = join(temp(), "neu"), args = ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"];
  expect(lauf(root, [...args, "--langfuse-auth", "host"]).code).toBe(0);
  expect(readFileSync(join(ziel, ".codex/config.toml"), "utf8")).not.toContain("env_http_headers");
  const schlecht = lauf(root, ["--langfuse-url", endpoint, "--langfuse-auth", "anders"]);
  expect(schlecht.code).toBe(2); expect(schlecht.err.join()).toContain("--langfuse-auth");
});
test("Rollentext mit Shell nennt die Read-Pflicht per exec_command; ohne Shell nicht", () => {
  const files = c.setupDateien(mcp, config, endpoint);
  expect(files[".codex/agents/probe-planer.toml"]).toContain("exec_command");
  expect(files[".codex/agents/holdout-szenario.toml"]).not.toContain("exec_command");
});
test("Standard-Ausgabe bleibt im geprüften Quellrepo, Vorschau ist schreibfrei", () => {
  const root = quelle(), args = ["--langfuse-url", endpoint];
  expect(lauf(root, args).code).toBe(0); expect(existsSync(join(root, ".codex"))).toBe(false);
  expect(lauf(root, [...args, "--write"]).code).toBe(0);
  expect(readFileSync(join(root, ".codex/config.toml"), "utf8")).toContain("mcp_servers.langfuse");
});
test("separates Ausgabeziel: Vorschau schreibt nichts; Quellen bleiben im Quellrepo", () => {
  const root = quelle(), ziel = join(temp(), "neu");
  const args = ["--langfuse-url", endpoint, "--ausgabe", ziel];
  expect(lauf(root, args).code).toBe(0); expect(existsSync(ziel)).toBe(false);
  expect(lauf(root, [...args, "--write"]).code).toBe(0);
  expect(readFileSync(join(ziel, ".codex/config.toml"), "utf8")).toContain("mcp_servers.playwright");
  expect(existsSync(join(root, ".codex"))).toBe(false);
  expect(lauf(root, [...args, "--write"]).out.join()).toContain('"dateien":[]');
  writeFileSync(join(ziel, ".codex/config.toml"), "Entwurf");
  expect(lauf(root, [...args, "--write"]).code).toBe(1);
  expect(readFileSync(join(ziel, ".codex/config.toml"), "utf8")).toBe("Entwurf");
});
test.each([".mcp.json", ".factory/projekt.json", ".claude/agents/factory-planer.md", "AGENTS.md"])("fehlende Quelle %s stoppt vor Ausgabe", p => {
  const root = quelle(), ziel = join(temp(), "neu"); rmSync(join(root, p));
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"]).code).toBe(1);
  expect(existsSync(ziel)).toBe(false);
});
test("Verzeichnis statt Rollenquelle ist ungültig", () => {
  const root = quelle(), p = join(root, ".claude/agents/factory-planer.md"), ziel = join(temp(), "neu"); rmSync(p); mkdirSync(p);
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"]).code).toBe(1);
  expect(existsSync(ziel)).toBe(false);
});
test("Quellen-Junction wird vor jeder Ausgabe abgelehnt", () => {
  const root = quelle(), agents = join(root, ".claude/agents"), extern = temp(), ziel = join(temp(), "ausgabe");
  for (const name of readdirSync(agents)) writeFileSync(join(extern, name), readFileSync(join(agents, name)));
  rmSync(agents, { recursive: true }); symlinkSync(extern, agents, "junction");
  const result = lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"]);
  expect(result.code).toBe(1); expect(result.err.join()).toContain("Symlink"); expect(existsSync(ziel)).toBe(false);
});
test("Ausgabeziel und seine Vorfahren dürfen keine Symlinks sein", () => {
  const root = quelle(), real = temp(), link = join(temp(), "link"); symlinkSync(real, link, "junction");
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", join(link, "kind"), "--write"]).code).toBe(1);
  expect(existsSync(join(real, "kind"))).toBe(false);
});
test("pruefeAusgabe: ist das Ziel selbst die Bezugswurzel (Standard `repo = root`), wird ein Symlink als Ziel nicht verfolgt", () => {
  const real = temp(), link = join(temp(), "link"); symlinkSync(real, link, "junction");
  const p = raw as unknown as { pruefeAusgabe: (root: string, repo?: string) => string };
  expect(() => p.pruefeAusgabe(link)).toThrow(/Symlink/);
});
test.each([".codex", ".codex/agents"])("auch ein innerer Ziel-Symlink %s wird nicht verfolgt", p => {
  const root = temp(), real = temp(); mkdirSync(dirname(join(root, p)), { recursive: true }); symlinkSync(real, join(root, p), "junction");
  expect(() => c.schreibeSetup(root, { ".codex/agents/probe.toml": "x" })).toThrow(/Symlink/);
  expect(existsSync(join(real, "probe.toml"))).toBe(false);
});
test.each([".git", ".agents", ".codex", ".aws", ".AWS"])("keine Ausgabe unter Metadaten %s", p => {
  const root = quelle(); const ziel = join(root, p, "ausgabe");
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"]).code).toBe(1);
  expect(existsSync(ziel)).toBe(false);
});
test("keine Ausgabe in globale Codex-Konfiguration", () => {
  const root = quelle();
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", homedir(), "--write"]).code).toBe(1);
});
test("individuelles CODEX_HOME sperrt sich selbst und Nachfahren, nicht seine Nachbarn", () => {
  const root = quelle(), basis = temp(), home = join(basis, "privates-codex-home");
  vi.stubEnv("CODEX_HOME", home);
  for (const ziel of [home, join(home, "kind")]) {
    const result = lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"]);
    expect(result.code).toBe(1); expect(result.err.join()).toContain("Globale Codex-Konfiguration");
    expect(existsSync(ziel)).toBe(false);
  }
  const nachbar = join(basis, "anderer-ordner");
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", nachbar]).code).toBe(0);
  expect(existsSync(nachbar)).toBe(false);
});
test("alle Kollisionen prüfen, bevor eine neue Datei geschrieben wird", () => {
  const root = temp(); c.schreibeSetup(root, { ".codex/b": "alt" });
  expect(() => c.schreibeSetup(root, { ".codex/a": "neu", ".codex/b": "anders" })).toThrow(/Entwurf/);
  expect(existsSync(join(root, ".codex/a"))).toBe(false);
});
test.each(["../escape", ".codex/../escape", ".codex/invalid?"])("kein abweichender Zielpfad %s", p => {
  expect(() => c.schreibeSetup(temp(), { [p]: "x" })).toThrow();
});
test("Regex-Endgrenze lässt keinen Zeilenumbruch im Zielpfad durch", () => {
  expect(() => c.schreibeSetup(temp(), { ".codex/a\n": "x" })).toThrow(/Ungültiger Setup-Zielpfad/);
});
test("Setup-Aufruffehler schließen vor I/O", () => {
  expect(lauf(temp(), []).code).toBe(2);
  expect(lauf(temp(), ["--langfuse-url", endpoint, "--falsch"]).code).toBe(2);
});
test("gemeinsamerVorfahre: nächster gemeinsamer Ordner; zwei Windows-Laufwerke enden an der Wurzel statt endlos zu laufen", () => {
  const g = c as unknown as { gemeinsamerVorfahre: (a: string, b: string, pm?: typeof win32) => string };
  expect(g.gemeinsamerVorfahre("C:\\w\\aus", "C:\\w\\repo", win32)).toBe("C:\\w");
  expect(g.gemeinsamerVorfahre("C:\\w\\aus", "D:\\repo", win32)).toBe("C:\\");
  expect(g.gemeinsamerVorfahre("/x/y", "/x/z/q")).toBe("/x");
  expect(g.gemeinsamerVorfahre("/x/y", "/x/y")).toBe("/x/y");
  expect(g.gemeinsamerVorfahre("/x/y", "/x")).toBe("/x");
});

test("Hook-Registrierung (factory#364): feste Werkzeuge, Adapter-Befehl und Timeout, unabhängig von Endpunkt und Auth-Modus", () => {
  const a = c.setupDateien(mcp, config, endpoint)[".codex/hooks.json"];
  expect(c.setupDateien(mcp, config, "http://localhost:1/x", "host")[".codex/hooks.json"]).toBe(a);
  const h = (JSON.parse(a) as { hooks: { PreToolUse: { matcher: string; hooks: { type: string; command: string; timeout: number }[] }[] } }).hooks.PreToolUse;
  expect(h).toHaveLength(1);
  expect(h[0].hooks).toEqual([{ type: "command", command: "node scripts/codex-hook.mjs", timeout: 30 }]);
  for (const name of ["exec_command", "apply_patch", "spawn_agent"]) expect(new RegExp(h[0].matcher).test(name), name).toBe(true);
  for (const name of ["write_stdin", "Bash2", "xapply_patch", "spawn_agent2", ""]) expect(new RegExp(h[0].matcher).test(name), name).toBe(false);
});

test("Setup stoppt, wenn der Hook-Adapter als Quelle fehlt", () => {
  const root = quelle();
  rmSync(join(root, "scripts/codex-hook.mjs"));
  const r = lauf(root, ["--langfuse-url", endpoint]);
  expect(r.code).not.toBe(0);
  expect(r.err.join()).toContain("scripts/codex-hook.mjs");
});

function gitRepo(ignore?: string) {
  const ziel = temp();
  execFileSync("git", ["init", "-q", ziel]);
  if (ignore !== undefined) writeFileSync(join(ziel, ".gitignore"), ignore);
  return ziel;
}
const gitIn = (cwd: string, ...a: string[]) => { try { return { status: 0, out: execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) }; } catch (e) { return { status: (e as { status: number }).status, out: "" }; } };

test("L10 (factory#397): ohne Ignore im Ziel entsteht .codex/.gitignore; danach ist alles ignoriert und git status sauber", () => {
  const root = quelle(), ziel = gitRepo();
  const r = lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"], null);
  expect(r.code).toBe(0);
  expect(r.out.join()).toContain(".codex/.gitignore");
  expect(readFileSync(join(ziel, ".codex/.gitignore"), "utf8")).toContain("/hooks.json");
  expect(gitIn(ziel, "check-ignore", "-q", ".codex/hooks.json").status).toBe(0);
  expect(gitIn(ziel, "status", "--porcelain").out).toBe("");
  // Idempotenz: zweiter Lauf schreibt nichts mehr
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"], null).out.join()).toContain('"dateien":[]');
});
test("L10 Negativfall: ist schon alles ignoriert, entsteht keine .codex/.gitignore", () => {
  const root = quelle(), ziel = gitRepo(".codex/config.toml\n.codex/agents/\n.codex/hooks.json\n");
  const r = lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"], null);
  expect(r.code).toBe(0);
  expect(r.out.join()).not.toContain(".codex/.gitignore");
  expect(existsSync(join(ziel, ".codex/.gitignore"))).toBe(false);
});
test("L10: die Vorschau nennt .codex/.gitignore, wenn nicht ignoriert (Injektion), schreibt aber nichts", () => {
  const root = quelle();
  const r = lauf(root, ["--langfuse-url", endpoint], { istIgnoriert: () => false });
  expect(r.out.join()).toContain(".codex/.gitignore");
  expect(existsSync(join(root, ".codex"))).toBe(false);
});
test("L10: ohne git im Ziel (Exit 128) gilt als nicht ignoriert, die Datei wird geschrieben", () => {
  const root = quelle(), ziel = temp();
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"], null).code).toBe(0);
  expect(existsSync(join(ziel, ".codex/.gitignore"))).toBe(true);
});
