/* Wochenbericht-Lauf (factory#314): Lib-Regeln (Termin, Stand, Anlass, Ablage) und `wochenberichtLauf`. Alles injiziert: temporäres Home, Fake-`auswerten`, Fake-`gh`,
 * nie das echte Home, nie das Netz. Der Lauf legt ohne Bericht nie einen Erfolgsstand an (Negativfälle am Ende). */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/langfuse-wochenbericht-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lockRaw from "../scripts/langfuse-lock.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../scripts/langfuse-wochenbericht.mjs";
import { FREMD } from "./support/fremd-config";

const L = libRaw as unknown as {
  wochenberichtTermin: (j: Date) => { montag: string; faellig: boolean; meldenAb: boolean };
  wochenStand: (j: unknown) => string;
  anlassText: (o: Record<string, unknown>) => string;
  wochenberichtAblage: (repo: string, home?: string) => string;
};
type Ergebnis = { exitCode: number; stdout: string; stderr: string };
const echtesLock = lockRaw as unknown as { lockNehmen: (d: string, o: { now: number }) => string };
const C = cliRaw as unknown as {
  parseArgs: (a: string[]) => { ausloeser?: string; wurzel?: string; fehler?: string };
  ladeProjekt: (w?: string) => { owner: string; repo: string; config: { repo: string } };
  auswerten: (a: unknown, d?: Record<string, unknown>) => Promise<Ergebnis>;
  wochenberichtLauf: (a: Record<string, unknown>, d: Record<string, unknown>) => Promise<number>;
};

const MONTAG = "2026-11-02";
const MI = new Date("2026-11-11T12:00:00Z");
const DO = new Date("2026-11-12T00:00:00Z");
const temps: string[] = [];
afterAll(() => {
  for (const d of temps) rmSync(d, { recursive: true, force: true });
});

describe("Termin und Stand (Lib)", () => {
  test("wochenberichtTermin: fällig ab Dienstag 00:00Z, melden ab Donnerstag 00:00Z (Grenzen auf die Sekunde)", () => {
    const t = (iso: string) => L.wochenberichtTermin(new Date(iso));
    expect(t("2026-11-09T12:00:00Z")).toEqual({ montag: "2026-11-02", faellig: false, meldenAb: false });
    expect(t("2026-11-09T23:59:59Z").faellig).toBe(false);
    expect(t("2026-11-10T00:00:00Z")).toEqual({ montag: "2026-11-02", faellig: true, meldenAb: false });
    expect(t("2026-11-11T23:59:59Z").meldenAb).toBe(false);
    expect(t("2026-11-12T00:00:00Z").meldenAb).toBe(true);
    expect(t("2026-11-16T12:00:00Z")).toEqual({ montag: "2026-11-09", faellig: false, meldenAb: false });
  });
  test("wochenStand: nur Bericht ohne Schwelle, gemeldet und ruhe sind erledigt; alles ohne Bericht ist offen", () => {
    for (const j of [null, "x", {}, { status: "unerreichbar" }, { status: "keine-daten" }, { status: "fehler" }, { status: "unbekannt" }]) expect(L.wochenStand(j)).toBe("offen");
    expect(L.wochenStand({ status: "bericht", urteil: { agentLaufNoetig: true } })).toBe("melden");
    expect(L.wochenStand({ status: "bericht", urteil: { agentLaufNoetig: false } })).toBe("erledigt");
    expect(L.wochenStand({ status: "bericht" })).toBe("erledigt");
    expect(L.wochenStand({ status: "gemeldet" })).toBe("erledigt");
    expect(L.wochenStand({ status: "ruhe" })).toBe("erledigt");
  });
  test("anlassText: drei Arten, nie roher Fehlertext", () => {
    expect(L.anlassText({ art: "schwelle", montag: MONTAG, gruende: [{ schwelle: "erfassungLueckenMax", ist: 2, soll: 0 }] })).toBe(`Wochenbericht ${MONTAG}: Agent-Lauf nötig (erfassungLueckenMax Ist 2.0, Soll höchstens 0)`);
    expect(L.anlassText({ art: "fehlt", montag: MONTAG, klasse: "unerreichbar" })).toBe(`Wochenbericht ${MONTAG} fehlt: Langfuse unerreichbar (Details im lokalen Log)`);
    expect(L.anlassText({ art: "fehlt", montag: MONTAG, klasse: "fehler" })).toBe(`Wochenbericht ${MONTAG} fehlt: Fehler im Live-Weg (Details im lokalen Log)`);
    expect(L.anlassText({ art: "ohne-daten", montag: MONTAG })).toBe(`Wochenbericht ${MONTAG}: Woche ohne Daten trotz Commits auf main (Erfassung prüfen)`);
  });
  test("wochenberichtAblage: <home>/.claude/state/langfuse-wochenbericht/<owner>__<repo>", () => {
    expect(L.wochenberichtAblage("own/repo")).toBe("~/.claude/state/langfuse-wochenbericht/own__repo");
    expect(L.wochenberichtAblage("own/repo", "/h")).toBe("/h/.claude/state/langfuse-wochenbericht/own__repo");
  });
});

describe("Aufruf", () => {
  test("--ausloeser nimmt nur sessionstart; --wurzel wird gelesen", () => {
    expect(C.parseArgs(["--ausloeser", "sessionstart", "--wurzel", "/w"])).toMatchObject({ ausloeser: "sessionstart", wurzel: "/w" });
    expect(C.parseArgs(["--ausloeser", "foo"]).fehler).toContain("sessionstart");
  });
  test("--ausloeser foo endet über auswerten mit Exit 2", async () => {
    expect((await C.auswerten(C.parseArgs(["--ausloeser", "foo"]), {})).exitCode).toBe(2);
  });
});

interface Aufrufe { gh: string[][]; auswerten: number; claims: number; argumente: Array<{ args: Record<string, unknown>; deps: Record<string, unknown> }> }
interface Opt {
  jetzt?: Date;
  schwellen?: Record<string, number> | undefined;
  env?: Record<string, string>;
  exit?: number;
  gruende?: unknown[];
  grund?: string;
  commits?: string | Error;
  dispatchFehler?: boolean;
  bezieher?: boolean;
  vorher?: Record<string, unknown>;
  claim?: number;
  config?: unknown;
  /** Fake-Auswerten ohne Dateien und mit festem Ergebnis (Ausgabe außerhalb der Verträge). */
  roh?: Ergebnis;
  /** Vom Fake-`lockNehmen` vor der Rückgabe abgelegte `.json` (ein gleichzeitiger Lauf, der die Woche erledigt). */
  nachClaim?: Record<string, unknown>;
  /** stderr des Fake-Auswertens bei Exit 1 oder 2. */
  stderr?: string;
}
const SCHWELLEN = { erfassungLueckenMax: 0, kostenAnstiegProzent: 50, wochenOhneLaufMax: 4 };

/** Eine Umgebung (Home, Aufrufzähler); der Fake-`auswerten` legt die Dateien so ab wie `--ablegen`. */
function umgebung(opt: Opt = {}) {
  const home = mkdtempSync(join(tmpdir(), "wbl-"));
  temps.push(home);
  const ordner = join(home, ".claude", "state", "langfuse-wochenbericht", "own__repo");
  const a: Aufrufe = { gh: [], auswerten: 0, claims: 0, argumente: [] };
  const exit = opt.exit ?? 0;
  const auswerten = (args: Record<string, unknown>, deps: Record<string, unknown>): Promise<Ergebnis> => {
    a.auswerten += 1;
    a.argumente.push({ args, deps });
    if (opt.roh) return Promise.resolve(opt.roh);
    mkdirSync(ordner, { recursive: true });
    if (exit === 0 || exit === 3) {
      const json = { status: "bericht", woche: MONTAG, urteil: { agentLaufNoetig: exit === 3, gruende: opt.gruende ?? [{ schwelle: "erfassungLueckenMax", ist: 2, soll: 0 }] } };
      writeFileSync(join(ordner, `${MONTAG}.md`), "# Bericht\n");
      writeFileSync(join(ordner, `${MONTAG}.json`), JSON.stringify(json));
      return Promise.resolve({ exitCode: exit, stdout: JSON.stringify(json), stderr: "" });
    }
    if (exit === 4) {
      const obj = { status: opt.grund ?? "unerreichbar", woche: MONTAG, grund: "x" };
      writeFileSync(join(ordner, `${MONTAG}.json`), JSON.stringify(obj));
      return Promise.resolve({ exitCode: 4, stdout: JSON.stringify(obj), stderr: "WARNUNG" });
    }
    return Promise.resolve({ exitCode: exit, stdout: "", stderr: opt.stderr ?? `Fehler: kaputt in ${home}/x` });
  };
  const gh = (args: string[]) => {
    a.gh.push(args);
    if (args[0] === "workflow" && opt.dispatchFehler) throw new Error("HTTP 422");
    if (args[0] === "api") {
      if (opt.commits instanceof Error) throw opt.commits;
      return opt.commits ?? "[]";
    }
    return "";
  };
  if (opt.vorher) {
    mkdirSync(ordner, { recursive: true });
    writeFileSync(join(ordner, `${MONTAG}.json`), JSON.stringify(opt.vorher));
  }
  if (opt.claim !== undefined) {
    mkdirSync(ordner, { recursive: true });
    writeFileSync(join(ordner, `${MONTAG}.claim`), JSON.stringify({ pid: 1, zeit: opt.claim }));
  }
  const config = opt.config ?? { ...FREMD, repo: "own/repo" };
  const projekt = { owner: "own", repo: "repo", schwellen: "schwellen" in opt ? opt.schwellen : SCHWELLEN, tags: [], wurzel: "/w", config };
  const wurzeln: unknown[] = [];
  const lockNehmen = (datei: string, o: { now: number }) => {
    a.claims += 1;
    if (opt.nachClaim) {
      mkdirSync(ordner, { recursive: true });
      writeFileSync(join(ordner, `${MONTAG}.json`), JSON.stringify(opt.nachClaim));
    }
    return echtesLock.lockNehmen(datei, o);
  };
  const deps: Record<string, unknown> = { jetzt: opt.jetzt ?? MI, home, env: opt.env ?? { LANGFUSE_PUBLIC_KEY: "pk" }, projekt, auswerten, gh, istBezieher: (w: unknown) => (wurzeln.push(w), opt.bezieher === true), lockNehmen };
  const json = (): Record<string, unknown> | null => (existsSync(join(ordner, `${MONTAG}.json`)) ? (JSON.parse(readFileSync(join(ordner, `${MONTAG}.json`), "utf8")) as Record<string, unknown>) : null);
  const zeilen = (): Array<Record<string, unknown>> => {
    const f = join(home, ".claude", "state", "langfuse-wochenbericht.log");
    return existsSync(f) ? readFileSync(f, "utf8").trim().split("\n").map((z) => JSON.parse(z) as Record<string, unknown>) : [];
  };
  return { home, ordner, a, deps, json, zeilen, wurzeln, lauf: () => C.wochenberichtLauf({ ausloeser: "sessionstart", wurzel: "/die-wurzel" }, deps) };
}
const dispatchArgs = (repo: string, text: string) => ["workflow", "run", "board-takt.yml", "--repo", repo, "-f", `langfuse_anlass=${text}`];

describe("Wochenbericht-Lauf: Abbruch vor dem Claim", () => {
  test("ohne Config-Schlüssel: Logzeile aus, kein Claim, kein Auswerten", async () => {
    const u = umgebung({ schwellen: undefined });
    expect(await u.lauf()).toBe(0);
    expect(u.zeilen()).toMatchObject([{ status: "aus", ausloeser: "sessionstart", repo: "own/repo" }]);
    expect(u.a.auswerten).toBe(0);
    expect(u.a.claims).toBe(0);
    expect(existsSync(u.ordner)).toBe(false);
  });
  test("vor Dienstag 00:00Z: nicht fällig", async () => {
    const u = umgebung({ jetzt: new Date("2026-11-09T23:59:59Z") });
    await u.lauf();
    expect(u.zeilen()[0]?.status).toBe("nicht-faellig");
    expect(u.a.auswerten).toBe(0);
    expect(u.a.claims).toBe(0);
  });
  test("erledigte Woche: kein Auswerten, kein Claim", async () => {
    const u = umgebung({ vorher: { status: "bericht", urteil: { agentLaufNoetig: false } } });
    await u.lauf();
    expect(u.zeilen()[0]?.status).toBe("erledigt");
    expect(u.a.auswerten).toBe(0);
    expect(u.a.claims).toBe(0);
    expect(existsSync(join(u.ordner, `${MONTAG}.claim`))).toBe(false);
  });
  test("ohne öffentlichen Langfuse-Key: nur Logzeile kein-zugang", async () => {
    const u = umgebung({ env: {} });
    await u.lauf();
    expect(u.zeilen()[0]?.status).toBe("kein-zugang");
    expect(u.a.auswerten).toBe(0);
    expect(u.a.claims).toBe(0);
    expect(u.a.gh).toEqual([]);
  });
  test("frischer Claim: belegt; nach 16 Minuten übernimmt der nächste Start", async () => {
    const u = umgebung({ claim: MI.getTime() - 60_000 });
    await u.lauf();
    expect(u.zeilen()[0]?.status).toBe("belegt");
    expect(u.a.auswerten).toBe(0);
    const v = umgebung({ claim: MI.getTime() - 16 * 60_000 });
    await v.lauf();
    expect(v.a.auswerten).toBe(1);
    expect(existsSync(join(v.ordner, `${MONTAG}.claim`))).toBe(false);
  });
});

describe("Wochenbericht-Lauf: Ausgänge der Auswertung", () => {
  test("Exit 0: Bericht abgelegt, keine Meldung, Claim freigegeben", async () => {
    const u = umgebung({ exit: 0 });
    await u.lauf();
    expect(u.zeilen()[0]).toMatchObject({ status: "bericht", woche: MONTAG });
    expect(u.a.gh).toEqual([]);
    expect(u.json()?.status).toBe("bericht");
    expect(existsSync(join(u.ordner, `${MONTAG}.claim`))).toBe(false);
  });
  test("Exit 3: Dispatch mit exakten Argumenten, dann gemeldet mit Anlass", async () => {
    const u = umgebung({ exit: 3 });
    await u.lauf();
    const text = `Wochenbericht ${MONTAG}: Agent-Lauf nötig (erfassungLueckenMax Ist 2.0, Soll höchstens 0)`;
    expect(u.a.gh).toEqual([dispatchArgs("own/repo", text)]);
    expect(u.json()).toMatchObject({ status: "gemeldet", anlass: text });
    expect(u.zeilen()[0]).toMatchObject({ status: "gemeldet", anlass: text });
  });
  test("Exit 3 mit gescheitertem Dispatch: Stand bleibt Bericht, der nächste Start meldet ohne neues Auswerten", async () => {
    const u = umgebung({ exit: 3, dispatchFehler: true });
    await u.lauf();
    expect(u.zeilen()[0]?.status).toBe("dispatch-fehler");
    expect(u.json()?.status).toBe("bericht");
    const n = umgebung({ vorher: u.json() as Record<string, unknown> });
    await n.lauf();
    expect(n.a.auswerten).toBe(0);
    expect(n.a.gh).toHaveLength(1);
    expect(n.json()?.status).toBe("gemeldet");
  });
  test("Exit 4 unerreichbar: Mittwoch nur Warnung und neuer Versuch, Donnerstag 00:00Z Meldung", async () => {
    const mi = umgebung({ exit: 4 });
    await mi.lauf();
    expect(mi.a.gh).toEqual([]);
    expect(mi.json()).toMatchObject({ status: "unerreichbar" });
    expect(mi.json()?.warnung).toBeTruthy();
    expect(mi.zeilen()[0]).toMatchObject({ status: "offen", grund: "unerreichbar" });
    const don = umgebung({ exit: 4, jetzt: DO });
    await don.lauf();
    expect(don.a.gh).toEqual([dispatchArgs("own/repo", `Wochenbericht ${MONTAG} fehlt: Langfuse unerreichbar (Details im lokalen Log)`)]);
    expect(don.json()?.status).toBe("gemeldet");
  });
  test("Exit 4 keine Daten: mit Commits Meldung, ohne Commits ruhe, bei gh-Fehler offen (nie ruhe)", async () => {
    const mit = umgebung({ exit: 4, grund: "keine-daten", commits: '[{"sha":"a"}]' });
    await mit.lauf();
    expect(mit.a.gh[0]).toEqual(["api", `repos/own/repo/commits?sha=main&since=${MONTAG}T00:00:00.000Z&until=2026-11-09T00:00:00.000Z&per_page=1`]);
    expect(mit.a.gh[1]).toEqual(dispatchArgs("own/repo", `Wochenbericht ${MONTAG}: Woche ohne Daten trotz Commits auf main (Erfassung prüfen)`));
    expect(mit.json()?.status).toBe("gemeldet");
    const ohne = umgebung({ exit: 4, grund: "keine-daten", commits: "[]" });
    await ohne.lauf();
    expect(ohne.a.gh).toHaveLength(1);
    expect(ohne.json()).toMatchObject({ status: "ruhe" });
    expect(ohne.json()?.warnung).toBeTruthy();
    const kaputt = umgebung({ exit: 4, grund: "keine-daten", commits: new Error("HTTP 502") });
    await kaputt.lauf();
    expect(kaputt.json()?.status).toBe("keine-daten");
    expect(kaputt.zeilen()[0]).toMatchObject({ status: "offen", grund: "commits-unbekannt" });
  });
  test("Exit 1: Fehler festgehalten, Mittwoch keine Meldung, ab Donnerstag Meldung", async () => {
    const mi = umgebung({ exit: 1 });
    await mi.lauf();
    expect(mi.json()).toMatchObject({ status: "fehler" });
    expect(mi.a.gh).toEqual([]);
    const don = umgebung({ exit: 1, jetzt: DO });
    await don.lauf();
    expect(don.a.gh).toEqual([dispatchArgs("own/repo", `Wochenbericht ${MONTAG} fehlt: Fehler im Live-Weg (Details im lokalen Log)`)]);
  });
  test("Bezieher: der Dispatch geht ans eigene Repo, die Fabrik-Config zeigt sonst auf das Factory-Board", async () => {
    const config = { ...FREMD, repo: "own/repo", boards: FREMD.boards.map((b) => (b.rolle === "factory" ? { ...b, repo: "zz-org/zz-fabrik" } : b)) };
    const fabrik = umgebung({ exit: 3, config });
    await fabrik.lauf();
    expect(fabrik.a.gh[0][4]).toBe("zz-org/zz-fabrik");
    const bezieher = umgebung({ exit: 3, config, bezieher: true });
    await bezieher.lauf();
    expect(bezieher.a.gh[0][4]).toBe("own/repo");
  });
});

describe("Wochenbericht-Lauf: Ränder der Ausgänge", () => {
  test("Exit 4 ohne abgelegte Datei: die .json entsteht aus dem Befund (Status unerreichbar), nicht leer", async () => {
    const u = umgebung({ roh: { exitCode: 4, stdout: JSON.stringify({ status: "unerreichbar", woche: MONTAG, grund: "x" }), stderr: "" } });
    await u.lauf();
    expect(u.json()).toMatchObject({ status: "unerreichbar", woche: MONTAG, grund: "x" });
  });
  test("Exit 4 mit unlesbarer Ausgabe: Fehler festgehalten, keine Meldung vor Donnerstag", async () => {
    const u = umgebung({ roh: { exitCode: 4, stdout: "", stderr: "" } });
    await u.lauf();
    expect(u.json()).toMatchObject({ status: "fehler", grund: "unerwartete Ausgabe des Auswertens" });
    expect(u.a.gh).toEqual([]);
  });
  test("Exit 0 ohne Bericht in der Ausgabe ist ein Fehler, nie ein Bericht", async () => {
    const u = umgebung({ roh: { exitCode: 0, stdout: "kein json", stderr: "" } });
    await u.lauf();
    expect(u.zeilen()[0]).toMatchObject({ status: "fehler", grund: "unerwartete Ausgabe des Auswertens" });
    expect(u.json()?.status).toBe("fehler");
  });
  test("Exit 3 ohne Bericht in der Ausgabe ist ein Fehler festgehalten in der .json, nie eine Meldung", async () => {
    const u = umgebung({ roh: { exitCode: 3, stdout: "kein json", stderr: "" } });
    await u.lauf();
    expect(u.json()?.status).toBe("fehler");
    expect(u.a.gh).toEqual([]);
  });
  test("Exit 0 mit JSON ohne status bericht ist ebenfalls ein Fehler", async () => {
    const u = umgebung({ roh: { exitCode: 0, stdout: JSON.stringify({ status: "irgendwas" }), stderr: "" } });
    await u.lauf();
    expect(u.json()?.status).toBe("fehler");
  });
  test("commits-Antwort keine Liste: die Woche bleibt offen, keine Meldung und kein ruhe", async () => {
    const u = umgebung({ exit: 4, grund: "keine-daten", commits: '{"message":"Not Found"}' });
    await u.lauf();
    expect(u.zeilen()[0]).toMatchObject({ status: "offen", grund: "commits-unbekannt" });
    expect(u.a.gh).toHaveLength(1);
  });
  test("Woche nach dem Claim schon erledigt (gleichzeitiger Lauf): kein Auswerten, Logzeile erledigt", async () => {
    const u = umgebung({ nachClaim: { status: "bericht", urteil: { agentLaufNoetig: false } } });
    await u.lauf();
    expect(u.a.auswerten).toBe(0);
    expect(u.zeilen()[0]).toMatchObject({ status: "erledigt" });
  });
  test("die Repo-Wurzel aus --wurzel erreicht die Bezieher-Erkennung", async () => {
    const u = umgebung({ exit: 3 });
    await u.lauf();
    expect(u.wurzeln).toEqual(["/die-wurzel"]);
  });
  test("ist auch das Log nicht beschreibbar (Home ist eine Datei), endet der Lauf mit Exit 1 ohne Wurf", async () => {
    const u = umgebung();
    const datei = join(u.home, "keine-ordner");
    writeFileSync(datei, "x");
    expect(await C.wochenberichtLauf({ ausloeser: "sessionstart" }, { ...u.deps, home: datei })).toBe(1);
  });
  test("Ende zu Ende: --ausloeser sessionstart schreibt nichts auf stdout und endet bei unlesbarer Config mit Exit 1 und Logzeile fehler", () => {
    const home = mkdtempSync(join(tmpdir(), "wbe-"));
    temps.push(home);
    const r = spawnSync(process.execPath, ["scripts/langfuse-wochenbericht.mjs", "--ausloeser", "sessionstart", "--wurzel", join(home, "gibt-es-nicht")], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 30_000 });
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    const zeile = JSON.parse(readFileSync(join(home, ".claude", "state", "langfuse-wochenbericht.log"), "utf8").trim()) as Record<string, unknown>;
    expect(zeile).toMatchObject({ status: "fehler", ausloeser: "sessionstart" });
    expect(JSON.stringify(zeile)).not.toContain(home);
  }, 60_000);
});

describe("Wochenbericht-Lauf: Aufruf des Auswertens, Ergänzen, Kappung, Produktionsweg", () => {
  test("das Auswerten bekommt Woche, ablegen und json sowie Home, Projekt und Zeit des Laufs", async () => {
    const u = umgebung({ exit: 0 });
    await u.lauf();
    expect(u.a.argumente).toHaveLength(1);
    expect(u.a.argumente[0].args).toMatchObject({ woche: MONTAG, ablegen: true, json: true, exporte: [], rezept: false });
    expect(u.a.argumente[0].deps).toMatchObject({ home: u.home, jetzt: MI, env: { LANGFUSE_PUBLIC_KEY: "pk" } });
    expect(u.a.argumente[0].deps.projekt).toBe((u.deps as { projekt: unknown }).projekt);
  });
  test("ein Fehler ergänzt die vorhandene .json (Zusatzfeld bleibt) und überschreibt den Status", async () => {
    const u = umgebung({ exit: 1, vorher: { status: "unerreichbar", woche: MONTAG, extra: 1 } });
    await u.lauf();
    expect(u.json()).toMatchObject({ status: "fehler", extra: 1, woche: MONTAG });
  });
  test("mehrzeilige, lange Fehlerausgabe: grund in der .json und im Log einzeilig und höchstens 300 Zeichen", async () => {
    const u = umgebung({ exit: 1, stderr: `${"x".repeat(1000)}\nFix: zweite Zeile` });
    await u.lauf();
    const grund = u.json()?.grund as string;
    expect(grund).toBe("x".repeat(300));
    expect(u.zeilen()[0].grund).toBe("x".repeat(300));
    const zwei = umgebung({ exit: 1, stderr: `kurz\nFix: ${"y".repeat(500)}` });
    await zwei.lauf();
    expect(zwei.json()?.grund).toBe("kurz");
  });
  test("Produktionsweg ohne injiziertes Projekt: Config und Ziel-Repo kommen aus der Repo-Wurzel", async () => {
    const echt = C.ladeProjekt();
    expect(echt.config.repo).toBe(`${echt.owner}/${echt.repo}`);
    const u = umgebung({ exit: 3 });
    const { projekt: _projekt, ...ohneProjekt } = u.deps;
    // Ablage unter dem Repo der echten Config
    expect(await C.wochenberichtLauf({ ausloeser: "sessionstart", wurzel: process.cwd() }, ohneProjekt)).toBe(0);
    expect(u.a.gh).toHaveLength(1);
    expect(u.a.gh[0].slice(0, 5)).toEqual(["workflow", "run", "board-takt.yml", "--repo", echt.config.repo]);
    expect(u.zeilen()[0]).toMatchObject({ status: "gemeldet", repo: `${echt.owner}/${echt.repo}` });
  });
  test("Ende zu Ende: --ausloeser mit unbekanntem Wert endet mit Exit 2 und startet keinen Lauf (kein Log)", () => {
    const home = mkdtempSync(join(tmpdir(), "wbf-"));
    temps.push(home);
    const r = spawnSync(process.execPath, ["scripts/langfuse-wochenbericht.mjs", "--ausloeser", "foo"], { encoding: "utf8", env: { ...process.env, HOME: home, USERPROFILE: home }, timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(existsSync(join(home, ".claude"))).toBe(false);
  }, 60_000);
});

describe("Wochenbericht-Lauf: nie ein stilles „alles in Ordnung“", () => {
  const faelle: Array<[string, Opt]> = [
    ["Exit 1", { exit: 1 }],
    ["Exit 2", { exit: 2 }],
    ["unerreichbar", { exit: 4 }],
    ["keine Daten, gh-Fehler", { exit: 4, grund: "keine-daten", commits: new Error("x") }],
    ["unerreichbar, Dispatch scheitert", { exit: 4, jetzt: DO, dispatchFehler: true }],
  ];
  test.each(faelle)("%s: weder status bericht noch eine .md", async (_n, opt) => {
    const u = umgebung(opt);
    await u.lauf();
    expect(u.json()?.status).not.toBe("bericht");
    expect(existsSync(join(u.ordner, `${MONTAG}.md`))).toBe(false);
    expect(L.wochenStand(u.json())).not.toBe("erledigt");
  });
  test("die Logzeile trägt keinen Home-Pfad, auch nicht aus der Fehlerausgabe", async () => {
    const u = umgebung({ exit: 1 });
    await u.lauf();
    const roh = readFileSync(join(u.home, ".claude", "state", "langfuse-wochenbericht.log"), "utf8");
    expect(roh).not.toContain(u.home);
    expect(u.json()?.grund).not.toContain(u.home);
  });
  test("ein Wurf im Lauf wird zur Logzeile fehler mit Exit 1", async () => {
    const u = umgebung();
    const deps = { ...u.deps, auswerten: () => Promise.reject(new Error(`boom ${u.home}`)) };
    expect(await C.wochenberichtLauf({ ausloeser: "sessionstart" }, deps)).toBe(1);
    expect(u.zeilen()[0]).toMatchObject({ status: "fehler" });
    expect(JSON.stringify(u.zeilen())).not.toContain(u.home);
    expect(existsSync(join(u.ordner, `${MONTAG}.claim`))).toBe(false);
  });
});
