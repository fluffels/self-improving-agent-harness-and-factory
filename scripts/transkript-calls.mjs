// Kein Shebang: wird von Messskripten und Tests importiert.
/**
 * Transkript → Calls (#1562, ausgelagert aus `token-baseline.mjs`). Hook-tauglich: importiert nur
 * `preise.mjs` und `transkript.mjs`, keine gh-/git-Kette (`transkript.mjs` ruft git nur in `hauptrepoWurzel()` auf Anfrage auf).
 */

import { num, priceCall, priceParts } from "./preise.mjs";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { frontmatterBlock } from "./skill-pfade.mjs";
import { transkriptZeilen } from "./transkript.mjs";

/**
 * JSONL-Zeilen eines Transkripts → Calls. Claude Code schreibt pro Content-
 * Block eine Zeile mit derselben `message.id`; die Usage wird je Nachricht
 * genau einmal gezählt (Output = Maximum über die Zeilen, weil Zwischenzeilen
 * einen Teilstand tragen). Subagent-Transkripte zeichnen den Output nur beim Stand `message_start` auf (3 bis 8 je
 * Nachricht, #1568); `output` und `cost` bleiben der aufgezeichnete Wert, `outputGeschaetzt`/`costGeschaetzt`
 * ergänzen die Schätzung aus dem Kontext-Zuwachs (`schaetzeOutput`). Je Call zusätzlich `messageId` (Rückfall `uuid`), `sessionId`, `gitBranch`.
 */
export function callsFromTranscript(textOderZeilen, subagent = null) {
  const byId = new Map();
  let questions = 0;
  /** Zeichen der Texte und Tool-Eingaben je Call und Fremdzuwachs (User-Zeilen) bis zum nächsten Call. */
  const sichtbar = new Map();
  const fremd = new Map();
  const unsicher = new Set();
  let offen = null;
  // Text oder die schon geparsten Zeilen (`transkriptZeilen`): `readTranscriptSession` parst jede Zeile nur einmal.
  for (const row of Array.isArray(textOderZeilen) ? textOderZeilen : transkriptZeilen(textOderZeilen)) {
    const msg = row?.message;
    if (offen !== null) {
      if (row?.type === "user") {
        // Nur Tool-Ergebnisse haben eine verlässliche Größe; eigener Text (Aufträge, Skill-Inhalte) kommt mit unbekanntem Anhang in den Kontext.
        if (nurToolErgebnisse(msg?.content)) fremd.set(offen, (fremd.get(offen) ?? 0) + zeichenVon(msg?.content));
        else unsicher.add(offen);
      } else if (row?.type === "system") unsicher.add(offen);
      // Anhänge anderer Art (Hook-Ausgaben, Skill-Inhalte) gehen unbekannt groß in den Kontext: der Zuwachs taugt dann nicht.
      if (row?.type === "attachment") {
        if (KLEINE_ANHAENGE.has(row.attachment?.type)) fremd.set(offen, (fremd.get(offen) ?? 0) + JSON.stringify(row.attachment).length);
        else unsicher.add(offen);
      }
    }
    if (row?.type !== "assistant" || !msg?.usage) continue;
    // Eine Zeile trägt genau einen Content-Block — jede Rückfrage zählt also einmal.
    for (const c of msg.content ?? []) if (c?.type === "tool_use" && c.name === "AskUserQuestion") questions += 1;
    const key = msg.id ?? row.uuid;
    const u = msg.usage;
    const prev = byId.get(key);
    sichtbar.set(key, (sichtbar.get(key) ?? 0) + sichtbareZeichen(msg.content));
    offen = key;
    if (prev) {
      prev.output = Math.max(prev.output, num(u.output_tokens));
      prev.costParts = priceParts(prev);
      prev.cost = prev.costParts ? priceCall(prev) : null;
      continue;
    }
    const call = {
      id: key,
      ts: row.timestamp,
      model: msg.model,
      input: num(u.input_tokens),
      cacheWrite: num(u.cache_creation_input_tokens),
      // Ohne Aufteilung zählt alles als 5m (der günstigere Preis, bewusst nicht geraten).
      cacheWrite1h: num(u.cache_creation?.ephemeral_1h_input_tokens),
      cacheRead: num(u.cache_read_input_tokens),
      output: num(u.output_tokens),
      subagent,
      // Für den Langfuse-Abgleich (#1562): Schlüssel der Nachricht, Session und Branch aus der ersten Zeile der Nachricht.
      messageId: key,
      sessionId: row.sessionId ?? null,
      gitBranch: row.gitBranch ?? null,
    };
    call.costParts = priceParts(call);
    call.cost = call.costParts ? priceCall(call) : null;
    byId.set(key, call);
  }
  const calls = [...byId.values()];
  // Token je Zeichen Fremdtext ist je Transkript verschieden (Code und Zeilennummern tokenisieren dichter als Prosa):
  // die kleinste Rate, die zu einem Output von mindestens dem Sichtbaren passt, ist eine obere Grenze der echten Rate,
  // der daraus geschätzte Output also eine Untergrenze (#1568).
  const luecken = calls.map((c, i) => {
    const naechster = calls[i + 1];
    c.outputSichtbar = Math.ceil((sichtbar.get(c.id) ?? 0) / 4);
    if (!naechster || unsicher.has(c.id)) return null;
    return { zuwachs: kontextVon(naechster) - kontextVon(c), zeichen: fremd.get(c.id) ?? 0 };
  });
  const rate = ratesGrenze(luecken.map((l, i) => (l ? { ...l, sichtbar: calls[i].outputSichtbar } : null)));
  calls.forEach((c, i) => {
    const l = luecken[i];
    const zuwachs = l ? Math.round(l.zuwachs - rate * l.zeichen) : 0;
    c.outputGeschaetzt = schaetzeOutput({ output: c.output, sichtbar: c.outputSichtbar, zuwachs });
    c.costGeschaetzt = preisMitOutput(c, c.outputGeschaetzt);
  });
  return { calls, questions };
}

/** Anhänge, die nur wenige Token in den Kontext bringen und deren Zeichen daher mitzählen. */
const KLEINE_ANHAENGE = new Set(["total_tokens_reminder", "deferred_tools_record"]);

const kontextVon = (c) => num(c.input) + num(c.cacheWrite) + num(c.cacheRead);

const nurToolErgebnisse = (content) => Array.isArray(content) && content.length > 0 && content.every((b) => b?.type === "tool_result");

/** Zeichen eines Content-Werts (Text oder Blöcke: Text, `tool_result`-Inhalt), ohne Binäres zu raten. */
function zeichenVon(content) {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const b of content) {
    if (typeof b === "string") n += b.length;
    else if (b?.type === "text") n += (b.text ?? "").length;
    else if (b?.type === "tool_result") n += zeichenVon(b.content);
  }
  return n;
}

/** Sichtbarer Output einer Assistant-Zeile: Text plus Tool-Eingabe als JSON (Thinking ist verschlüsselt, zählt nicht). */
function sichtbareZeichen(content) {
  let n = 0;
  for (const b of content ?? []) {
    if (b?.type === "text") n += (b.text ?? "").length;
    else if (b?.type === "tool_use") n += JSON.stringify(b.input ?? {}).length;
  }
  return n;
}

/** Kleinste Token-je-Zeichen-Rate über alle Lücken mit Fremdtext (Obergrenze der echten Rate); 0,25 (Zeichen / 4) ohne Lücke. */
export function ratesGrenze(luecken) {
  let rate = Infinity;
  for (const l of luecken) if (l && l.zeichen > 0 && l.zuwachs > 0) rate = Math.min(rate, Math.max(0, l.zuwachs - l.sichtbar) / l.zeichen);
  return Number.isFinite(rate) ? rate : 0.25;
}

/**
 * Output-Schätzung (#1568): der Kontext-Zuwachs bis zum nächsten Call, abzüglich der Fremdtexte (Zeichen mal Rate, `ratesGrenze`), ist
 * der Output dieses Calls (inklusive Thinking). Ohne Nachfolger oder bei schrumpfendem Kontext (Verdichtung) bleibt
 * das Sichtbare (ebenso bei Anhängen unbekannter Größe); Untergrenze, kein Messwert; nie unter dem Sichtbaren und nie unter dem aufgezeichneten Wert.
 */
export function schaetzeOutput({ output, sichtbar, zuwachs }) {
  return Math.max(output, sichtbar, zuwachs > 0 ? zuwachs : 0);
}

function preisMitOutput(c, output) {
  const parts = priceParts({ ...c, output });
  return parts ? priceCall({ ...c, output, costParts: parts }) : null;
}


/**
 * Calls über mehrere Dateien einer Session zusammenführen (#1572): dieselbe `message.id` kann in der Hauptdatei und in einer
 * Subagent-Datei stehen und zählt dann einmal. Der erste Fund bestimmt Rolle und Zeitpunkt, der Output ist das Maximum;
 * Kosten werden aus dem zusammengeführten Stand neu berechnet. Die Eingabe bleibt unverändert.
 */
export function eindeutigeCalls(calls) {
  const byId = new Map();
  for (const c of calls) {
    const key = c.messageId ?? c.id;
    const prev = byId.get(key);
    if (!prev) {
      byId.set(key, c);
      continue;
    }
    const output = Math.max(prev.output, c.output);
    const geschaetzt = Math.max(prev.outputGeschaetzt ?? 0, c.outputGeschaetzt ?? 0);
    if (output === prev.output && geschaetzt === (prev.outputGeschaetzt ?? 0)) continue;
    const merged = { ...prev, output, outputSichtbar: Math.max(prev.outputSichtbar ?? 0, c.outputSichtbar ?? 0) };
    merged.costParts = priceParts(merged);
    merged.cost = merged.costParts ? priceCall(merged) : null;
    if (geschaetzt > 0 || prev.outputGeschaetzt !== undefined) {
      merged.outputGeschaetzt = geschaetzt;
      merged.costGeschaetzt = preisMitOutput(merged, geschaetzt);
    }
    byId.set(key, merged);
  }
  return [...byId.values()];
}

/**
 * Alle Calls einer geladenen Session (`ladeSessionDatei`, factory#290; ausgelagert aus `token-baseline.mjs`): Hauptdatei, dann jeder Subagent
 * mit Deskriptor, am Ende `eindeutigeCalls` (dieselbe `message.id` in Haupt- und Subagent-Datei zählt einmal). `session` setzt die Session-ID
 * nur an die Calls der Hauptdatei. Ergebnis: `{ calls, questions }`. Pur.
 */
export function callsDerSitzung(sitzung, { session } = {}) {
  const all = callsFromTranscript(sitzung.main);
  if (session !== undefined) for (const c of all.calls) c.session = session;
  for (const { datei, meta, zeilen } of sitzung.subagents) {
    const sub = { id: datei, agentType: meta.agentType, description: meta.description, parentAgentId: meta.parentAgentId };
    const r = callsFromTranscript(zeilen, sub);
    all.calls.push(...r.calls);
    all.questions += r.questions;
  }
  return { calls: eindeutigeCalls(all.calls), questions: all.questions };
}

/** Effort-Stufen laut `docs/model-routing.md` (Phasen-Matrix): nur diese Werte gelten als Effort, alles andere fehlt. */
export const EFFORT_STUFEN = ["low", "medium", "high", "xhigh", "max"];

const gueltigerEffort = (v) => (typeof v === "string" && EFFORT_STUFEN.includes(v) ? v : undefined);

/** Assistant-Zeilen mit Array-Inhalt als `[messageId, row]`; `messageId` wie bei den Calls (`message.id`, Rückfall `uuid`). */
function assistantZeilen(zeilen) {
  const out = [];
  for (const row of zeilen) {
    if (row?.type !== "assistant" || !Array.isArray(row.message?.content)) continue;
    const id = row.message.id ?? row.uuid;
    if (id) out.push([id, row]);
  }
  return out;
}

/**
 * Hat die Message Thinking-Blöcke? Claude Code schreibt pro Content-Block eine Zeile mit derselben `message.id`: ODER über die Zeilen
 * (`thinking`/`redacted_thinking` ⇒ true, sonst false). Nur Assistant-Zeilen mit Array-Inhalt; eine Message ohne solche Zeile fehlt in der Map.
 */
export function thinkingJeMessage(zeilen) {
  const map = new Map();
  for (const [id, row] of assistantZeilen(zeilen)) {
    const hat = row.message.content.some((b) => b?.type === "thinking" || b?.type === "redacted_thinking");
    map.set(id, (map.get(id) ?? false) || hat);
  }
  return map;
}

/** `tool_use`-ID → roher `input.effort` (auch undefined) aller Agent-Aufrufe mit ID: wer in der Map steht, wurde gefunden. */
function spawnAufrufe(zeilen) {
  const map = new Map();
  for (const [, row] of assistantZeilen(zeilen)) {
    for (const b of row.message.content) if (b?.type === "tool_use" && b.name === "Agent" && b.id) map.set(b.id, b.input?.effort);
  }
  return map;
}

/** `tool_use`-ID → `effort` des Aufrufs (`input.effort`, nur Werkzeug `Agent`, nur gültige Stufen); ID ohne gültigen Effort fehlt in der Map. */
export function spawnEfforts(zeilen) {
  const map = new Map();
  for (const [id, roh] of spawnAufrufe(zeilen)) if (gueltigerEffort(roh)) map.set(id, roh);
  return map;
}

/**
 * Effort je Message einer Datei aus dem Transkript selbst: Claude Code schreibt `effort` (und gleichlautend `perTurnEffort`) an jede
 * Assistant-Zeile. Ein gültiger Wert gilt; widersprechen sich die Zeilen einer Message, fehlt er (nie raten).
 */
const UNGUELTIG = "ungültig";
function effortJeMessage(zeilen) {
  const werte = new Map();
  for (const [id, row] of assistantZeilen(zeilen)) {
    const set = werte.get(id) ?? new Set();
    const roh = row.effort ?? row.perTurnEffort;
    set.add(roh === undefined ? null : (gueltigerEffort(roh) ?? UNGUELTIG));
    werte.set(id, set);
  }
  return werte;
}

const LEER = { status: "leer" };
const UNBEKANNT = { status: "unbekannt" };

/**
 * Rückfall-Kette für den Effort, wenn die Message keinen beobachteten Wert trägt. `stufen` sind Funktionen mit dem Status
 * `{ status: "wert", wert }` (gilt), `leer` (die Quelle sagt nichts: nächste Stufe) oder `unbekannt` (nicht bestimmbar oder ungültig: Kette endet, kein Wert).
 */
export function effortKette(stufen) {
  for (const stufe of stufen) {
    const s = stufe();
    if (s.status === "wert") return s.wert;
    if (s.status !== "leer") return undefined;
  }
  return undefined;
}

const mtimeVon = (pfad) => {
  try {
    return statSync(pfad).mtimeMs;
  } catch {
    return null;
  }
};

/** Wert einer Frontmatter-Zeile `<schluessel>: <wert>` (ohne Anführungszeichen) oder undefined. */
function frontmatterWert(text, schluessel) {
  const block = frontmatterBlock(text);
  const zeile = block?.split("\n").find((z) => z.startsWith(`${schluessel}:`));
  return zeile === undefined ? undefined : zeile.slice(schluessel.length + 1).trim().replace(/^["']|["']$/g, "");
}

/** Die EINE Agentendefinition (`.claude/agents/*.md`) mit `name: <agentType>` in den Verzeichnissen oder null (keine oder mehrere ⇒ nicht bestimmbar). */
function agentDefinition(agentType, verzeichnisse) {
  const treffer = [];
  for (const dir of verzeichnisse) {
    if (!existsSync(dir)) continue;
    for (const datei of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
      const pfad = join(dir, datei);
      const text = readFileSync(pfad, "utf8");
      if (frontmatterWert(text, "name") === agentType) treffer.push({ pfad, text });
    }
  }
  return treffer.length === 1 ? treffer[0] : null;
}

const statusVon = (v) => (v === undefined ? LEER : gueltigerEffort(v) ? { status: "wert", wert: v } : UNBEKANNT);

/** Stufe „`effort` der `meta.json`“: fehlt das Feld, geht es weiter; ein ungültiger Wert beendet die Kette. */
const effortAusMeta = (meta) => statusVon(meta?.effort);

/** Stufe „`effort` im Agent-`tool_use`“ (über `toolUseId`): nicht auffindbar ⇒ nicht bestimmbar; gefunden ohne `effort` ⇒ weiter. */
function effortAusSpawn(toolUseId, aufrufe) {
  return aufrufe.has(toolUseId) ? statusVon(aufrufe.get(toolUseId)) : UNBEKANNT;
}

/** Stufe „Umgebung“: `CLAUDE_CODE_EFFORT_LEVEL` in der Prozess-Umgebung oder in `env` einer Settings-Datei überschreibt jede Datei-Einstellung. */
function effortUmgebung({ claudeDir, cwd, env }) {
  if (!cwd || !claudeDir || env?.CLAUDE_CODE_EFFORT_LEVEL) return UNBEKANNT;
  for (const pfad of settingsPfade(cwd, claudeDir)) {
    if (!existsSync(pfad)) continue;
    try {
      if (JSON.parse(readFileSync(pfad, "utf8"))?.env?.CLAUDE_CODE_EFFORT_LEVEL) return UNBEKANNT;
    } catch {
      return UNBEKANNT;
    }
  }
  return LEER;
}

/** Stufe „Frontmatter `effort` der Agentendefinition“: nur, wenn die Datei seit Laufbeginn (`start`, ms) unverändert ist. */
function effortAusDefinition(agentType, { claudeDir, cwd }, start) {
  if (!agentType || !cwd || !claudeDir) return UNBEKANNT;
  const def = agentDefinition(agentType, [join(cwd, ".claude", "agents"), join(claudeDir, "agents")]);
  const mtime = def ? mtimeVon(def.pfad) : null;
  if (!def || mtime === null || start === null || mtime > start) return UNBEKANNT;
  return statusVon(frontmatterWert(def.text, "effort"));
}

/** Settings-Dateien in der Rangfolge lokal, Projekt, Benutzer. */
const settingsPfade = (cwd, claudeDir) => [join(cwd, ".claude", "settings.local.json"), join(cwd, ".claude", "settings.json"), join(claudeDir, "settings.json")];

/** Stufe „Effort-Einstellung der Settings“ (`effortLevel`; Rang: lokal, Projekt, Benutzer): jede vorhandene Datei muss seit Laufbeginn unverändert sein. */
function effortAusSettings({ claudeDir, cwd, env }, start) {
  if (!cwd || !claudeDir || start === null || env?.CLAUDE_CODE_EFFORT_LEVEL) return UNBEKANNT;
  let wert;
  for (const pfad of settingsPfade(cwd, claudeDir)) {
    if (!existsSync(pfad)) continue;
    let json;
    try {
      json = JSON.parse(readFileSync(pfad, "utf8"));
    } catch {
      return UNBEKANNT;
    }
    if (mtimeVon(pfad) > start || json?.env?.CLAUDE_CODE_EFFORT_LEVEL) return UNBEKANNT;
    wert ??= json?.effortLevel;
  }
  return statusVon(wert);
}

const textVon = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b?.text ?? "").join(" ") : "");

/** Hat der Benutzer in der Datei den Effort oder das Modell per Slash-Befehl umgestellt? Dann gilt die Settings-Einstellung nicht mehr. */
const hatEffortBefehl = (zeilen) => zeilen.some((r) => r?.type === "user" && /<command-name>\/(effort|model)\b/.test(textVon(r.message?.content)));

/** Laufbeginn einer Datei in ms (frühester Zeitstempel der Assistant-Zeilen) oder null. */
function laufbeginn(zeilen) {
  const ts = assistantZeilen(zeilen).map(([, r]) => Date.parse(r.timestamp)).filter((n) => !Number.isNaN(n));
  return ts.length ? Math.min(...ts) : null;
}

/** Zuordnung einer Datei: `rolle` (`agentType` oder `hauptchat`, undefined = nicht bestimmbar), Rückfall-Effort der Datei (Funktion: Meta, Spawn, Frontmatter, Settings). */
function dateiZuordnungen(zeilen, agentType, rueckfall) {
  const thinking = thinkingJeMessage(zeilen);
  const effort = effortJeMessage(zeilen);
  const out = new Map();
  for (const [id, hat] of thinking) {
    const werte = effort.get(id);
    const beobachtet = werte && werte.size === 1 ? [...werte][0] : undefined;
    const z = { thinking: hat };
    if (agentType) z.agent_type = agentType;
    const e = beobachtet === UNGUELTIG ? undefined : (beobachtet ?? (werte?.has(null) && werte.size === 1 ? rueckfall() : undefined));
    if (e) z.effort = e;
    out.set(id, z);
  }
  return out;
}

const textOderUndefined = (v) => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Zuordnungs-Metadaten je Message (`message.id`, Rückfall `uuid`) einer Session (Form von `ladeSessionDatei`):
 * `{ agent_type?, effort?, thinking? }`, `thinking` schon als `ja`/`nein`.
 * - `agent_type`: Hauptdatei ⇒ `hauptchat`, Subagent ⇒ `agentType` der `meta.json`; fehlt er dort, fehlt der Schlüssel (nie eine Rolle erfinden).
 * - `effort`: der an der Message beobachtete Wert; fehlt er dort, der `effort` der `meta.json`, dann der `effort` im Agent-`tool_use`
 *   (über `toolUseId` der Meta), dann (nur mit `quellen` = `{ claudeDir, env }`) `effort` im Frontmatter der Agentendefinition und die Effort-Einstellung
 *   der Settings (`effortLevel`). Ein fehlendes Feld geht zur nächsten Stufe; ein ungültiger Wert (auch am Zeilenwert), ein nicht auffindbarer Aufruf und jede
 *   Unsicherheit beenden die Kette ohne Schlüssel: Datei seit Laufbeginn geändert (mtime > erster Call der Datei), Definition fehlt oder mehrdeutig,
 *   `cwd` unbekannt oder nicht mehr vorhanden, `CLAUDE_CODE_EFFORT_LEVEL` gesetzt (Umgebung oder Settings-env), kaputte Settings, `/effort`/`/model` in der Hauptdatei.
 * - Steht eine Message in mehr als einer Datei, entfallen `agent_type` und `effort` (Rolle nicht eindeutig); `thinking` bleibt als ODER.
 * Eine EINZIGE Ableitung für den Nachlieferer und den Hook.
 */
export function zuordnungen(sitzung, quellen = null) {
  const aufrufe = spawnAufrufe([...sitzung.main, ...sitzung.subagents.flatMap((s) => s.zeilen)]);
  const mainCwd = sitzung.main.find((r) => r?.cwd)?.cwd;
  const cwdVon = (zeilen) => zeilen.find((r) => r?.cwd)?.cwd ?? mainCwd;
  // Ein `cwd`, das es nicht mehr gibt (entfernter Worktree), macht Projekt-Settings und -Agenten unsichtbar: nicht bestimmbar.
  const umfeld = (zeilen) => ({ claudeDir: quellen?.claudeDir, env: quellen?.env, cwd: existsSync(cwdVon(zeilen) ?? "") ? cwdVon(zeilen) : undefined });
  // Nach `/effort` oder `/model` in der Hauptdatei gilt keine Datei-Einstellung mehr (auch nicht für Subagenten, die den Session-Effort erben).
  const dateiQuellen = quellen && !hatEffortBefehl(sitzung.main);
  const hauptRueckfall = () => (dateiQuellen ? effortKette([() => effortAusSettings(umfeld(sitzung.main), laufbeginn(sitzung.main))]) : undefined);
  const dateien = [
    dateiZuordnungen(sitzung.main, "hauptchat", hauptRueckfall),
    ...sitzung.subagents.map((s) => {
      const agentType = textOderUndefined(s.meta?.agentType);
      const start = laufbeginn(s.zeilen);
      const rueckfall = () =>
        effortKette([
          () => effortAusMeta(s.meta),
          () => effortAusSpawn(s.meta?.toolUseId, aufrufe),
          ...(dateiQuellen ? [() => effortUmgebung(umfeld(s.zeilen)), () => effortAusDefinition(agentType, umfeld(s.zeilen), start), () => effortAusSettings(umfeld(s.zeilen), start)] : []),
        ]);
      return dateiZuordnungen(s.zeilen, agentType, rueckfall);
    }),
  ];
  const out = new Map();
  const mehrfach = new Set();
  for (const q of dateien) {
    for (const [id, z] of q) {
      const alt = out.get(id);
      if (!alt) {
        out.set(id, { ...z });
        continue;
      }
      mehrfach.add(id);
      alt.thinking = alt.thinking || z.thinking;
    }
  }
  for (const id of mehrfach) {
    delete out.get(id).agent_type;
    delete out.get(id).effort;
  }
  for (const z of out.values()) z.thinking = z.thinking ? "ja" : "nein";
  return out;
}
