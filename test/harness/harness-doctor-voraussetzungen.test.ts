/* Wächter des Harness-Doctors (#1799, ADR 0022): jede Voraussetzung, die ein Workflow oder ein Skript liest, hat einen Prüfpunkt in
 * `scripts/harness-doctor.mjs`. Drei Scanner, unabhängig von der Ableitung des Doctors (eigene, breitere Muster, fail-closed):
 *   1. `secrets.X` und `vars.X` in den Workflows (inkl. Kommentare) stehen in `secrets`/`variablen` der Ableitung;
 *   2. Label-Literale (Workflows: `--label`/`--add-label`/Env `*LABEL*:`, Skripte: `"--label", "<v>"`) stehen in `labels`; jeder gelesene
 *      Config-Schlüssel `labels.<k>` bzw. `labelAus(…, "<k>")` existiert in der Config;
 *   3. Project-Felder: jeder Board-Schlüssel der Config, den ein Skript liest (außer `rolle`), ist ein Prüfpunkt; jedes Feld, das ein Skript
 *      per Name liest (REST `fields.find((f) => f.name === "X")`, GraphQL `field(name: "X")`), heißt wie das Status-Feld des Doctors; die
 *      Statusvergleiche der Board-Skripte (nennen `statusFeld` oder importieren `board-lib.mjs`) sind die Todo-Option des Doctors.
 *   4. Die Vorlage der Wochenlauf-Datei, die `--einrichten` installiert (WOCHENLAUF_WORKFLOW), ist die Datei im Repo (Zeilenenden egal).
 *   5. Pflicht-Checks des Kerns (factory#117): jeder Name in `pflichtChecks` einer Besitz-Einheit ist ein Job-`name:` ihrer Workflow-Datei und steht
 *      im Factory-Spiegel; umgekehrt steht jeder Spiegel-Check, den ein Besitz-Workflow erzeugt (Kontext = `name:` oder Job-Schlüssel), in den `pflichtChecks` dieser Einheit.
 * Bekannte Grenzen: Punkt 5 vergleicht nur literale Job-Namen; Matrix- und Ausdrucks-Namen (`${{ }}`) und Jobs mit `uses:` (Kontext „caller / callee“) erkennt er nicht.
 * Weitere Grenzen: nur Literale und die genannten Schreibweisen; ein Label aus einer Berechnung oder `secrets[...]` sieht kein Scanner.
 * Gescannt wird `scripts/*.mjs` auf oberster Ebene (nicht rekursiv, keine `.cjs`). Feldzugriffe mit einfachen Anführungszeichen,
 * umgedrehtem Vergleich, Destructuring, `.filter`/`.some` oder einer Variablen als Feldname erkennt der Feld-Scanner nicht.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { FREMD } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDoctor from "../../scripts/harness-doctor.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { OPTIONALE_LABELS } from "../../scripts/projekt-config-lib.mjs";

const lib = rawLib as unknown as { istWorkflowEinheit: (e: { pfad: string; block?: string; schluessel?: string }) => boolean };

interface Vor { secrets: string[]; optionaleSecrets: string[]; variablen: string[]; labels: string[]; pflichtChecks: string[]; besitzFehler: string | null }
interface Doctor {
  voraussetzungenAus(a: { config: unknown; workflows: { pfad: string; text: string }[]; spiegel?: unknown; besitz?: unknown }): Vor;
  BOARD_PRUEFPUNKTE: string[];
  STATUS_FELD_NAME: string;
  TODO_OPTION_NAME: string;
  WOCHENLAUF_PFAD: string;
  WOCHENLAUF_WORKFLOW: string;
  ohneActionPins(text: string): string;
}
const doctor = rawDoctor as unknown as Doctor;
const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lies = (rel: string): string => readFileSync(WURZEL + rel, "utf8");
const dateien = (ordner: string, ende: RegExp): { pfad: string; text: string }[] =>
  readdirSync(WURZEL + ordner).filter((f) => ende.test(f)).map((f) => ({ pfad: `${ordner}/${f}`, text: lies(`${ordner}/${f}`) }));

/** Pure Scanner (mit Fixtures getestet, damit sie nicht vakuös sind). */
const secretsUndVars = (text: string): { art: string; name: string }[] =>
  [...text.matchAll(/\b(secrets|vars)\.([A-Za-z_]\w*)/g)].map((m) => ({ art: m[1], name: m[2] })).filter((x) => x.name !== "GITHUB_TOKEN");
const labelLiterale = (text: string): string[] => {
  const aus: string[] = [];
  for (const m of text.matchAll(/--(?:add-)?label[ =]+["']?([^\s"'$\\]+)["']?/g)) aus.push(...m[1].split(","));
  for (const m of text.matchAll(/^\s*\w*LABEL\w*:\s*["']?([^\s"'$]+)["']?\s*$/gm)) if (!m[1].includes("{{")) aus.push(m[1]);
  return aus;
};
const skriptLabels = (text: string): string[] => [...text.matchAll(/"--(?:add-)?label",\s*"([^"$]+)"/g)].map((m) => m[1]);
const gelesenerSchluessel = (text: string): string[] => [
  ...[...text.matchAll(/(?:labelAus|optionalesLabel)\(\s*[^,()]+,\s*"(\w+)"\s*\)/g)].map((m) => m[1]),
  ...[...text.matchAll(/\b(?:config|PROJEKT|cfg)\??\.labels\??\.(\w+)/g)].map((m) => m[1]),
];
const boardSchluesselGelesen = (text: string, schluessel: string[]): string[] => schluessel.filter((k) => new RegExp(`\\.${k}\\b`).test(text));
/** Feldnamen, die ein Skript liest: `fields.find((f) => f.name === "X")` (REST-Items) und `field(name: "X")`/`fieldValueByName(name: "X")` (GraphQL). */
const feldNamen = (text: string): string[] => [
  ...[...text.matchAll(/\bfields\??\.find\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\??\.name\s*===\s*"([^"]+)"/g)].map((m) => m[2]),
  ...[...text.matchAll(/\bfield(?:ValueByName)?\(\s*name:\s*\\?"([^"\\]+)\\?"/g)].map((m) => m[1]),
];
/** Ein Board-Skript liest Board-Items: es nennt `statusFeld` oder importiert `board-lib.mjs`. */
const boardSkript = (text: string): boolean => text.includes("statusFeld") || /from\s+"\.\/board-lib\.mjs"/.test(text);
const optionVergleiche = (text: string): string[] => [...text.matchAll(/\bstatus\s*[!=]==\s*"([^"]+)"/g)].map((m) => m[1]);

const config = JSON.parse(lies(".factory/projekt.json")) as { labels: Record<string, string>; boards: Record<string, unknown>[] };
const workflows = dateien(".github/workflows", /\.ya?ml$/);
const skripte = dateien("scripts", /\.mjs$/).filter((s) => !["scripts/harness-doctor.mjs", "scripts/harness-doctor-lib.mjs"].includes(s.pfad));
const spiegel = JSON.parse(lies(".github/ruleset-main-schutz.json")) as { requiredChecks: string[] };
const besitz = JSON.parse(lies(".factory/besitz.json")) as { eintraege: { pfad: string; block?: string; schluessel?: string; ring: string; modul?: string; pflichtChecks?: string[] }[] };
const vor = doctor.voraussetzungenAus({ config, workflows, spiegel, besitz: { wert: besitz } });
/** Jobs eines Workflows: Schlüssel und literaler `name:` (ein Ausdruck mit `${{` gilt als unbekannt); `kontext` ist der Check-Name, den GitHub meldet (`name` oder sonst der Schlüssel), `null` bei Ausdruck oder `uses:`. */
const jobsVon = (text: string): { id: string; name?: string; kontext: string | null }[] => {
  const jobs = (parse(text) as { jobs?: Record<string, { name?: unknown; uses?: unknown } | null> } | null)?.jobs ?? {};
  return Object.entries(jobs).map(([id, j]) => {
    const name = typeof j?.name === "string" ? j.name : undefined;
    const roh = name ?? id;
    return { id, ...(name === undefined ? {} : { name }), kontext: roh.includes("${{") || j?.uses !== undefined ? null : roh };
  });
};
const ganzeWorkflows = besitz.eintraege.filter(lib.istWorkflowEinheit);
const ohneCase = (liste: string[]): Set<string> => new Set(liste.map((l) => l.toLowerCase()));

describe("Scanner (Fixtures, nicht vakuös)", () => {
  test("secrets und vars, auch im Kommentar; GITHUB_TOKEN ausgenommen", () => {
    assert.deepEqual(secretsUndVars("# ${{ vars.FOO }} ${{ secrets.BAR }} ${{ secrets.GITHUB_TOKEN }}"), [{ art: "vars", name: "FOO" }, { art: "secrets", name: "BAR" }]);
  });
  test("Label-Literale und gelesene Schlüssel", () => {
    assert.deepEqual(labelLiterale('gh x --label forum --label "$V" --add-label a:b,c:d\n  ALARM_LABEL: area:x\n  L: ${{ y }}'), ["forum", "a:b", "c:d"].concat(["area:x"]));
    assert.deepEqual(skriptLabels(`["--label", "${FREMD.labels.harness}", "--label", label]`), [FREMD.labels.harness]);
    assert.deepEqual(gelesenerSchluessel('labelAus(config, "harness") config.labels.forum labels.some(x)'), ["harness", "forum"]);
    assert.deepEqual(gelesenerSchluessel('optionalesLabel(config, "entscheidung")'), ["entscheidung"]);
  });
  test("Board-Schlüssel und Vergleichsliterale", () => {
    assert.deepEqual(boardSchluesselGelesen("b.projectId + x.rolle", ["projectId", "neu", "rolle"]), ["projectId", "rolle"]);
    assert.deepEqual(feldNamen('i.fields?.find((f) => f?.name === "Status")?.value; fields.find(f => f.name === "Aufwand")'), ["Status", "Aufwand"]);
    assert.deepEqual(feldNamen('gql(`{ field(name: "Aufwand") { id } fieldValueByName(name: \\"Prio\\") }`)'), ["Aufwand", "Prio"]);
    assert.deepEqual(feldNamen('x.find((c) => c.name === "npm")'), []);
    assert.deepEqual(feldNamen('fields.find((f) => g.name === "X")'), []);
    assert.deepEqual(feldNamen('myfields.find((f) => f.name === "X"); subfield(name: "X")'), []);
    assert.deepEqual(boardSkript('import { a } from "./board-lib.mjs"; i.status === "Blocked"'), true);
    assert.deepEqual(boardSkript('x.status === "ok"'), false);
    assert.deepEqual(boardSkript("const { statusFeld } = board; i.status === 'x'"), true);
    assert.deepEqual(optionVergleiche('i.status !== "Todo"'), ["Todo"]);
  });
  test("ein ungedecktes vars.FOO fällt auf (Negativfall)", () => {
    const v = doctor.voraussetzungenAus({ config, workflows: [{ pfad: "x.yml", text: "a: ${{ vars.FOO }}" }] });
    assert.ok(v.variablen.includes("FOO"));
    assert.ok(!doctor.voraussetzungenAus({ config, workflows: [] }).variablen.includes("FOO"));
  });
});

describe("Pflicht-Checks des Kerns (factory#117)", () => {
  test("jobsVon (Fixtures, nicht vakuös): Name, Schlüssel als Kontext, Ausdruck und uses: unbekannt", () => {
    assert.deepEqual(jobsVon("jobs:\n  a:\n    name: Eins\n  b:\n    runs-on: x\n  c:\n    name: \"M ${{ matrix.v }}\"\n  d:\n    uses: ./w.yml\n"), [
      { id: "a", name: "Eins", kontext: "Eins" },
      { id: "b", kontext: "b" },
      { id: "c", name: "M ${{ matrix.v }}", kontext: null },
      { id: "d", kontext: null },
    ]);
    assert.deepEqual(jobsVon("name: nur Workflow\n"), []);
  });

  test("jeder Name in pflichtChecks ist ein Job-name: seines Workflows und steht im Factory-Spiegel", () => {
    const mit = besitz.eintraege.filter((e) => e.pflichtChecks !== undefined);
    assert.ok(mit.length > 0, "kein Eintrag mit pflichtChecks: vakuös");
    for (const e of mit) {
      assert.ok(existsSync(WURZEL + e.pfad), `${e.pfad}: Datei fehlt`);
      const namen = jobsVon(lies(e.pfad)).flatMap((j) => (j.name === undefined ? [] : [j.name]));
      for (const n of e.pflichtChecks ?? []) {
        assert.ok(namen.includes(n), `${e.pfad}: pflichtChecks nennt "${n}", aber kein Job dieser Datei heißt so (Job-name: ${namen.join(", ")})`);
        assert.ok(spiegel.requiredChecks.includes(n), `${e.pfad}: "${n}" steht nicht in requiredChecks des Ruleset-Spiegels`);
      }
    }
  });

  test("pflichtChecks einer Moduleinheit stehen in der Soll-Liste nur bei vorhandener Workflow-Datei (factory#339)", () => {
    const manifest = { eintraege: [{ pfad: ".github/workflows/mod.yml", ring: "kern", modul: "mod", pflichtChecks: ["Modul-Check"] }] };
    const soll = (workflowDateien: { pfad: string; text: string }[]): string[] => doctor.voraussetzungenAus({ config: { labels: {}, boards: [] }, workflows: workflowDateien, spiegel: { requiredChecks: [] }, besitz: { wert: manifest } }).pflichtChecks;
    assert.deepEqual(soll([{ pfad: ".github/workflows/mod.yml", text: "name: m\n" }]), ["Modul-Check"]);
    assert.deepEqual(soll([{ pfad: ".github/workflows/andere.yml", text: "name: a\n" }]), []);
  });

  test("jeder Spiegel-Check, den ein Besitz-Workflow erzeugt, steht in pflichtChecks dieser Einheit", () => {
    let funde = 0;
    // Auch Moduleinheiten tragen pflichtChecks (Fortschreibung 0022-339): der Doctor verlangt sie nur, wenn ihre Workflow-Datei im Repo liegt.
    for (const e of ganzeWorkflows) {
      for (const j of jobsVon(lies(e.pfad))) {
        if (j.kontext === null || !spiegel.requiredChecks.includes(j.kontext)) continue;
        funde++;
        assert.ok((e.pflichtChecks ?? []).includes(j.kontext), `${e.pfad} erzeugt den Required Check "${j.kontext}" des Spiegels, pflichtChecks der Besitz-Einheit nennt ihn nicht`);
      }
    }
    assert.ok(funde > 0, "kein Spiegel-Check in einem Besitz-Workflow gefunden: vakuös");
  });

  test("die Ableitung des echten Repos: Spiegel und Kern, Manifest lesbar", () => {
    assert.equal(vor.besitzFehler, null);
    for (const n of spiegel.requiredChecks) assert.ok(vor.pflichtChecks.includes(n), n);
    for (const e of besitz.eintraege) for (const n of e.pflichtChecks ?? []) assert.ok(vor.pflichtChecks.includes(n), n);
  });
});

describe("Voraussetzungen des Repos sind Prüfpunkte des Harness-Doctors", () => {
  test("jedes secrets.X und vars.X der Workflows steht in der Ableitung", () => {
    const funde = workflows.flatMap((w) => secretsUndVars(w.text));
    assert.ok(funde.length > 0, "Scanner fand kein einziges Secret: vakuös");
    for (const { art, name } of funde) {
      const liste = art === "secrets" ? [...vor.secrets, ...vor.optionaleSecrets] : vor.variablen;
      assert.ok(liste.includes(name), `${art}.${name} wird in den Workflows gelesen, hat aber keinen Prüfpunkt im Harness-Doctor`);
    }
  });

  test("jedes Label-Literal der Workflows und Skripte steht in der Ableitung", () => {
    const soll = ohneCase(vor.labels);
    const funde = [...workflows.flatMap((w) => labelLiterale(w.text)), ...skripte.flatMap((s) => skriptLabels(s.text))];
    assert.ok(funde.length > 0, "Scanner fand kein Label: vakuös");
    for (const l of funde) assert.ok(soll.has(l.toLowerCase()), `Label "${l}" wird gelesen, hat aber keinen Prüfpunkt im Harness-Doctor (Config-Label oder Workflow-Literal)`);
  });

  test("jeder gelesene Label-Schlüssel existiert in der Config", () => {
    const gelesen = skripte.flatMap((s) => gelesenerSchluessel(s.text));
    assert.ok(gelesen.length > 0, "Scanner fand keinen Schlüssel: vakuös");
    for (const k of gelesen.filter((s) => !(OPTIONALE_LABELS as string[]).includes(s))) assert.ok(Object.hasOwn(config.labels, k), `labels.${k} wird gelesen, fehlt aber in .factory/projekt.json`);
  });

  test("jedes Project-Feld der Config, das ein Skript liest, ist ein Prüfpunkt (rolle: intern, keine GitHub-Voraussetzung)", () => {
    const schluessel = Object.keys(config.boards[0]).filter((k) => k !== "rolle");
    const gelesen = new Set(skripte.flatMap((s) => boardSchluesselGelesen(s.text, schluessel)));
    assert.ok(gelesen.has("statusFeldNodeId"), "Scanner fand kein Board-Feld: vakuös");
    for (const k of gelesen) assert.ok(doctor.BOARD_PRUEFPUNKTE.includes(k), `Board-Schlüssel ${k} wird gelesen, hat aber keinen Prüfpunkt im Harness-Doctor`);
  });

  test("jedes Project-Feld, das ein Skript per Name liest, ist das Status-Feld des Doctors", () => {
    const funde = skripte.flatMap((s) => feldNamen(s.text).map((name) => ({ pfad: s.pfad, name })));
    assert.ok(funde.length > 0, "Scanner fand kein Feld: vakuös");
    for (const f of funde) assert.equal(f.name, doctor.STATUS_FELD_NAME, `${f.pfad} liest das Project-Feld "${f.name}", das der Harness-Doctor nicht prüft`);
  });

  test("Todo-Option: die Statusvergleiche der Board-Skripte sind die des Doctors", () => {
    const funde = skripte.filter((s) => boardSkript(s.text)).flatMap((s) => optionVergleiche(s.text));
    assert.ok(funde.length > 0, "Scanner fand keinen Vergleich: vakuös");
    for (const o of funde) assert.equal(o, doctor.TODO_OPTION_NAME);
  });

  test("die Vorlage der Wochenlauf-Datei ist die Datei im Repo (#1800), Action-Pins (SHA und Versionskommentar) ausgenommen", () => {
    assert.equal(doctor.ohneActionPins(lies(doctor.WOCHENLAUF_PFAD).replace(/\r\n/g, "\n")), doctor.ohneActionPins(doctor.WOCHENLAUF_WORKFLOW));
  });

  describe("ohneActionPins", () => {
    const SHA_A = "a".repeat(40);
    const SHA_B = "b".repeat(40);
    const schritt = (sha: string, kommentar: string): string => `steps:\n  - uses: actions/checkout@${sha}${kommentar}\n  - run: echo hi\n`;

    test("ein anderer SHA und ein anderer Versionskommentar sind gleich, der Rest des Texts bleibt", () => {
      assert.equal(doctor.ohneActionPins(schritt(SHA_A, " # v1.0.0")), doctor.ohneActionPins(schritt(SHA_B, " # v2.3.4")));
      assert.equal(doctor.ohneActionPins(schritt(SHA_A, "")), "steps:\n  - uses: actions/checkout@<pin>\n  - run: echo hi\n");
    });

    test("eine andere Action, ein anderer Schritt und ein fehlender Pin (Tag statt SHA) bleiben ein Unterschied", () => {
      const basis = doctor.ohneActionPins(schritt(SHA_A, " # v1"));
      assert.notEqual(doctor.ohneActionPins(schritt(SHA_A, " # v1").replace("checkout", "setup-node")), basis);
      assert.notEqual(doctor.ohneActionPins(schritt(SHA_A, " # v1").replace("echo hi", "echo ho")), basis);
      assert.notEqual(doctor.ohneActionPins("steps:\n  - uses: actions/checkout@v4 # v1\n  - run: echo hi\n"), basis);
      assert.notEqual(doctor.ohneActionPins(schritt(SHA_A.slice(1), " # v1")), basis, "ein zu kurzer SHA ist kein Pin");
    });

    test("nur SHA und Versionskommentar werden neutralisiert: ein Kommentar in der Zeile davor und ein 41-stelliger Hex nicht", () => {
      assert.equal(doctor.ohneActionPins(`# eigener Kommentar\n  - uses: x/y@${SHA_A} # v1\n# danach\n`), "# eigener Kommentar\n  - uses: x/y@<pin>\n# danach\n");
      assert.equal(doctor.ohneActionPins(`  - uses: x/y@${SHA_A}a # v1\n`), `  - uses: x/y@${SHA_A}a # v1\n`);
      const kein = `  - uses: x/y@${"g".repeat(40)} # v1\n`;
      assert.equal(doctor.ohneActionPins(kein), kein, "40 Zeichen, die kein Hex sind, sind kein Pin");
    });
  });
});
