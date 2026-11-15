/** Test-Setup (vite.config.ts › setupFiles, factory#541 L4): stellt je Worker eine `gh`-Attrappe vor den PATH, damit ein Unit-Test mit der Standard-Naht (ghJson/ghText) nie unbemerkt das Netz erreicht.
 * Die Attrappe nennt die Meldung samt Argumenten und endet mit Exit 1; der Test wird dadurch nicht von selbst rot, nur der Aufruf scheitert sofort.
 * Ausnahme: Testdateien aus GH_ECHT_ERLAUBT behalten den Original-PATH (sie brauchen das echte `gh --version`).
 * Grenze: erfasst nur `gh` über den PATH, nicht fetch oder absolute Pfade; Tests, die PATH selbst setzen, umgehen die Sperre (gewollt). */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect } from "vitest";

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

if (!erlaubt(expect.getState().testPath)) {
  const ordner = mkdtempSync(join(tmpdir(), "factory-gh-sperre-"));
  mkdirSync(ordner, { recursive: true });
  const { datei, inhalt } = ghAttrappe(process.platform);
  writeFileSync(join(ordner, datei), inhalt, { mode: 0o755 });
  process.env.PATH = `${ordner}${delimiter}${process.env.PATH ?? ""}`;
}
