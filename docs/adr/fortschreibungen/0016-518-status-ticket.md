# Fortschreibung #518 (2026-11-16): Status-Ticket nur bei Anlass

Ergänzt [ADR 0016](../0016-langfuse-takt-woechentlich.md) und die Fortschreibung [0016-314](0016-314-wochenbericht-statt-wochenlauf.md) um die Entscheidung aus Teil 9 von factory#518 (Kind factory#579): was ein wiederkehrendes Agenten-Ticket neben der Token-Analyse noch braucht.

## Kontext

Die Token-Analyse (Skill `token-analyse`, Teile 0 bis 6) und der lokale Wochenbericht decken die zwölf Punkte der Checkliste [Langfuse-Status überprüfen](../../model-routing.md#langfuse-status-überprüfen-1293) fast vollständig ab. Das wöchentliche Status-Ticket ließe dieselben Punkte ein zweites Mal von einem Agenten abarbeiten.

## Entscheidung

Entscheidung: die zwölf Punkte werden einzeln entschieden (Tabelle in [model-routing.md](../../model-routing.md#langfuse-status-überprüfen-1293), vom Doku-Wächter in `test/harness/langfuse-erfassung.test.ts` auf Vollständigkeit geprüft): zehn gehen in die Teile 0 bis 3 und 5 der Analyse auf, die Punkte 1 und 2 bleiben als Skript im Wochenbericht-Lauf ohne Ticket. Punkt 4 geht abweichend von der Arbeitsannahme des Tickets nach Teil 1 und Teil 0 (`ci-fix-runden`) statt in ein neues Skript im Wochenbericht, weil Transkripte und Register die Fehlschläge schon liefern. Übrig bleibt der **Anlass** (Datenverlust, Diagnose): einen solchen ordnet ein Agent ein, deshalb entfällt das Ticket nicht ganz, sondern entsteht nur noch bei einem Anlass.

Dafür gibt es den optionalen Config-Wert `langfuseWochenbericht.statusTicket` (`"takt"` = Standard und Verhalten ohne das Feld, `"nur-anlass"`). Mit `"nur-anlass"` entfällt der Höchstabstand des Montags-Crons; `wochenOhneLaufMax` zusammen damit ist ein Konfigurationsfehler (ohne Wirkung). Der Push-Zähler legte mit dem Wochenbericht ohnehin nicht mehr an. Die Fabrik (`.factory/projekt.json`) setzt `"nur-anlass"`. Der Takt-Auslöser wird abgeschaltet, nicht der Kern-Takt gelöscht: der Bezieher-Takt in `board-takt.mjs` und `langfuse-takt.mjs` bleibt unverändert, ein Bezieher-Selbstcheck wird vom Plan des ersten Analyselaufs entschieden, nicht hier.

Verworfen: das Ticket ganz abschaffen. Ein Anlass des Wochenbericht-Laufs ginge dann still verloren oder bräuchte einen neuen Workflow samt Dispatch-Ziel im Kern.

## Re-Evaluierung

Der Höchstabstand-Teil der Fortschreibung 0016-314 entfällt in der Fabrik; seine Netz-Funktion (verpasste Woche) übernimmt der Monatstakt der Analyse. Die Verdichtungstabelle bekommt in der Fabrik keine neuen Zeilen, der datierte Schnappschuss der Analyse ersetzt sie. Wirkung und Rückfall: Registerzeile `status-ticket-nur-anlass-579` im Änderungsregister (Messgröße `kosten-je-ticket`, Toleranz Nacharbeit-Quote).

## Grenzen

- Ein Bezieher hat weiter den wöchentlichen Takt (Standard `"takt"`), bis ein Ersatz entschieden ist.
- Ein Anlass bei offenem Status-Ticket führt weiter nur zu `nach-oben`; der Mindestabstand von 24 Stunden bleibt.
- Ein Kosten-Anlass geht an die Analyse (`node scripts/token-analyse-ausloesen.mjs --anlass kosten`), nicht in dieses Ticket.

- `"nur-anlass"` ist für die Fabrik gedacht: die Token-Analyse ist fabrik-eigen. Ein Bezieher, der ihn setzt, verliert die periodische Auswertung ohne Ersatz; der Validator verbietet es nicht (er kennt den Bezieher nicht), der Standard `"takt"` bleibt.
- Punkt 2: Erreichbarkeit und Hook-/Plugin-Ausfall meldet der Wochenbericht; die MCP-Verbindung belegt die Vorbedingung vor jedem Ticketlauf, Hook-Patch und Plugins der Probe-Lauf der Erfassung; `pending_agent_turns` und die Lokalität der Basis-URL prüft in der Fabrik kein Lauf mehr (bewusst hingenommene Lücke).

## Folgen

- Der Body des Status-Tickets nennt mit `"nur-anlass"` nur den Anlass (Zeile „Umfang“), keine Kennzahlen-Aufträge und keine Verdichtungszeile; ohne das Feld bleibt er byte-gleich.
- Neues optionales Config-Feld, Migration für Bezieher: keine Aktion.
