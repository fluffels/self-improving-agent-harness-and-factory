/* Import-Hülle eines Skripts (factory#114, vorher in projekt-config-workflows.test.ts): alle relativ erreichbaren Dateien samt Einstieg.
 *
 * Tests, die ein Skript in einem Temp-Verzeichnis ohne den Rest des Repos starten (Kopierliste, Sparse-Checkout), leiten die Dateiliste
 * hieraus ab, statt sie von Hand zu führen: ein neuer Blatt-Import bricht so keinen Test still. Die Kette läuft über `lokaleImporteTransitiv`
 * (eine Auslegung für Wächter und Hülle, factory#127); darüber hinaus wirft die Hülle bei jedem Import, der weder `node:` noch relativ ist.
 * Grenzen der gemeinsamen Auslegung (`importeAus`): erkannt werden `from "…"`, `import "…"`, `import()` und `require()` mit festem Literal; ein
 * dynamischer Pfad bleibt unsichtbar, ein Import in einem Kommentar zählt mit (fail-closed).
 */
import { importeAus, lokaleImporteTransitiv } from "../harness/hook-importe";

/** Import-Hülle (Repo-Pfade) eines Skripts samt Einstieg; wirft bei einem Import, der weder `node:` noch relativ ist. Pur bis auf `leser`. */
export function importHuelle(einstieg: string, leser: (pfad: string) => string): string[] {
  const huelle = lokaleImporteTransitiv([einstieg], leser);
  for (const pfad of huelle) {
    for (const ziel of importeAus(leser(pfad))) {
      if (!ziel.startsWith("node:") && !ziel.startsWith(".")) throw new Error(`${pfad}: Import '${ziel}' ist weder node: noch relativ`);
    }
  }
  return huelle;
}
