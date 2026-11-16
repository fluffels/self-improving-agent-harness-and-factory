/* Aufrufstatistik (factory#519): Zählung aus Tool-Events, Genutzt-Hülle, Footprint, CLI über Fixture-Transkripte. */
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/aufrufstatistik-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawCli from "../scripts/aufrufstatistik.mjs";

type Zaehlung = { skripte: Record<string, number>; skills: Record<string, number>; agenten: Record<string, number> };
const lib = raw as unknown as {
  aufrufeAusEvents(e: { tool: string; input: Record<string, unknown> }[]): Zaehlung;
  summiere(l: Zaehlung[]): Zaehlung;
  skripteImText(t: string): string[];
  genutzteSkripte(a: { direkt: string[]; einstiege: string[]; besitzPfade: string[]; lies(p: string): string | null }): Set<string>;
  footprint(e: { pfad: string; ring: string; profil?: string }[], p: string, lies: (p: string) => string | null): { dateien: number; zeilen: number; kontextTokens: number };
  ungenutzteEinheiten(a: { eintraege: { pfad: string; ring: string }[]; genutzt: Set<string>; aufrufe: Zaehlung }): string[];
};
const cli = rawCli as unknown as { cli(argv: string[], o: { wurzel: string; out(s: string): void; err(s: string): void }): number };

const bash = (command: string) => ({ tool: "Bash", input: { command } });

describe("aufrufeAusEvents", () => {
  test("zählt node scripts/<x>.mjs, Skill und Agent; sonst nichts", () => {
    const z = lib.aufrufeAusEvents([
      bash("node scripts/a.mjs --x && node scripts/a.mjs"),
      bash("cd w && node /abs/pfad/scripts/b.mjs"),
      bash("grep scripts/c.mjs README.md"),
      bash("npx vitest run"),
      { tool: "Skill", input: { skill: "review-lenses" } },
      { tool: "Agent", input: { subagent_type: "lens-rolle" } },
      { tool: "Read", input: { file_path: "scripts/d.mjs" } },
    ]);
    expect(z.skripte).toEqual({ "scripts/a.mjs": 2, "scripts/b.mjs": 1 });
    expect(z.skills).toEqual({ "review-lenses": 1 });
    expect(z.agenten).toEqual({ "lens-rolle": 1 });
  });
  test("summiere addiert", () => {
    const a = lib.aufrufeAusEvents([bash("node scripts/a.mjs")]);
    expect(lib.summiere([a, a]).skripte).toEqual({ "scripts/a.mjs": 2 });
  });
});

describe("genutzteSkripte", () => {
  const besitz = ["scripts/a.mjs", "scripts/hook.mjs", "scripts/lib.mjs", "scripts/tief.mjs", "scripts/b.mjs", "scripts/gerufen.mjs"];
  const texte: Record<string, string> = {
    "scripts/a.mjs": 'import { x } from "./lib.mjs";',
    "scripts/lib.mjs": 'import { y } from "./tief";\nimport("./gerufen.mjs")',
    "scripts/hook.mjs": "export {};",
  };
  const lies = (p: string) => texte[p] ?? null;
  test("direkt, Hook-Einstieg und per Import Erreichbares sind genutzt, b nicht", () => {
    const g = lib.genutzteSkripte({ direkt: ["scripts/a.mjs"], einstiege: lib.skripteImText('{"args":["${DIR}/scripts/hook.mjs"]}'), besitzPfade: besitz, lies });
    expect([...g].sort()).toEqual(["scripts/a.mjs", "scripts/gerufen.mjs", "scripts/hook.mjs", "scripts/lib.mjs", "scripts/tief.mjs"]);
    expect(g.has("scripts/b.mjs")).toBe(false);
  });
  test("ein Zyklus bricht nicht ab", () => {
    const g = lib.genutzteSkripte({ direkt: ["scripts/a.mjs"], einstiege: [], besitzPfade: besitz, lies: (p) => (p === "scripts/a.mjs" ? 'import "./lib.mjs"' : 'import "./a.mjs"') });
    expect([...g].sort()).toEqual(["scripts/a.mjs", "scripts/lib.mjs"]);
  });
});

describe("footprint und ungenutzteEinheiten", () => {
  const E = [
    { pfad: "scripts/k.mjs", ring: "kern" },
    { pfad: "scripts/v.mjs", ring: "kern", profil: "voll" },
    { pfad: ".agents/skills/s/SKILL.md", ring: "kern", profil: "voll" },
    { pfad: ".claude/agents/ag.md", ring: "kern" },
  ];
  const texte: Record<string, string> = { "scripts/k.mjs": "a\nb\n", "scripts/v.mjs": "a\nb\nc\n", ".agents/skills/s/SKILL.md": "---\ndescription: abcd\n---\nx\n", ".claude/agents/ag.md": "---\ndescription: xy\n---\n", "AGENTS.md": "12345678" };
  const lies = (p: string) => texte[p] ?? null;
  test("minimal lässt voll-Einheiten und ihre Beschreibung weg, die Wurzel-Regeldatei bleibt", () => {
    const voll = lib.footprint(E, "voll", lies);
    const minimal = lib.footprint(E, "minimal", lies);
    expect(voll).toMatchObject({ dateien: 4, zeilen: 2 + 3 + 4 + 3 });
    expect(minimal).toMatchObject({ dateien: 2, zeilen: 2 + 3 });
    expect(minimal.kontextTokens).toBeLessThan(voll.kontextTokens);
    expect(minimal.kontextTokens).toBe(Math.ceil((8 + 2) / 4));
  });
  test("ungenutzt: Skripte ohne Aufruf, Skills und Agenten ohne Aufruf", () => {
    const u = lib.ungenutzteEinheiten({ eintraege: E, genutzt: new Set(["scripts/k.mjs"]), aufrufe: { skripte: {}, skills: {}, agenten: { "ag": 1 } } });
    expect(u).toEqual(["scripts/v.mjs", "skill:s"]);
    const mitSkill = lib.ungenutzteEinheiten({ eintraege: E, genutzt: new Set(["scripts/k.mjs"]), aufrufe: { skripte: {}, skills: { s: 1 }, agenten: { ag: 1 } } });
    expect(mitSkill).toEqual(["scripts/v.mjs"]);
  });
});

describe("CLI", () => {
  const temps: string[] = [];
  afterEach(() => {
    for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const zeile = (name: string, input: Record<string, unknown>, id: string) => JSON.stringify({ type: "assistant", timestamp: "2026-11-10T10:00:00Z", message: { id: `m${id}`, content: [{ type: "tool_use", id, name, input }] } });
  function fixture() {
    const wurzel = mkdtempSync(join(tmpdir(), "aufruf-"));
    temps.push(wurzel);
    mkdirSync(join(wurzel, ".factory"));
    mkdirSync(join(wurzel, "scripts"));
    writeFileSync(join(wurzel, ".factory/besitz.json"), JSON.stringify({ version: 3, eintraege: [
      { pfad: "scripts/a.mjs", ring: "kern", quelle: "t" },
      { pfad: "scripts/b.mjs", ring: "kern", quelle: "t" },
      { pfad: "scripts/hook.mjs", ring: "kern", quelle: "t" },
    ] }));
    for (const n of ["a", "b", "hook"]) writeFileSync(join(wurzel, "scripts", `${n}.mjs`), "export {};\n");
    mkdirSync(join(wurzel, ".claude"));
    writeFileSync(join(wurzel, ".claude/settings.json"), '{"hooks":{"x":[{"hooks":[{"args":["${CLAUDE_PROJECT_DIR}/scripts/hook.mjs"]}]}]}}');
    const t = join(wurzel, "transkripte");
    mkdirSync(t);
    writeFileSync(join(t, "alt.jsonl"), zeile("Bash", { command: "node scripts/b.mjs" }, "t0") + "\n");
    utimesSync(join(t, "alt.jsonl"), new Date("2026-10-01"), new Date("2026-10-01"));
    writeFileSync(join(t, "neu.jsonl"), [zeile("Bash", { command: "node scripts/a.mjs" }, "t1"), zeile("Skill", { skill: "s" }, "t2"), "{abgeschnitten"].join("\n"));
    return { wurzel, t };
  }
  const lauf = (argv: string[], wurzel: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = cli.cli(argv, { wurzel, out: (s) => out.push(s), err: (s) => err.push(s) });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  test("zählt, nennt UNGENUTZT und filtert mit --seit", () => {
    const { wurzel, t } = fixture();
    const alle = lauf(["--transkripte", t], wurzel);
    expect(alle.code).toBe(0);
    expect(alle.out).toContain("Sessions: 2");
    expect(alle.out).toMatch(/UNGENUTZT:\n\s+\(keine\)/);
    expect(alle.out).toMatch(/Genutzt über Einstieg oder Import:\n\s+scripts\/hook\.mjs/);
    for (const p of ["scripts/a.mjs", "scripts/b.mjs", "scripts/hook.mjs"]) expect(alle.out.split(p).length - 1, p).toBe(1);
    const neu = lauf(["--transkripte", t, "--seit", "2026-11-01"], wurzel);
    expect(neu.out).toContain("Sessions: 1");
    expect(neu.out).toMatch(/UNGENUTZT:\n\s+scripts\/b\.mjs/);
    expect(neu.out).not.toMatch(/ungenutzt:[\s\S]*scripts\/hook\.mjs/i);
  });
  test("Negativfall: ein Ordner ohne Sessions meldet fehlende Aufrufdaten mit Exit 1 statt einer Ungenutzt-Liste", () => {
    const { wurzel, t } = fixture();
    const leer = join(t, "leer");
    mkdirSync(leer);
    const r = lauf(["--transkripte", leer], wurzel);
    expect(r.code).toBe(1);
    expect(r.err).toContain("keine Aufrufdaten");
    expect(r.out).not.toContain("UNGENUTZT");
    expect(lauf(["--transkripte", t, "--seit", "2030-01-01"], wurzel).code).toBe(1);
  });
  test("--footprint allein misst ohne Transkripte; Subagenten-Events zählen mit, ein aufgerufener Skill ist nicht ungenutzt", () => {
    const { wurzel, t } = fixture();
    const nur = lauf(["--footprint"], wurzel);
    expect(nur.code).toBe(0);
    expect(nur.out).toMatch(/Footprint voll: 3 Dateien/);
    expect(nur.out).not.toContain("UNGENUTZT");
    const sub = join(t, "sess");
    mkdirSync(join(sub, "subagents"), { recursive: true });
    writeFileSync(join(t, "sess.jsonl"), zeile("Bash", { command: "echo" }, "t9") + "\n");
    writeFileSync(join(sub, "subagents", "a.jsonl"), zeile("Bash", { command: "node scripts/hook.mjs" }, "t8") + "\n");
    const j = JSON.parse(lauf(["--transkripte", t, "--json"], wurzel).out) as { aufrufe: Zaehlung };
    expect(j.aufrufe.skripte["scripts/hook.mjs"]).toBe(1);
  });
  test("--json und --footprint", () => {
    const { wurzel, t } = fixture();
    const j = JSON.parse(lauf(["--transkripte", t, "--json", "--footprint"], wurzel).out) as { aufrufe: Zaehlung; footprint: { voll: { dateien: number } } };
    expect(j.aufrufe.skripte["scripts/a.mjs"]).toBe(1);
    expect(j.footprint.voll.dateien).toBe(3);
  });
  test("Negativfall: fehlender Ordner, schlechtes Datum und fehlendes Flag sind Aufruf-Fehler", () => {
    const { wurzel, t } = fixture();
    expect(lauf(["--transkripte", join(t, "gibtsnicht")], wurzel).code).toBe(2);
    expect(lauf(["--transkripte", t, "--seit", "gestern"], wurzel).code).toBe(2);
    expect(lauf([], wurzel).code).toBe(2);
  });
});
