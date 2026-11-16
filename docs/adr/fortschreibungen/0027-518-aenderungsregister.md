# Fortschreibung #518 (2026-11-16): Änderungsregister trägt die Prüfung

Ergänzt [ADR 0027](../0027-regeln-lockern.md) (Punkte 4 und 8); die Ledger-Zeilen bleiben unverändert (Punkt 8). Teil 1/9 von factory#518, gebaut in factory#571.

## Regel

- **Registerzeile je Umstellung statt Einzel-Wiedervorlage.** Jede Umstellung der Fabrik bekommt eine Zeile in `.github/aenderungsregister.json` (Schema und Katalog: `scripts/aenderungsregister-lib.mjs`, Wächter `test/harness/aenderungsregister.test.ts`): Datum, Änderung, erwartete Wirkung, Messgröße aus dem Katalog `MESSGROESSEN`, Basis, Toleranz (Richtung und Schwelle eines Qualitätsmaßes), Rückfall, Prüftermin (Standard Datum + 28 Tage, Abweichung nur mit `pruefTerminGrund`), Mindestdaten.
- **Keine zwei Wahrheiten:** das Register trägt die Prüfung, die Ledger-Zeile in ADR 0027 den begründenden Beleg. Das Feld `adr` (`datum`, `pr` wörtlich wie in der PR-Spalte) zeigt auf die Ledger-Zeile; der Wächter prüft beide Richtungen.
- **Ab 2026-11-17** nennt jede neue Ledger-Zeile `Register: \`<id>\`` (Spalte Rückfall-Trigger). Die Zuordnung älterer Zeilen steht nur im Feld `adr` des Registers: Punkt 8 verbietet Zusätze in alten Zeilen, eine Zuordnungstabelle gibt es nicht.
- Der Bau misst nichts; die Messung folgt in den weiteren Teilen von factory#518.

## Erstbefüllung (factory#573)

- Nennt eine Ledger-Zeile vor 2026-11-17 eine Wiedervorlage-Id, trägt die Registerzeile mit `adr` auf diese Zeile die Prüfung, die Wiedervorlage entfällt; die Ledger-Zeile bleibt unverändert (Punkt 8).
- Wiedervorlagen tragen ein Pflichtfeld `art` aus `frist`, `abhaengigkeit`, `sicherheit`, `upstream`, `analyse-takt`; `umstellung` und `regel` sind verboten (Wächter `test/harness/wiedervorlagen-art.test.ts`). Einzige Ausnahme ist der Sammeleintrag `regeln-verfall-2027-03` bis factory#574.
- Eine Wiedervorlage ohne Katalog-Messgröße oder ohne Ledger-Zeile (Beispiel `sicherheits-lens-kosten-334`: Kosten je Brille und je Risikoklasse fehlen) bleibt mit `art` stehen, bis der Katalog sie trägt.

## Verfall und Fangquote (factory#607)

- Das Register kennt die Zeilenart `art: "verfall"` (Pflichtfelder `id`, `ziel`, `aufgenommen`, `ablauf`, `messgroesse: fangquote`; `durch` nur bei Regeln, Ziel mit Anker `#`, Ids der erzwingenden Wächter). Das Manifest des Regel-Verfalls ist damit das Änderungsregister, keine eigene Datei.
- Messgröße `fangquote` (Qualitätsmaß, Quelle `gate-fundquote`, Parameter `ziel`): Anteil der Testläufe mit rotem Wächter. Ein Rot durch Zeitlimit, Abbruch oder Infrastruktur zählt nicht als Fang; fehlende Logs und eine Regel ohne `durch` sind eine Lücke mit Grund, nie 0.

## Re-Evaluierung

Prüftermin 2026-12-14: legt jede neue Ledger-Zeile eine Registerzeile an, bleibt die Regel; entsteht daneben weiter eine Einzel-Wiedervorlage je Umstellung, wird der Wächter um diese Prüfung erweitert.
