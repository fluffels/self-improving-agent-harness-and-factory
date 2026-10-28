/* Laufzeit-Vertrags-Wächter (#92): Claude Code und Codex lesen dieselben Quellen; hermetisch in verify statt pfadgefiltertem
 * CI-Job. Geschlossene Vertragsliste:
 *  V1 Skills: die Zeiger-Parität prüft `skills-sync.test.ts`; hier wird nur dessen Existenz verlangt.
 *  V2 Rollen: jede `quelle` aus `rollenFuer(config)` (scripts/codex-rollen.mjs) ist eine Agentendatei `.claude/agents/<quelle>.md`;
 *     jede Agentendatei ist Rollenquelle oder steht mit Grund in AGENTEN_AUSNAHMEN.
 *  V3 Hooks: jedes Hook-Skript aus `.claude/settings.json` hat genau eine Zeile in HOOK_TABELLE {hook, modul, codex, grenze};
 *     `codex: null` braucht eine Grenze mit Ticketnummer (heute #84); ein Adapter muss dieselben Auswertungsmodule importieren;
 *     importiert ein `scripts/codex-*.mjs` ein Auswertungsmodul, während die Zeile `null` sagt, ist die Tabelle nachzuziehen.
 *  V4 AGENTS.md ≤ 32768 Bytes (Codex-Standard `project_doc_max_bytes`); `check:contextsize` deckelt strenger, hier nur der Bezug.
 * Grenzen: Frontmatter-Hooks der Agenten werden nicht gescannt; ein echter Codex-Lauf ist in CI nicht möglich (Gesamtabnahme #86).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165). */
import { expect, test } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { hookSkripte, relativeImporte } from "./hook-importe";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rollenRaw from "../../scripts/codex-rollen.mjs";

const rollenFuer = (rollenRaw as unknown as { rollenFuer: (c: unknown) => { quelle: string }[] }).rollenFuer;
const lies = (p: string) => readFileSync(p, "utf8");

export interface HookZeile { hook: string; modul: string[]; codex: string | null; grenze: string }
const OFFEN = "Codex-Hook-Schutz offen: #84";
export const HOOK_TABELLE: HookZeile[] = [
  { hook: "scripts/haupt-sync.mjs", modul: ["scripts/haupt-sync.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/langfuse-abgleich-hook.mjs", modul: ["scripts/langfuse-abgleich-hook.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/sandbox-doctor.mjs", modul: ["scripts/sandbox-doctor.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/mcp-ausfall.mjs", modul: ["scripts/mcp-ausfall.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/langfuse-vorbedingung.mjs", modul: ["scripts/langfuse-vorbedingung.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/pretooluse-hook.mjs", codex: "scripts/codex-hook-lib.mjs", grenze: "Begrenzter Einzelaktionshost; weitere Werkzeugpfade ohne kontrollierten Executor verweigert: #84", modul: ["scripts/gh-guard-hook.mjs", "scripts/worktree-guard-hook.mjs", "scripts/worktree-guard-powershell.mjs", "scripts/holdout-auftrag-guard.mjs", "scripts/lens-auftrag-guard.mjs", "scripts/stdin-skript-guard.mjs", "scripts/umsetzer-abschluss.mjs"] },
  { hook: "scripts/stop-verify-hook.mjs", modul: ["scripts/stop-verify-hook.mjs"], codex: null, grenze: OFFEN },
  { hook: "scripts/statusline.mjs", modul: ["scripts/statusline.mjs"], codex: null, grenze: "Statuszeile ist Claude-spezifisch: #84" },
];
export const AGENTEN_AUSNAHMEN: Record<string, string> = {};
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

export function v3(skripte: string[], tabelle: HookZeile[], codexTexte: Record<string, string>): string[] {
  const f: string[] = [];
  for (const s of skripte) if (!tabelle.some(z => z.hook === s)) f.push(`V3: Hook ${s} ohne Tabellenzeile`);
  for (const z of tabelle) {
    if (!skripte.includes(z.hook)) f.push(`V3: Tabellenzeile ${z.hook} ohne Hook`);
    if (z.codex === null && !/#\d+/.test(z.grenze)) f.push(`V3: ${z.hook}: codex null braucht eine Grenze mit #<nr>`);
    if (z.codex !== null) {
      const text = codexTexte[z.codex];
      const imp = text === undefined ? [] : relativeImporte(text).map(i => `scripts/${i.replace(/^\.\//, "")}`);
      for (const m of z.modul) if (!imp.includes(m)) f.push(`V3: Adapter ${z.codex} importiert ${m} nicht`);
    }
  }
  for (const [datei, text] of Object.entries(codexTexte)) {
    const imp = relativeImporte(text).map(i => `scripts/${i.replace(/^\.\//, "")}`);
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
    ...v3(hookSkripte(lies(".claude/settings.json")), HOOK_TABELLE, codexSkripte()),
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
  const z: HookZeile = { hook: "scripts/h.mjs", modul: ["scripts/m.mjs"], codex: null, grenze: "offen: #84" };
  expect(v3(["scripts/h.mjs"], [z], {})).toEqual([]);
  expect(v3(["scripts/h.mjs", "scripts/neu.mjs"], [z], {})).toEqual(["V3: Hook scripts/neu.mjs ohne Tabellenzeile"]);
  expect(v3([], [z], {})).toEqual(["V3: Tabellenzeile scripts/h.mjs ohne Hook"]);
  expect(v3(["scripts/h.mjs"], [{ ...z, grenze: "später" }], {})).toHaveLength(1);
  const imp = { "scripts/codex-x.mjs": 'import { a } from "./m.mjs";' };
  expect(v3(["scripts/h.mjs"], [z], imp)[0]).toContain("Tabelle nachziehen");
  expect(v3(["scripts/h.mjs"], [{ ...z, codex: "scripts/codex-x.mjs" }], imp)).toEqual([]);
  expect(v3(["scripts/h.mjs"], [{ ...z, codex: "scripts/codex-y.mjs" }], imp)[0]).toContain("importiert scripts/m.mjs nicht");
});
test("V4 Negativfall: zu große AGENTS.md", () => {
  expect(v4(CODEX_AGENTS_MAX_BYTES)).toEqual([]);
  expect(v4(CODEX_AGENTS_MAX_BYTES + 1)).toHaveLength(1);
});
