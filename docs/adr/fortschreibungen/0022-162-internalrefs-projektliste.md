# Fortschreibung #162 (2026-11-04): Ring von `check-internalrefs` nach der Projektliste

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) §„Startbestand“, die Fortschreibung steht als Datei (siehe [Weitere Fortschreibungen](../0022-dark-factory-kern-und-verteilung.md#weitere-fortschreibungen-als-dateien)).

- **Ausgangslage:** der Satz im Startbestand stellte `scripts/check-internalrefs.mjs` abweichend von §1 in den Ring `kern-nach-entkopplung`, weil die Begriffsliste im Skript ein Projektwert sei. Seit factory#169 ergänzt jeder Bezieher die Sperrliste selbst im Block `internalrefs` der Projekt-Config (`begriffe`, `namen`); `--add` und `--add-name` schreiben dort statt in das Skript.
- **Entscheidung:** das Manifest `.factory/besitz.json` ist die Besitz-SSOT und führt das Skript im Ring `kern`. Die Skript-Liste ist nur noch die Kernliste (Begriffe, die für jedes Projekt gelten), der Projektanteil liegt in der Config. Der Satz „abweichend im Ring `kern-nach-entkopplung`“ ist damit überholt.
- **Folge:** das Skript darf nur Kern-Dateien importieren (`RING_IMPORTE`); den Projektanteil schreibt es mit einem Textpatch nur des Werts von `internalrefs` (Rest der Config byte-gleich), ohne `besitz-lib` zu importieren.
- **Re-Evaluierung:** wenn die Kernliste selbst Projektwörter enthalten müsste, kehrt das Skript in `kern-nach-entkopplung` zurück.
