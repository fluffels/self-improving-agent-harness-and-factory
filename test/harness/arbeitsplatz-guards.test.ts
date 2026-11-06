/* Guards im Arbeitsplatz (factory#89, ADR 0022 Fortschreibung): Worktree-Guard (Bash und PowerShell) und Lens-Edit-Guard schützen den Haupt-Checkout jedes Repos
 * der Projekt-Config, auch wenn das Arbeitsverzeichnis die Arbeitsplatz-Wurzel ist.
 *
 * @harness-waechter – einziger Durchsetzer dieser Regel für den Arbeitsplatz, darum im geschützten test/harness/.
 *
 * Fixtures tragen nur neutrale Namen (`web`, `api`); das Worktree-Präfix kommt aus der Fremd-Config. Der Hinweistext des Blocks nennt den Befehl aus `arbeitsplatz.mjs worktree`.
 */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hookRaw from "../../scripts/worktree-guard-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as psRaw from "../../scripts/worktree-guard-powershell.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lensRaw from "../../scripts/lens-edit-guard.mjs";

type Entscheidung = { block: boolean; ask?: boolean; reason?: string };
type Deps = Record<string, unknown>;
const H = hookRaw as unknown as {
  decide: (o: { cwd?: string; command: string; repoRoot: string; deps?: Deps }) => Entscheidung;
  schutzWurzeln: (repoRoot: string, deps?: Deps) => { wurzel: string; repo?: { name: string } }[];
  neuerWorktreeHinweis: (deps: Deps, w?: unknown) => string;
  jeSchutzWurzel: (repoRoot: string, deps: Deps, bewerte: (w: { wurzel: string }) => Entscheidung | null) => Entscheidung;
};
const PS = psRaw as unknown as { bewertePowerShell: (o: { command: string; cwd: string; repoRoot: string; deps?: Deps }) => Entscheidung };
const L = lensRaw as unknown as { bewerteLensEdit: (p: string, cwd: string, deps: Deps) => Entscheidung };

const WT = FREMD.praefixe.worktree;
const BR = FREMD.praefixe.branch;
const arbeitsplatz = (repos: { name: string; pfad: string; standardzweig?: string }[], wurzel = ".") => ({ ...FREMD, arbeitsplatz: { wurzel, repos } });
const REPOS = [{ name: "web", pfad: "web" }, { name: "api", pfad: "api" }];

describe("jeSchutzWurzel: Block vor Rückfrage vor Durchlassen", () => {
  const config = arbeitsplatz(REPOS, "/ap");
  const mit = (urteile: Record<string, Entscheidung | null>) => H.jeSchutzWurzel("/ap", { config }, (w) => urteile[w.wurzel] ?? null);
  const frage = { block: false, ask: true, reason: "frage" };
  const block = { block: true, reason: "block" };
  test("eine Rückfrage der ersten Wurzel wird vom Block einer späteren überstimmt", () => {
    expect(mit({ "/ap": frage, "/ap/api": block })).toEqual(block);
  });
  test("eine Rückfrage bleibt bestehen, wenn eine spätere Wurzel nichts meldet", () => {
    expect(mit({ "/ap/web": frage })).toEqual(frage);
  });
  test("ohne Urteil wird durchgelassen, ein Block der ersten Wurzel gilt sofort", () => {
    expect(mit({})).toEqual({ block: false });
    expect(mit({ "/ap": block, "/ap/web": frage })).toEqual(block);
  });
});

describe("Worktree-Guard (Bash) mit Fakes: Hinweistexte", () => {
  /** Fake-git: `/ap/web` und `/ap/api` (und `/proj`) sind Haupt-Checkouts, `/ap/.claude/worktrees/web/<wt>7` ein Linked Worktree von web, `/ap` selbst kein Repo. */
  const info: Record<string, { top: string; common: string }> = {
    "/ap/web": { top: "/ap/web", common: "/ap/web/.git" },
    "/ap/api": { top: "/ap/api", common: "/ap/api/.git" },
    "/ap/web/src": { top: "/ap/web", common: "/ap/web/.git" },
    [`/ap/.claude/worktrees/web/${WT}7`]: { top: `/ap/.claude/worktrees/web/${WT}7`, common: "/ap/web/.git" },
    "/proj": { top: "/proj", common: "/proj/.git" },
  };
  const n = (p: unknown) => String(p).replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
  const fake = (config: unknown): Deps => ({
    config,
    platform: "linux",
    execFileSync: (_c: unknown, args: string[], o: { cwd: string }) => {
      const i = info[n(o.cwd)];
      if (!i || !args.includes("--show-toplevel")) throw new Error(`kein Repo: ${o.cwd}`);
      return `${i.top}\n${i.common}\n`;
    },
    statSync: (p: unknown) => ({ isDirectory: () => !n(p).includes("/.claude/worktrees/") || !n(p).endsWith("/.git") }), // `.git` ist nur im Linked Worktree eine Datei
  });
  const entscheide = (command: string, cwd: string, repoRoot: string, config: unknown) => H.decide({ cwd, command, repoRoot, deps: fake(config) });

  test("cwd = Arbeitsplatz-Wurzel: `git -C <repo> commit` in web und `cd api && git push` in api blocken, der Grund nennt den Befehl aus `arbeitsplatz.mjs worktree`", () => {
    const web = entscheide("git -C /ap/web commit -m x", "/ap", "/ap", arbeitsplatz(REPOS, "/ap"));
    expect(web.block).toBe(true);
    expect(web.reason).toContain("git -C /ap/web fetch origin && git -C /ap/web worktree add /ap/.claude/worktrees/web/");
    expect(web.reason).toContain(`-b ${BR}<nr>-<slug> origin/main`);
    expect(web.reason).toContain("node scripts/arbeitsplatz.mjs worktree <nr> <slug> --repo web");
    const api = entscheide("cd api && git push", "/ap", "/ap", arbeitsplatz(REPOS, "/ap"));
    expect(api.block).toBe(true);
    expect(api.reason).toContain("--repo api");
    expect(api.reason).toContain("git -C /ap/api worktree add");
  });
  test("der Standardzweig des Repos steht im Befehl (develop statt main)", () => {
    const r = entscheide("git -C /ap/web commit -m x", "/ap", "/ap", arbeitsplatz([{ name: "web", pfad: "web", standardzweig: "develop" }, REPOS[1]], "/ap"));
    expect(r.reason).toContain("origin/develop");
    expect(r.reason).not.toContain("origin/main");
  });
  test("aus dem Linked Worktree eines Repos lässt der Guard durch", () => {
    const wt = `/ap/.claude/worktrees/web/${WT}7`;
    expect(entscheide("git commit -m x", wt, "/ap", arbeitsplatz(REPOS, "/ap")).block).toBe(false);
    expect(entscheide(`git -C ${wt} push`, "/ap", "/ap", arbeitsplatz(REPOS, "/ap")).block).toBe(false);
    expect(entscheide("git status", "/ap", "/ap", arbeitsplatz(REPOS, "/ap")).block).toBe(false);
  });
  test("ein kaputter Block wirft nicht: es bleibt beim Session-Repo (nur dieses ist geschützt)", () => {
    const kaputt = { ...FREMD, arbeitsplatz: { wurzel: "/ap", repos: [] } };
    expect(H.schutzWurzeln("/ap", { config: kaputt })).toEqual([{ wurzel: "/ap" }]);
    expect(entscheide("git -C /ap/web commit -m x", "/ap", "/ap", kaputt).block).toBe(false);
    expect(entscheide("git commit -m x", "/proj", "/proj", kaputt).block).toBe(true);
  });
  test("schutzWurzeln: eingebettet nur das Session-Repo, im Arbeitsplatz zusätzlich jedes Repo der Config", () => {
    expect(H.schutzWurzeln("/proj", { config: FREMD })).toEqual([{ wurzel: "/proj" }]);
    expect(H.schutzWurzeln("/ap", { config: arbeitsplatz(REPOS, "/ap") }).map((w) => [w.wurzel, w.repo?.name])).toEqual([["/ap", undefined], ["/ap/web", "web"], ["/ap/api", "api"]]);
    expect(H.schutzWurzeln("/nirgends/ohne/config")).toEqual([{ wurzel: "/nirgends/ohne/config" }]);
  });
  test("eingebettet bleibt der Grund zeichengleich (AGENTS.md-Form des Worktree-Befehls samt `origin/main`)", () => {
    const r = entscheide("git commit -m x", "/proj", "/proj", FREMD);
    expect(r.reason).toBe(
      "git commit/push würde im geteilten main-Checkout (/proj) laufen und ist blockiert. " +
        "Aus einem worktree: `git -C <worktree> …` (ändert die Shell-cwd nicht) oder `cd <worktree> && git …`, " +
        "beides wertet der Hook aus. Neuer Worktree (AGENTS.md § Eigener Worktree): " +
        `\`git fetch origin && git worktree add .claude/worktrees/${WT}<nr> -b ${BR}<nr>-<slug> origin/main\` (vom frischen origin/main, #772). (#735)`,
    );
  });
});

describe("Guards im temporären Arbeitsplatz (echtes git)", () => {
  let basis = "";
  let ap = "";
  let apFwd = "";
  const env = () => ({ ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))) });
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8", stdio: "pipe", env: env() });
  const wt = () => `${apFwd}/.claude/worktrees/web/${WT}7`;

  beforeAll(() => {
    basis = realpathSync.native(mkdtempSync(join(tmpdir(), "arbeitsplatz-guards-")));
    ap = join(basis, "ap");
    apFwd = ap.replace(/\\/g, "/");
    mkdirSync(ap);
    for (const repo of ["web", "api"]) {
      mkdirSync(join(ap, repo));
      git(join(ap, repo), "init", "-q", "-b", "main");
      writeFileSync(join(ap, repo, "README.md"), "x\n");
      git(join(ap, repo), "add", "-A");
      git(join(ap, repo), "commit", "-q", "-m", "init");
    }
    mkdirSync(join(ap, ".factory"));
    writeFileSync(join(ap, ".factory", "projekt.json"), JSON.stringify(arbeitsplatz(REPOS)));
    git(join(ap, "web"), "worktree", "add", "-q", wt(), "-b", `${BR}7-x`);
  }, 60_000);
  afterAll(() => rmSync(basis, { recursive: true, force: true }));

  test("Bash: aus der Wurzel blockt `git -C <wurzel>/web commit` und `cd api && git push` (Config aus der Wurzel), der Worktree von web geht durch", () => {
    const web = H.decide({ cwd: apFwd, command: `git -C ${apFwd}/web commit -m x`, repoRoot: apFwd });
    expect(web.block).toBe(true);
    expect(web.reason).toContain("--repo web");
    const api = H.decide({ cwd: apFwd, command: "cd api && git push", repoRoot: apFwd });
    expect(api.block).toBe(true);
    expect(api.reason).toContain("--repo api");
    expect(H.decide({ cwd: wt(), command: "git commit -m x", repoRoot: apFwd }).block).toBe(false);
    expect(H.decide({ cwd: apFwd, command: `git -C ${wt()} commit -m x`, repoRoot: apFwd }).block).toBe(false);
  });
  test("PowerShell: `git -C <wurzel>/web commit` aus der Wurzel blockt mit dem Worktree-Befehl, `Set-Location` in den Worktree und commit geht durch", () => {
    const r = PS.bewertePowerShell({ command: `git -C ${apFwd}/web commit -m x`, cwd: apFwd, repoRoot: apFwd });
    expect(r.block).toBe(true);
    expect(r.reason).toMatch(/Neuer Worktree: .*worktree add .*--repo web/);
    expect(PS.bewertePowerShell({ command: `Set-Location ${apFwd}/api; git push`, cwd: apFwd, repoRoot: apFwd }).block).toBe(true);
    expect(PS.bewertePowerShell({ command: `Set-Location ${wt()}; git commit -m x`, cwd: apFwd, repoRoot: apFwd }).block).toBe(false);
  });
  test("PowerShell eingebettet: der Hinweistext bleibt ohne den Zusatz `Neuer Worktree:`", () => {
    const r = PS.bewertePowerShell({
      command: "git commit -m x",
      cwd: "/proj",
      repoRoot: "/proj",
      deps: { config: FREMD, kontext: () => ({ relevant: true, isMainWorktree: true, toplevel: "/proj" }), istOrdner: () => true },
    });
    expect(r.block).toBe(true);
    expect(r.reason).not.toContain("Neuer Worktree:");
  });
});

describe("Lens-Edit-Guard im Arbeitsplatz", () => {
  const cfg = { config: arbeitsplatz(REPOS) };
  test("Lens-Worktrees von web und api (Repo-Segment) sind erlaubt, Feature-Worktree, Repo-Ordner und Wurzel-Pfade nicht", () => {
    for (const repo of ["web", "api"]) expect(L.bewerteLensEdit(`/ap/.claude/worktrees/${repo}/${WT}7-lens-r1/src/a.ts`, "", cfg).block).toBe(false);
    for (const p of [`/ap/.claude/worktrees/web/${WT}7/src/a.ts`, "/ap/web/src/a.ts", "/ap/.claude/worktrees/web/a.ts"]) expect(L.bewerteLensEdit(p, "", cfg).block, p).toBe(true);
  });
  test("der Hinweis nennt den Worktree-Ordner je Repo und `arbeitsplatz.mjs pfade`; eingebettet bleibt er ohne beides", () => {
    const ap = L.bewerteLensEdit("/ap/web/src/a.ts", "", cfg);
    expect(ap.reason).toContain(`<worktree-ordner>/${WT}<nr>-lens-r<runde>`);
    expect(ap.reason).toContain("node scripts/arbeitsplatz.mjs pfade");
    expect(ap.reason).not.toContain("fremder Klon");
    const eing = L.bewerteLensEdit("/proj/src/a.ts", "", { config: FREMD });
    expect(eing.reason).toContain(`(.claude/worktrees/${WT}<nr>-lens-r<runde>`);
    expect(eing.reason).not.toContain("arbeitsplatz.mjs");
    expect(eing.reason).toContain("<runde> (fremder Klon: git -C <klon> worktree add");
  });
});
