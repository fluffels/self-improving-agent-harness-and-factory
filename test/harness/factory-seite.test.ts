/* Factory-Seite-Verweise (#90 Z26): Unit-Tests von `scripts/factory-seite.mjs` und Wächter für die Literal-Aufrufe.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Wächter: jeder Aufruf `factorySeiteIn(<x>, "<pfad>", "<anker>")` mit zwei String-Literalen in `scripts/` (alle `.mjs`, rekursiv) muss auf eine
 * lokal vorhandene Datei und auf einen vorhandenen Überschrift-Anker zeigen (`collectHeadingSlugs`). Scan-Umfang (geschlossen): `.mjs` unter
 * `scripts/`, Aufruf in einer Zeile, Literale in doppelten Anführungszeichen. Berechnete Argumente liegen außerhalb. Link-Prüfung: #93. */
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

const { factorySeite, factorySeiteIn } = rawSeite as {
  factorySeite: (a: { pfad: string; anker?: string; repo?: string; tag?: string }) => string;
  factorySeiteIn: (wurzel: string, pfad: string, anker?: string) => string;
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
