/* Harness-Doctor, Punkt `Factory-Update` (factory#220 L39; `dateienStandard` unten ist die eine Verdrahtung der Standard-Dateipunkte für `--pruefen` und den Wochenlauf): prüft im Bezieher, ob der Wochenlauf `.github/workflows/factory-update.yml` da ist und aktiv läuft.
 * Fehlt die Datei oder ruht der Workflow, kommt nie ein Issue „Factory-Update“, und niemand merkt es. Nur im Bezieher (Sync-Stand vorhanden, `istBezieher`, Rollen-Schalter): in der Fabrik gibt es den Punkt nicht.
 *
 *   - Datei fehlt: Lücke (Fix: Sync erneut ausführen, er liefert die Datei).
 *   - `gh api repos/<repo>/actions/workflows/factory-update.yml` meldet `state` ungleich `active` (zum Beispiel `disabled_inactivity`): Lücke (Fix: `gh workflow enable factory-update.yml` oder im Actions-Reiter aktivieren).
 *   - API-Fehler (403, 404, Netz) oder keine Antwort: `NICHT PRÜFBAR`, nie still grün.
 *
 * Grenze: GitHub schaltet Zeitpläne in öffentlichen Repos nach etwa 60 Tagen ohne Aktivität selbst ab; der Punkt sieht das erst beim nächsten Doctor-Lauf (der Wochenlauf des Doctors ist selbst Aktivität des Repos nur, wenn er läuft).
 * `--einrichten` ändert den Punkt nie (er läuft nur in `--pruefen` und im Wochenlauf); im Vorab-Abbruch (Config nicht geladen) entfällt er. Der Wochenlauf des Doctors braucht dafür `permissions: actions: read`.
 * `lesen(args, token)` ist die `gh`-Naht (liefert die geparste Antwort, wirft bei einem Fehler); `mitFactoryUpdate` hängt den Punkt an die Dateipunkte (`dateien({ rootDir, config, ... })`).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fehlerText } from "./gh-cli.mjs";
import { pruefeDateien } from "./harness-doctor-dateien.mjs";
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { mitMeldestelle } from "./harness-doctor-meldestelle.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";

const PUNKT = "Factory-Update";
const WORKFLOW = "factory-update.yml";
const PFAD = `.github/workflows/${WORKFLOW}`;
const SYNC_FIX = "den Sync erneut ausführen (`node scripts/factory-sync.mjs --quelle <Factory-Checkout> --tag <Tag> --ziel .`, Anleitung: Seite docs/erstbezug.md des Factory-Repos): der Sync liefert die Datei";

/** Der Punkt `Factory-Update` als Liste: leer in der Fabrik, ohne Config und im Vorab-Abbruch, sonst genau ein Ergebnis. */
export function factoryUpdatePunkt({ rootDir, config, lesen, existiert = existsSync, bezieher = istBezieher, vorAbbruch = false }) {
  if (vorAbbruch || !config || typeof config !== "object" || !bezieher(rootDir)) return [];
  if (!existiert(join(rootDir, PFAD))) {
    return [luecke(PUNKT, `${PFAD} fehlt: ohne ihn kommt nie ein Issue „Factory-Update“`, SYNC_FIX)];
  }
  return [zustandPunkt(config, lesen)];
}

/** Der Punkt aus dem Zustand des Workflows laut API (die Datei ist da, die Config ist ein Objekt). */
function zustandPunkt(config, lesen) {
  if (typeof config.repo !== "string" || config.repo === "") {
    return nichtPruefbar(PUNKT, "`repo` fehlt in der Projekt-Config: der Zustand des Workflows lässt sich nicht abfragen", "`repo` (<besitzer>/<name>) in der Projekt-Config eintragen, dann erneut prüfen");
  }
  let antwort;
  try {
    antwort = lesen(["api", `repos/${config.repo}/actions/workflows/${WORKFLOW}`]);
  } catch (e) {
    return nichtPruefbar(PUNKT, `der Zustand von ${WORKFLOW} ist nicht lesbar (${fehlerText(e).split("\n")[0]})`, "Token mit Leserecht auf Actions prüfen (im Wochenlauf `permissions: actions: read`), dann erneut prüfen");
  }
  if (antwort === null || typeof antwort !== "object") {
    return nichtPruefbar(PUNKT, `die Antwort zu ${WORKFLOW} ist leer oder kein Objekt`, "erneut prüfen; bleibt es dabei, im Actions-Reiter nachsehen, ob der Workflow aktiv ist");
  }
  if (antwort.state === "active") return gut(PUNKT);
  return luecke(PUNKT, `der Workflow ${WORKFLOW} ist nicht aktiv (Zustand: ${String(antwort.state)}): der Wochenlauf legt kein Issue „Factory-Update“ an (GitHub schaltet Zeitpläne nach etwa 60 Tagen ohne Aktivität in öffentlichen Repos ab)`, `\`gh workflow enable ${WORKFLOW}\` ausführen oder im Reiter Actions den Workflow „Factory-Update“ wählen und aktivieren`);
}

/** Die Dateipunkte `dateien` samt Punkt `Factory-Update` (Config aus dem Aufruf, `lesen` vom Rand): dieselbe Form `dateien({ rootDir, config, … })`. */
export const mitFactoryUpdate = (dateien, { lesen, existiert, bezieher }) => (a) => [...dateien(a), ...factoryUpdatePunkt({ rootDir: a.rootDir, config: a.config, vorAbbruch: a.vorAbbruch === true, lesen, existiert, bezieher })];

/** Die Standard-Dateipunkte von `--pruefen`: `pruefeDateien`, dann `Meldestelle` (nur bei fremder Stelle), dann `Factory-Update` (nur im Bezieher); `lesen(args, token)` ist die `gh`-Naht der beiden letzten. */
export const dateienStandard = ({ env, lesen, pruefe = pruefeDateien }) => mitFactoryUpdate(mitMeldestelle(pruefe, { env, lesen }), { lesen });
