import { cpSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));

/** Kopiert `<wurzel>/scripts` rekursiv nach `<ziel>/scripts`. */
export function kopiereScripts(ziel: string): void {
  cpSync(join(WURZEL, "scripts"), join(ziel, "scripts"), { recursive: true });
}
