// Nur Node-Builtins und Blatt-Module (der Wochenlauf des Doctors hat kein `npm ci`).
/* Harness-Doctor, Punkt `Refactoring-Sammelticket` (factory#597, Epic factory#568; ADR 0027): im Bezieher steht das Refactoring-Sammelticket standardmäßig an
 * (`refactoringEinstellung`); der Punkt meldet, wenn es im eigenen Repo fehlt oder abgeschaltet ist.
 *
 *   - Kein Bezieher (Fabrik): kein Punkt (ADR 0031: ohne Schlüssel gibt es dort kein Ticket, nichts zu prüfen).
 *   - `labels.refactoring: false`: Lücke „abgeschaltet (ausgewiesen)“, nie `gut`, ohne `gh`-Aufruf.
 *   - Sonst muss ein offenes Issue mit dem Titel „Refactoring (gesammelt)“ (oder dem Alttitel) existieren; fehlt es: Lücke mit dem Anlege-Befehl. Ein Lesefehler ist `NICHT PRÜFBAR`, nie still grün.
 *
 * Grenzen: geprüft wird nur der Titel (kein Claim-Status, kein Autor); ein offenes Issue fremder Autorschaft mit gleichem Titel zählt als vorhanden.
 * `lesen(args)` ist die `gh`-Naht (liefert die geparste Antwort von `gh api --paginate --slurp`, wirft bei einem Fehler); `mitRefactoring` hängt den Punkt an die Dateipunkte des Doctors. */
import { fehlerText } from "./gh-cli.mjs";
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { refactoringEinstellung } from "./projekt-config-lib.mjs";
import { REFACTORING_TITEL_AKZEPTIERT } from "./sammelticket-titel.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";

const PUNKT = "Refactoring-Sammelticket";

/** Hat eine Antwort von `gh api --paginate --slurp` (Liste von Seiten oder flache Liste) ein offenes Issue (kein PR) mit akzeptiertem Titel? */
const hatSammelticket = (antwort) =>
  (Array.isArray(antwort) ? antwort : [])
    .flat()
    .some((i) => i && !i.pull_request && REFACTORING_TITEL_AKZEPTIERT.includes(i.title));

/** Der Punkt `Refactoring-Sammelticket` als Liste: leer im Nicht-Bezieher, sonst genau ein Ergebnis. */
export function refactoringPunkt({ config, rootDir, lesen, vorAbbruch = false, bezieher = istBezieher }) {
  if (!bezieher(rootDir)) return [];
  if (vorAbbruch) return [nichtPruefbar(PUNKT, "Config nicht geladen (Vorab-Abbruch)", "Config beheben, dann node scripts/harness-doctor.mjs --pruefen")];
  if (!refactoringEinstellung(config, { bezieher: true }).an) {
    return [luecke(PUNKT, "abgeschaltet (ausgewiesen): labels.refactoring: false, Code-Befunde außerhalb des Slices haben kein Ziel", "labels.refactoring entfernen (Standard an) oder die Abschaltung bewusst stehen lassen; dann node scripts/harness-doctor.mjs --pruefen")];
  }
  let antwort;
  try {
    antwort = lesen(["api", "--paginate", "--slurp", `repos/${config.repo}/issues?state=open&per_page=100`]);
  } catch (e) {
    return [nichtPruefbar(PUNKT, `die offenen Issues von ${config.repo} sind nicht lesbar (${fehlerText(e).split("\n")[0]})`, "gh-Login oder Token mit Leserecht auf die Issues prüfen, dann erneut prüfen")];
  }
  if (hatSammelticket(antwort)) return [gut(PUNKT)];
  return [luecke(PUNKT, "kein offenes Sammelticket „Refactoring (gesammelt)“ (oder Alttitel) im eigenen Repo", "node scripts/sammelticket-anlegen.mjs refactoring")];
}

/** Die Dateipunkte `dateien` samt Punkt `Refactoring-Sammelticket` (Config aus dem Aufruf, `lesen` und `bezieher` vom Rand). */
export const mitRefactoring = (dateien, { lesen, bezieher }) => (a) => [...dateien(a), ...refactoringPunkt({ config: a.config, rootDir: a.rootDir, vorAbbruch: a.vorAbbruch === true, lesen, bezieher })];
