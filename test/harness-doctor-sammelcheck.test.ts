/* Doctor-Punkt `Sammel-Check` (factory#401): needs-Vollständigkeit des Sammel-Jobs (L53) und Alarm-Aufruf bei rotem main (L52), jeder Zweig mit seinem Negativfall. */
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { sammelCheckPunkt as rawPunkt } from "../scripts/harness-doctor-sammelcheck.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { blockformJobs as rawJobs } from "../scripts/workflow-blockform.mjs";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeDateien as rawDateien } from "../scripts/harness-doctor-dateien.mjs";

interface Workflow { pfad: string; text: string }
interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; hinweis?: string; befund?: string; fix?: string }
const punktFuer = rawPunkt as (e: { config?: unknown; workflows?: Workflow[]; vorAbbruch?: boolean }) => Ergebnis;
const jobsLesen = rawJobs as (t: string) => { ausloeser?: string[]; jobs?: { id: string; needs: string[]; if: string | null; uses: string | null }[]; fehler?: { zeile: number; konstrukt: string } };

const ALARM_USES = "./.github/workflows/alarm-rot-main.yml";
const CONFIG = { sammelChecks: [{ workflow: "ci.yml", job: "gate" }] };
const KOPF = "name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n";
const BUILD = "  build:\n    runs-on: ubuntu-latest\n  audit:\n    runs-on: ubuntu-latest\n";
const GATE = "  gate:\n    needs: [build, audit]\n    if: always()\n    runs-on: ubuntu-latest\n";
const ALARM = `  alarm:\n    needs: [gate]\n    if: failure() && github.event_name == 'push'\n    uses: ${ALARM_USES}\n    with:\n      label: area:x\n`;
const GUT = KOPF + BUILD + GATE + ALARM;
const ci = (text: string): Workflow[] => [{ pfad: "ci.yml", text }];
const lauf = (text: string, config: unknown = CONFIG) => punktFuer({ config, workflows: ci(text) });

describe("Sammel-Check (factory#401)", () => {
  test("gut: jeder Job in needs des Sammel-Jobs, Alarm-Job mit failure() und push", () => {
    expect(lauf(GUT)).toEqual({ punkt: "Sammel-Check", ok: true });
  });

  test("ohne sammelChecks: OK mit Hinweis, auch ohne Config", () => {
    for (const config of [{}, null, undefined]) {
      const p = punktFuer({ config, workflows: [] });
      expect(p.ok).toBe(true);
      expect(p.hinweis).toMatch(/keine Sammel-Checks konfiguriert \(sammelChecks der Projekt-Config\)/);
    }
  });

  test("L53: ein neuer Job ohne needs-Eintrag ist eine Lücke mit Jobnamen", () => {
    const p = lauf(GUT.replace(BUILD, `${BUILD}  neu:\n    runs-on: ubuntu-latest\n`));
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toMatch(/ci\.yml.*gate.*neu/);
    expect(p.befund).not.toMatch(/build|audit|alarm/);
    expect(p.fix).toContain("`needs: [build, audit, neu]`");
    expect(p.fix).toContain("node scripts/harness-doctor.mjs --pruefen");
    expect(p.fix).not.toContain("npm run");
  });

  test("L53: needs als Skalar oder Block-Liste zählen, ein Alarm-Aufruf braucht keinen Eintrag", () => {
    expect(lauf(GUT.replace("needs: [build, audit]", "needs:\n      - build\n      - audit")).ok).toBe(true);
    expect(lauf(KOPF + "  build:\n    runs-on: x\n  gate:\n    needs: build\n" + ALARM).ok).toBe(true);
    expect(lauf(GUT.replace("needs: [build, audit]", "needs: [build]")).befund).toMatch(/audit/);
  });

  test("L52: Alarm-Job ohne failure() im if ist eine Lücke", () => {
    const p = lauf(GUT.replace("failure() && ", ""));
    expect(p.ok).toBe(false);
    expect(p.befund).toMatch(/failure\(\)/);
    expect(p.fix).toContain(ALARM_USES);
  });

  test("L52: Alarm-Job ohne push-Bedingung im if ist eine Lücke", () => {
    expect(lauf(GUT.replace(" && github.event_name == 'push'", "")).befund).toMatch(/github\.event_name == 'push'/);
    expect(lauf(GUT.replace("    if: failure() && github.event_name == 'push'\n", "")).ok).toBe(false);
  });

  test("L52: failure() und push werden genau erkannt (Wortlaut, Leerraum, Quotes)", () => {
    expect(lauf(GUT.replace("failure()", "cancelled()")).befund).toMatch(/failure\(\)/);
    expect(lauf(GUT.replace("github.event_name", "githubXevent_name")).befund).toMatch(/push/);
    expect(lauf(GUT.replace("github.event_name == 'push'", "github.event_name==\"push\"")).ok).toBe(true);
    expect(lauf(GUT.replace("github.event_name == 'push'", "github.event_name == 'pull_request'")).ok).toBe(false);
  });

  test("L52: kein Alarm-Job, oder sein needs nennt den Sammel-Job nicht", () => {
    const ohne = lauf(KOPF + BUILD + GATE);
    expect(ohne.ok).toBe(false);
    expect(ohne.befund).toMatch(/kein Job ruft .*alarm-rot-main\.yml/);
    expect(lauf(GUT.replace("needs: [gate]", "needs: [build]")).befund).toMatch(/needs.*gate/);
    expect(lauf(GUT.replace("needs: [gate]\n", "")).ok).toBe(false);
  });

  test("L52: der Workflow läuft nicht auf push (Skalar, Liste, Objekt)", () => {
    const ohnePush = (on: string) => lauf(GUT.replace("on:\n  push:\n    branches: [main]\n  pull_request:\n", on));
    expect(ohnePush("on:\n  pull_request:\n").befund).toMatch(/push/);
    expect(ohnePush("on: pull_request\n").ok).toBe(false);
    expect(ohnePush("on: [pull_request, workflow_dispatch]\n").ok).toBe(false);
    expect(ohnePush("on: push\n").ok).toBe(true);
    expect(ohnePush("on: [pull_request, push]\n").ok).toBe(true);
    expect(ohnePush("on:\n  - push\n").ok).toBe(true);
  });

  test("Workflow fehlt: Lücke; Sammel-Job fehlt: Lücke; YAML unlesbar: nicht prüfbar", () => {
    const fehlt = punktFuer({ config: CONFIG, workflows: [] });
    expect(fehlt.ok).toBe(false);
    expect(fehlt.nichtPruefbar).toBeUndefined();
    expect(fehlt.befund).toMatch(/ci\.yml.*fehlt/);
    expect(punktFuer({ config: CONFIG, workflows: undefined }).befund).toMatch(/ci\.yml.*fehlt/);
    const keinJob = lauf(GUT.replace("  gate:\n", "  tor:\n").replace("needs: [gate]", "needs: [tor]"));
    expect(keinJob.ok).toBe(false);
    expect(keinJob.befund).toMatch(/Job „gate“.*fehlt/);
    const kaputt = lauf("name: CI\non:\n  push:\njobs: {a: 1}\n");
    expect(kaputt.nichtPruefbar).toBe(true);
    expect(kaputt.befund).toMatch(/ci\.yml/);
  });

  test("sammelChecks keine Liste: nicht prüfbar", () => {
    const p = lauf(GUT, { sammelChecks: "ci.yml" });
    expect(p.nichtPruefbar).toBe(true);
    expect(p.fix).toMatch(/sammelChecks/);
  });

  test("zwei Einträge werden in einem Punkt zusammengefasst, beide Befunde stehen darin", () => {
    const config = { sammelChecks: [{ workflow: "ci.yml", job: "gate" }, { workflow: "b.yml", job: "tor" }] };
    const zwei = punktFuer({ config, workflows: [...ci(GUT.replace(BUILD, `${BUILD}  neu:\n    runs-on: x\n`)), { pfad: "b.yml", text: GUT.replaceAll("gate", "tor") }] });
    expect(zwei.punkt).toBe("Sammel-Check");
    expect(zwei.befund).toMatch(/ci\.yml.*neu/);
    const gut = punktFuer({ config, workflows: [...ci(GUT), { pfad: "b.yml", text: GUT.replaceAll("gate", "tor") }] });
    expect(gut.ok).toBe(true);
    const schlecht = punktFuer({ config, workflows: ci(GUT) });
    expect(schlecht.befund).toMatch(/b\.yml/);
  });
});

describe("Sammel-Check, Review-Runde 1 (factory#401)", () => {
  const dateipunkt = (a: Record<string, unknown>) => (rawDateien({ rootDir: "/nirgends", git: () => [], existiert: () => true, lies: () => null, ...a }) as Ergebnis[]).find((p) => p.punkt === "Sammel-Check")!;

  test("Verdrahtung: pruefeDateien reicht config und workflows an den Punkt (Lücke und gesund)", () => {
    const schlecht = dateipunkt({ config: CONFIG, workflows: ci(GUT.replace(BUILD, `${BUILD}  neu:\n    runs-on: x\n`)) });
    expect(schlecht.ok).toBe(false);
    expect(schlecht.befund).toMatch(/neu/);
    const gesund = dateipunkt({ config: CONFIG, workflows: ci(GUT) });
    expect(gesund).toEqual({ punkt: "Sammel-Check", ok: true });
  });

  test("Vorab-Abbruch: nicht prüfbar statt einer Fehl-Lücke „Workflow-Datei fehlt“", () => {
    const p = dateipunkt({ config: CONFIG, workflows: [], vorAbbruch: true });
    expect(p.nichtPruefbar).toBe(true);
    expect(p.befund).not.toMatch(/fehlt unter/);
    expect(punktFuer({ config: CONFIG, workflows: ci(GUT), vorAbbruch: true }).nichtPruefbar).toBe(true);
  });

  test("ein Eintrag, der kein Objekt ist, wirft nicht (ungeprüfte Config im Vorab-Abbruch)", () => {
    for (const e of [null, "x", 3]) expect(lauf(GUT, { sammelChecks: [e] }).nichtPruefbar).toBe(true);
  });

  test("nachgelagerte Jobs (deploy hinter dem Sammel-Job) sind keine Pflicht-needs, direkt und über mehrere Stufen", () => {
    const deploy = "  deploy:\n    needs: [gate]\n    runs-on: x\n  spaeter:\n    needs: [deploy]\n    runs-on: x\n";
    const p = lauf(GUT.replace(ALARM, `${deploy}${ALARM}`));
    expect(p).toEqual({ punkt: "Sammel-Check", ok: true });
    const fehlt = lauf(GUT.replace(ALARM, `${deploy}  neu:\n    runs-on: x\n${ALARM}`));
    expect(fehlt.befund).toMatch(/„neu“/);
    expect(fehlt.befund).not.toMatch(/deploy|spaeter/);
    expect(fehlt.fix).toContain("`needs: [build, audit, neu]`");
  });

  test("Zyklus in needs führt nicht zur Endlosschleife", () => {
    expect(lauf(KOPF + "  a:\n    needs: [b]\n  b:\n    needs: [a]\n  gate:\n    needs: [a, b]\n" + ALARM).ok).toBe(true);
  });

  test("zwei Sammel-Jobs in einem Workflow: jeder braucht seinen eigenen Alarm-Aufruf mit needs auf ihn", () => {
    const config = { sammelChecks: [{ workflow: "ci.yml", job: "gate" }, { workflow: "ci.yml", job: "g2" }] };
    const g2 = "  g2:\n    needs: [build, audit, gate]\n    runs-on: x\n";
    const alarm2 = ALARM.replace("alarm:", "alarm2:").replace("needs: [gate]", "needs: [g2]");
    expect(punktFuer({ config, workflows: ci(GUT.replace(ALARM, g2 + ALARM + alarm2)) })).toEqual({ punkt: "Sammel-Check", ok: true });
    const nur1 = punktFuer({ config, workflows: ci(GUT.replace(ALARM, g2 + ALARM)) });
    expect(nur1.ok).toBe(false);
    expect(nur1.befund).toMatch(/Alarm-Job „alarm“.*needs nennt „g2“ nicht/);
  });

  test("Alarm-if: failure als Wort und ein verlängertes push sind keine Treffer", () => {
    expect(lauf(GUT.replace("failure()", "steps.x.outputs.failure == 'true'")).befund).toMatch(/failure\(\)/);
    expect(lauf(GUT.replace("== 'push'", "== 'pushx'")).befund).toMatch(/push/);
  });

  test("Fix-Text und Befund nennen Jobname, Zeile und Konstrukt", () => {
    expect(lauf(KOPF + BUILD + GATE).fix).toContain("needs: [gate]");
    expect(lauf("name: CI\non:\n  push:\njobs: {a: 1}\n").befund).toMatch(/ci\.yml:4 /);
  });
});

describe("blockformJobs (factory#401): der Leser stimmt mit der yaml-Bibliothek überein", () => {
  const FAELLE = [GUT, KOPF + "  a:\n    needs: b\n  b:\n    needs:\n    - c\n  c:\n    if: ${{ always() }}\n    uses: ./x.yml\n", "on: push\njobs:\n  a:\n    steps:\n      - uses: x/y@v1\n        if: true\n"];
  test.each(FAELLE.map((t, i) => [i, t] as const))("Fall %i", (_i, text) => {
    const soll = parse(text) as { on: unknown; jobs: Record<string, { needs?: string | string[]; if?: string; uses?: string }> };
    const r = jobsLesen(text);
    expect(r.jobs?.map((j) => j.id)).toEqual(Object.keys(soll.jobs));
    for (const j of r.jobs ?? []) {
      const s = soll.jobs[j.id];
      expect(j.needs).toEqual(s.needs === undefined ? [] : [s.needs].flat());
      expect(j.uses).toBe(s.uses ?? null);
      expect(j.if).toBe(s.if ?? null);
    }
    const on = soll.on;
    const trigger = typeof on === "string" ? [on] : Array.isArray(on) ? on : Object.keys(on as object);
    expect(r.ausloeser).toEqual(trigger);
  });

  test("Randfälle: leerer Job, leeres on und jobs, leere Listeneinträge, BOM, CRLF, Listen statt Mapping", () => {
    expect(jobsLesen("on:\njobs:\n  a:\n  b:\n    needs: a\n")).toEqual({ ausloeser: [], jobs: [{ id: "a", needs: [], if: null, uses: null }, { id: "b", needs: ["a"], if: null, uses: null }] });
    expect(jobsLesen("on: push\njobs:\n")).toEqual({ ausloeser: ["push"], jobs: [] });
    expect(jobsLesen("on: [push, '']\njobs:\n  a:\n    needs: [\"\", b]\n")).toEqual({ ausloeser: ["push"], jobs: [{ id: "a", needs: ["b"], if: null, uses: null }] });
    expect(jobsLesen("\ufeffon: push\r\njobs:\r\n  a:\r\n    needs: b\r\n")).toEqual({ ausloeser: ["push"], jobs: [{ id: "a", needs: ["b"], if: null, uses: null }] });
    expect(jobsLesen("on: push\njobs:\n  a:\n    - x\n").fehler?.konstrukt).toBe("Liste als Job");
    expect(jobsLesen("on: push\njobs:\n  - a\n").fehler?.konstrukt).toBe("Liste als jobs");
    expect(jobsLesen("jobs:\n  a:\n    needs: x\n").ausloeser).toEqual([]);
  });

  test("Flow-Mapping unter on, Anker und Flow-Job sind nicht lesbar (fehler statt still leer)", () => {
    expect(jobsLesen("on: {push: {}}\njobs:\n  a:\n    runs-on: x\n").fehler?.konstrukt).toMatch(/Flow/);
    expect(jobsLesen("on:\n  push: {}\njobs: {a: {}}\n").fehler?.konstrukt).toMatch(/Flow/);
    expect(jobsLesen("on: &a push\njobs:\n  a:\n    runs-on: x\n").fehler?.konstrukt).toMatch(/Anker/);
  });
});
