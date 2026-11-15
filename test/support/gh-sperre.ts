/** gh-Sperre für Vitest (factory#560): legt eine gh-Attrappe an, die mit Exit 1 endet, und liefert den PATH mit ihrem Ordner vorn. Pur bis auf das Anlegen der Dateien; die Setup-Datei
 * gh-sperre-setup.ts wendet das Ergebnis auf process.env an (getrennt, damit ein Wächter die Funktion ohne Seiteneffekt auf den eigenen PATH prüfen kann).
 * Ausnahmen: Tests, die das echte gh brauchen, nehmen `FACTORY_ORIGINAL_PATH` als PATH des Kindprozesses; `FACTORY_GH_ECHT=1` schaltet die Sperre ganz ab.
 * Grenze: wirkt nur, wenn die Kind-Umgebung aus process.env abgeleitet ist; eine von Grund auf gebaute Umgebung (`env: { PATH: … }`) findet das echte gh. */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, delimiter } from "node:path";

export const GH_SPERRE_MELDUNG = "gh in Vitest gesperrt (Naht injizieren)";

/** Schreibt nur bei geändertem Inhalt: parallele Worker lesen die Datei nie halb geschrieben. */
function schreibeWennNeu(datei: string, inhalt: string, mode?: number): void {
  if (existsSync(datei) && readFileSync(datei, "utf8") === inhalt) return;
  writeFileSync(datei, inhalt);
  if (mode) chmodSync(datei, mode);
}

export type GhSperre = { dir: string; path: string; originalPath: string };

export function ghSperrePfad(env: Record<string, string | undefined>, tmp: string, plattform: string = process.platform): GhSperre | null {
  if (env.FACTORY_GH_ECHT === "1") return null;
  const dir = join(tmp, "factory-gh-attrappe");
  mkdirSync(dir, { recursive: true });
  const sh = join(dir, "gh");
  schreibeWennNeu(sh, `#!/bin/sh\necho "${GH_SPERRE_MELDUNG}" >&2\nexit 1\n`, 0o755);
  if (plattform === "win32") schreibeWennNeu(join(dir, "gh.cmd"), `@echo off\r\necho ${GH_SPERRE_MELDUNG} 1>&2\r\nexit /b 1\r\n`);
  const pfad = env.PATH ?? "";
  const schonVorn = pfad === dir || pfad.startsWith(dir + delimiter);
  const originalPath = schonVorn ? (env.FACTORY_ORIGINAL_PATH ?? "") : pfad;
  return { dir, path: schonVorn ? pfad : pfad ? `${dir}${delimiter}${pfad}` : dir, originalPath };
}
