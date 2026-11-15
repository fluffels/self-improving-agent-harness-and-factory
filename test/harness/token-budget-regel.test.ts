/* @harness-waechter – einziger Durchsetzer seiner Regel. Wächter der Kern-Regel „Token-Budget je Lauf“ (factory#560 L11, Quelle factory#565): AGENTS.md trägt im Kern-Block genau einen Punkt mit den drei Verboten, der Erlaubnis für gezielte
 * Prüfungen und den Review-Grenzen; kein anderes Markdown unter docs/ (außer docs/adr/**) wiederholt den Wortlaut (SSOT, Verweis auf AGENTS.md ist erlaubt).
 * Grenze: Heuristik über feste Schlüsselphrasen; eine umformulierte Kopie der Regel in docs/ findet nur das Muster nicht, ein Review muss sie sehen. */
import { describe, expect, test } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const WURZEL = join(import.meta.dirname, "..", "..");
const START = "<!-- factory-besitz:start kern -->";
const ENDE = "<!-- factory-besitz:ende kern -->";

const agents = readFileSync(join(WURZEL, "AGENTS.md"), "utf8");
const kern = agents.slice(agents.indexOf(START), agents.indexOf(ENDE));
const punkte = kern.split("\n").filter((z) => z.startsWith("- **Token-Budget je Lauf.**"));

describe("Regel Token-Budget je Lauf", () => {
  test("genau ein Punkt im Kern-Block", () => {
    expect(punkte).toHaveLength(1);
  });

  test("die drei Verbote und die Review-Grenzen stehen im Punkt", () => {
    const p = punkte[0] ?? "";
    for (const w of ["Analysen", "Messungen", "Gegenproben", "`verifyKompakt` einmal vor dem Review", "Runde-1-Satz", "Fix-Runden nur bei echten Blockern", "keine Zusatz-Lenses oder Zusatzpässe ohne neue belegte Blocker-Klasse"]) {
      expect(p, w).toContain(w);
    }
  });

  test("Negativfall: der Punkt erlaubt ausdrücklich gezielte Tests und einen betroffenen check:*", () => {
    const p = punkte[0] ?? "";
    expect(p).toContain("gezielte Tests");
    expect(p).toContain("betroffene `check:*`");
  });

  test("SSOT: kein Markdown unter docs/ außer docs/adr/** trägt den Wortlaut", () => {
    const treffer: string[] = [];
    const geh = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const pfad = join(dir, name);
        const rel = relative(WURZEL, pfad).replace(/\\/g, "/");
        if (rel === "docs/adr" || rel === "docs/historie") continue;
        if (statSync(pfad).isDirectory()) geh(pfad);
        else if (name.endsWith(".md")) {
          const text = readFileSync(pfad, "utf8").replace(/\[[^\]]*Token-Budget je Lauf[^\]]*\]\([^)]*\)/g, "");
          if (/Token-Budget je Lauf|keine Zusatz-Lenses oder Zusatzpässe/u.test(text)) treffer.push(rel);
        }
      }
    };
    geh(join(WURZEL, "docs"));
    expect(treffer).toEqual([]);
  });
});
