/* Link-Schritt im Sync (factory#131, Teil 2 von factory#93): `factory-sync --tag` stellt die Factory-Links des Ziels im selben atomaren Lauf auf den Tag um
 * und schreibt `.factory/factory-links.json`. Pure Tests des Link-Plans (`planeFactoryLinks`) und Läufe gegen Temp-Fixtures (Repo `o/f`). */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLinks from "../scripts/factory-links-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSeite from "../scripts/factory-seite.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSync from "../scripts/factory-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawWaechter from "../scripts/check-factory-links.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMd from "../scripts/docs-gen/markdown.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDocdrift from "../scripts/check-docdrift.mjs";

interface Leser { pfade: string[]; lies(p: string): string | null; vorladen(p: string[]): void }
interface Plan { befunde: { art: string; datei?: string; zeile?: number; text: string }[]; dateien: Map<string, string>; geschrieben: number; ziele: number; tag: string }
const links = rawLinks as unknown as {
  planeFactoryLinks(o: { dateien: string[]; lies: (p: string) => string | null; repo: string; einheiten: string[]; ausnahmen: string[]; tag: string; commit: string; leser: Leser }): Plan;
  indexText(k: { repo: string; tag: string; commit: string }, l: unknown[]): string;
  befundZeile(b: { art: string; datei?: string; zeile?: number; text: string }): string;
};
const seite = rawSeite as unknown as { factoryRepoAus(stand: unknown, lade: () => unknown): string | undefined };
const sync = rawSync as unknown as { cli(argv: string[], o: { cwd?: string; out: (s: string) => void; err: (s: string) => void }): number };
const waechter = rawWaechter as unknown as { cli(argv: string[], o: { wurzel: string; out: (s: string) => void; err: (s: string) => void }): number };
const besitz = rawBesitz as unknown as { markerStart(id: string): string; markerEnde(id: string): string };
const pc = rawPc as unknown as { ROLLEN_PFADE: Record<string, string>; PROJEKT_ROLLEN: string[] };

const REPO = "o/f";
const u = (ref: string, pfad: string, anker = "") => `https://github.com/${REPO}/blob/${ref}/${pfad}${anker ? `#${anker}` : ""}`;

// ── Pure Plan-Tests ───────────────────────────────────────────────────────────

const FAKE_BAUM: Record<string, string> = { "docs/a.md": "# H\n\ntext\n", "AGENTS.md": "# Titel\n" };
const fakeLeser = (): Leser => ({ pfade: Object.keys(FAKE_BAUM), lies: (p) => FAKE_BAUM[p] ?? null, vorladen: () => {} });
function plane(texte: Record<string, string>, tag = "v2"): Plan {
  return links.planeFactoryLinks({ dateien: Object.keys(texte).filter((p) => p.endsWith(".md")), lies: (p) => texte[p] ?? null, repo: REPO, einheiten: [], ausnahmen: [], tag, commit: "c0ffee", leser: fakeLeser() });
}
const INDEX_V2 = `{\n  "repo": "o/f",\n  "tag": "v2",\n  "commit": "c0ffee",\n  "ziele": {\n    "docs/a.md": ["h"]\n  }\n}\n`;

describe("planeFactoryLinks (pur)", () => {
  test("alter Ref wird umgeschrieben, CRLF bleibt, der Index steht im Plan", () => {
    const p = plane({ "x.md": `a\r\n[l](${u("v1", "docs/a.md", "h")})\r\n` });
    assert.deepEqual(p.befunde, []);
    assert.equal(p.dateien.get("x.md"), `a\r\n[l](${u("v2", "docs/a.md", "h")})\r\n`);
    assert.equal(p.dateien.get(".factory/factory-links.json"), INDEX_V2);
    assert.equal(p.geschrieben, 1);
    assert.equal(p.ziele, 1);
  });
  test("ein zweiter Lauf auf dem Ergebnis ändert nichts (idempotent)", () => {
    const erst = plane({ "x.md": `[l](${u("v1", "docs/a.md", "h")})\n` });
    const texte = { "x.md": erst.dateien.get("x.md") ?? "", ".factory/factory-links.json": erst.dateien.get(".factory/factory-links.json") ?? "" };
    assert.equal(plane(texte).dateien.size, 0);
  });
  test("ein Index mit CRLF bleibt CRLF und wird bei gleichem Inhalt nicht angefasst", () => {
    const texte = { "x.md": `[l](${u("v2", "docs/a.md", "h")})\n`, ".factory/factory-links.json": INDEX_V2.replace(/\n/g, "\r\n") };
    assert.equal(plane(texte).dateien.size, 0);
    const anders = plane({ ...texte, ".factory/factory-links.json": INDEX_V2.replace("v2", "v1").replace(/\n/g, "\r\n") });
    assert.equal(anders.dateien.get(".factory/factory-links.json"), INDEX_V2.replace(/\n/g, "\r\n"));
  });
  test("toter Anker, toter Pfad und fremde Form sind Befunde mit Datei und Zeile, geschrieben wird nichts", () => {
    const text = `Zeile\n[a](${u("v1", "docs/a.md", "weg")})\n[b](${u("v1", "docs/fehlt.md")})\n[c](https://github.com/${REPO}/commit/abc)\n`;
    const p = plane({ "x.md": text });
    assert.deepEqual(p.befunde.map((b) => [b.art, b.datei, b.zeile]), [["form", "x.md", 4], ["anker-tot", "x.md", 2], ["pfad-tot", "x.md", 3]]);
    assert.match(links.befundZeile(p.befunde[1]), /^x\.md:2: \[anker-tot\] /);
    assert.equal(p.dateien.size, 0);
    assert.equal(p.geschrieben, 0);
  });
  test("ohne Links steht im Index `\"ziele\": {}`", () => {
    const p = plane({ "x.md": "nichts\n" });
    assert.equal(p.dateien.get(".factory/factory-links.json"), `{\n  "repo": "o/f",\n  "tag": "v2",\n  "commit": "c0ffee",\n  "ziele": {}\n}\n`);
    assert.deepEqual((JSON.parse(p.dateien.get(".factory/factory-links.json") ?? "") as { ziele: unknown }).ziele, {});
  });
});

describe("sammleLinksAus (pur)", () => {
  test("ein Leser ohne Text (null) überspringt die Datei", () => {
    const l = rawLinks as unknown as { sammleLinksAus(a: { dateien: string[]; lies: (p: string) => string | null }, o: { repo: string }): unknown[] };
    assert.deepEqual(l.sammleLinksAus({ dateien: ["weg.md"], lies: () => null }, { repo: REPO }), []);
    assert.deepEqual(l.sammleLinksAus({ dateien: ["weg.md"], lies: () => undefined as unknown as null }, { repo: REPO }), []);
  });
});

describe("factoryRepoAus (pur)", () => {
  const config = { boards: [{ rolle: "factory", repo: "b/board" }] };
  test("der Repo des Sync-Stands schlägt das Board, ohne Stand-Repo gilt das Board, sonst undefined", () => {
    assert.equal(seite.factoryRepoAus({ quelle: { repo: "s/stand" } }, () => config), "s/stand");
    assert.equal(seite.factoryRepoAus({ quelle: {} }, () => config), "b/board");
    assert.equal(seite.factoryRepoAus(null, () => ({})), undefined);
    assert.equal(seite.factoryRepoAus({ quelle: {} }, () => { throw new Error("keine Config"); }), undefined);
  });
});

// ── Läufe gegen Temp-Fixtures ─────────────────────────────────────────────────

const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "fslinks-"));
  temps.push(d);
  return d;
};
const schreibe = (w: string, rel: string, text: string): void => {
  const voll = join(w, ...rel.split("/"));
  mkdirSync(dirname(voll), { recursive: true });
  writeFileSync(voll, text);
};
const lies = (w: string, rel: string): string => readFileSync(join(w, ...rel.split("/")), "utf8");
/** Schnappschuss des ganzen Baums (Pfad → Text), `.git` ausgenommen. */
function baum(w: string, rel = ""): Record<string, string> {
  const aus: Record<string, string> = {};
  for (const e of readdirSync(join(w, rel), { withFileTypes: true })) {
    if (e.name === ".git") continue;
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) Object.assign(aus, baum(w, r));
    else aus[r] = readFileSync(join(w, r), "utf8");
  }
  return aus;
}
const KONFIG = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", "-c", "core.autocrlf=false"];
const git = (q: string, args: string[]): string => execFileSync("git", ["-C", q, ...KONFIG, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function taggen(q: string, tag: string): void {
  if (!existsSync(join(q, ".git"))) git(q, ["init", "-q"]);
  git(q, ["add", "-A"]);
  if (git(q, ["status", "--porcelain"]) !== "" || !existsSync(join(q, ".git", "refs", "heads"))) git(q, ["commit", "-q", "-m", "t"]);
  git(q, ["tag", "-f", tag]);
}
const commitVon = (q: string, tag: string): string => git(q, ["rev-parse", `${tag}^{commit}`]);
const stoppBlock = (inhalt: string): string => `${besitz.markerStart("stopps")}\n${inhalt}\n${besitz.markerEnde("stopps")}`;
const MANIFEST = {
  version: 1,
  eintraege: [
    ...Object.entries(pc.ROLLEN_PFADE).filter(([rolle]) => !pc.PROJEKT_ROLLEN.includes(rolle)).map(([, pfad]) => ({ pfad, ring: "kern", quelle: "t" })),
    { pfad: "AGENTS.md", block: "stopps", ring: "kern", quelle: "t" },
  ],
};
function baueQuelle(opt: { mitRepo?: boolean; stopp?: string; vorlagen?: Record<string, string>; besitzDateien?: Record<string, string>; manifestQuelle?: string } = {}): string {
  const q = tmp();
  const vorlagen = Object.keys(opt.vorlagen ?? {});
  const besitzDateien = Object.keys(opt.besitzDateien ?? {});
  const manifest = {
    version: vorlagen.length === 0 ? 1 : 2,
    eintraege: [
      ...MANIFEST.eintraege,
      ...besitzDateien.map((pfad) => ({ pfad, ring: "kern", quelle: opt.manifestQuelle ?? "t" })),
      ...vorlagen.map((pfad) => ({ pfad, ring: "kern", quelle: "t", art: "vorlage" })),
    ],
  };
  schreibe(q, ".factory/besitz.json", `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [pfad, text] of Object.entries({ ...opt.vorlagen, ...opt.besitzDateien })) schreibe(q, pfad, text);
  if (opt.mitRepo !== false) schreibe(q, ".factory/projekt.json", JSON.stringify({ repo: REPO }));
  schreibe(q, "AGENTS.md", `# Quelle\n\n${stoppBlock(opt.stopp ?? "neuer Stopp")}\n`);
  for (const e of MANIFEST.eintraege) if (e.pfad !== "AGENTS.md") schreibe(q, e.pfad, "rolle\n");
  return q;
}
function baueZiel(dateien: Record<string, string> = {}): string {
  const z = tmp();
  schreibe(z, ".factory/projekt.json", "{}");
  schreibe(z, "AGENTS.md", `# Projekt\n\n${stoppBlock("alter Stopp")}\n`);
  for (const [pfad, text] of Object.entries(dateien)) schreibe(z, pfad, text);
  return z;
}
function laufe(argv: string[]): { code: number; out: string; err: string } {
  const out: string[] = [];
  const err: string[] = [];
  const code = sync.cli(argv, { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
function syncVomTag(q: string, z: string, tag: string, extra: string[] = []): ReturnType<typeof laufe> {
  taggen(q, tag);
  return laufe(["--quelle", q, "--ziel", z, "--tag", tag, ...extra]);
}
const wachter = (z: string): { code: number; err: string } => {
  const err: string[] = [];
  return { code: waechter.cli([], { wurzel: z, out: () => {}, err: (s) => err.push(s) }), err: err.join("\n") };
};
const INDEX = ".factory/factory-links.json";

describe("factory-sync --tag: Link-Schritt", { timeout: 30_000 }, () => {
  test("AK1: Refs und Index werden mit dem Sync auf den neuen Tag gesetzt, danach ist das Link-Gate grün", () => {
    const q = baueQuelle();
    const z = baueZiel({ "docs/x.md": `Text\n[a](${u("v1", "AGENTS.md", "quelle")})\n` });
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "docs/x.md"), `Text\n[a](${u("v2", "AGENTS.md", "quelle")})\n`);
    assert.equal(lies(z, INDEX), `{\n  "repo": "o/f",\n  "tag": "v2",\n  "commit": "${commitVon(q, "v2")}",\n  "ziele": {\n    "AGENTS.md": ["quelle"]\n  }\n}\n`);
    assert.match(r.out, /Factory-Links: 1 Links auf 1 Ziele am Tag v2/);
    const g = wachter(z);
    assert.equal(g.code, 0, g.err);
  });

  test("AK2: Besitz-Block und Factory-Link außerhalb in derselben Datei werden einmal richtig geschrieben", () => {
    const q = baueQuelle({ stopp: "ein deutlich längerer neuer Stopp\nüber zwei Zeilen" });
    const z = baueZiel();
    schreibe(z, "AGENTS.md", `# Projekt\n\n${stoppBlock("alt")}\n\nSiehe [a](${u("v1", "AGENTS.md", "quelle")}).\n`);
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "AGENTS.md"), `# Projekt\n\n${stoppBlock("ein deutlich längerer neuer Stopp\nüber zwei Zeilen")}\n\nSiehe [a](${u("v2", "AGENTS.md", "quelle")}).\n`);
    assert.equal(r.out.split("\n").filter((z) => z === "geändert: AGENTS.md").length, 1);
  });

  test("AK2: eine vom Sync als unverändert gezählte Datei, die der Link-Schritt ändert, zählt als geändert", () => {
    const q = baueQuelle();
    const z = baueZiel();
    schreibe(z, "AGENTS.md", `# Projekt\n\n${stoppBlock("neuer Stopp")}\n\n[a](${u("v1", "AGENTS.md", "quelle")})\n`);
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    const zeilen = r.out.split("\n");
    assert.ok(zeilen.includes("geändert: AGENTS.md"));
    assert.match(r.out, /, 0 unverändert/);
    const gezaehlt = zeilen.filter((s) => /^(geändert|neu)/.test(s)).length;
    assert.ok(zeilen.includes(`factory-sync: ${gezaehlt} geändert, 0 unverändert`));
  });

  test("AK3: --trocken meldet und schreibt nichts, auch mit Link-Befund Exit 1", () => {
    const q = baueQuelle();
    const z = baueZiel({ "docs/x.md": `[a](${u("v1", "AGENTS.md", "quelle")})\n` });
    taggen(q, "v2");
    const vorher = baum(z);
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v2", "--trocken"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /würde geändert: docs\/x\.md/);
    assert.match(r.out, /würde neu: \.factory\/factory-links\.json/);
    assert.deepEqual(baum(z), vorher);
    const kaputt = baueZiel({ "docs/x.md": `[a](${u("v1", "AGENTS.md", "weg")})\n` });
    const vorherK = baum(kaputt);
    const rk = laufe(["--quelle", q, "--ziel", kaputt, "--tag", "v2", "--trocken"]);
    assert.equal(rk.code, 1);
    assert.match(rk.err, /docs\/x\.md:1: \[anker-tot\]/);
    assert.deepEqual(baum(kaputt), vorherK);
  });

  test("AK3: --entwurf macht keinen Link-Schritt und sagt das", () => {
    const q = baueQuelle();
    const text = `[a](${u("v1", "AGENTS.md", "quelle")})\n`;
    const z = baueZiel({ "docs/x.md": text });
    const r = laufe(["--quelle", q, "--ziel", z, "--entwurf"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Entwurf: kein Link-Schritt/);
    assert.equal(lies(z, "docs/x.md"), text);
    assert.equal(existsSync(join(z, INDEX)), false);
  });

  test("AK5: Link auf einen am Tag fehlenden Anker: Exit 1, Datei:Zeile, kein Byte im Ziel geändert", () => {
    const q = baueQuelle();
    const z = baueZiel({ "docs/x.md": `eins\n\n[a](${u("v1", "AGENTS.md", "gibt-es-nicht")})\n` });
    taggen(q, "v2");
    const vorher = baum(z);
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v2"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /docs\/x\.md:3: \[anker-tot\]/);
    assert.match(r.err, /nichts geschrieben/);
    assert.match(r.err, /Weg: den Link im Ziel korrigieren/);
    assert.doesNotMatch(r.err, /des Ziels anlegen/);
    assert.deepEqual(baum(z), vorher);
    assert.equal(existsSync(join(z, ".factory", "sync-stand.json")), false);
    assert.equal(existsSync(join(z, INDEX)), false);
  });

  test("ohne bestimmbares Factory-Repo: Hinweis, kein Link-Schritt, der Sync läuft", () => {
    const q = baueQuelle({ mitRepo: false });
    const text = `[a](${u("v1", "AGENTS.md", "quelle")})\n`;
    const z = baueZiel({ "docs/x.md": text });
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /kein Factory-Repo bestimmbar/);
    assert.equal(lies(z, "docs/x.md"), text);
    assert.equal(existsSync(join(z, INDEX)), false);
  });

  test("factoryLinks.ausnahmen der Ziel-Config nimmt Dateien aus, ein ungültiger Block ist ein Fehler ohne Schreiben", () => {
    const q = baueQuelle();
    const text = `[a](${u("v1", "AGENTS.md", "weg")})\n`;
    const z = baueZiel({ "docs/alt.md": text });
    schreibe(z, ".factory/projekt.json", JSON.stringify({ factoryLinks: { ausnahmen: ["docs/alt.md"] } }));
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "docs/alt.md"), text);
    const z2 = baueZiel({ "docs/alt.md": text });
    schreibe(z2, ".factory/projekt.json", JSON.stringify({ factoryLinks: { ausnahmen: 5 } }));
    const vorher = baum(z2);
    const r2 = laufe(["--quelle", q, "--ziel", z2, "--tag", "v2"]);
    assert.equal(r2.code, 1);
    assert.match(r2.err, /\[config\]/);
    assert.deepEqual(baum(z2), vorher);
  });

  test("eine neue Vorlage aus dem Sync-Plan mit Factory-Link wird umgestellt und indiziert, ein toter Anker darin bricht ab", () => {
    const q = baueQuelle({ vorlagen: { "docs/neu.md": `[a](${u("v1", "AGENTS.md", "quelle")})\n` } });
    const z = baueZiel();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "docs/neu.md"), `[a](${u("v2", "AGENTS.md", "quelle")})\n`);
    assert.ok(r.out.split("\n").includes("neu (Vorlage): docs/neu.md"));
    assert.match(lies(z, INDEX), /"AGENTS.md": \["quelle"\]/);
    assert.equal(wachter(z).code, 0);
    const q2 = baueQuelle({ vorlagen: { "docs/neu.md": `x\n[a](${u("v1", "AGENTS.md", "weg")})\n` } });
    const z2 = baueZiel();
    const vorher = baum(z2);
    taggen(q2, "v2");
    const r2 = laufe(["--quelle", q2, "--ziel", z2, "--tag", "v2"]);
    assert.equal(r2.code, 1);
    assert.match(r2.err, /docs\/neu\.md:2: \[anker-tot\]/);
    assert.deepEqual(baum(z2), vorher);
  });

  test("eine vorhandene Vorlage mit altem Ref wird vom Link-Schritt geändert und nicht als unverändert gezählt", () => {
    const q = baueQuelle({ vorlagen: { "docs/vorlage.md": "leer\n" } });
    const z = baueZiel({ "docs/vorlage.md": `[a](${u("v1", "AGENTS.md", "quelle")})\n` });
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    const zeilen = r.out.split("\n");
    assert.ok(zeilen.includes("geändert: docs/vorlage.md"));
    assert.equal(lies(z, "docs/vorlage.md"), `[a](${u("v2", "AGENTS.md", "quelle")})\n`);
    const gezaehlt = zeilen.filter((s) => /^(geändert|neu)/.test(s)).length;
    assert.ok(zeilen.includes(`factory-sync: ${gezaehlt} geändert, 0 unverändert`));
  });

  test("ein Factory-Link im Besitz-Block der Quelle bleibt unangetastet (Einheiten des neuen Sync-Stands), auch im Erst-Sync", () => {
    const link = `[a](${u("v1", "AGENTS.md", "weg")})`;
    const q = baueQuelle({ stopp: link });
    const z = baueZiel();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "AGENTS.md"), `# Projekt\n\n${stoppBlock(link)}\n`);
  });

  test("ohne Ziel-Config bricht der Sync bei bekanntem Factory-Repo mit [config] ab, nichts geschrieben", () => {
    const q = baueQuelle();
    const z = baueZiel();
    rmSync(join(z, ".factory", "projekt.json"));
    const vorher = baum(z);
    taggen(q, "v2");
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v2"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /\[config\]/);
    assert.match(r.err, /Weg: \.factory\/projekt\.json des Ziels anlegen/);
    assert.doesNotMatch(r.err, /den Link im Ziel korrigieren/);
    assert.deepEqual(baum(z), vorher);
  });

  test("eine geplante Nicht-Markdown-Datei (das Manifest) mit Factory-URL wird vom Link-Schritt nicht gelesen", () => {
    const link = `[a](${u("v1", "AGENTS.md", "weg")})`;
    const q = baueQuelle({ besitzDateien: { "scripts/x.mjs": "x\n" }, manifestQuelle: link });
    const z = baueZiel();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.ok(lies(z, ".factory/besitz.json").includes(link));
  });

  test("ein zweiter Sync auf denselben Tag ändert nichts mehr", () => {
    const q = baueQuelle();
    const z = baueZiel({ "docs/x.md": `[a](${u("v1", "AGENTS.md", "quelle")})\n` });
    assert.equal(syncVomTag(q, z, "v2").code, 0);
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /factory-sync: 0 geändert/);
  });
});

// ── Anker-Stubs anlegen (factory#167) ─────────────────────────────────────────

interface StubErgebnis { dateien: Map<string, string>; hinweise: string[]; ueberschriften: number; links: number }
const stubLib = rawLinks as unknown as {
  planeAnkerStubs(o: { lies: (p: string) => string | null; einheiten: string[]; repo: string; tag: string; leser: Leser; ausnahmen?: string[] }): StubErgebnis;
  stubBefunde(o: { lies: (p: string) => string | null; einheiten: string[]; repo: string; tag: string }): { befunde: { art: string }[]; geprueft: number };
};
const mdLib = rawMd as unknown as { linkStellen(md: string): unknown[]; collectHeadingSlugs(md: string): string[] };

describe("planeAnkerStubs (pur, factory#167)", () => {
  const EINHEIT = [".claude/agents/x.md"];
  /** Tag-Baum `seiten` (Pfad → Text); der Kern ist `.claude/agents/x.md` mit den übergebenen Links; `vorhanden` sind Seiten, die das Ziel schon hat. */
  function stubs(kern: string, seiten: Record<string, string>, vorhanden: Record<string, string> = {}, tag = "v2"): { r: StubErgebnis; lies: (p: string) => string | null } {
    const ziel: Record<string, string> = { ".claude/agents/x.md": kern, ...vorhanden };
    const lies = (p: string): string | null => ziel[p] ?? null;
    const leser: Leser = { pfade: Object.keys(seiten), lies: (p) => seiten[p] ?? null, vorladen: () => {} };
    return { r: stubLib.planeAnkerStubs({ lies, einheiten: EINHEIT, repo: REPO, tag, leser }), lies };
  }
  const SEITE = "# Titel `Code`\n\nIntro [x](rel.md)\n\n## Eins\n\ntext\n\n## Zwei [Link](rel.md)\n\n## Eins\n\ntext\n\n## Drei\n";
  const kern = (...a: string[]): string => a.map((x) => `[l](../../docs/s.md${x})`).join(" ") + "\n";
  const wirkt = (ergebnis: { r: StubErgebnis; lies: (p: string) => string | null }): { befunde: { art: string }[] } => {
    const lies = (p: string): string | null => ergebnis.r.dateien.get(p) ?? ergebnis.lies(p);
    return stubLib.stubBefunde({ lies, einheiten: EINHEIT, repo: REPO, tag: "v2" });
  };

  test("exakter Stub-Text: erste Überschrift mit Seitenlink, danach nur die verlinkten Überschriften mit ihrem Link (Rohwerte)", () => {
    const e = stubs(kern("#zwei-link", "#drei"), { "docs/s.md": SEITE });
    assert.equal(
      e.r.dateien.get("docs/s.md"),
      `# Titel Code\n\nAnker-Stub: Der Text dieser Seite steht im Factory-Repo; hier stehen nur die Überschriften, auf die der Kern verlinkt. Kern: [docs/s.md](${u("v2", "docs/s.md")})\n\n` +
        `## Zwei Link\n\nKern: [docs/s.md#zwei-link](${u("v2", "docs/s.md", "zwei-link")})\n\n## Drei\n\nKern: [docs/s.md#drei](${u("v2", "docs/s.md", "drei")})\n`,
    );
    assert.deepEqual([e.r.ueberschriften, e.r.links, e.r.hinweise], [3, 3, []]);
  });

  test("Eigenschaft: die erzeugten Stubs haben keinen Stub-Befund, jeder Kern-Link ist gedeckt", () => {
    const e = stubs(kern("", "#titel-code", "#zwei-link", "#eins-1", "#drei"), { "docs/s.md": SEITE });
    assert.deepEqual(wirkt(e).befunde, []);
  });

  test("Eigenschaft: der Stub trägt keine relativen Links und die Anker bleiben gleich (Link-Text und Backticks entfallen slug-neutral)", () => {
    const e = stubs(kern("#zwei-link", "#titel-code"), { "docs/s.md": SEITE });
    const text = e.r.dateien.get("docs/s.md") ?? "";
    assert.ok(!/rel\.md|`/.test(text));
    assert.ok(mdLib.collectHeadingSlugs(text).includes("zwei-link"));
    assert.ok(mdLib.collectHeadingSlugs(text).includes("titel-code"));
  });

  test("doppelte Überschrift: der Kern-Anker `eins-1` nimmt die frühere gleichnamige mit, damit der Slug im Stub gleich bleibt", () => {
    const e = stubs(kern("#eins-1"), { "docs/s.md": SEITE });
    const text = e.r.dateien.get("docs/s.md") ?? "";
    assert.deepEqual(mdLib.collectHeadingSlugs(text), ["titel-code", "eins", "eins-1"]);
    assert.deepEqual(wirkt(e).befunde, []);
  });

  test("AK3: eine Seite, die das Ziel schon hat (auch gekürzt ohne Überschriften), bekommt keinen Stub", () => {
    for (const vorhanden of ["Projektanteil\n", "# Gekürzt\n", ""]) {
      const e = stubs(kern("#zwei-link"), { "docs/s.md": SEITE }, { "docs/s.md": vorhanden });
      assert.equal(e.r.dateien.size, 0);
    }
  });

  test("ein Ziel mit eigener Einheit (Besitz) bekommt keinen Stub", () => {
    const lies = (p: string): string | null => (p === ".claude/agents/x.md" ? kern("#zwei-link") : null);
    const leser: Leser = { pfade: ["docs/s.md"], lies: () => SEITE, vorladen: () => {} };
    const r = stubLib.planeAnkerStubs({ lies, einheiten: [...EINHEIT, "docs/s.md"], repo: REPO, tag: "v2", leser });
    assert.equal(r.dateien.size, 0);
  });

  test("L30: ein Ziel, das eine Ausnahme-Glob trifft, bekommt keinen Stub, ein anderes schon", () => {
    const lies = (p: string): string | null => (p === ".claude/agents/x.md" ? kern("#zwei-link") + "[a](../../docs/t.md#drei)\n" : null);
    const leser: Leser = { pfade: ["docs/s.md", "docs/t.md"], lies: () => SEITE, vorladen: () => {} };
    const r = stubLib.planeAnkerStubs({ lies, einheiten: EINHEIT, repo: REPO, tag: "v2", leser, ausnahmen: ["docs/s.md"] });
    assert.deepEqual([...r.dateien.keys()], ["docs/t.md"]);
    assert.deepEqual([...stubLib.planeAnkerStubs({ lies, einheiten: EINHEIT, repo: REPO, tag: "v2", leser }).dateien.keys()], ["docs/s.md", "docs/t.md"]);
  });

  test("L30: Überschrift mit Link und Backticks: Stub-Text ohne Markup, gleicher Anker wie am Tag", () => {
    const seite = "# T\n\n## Der `code` [Link](rel.md) und *Stern*\n";
    const e = stubs(kern("#der-code-link-und-stern"), { "docs/s.md": seite });
    const text = e.r.dateien.get("docs/s.md") ?? "";
    assert.ok(text.includes("## Der code Link und Stern\n"));
    assert.deepEqual(mdLib.collectHeadingSlugs(text), ["t", "der-code-link-und-stern"]);
    assert.deepEqual(wirkt(e).befunde, []);
  });

  test("eine Pseudo-Überschrift im Codeblock zählt nicht", () => {
    const e = stubs(kern("#drei"), { "docs/s.md": "# T\n\n```\n## Drei\n```\n\n## Drei\n" });
    assert.deepEqual(mdLib.collectHeadingSlugs(e.r.dateien.get("docs/s.md") ?? ""), ["t", "drei"]);
  });

  test("fehlt ein Kern-Anker am Tag, steht ein Hinweis da und die Seite hat die übrigen Anker; ein Kern-Link ohne Anker gibt Titel, Absatz und Seitenlink", () => {
    const e = stubs(kern("#gibt-es-nicht", "#drei"), { "docs/s.md": SEITE });
    assert.deepEqual(e.r.hinweise, ["Anker-Stub: docs/s.md hat am Tag v2 keine Überschrift #gibt-es-nicht (check:factorylinks meldet stub-anker)"]);
    assert.ok(mdLib.collectHeadingSlugs(e.r.dateien.get("docs/s.md") ?? "").includes("drei"));
    const nur = stubs(kern(""), { "docs/s.md": SEITE });
    assert.equal(nur.r.dateien.get("docs/s.md")?.split("\n").filter((z) => z.startsWith("#")).join("|"), "# Titel Code");
    assert.deepEqual([nur.r.ueberschriften, nur.r.links, nur.r.hinweise], [1, 1, []]);
    assert.equal(mdLib.linkStellen(nur.r.dateien.get("docs/s.md") ?? "").length, 0);
    assert.equal((nur.r.dateien.get("docs/s.md") ?? "").split("](https://").length - 1, 1);
  });

  test("fehlt das Ziel am Tag, steht ein Hinweis da und es entsteht keine Datei", () => {
    const e = stubs(kern("#drei"), {});
    assert.equal(e.r.dateien.size, 0);
    assert.deepEqual(e.r.hinweise, ["Anker-Stub: docs/s.md gibt es am Tag v2 nicht, keine Stub-Seite (check:factorylinks meldet stub-ziel)"]);
  });

  test("Überschriften aller Ebenen bis 6 werden unverändert übernommen, Markup (** _) entfällt slug-neutral", () => {
    const seite = "# T\n\n### Tief\n\n###### Ganz **Fett** und_so\n";
    const e = stubs(kern("#tief", "#ganz-fett-undso"), { "docs/s.md": seite });
    const text = e.r.dateien.get("docs/s.md") ?? "";
    assert.match(text, /^### Tief$/m);
    assert.match(text, /^###### Ganz Fett undso$/m);
    assert.deepEqual(wirkt(e).befunde, []);
  });

  test("der Kern verlinkt die erste von zwei gleichnamigen Überschriften: die spätere kommt nicht in den Stub; verlinkt er die zweite, bekommt die frühere ihren eigenen Link", () => {
    const erste = stubs(kern("#eins"), { "docs/s.md": SEITE });
    assert.deepEqual(mdLib.collectHeadingSlugs(erste.r.dateien.get("docs/s.md") ?? ""), ["titel-code", "eins"]);
    const zweite = stubs(kern("#eins-1"), { "docs/s.md": SEITE });
    assert.deepEqual([zweite.r.ueberschriften, zweite.r.links], [3, 3]);
    assert.ok((zweite.r.dateien.get("docs/s.md") ?? "").includes(`Kern: [docs/s.md#eins](${u("v2", "docs/s.md", "eins")})`));
  });

  test("eine Seite ohne Ebene-1-Überschrift beginnt mit dem Absatz", () => {
    const e = stubs(kern("#drei"), { "docs/s.md": "## Drei\n" });
    assert.match(e.r.dateien.get("docs/s.md") ?? "", /^Anker-Stub: .*\n\n## Drei\n\nKern: \[docs\/s\.md#drei\]/);
    assert.deepEqual(wirkt(e).befunde, []);
  });
});

describe("factory-sync --tag: Anker-Stubs beim ersten Sync (factory#167)", { timeout: 30_000 }, () => {
  const SEITE_E2E = "# Seite\n\n## Erster\n\ntext\n\n## Zweiter Abschnitt\n\ntext\n";
  const quelleMitSeiten = (): string => {
    const q = baueQuelle({ stopp: "Siehe [a](docs/seite.md#zweiter-abschnitt) hier.", besitzDateien: { ".claude/agents/x.md": "[c](../../docs/seite.md#erster) [d](../../docs/ohne.md)\n" } });
    schreibe(q, "docs/seite.md", SEITE_E2E);
    schreibe(q, "docs/ohne.md", "# Ohne Anker\n\ntext\n");
    return q;
  };
  const zielMitPackage = (dateien: Record<string, string> = {}): string => baueZiel({ "package.json": JSON.stringify({ scripts: {} }), ...dateien });
  const audit = (z: string): Record<string, unknown[]> => (rawDocdrift as unknown as { auditDocDrift(r: string): Record<string, unknown[]> }).auditDocDrift(z);
  const STUB_ZEILE = /^neu \(Anker-Stub\): docs\/(seite|ohne)\.md$/;

  test("AK1+AK2: ein leeres Ziel bekommt beide Stub-Seiten, danach sind Link-Wächter und docdrift ohne Handarbeit grün", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(r.out.split("\n").filter((s) => STUB_ZEILE.test(s)).length, 2);
    assert.match(r.out, /Anker-Stubs: 2 Seiten angelegt, 4 Überschriften, 4 Links am Tag v2/);
    assert.equal(
      lies(z, "docs/ohne.md"),
      `# Ohne Anker\n\nAnker-Stub: Der Text dieser Seite steht im Factory-Repo; hier stehen nur die Überschriften, auf die der Kern verlinkt. Kern: [docs/ohne.md](${u("v2", "docs/ohne.md")})\n`,
    );
    const index = JSON.parse(lies(z, INDEX)) as { ziele: Record<string, string[]> };
    assert.deepEqual(index.ziele["docs/seite.md"], ["", "erster", "zweiter-abschnitt"]);
    assert.deepEqual(index.ziele["docs/ohne.md"], [""]);
    const g = wachter(z);
    assert.equal(g.code, 0, g.err);
    const a = audit(z);
    for (const [k, v] of Object.entries(a)) if (Array.isArray(v) && k !== "mdFiles" && k !== "scripts") assert.deepEqual(v, [], k);
  });

  test("AK3: eine vorhandene (gekürzte, CRLF) Seite bleibt byte-gleich; nur die fehlende wird angelegt, der Wächter meldet die gekürzte", () => {
    const q = quelleMitSeiten();
    const gekuerzt = "# Projektanteil\r\n\r\nnur unser Teil\r\n";
    const z = zielMitPackage({ "docs/seite.md": gekuerzt });
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "docs/seite.md"), gekuerzt);
    assert.deepEqual(r.out.split("\n").filter((s) => STUB_ZEILE.test(s)), ["neu (Anker-Stub): docs/ohne.md"]);
    assert.match(r.out, /Anker-Stubs: 1 Seiten angelegt, 1 Überschriften, 1 Links/);
    assert.match(wachter(z).err, /stub-anker|stub-link/);
  });

  test("L30: eine Seite in factoryLinks.ausnahmen der Ziel-Config bekommt keinen Stub, die andere schon", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    schreibe(z, ".factory/projekt.json", JSON.stringify({ factoryLinks: { ausnahmen: ["docs/ohne.md"] } }));
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.split("\n").filter((s) => STUB_ZEILE.test(s)), ["neu (Anker-Stub): docs/seite.md"]);
    assert.equal(existsSync(join(z, "docs/ohne.md")), false);
  });

  test("--trocken meldet die Stubs und schreibt nichts", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    taggen(q, "v2");
    const vorher = baum(z);
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v2", "--trocken"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /würde neu \(Anker-Stub\): docs\/seite\.md/);
    assert.deepEqual(baum(z), vorher);
  });

  test("ein zweiter Sync am selben Tag ändert nichts", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    assert.equal(syncVomTag(q, z, "v2").code, 0);
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v2"]);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /factory-sync: 0 geändert/);
    assert.ok(!/Anker-Stub\)/.test(r.out));
    assert.ok(!/^Hinweis: Anker-Stubs:/m.test(r.out));
  });

  test("ein Sync auf einen anderen Tag lässt die Stub-Links auf den neuen Tag zeigen, beide Prüfungen bleiben grün", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    assert.equal(syncVomTag(q, z, "v2").code, 0);
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err);
    assert.match(lies(z, "docs/ohne.md"), /blob\/v3\/docs\/ohne\.md/);
    assert.ok(!/blob\/v2\//.test(lies(z, "docs/seite.md")));
    assert.equal(wachter(z).code, 0);
  });

  test("ein Link-Befund in einer anderen Datei lässt Exit 1 und keine Stub-Datei schreiben", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage({ "docs/x.md": `[a](${u("v1", "AGENTS.md", "gibt-es-nicht")})\n` });
    taggen(q, "v2");
    const vorher = baum(z);
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v2"]);
    assert.equal(r.code, 1);
    assert.deepEqual(baum(z), vorher);
  });

  test("--entwurf legt keine Stubs an", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    const r = laufe(["--quelle", q, "--ziel", z, "--entwurf"]);
    assert.equal(r.code, 0, r.err);
    assert.ok(!/Anker-Stub\)/.test(r.out));
    assert.ok(!/^Hinweis: Anker-Stubs:/m.test(r.out));
    assert.equal(existsSync(join(z, "docs", "seite.md")), false);
  });

  test("ein Kern-Link auf eine Seite und einen Anker, die es am Tag nicht gibt: die Hinweise stehen in der Ausgabe, die übrigen Stubs entstehen", () => {
    const q = baueQuelle({ stopp: "Siehe [a](docs/seite.md#gibt-es-nicht) und [b](docs/weg.md#x).", besitzDateien: { ".claude/agents/x.md": "[c](../../docs/seite.md#erster)\n" } });
    schreibe(q, "docs/seite.md", SEITE_E2E);
    const z = zielMitPackage();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^Hinweis: Anker-Stub: docs\/seite\.md hat am Tag v2 keine Überschrift #gibt-es-nicht /m);
    assert.match(r.out, /^Hinweis: Anker-Stub: docs\/weg\.md gibt es am Tag v2 nicht, keine Stub-Seite /m);
    assert.equal(existsSync(join(z, "docs", "weg.md")), false);
    assert.equal(existsSync(join(z, "docs", "seite.md")), true);
  });

  test("AK3: eine Seite, die derselbe Sync als Vorlage neu anlegt, wird nie vom Stub überschrieben", () => {
    const q = baueQuelle({ stopp: "Siehe [a](docs/neu.md#x).", vorlagen: { "docs/neu.md": "# Neu\n\n## X\n\nVorlagentext\n" } });
    const z = zielMitPackage();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^neu \(Vorlage\): docs\/neu\.md$/m);
    assert.ok(!/^neu \(Anker-Stub\): docs\/neu\.md$/m.test(r.out));
    assert.match(lies(z, "docs/neu.md"), /Vorlagentext/);
  });

  test("AK3: ein Ordner auf dem Seitenpfad (nicht lesbar als Text, aber da) bekommt keinen Stub", () => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    mkdirSync(join(z, "docs", "seite.md"), { recursive: true });
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.out.split("\n").filter((s) => STUB_ZEILE.test(s)), ["neu (Anker-Stub): docs/ohne.md"]);
  });

  test("AK3: ein Symlink (auch hängend) auf dem Seitenpfad gilt als vorhandene Seite, es wird nie darüber geschrieben", (ctx) => {
    const q = quelleMitSeiten();
    const z = zielMitPackage();
    const ausserhalb = tmp();
    const ziel = join(ausserhalb, "fremd.md");
    try {
      mkdirSync(join(z, "docs"), { recursive: true });
      symlinkSync(ziel, join(z, "docs", "seite.md"));
    } catch {
      ctx.skip();
      return;
    }
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.equal(existsSync(ziel), false);
    assert.ok(lstatSync(join(z, "docs", "seite.md")).isSymbolicLink());
    assert.deepEqual(r.out.split("\n").filter((s) => STUB_ZEILE.test(s)), ["neu (Anker-Stub): docs/ohne.md"]);
  });
});

const reinLib = rawLinks as unknown as {
  istReinerStub(text: string): boolean;
  planeAnkerStubs(o: { lies: (p: string) => string | null; einheiten: string[]; repo: string; tag: string; leser: Leser; ausnahmen?: string[]; reineStubs?: string[] }): StubErgebnis & { erneuert: Set<string> };
};

describe("istReinerStub und planeAnkerStubs mit reineStubs (pur, factory#166)", () => {
  const EINHEIT = [".claude/agents/x.md"];
  const HINWEIS = "Anker-Stub: Der Text dieser Seite steht im Factory-Repo;";
  const erneuere = (kern: string, seite: string, tag = "v3", reine = ["docs/s.md"], ausnahmen: string[] = []) => {
    const lies = (p: string): string | null => (p === ".claude/agents/x.md" ? kern : null);
    const leser: Leser = { pfade: ["docs/s.md"], lies: () => seite, vorladen: () => {} };
    return reinLib.planeAnkerStubs({ lies, einheiten: EINHEIT, repo: REPO, tag, leser, reineStubs: reine, ausnahmen });
  };
  const SEITE = "# Titel\n\n## Eins\n\ntext\n\n#### Tief\n\n## Eins\n\n## Zwei\n";
  const kern = (...a: string[]): string => a.map((x) => `[l](../../docs/s.md${x})`).join(" ") + "\n";

  test("Eigenschaft: jede von planeAnkerStubs erzeugte Stub-Seite ist ein reiner Stub (CRLF, ohne H1, Ebenen bis 6, -1-Suffix)", () => {
    const seiten = [SEITE, "## Ohne H1\n\n###### Sechs\n", "# Nur Titel\n"];
    for (const seite of seiten) {
      for (const k of [kern(""), kern("#eins-1", "#tief", "#zwei"), kern("#sechs", "#ohne-h1")]) {
        const text = erneuere(k, seite, "v2", []).dateien.get("docs/s.md");
        const e = erneuere(k, seite, "v2", ["docs/s.md"]).dateien.get("docs/s.md");
        for (const t of [text, e]) if (t !== undefined) {
          assert.ok(reinLib.istReinerStub(t), t);
          assert.ok(reinLib.istReinerStub(t.replace(/\n/g, "\r\n")));
        }
      }
    }
  });

  test("Negativ: Projektzeile, zusätzliche Überschrift ohne Kern-Zeile, ohne Hinweis, zwei Hinweise, leerer Text sind keine reinen Stubs", () => {
    const k = `Kern: [docs/s.md](${u("v2", "docs/s.md")})`;
    const gut = `# T\n\n${HINWEIS} hier. ${k}\n\n## Eins\n\n${k}\n`;
    assert.ok(reinLib.istReinerStub(gut));
    assert.ok(!reinLib.istReinerStub(`${gut}\nunsere Zeile\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\n## Zwei\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\n## Zwei\n\nProjekt\n\n${k}\n`));
    assert.ok(!reinLib.istReinerStub(`# T\n\n## Eins\n\n${k}\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\n${HINWEIS} noch einmal\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\nKern: [x](http://unsicher)\n`));
    assert.ok(!reinLib.istReinerStub(""));
  });

  test("Negativ: Text vor oder hinter einer Kern-Zeile, eine zweite eigene Ebene-1-Überschrift und eine Überschrift der Ebene 7 sind keine reinen Stubs", () => {
    const k = `Kern: [docs/s.md](${u("v2", "docs/s.md")})`;
    const gut = `# T\n\n${HINWEIS} hier. ${k}\n\n## Eins\n\n${k}\n`;
    assert.ok(reinLib.istReinerStub(gut));
    assert.ok(!reinLib.istReinerStub(`${gut}\nunsere Notiz ${k}\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\n${k} und unser Zusatz\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\n# Unser Kapitel\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\n####### Sieben\n\n${k}\n`));
    assert.ok(reinLib.istReinerStub(`${gut}\n###### Sechs\n\n${k}\n`));
  });

  test("Negativ: eingerückte Zeile, erste Überschrift ohne Ebene 1 ohne Kern-Zeile und zwei Links in einer Kern-Zeile sind keine reinen Stubs", () => {
    const k = `Kern: [docs/s.md](${u("v2", "docs/s.md")})`;
    const gut = `# T\n\n${HINWEIS} hier. ${k}\n\n## Eins\n\n${k}\n`;
    assert.ok(!reinLib.istReinerStub(`${gut}\n eingerückte Notiz\n\n${k}\n`));
    const ohneH1 = `${HINWEIS} hier. ${k}\n\n## Unser Abschnitt\n\n## Eins\n\n${k}\n`;
    assert.ok(!reinLib.istReinerStub(ohneH1));
    assert.ok(reinLib.istReinerStub(`${HINWEIS} hier. ${k}\n\n## Eins\n\n${k}\n`));
    assert.ok(!reinLib.istReinerStub(`${gut}\nKern: [a](https://x.example) unser Zusatz [b](https://y.example)\n`));
  });

  test("angelegt und erneuert zugleich: ueberschriften und links zählen nur die angelegten Seiten", () => {
    const lies = (p: string): string | null => (p === ".claude/agents/x.md" ? "[a](../../docs/s.md#eins) [b](../../docs/neu.md#abschnitt)\n" : null);
    const seiten: Record<string, string> = { "docs/s.md": "# Titel\n\n## Eins\n", "docs/neu.md": "# Neu\n\n## Abschnitt\n" };
    const leser: Leser = { pfade: Object.keys(seiten), lies: (p) => seiten[p] ?? null, vorladen: () => {} };
    const e = reinLib.planeAnkerStubs({ lies, einheiten: EINHEIT, repo: REPO, tag: "v3", leser, reineStubs: ["docs/s.md"] });
    assert.deepEqual([...e.dateien.keys()], ["docs/neu.md", "docs/s.md"]);
    assert.deepEqual([...e.erneuert], ["docs/s.md"]);
    assert.equal(e.ueberschriften, 2);
    assert.equal(e.links, 2);
  });

  test("Umbenennung: der erneuerte Stub hat den neuen Anker und nicht mehr den alten; ohne reineStubs bleibt es beim alten Verhalten", () => {
    const e = erneuere(kern("#zwei-neu"), "# Titel\n\n## Zwei neu\n");
    const text = e.dateien.get("docs/s.md") ?? "";
    assert.deepEqual(mdLib.collectHeadingSlugs(text), ["titel", "zwei-neu"]);
    assert.deepEqual([...e.erneuert], ["docs/s.md"]);
    const ohne = reinLib.planeAnkerStubs({ lies: (p) => (p === ".claude/agents/x.md" ? kern("#zwei-neu") : "# Alt\n"), einheiten: EINHEIT, repo: REPO, tag: "v3", leser: { pfade: ["docs/s.md"], lies: () => SEITE, vorladen: () => {} } });
    assert.equal(ohne.dateien.size, 0);
  });

  test("reiner Stub ohne Kern-Link: nur erste Überschrift und Hinweis; ausnahmen-Treffer bleibt unberührt; ein Ziel ohne Seite am Tag gibt einen Hinweis", () => {
    const min = erneuere("kein Link\n", SEITE);
    assert.equal(min.dateien.get("docs/s.md"), `# Titel\n\n${HINWEIS} hier stehen nur die Überschriften, auf die der Kern verlinkt. Kern: [docs/s.md](${u("v3", "docs/s.md")})\n`);
    assert.equal(erneuere(kern("#zwei"), SEITE, "v3", ["docs/s.md"], ["docs/s.md"]).dateien.size, 0);
    const lies = (p: string): string | null => (p === ".claude/agents/x.md" ? "kein Link\n" : null);
    const weg = reinLib.planeAnkerStubs({ lies, einheiten: EINHEIT, repo: REPO, tag: "v3", leser: { pfade: [], lies: () => null, vorladen: () => {} }, reineStubs: ["docs/s.md"] });
    assert.equal(weg.dateien.size, 0);
    assert.equal(weg.hinweise.length, 1);
  });
});

describe("factory-sync --tag: reine Stubs erneuern (factory#166)", { timeout: 30_000 }, () => {
  const quelleV2 = (): string => {
    const q = baueQuelle({ stopp: "Siehe [a](docs/seite.md#zweiter-abschnitt) hier.", besitzDateien: { ".claude/agents/x.md": "[c](../../docs/seite.md#erster) [d](../../docs/ohne.md)\n" } });
    schreibe(q, "docs/seite.md", "# Seite\n\n## Erster\n\ntext\n\n## Zweiter Abschnitt\n\ntext\n");
    schreibe(q, "docs/ohne.md", "# Ohne Anker\n\ntext\n");
    return q;
  };
  const zielV2 = (q: string, dateien: Record<string, string> = {}): string => {
    const z = baueZiel({ "package.json": JSON.stringify({ scripts: {} }), ...dateien });
    assert.equal(syncVomTag(q, z, "v2").code, 0);
    return z;
  };
  const umbenennen = (q: string): void => {
    schreibe(q, "AGENTS.md", `# Quelle\n\n${stoppBlock("Siehe [a](docs/seite.md#zweiter-teil) hier.")}\n`);
    schreibe(q, "docs/seite.md", "# Seite\n\n## Erster\n\ntext\n\n## Zweiter Teil\n\ntext\n");
  };
  const audit = (z: string): Record<string, unknown[]> => (rawDocdrift as unknown as { auditDocDrift(r: string): Record<string, unknown[]> }).auditDocDrift(z);
  const PROJEKTZEILE = "\n\nunsere Projektzeile\n";

  test("Umbenennung am Kern-Anker: der reine Stub wird erneuert, Wächter und docdrift bleiben ohne Handarbeit grün", () => {
    const q = quelleV2();
    const z = zielV2(q);
    umbenennen(q);
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err);
    assert.ok(r.out.split("\n").includes("geändert (Anker-Stub): docs/seite.md"), r.out);
    assert.match(r.out, /Anker-Stubs: 2 Seiten erneuert am Tag v3/);
    assert.match(lies(z, "docs/seite.md"), /## Zweiter Teil\n\nKern: \[docs\/seite\.md#zweiter-teil\]\(.*blob\/v3\/docs\/seite\.md#zweiter-teil\)/);
    const g = wachter(z);
    assert.equal(g.code, 0, g.err);
    assert.deepEqual(audit(z).deadAnchors, []);
  });

  test("neuer Kern-Anker auf einer reinen Stub-Seite: der Stub wird ergänzt, der Wächter ist grün", () => {
    const q = quelleV2();
    const z = zielV2(q);
    schreibe(q, ".claude/agents/x.md", "[c](../../docs/seite.md#erster) [d](../../docs/ohne.md#abschnitt)\n");
    schreibe(q, "docs/ohne.md", "# Ohne Anker\n\n## Abschnitt\n\ntext\n");
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err);
    assert.match(lies(z, "docs/ohne.md"), /## Abschnitt\n\nKern: \[docs\/ohne\.md#abschnitt\]/);
    assert.equal(wachter(z).code, 0);
  });

  test("AK3: Stub-Seite mit Projektzeile bleibt byte-gleich; mit Umbenennung bricht der Sync laut ab (anker-tot), nichts geschrieben", () => {
    const q = quelleV2();
    const z = zielV2(q);
    schreibe(z, "docs/seite.md", lies(z, "docs/seite.md") + PROJEKTZEILE);
    umbenennen(q);
    const vorher = baum(z);
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 1);
    assert.match(r.err, /anker-tot/);
    assert.deepEqual(baum(z), vorher);
  });

  test("AK3: Stub-Seite mit Projektzeile und nur neuem Kern-Anker: Seite byte-gleich, der Wächter meldet stub-anker", () => {
    const q = quelleV2();
    const z = zielV2(q);
    schreibe(z, "docs/ohne.md", lies(z, "docs/ohne.md") + PROJEKTZEILE);
    const seite = lies(z, "docs/ohne.md");
    schreibe(q, ".claude/agents/x.md", "[c](../../docs/seite.md#erster) [d](../../docs/ohne.md#abschnitt)\n");
    schreibe(q, "docs/ohne.md", "# Ohne Anker\n\n## Abschnitt\n\ntext\n");
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "docs/ohne.md"), seite.replace("blob/v2/", "blob/v3/")); // nur der Ref, den der Sync je Tag setzt
    const g = wachter(z);
    assert.equal(g.code, 1);
    assert.match(g.err, /stub-anker/);
  });

  test("auf den Projektanteil gekürzte Seite (mit Überschrift, ohne Hinweis) wird nie überschrieben", () => {
    const q = quelleV2();
    const z = zielV2(q);
    schreibe(z, "docs/seite.md", "# Seite\n\n## Erster\n\nnur unser Teil\n");
    const seite = lies(z, "docs/seite.md");
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "docs/seite.md"), seite);
    assert.ok(!r.out.includes("geändert (Anker-Stub): docs/seite.md"));
  });

  test("neue Stub-Seite neben einem erneuerten reinen Stub: der Hinweis nennt für die angelegten nur ihre Zahlen", () => {
    const q = quelleV2();
    const z = zielV2(q);
    schreibe(q, ".claude/agents/x.md", "[c](../../docs/seite.md#erster) [d](../../docs/ohne.md) [e](../../docs/neu.md#abschnitt)\n");
    schreibe(q, "docs/neu.md", "# Neu\n\n## Abschnitt\n\ntext\n");
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Anker-Stubs: 1 Seiten angelegt, 2 Überschriften, 2 Links am Tag v3/);
    assert.match(r.out, /Anker-Stubs: 2 Seiten erneuert am Tag v3/);
  });

  test("AK3: eine Besitz-Einheit in der Form eines Stubs wird nie erneuert", () => {
    const stubForm = `# B\n\nAnker-Stub: Der Text dieser Seite steht im Factory-Repo; Besitztext. Kern: [docs/b.md](${u("v2", "docs/b.md")})\n`;
    const q = baueQuelle({ stopp: "Siehe [a](docs/seite.md#erster) hier.", besitzDateien: { "docs/b.md": stubForm } });
    schreibe(q, "docs/seite.md", "# Seite\n\n## Erster\n\ntext\n");
    const z = zielV2(q);
    assert.equal(lies(z, "docs/b.md"), stubForm);
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err);
    assert.equal(lies(z, "docs/b.md"), stubForm);
    assert.ok(!r.out.includes("docs/b.md"), r.out);
  });

  test("ein zweiter Sync am selben Tag erneuert nichts, auch nicht bei CRLF-Zeilenenden des Stubs", () => {
    const q = quelleV2();
    const z = zielV2(q);
    const crlf = lies(z, "docs/seite.md").replace(/\n/g, "\r\n");
    schreibe(z, "docs/seite.md", crlf);
    const r = laufe(["--quelle", q, "--ziel", z, "--tag", "v2"]);
    assert.equal(r.code, 0, r.err);
    assert.ok(!/Anker-Stub\)/.test(r.out));
    assert.equal(lies(z, "docs/seite.md"), crlf);
  });

  test("ein CRLF-Stub wird im CRLF-Stil erneuert", () => {
    const q = quelleV2();
    const z = zielV2(q);
    schreibe(z, "docs/seite.md", lies(z, "docs/seite.md").replace(/\n/g, "\r\n"));
    umbenennen(q);
    assert.equal(syncVomTag(q, z, "v3").code, 0);
    const t = lies(z, "docs/seite.md");
    assert.ok(t.includes("## Zweiter Teil\r\n") && !/[^\r]\n/.test(t));
  });

  test("ein Symlink auf dem Seitenpfad wird nie erneuert", (ctx) => {
    const q = quelleV2();
    const z = zielV2(q);
    const stub = lies(z, "docs/seite.md");
    const fremd = join(tmp(), "fremd.md");
    writeFileSync(fremd, stub);
    try {
      rmSync(join(z, "docs", "seite.md"));
      symlinkSync(fremd, join(z, "docs", "seite.md"));
    } catch {
      ctx.skip();
      return;
    }
    umbenennen(q);
    const r = syncVomTag(q, z, "v3");
    assert.equal(r.code, 0, r.err); // ein Symlink wird nicht gelesen (collectMarkdown), also kein anker-tot und nichts darüber geschrieben
    assert.ok(!r.out.includes("(Anker-Stub): docs/seite.md"), r.out);
    assert.equal(readFileSync(fremd, "utf8"), stub);
    assert.ok(lstatSync(join(z, "docs", "seite.md")).isSymbolicLink());
  });
});

describe("factory-sync --tag: Hinweise nach dem Sync (Projektseiten, eslint-Suppressions, zweiter Lauf)", { timeout: 60_000 }, () => {
  type CliOpt = { out: (s: string) => void; err: (s: string) => void; zweitlauf?: ((argv: string[]) => number) | null; env?: Record<string, string> };
  const SEITE = "# Seite\n\n## Erster\n\ntext\n";
  const kernQuelle = (): string => {
    const q = baueQuelle({ stopp: "Siehe [a](docs/seite.md#erster) hier." });
    schreibe(q, "docs/seite.md", SEITE);
    return q;
  };
  const skriptQuelle = (): string => baueQuelle({ besitzDateien: { "scripts/x.mjs": "export const a = 1;\n" } });
  function lauf(argv: string[], opt: { zweitlauf?: ((argv: string[]) => number) | null; env?: Record<string, string> } = {}): { code: number; out: string; err: string } {
    const out: string[] = [];
    const err: string[] = [];
    const cliMit = (a: string[], o: CliOpt): number => sync.cli(a, o);
    const code = cliMit(argv, { out: (s) => out.push(s), err: (s) => err.push(s), ...opt });
    return { code, out: out.join("\n"), err: err.join("\n") };
  }

  test("L11/L20: eine vorhandene Projektseite ohne Factory-Link unter der Überschrift (stub-link) steht als Hinweis mit Seite und Soll-Zeile, Exit 0, Seite unverändert", () => {
    const q = kernQuelle();
    const z = baueZiel({ "docs/seite.md": SEITE });
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^Hinweis: Kern-Link-Seite im Projekt: docs\/seite\.md:3: \[stub-link\] .*Soll: `Kern: \[\.\.\]\(https:\/\/github\.com\/o\/f\/blob\/v2\/docs\/seite\.md#erster\)`$/m);
    assert.equal(lies(z, "docs/seite.md"), SEITE);
  });

  test("L11/L20: eine gekürzte Seite ohne die verlinkte Überschrift (stub-anker) steht ebenso als Hinweis", () => {
    const q = kernQuelle();
    const z = baueZiel({ "docs/seite.md": "# Projektanteil\n" });
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^Hinweis: Kern-Link-Seite im Projekt: AGENTS\.md:\d+: \[stub-anker\] .*in docs\/seite\.md .*Soll: `Kern: \[\.\.\]\(/m);
  });

  test("L11/L20: eine vom Sync angelegte Stub-Seite und eine fehlende Seite (Ausnahme) lösen keinen Hinweis aus", () => {
    const q = kernQuelle();
    const z = baueZiel();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.ok(!/Kern-Link-Seite im Projekt/.test(r.out), r.out);
    const z2 = baueZiel();
    schreibe(z2, ".factory/projekt.json", JSON.stringify({ factoryLinks: { ausnahmen: ["docs/seite.md"] } }));
    assert.ok(!/Kern-Link-Seite im Projekt/.test(syncVomTag(q, z2, "v3").out));
  });

  test("L21c: hat der Sync ein Skript geändert, steht der Hinweis auf eslint-suppressions.json; ohne Skript-Änderung fehlt er; die Datei schreibt der Sync nicht", () => {
    const q = skriptQuelle();
    const z = baueZiel();
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /^Hinweis: eslint-suppressions\.json \(Projektdatei\): veraltete Einträge mit `npx eslint \. --prune-suppressions` entfernen$/m);
    assert.equal(existsSync(join(z, "eslint-suppressions.json")), false);
    const nochmal = laufe(["--quelle", q, "--ziel", z, "--tag", "v2"]);
    assert.ok(!/prune-suppressions/.test(nochmal.out), nochmal.out);
    const ohne = syncVomTag(baueQuelle(), baueZiel(), "v2");
    assert.ok(!/prune-suppressions/.test(ohne.out), ohne.out);
  });

  test("L21c: auch .ts und .js lösen den Hinweis aus, andere Endungen nicht", () => {
    const mit = (datei: string): string => syncVomTag(baueQuelle({ besitzDateien: { [datei]: "x\n" } }), baueZiel(), "v2").out;
    assert.match(mit("src/a.ts"), /prune-suppressions/);
    assert.match(mit("src/b.js"), /prune-suppressions/);
    assert.ok(!/prune-suppressions/.test(mit("src/c.json")));
  });

  test("L19: hat der Sync eine Datei unter scripts/ geschrieben, startet er einmal neu mit denselben Argumenten; ein Riegel verhindert den dritten Lauf", () => {
    const q = skriptQuelle();
    const z = baueZiel();
    taggen(q, "v2");
    const argv = ["--quelle", q, "--ziel", z, "--tag", "v2"];
    const aufrufe: string[][] = [];
    const r = lauf(argv, { zweitlauf: (a) => (aufrufe.push(a), 0), env: {} });
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(aufrufe, [argv]);
    assert.match(r.out, /^Sync-Werkzeug aktualisiert: zweiter Lauf mit dem neuen Stand$/m);
    const zweiter: string[][] = [];
    const q2 = skriptQuelle();
    const z2 = baueZiel();
    taggen(q2, "v2");
    lauf(["--quelle", q2, "--ziel", z2, "--tag", "v2"], { zweitlauf: (a) => (zweiter.push(a), 0), env: { FACTORY_SYNC_ZWEITLAUF: "1" } });
    assert.deepEqual(zweiter, []);
  });

  test("L19: der Exit-Code des zweiten Laufs ist der Exit-Code; ohne Skript-Datei, bei --trocken und ohne Injektion läuft kein zweiter Lauf", () => {
    const q = skriptQuelle();
    const z = baueZiel();
    taggen(q, "v2");
    assert.equal(lauf(["--quelle", q, "--ziel", z, "--tag", "v2"], { zweitlauf: () => 1, env: {} }).code, 1);
    const n: number[] = [];
    const zaehle = (): number => (n.push(1), 0);
    const q3 = skriptQuelle();
    taggen(q3, "v2");
    lauf(["--quelle", q3, "--ziel", baueZiel(), "--tag", "v2", "--trocken"], { zweitlauf: zaehle, env: {} });
    const q4 = baueQuelle();
    taggen(q4, "v2");
    lauf(["--quelle", q4, "--ziel", baueZiel(), "--tag", "v2"], { zweitlauf: zaehle, env: {} });
    assert.deepEqual(n, []);
    const q5 = skriptQuelle();
    taggen(q5, "v2");
    assert.equal(lauf(["--quelle", q5, "--ziel", baueZiel(), "--tag", "v2"], { env: {} }).code, 0);
  });

  test("L19 (echter Prozess): `node scripts/factory-sync.mjs` startet nach einem Skript-Update einen zweiten Prozess, der den neuen Stand nur bestätigt", () => {
    const q = skriptQuelle();
    const z = baueZiel();
    taggen(q, "v2");
    const skript = fileURLToPath(new URL("../scripts/factory-sync.mjs", import.meta.url));
    const aus = execFileSync(process.execPath, [skript, "--quelle", q, "--ziel", z, "--tag", "v2"], { encoding: "utf8", env: { ...process.env, FACTORY_SYNC_ZWEITLAUF: "" } });
    assert.match(aus, /Sync-Werkzeug aktualisiert: zweiter Lauf mit dem neuen Stand/);
    assert.equal((aus.match(/^factory-sync: \d+ geändert, \d+ unverändert$/gm) ?? []).length, 2, aus);
    assert.match(aus, /factory-sync: 0 geändert/);
    assert.ok(existsSync(join(z, "scripts", "x.mjs")));
  });
});
