/* Output-Schätzung (#1568): Subagent-Transkripte zeichnen output_tokens beim Stand message_start auf (3 bis 8 je Nachricht). */
import { utimesSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/transkript-calls.mjs";

type Row = Record<string, unknown>;
type Call = { id: string; output: number; cost: number | null; outputSichtbar: number; outputGeschaetzt: number; costGeschaetzt: number | null; messageId: string };
const T = raw as unknown as {
  callsFromTranscript: (z: Row[]) => { calls: Call[] };
  eindeutigeCalls: (c: Call[]) => Call[];
  ratesGrenze: (l: ({ zuwachs: number; zeichen: number; sichtbar: number } | null)[]) => number;
};

let seq = 0;
/** Eine Assistant-Zeile je Content-Block; `ctx` ist der gesamte Eingabe-Kontext (input + Cache). */
const msg = (id: string, ctx: number, blocks: Row[], output = 5): Row[] =>
  blocks.map((b) => {
    seq += 1;
    return {
      type: "assistant",
      uuid: `u${seq}`,
      timestamp: `2026-10-10T10:00:${String(seq % 60).padStart(2, "0")}Z`,
      message: {
        id,
        model: "claude-opus-5-5",
        usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0, output_tokens: output },
        content: [b],
      },
    };
  });
const ergebnis = (zeichen: number): Row => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "x".repeat(zeichen) }] },
});
const text = (n: number): Row => ({ type: "text", text: "y".repeat(n) });
const tool = (inhalt: string): Row => ({ type: "tool_use", id: "t", name: "Bash", input: { command: inhalt } });

describe("Output-Schätzung aus dem Kontext-Zuwachs", () => {
  test("Zuwachs abzüglich Tool-Ergebnis zur kleinsten Rate (Token je Zeichen) ist der Output des vorigen Calls", () => {
    const z = [
      ...msg("a", 1000, [text(16)]), // sichtbar 4 Token
      ergebnis(400), // ruhige Lücke: Zuwachs 104 = 4 Output + 100 Fremd, also Rate 0,25
      ...msg("b", 1104, [text(16)]),
      ergebnis(400), // laute Lücke: Zuwachs 400, davon 100 Fremd
      ...msg("c", 1504, [text(4)]),
    ];
    const { calls } = T.callsFromTranscript(z);
    expect(calls.map((c) => c.output)).toEqual([5, 5, 5]);
    expect(calls[1].outputGeschaetzt).toBe(300);
    expect(calls[1].costGeschaetzt).toBeGreaterThan(calls[1].cost as number);
  });

  test("dichter tokenisierter Fremdtext (Rate über 0,25) wird nicht als Output gezählt", () => {
    // Beide Lücken: 400 Zeichen bringen 200 Token (Rate 0,5); die zweite Lücke trägt zusätzlich 300 Token Output.
    const z = [
      ...msg("a", 1000, [text(16)]),
      ergebnis(400),
      ...msg("b", 1204, [text(16)]),
      ergebnis(400),
      ...msg("c", 1704, [text(4)]),
    ];
    expect(T.callsFromTranscript(z).calls[1].outputGeschaetzt).toBe(300);
  });

  test("ratesGrenze: kleinste Rate über Lücken mit Fremdtext, 0,25 ohne Lücke", () => {
    expect(T.ratesGrenze([null, { zuwachs: 0, zeichen: 10, sichtbar: 0 }, { zuwachs: 50, zeichen: 0, sichtbar: 0 }])).toBe(0.25);
    expect(T.ratesGrenze([{ zuwachs: 300, zeichen: 400, sichtbar: 100 }, { zuwachs: 140, zeichen: 400, sichtbar: 40 }])).toBe(0.25);
    expect(T.ratesGrenze([{ zuwachs: 10, zeichen: 400, sichtbar: 50 }])).toBe(0); // Sichtbares über dem Zuwachs: nie negativ
  });

  test("letzter Call und schrumpfender Kontext fallen auf das Sichtbare zurück", () => {
    const z = [
      ...msg("a", 5000, [text(800)]),
      ...msg("b", 1000, [text(400)]), // Kontext schrumpft (Verdichtung)
    ];
    const { calls } = T.callsFromTranscript(z);
    expect(calls[0].outputSichtbar).toBe(200);
    expect(calls[0].outputGeschaetzt).toBe(200);
    expect(calls[1].outputGeschaetzt).toBe(100);
  });

  test("nie unter dem aufgezeichneten Output und nie unter dem Sichtbaren", () => {
    const z = [
      ...msg("a", 1000, [text(4000)], 700),
      ergebnis(0),
      ...msg("b", 1020, [text(4)]), // Zuwachs 20, Sichtbares 1000, aufgezeichnet 700
    ];
    expect(T.callsFromTranscript(z).calls[0].outputGeschaetzt).toBe(1000);
  });

  test("Anhang unbekannter Größe oder eigener User-Text machen den Zuwachs unbrauchbar (Rückfall aufs Sichtbare)", () => {
    const anhang: Row = { type: "attachment", attachment: { type: "hook_additional_context", content: "z".repeat(100) } };
    const eigenerText: Row = { type: "user", message: { role: "user", content: "bitte weiter" } };
    for (const dazwischen of [anhang, eigenerText, { type: "system", content: "x" }]) {
      const z = [...msg("a", 1000, [text(40)]), ergebnis(0), dazwischen, ...msg("b", 3000, [text(4)])];
      expect(T.callsFromTranscript(z).calls[0].outputGeschaetzt).toBe(10);
    }
  });

  test("kleine Anhänge (Token-Erinnerung) zählen als Fremdzeichen der Lücke", () => {
    const klein: Row = { type: "attachment", attachment: { type: "total_tokens_reminder", text: "y".repeat(80) } };
    const z = [
      ...msg("a", 1000, [text(16)]),
      ergebnis(400),
      klein,
      ...msg("b", 1000 + Math.round((400 + JSON.stringify(klein.attachment).length) / 4), [text(16)]),
      ergebnis(400),
      ...msg("c", 1000 + Math.round((400 + JSON.stringify(klein.attachment).length) / 4) + 300, [text(4)]),
    ];
    // Rate = (Zuwachs 130 − sichtbar 4) / 520 Zeichen; ohne den Anhang als Fremdzeichen wären es 126 / 400 und der Output 174.
    expect(T.callsFromTranscript(z).calls[1].outputGeschaetzt).toBe(203);
  });

  test("Tool-Ergebnis als Array von Text-Blöcken zählt wie String-Inhalt", () => {
    const alsArray: Row = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [{ type: "text", text: "x".repeat(400) }, "y".repeat(0)] }] } };
    const z = (e: Row) => [...msg("a", 1000, [text(16)]), e, ...msg("b", 1104, [text(16)]), e, ...msg("c", 1504, [text(4)])];
    expect(T.callsFromTranscript(z(alsArray)).calls[1].outputGeschaetzt).toBe(T.callsFromTranscript(z(ergebnis(400))).calls[1].outputGeschaetzt);
    expect(T.callsFromTranscript(z(alsArray)).calls[1].outputGeschaetzt).toBe(300);
  });

  test("ohne Schätzfeld bleibt eindeutigeCalls ohne Schätzfeld (Langfuse-Modus, alte Eingaben)", () => {
    const a = { id: "a", messageId: "a", model: "claude-opus-5-5", ts: "2026-10-10T10:00:00Z", input: 1, cacheWrite: 0, cacheRead: 0, output: 5, cost: 0.1 };
    const r = T.eindeutigeCalls([a as never, { ...a, output: 9 } as never]);
    expect(r).toHaveLength(1);
    expect(r[0].output).toBe(9);
    expect("outputGeschaetzt" in r[0]).toBe(false);
  });

  test("mehrzeilige Nachricht zählt einmal, Sichtbares summiert Text und Tool-Eingabe", () => {
    const z = [...msg("a", 1000, [text(40), tool("x".repeat(20))]), ...msg("b", 1000, [text(4)])];
    const { calls } = T.callsFromTranscript(z);
    expect(calls).toHaveLength(2);
    expect(calls[0].outputSichtbar).toBe(Math.ceil((40 + JSON.stringify({ command: "x".repeat(20) }).length) / 4));
  });

  test("eindeutigeCalls nimmt je Nachricht das Maximum der Schätzung", () => {
    const a = { ...T.callsFromTranscript(msg("a", 1000, [text(40)])).calls[0], outputGeschaetzt: 50 };
    const b = { ...a, outputGeschaetzt: 90 };
    const r = T.eindeutigeCalls([a, b]);
    expect(r).toHaveLength(1);
    expect(r[0].outputGeschaetzt).toBe(90);
    expect(r[0].costGeschaetzt).toBeGreaterThan(0);
  });
});

/* Zuordnungs-Metadaten (factory#287): agent_type, effort, thinking je Message; nicht Bestimmbares fehlt (nie raten). */
describe("Zuordnungs-Metadaten", () => {
  type Z = { agent_type?: string; effort?: string; thinking?: string };
  type Datei = { datei: string; meta: Record<string, unknown>; zeilen: Row[] };
  const Zo = raw as unknown as {
    EFFORT_STUFEN: string[];
    thinkingJeMessage: (z: Row[]) => Map<string, boolean>;
    spawnEfforts: (z: Row[]) => Map<string, string>;
    zuordnungen: (s: { id: string; main: Row[]; subagents: Datei[] }) => Map<string, Z>;
  };
  /** Assistant-Zeile je Block; `extra` liegt auf der Zeile (dort schreibt Claude Code `effort`). */
  const zeile = (id: string, blocks: Row[], extra: Row = {}): Row[] => msg(id, 100, blocks).map((r) => ({ ...r, ...extra }));
  const denk = { type: "thinking", thinking: "", signature: "s" };
  const sitz = (main: Row[], subagents: Datei[] = []) => ({ id: "s1", main, subagents });
  const sub = (zeilen: Row[], meta: Row = { agentType: "Explore" }): Datei => ({ datei: "agent-a1.jsonl", meta, zeilen });

  test("thinking: ODER über die Zeilen einer Message; redacted_thinking zählt; nur Text ist false; ohne Array-Inhalt fehlt die Message", () => {
    const z = [
      ...zeile("m1", [denk, text(3)]),
      ...zeile("m2", [text(3)]),
      ...zeile("m3", [{ type: "redacted_thinking", data: "x" }]),
      { type: "assistant", uuid: "u-str", message: { id: "m4", content: "nur ein String" } },
      { type: "user", uuid: "u-user", message: { id: "m5", content: [denk] } },
    ];
    expect(Object.fromEntries(Zo.thinkingJeMessage(z))).toEqual({ m1: true, m2: false, m3: true });
  });

  test("spawnEfforts: nur Werkzeug Agent mit gültiger Stufe", () => {
    const z = [
      ...zeile("m1", [{ type: "tool_use", id: "t1", name: "Agent", input: { effort: "high" } }]),
      ...zeile("m2", [{ type: "tool_use", id: "t2", name: "Agent", input: {} }]),
      ...zeile("m3", [{ type: "tool_use", id: "t3", name: "Bash", input: { effort: "high" } }]),
      ...zeile("m4", [{ type: "tool_use", id: "t4", name: "Agent", input: { effort: "ultra" } }]),
    ];
    expect(Object.fromEntries(Zo.spawnEfforts(z))).toEqual({ t1: "high" });
  });

  test("Hauptdatei: agent_type hauptchat, beobachteter effort der Zeile, thinking ja/nein", () => {
    const m = Zo.zuordnungen(sitz([...zeile("a", [denk, text(1)], { effort: "xhigh" }), ...zeile("b", [text(1)], { effort: "medium" })]));
    expect(m.get("a")).toEqual({ agent_type: "hauptchat", effort: "xhigh", thinking: "ja" });
    expect(m.get("b")).toEqual({ agent_type: "hauptchat", effort: "medium", thinking: "nein" });
  });

  test("perTurnEffort gilt, wenn effort fehlt; ungültiger Wert und widersprüchliche Zeilen lassen effort weg", () => {
    const m = Zo.zuordnungen(
      sitz([
        ...zeile("a", [text(1)], { perTurnEffort: "low" }),
        ...zeile("b", [text(1)], { effort: "ultra" }),
        { ...zeile("c", [text(1)], { effort: "low" })[0] },
        { ...zeile("c", [text(2)], { effort: "high" })[0] },
      ]),
    );
    expect(m.get("a")?.effort).toBe("low");
    expect(m.get("b")).not.toHaveProperty("effort");
    expect(m.get("c")).not.toHaveProperty("effort");
  });

  test("Subagent: agentType der Meta; ohne beobachteten effort gilt effort der Meta, dann effort des Agent-tool_use über toolUseId", () => {
    const spawn = zeile("p", [{ type: "tool_use", id: "tu1", name: "Agent", input: { effort: "high" } }]);
    const m = Zo.zuordnungen(
      sitz(spawn, [
        sub(zeile("s1", [text(1)]), { agentType: "Explore", toolUseId: "tu1" }),
        { ...sub(zeile("s2", [text(1)]), { agentType: "Plan", effort: "medium", toolUseId: "tu1" }), datei: "agent-a2.jsonl" },
        { ...sub(zeile("s3", [text(1)], { effort: "low" }), { agentType: "Plan", toolUseId: "tu1" }), datei: "agent-a3.jsonl" },
        { ...sub(zeile("s4", [text(1)]), { agentType: "Plan", toolUseId: "unbekannt" }), datei: "agent-a4.jsonl" },
      ]),
    );
    expect(m.get("s1")).toMatchObject({ agent_type: "Explore", effort: "high" });
    expect(m.get("s2")?.effort).toBe("medium");
    expect(m.get("s3")?.effort).toBe("low"); // beobachtet schlägt Meta und Spawn
    expect(m.get("s4")).not.toHaveProperty("effort");
  });

  test.each([{}, { agentType: "" }, { agentType: 7 }, { description: "nur Beschreibung" }])("Negativfall: Meta %j ohne brauchbares agentType ⇒ Schlüssel agent_type fehlt, nichts erfunden", (meta) => {
    const m = Zo.zuordnungen(sitz([], [sub(zeile("s1", [text(1)], { effort: "high" }), meta)]));
    expect(m.get("s1")).not.toHaveProperty("agent_type");
    expect(m.get("s1")).toMatchObject({ effort: "high", thinking: "nein" });
  });

  test("Message ohne message.id: die Zeile gilt unter ihrer uuid (wie bei den Calls)", () => {
    const m = Zo.zuordnungen(sitz([{ type: "assistant", uuid: "nur-uuid", effort: "low", message: { content: [text(1)] } }]));
    expect(m.get("nur-uuid")).toEqual({ agent_type: "hauptchat", effort: "low", thinking: "nein" });
  });

  test("Zeilen einer Message mit und ohne effort: kein effort, auch kein Rückfall auf Meta (nie raten)", () => {
    const z = [{ ...zeile("a", [text(1)], { effort: "high" })[0] }, { ...zeile("a", [text(2)])[0] }];
    const m = Zo.zuordnungen(sitz([], [sub(z, { agentType: "Explore", effort: "medium" })]));
    expect(m.get("a")).not.toHaveProperty("effort");
  });

  test.each(["ultra", 7, ""])("ungültiger effort %j in der Meta: die Kette endet, weder Spawn-effort noch Definition gelten", (ungueltig) => {
    const spawn = zeile("p", [{ type: "tool_use", id: "tu1", name: "Agent", input: { effort: "high" } }]);
    const m = Zo.zuordnungen(sitz(spawn, [sub(zeile("s1", [text(1)]), { agentType: "Explore", effort: ungueltig, toolUseId: "tu1" })]));
    expect(m.get("s1")).not.toHaveProperty("effort");
  });

  test("Spawn-effort aus der Datei eines Subagenten (er startet einen weiteren)", () => {
    const spawn = zeile("p", [{ type: "tool_use", id: "tu9", name: "Agent", input: { effort: "xhigh" } }]);
    const m = Zo.zuordnungen(sitz([], [sub(spawn, { agentType: "Plan" }), { ...sub(zeile("s2", [text(1)]), { agentType: "Explore", toolUseId: "tu9" }), datei: "agent-a2.jsonl" }]));
    expect(m.get("s2")?.effort).toBe("xhigh");
  });

  test("Agent-tool_use ohne id: sein effort gehört keinem Subagenten, auch nicht einem ohne toolUseId", () => {
    const spawn = zeile("p", [{ type: "tool_use", name: "Agent", input: { effort: "high" } }]);
    const m = Zo.zuordnungen(sitz(spawn, [sub(zeile("s1", [text(1)]), { agentType: "Explore" })]));
    expect(m.get("s1")).not.toHaveProperty("effort");
    expect(Zo.spawnEfforts(spawn).size).toBe(0);
  });

  test("Message in mehr als einer Datei: agent_type und effort entfallen, thinking bleibt als ODER", () => {
    const m = Zo.zuordnungen(sitz(zeile("dup", [text(1)], { effort: "high" }), [sub(zeile("dup", [denk], { effort: "high" })), { ...sub(zeile("nur", [text(1)], { effort: "low" })), datei: "agent-a2.jsonl" }]));
    expect(m.get("dup")).toEqual({ thinking: "ja" });
    expect(m.get("nur")).toMatchObject({ agent_type: "Explore", effort: "low" });
  });
});

/* Rückfall-Kette für den Effort (Frontmatter der Agentendefinition, Settings), nur mit Quellen und nie auf geändertem oder uneindeutigem Stand. */
describe("Effort-Rückfall: Agentendefinition und Settings", () => {
  type Z = { agent_type?: string; effort?: string; thinking?: string };
  type Datei = { datei: string; meta: Record<string, unknown>; zeilen: Row[] };
  type Q = { claudeDir: string; env?: Record<string, string> };
  const Zo = raw as unknown as {
    effortKette: (s: (() => { status: string; wert?: string })[]) => string | undefined;
    zuordnungen: (s: { id: string; main: Row[]; subagents: Datei[] }, q?: Q) => Map<string, Z>;
  };
  const AGENT = (name: string, effort?: string) => `---\nname: ${name}\n${effort ? `effort: ${effort}\n` : ""}model: opus\n---\nText`;
  /** Wurzel mit `c` (Benutzer-.claude) und `p` (Projekt); die genannten Dateien sind „alt“ (vor dem Lauf), alle anderen neu. */
  const welt = (files: Record<string, string>, alt: string[] = Object.keys(files)) => {
    const root = fixture(files);
    for (const rel of alt) utimesSync(join(root, rel), new Date("2026-10-01T00:00:00Z"), new Date("2026-10-01T00:00:00Z"));
    return { root, cwd: join(root, "p"), q: { claudeDir: join(root, "c") } as Q };
  };
  const text = { type: "text", text: "y" };
  const mitCwd = (id: string, cwd: string | undefined, extra: Row = {}) => msg(id, 100, [text]).map((r) => ({ ...r, ...(cwd ? { cwd } : {}), ...extra }));
  /** Agent-Aufruf der Hauptdatei ohne effort: die Meta der Subagenten verweist per toolUseId darauf (gefunden, aber ohne Wert ⇒ nächste Stufe). */
  const spawn0 = (): Row[] => msg("p0", 100, [{ type: "tool_use", id: "tu0", name: "Agent", input: {} }]);
  const subZ = (w: { cwd: string; q: Q }, meta: Row = { agentType: "Explore", toolUseId: "tu0" }, cwd: string | null = w.cwd) =>
    Zo.zuordnungen({ id: "s1", main: spawn0(), subagents: [{ datei: "agent-a1.jsonl", meta, zeilen: mitCwd("m", cwd ?? undefined) }] }, w.q).get("m");

  test("effortKette: Wert gewinnt, leer geht weiter, unbekannt beendet ohne Wert", () => {
    const wert = (w: string) => () => ({ status: "wert", wert: w });
    const leer = () => ({ status: "leer" });
    const unb = () => ({ status: "unbekannt" });
    expect(Zo.effortKette([leer, wert("low"), wert("high")])).toBe("low");
    expect(Zo.effortKette([leer, unb, wert("high")])).toBeUndefined();
    expect(Zo.effortKette([leer])).toBeUndefined();
    expect(Zo.effortKette([])).toBeUndefined();
  });

  test("Frontmatter der Agentendefinition (Projekt) ergibt effort; Meta-effort schlägt es", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low"), "c/x": "" });
    expect(subZ(w)).toMatchObject({ agent_type: "Explore", effort: "low" });
    expect(subZ(w, { agentType: "Explore", effort: "high" })?.effort).toBe("high");
  });

  test("Definition im Benutzerordner gilt ebenso", () => {
    const w = welt({ "c/agents/e.md": AGENT("Explore", "xhigh"), "p/x": "" });
    expect(subZ(w)?.effort).toBe("xhigh");
  });

  test("ohne Quellen kein Rückfall (der Aufrufer gibt keine Dateien frei)", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low") });
    const m = Zo.zuordnungen({ id: "s1", main: [], subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore" }, zeilen: mitCwd("m", w.cwd) }] });
    expect(m.get("m")).not.toHaveProperty("effort");
  });

  test("Definition jünger als der Lauf, doppelter Name, ohne Definition (Built-in) und ohne cwd: kein effort, auch kein Settings-Wert", () => {
    const settings = { "c/settings.json": JSON.stringify({ effortLevel: "high" }) };
    const jung = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low"), ...settings }, ["c/settings.json"]);
    expect(subZ(jung)).not.toHaveProperty("effort");
    const doppelt = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low"), "c/agents/e.md": AGENT("Explore", "high"), ...settings });
    expect(subZ(doppelt)).not.toHaveProperty("effort");
    const ohne = welt({ "p/.claude/agents/e.md": AGENT("Anderer", "low"), ...settings });
    expect(subZ(ohne)).not.toHaveProperty("effort");
    expect(subZ(ohne, { agentType: "Explore", toolUseId: "tu0" }, null)).not.toHaveProperty("effort");
  });

  test("Laufbeginn ist der erste Call der Datei: eine Definition, die zwischen erstem und letztem Call geändert wurde, gilt nicht", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low") });
    const zeilen = [...mitCwd("m1", w.cwd), ...mitCwd("m2", w.cwd)];
    const erster = Date.parse(String((zeilen[0] as { timestamp: string }).timestamp));
    utimesSync(join(w.root, "p/.claude/agents/e.md"), new Date(erster + 500), new Date(erster + 500));
    const m = Zo.zuordnungen({ id: "s1", main: spawn0(), subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore", toolUseId: "tu0" }, zeilen }] }, w.q);
    expect(m.get("m1")).not.toHaveProperty("effort");
  });

  test("cwd fehlt in der Subagent-Datei: das cwd der Hauptdatei gilt", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low") });
    const m = Zo.zuordnungen({ id: "s1", main: [...mitCwd("h", w.cwd), ...spawn0()], subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore", toolUseId: "tu0" }, zeilen: mitCwd("m", undefined) }] }, w.q);
    expect(m.get("m")?.effort).toBe("low");
  });

  test("Meta ohne agentType: keine Definition wird geraten (auch nicht eine ohne name)", () => {
    const w = welt({ "p/.claude/agents/ohne-name.md": "---\neffort: low\n---\nText" });
    expect(subZ(w, { toolUseId: "tu0" })).not.toHaveProperty("effort");
  });

  test("ungültiger Frontmatter-effort: kein effort und kein Rückfall auf die Settings", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "ultra"), "c/settings.json": JSON.stringify({ effortLevel: "high" }) });
    expect(subZ(w)).not.toHaveProperty("effort");
  });

  test("Definition ohne effort: Settings-Einstellung, Rang lokal vor Projekt vor Benutzer", () => {
    const def = { "p/.claude/agents/e.md": AGENT("Explore") };
    const nurUser = welt({ ...def, "c/settings.json": JSON.stringify({ effortLevel: "low" }) });
    expect(subZ(nurUser)?.effort).toBe("low");
    const projekt = welt({ ...def, "c/settings.json": JSON.stringify({ effortLevel: "low" }), "p/.claude/settings.json": JSON.stringify({ effortLevel: "medium" }) });
    expect(subZ(projekt)?.effort).toBe("medium");
    const lokal = welt({ ...def, "c/settings.json": JSON.stringify({ effortLevel: "low" }), "p/.claude/settings.json": JSON.stringify({ effortLevel: "medium" }), "p/.claude/settings.local.json": JSON.stringify({ effortLevel: "xhigh" }) });
    expect(subZ(lokal)?.effort).toBe("xhigh");
  });

  test.each([
    ["Settings-Datei jünger als der Lauf", { "c/settings.json": JSON.stringify({ effortLevel: "low" }) }, [] as string[], {}],
    ["höher rangige Datei jünger als der Lauf", { "c/settings.json": JSON.stringify({ effortLevel: "low" }), "p/.claude/settings.local.json": "{}" }, ["c/settings.json"], {}],
    ["ungültiger Wert", { "c/settings.json": JSON.stringify({ effortLevel: "ultra" }) }, undefined, {}],
    ["kaputtes JSON", { "c/settings.json": "{nicht json" }, undefined, {}],
    ["kaputtes JSON in der niedriger rangigen Datei trotz gültigem Projektwert", { "p/.claude/settings.json": JSON.stringify({ effortLevel: "medium" }), "c/settings.json": "{nicht json" }, undefined, {}],
    ["CLAUDE_CODE_EFFORT_LEVEL in den Settings (env)", { "c/settings.json": JSON.stringify({ effortLevel: "low", env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } }) }, undefined, {}],
    ["CLAUDE_CODE_EFFORT_LEVEL in der Prozess-Umgebung", { "c/settings.json": JSON.stringify({ effortLevel: "low" }) }, undefined, { CLAUDE_CODE_EFFORT_LEVEL: "max" }],
    ["keine Einstellung gesetzt (der Modell-Default wird nie eingesetzt)", { "c/settings.json": "{}" }, undefined, {}],
  ])("Settings-Stufe: %s ⇒ kein effort", (_name, files, alt, env) => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore"), ...(files as Record<string, string>) }, [...(alt ?? Object.keys(files)), "p/.claude/agents/e.md"]);
    w.q.env = env;
    expect(subZ(w)).not.toHaveProperty("effort");
  });

  test("ungültiger Zeilenwert (etwa eine neue Stufe): kein effort und kein Rückfall, auch nicht auf Meta oder Frontmatter", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low") });
    const m = Zo.zuordnungen({ id: "s1", main: spawn0(), subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore", toolUseId: "tu0", effort: "medium" }, zeilen: mitCwd("m", w.cwd, { effort: "ultra" }) }] }, w.q);
    expect(m.get("m")).not.toHaveProperty("effort");
  });

  test("Spawn-effort schlägt das Frontmatter; ein ungültiger Spawn-effort und ein nicht auffindbarer Aufruf beenden die Kette", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low") });
    const z = (main: Row[], toolUseId: string) => Zo.zuordnungen({ id: "s1", main, subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore", toolUseId }, zeilen: mitCwd("m", w.cwd) }] }, w.q).get("m");
    const aufruf = (effort: unknown): Row[] => msg("p", 100, [{ type: "tool_use", id: "tu1", name: "Agent", input: { effort } }]);
    expect(z(aufruf("high"), "tu1")?.effort).toBe("high");
    expect(z(aufruf("ultra"), "tu1")).not.toHaveProperty("effort");
    expect(z(aufruf("high"), "tu-fehlt")).not.toHaveProperty("effort");
  });

  test("CLAUDE_CODE_EFFORT_LEVEL (Prozess-Umgebung oder Settings-env) sperrt auch den Frontmatter-Wert", () => {
    const def = { "p/.claude/agents/e.md": AGENT("Explore", "low") };
    const prozess = welt(def);
    prozess.q.env = { CLAUDE_CODE_EFFORT_LEVEL: "max" };
    expect(subZ(prozess)).not.toHaveProperty("effort");
    const inSettings = welt({ ...def, "p/.claude/settings.json": JSON.stringify({ env: { CLAUDE_CODE_EFFORT_LEVEL: "max" } }) });
    expect(subZ(inSettings)).not.toHaveProperty("effort");
    const kaputt = welt({ ...def, "c/settings.json": "{nicht json" });
    expect(subZ(kaputt)).not.toHaveProperty("effort");
  });

  test("ein cwd, das es nicht mehr gibt, und Quellen ohne claudeDir: kein effort, kein Fehler", () => {
    const w = welt({ "c/agents/e.md": AGENT("Explore"), "c/settings.json": JSON.stringify({ effortLevel: "high" }), "p/x": "" });
    expect(subZ(w)?.effort).toBe("high"); // Gegenprobe: mit vorhandenem cwd greift der Benutzerwert
    expect(subZ(w, undefined, join(w.root, "weg"))).not.toHaveProperty("effort");
    const ohneDir = Zo.zuordnungen({ id: "s1", main: [...mitCwd("h", w.cwd), ...spawn0()], subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore", toolUseId: "tu0" }, zeilen: mitCwd("m", w.cwd) }] }, { env: {} } as unknown as Q);
    expect(ohneDir.get("m")).not.toHaveProperty("effort");
    expect(ohneDir.get("h")).not.toHaveProperty("effort");
  });

  test("mtime genau gleich dem Laufbeginn gilt als unverändert (≤): Definition und Settings", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low"), "p/.claude/agents/o.md": AGENT("Ohne"), "c/settings.json": JSON.stringify({ effortLevel: "xhigh" }) });
    const zeilen = mitCwd("m", w.cwd);
    const start = new Date(Date.parse(String((zeilen[0] as { timestamp: string }).timestamp)));
    for (const rel of ["p/.claude/agents/e.md", "p/.claude/agents/o.md", "c/settings.json"]) utimesSync(join(w.root, rel), start, start);
    const z = (agentType: string) => Zo.zuordnungen({ id: "s1", main: spawn0(), subagents: [{ datei: "agent-a1.jsonl", meta: { agentType, toolUseId: "tu0" }, zeilen }] }, w.q).get("m");
    expect(z("Explore")?.effort).toBe("low");
    expect(z("Ohne")?.effort).toBe("xhigh");
  });

  test("Laufbeginn: Zeilen ohne oder mit ungültigem Zeitstempel zählen nicht; ganz ohne Zeitstempel ist der Beginn unbekannt", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low") });
    utimesSync(join(w.root, "p/.claude/agents/e.md"), new Date(), new Date()); // jünger als jeder Zeitstempel im Transkript
    const ohneZeit: Row[] = mitCwd("m", w.cwd).map((r) => {
      const kopie: Row = { ...r };
      delete kopie.timestamp;
      return kopie;
    });
    const kaputtUndGut = [...mitCwd("m", w.cwd).map((r) => ({ ...r, timestamp: "kaputt" })), ...mitCwd("m", w.cwd)];
    const z = (zeilen: Row[]) => Zo.zuordnungen({ id: "s1", main: spawn0(), subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore", toolUseId: "tu0" }, zeilen }] }, w.q).get("m");
    expect(z(ohneZeit)).not.toHaveProperty("effort");
    expect(z(kaputtUndGut)).not.toHaveProperty("effort"); // Definition ist jünger als der gute Zeitstempel
  });

  test("Fremddateien im Agentenordner: ohne Frontmatter, .bak mit gleichem name; Anführungszeichen an name und effort", () => {
    const w = welt({
      "p/.claude/agents/README.md": "kein Frontmatter",
      "p/.claude/agents/e.md.bak": AGENT("Explore", "high"),
      "p/.claude/agents/e.md": '---\nname: "Explore"\neffort: "low"\n---\nText',
    });
    expect(subZ(w)?.effort).toBe("low");
  });

  test("Befehls-Sperre: nur echte /effort- oder /model-Befehle in Benutzerzeilen; /models, Prosa und Zitate in Assistant-Zeilen sperren nicht", () => {
    const w = welt({ "c/settings.json": JSON.stringify({ effortLevel: "high" }), "p/x": "" });
    const z = (extra: Row[]) => Zo.zuordnungen({ id: "s1", main: [...mitCwd("h", w.cwd), ...extra], subagents: [] }, w.q).get("h");
    const user = (content: string): Row => ({ type: "user", message: { role: "user", content } });
    expect(z([user("<command-name>/models</command-name>")])?.effort).toBe("high");
    expect(z([user("bitte /model nicht ändern")])?.effort).toBe("high");
    expect(z([{ type: "assistant", uuid: "zitat", message: { id: "zitat", content: [{ type: "text", text: "<command-name>/effort</command-name>" }] } }])?.effort).toBe("high");
  });

  test("ein /effort in der Hauptdatei sperrt auch den Datei-Rückfall der Subagenten", () => {
    const w = welt({ "p/.claude/agents/e.md": AGENT("Explore", "low") });
    const befehl: Row = { type: "user", message: { role: "user", content: "<command-name>/effort</command-name>" } };
    const m = Zo.zuordnungen({ id: "s1", main: [...spawn0(), befehl], subagents: [{ datei: "agent-a1.jsonl", meta: { agentType: "Explore", toolUseId: "tu0" }, zeilen: mitCwd("m", w.cwd) }] }, w.q);
    expect(m.get("m")).not.toHaveProperty("effort");
  });

  test("Hauptchat: Settings-Einstellung als Rückfall; nach /effort oder /model, ohne cwd und ohne Quellen fehlt sie", () => {
    const w = welt({ "c/settings.json": JSON.stringify({ effortLevel: "high" }), "p/x": "" });
    const main = (extra: Row[] = [], cwd: string | null = w.cwd) => [...mitCwd("h", cwd ?? undefined), ...extra];
    const z = (zeilen: Row[], q: Q | null = w.q) => Zo.zuordnungen({ id: "s1", main: zeilen, subagents: [] }, q ?? undefined).get("h");
    expect(z(main())).toMatchObject({ agent_type: "hauptchat", effort: "high" });
    const befehl = (n: string): Row => ({ type: "user", message: { role: "user", content: `<command-name>/${n}</command-name>` } });
    expect(z(main([befehl("effort")]))).not.toHaveProperty("effort");
    expect(z(main([{ type: "user", message: { role: "user", content: [{ type: "text", text: "<command-name>/model</command-name>" }] } }]))).not.toHaveProperty("effort");
    expect(z(main([befehl("clear")]))).toMatchObject({ effort: "high" });
    expect(z(main([], null))).not.toHaveProperty("effort");
    expect(z(main(), null)).not.toHaveProperty("effort");
  });
});
