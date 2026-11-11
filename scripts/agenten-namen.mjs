/* Agentennamen aus den Frontmatter-Dateien eines Ordners (aus langfuse-auswertung.mjs herausgelöst, factory#313): Bibliotheksmodul ohne Einstieg. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Agentennamen aus `^name:` der Frontmatter-Dateien eines Ordners (sortiert). */
export function agentenNamen(ordner, { lies = readFileSync, liste = readdirSync } = {}) {
  const namen = [];
  for (const datei of liste(ordner).filter((f) => f.endsWith(".md"))) {
    const m = /^name:[ \t]*(\S+)[ \t]*$/m.exec(lies(join(ordner, datei), "utf8"));
    if (m) namen.push(m[1].replace(/^["']|["']$/g, ""));
  }
  return namen.sort();
}
