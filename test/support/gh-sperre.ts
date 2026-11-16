/** gh-Sperre für Vitest (factory#560): legt eine gh-Attrappe an, die mit Exit 1 endet, und liefert den PATH mit ihrem Ordner vorn. Pur bis auf das Anlegen der Dateien; die Setup-Datei
 * gh-sperre-setup.ts wendet das Ergebnis auf process.env an (getrennt, damit ein Wächter die Funktion ohne Seiteneffekt auf den eigenen PATH prüfen kann).
 * Ausnahmen: Tests, die das echte gh brauchen, nehmen `FACTORY_ORIGINAL_PATH` als PATH des Kindprozesses; `FACTORY_GH_ECHT=1` schaltet die Sperre ganz ab.
 * Sicherheit des Ordners: Name je Nutzer, ein vorhandener Ordner muss ein echter Ordner des Nutzers ohne Schreibrecht für andere sein (sonst Abbruch), Dateien entstehen über eine
 * Temp-Datei und `rename` (folgt keinem Symlink am Ziel, nie halb geschrieben).
 * Grenzen: wirkt nur, wenn die Kind-Umgebung aus process.env abgeleitet ist (eine von Grund auf gebaute Umgebung `env: { PATH: … }` oder ein absoluter gh-Pfad findet das echte gh);
 * unter Windows entfällt die Besitzerprüfung (kein getuid), dort gilt das Nutzer-Temp. */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, delimiter } from "node:path";

export const GH_SPERRE_MELDUNG = "gh in Vitest gesperrt (Naht injizieren)";

/** Prüft einen vorhandenen oder frisch angelegten Sperr-Ordner: echter Ordner, dem Nutzer gehörig, ohne Schreibrecht für Gruppe und andere. Wirft sonst. */
function pruefeOrdner(dir: string, uid: number | undefined): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) throw new Error(`gh-Sperre: ${dir} ist kein echter Ordner`);
  if (uid !== undefined && st.uid !== uid) throw new Error(`gh-Sperre: ${dir} gehört einem anderen Nutzer`);
  if (uid !== undefined && (st.mode & 0o022) !== 0) throw new Error(`gh-Sperre: ${dir} ist für andere beschreibbar`);
}

/** Schreibt nur bei geändertem Inhalt und dann atomar (Temp-Datei, `wx`, `rename`): parallele Worker lesen die Datei nie halb geschrieben, ein Symlink am Ziel wird ersetzt, nicht verfolgt. */
function schreibeWennNeu(datei: string, inhalt: string, mode?: number): void {
  if (existsSync(datei) && !lstatSync(datei).isSymbolicLink() && readFileSync(datei, "utf8") === inhalt) return;
  const temp = `${datei}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, inhalt, { flag: "wx" });
  if (mode) chmodSync(temp, mode);
  renameSync(temp, datei);
}

export type GhSperre = { dir: string; path: string; originalPath: string };

export function ghSperrePfad(env: Record<string, string | undefined>, tmp: string, plattform: string = process.platform, uid: number | undefined = process.getuid?.()): GhSperre | null {
  if (env.FACTORY_GH_ECHT === "1") return null;
  const dir = join(tmp, `factory-gh-attrappe-${uid ?? "u"}`);
  pruefeOrdner(dir, uid);
  schreibeWennNeu(join(dir, "gh"), `#!/bin/sh\necho "${GH_SPERRE_MELDUNG}" >&2\nexit 1\n`, 0o755);
  if (plattform === "win32") schreibeWennNeu(join(dir, "gh.cmd"), `@echo off\r\necho ${GH_SPERRE_MELDUNG} 1>&2\r\nexit /b 1\r\n`);
  const pfad = env.PATH ?? "";
  const schonVorn = pfad === dir || pfad.startsWith(dir + delimiter);
  const originalPath = schonVorn ? (env.FACTORY_ORIGINAL_PATH ?? "") : pfad;
  return { dir, path: schonVorn ? pfad : pfad ? `${dir}${delimiter}${pfad}` : dir, originalPath };
}
