// Einstieg: node scripts/codex-setup.mjs --langfuse-url <MCP-URL> [--write].
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { setupDateien, schreibeSetup } from "./codex-lib.mjs";

export function main(argv = process.argv.slice(2), root = fileURLToPath(new URL("../", import.meta.url)), out = console.log, err = console.error) {
  const { werte, fehler } = flagsLesen(argv, { "langfuse-url": { type: "string" }, write: { type: "boolean" } }, { pflicht: ["langfuse-url"] });
  if (fehler) { err(fehler.text); return 2; }
  try {
    const dateien = setupDateien(JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8")), ladeProjektConfig({ rootDir: root }), werte["langfuse-url"]);
    const pfade = werte.write ? schreibeSetup(root, dateien) : Object.keys(dateien);
    out(JSON.stringify({ geschrieben: werte.write === true, dateien: pfade, autonom: false }));
    return 0;
  } catch (e) { err(`Codex-Setup gestoppt: ${e.message}`); return 1; }
}
if (istDirektaufruf(import.meta.url)) process.exitCode = main();
