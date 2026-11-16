/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- untypisiertes JSON und .mjs-Module */
/* Auslöser der Token-Analyse (factory#578): Erkennung, Dedupe, Monatstakt, Einstieg über Nähte. Nur Fixtures, kein Netz, kein echter Lauf. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libModul from "../scripts/token-analyse-ausloesen-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliModul from "../scripts/token-analyse-ausloesen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as wvModul from "../scripts/wiedervorlage.mjs";

type Z = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const lib = libModul as unknown as {
  MARKER: string;
  BODY_MARKER: string;
  ANLAESSE: string[];
  istAnalyseTicket: (i: Z) => boolean;
  anstehenderTakt: (e: Z[]) => Z | null;
  markerFuer: (id: string) => string;
  istDatum: (s: string) => boolean;
  taktEintrag: (faellig: string) => Z;
  plusEinMonat: (h: string) => string;
  fortschreiben: (e: Z[], h: string) => Z[];
  planeAusloesung: (o: Z) => Z;
};
const cli = cliModul as unknown as {
  parseArgs: (a: string[]) => Z;
  main: (a: string[], d: Z) => number;
};
const wv = wvModul as unknown as {
  planeAktionen: (o: Z) => Z[];
  faellige: (o: Z) => Z[];
  pruefeEintraege: (l: Z[]) => string[];
  markerFuer: (id: string) => string;
  istDatum: (s: string) => boolean;
};

const TAKT = { id: "token-analyse-2026-12", art: "analyse-takt", faellig: "2026-12-15", titel: "t", text: "x" };
const heute = "2026-12-15";

describe("istAnalyseTicket", () => {
  it("Titelmarker zählt", () => expect(lib.istAnalyseTicket({ title: "💸 Token-Analyse 2026-12-15 (Anlass: manuell)", body: "" })).toBe(true));
  it("Body-Marker als eigene Zeile zählt", () => expect(lib.istAnalyseTicket({ title: "x", body: `${lib.BODY_MARKER}\n\ntext` })).toBe(true));
  it("Marker in Backticks im Fließtext zählt nicht (Negativfall)", () => {
    expect(lib.istAnalyseTicket({ title: "Token-Analyse 8/9: Auslöser (factory#518)", body: "der Titelmarker `💸 Token-Analyse` und `<!-- token-analyse -->` im Text" })).toBe(false);
  });
  it("ohne Daten false", () => expect(lib.istAnalyseTicket({})).toBe(false));
});

describe("planeAusloesung", () => {
  it("ohne offenes Analyse-Ticket: anlegen mit Marker im Titel, Body-Marker und Wiedervorlage-Marker", () => {
    const p = lib.planeAusloesung({ offene: [{ number: 1, title: "anderes", body: "" }], anlass: "manuell", heute, eintraege: [TAKT] });
    expect(p.art).toBe("anlegen");
    expect(p.titel.startsWith(lib.MARKER)).toBe(true);
    expect(p.titel).toContain("manuell");
    expect(p.body).toContain(`\n${lib.BODY_MARKER}\n`.trim());
    expect(p.body.split("\n")[0]).toBe(lib.BODY_MARKER);
    expect(p.body).toContain("<!-- wiedervorlage:token-analyse-2026-12 -->");
    expect(p.hinweis).toBeUndefined();
  });
  it("ohne Takt-Eintrag: anlegen ohne Wiedervorlage-Marker, mit Hinweis", () => {
    const p = lib.planeAusloesung({ offene: [], anlass: "kosten", heute, eintraege: [] });
    expect(p.art).toBe("anlegen");
    expect(p.body).not.toContain("wiedervorlage:");
    expect(p.hinweis).toContain("Monatseintrag");
  });
  it("Grund (factory#516) steht im Body", () => {
    const p = lib.planeAusloesung({ offene: [], anlass: "kosten", heute, eintraege: [TAKT], grund: "#516, 12 USD" });
    expect(p.body).toContain("#516, 12 USD");
  });
  it("offenes Ticket: kommentieren statt anlegen (Negativfall: kein zweites Ticket)", () => {
    const p = lib.planeAusloesung({ offene: [{ number: 7, title: "💸 Token-Analyse 2026-12-01 (Anlass: manuell)", body: "" }], anlass: "monatlich", heute, eintraege: [TAKT] });
    expect(p.art).toBe("kommentieren");
    expect(p.nummer).toBe(7);
    expect(p.titelNeu).toBeNull();
    expect(p.kommentar).toContain("monatlich");
  });
  it("Body-Marker ohne Titelmarker: der Marker kommt in den Titel", () => {
    const p = lib.planeAusloesung({ offene: [{ number: 9, title: "Analyse jetzt", body: `${lib.BODY_MARKER}\nx` }], anlass: "manuell", heute, eintraege: [] });
    expect(p.art).toBe("kommentieren");
    expect(p.titelNeu).toBe("💸 Token-Analyse: Analyse jetzt");
  });
  it("mehrere Treffer: das älteste bekommt den Kommentar, die übrigen stehen darin", () => {
    const p = lib.planeAusloesung({
      offene: [
        { number: 30, title: "💸 Token-Analyse b", body: "" },
        { number: 12, title: "💸 Token-Analyse a", body: "" },
      ],
      anlass: "manuell",
      heute,
      eintraege: [],
    });
    expect(p.nummer).toBe(12);
    expect(p.kommentar).toContain("#30");
  });
  it("unbekannter Anlass wirft", () => {
    expect(() => lib.planeAusloesung({ offene: [], anlass: "x", heute, eintraege: [] })).toThrow(/unbekannter Anlass/);
  });
  it("ein fälliger Monatseintrag bei offenem manuellem Ticket lässt wiedervorlage.mjs nichts anlegen", () => {
    const neu = lib.planeAusloesung({ offene: [], anlass: "manuell", heute, eintraege: [TAKT] });
    const tickets = [{ number: 5, state: "open", body: neu.body, closedAt: null }];
    expect(wv.planeAktionen({ faellige: wv.faellige({ eintraege: [TAKT], heute }), tickets })).toEqual([]);
  });
  it("das Wiedervorlage-Ticket selbst gilt als Analyse-Ticket (Titel trägt den Marker)", () => {
    const e = lib.taktEintrag("2026-12-15");
    expect(lib.istAnalyseTicket({ title: `⏰ Wiedervorlage: ${e.titel}`, body: "" })).toBe(true);
  });
});

describe("Gleichlauf mit wiedervorlage.mjs", () => {
  it("Marker und Datumsprüfung stimmen überein", () => {
    expect(lib.markerFuer("token-analyse-2026-12")).toBe(wv.markerFuer("token-analyse-2026-12"));
    for (const d of ["2026-12-15", "2026-02-30", "2026-13-01", "x"]) expect(lib.istDatum(d), d).toBe(wv.istDatum(d));
  });
});

describe("Monatstakt", () => {
  it("anstehenderTakt nimmt den frühesten Takt-Eintrag und ignoriert fremde", () => {
    const e = [{ id: "token-analyse-budget-576", art: "frist" }, { ...TAKT, id: "token-analyse-2027-01" }, TAKT];
    expect(lib.anstehenderTakt(e)?.id).toBe("token-analyse-2026-12");
    expect(lib.anstehenderTakt([{ id: "token-analyse-budget-576", art: "analyse-takt" }])).toBeNull();
  });
  it("plusEinMonat kürzt auf Monatsende und wechselt das Jahr", () => {
    expect(lib.plusEinMonat("2026-12-15")).toBe("2027-01-15");
    expect(lib.plusEinMonat("2027-01-31")).toBe("2027-02-28");
    expect(lib.plusEinMonat("2027-12-31")).toBe("2028-01-31");
    expect(lib.plusEinMonat("2027-01-30")).toBe("2027-02-28");
    expect(lib.plusEinMonat("2028-01-31")).toBe("2028-02-29");
  });
  it("fortschreiben löscht den alten Takt, schreibt den nächsten und lässt Fremdes stehen", () => {
    const fremd = { id: "token-analyse-budget-576", art: "frist", faellig: "2026-12-20", titel: "t", text: "x" };
    const neu = lib.fortschreiben([fremd, TAKT], "2026-12-15");
    expect(neu.map((e) => e.id)).toEqual(["token-analyse-budget-576", "token-analyse-2027-01"]);
    expect(neu[1].faellig).toBe("2027-01-15");
    expect(neu[1].art).toBe("analyse-takt");
    expect(wv.pruefeEintraege(neu)).toEqual([]);
  });
  it("fortschreiben ohne Takt-Eintrag legt den nächsten an", () => {
    expect(lib.fortschreiben([], "2026-12-31").map((e) => e.id)).toEqual(["token-analyse-2027-01"]);
  });
  it("der echte Eintrag in .github/wiedervorlagen.json ist die Form von taktEintrag", () => {
    const liste = JSON.parse(readFileSync(new URL("../.github/wiedervorlagen.json", import.meta.url), "utf8")) as Z[];
    const takt = lib.anstehenderTakt(liste);
    expect(takt).not.toBeNull();
    expect(takt).toEqual(lib.taktEintrag(takt!.faellig));
  });
});

describe("parseArgs", () => {
  it("fehlender und unbekannter Anlass", () => {
    expect(cli.parseArgs([]).fehler).toContain("--anlass");
    expect(cli.parseArgs(["--anlass", "x"]).fehler).toContain("unbekannter Anlass");
  });
  it("gültige Aufrufe", () => {
    expect(cli.parseArgs(["--anlass", "kosten", "--grund", "g", "--dry-run"])).toEqual({ modus: "ausloesen", anlass: "kosten", grund: "g", trocken: true });
    expect(cli.parseArgs(["--fortschreiben", "--heute", "2026-12-15"])).toEqual({ modus: "fortschreiben", heute: "2026-12-15" });
  });
  it("Mischformen und ungültiges Datum", () => {
    expect(cli.parseArgs(["--fortschreiben", "--anlass", "manuell"]).fehler).toBeTruthy();
    expect(cli.parseArgs(["--fortschreiben", "--heute", "2026-13-01"]).fehler).toContain("Datum");
    expect(cli.parseArgs(["--anlass", "manuell", "--heute", "2026-12-15"]).fehler).toContain("--fortschreiben");
    expect(cli.parseArgs(["--anlass", "manuell", "--bogus"]).fehler).toBeTruthy();
  });
});

/** Nähte: protokolliert gh-Aufrufe; `offene` ist der Stand der Issues. */
function naehte(offene: Z[], takt: Z[] = [TAKT]) {
  const aufrufe: string[][] = [];
  const platziert: number[] = [];
  let gespeichert: Z[] | null = null;
  const log: string[] = [];
  const err: string[] = [];
  return {
    aufrufe,
    platziert,
    log,
    err,
    gespeichert: () => gespeichert,
    deps: {
      gh: {
        offene: () => offene,
        text: (a: string[]) => {
          aufrufe.push(a);
          return a[1] === "create" ? "https://github.com/x/y/issues/77\n" : "";
        },
        platziere: (nr: number) => platziert.push(nr),
        label: () => "area:harness",
        lies: () => takt,
        schreibe: (l: Z[]) => (gespeichert = l),
      },
      heute,
      bezieher: false,
      log: (t: string) => log.push(t),
      err: (t: string) => err.push(t),
    },
  };
}

describe("Einstieg über Nähte", () => {
  it("Bezieher: Abbruch mit Exit 4 vor jeder Argumentprüfung und ohne gh", () => {
    const n = naehte([]);
    expect(cli.main([], { ...n.deps, bezieher: true })).toBe(4);
    expect(n.err.join("\n")).toContain("fabrik-eigen");
    expect(n.aufrufe).toEqual([]);
  });
  it("Aufruffehler: Exit 2", () => {
    const n = naehte([]);
    expect(cli.main([], n.deps)).toBe(2);
    expect(cli.main(["--anlass", "x"], n.deps)).toBe(2);
    expect(n.aufrufe).toEqual([]);
  });
  it("ohne offenes Ticket: legt an (mit Label), sortiert oben ein", () => {
    const n = naehte([]);
    expect(cli.main(["--anlass", "manuell"], n.deps)).toBe(0);
    expect(n.aufrufe).toHaveLength(1);
    expect(n.aufrufe[0].slice(0, 2)).toEqual(["issue", "create"]);
    expect(n.aufrufe[0]).toContain("area:harness");
    expect(n.platziert).toEqual([77]);
  });
  it("zweite Auslösung bei offenem Ticket: nur Kommentar, nie create (Negativfall 1)", () => {
    const n = naehte([{ number: 77, title: "💸 Token-Analyse 2026-12-15 (Anlass: manuell)", body: "" }]);
    expect(cli.main(["--anlass", "kosten", "--grund", "#516"], n.deps)).toBe(0);
    expect(n.aufrufe.map((a) => a.slice(0, 2).join(" "))).toEqual(["issue comment"]);
    expect(n.aufrufe[0].join(" ")).toContain("kosten");
    expect(n.platziert).toEqual([]);
  });
  it("offenes Ticket ohne Titelmarker: erst Titel setzen, dann kommentieren", () => {
    const n = naehte([{ number: 9, title: "Analyse jetzt", body: "<!-- token-analyse -->" }]);
    expect(cli.main(["--anlass", "manuell"], n.deps)).toBe(0);
    expect(n.aufrufe.map((a) => a.slice(0, 2).join(" "))).toEqual(["issue edit", "issue comment"]);
    expect(n.aufrufe[0]).toContain("💸 Token-Analyse: Analyse jetzt");
  });
  it("--dry-run schreibt nichts", () => {
    const a = naehte([]);
    expect(cli.main(["--anlass", "manuell", "--dry-run"], a.deps)).toBe(0);
    const b = naehte([{ number: 9, title: "Analyse jetzt", body: "<!-- token-analyse -->" }]);
    expect(cli.main(["--anlass", "manuell", "--dry-run"], b.deps)).toBe(0);
    expect([...a.aufrufe, ...b.aufrufe]).toEqual([]);
    expect(a.log.join("\n")).toContain("dry-run");
    expect(b.log.join("\n")).toContain("Titel");
  });
  it("Board-Platzierung scheitert: Exit 1, Ticket bleibt (Nummer in der Meldung)", () => {
    const n = naehte([]);
    n.deps.gh.platziere = () => {
      throw new Error("kein Token");
    };
    expect(cli.main(["--anlass", "manuell"], n.deps)).toBe(1);
    expect(n.err.join("\n")).toContain("#77");
  });
  it("gh-Fehler: Exit 1 statt Absturz", () => {
    const n = naehte([]);
    n.deps.gh.offene = () => {
      throw new Error("gh kaputt");
    };
    expect(cli.main(["--anlass", "manuell"], n.deps)).toBe(1);
    expect(n.err.join("\n")).toContain("gh kaputt");
  });
  it("--fortschreiben speichert die Liste mit dem nächsten Monat", () => {
    const n = naehte([]);
    expect(cli.main(["--fortschreiben"], n.deps)).toBe(0);
    expect(n.gespeichert()?.map((e) => e.id)).toEqual(["token-analyse-2027-01"]);
    expect(n.aufrufe).toEqual([]);
  });
});
