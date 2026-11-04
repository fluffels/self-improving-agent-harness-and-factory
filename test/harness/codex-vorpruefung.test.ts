/* @harness-waechter: Der Prototyp schaltet auch durch Offline-Belege keine autonomen Läufe frei. */
import { afterEach, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-vorpruefung.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as lib0 from "../../scripts/codex-lib.mjs";
const p = raw as unknown as { main: (a: string[], o: (s: string) => void, e: (s: string) => void, l: () => unknown, root?: string) => number };
const config = { repo: "owner/probe", agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g" } };
const temps: string[] = [];
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });
/** Wurzel ohne `.codex/agents` und `.mcp.json`: die Tests lesen nie den ungetrackten Zustand des Checkouts. */
function leerRoot() { const d = mkdtempSync(join(tmpdir(), "codex-leer-")); temps.push(d); return d; }
function datei(text: string) { const d = mkdtempSync(join(tmpdir(), "codex-vorpruefung-")); temps.push(d); const p = join(d, "belege.json"); writeFileSync(p, text); return p; }
test("ohne und mit selbst attestierten Belegen gesperrt", () => {
  const out: string[] = [], err: string[] = [];
  expect(p.main([], s => out.push(s), s => err.push(s), () => config, leerRoot())).toBe(1);
  expect(p.main(["--belege", datei('{"tracing":true}')], s => out.push(s), s => err.push(s), () => config, leerRoot())).toBe(1);
  expect(out.at(-1)).toContain('"autonom":false'); expect(out.at(-1)).toContain("Quarantäne"); expect(err).toEqual([]);
});
test("auch vollständige diagnostische Belege erteilen keine autonome Freigabe", () => {
  const rollen = [...Object.values(config.agenten), "explore", "holdout-szenario", "holdout-abnahme"];
  const row = (id: string, rolle?: string) => ({ id, type: "GENERATION", sessionId: "probe", tags: ["project:probe"], usageDetails: { input: 1, output: 1 }, metadata: { agent_id: id, agent_role: rolle ? "subagent" : "main", parent_thread_id: rolle ? "main" : "", "agent_source.subagent.thread_spawn.agent_role": rolle } });
  const b = { version: "0.164.0", sessionId: "probe", rollen, tools: ["playwright", "langfuse"], observations: [row("main"), ...rollen.map(r => row(r, r)), { ...row("tool"), type: "TOOL" }] };
  const out: string[] = [], err: string[] = [];
  expect(p.main(["--belege", datei(JSON.stringify(b))], s => out.push(s), s => err.push(s), () => config, leerRoot())).toBe(1);
  const result = JSON.parse(out[0]) as { autonom: boolean; maengel: string[] };
  expect(result.autonom).toBe(false); expect(result.maengel).toHaveLength(1); expect(result.maengel[0]).toContain("Quarantäne"); expect(err).toEqual([]);
});
const mcp = { mcpServers: { playwright: { command: "npx", args: ["x"] } } };
const lib = lib0 as unknown as { lokaleRollenMaengel: (r: string, c: unknown, m: unknown) => string[]; setupDateien: (m: unknown, c: unknown, e: string) => Record<string, string> };
function projekt(rollen: Record<string, string>) {
  const d = mkdtempSync(join(tmpdir(), "codex-rollen-")); temps.push(d);
  mkdirSync(join(d, ".codex", "agents"), { recursive: true }); writeFileSync(join(d, ".mcp.json"), JSON.stringify(mcp));
  for (const [n, t] of Object.entries(rollen)) writeFileSync(join(d, ".codex", "agents", n), t);
  return d;
}
test("lokale Rollen: aktuell, veraltet, verwaist und fehlender Ordner", () => {
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
test("lokale Rollen: ein Ordner an der Stelle einer Rollen-Datei ist veraltet, kein Absturz", () => {
  const soll = Object.keys(lib.setupDateien(mcp, config, "http://localhost/")).filter(k => k.startsWith(".codex/agents/")).map(k => k.split("/").pop() as string);
  const d = projekt({}); mkdirSync(join(d, ".codex", "agents", soll[0]));
  const m = lib.lokaleRollenMaengel(d, config, mcp);
  expect(m).toHaveLength(1); expect(m[0]).toContain("veraltet"); expect(m[0]).toContain(soll[0]);
});
test("Vorprüfung meldet verwaiste Rolle in root", () => {
  const d = projekt({ "alt.toml": "x" }); const out: string[] = [];
  expect((p.main as unknown as (...a: unknown[]) => number)([], (s: string) => out.push(s), () => undefined, () => config, d)).toBe(1);
  expect((JSON.parse(out[0]) as { maengel: string[] }).maengel.join("\n")).toContain("verwaist");
});
test("Aufruf-, Lese-, JSON- und Configfehler sind geschlossen", () => {
  const out: string[] = [], err: string[] = [];
  expect(p.main(["--issue", "79"], s => out.push(s), s => err.push(s), () => config)).toBe(2);
  expect(p.main(["--belege", `${datei("{}")}fehlt`], s => out.push(s), s => err.push(s), () => config)).toBe(1);
  expect(p.main(["--belege", datei("{")], s => out.push(s), s => err.push(s), () => config)).toBe(1);
  expect(p.main([], s => out.push(s), s => err.push(s), () => { throw new Error("Config unlesbar"); })).toBe(1);
  expect(out).toEqual([]); expect(err).toHaveLength(4);
});
