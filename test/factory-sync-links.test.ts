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
function baueQuelle(opt: { mitRepo?: boolean; stopp?: string } = {}): string {
  const q = tmp();
  schreibe(q, ".factory/besitz.json", `${JSON.stringify(MANIFEST, null, 2)}\n`);
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

describe("factory-sync --tag: Link-Schritt", () => {
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

  test("ein zweiter Sync auf denselben Tag ändert nichts mehr", () => {
    const q = baueQuelle();
    const z = baueZiel({ "docs/x.md": `[a](${u("v1", "AGENTS.md", "quelle")})\n` });
    assert.equal(syncVomTag(q, z, "v2").code, 0);
    const r = syncVomTag(q, z, "v2");
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /factory-sync: 0 geändert/);
  });
});
