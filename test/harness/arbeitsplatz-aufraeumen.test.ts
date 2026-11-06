/* Aufräumen im Arbeitsplatz (factory#89, ADR 0022 Fortschreibung): Schutzgurt, Diagnose je Repo, Stop-Hook, CLI und ein Ende-zu-Ende-Lauf mit echtem git.
 *
 * @harness-waechter – einziger Durchsetzer der Arbeitsplatz-Regeln des Aufräumens (Gurt mit Ordner aus der Config, Vereinigung der registrierten Pfade, fail-closed), darum im geschützten test/harness/.
 *
 * Fixtures tragen nur neutrale Namen (`web`, `api`); das Worktree-Präfix kommt aus der Fremd-Config.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREMD, FREMD_NAMEN } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as wRaw from "../../scripts/worktree-aufraeumen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as hookRaw from "../../scripts/stop-verify-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cleanupRaw from "../../scripts/cleanup-worktrees.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../../scripts/arbeitsplatz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cliRaw from "../../scripts/arbeitsplatz.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lockRaw from "../../scripts/ticket-lock.mjs";

type Deps = Record<string, unknown>;
type Aufloesung = { betriebsart: string; wurzel: string; repos: { name: string; pfad: string; worktreeOrdner: string }[] };
type Befund = { name: string; ok: boolean; orphans: string[]; young: string[]; mainRoot: string; worktreesDir: string };
const W = wRaw as unknown as {
  erwarteterWorktreeOrdner: (mainRoot: string, aufloesung?: Aufloesung, platform?: string) => string | null;
  assertSafeOrphanTarget: (mainRoot: string, worktreesDir: string, name: string, deps?: Deps, art?: string) => { safe: boolean; reason?: string };
  diagnoseArbeitsplatz: (orte: unknown[], deps?: Deps) => { ok: boolean; fehler?: string; repos: Befund[] };
  aufraeumDiagnose: (config: unknown, basis: string, deps?: Deps) => { arbeitsplatz: boolean; ok: boolean; repos: Befund[]; fehler?: string };
  gitOrteAus: (config: unknown, basis?: string) => { aufloesung: Aufloesung; orte: unknown[] };
};
const hook = hookRaw as unknown as { checkAndFixOrphanWorktrees: (root: string, deps?: Deps) => { blocked: boolean; reason?: string; warning?: string; removed?: string[] } };
const cleanup = cleanupRaw as unknown as { main: (argv: string[], o?: Deps) => number };
const lib = libRaw as unknown as { arbeitsplatzAus: (c: unknown, basis: string) => Aufloesung };
const cli = cliRaw as unknown as { cli: (argv: string[], o?: Deps) => number };
const lock = lockRaw as unknown as { fuehreAus: (argv: string[], deps: Deps) => { code: number; out: string; err: string }; echteDeps: (o: { config: unknown; basis: string }) => Deps };

const WT = FREMD.praefixe.worktree;
const MIN = 60_000;
const JETZT = Date.UTC(2026, 9, 9, 12, 0, 0);
const CONFIG = { ...FREMD, arbeitsplatz: { wurzel: "/w", repos: [{ name: "web", pfad: "web" }, { name: "api", pfad: "api" }] } };
const AUF = lib.arbeitsplatzAus(CONFIG, "/basis");
const ECHT_DIR = { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false };

describe("erwarteterWorktreeOrdner", () => {
  test("eingebettet <mainRoot>/.claude/worktrees (zeichengleich zu vorher), auch bei Backslashes", () => {
    expect(W.erwarteterWorktreeOrdner("/m")).toBe("/m/.claude/worktrees");
    expect(W.erwarteterWorktreeOrdner("X:\\dev\\m\\")).toBe("X:/dev/m/.claude/worktrees");
    expect(W.erwarteterWorktreeOrdner("/m", { betriebsart: "eingebettet", wurzel: "/m", repos: [] })).toBe("/m/.claude/worktrees");
  });
  test("Arbeitsplatz: der Worktree-Ordner des Repos mit pfad = mainRoot, sonst null", () => {
    expect(W.erwarteterWorktreeOrdner("/w/web", AUF)).toBe("/w/.claude/worktrees/web");
    expect(W.erwarteterWorktreeOrdner("/w/api/", AUF)).toBe("/w/.claude/worktrees/api");
    expect(W.erwarteterWorktreeOrdner("/w", AUF)).toBeNull();
    expect(W.erwarteterWorktreeOrdner("/w/web/sub", AUF)).toBeNull();
  });
  test("unter win32 ohne Beachtung der Groß-/Kleinschreibung, sonst exakt", () => {
    expect(W.erwarteterWorktreeOrdner("/W/WEB", AUF, "win32")).toBe("/w/.claude/worktrees/web");
    expect(W.erwarteterWorktreeOrdner("/W/WEB", AUF, "linux")).toBeNull();
  });
});

describe("assertSafeOrphanTarget im Arbeitsplatz", () => {
  const dir = "/w/.claude/worktrees/web";
  const deps = (extra: Deps = {}): Deps => ({ aufloesung: AUF, lstatSync: () => ECHT_DIR, ...extra });
  test("ein Kind des Worktree-Ordners seines Repos ist sicher", () => {
    expect(W.assertSafeOrphanTarget("/w/web", dir, `${WT}7`, deps()).safe).toBe(true);
  });
  test("der Ordner `<wurzel>/.claude/worktrees` selbst (dort liegen die Repo-Ordner) wird abgelehnt", () => {
    const r = W.assertSafeOrphanTarget("/w/web", "/w/.claude/worktrees", "web", deps());
    expect(r.safe).toBe(false);
    expect(r.reason).toMatch(/Worktree-Ordner des Repos/);
  });
  test("der Worktree-Ordner eines ANDEREN Repos zu diesem mainRoot wird abgelehnt", () => {
    expect(W.assertSafeOrphanTarget("/w/web", "/w/.claude/worktrees/api", `${WT}7`, deps()).safe).toBe(false);
  });
  test("ein mainRoot ohne Repo der Config wird abgelehnt", () => {
    const r = W.assertSafeOrphanTarget("/fremd", "/fremd/.claude/worktrees", `${WT}7`, deps());
    expect(r).toEqual({ safe: false, reason: "mainRoot /fremd ist kein Repo aus arbeitsplatz.repos" });
  });
  test("ist der Worktree-Ordner selbst ein Link, wird nichts gelöscht", () => {
    const lstat = (p: string) => (p === dir ? { ...ECHT_DIR, isSymbolicLink: () => true } : ECHT_DIR);
    expect(W.assertSafeOrphanTarget("/w/web", dir, `${WT}7`, deps({ lstatSync: lstat })).reason).toMatch(/kein echtes Verzeichnis/);
    expect(W.assertSafeOrphanTarget("/w/web", dir, `${WT}7`, deps({ lstatSync: () => { throw new Error("weg"); } })).reason).toMatch(/nicht statbar/);
  });
  test("eingebettet gilt unverändert nur <mainRoot>/.claude/worktrees", () => {
    const lstat = () => ECHT_DIR;
    expect(W.assertSafeOrphanTarget("/m", "/m/.claude/worktrees", `${WT}7`, { lstatSync: lstat }).safe).toBe(true);
    expect(W.assertSafeOrphanTarget("/m", "/m/.claude", `${WT}7`, { lstatSync: lstat }).reason).toMatch(/<mainRoot>\/\.claude\/worktrees/);
  });
});

/** Fake-Welt: `worktree list --porcelain` je Repo-Pfad, Ordner je Worktree-Ordner, alles Weitere stumm. */
function welt(listen: Record<string, string[] | Error>, ordner: Record<string, string[]>, dateien: Record<string, string[]> = {}) {
  const n = (p: unknown) => String(p).replace(/\\/g, "/");
  const befehle: string[] = [];
  const gelesen: string[] = [];
  const geloescht: string[] = [];
  const vorhanden = new Set(Object.entries(ordner).flatMap(([d, ns]) => ns.map((n) => `${d}/${n}`)));
  const deps = {
    namen: FREMD_NAMEN,
    now: JETZT,
    platform: "linux",
    execSync: (cmd: string, o: { cwd: string }) => {
      befehle.push(`${n(o.cwd)}> ${cmd}`);
      if (cmd.startsWith("git worktree list")) {
        const l = listen[n(o.cwd)];
        if (l instanceof Error || l === undefined) throw l ?? new Error("kein Repo");
        return l.map((p) => `worktree ${p}\nHEAD 0000000000000000000000000000000000000000\n`).join("\n");
      }
      return "";
    },
    existsSync: (p: string) => Object.hasOwn(ordner, n(p)) || vorhanden.has(n(p)),
    readdirSync: (pRoh: string, o?: unknown) => {
      const p = n(pRoh);
      gelesen.push(p);
      if (!o) return [...(ordner[p] ?? [])];
      const ordnerEintraege = (ordner[p] ?? []).filter((n) => vorhanden.has(`${p}/${n}`)).map((name) => ({ name, isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false }));
      return [...ordnerEintraege, ...(dateien[p] ?? []).map((name) => ({ name, isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false }))];
    },
    statSync: () => ({ mtimeMs: JETZT - 10 * MIN, birthtimeMs: JETZT - 10 * MIN }),
    lstatSync: () => ECHT_DIR,
    rmSync: (p: string) => {
      geloescht.push(n(p));
      vorhanden.delete(n(p));
    },
    listProcesses: () => [],
  };
  return { deps, befehle, gelesen, geloescht };
}
const LISTE = (haupt: string, ...rest: string[]) => [haupt, ...rest];
const ORDNER_WEB = "/w/.claude/worktrees/web";
const ORDNER_API = "/w/.claude/worktrees/api";

describe("diagnoseArbeitsplatz", () => {
  const orte = W.gitOrteAus(CONFIG, "/basis").orte;
  test("ein aktiver Worktree von Repo B im Ordner von Repo A ist keine Waise; echte Waisen werden je Repo gefunden", () => {
    const w = welt(
      { "/w/web": LISTE("/w/web", `${ORDNER_WEB}/${WT}7`), "/w/api": LISTE("/w/api", `${ORDNER_WEB}/${WT}9`, `${ORDNER_API}/${WT}5`) },
      { [ORDNER_WEB]: [`${WT}7`, `${WT}8`, `${WT}9`], [ORDNER_API]: [`${WT}5`, `${WT}6`], "/w/.claude/worktrees": ["web", "api"] },
    );
    const r = W.diagnoseArbeitsplatz(orte, w.deps);
    expect(r.ok).toBe(true);
    const [web, api] = r.repos;
    expect(web.name).toBe("web");
    expect(web.orphans).toEqual([`${WT}8`]);
    expect(api.orphans).toEqual([`${WT}6`]);
    expect([web.mainRoot, web.worktreesDir]).toEqual(["/w/web", ORDNER_WEB]);
    expect(w.gelesen).not.toContain("/w/.claude/worktrees"); // der Ordner mit den Repo-Ordnern wird nie gescannt
  });
  test("unter win32 gilt ein registrierter Pfad auch bei anderer Groß-/Kleinschreibung", () => {
    const w = welt({ "/w/web": LISTE("/w/web", `${ORDNER_WEB.toUpperCase()}/${WT}7`.replace("/W/", "/w/")), "/w/api": LISTE("/w/api") }, { [ORDNER_WEB]: [`${WT}7`], [ORDNER_API]: [] });
    expect(W.diagnoseArbeitsplatz(orte, { ...w.deps, platform: "win32" }).repos[0].orphans).toEqual([]);
    expect(W.diagnoseArbeitsplatz(orte, { ...w.deps, platform: "linux" }).repos[0].orphans).toEqual([`${WT}7`]);
  });
  test("fail-closed: wirft `worktree list` eines Repos oder ist die Liste leer, meldet die Diagnose den Fehler mit Repo-Name und liefert keine Repos", () => {
    for (const kaputt of [new Error("fatal: not a git repository"), []]) {
      const w = welt({ "/w/web": LISTE("/w/web"), "/w/api": kaputt }, { [ORDNER_WEB]: [`${WT}8`], [ORDNER_API]: [] });
      const r = W.diagnoseArbeitsplatz(orte, w.deps);
      expect(r.ok).toBe(false);
      expect(r.fehler).toMatch(/Repo api \(\/w\/api\)/);
      expect(r.fehler).toMatch(/Fix: Pfad in arbeitsplatz\.repos prüfen/);
      expect(r.repos).toBeUndefined();
    }
  });
  test("aufraeumDiagnose: ohne Block eingebettet (ein Befund ohne Namen), mit Block je Repo, kaputter Block wirft mit Fix-Zeile", () => {
    const w = welt({ "/e": LISTE("/e") }, { "/e/.claude/worktrees": [`${WT}3`] });
    const eing = W.aufraeumDiagnose(FREMD, "/e", w.deps);
    expect(eing.arbeitsplatz).toBe(false);
    expect(eing.repos).toHaveLength(1);
    expect(eing.repos[0].orphans).toEqual([`${WT}3`]);
    expect(() => W.aufraeumDiagnose({ ...FREMD, arbeitsplatz: { wurzel: "/w", repos: [] } }, "/basis", w.deps)).toThrow(/Fix:/);
  });
});

describe("Stop-Hook im Arbeitsplatz", () => {
  const lauf = (w: ReturnType<typeof welt>, config: unknown = CONFIG) => hook.checkAndFixOrphanWorktrees("/basis", { ...w.deps, config });
  test("Waisen in beiden Repos werden in einem Aufruf entfernt, ein aktiver Worktree von B im Ordner von A bleibt", () => {
    const w = welt(
      { "/w/web": LISTE("/w/web", `${ORDNER_WEB}/${WT}7`), "/w/api": LISTE("/w/api", `${ORDNER_WEB}/${WT}9`) },
      { [ORDNER_WEB]: [`${WT}7`, `${WT}8`, `${WT}9`], [ORDNER_API]: [`${WT}6`] },
    );
    const r = lauf(w);
    expect(r.blocked).toBe(false);
    expect([...(r.removed ?? [])].sort()).toEqual([`${WT}6`, `${WT}8`]);
    expect(w.geloescht.sort()).toEqual([`${ORDNER_API}/${WT}6`, `${ORDNER_WEB}/${WT}8`]);
  });
  test("nichts zu tun: kein Repo hat Waisen, der Hook meldet unverändert { blocked: false } ohne Zusatzfelder", () => {
    const w = welt({ "/w/web": LISTE("/w/web"), "/w/api": LISTE("/w/api") }, { [ORDNER_WEB]: [], [ORDNER_API]: [] });
    expect(lauf(w)).toEqual({ blocked: false });
  });
  test("eine fremde lose Datei im Ordner eines Repos ist nur eine Warnung mit dem Repo-Namen, nie eine Blockade", () => {
    const w = welt({ "/w/web": LISTE("/w/web"), "/w/api": LISTE("/w/api") }, { [ORDNER_WEB]: [], [ORDNER_API]: [] }, { [ORDNER_WEB]: ["notiz.txt"] });
    const r = lauf(w);
    expect(r.blocked).toBe(false);
    expect(r.warning).toMatch(/^Repo web: Fremde lose Datei\(en\).*notiz\.txt/);
    expect(w.geloescht).toEqual([]);
  });
  test("fail-closed: scheitert `worktree list` in einem Repo, wird in KEINEM Repo gelöscht und eine Warnung nennt das Repo", () => {
    const w = welt({ "/w/web": LISTE("/w/web"), "/w/api": new Error("kaputt") }, { [ORDNER_WEB]: [`${WT}8`], [ORDNER_API]: [`${WT}6`] });
    const r = lauf(w);
    expect(r.blocked).toBe(false);
    expect(r.warning).toMatch(/Repo api/);
    expect(w.geloescht).toEqual([]);
    expect(w.befehle.some((b) => b.includes("worktree prune"))).toBe(false);
  });
  test("ein kaputter Block arbeitsplatz blockiert mit der Fix-Zeile, gelöscht wird nichts", () => {
    const w = welt({}, {});
    const r = lauf(w, { ...FREMD, arbeitsplatz: { wurzel: "/w", repos: [] } });
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/Fix: den Block arbeitsplatz/);
    expect(w.geloescht).toEqual([]);
  });
  test("der Schutzgurt lehnt ab, wenn der erste Listeneintrag kein Repo der Config ist (nichts gelöscht, Block mit Repo-Name)", () => {
    const w = welt({ "/w/web": LISTE("/anderswo/web"), "/w/api": LISTE("/w/api") }, { [ORDNER_WEB]: [`${WT}8`], [ORDNER_API]: [] });
    const r = lauf(w);
    expect(r.blocked).toBe(true);
    expect(r.reason).toMatch(/Repo web: .*kein Repo aus arbeitsplatz\.repos/);
    expect(w.geloescht).toEqual([]);
  });
  test("eingebettet unverändert: ohne Block räumt der Hook <repo>/.claude/worktrees auf", () => {
    const w = welt({ "/e": LISTE("/e") }, { "/e/.claude/worktrees": [`${WT}3`] });
    const r = hook.checkAndFixOrphanWorktrees("/e", { ...w.deps, config: FREMD });
    expect(r.removed).toEqual([`${WT}3`]);
    expect(w.geloescht).toEqual([`/e/.claude/worktrees/${WT}3`]);
  });
});

describe("cleanup-worktrees im Arbeitsplatz", () => {
  afterEach(() => vi.restoreAllMocks());
  const stumm = () => {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...a) => void out.push(a.join(" ")));
    vi.spyOn(console, "error").mockImplementation((...a) => void err.push(a.join(" ")));
    return { out, err };
  };
  test("Diagnose: ein Kopf je Repo, Exit 1 bei einer Waise (Dry-Run, nichts gelöscht)", () => {
    const { out } = stumm();
    const w = welt({ "/w/web": LISTE("/w/web"), "/w/api": LISTE("/w/api") }, { [ORDNER_WEB]: [`${WT}8`], [ORDNER_API]: [], "/w/.claude/worktrees": ["web", "api", "fremd"] });
    const code = cleanup.main([], { config: CONFIG, root: "/basis", diagnoseDeps: w.deps });
    expect(code).toBe(1);
    expect(out.filter((z) => z.includes("ohne Repo in arbeitsplatz.repos")).join("")).toMatch(/\.claude.worktrees ohne Repo in arbeitsplatz\.repos \(nie automatisch gelöscht\): fremd\n$/);
    expect(out.filter((z) => z.startsWith("=== Repo "))).toEqual([`=== Repo web (${ORDNER_WEB}) ===`, `=== Repo api (${ORDNER_API}) ===`]);
    expect(out.join("\n")).toMatch(new RegExp(`✗ ${WT}8`));
    expect(w.geloescht).toEqual([]);
  });
  test("der Exit-Code ist das Maximum über die Repos: eine Waise nur im zweiten Repo ergibt Exit 1", () => {
    stumm();
    const w = welt({ "/w/web": LISTE("/w/web"), "/w/api": LISTE("/w/api") }, { [ORDNER_WEB]: [], [ORDNER_API]: [`${WT}6`] });
    expect(cleanup.main([], { config: CONFIG, root: "/basis", diagnoseDeps: w.deps })).toBe(1);
    const sauber = welt({ "/w/web": LISTE("/w/web"), "/w/api": LISTE("/w/api") }, { [ORDNER_WEB]: [], [ORDNER_API]: [] });
    expect(cleanup.main([], { config: CONFIG, root: "/basis", diagnoseDeps: sauber.deps })).toBe(0);
  });
  test("fail-closed: scheitert git in einem Repo, nennt die Meldung es, Exit 1, nichts gelöscht", () => {
    const { err } = stumm();
    const w = welt({ "/w/web": LISTE("/w/web"), "/w/api": new Error("x") }, { [ORDNER_WEB]: [`${WT}8`], [ORDNER_API]: [] });
    expect(cleanup.main(["--fix"], { config: CONFIG, root: "/basis", diagnoseDeps: w.deps })).toBe(1);
    expect(err.join("\n")).toMatch(/Repo api/);
    expect(w.geloescht).toEqual([]);
  });
  test("--branches: der Modus läuft je Repo mit dem Repo-Pfad als Wurzel, der Exit-Code ist das Maximum", () => {
    stumm();
    const aufrufe: { root: string; loeschen: boolean; gh: unknown }[] = [];
    const modus = (root: string, loeschen: boolean, o: { ghJson: unknown }) => {
      aufrufe.push({ root, loeschen, gh: o.ghJson });
      return root === "/w/api" ? 1 : 0;
    };
    expect(cleanup.main(["--branches", "--fix"], { config: CONFIG, root: "/basis", modus })).toBe(1);
    expect(aufrufe.map((a) => [a.root, a.loeschen])).toEqual([["/w/web", true], ["/w/api", true]]);
    expect(aufrufe.every((a) => typeof a.gh === "function")).toBe(true);
  });
  test("ein kaputter Block bricht mit der Fix-Zeile ab", () => {
    const { err } = stumm();
    expect(cleanup.main([], { config: { ...FREMD, arbeitsplatz: { wurzel: "/w", repos: [] } }, root: "/basis" })).toBe(1);
    expect(err.join("\n")).toMatch(/Fix:/);
  });
  test("eingebettet: ohne Block der bisherige Ablauf (kein Repo-Kopf)", () => {
    const { out } = stumm();
    const w = welt({ "/e": LISTE("/e") }, { "/e/.claude/worktrees": [] });
    expect(cleanup.main([], { config: FREMD, root: "/e", diagnoseDeps: w.deps })).toBe(0);
    expect(out.some((z) => z.startsWith("=== Repo "))).toBe(false);
  });
});

describe("Ende zu Ende im temporären Arbeitsplatz (echtes git, zwei Repos)", () => {
  let basis = "";
  let ap = "";
  const hooks = () => join(basis, "keine-hooks");
  const env = (): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_"))),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "core.hooksPath",
    GIT_CONFIG_VALUE_0: hooks(),
  });
  const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8", stdio: "pipe", env: env() });
  const config = () => ({ ...FREMD, arbeitsplatz: { wurzel: ".", repos: [{ name: "web", pfad: "web" }, { name: "api", pfad: "api" }] } });
  /** Hook-Lauf mit echtem fs und echtem git (bereinigte Umgebung). */
  const aufraeumen = () => hook.checkAndFixOrphanWorktrees(ap, { namen: FREMD_NAMEN, config: config(), listProcesses: () => [], execSync: (cmd: string, o: Record<string, unknown>) => execSync(cmd, { ...o, env: env() }) });
  const sauber = () => {
    const err: string[] = [];
    return { code: cli.cli(["sauber", "--wurzel", ap], { out: () => undefined, err: (s: string) => err.push(s) }), err };
  };
  const ordner = (repo: string) => join(ap, ".claude", "worktrees", repo);
  const alt = (p: string) => utimesSync(p, new Date(Date.now() - 30 * MIN), new Date(Date.now() - 30 * MIN));
  const worktreeAnlegen = (repo: string, nr: number) => {
    const aus: string[] = [];
    expect(cli.cli(["worktree", String(nr), "probe", "--wurzel", ap, "--repo", repo], { out: (s: string) => aus.push(s), err: () => undefined })).toBe(0);
    execSync(aus[0], { cwd: ap, env: env(), stdio: "pipe" });
    return join(ordner(repo), `${WT}${nr}`);
  };

  beforeAll(() => {
    basis = realpathSync.native(mkdtempSync(join(tmpdir(), "arbeitsplatz-aufraeumen-")));
    mkdirSync(hooks());
    ap = join(basis, "ap");
    mkdirSync(ap);
    for (const repo of ["web", "api"]) {
      const quelle = join(basis, `${repo}-quelle`);
      mkdirSync(quelle);
      git(quelle, "init", "-q", "-b", "main");
      writeFileSync(join(quelle, "README.md"), "x\n");
      git(quelle, "add", "-A");
      git(quelle, "commit", "-q", "-m", "init");
      git(basis, "clone", "-q", "--bare", quelle, join(basis, `${repo}.git`));
      git(ap, "clone", "-q", join(basis, `${repo}.git`), repo);
    }
    mkdirSync(join(ap, ".factory"));
    writeFileSync(join(ap, ".factory", "projekt.json"), JSON.stringify(config()));
  }, 90_000);
  afterAll(() => rmSync(basis, { recursive: true, force: true }));

  test("Claim, Worktree, Änderung, Aufräumen: danach meldet `sauber` Exit 0 in beiden Repos und kein Repo-Ordner hat eine Spur", () => {
    const claim = lock.fuehreAus(["claim", "7"], lock.echteDeps({ config: config(), basis: ap }));
    expect(claim.code).toBe(0);
    const wtWeb = worktreeAnlegen("web", 7);
    const wtApi = worktreeAnlegen("api", 7);
    writeFileSync(join(wtWeb, "README.md"), "geändert\n");
    git(wtWeb, "commit", "-q", "-am", "Änderung");
    git(wtApi, "status", "--porcelain");
    expect(sauber().code).toBe(0);
    // Abschluss: der Umsetzer entfernt die Worktrees; in beiden bleibt ein Rest-Ordner (Datei-Sperre) stehen.
    git(join(ap, "web"), "worktree", "remove", "--force", wtWeb);
    git(join(ap, "api"), "worktree", "remove", "--force", wtApi);
    for (const [repo, nr] of [["web", 7], ["api", 7]] as const) {
      const rest = join(ordner(repo), `${WT}${nr}`);
      mkdirSync(rest, { recursive: true });
      writeFileSync(join(rest, "rest.txt"), "x\n");
      alt(rest);
    }
    const r = aufraeumen();
    expect(r.blocked).toBe(false);
    expect([...(r.removed ?? [])].sort()).toEqual([`${WT}7`, `${WT}7`]);
    expect(existsSync(join(ordner("web"), `${WT}7`))).toBe(false);
    expect(existsSync(join(ordner("api"), `${WT}7`))).toBe(false);
    expect(readdirSync(ordner("web"))).toEqual([]);
    for (const repo of ["web", "api"]) expect(git(join(ap, repo), "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
    expect(existsSync(join(ap, "web", ".claude"))).toBe(false);
    const s = sauber();
    expect(s.err.join("\n")).toBe("");
    expect(s.code).toBe(0);
  }, 60_000);

  test("Negativfall: ein aktiver Worktree von Repo api im Ordner von Repo web bleibt beim Aufräumen von web stehen (Vereinigung der registrierten Pfade)", () => {
    const fremd = join(ordner("web"), `${WT}8`);
    git(join(ap, "api"), "worktree", "add", "-q", fremd, "-b", `${FREMD.praefixe.branch}8-x`, "origin/main");
    alt(fremd);
    const echteWaise = join(ordner("web"), `${WT}9`);
    mkdirSync(echteWaise, { recursive: true });
    alt(echteWaise);
    const r = aufraeumen();
    expect(r.blocked).toBe(false);
    expect(r.removed).toEqual([`${WT}9`]);
    expect(existsSync(fremd)).toBe(true);
    expect(git(join(ap, "api"), "worktree", "list", "--porcelain")).toContain(fremd.replace(/\\/g, "/"));
    git(join(ap, "api"), "worktree", "remove", "--force", fremd);
  }, 60_000);

  test("Negativfall: scheitert `git worktree list` in einem Repo (api nicht auffindbar), bleibt auch die Waise in web stehen", () => {
    const waise = join(ordner("web"), `${WT}10`);
    mkdirSync(waise, { recursive: true });
    alt(waise);
    renameSync(join(ap, "api"), join(ap, "api-weg"));
    try {
      const r = aufraeumen();
      expect(r.blocked).toBe(false);
      expect(r.warning).toMatch(/Repo api/);
      expect(existsSync(waise)).toBe(true);
    } finally {
      renameSync(join(ap, "api-weg"), join(ap, "api"));
    }
    expect(aufraeumen().removed).toEqual([`${WT}10`]);
    expect(existsSync(waise)).toBe(false);
  }, 60_000);
});
