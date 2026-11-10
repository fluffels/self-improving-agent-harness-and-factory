/* Sammelticket-Deckel-Wächter (factory#268, Fortschreibung zu ADR 0026) – die Zahl steht genau einmal, der Rest geht ins Folge-Sammelticket.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Regel: Ein Sammelticket-Lauf nimmt höchstens „Deckel <N> Zeilen“ (AGENTS.md, SSOT), dazu die Dateigrenze von
 * check:diffsize (das Strengere gilt). Nicht gewählte Zeilen, im Lauf Dazugekommenes und Funde außerhalb des Scopes
 * werden je eine neue Zeile im Folge-Sammelticket, nie Teil desselben PR. Alle anderen Stellen sagen
 * „Deckel laut AGENTS.md“ und nennen keine Zahl.
 *
 * Bewusste Grenze: geprüft werden nur die geschlossene Liste VERWEISE, die bekannten Muster des alten
 * „komplett, kein Rest“-Wortlauts und eine Klausel-Regel (Rest-Wort und PR-Ziel in einer Klausel ohne Verneinung);
 * ADRs (Historie) und Tests sind ausgenommen, eine ganz neue Umschreibung desselben Gedankens erkennt der Test nicht.
 * Grenzen der Klausel-Regel: ein „nie“ oder „nicht“ in der Klausel schaltet sie frei („nicht ins Folge-Sammelticket,
 * sondern in diesen PR“ bleibt unerkannt), die Trennung an Kommas verliert den Bezug, „alle Zeilen“ ohne „des Tickets“
 * ist kein Rest-Wort, ein Zeilenumbruch mitten in der PR-Wendung trennt sie, und PR-Wendungen wie „diesem einen PR“ oder „im PR“ ohne Artikel, „Pull Request“ und andere Synonyme kennt sie nicht.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const lies = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

/** Die Zahl steht nur in AGENTS.md, in der Form „Deckel 12 Zeilen“. */
const DECKEL = /Deckel (\d+) Zeilen/g;
const VERWEISE = [
  "docs/ticket-reihenfolge.md",
  "docs/harness-glossar.md",
  ".claude/agents/factory-planer.md",
  ".claude/agents/factory-umsetzer.md",
  ".agents/skills/factory/ablauf.md",
];

/** Der Deckel aus AGENTS.md; wirft bei keiner oder mehr als einer Definition. */
export function deckelAusAgentsMd(text: string): number {
  const treffer = [...text.matchAll(DECKEL)];
  if (treffer.length !== 1) throw new Error(`AGENTS.md muss „Deckel <N> Zeilen“ genau einmal nennen, gefunden: ${treffer.length}`);
  return Number(treffer[0][1]);
}

/** Muster des alten Wortlauts, der den Rest wieder in denselben PR zieht. */
const ZIEHT_REST_REIN = [
  /kommen in denselben PR/,
  /setze ALLE Zeilen um/,
  /plane ALLE Zeilen/,
  /komplett umsetzen, kein Rest-Übertrag/,
  /\*\*komplett\*\* \(kein Rest/,
  /alle Zeilen in einem PR/,
  /keine Zeilengrenze/,
  /Nachzügler setzt du selbst um/,
];
const RESTWORT = /\bRest\b|\bREST\b|[Üü]brigen? Zeilen|ganze Ticket|Zeilen des Tickets|Dazugekommen|Nachzügler/;
const PR_ZIEL = /(?:[Ii]n|[Ii]m) (?:(?:den|dem) )?(?:diesem|diesen|dem|den|demselben|denselben|selben|gleichen|einem|einen) PR|(?:Teil|Bestandteil) (?:desselben|dieses) PR|\bPR (?:mit|um)\b|komplett (?:abarbeiten|umsetzen)|Rest-Übertrag/;
const VERNEINT = /\bnie\b|\bnicht\b/;

/** Allgemeine Klausel-Regel (je Zeile, ohne Markdown-Auszeichnung (Sternchen, Unterstrich, Backtick), Leerraum vereinheitlicht): eine Klausel (getrennt an . ; , : und Klammern), die den Rest nennt UND einen PR als Ziel, ohne Verneinung. */
export const restKlauselInPR = (text: string): boolean =>
  text
    .split("\n")
    .map((z) => z.replace(/[*_`]+/g, "").replace(/\s+/g, " "))
    .some((z) => z.split(/[.;,:()]/).some((k) => RESTWORT.test(k) && PR_ZIEL.test(k) && !VERNEINT.test(k)));

export const ziehtRestInDenPR = (text: string): boolean => ZIEHT_REST_REIN.some((m) => m.test(text)) || restKlauselInPR(text);

describe("Sammelticket-Deckel: Zahl nur in AGENTS.md (factory#268)", () => {
  const agents = lies("AGENTS.md");
  const n = deckelAusAgentsMd(agents);

  test("AGENTS.md nennt den Deckel genau einmal als positive Zahl", () => {
    assert.ok(Number.isInteger(n) && n > 0);
  });

  test("Negativfall: zwei Definitionen oder keine werden erkannt", () => {
    assert.throws(() => deckelAusAgentsMd("Deckel 12 Zeilen und Deckel 13 Zeilen"));
    assert.throws(() => deckelAusAgentsMd("kein Deckel hier"));
    assert.equal(deckelAusAgentsMd("je Lauf Deckel 7 Zeilen"), 7);
  });

  test("jede Verweis-Stelle existiert, nennt „Deckel laut AGENTS.md“ und keine eigene Zahl", () => {
    for (const f of VERWEISE) {
      assert.ok(existsSync(fileURLToPath(new URL(`../../${f}`, import.meta.url))), `${f} fehlt`);
      const t = lies(f);
      assert.ok(t.trim() !== "", `${f} ist leer`);
      assert.ok(t.includes("Deckel laut AGENTS.md"), `${f}: „Deckel laut AGENTS.md“ fehlt`);
      assert.doesNotMatch(t, /Deckel \d+ Zeilen/, `${f}: eigene Deckel-Zahl`);
      assert.doesNotMatch(t, /höchstens \d+ Zeilen/, `${f}: eigene Zeilenzahl`);
      assert.doesNotMatch(t, new RegExp(`\\b${n} Zeilen\\b`), `${f}: doppelt die Zahl ${n}`);
    }
  });

  test("Positivkontrolle: Mechanik, Planer und Umsetzer nennen Rest und Folge-Sammelticket", () => {
    const doc = lies("docs/ticket-reihenfolge.md");
    const abarbeiten = doc.split("\n").find((z) => z.startsWith("- **Abarbeiten:**")) ?? "";
    assert.ok(abarbeiten.includes("Folge-Sammelticket"));
    assert.ok(abarbeiten.includes("nie Teil desselben PR"));
    const planer = lies(".claude/agents/factory-planer.md");
    assert.match(planer, /`DECKEL: L<a>–L<b> \| REST: L<c>, …`/);
    assert.match(planer, /der Rest geht ins Folge-Sammelticket/);
    const umsetzer = lies(".claude/agents/factory-umsetzer.md");
    assert.match(umsetzer, /`DECKEL`/);
    assert.match(umsetzer, /`REST`/);
    assert.match(umsetzer, /nie in diesen PR/);
    assert.match(umsetzer, /Folge-Sammelticket/);
    assert.match(agents, /Rest und Neues ins Folge-Sammelticket/);
  });
});

describe("Sammelticket-Deckel: der Rest kommt nicht in denselben PR (factory#268)", () => {
  test("weder AGENTS.md noch eine Verweis-Stelle enthält das alte „komplett, kein Rest“", () => {
    for (const f of ["AGENTS.md", ...VERWEISE]) assert.ok(!ziehtRestInDenPR(lies(f)), f);
  });

  test("Erkennung greift nicht zu weit (Red-Green der Grenzen): Verneinung, Klausel-Trennung und Wortgrenzen", () => {
    for (const frei of [
      "der Rest kommt nie in diesen PR",
      "der Rest kommt nicht in diesen PR",
      "Der Rest bleibt. Die Zeilen kommen in einem PR",
      "Rest; in einem PR",
      "Rest: in einem PR",
      "Rest (in einem PR)",
      "(Rest) in einem PR",
      "Restarbeit in einem PR",
      "VorRest in einem PR",
      "VorREST in einem PR",
      "RESTE in einem PR",
      "Der Rest XPR mit",
      "Der Rest PR umständlich",
      "Der Rest wird Teil des Folge-Sammeltickets",
      "Der Rest dieses PR bleibt offen",
      "Den Rest im Folge-Sammelticket umsetzen",
    ]) {
      assert.ok(!restKlauselInPR(frei), frei);
    }
  });

  test("der Override-Weg zieht den Rest nicht zurück: nur eine einzelne Zeile, die allein über check:diffsize liegt", () => {
    assert.match(lies("docs/ticket-reihenfolge.md"), /gilt nur für eine einzelne Zeile, die allein darüber liegt/);
    assert.match(lies(".claude/agents/factory-umsetzer.md"), /nur für eine einzelne Zeile, die allein über `check:diffsize` liegt/);
  });

  test("Erkennung greift (Red-Green): andere Wege, den Rest wieder in denselben PR zu ziehen, fallen durch", () => {
    for (const weg of [
      "Der Override gilt für den ganzen Lauf, dann setzt du auch die REST-Zeilen in diesem PR um.",
      "Mit diesem Override darf ein Lauf auch alle Zeilen des Tickets komplett umsetzen.",
      "Danach das ganze Ticket komplett abarbeiten, kein Rest.",
      "Alle Zeilen des Tickets werden in einem PR umgesetzt.",
      "der Rest geht ins Folge-Sammelticket oder kommt in denselben PR mit",
      "der Rest kommt im selben PR mit",
      "Der Rest kommt in denselben PR.",
      "Rest und Neues in denselben PR.",
      "Der Rest wird Teil desselben PR.",
      "Nachzügler kommen mit in diesen PR",
      "Dazugekommenes in diesem PR umsetzen",
      "alle übrigen Zeilen im selben PR mit",
      "Es gilt der Rest-Übertrag.",
      "Setze den Rest PR um",
      "Die Linie zieht den Rest in diesen PR",
      "Das nichtig lässt den Rest in diesen PR",
      "Die niedrige Priorität zieht den Rest in diesen PR",
      "Vornicht zieht den Rest in diesen PR",
      "Der Rest kommt in den PR",
      "Der Rest bleibt in dem PR",
      "Der Rest kommt in demselben PR",
      "Der Rest bleibt im selben PR.",
      "Der Rest geht in einen PR",
      "Den Rest nimmst du in den laufenden PR mit",
      "Der Rest wird Bestandteil dieses PR",
      "Der Rest wird Teil dieses PR",
      "übrige Zeilen kommen in diesen PR",
      "Übrige Zeilen kommen in diesen PR",
      "Der Rest kommt in **denselben** PR.",
      "Der Rest kommt in    denselben PR.",
      "Eine harmlose Zeile\nDer Rest kommt in diesen PR",
      "Der Rest kommt in den selben PR",
      "Der Rest kommt in dem selben PR",
      "Der Rest kommt in den gleichen PR",
      "Der Rest kommt in __denselben__ PR",
      "Der Rest kommt in _denselben_ PR",
      "Der _Rest_ kommt in denselben PR",
      "Der Rest kommt in `denselben` PR",
      "In denselben PR kommt der Rest",
      "Im selben PR bleibt der Rest",
      "Das gilt nie. Der Rest kommt in diesen PR",
      "Der Rest kommt in diesen PR\nEine harmlose Zeile",
      "Der Rest kommt in\tdenselben PR",
      "Der Rest kommt in\u00a0denselben PR",
      "Der Rest kommt in *denselben* PR",
      "Das gilt nie\nDer Rest kommt in diesen PR",
    ]) {
      assert.ok(ziehtRestInDenPR(weg), weg);
    }
    for (const ok of [
      "der Rest geht ins Folge-Sammelticket, nie Teil desselben PR",
      "die gewählten Zeilen komplett in einem PR, je Zeile ein Ergebnis, Rest ins Folge-Sammelticket",
      "Der PR löst die ALLOWLIST-Einträge auf.",
      "ein Nachzügler wird eine Zeile im Folge-Sammelticket, nie Teil dieses PR",
    ]) {
      assert.ok(!ziehtRestInDenPR(ok), ok);
    }
  });

  test("Erkennung greift (Red-Green): jeder alte Wortlaut fällt durch, der neue nicht", () => {
    for (const alt of [
      "Zeilen, die während der Arbeit dazukamen, " + "kommen in denselben PR",
      "setze ALLE " + "Zeilen um",
      "plane ALLE " + "Zeilen",
      "komplett umsetzen, " + "kein Rest-Übertrag",
      "zwar **komp" + "lett** (kein Rest; zu groß",
      "alle Zeilen " + "in einem PR",
      "Es hat " + "keine Zeilengrenze",
      "(einen Nachzügler " + "setzt du selbst um)",
    ]) {
      assert.ok(ziehtRestInDenPR(alt), alt);
    }
    assert.ok(!ziehtRestInDenPR("setze ALLE gewählten Zeilen um; Rest und Neues ins Folge-Sammelticket"));
    assert.ok(!ziehtRestInDenPR(""));
  });
});
