/* Worktree-Guard: Grenzen des Auswerters (#1311) — eval, Alias-Tiefe, Parser-Operatoren, PowerShell-Tokenizer.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Ergänzt worktree-guard.test.ts und worktree-guard-powershell.test.ts um Fälle, die eine Sabotage sonst unbemerkt ließen:
 * `eval` wirkt nach außen (Ortswechsel) und wird mit der groben Regel vereint, die Alias-Tiefe ist dieselbe Grenze wie bei
 * Interpretern (fail-closed), geschachtelte `!`-Aliase sehen die `-c`-Aliase des Elternaufrufs, die Parser-Operatoren
 * `;;&`, `|&`, `>|`, `$"…"` und der PowerShell-Tokenizer (CRLF-Fortsetzung, `#` im Token, Punkt-Aufruf, `''`/`""`).
 * Die Einheitstests laufen gegen `analyse` mit Fakes (kein echtes git, kein Dateisystem).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { resolve } from "node:path";

type Analyse = { stash?: boolean; targets: string[]; asks: Map<string, { reason: string; mainOnly: boolean }> };
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/worktree-guard-hook.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as ps from "../../scripts/worktree-guard-powershell.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as qf from "../../scripts/quote-folge.mjs";

const analyse = (raw as { analyse: (c: string, cwd: string, deps: unknown) => Analyse }).analyse;
const deps = { statSync: () => ({ isDirectory: () => true }), execFileSync: () => { throw new Error("kein git"); }, homedir: () => "/home/x" };
const HAUPT = resolve("/repo/main");
const WT = resolve("/repo/wt");
const lauf = (cmd: string, cwd = HAUPT) => analyse(cmd, cwd, deps);
const ziele = (cmd: string, cwd = HAUPT) => lauf(cmd, cwd).targets;

describe("eval wirkt nach außen und wird mit der groben Regel vereint", () => {
  test("ein cd in eval gilt für das Folgekommando", () => {
    assert.deepEqual(ziele(`eval "cd '${HAUPT}'" && git push`, WT), [HAUPT]);
    assert.deepEqual(ziele(`eval "cd '${WT}'" && git push`, HAUPT), [WT]);
  });

  test("die grobe Wortregel gilt zusätzlich (konservativ gegen den Ausgangsort)", () => {
    assert.ok(ziele(`eval "cd '${WT}' && git push"`, HAUPT).includes(HAUPT), "grob: der Ausgangsort bleibt Ziel");
    assert.ok(ziele(`eval "cd '${WT}' && git push"`, HAUPT).includes(WT));
  });

  test("nicht statisches eval fragt (mainOnly) und läuft sonst ins grobe Netz", () => {
    const a = lauf('eval "$X"');
    assert.equal(a.asks.get(HAUPT)?.mainOnly, true);
    assert.deepEqual(a.targets, []);
    assert.ok(lauf('eval "git push $X"').targets.includes(HAUPT) || lauf('eval "git push $X"').asks.size > 0);
  });
});

describe("Alias-Tiefe: dieselbe Grenze wie bei Interpretern, fail-closed", () => {
  const kette = (n: number) => `git ${Array.from({ length: n }, (_x, i) => `-c alias.g${i}=${i === n - 1 ? "push" : `g${i + 1}`}`).join(" ")} g0`;

  test("bis zur Tiefe wird aufgelöst, darüber fragt der Hook (mainOnly)", () => {
    assert.ok(ziele(kette(2)).length > 0, "zwei Ebenen: commit/push erkannt");
    assert.ok(ziele(kette(3)).length > 0, "drei Ebenen: noch erkannt");
    assert.equal(lauf(kette(4)).asks.get(HAUPT)?.mainOnly, true, "ab der vierten Ebene fragt der Hook");
    const tief = lauf(kette(5));
    assert.equal(tief.targets.length, 0);
    assert.equal(tief.asks.get(HAUPT)?.mainOnly, true, "über der Tiefe: Rückfrage statt stilles Durchlassen");
  });

  test("im Worktree fragt die mainOnly-Rückfrage nicht nach dem Ziel, das Ziel selbst bleibt der Worktree", () => {
    assert.ok(lauf(kette(5), WT).asks.has(WT), "Frage vorgemerkt; decide entscheidet nach Haupt-Checkout");
  });

  test("`-c`-Aliase gelten nur für ihren git-Aufruf: ein späteres `git p` sieht die echte Konfiguration", () => {
    const konfig = { ...deps, execFileSync: (_c: string, args: string[]) => { if (args[0] === "config") return "push"; throw new Error("kein git"); } };
    assert.ok(analyse("git -c alias.p='!git status' p; git p", HAUPT, konfig).targets.length > 0, "der Push aus der echten Konfiguration wird erkannt");
    assert.ok(analyse("git -c alias.p='!echo' p; git p", HAUPT, konfig).targets.length > 0);
  });

  test("-c-Aliasnamen sind nicht case-sensitiv (wie in git)", () => {
    assert.ok(ziele("git -c alias.P=push p").length > 0);
    assert.ok(ziele("git -c alias.p=push P").length > 0);
  });

  test("`!`-Alias-Ketten über der Tiefe fragen", () => {
    const aliase = Array.from({ length: 6 }, (_x, i) => `-c alias.g${i}='!git g${i + 1}'`).join(" ").replace("alias.g5='!git g6'", "alias.g5='!git push'");
    const r = lauf(`git ${aliase} g0`);
    assert.ok(r.targets.length > 0 || r.asks.get(HAUPT)?.mainOnly === true, "nicht still durchlassen");
  });

  test("ein `!`-Alias sieht die -c-Aliase des Elternaufrufs", () => {
    assert.ok(ziele("git -c alias.g0='!git g1' -c alias.g1='!git push' g0").length > 0);
  });
});

describe("bash-parser: Operatoren ;;& |& >| und $\"…\" (über analyse)", () => {
  test("|& ist eine Pipeline: das git-Kommando dahinter wird bewertet", () => {
    assert.deepEqual(ziele(`cd '${WT}'; echo a |& git push`), [WT], "die Pipeline wirkt nicht nach außen, das cd davor gilt");
  });

  test(">| ist eine Umleitung, kein Pipe-Trenner", () => {
    assert.deepEqual(ziele(`cd '${WT}'; echo a >| datei; git push`), [WT]);
    assert.deepEqual(ziele("echo a >| git"), [], "git als Dateiname hinter >| ist kein Aufruf");
  });

  test("$\"…\" ist ein Wort", () => {
    assert.ok(ziele('$"git" push').length > 0);
    assert.deepEqual(ziele('echo $"git push"'), []);
  });

  test(";;& beendet einen case-Arm", () => {
    assert.deepEqual(ziele(`cd '${WT}'; case x in a) echo a ;;& *) git push ;; esac`), [WT], "der zweite Arm läuft im Verzeichnis nach dem cd");
  });
});

describe("PowerShell-Tokenizer: Altverhalten, das der Umbau mitnimmt", () => {
  type Stmt = { tokens: { value: string; literal: boolean }[] };
  const zerlege = (ps as { zerlege: (s: string) => Stmt[] }).zerlege;
  const worte = (s: string) => zerlege(s).map((st) => st.tokens.map((t) => t.value));

  test("Backtick + CRLF ist eine Zeilenfortsetzung", () => {
    assert.deepEqual(worte("git `\r\npush"), [["git", "push"]]);
  });

  test("# mitten im Token ist kein Kommentar", () => {
    assert.deepEqual(worte("Write-Output a#; git push"), [["Write-Output", "a#"], ["git", "push"]]);
  });

  test("'' und \"\" sind Escapes in ihren Strings", () => {
    assert.deepEqual(worte("echo 'it''s'"), [["echo", "it's"]]);
    assert.deepEqual(worte('echo "say ""hi"""'), [["echo", 'say "hi"']]);
  });

  test("Here-String-Opener nur am Tokenanfang; ein @' mitten im Token ist normaler Text", () => {
    assert.deepEqual(worte("x@'a'"), [["x@a"]]);
  });

  test("Here-String-Opener mitten im Token (@' hinter x) ist Text, kein Here-String", () => {
    assert.deepEqual(worte("x@'\na'"), [["x@\na"]]);
  });

  test("Punkt-Aufruf . git push wird als Aufruf erkannt", () => {
    const r = (ps as { bewertePowerShell: (o: unknown) => { block: boolean } }).bewertePowerShell({
      command: ". git push",
      cwd: HAUPT,
      repoRoot: HAUPT,
      deps: { istOrdner: () => true, kontext: () => ({ relevant: true, isMainWorktree: true, toplevel: HAUPT }) },
    });
    assert.equal(r.block, true);
  });
});

describe("quote-folge: Backslash als letztes Zeichen", () => {
  test("hat kein nächstes Zeichen und maskiert nichts", () => {
    const f = (qf as { quoteFolge: (t: string) => { masked: boolean }[] }).quoteFolge("a\\");
    assert.equal(f.length, 2);
    assert.equal(f.some((z) => z.masked), false);
  });
});

// factory#323 L5: `git stash` (außer list/show) ist ortsunabhängig verboten (Stashes sind repoweit geteilt, refs/stash).
type Decision = { block: boolean; ask?: boolean; reason?: string };
const decide = (raw as { decide: (o: { cwd: string; command: string; repoRoot: string; deps: unknown }) => Decision }).decide;
const pruefeStash = (command: string) => decide({ cwd: WT, command, repoRoot: HAUPT, deps });

describe("git stash ist ortsunabhängig abgelehnt", () => {
  for (const cmd of [
    "git stash",
    "git stash pop",
    "git stash apply stash@{0}",
    "git stash drop",
    "git stash push -m x",
    "git -C /repo/wt stash pop",
    "git -c alias.s=stash s pop",
    'bash -c "git stash pop"',
    'git stash "$X"',
  ]) {
    test(cmd, () => {
      const r = pruefeStash(cmd);
      assert.equal(r.block, true);
      assert.match(r.reason ?? "", /repoweit geteilt \(refs\/stash\)/);
      assert.match(r.reason ?? "", /add -A.*WIP/s, "Meldung nennt den Ersatz");
    });
  }
});

describe("dynamische Unterbefehle und Analysefehler", () => {
  test('list mit dynamischem Anhang und dynamische Option vor list sind abgelehnt', () => {
    assert.equal(pruefeStash('git stash list"$X"').block, true);
    assert.equal(pruefeStash('git stash -"$X" list').block, true);
    assert.equal(pruefeStash("git stash show$(x)").block, true, "dynamisches Wort, dessen statischer Rest show lautet");
  });

  test("wirft die Analyse (homedir), greift die grobe Wortregel: pop blockt, list nicht", () => {
    const kaputt = { ...deps, homedir: () => { throw new Error("h"); } };
    const lauf = (command: string) => decide({ cwd: WT, command, repoRoot: HAUPT, deps: kaputt });
    assert.equal(lauf("cd ~ && git stash pop").block, true);
    assert.equal(lauf("cd ~ && git stash list").block, false);
  });
});

describe("analyse meldet den Stash ohne Rückgriff auf die grobe Regel", () => {
  test("git stash ohne Unterbefehl: stash gesetzt, ohne Fehler", () => {
    assert.equal(lauf("git stash", WT).stash, true);
    assert.ok(!lauf("git stash list", WT).stash);
  });
});

describe("erlaubt bleibt", () => {
  for (const cmd of ["git stash list", "git stash show -p", 'echo "git stash pop"', 'gh issue comment --body "git stash"', "git status"]) {
    test(cmd, () => assert.equal(pruefeStash(cmd).block, false));
  }

  test("Regression: git commit im eigenen Worktree bleibt erlaubt", () => {
    assert.deepEqual(pruefeStash('git -C /repo/wt commit -m "x"'), { block: false });
  });
});

describe("Analysefehler bei geschütztem Befehl (factory#332 L38)", () => {
  const gitMock = (_c: string, _a: string[], o: { cwd: string }) => `${o.cwd}\n${HAUPT}/.git\n`;
  const kaputt = { ...deps, execFileSync: gitMock, statSync: (q: string) => ({ isDirectory: () => q.startsWith(HAUPT) }), homedir: () => { throw new Error("h"); } };
  const lauf2 = (command: string, cwd: string) => decide({ cwd, command, repoRoot: HAUPT, deps: kaputt });

  test("git -C ~/x commit im Worktree fragt statt still durchzugehen", () => {
    const r = lauf2("git -C ~/x commit -m a", WT);
    assert.equal(r.block, false);
    assert.equal(r.ask, true);
    assert.match(r.reason ?? "", /Ziel nicht bestimmbar \(Analysefehler\)/);
  });

  test("im Haupt-Checkout blockt die cwd-Prüfung weiter", () => {
    assert.equal(lauf2("git -C ~/x commit -m a", HAUPT).block, true);
  });

  test("ungeschützter Befehl bleibt erlaubt", () => {
    assert.deepEqual(lauf2("git -C ~/x status", WT), { block: false });
    assert.deepEqual(lauf2("cd ~ && git status", HAUPT), { block: false }, "kein Ziel [cwd] bei ungeschütztem Befehl");
  });
});
