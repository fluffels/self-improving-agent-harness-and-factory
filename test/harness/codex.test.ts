/* @harness-waechter: Codex-Setup und diagnostische Vorprüfung (#79).
 * Geschlossener Prüfumfang: generierte Rollen/MCP, Laufzeitinventar und exportierte
 * Langfuse-Observations. Kein Nachweis technischer Quarantäne durch Unit-Tests. */
import { afterEach, describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as pruefungRaw from "../../scripts/codex-vorpruefung.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as setupRaw from "../../scripts/codex-setup.mjs";

type Config = { repo: string; agenten: Record<string, string> };
type Obs = { id: string; type: string; tags: string[]; sessionId: string; metadata: Record<string, string>; usageDetails: Record<string, number> };
type Belege = { version: string; sessionId: string; rollen: string[]; tools: string[]; observations: Obs[] };
const c = raw as unknown as {
  setupDateien: (mcp: unknown, config: unknown, url: string) => Record<string, string>;
  schreibeSetup: (root: string, dateien: Record<string, string>) => string[];
  bewerteBelege: (b: unknown, config: Config) => string[];
};
const config: Config = { repo: "owner/probe", agenten: { planer: "probe-planer", umsetzer: "probe-umsetzer", lens: "probe-lens", gruppe: "probe-gruppe" } };
const mcp = { mcpServers: { playwright: { command: "npx", args: ["-y", "@playwright/mcp@0.0.83", "--isolated"] } } };
const temp: string[] = [];
const frisch = () => { const p = mkdtempSync(join(tmpdir(), "codex-probe-")); temp.push(p); return p; };
afterEach(() => { for (const p of temp.splice(0)) rmSync(p, { recursive: true, force: true }); });
const obs = (id: string, role: string): Obs => ({ id, type: "GENERATION", tags: ["project:probe"], sessionId: "probe-session", metadata: { agent_role: role, agent_id: id, parent_thread_id: role === "main" ? "" : "main" }, usageDetails: { input: 3, output: 2 } });
const belege = (): Belege => ({ version: "0.164.0", sessionId: "probe-session", rollen: ["probe-planer", "probe-umsetzer", "probe-lens", "probe-gruppe", "explore", "holdout-szenario", "holdout-abnahme"], tools: ["playwright", "langfuse"], observations: [obs("main", "main"), obs("child", "subagent"), { ...obs("tool", "main"), type: "TOOL" }] });

describe("reproduzierbares Codex-Setup", () => {
  test("native Rollen lesen gemeinsame Quellen, Playwright kommt aus .mcp.json", () => {
    const files = c.setupDateien(mcp, config, "https://mcp.example.test/langfuse");
    expect(Object.keys(files)).toHaveLength(9);
    expect(files[".codex/agents/probe-planer.toml"]).toContain(".claude/agents/factory-planer.md");
    expect(files[".codex/agents/holdout-abnahme.toml"]).toContain("name = \"holdout-abnahme\"");
    expect(files[".codex/config.toml"]).toContain('args = ["-y","@playwright/mcp@0.0.83","--isolated"]');
    expect(files[".codex/config.toml"]).toContain("required = true");
    expect(files[".codex/config.toml"]).toContain('bearer_token_env_var = "LANGFUSE_MCP_TOKEN"');
    expect(files[".codex/berechtigungen.toml.example"]).toContain('extends = ":workspace"');
    expect(Object.values(files).join("\n")).not.toMatch(/model =|danger-full-access|approval_policy = "never"|\.Codex\//);
  });
  test.each(["file:///tmp/server", "http://public.example.test", "https://user:secret@example.test", "https://example.test/?token=secret", "https://example.test/#secret", "garbage"])("lehnt ungeeigneten MCP-Endpunkt ab: %s", (url) => {
    expect(() => c.setupDateien(mcp, config, url)).toThrow();
  });
  test("lokaler HTTP-MCP und abweichende Playwright-Argumente sind möglich", () => {
    const other = { mcpServers: { playwright: { command: "runner", args: ["--probe"] } } };
    expect(c.setupDateien(other, config, "http://127.0.0.1:8080/mcp")[".codex/config.toml"]).toContain('command = "runner"');
  });
  test.each([{}, { mcpServers: { playwright: { command: 4, args: [] } } }, { mcpServers: { playwright: { command: "npx", args: [4] } } }])("fehlende/kaputte gemeinsame MCP-Quelle stoppt", (broken) => {
    expect(() => c.setupDateien(broken, config, "https://example.test/mcp")).toThrow();
  });
  test("fehlender oder unsicherer Rollenname stoppt", () => {
    expect(() => c.setupDateien(mcp, { ...config, agenten: {} }, "https://example.test/mcp")).toThrow();
    expect(() => c.setupDateien(mcp, { ...config, agenten: { ...config.agenten, planer: "../escape" } }, "https://example.test/mcp")).toThrow();
    expect(() => c.setupDateien(mcp, { ...config, agenten: { ...config.agenten, planer: "probe-lens" } }, "https://example.test/mcp")).toThrow();
    expect(() => c.setupDateien(mcp, { ...config, agenten: { ...config.agenten, planer: "a".repeat(65) } }, "https://example.test/mcp")).toThrow();
  });
  test.each([undefined, 4, "", "Planer", "planer_", "1planer"])("fehlende Rollentabelle/ungültiger Rollenwert %s stoppt", (wert) => {
    const cfg = wert === undefined ? { repo: config.repo } : { ...config, agenten: { ...config.agenten, planer: wert } };
    expect(() => c.setupDateien(mcp, cfg, "https://example.test/mcp")).toThrow(/Rollenname/);
  });
  test.each(["a", "a".repeat(64)])("Rollenlänge an erlaubter Grenze %s", (name) => {
    expect(c.setupDateien(mcp, { ...config, agenten: { ...config.agenten, planer: name } }, "https://example.test/mcp")).toHaveProperty(`.codex/agents/${name}.toml`);
  });
  test.each([{ command: "", args: [] }, { command: "npx" }, { command: "npx", args: null }, { command: "npx", args: "args" }])("leerer Befehl oder fehlendes Args-Array stoppt", (p) => {
    expect(() => c.setupDateien({ mcpServers: { playwright: p } }, config, "https://example.test/mcp")).toThrow(/Playwright/);
  });
  test.each(["https://user@example.test/mcp", "https://:secret@example.test/mcp"])("einzelne Credential-Komponente wird abgelehnt", (url) => {
    expect(() => c.setupDateien(mcp, config, url)).toThrow(/Zugangsdaten/);
  });
  test.each(["http://localhost:8080/mcp", "http://[::1]:8080/mcp"])("lokaler MCP %s ist konfigurierbar", (url) => {
    expect(c.setupDateien(mcp, config, url)[".codex/config.toml"]).toContain(`url = "${url}"`);
  });
  test("frisches Setup ist idempotent; lokaler Entwurf verhindert alle Schreibvorgänge", () => {
    const root = frisch();
    expect(c.schreibeSetup(root, { ".codex/a": "a", ".codex/b": "b" })).toHaveLength(2);
    expect(c.schreibeSetup(root, { ".codex/a": "a" })).toEqual([]);
    writeFileSync(join(root, ".codex/a"), "lokaler Entwurf");
    expect(() => c.schreibeSetup(root, { ".codex/b": "neu", ".codex/a": "a" })).toThrow(/Entwurf/);
    expect(readFileSync(join(root, ".codex/b"), "utf8")).toBe("b");
    expect(() => c.schreibeSetup(root, { ".codex/new-first": "neu", ".codex/a": "a" })).toThrow(/Entwurf/);
    expect(existsSync(join(root, ".codex/new-first"))).toBe(false);
  });
  test("Setup folgt keinen Symlinks und akzeptiert keine fremden Zielpfade", () => {
    const root = frisch();
    mkdirSync(join(root, ".codex"));
    expect(() => c.schreibeSetup(root, { "../escape": "x" })).toThrow();
    expect(() => c.schreibeSetup(root, { ".codex/../escape": "x" })).toThrow();
    expect(existsSync(join(root, "escape"))).toBe(false);
    expect(() => c.schreibeSetup(root, { ".codex/invalid?": "x" })).toThrow();
    const linkRoot = frisch();
    symlinkSync(root, join(linkRoot, ".codex"), "junction");
    expect(() => c.schreibeSetup(linkRoot, { ".codex/probe": "x" })).toThrow(/Symlink/);
    const deep = frisch(); mkdirSync(join(deep, ".codex")); symlinkSync(root, join(deep, ".codex/agents"), "junction");
    expect(() => c.schreibeSetup(deep, { ".codex/agents/probe": "x" })).toThrow(/Symlink/);
  });
});

describe("Codex-Belegdiagnose", () => {
  test("vollständige diagnostische Fixture, keine autonome Freigabe", () => {
    expect(c.bewerteBelege(belege(), config)).toEqual([]);
  });
  test.each([null, {}, true, { tracing: true }])("fehlende oder selbst attestierte Belege reichen nicht", (b) => {
    expect(c.bewerteBelege(b, config).length).toBeGreaterThan(0);
  });
  test("unbekannte Runtime, fehlende Rolle und fehlender MCP werden einzeln gemeldet", () => {
    const b = belege(); b.version = "0.1.0"; b.rollen = []; b.tools = [];
    expect(c.bewerteBelege(b, config)).toContain("Laufzeit nicht geprüft: erwartet Codex CLI 0.164.0");
    expect(c.bewerteBelege(b, config)).toContain("Rolle fehlt im Laufzeitinventar: probe-planer");
    expect(c.bewerteBelege(b, config)).toContain("MCP fehlt im Laufzeitinventar: playwright");
  });
  test("Versionsfehler wird bei ansonsten vollständigen Belegen separat erkannt", () => {
    expect(c.bewerteBelege({ ...belege(), version: "0.1.0" }, config)).toEqual(["Laufzeit nicht geprüft: erwartet Codex CLI 0.164.0"]);
  });
  test.each([{ rollen: 4 }, { tools: {} }, { observations: "keine Liste" }])("Nichtarray-Inventar wird abgelehnt", (override) => {
    expect(c.bewerteBelege({ ...belege(), ...override }, config).length).toBeGreaterThan(0);
  });
  test.each([undefined, null, {}, { input: 1, output: 0 }, { input: 1, output: -1 }, { input: "1", output: 2 }, { input: 1, output: Infinity }, { input: NaN, output: 2 }])("fehlender oder ungültiger Verbrauch wird abgelehnt", (usageDetails) => {
    const b = belege(); const observations = b.observations.map(o => ({ ...o, usageDetails }));
    expect(c.bewerteBelege({ ...b, observations }, config).join("\n")).toContain("Hauptagent");
  });
  test("Input null Tokens ist gültig", () => {
    const b = belege(); b.observations[0].usageDetails.input = 0;
    expect(c.bewerteBelege(b, config)).toEqual([]);
  });
  test.each([null, { id: undefined }, { id: 4 }, { id: "" }, { metadata: undefined }, { metadata: {} }, { tags: "project:probe" }])("unvollständige Observation wird verworfen", (override) => {
    const b = belege(); const first = override === null ? null : { ...b.observations[0], ...override };
    expect(c.bewerteBelege({ ...b, observations: [first, ...b.observations.slice(1)] }, config).join("\n")).toContain("Hauptagent");
  });
  test.each([undefined, "", 4])("fehlende oder ungültige Session stoppt", (sessionId) => {
    expect(c.bewerteBelege({ ...belege(), sessionId }, config).join("\n")).toContain("Hauptagent");
  });
  test("leere Hauptidentität und identische Eltern-/Kindidentität reichen nicht", () => {
    const b = belege(); b.observations[0].metadata.agent_id = "";
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Hauptagent");
    b.observations[0].metadata.agent_id = "main"; b.observations[1].metadata.agent_id = "main";
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Subagent");
  });
  test.each(["main", "subagent", "TOOL"])("fehlender %s-Nachweis stoppt", (which) => {
    const b = belege(); b.observations = b.observations.filter(o => which === "TOOL" ? o.type !== "TOOL" : !(o.type === "GENERATION" && o.metadata.agent_role === which));
    expect(c.bewerteBelege(b, config).join("\n")).toMatch(/Langfuse/);
  });
  test("Spawn-Tool, falsches Repo, leere Usage und nicht verknüpfte Subs reichen nicht", () => {
    const b = belege(); b.observations[1].metadata.parent_thread_id = "fremd";
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Subagent");
    b.observations = b.observations.map(o => ({ ...o, tags: ["project:fremd"] }));
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Langfuse");
    b.observations = belege().observations.map(o => ({ ...o, usageDetails: {} }));
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Langfuse");
  });
  test("fremde Session, fehlende Identität und ungültiger Verbrauch werden erkannt", () => {
    const b = belege(); b.sessionId = "fremd";
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Langfuse");
    b.sessionId = "probe-session"; delete b.observations[0].metadata.agent_id;
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Hauptagent");
    b.observations = belege().observations.map(o => ({ ...o, usageDetails: { input: -1, output: 2 } }));
    expect(c.bewerteBelege(b, config).join("\n")).toContain("Hauptagent");
  });
  test("Subagent braucht eine eigene nichtleere String-Identität", () => {
    const b = belege(); delete b.observations[1].metadata.agent_id;
    expect(c.bewerteBelege(b, config)).toContain("Langfuse: verknüpfter Subagent mit eigenem Verbrauch fehlt");
    b.observations[1].metadata.agent_id = "";
    expect(c.bewerteBelege(b, config)).toContain("Langfuse: verknüpfter Subagent mit eigenem Verbrauch fehlt");
    Reflect.set(b.observations[1].metadata, "agent_id", 4);
    expect(c.bewerteBelege(b, config)).toContain("Langfuse: verknüpfter Subagent mit eigenem Verbrauch fehlt");
  });
});

describe("Codex-Einstiege", () => {
  const p = pruefungRaw as unknown as { main: (args: string[], out: (s: string) => void, err: (s: string) => void, lade: () => Config) => number };
  const s = setupRaw as unknown as { main: (args: string[], root: string, out: (s: string) => void, err: (s: string) => void) => number };
  test("Vorprüfung stoppt ohne Belege und selbst mit vollständiger Fixture", () => {
    const out: string[] = []; const err: string[] = [];
    expect(p.main([], x => out.push(x), x => err.push(x), () => config)).toBe(1);
    const datei = join(frisch(), "belege.json"); writeFileSync(datei, JSON.stringify(belege()));
    expect(p.main(["--belege", datei], x => out.push(x), x => err.push(x), () => config)).toBe(1);
    expect(out.at(-1)).toContain('"autonom":false');
    expect(out.at(-1)).toContain("Quarantäne");
    expect(err).toEqual([]);
  });
  test("unbekannte Flags, fehlende und kaputte Dateien schließen", () => {
    const out: string[] = []; const err: string[] = [];
    expect(p.main(["--issue", "79"], x => out.push(x), x => err.push(x), () => config)).toBe(2);
    expect(p.main(["--belege", join(frisch(), "fehlt")], x => out.push(x), x => err.push(x), () => config)).toBe(1);
    const datei = join(frisch(), "kaputt"); writeFileSync(datei, "{");
    expect(p.main(["--belege", datei], x => out.push(x), x => err.push(x), () => config)).toBe(1);
    expect(out).toEqual([]);
    expect(err).toHaveLength(3);
    expect(p.main([], x => out.push(x), x => err.push(x), () => { throw new Error("Config unlesbar"); })).toBe(1);
    expect(err.at(-1)).toContain("Config unlesbar");
  });
  test("Setup-Aufruffehler und fehlende Quelle schreiben nichts", () => {
    const out: string[] = []; const err: string[] = []; const root = frisch();
    expect(s.main([], root, x => out.push(x), x => err.push(x))).toBe(2);
    expect(s.main(["--langfuse-url", "https://example.test/mcp"], root, x => out.push(x), x => err.push(x))).toBe(1);
    expect(out).toEqual([]); expect(err).toHaveLength(2);
  });
  test("frischer Setup-CLI-Lauf erzeugt native Dateien erst mit --write", () => {
    const root = frisch(); mkdirSync(join(root, ".factory"));
    writeFileSync(join(root, ".factory/projekt.json"), readFileSync(".factory/projekt.json", "utf8"));
    writeFileSync(join(root, ".mcp.json"), JSON.stringify(mcp));
    const out: string[] = []; const err: string[] = []; const args = ["--langfuse-url", "https://example.test/mcp"];
    expect(s.main(args, root, x => out.push(x), x => err.push(x))).toBe(0);
    expect(out.at(-1)).toContain('"geschrieben":false');
    expect(existsSync(join(root, ".codex"))).toBe(false);
    expect(s.main([...args, "--write"], root, x => out.push(x), x => err.push(x))).toBe(0);
    expect(readFileSync(join(root, ".codex/config.toml"), "utf8")).toContain("mcp_servers.playwright");
    expect(s.main([...args, "--write"], root, x => out.push(x), x => err.push(x))).toBe(0);
    expect(out.at(-1)).toContain('"dateien":[]'); expect(err).toEqual([]);
    writeFileSync(join(root, ".codex/config.toml"), "lokaler Entwurf");
    expect(s.main([...args, "--write"], root, x => out.push(x), x => err.push(x))).toBe(1);
    expect(err.at(-1)).toContain("Entwurf");
  });
});
