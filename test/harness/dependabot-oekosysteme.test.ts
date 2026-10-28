/* Ökosystem-Wächter für Dependabot (#92): jedes Paket-Ökosystem, das im Repo vorkommt, braucht einen Eintrag in `.github/dependabot.yml`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Heute hat das Repo nur npm und GitHub-Actions; kommt ein Dockerfile, ein Python-Manifest o.ä. dazu, würde Dependabot es still nicht
 * betreuen. Dieser Wächter macht das rot, statt dass es unbemerkt bleibt. Geschlossene Musterliste (`OEKOSYSTEME`):
 *   package.json -> npm · .github/workflows/*.y(a)ml -> github-actions · Dockerfile*, compose*.y(a)ml -> docker ·
 *   requirements*.txt, pyproject.toml -> pip · go.mod -> gomod · Cargo.toml -> cargo.
 * Umfang: die Repo-Wurzel plus jedes `directory`/`directories` aus `dependabot.yml`, jeweils NICHT rekursiv; für github-actions
 * zusätzlich `.github/workflows`. Ehrliche Grenzen: (1) Ökosysteme außerhalb der Liste (Maven, Gradle, Composer, Terraform, ...) und
 * Manifeste in nicht gelisteten Unterordnern sieht er nicht; (2) `docker`-Dateien mit anderem Namen (`*.dockerfile`) und `image:`
 * in Workflows bleiben ungeprüft (nur Dockerfile-Präfix und compose-Präfix); (3) ein Eintrag ohne passendes `directory` zählt als Abdeckung, geprüft wird
 * nur, dass das Ökosystem überhaupt unter `updates` steht; (4) Glob-Verzeichnisse (`/apps/*`) werden nicht aufgelöst.
 *
 * Ausführen mit:  npm test
 */
import { describe, expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Geschlossene Musterliste: Dateiname im Verzeichnis -> Dependabot-Ökosystem. */
const OEKOSYSTEME: readonly { oeko: string; muster: RegExp }[] = [
  { oeko: "npm", muster: /^package\.json$/ },
  { oeko: "docker", muster: /^(Dockerfile.*|compose.*\.ya?ml)$/ },
  { oeko: "pip", muster: /^(requirements.*\.txt|pyproject\.toml)$/ },
  { oeko: "gomod", muster: /^go\.mod$/ },
  { oeko: "cargo", muster: /^Cargo\.toml$/ },
];
const WORKFLOW_MUSTER = /\.ya?ml$/;

type Obj = Record<string, unknown>;
const istObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** Alle `directory`/`directories`-Werte der Einträge unter `updates` (ohne Glob-Verzeichnisse). */
function verzeichnisse(updates: Obj[]): string[] {
  const out = new Set<string>(["/"]);
  for (const u of updates) {
    const liste = [u.directory, ...(Array.isArray(u.directories) ? u.directories : [])];
    for (const d of liste) if (typeof d === "string" && !d.includes("*")) out.add(d);
  }
  return [...out];
}

/** Ökosysteme, die laut `dependabot.yml` fehlen (leer = ok). `liste(verz)` nennt die Dateinamen eines Verzeichnisses (relativ zur Wurzel, `/` = Wurzel). */
function fehlendeOekosysteme(configYaml: string, liste: (verz: string) => string[]): string[] {
  const cfg: unknown = parse(configYaml);
  const updates = istObj(cfg) && Array.isArray(cfg.updates) ? cfg.updates.filter(istObj) : [];
  const eingetragen = new Set(updates.map((u) => u["package-ecosystem"]).filter((e): e is string => typeof e === "string"));
  const vorhanden = new Set<string>();
  for (const verz of verzeichnisse(updates)) {
    for (const name of liste(verz)) for (const { oeko, muster } of OEKOSYSTEME) if (muster.test(name)) vorhanden.add(oeko);
  }
  if (liste("/.github/workflows").some((n) => WORKFLOW_MUSTER.test(n))) vorhanden.add("github-actions");
  return [...vorhanden].filter((o) => !eingetragen.has(o)).sort().map((o) => `Ökosystem ${o} ohne Eintrag unter updates in dependabot.yml`);
}

const echteListe = (verz: string): string[] => {
  try {
    return readdirSync(join(ROOT, verz.replace(/^\/+/, "")), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
};
const dateien = (m: Record<string, string[]>) => (verz: string) => m[verz] ?? [];
const cfg = (...oekos: string[]) => `version: 2\nupdates:\n${oekos.map((o) => `  - package-ecosystem: "${o}"\n    directory: "/"`).join("\n")}\n`;

describe("Dependabot deckt jedes vorhandene Ökosystem ab (#92)", () => {
  test("echtes Repo: heute grün (npm und github-actions eingetragen)", () => {
    expect(fehlendeOekosysteme(readFileSync(join(ROOT, ".github", "dependabot.yml"), "utf8"), echteListe)).toEqual([]);
  });
  test("npm und github-actions mit Eintrag: grün", () => {
    const l = dateien({ "/": ["package.json"], "/.github/workflows": ["ci.yml"] });
    expect(fehlendeOekosysteme(cfg("npm", "github-actions"), l)).toEqual([]);
  });
  test("Negativ: Dockerfile ohne docker-Eintrag", () => {
    const l = dateien({ "/": ["package.json", "Dockerfile"], "/.github/workflows": ["ci.yml"] });
    expect(fehlendeOekosysteme(cfg("npm", "github-actions"), l)).toEqual(["Ökosystem docker ohne Eintrag unter updates in dependabot.yml"]);
    expect(fehlendeOekosysteme(cfg("npm", "github-actions", "docker"), l)).toEqual([]);
  });
  test.each([
    ["Dockerfile.dev", "docker"],
    ["compose.yaml", "docker"],
    ["compose.prod.yml", "docker"],
    ["requirements-dev.txt", "pip"],
    ["pyproject.toml", "pip"],
    ["go.mod", "gomod"],
    ["Cargo.toml", "cargo"],
  ])("Negativ: %s braucht %s", (datei, oeko) => {
    const l = dateien({ "/": ["package.json", datei] });
    expect(fehlendeOekosysteme(cfg("npm"), l)).toEqual([`Ökosystem ${oeko} ohne Eintrag unter updates in dependabot.yml`]);
  });
  test("Negativ: Workflow-Datei ohne github-actions-Eintrag (yml und yaml)", () => {
    for (const n of ["x.yml", "x.yaml"]) {
      expect(fehlendeOekosysteme(cfg("npm"), dateien({ "/.github/workflows": [n] }))).toEqual(["Ökosystem github-actions ohne Eintrag unter updates in dependabot.yml"]);
    }
  });
  test("Umfang: directory aus dependabot.yml zählt, nicht gelistete Unterordner nicht", () => {
    const l = dateien({ "/": ["package.json"], "/app": ["go.mod"], "/tief": ["Cargo.toml"] });
    const mitApp = `version: 2\nupdates:\n  - package-ecosystem: "npm"\n    directory: "/"\n  - package-ecosystem: "npm"\n    directory: "/app"\n`;
    expect(fehlendeOekosysteme(mitApp, l)).toEqual(["Ökosystem gomod ohne Eintrag unter updates in dependabot.yml"]);
  });
  test("Umfang: directories (Liste) wird gelesen, Glob wird übersprungen", () => {
    const y = `version: 2\nupdates:\n  - package-ecosystem: "npm"\n    directories: ["/a", "/b/*"]\n`;
    const l = dateien({ "/a": ["Cargo.toml"], "/b/*": ["go.mod"] });
    expect(fehlendeOekosysteme(y, l)).toEqual(["Ökosystem cargo ohne Eintrag unter updates in dependabot.yml"]);
  });
  test("Grenze: unbekannte Namen und ähnliche Namen lösen nichts aus", () => {
    const l = dateien({ "/": ["README.md", "package.json.bak", "mein-Dockerfile", "xcompose.yml"] });
    expect(fehlendeOekosysteme(cfg("npm"), l)).toEqual([]);
  });
  test("leere oder fehlende updates: jedes vorhandene Ökosystem fehlt", () => {
    expect(fehlendeOekosysteme("version: 2\n", dateien({ "/": ["package.json"] }))).toHaveLength(1);
  });
});
