// Kein Shebang, kein Direktaufruf: pure Lib für `ticket-drift.mjs` (factory#28, ADR 0033). Prüft offene Tickets deterministisch gegen den Checkout (ohne Modell):
// tote Pfade und Zeilen, geschlossene Blocker, Titel-Duplikate, Rückstellungen. Der Lauf schreibt nur einen Bericht; die Bewertung macht ein Agent nach `.agents/skills/factory/ticket-drift.md`.
//
// Feldformen von `gh issue list --json …` (Probe 2026-11-12): `author {login, is_bot}` (Apps als `app/<name>`), `comments[] {author {login}, authorAssociation, body, createdAt}`,
// `blockedBy {nodes[] {number, state}}`, `labels[] {name}`, `updatedAt` (ISO).
//
// Grenzen (bewusst nicht erfasst): Pfade in Kommentaren, Blob-URLs, Pfade ohne Backticks, Root-Dateien ohne `/`, Blocker in fremden Repos, Zahlen im Text (prüft der Agent nur in den gelisteten Tickets).
// Der Bericht trägt nur Nummern, Pfade der Whitelist (`PFAD_FORM`, ohne `..`, `@`, Backtick, Leerraum), Daten und Zählungen: keine Logins, keine Zitate (er entsteht als vertrauter Bot-Text).
import { blockerVerweise } from "./spezifikation-lib.mjs";
import { istFremdeingang, istVertraut } from "./fremdtext-lib.mjs";
import { enthaeltSammelticketTitel } from "./sammelticket-titel.mjs";

/** Marker im Bericht-Issue: Dedupe-Schlüssel, damit der Lauf das offene Issue aktualisiert statt zu verdoppeln. */
export const BERICHT_MARKER = "<!-- ticket-drift-bericht -->";
/** Obergrenze des Berichts in Zeichen (GitHub erlaubt 65 536 je Body). */
export const BERICHT_MAX = 60_000;
/** Klassen in Berichtsreihenfolge. */
export const KLASSEN = ["pfad-entfernt", "zeile-ausserhalb", "zeile-verschoben", "blocker-zu", "duplikat", "rueckstellung"];
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

/** Blocker-Befunde: Textverweise auf das eigene Repo ohne offenes Issue und native Blocker mit Zustand CLOSED. `offene`: Menge der offenen Nummern. Fremde Repos werden übersprungen. */
export function blockerBefunde(issue, offene, sprache) {
  const nummern = new Set();
  for (const v of blockerVerweise(issue.body ?? "", sprache)) if (v.repo === null && !offene.has(v.nummer)) nummern.add(v.nummer);
  for (const n of issue.blockedBy?.nodes ?? []) if (n?.state === "CLOSED") nummern.add(n.number);
  return [...nummern].filter(Number.isInteger).sort((a, b) => a - b).map((n) => ({ nr: issue.number, klasse: "blocker-zu", text: `Blocker #${n} ist geschlossen` }));
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

const kommentarVertraut = (c, owner) => {
  const login = String(c?.author?.login ?? "");
  const bot = login.startsWith("app/") ? `${login.slice(4)}[bot]` : login;
  return c?.authorAssociation === "OWNER" || istVertraut({ login: bot, type: login.startsWith("app/") || login.endsWith("[bot]") ? "Bot" : "User" }, owner);
};

/** Rückstellungs-Befund: der jüngste vertraute Kommentar trägt einen Marker und kein vertrauter Kommentar folgt danach. `hinweis` bei möglich abgeschnittener Liste (≥ 100 Kommentare). */
export function rueckstellungBefund(issue, owner) {
  const vertraut = (issue.comments ?? []).filter((c) => kommentarVertraut(c, owner)).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  const letzter = vertraut.at(-1);
  const text = String(letzter?.body ?? "").toLowerCase();
  if (!RUECKSTELLUNG_MARKER.some((m) => text.includes(m))) return null;
  return { nr: issue.number, klasse: "rueckstellung", text: `zurückgestellt seit ${String(letzter.createdAt).slice(0, 10)}, Begründung prüfen (Kein Parken)` };
}

/**
 * Die ganze Prüfung. `ctx`: `{ config, owner, tops, git, sprache, berichtNr? }`. Fremdeingang und Bericht-Issues (Marker im Body) werden nicht geprüft, nur als Nummer gezählt.
 * Rückgabe `{ befunde, geprueft, uebersprungen: [nr], hinweise: [text] }`; Befunde nach Klasse und Nummer sortiert.
 */
export function pruefe(issues, { config, owner, tops, git, sprache }) {
  const uebersprungen = [];
  const pruefbar = [];
  for (const i of issues) {
    const autor = String(i.author?.login ?? "");
    const user = { login: autor.startsWith("app/") ? `${autor.slice(4)}[bot]` : autor, type: i.author?.is_bot ? "Bot" : "User" };
    const fremd = istFremdeingang({ user, labels: i.labels }, owner, { config }).fremdeingang;
    if (fremd || String(i.body ?? "").includes(BERICHT_MARKER)) uebersprungen.push(i.number);
    else pruefbar.push(i);
  }
  const offene = new Set(issues.map((i) => i.number));
  const befunde = [];
  const hinweise = [];
  if (git.shallow) hinweise.push("Shallow-Klon: Git-Prüfungen (entfernte Pfade, verschobene Zeilen) ausgesetzt");
  for (const i of pruefbar) {
    befunde.push(...pfadBefunde(i, tops, git), ...blockerBefunde(i, offene, sprache));
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
  const fuss = ["", "Abarbeiten nach der Prompt-Datei `ticket-drift.md` (Besitz-Ordner der Fabrik-Skills). Der Lauf schließt, ändert und kommentiert nichts."];
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
