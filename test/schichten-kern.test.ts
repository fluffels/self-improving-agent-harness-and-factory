/* Schicht-Kern (factory#184): mehrere Quellwurzeln und Endungen im Schicht-Modell.
 * Zuerst die eingefrorene Referenz-Ableitung (Stand vor factory#184): für ein Modell mit einer Wurzel und `.ts`
 * darf sich die Ableitung für dependency-cruiser und Coverage nicht ändern.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

type Schicht = { id: string; label: string; muster: string | null; wurzeln: string[]; nurDatei?: boolean; darf: string[] };
type Extern = { id: string; label: string; muster: string };
type Modell = { quellwurzel?: string; quellwurzeln?: string[]; endungen?: string[]; schichten: Schicht[]; extern: Extern[] };
type Kern = {
  musterAus: (q: string | string[], w: string[], nurDatei: boolean, endungen?: string[]) => string;
  pruefeModell: (m: unknown) => void;
  layerOfAus: (m: Modell) => (f: string) => string;
  wurzelnAusserAuffangAus: (m: Modell) => string[];
  coverageGlobsAus: (m: Modell) => Record<string, string>;
  verbotsRegeln: (m: Modell) => unknown[];
};

const req = createRequire(import.meta.url);
const kern = req("../scripts/schichten-kern.cjs") as Kern;
const layers = req("../scripts/layers.cjs") as { SCHICHT_MODELL: Modell; COVERAGE_GLOBS: Record<string, string> };

// --- Referenz-Ableitung (Stand vor factory#184), wörtlich aus dem Kern übernommen ---------------------------------
const D_TS = "\\.d\\.ts$";
function refBedingung(modell: Modell, ziel: Schicht, alsQuelle: boolean) {
  const andere = modell.schichten.filter((s) => s.muster && s.id !== ziel.id).map((s) => s.muster);
  if (ziel.muster) return alsQuelle ? { path: ziel.muster, pathNot: D_TS } : { path: ziel.muster };
  return { path: `^${modell.quellwurzel}`, pathNot: [...andere, ...(alsQuelle ? [D_TS] : [])].join("|") };
}
function refVerbotsRegeln(modell: Modell) {
  const regeln = [];
  const ziele: Array<Schicht | Extern> = [...modell.schichten, ...modell.extern];
  for (const von of modell.schichten) {
    for (const nach of ziele) {
      if (nach.id === von.id || von.darf.includes(nach.id)) continue;
      regeln.push({
        name: `schicht-${von.id}-nicht-${nach.id}`,
        comment: `${von.label} darf ${nach.label} nicht importieren (erlaubte Richtungen: \`darf\` im SCHICHT_MODELL der Schicht-Definition).`,
        severity: "error",
        from: refBedingung(modell, von, true),
        to: refBedingung(modell, nach as Schicht, false),
      });
    }
  }
  return regeln;
}
function refCoverageGlobs(modell: Modell) {
  const nonDomain = kern.wurzelnAusserAuffangAus(modell);
  const nd = nonDomain.join("|");
  const ndTs = nonDomain.map((n) => `${n}.ts`).join("|");
  const q = modell.quellwurzel;
  const auffang = modell.schichten.find((s) => s.muster === null)!;
  const globVon = (s: Schicht) => `${q}{${s.wurzeln.join(",")}}${s.nurDatei ? ".ts" : "{.ts,/**}"}`;
  return {
    ...Object.fromEntries(modell.schichten.filter((s) => s.wurzeln.length > 0).map((s) => [s.id, globVon(s)])),
    [auffang.id]: `${q}{!(${nd})/**,!(${ndTs})}`,
  };
}

/** Modell aus Schichten (Wurzeln je Schicht), Muster über `musterAus`. */
function modellAus(opt: { quellwurzel?: string; quellwurzeln?: string[]; endungen?: string[] }, extern: Extern[] = []): Modell {
  const q = opt.quellwurzeln ?? opt.quellwurzel!;
  const e = opt.endungen;
  const roh: Omit<Schicht, "muster">[] = [
    { id: "einstieg", label: "Einstieg", wurzeln: ["main"], nurDatei: true, darf: ["web", "kern"] },
    { id: "web", label: "Web", wurzeln: ["web", "api"], darf: ["kern"] },
    { id: "kern", label: "Kern", wurzeln: [], darf: [] },
  ];
  return {
    ...opt,
    schichten: roh.map((s) => ({ ...s, muster: s.wurzeln.length ? kern.musterAus(q, s.wurzeln, s.nurDatei === true, e) : null })),
    extern,
  };
}

const EXTERN: Extern[] = [{ id: "fremd", label: "Fremd", muster: "^node_modules/" }];

describe("Referenz: eine Wurzel und .ts bleiben unverändert (AK2)", () => {
  test("echtes SCHICHT_MODELL: verbotsRegeln und coverageGlobsAus gleich der Referenz", () => {
    assert.deepEqual(kern.verbotsRegeln(layers.SCHICHT_MODELL), refVerbotsRegeln(layers.SCHICHT_MODELL));
    assert.deepEqual(kern.coverageGlobsAus(layers.SCHICHT_MODELL), refCoverageGlobs(layers.SCHICHT_MODELL));
    assert.deepEqual(layers.COVERAGE_GLOBS, refCoverageGlobs(layers.SCHICHT_MODELL));
  });

  test("synthetisches Modell mit extern: gleich der Referenz", () => {
    const m = modellAus({ quellwurzel: "src/" }, EXTERN);
    assert.ok(refVerbotsRegeln(m).length > 0);
    assert.deepEqual(kern.verbotsRegeln(m), refVerbotsRegeln(m));
    assert.deepEqual(kern.coverageGlobsAus(m), refCoverageGlobs(m));
  });

  test("Äquivalenz: quellwurzeln [q] und endungen [.ts] liefern dieselbe Ableitung wie quellwurzel q", () => {
    const alt = layers.SCHICHT_MODELL;
    const q = alt.quellwurzel!;
    const neu: Modell = {
      quellwurzeln: [q],
      endungen: [".ts"],
      extern: alt.extern,
      schichten: alt.schichten.map((s) => ({ ...s, muster: s.wurzeln.length ? kern.musterAus([q], s.wurzeln, s.nurDatei === true, [".ts"]) : null })),
    };
    assert.deepEqual(
      neu.schichten.map((s) => s.muster),
      alt.schichten.map((s) => s.muster),
    );
    assert.deepEqual(kern.verbotsRegeln(neu), kern.verbotsRegeln(alt));
    assert.deepEqual(kern.wurzelnAusserAuffangAus(neu), kern.wurzelnAusserAuffangAus(alt));
    const layerAlt = kern.layerOfAus(alt);
    const layerNeu = kern.layerOfAus({ ...alt, quellwurzel: undefined, quellwurzeln: [q], endungen: [".ts"] });
    for (const p of ["scripts/x.ts", "scripts/cockpit/a.mjs", "scripts/einstieg.ts", "scripts/einstieg.mjs", "extern/x.ts"]) {
      assert.equal(layerNeu(p), layerAlt(p), p);
    }
  });
});

describe("musterAus", () => {
  test("TS-Form unverändert, String und Liste gleich", () => {
    assert.equal(kern.musterAus("scripts/", ["a", "b"], false), "^scripts/(a|b)(\\.ts$|/)");
    assert.equal(kern.musterAus("scripts/", ["e"], true), "^scripts/(e)\\.ts$");
    assert.equal(kern.musterAus(["scripts/"], ["a", "b"], false), kern.musterAus("scripts/", ["a", "b"], false));
  });

  const WURZELN = ["backend/src/main/java/de/app/", "frontend/src/app/"];
  const rx = (nurDatei: boolean) => new RegExp(kern.musterAus(WURZELN, ["domain"], nurDatei, [".java", ".ts"]));

  test("mehrere Wurzeln und Endungen", () => {
    const r = rx(false);
    for (const p of ["backend/src/main/java/de/app/domain/Foo.java", "frontend/src/app/domain/x.ts", "frontend/src/app/domain.ts"]) assert.ok(r.test(p), p);
    for (const p of ["backend/src/main/java/de/app/domainx/Foo.java", "andere/domain/x.java", "backend/src/main/java/de/app/domain.kt"]) assert.ok(!r.test(p), p);
  });

  test("Punkte der Endungen sind escaped", () => {
    assert.ok(!new RegExp(kern.musterAus("a/", ["main"], true, [".java"])).test("a/mainXjava"));
    assert.ok(new RegExp(kern.musterAus("a/", ["main"], true, [".java"])).test("a/main.java"));
    assert.ok(!new RegExp(kern.musterAus("a/", ["main"], false, [".java"])).test("a/mainXjava"));
  });

  test("Endung ausserhalb der Form (Backslash, Regex-Zeichen) wirft statt ein Muster zu bauen", () => {
    for (const e of [".a\\b", ".c+", "java", ".j(a)"]) assert.throws(() => kern.musterAus("a/", ["main"], true, [e]), /Endung/, e);
  });

  test("Grenze: Verzeichnis-Schicht nimmt alle Dateien darunter, Datei-Schicht nur ihre Endungen", () => {
    const wurzeln = ["src/main/java/", "src/test/java/"];
    const dir = new RegExp(kern.musterAus(wurzeln, ["domain"], false, [".java"]));
    assert.ok(dir.test("src/main/java/domain/Konto.ts"));
    assert.ok(dir.test("src/test/java/domain/Konto.java"));
    assert.ok(dir.test("src/main/java/domain.java"));
    assert.ok(!dir.test("src/main/java/domain.ts"));
    const datei = new RegExp(kern.musterAus(wurzeln, ["main"], true, [".java"]));
    assert.ok(datei.test("src/main/java/main.java"));
    assert.ok(!datei.test("src/main/java/main.ts"));
    assert.ok(!datei.test("src/main/java/main/X.java"));
    assert.ok(!datei.test("src/main/java/main.javax"));
  });

  test("mehrteilige Endung .d.ts: beide Punkte escaped", () => {
    const r = new RegExp(kern.musterAus("a/", ["main"], true, [".d.ts"]));
    assert.ok(r.test("a/main.d.ts"));
    assert.ok(!r.test("a/main.dXts"));
    assert.ok(!r.test("a/mainXd.ts"));
  });
});

describe("Modell mit mehreren Wurzeln und Endungen", () => {
  const WURZELN = ["backend/src/main/java/de/app/", "frontend/src/app/"];
  const java = () => modellAus({ quellwurzeln: WURZELN, endungen: [".java", ".ts"] });

  test("gültig; quellwurzel mit endungen ebenfalls", () => {
    assert.doesNotThrow(() => kern.pruefeModell(java()));
    assert.doesNotThrow(() => kern.pruefeModell(modellAus({ quellwurzel: "src/main/java/", endungen: [".java"] })));
  });

  test("layerOfAus klassifiziert Dateien beider Wurzeln; ausserhalb gilt die Auffang-Schicht", () => {
    const layer = kern.layerOfAus(java());
    assert.equal(layer("backend/src/main/java/de/app/web/A.java"), "web");
    assert.equal(layer("frontend/src/app/api/b.ts"), "web");
    assert.equal(layer("frontend/src/app/main.ts"), "einstieg");
    assert.equal(layer("backend/src/main/java/de/app/util/U.java"), "kern");
    assert.equal(layer("irgendwo/anders/X.java"), "kern");
  });

  test("verbotsRegeln: Auffang-Bedingung über alle Wurzeln", () => {
    const regeln = kern.verbotsRegeln(java()) as { from: { path: string }; to: { path: string } }[];
    assert.ok(regeln.some((r) => r.from.path === `^(${WURZELN.join("|")})` || r.to.path === `^(${WURZELN.join("|")})`));
    assert.ok(regeln.every((r) => r.from.path.startsWith("^") && r.to.path.startsWith("^")));
  });

  test("coverageGlobsAus: Mengen für Wurzeln und Endungen", () => {
    const g = kern.coverageGlobsAus(modellAus({ quellwurzeln: ["a/", "b/"], endungen: [".java"] }));
    assert.equal(g.web, "{a/,b/}{web,api}{.java,/**}");
    assert.equal(g.einstieg, "{a/,b/}{main}.java");
    assert.equal(g.kern, "{a/,b/}{!(web|api|main)/**,!(web.java|api.java|main.java)}");
    const g2 = kern.coverageGlobsAus(modellAus({ quellwurzel: "a/", endungen: [".java", ".kt"] }));
    assert.equal(g2.web, "a/{web,api}{.java,.kt,/**}");
    assert.equal(g2.einstieg, "a/{main}{.java,.kt}");
    assert.equal(g2.kern, "a/{!(web|api|main)/**,!(web.java|web.kt|api.java|api.kt|main.java|main.kt)}");
  });
});

describe("pruefeModell: Negativfälle (AK4)", () => {
  const rot = (m: unknown, muster: RegExp) => assert.throws(() => kern.pruefeModell(m), muster);
  const basis = () => modellAus({ quellwurzel: "src/" });

  test("quellwurzel und quellwurzeln zugleich", () => {
    rot({ ...modellAus({ quellwurzeln: ["src/"] }), quellwurzel: "src/" }, /zugleich/);
  });

  test("leere Endungsliste, Endung ohne Punkt", () => {
    rot({ ...basis(), endungen: [] }, /endungen/);
    rot({ ...basis(), endungen: ["java"] }, /endungen: "java"/);
  });

  test("mehrteilige Endung .d.ts gültig, Endung mit Präfix davor rot, kein Modell rot", () => {
    assert.doesNotThrow(() => kern.pruefeModell({ ...basis(), endungen: [".d.ts"] }));
    rot({ ...basis(), endungen: ["x.java"] }, /endungen: "x.java"/);
    rot(undefined, /SCHICHT_MODELL ungültig/);
  });

  test("weitere Endungs-Mängel", () => {
    rot({ ...basis(), endungen: ".java" }, /endungen/);
    rot({ ...basis(), endungen: [".java", ".java"] }, /doppelter/);
    rot({ ...basis(), endungen: [".j(a)"] }, /ungültig/);
    rot({ ...basis(), endungen: [7] }, /ungültig/);
  });

  test("Mängel der Wurzelliste", () => {
    rot(modellAus({ quellwurzeln: [] }), /nicht-leere Liste/);
    rot(modellAus({ quellwurzeln: "src/" as unknown as string[] }), /nicht-leere Liste/);
    rot(modellAus({ quellwurzeln: ["src"] }), /"src" ungültig/);
    rot(modellAus({ quellwurzeln: [7 as unknown as string] }), /7 ungültig/);
    rot(modellAus({ quellwurzeln: ["src/", "src/"] }), /doppelter/);
    rot(modellAus({ quellwurzeln: ["src/", "src/main/"] }), /liegt unter/);
  });

  test("einzelne Quellwurzel: alte Meldung", () => {
    rot({ ...basis(), quellwurzel: "src" }, /quellwurzel "src" ungültig/);
    rot({ ...basis(), quellwurzel: undefined }, /quellwurzel undefined ungültig/);
  });

  test("mit quellwurzeln muss jedes Muster mit den Wurzeln beginnen", () => {
    const m = modellAus({ quellwurzeln: ["a/", "b/"] });
    m.schichten[1] = { ...m.schichten[1], muster: kern.musterAus("a/", ["web", "api"], false) };
    rot(m, /muster beginnt nicht/);
    const n = modellAus({ quellwurzeln: ["a/", "b/"] });
    n.schichten[1] = { ...n.schichten[1], muster: 5 as unknown as string };
    rot(n, /muster beginnt nicht/);
  });
});

describe("pruefeModell: Endungen, Präfix, .d.ts und Wurzel-Namen (factory#193)", () => {
  const rot = (m: unknown, muster: RegExp) => assert.throws(() => kern.pruefeModell(m), muster);
  const java = () => modellAus({ quellwurzel: "src/", endungen: [".java"] });
  const setze = (m: Modell, i: number, wurzeln: string[], nurDatei: boolean, endungen?: string[]) => {
    m.schichten[i] = { ...m.schichten[i], wurzeln, muster: kern.musterAus("src/", wurzeln, nurDatei, endungen) };
  };

  test("Muster ohne die Endungen des Modells ist ein Mangel (Datei- und Ordner-Schicht)", () => {
    assert.doesNotThrow(() => kern.pruefeModell(java()));
    const datei = java();
    setze(datei, 0, ["main"], true);
    rot(datei, /muster endet nicht auf die endungen/);
    const ordner = java();
    setze(ordner, 1, ["web", "api"], false);
    rot(ordner, /muster endet nicht auf die endungen/);
  });

  test("ohne endungen im Modell gilt die Prüfung nicht", () => {
    assert.doesNotThrow(() => kern.pruefeModell(modellAus({ quellwurzel: "src/" })));
  });

  test("auch die einzelne quellwurzel bindet jedes Muster an ihren Präfix", () => {
    const m = modellAus({ quellwurzel: "src/" });
    m.schichten[1] = { ...m.schichten[1], muster: kern.musterAus("andere/", ["web", "api"], false) };
    rot(m, /muster beginnt nicht mit den quellwurzeln/);
  });

  test(".d.ts-Ausschluss der Regeln nur bei Modellen mit .ts", () => {
    const hat = (m: Modell) => JSON.stringify(kern.verbotsRegeln(m)).includes("d\\\\.ts");
    assert.ok(hat(modellAus({ quellwurzel: "src/" })));
    assert.ok(!hat(java()));
    assert.ok(hat(modellAus({ quellwurzel: "src/", endungen: [".java", ".ts"] })));
  });

  test("Wurzel-Namen: Großbuchstaben und Unterstrich erlaubt, Eindeutigkeit ohne Groß-/Kleinschreibung", () => {
    const gross = java();
    setze(gross, 0, ["Main"], true, [".java"]);
    assert.doesNotThrow(() => kern.pruefeModell(gross));
    const unterstrich = java();
    setze(unterstrich, 0, ["a_b"], true, [".java"]);
    assert.doesNotThrow(() => kern.pruefeModell(unterstrich));
    const dublette = java();
    setze(dublette, 0, ["web"], true, [".java"]);
    setze(dublette, 1, ["Web", "api"], false, [".java"]);
    rot(dublette, /steht in zwei Schichten/);
    const schlecht = java();
    setze(schlecht, 0, ["_x"], true, [".java"]);
    rot(schlecht, /ungültige Wurzel/);
  });
});
