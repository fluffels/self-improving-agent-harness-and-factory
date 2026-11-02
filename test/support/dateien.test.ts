import { afterAll, describe, test } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dateienUnter } from "./dateien";

describe("dateienUnter", () => {
  const wurzel = mkdtempSync(join(tmpdir(), "dateien-"));
  mkdirSync(join(wurzel, "s", "tief", "tiefer"), { recursive: true });
  for (const n of ["s/a.mjs", "s/b.txt", "s/tief/c.mjs", "s/tief/tiefer/d.cjs"]) writeFileSync(join(wurzel, n), "");
  afterAll(() => rmSync(wurzel, { recursive: true, force: true }));
  test("findet Treffer rekursiv als Repo-Pfade, sortiert, und filtert nach Dateiname", () => {
    assert.deepEqual(dateienUnter(wurzel, "s", /\.(mjs|cjs)$/), ["s/a.mjs", "s/tief/c.mjs", "s/tief/tiefer/d.cjs"]);
    assert.deepEqual(dateienUnter(wurzel, "s", /\.mjs$/), ["s/a.mjs", "s/tief/c.mjs"]);
  });
  test("ein Verzeichnis, dessen Name den Filter trifft, ist kein Treffer", () => {
    mkdirSync(join(wurzel, "s", "x.mjs"));
    assert.deepEqual(dateienUnter(wurzel, "s", /\.mjs$/), ["s/a.mjs", "s/tief/c.mjs"]);
  });
  test("ein fehlender Ordner wirft", () => {
    assert.throws(() => dateienUnter(wurzel, "fehlt", /./));
  });
});
