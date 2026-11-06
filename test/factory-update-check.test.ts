/* Factory-Update-Check (#90 L17): neuerer Release-Tag der Factory gegenüber dem Sync-Stand. Pure Funktionen und CLI ohne Netz (gh injiziert). */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/factory-update-check.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as lib from "../scripts/release-tag-lib.mjs";

type Meldung = { alt: string; neu: string; text: string } | null;
const { UPDATE_SCHRITTE, mechanischeSchritte } = lib as {
  UPDATE_SCHRITTE: { id: string; befehl?: string; text: string; mechanisch?: boolean }[];
  mechanischeSchritte: (quelle: string) => string[];
};
const { updateMeldung, fuehreAus } = raw as {
  updateMeldung: (a: { stand: unknown; tags: string[]; repo?: string }) => Meldung;
  fuehreAus: (argv: string[], io: { wurzel: string; gh: (args: string[]) => string }) => { out: string; err: string; code: number };
};

const ordner: string[] = [];
afterEach(() => {
  for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
});

function projekt(opts: { tag?: string; repo?: string; config?: boolean | "ohne-repo"; stand?: string }): string {
  const dir = mkdtempSync(join(tmpdir(), "factory-update-"));
  ordner.push(dir);
  mkdirSync(join(dir, ".factory"));
  if (opts.tag !== undefined) writeFileSync(join(dir, ".factory", "sync-stand.json"), JSON.stringify({ quelle: { tag: opts.tag, ...(opts.repo === undefined ? {} : { repo: opts.repo }) } }));
  if (opts.stand !== undefined) writeFileSync(join(dir, ".factory", "sync-stand.json"), opts.stand);
  if (opts.config !== false) {
    const board = { rolle: "factory", besitzer: "o", besitzerTyp: "user", nummer: 2 };
    const boards = [opts.config === "ohne-repo" ? board : { ...board, repo: "o/factory" }];
    writeFileSync(join(dir, ".factory", "projekt.json"), JSON.stringify({ version: 2, repo: "o/projekt", boards }));
  }
  return dir;
}
/** `gh api --paginate --jq .[].name` liefert je Tag eine Zeile, über alle Seiten. */
const tagsJson = (...namen: string[]) => `${namen.join("\n")}\n`;

describe("updateMeldung", () => {
  const stand = (tag: unknown) => ({ quelle: { tag } });
  test("neuerer Tag: alt, neu und Sync-Befehl", () => {
    const m = updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.0.0", "v1.1.0"] });
    assert.equal(m?.alt, "v1.0.0");
    assert.equal(m?.neu, "v1.1.0");
    assert.match(m?.text ?? "", /factory-sync\.mjs --quelle <pfad> --tag v1\.1\.0/);
  });
  test("L23: nennt das Werkzeug der Quelle für ein Manifest, das das eigene nicht kennt", () => {
    const text = updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.1.0"] })?.text ?? "";
    assert.match(text, /„version N unbekannt“/);
    assert.match(text, /node <quelle>\/scripts\/factory-sync\.mjs --quelle <quelle> --tag <tag>/);
  });
  test("factory#208 L18/L22: mechanische Schritte nach dem Sync stehen geordnet im Text, vor verify", () => {
    const text = updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.1.0"] })?.text ?? "";
    const reihenfolge = [
      "factory-sync.mjs --quelle <pfad> --tag v1.1.0",
      "npm run lint:prune",
      "node scripts/projektwerte.mjs --write",
      "npm run docs:gen",
      "npm run check:factorylinks -- --schreiben --quelle <pfad>",
      "Projektkopien",
      "node scripts/gate-befehl.mjs verifyKompakt",
    ].map((s) => text.indexOf(s));
    assert.ok(reihenfolge.every((i) => i >= 0), "ein Schritt fehlt: " + JSON.stringify(reihenfolge));
    assert.deepEqual([...reihenfolge].sort((a, b) => a - b), reihenfolge, "Reihenfolge der Schritte");
    assert.equal(UPDATE_SCHRITTE.length, 7);
  });
  test("factory#215 L2: die Meldung rendert jeden Schritt als Zeile mit Text, ohne Platzhalter-Reste", () => {
    const zeilen = (updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.1.0"] })?.text ?? "").split("\n").filter((z) => /^\d+\. /.test(z));
    assert.equal(zeilen.length, UPDATE_SCHRITTE.length);
    assert.ok(zeilen.every((z) => !/undefined|\{TAG\}/.test(z)), zeilen.join("\n"));
    assert.equal(zeilen[2], "3. `node scripts/projektwerte.mjs --write`");
  });
  test("factory#215 L2: mechanischeSchritte liefert die vier mechanischen Befehle in Reihenfolge, <pfad> ersetzt", () => {
    assert.deepEqual(mechanischeSchritte("<s>/quelle"), ["npm run lint:prune", "node scripts/projektwerte.mjs --write", "npm run docs:gen", "npm run check:factorylinks -- --schreiben --quelle <s>/quelle"]);
  });
  test("factory#215 L2/L15c: die Doku nennt jeden mechanischen Befehl (Update-Hinweis, Tag-Takt-Absatz, Glossar Vor-Tag-Probe)", () => {
    const harness = readFileSync(new URL("../docs/agent-harness.md", import.meta.url), "utf8");
    const glossar = readFileSync(new URL("../docs/harness-glossar.md", import.meta.url), "utf8");
    const start = harness.indexOf("**Update-Hinweis (factory#90)");
    const hinweis = harness.slice(start, harness.indexOf("\n", start));
    const takt = harness.slice(harness.indexOf("**Vor-Tag-Probe (factory#188"), harness.indexOf("**Beim Update im Bezieher**"));
    const zeile = glossar.split("\n").find((z) => z.startsWith("| Vor-Tag-Probe |")) ?? "";
    assert.ok(hinweis.length > 0 && takt.length > 0 && zeile.length > 0, "Doku-Abschnitt nicht gefunden");
    // Schlüsselwort je Befehl: Skriptname bzw. npm-Skript (die Doku darf ihn kürzen, nennen muss sie ihn).
    const schluessel = mechanischeSchritte("<q>").map((b) => (b.startsWith("npm run ") ? b.split(" ")[2] : /scripts\/([\w-]+)\.mjs/.exec(b)?.[1] ?? b));
    assert.equal(schluessel.length, 4);
    for (const [name, text] of [["Update-Hinweis", hinweis], ["Tag-Takt-Absatz", takt], ["Glossar", zeile]] as const) {
      for (const k of schluessel) assert.ok(text.includes(k), name + " nennt nicht: " + k);
    }
  });
  test("factory#208 L21: Bezieher-Migration steht im Tag-Ticket der Fabrik; mit Repo kommt der Suchbefehl, ohne Repo kein Platzhalter-Repo", () => {
    const mit = updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.1.0"], repo: "o/factory" })?.text ?? "";
    assert.match(mit, /Bezieher-Migration/);
    assert.match(mit, /gh issue list --repo o\/factory --search "Tag v1\.1\.0 setzen und syncen" --state all --limit 5/);
    const ohne = updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.1.0"] })?.text ?? "";
    assert.match(ohne, /Bezieher-Migration/);
    assert.doesNotMatch(ohne, /gh issue list/);
  });
  test("ein Patch-Release ist ein Update", () => {
    assert.equal(updateMeldung({ stand: stand("v1.0.0"), tags: ["v1.0.1"] })?.neu, "v1.0.1");
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
  test("upstream mit --json: update null, kein gh-Aufruf", () => {
    const r = fuehreAus(["--json"], { wurzel: projekt({}), gh: () => assert.fail("gh darf nicht laufen") });
    assert.equal(r.code, 0);
    assert.deepEqual(JSON.parse(r.out), { update: null });
  });
  test("kaputter Sync-Stand: Exit 2 mit Fix:, nie still grün", () => {
    const r = fuehreAus([], { wurzel: projekt({ stand: "{kaputt" }), gh: () => assert.fail("kein gh") });
    assert.equal(r.code, 2);
    assert.match(r.err, /Fix:/);
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
    assert.match(text.out, /--repo o\/factory --search "Tag v1\.2\.0 setzen und syncen"/);
    const json = fuehreAus(["--json"], { wurzel, gh });
    assert.equal((JSON.parse(json.out) as { update: { neu: string } }).update.neu, "v1.2.0");
    assert.ok(aufrufe[0].includes("repos/o/factory/tags"));
  });
  test("aktueller Stand im Text: Meldung nennt den Stand", () => {
    const r = fuehreAus([], { wurzel: projekt({ tag: "v1.2.0" }), gh: () => "v1.2.0\r\nv1.1.0\r\n" });
    assert.equal(r.code, 0);
    assert.match(r.out, /Kein neuer Factory-Release \(Stand v1\.2\.0\)/);
  });
  test("Sync-Stand ohne Tag: Meldung „Stand unbekannt“, Exit 0, kein Absturz", () => {
    const r = fuehreAus([], { wurzel: projekt({ stand: "{}" }), gh: () => "v1.0.0\n" });
    assert.equal(r.code, 0);
    assert.match(r.out, /Stand unbekannt/);
  });
  test("aktueller Stand: kein Update, --json update null", () => {
    const wurzel = projekt({ tag: "v1.2.0" });
    const r = fuehreAus(["--json"], { wurzel, gh: () => tagsJson("v1.2.0") });
    assert.equal(r.code, 0);
    assert.equal((JSON.parse(r.out) as { update: unknown }).update, null);
  });
  test("Sync-Stand mit quelle.repo: die Tags dieses Repos, nicht die des Boards oder des Projekts", () => {
    const aufrufe: string[][] = [];
    const gh = (args: string[]) => {
      aufrufe.push(args);
      return tagsJson("v1.0.0");
    };
    assert.equal(fuehreAus([], { wurzel: projekt({ tag: "v1.0.0", repo: "q/quelle", config: "ohne-repo" }), gh }).code, 0);
    assert.equal(fuehreAus([], { wurzel: projekt({ tag: "v1.0.0", repo: "q/quelle" }), gh }).code, 0);
    assert.ok(aufrufe.every((a) => a.includes("repos/q/quelle/tags")));
  });
  test("alter Stand ohne quelle.repo, Factory-Board ohne repo: nicht bestimmbar, Exit 2, kein Rückfall aufs eigene Repo", () => {
    const r = fuehreAus([], { wurzel: projekt({ tag: "v1.0.0", config: "ohne-repo" }), gh: () => assert.fail("kein gh") });
    assert.equal(r.code, 2);
    assert.match(r.err, /nicht bestimmbar/);
    assert.match(r.err, /quelle\.repo/);
  });
  test("Sync-Stand mit JSON-Inhalt null (oder Liste): kaputt, Exit 2 mit Fix: neu syncen, nicht „selbst Quelle“", () => {
    for (const stand of ["null", "[]", "5"]) {
      const r = fuehreAus([], { wurzel: projekt({ stand }), gh: () => assert.fail("kein gh") });
      assert.equal(r.code, 2, stand);
      assert.match(r.err, /Fix:.*neu/s);
      assert.doesNotMatch(r.out, /Quelle/);
    }
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
