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
export function befunde(t: Texte): string[] {
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

  const verfaelschungen: [string, keyof Texte, string, string][] = [
    ["Prognose nach dem Planer", "ablauf", "risikostufe.mjs --ticket <nr>", "risikostufe.mjs --tick <nr>"],
    ["Prompt-Form fehlt", "ablauf", "Plan ohne Planer: stufe <n> — <Pfade>", "Plan ohne Planer"],
    ["Sammelticket nicht ausgenommen", "ablauf", "noch Epic noch Fortsetzung", "noch Epic"],
    ["Überschreiten ohne Fortsetzung", "ablauf", "Risikostufe überschritten", "Stufe zu hoch"],
    ["Umsetzer meldet nicht", "umsetzer", "abgebrochen — Risikostufe überschritten", "abgebrochen"],
    ["Stufe 0 ohne Review-Zeile", "umsetzer", "Review: ohne — stufe 0", "Review: kombiniert"],
    ["Abbildung mit Gedankenstrich", "umsetzer", "Plan: ohne — stufe <n>`", "Plan: ohne — stufe — <n>`"],
    ["Stufe 0 mit Lens", "review", "kein Lens-Pass", "ein Lens-Pass"],
    ["Stufe 1 ohne Cap", "review", "(Cap 1, also", "(also"],
    ["Klasse hoch ohne Stufe", "klasseHoch", "RISIKOSTUFE: 2", "RISIKO: hoch"],
    ["Planer ohne Auslöser", "planer", "risikostufe.mjs --pfade", "groessenstufe.mjs --pfade"],
    ["AGENTS.md ohne Stufen", "agents", "0 ohne Planer, Lens, Abnahme", "0 ohne Lens"],
  ];
  for (const [name, datei, alt, neu] of verfaelschungen) {
    test(`Negativfall: ${name} liefert Befunde`, () => {
      const t = lies();
      assert.ok(t[datei].includes(alt), `Ausgangstext fehlt: ${alt}`);
      t[datei] = t[datei].replaceAll(alt, neu);
      assert.ok(befunde(t).length > 0);
    });
  }
});
