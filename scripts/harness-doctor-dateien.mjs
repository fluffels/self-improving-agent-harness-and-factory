/* Harness-Doctor, Dateipunkte (factory#94, ADR 0022): sechs Kern-Regeln gegen die Projektdateien des Beziehers, je Punkt `OK`, `LÜCKE` oder
 * `NICHT PRÜFBAR` (nie still grün; fehlt die `AGENTS.md` im Root, ist `Root-Kontextdatei` nicht prüfbar statt leer grün). Sie ersetzen die Projekt-Kopien der Kern-Tests agents-md-native und line-endings im Bezieher; der Unit-Anteil
 * (Parser, Erkennung) bleibt Kern-Test und ruft dieselben Funktionen aus diesem Modul.
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
 *   `Workflow-Auslöser`: jeder Name in `on.workflow_run.workflows` ist der `name:` eines vorhandenen Workflows (Leser `blockformAusloeser`); eine nicht lesbare Form (`on:` als Flow-Mapping, Anker, Alias, Tag) macht den Punkt nicht prüfbar mit `datei:zeile`.
 *
 * Nur Node-Builtins (der Wochenlauf hat kein `npm ci`); `git` und `existiert` sind injizierbar (Tests). Fehlt Git oder der Index, ist `Zeilenenden`
 * nicht prüfbar, `Root-Kontextdatei` wird trotzdem bewertet. Grenze: ein CI-Checkout sieht ungetrackte Dateien nicht, nur ein lokales `--pruefen`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { markerEnde, markerStart, PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "./besitz-lib.mjs";
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { labelAus, ladeProjektConfig, langfuseZiel, PROJEKT_CONFIG, ROLLEN_PFADE, zielRepoFuer } from "./projekt-config-lib.mjs";
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
 * der Config ein fremdes Repo, bleibt der Punkt OK, nennt aber einen Hinweis: ohne Sync-Stand (Upstream), dass dort der Takt Status- und Sammelticket pflegt (`nurWaechter` in board-takt.mjs);
 * im Bezieher (Sync-Stand vorhanden, factory#195), dass der Takt das Status-Ticket im eigenen Repo anlegt und nur Harness-Sammelticket und Quote bei dem fremden Repo bleiben (`bezieherTakt`);
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
    return gut("Langfuse-Takt", `das Factory-Board führt ${fremd}: der Takt legt das Status-Ticket „Langfuse-Status überprüfen“ im eigenen Repo an, Harness-Sammelticket und Quote pflegt der Takt von ${fremd}`);
  }
  return fremd === null ? gut("Langfuse-Takt") : gut("Langfuse-Takt", `das Factory-Board führt ${fremd}: dort pflegt der Takt Status-Ticket und Sammelticket, hier läuft nur der Board-Wächter`);
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
export const DATEI_PUNKTE = Object.freeze(["Root-Kontextdatei", "Zeilenenden", "Projektdateien", "Langfuse-Takt", "Gezielter Test", "Required-Check-Quellen", "Code-Scanning-Quellen", "Workflow-Auslöser"]);

/**
 * Die Dateipunkte `DATEI_PUNKTE`. `spiegel` (Ruleset-Spiegel), `workflows` (`[{ pfad, text }]`) und `pflichtChecks` (Soll-Liste) liest der Aufrufer (`pruefLauf`) einmal und reicht sie herein;
 * ohne sie ist `Required-Check-Quellen` nicht prüfbar.
 */
export function pruefeDateien({ rootDir, git = gitStandard(rootDir), existiert = existsSync, config = configOderNull(rootDir), spiegel, workflows = [], pflichtChecks = [], vorAbbruch = false }) {
  const punkte = {
    "Root-Kontextdatei": () => kontextPunkt(rootDir, existiert),
    Zeilenenden: () => zeilenendenPunkt(git),
    Projektdateien: () => projektdateienPunkt(rootDir, existiert),
    "Langfuse-Takt": () => langfuseTaktPunkt(rootDir, existiert, config),
    "Gezielter Test": () => gezielterTestPunkt(config),
    "Required-Check-Quellen": () => requiredCheckQuellenPunkt({ spiegel, workflows, pflichtChecks, vorAbbruch }),
    "Code-Scanning-Quellen": () => codeScanningQuellenPunkt({ spiegel, workflows, vorAbbruch }),
    "Workflow-Auslöser": () => workflowAusloeserPunkt({ workflows }),
  };
  return DATEI_PUNKTE.map((p) => punkte[p]());
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
