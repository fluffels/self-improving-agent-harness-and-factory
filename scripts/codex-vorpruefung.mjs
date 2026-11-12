// Einstieg: node scripts/codex-vorpruefung.mjs [--belege <JSON-Datei>]. Rein lesend; GET auf den Langfuse-Health-Endpunkt (Tracing-Ausfallstopp, factory#365).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { bewerteBelege, lokaleHookMaengel, lokaleRollenMaengel } from "./codex-lib.mjs";
import { werkzeugMaengel } from "./werkzeug-lib.mjs";
import { FREIGABEN, freigabeMaengel } from "./codex-freigaben.mjs";
import { FRIST_MS, pruefeLangfuseAusUmgebung } from "./langfuse-health.mjs";

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

const TRACING_FIX = "Fix: Langfuse starten, dann node scripts/codex-vorpruefung.mjs erneut; ohne Langfuse startet kein Codex-Lauf";

/** Tracing-Ausfallstopp: `[]` bei erreichbarem Langfuse, sonst ein Mangel „Tracing-Ausfall“ (auch bei werfender Prüfung). */
export async function tracingMaengel({ fetchImpl = fetch, fristMs = FRIST_MS, env = process.env, home = homedir(), lies } = {}) {
  try {
    const urteil = await pruefeLangfuseAusUmgebung({ env, home, lies, fetchImpl, fristMs });
    return urteil.ok ? [] : [`Tracing-Ausfall: ${urteil.grund} (${TRACING_FIX})`];
  } catch (e) {
    return [`Tracing-Ausfall: Health-Prüfung gescheitert (${String(e?.message ?? e)}) (${TRACING_FIX})`];
  }
}

export async function main(argv = process.argv.slice(2), { out = console.log, err = console.error, lade = ladeProjektConfig, root = fileURLToPath(new URL("../", import.meta.url)), werkzeug = (r, l) => werkzeugMaengel({ root: r, lade: l }), codexVersion = installierteCodexVersion, freigaben = FREIGABEN, ...tracing } = {}) {
  const { werte, fehler } = flagsLesen(argv, { belege: { type: "string" } });
  if (fehler) { err(fehler.text); return 2; }
  try {
    const belege = werte.belege ? JSON.parse(readFileSync(werte.belege, "utf8")) : {};
    const config = lade();
    const maengel = bewerteBelege(belege, config);
    maengel.push(...lokaleMaengel(root, config));
    maengel.push(...werkzeug(root, lade).map((m) => `Werkzeug-Vorprüfung: ${m.text} (Fix: ${m.fix})`));
    maengel.push(...freigabeMaengel({ installiert: codexVersion(), belegt: belege?.version, tabelle: freigaben }));
    maengel.push(...(await tracingMaengel(tracing)));
    const autonom = maengel.length === 0;
    out(JSON.stringify({ autonom, maengel }));
    return autonom ? 0 : 1;
  } catch (e) { err(`Codex-Vorprüfung gestoppt: ${e.message}`); return 1; }
}
if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
