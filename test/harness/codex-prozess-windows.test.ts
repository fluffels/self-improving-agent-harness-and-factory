/* @harness-waechter: Windows-Prozesse vor dem ersten Zielbefehl einem Job zuordnen. */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error: Node-Skript ohne Declaration.
import * as winRaw from "../../scripts/codex-prozess-windows.mjs";
// @ts-expect-error: Node-Skript ohne Declaration.
import * as processRaw from "../../scripts/codex-prozess-lib.mjs";
type Options = { cwd: string; env: NodeJS.ProcessEnv; input: string | Buffer; timeoutMs: number; maxBytes: number };
type Result = { code: number; stdout: string; stderr: string };
type Request = { file: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; deadline: number; status: string };
const w = winRaw as { windowsVorbereiten: () => string; windowsProzess: (file: string, args: string[], options: Options) => Promise<Result>; windowsRequest: (request: Request) => Buffer };
const p = processRaw as { prozess: typeof w.windowsProzess; umgebung: (root: string) => NodeJS.ProcessEnv };
const roots: string[] = [];
const pending: Promise<unknown>[] = [];
afterEach(async () => { await Promise.allSettled(pending.splice(0)); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function setup(): Options {
  const cwd = mkdtempSync(join(tmpdir(), "codex-job-test-")); roots.push(cwd);
  return { cwd, env: p.umgebung(cwd), input: "", timeoutMs: 3000, maxBytes: 8_000_000 };
}
const windowsTest = test.skipIf(process.platform !== "win32");
const failures = [
  ["Jobanlage", "job = CreateJobObject(IntPtr.Zero, null);", "job = fault == \"Jobanlage\" ? IntPtr.Zero : CreateJobObject(IntPtr.Zero, null);"],
  ["Joblimit", "Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))),", "Check(fault != \"Joblimit\" && SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))),"],
  ["Jobzuordnung", "Check(AssignProcessToJobObject(job, p.process),", "Check(fault != \"Jobzuordnung\" && AssignProcessToJobObject(job, p.process),"],
  ["Zielresume", "Check(ResumeThread(p.thread) != uint.MaxValue,", "Check(fault != \"Zielresume\" && ResumeThread(p.thread) != uint.MaxValue,"],
];
let variantsRoot: string, variantExe: string, variantEnv: NodeJS.ProcessEnv;
test("native Fixture übernimmt die bereinigte Produktionsumgebung", () => {
  const options = setup(), expected = p.umgebung(options.cwd);
  expect(Object.keys(options.env).sort()).toEqual(Object.keys(expected).sort());
  expect(Object.entries(expected).every(([key, value]) => options.env[key] === value)).toBe(true);
});
windowsTest("Jobtimeout beendet einen nachweislich gestarteten Nachkommen vor seinem Marker", async () => {
  const o = setup(), ready = join(o.cwd, "bereit"), marker = join(o.cwd, "kind-marker"); o.timeoutMs = 700;
  const child = join(o.cwd, "kind.cjs"), parent = join(o.cwd, "eltern.cjs");
  writeFileSync(child, "require('fs').writeFileSync(process.argv[2],'bereit');setTimeout(()=>require('fs').writeFileSync(process.argv[3],'unerlaubt'),1300)");
  writeFileSync(parent, "require('child_process').spawn(process.execPath,[process.argv[2],process.argv[3],process.argv[4]],{detached:true,stdio:'ignore'}).unref();setInterval(()=>{},1000)");
  await expect(p.prozess(process.execPath, [parent, child, ready, marker], o)).rejects.toThrow("Prozess-Frist überschritten");
  expect(existsSync(ready)).toBe(true);
  await new Promise(r => setTimeout(r, 1500)); expect(existsSync(marker)).toBe(false);
});
describe.skipIf(process.platform !== "win32")("nativer Jobvertrag", () => {
beforeAll(() => {
  if (process.platform !== "win32") return;
  variantsRoot = mkdtempSync(join(tmpdir(), "codex-job-variants-"));
  variantEnv = p.umgebung(variantsRoot);
  let source = readFileSync(resolve("scripts/codex-prozess-windows.cs"), "utf8");
  const classAnchor = "public class Request";
  expect(source.split(classAnchor)).toHaveLength(2);
  source = source.replace(classAnchor, 'static string fault = Environment.GetEnvironmentVariable("JOB_FIXTURE");\n  public class Request');
  for (const [operation, anchor, replacement] of failures) {
    expect(operation).toBeTruthy(); expect(source.split(anchor)).toHaveLength(2); source = source.replace(anchor, replacement);
  }
  const sourcePath = join(variantsRoot, "fixture.cs"); variantExe = join(variantsRoot, "fixture.exe");
  writeFileSync(sourcePath, source);
  execFileSync(join(process.env.SystemRoot!, "Microsoft.NET/Framework64/v4.0.30319/csc.exe"), ["/nologo", "/platform:x64", `/out:${variantExe}`, sourcePath], { windowsHide: true });
  execFileSync(variantExe, ["--pruefe"], { env: variantEnv, windowsHide: true, timeout: 10000 });
});
afterAll(() => { if (variantsRoot) rmSync(variantsRoot, { recursive: true, force: true }); });

windowsTest("native Vorbereitung liefert einen ausführbaren Supervisor", () => {
  expect(w.windowsVorbereiten()).toMatch(/\.exe$/);
});

windowsTest("argv mit leeren Strings, Unicode, Quotes, Backslashes und Shellzeichen bleibt Daten", async () => {
  const args = ["", "Leer raum", "ü🐈", 'vor"nach', "C:\\space dir\\", '\\"', "a\\\\", "&|<>$()`%!"];
  const o = setup(); o.env.FIXTURE_VALUE = "explizit ü";
  const result = await p.prozess(process.execPath, ["-e", "console.log(JSON.stringify({args:process.argv.slice(1),cwd:process.cwd(),env:process.env.FIXTURE_VALUE,home:process.env.HOME}))", ...args], o);
  expect(JSON.parse(result.stdout)).toEqual({ args, cwd: o.cwd, env: "explizit ü", home: o.env.HOME });
});

windowsTest("großes stdin, getrennte Mehrbyteausgaben und Exitcode bleiben vollständig", async () => {
  const o = setup(); o.input = Buffer.from("ü🐈".repeat(300000));
  const result = await p.prozess(process.execPath, ["-e", "process.stdin.pipe(process.stdout);process.stderr.write('fehler ü🐈');process.exitCode=23"], o);
  expect(result).toEqual({ stdout: o.input.toString(), stderr: "fehler ü🐈", code: 23 });
});

windowsTest("native Deadline läuft trotz blockiertem Node-Eventloop", async () => {
  const o = setup(), marker = join(o.cwd, "zu-spaet"); o.timeoutMs = 300;
  const work = p.prozess(process.execPath, ["-e", "setTimeout(()=>require('fs').writeFileSync(process.argv[1],'unerlaubt'),900)", marker], o);
  const end = Date.now() + 1300; while (Date.now() < end) { /* absichtlich keine JS-Timer */ }
  await expect(work).rejects.toThrow("Prozess-Frist überschritten");
  expect(existsSync(marker)).toBe(false);
});

windowsTest("Elternende beendet auch einen bereits gestarteten Enkel vor Rückkehr", async () => {
  const o = setup(), marker = join(o.cwd, "enkel-marker");
  const grandchild = join(o.cwd, "enkel.cjs"), child = join(o.cwd, "kind.cjs"), parent = join(o.cwd, "eltern.cjs");
  writeFileSync(grandchild, "process.send('bereit');setTimeout(()=>require('fs').writeFileSync(process.argv[2],'unerlaubt'),700)");
  writeFileSync(child, "require('child_process').fork(process.argv[2],[process.argv[3]],{stdio:['ignore','ignore','ignore','ipc']}).once('message',()=>process.send('bereit'));setInterval(()=>{},1000)");
  writeFileSync(parent, "require('child_process').fork(process.argv[2],[process.argv[3],process.argv[4]],{stdio:['ignore','ignore','ignore','ipc']}).once('message',()=>process.exit(0))");
  expect((await p.prozess(process.execPath, [parent, child, grandchild, marker], o)).code).toBe(0);
  await new Promise(r => setTimeout(r, 900)); expect(existsSync(marker)).toBe(false);
});

windowsTest("Supervisorabbruch schließt den Job und beendet gestartete Nachkommen", async () => {
  const o = setup(), marker = join(o.cwd, "abbruch-marker"), request = join(o.cwd, "request.json"), status = join(o.cwd, "status.json");
  const script = "require('child_process').spawn(process.execPath,['-e',\"setTimeout(()=>require('fs').writeFileSync(process.argv[1],'unerlaubt'),900)\",process.argv[1]],{stdio:'ignore'});console.log('bereit');setInterval(()=>{},1000)";
  writeFileSync(request, w.windowsRequest({ file: process.execPath, args: ["-e", script, marker], cwd: o.cwd, env: o.env, deadline: Date.now() + 3000, status }));
  const child = spawn(w.windowsVorbereiten(), [request], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  try {
    await new Promise<void>((resolveReady, rejectReady) => { child.stdout.once("data", () => resolveReady()); child.once("error", rejectReady); child.once("exit", () => rejectReady(Error("vor Bereitschaft beendet"))); });
    const closed = new Promise(r => child.once("close", r)); child.kill(); await closed;
    await new Promise(r => setTimeout(r, 1100)); expect(existsSync(marker)).toBe(false);
  } finally { child.kill(); }
});

windowsTest.each(failures)("Fehler bei %s lässt keine Zielaktion zu", async operation => {
  const o = setup(), marker = join(o.cwd, "unerlaubte-aktion"), request = join(o.cwd, "request.bin"), status = join(o.cwd, "status.txt");
  writeFileSync(request, w.windowsRequest({ file: process.execPath, args: ["-e", "require('fs').writeFileSync(process.argv[1],'unerlaubt')", marker], cwd: o.cwd, env: o.env, deadline: Date.now() + 3000, status }));
  const work = new Promise<number | null>((resolveExit, reject) => {
    const child = spawn(variantExe, [request], { env: { ...o.env, JOB_FIXTURE: operation }, windowsHide: true, stdio: ["ignore", "ignore", "ignore"] });
    child.once("error", reject); child.once("close", resolveExit);
  }); pending.push(work);
  expect(await work).toBe(1); expect(readFileSync(status, "utf8")).toContain(operation);
  expect(existsSync(marker)).toBe(false);
});
});
