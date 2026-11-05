# Fortschreibung #202 (2026-11-04): Evidenz für Gates liefert die Gate-Fundquote

Ergänzt [ADR 0027](../0027-regeln-lockern.md) (Regeln, Gates und Lenses evidenzbasiert lockern); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Ausgangslage:** der Abschnitt „Konsequenzen“ von ADR 0027 hielt fest, dass für Gates die Evidenz Handarbeit bleibt, bis eine Messung je Teil-Gate vorliegt. Diese Messung gibt es seit factory#39.
- **Entscheidung (Evidenz für Gates):** für ein Gate liefert `node scripts/gate-fundquote.mjs` die Zahlen je Teil-Gate von `verify` (Läufe, die es erreicht haben, davon rot, Median-Dauer; Quellen: Claude-Transkripte und CI-Logs). Ein Lockern-Kandidat unter den Gates stützt sich auf diese Zeilen, nicht mehr auf eine von Hand gezählte Stichprobe; die Schritte und Schwellen des Verfahrens in ADR 0027 bleiben unverändert.
- **Grenze (Handarbeit):** für Codex-Sitzungen (das Werkzeug liest nur Claude-Transkripte und CI-Logs) und für Prompt-Regeln (Agenten-, Skill- und Lens-Texte; die Messung hängt an quellprojekt#1362) bleibt die Evidenz Handarbeit.
- **Unverändert:** der Wortlaut des ursprünglichen ADR-Abschnitts; diese Datei ergänzt ihn nur.
