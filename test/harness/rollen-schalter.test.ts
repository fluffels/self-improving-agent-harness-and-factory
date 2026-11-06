/* Rollen-Schalter-Wächter (factory#154, Fortschreibung zu ADR 0022): verteilter Code unterscheidet Fabrik und Bezieher über `istBezieher(wurzel)` aus `scripts/sync-stand-lib.mjs` (Prüfer dürfen über den Format-Leser auf `zustand` verzweigen).
 *
 * Eine eigene Probe im Kern (Datei-Aufruf auf den Sync-Stand, nacktes Pfad-Literal) wäre eine unmarkierte Fabrik-Abweichung: sie umgeht die fail-closed-Definition des Schalters.
 * Rot wird jede Zeile einer verteilten Skript-Datei (`.mjs`, `.cjs`, `.js` laut `.factory/besitz.json`), die
 *   M1: einen Datei-System-Aufruf (`existsSync`, `statSync`, `lstatSync`, `accessSync`, `readFileSync`, `openSync`) mit `sync-stand` oder `STAND_PFAD` auf derselben Zeile trägt, oder
 *   M2: ein String-Literal enthält, das genau `sync-stand.json` bzw. `.factory/sync-stand.json` ist.
 * Ausgenommen ist die Heimat des Schalters `scripts/sync-stand-lib.mjs`; ganze Kommentarzeilen (`//`, `*`, `/*`) zählen nicht, ein Kommentar am Zeilenende schon (fail-closed).
 * Grenzen: berechnete Pfade (Variable, Template mit `${…}`), Shell (`test -f`) in Workflows, Rollenerkennung über andere Signale und Inhaltsleser über einen
 * injizierten Leser (`syncStandAusText(lies(STAND_PFAD))`) sind nicht erfasst; Inhaltsleser sind erlaubt, weil sie über den einzigen Format-Leser gehen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { ladeBesitzManifest } from "../support/besitz-anker";

const { wirdVerteilt, istGanzeDatei } = rawBesitz as unknown as {
  wirdVerteilt: (e: { ring: string }) => boolean;
  istGanzeDatei: (e: { block?: string; schluessel?: string }) => boolean;
};

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
/** Die Heimat des Rollen-Schalters: dort darf der Pfad stehen. */
const HEIMAT = "scripts/sync-stand-lib.mjs";
const WEG = "Fabrik/Bezieher nur über istBezieher(wurzel) aus scripts/sync-stand-lib.mjs unterscheiden (Fortschreibung factory#154 zu ADR 0022)";

const M1 = /\b(existsSync|statSync|lstatSync|accessSync|readFileSync|openSync)\(.*(sync-stand|STAND_PFAD)/;
const M2 = /(["'])(\.factory\/)?sync-stand\.json\1/;
const KOMMENTARZEILE = /^\s*(\/\/|\*|\/\*)/;

/** Pur: Meldungen `<pfad>:<zeile>: …` (leer = grün) für jede Zeile mit einer Rollen-Probe am Sync-Stand. */
export function rollenProben(pfad: string, text: string): string[] {
  if (pfad === HEIMAT) return [];
  return text.split("\n").flatMap((zeile, i) => {
    if (KOMMENTARZEILE.test(zeile)) return [];
    const muster = M1.test(zeile) ? "M1 Datei-Aufruf auf den Sync-Stand" : M2.test(zeile) ? "M2 Pfad-Literal des Sync-Stands" : null;
    return muster === null ? [] : [`${pfad}:${i + 1}: ${muster}: ${WEG}`];
  });
}

/** Die verteilten Skript-Dateien (ganze Datei, Endung `.mjs`/`.cjs`/`.js`) des Besitz-Manifests, ohne die Heimat des Schalters. */
function umfang(): string[] {
  const { eintraege } = ladeBesitzManifest<{ pfad: string; ring: string; block?: string; schluessel?: string }>();
  return [...new Set(eintraege.filter((e) => wirdVerteilt(e) && istGanzeDatei(e) && /\.(mjs|cjs|js)$/.test(e.pfad)).map((e) => e.pfad))].filter((p) => p !== HEIMAT).sort();
}

describe("Rollen-Schalter (factory#154)", () => {
  test("M1: Datei-Aufruf auf den Sync-Stand wird rot (Pfad aus Teilen)", () => {
    const meldungen = rollenProben("scripts/x.mjs", 'const a = 1;\nreturn existsSync(join(r, ".factory", "sync-stand.json"));');
    expect(meldungen).toHaveLength(1);
    expect(meldungen[0]).toContain("scripts/x.mjs:2: M1");
    expect(meldungen[0]).toContain("istBezieher(wurzel)");
  });

  test("M1: Datei-Aufruf mit STAND_PFAD wird rot", () => {
    expect(rollenProben("scripts/x.mjs", "const s = statSync(STAND_PFAD);")).toHaveLength(1);
  });

  test.each(["existsSync", "statSync", "lstatSync", "accessSync", "readFileSync", "openSync"])("M1: %s mit STAND_PFAD wird rot (ohne Literal, damit M2 den Fall nicht verdeckt)", (fn) => {
    expect(rollenProben("scripts/x.mjs", `const s = ${fn}(join(w, STAND_PFAD));`)).toHaveLength(1);
  });

  test("M2: nacktes Pfad-Literal wird rot, mit einfachen und doppelten Anführungszeichen", () => {
    expect(rollenProben("scripts/x.mjs", 'const p = ".factory/sync-stand.json";')).toHaveLength(1);
    expect(rollenProben("scripts/x.mjs", "const p = 'sync-stand.json';")).toHaveLength(1);
  });

  test("Kommentar am Zeilenende zählt (fail-closed), ein Blockkommentar-Anfang nimmt die Zeile aus", () => {
    expect(rollenProben("scripts/x.mjs", "existsSync(STAND_PFAD); // Kommentar")).toHaveLength(1);
    expect(rollenProben("scripts/x.mjs", "/* existsSync(STAND_PFAD) */")).toEqual([]);
    expect(rollenProben("scripts/x.mjs", "  // existsSync(STAND_PFAD)")).toEqual([]);
    expect(rollenProben("scripts/x.mjs", "   * existsSync(STAND_PFAD)")).toEqual([]);
  });

  test("M1 trifft nur die genannten Funktionen als ganzes Wort (fstatSync bleibt grün)", () => {
    expect(rollenProben("scripts/x.mjs", "const s = fstatSync(join(w, STAND_PFAD));")).toEqual([]);
  });

  test("M2 trifft nur das exakte Literal: längerer String in gleichen oder gemischten Anführungszeichen bleibt grün", () => {
    expect(rollenProben("scripts/x.mjs", 'err("kein .factory/sync-stand.json gefunden");')).toEqual([]);
    expect(rollenProben("scripts/x.mjs", `const p = "sync-stand.json';`)).toEqual([]);
    expect(rollenProben("scripts/x.mjs", 'const p = "sync-stand.json.bak";')).toEqual([]);
    expect(rollenProben("scripts/x.mjs", 'const p = "Pfad: .factory/sync-stand.json";')).toEqual([]);
  });

  test("grün: istBezieher, Kommentarzeile, Pfad in längerem String, Inhaltsleser über injizierten Leser, Heimatdatei", () => {
    expect(rollenProben("scripts/x.mjs", "if (istBezieher(root)) return;")).toEqual([]);
    expect(rollenProben("scripts/x.mjs", '// existsSync(".factory/sync-stand.json") ist verboten')).toEqual([]);
    expect(rollenProben("scripts/x.mjs", " * liest sync-stand.json über existsSync(x)")).toEqual([]);
    expect(rollenProben("scripts/x.mjs", "err(`✖ kein .factory/sync-stand.json gefunden`);")).toEqual([]);
    expect(rollenProben("scripts/x.mjs", "const s = syncStandAusText(lies(STAND_PFAD));")).toEqual([]);
    expect(rollenProben(HEIMAT, 'text = readFileSync(join(wurzel, "sync-stand.json"));')).toEqual([]);
  });

  test("Leerlauf-Schutz: der Umfang ist nicht leer, die Heimat ist verteilter Kern", () => {
    expect(umfang().length).toBeGreaterThan(10);
    const heimat = ladeBesitzManifest<{ pfad: string; ring: string }>().eintraege.find((e) => e.pfad === HEIMAT);
    expect(heimat?.ring).toBe("kern");
  });

  test("echter Scan: keine unmarkierte Rollen-Probe im verteilten Skript-Besitz", () => {
    const meldungen = umfang().flatMap((pfad) => rollenProben(pfad, readFileSync(WURZEL + pfad, "utf8")));
    expect(meldungen).toEqual([]);
  });
});
