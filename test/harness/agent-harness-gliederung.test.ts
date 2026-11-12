/* Wächter für die Gliederung von docs/agent-harness.md (factory#23) – ohne eigenes check-Skript.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 * Verfall: Prüftermin laut .github/wiedervorlagen.json (Eintrag regeln-verfall-2027-03, ADR 0027).
 *
 * Regel: Die Langfassung eines Gates steht in seinem eigenen `###`-Abschnitt von §3 (WAS, WARUM, Absicherung);
 * §3a hält nur Regeln zu Ablauf, Review und Eskalation. Geprüft werden (a) je Schlüssel der geschlossenen Liste
 * `GATE_SCHLUESSEL` genau ein §3-Abschnitt mit den drei Bausteinen, (b) die Test-Infrastruktur im Abschnitt `npm test`,
 * (c) in §3a weder eine Überschrift noch ein fetter Leitsatz am Zeilen- oder Bullet-Anfang, der einen Schlüssel oder einen
 * Leitsatz der geschlossenen Liste `VERSCHOBEN` nennt.
 *
 * Bewusste Grenze: nur Überschriften und Leitsätze der geschlossenen Listen, Fließtext wird nicht geprüft; ein neues
 * Gate kommt nur per Eintrag in `GATE_SCHLUESSEL` unter die Prüfung. Fehlt `## 3.` oder `## 3a.` (auch abgewandelt), ist das ein Fund.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";

const GATE_SCHLUESSEL = [
  "npm test",
  "test:coverage",
  "check:diffcoverage",
  "npm run lint",
  "Komplexität",
  "check:anysuppress",
  "check:size",
  "check:contextsize",
  "check:diffsize",
  "check:lockfile",
  "check:internalrefs",
  "npm audit",
] as const;

const VERSCHOBEN = [
  "Durchsetzung ist serverseitig",
  "Skript-Konvention",
  "Test-Infrastruktur",
  "Sammelticket-PR",
  "Lint muss grün bleiben",
  "Größen-Gate",
  "no-explicit-any",
  "Die Größe EINER Änderung",
  "Testabdeckung wird gemessen",
  "Abhängigkeiten bleiben aktuell",
] as const;

// Die einzigen Überschriften, die in §3a stehen dürfen.
const ERLAUBTE_3A_UEBERSCHRIFTEN = ["Ablauf, Review und Eskalation", "Forum-Eingang"] as const;

// Abschnitte, deren Absicherung ein eigenes Bullet ist, das nicht "Absicherung" heißen muss, gibt es nicht:
// jeder Abschnitt braucht alle drei Bausteine.
const BAUSTEINE = ["**WAS", "**WARUM", "**Absicherung"] as const;

/** Text zwischen zwei Zeilen-Überschriften (`## 3.` bis `## 3a.` usw.); leer, wenn der Anfang fehlt. */
function ausschnitt(md: string, von: RegExp, bis: RegExp): string {
  const zeilen = md.split("\n");
  const a = zeilen.findIndex((z) => von.test(z));
  if (a < 0) return "";
  const rest = zeilen.slice(a + 1);
  const b = rest.findIndex((z) => bis.test(z));
  return [zeilen[a], ...(b < 0 ? rest : rest.slice(0, b))].join("\n");
}

/** Unterabschnitte (`### Titel`) eines Ausschnitts mit ihrem Rumpf. */
function unterabschnitte(text: string): { titel: string; rumpf: string }[] {
  const ergebnis: { titel: string; rumpf: string }[] = [];
  for (const z of text.split("\n")) {
    if (z.startsWith("### ")) ergebnis.push({ titel: z.slice(4), rumpf: "" });
    else if (ergebnis.length > 0) ergebnis[ergebnis.length - 1].rumpf += z + "\n";
  }
  return ergebnis;
}

/** Funde zu §3 und §3a eines Markdown-Textes; leer heißt sauber. */
function gliederungsFunde(md: string): string[] {
  const funde: string[] = [];
  const drei = ausschnitt(md, /^## 3\. /, /^## 3a\. /);
  const dreiA = ausschnitt(md, /^## 3a\. /, /^## 4\. /);
  if (drei === "") funde.push("§3: Überschrift \"## 3. \" fehlt");
  if (dreiA === "") funde.push("§3a: Überschrift \"## 3a. \" fehlt");
  const abschnitte = unterabschnitte(drei);
  for (const schluessel of GATE_SCHLUESSEL) {
    const treffer = abschnitte.filter((a) => a.titel.includes(schluessel));
    if (treffer.length !== 1) {
      funde.push(`${schluessel}: ${treffer.length} Abschnitte in §3 statt genau einem`);
      continue;
    }
    for (const baustein of BAUSTEINE) {
      if (!treffer[0].rumpf.includes(baustein)) funde.push(`${schluessel}: Baustein ${baustein} fehlt`);
    }
  }
  const testAbschnitt = abschnitte.find((a) => a.titel.includes("npm test"));
  if (testAbschnitt && !testAbschnitt.rumpf.includes("Test-Infrastruktur")) {
    funde.push("npm test: Leitsatz Test-Infrastruktur fehlt");
  }
  for (const z of dreiA.split("\n")) {
    if (z.startsWith("### ") && !ERLAUBTE_3A_UEBERSCHRIFTEN.some((u) => z.includes(u))) {
      funde.push(`§3a: unerwartete Überschrift ${z}`);
    }
    const leitsatz = /^(?:- )?\*\*(.+?)\*\*/.exec(z)?.[1];
    if (leitsatz === undefined) continue;
    const verboten = [...GATE_SCHLUESSEL, ...VERSCHOBEN].find((s) => leitsatz.includes(s));
    if (verboten !== undefined) funde.push(`§3a: Gate-Regel „${leitsatz}“ gehört nach §3 (${verboten})`);
  }
  return funde;
}

const SAUBER = [
  "## 3. Die Fitness-Functions im Detail",
  "### Tests (`npm test`)",
  "- **WAS:** a",
  "- **WARUM:** b",
  "- **Absicherung:** Test-Infrastruktur c",
  ...GATE_SCHLUESSEL.filter((s) => s !== "npm test").flatMap((s) => [
    `### Gate (${s})`,
    "- **WAS:** a",
    "- **WARUM:** b",
    "- **Absicherung:** c",
  ]),
  "## 3a. Langfassung",
  "- **Nachweis (x).** Text",
  "## 4. Weiter",
].join("\n");

describe("Gliederung docs/agent-harness.md", () => {
  test("die echte Seite ist sauber gegliedert", () => {
    const md = readFileSync(new URL("../../docs/agent-harness.md", import.meta.url), "utf8");
    expect(gliederungsFunde(md)).toEqual([]);
  });

  test("Red-Green: saubere Fassung ohne Fund", () => {
    expect(gliederungsFunde(SAUBER)).toEqual([]);
  });

  test("Red-Green: Gate-Bullet in §3a ist ein Fund", () => {
    const md = SAUBER.replace("- **Nachweis (x).** Text", "- **Lint muss grün bleiben (npm run lint).** Text");
    expect(gliederungsFunde(md).some((f) => f.startsWith("§3a: Gate-Regel"))).toBe(true);
  });

  test("Red-Green: unerwartete Überschrift in §3a ist ein Fund", () => {
    const md = SAUBER.replace("- **Nachweis (x).** Text", "### Lint (npm run lint)\n- **Nachweis (x).** Text");
    expect(gliederungsFunde(md)).toContain("§3a: unerwartete Überschrift ### Lint (npm run lint)");
  });

  test("Red-Green: fehlende oder abgewandelte §3a-Überschrift ist ein Fund", () => {
    const md = SAUBER.replace("## 3a. Langfassung", "## 3a Langfassung");
    expect(gliederungsFunde(md)).toContain("§3a: Überschrift \"## 3a. \" fehlt");
    const ohne3 = SAUBER.replace("## 3. Die", "## 3 Die");
    expect(gliederungsFunde(ohne3)).toContain("§3: Überschrift \"## 3. \" fehlt");
  });

  test("Red-Green: Gate-Schlüssel mitten in einer Zeile ist kein Fund, am Anfang in Absatzform schon", () => {
    const mitten = SAUBER.replace("- **Nachweis (x).** Text", "- Nachweis (x): Text mit **npm run lint** mittendrin");
    expect(gliederungsFunde(mitten)).toEqual([]);
    const absatz = SAUBER.replace("- **Nachweis (x).** Text", "**Skript-Konvention: x (quellprojekt#1).** Text");
    expect(gliederungsFunde(absatz).some((f) => f.includes("Skript-Konvention"))).toBe(true);
  });

  test("Red-Green: echter alter Leitsatz in §3a ist ein Fund", () => {
    const md = SAUBER.replace("- **Nachweis (x).** Text", "- **Lint muss grün bleiben.** Text");
    expect(gliederungsFunde(md).some((f) => f.includes("Lint muss grün bleiben"))).toBe(true);
  });

  test("Red-Green: verschobener Leitsatz in §3a ist ein Fund", () => {
    const md = SAUBER.replace("- **Nachweis (x).** Text", "- **Skript-Konvention: x.** Text");
    expect(gliederungsFunde(md).some((f) => f.includes("Skript-Konvention"))).toBe(true);
  });

  test("Red-Green: fehlendes Absicherung-Bullet ist ein Fund", () => {
    const md = SAUBER.replace("- **Absicherung:** c\n## 3a.", "## 3a.");
    expect(gliederungsFunde(md)).toContain("npm audit: Baustein **Absicherung fehlt");
  });

  test("Red-Green: fehlender oder doppelter Abschnitt ist ein Fund", () => {
    const fehlt = SAUBER.replace("### Gate (check:lockfile)", "### Gate (anderes)");
    expect(gliederungsFunde(fehlt)).toContain("check:lockfile: 0 Abschnitte in §3 statt genau einem");
    const doppelt = SAUBER.replace("## 3a.", "### Doppelt (check:lockfile)\n## 3a.");
    expect(gliederungsFunde(doppelt)).toContain("check:lockfile: 2 Abschnitte in §3 statt genau einem");
  });

  test("Red-Green: Test-Infrastruktur außerhalb des Abschnitts npm test ist ein Fund", () => {
    const md = SAUBER.replace("Test-Infrastruktur c", "c");
    expect(gliederungsFunde(md)).toContain("npm test: Leitsatz Test-Infrastruktur fehlt");
  });
});
