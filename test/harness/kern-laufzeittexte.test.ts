/**
 * @harness-waechter – Kern-Test.
 * Wächter: verteilte `.mjs`-Einheiten (ganze Dateien, Ring wird in Projekte verteilt, `wirdVerteilt`) nennen in ihren Laufzeit-Strings kein
 * `npm run <x>`, das ein Bezieher nicht hat. Erlaubt sind die Namen aus `BEZIEHER_NPM_SKRIPTE` (`test/support/bezieher-npm-skripte.ts`);
 * alles andere steht als `node scripts/<x>.mjs` bzw. `node scripts/gate-befehl.mjs <name>`. Ergänzt `besitz-abschnittsverweise.test.ts`
 * (Besitz-`.md`) um die Laufzeittexte.
 *
 * Muster (geschlossen): `npm run <name>` in `'…'`, `"…"` oder `` `…` ``, außerhalb von Kommentaren. Gelesen wird zeilenweise: Zeilenkommentare, Blockkommentare
 * und ein Zeilenende-Kommentar (` // …`) werden entfernt, was an `npm run` übrig bleibt, steht zwangsläufig in einem Stringliteral.
 * Grenze: zur Laufzeit zusammengesetzte Strings (`"npm " + "run x"`, `["npm", "run", x]`) erkennt der Scan nicht.
 *
 * Zweite Regel (factory#403 L25): kein eingesetzter Wert der Projektwert-Gruppe `praefixe` (`commitZeile`, `branch`, `worktree`, etwa `<Präfix>Plan:`) in verteilten
 * Skript-Einheiten (`.mjs/.cjs/.js`), auch nicht in Kommentaren; der Kern nennt den Wert nur als Platzhalter `<praefixe.commitZeile>` (Projekt-Leitfrage). Grenze: nur diese
 * Werte am Wortanfang; nicht erfasst sind `agenten.*`, Labels, zur Laufzeit zusammengesetzte Strings und nicht verteilte Einheiten. Die Nicht-Skript-Einheiten deckt
 * `besitz-abschnittsverweise.test.ts` ab (Helfer `praefixFunde` in `kern-verweise.ts`).
 *
 * Dritte Regel (factory#481): keine nackte Ticketnummer in den Stringliteralen verteilter Skript-Einheiten; sie steht in Herkunftsform (`quellprojekt#<nr>`, `factory#<nr>`).
 * Geschlossene Liste: Muster `NUMMER` (3-4 Ziffern) und `KURZE_NUMMER` (1-2 Ziffern) aus `scripts/herkunftsform.mjs`; Umfang: Quelltext ohne Kommentare in verteilten
 * `.mjs/.cjs/.js`-Einheiten (`wirdVerteilt`, ganze Datei). Kein Fund: Präfixformen (`quellprojekt#`, `factory#`, `owner/repo#`, `x.md#`) und eine Nummer direkt vor `;`
 * (Entity-Code `#35;`, `&#39;`). Grenze: zur Laufzeit zusammengesetzte Strings (`"#" + nr`) und Kommentare; Regex-Literale und sonstiger Code außerhalb von Kommentaren zählen mit.
 * Verfall: Prüftermin laut `.github/wiedervorlagen.json` (Eintrag `regeln-verfall-2027-03`, ADR 0027).
 *
 * Geschlossene Ausnahmen (Datei -> Namen): Standardbefehle, die ein Bezieher per `befehle`-Block der Projekt-Config überschreibt
 * (`gate-befehl-lib.mjs`, `docs-gen.mjs`) und die Update-Schritte in `release-tag-lib.mjs`; sie wachsen nur zusammen mit einer Bezieher-Migrationszeile im Commit.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawHerkunftsform from "../../scripts/herkunftsform.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { BEZIEHER_NPM_SKRIPTE } from "../support/bezieher-npm-skripte";
import { fixture } from "../support/tmp-fixture";
import { praefixFunde, praefixWerte } from "./kern-verweise";

const besitz = rawBesitz as unknown as {
  wirdVerteilt: (e: Eintrag) => boolean;
  istGanzeDatei: (e: Eintrag) => boolean;
};
const { NUMMER, KURZE_NUMMER } = rawHerkunftsform as unknown as { NUMMER: RegExp; KURZE_NUMMER: RegExp };
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

/** Verteilte ganze Skript-Dateien (Endung nach `endung`) laut Besitz-Manifest. */
function verteilteSkripte(wurzel: string, endung: RegExp): string[] {
  const manifest = JSON.parse(readFileSync(join(wurzel, ".factory/besitz.json"), "utf8")) as { eintraege: Eintrag[] };
  return [...new Set(manifest.eintraege.filter((e) => besitz.wirdVerteilt(e) && besitz.istGanzeDatei(e) && endung.test(e.pfad)).map((e) => e.pfad))].filter((p) => existsSync(join(wurzel, p)));
}

/** Funde `{ datei, name }`: ein `npm run`-Name, den weder die Bezieher-Liste noch die geschlossene Ausnahme der Datei kennt. */
export function fremdeNamen(dateien: { pfad: string; text: string }[]): { datei: string; name: string }[] {
  return dateien.flatMap(({ pfad, text }) => npmNamenInStrings(text).filter((n) => !BEZIEHER_NPM_SKRIPTE.has(n) && !(AUSNAHMEN[pfad] ?? []).includes(n)).map((name) => ({ datei: pfad, name })));
}

describe("Laufzeit-Strings verteilter .mjs nennen nur Bezieher-npm-Skripte", () => {
  test("Positivkontrolle: der Scan sieht Treffer in verteilten Dateien (kein Leerlauf)", () => {
    const pfade = verteilteSkripte(ROOT, /\.mjs$/);
    expect(pfade.length).toBeGreaterThan(50);
    const alle = pfade.flatMap((p) => npmNamenInStrings(readFileSync(join(ROOT, p), "utf8")));
    expect(alle).toContain("verify");
    expect(alle).toContain("skills:sync");
  });

  test("kein verteiltes .mjs nennt ein npm-Skript außerhalb der Liste (ein Bezieher hat es nicht)", () => {
    const dateien = verteilteSkripte(ROOT, /\.mjs$/).map((pfad) => ({ pfad, text: readFileSync(join(ROOT, pfad), "utf8") }));
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
    expect(fremdeNamen([{ pfad: "scripts/x.mjs", text: "const c = `Fix: npm run skills:sync: dann erneut`;" }])).toEqual([]); // Satzzeichen hinter dem Namen gehört nicht dazu
    expect(fremdeNamen([{ pfad: "scripts/gate-befehl-lib.mjs", text: 'const v = "npm run verify";' }])).toEqual([]);
    expect(fremdeNamen([{ pfad: "scripts/andere.mjs", text: 'const v = "npm run verify";' }])).toEqual([{ datei: "scripts/andere.mjs", name: "verify" }]);
  });

  test("Blockkommentar über mehrere Zeilen verdeckt, danach zählt der Code wieder", () => {
    const text = "/*\n npm run cockpit\n*/\nconst a = `npm run cockpit`;\n";
    expect(fremdeNamen([{ pfad: "scripts/x.mjs", text }])).toEqual([{ datei: "scripts/x.mjs", name: "cockpit" }]);
  });
});

describe("Verteilte Skripte nennen kein eingesetztes Präfix-Literal (factory#403 L25)", () => {
  const WERTE = praefixWerte(ROOT);
  const SKRIPT = /\.(mjs|cjs|js)$/;
  const mit = (text: string, ring = "kern"): string => fixture({ ".factory/besitz.json": JSON.stringify({ version: 3, eintraege: [{ pfad: "scripts/x.mjs", ring }] }), "scripts/x.mjs": text });
  const literale = (text: string, ring?: string): string[] => praefixFunde(mit(text, ring), WERTE, SKRIPT).funde.map((f) => f.literal);

  test("Negativfall: ein eingesetztes Literal im String oder Kommentar ist rot, die Platzhalterform grün", () => {
    const wert = WERTE.find((w) => /^[A-Z]/.test(w)) ?? "";
    expect(wert).not.toBe("");
    expect(literale(`const a = "${wert}Plan:";\n`)).toEqual([wert]);
    expect(literale(`// ${wert}Plan: x\n`)).toEqual([wert]);
    expect(literale('const a = "<praefixe.commitZeile>Plan:";\n')).toEqual([]);
    expect(literale(`const a = "Wort${wert}Plan:";\n`)).toEqual([]);
    expect(literale(`// ${wert}Plan:\n`, "oberflaeche")).toEqual([]);
  });

  test("echtes Repo: kein verteiltes Skript trägt ein Präfix-Literal, der Scan ist nicht leer", () => {
    const r = praefixFunde(ROOT, WERTE, SKRIPT);
    expect(r.dateien).toBeGreaterThan(100);
    expect(r.funde).toEqual([]);
  });
});

/** Funde `{ datei, zeile, nummer }`: eine nackte Ticketnummer in einem Stringliteral (Kommentare ausgenommen, Entity-Code `#35;` ist kein Fund). */
export function nackteNummern(dateien: { pfad: string; text: string }[]): { datei: string; zeile: number; nummer: string }[] {
  return dateien.flatMap(({ pfad, text }) =>
    ohneKommentare(text)
      .split("\n")
      .flatMap((z, i) =>
        [...z.matchAll(NUMMER), ...z.matchAll(KURZE_NUMMER)]
          .filter((m) => z[(m.index ?? 0) + m[0].length] !== ";")
          .map((m) => ({ datei: pfad, zeile: i + 1, nummer: m[0] })),
      ),
  );
}

describe("Verteilte Skripte nennen Ticketnummern in Strings mit Herkunft (factory#481)", () => {
  const SKRIPT = /\.(mjs|cjs|js)$/;
  const lesen = (pfade: string[]): { pfad: string; text: string }[] => pfade.map((pfad) => ({ pfad, text: readFileSync(join(ROOT, pfad), "utf8") }));
  const nr = (text: string): string[] => nackteNummern([{ pfad: "scripts/x.mjs", text }]).map((f) => f.nummer);

  test("echtes Repo: keine nackte Ticketnummer in einem Stringliteral, der Scan ist nicht leer", () => {
    const dateien = lesen(verteilteSkripte(ROOT, SKRIPT));
    expect(dateien.length).toBeGreaterThan(100);
    const mitHerkunft = dateien.flatMap(({ text }) => [...ohneKommentare(text).matchAll(/quellprojekt#\d/g)]);
    expect(mitHerkunft.length).toBeGreaterThanOrEqual(20);
    expect(nackteNummern(dateien)).toEqual([]);
  });

  test("echte Datei: die Mermaid-Entity #35; in markdown.mjs ist kein Fund", () => {
    const [datei] = lesen(["scripts/docs-gen/markdown.mjs"]);
    expect(datei.text).toContain('"#35;"');
    expect(nackteNummern([datei])).toEqual([]);
  });

  test("Red-Green: eine nackte Nummer ist in allen Quote-Arten ein Fund, mit Zeile, mehrere je Zeile alle", () => {
    for (const lit of ['"(#1311)"', "'(#1311)'", "`(#1311)`"]) {
      expect(nackteNummern([{ pfad: "scripts/x.mjs", text: `\nconst a = ${lit};\n` }]), lit).toEqual([{ datei: "scripts/x.mjs", zeile: 2, nummer: "#1311" }]);
    }
    expect(nr('const a = "siehe #12";')).toEqual(["#12"]);
    expect(nr('const a = "#772 und #735";')).toEqual(["#772", "#735"]);
  });

  test("Negativfälle: Entities, Präfixformen, Kommentare und Platzhalter sind kein Fund", () => {
    expect(nr('const a = "#35;"; const b = "&#39;";')).toEqual([]);
    expect(nr('const a = "quellprojekt#1311 owner/repo#12 x.md#1234 factory#95";')).toEqual([]);
    expect(nr(["// #1311", "/* #1311 */", 'const a = 1; // #1311', "/*", " #1311", "*/"].join("\n"))).toEqual([]);
    expect(nr("const a = `PR #${nr}`;")).toEqual([]);
  });
});
