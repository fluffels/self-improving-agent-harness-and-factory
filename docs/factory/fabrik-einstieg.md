# Einstieg für Nutzer und Bezieher der Factory

> 🧭 **Fachlich geprüft am: 2026-11-16.**

> Wissensart: Verweisseite (Evergreen). Sie führt zusammen, wo welche Einstellung der Factory steht und wo die Regel dazu steht; sie wiederholt keinen Regeltext. Gilt für jedes Projekt, das die Factory per Sync bezieht, und für die Factory selbst; sie trägt weder Projekt- noch Personenbezug. Ein Wächter-Test hält die Tabelle der Umgebungsvariablen vollständig.

## Ebenen der Konfiguration

Jede Einstellung gehört auf genau eine Ebene. Wer eine Einstellung ändern will, sucht zuerst die Ebene.

| Ebene | Was dort steht | Ort | Wer ändert | Mehr |
| --- | --- | --- | --- | --- |
| Factory-Besitz | Skripte, Agenten, Skills, Workflows, Kern-Tests, Kern-Seiten, der Kern-Block der `AGENTS.md` | Besitz-Manifest der Factory, geliefert vom Sync | nur die Quelle der Factory; im Bezieher nie von Hand | [Erstbezug](../erstbezug.md) |
| Projekt-Config | Repo, Boards, Präfixe, Agentennamen, Labels, Projekt-Block der `AGENTS.md`, projekteigene Gates | `.factory/projekt.json`, Projekt-Block in `AGENTS.md`, Projektdateien aus den Vorlagen | das Projekt, per Pull Request | [Erstbezug](../erstbezug.md), [Doku-Vorlagen](../referenz/doku-vorlagen.md) |
| Nutzer-Konfiguration | persönliche Werte je Rechner: Umgebungsvariablen, lokale Einstellungen, Zugänge | Shell, lokale Einstellungsdatei `settings.local.json` (ungetrackt), Home-Dateien des Nutzers | die einzelne Nutzerin bzw. der einzelne Nutzer, nie ein Agent | [Sicherheit der Agenten](../sicherheit-agenten.md) |

Welche Regel für welche Ebene gilt, steht in der `AGENTS.md` (Oberste Regel, Kern-Regeln) und in [Sicherheit der Agenten](../sicherheit-agenten.md) (Zugangsdaten trägt nur die Nutzerin selbst ein).

## Umgebungsvariablen

Alle Variablen der Factory tragen das Präfix `FACTORY_`. Sie sind **optional**: ohne Wert gilt der Standard des jeweiligen Skripts. Gesetzt werden sie in der Shell oder unter `env` in der lokalen Einstellungsdatei `settings.local.json` (Nutzer-Konfiguration), in der CI im `env:` des Schritts. Die Spalte „Art“ nennt, wer sie setzt: Nutzer (persönlich, optional), CI (Workflow), Skript (setzt das Werkzeug für seinen Kindlauf selbst) oder nur Tests.

| Variable | Art | Zweck | Mehr |
| --- | --- | --- | --- |
| `FACTORY_ABO_KONTINGENT_VERLAUF` | Nutzer | Pfad der Verlaufsdatei des Abo-Kontingents (Standard im Home unter `.claude/state`) | [Modell-Routing](../model-routing.md) |
| `FACTORY_ABSCHLUSS_SKILL` | Nutzer | privater Abschluss-Skill am Sitzungsende; `aus` schaltet ihn ab, nie in der Projekt-Config | [Harness-Transfer](../harness-transfer.md) |
| `FACTORY_ANALYSE_ABLAGE` | Nutzer | Ordner der Analyse-Schnappschüsse außerhalb von Repo, Worktrees und Bezieher-Checkouts (nie committet; für die Token-Analyse) | [Sicherheit der Agenten](../sicherheit-agenten.md) |
| `FACTORY_ANALYSE_FREIGABE` | Nutzer | Datei außerhalb des Repos mit den Pfaden freigegebener Bezieher-Checkouts für die Token-Analyse (nie committet; für die Token-Analyse) | [Sicherheit der Agenten](../sicherheit-agenten.md) |
| `FACTORY_BASIS_REF` | CI | Basis-Branch der Pull-Request-CI für die Basis-Nachlauf-Prüfung | [Erstbezug](../erstbezug.md) |
| `FACTORY_COVERAGE` | CI | schaltet die Coverage-Instrumentierung ein (lokal bleibt `verify` uninstrumentiert) | [FAQ](../agent-harness-faq.md) |
| `FACTORY_DIFF_BASE` | Nutzer | Basis für Diff-Gates, sonst Merge-Base mit `origin/main` | [Harness-Transfer](../harness-transfer.md) |
| `FACTORY_DIFFSIZE_MAX_FILES` | Nutzer | Obergrenze der Dateien für `check:diffsize` | [Agent-Harness](../agent-harness.md) |
| `FACTORY_DIFFSIZE_MAX_LINES` | Nutzer | Obergrenze der Zeilen für `check:diffsize` | [Agent-Harness](../agent-harness.md) |
| `FACTORY_E2E_BROWSER` | Skript | Browser-Name, den die Factory an den e2e-Befehl des Projekts übergibt | [Schichten ohne Unit-Tests](schichten-ohne-unit-tests.md) |
| `FACTORY_GH_ECHT` | nur Tests | schaltet die gh-Sperre der Testumgebung ab | [Agent-Harness](../agent-harness.md) |
| `FACTORY_GH_KOSTEN_LOG` | Nutzer | Pfad des Kostenprotokolls der `gh`-Aufrufe (GitHub-API-Kontingent) | [Glossar](../harness-glossar.md) |
| `FACTORY_MCP_AUSFALL_STAND` | Nutzer | Pfad der Stand-Datei der MCP-Ausfallmeldung | [Befehle](../referenz/befehle.md) |
| `FACTORY_MCP_LOG_DIR` | Nutzer | Basisordner der Claude-Code-Logs für die MCP-Ausfallmeldung | [Agent-Harness](../agent-harness.md) |
| `FACTORY_MUTATION_BEREICHE` | Skript | Eingabe des Gate-Befehls `mutation`: JSON-Datei mit den Zeilenbereichen des Diffs | [Glossar](../harness-glossar.md) |
| `FACTORY_MUTATION_BERICHT` | Skript | Ausgabe des Gate-Befehls `mutation`: Pfad des Mutationsberichts | [Glossar](../harness-glossar.md) |
| `FACTORY_ORIGINAL_PATH` | nur Tests | PATH mit dem echten `gh` für Kindprozesse der Testumgebung | [Agent-Harness](../agent-harness.md) |
| `FACTORY_PACING_PROBE_SKRIPT` | nur Tests | ersetzt den Claude-Aufruf der Pacing-Probe durch ein Skript | [Befehle](../referenz/befehle.md) |
| `FACTORY_PACING_ZIELQUOTE` | Nutzer | Zielquote des Wochen-Kontingents (1 bis 100, Standard 65) | [Modell-Routing](../model-routing.md) |
| `FACTORY_PR_BODY` | CI | PR-Text für die Prüfung des Abnahme-Nachweises | [Befehle](../referenz/befehle.md) |
| `FACTORY_PR_DRAFT` | CI | gibt an, ob der Pull Request ein Entwurf ist | [Erstbezug](../erstbezug.md) |
| `FACTORY_PR_NUMBER` | CI | Nummer des Pull Requests für die Prüfung des Abnahme-Nachweises | [Befehle](../referenz/befehle.md) |
| `FACTORY_PROJEKT_CONFIG` | Skript | Pfad einer Ersatz-Config für die Fremd-Config-Probe (nur im Kindlauf) | [Agent-Harness](../agent-harness.md) |
| `FACTORY_PROJEKT_WURZEL` | Skript | Wurzelordner des Projekts für die Fremd-Config-Probe (nur im Kindlauf) | [Agent-Harness](../agent-harness.md) |
| `FACTORY_RATE_LIMITS_SNAPSHOT` | Nutzer | Pfad des Rate-Limit-Snapshots der Statusline | [Modell-Routing](../model-routing.md) |
| `FACTORY_STATUSLINE_DURCHREICHEN` | Skript | Schleifenschutz der durchgereichten persönlichen Statusline | [Modell-Routing](../model-routing.md) |
| `FACTORY_SYNC_ZWEITLAUF` | Skript | Riegel: der Sync startet sich nach neuen Skripten einmal neu | [Befehle](../referenz/befehle.md) |
| `FACTORY_TEST_FEHLT` | nur Tests | nie gesetzt; Fixture für den Fehlerpfad der MCP-Ausfallmeldung | [Befehle](../referenz/befehle.md) |
| `FACTORY_USER_SETTINGS` | nur Tests | Pfad der persönlichen Einstellungen, aus denen die Statusline gelesen wird | [Befehle](../referenz/befehle.md) |

Eine neue Variable steht erst in der Fachseite und dann hier; ohne Zeile in dieser Tabelle ist der Wächter-Test dieser Seite rot.

## Updates holen

Ein Bezieher holt Updates der Factory selbst: der Wochenlauf `.github/workflows/factory-update.yml` legt das Issue „Factory-Update“ an, wenn ein neuerer Release-Tag da ist (der Workflow kommt mit dem Sync, nicht von Hand). Den Stand prüft `node scripts/factory-update-check.mjs`, übertragen wird mit `node scripts/factory-sync.mjs` (nur Besitz laut Besitz-Manifest, idempotent). Schrittfolge, Abgleich und Fehlerfälle: [Erstbezug](../erstbezug.md).

## Einrichtung je Rechner und Laufzeit

| Was | Wo beschrieben |
| --- | --- |
| Neues Repo auf die Factory umstellen (Ruleset, Projektdateien, Sync, Doctor) | [Erstbezug](../erstbezug.md) |
| Bestands-Repo übertragen (Reifestufen, Werkzeug je Sprache) | [Harness-Transfer](../harness-transfer.md) |
| Voraussetzungen prüfen und einrichten | `node scripts/harness-doctor.mjs --pruefen` und `--einrichten` |
| Langfuse (Plugin im User-Scope, Zugang) | [Erstbezug](../erstbezug.md), [Hook-Patch](../langfuse-hook-patch.md) |
| Codex als Laufzeit (native Rollen, MCP, Berechtigungen, Freigabe) | [Codex-Einstieg](../codex/einstieg.md) |
| Sandbox, Berechtigungen, Secrets | [Sicherheit der Agenten](../sicherheit-agenten.md), [Sandbox anbinden](../sandbox-anbinden.md) |
| Windows und Git-Bash | [FAQ](../agent-harness-faq.md) |

Persönliche Werte je Rechner (Variablen oben, `settings.local.json`, Zugänge im Home) bleiben ungetrackt und stehen in keinem Commit. Beide Laufzeiten, Claude Code und Codex, folgen derselben `AGENTS.md`; ein Harness-Ticket berücksichtigt beide im selben Ticket.

## Sammeltickets

Befunde zum Harness stehen als Zeilen in Sammeltickets, nicht in eigenen Tickets (Harness-Härtung, Langfuse-Befunde, Codequalität). Eintragen mit `node scripts/melden.mjs`, anlegen mit `node scripts/sammelticket-anlegen.mjs`. Regel, Zeilenformat, Deckel und Verfall: Abschnitt „Backlog“ der `AGENTS.md` und [Ticket-Reihenfolge](../ticket-reihenfolge.md).

## Abschluss

Was am Ticket-Ende zu tun ist (Projekt-Brain pflegen, Befunde eintragen, Aufräumen): Abschnitt „Verifikation“ und „Backlog“ der `AGENTS.md` und [Ticket-Reihenfolge](../ticket-reihenfolge.md). Einen privaten Abschluss-Skill setzt jede Nutzerin bzw. jeder Nutzer nur lokal über `FACTORY_ABSCHLUSS_SKILL`; in der Projekt-Config bleibt `skills.abschluss` leer.

Regeln für Texte von Kern-Seiten (Verweisformen, Ticketnummern, Link-Anker, kein Projektliteral): Abschnitt „Gates“ der `AGENTS.md`.
