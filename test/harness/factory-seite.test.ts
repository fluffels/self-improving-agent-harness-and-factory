/* Factory-Seite-Verweise (#90 Z26): Unit-Tests von `scripts/factory-seite.mjs` und Wächter für die Literal-Aufrufe.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Wächter: jeder Aufruf `factorySeiteIn(<x>, "<pfad>", "<anker>")` mit zwei String-Literalen in `scripts/` (alle `.mjs`, rekursiv) muss auf eine
 * lokal vorhandene Datei und auf einen vorhandenen Überschrift-Anker zeigen (`collectHeadingSlugs`). Scan-Umfang (geschlossen): `.mjs` unter
 * `scripts/`, Aufruf in einer Zeile, Literale in doppelten Anführungszeichen. Berechnete Argumente liegen außerhalb. Link-Prüfung: `check-factory-links.mjs` (factory#130); dort steht die Zerlegung, hier ihr Rundweg und der Wächter, dass nur diese Datei Factory-URLs baut. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSeite from "../../scripts/factory-seite.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMd from "../../scripts/docs-gen/markdown.mjs";

const { factorySeite, factorySeiteIn, factoryUrlTeile, repoBasis } = rawSeite as {
  repoBasis: (repo: string) => string;
  factoryUrlTeile: (url: string, repo: string) => { form: string; ref: string; pfad: string; anker: string; refOffset: number } | null;
  factorySeite: (a: { pfad: string; anker?: string; repo?: string; tag?: string }) => string;
  factorySeiteIn: (wurzel: string, pfad: string, anker?: string) => string;
};
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitzRoh from "../../scripts/besitz-lib.mjs";
const rawBesitz = rawBesitzRoh as unknown as {
  MANIFEST_PFAD: string;
  manifestAusText: (t: string) => { manifest: { eintraege: unknown[] } };
  wirdVerteilt: (e: unknown) => boolean;
  istGanzeDatei: (e: unknown) => boolean;
};
const { collectHeadingSlugs } = rawMd as { collectHeadingSlugs: (md: string) => string[] };

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));

const ordner: string[] = [];
afterEach(() => {
  for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
});
function projekt(opts: { tag?: string; repo?: string; stand?: string; config?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-seite-"));
  ordner.push(dir);
  mkdirSync(join(dir, ".factory"));
  if (opts.stand !== undefined) writeFileSync(join(dir, ".factory", "sync-stand.json"), opts.stand);
  if (opts.tag !== undefined) writeFileSync(join(dir, ".factory", "sync-stand.json"), JSON.stringify({ quelle: { tag: opts.tag, ...(opts.repo === undefined ? {} : { repo: opts.repo }) } }));
  if (opts.config !== undefined) writeFileSync(join(dir, ".factory", "projekt.json"), opts.config);
  return dir;
}
const config = (boards: unknown[]) => JSON.stringify({ version: 2, repo: "o/projekt", boards });

describe("factorySeite (pur)", () => {
  test("mit repo und tag ein Link, sonst der lokale Pfad", () => {
    assert.equal(factorySeite({ pfad: "docs/a.md", anker: "x", repo: "o/f", tag: "v1" }), "https://github.com/o/f/blob/v1/docs/a.md#x");
    assert.equal(factorySeite({ pfad: "docs/a.md", anker: "x", repo: "o/f" }), "docs/a.md#x");
    assert.equal(factorySeite({ pfad: "docs/a.md", anker: "x", tag: "v1" }), "docs/a.md#x");
    assert.equal(factorySeite({ pfad: "docs/a.md" }), "docs/a.md");
  });
});

describe("factorySeiteIn", () => {
  const boards = [{ rolle: "produkt" }, { rolle: "factory", repo: "o/factory" }];
  test("Bezieher: Link auf den Tag des Factory-Boards", () => {
    const d = projekt({ tag: "v2", config: config(boards) });
    assert.equal(factorySeiteIn(d, "docs/a.md", "x"), "https://github.com/o/factory/blob/v2/docs/a.md#x");
  });
  test("Sync-Stand mit quelle.repo: Link auf dieses Repo, vor dem Board", () => {
    assert.equal(factorySeiteIn(projekt({ tag: "v2", repo: "q/quelle", config: config(boards) }), "docs/a.md", "x"), "https://github.com/q/quelle/blob/v2/docs/a.md#x");
    assert.equal(factorySeiteIn(projekt({ tag: "v2", repo: "q/quelle" }), "docs/a.md", "x"), "https://github.com/q/quelle/blob/v2/docs/a.md#x");
  });
  test("Factory-Board ohne repo und alter Stand ohne quelle.repo: lokaler Pfad, kein Rückfall aufs Config-Repo", () => {
    const d = projekt({ tag: "v2", config: config([{ rolle: "factory" }]) });
    assert.equal(factorySeiteIn(d, "docs/a.md", "x"), "docs/a.md#x");
  });
  test("quelle.repo ohne owner/name-Form zählt nicht", () => {
    const d = projekt({ tag: "v2", repo: "kein-repo", config: config([{ rolle: "factory" }]) });
    assert.equal(factorySeiteIn(d, "docs/a.md", "x"), "docs/a.md#x");
  });
  test("Upstream (kein Sync-Stand): lokaler Pfad", () => {
    assert.equal(factorySeiteIn(projekt({ config: config(boards) }), "docs/a.md", "x"), "docs/a.md#x");
  });
  test("fehlender Tag: lokaler Pfad", () => {
    const d = projekt({ stand: JSON.stringify({ quelle: {} }), config: config(boards) });
    assert.equal(factorySeiteIn(d, "docs/a.md", "x"), "docs/a.md#x");
  });
  test("Tag kein String: lokaler Pfad statt Link auf blob/5", () => {
    const d = projekt({ stand: JSON.stringify({ quelle: { tag: 5 } }), config: config(boards) });
    assert.equal(factorySeiteIn(d, "docs/a.md", "x"), "docs/a.md#x");
  });
  test("fehlendes Repo (kein Factory-Board, keine Config): lokaler Pfad", () => {
    assert.equal(factorySeiteIn(projekt({ tag: "v2", config: config([{ rolle: "produkt" }]) }), "docs/a.md", "x"), "docs/a.md#x");
    assert.equal(factorySeiteIn(projekt({ tag: "v2" }), "docs/a.md", "x"), "docs/a.md#x");
  });
  test("kaputtes JSON: lokaler Pfad, kein Wurf", () => {
    assert.equal(factorySeiteIn(projekt({ stand: "{kaputt", config: "{kaputt" }), "docs/a.md", "x"), "docs/a.md#x");
    assert.equal(factorySeiteIn(projekt({ tag: "v2", config: "{kaputt" }), "docs/a.md", "x"), "docs/a.md#x");
  });
});

function mjsDateien(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? mjsDateien(p) : e.name.endsWith(".mjs") ? [p] : [];
  });
}
const AUFRUF = /factorySeiteIn\(\s*[^,()]+,\s*"([^"]+)",\s*"([^"]+)"\s*\)/g;

describe("Wächter: Literal-Aufrufe zeigen auf vorhandene Seiten und Anker", () => {
  test("Datei und Anker existieren lokal", () => {
    const fehler: string[] = [];
    let n = 0;
    for (const datei of mjsDateien(join(WURZEL, "scripts"))) {
      const text = readFileSync(datei, "utf8");
      for (const m of text.matchAll(AUFRUF)) {
        n++;
        const [, pfad, anker] = m;
        const abs = join(WURZEL, pfad);
        if (!existsSync(abs)) fehler.push(`${datei}: ${pfad} fehlt`);
        else if (!collectHeadingSlugs(readFileSync(abs, "utf8")).includes(anker)) fehler.push(`${datei}: Anker #${anker} fehlt in ${pfad}`);
      }
    }
    assert.ok(n >= 4, `erwartet mindestens 4 Literal-Aufrufe, gefunden ${n}`);
    assert.deepEqual(fehler, []);
  });
});

describe("factoryUrlTeile (factory#130): Rundweg mit factorySeite", () => {
  const FAELLE: { pfad: string; anker?: string; repo: string; tag: string }[] = [
    { pfad: "docs/a.md", anker: "x", repo: "o/f", tag: "v1" },
    { pfad: "docs/a.md", repo: "o/f", tag: "v1" },
    { pfad: "docs/b/c.md", anker: "langfuse-status-überprüfen-1293", repo: "o/f", tag: "v1.2.3" },
  ];
  test("Pfad, Anker und Ref kommen zurück (blob), auch bei anderer Groß-/Kleinschreibung des Repos", () => {
    for (const k of FAELLE) {
      const url = factorySeite(k);
      assert.deepEqual(factoryUrlTeile(url, k.repo), { form: "blob", ref: k.tag, pfad: k.pfad, anker: k.anker ?? "", refOffset: repoBasis(k.repo).length + "/blob/".length }, url);
      assert.equal(factoryUrlTeile(url, k.repo.toUpperCase())?.pfad, k.pfad);
      assert.equal(url.slice(factoryUrlTeile(url, k.repo)!.refOffset).startsWith(k.tag), true, "refOffset zeigt auf den Ref");
    }
  });
  test("tree-Form wird erkannt", () => {
    assert.deepEqual(factoryUrlTeile("https://github.com/o/f/tree/v1/docs/adr", "o/f"), { form: "tree", ref: "v1", pfad: "docs/adr", anker: "", refOffset: "https://github.com/o/f/tree/".length });
  });
  test("andere Repos, /issues, /pull und die Repo-Wurzel sind nicht erfasst (null)", () => {
    for (const u of ["https://github.com/o/factory-x/blob/v1/a.md", "https://github.com/o/f/issues/3", "https://github.com/o/f/pull/3", "https://github.com/o/f", "https://github.com/o/f/", "https://github.com/o/f#x", "https://example.org/a"]) {
      assert.equal(factoryUrlTeile(u, "o/f"), null, u);
    }
  });
  test("Issue- und PR-Listen ohne Suffix und mit Suffix sind nicht erfasst; ein längerer Pfadanfang ist `fremd`", () => {
    for (const u of ["https://github.com/o/f/issues", "https://github.com/o/f/pull", "https://github.com/o/f/pulls", "https://github.com/o/f/issues?q=x", "https://github.com/o/f/pulls#a", "https://github.com/o/f/issues/"]) {
      assert.equal(factoryUrlTeile(u, "o/f"), null, u);
    }
    for (const u of ["https://github.com/o/f/issuesx/1", "https://github.com/o/f/pullsx"]) assert.equal(factoryUrlTeile(u, "o/f")?.form, "fremd", u);
  });
  test("jede andere URL auf das Repo ist `fremd` (z.B. /commit/<sha>, /blob/<ref> ohne Pfad)", () => {
    for (const u of ["https://github.com/o/f/commit/abc123", "https://github.com/o/f/blob/v1"]) assert.equal(factoryUrlTeile(u, "o/f")?.form, "fremd", u);
  });
  test("repoBasis", () => {
    assert.equal(repoBasis("o/f"), "https://github.com/o/f");
  });
});

/**
 * Wächter: Factory-URLs (`/blob/`, `/tree/`) baut und zerlegt nur `scripts/factory-seite.mjs` (factory#130). Scan-Umfang (geschlossen): die Teilzeichenketten
 * `/blob/` und `/tree/` in `scripts/**` (`.mjs`, `.cjs`, `.js`). Grenze: anders zusammengesetzte Segmente (`["blob", ref].join("/")`, `(blob|tree)` im
 * Regex) bleiben unerkannt.
 */
describe("Wächter: URL-Bau mit /blob/ und /tree/ nur in factory-seite.mjs", () => {
  const skripte = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? skripte(p) : /\.(?:mjs|cjs|js)$/.test(e.name) ? [p] : [];
    });
  const treffer = skripte(join(WURZEL, "scripts")).filter((p) => /\/(?:blob|tree)\//.test(readFileSync(p, "utf8")));
  const rel = (p: string): string => p.slice(WURZEL.length).replaceAll("\\", "/");
  test("Positivkontrolle: factory-seite.mjs trägt die Muster", () => {
    assert.ok(treffer.map(rel).includes("scripts/factory-seite.mjs"));
  });
  test("keine andere Skript-Datei trägt sie", () => {
    assert.deepEqual(treffer.map(rel).filter((p) => p !== "scripts/factory-seite.mjs"), []);
  });
});

// Wächter (factory#157): Laufzeitmeldungen nennen Factory-Seiten über `factorySeiteIn`, nicht als Text `docs/x.md › Abschnitt`.
// Scan-Umfang (geschlossen): `.mjs` unter `scripts/`, die das Besitz-Manifest als Ganz-Datei verteilt; gemeldet werden Nicht-Kommentarzeilen
// (getrimmt nicht mit `*`, `//` oder `/*` beginnend) mit `docs/<x>.md ›` oder `docs/<x>.md §`; ausgenommen ist ein Treffer direkt hinter `[` (Linktext) nur, wenn das Linkziel aufgelöst ist (`](${…}` oder `](http`).
const TEXTVERWEIS = /docs\/[\w./-]+\.md (›|§)/g;
describe("Wächter: Kern-Skripte verweisen in Laufzeitmeldungen nicht per Text auf Factory-Seiten (factory#157)", () => {
  const textverweise = (zeilen: string[]): string[] =>
    zeilen.flatMap((zeile, i) => {
      if (/^\s*(\*|\/\/|\/\*)/.test(zeile)) return [];
      return [...zeile.matchAll(TEXTVERWEIS)].filter((m) => !(zeile[m.index - 1] === "[" && /^[^\]]*\]\((?:\$\{|https?:)/.test(zeile.slice(m.index)))).map(() => `Zeile ${i + 1}: ${zeile.trim().slice(0, 80)}`);
    });

  test("kein Kern-Skript trägt `docs/x.md ›` oder `docs/x.md §` in einer Nicht-Kommentarzeile", () => {
    const manifest = rawBesitz.manifestAusText(readFileSync(join(WURZEL, rawBesitz.MANIFEST_PFAD), "utf8"));
    const dateien = (manifest.manifest.eintraege as { pfad: string; ring: string; block?: string; schluessel?: string }[])
      .filter((e) => rawBesitz.wirdVerteilt(e) && rawBesitz.istGanzeDatei(e) && /^scripts\/.*\.mjs$/.test(e.pfad))
      .map((e) => e.pfad);
    assert.ok(dateien.length > 100, `erwartet viele verteilte Skripte, gefunden ${dateien.length}`);
    const fehler = dateien.flatMap((pfad) => textverweise(readFileSync(join(WURZEL, pfad), "utf8").split("\n")).map((f) => `${pfad} ${f}`));
    assert.deepEqual(fehler, [], "Laufzeitmeldung auf `factorySeiteIn(WURZEL, \"<pfad>\", \"<anker>\")` umstellen.");
  });

  test("die Erkennung trifft Text, lässt Kommentar, Linktext und factorySeiteIn-Aufruf durch", () => {
    assert.equal(textverweise(['  "Mechanik: docs/a.md › Abschnitt."']).length, 1);
    assert.equal(textverweise(["  `siehe docs/a.md § Abschnitt`"]).length, 1);
    assert.deepEqual(textverweise([" * docs/a.md › Abschnitt", "// docs/a.md § X", "/* docs/a.md › X */"]), []);
    assert.deepEqual(textverweise(["`- [docs/a.md › Abschnitt](${url})`"]), []);
    assert.deepEqual(textverweise(['"[docs/a.md › Abschnitt](https://example.org/a)"']), []);
    assert.equal(textverweise(["`[docs/a.md › Abschnitt](docs/a.md#abschnitt)`"]).length, 1); // Linktext ohne aufgelöstes Ziel bleibt ein Textverweis
    assert.equal(textverweise(["`[docs/a.md › Abschnitt] und (${url})`"]).length, 1);
    assert.deepEqual(textverweise(['"Mechanik: " + factorySeiteIn(WURZEL, "docs/a.md", "abschnitt")']), []);
  });
});
