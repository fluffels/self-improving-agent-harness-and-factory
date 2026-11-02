/* Import-Hülle eines Skripts (factory#114, vorher in projekt-config-workflows.test.ts): alle relativ erreichbaren Dateien samt Einstieg.
 *
 * Tests, die ein Skript in einem Temp-Verzeichnis ohne den Rest des Repos starten (Kopierliste, Sparse-Checkout), leiten die Dateiliste
 * hieraus ab, statt sie von Hand zu führen: ein neuer Blatt-Import bricht so keinen Test still. Bewusste Grenze: erkannt wird nur
 * `from "<pfad>"` in doppelten Anführungszeichen (kein `import "./x.mjs"`, kein dynamisches `import()`, keine einfachen Anführungszeichen).
 */
import { dirname, posix } from "node:path";

/** Import-Hülle (Repo-Pfade) eines Skripts samt Einstieg; wirft bei einem Import, der weder `node:` noch relativ ist. Pur bis auf `leser`. */
export function importHuelle(einstieg: string, leser: (pfad: string) => string): string[] {
  const gesehen = new Set<string>();
  const offen = [einstieg];
  while (offen.length > 0) {
    const pfad = offen.pop() as string;
    if (gesehen.has(pfad)) continue;
    gesehen.add(pfad);
    for (const m of leser(pfad).matchAll(/\bfrom\s+"([^"]+)"/g)) {
      const ziel = m[1] ?? "";
      if (ziel.startsWith("node:")) continue;
      if (!ziel.startsWith(".")) throw new Error(`${pfad}: Import '${ziel}' ist weder node: noch relativ`);
      offen.push(posix.join(dirname(pfad), ziel));
    }
  }
  return [...gesehen].sort();
}
