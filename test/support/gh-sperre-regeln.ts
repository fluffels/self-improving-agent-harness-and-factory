/** Reine Teile der gh-Sperre (factory#541 L4, ohne Seiteneffekt, damit der Wächter sie importieren kann, ohne die Sperre selbst zu setzen). */
export const MELDUNG = "gh im Vitest-Lauf gesperrt (test/support/gh-sperre.ts)";
/** Geschlossene Ausnahmeliste: Testpfade (relativ zur Wurzel), die das echte gh brauchen (`gh --version`). */
export const GH_ECHT_ERLAUBT: readonly string[] = ["test/harness/test-umgebung.test.ts", "test/ci-laeufe.test.ts"];

export function ghAttrappe(plattform: string): { datei: string; inhalt: string } {
  if (plattform === "win32") return { datei: "gh.cmd", inhalt: `@echo off\r\necho ${MELDUNG}: gh %* 1>&2\r\nexit /b 1\r\n` };
  return { datei: "gh", inhalt: `#!/bin/sh\necho "${MELDUNG}: gh $*" >&2\nexit 1\n` };
}

export function erlaubt(testPfad: string | undefined): boolean {
  const norm = (testPfad ?? "").replaceAll("\\", "/");
  return GH_ECHT_ERLAUBT.some((p) => norm.endsWith(`/${p}`));
}
