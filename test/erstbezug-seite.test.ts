/* Wächter der Erstbezug-Seite (factory#170), nur im Factory-Repo (die Seite ist keine Besitz-Einheit): die Tabelle `Projektdateien` in `docs/erstbezug.md`
 * hat dieselbe Pfadmenge wie die Liste `PROJEKTDATEIEN` des Doctors (beide Richtungen), jeder Eintrag existiert im Factory-Repo (die Vorlage aus der Quelle
 * zeigt nie ins Leere), und kein Eintrag ist eine ganze, verteilte Besitz-Einheit (der Sync lieferte sie, sie gehört dann nicht in die Liste). */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { PROJEKTDATEIEN as rawListe } from "../scripts/harness-doctor-dateien.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../scripts/besitz-lib.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const liste = rawListe as { pfad: string }[];
const besitz = rawBesitz as { istGanzeDatei: (e: unknown) => boolean; wirdVerteilt: (e: unknown) => boolean };
const lies = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

/** Pfade der ersten Spalte der Tabelle unter der Überschrift „Projektdateien“ (Zellen in Backticks). */
function tabellenPfade(seite: string): string[] {
  const abschnitt = seite.split(/^## Projektdateien$/m)[1] ?? "";
  return [...abschnitt.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);
}

describe("Erstbezug-Seite und PROJEKTDATEIEN", () => {
  test("die Tabelle der Seite und die Liste des Doctors nennen genau dieselben Pfade", () => {
    const tabelle = tabellenPfade(lies("docs/erstbezug.md")).sort();
    expect(tabelle.length).toBeGreaterThan(0);
    expect(tabelle).toEqual(liste.map((d) => d.pfad).sort());
  });

  test("der Tabellen-Leser findet die Zeilen (Gegenprobe: eine Seite ohne Abschnitt liefert nichts)", () => {
    expect(tabellenPfade("| `a` | x |")).toEqual([]);
    expect(tabellenPfade("## Projektdateien\n\n| Pfad |\n| --- |\n| `a` | b |\n| `c/d.json` | e |\n")).toEqual(["a", "c/d.json"]);
  });

  test("jeder Eintrag existiert im Factory-Repo (die Vorlage aus der Quelle zeigt nie ins Leere)", () => {
    for (const d of liste) expect(existsSync(join(ROOT, d.pfad)), d.pfad).toBe(true);
  });

  test("kein Eintrag ist eine ganze, verteilte Besitz-Einheit (der Sync würde sie liefern)", () => {
    const manifest = JSON.parse(lies(".factory/besitz.json")) as { eintraege: { pfad: string }[] };
    const verteilt = new Set(manifest.eintraege.filter((e) => besitz.istGanzeDatei(e) && besitz.wirdVerteilt(e)).map((e) => e.pfad));
    expect(verteilt.has("scripts/harness-doctor-dateien.mjs")).toBe(true);
    expect(liste.filter((d) => verteilt.has(d.pfad)).map((d) => d.pfad)).toEqual([]);
  });

  describe("Abschnitt „Langfuse einrichten“", () => {
    const seite = lies("docs/erstbezug.md");
    const abschnitt = (seite.split(/^## Langfuse einrichten$/m)[1] ?? "").split(/^## /m)[0] ?? "";

    test("der Abschnitt steht vor der Projektdateien-Tabelle und der Schritt 8 verweist darauf", () => {
      expect(abschnitt.length).toBeGreaterThan(0);
      expect(seite.indexOf("## Langfuse einrichten")).toBeLessThan(seite.indexOf("## Projektdateien"));
      expect(seite).toContain("(#langfuse-einrichten)");
    });

    test("er nennt die Vorbedingung, die Variablennamen des Skripts, den Probe-Lauf, die Doctor-Zeile, die Codex-Grenze und die Regel, dass nie der Agent die Keys einträgt", () => {
      const zugang = lies("scripts/langfuse-zugang.mjs") + lies("scripts/langfuse-vorbedingung.mjs");
      for (const name of ["LANGFUSE_BASE_URL", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]) {
        expect(abschnitt, name).toContain(name);
        expect(zugang, name).toContain(name);
      }
      expect(abschnitt).toContain("node scripts/langfuse-vorbedingung.mjs");
      expect(abschnitt).toContain("model-routing.md#langfuse-erfassung-belegen-1293");
      expect(abschnitt).toContain("`Langfuse-Takt`");
      expect(abschnitt).toContain("codex/einstieg.md");
      expect(abschnitt).toMatch(/Keys trägt die Maintainerin selbst ein, nie der Agent/);
      expect(abschnitt).toMatch(/```text[\s\S]+```/);
    });

    test("jeder relative Link des Abschnitts zeigt auf eine vorhandene Datei", () => {
      const ziele = [...abschnitt.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)].map((m) => m[1]).filter((z) => !z.startsWith("http"));
      expect(ziele.length).toBeGreaterThan(2);
      for (const z of ziele) expect(existsSync(join(ROOT, "docs", z)), z).toBe(true);
    });
  });
});
