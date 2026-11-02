/* Harness-Doctor (#1799): Verhalten von `--pruefen` über die öffentliche API mit injiziertem `gh` und Langfuse, ohne Netz.
 * Die gesunde Welt ist ein Fake; jeder Test verfälscht genau eine Antwort und erwartet genau diese Lücke samt `Fix:`-Zeile. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDoctor from "../scripts/harness-doctor.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeDateien as rawDateien } from "../scripts/harness-doctor-dateien.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeAltnamen as rawAlt, pruefeSprache as rawSprache, konfigFehlerText as rawFehlerText, pruefLauf as rawPruefLauf } from "../scripts/harness-doctor-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { SICHERHEIT_PUNKTE as rawSicherheitPunkte } from "../scripts/harness-doctor-sicherheit.mjs";
const SICHERHEIT_PUNKTE = rawSicherheitPunkte as string[];
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { altEnvName as rawAltName } from "../scripts/projekt-config-lib.mjs";

interface Doctor {
  main(argv: string[], opt: Record<string, unknown>): number;
  pruefe(a: { config: { repo: string }; voraussetzungen: Record<string, unknown>; spiegel: unknown; gh: (a: string[]) => string; langfuse: null }): { punkt: string; ok: boolean; fatal?: boolean }[];
  voraussetzungenAus(a: { config: Record<string, unknown>; workflows: { pfad: string; text: string }[]; spiegel?: unknown; besitz?: unknown }): { secrets: string[]; variablen: string[]; labels: string[]; pflichtChecks: string[]; besitzFehler: string | null };
}
const doctor = rawDoctor as unknown as Doctor;
type Befund = { punkt: string; ok: boolean; befund?: string; fix?: string };
const pruefeAltnamen = rawAlt as (a: { env: Record<string, string | undefined>; config: unknown; namen: string[] }) => Befund[];
const altEnvName = rawAltName as (name: string, config: unknown) => string | null;
const SKRIPT = fileURLToPath(new URL("../scripts/harness-doctor.mjs", import.meta.url));

const board = (rolle: string, nummer: number, id: string) => ({ rolle, besitzer: "acme", besitzerTyp: "org", nummer, projectId: id, statusFeldId: 5, statusFeldNodeId: "x_status", todoOptionId: "abc" });
const CONFIG = {
  version: 2,
  repo: "acme/demo",
  boards: [board("produkt", 7, "p_eins"), board("factory", 8, "p_zwei")],
  praefixe: { commitZeile: "ZD-", branch: "feature/zd-", worktree: "zd-" },
  labels: { harness: "area:werk", festgefahren: "status:steckt", forum: "forum", dependabotInbox: "area:werk" },
  agenten: { planer: "p", umsetzer: "u", lens: "l", gruppe: "g", ticketSkill: "t" },
  skills: { abschluss: "a" },
  rulesetSpiegel: "ruleset.json",
  sprache: {
    umschrift: ["ae"],
    spezifikation: {
      ziel: "Ziel",
      nachMerge: "Danach:",
      akzeptanzkriterien: ["Kriterien"],
      blocker: "blockiert durch",
      abhaengigkeit: ["folgt nach #"],
      negativfall: { wort: "Negativfall", muster: "negativ" },
      begrenzung: { wort: "Grenze", muster: "grenze" },
      allquantor: { wort: "alle", muster: "alle" },
    },
  },
};
const WORKFLOW = "env:\n  T: ${{ secrets.PROJECT_TOKEN }}\n  G: ${{ secrets.GITHUB_TOKEN }}\nrun: gh issue list --label forum\n";
const feld = { name: "Status", node_id: "x_status", options: [{ id: "abc", name: { raw: "Todo" } }] };
const SICHER = { security_and_analysis: Object.fromEntries(["secret_scanning", "secret_scanning_push_protection", "secret_scanning_non_provider_patterns", "secret_scanning_validity_checks", "dependabot_security_updates"].map((k) => [k, { status: "enabled" }])) };
const REPO_OK = { private: false, default_branch: "main", permissions: { admin: true }, ...SICHER };
const CODEQL = { type: "code_scanning", parameters: { code_scanning_tools: [{ tool: "CodeQL" }] } };
const GESUND: Record<string, unknown> = {
  "api -i user": "HTTP/2.0 200 OK\nX-Oauth-Scopes: gist, project, repo\n\n{}",
  "api repos/acme/demo": REPO_OK,
  "api repos/acme/demo/actions/permissions": { enabled: true, allowed_actions: "all", sha_pinning_required: true },
  "api repos/acme/demo/private-vulnerability-reporting": { enabled: true },
  "api --paginate --slurp repos/acme/demo/actions/secrets": [{ secrets: [{ name: "PROJECT_TOKEN" }] }],
  "api --paginate --slurp repos/acme/demo/actions/organization-secrets": [{ secrets: [] }],
  "api --paginate --slurp repos/acme/demo/labels?per_page=100": [[{ name: "area:werk" }, { name: "status:steckt" }, { name: "forum" }]],
  "api orgs/acme/projectsV2/7": { node_id: "p_eins", number: 7 },
  "api orgs/acme/projectsV2/8": { node_id: "p_zwei", number: 8 },
  "api orgs/acme/projectsV2/7/fields/5": feld,
  "api orgs/acme/projectsV2/8/fields/5": feld,
  "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }, { context: "Audit" }] } }, CODEQL],
};
const SPIEGEL = { name: "main-schutz", requiredChecks: ["CI", "Audit"], bypassActors: [] };

const ordner: string[] = [];
afterEach(() => {
  for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
});

const BESITZ_LEER = JSON.stringify({ version: 1, eintraege: [] });
interface Lauf { code: number; out: string[]; err: string[]; aufrufe: string[] }
function lauf(over: Record<string, unknown> = {}, opt: { config?: Record<string, unknown>; workflow?: string | null; spiegel?: unknown; besitz?: string | null; langfuse?: number; argv?: string[]; env?: Record<string, string>; kernEnv?: () => string[]; dateien?: ((a: { rootDir: string }) => unknown[]) | "echt"; vorbereiten?: (root: string) => void; fremderRoot?: boolean } = {}): Lauf {
  const root = mkdtempSync(join(tmpdir(), "doctor-"));
  ordner.push(root);
  opt.vorbereiten?.(root);
  if (opt.workflow !== null) {
    mkdirSync(join(root, ".github", "workflows"), { recursive: true });
    writeFileSync(join(root, ".github", "workflows", "a.yml"), opt.workflow ?? WORKFLOW);
  }
  writeFileSync(join(root, "ruleset.json"), JSON.stringify(opt.spiegel ?? SPIEGEL));
  if (opt.besitz !== null) {
    mkdirSync(join(root, ".factory"), { recursive: true });
    writeFileSync(join(root, ".factory", "besitz.json"), opt.besitz ?? BESITZ_LEER);
  }
  writeFileSync(join(root, "projekt.json"), JSON.stringify(opt.config ?? CONFIG));
  mkdirSync(join(root, ".factory"), { recursive: true });
  writeFileSync(join(root, ".factory", "projekt.json"), JSON.stringify(opt.config ?? CONFIG));
  const fremd = opt.fremderRoot ? mkdtempSync(join(tmpdir(), "doctor-fremd-")) : root;
  if (fremd !== root) ordner.push(fremd);
  const welt: Record<string, unknown> = { ...GESUND, ...over };
  // Regeln liefert `gh api --paginate --slurp` als Seiten; eine flache Regelliste in den Fixtures ist eine Seite (Seitenform steht in "Regeln über zwei Seiten").
  for (const [k, w] of Object.entries(welt)) if (k.includes("/rules/branches/") && Array.isArray(w) && !w.some(Array.isArray)) welt[k] = [w];
  const aufrufe: string[] = [];
  const gh = (args: string[]): string => {
    const k = args.join(" ");
    aufrufe.push(k);
    const w = welt[k];
    if (w instanceof Error) throw w;
    if (w === undefined) throw new Error(`HTTP 404: ${k}`);
    return typeof w === "string" ? w : JSON.stringify(w);
  };
  const r: Lauf = { code: -1, out: [], err: [], aufrufe };
  r.code = doctor.main((opt.argv ?? ["--pruefen", "--config", "<config>"]).map((a) => (a === "<config>" ? join(root, "projekt.json") : a === "<factory-config>" ? join(root, ".factory", "projekt.json") : a)), {
    rootDir: fremd,
    gh,
    env: opt.env ?? {},
    ...(opt.dateien === "echt" ? {} : { dateien: opt.dateien ?? (() => []) }), // "echt": Default von main (pruefeDateien) bleibt; die Dateipunkte laufen im mkdtemp-Ordner ohne Git nicht mit; ihr Ende-zu-Ende-Fall steht unten
    ...(opt.kernEnv ? { kernEnv: opt.kernEnv } : {}),
    langfuse: () => ({ status: opt.langfuse ?? 0, stderr: opt.langfuse ? "Langfuse aus." : "" }),
    out: (s: string) => r.out.push(s),
    err: (s: string) => r.err.push(s),
  });
  return r;
}
const luecken = (r: Lauf): string[] => r.out.filter((z) => z.startsWith("LÜCKE"));

describe("Altnamen der Kern-Umgebungsvariablen (--pruefen)", () => {
  const NEU = "FACTORY_DIFF_BASE";
  const ALT = altEnvName(NEU, CONFIG) as string;
  const NEU2 = "FACTORY_PR_NUMBER";
  const ALT2 = altEnvName(NEU2, CONFIG) as string;

  test("pur: keiner gesetzt ergibt einen guten Punkt", () => {
    assert.deepEqual(pruefeAltnamen({ env: {}, config: CONFIG, namen: [NEU, NEU2] }), [{ punkt: "Umgebungsvariablen", ok: true }]);
  });
  test("pur: ein gesetzter Altname ergibt eine Lücke mit Fix, der Wert fehlt", () => {
    const e = pruefeAltnamen({ env: { [ALT]: "geheimwert" }, config: CONFIG, namen: [NEU, NEU2] });
    assert.equal(e.length, 1);
    assert.equal(e[0].ok, false);
    assert.equal(e[0].punkt, `Umgebungsvariable ${ALT}`);
    assert.match(e[0].fix ?? "", new RegExp(`${NEU}`));
    assert.doesNotMatch(JSON.stringify(e), /geheimwert/);
  });
  test("pur: ein leerer Altwert zählt als gesetzt, zwei Altnamen geben zwei Lücken, der neue Name allein keine", () => {
    assert.equal(pruefeAltnamen({ env: { [ALT]: "" }, config: CONFIG, namen: [NEU] })[0].ok, false);
    assert.equal(pruefeAltnamen({ env: { [ALT]: "a", [ALT2]: "b" }, config: CONFIG, namen: [NEU, NEU2] }).length, 2);
    assert.equal(pruefeAltnamen({ env: { [NEU]: "x" }, config: CONFIG, namen: [NEU] })[0].ok, true);
  });
  test("pur: Config ohne gültiges Commit-Präfix und leere Namensliste: kein Befund", () => {
    assert.equal(pruefeAltnamen({ env: { [ALT]: "a" }, config: { praefixe: { commitZeile: "x" } }, namen: [NEU] })[0].ok, true);
    assert.equal(pruefeAltnamen({ env: { [ALT]: "a" }, config: CONFIG, namen: [] })[0].ok, true);
  });
  test("CLI: ein gesetzter Altname ergibt Exit 1 und eine LÜCKE-Zeile mit Fix, der Wert steht nie in der Ausgabe", () => {
    const r = lauf({}, { env: { [ALT]: "geheimwert" } });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 1, r.out.join("\n"));
    assert.match(luecken(r)[0], new RegExp(`Umgebungsvariable ${ALT}: .*Fix: .*${NEU}`));
    assert.doesNotMatch(r.out.concat(r.err).join("\n"), /geheimwert/);
  });
  test("CLI: --einrichten prüft den Punkt nicht, auch nicht über die Prozess-Umgebung", () => {
    const vorher = process.env[ALT];
    process.env[ALT] = "a";
    try {
      const r = lauf({}, { argv: ["--einrichten", "--dry-run", "--config", "<config>"], env: { [ALT]: "a" } });
      assert.match(r.out.join("\n"), /Harness-Doctor --einrichten/);
      assert.doesNotMatch(r.out.join("\n"), new RegExp(ALT));
    } finally {
      if (vorher === undefined) delete process.env[ALT];
      else process.env[ALT] = vorher;
    }
  });
  test.each([
    [undefined, /besitz\.json nicht lesbar \(\.factory\/besitz\.json fehlt\)/],
    ["kein json", /nicht lesbar \(\.factory\/besitz\.json ist kein gültiges JSON\)/],
    ['{"version":1}', /nicht lesbar \(\.factory\/besitz\.json hat keine Liste 'eintraege'\)/],
  ])("pruefLauf meldet ein unlesbares Manifest (%j) mit der einheitlichen Meldung, ein gültiges nicht", (inhalt, muster) => {
    const root = mkdtempSync(join(tmpdir(), "doctor-"));
    ordner.push(root);
    writeFileSync(join(root, "projekt.json"), JSON.stringify(CONFIG));
    writeFileSync(join(root, "ruleset.json"), JSON.stringify(SPIEGEL));
    const lauf = () => (rawPruefLauf as (a: Record<string, unknown>) => { ergebnis: { befund?: string }[] })({ rootDir: root, configPfad: join(root, "projekt.json"), gh: () => "{}", langfuse: null }).ergebnis.map((e) => e.befund ?? "").join("\n");
    if (inhalt !== undefined) {
      mkdirSync(join(root, ".factory"));
      writeFileSync(join(root, ".factory", "besitz.json"), inhalt);
    }
    assert.match(lauf(), muster);
    mkdirSync(join(root, ".factory"), { recursive: true });
    writeFileSync(join(root, ".factory", "besitz.json"), '{"eintraege":[]}');
    assert.doesNotMatch(lauf(), /besitz\.json nicht lesbar/);
  });
  test("pruefLauf ohne umgebung (Wochenlauf) prüft den Altnamen nicht, auch bei gesetzter Prozess-Umgebung", () => {
    const root = mkdtempSync(join(tmpdir(), "doctor-"));
    ordner.push(root);
    writeFileSync(join(root, "projekt.json"), JSON.stringify(CONFIG));
    writeFileSync(join(root, "ruleset.json"), JSON.stringify(SPIEGEL));
    const vorher = process.env[ALT];
    process.env[ALT] = "a";
    try {
      const { ergebnis } = (rawPruefLauf as (a: Record<string, unknown>) => { ergebnis: { punkt: string }[] })({ rootDir: root, configPfad: join(root, "projekt.json"), gh: () => "{}", langfuse: null });
      assert.ok(ergebnis.length > 0);
      assert.equal(ergebnis.filter((e) => e.punkt.startsWith("Umgebungsvariable")).length, 0);
    } finally {
      if (vorher === undefined) delete process.env[ALT];
      else process.env[ALT] = vorher;
    }
  });
});

describe("Sprache des Spezifikations-Gates (--pruefen, #1866 L22)", () => {
  const pruefeSprache = rawSprache as (config: unknown) => { punkt: string; ok: boolean; befund?: string; fix?: string }[];
  const ohne = (...schluessel: string[]) => {
    const spez = { ...CONFIG.sprache.spezifikation } as Record<string, unknown>;
    for (const k of schluessel) delete spez[k];
    return { ...CONFIG, sprache: { ...CONFIG.sprache, spezifikation: spez } };
  };

  test("pur: vollständiger Block ist gut", () => {
    assert.deepEqual(pruefeSprache(CONFIG), [{ punkt: "Sprache", ok: true }]);
  });
  test("pur: ohne blocker und abhaengigkeit eine Lücke, die beide Schlüssel und die Fix-Zeile nennt", () => {
    const e = pruefeSprache(ohne("blocker", "abhaengigkeit"));
    assert.equal(e.length, 1);
    assert.equal(e[0].ok, false);
    assert.match(e[0].befund ?? "", /sprache\.spezifikation\.blocker[\s\S]*sprache\.spezifikation\.abhaengigkeit/);
    assert.match(e[0].fix ?? "", /sprache\.spezifikation/);
  });
  test("pur: Config ohne sprache, ohne spezifikation oder null ist eine Lücke, kein Wurf", () => {
    for (const config of [{}, { sprache: {} }, { sprache: { spezifikation: null } }, null, undefined]) {
      assert.equal(pruefeSprache(config)[0].ok, false, JSON.stringify(config));
    }
  });
  test("CLI: Config ganz ohne sprache ergibt Exit 1 und eine LÜCKE-Zeile mit Fix", () => {
    const { sprache: _weg, ...ohneSprache } = CONFIG;
    const r = lauf({}, { config: ohneSprache });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 1, r.out.join("\n"));
    assert.match(luecken(r)[0], /Sprache: .*Fix: .*sprache\.spezifikation/);
  }, 30_000);
  test("CLI: ohne angemeldetes Token wird die Sprache trotzdem geprüft (liest nur die Config)", () => {
    const { sprache: _weg, ...ohneSprache } = CONFIG;
    const r = lauf({ "api -i user": new Error("gh auth login") }, { config: ohneSprache });
    assert.equal(r.code, 1);
    assert.deepEqual(luecken(r).map((z) => z.split(":")[0]), ["LÜCKE Token", "LÜCKE Sprache"], r.out.join("\n"));
    assert.deepEqual(r.aufrufe, ["api -i user"]);
  });
  test("CLI: unvollständiger Block (blocker fehlt) wird schon beim Laden gemeldet: Exit 2 mit Schlüssel und Fix", () => {
    const r = lauf({}, { config: ohne("blocker") });
    assert.equal(r.code, 2);
    assert.match(r.err.join("\n"), /sprache\.spezifikation\.blocker[\s\S]*Fix:/);
  });
});

describe("konfigFehlerText", () => {
  const fehlerText = rawFehlerText as (e: unknown) => string;
  test("Error: Meldung; Nicht-Error: String(e); ohne Fix-Zeile kommt die Spiegel-Fix-Zeile dazu, mit Fix-Zeile bleibt der Text", () => {
    assert.match(fehlerText(new Error("kaputt")), /^kaputt\nFix: /);
    assert.match(fehlerText("nur ein Text"), /^nur ein Text\nFix: /);
    assert.match(fehlerText(42), /^42\nFix: /);
    assert.equal(fehlerText(new Error("x\nFix: so")), "x\nFix: so");
  });
});

describe("pruefLauf mit umgebung: die Namen kommen vom Aufrufer, die Lib liest keine Dateien", () => {
  const fixture = (): string => {
    const root = mkdtempSync(join(tmpdir(), "doctor-"));
    ordner.push(root);
    writeFileSync(join(root, "projekt.json"), JSON.stringify(CONFIG));
    writeFileSync(join(root, "ruleset.json"), JSON.stringify(SPIEGEL));
    return root;
  };
  const lauf2 = (root: string, umgebung: unknown) =>
    (rawPruefLauf as (a: Record<string, unknown>) => { ergebnis: { punkt: string; ok: boolean }[] })({ rootDir: root, configPfad: join(root, "projekt.json"), gh: () => "{}", langfuse: null, umgebung });

  test("ein übergebener Name, den kein Skript liest, wird gegen den Altnamen geprüft", () => {
    const root = fixture();
    const e = lauf2(root, { env: { [altEnvName("FACTORY_NUR_IM_TEST", CONFIG) as string]: "x" }, namen: ["FACTORY_NUR_IM_TEST"] }).ergebnis;
    assert.equal(e.filter((x) => x.punkt.startsWith("Umgebungsvariable ") && !x.ok).length, 1);
  });
  test("leere Namensliste: der Punkt ist gut, nichts wird nachgelesen", () => {
    const e = lauf2(fixture(), { env: { [altEnvName("FACTORY_NUR_IM_TEST", CONFIG) as string]: "x" }, namen: [] }).ergebnis;
    assert.deepEqual(e.filter((x) => x.punkt.startsWith("Umgebungsvariable")), [{ punkt: "Umgebungsvariablen", ok: true }]);
  });
  test("umgebung ohne namen: wirft mit Hinweis, bevor ein gh-Aufruf läuft", () => {
    assert.throws(() => lauf2(fixture(), { env: {} }), /braucht { env, namen }/);
  });
});

describe("harness-doctor --pruefen", () => {
  test("gesunde Welt: Exit 0, keine Lücke, eine Schlusszeile", () => {
    const r = lauf();
    assert.equal(r.code, 0);
    assert.equal(r.out.filter((z) => z.includes("Fix:")).length, 0);
    assert.deepEqual(r.out.filter((z) => z.startsWith("Harness-Doctor:")), ["Harness-Doctor: keine Lücke, alles prüfbar"]);
  });

  const faelle: [string, Record<string, unknown>, RegExp][] = [
    ["Actions aus", { "api repos/acme/demo/actions/permissions": { enabled: false } }, /Actions.*Fix: gh api -X PUT/],
    ["Actions local_only", { "api repos/acme/demo/actions/permissions": { enabled: true, allowed_actions: "local_only" } }, /Actions.*Fix:/],
    ["kein Admin", { "api repos/acme/demo": { ...REPO_OK, permissions: { admin: false } } }, /Admin-Recht.*Fix:/],
    ["Scope ohne project", { "api -i user": "HTTP/2.0 200 OK\nX-Oauth-Scopes: repo\n\n{}" }, /Token-Scope.*Fix: gh auth refresh -s project/],
    ["Secret fehlt", { "api --paginate --slurp repos/acme/demo/actions/secrets": [{ secrets: [] }] }, /Secret PROJECT_TOKEN.*Fix: gh secret set PROJECT_TOKEN --repo acme\/demo/],
    ["Board node_id", { "api orgs/acme/projectsV2/7": { node_id: "falsch", number: 7 } }, /Board produkt: projectId.*Fix:/],
    ["Board number", { "api orgs/acme/projectsV2/8": { node_id: "p_zwei", number: 9 } }, /Board factory: nummer.*Fix:/],
    ["Feld node_id", { "api orgs/acme/projectsV2/7/fields/5": { ...feld, node_id: "anders" } }, /statusFeldNodeId.*Fix:/],
    ["Option Todo fehlt", { "api orgs/acme/projectsV2/7/fields/5": { ...feld, options: [{ id: "abc", name: { raw: "Done" } }] } }, /todoOptionId.*Fix:/],
    ["Status-Feld falscher Name", { "api orgs/acme/projectsV2/7/fields/5": { ...feld, name: "Priorität" } }, /statusFeldId zeigt auf das Feld "Priorität".*Fix:/],
  ];
  const unlesbar: [string, Record<string, unknown>, RegExp][] = [
    ["Repo nicht lesbar", { "api repos/acme/demo": new Error("HTTP 404") }, /NICHT PRÜFBAR Admin-Recht: Repo acme\/demo nicht lesbar.*Fix:/],
    ["Actions nicht lesbar", { "api repos/acme/demo/actions/permissions": new Error("HTTP 403") }, /NICHT PRÜFBAR Actions: .*nicht lesbar.*Fix:/],
    ["Secrets nicht lesbar", { "api --paginate --slurp repos/acme/demo/actions/secrets": new Error("HTTP 403") }, /NICHT PRÜFBAR Secret: secrets nicht lesbar.*Fix:/],
    ["Labels nicht lesbar", { "api --paginate --slurp repos/acme/demo/labels?per_page=100": new Error("HTTP 403") }, /NICHT PRÜFBAR Labels: Labels nicht lesbar.*Fix:/],
    ["Status-Feld 404", { "api orgs/acme/projectsV2/7/fields/5": new Error("HTTP 404") }, /NICHT PRÜFBAR Board produkt: Status-Feld 5 \("Status"\) nicht lesbar.*Fix: boards\[0\]/],
    ["Board wirft", { "api orgs/acme/projectsV2/7": new Error("HTTP 404") }, /NICHT PRÜFBAR Board produkt: Board nicht lesbar.*Fix: boards\[0\]/],
    ["Ruleset 403", { "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": new Error("HTTP 403") }, /NICHT PRÜFBAR Ruleset: Regeln.*nicht lesbar.*Fix:/],
  ];
  for (const [name, over, muster] of unlesbar) {
    test(`nicht prüfbar: ${name}`, () => {
      const r = lauf(over);
      assert.equal(r.code, 1);
      assert.equal(luecken(r).length, 0, r.out.join("\n"));
      const z = r.out.filter((x) => x.startsWith("NICHT PRÜFBAR"));
      assert.ok(z.some((x) => muster.test(x)), r.out.join("\n")); // ein unlesbares Repo macht auch die Sicherheitspunkte nicht prüfbar
    });
  }

  for (const [name, over, muster] of faelle) {
    test(`Lücke: ${name}`, () => {
      const r = lauf(over);
      assert.equal(r.code, 1);
      assert.equal(luecken(r).length, 1, r.out.join("\n"));
      assert.match(luecken(r)[0], muster);
    });
  }

  const OHNE_CHECK = { "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [CODEQL] };
  test("ohne Required Check: die Ruleset-Lücke, danach je Pflicht-Check des Spiegels eine eigene Zeile (factory#117)", () => {
    const r = lauf(OHNE_CHECK);
    assert.equal(r.code, 1);
    const l = luecken(r);
    assert.equal(l.length, 3, r.out.join("\n"));
    assert.match(l[0], /^LÜCKE Ruleset: kein Required status check.*Fix:/);
    assert.match(l[1], /^LÜCKE Required-Check CI: Required-Check "CI" fehlt auf main Fix: "CI" in Ruleset "main-schutz"/);
    assert.match(l[2], /^LÜCKE Required-Check Audit: /);
  });

  test("privat ohne Ruleset: die Grenze steht nur an der Ruleset-Zeile, die Namen folgen", () => {
    const r = lauf({ ...OHNE_CHECK, "api repos/acme/demo": { ...REPO_OK, private: true } });
    const l = luecken(r);
    assert.match(l[0], /^LÜCKE Ruleset: .*ADR 0022.*Fix: Repo öffentlich/);
    assert.deepEqual(l.slice(1).map((z) => z.split(":")[0]), ["LÜCKE Required-Check CI", "LÜCKE Required-Check Audit"]);
    assert.ok(l.slice(1).every((z) => !z.includes("ADR 0022")));
  });

  const KERN_BESITZ = JSON.stringify({ version: 1, eintraege: [{ pfad: ".github/workflows/a.yml", ring: "kern", quelle: "t", pflichtChecks: ["Kern"] }] });
  test("Kern-Pflicht-Check fehlt im Ruleset: Lücke Required-Check <name>; mit dem Namen in den Regeln grün (factory#117)", () => {
    const r = lauf({}, { besitz: KERN_BESITZ });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 1, r.out.join("\n"));
    assert.match(luecken(r)[0], /^LÜCKE Required-Check Kern: Required-Check "Kern" fehlt auf main Fix: "Kern" in Ruleset "main-schutz"/);
    assert.deepEqual(r.out.filter((z) => z.startsWith("HINWEIS Required-Check")), [], "eine Lücke ohne hinweis trägt keine HINWEIS-Zeile");
    const regeln = [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }, { context: "Audit" }, { context: "Kern" }] } }, CODEQL];
    const gruen = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": regeln }, { besitz: KERN_BESITZ });
    assert.equal(gruen.code, 0, gruen.out.join("\n"));
  });

  test("Kern-Pflicht-Check einer Datei, die nicht im Repo liegt, zählt nicht", () => {
    const besitz = JSON.stringify({ version: 1, eintraege: [{ pfad: ".github/workflows/fehlt.yml", ring: "kern", quelle: "t", pflichtChecks: ["Kern"] }] });
    assert.equal(lauf({}, { besitz }).code, 0);
  });

  for (const [name, besitz] of [["fehlt", null], ["kein JSON", "{ nicht json"], ["JSON null", "null"], ["Eintrag kein Objekt", JSON.stringify({ version: 1, eintraege: ["x"] })], ["ungültiges pflichtChecks", JSON.stringify({ version: 1, eintraege: [{ pfad: "x.yml", ring: "kern", quelle: "t", pflichtChecks: [] }] })]] as [string, string | null][]) {
    test(`besitz.json nicht lesbar (${name}): HINWEIS und NICHT PRÜFBAR statt grün, Exit 1, Spiegel-Checks laufen weiter`, () => {
      const r = lauf({}, { besitz });
      assert.equal(r.code, 1, r.out.join("\n"));
      assert.ok(r.aufrufe.length > 0);
      assert.ok(r.out.includes("OK Ruleset"));
      assert.ok(r.out.some((z) => z.startsWith("NICHT PRÜFBAR Kern-Pflicht-Checks: .factory/besitz.json nicht lesbar (")), r.out.join("\n"));
      assert.ok(r.out.some((z) => z.startsWith("HINWEIS Kern-Pflicht-Checks: ")));
      assert.equal(r.out.at(-1), "Harness-Doctor: 0 Lücke(n), 1 nicht prüfbar");
      assert.ok(r.out.every((z) => !z.includes(tmpdir())), "kein absoluter Pfad in der Ausgabe");
    });
  }

  test("K4: fehlendes Label ergibt Exit 1 mit Fix-Zeile, Groß-/Kleinschreibung zählt nicht", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/labels?per_page=100": [[{ name: "AREA:WERK" }, { name: "forum" }]] });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 1);
    assert.match(luecken(r)[0], /Label status:steckt.*Fix: gh label create "status:steckt" --repo acme\/demo/);
  });

  test("K4: fehlender Required-Check ergibt Exit 1 mit Fix-Zeile; zwei fehlende ergeben zwei Zeilen", () => {
    const eins = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }] } }, CODEQL] });
    assert.equal(eins.code, 1);
    assert.equal(luecken(eins).length, 1);
    assert.match(luecken(eins)[0], /Required-Check "Audit" fehlt.*Fix: "Audit" in Ruleset "main-schutz"/);
    const zwei = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "X" }] } }, CODEQL] });
    assert.equal(luecken(zwei).length, 2);
  });

  test("Required-Check einer anderen Regelart zählt nicht", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "pull_request", parameters: { required_status_checks: [{ context: "Audit" }] } }, { type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }] } }] });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Required-Check "Audit" fehlt/);
  });

  test("Standardzweig mit anderem Namen: Regeln kommen von diesem Zweig", () => {
    const repo = { ...REPO_OK, default_branch: "trunk" };
    assert.equal(lauf({ "api repos/acme/demo": repo, "api --paginate --slurp repos/acme/demo/rules/branches/trunk?per_page=100": GESUND["api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100"] }).code, 0);
    const r = lauf({ "api repos/acme/demo": repo });
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => /^NICHT PRÜFBAR Ruleset: .*trunk/.test(z)), r.out.join("\n"));
    const ohneCs = lauf({ "api repos/acme/demo": repo, "api --paginate --slurp repos/acme/demo/rules/branches/trunk?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }, { context: "Audit" }] } }] });
    assert.match(luecken(ohneCs)[0], /^LÜCKE Code-Scanning: keine Code-Scanning-Regel auf trunk/);
  });

  test("privates Repo ohne Code-Scanning-Regel: der Befund nennt die Grenze der Rulesets (privat und Zweig sind verdrahtet)", () => {
    const r = lauf({ "api repos/acme/demo": { ...REPO_OK, private: true } , "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }, { context: "Audit" }] } }] });
    assert.match(luecken(r)[0], /^LÜCKE Code-Scanning: .*auf main \(private Repos auf GitHub Free/);
  });

  test("Antwort null für Repo und Actions: Lücken statt Absturz, die acht Sicherheitspunkte nicht prüfbar", () => {
    const r = lauf({ "api repos/acme/demo": "null", "api repos/acme/demo/actions/permissions": "null", "api repos/acme/demo/private-vulnerability-reporting": "null" });
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => z.startsWith("LÜCKE Admin-Recht: ")));
    assert.ok(r.out.some((z) => z.startsWith("LÜCKE Actions: ")));
    for (const p of ["Secret Scanning", "PVR", "SHA-Pinning"]) assert.ok(r.out.some((z) => z.startsWith(`NICHT PRÜFBAR ${p}: `)), p);
  });

  test("Regeln über zwei Seiten (--slurp): Checks beider Seiten zählen, ein Check nur auf Seite 2 fehlend ist eine Lücke", () => {
    const seite = (c: string) => [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: c }] } }];
    const k = "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100";
    assert.equal(lauf({ [k]: [[...seite("CI"), CODEQL], seite("Audit")] }).code, 0);
    const r = lauf({ [k]: [[...seite("CI"), CODEQL], seite("Anderes")] });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Required-Check "Audit" fehlt/);
  });

  test("Regel ohne parameters zählt als ohne Checks", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [{ type: "required_status_checks" }, CODEQL] });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Ruleset: kein Required status check/);
  });

  test("Antwort null für Board bzw. Status-Feld: Lücken statt Absturz", () => {
    const board = lauf({ "api orgs/acme/projectsV2/7": null });
    assert.equal(board.code, 1);
    assert.equal(luecken(board).length, 2);
    assert.match(luecken(board).join("\n"), /Board produkt: projectId p_eins passt nicht zum Board/);
    const feldNull = lauf({ "api orgs/acme/projectsV2/7/fields/5": null });
    assert.equal(feldNull.code, 1);
    assert.equal(luecken(feldNull).length, 3);
    assert.match(luecken(feldNull).join("\n"), /statusFeldId zeigt auf das Feld/);
  });

  test("Option mit Text-Namen statt { raw } gilt auch", () => {
    assert.equal(lauf({ "api orgs/acme/projectsV2/7/fields/5": { ...feld, options: [{ id: "abc", name: "Todo" }] } }).code, 0);
    const r = lauf({ "api orgs/acme/projectsV2/7/fields/5": { name: "Status", node_id: "x_status" } });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /todoOptionId/);
  });

  test("ohne Ordner .github/workflows wird trotzdem geprüft (Einrichtungsfall)", () => {
    const r = lauf({}, { workflow: null });
    assert.equal(r.code, 0);
    assert.equal(r.aufrufe.filter((a) => a.includes("secrets")).length, 0);
  });

  test("Org-Secret deckt den Bedarf; ohne secrets.* kein Secrets-Aufruf", () => {
    const org = lauf({ "api --paginate --slurp repos/acme/demo/actions/secrets": [{ secrets: [] }], "api --paginate --slurp repos/acme/demo/actions/organization-secrets": [{ secrets: [{ name: "PROJECT_TOKEN" }] }] });
    assert.equal(org.code, 0);
    const keins = lauf({}, { workflow: "run: echo\n" });
    assert.equal(keins.code, 0);
    assert.equal(keins.aufrufe.filter((a) => a.includes("secrets")).length, 0);
  });

  test("fehlende Variable (vars.*) ergibt eine Lücke mit gh variable set", () => {
    const r = lauf({ "api --paginate --slurp repos/acme/demo/actions/variables": [{ variables: [] }] }, { workflow: `${WORKFLOW}x: \${{ vars.MODUS }}\n` });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Variable MODUS.*Fix: gh variable set MODUS --repo acme\/demo/);
  });

  test("Scope-Header fehlt (fein granulares Token): nur HINWEIS, Exit 0", () => {
    const r = lauf({ "api -i user": "HTTP/2.0 200 OK\n\n{}" });
    assert.equal(r.code, 0);
    assert.ok(r.out.some((z) => z.startsWith("HINWEIS Token-Scope")));
  });

  test("gh nicht angemeldet: genau eine GitHub-Lücke, danach kein weiterer gh-Aufruf, Langfuse läuft weiter", () => {
    const r = lauf({ "api -i user": new Error("gh auth login") }, { langfuse: 1 });
    assert.equal(r.code, 1);
    assert.equal(luecken(r).length, 2);
    assert.match(luecken(r)[1], /Langfuse:/);
    assert.match(luecken(r)[0], /Token:.*Fix: gh auth login --scopes project/);
    assert.deepEqual(r.aufrufe, ["api -i user"]);
  });

  test("das nicht angemeldete Token trägt das Feld fatal (einrichten prüft es statt des Punktnamens), ein fehlender Scope nicht", () => {
    const leer = { secrets: [], variablen: [], labels: [], boards: [] };
    const nichtAngemeldet = doctor.pruefe({ config: { repo: "acme/demo" }, voraussetzungen: leer, spiegel: undefined, gh: () => { throw new Error("gh auth login"); }, langfuse: null });
    assert.deepEqual(nichtAngemeldet.filter((p) => p.punkt === "Token").map((p) => [p.punkt, p.fatal]), [["Token", true]]);
    const sicherheit = nichtAngemeldet.filter((p) => !["Token", "Sprache"].includes(p.punkt));
    assert.equal(sicherheit.length, 8, "die acht Sicherheitspunkte stehen auch ohne Token da");
    for (const p of sicherheit) assert.deepEqual([p.ok, (p as { nichtPruefbar?: boolean }).nichtPruefbar, p.fatal], [false, true, undefined]);
    const ohneScope = doctor.pruefe({ config: { repo: "acme/demo" }, voraussetzungen: leer, spiegel: undefined, gh: (a) => (a.join(" ") === "api -i user" ? "HTTP/2.0 200 OK\nX-Oauth-Scopes: repo\n\n{}" : (() => { throw new Error("404"); })()), langfuse: null });
    assert.equal(ohneScope.find((p) => p.punkt === "Token-Scope")?.fatal, undefined);
  });

  test("Kern-Pflicht-Checks nicht prüfbar auch ohne gültigen Token (braucht kein gh)", () => {
    const r = lauf({ "api -i user": new Error("gh auth login") }, { besitz: null });
    assert.ok(r.out.some((z) => z.startsWith("NICHT PRÜFBAR Kern-Pflicht-Checks: ")), r.out.join("\n"));
  });

  test("pruefe ohne pflichtChecks und ohne Spiegel wirft nie und meldet keinen Required-Check", () => {
    const leer = { secrets: [], variablen: [], labels: [], boards: [] };
    const gh = (a: string[]): string => {
      if (a.join(" ") === "api -i user") return "HTTP/2.0 200 OK\nX-Oauth-Scopes: repo, project\n\n{}";
      if (a[0] === "api" && a.includes("--slurp") && a.some((x) => x.includes("/rules/branches/"))) return JSON.stringify([[{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "X" }] } }]]);
      throw new Error("404");
    };
    const punkte = doctor.pruefe({ config: { repo: "acme/demo" }, voraussetzungen: leer, spiegel: undefined, gh, langfuse: null });
    assert.deepEqual(punkte.filter((p) => p.punkt.startsWith("Required-Check")), []);
    assert.ok(punkte.some((p) => p.punkt === "Ruleset" && p.ok));
  });

  test("pruefe ohne abgeleitete pflichtChecks fällt auf die Checks des Spiegels zurück (kein stilles Weglassen, factory#117)", () => {
    const leer = { secrets: [], variablen: [], labels: [], boards: [] };
    const gh = (a: string[]): string => {
      if (a.join(" ") === "api -i user") return "HTTP/2.0 200 OK\nX-Oauth-Scopes: repo, project\n\n{}";
      if (a[0] === "api" && a.includes("--slurp") && a.some((x) => x.includes("/rules/branches/"))) return JSON.stringify([[{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "X" }] } }]]);
      throw new Error("404");
    };
    const punkte = doctor.pruefe({ config: { repo: "acme/demo" }, voraussetzungen: leer, spiegel: { name: "s", requiredChecks: ["CI"] }, gh, langfuse: null });
    assert.deepEqual(punkte.filter((p) => p.punkt.startsWith("Required-Check")).map((p) => p.punkt), ["Required-Check CI"]);
  });

  test("Langfuse nicht erreichbar: Lücke mit Befund aus stderr und Fix", () => {
    const r = lauf({}, { langfuse: 1 });
    assert.equal(r.code, 1);
    assert.match(luecken(r)[0], /Langfuse: Langfuse aus\. Fix:/);
  });

  describe("Code-Scanning-Regel (#92 L2)", () => {
    const REGELN = "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100";
    const required = { type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }, { context: "Audit" }] } };
    const cs = (tool: string) => ({ type: "code_scanning", parameters: { code_scanning_tools: [{ tool, alerts_threshold: "errors", security_alerts_threshold: "high_or_higher" }] } });
    const MIT = { ...SPIEGEL, codeScanning: [{ tool: "CodeQL", sicherheitsSchwelle: "high_or_higher", alertSchwelle: "errors" }] };
    test("Spiegel nennt CodeQL, live gesetzt: gut", () => {
      assert.equal(lauf({ [REGELN]: [required, cs("CodeQL")] }, { spiegel: MIT }).code, 0);
    });
    test("Spiegel nennt CodeQL, live fehlt die Regel: Lücke mit Fix", () => {
      const r = lauf({ [REGELN]: [required] }, { spiegel: MIT });
      assert.equal(r.code, 1);
      assert.equal(luecken(r).length, 1);
      assert.match(luecken(r)[0], /LÜCKE Code-Scanning: Code-Scanning "CodeQL" fehlt.*Fix: Regel in Ruleset "main-schutz" ergänzen \(Pre-Flight\)/);
    });
    test("Regel für ein anderes Werkzeug zählt nicht", () => {
      assert.equal(luecken(lauf({ [REGELN]: [required, cs("Semgrep")] }, { spiegel: MIT })).length, 1);
    });
    test("Regel ohne parameters: Lücke statt Absturz", () => {
      const r = lauf({ [REGELN]: [required, { type: "code_scanning" }] }, { spiegel: MIT });
      assert.equal(luecken(r).length, 1);
      assert.match(luecken(r)[0], /Code-Scanning "CodeQL" fehlt/);
    });
    test("Spiegel ohne codeScanning: live mindestens ein Werkzeug", () => {
      assert.equal(lauf({ [REGELN]: [required, cs("CodeQL")] }).code, 0);
      const r = lauf({ [REGELN]: [required] });
      assert.equal(luecken(r).length, 1);
      assert.match(luecken(r)[0], /^LÜCKE Code-Scanning: keine Code-Scanning-Regel auf main/);
    });
  });

  test("Ohne Spiegel reicht ein Required-Check", () => {
    const { rulesetSpiegel: _weg, ...ohne } = CONFIG;
    void _weg;
    assert.equal(lauf({}, { config: ohne }).code, 0);
    assert.equal(lauf({ "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100": [] }, { config: ohne }).code, 1);
  });

  test("unlesbares scripts/ (kernEnvNamen wirft): Exit 2 mit Meldung und Fix, ohne gh-Aufruf", () => {
    const r = lauf({}, { kernEnv: () => { throw new Error("EACCES scripts"); } });
    assert.equal(r.code, 2);
    assert.match(r.err.join("\n"), /Kern-Umgebungsvariablen nicht lesbar: EACCES scripts[\s\S]*Fix:/);
    assert.equal(r.aufrufe.length, 0);
  });
  test("Aufruf- und Config-Fehler: Exit 2 ohne einen gh-Aufruf", () => {
    const kaputt = lauf({}, { argv: ["--pruefen", "--config", "/gibt/es/nicht.json"] });
    assert.equal(kaputt.code, 2);
    assert.match(kaputt.err.join("\n"), /Fix:/);
    assert.doesNotMatch(kaputt.err.join("\n"), /Ruleset-Spiegel/);
    assert.equal(kaputt.aufrufe.length, 0);
    const ungueltig = lauf({}, { config: { version: 2 } });
    assert.equal(ungueltig.code, 2);
    assert.equal(ungueltig.aufrufe.length, 0);
    const keinSpiegel = lauf({}, { config: { ...CONFIG, rulesetSpiegel: "fehlt.json" } });
    assert.equal(keinSpiegel.code, 2);
    assert.equal(keinSpiegel.aufrufe.length, 0);
    assert.match(keinSpiegel.err.join("\n"), /Fix: Ruleset-Spiegel/);
    const leer = lauf({}, { spiegel: { name: "x", requiredChecks: [], bypassActors: [] } });
    assert.equal(leer.code, 2);
    assert.equal(leer.aufrufe.length, 0);
    for (const argv of [[], ["--config", "x"], ["--pruefen", "--unbekannt"], ["--pruefen", "--config"]]) {
      const r = lauf({}, { argv });
      assert.equal(r.code, 2, argv.join(" "));
      assert.equal(r.aufrufe.length, 0);
    }
  });

  test("CLI-Verdrahtung: unlesbare Config per Prozess ergibt Exit 2 und Fix auf stderr (ohne gh und Langfuse)", () => {
    const root = mkdtempSync(join(tmpdir(), "doctor-cli-"));
    ordner.push(root);
    writeFileSync(join(root, "kaputt.json"), "{ nicht json");
    const r = spawnSync(process.execPath, [SKRIPT, "--pruefen", "--config", join(root, "kaputt.json")], { encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Fix:/);
  });
});

describe("voraussetzungenAus: Pflicht-Checks des Kerns (factory#117)", () => {
  const eintrag = (pfad: string, extra: Record<string, unknown> = {}) => ({ pfad, ring: "kern", quelle: "t", pflichtChecks: ["Kern", "CI"], ...extra });
  const ab = (besitz: unknown, spiegel: unknown = { requiredChecks: ["CI", "Audit"] }, dateien = ["k.yml"]) =>
    doctor.voraussetzungenAus({ config: {}, workflows: dateien.map((pfad) => ({ pfad, text: "" })), spiegel, besitz });
  const wert = (...eintraege: unknown[]) => ({ wert: { version: 1, eintraege } });

  test("Vereinigung ohne Doppelte, Spiegel zuerst; der Pfad mit Ordner passt auf den Basisnamen", () => {
    const v = ab(wert(eintrag(".github/workflows/k.yml")));
    assert.deepEqual(v.pflichtChecks, ["CI", "Audit", "Kern"]);
    assert.equal(v.besitzFehler, null);
  });
  test("zählt nicht: Datei nicht im Repo, Ring oberflaeche, Eintrag ohne pflichtChecks", () => {
    const v = ab(wert(eintrag(".github/workflows/fehlt.yml"), eintrag(".github/workflows/k.yml", { ring: "oberflaeche" }), eintrag(".github/workflows/k.yml", { pflichtChecks: undefined })));
    assert.deepEqual(v.pflichtChecks, ["CI", "Audit"]);
    assert.equal(v.besitzFehler, null);
  });
  test("ohne Spiegel: nur die Kern-Checks", () => {
    assert.deepEqual(ab(wert(eintrag(".github/workflows/k.yml")), null).pflichtChecks, ["Kern", "CI"]);
  });
  test("Manifest nicht lesbar: nur der Spiegel, besitzFehler gesetzt (fail-closed)", () => {
    for (const besitz of [{ fehler: "Datei fehlt" }, undefined, { wert: {} }, { wert: null }, { wert: { eintraege: [null] } }, { wert: { eintraege: ["x", 3] } }, wert(eintrag(".github/workflows/k.yml", { pflichtChecks: [] }))]) {
      const v = ab(besitz);
      assert.deepEqual(v.pflichtChecks, ["CI", "Audit"], JSON.stringify(besitz));
      assert.ok(typeof v.besitzFehler === "string" && v.besitzFehler !== "", JSON.stringify(besitz));
    }
  });
});

describe("voraussetzungenAus", () => {
  const wf = (text: string) => [{ pfad: "a.yml", text }];
  const ab = (text: string) => doctor.voraussetzungenAus({ config: { labels: { harness: "area:werk" } }, workflows: wf(text) });

  test("secrets und vars außer GITHUB_TOKEN", () => {
    const v = ab("a: ${{ secrets.B }} ${{ secrets.GITHUB_TOKEN }} ${{ vars.C }}");
    assert.deepEqual(v.secrets, ["B"]);
    assert.deepEqual(v.variablen, ["C"]);
  });

  test("Label-Literale: Flag mit und ohne Anführungszeichen, Env-Schlüssel; Variablen und Ausdrücke nicht; Dedup ohne Groß-/Kleinschreibung", () => {
    const v = ab('run: gh x --label forum --add-label "Area:Werk" --label "$VAR" --label \'a:b,c:d,\' --label=eq:wert\nenv:\n  ALARM_LABEL: "area:neu"\n  INBOX_LABEL: ${{ x.y }}\n  OTHER: nein\n');
    assert.deepEqual([...v.labels].sort(), ["area:werk", "a:b", "area:neu", "c:d", "eq:wert", "forum"].sort());
  });
});

describe("harness-doctor --pruefen: die acht Sicherheitspunkte (factory#116)", () => {
  const PUNKTE = ["Secret Scanning", "Push Protection", "Non-Provider-Patterns", "Validity Checks", "PVR", "Dependabot Security Updates", "Code-Scanning", "SHA-Pinning"];
  const REGELN = "api --paginate --slurp repos/acme/demo/rules/branches/main?per_page=100";
  const AUS = { security_and_analysis: Object.fromEntries(Object.keys(SICHER.security_and_analysis).map((k) => [k, { status: "disabled" }])) };
  const alleAus = {
    "api repos/acme/demo": { ...REPO_OK, ...AUS },
    "api repos/acme/demo/actions/permissions": { enabled: true, allowed_actions: "all", sha_pinning_required: false },
    "api repos/acme/demo/private-vulnerability-reporting": { enabled: false },
    [REGELN]: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "CI" }, { context: "Audit" }] } }],
  };
  const welten: [string, Record<string, unknown>][] = [
    ["gesund", {}],
    ["alles kaputt", alleAus],
    ["Token fatal", { "api -i user": new Error("gh auth login") }],
    ["Repo nicht lesbar", { "api repos/acme/demo": new Error("HTTP 403") }],
  ];
  test.each(welten)("%s: jeder Punkt genau eine Zeile OK, LÜCKE oder NICHT PRÜFBAR mit Fix", (_, over) => {
    const r = lauf(over);
    for (const p of PUNKTE) {
      const z = r.out.filter((x) => new RegExp(`^(?:OK|LÜCKE|NICHT PRÜFBAR) ${p}(?::|$)`).test(x));
      assert.equal(z.length, 1, p);
      assert.match(z[0], new RegExp(`^(?:OK ${p}|LÜCKE ${p}: .+ Fix: .+|NICHT PRÜFBAR ${p}: .+ Fix: .+)$`));
    }
  });

  test("alles kaputt: Lücken statt nicht prüfbar, Summenzeile zählt getrennt", () => {
    const r = lauf(alleAus);
    assert.equal(r.code, 1);
    for (const p of PUNKTE) assert.ok(r.out.some((z) => z.startsWith(`LÜCKE ${p}: `)), p);
    assert.deepEqual(r.out.filter((z) => z.startsWith("Harness-Doctor:")), ["Harness-Doctor: 8 Lücke(n), 0 nicht prüfbar"]);
  });

  test("nur ein nicht prüfbarer Punkt: Exit 1, Summe 0 Lücke(n), 1 nicht prüfbar", () => {
    const r = lauf({ "api repos/acme/demo/private-vulnerability-reporting": new Error("HTTP 404: Not Found") });
    assert.equal(r.code, 1);
    assert.deepEqual(r.out.filter((z) => z.startsWith("NICHT PRÜFBAR")), [r.out.find((z) => z.startsWith("NICHT PRÜFBAR PVR: ")) as string]);
    assert.match(r.out.find((z) => z.startsWith("NICHT PRÜFBAR PVR: ")) as string, /HTTP 404.*Fix: /);
    assert.equal(luecken(r).length, 0);
    assert.deepEqual(r.out.filter((z) => z.startsWith("Harness-Doctor:")), ["Harness-Doctor: 0 Lücke(n), 1 nicht prüfbar"]);
  });

  test("gemischt: zwei Lücken und ein nicht prüfbarer Punkt", () => {
    const r = lauf({
      "api repos/acme/demo/actions/permissions": { enabled: true, allowed_actions: "all", sha_pinning_required: false },
      "api repos/acme/demo/private-vulnerability-reporting": { enabled: false },
      "api repos/acme/demo": { ...REPO_OK, security_and_analysis: { ...SICHER.security_and_analysis, secret_scanning_validity_checks: undefined } },
    });
    assert.deepEqual(r.out.filter((z) => z.startsWith("Harness-Doctor:")), ["Harness-Doctor: 2 Lücke(n), 1 nicht prüfbar"]);
    assert.ok(r.out.some((z) => z.startsWith("NICHT PRÜFBAR Validity Checks: ")));
  });

  test("Repo 403 ohne Admin-Recht: fünf Punkte nicht prüfbar, nie OK", () => {
    const r = lauf({ "api repos/acme/demo": new Error("HTTP 403") });
    for (const p of ["Secret Scanning", "Push Protection", "Non-Provider-Patterns", "Validity Checks", "Dependabot Security Updates"]) {
      assert.ok(r.out.some((z) => z.startsWith(`NICHT PRÜFBAR ${p}: `) && z.includes("HTTP 403")), p);
      assert.ok(!r.out.includes(`OK ${p}`), p);
    }
  });

  test(`Token fatal: alle ${SICHERHEIT_PUNKTE.length} Punkte nicht prüfbar mit dem Token-Fix, Exit 1`, () => {
    assert.deepEqual(PUNKTE, SICHERHEIT_PUNKTE);
    const r = lauf({ "api -i user": new Error("gh auth login") });
    assert.equal(r.code, 1);
    for (const p of PUNKTE) assert.ok(r.out.some((z) => z.startsWith(`NICHT PRÜFBAR ${p}: `) && z.endsWith("Fix: erst den Token-Punkt beheben")), p);
    assert.deepEqual(r.aufrufe, ["api -i user"]);
  });
});

describe("Dateipunkte (factory#94): der Doctor prüft die Projektdateien des Beziehers", () => {
  const dateien = rawDateien as (a: { rootDir: string }) => unknown[];
  /** Ein Git-Repo mit LF-Regel und einer LF-Datei im Index: die gesunde Welt der Dateipunkte; `extra` legt weitere Dateien an. */
  const repo = (extra: Record<string, string> = {}, regel = "* text=auto eol=lf\n") => (root: string) => {
    writeFileSync(join(root, ".gitattributes"), regel);
    writeFileSync(join(root, "AGENTS.md"), "regeln\n");
    for (const [rel, text] of Object.entries(extra)) writeFileSync(join(root, rel), text);
    const g = (...a: string[]) => execFileSync("git", ["-C", root, "-c", "core.autocrlf=false", ...a], { encoding: "utf8" });
    g("init", "-q");
    g("add", "-A");
  };
  const mitClaude = (root: string) => {
    repo()(root);
    writeFileSync(join(root, "CLAUDE.md"), "x\n");
  };

  test("gesund: beide Punkte OK, Exit 0", () => {
    const r = lauf({}, { dateien, vorbereiten: repo() });
    assert.ok(r.out.includes("OK Root-Kontextdatei"), r.out.join("\n"));
    assert.ok(r.out.includes("OK Zeilenenden"));
    assert.equal(r.code, 0);
  });

  test("Negativfall: eine CLAUDE.md im Root des Beziehers macht den Punkt rot, Exit 0 wird 1", () => {
    const r = lauf({}, { dateien, vorbereiten: mitClaude });
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => z.startsWith("LÜCKE Root-Kontextdatei: CLAUDE.md ") && z.includes("Fix: ")), r.out.join("\n"));
    assert.ok(r.out.includes("OK Zeilenenden"));
  });

  test("Negativfall: eine CRLF-Datei im Index (die Regel `* -text` normalisiert nicht) macht Zeilenenden rot", () => {
    const r = lauf({}, { dateien, vorbereiten: repo({ "alt.md": "a\r\nb\r\n" }, "* -text\n") });
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => z.startsWith("LÜCKE Zeilenenden: ") && z.includes("alt.md")), r.out.join("\n"));
  });

  test("Default-Verdrahtung: main ohne eingespritzte Dateipunkte liefert beide Punkte aus dem echten Beziehers-Ordner", () => {
    const r = lauf({}, { dateien: "echt", vorbereiten: mitClaude });
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => z.startsWith("LÜCKE Root-Kontextdatei: CLAUDE.md ")), r.out.join(String.fromCharCode(10)));
    assert.ok(r.out.includes("OK Zeilenenden"), r.out.join(String.fromCharCode(10)));
  });

  test("Negativfall ohne geprüfte Projektdatei: ohne AGENTS.md im Root ist Root-Kontextdatei NICHT PRÜFBAR statt leer grün, Exit 1", () => {
    const ohneAgents = (root: string) => {
      repo({ "notiz.md": "x\n" })(root);
      const g = (...a: string[]) => execFileSync("git", ["-C", root, "-c", "core.autocrlf=false", ...a], { encoding: "utf8" });
      g("rm", "-q", "-f", "AGENTS.md");
    };
    const r = lauf({}, { dateien: "echt", vorbereiten: ohneAgents });
    assert.equal(r.code, 1);
    assert.ok(r.out.some((z) => z.startsWith("NICHT PRÜFBAR Root-Kontextdatei: ") && z.includes("AGENTS.md") && z.includes("Fix: ")), r.out.join(String.fromCharCode(10)));
    assert.ok(!r.out.includes("OK Root-Kontextdatei"));
    assert.ok(r.out.includes("OK Zeilenenden"), r.out.join(String.fromCharCode(10)));
  });

  test("ohne Git-Repo: NICHT PRÜFBAR statt grün", () => {
    const r = lauf({}, { dateien });
    assert.ok(r.out.some((z) => z.startsWith("NICHT PRÜFBAR Zeilenenden: ")), r.out.join("\n"));
    assert.equal(r.code, 1);
  });

  test("--einrichten gibt keine Dateipunkte aus", () => {
    const r = lauf({}, { dateien, argv: ["--einrichten", "--dry-run", "--config", "<config>"], vorbereiten: mitClaude });
    assert.ok(!r.out.some((z) => z.includes("Root-Kontextdatei") || z.includes("Zeilenenden")), r.out.join("\n"));
  });
});

describe("Prüfwurzel aus --config (factory#127 L27)", () => {
  test("--pruefen --config <bezieher>/.factory/projekt.json prüft die Dateien des Beziehers, nicht das Verzeichnis des Aufrufers", () => {
    const r = lauf({}, { fremderRoot: true, argv: ["--pruefen", "--config", "<factory-config>"] });
    assert.ok(r.out.some((z) => z.startsWith("Prüfwurzel: ") && z.includes("doctor-") && !z.includes("doctor-fremd-")), r.out.join(String.fromCharCode(10)));
    assert.equal(r.code, 0, r.out.join(String.fromCharCode(10)));
  });

  test("eine Config außerhalb von .factory behält die Wurzel des Aufrufers (keine Prüfwurzel-Zeile)", () => {
    const r = lauf({}, { fremderRoot: true });
    assert.ok(!r.out.some((z) => z.startsWith("Prüfwurzel: ")), r.out.join(String.fromCharCode(10)));
  });

  test("ohne --config bleibt die Wurzel des Aufrufers: Standard-Config dort, keine Prüfwurzel-Zeile", () => {
    const r = lauf({}, { argv: ["--pruefen"] });
    assert.ok(!r.out.some((z) => z.startsWith("Prüfwurzel: ")), r.out.join(String.fromCharCode(10)));
    assert.equal(r.code, 0, r.err.join(String.fromCharCode(10)) + r.out.join(String.fromCharCode(10)));
  });

  test("--einrichten leitet keine Prüfwurzel ab", () => {
    const r = lauf({}, { fremderRoot: true, argv: ["--einrichten", "--dry-run", "--config", "<factory-config>"] });
    assert.ok(!r.out.some((z) => z.startsWith("Prüfwurzel: ")), r.out.join(String.fromCharCode(10)));
  });
});
