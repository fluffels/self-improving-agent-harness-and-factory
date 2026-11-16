/* Risikostufen-Ablauf-Wächter (factory#527, Teil 3/5 des Epics factory#511) – der Ablauf startet je Risikostufe nur die vorgesehenen Rollen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geschlossene Musterliste (jedes Muster prüft eine Datei des Ablaufs; Nachweis-Wächter rechnen die Stufe aus dem Diff, dieser Test koppelt die Texte):
 *   (a) `ablauf.md`: `risikostufe.mjs --ticket <nr>` steht vor dem Planer-Spawn, `Plan ohne Planer: stufe <n> — <Pfade>`, Sammelticket, Epic und Fortsetzung sind ausgenommen,
 *       „Risikostufe überschritten“ läuft als Fortsetzung mit Planer.
 *   (b) `umsetzer-risikostufe.md`: `abgebrochen — Risikostufe überschritten`, `ohne — stufe 0`, `entfaellt — stufe`.
 *   (c) `ablauf-risikostufe.md`: Stufe 0 ohne Lens, Stufe 1 mit Cap 1.
 *   (d) `ablauf-klasse-hoch.md` und der Planer nennen `risikostufe.mjs` als Auslöser.
 *   (e) AGENTS.md nennt die drei Stufen im Mehr-Perspektiven-Review.
 *   (f) Die Abbildung `Plan ohne Planer: stufe <n> — <Pfade>` → `Plan: ohne — stufe <n>` ergibt eine Zeile, die `stufeGrund` (nachweis-lib) als Stufe liest.
 * Bekannte Grenze: der Test prüft Text, nicht das Verhalten des Hauptchats; falsche Stufenangaben fangen die Diff-Prüfung des Umsetzers und die CI-Wächter.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as nachweisRaw from "../../scripts/nachweis-lib.mjs";

const { stufeGrund } = nachweisRaw as unknown as { stufeGrund: (g: string) => { stufe: number } | null };
const wurzel = fileURLToPath(new URL("../../", import.meta.url));
const DATEIEN = {
  ablauf: ".agents/skills/factory/ablauf.md",
  umsetzer: ".agents/skills/factory/umsetzer-risikostufe.md",
  review: ".agents/skills/review-lenses/ablauf-risikostufe.md",
  klasseHoch: ".agents/skills/review-lenses/ablauf-klasse-hoch.md",
  planer: ".claude/agents/factory-planer.md",
  agents: "AGENTS.md",
} as const;
type Texte = Record<keyof typeof DATEIEN, string>;

const lies = (): Texte => Object.fromEntries(Object.entries(DATEIEN).map(([k, p]) => [k, readFileSync(wurzel + p, "utf8")])) as Texte;
const fehlt = (t: string, muster: (string | RegExp)[], name: string): string[] =>
  muster.filter((m) => (typeof m === "string" ? !t.includes(m) : !m.test(t))).map((m) => `${name}: fehlt ${String(m)}`);

/** Alle Befunde über die Texte des Ablaufs (leer = konsistent). Pur. */
function befunde(t: Texte): string[] {
  const f: string[] = [];
  const iRisiko = t.ablauf.indexOf("risikostufe.mjs --ticket <nr>");
  const iPlaner = t.ablauf.indexOf('subagent_type: "<agenten.planer>"');
  if (iRisiko < 0 || iPlaner < 0 || iRisiko > iPlaner) f.push("ablauf.md: `risikostufe.mjs --ticket <nr>` steht nicht vor dem Planer-Spawn");
  f.push(...fehlt(t.ablauf, ["Plan ohne Planer: stufe <n> — <Pfade>", "Risikostufe überschritten", /Risikostufe überschritten[\s\S]{0,300}Fortsetzungsauftrag/], "ablauf.md"));
  const absatz = t.ablauf.slice(Math.max(iRisiko, 0), iPlaner > 0 ? iPlaner : undefined);
  f.push(...fehlt(absatz, [/weder Sammelticket[^.]*noch Epic noch Fortsetzung/], "ablauf.md (Absatz Risikostufe)"));
  f.push(...fehlt(t.umsetzer, ["abgebrochen — Risikostufe überschritten", "Review: ohne — stufe 0", "Abnahme: entfaellt — stufe 0", "Abnahme: entfaellt — stufe 1", "risikostufe.mjs", "Plan: ohne — stufe <n>"], "umsetzer-risikostufe.md"));
  f.push(...fehlt(t.review, [/Stufe 0:\*\* kein Lens-Pass/, /Stufe 1:\*\*[^\n]*Cap 1/, "MAX_REVIEW_PAESSE_STUFE1"], "ablauf-risikostufe.md"));
  f.push(...fehlt(t.klasseHoch, ["risikostufe.mjs", "RISIKOSTUFE: 2"], "ablauf-klasse-hoch.md"));
  f.push(...fehlt(t.planer, ["risikostufe.mjs --pfade", "RISIKOSTUFE: 2"], "factory-planer.md"));
  const bullet = t.agents.split("\n").find((z) => z.startsWith("- **Mehr-Perspektiven-Review")) ?? "";
  f.push(...fehlt(bullet, ["risikostufe.mjs", /0 ohne Planer, Lens, Abnahme/, /1 ohne Planer, Abnahme, Cap 1/, /2 voll, Sicherheits-Lens/], "AGENTS.md"));
  const abbild = /`<praefixe\.commitZeile>Plan: ohne — (stufe <n>)`/.exec(t.umsetzer)?.[1];
  const zeile = abbild?.replace("<n>", "1");
  if (!zeile || stufeGrund(zeile)?.stufe !== 1) f.push(`umsetzer-risikostufe.md: Abbildung ergibt keine gültige Stufen-Zeile (${zeile ?? "nicht gefunden"})`);
  return f;
}

describe("Risikostufen-Ablauf (factory#527)", () => {
  test("die Texte des Ablaufs sind konsistent", () => {
    assert.deepEqual(befunde(lies()), []);
  });

  test("(f) die Abbildung ist für stufeGrund lesbar, ein Gedankenstrich hinter der Stufe nicht", () => {
    assert.deepEqual(stufeGrund("stufe 0"), { stufe: 0 });
    assert.deepEqual(stufeGrund("stufe 1"), { stufe: 1 });
    assert.equal(stufeGrund("stufe 1 — scripts/x.mjs"), null);
  });

  /** Je Eintrag: Name, Datei, Verfälschung (alt → neu, alle Treffer) und der Teilstring, den der Befund nennen muss. */
  const verfaelschungen: [string, keyof Texte, string, string, string][] = [
    ["Prognose-Aufruf kaputt", "ablauf", "risikostufe.mjs --ticket <nr>", "risikostufe.mjs --tick <nr>", "steht nicht vor dem Planer-Spawn"],
    ["Prompt-Form fehlt", "ablauf", "Plan ohne Planer: stufe <n> — <Pfade>", "Plan ohne Planer", "ablauf.md: fehlt"],
    ["Sammelticket nicht ausgenommen", "ablauf", "noch Epic noch Fortsetzung", "noch Epic", "Absatz Risikostufe"],
    ["Überschreiten ohne Fortsetzung", "ablauf", "Risikostufe überschritten", "Stufe zu hoch", "ablauf.md: fehlt"],
    ["Überschreiten ohne Fortsetzungsauftrag", "ablauf", "Fortsetzungsauftrag", "Auftrag", "Fortsetzungsauftrag"],
    ["Umsetzer meldet nicht", "umsetzer", "abgebrochen — Risikostufe überschritten", "abgebrochen", "umsetzer-risikostufe.md: fehlt"],
    ["Stufe 0 ohne Review-Zeile", "umsetzer", "Review: ohne — stufe 0", "Review: kombiniert", "ohne — stufe 0"],
    ["Stufe 0 ohne Abnahme-Zeile", "umsetzer", "Abnahme: entfaellt — stufe 0", "Abnahme: voll", "entfaellt — stufe 0"],
    ["Stufe 1 ohne Abnahme-Zeile", "umsetzer", "Abnahme: entfaellt — stufe 1", "Abnahme: voll", "entfaellt — stufe 1"],
    ["Umsetzer ohne Stufenprüfung", "umsetzer", "risikostufe.mjs", "stufen.mjs", "risikostufe.mjs"],
    ["Abbildung mit Gedankenstrich", "umsetzer", "Plan: ohne — stufe <n>`", "Plan: ohne — stufe — <n>`", "Abbildung"],
    ["Stufe 0 mit Lens", "review", "kein Lens-Pass", "ein Lens-Pass", "ablauf-risikostufe.md: fehlt"],
    ["Stufe 1 ohne Cap", "review", "(Cap 1, also", "(also", "ablauf-risikostufe.md: fehlt"],
    ["Stufe 1 ohne Wächter-Konstante", "review", "MAX_REVIEW_PAESSE_STUFE1", "MAX_X", "MAX_REVIEW_PAESSE_STUFE1"],
    ["Klasse hoch ohne Stufe", "klasseHoch", "RISIKOSTUFE: 2", "RISIKO: hoch", "ablauf-klasse-hoch.md: fehlt"],
    ["Klasse hoch ohne Skript", "klasseHoch", "risikostufe.mjs", "alt-skript.mjs", "ablauf-klasse-hoch.md: fehlt"],
    ["Planer ohne Auslöser", "planer", "risikostufe.mjs --pfade", "alt-skript.mjs --pfade", "factory-planer.md: fehlt"],
    ["AGENTS.md ohne Stufe 0", "agents", "0 ohne Planer, Lens, Abnahme", "0 ohne Lens", "AGENTS.md: fehlt"],
    ["AGENTS.md ohne Stufe 1", "agents", "1 ohne Planer, Abnahme, Cap 1", "1 voll", "AGENTS.md: fehlt"],
    ["AGENTS.md ohne Stufe 2", "agents", "2 voll, Sicherheits-Lens", "2 voll", "AGENTS.md: fehlt"],
  ];
  for (const [name, datei, alt, neu, erwartet] of verfaelschungen) {
    test(`Negativfall: ${name} nennt den Befund`, () => {
      const t = lies();
      assert.ok(t[datei].includes(alt), `Ausgangstext fehlt: ${alt}`);
      t[datei] = t[datei].replaceAll(alt, neu);
      const b = befunde(t);
      assert.ok(b.some((z) => z.includes(erwartet)), `erwartet ${erwartet}, erhalten ${JSON.stringify(b)}`);
    });
  }

  test("Negativfall: der Prognose-Aufruf hinter dem Planer-Spawn ist rot", () => {
    const t = lies();
    const satz = "risikostufe.mjs --ticket <nr>";
    t.ablauf = t.ablauf.replace(satz, "risikostufe.mjs --ticket-alt <nr>") + "\n" + satz;
    assert.ok(befunde(t).some((z) => z.includes("steht nicht vor dem Planer-Spawn")));
  });

  test("Negativfall: der Ausnahmesatz hinter dem Planer-Spawn ist rot", () => {
    const t = lies();
    const m = /weder Sammelticket[^.]*noch Epic noch Fortsetzung/.exec(t.ablauf);
    assert.ok(m);
    t.ablauf = t.ablauf.replace(m[0], "x") + "\n" + m[0];
    assert.ok(befunde(t).some((z) => z.includes("Absatz Risikostufe")));
  });
});
