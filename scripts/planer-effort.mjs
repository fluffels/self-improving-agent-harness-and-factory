#!/usr/bin/env node
/**
 * Planer-Klasse (factory#311): bestimmt vor dem Planer-Spawn den Effort des Planers. Regel und Begründung: docs/model-routing.md
 * (Abschnitt „Planer-Effort nach Ticketklasse“, die SSOT); hier nur die Klassifikation.
 *
 *   node scripts/planer-effort.mjs --issue <nr>
 *
 * Ausgabe: genau eine Zeile `high <Grund>` oder `xhigh <Grund>`. Exit 0 = bestimmt, 2 = Aufruf- oder gh-Fehler (dann `xhigh nicht bestimmbar: …`).
 * Fail-closed: nur eine positive, geschlossene Liste ergibt `high` (Sammeltickets, Status-Ticket); alles andere, auch ein unbekannter oder
 * fehlender Titel, ergibt `xhigh`. Der Ticket-Skill setzt `effort: "high"` am Spawn nur bei Exit 0 und einer Ausgabe, die mit `high ` beginnt.
 * Der Kern ist pur, gh und die Projekt-Config werden injiziert (Test).
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ghJson } from "./gh-cli.mjs";
import { AUFRUF_EXIT, direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { designAus } from "./design-lib.mjs";
import { ladeProjektConfig, optionalesLabel } from "./projekt-config-lib.mjs";
import { SAMMELTICKET_TITEL_LISTE } from "./sammelticket-titel.mjs";
import { istEpicTitel } from "./spezifikation-lib.mjs";
import { STATUS_TITEL } from "./board-lib.mjs";

const FLAGS = { issue: { type: "string" } };
const AUFRUF = "Aufruf: node scripts/planer-effort.mjs --issue <nr>";

const hatLabel = (labels, name) => name !== null && labels.some((l) => String(l).trim().toLowerCase() === name.toLowerCase());

/**
 * Pur: `{ effort, grund }` für ein Ticket `{ titel, labels }` und die Projekt-Config. Der erste Treffer zählt:
 * (a) Label `labels.entscheidung` oder `design.label` → `xhigh`; (b) Epic-/Phasen-Titel → `xhigh`; (c) Titel exakt ein Sammelticket → `high`;
 * (d) Titel exakt das Status-Ticket → `high`; (e) alles andere → `xhigh` (fail-closed).
 */
export function planerKlasse({ titel, labels } = {}, config = {}) {
  const alle = Array.isArray(labels) ? labels : [];
  if (hatLabel(alle, optionalesLabel(config, "entscheidung"))) return { effort: "xhigh", grund: "offene Entscheidung" };
  if (hatLabel(alle, designAus(config)?.label ?? null)) return { effort: "xhigh", grund: "Design" };
  const t = typeof titel === "string" ? titel.trim() : "";
  if (istEpicTitel(t)) return { effort: "xhigh", grund: "Epic-Aufteilung" };
  if (SAMMELTICKET_TITEL_LISTE.includes(t)) return { effort: "high", grund: "Sammelticket" };
  if (t === STATUS_TITEL) return { effort: "high", grund: "Routine (Status-Ticket)" };
  return { effort: "xhigh", grund: "unbekannt/Architektur (fail-closed)" };
}

/** Ergebnis `{ out, err, code }` für `argv`; `io = { ticket(nr) → { title, labels: [{name}|string] }, config }`. Ein Fehler gibt `xhigh nicht bestimmbar: <Ursache>` und Exit 2. */
export function lauf(argv, io) {
  const { werte, fehler } = flagsLesen(argv, FLAGS, { pflicht: ["issue"] });
  const kaputt = (text) => ({ out: `xhigh nicht bestimmbar: ${text}\n`, err: `${text}\n${AUFRUF}\n`, code: AUFRUF_EXIT });
  if (fehler) return kaputt(fehler.text);
  if (!/^[1-9]\d*$/.test(werte.issue)) return kaputt(`--issue braucht eine Ticketnummer, nicht „${werte.issue}“`);
  try {
    const t = io.ticket(Number(werte.issue));
    const labels = (t.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name));
    const { effort, grund } = planerKlasse({ titel: t.title, labels }, io.config());
    return { out: `${effort} ${grund}\n`, err: "", code: 0 };
  } catch (e) {
    return kaputt(String(e?.message ?? e).split("\n")[0]);
  }
}

/** Die echte Umgebung: `gh issue view` und die Projekt-Config (beides erst beim Aufruf). */
export const echteUmgebung = () => ({
  ticket: (nr) => ghJson(["issue", "view", String(nr), "--json", "title,labels"]),
  config: () => ladeProjektConfig(),
});

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe: (argv) => ({ fehler: flagsLesen(argv, FLAGS, { pflicht: ["issue"] }).fehler?.text }),
    fehlerErgebnis: (argv) => lauf(argv, {}),
    io: echteUmgebung,
    fuehreAus: (argv, io) => lauf(argv, io),
  });
}
