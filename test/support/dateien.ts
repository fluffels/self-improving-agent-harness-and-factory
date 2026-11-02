/* Rekursiver Datei-Walker der Wächter-Tests (factory#127): ein Helfer statt je einer eigenen Rekursion in vier Tests.
 * Liefert Repo-Pfade (POSIX, `rel/unterordner/datei`), sortiert; `filter` wird gegen den Dateinamen geprüft. Ein fehlender Ordner wirft. */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Alle Dateien unter `<wurzel>/<rel>` rekursiv, deren Name `filter` trifft, als `rel`-präfixierte POSIX-Pfade (sortiert). */
export function dateienUnter(wurzel: string, rel: string, filter: RegExp): string[] {
  return readdirSync(join(wurzel, rel), { withFileTypes: true })
    .flatMap((e) => {
      const pfad = `${rel}/${e.name}`;
      return e.isDirectory() ? dateienUnter(wurzel, pfad, filter) : filter.test(e.name) ? [pfad] : [];
    })
    .sort();
}
