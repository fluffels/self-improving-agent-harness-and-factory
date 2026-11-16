# Teil 1: Kosten und Tokens aus Transkripten

Auftrag: Kosten und Tokens je Rolle und je PR aus den Transkripten der Fabrik mit `node scripts/token-baseline.mjs` und `node scripts/subagent-laufzeit.mjs`. Gelesen werden nur die Projektordner der Fabrik und ihrer Worktrees unter `~/.claude/projects/`; jeder andere Ordner (auch der eines Beziehers) wird weder gelesen noch genannt. Nur lesen, nichts schreiben, kein Web-Aufruf.

## Messwerte
Kosten je PR, Prozentpunkte des Limits, Tokens je Rolle. Leere Hook-Generations ausfiltern.

## Fundstellen
Befehl und Datei je Zahl; Rohwerte vor Ableitungen.

## Unsicherheiten
Fehlen Transkripte: „Lücke: Transkripte fehlen“, keine Empfehlung. Transkript-Kosten sind eine Schätzung (Langfuse ist maßgeblich).
