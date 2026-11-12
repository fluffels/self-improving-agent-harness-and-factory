/* Laufzeit-Vertrags-Wächter (quellprojekt#92): Claude Code und Codex lesen dieselben Quellen; hermetisch in verify statt pfadgefiltertem
 * CI-Job. Geschlossene Vertragsliste:
 *  V1 Skills: die Zeiger-Parität prüft `skills-sync.test.ts`; hier wird nur dessen Existenz verlangt.
 *  V2 Rollen: jede `quelle` aus `rollenFuer(config)` (scripts/codex-rollen.mjs) ist eine Agentendatei `.claude/agents/<quelle>.md`;
 *     jede Agentendatei ist Rollenquelle oder steht mit Grund in AGENTEN_AUSNAHMEN (heute `lens-kern-je-rolle`, Arm B der A/B-Messung factory#235: Codex-Rollen sind Forks, `omitClaudeMd` ist dort nicht abbildbar).
 *  V3 Hooks: jedes Hook-Skript aus `.claude/settings.json` hat genau eine Zeile in HOOK_TABELLE {hook, modul, codex, grenze};
 *     `codex: null` braucht eine Grenze mit Ticketnummer (heute factory#365 bzw. factory#249); ein Adapter muss dieselben Auswertungsmodule importieren, auch
 *     über seine transitiven Importe (der Adapter lädt den Dispatcher dynamisch; `lokaleImporteTransitiv` aus hook-importe.ts);
 *     importiert ein `scripts/codex-*.mjs` transitiv ein Auswertungsmodul, während die Zeile `null` sagt, ist die Tabelle nachzuziehen. Eine Grenze nennt nie die gelöschten Tickets factory#84/factory#86.
 *  V4 AGENTS.md ≤ 32768 Bytes (Codex-Standard `project_doc_max_bytes`); `check:contextsize` deckelt strenger, hier nur der Bezug.
 * Grenzen: Frontmatter-Hooks der Agenten werden nicht gescannt; ein echter Codex-Lauf ist in CI nicht möglich (Wirkungsbeleg: factory#367, Epic factory#249).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165). */
import { expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { hookSkripte, lokaleImporteTransitiv } from "./hook-importe";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rollenRaw from "../../scripts/codex-rollen.mjs";

const rollenFuer = (rollenRaw as unknown as { rollenFuer: (c: unknown) => { quelle: string }[] }).rollenFuer;
const lies = (p: string) => readFileSync(p, "utf8");

export interface HookZeile { hook: string; modul: string[]; codex: string | null; grenze: string }
const OFFEN = "Codex-Hook-Schutz offen: factory#365";
export const HOOK_TABELLE: HookZeile[] = [
  { hook: "scripts/haupt-sync.mjs", modul: ["scripts/haupt-sync.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/langfuse-abgleich-hook.mjs", modul: ["scripts/langfuse-abgleich-hook.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/sandbox-doctor.mjs", modul: ["scripts/sandbox-doctor.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/mcp-ausfall.mjs", modul: ["scripts/mcp-ausfall.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/langfuse-vorbedingung.mjs", modul: ["scripts/langfuse-vorbedingung.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/pretooluse-hook.mjs", codex: "scripts/codex-hook.mjs", grenze: "Adapter ohne Wirkungsbeleg im echten Codex-Lauf; write_stdin, direkte Dateiwerkzeuge, MCP und Nachrichtenwerkzeuge nicht abgedeckt: factory#367 (Epic factory#249)", modul: ["scripts/pretooluse-dispatch.mjs", "scripts/gh-guard-hook.mjs", "scripts/worktree-guard-hook.mjs", "scripts/worktree-guard-powershell.mjs", "scripts/holdout-auftrag-guard.mjs", "scripts/lens-auftrag-guard.mjs", "scripts/stdin-skript-guard.mjs", "scripts/umsetzer-abschluss.mjs"] },
  { hook: "scripts/stop-verify-hook.mjs", modul: ["scripts/stop-verify-hook.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/statusline.mjs", modul: ["scripts/statusline.mjs"], codex: null, grenze: "Statuszeile ist Claude-spezifisch: factory#249" },
];
export const AGENTEN_AUSNAHMEN: Record<string, string> = {
  "lens-kern-je-rolle": "Arm B der A/B-Messung (factory#235): nur Claude Code, `omitClaudeMd: true`. Codex-Rollen sind Forks und erben `AGENTS.md`, der Schalter ist dort nicht abbildbar (belegt in factory#233, Fall g, Thread 01a1b309-be91-72f1-9cef-0a21f3e85617); Codex bleibt bei Arm A.",
};
export const CODEX_AGENTS_MAX_BYTES = 32768;

export const v1 = (existiert: (p: string) => boolean): string[] => existiert("test/harness/skills-sync.test.ts") ? [] : ["V1: test/harness/skills-sync.test.ts fehlt"];

export function v2(quellen: string[], agentDateien: string[], ausnahmen: Record<string, string>): string[] {
  const f: string[] = [];
  for (const q of quellen) if (!agentDateien.includes(`${q}.md`)) f.push(`V2: Rollenquelle .claude/agents/${q}.md fehlt`);
  const qs = new Set(quellen);
  for (const d of agentDateien) {
    const n = d.replace(/\.md$/, "");
    if (!qs.has(n) && !ausnahmen[n]?.trim()) f.push(`V2: Agent ${d} ist weder Rollenquelle noch Ausnahme mit Grund`);
  }
  return f;
}

const importeTransitiv = (datei: string, lies: (p: string) => string): string[] => lokaleImporteTransitiv([datei], lies).filter(i => i !== datei);

export function v3(skripte: string[], tabelle: HookZeile[], codexTexte: Record<string, string>, lies: (p: string) => string = p => codexTexte[p] ?? ""): string[] {
  const f: string[] = [];
  const transitiv = (d: string) => { try { return importeTransitiv(d, lies); } catch (e) { f.push(`V3: ${d}: ${(e as Error).message}`); return []; } };
  for (const s of skripte) if (!tabelle.some(z => z.hook === s)) f.push(`V3: Hook ${s} ohne Tabellenzeile`);
  for (const z of tabelle) {
    if (!skripte.includes(z.hook)) f.push(`V3: Tabellenzeile ${z.hook} ohne Hook`);
    if (z.codex === null && !/#\d+/.test(z.grenze)) f.push(`V3: ${z.hook}: codex null braucht eine Grenze mit #<nr>`);
    if (/#(?:84|86)\b/.test(z.grenze)) f.push(`V3: ${z.hook}: die Grenze nennt ein gelöschtes Ticket (factory#84/factory#86), Ziel ist factory#249 bzw. das zuständige Kind`);
    if (z.codex !== null) {
      if (codexTexte[z.codex] === undefined) { f.push(`V3: Adapter ${z.codex} fehlt`); continue; }
      const imp = transitiv(z.codex);
      for (const m of z.modul) if (!imp.includes(m)) f.push(`V3: Adapter ${z.codex} importiert ${m} nicht`);
    }
  }
  for (const datei of Object.keys(codexTexte)) {
    const imp = transitiv(datei);
    for (const z of tabelle) if (z.codex === null) for (const m of z.modul) if (imp.includes(m)) f.push(`V3: ${datei} importiert ${m}, Zeile sagt null (Tabelle nachziehen)`);
  }
  return f;
}

export const v4 = (bytes: number): string[] => bytes <= CODEX_AGENTS_MAX_BYTES ? [] : [`V4: AGENTS.md hat ${bytes} Bytes (> ${CODEX_AGENTS_MAX_BYTES})`];

const codexSkripte = () => Object.fromEntries(readdirSync("scripts").filter(n => /^codex-.*\.mjs$/.test(n)).map(n => [`scripts/${n}`, lies(`scripts/${n}`)]));

test("Ist-Stand erfüllt V1-V4", () => {
  const rollen = rollenFuer(JSON.parse(lies(".factory/projekt.json")));
  const agenten = readdirSync(".claude/agents").filter(n => n.endsWith(".md"));
  expect([
    ...v1(existsSync),
    ...v2(rollen.map(r => r.quelle), agenten, AGENTEN_AUSNAHMEN),
    ...v3(hookSkripte(lies(".claude/settings.json")), HOOK_TABELLE, codexSkripte(), lies),
    ...v4(Buffer.byteLength(lies("AGENTS.md"))),
  ]).toEqual([]);
});

test("V1 Negativfall: fehlender skills-sync-Wächter", () => expect(v1(() => false)).toHaveLength(1));
test("V2 Negativfälle: fehlende Quelle, Agent ohne Rolle, Ausnahme ohne Grund", () => {
  expect(v2(["a", "b"], ["a.md"], {})).toEqual(["V2: Rollenquelle .claude/agents/b.md fehlt"]);
  expect(v2(["a"], ["a.md", "x.md"], {})).toHaveLength(1);
  expect(v2(["a"], ["a.md", "x.md"], { x: " " })).toHaveLength(1);
  expect(v2(["a"], ["a.md", "x.md"], { x: "Grund" })).toEqual([]);
});
test("V3 Negativfälle: Hook ohne Zeile, Zeile ohne Hook, Grenze ohne Ticket, Adapter-Import", () => {
  const z: HookZeile = { hook: "scripts/h.mjs", modul: ["scripts/m.mjs"], codex: null, grenze: "offen: factory#365" };
  expect(v3(["scripts/h.mjs"], [z], {})).toEqual([]);
  expect(v3(["scripts/h.mjs", "scripts/neu.mjs"], [z], {})).toEqual(["V3: Hook scripts/neu.mjs ohne Tabellenzeile"]);
  expect(v3([], [z], {})).toEqual(["V3: Tabellenzeile scripts/h.mjs ohne Hook"]);
  expect(v3(["scripts/h.mjs"], [{ ...z, grenze: "später" }], {})).toHaveLength(1);
  const quellen: Record<string, string> = { "scripts/codex-x.mjs": 'import { a } from "./m.mjs";', "scripts/m.mjs": "export const a = 1;" };
  const lies = (p: string) => { if (!(p in quellen)) throw new Error(`nicht da: ${p}`); return quellen[p]; };
  const imp = { "scripts/codex-x.mjs": quellen["scripts/codex-x.mjs"] };
  expect(v3(["scripts/h.mjs"], [z], imp, lies)[0]).toContain("Tabelle nachziehen");
  expect(v3(["scripts/h.mjs"], [{ ...z, codex: "scripts/codex-x.mjs" }], imp, lies)).toEqual([]);
  expect(v3(["scripts/h.mjs"], [{ ...z, codex: "scripts/codex-y.mjs" }], { ...imp, "scripts/codex-y.mjs": "" }, p => (p === "scripts/codex-y.mjs" ? "" : lies(p)))[0]).toContain("importiert scripts/m.mjs nicht");
});
test("V3 transitiv: ein nur mittelbar importiertes Modul zählt, ein fehlender Adapter und eine Grenze mit gelöschtem Ticket sind Fehler", () => {
  const quellen: Record<string, string> = { "scripts/codex-x.mjs": 'import { a } from "./mitte.mjs";', "scripts/mitte.mjs": 'export const l = () => import("./m.mjs");', "scripts/m.mjs": "export const a = 1;" };
  const lies = (p: string) => { if (!(p in quellen)) throw new Error(`nicht da: ${p}`); return quellen[p]; };
  const z: HookZeile = { hook: "scripts/h.mjs", modul: ["scripts/m.mjs"], codex: "scripts/codex-x.mjs", grenze: "factory#367" };
  expect(v3(["scripts/h.mjs"], [z], { "scripts/codex-x.mjs": quellen["scripts/codex-x.mjs"] }, lies)).toEqual([]);
  expect(v3(["scripts/h.mjs"], [z], {}, lies)).toEqual(["V3: Adapter scripts/codex-x.mjs fehlt"]);
  const alt = v3(["scripts/h.mjs"], [{ ...z, grenze: "offen: #84" }], { "scripts/codex-x.mjs": quellen["scripts/codex-x.mjs"] }, lies);
  expect(alt).toHaveLength(1);
  expect(alt[0]).toContain("gelöschtes Ticket");
  expect(v3(["scripts/h.mjs"], [{ ...z, grenze: "offen: factory#86" }], { "scripts/codex-x.mjs": "" }, lies).some(m => m.includes("gelöschtes Ticket"))).toBe(true);
});
test("V4 Negativfall: zu große AGENTS.md", () => {
  expect(v4(CODEX_AGENTS_MAX_BYTES)).toEqual([]);
  expect(v4(CODEX_AGENTS_MAX_BYTES + 1)).toHaveLength(1);
});
