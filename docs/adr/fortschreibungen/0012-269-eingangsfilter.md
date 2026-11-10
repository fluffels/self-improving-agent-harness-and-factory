# Fortschreibung #269 (2026-11-10): Eingangsfilter für Harness-Zeilen

Ergänzt [ADR 0012](../0012-harness-autonomie-audit-spur.md), das „Härtung gegen Hypothetisches“ selbst als Risiko nennt. Präzisiert „Kein Parken“ (AGENTS.md).

## Kontext

Die Schleife „Befund, Zeile, Sammelticket, Lauf, neue Befunde“ hatte keinen Eingangsfilter: Agent, Planer, Umsetzer, Lens, Abnahme, Doctor-Wochenlauf und Status-Lauf schrieben Zeilen ohne Prüfung, und jeder Sammel-PR änderte Regeln und Wächter, die die nächste Lens wieder prüfte. **Messbasis: Messung der Maintainerin laut Ticket, nicht nachgemessen** (fünf Ticketläufe, lokale Transkripte, Untergrenze; 3,5 $ und 27 min für ein Ein-Zeilen-Ticket, 33 $ und 122 min für ein Sammelticket; Treiber ist die Zahl der Requests).

## Entscheidung

**Entscheidung: eine Harness-Zeile entsteht nur mit Klasse und Beleg; `Kosmetik` und `Hypothese` stehen höchstens mit Verfall nach 4 Wochen und fallen danach ohne Umsetzung weg, weil ein Eintrag ohne Beleg und ohne Wirkung die Schleife nur füttert.** Der Verfall ist begründetes Verwerfen mit Spur (Ergebnis „verfallen“ im PR), kein Parken. Sicherheit, Fremdtext und Datenverlust verfallen nie; eine Hypothese dort bleibt auch ohne Beleg offen (gleiche Logik wie ADR 0027 Abschnitt 6). Die Prüfung sitzt in `melden.mjs` und in den automatischen Erzeugern (Doctor, gescheiterte Reparatur), nicht in `bereiteMeldung`, weil dieses auch Wiedervorlage und die Sicherheits-Inboxen bedient. Ein fehlendes Verfallsdatum ergänzt `melden.mjs` (heute plus 28 Tage), statt abzulehnen: jeder Fehlversuch kostet Requests. Zeilenformat, Klassen und Füllstand-Wirkung stehen in `docs/ticket-reihenfolge.md` (Sammelticket-Mechanik); die Regel in AGENTS.md.

## Verworfen

- **Maschinelle Dublettenprüfung in `melden.mjs`:** der Übertrag des Rests aus dem geclaimten Vorgänger wäre selbst eine Dublette, ein exakter Textvergleich fängt keine Umformulierungen. Es bleibt eine Textregel (vor dem Eintrag gegen offene Zeilen lesen).
- **Füllstand nach Klasse zählen:** bräuchte eine Übergangsregel für den Altbestand ohne Klasse; das Ticket verlangt nur die Beschreibung. Der Takt zählt weiter jeden Befund-Kommentar.
- **Eine Zeile ohne Verfall ablehnen:** teurer als das Ergänzen.

## Konsequenzen

- Altzeilen ohne Klasse bleiben gültig; beim Übertrag des Rests verlangt `melden.mjs` Klasse und Beleg. Nichts wird still gelöscht.
- Weniger Zeilen: das Sammelticket füllt sich langsamer, der Takt holt es seltener.
- Grenze des Wächters (`test/harness/befund-zeile.test.ts`): geschlossene Liste der Erzeuger-Texte; Umformulierungen und die Sicherheits-Inboxen erkennt er nicht. Der Beleg wird nur syntaktisch geprüft (mindestens ein Wort oder eine Zahl): ein inhaltsleerer Beleg wie „keiner“ besteht. Der Verfall ist das letzte Feld der Zeile (davor oder danach nur `(aus #n)`).
- Codex liest AGENTS.md nativ und nutzt dasselbe `melden.mjs`; `docs/codex/` hat keinen Sammelticket-Text, es gibt keinen eigenen Adapter.
