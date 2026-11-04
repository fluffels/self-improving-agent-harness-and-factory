/* Kern-Link-Wächter (quellprojekt#1860, ADR 0022 F10, factory#132): Markdown-Einheiten des Kerns dürfen nur auf Dateien verlinken, die im Bezieher da sind.
 * Ein Link auf eine Seite außerhalb des Besitz-Manifests `.factory/besitz.json` ist im Zielprojekt tot, sobald der Kern verteilt ist, es sei denn, ein Anker-Stub deckt ihn.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (quellprojekt#1165).
 *
 * Geprüft: Markdown-Links `](ziel.md)` bzw. `](ziel.md#anker)` in den Markdown-Einheiten (Datei, Block zwischen Markern) der Manifest-Einträge,
 * die verteilt werden (`wirdVerteilt`). Ein Ziel ist in Ordnung, wenn es selbst ein verteilter Manifest-Pfad ist. Jedes andere (Quelle, Ziel)-Paar muss auf eine
 * Factory-Seite zeigen (`istFactorySeite`: Markdown unter docs/ ohne ADRs, Lessons Learned und Gegenproben), die es gibt und in der jeder Anker steht; sonst ist es rot
 * („Link entfernen, Historie nur als Text“). Im Bezieher deckt ein Anker-Stub solche Links: den Gegenpart prüft `check:factorylinks` (Anker-Stubs), hier gilt nur die
 * Vorbedingung im Factory-Repo. Eine Baseline gibt es nicht mehr (factory#132). Ohne Anker im Link müssen nur Seite und Datei stimmen.
 *
 * Bewusste Grenze (Link-Hülle): nicht geprüft werden Backtick-Pfade und Pfade im Fließtext, http(s)- und andere Schema-Links, reine
 * Anker-Links, Links in Code-Fences und in Inline-Code, Links auf Nicht-Markdown-Dateien (Skripte, JSON) und Link-Referenz-Definitionen
 * (`[x]: ziel.md`). Nicht-Markdown-Einheiten des Manifests werden nicht gelesen.
 *
 * Pfad-Hülle (factory#114): dieselbe Regel für Skript-, Test- und Doku-Pfade in Code. Je Token (durch Leerraum getrennt) in Inline-Code oder in einem Code-Fence
 * einer verteilten Markdown-Einheit, das dem Muster `PFAD_MUSTER` entspricht (Wurzel `scripts|test|docs|.github|.claude|.agents|.factory`, Endung `mjs|cjs|js|ts|json|md|yaml|yml`;
 * ein Suffix `:zeile` oder `#anker` fällt weg), muss das Ziel ein verteilter Manifest-Pfad sein. Jedes andere (Quelle, Ziel)-Paar steht in `kern-pfade-baseline.json`
 * (nur sinkend). Ausgenommen sind Ziele, die im Bezieher entstehen und nie verteilt werden (`PROJEKT_CONFIG`, `STAND_PFAD`, `BEZIEHER_DATEIEN`): ein für uns behobenes
 * False Positive (die Dateien gehören dem Bezieher, ihr Pfad ist im Kern richtig), kein Lockern im Sinne von ADR 0027; jeder andere nicht verteilte Pfad bleibt ein Paar.
 * Bewusste Grenze (Pfad-Hülle): Pfade im Fließtext ohne Code, Pfade mit Platzhalter, Glob oder Klammer (`<nr>`, `*`, `{a,b}`), andere Wurzeln und Endungen,
 * Ordner ohne Dateiendung, und ein Pfad, der nur als Teil eines längeren Tokens steht (`./scripts/x.mjs` zählt, `$(pwd)/scripts/x.mjs` nicht). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ladeBesitzManifest } from "../support/besitz-anker";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMarkdown from "../../scripts/docs-gen/markdown.mjs";
// Die beiden Bezieher-Dateien, die der Kern nennt, aber nie verteilt: die Namen kommen aus ihren Besitzern, nicht als Literal.
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { PROJEKT_CONFIG } from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { STAND_PFAD } from "../../scripts/sync-stand-lib.mjs";
// Prädikat der Factory-Seiten (eine Quelle mit dem Umsteller der Ticketnummern).
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { istFactorySeite } from "../../scripts/herkunftsform.mjs";
const istSeite = istFactorySeite as (pfad: string) => boolean;
const { linkStellen, linkZiel, fenceMaske, collectHeadingSlugs } = rawMarkdown as unknown as {
  collectHeadingSlugs: (md: string) => string[];
  linkStellen: (md: string) => { path: string; anchor: string }[];
  linkZiel: (datei: string, pfad: string) => string;
  fenceMaske: (zeilen: string[]) => boolean[];
};

interface Eintrag {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring: string;
  quelle: string;
}
interface BesitzLib {
  einheitText: (e: Eintrag, text: string) => string | null;
  wirdVerteilt: (e: Eintrag) => boolean;
}
const { einheitText, wirdVerteilt } = rawBesitz as unknown as BesitzLib;

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const PFAD_BASELINE = "test/harness/kern-pfade-baseline.json";

const lesen = (pfad: string): string | null => (existsSync(WURZEL + pfad) ? readFileSync(WURZEL + pfad, "utf8") : null);

/** Repo-relative Markdown-Links in `text` einer Datei `quelle`: `{ ziel, anker }` (Ziel normalisiert, ohne Anker und Query; je Paar einmal, in Textreihenfolge). Schema-Links, reine Anker und Nicht-Markdown-Ziele bleiben außen vor. */
export function markdownLinks(quelle: string, text: string): { ziel: string; anker: string }[] {
  const links = new Map<string, { ziel: string; anker: string }>();
  for (const stelle of linkStellen(text)) {
    const ohneQuery = stelle.path.split("?")[0] ?? "";
    if (!ohneQuery.toLowerCase().endsWith(".md")) continue;
    const ziel = linkZiel(quelle, ohneQuery);
    links.set(`${ziel}\0${stelle.anchor}`, { ziel, anker: stelle.anchor });
  }
  return [...links.values()];
}

/** Repo-relative Markdown-Ziele der Links in `text` einer Datei `quelle` (ohne Anker, dedupliziert). */
export function markdownZiele(quelle: string, text: string): string[] {
  return [...new Set(markdownLinks(quelle, text).map((l) => l.ziel))];
}

/** Ein Pfad in Code: Wurzelordner des Repos, Datei mit bekannter Endung; danach kein Namensrest (`.bak`, `-x`), `:zeile` und `#anker` fallen weg. */
const PFAD_MUSTER = /^(\.\/)?(scripts|test|docs|\.github|\.claude|\.agents|\.factory)\/[^\s<>*{}]+\.(mjs|cjs|js|ts|json|md|ya?ml)(?![\w/-]|\.\w)/;

/** Dateien, die der Kern nennt und nie verteilt, weil sie im Bezieher entstehen (Projekt-Config, Sync-Stand): als Ziel der Pfad-Hülle erlaubt. */
const BEZIEHER_DATEIEN = new Set<string>([PROJEKT_CONFIG, STAND_PFAD]);

/** Repo-relative Pfade aus Inline-Code und Code-Fences von `text` (ohne `./`, dedupliziert). */
export function pfadZiele(text: string): string[] {
  const zeilen = text.split(/\r?\n/);
  const imFence = fenceMaske(zeilen);
  const ziele = new Set<string>();
  zeilen.forEach((zeile, i) => {
    const codeStuecke = imFence[i] ? [zeile] : [...zeile.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? "");
    for (const stueck of codeStuecke) {
      for (const token of stueck.split(/\s+/)) {
        const treffer = PFAD_MUSTER.exec(token.replace(/^["'(=[]+/, ""));
        if (treffer) ziele.add(treffer[0].replace(/^\.\//, ""));
      }
    }
  });
  return [...ziele];
}

/** Die Paare `quelle -> ziel` aus den verteilten Markdown-Einheiten (`ziele` liest die Ziele einer Einheit), deren Ziel kein verteilter Manifest-Pfad ist (sortiert, ohne Doppelte). */
function fremdePaare(eintraege: Eintrag[], lies: (pfad: string) => string | null, ziele: (quelle: string, einheit: string) => string[]): string[] {
  const verteilt = eintraege.filter(wirdVerteilt);
  const kern = new Set(verteilt.map((e) => e.pfad));
  const paare = new Set<string>();
  for (const e of verteilt) {
    if (!e.pfad.toLowerCase().endsWith(".md") || e.schluessel !== undefined) continue;
    const text = lies(e.pfad);
    const einheit = text === null ? null : einheitText(e, text);
    if (einheit === null) continue;
    for (const ziel of ziele(e.pfad, einheit)) if (!kern.has(ziel)) paare.add(`${e.pfad} -> ${ziel}`);
  }
  return [...paare].sort();
}

const LINK_FIX = {
  keineSeite: "Link auf eine Datei, die keine Factory-Seite ist (Historie oder außerhalb von docs/). Fix: Link entfernen (ADRs und Historie nur als Text) oder Ziel ins Besitz-Manifest aufnehmen (F10)",
  zielFehlt: "Link auf eine Factory-Seite, die es nicht gibt. Fix: Link entfernen oder die Seite anlegen",
  ankerFehlt: (anker: string) => `Anker #${anker} fehlt im Ziel. Fix: Anker im Ziel anlegen oder den Link korrigieren`,
};

/** Meldungen der Kern-Links ohne Deckung: das Ziel ist kein verteilter Manifest-Pfad und keine vorhandene Factory-Seite mit allen Ankern (sortiert, ohne Doppelte). */
export function ungedeckteLinks(eintraege: Eintrag[], lies: (pfad: string) => string | null): string[] {
  const verteilt = eintraege.filter(wirdVerteilt);
  const kern = new Set(verteilt.map((e) => e.pfad));
  const meldungen = new Set<string>();
  for (const e of verteilt) {
    if (!e.pfad.toLowerCase().endsWith(".md") || e.schluessel !== undefined) continue;
    const text = lies(e.pfad);
    const einheit = text === null ? null : einheitText(e, text);
    if (einheit === null) continue;
    for (const { ziel, anker } of markdownLinks(e.pfad, einheit)) {
      if (kern.has(ziel)) continue;
      const paar = anker === "" ? `${e.pfad} -> ${ziel}` : `${e.pfad} -> ${ziel}#${anker}`;
      const zieltext = istSeite(ziel) ? lies(ziel) : null;
      if (!istSeite(ziel)) meldungen.add(`${paar}: ${LINK_FIX.keineSeite}`);
      else if (zieltext === null) meldungen.add(`${paar}: ${LINK_FIX.zielFehlt}`);
      else if (anker !== "" && !collectHeadingSlugs(zieltext).includes(anker)) meldungen.add(`${paar}: ${LINK_FIX.ankerFehlt(anker)}`);
    }
  }
  return [...meldungen].sort();
}

/** Die Pfad-Paare `quelle -> ziel` aus Code (Pfad-Hülle), deren Ziel kein verteilter Manifest-Pfad ist (sortiert, ohne Doppelte). */
export function fremdePfade(eintraege: Eintrag[], lies: (pfad: string) => string | null): string[] {
  return fremdePaare(eintraege, lies, (_quelle, einheit) => pfadZiele(einheit).filter((ziel) => !BEZIEHER_DATEIEN.has(ziel)));
}

interface Meldungen {
  neu: string;
  weg: string;
}
const PFAD_MELDUNGEN: Meldungen = {
  neu: "Pfad in Code auf eine Datei außerhalb des Kerns. Fix: Ziel ins Besitz-Manifest aufnehmen (F10) oder den Pfad entfernen bzw. als Platzhalter schreiben",
  weg: `steht in der Baseline, der Pfad existiert nicht mehr. Fix: Eintrag aus ${PFAD_BASELINE} streichen`,
};

/** Meldungen: neue Paare (nicht in der Baseline) und verschwundene Paare (nur noch in der Baseline). */
export function vergleiche(ist: string[], baseline: string[], texte: Meldungen): string[] {
  const out: string[] = [];
  const bekannt = new Set(baseline);
  const aktuell = new Set(ist);
  for (const p of ist) if (!bekannt.has(p)) out.push(`${p}: ${texte.neu}`);
  for (const p of baseline) if (!aktuell.has(p)) out.push(`${p}: ${texte.weg}`);
  return out;
}

const manifest = ladeBesitzManifest<Eintrag>();
const baselineLesen = (pfad: string): string[] => (JSON.parse(lesen(pfad) ?? "{}") as { paare?: string[] }).paare ?? [];
const pfadPaare = baselineLesen(PFAD_BASELINE);

describe("Kern-Links (quellprojekt#1860)", () => {
  test("jeder Link einer Kern-Einheit führt in den Kern oder auf eine vorhandene Factory-Seite mit Anker (keine Baseline, factory#132)", () => {
    assert.deepEqual(ungedeckteLinks(manifest.eintraege, lesen), []);
  });

  describe("markdownZiele", () => {
    test("löst relative Ziele gegen die Quelle auf, schneidet Anker und Titel ab, normalisiert ../", () => {
      const t = "[a](adr/0014.md#x) [b](../AGENTS.md) [c](./k.md \"Titel\") [d](/docs/w.md)";
      assert.deepEqual(markdownZiele("docs/sub/q.md", t), ["docs/sub/adr/0014.md", "docs/AGENTS.md", "docs/sub/k.md", "docs/w.md"]);
    });
    test("Ziele in spitzen Klammern (mit Leerzeichen) und Query werden aufgelöst", () => {
      assert.deepEqual(markdownZiele("docs/q.md", "[a](<sub/a b.md#x>) [b](c.md?v=1)"), ["docs/sub/a b.md", "docs/c.md"]);
    });
    test("http(s), mailto, reine Anker und Nicht-Markdown-Ziele zählen nicht", () => {
      const t = "[a](https://x.de/a.md) [b](mailto:a@b.md) [c](#abschnitt) [d](skript.mjs) [e](bild.png#a.md)";
      assert.deepEqual(markdownZiele("docs/q.md", t), []);
    });
    test("Links in Code-Fences (``` und ~~~) und in Inline-Code zählen nicht, danach geht es normal weiter", () => {
      const t = "```\n[a](a.md)\n```\n`[b](b.md)` text\n~~~\n[c](c.md)\n~~~\n[d](d.md)";
      assert.deepEqual(markdownZiele("q.md", t), ["d.md"]);
    });
    test("ein längerer Zaun wird nur von gleichem Zeichen beendet; ein ~~~ in einem ```-Zaun schließt nicht", () => {
      const t = "```\n~~~\n[a](a.md)\n```\n[b](b.md)";
      assert.deepEqual(markdownZiele("q.md", t), ["b.md"]);
    });
    test("ein 4er-Zaun wird von einem inneren ``` oder ```x nicht geschlossen (CommonMark über fenceMaske)", () => {
      assert.deepEqual(markdownZiele("q.md", "````\n```\n[a](a.md)\n```\n[c](c.md)\n````\n[b](b.md)"), ["b.md"]);
      assert.deepEqual(markdownZiele("q.md", "```\n```js\n[a](a.md)\n```\n[b](b.md)"), ["b.md"]);
    });
    test("doppelte Ziele erscheinen einmal; Backtick-Pfade und Fließtext sind keine Links (bewusste Grenze)", () => {
      assert.deepEqual(markdownZiele("q.md", "[a](a.md) [b](a.md#z) `docs/x.md` siehe docs/y.md"), ["a.md"]);
    });
    test("CRLF-Text liefert dieselben Ziele wie LF", () => {
      assert.deepEqual(markdownZiele("q.md", "```\r\n[a](a.md)\r\n```\r\n[b](b.md)\r\n"), ["b.md"]);
    });
  });

  describe("markdownLinks", () => {
    test("liefert Ziel und Anker je Paar einmal, in Textreihenfolge", () => {
      assert.deepEqual(markdownLinks("docs/q.md", "[a](a.md#x) [b](a.md#x) [c](a.md) [d](b.md#y)"), [
        { ziel: "docs/a.md", anker: "x" },
        { ziel: "docs/a.md", anker: "" },
        { ziel: "docs/b.md", anker: "y" },
      ]);
    });
  });

  describe("ungedeckteLinks (factory#132)", () => {
    const e = (pfad: string, extra: Partial<Eintrag> = {}): Eintrag => ({ pfad, ring: "kern", quelle: "t", ...extra });
    const dateien: Record<string, string> = {
      "docs/a.md": "[kern](b.md) [seite](s.md#abschnitt) [ohne](s.md) [dup](s.md#abschnitt-1)",
      "docs/b.md": "[zurück](a.md)",
      "docs/s.md": "# S\n\n## Abschnitt\n\n## Abschnitt\n",
      "docs/blk.md": "vor [außen](ausser.md)\n<!-- factory-besitz:start k -->\n[innen](s.md#abschnitt)\n<!-- factory-besitz:ende k -->",
      "docs/skript.mjs": "[nicht](geprueft.md)",
    };
    const lies = (p: string): string | null => dateien[p] ?? null;
    const von = (pfad: string, text: string, ...weitere: Eintrag[]) => ungedeckteLinks([e(pfad), ...weitere], (p) => (p === pfad ? text : lies(p)));

    test("gedeckt: ein verteilter Manifest-Pfad, eine Factory-Seite mit vorhandenem Anker (auch Duplikat -1), ohne Anker nur die Seite", () => {
      assert.deepEqual(ungedeckteLinks([e("docs/a.md"), e("docs/b.md")], lies), []);
    });
    test("rot: der Anker fehlt im Ziel, die Meldung nennt Paar, Anker und Fix", () => {
      const m = von("docs/q.md", "[x](s.md#fehlt)");
      assert.equal(m.length, 1);
      assert.match(m[0] ?? "", /^docs\/q\.md -> docs\/s\.md#fehlt: Anker #fehlt fehlt im Ziel\. Fix:/);
    });
    test("rot: ADR, Lessons Learned, Gegenprobe und ein Ziel außerhalb von docs/ sind keine Factory-Seiten", () => {
      for (const ziel of ["docs/adr/x.md", "docs/lessons-learned.md", "docs/a-gegenprobe-b.md", "README.md"]) {
        const m = von("docs/q.md", `[x](${ziel.startsWith("docs/") ? ziel.slice(5) : "../" + ziel})`);
        assert.equal(m.length, 1, ziel);
        assert.match(m[0] ?? "", /keine Factory-Seite/, ziel);
      }
    });
    test("rot: das Ziel fehlt", () => {
      assert.match(von("docs/q.md", "[x](gibtsnicht.md)")[0] ?? "", /^docs\/q\.md -> docs\/gibtsnicht\.md: .*es nicht gibt/);
    });
    test("ein Ziel nur im Ring der Factory (wird nicht verteilt) braucht die Factory-Seiten-Regel", () => {
      const ring = (rawBesitz as unknown as { NUR_FACTORY: string[] }).NUR_FACTORY[0];
      assert.ok(ring, "NUR_FACTORY ist leer: der Test braucht einen nicht verteilten Ring");
      assert.deepEqual(ungedeckteLinks([e("docs/a.md"), e("docs/b.md", { ring })], lies), []);
      const adr = (p: string): string | null => (p === "docs/adr/z.md" ? "# Z\n" : p === "docs/a.md" ? "[x](adr/z.md)" : null);
      assert.equal(ungedeckteLinks([e("docs/a.md"), e("docs/adr/z.md", { ring })], adr).length, 1);
    });
    test("nur der Block zwischen den Markern zählt; Nicht-Markdown, JSON-Schlüssel und fehlende Dateien werden übersprungen", () => {
      const eintraege = [e("docs/blk.md", { block: "k" }), e("docs/skript.mjs"), e("docs/fehlt.md"), e("docs/jsn.md", { schluessel: "s" })];
      const mitSchluessel = (p: string): string | null => (p === "docs/jsn.md" ? JSON.stringify({ s: "[x](s.md#nix)" }) : lies(p));
      assert.deepEqual(ungedeckteLinks(eintraege, mitSchluessel), []);
      assert.equal(ungedeckteLinks([e("docs/jsn.md")], mitSchluessel).length, 1);
      assert.equal(ungedeckteLinks([e("docs/blk.md", { block: "k" })], (p) => (p === "docs/blk.md" ? (dateien[p] ?? "").replace("s.md#abschnitt", "s.md#nix") : lies(p))).length, 1);
    });
  });

});

describe("Pfad-Hülle (factory#114)", () => {
  test("jeder Skript-, Test- und Doku-Pfad in Code einer Kern-Einheit führt in den Kern oder steht in der Baseline; die Baseline kennt nur noch echte Paare", () => {
    assert.deepEqual(vergleiche(fremdePfade(manifest.eintraege, lesen), pfadPaare, PFAD_MELDUNGEN), []);
  });

  test("die Baseline ist sortiert und ohne Doppelte (ein Paar, eine Zeile)", () => {
    assert.deepEqual(pfadPaare, [...new Set(pfadPaare)].sort());
  });

  describe("pfadZiele", () => {
    test("Pfade in Inline-Code und in Code-Fences, ein Token je Pfad, ohne ./ und ohne Doppelte", () => {
      const t = "Siehe `node scripts/a.mjs --x` und `./test/b.test.ts`.\n```bash\nnode docs/c.md .github/w.yml\n```\n`scripts/a.mjs`";
      assert.deepEqual(pfadZiele(t), ["scripts/a.mjs", "test/b.test.ts", "docs/c.md", ".github/w.yml"]);
    });
    test("Suffix :zeile und #anker fallen weg, umgebende Anführungszeichen, Klammer und Satzzeichen auch", () => {
      assert.deepEqual(pfadZiele("`scripts/a.mjs:12` `docs/b.md#abschnitt` `\"test/c.ts\"` `(.factory/d.json),` `scripts/e.mjs.`"), [
        "scripts/a.mjs",
        "docs/b.md",
        "test/c.ts",
        ".factory/d.json",
        "scripts/e.mjs",
      ]);
    });
    test("Fließtext ohne Code, Platzhalter, Glob, Klammern, andere Wurzeln und Endungen zählen nicht (bewusste Grenze)", () => {
      const t = "siehe scripts/a.mjs im Text; `scripts/<name>.mjs` `docs/*.md` `scripts/{a,b}.mjs` `src/x.ts` `scripts/x.sh` `scripts/ordner/` `$(pwd)/scripts/x.mjs`";
      assert.deepEqual(pfadZiele(t), []);
    });
    test("ein Namensrest nach der Endung (`.bak`, `-x`) verhindert den Treffer", () => {
      assert.deepEqual(pfadZiele("`scripts/a.mjs.bak` `scripts/a.mjs-x` `scripts/a.mjsx`"), []);
    });
    test("jede Endung der Liste und Wurzel der Liste trifft", () => {
      const t = "`scripts/a.cjs` `scripts/a.js` `test/a.ts` `test/a.json` `docs/a.md` `.github/a.yaml` `.github/a.yml` `.claude/a.md` `.agents/a.md` `.factory/a.json`";
      assert.equal(pfadZiele(t).length, 10);
    });
    test("CRLF-Text liefert dieselben Ziele wie LF", () => {
      assert.deepEqual(pfadZiele("```\r\nscripts/a.mjs\r\n```\r\n`docs/b.md`\r\n"), ["scripts/a.mjs", "docs/b.md"]);
    });
    test("Text im Fence nach seinem Ende zählt wieder nur in Inline-Code", () => {
      assert.deepEqual(pfadZiele("```\nscripts/a.mjs\n```\nscripts/b.mjs `scripts/c.mjs`"), ["scripts/a.mjs", "scripts/c.mjs"]);
    });
  });

  describe("fremdePfade", () => {
    const e = (pfad: string, extra: Partial<Eintrag> = {}): Eintrag => ({ pfad, ring: "kern", quelle: "t", ...extra });
    const dateien: Record<string, string> = {
      "docs/a.md": "`scripts/k.mjs` `scripts/fremd.mjs` `scripts/fremd.mjs:3`",
      "scripts/k.mjs": "`scripts/nicht-gelesen.mjs`",
      "docs/blk.md": "vor `scripts/aussen.mjs`\n<!-- factory-besitz:start k -->\n`scripts/innen.mjs`\n<!-- factory-besitz:ende k -->",
    };
    const lies = (p: string): string | null => dateien[p] ?? null;

    test("ein Pfad auf einen Manifest-Pfad ist in Ordnung, einer daneben ist ein Paar (ohne Doppelte)", () => {
      assert.deepEqual(fremdePfade([e("docs/a.md"), e("scripts/k.mjs")], lies), ["docs/a.md -> scripts/fremd.mjs"]);
    });
    test("ein Ziel nur im Ring der Factory (wird nicht verteilt) zählt als außerhalb", () => {
      const ring = (rawBesitz as unknown as { NUR_FACTORY: string[] }).NUR_FACTORY[0];
      assert.ok(ring, "NUR_FACTORY ist leer: der Test braucht einen nicht verteilten Ring");
      assert.deepEqual(fremdePfade([e("docs/a.md"), e("scripts/k.mjs", { ring }), e("scripts/fremd.mjs")], lies), ["docs/a.md -> scripts/k.mjs"]);
    });
    test("die Projekt-Config und der Sync-Stand sind erlaubte Ziele (sie leben im Bezieher), jeder andere nicht verteilte .factory-Pfad bleibt ein Paar", () => {
      const dok = (p: string): string | null => (p === "docs/c.md" ? `\`${PROJEKT_CONFIG}\` \`${STAND_PFAD}\` \`.factory/andere.json\`` : null);
      assert.deepEqual(fremdePfade([e("docs/c.md")], dok), ["docs/c.md -> .factory/andere.json"]);
    });
    test("nur der Block zwischen den Markern zählt; Nicht-Markdown, JSON-Schlüssel und fehlende Dateien werden übersprungen", () => {
      const eintraege = [e("docs/blk.md", { block: "k" }), e("scripts/k.mjs"), e("docs/fehlt.md"), e("docs/a.md", { schluessel: "s" })];
      assert.deepEqual(fremdePfade(eintraege, lies), ["docs/blk.md -> scripts/innen.mjs"]);
    });
  });

  describe("vergleiche (Pfade)", () => {
    test("ein neues Paar ist rot und nennt den Pfad-Fix, ein verschwundenes verlangt, den Eintrag aus der Pfad-Baseline zu streichen", () => {
      const neu = vergleiche(["a -> b", "a -> c"], ["a -> b"], PFAD_MELDUNGEN);
      assert.equal(neu.length, 1);
      assert.match(neu[0] ?? "", /^a -> c: Pfad in Code .*Besitz-Manifest aufnehmen \(F10\) oder den Pfad entfernen/);
      const weg = vergleiche(["a -> b"], ["a -> b", "a -> c"], PFAD_MELDUNGEN);
      assert.equal(weg.length, 1);
      assert.match(weg[0] ?? "", /^a -> c: .*Eintrag aus test\/harness\/kern-pfade-baseline\.json streichen/);
    });
  });
});
