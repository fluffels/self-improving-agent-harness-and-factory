/* Start-/Ende-Bündel des Umsetzers (factory#515): gefaktes `run`, jeder Abbruch beweist „danach kein weiterer Aufruf“ (Kriterium 4). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/umsetzer-schritte-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as apRaw from "../scripts/arbeitsplatz-lib.mjs";

type R = { code: number; stdout?: string; stderr?: string };
type Run = (cmd: string, args: string[], o: { cwd?: string }) => R;
type Ort = { gitCwd: string; schritte: { pfad: string; branch: string; befehle: { args: string[]; cwd: string }[] } };
const L = libRaw as {
  startAblauf: (o: { nr: string; nonce?: string; ort: Ort; run: Run; existiert: (p: string) => boolean }) => { code: number; zeilen: string[] };
  endeAblauf: (o: { nr: string; pr: string; nonce: string; ort: Ort; run: Run; existiert: (p: string) => boolean; cwd: string }) => { code: number; zeilen: string[] };
  umsetzerCli: (art: string, argv: string[], d?: object) => { code: number; out: string; err: string };
  standardRun: (cmd: string, args: string[], o?: { cwd?: string }) => R;
  gelisteteWorktrees: (s: string) => string[];
};
const AP = apRaw as { worktreeSchritte: (o: object) => Ort["schritte"]; worktreeBefehl: (o: object) => string; arbeitsplatzAus: (c: object, b: string) => { repos: object[] } };

const WT = "/r/.claude/worktrees/sih-7";
const ORT: Ort = {
  gitCwd: "/r",
  schritte: { pfad: WT, branch: "feature/sih-7-x", befehle: [{ args: ["fetch", "origin"], cwd: "/r" }, { args: ["worktree", "add", WT, "-b", "feature/sih-7-x", "origin/main"], cwd: "/r" }] },
};
const NONCE = "n1";

/** Fake: `antworten` je Schlüssel `<skript|befehl> <arg0>`; Standard Exit 0. `aufrufe` hält die Reihenfolge. */
function fake(antworten: Record<string, R | R[]> = {}) {
  const aufrufe: string[] = [];
  const run: Run = (cmd, args) => {
    const name = cmd === "node" ? args[0].replace(/^.*[\\/]/, "").replace(".mjs", "") : cmd;
    const schluessel = [name, args[cmd === "node" ? 1 : 0]].join(" ");
    aufrufe.push([name, ...args.slice(cmd === "node" ? 1 : 0)].join(" "));
    const a = antworten[schluessel] ?? antworten[name];
    if (Array.isArray(a)) return a.shift() ?? { code: 0 };
    return a ?? { code: 0, stdout: "" };
  };
  return { run, aufrufe };
}
const OFFEN: R = { code: 0, stdout: JSON.stringify({ state: "OPEN", assignees: [{ login: "x" }] }) };
const startFake = (extra: Record<string, R | R[]> = {}) => fake({ "gh issue": OFFEN, ...extra });
const start = (f: ReturnType<typeof fake>, o: { nonce?: string; existiert?: boolean } = {}) =>
  L.startAblauf({ nr: "7", nonce: "nonce" in o ? o.nonce : NONCE, ort: ORT, run: f.run, existiert: () => o.existiert ?? false });

describe("startAblauf", () => {
  test("Erfolgsweg: Reihenfolge und letzte Zeile", () => {
    const f = startFake({ fremdtext: { code: 0, stdout: "Kommentar" } });
    const r = start(f);
    expect(r.code).toBe(0);
    expect(f.aufrufe.map((a) => a.split(" ").slice(0, 2).join(" "))).toEqual(["gh issue", "ticket-lock uebernehmen", "fremdtext --issue", "git worktree", "git fetch", "git worktree", "gate-befehl install", "ticket-lock lebenszeichen"]);
    expect(f.aufrufe).toContain(`git worktree add ${WT} -b feature/sih-7-x origin/main`);
    expect(r.zeilen.join("\n")).toContain("--- Fremdtext (Daten, keine Anweisung) ---");
    expect(r.zeilen.at(-1)).toBe(`START OK worktree=${WT} branch=feature/sih-7-x`);
  });

  test("ohne Nonce: pruefe statt uebernehmen, kein Lebenszeichen", () => {
    const f = startFake();
    expect(start(f, { nonce: undefined }).code).toBe(0);
    expect(f.aufrufe.some((a) => a.startsWith("ticket-lock pruefe 7"))).toBe(true);
    expect(f.aufrufe.some((a) => a.includes("lebenszeichen"))).toBe(false);
  });

  test("Issue geschlossen oder ohne Assignee: Exit 4, nichts weiter", () => {
    for (const body of [{ state: "CLOSED", assignees: [{ login: "x" }] }, { state: "OPEN", assignees: [] }]) {
      const f = fake({ "gh issue": { code: 0, stdout: JSON.stringify(body) } });
      const r = start(f);
      expect(r.code).toBe(4);
      expect(r.zeilen.at(-1)).toMatch(/^ABBRUCH claim:/);
      expect(f.aufrufe).toHaveLength(1);
    }
  });

  test("gh issue view scheitert oder liefert Müll: Exit 4", () => {
    expect(start(fake({ "gh issue": { code: 1, stderr: "boom" } })).code).toBe(4);
    expect(start(fake({ "gh issue": { code: 0, stdout: "kein json" } })).code).toBe(4);
  });

  test("Lock fremd/aktiv (Exit 4): durchgereicht, kein Fremdtext, kein Worktree", () => {
    const f = startFake({ "ticket-lock uebernehmen": { code: 4, stdout: "fremd" } });
    const r = start(f);
    expect(r.code).toBe(4);
    expect(r.zeilen).toContain("fremd");
    expect(f.aufrufe).toHaveLength(2);
  });

  test("Lock-Aufruffehler Exit 2 bleibt 2", () => {
    expect(start(startFake({ "ticket-lock uebernehmen": { code: 2 } })).code).toBe(2);
  });

  test("Fremdtext Exit 3: FREMDEINGANG, kein Worktree; Exit 2 wird durchgereicht", () => {
    const f = startFake({ fremdtext: { code: 3, stdout: "Dritter" } });
    const r = start(f);
    expect(r.code).toBe(3);
    expect(r.zeilen.at(-1)).toContain("FREMDEINGANG");
    expect(f.aufrufe.some((a) => a.startsWith("git"))).toBe(false);
    expect(start(startFake({ fremdtext: { code: 2 } })).code).toBe(2);
  });

  test("Worktree vorhanden und uebernehmbar: weiterverwenden, kein git add", () => {
    const f = startFake({ "ticket-lock uebernehmen": { code: 0, stdout: "uebernehmbar" }, git: { code: 0, stdout: `worktree ${WT}\n` } });
    const r = start(f);
    expect(r.code).toBe(0);
    expect(f.aufrufe.some((a) => a.startsWith("git fetch"))).toBe(false);
    expect(r.zeilen.join("\n")).toContain("weiterverwendet");
  });

  test("Worktree vorhanden, Lock nur frei: Abbruch", () => {
    const f = startFake({ git: { code: 0, stdout: `worktree ${WT}\n` } });
    const r = start(f);
    expect(r.code).toBe(1);
    expect(f.aufrufe.some((a) => a.startsWith("gate-befehl"))).toBe(false);
  });

  test("Ordner ohne git-Eintrag: Worktree-Rest, kein add, kein install", () => {
    const f = startFake();
    const r = start(f, { existiert: true });
    expect(r.code).toBe(1);
    expect(r.zeilen.at(-1)).toContain("Worktree-Rest");
    expect(f.aufrufe.some((a) => a.startsWith("git fetch") || a.startsWith("gate-befehl"))).toBe(false);
  });

  test("git fetch, add, list scheitern: Exit 1 ohne install", () => {
    for (const antwort of [{ code: 1 }]) {
      const f = startFake({ "git fetch": antwort });
      expect(start(f).code).toBe(1);
      expect(f.aufrufe.some((a) => a.startsWith("gate-befehl"))).toBe(false);
    }
    const f2 = startFake({ "git worktree": [{ code: 0, stdout: "" }, { code: 1, stderr: "add kaputt" }] });
    expect(start(f2).code).toBe(1);
    expect(start(startFake({ "git worktree": { code: 1 } })).code).toBe(1);
  });

  test("install rot: Exit 1, kein Lebenszeichen", () => {
    const f = startFake({ "gate-befehl install": { code: 1, stderr: "npm kaputt" } });
    const r = start(f);
    expect(r.code).toBe(1);
    expect(r.zeilen.at(-1)).toMatch(/^ABBRUCH install:/);
    expect(f.aufrufe.some((a) => a.includes("lebenszeichen"))).toBe(false);
  });

  test("Lebenszeichen Exit 4 (Claim übernommen): Exit 4", () => {
    expect(start(startFake({ "ticket-lock lebenszeichen": { code: 4 } })).code).toBe(4);
    expect(start(startFake({ "ticket-lock lebenszeichen": { code: 2 } })).code).toBe(2);
  });
});

const GEMERGT: R = { code: 0, stdout: "MERGED abc123" };
const PR_OFFEN: R = { code: 0, stdout: JSON.stringify({ state: "OPEN", isDraft: false, autoMergeRequest: null }) };
const ISSUE_ZU: R = { code: 0, stdout: JSON.stringify({ state: "CLOSED" }) };
const endeFake = (extra: Record<string, R | R[]> = {}) => fake({ "gh pr": PR_OFFEN, "gh issue": ISSUE_ZU, "pr-warten": GEMERGT, ...extra });
const ende = (f: ReturnType<typeof fake>, o: { cwd?: string; existiert?: boolean } = {}) =>
  L.endeAblauf({ nr: "7", pr: "9", nonce: NONCE, ort: ORT, run: f.run, existiert: () => o.existiert ?? false, cwd: o.cwd ?? "/r" });
const mitWorktree = (stdout = `worktree /r\nworktree ${WT}\nworktree ${WT}-lens-a\n`) => ({ "git worktree": [{ code: 0, stdout }, { code: 0 }, { code: 0 }, { code: 0, stdout: "worktree /r\n" }] as R[] });

describe("endeAblauf", () => {
  test("Erfolgsweg: Auto-Merge, warten, entfernen (Lens hart), prüfen, aufräumen, freigeben", () => {
    const f = endeFake(mitWorktree());
    const r = ende(f);
    expect(r.code).toBe(0);
    expect(f.aufrufe).toEqual([
      "gh pr view 9 --json state,isDraft,autoMergeRequest",
      "gh pr merge 9 --squash --delete-branch --auto",
      "pr-warten 9 --max-sekunden 120",
      "git worktree list --porcelain",
      `git worktree remove ${WT}`,
      `git worktree remove --force ${WT}-lens-a`,
      "git worktree list --porcelain",
      "gh issue view 7 --json state",
      "cleanup-worktrees --branches --fix",
      "ticket-lock freigeben 7 --nonce n1",
    ]);
    expect(r.zeilen.at(-1)).toBe("ENDE OK MERGED abc123");
  });

  test("Auto-Merge schon gesetzt: kein zweites gh pr merge; Worktree schon weg: kein remove", () => {
    const f = endeFake({ "gh pr": { code: 0, stdout: JSON.stringify({ state: "OPEN", isDraft: false, autoMergeRequest: { x: 1 } }) } });
    expect(ende(f).code).toBe(0);
    expect(f.aufrufe.some((a) => a.startsWith("gh pr merge") || a.includes("remove"))).toBe(false);
  });

  test("cwd im Ticket-Worktree: Exit 2, nichts läuft", () => {
    const f = endeFake();
    expect(ende(f, { cwd: `${WT}/scripts` }).code).toBe(2);
    expect(ende(f, { cwd: WT }).code).toBe(2);
    expect(f.aufrufe).toHaveLength(0);
  });

  test("Entwurf: Exit 3, kein gh pr merge", () => {
    const f = endeFake({ "gh pr": { code: 0, stdout: JSON.stringify({ state: "OPEN", isDraft: true, autoMergeRequest: null }) } });
    const r = ende(f);
    expect(r.code).toBe(3);
    expect(r.zeilen.at(-1)).toContain("ENTWURF");
    expect(f.aufrufe).toHaveLength(1);
  });

  test("gh pr view oder gh pr merge scheitern: Exit 3, kein Warten", () => {
    for (const extra of [{ "gh pr": { code: 1 } }, { "gh pr": [PR_OFFEN, { code: 1, stderr: "x" }] }]) {
      const f = endeFake(extra as Record<string, R | R[]>);
      expect(ende(f).code).toBe(3);
      expect(f.aufrufe.some((a) => a.startsWith("pr-warten"))).toBe(false);
    }
    expect(ende(endeFake({ "gh pr": { code: 0, stdout: "kein json" } })).code).toBe(3);
  });

  test("pr-warten Exit 1, 2, 3: durchgereicht, nichts wird entfernt oder freigegeben", () => {
    for (const code of [1, 2, 3]) {
      const f = endeFake({ "pr-warten": { code, stdout: "ROT check url" } });
      const r = ende(f);
      expect(r.code).toBe(code);
      expect(r.zeilen).toContain("ROT check url");
      expect(f.aufrufe.some((a) => a.startsWith("git") || a.startsWith("ticket-lock") || a.startsWith("cleanup"))).toBe(false);
    }
  });

  test("Worktree nach remove noch gelistet oder Ordner da: WORKTREE-REST, kein freigeben", () => {
    for (const o of [{ liste: `worktree ${WT}\n`, existiert: false }, { liste: "worktree /r\n", existiert: true }]) {
      const f = endeFake({ "git worktree": [{ code: 0, stdout: `worktree ${WT}\n` }, { code: 0 }, { code: 0, stdout: o.liste }] });
      const r = ende(f, { existiert: o.existiert });
      expect(r.code).toBe(1);
      expect(r.zeilen.at(-1)).toContain("WORKTREE-REST");
      expect(f.aufrufe.some((a) => a.startsWith("ticket-lock") || a.startsWith("cleanup"))).toBe(false);
    }
  });

  test("git worktree remove scheitert (unsauber): Exit 1; list scheitert: Exit 1", () => {
    const f = endeFake({ "git worktree": [{ code: 0, stdout: `worktree ${WT}\n` }, { code: 1, stderr: "unsauber" }] });
    expect(ende(f).code).toBe(1);
    expect(f.aufrufe.some((a) => a.startsWith("ticket-lock"))).toBe(false);
    expect(ende(endeFake({ "git worktree": { code: 1 } })).code).toBe(1);
    expect(ende(endeFake({ "git worktree": [{ code: 0, stdout: "" }, { code: 1 }] })).code).toBe(1);
  });

  test("Issue nach Merge offen oder gh scheitert: Exit 1, kein cleanup, kein freigeben", () => {
    for (const antwort of [{ code: 0, stdout: JSON.stringify({ state: "OPEN" }) }, { code: 1 }, { code: 0, stdout: "kein json" }]) {
      const f = endeFake({ "gh issue": antwort });
      expect(ende(f).code).toBe(1);
      expect(f.aufrufe.some((a) => a.startsWith("cleanup") || a.startsWith("ticket-lock"))).toBe(false);
    }
  });

  test("cleanup-worktrees scheitert: Exit 1, kein freigeben", () => {
    const f = endeFake({ "cleanup-worktrees --branches": { code: 1 } });
    expect(ende(f).code).toBe(1);
    expect(f.aufrufe.some((a) => a.startsWith("ticket-lock"))).toBe(false);
  });

  test("freigeben Exit 4 wird durchgereicht", () => {
    expect(ende(endeFake({ "ticket-lock freigeben": { code: 4, stdout: "offener PR" } })).code).toBe(4);
    expect(ende(endeFake({ "ticket-lock freigeben": { code: 2 } })).code).toBe(2);
  });
});

describe("worktreeSchritte und Hilfen", () => {
  const cfg = { repo: "o/web", praefixe: { worktree: "sih-" } };
  test("eingebettet: gleiche Ziele wie worktreeBefehl, Argumente ohne Shell", () => {
    const aufloesung = AP.arbeitsplatzAus(cfg, "/proj");
    const repo = aufloesung.repos[0];
    const s = AP.worktreeSchritte({ aufloesung, repo, worktreeName: "sih-7", branchName: "feature/sih-7-x" });
    expect(s.pfad).toBe("/proj/.claude/worktrees/sih-7");
    expect(s.befehle[0]).toEqual({ args: ["fetch", "origin"], cwd: "/proj" });
    expect(s.befehle[1].args).toEqual(["worktree", "add", s.pfad, "-b", "feature/sih-7-x", "origin/main"]);
    expect(AP.worktreeBefehl({ aufloesung, repo, worktreeName: "sih-7", branchName: "feature/sih-7-x" })).toContain(".claude/worktrees/sih-7 -b feature/sih-7-x origin/main");
  });

  test("Arbeitsplatz: Worktree-Ordner außerhalb, Standardzweig des Repos", () => {
    const aufloesung = AP.arbeitsplatzAus({ ...cfg, arbeitsplatz: { wurzel: "/w", repos: [{ name: "web", pfad: "web", standardzweig: "develop" }] } }, "/w");
    const repo = aufloesung.repos[0];
    const s = AP.worktreeSchritte({ aufloesung, repo, worktreeName: "sih-7", branchName: "b" });
    expect(s.pfad).toBe("/w/.claude/worktrees/web/sih-7");
    expect(s.befehle[1].args.at(-1)).toBe("origin/develop");
    expect(s.befehle[1].cwd).toBe("/w/web");
  });

  test("gelisteteWorktrees normalisiert Backslashes", () => {
    expect(L.gelisteteWorktrees("worktree C:\\a\\b\nHEAD x\n\nworktree /c\n")).toEqual(["C:/a/b", "/c"]);
  });

  test("standardRun: Erfolg und Fehler ohne Wurf", () => {
    expect(L.standardRun("node", ["-e", "console.log('hi')"]).stdout).toContain("hi");
    const f = L.standardRun("node", ["-e", "process.stderr.write('x');process.exit(3)"]);
    expect(f.code).toBe(3);
    expect(f.stderr).toBe("x");
    expect(L.standardRun("gibt-es-nicht-515", []).code).toBe(1);
  });
});

describe("umsetzerCli", () => {
  test("Aufruf-Fehler: Exit 2 mit Aufrufzeile", () => {
    for (const [art, argv] of [["start", []], ["start", ["x", "--slug", "a"]], ["start", ["7", "--slug", "a b"]], ["start", ["7", "8", "--slug", "a"]], ["ende", ["7", "--pr", "x", "--nonce", "n"]], ["ende", ["7", "--pr", "9"]]] as [string, string[]][]) {
      const r = L.umsetzerCli(art, argv, { wurzel: "." });
      expect(r.code, `${art} ${argv.join(" ")}`).toBe(2);
      expect(r.err).toContain(`Aufruf: node scripts/umsetzer-${art}.mjs`);
    }
  });

  test("Repo-Wahl und Config-Fehler", () => {
    expect(L.umsetzerCli("start", ["7", "--slug", "a", "--repo", "gibtsnicht"], { wurzel: "." }).code).toBe(2);
    expect(L.umsetzerCli("start", ["7", "--slug", "a"], { wurzel: "/gibt/es/nicht/515" }).code).toBe(1);
  });

  test("Start und Ende laufen durch die CLI mit gefaktem run", () => {
    const f = startFake();
    const s = L.umsetzerCli("start", ["7", "--slug", "x", "--nonce", NONCE], { wurzel: ".", run: f.run, existiert: () => false });
    expect(s.code).toBe(0);
    expect(s.out).toMatch(/START OK worktree=.*sih-7 branch=feature\/sih-7-x/);
    const e = L.umsetzerCli("ende", ["7", "--pr", "9", "--nonce", NONCE], { wurzel: ".", run: endeFake().run, existiert: () => false, cwd: "/anderswo" });
    expect(e.code).toBe(0);
    expect(e.out).toContain("ENDE OK MERGED abc123");
    const fehl = L.umsetzerCli("ende", ["7", "--pr", "9", "--nonce", NONCE], { wurzel: ".", run: endeFake({ "pr-warten": { code: 1, stdout: "ROT c u" } }).run, cwd: "/anderswo" });
    expect(fehl.code).toBe(1);
    expect(fehl.out).toBe("");
    expect(fehl.err).toContain("ROT c u");
  });
});
