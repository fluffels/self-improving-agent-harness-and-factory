# Fortschreibung #127 (2026-11-02): Besitz-Spannen mit einer Semantik

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) und ändert eine Entscheidung der Fortschreibung [#130](0022-130-factory-link-waechter-als-kern.md) (Zeile „Marker in Code“): Wächter und Sync lasen Besitz-Blöcke nach verschiedenen Regeln, ein Block konnte für den einen gelten und für den anderen nicht.

- **Ausgangslage:** der Factory-Link-Wächter maskierte Code und ließ Marker-Zeilen in Code-Fence oder Inline-Code keinen Besitz-Block öffnen; der Sync (`blockSpanne` in `scripts/besitz-lib.mjs`) nimmt das erste Vorkommen des Markers im Text, auch im Code. Ein Marker-Beispiel in einem Code-Fence vor dem echten Block zählte damit für den Sync, nicht aber für den Wächter.
- **Entscheidung:** für Besitz-Blöcke gilt überall dieselbe Semantik wie im Sync, nämlich das erste Marker-Vorkommen, auch im Code. Der Wächter nutzt dieselbe Spannen-Funktion (eine Quelle: `besitzSpannen` ruft `blockSpanne` in `scripts/besitz-lib.mjs`). Schnappschuss-Marker bleiben dagegen code-maskiert: ein Beispiel im Code öffnet dort keinen Block.
- **Grund:** die Verteilung ist maßgeblich. Was der Sync als Block liest, muss der Wächter prüfen; eine zweite, mildere Auslegung wäre ein Drift (wie bei der Glob-Syntax in #130). Besitz-Marker kommen nur in Seiten vor, die der Harness selbst pflegt; ein Marker-Beispiel gehört dort nicht in dieselbe Datei, `pruefeManifest` verlangt je Marker genau ein Vorkommen.
- **Re-Evaluierung:** wenn Seiten mit Marker-Beispielen im Code nötig werden; dann ändern Sync und Wächter gemeinsam.
