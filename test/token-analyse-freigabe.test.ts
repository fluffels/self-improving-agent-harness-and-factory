/* Token-Analyse Teil 5/9 (factory#518): Freigabeliste, Allowlist, Ablage, Analyse-Schnappschuss. Alle Fixtures im Temp-Ordner, kein gh, kein echter Lauf. */
import { describe, expect, test } from "vitest";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "./support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/token-analyse-freigabe-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawCli from "../scripts/token-analyse-freigabe.mjs";

type Pruefung = { ok: boolean; grund: string };
const lib = rawLib as unknown as {
  parseFreigabeliste: (t: string) => string[];
  remoteEigentuemer: (t: string) => string | null;
  pruefeBezieher: (a: { istCheckout: boolean; eigentuemer: string | null; login: string | null }) => Pruefung;
  pruefeBefehl: (argv: unknown, o: { wurzel: string; real?: (p: string) => string }) => Pruefung;
  befehlMitSchutz: (argv: string[]) => string[];
  liegtUnter: (p: string, w: string[]) => boolean;
  pruefeAblage: (a: { ablage: string; repoWurzel: string; worktrees?: string[]; bezieherWurzeln?: string[]; art?: string }) => Pruefung;
  enthaeltNamen: (t: string, p: string[]) => boolean;
  letzterSchnappschuss: (n: string[]) => string | null;
  schnappschussName: (d: string, n: string[]) => string;
  schnappschussMarkdown: (a: { datum: string; anzahlBezieher: number; kennzahlen: Record<string, number | null>; vorher: unknown }) => string;
  bezieherLabel: (k: number) => string;
};
type Ergebnis = { code: number; zeilen: string[]; freigegeben?: { k: number; wurzel: string }[] };
const cli = rawCli as unknown as {
  realMitVorfahr: (p: string) => string;
  cli: (argv: string[], env: Record<string, string | undefined>, deps: Record<string, unknown>) => Ergebnis;
  pruefen: (env: Record<string, string | undefined>, deps: Record<string, unknown>) => Ergebnis;
  fuehreFreigegebenAus: (k: number, argv: string[], f: { k: number; wurzel: string }[], d: Record<string, unknown>) => Record<string, unknown>;
};

const checkout = (owner: string) => `[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:${owner}/x.git\n`;

/** Fabrik-Repo, zwei Checkouts („geheim-alpha“ gehört dem Konto, „geheim-beta“ nicht), Liste mit alpha und beta-fremd. */
function welt(liste: (wurzeln: Record<string, string>) => string, extra: Record<string, string> = {}) {
  const root = realpathSync(fixture({ "repo/a.txt": "x", "alpha/geheim-alpha/.git/config": checkout("ich"), "alpha/geheim-alpha/a.txt": "1\n2\n", "alpha/geheim-beta/.git/config": checkout("fremd"), "alpha/geheim-gamma/.git/config": checkout("ich"), ...extra }));
  const w = { repo: join(root, "repo"), alpha: join(root, "alpha", "geheim-alpha"), beta: join(root, "alpha", "geheim-beta"), gamma: join(root, "alpha", "geheim-gamma"), root };
  const freigabe = join(root, "privat", "freigabe.txt");
  mkdirSync(join(root, "privat"), { recursive: true });
  writeFileSync(freigabe, liste(w));
  const env = { FACTORY_ANALYSE_FREIGABE: freigabe, FACTORY_ANALYSE_ABLAGE: join(root, "privat", "ablage") };
  const deps = { repoWurzel: w.repo, worktrees: [], login: "Ich" };
  return { w, env, deps, root };
}

describe("Freigabeliste und Remote-Eigentümer", () => {
  test("parseFreigabeliste: Kommentare, Leerzeilen, Dubletten; relativer Pfad wirft ohne den Pfad zu nennen", () => {
    expect(lib.parseFreigabeliste("# kopf\n\n/a/b  # ende\n/a/b\n/c\n")).toEqual(["/a/b", "/c"]);
    expect(() => lib.parseFreigabeliste("/a\nrelativ/x\n")).toThrow(/Zeile 2/);
    expect(() => lib.parseFreigabeliste("relativ/x\n")).not.toThrow(/relativ/);
  });
  test("remoteEigentuemer: https, scp-artig, ssh; fremder Host, ohne origin, kaputt", () => {
    const cfg = (u: string, name = "origin") => `[remote "${name}"]\n\turl = ${u}\n`;
    expect(lib.remoteEigentuemer(cfg("https://github.com/Eig/x.git"))).toBe("Eig");
    expect(lib.remoteEigentuemer(cfg("https://tok@github.com/Eig/x.git"))).toBe("Eig");
    expect(lib.remoteEigentuemer(cfg("git@github.com:Eig/x.git"))).toBe("Eig");
    expect(lib.remoteEigentuemer(cfg("ssh://git@github.com/Eig/x.git"))).toBe("Eig");
    expect(lib.remoteEigentuemer(cfg("https://gitlab.com/Eig/x.git"))).toBeNull();
    expect(lib.remoteEigentuemer(cfg("git@github.com:Eig/x.git", "upstream"))).toBeNull();
    expect(lib.remoteEigentuemer("[remote \"origin\"\nkaputt")).toBeNull();
    expect(lib.remoteEigentuemer(undefined as unknown as string)).toBeNull();
  });
  test("pruefeBezieher: Groß-/Kleinschreibung egal, sonst fail-closed ohne Namen in der Meldung", () => {
    expect(lib.pruefeBezieher({ istCheckout: true, eigentuemer: "Ich", login: "ich" }).ok).toBe(true);
    for (const a of [
      { istCheckout: false, eigentuemer: "ich", login: "ich" },
      { istCheckout: true, eigentuemer: null, login: "ich" },
      { istCheckout: true, eigentuemer: "ich", login: null },
      { istCheckout: true, eigentuemer: "fremd", login: "ich" },
    ]) {
      const p = lib.pruefeBezieher(a);
      expect(p.ok).toBe(false);
      expect(p.grund).not.toMatch(/fremd/);
    }
  });
});

describe("Allowlist lesender Befehle", () => {
  const real = cli.realMitVorfahr;
  const aufbau = () => {
    const s = welt((w) => `${w.alpha}\n`);
    const wurzel = s.w.alpha;
    return { s, wurzel, pr: (argv: unknown) => lib.pruefeBefehl(argv, { wurzel, real }) };
  };
  test("erlaubt: git log/ls-files/show mit -C auf die Wurzel, wc mit Datei darunter", () => {
    const { wurzel, pr } = aufbau();
    expect(pr(["git", "-C", wurzel, "log", "--oneline"]).ok).toBe(true);
    expect(pr(["git", "-C", wurzel, "ls-files"]).ok).toBe(true);
    expect(pr(["git", "-C", wurzel, "show", "HEAD:a.txt"]).ok).toBe(true);
    expect(pr(["wc", "-l", "a.txt"]).ok).toBe(true);
    expect(pr(["wc", "-l", join(wurzel, "a.txt")]).ok).toBe(true);
  });
  const faelle = (wurzel: string, beta: string): [string, unknown][] => [
    ["fetch", ["git", "-C", wurzel, "fetch"]],
    ["status", ["git", "-C", wurzel, "status"]],
    ["remote", ["git", "-C", wurzel, "remote", "-v"]],
    ["config", ["git", "-C", wurzel, "config", "--list"]],
    ["worktree", ["git", "-C", wurzel, "worktree", "list"]],
    ["log --output", ["git", "-C", wurzel, "log", "--output=x"]],
    ["log -o", ["git", "-C", wurzel, "log", "-o"]],
    ["-c nach Unterbefehl", ["git", "-C", wurzel, "log", "-c", "core.pager=x"]],
    ["--ext-diff", ["git", "-C", wurzel, "show", "--ext-diff"]],
    ["--textconv", ["git", "-C", wurzel, "show", "--textconv"]],
    ["-O Orderfile", ["git", "-C", wurzel, "log", "-p", "-O/etc/passwd"]],
    ["-c vor -C", ["git", "-c", "core.pager=x", "-C", wurzel, "log"]],
    ["ohne -C", ["git", "log"]],
    ["fremde Wurzel", ["git", "-C", beta, "log"]],
    ["wc ../außen", ["wc", "-l", "../geheim-beta/.git/config"]],
    ["wc ohne Datei", ["wc", "-l"]],
    ["wc fremde Option", ["wc", "--files0-from=x", "a.txt"]],
    ["anderes Programm", ["cat", "a.txt"]],
    ["kein argv", []],
    ["kein String", ["git", 1]],
    ["kein Array", "git log"],
  ];
  test("abgelehnt: jede verbotene Form", () => {
    const { s, wurzel, pr } = aufbau();
    for (const [n, argv] of faelle(wurzel, s.w.beta)) expect([n, pr(argv).ok]).toEqual([n, false]);
  });
  test("wc über Symlink nach draußen wird abgelehnt", () => {
    const { s, wurzel, pr } = aufbau();
    symlinkSync(join(s.w.beta, ".git", "config"), join(wurzel, "flucht"));
    expect(pr(["wc", "-l", "flucht"]).ok).toBe(false);
  });
  test("befehlMitSchutz setzt das feste Präfix, bei ls-files ohne Diff-Optionen", () => {
    expect(lib.befehlMitSchutz(["git", "-C", "/w", "log", "-1"])).toEqual(["git", "--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", "/w", "log", "--no-ext-diff", "--no-textconv", "-1"]);
    expect(lib.befehlMitSchutz(["git", "-C", "/w", "ls-files"])).not.toContain("--no-textconv");
    expect(lib.befehlMitSchutz(["wc", "-l", "a"])).toEqual(["wc", "-l", "a"]);
  });
  test("liegtUnter: Wurzel selbst und Kind ja, Geschwister mit gleichem Präfix und Elternteil nein", () => {
    expect(lib.liegtUnter("/a/b", ["/a/b"])).toBe(true);
    expect(lib.liegtUnter("/a/b/c", ["/a/b"])).toBe(true);
    expect(lib.liegtUnter("/a/bc", ["/a/b"])).toBe(false);
    expect(lib.liegtUnter("/a", ["/a/b"])).toBe(false);
  });
});

describe("Ausführung nur für Freigegebene", () => {
  test("ein Bezieher außerhalb der Freigabe wird nie gelesen: kein Prozess, nur die Ablehnung", () => {
    const s = welt((w) => `${w.alpha}\n`);
    const aufrufe: string[][] = [];
    const runner = (argv: string[]) => (aufrufe.push(argv), { status: 0, stdout: "", stderr: "" });
    const p = cli.pruefen(s.env, s.deps);
    expect(p.freigegeben).toEqual([{ k: 1, wurzel: s.w.alpha }]);
    const nichtListe = cli.fuehreFreigegebenAus(2, ["git", "-C", s.w.gamma, "log"], p.freigegeben!, { runner });
    expect(nichtListe.abgelehnt).toMatch(/Bezieher 2 nicht freigegeben/);
    const fremdeWurzel = cli.fuehreFreigegebenAus(1, ["git", "-C", s.w.gamma, "log"], p.freigegeben!, { runner });
    expect(fremdeWurzel.abgelehnt).toBeTruthy();
    expect(aufrufe).toEqual([]);
    expect(JSON.stringify([p.zeilen, nichtListe, fremdeWurzel])).not.toMatch(/geheim/);
  });
  test("ein erlaubter Befehl läuft mit Schutz-Präfix und im Bezieher-Verzeichnis", () => {
    const s = welt((w) => `${w.alpha}\n`);
    const p = cli.pruefen(s.env, s.deps);
    const aufrufe: { argv: string[]; cwd?: string }[] = [];
    const runner = (argv: string[], o: { cwd?: string }) => (aufrufe.push({ argv, cwd: o.cwd }), { status: 0, stdout: "ok", stderr: "" });
    const r = cli.fuehreFreigegebenAus(1, ["git", "-C", s.w.alpha, "log", "-1"], p.freigegeben!, { runner });
    expect(r.stdout).toBe("ok");
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0].argv.slice(0, 6)).toEqual(["git", "--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"]);
    expect(aufrufe[0].cwd).toBe(s.w.alpha);
  });
  test("der Standard-Runner startet ohne Shell mit Schutz-Umgebung (wc auf eine Fixture-Datei)", () => {
    const s = welt((w) => `${w.alpha}\n`);
    const p = cli.pruefen(s.env, s.deps);
    const r = cli.fuehreFreigegebenAus(1, ["wc", "-l", "a.txt"], p.freigegeben!, {}) as { status: number; stdout: string };
    expect(r.status).toBe(0);
    expect(r.stdout.trim().startsWith("2")).toBe(true);
  });
});

describe("pruefen (CLI-Logik)", () => {
  test("fehlende Liste: Hinweis, Exit 0, nichts gelesen (Variable leer, Datei fehlt)", () => {
    const s = welt((w) => `${w.alpha}\n`);
    for (const env of [{ FACTORY_ANALYSE_ABLAGE: s.env.FACTORY_ANALYSE_ABLAGE }, { ...s.env, FACTORY_ANALYSE_FREIGABE: join(s.root, "nicht-da.txt") }]) {
      const r = cli.pruefen(env, s.deps);
      expect(r.code).toBe(0);
      expect(r.zeilen[0]).toMatch(/^Hinweis: Teil 6 entfällt/);
      expect(r.freigegeben).toEqual([]);
    }
  });
  test("fremder Remote-Eigentümer und Nicht-Checkout brechen je Verzeichnis ab, die übrigen laufen weiter; keine Namen in der Ausgabe", () => {
    const s = welt((w) => `${w.alpha}\n${w.beta}\n${join(w.root, "geheim-leer")}\n${w.gamma}\n`);
    const r = cli.pruefen(s.env, s.deps);
    expect(r.code).toBe(0);
    expect(r.zeilen).toEqual([
      "Bezieher 1: freigegeben",
      "Bezieher 2: abgebrochen (Remote-Eigentümer passt nicht zum angemeldeten Konto)",
      "Bezieher 3: abgebrochen (kein Git-Checkout)",
      "Bezieher 4: freigegeben",
    ]);
    expect(r.zeilen.join()).not.toMatch(/geheim/);
    expect(r.freigegeben!.map((f) => f.k)).toEqual([1, 4]);
  });
  test("ohne angemeldetes Konto entfällt Teil 6 mit Hinweis (kein Rückfall auf den Eigentümer)", () => {
    const s = welt((w) => `${w.alpha}\n`);
    const r = cli.pruefen(s.env, { ...s.deps, login: null });
    expect(r.zeilen[0]).toMatch(/Konto nicht ermittelbar/);
    expect(r.freigegeben).toEqual([]);
  });
  test("kaputte Liste und Ablage-Fehler: Exit 1", () => {
    const s = welt(() => "relativ/pfad\n");
    expect(cli.pruefen(s.env, s.deps).code).toBe(1);
    const t = welt((w) => `${w.alpha}\n`);
    expect(cli.pruefen({ FACTORY_ANALYSE_FREIGABE: t.env.FACTORY_ANALYSE_FREIGABE }, t.deps).code).toBe(1);
  });
  test("eine Freigabeliste im Repo wird abgelehnt", () => {
    const s = welt((w) => `${w.alpha}\n`);
    const imRepo = join(s.w.repo, "liste.txt");
    writeFileSync(imRepo, `${s.w.alpha}\n`);
    const r = cli.pruefen({ ...s.env, FACTORY_ANALYSE_FREIGABE: imRepo }, s.deps);
    expect(r.code).toBe(1);
    expect(r.zeilen[0]).toMatch(/Freigabeliste liegt im Repo/);
  });
  test("Worktree-Datei als .git: der Eigentümer kommt aus der gemeinsamen Konfiguration", () => {
    const s = welt((w) => `${join(w.root, "wt")}\n`, { "haupt/.git/config": checkout("ich"), "haupt/.git/worktrees/wt/commondir": "../..\n", "wt/.git": "gitdir: ../haupt/.git/worktrees/wt\n" });
    expect(cli.pruefen(s.env, s.deps).zeilen).toEqual(["Bezieher 1: freigegeben"]);
  });
});

describe("Ablage", () => {
  const eingabe = (root: string, k: Record<string, number | null> = { "Bezieher 1: Dateien": 3, Gesamtkosten: 10 }, datum = "2026-11-16") => {
    const p = join(root, "eingabe.json");
    writeFileSync(p, JSON.stringify({ datum, anzahlBezieher: 1, kennzahlen: k }));
    return p;
  };
  const listing = (root: string) => readdirSync(root, { recursive: true }).map(String).sort();

  test.each([
    ["im Repo", (w: Record<string, string>) => join(w.repo, "ablage")],
    ["in einem Worktree", (w: Record<string, string>) => join(w.root, "wt-x", "ablage")],
    ["in einem Bezieher", (w: Record<string, string>) => join(w.alpha, "ablage")],
  ])("Ablage %s: Exit 1, nichts geschrieben", (_n, wo) => {
    const s = welt((w) => `${w.alpha}\n`, { "wt-x/a.txt": "x" });
    const ablage = wo(s.w);
    const vorher = listing(s.root);
    const r = cli.cli(["ablegen", "--eingabe", eingabe(s.root)], { ...s.env, FACTORY_ANALYSE_ABLAGE: ablage }, { ...s.deps, worktrees: [join(s.w.root, "wt-x")] });
    expect(r.code).toBe(1);
    expect(listing(s.root)).toEqual([...vorher, "eingabe.json"].sort());
    expect(existsSync(ablage)).toBe(false);
  });
  test("Ablage über einen Symlink ins Repo wird abgelehnt", () => {
    const s = welt((w) => `${w.alpha}\n`);
    symlinkSync(s.w.repo, join(s.root, "link"));
    const r = cli.cli(["ablegen", "--eingabe", eingabe(s.root)], { ...s.env, FACTORY_ANALYSE_ABLAGE: join(s.root, "link", "neu") }, s.deps);
    expect(r.code).toBe(1);
    expect(existsSync(join(s.w.repo, "neu"))).toBe(false);
  });
  test("ohne FACTORY_ANALYSE_ABLAGE: Exit 1", () => {
    const s = welt((w) => `${w.alpha}\n`);
    expect(cli.cli(["ablegen", "--eingabe", eingabe(s.root)], { FACTORY_ANALYSE_FREIGABE: s.env.FACTORY_ANALYSE_FREIGABE }, s.deps).code).toBe(1);
  });
  test("zweimal am selben Tag: erster Schnappschuss, dann Vorher/Nachher; Dateiname -2", () => {
    const s = welt((w) => `${w.alpha}\n`);
    expect(cli.cli(["ablegen", "--eingabe", eingabe(s.root)], s.env, s.deps).zeilen).toEqual(["Analyse-Schnappschuss abgelegt: analyse-2026-11-16"]);
    const zweit = cli.cli(["ablegen", "--eingabe", eingabe(s.root, { "Bezieher 1: Dateien": 5, Gesamtkosten: 8 })], s.env, s.deps);
    expect(zweit.zeilen).toEqual(["Analyse-Schnappschuss abgelegt: analyse-2026-11-16-2"]);
    const md = readFileSync(join(s.root, "privat", "ablage", "analyse-2026-11-16-2.md"), "utf8");
    expect(md).toContain("| Gesamtkosten | 10 | 8 | -2 |");
    expect(md).toContain("| Bezieher 1: Dateien | 3 | 5 | +2 |");
    expect(readFileSync(join(s.root, "privat", "ablage", "analyse-2026-11-16.md"), "utf8")).toContain("erster Schnappschuss");
  });
  test("ein Verzeichnisname aus der Liste in den Kennzahlen: Abbruch, nichts geschrieben", () => {
    const s = welt((w) => `${w.alpha}\n`);
    const r = cli.cli(["ablegen", "--eingabe", eingabe(s.root, { "geheim-alpha: Dateien": 3 })], s.env, s.deps);
    expect(r.code).toBe(1);
    expect(r.zeilen.join()).not.toMatch(/geheim/);
    expect(existsSync(join(s.root, "privat", "ablage", "analyse-2026-11-16.json"))).toBe(false);
  });
  test("ungültige Eingabe: Exit 2", () => {
    const s = welt((w) => `${w.alpha}\n`);
    const p = join(s.root, "kaputt.json");
    writeFileSync(p, "{");
    expect(cli.cli(["ablegen", "--eingabe", p], s.env, s.deps).code).toBe(2);
    writeFileSync(p, JSON.stringify({ kennzahlen: [] }));
    expect(cli.cli(["ablegen", "--eingabe", p], s.env, s.deps).code).toBe(2);
  });
});

describe("Aufruf und Bezieher-Sperre", () => {
  test("im Bezieher-Fixture (Sync-Stand vorhanden) bricht die CLI mit Exit 2 ab, ohne zu lesen", () => {
    const s = welt((w) => `${w.alpha}\n`, { "repo/.factory/sync-stand.json": "{}" });
    const r = cli.cli(["pruefen"], s.env, s.deps);
    expect(r.code).toBe(2);
    expect(r.zeilen[0]).toMatch(/nur in der Fabrik/);
  });
  test("falscher Aufruf: Exit 2 mit Usage", () => {
    const s = welt((w) => `${w.alpha}\n`);
    for (const argv of [[], ["pruefen", "x"], ["ablegen"], ["ablegen", "--eingabe"], ["ablegen", "x", "y"]]) expect(cli.cli(argv, s.env, s.deps).code).toBe(2);
  });
});

describe("Analyse-Schnappschuss (Format)", () => {
  const md = (kennzahlen: Record<string, number | null>, vorher: unknown, anzahl = 1) => lib.schnappschussMarkdown({ datum: "2026-11-16", anzahlBezieher: anzahl, kennzahlen, vorher });
  test("Vorher/Nachher mit Änderung, Lücke statt 0, Vorgänger-only-Zeile bleibt sichtbar", () => {
    const vorher = { anzahlBezieher: 1, kennzahlen: { A: 4, B: null, Alt: 2 } };
    const t = md({ A: 6, B: 3, C: null }, vorher);
    expect(t.split("\n")[0]).toBe("# Analyse-Schnappschuss 2026-11-16");
    expect(t).toContain("| Messgröße | Vorher | Nachher | Änderung |");
    expect(t).toContain("| A | 4 | 6 | +2 |");
    expect(t).toContain("| B | Lücke | 3 | Lücke |");
    expect(t).toContain("| C | Lücke | Lücke | Lücke |");
    expect(t).toContain("| Alt | 2 | Lücke | Lücke |");
    expect(md({ A: 4 }, vorher)).toContain("| A | 4 | 4 | 0 |");
  });
  test("geänderte Anzahl der Bezieher macht deren Zeilen zur Lücke, andere Zeilen nicht", () => {
    const vorher = { anzahlBezieher: 1, kennzahlen: { "Bezieher 1: X": 5, Kosten: 9 } };
    const t = md({ "Bezieher 1: X": 6, Kosten: 9 }, vorher, 2);
    expect(t).toContain("| Bezieher 1: X | Lücke | 6 | Lücke |");
    expect(t).toContain("| Kosten | 9 | 9 | 0 |");
  });
  test("ohne Vorgänger: erster Schnappschuss", () => {
    expect(md({ A: 1 }, null)).toContain("| A | erster Schnappschuss | 1 | – |");
  });
  test("letzterSchnappschuss und schnappschussName: Datum, Laufnummer, fremde Dateien ignoriert", () => {
    const n = ["analyse-2026-11-15.json", "analyse-2026-11-16.json", "analyse-2026-11-16-2.json", "analyse-2026-11-16-10.json", "analyse-2026-11-16.md", "notiz.json"];
    expect(lib.letzterSchnappschuss(n)).toBe("analyse-2026-11-16-10.json");
    expect(lib.letzterSchnappschuss(["x.json"])).toBeNull();
    expect(lib.schnappschussName("2026-11-17", n)).toBe("analyse-2026-11-17");
    expect(lib.schnappschussName("2026-11-16", n)).toBe("analyse-2026-11-16-11");
    expect(lib.schnappschussName("2026-11-15", n)).toBe("analyse-2026-11-15-2");
    expect(() => lib.schnappschussName("heute", n)).toThrow();
  });
  test("pruefeAblage ohne absoluten Pfad, enthaeltNamen und bezieherLabel", () => {
    expect(lib.pruefeAblage({ ablage: "rel", repoWurzel: "/r" }).ok).toBe(false);
    expect(lib.pruefeAblage({ ablage: "/außen/x", repoWurzel: "/r" }).ok).toBe(true);
    expect(lib.enthaeltNamen("Hat NameX drin", ["/a/namex/"])).toBe(true);
    expect(lib.enthaeltNamen("sauber", ["/a/namex"])).toBe(false);
    expect(lib.bezieherLabel(3)).toBe("Bezieher 3");
  });
});
