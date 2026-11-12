// Kein Einstieg, kein Direktaufruf (Konvention quellprojekt#1398): Lib des Dispatchers `scripts/pretooluse-hook.mjs` (der Einstieg re-exportiert `dispatch`) und des
// Codex-Adapters `scripts/codex-hook.mjs` (factory#364); ein Einstieg importiert nie aus einem Einstieg, darum liegt die Entscheidungslogik hier.
/**
 * PreToolUse-Dispatcher (quellprojekt#1311) für `Bash`, `PowerShell`, `SubagentHandback` (Abschluss-Wächter, quellprojekt#1342), `Agent` (Lens-Auftrag-Guard, quellprojekt#1425, und Holdout-Trennung),
 * `SendMessage` (Holdout-Trennung) und `Write` (Schreibziel-Guard, nur vom Codex-Adapter gesendet): EIN Node-Prozess je Tool-Aufruf statt drei.
 *
 * Er liest das Payload einmal (`hook-io.mjs`) und fragt die Guards:
 *  - Bash:       Worktree-Guard (`decide`, scripts/worktree-guard-hook.mjs), gh-Guard (`bewerte`) und Stdin-Skript-Guard (`bewerteStdinSkript`, quellprojekt#1561)
 *  - PowerShell: Worktree-Guard für PowerShell (scripts/worktree-guard-powershell.mjs) und gh-Guard
 *  - SubagentHandback: Abschluss-Wächter des Umsetzers; Agent: Lens-Auftrag-Guard (`lens-auftrag-guard.mjs`), dann Holdout-Auftrags-Guard (`holdout-auftrag-guard.mjs`);
 *    SendMessage: Holdout-Guard (Szenarien gehen nur per Agent-Spawn an den Abnahme-Agenten, ADR 0022 F13)
 *  - Write:      Schreibziel-Guard (`decideSchreibziel`, factory#364): in `.claude/settings.json` nicht registriert, nur der Codex-Adapter (aus `apply_patch`) sendet es
 * Jeder Guard läuft im eigenen try/catch: ein werfender Guard legt den anderen nicht lahm und blockt nie selbst
 * (fail-open bei internem Fehler; `deps.beiFehler` meldet den Fehler dem Codex-Adapter, der dann verweigert). Ausnahme: Lens-Auftrag- und Abschluss-Wächter verweigern bei fehlendem Config-Schlüssel
 * (fail-closed mit Fix-Zeile, ADR 0022). Ausgabe: genau ein JSON, deny vor ask; fremde Tools und kaputtes JSON → nichts.
 *
 * Reines Node-Skript (nur Builtins).
 */
import { SHELL_VON_TOOL } from "./shell-tabellen.mjs";
import { bewerte as bewerteGh } from "./gh-guard-hook.mjs";
import { buildDenyOutput, mergeDecisions, parseHookInput } from "./hook-io.mjs";
import { holdoutAuftragBlockade, parseHoldoutInput } from "./holdout-auftrag-guard.mjs";
import { lensAuftragBlockade, parseAgentInput } from "./lens-auftrag-guard.mjs";
import { bewerteStdinSkript } from "./stdin-skript-guard.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";
import { abschlussBlockade, parseAbschlussInput } from "./umsetzer-abschluss.mjs";
import { decide, decideSchreibziel } from "./worktree-guard-hook.mjs";
import { bewertePowerShell } from "./worktree-guard-powershell.mjs";

/** Fail-open: ein werfender Guard liefert null; `beiFehler` (nur der Codex-Adapter) sieht den Fehler und kann fail-closed entscheiden. */
const sichererLauf = (fn, beiFehler) => {
  try {
    return fn();
  } catch (e) {
    beiFehler?.(e);
    return null;
  }
};
const alsDeny = (grund) => (grund ? buildDenyOutput(grund) : null);

/** Routen der Nicht-Shell-Tools: `{ text, deps, sicher, cwd, repoRoot, guards }` → Output-Objekt oder null. */
const ROUTEN = {
  // Abschluss-Wächter des Umsetzers (quellprojekt#1342): vor der Zustellung des Berichts; fremde Agenten und jeder Fehler lassen durch.
  // Die Config lädt dieser Einstiegspunkt (ohne nutzbare Config blockiert er fail-closed); der Kern bekommt sie als Parameter.
  SubagentHandback: ({ text, deps, sicher }) =>
    alsDeny(
      sicher(() => {
        const geladen = namenOderGrund("Umsetzer-Abschluss", deps);
        return geladen.grund ?? abschlussBlockade(parseAbschlussInput(text), { ...deps, config: geladen.config });
      }),
    ),
  // Lens-Auftrag-Guard (quellprojekt#1425): ein Lens-Spawn mit übrig gebliebenen Platzhaltern wird verweigert; alles andere läuft durch.
  Agent: ({ text, deps, sicher }) => alsDeny(sicher(() => lensAuftragBlockade(parseAgentInput(text), deps)) ?? sicher(() => holdoutAuftragBlockade(parseHoldoutInput(text)))),
  // Holdout-Trennung (ADR 0022 F13): Szenarien gehen nie per Nachricht an einen Agenten.
  SendMessage: ({ text, sicher }) => alsDeny(sicher(() => holdoutAuftragBlockade(parseHoldoutInput(text)))),
  // Schreibziel-Guard (factory#364): nur der Codex-Adapter schickt `Write` (aus `apply_patch`); Claude bleibt unverändert.
  Write: ({ text, deps, sicher, cwd, repoRoot, guards }) =>
    mergeDecisions([sicher(() => (guards.decideSchreibziel ?? decideSchreibziel)({ cwd, pfad: JSON.parse(text).tool_input?.file_path, repoRoot, deps }))]),
};

/** Shell-Tools (`Bash`, `PowerShell`): Worktree-Guard, Stdin-Skript-Guard und gh-Guard; `null` für unbekannte Tools. */
function shellRoute({ tool, command, cwd, repoRoot, guards, shellVonTool, sicher }) {
  if (tool === undefined || !Object.hasOwn(shellVonTool, tool)) return null;
  const shell = shellVonTool[tool]; // Quote-Dialekt für den gh-Guard (Backslash gegen Backtick) UND Wahl des Worktree-Guards
  const worktreeGuard = { bash: () => guards.decide({ cwd, command, repoRoot }), powershell: () => guards.bewertePowerShell({ command, cwd, repoRoot }) }[shell]; // ein neues Tool braucht hier bewusst einen eigenen Guard
  // Fail-closed (quellprojekt#1331): eine Shell in der Tabelle ohne Worktree-Guard darf nicht still durchlaufen.
  const worktree = worktreeGuard
    ? sicher(worktreeGuard)
    : { block: true, reason: `Dispatcher: für die Shell "${shell}" gibt es keinen Worktree-Guard (SHELL_VON_TOOL und Dispatcher driften auseinander).` };
  if (worktree?.block) return mergeDecisions([worktree]); // deny geht vor ask: ein langsamer gh-Guard darf es nicht aushebeln
  // Stdin-Skript-Guard (quellprojekt#1561): nur Bash; ein deny wie beim Worktree-Guard, ein werfender Guard lässt durch.
  const stdin = shell === "bash" ? sicher(() => (guards.bewerteStdin ?? bewerteStdinSkript)(command)) : null;
  return mergeDecisions([worktree, stdin, sicher(() => guards.bewerteGh(command, { shell }))]);
}

/** Entscheidet für ein Payload (Text) und gibt das Hook-Output-Objekt oder null (durchlassen) zurück. */
export function dispatch(text, repoRoot, guards = { decide, bewertePowerShell, bewerteGh }, shellVonTool = SHELL_VON_TOOL, deps = {}) {
  const { tool, cwd, command } = parseHookInput(text);
  const sicher = (fn) => sichererLauf(fn, deps.beiFehler);
  if (Object.hasOwn(ROUTEN, tool)) return ROUTEN[tool]({ text, deps, sicher, cwd, repoRoot, guards });
  return shellRoute({ tool, command, cwd, repoRoot, guards, shellVonTool, sicher });
}
