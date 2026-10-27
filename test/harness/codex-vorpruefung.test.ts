/* @harness-waechter: Der Prototyp schaltet auch durch Offline-Belege keine autonomen Läufe frei. */
import { afterEach, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-vorpruefung.mjs";
const p = raw as unknown as { main: (a: string[], o: (s: string) => void, e: (s: string) => void, l: () => unknown) => number };
const config = { repo: "owner/probe", agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g" } };
const temps: string[] = [];
afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });
function datei(text: string) { const d = mkdtempSync(join(tmpdir(), "codex-vorpruefung-")); temps.push(d); const p = join(d, "belege.json"); writeFileSync(p, text); return p; }
test("ohne und mit selbst attestierten Belegen gesperrt", () => {
  const out: string[] = [], err: string[] = [];
  expect(p.main([], s => out.push(s), s => err.push(s), () => config)).toBe(1);
  expect(p.main(["--belege", datei('{"tracing":true}')], s => out.push(s), s => err.push(s), () => config)).toBe(1);
  expect(out.at(-1)).toContain('"autonom":false'); expect(out.at(-1)).toContain("Quarantäne"); expect(err).toEqual([]);
});
test("auch vollständige diagnostische Belege erteilen keine autonome Freigabe", () => {
  const rollen = [...Object.values(config.agenten), "explore", "holdout-szenario", "holdout-abnahme"];
  const row = (id: string, rolle?: string) => ({ id, type: "GENERATION", sessionId: "probe", tags: ["project:probe"], usageDetails: { input: 1, output: 1 }, metadata: { agent_id: id, agent_role: rolle ? "subagent" : "main", parent_thread_id: rolle ? "main" : "", "agent_source.subagent.thread_spawn.agent_role": rolle } });
  const b = { version: "0.164.0", sessionId: "probe", rollen, tools: ["playwright", "langfuse"], observations: [row("main"), ...rollen.map(r => row(r, r)), { ...row("tool"), type: "TOOL" }] };
  const out: string[] = [], err: string[] = [];
  expect(p.main(["--belege", datei(JSON.stringify(b))], s => out.push(s), s => err.push(s), () => config)).toBe(1);
  const result = JSON.parse(out[0]) as { autonom: boolean; maengel: string[] };
  expect(result.autonom).toBe(false); expect(result.maengel).toHaveLength(1); expect(result.maengel[0]).toContain("Quarantäne"); expect(err).toEqual([]);
});
test("Aufruf-, Lese-, JSON- und Configfehler sind geschlossen", () => {
  const out: string[] = [], err: string[] = [];
  expect(p.main(["--issue", "79"], s => out.push(s), s => err.push(s), () => config)).toBe(2);
  expect(p.main(["--belege", `${datei("{}")}fehlt`], s => out.push(s), s => err.push(s), () => config)).toBe(1);
  expect(p.main(["--belege", datei("{")], s => out.push(s), s => err.push(s), () => config)).toBe(1);
  expect(p.main([], s => out.push(s), s => err.push(s), () => { throw new Error("Config unlesbar"); })).toBe(1);
  expect(out).toEqual([]); expect(err).toHaveLength(4);
});
