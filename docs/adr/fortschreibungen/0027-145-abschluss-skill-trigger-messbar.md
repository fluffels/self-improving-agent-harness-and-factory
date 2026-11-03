# Fortschreibung #145 (2026-11-03): Rückfall-Trigger des optionalen Abschluss-Skills messbar

Präzisiert die Ledger-Zeile 2026-11-03 (factory#139) in [ADR 0027](../0027-regeln-lockern.md); die Zeile selbst bleibt unverändert (Punkt 8), die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Entscheidung (messbarer Trigger):** der Rückfall-Trigger der Zeile gilt als eingetreten, wenn `node scripts/hauptchat-zerlegung.mjs` (ohne `--brain`) für eine Sitzung mit wirksamem Abschluss-Skill (`node scripts/projekt-config.mjs abschluss` ≠ `keiner`) und abgeschlossenem Ticket keine Zeile der Kategorie „Brain“ zeigt; Folge: Revert per PR. Grund: „Ein Ticket-Abschluss ohne Brain-Eintrag“ war nicht ablesbar.
