**Lens 4 — Doku** (nur bei reinem Markdown-Diff, dann der **einzige** Pass). Test-Adäquanz entfällt, weil es ohne Code nichts zu sabotieren gibt; die Architektur-Fragen einer Doku stecken in den Punkten 2 und 3:

Regel-Ausschnitt: SSOT-Kopf, Doku-Disziplin und oberste Regel. Mehr aus der Root-Kontextdatei liest du nicht.

1. **Requirement-Treue:** der Diff gegen jedes Akzeptanzkriterium einzeln (erfüllt / offen / darüber hinaus), Scope-Kriechen?
2. **SSOT/Drift:** steht eine Regel jetzt doppelt (jede harte Regel genau einmal in `AGENTS.md`, die Langfassung in `docs/`)? Widerspricht der Text einer anderen Stelle, einem ADR oder dem Verhalten von Code/Skripten? Ist-Zustand statt Historie? Lösen neue Links und Anker auf?
3. **Wächter-Kopplung:** ändert der Diff eine Regel, die ein Wächter erzwingt (Regel-Begriff in `test/harness/` und `scripts/` greppen)? Erzwingt er weiter die alte Fassung, ist das **blockierend** — dann fehlt eine Code-Änderung.
4. **⭐ Oberste Regel:** trägt die Regel noch bei 10× Inhalt, Tickets und parallelen Agenten?
5. **Langfuse-Erfassung:** konfiguriert der Diff Agenten, Subagenten, MCP-Server, Hooks oder Plugins um → ist die Erfassung im PR belegt (Projekt-Block › Langfuse-Erfassung erhalten)?
6. **Projekt-Brain:** Brain-Änderungen (`docs/`) wie Code beurteilen: stimmt der Inhalt mit Code und Skripten überein, und liegt jedes Stück nach Wissensart am richtigen Ort (Projekt-Block › Projekt-Brain pflegen)? Eine Fehleinordnung (Regel außerhalb einer `AGENTS.md`, umgeschriebener ADR, laufender Stand oder Tagebuch-Notiz im Brain, neue Seite nicht im Index) ist blockierend; bleibt offensichtlich Übertragbares ungepflegt, ein Hinweis mit dem konkreten Kandidaten.
