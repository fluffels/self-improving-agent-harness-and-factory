import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { quelleMitBareKlon } from "./git-quelle";

describe("quelleMitBareKlon", () => {
  it("legt die Quelle an, committet ohne Hintergrund-Wartung und klont danach bare (factory#383)", () => {
    const aufrufe: { cwd: string; args: string[] }[] = [];
    const dateien: string[] = [];
    const git = (cwd: string, ...args: string[]) => void aufrufe.push({ cwd, args });
    quelleMitBareKlon(git, join("/b", "quelle"), join("/b", "origin.git"), { mkdir: () => undefined, schreibe: (p) => void dateien.push(p) });
    const namen = aufrufe.map((a) => a.args.find((x) => ["init", "add", "commit", "clone"].includes(x)));
    expect(namen).toEqual(["init", "add", "commit", "clone"]);
    const commit = aufrufe[2].args;
    expect(commit.slice(0, 4)).toEqual(["-c", "maintenance.auto=false", "-c", "gc.auto=0"]);
    expect(commit.slice(4)).toEqual(["commit", "-q", "-m", "init"]);
    expect(aufrufe[3]).toEqual({ cwd: "/b", args: ["clone", "-q", "--bare", join("/b", "quelle"), join("/b", "origin.git")] });
    expect(dateien).toEqual([join("/b", "quelle", "README.md")]);
  });

  it("echter Lauf: das Bare-Repo hat genau einen Commit", () => {
    const basis = realpathSync.native(mkdtempSync(join(tmpdir(), "git-quelle-")));
    try {
      const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd, encoding: "utf8", stdio: "pipe" });
      const ziel = join(basis, "origin.git");
      quelleMitBareKlon(git, join(basis, "quelle"), ziel);
      expect(dirname(ziel)).toBe(basis);
      expect(git(ziel, "rev-list", "--count", "main").trim()).toBe("1");
    } finally {
      rmSync(basis, { recursive: true, force: true });
    }
  });
});
