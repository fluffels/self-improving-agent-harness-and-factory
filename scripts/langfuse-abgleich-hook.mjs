// Hook-Einstieg (#1578): SessionStart und SessionEnd starten den Nachlieferer losgelöst und enden sofort mit Exit 0; SessionStart startet zusätzlich den Wochenbericht-Lauf (factory#314, eigenes losgelöstes Kind). Nie an Stop (läuft je Turn, kollidiert mit dem
// vom Plugin zurückgehaltenen Turn und erzeugt Dubletten). Wartezeit, Lock und Log stecken im Kind (scripts/langfuse-nachliefern.mjs, --ausloeser);
// Config, Termin, Claim und Log des Wochenberichts im zweiten Kind (scripts/langfuse-wochenbericht.mjs, --ausloeser); der Hook importiert es nicht und liest keinen Secret-Key.
// Nur Builtins, hook-io.mjs, langfuse-zugang.mjs und die Session-ID-Regel aus langfuse-auftrag-lib.mjs (nur Builtins); Einordnung: docs/langfuse-hook-patch.md (Fabrik) › Abgleich als Garantie.
import { spawn as spawnEcht } from "node:child_process";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { parseSessionHookInput, readStdin } from "./hook-io.mjs";
import { SESSION_ID } from "./langfuse-auftrag-lib.mjs";
import { kindEnv } from "./langfuse-zugang.mjs";

/** Kind-Argumente je Hook-Ereignis; `null`: kein Lauf (compact/fork/unbekannt, fehlende oder verdächtige Session-ID). */
export function kindArgs({ event, session, source } = {}) {
  if (typeof session !== "string" || !SESSION_ID.test(session)) return null;
  if (event === "SessionEnd") return ["--ausloeser", "sessionend", "--session", session, "--beendet", session];
  if (event === "SessionStart" && ["startup", "resume", "clear"].includes(source)) return ["--ausloeser", "sessionstart", "--aktuell", session];
  return null;
}

/** Argumente des Wochenbericht-Kinds: nur am SessionStart (`startup|resume|clear`) mit gültiger Session-ID, sonst `null`; `wurzel` = Repo-Wurzel dieses Hooks. */
export function wochenArgs({ event, session, source } = {}, wurzel) {
  if (typeof session !== "string" || !SESSION_ID.test(session)) return null;
  if (event === "SessionStart" && ["startup", "resume", "clear"].includes(source)) return ["--ausloeser", "sessionstart", "--wurzel", wurzel];
  return null;
}

/** Startet ein Kind losgelöst; Rückgabe `true`, wenn es gestartet wurde. Wirft nie (ein Fehler hier darf das andere Kind nicht verhindern). */
function startKind(spawn, execPath, skriptUrl, args, { env, home }) {
  try {
    const skript = fileURLToPath(skriptUrl);
    // cwd im Home: ein cwd im Worktree blockierte dessen Entfernen unter Windows.
    const kind = spawn(execPath, [skript, ...args], { detached: true, windowsHide: true, stdio: "ignore", cwd: home, env: kindEnv(env, home) });
    kind.on("error", () => {}); // ein asynchrones ENOENT darf den Hook nicht kippen
    kind.unref();
    return true;
  } catch {
    return false;
  }
}

/** Startet die Kinder losgelöst (Nachlieferer, am SessionStart zusätzlich der Wochenbericht-Lauf, je in eigenem Versuch); `true`, wenn mindestens eines gestartet wurde. Wirft nie. */
export function starte(text, { spawn = spawnEcht, env = process.env, execPath = process.execPath, home = homedir(), wurzel = fileURLToPath(new URL("..", import.meta.url)) } = {}) {
  try {
    const eingabe = parseSessionHookInput(text);
    const nachliefern = kindArgs(eingabe);
    const wochen = wochenArgs(eingabe, wurzel);
    const gestartet = [
      nachliefern && startKind(spawn, execPath, new URL("./langfuse-nachliefern.mjs", import.meta.url), nachliefern, { env, home }),
      wochen && startKind(spawn, execPath, new URL("./langfuse-wochenbericht.mjs", import.meta.url), wochen, { env, home }),
    ];
    return gestartet.some(Boolean);
  } catch {
    return false;
  }
}

if (istDirektaufruf(import.meta.url)) {
  starte(readStdin());
  process.exitCode = 0;
}
