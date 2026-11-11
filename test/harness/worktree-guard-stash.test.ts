/* Worktree-Guard: `git stash` (außer list/show) ist ortsunabhängig verboten (factory#323 L5).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Stashes sind repoweit geteilt (refs/stash): pop/apply kann fremden WIP anwenden. Geblockt wird auch im eigenen Worktree,
 * über Aliase, Interpreter und bei dynamischem Unterbefehl; `list`/`show` und reine Textargumente bleiben erlaubt.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { resolve } from "node:path";

type Decision = { block: boolean; ask?: boolean; reason?: string };
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/worktree-guard-hook.mjs";

const decide = (raw as { decide: (o: { cwd: string; command: string; repoRoot: string; deps: unknown }) => Decision }).decide;
const deps = { statSync: () => ({ isDirectory: () => true }), execFileSync: () => { throw new Error("kein git"); }, homedir: () => "/home/x" };
const ROOT = resolve("/repo/main");
const WT = resolve("/repo/wt");
const pruefe = (command: string) => decide({ cwd: WT, command, repoRoot: ROOT, deps });

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
      const r = pruefe(cmd);
      assert.equal(r.block, true);
      assert.match(r.reason ?? "", /repoweit geteilt \(refs\/stash\)/);
    });
  }
});

describe("dynamische Unterbefehle und Analysefehler", () => {
  test('list mit dynamischem Anhang und dynamische Option vor list sind abgelehnt', () => {
    assert.equal(pruefe('git stash list"$X"').block, true);
    assert.equal(pruefe('git stash -"$X" list').block, true);
    assert.equal(pruefe("git stash show$(x)").block, true, "dynamisches Wort, dessen statischer Rest show lautet");
  });

  test("wirft die Analyse (homedir), greift die grobe Wortregel: pop blockt, list nicht", () => {
    const kaputt = { ...deps, homedir: () => { throw new Error("h"); } };
    const lauf = (command: string) => decide({ cwd: WT, command, repoRoot: ROOT, deps: kaputt });
    assert.equal(lauf("cd ~ && git stash pop").block, true);
    assert.equal(lauf("cd ~ && git stash list").block, false);
  });
});

describe("analyse meldet den Stash ohne Rückgriff auf die grobe Regel", () => {
  const analyse = (raw as { analyse: (c: string, cwd: string, d: unknown) => { stash: boolean } }).analyse;
  test("git stash ohne Unterbefehl: stash gesetzt, ohne Fehler", () => {
    assert.equal(analyse("git stash", WT, deps).stash, true);
    assert.equal(analyse("git stash list", WT, deps).stash, false);
  });
});

describe("erlaubt bleibt", () => {
  for (const cmd of ["git stash list", "git stash show -p", 'echo "git stash pop"', 'gh issue comment --body "git stash"', "git status"]) {
    test(cmd, () => assert.equal(pruefe(cmd).block, false));
  }

  test("Regression: git commit im eigenen Worktree bleibt erlaubt", () => {
    assert.deepEqual(pruefe('git -C /repo/wt commit -m "x"'), { block: false });
  });
});
