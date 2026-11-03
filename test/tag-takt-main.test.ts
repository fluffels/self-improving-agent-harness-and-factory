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
const T = raw as unknown as { main: (argv: string[], deps: Deps) => Promise<number>; tagTitel: (t: string) => string };

const SHA = "a".repeat(40);
const commitLog = (n: number) =>
  Array.from({ length: n }, (_, i) => `\x1e${String(i).repeat(40)}\x1f${new Date().toISOString()}\x1ffix: x (#${i + 1})\x1f\n\nscripts/a.mjs\n`).join("");
const MANIFEST = { eintraege: [{ pfad: "scripts/a.mjs", ring: "kern" }] };

function aufbau(o: { git?: (a: string[]) => string; ghText?: (a: string[]) => string; start?: unknown; commits?: number } = {}) {
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
      json: () => [],
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
    const r = spawnSync(process.execPath, [skript], { encoding: "utf8", cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
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
