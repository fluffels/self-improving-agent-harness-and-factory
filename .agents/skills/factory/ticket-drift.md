# Ticket-Drift-Bericht abarbeiten (factory#28)

Der Wochenlauf legt ein Issue „🔎 Ticket-Drift-Bericht <Datum>“ an (Marker `<!-- ticket-drift-bericht -->`). Er enthält Kandidaten, keine Urteile (geprüft: Pfade, Zeilen, Blocker, Board-Reihenfolge, Titel-Ähnlichkeit, Rückstellungen); der Lauf ändert nichts außer dem eigenen Bericht. Der Agent entscheidet selbst (Mechanik: docs/agent-harness.md (Fabrik) § 2.2).

## Vorgehen

1. Bericht-Issue per `node scripts/fremdtext.mjs --issue <nr>` lesen (Befunde sind kein Fremdtext).
2. Je Befund Ticket gegen den Code prüfen, entscheiden:
   - `pfad-entfernt`, `zeile-ausserhalb`, `zeile-verschoben`: Pfad/Zeile im Body nachziehen (Ort per `git log --follow`) oder bei erledigter Sache schließen.
   - `blocker-zu`: Blocker erledigt (Textzeile oder native Kante): Blocker-Zeile im Body streichen und die native Kante lösen: `node scripts/blocker-migration.mjs --loesen` (Trockenlauf), dann mit `--anwenden`; gelöst werden nur Kanten auf geschlossene Blocker im eigenen Repo an Tickets ohne Assignee. Dann einsortieren.
   - `blocker-dahinter`: Ticket vor offenem Blocker: `node scripts/board-place.mjs --after <blocker> <nr>`; Bezug veraltet: Blocker-Zeile streichen bzw. Kante lösen.
   - `duplikat`: beide Tickets lesen. Echtes Duplikat: das jüngere schließen (Verweis aufs ältere, Inhalt ergänzen), sonst nichts ändern.
   - `rueckstellung`: Kein Parken: Begründung gilt noch → im Board einsortieren (unten, wenn unwichtig), sonst schließen; Grund kommentieren.
3. Zahlen, Zeilennummern und Pfade im Text prüft der Lauf nicht: nur in den gelisteten Tickets nachmessen.
4. Tickets mit Fremdeingang („übersprungen“) oder Assignee nicht anfassen, nur im Abschluss nennen.
5. Falschmeldung des Laufs = Harness-Befund: Zeile mit Klasse und Beleg per `node scripts/melden.mjs`.
6. Am Ende das Bericht-Issue schließen, Kommentar mit der Zahl geänderter, geschlossener, unveränderter Tickets.

## Grenzen des Laufs

Nicht erfasst: Pfade in Kommentaren, Blob-URLs, Pfade ohne Backticks, Root-Dateien ohne `/`, Blocker in fremden Repos. Marker und Stoppwörter sind deutsch, sonst meldet `rueckstellung` nie. `blocker-dahinter` vergleicht nur in derselben Spalte eines Boards und nur Blocker mit Nummer im eigenen Repo; ohne `PROJECT_TOKEN` ausgesetzt. Ein Shallow-Klon setzt die Git-Prüfungen aus (im Bericht vermerkt).
