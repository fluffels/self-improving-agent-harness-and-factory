/* Harness-Doctor, Punkte `Factory-Update` (factory#220 L39) und `Dependabot-Ausschluss` (factory#375 L5, eigener Abschnitt weiter unten; `dateienStandard` ist die eine Verdrahtung der Standard-Dateipunkte für `--pruefen` und den Wochenlauf). Beide nur im Bezieher; die Datei importiert nur `node:`-Builtins und lokale Module (der Wochenlauf läuft ohne `npm ci`, Wächter im Test). `Factory-Update` prüft im Bezieher, ob der Wochenlauf `.github/workflows/factory-update.yml` da ist und aktiv läuft.
 * Fehlt die Datei oder ruht der Workflow, kommt nie ein Issue „Factory-Update“, und niemand merkt es. Nur im Bezieher (Sync-Stand vorhanden, `istBezieher`, Rollen-Schalter): in der Fabrik gibt es den Punkt nicht.
 *
 *   - Datei fehlt: Lücke (Fix: Sync erneut ausführen, er liefert die Datei).
 *   - `gh api repos/<repo>/actions/workflows/factory-update.yml` meldet `state` ungleich `active` (zum Beispiel `disabled_inactivity`): Lücke (Fix: `gh workflow enable factory-update.yml` oder im Actions-Reiter aktivieren).
 *   - API-Fehler (403, 404, Netz) oder keine Antwort: `NICHT PRÜFBAR`, nie still grün.
 *
 * Grenze: GitHub schaltet Zeitpläne in öffentlichen Repos nach etwa 60 Tagen ohne Aktivität selbst ab; der Punkt sieht das erst beim nächsten Doctor-Lauf (der Wochenlauf des Doctors ist selbst Aktivität des Repos nur, wenn er läuft).
 * `--einrichten` ändert den Punkt nie (er läuft nur in `--pruefen` und im Wochenlauf); im Vorab-Abbruch (Config nicht geladen) entfällt er. Der Wochenlauf des Doctors braucht dafür `permissions: actions: read`.
 * `lesen(args, token)` ist die `gh`-Naht von `Factory-Update` (und der Meldestelle; liefert die geparste Antwort, wirft bei einem Fehler); `mitFactoryUpdate` hängt den Punkt an die Dateipunkte (`dateien({ rootDir, config, ... })`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_PFAD, istWorkflowEinheit, manifestAusText, wirdVerteilt } from "./besitz-lib.mjs";
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

const AUSSCHLUSS = "Dependabot-Ausschluss";
const DEPENDABOT = ".github/dependabot.yml";
const DEPENDABOT_YAML = ".github/dependabot.yaml";
const liesDatei = (pfad) => {
  try {
    return readFileSync(pfad, "utf8");
  } catch {
    return null;
  }
};

/** Die Besitz-Workflows des Projekts: Ganzdatei-Einträge des Manifests unter `.github/workflows/`, die verteilt werden und im Projekt da sind. */
const besitzWorkflows = (manifest, rootDir, existiert) => manifest.eintraege.filter((e) => istWorkflowEinheit(e) && wirdVerteilt(e) && existiert(join(rootDir, e.pfad))).map((e) => e.pfad);

/** Der Leser kennt eine Form nicht (fail-closed: Ergebnis `NICHT PRÜFBAR`, nie ein stilles OK). */
class NichtLesbar extends Error {}
const nl = (was) => new NichtLesbar(was);
const SCHLUESSEL = /^([A-Za-z0-9_./-]+):(?: (.*))?$/;
const SONDER = /^[&*!|>{%@`?[]/;
const ohneKommentar = (s) => s.replace(/(^| )#.*$/, "").trim();

/** Ein Skalar (plain oder in einem Quote-Paar); Anker, Alias, Tag, Block-Skalar, Flow und Escapes sind nicht lesbar. Leer bleibt leer. */
function skalar(roh) {
  const s = ohneKommentar(roh);
  if (SONDER.test(s)) throw nl(`Konstrukt „${s[0]}“ in einem Wert`);
  if (s[0] !== '"' && s[0] !== "'") return s;
  if (!/^(["'])[^"'\\]*\1$/.test(s)) throw nl("Quote oder Escape in einem Wert");
  return s.slice(1, -1);
}

/** Die inhaltlichen Zeilen `{ einr, text }` (ohne Leer- und Kommentarzeilen); ein Tab irgendwo ist nicht lesbar. */
function zeilenVon(text) {
  const zeilen = [];
  for (const roh of text.split(/\r?\n/)) {
    if (roh.includes("\t")) throw nl("Tab");
    if (/^ *(#.*)?$/.test(roh)) continue;
    const einr = /^ */.exec(roh)[0].length;
    zeilen.push({ einr, text: roh.slice(einr).trimEnd() });
  }
  return zeilen;
}

/** Gruppen `{ kopf, rumpf }`: ein Kopf je Zeile auf Höhe `einr`, tiefere Zeilen gehören zum Kopf davor; flachere oder ein tieferer Anfang sind nicht lesbar. */
function gruppen(zeilen, einr, wo) {
  const g = [];
  for (const z of zeilen) {
    if (z.einr < einr || (z.einr > einr && g.length === 0)) throw nl(`Einrückung in ${wo}`);
    if (z.einr === einr) g.push({ kopf: z, rumpf: [] });
    else g.at(-1).rumpf.push(z);
  }
  return g;
}

/** Eine Zeile `schlüssel: wert` als `{ schluessel, wert }`; alles andere ist nicht lesbar. */
function feld(text) {
  const m = SCHLUESSEL.exec(text);
  if (m === null) throw nl(`Zeile „${text}“ ist kein \`schlüssel: wert\``);
  return { schluessel: m[1], wert: ohneKommentar(m[2] ?? "") };
}

/** Die Pfade unter `exclude-paths`: Blockliste `- pfad`, `[]` oder ein einfacher Text, der wie bei Dependabot als keine Liste zählt. */
function ausschlussListe({ wert, rumpf }) {
  if (wert !== "") {
    if (rumpf.length > 0) throw nl("`exclude-paths` mit Wert und Folgezeilen");
    if (wert !== "[]") skalar(wert);
    return [];
  }
  return gruppen(rumpf, rumpf[0]?.einr, "`exclude-paths`").map(({ kopf, rumpf: tiefer }) => {
    if (tiefer.length > 0 || !kopf.text.startsWith("- ")) throw nl("`exclude-paths` ist keine einfache Blockliste");
    const v = skalar(kopf.text.slice(2));
    if (v === "") throw nl("leerer Eintrag in `exclude-paths`");
    return v;
  });
}

/** Ein Listeneintrag von `updates` als `{ oekosystem, ausschluss }`; `null` für ein Mapping ohne `package-ecosystem` (das ein github-actions-Eintrag nie ist). */
function eintragVon({ kopf, rumpf }) {
  if (!kopf.text.startsWith("- ")) throw nl("`updates` ist keine einfache Blockliste");
  const erste = kopf.text.slice(2).trimStart();
  const einr = kopf.einr + kopf.text.length - erste.length;
  const felder = gruppen([{ einr, text: erste }, ...rumpf], einr, "einem Eintrag").map((g) => ({ ...feld(g.kopf.text), rumpf: g.rumpf }));
  const finde = (name) => {
    const treffer = felder.filter((f) => f.schluessel === name);
    if (treffer.length > 1) throw nl(`\`${name}\` doppelt in einem Eintrag`);
    return treffer[0];
  };
  const oeko = finde("package-ecosystem");
  if (oeko === undefined) return null;
  const name = skalar(oeko.wert);
  if (name === "" || oeko.rumpf.length > 0) throw nl("`package-ecosystem` ohne einfachen Wert");
  const ausschluss = finde("exclude-paths");
  return { oekosystem: name, ausschluss: ausschluss === undefined ? [] : ausschlussListe(ausschluss) };
}

/** Die Einträge unter dem Schlüssel `updates` auf oberster Ebene (keine ohne ihn); jede andere oberste Zeile muss `schlüssel: wert` sein. */
function eintraegeVon(zeilen) {
  let updates = null;
  for (const { kopf, rumpf } of gruppen(zeilen.slice(zeilen[0]?.text === "---" ? 1 : 0), 0, "der obersten Ebene")) {
    const f = feld(kopf.text);
    if (f.schluessel !== "updates") continue;
    if (updates !== null) throw nl("`updates` doppelt");
    updates = { wert: f.wert, rumpf };
  }
  if (updates === null) return [];
  if (updates.wert === "[]" && updates.rumpf.length === 0) return [];
  if (updates.wert !== "") throw nl("`updates` ist keine Blockliste");
  return gruppen(updates.rumpf, updates.rumpf[0]?.einr, "`updates`").map(eintragVon).filter((e) => e !== null);
}

/**
 * Die Einträge von `updates` als `{ eintraege: [{ oekosystem, ausschluss }] }` oder `{ fehler }` (Blockform ohne `yaml`-Bibliothek: der Doctor-Wochenlauf läuft ohne `npm ci`, nur Node-Builtins).
 * Gelesen wird nur die übliche Blockform: Zeilen `schlüssel: wert` (Schlüssel ohne Quotes), `package-ecosystem` als Skalar (plain oder im Quote-Paar), `exclude-paths` als Blockliste oder `[]`, Kommentare nach einem Leerzeichen, `---` am Anfang.
 * Nicht lesbar (fehler, nie ein stilles OK): ein Tab, eine Zeile ohne `schlüssel: wert` (auch Skalar, Quotes um den Schlüssel, `updates`-Eintrag ohne Mapping), Flow-Einträge und nichtleere Flow-Listen, Anker `&`, Alias `*`, Tag `!`, Block-Skalar, mehrzeilige Werte, Escapes, doppelte Schlüssel. Ohne `updates` (auch leere Datei): keine Einträge.
 */
export function dependabotEintraege(text) {
  try {
    return { eintraege: eintraegeVon(zeilenVon(text)) };
  } catch (e) {
    if (e instanceof NichtLesbar) return { fehler: e.message };
    throw e;
  }
}

/**
 * Der Punkt `Dependabot-Ausschluss` (factory#375 L5) als Liste: nur im Bezieher. Ein Dependabot-PR auf einen Besitz-Workflow (etwa `codeql.yml`) scheitert strukturell an `check:factorydrift`:
 * der Bezieher kann ihn weder mergen noch lokal fixen, der Bump kommt per Factory-Update. Darum muss jeder `github-actions`-Eintrag in `.github/dependabot.yml` jeden vorhandenen Besitz-Workflow unter `exclude-paths` führen.
 * Ohne Datei (`lies` liefert `null`; gelesen wird `.github/dependabot.yml`, sonst `.github/dependabot.yaml`) oder ohne `github-actions`-Eintrag: OK. Eine Form außerhalb der Blockform von `dependabotEintraege` oder ein unlesbares Manifest: `NICHT PRÜFBAR`. Grenze: nur wörtliche Pfade, Globs zählen nicht; ob `exclude-paths` für `github-actions` wirkt, ist Dependabot-seitig.
 */
export function dependabotAusschlussPunkt({ rootDir, existiert = existsSync, lies = liesDatei, bezieher = istBezieher }) {
  if (!bezieher(rootDir)) return [];
  const datei = lies(join(rootDir, DEPENDABOT)) === null ? DEPENDABOT_YAML : DEPENDABOT;
  const text = lies(join(rootDir, datei));
  if (text === null) return [gut(AUSSCHLUSS)];
  const gelesen = dependabotEintraege(text);
  if (gelesen.fehler !== undefined) {
    return [nichtPruefbar(AUSSCHLUSS, `${datei} ist in dieser Form nicht lesbar (${gelesen.fehler}): der Doctor liest nur die übliche Blockform`, `${datei} in die übliche Blockform bringen (Liste \`updates\` mit \`- package-ecosystem: …\`, \`exclude-paths\` als Liste), dann erneut prüfen`)];
  }
  const aktionen = gelesen.eintraege.filter((u) => u.oekosystem === "github-actions");
  if (aktionen.length === 0) return [gut(AUSSCHLUSS)];
  const m = manifestAusText(lies(join(rootDir, MANIFEST_PFAD)));
  if (m.manifest === undefined) return [nichtPruefbar(AUSSCHLUSS, `${m.text}: die Besitz-Workflows sind nicht bestimmbar`, "den Sync erneut ausführen, dann erneut prüfen")];
  const fehlend = besitzWorkflows(m.manifest, rootDir, existiert).filter((w) => aktionen.some((a) => !a.ausschluss.includes(w)));
  if (fehlend.length === 0) return [gut(AUSSCHLUSS)];
  const liste = fehlend.join(", ");
  return [luecke(AUSSCHLUSS, `${liste} ${fehlend.length > 1 ? "fehlen" : "fehlt"} unter exclude-paths in ${datei}: Dependabot-PRs darauf scheitern an check:factorydrift`, `in ${datei} je github-actions-Eintrag unter exclude-paths ergänzen: ${liste}; ein Dependabot-PR darauf scheitert an check:factorydrift, der Bump kommt per Factory-Update`)];
}

/** Die Dateipunkte `dateien` samt Punkt `Dependabot-Ausschluss` (nur im Bezieher, nicht im Vorab-Abbruch). */
export const mitDependabotAusschluss = (dateien, { existiert, lies, bezieher }) => (a) => [...dateien(a), ...(a.vorAbbruch === true ? [] : dependabotAusschlussPunkt({ rootDir: a.rootDir, existiert, lies, bezieher }))];

/** Die Dateipunkte `dateien` samt Punkt `Factory-Update` (Config aus dem Aufruf, `lesen` vom Rand): dieselbe Form `dateien({ rootDir, config, … })`. */
export const mitFactoryUpdate = (dateien, { lesen, existiert, bezieher }) => (a) => [...dateien(a), ...factoryUpdatePunkt({ rootDir: a.rootDir, config: a.config, vorAbbruch: a.vorAbbruch === true, lesen, existiert, bezieher })];

/** Die Standard-Dateipunkte von `--pruefen`: `pruefeDateien`, dann `Meldestelle` (nur bei fremder Stelle), dann `Factory-Update` und `Dependabot-Ausschluss` (nur im Bezieher); `lesen(args, token)` ist die `gh`-Naht von Meldestelle und Factory-Update (`Dependabot-Ausschluss` liest nur Dateien). */
export const dateienStandard = ({ env, lesen, pruefe = pruefeDateien }) => mitDependabotAusschluss(mitFactoryUpdate(mitMeldestelle(pruefe, { env, lesen }), { lesen }), {});
