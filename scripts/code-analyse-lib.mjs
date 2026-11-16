// Kein Shebang, kein Direktaufruf: pure Lib der Code-Analyse (Monatslauf, factory#596). Der Monatslauf `code-analyse.mjs` legt ohne Modell genau ein Takt-Ticket im eigenen Repo an;
// ein normaler Agentenlauf arbeitet es ab (Code-Funde als Zeilen per `melden.mjs --ziel refactoring`, Sicherheitsfunde als Notfall-Issue). Ohne Netz in dieser Lib.
// Grenzen: das Ticket trägt nur festen Text und das Datum, nie Repo-Inhalte; jedes offene Takt-Ticket (auch ein geclaimtes) unterdrückt den nächsten Lauf.
import { istFremdeingang } from "./fremdtext-lib.mjs";

/** Titelpräfix des Takt-Tickets (der Monat folgt; höchstens ein offenes Ticket über alle Monate). */
export const TITEL_PRAEFIX = "🧭 Code-Analyse ";
/** Marker im Body: Dedupe-Schlüssel neben Titelpräfix und vertrautem Autor. */
export const MARKER = "<!-- code-analyse -->";
/** Höchstzahl der Zeilen je Lauf (wie der Deckel der Sammeltickets). */
export const ZEILEN_DECKEL = 12;

/** Titel des Takt-Tickets: `🧭 Code-Analyse <JJJJ-MM>`. Pur. */
export const titel = (datum) => `${TITEL_PRAEFIX}${String(datum).slice(0, 7)}`;

/** Ist `issue` (`{ title, body, user, labels }`) ein Takt-Ticket: Marker im Body, Titelpräfix und vertrauter Autor (kein Fremdeingang)? Pur. */
export const istTicket = (issue, owner, config) =>
  String(issue?.body ?? "").includes(MARKER) && String(issue?.title ?? "").startsWith(TITEL_PRAEFIX) && !istFremdeingang({ user: issue.user, labels: issue.labels }, owner, { config }).fremdeingang;

/** Die Entscheidung: `nichts`, wenn ein vertrautes Takt-Ticket offen ist (auch geclaimt), sonst `anlegen`. Pur. */
export function entscheide({ offene, owner, config }) {
  const da = offene.filter((i) => istTicket(i, owner, config));
  if (da.length > 0) return { aktion: "nichts", grund: `Takt-Ticket #${da[0].number} der Code-Analyse ist noch offen`, warnungen: [] };
  return { aktion: "anlegen", grund: "kein offenes Takt-Ticket", warnungen: [] };
}

const CODE_ABSCHNITT = [
  "## Code (Refactoring)",
  "",
  "Prüfe nacheinander die Kategorien **Refactoring**, **Duplikate**, **Komplexität** und **Testlücken** im eigenen Repo (lesen, kein Messlauf, keine neuen Werkzeuge).",
  `Melde je Fund eine Zeile: \`node scripts/melden.mjs --ziel refactoring --zeile "<Klasse>: … Beleg: …"\` (Klassen und Beleg: docs/ticket-reihenfolge.md § Sammelticket-Mechanik). Höchstens ${ZEILEN_DECKEL} Zeilen je Lauf; ohne Beleg keine Zeile.`,
];

const SICHERHEIT_ABSCHNITT = [
  "## Sicherheit",
  "",
  "Prüfe das Repo auf Sicherheitsprobleme im Code (Eingaben, Secrets, Rechte, Abhängigkeiten). Ein Fund wird ein Notfall-Issue `🔒 Security: …` im eigenen Repo (Board-Platz: `node scripts/board-place.mjs --notfall security --top`), **ohne Exploit-Details** (Verweis auf SECURITY.md).",
  "Ergänzung, keine Dopplung: offene Alerts von `codeql.yml` (CodeQL) und die Konfigurationsabweichungen von `sicherheitspruefung.yml` nur referenzieren, nicht erneut melden. Mehr: docs/sicherheit-agenten.md.",
];

/** Markdown-Body des Takt-Tickets (der Abarbeitungs-Ablauf). Mit `refactoring.an === false` entfällt der Code-Abschnitt (Zeile `Code-Teil: abgeschaltet`), die Sicherheitsanalyse bleibt. Pur und deterministisch. */
export function ticketText({ datum, refactoring }) {
  const code = refactoring?.an === false ? ["## Code (Refactoring)", "", `Code-Teil: abgeschaltet (${refactoring.quelle === "aus" ? "labels.refactoring: false" : "kein Schlüssel labels.refactoring und kein Bezieher"})`] : CODE_ABSCHNITT;
  return [MARKER, `Monatliche Code- und Sicherheitsanalyse (${String(datum).slice(0, 10)}). Arbeite das Ticket in einem normalen Agentenlauf ab und schließe es danach; ein offenes Ticket unterdrückt neue Läufe. Mechanik: docs/ticket-reihenfolge.md § Code-Analyse.`, "", ...code, "", ...SICHERHEIT_ABSCHNITT].join("\n");
}
