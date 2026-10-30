/* Besitz-Verweis-Wächter (#101 L25/L28): Verweise aus verteilten Besitz-Einheiten dürfen im Bezieher nicht ins Leere laufen.
 * Nur im Factory-Repo (`.factory/besitz.json` ist dort die Quelle; wie die anderen Factory-only-Tests).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft (die Klassen des Probe-Laufs aus L28):
 *  (1) `npm run <x>`: ist `<x>` ein Skript der package.json, das `node|tsx <datei>` ruft, muss `<datei>` Besitz sein (Datei oder unter einem Besitz-Ordner).
 *      Ausnahme `BEZIEHER_VERTRAG` (`setup`, Projekt-Eigentum); Grenze: nur `node|tsx <datei>` im Skriptwert, verkettete Skripte (`npm run a && npm run b`) nicht aufgelöst.
 *  (3) Markdown-Links Besitz -> Nicht-Besitz: einziger Durchsetzer ist `kern-links.test.ts` samt Baseline (kein zweiter Wächter).
 *  (4) Anker-Links (`ziel.md#anker`) auf Nicht-Besitz-Ziele: jedes solche Ziel steht schon als Paar in `kern-links-baseline.json` (ein neues Ziel
 *      wird dort rot). Grenze: ob der Anker im Ziel existiert, prüft `check:docdrift` (deadAnchors), nicht dieser Test; Anker in Block-Zielen ungeprüft.
 *  (L25) Das Literal des Manifest-Pfads steht in `scripts/*.mjs` nur in `besitz-lib.mjs` (Kommentarzeilen ausgenommen; Grenze: Strings in
 *      Unterordnern von scripts/ und Nicht-.mjs-Dateien sind nicht erfasst). */
import { describe, expect, test } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ladeBesitzManifest } from "../support/besitz-anker";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";

interface Eintrag {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring: string;
}
const { einheitText, wirdVerteilt, MANIFEST_PFAD } = rawBesitz as unknown as {
  einheitText: (e: Eintrag, text: string) => string | null;
  wirdVerteilt: (e: Eintrag) => boolean;
  MANIFEST_PFAD: string;
};

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const lesen = (pfad: string): string | null => (existsSync(WURZEL + pfad) ? readFileSync(WURZEL + pfad, "utf8") : null);

const istBesitz = (besitz: Set<string>, pfad: string): boolean => besitz.has(pfad) || [...besitz].some((b) => pfad.startsWith(b.endsWith("/") ? b : `${b}/`));

/** Bezieher-Vertrag: `npm run setup` nennen die Git-Hooks als Einrichtungsschritt; jedes Projekt bringt sein eigenes `setup` (package.json ist Projekt-Eigentum, `scripts/setup.mjs` kein Besitz). */
const BEZIEHER_VERTRAG = ["setup"];

/** Befunde Klasse (1): `npm run`-Skripte aus Besitz-Einheiten, deren Skript-Datei kein Besitz ist. */
export function npmRunBefunde(einheiten: Eintrag[], lies: (p: string) => string | null, skripte: Record<string, string>, vertrag: string[] = []): string[] {
  const besitz = new Set(einheiten.map((e) => e.pfad));
  const out = new Set<string>();
  for (const e of einheiten) {
    if (e.schluessel !== undefined) continue;
    const text = lies(e.pfad);
    const einheit = text === null ? null : einheitText(e, text);
    if (einheit === null) continue;
    for (const m of einheit.matchAll(/npm run ([a-z0-9:_-]+)/g)) {
      const befehl = skripte[m[1] ?? ""];
      if (befehl === undefined || vertrag.includes(m[1] ?? "")) continue; // Platzhalter, Prosa oder Bezieher-Vertrag
      for (const f of befehl.matchAll(/(?:node|tsx)\s+([\w./-]+\.(?:mjs|ts))/g)) {
        if (!istBesitz(besitz, f[1] ?? "")) out.add(`${e.pfad} -> npm run ${m[1]} -> ${f[1]}`);
      }
    }
  }
  return [...out].sort();
}

/** Quellen aller .mjs unter scripts/ (nur oberste Ebene), die das Manifest-Literal im Code (nicht in Kommentarzeilen) tragen. */
export function literalFunde(literal: string, dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(([name, text]) => name !== "besitz-lib.mjs" && text.split("\n").some((z) => z.includes(literal) && !/^\s*(\/\/|\/?\*)/.test(z)))
    .map(([name]) => name)
    .sort();
}

describe("Besitz-Verweise (#101)", () => {
  const eintraege = ladeBesitzManifest<Eintrag>().eintraege.filter(wirdVerteilt);

  test("(1) npm run aus Besitz-Einheiten ruft nur Besitz-Skripte", () => {
    const pkg = JSON.parse(lesen("package.json") ?? "{}") as { scripts?: Record<string, string> };
    expect(npmRunBefunde(eintraege, lesen, pkg.scripts ?? {}, BEZIEHER_VERTRAG)).toEqual([]);
  });

  test("(1) Probe: ein Vertrags-Skript ist ausgenommen, ohne Ausnahme wird es gefunden", () => {
    const e: Eintrag[] = [{ pfad: "h", ring: "kern" }];
    expect(npmRunBefunde(e, () => "`npm run setup`", { setup: "node scripts/setup.mjs" })).toEqual(["h -> npm run setup -> scripts/setup.mjs"]);
    expect(npmRunBefunde(e, () => "`npm run setup`", { setup: "node scripts/setup.mjs" }, ["setup"])).toEqual([]);
  });

  test("(1) Probe: ein Skript außerhalb des Besitzes wird gefunden, Ordner-Besitz, Platzhalter und Blockgrenze gelten", () => {
    const dateien: Record<string, string> = {
      "docs/a.md": "`npm run fremd` `npm run kern` `npm run unbekannt`",
      "docs/b.md": "x\n<!-- factory-besitz:start k -->\n`npm run ordner`\n<!-- factory-besitz:ende k -->\n`npm run fremd`",
    };
    const skripte = { fremd: "node scripts/fremd.mjs", kern: "node scripts/kern.mjs --x", ordner: "tsx tools/x/y.ts" };
    const e: Eintrag[] = [
      { pfad: "docs/a.md", ring: "kern" },
      { pfad: "docs/b.md", block: "k", ring: "kern" },
      { pfad: "scripts/kern.mjs", ring: "kern" },
      { pfad: "tools/x", ring: "kern" },
    ];
    expect(npmRunBefunde(e, (p) => dateien[p] ?? null, skripte)).toEqual(["docs/a.md -> npm run fremd -> scripts/fremd.mjs"]);
  });

  test("(4) jedes Nicht-Besitz-Ziel eines Anker-Links aus Besitz steht als Ziel in der kern-links-Baseline", () => {
    const besitz = new Set(eintraege.map((e) => e.pfad));
    const baseline = (JSON.parse(lesen("test/harness/kern-links-baseline.json") ?? "{}") as { paare?: string[] }).paare ?? [];
    const lose: string[] = [];
    for (const e of eintraege) {
      if (!e.pfad.endsWith(".md") || e.schluessel !== undefined) continue;
      const text = lesen(e.pfad);
      const einheit = text === null ? null : einheitText(e, text);
      if (einheit === null) continue;
      for (const l of einheit.matchAll(/\]\(([^)#\s]+\.md)#[^)\s]+\)/g)) {
        const pfad = (l[1] ?? "").split("/");
        const basis = e.pfad.split("/").slice(0, -1);
        for (const s of pfad) {
          if (s === "..") basis.pop();
          else if (s !== "." && s !== "") basis.push(s);
        }
        const ziel = basis.join("/");
        if (!besitz.has(ziel) && !baseline.includes(`${e.pfad} -> ${ziel}`)) lose.push(`${e.pfad} -> ${ziel}`);
      }
    }
    expect(lose).toEqual([]);
  });

  test("(L25) das Manifest-Pfad-Literal steht in scripts/*.mjs nur in der Lib", () => {
    const dir = `${WURZEL}scripts/`;
    const dateien: Record<string, string> = {};
    for (const n of readdirSync(dir).filter((f) => f.endsWith(".mjs"))) dateien[n] = readFileSync(dir + n, "utf8");
    expect(Object.keys(dateien).length).toBeGreaterThan(20);
    expect(literalFunde(MANIFEST_PFAD, dateien)).toEqual([]);
  });

  test("(L25) Probe: Code mit dem Literal wird gefunden, Kommentarzeilen und die Lib nicht", () => {
    const l = MANIFEST_PFAD;
    expect(literalFunde(l, { "a.mjs": `const x = "${l}";`, "b.mjs": `// ${l}\n * ${l}`, "besitz-lib.mjs": `"${l}"` })).toEqual(["a.mjs"]);
  });
});
