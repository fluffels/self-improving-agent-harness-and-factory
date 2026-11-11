/* Status-Ticket mit dem Config-Schlüssel `langfuseWochenbericht` (factory#314, ADR 0016-Fortschreibung): `entscheideTakt` legt nur bei einem Anlass oder am Höchstabstand des
 * Montags-Crons an, der Push-Auslöser nie; `statusBody` trägt Anlass und Ablageort; `fuehreTaktAus` reicht den Anlass im Factory- und im Bezieher-Pfad durch. Ohne den
 * Schlüssel bleibt jede Entscheidung gleich (Negativfall; die Bestandstests in test/langfuse-takt.test.ts, test/langfuse-bezieher-takt.test.ts und
 * test/board-takt-lauf.test.ts decken sie ab, hier die Gegenprobe mit denselben Eingaben). */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawStatus from "../scripts/langfuse-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTakt from "../scripts/board-takt.mjs";
import { FREMD, FREMD_OWNER } from "./support/fremd-config";

type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Entscheidung = { aktion: string; nr?: number; grund: string; warnungen: string[]; anlass?: string };
type Eingabe = { offene: Offen[]; mergesSeit: number; ticketMerges?: number; ausloeser?: string; stundenSeitAbschluss?: number | null; jetzt?: string; wochenbericht?: Record<string, number>; anlass?: string };
const S = rawStatus as unknown as {
  STATUS_TITEL: string;
  entscheideTakt: (a: Eingabe) => Entscheidung;
  anlassZitat: (t: string) => string;
  statusBody: (a: Record<string, unknown>) => string;
  fuehreStatusAus: (e: Record<string, unknown>, c: Record<string, unknown>) => { ok: boolean };
};
const T = rawTakt as unknown as {
  fuehreTaktAus: (a: Record<string, unknown>) => { fehler: boolean };
  main: (env: Record<string, string>, n: Record<string, unknown>) => number;
};

const W = { erfassungLueckenMax: 0, wochenOhneLaufMax: 4 };
const STUNDEN = 168;
const offen = (number: number, assignees: string[] = []): Offen => ({ number, titel: S.STATUS_TITEL, assignees, createdAt: "2026-10-01T05:00:00Z" });
const e = (a: Partial<Eingabe>): Entscheidung => S.entscheideTakt({ offene: [], mergesSeit: 0, ...a });

describe("entscheideTakt mit Wochenbericht", () => {
  test("Dispatch mit Anlass legt an, auch ohne Merges; die Entscheidung trägt den Anlass", () => {
    const r = e({ ausloeser: "workflow_dispatch", anlass: "Wochenbericht 2026-11-02 fehlt", wochenbericht: W });
    expect(r).toMatchObject({ aktion: "anlegen", anlass: "Wochenbericht 2026-11-02 fehlt" });
    expect(r.grund).toContain("Anlass");
  });
  test("Dispatch ohne Anlass (leer, nur Leerraum, fehlend): nichts", () => {
    for (const anlass of [undefined, "", "  \n "]) expect(e({ ausloeser: "workflow_dispatch", anlass, mergesSeit: 99, wochenbericht: W }).aktion).toBe("nichts");
  });
  test("Mindestabstand bleibt: Anlass bei 23 h seit dem Abschluss nichts, bei 24 h anlegen", () => {
    expect(e({ ausloeser: "workflow_dispatch", anlass: "x", stundenSeitAbschluss: 23, wochenbericht: W }).aktion).toBe("nichts");
    expect(e({ ausloeser: "workflow_dispatch", anlass: "x", stundenSeitAbschluss: 24, wochenbericht: W }).aktion).toBe("anlegen");
  });
  test("Push legt nicht mehr an: ohne offenes Ticket bei 99 Ticket-Merges nichts (ohne Schlüssel dieselbe Eingabe: anlegen)", () => {
    const eingabe = { ausloeser: "push", ticketMerges: 99, mergesSeit: 99, jetzt: "2026-10-08T12:00:00Z" };
    expect(e({ ...eingabe, wochenbericht: W }).aktion).toBe("nichts");
    expect(e(eingabe).aktion).toBe("anlegen");
  });
  test("Push mit offenem ungeclaimtem Ticket und genug Merges: nach-oben bleibt; ein Anlass bei offenem Ticket führt nur zu nach-oben", () => {
    expect(e({ ausloeser: "push", ticketMerges: 50, offene: [offen(7)], wochenbericht: W })).toMatchObject({ aktion: "nach-oben", nr: 7 });
    expect(e({ ausloeser: "workflow_dispatch", anlass: "x", offene: [offen(7)], wochenbericht: W })).toMatchObject({ aktion: "nach-oben", nr: 7 });
    expect(e({ ausloeser: "workflow_dispatch", anlass: "x", offene: [offen(7, [FREMD_OWNER])], wochenbericht: W }).aktion).toBe("nichts");
  });
  test("Höchstabstand am Montags-Cron: 4·168 h − 1 nichts, genau 4·168 h anlegen, ohne Vorgänger anlegen", () => {
    expect(e({ ausloeser: "schedule", stundenSeitAbschluss: 4 * STUNDEN - 1, wochenbericht: W }).aktion).toBe("nichts");
    const grenze = e({ ausloeser: "schedule", stundenSeitAbschluss: 4 * STUNDEN, wochenbericht: W });
    expect(grenze).toMatchObject({ aktion: "anlegen" });
    expect(grenze.anlass).toContain("Höchstabstand");
    expect(e({ ausloeser: "schedule", stundenSeitAbschluss: null, wochenbericht: W }).aktion).toBe("anlegen");
    expect(e({ ausloeser: "schedule", stundenSeitAbschluss: 5 * STUNDEN, wochenbericht: { ...W, wochenOhneLaufMax: 5 } }).aktion).toBe("anlegen");
    expect(e({ ausloeser: "schedule", stundenSeitAbschluss: 5 * STUNDEN - 1, wochenbericht: { ...W, wochenOhneLaufMax: 5 } }).aktion).toBe("nichts");
  });
  test("Montags-Cron ohne Höchstabstand und ohne Anlass legt nie an, auch nicht bei vielen Merges (MIN_MERGES gilt nicht mehr)", () => {
    expect(e({ ausloeser: "schedule", mergesSeit: 500, stundenSeitAbschluss: STUNDEN, wochenbericht: W }).aktion).toBe("nichts");
  });
  test("fehlt wochenOhneLaufMax: kein Höchstabstand und eine Warnung, ein Anlass legt trotzdem an", () => {
    const ohne = e({ ausloeser: "schedule", stundenSeitAbschluss: 99 * STUNDEN, wochenbericht: { erfassungLueckenMax: 0 } });
    expect(ohne.aktion).toBe("nichts");
    expect(ohne.warnungen.join(" ")).toContain("wochenOhneLaufMax");
    const mitAnlass = e({ ausloeser: "workflow_dispatch", anlass: "x", wochenbericht: { erfassungLueckenMax: 0 } });
    expect(mitAnlass.aktion).toBe("anlegen");
    expect(mitAnlass.warnungen).toEqual([]);
    // ein Anlass macht die Warnung über das fehlende Feld überflüssig (der Höchstabstand wird gar nicht gerechnet)
    expect(e({ ausloeser: "schedule", anlass: "x", wochenbericht: { erfassungLueckenMax: 0 } }).warnungen).toEqual([]);
  });
  test("ohne Schlüssel gilt alles wie bisher: der Anlass allein legt nicht an, MIN_MERGES und der Cron wie zuvor", () => {
    expect(e({ ausloeser: "workflow_dispatch", anlass: "x", mergesSeit: 0 }).aktion).toBe("nichts");
    expect(e({ ausloeser: "workflow_dispatch", mergesSeit: 5 }).aktion).toBe("anlegen");
    expect(e({ ausloeser: "schedule", mergesSeit: 5 })).toEqual({ aktion: "anlegen", grund: expect.stringContaining("5 Merges") as string, warnungen: [] });
    expect(e({ ausloeser: "schedule", mergesSeit: 4 }).aktion).toBe("nichts");
  });
  test("Push ruht Fr–So auch mit Schlüssel", () => {
    expect(e({ ausloeser: "push", ticketMerges: 60, offene: [offen(7)], jetzt: "2026-10-09T12:00:00Z", wochenbericht: W }).aktion).toBe("nichts");
  });
});

describe("anlassZitat und statusBody", () => {
  test("anlassZitat: eine Zeile, Backticks entfernt, höchstens 300 Zeichen plus „…“, Code-Span (@name pingt nicht)", () => {
    const roh = `Zeile eins\nZeile \`zwei\` @someone ${"x".repeat(1000)}`;
    const z = S.anlassZitat(roh);
    expect(z).not.toContain("\n");
    expect(z.startsWith("> `")).toBe(true);
    expect(z.endsWith("…`")).toBe(true);
    expect(z.slice(3, -1)).toHaveLength(301);
    expect(z.slice(3, -1)).not.toContain("`");
    expect(z).toContain("@someone");
    expect(S.anlassZitat("kurz\tund   klar")).toBe("> `kurz und klar`");
    expect(S.anlassZitat("a".repeat(300))).toBe(`> \`${"a".repeat(300)}\``);
    expect(S.anlassZitat("a".repeat(301))).toBe(`> \`${"a".repeat(300)}…\``);
  });
  const basis = { vorgaenger: { number: 12, closedAt: "2026-10-01T10:00:00Z", createdAt: "2026-09-21T10:00:00Z" }, jetzt: "2026-10-08T12:00:00Z", repo: "own/repo", wurzel: process.cwd() };
  test("mit Schlüssel: Anlass als Zitat, Ablage owner__repo und der Wochenbereich seit dem Vorgänger", () => {
    const b = S.statusBody({ ...basis, anlass: "Wochenbericht 2026-09-28: Agent-Lauf nötig", wochenbericht: W });
    expect(b).toContain("- **Anlass:**\n  > `Wochenbericht 2026-09-28: Agent-Lauf nötig`");
    expect(b).toContain("~/.claude/state/langfuse-wochenbericht/own__repo/");
    expect(b).toContain("seit 2026-10-01 bis 2026-10-04");
  });
  test("ohne Vorgänger beginnt der Wochenbereich beim ersten Commit, ohne beides bei der Historie; ohne Anlass keine Anlass-Zeilen", () => {
    const ohneVorgaenger = { jetzt: basis.jetzt, repo: "own/repo", wurzel: process.cwd(), wochenbericht: W };
    expect(S.statusBody({ ...ohneVorgaenger, start: "2026-09-01T10:00:00Z" })).toContain("seit 2026-09-01 bis 2026-10-04");
    const b = S.statusBody(ohneVorgaenger);
    expect(b).toContain("seit dem Beginn der Historie bis 2026-10-04");
    expect(b).not.toContain("**Anlass:**");
    expect(b).toContain("Wochenberichte");
  });
  test("ohne Schlüssel byte-gleich: weder Anlass noch Ablage, auch wenn ein Anlass mitkommt", () => {
    const ohne = S.statusBody(basis);
    expect(S.statusBody({ ...basis, anlass: "x" })).toBe(ohne);
    expect(ohne).not.toContain("Anlass");
    expect(ohne).not.toContain("langfuse-wochenbericht");
  });
});

describe("Workflow: der Input erreicht das Skript nur über env", () => {
  const yml = readFileSync(new URL("../.github/workflows/board-takt.yml", import.meta.url), "utf8");
  type Schritt = { run?: string; env?: Record<string, string> };
  const doc = parse(yml) as { on: { workflow_dispatch: { inputs: Record<string, Record<string, unknown>> } }; jobs: { takt: { steps: Schritt[] } } };
  test("workflow_dispatch trägt den optionalen String-Input langfuse_anlass mit leerem Standard", () => {
    expect(doc.on.workflow_dispatch.inputs.langfuse_anlass).toMatchObject({ type: "string", required: false, default: "" });
  });
  test("LANGFUSE_ANLASS steht unter env des Takt-Schritts, und keine run-Zeile enthält einen Ausdruck", () => {
    const schritte = doc.jobs.takt.steps;
    expect(schritte.some((s) => s.env?.LANGFUSE_ANLASS === "${{ inputs.langfuse_anlass }}" && s.run === "node scripts/board-takt.mjs")).toBe(true);
    for (const s of schritte) expect(s.run ?? "").not.toContain("${{");
  });
});

// ── Verdrahtung: Factory- und Bezieher-Pfad ──────────────────────────────────

const JETZT = new Date("2026-10-08T12:00:00Z"); // Donnerstag
const FABRIK = "zz-org/zz-fabrik";
const STATUS = S.STATUS_TITEL;
const ticketCommit = (n: number) => ({ author: { login: FREMD_OWNER }, commit: { message: `feat(sim): s${n} (#${300 + n})`, committer: { date: "2026-10-06T10:00:00Z" } } });
const sechzig = Array.from({ length: 60 }, (_, i) => ticketCommit(i));
const bezieherConfig = { repo: FREMD.repo, labels: { harness: FREMD.labels.harness, forum: FREMD.labels.forum }, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo: FABRIK } : b)), langfuseWochenbericht: W };
const factoryConfig = { repo: FREMD.repo, labels: { harness: FREMD.labels.harness, forum: FREMD.labels.forum }, langfuseWochenbericht: W };
const vorgaenger = { number: 12, title: STATUS, state: "CLOSED", createdAt: "2026-08-01T00:00:00Z", closedAt: "2026-08-02T00:00:00Z" };

/** Läuft `fuehreTaktAus` mit Fakes; das Anlegen läuft über das echte `fuehreStatusAus` mit gefaktem `gh` (ohne Token endet es nach dem POST), die POSTs landen in `posts`. */
function lauf(opt: { config: unknown; bezieher: boolean; ausloeser: string; anlass?: string; commits?: unknown[] }) {
  const posts: string[][] = [];
  const entscheidungen: Array<{ aktion: string; anlass?: string }> = [];
  const io = {
    ghJson: (args: string[]) => {
      const text = args.join(" ");
      if (text.includes("graphql")) return { data: { search: { nodes: [vorgaenger] } } };
      if (text.includes("state=closed")) return [[{ number: 12, title: STATUS, closed_at: vorgaenger.closedAt, created_at: vorgaenger.createdAt }]];
      return [opt.commits ?? []];
    },
    loadItems: () => [],
    loadOpenIssuePages: () => [[]],
    frischeOffeneIssues: () => [],
    itemsUeberIssues: (_r: string, n: number[]) => n.map(() => null),
    addToBoardTodo: () => "ITEM",
    ladeKommentare: () => [],
    ersterCommitDatum: () => null,
    env: {},
    fuehreHarnessAus: () => true,
    fuehreStatusAus: (en: { aktion: string; anlass?: string }, ctx: Record<string, unknown>) => {
      entscheidungen.push(en);
      return S.fuehreStatusAus(en, { ...ctx, token: undefined, io: { gh: (args: string[]) => (posts.push(args), { number: 77, node_id: "N77" }) } });
    },
    log: () => {},
  };
  const r = T.fuehreTaktAus({ jetzt: JETZT, repo: FREMD.repo, token: "t", io, config: opt.config, bezieher: opt.bezieher, ausloeser: opt.ausloeser, anlass: opt.anlass });
  return { r, posts, entscheidungen };
}
const bodyVon = (posts: string[][]) => posts[0]?.find((a) => a.startsWith("body=")) ?? "";

describe("fuehreTaktAus mit Wochenbericht", () => {
  test("Factory-Pfad: Dispatch mit Anlass legt per POST an, der Body trägt den Anlass", () => {
    const { r, posts } = lauf({ config: factoryConfig, bezieher: false, ausloeser: "workflow_dispatch", anlass: "Wochenbericht 2026-10-05 fehlt" });
    expect(r.fehler).toBe(false);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(`repos/${FREMD.repo}/issues`);
    expect(bodyVon(posts)).toContain("> `Wochenbericht 2026-10-05 fehlt`");
  });
  test("Factory-Pfad: Dispatch ohne Anlass und Push mit 60 Ticket-Merges legen nicht an (ohne Schlüssel legt der Push an)", () => {
    expect(lauf({ config: factoryConfig, bezieher: false, ausloeser: "workflow_dispatch" }).posts).toHaveLength(0);
    expect(lauf({ config: factoryConfig, bezieher: false, ausloeser: "push", commits: sechzig }).posts).toHaveLength(0);
    const ohne = lauf({ config: { ...factoryConfig, langfuseWochenbericht: undefined }, bezieher: false, ausloeser: "push", commits: sechzig });
    expect(ohne.posts).toHaveLength(1);
    expect(bodyVon(ohne.posts)).not.toContain("Anlass");
  });
  test("Bezieher-Pfad: Dispatch mit Anlass legt im eigenen Repo an, Push nicht", () => {
    const mit = lauf({ config: bezieherConfig, bezieher: true, ausloeser: "workflow_dispatch", anlass: "Wochenbericht 2026-10-05: Agent-Lauf nötig" });
    expect(mit.posts).toHaveLength(1);
    expect(mit.posts[0]).toContain(`repos/${FREMD.repo}/issues`);
    expect(bodyVon(mit.posts)).toContain("> `Wochenbericht 2026-10-05: Agent-Lauf nötig`");
    expect(lauf({ config: bezieherConfig, bezieher: true, ausloeser: "push", commits: sechzig }).posts).toHaveLength(0);
  });
  test("main reicht LANGFUSE_ANLASS als anlass an den Lauf; ohne Variable ist er undefined", () => {
    const gesehen: unknown[] = [];
    const n = { argv: [], kontingent: () => {}, ladeConfig: () => ({}), err: () => {}, jetzt: () => JETZT, lauf: (a: { anlass?: string }) => (gesehen.push(a.anlass), { fehler: false }) };
    expect(T.main({ GITHUB_EVENT_NAME: "workflow_dispatch", LANGFUSE_ANLASS: "A" }, n)).toBe(0);
    expect(T.main({}, n)).toBe(0);
    expect(gesehen).toEqual(["A", undefined]);
  });
});
