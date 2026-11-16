#!/usr/bin/env node
/**
 * Filterdurchlauf der Review-Schleife (factory#532, Teil 3/6 von factory#512): ein getrennter, deterministischer Schritt bildet aus den Lens-Berichten einer Runde
 * die Fixliste und die fertige `Runde <n>:`-Zeile. Er liest nur das Findings-Format der Lens (`.claude/agents/factory-lens.md`), ändert die Schwere nie und
 * fasst gleiche Fundstellen über Brillen zusammen (Schlüssel: normalisierte Fundstelle + Schwere).
 *
 *   node scripts/lens-filter.mjs --runde <n> [--ticket <nr>] [--verwerfen F<k>=<Begründung>]… < berichte.md
 *
 * Stichprobenarm (`armAusTicket`, nachweis-lib.mjs): Ticketnummer durch 4 teilbar ⇒ `vollablauf` (blockierend und sollte lösen die nächste Fix-Runde aus),
 * sonst `schlank` (nur blockierend löst den nächsten Pass aus; sollte-Funde werden mit Begründung verworfen oder gefixt, ein Fix zieht einen Delta-Pass nach sich;
 * Hinweise lösen nie etwas aus). Verwerfen: nur Funde der Schwere sollte, nur im Arm `schlank`, nur mit echter Begründung; jeder Verstoß endet mit Exit 2 und verwirft nichts.
 * Ohne `--ticket` gilt das Verhalten von `vollablauf`, ohne Arm-Zeile. Exit 0 = Ausgabe, 2 = Eingabefehler. Der Kern ist pur und exportiert.
 */
import { readFileSync } from "node:fs";
import { flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { BEKANNTE_LENSES, armAusTicket, istLeererWert, normalisiereLens } from "./nachweis-lib.mjs";

export const SCHWEREN = Object.freeze(["blockierend", "sollte", "hinweis"]);

/** Fehler der Eingabe oder des Verwerfen-Auftrags (CLI: Exit 2). */
export class FilterFehler extends Error {}

/** Normalisierte Fundstelle für den Vergleich: trim, kleingeschrieben, `\` zu `/`, Leerraum entfernt. */
export const normalisiereOrt = (ort) => String(ort).trim().toLowerCase().replace(/\\/g, "/").replace(/\s+/g, "");

const FUND_RE = /^\s*-\s*\[[^\]\w]*\s*(blockierend|sollte|hinweis)\s*\]\s*(.*)$/i;

/** Fundstelle der Zeile: der ERSTE Backtick-Abschnitt nach dem Trenner `—` oder `–` (ein Beleg danach darf selbst Code tragen), sonst der letzte mit Pfad-Form (`/`, `.`, `:zeile`); Code im Befundtext zählt nicht als Ort. */
function findeOrt(rest) {
  const kandidaten = [...rest.matchAll(/`([^`]+)`/g)];
  const nachTrenner = kandidaten.filter((m) => /[—–]\s*$/.test(rest.slice(0, m.index)));
  const pfadform = kandidaten.filter((m) => /[/.]|:\d/.test(m[1]));
  return nachTrenner[0] ?? pfadform.at(-1) ?? null;
}

function parseFund(zeile) {
  const m = FUND_RE.exec(zeile);
  if (!m) return null;
  const rest = m[2];
  const ort = findeOrt(rest);
  const befund = (ort ? rest.slice(0, ort.index) : rest).replace(/\s*[—–-]+\s*$/, "").trim();
  const beleg = ort ? rest.slice(ort.index + ort[0].length).replace(/^\s*[—–-]+\s*/, "").trim() : "";
  return { schwere: m[1].toLowerCase(), befund, ort: ort ? ort[1].trim() : "", beleg };
}

/**
 * Kaputte Fundzeile innerhalb des Fund-Bereichs eines Lens-Blocks (bekannte Muster: a, b, c; weitere Formen sind bewusste Grenze):
 * (a) "- [Marke] … — `ort`" mit unbekannter Marke (nicht "[ ]", "[x]" oder ein Markdown-Link), (b) "[Schwere] …" ohne führendes "- " (kein Link),
 * (c) Drei-Teil-Aufzählung "- Befund — `ort` — Beleg" ohne Marke. Nur wenn FUND_RE die Zeile nicht erkennt. Pur.
 * Bewusste Grenze: geprüft wird nur der Fund-Bereich, also der erste Absatz nach dem Verdikt (bis zur ersten Leerzeile) und nie hinter einer Überschrift oder einer Zeile "Außerhalb …"; Scope-Vorschläge und Protokolle gehören in einen eigenen Absatz.
 */
export function istKaputteFundzeile(zeile) {
  if (FUND_RE.test(zeile)) return false;
  const a = /^\s*-\s*\[(?!\s*[xX]?\s*\]|[^\]]*\]\()[^\]]+\][^—–]*[—–]\s*\x60/;
  const b = /^\s*\[[^\]]*(blockierend|sollte|hinweis)[^\]]*\](?!\()/i;
  const c = /^\s*-\s+(?!\[).+\s[—–]\s*\x60[^\x60]+\x60\s*[—–]/;
  return a.test(zeile) || b.test(zeile) || c.test(zeile);
}

/** Zeile, die den Fund-Bereich eines Lens-Blocks beendet: eine Überschrift (ab "##") oder ein Abschnitt "Außerhalb …". */
const beendetFundBereich = (zeile) => /^\s*#{2,}\s/.test(zeile) || /^\s*(\*\*)?\s*Außerhalb\b/i.test(zeile);

const neuerBereich = () => ({ absatz: 0, inhalt: false, leer: false, beendet: false });

/** Führt die Absatz-Zählung eines Lens-Blocks um eine Zeile weiter: Leerzeile nach Inhalt beginnt einen neuen Absatz, Überschrift oder "Außerhalb …" beendet den Fund-Bereich. */
function bereichWeiter(b, zeile) {
  if (zeile.trim() === "") {
    if (b.inhalt && !b.leer) b.absatz++;
    b.leer = true;
  } else {
    b.inhalt = true;
    b.leer = false;
  }
  if (beendetFundBereich(zeile)) b.beendet = true;
}

/** Berichte (mehrere `## Lens: <Name>`-Blöcke) → `[{lens, funde:[{schwere, befund, ort, beleg}]}]`. Wirft `FilterFehler` ohne Lens-Block, bei unbekannter oder doppelter Brille und bei kaputter Fundzeile (`istKaputteFundzeile`). Pur. */
export function parseBerichte(text) {
  const lenses = [];
  let aktuell = null;
  let bereich = neuerBereich();
  for (const zeile of String(text).replace(/\r/g, "").split("\n")) {
    const kopf = /^##\s*Lens:\s*(.+?)\s*$/i.exec(zeile);
    if (kopf) {
      const name = normalisiereLens(kopf[1]);
      if (!BEKANNTE_LENSES.includes(name)) throw new FilterFehler(`unbekannte Brille "${kopf[1]}" (bekannt: ${BEKANNTE_LENSES.join(", ")})`);
      if (lenses.some((l) => l.lens === name)) throw new FilterFehler(`Brille ${name} kommt doppelt vor`);
      aktuell = { lens: name, funde: [] };
      lenses.push(aktuell);
      bereich = neuerBereich();
      continue;
    }
    bereichWeiter(bereich, zeile);
    if (aktuell && bereich.absatz <= 1 && !bereich.beendet && istKaputteFundzeile(zeile)) throw new FilterFehler(`Brille ${aktuell.lens}: Fundzeile ohne gültige Schwere-Marke oder ohne führendes "- ": ${zeile.trim()}`);
    const fund = aktuell ? parseFund(zeile) : null;
    if (fund) aktuell.funde.push(fund);
  }
  if (lenses.length === 0) throw new FilterFehler("kein Lens-Block gefunden (erwartet: `## Lens: <Name>` mit Funden im Findings-Format)");
  return lenses;
}

const zaehle = (funde, schwere) => funde.filter((f) => f.schwere === schwere).length;

/** `Runde <n>: lenses=… blocker=… sollte=… hinweis=…` über die Original-Funde je Brille (Format: Skill review-lenses). Pur. */
export function rundenZeile(runde, lenses) {
  const je = (schwere) => lenses.map((l) => `${l.lens}:${zaehle(l.funde, schwere)}`).join(",");
  return `Runde ${runde}: lenses=${lenses.map((l) => l.lens).join(",")} blocker=${je("blockierend")} sollte=${je("sollte")} hinweis=${je("hinweis")}`;
}

/** Fixliste: Funde `blockierend` und `sollte`, gleiche Fundstelle und Schwere über Brillen zu einem Eintrag; IDs `F1…Fn` nach Schwere, dann Fundstelle. Hinweise stehen nicht darin. Die Schwere bleibt unverändert. Pur. */
export function bildeFixliste(lenses) {
  const nachSchluessel = new Map();
  for (const { lens, funde } of lenses) {
    for (const f of funde.filter((x) => x.schwere !== "hinweis")) {
      const ort = f.ort === "" ? `befund:${f.befund.toLowerCase()}` : normalisiereOrt(f.ort);
      const schluessel = `${f.schwere}|${ort}`;
      const e = nachSchluessel.get(schluessel) ?? { schwere: f.schwere, ort: f.ort || "(ohne Ort)", sortOrt: ort, brillen: [], befunde: [] };
      if (!e.brillen.includes(lens)) e.brillen.push(lens);
      e.befunde.push(f.befund);
      nachSchluessel.set(schluessel, e);
    }
  }
  const rang = (s) => SCHWEREN.indexOf(s);
  return [...nachSchluessel.values()]
    .sort((a, b) => rang(a.schwere) - rang(b.schwere) || (a.sortOrt < b.sortOrt ? -1 : a.sortOrt > b.sortOrt ? 1 : 0))
    .map((e, i) => ({ id: `F${i + 1}`, schwere: e.schwere, ort: e.ort, brillen: e.brillen, befunde: e.befunde }));
}

/** Eine Begründung gilt als leer: leer, nur Leerraum oder Platzhalter (`…`, `...`, `-`, `<…>`). */
export const istLeereBegruendung = istLeererWert;

/** Wendet Verwerfen-Aufträge `[{id, begruendung}]` auf die Fixliste an. Alles oder nichts: bei einem Verstoß (Arm `vollablauf`, unbekannte ID, Schwere blockierend,
 *  leere Begründung, doppelte ID) wirft `FilterFehler`, die Eingabe bleibt unverändert. Sonst `{fixliste, verworfen}`. Pur. */
export function verwerfe(fixliste, auftraege, arm) {
  if (auftraege.length === 0) return { fixliste, verworfen: [] };
  if (arm !== "schlank") throw new FilterFehler("Verwerfen gibt es nur im Arm schlank (mit --ticket; im Kontrollarm vollablauf lösen sollte-Funde eine Fix-Runde aus)");
  const ids = new Set();
  for (const { id, begruendung } of auftraege) {
    const fund = fixliste.find((e) => e.id === id);
    if (!fund) throw new FilterFehler(`${id}: unbekannte Fund-ID (Fixliste: ${fixliste.map((e) => e.id).join(", ") || "leer"})`);
    if (fund.schwere === "blockierend") throw new FilterFehler(`${id}: ein Fund der Schwere blockierend wird nie verworfen, nur gefixt`);
    if (istLeereBegruendung(begruendung)) throw new FilterFehler(`${id}: Verwerfen braucht eine Begründung (leer, …, - zählt nicht)`);
    if (ids.has(id)) throw new FilterFehler(`${id}: doppelt verworfen`);
    ids.add(id);
  }
  return {
    fixliste: fixliste.filter((e) => !ids.has(e.id)),
    verworfen: auftraege.map((a) => ({ ...fixliste.find((e) => e.id === a.id), begruendung: a.begruendung.trim() })),
  };
}

/** Löst nach dem Verwerfen noch ein Pass aus? `delta-noetig`, wenn die (restliche) Fixliste einen Eintrag hat (Arm `schlank`: nur blockierend oder ein gefixter sollte-Fund, den der Umsetzer nicht verwirft; `vollablauf`: blockierend oder sollte), sonst `konvergiert`. Pur. */
export const passUrteil = (fixliste) => (fixliste.length > 0 ? "delta-noetig" : "konvergiert");

/** Ganzer Durchlauf: `{arm, fixliste, verworfen, runde, pass}`; `ticket` null ⇒ kein Arm. Pur. */
export function filtere({ text, runde, ticket = null, verwerfen: auftraege = [] }) {
  if (!Number.isInteger(runde) || runde < 1) throw new FilterFehler("--runde braucht eine ganze Zahl ≥ 1");
  const arm = ticket === null ? null : armAusTicket(ticket);
  const lenses = parseBerichte(text);
  const roh = bildeFixliste(lenses);
  const { fixliste, verworfen } = verwerfe(roh, auftraege, arm);
  return { arm, fixliste, verworfen, rundenZeile: rundenZeile(runde, lenses), pass: passUrteil(fixliste), runde };
}

/** Textausgabe des Ergebnisses. Pur. */
export function formatiere(e) {
  const zeilen = [`Fixliste Runde ${e.runde}${e.arm ? ` (arm=${e.arm})` : ""}:`];
  if (e.fixliste.length === 0) zeilen.push("(leer)");
  for (const f of e.fixliste) zeilen.push(`${f.id} [${f.schwere}] \`${f.ort}\` — Brillen: ${f.brillen.join(", ")} — ${f.befunde.join(" | ")}`);
  for (const v of e.verworfen) zeilen.push(`verworfen ${v.id} [${v.schwere}] \`${v.ort}\` — Begründung: ${v.begruendung}`);
  zeilen.push(e.rundenZeile);
  if (e.arm) zeilen.push(`arm=${e.arm}`);
  zeilen.push(`pass: ${e.pass}`);
  return zeilen.join("\n");
}

const OPTIONEN = { runde: { type: "string" }, ticket: { type: "string" }, verwerfen: { type: "string", multiple: true } };

const ganzzahl = (name, wert) => {
  if (wert === undefined) return null;
  if (!/^\d+$/.test(wert)) throw new FilterFehler(`--${name} braucht eine ganze Zahl`);
  return Number(wert);
};

/** Argumente → `{runde, ticket, verwerfen}` über `flagsLesen`; wirft `FilterFehler`. Pur. */
export function liesArgumente(argv) {
  const { werte, fehler } = flagsLesen(argv, OPTIONEN);
  if (fehler) throw new FilterFehler(fehler.text);
  const verwerfen = (werte.verwerfen ?? []).map((v) => {
    const m = /^(F\d+)=([\s\S]*)$/.exec(v);
    if (!m) throw new FilterFehler("--verwerfen braucht F<k>=<Begründung>");
    return { id: m[1], begruendung: m[2] };
  });
  return { runde: ganzzahl("runde", werte.runde) ?? Number.NaN, ticket: ganzzahl("ticket", werte.ticket), verwerfen };
}

function main(argv = process.argv.slice(2)) {
  try {
    const args = liesArgumente(argv);
    console.log(formatiere(filtere({ text: readFileSync(0, "utf8"), ...args })));
  } catch (e) {
    if (!(e instanceof Error)) throw e;
    console.error(`lens-filter: ${e.message}`);
    process.exit(2);
  }
}

if (istDirektaufruf(import.meta.url)) main();
