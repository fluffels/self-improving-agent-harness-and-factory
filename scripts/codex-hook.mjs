// Native PreToolUse-Registrierung und separater Guardprozess des geschützten Hosts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { bewerteAktion } from "./codex-hook-lib.mjs";

export function pruefeHook(text, root, config) {
  try { return bewerteAktion(JSON.parse(text), root, config); }
  catch (e) { return { entscheidung: "deny", grund: e.message }; }
}
if (istDirektaufruf(import.meta.url)) {
  let ergebnis;
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    ergebnis = pruefeHook(readFileSync(0, "utf8"), root, ladeProjektConfig({ rootDir: root }));
  } catch (e) { ergebnis = { entscheidung: "deny", grund: e.message }; }
  const native = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: ergebnis.entscheidung, permissionDecisionReason: ergebnis.grund ?? "Vollständig geprüft" } };
  console.log(JSON.stringify(process.argv.includes("--host") ? ergebnis : native));
  process.exitCode = ergebnis.entscheidung === "allow" ? 0 : 2;
}
