/* main() des Tag-Takts über injizierte Nähte (#101 L23, Muster test/secret-inbox.test.ts): Trockenlauf, Anlegen, git- und gh-Fehler. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/tag-takt.mjs";
import { FREMD } from "./support/fremd-config";

type Aufruf = { args: string[]; opt: unknown };
type Deps = Record<string, unknown>;
const T = raw as unknown as { main: (argv: string[], deps: Deps) => Promise<number>; tagTitel: (t: string) => string; probeEinstieg: (argv: string[], deps: Deps) => number };

const SHA = "a".repeat(40);
const commitLog = (n: number) =>
  Array.from({ length: n }, (_, i) => `\x1e${String(i).repeat(40)}\x1f${new Date().toISOString()}\x1ffix: x (#${i + 1})\x1f\n\nscripts/a.mjs\n`).join("");
const MANIFEST = { eintraege: [{ pfad: "scripts/a.mjs", ring: "kern" }] };

function aufbau(o: { ghJson?: (a: string[]) => unknown; git?: (a: string[]) => string; ghText?: (a: string[]) => string; start?: unknown; commits?: number } = {}) {
  const log: string[] = [];
  const text: Aufruf[] = [];
  const platziert: unknown[][] = [];
  const git = o.git ?? ((args: string[]) => (args[0] === "tag" ? "v1.2.3\n" : args[0] === "rev-parse" ? `${SHA}\n` : commitLog(o.commits ?? 3)));
  const libs = {
    OWNER: "o", REPO: "o/r", ZIEL: "o/ziel", zielToken: () => "zt",
    ladeSammelKontext: () => ({ rohe: [] }), vertrauteIssues: () => [], frischeOffeneIssues: () => [],
    platziereOben: (...a: unknown[]) => platziert.push(a),
  };
  const deps: Deps = {
    start: () => Promise.resolve(o.start ?? { config: FREMD, libs, trocken: false }),
    gh: {
      text: (args: string[], opt: unknown) => { text.push({ args, opt }); return (o.ghText ?? (() => "https://github.com/o/ziel/issues/77\n"))(args); },
      json: (args: string[]) => (o.ghJson ?? (() => []))(args),
    },
    log: (s: string) => log.push(s), err: (s: string) => log.push(s),
    git, wurzel: "Z:/gibt-es-nicht", ladeManifest: () => MANIFEST, env: { PROJECT_TOKEN: "pt" },
  };
  return { deps, log, text, platziert };
}

const ordner: string[] = [];
afterEach(() => {
  for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
});

describe("tag-takt main", () => {
  it("Trockenlauf: Vorschau mit [dry-run]-Zeilen, kein gh-Schreibaufruf, Exit 0", async () => {
    const a = aufbau({ start: undefined });
    a.deps.start = () => Promise.resolve({ config: FREMD, libs: { OWNER: "o", REPO: "o/r", ladeSammelKontext: () => ({ rohe: [] }), vertrauteIssues: () => [], frischeOffeneIssues: () => [] }, trocken: true });
    expect(await T.main(["--dry-run"], a.deps)).toBe(0);
    expect(a.text).toEqual([]);
    expect(a.log.join("\n")).toContain("[dry-run] " + T.tagTitel("v1.2.4"));
  });
  it("anlegen: Ticket im Ziel-Repo mit Ziel-Token und Label, danach oben einsortiert, Exit 0", async () => {
    const a = aufbau();
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toHaveLength(1);
    const { args, opt } = a.text[0];
    expect(args.slice(0, 5)).toEqual(["issue", "create", "--repo", "o/ziel", "--title"]);
    expect(args[args.indexOf("--label") + 1]).toBe(FREMD.labels.harness);
    expect(opt).toEqual({ token: "zt" });
    expect(a.platziert).toEqual([["77", "tag", "pt", "o/ziel"]]);
    expect(a.log.join("\n")).toContain("Tag-Ticket angelegt: #77");
  });
  it("main verdrahtet migrationKey: die Zeile aus einem Besitz-Commit landet im angelegten Body (factory#139)", async () => {
    const mkey = `${FREMD.praefixe.commitZeile}Bezieher-Migration`;
    const eintrag = `\x1e${"1".repeat(40)}\x1f${new Date().toISOString()}\x1ffeat: x (#1)\n\n${mkey}: Konfig-Schluessel ergaenzen\x1f\n\nscripts/a.mjs\n`;
    const a = aufbau({ git: (args: string[]) => (args[0] === "tag" ? "v1.2.3\n" : args[0] === "rev-parse" ? `${SHA}\n` : commitLog(3) + eintrag) });
    expect(await T.main([], a.deps)).toBe(0);
    const body = String(a.text[0].args[a.text[0].args.indexOf("--body") + 1]);
    expect(body).toContain("Konfig-Schluessel ergaenzen");
  });
  it("main verdrahtet dringlichKey: Sync-Dringlich unter der Schwelle legt das Ticket an, der Grund steht im Body (factory#139)", async () => {
    const key = `${FREMD.praefixe.commitZeile}Sync-Dringlich`;
    const eintrag = `\x1e${"1".repeat(40)}\x1f${new Date().toISOString()}\x1ffix: x (#1)\n\n${key}: Sicherheitsfix\x1f\n\nscripts/a.mjs\n`;
    const a = aufbau({ git: (args: string[]) => (args[0] === "tag" ? "v1.2.3\n" : args[0] === "rev-parse" ? `${SHA}\n` : eintrag) });
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toHaveLength(1);
    const body = String(a.text[0].args[a.text[0].args.indexOf("--body") + 1]);
    expect(body).toContain("Dringlich: Sicherheitsfix");
  });
  it("gitEcht fängt stderr ab: ein fehlschlagender git-Aufruf schreibt nicht in das stderr des Prozesses, die Meldung bleibt im Fehler", () => {
    const w = mkdtempSync(join(tmpdir(), "tt-git-"));
    ordner.push(w);
    const skript = join(w, "kind.mjs");
    const lib = pathToFileURL(join(process.cwd(), "scripts", "tag-takt.mjs")).href;
    writeFileSync(skript, `import { gitEcht } from ${JSON.stringify(lib)};\ntry { gitEcht(["show", "HEAD:gibt-es-nicht.txt"]); } catch (e) { process.stdout.write(String(e.message)); }\n`);
    const r = spawnSync(process.execPath, [skript], { encoding: "utf8", cwd: process.cwd(), env: { ...process.env, LC_ALL: "C" }, stdio: ["ignore", "pipe", "pipe"] });
    expect(r.stderr).toBe("");
    expect(r.stdout).toContain("fatal");
  });
  it("Token kommt aus dem injizierten env, nicht aus process.env (factory#114 L9b)", async () => {
    const a = aufbau();
    const alt = process.env.PROJECT_TOKEN;
    delete process.env.PROJECT_TOKEN;
    try {
      expect(await T.main([], a.deps)).toBe(0);
      expect(a.platziert).toEqual([["77", "tag", "pt", "o/ziel"]]);
      process.env.PROJECT_TOKEN = "aus-prozess";
      const b = aufbau();
      b.deps.env = {};
      expect(await T.main([], b.deps)).toBe(0);
      expect(b.platziert.map((p) => p[2])).not.toContain("aus-prozess");
      expect(b.log.join("\n")).toContain("PROJECT_TOKEN fehlt");
      const c = aufbau();
      delete c.deps.env; // Standard: process.env
      expect(await T.main([], c.deps)).toBe(0);
      expect(c.platziert).toEqual([["77", "tag", "aus-prozess", "o/ziel"]]);
    } finally {
      if (alt === undefined) delete process.env.PROJECT_TOKEN;
      else process.env.PROJECT_TOKEN = alt;
    }
  });
  it("offenes Tag-Ticket mit altem Body: PATCH mit Titel und Body im Ziel-Repo, Exit 0", async () => {
    const a = aufbau();
    const offen = { number: 40, title: T.tagTitel("v1.2.4"), body: "alt", assignees: [] };
    a.deps.start = () => Promise.resolve({ config: FREMD, libs: { OWNER: "o", REPO: "o/r", ZIEL: "o/ziel", zielToken: () => "zt", ladeSammelKontext: () => ({ rohe: [offen] }), vertrauteIssues: (r: unknown[]) => r, frischeOffeneIssues: () => [], platziereOben: () => undefined }, trocken: false });
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toHaveLength(1);
    const { args, opt } = a.text[0];
    expect(args.slice(0, 4)).toEqual(["api", "-X", "PATCH", "repos/o/ziel/issues/40"]);
    expect(args[args.indexOf("-f") + 1]).toBe(`title=${T.tagTitel("v1.2.4")}`);
    expect(args.some((x) => x.startsWith("body=Besitz-Änderungen"))).toBe(true);
    expect(opt).toEqual({ token: "zt" });
  });
  it("Einsortieren wirft: Fehlermeldung und Exit 1", async () => {
    const a = aufbau();
    (a.deps.start as () => Promise<{ libs: Record<string, unknown> }>) = () => Promise.resolve({ config: FREMD, libs: { OWNER: "o", REPO: "o/r", ZIEL: "o/ziel", zielToken: () => "zt", ladeSammelKontext: () => ({ rohe: [] }), vertrauteIssues: () => [], frischeOffeneIssues: () => [], platziereOben: () => { throw new Error("Board kaputt"); } } } as never);
    expect(await T.main([], a.deps)).toBe(1);
    expect(a.log.join("\n")).toContain("Einsortieren von #77 an die Board-Spitze fehlgeschlagen");
  });
  it("git-Fehler beim Lesen: ::error:: und Exit 1, kein Schreibaufruf", async () => {
    const a = aufbau({ git: () => { throw new Error("fatal: kein Repo"); } });
    expect(await T.main([], a.deps)).toBe(1);
    expect(a.log.join("\n")).toContain("::error::Tag-Takt: Lesen fehlgeschlagen");
    expect(a.log.join("\n")).toContain("kein Repo");
    expect(a.text).toEqual([]);
  });
  it("gh-Fehler beim Anlegen: ::error:: und Exit 1", async () => {
    const a = aufbau({ ghText: () => { throw new Error("HTTP 403"); } });
    expect(await T.main([], a.deps)).toBe(1);
    expect(a.log.join("\n")).toContain("::error::Tag-Ticket (anlegen) nicht geschrieben");
  });
  it("ladeLog liest ohne Umbenennungs-Erkennung (--no-renames): der alte Pfad einer Umbenennung bleibt sichtbar", async () => {
    const a = aufbau();
    const args: string[][] = [];
    const roh = a.deps.git as (x: string[]) => string;
    a.deps.git = (x: string[]) => { args.push(x); return roh(x); };
    expect(await T.main([], a.deps)).toBe(0);
    expect(args.find((x) => x[0] === "log")).toContain("--no-renames");
  });
  it("git show wirft (zeigeDatei): die Datei zählt als fehlend, der Takt läuft weiter", async () => {
    const a = aufbau({ git: (args) => { if (args[0] === "show") throw new Error("fatal: Pfad nicht im Tag"); return args[0] === "tag" ? "v1.2.3\n" : args[0] === "rev-parse" ? `${SHA}\n` : commitLog(3); } });
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toHaveLength(1);
    expect(a.log.join("\n")).toContain("Tag-Ticket angelegt: #77");
  });
  it("Standard-ladeManifest liest relativ zur übergebenen wurzel, nicht zum cwd", async () => {
    const w = mkdtempSync(join(tmpdir(), "tt-"));
    ordner.push(w);
    mkdirSync(join(w, ".factory"));
    writeFileSync(join(w, ".factory", "besitz.json"), JSON.stringify({ eintraege: [{ pfad: "scripts/nur-in-der-wurzel.mjs", ring: "kern" }] }));
    const log = Array.from({ length: 3 }, (_, i) => `\x1e${String(i).repeat(40)}\x1f${new Date().toISOString()}\x1ffix: x (#${i + 1})\x1f\n\nscripts/nur-in-der-wurzel.mjs\n`).join("");
    const a = aufbau({ git: (args) => (args[0] === "tag" ? "v1.2.3\n" : args[0] === "rev-parse" ? `${SHA}\n` : args[0] === "show" ? "" : log) });
    delete a.deps.ladeManifest;
    a.deps.wurzel = w;
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toHaveLength(1);
  });
  it("Start-Fehler (Aufruf/Config): der Code des Starts wird durchgereicht", async () => {
    const a = aufbau({ start: { code: 2 } });
    expect(await T.main(["--bogus"], a.deps)).toBe(2);
    expect(a.text).toEqual([]);
  });
});

describe("tag-takt main: Vor-Tag-Probe (factory#188)", () => {
  const mitBezieher = (bezieher: unknown) => ({ ...FREMD, bezieher });
  const CI_LAUF = (conclusion: string | null, status = "completed") => [{ path: ".github/workflows/ci.yml", status, conclusion, html_url: "https://example.invalid/run/9" }];
  const probe = (argv: string[], config: unknown = mitBezieher(["o/a", "o/b"]), laeufe: unknown = CI_LAUF("success")) => {
    const a = aufbau({ ghJson: () => laeufe });
    a.deps.ladeConfig = () => config;
    return T.main(argv, a.deps).then((code) => ({ code, log: a.log, text: a.text }));
  };
  it("Trockenlauf mit Bezieher-Liste: die Vorschau enthält den Probe-Abschnitt und je Bezieher eine offene Zeile", async () => {
    const a = aufbau();
    a.deps.start = () => Promise.resolve({ config: mitBezieher(["o/a", "o/b"]), libs: { OWNER: "o", REPO: "o/r", ladeSammelKontext: () => ({ rohe: [] }), vertrauteIssues: () => [], frischeOffeneIssues: () => [] }, trocken: true });
    expect(await T.main(["--dry-run"], a.deps)).toBe(0);
    const aus = a.log.join("\n");
    expect(aus).toContain("[dry-run] Vor-Tag-Probe je Bezieher");
    expect(aus).toContain("[dry-run] - [ ] `o/a`: Probe ausstehend");
    expect(aus).toContain("[dry-run] - [ ] `o/b`: Probe ausstehend");
  });
  it("anlegen mit Bezieher-Liste: der Probe-Abschnitt steht im Body des angelegten Tickets", async () => {
    const a = aufbau({ start: undefined });
    a.deps.start = () => Promise.resolve({ config: mitBezieher(["o/a"]), libs: { OWNER: "o", REPO: "o/r", ZIEL: "o/ziel", ladeSammelKontext: () => ({ rohe: [] }), vertrauteIssues: () => [], frischeOffeneIssues: () => [], platziereOben: () => undefined }, trocken: false });
    expect(await T.main([], a.deps)).toBe(0);
    expect(JSON.stringify(a.text[0].args)).toContain("Probe ausstehend");
  });
  it("die Schreibweise --probe=<owner/name>=<exit> mit Gleichheitszeichen wird ebenfalls gelesen", async () => {
    const r = await probe(["--probe=o/a=0", "--probe=o/b=1"]);
    expect(r.code).toBe(1);
    expect(r.log.join("\n")).toContain("BLOCKER `o/b`");
  });
  it("CI des Commits rot: Exit 1 trotz grüner Bezieher, BLOCKER-Zeile, nicht taggen (K3)", async () => {
    const r = await probe(["--probe", "o/a=0", "--probe", "o/b=0"], undefined, CI_LAUF("failure"));
    expect(r.code).toBe(1);
    expect(r.log.join("\n")).toContain("- [ ] BLOCKER: CI des Commits aaaaaaa rot (enthält den Probe-Erstbezug), nicht taggen");
    expect(r.log.join("\n")).toContain("Vor-Tag-Probe: CI des Commits nicht grün: nicht taggen.");
  });
  it.each([
    ["läuft noch", CI_LAUF(null, "in_progress")],
    ["kein Lauf", []],
  ])("CI des Commits %s: Exit 1 (ausstehend, fail-closed)", async (_n, laeufe) => {
    const r = await probe(["--probe", "o/a=0", "--probe", "o/b=0"], undefined, laeufe);
    expect(r.code).toBe(1);
    expect(r.log.join("\n")).toContain("- [ ] CI des Commits aaaaaaa ausstehend, nicht taggen, bis grün");
  });
  it("probeEinstieg ohne ci (Standard) oder mit ci null ist ausstehend: Exit 1, auch bei grünen Bezieherinnen", () => {
    const deps = { ladeConfig: () => mitBezieher(["o/a"]), log: () => undefined, err: () => undefined };
    expect(T.probeEinstieg(["--probe", "o/a=0"], deps)).toBe(1);
    expect(T.probeEinstieg(["--probe", "o/a=0"], { ...deps, ci: null })).toBe(1);
    expect(T.probeEinstieg(["--probe", "o/a=0"], { ...deps, ci: { zustand: "gruen", url: null }, sha: SHA })).toBe(0);
  });
  it("CI-Abfrage wirft (gh-Fehler): ausstehend, Exit 1, kein Absturz", async () => {
    const a = aufbau({ ghJson: () => { throw new Error("gh kaputt"); } });
    a.deps.ladeConfig = () => mitBezieher(["o/a", "o/b"]);
    expect(await T.main(["--probe", "o/a=0", "--probe", "o/b=0"], a.deps)).toBe(1);
    expect(a.log.join("\n")).toContain("CI-Status nicht lesbar");
  });
  it("git rev-parse wirft: ausstehend, Exit 1, kein Absturz", async () => {
    const a = aufbau({ git: () => { throw new Error("kein git"); } });
    a.deps.ladeConfig = () => mitBezieher(["o/a", "o/b"]);
    expect(await T.main(["--probe", "o/a=0", "--probe", "o/b=0"], a.deps)).toBe(1);
    expect(a.log.join("\n")).toContain("Commit nicht lesbar");
  });
  it("die CI-Abfrage gilt dem HEAD-Commit des Checkouts (rev-parse) über den gh-Platzhalter, nicht einem festen Repo", async () => {
    const aufrufe: string[][] = [];
    const a = aufbau({ ghJson: (x) => { aufrufe.push(x); return CI_LAUF("success"); } });
    a.deps.ladeConfig = () => mitBezieher(["o/a"]);
    expect(await T.main(["--probe", "o/a=0"], a.deps)).toBe(0);
    expect(aufrufe).toEqual([["api", `repos/{owner}/{repo}/actions/runs?head_sha=${SHA}&event=push&per_page=30`, "--jq", ".workflow_runs"]]);
  });
  it("alle Bezieher grün, CI grün: Exit 0, beide abgehakt, CI-Zeile abgehakt, kein Ticket-Schreibzugriff", async () => {
    const r = await probe(["--probe", "o/a=0", "--probe", "o/b=0"]);
    expect(r.code).toBe(0);
    expect(r.log.join("\n")).toContain("- [x] CI grün (Probe-Erstbezug eingeschlossen)");
    expect(r.log.join("\n")).toContain("- [x] `o/a`: Probe grün");
    expect(r.log.join("\n")).not.toContain("Vor-Tag-Probe: BLOCKER");
    expect(r.log.join("\n")).not.toContain("Vor-Tag-Probe: ausstehend");
    expect(r.log.join("\n")).not.toContain("Vor-Tag-Probe: CI des Commits nicht grün");
    expect(r.text).toEqual([]);
  });
  it("nur ausstehend, kein Blocker: keine BLOCKER-Zeile; nur Blocker, nichts ausstehend: keine ausstehend-Zeile", async () => {
    const nurOffen = await probe(["--probe", "o/a=0"]);
    expect(nurOffen.log.join("\n")).not.toContain("Vor-Tag-Probe: BLOCKER");
    const nurRot = await probe(["--probe", "o/a=1", "--probe", "o/b=0"]);
    expect(nurRot.log.join("\n")).toContain("Vor-Tag-Probe: BLOCKER o/a");
    expect(nurRot.log.join("\n")).not.toContain("Vor-Tag-Probe: ausstehend");
  });
  it("Bezieher-Repo (Sync-Stand vorhanden): --probe tut nichts, Exit 0, keine Checkliste", async () => {
    const w = mkdtempSync(join(tmpdir(), "tt-"));
    ordner.push(w);
    mkdirSync(join(w, ".factory"));
    writeFileSync(join(w, ".factory", "sync-stand.json"), JSON.stringify({ version: 1, quelle: "q", tag: "v1.0.0" }));
    const a = aufbau();
    a.deps.wurzel = w;
    a.deps.ladeConfig = () => mitBezieher(["o/a"]);
    expect(await T.main(["--probe", "o/a=1"], a.deps)).toBe(0);
    expect(a.log.join("\n")).toContain("Bezieher-Repo (Sync-Stand vorhanden), nichts zu tun");
    expect(a.log.join("\n")).not.toContain("Probe grün");
  });
  it("Standard-ladeConfig liest die echte Projekt-Config: ein unbekanntes Repo nennt deren Liste, nicht eine eingebaute", async () => {
    const a = aufbau();
    expect(await T.main(["--probe", "o/zz-unbekannt=0"], a.deps)).toBe(2);
    const aus = a.log.join("\n");
    expect(aus).toContain("erwartet wird je Bezieher");
    expect(aus).not.toContain("Liste leer");
    expect(aus).not.toContain("x/y");
  });
  it("Negativfall: ein roter Bezieher ist ein BLOCKER, Exit 1", async () => {
    const r = await probe(["--probe", "o/a=0", "--probe", "o/b=2"]);
    expect(r.code).toBe(1);
    const aus = r.log.join("\n");
    expect(aus).toContain("BLOCKER `o/b`: Probe rot (Exit 2)");
    expect(aus).toContain("Vor-Tag-Probe: BLOCKER o/b");
  });
  it("ein mehrstelliger Exit-Wert (127, 255) wird angenommen und ist ein BLOCKER, kein Aufruf-Fehler", async () => {
    const r = await probe(["--probe", "o/a=127", "--probe", "o/b=255"]);
    expect(r.code).toBe(1);
    const aus = r.log.join("\n");
    expect(aus).toContain("BLOCKER `o/a`: Probe rot (Exit 127)");
    expect(aus).toContain("BLOCKER `o/b`: Probe rot (Exit 255)");
  });
  it("fail-closed: ein Bezieher ohne Ergebnis bleibt ausstehend, Exit 1", async () => {
    const r = await probe(["--probe", "o/a=0"]);
    expect(r.code).toBe(1);
    expect(r.log.join("\n")).toContain("Vor-Tag-Probe: ausstehend o/b");
  });
  it("factory#215 L3: die Repo-Schreibweise ist egal (GitHub unterscheidet nicht), Ausgabe und Zuordnung unter dem Namen der Config", async () => {
    const r = await probe(["--probe", "O/A=0", "--probe", "o/B=1"]);
    expect(r.code).toBe(1);
    const aus = r.log.join("\n");
    expect(aus).toContain("- [x] `o/a`: Probe grün");
    expect(aus).toContain("BLOCKER `o/b`: Probe rot (Exit 1)");
    expect(aus).not.toContain("ausstehend");
    expect((await probe(["--probe", "O/A=0", "--probe", "O/b=0"])).code).toBe(0);
  }, 10_000);
  it("factory#215 L3: dasselbe Repo in anderer Schreibweise doppelt ist ein Aufruf-Fehler (Exit 2)", async () => {
    expect((await probe(["--probe", "o/a=0", "--probe", "O/A=1"])).code).toBe(2);
  });
  it("factory#215 L5: <owner/name>=rest ist grün mit Projekt-Rest (Exit 0, Befund-Hinweis), kein Blocker", async () => {
    const r = await probe(["--probe", "o/a=rest", "--probe", "o/b=0"]);
    expect(r.code).toBe(0);
    const aus = r.log.join("\n");
    expect(aus).toContain("- [x] `o/a`: Probe grün mit Projekt-Rest (Befund bzw. Bezieher-Migration festhalten, kein Blocker)");
    expect(aus).toContain("Vor-Tag-Probe: Projekt-Rest bei o/a: als Befund festhalten.");
    expect(aus).not.toContain("BLOCKER");
  });
  it("factory#215 L5: rest ersetzt kein fehlendes Ergebnis (Bezieher ohne Ergebnis bleibt ausstehend, Exit 1)", async () => {
    const r = await probe(["--probe", "o/a=rest"]);
    expect(r.code).toBe(1);
    expect(r.log.join("\n")).toContain("Vor-Tag-Probe: ausstehend o/b");
  });
  it.each([
    [["--probe", "o/fremd=0"]],
    [["--probe", "o/a=REST"]],
    [["--probe", "o/a=rest2"]],
    [["--probe", "o/a=abc"]],
    [["--probe", "o/a"]],
    [["--probe", "o/a=0", "--probe", "o/a=1"]],
    [["--probe"]],
    [["--probe", "o/a=0", "--dry-run"]],
    [["--probe", "o/a=1000"]],
    [["--probe", "o/a=0x"]],
    [["--probe", "o/a="]],
    [["--probe", "x=o/a=0"]],
  ])("Aufruf-Fehler %j: Exit 2", async (argv) => {
    const r = await probe(argv);
    expect(r.code).toBe(2);
  });
  it("unlesbare Projekt-Config: Exit 2 mit Meldung, kein Stacktrace", async () => {
    const a = aufbau();
    a.deps.ladeConfig = () => { throw new Error("kaputt"); };
    expect(await T.main(["--probe", "o/a=0"], a.deps)).toBe(2);
    expect(a.log.join("\n")).toContain("Tag-Takt: Projekt-Config nicht lesbar");
  });
  it("ohne gelistete Bezieher ist jedes --probe ein unbekanntes Repo: Exit 2", async () => {
    const r = await probe(["--probe", "o/a=0"], mitBezieher(undefined));
    expect(r.code).toBe(2);
  });
});

describe("manifestLaden (Standard-Lader)", () => {
  const laden = (raw as unknown as { manifestLaden: (wurzel: string) => unknown }).manifestLaden;
  const wurzel = (inhalt?: string): string => {
    const w = mkdtempSync(join(tmpdir(), "tt-"));
    ordner.push(w);
    mkdirSync(join(w, ".factory"));
    if (inhalt !== undefined) writeFileSync(join(w, ".factory", "besitz.json"), inhalt);
    return w;
  };
  it("liefert das Manifest unter der Wurzel", () => {
    expect(laden(wurzel('{"eintraege":[]}'))).toEqual({ eintraege: [] });
  });
  it.each([
    [undefined, /\.factory\/besitz\.json fehlt/],
    ["kein json", /kein gültiges JSON/],
    ['{"version":1}', /keine Liste 'eintraege'/],
  ])("wirft die einheitliche Meldung bei %j", (inhalt, muster) => {
    expect(() => laden(wurzel(inhalt))).toThrow(muster);
  });
});

describe("tag-takt main: Milestones (factory#194)", () => {
  const TAG_DATUM = "2026-06-10T00:00:00+00:00";
  const gitMit = (datum: string) => (args: string[]) => (args[0] === "tag" ? "v1.2.3\n" : args[0] === "rev-parse" ? `${SHA}\n` : args[0] === "for-each-ref" ? `${datum}\n` : commitLog(1));
  const seiten = (closed: string | null) => [[{ number: 7, title: "Erste Stufe", closed_at: closed }]];
  const aus = (o: { datum?: string; json?: (a: string[]) => unknown }) =>
    aufbau({ git: gitMit(o.datum ?? TAG_DATUM), ghJson: (a) => (a.some((x) => x.includes("/milestones?")) ? (o.json ?? (() => seiten("2026-06-15T00:00:00Z")))(a) : []) });

  it("ein nach dem Tag geschlossener Milestone legt das Ticket schon bei 1 Besitz-PR an; die REST-Abfrage ist paginiert und nur für geschlossene", async () => {
    const aufrufe: string[][] = [];
    const a = aus({ json: (args) => (aufrufe.push(args), seiten("2026-06-15T00:00:00Z")) });
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toHaveLength(1);
    expect(String(a.text[0].args[a.text[0].args.indexOf("--body") + 1])).toContain("Milestone „Erste Stufe“ geschlossen");
    expect(aufrufe[0]).toEqual(["api", "--paginate", "--slurp", "repos/o/r/milestones?state=closed&per_page=100"]);
  });
  it("Negativfall: ein vor dem Tag geschlossener Milestone ändert nichts (1 Besitz-PR: nichts), wie ohne Milestones", async () => {
    const a = aus({ json: () => seiten("2026-06-01T00:00:00Z") });
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toEqual([]);
    expect(await T.main([], aufbau({ git: gitMit(TAG_DATUM) }).deps)).toBe(0);
  });
  it("ohne geschlossene Milestones wird das Tag-Datum gar nicht gelesen", async () => {
    const gelesen: string[][] = [];
    const a = aufbau({ git: (args) => (args[0] === "for-each-ref" ? (gelesen.push(args), "x") : gitMit(TAG_DATUM)(args)), ghJson: () => [] });
    expect(await T.main([], a.deps)).toBe(0);
    expect(gelesen).toEqual([]);
  });
  it("unlesbare Milestones oder nicht parsebares Tag-Datum: Warnung, kein Milestone-Auslöser, Lauf geht weiter (fail-open)", async () => {
    const kaputt = aus({ json: () => { throw new Error("boom"); } });
    expect(await T.main([], kaputt.deps)).toBe(0);
    expect(kaputt.text).toEqual([]);
    expect(kaputt.log.join("\n")).toContain("::warning::Milestones nicht lesbar (boom): Milestone-Auslöser entfällt");
    const form = aus({ json: () => ({}) });
    expect(await T.main([], form.deps)).toBe(0);
    expect(form.log.join("\n")).toContain("::warning::Milestones nicht lesbar");
    const datum = aus({ datum: "kein Datum" });
    expect(await T.main([], datum.deps)).toBe(0);
    expect(datum.text).toEqual([]);
    expect(datum.log.join("\n")).toContain("Datum von v1.2.3 nicht lesbar");
  });
  it("ein wieder geöffneter Milestone (closed_at null) zählt nicht", async () => {
    const a = aus({ json: () => seiten(null) });
    expect(await T.main([], a.deps)).toBe(0);
    expect(a.text).toEqual([]);
  });
});
