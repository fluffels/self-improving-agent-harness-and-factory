/* Abo-Kontingent je Ticket (factory#285): Verlauf lesen, Messfenster, zeitanteilige Teilung, Kontrollzahl, Claims, Abschnitt. */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/abo-kontingent-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as kennzahlenRaw from "../scripts/factory-kennzahlen.mjs";

type Punkt = { stand: number; sevenDay?: { pct: number; resetsAt: number }; fiveHour?: { pct: number; resetsAt: number } };
type Fenster = { luecke: string } | { delta: number };
type Ticketzeile = { ticket: number; pr: number; gemergt: string; blocker: { lens: string; n: number }[] | null; nacharbeit: string };
type Auswertung = {
  zeilen: { ticket: number; pr: number; pp?: number; luecke?: string }[];
  gemessen: number;
  gesamt: number;
  median: number | null;
  kontrolle: { luecke?: string; quotient?: number; summe?: number; resets?: number };
  blocker: { n: number; von: number };
  folge: { n: number; von: number; offen: number };
  kaputt: number;
};
const L = raw as unknown as {
  TOLERANZ_MS: number;
  verlaufAus: (t: string) => { punkte: Punkt[]; kaputt: number };
  messfenster: (p: Punkt[], o: { claim: number; merge: number }) => Fenster;
  teileZeitanteilig: (f: { ticket: number; claim: number; merge: number; delta?: number }[]) => Map<number, number>;
  kontrollzahl: (p: Punkt[], o: { von: number; bis: number; anzahlTickets: number }) => { luecke?: string; summe?: number; resets?: number; quotient?: number };
  claimAbfrage: (n: number[]) => string;
  claimsAusAntwort: (a: unknown, m: Map<number, string>) => Map<number, { claim?: number; luecke?: string }>;
  aboKontingent: (o: { tickets: Ticketzeile[]; punkte: Punkt[]; kaputt: number; claims: Map<number, { claim?: number; luecke?: string }>; von: number; bis: number }) => Auswertung;
  aboKontingentAbschnitt: (a: unknown) => string[];
};
const K = kennzahlenRaw as unknown as {
  ladeAboKontingent: (o: { von: string; bis: string; tickets: Ticketzeile[] }, io: { gh: (a: string[]) => unknown; lies: (p: string) => string; pfad: string }) => { luecke?: string } & Partial<Auswertung>;
  erstelle: (a: unknown, io: unknown) => { bericht: { kontingent?: unknown }; exit: number };
  renderMarkdown: (b: unknown) => string;
};

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 15, 10, 0, 0);
const RESET = (T0 + 3 * 86_400_000) / 1000;
const punkt = (stand: number, pct: number, resetsAt = RESET): Punkt => ({ stand, sevenDay: { pct, resetsAt } });
const w = (o: { claim: number; merge: number }, punkte: Punkt[]) => L.messfenster(punkte, o);

describe("verlaufAus", () => {
  test("sortiert nach stand, überspringt kaputte Zeilen und zählt sie als Datenlücke", () => {
    const text = [
      JSON.stringify(punkt(T0 + 10, 5)),
      "{kaputt",
      "42",
      JSON.stringify({ sevenDay: { pct: 1, resetsAt: 1 } }), // ohne stand
      JSON.stringify({ stand: T0, sevenDay: { pct: "x", resetsAt: 1 } }), // kein gültiges Fenster
      JSON.stringify(punkt(T0, 4)),
      "",
    ].join("\n");
    const v = L.verlaufAus(text);
    expect(v.punkte.map((p) => p.stand)).toEqual([T0, T0 + 10]);
    expect(v.kaputt).toBe(4);
  });
  test("nur 5-Stunden-Fenster ist ein gültiger Punkt, aber ohne sevenDay", () => {
    const v = L.verlaufAus(JSON.stringify({ stand: T0, fiveHour: { pct: 3, resetsAt: 5 } }));
    expect(v.kaputt).toBe(0);
    expect(v.punkte[0]?.sevenDay).toBeUndefined();
  });
});

describe("messfenster", () => {
  const claim = T0 + 60 * MIN;
  const merge = T0 + 120 * MIN;
  test("Delta zwischen letztem Punkt vor dem Claim und erstem Punkt nach dem Merge", () => {
    expect(w({ claim, merge }, [punkt(claim - 5 * MIN, 10), punkt(claim + 10 * MIN, 12), punkt(merge + 5 * MIN, 14)])).toEqual({ delta: 4 });
  });
  test("Delta 0 mit gültigen Punkten ist ein Messwert, keine Lücke", () => {
    expect(w({ claim, merge }, [punkt(claim, 10), punkt(merge, 10)])).toEqual({ delta: 0 });
  });
  test.each([
    ["genau 30 min vor dem Claim ist ok", claim - 30 * MIN, true],
    ["30 min und 1 ms vor dem Claim ist eine Lücke", claim - 30 * MIN - 1, false],
  ])("Start: %s", (_n, stand, ok) => {
    const r = w({ claim, merge }, [punkt(stand, 10), punkt(merge, 11)]);
    expect("delta" in r).toBe(ok);
    if (!ok) expect(r).toEqual({ luecke: "kein Punkt höchstens 30 min vor dem Claim" });
  });
  test.each([
    ["genau 30 min nach dem Merge ist ok", merge + 30 * MIN, true],
    ["30 min und 1 ms nach dem Merge ist eine Lücke", merge + 30 * MIN + 1, false],
  ])("Ende: %s", (_n, stand, ok) => {
    const r = w({ claim, merge }, [punkt(claim, 10), punkt(stand, 11)]);
    expect("delta" in r).toBe(ok);
    if (!ok) expect(r).toEqual({ luecke: "kein Punkt höchstens 30 min nach dem Merge" });
  });
  test("kein Punkt vor dem Claim oder keiner nach dem Merge: Lücke, nie 0", () => {
    expect(w({ claim, merge }, [punkt(claim + MIN, 10), punkt(merge, 11)])).toHaveProperty("luecke");
    expect(w({ claim, merge }, [punkt(claim, 10), punkt(merge - MIN, 11)])).toHaveProperty("luecke");
    expect(w({ claim, merge }, [])).toHaveProperty("luecke");
  });
  test("Fenster-Reset im Ticket-Fenster ist eine Lücke", () => {
    const reset = (claim + 30 * MIN) / 1000;
    expect(w({ claim, merge }, [punkt(claim, 90, reset), punkt(merge, 2, reset + 7 * 86_400)])).toEqual({ luecke: "Fenster-Reset im Ticket-Fenster" });
  });
  test("Punkte ohne 7-Tage-Fenster werden ignoriert", () => {
    const ohne: Punkt = { stand: claim - MIN, fiveHour: { pct: 1, resetsAt: 1 } };
    expect(w({ claim, merge }, [ohne, { ...ohne, stand: merge + MIN }])).toHaveProperty("luecke");
  });
  test("negatives Delta ist eine Lücke", () => {
    expect(w({ claim, merge }, [punkt(claim, 10), punkt(merge, 8)])).toEqual({ luecke: "negatives Delta im Verlauf" });
  });
  test("das Ende ist der erste Punkt ab dem Merge, nicht der letzte davor", () => {
    expect(w({ claim, merge }, [punkt(claim, 10), punkt(merge - 10 * MIN, 11), punkt(merge + MIN, 15)])).toEqual({ delta: 5 });
  });
});

describe("teileZeitanteilig", () => {
  test("zwei gleiche Fenster mit je 10 pp: je 5", () => {
    const m = L.teileZeitanteilig([
      { ticket: 1, claim: 0, merge: 10, delta: 10 },
      { ticket: 2, claim: 0, merge: 10, delta: 10 },
    ]);
    expect([m.get(1), m.get(2)]).toEqual([5, 5]);
  });
  test("Teilüberlappung [0,10] und [5,15] mit je 10 pp: je 7,5", () => {
    const m = L.teileZeitanteilig([
      { ticket: 1, claim: 0, merge: 10, delta: 10 },
      { ticket: 2, claim: 5, merge: 15, delta: 10 },
    ]);
    expect([m.get(1), m.get(2)]).toEqual([7.5, 7.5]);
  });
  test("ein Lücken-Ticket (ohne delta) zählt als gleichzeitig laufend, bekommt aber keinen Anteil", () => {
    const m = L.teileZeitanteilig([
      { ticket: 1, claim: 0, merge: 10, delta: 10 },
      { ticket: 2, claim: 0, merge: 10 },
    ]);
    expect(m.get(1)).toBe(5);
    expect(m.has(2)).toBe(false);
  });
  test("ein einzelnes Ticket behält sein Delta, ein Fenster der Länge 0 ebenso", () => {
    expect(L.teileZeitanteilig([{ ticket: 1, claim: 0, merge: 10, delta: 7 }]).get(1)).toBe(7);
    expect(L.teileZeitanteilig([{ ticket: 1, claim: 4, merge: 4, delta: 3 }]).get(1)).toBe(3);
  });
});

describe("kontrollzahl", () => {
  const von = T0;
  const bis = T0 + 10 * 3_600_000;
  test("Σ Zuwachs durch Tickets, Basis ist der letzte Punkt vor von", () => {
    const k = L.kontrollzahl([punkt(von - MIN, 10), punkt(von + MIN, 14), punkt(bis - MIN, 20)], { von, bis, anzahlTickets: 5 });
    expect(k).toMatchObject({ summe: 10, quotient: 2, resets: 0 });
  });
  test("über einen Reset zählt der neue Stand, der Reset wird gezählt", () => {
    const reset = (von + 2 * 3_600_000) / 1000;
    const k = L.kontrollzahl([punkt(von, 80, reset), punkt(von + 3 * 3_600_000, 5, reset + 7 * 86_400)], { von, bis, anzahlTickets: 1 });
    expect(k).toMatchObject({ summe: 5, resets: 1 });
  });
  test("weniger als 2 Punkte oder 0 Tickets: Lücke", () => {
    expect(L.kontrollzahl([punkt(von + MIN, 10)], { von, bis, anzahlTickets: 2 })).toHaveProperty("luecke");
    expect(L.kontrollzahl([punkt(von, 1), punkt(bis, 2)], { von, bis, anzahlTickets: 0 })).toHaveProperty("luecke");
  });
});

describe("Claims", () => {
  const antwort = (nodes: { createdAt: string }[]) => ({ data: { repository: { i7: { timelineItems: { nodes } } } } });
  test("die Abfrage nennt je Ticket einen Alias und ASSIGNED_EVENT", () => {
    const q = L.claimAbfrage([7, 9]);
    expect(q).toContain("i7: issue(number: 7)");
    expect(q).toContain("i9: issue(number: 9)");
    expect(q).toContain("ASSIGNED_EVENT");
  });
  test("das letzte assigned-Event vor dem Merge gewinnt; spätere zählen nicht", () => {
    const m = new Map([[7, "2026-10-15T12:00:00Z"]]);
    const c = L.claimsAusAntwort(antwort([{ createdAt: "2026-10-14T08:00:00Z" }, { createdAt: "2026-10-15T09:00:00Z" }, { createdAt: "2026-10-16T09:00:00Z" }]), m);
    expect(c.get(7)).toEqual({ claim: Date.parse("2026-10-15T09:00:00Z") });
  });
  test("ohne Event vor dem Merge eine Lücke, fehlender Alias wirft", () => {
    const m = new Map([[7, "2026-10-15T12:00:00Z"]]);
    expect(L.claimsAusAntwort(antwort([]), m).get(7)).toEqual({ luecke: "kein assigned-Event vor dem Merge" });
    expect(() => L.claimsAusAntwort({ data: { repository: {} } }, m)).toThrow(/#7/);
    expect(() => L.claimsAusAntwort({}, m)).toThrow();
  });
});

describe("aboKontingent und Abschnitt", () => {
  const claim = T0;
  const merge = T0 + 60 * MIN;
  const zeile = (ticket: number, extra: Partial<Ticketzeile> = {}): Ticketzeile => ({ ticket, pr: ticket + 100, gemergt: new Date(merge).toISOString(), blocker: [{ lens: "a", n: 0 }], nacharbeit: "nein", ...extra });
  const eins = (punkte: Punkt[], t: Ticketzeile[] = [zeile(1)], kaputt = 0) =>
    L.aboKontingent({ tickets: t, punkte, kaputt, claims: new Map(t.map((x) => [x.ticket, { claim }])), von: T0 - 3_600_000, bis: merge + 3_600_000 });

  test("Messwert, Median und Kontrollzahl", () => {
    const a = eins([punkt(claim, 10), punkt(merge, 14)]);
    expect(a.zeilen).toEqual([{ ticket: 1, pr: 101, pp: 4 }]);
    expect(a).toMatchObject({ gemessen: 1, gesamt: 1, median: 4, kontrolle: { summe: 4, quotient: 4 } });
  });
  test("Negativfall: eine kaputte Zeile an der Stelle des einzigen Punkts vor dem Claim ergibt eine Lücke statt 0 und zählt als Datenlücke", () => {
    const text = `{kaputt\n${JSON.stringify(punkt(merge, 14))}\n`;
    const v = L.verlaufAus(text);
    const a = eins(v.punkte, [zeile(1)], v.kaputt);
    expect(a.zeilen[0]).toEqual({ ticket: 1, pr: 101, luecke: "kein Punkt höchstens 30 min vor dem Claim" });
    expect(a.median).toBeNull();
    expect(a.kaputt).toBe(1);
    expect(L.aboKontingentAbschnitt(a).join("\n")).toContain("Datenlücken im Verlauf: 1 kaputte Zeilen übersprungen");
  });
  test("Quoten nur über gemessene Tickets; Blocker ohne Feld und offene Nacharbeit zählen nicht in den Nenner", () => {
    const t = [
      zeile(1, { blocker: [{ lens: "a", n: 2 }], nacharbeit: "folge" }),
      zeile(2, { blocker: null, nacharbeit: "offen" }),
      zeile(3, { nacharbeit: "revert" }),
      zeile(4, { gemergt: new Date(merge + 500 * MIN).toISOString(), blocker: [{ lens: "a", n: 9 }], nacharbeit: "folge" }), // keine Messung: zählt nicht
    ];
    const a = eins([punkt(claim, 10), punkt(merge, 11)], t);
    expect(a.gemessen).toBe(3);
    expect(a.blocker).toEqual({ n: 1, von: 2 });
    expect(a.folge).toEqual({ n: 2, von: 2, offen: 1 });
  });
  test("eine Claim-Lücke (kein assigned-Event) erscheint mit ihrem Grund, nicht mit einem Messgrund", () => {
    const a = L.aboKontingent({ tickets: [zeile(1)], punkte: [punkt(claim, 10), punkt(merge, 14)], kaputt: 0, claims: new Map([[1, { luecke: "kein assigned-Event vor dem Merge" }]]), von: T0, bis: merge });
    expect(a.zeilen).toEqual([{ ticket: 1, pr: 101, luecke: "kein assigned-Event vor dem Merge" }]);
    expect(a.gemessen).toBe(0);
  });
  test("Überlappung: zwei Tickets im selben Fenster teilen das Delta", () => {
    const a = eins([punkt(claim, 10), punkt(merge, 20)], [zeile(1), zeile(2)]);
    expect(a.zeilen.map((z) => z.pp)).toEqual([5, 5]);
  });
  test("Abschnitt: Tabelle, Komma-Format, Lücke mit Grund, Median, Kontrollzahl, Quoten", () => {
    // Ticket 2 ist eine Lücke, läuft aber gleichzeitig: Ticket 1 bekommt nur den halben Anteil.
    const a = eins([punkt(claim, 10), punkt(merge, 12.5)], [zeile(1), zeile(2, { gemergt: new Date(merge + 900 * MIN).toISOString() })]);
    const text = L.aboKontingentAbschnitt(a).join("\n");
    expect(text).toContain("| #1 | #101 | 1,25 pp |");
    expect(text).toContain("| #2 | #102 | Lücke: kein Punkt höchstens 30 min nach dem Merge |");
    expect(text).toContain("Gemessen: 1 von 2; Median: 1,25 pp");
    expect(text).toContain("Kontrollzahl: 1,25 pp je Ticket (Σ Zuwachs 2,5 pp, 2 Tickets, Resets 0");
    expect(text).toContain("Blocker-Quote (Runde 1 mit Blocker): 0 % (0/1)");
    expect(text).toContain("Folge-Quote (Nacharbeit): 0 % (0/1), offen: 0");
    expect(L.aboKontingentAbschnitt({ luecke: "weg" })).toEqual(["- Lücke: weg"]);
  });
  test("ohne Messwert steht für Median und Quoten ein Strich", () => {
    const text = L.aboKontingentAbschnitt(eins([], [zeile(1)])).join("\n");
    expect(text).toContain("Median: –");
    expect(text).toContain("Blocker-Quote (Runde 1 mit Blocker): –");
    expect(text).toContain("Kontrollzahl: Lücke:");
  });
});

describe("ladeAboKontingent und Bericht", () => {
  const tickets: Ticketzeile[] = [{ ticket: 7, pr: 70, gemergt: "2026-10-15T11:00:00Z", blocker: [{ lens: "a", n: 0 }], nacharbeit: "nein" }];
  const von = "2026-10-15T00:00:00Z";
  const bis = "2026-10-16T00:00:00Z";
  const claimAntwort = { data: { repository: { i7: { timelineItems: { nodes: [{ createdAt: "2026-10-15T10:00:00Z" }] } } } } };
  const verlauf = [punkt(Date.parse("2026-10-15T09:59:00Z"), 10), punkt(Date.parse("2026-10-15T11:05:00Z"), 13)].map((p) => JSON.stringify(p)).join("\n");

  test("liest den Verlauf, holt die Claims in einem Block und wertet aus", () => {
    const aufrufe: string[][] = [];
    const r = K.ladeAboKontingent({ von, bis, tickets }, { gh: (a) => (aufrufe.push(a), claimAntwort), lies: () => verlauf, pfad: "/x/v.jsonl" });
    expect(r.zeilen).toEqual([{ ticket: 7, pr: 70, pp: 3 }]);
    expect(aufrufe).toHaveLength(1);
  });
  test("fehlender Verlauf und gh-Fehler sind Lücken mit Grund, nie 0", () => {
    const nein = () => {
      throw new Error("ENOENT");
    };
    expect(K.ladeAboKontingent({ von, bis, tickets }, { gh: () => claimAntwort, lies: nein, pfad: "/x/v.jsonl" }).luecke).toBe("Kontingent-Verlauf fehlt: /x/v.jsonl");
    expect(K.ladeAboKontingent({ von, bis, tickets }, { gh: nein, lies: () => verlauf, pfad: "/x" }).luecke).toMatch(/^Claims nicht ladbar: .*ENOENT/);
  });
  test("der Abschnitt erscheint im Markdown nur, wenn das Feld im Bericht steht", () => {
    const basis = { zeitraum: { von, bis }, nacharbeitFenster: { von, bis }, quelle: "Transkript", lauf: { luecke: "x" }, nacharbeit: { luecke: "y" }, tickets: [] };
    expect(K.renderMarkdown(basis)).not.toContain("Abo-Kontingent je Ticket");
    expect(K.renderMarkdown({ ...basis, kontingent: { luecke: "Kontingent-Verlauf fehlt: /x" } })).toContain("**Abo-Kontingent je Ticket**\n- Lücke: Kontingent-Verlauf fehlt: /x");
  });
  test("Quelltext: kein Langfuse-Import und kein Secret-Key in der neuen Lib", () => {
    const lib = readFileSync("scripts/abo-kontingent-lib.mjs", "utf8");
    expect(lib).not.toMatch(/langfuse/i);
    const kennzahlen = readFileSync("scripts/factory-kennzahlen.mjs", "utf8");
    expect(kennzahlen).not.toMatch(/LANGFUSE_SECRET_KEY|from "\.\/langfuse-/);
  });
});
