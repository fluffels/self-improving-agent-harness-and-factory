// Native PreToolUse-Registrierung und separater Guardprozess des geschützten Hosts.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { bewerteAktion } from "./codex-hook-lib.mjs";
import { flagsLesen } from "./flag-lib.mjs";

export function pruefeHook(text, root, config) {
  try { return bewerteAktion(JSON.parse(text), root, config); }
  catch (e) { return { entscheidung: "deny", grund: e.message }; }
}
if (istDirektaufruf(import.meta.url)) {
  let ergebnis, host = false;
  try {
    const { werte, fehler } = flagsLesen(process.argv.slice(2), { host: { type: "boolean" } });
    if (fehler) throw new Error(fehler.text);
    host = werte.host === true;
    const root = fileURLToPath(new URL("../", import.meta.url));
    ergebnis = pruefeHook(readFileSync(0, "utf8"), root, ladeProjektConfig({ rootDir: root }));
  } catch (e) { ergebnis = { entscheidung: "deny", grund: e.message }; }
  const native = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: ergebnis.entscheidung, permissionDecisionReason: ergebnis.grund ?? "Vollständig geprüft" } };
  console.log(JSON.stringify(host ? ergebnis : native));
  process.exitCode = ergebnis.entscheidung === "allow" ? 0 : 2;
}
