# ADR 0032: Fabrik bleibt an GitHub gebunden

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-11-12 · Ticket: factory#248

## Status

**Akzeptiert.** Beantwortet die Frage aus factory#248 (Idee aus factory#220, Zeile L42): Die Fabrik wird nicht auf einen anderen Git-Host angebunden. Die Liste der hostneutralen und der GitHub-gebundenen Teile steht in [Git-Host-Bindung der Fabrik](../git-host.md).

## Kontext

Die Fabrik nutzt GitHub an vielen Stellen: `gh` und die API, Projects v2 als Board, Issues als Tickets, Auto-Merge, Ruleset und Required Checks, Actions mit `schedule`. Ob ein Bezieher auf einem anderen Host (etwa GitLab, dessen Pipeline-Zeitpläne in der Oberfläche liegen, nicht in der Datei) angebunden werden kann, war offen. Die Messung (Wächter in `test/harness/git-host-liste.test.ts`): mehr als ein Viertel der Skript-Dateien unter `scripts/`, alle Workflows, das Board, das Ruleset und die Ablauf-Texte der Agenten setzen GitHub voraus. Lokale Gates, Nachweise aus `git log`, Besitz-Sync, Guards, Langfuse und Playwright sind hostneutral.

## Optionen

| Option | Bewertung |
|---|---|
| **A: Jetzt anbinden** über einen Port „Git-Host“ mit Adaptern für Tickets und Kommentare, Board-Reihenfolge, PR, Merge und Required Checks, CI-Takt und Sicherheits-Alerts | Umbau in Epic-Größe; das Board hat auf anderen Hosts keine gleichwertige Positionssemantik, Zeitpläne und Auto-Merge sind dort anders gebaut. Verworfen. |
| **B (gewählt): Bindung bewusst halten** und die hostneutralen Teile dokumentieren | Kleinster Schritt, die Liste ist die Grundlage einer späteren Entscheidung. |
| **C: Neue Neutralitäts-Regel für neuen Code** | Unnötig: `test/harness/gh-cli.test.ts` erzwingt `gh-cli.mjs` als einzige `gh`-Naht schon. Verworfen. |

## Entscheidung

Entscheidung: B, weil alle bekannten Bezieher auf GitHub liegen, die Bindung tief ist und das Ticket „nicht vor v1.0.0“ sagt (Stand v0.11.0). Es gibt keine Folgetickets.

## Konsequenzen

- Eine neue GitHub-Bindung ist erlaubt, muss aber in [docs/git-host.md](../git-host.md) stehen; der Wächter erzwingt das (jede Skript-Datei der GitHub-Menge und jeder Workflow steht in einer GitHub-Zeile, keine GitHub-Datei in einer hostneutralen).
- Ein Bezieher auf einem anderen Host wird nicht unterstützt.
- Eine spätere Anbindung bleibt begrenzt, weil `gh-cli.mjs` schon die einzige Naht ist.

## Re-Evaluierung

Neu bewerten bei einem dieser Auslöser: der Tag v1.0.0 steht, ein Bedarf an einem anderen Host kommt über die Meldestelle, oder die Wiedervorlage `git-host-248` (fällig 2027-05-12) ist fällig. Startpunkt ist dann [docs/git-host.md](../git-host.md).
