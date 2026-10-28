/* @harness-waechter: Nur private, vollständig veröffentlichte native Artefakte ausführen. */
import { afterAll, beforeAll, expect, test } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";

const windowsTest = test.skipIf(process.platform !== "win32");
let fixture: string, moduleUrl: string, artifact: string, root: string, marker: string;
const prepare = "const w=await import(process.argv[1]);console.log(w.windowsVorbereiten())";
const action = "const w=await import(process.argv[1]);w.windowsVorbereiten();await w.windowsProzess(process.execPath,['-e',\"require('fs').writeFileSync(process.argv[1],'unerlaubt')\",process.argv[2]],{cwd:process.cwd(),env:{SystemRoot:process.env.SystemRoot},input:'',timeoutMs:3000,maxBytes:1000})";
function launch(code: string) { return spawnSync(process.execPath, ["--input-type=module", "-e", code, moduleUrl, marker], { encoding: "utf8" }); }
function parallelPrepare() {
  return new Promise<string>((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", prepare, moduleUrl], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = ""; child.stdout.on("data", b => { out += String(b); }); child.stderr.on("data", b => { err += String(b); });
    child.once("error", reject); child.once("close", code => { if (code === 0) resolveResult(out.trim()); else reject(Error(err)); });
  });
}
beforeAll(async () => {
  if (process.platform !== "win32") return;
  fixture = mkdtempSync(join(tmpdir(), "codex-cache-test-")); marker = join(fixture, "zielmarker");
  for (const name of ["codex-prozess-windows.mjs", "codex-prozess-cache.ps1"]) copyFileSync(resolve("scripts", name), join(fixture, name));
  writeFileSync(join(fixture, "codex-prozess-windows.cs"), readFileSync(resolve("scripts/codex-prozess-windows.cs"), "utf8") + `\n// Fixture ${randomUUID()}\n`);
  moduleUrl = pathToFileURL(join(fixture, "codex-prozess-windows.mjs")).href;
  const paths = await Promise.all([parallelPrepare(), parallelPrepare()]);
  expect(paths[0]).toBe(paths[1]); artifact = dirname(paths[0]); root = dirname(artifact);
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
