/** Test-Setup (vite.config.ts › setupFiles, factory#541 L4): stellt je Worker eine `gh`-Attrappe vor den PATH, damit ein Unit-Test mit der Standard-Naht (ghJson/ghText) nie unbemerkt das Netz erreicht.
 * Die Attrappe nennt die Meldung samt Argumenten und endet mit Exit 1; der Test wird dadurch nicht von selbst rot, nur der Aufruf scheitert sofort.
 * Ausnahme: Testdateien aus GH_ECHT_ERLAUBT (gh-sperre-regeln.ts) behalten den Original-PATH (sie brauchen das echte `gh --version`).
 * Grenze: erfasst nur `gh` über den PATH, nicht fetch oder absolute Pfade; Tests, die PATH selbst setzen, umgehen die Sperre (gewollt). */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { expect } from "vitest";
import { erlaubt, ghAttrappe } from "./gh-sperre-regeln";

if (!erlaubt(expect.getState().testPath)) {
  const ordner = mkdtempSync(join(tmpdir(), "factory-gh-sperre-"));
  const { datei, inhalt } = ghAttrappe(process.platform);
  writeFileSync(join(ordner, datei), inhalt, { mode: 0o755 });
  process.env.PATH = `${ordner}${delimiter}${process.env.PATH ?? ""}`;
}
