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
const nl = (konstrukt) => new NichtLesbar(konstrukt);
const SCHLUESSEL = /^([A-Za-z0-9_./-]+):(?:[ \t]+(.*))?$/;
const LISTENPUNKT = /^-(?: |$)/;
const SONDER = /^[&*!|>{%@`?[]/;
const ohneKommentar = (s) => s.replace(/(^|[ \t])#.*$/, "").trim();

/** Ein Skalar (plain oder in einem Quote-Paar); Anker, Alias, Tag, Block-Skalar, Flow und Escapes sind nicht lesbar. Leer bleibt leer. */
function skalar(roh) {
  const s = ohneKommentar(roh);
  if (s !== "" && SONDER.test(s)) throw nl(`Konstrukt „${s[0]}“ in einem Wert`);
  const q = s[0];
  if (q !== '"' && q !== "'") return s;
  if (s.length < 2 || !s.endsWith(q) || s.slice(1, -1).includes(q) || s.includes("\\")) throw nl("Quote oder Escape in einem Wert");
  return s.slice(1, -1);
}

/** Die inhaltlichen Zeilen `{ einr, text }` (ohne Leer- und Kommentarzeilen); ein Tab in der Einrückung ist nicht lesbar. */
function zeilenVon(text) {
  const zeilen = [];
  for (const roh of text.split(/\r?\n/)) {
    if (/^[ \t]*(#.*)?$/.test(roh)) continue;
    if (/^ *\t/.test(roh)) throw nl("Tab in der Einrückung");
    const einr = /^ */.exec(roh)[0].length;
    zeilen.push({ einr, text: roh.slice(einr).trimEnd() });
  }
  return zeilen;
}

/** Der Wert und der Rumpf des Schlüssels `updates` auf oberster Ebene (`null` ohne ihn); jede andere oberste Zeile muss `schlüssel:` sein. */
function updatesAus(zeilen) {
  let updates = null;
  for (let i = zeilen[0]?.text === "---" ? 1 : 0; i < zeilen.length; ) {
    const m = zeilen[i].einr === 0 ? SCHLUESSEL.exec(zeilen[i].text) : null;
    if (!m) throw nl("oberste Ebene ist kein Mapping aus `schlüssel:`-Zeilen");
    let j = i + 1;
    while (j < zeilen.length && (zeilen[j].einr > 0 || LISTENPUNKT.test(zeilen[j].text))) j++;
    if (m[1] === "updates") {
      if (updates !== null) throw nl("`updates` doppelt");
      updates = { wert: ohneKommentar(m[2] ?? ""), rumpf: zeilen.slice(i + 1, j) };
    }
    i = j;
  }
  return updates;
}

/** Ein nicht leerer Skalar (ein leerer Eintrag in `exclude-paths` ist nicht lesbar). */
function pflichtWert(roh) {
  const v = skalar(roh);
  if (v === "") throw nl("leerer Eintrag in `exclude-paths`");
  return v;
}

/** Die Werte einer Blockliste unter `exclude-paths:` (`- pfad` je Zeile, gleiche Einrückung). */
function blockListe(zeilen) {
  return zeilen.map((z) => {
    if (z.einr !== zeilen[0].einr || !LISTENPUNKT.test(z.text)) throw nl("`exclude-paths` ist keine einfache Blockliste");
    return pflichtWert(z.text.slice(1));
  });
}

/** Die Werte einer einzeiligen Flow-Liste `[a, "b"]`. */
function flowListe(wert) {
  if (!wert.endsWith("]")) throw nl("`exclude-paths` als mehrzeilige Flow-Liste");
  const inner = wert.slice(1, -1).trim();
  return inner === "" ? [] : inner.split(",").map(pflichtWert);
}

/** Die Pfade unter `exclude-paths`; ein einfacher Text statt Liste zählt als keine (wie bei Dependabot). */
function ausschlussListe(g) {
  if (g.wert === "") return blockListe(g.zeilen);
  if (g.zeilen.length > 0) throw nl("`exclude-paths` mit Wert und Folgezeilen");
  if (g.wert.startsWith("[")) return flowListe(g.wert);
  skalar(g.wert);
  return [];
}

/** Die Felder eines Listeneintrags als Gruppen `{ schluessel, wert, zeilen }` (Schlüssel auf der Höhe des ersten; tiefere Zeilen gehören zum Schlüssel darüber). */
function felderVon(zeilen, schluesselEinr, erste) {
  const gruppen = [];
  for (const z of [{ einr: schluesselEinr, text: erste }, ...zeilen.slice(1)]) {
    if (z.einr < schluesselEinr) throw nl("Einrückung im Listeneintrag");
    const m = z.einr === schluesselEinr ? SCHLUESSEL.exec(z.text) : null;
    if (z.einr === schluesselEinr && !m) throw nl("Zeile im Listeneintrag ohne `schlüssel:`");
    if (m) gruppen.push({ schluessel: m[1], wert: ohneKommentar(m[2] ?? ""), zeilen: [] });
    else gruppen.at(-1).zeilen.push(z);
  }
  return gruppen;
}

/** Ein Listeneintrag von `updates` als `{ oekosystem, ausschluss }`; `null` für Skalar-Einträge und Mappings ohne `package-ecosystem` (die ein github-actions-Eintrag nie sind). */
function eintragVon(zeilen) {
  const kopf = zeilen[0].text;
  const erste = kopf.slice(1).trimStart();
  if (erste === "") throw nl("Listeneintrag mit Schlüsseln erst in der Folgezeile");
  if (!SCHLUESSEL.test(erste)) {
    if (SONDER.test(erste)) throw nl(`Konstrukt „${erste[0]}“ als Listeneintrag`);
    return null;
  }
  const gruppen = felderVon(zeilen, zeilen[0].einr + kopf.length - erste.length, erste);
  const finde = (name) => {
    const treffer = gruppen.filter((g) => g.schluessel === name);
    if (treffer.length > 1) throw nl(`\`${name}\` doppelt in einem Eintrag`);
    return treffer[0];
  };
  const oeko = finde("package-ecosystem");
  if (oeko === undefined) return null;
  const name = skalar(oeko.wert);
  if (name === "" || oeko.zeilen.length > 0) throw nl("`package-ecosystem` ohne einfachen Wert");
  const ausschluss = finde("exclude-paths");
  return { oekosystem: name, ausschluss: ausschluss === undefined ? [] : ausschlussListe(ausschluss) };
}

/** Die Einträge unter `updates` (nach der Form `- schlüssel: wert`); ein Eintrag je Listenpunkt. */
function eintraegeVon({ wert, rumpf }) {
  if (wert === "[]") return [];
  if (wert !== "") throw nl("`updates` ist keine Blockliste");
  const einr = rumpf[0]?.einr;
  const eintraege = [];
  for (const z of rumpf) {
    if (z.einr < einr || (z.einr === einr && !LISTENPUNKT.test(z.text))) throw nl("`updates` ist keine einfache Blockliste");
    if (z.einr === einr) eintraege.push([z]);
    else eintraege.at(-1).push(z);
  }
  return eintraege.map(eintragVon).filter((e) => e !== null);
}

/**
 * Die Einträge von `updates` als `{ eintraege: [{ oekosystem, ausschluss }] }` oder `{ fehler }` (Blockform ohne `yaml`-Bibliothek: der Doctor-Wochenlauf läuft ohne `npm ci`, nur Node-Builtins).
 * Gelesen wird nur die übliche Blockform (Schlüssel `package-ecosystem` und `exclude-paths` mit Blockliste oder einzeiliger Flow-Liste, Skalare plain oder im Quote-Paar). Nicht lesbar (fehler, nie ein stilles OK): Tab in der Einrückung,
 * eine oberste Ebene ohne `schlüssel:`-Zeilen (auch ein Skalar oder `null`), `updates` als Flow, Text oder Mapping, Anker `&`, Alias `*`, Tag `!`, Block-Skalar, mehrzeilige Werte, Escapes, doppelte Schlüssel. Ohne `updates` (auch leere Datei): keine Einträge.
 */
export function dependabotEintraege(text) {
  try {
    const updates = updatesAus(zeilenVon(text));
    return { eintraege: updates === null ? [] : eintraegeVon(updates) };
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
  const text = lies(join(rootDir, DEPENDABOT)) ?? lies(join(rootDir, DEPENDABOT_YAML));
  if (text === null) return [gut(AUSSCHLUSS)];
  const gelesen = dependabotEintraege(text);
  if (gelesen.fehler !== undefined) {
    return [nichtPruefbar(AUSSCHLUSS, `${DEPENDABOT} ist in dieser Form nicht lesbar (${gelesen.fehler}): der Doctor liest nur die übliche Blockform`, `${DEPENDABOT} in die übliche Blockform bringen (Liste \`updates\` mit \`- package-ecosystem: …\`, \`exclude-paths\` als Liste), dann erneut prüfen`)];
  }
  const aktionen = gelesen.eintraege.filter((u) => u.oekosystem === "github-actions");
  if (aktionen.length === 0) return [gut(AUSSCHLUSS)];
  const m = manifestAusText(lies(join(rootDir, MANIFEST_PFAD)));
  if (m.manifest === undefined) return [nichtPruefbar(AUSSCHLUSS, `${m.text}: die Besitz-Workflows sind nicht bestimmbar`, "den Sync erneut ausführen, dann erneut prüfen")];
  const fehlend = besitzWorkflows(m.manifest, rootDir, existiert).filter((w) => aktionen.some((a) => !a.ausschluss.includes(w)));
  if (fehlend.length === 0) return [gut(AUSSCHLUSS)];
  const liste = fehlend.join(", ");
  return [luecke(AUSSCHLUSS, `${liste} ${fehlend.length > 1 ? "fehlen" : "fehlt"} unter exclude-paths in ${DEPENDABOT}: Dependabot-PRs darauf scheitern an check:factorydrift`, `in ${DEPENDABOT} je github-actions-Eintrag unter exclude-paths ergänzen: ${liste}; ein Dependabot-PR darauf scheitert an check:factorydrift, der Bump kommt per Factory-Update`)];
}

/** Die Dateipunkte `dateien` samt Punkt `Dependabot-Ausschluss` (nur im Bezieher, nicht im Vorab-Abbruch). */
export const mitDependabotAusschluss = (dateien, { existiert, lies, bezieher }) => (a) => [...dateien(a), ...(a.vorAbbruch === true ? [] : dependabotAusschlussPunkt({ rootDir: a.rootDir, existiert, lies, bezieher }))];

/** Die Dateipunkte `dateien` samt Punkt `Factory-Update` (Config aus dem Aufruf, `lesen` vom Rand): dieselbe Form `dateien({ rootDir, config, … })`. */
export const mitFactoryUpdate = (dateien, { lesen, existiert, bezieher }) => (a) => [...dateien(a), ...factoryUpdatePunkt({ rootDir: a.rootDir, config: a.config, vorAbbruch: a.vorAbbruch === true, lesen, existiert, bezieher })];

/** Die Standard-Dateipunkte von `--pruefen`: `pruefeDateien`, dann `Meldestelle` (nur bei fremder Stelle), dann `Factory-Update` und `Dependabot-Ausschluss` (nur im Bezieher); `lesen(args, token)` ist die `gh`-Naht von Meldestelle und Factory-Update (`Dependabot-Ausschluss` liest nur Dateien). */
export const dateienStandard = ({ env, lesen, pruefe = pruefeDateien }) => mitDependabotAusschluss(mitFactoryUpdate(mitMeldestelle(pruefe, { env, lesen }), { lesen }), {});
