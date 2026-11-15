/* gh-Sperre in Vitest (factory#560): die pure Funktion ghSperrePfad legt eine gh-Attrappe an und stellt ihren Ordner vor PATH. Hier nur die reinen Teile; die Setup-Datei (gh-sperre-setup.ts) wirkt über vite.config.ts. */
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { ghSperrePfad, GH_SPERRE_MELDUNG } from "./support/gh-sperre";

const frisch = () => mkdtempSync(join(tmpdir(), "gh-sperre-test-"));

describe("ghSperrePfad", () => {
  it("legt ein ausführbares gh an, das mit Exit 1 und der Meldung endet", () => {
    const r = ghSperrePfad({ PATH: "/bin" }, frisch(), "linux");
    expect(r).not.toBeNull();
    const datei = join(r!.dir, "gh");
    expect(statSync(datei).mode & 0o111).not.toBe(0);
    const lauf = spawnSync(datei, ["api", "user"], { encoding: "utf8" });
    expect(lauf.status).toBe(1);
    expect(lauf.stderr).toContain(GH_SPERRE_MELDUNG);
    expect(GH_SPERRE_MELDUNG).toBe("gh in Vitest gesperrt (Naht injizieren)");
  });

  it("stellt den Ordner vor PATH und merkt den Original-PATH", () => {
    const r = ghSperrePfad({ PATH: "/bin" }, frisch(), "linux");
    expect(r!.path).toBe(`${r!.dir}${delimiter}/bin`);
    expect(r!.originalPath).toBe("/bin");
  });

  it("ist idempotent: steht der Ordner schon vorn, bleibt PATH und der gemerkte Original-PATH gilt", () => {
    const dir = frisch();
    const erst = ghSperrePfad({ PATH: "/bin" }, dir, "linux")!;
    const zweit = ghSperrePfad({ PATH: erst.path, FACTORY_ORIGINAL_PATH: "/bin" }, dir, "linux")!;
    expect(zweit.path).toBe(erst.path);
    expect(zweit.originalPath).toBe("/bin");
  });

  it("legt unter win32 zusätzlich gh.cmd an", () => {
    const r = ghSperrePfad({ PATH: "C:\\x" }, frisch(), "win32")!;
    const cmd = readFileSync(join(r.dir, "gh.cmd"), "utf8");
    expect(cmd).toContain(GH_SPERRE_MELDUNG);
    expect(cmd).toMatch(/exit \/b 1/u);
  });

  it("FACTORY_GH_ECHT=1 erlaubt das echte gh: keine Sperre (null)", () => {
    expect(ghSperrePfad({ PATH: "/bin", FACTORY_GH_ECHT: "1" }, frisch(), "linux")).toBeNull();
  });

  it("ohne PATH steht nur der Sperr-Ordner", () => {
    const r = ghSperrePfad({}, frisch(), "linux")!;
    expect(r.path).toBe(r.dir);
    expect(r.originalPath).toBe("");
  });
});
