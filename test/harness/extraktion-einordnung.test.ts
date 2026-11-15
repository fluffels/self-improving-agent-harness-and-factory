/* Einordnungs-Wächter der Extraktionsliste (factory#496): jede getrackte Testdatei unter test/ (`*.test.ts`) steht in `.factory/extraktion.json` als `kern-test` oder `projekt-test`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Ohne Bezugs-Heuristik: eine Testdatei ohne Eintrag ist rot, gleich wie sie zum Besitz steht. Sonst fiele sie aus der Null-Regel
 * (`kern-reinheit.test.ts`) und der Fremd-Config-Probe heraus.
 * Einordnungsregel: `kern-test` ist der Normalfall (Sammelmuster erlaubt, wenn sie eine Familie gleicher Art bündeln); `projekt-test` nur als
 * Einzeleintrag ohne `*` und mit Grund, für eine Testdatei, die Projektinhalt prüft und darum Projektliterale tragen darf.
 * Grenzen: ein Sammelmuster für `kern-test` kann eine künftige Projekt-Testdatei mitnehmen (die Null-Regel meldet sie dann); ein Eintrag ohne
 * Treffer wird nicht geprüft; die übrige Struktur der Liste prüft kein Wächter. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawExtraktion from "../../scripts/besitz-extraktion.mjs";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

interface Liste {
  eintraege: { muster?: string; ring?: string; art: string }[];
}
const { artVon, istTestDatei, musterRegex, EXTRAKTION_PFAD } = rawExtraktion as unknown as {
  artVon: (liste: Liste, pfad: string) => string | null;
  istTestDatei: (pfad: string) => boolean;
  musterRegex: (muster: string) => RegExp;
  EXTRAKTION_PFAD: string;
};

/** Arten, in die eine Testdatei gehört. */
const ERLAUBTE_ARTEN = ["kern-test", "projekt-test"];
const WEG = "(Eintrag in .factory/extraktion.json: kern-test als Einzelpfad oder Familien-Muster, projekt-test nur als Einzelpfad mit Grund, wenn die Datei Projektinhalt prüft oder vorerst Projektliterale trägt)";

/** Getrackte Testdateien, deren Art weder `kern-test` noch `projekt-test` ist (auch: nicht eingeordnet). */
export const nichtEingeordnet = (liste: Liste, getrackt: string[]): string[] =>
  getrackt.filter(istTestDatei).flatMap((p) => {
    const art = artVon(liste, p);
    return ERLAUBTE_ARTEN.includes(art ?? "") ? [] : [`${p}: nicht eingeordnet (Art: ${art ?? "keine"}) ${WEG}`];
  });

/** Testdateien, die mehr als ein Muster treffen (`artVon` nimmt den ersten Treffer, der zweite wäre wirkungslos). */
export const mehrdeutig = (liste: Liste, getrackt: string[]): string[] => {
  const res = liste.eintraege.filter((e) => e.muster !== undefined).map((e) => musterRegex(e.muster as string));
  return getrackt.filter(istTestDatei).filter((p) => res.filter((re) => re.test(p)).length > 1).map((p) => `${p}: trifft mehr als einen Eintrag der Extraktionsliste`);
};

/** Einträge der Art `projekt-test`, deren Muster ein `*` enthält (nur Einzeleinträge erlaubt). */
export const projektTestMitMuster = (liste: Liste): string[] =>
  liste.eintraege.filter((e) => e.art === "projekt-test" && (e.muster ?? "").includes("*")).map((e) => `${e.muster}: projekt-test nur als Einzelpfad ohne '*'`);

const eintrag = (muster: string, art: string): Liste["eintraege"][number] => ({ muster, art });

describe("Einordnungs-Wächter der Extraktionsliste (factory#496), synthetisch", () => {
  const liste: Liste = { eintraege: [eintrag("test/a.test.ts", "kern-test"), eintrag("test/p/*.test.ts", "kern-test"), eintrag("test/pt.test.ts", "projekt-test"), eintrag("test/f.test.ts", "fixture"), eintrag("test/h.test.ts", "test-hilfe")] };

  test("eine neue Testdatei ohne Eintrag ergibt genau eine Meldung mit Pfad", () => {
    const m = nichtEingeordnet(liste, ["test/a.test.ts", "test/p/x.test.ts", "test/pt.test.ts", "test/neu.test.ts"]);
    assert.equal(m.length, 1);
    assert.match(m[0], /^test\/neu\.test\.ts: nicht eingeordnet \(Art: keine\)/);
    assert.match(m[0], /Eintrag in \.factory\/extraktion\.json/);
  });

  test("eine andere Art (fixture, test-hilfe) ist rot", () => {
    const m = nichtEingeordnet(liste, ["test/f.test.ts", "test/h.test.ts"]);
    assert.deepEqual(m.map((x) => x.split(" ")[0]), ["test/f.test.ts:", "test/h.test.ts:"]);
    assert.match(m[0], /Art: fixture/);
  });

  test("kein Treffer außerhalb von istTestDatei", () => {
    assert.deepEqual(nichtEingeordnet(liste, ["test/support/x.ts", "scripts/a.test.ts", "test/a.test.mjs", "docs/x.md"]), []);
  });

  test("mehrdeutig: Muster plus Einzeleintrag auf derselben Datei ist rot, sonst leer", () => {
    const l: Liste = { eintraege: [eintrag("test/p/*.test.ts", "kern-test"), eintrag("test/p/x.test.ts", "projekt-test")] };
    const m = mehrdeutig(l, ["test/p/x.test.ts", "test/p/y.test.ts"]);
    assert.equal(m.length, 1);
    assert.match(m[0], /^test\/p\/x\.test\.ts: /);
    assert.deepEqual(mehrdeutig(liste, ["test/a.test.ts", "test/p/x.test.ts"]), []);
  });

  test("mehrdeutig: eine doppelt getroffene Nicht-Testdatei und ein ring-Eintrag bleiben stumm", () => {
    const l: Liste = { eintraege: [eintrag("test/support/*.ts", "test-hilfe"), eintrag("test/support/x.ts", "test-hilfe"), { ring: "oberflaeche", art: "ring" }] };
    assert.deepEqual(mehrdeutig(l, ["test/support/x.ts"]), []);
  });

  test("projekt-test mit Muster ist rot, als Einzelpfad grün", () => {
    assert.equal(projektTestMitMuster({ eintraege: [eintrag("test/harness/*-projekt.test.ts", "projekt-test")] }).length, 1);
    assert.deepEqual(projektTestMitMuster(liste), []);
  });
});

describe("Einordnungs-Wächter der Extraktionsliste (factory#496), echter Stand", () => {
  const liste = JSON.parse(readFileSync(WURZEL + EXTRAKTION_PFAD, "utf8")) as Liste;
  const getrackt = execFileSync("git", ["ls-files"], { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter((p) => p !== "" && existsSync(WURZEL + p));
  const tests = getrackt.filter(istTestDatei);

  test("Leerlauf-Schutz: viele Testdateien, beide Arten kommen vor", () => {
    assert.ok(tests.length > 250, `nur ${tests.length} Testdateien gefunden`);
    const arten = new Set(tests.map((p) => artVon(liste, p)));
    assert.ok(arten.has("kern-test") && arten.has("projekt-test"), `Arten: ${[...arten].join(", ")}`);
  });

  test("jede getrackte Testdatei ist als kern-test oder projekt-test eingeordnet", () => {
    assert.deepEqual(nichtEingeordnet(liste, getrackt), []);
  });

  test("keine Testdatei trifft mehr als einen Eintrag", () => {
    assert.deepEqual(mehrdeutig(liste, getrackt), []);
  });

  test("projekt-test steht nur als Einzelpfad ohne '*'", () => {
    assert.deepEqual(projektTestMitMuster(liste), []);
  });
});
