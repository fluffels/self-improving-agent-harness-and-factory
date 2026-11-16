/* @harness-waechter Jeder Eintrag in .github/wiedervorlagen.json der Fabrik trägt ein Feld art aus der geschlossenen Liste (factory#573). Grenze: prüft nur die Fabrik-Datei, nicht die Dateien der Bezieher; umstellung und regel sind verboten (sie gehören ins Änderungsregister). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const WIEDERVORLAGE_ARTEN = ["frist", "abhaengigkeit", "sicherheit", "upstream", "analyse-takt"];
const VERBOTEN = ["umstellung", "regel"];
/** Einzige Ausnahme ohne `art` bis zum Kind „Sammeleintrag auflösen“ (factory#574). */
const AUSNAHME_OHNE_ART = "regeln-verfall-2027-03";

type Eintrag = { id?: unknown; art?: unknown };

/** Liefert die Verstöße einer Wiedervorlagen-Liste; leer heißt gültig. */
function artFehler(liste: Eintrag[], ausnahme: string): string[] {
  const fehler: string[] = [];
  for (const e of liste) {
    const id = String(e.id);
    if (id === ausnahme && e.art === undefined) continue;
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
  if (!liste.some((e) => e.id === ausnahme)) {
    fehler.push(`Ausnahme ${ausnahme} steht nicht mehr in der Datei: Ausnahme entfernen`);
  }
  return fehler;
}

const AUSN = "ausnahme-id";

describe("artFehler (Fixtures)", () => {
  it("gültige Liste ist grün", () => {
    const liste = [{ id: "a", art: "frist" }, { id: "b", art: "analyse-takt" }, { id: AUSN }];
    expect(artFehler(liste, AUSN)).toEqual([]);
  });

  it.each(["umstellung", "regel"])("art %s ist rot", (art) => {
    const f = artFehler([{ id: "a", art }, { id: AUSN }], AUSN);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("verboten");
  });

  it("fehlendes art ist rot", () => {
    expect(artFehler([{ id: "a" }, { id: AUSN }], AUSN)).toEqual(["a: Feld art fehlt"]);
  });

  it("unbekannter Wert ist rot", () => {
    expect(artFehler([{ id: "a", art: "xyz" }, { id: AUSN }], AUSN)[0]).toContain("nicht in");
  });

  it("Nicht-Text ist rot", () => {
    expect(artFehler([{ id: "a", art: 1 }, { id: AUSN }], AUSN)).toEqual(["a: art ist kein Text"]);
  });

  it("Ausnahme darf nur art weglassen: mit art muss der Wert gültig sein", () => {
    expect(artFehler([{ id: AUSN, art: "regel" }], AUSN)).toHaveLength(1);
    expect(artFehler([{ id: AUSN, art: "frist" }], AUSN)).toEqual([]);
  });

  it("fehlt die Ausnahme in der Datei, ist das rot mit Hinweis", () => {
    const f = artFehler([{ id: "a", art: "frist" }], AUSN);
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("Ausnahme entfernen");
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

  it("jeder Eintrag trägt art aus der Liste (Ausnahme benannt)", () => {
    expect(artFehler(liste, AUSNAHME_OHNE_ART)).toEqual([]);
  });
});
