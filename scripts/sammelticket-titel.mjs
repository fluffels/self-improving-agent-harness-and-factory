// Kein Shebang, keine Importe: das importfreie Blatt der Sammelticket-Titel und der Zeilenerkennung.`board-lib.mjs` lädt beim Import die Projekt-Config und bricht bei einem
// Fehler ab; wer nur die Titel braucht (offene-punkte, claims-pruefen), importiert sie von hier, ohne Seiteneffekt. `board-lib.mjs` exportiert die Namen weiter.

/** Titel des Sammeltickets für Harness-Befunde (AGENTS.md § Harness-Befunde sind Zeilen). */
export const SAMMELTICKET_TITEL = "Harness-Härtung (gesammelt)";

/** Titel des Sammeltickets für Langfuse-Befunde (Mechanik: docs/ticket-reihenfolge.md). */
export const LANGFUSE_SAMMELTICKET_TITEL = "Langfuse-Befunde (gesammelt)";

/** Titel des freiwilligen Sammeltickets für Codequalität außerhalb des Slices (im eigenen Repo des Beziehers, nur mit `labels.codequalitaet`; Mechanik: docs/ticket-reihenfolge.md). */
export const CODEQUALITAET_SAMMELTICKET_TITEL = "Codequalität (gesammelt)";

/** Alle Sammeltickets, die das Einsortieren kennt (die Ankersuche und das Einsortieren kennen alle, nicht nur das Harness-Sammelticket). */
export const SAMMELTICKET_TITEL_LISTE = [SAMMELTICKET_TITEL, LANGFUSE_SAMMELTICKET_TITEL, CODEQUALITAET_SAMMELTICKET_TITEL];

/** Titelpräfix eines Issues, das einen Befund festhält, der sein Ziel-Repo nicht erreichte (Weg: ADR 0031, Fortschreibung zu factory#152). */
export const NICHT_EINTRAGBAR_PRAEFIX = "Nicht eintragbar: ";

/** Gemeinsamer Anfang der Checkbox-Zeilenmuster: Zeilenanfang, Einrückung, Spiegelstrich `-` oder `*`, Leerraum, öffnende Klammer. */
const CHECKBOX_KOPF = String.raw`^\s*[-*]\s+\[`;

/** Die eine Quelle der Zeilenerkennung eines Sammeltickets: eine Checkbox-Zeile (`- [ ]`, auch `*`, eingerückt, offen oder abgehakt `[x]`). Füllstand, Zeilenzählung, Tag-Takt und Meldung benutzen sie. */
export const BEFUND_ZEILE = new RegExp(String.raw`${CHECKBOX_KOPF}[ xX]\]`);

/** Wie `BEFUND_ZEILE`, aber nur offene Zeilen (`[ ]`). */
export const BEFUND_ZEILE_OFFEN = new RegExp(String.raw`${CHECKBOX_KOPF} \]`);

/** Wie `BEFUND_ZEILE` mit Gruppen (aus demselben Kopf): Gruppe 1 = Haken (` `, `x`, `X`), Gruppe 2 = Text nach der Checkbox (ohne CR am Zeilenende). Der Tag-Takt übernimmt damit Haken. */
export const HAKEN_ZEILE = new RegExp(String.raw`${CHECKBOX_KOPF}([ xX])\]\s+(.*?)\r?$`);
