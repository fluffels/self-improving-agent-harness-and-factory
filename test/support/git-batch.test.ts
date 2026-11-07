/* basisTexte (factory#220 L37): Texte mehrerer Pfade der Diff-Basis in einem Aufruf `git cat-file --batch`. */
import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { basisTexte } from "./git-batch";

const ordner: string[] = [];
afterAll(() => {
  for (const d of ordner.splice(0)) rmSync(d, { recursive: true, force: true });
});

const KONFIG = ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false"];
const aufbau = () => {
  const root = mkdtempSync(join(tmpdir(), "git-batch-"));
  ordner.push(root);
  const g = (args: string[]): string => execFileSync("git", [...KONFIG, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g(["init", "-q", "-b", "main"]);
  const datei: Record<string, string> = {
    "a.txt": "eins\nzwei\n",
    "sub/ümläut ß 日本.txt": "Grüße: äöüß 日本語 😀\n",
    "leer.txt": "",
  };
  for (const [p, t] of Object.entries(datei)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  g(["add", "-A"]);
  g(["commit", "-q", "-m", "basis"]);
  return { root, g, datei };
};
const gitBatch = (root: string) => (args: string[], input: Buffer): Buffer => execFileSync("git", args, { cwd: root, input, maxBuffer: 64 * 1024 * 1024 });

describe("basisTexte", () => {
  test("vorhandene Dateien liefern ihren Text, eine in der Basis fehlende Datei null (missing)", () => {
    const { root, datei } = aufbau();
    const m = basisTexte(gitBatch(root), "HEAD", ["a.txt", "gibtsnicht.txt"]);
    assert.deepEqual([...m], [["a.txt", datei["a.txt"]], ["gibtsnicht.txt", null]]);
  });

  test("Umlaute und Mehrbyte-Zeichen: die Länge zählt Bytes, der Pfad mit Umlaut stimmt, der Folgeeintrag bleibt unverschoben", () => {
    const { root, datei } = aufbau();
    const p = "sub/ümläut ß 日本.txt";
    const m = basisTexte(gitBatch(root), "HEAD", [p, "a.txt", "leer.txt"]);
    assert.equal(m.get(p), datei[p]);
    assert.equal(m.get("a.txt"), datei["a.txt"]);
    assert.equal(m.get("leer.txt"), "");
  });

  test("eine leere Datei ist der leere Text, nicht null; ohne Pfade bleibt die Map leer ohne Git-Aufruf", () => {
    const { root } = aufbau();
    assert.equal(basisTexte(gitBatch(root), "HEAD", ["leer.txt"]).get("leer.txt"), "");
    const nie = (): Buffer => {
      throw new Error("kein Aufruf erwartet");
    };
    assert.equal(basisTexte(nie, "HEAD", []).size, 0);
  });

  test("ein Aufruf für alle Pfade, die Eingabe nennt basis:pfad zeilenweise", () => {
    const { root } = aufbau();
    const aufrufe: { args: string[]; input: string }[] = [];
    const real = gitBatch(root);
    basisTexte((args, input) => {
      aufrufe.push({ args, input: input.toString("utf8") });
      return real(args, input);
    }, "HEAD", ["a.txt", "leer.txt"]);
    assert.deepEqual(aufrufe, [{ args: ["cat-file", "--batch"], input: "HEAD:a.txt\nHEAD:leer.txt\n" }]);
  });
});
