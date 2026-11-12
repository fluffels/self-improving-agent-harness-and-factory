/* gh-Guard-Wächter für destruktive gh-Unterbefehle (factory#397, L9 aus factory#393).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Regel: `gh issue delete` & Co. (geschlossene Liste `GH_DESTRUKTIV`, gleich den ask/deny-gh-Regeln der settings.json)
 * fragen an jeder Stelle außerhalb von Quotes, auch hinter `env`, Zuweisung, absolutem Pfad, Wrapper und Interpreter-String
 * (Claude: ask; Codex: daraus wird Deny). Die wörtliche Präfix-Regel der settings.json fängt diese Formen nicht.
 * Grenze: gequoteter Kommandoname, zerstückelte Wörter, Skriptdateien, `node -e` (Kopf des Hooks). */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as guardRaw from "../../scripts/gh-guard-hook.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as adapterRaw from "../../scripts/codex-hook-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as dispatcherRaw from "../../scripts/pretooluse-dispatch.mjs";

type Out = { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } | null;
const guard = guardRaw as unknown as { bewerte: (c: string, o?: { shell?: string }) => { ask: boolean; reason?: string }; GH_DESTRUKTIV: readonly string[] };
const adapter = adapterRaw as unknown as { entscheide: (t: string, root: string) => Promise<Out> };
const dispatcher = dispatcherRaw as unknown as { dispatch: (t: string, root: string) => Out };

let tmp = "";
let haupt = "";
let wt = "";
beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "gh-unter-")));
  haupt = join(tmp, "haupt");
  mkdirSync(join(haupt, ".claude"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", haupt]);
  copyFileSync(".claude/settings.json", join(haupt, ".claude/settings.json"));
  writeFileSync(join(haupt, "a.txt"), "x");
  execFileSync("git", ["add", "-A"], { cwd: haupt });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "init"], { cwd: haupt });
  wt = join(tmp, "wt");
  execFileSync("git", ["worktree", "add", "-q", "-b", "feature/x", wt], { cwd: haupt });
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const nutzlast = (command: string, tool_name = "exec_command") => JSON.stringify({ session_id: "s", cwd: wt, hook_event_name: "PreToolUse", tool_name, tool_input: { command } });
const FORMEN = ["env gh issue delete 5", "FOO=1 gh issue delete 5", "/usr/bin/gh issue delete 5", 'bash -c "gh issue delete 5"'];
const WEITERE = [
  "command gh label delete x",
  "sudo gh repo delete o/r --yes",
  "nohup gh issue transfer 5 o/r",
  "gh  issue   delete 5",
  "echo ok && env gh project item-delete 1 --id x",
  'echo "$(gh issue delete 5)"',
  'pwsh -Command "gh issue delete 5"',
  "/usr/bin/gh issue create",
];
const NEGATIV = [
  "gh issue view 5",
  "gh issue list",
  "gh issue close 5",
  "gh project item-list 1",
  'gh issue comment 5 --body "gh issue delete 5"',
  'git commit -m "gh label delete erklärt"',
  "git commit -F - <<'EOF'\nText mit gh repo delete im Body\nEOF",
];

describe("Claude: destruktive gh-Unterbefehle hinter Wrappern fragen", () => {
  test.each([...FORMEN, ...WEITERE])("%s", (c) => {
    expect(guard.bewerte(c, { shell: "bash" }).ask).toBe(true);
  });
  test("PowerShell: Pfadform mit .exe", () => {
    expect(guard.bewerte("C:\\tools\\gh.exe issue delete 5", { shell: "powershell" }).ask).toBe(true);
  });
  test.each(guard.GH_DESTRUKTIV ?? [])("env gh %s x", (e) => {
    expect(guard.bewerte(`env gh ${e} x`, { shell: "bash" }).ask).toBe(true);
  });
  test("Dispatcher-Weg liefert ask", () => {
    const o = dispatcher.dispatch(JSON.stringify({ session_id: "s", cwd: haupt, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "env gh issue delete 5" } }), haupt);
    expect(o?.hookSpecificOutput.permissionDecision).toBe("ask");
  });
  test.each(NEGATIV)("Negativfall läuft durch: %s", (c) => {
    expect(guard.bewerte(c, { shell: "bash" }).ask).toBe(false);
  });
});

describe("Codex: aus ask wird Deny durch den gh-Guard", () => {
  test.each(FORMEN)("%s", async (c) => {
    const o = await adapter.entscheide(nutzlast(c), haupt);
    expect(o?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(o?.hookSpecificOutput.permissionDecisionReason).toContain("gh-Guard");
  });
  test.each(NEGATIV)("Negativfall läuft durch: %s", async (c) => {
    expect(await adapter.entscheide(nutzlast(c), haupt)).toBeNull();
  });
});

describe("Sync mit der settings.json", () => {
  const s = JSON.parse(readFileSync(".claude/settings.json", "utf8")).permissions as { ask: string[]; deny: string[] };
  const regeln = [...s.ask, ...s.deny];
  const bash = new Set(regeln.map((r) => /^Bash\(gh (\w+ [\w-]+):\*\)$/.exec(r)?.[1]).filter((x): x is string => !!x && x !== "issue create"));
  test("GH_DESTRUKTIV ist gleich den Bash(gh …)-Regeln ohne issue create", () => {
    expect([...guard.GH_DESTRUKTIV].sort()).toEqual([...bash].sort());
  });
  test.each([...bash])("PowerShell-Zwilling für %s", (e) => {
    expect(regeln).toContain(`PowerShell(gh ${e} *)`);
  });
});
