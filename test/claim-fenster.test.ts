/* Claim-Fenster (factory#524, ADR 0036): das Ticket je Call aus Claim, Freigabe und Merge im Transkript; Soll und Payload mit Ticket.
 * Rein pur: synthetische Transkript-Zeilen, kein IO. Die Fälle: zwei Tickets in einer Session, Re-Claim, parallele Sessions, Call vor dem ersten Claim.
 */
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as fensterRaw from "../scripts/claim-fenster.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kernRaw from "../scripts/langfuse-abgleich-kern.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as otlpRaw from "../scripts/langfuse-otlp.mjs";
import { importeAus, lokaleImporteTransitiv } from "./harness/hook-importe";
import { FREMD, repoName } from "./support/fremd-config";

type Row = Record<string, unknown>;
type Fenster = { art: string; nr?: number; t: number }[];
type Sitzung = { id: string; main: Row[]; subagents: { datei: string; meta: Record<string, unknown>; zeilen: Row[] }[] };
type Eintrag = { id: string; messageId: string; traceId: string; ticket: string | null; ticketGrund: string | null; model: string | null; rolle: { agentId: string; parentAgentId?: string } | null };
type Attribut = { key: string; value: { stringValue?: string; arrayValue?: { values: { stringValue: string }[] } } };
type Span = { traceId: string; spanId: string; parentSpanId?: string; name: string; attributes: Attribut[] };

const F = fensterRaw as unknown as {
  claimsAus: (events: { tool: string; ts: string; input?: { command?: string } }[], turnVon: (ev: unknown) => number) => { nr: number; ts: string; turn: number }[];
  fensterAus: (s: Sitzung) => Fenster;
  ticketFuer: (f: Fenster, ts: string | number | undefined) => { nr: number | null; grund: string | null };
};
const K = kernRaw as unknown as { sollEintraege: (s: Sitzung, o: { session?: string; worktree: string }) => Eintrag[]; diffMultimenge: (soll: Eintrag[], obs: object[]) => { fehlend: Eintrag[]; dubletten: object[] } };
const O = otlpRaw as unknown as {
  bauePayloads: (s: string, e: Eintrag[], o: { soll?: Eintrag[]; project: string; repoName: string; env?: Record<string, string> }) => { chunks: { payload: { resourceSpans: { scopeSpans: { spans: Span[] }[] }[] }; generationIds: string[]; spanIds: string[] }[] };
  traceIdJeTicket: (s: string, t: string | null) => string;
};

const WT = FREMD.praefixe.worktree;
const REPO = repoName(FREMD);
const t = (min: number) => new Date(Date.UTC(2026, 10, 16, 10, 0, 0) + min * 60_000).toISOString();
let seq = 0;
const call = (min: number | null, tool?: { name: string; input: Row }, model = "claude-opus-5-5"): Row => {
  seq += 1;
  return {
    type: "assistant",
    ...(min === null ? {} : { timestamp: t(min) }),
    uuid: `u${seq}`,
    message: {
      id: `m${seq}`,
      role: "assistant",
      model,
      usage: { input_tokens: 100, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      content: tool ? [{ type: "tool_use", id: `t${seq}`, name: tool.name, input: tool.input }] : [{ type: "text", text: "x" }],
    },
  };
};
const bash = (command: string) => ({ name: "Bash", input: { command } });
const claim = (nr: number) => bash(`gh issue edit ${nr} --add-assignee @me`);
const freigabe = (nr: number) => bash(`gh issue edit ${nr} --remove-assignee @me`);
const merge = bash("gh pr merge 9 --squash --auto");
const sub = (id: string, zeilen: Row[], parentAgentId?: string) => ({ datei: `agent-${id}.jsonl`, meta: { agentType: FREMD.agenten.umsetzer, description: id, ...(parentAgentId ? { parentAgentId } : {}) }, zeilen });
const sitzung = (main: Row[], subagents: Sitzung["subagents"] = [], id = "s1"): Sitzung => ({ id, main, subagents });
const tickets = (s: Sitzung) => K.sollEintraege(s, { worktree: WT }).map((e) => e.ticket ?? e.ticketGrund);

describe("ticketFuer: Zustandsautomat über Claim, Freigabe, Merge", () => {
  const fenster = (main: Row[]) => F.fensterAus(sitzung(main));
  test("zwei Tickets in einer Session werden nach Zeit getrennt; der Claim-Call selbst ist noch vor-claim", () => {
    const f = fenster([call(0), call(1, claim(7)), call(2), call(3, claim(8)), call(4)]);
    expect([0, 1, 2, 3, 4].map((m) => F.ticketFuer(f, t(m)))).toEqual([
      { nr: null, grund: "vor-claim" },
      { nr: null, grund: "vor-claim" },
      { nr: 7, grund: null },
      { nr: 7, grund: null },
      { nr: 8, grund: null },
    ]);
  });
  test("Re-Claim: N,M,N wechselt je Claim, N,N ändert nichts", () => {
    const f = fenster([call(1, claim(7)), call(2, claim(8)), call(3, claim(7))]);
    expect(F.ticketFuer(f, t(1.5)).nr).toBe(7);
    expect(F.ticketFuer(f, t(2.5)).nr).toBe(8);
    expect(F.ticketFuer(f, t(3.5)).nr).toBe(7);
    const g = fenster([call(1, claim(7)), call(2, claim(7))]);
    expect(F.ticketFuer(g, t(5)).nr).toBe(7);
  });
  test("Freigabe des offenen Tickets: nach-freigabe; Freigabe eines anderen Tickets ohne Wirkung; Re-Claim öffnet erneut", () => {
    const f = fenster([call(1, claim(7)), call(2, freigabe(9)), call(3, freigabe(7)), call(5, claim(7))]);
    expect(F.ticketFuer(f, t(2.5)).nr).toBe(7);
    expect(F.ticketFuer(f, t(4))).toEqual({ nr: null, grund: "nach-freigabe" });
    expect(F.ticketFuer(f, t(6)).nr).toBe(7);
  });
  test("Merge im offenen Fenster: nachlauf; Merge ohne Fenster ändert den Grund nicht", () => {
    const f = fenster([call(0, merge), call(1, claim(7)), call(2, merge)]);
    expect(F.ticketFuer(f, t(0.5))).toEqual({ nr: null, grund: "vor-claim" });
    expect(F.ticketFuer(f, t(1.5)).nr).toBe(7);
    expect(F.ticketFuer(f, t(3))).toEqual({ nr: null, grund: "nachlauf" });
  });
  test("Negativfall: Call ohne gültige Zeit ist ohne-zeit, nie ein Ticket", () => {
    const f = fenster([call(1, claim(7))]);
    expect(F.ticketFuer(f, undefined)).toEqual({ nr: null, grund: "ohne-zeit" });
    expect(F.ticketFuer(f, "kaputt")).toEqual({ nr: null, grund: "ohne-zeit" });
  });
  test("nur echte Bash/PowerShell-Tool-Events zählen: ein Claim als Text oder in einem anderen Tool ist keiner", () => {
    const text = call(1);
    (text.message as { content: unknown[] }).content = [{ type: "text", text: "gh issue edit 7 --add-assignee @me" }];
    const f = fenster([text, call(2, { name: "Read", input: { command: "gh issue edit 8 --add-assignee @me" } }), call(3, { name: "PowerShell", input: { command: "gh issue edit 9 --add-assignee @me" } })]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ art: "claim", nr: 9 });
  });
  test("ein gewöhnlicher Befehl im offenen Fenster beendet es nicht; gh pr merge --disable-auto auch nicht", () => {
    expect(tickets(sitzung([call(1, claim(7)), call(2, bash("ls")), call(3, bash("gh pr merge 9 --disable-auto")), call(4)]))).toEqual(["vor-claim", `${WT}7`, `${WT}7`, `${WT}7`]);
  });
  test("Claim und Merge in einer Zeile: nur der Claim zählt; ein Claim ohne Zeitstempel entfällt", () => {
    const f = fenster([call(1, bash("gh issue edit 7 --add-assignee @me && gh pr merge 9 --auto"))]);
    expect(f.map((e) => e.art)).toEqual(["claim"]);
    expect(fenster([call(null, claim(7))])).toEqual([]);
  });
  test("die Ereignisse sind nach Zeit sortiert, auch über Haupttranskript und Top-Level-Subagent hinweg", () => {
    const f = F.fensterAus(sitzung([call(1, claim(7)), call(5, claim(9))], [sub("a", [call(3, claim(8))])]));
    expect(f.map((e) => e.nr)).toEqual([7, 8, 9]);
  });
  test("claimsAus liefert Nummer, Zeit und Turn der Claim-Events (geteilt mit der Hauptchat-Zerlegung)", () => {
    const ev = (tool: string, command: string, ts: string) => ({ tool, ts, input: { command } });
    expect(F.claimsAus([ev("Bash", "gh issue edit 5 --add-assignee @me", t(1)), ev("Read", "gh issue edit 6 --add-assignee @me", t(2)), ev("Bash", "ls", t(3))], () => 4)).toEqual([{ nr: 5, ts: t(1), turn: 4 }]);
  });
});

describe("fensterAus: Quellen", () => {
  test("ein Claim im Top-Level-Subagent zählt, einer im verschachtelten Agent nicht", () => {
    const s = sitzung([call(0)], [sub("a", [call(1, claim(7))]), sub("b", [call(2, claim(8))], "a")]);
    expect(F.fensterAus(s).map((e) => e.nr)).toEqual([7]);
  });
  test("parallele Sessions im selben Checkout haben getrennte Fenster", () => {
    const a = sitzung([call(1, claim(7)), call(3)], [], "sa");
    const b = sitzung([call(2, claim(8)), call(4)], [], "sb");
    expect(tickets(a)).toEqual(["vor-claim", `${WT}7`]);
    expect(tickets(b)).toEqual(["vor-claim", `${WT}8`]);
  });
});

describe("sollEintraege: Ticket und Trace je Call", () => {
  test("Call vor dem ersten Claim: ticket null mit Grund vor-claim; die Trace-ID trennt Ticket und ohne-ticket", () => {
    const e = K.sollEintraege(sitzung([call(0), call(1, claim(7)), call(2)]), { worktree: WT });
    expect(e.map((x) => [x.ticket, x.ticketGrund])).toEqual([[null, "vor-claim"], [null, "vor-claim"], [`${WT}7`, null]]);
    expect(e[0].traceId).toBe(O.traceIdJeTicket("s1", null));
    expect(e[2].traceId).toBe(O.traceIdJeTicket("s1", `${WT}7`));
    expect(e[0].traceId).not.toBe(e[2].traceId);
  });
  test("Nachlauf und nach-freigabe tragen ihren Grund, nie das Ticket davor", () => {
    expect(tickets(sitzung([call(1, claim(7)), call(2), call(3, merge), call(4), call(5, claim(8)), call(6, freigabe(8)), call(7)]))).toEqual([
      "vor-claim",
      `${WT}7`,
      `${WT}7`,
      "nachlauf",
      "nachlauf",
      `${WT}8`,
      "nach-freigabe",
    ]);
  });
  test("ein Subagent erbt das Ticket seines Starts, auch über das Fensterende hinaus; ein Hauptchat-Call danach ist nachlauf", () => {
    const s = sitzung([call(1, claim(7)), call(10, merge), call(20)], [sub("a", [call(3), call(30)])]);
    const e = K.sollEintraege(s, { worktree: WT });
    const sa = e.filter((x) => x.rolle);
    expect(sa.map((x) => x.ticket)).toEqual([`${WT}7`, `${WT}7`]);
    expect(e.find((x) => !x.rolle && x.ticketGrund === "nachlauf")).toBeDefined();
  });
  test("ein Subagent, der vor dem ersten Claim startet, bleibt ohne Ticket (vor-claim)", () => {
    const s = sitzung([call(5, claim(7))], [sub("a", [call(1), call(8)])]);
    expect(K.sollEintraege(s, { worktree: WT }).filter((x) => x.rolle).map((x) => [x.ticket, x.ticketGrund])).toEqual([[null, "vor-claim"], [null, "vor-claim"]]);
  });
  test("ein verschachtelter Agent erbt über die Kette das Ticket der Startzeit des Wurzel-Agenten", () => {
    // das Fenster endet vor dem Start von b: ohne die Kette zum Wurzel-Agenten a wäre b `nachlauf`
    const s = sitzung([call(1, claim(7)), call(10, merge)], [sub("a", [call(3)]), sub("b", [call(50)], "a")]);
    expect(K.sollEintraege(s, { worktree: WT }).filter((x) => x.rolle).map((x) => x.ticket)).toEqual([`${WT}7`, `${WT}7`]);
  });
  test("Call ohne Zeitstempel: ohne-zeit", () => {
    expect(tickets(sitzung([call(1, claim(7)), call(null)]))).toEqual(["vor-claim", "ohne-zeit"]);
  });
  test("keine Doppelzählung: Calls je Session gleich Transkript, vorhandene Observations ergeben 0 Sendungen", () => {
    const s = sitzung([call(1, claim(7)), call(2), call(3)], [sub("a", [call(4)])]);
    const soll = K.sollEintraege(s, { worktree: WT });
    expect(soll).toHaveLength(4);
    expect(new Set(soll.map((e) => e.id)).size).toBe(4);
    const obs = soll.map((e) => ({ id: e.id, metadata: { message_id: e.messageId } }));
    expect(K.diffMultimenge(soll, obs)).toMatchObject({ fehlend: [], dubletten: [] });
  });
});

describe("bauePayloads: ein Trace je Ticket", () => {
  const spansVon = (s: Sitzung) => {
    const soll = K.sollEintraege(s, { worktree: WT });
    const { chunks } = O.bauePayloads(s.id, soll, { soll, project: "p", repoName: REPO });
    return chunks.flatMap((c) => c.payload.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((x) => x.spans)));
  };
  const wert = (sp: Span, key: string) => sp.attributes.find((a) => a.key === key)?.value.stringValue;
  const tagsVon = (sp: Span) => sp.attributes.find((a) => a.key === "langfuse.trace.tags")?.value.arrayValue?.values.map((v) => v.stringValue);

  test("zwei Tickets und ein Call ohne Ticket ergeben drei Traces; die Tags nennen nur das eigene Ticket", () => {
    const sp = spansVon(sitzung([call(0), call(1, claim(7)), call(2), call(3, claim(8)), call(4)]));
    const gen = sp.filter((x) => x.name === "Call");
    expect(new Set(gen.map((x) => x.traceId)).size).toBe(3);
    expect(gen.map((x) => tagsVon(x))).toEqual([
      [REPO, "abgleich", "ohne-ticket"],
      [REPO, "abgleich", "ohne-ticket"],
      [REPO, "abgleich", `${WT}7`],
      [REPO, "abgleich", `${WT}7`],
      [REPO, "abgleich", `${WT}8`],
    ]);
    expect(gen.map((x) => wert(x, "langfuse.observation.metadata.ticket"))).toEqual(["ohne-ticket", "ohne-ticket", `${WT}7`, `${WT}7`, `${WT}8`]);
  });
  test("ohne-ticket trägt den Grund in den Metadaten, ein Ticket-Call keinen", () => {
    const gen = spansVon(sitzung([call(0), call(1, claim(7)), call(2)])).filter((x) => x.name === "Call");
    expect(gen.map((x) => wert(x, "langfuse.observation.metadata.ticket_grund"))).toEqual(["vor-claim", "vor-claim", undefined]);
  });
  test("ohne Preis: keine cost_details, aber kosten=ohne-preis mit Modell, nie 0 $; mit Preis keine Lücken-Metadaten", () => {
    const gen = spansVon(sitzung([call(1, claim(7), "claude-unbekannt-9"), call(2)])).filter((x) => x.name === "Call");
    expect(gen[0].attributes.some((a) => a.key === "langfuse.observation.cost_details")).toBe(false);
    expect(wert(gen[0], "langfuse.observation.metadata.kosten")).toBe("ohne-preis");
    expect(wert(gen[0], "langfuse.observation.metadata.modell")).toBe("claude-unbekannt-9");
    expect(gen[1].attributes.some((a) => a.key === "langfuse.observation.cost_details")).toBe(true);
    expect(wert(gen[1], "langfuse.observation.metadata.kosten")).toBeUndefined();
  });
  test("Subagent-Span und seine Calls liegen im Trace des Tickets; der Eltern-Verweis bleibt im selben Trace", () => {
    const s = sitzung([call(1, claim(7)), call(40, claim(8))], [sub("a", [call(3), call(41)]), sub("b", [call(4)], "a")]);
    const sp = spansVon(s);
    const spans = sp.filter((x) => x.name.startsWith("Subagent"));
    expect(new Set(spans.map((x) => x.traceId))).toEqual(new Set([O.traceIdJeTicket("s1", `${WT}7`)]));
    const kind = spans.find((x) => x.name === "Subagent: b");
    expect(kind?.parentSpanId).toBeDefined();
    const calls = sp.filter((x) => x.name === "Call" && x.parentSpanId);
    expect(calls.every((x) => x.traceId === O.traceIdJeTicket("s1", `${WT}7`))).toBe(true);
  });
  test("Call ohne Modell und ohne Grund: kosten=ohne-preis mit modell unbekannt, ticket_grund fällt auf ohne-zeit", () => {
    const soll = K.sollEintraege(sitzung([call(1)]), { worktree: WT }).map((e) => ({ ...e, model: null, ticketGrund: null }));
    const { chunks } = O.bauePayloads("s1", soll, { soll, project: "p", repoName: REPO });
    const g = chunks.flatMap((c) => c.payload.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((x) => x.spans)))[0];
    expect(wert(g, "langfuse.observation.metadata.modell")).toBe("unbekannt");
    expect(wert(g, "langfuse.observation.metadata.kosten")).toBe("ohne-preis");
    expect(wert(g, "langfuse.observation.metadata.ticket_grund")).toBe("ohne-zeit");
  });
  test("ein Call in anderem Trace als sein Agent-Span trägt keinen parentSpanId", () => {
    const soll = K.sollEintraege(sitzung([call(1, claim(7))], [sub("a", [call(3), call(4)])]), { worktree: WT });
    const [erster, zweiter] = soll.filter((e) => e.rolle);
    const verbogen = [erster, { ...zweiter, ticket: `${WT}9`, ticketGrund: null }];
    const { chunks } = O.bauePayloads("s1", verbogen, { soll: verbogen, project: "p", repoName: REPO });
    const calls = chunks.flatMap((c) => c.payload.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((x) => x.spans))).filter((x) => x.name === "Call");
    expect(calls.map((x) => x.parentSpanId !== undefined)).toEqual([true, false]);
  });
  test("liegt der Eltern-Agent in einem anderen Trace, ist parentSpanId null", () => {
    const soll = K.sollEintraege(sitzung([call(1, claim(7))], [sub("a", [call(3)]), sub("b", [call(4)], "a")]), { worktree: WT });
    const verbogen = soll.map((e) => (e.rolle?.agentId === "b" ? { ...e, ticket: `${WT}9`, ticketGrund: null, traceId: O.traceIdJeTicket("s1", `${WT}9`) } : e));
    const { chunks } = O.bauePayloads("s1", verbogen, { soll: verbogen, project: "p", repoName: REPO });
    const sp = chunks.flatMap((c) => c.payload.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((x) => x.spans)));
    expect(sp.find((x) => x.name === "Subagent: b")?.parentSpanId).toBeUndefined();
    expect(sp.find((x) => x.name === "Call" && x.traceId === O.traceIdJeTicket("s1", `${WT}9`))?.parentSpanId).toBeDefined();
  });
});

describe("Hook-Tauglichkeit und Wächter", () => {
  const wurzel = join(dirname(fileURLToPath(import.meta.url)), "..");
  const lies = (rel: string) => readFileSync(join(wurzel, rel), "utf8");
  test("claim-fenster.mjs zieht nur node:-Module und lokale Libs ohne Netz, gh und Langfuse nach", () => {
    const kette = lokaleImporteTransitiv(["scripts/claim-fenster.mjs"], lies);
    const namen = kette.map((k) => posix.basename(k));
    for (const verboten of ["gh-cli.mjs", "hauptchat-zerlegung.mjs", "langfuse-api.mjs", "langfuse-otlp.mjs", "langfuse-abgleich-kern.mjs", "token-baseline.mjs"]) expect(namen).not.toContain(verboten);
    for (const datei of kette) for (const imp of importeAus(lies(datei))) expect(imp.startsWith("node:") || imp.startsWith("."), `${datei}: ${imp}`).toBe(true);
  });
  test("hauptchat-zerlegung.mjs definiert weder eigenes CLAIM noch claimsAus, sondern importiert es", () => {
    const text = lies("scripts/hauptchat-zerlegung.mjs");
    expect(text).not.toMatch(/function claimsAus|const CLAIM\b/);
    expect(text).toMatch(/import \{ claimsAus \} from "\.\/claim-fenster\.mjs"/);
  });
});
