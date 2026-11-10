import { describe, expect, test } from "vitest";
import { ESLint } from "eslint";

/** Wächter (factory#260): die Repo-Config meldet fehlenden Leerraum um Operatoren (`const x =1`), sonst bleiben solche Reste ungesehen. */
describe("Lint: space-infix-ops", () => {
  const lint = async (code: string) => {
    const eslint = new ESLint({ cwd: process.cwd() });
    const [r] = await eslint.lintText(code, { filePath: "scripts/lint-leerraum-probe.mjs" });
    return r.messages.map((m) => m.ruleId);
  };
  test("`const x =1;` wird gemeldet, `const x = 1;` nicht", async () => {
    expect(await lint("const x =1;\nexport { x };\n")).toContain("space-infix-ops");
    expect(await lint("const x = 1;\nexport { x };\n")).not.toContain("space-infix-ops");
  });
});
