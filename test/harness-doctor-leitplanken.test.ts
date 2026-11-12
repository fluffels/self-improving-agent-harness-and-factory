/* Doctor-Punkt `Leitplanken-Quelle` (factory#149): die Teilregeln (a) bis (e) als pure Funktionen und der Punkt mit injiziertem `git` und `lies`.
 * Bewusst unter test/ statt test/harness/: Fixture-Texte (Marker, Kriterien) sollen nicht in den Scan des Agenten-Kontexts fallen;
 * der Marker steht darum nur als einzeilige Strings mit Zeilenumbruch, nie als eigene Zeile dieser Datei. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { agentsFunde as rawAgents, ankerFunde as rawAnker, gitStandard as rawGitStandard, leitplankenQuellePunkt as rawPunkt, textFunde as rawText } from "../scripts/harness-doctor-dateien.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { KERN_WAECHTER, MUSTER_MODUL, waechterAusserhalb as rawAusserhalb } from "../scripts/leitplanken-muster.mjs";

type Git = (args: string[], input?: string) => string;
interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string }
const ankerFunde = rawAnker as (q: string, c: string, roh: string[]) => string[];
const agentsFunde = rawAgents as (roh: string[]) => string[];
const textFunde = rawText as (scan: Record<string, string>, tests: Record<string, string>) => string[];
const punkt = rawPunkt as (e: { git: Git; lies: (p: string) => string | null }) => Ergebnis;
const gitStandard = rawGitStandard as (rootDir: string) => Git;
const waechterAusserhalb = rawAusserhalb as (dateien: Record<string, string>) => string[];
const kernWaechter = KERN_WAECHTER as string;
const musterModul = MUSTER_MODUL as string;

const QUELLE = JSON.stringify({ harness: ["AGENTS.md", "/.github/CODEOWNERS", "/scripts/a.mjs"], gate: ["/x/"], pflichtReview: ["AGENTS.md", "/.github/CODEOWNERS"] });
const OWNERS = "AGENTS.md @team\n/.github/CODEOWNERS @team\n";
const ROH = ["AGENTS.md", "/.github/CODEOWNERS", "/scripts/a.mjs", "/x/"];
const KRITERIUM = "Rückfrage bei Löschen, Ruleset/Secrets/Repo-Einstellungen";
const ABGELOEST = "setze das Label maintainer-approved";
const MARKER = "/* x\n * @harness-waechter\n */\n";

describe("(a) CODEOWNERS: Menge und Anker-Form", () => {
  test("gespiegelt: kein Fund", () => {
    expect(ankerFunde(QUELLE, OWNERS, ROH)).toEqual([]);
  });
  test("Menge: eine fehlende CODEOWNERS-Zeile wird genannt", () => {
    expect(ankerFunde(QUELLE, "AGENTS.md @team\n", ROH)).toEqual(["(a) nicht in CODEOWNERS: .github/CODEOWNERS"]);
  });
  test("Anker-Form: /AGENTS.md in CODEOWNERS bei unverankertem Eintrag der Quelle", () => {
    const funde = ankerFunde(QUELLE, "/AGENTS.md @team\n/.github/CODEOWNERS @team\n", ROH);
    expect(funde).toHaveLength(1);
    expect(funde[0]).toContain("(a) Anker-Form");
  });
  test("ein anderer unverankerter Quell-Eintrag als AGENTS.md ist ein Fund", () => {
    const quelle = JSON.stringify({ pflichtReview: ["AGENTS.md", "docs/x.md", "/.github/CODEOWNERS"] });
    const funde = ankerFunde(quelle, "AGENTS.md @team\ndocs/x.md @team\n/.github/CODEOWNERS @team\n", ["AGENTS.md", "docs/x.md", "/.github/CODEOWNERS"]);
    expect(funde).toEqual(["(a) unverankerter Eintrag docs/x.md der Quelle ist nicht bewusst tiefen-unabhängig"]);
  });
});

describe("(a) Sonderfälle", () => {
  test("pflichtReview ohne Liste: die Quelle gilt als nicht lesbar, ohne Wurf", () => {
    const funde = ankerFunde(JSON.stringify({ pflichtReview: "x" }), OWNERS, ["AGENTS.md"]);
    expect(funde.some((f) => f.includes("nicht lesbar"))).toBe(true);
  });
});

describe("(b) AGENTS.md unverankert in der Quelle", () => {
  test("unverankert: kein Fund", () => expect(agentsFunde(["AGENTS.md"])).toEqual([]));
  test("/AGENTS.md: Fund", () => expect(agentsFunde(["/AGENTS.md"]).map((f) => f.slice(0, 3))).toEqual(["(b)", "(b)"]));
  test("fehlt ganz: Fund", () => expect(agentsFunde(["/x/"])).toHaveLength(1));
});

describe("(c) bis (e): Textfunde", () => {
  test("(c) Marker als eigene Zeile außerhalb von test/harness/ ist ein Fund, im Fließtext oder darin nicht", () => {
    expect(textFunde({}, { "test/x.test.ts": MARKER })).toHaveLength(1);
    expect(textFunde({}, { "test/x.test.ts": "siehe @harness-waechter im Text\n" })).toEqual([]);
    expect(textFunde({}, { "test/harness/x.test.ts": MARKER })).toEqual([]);
  });
  test("(d) Kriterientext in docs/ ist ein Fund; AGENTS.md, ADRs und die Ankerdateien nicht", () => {
    expect(textFunde({ "docs/x.md": KRITERIUM }, {}).map((f) => f.slice(0, 3))).toEqual(["(d)", "(d)"]); // zwei Kriterien-Muster treffen
    const frei = { "AGENTS.md": KRITERIUM, "docs/adr/0001-x.md": KRITERIUM, [kernWaechter]: KRITERIUM, [musterModul]: KRITERIUM, "test/harness/x-stopps-projekt.test.ts": KRITERIUM };
    expect(textFunde(frei, {})).toEqual([]);
  });
  test("(e) abgelöster Begriff in docs/ ist ein Fund; ADRs, Kern-Wächter und Muster-Modul nicht, der Projekt-Teil schon", () => {
    expect(textFunde({ "docs/x.md": ABGELOEST }, {}).map((f) => f.slice(0, 3))).toEqual(["(e)"]);
    expect(textFunde({ "docs/adr/0001-x.md": ABGELOEST, [kernWaechter]: ABGELOEST, [musterModul]: ABGELOEST }, {})).toEqual([]);
    expect(textFunde({ "test/harness/x-stopps-projekt.test.ts": ABGELOEST }, {}).map((f) => f.slice(0, 3))).toEqual(["(e)"]);
  });
});

describe("waechterAusserhalb (Modul)", () => {
  test("nur *.test.ts unter test/, außerhalb von test/harness/, mit Marker als eigener Zeile", () => {
    expect(waechterAusserhalb({ "test/x.test.ts": MARKER })).toHaveLength(1);
    expect(waechterAusserhalb({ "test/harness/x.test.ts": MARKER })).toEqual([]);
    expect(waechterAusserhalb({ "test/x.ts": MARKER, "src/x.test.ts": MARKER, "scripts/x.test.ts": MARKER })).toEqual([]);
    expect(waechterAusserhalb({ "test/x.test.ts": "kein Marker\n" })).toEqual([]);
  });
});

describe("Punkt Leitplanken-Quelle", () => {
  const welt = (dateien: Record<string, string>, pfade = Object.keys(dateien)) => ({
    git: ((args) => (args[0] === "ls-files" ? pfade.join("\0") + "\0" : "")) as Git,
    lies: (p: string) => dateien[p] ?? null,
  });
  const GESUND = { ".github/protected-paths.json": QUELLE, ".github/CODEOWNERS": OWNERS };

  test("gesund: OK", () => {
    expect(punkt(welt(GESUND))).toEqual({ punkt: "Leitplanken-Quelle", ok: true });
  });

  test("alle fünf Teilregeln gebrochen: eine Lücke nennt alle Funde ungekürzt, je Teilregel ein Fix", () => {
    const dateien = {
      ".github/protected-paths.json": JSON.stringify({ harness: ["/AGENTS.md", "/.github/CODEOWNERS"] }),
      ".github/CODEOWNERS": "/AGENTS.md @team\n/.github/CODEOWNERS @team\n/fremd/ @team\n",
      "test/w.test.ts": MARKER,
      "docs/k.md": KRITERIUM,
      "docs/e.md": ABGELOEST,
    };
    const p = punkt(welt(dateien));
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    for (const teil of ["(a)", "(b)", "(c)", "(d)", "(e)"]) {
      expect(p.befund, teil).toContain(teil);
      expect(p.fix, teil).toBeTruthy();
    }
    expect(p.befund).toContain("docs/k.md");
    expect(p.befund).toContain("docs/e.md");
  });

  test("der Fix nennt nur die gebrochenen Teilregeln", () => {
    const nurB = punkt(welt({ ".github/protected-paths.json": JSON.stringify({ harness: ["/AGENTS.md", "/.github/CODEOWNERS"] }), ".github/CODEOWNERS": "/AGENTS.md @team\n/.github/CODEOWNERS @team\n" }));
    expect(nurB.befund).toContain("(b)");
    expect(nurB.befund).not.toMatch(/\((a|c|d|e)\)/);
    expect(nurB.fix).toContain("ohne führenden /");
    expect(nurB.fix).not.toContain("Marker");
    expect(nurB.fix).not.toContain("Kriterienliste");
    expect(nurB.fix).not.toContain("abgelöste");
    expect(nurB.fix).not.toContain("CODEOWNERS und die Pflicht-Review-Liste");
  });

  test("nicht prüfbar: Quelle fehlt, kein JSON, Git wirft, Index leer; jeweils mit Fix", () => {
    const fall = [
      punkt(welt({ ".github/CODEOWNERS": OWNERS })),
      punkt(welt({ ".github/protected-paths.json": "{kaputt", ".github/CODEOWNERS": OWNERS })),
      punkt({ git: () => { throw new Error("kein git"); }, lies: (p) => (GESUND as Record<string, string>)[p] ?? null }),
      punkt(welt(GESUND, [])),
    ];
    for (const p of fall) {
      expect(p).toMatchObject({ ok: false, nichtPruefbar: true });
      expect(p.fix).toBeTruthy();
    }
  });

  test("(c) auch ein verschachtelter Test unter test/ (nicht nur direkt darunter) wird gelesen", () => {
    const p = punkt(welt({ ...GESUND, "test/sub/w.test.ts": MARKER }));
    expect(p.befund).toContain("(c) test/sub/w.test.ts");
  });

  test("CODEOWNERS fehlt bei vorhandener Quelle: Lücke", () => {
    const p = punkt(welt({ ".github/protected-paths.json": QUELLE }, [".github/protected-paths.json"]));
    expect(p).toMatchObject({ ok: false });
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain("CODEOWNERS fehlt");
  });

  test("Umfang: Produktcode und Produkttests mit Kriterientext zählen nicht, eine ungetrackte Datei auch nicht", () => {
    const dateien = { ...GESUND, "src/x.ts": KRITERIUM + ABGELOEST, "test/y.test.ts": KRITERIUM + ABGELOEST, "docs/u.md": KRITERIUM };
    const getrackt = Object.keys(dateien).filter((p) => p !== "docs/u.md");
    expect(punkt(welt(dateien, getrackt))).toEqual({ punkt: "Leitplanken-Quelle", ok: true });
    expect(punkt(welt(dateien)).ok).toBe(false);
  });

  test("Dogfood: dieses Repo ist gesund (echtes git, echte Dateien)", async () => {
    const { readFileSync } = await import("node:fs");
    const wurzel = new URL("../", import.meta.url).pathname;
    const lies = (rel: string): string | null => {
      try {
        return readFileSync(wurzel + rel, "utf8");
      } catch {
        return null;
      }
    };
    expect(punkt({ git: gitStandard(wurzel), lies })).toEqual({ punkt: "Leitplanken-Quelle", ok: true });
  }, 20000);
});
