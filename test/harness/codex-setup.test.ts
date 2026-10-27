/* @harness-waechter: Codex-Konfiguration und ausschließlich lokale Setup-Dateien (#79). */
import { afterEach, expect, test } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir, tmpdir } from "node:os";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as cliRaw from "../../scripts/codex-setup.mjs";
const c = raw as unknown as { setupDateien: (m: unknown, c: unknown, u: string) => Record<string, string>; schreibeSetup: (r: string, f: Record<string, string>) => string[] };
const cli = cliRaw as unknown as { main: (a: string[], r: string, o: (s: string) => void, e: (s: string) => void) => number };
const config = { agenten: { planer: "probe-planer", umsetzer: "probe-umsetzer", lens: "probe-lens", gruppe: "probe-gruppe" } };
const mcp = { mcpServers: { playwright: { command: "npx", args: ["--probe"] } } };
const endpoint = "https://example.test/api/public/mcp";
const temps: string[] = [];
function temp() { const p = mkdtempSync(join(tmpdir(), "codex-setup-")); temps.push(p); return p; }
afterEach(() => { for (const p of temps.splice(0)) rmSync(p, { force: true, recursive: true }); });
function quelle() {
  const root = temp();
  const original = JSON.parse(readFileSync(".factory/projekt.json", "utf8")) as { agenten: Record<string, string> };
  const cfg = { ...original, agenten: { ...original.agenten, ...config.agenten } };
  const pfade = ["AGENTS.md", "docs/codex/einstieg.md", ...["factory-planer", "factory-umsetzer", "factory-lens", "factory-gruppe", "explore", "holdout-szenario", "holdout-abnahme"].map(n => `.claude/agents/${n}.md`)];
  for (const p of pfade) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), "Quelle"); }
  mkdirSync(join(root, ".factory")); writeFileSync(join(root, ".factory/projekt.json"), JSON.stringify(cfg));
  writeFileSync(join(root, ".mcp.json"), JSON.stringify(mcp)); return root;
}
function lauf(root: string, args: string[]) { const out: string[] = [], err: string[] = []; const code = cli.main(args, root, x => out.push(x), x => err.push(x)); return { code, out, err }; }

test("Auth ist externer vollständiger Authorization-Header; keine Berechtigungsaufweichung", () => {
  const files = c.setupDateien(mcp, config, endpoint);
  expect(Object.keys(files)).toHaveLength(8);
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
test.each([{}, { mcpServers: {} }, { mcpServers: { playwright: { command: "", args: [] } } }, { mcpServers: { playwright: { command: 4, args: [] } } }, { mcpServers: { playwright: { command: "npx" } } }, { mcpServers: { playwright: { command: "npx", args: [4] } } }])("kaputte MCP-Quelle stoppt", m => {
  expect(() => c.setupDateien(m, config, endpoint)).toThrow(/Playwright/);
});
test.each([undefined, 4, "", "Planer", "planer_", "../escape", "a".repeat(65), "probe-lens"])("ungültige Rolle %s", name => {
  expect(() => c.setupDateien(mcp, { agenten: { ...config.agenten, planer: name } }, endpoint)).toThrow(/Rollenname/);
});
test.each(["a", "a".repeat(64)])("erlaubte Namensgrenze", name => {
  expect(c.setupDateien(mcp, { agenten: { ...config.agenten, planer: name } }, endpoint)[`.codex/agents/${name}.toml`]).toBeTypeOf("string");
});
test("abweichender Playwright-Befehl wird übernommen; fehlende Rollentabelle stoppt", () => {
  expect(c.setupDateien({ mcpServers: { playwright: { command: "runner", args: [] } } }, config, endpoint)[".codex/config.toml"]).toContain('command = "runner"');
  expect(() => c.setupDateien(mcp, {}, endpoint)).toThrow(/Rollenname/);
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
test("Ausgabeziel und seine Vorfahren dürfen keine Symlinks sein", () => {
  const root = quelle(), real = temp(), link = join(temp(), "link"); symlinkSync(real, link, "junction");
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", join(link, "kind"), "--write"]).code).toBe(1);
  expect(existsSync(join(real, "kind"))).toBe(false);
});
test.each([".codex", ".codex/agents"])("auch ein innerer Ziel-Symlink %s wird nicht verfolgt", p => {
  const root = temp(), real = temp(); mkdirSync(dirname(join(root, p)), { recursive: true }); symlinkSync(real, join(root, p), "junction");
  expect(() => c.schreibeSetup(root, { ".codex/agents/probe.toml": "x" })).toThrow(/Symlink/);
  expect(existsSync(join(real, "probe.toml"))).toBe(false);
});
test.each([".git", ".agents", ".codex"])("keine Ausgabe unter Metadaten %s", p => {
  const root = quelle(); const ziel = join(root, p, "ausgabe");
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", ziel, "--write"]).code).toBe(1);
  expect(existsSync(ziel)).toBe(false);
});
test("keine Ausgabe in globale Codex-Konfiguration", () => {
  const root = quelle();
  expect(lauf(root, ["--langfuse-url", endpoint, "--ausgabe", homedir(), "--write"]).code).toBe(1);
});
test("alle Kollisionen prüfen, bevor eine neue Datei geschrieben wird", () => {
  const root = temp(); c.schreibeSetup(root, { ".codex/b": "alt" });
  expect(() => c.schreibeSetup(root, { ".codex/a": "neu", ".codex/b": "anders" })).toThrow(/Entwurf/);
  expect(existsSync(join(root, ".codex/a"))).toBe(false);
});
test.each(["../escape", ".codex/../escape", ".codex/invalid?"])("kein abweichender Zielpfad %s", p => {
  expect(() => c.schreibeSetup(temp(), { [p]: "x" })).toThrow();
});
test("Setup-Aufruffehler schließen vor I/O", () => {
  expect(lauf(temp(), []).code).toBe(2);
  expect(lauf(temp(), ["--langfuse-url", endpoint, "--falsch"]).code).toBe(2);
});
