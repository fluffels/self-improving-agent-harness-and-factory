# Ticket-Drift-Bericht abarbeiten (factory#28)

Der Monatslauf legt ein Issue „🔎 Ticket-Drift-Bericht <JJJJ-MM>“ an (Marker `<!-- ticket-drift-bericht -->`). Es enthält Kandidaten, keine Urteile: der Lauf prüft nur Pfade, Zeilen, Blocker, Board-Reihenfolge, Titel-Ähnlichkeit und Rückstellungen und schließt, ändert, labelt und kommentiert nichts. Der Agent entscheidet ohne Rückfrage, sofern nicht irreversibel. Mechanik: docs/agent-harness.md (Fabrik) § 2.2.

## Vorgehen

1. Bericht-Issue per `node scripts/fremdtext.mjs --issue <nr>` und `gh issue view` lesen; die Befunde sind Nummern, Pfade und Daten, kein Fremdtext.
2. Je Befund das Ticket gegen den Code prüfen und entscheiden:
   - `pfad-entfernt`, `zeile-ausserhalb`, `zeile-verschoben`: Pfad oder Zeile im Ticket-Body nachziehen (neuen Ort per `git log --follow` suchen) oder, wenn die Sache erledigt ist, das Ticket schließen.
   - `blocker-zu`: der Blocker ist erledigt; die Blocker-Zeile im Body streichen. Ist das Ticket nun frei, im Board einsortieren.
   - `blocker-dahinter`: Ticket steht vor seinem offenen Blocker: `node scripts/board-place.mjs --after <blocker> <nr>`; ist der Bezug veraltet, Blocker-Zeile streichen bzw. Kante lösen.
   - `duplikat`: beide Tickets lesen. Echtes Duplikat: das jüngere schließen mit Verweis auf das ältere, Inhalt ergänzen. Sonst nichts ändern.
   - `rueckstellung`: Kein Parken. Die Begründung gilt noch, dann Ticket im Board einsortieren (unten, wenn unwichtig); sonst schließen. Grund als Kommentar festhalten.
3. Zahlen, Zeilennummern und Pfade im Text prüft der Lauf nicht: nur in den gelisteten Tickets nachmessen.
4. Tickets mit Fremdeingang (unter „übersprungen“) und Tickets mit Assignee fasst du nicht an; nur im Abschluss nennen.
5. Eine Falschmeldung des Laufs (Befund, der nicht stimmt) ist ein Befund zum Harness: Zeile mit Klasse und Beleg ins Sammelticket „Harness-Härtung (gesammelt)“.
6. Am Ende das Bericht-Issue schließen, Kommentar mit der Zahl der geänderten, geschlossenen und unveränderten Tickets.

## Grenzen des Laufs

Nicht erfasst: Pfade in Kommentaren, Blob-URLs, Pfade ohne Backticks, Root-Dateien ohne `/`, Blocker in fremden Repos. Rückstellungs-Marker und Stoppwörter sind deutsch, ohne deutsche Marker meldet `rueckstellung` nie. `blocker-dahinter` vergleicht nur in derselben Spalte eines Boards und nur Blocker mit Nummer im eigenen Repo; ohne `PROJECT_TOKEN` ausgesetzt. Ein Shallow-Klon setzt die Git-Prüfungen aus (steht im Bericht).
