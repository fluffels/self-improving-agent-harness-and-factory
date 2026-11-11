/* Langfuse-Health (aus langfuse-vorbedingung.mjs herausgelöst, factory#313): Bewertung und Abfrage von GET <Langfuse>/api/public/health.
 * Bibliotheksmodul ohne Einstieg, damit auch andere Skripte die Prüfung nutzen (ein Einstiegsskript importiert nie aus einem anderen); fetch wird injiziert, kein Secret-Key. */

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
