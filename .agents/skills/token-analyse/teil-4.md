# Teil 4: Externer Blick ohne ADRs

Auftrag: der Agent `analyse-extern` liest nur den Export (`git archive HEAD` ohne `docs/adr`) und bewertet, was Kontext und Regeln kosten und nutzen. Er liest keine ADRs und keine Begründungen.

## Messwerte
Grobe Zählungen (Dateien, Zeilen, Regeln), als grob ausgewiesen.

## Fundstellen
Lesepfade: der Bericht listet jeden gelesenen Pfad.

## Unsicherheiten
Lesen per absolutem Pfad ist technisch nicht sperrbar; die Lesepfad-Liste ist der Beleg. Ein Pfad unter `docs/adr` macht den Teil ungültig.
