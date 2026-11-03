# Fortschreibung #131 (2026-11-03): Factory-Links im Sync (F9/F10)

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (F9, Sync überschreibt nur Besitz) und die Fortschreibung [#130](0022-130-factory-link-waechter-als-kern.md) (Punkt „Index bleibt Projektbesitz“); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Entscheidung (Ausnahme vom Besitz-Prinzip):** `factory-sync --tag` schreibt über den Besitz hinaus die Refs der Factory-Links in Projekt-Doku und `.factory/factory-links.json`. Der Index bleibt Projektbesitz im Sinn von #130 (kein Manifest-Eintrag, der Sync verteilt ihn nicht), wird aber aus dem Tag abgeleitet und vom Sync mitgeschrieben, damit ein Bezieher nach dem Sync kein zweites Kommando mehr fährt.
- **Entscheidung (ein Plan, ein Schreibteil):** der Link-Plan (`planeFactoryLinks` in `scripts/factory-links-lib.mjs`) ist pur und läuft auf dem Ergebnis des Sync-Plans (neue Texte, neuer Sync-Stand); Wächter und Sync teilen ihn, weil kein Einstiegsskript ein anderes importiert.
- **Entscheidung (Atomarität):** ein Link-Befund heißt Exit 1 und nichts geschrieben, auch mit `--trocken`; `--entwurf` macht keinen Link-Schritt.
- **Entscheidung (Repo und Config):** ohne bestimmbares Factory-Repo (weder `quelle.repo` noch Board mit Rolle `factory`) nur ein Hinweis, der Sync läuft weiter; bei bekanntem Repo ist eine fehlende oder ungültige Ziel-Config ein Fehler (`[config]`, wie im Gate).
- **Entscheidung (kein Tag-Commit-Abgleich):** der Sync liest Tag und Commit aus demselben Leser; den Abgleich behält der Reparaturweg `check:factorylinks -- --schreiben --quelle <klon>`.
- **Bekannte Grenze:** die Zeile eines Befunds gilt im geplanten Text (nach dem Sync der Besitz-Blöcke), nicht in der unveränderten Datei auf der Platte.
