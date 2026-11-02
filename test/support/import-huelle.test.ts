import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { importHuelle } from "./import-huelle";

describe("importHuelle", () => {
  const quellen: Record<string, string> = {
    "s/a.mjs": 'import { x } from "node:fs";\nimport { y } from "./b.mjs";',
    "s/b.mjs": 'import { z } from "node:path";',
    "s/c.mjs": 'import { y } from "./fremd-paket";\nimport q from "lodash";',
  };
  test("Hülle folgt relativen Importen, ignoriert node:", () => {
    assert.deepEqual(importHuelle("s/a.mjs", (p) => quellen[p] ?? ""), ["s/a.mjs", "s/b.mjs"]);
  });
  test("Hülle folgt zyklischen und mehrfach erreichten Importen, jede Datei einmal", () => {
    const zyklus: Record<string, string> = { "s/x.mjs": 'import a from "./y.mjs";', "s/y.mjs": 'import b from "./x.mjs";' };
    assert.deepEqual(importHuelle("s/x.mjs", (p) => zyklus[p] ?? ""), ["s/x.mjs", "s/y.mjs"]);
    const diamant: Record<string, string> = { "s/a.mjs": 'import b from "./b.mjs";\nimport c from "./c.mjs";', "s/b.mjs": 'import c from "./c.mjs";', "s/c.mjs": "" };
    assert.deepEqual(importHuelle("s/a.mjs", (p) => diamant[p] ?? ""), ["s/a.mjs", "s/b.mjs", "s/c.mjs"]);
  });
  test("Hülle folgt einem Import aus dem Elternordner (zählt als relativ)", () => {
    const eltern: Record<string, string> = { "s/a.mjs": 'import b from "../lib/b.mjs";', "lib/b.mjs": "" };
    assert.deepEqual(importHuelle("s/a.mjs", (p) => eltern[p] ?? ""), ["lib/b.mjs", "s/a.mjs"]);
  });
  test("ein Paketimport bricht ab", () => {
    assert.throws(() => importHuelle("s/c.mjs", (p) => quellen[p] ?? ""), /weder node: noch relativ/);
  });
});
