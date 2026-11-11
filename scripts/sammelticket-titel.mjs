// Kein Shebang, keine Importe: das importfreie Blatt der Sammelticket-Titel, der Zeilenerkennung und des Zeilenformats (Klasse, Beleg, Verfall: `pruefeBefundZeile`, `mitVerfall`).`board-lib.mjs` lädt beim Import die Projekt-Config und bricht bei einem
// Fehler ab; wer nur die Titel braucht (offene-punkte, claims-pruefen), importiert sie von hier, ohne Seiteneffekt. `board-lib.mjs` exportiert die Namen weiter.

/** Titel des Sammeltickets für Harness-Befunde (AGENTS.md § Harness-Befunde sind Zeilen). */
export const SAMMELTICKET_TITEL = "Harness-Härtung (gesammelt)";

/** Titel des Sammeltickets für Langfuse-Befunde (Mechanik: docs/ticket-reihenfolge.md). */
export const LANGFUSE_SAMMELTICKET_TITEL = "Langfuse-Befunde (gesammelt)";

/** Titel des freiwilligen Sammeltickets für Codequalität außerhalb des Slices (im eigenen Repo des Beziehers, nur mit `labels.codequalitaet`; Mechanik: docs/ticket-reihenfolge.md). */
export const CODEQUALITAET_SAMMELTICKET_TITEL = "Codequalität (gesammelt)";

/** Alle Sammeltickets, die das Einsortieren kennt (die Ankersuche und das Einsortieren kennen alle, nicht nur das Harness-Sammelticket). */
export const SAMMELTICKET_TITEL_LISTE = [SAMMELTICKET_TITEL, LANGFUSE_SAMMELTICKET_TITEL, CODEQUALITAET_SAMMELTICKET_TITEL];

/** Titel des Rest-Tickets der Sicherheits-Inbox (angelegt von `inbox-start-lib.mjs`). */
export const SICHERHEITS_SAMMELTICKET_TITEL = "Sicherheit: Rest-Befunde (gesammelt)";

/** Alle Sammeltickets inklusive Sicherheits-Rest-Ticket: die eine Quelle für „ist das ein Sammelticket-Titel?“. */
export const ALLE_SAMMELTICKET_TITEL = [...SAMMELTICKET_TITEL_LISTE, SICHERHEITS_SAMMELTICKET_TITEL];

/** Nennt `text` (etwa die Titelzeile eines Prompts) den Titel eines Sammeltickets? Pur. */
export const enthaeltSammelticketTitel = (text) => ALLE_SAMMELTICKET_TITEL.some((t) => String(text).includes(t));

/** Titelpräfix eines Issues, das einen Befund festhält, der sein Ziel-Repo nicht erreichte (Weg: ADR 0031, Fortschreibung zu factory#152). */
export const NICHT_EINTRAGBAR_PRAEFIX = "Nicht eintragbar: ";

/** Gemeinsamer Anfang der Checkbox-Zeilenmuster: Zeilenanfang, Einrückung, Spiegelstrich `-` oder `*`, Leerraum, öffnende Klammer. */
const CHECKBOX_KOPF = String.raw`^\s*[-*]\s+\[`;

/** Die eine Quelle der Zeilenerkennung eines Sammeltickets: eine Checkbox-Zeile (`- [ ]`, auch `*`, eingerückt, offen oder abgehakt `[x]`). Füllstand, Zeilenzählung, Tag-Takt und Meldung benutzen sie. */
export const BEFUND_ZEILE = new RegExp(String.raw`${CHECKBOX_KOPF}[ xX]\]`);

/** Wie `BEFUND_ZEILE`, aber nur offene Zeilen (`[ ]`). */
export const BEFUND_ZEILE_OFFEN = new RegExp(String.raw`${CHECKBOX_KOPF} \]`);

/** Wie `BEFUND_ZEILE` mit Gruppen (aus demselben Kopf): Gruppe 1 = Haken (` `, `x`, `X`), Gruppe 2 = Text nach der Checkbox (ohne CR am Zeilenende). Der Tag-Takt übernimmt damit Haken. */
export const HAKEN_ZEILE = new RegExp(String.raw`${CHECKBOX_KOPF}([ xX])\]\s*(.*?)\r?$`);

/** Ist `zeile` eine offene Checkbox-Zeile (`BEFUND_ZEILE_OFFEN`, die eine Quelle der Zeilenerkennung), deren Text nach Leerraum mit `praefix` beginnt? Pur. */
export function offeneZeileMit(zeile, praefix) {
  const kopf = BEFUND_ZEILE_OFFEN.exec(zeile);
  const rest = kopf === null ? "" : zeile.slice(kopf[0].length);
  return /^\s/.test(rest) && rest.trimStart().startsWith(praefix);
}

/** Die vier Klassen einer Befund-Zeile (Regel: AGENTS.md § Harness-Befunde sind Zeilen, Format in docs/ticket-reihenfolge.md). Groß-/Kleinschreibung zählt. */
export const ZEILEN_KLASSEN = ["Defekt", "Blocker", "Kosmetik", "Hypothese"];

/** Schutzbereiche, deren Zeilen nie verfallen (Hypothese ohne Beleg bleibt dort offen). */
export const SCHUTZBEREICHE = ["Sicherheit", "Fremdtext", "Datenverlust"];

/** Tage von Eintrag bis Verfall einer Kosmetik- oder Hypothese-Zeile (4 Wochen). */
export const VERFALL_TAGE = 28;

const KOPF = /^([^\s:]+)(?: \(([^)]*)\))?:\s/;
const VERFALL_TEIL = /\s+Verfall:[ ]*(\S+)(?=(?:\s*\(aus #\d+\))*\s*$)/;
const AUS_ENDE = /(?:\s*\(aus #\d+\))+\s*$/;
const NUR_MIT_VERFALL = ["Kosmetik", "Hypothese"];

/** Ist `text` genau ein gültiges Datum `JJJJ-MM-TT` (Hin- und Rückumwandlung gleich, also auch kein 30. Februar)? */
const istDatum = (text) => {
  const t = Date.parse(`${text}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === text;
};

/** Pur: `datum` (`JJJJ-MM-TT`) plus `tage` Tage, wieder als `JJJJ-MM-TT` (UTC). */
export const plusTage = (datum, tage) => new Date(Date.parse(`${datum}T00:00:00Z`) + tage * 86_400_000).toISOString().slice(0, 10);

/** Pur: zerlegt eine offene Zeile in Klasse, Schutzbereich, Beleg und Verfall (jeweils `null`, wenn es fehlt); `null`, wenn sie keine offene Checkbox-Zeile ist. */
function zerlege(zeile) {
  const kopf = BEFUND_ZEILE_OFFEN.exec(zeile);
  if (kopf === null) return null;
  const text = zeile.slice(kopf[0].length).trim();
  const k = KOPF.exec(text);
  const verfall = VERFALL_TEIL.exec(text);
  const ohneVerfall = verfall === null ? text : text.replace(VERFALL_TEIL, "");
  const belegTeil = /\bBeleg:\s*(.*)$/.exec(ohneVerfall);
  const beleg = belegTeil === null ? null : belegTeil[1].replace(/(?:^|\s+)Fix:.*$/, "").replace(AUS_ENDE, "").trim();
  return { klasse: k?.[1] ?? null, schutz: k?.[2] ?? null, beleg, verfall: verfall?.[1] ?? null };
}

function klassenFehler({ klasse, schutz }) {
  if (klasse === null) return "keine Klasse (Zeile beginnt mit `<Klasse>: `)";
  if (!ZEILEN_KLASSEN.includes(klasse)) return `unbekannte Klasse „${klasse}“ (erlaubt: ${ZEILEN_KLASSEN.join(", ")})`;
  if (schutz !== null && !SCHUTZBEREICHE.includes(schutz)) return `unbekannter Schutzbereich „${schutz}“ (erlaubt: ${SCHUTZBEREICHE.join(", ")})`;
  return null;
}

function belegFehler({ klasse, schutz, beleg }) {
  if (klasse === "Hypothese" && schutz !== null) return null;
  return beleg !== null && /[\p{L}\p{N}]/u.test(beleg) ? null : "kein Beleg (`Beleg: <Fundstelle|Fehlerausgabe|Messwert>`)";
}

function verfallFehler({ klasse, schutz, verfall }, heute) {
  const braucht = NUR_MIT_VERFALL.includes(klasse) && schutz === null;
  if (verfall === null) return braucht ? `${klasse} ohne Schutzbereich braucht \`Verfall: JJJJ-MM-TT\`` : null;
  if (!braucht) return "Verfall nur bei Kosmetik oder Hypothese ohne Schutzbereich";
  if (!istDatum(verfall)) return `Verfall „${verfall}“ ist kein gültiges Datum (JJJJ-MM-TT)`;
  // ohne `heute` (undefined) ist der Vergleich immer false: dann keine Verfallsprüfung
  return verfall < heute ? `Verfall ${verfall} liegt vor ${heute} (verfallen)` : null;
}

/**
 * Pur: prüft eine Befund-Zeile (Format `- [ ] <Klasse>[ (<Schutzbereich>)]: <Befund> Beleg: <…>[ Verfall: JJJJ-MM-TT]`). `{ ok: true, klasse, schutz, beleg, verfall }`
 * oder `{ ok: false, fehler }`. Mit `heute` (`JJJJ-MM-TT`) gilt eine verfallene Zeile als Mangel.
 */
export function pruefeBefundZeile(zeile, { heute } = {}) {
  const z = zerlege(String(zeile));
  if (z === null) return { ok: false, fehler: "keine offene Checkbox-Zeile (`- [ ] …`)" };
  const fehler = klassenFehler(z) ?? belegFehler(z) ?? verfallFehler(z, heute);
  return fehler === null ? { ok: true, ...z } : { ok: false, fehler };
}

/** Pur: hängt ` Verfall: <heute + VERFALL_TAGE>` an eine Kosmetik- oder Hypothese-Zeile ohne Schutzbereich und ohne Verfallsdatum; sonst unverändert. */
export function mitVerfall(zeile, heute) {
  const z = zerlege(String(zeile));
  if (z === null || z.verfall !== null || z.schutz !== null || !NUR_MIT_VERFALL.includes(z.klasse)) return zeile;
  return `${zeile.trimEnd()} Verfall: ${plusTage(heute, VERFALL_TAGE)}`;
}
