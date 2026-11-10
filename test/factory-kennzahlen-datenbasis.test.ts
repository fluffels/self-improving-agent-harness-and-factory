/* Datenbasis-Prüfung (factory#258): ohne Transkripte der Ticket-Läufe gibt es eine Lücke statt Zahlen. Pure Zählung,
 * Darstellung und der Zweig `erstelleDatenbasis` mit injiziertem `run`; der CLI-Zweig läuft ohne gh offline. */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/factory-kennzahlen.mjs";

type Claims = Map<number, { session: string; ts: string }[]>;
type Ticket = { ticket: number; pr: number };
type Basis = { stand: string; laeufe: number; mitTranskript: number; sessions: string[]; ohne: number[] };
type Run = (name: string, args: string[]) => { status: number; stdout: string; stderr: string };
const F = raw as unknown as {
  parseArgs: (argv: string[]) => { datenbasis: boolean; fehler: string | null };
  datenbasis: (a: { tickets: Ticket[]; claims: Claims }) => Basis;
  datenbasisAbschnitt: (d: Basis) => string;
  erstelleDatenbasis: (a: { von: string; bis: string }, d: { run: Run; claimKarte: () => Claims }) => { text: string; exit: number };
};

const t = (ticket: number): Ticket => ({ ticket, pr: ticket + 1000 });
const karte = (e: Record<number, string[]>): Claims => new Map(Object.entries(e).map(([k, v]) => [Number(k), v.map((session) => ({ session, ts: "2026-11-01T10:00:00Z" }))]));
const lauf = (zeilen: { pr: number; ticket: number }[]) =>
  JSON.stringify({
    zeilen: zeilen.map((z) => ({ ...z, gemergt: "2026-11-02T10:00:00Z", ciFix: 0, nacharbeit: "keine", abnahme: null })),
    kennzahlen: { prs: 0, ohneNacharbeit: 0, nachweisbareFenster: 0, nacharbeitOffen: 0, ciFixSumme: 0, festgefahrenSumme: 0, runde1MitBlocker: 0, mitBlockerFeld: 0, abnahme: { gemessen: 0, ersterDurchgang: 0, entfaellt: 0, override: 0, ohne: 0 } },
  });

describe("parseArgs --datenbasis", () => {
  const basis = ["--von", "2026-11-01T00:00:00Z", "--bis", "2026-11-08T00:00:00Z"];
  test("Flag gesetzt oder nicht; unbekanntes Flag bleibt ein Fehler", () => {
    expect(F.parseArgs([...basis, "--datenbasis"])).toMatchObject({ datenbasis: true, fehler: null });
    expect(F.parseArgs(basis).datenbasis).toBe(false);
    expect(F.parseArgs([...basis, "--datenbasiss"]).fehler).not.toBeNull();
  });
});

describe("datenbasis", () => {
  test("leer: kein Lauf im Zeitraum", () => {
    expect(F.datenbasis({ tickets: [], claims: karte({}) })).toMatchObject({ stand: "leer", laeufe: 0, mitTranskript: 0 });
  });
  test("erfüllt: jeder Lauf hat eine Session", () => {
    expect(F.datenbasis({ tickets: [t(1), t(2)], claims: karte({ 1: ["a"], 2: ["b"] }) })).toMatchObject({ stand: "erfüllt", laeufe: 2, mitTranskript: 2, ohne: [] });
  });
  test("teilweise: nur ein Teil, die Tickets ohne Transkript stehen in `ohne`", () => {
    expect(F.datenbasis({ tickets: [t(1), t(2), t(3)], claims: karte({ 2: ["b"] }) })).toMatchObject({ stand: "teilweise", laeufe: 3, mitTranskript: 1, ohne: [1, 3] });
  });
  test("verletzt nur bei 0 von n (n > 0)", () => {
    expect(F.datenbasis({ tickets: [t(1), t(2)], claims: karte({ 9: ["x"] }) })).toMatchObject({ stand: "verletzt", mitTranskript: 0, ohne: [1, 2] });
  });
  test("eine leere Session-Liste zählt als ohne Transkript", () => {
    expect(F.datenbasis({ tickets: [t(1)], claims: karte({ 1: [] }) }).stand).toBe("verletzt");
  });
  test("zwei Sessions eines Tickets zählen das Ticket einmal; gleiche Session bei zwei Tickets steht einmal, sortiert", () => {
    const d = F.datenbasis({ tickets: [t(1), t(2)], claims: karte({ 1: ["s2", "s1"], 2: ["s2"] }) });
    expect(d.mitTranskript).toBe(2);
    expect(d.sessions).toEqual(["s1", "s2"]);
  });
});

describe("datenbasisAbschnitt", () => {
  const d = (stand: string, extra: Partial<Basis> = {}): Basis => ({ stand, laeufe: 2, mitTranskript: 0, sessions: [], ohne: [4, 5], ...extra });
  test("verletzt nennt die Vorbedingung samt Weg", () => {
    const s = F.datenbasisAbschnitt(d("verletzt"));
    expect(s).toContain("Vorbedingung verletzt: keine Transkripte der Ticket-Läufe auf dieser Maschine");
    expect(s).toContain("Status-Lauf auf der Maschine der Ticket-Läufe fahren");
    expect(s).toContain("Sessions mit Claim-Zeile: keine.");
  });
  test("erfüllt und teilweise ohne Verletzungs-Zeile, teilweise nennt die Tickets ohne Transkript", () => {
    expect(F.datenbasisAbschnitt(d("erfüllt", { mitTranskript: 2, ohne: [], sessions: ["s1"] }))).not.toContain("Vorbedingung verletzt");
    expect(F.datenbasisAbschnitt(d("erfüllt", { mitTranskript: 2, ohne: [], sessions: ["s1"] }))).not.toContain("Tickets ohne Transkript");
    const s = F.datenbasisAbschnitt(d("teilweise", { mitTranskript: 1, sessions: ["s1"] }));
    expect(s).not.toContain("Vorbedingung verletzt");
    expect(s).toContain("#4");
    expect(s).toContain("s1");
  });
  test("zeigt Läufe und Anteil mit Transkript", () => {
    expect(F.datenbasisAbschnitt(d("teilweise", { mitTranskript: 1 }))).toMatch(/Datenbasis/);
    expect(F.datenbasisAbschnitt(d("teilweise", { mitTranskript: 1 }))).toMatch(/1 von 2/);
  });
});

describe("erstelleDatenbasis", () => {
  const ra = { von: "2026-11-01T00:00:00Z", bis: "2026-11-08T00:00:00Z" };
  const mitRun = (stdout: string, status = 0) => {
    const aufrufe: string[] = [];
    const run: Run = (name) => {
      aufrufe.push(name);
      return { status, stdout, stderr: status === 0 ? "" : "boom" };
    };
    return { run, aufrufe };
  };
  test("Exit 3 bei verletzt, 0 bei teilweise, 0 bei erfüllt, 0 bei leer; nur lauf-ergebnis wird gestartet", () => {
    const zeilen = [{ pr: 11, ticket: 1 }, { pr: 12, ticket: 2 }];
    const a = mitRun(lauf(zeilen));
    expect(F.erstelleDatenbasis(ra, { run: a.run, claimKarte: () => karte({}) }).exit).toBe(3);
    expect(F.erstelleDatenbasis(ra, { run: a.run, claimKarte: () => karte({ 1: ["a"] }) }).exit).toBe(0);
    expect(F.erstelleDatenbasis(ra, { run: a.run, claimKarte: () => karte({ 1: ["a"], 2: ["b"] }) }).exit).toBe(0);
    expect(F.erstelleDatenbasis(ra, { run: mitRun(lauf([])).run, claimKarte: () => karte({}) }).exit).toBe(0);
    expect(new Set(a.aufrufe)).toEqual(new Set(["lauf-ergebnis.mjs"]));
  });
  test("verletzt: der Text trägt den Abschnitt Datenbasis und die Vorbedingung", () => {
    const r = F.erstelleDatenbasis(ra, { run: mitRun(lauf([{ pr: 11, ticket: 1 }])).run, claimKarte: () => karte({}) });
    expect(r.text).toContain("Vorbedingung verletzt");
  });
  test("lauf-ergebnis fehlt: Exit 2 mit Lücke samt Grund, kein Urteil", () => {
    const r = F.erstelleDatenbasis(ra, { run: mitRun("", 1).run, claimKarte: () => karte({}) });
    expect(r.exit).toBe(2);
    expect(r.text).toMatch(/Lücke/);
    expect(r.text).toContain("lauf-ergebnis Exit 1");
    expect(r.text).not.toContain("Vorbedingung verletzt");
  });
});

describe("CLI --datenbasis", () => {
  test("ohne gh: nur der Datenbasis-Abschnitt als Lücke, Exit 2, kein Kennzahlen-Block", () => {
    const skript = fileURLToPath(new URL("../scripts/factory-kennzahlen.mjs", import.meta.url));
    const leer = mkdtempSync(join(tmpdir(), "datenbasis-"));
    try {
      const r = spawnSync(process.execPath, [skript, "--datenbasis", "--von", "2026-11-01T00:00:00Z", "--bis", "2026-11-08T00:00:00Z"], { encoding: "utf8", env: { ...process.env, PATH: leer } });
      expect(r.status).toBe(2);
      expect(r.stdout).toContain("### Datenbasis");
      expect(r.stdout).toContain("Lücke: lauf-ergebnis Exit");
      expect(r.stdout).not.toContain("Lauf-Ergebnis");
    } finally {
      rmSync(leer, { recursive: true, force: true });
    }
  });
});
