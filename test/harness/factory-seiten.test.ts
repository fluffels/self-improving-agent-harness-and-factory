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
 * Rest der Baseline: `model-routing.md` und `langfuse-hook-patch.md` tragen Messabschnitte des Quellprojekts (Skill- und Tag-Name als Beleg, ein
 * historischer Ordnername) und den Bereichsnamen des lokalen Plugin-Patches; `harness-glossar.md` verlinkt einen ADR-Anker, dessen Überschrift das
 * Quellprojekt nennt. Die Baseline steigt nur per reviewtem Commit (kein maschinelles Anhebungs-Gate wie bei `kern-reinheit`); Besitz-Seiten fallen
 * zusätzlich unter die strengere Regel von `kern-reinheit` (ohne Herkunfts-Maske).
 * Gescannt: `docs/**` Markdown ohne die Historie (`docs/adr/**`, `docs/lessons-learned.md`, `docs/*-gegenprobe-*.md`); `docs/diagramme/*.mmd` ist generiert.
 * Bewusste Grenze: Projektwörter außerhalb der Config (etwa Begriffe der Fachdomäne) und `.mmd`-Dateien erkennt der Wächter nicht; eine Herkunftsprosa
 * ohne Link steht in der Baseline. Die Baseline steigt nur per reviewtem Commit mit Begründung, nie, um ein Rot zu beseitigen. */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { FREMD, projektConfig } from "../support/fremd-config";
import type { BegriffsConfig } from "./kern-reinheit.test";

const { begriffeAus } = rawBesitz as unknown as { begriffeAus: (config: BegriffsConfig) => Record<string, RegExp> };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const BASELINE = "test/harness/factory-seiten-baseline.json";
/** Diese Begriffe teilen sich Quell- und Zielprojekt (Owner, Repo, Board, Label, Skill): sie sind kein Zeichen eines Projektbezugs der Seite. */
const AUSGENOMMEN = new Set(["Owner", "Repo", "Board-ID", "Label", "Skill"]);

type Zaehlung = Record<string, number>;
type Baseline = Record<string, Zaehlung>;

/** Generierte Abschnitte (`<!-- GEN:x START -->` bis `END`) und Herkunftsbezüge raus: Markdown-Link mit http(s)-Ziel (samt Linktext), nackte URL, Querverweis `owner/repo#nr` bzw. `repo#nr`. Generiertes löst die Config selbst auf (Agentennamen im Diagramm), es ist kein Text der Seite. */
export function maskiere(text: string): string {
  return text
    .replace(/<!-- GEN:[\w-]+ START -->[\s\S]*?<!-- GEN:[\w-]+ END -->/g, " ")
    .replace(/\[[^\]\n]*\]\(<?https?:\/\/[^)\s>]*>?[^)\n]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?:[\w.-]+\/)?[\w.-]+#\d+/g, " ");
}

/** Begriffe der Config ohne die geteilten (Owner, Repo, Board-ID, Label, Skill). */
export function seitenBegriffe(config: BegriffsConfig): Record<string, RegExp> {
  return Object.fromEntries(Object.entries(begriffeAus(config)).filter(([name]) => !AUSGENOMMEN.has(name)));
}

/** Zählung je Begriff (nur > 0) nach der Maskierung; rohe Regex-Treffer, Überlappungen zählen je Begriff. */
export function zaehleSeite(text: string, begriffe: Record<string, RegExp>): Zaehlung {
  const t = maskiere(text);
  const out: Zaehlung = {};
  for (const name of Object.keys(begriffe).sort()) {
    const n = (t.match(begriffe[name]) ?? []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

/** Ist `pfad` (repo-relativ, `/`) eine Kern-Wissen-Seite: Markdown unter `docs/`, ohne Historie. */
export function istKernSeite(pfad: string): boolean {
  if (!pfad.startsWith("docs/") || !pfad.endsWith(".md")) return false;
  if (pfad.startsWith("docs/adr/") || pfad === "docs/lessons-learned.md") return false;
  return !/^docs\/[^/]*-gegenprobe-[^/]*\.md$/.test(pfad);
}

/** Alle Kern-Wissen-Seiten unter `wurzel` (sortiert, repo-relativ). */
export function kernSeiten(wurzel: string): string[] {
  const out: string[] = [];
  const geh = (rel: string): void => {
    for (const name of readdirSync(wurzel + rel)) {
      const p = `${rel}${name}`;
      if (statSync(wurzel + p).isDirectory()) geh(`${p}/`);
      else if (istKernSeite(p)) out.push(p);
    }
  };
  if (existsSync(wurzel + "docs")) geh("docs/");
  return out.sort();
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

/** Meldungen: Anstieg (Ist > Baseline) und Rückgang (Ist < Baseline) je Seite und Begriff. */
export function vergleiche(ist: Baseline, baseline: Baseline): string[] {
  const out: string[] = [];
  const pfade = [...new Set([...Object.keys(ist), ...Object.keys(baseline)])].sort();
  for (const pfad of pfade) {
    const a = ist[pfad] ?? {};
    const b = baseline[pfad] ?? {};
    for (const name of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      const nIst = a[name] ?? 0;
      const nBase = b[name] ?? 0;
      if (nIst > nBase) out.push(`${pfad}: Projektwert '${name}' ${nIst}x statt ${nBase}x. Fix: Projektwert als Platzhalter <gruppe.schlüssel> oder die Herkunft als Link schreiben`);
      else if (nIst < nBase) out.push(`${pfad}: Projektwert '${name}' nur noch ${nIst}x, die Baseline kennt ${nBase}x. Fix: Baseline senken (${BASELINE})`);
    }
  }
  return out;
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
