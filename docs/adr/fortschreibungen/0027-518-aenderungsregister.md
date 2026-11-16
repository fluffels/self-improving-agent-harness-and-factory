# Fortschreibung #518 (2026-11-16): Änderungsregister trägt die Prüfung

Ergänzt [ADR 0027](../0027-regeln-lockern.md) (Punkte 4 und 8); die Ledger-Zeilen bleiben unverändert (Punkt 8). Teil 1/9 von factory#518, gebaut in factory#571.

## Regel

- **Registerzeile je Umstellung statt Einzel-Wiedervorlage.** Jede Umstellung der Fabrik bekommt eine Zeile in `.github/aenderungsregister.json` (Schema und Katalog: `scripts/aenderungsregister-lib.mjs`, Wächter `test/harness/aenderungsregister.test.ts`): Datum, Änderung, erwartete Wirkung, Messgröße aus dem Katalog `MESSGROESSEN`, Basis, Toleranz (Richtung und Schwelle eines Qualitätsmaßes), Rückfall, Prüftermin (Standard Datum + 28 Tage, Abweichung nur mit `pruefTerminGrund`), Mindestdaten.
- **Keine zwei Wahrheiten:** das Register trägt die Prüfung, die Ledger-Zeile in ADR 0027 den begründenden Beleg. Das Feld `adr` (`datum`, `pr` wörtlich wie in der PR-Spalte) zeigt auf die Ledger-Zeile; der Wächter prüft beide Richtungen.
- **Ab 2026-11-17** nennt jede neue Ledger-Zeile `Register: \`<id>\`` (Spalte Rückfall-Trigger). Die Zuordnung älterer Zeilen steht nur im Feld `adr` des Registers: Punkt 8 verbietet Zusätze in alten Zeilen, eine Zuordnungstabelle gibt es nicht.
- Der Bau misst nichts; die Messung folgt in den weiteren Teilen von factory#518.

## Re-Evaluierung

Prüftermin 2026-12-14: legt jede neue Ledger-Zeile eine Registerzeile an, bleibt die Regel; entsteht daneben weiter eine Einzel-Wiedervorlage je Umstellung, wird der Wächter um diese Prüfung erweitert.
