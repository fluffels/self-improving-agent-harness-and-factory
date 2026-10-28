export const jobfehler = [
  ["Jobanlage", "job = CreateJobObject(IntPtr.Zero, null);", "job = fault == \"Jobanlage\" ? IntPtr.Zero : CreateJobObject(IntPtr.Zero, null);"],
  ["Joblimit", "Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))),", "Check(fault != \"Joblimit\" && SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))),"],
  ["Jobzuordnung", "Check(AssignProcessToJobObject(job, p.process),", "Check(fault != \"Jobzuordnung\" && AssignProcessToJobObject(job, p.process),"],
  ["Zielresume", "Check(ResumeThread(p.thread) != uint.MaxValue,", "Check(fault != \"Zielresume\" && ResumeThread(p.thread) != uint.MaxValue,"],
];

export function jobquelle(source: string): string {
  const replacements = [["public class Request", 'static string fault = Environment.GetEnvironmentVariable("JOB_FIXTURE");\n  public class Request'], ...jobfehler.map(([, anchor, replacement]) => [anchor, replacement])];
  for (const [anchor, replacement] of replacements) {
    if (source.split(anchor).length !== 2) throw Error("Jobfixture-Quellanker ist nicht eindeutig");
    source = source.replace(anchor, replacement);
  }
  return source;
}
