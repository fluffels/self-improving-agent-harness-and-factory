/* Arbeitsplatz (#87, ADR 0022 Fortschreibung): Config-Block, Resolver, Worktree-Befehl, Harness-Spuren und die CLI samt echtem Git.
 *
 * @harness-waechter – einziger Durchsetzer des Arbeitsplatz-Vertrags (Block-Prüfung, Spur-Liste, Befehl zeichengleich zu AGENTS.md), darum im geschützten test/harness/.
 *
 * Fixtures tragen nur neutrale Namen (`web`, `api`); das Worktree-Präfix kommt aus der Fremd-Config.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../../scripts/arbeitsplatz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../../scripts/arbeitsplatz.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as pcRaw from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRaw from "../../scripts/ticket-namen.mjs";

type Repo = { name: string; pfad: string; worktreeOrdner: string };
type Aufloesung = { betriebsart: string; wurzel: string; repos: Repo[] };
const L = libRaw as unknown as {
  arbeitsplatzMaengel: (b: unknown, o?: { worktreePraefix?: string }) => string[];
  arbeitsplatzAus: (c: unknown, basis: string) => Aufloesung;
  worktreeBefehl: (o: { aufloesung: Aufloesung; repo: Repo; worktreeName: string; branchName: string }) => string;
  harnessSpuren: (z: string, o?: { dateiMuster?: RegExp }) => { status: string; pfad: string }[];
  istRepoName: (n: unknown) => boolean;
  istRelativPosix: (p: string) => boolean;
};
const C = cliRaw as unknown as {
  cli: (argv: string[], o?: { wurzel?: string; git?: (a: string[], cwd: string) => { ok: boolean; stdout: string }; out?: (s: string) => void; err?: (s: string) => void }) => number;
};
const PC = pcRaw as unknown as { pruefeProjektConfig: (c: unknown) => string[] };
const N = namenRaw as unknown as { ticketNamen: (c: unknown) => { worktreeName: (n: number | string) => string; branchName: (n: number | string, s: string) => string; dateiMuster: RegExp } };

const WT = FREMD.praefixe.worktree;
const GUELTIG = { wurzel: ".", repos: [{ name: "web", pfad: "web" }, { name: "api", pfad: "dienste/api" }] };
const mit = (block: unknown) => PC.pruefeProjektConfig({ ...FREMD, arbeitsplatz: block });
const repo = (r: object) => ({ ...GUELTIG, repos: [r] });

describe("Config-Block arbeitsplatz (K1)", () => {
  test("gültiger Block und fehlender Block sind ohne Fehler", () => {
    expect(mit(GUELTIG)).toEqual([]);
    expect(PC.pruefeProjektConfig(FREMD)).toEqual([]);
  });

  test("kein Objekt, unbekannter Schlüssel, fehlende oder leere wurzel", () => {
    expect(mit("x").join("|")).toMatch(/arbeitsplatz muss ein Objekt/);
    expect(mit({ ...GUELTIG, extra: 1 }).join("|")).toMatch(/arbeitsplatz\.extra ist unbekannt/);
    expect(mit({ repos: GUELTIG.repos }).join("|")).toMatch(/arbeitsplatz\.wurzel muss ein nicht-leerer String/);
    expect(mit({ ...GUELTIG, wurzel: " " }).join("|")).toMatch(/arbeitsplatz\.wurzel muss ein nicht-leerer String/);
  });

  test("repos fehlt, ist leer oder keine Liste", () => {
    for (const repos of [undefined, [], "web", {}]) expect(mit({ wurzel: ".", repos }).join("|")).toMatch(/arbeitsplatz\.repos muss eine nicht-leere Liste/);
  });

  test("Repo: kein Objekt und unbekannter Schlüssel", () => {
    expect(mit({ ...GUELTIG, repos: ["web"] }).join("|")).toMatch(/repos\[0\] muss ein Objekt/);
    expect(L.arbeitsplatzMaengel({ wurzel: ".", repos: [null] })).toEqual(["arbeitsplatz.repos[0] muss ein Objekt { name, pfad } sein"]);
    expect(mit(repo({ name: "web", pfad: "web", x: 1 })).join("|")).toMatch(/repos\[0\]\.x ist unbekannt/);
  });

  test("ungültiger Name", () => {
    for (const name of ["", ".", "..", "a/b", "a b", "-a", 7, undefined]) {
      expect(mit(repo({ name, pfad: "web" })).join("|"), String(name)).toMatch(/\.name .* ist ungültig/);
    }
  });

  test("Name beginnt wie ein Worktree-Name, ein ähnlicher Name ohne Ziffer ist erlaubt", () => {
    expect(mit(repo({ name: `${WT}7`, pfad: "web" })).join("|")).toMatch(/beginnt wie ein Worktree-Name/);
    expect(mit(repo({ name: `${WT}x`, pfad: "web" }))).toEqual([]);
    expect(mit(repo({ name: `${WT.toUpperCase()}7`, pfad: "web" })).join("|")).toMatch(/beginnt wie ein Worktree-Name/);
  });

  test("doppelte Namen, auch nur in der Groß-/Kleinschreibung", () => {
    expect(mit({ ...GUELTIG, repos: [{ name: "web", pfad: "a" }, { name: "web", pfad: "b" }] }).join("|")).toMatch(/repos\[1\]\.name "web" kommt doppelt vor/);
    expect(mit({ ...GUELTIG, repos: [{ name: "Web", pfad: "a" }, { name: "web", pfad: "b" }] }).join("|")).toMatch(/kommt doppelt vor/);
  });

  test("ein Repo, das die Wurzel enthält", () => {
    for (const pfad of [".", "..", "../..", "./"]) expect(mit(repo({ name: "web", pfad })).join("|"), pfad).toMatch(/enthält die Wurzel/);
  });

  test("Pfad außerhalb der Wurzel, absolut, mit Backslash oder Laufwerk, leer", () => {
    expect(mit(repo({ name: "web", pfad: "../web" })).join("|")).toMatch(/außerhalb der Wurzel/);
    for (const pfad of ["/web", "a\\b", ["C:", "web"].join("/"), "a//b"]) expect(mit(repo({ name: "web", pfad })).join("|"), pfad).toMatch(/relativer POSIX-Pfad/);
    expect(mit(repo({ name: "web" })).join("|")).toMatch(/\.pfad muss ein nicht-leerer String/);
  });

  test("Worktree-Ordner liegt in einem Repo", () => {
    for (const pfad of [".claude", ".claude/worktrees", ".claude/worktrees/web", ".claude/worktrees/x/y"]) {
      expect(mit(repo({ name: "web", pfad })).join("|"), pfad).toMatch(/überschneidet den Worktree-Ordner/);
    }
    expect(mit(repo({ name: "web", pfad: ".claude-x/web" }))).toEqual([]);
    expect(mit(repo({ name: "web", pfad: ".claude/worktreesx" }))).toEqual([]);
  });

  test("istRepoName und istRelativPosix", () => {
    expect(L.istRepoName("web-1.x_y")).toBe(true);
    expect(L.istRepoName("a b")).toBe(false);
    expect(L.istRelativPosix("src/a")).toBe(true);
    expect(L.istRelativPosix("src/")).toBe(false);
    expect(L.istRelativPosix("../a")).toBe(false);
  });
});

describe("Resolver arbeitsplatzAus (K2)", () => {
  test("ohne Block: eingebettet, Repo = Basis, Worktree-Ordner <repo>/.claude/worktrees, Name aus config.repo", () => {
    const basis = resolve("x", "proj").split("\\").join("/");
    const a = L.arbeitsplatzAus(FREMD, "x\\proj"); // relativ und mit Backslash: resolve und Slash-Umwandlung greifen auf beiden Plattformen
    expect(a.betriebsart).toBe("eingebettet");
    expect(a.wurzel).toBe(basis);
    expect(a.repos).toEqual([{ name: FREMD.repo.split("/")[1], pfad: basis, worktreeOrdner: `${basis}/.claude/worktrees` }]);
    expect(L.arbeitsplatzAus({}, "/a/b").repos[0].name).toBe("b");
  });

  test("mit Block: Wurzel relativ zur Basis, Repo-Pfade unter der Wurzel, Worktree-Ordner je Name", () => {
    const a = L.arbeitsplatzAus({ ...FREMD, arbeitsplatz: { wurzel: "ap", repos: GUELTIG.repos } }, "/basis");
    expect(a.betriebsart).toBe("arbeitsplatz");
    const w = a.wurzel;
    expect(w.endsWith("/basis/ap")).toBe(true);
    expect(a.repos).toEqual([
      { name: "web", pfad: `${w}/web`, worktreeOrdner: `${w}/.claude/worktrees/web` },
      { name: "api", pfad: `${w}/dienste/api`, worktreeOrdner: `${w}/.claude/worktrees/api` },
    ]);
  });

  test("Wurzel / bleibt /", () => {
    expect(L.arbeitsplatzAus({ ...FREMD, arbeitsplatz: { wurzel: "/", repos: GUELTIG.repos } }, "/basis").wurzel).toBe("/");
  });

  test("absolute Wurzel wird übernommen, Backslashes werden zu Schrägstrichen", () => {
    expect(L.arbeitsplatzAus({ ...FREMD, arbeitsplatz: { wurzel: "/abs/ap/", repos: GUELTIG.repos } }, "/basis").wurzel).toBe("/abs/ap");
  });

  test("kaputter Block wirft mit Fix-Zeile", () => {
    expect(() => L.arbeitsplatzAus({ ...FREMD, arbeitsplatz: { wurzel: ".", repos: [] } }, "/b")).toThrow(/repos muss eine nicht-leere Liste[\s\S]*Fix: /);
  });
});

describe("Worktree-Befehl (K2, K3)", () => {
  const n = N.ticketNamen(FREMD);
  const ein = L.arbeitsplatzAus(FREMD, "/proj");
  const ap = L.arbeitsplatzAus({ ...FREMD, arbeitsplatz: GUELTIG }, "/ap");
  const args = (aufloesung: Aufloesung, r: Repo) => ({ aufloesung, repo: r, worktreeName: n.worktreeName(7), branchName: n.branchName(7, "x") });

  test("eingebettet: zeichengleich der Befehl aus AGENTS.md (Drift-Wächter)", () => {
    const zeile = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf8").split("\n").find((l) => l.includes("Eigener Worktree von frisch geholtem"));
    const vorlage = /`(git fetch origin[^`]*)`/.exec(zeile ?? "")?.[1];
    expect(vorlage).toBeTruthy();
    const erwartet = (vorlage ?? "").replaceAll("<praefixe.worktree>", WT).replaceAll("<praefixe.branch>", FREMD.praefixe.branch).replace("<nr>", "7").replace("<nr>", "7").replace("<slug>", "x");
    expect(L.worktreeBefehl(args(ein, ein.repos[0]))).toBe(erwartet);
  });

  test("Arbeitsplatz: git -C auf das Repo, Worktree außerhalb unter <wurzel>/.claude/worktrees/<name>", () => {
    const w = ap.wurzel;
    expect(L.worktreeBefehl(args(ap, ap.repos[0]))).toBe(
      `git -C ${w}/web fetch origin && git -C ${w}/web worktree add ${w}/.claude/worktrees/web/${WT}7 -b ${FREMD.praefixe.branch}7-x origin/main`,
    );
  });

  test("Pfade mit Leerraum stehen in Anführungszeichen", () => {
    const leer = L.arbeitsplatzAus({ ...FREMD, arbeitsplatz: GUELTIG }, "/a b");
    const befehl = L.worktreeBefehl(args(leer, leer.repos[0]));
    expect(befehl).toContain(`git -C "${leer.wurzel}/web" fetch`);
    expect(befehl).toContain(`worktree add "${leer.wurzel}/.claude/worktrees/web/${WT}7"`);
  });
});

describe("harnessSpuren (K5, pur)", () => {
  const z = (...e: string[]) => e.join("\0") + "\0";
  const dateiMuster = N.ticketNamen(FREMD).dateiMuster;
  const pfade = (s: string) => L.harnessSpuren(s, { dateiMuster }).map((x) => `${x.status} ${x.pfad}`);

  test.each([
    "?? .claude/",
    "!! .claude/settings.local.json",
    "?? AGENTS.md",
    "?? sub/CLAUDE.local.md",
    "?? CLAUDE.md",
    "?? .agents/",
    "!! .factory/",
    "?? .codex/",
    "?? .Claude/",
    "!! .FACTORY/",
    "?? .Agents/x",
    "?? .CODEX/",
    `?? ${WT}7/`,
    `?? ${WT}7-lens-r1/`,
    `?? ${WT.toUpperCase()}7/`,
  ])("meldet %s", (eintrag) => {
    expect(pfade(z(eintrag))).toEqual([eintrag]);
  });

  test.each(["?? src/neu.ts", "!! dist/", "!! node_modules/", " M AGENTS.md", "M  .claude/x", `?? ${WT}x/`, "?? readme.md"])("meldet %s nicht", (eintrag) => {
    expect(pfade(z(eintrag))).toEqual([]);
  });

  test("Rename-Eintrag: das Folgefeld ist kein eigener Eintrag", () => {
    expect(pfade(z("R  neu", "?? AGENTS.md"))).toEqual([]);
    expect(pfade(z("R  neu", "?? AGENTS.md", "?? CLAUDE.md"))).toEqual(["?? CLAUDE.md"]);
    expect(pfade(z("C  kopie", "?? AGENTS.md"))).toEqual([]);
  });

  test("leere Ausgabe und ohne dateiMuster gibt es keine Worktree-Treffer", () => {
    expect(pfade("")).toEqual([]);
    expect(L.harnessSpuren(z(`?? ${WT}7/`))).toEqual([]);
  });
});

describe("cli: Aufruf, pfade, worktree, sauber (Fehlerwege)", () => {
  const lauf = (argv: string[], extra: Parameters<typeof C.cli>[1] = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = C.cli(argv, { out: (s) => out.push(s), err: (s) => err.push(s), ...extra });
    return { code, out: out.join("\n"), err: err.join("\n") };
  };
  let dir = "";
  const schreibe = (arbeitsplatz?: unknown) => {
    const d = mkdtempSync(join(tmpdir(), "arbeitsplatz-cli-"));
    mkdirSync(join(d, ".factory"), { recursive: true });
    writeFileSync(join(d, ".factory", "projekt.json"), JSON.stringify(arbeitsplatz === undefined ? FREMD : { ...FREMD, arbeitsplatz }));
    return d;
  };
  beforeAll(() => {
    dir = realpathSync.native(schreibe(GUELTIG));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("unbekannter oder fehlender Befehl, zu viele Argumente: Exit 2 mit Aufruf", () => {
    expect(lauf([]).code).toBe(2);
    expect(lauf(["foo"]).err).toMatch(/Aufruf: node scripts\/arbeitsplatz\.mjs/);
    expect(lauf(["pfade", "x"]).code).toBe(2);
  });

  test("Config nicht lesbar: Exit 1 mit Meldung", () => {
    const l = lauf(["pfade", "--wurzel", join(dir, "gibt-es-nicht")]);
    expect(l.code).toBe(1);
    expect(l.err).toMatch(/Projekt-Config fehlt/);
  });

  test("pfade im Arbeitsplatz nennt Wurzel, Repos und Worktree-Ordner", () => {
    const l = lauf(["pfade", "--wurzel", dir]);
    expect(l.code).toBe(0);
    expect(l.out).toMatch(/betriebsart: arbeitsplatz/);
    expect(l.out).toMatch(/repo web: .*\/web \(worktrees: .*\/\.claude\/worktrees\/web\)/);
    expect(l.out).toMatch(/repo api: .*\/dienste\/api/);
  });

  test("worktree: Aufruf-Fehler (nr, slug, Repo mehrdeutig oder unbekannt)", () => {
    for (const argv of [["worktree", "0", "x"], ["worktree", "abc", "x"], ["worktree", "7x", "x"], ["worktree", "x7", "x"], ["worktree", "7"], ["worktree", "7", "a b"]]) {
      expect(lauf([...argv, "--wurzel", dir, "--repo", "web"]).code, argv.join(" ")).toBe(2);
    }
    expect(lauf(["worktree", "7", "x", "--wurzel", dir]).err).toMatch(/mehrere Repos.*web, api/);
    expect(lauf(["worktree", "7", "x", "--wurzel", dir, "--repo", "nix"]).err).toMatch(/unbekanntes Repo "nix"/);
  });

  test("worktree mit --repo gibt den Befehl aus", () => {
    const l = lauf(["worktree", "7", "x", "--wurzel", dir, "--repo", "api"]);
    expect(l.code).toBe(0);
    expect(l.out).toContain(`worktree add ${dir.replace(/\\/g, "/")}/.claude/worktrees/api/${WT}7 -b ${FREMD.praefixe.branch}7-x origin/main`);
  });

  test("sauber eingebettet: Hinweis, Exit 0, kein Git-Aufruf", () => {
    const d = schreibe();
    try {
      const l = lauf(["sauber", "--wurzel", d], { git: () => { throw new Error("kein git"); } });
      expect(l.code).toBe(0);
      expect(l.out).toMatch(/eingebettet: Harness liegt bewusst im Repo/);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test("sauber: Git-Fehler (kein Repo) ist Exit 1, eine Spur ist Exit 1 mit Eintrag, sauberer Status Exit 0", () => {
    const fehler = lauf(["sauber", "--wurzel", dir, "--repo", "web"], { git: () => ({ ok: false, stdout: "not a git repository" }) });
    expect(fehler.code).toBe(1);
    expect(fehler.err).toMatch(/✖ web: git status schlug fehl/);
    const spur = lauf(["sauber", "--wurzel", dir, "--repo", "web"], { git: () => ({ ok: true, stdout: "?? AGENTS.md\0" }) });
    expect(spur.code).toBe(1);
    expect(spur.err).toMatch(/✖ web: \?\? AGENTS\.md[\s\S]*Fix: /);
    const ok = lauf(["sauber", "--wurzel", dir], { git: () => ({ ok: true, stdout: " M src/a.ts\0" }) });
    expect(ok.code).toBe(0);
    expect(ok.out).toMatch(/✔ web: keine Harness-Spur[\s\S]*✔ api/);
    expect(lauf(["sauber", "--wurzel", dir, "--repo", "nix"]).code).toBe(2);
    const gemischt = lauf(["sauber", "--wurzel", dir], { git: (_a, cwd) => (cwd.endsWith("/web") ? { ok: false, stdout: "kein Repo" } : { ok: true, stdout: "?? AGENTS.md\0" }) });
    expect(gemischt.code).toBe(1);
    expect(gemischt.err).toMatch(/✖ web: git status schlug fehl[\s\S]*✖ api: \?\? AGENTS\.md/);
  });

  test("ohne --wurzel gilt die Wurzel der Option (im Skript: sein Repo), hier eine Temp-Config ohne Arbeitsplatz-Block statt der echten Repo-Config (#101 L14); ohne Option zu arbeitsplatzMaengel gilt der Standard", () => {
    const eingebettet = realpathSync.native(schreibe());
    try {
      const l = lauf(["pfade"], { wurzel: eingebettet });
      expect(l.code).toBe(0);
      expect(l.out).toMatch(/betriebsart: eingebettet/);
      expect(l.out).toContain(`wurzel: ${eingebettet.split("\\").join("/")}`);
    } finally {
      rmSync(eingebettet, { recursive: true, force: true });
    }
    expect(L.arbeitsplatzMaengel(GUELTIG)).toEqual([]);
  });
});

describe("Integration mit echtem Git (K3, K5)", { timeout: 120_000 }, () => {
  let basis = "";
  let ap = "";
  let web = "";
  const hooks = () => join(basis, "keine-hooks");
  // Ohne GIT_*-Variablen der Umgebung; globale Hooks abgeschirmt, damit das Temp-Repo isoliert bleibt.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: "",
  };
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", `core.hooksPath=${hooks()}`, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8", stdio: "pipe", env: { ...env, GIT_CONFIG_VALUE_0: hooks() } });
  const sauber = (...extra: string[]) => {
    const err: string[] = [];
    const code = C.cli(["sauber", "--wurzel", ap, "--repo", "web", ...extra], { out: () => undefined, err: (s) => err.push(s) });
    return { code, err: err.join("\n") };
  };
  const entfernen = (p: string) => rmSync(p, { recursive: true, force: true });

  beforeAll(() => {
    basis = realpathSync.native(mkdtempSync(join(tmpdir(), "arbeitsplatz-git-")));
    mkdirSync(hooks());
    const origin = join(basis, "origin.git");
    const quelle = join(basis, "quelle");
    ap = join(basis, "ap");
    web = join(ap, "web");
    mkdirSync(quelle);
    git(quelle, "init", "-q", "-b", "main");
    writeFileSync(join(quelle, "README.md"), "x\n");
    git(quelle, "add", "-A");
    git(quelle, "commit", "-q", "-m", "init");
    git(basis, "clone", "-q", "--bare", quelle, origin);
    mkdirSync(ap);
    git(ap, "clone", "-q", origin, "web");
    mkdirSync(join(ap, ".factory"));
    writeFileSync(join(ap, ".factory", "projekt.json"), JSON.stringify({ ...FREMD, arbeitsplatz: { wurzel: ".", repos: [{ name: "web", pfad: "web" }] } }));
  }, 60_000);
  afterAll(() => rmSync(basis, { recursive: true, force: true }));

  test("der Worktree entsteht über den ausgegebenen Befehl außerhalb des Repos, sauber meldet Exit 0, git status zeigt nur die Produktänderung", () => {
    const aus: string[] = [];
    expect(C.cli(["worktree", "7", "probe", "--wurzel", ap], { out: (s) => aus.push(s), err: () => undefined })).toBe(0);
    execSync(aus[0], { cwd: ap, env: { ...env, GIT_CONFIG_VALUE_0: hooks() }, stdio: "pipe" });
    const wt = join(ap, ".claude", "worktrees", "web", `${WT}7`);
    expect(existsSync(wt)).toBe(true);
    expect(relative(web, wt).startsWith("..")).toBe(true);
    writeFileSync(join(web, "README.md"), "geändert\n");
    expect(git(web, "status", "--porcelain", "--ignored").trimEnd()).toBe(" M README.md");
    expect(sauber().code).toBe(0);
    git(web, "checkout", "--", "README.md");
  });

  test("Negativfall: ein Worktree im Repo, eine Harness-Datei (ungetrackt oder ignoriert) macht sauber rot mit dem Eintrag", () => {
    const faelle: [string, () => void, string, RegExp][] = [
      ["Worktree-Ordner", () => mkdirSync(join(web, ".claude", "worktrees", "x"), { recursive: true }), join(web, ".claude"), /\?\? \.claude\//],
      ["AGENTS.md", () => writeFileSync(join(web, "AGENTS.md"), "x"), join(web, "AGENTS.md"), /\?\? AGENTS\.md/],
      ["Worktree-Name", () => mkdirSync(join(web, `${WT}7`)), join(web, `${WT}7`), new RegExp(`\\?\\? ${WT}7/`)],
    ];
    for (const [name, anlegen, weg, muster] of faelle) {
      anlegen();
      if (name === "Worktree-Ordner") writeFileSync(join(web, ".claude", "worktrees", "x", "f"), "x");
      if (name === "Worktree-Name") writeFileSync(join(web, `${WT}7`, "f"), "x");
      const r = sauber();
      expect(r.code, name).toBe(1);
      expect(r.err, name).toMatch(muster);
      entfernen(weg);
      expect(sauber().code, `${name} weg`).toBe(0);
    }
  });

  test("Negativfall ignoriert: eine ignorierte .claude/settings.local.json meldet `!!`; ein ignoriertes dist/ ist keine Spur", () => {
    writeFileSync(join(web, ".gitignore"), ".claude/settings.local.json\ndist/\n");
    mkdirSync(join(web, ".claude"));
    writeFileSync(join(web, ".claude", "settings.local.json"), "{}");
    mkdirSync(join(web, "dist"));
    writeFileSync(join(web, "dist", "a.js"), "x");
    const r = sauber();
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/!! \.claude\//);
    expect(r.err).not.toMatch(/dist/);
    entfernen(join(web, ".claude"));
    expect(sauber().code, "nur .gitignore (ungetrackt, keine Harness-Datei) und dist/ bleiben").toBe(0);
  });
});
