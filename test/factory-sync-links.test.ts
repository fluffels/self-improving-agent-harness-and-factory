/* Link-Schritt im Sync (factory#131, Teil 2 von factory#93): `factory-sync --tag` stellt die Factory-Links des Ziels im selben atomaren Lauf auf den Tag um
 * und schreibt `.factory/factory-links.json`. Pure Tests des Link-Plans (`planeFactoryLinks`) und Läufe gegen Temp-Fixtures (Repo `o/f`). */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  planeAnkerStubs(o: { lies: (p: string) => string | null; einheiten: string[]; repo: string; tag: string; leser: Leser }): StubErgebnis;
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
    assert.deepEqual([nur.r.ueberschriften, nur.r.links], [1, 1]);
    assert.equal(mdLib.linkStellen(nur.r.dateien.get("docs/s.md") ?? "").length, 0);
    assert.equal((nur.r.dateien.get("docs/s.md") ?? "").split("](https://").length - 1, 1);
  });

  test("fehlt das Ziel am Tag, steht ein Hinweis da und es entsteht keine Datei", () => {
    const e = stubs(kern("#drei"), {});
    assert.equal(e.r.dateien.size, 0);
    assert.deepEqual(e.r.hinweise, ["Anker-Stub: docs/s.md gibt es am Tag v2 nicht, keine Stub-Seite (check:factorylinks meldet stub-ziel)"]);
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
    for (const k of ["deadLinks", "deadAnchors", "deadCommands", "undocumentedScripts", "testPfadFehler", "fortschreibungsFehler"]) assert.deepEqual(a[k] ?? [], [], k);
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
    assert.equal(existsSync(join(z, "docs", "seite.md")), false);
  });
});
