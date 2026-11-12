/* Harness-Doctor, Punkt `Langfuse` (factory#362 L30): wertet die `--json`-Ausgabe von `node scripts/langfuse-vorbedingung.mjs --json` aus
 * (`{ erreichbar, grund, mcp }`; ein getrenntes MCP ist dort Exit 0 mit `mcp.status: "getrennt"`). Unterscheidet zwei Lücken mit je eigenem Fix:
 * Langfuse selbst nicht erreichbar (starten) und erreichbar, aber die MCP-Verbindung dieser Session getrennt (neu verbinden). Der MCP-Abgleich
 * läuft nur unter Claude Code (`CLAUDECODE=1`, im Vorbedingungs-Skript); sonst bleibt der Punkt OK (belegte Grenze). Pur: bekommt das `spawnSync`-Ergebnis. */
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";

const PUNKT = "Langfuse";
const FIX_JSON = "`node scripts/langfuse-vorbedingung.mjs --json` prüfen";

/** Der Punkt `Langfuse` aus `{ status, stdout, stderr }` des Vorbedingungs-Skripts mit `--json`: ein Ergebnis, wirft nie. */
export function langfusePunkt(lf) {
  let urteil;
  try {
    urteil = JSON.parse(String(lf?.stdout ?? ""));
  } catch {
    urteil = null;
  }
  if (urteil === null || typeof urteil !== "object") {
    const text = String(lf?.stderr ?? "").trim().split("\n")[0];
    return nichtPruefbar(PUNKT, `Ausgabe von langfuse-vorbedingung.mjs --json nicht lesbar${text ? ` (${text})` : ""}`, FIX_JSON);
  }
  if (urteil.erreichbar !== true) return luecke(PUNKT, urteil.grund || "Langfuse nicht erreichbar", "Langfuse starten (node scripts/langfuse-vorbedingung.mjs zeigt den Befund)");
  if (urteil.mcp?.status === "getrennt") return luecke(PUNKT, "Langfuse erreichbar, aber die MCP-Verbindung dieser Session ist getrennt", "`/mcp` → langfuse neu verbinden oder Session neu starten");
  return gut(PUNKT);
}
