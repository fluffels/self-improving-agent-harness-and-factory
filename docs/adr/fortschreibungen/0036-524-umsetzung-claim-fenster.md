# Fortschreibung #524 (2026-11-16): Umsetzung, Plugin im Projekt-Scope aus und Claim-Fenster

Ergänzt [ADR 0036](../0036-ticket-tag-an-jeder-generation.md): beantwortet die offene Umsetzungsfrage und legt das Fenster fest. Herkunft: factory#524.

## Entscheidung

- **Plugin im Projekt-Scope ganz aus.** Entscheidung: `enabledPlugins["langfuse-observability@langfuse-observability"]` steht in `.claude/settings.json` auf `false` (nur dieser Schlüssel), weil es keinen Schalter nur für Generations gibt. Damit entfallen im Fabrik-Repo auch die TOOL-Spans: `token-baseline.mjs --langfuse` hat für neue Sessions keine Tool-Events, Tool-Kennzahlen kommen nur aus dem Transkript. `enabledPlugins` steht nicht im Besitz-Manifest: die Änderung gilt nur für die Fabrik, Bezieher behalten das Plugin als Sender (keine Doppelzählung, aber kein Ticket-Tag).
- **Ticket je Call aus dem Claim-Fenster** (`scripts/claim-fenster.mjs`): Fensterende ist Freigabe, Merge (`gh pr merge`, nicht `--disable-auto`) oder der nächste Claim, ohne `closedAt` aus GitHub. Ein Subagent zählt ganz zum Ticket seines Starts; ein Call außerhalb jedes Fensters trägt `ohne-ticket` mit Grund.
- **Ein Trace je Session und Ticket-Schlüssel**, damit der Ticket-Tag nie an einem fremden Ticket hängt. Stichtag: 2026-11-16.
- **Codex:** Codex-Observations laufen nicht über den Nachlieferer und tragen keinen Ticket-Tag (Tag `project:<Repo>`); das Rezept filtert auf den Trace `Abgleich` und enthält sie nicht. Belegte Grenze, kein Adapter-Nachweis in diesem Ticket.

## Revert-Weg

Wie im ADR: das Plugin im Projekt-Scope wieder einschalten.
