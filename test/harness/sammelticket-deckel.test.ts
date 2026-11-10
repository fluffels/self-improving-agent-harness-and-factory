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
import { existsSync, readdirSync, readFileSync } from "node:fs";
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

/* ---- Vollscan: keine zweite Zeilenzahl-Regel für Sammeltickets (K5, factory#268) ----
 *
 * Statt einer fest verdrahteten Dateiliste scannt der Wächter alle Markdown-Dateien unter docs/ (ohne docs/adr/ und die
 * Historie: docs/lessons-learned.md und datierte Gegenprobe-Berichte `…-JJJJ-MM-TT.md`), .agents/ und .claude/agents/
 * sowie AGENTS.md (dort ohne die eine SSOT-Stelle „Deckel <N> Zeilen“) auf zwei Regeln:
 *   A) überall: Mengenwort (höchstens, maximal, bis zu, Obergrenze, Deckel, Limit) gefolgt von „<N> Zeilen“;
 *   B) in Zeilen, die ein Sammelticket nennen: jede Angabe „<N> Zeilen“ oder „Zeilen je Lauf/PR“.
 * Jeder Treffer außerhalb der geschlossenen Liste ZEILENZAHL_AUSNAHMEN (Treffertext je Datei, mit Grund) ist ein Verstoß;
 * ein Ausnahme-Eintrag, der nichts mehr trifft, ist ebenfalls rot (keine toten Einträge).
 *
 * Bekannte Grenzen: Zahlen in Worten („zwölf Zeilen“), Tabellenzellen ohne „Zeilen“, Skripte und Tests, andere Dateiarten,
 * eine Regel ohne die Mengenwörter in einer Zeile ohne „Sammelticket“/„gesammelt“; ein Ausnahme-Treffer gilt für die
 * ganze Datei (nicht je Zeile); Markdown-Auszeichnung im Treffer („**12** Zeilen“) wird nicht normalisiert.
 */
const SCAN_WURZELN = ["docs", ".agents", ".claude/agents"];
const REGEL_A = /(?:höchstens|maximal|bis zu|Obergrenze|Deckel|Limit)\D{0,20}\d+\s+(?:Befund-)?Zeilen/gi;
const REGEL_B = /\d+\s+(?:Befund-)?Zeilen|Zeilen (?:je|pro) (?:Lauf|PR)/gi;
const SAMMELTICKET = /Sammelticket|gesammelt/i;

/** Geschlossene Liste: Treffer, die keine Sammelticket-Zeilenzahl-Regel sind. */
export const ZEILENZAHL_AUSNAHMEN: { pfad: string; treffer: string; grund: string }[] = [
  { pfad: ".claude/agents/factory-gruppe.md", treffer: "höchstens ~15 Zeilen", grund: "Länge des Gruppen-Berichts" },
  { pfad: "docs/factory/entscheidungsprotokoll.md", treffer: "höchstens 10 Zeilen", grund: "Länge der Rückmeldung eines Subagenten" },
  { pfad: ".claude/agents/factory-planer.md", treffer: "300 Zeilen", grund: "Dateien, die der Planer nicht ganz liest" },
  { pfad: ".claude/agents/factory-planer.md", treffer: "6 Zeilen", grund: "Schwelle für Gruppen (ADR 0026), kein Deckel je Lauf" },
  { pfad: "docs/ticket-reihenfolge.md", treffer: "6 Zeilen", grund: "Schwelle für Gruppen (ADR 0026), kein Deckel je Lauf" },
  { pfad: "docs/model-routing.md", treffer: "300 Zeilen", grund: "Messung Planer-Laufzeit" },
  { pfad: "docs/model-routing.md", treffer: "200 Zeilen", grund: "Messung (Kontext sparen)" },
  { pfad: "docs/model-routing.md", treffer: "100 Zeilen", grund: "Messung (Kontext sparen)" },
  { pfad: "docs/model-routing.md", treffer: "1000 Zeilen", grund: "Messung (Datei-Lesegrenze)" },
];

const istHistorie = (pfad: string): boolean => pfad === "docs/lessons-learned.md" || /-\d{4}-\d{2}-\d{2}\.md$/.test(pfad);

function sammleMarkdown(rel: string): string[] {
  const abs = fileURLToPath(new URL(`../../${rel}`, import.meta.url));
  if (!existsSync(abs)) return [];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const sub = `${rel}/${e.name}`;
    if (e.isDirectory()) return rel === "docs" && e.name === "adr" ? [] : sammleMarkdown(sub);
    return e.name.endsWith(".md") && !istHistorie(sub) ? [sub] : [];
  });
}

/** Alle Treffer der Regeln A und B (Treffertext je Datei); AGENTS.md ohne die SSOT-Stelle. Pure. */
export function zeilenzahlTreffer(dateien: { pfad: string; text: string }[]): { pfad: string; treffer: string }[] {
  const aus: { pfad: string; treffer: string }[] = [];
  for (const { pfad, text: roh } of dateien) {
    const text = pfad === "AGENTS.md" ? roh.replace(/Deckel \d+ Zeilen/, "") : roh;
    for (const zeile of text.split("\n")) {
      for (const t of zeile.match(REGEL_A) ?? []) aus.push({ pfad, treffer: t });
      if (SAMMELTICKET.test(zeile)) for (const t of zeile.match(REGEL_B) ?? []) aus.push({ pfad, treffer: t });
    }
  }
  return aus;
}

/** Verstöße: Treffer, die nicht in der Ausnahmeliste stehen, und tote Ausnahme-Einträge. Pure. */
export function zeilenzahlVerstoesse(dateien: { pfad: string; text: string }[], ausnahmen = ZEILENZAHL_AUSNAHMEN): string[] {
  const treffer = zeilenzahlTreffer(dateien);
  const offen = treffer.filter((t) => !ausnahmen.some((a) => a.pfad === t.pfad && t.treffer === a.treffer));
  const tot = ausnahmen.filter((a) => !treffer.some((t) => t.pfad === a.pfad && t.treffer === a.treffer));
  return [...offen.map((t) => `${t.pfad}: „${t.treffer}“ ist eine Zeilenzahl-Regel außerhalb der SSOT`), ...tot.map((a) => `${a.pfad}: toter Ausnahme-Eintrag „${a.treffer}“`)];
}

describe("Sammelticket-Deckel: keine zweite Zeilenzahl-Regel im ganzen Brain (factory#268, K5)", () => {
  const echte = [...SCAN_WURZELN.flatMap(sammleMarkdown), "AGENTS.md"].map((pfad) => ({ pfad, text: lies(pfad) }));

  test("der Vollscan über docs/, .agents/, .claude/agents/ und AGENTS.md findet nur die geschlossene Ausnahmeliste", () => {
    assert.deepEqual(zeilenzahlVerstoesse(echte), []);
  });

  test("Leerlauf-Schutz: der Scan sieht die erwarteten Dateien und keine Historie", () => {
    const pfade = echte.map((d) => d.pfad);
    for (const erwartet of ["AGENTS.md", "docs/ticket-reihenfolge.md", ".agents/skills/review-lenses/SKILL.md", "docs/agent-harness.md", "docs/referenz/befehle.md", ".claude/agents/factory-umsetzer.md"]) {
      assert.ok(pfade.includes(erwartet), erwartet);
    }
    assert.ok(!pfade.some((p) => p.startsWith("docs/adr/") || p === "docs/lessons-learned.md" || /-\d{4}-\d{2}-\d{2}\.md$/.test(p)));
    assert.ok(echte.find((d) => d.pfad === "AGENTS.md")?.text.includes("Deckel 12 Zeilen"));
  });

  test("Negativfälle: eine zweite oder abweichende Zahl wird überall erkannt (Red-Green)", () => {
    const basis = echte.filter((d) => ["AGENTS.md", "docs/agent-harness.md", "docs/referenz/befehle.md", ".agents/skills/review-lenses/SKILL.md", "docs/ticket-reihenfolge.md"].includes(d.pfad));
    const mit = (pfad: string, zusatz: string) => basis.map((d) => (d.pfad === pfad ? { ...d, text: `${d.text}\n${zusatz}` } : d));
    for (const pfad of ["AGENTS.md", "docs/agent-harness.md", "docs/referenz/befehle.md", ".agents/skills/review-lenses/SKILL.md", "docs/ticket-reihenfolge.md"]) {
      for (const zusatz of [
        "Ein Sammelticket-Lauf nimmt höchstens 15 Zeilen.",
        "Der Deckel von 12 Zeilen gilt je Sammelticket.",
        "Je Lauf maximal 12 Zeilen.",
        "Das Sammelticket wird in 12 Zeilen je Lauf geschnitten.",
        "Je Lauf bis zu 12 Zeilen.",
        "Je Lauf Obergrenze 12 Zeilen.",
        "Je Lauf Limit 12 Zeilen.",
        "Je Lauf höchstens 12 Befund-Zeilen.",
        "Sammelticket: Zeilen je Lauf begrenzen.",
        "Sammelticket: Zeilen pro Lauf begrenzen.",
        "Sammelticket: Zeilen je PR begrenzen.",
        "Alles gesammelt in 12 Zeilen.",
        "Das Sammelticket schneidet 12 Zeilen.",
      ]) {
        assert.ok(zeilenzahlVerstoesse(mit(pfad, zusatz)).some((v) => v.startsWith(`${pfad}: „`)), `${pfad}: ${zusatz}`);
      }
    }
  });

  test("Negativfall: ein zweiter Deckel in AGENTS.md selbst und ein toter Ausnahme-Eintrag werden erkannt", () => {
    const agents = echte.find((d) => d.pfad === "AGENTS.md")!;
    assert.deepEqual(zeilenzahlVerstoesse([agents], []), []);
    assert.equal(zeilenzahlVerstoesse([{ pfad: "AGENTS.md", text: `${agents.text}\nDeckel 15 Zeilen` }], []).length, 1);
    assert.equal(zeilenzahlVerstoesse([{ pfad: "x.md", text: "nichts" }], [{ pfad: "x.md", treffer: "7 Zeilen", grund: "g" }]).length, 1);
    assert.deepEqual(zeilenzahlVerstoesse([{ pfad: "x.md", text: "Sammelticket: 7 Zeilen" }], [{ pfad: "x.md", treffer: "7 Zeilen", grund: "g" }]), []);
  });
});
