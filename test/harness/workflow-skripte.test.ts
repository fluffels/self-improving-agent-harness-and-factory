/* Workflow-Skript-Wächter (factory#394, Zeilen L8-L10): was ein Workflow-Job per `node scripts/<x>.mjs` startet, hält zwei Verträge.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * L8: Ein Job ohne Install-Schritt (`npm ci`, `npm install`, `node scripts/gate-befehl.mjs install`) hat kein `node_modules`; seine Einstiegsskripte
 *     dürfen transitiv nur `node:`-Builtins und relative Importe laden (Leser: `importHuelle`, eine Auslegung mit den anderen Hüllen-Tests;
 *     ein Import im Kommentar zählt mit, dann den Kommentar umschreiben).
 * L9: Jedes Skript aus einem Job eines Required-Check-Workflows (Job-`name` = Kontext aus `requiredChecks` des Ruleset-Spiegels) steht in der
 *     Schutzliste `.github/protected-paths.json` (`trifftLeitplanke`): sonst könnte ein PR den Gate-Lauf per Skript-Änderung still ändern.
 * L10: Der Job `security-audit` in ci.yml ruft `node scripts/audit-verzeichnisse.mjs` auf (nicht nur ein nacktes `npm audit`).
 *
 * Geschlossene Mustern-Liste (`SKRIPT_MUSTER`): `node scripts/<x>.mjs` und `node ./scripts/<x>.mjs`, auch hinter Env-Zuweisung, nach `&&`, `;`, `|`, `$(`,
 * in mehrzeiligem `run: |`. Grenzen (nicht erkannt): Ketten über `npm run <x>`, Composite Actions und `uses:`-Schritte, dynamische Pfade
 * (`node "$SKRIPT"`), `working-directory`, andere Aufrufer als `node`. Bewusst offen: `scripts/audit-einordnung.mjs` läuft nur im Zeitplan-Workflow
 * `audit-einordnung.yml` (kein Required Check), steht aber vorsorglich in der Schutzliste.
 * Verfall: Prüftermin laut `.github/wiedervorlagen.json` (Eintrag `regeln-verfall-2027-03`, ADR 0027).
 */
import { describe, expect, test } from "vitest";
import { parse } from "yaml";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importHuelle } from "../support/import-huelle";
// @ts-expect-error – .mjs ohne Typen
import * as besitzExtraktion from "../../scripts/besitz-extraktion.mjs";
// @ts-expect-error – .mjs ohne Typen
import * as projektConfig from "../../scripts/projekt-config-lib.mjs";

const { schutzlistenMuster, trifftLeitplanke } = besitzExtraktion as unknown as {
  schutzlistenMuster: (text: string) => string[] | null;
  trifftLeitplanke: (pfad: string, muster: string[]) => boolean;
};

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOW_DIR = join(ROOT, ".github", "workflows");

export interface JobSkripte {
  job: string;
  name: string;
  install: boolean;
  skripte: string[];
}

const INSTALL = /(?:^|[\s;&|(])npm\s+(?:ci|install)\b|node\s+(?:\.\/)?scripts\/gate-befehl\.mjs\s+install\b/;
/** Das eine Muster: `node [./]scripts/<pfad>.mjs`, davor Zeilenanfang oder ein Trenner (auch Env-Zuweisung `A=b node …`). */
const SKRIPT_MUSTER = /(?:^|[\s;&|(`])node\s+(?:\.\/)?(scripts\/[\w./-]+\.mjs)\b/gm;

/** Pur: je Job die Job-Id, den `name`, ob ein Schritt installiert, und die per `node scripts/<x>.mjs` gestarteten Skripte (sortiert, eindeutig). */
export function jobSkripte(workflowText: string): JobSkripte[] {
  const doc = parse(workflowText, { schema: "failsafe" }) as { jobs?: Record<string, { name?: unknown; steps?: unknown }> } | null;
  const jobs = doc?.jobs;
  if (jobs === null || typeof jobs !== "object") return [];
  return Object.entries(jobs).map(([job, def]) => {
    const schritte = Array.isArray(def?.steps) ? (def.steps as { run?: unknown }[]) : [];
    const runs = schritte.map((s) => (typeof s?.run === "string" ? s.run : "")).filter((r) => r !== "");
    return {
      job,
      name: typeof def?.name === "string" ? def.name : job,
      install: runs.some((r) => INSTALL.test(r)),
      skripte: [...new Set(runs.flatMap((r) => [...r.matchAll(SKRIPT_MUSTER)].map((m) => m[1])))].sort(),
    };
  });
}

const lies = (pfad: string): string => readFileSync(join(ROOT, pfad), "utf8");

function alleWorkflows(): { datei: string; jobs: JobSkripte[] }[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((d) => /\.ya?ml$/.test(d))
    .map((datei) => ({ datei, jobs: jobSkripte(readFileSync(join(WORKFLOW_DIR, datei), "utf8")) }));
}

function requiredKontexte(): string[] {
  const spiegel = (projektConfig as unknown as { ladeProjektConfig: () => { rulesetSpiegel?: string } }).ladeProjektConfig().rulesetSpiegel;
  if (!spiegel) throw new Error("rulesetSpiegel fehlt in der Projekt-Config (.factory/projekt.json)");
  const roh = JSON.parse(lies(spiegel)) as { requiredChecks?: unknown };
  if (!Array.isArray(roh.requiredChecks) || roh.requiredChecks.length === 0) throw new Error("requiredChecks fehlt oder ist leer im Spiegel");
  return roh.requiredChecks as string[];
}

/** Verstöße von L8 für eine Job-Liste: Job ohne Install, dessen Skript-Hülle ein Nicht-Builtin lädt. */
export function huellenVerstoesse(jobs: JobSkripte[], leser: (pfad: string) => string): string[] {
  const aus: string[] = [];
  for (const j of jobs.filter((x) => !x.install)) {
    for (const skript of j.skripte) {
      try {
        importHuelle(skript, leser);
      } catch (e) {
        aus.push(`${j.job}: ${skript}: ${(e as Error).message}`);
      }
    }
  }
  return aus;
}

describe("jobSkripte (Parser)", () => {
  test("Job mit npm ci: install=true", () => {
    const [j] = jobSkripte("jobs:\n  a:\n    steps:\n      - run: npm ci\n      - run: node scripts/x.mjs\n");
    expect(j).toEqual({ job: "a", name: "a", install: true, skripte: ["scripts/x.mjs"] });
  });
  test("Job ohne Install mit zwei Einstiegen, ./ und Env-Zuweisung", () => {
    const [j] = jobSkripte("jobs:\n  b:\n    name: Bee\n    steps:\n      - run: FOO=1 node ./scripts/b.mjs --x\n      - run: |\n          if ! w=$(node scripts/a.mjs y); then exit 1; fi\n");
    expect(j).toEqual({ job: "b", name: "Bee", install: false, skripte: ["scripts/a.mjs", "scripts/b.mjs"] });
  });
  test("mehrzeiliges run: | mit Install über gate-befehl", () => {
    const [j] = jobSkripte("jobs:\n  c:\n    steps:\n      - run: |\n          node scripts/gate-befehl.mjs install\n          node scripts/c.mjs\n");
    expect(j.install).toBe(true);
    expect(j.skripte).toEqual(["scripts/c.mjs", "scripts/gate-befehl.mjs"]);
  });
  test("Job mit uses: ohne run: keine Skripte", () => {
    const [j] = jobSkripte("jobs:\n  d:\n    steps:\n      - uses: actions/checkout@v1\n");
    expect(j).toEqual({ job: "d", name: "d", install: false, skripte: [] });
  });
  test("Negativfall: kein Treffer bei npm run, anderem Aufrufer und Nicht-.mjs", () => {
    const [j] = jobSkripte("jobs:\n  e:\n    steps:\n      - run: npm run check\n      - run: bash scripts/e.sh\n      - run: node scripts/e.js\n");
    expect(j.skripte).toEqual([]);
  });
  test("Hülle: Fixture mit Paket-Import ist ein Verstoß, mit node: keiner", () => {
    const quellen: Record<string, string> = { "scripts/ok.mjs": 'import fs from "node:fs";', "scripts/schlecht.mjs": 'import { parse } from "yaml";' };
    const leser = (p: string) => quellen[p];
    const job = (skripte: string[], install = false): JobSkripte => ({ job: "j", name: "j", install, skripte });
    expect(huellenVerstoesse([job(["scripts/ok.mjs"])], leser)).toEqual([]);
    expect(huellenVerstoesse([job(["scripts/schlecht.mjs"])], leser)).toHaveLength(1);
    expect(huellenVerstoesse([job(["scripts/schlecht.mjs"], true)], leser)).toEqual([]);
  });
});

describe("Workflow-Skripte (Repo)", () => {
  test("Muster finden überhaupt Skripte (kein leerer Wächter)", () => {
    expect(alleWorkflows().flatMap((w) => w.jobs.flatMap((j) => j.skripte)).length).toBeGreaterThan(5);
  });

  test("L8: Jobs ohne Install laden transitiv nur node:-Builtins", () => {
    const verstoesse = alleWorkflows().flatMap((w) => huellenVerstoesse(w.jobs, lies).map((v) => `${w.datei}: ${v}`));
    expect(verstoesse).toEqual([]);
  });

  test("L9: Skripte aus Jobs der Required-Check-Workflows stehen in der Schutzliste", () => {
    const muster = schutzlistenMuster(lies(".github/protected-paths.json"));
    expect(muster).not.toBeNull();
    const kontexte = requiredKontexte();
    const required = alleWorkflows().filter((w) => w.jobs.some((j) => kontexte.includes(j.name)));
    expect(required.length).toBeGreaterThan(0);
    const frei = required.flatMap((w) => w.jobs.flatMap((j) => j.skripte.filter((s) => !trifftLeitplanke(s, muster as string[])).map((s) => `${w.datei} › ${j.job}: ${s}`)));
    expect(frei).toEqual([]);
  });

  test("L10: ci.yml › security-audit ruft scripts/audit-verzeichnisse.mjs auf", () => {
    const ci = jobSkripte(lies(".github/workflows/ci.yml")).find((j) => j.job === "security-audit");
    expect(ci?.skripte).toContain("scripts/audit-verzeichnisse.mjs");
  });
});
