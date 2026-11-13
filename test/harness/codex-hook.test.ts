/* @harness-waechter: Codex-Hook-Adapter und Schreibziel-Route des Dispatchers (factory#364); K4/K5 je Muster Red-Green. */
/* Herkunft der Fixtures (K1, docs/codex/einstieg.md § Codex-Hook-Schnittstelle): dokumentiert sind die Payload-Felder (`cwd`, `tool_name`, `tool_input.command`), `tool_name: "Bash"` und
 * `"apply_patch"` mit dem Patchtext in `tool_input.command` sowie die Deny-Form; `spawn_agent` folgt dem dokumentierten Aufrufbeispiel `collaboration.spawn_agent({ agent_type, message })` aus
 * docs/codex/einstieg.md (die Hook-Seite nennt `tool_input` nicht); die Namensraum-Form (`collaboration__spawn_agent` u. a.) und das v2-`tool_input` sind ANNAHME bis factory#459. Ausdrücklich ANNAHMEN (undokumentiert, nur fail-closed abgesichert, Beleg factory#367): `workdir`, `tool_name: "exec_command"`,
 * der Alias `Agent` und die Patch-Direktiven. Tests, die nur eine Annahme prüfen, tragen den Zusatz „Annahme“; `exec_command` und `Agent` erscheinen zusätzlich in einzelnen Mischtests
 * (K4-Muster, sauberer Lens-Auftrag, Werkzeugtabelle), `workdir` im Test der Fehlerursachen, und jede `apply_patch`-Fixture nutzt die angenommene Patch-Grammatik (die Hook-Seite beschreibt sie nicht). */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, symlinkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as adapterRaw from "../../scripts/codex-hook-lib.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as gesundRaw from "../../scripts/langfuse-health.mjs";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as dispatcherRaw from "../../scripts/pretooluse-dispatch.mjs";

type Out = { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } } | null;
const adapter = adapterRaw as unknown as {
  entscheide: (t: string, root: string, d?: Record<string, unknown>) => Promise<Out>;
  patchZiele: (p: unknown) => string[] | null;
  varianten: (seg: string, segmente: (c: string) => string[], tiefe?: number) => string[];
  CODEX_HOOK_WERKZEUGE: Record<string, string>;
  CODEX_HOOK_TIMEOUT_S: number;
  werkzeugArt: (n: string) => string | null;
  codexHookMuster: () => string;
};
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import { segmente as ghSegmente } from "../../scripts/gh-guard-hook.mjs";
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
const OK200 = { status: 200, text: () => Promise.resolve(`{"status":"OK"}`) }; // gültige Health-Antwort
const gesund = () => Promise.resolve({ ok: true, grund: "Langfuse erreichbar (HTTP 200)" }); // kein Test trifft das echte Netz
const lauf = (text: string, d: Record<string, unknown> = {}) => adapter.entscheide(text, haupt, { health: gesund, ...d });
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
  test("Stash-Sperre (factory#323) wirkt auch unter Codex (factory#397, L38): git stash, pop und env git stash verweigert, list und status laufen durch", async () => {
    for (const c of ["git stash", "git stash pop", "env git stash"]) {
      const o = await lauf(nutzlast("exec_command", { command: c }));
      expect(o?.hookSpecificOutput.permissionDecision, c).toBe("deny");
      expect(grund(o), c).toContain("git stash");
    }
    for (const c of ["git stash list", "git status"]) expect(await lauf(nutzlast("exec_command", { command: c })), c).toBeNull();
  });
  test("Annahme (undokumentiert): workdir gilt als cwd", async () => {
    expect(await lauf(nutzlast("Bash", { command: "git commit --allow-empty -m x", workdir: haupt }, wt))).not.toBeNull();
  });
  test("Schreiben außerhalb des eigenen Worktrees: apply_patch Add File im Haupt-Checkout", async () => {
    expect(grund(await lauf(nutzlast("apply_patch", { command: patch("*** Add File: neu.txt", "+x") }, haupt)))).toContain("main-Checkout");
    expect(await lauf(nutzlast("apply_patch", { command: patch("*** Update File: a.txt", "@@", "-x", "+y", "*** Move to: ../../etc/y") }, wt))).toBeNull();
  });
  test("gh issue delete und gh repo delete: der gh-Guard greift vor den settings-Regeln (factory#397)", async () => {
    expect(grund(await lauf(nutzlast("Bash", { command: "gh issue delete 5" })))).toContain("Codex kennt keine Rückfrage");
    expect(grund(await lauf(nutzlast("Bash", { command: "git status && gh repo delete x" })))).toContain("gh-Guard (factory#397)");
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
  test("git status, Patch im verlinkten Worktree, sauberer Lens-Auftrag", async () => {
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
  const WRAPPER_REGELN = { lies: () => JSON.stringify({ permissions: { deny: ["Bash(git push --force:*)", "Bash(rm -rf:*)", "Bash(curl:*)"], ask: ["Bash(npm publish:*)"] } }) };
  test.each([
    "env git push --force",
    "FOO=1 git push --force",
    "env -i FOO=1 curl http://x",
    "env -u A -- curl http://x",
    "/bin/rm -rf x",
    "/usr/bin/env curl http://x",
    "C:\\Git\\usr\\bin\\rm.exe -rf x",
    'bash -c "curl http://x"',
    "sh -c 'npm publish'",
    'bash -lc "git push --force"',
    'zsh -c "curl x"',
    'dash -c "curl x"',
    "git  push   --force",
    "command rm -rf x",
    "exec rm -rf x",
    "nohup curl x",
    "time curl x",
    'bash -c "bash -c \\"curl x\\""',
  ])("Wrapper-Form %s → Deny", async (command) => {
    expect(await lauf(nutzlast("Bash", { command }), WRAPPER_REGELN)).not.toBeNull();
  });
  test.each([
    'echo "rm -rf x"',
    "envsubst < a",
    "bash script.sh",
    "git push origin feature",
    "rm -r x",
    "env FOO=1 ls",
    "FOO=1",
    "a-b=1 curl x",
    "ls ;",
    "env",
    'bash -c "echo \\\\"',
    'bash -c "echo a" "b"',
    'bash -c "curl x',
    "bash -c 'curl x' extra",
    'bash -c "echo hallo"',
    'bash -c "curl x" extra',
  ])("harmlose Form %s → keine Ausgabe", async (command) => {
    expect(await lauf(nutzlast("Bash", { command }), WRAPPER_REGELN)).toBeNull();
  });
  test.each(["A=1 git push --force", "rm.EXE -rf x", "_a1=x curl http://x", "foo=1 curl http://x", "MY_VAR=1 curl http://x", "MY_VAR=1 git push --force"])("Wrapper-Form %s (Ein-Buchstaben-Variable, .EXE in Großschreibung) → Deny", async (command) => {
    expect(await lauf(nutzlast("Bash", { command }), WRAPPER_REGELN)).not.toBeNull();
  });
  test.each([
    'echo -c "curl x"', // kein Interpreter
    'bash script.sh "curl x"', // kein -c/-lc
    "rm.exe.bak -rf x", // `.exe` nur am Ende des Basisnamens
    "xrm -rf x",
    "bash -c x'curl x'", // Quote erst mitten im Wort: kein vollständig gequotetes Argument (Anker ^)
    'bash -c x"curl x"',
  ])("Anker und Interpreter-Prüfung: %s → keine Ausgabe", async (command) => {
    expect(await lauf(nutzlast("Bash", { command }), WRAPPER_REGELN)).toBeNull();
  });
  test("gemischte Quotes: `entquote` entquotet nur vollständig gequotete Argumente; alles andere bleibt unzerlegt (bekannte Grenze, fail-open)", async () => {
    // Die Shell würde `bash -c "curl x"'y'` als `curl xy` ausführen; der Adapter zerlegt es nicht (Grenze, im Kopf der Lib genannt).
    for (const c of ["'curl x'y", `"curl x"'y'`, `bash -c 'curl x'y`, `bash -c "curl x"'y'`]) expect(await lauf(nutzlast("Bash", { command: c }), WRAPPER_REGELN), c).toBeNull();
    expect(await lauf(nutzlast("Bash", { command: `bash -c "curl x"` }), WRAPPER_REGELN)).not.toBeNull();
  });
  test("Regel-Anker: nur `Bash(...)` am Anfang und Ende der Regel zählt", async () => {
    const regeln = (r: string) => ({ lies: () => JSON.stringify({ permissions: { deny: [r] } }) });
    expect(await lauf(nutzlast("Bash", { command: "a.exe.b x" }), regeln("Bash(a.b:*)"))).toBeNull(); // `.exe` fällt nur am Ende weg (Anker $)
    expect(await lauf(nutzlast("Bash", { command: "curl x" }), regeln("Bash(curl:*)"))).not.toBeNull();
    for (const r of ["xBash(curl:*)", "Bash(curl:*)x", "Read(curl:*)"]) expect(await lauf(nutzlast("Bash", { command: "curl x" }), regeln(r)), r).toBeNull();
  });
  test("varianten: Rekursion höchstens Tiefe 3, Interpreter-String ohne Zerlegung ergibt keine Zusatzform", () => {
    const wrap = (s: string) => `bash -c "${s.replace(/[\\"]/g, "\\$&")}"`;
    const seg = ghSegmente as (c: string) => string[];
    expect(adapter.varianten(wrap(wrap(wrap("curl x"))), seg)).toContain("curl x");
    expect(adapter.varianten(wrap(wrap(wrap(wrap("curl x")))), seg)).not.toContain("curl x");
    expect(adapter.varianten("bash -c \"curl x\" y", seg)).toEqual(["bash -c \"curl x\" y"]); // Interpreter mit Zusatzwort: keine Zerlegung
    expect(adapter.varianten("bash -c curl", seg)).toEqual(["bash -c curl"]);
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
    ["spawn_agent_x", { task_name: "t", message: "Prüfe das mal." }],
    ["xspawn_agent", { task_name: "t", message: "Prüfe das mal." }],
    ["a.b.spawn_agent", { task_name: "t", message: "Prüfe das mal." }],
    ["a__b__spawn_agent", { task_name: "t", message: "Prüfe das mal." }],
    ["mcp__srv__spawn_agent", { task_name: "t", message: "Prüfe das mal." }],
    ["collaboration__send_message", { target: "t", message: "Prüfe das mal." }],
  ])("fremdes Werkzeug %s → keine Ausgabe", async (name, eingabe) => {
    expect(await lauf(nutzlast(name, eingabe, haupt))).toBeNull();
  });
});

describe("Namensraum von spawn_agent (Annahme bis factory#459)", () => {
  // ANNAHME (factory#455/457): Codex meldet spawn_agent im Namensraum (collaboration); ob der Hook den Namen mit oder ohne Präfix sieht, belegt erst factory#459.
  const v2 = { task_name: "pruefer", message: "Prüfe das mal.", agent_type: "sih-lens", fork_turns: "none" };
  const positiv = ["collaboration__spawn_agent", "collaboration.spawn_agent", "collaboration/spawn_agent", "multi_agent_v1.spawn_agent", "spawn_agent"];
  const negativ = ["spawn_agent_x", "xspawn_agent", "a.b.spawn_agent", "a__b__spawn_agent", "mcp__srv__spawn_agent", "collaboration__send_message", "collaboration__spawn_agent_x", ""];
  test.each(positiv)("%s mit v2-tool_input: Art agent, Lens-Guard greift", async (name) => {
    expect(adapter.werkzeugArt(name)).toBe("agent");
    expect(grund(await lauf(nutzlast(name, v2)))).toContain("Brille");
  });
  test.each(positiv.slice(0, 4))("%s: Holdout-Guard greift", async (name) => {
    expect(grund(await lauf(nutzlast(name, { task_name: "t", agent_type: "explore", message: "Szenario 1.1: Gegeben ein Zustand, wenn x, dann y." })))).toContain("Holdout");
  });
  test.each(negativ)("%s: keine Art, Matcher trifft nicht", (name) => {
    expect(adapter.werkzeugArt(name)).toBeNull();
    expect(new RegExp(adapter.codexHookMuster()).test(name)).toBe(false);
  });
  test("Konsistenz: Matcher trifft genau, was werkzeugArt erkennt", () => {
    for (const n of [...positiv, ...negativ, "Bash", "exec_command", "apply_patch", "Agent", "write_stdin", "Bash2"]) expect(new RegExp(adapter.codexHookMuster()).test(n), n).toBe(adapter.werkzeugArt(n) !== null);
  });
  test("task_name kein nichtleerer String → Deny; fork_turns wird nicht ausgewertet", async () => {
    expect(grund(await lauf(nutzlast("collaboration__spawn_agent", { task_name: 3, message: "x" })))).toContain("task_name");
    expect(grund(await lauf(nutzlast("collaboration__spawn_agent", { task_name: "", message: "x" })))).toContain("task_name");
    expect(await lauf(nutzlast("collaboration__spawn_agent", { task_name: "t", message: "Suche etwas im Repo.", fork_turns: 3 }))).toBeNull();
  });
  test("Tracing-Ausfallstopp greift auch für die Namensraum-Form", async () => {
    const aus = { health: () => Promise.resolve({ ok: false, grund: "tot" }), lade: () => Promise.reject(new Error("nicht laden")) };
    expect(grund(await lauf(nutzlast("collaboration__spawn_agent", v2), aus))).toContain("Tracing-Ausfallstopp");
    expect(grund(await lauf(nutzlast("collaboration.spawn_agent", v2), aus))).toContain("Tracing-Ausfallstopp");
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
    expect((JSON.parse(echt.stdout) as NonNullable<Out>).hookSpecificOutput.permissionDecisionReason).toContain("gh-Guard (factory#397)");
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

describe("Tracing-Ausfallstopp für spawn_agent (factory#365)", () => {
  const health = gesundRaw as unknown as { pruefeLangfuse: (a: { baseUrl: string; fetchImpl: unknown; fristMs: number }) => Promise<{ ok: boolean; grund: string }>; pruefeLangfuseAusUmgebung: (a: Record<string, unknown>) => Promise<{ ok: boolean; grund: string }> };
  const ausfaelle: [string, unknown][] = [
    ["Verbindung verweigert", () => Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))],
    ["Frist überschritten", (_u: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("abort"))))],
    ["HTTP 503", () => Promise.resolve({ status: 503 })],
    ["ungültige Antwort ohne Status", () => Promise.resolve({})],
  ];
  const spawn = nutzlast("spawn_agent", { agent_type: "sih-lens", message: `${KOPF} · Ticket #365 · Patch: /tmp/x.patch` });
  for (const [name, stub] of ausfaelle) {
    test(`Ausfall (${name}): Deny, Dispatcher wird nicht geladen, auch beim Alias Agent`, async () => {
      let geladen = 0;
      const d = { health: () => health.pruefeLangfuse({ baseUrl: "http://lf.test", fetchImpl: stub, fristMs: 20 }), lade: () => { geladen++; return Promise.reject(new Error("nicht laden")); } };
      expect(grund(await lauf(spawn, d))).toContain("Tracing-Ausfallstopp");
      expect(grund(await lauf(nutzlast("Agent", { agent_type: "explore", message: "Suche." }), d))).toContain("Tracing-Ausfallstopp");
      expect(geladen).toBe(0);
    });
  }
  test("ungültige 200-Antwort (HTML, {}, falscher Status, kein Body) → Deny, Dispatcher nicht geladen; gültiger Body lässt durch", async () => {
    let geladen = 0;
    const lade = () => { geladen++; return Promise.reject(new Error("nicht laden")); };
    const mitBody = (text: string) => () => health.pruefeLangfuseAusUmgebung({ env: { LANGFUSE_BASE_URL: "http://lf.test" }, fetchImpl: () => Promise.resolve({ status: 200, text: () => Promise.resolve(text) }) });
    for (const text of ["<html>hi</html>", "{}", '{"status":"FAIL"}']) expect(grund(await lauf(spawn, { health: mitBody(text), lade })), text).toContain("Tracing-Ausfallstopp");
    const ohneBody = () => health.pruefeLangfuseAusUmgebung({ env: { LANGFUSE_BASE_URL: "http://lf.test" }, fetchImpl: () => Promise.resolve({ status: 200 }) });
    expect(grund(await lauf(spawn, { health: ohneBody, lade }))).toContain("Tracing-Ausfallstopp");
    expect(geladen).toBe(0);
    expect(await lauf(spawn, { health: mitBody('{"status":"OK"}') })).toBeNull();
  });
  test("werfende Health und Urteil ohne ok → Deny", async () => {
    expect(grund(await lauf(spawn, { health: () => { throw new Error("kaputt"); } }))).toContain("Health-Prüfung gescheitert: kaputt");
    expect(grund(await lauf(spawn, { health: () => Promise.resolve({}) }))).toContain("Tracing-Ausfallstopp");
  });
  test("erreichbar: Guard-Entscheid bleibt, Health genau einmal je spawn_agent", async () => {
    let n = 0;
    const d = { health: () => { n++; return Promise.resolve({ ok: true, grund: "ok" }); } };
    expect(grund(await lauf(nutzlast("spawn_agent", { agent_type: "sih-lens", message: "Prüfe das mal." }), d))).toContain("Brille");
    expect(await lauf(spawn, d)).toBeNull();
    expect(n).toBe(2);
  });
  test("Shell, apply_patch und fremde Werkzeuge rufen die Health nie; ungültiges Payload endet vor ihr", async () => {
    const d = { health: () => { throw new Error("darf nicht gerufen werden"); } };
    expect(await lauf(nutzlast("Bash", { command: "ls" }), d)).toBeNull();
    expect(await lauf(nutzlast("apply_patch", { command: patch("*** Add File: n.txt", "+x") }), d)).toBeNull();
    expect(await lauf(nutzlast("update_plan", {}), d)).toBeNull();
    expect(grund(await lauf(nutzlast("spawn_agent", { agent_type: "x", message: 3 }), d))).toContain("message");
  });
  test("Standardprüfung: ohne deps.health fragt der Adapter die Umgebung ab (global fetch, LANGFUSE_BASE_URL), Erreichbarkeit lässt durch", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", (u: string) => { urls.push(u); return Promise.resolve(OK200); });
    vi.stubEnv("LANGFUSE_BASE_URL", "http://lf.test");
    try {
      expect(await adapter.entscheide(spawn, haupt)).toBeNull();
      expect(urls).toEqual(["http://lf.test/api/public/health"]);
    } finally {
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });
  test("Standardprüfung: Ausfall nennt den Grund der Health-Prüfung (kein Ladefehler)", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(Object.assign(new Error("x"), { code: "ECONNREFUSED" })));
    vi.stubEnv("LANGFUSE_BASE_URL", "http://lf.test");
    try {
      expect(grund(await adapter.entscheide(spawn, haupt))).toContain("Langfuse nicht erreichbar: ECONNREFUSED");
    } finally {
      vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });
  test("Standardfrist der Umgebungsprüfung ist FRIST_MS (3000 ms) auch im Hook-Pfad", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_u: string, o: { signal: AbortSignal }) => new Promise((_r, rej) => o.signal.addEventListener("abort", () => rej(new Error("abort")))));
    vi.stubEnv("LANGFUSE_BASE_URL", "http://lf.test");
    try {
      const hang = adapter.entscheide(spawn, haupt);
      await vi.advanceTimersByTimeAsync(2999);
      let fertig = false; void hang.then(() => { fertig = true; });
      await vi.advanceTimersByTimeAsync(0); expect(fertig).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(grund(await hang)).toContain("Timeout nach 3000 ms");
    } finally {
      vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });
  test("Urteil ohne Auskunft: nur ok === true lässt durch, Grund-Fallback und Nicht-Error-Wurf", async () => {
    expect(grund(await lauf(spawn, { health: () => Promise.resolve({ ok: false }) }))).toContain("Health ohne Urteil");
    expect(grund(await lauf(spawn, { health: () => Promise.resolve(undefined) }))).toContain("Health ohne Urteil");
    expect(grund(await lauf(spawn, { health: () => Promise.resolve({ ok: "ja" }) }))).toContain("Tracing-Ausfallstopp");
    expect(grund(await lauf(spawn, { health: () => Promise.resolve().then(() => { throw JSON.parse(`"textwurf"`); }) }))).toContain("textwurf");
  });
});
