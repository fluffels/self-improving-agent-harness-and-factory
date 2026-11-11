/**
 * Live-Weg des Langfuse-Wochenberichts (factory#313): einziges Modul dieser Gruppe, das den Langfuse-Zugang (mit Secret-Key) liest.
 * Die CLI `langfuse-wochenbericht.mjs` lädt es nur ohne `--export` und ohne `--rezept`, dynamisch; ihre statische Import-Hülle bleibt
 * schlüsselfrei (ein Test hält das fest). Ablauf: Zugang per `kindEnv`, Health per `pruefeLangfuse`, dann je Abfrage ein `queryMetrics`.
 */

import { queryMetrics, langfuseZugang } from "./langfuse-api.mjs";
import { kindEnv, langfuseBasisUrl } from "./langfuse-zugang.mjs";
import { pruefeLangfuse } from "./langfuse-health.mjs";

/**
 * Holt die Exporte zu `rezepte` (`{ art, name, abfrage }`). Rückgabe `{ status: "ok", exporte: [{ json, pfad }] }` oder
 * `{ status: "unerreichbar", grund }` (Health nicht 200, dann nie eine Abfrage). Fehlt der Zugang oder scheitert eine Abfrage, wirft es (Exit 1).
 */
export async function ladeLiveExporte({ rezepte, env, home, fetchImpl = fetch }) {
  const kenv = kindEnv(env, home);
  const health = await pruefeLangfuse({ baseUrl: langfuseBasisUrl(kenv), fetchImpl });
  if (!health.ok) return { status: "unerreichbar", grund: health.grund };
  const zugang = langfuseZugang(kenv);
  const exporte = [];
  for (const r of rezepte) {
    const data = await queryMetrics(r.abfrage, { ...zugang, fetchImpl });
    exporte.push({ json: { art: r.art, abfrage: r.abfrage, data }, pfad: `live:${r.name}` });
  }
  return { status: "ok", exporte };
}
