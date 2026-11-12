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
 *  R6  (factory#235, A/B Kern je Rolle) der Agententyp ist einer der beiden Lens-Typen (`lensTypen`), lässt sich die Ticketnummer aus dem Auftrag ableiten
 *      (`ticketAusLauf` wie in der Messung: Titelzeile, Patch-Pfad, Worktree-Pfad, zuletzt das erste `#<nr>` im Prompt; eine fremde `#<nr>` ohne Patch-Pfad kann so den Arm eines anderen Tickets wählen, Bekannte Grenze: nur die Messung betroffen) und entspricht nicht dem Typ, den `lensArm(nr)` für das Ticket wählt; die Meldung nennt den richtigen Typ.
 * Fehlende andere Felder bleiben Sache der Lens-Definition (unter `.claude/agents/`).
 * Ist die Projekt-Config nicht nutzbar, lehnt der Guard jeden Spawn ab (fail-closed, Meldung mit Fix-Zeile), auch einen Nicht-Lens-Spawn: ob es eine Lens ist, weiß er dann nicht.
 *
 * Bewusste Grenzen:
 *  - Die Feldnamen stehen hier einmal und in der Spawn-Vorlage des Skills `review-lenses` (benennt jemand sie um, öffnet der Guard still, fail-open).
 *  - Ausgewertet wird je Feld der letzte Treffer im Prompt; die Brille zählt nur am Prompt-Anfang (erster Treffer).
 *  - R6 greift nur bei explizitem Lens-Typ und ableitbarer Nummer: der `general-purpose`-Fallback und ein Auftrag ohne Ticketbezug bleiben offen (fail-open); die Messung (`kontext-treiber`, `lauf-ergebnis`) meldet ein solches Ticket als ungültig. Ein gefälschter Patch-Pfad wählt nur den Arm (Messung), keine Rechte: Tools, Hooks und deny sind in beiden Armen gleich.
 *  - R4 sieht nur Segmente, deren Buchstabe direkt von Ziffer oder `<…>` gefolgt wird und das Worktree-Präfix der Config trägt; ein Pfad mit Leerzeichen oder anderer Schreibweise (`-lens-b` ohne Zähler) bleibt unerkannt.
 *
 * Reines Node-Skript (nur Builtins), pure Funktionen.
 */
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { BEKANNTE_LENSES, HEX_HEAD } from "./nachweis-lib.mjs";
import { escapeRegex } from "./regex-lib.mjs";
import { ROLLEN_PFADE } from "./projekt-config-lib.mjs";
import { namenOderGrund } from "./ticket-namen.mjs";
import { lensArm, lensTypen } from "./lens-arm-lib.mjs";
import { patchAus } from "./patch-zugriff.mjs";
import { ticketAusLauf } from "./subagent-laeufe.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));

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

/** Wird dieser Spawn als Lens-Spawn behandelt? Einer der Lens-Typen (`lensTypen`: Agentenname aus der Config und Arm B), oder der Fallback (`general-purpose`/ohne Typ),
 *  dessen Prompt die Lens-Definition nennt: der feste Kern-Dateiname (`ROLLEN_PFADE.lens`). */
function istLensSpawn(subagentType, prompt, typen) {
  if (typen.includes(subagentType)) return true;
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

/** R3: Grund, wenn `erwarteter HEAD:` kein Commit-Hash ist (fehlt das Feld, `null`). Der Hash zählt, nicht die Verzierung: Backticks und ein Zusatz nach dem Hash („abc1234 (origin/main + Fix)“) sind erlaubt. Pure. */
function headGrund(head) {
  const hash = head?.replace(/^`+/, "").split(/[\s`]/, 1)[0];
  if (head === undefined || HEX_HEAD.test((hash ?? "").toLowerCase())) return null;
  return `Lens-Auftrag unvollständig: „erwarteter HEAD:“ ist kein Commit-Hash (7 bis 40 Hex-Zeichen), sondern „${head}“. ${HINWEIS}`;
}

/** R2: Grund, wenn ein Kopf-Feld noch einen Platzhalter `<…>` trägt; sonst `null`. Pure. */
function platzhalterGrund(felder) {
  for (const [name, wert] of Object.entries(felder)) {
    if (/<[^<>\r\n]*>/.test(wert)) {
      return `Lens-Auftrag unvollständig: das Feld „${name}:“ trägt noch einen Platzhalter (${wert}). Ein Zusatz in derselben Zeile zählt mit, auch ein erklärendes „<…>“: Erklärungen in eine eigene Zeile schreiben. ${HINWEIS}`;
    }
  }
  return null;
}

/** R6: Grund, wenn der Typ nicht der Arm des Tickets ist; `null` ohne Lens-Typ, ohne ableitbare Nummer oder bei passendem Typ. Pur bei übergebenem `bezieher` (Funktion). */
function armGrund(subagentType, text, namen, bezieher) {
  if (!lensTypen(namen).includes(subagentType)) return null;
  const nr = ticketAusLauf({ patch: patchAus(text, [], namen), prompt: text }, namen);
  if (!nr) return null;
  const soll = lensArm(nr, { namen, bezieher: bezieher() });
  if (soll.typ === subagentType) return null;
  return `Lens-Arm falsch: Ticket #${nr} gehört zu Arm ${soll.arm} der A/B-Messung (factory#235), also subagent_type „${soll.typ}“, nicht „${subagentType}“ (gerade Nummer = Arm A, ungerade = Arm B, Bezieher immer A). Den Typ liefert \`node scripts/lens-arm.mjs ${nr}\`, nie von Hand wählen. Kennt das Agent-Tool den Typ nicht (Session vor dem Merge gestartet), die Session neu starten: der general-purpose-Fallback macht das Ticket in der Messung ungültig.`;
}

/** Grund für ein Deny oder `null` (durchlassen). Pure. */
export function lensAuftragBlockade({ subagentType, prompt } = {}, deps = {}) {
  const { namen, grund } = namenOderGrund("Lens-Auftrag-Guard", deps);
  if (grund) return grund;
  if (!istLensSpawn(subagentType, prompt, lensTypen(namen))) return null;
  const text = String(prompt ?? "");
  if (text.includes("WÖRTLICH>")) {
    return `Lens-Auftrag unvollständig: der Platzhalter „… WÖRTLICH>“ steht noch im Prompt (die Plan-Prüfliste wurde nicht eingesetzt). ${HINWEIS}`;
  }
  const felder = parseLensAuftrag(text);
  const offen = platzhalterGrund(felder);
  if (offen) return offen;
  const endung = unbekannteLensEndung(text, namen);
  if (endung) return endung;
  const kopf = headGrund(felder["erwarteter HEAD"]);
  if (kopf) return kopf;
  // Kein Prompt-Feld (kaputte oder fremde Eingabe) bleibt fail-open wie bisher.
  if (prompt === undefined) return null;
  return brillenGrund(text) ?? armGrund(subagentType, text, namen, deps.bezieher ?? (() => istBezieher(WURZEL)));
}
