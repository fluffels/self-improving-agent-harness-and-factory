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
 * Ticketnummern (#95): jede nackte drei- oder vierstellige Nummer `#<nr>` zählt je Seite und in der `AGENTS.md` gegen `ticketnummern-baseline.json` (nur sinkend, gleiche
 * Anhebungssperre; fehlt die Datei an der Diff-Basis, gilt die Zählung der Seiten dort). Die Herkunftsform `quellprojekt#<nr>` (Ticket des Quellprojekts), `factory#<nr>` (Ticket des
 * Factory-Repos) und `owner/repo#nr` maskiert `maskiere` schon als Herkunftsbezug. `scripts/herkunftsform.mjs` stellt um. Grenzen: Überschriften (ihr Anker trägt die Nummer) und Code zählen mit
 * und stehen in der Baseline; Nummern mit ein oder zwei Ziffern zählen nicht; jedes `wort#nr` gilt als Herkunftsbezug, auch ein erfundenes Präfix.
 * Gescannt: `docs/**` Markdown ohne die Historie (`docs/adr/**`, `docs/lessons-learned.md`, `docs/*-gegenprobe-*.md`); `docs/diagramme/*.mmd` ist generiert.
 * Zusätzlich zählen die `seitenliterale` der Config (hier Spiel, Spielquote): als `projektliterale` würden sie
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
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawHerkunftsform from "../../scripts/herkunftsform.mjs";
import { type Baseline, type VergleichsTexte, anhebungen, diffBasisModus, vergleiche as vergleicheZaehlung, zaehle } from "../support/baseline-zaehlung";
import { FREMD, projektConfig } from "../support/fremd-config";
import type { BegriffsConfig } from "./kern-reinheit.test";

const { begriffeAus } = rawBesitz as unknown as { begriffeAus: (config: BegriffsConfig) => Record<string, RegExp> };
const { collectMarkdown, GEN_MARKER } = rawMarkdown as unknown as { collectMarkdown: (wurzel: string, wurzeln?: string[]) => string[]; GEN_MARKER: RegExp };

const herkunftsform = rawHerkunftsform as unknown as { standardDateien: (wurzel: string) => string[]; NUMMER: RegExp };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = "test/harness/factory-seiten-baseline.json";
/** Diese Begriffe teilen sich Quell- und Zielprojekt (Owner, Repo, Board, Label, Skill): sie sind kein Zeichen eines Projektbezugs der Seite. */
const AUSGENOMMEN = new Set(["Owner", "Repo", "Board-ID", "Label", "Skill"]);

/** Zeilen vom GEN-START- bis zum END-Marker (einschließlich) raus; erkannt über `GEN_MARKER` aus `markdown.mjs`, kein eigener Nachbau. */
function ohneGenBloecke(text: string): string {
  let offen = false;
  return text
    .split("\n")
    .map((zeile) => {
      const art = GEN_MARKER.exec(zeile)?.[3];
      if (art === "START") offen = true;
      const raus = offen || art !== undefined;
      if (art === "END") offen = false;
      return raus ? "" : zeile;
    })
    .join("\n");
}

/** Generierte Abschnitte (`<!-- GEN:x START -->` bis `END`) und Herkunftsbezüge raus: Markdown-Link mit http(s)-Ziel (samt Linktext), nackte URL, Querverweis `owner/repo#nr` bzw. `repo#nr`. Generiertes löst die Config selbst auf (Agentennamen im Diagramm), es ist kein Text der Seite. */
export function maskiere(text: string): string {
  return ohneGenBloecke(text)
    .replace(/\[[^\]\n]*\]\(<?https?:\/\/[^)\s>]*>?[^)\n]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:[\w.-]+\/)?[\w.-]+#\d+/g, " ")
    .replace(/\]\((?:\.{1,2}\/)*(?:docs\/)?adr\/[^)\s]*\)/g, "]()");
}

/** Begriffe der Config ohne die geteilten (Owner, Repo, Board-ID, Label, Skill), dazu die `seitenliterale` der Config (Fachdomänen-Wörter, die jede Seite meidet, gleiche Wortgrenzen wie ein Projektliteral). */
export function seitenBegriffe(config: BegriffsConfig): Record<string, RegExp> {
  const mitZusatz = { ...config, projektliterale: { ...config.projektliterale, ...config.seitenliterale } };
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

const TICKET_BASELINE = "test/harness/ticketnummern-baseline.json";
const AGENTS = "AGENTS.md";
/** Eine nackte Ticketnummer (3 oder 4 Ziffern) nach der Maskierung: kein Präfix (`quellprojekt#`, `owner/repo#`), kein Dateianker davor, kein Wortzeichen dahinter. */
const NACKTE_NUMMER = herkunftsform.NUMMER; // eine Quelle: was der Wächter zählt, stellt das Werkzeug um
const TICKET_BEGRIFFE = { Ticketnummer: NACKTE_NUMMER };

/** Die Zählung nackter Ticketnummern je Einheit (Seite oder `AGENTS.md`), nur Einheiten mit Treffer. Überschriften und Code zählen mit. */
export function zaehleNummern(einheiten: Record<string, string>): Baseline {
  return zaehleSeiten(einheiten, TICKET_BEGRIFFE);
}

const NUMMER_FIX = "Nummer des Quellprojekts als quellprojekt#<nr>, Nummer des Factory-Repos als factory#<nr> schreiben";
const NUMMER_TEXTE: VergleichsTexte = {
  neu: (pfad, name, n) => `${pfad}: nackte ${name} ${n}x statt 0x. Fix: ${NUMMER_FIX}`,
  ueber: (pfad, name, n, bn) => `${pfad}: nackte ${name} ${n}x statt ${bn}x. Fix: ${NUMMER_FIX}`,
  unter: (pfad, name, n, bn) => `${pfad}: nackte ${name} nur noch ${n}x, die Baseline kennt ${bn}x. Fix: Baseline senken (${TICKET_BASELINE})`,
  verwaist: (pfad, z) => Object.entries(z).map(([name, bn]) => NUMMER_TEXTE.unter(pfad, name, 0, bn)),
};

/** Meldungen: Anstieg und Rückgang nackter Ticketnummern je Einheit gegen die Ticketnummern-Baseline. */
export function vergleicheNummern(ist: Baseline, baseline: Baseline): string[] {
  return vergleicheZaehlung(ist, baseline, NUMMER_TEXTE);
}

/**
 * Der erlaubte Höchstwert je Einheit der Ticketnummern-Baseline: der Stand der Baseline-Datei an der Diff-Basis. Gibt es die Datei dort noch nicht
 * (`alt` ist null, der Einführungs-PR), gilt die Zählung der Einheiten an der Diff-Basis (`basisTexte`, eine fehlende Einheit zählt leer).
 */
export function nummernObergrenze(baseline: Baseline, alt: Baseline | null, basisTexte: Record<string, string>): Baseline {
  return basisWerte(baseline, alt ?? zaehleNummern(basisTexte));
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
    const config = { ...FREMD, projektliterale: { Zelda: "zelda" }, seitenliterale: { Spiel: "Spiel", Spielquote: "Spielquote" } } as unknown as BegriffsConfig;
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

    test("die seitenliterale der Config zählen als ganze Wörter, Beispiel und Spielstand nicht", () => {
      assert.deepEqual(zaehleSeite("Das Spiel, die Spielquote, ein Beispiel, der Spielstand.", B), { Spiel: 1, Spielquote: 1 });
    });

    test("ohne seitenliterale zählt Spiel nicht; ein Fremd-Wort aus den seitenliteralen schon (kein fest eingebautes Wortpaar)", () => {
      const ohne = seitenBegriffe({ ...FREMD, projektliterale: { Zelda: "zelda" } });
      assert.deepEqual(zaehleSeite("Das Spiel und die Quest.", ohne), {});
      const fremd = seitenBegriffe({ ...FREMD, seitenliterale: { Quest: "Quest" } });
      assert.deepEqual(zaehleSeite("Das Spiel und die Quest.", fremd), { Quest: 1 });
    });

    test("die echte Config trägt Spiel und Spielquote als seitenliterale", () => {
      assert.deepEqual(projektConfig().seitenliterale, { Spiel: "Spiel", Spielquote: "Spielquote" });
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

describe("Ticketnummern (#95)", () => {
  const einheiten = (): string[] => [...kernSeiten(WURZEL), AGENTS];
  const echteTexte = (): Record<string, string> => Object.fromEntries(einheiten().map((p) => [p, lesen(p)]));
  const baseline = (): Baseline => JSON.parse(lesen(TICKET_BASELINE)) as Baseline;
  const z = (text: string): number => zaehleNummern({ "docs/a.md": text })["docs/a.md"]?.Ticketnummer ?? 0;

  describe("Zählung", () => {
    test("eine nackte drei- oder vierstellige Nummer zählt, auch beide in (#992/#1087)", () => {
      assert.equal(z("siehe #1234"), 1);
      assert.equal(z("siehe #123."), 1);
      assert.equal(z("(#992/#1087)"), 2);
    });
    test("Herkunftsformen, Anker, Zahlen anderer Länge und Wortreste zählen nicht", () => {
      for (const t of ["quellprojekt#1234", "factory#123", "kubernia#1883", "owner/repo#12", "x.md#1234", "#12", "#12345", "#123abc", "#1234_x", "ä#1234", "PR-#1234", "a_#1234"]) assert.equal(z(t), 0, t);
    });
    test("ein http-Link samt Text, eine URL und ein GEN-Block zählen nicht", () => {
      assert.equal(z("[#1949](https://github.com/o/r/issues/1949) https://x.de/#1234"), 0);
      assert.equal(z("<!-- GEN:a START -->\n#1234\n<!-- GEN:a END -->"), 0);
    });
    test("Überschrift, Inline-Code und Code-Fence zählen mit (die Umstellung lässt sie bewusst aus)", () => {
      assert.equal(z("## Titel (#1875)"), 1);
      assert.equal(z("`#1234`"), 1);
      assert.equal(z("```\n#1234\n```"), 1);
    });
    test("zaehleNummern nennt nur Einheiten mit Treffer", () => {
      assert.deepEqual(zaehleNummern({ "docs/a.md": "#1234", "docs/b.md": "nichts" }), { "docs/a.md": { Ticketnummer: 1 } });
    });
  });

  describe("Vergleich", () => {
    test("gleiche Zählung ist grün", () => {
      assert.deepEqual(vergleicheNummern({ "docs/a.md": { Ticketnummer: 2 } }, { "docs/a.md": { Ticketnummer: 2 } }), []);
    });
    test("eine zusätzliche Nummer (auch auf einer Seite ohne Eintrag) ist rot und nennt den Fix", () => {
      const m = vergleicheNummern({ "docs/a.md": { Ticketnummer: 2 }, "docs/b.md": { Ticketnummer: 1 } }, { "docs/a.md": { Ticketnummer: 1 } });
      assert.equal(m.length, 2);
      assert.match(m[0] ?? "", /^docs\/a\.md: nackte Ticketnummer 2x statt 1x\. Fix: Nummer des Quellprojekts als quellprojekt#<nr>, Nummer des Factory-Repos als factory#<nr>/);
      assert.match(m[1] ?? "", /^docs\/b\.md: nackte Ticketnummer 1x statt 0x/);
    });
    test("ein Rückgang ist rot und verlangt, die Baseline zu senken", () => {
      const m = vergleicheNummern({ "docs/a.md": { Ticketnummer: 1 } }, { "docs/a.md": { Ticketnummer: 2 }, "docs/b.md": { Ticketnummer: 1 } });
      assert.equal(m.length, 2);
      assert.match(m[0] ?? "", /^docs\/a\.md: nackte Ticketnummer nur noch 1x, die Baseline kennt 2x\. Fix: Baseline senken \(test\/harness\/ticketnummern-baseline\.json\)/);
      assert.match(m[1] ?? "", /^docs\/b\.md: .*nur noch 0x/);
    });
  });

  describe("echte Seiten", () => {
    test("Seiten und AGENTS.md entsprechen der Baseline: keine neue nackte Ticketnummer, keine veraltete Zeile", () => {
      assert.deepEqual(vergleicheNummern(zaehleNummern(echteTexte()), baseline()), []);
    });
    test("Negativfall: eine angehängte nackte Nummer an einer Seite oder an AGENTS.md macht den Wächter rot", () => {
      for (const pfad of ["docs/model-routing.md", AGENTS, "docs/referenz/befehle.md"]) {
        const texte = { ...echteTexte(), [pfad]: lesen(pfad) + "\nSiehe #1234.\n" };
        const m = vergleicheNummern(zaehleNummern(texte), baseline());
        assert.equal(m.length, 1, pfad);
        assert.match(m[0] ?? "", new RegExp(`^${pfad.replace(".", "\\.")}: nackte Ticketnummer \\d+x statt \\d+x`));
      }
    });
    test("die Baseline ist sortiert, kennt nur Ticketnummer und Werte > 0", () => {
      const b = baseline();
      assert.deepEqual(Object.keys(b), Object.keys(b).sort());
      for (const w of Object.values(b)) {
        assert.deepEqual(Object.keys(w), ["Ticketnummer"]);
        assert.ok((w.Ticketnummer ?? 0) > 0);
      }
    });
    test("die Standardliste der Umstellung ist genau die Menge der gezählten Einheiten", () => {
      assert.deepEqual([...herkunftsform.standardDateien(WURZEL)].sort(), einheiten().sort());
    });
  });

  describe("Anhebungssperre (nummernObergrenze)", () => {
    const B = (n: number): Baseline => ({ "docs/a.md": { Ticketnummer: n } });
    test("mit Datei an der Basis gilt deren Wert: höher ist rot, gleich oder kleiner grün", () => {
      assert.equal(anhebungen(B(3), nummernObergrenze(B(3), B(2), {})).length, 1);
      assert.deepEqual(anhebungen(B(2), nummernObergrenze(B(2), B(2), {})), []);
      assert.deepEqual(anhebungen(B(1), nummernObergrenze(B(1), B(2), {})), []);
    });
    test("ohne Datei an der Basis (Einführungs-PR) gilt die Zählung der Seiten an der Basis: höher ist rot, gleich oder kleiner grün", () => {
      const basisTexte = { "docs/a.md": "#1234 #1235" };
      assert.equal(anhebungen(B(3), nummernObergrenze(B(3), null, basisTexte)).length, 1);
      assert.deepEqual(anhebungen(B(2), nummernObergrenze(B(2), null, basisTexte)), []);
      assert.deepEqual(anhebungen(B(1), nummernObergrenze(B(1), null, basisTexte)), []);
    });
    test("ohne Datei an der Basis ist eine dort fehlende Seite leer gezählt: jeder Wert ist eine Anhebung", () => {
      assert.equal(anhebungen(B(1), nummernObergrenze(B(1), null, {})).length, 1);
    });
    test("mit Datei an der Basis zählen die Seiten dort nicht (Datei hat Vorrang)", () => {
      assert.equal(anhebungen(B(2), nummernObergrenze(B(2), B(1), { "docs/a.md": "#1234 #1235 #1236" })).length, 1);
    });
  });

  const git = (args: string[]): string => execFileSync("git", args, { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
  const basis: string | null = checkBasis.resolveBase(git, process.env) ?? null;
  const ausBasis = (pfad: string): string | null => {
    try {
      return execFileSync("git", ["show", `${basis}:${pfad}`], { cwd: WURZEL, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      return null; // die Datei gibt es an der Basis nicht
    }
  };

  test.skipIf(diffBasisModus(basis, process.env) === "entfaellt")("die Ticketnummern-Baseline wurde gegen die Diff-Basis nicht angehoben", () => {
    assert.ok(basis, "keine Diff-Basis auflösbar (FACTORY_DIFF_BASE/origin/main fehlt)");
    const datei = ausBasis(TICKET_BASELINE);
    const alt = datei === null ? null : (JSON.parse(datei) as Baseline);
    const b = baseline();
    const basisTexte = alt === null ? Object.fromEntries(Object.keys(b).map((p) => [p, ausBasis(p) ?? ""])) : {};
    assert.deepEqual(anhebungen(b, nummernObergrenze(b, alt, basisTexte)), []);
  });
});
