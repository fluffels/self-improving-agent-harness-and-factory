/* Doctor-Punkt `Modell-Routing` (factory#150): die Prüffunktionen aus modell-routing-lib.mjs und der Punkt mit injiziertem `lies` und `liste`.
 * Bewusst unter test/ statt test/harness/ (Vorbild harness-doctor-leitplanken.test.ts). Fixture-Modelle stehen als Alias, ein Pin nur als Zeichenkette zusammengesetzt. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { MODELL_ALIASE as rawAliase, doppelteNamen as rawNamen, projektAgentFunde as rawAgent, routingPfade as rawPfade } from "../scripts/modell-routing-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { modellRoutingPunkt as rawPunkt } from "../scripts/harness-doctor-dateien.mjs";

interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string; hinweis?: string }
type Lies = (p: string) => string | null;
type Liste = (o: string) => string[] | null;
const aliase = rawAliase as readonly string[];
const namen = rawNamen as (e: { pfad: string; name?: string }[]) => string[];
const agentFunde = rawAgent as (fm: Record<string, string>, pfad: string) => string[];
const pfade = rawPfade as (l: Liste) => string[];
const punkt = rawPunkt as (e: { lies: Lies; liste: Liste }) => Ergebnis;

const agent = (name: string, model = "sonnet", effort = "medium") => `---\nname: ${name}\nmodel: ${model}\neffort: ${effort}\n---\nText\n`;
const MANIFEST = JSON.stringify({ version: 3, eintraege: [{ pfad: ".claude/agents/kern.md", ring: "kern" }] });
const TABELLE = "| Projekt-Phase | Alias | Effort Skill-Pfad | Skill-Pfad |\n|---|---|---|---|\n| Eigene | `sonnet` | `medium` | Subagent `projekt`, gespawnt |\n";

/** Gesundes Fixture: Dateien als Pfad → Text; `liste` leitet die Ordnerinhalte daraus ab (ein Ordner ohne Dateien ist `null`). */
const gesund = (): Record<string, string> => ({
  ".claude/settings.json": '{"model":"sonnet"}',
  ".claude/agents/projekt.md": agent("projekt"),
  ".claude/agents/kern.md": agent("kern", "inherit", "inherit"),
  ".factory/besitz.json": MANIFEST,
  "docs/model-routing.md": TABELLE,
});
const lauf = (dateien: Record<string, string | null>) => {
  const lies: Lies = (p) => dateien[p] ?? null;
  const liste: Liste = (o) => {
    const treffer = Object.keys(dateien).filter((p) => dateien[p] !== null && p.startsWith(o + "/")).map((p) => p.slice(o.length + 1).split("/")[0]);
    return treffer.length === 0 ? null : [...new Set(treffer)];
  };
  return punkt({ lies, liste });
};
const mit = (aend: Record<string, string | null>) => lauf({ ...gesund(), ...aend });

describe("Alias-Liste und (a) Projekt-Agent", () => {
  test("die geschlossene Liste", () => {
    expect([...aliase]).toEqual(["opus", "sonnet", "haiku", "fable"]);
  });
  test.each(["opus", "sonnet", "haiku", "fable"])("Alias %s ist ok", (a) => {
    expect(agentFunde({ model: a, effort: "low" }, "x.md")).toEqual([]);
  });
  test.each(["inherit", "opusplan", "best", "claude-opus-5", ""])("model %s ist eine Lücke", (m) => {
    expect(agentFunde({ model: m, effort: "low" }, "x.md")).toEqual([`(a) x.md: model=${m || "fehlt"}`]);
  });
  test("fehlender model:-Schlüssel ist eine Lücke", () => {
    expect(agentFunde({ effort: "low" }, "x.md")).toEqual(["(a) x.md: model=fehlt"]);
    const e = mit({ ".claude/agents/projekt.md": "---\nname: projekt\neffort: medium\n---\n" });
    expect(e.befund).toContain("(a) .claude/agents/projekt.md: model=fehlt");
  });
  test("effort: fehlt, leer und inherit sind Lücken", () => {
    expect(agentFunde({ model: "opus" }, "x.md")).toEqual(["(a) x.md: effort=fehlt"]);
    expect(agentFunde({ model: "opus", effort: "" }, "x.md")).toEqual(["(a) x.md: effort=fehlt"]);
    expect(mit({ ".claude/agents/projekt.md": "---\nname: projekt\nmodel: sonnet\neffort:\n---\n" }).befund).toContain("effort=fehlt");
    expect(agentFunde({ model: "opus", effort: "inherit" }, "x.md")).toEqual(["(a) x.md: effort=inherit"]);
  });
});

describe("(c) Namen", () => {
  test("eindeutig: kein Fund", () => {
    expect(namen([{ pfad: "a", name: "x" }, { pfad: "b", name: "y" }])).toEqual([]);
  });
  test("doppelt über zwei Dateien", () => {
    expect(namen([{ pfad: "p1", name: "x" }, { pfad: "p2", name: "x" }])).toEqual(["(c) name „x“ doppelt: p1, p2"]);
  });
  test("Datei ohne name:", () => {
    expect(namen([{ pfad: "p1" }])).toEqual(["(c) p1 ohne name:"]);
  });
  test("zwei Dateien ohne name: je ein Fund, nie als doppelter Name gezählt", () => {
    expect(namen([{ pfad: "p1" }, { pfad: "p2" }])).toEqual(["(c) p1 ohne name:", "(c) p2 ohne name:"]);
  });
});

describe("routingPfade", () => {
  const orte: Record<string, string[]> = { ".claude/agents": ["a.md", "b.txt"], ".claude/skills": ["s"], ".agents/skills": ["q"], ".claude/workflows": ["w.mjs", "w.md", "v.ts", "w.xjs"] };
  test("alle fünf Orte, nur die passenden Endungen", () => {
    expect(pfade((o) => orte[o] ?? null)).toEqual([".claude/settings.json", ".claude/agents/a.md", ".claude/skills/s/SKILL.md", ".agents/skills/q/SKILL.md", ".claude/workflows/w.mjs", ".claude/workflows/v.ts"]);
  });
  test("ein fehlender Ordner fällt still raus", () => {
    expect(pfade(() => null)).toEqual([".claude/settings.json"]);
  });
});

describe("Punkt Modell-Routing", () => {
  test("eine Nicht-Agent-Datei unter .claude/agents (kein .md) zählt nicht", () => {
    expect(mit({ ".claude/agents/notizen.txt": "kein Agent" }).ok).toBe(true);
  });
  test("ein Null-Eintrag im Manifest wirft nicht, der Rest zählt", () => {
    const m = JSON.stringify({ eintraege: [null, { pfad: ".claude/agents/kern.md" }] });
    expect(mit({ ".factory/besitz.json": m }).ok).toBe(true);
  });
  test("gesund: OK; der Besitz-Agent mit inherit zählt nicht (Manifest wird gelesen)", () => {
    const e = lauf(gesund());
    expect(e).toMatchObject({ punkt: "Modell-Routing", ok: true });
    expect(e.hinweis).toBeUndefined();
  });
  test.each([
    ["(a)", { ".claude/agents/projekt.md": agent("projekt", "inherit") }, "(a) .claude/agents/projekt.md: model=inherit"],
    ["(a) effort", { ".claude/agents/projekt.md": "---\nname: projekt\nmodel: sonnet\n---\n" }, "(a) .claude/agents/projekt.md: effort=fehlt"],
    ["(b)", { ".agents/skills/x/SKILL.md": "---\nmodel: claude-opus-5\n---\n" }, "(b) .agents/skills/x/SKILL.md"],
    ["(c)", { ".claude/agents/projekt.md": agent("kern") }, "(c) name „kern“ doppelt"],
    ["(d)", { ".claude/settings.json": '{"model":"opus"}' }, '(d) model="opus"'],
    ["(e)", { "docs/model-routing.md": TABELLE.replace("`medium` |", "`high` |") }, "(e) Eigene: Effort „high“"],
  ] as [string, Record<string, string>, string][])("Teilregel %s: genau diese Lücke samt Fix", (k, aend, text) => {
    const fixTeil: Record<string, string> = { "(a)": "Projekt-Agenten unter", "(b)": "feste Modell-IDs", "(c)": "eigenen `name:`", "(d)": "`model` genau `sonnet`", "(e)": "Tabelle Projekt-Phase" };
    const e = mit(aend);
    expect(e.ok).toBe(false);
    expect(e.nichtPruefbar).toBeFalsy();
    expect(e.befund).toContain(text);
    const fix = e.fix ?? "";
    expect(fix).not.toContain("npm run");
    expect(fix).not.toMatch(/;\s*$/);
    for (const [kk, teil] of Object.entries(fixTeil)) expect(fix.includes(teil), `${k}: Fix ${kk}`).toBe(k.startsWith(kk) || (k.startsWith("(a)") && kk === "(e)")); // ein Alias-Fund im Agenten bricht auch die Tabelle Projekt-Phase
  });
  test("settings.json fehlt: Lücke (d)", () => {
    const e = mit({ ".claude/settings.json": null });
    expect(e.ok).toBe(false);
    expect(e.nichtPruefbar).toBeFalsy();
    expect(e.befund).toContain("(d) .claude/settings.json fehlt");
  });
  test("settings.json kein JSON: nicht prüfbar mit Fix", () => {
    const e = mit({ ".claude/settings.json": "{ kaputt" });
    expect(e).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(e.befund).toContain("(d)");
    expect(e.fix).toBeTruthy();
  });
  test.each(["[]", "5", "null"])("settings.json mit %s (kein Objekt): nicht prüfbar, kein Wurf", (text) => {
    expect(mit({ ".claude/settings.json": text })).toMatchObject({ ok: false, nichtPruefbar: true });
  });
  test(".claude/agents fehlt: nicht prüfbar mit Fix", () => {
    const e = lauf({ ".claude/settings.json": '{"model":"sonnet"}' });
    expect(e).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(e.fix).toBeTruthy();
  });
  test.each([
    ["fehlt", null],
    ["kein JSON", "{ kaputt"],
    ["ohne eintraege", "{}"],
  ] as [string, string | null][])("Manifest %s: nicht prüfbar, der Grund nennt (a)", (_n, text) => {
    const e = mit({ ".factory/besitz.json": text });
    expect(e).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(e.befund).toContain("(a)");
    expect(e.fix).toContain(".factory/besitz.json");
  });
  test("Manifest unlesbar und doppelter Name: Lücke, nennt (c) und nicht prüfbar", () => {
    const e = mit({ ".factory/besitz.json": null, ".claude/agents/projekt.md": agent("kern") });
    expect(e).toMatchObject({ ok: false });
    expect(e.nichtPruefbar).toBeFalsy();
    expect(e.befund).toContain("(c)");
    expect(e.befund).toContain("nicht prüfbar");
    expect(e.fix).toContain(".factory/besitz.json");
    expect(e.fix).toContain("eigenen `name:`");
  });
  test("eine Agentendatei nicht lesbar: kein Wurf, nicht prüfbar", () => {
    const lies: Lies = (p) => (p === ".claude/agents/weg.md" ? null : (gesund()[p] ?? null));
    const liste: Liste = (o) => (o === ".claude/agents" ? ["projekt.md", "kern.md", "weg.md"] : null);
    const e = punkt({ lies, liste });
    expect(e).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(e.befund).toContain(".claude/agents/weg.md nicht lesbar");
    expect(e.fix).toContain(".claude/agents/weg.md");
  });
  test(".claude/agents fehlt plus Fund in (d): LÜCKE, nennt die nicht prüfbaren Teile (a) und (c)", () => {
    const lies: Lies = (p) => (p === ".claude/settings.json" ? '{"model":"opus"}' : p === ".factory/besitz.json" ? MANIFEST : null);
    const e = punkt({ lies, liste: () => null });
    expect(e.ok).toBe(false);
    expect(e.nichtPruefbar).toBeFalsy();
    expect(e.befund).toContain('(d) model="opus"');
    expect(e.befund).toContain(".claude/agents fehlt oder ist nicht lesbar: (a) und (c) nicht prüfbar");
    expect(e.fix).toContain(".claude/agents anlegen");
  });
  test(".claude/agents fehlt: (b) und (e) laufen trotzdem", () => {
    const pin = "---\nmodel: claude-" + "opus-5\n---\n";
    const liesB: Lies = (p) => (p === ".agents/skills/x/SKILL.md" ? pin : p === ".claude/settings.json" ? '{"model":"sonnet"}' : null);
    const b = punkt({ lies: liesB, liste: (o) => (o === ".agents/skills" ? ["x"] : null) });
    expect(b.ok).toBe(false);
    expect(b.nichtPruefbar).toBeFalsy();
    expect(b.befund).toContain("(b) .agents/skills/x/SKILL.md");
    const liesE: Lies = (p) => (p === "docs/model-routing.md" ? TABELLE : p === ".claude/settings.json" ? '{"model":"sonnet"}' : null);
    const e = punkt({ lies: liesE, liste: () => null });
    expect(e.ok).toBe(false);
    expect(e.nichtPruefbar).toBeFalsy();
    expect(e.befund).toContain("(e) Eigene: Agentendatei .claude/agents/projekt.md fehlt");
  });
  test("der Fix eines (a)-Funds nennt jeden Alias der geschlossenen Liste", () => {
    const fix = mit({ ".claude/agents/projekt.md": agent("projekt", "inherit") }).fix ?? "";
    for (const a of aliase) expect(fix).toContain(a);
  });
  test("(b) Grenze: nur Workflow-Skripte direkt im Ordner zählen, der Fix nennt genau diesen Umfang", () => {
    const pin = "model: claude-" + "opus-5\n";
    expect(mit({ ".claude/workflows/demo.js": pin }).befund).toContain("(b) .claude/workflows/demo.js");
    for (const unsichtbar of [".claude/workflows/demo.md", ".claude/workflows/demo.yml", ".claude/workflows/sub/x.js"]) expect(mit({ [unsichtbar]: pin }).ok, unsichtbar).toBe(true);
    expect(mit({ ".claude/workflows/demo.js": pin }).fix).toContain(".js, .mjs, .ts direkt in .claude/workflows");
  });
  test("der Fix eines (b)-Funds nennt jeden Alias der geschlossenen Liste", () => {
    const fix = mit({ ".agents/skills/x/SKILL.md": "---\nmodel: claude-" + "opus-5\n---\n" }).fix ?? "";
    for (const a of aliase) expect(fix).toContain(a);
  });
  test("(e) Tabelle nennt einen Subagenten ohne Agentendatei: der Fund sagt, dass die Datei fehlt", () => {
    const e = mit({ "docs/model-routing.md": TABELLE.replace("Subagent `projekt`", "Subagent `weg`") });
    expect(e.befund).toContain("Agentendatei .claude/agents/weg.md fehlt");
  });
  test("docs/model-routing.md fehlt: OK mit Hinweis; ein Anker-Stub ohne Tabelle: OK ohne Hinweis", () => {
    const ohneSeite = mit({ "docs/model-routing.md": null });
    expect(ohneSeite.ok).toBe(true);
    expect(ohneSeite.hinweis).toContain("(e)");
    expect(mit({ "docs/model-routing.md": "# Stub\n" })).toMatchObject({ ok: true });
    expect(mit({ "docs/model-routing.md": "# Stub\n" }).hinweis).toBeUndefined();
  });
});
