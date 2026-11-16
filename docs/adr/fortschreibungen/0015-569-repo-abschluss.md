# Fortschreibung #569 (2026-11-16): Repo-Abschluss statt privatem Abschluss-Skill

Ergänzt [ADR 0015](../0015-projekt-brain.md) (Projekt-Brain); Herkunft: factory#569; die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Entscheidung:** Der Ticket-Abschluss der Fabrik hängt von keinem privaten Wissenssystem ab. Der **Repo-Abschluss** (Schritt 3 des Umsetzers) schreibt Übertragbares nach Wissensart direkt ins Repo (Regel → AGENTS.md, Entscheidung → ADR bzw. Fortschreibung, Evergreen → Brain-Seite), ohne Vorschau und Rückfrage, im selben PR; die Öffentlich-Schranke (Anonymität, `check:internalrefs`) prüft der Umsetzer selbst.
- **Privater Zusatz:** Wer ein eigenes System anstoßen will, setzt `FACTORY_ABSCHLUSS_SKILL` in der Nutzer-Konfiguration (Shell oder `.claude/settings.local.json`); der Hauptchat ruft den Skill nach dem Bericht, der Repo-Abschluss ist davor schon gelaufen. `aus` schaltet ihn ab, ein unbekannter Name wird als `Hinweis: Abschluss-Skill <name> unbekannt` gemeldet, kein Abbruch.
- **Config:** `skills.abschluss` bleibt Pflichtschlüssel (factory#139), steht im Kern aber auf `null`; Bezieher mit eigenem Wert bleiben gültig, empfohlen ist `null`.
- **Wächter:** `test/harness/sitzungsabschluss.test.ts` prüft den Kern-Text auf Platzhalter, festen Skill-Aufruf, Config-Wert und den lokalen Variablenwert (Grenzen im Kopfkommentar).
- **Grenzen:** Codex: der private Abschluss-Skill ist dort unbelegt, ein autonomer Ticketlauf ist laut `scripts/codex-freigaben.mjs` nicht freigegeben; der Repo-Abschluss wirkt über die Rollenquelle `factory-umsetzer.md`. LERNKANDIDATEN stehen ohne privaten Skill nur im Bericht.
