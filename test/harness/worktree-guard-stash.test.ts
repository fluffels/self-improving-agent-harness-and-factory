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

describe("erlaubt bleibt", () => {
  for (const cmd of ["git stash list", "git stash show -p", 'echo "git stash pop"', 'gh issue comment --body "git stash"', "git status"]) {
    test(cmd, () => assert.equal(pruefe(cmd).block, false));
  }

  test("Regression: git commit im eigenen Worktree bleibt erlaubt", () => {
    assert.deepEqual(pruefe('git -C /repo/wt commit -m "x"'), { block: false });
  });
});
