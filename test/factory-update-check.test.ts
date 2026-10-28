/* Factory-Update-Check (#90 L17): neuerer Release-Tag der Factory gegenüber dem Sync-Stand. Pure Funktionen und CLI ohne Netz (gh injiziert). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/factory-update-check.mjs";

type Meldung = { alt: string; neu: string; text: string } | null;
const { vergleicheTags, updateMeldung, fuehreAus } = raw as {
  vergleicheTags: (tags: string[]) => string | null;
  updateMeldung: (a: { stand: unknown; tags: string[] }) => Meldung;
  fuehreAus: (argv: string[], io: { wurzel: string; gh: (args: string[]) => string }) => { out: string; err: string; code: number };
};

function projekt(opts: { tag?: string; config?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-update-"));
  mkdirSync(join(dir, ".factory"));
  if (opts.tag !== undefined) writeFileSync(join(dir, ".factory", "sync-stand.json"), JSON.stringify({ quelle: { tag: opts.tag } }));
  if (opts.config !== false) {
    const boards = [{ rolle: "factory", besitzer: "o", besitzerTyp: "user", nummer: 2, repo: "o/factory" }];
    writeFileSync(join(dir, ".factory", "projekt.json"), JSON.stringify({ version: 2, repo: "o/projekt", boards }));
  }
  return dir;
}
/** `gh api --paginate --jq .[].name` liefert je Tag eine Zeile, über alle Seiten. */
const tagsJson = (...namen: string[]) => `${namen.join("\n")}\n`;

describe("vergleicheTags", () => {
  test("liefert den höchsten Release-Tag, numerisch statt textlich; Pre-Release und Fremdtags zählen nicht", () => {
    assert.equal(vergleicheTags(["v1.9.0", "v1.10.0", "1.2.3", "v2.0.0-rc1", "latest", "v1.10", "xv3.0.0"]), "v1.10.0");
  });
  test("ohne Release-Tag null", () => {
    assert.equal(vergleicheTags(["latest", "v1.0.0-beta"]), null);
  });
});

describe("updateMeldung", () => {
  const stand = (tag: unknown) => ({ quelle: { tag } });
  test("neuerer Tag: alt, neu und Sync-Befehl", () => {
    const m = updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.0.0", "v1.1.0"] });
    assert.equal(m?.alt, "v1.0.0");
    assert.equal(m?.neu, "v1.1.0");
    assert.match(m?.text ?? "", /factory-sync\.mjs --quelle <pfad> --tag v1\.1\.0/);
  });
  test("gleicher oder älterer Tag: null", () => {
    assert.equal(updateMeldung({ stand: stand("v1.1.0"), tags: ["v1.0.0", "v1.1.0"] }), null);
    assert.equal(updateMeldung({ stand: stand("v2.0.0"), tags: ["v1.1.0"] }), null);
  });
  test("Stand ohne Release-Tag oder ohne Tags: null", () => {
    assert.equal(updateMeldung({ stand: stand("nightly"), tags: ["v1.1.0"] }), null);
    assert.equal(updateMeldung({ stand: {}, tags: ["v1.1.0"] }), null);
    assert.equal(updateMeldung({ stand: stand("v1.0.0"), tags: [] }), null);
  });
});

describe("fuehreAus", () => {
  test("upstream (kein Sync-Stand): nichts zu prüfen, Exit 0, kein gh-Aufruf", () => {
    const r = fuehreAus([], { wurzel: projekt({}), gh: () => assert.fail("gh darf nicht laufen") });
    assert.equal(r.code, 0);
    assert.match(r.out, /nichts zu prüfen/);
  });
  test("neuerer Tag: Meldung, --json liefert alt und neu; gh fragt das Factory-Repo aus der Config", () => {
    const aufrufe: string[][] = [];
    const gh = (args: string[]) => {
      aufrufe.push(args);
      return tagsJson("v1.0.0", "v1.2.0");
    };
    const wurzel = projekt({ tag: "v1.0.0" });
    const text = fuehreAus([], { wurzel, gh });
    assert.equal(text.code, 0);
    assert.match(text.out, /v1\.0\.0.*v1\.2\.0/s);
    const json = fuehreAus(["--json"], { wurzel, gh });
    assert.equal((JSON.parse(json.out) as { update: { neu: string } }).update.neu, "v1.2.0");
    assert.ok(aufrufe[0].includes("repos/o/factory/tags"));
  });
  test("aktueller Stand: kein Update, --json update null", () => {
    const wurzel = projekt({ tag: "v1.2.0" });
    const r = fuehreAus(["--json"], { wurzel, gh: () => tagsJson("v1.2.0") });
    assert.equal(r.code, 0);
    assert.equal((JSON.parse(r.out) as { update: unknown }).update, null);
  });
  test("fehlendes Factory-Repo: Exit 2 mit Fix:", () => {
    const r = fuehreAus([], { wurzel: projekt({ tag: "v1.0.0", config: false }), gh: () => assert.fail("kein gh") });
    assert.equal(r.code, 2);
    assert.match(r.err, /Fix:/);
  });
  test("unbekanntes Flag: Exit 2", () => {
    assert.equal(fuehreAus(["--x"], { wurzel: projekt({}), gh: () => "" }).code, 2);
  });
  test("gh scheitert: Exit 3 mit Fix:, nie still grün", () => {
    const r = fuehreAus([], {
      wurzel: projekt({ tag: "v1.0.0" }),
      gh: () => {
        throw new Error("HTTP 404");
      },
    });
    assert.equal(r.code, 3);
    assert.match(r.err, /Fix:/);
  });
});
