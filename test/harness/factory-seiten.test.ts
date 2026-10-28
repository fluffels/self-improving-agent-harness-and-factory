/* Factory-Seiten-Wächter (#77, ADR 0022 F10): die Kern-Wissen-Seiten unter `docs/` nennen Projektwerte als Platzhalter `<gruppe.schlüssel>`
 * und das Quellprojekt nur noch als Herkunftsbezug (Link, `owner/repo#nr`).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft: je Seite die rohen Treffer jedes Begriffs aus `begriffeAus(config)` (Präfixe, Env, Branch, Worktree, Agenten, `projektliterale`; Owner,
 * Repo, Board-ID, Label und Skill bleiben außen, die teilen sich die Configs von Quell- und Zielprojekt). Inline-Code und Code-Fences zählen mit:
 * `kq-<nr>` und ein Agentenname in einem Kommando sind Projektwerte. Vorher werden Herkunftsbezüge maskiert: ein Markdown-Link mit http(s)-Ziel samt
 * Linktext, eine nackte URL und ein Querverweis `owner/repo#nr` bzw. `repo#nr`. Die Zählung je Seite und Begriff (nur Werte > 0) wird exakt mit
 * `factory-seiten-baseline.json` verglichen: ein Anstieg ist rot („Platzhalter oder Link schreiben“), ein Rückgang ebenfalls („Baseline senken“).
 *
 * Generierte Abschnitte (`GEN`-Marker, `check:docgen`) zählen nicht: die Config löst dort selbst auf.
 * Rest der Baseline: `model-routing.md` trägt Messabschnitte des Quellprojekts (Skill- und Tag-Name als Beleg, ein
 * historischer Ordnername). Die Baseline steigt nie: ein Test sperrt jede Anhebung gegen die Diff-Basis (`anhebungen` aus `test/support/baseline-zaehlung.ts`, wie bei `kern-reinheit`); Besitz-Seiten fallen
 * zusätzlich unter die strengere Regel von `kern-reinheit` (ohne Herkunfts-Maske).
 * Gescannt: `docs/**` Markdown ohne die Historie (`docs/adr/**`, `docs/lessons-learned.md`, `docs/*-gegenprobe-*.md`); `docs/diagramme/*.mmd` ist generiert.
 * Zusätzlich zur Config zählen die Fachdomänen-Wörter `SEITEN_ZUSATZ` (Spiel, Spielquote): sie sind kein Config-Wert, würden als `projektliterale` aber
 * jede Kern-Einheit und jeden Kern-Test treffen; die Seiten sprechen von Produkt. Das Ziel eines Links in `adr/` zählt nicht: sein Anker trägt
 * die unveränderliche Überschrift der Historie.
 * Bewusste Grenze: andere Projektwörter außerhalb der Config und `.mmd`-Dateien erkennt der Wächter nicht; eine Herkunftsprosa
 * ohne Link steht in der Baseline. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as checkBasis from "../../scripts/check-basis.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMarkdown from "../../scripts/docs-gen/markdown.mjs";
import { type Baseline, type VergleichsTexte, anhebungen, diffBasisModus, vergleiche as vergleicheZaehlung, zaehle } from "../support/baseline-zaehlung";
import { FREMD, projektConfig } from "../support/fremd-config";
import type { BegriffsConfig } from "./kern-reinheit.test";

const { begriffeAus } = rawBesitz as unknown as { begriffeAus: (config: BegriffsConfig) => Record<string, RegExp> };
const { collectMarkdown } = rawMarkdown as unknown as { collectMarkdown: (wurzel: string, wurzeln?: string[]) => string[] };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = "test/harness/factory-seiten-baseline.json";
/** Diese Begriffe teilen sich Quell- und Zielprojekt (Owner, Repo, Board, Label, Skill): sie sind kein Zeichen eines Projektbezugs der Seite. */
const AUSGENOMMEN = new Set(["Owner", "Repo", "Board-ID", "Label", "Skill"]);

/** Generierte Abschnitte (`<!-- GEN:x START -->` bis `END`) und Herkunftsbezüge raus: Markdown-Link mit http(s)-Ziel (samt Linktext), nackte URL, Querverweis `owner/repo#nr` bzw. `repo#nr`. Generiertes löst die Config selbst auf (Agentennamen im Diagramm), es ist kein Text der Seite. */
export function maskiere(text: string): string {
  return text
    .replace(/<!-- GEN:[\w-]+ START -->[\s\S]*?<!-- GEN:[\w-]+ END -->/g, " ")
    .replace(/\[[^\]\n]*\]\(<?https?:\/\/[^)\s>]*>?[^)\n]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:[\w.-]+\/)?[\w.-]+#\d+/g, " ")
    .replace(/\]\((?:\.{1,2}\/)*(?:docs\/)?adr\/[^)\s]*\)/g, "]()");
}

/** Fachdomänen-Wörter, die jede Seite meidet (kein Config-Wert): Produkt-Begriffe statt Spiel-Begriffen. Gleiche Wortgrenzen wie ein Projektliteral. */
export const SEITEN_ZUSATZ: Record<string, string> = { Spiel: "Spiel", Spielquote: "Spielquote" };

/** Begriffe der Config ohne die geteilten (Owner, Repo, Board-ID, Label, Skill), dazu `SEITEN_ZUSATZ`. */
export function seitenBegriffe(config: BegriffsConfig): Record<string, RegExp> {
  const mitZusatz = { ...config, projektliterale: { ...config.projektliterale, ...SEITEN_ZUSATZ } };
  return Object.fromEntries(Object.entries(begriffeAus(mitZusatz)).filter(([name]) => !AUSGENOMMEN.has(name)));
}

/** Zählung je Begriff (nur > 0) nach der Maskierung; rohe Regex-Treffer, Überlappungen zählen je Begriff. */
export function zaehleSeite(text: string, begriffe: Record<string, RegExp>): Record<string, number> {
  return zaehle(maskiere(text), begriffe);
}

/** Ist `pfad` (repo-relativ, `/`) eine Kern-Wissen-Seite: Markdown unter `docs/`, ohne Historie. */
export function istKernSeite(pfad: string): boolean {
  if (!pfad.startsWith("docs/") || !pfad.endsWith(".md")) return false;
  if (pfad.startsWith("docs/adr/") || pfad === "docs/lessons-learned.md") return false;
  return !/^docs\/[^/]*-gegenprobe-[^/]*\.md$/.test(pfad);
}

/** Alle Kern-Wissen-Seiten unter `wurzel` (sortiert, repo-relativ). */
export function kernSeiten(wurzel: string): string[] {
  return collectMarkdown(wurzel, ["docs"]).filter(istKernSeite);
}

/** Die Zählung aller Seiten (nur Seiten mit Treffer), Schlüssel sortiert. */
export function zaehleSeiten(seiten: Record<string, string>, begriffe: Record<string, RegExp>): Baseline {
  const out: Baseline = {};
  for (const pfad of Object.keys(seiten).sort()) {
    const z = zaehleSeite(seiten[pfad], begriffe);
    if (Object.keys(z).length > 0) out[pfad] = z;
  }
  return out;
}

const SEITEN_TEXTE: VergleichsTexte = {
  neu: (pfad, name, n) => `${pfad}: Projektwert '${name}' ${n}x statt 0x. Fix: Projektwert als Platzhalter <gruppe.schlüssel> oder die Herkunft als Link schreiben`,
  ueber: (pfad, name, n, bn) => `${pfad}: Projektwert '${name}' ${n}x statt ${bn}x. Fix: Projektwert als Platzhalter <gruppe.schlüssel> oder die Herkunft als Link schreiben`,
  unter: (pfad, name, n, bn) => `${pfad}: Projektwert '${name}' nur noch ${n}x, die Baseline kennt ${bn}x. Fix: Baseline senken (${BASELINE})`,
  verwaist: (pfad, z) => Object.entries(z).map(([name, bn]) => SEITEN_TEXTE.unter(pfad, name, 0, bn)),
};

/** Meldungen: Anstieg (Ist > Baseline) und Rückgang (Ist < Baseline) je Seite und Begriff. */
export function vergleiche(ist: Baseline, baseline: Baseline): string[] {
  return vergleicheZaehlung(ist, baseline, SEITEN_TEXTE);
}

/** Der erlaubte Höchstwert je Seite der aktuellen Baseline: der Stand an der Diff-Basis, für eine dort unbekannte Seite leer (jeder Wert wäre eine Anhebung). */
export function basisWerte(baseline: Baseline, basis: Baseline): Baseline {
  return Object.fromEntries(Object.keys(baseline).map((pfad) => [pfad, basis[pfad] ?? {}]));
}

const lesen = (pfad: string): string => readFileSync(WURZEL + pfad, "utf8");

describe("Factory-Seiten (#77)", () => {
  test("die Seiten entsprechen der Baseline: kein neuer Projektwert, keine veraltete Baseline-Zeile", () => {
    const seiten: Record<string, string> = {};
    for (const p of kernSeiten(WURZEL)) seiten[p] = lesen(p);
    const baseline = JSON.parse(lesen(BASELINE)) as Baseline;
    assert.deepEqual(vergleiche(zaehleSeiten(seiten, seitenBegriffe(projektConfig() as unknown as BegriffsConfig)), baseline), []);
  });

  test("die Baseline ist sortiert und kennt nur Werte > 0", () => {
    const baseline = JSON.parse(lesen(BASELINE)) as Baseline;
    assert.deepEqual(Object.keys(baseline), Object.keys(baseline).sort());
    for (const z of Object.values(baseline)) {
      assert.deepEqual(Object.keys(z), Object.keys(z).sort());
      for (const n of Object.values(z)) assert.ok(n > 0);
    }
  });

  const git = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;

  // In der CI (fail-closed) muss die Basis auflösbar sein; lokal ohne Basis entfällt die Prüfung (Muster von `kern-reinheit`).
  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("die Baseline wurde gegen die Diff-Basis nicht angehoben", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (FACTORY_DIFF_BASE/origin/main fehlt)");
    let alt: Baseline = {};
    try {
      alt = JSON.parse(git(["show", `${basis}:${BASELINE}`])) as Baseline;
    } catch {
      // die Datei gibt es an der Basis noch nicht: jeder Wert ist neu
    }
    const baseline = JSON.parse(lesen(BASELINE)) as Baseline;
    assert.deepEqual(anhebungen(baseline, basisWerte(baseline, alt)), []);
  });

  describe("Anhebungssperre (basisWerte)", () => {
    test("ein höherer Wert als an der Basis ist rot und nennt Seite, Begriff und beide Werte", () => {
      const m = anhebungen({ "docs/a.md": { Zelda: 2 } }, basisWerte({ "docs/a.md": { Zelda: 2 } }, { "docs/a.md": { Zelda: 1 } }));
      assert.equal(m.length, 1);
      assert.match(m[0] ?? "", /^docs\/a\.md: Baseline 'Zelda' 2 über dem Wert an der Diff-Basis \(1\), anheben ist verboten/);
    });
    test("ein neuer Begriff auf bekannter Seite und eine neue Seite sind ebenfalls Anhebungen", () => {
      assert.equal(anhebungen({ "docs/a.md": { Zelda: 1, Agent: 1 } }, basisWerte({ "docs/a.md": { Zelda: 1, Agent: 1 } }, { "docs/a.md": { Zelda: 1 } })).length, 1);
      assert.equal(anhebungen({ "docs/neu.md": { Zelda: 1 } }, basisWerte({ "docs/neu.md": { Zelda: 1 } }, {})).length, 1);
    });
    test("gleicher oder kleinerer Wert und eine entfernte Seite sind grün", () => {
      const basis = { "docs/a.md": { Zelda: 2 }, "docs/b.md": { Agent: 1 } };
      assert.deepEqual(anhebungen({ "docs/a.md": { Zelda: 2 } }, basisWerte({ "docs/a.md": { Zelda: 2 } }, basis)), []);
      assert.deepEqual(anhebungen({ "docs/a.md": { Zelda: 1 } }, basisWerte({ "docs/a.md": { Zelda: 1 } }, basis)), []);
      assert.deepEqual(anhebungen({}, basisWerte({}, basis)), []);
    });
  });

  describe("Fixture-Config", () => {
    const config = { ...FREMD, projektliterale: { Zelda: "zelda" } } as unknown as BegriffsConfig;
    const B = seitenBegriffe(config);

    test("die Begriffe kommen aus der Config; Owner, Repo, Board-ID, Label und Skill sind ausgenommen", () => {
      assert.ok("Zelda" in B && "Praefix" in B && "Agent" in B && "Worktree" in B);
      for (const n of AUSGENOMMEN) assert.ok(!(n in B), n);
    });

    test("ein Literal und ein Präfix zählen im Fließtext und im Inline-Code", () => {
      const t = "Zelda läuft. Im Code `zz-12` und `ZZ-Plan:`, dazu `--agent zz-lens`.";
      assert.deepEqual(zaehleSeite(t, B), { Agent: 1, Praefix: 1, Worktree: 2, Zelda: 1 });
    });

    test("Code-Fences zählen mit", () => {
      assert.deepEqual(zaehleSeite("```\nZelda\n```\n", B), { Zelda: 1 });
    });

    test("im Linktext eines http-Links, in einer nackten URL und in owner/repo#nr zählt das Literal nicht", () => {
      const t = "[Zelda](https://github.com/zz-org/zelda/issues/1) und https://github.com/zz-org/zelda/pull/2 und zz-org/zelda#12 und zelda#3.";
      assert.deepEqual(zaehleSeite(t, B), {});
    });

    test("ein relativer Link zählt (kein Herkunftsbezug): Wortgrenze, `zeldaartig` trifft nicht", () => {
      assert.deepEqual(zaehleSeite("[Zelda](zelda.md) zeldaartig", B), { Zelda: 2 });
    });

    test("ein generierter Abschnitt zählt nicht, der Text davor und danach schon", () => {
      const t = "Zelda\n<!-- GEN:a START -->\nZelda zz-lens\n<!-- GEN:a END -->\nZelda";
      assert.deepEqual(zaehleSeite(t, B), { Zelda: 2 });
    });

    test("Spiel und Spielquote zählen als ganze Wörter in jeder Config, Beispiel und Spielstand nicht", () => {
      assert.deepEqual(zaehleSeite("Das Spiel, die Spielquote, ein Beispiel, der Spielstand.", B), { Spiel: 1, Spielquote: 1 });
    });

    test("das Ziel eines Links in adr/ zählt nicht (Anker der Historie), ein Ziel außerhalb und der Linktext schon", () => {
      assert.deepEqual(zaehleSeite("[ADR](../adr/0022-x.md#ohne-spiel-generator) [ADR](adr/0016-y.md#spielquote-im-takt) [ADR](docs/adr/0016-y.md#zelda)", B), {});
      assert.deepEqual(zaehleSeite("[Spiel](adr/0016-y.md#a)", B), { Spiel: 1 });
      assert.deepEqual(zaehleSeite("[ADR](docs/spiel-regeln.md#spiel)", B), { Spiel: 2 }, "ein Ziel außerhalb von adr/ zählt");
      assert.deepEqual(zaehleSeite("[ADR](ordner/adr/x.md#spiel)", B), { Spiel: 1 }, "adr/ nur am Anfang des Pfads");
    });

    test("ein Anker mit Buchstaben ist kein Querverweis: Zelda in zelda.md#abschnitt zählt", () => {
      assert.deepEqual(zaehleSeite("[Zelda](zelda.md#abschnitt)", B), { Zelda: 2 });
    });
  });

  describe("istKernSeite", () => {
    test("Seiten unter docs/ zählen, die Historie und Nicht-Markdown nicht", () => {
      assert.equal(istKernSeite("docs/model-routing.md"), true);
      assert.equal(istKernSeite("docs/referenz/befehle.md"), true);
      assert.equal(istKernSeite("docs/adr/0022-x.md"), false);
      assert.equal(istKernSeite("docs/lessons-learned.md"), false);
      assert.equal(istKernSeite("docs/lens-gegenprobe-2026.md"), false);
      assert.equal(istKernSeite("docs/planer-gegenprobe-1.md"), false);
      assert.equal(istKernSeite("docs/sub/x-gegenprobe-y.md"), true, "die Gegenprobe-Regel gilt nur direkt unter docs/");
      assert.equal(istKernSeite("docs/diagramme/a.mmd"), false);
      assert.equal(istKernSeite("README.md"), false);
    });
  });

  describe("kernSeiten und zaehleSeiten", () => {
    test("kernSeiten geht in Unterordner, lässt die Historie und Nicht-Markdown aus; ohne docs/ ist die Liste leer", () => {
      const dir = mkdtempSync(join(tmpdir(), "factory-seiten-"));
      try {
        for (const f of ["docs/a.md", "docs/sub/b.md", "docs/adr/c.md", "docs/lessons-learned.md", "docs/x-gegenprobe-y.md", "docs/d.mmd", "README.md"]) {
          mkdirSync(dirname(join(dir, f)), { recursive: true });
          writeFileSync(join(dir, f), "x");
        }
        assert.deepEqual(kernSeiten(dir + "/"), ["docs/a.md", "docs/sub/b.md"]);
        const leer = mkdtempSync(join(tmpdir(), "factory-seiten-leer-"));
        try {
          assert.deepEqual(kernSeiten(leer + "/"), []);
        } finally {
          rmSync(leer, { recursive: true, force: true });
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
    test("zaehleSeiten nennt nur Seiten mit Treffer", () => {
      const B = seitenBegriffe({ ...FREMD, projektliterale: { Zelda: "zelda" } });
      assert.deepEqual(zaehleSeiten({ "docs/a.md": "Zelda", "docs/b.md": "nichts" }, B), { "docs/a.md": { Zelda: 1 } });
    });
  });

  describe("vergleiche", () => {
    test("gleiche Zählung: keine Meldung", () => {
      assert.deepEqual(vergleiche({ "docs/a.md": { Zelda: 1 } }, { "docs/a.md": { Zelda: 1 } }), []);
      assert.deepEqual(vergleiche({}, {}), []);
    });
    test("ein Anstieg (auch auf einer neuen Seite) ist rot und nennt den Fix", () => {
      const m = vergleiche({ "docs/a.md": { Zelda: 2 }, "docs/b.md": { Agent: 1 } }, { "docs/a.md": { Zelda: 1 } });
      assert.equal(m.length, 2);
      assert.match(m[0] ?? "", /^docs\/a\.md: .*'Zelda' 2x statt 1x.*Platzhalter <gruppe\.schlüssel> oder die Herkunft als Link/);
      assert.match(m[1] ?? "", /^docs\/b\.md: .*'Agent' 1x statt 0x/);
    });
    test("ein Rückgang ist rot und verlangt, die Baseline zu senken", () => {
      const m = vergleiche({ "docs/a.md": { Zelda: 1 } }, { "docs/a.md": { Zelda: 2 }, "docs/b.md": { Agent: 1 } });
      assert.equal(m.length, 2);
      assert.match(m[0] ?? "", /^docs\/a\.md: .*nur noch 1x.*kennt 2x.*Baseline senken/);
      assert.match(m[1] ?? "", /^docs\/b\.md: .*nur noch 0x/);
    });
  });
});
