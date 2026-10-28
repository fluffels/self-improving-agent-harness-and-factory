// Kein Zielbefehl läuft vor erfolgreicher Jobzuordnung. Keine Shell beteiligt.
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

class Supervisor {
  [StructLayout(LayoutKind.Sequential)] struct Startup {
    public int cb; public IntPtr reserved, desktop, title;
    public int x,y,xs,ys,xc,yc,fill,flags; public short show, reservedSize;
    public IntPtr reserved2, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long processTime, jobTime; public uint flags; public UIntPtr min, max;
    public uint active; public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public BasicLimit basic; public Io io; public UIntPtr processMemory, jobMemory, peakProcess, peakJob;
  }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long a,b,c,d; public uint faults,total,active,terminated;
  }
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr security, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref Limits info, int size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int type, out Accounting info, int size, IntPtr length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint time);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int handle);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool CreateProcess(
    string file, StringBuilder command, IntPtr ps, IntPtr ts, bool inherit, uint flags,
    IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);

  public class Request {
    public string file, cwd, status; public string[] args;
    public Dictionary<string,string> env; public long deadline;
  }
  static string Text(BinaryReader reader) {
    int length = reader.ReadInt32();
    if (length < 0 || length > 10000000) throw new InvalidDataException("Requestlänge");
    byte[] bytes = reader.ReadBytes(length);
    if (bytes.Length != length) throw new EndOfStreamException();
    string value = new UTF8Encoding(false, true).GetString(bytes);
    if (value.IndexOf('\0') >= 0) throw new InvalidDataException("NUL im Request");
    return value;
  }
  static int Count(BinaryReader reader) {
    int count = reader.ReadInt32();
    if (count < 0 || count > 100000) throw new InvalidDataException("Requestanzahl");
    return count;
  }
  static Request Read(string file) {
    using (BinaryReader reader = new BinaryReader(File.OpenRead(file))) {
      if (reader.BaseStream.Length > 10000000) throw new InvalidDataException("Requestvolumen");
      Request r = new Request(); r.file = Text(reader); r.cwd = Text(reader); r.status = Text(reader);
      r.deadline = reader.ReadInt64(); r.args = new string[Count(reader)];
      for (int i = 0; i < r.args.Length; i++) r.args[i] = Text(reader);
      r.env = new Dictionary<string,string>(); int count = Count(reader);
      for (int i = 0; i < count; i++) {
        string key = Text(reader);
        if (key.Length == 0 || key.IndexOf('=') >= 0) throw new InvalidDataException("Umgebungsschlüssel");
        r.env.Add(key, Text(reader));
      }
      if (reader.BaseStream.Position != reader.BaseStream.Length) throw new InvalidDataException("Requestrest");
      return r;
    }
  }
  static string Quote(string value) {
    StringBuilder b = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') b.Append('\\', slashes * 2 + 1); else b.Append('\\', slashes);
      b.Append(c); slashes = 0;
    }
    return b.Append('\\', slashes * 2).Append('"').ToString();
  }
  static void Check(bool ok, string operation) {
    if (!ok) throw new InvalidOperationException(operation + ": " + Marshal.GetLastWin32Error());
  }
  static int Remaining(Request r) {
    long now = (DateTime.UtcNow.Ticks - 621355968000000000L) / 10000;
    return (int)Math.Max(0, Math.Min(int.MaxValue, r.deadline - now));
  }
  static IntPtr EnvironmentBlock(Dictionary<string,string> env) {
    List<string> keys = new List<string>(env.Keys); keys.Sort(StringComparer.OrdinalIgnoreCase);
    StringBuilder block = new StringBuilder();
    foreach (string key in keys) block.Append(key).Append('=').Append(env[key]).Append('\0');
    return Marshal.StringToHGlobalUni(block.Append('\0').ToString());
  }
  static void Drain(IntPtr job) {
    Accounting info;
    do {
      Check(QueryInformationJobObject(job, 1, out info, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero), "Jobabfrage");
      if (info.active > 0) Thread.Sleep(1);
    } while (info.active > 0);
  }
  static IntPtr NewJob() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero, "Jobanlage");
    try {
      Limits limits = new Limits(); limits.basic.flags = 0x2000; // KILL_ON_JOB_CLOSE, kein Breakaway
      Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))), "Joblimit");
      return job;
    } catch { CloseHandle(job); throw; }
  }
  static uint Execute(Request r, out bool timedOut) {
    IntPtr job = IntPtr.Zero, environment = IntPtr.Zero; ProcessInfo p = new ProcessInfo();
    timedOut = false;
    try {
      job = NewJob();
      if (Remaining(r) == 0) { timedOut = true; return 1; }
      Startup si = new Startup(); si.cb = Marshal.SizeOf(typeof(Startup)); si.flags = 0x100;
      si.input = GetStdHandle(-10); si.output = GetStdHandle(-11); si.error = GetStdHandle(-12);
      StringBuilder command = new StringBuilder(Quote(r.file));
      foreach (string arg in r.args) command.Append(' ').Append(Quote(arg));
      environment = EnvironmentBlock(r.env);
      Check(CreateProcess(r.file, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000404,
        environment, r.cwd, ref si, out p), "Zielstart"); // NO_WINDOW | UNICODE_ENVIRONMENT | SUSPENDED
      Check(AssignProcessToJobObject(job, p.process), "Jobzuordnung");
      if (Remaining(r) == 0) { timedOut = true; return 1; }
      Check(ResumeThread(p.thread) != uint.MaxValue, "Zielresume");
      uint wait = WaitForSingleObject(p.process, (uint)Remaining(r));
      timedOut = wait == 258; Check(wait == 0 || timedOut, "Zielwarten");
      uint code; Check(GetExitCodeProcess(p.process, out code), "Zielstatus");
      return timedOut ? 1 : code;
    } finally {
      // Auch angehaltene Ziele bei Assign/Resume-Fehlern beenden, niemals ungeschützt starten.
      if (p.process != IntPtr.Zero) { TerminateProcess(p.process, 1); WaitForSingleObject(p.process, 0xffffffff); }
      if (job != IntPtr.Zero) {
        try { Check(TerminateJobObject(job, 1), "Jobende"); Drain(job); }
        finally { CloseHandle(job); }
      }
      if (p.thread != IntPtr.Zero) CloseHandle(p.thread);
      if (p.process != IntPtr.Zero) CloseHandle(p.process);
      if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
    }
  }
  static int Main(string[] args) {
    Request r = null;
    try {
      if (args.Length == 1 && args[0] == "--pruefe") {
        IntPtr job = NewJob(); try { Drain(job); } finally { CloseHandle(job); }
        return 0;
      }
      r = Read(args[0]);
      bool timeout; uint code = Execute(r, out timeout);
      File.WriteAllText(r.status, timeout ? "timeout" : "exit:" + code);
      return 0;
    } catch (Exception e) {
      if (r != null) File.WriteAllText(r.status, "error:" + e.Message);
      return 1;
    }
  }
}
