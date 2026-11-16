// Aufrufstatistik und Footprint (factory#519), pur und ohne IO: Skripte, Skills und Agenten, die Transkripte real aufrufen, und was ein Bezieher je Profil an Besitz trägt.
// Quelle der Aufrufe sind Tool-Events (`toolEventsFromTranscript`): Bash `node scripts/<x>.mjs`, `Skill` (`input.skill`), `Agent` (`input.subagent_type`). Genutzt heißt:
// direkt aufgerufen, Einstieg (Hook in `.claude/settings.json` oder im Kopf einer Agentendatei, Workflow, `package.json`-Skript) oder von einem Genutzten (statisch) importiert, auch endungslos. Grenze: Aufrufe aus Codex-Sitzungen, dynamische Importe ohne Literal und zur Laufzeit gebaute Pfade (auch `spawn` mit Skriptname) sieht die Zählung nicht; ein Skript, das nur ein anderes startet, braucht darum selbst einen Aufruf oder Einstieg.
// Footprint: Zeilen der verteilten Ganz-Datei-Einheiten; fester Kontext geschätzt als Zeichen / `CHARS_PER_TOKEN` aus `AGENTS.md`, `CLAUDE.md` (falls vorhanden) und den
// `description`-Zeilen der Skills und Agenten, die verteilt werden. Das ist die Größenordnung des festen Kontexts, keine Messung.
import { CHARS_PER_TOKEN, commandsOf } from "./brain-metrics.mjs";
import { istGanzeDatei, wirdVerteilt } from "./besitz-lib.mjs";
import { relativeImporte } from "./besitz-extraktion.mjs";
import { MODUL_STANDARD, modulGewaehlt } from "./modul-wahl-lib.mjs";
import { profilGewaehlt } from "./profil-lib.mjs";
import { istVorlage } from "./sync-abgleich-lib.mjs";

const SKRIPT = /(?:^|\/)scripts\/([\w./-]+\.mjs)$/;

const zaehle = (karte, name) => {
  if (typeof name === "string" && name !== "") karte[name] = (karte[name] ?? 0) + 1;
};

/** Zählt die Aufrufe der Events: `{ skripte, skills, agenten }`, je ein Objekt Name → Anzahl (Skripte mit Pfad `scripts/<x>.mjs`). */
export function aufrufeAusEvents(events) {
  const aus = { skripte: {}, skills: {}, agenten: {} };
  for (const ev of events) {
    if (ev.tool === "Skill") zaehle(aus.skills, ev.input?.skill);
    else if (ev.tool === "Agent" || ev.tool === "Task") zaehle(aus.agenten, ev.input?.subagent_type);
    else if (ev.tool === "Bash" || ev.tool === "PowerShell") {
      for (const w of commandsOf(ev.input?.command, ev.tool)) {
        const treffer = w[0] === "node" ? SKRIPT.exec(w[1] ?? "") : null;
        if (treffer) zaehle(aus.skripte, `scripts/${treffer[1]}`);
      }
    }
  }
  return aus;
}

/** Addiert Zählungen (`{ skripte, skills, agenten }`) mehrerer Sessions. */
export function summiere(liste) {
  const summe = { skripte: {}, skills: {}, agenten: {} };
  for (const z of liste) for (const art of Object.keys(summe)) for (const [n, k] of Object.entries(z[art] ?? {})) summe[art][n] = (summe[art][n] ?? 0) + k;
  return summe;
}

/** Skriptpfade, die ein Text nennt (`scripts/<x>.mjs`), für Einstiege wie `.claude/settings.json`, Workflows und `package.json`. */
export const skripteImText = (text) => [...String(text ?? "").matchAll(/scripts\/[\w./-]*[\w-]\.mjs/g)].map((m) => m[0]);

function aufgeloest(spec, von, besitz) {
  const teile = von.split("/").slice(0, -1);
  for (const t of spec.split("/")) {
    if (t === "..") teile.pop();
    else if (t !== ".") teile.push(t);
  }
  const roh = teile.join("/");
  return [roh, `${roh}.mjs`, `${roh}.cjs`, `${roh}.js`, `${roh}/index.mjs`].find((p) => besitz.has(p)) ?? null;
}

/** Genutzte Skripte: direkt Aufgerufene und Einstiege plus alles, was davon (transitiv) importiert wird. `lies(pfad)` liefert den Text oder `null`. */
export function genutzteSkripte({ direkt, einstiege, besitzPfade, lies }) {
  const besitz = new Set(besitzPfade);
  const gesehen = new Set();
  const offen = [...direkt, ...einstiege].filter((p) => besitz.has(p));
  while (offen.length > 0) {
    const pfad = offen.pop();
    if (gesehen.has(pfad)) continue;
    gesehen.add(pfad);
    for (const spec of relativeImporte(lies(pfad) ?? "")) {
      const ziel = aufgeloest(spec, pfad, besitz);
      if (ziel !== null && !gesehen.has(ziel)) offen.push(ziel);
    }
  }
  return gesehen;
}

/** Verteilte Ganz-Datei-Einheiten eines Profils (Module: die Standard-Module). */
export const verteilteEinheiten = (eintraege, profil) =>
  eintraege.filter((e) => wirdVerteilt(e) && !istVorlage(e) && istGanzeDatei(e) && modulGewaehlt(e, MODUL_STANDARD) && profilGewaehlt(e, profil));

const zeilenZahl = (text) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));
const BESCHREIBUNG_PFAD = /^(?:\.agents\/skills\/[^/]+\/SKILL\.md|\.claude\/agents\/[^/]+\.md)$/;
const beschreibung = (text) => /^description:\s*(.+)$/m.exec(text)?.[1] ?? "";

/** Footprint eines Profils: `{ dateien, zeilen, kontextZeichen, kontextTokens }` (Methode im Kopf der Datei). */
export function footprint(eintraege, profil, lies) {
  const einheiten = verteilteEinheiten(eintraege, profil);
  let zeilen = 0;
  let kontext = 0;
  for (const e of einheiten) {
    const text = lies(e.pfad);
    if (text === null) continue;
    zeilen += zeilenZahl(text);
    if (BESCHREIBUNG_PFAD.test(e.pfad)) kontext += beschreibung(text).length;
  }
  for (const wurzel of ["AGENTS.md", "CLAUDE.md"]) kontext += (lies(wurzel) ?? "").length;
  return { dateien: einheiten.length, zeilen, kontextZeichen: kontext, kontextTokens: Math.ceil(kontext / CHARS_PER_TOKEN) };
}

const sortiert = (o) => Object.entries(o).sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1));
const zeile = ([n, k]) => `  ${String(k).padStart(5)}  ${n}`;

/**
 * Text der Statistik, je Pfad des Besitzes genau ein Abschnitt: `(Aufrufe)` je Art (alle, mit Anzahl), `Genutzt über Einstieg oder Import:` (Skripte ohne eigenen Aufruf, die ein Hook, Workflow,
 * `package.json`-Skript oder ein genutztes Skript einbindet) und `UNGENUTZT:` (verteilt, aber nie vorkommend).
 */
export function formatiere({ aufrufe, ungenutzt, sessions, ueberEinstieg = [] }) {
  const out = [`Sessions: ${sessions}`];
  for (const [art, titel] of [["skripte", "Skripte"], ["skills", "Skills"], ["agenten", "Agenten"]]) {
    out.push(`${titel} (Aufrufe):`, ...(sortiert(aufrufe[art]).map(zeile)), ...(Object.keys(aufrufe[art]).length === 0 ? ["  (keine)"] : []));
  }
  out.push("Genutzt über Einstieg oder Import:", ...ueberEinstieg.map((p) => `  ${p}`), ...(ueberEinstieg.length === 0 ? ["  (keine)"] : []));
  out.push("UNGENUTZT:", ...ungenutzt.map((p) => `  ${p}`), ...(ungenutzt.length === 0 ? ["  (keine)"] : []));
  return out.join("\n");
}

/** Ungenutzte verteilte Einheiten: Skripte (nicht genutzt), Skills und Agenten (kein `Skill`-/`Agent`-Aufruf im Transkript; ein Skill, den ein Agent nur liest, zählt als ungenutzt: Grenze der Zählung). */
export function ungenutzteEinheiten({ eintraege, genutzt, aufrufe }) {
  const skripte = eintraege.filter((e) => istGanzeDatei(e) && /^scripts\/[\w./-]+\.mjs$/.test(e.pfad) && !genutzt.has(e.pfad)).map((e) => e.pfad);
  const skills = eintraege.filter((e) => /^\.agents\/skills\/[^/]+\/SKILL\.md$/.test(e.pfad)).map((e) => e.pfad.split("/")[2]).filter((n) => !(n in aufrufe.skills));
  const agenten = eintraege.filter((e) => /^\.claude\/agents\/[^/]+\.md$/.test(e.pfad)).map((e) => e.pfad.split("/")[2].replace(/\.md$/, "")).filter((n) => !(n in aufrufe.agenten));
  return [...new Set(skripte)].sort().concat(skills.sort().map((n) => `skill:${n}`), agenten.sort().map((n) => `agent:${n}`));
}
