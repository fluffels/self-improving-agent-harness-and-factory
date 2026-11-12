/* @harness-waechter: Codex-Hook-Adapter und Schreibziel-Route des Dispatchers (factory#364); K4/K5 je Muster Red-Green. */
/* Herkunft der Fixtures (K1, docs/codex/einstieg.md § Codex-Hook-Schnittstelle): dokumentiert sind die Payload-Felder (`cwd`, `tool_name`, `tool_input.command`), `tool_name: "Bash"` und
 * `"apply_patch"` mit dem Patchtext in `tool_input.command` sowie die Deny-Form; `spawn_agent` folgt dem dokumentierten Aufrufbeispiel `collaboration.spawn_agent({ agent_type, message })` aus
 * docs/codex/einstieg.md (die Hook-Seite nennt `tool_input` nicht). Ausdrücklich ANNAHMEN (undokumentiert, nur fail-closed abgesichert, Beleg factory#367): `workdir`, `tool_name: "exec_command"`,
 * der Alias `Agent` und die Patch-Direktiven; sie stehen in Tests mit dem Zusatz „Annahme“. */
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, symlinkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as adapterRaw from "../../scripts/codex-hook-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as dispatcherRaw from "../../scripts/pretooluse-dispatch.mjs";

type Out = { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } | null;
const adapter = adapterRaw as unknown as {
  entscheide: (t: string, root: string, d?: Record<string, unknown>) => Promise<Out>;
  patchZiele: (p: unknown) => string[] | null;
  CODEX_HOOK_WERKZEUGE: Record<string, string>;
  CODEX_HOOK_TIMEOUT_S: number;
};
const dispatcher = dispatcherRaw as unknown as { dispatch: (t: string, root: string, g?: unknown, s?: unknown, d?: Record<string, unknown>) => Out };

let tmp = "";
let haupt = "";
let wt = "";
let fremd = "";
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

beforeAll(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), "codex-hook-")));
  haupt = join(tmp, "haupt");
  mkdirSync(join(haupt, ".claude"), { recursive: true });
  git(tmp, "init", "-q", "-b", "main", haupt);
  copyFileSync(".claude/settings.json", join(haupt, ".claude/settings.json"));
  writeFileSync(join(haupt, "a.txt"), "x");
  git(haupt, "add", "-A");
  git(haupt, "-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", "init");
  wt = join(tmp, "wt");
  git(haupt, "worktree", "add", "-q", "-b", "feature/x", wt);
  fremd = join(tmp, "fremd");
  git(tmp, "init", "-q", "-b", "main", fremd);
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const nutzlast = (tool_name: string, tool_input: unknown, cwd = wt) => JSON.stringify({ session_id: "s", cwd, hook_event_name: "PreToolUse", tool_name, tool_input });
const lauf = (text: string, d: Record<string, unknown> = {}) => adapter.entscheide(text, haupt, d);
const grund = (o: Out) => o?.hookSpecificOutput.permissionDecisionReason ?? "";
const patch = (...zeilen: string[]) => ["*** Begin Patch", ...zeilen, "*** End Patch", ""].join("\n");
const KOPF = "Brille: architektur · Arbeitsverzeichnis: x";

describe("Dispatcher für den Codex-Adapter", () => {
  test("beiFehler sieht einen werfenden Guard, ohne beiFehler bleibt es fail-open", () => {
    const fehler: unknown[] = [];
    const guards = { decide: () => { throw new Error("kaputt"); }, bewertePowerShell: () => ({ block: false }), bewerteGh: () => ({ block: false }) };
    const text = nutzlast("Bash", { command: "git status" });
    expect(dispatcher.dispatch(text, haupt, guards, undefined, { beiFehler: (e: unknown) => fehler.push(e) })).toBeNull();
    expect(fehler).toHaveLength(1);
    expect(() => dispatcher.dispatch(text, haupt, guards)).not.toThrow();
  });
  const write = (pfad: string, cwd = wt) => dispatcher.dispatch(nutzlast("Write", { file_path: pfad }, cwd), haupt);
  test("Write: Ziel im Haupt-Checkout und neuer Ordner darunter blockt, auch bei relativem Pfad", () => {
    expect(write(join(haupt, "a.txt"))?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(write(join(haupt, "neu", "tief", "b.txt"))?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(write("a.txt", haupt)?.hookSpecificOutput.permissionDecision).toBe("deny");
  });
  test("Write ohne cwd oder ohne Pfad: kein Block (der Adapter prüft das Format selbst)", () => {
    expect(dispatcher.dispatch(JSON.stringify({ tool_name: "Write", tool_input: { file_path: join(haupt, "a.txt") } }), haupt)).toBeNull();
    expect(dispatcher.dispatch(nutzlast("Write", {}, haupt), haupt)).toBeNull();
  });
  test("Write: .git-Segment blockt, verlinkter Worktree und Ort außerhalb lassen durch", () => {
    expect(grund(write(join(wt, ".git", "config")))).toContain(".git");
    expect(write(join(wt, "neu", "b.txt"))).toBeNull();
    expect(write(join(tmp, "ausserhalb", "c.txt"))).toBeNull();
    expect(write(join(fremd, "d.txt"))).toBeNull(); // Haupt-Checkout eines anderen, ungeschützten Repos
  });
  test("Write: .GIT in anderer Schreibweise und ein Symlink auf .git blocken", () => {
    expect(grund(write(join(wt, ".GIT", "hooks", "pre-commit")))).toContain(".git");
    symlinkSync(join(haupt, ".git"), join(wt, "lnk"));
    expect(grund(write(join(wt, "lnk", "hooks", "pre-commit")))).toContain(".git");
  });
});

describe("K4: Muster, die der Claude-Dispatcher verweigert, verweigert der Adapter", () => {
  test("Schreiben außerhalb des eigenen Worktrees: git commit im Haupt-Checkout", async () => {
    expect((await lauf(nutzlast("Bash", { command: "git commit -m x" }, haupt)))?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect((await lauf(nutzlast("exec_command", { command: "git commit -m x" }, haupt)))?.hookSpecificOutput.permissionDecision).toBe("deny");
  });
  test("Annahme (undokumentiert): workdir gilt als cwd", async () => {
    expect(await lauf(nutzlast("Bash", { command: "git commit --allow-empty -m x", workdir: haupt }, wt))).not.toBeNull();
  });
  test("Schreiben außerhalb des eigenen Worktrees: apply_patch Add File im Haupt-Checkout", async () => {
    expect(grund(await lauf(nutzlast("apply_patch", { command: patch("*** Add File: neu.txt", "+x") }, haupt)))).toContain("main-Checkout");
    expect(await lauf(nutzlast("apply_patch", { command: patch("*** Update File: a.txt", "@@", "-x", "+y", "*** Move to: ../../etc/y") }, wt))).toBeNull();
  });
  test("gh issue delete (Ask-Regel der settings.json) und gh repo delete (Deny-Regel)", async () => {
    expect(grund(await lauf(nutzlast("Bash", { command: "gh issue delete 5" })))).toContain("Codex kennt keine Rückfrage");
    expect(grund(await lauf(nutzlast("Bash", { command: "git status && gh repo delete x" })))).toContain("Bash(gh repo delete:*)");
  });
  test("Push auf main im Haupt-Checkout", async () => {
    expect((await lauf(nutzlast("Bash", { command: "git push origin main" }, haupt)))?.hookSpecificOutput.permissionDecision).toBe("deny");
  });
  test("Stdin-Skript", async () => {
    expect(grund(await lauf(nutzlast("Bash", { command: "python3 - <<'EOF'\nprint(1)\nEOF" })))).toContain("stdin");
  });
  test("Lens-Auftrag ohne Pflichtteil und Holdout-Szenario an Nicht-Abnahme-Agenten", async () => {
    expect(grund(await lauf(nutzlast("spawn_agent", { agent_type: "sih-lens", message: "Prüfe das mal." })))).toContain("Brille");
    const szenario = "Szenario 1.1: Gegeben ein Zustand, wenn x, dann y.";
    expect(grund(await lauf(nutzlast("spawn_agent", { agent_type: "explore", message: szenario })))).toContain("Holdout");
  });
  test("Patch mit mehreren Zielen: ein verbotenes Ziel an späterer Stelle blockt", async () => {
    const o = await lauf(nutzlast("apply_patch", { command: patch("*** Add File: ok.txt", "+x", `*** Add File: ${join(haupt, "neu.txt")}`, "+y") }));
    expect(grund(o)).toContain("main-Checkout");
  });
  test("Selbstschutz: .codex auch mit Backslash und anderer Schreibweise", async () => {
    for (const z of [".codex\\hooks.json", ".CODEX/hooks.json"]) expect(grund(await lauf(nutzlast("apply_patch", { command: patch(`*** Add File: ${z}`, "+{}") })))).toContain(".codex");
  });
  test("Selbstschutz: Patch nach .codex", async () => {
    expect(grund(await lauf(nutzlast("apply_patch", { command: patch("*** Add File: .codex/hooks.json", "+{}") })))).toContain(".codex");
  });
});

describe("Positive Fälle: nichts ausgeben", () => {
  test("git status, Patch im verlinkten Worktree, sauberer Lens-Auftrag (Arm A für ungerades Ticket)", async () => {
    expect(await lauf(nutzlast("Bash", { command: "git status" }))).toBeNull();
    expect(await lauf(nutzlast("apply_patch", { command: patch("*** Add File: neu.txt", "+x", "*** Delete File: a.txt") }))).toBeNull();
    const lens = await lauf(nutzlast("spawn_agent", { agent_type: "sih-lens", message: `${KOPF} · Ticket #365 · Patch: /tmp/x.patch` }));
    expect(lens).toBeNull();
    expect(grund(await lauf(nutzlast("Agent", { agent_type: "sih-lens", message: "Prüfe das mal." })))).toContain("Lens-Auftrag"); // Alias Agent wird wie spawn_agent geprüft
    expect(await lauf(nutzlast("spawn_agent", { message: "Suche etwas im Repo." }))).toBeNull(); // ohne agent_type ist ein normaler Aufruf
  });
});

describe("K5: fail-closed für die registrierten Werkzeuge, fremde bleiben unberührt", () => {
  test.each([
    ["kaputtes JSON", () => "{nicht json"],
    ["leeres Payload", () => ""],
    ["Payload ohne tool_name", () => "{}"],
    ["tool_input fehlt", () => nutzlast("Bash", undefined)],
    ["command als Array", () => nutzlast("Bash", { command: ["git", "status"] })],
    ["Annahme: exec_command mit command als Zahl", () => nutzlast("exec_command", { command: 5 })],
    ["Annahme: workdir als Zahl", () => nutzlast("Bash", { command: "ls", workdir: 5 })],
    ["Patch ohne Begin Patch", () => nutzlast("apply_patch", { command: "*** Add File: a\n+x\n*** End Patch" })],
    ["Patch ohne End Patch", () => nutzlast("apply_patch", { command: "*** Begin Patch\n*** Add File: a\n+x\n" })],
    ["Patch mit leerem Ziel", () => nutzlast("apply_patch", { command: patch("*** Add File:  ", "+x") })],
    ["Patch mit Ziel und unbekannter Direktive", () => nutzlast("apply_patch", { command: patch("*** Add File: a", "+x", "*** Frobnicate: b") })],
    ["Patch ohne Ziel", () => nutzlast("apply_patch", { command: patch("@@") })],
    ["Patch mit unbekannter Direktive", () => nutzlast("apply_patch", { command: patch("*** Frobnicate: a") })],
    ["Patch als Zahl", () => nutzlast("apply_patch", { command: 7 })],
    ["spawn_agent message kein String", () => nutzlast("spawn_agent", { agent_type: "x", message: 3 })],
    ["spawn_agent agent_type kein String", () => nutzlast("spawn_agent", { agent_type: 3, message: "x" })],
    ["apply_patch ohne cwd", () => JSON.stringify({ tool_name: "apply_patch", tool_input: { command: patch("*** Add File: n.txt", "+x") } })],
    ["apply_patch mit leerem cwd", () => nutzlast("apply_patch", { command: patch("*** Add File: n.txt", "+x") }, "")],
    ["command leer", () => nutzlast("Bash", { command: "" })],
    ["message leer", () => nutzlast("spawn_agent", { agent_type: "x", message: "" })],
    ["agent_type leer", () => nutzlast("spawn_agent", { agent_type: "", message: "x" })],
    ["Shell ohne cwd", () => JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } })],
  ])("%s → Deny mit Grund", async (_n, text) => {
    const o = await lauf(text());
    expect(o?.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(grund(o)).toContain("fail-closed");
  });
  test("Berechtigungsregeln als Glob: abschließendes Sternchen und Sternchen in der Mitte", async () => {
    const regeln = (deny: string[]) => ({ lies: () => JSON.stringify({ permissions: { deny } }) });
    expect(grund(await lauf(nutzlast("Bash", { command: "gh x y" }), regeln(["Bash(gh x *)"])))).toContain("Bash(gh x *)");
    expect(grund(await lauf(nutzlast("Bash", { command: "git push origin main --force" }), regeln(["Bash(git push * --force)"])))).toContain("--force");
    expect(await lauf(nutzlast("Bash", { command: "git pushx" }), regeln(["Bash(git push * --force)"]))).toBeNull();
    expect(await lauf(nutzlast("Bash", { command: "echo gh x y" }), regeln(["Bash(gh x *)"]))).toBeNull(); // die Regel gilt am Segmentanfang
    expect(grund(await lauf(nutzlast("Bash", { command: 'gh x "a\nb"' }), regeln(["Bash(gh x *)"])))).toContain("Bash(gh x *)"); // Argument über mehrere Zeilen bleibt ein Segment
    expect(await lauf(nutzlast("Bash", { command: "ls a.b" }), regeln(["Bash(ls a.b)"]))).not.toBeNull();
    expect(await lauf(nutzlast("Bash", { command: "ls axb" }), regeln(["Bash(ls a.b)"]))).toBeNull(); // der Punkt gilt wörtlich
  });
  test("apply_patch: Fehlerursache und CRLF-Patch", async () => {
    expect(grund(await lauf(nutzlast("apply_patch", { command: "kein Patch" })))).toContain("apply_patch-Text nicht lesbar");
    expect(await lauf(nutzlast("apply_patch", { command: patch("*** Add File: crlf.txt", "+x").replace(/\n/g, "\r\n") }))).toBeNull();
  });
  test("Die Ursache steht im Grund: JSON null, tool_input fehlt oder Array, workdir kein Text", async () => {
    expect(grund(await lauf("null"))).toContain("ohne tool_name");
    expect(grund(await lauf(nutzlast("Bash", undefined)))).toContain("tool_input");
    expect(grund(await lauf(nutzlast("apply_patch", [])))).toContain("tool_input");
    expect(grund(await lauf(nutzlast("Bash", { command: "ls", workdir: 5 })))).toContain("workdir");
    expect(grund(await lauf(nutzlast("Bash", { command: 5 })))).toContain("Textbefehl");
  });
  test("werfender Guard und Ladefehler des Dispatchers → Deny", async () => {
    const werfend = { lade: () => Promise.resolve({ dispatch: (_t: string, _r: string, _g: unknown, _s: unknown, d: { beiFehler: (e: Error) => void }) => { d.beiFehler(new Error("boom")); return null; }, segmente: () => [] }) };
    expect(grund(await lauf(nutzlast("Bash", { command: "ls" }), werfend))).toContain("boom");
    const nichtLadbar = { lade: () => Promise.reject(new Error("Modul fehlt")) };
    expect(grund(await lauf(nutzlast("spawn_agent", { agent_type: "x", message: "y" }), nichtLadbar))).toContain("Modul fehlt");
  });
  test("Berechtigungsregeln: exakte Regel ohne :*, Präfix nur mit Wortgrenze, Patch und Spawn lesen die Regeln nicht", async () => {
    const regeln = (deny: string[], ask: string[] = []) => ({ lies: () => JSON.stringify({ permissions: { deny, ask } }) });
    expect(grund(await lauf(nutzlast("Bash", { command: "echo 1 && git status" }), regeln(["Bash(git status)"])))).toContain("Bash(git status)");
    expect(await lauf(nutzlast("Bash", { command: "git status -s" }), regeln(["Bash(git status)"]))).toBeNull();
    expect(grund(await lauf(nutzlast("Bash", { command: "gh x" }), regeln(["Bash(gh x:*)"])))).toContain("Bash(gh x:*)");
    expect(await lauf(nutzlast("Bash", { command: "gh xy" }), regeln(["Bash(gh x:*)"]))).toBeNull();
    expect(await lauf(nutzlast("Bash", { command: "gh x" }), regeln(["PowerShell(gh x *)", "Read(x)"]))).toBeNull();
    expect(await lauf(nutzlast("Bash", { command: "gh x" }), { lies: () => "{}" })).toBeNull();
    expect(grund(await lauf(nutzlast("Bash", { command: "gh x" }), regeln([], ["Bash(gh x:*)"])))).toContain("Codex kennt keine Rückfrage");
    const werfend = { lies: () => { throw new Error("nicht lesen"); } };
    expect(await lauf(nutzlast("apply_patch", { command: patch("*** Add File: n.txt", "+x") }), werfend)).toBeNull();
    expect(await lauf(nutzlast("spawn_agent", { agent_type: "explore", message: "Suche etwas." }), werfend)).toBeNull();
  });
  test("unlesbare settings.json → Deny mit Fix-Zeile", async () => {
    const o = await lauf(nutzlast("Bash", { command: "ls" }), { lies: () => { throw new Error("weg"); } });
    expect(grund(o)).toContain("settings.json");
  });
  test("ask des Dispatchers (gh api -X DELETE) wird Deny", async () => {
    expect(grund(await lauf(nutzlast("Bash", { command: "gh api -X DELETE repos/o/r/issues/1" })))).toContain("Codex kennt keine Rückfrage");
  });
  test.each([
    ["update_plan", { plan: [] }],
    ["mcp__playwright__browser_click", { ref: "x" }],
    ["Read", { file_path: "/etc/hosts", command: "git commit" }],
    ["write_stdin", { chars: "git commit" }],
  ])("fremdes Werkzeug %s → keine Ausgabe", async (name, eingabe) => {
    expect(await lauf(nutzlast(name, eingabe, haupt))).toBeNull();
  });
});

describe("Patch-Parser und Konstanten", () => {
  test("patchZiele", () => {
    expect(adapter.patchZiele(patch("*** Update File: a", "@@", "-1", "+2", "*** Move to: b", "*** End of File"))).toEqual(["a", "b"]);
    expect(adapter.patchZiele(null)).toBeNull();
    expect(adapter.patchZiele(patch("*** Update File: a", "@@", "-1", "+2", "*** End of File"))).toEqual(["a"]);
    expect(adapter.patchZiele(patch("*** Delete File: a"))).toEqual(["a"]);
    expect(adapter.patchZiele(patch("@@"))).toBeNull();
  });
  test("Werkzeugtabelle und Timeout", () => {
    expect(Object.keys(adapter.CODEX_HOOK_WERKZEUGE).sort()).toEqual(["Agent", "Bash", "apply_patch", "exec_command", "spawn_agent"]);
    expect(adapter.CODEX_HOOK_TIMEOUT_S).toBe(30);
  });
});

describe("Prozessstart", () => {
  const start = (text: string) => spawnSync("node", [join(process.cwd(), "scripts/codex-hook.mjs")], { input: text, encoding: "utf8", cwd: wt });
  test("Deny-JSON auf stdout, sauberer Fall leer, immer Exit 0", () => {
    const echt = start(nutzlast("Bash", { command: "gh issue delete 1" })); // braucht repoRoot (settings.json des Repos)
    expect((JSON.parse(echt.stdout) as NonNullable<Out>).hookSpecificOutput.permissionDecisionReason).toContain("Bash(gh issue delete:*)");
    const deny = start(nutzlast("Bash", { command: ["x"] }));
    expect(deny.status).toBe(0);
    expect((JSON.parse(deny.stdout) as NonNullable<Out>).hookSpecificOutput.permissionDecision).toBe("deny");
    const ok = start(nutzlast("update_plan", {}));
    expect(ok.status).toBe(0);
    expect(ok.stdout).toBe("");
    expect(start("{kaputt").stdout).toContain("deny");
  });
  test("der Adapter steht in den Leitplanken", () => {
    expect(readFileSync(".github/protected-paths.json", "utf8")).toContain("/scripts/codex-*.mjs");
    expect(readFileSync(".github/protected-paths.json", "utf8")).toContain("/scripts/pretooluse-dispatch.mjs");
  });
});
