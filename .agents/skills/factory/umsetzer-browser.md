# Umsetzer: Browser, Langfuse-Status und Assets

Bedingte Datei des Umsetzers (Kern: `.claude/agents/factory-umsetzer.md`): lies sie, sobald dein Diff etwas Sicht- oder Bedienbares ändert, der Plan eine Browser-Prüfung vorsieht, das Ticket „Langfuse-Status überprüfen“ heißt oder ein Asset im Plan steht. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

<!-- factory:projektwerte:start -->
Projektwerte aus `.factory/projekt.json` (generiert von `node scripts/projektwerte.mjs --write`, nicht von Hand ändern).

| Schlüssel | Wert |
| --- | --- |
| `praefixe.commitZeile` | `SIH-` |
| `praefixe.branch` | `feature/sih-` |
| `praefixe.worktree` | `sih-` |
| `agenten.planer` | `sih-planer` |
| `agenten.umsetzer` | `sih-umsetzer` |
| `agenten.lens` | `sih-lens` |
| `agenten.gruppe` | `sih-gruppe` |
| `agenten.ticketSkill` | `sih-ticket` |
| `labels.harness` | `area:harness` |
| `labels.festgefahren` | `status:festgefahren` |
| `labels.forum` | `forum` |
| `labels.dependabotInbox` | `area:harness` |
| `labels.entscheidung` | `status:entscheidung-noetig` |
| `skills.abschluss` | `brain-input` |
<!-- factory:projektwerte:end -->

**Browser (Schritt 2):** Sicht- oder bedienbare Änderungen prüfst du im Browser (Screenshots ohne `filename` oder mit `.playwright-mcp/<praefixe.worktree><nr>-<name>.png`, nie mit blankem Dateinamen: der landet im Hauptcheckout-Root, nicht im Worktree), über die Playwright-MCP-Tools aus deiner Whitelist ([FAQ](../../../docs/agent-harness-faq.md#wie-verifiziere-ich-im-browser)); Zustand zuerst über den Dev-Helfer des Projekts (Projekt-Block › Im Browser verifizieren), Screenshot nur für die Optik. Eine im Plan vorgesehene Browser-Prüfung ist Pflicht (bei Content-Daten wie Quests und Dialogen bis zum Ziel durchlaufen, nicht nur springen); ihr Beleg (Zustands-Auszug des Dev-Helfers, Screenshot-Pfad) geht im Lens-Auftrag mit. Fehlen die Tools in deiner Session (Server nicht geladen), `abgebrochen` melden statt die Prüfung auszulassen.

**Langfuse-Status:** Beim Ticket „Langfuse-Status überprüfen“ die Checkliste (docs/model-routing.md) mit den Langfuse-Lesetools abarbeiten; fehlen sie, ist das ein Befund unter Datenvollständigkeit, nicht „übersprungen“.

**Assets:** Das Asset-Werkzeug laut Projekt-Block hast du nicht: Assets kommen als Datei aus den Pre-Flight-Entscheidungen.
