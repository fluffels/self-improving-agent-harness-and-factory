/**
 * Code-Analyse (factory#596): Lib, Einstieg mit eingespeisten Nähten, Workflow-Wächter (kein Modell, kein Modell-Schlüssel).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as skriptRaw from "../scripts/code-analyse.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/code-analyse-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cfgRaw from "../scripts/projekt-config-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const lies = (p: string) => readFileSync(`${WURZEL}${p}`, "utf8");
type Einst = { an: boolean; quelle: string };
const L = libRaw as unknown as {
  MARKER: string;
  TITEL_PRAEFIX: string;
  titel: (d: string) => string;
  istTicket: (i: unknown, o: string, c: unknown) => boolean;
  entscheide: (a: { offene: unknown[]; owner: string; config: unknown }) => { aktion: string; grund: string };
  ticketText: (a: { datum: string; refactoring: Einst }) => string;
};
const S = skriptRaw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> };
const C = cfgRaw as unknown as { ladeProjektConfig: () => { repo: string } & Record<string, unknown> };
const config = C.ladeProjektConfig();
const REPO: string = config.repo;
const owner = REPO.split("/")[0];
const AN: Einst = { an: true, quelle: "refactoring" };
const AUS: Einst = { an: false, quelle: "aus" };

const issue = (extra: Record<string, unknown> = {}) => ({ number: 5, title: `${L.TITEL_PRAEFIX}2026-10`, body: `${L.MARKER}\nx`, user: { login: owner, type: "User" }, labels: [], ...extra });
const cliIssue = (extra: Record<string, unknown> = {}) => {
  const i = issue(extra) as Record<string, unknown>;
  return { number: i.number, title: i.title, body: i.body, author: { login: owner, is_bot: false }, labels: [] };
};

describe("Lib code-analyse-lib", () => {
  test("titel: Präfix und Monat", () => {
    expect(L.titel("2031-04-09")).toBe("🧭 Code-Analyse 2031-04");
  });
  test("istTicket braucht Marker und Titelpräfix", () => {
    expect(L.istTicket(issue(), owner, config)).toBe(true);
    expect(L.istTicket(issue({ body: "ohne Marker" }), owner, config)).toBe(false);
    expect(L.istTicket(issue({ title: "Anderes" }), owner, config)).toBe(false);
  });
  test("istTicket: ein Fremdeingang zählt nicht", () => {
    expect(L.istTicket(issue({ user: { login: "fremd", type: "User" } }), owner, config)).toBe(false);
  });
  test("entscheide: kein Ticket → anlegen", () => {
    expect(L.entscheide({ offene: [], owner, config }).aktion).toBe("anlegen");
  });
  test("ein offenes Issue, das kein Takt-Ticket ist, verhindert das Anlegen nicht", () => {
    expect(L.entscheide({ offene: [issue({ title: "Anderes" }), issue({ body: "x" })], owner, config }).aktion).toBe("anlegen");
    expect(L.entscheide({ offene: [issue({ title: "Anderes" }), issue()], owner, config }).aktion).toBe("nichts");
  });
  test("AK 3: ein offenes Takt-Ticket → nichts, auch geclaimt", () => {
    expect(L.entscheide({ offene: [issue()], owner, config }).aktion).toBe("nichts");
    expect(L.entscheide({ offene: [issue({ assignees: [{ login: owner }] })], owner, config }).aktion).toBe("nichts");
  });
  test("ticketText (an): vier Kategorien, melden.mjs-Zeile, Deckel, Sicherheit, Verweise", () => {
    const t = L.ticketText({ datum: "2031-04-09", refactoring: AN });
    expect(t.startsWith(L.MARKER)).toBe(true);
    for (const k of ["Refactoring", "Duplikate", "Komplexität", "Testlücken"]) expect(t).toContain(k);
    expect(t).toContain("node scripts/melden.mjs --ziel refactoring --zeile");
    expect(t).toContain("höchstens 12 Zeilen");
    expect(t).toContain("Kosmetik und Hypothese zusammen höchstens eine Zeile je Lauf");
    expect(t).toContain("🔒 Security:");
    expect(t).toContain("codeql.yml");
    expect(t).toContain("sicherheitspruefung.yml");
    expect(t).not.toContain("abgeschaltet");
  });
  test("AK 4: ticketText (aus): kein Code-Abschnitt, Code-Teil abgeschaltet, Sicherheit bleibt", () => {
    for (const einst of [AUS, { an: false, quelle: "standard" }]) {
      const t = L.ticketText({ datum: "2031-04-09", refactoring: einst });
      expect(t).toContain("Code-Teil: abgeschaltet");
      expect(t).not.toContain("melden.mjs");
      expect(t).not.toContain("Duplikate");
      expect(t).toContain("🔒 Security:");
    }
  });
});

type Opt = { argv?: string[]; issues?: unknown[]; frisch?: unknown[]; frischFehler?: boolean; env?: Record<string, string>; config?: Record<string, unknown>; bezieher?: boolean; boardFehler?: boolean; antwort?: string };
async function lauf(o: Opt = {}) {
  const r = { code: -1, schreib: [] as string[][], bodies: [] as string[], lesen: [] as string[][], board: [] as string[][], out: "" };
  const out: string[] = [];
  r.code = await S.main(o.argv ?? [], {
    ladeConfig: () => o.config ?? config,
    ladeLibs: () => Promise.resolve({ REPO, platziereAmEnde: (nr: number, token: string) => { r.board.push([String(nr), token]); if (o.boardFehler) throw new Error("Board nicht erreichbar"); } }),
    gh: (args: string[]) => {
      r.lesen.push(args);
      if (args[0] === "issue") return JSON.stringify(o.issues ?? []);
      if (args.join(" ").includes("issues?state=open")) {
        if (o.frischFehler) throw new Error("HTTP 502");
        return JSON.stringify([[], o.frisch ?? []]);
      }
      return "{}";
    },
    schreibe: (args: string[], input: string) => {
      r.schreib.push(args);
      r.bodies.push(input);
      return o.antwort ?? `https://github.com/${REPO}/issues/77\n`;
    },
    bezieher: () => o.bezieher ?? false,
    env: o.env ?? { PROJECT_TOKEN: "t" },
    heute: "2031-04-09",
    log: (m: string) => out.push(m),
    err: (m: string) => out.push(m),
  });
  r.out = out.join("\n");
  return r;
}
const frischForm = (i: ReturnType<typeof cliIssue>) => ({ number: i.number, title: i.title, body: i.body, user: { login: owner, type: "User" }, labels: [] });

describe("Einstieg code-analyse.mjs", () => {
  test("Trockenlauf schreibt nichts und gibt Titel und Entscheidung aus", async () => {
    const r = await lauf({ argv: ["--dry-run"] });
    expect(r.code).toBe(0);
    expect(r.schreib).toEqual([]);
    expect(r.out).toContain("[dry-run] 🧭 Code-Analyse 2031-04");
    expect(r.out).toContain("Entscheidung: anlegen");
  });
  test("fremdes GITHUB_REPOSITORY → Exit 1 ohne Schreibaufruf", async () => {
    const r = await lauf({ env: { GITHUB_REPOSITORY: "fremd/anderes", PROJECT_TOKEN: "t" } });
    expect(r.code).toBe(1);
    expect(r.schreib).toEqual([]);
    expect(r.lesen).toEqual([]);
  });
  test("AK 3: offenes Takt-Ticket → kein Schreibaufruf", async () => {
    const r = await lauf({ issues: [cliIssue()] });
    expect(r.code).toBe(0);
    expect(r.schreib).toEqual([]);
    expect(r.out).toContain("nichts zu tun");
  });
  test("AK 3: erst von der Zweitabfrage gefundenes Ticket → kein Schreibaufruf", async () => {
    const r = await lauf({ issues: [], frisch: [frischForm(cliIssue())] });
    expect(r.code).toBe(0);
    expect(r.schreib).toEqual([]);
  });
  test("Zweitabfrage scheitert → fail-closed, kein Schreibaufruf, Warnung", async () => {
    const r = await lauf({ frischFehler: true });
    expect(r.code).toBe(0);
    expect(r.schreib).toEqual([]);
    expect(r.out).toMatch(/::warning::.*Zweitabfrage/);
  });
  test("ein fremdes offenes Issue neben leerer Takt-Liste: genau eine Anlage", async () => {
    const r = await lauf({ issues: [cliIssue({ number: 9, title: "Anderes", body: "x" })] });
    expect(r.schreib).toHaveLength(1);
  });
  test("ein fremdes Issue erst in der Zweitabfrage blockiert das Anlegen nicht", async () => {
    const r = await lauf({ issues: [], frisch: [frischForm(cliIssue({ number: 9, title: "Anderes", body: "x" }))] });
    expect(r.code).toBe(0);
    expect(r.schreib).toHaveLength(1);
  });
  test("der Standard-Leseweg nutzt github.token, nie PROJECT_TOKEN", () => {
    expect(lies("scripts/code-analyse.mjs")).not.toMatch(/token:\s*env\.PROJECT_TOKEN/);
  });
  test("gleiches GITHUB_REPOSITORY → Exit 0 und genau eine Anlage", async () => {
    const r = await lauf({ env: { GITHUB_REPOSITORY: REPO, PROJECT_TOKEN: "t" } });
    expect(r.code).toBe(0);
    expect(r.schreib).toHaveLength(1);
  });
  test("Antworten ohne gültige Issue-Nummer → Exit 1, keine Board-Sortierung", async () => {
    for (const antwort of [`https://github.com/${REPO}/pull/77`, `https://github.com/${REPO}/issues/0`, `https://github.com/${REPO}/issues/77 x`]) {
      const r = await lauf({ antwort });
      expect(r.code, antwort).toBe(1);
      expect(r.board, antwort).toEqual([]);
    }
  });
  test("das Label kommt nur mit, wenn sein Ziel das eigene Repo ist", async () => {
    const mit = await lauf();
    const label = mit.schreib[0].indexOf("--label");
    expect(label).toBeGreaterThan(-1);
    expect(mit.schreib[0][label + 1]).toBe((config.labels as Record<string, string>).dependabotInbox);
  });
  test("Liste mit ≥ 1000 Einträgen → Exit 1, kein Schreibaufruf (fail-closed)", async () => {
    const r = await lauf({ issues: Array.from({ length: 1000 }, (_, n) => cliIssue({ number: n + 100, title: "x", body: "" })) });
    expect(r.code).toBe(1);
    expect(r.schreib).toEqual([]);
  });
  test("Anlage: genau ein Schreibaufruf ins eigene Repo, danach Board-Sortierung", async () => {
    const r = await lauf();
    expect(r.code).toBe(0);
    expect(r.schreib).toHaveLength(1);
    expect(r.schreib[0].slice(0, 2)).toEqual(["issue", "create"]);
    expect(r.schreib[0][r.schreib[0].indexOf("--repo") + 1]).toBe(REPO);
    expect(r.bodies[0]).toContain(L.MARKER);
    expect(r.board).toEqual([["77", "t"]]);
  });
  test("ohne PROJECT_TOKEN nur eine Warnung", async () => {
    const r = await lauf({ env: {} });
    expect(r.code).toBe(0);
    expect(r.schreib).toHaveLength(1);
    expect(r.board).toEqual([]);
    expect(r.out).toContain("::warning::PROJECT_TOKEN fehlt");
  });
  test("Board-Fehler ist nur eine Warnung", async () => {
    const r = await lauf({ boardFehler: true });
    expect(r.code).toBe(0);
    expect(r.out).toContain("nicht ans Ende der Todo-Spalte sortiert");
  });
  test("Ticketnummer nicht lesbar → Exit 1", async () => {
    expect((await lauf({ antwort: "kaputt" })).code).toBe(1);
  });
  test("AK 4: labels.refactoring false → Body weist den Code-Teil als abgeschaltet aus", async () => {
    const r = await lauf({ config: { ...config, labels: { ...(config.labels as object), refactoring: false } } });
    expect(r.bodies[0]).toContain("Code-Teil: abgeschaltet (labels.refactoring: false)");
    expect(r.bodies[0]).toContain("🔒 Security:");
  });
  test("Bezieher ohne Schlüssel: Code-Teil an", async () => {
    const r = await lauf({ bezieher: true });
    expect(r.bodies[0]).toContain("melden.mjs --ziel refactoring");
  });
  test("Aufrufer mit unbekanntem Flag → Exit 2", async () => {
    expect((await lauf({ argv: ["--foo"] })).code).toBe(2);
  });
});

describe("Wächter: Skript und Workflow ohne Modell und ohne Modell-Schlüssel (AK 5)", () => {
  type Schritt = { uses?: string; with?: Record<string, unknown>; run?: string };
  const pfad = ".github/workflows/code-analyse.yml";
  const text = lies(pfad);
  const wf = parse(text) as { on: { schedule: { cron: string }[] } & Record<string, unknown>; permissions: unknown; jobs: Record<string, { permissions?: unknown; steps: Schritt[] }> };
  const sp = parse(lies(".github/workflows/sicherheitspruefung.yml")) as { on: { schedule: { cron: string }[] } };

  test("nur schedule und workflow_dispatch", () => {
    expect(Object.keys(wf.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });
  test("Cron: Tag, Monat und Wochentag wie sicherheitspruefung.yml", () => {
    const f = (c: string) => c.split(" ").slice(2).join(" ");
    expect(f(wf.on.schedule[0].cron)).toBe(f(sp.on.schedule[0].cron));
    expect(f(wf.on.schedule[0].cron)).toBe("1 * *");
  });
  test("Rechte oben genau contents: read und issues: write", () => {
    expect(wf.permissions).toEqual({ contents: "read", issues: "write" });
    expect(Object.values(wf.jobs).every((j) => j.permissions === undefined)).toBe(true);
  });
  test("checkout ohne persistierte Credentials, Actions per SHA, kein npm, kein --repo", () => {
    const schritte = wf.jobs["code-analyse"].steps;
    expect(schritte[0].with?.["persist-credentials"]).toBe(false);
    for (const s of schritte.filter((x) => x.uses)) expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    expect(text).not.toMatch(/npm (ci|install)|--repo/);
  });
  test("trocken kommt über env, nicht als Ausdruck im run-Block", () => {
    const run = wf.jobs["code-analyse"].steps.at(-1)?.run ?? "";
    expect(run).not.toContain("${{");
    expect(run).toContain("--dry-run");
  });
  test("kein Modell, kein Modell-Schlüssel: einzige Secret-Referenz ist PROJECT_TOKEN", () => {
    expect(text).not.toMatch(/anthropics\/|claude/i);
    expect(text).not.toMatch(/ANTHROPIC|CLAUDE_|OPENAI|API_KEY/i);
    expect([...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1])).toEqual(["PROJECT_TOKEN"]);
  });
  test("Skript und Lib: kein Modellaufruf, keine Schreibaufrufe außer issue create", () => {
    for (const p of ["scripts/code-analyse.mjs", "scripts/code-analyse-lib.mjs"]) {
      const q = lies(p);
      expect(q).not.toMatch(/ANTHROPIC|CLAUDE_|OPENAI|API_KEY|anthropic\.com/i);
      expect(q).not.toMatch(/"(close|comment|edit|delete|lock)"/);
    }
    expect([...lies("scripts/code-analyse.mjs").matchAll(/"--repo"/g)]).toHaveLength(0);
    expect([...lies("scripts/inbox-start-lib.mjs").matchAll(/"issue", "create", "--repo", ([^,\]]+)/g)].map((m) => m[1])).toEqual(["ziel", "repo"]);
  });
});
