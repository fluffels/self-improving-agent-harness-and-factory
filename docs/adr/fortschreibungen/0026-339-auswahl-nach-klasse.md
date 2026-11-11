# Fortschreibung #339 (2026-11-11): Der Planer wählt Sammelticket-Zeilen nach Klasse

Ergänzt [ADR 0026](../0026-sammelticket-gruppen.md) und löst in der [Fortschreibung #268](0026-268-sammelticket-deckel.md) nur den Satz „Der Planer wählt in Kommentar-Reihenfolge, älteste zuerst“ ab; Deckel, Dateigrenze und „der Umsetzer verkleinert nur vom Ende her“ bleiben. Die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Auslöser:** Bei einem Rückstau an Zeilen setzte die Alterswahl Kosmetik vor Defekte, solange sie älter war; Defekte wanderten in den Rest.
- **Entscheidung:** Der Planer wählt nach Klasse: `Defekt` und `Blocker` zuerst, danach `Hypothese` und `Kosmetik`, bevorzugt Zeilen, deren Dateien die Auswahl schon berührt; innerhalb davon gilt die Kommentar-Reihenfolge, älteste zuerst. Wortlaut der Regel: [Ticket-Reihenfolge](../../ticket-reihenfolge.md#sammelticket-mechanik).
- **Verworfen:** reine Alterswahl (siehe Auslöser). Eine Gewichtung über die Klasse hinaus (Aufwand je Zeile) wäre eine Schätzung ohne Beleg.
