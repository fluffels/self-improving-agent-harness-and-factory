/* Harness-Doctor, Dateipunkte (factory#94): `pruefeDateien` mit injizierten `git` und `existiert`, dazu eine echte Git-Fixture.
 * Jeder Test verfälscht genau eine Quelle und erwartet genau diesen Punkt; kein Fehlschlag von Git darf OK ergeben. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { DATEI_PUNKTE as rawDateiPunkte, gitStandard as rawGitStandard, LF_BEISPIELE as rawBeispiele, pfadeOhneEolRegel as rawOhneRegel, PROJEKTDATEIEN as rawProjektdateien, pruefeDateien as rawPruefe, requiredCheckQuellenPunkt as rawQuellenPunkt, codeScanningQuellenPunkt as rawCsPunkt } from "../scripts/harness-doctor-dateien.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { blockformAusloeser as rawBlockformAusloeser } from "../scripts/workflow-blockform.mjs";
import { BEZIEHER_NPM_SKRIPTE } from "./support/bezieher-npm-skripte";
import { fixture } from "./support/tmp-fixture";

const rawAusloeser = rawBlockformAusloeser as (text: string) => { ausloeser: string[] };

interface Workflow { pfad: string; text: string }
interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string }
type Git = (args: string[], input?: string) => string;
const pruefe = rawPruefe as (e: { rootDir: string; git?: Git; existiert?: (p: string) => boolean; lies?: (p: string) => string | null; config?: unknown; spiegel?: unknown; workflows?: Workflow[]; pflichtChecks?: string[]; vorAbbruch?: boolean }) => Ergebnis[];
const DATEI_PUNKTE = rawDateiPunkte as readonly string[];
const quellenPunkt = rawQuellenPunkt as (e: { spiegel?: unknown; workflows?: Workflow[]; pflichtChecks?: string[]; vorAbbruch?: boolean }) => Ergebnis;
const csPunkt = rawCsPunkt as (e: { spiegel?: unknown; workflows?: Workflow[]; vorAbbruch?: boolean }) => Ergebnis;
const pfadeOhneEolRegel = rawOhneRegel as (z: string) => string[];
const BEISPIELE = rawBeispiele as string[];
const PROJEKTDATEIEN = rawProjektdateien as { pfad: string; fix?: string }[];
const gitStandard = rawGitStandard as (rootDir: string) => Git;

/** Eine Datei der Fake-Welt: Pfad, Index-Zeilenende (`lf`, `crlf`, `mixed`, `-text`, `none`), Wert von `eol`, Attribut-Text von ls-files. */
interface Datei { pfad: string; index?: string; eol?: string; attr?: string }
const lf = (pfad: string): Datei => ({ pfad, eol: "lf" });

/** Fake-Git: `ls-files --eol` und `check-attr --stdin -z eol` aus einer Dateiliste; Pfade ohne Eintrag (die Beispiele) haben `eol` aus `beispielEol`. */
function fakeGit(dateien: Datei[], beispielEol = "lf"): Git {
  return (args, input) => {
    if (args[0] === "ls-files") return dateien.map((d) => `i/${d.index ?? "lf"}    w/lf    attr/${d.attr ?? ""} \t${d.pfad}`).join("\n");
    if (args[0] === "check-attr") {
      const werte = new Map(dateien.map((d) => [d.pfad, d.eol ?? "unspecified"]));
      return (input ?? "").split("\0").filter(Boolean).flatMap((p) => [p, "eol", werte.get(p) ?? beispielEol]).concat([""]).join("\0");
    }
    throw new Error(`unerwarteter Git-Aufruf: ${args.join(" ")}`);
  };
}
const TAKT_DATEIEN = [".github/workflows/board-takt.yml", "scripts/langfuse-takt.mjs"];
const gesund = [lf("AGENTS.md"), lf(".claude/agents/a.md"), lf(".agents/skills/x/SKILL.md"), lf("docs/a.md")];
/** Gesunde Quellen für `Required-Check-Quellen`: ein Kontext mit genau einer Quelle. */
const GESUND = { spiegel: { requiredChecks: ["Beispiel Check"] }, workflows: [{ pfad: "ci.yml", text: "jobs:\n  a:\n    name: Beispiel Check\n" }], pflichtChecks: ["Beispiel Check"] };
const lauf = (dateien: Datei[], opt: { existiert?: (p: string) => boolean; beispielEol?: string } = {}) =>
  pruefe({ rootDir: "/x", ...GESUND, git: fakeGit(dateien, opt.beispielEol), existiert: (p) => (opt.existiert ?? (() => false))(p) || p.replaceAll("\\", "/") === "/x/AGENTS.md" || PROJEKTDATEIEN.some((d) => p.replaceAll("\\", "/") === `/x/${d.pfad}`) || TAKT_DATEIEN.some((d) => p.replaceAll("\\", "/") === `/x/${d}`) });
const punkt = (e: Ergebnis[], name: string) => e.find((p) => p.punkt === name)!;

describe("Root-Kontextdatei", () => {
  test("ohne blockierende Datei: OK, und alle Punkte der Liste stehen immer da", () => {
    const e = lauf(gesund);
    expect(e.map((p) => p.punkt)).toEqual([...DATEI_PUNKTE]);
    expect(e.every((p) => p.ok)).toBe(true);
  });

  test.each(["CLAUDE.md", ".claude/CLAUDE.md", "CLAUDE.local.md"])("%s im Root ist eine Lücke mit Fix", (rel) => {
    const p = punkt(lauf(gesund, { existiert: (pfad) => pfad.replaceAll("\\", "/") === `/x/${rel}` }), "Root-Kontextdatei");
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain(rel);
    expect(p.fix).toContain("AGENTS.md");
  });

  test("ohne AGENTS.md im Root: NICHT PRÜFBAR mit Grund und Fix statt leer grün, Zeilenenden bleibt bewertet", () => {
    const e = pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert: () => false });
    expect(punkt(e, "Root-Kontextdatei")).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(punkt(e, "Root-Kontextdatei").befund).toContain("AGENTS.md");
    expect(punkt(e, "Root-Kontextdatei").fix).toBeTruthy();
    expect(punkt(e, "Zeilenenden").ok).toBe(true);
  });

  test("eine CLAUDE.md ohne AGENTS.md bleibt eine Lücke (kein NICHT PRÜFBAR)", () => {
    const p = punkt(pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert: (pfad) => pfad.replaceAll("\\", "/") === "/x/CLAUDE.md" }), "Root-Kontextdatei");
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
  });

  test("src/CLAUDE.md im Unterordner trifft nicht", () => {
    expect(punkt(lauf(gesund, { existiert: (pfad) => pfad.replaceAll("\\", "/") === "/x/src/CLAUDE.md" }), "Root-Kontextdatei").ok).toBe(true);
  });
});

describe("Zeilenenden", () => {
  test(".claude/x.md mit eol=crlf ist eine Lücke, tools/a.bat mit eol=crlf nicht", () => {
    const schlecht = punkt(lauf([...gesund, { pfad: ".claude/x.md", eol: "crlf" }]), "Zeilenenden");
    expect(schlecht.ok).toBe(false);
    expect(schlecht.befund).toContain(".claude/x.md");
    expect(schlecht.fix).toContain("eol=lf");
    expect(punkt(lauf([...gesund, { pfad: "tools/a.bat", eol: "crlf" }]), "Zeilenenden").ok).toBe(true);
  });

  test(".agents/x.md mit eol=crlf ist eine Lücke (streng), ein verschachteltes test/.claude/a.bat mit crlf nicht", () => {
    const schlecht = punkt(lauf([...gesund, { pfad: ".agents/x.md", eol: "crlf" }]), "Zeilenenden");
    expect(schlecht.ok).toBe(false);
    expect(schlecht.befund).toContain(".agents/x.md");
    expect(punkt(lauf([...gesund, { pfad: "test/.claude/a.bat", eol: "crlf" }]), "Zeilenenden").ok).toBe(true);
  });

  test("docs/a.md ohne eol-Regel (unspecified) ist eine Lücke, `-text` im Attribut und Index nicht", () => {
    const schlecht = punkt(lauf([...gesund, { pfad: "docs/b.md", eol: "unspecified" }]), "Zeilenenden");
    expect(schlecht.ok).toBe(false);
    expect(schlecht.befund).toContain("docs/b.md");
    expect(punkt(lauf([...gesund, { pfad: "bild.png", index: "-text", eol: "unspecified" }]), "Zeilenenden").ok).toBe(true);
    expect(punkt(lauf([...gesund, { pfad: "x.bin", attr: "-text", eol: "unspecified" }]), "Zeilenenden").ok).toBe(true);
    expect(punkt(lauf([...gesund, { pfad: "leer.txt", index: "none", eol: "unspecified" }]), "Zeilenenden").ok).toBe(true);
  });

  test("ein Beispielpfad ohne eol=lf ist eine Lücke (neue Hooks, Skills und Agenten sind mit abgedeckt)", () => {
    expect(BEISPIELE.length).toBeGreaterThan(0);
    const schlecht = punkt(lauf(gesund, { beispielEol: "unspecified" }), "Zeilenenden");
    expect(schlecht.ok).toBe(false);
    expect(schlecht.befund).toContain(BEISPIELE[0]);
  });

  test("CRLF und gemischt im Index sind Lücken, auch bei gesetzter eol-Regel", () => {
    for (const index of ["crlf", "mixed"]) {
      const p = punkt(lauf([...gesund, { pfad: "docs/c.md", index, eol: "lf" }]), "Zeilenenden");
      expect(p.ok, index).toBe(false);
      expect(p.befund).toContain("docs/c.md");
    }
  });

  test("leerer Index: NICHT PRÜFBAR statt grün, Root-Kontextdatei bleibt bewertet", () => {
    const e = lauf([], { existiert: (pfad) => pfad.replaceAll("\\", "/") === "/x/CLAUDE.md" });
    expect(punkt(e, "Zeilenenden")).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(punkt(e, "Root-Kontextdatei").ok).toBe(false);
  });

  test("wirft git: NICHT PRÜFBAR mit Grund und Fix, Root-Kontextdatei bleibt bewertet", () => {
    const e = pruefe({ rootDir: "/x", git: () => { throw new Error("fatal: not a git repository"); }, existiert: (p) => p.replaceAll("\\", "/") === "/x/AGENTS.md" });
    expect(punkt(e, "Zeilenenden")).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(punkt(e, "Zeilenenden").befund).toContain("not a git repository");
    expect(punkt(e, "Zeilenenden").fix).toBeTruthy();
    expect(punkt(e, "Root-Kontextdatei").ok).toBe(true);
  });

  test("check-attr scheitert bei leerer Ausgabe: NICHT PRÜFBAR statt still grün (Status-Guard)", () => {
    const ok = fakeGit(gesund);
    const e = pruefe({ rootDir: "/x", git: (args, input) => (args[0] === "check-attr" ? (() => { throw new Error("git check-attr endete mit 128"); })() : ok(args, input)), existiert: () => false });
    expect(punkt(e, "Zeilenenden")).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(punkt(e, "Zeilenenden").befund).toContain("check-attr");
  });

  test("Kürzung: höchstens 5 Pfade, dann (+n weitere)", () => {
    const viele = Array.from({ length: 8 }, (_, i) => ({ pfad: `docs/v${i}.md`, eol: "unspecified" }));
    const befund = punkt(lauf([...gesund, ...viele]), "Zeilenenden").befund ?? "";
    expect(befund).toContain("docs/v4.md");
    expect(befund).not.toContain("docs/v5.md");
    expect(befund).toContain("(+3 weitere)");
  });

  test("Kürzung: genau 5 Pfade stehen ohne Zusatz", () => {
    const funf = Array.from({ length: 5 }, (_, i) => ({ pfad: `docs/v${i}.md`, eol: "unspecified" }));
    const befund = punkt(lauf([...gesund, ...funf]), "Zeilenenden").befund ?? "";
    expect(befund).toContain("docs/v4.md");
    expect(befund).not.toContain("weitere");
  });

  test("pfadeOhneEolRegel: lf und crlf zählen als Regel, alles andere nicht", () => {
    const aus = ["a", "eol", "lf", "b", "eol", "crlf", "c", "eol", "unspecified", "d", "eol", "auto", ""].join("\0");
    expect(pfadeOhneEolRegel(aus)).toEqual(["c", "d"]);
  });
});

describe("echte Git-Fixture (Negativfall auf Dateiebene)", () => {
  function repo(gitattributes: string, dateien: Record<string, string>): string {
    const root = fixture({ ".gitattributes": gitattributes, ...dateien });
    const g = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "core.autocrlf=false", ...args], { encoding: "utf8" });
    g("init", "-q");
    g("add", "-A");
    return root;
  }
  const kurzeProbe = (root: string) => punkt(pruefe({ rootDir: root }), "Zeilenenden");

  test("`* -text` mit CRLF-Datei ist eine Lücke, `* text=auto eol=lf` mit LF-Datei ist OK", () => {
    const schlecht = kurzeProbe(repo("* -text\n", { "a.md": "x\r\ny\r\n" }));
    expect(schlecht.ok).toBe(false);
    expect(schlecht.befund).toContain("CRLF");
    const gut = kurzeProbe(repo("* text=auto eol=lf\n", { "a.md": "x\ny\n", ".claude/agents/a.md": "x\n" }));
    expect(gut).toMatchObject({ punkt: "Zeilenenden", ok: true });
  });

  test("gitStandard wirft bei Exit ungleich 0, auch wenn stdout leer bleibt (kein stilles Grün)", () => {
    const root = fixture({ "a.md": "x" + String.fromCharCode(10) });
    expect(() => gitStandard(root)(["gibt-es-nicht"])).toThrow();
  });

  test("ein Ordner ohne Git-Repo ist NICHT PRÜFBAR", () => {
    const root = fixture({ "a.md": "x\n" });
    // Das tmp-Verzeichnis liegt unter keinem Repo (git wirft); läge es in einem, ist der Index dieses Ordners leer: beides ist nicht prüfbar.
    const p = kurzeProbe(root);
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBe(true);
  });
});

describe("Projektdateien (factory#170)", () => {
  const ohne = (...fehlend: string[]) => (p: string) => !fehlend.some((f) => p.replaceAll("\\", "/") === `/x/${f}`);
  const projektPunkt = (existiert: (p: string) => boolean) => punkt(pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert }), "Projektdateien");

  test("alles vorhanden: OK", () => {
    expect(projektPunkt(() => true)).toMatchObject({ punkt: "Projektdateien", ok: true });
  });
  test("zwei fehlen: LÜCKE mit beiden Pfaden und genau einem Standard-Fix ohne Zusatz", () => {
    const p = projektPunkt(ohne("tsconfig.json", "vite.config.ts"));
    expect(p.ok).toBe(false);
    expect(p.befund).toBe("fehlen 2: tsconfig.json, vite.config.ts");
    expect(p.fix).toContain("Vorlage aus der Quelle");
    expect(p.fix).not.toContain("tsconfig.json: ");
    expect(p.fix?.match(/Vorlage aus der Quelle/g)).toHaveLength(1);
  });
  test("nur AGENTS.md fehlt: der Fix nennt die vier Marker-Zeilen", () => {
    const p = projektPunkt(ohne("AGENTS.md"));
    for (const m of ["<!-- factory-besitz:start kern -->", "<!-- factory-besitz:ende kern -->", "<!-- factory-projekt:start -->", "<!-- factory-projekt:ende -->"]) expect(p.fix).toContain(m);
  });
  test("alles fehlt: jeder Fix bleibt sichtbar, nichts wird gekürzt", () => {
    const p = projektPunkt(() => false);
    expect(p.befund).toContain(`fehlen ${PROJEKTDATEIEN.length}:`);
    for (const d of PROJEKTDATEIEN.filter((x) => x.fix)) expect(p.fix).toContain(`${d.pfad}: ${d.fix}`);
    expect(p.befund).not.toContain("weitere");
  });
  test("eine leere Datei zählt als vorhanden (echtes Dateisystem, nur der Pfad wird geprüft)", () => {
    const root = mkdtempSync(join(tmpdir(), "pd-"));
    try {
      for (const d of PROJEKTDATEIEN) {
        mkdirSync(dirname(join(root, d.pfad)), { recursive: true });
        writeFileSync(join(root, d.pfad), "");
      }
      expect(punkt(pruefe({ rootDir: root, git: fakeGit(gesund) }), "Projektdateien").ok).toBe(true);
      rmSync(join(root, "tsconfig.json"));
      expect(punkt(pruefe({ rootDir: root, git: fakeGit(gesund) }), "Projektdateien").befund).toBe("fehlen 1: tsconfig.json");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  test("Sonder-Fixes: Ticket-Skill nennt skills:sync, eslint-suppressions lint:prune", () => {
    const p = projektPunkt(() => false);
    expect(p.fix).toContain("npm run skills:sync");
    expect(p.fix).toContain("npx eslint . --prune-suppressions");
  });
});

describe("Langfuse-Takt", () => {
  const takt = (existiert: (p: string) => boolean, config?: unknown) => punkt(pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert, config }), "Langfuse-Takt");
  const norm = (p: string) => p.replaceAll("\\", "/");
  const ohneDatei = (fehlend: string) => (p: string) => norm(p) !== `/x/${fehlend}`;

  test("beide Dateien vorhanden: OK, ohne Hinweis bei eigenem Board", () => {
    const eigen = { repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory" }] };
    expect(takt(() => true, eigen)).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });

  test.each(TAKT_DATEIEN)("fehlt %s: Lücke mit Fix auf den Sync (Ring kern-nach-entkopplung)", (datei) => {
    const p = takt(ohneDatei(datei));
    expect(p.ok).toBe(false);
    expect(p.befund).toContain(datei);
    expect(p.fix).toContain("factory-sync.mjs");
    expect(p.fix).toContain("kern-nach-entkopplung");
  });

  test("ein Nulleintrag in boards und eine Config ohne Factory-Board brechen den Punkt nicht", () => {
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: [null, { rolle: "factory", repo: "c/d" }] }).ok).toBe(true);
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: [null, { rolle: "factory", repo: "c/d" }] })).toHaveProperty("hinweis");
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "produkt" }] })).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });

  test("das Factory-Board des eigenen Repos (auch in anderer Schreibweise) gibt keinen Hinweis", () => {
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "a/b" }] })).toEqual({ punkt: "Langfuse-Takt", ok: true });
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "A/B" }] })).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });

  test("eine Config ohne boards oder mit boards ohne Liste bricht den Punkt nicht und gibt keinen Hinweis", () => {
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" } })).toEqual({ punkt: "Langfuse-Takt", ok: true });
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: "x" })).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });

  test("factory#202 L21: ohne bestimmbares Ziel (kein labels.harness) ist der Punkt eine Lücke mit Fix auf die Config; mit Label und ohne Factory-Board ist das eigene Repo das Ziel", () => {
    const p = takt(() => true, { repo: "a/b", boards: [{ rolle: "factory", repo: "c/d" }] });
    expect(p.ok).toBe(false);
    expect(p.befund).toContain("Ziel");
    expect(p.fix).toContain("Board mit Rolle factory");
    expect(takt(() => true, { labels: { harness: "h" }, boards: [] }).ok).toBe(false); // kein Repo: kein Ziel
    expect(takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "produkt" }] })).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });

  test("factory#202 L21: die Zielbestimmung folgt dem Takt (zielRepoFuer des Harness-Labels), nicht der bloßen Rolle factory", () => {
    // Das Board der Rolle factory führt c/d, also ist c/d das Ziel; ein Produkt-Board mit fremdem Repo ändert daran nichts.
    const p = takt(() => true, { repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "produkt", repo: "x/y" }, { rolle: "factory", repo: "c/d" }] }) as Ergebnis & { hinweis?: string };
    expect(p.hinweis).toContain("c/d");
    expect(p.hinweis).not.toContain("x/y");
  });

  test("Factory-Board führt ein fremdes Repo: OK mit Hinweis, der Takt dort pflegt Status- und Sammelticket", () => {
    const fremd = { repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "c/d" }] };
    const p = takt(() => true, fremd) as Ergebnis & { hinweis?: string };
    expect(p.ok).toBe(true);
    expect(p.hinweis).toContain("c/d");
  });
});

describe("Langfuse-Takt: Config aus dem Root (Standard ohne injizierte Config)", () => {
  const alles = () => true;
  const lies = (root: string) => punkt(pruefe({ rootDir: root, git: fakeGit(gesund), existiert: alles }), "Langfuse-Takt") as Ergebnis & { hinweis?: string };

  test("die .factory/projekt.json des Roots wird gelesen: ein fremdes Factory-Board ergibt den Hinweis", () => {
    const root = fixture({ ".factory/projekt.json": JSON.stringify({ repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "c/d" }] }) });
    expect(lies(root).hinweis).toContain("c/d");
  });

  test("factory#195: im Bezieher (Sync-Stand vorhanden) nennt der Hinweis das Status-Ticket im eigenen Repo; Upstream behält den bisherigen Text", () => {
    const projekt = { ".factory/projekt.json": JSON.stringify({ repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "c/d" }, { rolle: "produkt" }] }) };
    const bezieher = lies(fixture({ ...projekt, ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1", repo: "f/q" } }) }));
    expect(bezieher.hinweis).toContain("legt das Status-Ticket „Langfuse-Status überprüfen“ im eigenen Repo an und holt dort das Langfuse-Sammelticket");
    expect(bezieher.hinweis).toContain("c/d");
    const eigenes = lies(fixture({ ".factory/projekt.json": JSON.stringify({ repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "a/b" }] }), ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1", repo: "f/q" } }) }));
    expect(eigenes).toEqual({ punkt: "Langfuse-Takt", ok: true }); // Factory-Board im eigenen Repo: kein Hinweis, auch im Bezieher
    const upstream = lies(fixture(projekt));
    expect(upstream.hinweis).toContain("dort pflegt der Takt Status-Ticket, Harness- und Langfuse-Sammelticket, hier läuft nur der Board-Wächter");
    expect(upstream.hinweis).not.toContain("im eigenen Repo");
  });

  test("factory#202 L21: im Bezieher ohne Board für das eigene Repo ist der Punkt eine Lücke (der Takt legt dort kein Status-Ticket an); Upstream bleibt OK", () => {
    const config = { ".factory/projekt.json": JSON.stringify({ repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "c/d" }] }) };
    const bezieher = lies(fixture({ ...config, ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1", repo: "f/q" } }) }));
    expect(bezieher.ok).toBe(false);
    expect(bezieher.befund).toContain("Kein Board der Config führt das eigene Repo a/b");
    expect(bezieher.fix).toContain("boards");
    expect(lies(fixture(config)).ok).toBe(true);
    expect(bezieher.befund).not.toContain("\n"); // nur die Befundzeile von langfuseZiel, der Fix steht getrennt
  });

  test("factory#202 L21: im Bezieher bleiben fehlende, kaputte oder nicht-objekthafte Config OK ohne Hinweis; Nulleinträge in boards werfen keinen TypeError", () => {
    const stand = { ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1", repo: "f/q" } }) };
    expect(lies(fixture({ ...stand }))).toEqual({ punkt: "Langfuse-Takt", ok: true });
    expect(lies(fixture({ ...stand, ".factory/projekt.json": "{kaputt" }))).toEqual({ punkt: "Langfuse-Takt", ok: true });
    expect(lies(fixture({ ...stand, ".factory/projekt.json": "42" }))).toEqual({ punkt: "Langfuse-Takt", ok: true });
    const mitNull = lies(fixture({ ...stand, ".factory/projekt.json": JSON.stringify({ repo: "a/b", labels: { harness: "h" }, boards: [null, { rolle: "factory", repo: "c/d" }, { rolle: "produkt" }] }) }));
    expect(mitNull.ok).toBe(true);
  });

  test("ohne oder mit kaputter Config: OK ohne Hinweis, kein Absturz", () => {
    expect(lies(fixture({}))).toEqual({ punkt: "Langfuse-Takt", ok: true });
    expect(lies(fixture({ ".factory/projekt.json": "{kaputt" }))).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });
});

describe("factory#162 L44: PROJEKTDATEIEN trägt dieselben Pfade wie die Konstanten der Verbraucher", () => {
  // Der Doctor importiert docs-gen.mjs und check-docdrift.mjs nicht (CLI-Einstiege mit eigener Hülle); darum bindet dieser Test die Pfade an deren Konstanten.
  test("docs-gen-Config und Befehls-Referenz stehen unter genau dem Pfad, den docs-gen und check:docdrift lesen", async () => {
    // @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
    const { DEFAULT_CONFIG } = (await import("../scripts/docs-gen.mjs")) as { DEFAULT_CONFIG: string };
    // @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
    const { CORE_DOCS } = (await import("../scripts/check-docdrift.mjs")) as { CORE_DOCS: string[] };
    const befehle = CORE_DOCS.filter((d) => d.endsWith("referenz/befehle.md"));
    expect(befehle).toHaveLength(1);
    const pfade = PROJEKTDATEIEN.map((d) => d.pfad);
    expect(pfade).toContain(DEFAULT_CONFIG);
    expect(pfade).toContain(befehle[0]);
  });
});

describe("Gezielter Test (factory#208 L23)", () => {
  const gezielt = (config?: unknown) => punkt(pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert: () => true, config }), "Gezielter Test");

  test("Endung außerhalb der JS/TS-Familie ohne befehle.testGezielt: Lücke mit Endung und Fix", () => {
    const p = gezielt({ struktur: { quelle: "src", endungen: [".java", ".ts"] } });
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain(".java");
    expect(p.befund).not.toContain(".ts,");
    expect(p.fix).toContain("befehle.testGezielt");
  });

  test("mit befehle.testGezielt: OK", () => {
    expect(gezielt({ struktur: { quelle: "src", endungen: [".java"] }, befehle: { testGezielt: "mvn -q test -Dtest=" } })).toEqual({ punkt: "Gezielter Test", ok: true });
  });

  test("JS/TS-Endungen, fehlende endungen, fehlende struktur und fehlende Config brauchen keinen Befehl", () => {
    expect(gezielt({ struktur: { quelle: "src", endungen: [".ts", ".mjs", ".cjs", ".js", ".mts", ".cts"] } }).ok).toBe(true);
    expect(gezielt({ struktur: { quelle: "src" } }).ok).toBe(true);
    expect(gezielt({}).ok).toBe(true);
    expect(gezielt(null).ok).toBe(true);
    expect(gezielt({ struktur: { quelle: "src", endungen: "kaputt" } }).ok).toBe(true);
  });

  test("ein leerer befehle-Block zählt nicht als gesetzter Befehl", () => {
    expect(gezielt({ struktur: { quelle: "src", endungen: [".py"] }, befehle: {} }).ok).toBe(false);
    expect(gezielt({ struktur: { quelle: "src", endungen: [".py"] }, befehle: { verify: "x" } }).ok).toBe(false);
    expect(gezielt({ struktur: { quelle: "src", endungen: [".py"] }, befehle: { testGezielt: "  " } }).ok).toBe(false);
  });
});

describe("Fix-Texte nennen nur Bezieher-Skripte (factory#177)", () => {
  const ERLAUBT = BEZIEHER_NPM_SKRIPTE;
  const npmNamen = (text: string) => [...text.matchAll(/npm run ([\w:-]+)/g)].map((m) => m[1]);

  test("kein Fix-Text (Projektdateien, Langfuse-Takt) nennt ein npm-Skript außerhalb der Liste", () => {
    const takt = punkt(pruefe({ rootDir: "/x", ...GESUND, git: fakeGit(gesund), existiert: () => false, config: {} }), "Langfuse-Takt");
    const texte = [...PROJEKTDATEIEN.map((d) => d.fix ?? ""), takt.fix ?? ""];
    expect(texte.some((t) => t !== "")).toBe(true);
    expect(takt.fix).toContain("factory-sync.mjs");
    expect(PROJEKTDATEIEN.find((d) => d.pfad === "eslint-suppressions.json")?.fix).toContain("npx eslint . --prune-suppressions");
    for (const t of texte) for (const n of npmNamen(t)) expect(ERLAUBT.has(n), `npm run ${n}`).toBe(true);
  });
});

describe("Workflow-Auslöser", () => {
  const ci = (name: string): Workflow => ({ pfad: ".github/workflows/ci.yml", text: `name: ${name}\non:\n  push:\njobs:\n  a:\n    name: Beispiel Check\n` });
  const fest = (liste: string): Workflow => ({ pfad: ".github/workflows/festgefahren.yml", text: `name: Festgefahren\non:\n  workflow_run:  # Kommentar\n    workflows: ${liste}\n    types: [completed]\njobs:\n  b:\n    name: Zaehler\n` });
  const ausloeser = (workflows: Workflow[]) => punkt(pruefe({ rootDir: "/x", ...GESUND, workflows, git: fakeGit(gesund), existiert: () => true, config: {} }), "Workflow-Auslöser");

  test("Name passt (Flow-Liste und Blockliste): OK", () => {
    expect(ausloeser([ci("CI"), fest('["CI"]')])).toEqual({ punkt: "Workflow-Auslöser", ok: true });
    expect(ausloeser([ci("CI"), fest("\n      - CI")])).toEqual({ punkt: "Workflow-Auslöser", ok: true });
  });
  test("Name fehlt: Lücke mit Fix, der Datei und Namen nennt", () => {
    const p = ausloeser([ci("Build"), fest('["CI"]')]);
    expect(p.ok).toBe(false);
    expect(p.befund).toContain("CI");
    expect(p.fix).toContain("einen Workflow mit `name: CI` anlegen oder den Auslöser in festgefahren.yml auf einen vorhandenen Namen ändern");
  });
  test("Blockliste mit fehlendem Namen ist eine Lücke (der Leser sieht die Listeneinträge)", () => {
    expect(ausloeser([ci("Build"), fest("\n      - CI")]).befund).toContain("CI");
  });
  test("ein `workflows:` außerhalb des workflow_run-Blocks zählt nicht", () => {
    const w: Workflow = { pfad: ".github/workflows/x.yml", text: "name: X\non:\n  workflow_run:\n    types: [completed]\njobs:\n  a:\n    with:\n      workflows: [Fremd]\n" };
    expect(ausloeser([ci("CI"), w]).ok).toBe(true);
  });
  test("kein workflow_run, oder keine Workflows: OK", () => {
    expect(ausloeser([ci("Build")])).toEqual({ punkt: "Workflow-Auslöser", ok: true });
    expect(ausloeser([])).toEqual({ punkt: "Workflow-Auslöser", ok: true });
  });
  test("ein Verweis auf einen vorhandenen Namen genügt, ein zweiter fehlender macht es zur Lücke", () => {
    expect(ausloeser([ci("CI"), fest('["CI", "Weg"]')]).ok).toBe(false);
  });
  const eigen = (text: string): Workflow => ({ pfad: ".github/workflows/x.yml", text });
  test("Guards des Lesers: Folgeschlüssel nach der Liste, Anführungszeichen, nur oberstes name, gleiche Einrückung, Leerzeile", () => {
    // else liste = -1: ein Eintrag unter dem Folgeschlüssel `branches` ist kein Workflow-Name
    expect(ausloeser([ci("CI"), fest("\n      - CI\n    branches:\n      - main")]).ok).toBe(true);
    // ohneAnfuehrung beim Namen
    expect(ausloeser([ci('"CI"'), fest('["CI"]')]).ok).toBe(true);
    // ^ am name-Anker: ein Job-Name ist nicht der Workflow-Name
    const jobNurName = eigen("on:\n  push:\njobs:\n  a:\n    name: CI\n");
    expect(ausloeser([jobNurName, fest('["CI"]')]).ok).toBe(false);
    // und ein eingerücktes `name:` vor dem obersten zählt nicht
    const spaet = eigen("on:\n  workflow_dispatch:\n    inputs:\n      name: x\nname: CI\n");
    expect(ausloeser([spaet, fest('["CI"]')]).ok).toBe(true);
    // >= bei der Listen-Einrückung: Blockliste auf Höhe von `workflows:`
    const gleich = eigen("name: G\non:\n  workflow_run:\n    workflows:\n    - CI\n");
    expect(ausloeser([ci("Build"), gleich]).befund).toContain("CI");
    // Leerzeile im Block beendet das Lesen nicht
    expect(ausloeser([ci("CI"), fest("\n      - CI\n\n      - Weg")]).befund).toContain("Weg");
  });
  describe("L20: nicht lesbare Form ist NICHT PRÜFBAR mit Datei:Zeile, nie „kein workflow_run“", () => {
    const FPFAD = ".github/workflows/x.yml";
    test("`on:` in Flow-Form (Mapping): nicht prüfbar mit Datei und Zeile", () => {
      const p = ausloeser([ci("Build"), eigen("name: X\non: { workflow_run: { workflows: [CI] } }\njobs: {}\n")]);
      expect(p.ok).toBe(false);
      expect(p.nichtPruefbar).toBe(true);
      expect(p.befund).toContain(`${FPFAD}:2`);
      expect(p.befund).toContain("Flow-Collection");
    });
    test("Alias oder Anker an `workflows` und an `name`: nicht prüfbar", () => {
      const alias = ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows: *liste\n")]);
      expect(alias.nichtPruefbar).toBe(true);
      expect(alias.befund).toContain(`${FPFAD}:4`);
      const anker = ausloeser([ci("Build"), eigen("name: &n CI\non:\n  push:\n")]);
      expect(anker.nichtPruefbar).toBe(true);
      expect(anker.befund).toContain(`${FPFAD}:1`);
    });
    test("mehrzeilige Flow-Liste unter `workflows`: nicht prüfbar", () => {
      const p = ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows: [CI,\n      Weg]\n")]);
      expect(p.nichtPruefbar).toBe(true);
      expect(p.befund).toContain(`${FPFAD}:4`);
    });
    test("Flow-Liste: Leerraum vor dem Komma oder vor `]` ist lesbar, `[a:]` ist ein Mapping-Eintrag und nicht lesbar", () => {
      for (const liste of ['["CI" , Weg]', '["CI" ]']) {
        const text = `name: X\non:\n  workflow_run:\n    workflows: ${liste}\n`;
        expect(rawAusloeser(text).ausloeser, liste).toEqual(liste.includes("Weg") ? ["CI", "Weg"] : ["CI"]);
      }
      const p = ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows: [a:]\n")]);
      expect(p.nichtPruefbar).toBe(true);
      expect(p.befund).toContain(`${FPFAD}:4`);
    });
    test("`#` direkt hinter dem `]` (ohne Leerraum) ist nicht prüfbar mit Datei:Zeile", () => {
      const p = ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows: [CI]#x\n")]);
      expect(p.nichtPruefbar).toBe(true);
      expect(p.befund).toContain(`${FPFAD}:4`);
    });
    test.each(["[CI], Weg # y", "[CI] x # y"])("Text hinter dem `]` vor einem ` #` (%s) ist nicht prüfbar mit Datei:Zeile", (liste) => {
      const p = ausloeser([ci("Build"), eigen(`name: X\non:\n  workflow_run:\n    workflows: ${liste}\n`)]);
      expect(p.nichtPruefbar).toBe(true);
      expect(p.befund).toContain(`${FPFAD}:4`);
    });
    test("`on: >` (Folded-Block-Skalar) ist nicht lesbar", () => {
      const p = ausloeser([ci("Build"), eigen("name: X\non: >\n  push\n")]);
      expect(p.nichtPruefbar).toBe(true);
      expect(p.befund).toContain(`${FPFAD}:2`);
    });
    test("eine nicht lesbare Datei macht auch eine sonst sichere Lücke nicht prüfbar (der Name könnte dort stehen)", () => {
      const p = ausloeser([ci("Build"), fest('["CI"]'), eigen("name: Y\non: { push: {} }\n")]);
      expect(p.nichtPruefbar).toBe(true);
      expect(p.fix).toContain("Blockform");
    });
    test("`on:` als Skalar oder Flow-Liste kennt kein workflow_run: OK", () => {
      expect(ausloeser([ci("Build"), eigen("name: X\non: push\n")]).ok).toBe(true);
      expect(ausloeser([ci("Build"), eigen("name: X\non: [push, pull_request]\n")]).ok).toBe(true);
    });
    test("Flow-Liste mit Anführungszeichen und Komma im Namen bleibt ein Name", () => {
      const p = ausloeser([ci("Build"), fest('["A, B", \'C\']')]);
      expect(p.befund).toContain("A, B");
      expect(p.befund).toContain("„C“");
    });
    const wf = (rest: string) => eigen(`name: X\non:\n  workflow_run:\n    workflows: ${rest}\n`);
    const nicht = (text: Workflow) => {
      const p = ausloeser([ci("Build"), text]);
      expect(p.nichtPruefbar, JSON.stringify(text.text)).toBe(true);
      return p;
    };
    test("Flow-Liste ohne Quotes: jeder Eintrag zählt, der letzte auch; leere Einträge entfallen", () => {
      const p = ausloeser([ci("Build"), wf("[CI, Weg]")]);
      expect(p.befund).toContain("„CI“");
      expect(p.befund).toContain("„Weg“");
      expect(ausloeser([ci("CI"), wf("[CI]")]).ok).toBe(true);
      expect(ausloeser([ci("CI"), wf("[CI,, '']")]).ok).toBe(true);
      expect(ausloeser([ci("CI"), wf("[]")]).ok).toBe(true);
    });
    test("unlesbare Einträge der Flow-Liste: Text nach dem Quote, unbeendetes Quote, Alias, Mapping-Eintrag", () => {
      for (const rest of ['["CI" x]', '["CI]', "[*a]", "[a: b]", "[CI, &a Weg]"]) nicht(wf(rest));
    });
    test("Flow-Liste: ein Anführungszeichen mitten im Eintrag und einfaches Quote mit Komma", () => {
      expect(ausloeser([ci("Build"), wf("['A, B', C]")]).befund).toContain("A, B");
    });
    test("Block-Liste: Eintrag mit Kommentar zählt, Alias, leerer, verschachtelter und nur-Kommentar-Eintrag sind nicht prüfbar", () => {
      expect(ausloeser([ci("CI"), eigen("name: X\non:\n  workflow_run:\n    workflows:\n      - CI # Kommentar\n")]).ok).toBe(true);
      for (const eintrag of ["- *a", "-", "- - x", "- # nur Kommentar"]) nicht(eigen(`name: X\non:\n  workflow_run:\n    workflows:\n      ${eintrag}\n`));
    });
    test("Block-Liste eingerückt, danach ein Folgeschlüssel auf Höhe von `workflows`", () => {
      expect(ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows:\n      - Weg\n    types: [completed]\n")]).befund).toContain("Weg");
    });
    test("Block-Liste weniger eingerückt als `workflows:`: nicht prüfbar statt als Eintrag gelesen", () => {
      nicht(eigen("name: X\non:\n  workflow_run:\n    workflows:\n  - Weg\n"));
    });
    test("`workflows` als einzelner Skalar oder leer", () => {
      expect(ausloeser([ci("Build"), wf("Weg")]).befund).toContain("Weg");
      expect(ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows:\n    types: [completed]\n")]).ok).toBe(true);
    });
    test("`workflow_run` als Liste oder Flow-Mapping: nicht prüfbar, leer: OK", () => {
      nicht(eigen("name: X\non:\n  workflow_run:\n    - x\n"));
      nicht(eigen("name: X\non:\n  workflow_run: { workflows: [CI] }\n"));
      expect(ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n")]).ok).toBe(true);
    });
    test("`on:` als Block-Liste, leer oder Skalar: OK; als Anker, Block-Skalar oder doppelt: nicht prüfbar", () => {
      for (const on of ["on:\n  - push\n", "on:\n", "on: push\n", "on: [workflow_run]\n"]) expect(ausloeser([ci("Build"), eigen(`name: X\n${on}`)]).ok, on).toBe(true);
      for (const on of ["on: &a\n  push:\n", "on: |\n  x\n", "on: *a\n", "on:\n  push:\non:\n  push:\n"]) nicht(eigen(`name: X\n${on}`));
    });
    test("BOM und Dokumentstart werden gelesen, Dokumentstart mit Inhalt nicht", () => {
      expect(ausloeser([ci("Build"), eigen("﻿---\nname: X\non:\n  workflow_run:\n    workflows: [Weg]\n")]).befund).toContain("Weg");
      nicht(eigen("--- x\nname: X\n"));
    });
    test("leerer Workflow-Name zählt nicht als Name", () => {
      expect(ausloeser([eigen("name:\non: push\n"), wf("['']")]).ok).toBe(true);
      expect(ausloeser([eigen("name: ''\non: push\n"), wf("[Leer]")]).ok).toBe(false);
    });
    test("CRLF-Zeilenenden, `workflows:` am Dateiende, Liste auf Schlüsselhöhe mit Folgeschlüssel, Einträge auf verschiedenen Einrückungen", () => {
      expect(ausloeser([ci("Build"), eigen("name: X\r\non:\r\n  workflow_run:\r\n    workflows:\r\n      - Weg\r\n")]).befund).toContain("Weg");
      expect(ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows:\n")]).ok).toBe(true);
      const gleich = ausloeser([ci("Build"), eigen("name: X\non:\n  workflow_run:\n    workflows:\n    - Weg\n    types: [completed]\n")]);
      expect(gleich.befund).toContain("„Weg“");
      expect(gleich.befund).not.toContain("types");
      nicht(eigen("name: X\non:\n  workflow_run:\n    workflows:\n      - A\n    - B\n"));
    });
    test("andere Auslöser mit eigenen Unterschlüsseln vor `workflow_run` werden übersprungen; `on: |` heißt Block-Skalar", () => {
      expect(ausloeser([ci("Build"), eigen("name: X\non:\n  push:\n    branches:\n      - main\n  workflow_run:\n    workflows: [Weg]\n")]).befund).toContain("Weg");
      expect(nicht(eigen("name: X\non: |\n  x\n")).befund).toContain("Block-Skalar");
    });
    test("`workflows: null` (Aufrufer reicht null) wie keine Workflows", () => {
      expect(punkt(pruefe({ rootDir: "/x", ...GESUND, workflows: null as unknown as Workflow[], git: fakeGit(gesund), existiert: () => true, config: {} }), "Workflow-Auslöser").ok).toBe(true);
    });
    test("die Zeile bleibt eine Lücke, wenn alle Dateien lesbar sind (kein Aufweichen)", () => {
      const p = ausloeser([ci("Build"), fest('["CI"]')]);
      expect(p.ok).toBe(false);
      expect(p.nichtPruefbar).toBeUndefined();
    });
  });
  test("Differenz: der Leser liest dieselben Auslöser wie die yaml-Bibliothek", async () => {
    const { parse } = await import("yaml");
    const proben = [
      "name: A\non:\n  workflow_run:\n    workflows: [CI, 'Zwei Worte']\n    types: [completed]\n",
      "name: A\non:\n  workflow_run:\n    workflows:\n      - CI\n      - \"Build x\"\n",
      "name: A\non:\n  workflow_run:\n    workflows:\n    - CI\n    branches: [main]\n",
      "name: A\non: push\n",
      "name: A\non:\n  push:\n  pull_request:\n",
      "name: A\non:\n  workflow_run:\n    workflows: [CI] # Kommentar\n",
      "name: A\non:\n  workflow_run:\n    workflows: [\"CI\" , 'Weg' ] # Kommentar\n",
      "name: A\non:\n  workflow_run:\n    workflows: [\"a #b\", c#d]\n",
      "name: A\non:\n  workflow_run:\n    workflows: [\"a ] #b\"] # Kommentar\n",
      "name: A\non:\n  workflow_run:\n    workflows: [CI] # siehe [docs]\n",
      "name: A\non:\n  workflow_run:\n    workflows: [CI] # x ]\n",
      "name: A\non:\n  workflow_run:\n    workflows: [\"a ] #b\"]\n",
      "name: A\non:\n  workflow_run:\n    workflows: [\"a\\\"]\"] # x\n",
      "name: A\non:\n  workflow_run:\n    workflows: ['C:\\'] # x\n",
      "name: A\non:\n  workflow_run:\n    workflows: ['x ] y', z] # q ]\n",
      "name: A\non:\n  workflow_run:\n    workflows: [CI]\t# x\n",
    ];
    for (const text of proben) {
      const erwartet = (parse(text) as { on?: { workflow_run?: { workflows?: string[] } } }).on;
      const soll = typeof erwartet === "object" && erwartet !== null ? (erwartet.workflow_run?.workflows ?? []) : [];
      const r = rawAusloeser(text);
      expect(r.ausloeser, text).toEqual(soll);
    }
  });
  test("steht in DATEI_PUNKTE vor CODEOWNERS-Spiegel", () => {
    expect(DATEI_PUNKTE.at(-3)).toBe("Workflow-Auslöser");
  });
});

describe("DATEI_PUNKTE (factory#148): die eine geordnete Liste", () => {
  test("pruefeDateien liefert genau diese Punkte in dieser Reihenfolge: gesund, alles fehlt, werfendes Git", () => {
    const werfend: Git = () => {
      throw new Error("kein git");
    };
    expect(lauf(gesund).map((p) => p.punkt)).toEqual([...DATEI_PUNKTE]);
    expect(pruefe({ rootDir: "/x", git: fakeGit([]), existiert: () => false, config: {} }).map((p) => p.punkt)).toEqual([...DATEI_PUNKTE]);
    expect(pruefe({ rootDir: "/x", ...GESUND, git: werfend, existiert: () => true, config: {} }).map((p) => p.punkt)).toEqual([...DATEI_PUNKTE]);
    expect(new Set(DATEI_PUNKTE).size).toBe(DATEI_PUNKTE.length);
  });
  test("die Reihenfolge ist unabhängig abgeschrieben (Orakel, nicht aus dem Code gerechnet)", () => {
    const erwartet = ["Root-Kontextdatei", "Zeilenenden", "Projektdateien", "Langfuse-Takt", "Gezielter Test", "Required-Check-Quellen", "Code-Scanning-Quellen", "Workflow-Auslöser", "CODEOWNERS-Spiegel", "Sammel-Check"];
    expect([...DATEI_PUNKTE]).toEqual(erwartet);
    expect(lauf(gesund).map((p) => p.punkt)).toEqual(erwartet);
  });
  test("Required-Check-Quellen steht an fester Stelle vor Workflow-Auslöser, die Liste ist unveränderlich", () => {
    expect(DATEI_PUNKTE.at(-5)).toBe("Required-Check-Quellen");
    expect(DATEI_PUNKTE.at(-4)).toBe("Code-Scanning-Quellen");
    expect(DATEI_PUNKTE.at(-1)).toBe("Sammel-Check");
    expect(Object.isFrozen(DATEI_PUNKTE)).toBe(true);
  });
});

describe("Required-Check-Quellen (factory#148)", () => {
  const K = "Beispiel Check";
  const ci = (name: string, pfad = "ci.yml"): Workflow => ({ pfad, text: `jobs:\n  a:\n    name: ${name}\n` });
  const pk = (workflows: Workflow[], pflichtChecks: string[] = [K], spiegel: unknown = { requiredChecks: pflichtChecks }) => quellenPunkt({ spiegel, workflows, pflichtChecks });

  test("genau eine Quelle: OK", () => {
    expect(pk([ci(K)])).toEqual({ punkt: "Required-Check-Quellen", ok: true });
  });
  test("ohne Spiegel: NICHT PRÜFBAR mit Fix, auch bei vorhandener Soll-Liste", () => {
    const p = pk([ci(K)], [K], null);
    expect(p).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(p.fix).toContain("rulesetSpiegel");
  });
  test("Spiegel nicht übergeben (undefined, wie pruefLauf ohne rulesetSpiegel) bei nicht leerer Soll-Liste: NICHT PRÜFBAR", () => {
    const p = quellenPunkt({ spiegel: undefined, workflows: [ci(K)], pflichtChecks: [K] });
    expect(p).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(p.fix).toContain("rulesetSpiegel");
  });
  test("Soll-Liste kein Array (String): NICHT PRÜFBAR statt Zeichen-Zählung", () => {
    const p = quellenPunkt({ spiegel: {}, workflows: [ci(K)], pflichtChecks: K as unknown as string[] });
    expect(p).toMatchObject({ ok: false, nichtPruefbar: true });
  });
  test("workflows nicht übergeben: LÜCKE mit 0 Quellen statt Absturz", () => {
    const p = quellenPunkt({ spiegel: {}, workflows: undefined, pflichtChecks: [K] });
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain("0 Quellen");
  });
  test("leere Soll-Liste: NICHT PRÜFBAR mit Fix", () => {
    const p = pk([ci(K)], []);
    expect(p).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(p.fix).toContain("requiredChecks");
  });
  test("zwei Quellen (zweite Datei): Lücke mit Kontext, Anzahl und Fundstellen", () => {
    const p = pk([ci(K), ci(K, "fake.yml")]);
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain("„Beispiel Check“: 2 Quellen (ci.yml: Beispiel Check, fake.yml: Beispiel Check)");
    expect(p.fix).toContain("umbenennen");
  });
  test("zwei Quellen in DERSELBEN Datei und als Schritt: Lücke", () => {
    const text = `jobs:\n  a:\n    name: ${K}\n    steps:\n      - name: ${K}\n`;
    expect(pk([{ pfad: "ci.yml", text }]).befund).toContain("2 Quellen");
  });
  test("keine Quelle (auch ganz ohne Workflow-Datei): Lücke mit 0 Quellen", () => {
    for (const workflows of [[ci("Anderes")], []]) {
      const p = pk(workflows);
      expect(p.ok).toBe(false);
      expect(p.nichtPruefbar).toBeUndefined();
      expect(p.befund).toContain("„Beispiel Check“: 0 Quellen");
      expect(p.fix).toContain("Ruleset");
    }
  });
  test("dynamischer Name (${{) mit passendem Präfix zählt fail-closed als Quelle, fremdes Präfix nicht", () => {
    expect(pk([ci(K), ci("Beispiel ${{ matrix.x }}", "fake.yml")]).befund).toContain("2 Quellen");
    expect(pk([ci(K), ci("Anderes ${{ matrix.x }}", "ok.yml")])).toMatchObject({ ok: true });
  });
  test("mehr als fünf Fundstellen werden gekürzt", () => {
    const p = pk(Array.from({ length: 7 }, (_, i) => ci(K, `w${i}.yml`)));
    expect(p.befund).toContain("7 Quellen");
    expect(p.befund).toContain("(+2 weitere)");
    expect(p.befund).not.toContain("w6.yml");
  });
  test("mehrere Kontexte: der Befund nennt jeden mit Anzahl ungleich eins", () => {
    const p = pk([ci("Eins"), ci("Zwei"), ci("Zwei", "fake.yml")], ["Eins", "Zwei", "Drei"]);
    expect(p.befund).toContain("„Zwei“: 2 Quellen");
    expect(p.befund).toContain("„Drei“: 0 Quellen");
    expect(p.befund).not.toContain("„Eins“");
  });
  test("nicht lesbare Datei (Flow-Form): NICHT PRÜFBAR mit datei:zeile, Konstrukt und Fix Blockform", () => {
    const p = pk([ci(K), { pfad: "fake.yml", text: "jobs:\n  x: { name: Beispiel Check }\n" }]);
    expect(p).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(p.befund).toContain("fake.yml:2 Flow-Collection als Job");
    expect(p.fix).toContain("Blockform");
  });
  test("nicht lesbar und 0 Quellen: NICHT PRÜFBAR (die Quelle könnte in der unlesbaren Datei stehen)", () => {
    expect(pk([{ pfad: "fake.yml", text: "jobs: { x: {} }\n" }])).toMatchObject({ ok: false, nichtPruefbar: true });
  });
  test("belegte Doppelquelle schlägt nicht lesbar: Lücke, die nicht lesbare Datei steht dabei", () => {
    const p = pk([ci(K), ci(K, "zwei.yml"), { pfad: "fake.yml", text: "jobs: { x: {} }\n" }]);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain("2 Quellen");
    expect(p.befund).toContain("fake.yml:1");
  });
  test("pruefeDateien liest selbst nichts: übergebene Workflows zählen, auch wenn auf der Platte keine liegen", () => {
    const e = lauf(gesund);
    expect(punkt(e, "Required-Check-Quellen").ok).toBe(true);
    const doppelt = pruefe({ rootDir: "/x", ...GESUND, workflows: [ci(K), ci(K, "fake.yml")], git: fakeGit(gesund), existiert: () => true, config: {} });
    expect(punkt(doppelt, "Required-Check-Quellen").ok).toBe(false);
  });
  test("factory#220 L19: vorAbbruch nennt als Grund die nicht geladene Config, ein fehlender Spiegel ohne vorAbbruch bleibt getrennt", () => {
    const vor = quellenPunkt({ spiegel: undefined, workflows: [], pflichtChecks: [], vorAbbruch: true });
    expect(vor).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(vor.befund).toContain("Config bzw. Ruleset-Spiegel nicht geladen (Abbruch oben)");
    expect(vor.befund).not.toContain("kein Ruleset-Spiegel");
    const ohne = quellenPunkt({ spiegel: undefined, workflows: [], pflichtChecks: [] });
    expect(ohne.befund).toContain("kein Ruleset-Spiegel");
    expect(ohne.befund).not.toContain("nicht geladen");
  });
  test("factory#220 L19: pruefeDateien reicht vorAbbruch an den Punkt durch", () => {
    const e = pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert: () => true, config: {}, vorAbbruch: true });
    expect(punkt(e, "Required-Check-Quellen").befund).toContain("nicht geladen");
  });
  test("ohne die neuen Felder (Abbruchpfad) ist der Punkt nicht prüfbar statt grün", () => {
    expect(punkt(pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert: () => true, config: {} }), "Required-Check-Quellen")).toMatchObject({ ok: false, nichtPruefbar: true });
  });
});

describe("Code-Scanning-Quellen (factory#339)", () => {
  const cs = (...tools: string[]) => ({ requiredChecks: [], codeScanning: tools.map((tool) => ({ tool })) });
  const analyze = (text = ""): Workflow => ({ pfad: ".github/workflows/codeql.yml", text: `jobs:\n  a:\n    steps:\n      - uses: github/codeql-action/analyze@abc # v3\n${text}` });
  const sarif = (text: string, pfad = ".github/workflows/zizmor.yml"): Workflow => ({ pfad, text: `jobs:\n  a:\n    steps:\n      - run: ${text}\n      - uses: github/codeql-action/upload-sarif@abc # v3\n` });
  const p = (spiegel: unknown, workflows: Workflow[], vorAbbruch = false) => csPunkt({ spiegel, workflows, vorAbbruch });

  test("CodeQL und zizmor mit echten Workflows: OK", () => {
    expect(p(cs("CodeQL", "zizmor"), [analyze(), sarif("zizmor --format sarif .")])).toEqual({ punkt: "Code-Scanning-Quellen", ok: true });
  });
  test("zizmor im Spiegel, Workflow fehlt: LÜCKE mit Fix", () => {
    const e = p(cs("CodeQL", "zizmor"), [analyze()]);
    expect(e).toMatchObject({ ok: false });
    expect(e.nichtPruefbar).toBeUndefined();
    expect(e.befund).toContain("zizmor");
    expect(e.fix).toContain("Sicherheits-Modul wählen (`module` in `.factory/projekt.json`) oder Workflow mit SARIF-Upload ergänzen, sonst das Werkzeug aus Ruleset und Spiegel nehmen (Pre-Flight)");
  });
  test("CodeQL ohne Workflow mit analyze: NICHT PRÜFBAR (Default-Setup serverseitig)", () => {
    const e = p(cs("CodeQL"), [sarif("x")]);
    expect(e).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(e.befund).toContain("Default-Setup");
  });
  test("eine Lücke schlägt NICHT PRÜFBAR derselben Prüfung", () => {
    const e = p(cs("CodeQL", "zizmor"), []);
    expect(e.nichtPruefbar).toBeUndefined();
    expect(e.befund).toContain("zizmor");
  });
  test("upload-sarif ohne den Werkzeugnamen in der Datei: LÜCKE", () => {
    expect(p(cs("zizmor"), [sarif("anderes --sarif")])).toMatchObject({ ok: false });
  });
  test("Name als Teilwort eines anderen Wortes zählt nicht", () => {
    expect(p(cs("zizmor"), [sarif("zizmor-ng --sarif")]).ok).toBe(false);
    expect(p(cs("zizmor"), [sarif("xzizmor --sarif")]).ok).toBe(false);
  });
  test("Name ganz am Anfang oder ganz am Ende der Datei zählt als Wort", () => {
    const upload = "uses: github/codeql-action/upload-sarif@abc\n";
    expect(p(cs("zizmor"), [{ pfad: "a.yml", text: `zizmor\n${upload}` }]).ok).toBe(true);
    expect(p(cs("zizmor"), [{ pfad: "b.yml", text: `${upload}zizmor` }]).ok).toBe(true);
  });
  test("Werkzeugname ohne Upload-Schritt: LÜCKE", () => {
    expect(p(cs("zizmor"), [{ pfad: "z.yml", text: "jobs:\n  a:\n    steps:\n      - run: zizmor .\n" }]).ok).toBe(false);
  });
  test("ein auskommentierter Upload zählt nicht", () => {
    expect(p(cs("zizmor"), [{ pfad: "z.yml", text: "jobs:\n  a:\n    steps:\n      - run: zizmor .\n      # - uses: github/codeql-action/upload-sarif@abc\n" }]).ok).toBe(false);
    expect(p(cs("CodeQL"), [{ pfad: "c.yml", text: "# uses: github/codeql-action/analyze@abc\n" }]).nichtPruefbar).toBe(true);
  });
  test("Groß- und Kleinschreibung ist egal", () => {
    expect(p(cs("CodeQL", "ZIZMOR"), [analyze(), sarif("Zizmor --sarif")]).ok).toBe(true);
    expect(p(cs("CODEQL"), [analyze()]).ok).toBe(true);
  });
  test("ohne Spiegel oder nach Abbruch: NICHT PRÜFBAR wie bei Required-Check-Quellen", () => {
    expect(p(null, [])).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(p(undefined, [])).toMatchObject({ ok: false, nichtPruefbar: true });
    expect(p(cs("zizmor"), [], true)).toMatchObject({ ok: false, nichtPruefbar: true });
  });
  test("Spiegel ohne codeScanning oder mit leerer Liste: OK", () => {
    expect(p({ requiredChecks: [] }, []).ok).toBe(true);
    expect(p(cs(), []).ok).toBe(true);
  });
  test("ohne Workflow-Liste: Lücke statt Absturz", () => {
    expect(csPunkt({ spiegel: cs("zizmor") }).ok).toBe(false);
  });
  test("ein Eintrag ohne Werkzeugnamen verfälscht nichts", () => {
    expect(p({ codeScanning: [null, {}, { tool: 5 }] }, []).ok).toBe(true);
  });
  test("Teilwort zuerst, ganzes Wort später: zählt", () => {
    expect(p(cs("zizmor"), [sarif("zizmorcore/x zizmor --sarif")]).ok).toBe(true);
  });
  test("Unterstrich und Ziffer neben dem Namen machen ihn zum Teilwort", () => {
    for (const nachbar of ["zizmor_x", "zizmor2", "_zizmor", "2zizmor"]) expect(p(cs("zizmor"), [sarif(`${nachbar} --sarif`)]).ok).toBe(false);
  });
  test("ein Präfix mit zusätzlichen Zeichen vor dem @ ist keine analyze-Quelle", () => {
    expect(p(cs("CodeQL"), [{ pfad: "c.yml", text: "      - uses: github/codeql-action/analyzer@abc\n" }]).nichtPruefbar).toBe(true);
  });
  test("ein Präfix mit zusätzlichen Zeichen vor dem @ ist keine upload-sarif-Quelle", () => {
    const text = "jobs:\n  a:\n    steps:\n      - run: zizmor --sarif\n      - uses: github/codeql-action/upload-sarifx@abc\n";
    expect(p(cs("zizmor"), [{ pfad: "z.yml", text }]).ok).toBe(false);
  });
  test("ein kaputter codeScanning-Eintrag stürzt nicht ab und erzeugt keine Lücke", () => {
    expect(p({ codeScanning: "zizmor" }, []).ok).toBe(true);
    expect(p({ codeScanning: {} }, []).ok).toBe(true);
    expect(p({ codeScanning: [{ tool: "" }] }, []).ok).toBe(true);
  });
  test("pruefeDateien reicht vorAbbruch an den Punkt", () => {
    const e = pruefe({ rootDir: "/x", ...GESUND, vorAbbruch: true, spiegel: { requiredChecks: ["Beispiel Check"], codeScanning: [{ tool: "zizmor" }] }, git: fakeGit(gesund), existiert: () => true, config: {} });
    expect(punkt(e, "Code-Scanning-Quellen")).toMatchObject({ ok: false, nichtPruefbar: true });
  });
  test("pruefeDateien reicht Spiegel und Workflows an den Punkt", () => {
    const e = pruefe({ rootDir: "/x", ...GESUND, spiegel: { requiredChecks: ["Beispiel Check"], codeScanning: [{ tool: "zizmor" }] }, git: fakeGit(gesund), existiert: () => true, config: {} });
    expect(punkt(e, "Code-Scanning-Quellen").ok).toBe(false);
    const mitQuelle = pruefe({ rootDir: "/x", ...GESUND, workflows: [...GESUND.workflows, sarif("zizmor")], spiegel: { requiredChecks: ["Beispiel Check"], codeScanning: [{ tool: "zizmor" }] }, git: fakeGit(gesund), existiert: () => true, config: {} });
    expect(punkt(mitQuelle, "Code-Scanning-Quellen").ok).toBe(true);
  });
});

describe("CODEOWNERS-Spiegel (factory#382 L11, L69)", () => {
  const QUELLE = JSON.stringify({ pflichtReview: ["/scripts/a.mjs", "/.github/CODEOWNERS", "/docs/"], andere: ["/x/"] });
  const eigenes = (z: string[]) => z.join("\n");
  const SOLL = eigenes(["# Kopf", "# @team", "/scripts/a.mjs @team", "/.github/CODEOWNERS @team", "/docs/ @team"]);
  const punktFuer = (quelle: string | null, codeowners: string | null, existiert = true) =>
    punkt(
      pruefe({ rootDir: "/x", ...GESUND, git: fakeGit(gesund), existiert: () => existiert, config: {}, lies: (p) => (p.replaceAll("\\", "/").endsWith("protected-paths.json") ? quelle : codeowners) }),
      "CODEOWNERS-Spiegel",
    );

  test("(a) CODEOWNERS spiegelt die Gruppe pflichtReview: OK", () => {
    expect(punktFuer(QUELLE, SOLL).ok).toBe(true);
  });

  test("(b) Soll-Muster fehlt in CODEOWNERS: Lücke, die den Pfad nennt (kein Owner-Handle)", () => {
    const p = punktFuer(QUELLE, eigenes(["/scripts/a.mjs @geheim-handle", "/.github/CODEOWNERS @geheim-handle"]));
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain("nicht in CODEOWNERS: docs/");
    expect(JSON.stringify(p)).not.toContain("geheim-handle");
  });

  test("(c) CODEOWNERS-Zeile außerhalb des Soll: Lücke", () => {
    const p = punktFuer(QUELLE, SOLL + "\n/fremd/ @team");
    expect(p.ok).toBe(false);
    expect(p.befund).toContain("nicht in der Pflicht-Review-Liste: fremd/");
  });

  test("(d) Gruppe pflichtReview ohne /.github/CODEOWNERS: Lücke (Selbstschutz)", () => {
    const quelle = JSON.stringify({ pflichtReview: ["/scripts/a.mjs"] });
    const p = punktFuer(quelle, "/scripts/a.mjs @team");
    expect(p.ok).toBe(false);
    expect(p.befund).toContain("ohne /.github/CODEOWNERS");
  });

  test("ohne Gruppe pflichtReview gilt die ganze Liste", () => {
    const quelle = JSON.stringify({ a: ["/scripts/a.mjs", "/.github/CODEOWNERS"], b: ["/docs/"] });
    expect(punktFuer(quelle, SOLL).ok).toBe(true);
    expect(punktFuer(quelle, "/scripts/a.mjs @t").ok).toBe(false);
  });

  test("(e) eine der Dateien fehlt oder ist nicht lesbar: kein Befund hier (Projektdateien meldet das), nie ein Wurf", () => {
    expect(punktFuer(null, SOLL).ok).toBe(true);
    expect(punktFuer(QUELLE, null).ok).toBe(true);
    expect(punktFuer(QUELLE, SOLL, false).ok).toBe(true);
  });

  test("Standard-Leser: liest unter rootDir, fehlende oder nicht lesbare Datei (Ordner statt Datei) bleibt ohne Befund", () => {
    const wurzel = mkdtempSync(join(tmpdir(), "csp-"));
    try {
      const gh = join(wurzel, ".github");
      mkdirSync(gh, { recursive: true });
      const echt = () => punkt(pruefe({ rootDir: wurzel, ...GESUND, git: fakeGit(gesund), config: {} }), "CODEOWNERS-Spiegel");
      expect(echt().ok).toBe(true); // beide fehlen
      writeFileSync(join(gh, "protected-paths.json"), JSON.stringify({ a: ["/scripts/a.mjs"] }));
      writeFileSync(join(gh, "CODEOWNERS"), "/anderes/ @team\n");
      expect(echt().ok).toBe(false); // gelesen: weicht ab
      rmSync(join(gh, "CODEOWNERS"));
      mkdirSync(join(gh, "CODEOWNERS"));
      const e = echt();
      expect(e.ok).toBe(true); // existiert, aber nicht lesbar: kein Wurf
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });

  test("Zeilenform: Zeile ohne @owner zählt nicht, nur das erste Wort ist das Muster, Einrückung stört nicht", () => {
    const quelle = JSON.stringify({ pflichtReview: ["/scripts/a.mjs", "/.github/CODEOWNERS", "/docs/"] });
    expect(punktFuer(quelle, SOLL + "\n/ohne-owner/").ok).toBe(true);
    expect(punktFuer(quelle, SOLL + "\n/dritte/ /b-extra/ @t").ok).toBe(true); // drei Wörter: keine CODEOWNERS-Zeile, kein Muster `b-extra/`
    expect(punktFuer(quelle, eigenes(["  /scripts/a.mjs @team", "\t/.github/CODEOWNERS @team", " /docs/ @team"])).ok).toBe(true);
  });

  test("(f) kaputtes JSON oder eine Gruppe, die keine Liste ist: Lücke mit Grund, kein Wurf", () => {
    for (const quelle of ["{kaputt", JSON.stringify({ pflichtReview: "x" })]) {
      const p = punktFuer(quelle, SOLL);
      expect(p.ok, quelle).toBe(false);
      expect(p.befund, quelle).toMatch(/nicht lesbar|keine Liste/);
    }
  });
});
