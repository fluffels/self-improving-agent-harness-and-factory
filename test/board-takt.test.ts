/* Generischer Board-Takt (#1390): Commit-Fenster, Harness-Sammelticket nach Aktivität und Positionskorrektur sind pur und idempotent.
 * Die Status-Ticket-Entscheidung testet test/langfuse-takt.test.ts.
 *
 * Reines Node-Tooling-Skript ohne Declaration-File: Import über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/board-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawStatus from "../scripts/langfuse-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawQuote from "../scripts/produktquote-lib.mjs";
import { FREMD, FREMD_OWNER } from "./support/fremd-config";

const OWNER = FREMD_OWNER; // Login des Maintainer-Accounts, nur Testdaten

type Item = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Harness = { aktion: "nach-oben" | "nichts"; nr?: number; afterId?: string | null; grund: string };
type Takt = {
  HARNESS_TAKT_KOMMENTARE: number;
  harnessVoraussetzung: (a: { items: Item[] | null }) => { ok: boolean; fehler?: boolean; meldung?: string };
  mergeFensterAb: (letzter: string | null, jetzt: string | Date) => Date;
  zaehleTicketMerges: (commits: unknown, seit?: string | Date | null) => number;
  istHarnessCommit: (c: unknown, harnessIssues?: Set<number> | null) => boolean;
  zaehleProduktMerges: (commits: unknown, seit?: string | Date | null) => number;
  quotenBericht: (commits: unknown[], seit?: string | null) => { harness: number; produkt: number; eingehalten: boolean; zeile: string };
  PRODUKT_QUOTE: number;
  befundKommentare: (kommentare: unknown, owner: string) => number;
  entscheideHarnessTakt: (a: { items: Item[]; befundKommentare: number }) => Harness;
  ziehListeNach: (items: Item[], ergebnis: { nr: number; itemId?: string | null } | null) => Item[];
};
const T = raw as unknown as Takt;
const Q = rawQuote as unknown as {
  PRODUKT_QUOTE: number;
  zaehleTicketMerges: Takt["zaehleTicketMerges"];
  istHarnessCommit: Takt["istHarnessCommit"];
  zaehleTaktMerges: (commits: unknown, seit?: string | Date | null, sammelIssues?: Set<number>) => number;
  befundKommentare: Takt["befundKommentare"];
  HARNESS_TAKT_KOMMENTARE: number;
  fuellstandVon: (a: { nr: number; repo: string; ladeKommentare: (nr: number, repo: string) => unknown }) => { wert: number } | { fehler: string };
};
const normalizeOffene = (rawLib as unknown as { normalizeOffene: (pages: unknown) => Offen[] }).normalizeOffene;
const STATUS_TITEL = (rawStatus as unknown as { STATUS_TITEL: string }).STATUS_TITEL;
const verschiebe = (rawLib as unknown as { verschiebe: (i: Item[], id: string, after: string | null) => Item[] }).verschiebe;

describe("mergeFensterAb", () => {
  test("60 Sekunden nach dem Abschluss des Vorgängers", () => {
    expect(T.mergeFensterAb("2026-10-01T10:00:00Z", "2026-10-07T00:00:00Z").toISOString()).toBe("2026-10-01T10:01:00.000Z");
  });
  test("ohne Vorgänger 7 Tage vor jetzt", () => {
    expect(T.mergeFensterAb(null, "2026-10-07T00:00:00Z").toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
  test("kaputtes Datum wirft", () => {
    expect(() => T.mergeFensterAb("morgen", "2026-10-07T00:00:00Z")).toThrow();
    expect(() => T.mergeFensterAb(null, "x")).toThrow();
  });
});

describe("normalizeOffene", () => {
  const issue = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    title: "x",
    created_at: "2026-10-01T00:00:00Z",
    assignees: [{ login: OWNER }],
    ...extra,
  });
  test("filtert Pull Requests und liest Assignees", () => {
    const r = normalizeOffene([[issue(1), issue(2, { pull_request: {} })], [issue(3, { assignees: [] })]]);
    expect(r.map((i) => i.number)).toEqual([1, 3]);
    expect(r[0].assignees).toEqual([OWNER]);
    expect(r[1].assignees).toEqual([]);
  });
  test("falsche Form wirft", () => {
    expect(() => normalizeOffene({})).toThrow();
    expect(() => normalizeOffene([issue(1)])).toThrow();
    expect(() => normalizeOffene([[{ number: 1 }]])).toThrow();
  });
  test("ohne created_at wirft (statt still zu sortieren)", () => {
    const i = { number: 1, title: STATUS_TITEL, assignees: [] };
    expect(() => normalizeOffene([[i]])).toThrow(/Form eines Issues/);
    expect(normalizeOffene([[{ ...i, created_at: "2026-10-01T05:00:00Z" }]])).toHaveLength(1);
  });
});

describe("zaehleTicketMerges (#1349)", () => {
  const c = (login: string | null, date = "2026-10-07T10:00:00Z") => ({ author: login === null ? null : { login }, commit: { committer: { date } } });

  test("Bots zählen nicht (dependabot[bot], github-actions[bot]), Menschen und fehlender Autor schon", () => {
    expect(T.zaehleTicketMerges([c(OWNER), c("dependabot[bot]"), c("github-actions[bot]"), c(null)])).toBe(2);
    expect(T.zaehleTicketMerges([])).toBe(0);
  });

  test("seit: nur Commits ab dem Zeitpunkt, Grenze inklusive, kaputtes Datum zählt nicht", () => {
    const l = [c("a", "2026-10-07T09:59:59Z"), c("a", "2026-10-07T10:00:00Z"), c("a", "kaputt")];
    expect(T.zaehleTicketMerges(l, "2026-10-07T10:00:00Z")).toBe(1);
    expect(() => T.zaehleTicketMerges(l, "morgen")).toThrow();
  });

  test("keine Liste wirft", () => {
    expect(() => T.zaehleTicketMerges({})).toThrow();
  });
});

describe("Produktquote im Takt (#1425)", () => {
  const c = (message: string, login: string | null = OWNER, date = "2026-10-07T10:00:00Z") => ({ author: login === null ? null : { login }, commit: { message, committer: { date } } });
  const harness = c("feat(harness): Härtung (#1)\n\nKörper");
  const spiel = c("feat(sim): Pod (#2)");

  test("Harness-Scope wird am Titel des Squash-Commits erkannt, auch mit Ausrufezeichen und Großschreibung; Körper und andere Scopes nicht", () => {
    for (const m of ["feat(harness): x", "fix(harness)!: x", "CHORE(HARNESS): x"]) expect(T.istHarnessCommit(c(m)), m).toBe(true);
    for (const m of ["feat(sim): x", "feat: harness", "feat(harness-x): x", "docs(adr): x\n\nfeat(harness): y", "", "harness"]) expect(T.istHarnessCommit(c(m)), m).toBe(false);
    expect(T.istHarnessCommit(null)).toBe(false);
    expect(T.istHarnessCommit({})).toBe(false);
  });

  test("Label-Zuordnung (#1460 Z6): nur die Issue-Nummer macht einen Commit zu Harness, eine PR-Nummer allein nicht (keine PR→Issue-Auflösung)", () => {
    const menge = new Set([1428]);
    // Titel mit Issue UND PR (die Regel bei jedem Ticket-Merge): Harness
    expect(T.istHarnessCommit(c("feat(harness): x (#1428) (#1500)"), menge)).toBe(true);
    // Titel nur mit PR-Nummer: zählt als Spiel, auch mit Scope harness (Grenze, gemessen: 128 von 139 Commits tragen Issue und PR, 11 nur Dependabot)
    expect(T.istHarnessCommit(c("feat(harness): x (#1500)"), menge)).toBe(false);
    // ohne Menge bleibt der Rückfall auf den Scope
    expect(T.istHarnessCommit(c("feat(harness): x (#1500)"), null)).toBe(true);
  });

  test("zaehleProduktMerges: Harness-, Bot- und zu alte Commits zählen nicht", () => {
    const l = [spiel, harness, c("feat(sim): y", "dependabot[bot]"), c("feat(sim): z", OWNER, "2026-10-06T10:00:00Z"), c("feat(inhalt): q")];
    expect(T.zaehleProduktMerges(l)).toBe(3);
    expect(T.zaehleProduktMerges(l, "2026-10-07T00:00:00Z")).toBe(2);
    expect(() => T.zaehleProduktMerges({})).toThrow();
  });

  test("zaehleTaktMerges: Spiel und Agentic zählen, Bots, Sammelticket-Commits und zu alte nicht", () => {
    const alt = c("feat(sim): alt (#9)", OWNER, "2026-10-06T10:00:00Z");
    const sammelCommit = c("feat(harness): Härtung (#40) (#41)");
    const l = [spiel, harness, sammelCommit, c("feat(sim): z", "dependabot[bot]"), alt];
    expect(Q.zaehleTaktMerges(l, null, new Set([40]))).toBe(3);
    expect(Q.zaehleTaktMerges(l, "2026-10-07T00:00:00Z", new Set([40]))).toBe(2);
    expect(Q.zaehleTaktMerges(l)).toBe(4);
    expect(() => Q.zaehleTaktMerges({})).toThrow();
  });

  test("quotenBericht: 1:3 ist eingehalten, 2:3 überschritten, leeres Fenster eingehalten", () => {
    expect(T.PRODUKT_QUOTE).toBe(3);
    const q = T.quotenBericht([harness, spiel, spiel, spiel]);
    expect(q).toMatchObject({ harness: 1, produkt: 3, eingehalten: true });
    expect(q.zeile).toMatch(/1 Harness- auf 3 Produkt-Merges/);
    expect(T.quotenBericht([harness, harness, spiel, spiel, spiel]).eingehalten).toBe(false);
    expect(T.quotenBericht([]).eingehalten).toBe(true);
    expect(T.quotenBericht([c("feat(harness): x", "dependabot[bot]"), spiel], null).harness).toBe(0);
  });

  test("quotenBericht: ein Harness-Merge VOR dem Fenster zählt nicht", () => {
    const alt = c("feat(harness): alt", OWNER, "2026-10-06T10:00:00Z");
    const altSpiel = c("feat(sim): alt", OWNER, "2026-10-06T10:00:00Z");
    const q = T.quotenBericht([alt, alt, altSpiel, spiel], "2026-10-07T00:00:00Z");
    expect(q).toMatchObject({ harness: 0, produkt: 1 });
    expect(T.quotenBericht([alt, alt, altSpiel, spiel], null)).toMatchObject({ harness: 2, produkt: 2 });
  });

  describe("fuellstandVon: Laden, Zählen und Fail-closed an einer Stelle", () => {
    const k = (login: string) => ({ user: { login, type: "User" }, body: "- [ ] Befund" });
    const repo = `${OWNER}/projekt`;
    test("zählt die Owner-Kommentare (Owner aus dem Repo) und reicht Nummer und Repo an den Lader", () => {
      const gesehen: unknown[] = [];
      const r = Q.fuellstandVon({ nr: 7, repo, ladeKommentare: (nr, rp) => (gesehen.push([nr, rp]), [k(OWNER), k(OWNER), k("fremd")]) });
      expect(r).toEqual({ wert: 2 });
      expect(gesehen).toEqual([[7, repo]]);
    });
    test("summiert die offenen Zeilen: ein Owner-Kommentar mit 3 Zeilen plus ein fremder mit 3 Zeilen ergibt 3 (factory#411)", () => {
      const drei = "- [ ] a\n- [ ] b\n- [ ] c";
      const r = Q.fuellstandVon({ nr: 7, repo, ladeKommentare: () => [{ ...k(OWNER), body: drei }, { ...k("fremd"), body: drei }] });
      expect(r).toEqual({ wert: 3 });
    });
    test("ein Ladefehler wird zu { fehler } mit erster Zeile (kein Wurf)", () => {
      const r = Q.fuellstandVon({ nr: 7, repo, ladeKommentare: () => { throw new Error("HTTP 502\nzweite Zeile"); } });
      expect(r).toEqual({ fehler: "Kommentare von #7 nicht ladbar: HTTP 502" });
    });
    test("ein geworfener Nicht-Error (String) wird zu { fehler }", () => {
      const r = Q.fuellstandVon({ nr: 7, repo, ladeKommentare: () => { throw "kaputt"; } }); // eslint-disable-line @typescript-eslint/only-throw-error
      expect(r).toEqual({ fehler: "Kommentare von #7 nicht ladbar: kaputt" });
    });
    test("eine falsche Antwortform und ein kaputtes Repo sind fail-closed { fehler }", () => {
      expect(Q.fuellstandVon({ nr: 7, repo, ladeKommentare: () => ({}) })).toHaveProperty("fehler", "Kommentare von #7 nicht ladbar: kommentare muss eine Liste sein.");
      const kaputt = Q.fuellstandVon({ nr: 7, repo: "ohne-slash", ladeKommentare: () => [] });
      expect("fehler" in kaputt ? kaputt.fehler : "").toMatch(/nicht ladbar.*owner\/name/);
    });
  });

  test("befundKommentare (#1888): nur Kommentare des vertrauten Owners ohne [bot]; fremde, Bot-, anonyme und gelöschte Autoren zählen nicht", () => {
    const k = (login: string | null, type = "User") => ({ user: login === null ? null : { login, type }, body: "- [ ] Befund" });
    expect(Q.befundKommentare([k(OWNER), k(OWNER), k("fremd"), k("github-actions[bot]", "Bot"), k("dependabot[bot]", "Bot"), k(null), {}], OWNER)).toBe(2);
    expect(Q.befundKommentare([k(OWNER.toUpperCase())], OWNER)).toBe(1); // Login ohne Groß-/Kleinschreibung
    expect(Q.befundKommentare([], OWNER)).toBe(0);
    expect(Q.befundKommentare([k(OWNER)], "")).toBe(0); // ohne Owner ist niemand vertraut
    const botKommentar = (login: string) => ({ user: { login, type: "User" }, body: "- [ ] Befund" });
    expect(Q.befundKommentare([botKommentar(`${OWNER}[bot]`)], `${OWNER}[bot]`)).toBe(0); // ein [bot]-Login zählt nie, auch wenn er als Owner vertraut wäre
    expect(Q.befundKommentare([botKommentar(`${OWNER}[BOT]`)], `${OWNER}[BOT]`)).toBe(0); // ohne Groß-/Kleinschreibung
    expect(Q.befundKommentare([botKommentar(`${OWNER}[bot]x`)], `${OWNER}[bot]x`)).toBe(1); // nur ein Login, der auf [bot] endet, ist ein Bot
    expect(Q.befundKommentare([botKommentar(`${OWNER}bot]`)], `${OWNER}bot]`)).toBe(1); // ohne öffnende Klammer kein Bot-Suffix
    expect(Q.befundKommentare([null, undefined, botKommentar(OWNER)], OWNER)).toBe(1); // kaputte Listeneinträge zählen nicht und werfen nicht
    expect(() => Q.befundKommentare({}, OWNER)).toThrow(/Liste/);
    expect(() => Q.befundKommentare(null, OWNER)).toThrow(/Liste/);
  });

  test("befundKommentare (factory#411): zählt die offenen Checkbox-Zeilen vertrauter Nicht-Bot-Autoren; Fließtext und abgehakte Zeilen zählen 0", () => {
    const k = (body?: string, login = OWNER) => ({ user: { login, type: login.endsWith("[bot]") ? "Bot" : "User" }, ...(body === undefined ? {} : { body }) });
    const fuenf = "- [ ] a\n- [ ] b\n- [ ] c\n- [ ] d\n- [ ] e";
    expect(Q.befundKommentare([k("- [ ] a\n- [ ] b\n- [ ] c")], OWNER)).toBe(3);
    expect(Q.befundKommentare([k("- [x] erledigt")], OWNER)).toBe(0);
    expect(Q.befundKommentare([k("Kopf\n* [X] a\n  - [ ] b"), k("- [ ] c")], OWNER)).toBe(2);
    expect(Q.befundKommentare([k("Nur Fließtext ohne Zeile"), k(), k(""), k("Text mit - [ ] mittendrin")], OWNER)).toBe(0);
    expect(Q.befundKommentare([k("- [ ] a\r\n- [ ] b\r\n")], OWNER)).toBe(2); // CRLF
    expect(Q.befundKommentare([k(fuenf, "fremd"), k(fuenf, "github-actions[bot]")], OWNER)).toBe(0); // mehrzeilige Fremd- und Bot-Kommentare
  });
});

describe("entscheideHarnessTakt (#1349 Z15, Sammelticket an die Spitze factory#162)", () => {
  const TITEL = "Harness-Härtung (gesammelt)";
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<Item> = {}) => it(number, { title: TITEL, ...extra });
  const status = (number: number) => it(number, { title: STATUS_TITEL });
  const rotMain = (number: number) => it(number, { title: "🚨 CI rot auf main" });
  const security = (number: number) => it(number, { title: "🔒 Security: Alert" });
  const fueller = (von: number, bis: number) => Array.from({ length: bis - von + 1 }, (_, i) => it(von + i));
  const h = (items: Item[], n: number) => T.entscheideHarnessTakt({ items, befundKommentare: n });

  test("Grenze 9/10/11: erst ab 10 offenen Befund-Zeilen nach oben (Härtungs-Takt, Füllstand #1888)", () => {
    expect(T.HARNESS_TAKT_KOMMENTARE).toBe(10);
    expect(T.HARNESS_TAKT_KOMMENTARE).not.toBe(T.PRODUKT_QUOTE); // eigene Zahl, nicht an die Seitenwahl gekoppelt
    const board = [it(10), it(11), sammel(12)];
    expect(h(board, 9).aktion).toBe("nichts");
    expect(h(board, 9).grund).toMatch(/Füllstand 9\/10/);
    expect(h(board, 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    expect(h(board, 11)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    // schon an der Spitze: bei 11 und 12 idempotent
    expect(h([sammel(12), it(10)], 11).aktion).toBe("nichts");
    expect(h([sammel(12), it(10)], 12).aktion).toBe("nichts");
  });

  test("Spitze: vor dem Status-Ticket und den übrigen Kopf-Items, nur hinter 🚨 und 🔒", () => {
    expect(h([status(2), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    const dependabot = it(3, { title: "🤖 Dependabot-PRs auflösen" });
    expect(h([dependabot, status(2), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    expect(h([rotMain(1), status(2), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "I1" });
    expect(h([rotMain(1), security(4), status(2), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "I4" });
    // ein Status-Ticket über dem Notfall stört nicht; ein Notfall außerhalb des Kopfs zählt nicht
    expect(h([status(2), rotMain(1), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "I1" });
    expect(h([it(10), rotMain(1), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    // geschlossene Notfälle zählen nicht, ein geclaimter offener schon
    expect(h([it(1, { title: "🚨 CI rot auf main", state: "closed" }), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    expect(h([it(1, { title: "🚨 CI rot auf main", state: "closed" }), status(2), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
    expect(h([it(1, { title: "🚨 CI rot auf main", assignees: [OWNER] }), it(10), sammel(12)], 10)).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "I1" });
  });

  test("idempotent: steht es schon direkt hinter den Notfällen (auch mit geschlossenem Item dazwischen), passiert nichts", () => {
    expect(h([sammel(12), status(2), it(10)], 10).aktion).toBe("nichts");
    expect(h([rotMain(1), sammel(12), status(2)], 10).aktion).toBe("nichts");
    expect(h([it(9, { state: "closed" }), sammel(12), status(2)], 10).aktion).toBe("nichts");
    expect(h([rotMain(1), it(9, { state: "closed" }), sammel(12), it(10)], 10).aktion).toBe("nichts");
  });

  test("kein Rückschub: unter der Schwelle bleibt das Sammelticket liegen, wo es steht (auch am Board-Ende oder an der Spitze)", () => {
    for (const n of [0, 2, 9]) {
      expect(h([...fueller(1, 10), sammel(20)], n).aktion, `Ende, Füllstand ${n}`).toBe("nichts");
      expect(h([sammel(20), status(2), ...fueller(3, 10)], n).aktion, `Spitze, Füllstand ${n}`).toBe("nichts");
    }
  });

  test("geclaimtes, geschlossenes oder fehlendes Sammelticket: nichts", () => {
    expect(h([it(10), sammel(12, { assignees: [OWNER] })], 10).aktion).toBe("nichts");
    expect(h([it(10), sammel(12, { state: "closed" })], 10).aktion).toBe("nichts");
    expect(h([it(10)], 10).aktion).toBe("nichts");
  });

  test("Vorgänger in Arbeit (#1646): geclaimtes plus ungeclaimtes Sammelticket → kein nach-oben, auch bei Füllstand 12", () => {
    const board = [it(10), it(11), sammel(12, { assignees: [OWNER] }), sammel(13)];
    const r = h(board, 12);
    expect(r.aktion).toBe("nichts");
    expect(r.grund).toMatch(/Vorgänger #12 in Arbeit/);
    // ohne geclaimten Vorgänger bleibt es nach-oben
    expect(h([it(10), it(11), sammel(13)], 10)).toMatchObject({ aktion: "nach-oben", nr: 13 });
    // geschlossener Vorgänger zählt nicht
    expect(h([it(10), it(11), sammel(12, { assignees: [OWNER], state: "closed" }), sammel(13)], 10)).toMatchObject({ aktion: "nach-oben", nr: 13 });
  });

  test("ungültige Eingaben werfen", () => {
    expect(() => h([], -1)).toThrow();
    expect(() => h([], 1.5)).toThrow();
    expect(() => T.entscheideHarnessTakt({ items: null as unknown as Item[], befundKommentare: 10 })).toThrow();
  });

  test("es gibt keine Selbstkorrektur mehr: nur nach-oben oder nichts", () => {
    const boards = [[...fueller(1, 10), sammel(20)], [status(1), ...fueller(2, 10), sammel(20)], [it(30), sammel(20), ...fueller(1, 6)]];
    for (const board of boards) for (const n of [0, 4, 9, 10, 20]) expect(["nach-oben", "nichts"]).toContain(h(board, n).aktion);
  });

  test("Fixpunkt: nach dem Anwenden der Entscheidung ist der nächste Lauf ein nichts", () => {
    const boards = [[...fueller(1, 10), sammel(20)], [status(1), ...fueller(2, 10), sammel(20)], [rotMain(1), status(2), sammel(20)], [it(30), sammel(20), ...fueller(1, 6)]];
    let geprueft = 0;
    for (const board of boards) {
      for (const n of [0, 4, 10, 20]) {
        const e = h(board, n);
        if (e.aktion === "nichts") continue;
        geprueft++;
        const danach = verschiebe(board, `I${e.nr}`, e.afterId ?? null);
        expect(h(danach, n).aktion, `${e.aktion} bei Füllstand ${n} auf ${board.map((x) => x.number).join(",")}`).toBe("nichts");
      }
    }
    expect(geprueft, "die Schleife prüft wirklich etwas").toBeGreaterThan(4);
  });

  test("zwei Läufe an einem Montag: der erste legt das Status-Ticket an und holt das Sammelticket davor, der zweite bewegt nichts", () => {
    const board = [rotMain(1), it(10), it(11), sammel(12)];
    // Lauf 1: Status-Aktion zieht die Liste nach (Status-Ticket an die Spitze), danach die Harness-Entscheidung
    const nachStatus = T.ziehListeNach(board, { nr: 9, itemId: "ITEM_9" });
    const e1 = h(nachStatus, 10);
    expect(e1).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: "I1" });
    const nachLauf1 = verschiebe(nachStatus, "I12", e1.afterId ?? null);
    expect(nachLauf1.map((i) => i.number)).toEqual([9, 1, 12, 10, 11]);
    // Lauf 2: das Status-Ticket steht schon, die Status-Aktion ist `nichts` (kein itemId): die Liste bleibt, der Harness-Takt auch
    expect(T.ziehListeNach(nachLauf1, null)).toBe(nachLauf1);
    expect(h(nachLauf1, 10).aktion).toBe("nichts");
  });
});

describe("ziehListeNach: die Board-Liste wird nach der Status-Aktion im Speicher nachgezogen (#1390 Z6c)", () => {
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });

  test("ohne itemId (nichts bewegt, kein Token, Fehler) bleibt die Liste, wie sie war", () => {
    const liste = [it(1), it(2)];
    expect(T.ziehListeNach(liste, null)).toBe(liste);
    expect(T.ziehListeNach(liste, { nr: 5, itemId: null })).toBe(liste);
  });

  test("ein schon gelistetes Status-Ticket wandert an die Spitze (auch bei bekannter Nummer mit anderer ID)", () => {
    const liste = [it(1), it(2), it(5, { title: STATUS_TITEL })];
    expect(T.ziehListeNach(liste, { nr: 5, itemId: "I5" }).map((i) => i.number)).toEqual([5, 1, 2]);
    expect(T.ziehListeNach(liste, { nr: 5, itemId: "ITEM_neu" }).map((i) => i.number)).toEqual([5, 1, 2]);
  });

  test("ein frisch angelegtes, noch nicht gelistetes Status-Ticket wird vorn ergänzt und zählt zum Kopf", () => {
    const liste = T.ziehListeNach([it(1), it(2)], { nr: 9, itemId: "ITEM_9" });
    expect(liste.map((i) => i.number)).toEqual([9, 1, 2]);
    expect(liste[0]).toMatchObject({ id: "ITEM_9", title: STATUS_TITEL, state: "open", assignees: [] });
    const kopfEnde = (rawLib as unknown as { kopfEnde: (i: Item[]) => number }).kopfEnde;
    expect(kopfEnde(liste)).toBe(1);
  });

  test("Komposition: nach dem Nachziehen entscheidet der Harness-Takt gegen die aktuelle Liste (Sammelticket vor dem frischen Status-Ticket)", () => {
    const board = [it(1), it(2), it(12, { title: "Harness-Härtung (gesammelt)" })];
    const nachgezogen = T.ziehListeNach(board, { nr: 9, itemId: "ITEM_9" });
    expect(T.entscheideHarnessTakt({ items: nachgezogen, befundKommentare: 10 })).toMatchObject({ aktion: "nach-oben", nr: 12, afterId: null });
  });
});

/** Erste Gruppe des LETZTEN Treffers eines globalen Musters (der jüngste Abschnitt eines wachsenden ADR) oder undefined. */
function letzterTreffer(re: RegExp, text: string): string | undefined {
  return [...text.matchAll(re)].at(-1)?.[1];
}

/** Bindet JEDE Stelle, die das globale Muster trägt, an die erwartete Zahl (nicht nur den ersten Treffer je Datei); mindestens `min` Stellen, sonst wäre die Bindung leer. */
function bindeAlle(re: RegExp, text: string, erwartet: number, min = 1): void {
  const zahlen = [...text.matchAll(re)].map((m) => Number(m[1]));
  expect(zahlen.length, `Muster ${re} trifft zu selten`).toBeGreaterThanOrEqual(min);
  expect(zahlen.every((z) => z === erwartet), `Muster ${re}: ${zahlen.join(", ")} statt ${erwartet}`).toBe(true);
}

describe("produktquote-lib (#1729)", () => {
  test("die Bestandsfunktionen sind aus board-takt erreichbar und identisch (Re-Export)", () => {
    expect(T.PRODUKT_QUOTE).toBe(Q.PRODUKT_QUOTE);
    expect(T.zaehleTicketMerges).toBe(Q.zaehleTicketMerges);
    expect(T.istHarnessCommit).toBe(Q.istHarnessCommit);
  });
  describe("sammelStand (#1798)", () => {
    type I = { number: number; title: string; state: string; closedAt?: string | null; assignees?: unknown[] };
    const SS = (rawQuote as unknown as { sammelStand: (i: I[]) => { abschluss: { number: number; closedAt: string } | null; sammelIssues: Set<number>; inArbeit: number | null } }).sammelStand;
    const H = "Harness-Härtung (gesammelt)";
    test("leere Liste: kein Abschluss, keine Sammeltickets, nichts in Arbeit", () => {
      expect(SS([])).toEqual({ abschluss: null, sammelIssues: new Set(), inArbeit: null });
    });
    test("das jüngste geschlossene Sammelticket gewinnt, ungültiges closedAt wird übersprungen, state ohne Groß/Klein", () => {
      const s = SS([
        { number: 1, title: H, state: "CLOSED", closedAt: "2026-10-01T00:00:00Z" },
        { number: 2, title: H, state: "closed", closedAt: "2026-10-05T00:00:00Z" },
        { number: 3, title: H, state: "CLOSED", closedAt: "kein-datum" },
        { number: 4, title: H, state: "OPEN", closedAt: "2026-10-09T00:00:00Z" },
      ]);
      expect(s.abschluss).toEqual({ number: 2, closedAt: "2026-10-05T00:00:00Z" });
      expect([...s.sammelIssues].sort()).toEqual([1, 2, 3, 4]);
    });
    test("Langfuse-Sammelticket zählt zu sammelIssues, nie als Abschluss und nie als in Arbeit", () => {
      const s = SS([
        { number: 5, title: "Langfuse-Befunde (gesammelt)", state: "CLOSED", closedAt: "2026-10-09T00:00:00Z" },
        { number: 6, title: "Langfuse-Befunde (gesammelt)", state: "OPEN", assignees: [{ login: "x" }] },
        { number: 7, title: "Etwas anderes (gesammelt)", state: "OPEN", assignees: [{ login: "x" }] },
      ]);
      expect(s).toEqual({ abschluss: null, sammelIssues: new Set([5, 6]), inArbeit: null });
    });
    test("offen mit Assignee ist in Arbeit, ohne Assignee oder ohne assignees-Feld nicht", () => {
      expect(SS([{ number: 8, title: H, state: "OPEN", assignees: [{ login: "x" }] }]).inArbeit).toBe(8);
      expect(SS([{ number: 8, title: H, state: "OPEN", assignees: [] }]).inArbeit).toBeNull();
      expect(SS([{ number: 8, title: H, state: "OPEN" }]).inArbeit).toBeNull();
    });
    test("keine Liste: wirft", () => {
      expect(() => SS(null as unknown as I[])).toThrow(/Liste/);
    });
  });
  describe("harnessIssuesAnfrage und harnessIssuesAus (#1798)", () => {
    const L = rawQuote as unknown as { harnessIssuesAnfrage: (a: { repo: string; label: string; seit: string }) => string[]; harnessIssuesAus: (s: unknown) => Set<number> };
    test("Anfrage: paginiert, Label kodiert, seit durchgereicht", () => {
      expect(L.harnessIssuesAnfrage({ repo: "o/r", label: `${FREMD.labels.harness} x`, seit: "2026-10-01T00:00:00.000Z" })).toEqual([
        "api", "--paginate", "--slurp", `repos/o/r/issues?state=closed&labels=${FREMD.labels.harness.replaceAll(":", "%3A")}%20x&since=2026-10-01T00:00:00.000Z&per_page=100`,
      ]);
    });
    test("Anfrage: jeder Doppelpunkt des Labels wird kodiert, nicht nur der erste", () => {
      expect(L.harnessIssuesAnfrage({ repo: "o/r", label: "a:b:c", seit: "s" })[3]).toContain("labels=a%3Ab%3Ac&");
    });
    test("Aus: Nummern ohne PRs über alle Seiten; falsche Form wirft", () => {
      expect(L.harnessIssuesAus([[{ number: 1 }, { number: 2, pull_request: {} }], [{ number: 3 }]])).toEqual(new Set([1, 3]));
      expect(L.harnessIssuesAus([[null, { number: 4 }]])).toEqual(new Set([4]));
      expect(() => L.harnessIssuesAus({})).toThrow(/Antwortform/);
      expect(() => L.harnessIssuesAus(null)).toThrow(/Antwortform/);
    });
  });
});

describe("letzterTreffer (#1428 Z21)", () => {
  test("alte Zahl vorn, aktuelle hinten: die aktuelle zählt; umgekehrt die hintere", () => {
    expect(letzterTreffer(/(\d+) Merges/g, "5 Merges ... 3 Merges")).toBe("3");
    expect(letzterTreffer(/(\d+) Merges/g, "3 Merges ... 5 Merges")).toBe("5");
    expect(letzterTreffer(/(\d+) Merges/g, "keine Zahl")).toBeUndefined();
  });
});

describe("Bindung der Aktivitäts-Zahlen an die Doku (#1349)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  const status = rawStatus as unknown as { MIN_TICKET_MERGES_PUSH: number; MIN_ABSTAND_STUNDEN: number };
  test("MIN_TICKET_MERGES_PUSH und HARNESS_TAKT_KOMMENTARE stehen in ADR 0016 samt Fortschreibung, im Workflow-Kommentar und in ticket-reihenfolge.md", () => {
    const adr = lies("docs/adr/0016-langfuse-takt-woechentlich.md");
    const yml = lies(".github/workflows/board-takt.yml");
    const doc = lies("docs/ticket-reihenfolge.md");
    const fortschreibung = lies("docs/adr/fortschreibungen/0016-1888-haertungs-takt-nach-fuellstand.md");
    const zeilen = lies("docs/adr/fortschreibungen/0016-411-fuellstand-nach-offenen-zeilen.md"); // factory#411: Zählung nach offenen Zeilen
    expect(Number(/mindestens (\d+) Ticket-Merges/.exec(yml)?.[1])).toBe(status.MIN_TICKET_MERGES_PUSH);
    bindeAlle(/ab (\d+) offenen Befund-Zeilen/g, yml, T.HARNESS_TAKT_KOMMENTARE);
    // #1428 Z21: der ADR wächst durch Fortschreibungen nur am Ende; die Bindung gilt dem LETZTEN Treffer (dem jüngsten Stand).
    expect(Number(letzterTreffer(/(\d+) Ticket-Merges \(ohne Bots\)/g, adr))).toBe(status.MIN_TICKET_MERGES_PUSH);
    bindeAlle(/ab (\d+) offenen Befund-Zeilen/g, zeilen, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/füllt sich \(k\/(\d+) offene Befund-Zeilen\)/g, zeilen, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/Spielquote 1:(\d+)/g, fortschreibung, T.PRODUKT_QUOTE);
    expect(Number(/(\d+) Ticket-Merges \(ohne Bots\)/.exec(doc)?.[1])).toBe(status.MIN_TICKET_MERGES_PUSH);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(adr)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(doc)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    expect(Number(/Mindestabstand von (\d+) Stunden/.exec(yml)?.[1])).toBe(status.MIN_ABSTAND_STUNDEN);
    // ticket-reihenfolge.md nennt Schwelle und Quote an mehreren Stellen (Takt-Absatz, Position, Kennzahl-Soll): jede muss stimmen.
    // factory#280 L3: die Schwellenzahl steht in der Doku genau einmal (Takt-Bullet, mit Verweis auf die Konstante); sonst Verweis statt Literal.
    bindeAlle(/ab (\d+) offenen Befund-Zeilen/g, doc, T.HARNESS_TAKT_KOMMENTARE, 1);
    expect([...doc.matchAll(/ab (\d+) offenen Befund-Zeilen/g)]).toHaveLength(1);
    expect(doc).not.toMatch(/Schwelle \d+ offene Befund-Zeilen/);
    expect(doc).not.toMatch(/füllt sich \(k\/\d+/);
    expect(doc).toContain("Konstante `HARNESS_TAKT_KOMMENTARE` in `scripts/produktquote-lib.mjs`");
    bindeAlle(/Produktquote 1:(\d+)/g, doc, T.PRODUKT_QUOTE, 2);
    // die Zahl steht auch in Glossar, Befehlsreferenz und Anlaufstellen
    expect(Number(/ab der Schwelle (\d+) greift der Härtungs-Takt/.exec(lies("docs/harness-glossar.md"))?.[1])).toBe(T.HARNESS_TAKT_KOMMENTARE);
    const befehle = lies("docs/referenz/befehle.md");
    bindeAlle(/erst ab (\d+) offenen Befund-Zeilen als frei/g, befehle, T.HARNESS_TAKT_KOMMENTARE);
    bindeAlle(/füllt sich \(k\/(\d+) offene Befund-Zeilen\)/g, befehle, T.HARNESS_TAKT_KOMMENTARE);
    expect(Number(/Harness-Sammelticket ab (\d+) offenen Befund-Zeilen/.exec(lies("docs/referenz/anlaufstellen.md"))?.[1])).toBe(T.HARNESS_TAKT_KOMMENTARE);
  });
  test("das Kennzahl-Soll (#1729) trägt dieselbe Zahl in ticket-reihenfolge.md und, als jüngster Stand, in ADR 0016", () => {
    const wendung = /nach (\d+) Produkt-Merges \(Produktquote 1:\d+\) seit dem letzten Factory-Merge/;
    expect(Number(wendung.exec(lies("docs/ticket-reihenfolge.md"))?.[1])).toBe(Q.PRODUKT_QUOTE);
    expect(Number(letzterTreffer(/nach (\d+) Produkt-Merges seit dem letzten Factory-Merge/g, lies("docs/adr/0016-langfuse-takt-woechentlich.md")))).toBe(Q.PRODUKT_QUOTE);
  });
  test("Bibliothek statt Querimport: board-takt importiert die Quote aus produktquote-lib, nicht aus dem Auswahl-Skript; naechstes-ticket kennt die Produktquote nicht (es nutzt aus der Bibliothek nur den Füllstand des Härtungs-Takts)", () => {
    const takt = lies("scripts/board-takt.mjs");
    const wahl = lies("scripts/naechstes-ticket.mjs");
    expect(takt).toContain('from "./produktquote-lib.mjs"');
    expect(wahl).not.toMatch(/PRODUKT_QUOTE|quotenBericht|zaehleProduktMerges/); // die Produktquote steuert die Auswahl nicht
    expect(wahl).toMatch(/import \{ HARNESS_TAKT_KOMMENTARE, fuellstandVon \} from "\.\/produktquote-lib\.mjs"/);
    expect(takt).not.toMatch(/from "\.\/naechstes-ticket\.mjs"/);
    expect(wahl).not.toMatch(/from "\.\/board-takt\.mjs"/);
  });
  test("der Workflow löst auf Push nach main aus und ruft board-takt.mjs", () => {
    const yml = lies(".github/workflows/board-takt.yml");
    expect(yml).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(yml).toMatch(/run: node scripts\/board-takt\.mjs/);
  });
  test("factory#194: das Schließen eines Milestones löst den Workflow aus, überspringt nur den Status-Schritt und lässt den Tag-Takt laufen", () => {
    const wf = parse(lies(".github/workflows/board-takt.yml")) as { on: { milestone?: { types?: string[] } }; jobs: { takt: { steps: { run?: string; if?: string }[] } } };
    expect(wf.on.milestone?.types).toEqual(["closed"]);
    const schritt = (skript: string) => wf.jobs.takt.steps.find((st) => st.run === `node scripts/${skript}`);
    expect(schritt("board-takt.mjs")).toBeDefined();
    expect(schritt("tag-takt.mjs")).toBeDefined();
    expect(schritt("board-takt.mjs")?.if).toContain("github.event_name != 'milestone'");
    expect(schritt("tag-takt.mjs")?.if ?? "").not.toContain("milestone");
  });
});

describe("factoryListe mit Issue-Repo (#238 L28)", () => {
  const FABRIK = "zz-org/zz-fabrik";
  const bezieher = { ...FREMD, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo: FABRIK } : b)) };
  const liste = (items: unknown[], doppelt: number[], config: unknown) => (raw as unknown as { factoryListe: (f: unknown[], d: number[], c: unknown) => { number: number }[] }).factoryListe(items, doppelt, config).map((i) => i.number);
  const harness = (number: number, repo: string) => ({ number, repo, labels: [FREMD.labels.harness] });
  test("eine doppelte Nummer mit Harness-Label im fremden Repo zählt zur Produkt-Seite und fällt aus der Factory-Liste", () => {
    expect(liste([harness(1, FREMD.repo), harness(2, FABRIK)], [1, 2], bezieher)).toEqual([2]);
  });
  test("in der Fabrik (beide Boards ein Repo) bleibt das Harness-Item in der Liste", () => {
    expect(liste([harness(1, FREMD.repo)], [1], FREMD)).toEqual([1]);
  });
});

describe("langfuseSammelEntscheidung (factory#379: Takt für das Langfuse-Sammelticket)", () => {
  const LF = "Langfuse-Befunde (gesammelt)";
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const lf = (number: number, extra: Partial<Item> = {}) => it(number, { title: LF, ...extra });
  const harnessT = (number: number, extra: Partial<Item> = {}) => it(number, { title: "Harness-Härtung (gesammelt)", ...extra });
  const status = (number: number) => it(number, { title: STATUS_TITEL });
  const rot = (number: number) => it(number, { title: "🚨 CI rot auf main" });
  const e = (items: Item[], n: number) => (raw as unknown as { langfuseSammelEntscheidung: (i: Item[], f: number) => { aktion: string; nr?: number; afterId?: string | null; grund: string } }).langfuseSammelEntscheidung(items, n);
  const konst = raw as unknown as { LANGFUSE_TAKT_KOMMENTARE: number };

  test("items keine Liste: wirft", () => {
    expect(() => e(null as unknown as Item[], 1)).toThrow(/items muss eine Liste sein/);
    expect(() => e("x" as unknown as Item[], 1)).toThrow(/items muss eine Liste sein/);
  });

  test("Schwelle 1: 0 offene Befund-Zeilen lassen es liegen, ab 1 kommt es hinter den Kopf", () => {
    expect(konst.LANGFUSE_TAKT_KOMMENTARE).toBe(1);
    const board = [status(2), it(10), it(11), lf(12)];
    expect(e(board, 0)).toMatchObject({ aktion: "nichts" });
    expect(e(board, 0).grund).toMatch(/Füllstand 0\/1/);
    expect(e(board, 1)).toMatchObject({ aktion: "verschieben", nr: 12, afterId: "I2" });
    expect(e(board, 5)).toMatchObject({ aktion: "verschieben", nr: 12, afterId: "I2" });
  });

  test("ohne Kopf auf die Spitze; Notfälle, Harness-Sammelticket und Status-Ticket an der Spitze zählen zum Kopf", () => {
    expect(e([it(10), lf(12)], 1)).toMatchObject({ aktion: "verschieben", afterId: null });
    expect(e([rot(1), harnessT(3), status(2), it(10), lf(12)], 1)).toMatchObject({ aktion: "verschieben", afterId: "I2" });
    expect(e([rot(1), harnessT(3), it(10), lf(12)], 1)).toMatchObject({ aktion: "verschieben", afterId: "I3" });
  });

  test("steht es schon dort (auch mit geschlossenen Items dazwischen): nichts, idempotent", () => {
    expect(e([status(2), lf(12), it(10)], 1).aktion).toBe("nichts");
    expect(e([status(2), it(9, { state: "closed" }), lf(12), it(10)], 1).aktion).toBe("nichts");
    // ein geschlossenes Item mitten im Kopf beendet ihn nicht
    expect(e([rot(1), it(9, { state: "closed" }), status(2), it(10), lf(12)], 1)).toMatchObject({ aktion: "verschieben", afterId: "I2" });
    expect(e([lf(12), it(10)], 1).aktion).toBe("nichts");
  });

  test("geclaimt, geschlossen, fehlend oder Vorgänger mit Assignee offen: nichts", () => {
    expect(e([status(2), it(10), lf(12, { assignees: ["x"] })], 3).aktion).toBe("nichts");
    expect(e([status(2), it(10), lf(12, { assignees: ["x"] })], 3).grund).toMatch(/kein ungeclaimtes/);
    expect(e([status(2), it(10), lf(12, { state: "closed" })], 3).aktion).toBe("nichts");
    expect(e([status(2), it(10)], 3).aktion).toBe("nichts");
    expect(e([status(2), it(10), lf(11, { assignees: ["x"] }), lf(12)], 3).grund).toMatch(/Vorgänger #11/);
    expect(e([status(2), it(10), lf(11, { assignees: ["x"] }), lf(12)], 3).aktion).toBe("nichts");
  });

  test("ungültiger Füllstand wirft", () => {
    expect(() => e([lf(12)], -1)).toThrow(/ganze Zahl/);
    expect(() => e([lf(12)], 1.5)).toThrow(/ganze Zahl/);
  });
});

describe("entscheideSammelTakt und fuehreSammelAus: eine allgemeine Funktion je Sammelticket-Art (factory#407)", () => {
  type Art = { titel: string; schwelle: number; ende: (i: Item[]) => number; aktion: string; feld: string; name: string; zuWenig: (f: number) => string; steht: (nr: number) => string; kommt: (f: number, nr: number) => string };
  type Entscheidung = { aktion: string; nr?: number; afterId?: string | null; grund: string };
  const S = raw as unknown as {
    SAMMEL_ARTEN: Record<string, Art>;
    entscheideSammelTakt: (a: Art, i: Item[], f: number) => Entscheidung;
    fuehreSammelAus: (a: Art, e: { nr: number; afterId: string | null }, i: { id: string; number: number }[], t: string, rolle: string, o: { setze: (...a: unknown[]) => void; log: (z: string) => void }) => boolean;
  };
  const DRITTE = "Dritte Befunde (gesammelt)";
  const art: Art = { titel: DRITTE, schwelle: 2, ende: () => 0, aktion: "verschieben", feld: "dritte", name: "Dritte-Art", zuWenig: (f) => `zu wenig ${f}`, steht: (nr) => `#${nr} steht schon`, kommt: (f, nr) => `${f}: #${nr} kommt` };
  const it = (number: number, extra: Partial<Item> = {}): Item => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const dritte = (number: number, extra: Partial<Item> = {}) => it(number, { title: DRITTE, ...extra });
  const e = (items: Item[], n: number) => S.entscheideSammelTakt(art, items, n);

  test("erfundene dritte Art: unter der Schwelle nichts, ab der Schwelle verschieben, steht es schon: nichts", () => {
    expect(e([it(1), dritte(5)], 1)).toEqual({ aktion: "nichts", grund: "zu wenig 1" });
    expect(e([it(1), dritte(5)], 2)).toEqual({ aktion: "verschieben", nr: 5, afterId: null, grund: "2: #5 kommt" });
    expect(e([dritte(5), it(1)], 2)).toEqual({ aktion: "nichts", grund: "#5 steht schon" });
    expect(e([it(1), it(2)], 2).grund).toBe(`kein ungeclaimtes „${DRITTE}“`);
  });
  test("Vorgänger in Arbeit: nichts, auch über der Schwelle", () => {
    const r = e([it(1), dritte(4, { assignees: [OWNER] }), dritte(5)], 9);
    expect([r.aktion, r.grund]).toEqual(["nichts", "Vorgänger #4 in Arbeit, der Takt wartet auf dessen Abschluss"]);
  });
  test("afterId ist das Item vor der Zielposition; Fehlermeldung nennt das Feld der Art", () => {
    expect(S.entscheideSammelTakt({ ...art, ende: () => 1 }, [it(1), it(2), dritte(5)], 2).afterId).toBe("I1");
    expect(() => e([], -1)).toThrow(/dritte muss eine ganze Zahl ≥ 0 sein, war -1/);
    expect(() => e(null as unknown as Item[], 1)).toThrow(/items muss eine Liste sein/);
  });
  test("fuehreSammelAus: Logtext mit Namen der Art, Fehlerpfad über fehlerMeldung", () => {
    const log: string[] = [];
    const aufrufe: unknown[][] = [];
    expect(S.fuehreSammelAus(art, { nr: 5, afterId: "A" }, [{ id: "I5", number: 5 }], "t", "factory", { setze: (...a) => aufrufe.push(a), log: (z) => log.push(z) })).toBe(true);
    expect([aufrufe, log]).toEqual([[["I5", "A", { token: "t" }]], ["Dritte-Art-Position gesetzt."]]);
    const fehler: string[] = [];
    const wirf = () => { throw new Error("kaputt"); };
    expect(S.fuehreSammelAus(art, { nr: 5, afterId: null }, [{ id: "I5", number: 5 }], "t", "factory", { setze: wirf, log: (z) => fehler.push(z) })).toBe(false);
    expect(fehler.join("\n")).toBe("::error::Dritte-Art-Position nicht gesetzt: kaputt\nDie Wiederholung ist idempotent.");
  });
  test("die Gründe der beiden Arten sind zeichengleich zu den alten Texten", () => {
    const { harness, langfuse } = S.SAMMEL_ARTEN;
    expect(S.entscheideSammelTakt(harness, [it(1), { ...dritte(5), title: harness.titel }], 9)).toEqual({ aktion: "nichts", grund: "Füllstand 9/10 offene Befund-Zeilen (Schwelle 10), der Takt lässt es liegen" });
    expect(S.entscheideSammelTakt(harness, [it(1), { ...dritte(5), title: harness.titel }], 10).grund).toBe("Füllstand 10/10 offene Befund-Zeilen, #5 kommt an die Spitze");
    expect(S.entscheideSammelTakt(harness, [{ ...dritte(5), title: harness.titel }, it(1)], 10).grund).toBe("#5 steht schon an der Spitze (hinter den Notfall-Items)");
    expect(S.entscheideSammelTakt(langfuse, [it(1), { ...dritte(5), title: langfuse.titel }], 0).grund).toBe("Füllstand 0/1 offene Befund-Zeilen, der Takt lässt es liegen");
    expect(S.entscheideSammelTakt(langfuse, [it(1), { ...dritte(5), title: langfuse.titel }], 1).grund).toBe("Füllstand 1/1 offene Befund-Zeilen, #5 kommt hinter den Kopf");
    expect(S.entscheideSammelTakt(langfuse, [{ ...dritte(5), title: langfuse.titel }, it(1)], 1).grund).toBe("#5 steht schon hinter dem Kopf");
  });
  test("die beiden Arten tragen Titel, Schwelle und Aktion der alten Entscheidungen", () => {
    const { harness, langfuse } = S.SAMMEL_ARTEN;
    expect([harness.titel, harness.schwelle, harness.aktion, langfuse.titel, langfuse.schwelle, langfuse.aktion]).toEqual(["Harness-Härtung (gesammelt)", 10, "nach-oben", "Langfuse-Befunde (gesammelt)", 1, "verschieben"]);
  });
});
