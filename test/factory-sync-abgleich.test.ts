/* Erst-Übernahme-Schutz und Vorlage-Einheiten (factory#118, ADR 0022 Fortschreibung 118): Unit-Tests der Blatt-Lib `sync-abgleich-lib.mjs`,
 * Sync in ein synthetisches Fremdrepo (Temp-Ordner, Entwurf aus dem Arbeitsbaum der Quelle) und das Drift-Gate. Nichts davon liegt im Repo. */
import { afterEach, describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawAbgleich from "../scripts/sync-abgleich-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSync from "../scripts/factory-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../scripts/check-factory-drift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";

interface Eintrag {
  pfad: string;
  ring: string;
  quelle: string;
  art?: string;
  block?: string;
  schluessel?: string;
  pflichtChecks?: string[];
}
const abgleich = rawAbgleich as unknown as {
  istVorlage(e: Partial<Eintrag>): boolean;
  artFehler(e: Partial<Eintrag>): string[];
  abweichendeZeilen(a: string, b: string): number;
  normalisiereUebernahmePfad(p: string): string;
  erstUebernahme(a: { kandidaten: { pfad: string; zielLf: string | null; ergebnis: string }[]; altEinheiten: string[]; uebernehmen: string[] }): { fehler: string[]; hinweise: string[] };
};
const lib = rawLib as unknown as { pruefeManifest(m: { version: number; eintraege: Eintrag[] }, lies: (p: string) => string | null): string[]; textHash(t: string): string };
const sync = rawSync as unknown as { cli(argv: string[], opt?: { cwd?: string; out?: (s: string) => void; err?: (s: string) => void }): number };
const drift = rawDrift as unknown as { pruefeDrift(lies: (p: string) => string | null): { entfaellt: boolean; fehler: string[]; einheiten: number } };
const pc = rawPc as unknown as { ROLLEN_PFADE: Record<string, string>; PROJEKT_ROLLEN: string[] };

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "fsyncab-"));
  temps.push(d);
  return d;
};
const schreibe = (wurzel: string, rel: string, text: string): void => {
  const voll = join(wurzel, ...rel.split("/"));
  mkdirSync(dirname(voll), { recursive: true });
  writeFileSync(voll, text);
};
const lies = (wurzel: string, rel: string): string => readFileSync(join(wurzel, ...rel.split("/")), "utf8");

describe("abweichendeZeilen", () => {
  test("gleich 0, geänderte Zeile 1 (nicht 2), zwei geänderte Zeilen 2, eingefügte 1, verschobener Block zählt", () => {
    assert.equal(abgleich.abweichendeZeilen("a\nb\nc\n", "a\nb\nc\n"), 0);
    assert.equal(abgleich.abweichendeZeilen("a\nb\nc\n", "a\nx\nc\n"), 1);
    assert.equal(abgleich.abweichendeZeilen("a\nb\nc\nd\ne\nf\ng\n", "a\nb\nX\nd\ne\nf\nY\n"), 2);
    assert.equal(abgleich.abweichendeZeilen("a\nb\n", "a\nn\nb\n"), 1);
    assert.equal(abgleich.abweichendeZeilen("a\nb\n", "a\n"), 1);
    assert.equal(abgleich.abweichendeZeilen("a\nb\nc\nd\n", "c\nd\na\nb\n"), 2);
    // Überlappung von gemeinsamem Anfang und Ende (Suffix-Grenze): eine doppelte Zeile zählt einmal, in beiden Richtungen
    assert.equal(abgleich.abweichendeZeilen("x\nx\n", "x\n"), 1);
    assert.equal(abgleich.abweichendeZeilen("x\n", "x\nx\n"), 1);
    // Zweig jetzt[j - 1] des LCS-Kerns (-x -y +z +q +w): die größere Seite zählt, 3 (ohne den Zweig wäre lcs 0 und das Ergebnis 4)
    assert.equal(abgleich.abweichendeZeilen("x\na\ny\n", "z\na\nq\nw\n"), 3);
    // Treffer-Zweig des LCS-Kerns (vor[j - 1] + 1): eine wiederholte Zeile zählt nur einmal als gemeinsam
    assert.equal(abgleich.abweichendeZeilen("z\nb\nb\nq\n", "w\nb\nv\n"), 3);
    // Auslesen des LCS an der Grenze vor[y.length]: die letzte Zeile des mittleren Fensters gehört zur gemeinsamen Teilfolge
    assert.equal(abgleich.abweichendeZeilen("a\np\n", "q\na\n"), 1);
    // die Seite mit mehr abweichenden Zeilen zählt, in beiden Richtungen
    assert.equal(abgleich.abweichendeZeilen("a\nb\nc\nd\n", "a\nX\n"), 3);
    assert.equal(abgleich.abweichendeZeilen("a\nX\n", "a\nb\nc\nd\n"), 3);
    // Index-Versatz im Vergleich (y[j - 1]), Treffer aus der Vorzeile (vor[j - 1]), Text ohne abschließenden Zeilenumbruch (Suffix-Vergleich)
    assert.equal(abgleich.abweichendeZeilen("c\na\nc\n", "a\n"), 2);
    assert.equal(abgleich.abweichendeZeilen("z\nb\nq\n", "w\nb\nb\nv\n"), 3);
    assert.equal(abgleich.abweichendeZeilen("a\nb", "a\nc"), 1);
  });
  test("stimmt mit einer Referenz ohne Abkürzungen überein: alle Zeilenfolgen über drei Zeilen bis Länge 4, mit und ohne abschließenden Zeilenumbruch", () => {
    // Referenz: volle LCS-Tabelle über alle Zeilen, ohne gemeinsamen Anfang und Ende abzuschneiden
    const referenz = (a: string, b: string): number => {
      const x = a.split("\n");
      const y = b.split("\n");
      const t: number[][] = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
      for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) t[i][j] = x[i - 1] === y[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
      const lcs = t[x.length][y.length];
      return Math.max(x.length - lcs, y.length - lcs);
    };
    const folgen: string[][] = [[]];
    for (let n = 1; n <= 4; n++) for (const f of folgen.filter((g) => g.length === n - 1)) for (const z of ["a", "b", "c"]) folgen.push([...f, z]);
    const texte = folgen.flatMap((f) => [f.join("\n"), f.length > 0 ? f.join("\n") + "\n" : "\n"]);
    let paare = 0;
    for (const a of texte) {
      for (const b of texte) {
        assert.equal(abgleich.abweichendeZeilen(a, b), referenz(a, b), JSON.stringify([a, b]));
        paare++;
      }
    }
    assert.ok(paare > 10000);
  });
});

describe("artFehler / istVorlage", () => {
  const ganz = { pfad: "x", ring: "kern", quelle: "t" };
  test("art fehlt: Besitz, kein Fehler; Vorlage als ganze Datei gültig", () => {
    assert.deepEqual(abgleich.artFehler(ganz), []);
    assert.deepEqual(abgleich.artFehler({ ...ganz, art: "vorlage" }), []);
    assert.equal(abgleich.istVorlage({ ...ganz, art: "vorlage" }), true);
    assert.equal(abgleich.istVorlage(ganz), false);
  });
  test("Vorlage mit block, schluessel oder pflichtChecks sowie ein unbekannter Wert sind Fehler", () => {
    assert.match(abgleich.artFehler({ ...ganz, art: "vorlage", block: "b" }).join("|"), /nur an einer ganzen Datei/);
    assert.match(abgleich.artFehler({ ...ganz, art: "vorlage", schluessel: "k" }).join("|"), /nur an einer ganzen Datei/);
    assert.match(abgleich.artFehler({ ...ganz, art: "vorlage", pflichtChecks: ["x"] }).join("|"), /pflichtChecks/);
    for (const falsch of ["Vorlage", "besitz", ""]) assert.match(abgleich.artFehler({ ...ganz, art: falsch }).join("|"), /unbekannte art/);
  });
  test("pruefeManifest meldet die art-Fehler mit der Einheit", () => {
    const m = { version: 1, eintraege: [{ pfad: "x", ring: "kern", quelle: "t", art: "besitz" }] };
    assert.match(lib.pruefeManifest({ ...m, version: 2 }, () => "t").join("|"), /x: unbekannte art 'besitz'/);
  });
  test("art braucht Manifest-Version 2: ein altes Werkzeug lehnt Version 2 ab, das neue Version 1 mit art", () => {
    const e = { pfad: "x", ring: "kern", quelle: "t", art: "vorlage" };
    assert.match(lib.pruefeManifest({ version: 1, eintraege: [e] }, () => "t").join("|"), /art braucht version 2/);
    assert.deepEqual(lib.pruefeManifest({ version: 2, eintraege: [e] }, () => "t"), []);
    assert.deepEqual(lib.pruefeManifest({ version: 1, eintraege: [{ pfad: "x", ring: "kern", quelle: "t" }] }, () => "t"), []);
    assert.match(lib.pruefeManifest({ version: 3, eintraege: [] }, () => "t").join("|"), /version 3 unbekannt/);
  });
});

describe("erstUebernahme", () => {
  const k = (pfad: string, zielLf: string | null, ergebnis = "neu\n") => ({ pfad, zielLf, ergebnis });
  test("im alten Stand, neu und gleich, Ziel fehlt: kein Fehler", () => {
    const r = abgleich.erstUebernahme({ kandidaten: [k("a", "eigen\n"), k("b", "neu\n"), k("c", null)], altEinheiten: ["a"], uebernehmen: [] });
    assert.deepEqual(r, { fehler: [], hinweise: [] });
  });
  test("neu und abweichend: exakte ABGLEICH-Zeile mit Zahl, alle Pfade in einem Lauf, dazu die Weg-Zeile", () => {
    const r = abgleich.erstUebernahme({ kandidaten: [k("scripts/a.mjs", "x\ny\n", "x\nz\n"), k("scripts/b.mjs", "eigen\n")], altEinheiten: [], uebernehmen: [] });
    assert.equal(r.fehler[0], "ABGLEICH scripts/a.mjs: Ziel hat eine eigene Fassung (abweichende Zeilen: 1)");
    assert.match(r.fehler[1] ?? "", /^ABGLEICH scripts\/b\.mjs: Ziel hat eine eigene Fassung/);
    assert.match(r.fehler[2] ?? "", /^ABGLEICH Weg: .*--uebernehmen scripts\/a\.mjs --uebernehmen scripts\/b\.mjs/);
  });
  test("mit --uebernehmen: kein Fehler, Hinweis; Schreibweise mit Backslash und ./ zählt", () => {
    const r = abgleich.erstUebernahme({ kandidaten: [k("scripts/a.mjs", "eigen\n")], altEinheiten: [], uebernehmen: [".\\scripts\\a.mjs"] });
    assert.deepEqual(r.fehler, []);
    assert.match(r.hinweise.join("|"), /Erst-Übernahme: 'scripts\/a\.mjs'/);
    assert.equal(abgleich.normalisiereUebernahmePfad("./a/b"), "a/b");
    assert.equal(abgleich.normalisiereUebernahmePfad("././a"), "a");
    assert.equal(abgleich.normalisiereUebernahmePfad("scripts/./a.mjs"), "scripts/./a.mjs");
  });
  test("unbekannter --uebernehmen-Pfad ist ein Fehler, ein Pfad ohne Abgleichbedarf nur ein Hinweis", () => {
    const r = abgleich.erstUebernahme({ kandidaten: [k("a", null)], altEinheiten: [], uebernehmen: ["tippfehler", "a"] });
    assert.match(r.fehler.join("|"), /--uebernehmen 'tippfehler'/);
    assert.match(r.hinweise.join("|"), /'a' ohne Wirkung/);
  });
});

// ── Sync in ein Fremdrepo-Fixture (Entwurf aus dem Arbeitsbaum) ────────────────

const ROLLEN = Object.entries(pc.ROLLEN_PFADE)
  .filter(([rolle]) => !pc.PROJEKT_ROLLEN.includes(rolle))
  .map(([, pfad]) => ({ pfad, ring: "kern", quelle: "t" }));
const MANIFEST = {
  version: 2,
  eintraege: [...ROLLEN, { pfad: "scripts/a.mjs", ring: "kern", quelle: "t" }, { pfad: ".github/dependabot.yml", ring: "kern-nach-entkopplung", art: "vorlage", quelle: "t" }],
};
const DEP_QUELLE = "version: 2\nupdates: []\n";
function baueQuelle(): string {
  const q = tmp();
  schreibe(q, ".factory/besitz.json", JSON.stringify(MANIFEST, null, 2) + "\n");
  schreibe(q, "scripts/a.mjs", "export const a = 1;\n");
  schreibe(q, ".github/dependabot.yml", DEP_QUELLE);
  for (const e of ROLLEN) schreibe(q, e.pfad, "rolle\n");
  return q;
}
interface Lauf {
  code: number;
  out: string;
  err: string;
}
function laufe(q: string, z: string, extra: string[] = []): Lauf {
  const out: string[] = [];
  const err: string[] = [];
  const code = sync.cli(["--quelle", q, "--ziel", z, "--entwurf", ...extra], { out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const dateien = (z: string): string[] => ["scripts/a.mjs", ".factory/sync-stand.json", ".factory/besitz.json", ".github/dependabot.yml"].map((p) => `${p}=${existsSync(join(z, p)) ? lies(z, p) : "-"}`);

describe("Erst-Übernahme im Sync", { timeout: 30_000 }, () => {
  test("abweichende Ziel-Kopie ohne --uebernehmen: Exit 1, ABGLEICH-Zeile, nichts geschrieben (AK3)", () => {
    const q = baueQuelle();
    const z = tmp();
    schreibe(z, "scripts/a.mjs", "export const a = 99;\n");
    const vorher = dateien(z);
    const r = laufe(q, z);
    assert.equal(r.code, 1, r.out);
    assert.match(r.err, /^ABGLEICH scripts\/a\.mjs: Ziel hat eine eigene Fassung \(abweichende Zeilen: 1\)/m);
    assert.match(r.err, /nichts geschrieben/);
    assert.deepEqual(dateien(z), vorher);
    assert.ok(!existsSync(join(z, ".factory/sync-stand.json")));
  });
  test("--trocken mit offenem ABGLEICH: ebenfalls Exit 1", () => {
    const q = baueQuelle();
    const z = tmp();
    schreibe(z, "scripts/a.mjs", "eigen\n");
    assert.equal(laufe(q, z, ["--trocken"]).code, 1);
  });
  test("--uebernehmen gibt frei (wiederholbar), danach steht die Datei im Stand und der zweite Lauf ändert nichts", () => {
    const q = baueQuelle();
    const z = tmp();
    schreibe(z, "scripts/a.mjs", "eigen\n");
    const r = laufe(q, z, ["--uebernehmen", "scripts/a.mjs", "--uebernehmen", ".github/dependabot.yml"]);
    assert.equal(r.code, 1, "eine Vorlage ist nicht übernehmbar (Tippfehler-Schutz)");
    const ok = laufe(q, z, ["--uebernehmen", "scripts/a.mjs"]);
    assert.equal(ok.code, 0, ok.err);
    assert.match(ok.out, /Erst-Übernahme: 'scripts\/a\.mjs'/);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 1;\n");
    const stand = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    assert.ok("scripts/a.mjs" in stand.einheiten);
    const zweiter = laufe(q, z);
    assert.equal(zweiter.code, 0, zweiter.err);
    assert.match(zweiter.out, /0 geändert/);
  });
  test("unbekannter --uebernehmen-Pfad: Exit 1, nichts geschrieben", () => {
    const q = baueQuelle();
    const z = tmp();
    const vorher = dateien(z);
    const r = laufe(q, z, ["--uebernehmen", "scripts/fehlt.mjs"]);
    assert.equal(r.code, 1);
    assert.match(r.err, /--uebernehmen 'scripts\/fehlt\.mjs'/);
    assert.deepEqual(dateien(z), vorher);
  });
  test("inhaltsgleiche Ziel-Datei (auch CRLF) wird still übernommen", () => {
    const q = baueQuelle();
    const z = tmp();
    schreibe(z, "scripts/a.mjs", "export const a = 1;\r\n");
    const r = laufe(q, z);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err + r.out, /ABGLEICH/);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 1;\r\n");
    assert.ok("scripts/a.mjs" in (JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: object }).einheiten);
  });
  test("steht die Datei schon im alten Stand, überschreibt der Sync wie bisher", () => {
    const q = baueQuelle();
    const z = tmp();
    assert.equal(laufe(q, z).code, 0);
    schreibe(q, "scripts/a.mjs", "export const a = 2;\n");
    assert.equal(laufe(q, z).code, 0);
    assert.equal(lies(z, "scripts/a.mjs"), "export const a = 2;\n");
  });
});

describe("Vorlagen im Sync und im Drift-Gate", { timeout: 30_000 }, () => {
  test("fehlende Vorlage wird angelegt und steht nicht im Stand", () => {
    const q = baueQuelle();
    const z = tmp();
    const r = laufe(q, z);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /neu \(Vorlage\): \.github\/dependabot\.yml/);
    assert.equal(lies(z, ".github/dependabot.yml"), DEP_QUELLE);
    const stand = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    assert.ok(!(".github/dependabot.yml" in stand.einheiten));
  });
  test("eigene Fassung bleibt byte-gleich, kein ABGLEICH, Drift-Gate bleibt grün nach Handänderung", () => {
    const q = baueQuelle();
    const z = tmp();
    schreibe(z, ".github/dependabot.yml", "version: 2\n# eigene Fassung\n");
    const r = laufe(q, z);
    assert.equal(r.code, 0, r.err);
    assert.doesNotMatch(r.err + r.out, /ABGLEICH/);
    assert.equal(lies(z, ".github/dependabot.yml"), "version: 2\n# eigene Fassung\n");
    const manifestText = lies(z, ".factory/besitz.json");
    const stand = lies(z, ".factory/sync-stand.json");
    const standObj = JSON.parse(stand) as { quelle: object };
    const gruen = (text: string | null): string[] => drift.pruefeDrift((p) => (p === ".github/dependabot.yml" ? text : p === ".factory/besitz.json" ? manifestText : p === ".factory/sync-stand.json" ? JSON.stringify({ ...standObj, quelle: { commit: "a", tag: "v1", sauber: true }, manifest: lib.textHash(manifestText), einheiten: (JSON.parse(stand) as { einheiten: object }).einheiten }) : lies(z, p))).fehler;
    assert.deepEqual(gruen("ganz anders\n"), []);
    assert.deepEqual(gruen(null), []);
  });
  test("alter Stand mit Vorlagen-ID: Hinweis im Sync, Gate meldet 'ist aber Vorlage'", () => {
    const q = baueQuelle();
    const z = tmp();
    assert.equal(laufe(q, z).code, 0);
    const stand = JSON.parse(lies(z, ".factory/sync-stand.json")) as { einheiten: Record<string, string> };
    stand.einheiten[".github/dependabot.yml"] = "x";
    schreibe(z, ".factory/sync-stand.json", JSON.stringify(stand));
    const r = laufe(q, z);
    assert.equal(r.code, 0, r.err);
    assert.match(r.out, /Einheit '\.github\/dependabot\.yml' ist jetzt Vorlage/);
    const manifestText = lies(z, ".factory/besitz.json");
    const f = drift.pruefeDrift((p) => (p === ".factory/sync-stand.json" ? JSON.stringify({ version: 2, quelle: { commit: "a", tag: "v1", sauber: true }, manifest: lib.textHash(manifestText), einheiten: { ".github/dependabot.yml": "x" } }) : p === ".factory/besitz.json" ? manifestText : null)).fehler;
    assert.match(f.join("|"), /\.github\/dependabot\.yml: im Sync-Stand, ist aber Vorlage/);
  });
  test("das Manifest fehlt, ist kein JSON oder hat keine Liste: ein roter Befund mit der einheitlichen Meldung", () => {
    const stand = (m: string) => JSON.stringify({ version: 2, quelle: { commit: "a", tag: "v1", sauber: true }, manifest: lib.textHash(m), einheiten: {} });
    const pruefe = (text: string | null) => drift.pruefeDrift((p) => (p === ".factory/sync-stand.json" ? stand(text ?? "") : p === ".factory/besitz.json" ? text : null)).fehler.join("|");
    assert.match(pruefe(null), /\.factory\/besitz\.json fehlt/);
    assert.match(pruefe("kein json"), /\.factory\/besitz\.json ist kein gültiges JSON/);
    assert.match(pruefe('{"version":2}'), /\.factory\/besitz\.json hat keine Liste 'eintraege'/);
    const abweichend = drift.pruefeDrift((p) => (p === ".factory/sync-stand.json" ? stand("x") : p === ".factory/besitz.json" ? "kein json" : null)).fehler.join("|");
    assert.match(abweichend, /weicht vom Sync-Stand ab/, "der Hash-Vergleich kommt vor dem JSON-Fehler");
  });
  test("ein Rollen-Pfad als Vorlage ist ein Fehler (nichts geschrieben)", () => {
    const q = baueQuelle();
    const z = tmp();
    const rolle = ROLLEN[0]?.pfad ?? "";
    const m = { ...MANIFEST, eintraege: MANIFEST.eintraege.map((e) => (e.pfad === rolle ? { ...e, art: "vorlage" } : e)) };
    schreibe(q, ".factory/besitz.json", JSON.stringify(m));
    const r = laufe(q, z);
    assert.equal(r.code, 1);
    assert.match(r.err, /Rollen-Pfad/);
    assert.ok(!existsSync(join(z, ".factory/sync-stand.json")));
  });
  test("der echte Manifest-Eintrag .github/dependabot.yml ist eine Vorlage", () => {
    const m = JSON.parse(readFileSync(join(WURZEL, ".factory/besitz.json"), "utf8")) as { eintraege: Eintrag[] };
    const e = m.eintraege.find((x) => x.pfad === ".github/dependabot.yml");
    assert.equal(e?.art, "vorlage");
  });
});
