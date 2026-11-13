/* Synthetische Bezieher je Profil ohne Stellvertreter (factory#224): Profil-Namen, Prüfung der Definition, Fixture-Bau, Aufruf mit --profil, die Profil-Gestalt in einem echten Klon und der CI-Job. */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/probe-erstbezug.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as releaseRaw from "../scripts/release-tag-lib.mjs";

type Io = Record<string, unknown>;
type Profil = { profil: string; titel?: string; config?: Record<string, unknown>; skripte?: Record<string, string>; verifyZusatz?: string[]; dateien?: Record<string, string>; faelle?: Record<string, unknown>[] };
type Schritt = { id: string; art?: string; profil?: Profil | null; cwd: string };
const P = raw as unknown as {
  pruefeProfil: (def: unknown, name: string) => string[];
  projektdatei: (a: { pfad: string; text: string; raum: number; overlay?: Record<string, unknown>; profil?: Profil | null }) => string;
  baueFixture: (a: { von: string; ziel: string; raum: number; io: Io; profil?: Profil | null }) => void;
  befehleErgaenzung: (t: string) => string;
  aufrufFehler: (argv: string[], io: Io) => { text?: string; quelle?: string; scratch?: string; profil?: Profil };
  probeSchritte: (a: { quelle: string; scratch: string; tag: string; sha: string; profil?: Profil | null }) => Schritt[];
  fuehreSchritte: (s: Schritt[], io: Io) => { id: string; status: number | null }[];
  main: (argv: string[], io: Io) => { code: number; out: string; err: string };
  echteNaehte: (stdio?: string) => { kopf: (p: string) => string | null; mitScratch: (s: string) => Io };
  PROBE_TAG: string;
};
const L = releaseRaw as unknown as { PROFIL_ORDNER: string; profilNamen: (d: string[]) => string[] };

const WURZEL = resolve(import.meta.dirname, "..");
const ordner = join(WURZEL, L.PROFIL_ORDNER);
const profile = (): string[] => L.profilNamen(readdirSync(ordner));
const lade = (name: string): Profil => JSON.parse(readFileSync(join(ordner, `${name}.json`), "utf8")) as Profil;

const temp = <T>(fn: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "probe-profil-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const git = (cwd: string, ...args: string[]): void => {
  const r = spawnSync("git", ["-C", cwd, "-c", "maintenance.auto=false", "-c", "gc.auto=0", "-c", "user.name=t", "-c", "user.email=t@e.invalid", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};

const gueltig = (): Profil => ({ profil: "x", skripte: { "test:x": "node a.mjs" }, verifyZusatz: ["test:x"], dateien: { "a/b.txt": "t" }, faelle: [] });

describe("profilNamen", () => {
  it("nimmt nur gültige <name>.json, sortiert ohne Endung; alles andere wird ignoriert", () => {
    expect(L.profilNamen(["python.json", "java.json", "README.md", "Rust.json", "-x.json", "a.json.bak", "x.y.json", "mit-bindestrich2.json"])).toEqual(["java", "mit-bindestrich2", "python"]);
  });
  it("leere Liste → []", () => {
    expect(L.profilNamen([])).toEqual([]);
  });
  it("die echten Profile: genau java und python", () => {
    expect(profile()).toEqual(["java", "python"]);
  });
});

describe("pruefeProfil", () => {
  it.each(profile())("die Fixture %s ist gültig", (name) => {
    expect(P.pruefeProfil(lade(name), name)).toEqual([]);
  });
  it("eine gültige Definition liefert []", () => {
    expect(P.pruefeProfil(gueltig(), "x")).toEqual([]);
  });
  it.each([
    ["Name ≠ Dateiname", { ...gueltig(), profil: "y" }, /passt nicht zum Dateinamen/],
    ["verifyZusatz nicht in skripte", { ...gueltig(), verifyZusatz: ["nope"] }, /verifyZusatz: nope steht nicht in skripte/],
    ["Skriptname mit Sonderzeichen", { ...gueltig(), skripte: { "a b": "x" }, verifyZusatz: [] }, /Name "a b" außerhalb/],
    ["absoluter Pfad", { ...gueltig(), dateien: { "/etc/x": "t" } }, /absolut/],
    ["Pfad mit ..", { ...gueltig(), dateien: { "a/../../x": "t" } }, /enthält \.\./],
    ["Pfad mit .. (Rückwärts-Schrägstrich)", { ...gueltig(), dateien: { "a\\..\\x": "t" } }, /enthält \.\./],
    ["AGENTS.md überschreiben", { ...gueltig(), dateien: { "AGENTS.md": "t" } }, /nicht überschreibbar/],
    ["Projekt-Config überschreiben", { ...gueltig(), dateien: { ".factory/projekt.json": "{}" } }, /nicht überschreibbar/],
    ["package.json überschreiben", { ...gueltig(), dateien: { "package.json": "{}" } }, /nicht überschreibbar/],
    ["Inhalt kein Text", { ...gueltig(), dateien: { "a.txt": 5 } }, /kein Text/],
    ["Fall ohne quelle", { ...gueltig(), faelle: [{ nichtAbbildbar: "Grund" }] }, /quelle fehlt oder hat nicht die Form/],
    ["Fall mit falscher quelle", { ...gueltig(), faelle: [{ quelle: "#224", nichtAbbildbar: "Grund" }] }, /quelle fehlt oder hat nicht die Form/],
    ["Fall ohne Begründung und ohne Dateien", { ...gueltig(), faelle: [{ quelle: "factory#1 L1" }] }, /genau eines von dateien/],
    ["Fall mit beiden", { ...gueltig(), faelle: [{ quelle: "factory#1 L1", dateien: ["a/b.txt"], nichtAbbildbar: "Grund" }] }, /genau eines von dateien/],
    ["Fall mit leerer Begründung", { ...gueltig(), faelle: [{ quelle: "factory#1 L1", nichtAbbildbar: "  " }] }, /genau eines von dateien/],
    ["Fall mit Datei außerhalb des Profils", { ...gueltig(), faelle: [{ quelle: "factory#1 L1", dateien: ["fremd.txt"] }] }, /fremd\.txt steht nicht in dateien/],
  ])("Negativfall: %s → eine Meldung", (_n, def, muster) => {
    const f = P.pruefeProfil(def, "x");
    expect(f).toHaveLength(1);
    expect(f[0]).toMatch(muster);
  });
  it("gültige Fälle: Dateien des Profils oder config:<schlüssel> bzw. ein begründetes nicht abbildbar", () => {
    const def = { ...gueltig(), faelle: [{ quelle: "factory#1 L1", dateien: ["a/b.txt", "config:struktur"] }, { quelle: "factory#2 L3", nichtAbbildbar: "braucht Maven" }] };
    expect(P.pruefeProfil(def, "x")).toEqual([]);
  });
  it("kein Objekt → eine Meldung", () => {
    expect(P.pruefeProfil(null, "x")).toEqual(["Profil ist kein Objekt"]);
    expect(P.pruefeProfil([], "x")).toEqual(["Profil ist kein Objekt"]);
  });
});

describe("Fixture-Bau mit Profil", () => {
  const basis = JSON.stringify({ version: 2, struktur: { quelle: "scripts", moduldoku: null } });
  const pkg = JSON.stringify({ name: "p", scripts: { verify: "npm run a", test: "vitest run" } });
  it("die Config bekommt das Overlay des Profils; ohne Profil bleibt sie unverändert", () => {
    const profil = { ...gueltig(), config: { struktur: { quelle: ["src/probe"], moduldoku: "docs/module" } } };
    const mit = JSON.parse(P.projektdatei({ pfad: ".factory/projekt.json", text: basis, raum: 1, profil })) as { struktur: Record<string, unknown> };
    expect(mit.struktur).toEqual({ quelle: ["src/probe"], moduldoku: "docs/module" });
    expect(JSON.parse(P.projektdatei({ pfad: ".factory/projekt.json", text: basis, raum: 1 }))).toEqual(JSON.parse(basis));
  });
  it("package.json: Skripte des Profils, verify bekommt && npm run <x> je verifyZusatz; ohne Profil nur --passWithNoTests", () => {
    const mit = JSON.parse(P.projektdatei({ pfad: "package.json", text: pkg, raum: 1, profil: gueltig() })) as { scripts: Record<string, string> };
    expect(mit.scripts["test:x"]).toBe("node a.mjs");
    expect(mit.scripts.verify).toBe("npm run a && npm run test:x");
    const ohne = JSON.parse(P.projektdatei({ pfad: "package.json", text: pkg, raum: 1 })) as { scripts: Record<string, string> };
    expect(ohne.scripts).toEqual({ verify: "npm run a", test: "vitest run --passWithNoTests" });
  });
  it("befehleErgaenzung nennt das Profil-Skript", () => {
    const mit = P.projektdatei({ pfad: "package.json", text: pkg, raum: 1, profil: gueltig() });
    expect(P.befehleErgaenzung(mit)).toContain("`npm run test:x`");
  });
  it("baueFixture schreibt zusätzlich die dateien des Profils; ohne Profil nichts davon", () => {
    const geschrieben: string[] = [];
    const io = { lies: (p: string) => (p.endsWith("package.json") ? pkg : p.endsWith("projekt-probe.json") ? basis : "x"), schreibe: (p: string) => geschrieben.push(p) };
    P.baueFixture({ von: "/v", ziel: "/z", raum: 99999, io, profil: gueltig() });
    expect(geschrieben.some((p) => p.endsWith(join("a", "b.txt")))).toBe(true);
    geschrieben.length = 0;
    P.baueFixture({ von: "/v", ziel: "/z", raum: 99999, io });
    expect(geschrieben.some((p) => p.endsWith(join("a", "b.txt")))).toBe(false);
  });
  it("probeSchritte reicht das Profil nur an den Fixture-Schritt", () => {
    const mit = P.probeSchritte({ quelle: "/q", scratch: "/s", tag: "t", sha: "a", profil: gueltig() });
    expect(mit.find((s) => s.id === "fixture")?.profil).toEqual(gueltig());
    expect(mit.filter((s) => s.profil).map((s) => s.id)).toEqual(["fixture"]);
  });
});

describe("Aufruf mit --profil", () => {
  const dateien = (inhalte: Record<string, string>): Io => ({
    istGitRepo: () => true,
    istLeer: () => true,
    liste: () => Object.keys(inhalte).map((k) => k.replace(/^.*\//u, "")),
    lies: (p: string) => inhalte[Object.keys(inhalte).find((k) => p.endsWith(k)) ?? "\0"] ?? null,
  });
  const argv = (name: string) => ["--quelle", "/q", "--scratch", "/s", "--profil", name];
  const ok = { "probe-profil/x.json": JSON.stringify(gueltig()) };
  it("ein gültiges Profil kommt als Objekt zurück", () => {
    expect(P.aufrufFehler(argv("x"), dateien(ok)).profil).toEqual(gueltig());
  });
  it("ohne --profil gibt es kein Profil (alter Aufruf unverändert)", () => {
    expect(P.aufrufFehler(["--quelle", "/q", "--scratch", "/s"], dateien(ok))).toEqual({ quelle: resolve("/q"), scratch: resolve("/s") });
  });
  it.each(["../x", "X", "a/b", ""])("ungültiger Name %j → Fehler mit Liste bekannter Profile", (name) => {
    expect(P.aufrufFehler(argv(name), dateien(ok)).text).toMatch(/ungültiger Name \(bekannt: x\)/);
  });
  it("fehlende Datei → Fehler mit Liste bekannter Profile", () => {
    expect(P.aufrufFehler(argv("y"), dateien(ok)).text).toMatch(/fehlt in der Quelle \(bekannt: x\)/);
  });
  it("kaputtes JSON → Fehler", () => {
    expect(P.aufrufFehler(argv("x"), dateien({ "probe-profil/x.json": "{" })).text).toMatch(/kein gültiges JSON/);
  });
  it("ungültige Definition → Fehlerliste, Exit 2 in main (vor jedem Schritt)", () => {
    const io = { ...dateien({ "probe-profil/x.json": JSON.stringify({ ...gueltig(), dateien: { "/x": "t" } }) }), kopf: () => "abc", mitScratch: () => { throw new Error("darf nicht laufen"); } };
    const r = P.main(argv("x"), io);
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--profil x ungültig:\n- dateien: Pfad "\/x"/);
  });
  it("main mit Profil und rotem verifyKompakt → Exit 1, die Ausgabe nennt das Profil", () => {
    const io = {
      ...dateien(ok),
      kopf: () => "abc",
      lies: (p: string) => (p.endsWith("x.json") ? ok["probe-profil/x.json"] : null),
      mitScratch: () => ({ melde: () => undefined, fuehre: (s: { id: string }) => (s.id === "verifyKompakt" ? 1 : 0), fixture: () => 0, befehle: () => 0 }),
    };
    const r = P.main(argv("x"), io);
    expect(r.code).toBe(1);
    expect(r.out).toContain("Profil: x (synthetischer Bezieher, factory#224)");
    expect(r.out).toContain("ROT verifyKompakt: Exit 1");
  });
  it("main ohne Profil nennt kein Profil", () => {
    const io = { ...dateien(ok), kopf: () => "abc", mitScratch: () => ({ melde: () => undefined, fuehre: () => 0, fixture: () => 0, befehle: () => 0 }) };
    expect(P.main(["--quelle", "/q", "--scratch", "/s"], io).out).not.toContain("Profil:");
  });
  it("Direktaufruf mit unbekanntem Profil: Exit 2 und Liste der bekannten Profile", () => {
    temp((dir) => {
      const r = spawnSync(process.execPath, [join(WURZEL, "scripts", "probe-erstbezug.mjs"), "--quelle", WURZEL, "--scratch", join(dir, "s"), "--profil", "gibt-es-nicht"], { encoding: "utf8" });
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/fehlt in der Quelle \(bekannt: java, python\)/);
    });
  });
});

/* Integration: echte Kette gegen einen Klon der Quelle bis `projektwerte` (ohne `install`), dann ein Kern-Gate im Fixture-Projekt. Belegt, dass die Profil-Gestalt gemessen wird (kein Grün durch Stellvertreter). */
describe("Profil-Gestalt (echter Klon)", () => {
  const TIMEOUT = 180_000;
  const bezieher = (dir: string, name: string, aender: (profil: Profil) => Profil = (p) => p): string => {
    const k = join(dir, "klon");
    mkdirSync(dir, { recursive: true });
    git(dir, "clone", "-q", "--no-local", WURZEL, k);
    const profil = aender(lade(name));
    const naehte = P.echteNaehte("stderr");
    const sha = naehte.kopf(k) as string;
    const scratch = join(dir, "s");
    const alle = P.probeSchritte({ quelle: k, scratch, tag: P.PROBE_TAG, sha, profil });
    const kette = alle.slice(0, alle.findIndex((s) => s.id === "projektwerte") + 1).filter((s) => s.id !== "install" && s.id !== "lint-prune");
    const ergebnisse = P.fuehreSchritte(kette, { ...naehte.mitScratch(scratch), melde: () => undefined });
    const rot = ergebnisse.filter((e) => e.status !== 0 && ["klon", "tag", "fixture", "sync-tag", "befehle"].includes(e.id));
    expect(rot, JSON.stringify(rot)).toEqual([]);
    return join(scratch, "bezieher");
  };
  const lauf = (cwd: string, skript: string): { status: number | null; text: string } => {
    const r = spawnSync(process.execPath, [join(cwd, "scripts", skript)], { cwd, encoding: "utf8", timeout: 60_000 });
    return { status: r.status, text: `${r.stdout}${r.stderr}` };
  };

  it("Java: check:docmap grün; ohne Paketnennung in docs/module/backend.md rot mit dem Paketnamen (die Java-Quellen werden gemessen)", { timeout: TIMEOUT }, () => {
    temp((dir) => {
      expect(lauf(bezieher(join(dir, "a"), "java"), "check-docmap.mjs")).toMatchObject({ status: 0 });
      const sabotiert = bezieher(join(dir, "b"), "java", (p) => ({ ...p, dateien: { ...p.dateien, "docs/module/backend.md": "# Backend (Probe)\n" } }));
      const r = lauf(sabotiert, "check-docmap.mjs");
      expect(r.status).toBe(1);
      expect(r.text).toMatch(/Verwaistes Modul[^\n]*de\/beispiel\/probe\/domain/);
    });
  });

  it("Python: check:docmap grün; ohne Nennung der Quelldatei rot (die Python-Quellen werden gemessen)", { timeout: TIMEOUT }, () => {
    temp((dir) => {
      expect(lauf(bezieher(join(dir, "a"), "python"), "check-docmap.mjs")).toMatchObject({ status: 0 });
      const r = lauf(bezieher(join(dir, "b"), "python", (p) => ({ ...p, dateien: { ...p.dateien, "docs/module/probe.md": "# Probe\n" } })), "check-docmap.mjs");
      expect(r.status).toBe(1);
      expect(r.text).toMatch(/Verwaistes Modul[^\n]*src\/probe\/kern\.py/);
    });
  });

  it("die Profil-Skripte stehen in der package.json des Fixtures und in verify", { timeout: TIMEOUT }, () => {
    temp((dir) => {
      const b = bezieher(dir, "java");
      const pkg = JSON.parse(readFileSync(join(b, "package.json"), "utf8")) as { scripts: Record<string, string> };
      expect(pkg.scripts["test:java"]).toBe("node tools/mvn.mjs -B verify");
      expect(pkg.scripts.verify).toMatch(/&& npm run test:java$/);
      expect(readFileSync(join(b, "docs", "referenz", "befehle.md"), "utf8")).toContain("npm run test:java");
    });
  });
});

describe("CI-Job probe-profil (Wächter der Invarianten)", () => {
  const ci = readFileSync(join(WURZEL, ".github", "workflows", "ci.yml"), "utf8");
  const start = ci.indexOf("\n  probe-profil:\n");
  const rest = ci.slice(start + 1);
  const job = rest.slice(0, rest.search(/\n {2}\S/));

  it("der Job existiert, seine Matrix ist die Liste der Profil-Dateien", () => {
    expect(start).toBeGreaterThan(-1);
    const m = /profil:\s*\[([^\]]*)\]/u.exec(job);
    expect(m).not.toBeNull();
    expect((m?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)).toEqual(profile());
    expect(job).toMatch(/fail-fast:\s*false/);
  });
  it("Aufruf mit --profil \"$PROFIL\", Scratch im Runner-Temp, Matrixwert nur über env", () => {
    expect(job).toContain("PROFIL: ${{ matrix.profil }}");
    expect(job).toMatch(/run: node scripts\/probe-erstbezug\.mjs --profil "\$PROFIL" --quelle "\$GITHUB_WORKSPACE" --scratch "\$RUNNER_TEMP\/probe-profil-\$PROFIL"\n/);
    const runZeilen = job.split("\n").filter((z) => /^\s*run:/u.test(z));
    expect(runZeilen.length).toBeGreaterThan(0);
    for (const z of runZeilen) expect(z).not.toContain("${{");
  });
  it("jeder Fund bleibt rot: kein continue-on-error und kein || true; nur Leserecht, keine Credentials", () => {
    expect(job).not.toMatch(/continue-on-error\s*:/);
    expect(job).not.toMatch(/\|\|\s*true/);
    expect(job).toContain("contents: read");
    expect(job).toContain("persist-credentials: false");
  });
  it("der Alarm auf main hängt am Job", () => {
    const a = ci.indexOf("\n  alarm-red-main:\n");
    const ab = ci.slice(a + 1);
    const ende = ab.search(/\n {2}\S/u);
    const alarm = ende < 0 ? ab : ab.slice(0, ende);
    expect(alarm).toMatch(/needs:[^\n]*probe-profil/);
  });
});
