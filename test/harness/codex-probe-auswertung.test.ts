/* @harness-waechter: Codex-Probe-Auswertung (factory#366): Bericht-Schema, Belegdiagnose, Zuordnung der Punkte zu den Nachweisen 1-5; Negativfälle je Nachweis. */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as auswRaw from "../../scripts/codex-probe-auswertung.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as libRaw from "../../scripts/codex-probe-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as belegeRaw from "../../scripts/codex-belege.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as freigabenRaw from "../../scripts/codex-freigaben.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as rollenRaw from "../../scripts/codex-rollen.mjs";
import config from "../fixtures/projekt-probe.json";

type Punkt = { id: string; nachweis: number; ohneExport: boolean };
type Ergebnis = { nachweise: Record<string, string>; maengel: string[]; autonom: boolean; version: string | null };
const a = auswRaw as unknown as { auswerten: (x: unknown) => Ergebnis; auswertungExit: (e: Ergebnis) => number; nachweiseDerDiagnose: (m: string) => string[]; berichtSchemaMaengel: (b: unknown, e: unknown, p: Punkt[]) => string[] };
const NACHWEIS_NUMMERN = (freigabenRaw as unknown as { NACHWEIS_NUMMERN: string[] }).NACHWEIS_NUMMERN;
const lib = libRaw as unknown as { checklistenPunkte: (c: unknown) => Punkt[] };
const belegeLib = belegeRaw as unknown as { bewerteBelege: (b: unknown, c: unknown) => string[] };

const ROLLEN_KEY = "agent_source.subagent.thread_spawn.agent_role";
const rollen = (rollenRaw as unknown as { rollenFuer: (c: unknown) => { name: string }[] }).rollenFuer(config).map((r) => r.name);
type Obs = { id: string; type: string; sessionId: string; tags: string[]; metadata: Record<string, unknown>; usageDetails: unknown };
const gen = (id: string, parent: string, rolle?: string): Obs => ({ id: `gen-${id}`, type: "GENERATION", sessionId: "s1", tags: ["project:qx-demo"], metadata: { agent_role: parent ? "subagent" : "main", agent_id: id, parent_thread_id: parent, ...(rolle ? { [ROLLEN_KEY]: rolle } : {}) }, usageDetails: { input: 1, output: 2 } });
const export_ = () => ({ version: "9.9.9", sessionId: "s1", rollen: [...rollen], tools: ["playwright", "langfuse"], observations: [gen("main", ""), ...rollen.map((r) => gen(r, "main", r)), { ...gen("tool", ""), id: "tool-1", type: "TOOL", metadata: { agent_id: "main" } }] as Obs[] });
const punkte = lib.checklistenPunkte(config);
const bericht = () => ({
  version: "9.9.9", sessionId: "s1", frischeSession: true,
  punkte: Object.fromEntries(punkte.map((p) => [p.id, { ergebnis: "belegt", beobachtung: "ok", observations: p.ohneExport ? [] : ["tool-1"], ...(p.ohneExport ? { ausgabe: "Ausgabe der Probe" } : {}) }])),
});
const lauf = (b: unknown = bericht(), e: unknown = export_()) => a.auswerten({ belege: e, bericht: b, config });
const mit = (aend: (b: ReturnType<typeof bericht>) => void) => { const b = bericht(); aend(b); return b; };
const offen = (r: Ergebnis) => Object.entries(r.nachweise).filter(([, z]) => z === "offen").map(([n]) => n);

describe("Auswertung: Positivfälle", () => {
  test("gültiger Export und voller Bericht: alle fünf Nachweise belegt, Exit 0, nie autonom", () => {
    const r = lauf();
    expect(r.nachweise).toEqual({ 1: "belegt", 2: "belegt", 3: "belegt", 4: "belegt", 5: "belegt" });
    expect(r.maengel).toEqual([]);
    expect(r.autonom).toBe(false);
    expect(Object.keys(r.nachweise)).toEqual([...NACHWEIS_NUMMERN]); // Schlüssel der Freigabetabelle
    expect(a.auswertungExit(r)).toBe(0);
  });
  test("hook-timeout als grenze: Nachweis 3 grenze, die übrigen belegt, Exit 0", () => {
    const r = lauf(mit((b) => { b.punkte["hook-timeout"].ergebnis = "grenze"; }));
    expect(r.nachweise).toEqual({ 1: "belegt", 2: "belegt", 3: "grenze", 4: "belegt", 5: "belegt" });
    expect(a.auswertungExit(r)).toBe(0);
  });
  test("Rangfolge je Nachweis: ein offener Punkt schlägt eine grenze, in beiden Reihenfolgen", () => {
    for (const [grenze, offenerPunkt] of [["hook-timeout", "hook-fehler"], ["hook-fehler", "hook-timeout"]]) {
      const r = lauf(mit((b) => { b.punkte[grenze].ergebnis = "grenze"; b.punkte[offenerPunkt].ergebnis = "offen"; }));
      expect(r.nachweise["3"]).toBe("offen");
    }
  });
});

describe("Auswertung: Negativfälle, je Nachweis offen und Exit 1", () => {
  const exit1 = (r: Ergebnis) => expect(a.auswertungExit(r)).toBe(1);
  test("fehlender Punkt abnahme: Nachweis 5 offen, der Rest nicht", () => {
    const r = lauf(mit((b) => { delete (b.punkte as Record<string, unknown>).abnahme; }));
    expect(offen(r)).toEqual(["5"]);
    expect(r.maengel.join()).toContain("abnahme");
    exit1(r);
  });
  test("leere observations: Punkt ohne Beleg-Verweis", () => {
    const r = lauf(mit((b) => { b.punkte.playwright.observations = []; }));
    expect(offen(r)).toEqual(["2"]);
    exit1(r);
  });
  test("Observation-ID nicht im Export oder aus fremder Session", () => {
    expect(offen(lauf(mit((b) => { b.punkte.abnahme.observations = ["gibt-es-nicht"]; })))).toEqual(["5"]);
    const e = export_(); e.observations.push({ ...gen("x", ""), id: "fremd-1", sessionId: "andere" });
    expect(offen(lauf(mit((b) => { b.punkte.abnahme.observations = ["fremd-1"]; }), e))).toEqual(["5"]);
  });
  test("ausgabe statt observations nur bei den Punkten ohne Export", () => {
    const r = lauf(mit((b) => { b.punkte.abnahme.observations = []; (b.punkte.abnahme as { ausgabe?: string }).ausgabe = "x"; }));
    expect(offen(r)).toEqual(["5"]);
  });
  test("Beleg-Verweis streng: gemischte IDs und ohneExport ohne ausgabe sind offen; Langfuse-Mangel trifft Nachweis 4; Bericht null", () => {
    expect(offen(lauf(mit((b) => { b.punkte.playwright.observations = ["tool-1", "gibt-es-nicht"]; })))).toEqual(["2"]);
    expect(offen(lauf(mit((b) => { (b.punkte["defekter-mcp"] as { ausgabe: string }).ausgabe = ""; })))).toEqual(["2"]);
    const e = export_(); e.observations = e.observations.filter((o) => o.type !== "TOOL");
    expect(offen(lauf(mit((b) => { for (const p of Object.values(b.punkte)) if (p.observations.length) p.observations = ["gen-main"]; }), e))).toEqual(["4"]);
    expect(offen(lauf(null))).toHaveLength(5);
  });
  test("Zuordnung der Punkte zu den Nachweisen und die ohneExport-Liste (abgeschrieben aus docs/codex/probe.md)", () => {
    const soll = { "read-abbildung": 1, playwright: 2, langfuse: 2, "unbekannte-rolle": 2, "defekter-mcp": 2, "hook-deny:shell": 3, "hook-deny:patch": 3, "hook-deny:agent": 3, "hook-fehler": 3, "hook-timeout": 3, "write-stdin": 3, dateiwerkzeug: 3, fremdtext: 3, "hooks-geladen": 3, "hook-format:agent": 3, "subagent-start": 3, "tracing-ausfall": 4, abnahme: 5, ...Object.fromEntries(rollen.map((r) => [`rolle:${r}`, 1])) };
    expect(Object.fromEntries(punkte.map((p) => [p.id, p.nachweis]))).toEqual(soll);
    expect(punkte.filter((p) => p.ohneExport).map((p) => p.id).sort()).toEqual(["dateiwerkzeug", "defekter-mcp", "hook-format:agent", "hooks-geladen", "subagent-start", "tracing-ausfall"]);
  });
  test.each([["hooks-geladen", "3"], ["hook-format:agent", "3"], ["subagent-start", "3"], ["tracing-ausfall", "4"]])("fehlt der Punkt %s im Bericht: Nachweis %s offen, der Rest nicht (factory#457)", (id, nachweis) => {
    const r = lauf(mit((b) => { delete (b.punkte as Record<string, unknown>)[id]; }));
    expect(offen(r)).toEqual([nachweis]);
    expect(r.maengel.join()).toContain(id);
    expect(a.auswertungExit(r)).toBe(1);
  });
  test("leere version/sessionId auf beiden Seiten und ein Export ohne observations-Liste: alle fünf offen, kein Wurf", () => {
    const e0 = export_();
    expect(offen(lauf(mit((b) => { b.version = ""; }), { ...e0, version: "" }))).toEqual(["1", "2", "3", "4", "5"]);
    const ohneSession = { ...e0, sessionId: "", observations: e0.observations.map((o) => ({ ...o, sessionId: "" })) };
    expect(offen(lauf(mit((b) => { b.sessionId = ""; }), ohneSession))).toEqual(["1", "2", "3", "4", "5"]);
    expect(offen(lauf(bericht(), { ...export_(), observations: undefined })).length).toBeGreaterThan(0);
  });
  test("ergebnis offen zählt als offen", () => {
    const r = lauf(mit((b) => { b.punkte.langfuse.ergebnis = "offen"; }));
    expect([offen(r), r.maengel.join()]).toEqual([["2"], expect.stringContaining("langfuse")]);
  });
  test("playwright fehlt in tools: Nachweis 2 offen", () => {
    const e = export_(); e.tools = ["langfuse"];
    expect(offen(lauf(bericht(), e))).toEqual(["2"]);
  });
  test("Rolle fehlt im Inventar: Nachweis 1; fehlende Rollen-Generation: Nachweise 1 und 4", () => {
    const e = export_(); e.rollen = e.rollen.slice(1);
    expect(offen(lauf(bericht(), e))).toEqual(["1"]);
    const g = export_(); g.observations = g.observations.filter((o) => o.metadata[ROLLEN_KEY] !== rollen[0]);
    expect(offen(lauf(bericht(), g))).toEqual(["1", "4"]);
  });
  test.each([
    ["unbekannte Punkt-ID", (b: ReturnType<typeof bericht>) => { (b.punkte as Record<string, unknown>).erfunden = { ergebnis: "belegt", beobachtung: "", observations: [] }; }],
    ["Version ungleich", (b: ReturnType<typeof bericht>) => { b.version = "0.0.1"; }],
    ["sessionId ungleich", (b: ReturnType<typeof bericht>) => { b.sessionId = "andere"; }],
    ["ergebnis ungültig", (b: ReturnType<typeof bericht>) => { b.punkte.playwright.ergebnis = "ja"; }],
    ["beobachtung kein Text", (b: ReturnType<typeof bericht>) => { (b.punkte.playwright as { beobachtung: unknown }).beobachtung = 1; }],
    ["observations mit Nicht-ID", (b: ReturnType<typeof bericht>) => { (b.punkte.playwright as { observations: unknown }).observations = ["tool-1", 2]; }],
    ["ausgabe kein Text", (b: ReturnType<typeof bericht>) => { (b.punkte.abnahme as { ausgabe: unknown }).ausgabe = 3; }],
    ["Punkt kein Objekt", (b: ReturnType<typeof bericht>) => { (b.punkte as Record<string, unknown>).abnahme = null; }],
    ["frischeSession false", (b: ReturnType<typeof bericht>) => { (b as { frischeSession: boolean }).frischeSession = false; }],
    ["falscher Typ", (b: ReturnType<typeof bericht>) => { (b.punkte.playwright as { observations: unknown }).observations = "tool-1"; }],
  ])("Schema-Mangel (%s): alle fünf Nachweise offen", (_n, aend) => {
    const r = lauf(mit(aend));
    expect(offen(r)).toEqual(["1", "2", "3", "4", "5"]);
    exit1(r);
  });
});

describe("Zuordnung der Belegdiagnose zu Nachweisen (Drift-Wächter, W8)", () => {
  test("jede Meldung von bewerteBelege landet in einem benannten Nachweis, nie im Rückfall 1-5", () => {
    const leer = belegeLib.bewerteBelege({}, config);
    const widerspruch = export_();
    widerspruch.observations = [...widerspruch.observations, { ...gen("main", ""), usageDetails: { input: 1, output: 3 } }, ...widerspruch.observations.map((o) => ({ ...o, metadata: { ...o.metadata, [ROLLEN_KEY]: "default" } }))];
    const ohneTool = export_(); ohneTool.observations = ohneTool.observations.filter((o) => o.type !== "TOOL");
    const alleMeldungen = [...leer, ...belegeLib.bewerteBelege(widerspruch, config), ...belegeLib.bewerteBelege(ohneTool, config), ...belegeLib.bewerteBelege({ ...export_(), observations: [] }, config)];
    expect(alleMeldungen.length).toBeGreaterThan(8);
    expect(a.nachweiseDerDiagnose("Neue Meldung")).toEqual(["1", "2", "3", "4", "5"]); // Unbekanntes: fail-closed
    for (const m of alleMeldungen) expect(a.nachweiseDerDiagnose(m), m).not.toHaveLength(5);
  });
});

describe("Einstieg auswerten", () => {
  test("Exit 2 bei fehlendem Flag und kaputtem JSON; sonst Exit 1 mit JSON (autonom false) bei einem offenen Bericht", () => {
    const cli = (...args: string[]) => spawnSync(process.execPath, ["scripts/codex-probe.mjs", "auswerten", ...args], { encoding: "utf8" });
    const t = mkdtempSync(join(tmpdir(), "codex-probe-auswertung-"));
    try {
      for (const [n, inhalt] of [["kaputt", "{nicht json"], ["e", JSON.stringify(export_())], ["leer", "{}"]]) writeFileSync(join(t, `${n}.json`), inhalt);
      const pfad = (n: string) => join(t, `${n}.json`);
      expect(cli().status).toBe(2);
      expect(cli("--belege", pfad("kaputt"), "--bericht", pfad("leer")).status).toBe(2);
      expect(cli("--belege", pfad("gibts-nicht"), "--bericht", pfad("leer")).status).toBe(2);
      const r = cli("--belege", pfad("e"), "--bericht", pfad("leer"));
      expect(r.status).toBe(1);
      expect((JSON.parse(r.stdout) as Ergebnis).autonom).toBe(false);
    } finally { rmSync(t, { recursive: true, force: true }); }
  });
});
