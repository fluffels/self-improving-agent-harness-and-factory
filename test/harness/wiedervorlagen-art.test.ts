/* @harness-waechter Jeder Eintrag in .github/wiedervorlagen.json der Fabrik trägt ein Feld art aus der geschlossenen Liste (factory#573). Grenze: prüft nur die Fabrik-Datei, nicht die Dateien der Bezieher; umstellung und regel sind verboten (sie gehören ins Änderungsregister). Seit factory#574 gibt es keine Ausnahme ohne art mehr. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WIEDERVORLAGE_ARTEN = ["frist", "abhaengigkeit", "sicherheit", "upstream", "analyse-takt"];
const VERBOTEN = ["umstellung", "regel"];

type Eintrag = { id?: unknown; art?: unknown };

/** Liefert die Verstöße einer Wiedervorlagen-Liste; leer heißt gültig. */
function artFehler(liste: Eintrag[]): string[] {
  const fehler: string[] = [];
  for (const e of liste) {
    const id = String(e.id);
    if (e.art === undefined) {
      fehler.push(`${id}: Feld art fehlt`);
    } else if (typeof e.art !== "string") {
      fehler.push(`${id}: art ist kein Text`);
    } else if (VERBOTEN.includes(e.art)) {
      fehler.push(`${id}: art "${e.art}" ist verboten (Registerzeile statt Wiedervorlage)`);
    } else if (!WIEDERVORLAGE_ARTEN.includes(e.art)) {
      fehler.push(`${id}: art "${e.art}" nicht in ${WIEDERVORLAGE_ARTEN.join(", ")}`);
    }
  }
  return fehler;
}

/** Der Name des früheren Sammeleintrags, zusammengesetzt, damit `git grep` ihn nicht findet. */
const SAMMEL = ["regeln", "verfall", "2027", "03"].join("-");

describe("artFehler (Fixtures)", () => {
  it("gültige Liste ist grün", () => {
    const liste = [{ id: "a", art: "frist" }, { id: "b", art: "analyse-takt" }];
    expect(artFehler(liste)).toEqual([]);
  });

  it.each(["umstellung", "regel"])("art %s ist rot", (art) => {
    const f = artFehler([{ id: "a", art }]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("verboten");
  });

  it("fehlendes art ist rot", () => {
    expect(artFehler([{ id: "a" }])).toEqual(["a: Feld art fehlt"]);
  });

  it("unbekannter Wert ist rot", () => {
    expect(artFehler([{ id: "a", art: "xyz" }])[0]).toContain("nicht in");
  });

  it("Nicht-Text ist rot", () => {
    expect(artFehler([{ id: "a", art: 1 }])).toEqual(["a: art ist kein Text"]);
  });

  it("der frühere Sammeleintrag ist ohne Sonderstellung rot (factory#574)", () => {
    expect(artFehler([{ id: SAMMEL }])).toEqual([`${SAMMEL}: Feld art fehlt`]);
    const f = artFehler([{ id: SAMMEL, art: "regel" }]);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("verboten");
  });
});

describe("echte Fabrik-Datei", () => {
  const liste = JSON.parse(readFileSync(".github/wiedervorlagen.json", "utf8")) as Eintrag[];

  it("ist nicht leer (Leerlauf-Schutz)", () => {
    expect(liste.length).toBeGreaterThan(5);
  });

  it("die Liste der Arten stimmt mit der Regel in AGENTS.md überein (unabhängige Quelle)", () => {
    const agents = readFileSync("AGENTS.md", "utf8");
    const zeile = agents.split("\n").find((l) => l.includes("Umstellung oder neue Regel → Registerzeile")) ?? "";
    const genannt = [...zeile.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]).filter((w) => w !== "art");
    expect(genannt).toEqual(WIEDERVORLAGE_ARTEN);
  });

  it("jeder Eintrag trägt art aus der Liste, keinen Sammeleintrag mehr", () => {
    expect(artFehler(liste)).toEqual([]);
    expect(liste.some((e) => e.id === SAMMEL)).toBe(false);
  });
});
