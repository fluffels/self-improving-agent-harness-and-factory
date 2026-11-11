/**
 * Langfuse-Wochenbericht (factory#313): pure Lib. Baut aus selbstbeschreibenden `queryMetrics`-Exporten den Bericht der letzten
 * vollen Woche (Mo bis So, UTC) samt Urteil „Agent-Lauf nötig“ nach Schwellen aus der Config (`langfuseWochenbericht`).
 * Einziger Import ist die pure `langfuse-auswertung-lib.mjs`; kein fs, kein env, kein Netz, kein Secret-Key. Der Live-Weg liegt im
 * Modul `langfuse-wochenbericht-live.mjs`, das die CLI nur ohne `--export` dynamisch lädt.
 *
 * Export-Arten: die der Auswertung (`gesamt`, `tage`, `latenz`, `metadaten`) und zwei eigene, `sessions` (Sessions der Woche,
 * Dimensionen sessionId und traceName) und `erfassung` (Scores `erfassung` und `erfassung_hook` je Session). Jeder
 * observations-Export trägt den Projektfilter (`projektFilterAus`), sonst bricht `ordneExporte`.
 * Kosten je Merge (factory#324): `kostenAnstiegProzent` misst das Δ der Kosten je gemergtem PR (Merge-Zahlen liefert die CLI per `gh`-Suche, die Lib bekommt sie als `merges`).
 * Zählweise der Erfassungslücken: m(Woche) + j(Vorwoche), also Scores unter 1 der Woche plus Sessions der Vorwoche, die weiter ohne
 * Score sind (die Ruhefrist des Abgleichs ist dann sicher um). Codex-Sessions zählen nie (der Abgleich liest nur Claude-Transkripte).
 */

import { ROW_LIMIT, bericht, leseExport, pruefeProjektFilter, renderMarkdown, rezept } from "./langfuse-auswertung-lib.mjs";

export const MS_TAG = 86400000;
export const MS_WOCHE = 7 * MS_TAG;
export const RUHEFRIST_MS = 30 * 60000;
export const EIGENE_ARTEN = ["sessions", "erfassung"];
export const SCORE_NAMEN = ["erfassung", "erfassung_hook"];
export const KEINE_SCHWELLEN = "Schwellen nicht konfiguriert, Status-Ticket wie bisher über den Board-Takt";
export const VERMERK_TAGS = "nachgelieferte Calls ohne Tag fehlen";
const SCHWELLEN_FELDER = ["erfassungLueckenMax", "kostenAnstiegProzent", "unzugeordnetProzent"];

const iso = (ms) => new Date(ms).toISOString();
const usd = (x) => `${x.toFixed(2)} $`;
const prozent = (x) => (x === null ? "–" : `${x >= 0 ? "+" : ""}${x.toFixed(1)} %`);

/** Montag (UTC, `JJJJ-MM-TT`) der letzten vollen Woche vor `jetzt`. Pur. */
export function letzteVolleWoche(jetzt) {
  const t = new Date(jetzt);
  const tag = (t.getUTCDay() + 6) % 7; // Montag = 0
  const montagDieseWoche = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()) - tag * MS_TAG;
  return iso(montagDieseWoche - MS_WOCHE).slice(0, 10);
}

/** Prüft `JJJJ-MM-TT` als Montag; wirft sonst. */
function montagMs(montag) {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(String(montag)) ? Date.parse(`${montag}T00:00:00Z`) : NaN;
  if (Number.isNaN(ms) || new Date(ms).getUTCDay() !== 1 || iso(ms).slice(0, 10) !== montag) throw new Error(`Woche ${JSON.stringify(montag)} ist kein Montag der Form JJJJ-MM-TT`);
  return ms;
}

/** Fenster der Woche (`von` bis `bis`) und der Vorwoche; wirft, wenn `montag` kein Montag ist. */
export function wochenFenster(montag) {
  const ms = montagMs(montag);
  return { von: iso(ms), bis: iso(ms + MS_WOCHE), vorVon: iso(ms - MS_WOCHE), vorBis: iso(ms) };
}

/** Prüft, dass die Woche abgeschlossen ist (nächster Montag höchstens jetzt minus Ruhefrist); wirft sonst. */
export function pruefeAbgeschlossen(montag, jetzt) {
  if (Date.parse(wochenFenster(montag).bis) > Date.parse(jetzt) - RUHEFRIST_MS) throw new Error(`Woche ${montag} ist noch nicht abgeschlossen (Ruhefrist ${RUHEFRIST_MS / 60000} min nach Wochenende)`);
}

/** Projektfilter aus Dateien der Repo-Wurzel: `environment` (wenn der Aufrufer ihn belegt hat) sonst Tags; nie aus dem Ordnernamen. Pur. */
export function projektFilterAus({ tags = [], repoName, environment }) {
  if (environment) return { filter: pruefeProjektFilter({ column: "environment", operator: "=", value: environment, type: "string" }), vermerk: null };
  const liste = [...new Set([...tags, repoName, `project:${repoName}`].filter((t) => typeof t === "string" && t !== ""))];
  return { filter: pruefeProjektFilter({ column: "tags", operator: "any of", value: liste, type: "arrayOptions" }), vermerk: VERMERK_TAGS };
}

// ── Rezept ───────────────────────────────────────────────────────────────────

/** Alle Abfragen der Woche (`{ art, name, abfrage }`); `jetzt` begrenzt das Fenster der Scores. */
export function wochenRezept({ montag, jetzt, rollen = [], projektFilter }) {
  const f = wochenFenster(montag);
  const basis = rezept({ von: f.von, bis: f.bis, rollen, projektFilter });
  const vor = rezept({ von: f.vorVon, bis: f.vorBis, rollen, projektFilter }).find((r) => r.art === "gesamt");
  const sessions = (von, bis, name) => ({
    art: "sessions",
    name,
    abfrage: { ...basis[0].abfrage, dimensions: [{ field: "sessionId" }, { field: "traceName" }], metrics: [{ measure: "count", aggregation: "count" }], orderBy: [{ field: "count_count", direction: "desc" }], fromTimestamp: von, toTimestamp: bis },
  });
  const erfassung = {
    art: "erfassung",
    name: "erfassung",
    abfrage: {
      view: "scores-numeric",
      filters: [{ column: "name", operator: "any of", value: SCORE_NAMEN, type: "stringOptions" }],
      dimensions: [{ field: "sessionId" }, { field: "name" }],
      metrics: [{ measure: "value", aggregation: "avg" }],
      orderBy: [{ field: "avg_value", direction: "desc" }],
      fromTimestamp: f.vorVon,
      toTimestamp: iso(Date.parse(jetzt) - RUHEFRIST_MS),
      config: { row_limit: ROW_LIMIT },
    },
  };
  return [...basis, { ...vor, name: "gesamt Vorwoche" }, sessions(f.von, f.bis, "sessions"), sessions(f.vorVon, f.vorBis, "sessions Vorwoche"), erfassung];
}

// ── Exporte ordnen ───────────────────────────────────────────────────────────

const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fenstergleich = (e, von, bis) => Date.parse(e.von) === Date.parse(von) && Date.parse(e.bis) === Date.parse(bis);

function leseEigene(json, pfad) {
  const wo = (t) => new Error(`${pfad}: ${t} (Abfragerezept: node scripts/langfuse-wochenbericht.mjs --rezept)`);
  if (!Array.isArray(json.data)) throw wo("data fehlt oder ist kein Array");
  if (json.data.length >= ROW_LIMIT) throw wo(`Export abgeschnitten (${json.data.length} Zeilen = row_limit)`);
  const a = json.abfrage;
  if (Number.isNaN(Date.parse(a?.fromTimestamp)) || Number.isNaN(Date.parse(a?.toTimestamp))) throw wo("Fenster (fromTimestamp/toTimestamp) fehlt");
  const nameFilter = (a.filters ?? []).some((f) => f?.column === "name" && gleich(f.value, SCORE_NAMEN));
  if (json.art === "erfassung" && !nameFilter) throw wo("Filter name any of [erfassung, erfassung_hook] fehlt");
  return { art: json.art, pfad, von: a.fromTimestamp, bis: a.toTimestamp, data: json.data, filters: a.filters ?? [] };
}

function lese(json, pfad, projektFilter) {
  if (EIGENE_ARTEN.includes(json?.art)) {
    const e = leseEigene(json, pfad);
    if (e.art === "sessions" && !e.filters.some((f) => gleich(f, projektFilter))) throw new Error(`${pfad}: Projektfilter fehlt oder weicht ab (erwartet ${JSON.stringify(projektFilter)})`);
    return e;
  }
  const e = leseExport(json, pfad);
  if (!(json.abfrage.filters ?? []).some((f) => gleich(f, projektFilter))) throw new Error(`${pfad}: Projektfilter fehlt oder weicht ab (erwartet ${JSON.stringify(projektFilter)})`);
  return e;
}

/** Ordnet die gelesenen Exporte `[{ json, pfad }]` Woche und Vorwoche zu; wirft mit Namen, wenn ein Pflicht-Export fehlt. */
export function ordneExporte(roh, { montag, projektFilter }) {
  const f = wochenFenster(montag);
  const alle = roh.map(({ json, pfad }) => lese(json, pfad, projektFilter));
  const woche = alle.filter((e) => !EIGENE_ARTEN.includes(e.art) && fenstergleich(e, f.von, f.bis));
  const finde = (art, von, bis) => alle.find((e) => e.art === art && fenstergleich(e, von, bis));
  const out = {
    woche,
    vorwoche: alle.find((e) => e.art === "gesamt" && fenstergleich(e, f.vorVon, f.vorBis)),
    sessionsW: finde("sessions", f.von, f.bis),
    sessionsV: finde("sessions", f.vorVon, f.vorBis),
    erfassung: alle.find((e) => e.art === "erfassung" && Date.parse(e.von) === Date.parse(f.vorVon)),
  };
  const fehlt = [
    ["gesamt der Woche", woche.some((e) => e.art === "gesamt")],
    ["tage der Woche", woche.some((e) => e.art === "tage")],
    ["gesamt der Vorwoche", out.vorwoche],
    ["sessions der Woche", out.sessionsW],
    ["sessions der Vorwoche", out.sessionsV],
    ["erfassung", out.erfassung],
  ].filter(([, da]) => !da).map(([n]) => n);
  if (fehlt.length) throw new Error(`Pflicht-Export fehlt: ${fehlt.join(", ")} (Abfragerezept: node scripts/langfuse-wochenbericht.mjs --rezept)`);
  const unbekannt = alle.filter((e) => !woche.includes(e) && ![out.vorwoche, out.sessionsW, out.sessionsV, out.erfassung].includes(e));
  if (unbekannt.length) throw new Error(`${unbekannt[0].pfad}: Fenster passt weder zur Woche noch zur Vorwoche`);
  return out;
}

// ── Kennzahlen ───────────────────────────────────────────────────────────────

const istCodex = (traceName) => String(traceName ?? "").startsWith("Codex:");
const leerId = (id) => id === null || id === undefined || String(id).trim() === "";

/** Session-Menge ohne Codex (eine Session gilt als Codex, wenn alle ihre Zeilen Codex-Traces sind). */
function claudeSessions(data) {
  const m = new Map();
  for (const r of data) {
    if (leerId(r.sessionId)) continue;
    m.set(r.sessionId, (m.get(r.sessionId) ?? true) && istCodex(r.traceName));
  }
  return new Set([...m].filter(([, codex]) => !codex).map(([id]) => id));
}

/** Erfassungsprobe: n Sessions der Woche, k mit Score 1, m mit Score unter 1, j ohne Score, Ø `erfassung_hook`; Lücken = m + j(Vorwoche). */
export function erfassungsprobe({ sessionsW, sessionsV, scores }) {
  const score = new Map();
  const hook = new Map();
  for (const r of scores) {
    const ziel = r.name === "erfassung" ? score : r.name === "erfassung_hook" ? hook : null;
    if (ziel && !leerId(r.sessionId) && Number.isFinite(Number(r.avg_value))) ziel.set(r.sessionId, Number(r.avg_value));
  }
  const w = claudeSessions(sessionsW);
  const v = [...claudeSessions(sessionsV)].filter((id) => !w.has(id));
  const ids = [...w];
  const hooks = ids.filter((id) => hook.has(id)).map((id) => hook.get(id));
  const p = {
    n: ids.length,
    k: ids.filter((id) => score.get(id) === 1).length,
    m: ids.filter((id) => score.has(id) && score.get(id) < 1).length,
    j: ids.filter((id) => !score.has(id)).length,
    jVorwoche: v.filter((id) => !score.has(id)).length,
    hookMittel: hooks.length ? hooks.reduce((s, x) => s + x, 0) / hooks.length : null,
  };
  return { ...p, luecken: p.m + p.jVorwoche };
}

const mergeZeit = (iso8601) => iso8601.slice(0, 19) + "+00:00";

/** Pur: `gh`-Argumente für die Zahl der gemergten PRs eines Repos im Fenster [von, bis) (Suche, `per_page=1`: nur `total_count` zählt). */
export function mergeSucheArgs({ owner, repo, von, bis }) {
  const bisIncl = new Date(Date.parse(bis) - 1000).toISOString();
  return ["api", "-X", "GET", "search/issues", "-f", `q=repo:${owner}/${repo} is:pr is:merged merged:${mergeZeit(von)}..${mergeZeit(bisIncl)}`, "-f", "per_page=1"];
}

/** Pur: Zahl der Merges aus der Suchantwort; wirft bei unlesbarem JSON, unvollständigem Ergebnis oder unbrauchbarem `total_count`. */
export function mergeAnzahl(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    throw new Error("Merges nicht ermittelbar: Antwort der Suche ist kein JSON");
  }
  if (j?.incomplete_results !== false) throw new Error("Merges nicht ermittelbar: Suche unvollständig (incomplete_results)");
  if (!Number.isInteger(j.total_count) || j.total_count < 0) throw new Error("Merges nicht ermittelbar: total_count fehlt oder ist keine Ganzzahl >= 0");
  return j.total_count;
}

/**
 * Summe, Δ, Kosten je Merge und Anteil unzugeordnet aus den Berichten der Woche und der Vorwoche; nicht bewertbare Werte sind `null`.
 * `merges` = `{ woche, vorwoche }` gemergte PRs (Nenner mindestens 1); ohne `merges` ist `deltaJeMergeProzent` `null`, bei 0 Merges in beiden Wochen ergibt der Nenner 1 beider Seiten das Summen-Δ.
 */
export function kennzahlen(b, bV, merges = null) {
  const bewertbar = bV.bereinigt.count > 0 && bV.bereinigt.cost > 0;
  const delta = bewertbar ? ((b.bereinigt.cost - bV.bereinigt.cost) / bV.bereinigt.cost) * 100 : null;
  const unz = b.bereinigt.cost > 0 ? (b.unzugeordnet.cost / b.bereinigt.cost) * 100 : null;
  const je = (cost, n) => cost / Math.max(n, 1);
  const jeMerge = merges === null ? null : je(b.bereinigt.cost, merges.woche);
  const jeMergeVor = merges === null ? null : je(bV.bereinigt.cost, merges.vorwoche);
  let deltaJe = null;
  if (bewertbar && merges !== null) deltaJe = ((jeMerge - jeMergeVor) / jeMergeVor) * 100;
  return { summe: b.bereinigt.cost, vorwoche: bV.bereinigt.cost, deltaProzent: delta, merges, jeMerge, jeMergeVorwoche: jeMergeVor, deltaJeMergeProzent: deltaJe, unzugeordnetProzent: unz };
}

// ── Urteil ───────────────────────────────────────────────────────────────────

/** Schwelle überschritten heißt strikt größer; `ist` ist `{ erfassungLueckenMax, kostenAnstiegProzent, unzugeordnetProzent }` (Zahl oder `null` = nicht bewertbar). */
export function urteil(schwellen, ist) {
  if (!schwellen) return { konfiguriert: false, agentLaufNoetig: false, gruende: [], hinweise: [KEINE_SCHWELLEN] };
  const gruende = [];
  const hinweise = [];
  for (const feld of SCHWELLEN_FELDER) {
    if (schwellen[feld] === undefined) hinweise.push(`${feld}: nicht gesetzt`);
    else if (ist[feld] === null || ist[feld] === undefined) hinweise.push(`${feld}: nicht bewertbar`);
    else if (ist[feld] > schwellen[feld]) gruende.push({ schwelle: feld, ist: ist[feld], soll: schwellen[feld] });
  }
  return { konfiguriert: true, agentLaufNoetig: gruende.length > 0, gruende, hinweise };
}

// ── Darstellung ──────────────────────────────────────────────────────────────

/** Zeilen ohne Rolle oder Modell stehen als Datenlücke des Wochenberichts (nie nur als Summe im Auswertungsteil). */
const unzugeordnetLuecke = (b) => (b.unzugeordnet.count > 0 ? [`Zeilen ohne Rolle oder Modell: ${b.unzugeordnet.count} Calls (${usd(b.unzugeordnet.cost)})`] : []);

/** Baut Bericht, Kennzahlen, Probe und Urteil aus den geordneten Exporten. */
export function wochenAuswertung(geordnet, { schwellen, vermerk, merges }) {
  const roh = bericht(geordnet.woche);
  const b = { ...roh, luecken: [...roh.luecken, ...unzugeordnetLuecke(roh)] };
  const bV = bericht([geordnet.vorwoche]);
  const probe = erfassungsprobe({ sessionsW: geordnet.sessionsW.data, sessionsV: geordnet.sessionsV.data, scores: geordnet.erfassung.data });
  const k = kennzahlen(b, bV, merges);
  const u = urteil(schwellen, { erfassungLueckenMax: probe.luecken, kostenAnstiegProzent: k.deltaJeMergeProzent, unzugeordnetProzent: k.unzugeordnetProzent });
  return { bericht: b, probe, kennzahlen: k, urteil: u, schwellen: schwellen ?? null, vermerk: vermerk ?? null };
}

function urteilZeilen(u) {
  const kopf = u.agentLaufNoetig ? "Agent-Lauf nötig" : "kein Agent-Lauf nötig";
  return [`${kopf}.`, ...u.gruende.map((g) => `- ${g.schwelle}: Ist ${Number(g.ist).toFixed(1)}, Soll höchstens ${g.soll}`), ...u.hinweise.map((h) => `- ${h}`)];
}

function jeMergeZeile(k) {
  if (k.merges === null) return "Gemergte PRs: nicht ermittelt, Kosten je Merge nicht bewertbar.";
  const delta = `Δ ${prozent(k.deltaJeMergeProzent)}${k.deltaJeMergeProzent === null ? " (Vorwoche ohne Kosten, nicht bewertbar)" : ""}`;
  return `Gemergte PRs: Woche ${k.merges.woche}, Vorwoche ${k.merges.vorwoche}; Kosten je Merge ${usd(k.jeMerge)} (Vorwoche ${usd(k.jeMergeVorwoche)}), ${delta}. Nenner mindestens 1; das Urteil misst \`kostenAnstiegProzent\` an diesem Δ, nicht an der Summe.`;
}

/** Markdown des Wochenberichts (die Auswertung steht mit um eine Ebene tieferen Überschriften darunter). */
export function renderWochenbericht(montag, projektFilter, a) {
  const { kennzahlen: k, probe: p } = a;
  const hook = p.hookMittel === null ? "–" : p.hookMittel.toFixed(2);
  return [
    `# Langfuse-Wochenbericht ${montag}`,
    "",
    `Projektfilter: \`${JSON.stringify(projektFilter)}\`${a.vermerk ? ` (${a.vermerk})` : ""}.`,
    "",
    "## Urteil",
    "",
    ...urteilZeilen(a.urteil),
    "",
    "## Summe, Kosten je Merge und Δ Vorwoche",
    "",
    `Woche ${usd(k.summe)}, Vorwoche ${usd(k.vorwoche)}, Δ ${prozent(k.deltaProzent)}${k.deltaProzent === null ? " (Vorwoche ohne Kosten, nicht bewertbar)" : ""}. Beide Summen bereinigt nur um negative Latenz (nur Woche) und Audit-Kopien, ohne Überzählung und Preisabweichung (dafür braucht es die Transkripte, \`--pruefen\`).`,
    jeMergeZeile(k),
    "",
    "## Erfassungsprobe",
    "",
    `${p.n} Sessions (ohne Codex): ${p.k} mit Score 1, ${p.m} mit Score unter 1, ${p.j} mit „Score ausstehend“. Ø erfassung_hook ${hook}.`,
    `Erfassungslücken: ${p.luecken} (Score unter 1 in der Woche: ${p.m}, Vorwoche weiter ohne Score: ${p.jVorwoche}).`,
    "",
    renderMarkdown(a.bericht).replace(/^(#+) /gm, "#$1 "),
  ].join("\n");
}

/** JSON-Form des Wochenberichts (`status: "bericht"`). */
export function wochenJson(montag, projektFilter, a) {
  return { status: "bericht", woche: montag, projektFilter, vermerk: a.vermerk, summe: a.kennzahlen, erfassungsprobe: a.probe, datenluecken: a.bericht.luecken, schwellen: a.schwellen, urteil: a.urteil };
}

// ── Wochenbericht-Lauf (factory#314) ─────────────────────────────────────────

/**
 * Pur: Termin des automatischen Wochenbericht-Laufs. `montag` = Montag der letzten vollen Woche (UTC), `faellig` ab Dienstag 00:00Z nach
 * ihrem Ende (Montag + 8 Tage), `meldenAb` ab Donnerstag 00:00Z (Montag + 10 Tage): ab dann wird ein fehlender Bericht gemeldet.
 */
export function wochenberichtTermin(jetzt) {
  const montag = letzteVolleWoche(new Date(jetzt));
  const ms = Date.parse(`${montag}T00:00:00.000Z`);
  const t = new Date(jetzt).getTime();
  return { montag, faellig: t >= ms + 8 * MS_TAG, meldenAb: t >= ms + 10 * MS_TAG };
}

/**
 * Pur: Stand einer Woche aus ihrer `<montag>.json`: `erledigt` (Bericht ohne Schwellenüberschreitung, `gemeldet`, `ruhe`), `melden` (Bericht mit
 * Schwellenüberschreitung, Meldung noch offen) oder `offen` (fehlt, kaputt, `unerreichbar`, `keine-daten`, `fehler`). Ohne Bericht nie `erledigt`.
 */
export function wochenStand(json) {
  const status = json && typeof json === "object" ? json.status : undefined;
  if (status === "bericht") return json.urteil?.agentLaufNoetig ? "melden" : "erledigt";
  return status === "gemeldet" || status === "ruhe" ? "erledigt" : "offen";
}

/** Pur: Ordner der Wochenberichte eines Repos (`owner/name`) unter `home` (Standard `~`, die Darstellung für den Ticket-Body). Einzige Quelle des Pfads. */
export function wochenberichtAblage(repo, home = "~") {
  return `${home}/.claude/state/langfuse-wochenbericht/${String(repo).replace("/", "__")}`;
}

/**
 * Pur: Anlass-Text der Auslösung (öffentlich im Body des Status-Tickets, nie roher Fehlertext): `art` `schwelle` (mit `gruende` des Urteils),
 * `fehlt` (mit `klasse` `unerreichbar` oder `fehler`) oder `ohne-daten`.
 */
export function anlassText({ art, montag, gruende = [], klasse }) {
  if (art === "schwelle") return `Wochenbericht ${montag}: Agent-Lauf nötig (${gruende.map((g) => `${g.schwelle} Ist ${Number(g.ist).toFixed(1)}, Soll höchstens ${g.soll}`).join("; ")})`;
  if (art === "ohne-daten") return `Wochenbericht ${montag}: Woche ohne Daten trotz Commits auf main (Erfassung prüfen)`;
  return `Wochenbericht ${montag} fehlt: ${klasse === "unerreichbar" ? "Langfuse unerreichbar" : "Fehler im Live-Weg"} (Details im lokalen Log)`;
}
