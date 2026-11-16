/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#608, Regel-Verfall 2/4 von factory#517). */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libModul from "../../scripts/regel-verfall-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as skriptModul from "../../scripts/regel-verfall.mjs";

const WURZEL = join(__dirname, "..", "..");
type Zeile = Record<string, unknown>;
type Ergebnis = { kandidaten: { id: string; laeufe: number; faenge: number }[]; nichtMessbar: { id: string; grund: string }[]; ausgenommen: { id: string }[]; mitFang: { id: string }[]; nichtFaellig: number };
const lib = libModul as unknown as {
  SICHERHEITS_AUSNAHMEN: { ziel: string; grund: string }[];
  istSicherheitsAusnahme: (ziel: string, a?: { ziel: string; grund: string }[]) => boolean;
  fettRegeln: (t: string) => { titel: string; anker: string }[];
  ankerAus: (t: string, fett?: boolean) => Set<string>;
  plusTage: (d: string, n: number) => string;
  fehlendeZeilen: (o: { zeilen: Zeile[]; waechterPfade: string[]; agentsText: string; heute: string }) => Zeile[];
  pruefeAbdeckung: (o: { zeilen: Zeile[]; waechterPfade: string[]; agentsText: string }) => string[];
  pruefeAusnahmen: (a: unknown[], existiert: (z: string) => boolean) => string[];
  kandidaten: (r: { zeilen: Zeile[] }, e: { punkte: Zeile[] }[], o: { heute: string; ausnahmen?: { ziel: string; grund: string }[] }) => Ergebnis;
  STREICH_LABEL: string;
  WIDERSPRUCH_LABEL: string;
  streichMarker: (id: string) => string;
  streichBranch: (id: string) => string;
  streichPlan: (ziel: string, text?: string) => { aktion: string; pfad: string; neuerText?: string; zeilen?: string[]; grund?: string };
  registerGestrichen: (r: { zeilen: Zeile[] }, id: string, heute: string) => { zeilen: Zeile[] };
  planeStreichPRs: (k: Kand[], offene: { headRefName?: string; body?: string }[], o?: { ausnahmen?: { ziel: string; grund: string }[] }) => { neu: Kand[]; uebersprungen: { id: string; grund: string }[] };
  streichText: (k: Kand, o: { fenster: { von: string; bis: string }; heute: string; plan: { aktion: string; pfad: string; zeilen?: string[] } }) => { titel: string; commit: string; body: string };
  hatWiderspruch: (labels: string[], teile: { vertraut: boolean; text: string }[]) => boolean;
  checksGruen: (c: unknown) => boolean;
  fristAbgelaufen: (angelegt: string, jetzt: Date) => boolean;
  mergeEntscheidung: (o: { labels: string[]; teile: { vertraut: boolean; text: string }[]; checks: unknown; angelegt: string; jetzt: Date }) => { merge: boolean; grund: string };
};
type Kand = { id: string; ziel: string; ablauf: string; laeufe: number; faenge: number };
const skript = skriptModul as unknown as {
  waechterPfade: () => string[];
  zielExistiert: (z: string) => boolean;
  parseArgs: (a: string[]) => { fehler?: string };
  ausfuehren: (a: Record<string, unknown>, d?: Record<string, unknown>) => { exitCode: number; text: string };
};

const lies = (p: string) => readFileSync(join(WURZEL, p), "utf8");
const register = () => JSON.parse(lies(".github/aenderungsregister.json")) as { zeilen: Zeile[] };
const verfallZeilen = () => register().zeilen.filter((z) => z.art === "verfall");

const zeile = (id: string, ziel: string, extra: Zeile = {}): Zeile => ({ id, art: "verfall", ziel, aufgenommen: "2026-01-01", ablauf: "2026-01-31", messgroesse: "fangquote", ...extra });
const punkt = (ziel: string, tag: string, einheitId: string, wert: number): Zeile => ({ messgroesse: "fangquote", parameter: ziel, zeitpunkt: `${tag}T10:00:00Z`, einheitId, wert });
const SCHUTZ = "test/harness/pretooluse-hook.test.ts";
const ROUTINE = "test/harness/bash-parser.test.ts";

describe("Regel-Verfall: Bremse und Abdeckung des echten Registers (factory#608)", () => {
  it("jede test/harness/*.test.ts und jede fett markierte Regel in AGENTS.md hat eine Verfall-Zeile", () => {
    const meldungen = lib.pruefeAbdeckung({ zeilen: verfallZeilen(), waechterPfade: skript.waechterPfade(), agentsText: lies("AGENTS.md") });
    expect(meldungen).toEqual([]);
  });

  it("jede Verfall-Zeile zeigt auf ein existierendes Ziel (Pfad und Anker)", () => {
    expect(verfallZeilen().filter((z) => z.gestrichen === undefined && !skript.zielExistiert(String(z.ziel))).map((z) => `${String(z.id)}: ${String(z.ziel)}`)).toEqual([]);
  });

  it("die Ziele der Wächter- und AGENTS.md-Regel-Zeilen sind eindeutig (Regeln in Doku-Seiten teilen sich Anker)", () => {
    const ziele = verfallZeilen().map((z) => String(z.ziel)).filter((z) => !z.includes("#") || z.startsWith("AGENTS.md#"));
    expect(ziele.filter((z, i) => ziele.indexOf(z) !== i)).toEqual([]);
  });

  it("der Generator hat nichts mehr zu tun (bestehende Zeilen werden übersprungen, keine Dubletten)", () => {
    const neu = lib.fehlendeZeilen({ zeilen: register().zeilen, waechterPfade: skript.waechterPfade(), agentsText: lies("AGENTS.md"), heute: "2026-11-16" });
    expect(neu).toEqual([]);
  });

  it("die Sicherheits-Ausnahmeliste zeigt nur auf existierende Ziele", () => {
    expect(lib.pruefeAusnahmen(lib.SICHERHEITS_AUSNAHMEN, skript.zielExistiert)).toEqual([]);
    expect(lib.SICHERHEITS_AUSNAHMEN.length).toBeGreaterThanOrEqual(15);
  });

  it("die Zeilen verfall-sicherheits-workflows und verfall-sicherheits-checks-335 sind ausgenommen", () => {
    const zeilen = verfallZeilen();
    for (const id of ["verfall-sicherheits-workflows", "verfall-sicherheits-checks-335"]) {
      const z = zeilen.find((x) => x.id === id);
      expect([id, z !== undefined && lib.istSicherheitsAusnahme(String(z.ziel))]).toEqual([id, true]);
    }
  });
});

describe("Regel-Verfall: Bremse an Fixtures (Negativfälle)", () => {
  const agents = "- **Neue Regel:** Text\n  - **Zweite Regel (x#1).** Text\n";

  it("eine neue Wächter-Datei ohne Zeile macht die Prüfung rot", () => {
    const m = lib.pruefeAbdeckung({ zeilen: [zeile("verfall-a", "test/harness/a.test.ts")], waechterPfade: ["test/harness/a.test.ts", "test/harness/neu.test.ts"], agentsText: "" });
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("test/harness/neu.test.ts");
  });

  it("eine neue fett markierte Regel ohne Zeile macht die Prüfung rot, eine mit Zeile nicht", () => {
    const zeilen = [zeile("verfall-r", "AGENTS.md#neue-regel")];
    const m = lib.pruefeAbdeckung({ zeilen, waechterPfade: [], agentsText: agents });
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("Zweite Regel");
    expect(lib.pruefeAbdeckung({ zeilen: [...zeilen, zeile("verfall-z", "AGENTS.md#zweite-regel-x1")], waechterPfade: [], agentsText: agents })).toEqual([]);
  });

  it("zwei Regeln mit demselben Anker sind rot", () => {
    const m = lib.pruefeAbdeckung({ zeilen: [zeile("verfall-r", "AGENTS.md#gleich")], waechterPfade: [], agentsText: "- **Gleich:** a\n- **Gleich.** b\n" });
    expect(m.join("\n")).toContain("zwei Regeln mit dem Anker gleich");
  });

  it("ein Ausnahme-Eintrag ohne existierendes Ziel ist rot, ebenso ein Eintrag ohne Grund und eine Dublette", () => {
    const m = lib.pruefeAusnahmen([{ ziel: "gibt/es/nicht.md", grund: "x" }, { ziel: "da.md", grund: "" }, { ziel: "da2.md", grund: "x" }, { ziel: "da2.md", grund: "x" }], (z) => z !== "gibt/es/nicht.md");
    expect(m.join("\n")).toContain("gibt/es/nicht.md: zeigt auf kein existierendes Ziel");
    expect(m.join("\n")).toContain("ziel und grund");
    expect(m.join("\n")).toContain("da2.md: doppelt");
  });

  it("zielExistiert prüft Pfad und Anker (Überschrift, fett markierte Regel nur in AGENTS.md)", () => {
    expect(skript.zielExistiert("AGENTS.md")).toBe(true);
    expect(skript.zielExistiert("gibt/es/nicht.md")).toBe(false);
    expect(skript.zielExistiert("AGENTS.md#kein-solcher-anker-xyz")).toBe(false);
    expect(skript.zielExistiert("docs/harness-glossar.md#standard-verfall")).toBe(false);
    expect(skript.zielExistiert("AGENTS.md#kern-regeln-factory-besitz")).toBe(true);
    expect(skript.zielExistiert("AGENTS.md#kein-secret-key-im-agentenlauf")).toBe(true);
    expect(skript.zielExistiert("scripts/regel-verfall.mjs#kein-md-anker")).toBe(false);
  });
});

describe("Regel-Verfall: Generator", () => {
  it("legt aufgenommen plus 30 Tage an und überspringt Ziele mit Zeile (auch mit anderer Id)", () => {
    const zeilen = [zeile("verfall-andere-id", "test/harness/a.test.ts", { ablauf: "2027-03-01" })];
    const neu = lib.fehlendeZeilen({ zeilen, waechterPfade: ["test/harness/a.test.ts", "test/harness/b.test.ts"], agentsText: "- **Regel eins:** x\n", heute: "2026-11-16" });
    expect(neu.map((z) => z.ziel)).toEqual(["test/harness/b.test.ts", "AGENTS.md#regel-eins"]);
    expect(neu[0]).toEqual({ id: "verfall-b", art: "verfall", ziel: "test/harness/b.test.ts", aufgenommen: "2026-11-16", ablauf: "2026-12-16", messgroesse: "fangquote" });
    expect(neu[1].id).toBe("verfall-agents-regel-eins");
  });

  it("vergibt bei einer Id-Kollision eine freie Id", () => {
    const neu = lib.fehlendeZeilen({ zeilen: [zeile("verfall-b", "docs/x.md#y")], waechterPfade: ["test/harness/b.test.ts"], agentsText: "", heute: "2026-11-16" });
    expect(neu[0].id).toBe("verfall-b-2");
  });

  it("--generieren schreibt nur mit Zeilen und nie mit --trocken; ein Lauf danach legt nichts mehr an", () => {
    const geschrieben: string[] = [];
    const deps = { lies: () => JSON.stringify({ version: 1, zeilen: [] }), schreibe: (_p: string, t: string) => geschrieben.push(t), waechter: () => ["test/harness/b.test.ts"], agentsText: () => "", bezieher: false };
    expect(skript.ausfuehren({ generieren: true, trocken: true, register: "r.json", exporte: [] }, deps).exitCode).toBe(0);
    expect(geschrieben).toHaveLength(0);
    const r = skript.ausfuehren({ generieren: true, register: "r.json", exporte: [], heute: "2026-11-16" }, deps);
    expect(r.text).toContain("Angelegt: 1 Verfall-Zeilen");
    expect(geschrieben).toHaveLength(1);
    const danach = JSON.parse(geschrieben[0]) as { zeilen: Zeile[] };
    expect(danach.zeilen).toHaveLength(1);
    const wieder = skript.ausfuehren({ generieren: true, register: "r.json", exporte: [] }, { ...deps, lies: () => geschrieben[0] });
    expect(wieder.text).toContain("Angelegt: 0 Verfall-Zeilen");
    expect(geschrieben).toHaveLength(1);
  });
});

describe("Regel-Verfall: Kandidaten", () => {
  const heute = "2026-02-15";
  const zeilen = [zeile("verfall-routine", ROUTINE), zeile("verfall-schutz", SCHUTZ), zeile("verfall-fang", "test/harness/fang.test.ts"), zeile("verfall-spaet", "test/harness/spaet.test.ts", { ablauf: "2026-03-01" })];
  const punkte = (ziel: string, wert: number) => [punkt(ziel, "2026-02-01", "lauf-1", wert), punkt(ziel, "2026-02-10", "lauf-2", 0)];
  const exporte = (...p: Zeile[][]) => [{ punkte: p.flat() }];

  it("fällig und ohne Fang im Fenster ist Kandidat, mit Zahlen je Zeile", () => {
    const e = lib.kandidaten({ zeilen }, exporte(punkte(ROUTINE, 0)), { heute });
    expect(e.kandidaten).toEqual([{ id: "verfall-routine", ziel: ROUTINE, ablauf: "2026-01-31", laeufe: 2, faenge: 0 }]);
  });

  it("ein Fang im Fenster macht kein Kandidat; ein Fang vor dem Fenster zählt nicht", () => {
    const mitFang = lib.kandidaten({ zeilen }, exporte(punkte(ROUTINE, 1)), { heute });
    expect(mitFang.kandidaten).toEqual([]);
    expect(mitFang.mitFang.map((k) => k.id)).toEqual(["verfall-routine"]);
    const alt = lib.kandidaten({ zeilen }, exporte([punkt(ROUTINE, "2025-12-01", "alt", 1), punkt(ROUTINE, "2026-02-10", "neu", 0)]), { heute });
    expect(alt.kandidaten.map((k) => k.id)).toEqual(["verfall-routine"]);
  });

  it("nicht fällig (heute < ablauf) ist nie Kandidat", () => {
    const e = lib.kandidaten({ zeilen }, exporte(punkte("test/harness/spaet.test.ts", 0)), { heute });
    expect(e.nichtFaellig).toBe(1);
    expect(e.kandidaten.map((k) => k.id)).not.toContain("verfall-spaet");
    expect(lib.kandidaten({ zeilen }, exporte(punkte("test/harness/spaet.test.ts", 0)), { heute: "2026-03-01" }).kandidaten.map((k) => k.id)).toContain("verfall-spaet");
  });

  it("Lücken stehen getrennt als nicht messbar und sind nie Kandidat (ohne Messpunkte, Regel ohne durch)", () => {
    const regel = zeile("verfall-regel", "AGENTS.md#irgendeine-regel");
    const e = lib.kandidaten({ zeilen: [...zeilen, regel] }, exporte(punkte(ROUTINE, 0)), { heute });
    expect(e.nichtMessbar.map((k) => k.id).sort()).toEqual(["verfall-fang", "verfall-regel"]);
    expect(e.nichtMessbar.find((k) => k.id === "verfall-regel")?.grund).toContain("durch");
    expect(e.kandidaten.map((k) => k.id)).toEqual(["verfall-routine"]);
    expect(lib.kandidaten({ zeilen }, [], { heute }).kandidaten).toEqual([]);
  });

  it("Negativfall: ein Ziel der Sicherheits-Ausnahmeliste ist nie Kandidat, auch ohne jeden Fang (Red-Green)", () => {
    const e = lib.kandidaten({ zeilen }, exporte(punkte(SCHUTZ, 0), punkte(ROUTINE, 0)), { heute });
    expect(e.ausgenommen.map((k) => k.id)).toEqual(["verfall-schutz"]);
    expect(e.kandidaten.map((k) => k.id)).toEqual(["verfall-routine"]);
    // Gegenprobe: ohne Ausnahmeliste wäre dasselbe Ziel Kandidat
    const ohne = lib.kandidaten({ zeilen }, exporte(punkte(SCHUTZ, 0)), { heute, ausnahmen: [] });
    expect(ohne.kandidaten.map((k) => k.id)).toEqual(["verfall-schutz"]);
  });

  it("eine Ausnahme mit Anker trifft nur dieses Ziel, ein Pfad trifft auch Ziele mit Anker", () => {
    const a = [{ ziel: "docs/x.md#a", grund: "g" }, { ziel: "docs/y.md", grund: "g" }];
    expect(lib.istSicherheitsAusnahme("docs/x.md#a", a)).toBe(true);
    expect(lib.istSicherheitsAusnahme("docs/x.md#b", a)).toBe(false);
    expect(lib.istSicherheitsAusnahme("docs/y.md#b", a)).toBe(true);
    expect(lib.istSicherheitsAusnahme("docs/z.md", a)).toBe(false);
  });

  it("die Ausnahmeliste deckt jede Zeile des Registers, die ein Ausnahme-Ziel trägt", () => {
    const e = lib.kandidaten(register(), [], { heute: "2099-01-01" });
    expect(e.ausgenommen.length).toBeGreaterThanOrEqual(10);
    expect(e.kandidaten).toEqual([]);
  });
});

describe("Regel-Verfall: Skript", () => {
  const deps = (extra: Record<string, unknown> = {}) => ({ bezieher: false, lies: () => JSON.stringify({ version: 1, zeilen: [zeile("verfall-routine", ROUTINE)] }), ...extra });

  it("--kandidaten ohne Messpunkte ist Exit 0 mit „nicht messbar“", () => {
    const r = skript.ausfuehren({ kandidaten: true, exporte: [], register: "r.json", heute: "2026-02-15" }, deps());
    expect(r.exitCode).toBe(0);
    expect(r.text).toContain("Nicht messbar (Lücke, nie Kandidat): 1");
  });

  it("ein Registerfehler ist Exit 1, ein Bezieher Exit 4, ein Aufruffehler Exit 2", () => {
    expect(skript.ausfuehren({ kandidaten: true, exporte: [], register: "r.json" }, deps({ lies: () => "kaputt" })).exitCode).toBe(1);
    expect(skript.ausfuehren({ kandidaten: true, exporte: [], register: "r.json" }, deps({ bezieher: true })).exitCode).toBe(4);
    expect(skript.ausfuehren(skript.parseArgs([]), deps()).exitCode).toBe(2);
    expect(skript.parseArgs(["--kandidaten", "--generieren"]).fehler).toBeDefined();
    expect(skript.parseArgs(["--streich-pr", "--faellige-mergen"]).fehler).toBeDefined();
    expect(skript.parseArgs(["--streich-pr"]).fehler).toBeUndefined();
    expect(skript.parseArgs(["--faellige-mergen"]).fehler).toBeUndefined();
    expect(skript.parseArgs(["--kandidaten", "--heute", "morgen"]).fehler).toBeDefined();
    expect(skript.parseArgs(["--kandidaten"]).fehler).toBeUndefined();
  });

  it("plusTage rechnet über Monats- und Jahresgrenzen", () => {
    expect(lib.plusTage("2026-11-16", 30)).toBe("2026-12-16");
    expect(lib.plusTage("2026-12-20", 30)).toBe("2027-01-19");
    expect(lib.plusTage("2026-03-01", -30)).toBe("2026-01-30");
  });

  it("fettRegeln liest Titel ohne Schlusszeichen, auch eingerückt, ignoriert Fließtext", () => {
    const t = "- **Eins:** a\n  - **Zwei (x#1).** b\n- Text mit **fett** mittendrin\n**Block:**\n";
    expect(lib.fettRegeln(t).map((r) => r.anker)).toEqual(["eins", "zwei-x1"]);
    expect([...lib.ankerAus("# Titel A\n```\n# kein Anker\n```\n## Titel (B)\n")]).toEqual(["titel-a", "titel-b"]);
  });
});

describe("Regel-Verfall: Lücken der Erstfassung (Review Runde 1)", () => {
  const heute = "2026-02-15";
  const z1 = [zeile("verfall-routine", ROUTINE)];
  const nur = (tag: string, wert: number) => [{ punkte: [punkt(ROUTINE, tag, "l1", wert), punkt(ROUTINE, "2026-02-14", "l2", 0)] }];

  it("das Fenster sind 30 Kalendertage einschließlich heute: heute-29 zählt, heute-30 und morgen nicht", () => {
    expect(lib.kandidaten({ zeilen: z1 }, nur("2026-01-17", 1), { heute }).kandidaten).toEqual([]);
    expect(lib.kandidaten({ zeilen: z1 }, nur("2026-01-16", 1), { heute }).kandidaten).toHaveLength(1);
    expect(lib.kandidaten({ zeilen: z1 }, nur("2026-02-15", 1), { heute }).kandidaten).toEqual([]);
    expect(lib.kandidaten({ zeilen: z1 }, nur("2026-02-16", 1), { heute }).kandidaten).toHaveLength(1);
  });

  it("Zeilen anderer Art im Register werden nirgends als Verfall gezählt", () => {
    const fremd = { id: "x-1", art: "umstellung", datum: "2026-01-01" };
    const e = lib.kandidaten({ zeilen: [fremd, ...z1] }, nur("2026-02-10", 0), { heute });
    expect(e.nichtMessbar).toEqual([]);
    expect(e.kandidaten).toHaveLength(1);
    const neu = lib.fehlendeZeilen({ zeilen: [{ id: "verfall-b", art: "umstellung" }], waechterPfade: ["test/harness/b.test.ts"], agentsText: "", heute });
    expect(neu[0].id).toBe("verfall-b-2");
    const alt = lib.fehlendeZeilen({ zeilen: [{ id: "u", art: "umstellung", ziel: "test/harness/b.test.ts" }], waechterPfade: ["test/harness/b.test.ts"], agentsText: "", heute });
    expect(alt).toHaveLength(1);
    expect(lib.pruefeAbdeckung({ zeilen: [{ id: "u", art: "umstellung", ziel: "test/harness/b.test.ts" }], waechterPfade: ["test/harness/b.test.ts"], agentsText: "" })).toHaveLength(1);
  });

  it("--generieren erhält Version und fremde Zeilen und hängt nur an", () => {
    const fremd = register().zeilen.find((z) => z.art !== "verfall") as Zeile;
    let geschrieben = "";
    skript.ausfuehren({ generieren: true, register: "r.json", exporte: [], heute }, {
      bezieher: false,
      lies: () => JSON.stringify({ version: 7, zeilen: [fremd, zeile("verfall-x", "test/harness/x.test.ts")] }),
      schreibe: (_p: string, t: string) => (geschrieben = t),
      waechter: () => ["test/harness/x.test.ts", "test/harness/y.test.ts"],
      agentsText: () => "",
    });
    const j = JSON.parse(geschrieben) as { version: number; zeilen: Zeile[] };
    expect(j.version).toBe(7);
    expect(j.zeilen.map((z) => z.id)).toEqual([fremd.id, "verfall-x", "verfall-y"]);
  });

  it("Ids: Umlaut und ß, Kürzung auf 40 Zeichen ohne Schluss-Bindestrich, Kollision bekommt eine freie Id, doppelte Titel nur einmal", () => {
    const text = "- **Größe über Maß:** a\n- **Größe über Mass:** b\n- **Größe über Maß.** c\n- **Eine sehr lange Regel mit vielen Worten drin damit gekürzt wird:** d\n";
    const neu = lib.fehlendeZeilen({ zeilen: [], waechterPfade: [], agentsText: text, heute });
    expect(neu.map((z) => z.id)).toEqual(["verfall-agents-grosse-uber-mass", "verfall-agents-grosse-uber-mass-2", "verfall-agents-eine-sehr-lange-regel-mit-vielen-worten"]);
    expect(neu.map((z) => z.ziel)).toEqual(["AGENTS.md#größe-über-maß", "AGENTS.md#größe-über-mass", "AGENTS.md#eine-sehr-lange-regel-mit-vielen-worten-drin-damit-gekürzt-wird"]);
    const mitBindestrich = lib.fehlendeZeilen({ zeilen: [], waechterPfade: [], agentsText: "- **Aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii x:** a\n", heute });
    expect(String(mitBindestrich[0].id)).toBe("verfall-agents-aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh");
  });

  it("pruefeAusnahmen meldet Einträge ohne ziel oder grund, ohne abzustürzen", () => {
    let aufrufe = 0;
    const m = lib.pruefeAusnahmen([{ grund: "x" }, { ziel: "a.md" }, null], () => {
      aufrufe += 1;
      return true;
    });
    expect(m).toHaveLength(3);
    expect(aufrufe).toBe(0);
  });

  it("ankerAus: Überschriften nur am Zeilenanfang mit Leerzeichen, Duplikate mit -1, fett markierte Regeln nur auf Wunsch", () => {
    const t = "# Eins\ntext ## kein Anker\n#hashtag\n# Eins\n- **Regel A:** x\nSatz - **kein Punkt**\n";
    expect([...lib.ankerAus(t)]).toEqual(["eins", "eins-1"]);
    expect([...lib.ankerAus(t, true)]).toEqual(["eins", "eins-1", "regel-a"]);
    expect(lib.fettRegeln(t).map((r) => r.anker)).toEqual(["regel-a"]);
    expect([...lib.ankerAus("## ⭐ Oberste Regel\n")]).toEqual(["-oberste-regel"]);
  });

  it("zielExistiert: ein fett markierter Titel zählt nur in AGENTS.md", () => {
    expect(skript.zielExistiert("AGENTS.md#kein-secret-key-im-agentenlauf")).toBe(true);
    expect(skript.zielExistiert("AGENTS.md#-assignee--sofort-weiter")).toBe(true);
    expect(skript.zielExistiert("README.md#kein-secret-key-im-agentenlauf")).toBe(false);
  });

  it("--kandidaten: Export und --heute wirken, --json gibt JSON, ungültige Zeilen und Exporte sind Exit 1, ein unbekanntes Flag Exit 2", () => {
    const reg = JSON.stringify({ version: 1, zeilen: [zeile("verfall-routine", ROUTINE)] });
    const export1 = JSON.stringify({ art: "fangquote-messpunkte", quelle: "gate-fundquote", punkte: [punkt(ROUTINE, "2026-02-10", "l1", 0)] });
    const lies = (p: string) => (p === "e.json" ? export1 : p === "kaputt.json" ? "{" : p === "falsch.json" ? JSON.stringify({ art: "x" }) : p === "reg-falsch.json" ? JSON.stringify({ version: 1, zeilen: [{ id: "a" }] }) : reg);
    const d = { bezieher: false, lies, heute: "2099-01-01" };
    const a = { kandidaten: true, register: "r.json", exporte: ["e.json"], heute: "2026-02-15", json: true };
    const r = skript.ausfuehren(a, d);
    expect(r.exitCode).toBe(0);
    expect((JSON.parse(r.text) as Ergebnis).kandidaten).toHaveLength(1);
    expect(skript.ausfuehren({ ...a, json: false }, d).text).toContain("Kandidaten (fällig, kein Fang im Fenster): 1");
    expect((JSON.parse(skript.ausfuehren({ ...a, heute: undefined }, d).text) as Ergebnis).kandidaten).toHaveLength(0); // heute aus den Abhängigkeiten (2099): Export liegt außerhalb des Fensters
    expect(skript.ausfuehren({ ...a, heute: "2026-01-15" }, d).text).toContain('"nichtFaellig": 1');
    expect(skript.ausfuehren({ ...a, exporte: ["kaputt.json"] }, d).exitCode).toBe(1);
    expect(skript.ausfuehren({ ...a, exporte: ["falsch.json"] }, d).exitCode).toBe(1);
    expect(skript.ausfuehren({ ...a, register: "reg-falsch.json" }, d).exitCode).toBe(1);
    expect(skript.ausfuehren(skript.parseArgs(["--kandidaten", "--unbekannt"]), d).exitCode).toBe(2);
    const p = skript.parseArgs(["--kandidaten"]) as unknown as { exporte: string[]; register: string };
    expect(p.exporte).toEqual([]);
    expect(p.register).toMatch(/aenderungsregister\.json$/);
  });
});

describe("Regel-Verfall: Streich-PR und Widerspruchsfrist (factory#610)", () => {
  const k: Kand = { id: "verfall-routine", ziel: ROUTINE, ablauf: "2026-01-31", laeufe: 4, faenge: 0 };
  const fenster = { von: "2026-01-17", bis: "2026-02-15" };

  it("Streich-Plan: Wächter-Datei wird gelöscht, ohne den Text zu brauchen", () => {
    expect(lib.streichPlan(ROUTINE)).toEqual({ aktion: "loeschen", pfad: ROUTINE });
  });

  it("Streich-Plan: die exakten Zeilen der Regel in AGENTS.md entfallen (Listenpunkt samt tiefer eingerückter Folgezeilen), Nachbarregeln bleiben", () => {
    const text = "# Kopf\n\n- **Eins:** a\n- **Zwei:** b\n  Fortsetzung von zwei\n  - Unterpunkt\n- **Drei:** c\n\nSchluss\n";
    const p = lib.streichPlan("AGENTS.md#zwei", text);
    expect(p.aktion).toBe("entfernen");
    expect(p.zeilen).toEqual(["- **Zwei:** b", "  Fortsetzung von zwei", "  - Unterpunkt"]);
    expect(p.neuerText).toBe("# Kopf\n\n- **Eins:** a\n- **Drei:** c\n\nSchluss\n");
  });

  it("Streich-Plan: nicht gefunden oder mehrdeutig ist kein Plan (nie geraten), ohne lesbare Datei ebenso", () => {
    expect(lib.streichPlan("AGENTS.md#nix", "- **Eins:** a\n").aktion).toBe("keine");
    expect(lib.streichPlan("AGENTS.md#eins", "- **Eins:** a\n- **Eins.** b\n").grund).toContain("mehrdeutig");
    expect(lib.streichPlan("AGENTS.md#eins", undefined).aktion).toBe("keine");
  });

  it("Streich-Plan: ein Überschriften-Abschnitt entfällt bis zur nächsten gleich- oder höherrangigen Überschrift, Unterabschnitte gehen mit", () => {
    const text = "# A\ntext\n## B\nb\n### B1\nb1\n## C\nc\n";
    const p = lib.streichPlan("docs/x.md#b", text);
    expect(p.neuerText).toBe("# A\ntext\n## C\nc\n");
    expect(p.zeilen).toEqual(["## B", "b", "### B1", "b1"]);
    expect(lib.streichPlan("docs/x.md#fehlt", text).aktion).toBe("keine");
  });

  it("Registerzeile wird auf gestrichen gesetzt, die übrigen bleiben; eine unbekannte Id wirft", () => {
    const r = lib.registerGestrichen({ zeilen: [zeile("verfall-routine", ROUTINE), zeile("verfall-b", "test/harness/b.test.ts")] }, "verfall-routine", "2026-02-15");
    expect(r.zeilen[0].gestrichen).toBe("2026-02-15");
    expect(r.zeilen[1].gestrichen).toBeUndefined();
    expect(() => lib.registerGestrichen({ zeilen: [] }, "verfall-x", "2026-02-15")).toThrow();
  });

  it("eine gestrichene Zeile ist nie wieder Kandidat und das Schema nimmt das Feld an", () => {
    const e = lib.kandidaten({ zeilen: [zeile("verfall-routine", ROUTINE, { gestrichen: "2026-02-15" })] }, [{ punkte: [punkt(ROUTINE, "2026-02-10", "l1", 0)] }], { heute: "2026-03-15" });
    expect(e.kandidaten).toEqual([]);
    expect(e.nichtMessbar).toEqual([]);
    const reg = skript.ausfuehren({ generieren: true, trocken: true, register: "r.json", exporte: [] }, { bezieher: false, lies: () => JSON.stringify({ version: 1, zeilen: [zeile("verfall-routine", ROUTINE, { gestrichen: "2026-02-15" })] }), waechter: () => [], agentsText: () => "" });
    expect(reg.exitCode).toBe(0);
    const falsch = skript.ausfuehren({ generieren: true, trocken: true, register: "r.json", exporte: [] }, { bezieher: false, lies: () => JSON.stringify({ version: 1, zeilen: [zeile("verfall-routine", ROUTINE, { gestrichen: "gestern" })] }), waechter: () => [], agentsText: () => "" });
    expect(falsch.exitCode).toBe(1);
  });

  it("Negativfall: für ein Ziel der Sicherheits-Ausnahmeliste entsteht nie ein PR, auch nicht als gelieferter Kandidat (Red-Green)", () => {
    const schutz: Kand = { ...k, id: "verfall-schutz", ziel: SCHUTZ };
    const p = lib.planeStreichPRs([schutz, k], []);
    expect(p.neu.map((x) => x.id)).toEqual(["verfall-routine"]);
    expect(p.uebersprungen).toEqual([{ id: "verfall-schutz", grund: "Sicherheits-Ausnahme" }]);
    expect(lib.planeStreichPRs([schutz], [], { ausnahmen: [] }).neu).toHaveLength(1); // Gegenprobe
  });

  it("Negativfall: ist für die Registerzeile schon ein Streich-PR offen (Branch oder Marker), entsteht kein zweiter (Red-Green)", () => {
    expect(lib.planeStreichPRs([k], [{ headRefName: lib.streichBranch(k.id) }]).neu).toEqual([]);
    expect(lib.planeStreichPRs([k], [{ headRefName: "anders", body: `text ${lib.streichMarker(k.id)}` }]).uebersprungen[0].grund).toBe("Streich-PR schon offen");
    expect(lib.planeStreichPRs([k], [{ headRefName: "verfall/streich-andere-id", body: lib.streichMarker("andere-id") }]).neu).toHaveLength(1);
    expect(lib.streichMarker("a")).not.toBe(lib.streichMarker("ab"));
  });

  it("der PR-Text trägt Fangquote, Fenster, Rohwerte, Frist, Widerspruchsweg, Marker und Umkehr", () => {
    const t = lib.streichText(k, { fenster, heute: "2026-02-15", plan: { aktion: "loeschen", pfad: ROUTINE } });
    expect(t.body).toContain(lib.streichMarker(k.id));
    expect(t.body).toContain("0 Fänge in 4 Läufen");
    expect(t.body).toContain("2026-01-17 bis 2026-02-15");
    expect(t.body).toContain("laeufe 4, faenge 0");
    expect(t.body).toContain("bis 2026-03-01");
    expect(t.body).toContain(lib.WIDERSPRUCH_LABEL);
    expect(t.body).toContain("gestrichen: 2026-02-15");
    expect(t.body).toContain("Revert");
    expect(t.titel).toContain(ROUTINE);
    expect(lib.streichText(k, { fenster, heute: "2026-02-15", plan: { aktion: "entfernen", pfad: "AGENTS.md", zeilen: ["a", "b"] } }).body).toContain("2 Zeile(n)");
  });

  describe("Merge-Entscheidung", () => {
    const jetzt = new Date("2026-03-01T12:00:00Z");
    const alt = "2026-02-15T12:00:00Z"; // genau 14 Tage vorher
    const gruen = [{ name: "verify", bucket: "pass" }, { name: "lint", bucket: "skipping" }];
    const teile = [{ vertraut: true, text: "PR-Body" }];
    const basis = { labels: [lib.STREICH_LABEL], teile, checks: gruen, angelegt: alt, jetzt };

    it("alle drei Bedingungen erfüllt mergt", () => {
      expect(lib.mergeEntscheidung(basis).merge).toBe(true);
    });

    it("Negativfall: Label status:widerspruch verhindert den Merge (Red-Green)", () => {
      expect(lib.mergeEntscheidung({ ...basis, labels: [lib.STREICH_LABEL, "status:widerspruch"] })).toEqual({ merge: false, grund: "Widerspruch" });
    });

    it("Negativfall: der Kommentar einer vertrauten Person ist Widerspruch, ein Kommentar eines Fremden, ein leerer Kommentar und der PR-Body nicht", () => {
      expect(lib.mergeEntscheidung({ ...basis, teile: [...teile, { vertraut: true, text: "Bitte nicht streichen" }] }).merge).toBe(false);
      expect(lib.hatWiderspruch([], [...teile, { vertraut: false, text: "[Fremdtext ausgeblendet: Kommentar von @x, u]" }])).toBe(false);
      expect(lib.hatWiderspruch([], [...teile, { vertraut: true, text: "  " }])).toBe(false);
      expect(lib.hatWiderspruch([], [{ vertraut: true, text: "Body mit Text" }])).toBe(false);
    });

    it("Negativfall: ein roter, offener oder nicht lesbarer Check verhindert den Merge (Red-Green)", () => {
      for (const checks of [[...gruen, { name: "x", bucket: "fail" }], [...gruen, { name: "x", bucket: "pending" }], [...gruen, { name: "x", bucket: "cancel" }], [], null, undefined, "kaputt"]) {
        expect(lib.mergeEntscheidung({ ...basis, checks }), JSON.stringify(checks)).toEqual({ merge: false, grund: "Required Checks nicht grün" });
      }
      expect(lib.checksGruen(gruen)).toBe(true);
    });

    it("Frist: 14 Tage sind genau abgelaufen, eine Sekunde davor nicht, ein kaputtes Datum nie", () => {
      expect(lib.fristAbgelaufen(alt, jetzt)).toBe(true);
      expect(lib.fristAbgelaufen("2026-02-15T12:00:01Z", jetzt)).toBe(false);
      expect(lib.fristAbgelaufen("morgen", jetzt)).toBe(false);
      expect(lib.mergeEntscheidung({ ...basis, angelegt: "2026-02-20T00:00:00Z" }).grund).toContain("Frist");
    });

    it("Widerspruch geht vor Frist und Checks", () => {
      expect(lib.mergeEntscheidung({ ...basis, labels: ["status:widerspruch"], checks: [], angelegt: "2026-02-28T00:00:00Z" }).grund).toBe("Widerspruch");
    });
  });

  describe("Skript --streich-pr und --faellige-mergen", () => {
    const reg = JSON.stringify({ version: 1, zeilen: [zeile("verfall-routine", ROUTINE), zeile("verfall-schutz", SCHUTZ)] });
    const exportDatei = JSON.stringify({ art: "fangquote-messpunkte", quelle: "gate-fundquote", punkte: [punkt(ROUTINE, "2026-02-10", "l1", 0), punkt(SCHUTZ, "2026-02-10", "l1", 0)] });
    const lies = (p: string) => (p === "e.json" ? exportDatei : reg);
    const streichArgs = { streichPr: true, register: "r.json", exporte: ["e.json"], heute: "2026-02-15" };

    it("legt je Kandidat einen PR an, die Sicherheits-Ausnahme nie; --trocken legt nichts an", () => {
      const angelegt: string[] = [];
      const d = { bezieher: false, lies, gh: () => "[]", streichAnlegen: (kand: Kand) => (angelegt.push(kand.id), "https://pr/1") };
      const r = skript.ausfuehren(streichArgs, d);
      expect(r.exitCode).toBe(0);
      expect(angelegt).toEqual(["verfall-routine"]);
      expect(r.text).toContain("https://pr/1");
      expect(skript.ausfuehren({ ...streichArgs, trocken: true }, { ...d, streichAnlegen: () => { throw new Error("darf nicht"); } }).text).toContain("Trocken");
    });

    it("offener Streich-PR: kein zweiter; Fehler eines Kandidaten ist Exit 1", () => {
      const offen = JSON.stringify([{ number: 5, headRefName: "verfall/streich-verfall-routine", body: "" }]);
      const r = skript.ausfuehren(streichArgs, { bezieher: false, lies, gh: () => offen, streichAnlegen: () => { throw new Error("darf nicht"); } });
      expect(r.exitCode).toBe(0);
      expect(r.text).toContain("Streich-PR schon offen");
      const fehler = skript.ausfuehren(streichArgs, { bezieher: false, lies, gh: () => "[]", streichAnlegen: () => { throw new Error("push abgelehnt"); } });
      expect(fehler.exitCode).toBe(1);
      expect(fehler.text).toContain("push abgelehnt");
    });

    const prs = (labels: string[], createdAt = "2026-02-01T00:00:00Z") => JSON.stringify([{ number: 7, createdAt, labels: labels.map((name) => ({ name })) }]);
    const mergeD = (liste: string, extra: Record<string, unknown> = {}) => {
      const gh: string[][] = [];
      return { gh, d: { bezieher: false, jetzt: () => new Date("2026-03-01T00:00:00Z"), gh: (a: string[]) => (gh.push(a), a[1] === "list" ? liste : ""), fremdtext: () => [{ vertraut: true, text: "Body" }], checks: () => [{ bucket: "pass" }], ...extra } };
    };
    const gemergt = (gh: string[][]) => gh.some((a) => a[1] === "merge");

    it("--faellige-mergen mergt nur bei Frist, ohne Widerspruch und mit grünen Checks", () => {
      const ok = mergeD(prs([lib.STREICH_LABEL]));
      const r = skript.ausfuehren({ faelligeMergen: true }, ok.d);
      expect(r.exitCode).toBe(0);
      expect(gemergt(ok.gh)).toBe(true);
      expect(ok.gh.find((a) => a[1] === "merge")).toEqual(["pr", "merge", "7", "--squash", "--delete-branch"]);
      const trocken = mergeD(prs([lib.STREICH_LABEL]));
      expect(skript.ausfuehren({ faelligeMergen: true, trocken: true }, trocken.d).text).toContain("Trocken");
      expect(gemergt(trocken.gh)).toBe(false);
    });

    it("Negativfälle: Widerspruch (Label oder vertrauter Kommentar), roter Check, junge Frist und Lesefehler mergen nie (Red-Green)", () => {
      const faelle: [string, ReturnType<typeof mergeD>][] = [
        ["Label", mergeD(prs([lib.STREICH_LABEL, "status:widerspruch"]))],
        ["Kommentar", mergeD(prs([lib.STREICH_LABEL]), { fremdtext: () => [{ vertraut: true, text: "Body" }, { vertraut: true, text: "nein" }] })],
        ["rot", mergeD(prs([lib.STREICH_LABEL]), { checks: () => [{ bucket: "pass" }, { bucket: "fail" }] })],
        ["jung", mergeD(prs([lib.STREICH_LABEL], "2026-02-25T00:00:00Z"))],
        ["Fremdtext-Fehler", mergeD(prs([lib.STREICH_LABEL]), { fremdtext: () => { throw new Error("gh weg"); } })],
        ["Checks unlesbar", mergeD(prs([lib.STREICH_LABEL]), { checks: () => null })],
      ];
      for (const [name, f] of faelle) {
        const r = skript.ausfuehren({ faelligeMergen: true }, f.d);
        expect(gemergt(f.gh), name).toBe(false);
        expect(r.text, name).toContain("nicht gemergt");
      }
    });

    it("das Skript ruft den Streich-Merge nicht aus einem Workflow auf (kein GITHUB_TOKEN-Lauf, der keine CI startet)", () => {
      const workflows = readdirSync(join(WURZEL, ".github", "workflows")).map((n) => lies2(join(".github", "workflows", n)));
      expect(workflows.filter((t) => t.includes("regel-verfall.mjs"))).toEqual([]);
    });
  });
});
const lies2 = (p: string) => readFileSync(join(WURZEL, p), "utf8");
