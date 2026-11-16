/* Fabrik-Einstieg-Wächter (factory#583)
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Regel: Jede in den Doku-Seiten genannte Umgebungsvariable `FACTORY_*` steht in der Tabelle der Einstiegsseite
 * `docs/factory/fabrik-einstieg.md`, und die Seite trägt ihre Pflichtabschnitte. Umfang des Scans (geschlossen): `README.md`, `docs/*.md`,
 * `docs/referenz/*.md`, `docs/factory/*.md`, `docs/codex/*.md`; ausgenommen sind `docs/adr/**` (Historie), die Mess- und Gegenprobe-Berichte
 * (`docs/*-messhistorie-*.md`, `docs/*-gegenprobe-*.md`, `docs/mutation-messung-*.md`) und die Seite selbst.
 *
 * Bekannte Grenzen: gescannt wird nur die Doku, nicht `scripts/` oder Workflows (eine Variable, die nur im Code vorkommt, bleibt unerkannt);
 * eine Variable, die in einer Doku-Seite nur als Teil eines längeren Namens steht, zählt als dieser Name; die Tabelle prüft nur das Vorkommen
 * des Namens in der ersten Spalte, nicht die Güte der Beschreibung. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SEITE = "docs/factory/fabrik-einstieg.md";
const read = (p: string): string => readFileSync(resolve(ROOT, p), "utf8");

const VARIABLE = /\bFACTORY_[A-Z0-9_]+\b/g;
const AUSGENOMMEN = [/-messhistorie-/, /-gegenprobe-/, /^docs\/mutation-messung-/];
export const PFLICHTABSCHNITTE = ["Ebenen der Konfiguration", "Umgebungsvariablen", "Updates holen", "Einrichtung je Rechner und Laufzeit", "Sammeltickets", "Abschluss"];

const mdIn = (ordner: string): string[] =>
  readdirSync(resolve(ROOT, ordner)).filter((f) => f.endsWith(".md")).map((f) => `${ordner}/${f}`);

/** Gescannte Seiten (geschlossener Umfang, siehe Kopfkommentar). */
export const scanSeiten = (): string[] =>
  ["README.md", ...mdIn("docs"), ...mdIn("docs/referenz"), ...mdIn("docs/factory"), ...mdIn("docs/codex")]
    .filter((p) => p !== SEITE && !AUSGENOMMEN.some((a) => a.test(p)));

/** Alle `FACTORY_*`-Namen eines Textes. Pur. */
export const variablenIn = (text: string): string[] => [...new Set(text.match(VARIABLE) ?? [])].sort();

/** Namen aus der ersten Spalte der Tabelle im Abschnitt „Umgebungsvariablen“ (`| \`FACTORY_X\` | … |`). Pur. */
export const tabellenVariablen = (seite: string): string[] => {
  const zeilen = seite.split("\n");
  const start = zeilen.findIndex((z) => /^##\s+Umgebungsvariablen\b/.test(z));
  if (start < 0) return [];
  const ende = zeilen.findIndex((z, i) => i > start && /^##\s/.test(z));
  return zeilen
    .slice(start + 1, ende < 0 ? undefined : ende)
    .map((z) => /^\|\s*`(FACTORY_[A-Z0-9_]+)`\s*\|/.exec(z)?.[1])
    .filter((v): v is string => v !== undefined);
};

/** Variablen, die irgendwo in `texte` stehen, aber nicht in `tabelle`. Pur. */
export const fehlende = (texte: string[], tabelle: string[]): string[] =>
  [...new Set(texte.flatMap(variablenIn))].filter((v) => !tabelle.includes(v)).sort();

/** Pflichtabschnitte, die als Überschrift (`## …`) fehlen. Pur. */
export const fehlendeAbschnitte = (seite: string): string[] =>
  PFLICHTABSCHNITTE.filter((a) => !new RegExp(`^##\\s+${a}\\s*$`, "m").test(seite));

describe("Fabrik-Einstieg: jede dokumentierte FACTORY_*-Variable steht in der Tabelle", () => {
  const seite = read(SEITE);
  const tabelle = tabellenVariablen(seite);
  const texte = scanSeiten().map(read);

  test("der Scan-Umfang ist geschlossen und nicht leer", () => {
    const seiten = scanSeiten();
    assert.ok(seiten.includes("README.md") && seiten.includes("docs/model-routing.md") && seiten.includes("docs/referenz/befehle.md"));
    assert.ok(!seiten.includes(SEITE));
    for (const ordner of ["docs/", "docs/referenz/", "docs/factory/", "docs/codex/"]) assert.ok(seiten.some((p) => p.startsWith(ordner) && p.slice(ordner.length).indexOf("/") < 0), `kein Dokument aus ${ordner} im Scan`);
    assert.ok(seiten.every((p) => !p.startsWith("docs/adr/") && !p.includes("-messhistorie-") && !p.includes("-gegenprobe-") && !p.startsWith("docs/mutation-messung-")));
  });

  test("keine fehlende Variable (die Meldung nennt sie)", () => {
    assert.deepEqual(fehlende(texte, tabelle), []);
  });

  test("die Tabelle ist nicht leer und führt jeden Namen genau einmal", () => {
    assert.ok(tabelle.length >= 20, `nur ${tabelle.length} Zeilen`);
    assert.equal(new Set(tabelle).size, tabelle.length);
  });

  test("Negativfall: eine aus der Tabelle entfernte Variable wird gemeldet", () => {
    const ohne = seite.split("\n").filter((z) => !z.startsWith("| `FACTORY_ABSCHLUSS_SKILL`")).join("\n");
    assert.deepEqual(fehlende(texte, tabellenVariablen(ohne)), ["FACTORY_ABSCHLUSS_SKILL"]);
    assert.deepEqual(fehlende(["Text mit FACTORY_NEU_X"], tabelle), ["FACTORY_NEU_X"]);
    assert.deepEqual(fehlende(["kein Name, nur factory_klein und XFACTORY_A"], tabelle), []);
  });

  test("Negativfall: eine Variable außerhalb der ersten Spalte oder außerhalb des Abschnitts zählt nicht als Tabellenzeile", () => {
    assert.deepEqual(tabellenVariablen("## Umgebungsvariablen\n\n| x | `FACTORY_A` |\n"), []);
    assert.deepEqual(tabellenVariablen("## Anderes\n\n| `FACTORY_A` | x |\n"), []);
    assert.deepEqual(tabellenVariablen("## Umgebungsvariablen\n\n| `FACTORY_A` | x |\n\n## Weiter\n\n| `FACTORY_B` | y |\n"), ["FACTORY_A"]);
  });

  test("Pflichtabschnitte stehen als Überschrift auf der Seite; ein fehlender wird gemeldet", () => {
    assert.deepEqual(fehlendeAbschnitte(seite), []);
    assert.deepEqual(fehlendeAbschnitte(seite.replace("## Sammeltickets", "## Anderes")), ["Sammeltickets"]);
  });

  test("die Seite trägt keinen Projekt- oder Personenbezug (Kern-Seite)", () => {
    assert.ok(!/\/Users\/|C:\\Users\\|@[a-z0-9-]+\.(com|de)\b/i.test(seite));
  });
});
