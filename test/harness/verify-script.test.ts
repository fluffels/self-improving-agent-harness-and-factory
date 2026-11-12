/* #527: `npm run verify` ist die EINE SSOT-Kette über alle Gates.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Motivation (siehe Ticket #527): Vor diesem Ticket musste ein Agent typecheck +
 * lint + check:arch + check:size + check:docmap + test EINZELN laufen lassen und
 * die CI listete dieselben Schritte separat – zwei Drift-Risiken: (a) ein Agent
 * VERGISST lokal ein Gate (die CI fängt es erst auf dem PR),
 * (b) CI-Reihenfolge und lokale Reihenfolge laufen auseinander.
 *
 * Diese Fitness-Function sichert genau das ab:
 *  - `verify` existiert und ruft JEDES Einzel-Gate auf (kein vergessenes Gate –
 *    auch ein künftig neu hinzugefügtes `check:*` muss in die Kette),
 *  - `verify:full` erweitert `verify` (Coverage und Diff-Coverage dahinter),
 *  - die CI ruft die `verify`-Kette auf, statt die Gates einzeln zu duplizieren.
 *
 * Rein struktureller Wächter (wie readme/docmap/filesize) – bewusst kein
 * Verhaltens-Test. Ausführen mit:  npm test
 *
 * Projektneutral (#1932): Builds, Smoke, Bundle-Budget, der TS-7-Wächter und das Alarm-Label des Spiels
 * prüft der Projekt-Test `gates-projekt.test.ts`; die Gate-Namen dieser Klassen stehen hier nur als Ausschlussliste.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawNamen from "../../scripts/regex-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawGate from "../../scripts/gate-befehl-lib.mjs";
const STANDARD_BEFEHLE = (rawGate as unknown as { STANDARD_BEFEHLE: Record<string, string> }).STANDARD_BEFEHLE;

// Begründete Ausnahme wie in repo-texte.ts: das .mjs hat kein Declaration-File.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const escapeRegex: (t: string) => string = rawNamen.escapeRegex;

const readRepo = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");

const pkg = JSON.parse(readRepo("package.json")) as {
  scripts: Record<string, string>;
};
const scripts = pkg.scripts;

// Projekt-Gates außerhalb der Kette: die Projekt-Config nennt sie samt Grund (`gates.nichtInVerify`, #1925); ihre Regeln prüft ein Projekt-Test,
// hier fallen sie nur aus der Liste der Gates, die `verify` fahren muss.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const gatesAus: (config: unknown) => { nichtInVerify: { gate: string; grund: string }[] } = rawPc.gatesAus;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
const ladeProjektConfig: () => unknown = rawPc.ladeProjektConfig;
const PROJEKT_GATES = new Set(gatesAus(ladeProjektConfig()).nichtInVerify.map((e) => e.gate));

// Report-ABHÄNGIGE Gates werten ein Artefakt aus, das erst ein anderer Lauf erzeugt —
// sie können darum ebenfalls nicht in der schnellen `verify`-Kette laufen. #1021:
// check:diffcoverage schneidet coverage/lcov.info gegen den Diff, und dieses lcov
// entsteht erst durch `test:coverage` (bewusst nicht in `verify`, weil die
// v8-Instrumentierung die Suite spürbar verlangsamt, #495). Platz ist darum
// `verify:full`, direkt HINTER `test:coverage`.
const REPORT_DEPENDENT_GATES = new Map([["check:diffcoverage", "test:coverage"]]);

// Netz-/nicht-deterministische Gates, die bewusst NICHT in der hermetischen,
// offline-fähigen `verify`-Kette laufen dürfen: #610 check:doctickets gleicht die
// offen-markierten Roadmap-Tickets gegen den echten `gh issue`-Status ab — das
// braucht Netz + Token und ist nicht deterministisch. Es läuft als eigener,
// non-blocking CI-Job (alarmierend) + lokal auf Zuruf.
const NETWORK_DEPENDENT_GATES = new Set(["check:doctickets"]);

// Die build-freien Einzel-Gates, die `verify` fährt: jedes `check:*` (außer den
// Projekt-Gates, report- und netzabhängigen) plus die drei Namens-Gates. Aus den
// Scripts abgeleitet, damit ein neu hinzugefügtes `check:*`-Gate den Test automatisch
// mitzieht (statt hier zu verrotten).
const GATE_SCRIPTS = [
  ...Object.keys(scripts).filter(
    (n) =>
      n.startsWith("check:") &&
      !PROJEKT_GATES.has(n) &&
      !REPORT_DEPENDENT_GATES.has(n) &&
      !NETWORK_DEPENDENT_GATES.has(n),
  ),
  "typecheck",
  "lint",
  "test",
];

describe("#527 verify: eine SSOT-Kette über alle Gates", () => {
  it("`verify` existiert und ruft JEDES Einzel-Gate auf (kein vergessenes Gate)", () => {
    const verify = scripts.verify;
    expect(verify, "npm run verify muss existieren").toBeTruthy();
    for (const gate of GATE_SCRIPTS) {
      // `test` läuft als npm-Lifecycle `npm test`, die übrigen als `npm run <gate>`.
      const needle =
        gate === "test"
          ? /\bnpm test\b/
          : new RegExp(`\\bnpm run ${escapeRegex(gate)}\\b`);
      expect(verify, `verify muss das Gate "${gate}" enthalten`).toMatch(needle);
    }
  });

  it("#101: `check:docmap` läuft in `verify` (entfällt ohne struktur.moduldoku mit Exit 0, kostet nichts)", () => {
    expect(scripts.verify).toMatch(/\bnpm run check:docmap\b/);
  });

  it("jedes Gate aus `gates.nichtInVerify` ist ein Skript und steht nicht in `verify` (kein veralteter Eintrag)", () => {
    for (const gate of PROJEKT_GATES) {
      expect(scripts[gate], `gates.nichtInVerify nennt "${gate}", das Skript fehlt in package.json`).toBeTruthy();
      expect(new RegExp(`\\bnpm run ${escapeRegex(gate)}\\b`).test(scripts.verify), `"${gate}" steht in verify, gehört aber nicht in gates.nichtInVerify`).toBe(false);
    }
  });

  it("`verify:full` existiert und erweitert `verify`", () => {
    const full = scripts["verify:full"];
    expect(full, "npm run verify:full muss existieren").toBeTruthy();
    expect(full).toMatch(/\bnpm run verify\b/);
  });

  it("report-abhängige Gates (#1021 check:diffcoverage) laufen in verify:full, NACH ihrem Erzeuger", () => {
    const full = scripts["verify:full"];
    for (const [gate, producer] of REPORT_DEPENDENT_GATES) {
      const needle = new RegExp(`\\bnpm run ${escapeRegex(gate)}\\b`);
      const ci = readRepo(".github/workflows/ci.yml");
      const nachErzeuger = (s: string) => s.indexOf(`npm run ${gate}`) > s.indexOf(`npm run ${producer}`);
      // In der CI erzeugt der Verify-Schritt den Bericht (factory#270: ein Testlauf mit Coverage über FACTORY_COVERAGE=1); der Standard von `coverage` bleibt der npm-Lauf.
      expect(STANDARD_BEFEHLE.coverage, "Standard von coverage ist der Erzeuger").toBe(`npm run ${producer}`);
      expect(verifySchritt().run, "ci.yml muss einen Schritt Verify mit dem Gate-Befehl verifyKompakt haben").toMatch(/node scripts\/gate-befehl\.mjs verifyKompakt\b/);
      expect(full, `verify:full muss "${gate}" enthalten`).toMatch(needle);
      // ... und zwar hinter dem Erzeuger, sonst misst es nichts bzw. einen alten Stand.
      expect(nachErzeuger(full), `"${gate}" muss NACH "${producer}" stehen`).toBe(true);
      // NICHT in der schnellen verify-Kette — dort läuft der Erzeuger nicht.
      expect(needle.test(scripts.verify), `"${gate}" gehört nicht in die verify-Kette`).toBe(false);
      expect(needle.test(ci), `"${gate}" muss als eigener CI-Schritt laufen`).toBe(true);
      expect(ci.indexOf(`npm run ${gate}`), `"${gate}" muss in der CI NACH dem Verify-Schritt (Erzeuger von ${producer}) stehen`).toBeGreaterThan(ci.indexOf(`- name: ${verifySchritt().name}`));
    }
  });

  // factory#270: Suite einmal, instrumentiert. Der Schalter hängt nur am Verify-Schritt der CI; lokal bleibt verify uninstrumentiert.
  // Der Schritt wird geparst (kein Regex über den Text): ein auskommentierter Schalter zählt nicht.
  type CiSchritt = { name: string; run?: string; env?: Record<string, unknown> };
  function verifySchritt(): CiSchritt {
    const doc = parse(readRepo(".github/workflows/ci.yml")) as { jobs: Record<string, { steps?: CiSchritt[] }> };
    // Ein Job mit `uses:` (Aufruf eines Kern-Workflows, factory#401) hat keine Schritte.
    const treffer = Object.values(doc.jobs).flatMap((j) => j.steps ?? []).filter((s) => s.name.startsWith("Verify"));
    expect(treffer, "ci.yml braucht genau einen Schritt \"Verify…\"").toHaveLength(1);
    return treffer[0];
  }

  it("factory#270: die CI fährt die Suite einmal mit Coverage (kein eigener Coverage-Gate-Schritt, Env am Verify-Schritt)", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    expect(ci, "kein zweiter Suite-Lauf über den Gate-Befehl coverage").not.toMatch(/^\s*run:\s*node scripts\/gate-befehl\.mjs coverage\b/m);
    expect(verifySchritt().env?.FACTORY_COVERAGE).toBe("1");
    expect(verifySchritt().run).toBe("node scripts/gate-befehl.mjs verifyKompakt");
  });

  it("factory#270: die Vitest-Config schaltet Coverage nur über FACTORY_COVERAGE=1 ein und behält die Floors", async () => {
    type Cfg = { default: { test: { coverage: { enabled?: boolean; thresholds: Record<string, number> } } } };
    const laden = async (wert: string | undefined): Promise<Cfg["default"]["test"]["coverage"]> => {
      vi.resetModules();
      // Auch „nicht gesetzt“ per Stub (undefined löscht die Variable): die CI setzt FACTORY_COVERAGE=1 für diesen ganzen Lauf, unstubAllEnvs stellte das wieder her.
      vi.stubEnv("FACTORY_COVERAGE", wert);
      const cfg = (await import("../../vite.config")) as unknown as Cfg;
      return cfg.default.test.coverage;
    };
    try {
      const an = await laden("1");
      expect(an.enabled).toBe(true);
      expect(Object.keys(an.thresholds)).toEqual(expect.arrayContaining(["lines", "branches"]));
      const aus = await laden(undefined);
      expect(aus.enabled, "lokaler Normalfall: Variable nicht gesetzt").toBe(false);
      expect((await laden("0")).enabled, "nur der Wert 1 schaltet ein").toBe(false);
      expect(aus.thresholds, "die Floors gelten unabhängig vom Schalter").toEqual(an.thresholds);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("die Workflows mit Gate-Kette (ci.yml, verify-macos.yml) rufen Installation und verify über den Gate-Befehl", () => {
    for (const datei of [".github/workflows/ci.yml", ".github/workflows/verify-macos.yml"]) {
      const text = readRepo(datei);
      expect(text, `${datei}: Installation über den Gate-Befehl`).toMatch(/run: node scripts\/gate-befehl\.mjs install\b/);
      expect(text, `${datei}: verify über den Gate-Befehl`).toMatch(/run: node scripts\/gate-befehl\.mjs verifyKompakt\b/);
      expect(text, `${datei}: kein festes npm ci/npm run verify als Schritt`).not.toMatch(/run: npm (ci|run verify)\b/);
    }
  });

  it("netzabhängige Gates (#610 check:doctickets) laufen NICHT in verify, sondern als eigener CI-Job", () => {
    for (const gate of NETWORK_DEPENDENT_GATES) {
      const needle = new RegExp(`\\bnpm run ${escapeRegex(gate)}\\b`);
      // Nicht in der hermetischen verify-Kette (dort gäbe es kein Netz/Token).
      expect(
        needle.test(scripts.verify),
        `"${gate}" darf NICHT in der offline-fähigen verify-Kette stehen`,
      ).toBe(false);
      // Aber es MUSS ein package.json-Skript sein (existiert & wird gepflegt).
      expect(scripts[gate], `"${gate}" muss als package.json-Skript existieren`).toBeTruthy();
      // ... und als eigener Schritt in der CI laufen (sonst alarmiert es nie automatisch).
      // Generisch je Gate: entweder `npm run <gate>` ODER der direkte Skript-Aufruf aus
      // dem package.json-Kommando (Muster doctickets: `node scripts/check-doc-tickets.mjs`).
      const ci = readRepo(".github/workflows/ci.yml");
      const scriptFile = scripts[gate].match(/scripts\/[\w.-]+\.mjs/)?.[0];
      expect(
        needle.test(ci) || (scriptFile != null && ci.includes(scriptFile)),
        `"${gate}" muss als eigener CI-Schritt laufen (npm run ${gate} oder ${scriptFile ?? "sein Skript"})`,
      ).toBe(true);
    }
  });

  it("die CI ruft die `verify`-Kette auf, statt die Gates einzeln zu duplizieren", () => {
    const ci = readRepo(".github/workflows/ci.yml");
    expect(ci, "ci.yml muss den Gate-Befehl verifyKompakt aufrufen").toMatch(/node scripts\/gate-befehl\.mjs verifyKompakt\b/);
    expect(STANDARD_BEFEHLE.verify, "Standard von verify ist die verify-Kette").toBe("npm run verify");
    // Die alten, einzeln duplizierten Gate-Steps dürfen NICHT mehr da sein –
    // sonst ist die SSOT wieder aufgeweicht (Gate läuft doppelt / kann driften).
    for (const gate of ["check:arch", "check:size", "check:docmap"]) {
      expect(
        ci.includes(`npm run ${gate}`),
        `ci.yml darf "${gate}" nicht mehr als eigenen Step fahren (läuft jetzt über npm run verify)`,
      ).toBe(false);
    }
  });
});

/* #605: das CI-Post-hoc-Netz auf `main` — die zweite Grenze hinter dem PR-Gate #592.
 * Struktureller Wächter (wie oben): stellt sicher, dass die zwei Bausteine des Netzes
 * in ci.yml erhalten bleiben und nicht still zurückdriften:
 *  1. check:diffsize misst auf push:main gegen den Vorgänger-Commit (FACTORY_DIFF_BASE
 *     = github.event.before) — statt dort wie früher zu Grün zu degradieren.
 *  2. ein Alarm-Job öffnet bei rotem main ein Alarm-Issue, NUR auf push (nicht
 *     bei PRs) und ohne den Workflow zu blockieren.
 *
 * #658/#747: Seit #627 sind die `prio:*`-Labels entfernt, seit #747 auch das
 * Board-`Prio`-Feld — der Alarm-Job darf sich weder auf `prio:hoch` (bräche
 * `gh issue create` mit „label not found") noch auf das Prio-Feld verlassen.
 * Stattdessen: existierendes Label + an die OBERSTE Board-Position schieben per
 * GraphQL (Muster wie forum-inbox.yml).
 */
describe("#605 CI-Post-hoc-Netz auf main (zweite Grenze hinter #592)", () => {
  const ci = readRepo(".github/workflows/ci.yml");
  const alarm = readRepo(".github/workflows/alarm-rot-main.yml");

  it("check:diffsize misst auf push:main gegen den Vorgänger-Commit (github.event.before)", () => {
    // Die verify-Basis muss auf push den Vorgänger heranziehen, damit der gemergte
    // Slice AUCH auf main gemessen wird (sonst No-op-grün wie vor #605).
    const schritt = ci.slice(ci.indexOf("- name: Diff-Basis bestimmen"), ci.indexOf("- name: Verify"));
    expect(schritt, "Schritt „Diff-Basis bestimmen“ muss vor Verify stehen").not.toBe("");
    expect(schritt).toMatch(/BEFORE_SHA:\s*\$\{\{\s*github\.event\.before\s*\}\}/);
    expect(schritt).toContain('FACTORY_DIFF_BASE=$base" >> "$GITHUB_ENV"');
    expect(schritt, "die Basis darf nirgends aus pull_request.base.sha kommen").not.toContain("pull_request.base.sha");
  });

  it("auf einem PR ist die Diff-Basis der erste Elternteil des Merge-Checkouts, nie die veraltete pull_request.base.sha (#1239)", () => {
    // #1240: base.sha liegt hinter main, wenn main nach dem Öffnen weiterging; der Diff zählte
    // dann fremde, inzwischen gemergte Änderungen mit (832 statt 758 Zeilen, rot).
    expect(ci).toContain("base=$(git rev-parse HEAD^1)");
    expect(ci, "FACTORY_DIFF_BASE darf nicht aus pull_request.base.sha gesetzt werden").not.toMatch(
      /FACTORY_DIFF_BASE:\s*\$\{\{[^}]*pull_request\.base\.sha/,
    );
    expect(ci, "die Gates erben FACTORY_DIFF_BASE aus GITHUB_ENV, kein eigenes env überschreibt es").not.toMatch(/^\s+FACTORY_DIFF_BASE:/m);
  });

  it("ein Alarm-Job schlägt bei rotem main an — nur auf push, nicht blockierend", () => {
    expect(ci, "der Alarm-Job muss existieren").toMatch(/alarm-red-main:/);
    // Läuft NUR bei Fehlschlag UND nur auf push (ein roter PR ist Sache der Autorin).
    expect(ci).toMatch(/if:\s*failure\(\)\s*&&\s*github\.event_name\s*==\s*'push'/);
    // Hängt an den Korrektheits-/Security-Gates (nicht am Devpanel-Kompilier-Gate).
    expect(ci).toMatch(/needs:\s*\[build-test,\s*security-audit,\s*probe-erstbezug\]/);
    // Braucht Schreibrecht auf Issues, um den Alarm anzulegen (Aufrufer und Kern-Workflow, sonst deckelt der Aufrufer die Rechte).
    expect(ci).toMatch(/issues:\s*write/);
    expect(alarm).toMatch(/issues:\s*write/);
  });

  it("der Alarm-Job ruft den Kern-Workflow auf (factory#401): Label per Input, PROJECT_TOKEN einzeln, nie secrets: inherit", () => {
    expect(ci).toContain("uses: ./.github/workflows/alarm-rot-main.yml");
    expect(ci).toMatch(/with:\s*\n\s+label:\s*area:[\w-]+/);
    expect(ci).toMatch(/secrets:\s*\n\s+PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}/);
    expect(ci).not.toMatch(/secrets:\s*inherit/);
    expect(ci, "der Shell-Block wohnt im Kern-Workflow, nicht mehr in ci.yml").not.toContain("gh issue create");
    expect(alarm).toMatch(/on:\s*\n\s+workflow_call:/);
    expect(alarm).toMatch(/inputs:\s*\n\s+label:[\s\S]*?required:\s*true[\s\S]*?type:\s*string/);
    expect(alarm).toMatch(/\n {6}PROJECT_TOKEN:[\s\S]*?required:\s*false/);
    expect(alarm).not.toMatch(/secrets:\s*inherit/);
    expect(alarm, "oben keine Rechte, die Rechte stehen je Job").toMatch(/^permissions:\s*\{\}\s*$/m);
    expect(alarm, "gleichzeitige Alarme laufen nacheinander (kein Doppel-Issue)").toMatch(/concurrency:\s*\n\s+group:\s*alarm-rot-main\s*\n\s+cancel-in-progress:\s*false/);
  });

  it("legt das Alarm-Issue mit einem EXISTIERENDEN Label an (nicht dem entfernten prio:hoch, #658)", () => {
    // Das prio:hoch-Label ist seit #627 weg; ein create damit bräche mit „label not
    // found" – genau im Moment, in dem der Alarm greifen soll. Also existierendes Label.
    expect(
      alarm,
      "der Alarm darf sich nicht mehr auf das entfernte prio:hoch-Label verlassen",
    ).not.toMatch(/--label "prio:hoch"/);
    expect(alarm).toMatch(/ALARM_LABEL:\s*\$\{\{\s*inputs\.label\s*\}\}/);
    expect(alarm, "das Label steht nie direkt im run:-Skript").not.toMatch(/run:[\s\S]*\$\{\{\s*inputs\./);
    expect(alarm).toMatch(/gh issue create[\s\S]*?--label "\$ALARM_LABEL"/);
  });

  it("priorisiert über die Board-Position per board-place.mjs (Wiederholung, Notfall-Art rot-main, #1628)", () => {
    expect(alarm).toContain('nr="${new_url##*/}"');
    expect(alarm).toContain('node scripts/board-place.mjs --notfall rot-main --top "$nr"');
    expect(alarm, "kein Board-ID-Literal im Workflow").not.toMatch(/\bPVT[A-Z]*_[A-Za-z0-9_-]{6,}/);
    expect(alarm, "das Prio-Feld ist seit #747 entfernt").not.toContain("updateProjectV2ItemFieldValue");
    expect(alarm, "die Mutationen liegen in board-lib").not.toContain("addProjectV2ItemById");
    expect(alarm).not.toContain("set_board_top");
  });

  it("degradiert ohne PROJECT_TOKEN graceful (nur Warnung, Issue entsteht trotzdem, #658)", () => {
    expect(alarm).toMatch(/PROJECT_TOKEN:\s*\$\{\{\s*secrets\.PROJECT_TOKEN\s*\}\}/);
    expect(alarm).toContain('if [ -z "${PROJECT_TOKEN:-}" ]');
    expect(alarm).toMatch(/::warning::[^\n]*PROJECT_TOKEN/);
  });

  it("dedupliziert über den Titel-Präfix (nicht über ein Label, #658)", () => {
    // Das offene Alarm-Issue wird über den 🚨-Titel-Präfix gefunden, nicht über prio:hoch.
    expect(alarm).toMatch(/startswith\(\\"\$marker\\"\)/);
  });

  it("bleibt rot, wenn die Board-Position endgültig scheitert (#1628)", () => {
    expect(alarm).toMatch(/elif ! GH_TOKEN="\$PROJECT_TOKEN" node scripts\/board-place\.mjs[^\n]*\n\s*echo "::error::[^\n]*"\n\s*exit 1\n\s*fi/);
  });
});
