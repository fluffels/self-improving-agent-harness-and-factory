/* Harness-Doctor, Dateipunkte (factory#94): `pruefeDateien` mit injizierten `git` und `existiert`, dazu eine echte Git-Fixture.
 * Jeder Test verfälscht genau eine Quelle und erwartet genau diesen Punkt; kein Fehlschlag von Git darf OK ergeben. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { DATEI_PUNKTE as rawDateiPunkte, gitStandard as rawGitStandard, LF_BEISPIELE as rawBeispiele, pfadeOhneEolRegel as rawOhneRegel, PROJEKTDATEIEN as rawProjektdateien, pruefeDateien as rawPruefe, requiredCheckQuellenPunkt as rawQuellenPunkt } from "../scripts/harness-doctor-dateien.mjs";
import { fixture } from "./support/tmp-fixture";

interface Workflow { pfad: string; text: string }
interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string }
type Git = (args: string[], input?: string) => string;
const pruefe = rawPruefe as (e: { rootDir: string; git?: Git; existiert?: (p: string) => boolean; config?: unknown; spiegel?: unknown; workflows?: Workflow[]; pflichtChecks?: string[] }) => Ergebnis[];
const DATEI_PUNKTE = rawDateiPunkte as readonly string[];
const quellenPunkt = rawQuellenPunkt as (e: { spiegel?: unknown; workflows?: Workflow[]; pflichtChecks?: string[] }) => Ergebnis;
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
    expect(bezieher.hinweis).toContain("legt das Status-Ticket „Langfuse-Status überprüfen“ im eigenen Repo an");
    expect(bezieher.hinweis).toContain("c/d");
    const eigenes = lies(fixture({ ".factory/projekt.json": JSON.stringify({ repo: "a/b", labels: { harness: "h" }, boards: [{ rolle: "factory", repo: "a/b" }] }), ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1", repo: "f/q" } }) }));
    expect(eigenes).toEqual({ punkt: "Langfuse-Takt", ok: true }); // Factory-Board im eigenen Repo: kein Hinweis, auch im Bezieher
    const upstream = lies(fixture(projekt));
    expect(upstream.hinweis).toContain("dort pflegt der Takt Status-Ticket und Sammelticket, hier läuft nur der Board-Wächter");
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
  /** Spiegel der geschlossenen Liste `BEZIEHER_NPM_SKRIPTE` in test/harness/besitz-abschnittsverweise.test.ts. */
  const ERLAUBT = new Set(["check:docdrift", "check:docmap", "check:factorydrift", "check:internalrefs", "check:size", "skills:sync"]);
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
    expect(p.fix).toContain("`name:` von `.github/workflows/ci.yml` auf `CI` setzen (Auslöser von festgefahren.yml)");
  });
  test("kein workflow_run, oder keine Workflows: OK", () => {
    expect(ausloeser([ci("Build")])).toEqual({ punkt: "Workflow-Auslöser", ok: true });
    expect(ausloeser([])).toEqual({ punkt: "Workflow-Auslöser", ok: true });
  });
  test("ein Verweis auf einen vorhandenen Namen genügt, ein zweiter fehlender macht es zur Lücke", () => {
    expect(ausloeser([ci("CI"), fest('["CI", "Weg"]')]).ok).toBe(false);
  });
  test("steht als letzter Punkt in DATEI_PUNKTE", () => {
    expect(DATEI_PUNKTE.at(-1)).toBe("Workflow-Auslöser");
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
    const erwartet = ["Root-Kontextdatei", "Zeilenenden", "Projektdateien", "Langfuse-Takt", "Gezielter Test", "Required-Check-Quellen", "Workflow-Auslöser"];
    expect([...DATEI_PUNKTE]).toEqual(erwartet);
    expect(lauf(gesund).map((p) => p.punkt)).toEqual(erwartet);
  });
  test("Required-Check-Quellen steht an fester Stelle vor Workflow-Auslöser, die Liste ist unveränderlich", () => {
    expect(DATEI_PUNKTE.at(-2)).toBe("Required-Check-Quellen");
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
  test("ohne die neuen Felder (Abbruchpfad) ist der Punkt nicht prüfbar statt grün", () => {
    expect(punkt(pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert: () => true, config: {} }), "Required-Check-Quellen")).toMatchObject({ ok: false, nichtPruefbar: true });
  });
});
