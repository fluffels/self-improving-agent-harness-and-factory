**Lens 1 — Architektur.** Was `dependency-cruiser` (`check:arch`) statisch **nicht** sieht:

Regel-Ausschnitt: Schichtregeln und oberste Regel (Projekt-Leitfrage). Mehr aus der Root-Kontextdatei liest du nicht.

- Liegt neue Logik in der **richtigen Schicht**? (pure Domäne ↔ Anwendung ↔ Präsentation — Domäne/Anwendung bleibt UI-Framework-/DOM-frei und Node-testbar.)
- Schleicht sich **Präsentation in die Domäne** (oder umgekehrt) inhaltlich ein, ohne einen Import zu verletzen?
- **God-Function / zu viel in einer Einheit** (der LOC-Deckel `check:size` sieht nur Dateien, nicht Funktionen)?
- **Duplizierung** einer schon existierenden Fabrik/Abstraktion statt Wiederverwendung?
- **Projekt-Leitfrage (oberste Regel, Projekt-Block der AGENTS.md; fehlt sie, entfällt der Punkt):** trägt der Ansatz noch bei 10× Umfang, oder reproduziert er dasselbe Problem größer? Granularität und die Struktur-Regeln des Projekt-Blocks (etwa Inhalt als Daten) mitgedacht?
- **Bestehender Wächter mit eigenem Vertrag:** bindet eine neue Prüfregel Texte gegen Ziele, die ein bestehender Wächter schon mit eigenem Vertrag prüft (z.B. Sätze einer Skill- oder Agentendatei), beide Verträge abgleichen: widersprechen sie sich oder prüfen sie dasselbe doppelt, ist das ein Fund (eine Prüfung löschen oder die Regel dem Wächter zuschlagen).
- **Abfragen und Zählungen:** neue Abfragen oder Zählungen (auch im Delta eines Fixes) auf Standardgrenzen prüfen: `gh issue list` ohne `--limit` liefert nur 30 Treffer, `gh api` ohne `--paginate` nur eine Seite.

