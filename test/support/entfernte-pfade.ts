/* Scan-Kern der Wächter gegen Textreste entfernter Pfade (#1067, ADR 0028; #1906): die Regelmenge geben `entfernte-pfade.test.ts` (Kern)
 * und `entfernte-pfade-projekt.test.ts` (Projekthistorie) mit; hier stehen Scan, Schnappschuss-Blöcke und Meldung. */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface Rest {
  name: string;
  muster: RegExp;
  fix: string;
}
export interface Datei {
  pfad: string;
  inhalt: string;
}
export interface Ausnahme {
  praefix: string;
  grund: string;
}

/** Pfad-Präfixe, die die Namen bewusst tragen. Je Eintrag der Grund. */
export const AUSNAHMEN: Ausnahme[] = [
  { praefix: "docs/adr/", grund: "ADRs sind historisch und werden nie umgeschrieben (AGENTS.md § Projekt-Brain pflegen)" },
  { praefix: "test/harness/model-routing.test.ts", grund: "Absenz-Test: prüft, dass die entfernten Dateien nicht mehr existieren (ADR 0028)" },
  { praefix: "test/harness/entfernte-pfade.test.ts", grund: "dieser Wächter trägt die Muster selbst" },
  { praefix: "docs/lens-gegenprobe-", grund: "datierte Schnappschüsse nennen die damaligen Dateinamen (Schnappschuss, nicht aktualisiert)" },
];

/** Ausnahmen für genau eine Regel in genau einer Datei (exakter Pfad); alle anderen Regeln prüfen die Datei weiter. */
export const REGEL_AUSNAHMEN: { pfad: string; regel: string; grund: string }[] = [];

/** Marker eines Schnappschuss-Blocks (Glossar „Schnappschuss-Block“): die Kern-Konstanten aus `docs-gen/markdown.mjs`, eine Quelle für beide Wächter. */
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMarkdown from "../../scripts/docs-gen/markdown.mjs";
const marker = rawMarkdown as unknown as {
  SCHNAPPSCHUSS_START: string;
  SCHNAPPSCHUSS_ENDE: string;
  schnappschussBloecke(zeilen: string[]): { bloecke: [number, number][]; fehler: { zeile: number; art: "verschachtelt" | "ende-ohne-start" | "ohne-ende" }[] };
};
export const SCHNAPPSCHUSS_START = marker.SCHNAPPSCHUSS_START;
export const SCHNAPPSCHUSS_ENDE = marker.SCHNAPPSCHUSS_ENDE;
const ISO_DATUM = /\d{4}-\d{2}-\d{2}/;
const FEHLER_TEXT = { verschachtelt: "Schnappschuss-Block verschachtelt", "ende-ohne-start": "Schnappschuss-Ende ohne Start", "ohne-ende": "Schnappschuss-Block ohne Ende" };

/** Findet Reste in den übergebenen Dateien; leer = sauber. Die Blöcke bestimmt `schnappschussBloecke` (Kern); hier bleiben die Datumsprüfung und die Regeln. */
export function findeReste(dateien: Datei[], regeln: Rest[], ausnahmen: Ausnahme[] = AUSNAHMEN): string[] {
  const treffer: string[] = [];
  for (const d of dateien) {
    if (ausnahmen.some((a) => d.pfad.startsWith(a.praefix))) continue;
    const aktiv = regeln.filter((r) => !REGEL_AUSNAHMEN.some((a) => a.pfad === d.pfad && a.regel === r.name));
    const zeilen = d.inhalt.split("\n");
    const { bloecke, fehler } = marker.schnappschussBloecke(zeilen);
    const offen = fehler.find((f) => f.art === "ohne-ende")?.zeile ?? zeilen.length; // ein Start ohne Ende blendet bis Dateiende aus (fail-closed durch den Fund)
    const imBlock = (i: number): boolean => i >= offen || bloecke.some(([s, e]) => i >= s && i <= e);
    const funde: { zeile: number; text: string }[] = [];
    for (const f of fehler) funde.push({ zeile: f.zeile, text: FEHLER_TEXT[f.art] });
    for (const [s, e] of bloecke) if (!zeilen.slice(s + 1, e).some((z) => ISO_DATUM.test(z))) funde.push({ zeile: s, text: "Schnappschuss-Block ohne Datum" });
    zeilen.forEach((zeile, i) => {
      if (!imBlock(i)) for (const r of aktiv) if (r.muster.test(zeile)) funde.push({ zeile: i, text: r.name });
    });
    funde.sort((x, y) => x.zeile - y.zeile);
    for (const f of funde) treffer.push(`${d.pfad}:${f.zeile + 1}: ${f.text}`);
  }
  return treffer;
}

/** Meldung mit dem Fix-Hinweis je getroffener Regel (ein Hinweis pro Regel, auch bei mehreren Treffern). */
export function meldungMitFix(treffer: string[], regeln: Rest[]): string {
  const hinweise = regeln.filter((r) => treffer.some((t) => t.endsWith(`: ${r.name}`))).map((r) => `- ${r.name}: ${r.fix}`);
  const bloecke = treffer.some((t) => t.includes("Schnappschuss-Block") || t.includes("Schnappschuss-Ende"))
    ? ["- Schnappschuss-Block: Marker nur allein auf der Zeile, jeder Start braucht genau ein Ende (und jedes Ende einen Start) und zwischen beiden ein ISO-Datum (JJJJ-MM-TT)"]
    : [];
  return `Rest des entfernten Pfads gefunden:\n${[...hinweise, ...bloecke].join("\n")}`;
}

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Alle getrackten Textdateien mit Inhalt (Binärdateien und nicht lesbare Pfade werden übersprungen). */
export function getrackteTextdateien(): Datei[] {
  const liste = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  const aus: Datei[] = [];
  for (const pfad of liste) {
    if (/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|mp3|ogg|wav|zip|gz|lock)$/i.test(pfad) || pfad === "package-lock.json") continue;
    try {
      const inhalt = readFileSync(`${ROOT}${pfad}`, "utf8");
      if (!inhalt.includes("\u0000")) aus.push({ pfad, inhalt });
    } catch {
      // gelöscht im Arbeitsbaum, aber noch im Index: nichts zu scannen
    }
  }
  return aus;
}
