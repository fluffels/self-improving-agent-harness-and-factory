// Kein Shebang, keine Importe: reine Lib für den Produktbezug-Hinweis der Ticket-Auswahl (`naechstes-ticket.mjs`, factory#220 L44).
//
// Ein Ticket, das aus einem anderen Repo übertragen wurde, nennt Pfade, die es hier nicht gibt. `fehlendePfadwurzeln` liefert die ersten Pfadsegmente
// der Pfade, die im Body als Inline-Code (`einfache Backticks`) stehen, mit einem `/` und deren erstes Segment im Repo fehlt (`existiert(wurzel)`).
// Grenze (geschlossene Liste, nur ein Hinweis, nie ein Überspringen): ausgenommen sind Platzhalter `<…>`, URLs (`://`), absolute Pfade (`/…`, `C:\…`), `~`,
// Pfade mit `..`, Inline-Code mit Leerraum (Befehle), Verweise mit `#` oder `:` (Repo-Verweise, Labels) und alles außerhalb von Inline-Code. Ein Repo-Name
// `owner/name` ohne `#` im Inline-Code gilt als Pfad (falscher Alarm möglich, darum nur ein Hinweis). Geprüft wird nur die Wurzel: neue Dateien unter
// einem vorhandenen Ordner sind der Normalfall.

const INLINE_CODE = /`([^`\n]+)`/g;
const MAX_ANZEIGE = 5;

/** Das erste Segment eines Pfad-Kandidaten oder `null`, wenn der Inline-Code kein relativer Repo-Pfad im Sinn der Grenze ist. Pur. */
function wurzelVon(roh) {
  const text = roh.trim();
  if (!text.includes("/") || /\s/.test(text) || /[<>#:\\]/.test(text)) return null;
  if (text.startsWith("~")) return null;
  const segmente = text.split("/");
  if (segmente.includes("..")) return null;
  return segmente[0] === "" || segmente[0] === "." ? null : segmente[0];
}

/** Pur: die sortierten, eindeutigen Pfadwurzeln aus den Inline-Code-Pfaden von `body`, die `existiert(wurzel)` verneint. */
export function fehlendePfadwurzeln(body, existiert) {
  const fehlend = new Set();
  for (const m of String(body).matchAll(INLINE_CODE)) {
    const wurzel = wurzelVon(m[1]);
    if (wurzel !== null && !existiert(wurzel)) fehlend.add(wurzel);
  }
  return [...fehlend].sort();
}

/** Pur: die Hinweiszeile(n) zum Kandidaten `nr` (`[]` ohne fehlende Wurzel oder ohne Prüfer `existiert`); höchstens `MAX_ANZEIGE` Wurzeln, der Rest als „…“. */
export function pfadHinweis(nr, body, existiert) {
  if (typeof existiert !== "function") return [];
  const wurzeln = fehlendePfadwurzeln(body, existiert);
  if (wurzeln.length === 0) return [];
  const liste = [...wurzeln.slice(0, MAX_ANZEIGE), ...(wurzeln.length > MAX_ANZEIGE ? ["…"] : [])].join(", ");
  return [`#${nr} nennt Pfade ohne Wurzel im Repo (${liste}): Produktbezug prüfen, ggf. Ticket ins Produkt-Repo übertragen`];
}
