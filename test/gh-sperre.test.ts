/* gh-Sperre in Vitest (factory#560): die pure Funktion ghSperrePfad legt eine gh-Attrappe an und stellt ihren Ordner vor PATH. Hier nur die reinen Teile; die Setup-Datei (gh-sperre-setup.ts) wirkt über vite.config.ts. */
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { ghSperrePfad, GH_SPERRE_MELDUNG } from "./support/gh-sperre";

const angelegt: string[] = [];
const frisch = () => {
  const d = mkdtempSync(join(tmpdir(), "gh-sperre-test-"));
  angelegt.push(d);
  return d;
};
afterEach(() => {
  for (const d of angelegt.splice(0)) rmSync(d, { recursive: true, force: true });
});

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
    const tmp = frisch();
    const erst = ghSperrePfad({ PATH: "/bin" }, tmp, "linux")!;
    const zweit = ghSperrePfad({ PATH: erst.path, FACTORY_ORIGINAL_PATH: "/bin" }, tmp, "linux")!;
    expect(zweit.path).toBe(erst.path);
    expect(zweit.originalPath).toBe("/bin");
  });

  it("idempotent auch ohne gemerkten Original-PATH und wenn PATH genau der Sperr-Ordner ist", () => {
    const tmp = frisch();
    const erst = ghSperrePfad({}, tmp, "linux")!;
    const zweit = ghSperrePfad({ PATH: erst.dir }, tmp, "linux")!;
    expect(zweit.path).toBe(erst.dir);
    expect(zweit.originalPath).toBe("");
  });

  it("legt unter win32 zusätzlich gh.cmd an, unter linux nicht", () => {
    const r = ghSperrePfad({ PATH: "C:\\x" }, frisch(), "win32")!;
    const cmd = readFileSync(join(r.dir, "gh.cmd"), "utf8");
    expect(cmd).toContain(GH_SPERRE_MELDUNG);
    expect(cmd).toMatch(/exit \/b 1/u);
    expect(existsSync(join(ghSperrePfad({ PATH: "/bin" }, frisch(), "linux")!.dir, "gh.cmd"))).toBe(false);
  });

  it("FACTORY_GH_ECHT=1 erlaubt das echte gh: keine Sperre (null)", () => {
    expect(ghSperrePfad({ PATH: "/bin", FACTORY_GH_ECHT: "1" }, frisch(), "linux")).toBeNull();
  });

  it("ohne PATH steht nur der Sperr-Ordner", () => {
    const r = ghSperrePfad({}, frisch(), "linux")!;
    expect(r.path).toBe(r.dir);
    expect(r.originalPath).toBe("");
  });

  it("ein unveränderter Aufruf schreibt die Attrappe nicht neu (gleiche Datei, gleicher Inode)", () => {
    const tmp = frisch();
    const r = ghSperrePfad({ PATH: "/bin" }, tmp, "linux")!;
    const vorher = lstatSync(join(r.dir, "gh")).ino;
    ghSperrePfad({ PATH: "/bin" }, tmp, "linux");
    expect(lstatSync(join(r.dir, "gh")).ino).toBe(vorher);
  });
});

describe("ghSperrePfad: vorbelegter Ordner (Missbrauch im geteilten Temp)", () => {
  const ordnerName = () => `factory-gh-attrappe-${process.getuid?.() ?? "u"}`;

  it("ein Symlink statt des Ordners bricht ab", () => {
    const tmp = frisch();
    const ziel = join(tmp, "fremd");
    mkdirSync(ziel);
    symlinkSync(ziel, join(tmp, ordnerName()));
    expect(() => ghSperrePfad({ PATH: "/bin" }, tmp, "linux")).toThrow(/kein echter Ordner/);
  });

  it("ein für andere beschreibbarer Ordner bricht ab", () => {
    const tmp = frisch();
    const dir = join(tmp, ordnerName());
    mkdirSync(dir);
    chmodSync(dir, 0o777);
    expect(() => ghSperrePfad({ PATH: "/bin" }, tmp, "linux")).toThrow(/beschreibbar/);
  });

  it("ein für die Gruppe beschreibbarer Ordner bricht ab", () => {
    const tmp = frisch();
    const dir = join(tmp, ordnerName());
    mkdirSync(dir);
    chmodSync(dir, 0o770);
    expect(() => ghSperrePfad({ PATH: "/bin" }, tmp, "linux")).toThrow(/beschreibbar/);
  });

  it.skipIf(process.getuid === undefined)("ein Ordner eines anderen Nutzers bricht ab (uid injiziert)", () => {
    const tmp = frisch();
    const uid = process.getuid!() + 1;
    mkdirSync(join(tmp, `factory-gh-attrappe-${uid}`), { mode: 0o700 });
    expect(() => ghSperrePfad({ PATH: "/bin" }, tmp, "linux", uid)).toThrow(/anderen Nutzer/);
  });

  it.skipIf(process.getuid === undefined)("eigene uid injiziert: Ordner endet auf -<uid>, ohne uid auf -u", () => {
    const uid = process.getuid!();
    const tmp = frisch();
    const mit = ghSperrePfad({ PATH: "/bin" }, tmp, "linux", uid);
    expect(mit).not.toBeNull();
    expect(readdirSync(tmp)).toContain(`factory-gh-attrappe-${uid}`);
    const tmp2 = frisch();
    ghSperrePfad({ PATH: "/bin" }, tmp2, "linux", undefined);
    expect(readdirSync(tmp2)).toContain("factory-gh-attrappe-u");
  });

  it("ein Symlink als gh-Datei mit gleichem Inhalt wird trotzdem durch eine echte Datei ersetzt", () => {
    const tmp = frisch();
    const dir = join(tmp, ordnerName());
    ghSperrePfad({ PATH: "/bin" }, tmp, "linux");
    const inhalt = readFileSync(join(dir, "gh"), "utf8");
    const opfer = join(tmp, "opfer2.txt");
    writeFileSync(opfer, inhalt);
    rmSync(join(dir, "gh"));
    symlinkSync(opfer, join(dir, "gh"));
    ghSperrePfad({ PATH: "/bin" }, tmp, "linux");
    expect(lstatSync(join(dir, "gh")).isSymbolicLink()).toBe(false);
  });

  it("ein Symlink als gh-Datei wird ersetzt, das Ziel bleibt unberührt", () => {
    const tmp = frisch();
    const opfer = join(tmp, "opfer.txt");
    writeFileSync(opfer, "unberührt");
    const dir = join(tmp, ordnerName());
    mkdirSync(dir, { mode: 0o700 });
    symlinkSync(opfer, join(dir, "gh"));
    ghSperrePfad({ PATH: "/bin" }, tmp, "linux");
    expect(readFileSync(opfer, "utf8")).toBe("unberührt");
    expect(lstatSync(join(dir, "gh")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(dir, "gh"), "utf8")).toContain(GH_SPERRE_MELDUNG);
  });
});
