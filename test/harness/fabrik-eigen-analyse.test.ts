/**
 * @harness-waechter
 * Wächter: die Skripte der Token-Analyse (factory#518) sind Fabrik-eigen. (a) Das Besitz-Manifest trifft keinen ihrer Pfade, (b) keine
 * verteilte Datei nennt oder importiert sie, (c) jedes Einstiegsskript sperrt den Lauf in einem Bezieher (`istBezieher`).
 * Neue Kinder von factory#518 tragen ihre Pfade in `FABRIK_EIGEN` ein. Grenze: ein Verweis über einen berechneten Pfad bleibt unentdeckt.
 */
import { describe, expect, test } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lies = (p: string) => readFileSync(join(WURZEL, p), "utf8");

/** Geschlossene Liste der Fabrik-eigenen Analyse-Dateien. */
export const FABRIK_EIGEN = ["scripts/token-analyse-freigabe.mjs", "scripts/token-analyse-freigabe-lib.mjs"];

const besitzPfade = (JSON.parse(lies(".factory/besitz.json")) as { eintraege: { pfad: string }[] }).eintraege.map((e) => e.pfad);
const basis = (p: string) => p.replace(/^scripts\//, "").replace(/\.mjs$/, "");

describe("Fabrik-eigene Token-Analyse bleibt aus dem Besitz heraus", () => {
  test("die Dateien existieren (kein toter Eintrag)", () => {
    for (const p of FABRIK_EIGEN) expect([p, existsSync(join(WURZEL, p))]).toEqual([p, true]);
  });
  test("(a) das Besitz-Manifest trifft keinen Pfad der Liste", () => {
    const treffer = FABRIK_EIGEN.filter((p) => besitzPfade.some((b) => b === p || p.startsWith(`${b.replace(/\/$/, "")}/`)));
    expect(treffer).toEqual([]);
  });
  test("(b) keine verteilte Datei nennt oder importiert eine Datei der Liste", () => {
    const verteilt = besitzPfade.filter((p) => {
      try {
        return statSync(join(WURZEL, p)).isFile();
      } catch {
        return false;
      }
    });
    const funde = verteilt.flatMap((p) => FABRIK_EIGEN.filter((f) => lies(p).includes(basis(f))).map((f) => `${p} -> ${f}`));
    expect(funde).toEqual([]);
  });
  test("(c) jedes Einstiegsskript der Liste sperrt den Lauf im Bezieher", () => {
    const einstiege = FABRIK_EIGEN.filter((p) => lies(p).includes("istDirektaufruf("));
    expect(einstiege.length).toBeGreaterThan(0);
    for (const p of einstiege) expect([p, /istBezieher\(/.test(lies(p))]).toEqual([p, true]);
  });
});
