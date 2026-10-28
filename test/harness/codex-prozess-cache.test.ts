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
function parallelPrepare(lock: string, observed: string) {
  let readyResolve!: () => void, readyReject!: (e: unknown) => void;
  const ready = new Promise<void>((resolveReady, rejectReady) => { readyResolve = resolveReady; readyReject = rejectReady; });
  const result = new Promise<string>((resolveResult, reject) => {
    const waiting = "const fs=await import('node:fs');const w=await import(process.argv[1]);console.log('READY');const end=Date.now()+9000;while(!fs.existsSync(process.argv[4])){if(Date.now()>end)throw Error('Lock nicht sichtbar');await new Promise(r=>setTimeout(r,5))};fs.writeFileSync(process.argv[5],'LOCK_ACK');";
    const child = spawn(process.execPath, ["--input-type=module", "-e", waiting + "console.log(w.windowsCacheProbe(fs.readFileSync(process.argv[2])))", moduleUrl, sourceFile, marker, lock, observed], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; child.stdout.on("data", b => { out += String(b); }); child.stderr.on("data", b => { err += String(b); });
    child.stdout.on("data", () => { if (out.startsWith("READY\n")) readyResolve(); });
    child.once("error", reject); child.once("close", code => { if (code === 0) resolveResult(out.replace(/^READY\r?\n/, "").trim()); else reject(Error(err)); });
  });
  void result.catch(readyReject);
  return { ready, result };
}
async function parallelPublizieren(publish: () => string, peer: { ready: Promise<void>; result: Promise<string> }) {
  const [original, parallel] = await Promise.allSettled([peer.ready.then(publish), peer.result]);
  if (original.status === "rejected") throw original.reason;
  if (parallel.status === "rejected") throw parallel.reason;
  expect(parallel.value).toBe(original.value); return original.value;
}
function nachLockAck<T>(timeout: number, beobachtet: () => boolean, warten: () => void, jetzt: () => number, compile: (remaining: number) => T): T {
  const deadline = jetzt() + timeout;
  while (!beobachtet()) {
    if (jetzt() >= deadline) throw Error("Peer hat Publisherlock nicht beobachtet");
    warten();
  }
  const remaining = deadline - jetzt();
  if (remaining <= 0) throw Error("Peer hat Publisherlock nicht beobachtet");
  return compile(remaining);
}
test("Compilerbarriere hält einen gezielt verzögerten LOCK_ACK vor echtem Compile zurück", () => {
  let ack = false;
  const compile = vi.fn(() => { expect(ack).toBe(true); return "kompiliert"; });
  expect(nachLockAck(10, () => ack, () => { ack = true; }, () => 0, compile)).toBe("kompiliert");
  expect(compile).toHaveBeenCalledWith(10);
});
test.each([false, true])("Compilerbarriere überschreitet bei LOCK_ACK=%s ihr vorhandenes Budget nicht", ack => {
  const compile = vi.fn<(remaining: number) => void>(), warten = vi.fn(); let tick = 0;
  expect(() => nachLockAck(10, () => ack, warten, () => tick++ * 10, compile)).toThrow("Peer hat Publisherlock nicht beobachtet");
  expect(compile).not.toHaveBeenCalled(); expect(warten).not.toHaveBeenCalled();
});
test("Publisher wartet auf Bereitschaft eines gezielt verzögerten Peers", async () => {
  let freigeben!: () => void;
  const ready = new Promise<void>(r => { freigeben = r; }), publish = vi.fn(() => "fixture-artefakt");
  const work = parallelPublizieren(publish, { ready, result: Promise.resolve("fixture-artefakt") });
  try { await Promise.resolve(); expect(publish).not.toHaveBeenCalled(); }
  finally { freigeben(); await work; }
  expect(publish).toHaveBeenCalledTimes(1);
});
describe.skipIf(process.platform !== "win32")("nativer Cache", () => {
beforeAll(async () => {
  if (process.platform !== "win32") return;
  const stages: { phase: string; ms: number }[] = [];
  const measure = <T>(phase: string, fn: () => T): T => { const start = Date.now(); try { return fn(); } finally { stages.push({ phase, ms: Date.now() - start }); } };
  try {
  fixture = mkdtempSync(join(tmpdir(), "codex-cache-test-")); marker = join(fixture, "zielmarker");
  sourceFile = join(fixture, "source.cs");
  writeFileSync(sourceFile, readFileSync(resolve("scripts/codex-prozess-windows.cs"), "utf8") + `\n// Fixture ${randomUUID()}\n`);
  moduleUrl = pathToFileURL(resolve("scripts/codex-prozess-windows.mjs")).href;
  const active = measure("active", () => w.windowsVorbereiten()); root = dirname(dirname(active));
  const expected = JSON.parse(readFileSync(join(dirname(active), "manifest.json"), "utf8")) as Record<string, unknown>;
  delete expected.exeHash; expected.sourceHash = createHash("sha256").update(readFileSync(sourceFile)).digest("hex");
  const key = createHash("sha256").update(JSON.stringify(expected)).digest("hex");
  artifact = join(root, key);
  const lock = join(root, `${key}.lock`), observed = join(fixture, "peer-observed");
  const native = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  let compiles = 0;
  vi.doMock("node:child_process", () => ({ ...native, execFileSync: (file: string, args: string[], options: { timeout: number }) => {
    if (!file.endsWith("csc.exe")) return measure(args[0] === "--pruefe" ? "native" : "acl", () => native.execFileSync(file, args, options));
    compiles++; expect(existsSync(lock)).toBe(true);
    return measure("lock-ack-and-compiler", () => nachLockAck(options.timeout, () => existsSync(observed),
      () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5), Date.now, remaining => {
        expect(readFileSync(observed, "utf8")).toBe("LOCK_ACK"); expect(existsSync(lock)).toBe(true);
        return measure("compiler", () => native.execFileSync(file, args, { ...options, timeout: remaining }));
      }));
  } }));
  vi.resetModules();
  // @ts-expect-error: Node-Skript ohne Declaration.
  const publisher = await import("../../scripts/codex-prozess-windows.mjs") as typeof w;
  const peer = parallelPrepare(lock, observed);
  const result = await parallelPublizieren(() => publisher.windowsCacheProbe(readFileSync(sourceFile)), peer);
  artifact = dirname(result);
  expect(compiles).toBe(1); expect(readFileSync(observed, "utf8")).toBe("LOCK_ACK"); expect(existsSync(lock)).toBe(false);
  expect(w.windowsVorbereiten()).toBe(active);
  } finally { vi.doUnmock("node:child_process"); vi.resetModules(); console.info(JSON.stringify({ cacheFixtureStages: stages })); }
});
afterAll(() => {
  if (artifact && existsSync(artifact)) {
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

windowsTest.each(["exe", "manifest", "architektur", "dll-flag", "exe-flag"])("beschädigter Cache %s stoppt vor jeder Zielaktion", mode => {
  const name = mode === "manifest" ? "manifest.json" : "supervisor.exe", file = join(artifact, name), original = readFileSync(file);
  try {
    const changed = Buffer.from(original);
    if (mode === "manifest") writeFileSync(file, "{}");
    else {
      if (mode === "architektur") changed.writeUInt16LE(0x14c, changed.readUInt32LE(60) + 4);
      else if (mode === "dll-flag") changed.writeUInt16LE(0x2002, changed.readUInt32LE(60) + 22);
      else if (mode === "exe-flag") changed.writeUInt16LE(0, changed.readUInt32LE(60) + 22);
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
  let closeSupervisor: () => void, kills: number;
  let probes: { file: string; args: string[]; binaryHash: string }[], launches: { file: string; args: string[] }[];
  let peerSource: string, peerTarget: string;
  let peerAclDeny: boolean;
  const peBytes = () => { const data = Buffer.alloc(128); data.writeUInt16LE(0x5a4d); data.writeUInt32LE(64, 60); data.writeUInt32LE(0x4550, 64); data.writeUInt16LE(0x8664, 68); data.writeUInt16LE(2, 86); return data; };
  beforeEach(async () => {
    sandbox = mkdtempSync(join(tmpdir(), "codex-cache-port-")); cache = join(sandbox, "cache"); mkdirSync(cache);
    const compiler = join(sandbox, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"); mkdirSync(dirname(compiler), { recursive: true }); writeFileSync(compiler, "fixture compiler");
    prepareFault = ""; statusText = "exit:23"; streamFault = ""; compilerCalls = 0; nativeCalls = 0; kills = 0; probes = []; launches = []; peerSource = ""; peerTarget = ""; peerAclDeny = false;
    vi.stubEnv("SystemRoot", sandbox); vi.resetModules();
    const filesystem = await vi.importActual<typeof import("node:fs")>("node:fs");
    vi.doMock("node:fs", () => ({ ...filesystem, mkdirSync: (...args: Parameters<typeof filesystem.mkdirSync>) => {
      if (String(args[0]).endsWith(".lock")) {
        if (prepareFault === "lock-denied") throw Object.assign(Error("fixture lock denied"), { code: "EACCES" });
        if (prepareFault === "peer-publish") filesystem.renameSync(peerSource, peerTarget);
      }
      return filesystem.mkdirSync(...args);
    } }));
    vi.doMock("node:child_process", async () => ({
      ...await vi.importActual<typeof import("node:child_process")>("node:child_process"),
      execFileSync: (file: string, args: string[]) => {
        if (file.endsWith("powershell.exe") && args.includes("-Key")) {
          if (prepareFault === "setup-timeout") vi.setSystemTime(Date.now() + 10001);
          if (peerAclDeny && existsSync(peerTarget)) throw Error("fixture peer ACL denied");
          return cache;
        }
        if (file.endsWith("csc.exe")) {
          compilerCalls++; if (prepareFault === "compiler") throw Error("fixture compiler failed");
          const output = args.find(a => a.startsWith("/out:"))!; const data = peBytes();
          if (prepareFault === "short") writeFileSync(output.slice(5), data.subarray(0, 63));
          else {
            if (prepareFault === "arch") data.writeUInt16LE(0x14c, 68);
            if (prepareFault === "dll-flag") data.writeUInt16LE(0x2002, 86);
            if (prepareFault === "exe-flag") data.writeUInt16LE(0, 86);
            if (prepareFault === "header") { data.writeUInt32LE(120, 60); data.writeUInt32LE(0x4550, 120); data.writeUInt16LE(0x8664, 124); }
            if (prepareFault === "header-edge") { data.writeUInt32LE(104, 60); data.writeUInt32LE(0x4550, 104); data.writeUInt16LE(0x8664, 108); data.writeUInt16LE(2, 126); }
            writeFileSync(output.slice(5), data);
          }
          return Buffer.alloc(0);
        }
        nativeCalls++; probes.push({ file, args, binaryHash: createHash("sha256").update(readFileSync(file)).digest("hex") }); if (prepareFault === "native") throw Error("fixture native failed");
        return Buffer.alloc(0);
      },
      spawn: (_file: string, args: string[], options: { cwd: string }) => {
        launches.push({ file: _file, args });
        requestDir = dirname(args.at(-1)!);
        expect(options.cwd).toBe(requestDir);
        if (streamFault === "slow-spawn-hang") vi.setSystemTime(Date.now() + 20);
        const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: new EventEmitter(), kill: () => { kills++; if (!streamFault.includes("hang")) queueMicrotask(() => child.emit("close", 1)); return true; } });
        closeSupervisor = () => { child.emit("close", 1); };
        Object.assign(child.stdin, { end: (input: string) => queueMicrotask(() => {
          if (streamFault === "error-hang") child.stdin.emit("error", Error("fixture first error"));
          if (streamFault.includes("hang")) return;
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
  afterEach(() => { vi.useRealTimers(); vi.doUnmock("node:child_process"); vi.doUnmock("node:fs"); vi.unstubAllEnvs(); vi.resetModules(); rmSync(sandbox, { recursive: true }); });

  test.each(["hang", "error-hang"])("äußerer Watchdog beendet %s und wartet vor Cleanup auf close", async fault => {
    adapter.windowsVorbereiten(); streamFault = fault; vi.useFakeTimers();
    const result = adapter.windowsProzess("fixture", [], { cwd: sandbox, env: {}, input: "", timeoutMs: 30, maxBytes: 100 });
    let settled = false;
    const observed = result.then(() => { settled = true; return "erfolg"; }, (e: unknown) => { settled = true; return (e as Error).message; });
    await vi.advanceTimersByTimeAsync(29);
    expect(kills).toBe(fault === "hang" ? 0 : 1);
    await vi.advanceTimersByTimeAsync(1);
    expect(kills).toBe(1); expect(settled).toBe(false); expect(existsSync(requestDir)).toBe(true);
    closeSupervisor();
    expect(await observed).toBe(fault === "hang" ? "Prozess-Frist überschritten" : "fixture first error");
    expect(existsSync(requestDir)).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });
  test("Watchdog rechnet die synchrone Startzeit auf dieselbe Frist an", async () => {
    adapter.windowsVorbereiten(); streamFault = "slow-spawn-hang"; vi.useFakeTimers();
    const result = adapter.windowsProzess("fixture", [], { cwd: sandbox, env: {}, input: "", timeoutMs: 30, maxBytes: 100 });
    const observed = result.catch((e: unknown) => (e as Error).message);
    await vi.advanceTimersByTimeAsync(9); expect(kills).toBe(0);
    await vi.advanceTimersByTimeAsync(1); expect(kills).toBe(1);
    closeSupervisor(); expect(await observed).toBe("Prozess-Frist überschritten"); expect(vi.getTimerCount()).toBe(0);
  });
  test("reguläres close entfernt den äußeren Timer ohne späteren Kill", async () => {
    adapter.windowsVorbereiten(); vi.useFakeTimers();
    const result = adapter.windowsProzess("fixture", [], { cwd: sandbox, env: {}, input: "", timeoutMs: 30, maxBytes: 100 });
    await vi.advanceTimersByTimeAsync(0); expect((await result).code).toBe(23);
    expect(vi.getTimerCount()).toBe(0); await vi.advanceTimersByTimeAsync(30); expect(kills).toBe(0);
  });

  test("kalte Veröffentlichung und validierte Wiederverwendung laufen am Originalmodul", () => {
    const exe = adapter.windowsVorbereiten();
    expect(readdirSync(dirname(exe)).sort()).toEqual(["manifest.json", "source.cs", "supervisor.exe"]);
    expect(adapter.windowsCacheProbe(readFileSync(resolve("scripts/codex-prozess-windows.cs")))).toBe(exe);
    expect(compilerCalls).toBe(1); expect(nativeCalls).toBe(1);
    expect(readdirSync(cache)).toEqual([dirname(exe).slice(cache.length + 1)]);
  });
  test.each([["compiler", "fixture compiler failed"], ["native", "fixture native failed"], ["short", "Supervisor-PE fehlt"], ["arch", "Supervisor-Architektur"], ["header", "Supervisor-Architektur"], ["dll-flag", "Supervisor-EXE fehlt"], ["exe-flag", "Supervisor-EXE fehlt"], ["lock-denied", "fixture lock denied"]])("Vorbereitungsfehler %s veröffentlicht nichts", (fault, error) => {
    prepareFault = fault; expect(() => adapter.windowsVorbereiten()).toThrow(error); expect(readdirSync(cache)).toEqual([]);
  });
  test("abgelaufenes Setupbudget stoppt nach ACL vor Lock, Compiler und nativer Probe", () => {
    vi.useFakeTimers(); prepareFault = "setup-timeout";
    expect(() => adapter.windowsVorbereiten()).toThrow("Supervisor-Einrichtung überschreitet Frist");
    expect(compilerCalls).toBe(0); expect(nativeCalls).toBe(0); expect(readdirSync(cache)).toEqual([]);
  });
  test.each([false, true])("Publikation eines anderen Lockbesitzers wird validiert, sein Lock bleibt erhalten (ACL-Fehler=%s)", deny => {
    const exe = adapter.windowsVorbereiten(); peerTarget = dirname(exe); peerSource = `${peerTarget}-pending`; renameSync(peerTarget, peerSource);
    const lock = `${peerTarget}.lock`; mkdirSync(lock); prepareFault = "peer-publish"; peerAclDeny = deny;
    const result = (() => { try { return adapter.windowsCacheProbe(readFileSync(resolve("scripts/codex-prozess-windows.cs"))); } catch (e) { return (e as Error).message; } })();
    expect(result).toBe(deny ? "fixture peer ACL denied" : exe);
    expect(existsSync(lock)).toBe(true); expect(compilerCalls).toBe(1); expect(nativeCalls).toBe(1);
  });
  test("vollständiger EXE-Header genau an der Dateigrenze bleibt gültig", () => {
    prepareFault = "header-edge"; expect(adapter.windowsVorbereiten()).toMatch(/supervisor\.exe$/);
  });
  test("beschädigtes Manifest wird ohne neue Kompilierung abgewiesen", () => {
    const exe = adapter.windowsVorbereiten(); writeFileSync(join(dirname(exe), "manifest.json"), "{}");
    expect(() => adapter.windowsCacheProbe(readFileSync(resolve("scripts/codex-prozess-windows.cs")))).toThrow("Manifest"); expect(compilerCalls).toBe(1);
  });
  test("nur das validierte EXE-Artefakt erhält den Request und dieselbe native Einsatzprobe", async () => {
    const exe = adapter.windowsVorbereiten();
    await adapter.windowsProzess("fixture", [], { cwd: sandbox, env: {}, input: "", timeoutMs: 3000, maxBytes: 100 });
    expect(launches[0].file).toBe(exe); expect(launches[0].args).toEqual([join(requestDir, "request.bin")]);
    const manifest = JSON.parse(readFileSync(join(dirname(exe), "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest).toMatchObject({ protocol: 3, mode: "native-exe", options: ["/nologo", "/target:exe", "/platform:x64"] });
    expect(probes).toHaveLength(1); expect(probes[0].file).toMatch(/supervisor\.exe$/); expect(probes[0].binaryHash).toBe(manifest.exeHash); expect(probes[0].args).toEqual(["--pruefe"]);
  });
  test("früheres DLL-Artefakt bleibt unberührt und wird nicht als EXE übernommen", () => {
    const old = join(cache, createHash("sha256").update("previous-dll-mode").digest("hex")); mkdirSync(old);
    for (const name of ["source.cs", "supervisor.dll", "loader.ps1", "manifest.json"]) writeFileSync(join(old, name), "retained-dll-artifact");
    const exe = adapter.windowsVorbereiten();
    expect(dirname(exe) === old).toBe(false); expect(exe).toMatch(/supervisor\.exe$/);
    expect(readFileSync(join(old, "supervisor.dll"), "utf8")).toBe("retained-dll-artifact");
    expect(readdirSync(old).sort()).toEqual(["loader.ps1", "manifest.json", "source.cs", "supervisor.dll"]);
    expect(compilerCalls).toBe(1); expect(nativeCalls).toBe(1);
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
    await expect(adapter.windowsProzess("fixture", [], { cwd: sandbox, env: {}, input: "zu viel", timeoutMs: 3000, maxBytes: fault === "output" ? 1 : 100 })).rejects.toThrow(fault === "stdin" ? "pipe" : fault === "spawn" ? "spawn" : "Ausgabe"); expect(existsSync(requestDir)).toBe(false); expect(kills).toBe(1);
  });
});
