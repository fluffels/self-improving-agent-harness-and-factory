/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#572, Kind von factory#518): Analyse-Skripte sind Fabrik-eigen.
 *
 * Geschlossene Liste `FABRIK_EIGEN`: die Fabrik-eigenen Dateien der Token-Analyse (Wirkungsprüfung des Änderungsregisters, Freigabe), die nie an Bezieher verteilt werden und dort nie laufen.
 * (a) Kein Eintrag in `.factory/besitz.json` trifft einen Pfad der Liste (auch kein Verzeichnis-Präfix).
 * (b) Keine verteilte Datei (jede Endung, auch Hooks ohne Endung) importiert oder nennt eine Datei der Liste (Dateiname mit und ohne Endung).
 * (c) Jedes Einstiegsskript sperrt im Bezieher: `art: "skript"` (Sperre nach dem Arbeitsverzeichnis) läuft in einem Fixture mit `.factory/sync-stand.json` und endet mit Exit ≠ 0 und einer Meldung;
 *     `art: "skript-wurzel"` (Sperre nach dem Repo des Skripts) wird in-process mit einer Bezieher-Wurzel aufgerufen und bricht mit Code ≠ 0 ab; beide statisch über `istBezieher(`.
 *     Jede Datei der Liste mit `istDirektaufruf(` muss als Einstieg eingetragen sein. Grenze: berechnete Pfade bleiben unentdeckt.
 * Spätere Kinder von factory#518 erweitern die Liste (neue Zeile; ein Einstiegsskript verlangt (c)).
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as besitzModul from "../../scripts/besitz-lib.mjs";
import { ladeBesitzManifest } from "../support/besitz-anker";
import { fixture } from "../support/tmp-fixture";

const WURZEL = join(__dirname, "..", "..");
const { wirdVerteilt } = besitzModul as unknown as { wirdVerteilt: (e: { ring: string }) => boolean };

/** `skript`: sperrt auch nach dem Arbeitsverzeichnis (Lauf im Bezieher-Fixture bricht ab); `skript-wurzel`: sperrt nach dem Repo des Skripts (nur statisch belegt: `istBezieher(`); `lib`, `daten`: kein Einstieg. */
type Art = "skript" | "skript-wurzel" | "lib" | "daten";
const FABRIK_EIGEN: { pfad: string; art: Art }[] = [
  { pfad: "scripts/aenderungsregister.mjs", art: "skript" },
  { pfad: "scripts/aenderungsregister-lib.mjs", art: "lib" },
  { pfad: ".github/aenderungsregister.json", art: "daten" },
  { pfad: "scripts/token-analyse-freigabe.mjs", art: "skript-wurzel" },
  { pfad: "scripts/token-analyse-freigabe-lib.mjs", art: "lib" },
];

/** Pur: Einträge des Manifests, die einen Pfad der Liste treffen (gleicher Pfad oder Verzeichnis-Präfix). */
const treffer = (eintraege: { pfad: string }[], liste: { pfad: string }[]) =>
  eintraege.filter((e) => liste.some((f) => f.pfad === e.pfad || f.pfad.startsWith(e.pfad.endsWith("/") ? e.pfad : `${e.pfad}/`)));

/** Pur: verteilte Dateien (Pfad → Text), die den Dateinamen einer Datei der Liste nennen, mit oder ohne Endung. */
const nennungen = (dateien: Record<string, string>, liste: { pfad: string }[]) =>
  Object.entries(dateien).flatMap(([pfad, text]) =>
    liste.filter((f) => text.includes(basename(f.pfad).replace(/\.[^.]+$/, ""))).map((f) => `${pfad} nennt ${f.pfad}`),
  );

describe("Fabrik-eigene Analyse-Dateien (factory#518)", () => {
  it("die Liste ist nicht leer und jede Datei existiert", () => {
    expect(FABRIK_EIGEN.length).toBeGreaterThan(0);
    for (const f of FABRIK_EIGEN) expect(existsSync(join(WURZEL, f.pfad)), f.pfad).toBe(true);
  });

  it("(a) kein Eintrag in .factory/besitz.json trifft einen Pfad der Liste", () => {
    expect(treffer(ladeBesitzManifest().eintraege, FABRIK_EIGEN).map((e) => e.pfad)).toEqual([]);
  });
  it("(a) Selbsttest: ein Manifest-Eintrag auf Datei oder Verzeichnis wird erkannt", () => {
    expect(treffer([{ pfad: "scripts/aenderungsregister.mjs" }], FABRIK_EIGEN)).toHaveLength(1);
    expect(treffer([{ pfad: ".github" }], FABRIK_EIGEN)).toHaveLength(1);
    expect(treffer([{ pfad: "scripts/anderes.mjs" }], FABRIK_EIGEN)).toHaveLength(0);
  });

  it("(b) keine verteilte Datei importiert oder nennt eine Datei der Liste", () => {
    const verteilt = [...new Set(ladeBesitzManifest().eintraege.filter(wirdVerteilt).map((e) => e.pfad))].filter((p) => existsSync(join(WURZEL, p)) && statSync(join(WURZEL, p)).isFile());
    expect(verteilt.length).toBeGreaterThan(50); // Leerlauf-Schutz: der Scan sieht den verteilten Besitz
    const dateien = Object.fromEntries(verteilt.map((p) => [p, readFileSync(join(WURZEL, p), "utf8")]));
    expect(nennungen(dateien, FABRIK_EIGEN)).toEqual([]);
  });
  it("(b) Selbsttest: eine Nennung im Import oder im Text wird rot", () => {
    expect(nennungen({ "scripts/x.mjs": 'import { a } from "./aenderungsregister-lib.mjs";' }, FABRIK_EIGEN)).not.toHaveLength(0);
    expect(nennungen({ "docs/x.md": "siehe `node scripts/aenderungsregister.mjs`" }, FABRIK_EIGEN)).not.toHaveLength(0);
    expect(nennungen({ "docs/x.md": "nichts dergleichen" }, FABRIK_EIGEN)).toHaveLength(0);
    expect(nennungen({ ".githooks/x": "# node scripts/token-analyse-freigabe.mjs" }, FABRIK_EIGEN)).toHaveLength(1); // Datei ohne Endung
    expect(nennungen({ "docs/x.md": "siehe `token-analyse-freigabe`" }, FABRIK_EIGEN)).toHaveLength(1); // Nennung ohne Endung
  });

  it("(c) jedes Einstiegsskript der Liste sperrt den Lauf im Bezieher", () => {
    const einstiege = FABRIK_EIGEN.filter((x) => x.art === "skript" || x.art === "skript-wurzel");
    expect(einstiege.length).toBeGreaterThan(1);
    for (const f of einstiege) expect([f.pfad, /istBezieher\(/.test(readFileSync(join(WURZEL, f.pfad), "utf8"))]).toEqual([f.pfad, true]);
  });

  it("(c) jede Datei der Liste mit istDirektaufruf ist als Einstiegsskript eingetragen", () => {
    for (const f of FABRIK_EIGEN) {
      if (!readFileSync(join(WURZEL, f.pfad), "utf8").includes("istDirektaufruf(")) continue;
      expect([f.pfad, f.art === "skript" || f.art === "skript-wurzel"]).toEqual([f.pfad, true]);
    }
  });
  it("(c) skript-wurzel: der Einstieg bricht in-process mit einer Bezieher-Wurzel ab", async () => {
    const wurzel = fixture({ ".factory/sync-stand.json": "{}\n" });
    const freigabe = (await import("../../scripts/token-analyse-freigabe.mjs")) as { cli: (a: string[], e: Record<string, string>, d: { repoWurzel: string }) => { code: number; zeilen: string[] } };
    const r = freigabe.cli(["pruefen"], {}, { repoWurzel: wurzel });
    expect(r.code).not.toBe(0);
    expect(r.zeilen.join(" ")).toContain("Fabrik");
  });

  describe("(c) jedes Skript der Liste bricht im Bezieher ab", () => {
    for (const f of FABRIK_EIGEN.filter((x) => x.art === "skript")) {
      it(f.pfad, () => {
        const cwd = fixture({ ".factory/sync-stand.json": "{}\n" });
        let exit = 0;
        let ausgabe = "";
        try {
          execFileSync(process.execPath, [join(WURZEL, f.pfad)], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        } catch (e) {
          const err = e as { status: number; stdout: string; stderr: string };
          exit = err.status;
          ausgabe = `${err.stdout}${err.stderr}`;
        }
        expect(exit).not.toBe(0);
        expect(ausgabe).toContain("fabrik-eigen");
      });
    }
  });
});
