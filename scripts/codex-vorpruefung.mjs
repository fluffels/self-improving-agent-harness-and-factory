// Einstieg: node scripts/codex-vorpruefung.mjs [--belege <JSON-Datei>]. Rein lesend.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { bewerteBelege, lokaleHookMaengel, lokaleRollenMaengel } from "./codex-lib.mjs";
import { werkzeugMaengel } from "./werkzeug-lib.mjs";
import { FREIGABEN, freigabeMaengel } from "./codex-freigaben.mjs";

/** Installierte Codex-CLI-Version (`x.y.z`) oder `null`; wirft nie, gibt die Rohausgabe nie zurück. */
export function installierteCodexVersion({ plattform = process.platform, spawn = spawnSync } = {}) {
  const win = plattform === "win32";
  const r = spawn(win ? "codex.cmd" : "codex", ["--version"], { shell: win, encoding: "utf8", timeout: 10000, windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return /(?<![\w.])(\d+\.\d+\.\d+)(?![\w.])/.exec(String(r.stdout))?.[1] ?? null;
}

function lokaleMaengel(root, config) {
  const hooks = lokaleHookMaengel(root); // immer: auch ohne Rollen-Ordner muss der Hook-Schutz stehen (factory#364)
  if (!existsSync(join(root, ".codex", "agents"))) return hooks;
  return [...lokaleRollenMaengel(root, config, JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"))), ...hooks];
}

export function main(argv = process.argv.slice(2), { out = console.log, err = console.error, lade = ladeProjektConfig, root = fileURLToPath(new URL("../", import.meta.url)), werkzeug = (r, l) => werkzeugMaengel({ root: r, lade: l }), codexVersion = installierteCodexVersion, freigaben = FREIGABEN } = {}) {
  const { werte, fehler } = flagsLesen(argv, { belege: { type: "string" } });
  if (fehler) { err(fehler.text); return 2; }
  try {
    const belege = werte.belege ? JSON.parse(readFileSync(werte.belege, "utf8")) : {};
    const config = lade();
    const maengel = bewerteBelege(belege, config);
    maengel.push(...lokaleMaengel(root, config));
    maengel.push(...werkzeug(root, lade).map((m) => `Werkzeug-Vorprüfung: ${m.text} (Fix: ${m.fix})`));
    maengel.push(...freigabeMaengel({ installiert: codexVersion(), belegt: belege?.version, tabelle: freigaben }));
    const autonom = maengel.length === 0;
    out(JSON.stringify({ autonom, maengel }));
    return autonom ? 0 : 1;
  } catch (e) { err(`Codex-Vorprüfung gestoppt: ${e.message}`); return 1; }
}
if (istDirektaufruf(import.meta.url)) process.exitCode = main();
