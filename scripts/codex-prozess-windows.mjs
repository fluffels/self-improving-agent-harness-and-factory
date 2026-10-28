// Einmalige private Vorbereitung, geprüftes gemeinsames Artefakt; kein direkter Fallback.
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("./codex-prozess-windows.cs", import.meta.url));
const ACL = fileURLToPath(new URL("./codex-prozess-cache.ps1", import.meta.url));
const LOADER = fileURLToPath(new URL("./codex-prozess-loader.ps1", import.meta.url));
const OPTIONS = ["/nologo", "/target:library", "/platform:x64"], HOST_OPTIONS = ["-NoProfile", "-NonInteractive", "-File"];
const PROTOCOL = 2, SETUP_MS = 10000;
const hash = data => createHash("sha256").update(data).digest("hex");
let supervisor;

function regular(file, directory = false) {
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) || realpathSync.native(file).toLowerCase() !== resolve(file).toLowerCase()) throw new Error("Unzulässiger Cachepfad");
}
function pe(file) {
  const bytes = readFileSync(file);
  if (bytes.length < 64 || bytes.readUInt16LE(0) !== 0x5a4d) throw new Error("Supervisor-PE fehlt");
  const offset = bytes.readUInt32LE(60);
  if (offset > bytes.length - 24 || bytes.readUInt32LE(offset) !== 0x4550 || bytes.readUInt16LE(offset + 4) !== 0x8664) throw new Error("Supervisor-Architektur ist nicht x64");
  if ((bytes.readUInt16LE(offset + 22) & 0x2000) === 0) throw new Error("Supervisor-DLL fehlt");
  return hash(bytes);
}
function budget(deadline) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error("Supervisor-Einrichtung überschreitet Frist");
  return left;
}
function validate(artifact, expected) {
  regular(artifact, true);
  for (const name of ["source.cs", "supervisor.dll", "loader.ps1", "manifest.json"]) regular(join(artifact, name));
  const dllHash = pe(join(artifact, "supervisor.dll"));
  const actual = JSON.parse(readFileSync(join(artifact, "manifest.json"), "utf8"));
  if (JSON.stringify(actual) !== JSON.stringify({ ...expected, dllHash }) || hash(readFileSync(join(artifact, "source.cs"))) !== expected.sourceHash || hash(readFileSync(join(artifact, "loader.ps1"))) !== expected.loaderHash) throw new Error("Supervisor-Manifest stimmt nicht");
  return join(artifact, "supervisor.dll");
}
function aufruf(dll, request, host) {
  return { file: host, args: [...HOST_OPTIONS, join(dirname(dll), "loader.ps1"), "-AssemblyPath", dll, ...(request === "--pruefe" ? ["-Pruefe"] : ["-RequestPath", request])] };
}
function publish(root, key, expected, source, loader, compiler, host, deadline) {
  const stage = join(root, `stage-${randomUUID()}`);
  mkdirSync(stage);
  try {
    const dll = join(stage, "supervisor.dll");
    writeFileSync(join(stage, "source.cs"), source, { flag: "wx" });
    execFileSync(compiler, [...OPTIONS, `/out:${dll}`, join(stage, "source.cs")], { windowsHide: true, stdio: "pipe", timeout: budget(deadline) });
    const dllHash = pe(dll); writeFileSync(join(stage, "loader.ps1"), loader, { flag: "wx" });
    const call = aufruf(dll, "--pruefe", host);
    execFileSync(call.file, call.args, { windowsHide: true, stdio: "pipe", timeout: budget(deadline) });
    writeFileSync(join(stage, "manifest.json"), JSON.stringify({ ...expected, dllHash }), { flag: "wx" });
    validate(stage, expected);
    renameSync(stage, join(root, key));
  } finally { if (existsSync(stage)) rmSync(stage, { recursive: true }); }
}

// Interner Prüfeinstieg für feste Quellfixtures; verändert niemals den Executorpfad.
export function windowsCacheProbe(source) {
  const deadline = Date.now() + SETUP_MS;
  const compiler = join(process.env.SystemRoot, "Microsoft.NET/Framework64/v4.0.30319/csc.exe");
  const powershell = join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"), loader = readFileSync(LOADER);
  const expected = { protocol: PROTOCOL, mode: "powershell-dll", arch: "x64", options: OPTIONS, compilerHash: hash(readFileSync(compiler)), sourceHash: hash(source), loaderHash: hash(loader), hostOptions: HOST_OPTIONS, hostHash: hash(readFileSync(powershell)) };
  const key = hash(JSON.stringify(expected));
  const check = () => execFileSync(powershell, ["-NoProfile", "-NonInteractive", "-File", ACL, "-Key", key], { windowsHide: true, encoding: "utf8", timeout: budget(deadline) }).trim();
  const root = check(), artifact = join(root, key), lock = join(root, `${key}.lock`);
  regular(root, true);
  if (existsSync(artifact)) return validate(artifact, expected);
  let ownLock = false;
  try {
    while (!ownLock) {
      budget(deadline);
      try { mkdirSync(lock); ownLock = true; }
      catch (e) {
        if (e.code !== "EEXIST") throw e;
        regular(lock, true);
        if (existsSync(artifact)) { check(); return validate(artifact, expected); }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(25, budget(deadline)));
      }
    }
    if (!existsSync(artifact)) publish(root, key, expected, source, loader, compiler, powershell, deadline);
    check(); return validate(artifact, expected);
  } finally { if (ownLock) rmdirSync(lock); }
}

export function windowsVorbereiten() {
  if (!supervisor) supervisor = windowsCacheProbe(readFileSync(SOURCE));
  return supervisor;
}
export function windowsAufruf(request) {
  return aufruf(windowsVorbereiten(), request, join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"));
}

export function windowsRequest({ file, args, cwd, env, deadline, status }) {
  const parts = [], integer = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); parts.push(b); };
  const text = s => { const b = Buffer.from(s); integer(b.length); parts.push(b); };
  text(file); text(cwd); text(status);
  const time = Buffer.alloc(8); time.writeBigInt64LE(BigInt(deadline)); parts.push(time);
  integer(args.length); for (const arg of args) text(arg);
  const entries = Object.entries(env).filter(([, value]) => value !== undefined);
  integer(entries.length); for (const [key, value] of entries) { text(key); text(value); }
  return Buffer.concat(parts);
}

export async function windowsProzess(file, args, { cwd, env, input, timeoutMs, maxBytes }) {
  const deadline = Date.now() + timeoutMs;
  const root = mkdtempSync(join(tmpdir(), "codex-job-run-")), status = join(root, "status.txt"), request = join(root, "request.bin");
  try {
    writeFileSync(request, windowsRequest({ file, args, cwd, env, deadline, status }));
    return await new Promise((resolve, reject) => {
      const call = windowsAufruf(request), child = spawn(call.file, call.args, { cwd: root, env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      const out = [], err = []; let bytes = 0, failure;
      const stop = e => { if (failure) return; failure = e; child.kill(); };
      const collect = list => chunk => {
        bytes += chunk.length;
        if (bytes > maxBytes) stop(new Error("Prozess-Ausgabe zu groß")); else list.push(chunk);
      };
      child.stdout.on("data", collect(out)); child.stderr.on("data", collect(err));
      child.on("error", stop); child.stdin.on("error", stop);
      const timer = setTimeout(() => stop(new Error("Prozess-Frist überschritten")), Math.max(0, deadline - Date.now()));
      child.on("close", () => {
        clearTimeout(timer);
        try {
          if (failure) throw failure;
          const result = readFileSync(status, "utf8");
          if (result.startsWith("error:")) throw new Error(result.slice(6));
          if (result === "timeout") throw new Error("Prozess-Frist überschritten");
          if (!/^exit:\d+$/.test(result)) throw new Error("Ungültiger Supervisorstatus");
          resolve({ code: Number(result.slice(5)), stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() });
        } catch (e) { reject(e); }
      });
      child.stdin.end(input);
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
