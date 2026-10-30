/* main() des Tag-Takts über injizierte Nähte (#101 L23, Muster test/secret-inbox.test.ts): Trockenlauf, Anlegen, git- und gh-Fehler. */
import { describe, expect, it } from "vitest";
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
    git, wurzel: "Z:/gibt-es-nicht", ladeManifest: () => MANIFEST,
  };
  return { deps, log, text, platziert };
}

async function mitToken<R>(f: () => Promise<R>): Promise<R> {
  const alt = process.env.PROJECT_TOKEN;
  process.env.PROJECT_TOKEN = "pt";
  try {
    return await f();
  } finally {
    if (alt === undefined) delete process.env.PROJECT_TOKEN;
    else process.env.PROJECT_TOKEN = alt;
  }
}

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
    expect(await mitToken(() => T.main([], a.deps))).toBe(0);
    expect(a.text).toHaveLength(1);
    const { args, opt } = a.text[0];
    expect(args.slice(0, 5)).toEqual(["issue", "create", "--repo", "o/ziel", "--title"]);
    expect(args[args.indexOf("--label") + 1]).toBe(FREMD.labels.harness);
    expect(opt).toEqual({ token: "zt" });
    expect(a.platziert).toEqual([["77", "tag", "pt", "o/ziel"]]);
    expect(a.log.join("\n")).toContain("Tag-Ticket angelegt: #77");
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
    expect(await mitToken(() => T.main([], a.deps))).toBe(1);
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
    expect(await mitToken(() => T.main([], a.deps))).toBe(1);
    expect(a.log.join("\n")).toContain("::error::Tag-Ticket (anlegen) nicht geschrieben");
  });
  it("Start-Fehler (Aufruf/Config): der Code des Starts wird durchgereicht", async () => {
    const a = aufbau({ start: { code: 2 } });
    expect(await T.main(["--bogus"], a.deps)).toBe(2);
    expect(a.text).toEqual([]);
  });
});
