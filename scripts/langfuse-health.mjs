/* Langfuse-Health (aus langfuse-vorbedingung.mjs herausgelöst, factory#313): Bewertung und Abfrage von GET <Langfuse>/api/public/health.
 * Bibliotheksmodul ohne Einstieg, damit auch andere Skripte die Prüfung nutzen (ein Einstiegsskript importiert nie aus einem anderen); fetch wird injiziert, kein Secret-Key.
 * `pruefeLangfuseAusUmgebung` löst die Adresse wie `langfuse-vorbedingung.mjs` auf (Umgebung, sonst Plugin-Optionen, sonst localhost:3000; nie eine Secret-Datei) und nutzt
 * die Codex-Vorprüfung und der Codex-Hook-Adapter für den Tracing-Ausfallstopp (factory#365). */
import { homedir } from "node:os";
import { basisUrlAus, langfuseBasisUrl } from "./langfuse-zugang.mjs";

export const HEALTH_PFAD = "/api/public/health";
export const FRIST_MS = 3000;

/** Urteil aus HTTP-Status oder Verbindungsfehler; ohne beides gilt es als nicht erreichbar. Pur. */
export function bewerteHealth({ status, fehler } = {}) {
  if (status === 200) return { ok: true, grund: "Langfuse erreichbar (HTTP 200)" };
  if (typeof status === "number") return { ok: false, grund: `Langfuse antwortet mit HTTP ${status}` };
  if (fehler) return { ok: false, grund: `Langfuse nicht erreichbar: ${fehler}` };
  return { ok: false, grund: "Langfuse nicht erreichbar: keine Antwort" };
}

/** Fragt den Health-Endpunkt mit Frist ab und bewertet die Antwort. Wirft nie. */
export async function pruefeLangfuse({ baseUrl, fetchImpl = fetch, fristMs = FRIST_MS }) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), fristMs);
  try {
    const res = await fetchImpl(`${baseUrl}${HEALTH_PFAD}`, { signal: abbruch.signal });
    return bewerteHealth({ status: res.status });
  } catch (e) {
    if (abbruch.signal.aborted) return bewerteHealth({ fehler: `Timeout nach ${fristMs} ms` });
    return bewerteHealth({ fehler: e?.cause?.code ?? e?.code ?? e?.message ?? String(e) });
  } finally {
    clearTimeout(uhr);
  }
}

/** Gültiger Health-Body: JSON mit `status` = "OK" (so liefert ihn `/api/public/health`); alles andere, auch ein nicht lesbarer Body, ist ungültig. */
async function healthBodyGueltig(res) {
  try {
    return JSON.parse(await res.text()).status === "OK";
  } catch {
    return false;
  }
}

/** Health-Prüfung für die Adresse aus der Umgebung (siehe Kopf); fetch, Frist und Dateizugriff sind injizierbar. Zusätzlich zum HTTP-Status prüft sie den Body (JSON mit `status` = "OK"). Wirft nur bei unbrauchbarer Umgebung (`env` ohne Objekt); die Aufrufer fangen das. */
export async function pruefeLangfuseAusUmgebung({ env = process.env, home = homedir(), lies, fetchImpl = fetch, fristMs = FRIST_MS } = {}) {
  const baseUrl = langfuseBasisUrl({ LANGFUSE_BASE_URL: basisUrlAus(env, home, lies) });
  let bodyUngueltig = false;
  const mitBody = async (url, optionen) => { // der Body wird innerhalb der Frist gelesen; `bewerteHealth` bleibt unberührt (Claude-Pfad unverändert)
    const res = await fetchImpl(url, optionen);
    if (res.status === 200) bodyUngueltig = !(await healthBodyGueltig(res));
    return res;
  };
  const urteil = await pruefeLangfuse({ baseUrl, fetchImpl: mitBody, fristMs });
  if (bodyUngueltig) return { ok: false, grund: "Langfuse antwortet ohne gültigen Health-Body (HTTP 200, erwartet JSON mit status OK)" };
  return urteil;
}
