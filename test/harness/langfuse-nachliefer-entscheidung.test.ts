/* Reine Kernfunktionen der Session-Verarbeitung des Nachlieferers (factory#215 L8): `nachlieferEntscheidung`, `fruehesEnde`, `bereinigeEintrag`.
 *
 * Kein Netz, kein Dateisystem: die Entscheidung „senden, mehrdeutig, Vorschau“ steht als pure Funktion neben `verarbeite` (dessen Verhalten
 * über `nachliefern` in langfuse-nachliefern.test.ts unverändert bleibt). Tabellentests je Zweig.
 */
import { describe, expect, test } from "vitest";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNach from "../../scripts/langfuse-nachliefern.mjs";

type Eintrag = { id: string };
type Diff = { fehlend: Eintrag[]; dubletten: object[]; unzuordenbar: object[]; leer?: object[]; art: string };
type Entscheidung = { zuSenden: Eintrag[]; sendbar: Eintrag[]; mehrdeutig: boolean; dubletten: number; unzuordenbar: number; leer: number; wuerdeSenden: number; status?: string };
const N = rawNach as unknown as {
  STATUS: Record<string, string>;
  GESENDET_ABLAUF_MS: number;
  RUHEFRIST_BEENDET_MS: number;
  nachlieferEntscheidung: (a: { diff: Diff | null; gesendet: string[]; davor: boolean; trocken: boolean }) => Entscheidung;
  fruehesEnde: (a: { alt?: Record<string, unknown>; unveraendert: boolean; mtime: number; now: number; beendet: boolean }) => string | null;
  bereinigeEintrag: (a: { alt?: Record<string, unknown>; s: { pfad: string; groesse: number; mtime: number }; beendet: boolean; now: number }) => Record<string, unknown>;
  BEFUND_MEHRDEUTIG: string;
};

const fehlend = (...ids: string[]): Eintrag[] => ids.map((id) => ({ id }));
const objekte = (n: number): object[] => Array.from({ length: n }, () => ({}));
const diffVon = (o: { fehlend?: string[]; dubletten?: number; unzuordenbar?: number; leer?: number; art?: string }): Diff => ({
  fehlend: fehlend(...(o.fehlend ?? [])),
  dubletten: objekte(o.dubletten ?? 0),
  unzuordenbar: objekte(o.unzuordenbar ?? 0),
  leer: objekte(o.leer ?? 0),
  art: o.art ?? "fingerprint",
});
const entscheide = (diff: Diff | null, extra: { gesendet?: string[]; davor?: boolean; trocken?: boolean } = {}) =>
  N.nachlieferEntscheidung({ diff, gesendet: extra.gesendet ?? [], davor: extra.davor ?? false, trocken: extra.trocken ?? false });
const ids = (l: Eintrag[]) => l.map((e) => e.id);

describe("nachlieferEntscheidung", () => {
  test("ohne Diff (Δ = 0): nichts zu senden, alle Zähler 0, kein Status", () => {
    const e = entscheide(null);
    expect(e).toEqual({ zuSenden: [], sendbar: [], mehrdeutig: false, dubletten: 0, unzuordenbar: 0, leer: 0, wuerdeSenden: 0 });
    expect(e.status).toBeUndefined();
  });

  test("fehlende Calls sind sendbar; Zähler stammen aus dem Diff", () => {
    const e = entscheide(diffVon({ fehlend: ["a", "b"], dubletten: 2, leer: 3, art: "messageId" }));
    expect(ids(e.zuSenden)).toEqual(["a", "b"]);
    expect(ids(e.sendbar)).toEqual(["a", "b"]);
    expect([e.mehrdeutig, e.dubletten, e.unzuordenbar, e.leer, e.status]).toEqual([false, 2, 0, 3, undefined]);
  });

  test("ein Call, der als gesendet im Ledger steht, wird nicht erneut gesendet", () => {
    const e = entscheide(diffVon({ fehlend: ["a", "b"] }), { gesendet: ["b"] });
    expect(ids(e.zuSenden)).toEqual(["a"]);
    expect(ids(e.sendbar)).toEqual(["a"]);
  });

  test("mehrdeutig: Fingerabdruck-Abgleich mit fehlenden Calls UND unzuordenbaren Dubletten, nichts sendbar", () => {
    const e = entscheide(diffVon({ fehlend: ["a"], dubletten: 1, unzuordenbar: 1 }));
    expect(e.mehrdeutig).toBe(true);
    expect(ids(e.zuSenden)).toEqual(["a"]);
    expect(e.sendbar).toEqual([]);
    expect(e.unzuordenbar).toBe(1);
    expect(e.status).toBeUndefined();
  });

  test.each([
    ["messageId statt Fingerabdruck", { fehlend: ["a"], dubletten: 1, unzuordenbar: 1, art: "messageId" }],
    ["nichts fehlt (nur unzuordenbare Dubletten)", { dubletten: 1, unzuordenbar: 1 }],
    ["nur Kopien gedeckter Calls, keine unzuordenbare Dublette (factory#213)", { fehlend: ["a"], dubletten: 2, unzuordenbar: 0 }],
  ])("nicht mehrdeutig: %s", (_name, o) => {
    const e = entscheide(diffVon(o));
    expect(e.mehrdeutig).toBe(false);
    expect(ids(e.sendbar)).toEqual(o.fehlend ?? []);
  });

  test("vor Stichtag: Status vor Stichtag, die Vorschau zählt die sendbaren Calls (mehrdeutig: 0); Vorrang vor trocken", () => {
    const e = entscheide(diffVon({ fehlend: ["a", "b"] }), { davor: true, trocken: true });
    expect([e.status, e.wuerdeSenden]).toEqual([N.STATUS.VOR_STICHTAG, 2]);
    const m = entscheide(diffVon({ fehlend: ["a"], unzuordenbar: 1, dubletten: 1 }), { davor: true });
    expect([m.status, m.wuerdeSenden, m.mehrdeutig]).toEqual([N.STATUS.VOR_STICHTAG, 0, true]);
  });

  test("trocken: Status trocken mit Vorschau, bei Mehrdeutigkeit Status mehrdeutig und 0", () => {
    const e = entscheide(diffVon({ fehlend: ["a", "b"] }), { trocken: true, gesendet: ["a"] });
    expect([e.status, e.wuerdeSenden]).toEqual([N.STATUS.TROCKEN, 1]);
    const m = entscheide(diffVon({ fehlend: ["a"], unzuordenbar: 1, dubletten: 1 }), { trocken: true });
    expect([m.status, m.wuerdeSenden]).toEqual([N.STATUS.MEHRDEUTIG, 0]);
  });

  test("Status-Literale sind die gewohnten Texte (Ledger, Log und Bericht tragen sie)", () => {
    expect(N.STATUS).toEqual({
      AKTUELL: "aktuell",
      LAEUFT: "läuft",
      BESTAETIGT: "bestätigt",
      OHNE_CALLS: "ohne Calls",
      VOR_STICHTAG: "vor Stichtag",
      MEHRDEUTIG: "mehrdeutig",
      TROCKEN: "trocken",
      GESENDET: "gesendet",
      FEHLER: "Fehler",
      VOLLSTAENDIG: "vollständig",
    });
  });
});

describe("fruehesEnde", () => {
  const NOW = Date.parse("2026-01-10T12:00:00Z");
  const ALT = NOW - 10 * 86_400_000;
  const ende = (o: { alt?: Record<string, unknown>; unveraendert?: boolean; mtime?: number; beendet?: boolean }) => N.fruehesEnde({ alt: o.alt, unveraendert: o.unveraendert ?? false, mtime: o.mtime ?? ALT, now: NOW, beendet: o.beendet ?? false });

  test("ohne Eintrag und lange Ruhe: kein frühes Ende", () => {
    expect(ende({})).toBeNull();
  });

  test("Ruhefrist nicht um: läuft (bei bekanntem Ende nach 150 s, sonst nach 24 h), auch gegen einen bestätigten Eintrag", () => {
    expect(ende({ mtime: NOW - 1000, beendet: true })).toBe(N.STATUS.LAEUFT);
    expect(ende({ mtime: NOW - N.RUHEFRIST_BEENDET_MS - 1, beendet: true })).toBeNull();
    expect(ende({ mtime: NOW - 3_600_000, beendet: false })).toBe(N.STATUS.LAEUFT);
    expect(ende({ mtime: NOW - 1000, alt: { bestaetigt: true }, unveraendert: true })).toBe(N.STATUS.LAEUFT);
  });

  test("bestätigter, unveränderter Eintrag: bestätigt; geändert oder mit Mehrdeutigkeits-Befund nicht", () => {
    expect(ende({ alt: { bestaetigt: true }, unveraendert: true })).toBe(N.STATUS.BESTAETIGT);
    expect(ende({ alt: { bestaetigt: true }, unveraendert: false })).toBeNull();
    expect(ende({ alt: { bestaetigt: true, befund: N.BEFUND_MEHRDEUTIG }, unveraendert: true })).toBeNull();
  });

  test("Vermerk (ohne Calls, vor Stichtag) bei unverändertem Stand ist der Status; bei geändertem Stand nicht", () => {
    expect(ende({ alt: { vermerk: "ohne Calls" }, unveraendert: true })).toBe("ohne Calls");
    expect(ende({ alt: { vermerk: "ohne Calls" }, unveraendert: false })).toBeNull();
  });
});

describe("bereinigeEintrag", () => {
  const NOW = 1_000_000_000_000;
  const s = { pfad: "p.jsonl", groesse: 5, mtime: 7 };

  test("ohne alten Eintrag: leerer Stand mit Dateistand, unbestätigt", () => {
    expect(N.bereinigeEintrag({ s, beendet: false, now: NOW })).toEqual({ gesendet: [], spans: [], gesendetAm: {}, pfad: "p.jsonl", groesse: 5, mtime: 7, bestaetigt: false, beendet: false });
  });

  test("abgelaufene und zeitlose Ledger-Einträge zählen nicht mehr als unterwegs; Spans bleiben, Bestätigung fällt", () => {
    const alt = { gesendet: ["frisch", "alt", "ohneZeit"], gesendetAm: { frisch: NOW - 1000, alt: NOW - N.GESENDET_ABLAUF_MS }, spans: ["sp"], bestaetigt: true, beendet: true, befund: "x" };
    const e = N.bereinigeEintrag({ alt, s, beendet: true, now: NOW });
    expect(e.gesendet).toEqual(["frisch"]);
    expect(e.gesendetAm).toEqual({ frisch: NOW - 1000 });
    expect(e.spans).toEqual(["sp"]);
    expect([e.bestaetigt, e.beendet, e.groesse, e.mtime]).toEqual([false, true, 5, 7]);
  });

  test("ein Eintrag knapp vor Ablauf zählt noch als unterwegs", () => {
    const e = N.bereinigeEintrag({ alt: { gesendet: ["x"], gesendetAm: { x: NOW - N.GESENDET_ABLAUF_MS + 1 } }, s, beendet: false, now: NOW });
    expect(e.gesendet).toEqual(["x"]);
  });
});
