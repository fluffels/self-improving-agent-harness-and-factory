# Fortschreibung #272 (2026-11-11): Phasen-Schnitt beendet

Präzisiert [ADR 0028](../0028-ein-ticket-ablauf.md) (genau ein Ticket-Ablauf, siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)); der Ablauf bekommt keinen zweiten Pfad, er wird einfacher.

- **Entscheidung:** der Hauptchat setzt im Erst-Spawn keine `Schnitt:`-Zeile mehr; ein Umsetzer führt ein Ticket bis zum Merge.
- **Grund:** die A/B-Regel aus quellprojekt#1593 (Punkte (0) bis (3), vorab festgelegt) ist nicht erfüllt: der Arm `pr` hat n = 3 Tickets mit Übergabe (verlangt: 10), und sein Mechanik-Wächter fällt wie schon in quellprojekt#1593 durch (0,18 $ gegen 0,17 $ ab CI-Warten bei `ohne`). Rohwerte, Fenster und Befehle: [model-routing, Auswertung factory#272](../../model-routing-messhistorie-2026.md#auswertung-und-entscheidung-factory272).
- **Was ruht:** `ticket-lock.mjs` (`uebergeben`, `uebernehmen --nachfolger`), `umsetzer-abschluss.mjs` (R4/R5 für `uebergabe`), der Abschnitt „Einstieg nach Übergabe“ des Umsetzers und der `uebergabe`-Bullet in `ablauf.md` bleiben für Sessions mit älterer Definition bestehen; der Rückbau ist eine Zeile im Sammelticket „Harness-Härtung (gesammelt)“.
- **Rückweg:** `git revert` des PR stellt Spawn-Vorlage und Paritätsregel her.
