// Blatt-Modul: nur Node-Builtins und die Ergebnis-Form.
/* Harness-Doctor, Punkt `Git-Hooks` (factory#247 L1): `git config core.hooksPath` ist `.githooks` (die Kern-Hooks `pre-push` und `post-commit` liegen dort). Ohne die Einstellung laufen sie nie,
 * ohne dass etwas meldet. Nur lokal in `--pruefen`: ein CI-Checkout hat die Einstellung nie, der Wochenlauf prüft den Punkt nicht. Fehlt die Einstellung oder hat sie einen anderen Wert, ist es
 * eine Lücke (Fix: der Befehl); lässt sich git nicht lesen, ist der Punkt nicht prüfbar. Das Skript `setup` gehört dem Projekt und braucht eine eigene `scripts/setup.mjs` (docs/erstbezug.md);
 * dieser Punkt prüft nur das Ergebnis. Grenze: `git config --get` liest die wirksame Konfiguration (lokal, global, System); ein globales `core.hooksPath` zählt also mit (der Fix setzt den Wert lokal).
 */
import { spawnSync } from "node:child_process";
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";

const PUNKT = "Git-Hooks";
const SOLL = ".githooks";
const FIX = `git config core.hooksPath ${SOLL}`;

/** Der Wert von `core.hooksPath` im Repo `rootDir` (`exec` ersetzt `spawnSync`): der Text, `null` wenn nicht gesetzt (Exit 1); wirft bei jedem anderen Fehler. */
export function gitHooksStandard({ rootDir, exec = spawnSync }) {
  return () => {
    const r = exec("git", ["-C", rootDir, "config", "--get", "core.hooksPath"], { encoding: "utf8", windowsHide: true });
    if (r.error) throw r.error;
    if (r.status === 1) return null;
    if (r.status !== 0) throw new Error(`git config endete mit Exit ${r.status}`);
    return String(r.stdout).trim();
  };
}

/** Der Punkt `Git-Hooks`: `lesen()` liefert den Wert oder `null`/leer (nicht gesetzt) und wirft bei einem Lesefehler. */
export function gitHooksPunkt({ lesen }) {
  let wert;
  try {
    wert = lesen();
  } catch (e) {
    return nichtPruefbar(PUNKT, `core.hooksPath nicht lesbar (${String(e?.message ?? e).split("\n")[0]})`, "git im Prüf-Root prüfen (git status), dann erneut prüfen");
  }
  const text = typeof wert === "string" ? wert.trim() : "";
  if (text === SOLL) return gut(PUNKT);
  const befund = text === "" ? `core.hooksPath ist nicht gesetzt: die Hooks aus ${SOLL}/ (pre-push, post-commit) laufen nie` : `core.hooksPath ist „${text}“ statt ${SOLL}: die Hooks aus ${SOLL}/ laufen nicht`;
  return luecke(PUNKT, befund, FIX);
}
