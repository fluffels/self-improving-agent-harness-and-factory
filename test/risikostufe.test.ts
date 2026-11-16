/* Risikostufe 0/1/2 (factory#525): Logik aus scripts/risikostufe-lib.mjs und scripts/risikostufe.mjs importiert; die Listen werden injiziert (nicht die echte protected-paths.json),
 * nur die feste Basis-Datei wird real geladen (Selbstschutz). Ende-zu-Ende gegen ein echtes git-Repo im Temp-Ordner. */
import { afterEach, describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/risikostufe-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../scripts/risikostufe.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gsRaw from "../scripts/groessenstufe-lib.mjs";

type Eintrag = { pfad: string | null; zeilen?: number | null };
type Treffer = { pfad: string; muster: string; liste: string };
type Ergebnis = { stufe: 0 | 1 | 2; gruende: string[]; treffer: Treffer[]; pfade: string[] };
type Lader = { ladeBasis?: () => unknown; ladeText?: () => string; ladeRisiko?: () => unknown; ladeRisikoBasis?: () => unknown };
const lib = libRaw as unknown as {
  ladeStufe2Basis: (q?: string) => { kategorien: Record<string, string[]>; muster: string[] };
  stufe2Leitplanken: (t: string) => { gruppe: string; muster: string[] } | null;
  alleLeitplanken: (t: string) => string[] | null;
  bestimmeRisikostufe: (o: { eintraege: Eintrag[] | null; basis: unknown; leitplanken: unknown; risiko: unknown; prognose?: boolean }) => Ergebnis;
  pfadeAusTicket: (b: string, name?: string) => { pfade: string[]; fehler: string | null };
  risikostufeAusGit: (git: (a: string[]) => string, base: string, head?: string, o?: Lader & { zweiPunkt?: boolean }) => Ergebnis;
  risikostufeAusPfaden: (p: string[], o?: Lader) => Ergebnis;
  wirksameListe: (o?: Lader) => { zeilen: { muster: string; quelle: string }[]; fehler: string[] };
};
type Io = Lader & { git?: (a: string[]) => string; env?: Record<string, string>; ghJson?: (a: string[]) => unknown; ladeConfig?: () => unknown };
const cli = cliRaw as unknown as {
  laufe: (argv: string[], io?: Io) => { code: number; ausgabe: string };
  stufeZeile: (e: { stufe: number; gruende: string[] }) => string;
  sweepZeile: (e: object) => string;
  kombiZeile: (e: object) => string;
};
const gs = gsRaw as unknown as { risikoMusterAus: (c: unknown) => unknown };

const BASIS = lib.ladeStufe2Basis();
const LP_TEXT = JSON.stringify({ gate: ["/scripts/check-*.mjs", "/eslint.config.js"], harness: ["AGENTS.md", "/.claude/", "/.agents/", "/docs/agent-harness.md"] });
const leitplanken = (t = LP_TEXT) => ({ gate: lib.stufe2Leitplanken(t), alle: lib.alleLeitplanken(t) });
const RISIKO = gs.risikoMusterAus({});
const eins = (pfad: string, zeilen = 1): Eintrag => ({ pfad, zeilen });
const stufe = (eintraege: Eintrag[] | null, o: { risiko?: unknown; lp?: string; prognose?: boolean; basis?: unknown } = {}) =>
  lib.bestimmeRisikostufe({ eintraege, basis: "basis" in o ? o.basis : BASIS, leitplanken: leitplanken(o.lp), risiko: o.risiko ?? RISIKO, prognose: o.prognose });
const lader = (zusatz: Lader = {}): Lader => ({ ladeBasis: () => BASIS, ladeText: () => LP_TEXT, ladeRisiko: () => RISIKO, ...zusatz });

describe("Stufe 2 durch die feste Basis (K2)", () => {
  test.each([
    [".github/workflows/ci.yml", "ci"],
    ["sub/pkg/package.json", "abhaengigkeiten"],
    ["requirements-dev.txt", "abhaengigkeiten"],
    [".mcp.json", "mcp"],
    [".claude/settings.json", "agentEinstellungen"],
    [".githooks/pre-commit", "hooks"],
    ["Package.JSON", "abhaengigkeiten"],
    [".github/risikostufe-basis.json", "selbstschutz"],
  ])("%s ist Stufe 2 (basis:%s)", (pfad, kategorie) => {
    const r = stufe([eins(pfad)]);
    expect(r.stufe).toBe(2);
    expect(r.treffer.map((t) => t.liste)).toContain(`basis:${kategorie}`);
  });
  test("die Projekt-Config ersetzt die Basis nicht: Risiko-Block mit anderem Muster, Workflow bleibt Stufe 2", () => {
    const risiko = gs.risikoMusterAus({ risiko: { hoch: ["nichts/"] } });
    expect(stufe([eins(".github/workflows/x.yml")], { risiko }).stufe).toBe(2);
  });
  test("die echte Basis-Datei lädt, hat sechs Kategorien und schützt sich selbst", () => {
    expect(Object.keys(BASIS.kategorien).sort()).toEqual(["abhaengigkeiten", "agentEinstellungen", "ci", "hooks", "mcp", "selbstschutz"]);
    expect(BASIS.kategorien.selbstschutz).toEqual(expect.arrayContaining(["/.github/risikostufe-basis.json", "/.github/protected-paths.json"]));
  });
});

describe("Leitplanken-Gruppe gate und Risikoklasse hoch", () => {
  test("mit Gruppe gate: ein gate-Pfad ist 2, ein reiner harness-Pfad (AGENTS.md) ist 1", () => {
    expect(stufe([eins("eslint.config.js")]).stufe).toBe(2);
    expect(stufe([eins("AGENTS.md")]).stufe).toBe(1);
  });
  test("ohne Gruppe gate gelten alle Leitplanken: derselbe harness-Pfad ist 2", () => {
    const r = stufe([eins("AGENTS.md")], { lp: JSON.stringify({ harness: ["AGENTS.md"] }) });
    expect(r.stufe).toBe(2);
    expect(r.treffer[0].liste).toBe("leitplanken:alle");
  });
  test("kaputtes JSON und gate als Nicht-Array liefern null und damit Stufe 2", () => {
    expect(lib.stufe2Leitplanken("{kaputt")).toBeNull();
    expect(lib.stufe2Leitplanken('{"gate":"x"}')).toBeNull();
    expect(lib.alleLeitplanken("{kaputt")).toBeNull();
    expect(lib.stufe2Leitplanken("null")).toBeNull();
    expect(lib.stufe2Leitplanken("5")).toBeNull();
    expect(lib.stufe2Leitplanken('{"gate":["/a", 5, null]}')).toEqual({ gruppe: "gate", muster: ["/a"] });
    expect(stufe([eins("docs/x.md")], { lp: "{kaputt" }).stufe).toBe(2);
    expect(stufe([eins("docs/x.md")], { lp: '{"gate":"x"}' }).stufe).toBe(2);
  });
  test("Risikoklasse hoch ist Stufe 2 (liste risiko)", () => {
    const r = stufe([eins("src/auth/login.ts")]);
    expect(r.stufe).toBe(2);
    expect(r.treffer.map((t) => t.liste)).toContain("risiko");
  });
});

describe("Stufe 0 und 1 (K3)", () => {
  test("Fall A: fünf Markdown-Dateien mit 500 Zeilen ohne Leitplanke sind 0", () => {
    const r = stufe(["a", "b", "c", "d", "e"].map((n) => eins(`docs/${n}.md`, 100)));
    expect(r).toMatchObject({ stufe: 0, gruende: [expect.stringMatching(/nur \*\.md/)] });
  });
  test.each(["docs/agent-harness.md", "AGENTS.md", ".agents/skills/x/SKILL.md", ".claude/agents/x.md"])("Fall A negativ: Leitplanken- oder Grundschutz-Markdown %s ist mindestens 1", (pfad) => {
    expect(stufe([eins(pfad)]).stufe).toBe(1);
  });
  test("Grundschutz-Markdown ist auch ohne Eintrag in den Leitplanken mindestens 1", () => {
    expect(stufe([eins("AGENTS.md")], { lp: JSON.stringify({ gate: ["/eslint.config.js"], harness: ["/foo/"] }) }).stufe).toBe(1);
  });
  test("Stufe 1 nennt den Grund: Produktionscode, Wächter-Test", () => {
    expect(stufe([eins("src/x.ts")]).gruende).toEqual([expect.stringMatching(/src\/x\.ts ist Code oder Konfiguration/)]);
    expect(stufe([eins("test/harness/a.test.ts")]).gruende.join(" ")).toMatch(/geschützten Pfad/);
  });
  test("Fall B: Testdatei und Doku in den S-Grenzen sind 0", () => {
    expect(stufe([eins("test/a.test.ts", 20), eins("docs/x.md")])).toMatchObject({ stufe: 0 });
  });
  test.each([
    ["Wächter-Test", [eins("test/harness/a.test.ts")]],
    ["vier Dateien", ["a", "b", "c", "d"].map((n) => eins(`test/${n}.test.ts`))],
    ["61 Zeilen", [eins("test/a.test.ts", 61)]],
    ["Produktionscode, eine Zeile", [eins("src/x.ts")]],
    ["Testhelfer", [eins("test/support/h.ts")]],
    ["Konfiguration", [eins("config/app.json")]],
  ])("Fall B negativ: %s ist 1", (_n, eintraege) => {
    const r = stufe(eintraege);
    expect(r.stufe).toBe(1);
    expect(r.gruende.length).toBeGreaterThan(0);
  });
});

describe("fail-closed (K5): immer Stufe 2 mit Grund", () => {
  test.each([
    ["leere Liste", [] as Eintrag[]],
    ["null", null],
    ["Eintrag ohne Pfad", [{ pfad: null, zeilen: 1 }]],
    ["quotierter Pfad", [eins('"d\\303\\266c.md"')]],
    ["Binärdatei", [{ pfad: "docs/x.md", zeilen: null }]],
  ])("%s", (_n, eintraege) => {
    const r = stufe(eintraege);
    expect(r.stufe).toBe(2);
    expect(r.gruende[0]).toBeTruthy();
  });
  test("Basis fehlt oder leer", () => {
    expect(stufe([eins("docs/x.md")], { basis: null }).stufe).toBe(2);
    expect(stufe([eins("docs/x.md")], { basis: { muster: ["a"] } }).stufe).toBe(2);
    expect(stufe([eins("docs/x.md")], { basis: { kategorien: {}, muster: [] } }).stufe).toBe(2);
  });
  test("leere Leitplanken-Gruppe, leere Gesamtliste, leere Risiko-Muster und Risiko mit fehler sind Stufe 2", () => {
    const eintraege = [eins("docs/x.md")];
    const basis = { basis: BASIS, risiko: RISIKO, eintraege };
    expect(lib.bestimmeRisikostufe({ ...basis, leitplanken: { gate: { gruppe: "gate", muster: [] }, alle: ["/a"] } }).gruende[0]).toMatch(/^Leitplanken \(protected-paths\) nicht geladen/);
    expect(lib.bestimmeRisikostufe({ ...basis, leitplanken: { gate: { gruppe: "gate", muster: ["/a"] }, alle: [] } }).gruende[0]).toMatch(/^Leitplanken \(protected-paths\) nicht geladen/);
    expect(lib.bestimmeRisikostufe({ ...basis, leitplanken: leitplanken(), risiko: { muster: [], quelle: "x" } }).gruende[0]).toMatch(/Risiko-Muster/);
    expect(lib.bestimmeRisikostufe({ ...basis, leitplanken: leitplanken(), risiko: { muster: ["x/"], quelle: "x", fehler: ["kaputt"] } }).gruende[0]).toMatch(/kaputt/);
  });
  test("Risiko mit fehler ist auch bei reinem *.md-Diff 2", () => {
    const risiko = gs.risikoMusterAus({ risiko: { hoch: "kein-array" } });
    expect(stufe([eins("docs/x.md")], { risiko })).toMatchObject({ stufe: 2, gruende: [expect.stringMatching(/Risiko-Muster/)] });
  });
  test("Lader werfen: Basis fehlt, kaputt, leere Kategorie, Leitplanken, Config", () => {
    const wirft = (m: string) => () => {
      throw new Error(m);
    };
    for (const z of [{ ladeBasis: wirft("weg") }, { ladeText: wirft("weg") }, { ladeRisiko: wirft("weg") }, { ladeText: () => "{kaputt" }]) {
      const a = lib.risikostufeAusPfaden(["docs/x.md"], lader(z));
      const b = lib.risikostufeAusGit(() => "1\t1\tdocs/x.md", "b", "HEAD", { ...lader(z), ladeRisikoBasis: () => RISIKO });
      for (const r of [a, b]) {
        expect(r.stufe).toBe(2);
        expect(r.gruende[0]).toMatch(/nicht ladbar/);
      }
    }
  });
  test("ein Ladefehler der Leitplanken-Datei steht allein im Grund, ein Nicht-Array gate ebenso", () => {
    expect(lib.risikostufeAusPfaden(["docs/x.md"], lader({ ladeText: () => { throw new Error("weg"); } })).gruende).toEqual(["Leitplanken nicht ladbar: weg"]);
    expect(lib.risikostufeAusPfaden(["docs/x.md"], lader({ ladeText: () => '{"gate":"x"}' })).gruende[0]).toMatch(/Gruppe gate ist kein Array/);
  });
  test("die Basis-Muster der Basis-Revision gelten mit: ein Diff macht die Risiko-Liste nicht schmaler", () => {
    const risikoKopf = gs.risikoMusterAus({ risiko: { hoch: ["nichts/"] } });
    const risikoBasis = gs.risikoMusterAus({ risiko: { hoch: ["geheim/"] } });
    const r = lib.risikostufeAusGit(() => "1\t1\tgeheim/a.txt", "b", "HEAD", { ...lader({ ladeRisiko: () => risikoKopf }), ladeRisikoBasis: () => risikoBasis });
    expect(r.stufe).toBe(2);
    expect(r.treffer.map((t) => t.liste)).toEqual(["risiko"]);
  });
  test("echte Basis-Lader: Datei fehlt, kaputt, Nicht-Objekt, leere Kategorie", () => {
    const d = mkdtempSync(join(tmpdir(), "rs-basis-"));
    try {
      const p = (n: string, inhalt: string) => {
        writeFileSync(join(d, n), inhalt);
        return join(d, n);
      };
      expect(() => lib.ladeStufe2Basis(join(d, "fehlt.json"))).toThrow();
      expect(() => lib.ladeStufe2Basis(p("a.json", "{kaputt"))).toThrow();
      expect(() => lib.ladeStufe2Basis(p("b.json", "[]"))).toThrow(/kein Objekt/);
      expect(() => lib.ladeStufe2Basis(p("c.json", '{"ci":[]}'))).toThrow(/Kategorie ci/);
      expect(() => lib.ladeStufe2Basis(p("d.json", '{"ci":["a",""]}'))).toThrow(/Kategorie ci/);
      expect(() => lib.ladeStufe2Basis(p("n.json", "null"))).toThrow(/kein Objekt/);
      expect(() => lib.ladeStufe2Basis(p("z.json", "5"))).toThrow(/kein Objekt/);
      expect(() => lib.ladeStufe2Basis(p("s.json", '{"ci":"x"}'))).toThrow(/Kategorie ci/);
      expect(() => lib.ladeStufe2Basis(p("e.json", '{"beschreibung":"x"}'))).toThrow(/keine Muster/);
      expect(lib.ladeStufe2Basis(p("g.json", '{"beschreibung":["/x/"],"ci":["/ci/"]}')).muster).toEqual(["/x/", "/ci/"]);
      expect(() => lib.ladeStufe2Basis(p("h.json", '{"beschreibung":5,"ci":["/ci/"]}'))).toThrow(/Kategorie beschreibung/);
      expect(lib.ladeStufe2Basis(p("f.json", '{"beschreibung":"x","ci":["/ci/"]}')).muster).toEqual(["/ci/"]);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
  test("git wirft, leerer Diff", () => {
    const o = { ...lader(), ladeRisikoBasis: () => RISIKO };
    expect(lib.risikostufeAusGit(() => { throw new Error("kaputt"); }, "b", "HEAD", o)).toMatchObject({ stufe: 2, gruende: [expect.stringMatching(/git-Fehler/)] });
    expect(lib.risikostufeAusGit(() => "", "b", "HEAD", o).stufe).toBe(2);
  });
});

describe("Prognose aus Pfaden", () => {
  test("Verzeichnis ohne und mit Schrägstrich trifft das Verzeichnismuster", () => {
    expect(lib.risikostufeAusPfaden([".github/workflows"], lader()).stufe).toBe(2);
    expect(lib.risikostufeAusPfaden([".github/workflows/"], lader()).stufe).toBe(2);
    // nur die Basis kennt dieses Verzeichnis (weder Leitplanken noch Risiko-Standardliste)
    expect(lib.risikostufeAusPfaden([".github/actions"], lader()).stufe).toBe(2);
    expect(lib.risikostufeAusPfaden([".husky/"], lader()).stufe).toBe(2);
  });
  test("Verzeichnis der Leitplanken-Gruppe und der Risiko-Liste, ohne doppelte Treffer", () => {
    const gate = JSON.stringify({ gate: ["/gatedir/"] });
    expect(lib.risikostufeAusPfaden(["gatedir"], lader({ ladeText: () => gate })).stufe).toBe(2);
    const db = lib.risikostufeAusPfaden(["db"], lader());
    expect(db.stufe).toBe(2);
    expect(db.treffer).toEqual([{ pfad: "db", muster: "db/", liste: "risiko" }]);
    expect(lib.risikostufeAusGit(() => "1\t1\tsrc/auth/x", "b", "HEAD", { ...lader(), ladeRisikoBasis: () => RISIKO }).treffer[0].pfad).toBe("src/auth/x");
    expect(lib.risikostufeAusPfaden(["src/auth"], lader()).treffer.filter((t) => t.liste === "risiko")).toHaveLength(1);
  });
  test("Doku-Pfad mit Teilwort im Namen bleibt 0", () => {
    expect(lib.risikostufeAusPfaden(["docs/auth.md"], lader()).stufe).toBe(0);
  });
  test("Risiko-Verzeichnis in der Prognose und Backslash-Pfad", () => {
    expect(lib.risikostufeAusPfaden(["src\\auth"], lader()).stufe).toBe(2);
  });
});

const libTyp = lib;
describe("pfadeAusTicket (K4)", () => {
  const lib = { pfadeAusTicket: (b: string, name = "Pfade") => libTyp.pfadeAusTicket(b, name) };
  const body = (abschnitt: string) => `## Ziel\nText\n\n## Pfade\n${abschnitt}\n\n## Akzeptanzkriterien\n1. x\n`;
  test("Backtick-Pfad mit Beschreibung, erstes Wort, nummerierte Liste, führender Schrägstrich", () => {
    expect(lib.pfadeAusTicket(body("- `scripts/a.mjs` neu\n* docs/b.md, kurz\n1. /src/c.ts\n2) ./d.ts\n- [ ] e.ts"))).toEqual({ pfade: ["scripts/a.mjs", "docs/b.md", "src/c.ts", "d.ts", "e.ts"], fehler: null });
  });
  test("Listenformen: + als Marker, eingerückt, zweistellige Nummer, [x] und [X], Trenner ; und :", () => {
    const r = lib.pfadeAusTicket(body("+ a.md\n  - b.md\n10. c.md\n- [x] d.md\n- [X] e.md\n- f.md;\n- g.md:"));
    expect(r).toEqual({ pfade: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"], fehler: null });
  });
  test("Glob-Zeichen * ? [ sind Fehler, Backslash wird zu Schrägstrich", () => {
    for (const g of ["a?.ts", "a[1].ts", "a*.ts"]) expect(lib.pfadeAusTicket(body(`- ${g}`)).fehler).toMatch(/Glob/);
    expect(lib.pfadeAusTicket(body("- src\\a.ts")).pfade).toEqual(["src/a.ts"]);
  });
  test("Fließtext und Fence im Abschnitt sind kein Eingang, ### gehört dazu, zwei Abschnitte werden vereinigt", () => {
    const b = `## Pfade\nHier steht Prosa mit scripts/x.mjs.\n- a.md\n\`\`\`\n- b.md\n\`\`\`\n### Mehr\n- c.md\n\n## Anderes\n- d.md\n\n## Pfade\n- e.md\n`;
    expect(lib.pfadeAusTicket(b)).toEqual({ pfade: ["a.md", "c.md", "e.md"], fehler: null });
  });
  test("der Abschnittsname kommt aus der Config (L5): `Paths` liest `## Paths`, `## Pfade` ist dann kein Eingang", () => {
    expect(lib.pfadeAusTicket("## Paths\n- a.md\n", "Paths")).toEqual({ pfade: ["a.md"], fehler: null });
    expect(lib.pfadeAusTicket("## Pfade\n- a.md\n", "Paths").fehler).toMatch(/„Paths“ fehlt/);
    expect(lib.pfadeAusTicket("## Paths\n- a.md\n", " Paths ")).toEqual({ pfade: ["a.md"], fehler: null });
    expect(lib.pfadeAusTicket("## Pfade\n- a.md\n", " Paths ").fehler).toBe("Abschnitt „Paths“ fehlt");
    expect(lib.pfadeAusTicket("## Paths\nText\n", "Paths").fehler).toBe("Abschnitt „Paths“ ohne Listenzeile (leer)");
  });
  test("ohne Namen: Fehler samt Fix, Stufe 2", () => {
    for (const n of [undefined, "", "  ", 3]) {
      const r = libTyp.pfadeAusTicket("## Pfade\n- a.md\n", n as string);
      expect(r.pfade).toEqual([]);
      expect(r.fehler).toMatch(/sprache\.spezifikation\.pfade fehlt .*Projekt-Config/);
    }
  });
  test.each([
    ["Abschnitt fehlt", "## Ziel\nnur Text mit .github/workflows/x.yml\n", /fehlt/],
    ["leer", body("nur Prosa ohne Liste"), /leer/],
    ["Listenzeile ohne Pfad", body("- \n"), /ohne Pfad/],
    ["Glob", body("- src/**/*.ts"), /Glob/],
  ])("%s ist ein Fehler", (_n, b, muster) => {
    const r = lib.pfadeAusTicket(b);
    expect(r.pfade).toEqual([]);
    expect(r.fehler).toMatch(muster);
  });
});

describe("RISIKO-, SWEEP- und KOMBI-Zeile (factory#529, vorher ein eigenes Skript)", () => {
  const unter = (pfade: string[], io: Io = {}) => cli.laufe(["--pfade", ...pfade], { ...lader(), ...io });
  const zeilen = (a: string) => a.split("\n");
  test("reine Doku: Stufe 0, doku, stichprobe, Kombi ja", () => {
    expect(zeilen(unter(["docs/x.md", "docs/y.md"]).ausgabe)).toEqual([
      expect.stringMatching(/^RISIKOSTUFE: 0/),
      "RISIKO: doku — nur *.md",
      "SWEEP: stichprobe — nur Doku und Testdateien, Risikoklasse nicht hoch",
      "KOMBI: ja",
    ]);
  });
  test("Code in kleinem Diff: Kombi ja, Sweep voll, Stufe 1; Risikoklasse hoch: Kombi nein mit Grund", () => {
    expect(zeilen(unter(["src/a.ts"]).ausgabe).slice(1)).toEqual(["RISIKO: normal — kein Pfad trifft ein Risiko-Muster (Standardliste)", "SWEEP: voll — src/a.ts ist Code oder Konfiguration", "KOMBI: ja"]);
    expect(zeilen(unter(["src/auth/x.ts"]).ausgabe).slice(1)).toEqual([
      "RISIKO: hoch — src/auth/x.ts trifft *auth* (Standardliste)",
      "SWEEP: voll — src/auth/x.ts trifft *auth* (Standardliste)",
      "KOMBI: nein — Risikostufe 2; Risikoklasse hoch: src/auth/x.ts trifft *auth* (Standardliste)",
    ]);
  });
  test("über der Grenze (vier Dateien) und im Grundschutz: Kombi nein, auch bei Stufe 1", () => {
    const vier = unter(["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts"]).ausgabe;
    expect(vier).toMatch(/^RISIKOSTUFE: 1/);
    expect(zeilen(vier)[3]).toMatch(/^KOMBI: nein — 4 Dateien \(höchstens 3\)/);
    expect(zeilen(unter(["scripts/y.mjs"]).ausgabe)[3]).toMatch(/^KOMBI: nein — scripts\/y\.mjs liegt in einem geschützten Pfad/);
  });
  test("Stufe 2 ohne Grundschutz-Pfad (Lockfile der Basis): KOMBI nein mit Grund Risikostufe 2", () => {
    for (const p of ["Cargo.lock", "go.mod", "requirements.txt"]) {
      const z = zeilen(unter([p]).ausgabe);
      expect(z[0], p).toMatch(/^RISIKOSTUFE: 2/);
      expect(z[3], p).toMatch(/^KOMBI: nein — Risikostufe 2/);
    }
  });
  test("--json trägt risiko mit allen Treffern, sweep und kombi", () => {
    const j = JSON.parse(unter(["src/auth/x.ts", "--json"]).ausgabe) as { risiko: unknown; sweep: unknown; kombi: unknown };
    expect(j.risiko).toMatchObject({ klasse: "hoch", quelle: "Standardliste", treffer: [{ pfad: "src/auth/x.ts", muster: "*auth*" }] });
    expect(j.sweep).toMatchObject({ tiefe: "voll" });
    expect(j.kombi).toMatchObject({ zulaessig: false, gruende: ["Risikostufe 2", expect.stringMatching(/Risikoklasse hoch/)] });
    const klein = JSON.parse(unter(["docs/x.md", "--json"]).ausgabe) as { kombi: unknown };
    expect(klein.kombi).toEqual({ zulaessig: true, gruende: [] });
  });
  test("der Text kürzt Risiko-Gründe auf fünf plus Zahl der weiteren, --json trägt alle", () => {
    const viele = Array.from({ length: 7 }, (_, i) => `src/auth/${i}.ts`);
    const zeile = zeilen(unter(viele).ausgabe)[1];
    expect(zeile).toMatch(/RISIKO: hoch — .*\(\+2 weitere\)$/);
    expect(zeile.split("; ")).toHaveLength(5);
    expect((JSON.parse(unter([...viele, "--json"]).ausgabe) as { risiko: { treffer: unknown[] } }).risiko.treffer).toHaveLength(7);
    const fuenf = Array.from({ length: 5 }, (_, i) => `src/auth/${i}.ts`);
    expect(zeilen(unter(fuenf).ausgabe)[1]).not.toMatch(/weitere/);
  });
  test("fail-closed: Stufe 2 trägt RISIKO hoch, SWEEP voll und KOMBI nein mit demselben Grund (Ladefehler, keine Basis, git-Fehler)", () => {
    const wirft = () => { throw new Error("kaputt"); };
    const alle = [
      unter(["src/a.ts"], { ladeText: wirft }),
      unter(["src/a.ts"], { ladeRisiko: wirft }),
      cli.laufe([], { ...lader(), env: {}, git: () => "" }),
      cli.laufe(["--commit", "abc"], { ...lader(), git: wirft }),
    ];
    for (const r of alle) {
      const z = zeilen(r.ausgabe);
      expect(z).toHaveLength(4);
      expect(z[0]).toMatch(/^RISIKOSTUFE: 2/);
      expect(z[1]).toMatch(/^RISIKO: hoch — /);
      expect(z[2]).toMatch(/^SWEEP: voll — /);
      expect(z[3]).toMatch(/^KOMBI: nein — /);
      const grund = z[0].replace(/^RISIKOSTUFE: 2 — /, "");
      expect(z[1]).toContain(grund);
      expect(z[2]).toContain(grund);
      expect(z[3]).toContain(grund);
    }
  });
  test("die injizierte Risikoliste wirkt über die CLI auf SWEEP (Verdrahtung, kein Default)", () => {
    const eigen = gs.risikoMusterAus({ risiko: { hoch: ["*billing*"] } });
    expect(zeilen(unter(["test/billing.test.ts", "docs/a.md"], { ladeRisiko: () => eigen }).ausgabe)[2]).toMatch(/^SWEEP: voll — /);
    expect(zeilen(unter(["test/billing.test.ts", "docs/a.md"], { ladeRisiko: () => gs.risikoMusterAus({}) }).ausgabe)[2]).toMatch(/^SWEEP: stichprobe — /);
    expect(zeilen(unter(["scripts/x.mjs", "test/x.test.ts"]).ausgabe)[2]).toMatch(/^SWEEP: voll — scripts\/x\.mjs ist Code oder Konfiguration$/);
    expect(zeilen(unter(["test/harness/x.test.ts"]).ausgabe)[2]).toMatch(/^SWEEP: voll — test\/harness\/x\.test\.ts ist ein Wächter-Test/);
  });
  test("Zeilenfunktionen: fehlende Felder sind fail-closed (SWEEP voll, KOMBI nein)", () => {
    expect(cli.sweepZeile({})).toBe("SWEEP: voll — nicht berechnet");
    expect(cli.kombiZeile({})).toBe("KOMBI: nein — nicht berechnet");
    expect(cli.kombiZeile({ kombi: { zulaessig: true, gruende: [] } })).toBe("KOMBI: ja");
  });
  test("als Prozess: vier Zeilen mit Exit 0, Aufruf-Fehler mit Exit 2 und Aufrufzeile", () => {
    const skript = fileURLToPath(new URL("../scripts/risikostufe.mjs", import.meta.url));
    const aus = execFileSync("node", [skript, "--pfade", "docs/x.md"], { encoding: "utf8" }).trim().split("\n");
    expect(aus.map((z) => z.split(":")[0])).toEqual(["RISIKOSTUFE", "RISIKO", "SWEEP", "KOMBI"]);
    expect(execFileSync("node", [skript, "--pfade", "src/auth/x.ts"], { encoding: "utf8" })).toMatch(/\nRISIKO: hoch — src\/auth\/x\.ts trifft \*auth\* \((?:Standardliste|Projekt-Config)\)/); // Quelle hängt davon ab, ob die Config des Repos einen Block risiko trägt
    const fehler = spawnSync("node", [skript, "--unbekannt"], { encoding: "utf8" });
    expect(fehler.status).toBe(2);
    expect(fehler.stderr).toMatch(/Aufruf: node scripts\/risikostufe\.mjs/);
  });
});

describe("CLI laufe", () => {
  const TICKET = (body: string, extra: Record<string, unknown> = {}) => (a: string[]) =>
    a[1] === "repos/{owner}/{repo}" ? { owner: { login: "ich" } } : { user: { login: "ich" }, labels: [], body, ...extra };
  const CONFIG = () => ({ labels: { forum: "forum" }, sprache: { spezifikation: { pfade: "Pfade" } } });
  const ticket = (body: string, extra?: Record<string, unknown>, io: Io = {}) => cli.laufe(["--ticket", "7"], { ...lader(), ghJson: TICKET(body, extra), ladeConfig: CONFIG, ...io });

  test("Textformat und --json-Schlüssel", () => {
    const r = cli.laufe(["--pfade", "docs/a.md"], lader());
    expect(r).toMatchObject({ code: 0 });
    expect(r.ausgabe.split("\n")).toHaveLength(4);
    expect(r.ausgabe).toMatch(/^RISIKOSTUFE: [012] — .+\nRISIKO: (?:hoch|normal|doku) — .+\nSWEEP: (?:voll|stichprobe) — .+\nKOMBI: (?:ja|nein)/);
    const j = JSON.parse(cli.laufe(["--pfade", "package.json", "--json"], lader()).ausgabe) as { stufe: number };
    expect(Object.keys(j)).toEqual(["stufe", "gruende", "treffer", "pfade", "risiko", "sweep", "kombi"]);
    expect(j.stufe).toBe(2);
  });
  test("lange Gründe werden im Text gekürzt", () => {
    const z = cli.stufeZeile({ stufe: 2, gruende: ["a", "b", "c", "d", "e", "f", "g"] });
    expect(z).toBe("RISIKOSTUFE: 2 — a; b; c; d; e (+2 weitere)");
  });
  test("genau fünf Gründe werden ohne Rest-Zusatz ausgegeben", () => {
    expect(cli.stufeZeile({ stufe: 2, gruende: ["a", "b", "c", "d", "e"] })).toBe("RISIKOSTUFE: 2 — a; b; c; d; e");
  });
  test("Zeilenumbrüche in Gründen werden im Text zu Leerzeichen, --json behält den Rohtext", () => {
    expect(cli.stufeZeile({ stufe: 2, gruende: ["a \n  hint: b"] })).toBe("RISIKOSTUFE: 2 — a hint: b");
    expect(cli.stufeZeile({ stufe: 2, gruende: ["git-Fehler: Command failed\nfatal: bad object x\n", "b\r\nc"] })).toBe("RISIKOSTUFE: 2 — git-Fehler: Command failed fatal: bad object x; b c");
    const io = { ...lader(), git: () => { throw new Error("Command failed\nfatal: bad object deadbeef\n"); } };
    const r = cli.laufe(["--commit", "deadbeef"], io);
    expect(r.ausgabe.split("\n")).toHaveLength(4);
    expect(r.ausgabe.startsWith("RISIKOSTUFE: 2 — ")).toBe(true);
    expect(r.ausgabe.split("\n").map((z) => z.split(":")[0])).toEqual(["RISIKOSTUFE", "RISIKO", "SWEEP", "KOMBI"]);
    const j = JSON.parse(cli.laufe(["--commit", "deadbeef", "--json"], io).ausgabe) as { gruende: string[] };
    expect(j.gruende.join("")).toContain("\n");
  });
  test.each([
    [["--bogus"]],
    [["--commit", "x", "--pfade", "a"]],
    [["--ticket", "abc"]],
    [["docs/a.md"]],
    [["--liste", "--commit", "x"]],
    [["--ticket"]],
    [["--ticket", "7x"]],
  ])("Aufruffehler %j ist Exit 2", (argv) => {
    const r = cli.laufe(argv, lader());
    expect(r.code).toBe(2);
    expect(r.ausgabe).toContain("Aufruf:");
  });
  test("--pfade ohne Pfad ist Stufe 2 mit Exit 0", () => {
    const r = cli.laufe(["--pfade"], lader());
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/^RISIKOSTUFE: 2 — keine Dateiliste \(leer/);
  });
  test("--commit rechnet <sha>^..<sha>", () => {
    const aufrufe: string[][] = [];
    const r = cli.laufe(["--commit", "abc123"], { ...lader(), ladeRisikoBasis: () => RISIKO, git: (a) => (aufrufe.push(a), "3\t2\tdocs/x.md") });
    expect(aufrufe[0].at(-1)).toBe("abc123^..abc123");
    expect(r.ausgabe).toMatch(/^RISIKOSTUFE: 0/);
  });
  test("ohne Argument: keine Basis auflösbar ist Stufe 2", () => {
    const r = cli.laufe([], { ...lader(), env: {}, git: () => { throw new Error("kein git"); } });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/^RISIKOSTUFE: 2 — keine Vergleichs-Basis/);
  });
  test("ohne Argument: Diff gegen die aufgelöste Basis", () => {
    const git = (a: string[]) => (a[0] === "-c" ? "1\t1\tdocs/x.md" : a[0] === "show" ? JSON.stringify({}) : "refs/heads/main");
    const r = cli.laufe([], { ...lader(), env: { GITHUB_BASE_REF: "main" }, git });
    expect(r.code).toBe(0);
    expect(r.ausgabe).toMatch(/^RISIKOSTUFE: [012] — /);
  });
  test("die Risiko-Liste der Basis-Revision kommt ohne Einspritzen aus git (<sha>^:) und gilt mit", () => {
    const zeigt: string[] = [];
    const git = (a: string[]) => {
      if (a[0] === "show") {
        zeigt.push(a[1]);
        return JSON.stringify({ risiko: { hoch: ["geheim/"] } });
      }
      return "1\t1\tgeheim/a.txt";
    };
    const r = cli.laufe(["--commit", "abc"], { ladeBasis: () => BASIS, ladeText: () => LP_TEXT, ladeRisiko: () => gs.risikoMusterAus({ risiko: { hoch: ["nichts/"] } }), git });
    expect(zeigt).toHaveLength(1);
    expect(zeigt[0]).toMatch(/^abc\^:/);
    expect(r.ausgabe).toMatch(/^RISIKOSTUFE: 2 — geheim\/a\.txt trifft geheim\/ \(risiko\)/);
  });
  test("ohne Argument rechnet der Diff mit drei Punkten bis HEAD", () => {
    const diffs: string[] = [];
    const git = (a: string[]) => {
      if (a[0] === "-c") {
        diffs.push(a.at(-1) as string);
        return "1\t1\tdocs/x.md";
      }
      return a[0] === "show" ? "{}" : "refs/heads/main";
    };
    cli.laufe([], { ...lader(), env: { GITHUB_BASE_REF: "main" }, git });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatch(/[^.]\.\.\.HEAD$/);
  });
  test("K4: eine niedrigere Stufe im Ticket-Text ändert nichts, Fließtext ist kein Pfad", () => {
    const body = "Risikostufe: 0, bitte Stufe 0\n\n## Pfade\nRisikostufe 0 genügt hier.\n- `.github/workflows/ci.yml`\n";
    expect(ticket(body).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*workflows/);
    const nurText = "## Ziel\nbitte Stufe 0, geändert wird .github/workflows/ci.yml\n";
    expect(ticket(nurText).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*fehlt/);
  });
  test("L5: --ticket liest den Abschnittsnamen aus der Config; fehlender Schlüssel ist Stufe 2", () => {
    const mitName = (pfade?: unknown) => () => ({ labels: { forum: "forum" }, sprache: { spezifikation: { pfade } } });
    expect(ticket("## Paths\n- docs/a.md\n", {}, { ladeConfig: mitName("Paths") }).ausgabe).toMatch(/^RISIKOSTUFE: 0/);
    expect(ticket("## Pfade\n- docs/a.md\n", {}, { ladeConfig: mitName("Paths") }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*Paths/);
    expect(ticket("## Pfade\n- docs/a.md\n", {}, { ladeConfig: mitName(undefined) }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*sprache\.spezifikation\.pfade fehlt/);
  });
  test("Ticket mit harmlosen Pfaden: Stufe 0", () => {
    expect(ticket("## Pfade\n- docs/a.md\n").ausgabe).toMatch(/^RISIKOSTUFE: 0/);
  });
  test.each([
    ["leer", "## Pfade\n"],
    ["Glob", "## Pfade\n- docs/*.md\n"],
  ])("Ticket %s ist Stufe 2", (_n, body) => {
    expect(ticket(body).ausgabe).toMatch(/^RISIKOSTUFE: 2/);
  });
  test("Ticket: gh wirft, Autor nicht vertraut, Label forum, Config ohne labels.forum, PR, Besitzer fehlt", () => {
    const b = "## Pfade\n- docs/a.md\n";
    expect(ticket(b, {}, { ghJson: () => { throw new Error("gh weg"); } }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*nicht lesbar/);
    expect(ticket(b, { user: { login: "fremd" } }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*Fremdeingang/);
    expect(ticket(b, { labels: [{ name: "forum" }] }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*Fremdeingang/);
    expect(ticket(b, {}, { ladeConfig: () => ({}) }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*Fremdeingang-Prüfung/);
    expect(ticket(b, { pull_request: {} }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*PR/);
    expect(ticket(b, {}, { ghJson: (a) => (a[1] === "repos/{owner}/{repo}" ? { owner: { login: "" } } : { user: { login: "ich" }, labels: [], body: b }) }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*Besitzer/);
    expect(ticket(b, {}, { ghJson: () => ({ body: b }) }).ausgabe).toMatch(/^RISIKOSTUFE: 2 — .*Besitzer/);
  });
  test("--liste: Basis-, Gate- und Risiko-Zeilen; kaputte Basis ist Exit 1 mit nicht ladbar", () => {
    const r = cli.laufe(["--liste"], lader());
    expect(r.code).toBe(0);
    expect(r.ausgabe).toContain("/.github/workflows/\tbasis:ci");
    expect(r.ausgabe).toContain("/eslint.config.js\tleitplanken:gate");
    expect(r.ausgabe).toMatch(/\*auth\*\trisiko:/);
    expect((JSON.parse(cli.laufe(["--liste", "--json"], lader()).ausgabe) as { fehler: string[] }).fehler).toEqual([]);
    const kaputt = cli.laufe(["--liste"], lader({ ladeBasis: () => { throw new Error("weg"); } }));
    expect(kaputt.code).toBe(1);
    expect(kaputt.ausgabe).toMatch(/nicht ladbar: Stufe-2-Basis — weg/);
  });
  test.each([
    ["ladeText wirft", { ladeText: () => { throw new Error("weg"); } }],
    ["Leitplanken kaputt", { ladeText: () => "{kaputt" }],
    ["ladeRisiko wirft", { ladeRisiko: () => { throw new Error("weg"); } }],
  ])("--liste: %s ist Exit 1 mit nicht ladbar, kein Absturz", (_n, z) => {
    const r = cli.laufe(["--liste"], lader(z));
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/nicht ladbar: /);
  });
  test("--liste: Risiko-Muster mit Fehler ist nicht ladbar", () => {
    const r = cli.laufe(["--liste"], lader({ ladeRisiko: () => gs.risikoMusterAus({ risiko: { hoch: 5 } }) }));
    expect(r.code).toBe(1);
  });
});

describe("Ende-zu-Ende im Temp-git-Repo", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const skript = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "risikostufe.mjs");
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { cwd, encoding: "utf8" });
  function commitMit(datei: string): string {
    const d = mkdtempSync(join(tmpdir(), "rs-e2e-"));
    dirs.push(d);
    git(d, "init", "-q");
    writeFileSync(join(d, "start.txt"), "x\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "start");
    mkdirSync(join(d, dirname(datei)), { recursive: true });
    writeFileSync(join(d, datei), "inhalt\n");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "x");
    const sha = git(d, "rev-parse", "HEAD").trim();
    const r = spawnSync("node", [skript, "--commit", sha], { cwd: d, encoding: "utf8" });
    expect(r.status).toBe(0);
    return r.stdout;
  }
  test("ein Aufruffehler endet mit Exit 2 und Text auf stderr", () => {
    const r = spawnSync("node", [skript, "--bogus"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Aufruf:");
    expect(r.stdout).toBe("");
  });
  test("nur .md ergibt 0, package.json ergibt 2", () => {
    // Die Skript-Listen kommen aus dem Repo des Skripts (die echte Leitplanken-Datei), nicht aus dem Temp-Repo.
    expect(commitMit("docs/neu.md")).toMatch(/^RISIKOSTUFE: 0/);
    expect(commitMit("package.json")).toMatch(/^RISIKOSTUFE: 2/);
  });
});

describe("ausloeser bei Stufe 1 (factory#526)", () => {
  test("Code-Pfad ist der Auslöser; Markdown und Testdateien außerhalb von test/harness/ nicht", () => {
    const e = stufe([eins("docs/a.md"), eins("test/a.test.ts"), eins("src/x.ts")]) as Ergebnis & { ausloeser?: string };
    expect(e.stufe).toBe(1);
    expect(e.ausloeser).toBe("src/x.ts");
  });
  test("test/support ist Code (wie in der Sweep-Tiefe), *.test.ts nicht", () => {
    const a = stufe([eins("docs/a.md"), eins("test/support/helfer.ts")]) as Ergebnis & { ausloeser?: string };
    expect(a.ausloeser).toBe("test/support/helfer.ts");
    const b = stufe([eins("src/x.test.ts"), eins("src/y.ts")]) as Ergebnis & { ausloeser?: string };
    expect(b.ausloeser).toBe("src/y.ts");
  });
  test("nur Testdateien, davon eine unter test/harness/: der Wächter-Test ist der Auslöser", () => {
    const e = stufe([eins("test/a.test.ts"), eins("test/harness/w.test.ts")]) as Ergebnis & { ausloeser?: string };
    expect(e.stufe).toBe(1);
    expect(e.ausloeser).toBe("test/harness/w.test.ts");
  });
  test("Leitplanken-Markdown: der geschützte Pfad ist der Auslöser", () => {
    const e = stufe([eins("docs/a.md"), eins("AGENTS.md")]) as Ergebnis & { ausloeser?: string };
    expect(e.stufe).toBe(1);
    expect(e.ausloeser).toBe("AGENTS.md");
  });
});
