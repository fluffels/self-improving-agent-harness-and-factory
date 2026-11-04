/* Factory-Link-Wächter als Kern (factory#130, ADR 0022 F10): Links ins Factory-Repo stehen auf dem Sync-Tag und zeigen auf Pfade und Anker, die es dort gibt.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Scan-Wächter: `codeMaskiert` ist nur in `docs-gen/markdown.mjs` definiert (Muster `function codeMaskiert` und `const codeMaskiert =` in `scripts/**`);
 * Grenze: eine Kopie unter anderem Namen bleibt unerkannt. Die Fixtures sind projektneutral (Repo `o/f`). */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, test } from "vitest";
import { SCHNAPPSCHUSS_ENDE as ENTFERNT_ENDE, SCHNAPPSCHUSS_START as ENTFERNT_START } from "../support/entfernte-pfade";
import { fixture } from "../support/tmp-fixture";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/check-factory-links.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMd from "../../scripts/docs-gen/markdown.mjs";

interface Stelle { start: number; ende: number; zeile: number; url: string; form: string; ref: string; pfad: string; anker: string; refStart: number }
interface Befund { art: string; datei?: string; zeile?: number; text: string }
const lib = raw as unknown as {
  factoryLinkStellen(md: string, repo: string): Stelle[];
  sammleLinks(root: string, o: { repo: string; einheiten?: string[]; ausnahmen?: string[] }): (Stelle & { datei: string })[];
  pruefeIndex(o: { links: unknown[]; index: unknown; sync: unknown; repo: string }): Befund[];
  auditFactoryLinks(root: string): { befunde: Befund[]; links: unknown[]; nichtsZuPruefen?: boolean };
  schreibeFactoryLinks(root: string, quelle: string): { befunde: Befund[]; geschrieben: number };
  cli(argv: string[], o: { wurzel: string; out: (s: string) => void; err: (s: string) => void }): number;
};
const { SCHNAPPSCHUSS_START, SCHNAPPSCHUSS_ENDE } = rawMd as unknown as { SCHNAPPSCHUSS_START: string; SCHNAPPSCHUSS_ENDE: string };

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const REPO = "o/f";
const u = (ref: string, pfad: string, anker = "", form = "blob") => `https://github.com/${REPO}/${form}/${ref}/${pfad}${anker ? `#${anker}` : ""}`;
const run = (argv: string[], wurzel: string) => {
  const out: string[] = [];
  const err: string[] = [];
  const code = lib.cli(argv, { wurzel, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
};
const CONFIG = (extra: Record<string, unknown> = {}) => JSON.stringify({ boards: [{ rolle: "factory", repo: REPO }], ...extra });

describe("factoryLinkStellen: Scan-Umfang", () => {
  const stellen = (md: string) => lib.factoryLinkStellen(md, REPO);

  test("erfasst Inline-Link, Bild, spitze Klammern und Autolink mit Ref, Pfad und Anker", () => {
    const md = [`[t](${u("v1", "a.md", "kopf")})`, `![b](${u("v1", "bild.png")})`, `[t](<${u("v1", "b.md")}>)`, `<${u("v1", "c.md")}>`].join("\n");
    const s = stellen(md);
    assert.deepEqual(s.map((x) => [x.form, x.ref, x.pfad, x.anker, x.zeile]), [["blob", "v1", "a.md", "kopf", 1], ["blob", "v1", "bild.png", "", 2], ["blob", "v1", "b.md", "", 3], ["blob", "v1", "c.md", "", 4]]);
    assert.equal(md.slice(s[0].refStart, s[0].refStart + 2), "v1");
    assert.equal(md.slice(s[0].start, s[0].ende), s[0].url);
  });
  test("tree-Link; Groß-/Kleinschreibung des Repos egal; Pfad und Anker dekodiert; kaputte Kodierung wirft nicht", () => {
    const s = stellen(`[a](https://github.com/O/F/tree/v1/test/h)\n[b](${u("v1", "d%20e.md", "k%C3%A4se")})`);
    assert.deepEqual(s.map((x) => [x.form, x.pfad, x.anker]), [["tree", "test/h", ""], ["blob", "d e.md", "käse"]]);
    assert.equal(stellen(`[a](${u("v1", "a%E0%A4%A.md", "k%zz")})`)[0].pfad, "a%E0%A4%A.md");
  });
  test("nicht erfasst: Code-Fence, Inline-Code, nackte URL, Referenz-Link, Issues, Pull, Wurzel, anderes Repo", () => {
    const md = [
      "```", `[t](${u("v1", "a.md")})`, "```",
      `\`[t](${u("v1", "a.md")})\``,
      u("v1", "a.md"),
      `[t][r]\n\n[r]: ${u("v1", "a.md")}`,
      `[i](https://github.com/${REPO}/issues/5)`, `[p](https://github.com/${REPO}/pull/6)`,
      `[w](https://github.com/${REPO})`, `[w2](https://github.com/${REPO}/)`, `[w3](https://github.com/${REPO}#readme)`,
      `[fremd](https://github.com/${REPO}x/blob/v1/a.md)`, `[andere](https://github.com/anderer/repo/blob/v1/a.md)`,
    ].join("\n");
    assert.deepEqual(stellen(md), []);
  });
  test("jede andere URL auf das Repo ist `fremd`; Titel stört nicht; `[t](<url>)` zählt einmal", () => {
    assert.deepEqual(stellen(`[c](https://github.com/${REPO}/commit/abc123)\n[b](https://github.com/${REPO}/blob/v1)`).map((x) => x.form), ["fremd", "fremd"]);
    assert.deepEqual(stellen(`[t](${u("v1", "a.md")} "Titel")`).map((x) => x.pfad), ["a.md"]);
    assert.equal(stellen(`[t](<${u("v1", "a.md")}>)`).length, 1);
  });
});

describe("sammleLinks: Ausnahmen", () => {
  const eintrag = `[x](${u("v0", "a.md")})`;
  const root = () =>
    fixture({
      "docs/x.md": eintrag,
      "docs/adr/x.md": eintrag,
      "docs/lessons-learned.md": eintrag,
      "docs/a-gegenprobe-b.md": eintrag,
      "docs/s.md": `${SCHNAPPSCHUSS_START}\n${eintrag}\n${SCHNAPPSCHUSS_ENDE}\n${eintrag}`,
      "docs/code.md": "```\n" + SCHNAPPSCHUSS_START + "\n```\n" + eintrag,
      "AGENTS.md": "<!-- factory-besitz:start kern -->\n" + eintrag + "\n<!-- factory-besitz:ende kern -->\n" + eintrag,
      "docs/ganz.md": eintrag,
    });
  const GLOBS = ["docs/adr/**", "docs/lessons-learned.md", "docs/*-gegenprobe-*.md"];
  const markiert = (l: { datei: string; zeile: number }[]) => l.map((x) => `${x.datei}:${x.zeile}`).sort();

  test("Ausnahme-Globs, Schnappschuss-Block, Besitz-Block und Besitz-Datei bleiben unerfasst; der Rest zählt", () => {
    const links = lib.sammleLinks(root(), { repo: REPO, ausnahmen: GLOBS, einheiten: ["AGENTS.md#kern", "docs/ganz.md", ".claude/settings.json#/hooks"] });
    assert.deepEqual(markiert(links), ["AGENTS.md:4", "docs/code.md:4", "docs/s.md:4", "docs/x.md:1"]);
  });
  test("ohne Ausnahmen zählen auch ADR, Lessons Learned und Gegenprobe (Gegenprobe zur Config)", () => {
    const links = lib.sammleLinks(root(), { repo: REPO, einheiten: ["AGENTS.md#kern", "docs/ganz.md"] });
    assert.deepEqual(markiert(links), ["AGENTS.md:4", "docs/a-gegenprobe-b.md:1", "docs/adr/x.md:1", "docs/code.md:4", "docs/lessons-learned.md:1", "docs/s.md:4", "docs/x.md:1"]);
  });
  test("mehrere Besitz-Blöcke in einer Datei: Links in jedem Block bleiben unerfasst, dazwischen und danach zählen sie", () => {
    const a = "<!-- factory-besitz:start a -->", ea = "<!-- factory-besitz:ende a -->", b = "<!-- factory-besitz:start b -->", eb = "<!-- factory-besitz:ende b -->";
    const r = fixture({ "AGENTS.md": [a, eintrag, ea, eintrag, b, eintrag, eb, eintrag].join("\n") });
    assert.deepEqual(markiert(lib.sammleLinks(r, { repo: REPO, einheiten: ["AGENTS.md#a", "AGENTS.md#b"] })), ["AGENTS.md:4", "AGENTS.md:8"]);
  });
  test("Marker mit CRLF-Zeilenende oder Einrückung öffnen und schließen ihren Block", () => {
    const r = fixture({
      "docs/s.md": [SCHNAPPSCHUSS_START, eintrag, SCHNAPPSCHUSS_ENDE, eintrag].join("\r\n"),
      "AGENTS.md": ["  <!-- factory-besitz:start kern -->", eintrag, "  <!-- factory-besitz:ende kern -->", eintrag].join("\r\n"),
    });
    assert.deepEqual(markiert(lib.sammleLinks(r, { repo: REPO, einheiten: ["AGENTS.md#kern"] })), ["AGENTS.md:4", "docs/s.md:4"]);
  });
  test("ein Marker im Code-Fence öffnet keinen Block: der Link danach wird erfasst", () => {
    assert.ok(lib.sammleLinks(root(), { repo: REPO }).some((l) => l.datei === "docs/code.md" && l.zeile === 4));
  });
  test("ein Schnappschuss-Start ohne Ende maskiert nichts (fail-closed): die Links danach werden erfasst", () => {
    const r = fixture({ "docs/o.md": `${eintrag}\n${SCHNAPPSCHUSS_START}\n${eintrag}\n${eintrag}` });
    assert.deepEqual(markiert(lib.sammleLinks(r, { repo: REPO })), ["docs/o.md:1", "docs/o.md:3", "docs/o.md:4"]);
  });
  test("JSON-Schlüssel- und Nicht-Markdown-Einheiten sowie ein Block ohne Marker maskieren nichts", () => {
    const r = fixture({ "docs/k.md": eintrag, "docs/b.md": eintrag });
    const links = lib.sammleLinks(r, { repo: REPO, einheiten: ["docs/k.md#/schluessel", "docs/b.md#fehlt", "scripts/x.mjs"] });
    assert.deepEqual(markiert(links), ["docs/b.md:1", "docs/k.md:1"]);
  });
  test("derselbe Link direkt nach dem Besitz-Block-Ende wird erfasst (Gegenprobe)", () => {
    assert.ok(lib.sammleLinks(root(), { repo: REPO, einheiten: ["AGENTS.md#kern"] }).some((l) => l.datei === "AGENTS.md" && l.zeile === 4));
  });
  test("die Schnappschuss-Marker sind die des Reste-Wächters (eine Quelle)", () => {
    assert.equal(SCHNAPPSCHUSS_START, ENTFERNT_START);
    assert.equal(SCHNAPPSCHUSS_ENDE, ENTFERNT_ENDE);
    assert.ok(!readFileSync(join(WURZEL, "test/support/entfernte-pfade.ts"), "utf8").includes("<!-- schnappschuss:"));
  });
});

describe("Prüfmodus", () => {
  const tagLinks = (ref: string, extra = "") => `[a](${u(ref, "a.md", "kopf")})\n[b](${u(ref, "test/h", "", "tree")})\n${extra}`;
  const indexJson = (tag: string, commit: string, ziele: Record<string, string[]>) => JSON.stringify({ repo: REPO, tag, commit, ziele });
  const projekt = (doku: string, index: string | null, sync: { tag?: string; commit?: string } = { tag: "v1", commit: "c1" }, config = CONFIG(), extra: Record<string, string> = {}) =>
    fixture({
      ".factory/projekt.json": config,
      ".factory/sync-stand.json": JSON.stringify({ quelle: { ...sync, sauber: true }, einheiten: {} }),
      ...(index === null ? {} : { ".factory/factory-links.json": index }),
      "docs/x.md": doku,
      ...extra,
    });
  const gut = () => indexJson("v1", "c1", { "a.md": ["kopf"], "test/h": [""] });
  const arten = (root: string) => lib.auditFactoryLinks(root).befunde.map((b) => b.art).sort();

  test("grün: Ref = Sync-Tag, alle Paare im Index, nichts verwaist, Beispiel-Link im Code-Fence ignoriert", () => {
    const root = projekt(tagLinks("v1", "```\n" + `[x](${u("v0", "tot.md")})\n` + "```"), gut());
    assert.deepEqual(lib.auditFactoryLinks(root).befunde, []);
    assert.equal(run([], root).code, 0);
  });
  test("Negativfall: ein Link auf einen anderen Ref als den Sync-Tag ist rot, mit Datei:Zeile und Fix-Befehl", () => {
    const r = run([], projekt(tagLinks("v0"), gut()));
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/x\.md:1: \[ref\]/);
    assert.match(r.err, /check:factorylinks -- --schreiben --quelle/);
    assert.match(r.err, /factoryLinks\.ausnahmen/);
  });
  test("derselbe Link in einer Datei, die ein Ausnahme-Glob trifft, bleibt grün; ohne den Schlüssel ist er rot", () => {
    const alt = { "docs/alt/b.md": `[a](${u("v0", "a.md", "kopf")})` };
    const mit = projekt(tagLinks("v1"), gut(), undefined, CONFIG({ factoryLinks: { ausnahmen: ["docs/alt/**"] } }), alt);
    assert.deepEqual(lib.auditFactoryLinks(mit).befunde, []);
    const ohne = projekt(tagLinks("v1"), gut(), undefined, CONFIG(), alt);
    assert.deepEqual(arten(ohne), ["ref"]);
    assert.match(run([], ohne).err, /docs\/alt\/b\.md:1: \[ref\]/);
  });
  test("ein ungültiger Glob (`[a]`, `../x`, `/abs`) ist ein Config-Fehler mit Exit 1", () => {
    for (const falsch of ["[a]", "../x", "/abs"]) {
      const root = projekt(tagLinks("v1"), gut(), undefined, CONFIG({ factoryLinks: { ausnahmen: [falsch] } }));
      const r = run([], root);
      assert.equal(r.code, 1, falsch);
      assert.match(r.err, /\[config\][\s\S]*factoryLinks\.ausnahmen/, falsch);
    }
  });
  test("rot: Link außerhalb des Index, verwaister Index-Eintrag, Index-Stand (Tag, Commit, Repo), Index fehlt oder kein JSON, fremde Form", () => {
    assert.deepEqual(arten(projekt(`[a](${u("v1", "a.md", "andere")})\n[b](${u("v1", "test/h", "", "tree")})`, gut())), ["nicht-im-index", "verwaist"]);
    const r = run([], projekt(tagLinks("v1"), indexJson("v1", "c1", { "a.md": ["kopf"], "test/h": [""], "tot.md": [""] })));
    assert.equal(r.code, 1);
    assert.match(r.err, /tot\.md wird von keinem Link genutzt/);
    assert.deepEqual(arten(projekt(tagLinks("v1"), indexJson("v0", "c1", { "a.md": ["kopf"], "test/h": [""] }))), ["index-stand"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), indexJson("v1", "c0", { "a.md": ["kopf"], "test/h": [""] }))), ["index-stand"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), JSON.stringify({ repo: "x/y", tag: "v1", commit: "c1", ziele: { "a.md": ["kopf"], "test/h": [""] } }))), ["index-stand"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), null)), ["index-fehlt"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), "{kaputt")), ["index-fehlt"]);
    assert.deepEqual(arten(projekt(`[c](https://github.com/${REPO}/commit/abc)`, indexJson("v1", "c1", {}))), ["form"]);
  });
  test("ohne Sync-Stand: nichts zu prüfen, Exit 0 (auch bei Links auf falschem Ref)", () => {
    const root = fixture({ ".factory/projekt.json": CONFIG(), "docs/x.md": tagLinks("v0") });
    const r = run([], root);
    assert.equal(r.code, 0);
    assert.match(r.out, /nichts zu prüfen/);
  });
  test("rot: Sync-Stand ohne Tag oder ohne Commit, kaputter Sync-Stand", () => {
    assert.deepEqual(arten(projekt(tagLinks("v1"), gut(), { tag: "", commit: "" })), ["sync-stand"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), gut(), { tag: "v1", commit: "" })), ["sync-stand"]);
    assert.deepEqual(arten(projekt(tagLinks("v1"), gut(), { commit: "c1" })), ["sync-stand"]);
    const kaputt = fixture({ ".factory/projekt.json": CONFIG(), ".factory/sync-stand.json": "[]", "docs/x.md": tagLinks("v1") });
    assert.deepEqual(arten(kaputt), ["sync-stand"]);
  });
  test("rot: Factory-Repo nicht bestimmbar (kein quelle.repo, kein Board mit Rolle factory)", () => {
    const root = projekt(tagLinks("v1"), gut(), undefined, JSON.stringify({ boards: [{ rolle: "produkt", repo: REPO }] }));
    assert.deepEqual(arten(root), ["projekt"]);
    assert.match(run([], root).err, /\[projekt\]/);
  });
  test("Besitz-Einheiten des Sync-Stands gelten in Prüfung und Aufruf: ein Link im Besitz-Block ist kein Befund", () => {
    const block = (inhalt: string) => `<!-- factory-besitz:start kern -->
${inhalt}
<!-- factory-besitz:ende kern -->
`;
    const root = fixture({
      ".factory/projekt.json": CONFIG(),
      ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v1", commit: "c1" }, einheiten: { "AGENTS.md#kern": "h" } }),
      ".factory/factory-links.json": gut(),
      "docs/x.md": tagLinks("v1"),
      "AGENTS.md": block(`[z](${u("v0", "tot.md")})`),
    });
    assert.deepEqual(lib.auditFactoryLinks(root).befunde, []);
    assert.equal(run([], root).code, 0);
  });
  test("Sync-Stand ohne quelle-Objekt und Index ohne ziele sind Befunde, kein Absturz", () => {
    const ohneQuelle = fixture({ ".factory/projekt.json": CONFIG(), ".factory/sync-stand.json": JSON.stringify({ einheiten: {} }), "docs/x.md": tagLinks("v1") });
    assert.deepEqual(arten(ohneQuelle), ["sync-stand"]);
    assert.equal(lib.schreibeFactoryLinks(ohneQuelle, ohneQuelle).befunde[0].art, "sync-stand");
    assert.deepEqual(arten(projekt(tagLinks("v1"), JSON.stringify({ repo: REPO, tag: "v1", commit: "c1" }))), ["nicht-im-index", "nicht-im-index"]);
  });
  test("der Ausnahmen-Hinweis erscheint nur bei einem ref-Befund", () => {
    assert.doesNotMatch(run([], projekt(tagLinks("v1"), null)).err, /Hinweis: historische/);
    assert.match(run([], projekt(tagLinks("v0"), gut())).err, /Hinweis: historische/);
  });
  test("--wurzel wählt den Projektbaum; pruefeIndex ohne Link und Eintrag ist grün", () => {
    const root = projekt(tagLinks("v1"), gut());
    const r = run(["--wurzel", root], fixture({ "leer.txt": "" }));
    assert.equal(r.code, 0);
    assert.match(r.out, /2 Factory-Links auf 2 Ziele am Sync-Tag und 0 Anker-Stubs ohne Befund/);
    assert.deepEqual(lib.pruefeIndex({ links: [], index: { repo: REPO, tag: "v1", commit: "c1", ziele: {} }, sync: { quelle: { tag: "v1", commit: "c1" } }, repo: REPO }), []);
  });
  test("Aufruf: --quelle ohne --schreiben und umgekehrt sind Exit 2", () => {
    const root = projekt(tagLinks("v1"), gut());
    assert.equal(run(["--quelle", "x"], root).code, 2);
    assert.equal(run(["--schreiben"], root).code, 2);
    assert.equal(run(["--gibtsnicht"], root).code, 2);
  });
});

describe("Schreibmodus e2e mit temporärem Git-Repo als Quelle", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" }).trim();
  /** Klon-Attrappe: a.md mit Überschrift, test/x.test.ts, Ordner test/h/, Tag v9 auf dem einzigen Commit. */
  const klon = (tag = "v9") => {
    const d = mkdtempSync(join(tmpdir(), "flinks-"));
    dirs.push(d);
    git(d, "init", "-q");
    mkdirSync(join(d, "test", "h"), { recursive: true });
    writeFileSync(join(d, "a.md"), "# Kopf\n\ntext\n");
    writeFileSync(join(d, "test", "x.test.ts"), "x");
    writeFileSync(join(d, "test", "h", "y.txt"), "y");
    mkdirSync(join(d, "test", "h.md"), { recursive: true });
    writeFileSync(join(d, "test", "h.md", "z.txt"), "z");
    git(d, "add", "-A");
    git(d, "commit", "-q", "-m", "c");
    if (tag) git(d, "tag", tag);
    return { dir: d, commit: git(d, "rev-parse", "HEAD") };
  };
  const projekt = (doku: string, commit: string, config = CONFIG()) =>
    fixture({
      ".factory/projekt.json": config,
      ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v9", commit, sauber: true }, einheiten: {} }),
      "docs/x.md": doku,
    });
  const lies = (root: string, rel: string) => readFileSync(join(root, rel), "utf8");
  const existiert = (root: string, rel: string) => {
    try {
      readFileSync(join(root, rel));
      return true;
    } catch {
      return false;
    }
  };
  /** Schreibmodus muss scheitern: Art im Fehlertext, Doku byte-gleich, kein Index. */
  const rot = (root: string, k: { dir: string }, art: RegExp, doku: string) => {
    const r = run(["--schreiben", "--quelle", k.dir], root);
    assert.equal(r.code, 1, r.err);
    assert.match(r.err, art);
    assert.equal(lies(root, "docs/x.md"), doku);
    assert.equal(existiert(root, ".factory/factory-links.json"), false);
    return r;
  };

  test("Glücksfall: Refs auf den Tag, Index geschrieben, danach Prüfmodus grün; tree als Ordner-Präfix, Zeilenenden bleiben", () => {
    const k = klon();
    const doku = `[a](${u("v1", "a.md", "kopf")}) und [t](${u("v1", "test/x.test.ts")})\r\n[o](${u("v1", "test/h", "", "tree")})\r\n`;
    const root = projekt(doku, k.commit);
    const r = run(["--schreiben", "--quelle", k.dir], root);
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(root, "docs/x.md"), doku.replaceAll("/v1/", "/v9/"));
    assert.equal(lies(root, ".factory/factory-links.json"), `{\n  "repo": "o/f",\n  "tag": "v9",\n  "commit": "${k.commit}",\n  "ziele": {\n    "a.md": ["kopf"],\n    "test/h": [""],\n    "test/x.test.ts": [""]\n  }\n}\n`);
    assert.equal(run([], root).code, 0);
  });
  test("toter Anker, toter Pfad, tree auf fehlenden Ordner und fremde URL-Form: rot, nichts geschrieben", () => {
    const k = klon();
    let doku = `[a](${u("v1", "a.md", "gibts-nicht")})\n`;
    rot(projekt(doku, k.commit), k, /\[anker-tot\]/, doku);
    doku = `[a](${u("v1", "weg.md")})\n[b](${u("v1", "test/nix", "", "tree")})\n`;
    assert.equal(rot(projekt(doku, k.commit), k, /\[pfad-tot\]/, doku).err.match(/\[pfad-tot\]/g)?.length, 2);
    doku = `[c](https://github.com/${REPO}/commit/abc)\n[a](${u("v1", "a.md")})\n`;
    rot(projekt(doku, k.commit), k, /\[form\]/, doku);
  });
  test("Tag zeigt auf einen anderen Commit als der Sync-Stand; Tag fehlt in der Quelle: rot", () => {
    const doku = `[a](${u("v1", "a.md")})\n`;
    rot(projekt(doku, "0".repeat(40)), klon(), /\[tag-commit\]/, doku);
    const k = klon("");
    rot(projekt(doku, k.commit), k, /\[quelle\]/, doku);
  });
  test("Anker bei Nicht-Markdown-Ziel und bei tree wird nicht geprüft", () => {
    const k = klon();
    const root = projekt(`[a](${u("v1", "test/x.test.ts", "L10")})\n[b](${u("v1", "test/h.md", "irgendwas", "tree")})\n`, k.commit);
    assert.equal(run(["--schreiben", "--quelle", k.dir], root).code, 0);
  });
  test("ohne Sync-Stand, ohne Sync-Commit, ohne Factory-Repo oder mit kaputtem Glob: rot, nichts geschrieben", () => {
    const k = klon();
    const doku = `[a](${u("v1", "a.md")})\n`;
    rot(fixture({ ".factory/projekt.json": CONFIG(), "docs/x.md": doku }), k, /\[sync-stand\]/, doku);
    rot(projekt(doku, ""), k, /\[sync-stand\]/, doku);
    rot(projekt(doku, k.commit, JSON.stringify({ boards: [] })), k, /\[projekt\]/, doku);
    rot(projekt(doku, k.commit, CONFIG({ factoryLinks: { ausnahmen: ["[a]"] } })), k, /\[config\]/, doku);
  });
  test("Ausnahme-Glob gilt auch beim Schreiben: die Datei wird nicht umgeschrieben", () => {
    const k = klon();
    const alt = `[a](${u("v1", "a.md")})\n`;
    const root = fixture({
      ".factory/projekt.json": CONFIG({ factoryLinks: { ausnahmen: ["docs/alt/**"] } }),
      ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v9", commit: k.commit }, einheiten: {} }),
      "docs/x.md": `[a](${u("v1", "a.md")})\n`,
      "docs/alt/b.md": alt,
    });
    assert.equal(run(["--schreiben", "--quelle", k.dir], root).code, 0);
    assert.equal(lies(root, "docs/alt/b.md"), alt);
    assert.equal(lies(root, "docs/x.md"), `[a](${u("v9", "a.md")})\n`);
  });
  test("Besitz-Block des Sync-Stands wird beim Schreiben nicht umgeschrieben, der Link außerhalb schon", () => {
    const k = klon();
    const block = `<!-- factory-besitz:start kern -->
[a](${u("v1", "a.md")})
<!-- factory-besitz:ende kern -->
`;
    const root = fixture({
      ".factory/projekt.json": CONFIG(),
      ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v9", commit: k.commit }, einheiten: { "AGENTS.md#kern": "h" } }),
      "docs/x.md": `[a](${u("v1", "a.md")})
`,
      "AGENTS.md": block,
    });
    assert.equal(run(["--schreiben", "--quelle", k.dir], root).code, 0);
    assert.equal(lies(root, "AGENTS.md"), block);
    assert.equal(lies(root, "docs/x.md"), `[a](${u("v9", "a.md")})
`);
  });
  test("Ref anderer Länge, mehrere Links in einer Zeile: kein Link wird zerschnitten", () => {
    const k = klon();
    const doku = `[a](${u("v1.2.3", "a.md", "kopf")}) [t](${u("v1.2.3", "test/x.test.ts")}) [b](${u("v1.2.3", "a.md")})\n`;
    const root = projekt(doku, k.commit);
    assert.equal(run(["--schreiben", "--quelle", k.dir], root).code, 0);
    assert.equal(lies(root, "docs/x.md"), doku.replaceAll("v1.2.3", "v9"));
  });
  test("Index: mehrere Anker je Pfad sortiert, doppelte Paare einmal", () => {
    const k = klon();
    writeFileSync(join(k.dir, "b.md"), "# Zeta\n\n# Alpha\n");
    git(k.dir, "add", "-A");
    git(k.dir, "commit", "-q", "-m", "b");
    git(k.dir, "tag", "-f", "v9");
    const root = projekt(`[a](${u("v1", "b.md", "zeta")}) [b](${u("v1", "b.md", "alpha")}) [c](${u("v1", "b.md", "zeta")})\n`, git(k.dir, "rev-parse", "HEAD"));
    assert.equal(run(["--schreiben", "--quelle", k.dir], root).code, 0);
    assert.match(lies(root, ".factory/factory-links.json"), /"b\.md": \["alpha","zeta"\]/);
  });
});

describe("Scan-Wächter: codeMaskiert nur in docs-gen/markdown.mjs", () => {
  const skripte = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = join(dir, e.name);
      return e.isDirectory() ? skripte(p) : /\.(?:mjs|cjs|js)$/.test(e.name) ? [p] : [];
    });
  const treffer = skripte(join(WURZEL, "scripts"))
    .filter((p) => /\bfunction\s+codeMaskiert\b|\bconst\s+codeMaskiert\s*=/.test(readFileSync(p, "utf8")))
    .map((p) => p.slice(WURZEL.length).replaceAll("\\", "/"));
  test("Positivkontrolle: genau ein Treffer, in markdown.mjs", () => {
    assert.deepEqual(treffer, ["scripts/docs-gen/markdown.mjs"]);
  });
});

describe("Anker-Stubs (factory#132): Kern-Links auf Nicht-Besitz-Seiten sind im Bezieher gedeckt", () => {
  const block = (inhalt: string) => `<!-- factory-besitz:start kern -->\n${inhalt}\n<!-- factory-besitz:ende kern -->\n`;
  const stubRoot = (zielText: string | null, o: { kern?: string; agents?: string; ziele?: Record<string, string[]>; einheiten?: Record<string, string>; extra?: Record<string, string> } = {}) =>
    fixture({
      ".factory/projekt.json": CONFIG(),
      ".factory/sync-stand.json": JSON.stringify({ quelle: { tag: "v2", commit: "c2" }, einheiten: o.einheiten ?? { "AGENTS.md#kern": "h" } }),
      ".factory/factory-links.json": JSON.stringify({ repo: REPO, tag: "v2", commit: "c2", ziele: o.ziele ?? { "docs/z.md": ["abschnitt"] } }),
      "AGENTS.md": o.agents ?? block(o.kern ?? "[Z](docs/z.md#abschnitt)"),
      ...(zielText === null ? {} : { "docs/z.md": zielText }),
      ...o.extra,
    });
  const stub = (ref = "v2", anker = "abschnitt") => `Kern: [Z](${u(ref, "docs/z.md", anker)})`;
  const gut = `# Z\n\n## Abschnitt\n\n${stub()}\n\n## Anderes\n`;
  const stubBefunde = (root: string) => lib.auditFactoryLinks(root).befunde.filter((b) => b.art.startsWith("stub-"));
  const arten = (root: string) => stubBefunde(root).map((b) => b.art);

  test("grün: Überschrift mit Factory-Link auf genau pfad#anker am Sync-Tag; die OK-Zeile nennt die Stub-Zahl", () => {
    const root = stubRoot(gut);
    assert.deepEqual(lib.auditFactoryLinks(root).befunde, []);
    const r = run([], root);
    assert.equal(r.code, 0);
    assert.match(r.out, /1 Anker-Stub/);
  });
  test("Negativfall: Überschrift ohne Factory-Link ist rot, die Meldung nennt die Soll-URL und beide Orte", () => {
    const b = stubBefunde(stubRoot("# Z\n\n## Abschnitt\n\nText\n"));
    assert.deepEqual(b.map((x) => x.art), ["stub-link"]);
    assert.equal(b[0].datei, "docs/z.md");
    assert.equal(b[0].zeile, 3);
    assert.ok(b[0].text.includes(u("v2", "docs/z.md", "abschnitt")));
    assert.ok(b[0].text.includes("AGENTS.md:2"));
  });
  test("Negativfall: Factory-Link auf einem anderen Ref ist rot (zusätzlich zum Ref-Befund)", () => {
    const root = stubRoot(`# Z\n\n## Abschnitt\n\n${stub("v1")}\n`);
    assert.deepEqual(arten(root), ["stub-link"]);
    assert.ok(lib.auditFactoryLinks(root).befunde.some((b) => b.art === "ref"));
  });
  test("Negativfall: Factory-Link auf einen anderen Anker oder ein anderes Ziel ist rot", () => {
    assert.deepEqual(arten(stubRoot(`# Z\n\n## Abschnitt\n\n${stub("v2", "anderes")}\n`)), ["stub-link"]);
    const fremd = `# Z\n\n## Abschnitt\n\n[Y](${u("v2", "docs/y.md", "abschnitt")})\n`;
    assert.deepEqual(arten(stubRoot(fremd)), ["stub-link"]);
  });
  test("Negativfall: keine passende Überschrift ist rot (stub-anker); der Anker wird roh verglichen", () => {
    assert.deepEqual(arten(stubRoot(`# Z\n\n## Anders\n\n${stub()}\n`)), ["stub-anker"]);
    assert.deepEqual(arten(stubRoot(gut, { kern: "[Z](docs/z.md#Abschnitt)" })), ["stub-anker"]);
  });
  test("Abschnitt: ein Link unter der nächsten Überschrift gleicher Ebene ist rot, unter einer tieferen Unterüberschrift grün", () => {
    assert.deepEqual(arten(stubRoot(`# Z\n\n## Abschnitt\n\nText\n\n## Anderes\n\n${stub()}\n`)), ["stub-link"]);
    assert.deepEqual(arten(stubRoot(`# Z\n\n## Abschnitt\n\nText\n\n### Unter\n\n${stub()}\n\n## Anderes\n`)), []);
  });
  test("Negativfall: fehlt das Ziel, ist es rot (stub-ziel) an der Stelle des Kern-Links", () => {
    const b = stubBefunde(stubRoot(null));
    assert.deepEqual(b.map((x) => x.art), ["stub-ziel"]);
    assert.equal(b[0].datei, "AGENTS.md");
    assert.equal(b[0].zeile, 2);
  });
  test("ohne Anker reicht irgendwo in der Datei ein Factory-Link auf die Seite am Sync-Tag; ohne ihn ist es rot", () => {
    const o = { kern: "[Z](docs/z.md)", ziele: { "docs/z.md": [""] } };
    assert.deepEqual(arten(stubRoot(`# Z\n\nKern: [Z](${u("v2", "docs/z.md")})\n`, o)), []);
    assert.deepEqual(arten(stubRoot(`# Z\n\nKern: [Z](${u("v1", "docs/z.md")})\n`, o)), ["stub-link"]);
    assert.deepEqual(arten(stubRoot("# Z\n\nText\n", o)), ["stub-link"]);
  });
  test("nicht geprüft: Link außerhalb des Besitz-Blocks, Ziel mit Einheit, Link im Code-Fence, Nicht-Markdown-Ziel, reiner Anker", () => {
    const kern = "[a](docs/y.md#x)\n```\n[b](docs/fehlt.md#x)\n```\n[c](scripts/x.mjs#L1)\n[d](#lokal)";
    const agents = `[aussen](docs/fehlt.md#x)\n${block(kern)}`;
    const root = stubRoot(null, { agents, einheiten: { "AGENTS.md#kern": "h", "docs/y.md": "h" } });
    assert.deepEqual(arten(root), []);
  });
  test("Duplikate: ein Befund je (Quelle, Ziel, Anker) an der ersten Stelle", () => {
    const b = stubBefunde(stubRoot(null, { kern: "[a](docs/z.md#abschnitt)\n[b](docs/z.md#abschnitt)" }));
    assert.deepEqual(b.map((x) => [x.art, x.zeile]), [["stub-ziel", 2]]);
  });
  test("ein Factory-Link nur im Schnappschuss-Block des Ziels zählt nicht", () => {
    const ziel = `# Z\n\n## Abschnitt\n\n${SCHNAPPSCHUSS_START}\n${stub()}\n${SCHNAPPSCHUSS_ENDE}\n`;
    assert.deepEqual(arten(stubRoot(ziel)), ["stub-link"]);
  });
  test("Duplikat-Überschrift: Anker abschnitt-1 trifft die zweite Überschrift und ihren Abschnitt", () => {
    const ziel = `# Z\n\n## Abschnitt\n\n${stub("v2", "abschnitt-1")}\n\n## Abschnitt\n\nText\n`;
    assert.deepEqual(arten(stubRoot(ziel, { kern: "[Z](docs/z.md#abschnitt-1)", ziele: { "docs/z.md": ["abschnitt-1"] } })), ["stub-link"]);
    const zweite = `# Z\n\n## Abschnitt\n\nText\n\n## Abschnitt\n\n${stub("v2", "abschnitt-1")}\n`;
    assert.deepEqual(arten(stubRoot(zweite, { kern: "[Z](docs/z.md#abschnitt-1)", ziele: { "docs/z.md": ["abschnitt-1"] } })), []);
  });
  test("Blatt-Einheit (ganze Datei) und CRLF: Links einer ganzen Besitz-Datei zählen, Zeilenenden sind egal", () => {
    const root = stubRoot(gut.replace(/\n/g, "\r\n"), {
      agents: "# A\n",
      einheiten: { "AGENTS.md#kern": "h", "docs/k.md": "h" },
      extra: { "docs/k.md": "[Z](z.md#abschnitt)\n" },
    });
    assert.deepEqual(arten(root), []);
    assert.deepEqual(arten(stubRoot("# Z\r\n\r\n## Abschnitt\r\n\r\nText\r\n", { agents: "# A\n", einheiten: { "docs/k.md": "h" }, extra: { "docs/k.md": "[Z](z.md#abschnitt)\n" } })), ["stub-link"]);
  });
  test("ohne Sync-Stand gibt es keine Stubs zu prüfen", () => {
    const root = fixture({ ".factory/projekt.json": CONFIG(), "AGENTS.md": block("[Z](docs/z.md#abschnitt)") });
    assert.equal(lib.auditFactoryLinks(root).nichtsZuPruefen, true);
  });
});

describe("Lebendigkeit: dieses Repo", () => {
  test("ohne Sync-Stand nichts zu prüfen, sonst keine Befunde", () => {
    const r = lib.auditFactoryLinks(WURZEL);
    assert.deepEqual(r.befunde, []);
    assert.equal(r.nichtsZuPruefen === true, !readdirSync(join(WURZEL, ".factory")).includes("sync-stand.json"));
  });
});
