/* @harness-waechter: Nur private, vollständig veröffentlichte native Artefakte ausführen. */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
// @ts-expect-error: Node-Skript ohne Declaration.
import * as raw from "../../scripts/codex-prozess-windows.mjs";
const w = raw as { windowsVorbereiten: () => string; windowsCacheProbe: (source: Buffer) => string };

const windowsTest = test.skipIf(process.platform !== "win32");
let fixture: string, moduleUrl: string, sourceFile: string, artifact: string, root: string, marker: string;
const prepare = "const fs=await import('node:fs');const w=await import(process.argv[1]);console.log(w.windowsCacheProbe(fs.readFileSync(process.argv[2])))";
const action = "const fs=await import('node:fs');const w=await import(process.argv[1]);w.windowsCacheProbe(fs.readFileSync(process.argv[2]));const cp=await import('node:child_process');process.exit(cp.spawnSync(process.execPath,['-e',\"require('fs').writeFileSync(process.argv[1],'unerlaubt')\",process.argv[3]]).status)";
function launch(code: string) { return spawnSync(process.execPath, ["--input-type=module", "-e", code, moduleUrl, sourceFile, marker], { encoding: "utf8" }); }
function parallelPrepare(lock: string) {
  return new Promise<string>((resolveResult, reject) => {
    const waiting = "const fs=await import('node:fs');const end=Date.now()+9000;while(!fs.existsSync(process.argv[4])){if(Date.now()>end)throw Error('Lock nicht sichtbar');await new Promise(r=>setTimeout(r,5))};";
    const child = spawn(process.execPath, ["--input-type=module", "-e", waiting + prepare.replace("const fs=await import('node:fs');", ""), moduleUrl, sourceFile, marker, lock], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; child.stdout.on("data", b => { out += String(b); }); child.stderr.on("data", b => { err += String(b); });
    child.once("error", reject); child.once("close", code => { if (code === 0) resolveResult(out.trim()); else reject(Error(err)); });
  });
}
describe.skipIf(process.platform !== "win32")("nativer Cache", () => {
beforeAll(async () => {
  if (process.platform !== "win32") return;
  fixture = mkdtempSync(join(tmpdir(), "codex-cache-test-")); marker = join(fixture, "zielmarker");
  sourceFile = join(fixture, "source.cs");
  writeFileSync(sourceFile, readFileSync(resolve("scripts/codex-prozess-windows.cs"), "utf8") + `\n// Fixture ${randomUUID()}\n`);
  moduleUrl = pathToFileURL(resolve("scripts/codex-prozess-windows.mjs")).href;
  const active = w.windowsVorbereiten(); root = dirname(dirname(active));
  const expected = JSON.parse(readFileSync(join(dirname(active), "manifest.json"), "utf8")) as Record<string, unknown>;
  delete expected.exeHash; expected.sourceHash = createHash("sha256").update(readFileSync(sourceFile)).digest("hex");
  const key = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  const outcomes = await Promise.allSettled([
    Promise.resolve().then(() => w.windowsCacheProbe(readFileSync(sourceFile))),
    parallelPrepare(join(root, `${key}.lock`)),
  ]);
  const original = outcomes[0], parallel = outcomes[1];
  if (original.status === "rejected") throw original.reason;
  if (parallel.status === "rejected") throw parallel.reason;
  expect(parallel.value).toBe(original.value); artifact = dirname(original.value);
  expect(w.windowsVorbereiten()).toBe(active);
});
afterAll(() => {
  if (artifact) {
    expect(dirname(realpathSync(artifact))).toBe(realpathSync(root));
    rmSync(artifact, { recursive: true });
  }
  if (fixture) rmSync(fixture, { recursive: true });
});

windowsTest("kalte parallele Vorbereitung veröffentlicht genau ein vollständiges Artefakt; Folgeimport nutzt Hash und Pfad", () => {
  expect(readdirSync(artifact).sort()).toEqual(["manifest.json", "source.cs", "supervisor.exe"]);
  const first = readFileSync(join(artifact, "supervisor.exe"));
  const again = launch(prepare); expect(again.status).toBe(0); expect(dirname(again.stdout.trim())).toBe(artifact);
  expect(createHash("sha256").update(readFileSync(join(artifact, "supervisor.exe"))).digest("hex")).toBe(createHash("sha256").update(first).digest("hex"));
});

windowsTest.each(["exe", "manifest", "architektur"])("beschädigter Cache %s stoppt vor jeder Zielaktion", mode => {
  const name = mode === "manifest" ? "manifest.json" : "supervisor.exe", file = join(artifact, name), original = readFileSync(file);
  try {
    const changed = Buffer.from(original);
    if (mode === "manifest") writeFileSync(file, "{}");
    else {
      if (mode === "architektur") changed.writeUInt16LE(0x14c, changed.readUInt32LE(60) + 4);
      else changed[changed.length - 1] ^= 1;
      writeFileSync(file, changed);
    }
    const result = launch(action); expect(result.status).toBe(1); expect(existsSync(marker)).toBe(false);
  } finally { writeFileSync(file, original); }
});

windowsTest("umgeleiteter Cache stoppt vor jeder Zielaktion", () => {
  const backup = `${artifact}-fixture-backup`; renameSync(artifact, backup);
  try {
    symlinkSync(backup, artifact, "junction");
    const result = launch(action); expect(result.status).toBe(1); expect(existsSync(marker)).toBe(false);
  } finally { rmdirSync(artifact); renameSync(backup, artifact); }
});

windowsTest("zusätzliche ACL-Berechtigung stoppt vor jeder Zielaktion", () => {
  const script = join(fixture, "acl-fixture.ps1");
  writeFileSync(script, "param($Path,$Mode,$Backup)\n$ErrorActionPreference='Stop'\nif($Mode -eq 'add') { $acl=[IO.Directory]::GetAccessControl($Path); [IO.File]::WriteAllText($Backup,$acl.GetSecurityDescriptorSddlForm('Access')); $sid=New-Object Security.Principal.SecurityIdentifier('S-1-1-0'); $rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow');$acl.AddAccessRule($rule);[IO.Directory]::SetAccessControl($Path,$acl) } else { $acl=New-Object Security.AccessControl.DirectorySecurity;$acl.SetSecurityDescriptorSddlForm([IO.File]::ReadAllText($Backup),'Access');[IO.Directory]::SetAccessControl($Path,$acl) }\n");
  const powershell = join(process.env.SystemRoot!, "System32/WindowsPowerShell/v1.0/powershell.exe"), backup = join(fixture, "acl.txt");
  try {
    execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-File", script, artifact, "add", backup], { windowsHide: true });
    const result = launch(action); expect(result.status).toBe(1); expect(existsSync(marker)).toBe(false);
  } finally { execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-File", script, artifact, "restore", backup], { windowsHide: true }); }
});
});

type PortableModule = typeof w & { windowsProzess: (file: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; input: string; timeoutMs: number; maxBytes: number }) => Promise<{ code: number; stdout: string; stderr: string }> };
describe("OS-Port des Originaladapters", () => {
  let sandbox: string, cache: string, adapter: PortableModule;
  let prepareFault: string, statusText: string, streamFault: string, compilerCalls: number, nativeCalls: number, requestDir: string;
  const peBytes = () => { const data = Buffer.alloc(128); data.writeUInt16LE(0x5a4d); data.writeUInt32LE(64, 60); data.writeUInt32LE(0x4550, 64); data.writeUInt16LE(0x8664, 68); return data; };
  beforeEach(async () => {
    sandbox = mkdtempSync(join(tmpdir(), "codex-cache-port-")); cache = join(sandbox, "cache"); mkdirSync(cache);
    const compiler = join(sandbox, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"); mkdirSync(dirname(compiler), { recursive: true }); writeFileSync(compiler, "fixture compiler");
    prepareFault = ""; statusText = "exit:23"; streamFault = ""; compilerCalls = 0; nativeCalls = 0;
    vi.stubEnv("SystemRoot", sandbox); vi.resetModules();
    vi.doMock("node:child_process", async () => ({
      ...await vi.importActual<typeof import("node:child_process")>("node:child_process"),
      execFileSync: (file: string, args: string[]) => {
        if (file.endsWith("powershell.exe")) return cache;
        if (file.endsWith("csc.exe")) {
          compilerCalls++; if (prepareFault === "compiler") throw Error("fixture compiler failed");
          const output = args.find(a => a.startsWith("/out:"))!; const data = peBytes();
          if (prepareFault === "short") writeFileSync(output.slice(5), data.subarray(0, 63));
          else { if (prepareFault === "arch") data.writeUInt16LE(0x14c, 68); writeFileSync(output.slice(5), data); }
          return Buffer.alloc(0);
        }
        nativeCalls++; if (prepareFault === "native") throw Error("fixture native failed");
        return Buffer.alloc(0);
      },
      spawn: (_file: string, args: string[]) => {
        requestDir = dirname(args[0]);
        const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: new EventEmitter(), kill: () => { queueMicrotask(() => child.emit("close", 1)); return true; } });
        Object.assign(child.stdin, { end: (input: string) => queueMicrotask(() => {
          writeFileSync(join(requestDir, "status.txt"), statusText);
          if (streamFault === "stdin") child.stdin.emit("error", Error("fixture pipe"));
          if (streamFault === "spawn") child.emit("error", Error("fixture spawn"));
          const bytes = Buffer.from(input); child.stdout.emit("data", bytes.subarray(0, 1)); child.stdout.emit("data", bytes.subarray(1));
          child.stderr.emit("data", Buffer.from("separat")); child.emit("close", 0);
        }) });
        return child;
      },
    }));
    // @ts-expect-error: Node-Skript ohne Declaration.
    adapter = await import("../../scripts/codex-prozess-windows.mjs") as PortableModule;
  });
  afterEach(() => { vi.doUnmock("node:child_process"); vi.unstubAllEnvs(); vi.resetModules(); rmSync(sandbox, { recursive: true }); });

  test("kalte Veröffentlichung und validierte Wiederverwendung laufen am Originalmodul", () => {
    const exe = adapter.windowsVorbereiten();
    expect(readdirSync(dirname(exe)).sort()).toEqual(["manifest.json", "source.cs", "supervisor.exe"]);
    expect(adapter.windowsCacheProbe(readFileSync(resolve("scripts/codex-prozess-windows.cs")))).toBe(exe);
    expect(compilerCalls).toBe(1); expect(nativeCalls).toBe(1);
    expect(readdirSync(cache)).toEqual([dirname(exe).slice(cache.length + 1)]);
  });
  test.each([["compiler", "fixture compiler failed"], ["native", "fixture native failed"], ["short", "Supervisor-PE fehlt"], ["arch", "Supervisor-Architektur"]])("Vorbereitungsfehler %s veröffentlicht nichts", (fault, error) => {
    prepareFault = fault; expect(() => adapter.windowsVorbereiten()).toThrow(error); expect(readdirSync(cache)).toEqual([]);
  });
  test("beschädigtes Manifest wird ohne neue Kompilierung abgewiesen", () => {
    const exe = adapter.windowsVorbereiten(); writeFileSync(join(dirname(exe), "manifest.json"), "{}");
    expect(() => adapter.windowsCacheProbe(readFileSync(resolve("scripts/codex-prozess-windows.cs")))).toThrow("Manifest"); expect(compilerCalls).toBe(1);
  });
  test("byteweise getrennte Ausgabe und Status bleiben getrennt; Request wird entfernt", async () => {
    adapter.windowsVorbereiten(); const result = await adapter.windowsProzess("fixture", ["", "a b"], { cwd: sandbox, env: { FIXTURE: undefined }, input: "ü🐈", timeoutMs: 3000, maxBytes: 100 });
    expect(result).toEqual({ code: 23, stdout: "ü🐈", stderr: "separat" }); expect(existsSync(requestDir)).toBe(false);
  });
  test.each([["timeout", "Frist"], ["error:fixture", "fixture"], ["exit:bad", "Supervisorstatus"]])("Status %s ist Fehler", async (status, error) => {
    adapter.windowsVorbereiten(); statusText = status;
    await expect(adapter.windowsProzess("fixture", [], { cwd: sandbox, env: {}, input: "", timeoutMs: 3000, maxBytes: 100 })).rejects.toThrow(error); expect(existsSync(requestDir)).toBe(false);
  });
  test.each(["stdin", "spawn", "output"])("Prozessportfehler %s schließt ab und räumt auf", async fault => {
    adapter.windowsVorbereiten(); streamFault = fault;
    await expect(adapter.windowsProzess("fixture", [], { cwd: sandbox, env: {}, input: "zu viel", timeoutMs: 3000, maxBytes: fault === "output" ? 1 : 100 })).rejects.toThrow(fault === "stdin" ? "pipe" : fault === "spawn" ? "spawn" : "Ausgabe"); expect(existsSync(requestDir)).toBe(false);
  });
});
