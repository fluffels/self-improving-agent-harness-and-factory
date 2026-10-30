/* @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165). Skript-Laufzeiten (#101 L4c/L5e): EINE Tabelle in shell-tabellen.mjs für PowerShell-Guard und Stdin-Skript-Guard. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as tabRaw from "../../scripts/shell-tabellen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as stdinRaw from "../../scripts/stdin-skript-guard.mjs";

const T = tabRaw as unknown as { SKRIPT_LAUFZEITEN: string[]; NODE_LAUFZEITEN: string[]; PYTHON_LAUFZEITEN: string[] };
const blockt = (c: string) => (stdinRaw as unknown as { bewerteStdinSkript: (c: string) => { block: true } | null }).bewerteStdinSkript(c)?.block === true;
const quelle = (f: string) => readFileSync(new URL(`../../scripts/${f}`, import.meta.url), "utf8");

describe("SKRIPT_LAUFZEITEN", () => {
  test("Inhalt und Untermengen", () => {
    expect(T.SKRIPT_LAUFZEITEN).toEqual(["node", "nodejs", "python", "python3", "py", "perl", "ruby", "deno", "bun", "php"]);
    for (const n of [...T.NODE_LAUFZEITEN, ...T.PYTHON_LAUFZEITEN]) expect(T.SKRIPT_LAUFZEITEN, n).toContain(n);
    expect(T.NODE_LAUFZEITEN).toEqual(["node"]);
    expect(T.PYTHON_LAUFZEITEN).toEqual(["python", "python3", "py"]);
  });
  test("Stdin-Skript-Guard bezieht Node und Python aus der Tabelle, Python-Versionsnamen bleiben Familie", () => {
    for (const n of [...T.NODE_LAUFZEITEN, ...T.PYTHON_LAUFZEITEN, "python3.12"]) expect(blockt(`${n} - <<EOF\nx\nEOF`), n).toBe(true);
    for (const n of ["perl", "ruby", "nodejs", "python3x", "pythonx"]) expect(blockt(`${n} - <<EOF\nx\nEOF`), n).toBe(false);
  });
  test("keine zweite Namensliste in den Guards", () => {
    expect(quelle("worktree-guard-powershell.mjs")).toContain("SKRIPT_LAUFZEITEN.flatMap");
    expect(quelle("worktree-guard-powershell.mjs")).not.toContain('"nodejs"');
    expect(quelle("stdin-skript-guard.mjs")).not.toMatch(/python\(\?:3/);
  });
});
