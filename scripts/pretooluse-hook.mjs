// Kein Shebang: wird über `.claude/settings.json` per `node scripts/pretooluse-hook.mjs` gestartet UND von
// test/harness/pretooluse-hook.test.ts importiert.
/**
 * PreToolUse-Dispatcher (#1311) für `Bash`, `PowerShell`, `SubagentHandback` (Abschluss-Wächter, #1342), `Agent` (Lens-Auftrag-Guard, #1425, und Holdout-Trennung) und `SendMessage` (Holdout-Trennung): EIN Node-Prozess je Tool-Aufruf statt drei. Die Entscheidungslogik (`dispatch`) liegt in `scripts/pretooluse-dispatch.mjs` (Lib, auch vom Codex-Adapter genutzt, factory#364); dieser Einstieg re-exportiert sie.
 *
 * Er liest das Payload einmal (`hook-io.mjs`) und fragt die Guards:
 *  - Bash:       Worktree-Guard (`decide`, scripts/worktree-guard-hook.mjs), gh-Guard (`bewerte`) und Stdin-Skript-Guard (`bewerteStdinSkript`, #1561)
 *  - PowerShell: Worktree-Guard für PowerShell (scripts/worktree-guard-powershell.mjs) und gh-Guard
 *  - SubagentHandback: Abschluss-Wächter des Umsetzers; Agent: Lens-Auftrag-Guard (`lens-auftrag-guard.mjs`), dann Holdout-Auftrags-Guard (`holdout-auftrag-guard.mjs`);
 *    SendMessage: Holdout-Guard (Szenarien gehen nur per Agent-Spawn an den Abnahme-Agenten, ADR 0022 F13)
 * Jeder Guard läuft im eigenen try/catch: ein werfender Guard legt den anderen nicht lahm und blockt nie selbst
 * (fail-open bei internem Fehler). Ausnahme: Lens-Auftrag- und Abschluss-Wächter verweigern bei fehlendem Config-Schlüssel
 * (fail-closed mit Fix-Zeile, ADR 0022). Ausgabe: genau ein JSON, deny vor ask; fremde Tools und kaputtes JSON → nichts.
 *
 * Die drei Guard-Skripte bleiben einzeln aufrufbar (dünner Direktaufruf), weil laufende Sessions ihre
 * Hook-Konfiguration beim Start einfrieren.
 *
 * Reines Node-Skript (nur Builtins).
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { emit, readStdin } from "./hook-io.mjs";
import { dispatch } from "./pretooluse-dispatch.mjs";
import { repoRootFromScriptUrl } from "./worktree-guard-hook.mjs";

export { dispatch };

if (istDirektaufruf(import.meta.url)) emit(dispatch(readStdin(), repoRootFromScriptUrl(import.meta.url)));
