/* Gate-Befehle (factory#182): Block `befehle` der Projekt-Config und Läufer `scripts/gate-befehl.mjs`. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/gate-befehl-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

type Config = Record<string, unknown>;
interface Lauf { status?: number | null; error?: Error }
interface Optionen { lade: () => Config; spawn: (befehl: string, opt: unknown, ...rest: unknown[]) => Lauf; cwd: string; out: (t: string) => void; err: (t: string) => void; env?: Record<string, string> }
const lib = raw as unknown as {
  STANDARD_BEFEHLE: Record<string, string | null>;
  MUTATION_UMGEBUNG: { bereiche: string; bericht: string };
  E2E_UMGEBUNG: { browser: string };
  GATE_BEFEHL_NAMEN: string[];
  PRUEFLAUF_ART: Record<string, string | null>;
  ZEIGEN_FLAG: string;
  pruefeBefehle(block: unknown): string[];
  befehlAus(config: Config, name: string): string;
  cli(argv: string[], opt: Optionen): number;
};
const pc = rawPc as unknown as { pruefeProjektConfig(c: unknown): string[]; ladeProjektConfig(o: { pfad: string }): Config };

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const HEUTE: Record<string, string | null> = { install: "npm ci", verify: "npm run verify", verifyKompakt: "npm run verify:kompakt", verifyChanged: "npm run verify:changed", coverage: "npm run test:coverage", testGezielt: "npx vitest run", mutation: null, e2e: null };
const BEFEHLE_MIT_STRING = Object.entries(HEUTE).filter((e): e is [string, string] => e[1] !== null);

/** Fake-Umgebung: `spawn` protokolliert den Aufruf; `ausgabe` sammelt stdout und stderr. */
const umgebung = (config: Config = {}, lauf: Lauf = { status: 0 }) => {
  const aufrufe: { befehl: string; opt: unknown; rest: unknown[] }[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let geladen = 0;
  const opt: Optionen = {
    lade: () => { geladen++; return config; },
    spawn: (befehl, o, ...rest) => { aufrufe.push({ befehl, opt: o, rest }); return lauf; },
    cwd: "/wurzel",
    env: {},
    out: (t) => out.push(t),
    err: (t) => err.push(t),
  };
  return { opt, aufrufe, out, err, geladen: () => geladen };
};

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

describe("Standardbefehle ohne Block (K2)", () => {
  test("befehlAus liefert für alle Namen genau die Standardbefehle", () => {
    assert.deepEqual(lib.GATE_BEFEHL_NAMEN, Object.keys(HEUTE));
    for (const [name, befehl] of Object.entries(HEUTE)) assert.equal(lib.befehlAus({}, name), befehl, name);
  });
  test("cli startet je Name genau diesen String als Shell-Befehl, ohne Args-Array", () => {
    for (const [name, befehl] of BEFEHLE_MIT_STRING.filter(([n]) => n !== "testGezielt")) {
      const u = umgebung();
      assert.equal(lib.cli([name], u.opt), 0);
      assert.equal(u.aufrufe.length, 1);
      assert.equal(u.aufrufe[0].befehl, befehl);
      assert.deepEqual(u.aufrufe[0].opt, { shell: true, stdio: "inherit", cwd: "/wurzel" });
      assert.deepEqual(u.aufrufe[0].rest, []);
    }
  });
  test("Drift-Wächter: jedes npm-Skript der Standardbefehle existiert in package.json", () => {
    const skripte = (JSON.parse(readFileSync(join(WURZEL, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    for (const befehl of Object.values(lib.STANDARD_BEFEHLE)) {
      if (befehl === null) continue;
      const m = /^npm run (\S+)$/.exec(befehl);
      if (m) assert.ok(Object.hasOwn(skripte, m[1]), `${befehl}: Skript fehlt`);
    }
  });
});

describe("Teil-Block", () => {
  test("ein gesetzter Name gilt, die übrigen bleiben Standard; {} ist gültig", () => {
    const c = { befehle: { verify: "mvn -q verify" } };
    assert.equal(lib.befehlAus(c, "verify"), "mvn -q verify");
    assert.equal(lib.befehlAus(c, "coverage"), HEUTE.coverage);
    assert.deepEqual(lib.pruefeBefehle({}), []);
    assert.equal(lib.befehlAus({ befehle: {} }, "install"), "npm ci");
  });
  test("cli fährt den Befehl aus dem Block", () => {
    const u = umgebung({ befehle: { verify: "exit 3" } });
    lib.cli(["verify"], u.opt);
    assert.equal(u.aufrufe[0].befehl, "exit 3");
  });
});

describe("Form des Blocks (K1)", () => {
  test("jede Abweichung ergibt eine Meldung", () => {
    for (const falsch of [null, [], "x", 42]) assert.equal(lib.pruefeBefehle(falsch).length, 1, JSON.stringify(falsch));
    assert.equal(lib.pruefeBefehle(undefined).length, 0);
    const unbekannt = lib.pruefeBefehle({ build: "x" });
    assert.equal(unbekannt.length, 1);
    assert.match(unbekannt[0], /befehle\.build.*kein bekannter Name/);
    for (const wert of ["", "  ", 42, null, "a\nb", "a\rb"]) {
      const f = lib.pruefeBefehle({ verify: wert });
      assert.equal(f.length, 1, JSON.stringify(wert));
      assert.match(f[0], /befehle\.verify/);
    }
    assert.deepEqual(lib.pruefeBefehle({ ...Object.fromEntries(BEFEHLE_MIT_STRING), mutation: "x" }), []);
  });
  test("die Schema-Prüfung der Projekt-Config bindet den Block ein", () => {
    const config = pc.ladeProjektConfig({ pfad: "test/fixtures/projekt-fremd.json" });
    assert.deepEqual(pc.pruefeProjektConfig(config), []);
    const fehler = pc.pruefeProjektConfig({ ...config, befehle: { verify: "" } });
    assert.ok(fehler.some((f) => f.includes("befehle.verify")), fehler.join("; "));
  });
  test("echter Lader: kaputter Block endet mit Exit 2, Meldung nennt Feld und Fix", () => {
    const d = mkdtempSync(join(tmpdir(), "gate-befehl-"));
    dirs.push(d);
    const config = JSON.parse(readFileSync(join(WURZEL, "test/fixtures/projekt-fremd.json"), "utf8")) as Config;
    config.befehle = { verify: "" };
    const pfad = join(d, "projekt.json");
    writeFileSync(pfad, JSON.stringify(config));
    const u = umgebung();
    u.opt.lade = () => pc.ladeProjektConfig({ pfad });
    assert.equal(lib.cli(["verify"], u.opt), 2);
    assert.equal(u.aufrufe.length, 0);
    assert.match(u.err.join("\n"), /befehle\.verify[\s\S]*Fix:/);
  });
});

describe("Namen und Aufruf (K3)", () => {
  test("unbekannte Namen enden mit Exit 2 und Fix-Zeile, ohne den Lader zu rufen", () => {
    for (const name of ["verifyFull", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const u = umgebung();
      assert.equal(lib.cli([name], u.opt), 2, name);
      assert.match(u.err.join("\n"), /Fix:/, name);
      assert.equal(u.geladen(), 0, name);
      assert.equal(u.aufrufe.length, 0, name);
    }
  });
  test("kein Name, zwei Namen und unbekanntes Flag enden mit Exit 2", () => {
    for (const argv of [[], ["verify", "install"], ["--unbekannt"], ["verify", "--unbekannt"]]) {
      const u = umgebung();
      assert.equal(lib.cli(argv, u.opt), 2, argv.join(" "));
      assert.equal(u.aufrufe.length, 0);
    }
  });
  test("befehlAus wirft bei kaputtem Block mit Feld und Fix, auch ohne Schema-Prüfung davor", () => {
    for (const wert of ["", "a\nb"]) assert.throws(() => lib.befehlAus({ befehle: { verify: wert } }, "verify"), /befehle\.verify[\s\S]*Fix:/);
    assert.equal(lib.befehlAus(undefined as unknown as Config, "install"), "npm ci");
  });
  test("befehlAus wirft bei unbekanntem Namen mit Fix", () => {
    assert.throws(() => lib.befehlAus({}, "constructor"), /Fix:/);
  });
});

describe("testGezielt mit angehängten Pfaden (factory#193)", () => {
  test("die Pfade werden in doppelten Anführungszeichen an den Standardbefehl angehängt", () => {
    const u = umgebung();
    assert.equal(lib.cli(["testGezielt", "test/a.test.ts", "test/b/c.test.ts"], u.opt), 0);
    assert.equal(u.aufrufe[0].befehl, 'npx vitest run "test/a.test.ts" "test/b/c.test.ts"');
  });
  test("der Block ersetzt den Anfang, die Pfade hängen dahinter; Windows-Pfade und erlaubte Zeichen gehen durch", () => {
    const u = umgebung({ befehle: { testGezielt: "mvn -q test" } });
    assert.equal(lib.cli(["testGezielt", "src\\a-b_c.test.ts", "C:/x/y@1+2=3,4.ts"], u.opt), 0);
    assert.equal(u.aufrufe[0].befehl, 'mvn -q test "src\\a-b_c.test.ts" "C:/x/y@1+2=3,4.ts"');
  });
  test("--zeigen gibt die Zeile samt Pfaden aus und startet nichts", () => {
    const u = umgebung();
    assert.equal(lib.cli(["testGezielt", "test/a.test.ts", "--zeigen"], u.opt), 0);
    assert.deepEqual(u.out, ['npx vitest run "test/a.test.ts"']);
    assert.equal(u.aufrufe.length, 0);
  });
  test("ohne Pfad endet testGezielt mit Exit 2 und Fix-Zeile", () => {
    const u = umgebung();
    assert.equal(lib.cli(["testGezielt"], u.opt), 2);
    assert.match(u.err.join("\n"), /testGezielt braucht mindestens einen Pfad[\s\S]*Fix:/);
    assert.equal(u.aufrufe.length, 0);
  });
  test("die Meldungen der Aufruf-Fehler nennen die Ursache, nicht nur die Fix-Zeile", () => {
    const schlecht = umgebung();
    assert.equal(lib.cli(["testGezielt", "a;b"], schlecht.opt), 2);
    assert.match(schlecht.err.join("\n"), /Pfad „a;b“ enthält unerlaubte Zeichen/);
    const zwei = umgebung();
    assert.equal(lib.cli(["verify", "install"], zwei.opt), 2);
    assert.match(zwei.err.join("\n"), /genau ein Gate-Befehl-Name erwartet/);
  });
  test("Shell-Metazeichen im Pfad enden mit Exit 2, nichts wird gestartet", () => {
    for (const pfad of ["a;b", "a b", "a&b", "a|b", "$(x)", "`x`", 'a"b', "a'b", "a>b", "a<b", "a*b", "a\nb", "a%b", "a!b", "a^b", "a(b)", "a#b", "~x", ""]) {
      const u = umgebung();
      assert.equal(lib.cli(["testGezielt", "test/ok.ts", pfad], u.opt), 2, JSON.stringify(pfad));
      assert.match(u.err.join("\n"), /Fix:/, JSON.stringify(pfad));
      assert.equal(u.aufrufe.length, 0, JSON.stringify(pfad));
    }
  });
  test("bei jedem anderen Namen sind Pfade ein Aufruf-Fehler", () => {
    for (const name of lib.GATE_BEFEHL_NAMEN.filter((n) => n !== "testGezielt")) {
      const u = umgebung();
      assert.equal(lib.cli([name, "test/a.test.ts"], u.opt), 2, name);
      assert.equal(u.aufrufe.length, 0, name);
    }
  });
  test("PRUEFLAUF_ART zählt testGezielt nicht", () => {
    assert.equal(lib.PRUEFLAUF_ART.testGezielt, null);
  });
  test("Smoke im echten Repo: --zeigen mit Pfaden und Metazeichen", () => {
    const ok = spawnSync(process.execPath, ["scripts/gate-befehl.mjs", "testGezielt", "test/a.test.ts", "--zeigen"], { cwd: WURZEL, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), 'npx vitest run "test/a.test.ts"');
    const falsch = spawnSync(process.execPath, ["scripts/gate-befehl.mjs", "testGezielt", "a;b", "--zeigen"], { cwd: WURZEL, encoding: "utf8" });
    assert.equal(falsch.status, 2);
  });
});

describe("testGezielt teilt Pfade auf Läufer auf (L8)", () => {
  const JAVA = { struktur: { quelle: ["backend"], endungen: [".java", ".ts"] }, befehle: { testGezielt: "mvn -q test" } };
  const VITEST = 'npx vitest run';
  test("ein TS-Test außerhalb der Quellwurzeln geht an Vitest, Java-Dateien in der Wurzel an den Projekt-Befehl", () => {
    const u = umgebung(JAVA);
    assert.equal(lib.cli(["testGezielt", "test/tools/x.test.ts", "backend/A.java"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), ['mvn -q test "backend/A.java"', VITEST + ' "test/tools/x.test.ts"']);
  });
  test("ein TS-Pfad innerhalb der Quellwurzel mit Endung in endungen bleibt beim Projekt-Befehl", () => {
    const u = umgebung(JAVA);
    assert.equal(lib.cli(["testGezielt", "backend/b.spec.ts"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), ['mvn -q test "backend/b.spec.ts"']);
  });
  test("steht .ts nicht in endungen, geht auch ein TS-Pfad in der Wurzel an Vitest", () => {
    const u = umgebung({ struktur: { quelle: ["backend"], endungen: [".java"] }, befehle: { testGezielt: "mvn -q test" } });
    assert.equal(lib.cli(["testGezielt", "backend/b.ts"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), [VITEST + ' "backend/b.ts"']);
  });
  test("absolute und Windows-Pfade werden relativ zu cwd gewertet", () => {
    const u = umgebung(JAVA);
    assert.equal(lib.cli(["testGezielt", "/wurzel/test/tools/x.test.ts", "backend\\A.java"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), ['mvn -q test "backend\\A.java"', VITEST + ' "/wurzel/test/tools/x.test.ts"']);
  });
  test("--zeigen gibt beide Zeilen aus und startet nichts", () => {
    const u = umgebung(JAVA);
    assert.equal(lib.cli(["testGezielt", "test/tools/x.test.ts", "backend/A.java", "--zeigen"], u.opt), 0);
    assert.equal(u.out.length, 2);
    assert.equal(u.aufrufe.length, 0);
  });
  test("Negativfall: eine Datei ohne passenden Läufer endet mit Exit 2, Pfad und Fix-Zeile, nichts startet", () => {
    const u = umgebung(JAVA);
    assert.equal(lib.cli(["testGezielt", "backend/A.java", "docs/x.md"], u.opt), 2);
    assert.match(u.err.join("\n"), /docs\/x\.md[\s\S]*Fix:/);
    assert.equal(u.aufrufe.length, 0);
  });
  test("ein roter Lauf lässt den anderen laufen, der erste Exit ≠ 0 gewinnt", () => {
    const u = umgebung(JAVA, { status: 3 });
    assert.equal(lib.cli(["testGezielt", "test/tools/x.test.ts", "backend/A.java"], u.opt), 3);
    assert.equal(u.aufrufe.length, 2);
  });
  test("ein Ordner (Pfad ohne Endung) geht an den Projekt-Befehl", () => {
    const u = umgebung(JAVA);
    assert.equal(lib.cli(["testGezielt", "backend/src/test"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), ['mvn -q test "backend/src/test"']);
  });
  test("Backslashes im Pfad und im cwd (Windows) werden vor der Wurzelprüfung zu /", () => {
    const u = umgebung(JAVA);
    u.opt.cwd = "C:\\projekt\\";
    assert.equal(lib.cli(["testGezielt", "backend\\b.spec.ts", "C:/projekt/test/tools/x.test.ts"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), ['mvn -q test "backend\\b.spec.ts"', VITEST + ' "C:/projekt/test/tools/x.test.ts"']);
  });
  test("ein absoluter Pfad unter cwd wird gekürzt (auch mit Schrägstrich am Ende von cwd) und liegt dann in der Wurzel", () => {
    for (const cwd of ["/projekt", "/projekt/", "C:\\projekt", "C:\\projekt\\"]) {
      const u = umgebung(JAVA);
      u.opt.cwd = cwd;
      const pfad = cwd.startsWith("C:") ? "C:/projekt/backend/b.spec.ts" : "/projekt/backend/b.spec.ts";
      assert.equal(lib.cli(["testGezielt", pfad], u.opt), 0);
      assert.deepEqual(u.aufrufe.map((a) => a.befehl), ['mvn -q test "' + pfad + '"'], cwd);
    }
  });
  test("der erste Exit ≠ 0 gewinnt auch, wenn ein späterer Lauf grün ist", () => {
    const u = umgebung(JAVA);
    const codes = [3, 0];
    u.opt.spawn = (befehl, o, ...rest) => { u.aufrufe.push({ befehl, opt: o, rest }); return { status: codes.shift() }; };
    assert.equal(lib.cli(["testGezielt", "test/tools/x.test.ts", "backend/A.java"], u.opt), 3);
    assert.equal(u.aufrufe.length, 2);
  });
  test("ohne Endung außerhalb von JS/TS in struktur.endungen bleibt alles beim einen Befehl (unverändert)", () => {
    const u = umgebung({ struktur: { quelle: ["src"], endungen: [".ts"] }, befehle: { testGezielt: "mvn -q test" } });
    assert.equal(lib.cli(["testGezielt", "docs/x.md", "test/a.test.ts"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), ['mvn -q test "docs/x.md" "test/a.test.ts"']);
  });
  test("ohne eigenen Befehl (Standard) bleibt alles bei Vitest, auch mit .java in endungen", () => {
    const u = umgebung({ struktur: { quelle: ["backend"], endungen: [".java"] } });
    assert.equal(lib.cli(["testGezielt", "docs/x.md"], u.opt), 0);
    assert.deepEqual(u.aufrufe.map((a) => a.befehl), [VITEST + ' "docs/x.md"']);
  });
  test("endungen ohne struktur.quelle: Exit 2 mit der Fix-Zeile des Laders", () => {
    const u = umgebung({ struktur: { endungen: [".java"] }, befehle: { testGezielt: "mvn -q test" } });
    assert.equal(lib.cli(["testGezielt", "backend/A.java"], u.opt), 2);
    assert.match(u.err.join("\n"), /struktur\.quelle[\s\S]*Fix:/);
    assert.equal(u.aufrufe.length, 0);
  });
});

describe("mutation: opt-in Gate-Befehl (factory#299)", () => {
  const MIT = { befehle: { mutation: "werkzeug lauf" } };
  const ENV = { FACTORY_MUTATION_BEREICHE: "/tmp/b.json", FACTORY_MUTATION_BERICHT: "/tmp/r.json" };
  const mitEnv = (u: ReturnType<typeof umgebung>, env: Record<string, string>) => ({ ...u.opt, env });
  const cliEnv = (argv: string[], u: ReturnType<typeof umgebung>, env: Record<string, string>) => (lib.cli as unknown as (a: string[], o: unknown) => number)(argv, mitEnv(u, env));
  test("Standard ist nicht eingerichtet (null) und der Prüflauf-Art ist null", () => {
    assert.equal(lib.befehlAus({}, "mutation"), null);
    assert.equal(lib.PRUEFLAUF_ART.mutation, null);
  });
  test("nicht eingerichtet: Exit 0 mit Meldung, ohne Spawn, auch mit --zeigen", () => {
    for (const argv of [["mutation"], ["mutation", "--zeigen"]]) {
      const u = umgebung();
      assert.equal(cliEnv(argv, u, ENV), 0);
      assert.deepEqual(u.out, ["mutation: nicht eingerichtet"]);
      assert.equal(u.aufrufe.length, 0);
    }
  });
  test("eingerichtet ohne oder mit leeren Umgebungsvariablen: Exit 2 mit Fix, ohne Spawn", () => {
    for (const env of [{} as Record<string, string>, { FACTORY_MUTATION_BEREICHE: "/tmp/b.json" }, { FACTORY_MUTATION_BERICHT: "/tmp/r.json" }, { ...ENV, FACTORY_MUTATION_BERICHT: "" }, { ...ENV, FACTORY_MUTATION_BEREICHE: "" }]) {
      const u = umgebung(MIT);
      assert.equal(cliEnv(["mutation"], u, env), 2, JSON.stringify(env));
      assert.match(u.err.join("\n"), /Fix: .*mutation-lauf\.mjs/);
      assert.equal(u.aufrufe.length, 0);
    }
  });
  test("eingerichtet mit beiden Variablen: die konfigurierte Zeile wird gestartet", () => {
    const u = umgebung(MIT);
    assert.equal(cliEnv(["mutation"], u, ENV), 0);
    assert.equal(u.aufrufe.length, 1);
    assert.equal(u.aufrufe[0].befehl, "werkzeug lauf");
  });
  test("--zeigen gibt die konfigurierte Zeile auch ohne Variablen aus", () => {
    const u = umgebung(MIT);
    assert.equal(cliEnv(["mutation", "--zeigen"], u, {}), 0);
    assert.deepEqual(u.out, ["werkzeug lauf"]);
  });
  test("Formprüfung: leer und mehrzeilig sind Fehler, ein String ist gültig, auch über die Projekt-Config", () => {
    for (const wert of ["", "a\nb"]) assert.equal(lib.pruefeBefehle({ mutation: wert }).length, 1, JSON.stringify(wert));
    assert.deepEqual(lib.pruefeBefehle({ mutation: "x" }), []);
    const config = pc.ladeProjektConfig({ pfad: "test/fixtures/projekt-fremd.json" });
    assert.deepEqual(pc.pruefeProjektConfig({ ...config, befehle: { mutation: "x" } }), []);
    assert.ok(pc.pruefeProjektConfig({ ...config, befehle: { mutation: "" } }).some((f) => f.includes("befehle.mutation")));
  });
  test("Vertrag: die Umgebungsvariablen heißen genau wie dokumentiert", () => {
    assert.deepEqual(lib.MUTATION_UMGEBUNG, { bereiche: "FACTORY_MUTATION_BEREICHE", bericht: "FACTORY_MUTATION_BERICHT" });
  });
});

describe("mutation im Kindprozess: der Produktionsweg übergibt die Prozess-Umgebung (factory#299)", () => {
  const lauf = (env: Record<string, string>) => {
    const d = mkdtempSync(join(tmpdir(), "gate-befehl-mutation-"));
    dirs.push(d);
    const config = JSON.parse(readFileSync(join(WURZEL, "test/fixtures/projekt-fremd.json"), "utf8")) as Config;
    config.befehle = { mutation: "node --version" };
    const pfad = join(d, "projekt.json");
    writeFileSync(pfad, JSON.stringify(config));
    const basis: Record<string, string | undefined> = { ...process.env, VITEST: "1", FACTORY_PROJEKT_WURZEL: WURZEL, FACTORY_PROJEKT_CONFIG: pfad };
    delete basis.FACTORY_MUTATION_BEREICHE;
    delete basis.FACTORY_MUTATION_BERICHT;
    return spawnSync(process.execPath, ["scripts/gate-befehl.mjs", "mutation"], { cwd: WURZEL, encoding: "utf8", env: { ...basis, ...env } });
  };
  test("mit beiden Variablen startet die konfigurierte Zeile (Exit 0), ohne sie endet der Aufruf mit Exit 2", () => {
    const mit = lauf({ FACTORY_MUTATION_BEREICHE: "/tmp/b.json", FACTORY_MUTATION_BERICHT: "/tmp/r.json" });
    assert.equal(mit.status, 0, mit.stderr);
    assert.match(mit.stderr, /Gate-Befehl mutation: node --version/);
    const ohne = lauf({});
    assert.equal(ohne.status, 2);
    assert.match(ohne.stderr, /braucht die Umgebungsvariablen/);
  });
});

describe("Ausführung (K3)", () => {
  test("der Exit-Code des Befehls wird weitergegeben", () => {
    assert.equal(lib.cli(["verify"], umgebung({}, { status: 0 }).opt), 0);
    assert.equal(lib.cli(["verify"], umgebung({}, { status: 3 }).opt), 3);
    // factory#401: die CI fährt verifyKompakt, ein roter Lauf muss ihren Schritt rot machen
    assert.equal(lib.cli(["verifyKompakt"], umgebung({}, { status: 1 }).opt), 1);
    assert.equal(lib.cli(["verifyKompakt"], umgebung({}, { status: 0 }).opt), 0);
  });
  test("Signal (Status null) ist fail-closed 1", () => {
    assert.equal(lib.cli(["verify"], umgebung({}, { status: null }).opt), 1);
  });
  test("Startfehler ist 1 mit Meldung", () => {
    const u = umgebung({}, { error: new Error("ENOENT") });
    assert.equal(lib.cli(["verify"], u.opt), 1);
    assert.match(u.err.join("\n"), /ENOENT/);
  });
  test("PRUEFLAUF_ART deckt genau die Gate-Befehl-Namen ab (gleiche Reihenfolge), ZEIGEN_FLAG ist --zeigen", () => {
    assert.deepEqual(Object.keys(lib.PRUEFLAUF_ART), lib.GATE_BEFEHL_NAMEN);
    assert.equal(lib.ZEIGEN_FLAG, "--zeigen");
  });
  test("--zeigen gibt genau den Befehl aus und startet nichts", () => {
    const u = umgebung({ befehle: { verify: "mvn -q verify" } });
    assert.equal(lib.cli(["verify", "--zeigen"], u.opt), 0);
    assert.deepEqual(u.out, ["mvn -q verify"]);
    assert.equal(u.aufrufe.length, 0);
  });
  test("Smoke im echten Repo: --zeigen und unbekannter Name", () => {
    const ok = spawnSync(process.execPath, ["scripts/gate-befehl.mjs", "verify", "--zeigen"], { cwd: WURZEL, encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(ok.stdout.trim(), "npm run verify");
    const falsch = spawnSync(process.execPath, ["scripts/gate-befehl.mjs", "gibtsnicht"], { cwd: WURZEL, encoding: "utf8" });
    assert.equal(falsch.status, 2);
    assert.match(falsch.stderr, /Fix:/);
  });
});

describe("e2e: opt-in Gate-Befehl (factory#246)", () => {
  test("ist ein bekannter Name, Standard nicht eingerichtet, Prüflauf-Art null", () => {
    assert.ok(lib.GATE_BEFEHL_NAMEN.includes("e2e"));
    assert.equal(lib.befehlAus({}, "e2e"), null);
    assert.equal(lib.PRUEFLAUF_ART.e2e, null);
  });
  test("ohne Eintrag: Exit 0 mit Meldung, ohne Spawn", () => {
    const u = umgebung();
    assert.equal(lib.cli(["e2e"], u.opt), 0);
    assert.deepEqual(u.out, ["e2e: nicht eingerichtet"]);
    assert.equal(u.aufrufe.length, 0);
  });
  test("mit Eintrag startet die konfigurierte Zeile", () => {
    const u = umgebung({ befehle: { e2e: "browser-lauf" } });
    assert.equal(lib.cli(["e2e"], u.opt), 0);
    assert.equal(u.aufrufe.length, 1);
    assert.equal(u.aufrufe[0].befehl, "browser-lauf");
  });
  test("Vertrag: die Umgebungsvariable heißt genau wie dokumentiert", () => {
    assert.deepEqual(lib.E2E_UMGEBUNG, { browser: "FACTORY_E2E_BROWSER" });
  });
});
