/**
 * Wächter: verteilte `.mjs`-Einheiten (ganze Dateien, Ring wird in Projekte verteilt, `wirdVerteilt`) nennen in ihren Laufzeit-Strings kein
 * `npm run <x>`, das ein Bezieher nicht hat. Erlaubt sind die Namen aus `BEZIEHER_NPM_SKRIPTE` (`test/support/bezieher-npm-skripte.ts`);
 * alles andere steht als `node scripts/<x>.mjs` bzw. `node scripts/gate-befehl.mjs <name>`. Ergänzt `besitz-abschnittsverweise.test.ts`
 * (Besitz-`.md`) um die Laufzeittexte.
 *
 * Muster (geschlossen): `npm run <name>` in `'…'`, `"…"` oder `` `…` ``, außerhalb von Kommentaren. Gelesen wird zeilenweise: Zeilenkommentare, Blockkommentare
 * und ein Zeilenende-Kommentar (` // …`) werden entfernt, was an `npm run` übrig bleibt, steht zwangsläufig in einem Stringliteral.
 * Grenze: zur Laufzeit zusammengesetzte Strings (`"npm " + "run x"`, `["npm", "run", x]`) erkennt der Scan nicht.
 *
 * Geschlossene Ausnahmen (Datei -> Namen): Standardbefehle, die ein Bezieher per `befehle`-Block der Projekt-Config überschreibt
 * (`gate-befehl-lib.mjs`, `docs-gen.mjs`) und die Update-Schritte in `release-tag-lib.mjs`; sie wachsen nur zusammen mit einer Bezieher-Migrationszeile im Commit.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { BEZIEHER_NPM_SKRIPTE } from "../support/bezieher-npm-skripte";

const besitz = rawBesitz as unknown as {
  wirdVerteilt: (e: Eintrag) => boolean;
  istGanzeDatei: (e: Eintrag) => boolean;
};
interface Eintrag {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring?: string;
}

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Überschreibbare Standardbefehle (Block `befehle` der Projekt-Config): Datei -> erlaubte Namen. */
const AUSNAHMEN: Record<string, string[]> = {
  "scripts/gate-befehl-lib.mjs": ["verify", "verify:kompakt", "verify:changed", "test:coverage"],
  "scripts/docs-gen.mjs": ["docs:gen"],
  // Update-Schritte, die der Bezieher nach einem Tag-Sync fährt (mechanisch vor `verify`); sie nennen die Skripte des Projekts, die der Sync nicht verteilt.
  "scripts/release-tag-lib.mjs": ["lint:prune", "docs:gen", "check:factorylinks"],
};

/** Quelltext ohne Kommentare (Zeilen-, Block- und Zeilenende-Kommentare); die Zeilenzahl bleibt erhalten. */
export function ohneKommentare(text: string): string {
  let imBlock = false;
  return text
    .split("\n")
    .map((zeile) => {
      let z = zeile;
      if (imBlock) {
        const ende = z.indexOf("*/");
        if (ende < 0) return "";
        imBlock = false;
        z = z.slice(ende + 2);
      }
      for (let start = z.indexOf("/*"); start >= 0; start = z.indexOf("/*")) {
        const ende = z.indexOf("*/", start + 2);
        if (ende < 0) {
          imBlock = true;
          z = z.slice(0, start);
          break;
        }
        z = z.slice(0, start) + z.slice(ende + 2);
      }
      return z.replace(/^\s*\/\/.*$/, "").replace(/(\s)\/\/\s.*$/, "$1");
    })
    .join("\n");
}

/** Die `npm run`-Namen in den Strings des Quelltexts (Kommentare ausgenommen). */
export function npmNamenInStrings(text: string): string[] {
  return [...ohneKommentare(text).matchAll(/npm run ([a-z][\w:-]*)/g)].map((m) => m[1].replace(/[:-]+$/, ""));
}

/** Verteilte ganze `.mjs`-Dateien laut Besitz-Manifest. */
function verteilteMjs(wurzel: string): string[] {
  const manifest = JSON.parse(readFileSync(join(wurzel, ".factory/besitz.json"), "utf8")) as { eintraege: Eintrag[] };
  return [...new Set(manifest.eintraege.filter((e) => besitz.wirdVerteilt(e) && besitz.istGanzeDatei(e) && e.pfad.endsWith(".mjs")).map((e) => e.pfad))].filter((p) => existsSync(join(wurzel, p)));
}

/** Funde `{ datei, name }`: ein `npm run`-Name, den weder die Bezieher-Liste noch die geschlossene Ausnahme der Datei kennt. */
export function fremdeNamen(dateien: { pfad: string; text: string }[]): { datei: string; name: string }[] {
  return dateien.flatMap(({ pfad, text }) => npmNamenInStrings(text).filter((n) => !BEZIEHER_NPM_SKRIPTE.has(n) && !(AUSNAHMEN[pfad] ?? []).includes(n)).map((name) => ({ datei: pfad, name })));
}

describe("Laufzeit-Strings verteilter .mjs nennen nur Bezieher-npm-Skripte", () => {
  test("Positivkontrolle: der Scan sieht Treffer in verteilten Dateien (kein Leerlauf)", () => {
    const pfade = verteilteMjs(ROOT);
    expect(pfade.length).toBeGreaterThan(50);
    const alle = pfade.flatMap((p) => npmNamenInStrings(readFileSync(join(ROOT, p), "utf8")));
    expect(alle).toContain("verify");
    expect(alle).toContain("skills:sync");
  });

  test("kein verteiltes .mjs nennt ein npm-Skript außerhalb der Liste (ein Bezieher hat es nicht)", () => {
    const dateien = verteilteMjs(ROOT).map((pfad) => ({ pfad, text: readFileSync(join(ROOT, pfad), "utf8") }));
    expect(fremdeNamen(dateien)).toEqual([]);
  });

  test("Red-Green: ein eingeschleustes npm run cockpit in einem String ist ein Fund (alle drei Quote-Arten)", () => {
    for (const lit of ['"npm run cockpit"', "'npm run cockpit'", "`npm run cockpit`"]) {
      expect(fremdeNamen([{ pfad: "scripts/x.mjs", text: `const a = ${lit};\n` }]), lit).toEqual([{ datei: "scripts/x.mjs", name: "cockpit" }]);
    }
  });

  test("Negativfälle: Kommentare, erlaubte Namen und die geschlossene Ausnahme sind kein Fund", () => {
    const text = ["// npm run cockpit", "/** npm run cockpit", " * npm run cockpit */", "/* npm run cockpit */ const x = 1;", 'const a = "x"; // npm run cockpit', 'const b = "npm run skills:sync";'].join("\n");
    expect(fremdeNamen([{ pfad: "scripts/x.mjs", text }])).toEqual([]);
    expect(fremdeNamen([{ pfad: "scripts/gate-befehl-lib.mjs", text: 'const v = "npm run verify";' }])).toEqual([]);
    expect(fremdeNamen([{ pfad: "scripts/andere.mjs", text: 'const v = "npm run verify";' }])).toEqual([{ datei: "scripts/andere.mjs", name: "verify" }]);
  });

  test("Blockkommentar über mehrere Zeilen verdeckt, danach zählt der Code wieder", () => {
    const text = "/*\n npm run cockpit\n*/\nconst a = `npm run cockpit`;\n";
    expect(fremdeNamen([{ pfad: "scripts/x.mjs", text }])).toEqual([{ datei: "scripts/x.mjs", name: "cockpit" }]);
  });
});
