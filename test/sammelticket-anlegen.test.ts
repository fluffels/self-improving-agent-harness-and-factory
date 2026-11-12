/* Sammelticket anlegen (#1390 Z10): Argumente, Body und die Suche nach einem vorhandenen Ticket sind pure Funktionen; die gh-Aufrufe
 * (Anlegen, Position setzen und prüfen) laufen im Glue und werden per --dry-run gegen das echte Board gesichtet.
 *
 * Reines Node-Tooling ohne Declaration-File: Namespace über `unknown` auf ein lokales Interface (Technik wie test/board.test.ts). */
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sammelticket-anlegen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/board-lib.mjs";
import { echteSpezifikation } from "./support/echte-sprache";
import { FREMD, FREMD_OWNER } from "./support/fremd-config";

const OWNER = FREMD_OWNER; // Login des Maintainer-Accounts, nur Testdaten

type Args = { art: string; vorgaenger: number | null; top: boolean; dry: boolean };
type User = { login: string; type?: string } | null;
type Komm = { user: User; body: string };
type Offen = { number: number; titel: string; assignees: string[]; createdAt: string };
type Anlegen = {
  parseArgs: (argv: string[]) => Args | null;
  sammelticketBody: (a: { art: string; vorgaenger?: number | null; vorgaengerZustand?: string; blocker?: string }) => string;
  zustandVonIssue: (issue: { state?: string; assignees?: unknown[] } | null) => string;
  korrekturFuer: (a: { items: unknown[]; nr: number; position: number }) => { nr: number; id: string; afterId: string | null } | null;
  kandidatenSammelticket: (offene: Offen[], titel: string, o?: { nach?: number | null }) => Offen[];
  zaehleBefundZeilen: (k: Komm[], o: { vertraut: (u: User) => boolean; nurOffen?: boolean }) => number;
  dublettenEntscheidung: (a: { eigenNr: number; titel: string; eigenKommentare: number; andere: Offen[]; vorgaenger?: number | null }) => { art: string; aelter?: number };
};
const A = raw as unknown as Anlegen;
const BL = echteSpezifikation().blocker as string;
const ergaenzeFehlende = (rawLib as unknown as { ergaenzeFehlende: (items: unknown[], neu: unknown[]) => unknown[] }).ergaenzeFehlende;

describe("parseArgs", () => {
  test("harness ohne und mit Vorgänger, langfuse ohne und mit --top, --dry-run an beliebiger Stelle", () => {
    expect(A.parseArgs(["harness"])).toEqual({ art: "harness", vorgaenger: null, top: false, dry: false });
    expect(A.parseArgs(["harness", "--vorgaenger", "#1390"])).toEqual({ art: "harness", vorgaenger: 1390, top: false, dry: false });
    expect(A.parseArgs(["--dry-run", "harness", "--vorgaenger", "7"])).toMatchObject({ vorgaenger: 7, dry: true });
    expect(A.parseArgs(["langfuse"])).toEqual({ art: "langfuse", vorgaenger: null, top: false, dry: false });
    expect(A.parseArgs(["langfuse", "--top", "--dry-run"])).toEqual({ art: "langfuse", vorgaenger: null, top: true, dry: true });
    expect(A.parseArgs(["codequalitaet"])).toEqual({ art: "codequalitaet", vorgaenger: null, top: false, dry: false });
    expect(A.parseArgs(["codequalitaet", "--vorgaenger", "5", "--dry-run"])).toEqual({ art: "codequalitaet", vorgaenger: 5, top: false, dry: true });
  });

  test("Inline-Wert --vorgaenger=7 wird angenommen (node:util)", () => {
    expect(A.parseArgs(["harness", "--vorgaenger=7"])).toMatchObject({ art: "harness", vorgaenger: 7 });
  });

  test("falsche Benutzung → null", () => {
    for (const bad of [["harness", "--generation"], ["--dry-run", "harness", "--generation"], ["langfuse", "--generation"], ["harness", "--vorgaenger", "5", "--generation"], [], ["egal"], ["harness", "--vorgaenger"], ["harness", "--vorgaenger", "abc"], ["harness", "--vorgaenger", "0"], ["harness", "--vorgaenger", "1.5"], ["harness", "--top"], ["harness", "--vorgaenger", "5", "x"], ["langfuse", "--vorgaenger", "5"], ["langfuse", "--top", "x"], ["--dry-run"], ["toString"], ["harness", "--dry-run", "--dry-run"], ["harness", "--vorgaenger", "5", "--vorgaenger", "6"], ["--vorgaenger", "5", "harness"], ["harness", "--"], ["harness", "--vorgaenger", "--dry-run"], ["harness", "--vorgaenger="], ["codequalitaet", "--top"], ["codequalitaet", "--vorgaenger", "abc"], ["codequalitaet", "--vorgaenger", "5", "x"]]) {
      expect(A.parseArgs(bad), bad.join(" ")).toBeNull();
    }
  });
});

describe("sammelticketBody", () => {
  test("factory#156: Codequalität-Vorlage nennt „außerhalb des Slices“, Kommentar-Hinweis und bei offenem Vorgänger die Blocker-Zeile", () => {
    const b = A.sammelticketBody({ art: "codequalitaet" });
    expect(b).toContain("außerhalb des Slices");
    expect(b).toContain("`- [ ] …`");
    expect(b).not.toMatch(/Harness-Befunde|blockiert durch|Nachfolger/);
    const m = A.sammelticketBody({ art: "codequalitaet", vorgaenger: 9, vorgaengerZustand: "offen", blocker: BL });
    expect(m).toContain("Nachfolger von #9.");
    expect(m).toContain(`${BL} #9`);
  });

  test("Vorlage ohne Vorgänger: Zeile mit Kommentar-Hinweis, keine Blocker-Zeile", () => {
    const b = A.sammelticketBody({ art: "harness" });
    expect(b).toContain("Sammelticket für Harness-Befunde");
    expect(b).toContain("`- [ ] …`");
    expect(b).not.toMatch(/blockiert durch|Nachfolger/);
  });

  test("Vorgänger in Arbeit: Nachfolger-Zeile mit „dort in Arbeit“ UND „blockiert durch #N“", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "in-arbeit", blocker: BL });
    expect(b).toContain("Nachfolger von #1390 (dort in Arbeit).");
    expect(b).toMatch(/^blockiert durch #1390 \(nur solange #1390 offen ist\)$/m);
  });

  test("Vorgänger offen (ungeclaimt): Nachfolger-Zeile ohne Zusatz, Sperrzeile bleibt", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "offen", blocker: BL });
    expect(b).toContain("Nachfolger von #1390.");
    expect(b).not.toContain("dort in Arbeit");
    expect(b).not.toContain("voll");
    expect(b).toMatch(/^blockiert durch #1390 /m);
  });

  test("Vorgänger unlesbar: gilt als offen ohne Zusatz, Sperrzeile bleibt", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "unbekannt", blocker: BL });
    expect(b).toContain("Nachfolger von #1390.");
    expect(b).not.toMatch(/dort in Arbeit|voll/);
    expect(b).toMatch(/^blockiert durch #1390 /m);
  });

  test("geschlossener Vorgänger: genannt, aber ohne Blocker (kein stale „blockiert durch“)", () => {
    const b = A.sammelticketBody({ art: "harness", vorgaenger: 1390, vorgaengerZustand: "zu", blocker: BL });
    expect(b).toContain("Nachfolger von #1390.");
    expect(b).not.toContain("blockiert durch");
    expect(b).not.toContain("dort in Arbeit");
  });

  test("das Blocker-Wort kommt aus dem Parameter, nicht aus einer Konstante; ohne Wort bei offenem Vorgänger wirft er (#1860)", () => {
    expect(A.sammelticketBody({ art: "harness", vorgaenger: 7, vorgaengerZustand: "offen", blocker: "blocked by" })).toMatch(/^blocked by #7 /m);
    expect(() => A.sammelticketBody({ art: "harness", vorgaenger: 7, vorgaengerZustand: "offen" })).toThrow(/blocker/);
    expect(A.sammelticketBody({ art: "harness", vorgaenger: 7, vorgaengerZustand: "zu" })).not.toMatch(/#7 \(nur/);
  });

  test("zustandVonIssue: offen+Assignee in-arbeit, offen ohne Assignee offen, geschlossen zu, unlesbar unbekannt", () => {
    expect(A.zustandVonIssue({ state: "open", assignees: [{ login: "x" }] })).toBe("in-arbeit");
    expect(A.zustandVonIssue({ state: "open", assignees: [] })).toBe("offen");
    expect(A.zustandVonIssue({ state: "open" })).toBe("offen");
    expect(A.zustandVonIssue({ state: "closed", assignees: [{ login: "x" }] })).toBe("zu");
    expect(A.zustandVonIssue(null)).toBe("unbekannt");
  });

  test("Langfuse-Vorlage nennt Langfuse; unbekannte Art wirft", () => {
    expect(A.sammelticketBody({ art: "langfuse" })).toContain("Langfuse");
    expect(() => A.sammelticketBody({ art: "x" })).toThrow(/Unbekannte Art/);
  });
});

describe("kandidatenSammelticket", () => {
  const o = (number: number, titel: string, assignees: string[] = []): Offen => ({ number, titel, assignees, createdAt: "2026-10-01T00:00:00Z" });
  const T = "Harness-Härtung (gesammelt)";

  test("exakter Titel, ungeclaimt; absteigend sortiert (das jüngste zuerst)", () => {
    expect(A.kandidatenSammelticket([o(5, T), o(9, T), o(7, T)], T).map((i) => i.number)).toEqual([9, 7, 5]);
    expect(A.kandidatenSammelticket([o(5, T)], T).map((i) => i.number)).toEqual([5]);
  });

  test("Negativfälle: geclaimt, anderer oder fast gleicher Titel, leer → leere Liste", () => {
    expect(A.kandidatenSammelticket([o(5, T, [OWNER])], T)).toEqual([]);
    expect(A.kandidatenSammelticket([o(5, `${T} x`), o(6, T.toLowerCase()), o(7, "Langfuse-Befunde (gesammelt)")], T)).toEqual([]);
    expect(A.kandidatenSammelticket([], T)).toEqual([]);
    expect(A.kandidatenSammelticket([o(5, T, [OWNER]), o(6, T)], T).map((i) => i.number)).toEqual([6]);
  });
});

const ownerUser = { login: OWNER, type: "User" };
const vertraut = (u: User) => u?.login === OWNER;
const k = (body: string, user: User = ownerUser): Komm => ({ user, body });

describe("zaehleBefundZeilen", () => {
  test("leer → 0; Kommentar ohne Checkbox → 0", () => {
    expect(A.zaehleBefundZeilen([], { vertraut })).toBe(0);
    expect(A.zaehleBefundZeilen([k("Nur Text, kein Befund")], { vertraut })).toBe(0);
  });

  test("zählt `- [ ]`, auch mehrere je Kommentar, `*` und eingerückt", () => {
    expect(A.zaehleBefundZeilen([k("- [ ] eins")], { vertraut })).toBe(1);
    expect(A.zaehleBefundZeilen([k("Kopf\n- [ ] a\n- [ ] b\n  - [ ] c\n* [ ] d")], { vertraut })).toBe(4);
    expect(A.zaehleBefundZeilen([k("- [ ] a"), k("- [ ] b\n- [ ] c")], { vertraut })).toBe(3);
  });

  test("`- [x]` zählt nur mit nurOffen: false", () => {
    const kk = [k("- [ ] a\n- [x] b\n- [X] c")];
    expect(A.zaehleBefundZeilen(kk, { vertraut })).toBe(1);
    expect(A.zaehleBefundZeilen(kk, { vertraut, nurOffen: true })).toBe(1);
    expect(A.zaehleBefundZeilen(kk, { vertraut, nurOffen: false })).toBe(3);
  });

  test("Kommentar eines nicht vertrauten Autors (auch ohne user) zählt nicht", () => {
    expect(A.zaehleBefundZeilen([k("- [ ] fremd", { login: "fremder" }), k("- [ ] anonym", null), k("- [ ] eigen")], { vertraut })).toBe(1);
  });

  test("keine Checkbox, wenn `[ ]` mitten im Satz steht", () => {
    expect(A.zaehleBefundZeilen([k("Text mit - [ ] mittendrin")], { vertraut })).toBe(0);
  });
});

describe("Vorgänger-Ausschluss (--vorgaenger X, X ungeclaimt)", () => {
  const T = "Harness-Härtung (gesammelt)";
  const o = (number: number, assignees: string[] = []): Offen => ({ number, titel: T, assignees, createdAt: "2026-10-01T00:00:00Z" });

  test("kandidatenSammelticket: nur strikt jüngere als der Vorgänger zählen (auch ältere Tickets davor nicht)", () => {
    expect(A.kandidatenSammelticket([o(5), o(9), o(12)], T, { nach: 9 }).map((i) => i.number)).toEqual([12]);
    expect(A.kandidatenSammelticket([o(5), o(9)], T, { nach: 9 }).map((i) => i.number)).toEqual([]);
    expect(A.kandidatenSammelticket([o(5), o(9)], T, { nach: null }).map((i) => i.number)).toEqual([9, 5]);
    expect(A.kandidatenSammelticket([o(5), o(9)], T).map((i) => i.number)).toEqual([9, 5]);
  });

  test("dublettenEntscheidung: der Vorgänger ist keine ältere Dublette", () => {
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18)], vorgaenger: 18 }).art).toBe("keine");
  });

  test("ein älteres Ticket vor dem Vorgänger ist keine Dublette des Nachfolgers", () => {
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(15), o(18)], vorgaenger: 18 }).art).toBe("keine");
  });

  test("ein echtes älteres Duplikat (zwischen Vorgänger und Nachfolger) bleibt eine Dublette (Wettlauf #1560/#1561)", () => {
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18), o(19)], vorgaenger: 18 })).toEqual({ art: "eigenes-schliessen", aelter: 19 });
    expect(A.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(15)] })).toEqual({ art: "eigenes-schliessen", aelter: 15 });
  });
});

describe("Verdrahtung (#1390)", () => {
  const skript = readFileSync(new URL("../scripts/sammelticket-anlegen.mjs", import.meta.url), "utf8");
  test("das Skript liest die Position aus AGENTS.md (keine eigene Zahl) und nutzt keinen Such-Index", () => {
    expect(skript).toMatch(/positionLautAgentsMd/);
    expect(skript).not.toMatch(/readFileSync/);
    expect(skript).not.toMatch(/search\/issues|--search\b/);
    expect(skript).not.toMatch(/Position\s*:?\s*\d+/);
  });
});

describe("pruefSchritt: der Prüf- und Retry-Kern (#1390 Z10, Lens R1)", () => {
  type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
  type Schritt = { art: "ok" | "warte" | "setze" | "falsch"; k?: { nr: number; afterId: string | null } };
  const P = (raw as unknown as { pruefSchritt: (a: { items: B[]; nr: number; position: number; neuGesetzt?: number; dry?: boolean }) => Schritt }).pruefSchritt;
  const T = "Harness-Härtung (gesammelt)";
  const b = (number: number, extra: Partial<B> = {}): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<B> = {}) => b(number, { title: T, ...extra });
  const fueller = Array.from({ length: 10 }, (_, i) => b(i + 1));

  test("steht auf Position oder davor → ok", () => {
    expect(P({ items: [b(1), b(2), b(3), sammel(20), b(4)], nr: 20, position: 4 }).art).toBe("ok");
  });

  test("(b) noch nicht in der Liste → warte", () => {
    expect(P({ items: fueller, nr: 20, position: 4 }).art).toBe("warte");
  });

  test("falsche Position → setze (mit Ziel); nach 2 Neusetzungen → falsch, kein drittes Setzen", () => {
    const items = [...fueller, sammel(20)];
    expect(P({ items, nr: 20, position: 4 })).toMatchObject({ art: "setze", k: { nr: 20, afterId: "I3" } });
    expect(P({ items, nr: 20, position: 4, neuGesetzt: 1 }).art).toBe("setze");
    expect(P({ items, nr: 20, position: 4, neuGesetzt: 2 }).art).toBe("falsch");
  });

  test("(c) Trockenlauf bei falscher Position → falsch, nie setze", () => {
    expect(P({ items: [...fueller, sammel(20)], nr: 20, position: 4, dry: true }).art).toBe("falsch");
  });

  test("(d) ein anderes ungeclaimtes Sammelticket weiter oben verfälscht die Prüfung nicht: bewertet wird nr", () => {
    const items = [b(1), sammel(5), ...fueller.slice(1), sammel(20)];
    expect(P({ items, nr: 20, position: 4 })).toMatchObject({ art: "setze", k: { nr: 20 } });
    // ein geclaimtes Sammelticket davor zählt ohnehin nicht, dann ist die Lage dieselbe
    expect(P({ items: [b(1), sammel(5, { assignees: [OWNER] }), sammel(20)], nr: 20, position: 4 }).art).toBe("ok");
  });

  test("geclaimtes Ticket nr: nichts zu korrigieren", () => {
    expect(P({ items: [...fueller, sammel(20, { assignees: [OWNER] })], nr: 20, position: 4 }).art).toBe("ok");
  });
});

describe("korrekturFuer (#1646): die Korrektur gilt dem NEUEN Sammelticket, nie dem älteren", () => {
  type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
  const T = "Harness-Härtung (gesammelt)";
  const b = (number: number, extra: Partial<B> = {}): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open", ...extra });
  const sammel = (number: number, extra: Partial<B> = {}) => b(number, { title: T, ...extra });
  const fueller = Array.from({ length: 10 }, (_, i) => b(i + 1));

  test("älteres ungeclaimtes Sammelticket steht davor, das neue fehlt in der Liste und wird angehängt: Ziel ist das neue", () => {
    const items = [b(1), b(2), sammel(5), ...fueller.slice(2)];
    const mitNeu = ergaenzeFehlende(items, [sammel(20)]);
    const k = A.korrekturFuer({ items: mitNeu, nr: 20, position: 4 });
    expect(k).toMatchObject({ nr: 20, id: "I20" });
    // das ältere würde laut sammelticketKorrektur allein bewertet: es steht auf Position, also keine Korrektur für dessen Nummer
    expect(A.korrekturFuer({ items: mitNeu, nr: 5, position: 4 })).toBeNull();
  });

  test("steht auf Position oder davor → null; nicht in der Liste → null", () => {
    expect(A.korrekturFuer({ items: [b(1), b(2), sammel(20), b(3)], nr: 20, position: 4 })).toBeNull();
    expect(A.korrekturFuer({ items: fueller, nr: 20, position: 4 })).toBeNull();
  });

});

describe("Verdrahtung der Anlage ohne Selbstkorrektur (#1390, Lens R1, factory#162)", () => {
  const lies = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  test("board-place plant über planFuerArgs ohne Korrektur, das Anlege-Skript nutzt pruefSchritt und planFuerArgs", () => {
    expect(lies("scripts/board-place.mjs")).toMatch(/planFuerArgs\(items, args\)/);
    // Der Listen-Nachzug des Takts ist mit Fakes in test/board-takt-lauf.test.ts getestet (#1428 Z23), keine Quelltext-Regex mehr.
    const anlegen = lies("scripts/sammelticket-anlegen.mjs");
    expect(anlegen).toMatch(/pruefSchritt\(\{ items: lade\(board\)/);
    expect(anlegen).toMatch(/planFuerArgs\(items, \{ anchor: null, numbers: \[nr\] \}\)/);
    expect(anlegen).not.toMatch(/from "\.\/board-place\.mjs"/); // kein Skript importiert aus einem Einstiegsskript (#1398)
  });
});

describe("waehleBestaetigtes und dublettenEntscheidung (#1561 Z6: Anlegen ist idempotent gegen den Wettlauf)", () => {
  type Roh = { state: string; assignees: unknown[]; user?: { login: string; type: string } | null };
  const ICH = { login: OWNER, type: "User" };
  type Dub = { art: "keine" | "eigenes-schliessen" | "warnung"; aelter?: number };
  const Z = raw as unknown as {
    waehleBestaetigtes: (kandidaten: Offen[], einzeln: (nr: number) => Roh, owner?: string) => Offen | null;
    dublettenEntscheidung: (a: { eigenNr: number; titel: string; eigenKommentare: number; andere: Offen[] }) => Dub;
  };
  const T = "Harness-Härtung (gesammelt)";
  const o = (number: number, titel = T, assignees: string[] = []): Offen => ({ number, titel, assignees, createdAt: "2026-10-01T00:00:00Z" });
  const offen = (): Roh => ({ state: "open", assignees: [], user: ICH });

  test("nimmt das höchste bestätigte Ticket; der Einzelabruf entscheidet, nicht die (nachhinkende) Liste", () => {
    const abgerufen: number[] = [];
    const r = Z.waehleBestaetigtes([o(5), o(9), o(7)], (nr) => {
      abgerufen.push(nr);
      return offen();
    }, OWNER);
    expect(r?.number).toBe(9);
    expect(abgerufen, "ein Treffer genügt, absteigend").toEqual([9]);
  });

  test("Liste sagt offen, Einzelabruf sagt geschlossen (das war der Wettlauf #1560/#1561) → das nächste", () => {
    const r = Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? { state: "closed", assignees: [], user: ICH } : offen()), OWNER);
    expect(r?.number).toBe(7);
  });

  test("geclaimt laut Einzelabruf → das nächste; alle ungültig oder leer → null", () => {
    expect(Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? { state: "open", assignees: [{ login: OWNER }], user: ICH } : offen()), OWNER)?.number).toBe(7);
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "closed", assignees: [], user: ICH }), OWNER)).toBeNull();
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "open", assignees: [{ login: "x" }], user: ICH }), OWNER)).toBeNull();
    expect(Z.waehleBestaetigtes([], () => offen(), OWNER)).toBeNull();
  });

  test("ein werfender Einzelabruf wirft weiter (kein stilles Weiterlaufen mit unbestätigtem Stand)", () => {
    expect(() =>
      Z.waehleBestaetigtes([o(9)], () => {
        throw new Error("gh kaputt");
      }, OWNER),
    ).toThrow(/gh kaputt/);
  });

  test("Autorprüfung (W14): ein Fremder mit exaktem Titel wird nicht gewählt, der Bot und der Owner schon", () => {
    const fremd: Roh = { state: "open", assignees: [], user: { login: "fremd", type: "User" } };
    const bot: Roh = { state: "open", assignees: [], user: { login: "github-actions[bot]", type: "Bot" } };
    expect(Z.waehleBestaetigtes([o(9)], () => fremd, OWNER)).toBeNull();
    expect(Z.waehleBestaetigtes([o(9)], () => ({ state: "open", assignees: [] }), OWNER), "ohne user fail-closed").toBeNull();
    expect(Z.waehleBestaetigtes([o(9), o(7)], (nr) => (nr === 9 ? fremd : offen()), OWNER)?.number).toBe(7);
    expect(Z.waehleBestaetigtes([o(9)], () => bot, OWNER)?.number).toBe(9);
  });

  test("ohne owner wirft es, bevor ein Abruf läuft (Pflicht-Parameter)", () => {
    let abgerufen = 0;
    const einzeln = (): Roh => (abgerufen++, offen());
    expect(() => Z.waehleBestaetigtes([o(9)], einzeln)).toThrow(/owner/);
    expect(() => Z.waehleBestaetigtes([o(9)], einzeln, "")).toThrow(/owner/);
    expect(abgerufen).toBe(0);
  });

  test("Dublette: ein anderes offenes ungeclaimtes Ticket gleichen Titels mit kleinerer Nummer → eigenes-schliessen (nennt das ältere)", () => {
    expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(18), o(20)] })).toEqual({ art: "eigenes-schliessen", aelter: 18 });
    expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere: [o(19), o(15)] })).toEqual({ art: "eigenes-schliessen", aelter: 15 });
  });

  test("hat das eigene Ticket schon Kommentare (Zeilen), wird nicht geschlossen, sondern gewarnt", () => {
    expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 2, andere: [o(18)] })).toEqual({ art: "warnung", aelter: 18 });
  });

  test("keine Dublette: nur größere Nummern, geclaimte, anderer Titel, nur das eigene, leer", () => {
    for (const andere of [[o(21)], [o(18, T, [OWNER])], [o(18, "Langfuse-Befunde (gesammelt)")], [o(20)], []]) {
      expect(Z.dublettenEntscheidung({ eigenNr: 20, titel: T, eigenKommentare: 0, andere }).art).toBe("keine");
    }
  });

  test("Verdrahtung: das Skript nutzt beide Funktionen, bestätigt per Direktabruf und prüft vor und nach der Positions-Schleife", () => {
    const skript = readFileSync(new URL("../scripts/sammelticket-anlegen.mjs", import.meta.url), "utf8");
    expect(skript).toMatch(/waehleBestaetigtes\(/);
    expect(skript).toMatch(/repos\/\$\{repo\}\/issues\/\$\{nr\}/);
    expect(skript.match(/schliesseWennDublette\(/g)?.length).toBeGreaterThanOrEqual(3); // Definition und zwei Aufrufe
    expect(skript).toMatch(/Dublette von #/);
    expect(skript).toMatch(/state_reason=not_planned/);
  });
});

describe("setzeUndPruefe: das Board kommt als Parameter (L24)", () => {
  type B = { id: string; number: number; status: string; title: string; assignees: string[]; state: string };
  type Io = { loadItems: (b: string) => B[]; setPosition: (b: string, id: string, after: string | null) => void; sleep: (ms: number) => Promise<void> };
  const S = (raw as unknown as { setzeUndPruefe: (a: { nr: number; position: number; dry?: boolean; board?: string; repo?: string }, io?: Partial<Io>) => Promise<string> }).setzeUndPruefe;
  const b = (number: number): B => ({ id: `I${number}`, number, status: "Todo", title: `T${number}`, assignees: [], state: "open" });
  const sammel = (): B => ({ ...b(20), title: "Harness-Härtung (gesammelt)" });
  const items = [b(1), b(2), b(3), b(4), b(5), b(6), sammel()];

  test("loadItems und setPosition bekommen genau das übergebene Board; nach dem Setzen steht es richtig", async () => {
    const geladen: string[] = [];
    const gesetzt: string[] = [];
    let stand = items;
    const io: Partial<Io> = {
      loadItems: (board) => {
        geladen.push(board);
        return stand;
      },
      setPosition: (board, id) => {
        gesetzt.push(`${board}:${id}`);
        stand = [b(1), sammel(), b(2), b(3), b(4), b(5), b(6)];
      },
      sleep: async () => {},
    };
    expect(await S({ nr: 20, position: 3, board: "FB", repo: "zz-org/zz-r" }, io)).toBe("ok");
    expect(gesetzt).toEqual(["FB:I20"]);
    expect(new Set(geladen)).toEqual(new Set(["FB"]));
  });

  test("ohne board wirft sie vor dem ersten Laden", async () => {
    let geladen = 0;
    await expect(S({ nr: 20, position: 3, repo: "zz-org/zz-r" }, { loadItems: () => (geladen++, items), sleep: async () => {} })).rejects.toThrow(/board fehlt/);
    expect(geladen).toBe(0);
  });
});

describe("sammelLabel, codequalitaetPlan und main (factory#156)", () => {
  const X = raw as unknown as {
    sammelLabel: (c: unknown, art: string) => string | null;
    codequalitaetPlan: (items: unknown[], nr: number) => { steps: { item: { number: number }; afterId: string | null }[] };
    main: (argv: string[], deps: object) => Promise<void>;
  };
  const mitCq = (l: unknown) => ({ ...FREMD, labels: { ...FREMD.labels, ...(l === undefined ? {} : { codequalitaet: l }) } });
  test("harness und langfuse tragen labels.harness, codequalitaet das eigene Label, fehlend oder leer ist null", () => {
    expect(X.sammelLabel(FREMD, "harness")).toBe(FREMD.labels.harness);
    expect(X.sammelLabel(FREMD, "langfuse")).toBe(FREMD.labels.harness);
    expect(X.sammelLabel(mitCq("area:code"), "codequalitaet")).toBe("area:code");
    expect(X.sammelLabel(FREMD, "codequalitaet")).toBeNull();
    expect(X.sammelLabel(mitCq(""), "codequalitaet")).toBeNull();
    expect(X.sammelLabel(mitCq("  "), "codequalitaet")).toBeNull();
  });
  test("Platzierung: hinter dem Kopf (Status-Ticket) und vor dem Rest, ohne Klemmung hinter andere Sammeltickets (factory#162), ohne Kopf an der Spitze", () => {
    const b = (number: number, title: string, extra: object = {}) => ({ id: `I${number}`, number, status: "Todo", title, assignees: [], state: "open", ...extra });
    const nachKopf = [b(1, "Langfuse-Status überprüfen"), b(2, "Ding"), b(3, "Codequalität (gesammelt)")];
    expect(X.codequalitaetPlan(nachKopf, 3).steps.map((s) => [s.item.number, s.afterId])).toEqual([[3, "I1"]]);
    const mitBlock = [b(1, "Langfuse-Status überprüfen"), b(4, "Harness-Härtung (gesammelt)"), b(2, "Ding"), b(3, "Codequalität (gesammelt)")];
    expect(X.codequalitaetPlan(mitBlock, 3).steps.map((s) => [s.item.number, s.afterId])).toEqual([[3, "I1"]]);
    const ohneKopf = [b(2, "Ding"), b(3, "Codequalität (gesammelt)")];
    expect(X.codequalitaetPlan(ohneKopf, 3).steps.map((s) => [s.item.number, s.afterId])).toEqual([[3, null]]);
  });
  test("Negativfall: ohne labels.codequalitaet wird nichts angelegt, kein Kontingent-, kein gh-Aufruf, kein Wurf", async () => {
    const log: string[] = [];
    await X.main(["codequalitaet"], { ladeConfig: () => FREMD, log: (z: string) => log.push(z), kontingent: () => { throw new Error("darf nicht laufen"); } });
    expect(log.join("\n")).toMatch(/labels\.codequalitaet .*nicht gesetzt.*nichts angelegt/);
    await X.main(["codequalitaet", "--dry-run"], { ladeConfig: () => mitCq(""), log: (z: string) => log.push(z), kontingent: () => { throw new Error("darf nicht laufen"); } });
    expect(log).toHaveLength(2);
  });
});

describe("sammelZiel (#76, ADR 0022 F10): das Sammelticket liegt im Repo, das das Factory-Board führt", () => {
  const S = (raw as unknown as { sammelZiel: (c: unknown) => { rolle: string; repo: string; owner: string } }).sammelZiel;
  const FABRIK = "zz-org/zz-fabrik";
  test("fremdes Factory-Board: Ziel-Repo und Owner kommen von dort, ohne Schlüssel gilt das eigene Repo", () => {
    const fremd = { ...FREMD, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo: FABRIK } : b)) };
    expect(S(fremd)).toEqual({ rolle: "factory", repo: FABRIK, owner: "zz-org" });
    expect(S(FREMD)).toEqual({ rolle: "factory", repo: FREMD.repo, owner: FREMD.repo.split("/")[0] });
  });
  test("factory#156: mit dem Codequalität-Label liegt das Ticket auf dem Produkt-Board des eigenen Repos, nie auf dem Factory-Board", () => {
    const S2 = (raw as unknown as { sammelZiel: (c: unknown, l: string) => { rolle: string; repo: string; owner: string } }).sammelZiel;
    const fremd = { ...FREMD, boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo: FABRIK } : b)) };
    expect(S2(fremd, "area:code")).toEqual({ rolle: "produkt", repo: FREMD.repo, owner: FREMD.repo.split("/")[0] });
  });
  test("setzeUndPruefe ohne repo wirft vor dem ersten Laden", async () => {
    const wirft = (raw as unknown as { setzeUndPruefe: (a: object, io: object) => Promise<string> }).setzeUndPruefe;
    let geladen = 0;
    await expect(wirft({ nr: 1, position: 3, board: "FB" }, { loadItems: () => (geladen++, []) })).rejects.toThrow(/repo fehlt/);
    expect(geladen).toBe(0);
  });
});

describe("legeAn (#76): Anlegen im Ziel-Repo, klare Fehler statt Rückfall", () => {
  const L = (raw as unknown as { legeAn: (a: { repo: string; titel: string; body: string; harness: string }, api: (args: string[]) => unknown) => { number: number } }).legeAn;
  const a = { repo: "zz-org/zz-ziel", titel: "T", body: "B", harness: "zz:harness" };
  test("legt per POST im Ziel-Repo mit dem Harness-Label an und gibt die Antwort zurück", () => {
    const aufrufe: string[][] = [];
    const r = L(a, (args) => (aufrufe.push(args), { number: 9, labels: [{ name: "zz:harness" }] }));
    expect(r.number).toBe(9);
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]).toContain("repos/zz-org/zz-ziel/issues");
    expect(aufrufe[0]).toContain("labels[]=zz:harness");
  });
  test("403: Meldung nennt das Ziel-Repo, genau ein POST, kein Rückfall", () => {
    let n = 0;
    expect(() => L(a, () => (n++, (() => { throw Object.assign(new Error("Command failed"), { stderr: "gh: HTTP 403" }); })()))).toThrow(/Anlegen in zz-org\/zz-ziel fehlgeschlagen: keine Schreibrechte auf zz-org\/zz-ziel/);
    expect(n).toBe(1);
  });
  test("anderer Fehler: Rohtext statt Rechte-Meldung", () => {
    expect(() => L(a, () => { throw new Error("Command failed\ngh: HTTP 500 kaputt"); })).toThrow(/Anlegen in zz-org\/zz-ziel fehlgeschlagen: .*HTTP 500/s);
  });
  test("Antwort ohne das Label: wirft mit Nummer, Label und Fix", () => {
    expect(() => L(a, () => ({ number: 9, labels: [] }))).toThrow(/#9 in zz-org\/zz-ziel angelegt, aber ohne Label zz:harness[\s\S]*Fix:/);
  });
});

describe("lesbarImZiel (#78 L14): ein nicht lesbares Ziel-Repo ist eine Meldung mit Exit 1, kein Stacktrace", () => {
  type Naht = { err: (t: string) => void; exit: (c: number) => never };
  const lies = (raw as unknown as { lesbarImZiel: (repo: string, fn: () => unknown, naht: Naht) => unknown }).lesbarImZiel;
  const naht = () => {
    const meldungen: string[] = [];
    const codes: number[] = [];
    return { meldungen, codes, naht: { err: (t: string) => void meldungen.push(t), exit: (c: number) => { codes.push(c); throw new Error("exit"); } } as Naht };
  };
  test("404: klare Lese-Meldung mit Ziel-Repo, Exit 1", () => {
    const n = naht();
    expect(() => lies("zz-org/ziel", () => { throw Object.assign(new Error("Command failed"), { stderr: "gh: Not Found (HTTP 404)" }); }, n.naht)).toThrow("exit");
    expect(n.codes).toEqual([1]);
    expect(n.meldungen.join("")).toMatch(/^✖ kein Lesezugriff auf zz-org\/ziel/);
    expect(n.meldungen.join("")).not.toMatch(/\n\s+at /);
  });
  test("anderer Fehler: Rohtext, ebenfalls Exit 1", () => {
    const n = naht();
    expect(() => lies("zz-org/ziel", () => { throw new Error("Command failed\ngh: HTTP 500 kaputt"); }, n.naht)).toThrow("exit");
    expect(n.meldungen.join("")).toMatch(/HTTP 500/);
    expect(n.meldungen.join("")).not.toMatch(/Lesezugriff/);
  });
  test("Gutfall: liefert das Ergebnis, keine Meldung", () => {
    const n = naht();
    expect(lies("zz-org/ziel", () => 42, n.naht)).toBe(42);
    expect(n.meldungen).toEqual([]);
  });
});

describe("Token und Lesezugriff im Ziel-Repo (#97 L7 b, L11 j, L12 a)", () => {
  const A = raw as unknown as {
    zielOpts: (repo: string, env?: Record<string, string>) => { token?: string };
    legeAn: (a: { repo: string; titel: string; body: string; harness: string }, api: (args: string[], o: { token?: string }) => unknown, env?: Record<string, string>) => unknown;
    einzelAbrufIn: (repo: string, gh: (args: string[], o: { token?: string }) => unknown, env?: Record<string, string>) => (nr: number) => unknown;
  };
  const EIGENES = (rawLib as unknown as { REPO: string }).REPO;
  const ENV = { PROJECT_TOKEN: "pt" };
  test("zielOpts: fremdes Ziel-Repo nutzt PROJECT_TOKEN, das eigene (auch anders geschrieben) den Standard", () => {
    expect(A.zielOpts("zz-org/ziel", ENV)).toEqual({ token: "pt" });
    expect(A.zielOpts(EIGENES, ENV)).toEqual({ token: undefined });
    expect(A.zielOpts(EIGENES.toUpperCase(), ENV)).toEqual({ token: undefined });
    expect(A.zielOpts("zz-org/ziel", {})).toEqual({ token: undefined });
  });
  test("legeAn und der Einzelabruf reichen den Token des Ziel-Repos an gh", () => {
    const opts: unknown[] = [];
    const gh = (_a: string[], o: unknown) => (opts.push(o), { number: 3, labels: [{ name: "x" }] });
    A.legeAn({ repo: "zz-org/ziel", titel: "t", body: "b", harness: "x" }, gh, ENV);
    A.legeAn({ repo: EIGENES, titel: "t", body: "b", harness: "x" }, gh, ENV);
    A.einzelAbrufIn("zz-org/ziel", gh, ENV)(3);
    A.einzelAbrufIn(EIGENES, gh, ENV)(3);
    expect(opts).toEqual([{ token: "pt" }, { token: undefined }, { token: "pt" }, { token: undefined }]);
  });
  describe("Lesen und Schließen im Ziel-Repo als Verhalten (#101 L5b, L5c, L6c; ersetzt den Quelltext-Test zu L12 a)", () => {
    type N = Record<string, unknown>;
    const Z = raw as unknown as {
      findeVorhandenes: (a: { repo: string; titel: string; vorgaenger: number | null; owner: string }, n: N) => { number: number } | null;
      schliesseWennDublette: (nr: number, titel: string, vorgaenger: number | null, ziel: { repo: string; owner: string }, n: N) => boolean;
      vorgaengerZustand: (nr: number, repo: string, n: N) => string;
    };
    const REPO_ZIEL = "zz-org/ziel";
    const TITEL = "Harness-Härtung (gesammelt)";
    const seite = (...nummern: number[]) => [nummern.map((number) => ({ number, title: TITEL, created_at: "2026-10-01T00:00:00Z", assignees: [] }))];
    const aufbau = (o: { seiten?: unknown; einzel?: (nr: number) => unknown } = {}) => {
      const gh: { args: string[]; opt: unknown }[] = [];
      const lade: { repo: string; opt: unknown }[] = [];
      const log: string[] = [];
      const err: string[] = [];
      const naht: N = {
        env: { PROJECT_TOKEN: "pt" },
        gh: (args: string[], opt: unknown) => {
          gh.push({ args, opt });
          const m = /issues[/](\d+)$/.exec(args[args.length - 1] ?? "");
          return m && args.length === 2 ? (o.einzel ?? ((nr: number) => ({ state: "open", assignees: [], user: ownerUser, comments: 0, number: nr })))(Number(m[1])) : {};
        },
        ladeSeiten: (repo: string, opt: unknown) => {
          lade.push({ repo, opt });
          if (o.seiten instanceof Error) throw o.seiten;
          return o.seiten ?? seite();
        },
        log: (t: string) => log.push(t),
        err: (t: string) => err.push(t),
        exit: (c: number) => { throw new Error(`exit ${c}`); },
      };
      return { naht, gh, lade, log, err };
    };
    const ziel = { repo: REPO_ZIEL, owner: OWNER };

    test("Dublette: das eigene Ticket wird kommentiert und geschlossen, im Ziel-Repo mit dem Projekt-Token; das Original bleibt", () => {
      const a = aufbau({ seiten: seite(5, 9) });
      expect(Z.schliesseWennDublette(9, TITEL, null, ziel, a.naht)).toBe(true);
      const schreib = a.gh.filter((g) => g.args.includes("-X")).map((g) => g.args.join(" "));
      expect(schreib).toEqual([
        `api -X POST repos/${REPO_ZIEL}/issues/9/comments -f body=Dublette von #5 (Wettlauf beim Anlegen)`,
        `api -X PATCH repos/${REPO_ZIEL}/issues/9 -f state=closed -f state_reason=not_planned`,
      ]);
      expect(a.gh.every((g) => JSON.stringify(g.opt) === JSON.stringify({ token: "pt" }))).toBe(true);
      expect(a.lade).toEqual([{ repo: REPO_ZIEL, opt: { token: "pt" } }]);
      expect(a.log.join("\n")).toContain("#9 geschlossen");
    });
    test("keine Dublette (nur das eigene Ticket offen): nichts geschrieben, false", () => {
      const a = aufbau({ seiten: seite(9) });
      expect(Z.schliesseWennDublette(9, TITEL, null, ziel, a.naht)).toBe(false);
      expect(a.gh.some((g) => g.args.includes("-X"))).toBe(false);
    });
    test("Dublette, aber das eigene Ticket hat schon Kommentare: Warnung, nicht geschlossen", () => {
      const a = aufbau({ seiten: seite(5, 9), einzel: (nr) => ({ state: "open", assignees: [], user: ownerUser, comments: nr === 9 ? 2 : 0 }) });
      expect(Z.schliesseWennDublette(9, TITEL, null, ziel, a.naht)).toBe(false);
      expect(a.log.join("\n")).toContain("::warning::#9 ist eine Dublette von #5");
      expect(a.gh.some((g) => g.args.includes("-X"))).toBe(false);
    });
    test("das eigene Repo liest und schreibt mit dem Standard-Token (kein PROJECT_TOKEN)", () => {
      const a = aufbau({ seiten: seite(5, 9) });
      const eigen = (rawLib as unknown as { REPO: string }).REPO;
      Z.schliesseWennDublette(9, TITEL, null, { repo: eigen, owner: OWNER }, a.naht);
      expect(a.gh.length).toBeGreaterThan(0);
      expect(a.gh.every((g) => (g.opt as { token?: string }).token === undefined)).toBe(true);
      expect(a.lade.every((l) => (l.opt as { token?: string }).token === undefined)).toBe(true);
    });
    test("Ziel nicht lesbar (Dubletten-Check): ✖-Meldung, Exit 1, kein Stacktrace, nichts geschrieben", () => {
      const a = aufbau({ seiten: Object.assign(new Error("Command failed"), { stderr: "gh: Not Found (HTTP 404)" }) });
      expect(() => Z.schliesseWennDublette(9, TITEL, null, ziel, a.naht)).toThrow("exit 1");
      expect(a.err.join("")).toMatch(/^✖ kein Lesezugriff auf zz-org\/ziel/);
      expect(a.err.join("")).not.toMatch(/\n\s+at /);
      expect(a.gh).toEqual([]);
    });
    test("findeVorhandenes: bestätigtes Ticket (Direktabruf) kommt zurück, mit Ziel-Token; ein unlesbares Ziel endet mit Exit 1 und Meldung", () => {
      const a = aufbau({ seiten: seite(5, 7) });
      expect(Z.findeVorhandenes({ repo: REPO_ZIEL, titel: TITEL, vorgaenger: null, owner: OWNER }, a.naht)).toMatchObject({ number: 7 });
      expect(a.lade).toEqual([{ repo: REPO_ZIEL, opt: { token: "pt" } }]);
      const b = aufbau({ seiten: Object.assign(new Error("Command failed"), { stderr: "gh: Not Found (HTTP 404)" }) });
      expect(() => Z.findeVorhandenes({ repo: REPO_ZIEL, titel: TITEL, vorgaenger: null, owner: OWNER }, b.naht)).toThrow("exit 1");
      expect(b.err.join("")).toMatch(/^✖ kein Lesezugriff auf zz-org\/ziel/);
    });
    test("vorgaengerZustand liest mit dem Token des Ziel-Repos; Fehler ergibt unbekannt", () => {
      const a = aufbau({ einzel: () => ({ state: "open", assignees: [{ login: OWNER }] }) });
      expect(Z.vorgaengerZustand(12, REPO_ZIEL, a.naht)).toBe("in-arbeit");
      expect(a.gh).toEqual([{ args: ["api", `repos/${REPO_ZIEL}/issues/12`], opt: { token: "pt" } }]);
      expect(Z.vorgaengerZustand(12, REPO_ZIEL, { ...a.naht, gh: () => { throw new Error("404"); } })).toBe("unbekannt");
    });
  });
});

describe("main mit injizierten gh-/Board-Nähten (factory#189 L7): Verzweigung je Art als Verhalten", () => {
  type Ruf = [string, ...unknown[]];
  const M = (raw as unknown as { main: (argv: string[], deps: object) => Promise<void> }).main;
  const BOARD = (rawLib as unknown as { boardFuerRolle: (r: string) => unknown }).boardFuerRolle;
  const FABRIK = "zz-org/zz-fabrik";
  const cfg = { ...FREMD, boards: FREMD.boards.map((b: { rolle: string }) => (b.rolle === "factory" ? { ...b, repo: FABRIK } : b)), labels: { ...FREMD.labels, codequalitaet: "area:code" } };
  const it = (n: number, title = `T${n}`) => ({ id: `I${n}`, number: n, status: "Todo", title, assignees: [], state: "open" });
  const listeVoll = () => [it(1, "Langfuse-Status überprüfen"), it(2), it(3), it(4), it(5), it(6), it(7), it(8), it(9)];
  const fakes = (extra: object = {}) => {
    const rufe: Ruf[] = [];
    const log: string[] = [];
    const deps = {
      ladeConfig: () => cfg,
      log: (z: string) => log.push(z),
      kontingent: () => {},
      sleep: async () => {},
      findeVorhandenes: (a: unknown) => (rufe.push(["findeVorhandenes", a]), null),
      vorgaengerZustand: () => "zu",
      legeAn: (a: unknown) => (rufe.push(["legeAn", a]), { number: 50, node_id: "N50" }),
      schliesseWennDublette: () => false,
      addToBoardTodo: (...a: unknown[]) => (rufe.push(["addToBoardTodo", ...a]), "I50"),
      loadItems: (...a: unknown[]) => (rufe.push(["loadItems", ...a]), listeVoll()),
      setPosition: (...a: unknown[]) => rufe.push(["setPosition", ...a]),
      setzeUndPruefe: (a: unknown) => (rufe.push(["setzeUndPruefe", a]), Promise.resolve("ok")),
      verknuepfeBlocker: () => {},
      ...extra,
    };
    return { deps, rufe, log };
  };
  const namen = (rufe: Ruf[]) => rufe.map((r) => r[0]);
  const schreibend = ["legeAn", "addToBoardTodo", "setPosition", "setzeUndPruefe"];

  test("harness: legt mit dem Harness-Label im Factory-Repo an, hängt es ans Factory-Board und prüft die Position dort", async () => {
    const { deps, rufe } = fakes();
    await M(["harness"], deps);
    const anlegen = rufe.find((r) => r[0] === "legeAn")![1] as { repo: string; titel: string; harness: string };
    expect(anlegen).toMatchObject({ repo: FABRIK, titel: "Harness-Härtung (gesammelt)", harness: cfg.labels.harness });
    const board = BOARD("factory");
    expect(rufe.find((r) => r[0] === "addToBoardTodo")!.slice(1)).toEqual([board, "N50", { repo: FABRIK }]);
    const pruef = rufe.find((r) => r[0] === "setzeUndPruefe")![1] as { nr: number; board: unknown; repo: string; dry: boolean };
    expect(pruef).toMatchObject({ nr: 50, repo: FABRIK, dry: false });
    expect(pruef.board).toEqual(board);
  });

  describe("im Bezieher (factory#202 L20, ADR 0031)", () => {
    const mitExit = async (art: string[], bezieher: boolean) => {
      const exit = vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit ${c}`); }) as never);
      const fehler = vi.spyOn(console, "error").mockImplementation(() => undefined);
      try {
        const { deps, rufe } = fakes({ bezieher });
        const ergebnis = await M(art, deps).then(() => "ok", (e: Error) => e.message);
        return { ergebnis, rufe, fehler: fehler.mock.calls.map((a) => String(a[0])).join("\n") };
      } finally {
        exit.mockRestore();
        fehler.mockRestore();
      }
    };
    test("harness bricht mit Exit 2 und Fix-Zeile ab, nichts wird angelegt", async () => {
      const { ergebnis, rufe, fehler } = await mitExit(["harness"], true);
      expect(ergebnis).toBe("exit 2");
      expect(fehler).toContain("Kern-Befunde per `node scripts/melden.mjs` an die Meldestelle melden");
      expect(namen(rufe)).not.toContain("legeAn");
    });
    test("harness in der Fabrik (kein Bezieher) läuft wie bisher", async () => {
      const { ergebnis, rufe } = await mitExit(["harness"], false);
      expect(ergebnis).toBe("ok");
      expect(namen(rufe)).toContain("legeAn");
    });
    test("langfuse bleibt im Bezieher erlaubt", async () => {
      const { ergebnis } = await mitExit(["langfuse"], true);
      expect(ergebnis).toBe("ok");
    });
  });

  test("harness: steht das neue Ticket falsch (hinten), setzt main es per setPosition auf das Factory-Board um", async () => {
    const { deps, rufe } = fakes();
    await M(["harness"], deps);
    const set = rufe.filter((r) => r[0] === "setPosition");
    expect(set).toHaveLength(1);
    expect(set[0][1]).toEqual(BOARD("factory"));
    expect(set[0][2]).toBe("I50");
  });

  describe("harness: Meldung je Stand der Positionsprüfung", () => {
    const stand = (s: string) => ({ setzeUndPruefe: () => Promise.resolve(s) });
    test("ok: meldet die geprüfte Position, kein Exit", async () => {
      const { deps, log } = fakes(stand("ok"));
      await M(["harness"], deps);
      expect(log.join("\n")).toMatch(/Position geprüft: #50/);
    });
    test("unbekannt: Warnung, die Position sei noch nicht prüfbar, kein Exit", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      try {
        const { deps, log } = fakes(stand("unbekannt"));
        await M(["harness"], deps);
        expect(log.join("\n")).toMatch(/::warning::#50 steht noch nicht in der Board-Liste/);
        expect(exit).not.toHaveBeenCalled();
      } finally {
        exit.mockRestore();
      }
    });
    test("falsch im Trockenlauf: Trockenlauf-Meldung, kein Exit", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      try {
        const { deps, log } = fakes({ ...stand("falsch"), findeVorhandenes: () => ({ number: 50 }) });
        await M(["harness", "--dry-run"], deps);
        expect(log.join("\n")).toMatch(/Trockenlauf: #50 steht nicht auf Position/);
        expect(exit).not.toHaveBeenCalled();
      } finally {
        exit.mockRestore();
      }
    });
    test("falsch im echten Lauf: Fehlermeldung und Exit 1", async () => {
      const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
      const err = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const { deps, log } = fakes(stand("falsch"));
        await M(["harness"], deps);
        expect(exit).toHaveBeenCalledWith(1);
        expect(err.mock.calls.join("\n")).toMatch(/#50 steht nach dem Setzen nicht auf Position/);
        expect(log.join("\n")).not.toMatch(/Trockenlauf|Position geprüft/);
      } finally {
        exit.mockRestore();
        err.mockRestore();
      }
    });
  });

  test("langfuse ohne --top: angelegt und ans Board gehängt, aber keine Positionsarbeit", async () => {
    const { deps, rufe } = fakes();
    await M(["langfuse"], deps);
    expect(namen(rufe)).toEqual(["findeVorhandenes", "legeAn", "addToBoardTodo"]);
    expect((rufe[1][1] as { harness: string; titel: string }).harness).toBe(cfg.labels.harness);
  });

  test("langfuse --top: setzt an die Spitze (setPosition auf dem Factory-Board), ohne setzeUndPruefe", async () => {
    const { deps, rufe } = fakes();
    await M(["langfuse", "--top"], deps);
    const set = rufe.filter((r) => r[0] === "setPosition");
    expect(set.length).toBeGreaterThan(0);
    expect(set.every((r) => JSON.stringify(r[1]) === JSON.stringify(BOARD("factory")))).toBe(true);
    expect(set.some((r) => r[2] === "I50")).toBe(true);
    expect(set.find((r) => r[2] === "I50")?.[3]).toBeNull(); // Spitze: afterId null, nicht hinter einem Item
    expect(namen(rufe)).not.toContain("setzeUndPruefe");
  });

  test("codequalitaet: Label aus labels.codequalitaet, Produkt-Board im eigenen Repo, immer hinter den Kopf gesetzt", async () => {
    const { deps, rufe } = fakes();
    await M(["codequalitaet"], deps);
    expect(rufe.find((r) => r[0] === "legeAn")![1]).toMatchObject({ repo: cfg.repo, titel: "Codequalität (gesammelt)", harness: "area:code" });
    const board = BOARD("produkt");
    expect(rufe.find((r) => r[0] === "addToBoardTodo")![1]).toEqual(board);
    const set = rufe.filter((r) => r[0] === "setPosition");
    expect(set).toHaveLength(1);
    expect(set[0].slice(1)).toEqual([board, "I50", "I1"]);
    expect(namen(rufe)).not.toContain("setzeUndPruefe");
  });

  test("schon vorhanden: nichts angelegt, nichts gesetzt; harness prüft nur die Position des vorhandenen Tickets", async () => {
    const { deps, rufe, log } = fakes({ findeVorhandenes: () => ({ number: 33 }) });
    await M(["langfuse"], deps);
    expect(log.join(" | ")).toMatch(/gibt es schon: #33, nichts wird angelegt/);
    expect(namen(rufe)).toEqual([]);
    const h = fakes({ findeVorhandenes: () => ({ number: 33 }) });
    await M(["harness"], h.deps);
    expect(h.rufe.filter((r) => schreibend.includes(r[0])).map((r) => r[0])).toEqual(["setzeUndPruefe"]);
    expect((h.rufe[0][1] as { nr: number }).nr).toBe(33);
  });

  test("--dry-run: kein Schreibaufruf, nur die Ankündigung", async () => {
    const { deps, rufe } = fakes();
    for (const art of ["harness", "langfuse", "codequalitaet"]) await M([art, "--dry-run"], deps);
    expect(rufe.filter((r) => schreibend.includes(r[0]))).toEqual([]);
  });

  test("Dublette nach dem Anlegen: kein Board-Aufruf mehr", async () => {
    const { deps, rufe } = fakes({ schliesseWennDublette: () => true });
    await M(["harness"], deps);
    expect(namen(rufe)).toEqual(["findeVorhandenes", "legeAn"]);
  });

  test("langfuse --top: nur das neue Ticket wird bewegt (an die Spitze, ohne ein anderes Item umzuschieben)", async () => {
    const items = [...listeVoll(), it(20, "Harness-Härtung (gesammelt)")];
    const { deps, rufe } = fakes({ loadItems: () => items });
    await M(["langfuse", "--top"], deps);
    const set = rufe.filter((r) => r[0] === "setPosition");
    expect(set.length).toBeGreaterThan(0);
    expect(set.every((r) => r[2] === "I50")).toBe(true);
  });

  test("harness: ein Dubletten-Fund erst im zweiten Check (nach der Positions-Prüfung) beendet ohne Positionsmeldung; bei schon vorhandenem Ticket läuft er nicht", async () => {
    let n = 0;
    const zweiter = fakes({ schliesseWennDublette: () => ++n === 2 });
    await M(["harness"], zweiter.deps);
    expect(n).toBe(2);
    expect(zweiter.log.join(" | ")).not.toMatch(/Position geprüft/);
    const ok = fakes();
    await M(["harness"], ok.deps);
    expect(ok.log.join(" | ")).toMatch(/Position geprüft: #50/);
    let m = 0;
    const vorh = fakes({ findeVorhandenes: () => ({ number: 33 }), schliesseWennDublette: () => (m++, true) });
    await M(["harness"], vorh.deps);
    expect(m).toBe(0);
  });

  test("Vorgänger: vorgaengerZustand wird mit Vorgänger und Ziel-Repo gefragt, offen landet die Blocker-Zeile im Body", async () => {
    const gefragt: unknown[][] = [];
    const { deps, rufe, log } = fakes({ vorgaengerZustand: (...a: unknown[]) => (gefragt.push(a), "offen") });
    await M(["harness", "--vorgaenger", "7"], deps);
    expect(gefragt).toEqual([[7, FABRIK]]);
    expect(log.filter((z) => z.includes("native Abhängigkeit nicht gesetzt"))).toEqual([]);
    expect((rufe.find((r) => r[0] === "legeAn")![1] as { body: string }).body).toMatch(/#7/);
  });

  describe("native Abhängigkeit zum Vorgänger (factory#202 L1)", () => {
    const mitVerknuepfung = (zustand: string, extra: object = {}) => {
      const kanten: unknown[] = [];
      const f = fakes({ vorgaengerZustand: () => zustand, verknuepfeBlocker: (a: unknown) => kanten.push(a), ...extra });
      return { ...f, kanten };
    };
    test("offener Vorgänger: eine Kante neues Ticket ← Vorgänger im Ziel-Repo", async () => {
      const { deps, kanten } = mitVerknuepfung("offen");
      await M(["harness", "--vorgaenger", "7"], deps);
      expect(kanten).toEqual([{ issueNodeId: "N50", blocker: { repo: FABRIK, nummer: 7 }, repo: FABRIK }]);
    });
    test("geschlossener Vorgänger und ohne --vorgaenger: keine Kante", async () => {
      const zu = mitVerknuepfung("zu");
      await M(["harness", "--vorgaenger", "7"], zu.deps);
      const ohne = mitVerknuepfung("offen");
      await M(["harness"], ohne.deps);
      expect([zu.kanten, ohne.kanten]).toEqual([[], []]);
    });
    test("Scheitern der Kante ist eine Warnung, kein Abbruch (Position wird noch geprüft)", async () => {
      const { deps, log, rufe } = mitVerknuepfung("offen", { verknuepfeBlocker: () => { throw new Error("403 forbidden"); } });
      await M(["harness", "--vorgaenger", "7"], deps);
      expect(log.join("\n")).toMatch(/native Abhängigkeit nicht gesetzt.*403 forbidden/);
      expect(namen(rufe)).toContain("setzeUndPruefe");
    });
  });
});
