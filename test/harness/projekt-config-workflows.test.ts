/* Wächter der Sparse-Checkouts in den Workflows (#1611, #1693): ein Workflow mit `sparse-checkout:` muss für jedes `node scripts/<x>.mjs`
 * die ganze Import-Hülle von <x> in der Sparse-Liste führen (`sparseProbleme`, pur, mit Fixtures getestet), sonst scheitert der Job mit
 * ERR_MODULE_NOT_FOUND; steht `scripts/projekt-config-lib.mjs` in der Hülle, gehört auch `.factory/projekt.json` in die Liste.
 * Heute checkt kein Workflow sparse aus; der Wächter greift, sobald einer es tut. ci, dependabot-inbox und forum-inbox rufen
 * `scripts/board-place.mjs` (große Import-Hülle) auf und checken darum das volle Repo aus: auch das bewacht dieser Test.
 *
 * Bewusste Grenzen: `importHuelle` (test/support/import-huelle.ts) erkennt nur `from "<pfad>"` in doppelten Anführungszeichen (kein `import "./x.mjs"`, kein
 * dynamisches `import()`, keine einfachen Anführungszeichen); `sparseListe` liest nur den ersten Sparse-Block je Workflow;
 * erkannt werden nur Aufrufe der Form `node scripts/<name>.mjs`.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { besitzAnker } from "../support/besitz-anker";
import { importHuelle } from "../support/import-huelle";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const EINSTIEG = "scripts/projekt-config.mjs";
const LIB = "scripts/projekt-config-lib.mjs";
const lies = (pfad: string): string => readFileSync(WURZEL + pfad, "utf8");
/** Dateinamen der verteilten Besitz-Workflows (Leerlauf-Schutz-Anker; wirft, wenn das Manifest keinen nennt). */
const besitzWorkflows = (): string[] => besitzAnker((p) => /^\.github\/workflows\/[^/]+\.yml$/.test(p)).map((p) => p.slice(".github/workflows/".length));

/** Dateien der Sparse-Checkout-Liste (`sparse-checkout: |` mit eingerückten Pfadzeilen). */
export function sparseListe(yml: string): string[] {
  const m = /^([ \t]*)sparse-checkout: \|\n((?:\1[ \t]+\S[^\n]*\n)+)/m.exec(yml);
  return m ? (m[2] ?? "").split("\n").map((z) => z.trim()).filter(Boolean) : [];
}

/** Fehlende Sparse-Einträge je `node scripts/<x>.mjs`-Aufruf eines Workflows mit `sparse-checkout:`; ohne Sparse-Block leer. Pur bis auf `leser`. */
export function sparseProbleme(yml: string, leser: (pfad: string) => string): string[] {
  if (!yml.includes("sparse-checkout:")) return [];
  const liste = sparseListe(yml);
  const probleme: string[] = [];
  for (const m of yml.matchAll(/\bnode scripts\/([\w.-]+\.mjs)/g)) {
    const skript = `scripts/${m[1] ?? ""}`;
    const huelle = importHuelle(skript, leser);
    const noetig = huelle.includes(LIB) ? [".factory/projekt.json", ...huelle] : huelle;
    for (const datei of noetig) if (!liste.includes(datei)) probleme.push(`${skript}: ${datei} fehlt in sparse-checkout`);
  }
  return [...new Set(probleme)];
}

describe("sparseListe", () => {
  test("sparseListe liest die Zeilen, ohne Liste leer", () => {
    assert.deepEqual(sparseListe("with:\n  sparse-checkout: |\n    a\n    b/c\n  x: 1\n"), ["a", "b/c"]);
    assert.deepEqual(sparseListe("with:\n  x: 1\n"), []);
  });
});

describe("sparseProbleme", () => {
  const quellen: Record<string, string> = {
    "scripts/a.mjs": 'import { l } from "./projekt-config-lib.mjs";',
    [LIB]: "",
    "scripts/b.mjs": 'import { x } from "node:fs";',
  };
  const leser = (p: string): string => quellen[p] ?? "";
  const yml = (liste: string[], aufruf: string): string =>
    `steps:\n  - uses: x\n    with:\n      sparse-checkout: |\n${liste.map((z) => `        ${z}\n`).join("")}  - run: ${aufruf}\n`;
  test("vollständige Liste (Skript, Lib, Config) ohne Befund", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", LIB, ".factory/projekt.json"], "node scripts/a.mjs"), leser), []);
  });
  test("fehlende Lib wird gemeldet", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", ".factory/projekt.json"], "node scripts/a.mjs"), leser), [`scripts/a.mjs: ${LIB} fehlt in sparse-checkout`]);
  });
  test("fehlende Config wird gemeldet, wenn die Lib in der Hülle steht", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", LIB], "node scripts/a.mjs"), leser), ["scripts/a.mjs: .factory/projekt.json fehlt in sparse-checkout"]);
  });
  test("ohne Lib in der Hülle ist die Config nicht nötig", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/b.mjs"], "node scripts/b.mjs"), leser), []);
  });
  test("das aufgerufene Skript selbst fehlt in der Liste", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/b.mjs"], "node scripts/a.mjs"), leser), [
      "scripts/a.mjs: .factory/projekt.json fehlt in sparse-checkout",
      "scripts/a.mjs: scripts/a.mjs fehlt in sparse-checkout",
      `scripts/a.mjs: ${LIB} fehlt in sparse-checkout`,
    ]);
  });
  test("derselbe Befund bei zwei Aufrufen (und gemeinsamer Lib zweier Skripte) wird nur einmal gemeldet", () => {
    assert.deepEqual(sparseProbleme(yml(["scripts/a.mjs", ".factory/projekt.json"], "node scripts/a.mjs\n  - run: node scripts/a.mjs"), leser), [`scripts/a.mjs: ${LIB} fehlt in sparse-checkout`]);
  });
  test("Workflow ohne Sparse-Checkout wird ignoriert", () => {
    assert.deepEqual(sparseProbleme("steps:\n  - run: node scripts/a.mjs\n", leser), []);
  });
});

describe("Sparse-Checkout der Workflows", () => {
  test("die Hülle des Einstiegs enthält die Lib und nur Dateien des Kerns", () => {
    const huelle = importHuelle(EINSTIEG, lies);
    assert.ok(huelle.includes(LIB));
    // Genau diese Dateien: die Lib zieht die Spezifikations-Lib (`spracheMaengel`), die nur die Builtin-Fence-Helfer `markdown.mjs` (SSOT der Code-Fences) importiert, und die importfreien Skill-Pfade und die importfreie Sperrlisten-Lib (`internalrefsMaengel`) nach; jede weitere Datei ist ein bewusster Commit.
    assert.deepEqual(huelle, ["scripts/arbeitsplatz-lib.mjs", "scripts/design-lib.mjs", "scripts/docs-gen/markdown.mjs", "scripts/flag-lib.mjs", "scripts/gate-befehl-lib.mjs", "scripts/internalrefs-lib.mjs", "scripts/modul-wahl-lib.mjs", "scripts/pfad-glob.mjs", LIB, EINSTIEG, "scripts/relativ-pfad.mjs", "scripts/repo-form.mjs", "scripts/skill-pfade.mjs", "scripts/spezifikation-lib.mjs"],`Hülle wächst: ${huelle.join(", ")}`);
  });
  test("Workflows mit board-place.mjs checken das volle Repo aus und richten Node ein (#1628)", () => {
    const vorhanden = readdirSync(WURZEL + ".github/workflows").filter((n) => n.endsWith(".yml"));
    const nutzer = vorhanden.filter((n) => lies(`.github/workflows/${n}`).includes("scripts/board-place.mjs"));
    // Leerlauf-Schutz (#1933): jeder verteilte Besitz-Workflow liegt im Scan, und jeder davon, der board-place.mjs nennt, ist unter den Nutzern (Menge nicht leer).
    const besitz = besitzWorkflows();
    for (const n of besitz) assert.ok(vorhanden.includes(n), `Leerlauf-Schutz: ${n} liegt im Scan`);
    const besitzNutzer = besitz.filter((n) => lies(`.github/workflows/${n}`).includes("scripts/board-place.mjs"));
    assert.ok(besitzNutzer.length > 0, "Leerlauf-Schutz: kein Besitz-Workflow nennt board-place.mjs");
    for (const n of besitzNutzer) assert.ok(nutzer.includes(n), `${n} fehlt unter den board-place-Nutzern`);
    for (const n of nutzer) {
      const yml = lies(`.github/workflows/${n}`);
      assert.ok(!yml.includes("sparse-checkout:"), `${n}: board-place.mjs braucht seine ganze Import-Hülle, kein Sparse-Checkout`);
      assert.match(yml, /actions[/]checkout@[0-9a-f]{40} # v7/, `${n}: Checkout fehlt`);
      assert.match(yml, /actions[/]setup-node@[0-9a-f]{40} # v7/,`${n}: setup-node fehlt`);
    }
  });
  test("alle echten Workflows: jede Sparse-Liste trägt die Import-Hülle ihrer Skripte", () => {
    const namen = readdirSync(WURZEL + ".github/workflows").filter((n) => n.endsWith(".yml"));
    // Leerlauf-Schutz (#1933): jeder verteilte Besitz-Workflow liegt im Scan, nicht nur der eine, der board-place.mjs nennt.
    for (const n of besitzWorkflows()) assert.ok(namen.includes(n), `Leerlauf-Schutz: ${n} liegt im Scan`);
    const probleme = namen.flatMap((n) => sparseProbleme(lies(`.github/workflows/${n}`), lies).map((p) => `${n}: ${p}`));
    assert.deepEqual(probleme, []);
  });
});
