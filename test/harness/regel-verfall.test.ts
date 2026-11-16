/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#608, Regel-Verfall 2/4 von factory#517). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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
};
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
    expect(verfallZeilen().filter((z) => !skript.zielExistiert(String(z.ziel))).map((z) => `${String(z.id)}: ${String(z.ziel)}`)).toEqual([]);
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
