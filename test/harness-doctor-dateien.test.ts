/* Harness-Doctor, Dateipunkte (factory#94): `pruefeDateien` mit injizierten `git` und `existiert`, dazu eine echte Git-Fixture.
 * Jeder Test verfälscht genau eine Quelle und erwartet genau diesen Punkt; kein Fehlschlag von Git darf OK ergeben. */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { gitStandard as rawGitStandard, LF_BEISPIELE as rawBeispiele, pfadeOhneEolRegel as rawOhneRegel, PROJEKTDATEIEN as rawProjektdateien, pruefeDateien as rawPruefe } from "../scripts/harness-doctor-dateien.mjs";
import { fixture } from "./support/tmp-fixture";

interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string }
type Git = (args: string[], input?: string) => string;
const pruefe = rawPruefe as (e: { rootDir: string; git?: Git; existiert?: (p: string) => boolean; config?: unknown }) => Ergebnis[];
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
const lauf = (dateien: Datei[], opt: { existiert?: (p: string) => boolean; beispielEol?: string } = {}) =>
  pruefe({ rootDir: "/x", git: fakeGit(dateien, opt.beispielEol), existiert: (p) => (opt.existiert ?? (() => false))(p) || p.replaceAll("\\", "/") === "/x/AGENTS.md" || PROJEKTDATEIEN.some((d) => p.replaceAll("\\", "/") === `/x/${d.pfad}`) || TAKT_DATEIEN.some((d) => p.replaceAll("\\", "/") === `/x/${d}`) });
const punkt = (e: Ergebnis[], name: string) => e.find((p) => p.punkt === name)!;

describe("Root-Kontextdatei", () => {
  test("ohne blockierende Datei: OK, und alle vier Punkte stehen immer da", () => {
    const e = lauf(gesund);
    expect(e.map((p) => p.punkt)).toEqual(["Root-Kontextdatei", "Zeilenenden", "Projektdateien", "Langfuse-Takt"]);
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
    expect(p.fix).toContain("npm run lint:prune");
  });
});

describe("Langfuse-Takt", () => {
  const takt = (existiert: (p: string) => boolean, config?: unknown) => punkt(pruefe({ rootDir: "/x", git: fakeGit(gesund), existiert, config }), "Langfuse-Takt");
  const norm = (p: string) => p.replaceAll("\\", "/");
  const ohneDatei = (fehlend: string) => (p: string) => norm(p) !== `/x/${fehlend}`;

  test("beide Dateien vorhanden: OK, ohne Hinweis bei eigenem Board", () => {
    const eigen = { repo: "a/b", boards: [{ rolle: "factory" }] };
    expect(takt(() => true, eigen)).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });

  test.each(TAKT_DATEIEN)("fehlt %s: Lücke mit Fix auf den Sync (Ring kern-nach-entkopplung)", (datei) => {
    const p = takt(ohneDatei(datei));
    expect(p.ok).toBe(false);
    expect(p.befund).toContain(datei);
    expect(p.fix).toContain("factory:sync");
    expect(p.fix).toContain("kern-nach-entkopplung");
  });

  test("Factory-Board führt ein fremdes Repo: OK mit Hinweis, der Takt dort pflegt Status- und Sammelticket", () => {
    const fremd = { repo: "a/b", boards: [{ rolle: "factory", repo: "c/d" }] };
    const p = takt(() => true, fremd) as Ergebnis & { hinweis?: string };
    expect(p.ok).toBe(true);
    expect(p.hinweis).toContain("c/d");
  });
});

describe("Langfuse-Takt: Config aus dem Root (Standard ohne injizierte Config)", () => {
  const alles = () => true;
  const lies = (root: string) => punkt(pruefe({ rootDir: root, git: fakeGit(gesund), existiert: alles }), "Langfuse-Takt") as Ergebnis & { hinweis?: string };

  test("die .factory/projekt.json des Roots wird gelesen: ein fremdes Factory-Board ergibt den Hinweis", () => {
    const root = fixture({ ".factory/projekt.json": JSON.stringify({ repo: "a/b", boards: [{ rolle: "factory", repo: "c/d" }] }) });
    expect(lies(root).hinweis).toContain("c/d");
  });

  test("ohne oder mit kaputter Config: OK ohne Hinweis, kein Absturz", () => {
    expect(lies(fixture({}))).toEqual({ punkt: "Langfuse-Takt", ok: true });
    expect(lies(fixture({ ".factory/projekt.json": "{kaputt" }))).toEqual({ punkt: "Langfuse-Takt", ok: true });
  });
});
