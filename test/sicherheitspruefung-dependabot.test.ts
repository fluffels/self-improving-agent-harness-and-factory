/** Dependabot-Abdeckung der Sicherheitsprüfung (factory#388): Text-Leser, Manifest-Suche, Abdeckungsregel. Reine Funktionen, keine Dateien. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/sicherheitspruefung-dependabot.mjs";

type Erg = { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; soll?: string; fix?: string };
const D = raw as unknown as {
  liesDependabot: (t: string) => { eintraege?: { oekosystem: string; verzeichnisse: string[] }[]; fehler?: string };
  findeManifeste: (d: string[], p?: Record<string, unknown>) => { oekosystem: string; verzeichnis: string; datei: string }[];
  passtVerzeichnis: (m: string, v: string) => boolean;
  pruefeDependabot: (e: Record<string, unknown>) => Erg[];
};

const BELEG = `version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"   # Wurzel
    schedule:
      interval: "weekly"
  - package-ecosystem: github-actions
    directory: "/"
    schedule:
      interval: weekly
`;
const DATEIEN = ["package.json", "frontend/package.json", "backend/pom.xml", ".github/workflows/ci.yml", "node_modules/x/package.json"];

describe("liesDependabot", () => {
  test.each([
    ["directory mit Anführungszeichen und Kommentar", BELEG, [["npm", ["/"]], ["github-actions", ["/"]]]],
    ["directories als Block-Liste", "updates:\n  - package-ecosystem: npm\n    directories:\n      - '/a'\n      - \"/b\"\n    schedule:\n      interval: daily\n", [["npm", ["/a", "/b"]]]],
    ["directories als Flow-Liste", "updates:\n- package-ecosystem: maven\n  directories: [\"/x\", '/y/*']\n", [["maven", ["/x", "/y/*"]]]],
    ["Block-Liste auf Höhe des Schlüssels", "updates:\n  - package-ecosystem: npm\n    directories:\n    - /a\n    schedule:\n      interval: daily\n", [["npm", ["/a"]]]],
  ])("%s", (_n, text, erwartet) => {
    const g = D.liesDependabot(text);
    expect(g.eintraege?.map((e) => [e.oekosystem, e.verzeichnisse])).toEqual(erwartet);
  });

  test.each([
    ["ohne updates", "version: 2\n"],
    ["leeres updates", "updates:\nversion: 2\n"],
    ["Eintrag ohne Ökosystem", "updates:\n  - directory: /\n"],
    ["Eintrag ohne Verzeichnis", "updates:\n  - package-ecosystem: npm\n"],
  ])("fail-closed: %s", (_n, text) => {
    expect(D.liesDependabot(text).fehler).toBeTruthy();
  });

  test("Kommentar nur nach Leerraum und außerhalb von Anführungszeichen", () => {
    const g = D.liesDependabot("updates:\n  - package-ecosystem: npm\n    directories: ['/a#b', /c#d, \"/e # f\"]   # Ende\n");
    expect(g.eintraege?.[0].verzeichnisse).toEqual(["/a#b", "/c#d", "/e # f"]);
  });

  test("einfache Anführungszeichen schützen ein #; eine Block-Liste endet vor dem nächsten Eintrag", () => {
    const g = D.liesDependabot("updates:\n  - package-ecosystem: npm\n    directories:\n    - '/a # b'\n  - package-ecosystem: maven\n    directory: /m\n");
    expect(g.eintraege?.map((e) => [e.oekosystem, e.verzeichnisse])).toEqual([["npm", ["/a # b"]], ["maven", ["/m"]]]);
  });

  test("ein leeres directory zählt nicht als Verzeichnis", () => {
    expect(D.liesDependabot("updates:\n  - package-ecosystem: npm\n    directory:\n").fehler).toBeTruthy();
  });

  test("ein weiterer Schlüssel auf oberster Ebene beendet updates", () => {
    const g = D.liesDependabot("updates:\n  - package-ecosystem: npm\n    directory: /\nregistries:\n  - name: x\n    directory: /nein\n");
    expect(g.eintraege).toEqual([{ oekosystem: "npm", verzeichnisse: ["/"] }]);
  });

  test("ein Schlüssel in einer Untersektion zählt nicht als Verzeichnis", () => {
    const t = "updates:\n  - package-ecosystem: npm\n    schedule:\n      directory: /x\n";
    expect(D.liesDependabot(t).fehler).toBeTruthy();
  });
});

describe("passtVerzeichnis", () => {
  test.each([["/", "/", true], ["/a", "/a/", true], ["/a/*", "/a/b", true], ["/a/*", "/a/b/c", false], ["/a/**", "/a/b/c", true], ["/a", "/a/b", false], ["/a.b", "/axb", false]])("%s gegen %s", (m, v, e) => {
    expect(D.passtVerzeichnis(m, v)).toBe(e);
  });
});

describe("findeManifeste", () => {
  test("erkennt Ökosysteme, ignoriert node_modules, Workflows zählen unter /", () => {
    const m = D.findeManifeste(DATEIEN).map((x) => `${x.oekosystem} ${x.verzeichnis}`);
    expect(m.sort()).toEqual(["github-actions /", "maven /backend", "npm /", "npm /frontend"]);
  });
  test("Dockerfile.*, projekt.manifeste und Ausnahmen", () => {
    const m = D.findeManifeste(["a/Dockerfile.dev", "x/mix.exs", "fixtures/t/package.json"], { manifeste: [{ oekosystem: "mix", datei: "mix.exs" }], ausnahmen: [{ pfad: "fixtures", grund: "Fixture" }] });
    expect(m.map((x) => `${x.oekosystem} ${x.verzeichnis}`).sort()).toEqual(["docker /a", "mix /x"]);
  });
});

describe("pruefeDependabot", () => {
  const lauf = (extra: Record<string, unknown> = {}) => D.pruefeDependabot({ dateien: DATEIEN, dependabotText: BELEG, ...extra });

  test("Beleg-Fall: nur npm / und github-actions → genau zwei Lücken mit Ist, Soll und Fix", () => {
    const e = lauf();
    expect(e.map((x) => x.punkt).sort()).toEqual(["Dependabot-Abdeckung maven /backend", "Dependabot-Abdeckung npm /frontend"]);
    for (const x of e) {
      expect(x.ok).toBe(false);
      expect(x.befund).toMatch(/kein Eintrag/);
      expect(x.soll).toBeTruthy();
      expect(x.fix).toMatch(/dependabot\.yml/);
    }
    expect(e.find((x) => x.punkt.endsWith("/frontend"))?.fix).toContain('directory "/frontend"');
  });

  test("Negativfall: alles abgedeckt → ein gutes Ergebnis, keine Lücke", () => {
    const text = BELEG + '  - package-ecosystem: npm\n    directory: "/frontend"\n  - package-ecosystem: maven\n    directories: ["/*"]\n';
    expect(lauf({ dependabotText: text })).toEqual([{ punkt: "Dependabot-Abdeckung", ok: true }]);
  });

  test("npm-Workspaces decken ab (Array und .packages), Muster relativ zum Vorfahren", () => {
    const lese = (w: unknown) => (v: string) => (v === "/" ? { workspaces: w } : null);
    expect(lauf({ dateien: ["package.json", "frontend/package.json"], lesePackageJson: lese(["frontend"]) })[0].ok).toBe(true);
    expect(lauf({ dateien: ["package.json", "packages/a/package.json"], lesePackageJson: lese({ packages: ["packages/*"] }) })[0].ok).toBe(true);
    expect(lauf({ dateien: ["package.json", "frontend/package.json"], lesePackageJson: lese(["!frontend"]) })[0].ok).toBe(false);
  });

  test("Workspaces eines verschachtelten Wurzelverzeichnisses zählen relativ dazu", () => {
    const text = 'updates:\n  - package-ecosystem: npm\n    directory: "/web"\n';
    const lese = (v: string) => (v === "/web" ? { workspaces: ["apps/*"] } : null);
    expect(lauf({ dateien: ["web/package.json", "web/apps/a/package.json"], dependabotText: text, lesePackageJson: lese })[0].ok).toBe(true);
    expect(lauf({ dateien: ["web/package.json", "apps/a/package.json"], dependabotText: text, lesePackageJson: lese })[0].ok).toBe(false);
  });

  test("Ein Vorfahr deckt nur Maven, Gradle und npm-Workspaces ab, nicht andere Ökosysteme", () => {
    const text = 'updates:\n  - package-ecosystem: docker\n    directory: "/a"\n';
    expect(lauf({ dateien: ["a/Dockerfile", "a/b/Dockerfile"], dependabotText: text }).map((x) => x.punkt)).toEqual(["Dependabot-Abdeckung docker /a/b"]);
  });

  test("Maven-Aggregator deckt Untermodule ab, npm-Vorfahr deckt kein Maven", () => {
    const text = 'updates:\n  - package-ecosystem: maven\n    directory: "/backend"\n';
    expect(lauf({ dateien: ["backend/pom.xml", "backend/core/pom.xml"], dependabotText: text })[0].ok).toBe(true);
    expect(lauf({ dateien: ["backend/pom.xml", "backend/core/pom.xml"], dependabotText: 'updates:\n  - package-ecosystem: npm\n    directory: "/backend"\n' }).every((x) => !x.ok)).toBe(true);
  });

  test("Ausnahme mit Verzeichnis nimmt Manifeste samt Unterverzeichnissen aus", () => {
    const e = lauf({ projekt: { ausnahmen: [{ pfad: "frontend", grund: "g" }, { pfad: "backend", grund: "g" }] } });
    expect(e).toEqual([{ punkt: "Dependabot-Abdeckung", ok: true }]);
  });

  test("dependabot.yml fehlt bei Manifesten → Lücke; ohne Manifeste gut", () => {
    const e = lauf({ dependabotText: null });
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ punkt: "Dependabot-Abdeckung", ok: false });
    expect(e[0].nichtPruefbar).toBeUndefined();
    expect(e[0].befund).toMatch(/fehlt/);
    expect(lauf({ dependabotText: null, dateien: ["README.md"] })[0].ok).toBe(true);
  });

  test("unlesbare Struktur → nicht prüfbar", () => {
    expect(lauf({ dependabotText: "version: 2\n" })[0]).toMatchObject({ ok: false, nichtPruefbar: true });
  });

  test("projekt.manifeste ergänzt ein Ökosystem", () => {
    const e = D.pruefeDependabot({ dateien: ["x/mix.exs"], dependabotText: BELEG, projekt: { manifeste: [{ oekosystem: "mix", datei: "mix.exs" }] } });
    expect(e[0].punkt).toBe("Dependabot-Abdeckung mix /x");
  });
});
