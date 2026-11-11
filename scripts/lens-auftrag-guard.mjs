// Kein Shebang: wird vom PreToolUse-Dispatcher (`scripts/pretooluse-hook.mjs`) und vom Wächter-Test importiert.
/**
 * Lens-Auftrag-Guard (#1425): ein Lens-Spawn (Agent `agenten.lens` der Projekt-Config) mit übrig gebliebenen Platzhaltern wird abgewiesen.
 *
 * Anlass: Beim Spawn einer Lens (Skill `review-lenses`) setzt der Orchestrator Handarbeit-Werte in den Prompt
 * (Brille, Worktree, Patch-Pfad, erwarteter HEAD). Blieb ein `<…>` stehen, startete die Lens
 * ohne Patch oder HEAD und prüfte nichts (PR #1423). Seit factory#308 liest die Lens ihre Brille selbst (`brille-<Schlüssel>.md`); der Auftrag nennt nur den Schlüssel. Der Guard läuft als PreToolUse auf `Agent`, fail-closed
 * (deny) bei einem klar erkennbaren Rest, fail-open bei allem Unklaren (kein Lens-Spawn, kaputte Eingabe).
 *
 * Bewusst KEIN generischer `<…>`-Test: die Plan-Prüfliste und der Lens-Worktree-Pfad
 * (`<worktree-präfix><nr>-lens-r<runde>`) können absichtlich Platzhalter tragen. Geprüft werden nur die Kopf-Felder des Auftrags:
 *  R1  `WÖRTLICH>` irgendwo (der Platzhalter der Plan-Prüfliste `… WÖRTLICH>` blieb stehen),
 *  R2  der Wert von `Arbeitsverzeichnis:`, `Patch:`, `Delta-Patch:` oder `erwarteter HEAD:` enthält noch `<…>`,
 *  R3  `erwarteter HEAD:` beginnt nicht mit einem Hex-Hash von 7 bis 40 Zeichen (Backticks und ein Zusatz dahinter sind erlaubt;
 *      ein Fließtext statt Hash wird verweigert).
 *  R4  ein Pfadsegment `<worktree-präfix><nr>-lens-<x>` mit Ziffer oder Platzhalter hinter dem Buchstaben trägt eine unbekannte Endung `<x>`
 *      (erlaubt sind die Endungen aus `lensNameKern` in `ticket-namen.mjs`: r, m, a, c; ein Delta-Auftrag mit `-lens-b<n>` scheiterte erst am Lens-Edit-Guard).
 *  R5  der Prompt beginnt nicht mit `Brille: <Schlüssel>` mit einem Schlüssel aus `BEKANNTE_LENSES`, exakt wie dort geschrieben (die Lens baut daraus den Dateinamen `brille-<Schlüssel>.md`, ein Git-Pfad kennt keine Groß-/Kleinschreibung-Toleranz); sonst wüsste die Lens nicht, welche Brillen-Datei sie lesen soll.
 * Fehlende andere Felder bleiben Sache der Lens-Definition (unter `.claude/agents/`).
 * Ist die Projekt-Config nicht nutzbar, lehnt der Guard jeden Spawn ab (fail-closed, Meldung mit Fix-Zeile), auch einen Nicht-Lens-Spawn: ob es eine Lens ist, weiß er dann nicht.
 *
 * Bewusste Grenzen:
 *  - Die Feldnamen stehen hier einmal und in der Spawn-Vorlage des Skills `review-lenses` (benennt jemand sie um, öffnet der Guard still, fail-open).
 *  - Ausgewertet wird je Feld der letzte Treffer im Prompt; die Brille zählt nur am Prompt-Anfang (erster Treffer).
 *  - R4 sieht nur Segmente, deren Buchstabe direkt von Ziffer oder `<…>` gefolgt wird und das Worktree-Präfix der Config trägt; ein Pfad mit Leerzeichen oder anderer Schreibweise (`-lens-b` ohne Zähler) bleibt unerkannt.
 *
 * Reines Node-Skript (nur Builtins), pure Funktionen.
 */
import { basename } from "node:path";
import { BEKANNTE_LENSES, HEX_HEAD } from "./nachweis-lib.mjs";
import { escapeRegex } from "./regex-lib.mjs";
import { ROLLEN_PFADE } from "./projekt-config-lib.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";

/** Kopf-Felder des Auftrags, deren Wert kein `<…>` mehr tragen darf. `(?<![\w-])` trennt `Patch:` von `Delta-Patch:`. */
const FELDER = ["Arbeitsverzeichnis", "Delta-Patch", "Patch", "erwarteter HEAD"];

/** Liest die Kopf-Felder aus dem Prompt: Wert reicht bis zum Trenner ` · ` oder Zeilenende. Zählt der LETZTE Treffer je Feld:
 *  die Brille davor darf ein Feld als Beispiel nennen („… mit `Patch: <TMP>/x.patch`“), der echte Kopf steht dahinter. Pure. */
export function parseLensAuftrag(text) {
  const felder = {};
  for (const name of FELDER) {
    const treffer = [...String(text ?? "").matchAll(new RegExp(String.raw`(?<![\w-])${name}:[ \t]*([^\r\n]*?)(?:[ \t]+·[ \t]|[ \t]*$)`, "gim"))];
    if (treffer.length > 0) felder[name] = treffer[treffer.length - 1][1].trim();
  }
  return felder;
}

/** Liest `subagent_type` und `prompt` aus dem Hook-Payload eines `Agent`-Aufrufs; kaputtes JSON → leeres Objekt. Pure. */
export function parseAgentInput(text) {
  try {
    const eingabe = JSON.parse(text)?.tool_input;
    return { subagentType: eingabe?.subagent_type, prompt: eingabe?.prompt };
  } catch {
    return {};
  }
}

/** Wird dieser Spawn als Lens-Spawn behandelt? Typ `lens` (Agentenname aus der Config), oder der Fallback (`general-purpose`/ohne Typ),
 *  dessen Prompt die Lens-Definition nennt: der feste Kern-Dateiname (`ROLLEN_PFADE.lens`). */
function istLensSpawn(subagentType, prompt, lens) {
  if (subagentType === lens) return true;
  const fallback = subagentType === undefined || subagentType === "general-purpose";
  const text = String(prompt ?? "");
  return fallback && text.includes(basename(ROLLEN_PFADE.lens));
}

const HINWEIS =
  "Setze die Werte aus Stufe 0 ein (Brille als `Brille: <Schlüssel>` am Prompt-Anfang, Worktree, Patch-Pfad mit Runde, `git rev-parse HEAD`) laut Spawn-Vorlage im Skill `review-lenses`.";

/** R4: Grund, wenn ein Pfadsegment `<wt><nr>-lens-<x>…` eine Endung `<x>` trägt, die das Muster aus `ticket-namen.mjs` (`lensNameKern`) nicht kennt; sonst `null`.
 *  Ein Platzhalter nach dem Buchstaben (`-lens-r<runde>`) zählt wie eine Ziffer; die erlaubten Endungen stehen nur in `lensNameKern`. Pure. */
function unbekannteLensEndung(text, namen) {
  const wt = escapeRegex(namen.praefixe.worktree);
  const segmente = text.matchAll(new RegExp(String.raw`${wt}(?:\d+|<[^<>\s]*>)-lens-([a-z])(?=\d|<)[^\s/\\"'\x60]*`, "g"));
  const bekannt = new RegExp(namen.lensNameKern);
  for (const [segment] of segmente) {
    if (bekannt.test(segment.replace(/<[^<>\s]*>/g, "1"))) continue;
    const erlaubt = /-lens-\[([a-z]+)\]/.exec(namen.lensNameKern)?.[1] ?? "";
    return `Lens-Auftrag unbekannt: der Lens-Worktree „${segment}“ trägt eine Endung, die es nicht gibt. Erlaubt sind ${[...erlaubt].join(", ")} (Muster aus ticket-namen.mjs: -lens-r<runde> Review, -lens-m<n> Merge-Delta, -lens-a<n> Abnahme-Delta, -lens-c<n> CI-Fix-Delta), sonst blockiert der Lens-Edit-Guard die Sabotage-Probe. ${HINWEIS}`;
  }
  return null;
}

/** R5: Grund, wenn der Prompt nicht mit `Brille: <Schlüssel>` beginnt oder der Schlüssel keine bekannte Brille ist; sonst `null`. Pure. */
function brillenGrund(text) {
  const wert = /^\s*Brille:[ \t]*([^\s·]+)/.exec(text)?.[1];
  if (BEKANNTE_LENSES.includes(wert ?? "")) return null;
  return `Lens-Auftrag unvollständig: der Prompt beginnt nicht mit „Brille: <Schlüssel>“ mit einer bekannten Brille (${BEKANNTE_LENSES.join(", ")}); die Lens liest ihre Brillen-Datei (brille-<Schlüssel>.md) selbst und braucht den Schlüssel. ${HINWEIS}`;
}

/** Grund für ein Deny oder `null` (durchlassen). Pure. */
export function lensAuftragBlockade({ subagentType, prompt } = {}, deps = {}) {
  const { namen, grund } = namenOderGrund("Lens-Auftrag-Guard", deps);
  if (grund) return grund;
  if (!istLensSpawn(subagentType, prompt, namen.agenten.lens)) return null;
  const text = String(prompt ?? "");
  if (text.includes("WÖRTLICH>")) {
    return `Lens-Auftrag unvollständig: der Platzhalter „… WÖRTLICH>“ steht noch im Prompt (die Plan-Prüfliste wurde nicht eingesetzt). ${HINWEIS}`;
  }
  const felder = parseLensAuftrag(text);
  for (const [name, wert] of Object.entries(felder)) {
    if (/<[^<>\r\n]*>/.test(wert)) {
      return `Lens-Auftrag unvollständig: das Feld „${name}:“ trägt noch einen Platzhalter (${wert}). Ein Zusatz in derselben Zeile zählt mit, auch ein erklärendes „<…>“: Erklärungen in eine eigene Zeile schreiben. ${HINWEIS}`;
    }
  }
  const endung = unbekannteLensEndung(text, namen);
  if (endung) return endung;
  const head = felder["erwarteter HEAD"];
  // Der Hash zählt, nicht die Verzierung: Backticks und ein Zusatz nach dem Hash („abc1234 (origin/main + Fix)“) sind erlaubt.
  const hash = head?.replace(/^`+/, "").split(/[\s`]/, 1)[0];
  if (head !== undefined && !HEX_HEAD.test((hash ?? "").toLowerCase())) {
    return `Lens-Auftrag unvollständig: „erwarteter HEAD:“ ist kein Commit-Hash (7 bis 40 Hex-Zeichen), sondern „${head}“. ${HINWEIS}`;
  }
  // Kein Prompt-Feld (kaputte oder fremde Eingabe) bleibt fail-open wie bisher.
  return prompt === undefined ? null : brillenGrund(text);
}
