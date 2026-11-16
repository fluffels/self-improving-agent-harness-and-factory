/**
 * Langfuse-Auswertung (factory#289): pure Lib, die aus selbstbeschreibenden `queryMetrics`-Exporten einen
 * deterministischen Kostenbericht baut (Live, Nachgeliefert, Codex, sonstige getrennt; je Rolle, Repo, Effort, Modell).
 * Einziger Import ist das pure `langfuse-otlp.mjs` (nur `node:crypto` und `preise.mjs`; kein fs, kein env, kein Netz): die CLI
 * `langfuse-auswertung.mjs` ist der einzige Adapter, und kein Modul dieser Hülle liest den Langfuse-Secret-Key (ein Test hält
 * die Import-Hülle fest). `EFFORT_STUFEN` ist hier neu deklariert statt aus `transkript-calls.mjs` importiert (nicht
 * schlüsselnah, hätte der Lib aber Imports gebracht); ein Test sichert die Gleichheit.
 *
 * `rezept()` nimmt optional `projektFilter` (factory#313: Wochenbericht), der an jede Abfrage hängt; ohne ihn bleibt die Ausgabe unverändert.
 *
 * Export-Form: `{ art, abfrage, data }` (Abfragerezept: `rezept()`), Zeilenschlüssel wie die MCP-Ausgabe
 * (`count_count`, `sum_totalCost`, `min_latency`, `time_dimension`).
 * Bekannte Grenzen: negative Latenzen lassen sich nur je Gruppe (nicht je Observation) erkennen, weil `queryMetrics`
 * `id` nur mit `orderBy desc` zulässt; die ganze Gruppe wird dann Datenlücke. Dubletten Live/Nachgeliefert werden nicht
 * abgezogen (Stichprobe factory#286: keine belegt).
 */

import { TRACE_NAME } from "./langfuse-otlp.mjs";

export const TRACE_NAME_ABGLEICH = TRACE_NAME;
export const EFFORT_STUFEN = ["low", "medium", "high", "xhigh", "max"];
/** Eingebaute Agent-Typen des Hauptchats (geschlossene Liste; eigene Agenten kommen per `--rolle`). */
export const EINGEBAUTE_ROLLEN = ["general-purpose", "Explore", "Plan", "statusline-setup", "claude-code-guide"];
/** Namenspräfix, mit dem die Audit-Markierung Kopien kennzeichnet (Metadatum `audit_status: duplicate`). */
export const AUDIT_PRAEFIX = "[duplicate audit] ";
export const ROW_LIMIT = 1000;
/** Fehlercode (`code`) eines Exports am Zeilenlimit: der Wochenbericht macht daraus Exit 4 statt Exit 1 (factory#406). */
export const ABGESCHNITTEN = "abgeschnitten";
export const UNZUGEORDNET = "unzugeordnet";
export const ROLLE_SCHLUESSEL = ["agent_type", "agent_role"];
export const EFFORT_SCHLUESSEL = ["effort", "reasoning_effort"];
export const QUELLEN = ["live", "nachgeliefert", "codex", "sonstige"];
export const ARTEN = ["gesamt", "tage", "latenz", "metadaten", "leer"];
/** Modellname der leeren Hook-GENERATIONs des Plugins (factory#522: Modell `claude`, leere Usage, eine je Tool-Call). */
export const LEER_MODELL = "claude";
/** Filter aller Kosten- und Zähl-Abfragen; nur der Export `leer` trägt ihn nicht. */
export const LEER_FILTER = { column: "providedModelName", operator: "none of", value: [LEER_MODELL], type: "stringOptions" };
const EPS = 1e-9;
const DIMS_GESAMT = ["traceName", "name", "providedModelName", "environment"];
const MS_TAG = 86400000;

const istAudit = (name) => typeof name === "string" && name.startsWith(AUDIT_PRAEFIX);
const ohnePraefix = (name) => (istAudit(name) ? name.slice(AUDIT_PRAEFIX.length) : name);
const leer = (v) => v === undefined || v === null || String(v).trim() === "";
const keyVon = (z) => DIMS_GESAMT.map((d) => String(z[d] ?? "")).join("\u0001");
const sortName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Quelle einer Generation: nachgeliefert (Trace „Abgleich“), codex, live (Plugin) oder sonstige (sichtbar). */
export function quelleVon(traceName, name) {
  const n = ohnePraefix(name);
  if (traceName === TRACE_NAME_ABGLEICH) return "nachgeliefert";
  if (n === "Model response" || String(traceName).startsWith("Codex:")) return "codex";
  if (traceName === "Claude Code Turn" || n === "LLM Call" || n === "Subagent LLM Call") return "live";
  return "sonstige";
}

// ── Rezept ───────────────────────────────────────────────────────────────────

/** Erlaubte Projektfilter von `rezept()` (factory#313): `environment = <wert>` oder `tags any of [<wert>…]`; beide sind nie `stringObject`, `metaFilter` zählt sie nicht. */
export function pruefeProjektFilter(f) {
  const ok = f && typeof f === "object" && (
    (f.column === "environment" && f.operator === "=" && f.type === "string" && typeof f.value === "string" && f.value !== "") ||
    (f.column === "tags" && f.operator === "any of" && f.type === "arrayOptions" && Array.isArray(f.value) && f.value.length > 0 && f.value.every((v) => typeof v === "string" && v !== ""))
  );
  if (!ok) throw new Error("projektFilter muss { column: environment, operator: =, type: string, value } oder { column: tags, operator: any of, type: arrayOptions, value: [..] } sein");
  return f;
}

const basisAbfrage = (von, bis, projektFilter) => ({
  view: "observations",
  filters: [{ column: "type", operator: "=", value: "GENERATION", type: "string" }, ...(projektFilter ? [pruefeProjektFilter(projektFilter)] : [])],
  fromTimestamp: von,
  toTimestamp: bis,
  config: { row_limit: ROW_LIMIT },
});
const dim = (felder) => felder.map((field) => ({ field }));

/** Abfragen für den Agentenlauf (MCP `queryMetrics`); jede gespeicherte Antwort wird `{ art, abfrage, data }`. */
export function rezept({ von, bis, rollen = [], efforts = EFFORT_STUFEN, codexRollen = ["main", "subagent"], projektFilter }) {
  const basisFilter = basisAbfrage(von, bis, projektFilter).filters;
  const b = (extra) => ({ ...basisAbfrage(von, bis, projektFilter), filters: [...basisFilter, LEER_FILTER], ...extra });
  const out = [
    { art: "gesamt", name: "gesamt", abfrage: b({ dimensions: dim(DIMS_GESAMT), metrics: [{ measure: "count", aggregation: "count" }, { measure: "totalCost", aggregation: "sum" }], orderBy: [{ field: "sum_totalCost", direction: "desc" }] }) },
    { art: "tage", name: "tage", abfrage: b({ dimensions: [], metrics: [{ measure: "count", aggregation: "count" }, { measure: "totalCost", aggregation: "sum" }], timeDimension: { granularity: "day" } }) },
    { art: "latenz", name: "latenz", abfrage: b({ dimensions: dim(DIMS_GESAMT), metrics: [{ measure: "latency", aggregation: "min" }, { measure: "count", aggregation: "count" }, { measure: "totalCost", aggregation: "sum" }] }) },
  ];
  const rollenListe = [...new Set(["hauptchat", "unbekannt", ...EINGEBAUTE_ROLLEN, ...rollen])];
  const paare = [
    ...rollenListe.map((w) => ["agent_type", w]),
    ...efforts.map((w) => ["effort", w]),
    ...codexRollen.map((w) => ["agent_role", w]),
  ];
  for (const [key, value] of paare) {
    out.push({
      art: "metadaten",
      name: `metadaten ${key}=${value}`,
      abfrage: b({
        dimensions: dim(DIMS_GESAMT),
        metrics: [{ measure: "count", aggregation: "count" }, { measure: "totalCost", aggregation: "sum" }, { measure: "latency", aggregation: "min" }],
        filters: [...basisFilter, { column: "metadata", key, operator: "=", value, type: "stringObject" }, LEER_FILTER],
      }),
    });
  }
  const leerAbfrage = { ...basisAbfrage(von, bis, projektFilter), dimensions: dim(["providedModelName"]), metrics: [{ measure: "count", aggregation: "count" }, { measure: "totalCost", aggregation: "sum" }, { measure: "totalTokens", aggregation: "sum" }], orderBy: [{ field: "count_count", direction: "desc" }] };
  out.push({ art: "leer", name: "leer", abfrage: leerAbfrage });
  return out;
}

// ── Export lesen und prüfen ──────────────────────────────────────────────────

const fehler = (pfad, text) => new Error(`${pfad}: ${text} (Abfragerezept: node scripts/langfuse-auswertung.mjs --rezept)`);
/** Der Fehler eines Exports mit `ROW_LIMIT` oder mehr Zeilen, erkennbar am `code`. */
export const abgeschnittenFehler = (pfad, n) => Object.assign(fehler(pfad, `Export abgeschnitten (${n} Zeilen = row_limit): Fenster enger wählen`), { code: ABGESCHNITTEN });

const hatGenerationFilter = (abfrage) =>
  Array.isArray(abfrage?.filters) && abfrage.filters.some((f) => f?.column === "type" && f.operator === "=" && String(f.value).toUpperCase() === "GENERATION");

const istLeerFilter = (f) => f?.column === "providedModelName" && f.operator === "none of" && Array.isArray(f.value) && f.value.includes(LEER_MODELL);
const hatFilter = (abfrage, pred) => Array.isArray(abfrage?.filters) && abfrage.filters.some(pred);
const hatModellDimension = (abfrage) => Array.isArray(abfrage?.dimensions) && abfrage.dimensions.some((d) => d?.field === "providedModelName");

const fensterLesbar = (a) => !Number.isNaN(Date.parse(a.fromTimestamp)) && !Number.isNaN(Date.parse(a.toTimestamp));

function pruefeKopf(json, pfad) {
  if (!json || typeof json !== "object" || !("art" in json)) {
    throw fehler(pfad, "kein selbstbeschreibender Export { art, abfrage, data } (nacktes {data} oder Array)");
  }
  if (!ARTEN.includes(json.art)) throw fehler(pfad, `unbekannte art ${JSON.stringify(json.art)}`);
  if (!Array.isArray(json.data)) throw fehler(pfad, "data fehlt oder ist kein Array");
  if (!hatGenerationFilter(json.abfrage)) throw fehler(pfad, "Filter type = GENERATION fehlt (Spans mit Rolle unbekannt würden mitzählen)");
  if (!fensterLesbar(json.abfrage)) throw fehler(pfad, "Fenster (fromTimestamp/toTimestamp) fehlt oder ist kein Zeitstempel in abfrage");
  if (json.art === "leer") {
    if (hatFilter(json.abfrage, (f) => f?.column === "providedModelName")) throw fehler(pfad, "Export leer darf keinen Filter auf providedModelName tragen (er zählt gerade das Modell claude)");
    if (!hatModellDimension(json.abfrage)) throw fehler(pfad, "Export leer braucht die Dimension providedModelName");
  } else if (!hatFilter(json.abfrage, istLeerFilter)) {
    throw fehler(pfad, "Filter providedModelName none of [claude] fehlt (die leeren Hook-Generations würden mitzählen, factory#522)");
  }
  if (json.data.length >= ROW_LIMIT) throw abgeschnittenFehler(pfad, json.data.length);
}

function metaFilter(abfrage, pfad) {
  const fs = abfrage.filters.filter((f) => f?.type === "stringObject");
  if (fs.length !== 1) throw fehler(pfad, `metadaten braucht genau einen stringObject-Filter (gefunden: ${fs.length})`);
  const f = fs[0];
  if (f.column !== "metadata" || f.operator !== "=" || typeof f.key !== "string" || typeof f.value !== "string") {
    throw fehler(pfad, "stringObject-Filter muss column metadata, operator =, key und value als Text tragen");
  }
  if (![...ROLLE_SCHLUESSEL, ...EFFORT_SCHLUESSEL].includes(f.key)) throw fehler(pfad, `Metadaten-Schlüssel ${f.key} ist nicht auswertbar`);
  return { schluessel: f.key, wert: f.value };
}

const zeigeZeile = (art, i) => `${art}-Zeile ${i + 1}`;
const numerisch = (v) => v !== null && Number.isFinite(Number(v));

/** Kosten null (queryMetrics liefert Summen ohne Preis als null) sind gültig; fehlender Schlüssel oder Nicht-Zahl nicht. */
const kostenOk = (v) => v === null || numerisch(v);

/**
 * Normalisiert eine Zeile; fehlende oder nicht numerische Metriken sind ein Formfehler, nie eine stille 0. Kosten null bei
 * Calls zählen mit 0 $ und tragen `ohnePreis`: der Bericht nennt sie als Datenlücke.
 */
function zeileVon(r, art, pfad, i) {
  const z = { traceName: r?.traceName, name: r?.name, providedModelName: r?.providedModelName, environment: r?.environment };
  if (!numerisch(r?.count_count) || !kostenOk(r?.sum_totalCost)) {
    throw fehler(pfad, `${zeigeZeile(art, i)} ohne numerische Metriken count_count und sum_totalCost`);
  }
  const kosten = { count: Number(r.count_count), cost: Number(r.sum_totalCost), ohnePreis: r.sum_totalCost === null ? Number(r.count_count) : 0 };
  if (art === "gesamt") return { ...z, key: keyVon(z), ...kosten, minLatency: null };
  if (!numerisch(r.min_latency)) throw fehler(pfad, `${zeigeZeile(art, i)} ohne numerisches min_latency (Negativ-Latenz nicht prüfbar)`);
  return { ...z, key: keyVon(z), ...kosten, minLatency: Number(r.min_latency) };
}

/** Zeile des Exports `leer`: Modell, Calls, Kosten (null = ohne Preis, zählt 0) und Tokens (null = 0); fehlende oder nicht numerische Werte sind ein Formfehler. */
function leerZeileVon(r, pfad, i) {
  if (!numerisch(r?.count_count) || !kostenOk(r?.sum_totalCost) || !kostenOk(r?.sum_totalTokens)) {
    throw fehler(pfad, `${zeigeZeile("leer", i)} ohne numerische Metriken count_count, sum_totalCost und sum_totalTokens`);
  }
  return { providedModelName: r.providedModelName ?? null, count: Number(r.count_count), cost: Number(r.sum_totalCost ?? 0), tokens: Number(r.sum_totalTokens ?? 0) };
}

/** Prüft einen Export und liefert `{ art, pfad, von, bis, data, zeilen, schluessel?, wert? }`; wirft bei jedem Formfehler. */
export function leseExport(json, pfad) {
  pruefeKopf(json, pfad);
  const ex = { art: json.art, pfad, von: json.abfrage.fromTimestamp, bis: json.abfrage.toTimestamp, data: json.data };
  if (json.art === "leer") ex.zeilen = json.data.map((r, i) => leerZeileVon(r, pfad, i));
  else ex.zeilen = json.art === "tage" ? [] : json.data.map((r, i) => zeileVon(r, json.art, pfad, i));
  return json.art === "metadaten" ? { ...ex, ...metaFilter(json.abfrage, pfad) } : ex;
}

/** Alle Exporte teilen ein Fenster, `gesamt` kommt genau einmal vor, jede andere Art höchstens einmal je Schlüssel. */
export function pruefeExporte(exporte) {
  if (!exporte.length) throw fehler("Exporte", "kein Export übergeben");
  const fenster = new Set(exporte.map((e) => `${e.von}|${e.bis}`));
  if (fenster.size > 1) throw fehler("Exporte", `ungleiche Fenster: ${[...fenster].join(" ; ")}`);
  const doppelt = new Set();
  for (const e of exporte) {
    const id = `${e.art}|${e.schluessel}|${e.wert}`;
    if (doppelt.has(id)) throw fehler("Exporte", `Export ${e.art}${e.schluessel ? ` ${e.schluessel}=${e.wert}` : ""} mehrfach (${e.pfad})`);
    doppelt.add(id);
  }
  if (!exporte.some((e) => e.art === "gesamt")) throw fehler("Exporte", "der Export gesamt fehlt");
}

// ── Aufbereitung ─────────────────────────────────────────────────────────────

/** UTC-Tage, die das Fenster schneiden und im Tage-Export keine Zeile mit Calls haben (`queryMetrics` liefert einen leeren Tag als Zeile mit `count_count` 0 und `sum_totalCost` null). */
export function tagesLuecken(von, bis, tageData) {
  const have = new Set(tageData.filter((r) => Number(r.count_count) > 0).map((r) => String(r.time_dimension).slice(0, 10)));
  const start = Date.parse(von);
  const ende = Date.parse(bis);
  const out = [];
  for (let t = Math.floor(start / MS_TAG) * MS_TAG; t < ende; t += MS_TAG) {
    const tag = new Date(t).toISOString().slice(0, 10);
    if (!have.has(tag)) out.push(tag);
  }
  return out;
}

/** Gesamt-Zeilen tragen `minLatency: null` (`null < 0` ist falsch), Latenz- und Metadaten-Zeilen eine Zahl. */
const istNegativ = (z) => z.minLatency < 0;
const summe = (liste) => liste.reduce((s, z) => ({ count: s.count + z.count, cost: s.cost + z.cost }), { count: 0, cost: 0 });
const vereinige = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])].sort(sortName);
/** Wie `summe`, dazu `ohnePreis` (Calls ohne Preis) und `modelle` dieser Calls (factory#522: Kosten sind dann nur eine Untergrenze). */
const summeP = (liste) => ({ ...summe(liste), ohnePreis: liste.reduce((s, z) => s + (z.ohnePreis ?? 0), 0), modelle: liste.reduce((m, z) => vereinige(m, z.modelle), []) });
const nurPreis = (p) => ({ ohnePreis: p.ohnePreis, modelle: p.modelle });

/** Betrag einer Gruppe: ohne Preislücke die Dollarzahl, komplett ohne Preis die Lücke, sonst die Untergrenze (nie 0 $ für fehlende Preise). */
export function betrag({ cost, count, ohnePreis = 0, modelle = [] }) {
  if (!(ohnePreis > 0)) return usd(cost);
  if (ohnePreis >= count) return `Lücke: ohne Preis (${modelle.join(", ")})`;
  return `mindestens ${usd(cost)}, ohne ${ohnePreis} Calls`;
}

function anreichern(z) {
  const modell = leer(z.providedModelName) ? UNZUGEORDNET : z.providedModelName;
  return { ...z, modell, modelle: z.ohnePreis > 0 ? [modell] : [], quelle: quelleVon(z.traceName, z.name), repo: leer(z.environment) || z.environment === "default" ? UNZUGEORDNET : z.environment };
}

/** Teilt `gesamt` in Basis (geht in die bereinigten Summen), Audit-Kopien und Gruppen mit negativer Latenz. */
function teile(gesamtZeilen, latenzZeilen) {
  const negativ = new Set((latenzZeilen ?? []).filter(istNegativ).map((z) => z.key));
  const basis = new Map();
  const audit = [];
  const neg = [];
  const ohnePreis = [];
  for (const z of gesamtZeilen.map(anreichern).sort((a, b) => sortName(a.key, b.key))) {
    if (istAudit(z.name)) audit.push(z);
    else if (negativ.has(z.key)) neg.push(z);
    else {
      basis.set(z.key, basis.has(z.key) ? { ...z, ...summeP([basis.get(z.key), z]) } : z);
      if (z.ohnePreis) ohnePreis.push(z);
    }
  }
  const ausgeschlossen = new Set([...audit, ...neg].map((z) => z.key));
  return { basis, audit: summeP(audit), negativ: { gruppen: neg.length, ...summeP(neg) }, ausgeschlossen, ohnePreis };
}

const zellenLabel = (z) => (z.wert === "unbekannt" ? UNZUGEORDNET : z.schluessel === "agent_type" ? z.wert : `${z.schluessel}:${z.wert}`);

/** Posten der Metadaten-Zellen; merkt Summen je Gruppe, Gruppen mit negativer Latenz und Zellen ohne Gegenstück. */
function zellenPosten(teil, metaExporte) {
  const st = { posten: [], zugeteilt: new Map(), kaputt: new Set(), ohneGegenstueck: 0 };
  const zellen = metaExporte.flatMap((e) => e.zeilen.map((r) => ({ ...r, schluessel: e.schluessel, wert: e.wert })));
  zellen.sort((a, b) => sortName(`${a.key}|${a.schluessel}|${a.wert}`, `${b.key}|${b.schluessel}|${b.wert}`));
  for (const z of zellen) {
    const b = teil.basis.get(z.key);
    if (!b) {
      if (!teil.ausgeschlossen.has(z.key)) st.ohneGegenstueck += 1;
    } else if (istNegativ(z)) {
      st.kaputt.add(z.key);
    } else {
      st.zugeteilt.set(z.key, summeP([st.zugeteilt.get(z.key) ?? { count: 0, cost: 0 }, z]));
      st.posten.push({ key: z.key, quelle: b.quelle, label: zellenLabel(z), count: z.count, cost: z.cost, ohnePreis: z.ohnePreis, modelle: z.ohnePreis > 0 ? [b.modell] : [], art: z.wert === "unbekannt" ? "unbekannt" : "wert" });
    }
  }
  return st;
}

/** Rest je Basiszeile (Generations ohne Zelle dieser Dimension); Gruppen mit negativer Zelle fallen als Lücke heraus. */
/** Ein Rest ist unstimmig, wenn er Calls oder Kosten unter 0 hat oder Kosten ohne Calls (die Zelle war billiger als die Gruppe bei gleichen Calls). */
const restKaputt = (r) => r.count < 0 || r.cost < -EPS || (r.count === 0 && r.cost > EPS);

function restPosten(teil, st) {
  const out = { posten: [], inkonsistent: 0, luecke: { count: 0, cost: 0 } };
  for (const b of teil.basis.values()) {
    const z = st.zugeteilt.get(b.key) ?? { count: 0, cost: 0 };
    const rest = { count: b.count - z.count, cost: b.cost - z.cost, ohnePreis: Math.max(0, (b.ohnePreis ?? 0) - (z.ohnePreis ?? 0)) };
    if (st.kaputt.has(b.key)) out.luecke = summe([out.luecke, b]);
    else if (restKaputt(rest)) out.inkonsistent += 1;
    else out.posten.push({ key: b.key, quelle: b.quelle, label: UNZUGEORDNET, count: rest.count, cost: Math.max(0, rest.cost), ohnePreis: rest.ohnePreis, modelle: rest.ohnePreis > 0 ? b.modelle : [], art: "rest" });
  }
  return out;
}

/** Posten je Zelle und Rest je Basiszeile für eine Dimension (Rolle oder Effort). */
function dimensionPosten(teil, metaExporte, name) {
  const st = zellenPosten(teil, metaExporte);
  const rest = restPosten(teil, st);
  const luecken = [];
  if (!metaExporte.length) luecken.push(`${name}: kein Metadaten-Export, nichts zugeordnet (alles unzugeordnet)`);
  if (st.kaputt.size) luecken.push(`${name}: ${st.kaputt.size} Gruppe(n) mit negativer Latenz in einer Metadaten-Zelle, ${rest.luecke.count} Calls (${usd(rest.luecke.cost)}) aus den Summen genommen`);
  if (rest.inkonsistent || st.ohneGegenstueck) luecken.push(`${name}: Exporte nicht konsistent (${rest.inkonsistent} Zeile(n) mit Rest unter 0 oder Kosten ohne Calls, ${st.ohneGegenstueck} Zelle(n) ohne Gegenstück in gesamt; Fenster in der Vergangenheit wählen)`);
  return { posten: [...st.posten, ...rest.posten], luecken };
}

const usd = (x) => `${x.toFixed(2)} $`;

/** Gruppiert Posten je Label; die Zeile „unzugeordnet“ steht immer (auch mit 0). */
const leerePosten = () => ({ count: 0, cost: 0, ohnePreis: 0, modelle: [] });
const addPosten = (ziel, p) => {
  ziel.count += p.count;
  ziel.cost += p.cost;
  ziel.ohnePreis += p.ohnePreis ?? 0;
  ziel.modelle = vereinige(ziel.modelle, p.modelle);
};

export function tabelle(posten) {
  const zeilen = new Map([[UNZUGEORDNET, { name: UNZUGEORDNET, ...leerePosten(), quellen: {}, quellenInfo: {} }]]);
  const davon = { unbekannt: { count: 0, cost: 0 }, ohneSchluessel: { count: 0, cost: 0 } };
  for (const p of posten) {
    const z = zeilen.get(p.label) ?? { name: p.label, ...leerePosten(), quellen: {}, quellenInfo: {} };
    addPosten(z, p);
    z.quellen[p.quelle] = (z.quellen[p.quelle] ?? 0) + p.cost;
    z.quellenInfo[p.quelle] ??= leerePosten();
    addPosten(z.quellenInfo[p.quelle], p);
    zeilen.set(p.label, z);
    if (p.label === UNZUGEORDNET) {
      const ziel = p.art === "unbekannt" ? davon.unbekannt : davon.ohneSchluessel;
      ziel.count += p.count;
      ziel.cost += p.cost;
    }
  }
  const alle = [...zeilen.values()];
  const rest = alle.filter((z) => z.name === UNZUGEORDNET);
  const rang = alle.filter((z) => z.name !== UNZUGEORDNET).sort((a, b) => b.cost - a.cost || sortName(a.name, b.name));
  return { zeilen: [...rang, ...rest], summe: summe(alle), preis: nurPreis(summeP(alle)), davon };
}

const postenAusBasis = (basis, feld) => [...basis.values()].map((b) => ({ quelle: b.quelle, label: b[feld], count: b.count, cost: b.cost, ohnePreis: b.ohnePreis, modelle: b.modelle, art: "wert" }));

/** Lücke für Gruppen mit Calls, aber ohne Preis (Kosten null): die Summen zählen sie mit 0 $, das ist nie still. */
function preisLuecke(ohnePreis) {
  if (!ohnePreis.length) return [];
  const modelle = [...new Set(ohnePreis.map((z) => z.modell))].sort(sortName).join(", ");
  return [`Kosten unvollständig: ${summe(ohnePreis).count} Calls in ${ohnePreis.length} Gruppen ohne Preis (${modelle})`];
}

/** Baut den Bericht aus geprüften Exporten (`leseExport`); wirft bei inkonsistenter Exportmenge. */
export function bericht(exporte) {
  pruefeExporte(exporte);
  const gesamt = exporte.find((e) => e.art === "gesamt");
  const latenz = exporte.find((e) => e.art === "latenz");
  const tage = exporte.find((e) => e.art === "tage");
  const teil = teile(gesamt.zeilen, latenz?.zeilen);
  const tageFehlend = tage ? tagesLuecken(gesamt.von, gesamt.bis, tage.data) : null;
  const rolle = dimensionPosten(teil, exporte.filter((e) => e.art === "metadaten" && ROLLE_SCHLUESSEL.includes(e.schluessel)), "Rolle");
  const effort = dimensionPosten(teil, exporte.filter((e) => e.art === "metadaten" && EFFORT_SCHLUESSEL.includes(e.schluessel)), "Effort");
  const leer2 = leerAuswerten(exporte.find((e) => e.art === "leer"), summe(gesamt.zeilen).count);
  const luecken = [
    ...(tage ? [] : ["Tage nicht geprüft (Export tage fehlt)"]),
    ...(tageFehlend?.length ? [`Tage ohne Daten: ${tageFehlend.join(", ")}`] : []),
    ...(latenz ? [] : ["negative Latenzen nicht geprüft (Export latenz fehlt)"]),
    ...preisLuecke(teil.ohnePreis),
    ...(teil.negativ.gruppen ? [`negative Latenzen: ${teil.negativ.gruppen} Gruppe(n) mit min_latency unter 0, ${teil.negativ.count} Calls (${usd(teil.negativ.cost)}), aus allen Summen genommen`] : []),
    ...rolle.luecken,
    ...effort.luecken,
    ...leer2.luecken,
  ];
  const basisSumme = summeP([...teil.basis.values()]);
  return {
    fenster: { von: gesamt.von, bis: gesamt.bis },
    vermerk: tage ? (tageFehlend.length ? ` (ohne Tag ${tageFehlend.join(", ")})` : "") : " (Tage nicht geprüft)",
    roh: summe([basisSumme, teil.audit, teil.negativ]),
    bereinigt: summe([basisSumme]),
    preis: { roh: nurPreis(summeP([basisSumme, teil.audit, teil.negativ])), bereinigt: nurPreis(basisSumme) },
    leer: leer2.leer,
    audit: summe([teil.audit]),
    negativ: { gruppen: teil.negativ.gruppen, count: teil.negativ.count, cost: teil.negativ.cost },
    quelle: tabelle(postenAusBasis(teil.basis, "quelle")),
    modell: tabelle(postenAusBasis(teil.basis, "modell")),
    repo: tabelle(postenAusBasis(teil.basis, "repo")),
    rolle: tabelle(rolle.posten),
    effort: tabelle(effort.posten),
    unzugeordnet: unzugeordnetGesamt(teil, rolle),
    luecken,
    dubletten: "Dubletten Live/Nachgeliefert: nicht abgezogen (Stichprobe factory#286: keine belegt)",
  };
}

/**
 * Leere Hook-Generations (Modell `claude`, Tokens 0) aus dem Kontroll-Export `leer`: Anzahl für die eigene Zeile, nie in Summen.
 * Modell `claude` mit Tokens über 0 ist keine leere Generation, sondern eine Datenlücke; die Summe aller Zeilen ohne `claude` muss die Calls von `gesamt` ergeben, sonst schließt der Filter (NULL-Modell) still etwas aus.
 */
function leerAuswerten(ex, gesamtCalls) {
  if (!ex) return { leer: null, luecken: ["leere Hook-Generations: nicht geprüft (Export leer fehlt)"] };
  const claude = ex.zeilen.filter((z) => z.providedModelName === LEER_MODELL);
  const mitUsage = summe(claude.filter((z) => z.tokens > 0));
  const tokens = claude.filter((z) => z.tokens > 0).reduce((s, z) => s + z.tokens, 0);
  const luecken = [];
  if (mitUsage.count > 0) luecken.push(`Modell claude mit Usage: ${mitUsage.count} Calls, ${tokens} Tokens (nicht in Summen, keine leeren Hook-Generations)`);
  const ohneClaude = summe(ex.zeilen.filter((z) => z.providedModelName !== LEER_MODELL)).count;
  if (ohneClaude !== gesamtCalls) luecken.push(`Kontrolle leere Hook-Generations: Export leer führt ${ohneClaude} Calls ohne Modell claude, gesamt ${gesamtCalls} (Differenz ${gesamtCalls - ohneClaude}: der Filter none of schließt Generations aus, z. B. ohne Modell, oder das Fenster war noch offen)`);
  return { leer: { count: summe(claude.filter((z) => z.tokens === 0)).count }, luecken };
}

const leerZeile = (l) => (l ? `leere Hook-Generations: ${l.count} (nicht gezählt)` : "leere Hook-Generations: nicht geprüft (Export leer fehlt)");

/** Generations ohne Rolle (Schlüssel fehlt oder `unbekannt`) oder ohne Modell; ohne Rollen-Export gilt alles als ohne Rolle. */
function unzugeordnetGesamt(teil, rolle) {
  const ohneModell = [...teil.basis.values()].filter((b) => b.modell === UNZUGEORDNET);
  const ohneRolle = rolle.posten.filter((p) => p.label === UNZUGEORDNET && teil.basis.get(p.key).modell !== UNZUGEORDNET);
  return summe([...ohneModell, ...ohneRolle]);
}

// ── Darstellung ──────────────────────────────────────────────────────────────

const quellenKopf = "| Name | Calls | Live | Nachgeliefert | Codex | sonstige | Σ |";

function tabellenZeilen(t) {
  return t.zeilen.map((z) => `| ${z.name} | ${z.count} | ${QUELLEN.map((q) => betrag(z.quellenInfo[q] ?? leerePosten())).join(" | ")} | ${betrag(z)} |`);
}

function abschnitt(titel, t, vermerk, mitDavon) {
  const out = [`## ${titel}${vermerk}`, "", quellenKopf, "| --- | --- | --- | --- | --- | --- | --- |", ...tabellenZeilen(t), ""];
  if (mitDavon) out.push(`Davon unzugeordnet: unbekannt ${t.davon.unbekannt.count} Calls (${usd(t.davon.unbekannt.cost)}); ohne Schlüssel oder Wert ohne Export ${t.davon.ohneSchluessel.count} Calls (${usd(t.davon.ohneSchluessel.cost)}).`, "");
  return out;
}

/** Deterministischer Markdown-Bericht (Sortierung: Kosten absteigend, dann Name). */
export function renderMarkdown(b) {
  const v = b.vermerk;
  const n = b.negativ;
  return [
    `# Langfuse-Auswertung ${b.fenster.von} bis ${b.fenster.bis}`,
    "",
    `Gesamt${v}: roh ${betrag({ ...b.roh, ...b.preis.roh })} (${b.roh.count} Calls), bereinigt ${betrag({ ...b.bereinigt, ...b.preis.bereinigt })} (${b.bereinigt.count} Calls; ohne negative Latenzen ${n.count} Calls ${usd(n.cost)}, ohne doppelte Audit-Markierungen ${b.audit.count} Calls ${usd(b.audit.cost)}).`,
    leerZeile(b.leer),
    b.dubletten,
    `unzugeordnet${v}: ${b.unzugeordnet.count} Calls (${usd(b.unzugeordnet.cost)}) ohne Rolle oder ohne Modell.`,
    "",
    ...abschnitt("Quelle", b.quelle, v, false),
    ...abschnitt("Je Rolle", b.rolle, v, true),
    ...abschnitt("Je Repo", b.repo, v, false),
    ...abschnitt("Je Effort", b.effort, v, true),
    ...abschnitt("Je Modell", b.modell, v, false),
    "## Datenlücken",
    "",
    ...(b.luecken.length ? b.luecken.map((l) => `- ${l}`) : ["- keine"]),
    "",
  ].join("\n");
}
