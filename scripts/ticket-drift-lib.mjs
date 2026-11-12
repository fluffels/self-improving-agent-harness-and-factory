// Kein Shebang, kein Direktaufruf: pure Lib für `ticket-drift.mjs` (factory#28, ADR 0033). Prüft offene Tickets deterministisch gegen den Checkout (ohne Modell):
// tote Pfade und Zeilen, geschlossene Blocker, Titel-Duplikate, Rückstellungen. Der Lauf schreibt nur einen Bericht; die Bewertung macht ein Agent nach `.agents/skills/factory/ticket-drift.md`.
//
// Feldformen von `gh issue list --json …` (Probe 2026-11-12): `author {login, is_bot}` (Apps als `app/<name>`), `comments[] {author {login}, authorAssociation, body, createdAt}`,
// `blockedBy {nodes[] {number, state, url}}`, `labels[] {name}`, `updatedAt` (ISO).
//
// Grenzen (bewusst nicht erfasst): Rückstellungs-Marker und Stoppwörter sind deutsch (nicht aus der Projekt-Config; ohne deutsche Marker feuert `rueckstellung` nie), Pfade in Kommentaren, Blob-URLs, Pfade ohne Backticks, Root-Dateien ohne `/`, Blocker in fremden Repos (auch native Kanten ohne `url` im eigenen Repo), weiche Bezüge ohne Nummer, Zahlen im Text (prüft der Agent nur in den gelisteten Tickets).
// Reihenfolge (`blocker-dahinter`): ein Ticket steht im Board vor seinem offenen Blocker (Textzeile oder native Kante), verglichen nur innerhalb derselben Spalte eines Boards; ohne gelesene Boards (`boards: null`) ausgesetzt, mit Hinweis.
// Der Bericht trägt nur Nummern, Pfade der Whitelist (`PFAD_FORM`, ohne `..`, `@`, Backtick, Leerraum), Daten und Zählungen: keine Logins, keine Zitate (er entsteht als vertrauter Bot-Text).
import { blockerVerweise } from "./spezifikation-lib.mjs";
import { gleichesRepo } from "./repo-form.mjs";
import { istFremdeingang, istVertraut } from "./fremdtext-lib.mjs";
import { enthaeltSammelticketTitel } from "./sammelticket-titel.mjs";

/** Titelpräfix des Bericht-Issues (der Monat folgt). */
export const BERICHT_TITEL_PRAEFIX = "🔎 Ticket-Drift-Bericht ";
/** Marker im Bericht-Issue: Dedupe-Schlüssel, damit der Lauf das offene Issue aktualisiert statt zu verdoppeln. */
export const BERICHT_MARKER = "<!-- ticket-drift-bericht -->";
/** Obergrenze des Berichts in Zeichen (GitHub erlaubt 65 536 je Body). */
export const BERICHT_MAX = 60_000;
/** Klassen in Berichtsreihenfolge. */
export const KLASSEN = ["pfad-entfernt", "zeile-ausserhalb", "zeile-verschoben", "blocker-zu", "blocker-dahinter", "duplikat", "rueckstellung"];
/** Marker einer Rückstellung im Kommentar (geschlossene Liste, ohne Groß-/Kleinschreibung). */
export const RUECKSTELLUNG_MARKER = ["zurückgestellt", "zurückstellen", "⏸"];

const PFAD_FORM = /^[A-Za-z0-9._/-]+(?::(\d+)(?:-(\d+))?)?$/;
const STOPPWOERTER = new Set(["und", "oder", "der", "die", "das", "den", "dem", "des", "ein", "eine", "für", "mit", "von", "zum", "zur", "bei", "auf", "aus", "nach", "als", "the", "and", "for", "with", "nicht", "statt", "wie", "ohne", "über"]);
const SERIE = /\b\d+\/\d+\b/;

/** Die Inline-Backtick-Verweise `pfad` oder `pfad:zeile[-zeile]` aus einem Body (ohne Fences); `tops` ist die Menge getrackter Top-Level-Verzeichnisse. Je Pfad-Zeile-Paar einmal. Pur. */
export function verweiseAus(body, tops) {
  const text = String(body ?? "").replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
  const gefunden = new Map();
  for (const [, lauf] of text.matchAll(/`([^`\s]+)`/g)) {
    const m = PFAD_FORM.exec(lauf);
    if (!m || lauf.startsWith("/") || lauf.split(/[:]/)[0].split("/").some((s) => s === ".." || s === "")) continue;
    const pfad = lauf.split(":")[0];
    if (!pfad.includes("/") || !tops.has(pfad.split("/")[0])) continue;
    const von = m[1] === undefined ? null : Number(m[1]);
    const bis = m[2] === undefined ? von : Number(m[2]);
    gefunden.set(lauf, { pfad, bis, von });
  }
  return [...gefunden.values()];
}

/** Pfad- und Zeilen-Befunde eines Issues. `git`: `{ existiert(p), zeilen(p), letzteAenderung(p) → ISO|null, geaendertSeit(p, iso) → bool, shallow }`. Shallow setzt die Git-Prüfungen aus (fail-closed). */
export function pfadBefunde(issue, tops, git) {
  const befunde = [];
  for (const v of verweiseAus(issue.body, tops)) {
    if (!git.existiert(v.pfad)) {
      const datum = git.shallow ? null : git.letzteAenderung(v.pfad);
      if (datum) befunde.push({ nr: issue.number, klasse: "pfad-entfernt", text: `\`${v.pfad}\` fehlt, zuletzt geändert ${String(datum).slice(0, 10)}` });
    } else if (v.von !== null && git.zeilen(v.pfad) < v.bis) {
      befunde.push({ nr: issue.number, klasse: "zeile-ausserhalb", text: `\`${v.pfad}:${v.von}\` liegt hinter dem Dateiende (${git.zeilen(v.pfad)} Zeilen)` });
    } else if (v.von !== null && !git.shallow && git.geaendertSeit(v.pfad, issue.updatedAt)) {
      befunde.push({ nr: issue.number, klasse: "zeile-verschoben", text: `\`${v.pfad}\` seit ${String(issue.updatedAt).slice(0, 10)} geändert, Zeile ${v.von} prüfen` });
    }
  }
  return befunde;
}

/** Repo (`owner/name`) aus der Issue-URL einer nativen Blocker-Kante; ohne `url` oder bei fremder Form `undefined`. Pur. */
const kantenRepo = (n) => /\/([\w.-]+\/[\w.-]+)\/issues\/\d+\/?$/.exec(String(n?.url ?? ""))?.[1];

/** Blocker-Befunde: Textverweise auf das eigene Repo (ohne Repo oder ausgeschrieben `repo`) ohne offenes Issue und native Blocker mit Zustand CLOSED und Issue-URL des eigenen `repo` (ohne `url` übersprungen). `offene`: Menge der offenen Nummern. Fremde Repos werden übersprungen. */
export function blockerBefunde(issue, offene, sprache, repo) {
  const nummern = new Set();
  for (const v of blockerVerweise(issue.body ?? "", sprache)) if ((v.repo === null || gleichesRepo(v.repo, repo)) && !offene.has(v.nummer)) nummern.add(v.nummer);
  for (const n of issue.blockedBy?.nodes ?? []) if (n?.state === "CLOSED" && gleichesRepo(kantenRepo(n), repo)) nummern.add(n.number);
  return [...nummern].filter(Number.isInteger).sort((a, b) => a - b).map((n) => ({ nr: issue.number, klasse: "blocker-zu", text: `Blocker #${n} ist geschlossen` }));
}

/** Nummern der offenen Blocker eines Tickets im eigenen Repo: Textzeilen (Nummer in `offene`) und native Kanten mit Zustand OPEN und Issue-URL des eigenen `repo` (ohne `url` übersprungen). Sortiert, ohne Doppelte. */
export function offeneBlocker(issue, offene, sprache, repo) {
  const nummern = new Set();
  for (const v of blockerVerweise(issue.body ?? "", sprache)) if ((v.repo === null || gleichesRepo(v.repo, repo)) && offene.has(v.nummer)) nummern.add(v.nummer);
  for (const n of issue.blockedBy?.nodes ?? []) if (n?.state === "OPEN" && gleichesRepo(kantenRepo(n), repo)) nummern.add(n.number);
  return [...nummern].filter(Number.isInteger).sort((a, b) => a - b);
}

/** Rang-Karte eines Boards: Nummer → `{ rang, status }` unter den offenen Items in Board-Reihenfolge. */
const rangKarte = (items) => new Map(items.filter((i) => i.state === "open").map((i, rang) => [i.number, { rang, status: i.status }]));

/** Steht `nr` in einer der Rang-Karten in derselben Spalte vor `blocker`? */
const stehtDavor = (karten, nr, blocker) => karten.some((k) => k.get(nr) && k.get(blocker) && k.get(nr).status === k.get(blocker).status && k.get(nr).rang < k.get(blocker).rang);

/** Reihenfolge-Befunde: das Ticket steht im Board (gleiche Spalte) vor einem seiner offenen Blocker. `karten`: Rang-Karten der Boards. Je Paar einmal, auch bei mehreren Boards. */
export function reihenfolgeBefunde(issue, offene, sprache, repo, karten) {
  return offeneBlocker(issue, offene, sprache, repo).filter((b) => stehtDavor(karten, issue.number, b)).map((b) => ({ nr: issue.number, klasse: "blocker-dahinter", text: `Blocker #${b} steht im Board dahinter` }));
}

/** Wortmenge eines Titels: ohne Emoji/Satzzeichen, Serien-Präfix, Stoppwörter und Wörter ≤ 2 Zeichen. */
export function titelWoerter(titel) {
  const roh = String(titel ?? "").toLowerCase().replace(SERIE, " ").replace(/[^\p{L}\p{N}\s]/gu, " ");
  return new Set(roh.split(/\s+/).filter((w) => w.length > 2 && !STOPPWOERTER.has(w)));
}

/** Duplikat-Kandidaten: Jaccard der Titel-Wortmengen ≥ 0,6, beide ≥ 3 Wörter; ohne Serien-Paare und Sammeltickets. Je Paar einmal, aufsteigend. */
export function duplikatBefunde(issues, schwelle = 0.6) {
  const kandidaten = issues
    .filter((i) => !enthaeltSammelticketTitel(i.title))
    .map((i) => ({ nr: i.number, serie: SERIE.test(i.title ?? ""), w: titelWoerter(i.title) }))
    .filter((k) => k.w.size >= 3)
    .sort((a, b) => a.nr - b.nr);
  const befunde = [];
  for (let i = 0; i < kandidaten.length; i++) {
    for (let j = i + 1; j < kandidaten.length; j++) {
      const a = kandidaten[i];
      const b = kandidaten[j];
      if (a.serie && b.serie) continue;
      const gemeinsam = [...a.w].filter((w) => b.w.has(w)).length;
      const aehnlichkeit = gemeinsam / (a.w.size + b.w.size - gemeinsam);
      if (aehnlichkeit >= schwelle) befunde.push({ nr: a.nr, klasse: "duplikat", text: `Titel ähnlich zu #${b.nr} (${aehnlichkeit.toFixed(2)})` });
    }
  }
  return befunde;
}

/** REST-Form eines Nutzers aus der gh-CLI-Form (`app/<name>` ist ein Bot, `/` kann in keinem Login vorkommen). Die eine Stelle der Bot-Regel. */
export function nutzerAus(author) {
  const login = String(author?.login ?? "");
  const bot = login.startsWith("app/") || login.endsWith("[bot]");
  return { login: login.startsWith("app/") ? `${login.slice(4)}[bot]` : login, type: bot ? "Bot" : "User" };
}

const kommentarVertraut = (c, owner) => c?.authorAssociation === "OWNER" || istVertraut(nutzerAus(c?.author), owner);

/** Bekannte Grenze: vertraut ist der Autor (Owner, `github-actions[bot]`), nicht der einzelne Workflow; ein anderer Bot-Workflow mit Titelpräfix und Marker würde überschrieben (Schaden: dieses eine Issue).
 * Ist `issue` ein Bericht dieses Laufs: Marker im Body, Titelpräfix und vertrauter Autor (kein Fremdeingang)? Nur ein solches Issue darf das Schreibziel sein. */
export function istBerichtIssue(issue, owner, config) {
  return String(issue.body ?? "").includes(BERICHT_MARKER) && String(issue.title ?? "").startsWith(BERICHT_TITEL_PRAEFIX) && !istFremdeingang({ user: nutzerAus(issue.author), labels: issue.labels }, owner, { config }).fremdeingang;
}

/** Rückstellungs-Befund: der jüngste vertraute Kommentar trägt einen Marker und kein vertrauter Kommentar folgt danach. `hinweis` bei möglich abgeschnittener Liste (≥ 100 Kommentare). */
export function rueckstellungBefund(issue, owner) {
  const vertraut = (issue.comments ?? []).filter((c) => kommentarVertraut(c, owner)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const letzter = vertraut.at(-1);
  const text = String(letzter?.body ?? "").toLowerCase();
  if (!RUECKSTELLUNG_MARKER.some((m) => text.includes(m))) return null;
  return { nr: issue.number, klasse: "rueckstellung", text: `zurückgestellt seit ${String(letzter.createdAt).slice(0, 10)}, Begründung prüfen (Kein Parken)` };
}

/**
 * Die ganze Prüfung. `ctx`: `{ config, owner, tops, git, sprache, repo?, boards? }`; `boards`: Listen der Board-Items (`loadItems`) für `blocker-dahinter`, `null` = nicht gelesen (Hinweis), fehlend = Prüfung nicht angefordert. Fremdeingang und Bericht-Issues (Marker im Body) werden nicht geprüft, nur als Nummer gezählt.
 * Rückgabe `{ befunde, geprueft, uebersprungen: [nr], hinweise: [text] }`; Befunde nach Klasse und Nummer sortiert.
 */
export function pruefe(issues, { config, owner, tops, git, sprache, repo, boards }) {
  const uebersprungen = [];
  const pruefbar = [];
  for (const i of issues) {
    const fremd = istFremdeingang({ user: nutzerAus(i.author), labels: i.labels }, owner, { config }).fremdeingang;
    if (fremd || istBerichtIssue(i, owner, config)) uebersprungen.push(i.number);
    else pruefbar.push(i);
  }
  const offene = new Set(issues.map((i) => i.number));
  const befunde = [];
  const hinweise = [];
  if (git.shallow) hinweise.push("Shallow-Klon: Git-Prüfungen (entfernte Pfade, verschobene Zeilen) ausgesetzt");
  if (boards === null) hinweise.push("Board nicht gelesen: blocker-dahinter ausgesetzt");
  const karten = Array.isArray(boards) ? boards.map(rangKarte) : [];
  for (const i of pruefbar) {
    befunde.push(...pfadBefunde(i, tops, git), ...blockerBefunde(i, offene, sprache, repo), ...reihenfolgeBefunde(i, offene, sprache, repo, karten));
    const r = rueckstellungBefund(i, owner);
    if (r) befunde.push(r);
    if ((i.comments ?? []).length >= 100) hinweise.push(`#${i.number}: Kommentarliste möglicherweise abgeschnitten`);
  }
  befunde.push(...duplikatBefunde(pruefbar));
  befunde.sort((a, b) => KLASSEN.indexOf(a.klasse) - KLASSEN.indexOf(b.klasse) || a.nr - b.nr || a.text.localeCompare(b.text));
  return { befunde, geprueft: pruefbar.length, uebersprungen: uebersprungen.sort((a, b) => a - b), hinweise: [...new Set(hinweise)] };
}

/** Markdown-Bericht; über `BERICHT_MAX` Zeichen gekürzt mit Hinweis auf die Step-Summary. Pur und deterministisch. */
export function berichtText({ befunde, geprueft, uebersprungen, hinweise }, { sha, datum }) {
  const kopf = [`${BERICHT_MARKER}`, `Stand: \`${sha}\`, ${datum}. Geprüft: ${geprueft}, übersprungen (Fremdeingang, Bericht): ${uebersprungen.length ? uebersprungen.map((n) => `#${n}`).join(", ") : "keine"}.`, ...hinweise.map((h) => `Hinweis: ${h}`), ""];
  const fuss = ["", "Abarbeiten nach der Prompt-Datei `ticket-drift.md` (genannt in docs/agent-harness.md (Fabrik) § 2.2). Der Lauf schließt, ändert und kommentiert nichts."];
  if (befunde.length === 0) return [...kopf, "keine Befunde", ...fuss].join("\n") + "\n";
  const zeilen = [];
  for (const k of KLASSEN) {
    const liste = befunde.filter((b) => b.klasse === k);
    if (liste.length) zeilen.push(`## ${k} (${liste.length})`, ...liste.map((b) => `- #${b.nr}: ${b.text}`), "");
  }
  const voll = [...kopf, ...zeilen, ...fuss.slice(1)].join("\n") + "\n";
  if (voll.length <= BERICHT_MAX) return voll;
  let n = zeilen.length;
  while (n > 0 && [...kopf, ...zeilen.slice(0, n), "x".repeat(100), ...fuss].join("\n").length > BERICHT_MAX) n--;
  const gezeigt = zeilen.slice(0, n).filter((z) => z.startsWith("- #")).length;
  return [...kopf, ...zeilen.slice(0, n), `${befunde.length - gezeigt} weitere Befunde, vollständig in der Step-Summary`, ...fuss].join("\n") + "\n";
}
