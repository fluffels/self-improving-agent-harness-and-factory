/* Harness-Doctor, Punkt `Langfuse` (factory#362 L30): wertet die `--json`-Ausgabe von `node scripts/langfuse-vorbedingung.mjs --json` aus
 * (`{ erreichbar, grund, mcp }`; ein getrenntes MCP ist dort Exit 0 mit `mcp.status: "getrennt"`). Unterscheidet zwei Lücken mit je eigenem Fix:
 * Langfuse selbst nicht erreichbar (starten) und erreichbar, aber die MCP-Verbindung dieser Session getrennt (neu verbinden). Der MCP-Abgleich
 * läuft nur unter Claude Code (`CLAUDECODE=1`, im Vorbedingungs-Skript); sonst bleibt der Punkt OK (belegte Grenze). Pur: bekommt das `spawnSync`-Ergebnis. */
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { projektTagsAus } from "./langfuse-otlp.mjs";

const PUNKT = "Langfuse";
const FIX_JSON = "`node scripts/langfuse-vorbedingung.mjs --json` prüfen";

/** Der Punkt `Langfuse` aus `{ status, stdout, stderr }` des Vorbedingungs-Skripts mit `--json`: ein Ergebnis, wirft nie. */
export function langfusePunkt(lf) {
  let urteil;
  try {
    urteil = JSON.parse(lf.stdout); // fehlt `lf` oder `stdout`, wirft das (catch)
  } catch {
    urteil = null;
  }
  if (urteil === null || typeof urteil !== "object" || Array.isArray(urteil)) {
    const text = String(lf?.stderr ?? "").trim().split("\n")[0];
    return nichtPruefbar(PUNKT, `Ausgabe von langfuse-vorbedingung.mjs --json nicht lesbar${text ? ` (${text})` : ""}`, FIX_JSON);
  }
  if (urteil.erreichbar !== true) return luecke(PUNKT, urteil.grund || "Langfuse nicht erreichbar", "Langfuse starten (node scripts/langfuse-vorbedingung.mjs zeigt den Befund)");
  if (urteil.mcp?.status === "getrennt") return luecke(PUNKT, "Langfuse erreichbar, aber die MCP-Verbindung dieser Session ist getrennt", "`/mcp` → langfuse neu verbinden oder Session neu starten");
  return gut(PUNKT);
}

const PUNKT_REPO_TAG = "Repo-Tag";
const SETTINGS_PFAD = ".claude/settings.json";

/**
 * Der Punkt `Repo-Tag` (factory#523): steht der Repo-Name (Namensteil von `repo` der Projekt-Config) in `env.CC_LANGFUSE_TRACE_TAGS` der
 * `.claude/settings.json`? Ohne ihn trägt keine Live-Generation das Repo-Tag und die Auswertung zeigt sie als „ohne Repo-Tag“. `env` steht nicht im
 * Besitz-Manifest, der Sync setzt den Wert nicht: der Bezieher ergänzt ihn selbst. Pur: `settingsText` ist der Dateiinhalt oder `null`/`undefined` (fehlt die Datei).
 */
export function repoTagPunkt({ settingsText, repoName }) {
  let settings;
  try {
    settings = JSON.parse(settingsText);
  } catch {
    settings = null;
  }
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return nichtPruefbar(PUNKT_REPO_TAG, `${SETTINGS_PFAD} fehlt oder ist kein lesbares JSON-Objekt`, `${SETTINGS_PFAD} anlegen bzw. reparieren und \`env.CC_LANGFUSE_TRACE_TAGS\` um \`${repoName}\` ergänzen`);
  }
  if (projektTagsAus(settings.env?.CC_LANGFUSE_TRACE_TAGS).includes(repoName)) return gut(PUNKT_REPO_TAG);
  return luecke(
    PUNKT_REPO_TAG,
    `Repo-Name \`${repoName}\` fehlt in env.CC_LANGFUSE_TRACE_TAGS (Live-Generations tragen kein Repo-Tag und erscheinen in der Auswertung als „ohne Repo-Tag“)`,
    `\`${SETTINGS_PFAD}\` → \`env.CC_LANGFUSE_TRACE_TAGS\` um \`${repoName}\` ergänzen (kommagetrennt, z. B. \`"projekt,${repoName}"\`), danach Sessions neu starten`,
  );
}

const PUNKT_PLUGIN_SCOPE = "Plugin-Scope";
const PLUGIN_SCHLUESSEL = "langfuse-observability@langfuse-observability";

/**
 * Der Punkt `Plugin-Scope` (Sammelzeile L4, ADR 0036): steht `enabledPlugins` mit dem Plugin-Schlüssel `langfuse-observability@langfuse-observability` in der `.claude/settings.json` auf `false`?
 * Sonst sendet das Plugin im Projekt-Scope Live-Generations ohne Ticket-Tag; der Nachlieferer ergänzt nur Fehlendes (idempotent, deterministische IDs), eine
 * Doppelsendung entsteht daraus nicht. Darum `OK` mit `hinweis`, keine Lücke (belegte Grenze: ein bewusst aktives Plugin im User-Scope, ADR 0019, ist erlaubt).
 * `enabledPlugins` steht nicht im Besitz-Manifest, der Sync setzt den Eintrag nicht. Pur: `settingsText` ist der Dateiinhalt oder `null`/`undefined`; den User-Scope liest der Doctor nicht.
 */
export function pluginScopePunkt({ settingsText }) {
  let settings;
  try {
    settings = JSON.parse(settingsText);
  } catch {
    settings = null;
  }
  const fix = `${SETTINGS_PFAD} anlegen bzw. reparieren (JSON-Objekt, \`enabledPlugins\` ein Objekt)`;
  if (settings === null || typeof settings !== "object" || Array.isArray(settings)) {
    return nichtPruefbar(PUNKT_PLUGIN_SCOPE, `${SETTINGS_PFAD} fehlt oder ist kein lesbares JSON-Objekt`, fix);
  }
  const plugins = settings.enabledPlugins;
  if (plugins !== undefined && (plugins === null || typeof plugins !== "object" || Array.isArray(plugins))) {
    return nichtPruefbar(PUNKT_PLUGIN_SCOPE, "enabledPlugins ist kein Objekt", fix);
  }
  if (plugins?.[PLUGIN_SCHLUESSEL] === false) return gut(PUNKT_PLUGIN_SCOPE);
  return gut(
    PUNKT_PLUGIN_SCOPE,
    `Plugin \`${PLUGIN_SCHLUESSEL}\` ist im Projekt-Scope nicht aus: seine Live-Generations tragen keinen Ticket-Tag (Kosten je Ticket erst, wenn dort nur der Nachlieferer sendet). Optional: \`${SETTINGS_PFAD}\` → \`enabledPlugins\` um \`"${PLUGIN_SCHLUESSEL}": false\` ergänzen (steht nicht im Besitz-Manifest, der Sync setzt es nicht), danach Sessions neu starten`,
  );
}
