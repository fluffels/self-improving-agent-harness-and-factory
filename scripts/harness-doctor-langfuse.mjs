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
