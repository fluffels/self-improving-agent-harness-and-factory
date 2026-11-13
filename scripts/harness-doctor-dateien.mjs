/* Harness-Doctor, Dateipunkte (factory#94, ADR 0022): Kern-Regeln gegen die Projektdateien des Beziehers, je Punkt `OK`, `LÜCKE` oder
 * `NICHT PRÜFBAR` (nie still grün; fehlt die `AGENTS.md` im Root, ist `Root-Kontextdatei` nicht prüfbar statt leer grün). Sie ersetzen die Projekt-Kopien der Kern-Tests agents-md-native, line-endings und (Fitness-Anteil) harness-approval im Bezieher; der Unit-Anteil
 * (Parser, Erkennung) bleibt Kern-Test und ruft dieselben Funktionen aus diesem Modul (für harness-approval: `ankerFunde`, `agentsFunde` und die Muster-Funktionen aus leitplanken-muster.mjs).
 *
 *   `Root-Kontextdatei`: keine `CLAUDE.md`, `.claude/CLAUDE.md` oder `CLAUDE.local.md` im Root (auch ungetrackt): sie schaltet das native Laden von AGENTS.md ab.
 *   `Zeilenenden`: `.claude/**`, `.agents/**` und `LF_BEISPIELE` haben `eol=lf`, jede andere Textdatei eine eol-Regel (`lf` oder ausdrücklich `crlf`),
 *   der Index enthält kein `crlf` und kein `mixed`. Binärdateien (Index `-text`, Attribut `-text`) und leere Dateien sind ausgenommen.
 *   `Projektdateien` (factory#170): jede Datei der geschlossenen Liste `PROJEKTDATEIEN` (vom Sync nicht geliefert, aber von einem Gate oder Kern-Skript unter festem Pfad gebraucht)
 *   existiert; geprüft wird nur das Vorhandensein (eine leere Datei zählt), nie der Inhalt. Der Fix nennt einmal die Vorlage aus der Quelle und je fehlender Datei mit Besonderheit deren Zusatz.
 *
 *   `Langfuse-Takt`: `.github/workflows/board-takt.yml` und `scripts/langfuse-takt.mjs` existieren (Ring kern-nach-entkopplung kommt per Sync); Hinweis, wenn das Factory-Board ein fremdes Repo führt;
 *   im Bezieher (Sync-Stand vorhanden) ist es eine Lücke, wenn kein Board das eigene Repo führt (der Takt legt dort kein Status-Ticket an, factory#202), und wenn sich das Ziel des Takts aus der Config nicht bestimmen lässt.
 *   `Gezielter Test` (factory#208): `struktur.endungen` außerhalb von JS/TS ohne `befehle.testGezielt` ist eine Lücke (der Standard `npx vitest run` kennt solche Tests nicht).
 *   `Required-Check-Quellen` (factory#148): jeder Kontext der Soll-Liste (`pflichtChecks` aus `voraussetzungenAus`: Ruleset-Spiegel vereinigt mit den Kern-Pflicht-Checks) hat genau eine Quelle unter `.github/workflows/`
 *   (die `name:`-Werte von Jobs und Schritten, gelesen vom Blockform-Leser workflow-blockform.mjs ohne `yaml`; `beansprucht` wie im Kern-Test required-check-shadowing). 0 oder mindestens 2 Quellen sind eine Lücke, eine nicht lesbare
 *   Workflow-Datei (Flow-Form, Anker, Alias, Tag, Merge-Schlüssel …), ein fehlender Ruleset-Spiegel oder eine leere Soll-Liste machen den Punkt nicht prüfbar. Spiegel, Workflows und Soll-Liste liest `pruefLauf` einmal und reicht sie herein.
 *   Der Punkt `Meldestelle` (factory#208) gehört nicht hierher: er braucht `gh` und steht in harness-doctor-meldestelle.mjs.
 *
 *   `Code-Scanning-Quellen` (factory#339): jedes Werkzeug aus `spiegel.codeScanning` hat eine Workflow-Quelle (CodeQL: `uses: github/codeql-action/analyze@`, jedes andere Werkzeug: `uses: github/codeql-action/upload-sarif@` in einer Datei, die den Namen als Wort nennt);
 *   ohne Quelle Lücke, nur CodeQL ohne Workflow nicht prüfbar (Default-Setup serverseitig). Grenze: Drittaktionen, ein SARIF-Upload per API und eine gequotete `uses:`-Form erkennt der Punkt nicht. Spiegel und Workflows reicht `pruefLauf` herein wie bei `Required-Check-Quellen`.
 *
 *   `CODEOWNERS-Spiegel` (factory#382): `.github/CODEOWNERS` führt genau die Gruppe `pflichtReview` von `.github/protected-paths.json` (ohne Gruppe die ganze Liste); fehlt eine der Dateien, meldet `Projektdateien` das.
 *
 *   `Leitplanken-Quelle` (factory#149): der Fitness-Anteil von harness-approval gegen die eigene Quelle des Beziehers (`.github/protected-paths.json` über `schutzlistenMuster`/`trifftLeitplanke`, `.github/CODEOWNERS`, die getrackten Dateien).
 *   Teilregeln (dieselben Funktionen `ankerFunde`, `agentsFunde` und `waechterAusserhalb` ruft der Kern-Wächter harness-approval), eine Lücke nennt alle Funde: (a) CODEOWNERS schützt genau die Pfadmenge der Pflicht-Review-Liste (ohne Gruppe der ganzen Quelle) und spiegelt deren Anker-Form; (b) die Quelle enthält `AGENTS.md` unverankert;
 *   (c) eine Datei mit dem Wächter-Marker als eigener Kommentarzeile liegt nur unter `test/harness/`; (d) keine Kopie der Pre-Flight-Kriterien außerhalb von `AGENTS.md`, `docs/adr/` und den Ankerdateien; (e) keine abgelöste Label-Mechanik außerhalb von `docs/adr/`.
 *   Die Muster stehen in leitplanken-muster.mjs. Fehlt die Quelle oder ist sie kein JSON, ist Git nicht lesbar oder der Index leer, ist der Punkt nicht prüfbar; fehlt CODEOWNERS bei vorhandener Quelle, ist es eine Lücke.
 *   Grenzen: (c) liest den Agenten-Kontext mit Scan-Endung und die getrackten `*.test.ts` unter `test/`, (d) und (e) nur den Agenten-Kontext mit Scan-Endung; der Marker gilt als `/*`-, `*`- oder `//`-Kommentarzeile (auch ein Codeblock in einer Doku-Seite, der den Marker so zeigt, ist ein Fund); ein umformulierter Begriff und eine ungetrackte Datei bleiben unsichtbar.
 *
 *   `Modell-Routing` (factory#150): der Fitness-Anteil von model-routing gegen die Claude-Code-Konfiguration des Beziehers (Funktionen in modell-routing-lib.mjs, dieselben ruft der Kern-Test model-routing). Teilregeln, eine Lücke nennt alle Funde:
 *   (a) jeder Projekt-Agent (Datei unter `.claude/agents/`, Pfad nicht im Besitz-Manifest) trägt `model:` aus `MODELL_ALIASE` (opus, sonnet, haiku, fable) und ein `effort:`; `inherit` und fehlende Werte sind Lücken;
 *   (b) kein harter Pin (`claude-<stufe>-<nr>`) in Agenten, Skills (Quelle und Zeiger), `.claude/settings.json` und Workflow-Skripten (`.js`, `.mjs`, `.ts` direkt in `.claude/workflows`, eine Ebene; Markdown, YAML und Unterordner dort bleiben ungeprüft); (c) jeder `name:` unter `.claude/agents` ist eindeutig, auch über die Besitz-Agenten hinweg, jede Datei hat einen;
 *   (d) `hauptchatModellBefunde(settings)` ist leer (fehlt `settings.json`, ist das eine Lücke); (e) die Tabelle „Projekt-Phase“ in `docs/model-routing.md` gleicht den Frontmatter ihrer Subagenten (ohne die Seite: OK mit Hinweis).
 *   `settings.json` kein JSON-Objekt, `.claude/agents` fehlt oder eine Agentendatei nicht lesbar: nicht prüfbar mit Fix; ein unlesbares Besitz-Manifest macht nur (a) nicht prüfbar. Ein Fund in einer prüfbaren Teilregel ist eine Lücke und nennt die nicht prüfbaren Teile.
 *   Grenzen: die Listen kommen aus dem Dateisystem (lokal zählen ungetrackte Dateien mit, ein CI-Checkout nur getrackte); `parseFrontmatter` liest flach; (e) nimmt Dateiname = `name` an; (b) liest nur `SKILL.md` je Skill; Effort wird nur auf Anwesenheit geprüft;
 *   ein neuer Alias braucht einen Factory-Release; der Punkt prüft die Claude-Code-Konfiguration, nicht die Modellwahl von Codex (docs/codex/einstieg.md).
 *
 *   `Workflow-Auslöser`: jeder Name in `on.workflow_run.workflows` ist der `name:` eines vorhandenen Workflows (Leser `blockformAusloeser`); eine nicht lesbare Form (`on:` als Flow-Mapping, Anker, Alias, Tag) macht den Punkt nicht prüfbar mit `datei:zeile`.
 *
 *   `Sammel-Check` (factory#401): jeder Workflow aus `sammelChecks` der Projekt-Config hat einen Sammel-Job mit `needs` auf alle anderen Jobs (außer Jobs, die selbst am Sammel-Job hängen), der mit `!cancelled()` läuft und bei einem roten oder abgebrochenen Bedarfsjob selbst rot wird (factory#413), und einen Alarm-Aufruf bei rotem main (harness-doctor-sammelcheck.mjs); ohne `sammelChecks` OK mit Hinweis.
 *
 * Nur Node-Builtins (der Wochenlauf hat kein `npm ci`); `git` und `existiert` sind injizierbar (Tests). Fehlt Git oder der Index, ist `Zeilenenden`
 * nicht prüfbar, `Root-Kontextdatei` wird trotzdem bewertet. Grenze: ein CI-Checkout sieht ungetrackte Dateien nicht, nur ein lokales `--pruefen`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MANIFEST_PFAD, manifestAusText, markerEnde, markerStart, PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "./besitz-lib.mjs";
import { parseFrontmatter } from "./docs-gen/markdown.mjs";
import { doppelteNamen, hatHartenPin, MODELL_ALIASE, hauptchatModellBefunde, projektAgentFunde, projektPhasenAbweichungen, routingPfade } from "./modell-routing-lib.mjs";
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { labelAus, ladeProjektConfig, langfuseZiel, PROJEKT_CONFIG, ROLLEN_PFADE, zielRepoFuer } from "./projekt-config-lib.mjs";
import { pflichtReviewMuster, schutzlistenMuster, trifftLeitplanke } from "./besitz-extraktion.mjs";
import { abgeloesteFundstellen, istScanDatei, istTestDatei, kriterienKopien, TIEFENUNABHAENGIG, waechterAusserhalb } from "./leitplanken-muster.mjs";
import { sammelCheckPunkt } from "./harness-doctor-sammelcheck.mjs";
import { gleichesRepo } from "./repo-form.mjs";
import { blockformAusloeser, quellenJeKontext } from "./workflow-blockform.mjs";
import { STANDARD_ENDUNGEN } from "./quellwurzeln-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { QUELL_VERZEICHNIS, ZEIGER_WURZEL } from "./skill-pfade.mjs";

/** Memory-Dateien im Root, deren Existenz das native Laden von AGENTS.md abschaltet; `~/.claude/CLAUDE.md` und Unterordner zählen nicht. */
export const BLOCKIERENDE_KONTEXTDATEIEN = ["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"];

/** Pfade, für die `eol=lf` auch dann gelten muss, wenn es die Datei noch nicht gibt (Hooks, Skills und Agenten dürfen nie CRLF bekommen). */
export const LF_BEISPIELE = [".claude/hooks/neu.js", `${ZEIGER_WURZEL}/neu/SKILL.md`, ".claude/agents/neu.md", `${QUELL_VERZEICHNIS}/neu/SKILL.md`];

const STRENG = [".claude/", ".agents/"];
const MAX_PFADE = 5;

/** Welche der blockierenden Kontextdateien liegen im Root `rootDir` (per `existiert`, auch ungetrackt)? */
export function blockierendeKontextdateien(rootDir, existiert = existsSync) {
  return BLOCKIERENDE_KONTEXTDATEIEN.filter((rel) => existiert(join(rootDir, rel)));
}

/**
 * Parst die `-z`-Ausgabe von `git check-attr -z eol -- <pfade>` (NUL-getrennte Tripel
 * pfad/attribut/wert) und liefert alle Pfade, deren `eol` NICHT `lf` ist.
 */
export function pfadeOhneLf(checkAttrZ) {
  const teile = checkAttrZ.split("\0");
  const ohneLf = [];
  for (let i = 0; i + 2 < teile.length; i += 3) {
    if (teile[i + 2] !== "lf") ohneLf.push(teile[i]);
  }
  return ohneLf;
}

/** Wie `pfadeOhneLf`, aber ein ausdrückliches `crlf` ist erlaubt: nur Pfade ganz ohne eol-Regel (`unspecified`, `unset`, `auto`) sind Funde. */
export function pfadeOhneEolRegel(checkAttrZ) {
  const teile = checkAttrZ.split("\0");
  const funde = [];
  for (let i = 0; i + 2 < teile.length; i += 3) {
    if (teile[i + 2] !== "lf" && teile[i + 2] !== "crlf") funde.push(teile[i]);
  }
  return funde;
}

/**
 * Parst `git ls-files --eol` (Zeilen `i/<index> w/<arbeitskopie> attr/<attr>\t<pfad>`) und
 * liefert die Pfade, deren Index-Zeilenende `crlf` oder `mixed` ist.
 */
export function pfadeMitCrlfImIndex(eolAusgabe) {
  const funde = [];
  for (const zeile of eolAusgabe.split("\n")) {
    const [kopf, pfad] = zeile.split("\t");
    if (pfad !== undefined && /^i\/(crlf|mixed)\b/.test(kopf)) funde.push(pfad);
  }
  return funde;
}

/** Textdateien aus `git ls-files --eol`: nicht binär (Index `-text`), nicht leer (`none`) und nicht ausdrücklich `-text` im Attribut. */
function textPfade(eolAusgabe) {
  const pfade = [];
  for (const zeile of eolAusgabe.split("\n")) {
    const [kopf, pfad] = zeile.split("\t");
    if (pfad === undefined || pfad === "") continue;
    const attribute = /attr\/(.*)$/.exec(kopf)?.[1].trim().split(/\s+/) ?? [];
    if (/^i\/(-text|none)\b/.test(kopf) || attribute.includes("-text")) continue;
    pfade.push(pfad);
  }
  return pfade;
}

const istStreng = (pfad) => STRENG.some((p) => pfad.startsWith(p));
const kurz = (pfade) => (pfade.length > MAX_PFADE ? `${pfade.slice(0, MAX_PFADE).join(", ")} (+${pfade.length - MAX_PFADE} weitere)` : pfade.join(", "));


/** Git-Aufruf im Bezieher (`rootDir`); `input` geht über stdin (Windows begrenzt die Kommandozeile). Wirft mit der ersten Fehlerzeile. */
export function gitStandard(rootDir) {
  return (args, input) => {
    const r = spawnSync("git", ["-C", rootDir, "-c", "core.quotepath=off", ...args], { encoding: "utf8", input, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw r.error;
    if (r.status !== 0) throw new Error((r.stderr ?? "").split("\n")[0] || `git ${args[0]} endete mit ${r.status}`);
    return r.stdout;
  };
}

function kontextPunkt(rootDir, existiert) {
  const gefunden = blockierendeKontextdateien(rootDir, existiert);
  if (gefunden.length === 0) {
    if (existiert(join(rootDir, "AGENTS.md"))) return gut("Root-Kontextdatei");
    return nichtPruefbar("Root-Kontextdatei", "keine AGENTS.md im Root: es gibt keine Kontextdatei, die geladen werden könnte", "AGENTS.md im Root des Projekts anlegen (die eine Kontextdatei) oder den Doctor im Projekt-Root starten, dann erneut prüfen");
  }
  return luecke(
    "Root-Kontextdatei",
    `${gefunden.join(", ")} liegt im Root und schaltet das native Laden von AGENTS.md ab`,
    "Inhalt in den Projekt-Block der AGENTS.md übernehmen, Datei entfernen (ungetrackte zählen mit)",
  );
}

function zeilenendenFunde(git) {
  const eol = git(["ls-files", "--eol"]);
  const text = textPfade(eol);
  if (eol.trim() === "") return null;
  const streng = [...text.filter(istStreng), ...LF_BEISPIELE];
  const lax = text.filter((p) => !istStreng(p));
  const ohneLf = pfadeOhneLf(git(["check-attr", "--stdin", "-z", "eol"], streng.join("\0")));
  const ohneRegel = lax.length ? pfadeOhneEolRegel(git(["check-attr", "--stdin", "-z", "eol"], lax.join("\0"))) : [];
  return { ohneLf, ohneRegel, crlf: pfadeMitCrlfImIndex(eol) };
}

function zeilenendenPunkt(git) {
  const fix = "`* text=auto eol=lf` in .gitattributes (Binärdateien `binary`), dann `git add --renormalize .` und committen";
  let funde;
  try {
    funde = zeilenendenFunde(git);
  } catch (e) {
    return nichtPruefbar("Zeilenenden", `Git nicht lesbar (${e instanceof Error ? e.message : String(e)})`, "in einem Git-Checkout mit installiertem git prüfen (git status), dann erneut prüfen");
  }
  if (funde === null) return nichtPruefbar("Zeilenenden", "keine getrackten Dateien im Index", "in einem Git-Checkout mit committeten Dateien prüfen, dann erneut prüfen");
  const teile = [];
  if (funde.ohneLf.length) teile.push(`ohne eol=lf unter .claude/ und .agents/: ${kurz(funde.ohneLf)}`);
  if (funde.ohneRegel.length) teile.push(`ohne eol-Regel: ${kurz(funde.ohneRegel)}`);
  if (funde.crlf.length) teile.push(`CRLF oder gemischt im Index: ${kurz(funde.crlf)}`);
  return teile.length ? luecke("Zeilenenden", teile.join("; "), fix) : gut("Zeilenenden");
}

const VORLAGE_FIX = "Vorlage aus der Quelle: Datei gleichen Pfads im Factory-Checkout des Syncs übernehmen und anpassen (Anleitung: Seite docs/erstbezug.md des Factory-Repos)";

/** Projektdateien, die der Sync nicht liefert, die aber ein Gate in `verify`, ein Kern-Skript oder ein Kern-Test unter festem Pfad braucht (geschlossene Liste; `fix` ist ein Zusatz zum Standard-Fix). */
export const PROJEKTDATEIEN = Object.freeze([
  { pfad: "AGENTS.md", fix: `mit den Zeilen ${markerStart("kern")} und ${markerEnde("kern")} (Kern-Block) sowie ${PROJEKT_BLOCK_START} und ${PROJEKT_BLOCK_ENDE} (Projekt-Block, der Sync weist sonst darauf hin) anlegen` },
  { pfad: PROJEKT_CONFIG },
  { pfad: ROLLEN_PFADE.ticketSkill, fix: `danach \`npm run skills:sync\`` },
  { pfad: "package.json", fix: `scripts und devDependencies der Quelle übernehmen, dann \`npm install\`, Lockfile committen` },
  { pfad: "tsconfig.json" },
  { pfad: "eslint.config.js" },
  { pfad: "eslint-suppressions.json", fix: `danach \`npx eslint . --prune-suppressions\`` },
  { pfad: "vite.config.ts" },
  { pfad: "scripts/docs-gen/config.json", fix: `schichten.layers auf die eigene Schicht-Definition zeigen lassen (Vorlage: scripts/layers.cjs der Quelle)` },
  { pfad: ".github/workflows/ci.yml" },
  { pfad: ".github/CODEOWNERS" },
  { pfad: ".github/protected-paths.json" },
  { pfad: "docs/referenz/befehle.md" },
  { pfad: "docs/referenz/anlaufstellen.md" },
]);

/** Punkt `Projektdateien`: jede Datei aus `PROJEKTDATEIEN` muss existieren (nur Vorhandensein, eine leere Datei zählt); jeder Zusatz-Fix bleibt sichtbar (nie gekürzt). */
export function projektdateienPunkt(rootDir, existiert) {
  const fehlt = PROJEKTDATEIEN.filter((d) => !existiert(join(rootDir, d.pfad)));
  if (fehlt.length === 0) return gut("Projektdateien");
  return luecke("Projektdateien", `fehlen ${fehlt.length}: ${fehlt.map((d) => d.pfad).join(", ")}`, [VORLAGE_FIX, ...fehlt.filter((d) => d.fix).map((d) => `${d.pfad}: ${d.fix}`)].join("; "));
}

/** Dateien des Langfuse-Takts: der Workflow (Ring `kern-nach-entkopplung`) und das Skript; ohne sie läuft weder Status-Ticket noch Sammelticket „Langfuse-Befunde (gesammelt)“. */
export const LANGFUSE_TAKT_DATEIEN = Object.freeze([".github/workflows/board-takt.yml", "scripts/langfuse-takt.mjs"]);

const TAKT_FIX = "den Sync erneut ausführen (`node scripts/factory-sync.mjs --quelle <Factory-Checkout> --tag <Tag>`, Anleitung: Seite docs/erstbezug.md des Factory-Repos): der Sync liefert beide Dateien, `.github/workflows/board-takt.yml` liegt im Ring kern-nach-entkopplung und gehört damit zum Besitz, den jeder Bezieher bekommt";

/** Die Config mit gefilterten `boards` (Nulleinträge der ungeprüften Config tolerieren), für `zielRepoFuer` und `langfuseZiel`. */
function ohneNullBoards(config) {
  return { ...config, boards: Array.isArray(config.boards) ? config.boards.filter((b) => b && typeof b === "object") : config.boards };
}

/**
 * Das Ziel-Repo des Takts (factory#202 L21): dieselbe Bestimmung wie der Board-Takt (`zielRepoFuer([labels.harness])`). Liefert `{ ziel }` (ein Repo, das nicht das eigene ist, sonst null)
 * oder `{ luecke: true }`, wenn sich kein Ziel bestimmen lässt (kein `labels.harness`, kein Repo). Ohne Config: kein Ziel, keine Lücke.
 */
function taktZiel(config) {
  if (!config || typeof config !== "object") return { ziel: null };
  try {
    const bereinigt = ohneNullBoards(config);
    const repo = zielRepoFuer([labelAus(config, "harness")], bereinigt);
    if (typeof repo !== "string") return { luecke: true };
    return { ziel: gleichesRepo(repo, config.repo) ? null : repo };
  } catch {
    return { luecke: true };
  }
}

/**
 * Punkt `Langfuse-Takt`: beide Dateien des Langfuse-Takts existieren (nur Vorhandensein, ohne Netz und ohne Secrets). Führt das Factory-Board
 * der Config ein fremdes Repo, bleibt der Punkt OK, nennt aber einen Hinweis: ohne Sync-Stand (Upstream), dass dort der Takt Status-Ticket, Harness- und Langfuse-Sammelticket pflegt (`nurWaechter` in board-takt.mjs);
 * im Bezieher (Sync-Stand vorhanden, factory#195), dass der Takt das Status-Ticket im eigenen Repo anlegt und dort das Langfuse-Sammelticket holt und nur Harness-Sammelticket und Quote bei dem fremden Repo bleiben (`bezieherTakt`);
 * führt im Bezieher kein Board das eigene Repo (`langfuseZiel` wirft), ist der Punkt eine Lücke, weil der Takt dort kein Status-Ticket anlegt (factory#202).
 */
export function langfuseTaktPunkt(rootDir, existiert, config) {
  const fehlt = LANGFUSE_TAKT_DATEIEN.filter((d) => !existiert(join(rootDir, d)));
  if (fehlt.length > 0) return luecke("Langfuse-Takt", `fehlen ${fehlt.length}: ${fehlt.join(", ")}`, TAKT_FIX);
  const { ziel: fremd, luecke: keinZiel } = taktZiel(config);
  if (keinZiel) return luecke("Langfuse-Takt", "das Ziel-Repo des Board-Takts lässt sich aus der Config nicht bestimmen", "`labels.harness` und ein Board mit Rolle factory in `boards` der Projekt-Config eintragen (der Takt wählt sein Ziel wie `zielRepoFuer` aus diesen beiden)");
  const bezieher = istBezieher(rootDir);
  if (config && typeof config === "object" && bezieher) {
    try {
      langfuseZiel(ohneNullBoards(config), { bezieher: true }); // dieselbe Wahl wie `bezieherTakt`: wirft sie, legt der Takt kein Status-Ticket an
    } catch (e) {
      return luecke("Langfuse-Takt", String(e instanceof Error ? e.message : e).split("\n")[0], "ein Board in `boards` der Projekt-Config muss das eigene Repo führen (`boards[].repo` weglassen oder gleich `repo`)");
    }
  }
  if (fremd !== null && bezieher) {
    return gut("Langfuse-Takt", `das Factory-Board führt ${fremd}: der Takt legt das Status-Ticket „Langfuse-Status überprüfen“ im eigenen Repo an und holt dort das Langfuse-Sammelticket, Harness-Sammelticket und Quote pflegt der Takt von ${fremd}`);
  }
  return fremd === null ? gut("Langfuse-Takt") : gut("Langfuse-Takt", `das Factory-Board führt ${fremd}: dort pflegt der Takt Status-Ticket, Harness- und Langfuse-Sammelticket, hier läuft nur der Board-Wächter`);
}

/** Die Config für den Langfuse-Takt-Punkt: ungeprüft gelesen, bei Fehler null (der Punkt braucht sie nur für den Hinweis). */
function configOderNull(rootDir) {
  try {
    return ladeProjektConfig({ rootDir, pruefen: false });
  } catch {
    return null;
  }
}

/**
 * Punkt `Gezielter Test` (factory#208): `struktur.endungen` mit einer Endung außerhalb der JS/TS-Familie (`STANDARD_ENDUNGEN`) braucht `befehle.testGezielt`, weil der Standard
 * `npx vitest run` nur JS/TS-Tests kennt; ohne Befehl ist es eine Lücke. Fehlende Config, fehlende oder kaputte Endungen bedeuten Standard (OK). Pur.
 */
export function gezielterTestPunkt(config) {
  const endungen = config?.struktur?.endungen;
  const fremd = Array.isArray(endungen) ? endungen.filter((e) => !STANDARD_ENDUNGEN.includes(e)) : [];
  const befehl = config?.befehle?.testGezielt;
  if (fremd.length === 0 || (typeof befehl === "string" && befehl.trim() !== "")) return gut("Gezielter Test");
  return luecke("Gezielter Test", `struktur.endungen nennt ${fremd.join(", ")} (außerhalb von JS/TS), aber befehle.testGezielt fehlt: der Standard „npx vitest run“ kennt solche Tests nicht`, `befehle.testGezielt in ${PROJEKT_CONFIG} auf die Befehlszeile des Test-Läufers setzen (der Läufer hängt die Pfade an: node scripts/gate-befehl.mjs testGezielt <datei>)`);
}

/** Punkt `Required-Check-Quellen` (factory#148): jeder Kontext aus `pflichtChecks` hat genau eine Quelle in `workflows` (`[{ pfad, text }]`). Pur: liest nichts selbst. */
export function requiredCheckQuellenPunkt({ spiegel, workflows, pflichtChecks, vorAbbruch = false }) {
  const punkt = "Required-Check-Quellen";
  if (vorAbbruch) {
    return nichtPruefbar(punkt, "Config bzw. Ruleset-Spiegel nicht geladen (Abbruch oben): die Soll-Liste der Required-Checks ist unbekannt", "erst den Config- bzw. Spiegel-Fehler oben beheben, dann erneut prüfen");
  }
  if (spiegel === undefined || spiegel === null) {
    return nichtPruefbar(punkt, "kein Ruleset-Spiegel (`rulesetSpiegel` fehlt): die Soll-Liste der Required-Checks ist unbekannt", "`rulesetSpiegel` in der Projekt-Config setzen und die Vorlage `.github/ruleset-main-schutz.json` der Quelle übernehmen (Anleitung: Seite docs/erstbezug.md des Factory-Repos), dann erneut prüfen");
  }
  if (!Array.isArray(pflichtChecks) || pflichtChecks.length === 0) {
    return nichtPruefbar(punkt, "die Soll-Liste der Required-Checks ist leer", "`requiredChecks` im Ruleset-Spiegel eintragen (Vorlage der Quelle: `.github/ruleset-main-schutz.json`), dann erneut prüfen");
  }
  const { treffer, nichtLesbar } = quellenJeKontext(workflows ?? [], pflichtChecks);
  const abweichend = [...treffer].filter(([, orte]) => orte.length !== 1);
  const nichtLesbarText = nichtLesbar.map((f) => `${f.pfad}:${f.zeile} ${f.konstrukt}`);
  const befund = abweichend.map(([k, orte]) => `„${k}“: ${orte.length} Quellen${orte.length ? ` (${kurz(orte)})` : ""}`).join("; ");
  if (abweichend.some(([, orte]) => orte.length >= 2)) {
    return luecke(punkt, `${befund}${nichtLesbar.length ? `; nicht lesbar: ${kurz(nichtLesbarText)}` : ""}`, "den gleichnamigen Doppelgänger-Job oder -Schritt umbenennen oder entfernen (ein Required-Check-Name darf nur eine Quelle haben: ein gleichnamiger Fake-Job überschriebe den echten Check)");
  }
  if (nichtLesbar.length > 0) {
    return nichtPruefbar(punkt, `Workflow-Datei in einer Form, die der Blockform-Leser nicht liest: ${kurz(nichtLesbarText)}`, "in Blockform schreiben (Mappings und Listen eingerückt, ohne Flow-Klammern, Anker, Aliasse, Tags, Merge-Schlüssel), dann erneut prüfen");
  }
  if (abweichend.length > 0) {
    return luecke(punkt, befund, "den Job wie im Ruleset benennen (`name:`) oder Ruleset und Spiegel nachziehen: ein Required-Check ohne Quelle hängt ewig auf „erwartet“");
  }
  return gut(punkt);
}

const CS_PUNKT = "Code-Scanning-Quellen";
const CS_FIX = `Sicherheits-Modul wählen (\`module\` in \`${PROJEKT_CONFIG}\`) oder Workflow mit SARIF-Upload ergänzen, sonst das Werkzeug aus Ruleset und Spiegel nehmen (Pre-Flight)`;
const CS_ANALYZE = "uses: github/codeql-action/analyze@";
const CS_UPLOAD = "uses: github/codeql-action/upload-sarif@";
const WORT_ZEICHEN = /[a-z0-9_-]/;

/** Zeilen einer Workflow-Datei, getrimmt, ein führendes `- ` der Listenform entfernt (eine Kommentarzeile `# uses: …` beginnt mit `#` und passt auf kein Muster). */
const csZeilen = (text) => text.split("\n").map((z) => z.trim().replace(/^- /, ""));
/** Steht `name` (klein geschrieben) als ganzes Wort in `text` (klein geschrieben)? Wortzeichen sind Buchstaben, Ziffern, `_` und `-`. */
function alsWort(text, name) {
  for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) {
    if (!WORT_ZEICHEN.test(text[i - 1] ?? " ") && !WORT_ZEICHEN.test(text[i + name.length] ?? " ")) return true;
  }
  return false;
}
/** Hat `workflows` eine Quelle für das Werkzeug `tool`: `analyze` für CodeQL, sonst `upload-sarif` in einer Datei, die den Namen als Wort nennt? */
function csQuelle(workflows, tool) {
  const klein = tool.toLowerCase();
  return workflows.some((w) => {
    const zeilen = csZeilen(w.text);
    if (klein === "codeql") return zeilen.some((z) => z.startsWith(CS_ANALYZE));
    return zeilen.some((z) => z.startsWith(CS_UPLOAD)) && alsWort(w.text.toLowerCase(), klein);
  });
}

/**
 * Punkt `Code-Scanning-Quellen` (factory#339): jedes Werkzeug aus `spiegel.codeScanning` hat im Repo eine Workflow-Quelle in `workflows` (`[{ pfad, text }]`): CodeQL einen Schritt
 * `uses: github/codeql-action/analyze@`, jedes andere Werkzeug einen Schritt `uses: github/codeql-action/upload-sarif@` in einer Datei, die den Werkzeugnamen als Wort nennt (Groß-/Kleinschreibung egal).
 * Ein Werkzeug ohne Quelle ist eine Lücke (das Ruleset wartete ewig auf ein Ergebnis, das nie kommt); nur CodeQL ohne Workflow ist nicht prüfbar, weil das Default-Setup serverseitig läuft. Ohne Spiegel oder
 * nach Abbruch nicht prüfbar, ein Spiegel ohne `codeScanning` ist OK. Grenze: Drittaktionen, ein SARIF-Upload per API und eine gequotete `uses:`-Form erkennt der Punkt nicht (dann Lücke oder nicht prüfbar, nie still grün). Pur.
 */
export function codeScanningQuellenPunkt({ spiegel, workflows, vorAbbruch = false }) {
  if (vorAbbruch || spiegel === undefined || spiegel === null) {
    return nichtPruefbar(CS_PUNKT, "Config bzw. Ruleset-Spiegel nicht geladen: die Soll-Liste der Code-Scanning-Werkzeuge ist unbekannt", "erst den Config- bzw. Spiegel-Fehler oben beheben (`rulesetSpiegel` in der Projekt-Config), dann erneut prüfen");
  }
  const werkzeuge = (Array.isArray(spiegel.codeScanning) ? spiegel.codeScanning : []).map((e) => e?.tool).filter((t) => typeof t === "string" && t !== "");
  const ohne = werkzeuge.filter((t) => !csQuelle(workflows ?? [], t));
  const echt = ohne.filter((t) => t.toLowerCase() !== "codeql");
  if (echt.length > 0) return luecke(CS_PUNKT, `${echt.map((t) => `„${t}“`).join(", ")}: keine Workflow-Quelle mit SARIF-Upload (ein Ruleset-Werkzeug ohne Quelle blockiert jeden PR ewig)`, CS_FIX);
  if (ohne.length > 0) return nichtPruefbar(CS_PUNKT, "CodeQL: kein Workflow mit `github/codeql-action/analyze` (das Default-Setup läuft serverseitig und ist aus den Dateien nicht belegbar)", `unter Einstellungen > Code security prüfen, ob das Default-Setup aktiv ist, oder das Sicherheits-Modul \`codeql\` wählen (\`module\` in \`${PROJEKT_CONFIG}\`)`);
  return gut(CS_PUNKT);
}

/** Die Dateipunkte des Doctors in fester Reihenfolge (die eine Quelle; `pruefeDateien` liefert genau diese Punkte, nie weniger). */
export const DATEI_PUNKTE = Object.freeze(["Root-Kontextdatei", "Zeilenenden", "Projektdateien", "Langfuse-Takt", "Gezielter Test", "Required-Check-Quellen", "Code-Scanning-Quellen", "Workflow-Auslöser", "CODEOWNERS-Spiegel", "Leitplanken-Quelle", "Modell-Routing", "Sammel-Check"]);

/**
 * Die Dateipunkte `DATEI_PUNKTE`. `spiegel` (Ruleset-Spiegel), `workflows` (`[{ pfad, text }]`) und `pflichtChecks` (Soll-Liste) liest der Aufrufer (`pruefLauf`) einmal und reicht sie herein;
 * ohne sie ist `Required-Check-Quellen` nicht prüfbar.
 */
export function pruefeDateien({ rootDir, git = gitStandard(rootDir), existiert = existsSync, config = configOderNull(rootDir), lies = dateiOderNull(rootDir), liste = verzeichnisOderNull(rootDir), spiegel, workflows = [], pflichtChecks = [], vorAbbruch = false }) {
  const punkte = {
    "Root-Kontextdatei": () => kontextPunkt(rootDir, existiert),
    Zeilenenden: () => zeilenendenPunkt(git),
    Projektdateien: () => projektdateienPunkt(rootDir, existiert),
    "Langfuse-Takt": () => langfuseTaktPunkt(rootDir, existiert, config),
    "Gezielter Test": () => gezielterTestPunkt(config),
    "Required-Check-Quellen": () => requiredCheckQuellenPunkt({ spiegel, workflows, pflichtChecks, vorAbbruch }),
    "Code-Scanning-Quellen": () => codeScanningQuellenPunkt({ spiegel, workflows, vorAbbruch }),
    "Workflow-Auslöser": () => workflowAusloeserPunkt({ workflows }),
    "CODEOWNERS-Spiegel": () => codeownersSpiegelPunkt(lies),
    "Leitplanken-Quelle": () => leitplankenQuellePunkt({ git, lies }),
    "Modell-Routing": () => modellRoutingPunkt({ lies, liste }),
    "Sammel-Check": () => sammelCheckPunkt({ config, workflows, vorAbbruch }),
  };
  return DATEI_PUNKTE.map((p) => punkte[p]());
}

/** Der Standard-Leser: Text der Datei unter `rootDir` oder `null`, wenn sie fehlt oder nicht lesbar ist (nie ein Wurf; `existiert` gilt hier nicht, der Lesefehler genügt). */
const dateiOderNull = (rootDir) => (rel) => {
  try {
    return readFileSync(join(rootDir, rel), "utf8");
  } catch {
    return null;
  }
};

/** Der Standard-Lister: Namen im Ordner unter `rootDir` oder `null`, wenn er fehlt oder nicht lesbar ist (nie ein Wurf). */
const verzeichnisOderNull = (rootDir) => (rel) => {
  try {
    return readdirSync(join(rootDir, rel));
  } catch {
    return null;
  }
};

/** Pfad-Normalform eines Schutz-Musters: führendes `/` weg, ab dem ersten `*` abgeschnitten (CODEOWNERS `/scripts/check-*.mjs` und die Substring-Form landen beide auf `scripts/check-`). Grenze: Muster mit gleichem Präfix vor dem ersten `*` gelten als gleich. */
export const normalizeProtected = (p) => p.replace(/^\//, "").replace(/\*.*$/, "");

/** Die Muster aus CODEOWNERS-Text, normalisiert (jeweils vor dem `@owner`; Kommentare und Leerzeilen zählen nicht). */
export function codeownersPaths(text) {
  return new Set(codeownersMuster(text).map(normalizeProtected));
}

/** Die rohen Muster aus CODEOWNERS-Text (jeweils vor dem `@owner`, nicht normalisiert; `#`-Zeilen zählen nicht). */
export function codeownersMuster(text) {
  const muster = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.trim().match(/^(\S+)\s+@\S+/);
    if (m && !m[1].startsWith("#")) muster.push(m[1]);
  }
  return muster;
}

/**
 * Spiegel-Probleme (factory#348, factory#382): CODEOWNERS führt genau die Pflicht-Review-Liste (Gruppe `pflichtReview`, ohne Gruppe die ganze Quelle).
 * Meldet eine Gruppe ohne `/.github/CODEOWNERS` (Selbstschutz), ein Soll-Muster ohne CODEOWNERS-Zeile und eine CODEOWNERS-Zeile außerhalb des Soll;
 * nur Pfade, nie Owner-Handles. Kaputtes JSON oder eine Gruppe, die keine Liste ist: ein Problem mit Grund, kein Wurf. Pur.
 */
export function codeownersSpiegelProbleme(quelleText, codeownersText) {
  const sollMuster = pflichtReviewMuster(quelleText);
  if (sollMuster === null) return [".github/protected-paths.json nicht lesbar oder pflichtReview ist keine Liste"];
  const hatGruppe = JSON.parse(quelleText).pflichtReview !== undefined; // gültiges JSON: `pflichtReviewMuster` lieferte sonst null
  const probleme = [];
  if (hatGruppe && !trifftLeitplanke(".github/CODEOWNERS", sollMuster)) probleme.push("Gruppe pflichtReview ohne /.github/CODEOWNERS");
  const sollNorm = new Set(sollMuster.map(normalizeProtected));
  const istNorm = codeownersPaths(codeownersText);
  for (const p of sollNorm) if (!istNorm.has(p)) probleme.push(`nicht in CODEOWNERS: ${p}`);
  for (const p of istNorm) if (!sollNorm.has(p)) probleme.push(`nicht in der Pflicht-Review-Liste: ${p}`);
  return probleme;
}

const SPIEGEL_PUNKT = "CODEOWNERS-Spiegel";

/** Punkt `CODEOWNERS-Spiegel` (factory#382): `.github/CODEOWNERS` gleicht der Pflicht-Review-Liste von `.github/protected-paths.json` ab. Fehlt eine der Dateien (oder ist unlesbar), steht kein Befund hier: `Projektdateien` meldet das. `lies(rel)` liefert den Text oder `null`. */
export function codeownersSpiegelPunkt(lies) {
  const quelle = lies(".github/protected-paths.json");
  const codeowners = lies(".github/CODEOWNERS");
  if (quelle === null || codeowners === null) return gut(SPIEGEL_PUNKT, "Datei fehlt oder ist nicht lesbar (Punkt Projektdateien)");
  const probleme = codeownersSpiegelProbleme(quelle, codeowners);
  if (probleme.length === 0) return gut(SPIEGEL_PUNKT);
  return luecke(SPIEGEL_PUNKT, probleme.join("; "), `.github/CODEOWNERS und die Gruppe pflichtReview in .github/protected-paths.json (ohne Gruppe: die ganze Liste) gleichziehen, jede Zeile \`<muster> @<owner>\`; Vorlage: .github/CODEOWNERS der Quelle`);
}

/* Punkt `Leitplanken-Quelle` (factory#149): der Fitness-Anteil von harness-approval gegen die eigene Quelle des Beziehers. Teilregeln (a) bis (e) siehe Kopfkommentar; jede Funktion liefert ihre Funde mit Präfix. */
const LQ_PUNKT = "Leitplanken-Quelle";
const QUELLE_PFAD = ".github/protected-paths.json";
const LQ_FIXE = {
  a: "die Zeilen in .github/CODEOWNERS und die Pflicht-Review-Liste der Quelle gleichziehen (unverankert ist nur AGENTS.md, sonst mit führendem /)",
  b: "in .github/protected-paths.json AGENTS.md ohne führenden / eintragen (ein /AGENTS.md trifft in CODEOWNERS keine modul-lokale Datei)",
  c: "die Wächter-Datei nach test/harness/ verschieben oder den Marker entfernen (nur dort ist sie geschützt)",
  d: "die ausgeschriebene Kriterienliste durch einen Verweis auf AGENTS.md ersetzen",
  e: "die abgelöste Mechanik aus der Datei entfernen (Historie gehört nur in docs/adr/)",
};
const unverankert = (muster) => muster.filter((m) => !m.startsWith("/")).sort();

/** (a): Menge laut `codeownersSpiegelProbleme`, dazu die Anker-Form: unverankert in CODEOWNERS genau die der Pflicht-Review-Liste, und jeder unverankerte Quell-Eintrag steht in TIEFENUNABHAENGIG. Pur. */
export function ankerFunde(quelleText, codeownersText, roh) {
  const funde = codeownersSpiegelProbleme(quelleText, codeownersText);
  const soll = unverankert(pflichtReviewMuster(quelleText) ?? []);
  const ist = unverankert(codeownersMuster(codeownersText));
  if (soll.join("\n") !== ist.join("\n")) funde.push(`Anker-Form: CODEOWNERS unverankert [${ist.join(", ")}], Pflicht-Review-Liste [${soll.join(", ")}]`);
  for (const p of unverankert(roh)) if (!TIEFENUNABHAENGIG.includes(p)) funde.push(`unverankerter Eintrag ${p} der Quelle ist nicht bewusst tiefen-unabhängig`);
  return funde.map((f) => `(a) ${f}`);
}

/** (b): die Quelle enthält `AGENTS.md` unverankert und nicht `/AGENTS.md`. Pur. */
export function agentsFunde(roh) {
  const funde = [];
  if (!roh.includes("AGENTS.md")) funde.push("(b) AGENTS.md fehlt unverankert in der Quelle");
  if (roh.includes("/AGENTS.md")) funde.push("(b) /AGENTS.md ist root-verankert und trifft keine modul-lokale AGENTS.md");
  return funde;
}

/** (c) bis (e) über die getrackten Dateien: `scan` ist Pfad → Text des Agenten-Kontexts, `tests` Pfad → Text der getrackten `*.test.ts` unter `test/`. Pur. */
export function textFunde(scan, tests) {
  return [...waechterAusserhalb({ ...scan, ...tests }).map((f) => `(c) ${f}`), ...kriterienKopien(scan).map((f) => `(d) ${f}`), ...abgeloesteFundstellen(scan).map((f) => `(e) ${f}`)];
}

/** Liest die Pfade in `pfade` (übersprungen: nicht lesbar) zu Pfad → Text. */
function lesePfade(pfade, lies) {
  const aus = {};
  for (const p of pfade) {
    const text = lies(p);
    if (text !== null) aus[p] = text;
  }
  return aus;
}

/** Die getrackten Pfade; `null`, wenn Git nicht lesbar ist oder der Index leer bleibt (nie still grün). */
function getrackte(git) {
  try {
    const pfade = git(["ls-files", "-z"]).split("\0").filter(Boolean);
    return pfade.length > 0 ? pfade : null;
  } catch {
    return null;
  }
}

const lqFix = (funde) => ["a", "b", "c", "d", "e"].filter((k) => funde.some((f) => f.startsWith(`(${k})`))).map((k) => LQ_FIXE[k]).join("; ");

/** Punkt `Leitplanken-Quelle`: `git` wie bei `Zeilenenden`, `lies(rel)` liefert Text oder `null`. */
export function leitplankenQuellePunkt({ git, lies }) {
  const quelle = lies(QUELLE_PFAD);
  if (quelle === null) return nichtPruefbar(LQ_PUNKT, `${QUELLE_PFAD} fehlt oder ist nicht lesbar`, `${QUELLE_PFAD} anlegen (Gruppe→Pfade, Vorlage: die Quelle), dann erneut prüfen`);
  const roh = schutzlistenMuster(quelle);
  if (roh === null) return nichtPruefbar(LQ_PUNKT, `${QUELLE_PFAD} ist kein gültiges JSON`, `${QUELLE_PFAD} als JSON (Gruppe→Pfade) reparieren, dann erneut prüfen`);
  const pfade = getrackte(git);
  if (pfade === null) return nichtPruefbar(LQ_PUNKT, "Git nicht lesbar oder kein getrackter Index", "den Doctor im Git-Checkout des Projekts starten (git ls-files muss laufen), dann erneut prüfen");
  const codeowners = lies(".github/CODEOWNERS");
  if (codeowners === null) return luecke(LQ_PUNKT, ".github/CODEOWNERS fehlt", ".github/CODEOWNERS anlegen: eine Zeile `<muster> @<owner>` je Eintrag der Pflicht-Review-Liste");
  const scan = lesePfade(pfade.filter(istScanDatei), lies);
  // Der Filter begrenzt nur die Lesemenge; maßgeblich ist derselbe istTestDatei in waechterAusserhalb.
  const tests = lesePfade(pfade.filter(istTestDatei), lies);
  const funde = [...ankerFunde(quelle, codeowners, roh), ...agentsFunde(roh), ...textFunde(scan, tests)];
  return funde.length === 0 ? gut(LQ_PUNKT) : luecke(LQ_PUNKT, funde.join("; "), lqFix(funde));
}

/* Punkt `Modell-Routing` (factory#150): der Fitness-Anteil von model-routing gegen die Claude-Code-Konfiguration des Beziehers. Teilregeln (a) bis (e) siehe Kopfkommentar;
 * die Prüffunktionen stehen in modell-routing-lib.mjs (dieselben ruft der Kern-Test). Jede Teilregel liefert `{ funde, offen, hinweise }`; `offen` sind `{ grund, fix }` der nicht prüfbaren Teile. */
const MR_PUNKT = "Modell-Routing";
const MR_AGENTEN = ".claude/agents";
const MR_SETTINGS = ".claude/settings.json";
const MR_DOKU = "docs/model-routing.md";
const ALIAS_TEXT = MODELL_ALIASE.join(", ");
const MR_FIXE = {
  a: "im Frontmatter jedes Projekt-Agenten unter .claude/agents/ (nicht im Besitz-Manifest) `model:` aus " + ALIAS_TEXT + " und ein `effort:` (nicht inherit) setzen; Liste auf der Seite docs/model-routing.md des Factory-Repos",
  b: "feste Modell-IDs (claude-<stufe>-<nr>) in Agenten, Skills, .claude/settings.json und Workflow-Skripten (.js, .mjs, .ts direkt in .claude/workflows, eine Ebene) durch den Alias (" + ALIAS_TEXT + ") ersetzen",
  c: "jedem Agenten unter .claude/agents/ einen eigenen `name:` geben (auch gegenüber den mitgelieferten Agenten eindeutig)",
  d: ".claude/settings.json anlegen oder korrigieren: `model` genau `sonnet`, kein env-, Effort- oder Cache-TTL-Schlüssel, der es überstimmt",
  e: "Alias und Effort der Tabelle Projekt-Phase in docs/model-routing.md und das Frontmatter des Subagenten gleichziehen",
};
const mrFix = (funde) => ["a", "b", "c", "d", "e"].filter((k) => funde.some((f) => f.startsWith(`(${k})`))).map((k) => MR_FIXE[k]).join("; ");
const MR_LEER = { funde: [], offen: [], hinweise: [] };
const MR_MANIFEST_FIX = `${MANIFEST_PFAD} aus Git oder per Sync von einem Factory-Tag wiederherstellen, dann erneut prüfen`;

/** Alle `*.md` unter `.claude/agents` als `[{ pfad, text }]`; `null`, wenn der Ordner fehlt. Nicht lesbare Dateien landen in `unlesbar`. */
function mrAgenten(lies, liste) {
  const namen = liste(MR_AGENTEN);
  if (namen === null) return null;
  const agenten = [];
  const unlesbar = [];
  for (const n of namen.filter((f) => f.endsWith(".md"))) {
    const pfad = `${MR_AGENTEN}/${n}`;
    const text = lies(pfad);
    if (text === null) unlesbar.push(pfad);
    else agenten.push({ pfad, text });
  }
  return { agenten, unlesbar };
}

/** (a): jeder Projekt-Agent (Pfad nicht im Besitz-Manifest) hat `model:` aus der Alias-Liste und ein `effort:`. Ohne lesbares Manifest nicht prüfbar. */
function mrTeilA(agenten, lies) {
  const m = manifestAusText(lies(MANIFEST_PFAD));
  if (m.fehler) return { ...MR_LEER, offen: [{ grund: `(a) ${m.text}: ob ein Agent zum Projekt gehört, ist unbekannt`, fix: MR_MANIFEST_FIX }] };
  const besitz = new Set(m.manifest.eintraege.map((e) => e?.pfad));
  const funde = agenten.filter((a) => !besitz.has(a.pfad)).flatMap((a) => projektAgentFunde(parseFrontmatter(a.text), a.pfad));
  return { ...MR_LEER, funde };
}

/** (b): kein harter Pin in den Routing-Dateien (Agenten, Skills, settings.json, Workflows). */
function mrTeilB(lies, liste) {
  const funde = routingPfade(liste).filter((p) => hatHartenPin(lies(p) ?? "")).map((p) => `(b) ${p}`);
  return { ...MR_LEER, funde };
}

/** (c): jeder `name:` unter `.claude/agents` ist eindeutig, auch über die Besitz-Agenten hinweg. */
const mrTeilC = (agenten) => ({ ...MR_LEER, funde: doppelteNamen(agenten.map((a) => ({ pfad: a.pfad, name: parseFrontmatter(a.text).name }))) });

/** (d): `hauptchatModellBefunde` der Settings; eine fehlende Datei ist ein Fund, ein Nicht-JSON-Objekt nicht prüfbar. */
function mrTeilD(lies) {
  const text = lies(MR_SETTINGS);
  if (text === null) return { ...MR_LEER, funde: [`(d) ${MR_SETTINGS} fehlt`] };
  let settings;
  try {
    settings = JSON.parse(text);
  } catch {
    settings = null;
  }
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) return { ...MR_LEER, offen: [{ grund: `(d) ${MR_SETTINGS} ist kein JSON-Objekt`, fix: `${MR_SETTINGS} als JSON-Objekt reparieren, dann erneut prüfen` }] };
  return { ...MR_LEER, funde: hauptchatModellBefunde(settings).map((f) => `(d) ${f}`) };
}

/** (e): die Tabelle „Projekt-Phase“ in `docs/model-routing.md` gleicht den Frontmatter ihrer Subagenten. Ohne die Seite gibt es nichts zu prüfen (Hinweis). */
function mrTeilE(lies) {
  const doku = lies(MR_DOKU);
  if (doku === null) return { ...MR_LEER, hinweise: [`${MR_DOKU} fehlt: (e) ohne Prüfgegenstand`] };
  const fmVon = (p) => {
    const t = lies(p);
    return t === null ? null : parseFrontmatter(t);
  };
  return { ...MR_LEER, funde: projektPhasenAbweichungen(doku, fmVon).map((f) => `(e) ${f}`) };
}

/** Punkt `Modell-Routing`: `lies(rel)` liefert Text oder `null`, `liste(ordner)` die Namen im Ordner oder `null`. Nie ein Wurf, nie still grün. */
export function modellRoutingPunkt({ lies, liste }) {
  const a = mrAgenten(lies, liste);
  const ohneOrdner = { ...MR_LEER, offen: [{ grund: `${MR_AGENTEN} fehlt oder ist nicht lesbar: (a) und (c) nicht prüfbar`, fix: `${MR_AGENTEN} anlegen (die Agenten des Projekts und die mitgelieferten) oder den Doctor im Projekt-Root starten, dann erneut prüfen` }] };
  const offenAgenten = (a?.unlesbar ?? []).map((p) => ({ grund: `${p} nicht lesbar`, fix: `${p} lesbar machen oder entfernen, dann erneut prüfen` }));
  // Rangfolge: (b), (d) und (e) brauchen den Ordner nicht und laufen auch ohne ihn.
  const teile = a === null ? [ohneOrdner, mrTeilB(lies, liste), mrTeilD(lies), mrTeilE(lies)] : [mrTeilA(a.agenten, lies), mrTeilB(lies, liste), mrTeilC(a.agenten), mrTeilD(lies), mrTeilE(lies), { ...MR_LEER, offen: offenAgenten }];
  const funde = teile.flatMap((t) => t.funde);
  const offen = teile.flatMap((t) => t.offen);
  const hinweise = teile.flatMap((t) => t.hinweise);
  const offenGrund = offen.map((o) => o.grund).join("; ");
  const offenFix = offen.map((o) => o.fix).join("; ");
  if (funde.length > 0) return luecke(MR_PUNKT, [...funde, ...(offen.length > 0 ? [`nicht prüfbar: ${offenGrund}`] : [])].join("; "), [mrFix(funde), offenFix].filter(Boolean).join("; "));
  if (offen.length > 0) return nichtPruefbar(MR_PUNKT, offenGrund, offenFix);
  return gut(MR_PUNKT, hinweise.length > 0 ? hinweise.join("; ") : undefined);
}

/* Punkt `Workflow-Auslöser`: gelesen vom Blockform-Leser `blockformAusloeser` (workflow-blockform.mjs, ohne `yaml`: der Wochenlauf hat kein `npm ci`); Flow-Liste `["CI"]` oder Blockliste `- CI` unter `workflows`.
 * Eine Datei in nicht lesbarer Form (`on:` als Flow-Mapping, Anker, Alias, Tag, mehrzeilige Flow-Liste) macht den Punkt NICHT PRÜFBAR mit `datei:zeile`, nie „kein workflow_run“ (L20). */
const AUSLOESER_PUNKT = "Workflow-Auslöser";

/** Punkt `Workflow-Auslöser`: `workflows` ist `[{ pfad, text }]`. Pur. */
export function workflowAusloeserPunkt({ workflows }) {
  const gelesen = [];
  const nichtLesbar = [];
  for (const w of workflows ?? []) {
    const pfad = w.pfad.replaceAll("\\", "/");
    const r = blockformAusloeser(w.text);
    if (r.fehler) nichtLesbar.push(`${pfad}:${r.fehler.zeile} ${r.fehler.konstrukt}`);
    else gelesen.push({ pfad, name: r.name, ausloeser: r.ausloeser });
  }
  if (nichtLesbar.length > 0) {
    return nichtPruefbar(AUSLOESER_PUNKT, `Workflow-Datei in einer Form, die der Blockform-Leser nicht liest: ${kurz(nichtLesbar)}`, "in Blockform schreiben (`on:`, `workflow_run:` und `workflows:` als eingerückte Mappings und Listen, ohne Flow-Mapping, Anker, Alias, Tag), dann erneut prüfen");
  }
  const vorhanden = new Set(gelesen.map((w) => w.name).filter((n) => n !== null));
  const fehlend = gelesen.flatMap((w) => w.ausloeser.filter((n) => !vorhanden.has(n)).map((n) => ({ von: w.pfad.split("/").at(-1), name: n })));
  if (fehlend.length === 0) return gut(AUSLOESER_PUNKT);
  const befund = fehlend.map((f) => `${f.von} wartet auf „${f.name}“, kein Workflow heißt so`).join("; ");
  const fix = fehlend.map((f) => `einen Workflow mit \`name: ${f.name}\` anlegen oder den Auslöser in ${f.von} auf einen vorhandenen Namen ändern`).join("; ");
  return luecke(AUSLOESER_PUNKT, befund, `${fix}; sonst startet der Auslöser nie`);
}
