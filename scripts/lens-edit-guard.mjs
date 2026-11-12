// Kein Shebang: wird als agent-skopierter PreToolUse-Hook gestartet UND von test/harness/lens-edit-guard.test.ts importiert.
/**
 * Lens-Sabotage-Guard (#1349): die Lens (`agenten.lens` der Projekt-Config) hat das Tool `Edit`, ausschließlich für die Sabotage-Probe der Test-Lens
 * (Implementierung testweise verfälschen, Test wird rot?). Die Probe gehört in einen eigenen Lens-Worktree
 * (`.claude/worktrees/<worktree-präfix><nr>-lens-r<runde>-<brille>`, je Brille ein eigener Worktree, damit parallele Lenses sich keinen teilen; die Endung `-<brille>` (`[a-z-]`) ist optional; bei der Merge-Delta-Lens `…-lens-m<n>`, bei der Delta-Lens nach einem Abnahme-Fix `…-lens-a<n>`, bei der Delta-Lens nach einem CI-Fix hinter dem Nachweis `…-lens-c<n>`; für einen fremden Klon: `git -C <klon> worktree add --detach <klon>/.claude/worktrees/<präfix><nr>-lens-r<runde> <erwarteter HEAD>`, das Präfix liest der Guard aus `<klon>/.factory/projekt.json`, ohne lesbare Config gilt das der Session); ein Edit im Feature-Worktree verfälscht die Basis der parallel lesenden
 * anderen Lenses (so passiert im Review von #1331). Die Regel stand bisher nur als Text in der Lens-Definition.
 *
 * Dieser Hook (Frontmatter der Lens-Definition unter `.claude/agents/`, Matcher `Edit|Bash|PowerShell`, gilt nur für diesen Subagenten) erzwingt sie:
 * `Edit` ist erlaubt, wenn der aufgelöste Zielpfad in einem Lens-Worktree liegt, sonst `deny`. Ein fehlender Pfad ist `deny`.
 *
 * Bewusste Grenzen:
 *   - Außerhalb von `.claude/worktrees/` (auch ein Klon selbst) erlaubt der Guard nie.
 *   - Bash/PowerShell-Schreibzugriffe (`sed -i`, `Set-Content`) fängt er nicht ab; die Lens-Definition verbietet es per Text, der
 *     Frische-Guard der Folge-Runde und `git status --porcelain` im Feature-Worktree machen eine Änderung sichtbar.
 *   - Hintergrund-Läufe (factory#413 L4: ein abgebrochener Probe-Lauf schrieb im Hintergrund parallel in dieselbe Datei weiter) verweigert er in Bash und PowerShell
 *     über eine geschlossene Liste: `run_in_background: true`; ein einzelnes `&`, das weder an `&`, `>`, `<` noch `|` grenzt
 *     (PowerShell-Aufrufoperator `& node x` am Befehls-/Segmentanfang ausgenommen); die Wörter `nohup`, `setsid`, `disown`, `Start-Job`,
 *     `Start-ThreadJob`, `Start-Process`. Rohtext-Scan: ein `&` in Quotes wird auch verweigert (fail-closed); ein Hintergrund über ein Skript mit
 *     eigenem spawn/detached erkennt er nicht.
 *   - Ein Pfad per Symlink/Junction in einen Lens-Worktree wird nicht aufgelöst (lexikalische Prüfung); jeder Pfad mit einem Segment `.claude/worktrees/<worktree-präfix><nr>-lens-r<n>/`, `-lens-m<n>/`, `-lens-a<n>/` oder `-lens-c<n>/` gilt als Lens-Worktree, auch ein verschachtelter.
 *
 * Präfixe und Agentenname kommen je Aufruf aus der Projekt-Config (`ticket-namen.mjs`); ist sie nicht nutzbar, lehnt der Guard ab (fail-closed).
 * Nur Node-Builtins.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { istArbeitsplatz } from "./arbeitsplatz-lib.mjs";
import { buildDenyOutput, emit, normalisierePfad, pfadGuardHook, readStdin } from "./hook-io.mjs";
import { ROLLEN_PFADE, ladeProjektConfig } from "./projekt-config-lib.mjs";
import { namenOderGrund, worktreeNamenOderGrund } from "./ticket-namen.mjs";

// Pfadform: Groß-/Kleinschreibung egal (Windows-Pfade), der Ordnername selbst für das Aufräumen exakt (kein Flag oben).
const lensWorktree = (namen) => namen.lensPfadMuster;

/**
 * Repo-Root eines Pfads unter `.claude/worktrees/` (alles vor dem ersten Segment) oder null (#78 L3f/L9d). Liegt dort eine lesbare Config,
 * gilt deren Worktree-Präfix (Lens-Worktree eines fremden Klons, angelegt per `git -C <klon> worktree add --detach … <erwarteter HEAD>`); sonst null → Präfix der Session.
 */
function zielNamen(norm) {
  const i = norm.search(/\/\.claude\/worktrees\//i);
  if (i <= 0) return null;
  let config;
  try {
    config = ladeProjektConfig({ rootDir: norm.slice(0, i), pruefen: false }); // expliziter rootDir: die Probe-Variable greift nicht
  } catch {
    return null;
  }
  return worktreeNamenOderGrund("Lens-Edit-Guard", { config }).namen ?? null;
}

/** Der Ordner-Teil des Lens-Worktree-Beispiels: eingebettet `.claude/worktrees/`, im Arbeitsplatz `<worktree-ordner>/` (je Repo `<wurzel>/.claude/worktrees/<repo>`, factory#89). */
const lensOrdner = (config) => (istArbeitsplatz(config) ? "<worktree-ordner>/" : ".claude/worktrees/");

/**
 * Darf die Lens diese Datei per `Edit` ändern? Pur (die Config kommt über `deps.config` oder wird geladen). Liefert `{ block: false }` oder `{ block: true, reason }`.
 * `cwd` löst relative Pfade auf (die Edit-Tools liefern normalerweise absolute).
 */
export function bewerteLensEdit(filePath, cwd = "", deps = {}) {
  if (typeof filePath !== "string" || filePath.trim() === "") {
    return { block: true, reason: "Lens-Edit ohne Dateipfad: nicht prüfbar, darum abgelehnt." };
  }
  const { namen, grund, config } = namenOderGrund("Lens-Edit-Guard", deps);
  if (grund) return { block: true, reason: grund };
  const norm = normalisierePfad(filePath, cwd);
  if (lensWorktree(zielNamen(norm) ?? namen).test(norm)) return { block: false };
  return {
    block: true,
    reason:
      `${namen.agenten.lens} ändert nichts im Feature-Worktree: Edit ist nur im eigenen Lens-Worktree erlaubt ` +
      `(${lensOrdner(config)}${namen.worktreeName("<nr>")}-lens-r<runde>${istArbeitsplatz(config) ? "" : " (fremder Klon: git -C <klon> worktree add --detach <klon>/.claude/worktrees/<präfix><nr>-lens-r<runde> <erwarteter HEAD>)"} bzw. ${namen.worktreeName("<nr>")}-lens-m<n> bzw. -lens-a<n> bzw. -lens-c<n>, siehe Regel „Sabotage nur im Lens-Worktree“ in ${ROLLEN_PFADE.lens}). ` +
      (istArbeitsplatz(config) ? "Worktree-Ordner je Repo: `node scripts/arbeitsplatz.mjs pfade`. " : "") +
      "Je Brille ein eigener Worktree: der Name endet auf `-<brille>` (`-lens-r<runde>-<brille>`), sonst teilen parallele Lenses ihn. " +
      "Ist der Lens-Worktree nicht anlegbar: Befund „Sabotage nicht möglich“ melden, kein Ersatz.",
  };
}

// PowerShell-Aufrufoperator `& node x` am Befehls-/Segmentanfang (Anfang, nach `;`, `|`, `(`, `{`, Zeilenumbruch, `&&`, `||`): kein Hintergrund.
const POWERSHELL_AUFRUF = /(^|[;|({\n]|&&)(\s*)&(?=\s)/g;
// Ein einzelnes `&`, das weder an `&` (`&&`), `>` (`2>&1`, `&>log`), `<` noch `|` (`|&`) grenzt, schickt den Befehl in den Hintergrund.
const EINZEL_UND = /(?<![&><|])&(?![&><|])/;
const HINTERGRUND_WORT = /\b(?:nohup|setsid|disown|Start-Job|Start-ThreadJob|Start-Process)\b/i;

/**
 * Startet dieser Bash-/PowerShell-Aufruf der Lens etwas im Hintergrund (factory#413 L4)? Ein abgebrochener Probe-Lauf im Hintergrund
 * schrieb parallel in dieselbe Datei weiter. Pur. Liefert `{ deny: true, grund }` oder `null`.
 */
export function bewerteLensBefehl(eingabe, tool = "Bash") {
  const befehl = typeof eingabe?.command === "string" ? eingabe.command : "";
  const text = tool === "PowerShell" ? befehl.replace(POWERSHELL_AUFRUF, "$1$2 ") : befehl;
  const hintergrund = eingabe?.run_in_background === true || EINZEL_UND.test(text) || HINTERGRUND_WORT.test(text);
  if (!hintergrund) return null;
  return {
    deny: true,
    grund:
      "Lens-Befehle laufen im Vordergrund: kein `run_in_background`, kein `&` am Ende, kein nohup/setsid/disown/Start-Job/Start-ThreadJob/Start-Process " +
      "(ein abgebrochener Hintergrund-Lauf schreibt sonst parallel in dieselbe Datei weiter). Dauert eine Probe-Serie über 10 Minuten (Bash-Deckel), teile sie in mehrere Vordergrund-Läufe auf.",
  };
}

/**
 * Hook-stdin → Entscheidung, verteilt nach `tool_name`: `Bash`/`PowerShell` an `bewerteLensBefehl`, alles andere (`Edit`, auch ohne `tool_name`) an `bewerteLensEdit`.
 * Kaputter Input: durchlassen (ein Hook darf nie selbst alles blockieren). `deps` wie bei `bewerteLensEdit` (Test: injizierte Config).
 */
export function entscheideHook(text, deps = {}) {
  let tool;
  let eingabe;
  try {
    ({ tool_name: tool, tool_input: eingabe } = JSON.parse(text));
  } catch {
    return null;
  }
  if (tool === "Bash" || tool === "PowerShell") {
    const urteil = bewerteLensBefehl(eingabe, tool);
    return urteil ? buildDenyOutput(urteil.grund) : null;
  }
  return pfadGuardHook("Edit", (p, cwd) => bewerteLensEdit(p, cwd, deps))(text);
}

if (istDirektaufruf(import.meta.url)) emit(entscheideHook(readStdin()));
