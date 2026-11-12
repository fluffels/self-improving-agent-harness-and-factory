# Git-Host-Bindung der Fabrik

> 🧭 **Fachlich geprüft am: 2026-11-12.** Antwort auf factory#248 (Idee aus factory#220, Zeile L42); Entscheidung: [ADR 0032](adr/0032-git-host-bindung.md).

Diese Seite sagt je Fabrik-Teil, ob er **hostneutral** ist oder **GitHub** voraussetzt. Ein Wächter hält sie wahr (`test/harness/git-host-liste.test.ts`): Jede Skript-Datei, die `gh-cli.mjs`, GitHub-Umgebung, `api.github.com`, `ProjectV2` oder ein String-Literal `"graphql"` (etwa als Argument von `gh api`) nutzt (auch über Importe; ein Beleg-Link in API-Form als Daten-Literal, etwa in der Codex-Freigabetabelle, zählt nicht als Nutzung), und jeder Workflow steht in einer GitHub-Zeile; ein genannter Pfad muss existieren. Board, Agenten- und Skill-Texte und Dienste sind eine Handliste ohne Dateiabgleich.

Legende (genau zwei Werte, kein „teilweise“; gemischte Teile sind in Zeilen geteilt):

- `hostneutral`: läuft nur mit `git`, Node und Langfuse.
- `GitHub`: braucht `gh`, REST oder GraphQL, Actions, Projects, Rulesets oder Auto-Merge.

GitLab als Beispiel für einen anderen Host: Pipeline-Zeitpläne liegen dort in der Oberfläche, nicht in der Workflow-Datei; die `schedule`-Einträge der Workflows hier hätten kein Gegenstück in der Datei.

## Gates

| Teil | Bestandteile | Git-Host | Was GitHub voraussetzt |
|---|---|---|---|
| Lokale Gates aus `npm run verify` | `check-size.mjs`, `check-docmap.mjs`, `check-docdrift.mjs`, `check-internalrefs.mjs`, `check-lockfile.mjs`, `check-context-size.mjs`, `check-diffsize.mjs`, `verify-lauf.mjs`, `gate-befehl.mjs` | hostneutral | nichts |
| PR-Nachweise aus `git log` | `check-review-nachweis.mjs`, `check-basis.mjs` | hostneutral | nichts (lesen nur Commit-Zeilen) |
| PR- und Ticket-Gates | `check-abnahme-nachweis.mjs`, `check-festgefahren.mjs`, `check-doc-tickets.mjs` | GitHub | lesen Issues, PRs und Labels per `gh` |
| Required Checks, Ruleset, Auto-Merge, CODEOWNERS | `.github/ruleset-main-schutz.json`, `.github/CODEOWNERS` | GitHub | Ruleset, Required Checks, Auto-Merge und Code-Owner-Review gibt es nur dort |

## Skripte

| Teil | Bestandteile | Git-Host | Was GitHub voraussetzt |
|---|---|---|---|
| Board und Ticket | `board-lib.mjs`, `board-place.mjs`, `naechstes-ticket.mjs`, `ticket-lock.mjs`, `claims-pruefen.mjs`, `spezifikation.mjs`, `design-schritt.mjs`, `sammelticket-anlegen.mjs`, `blocker-lib.mjs`, `blocker-migration.mjs`, `produktquote-lib.mjs`, `fremdtext.mjs` | GitHub | Issues, Projects v2, Assignee-Claim, Blocker-Kante, Kommentare |
| Ticketlauf-Abschluss | `umsetzer-abschluss.mjs`, `pr-warten.mjs`, `abnahme.mjs`, `cleanup-worktrees.mjs` | GitHub | PR-Status, Checks, Auto-Merge, Branch-Update (`gh pr update-branch`), Issue-Zustand |
| Hooks | `pretooluse-hook.mjs`, `pretooluse-dispatch.mjs`, `stop-verify-hook.mjs`, `gh-guard-hook.mjs` | GitHub | die ersten drei hängen über `umsetzer-abschluss.mjs` an `gh-cli.mjs`; `gh-guard-hook.mjs` schützt Projects-v2-Aufrufe (`ProjectV2`) |
| Codex-Adapter | `codex-hook.mjs`, `codex-hook-lib.mjs`, `codex-lib.mjs`, `codex-setup.mjs`, `codex-vorpruefung.mjs` | GitHub | laden den Dispatcher (`pretooluse-dispatch.mjs`) und damit `umsetzer-abschluss.mjs`/`gh-cli.mjs` |
| Inboxen und Takt | `inbox-lib.mjs`, `inbox-start-lib.mjs`, `wiedervorlage.mjs`, `ticket-drift.mjs`, `secret-inbox.mjs`, `codescanning-inbox.mjs`, `audit-einordnung.mjs`, `board-takt.mjs`, `langfuse-takt.mjs`, `tag-takt.mjs`, `factory-update-check.mjs` | GitHub | Issues als Inbox, Alerts, Releases |
| Meldestelle und Offene Punkte | `melden.mjs`, `meldung-lib.mjs`, `offene-punkte.mjs`, `offene-punkte-lib.mjs` | GitHub | Kommentare am Sammelticket, Issues |
| Harness-Doctor | `harness-doctor.mjs`, `harness-doctor-lib.mjs`, `harness-doctor-board.mjs`, `harness-doctor-melden.mjs`, `harness-doctor-meldestelle.mjs`, `harness-doctor-factory-update.mjs`, `harness-doctor-ruleset.mjs`, `harness-doctor-sicherheit.mjs`, `sandbox-doctor.mjs` | GitHub | Ruleset, Board (`harness-doctor-board.mjs` fragt Projects v2 per `gh api graphql`), Meldestelle, Secret Protection und PVR (die beiden reinen Bibliotheken `harness-doctor-ruleset.mjs` und `harness-doctor-sicherheit.mjs` bekommen die Daten von außen, liegen darum außerhalb der Menge des Wächters); `sandbox-doctor.mjs` liest `GH_TOKEN` für `api.github.com` |
| Messen mit PR- und CI-Daten | `ci-laeufe.mjs`, `factory-kennzahlen.mjs`, `gate-fundquote.mjs`, `hauptchat-zerlegung.mjs`, `lauf-ergebnis.mjs`, `token-baseline.mjs`, `langfuse-wochenbericht.mjs` | GitHub | PR- und Workflow-Läufe per `gh` |
| GitHub-Zugang | `gh-cli.mjs`, `gh-kontingent.mjs`, `kontingent-lib.mjs` | GitHub | die einzige `gh`-Naht und ihr Kontingent |
| Probe-Erstbezug | `probe-erstbezug.mjs` | GitHub | legt ein Probe-Repo an |
| Übrige Skripte unter `scripts/` | Besitz-Sync, Messen aus Transkript und Langfuse, Guards, Codex-Adapter, Docs-Gen, Cockpit | hostneutral | nichts (nach der Musterliste des Wächters: sie liegen außerhalb der GitHub-Menge) |

## Workflows

Alle Workflows laufen in GitHub Actions; der `schedule` steht in der Datei.

| Teil | Bestandteile | Git-Host | Was GitHub voraussetzt |
|---|---|---|---|
| CI | `ci.yml`, `alarm-rot-main.yml`, `verify-macos.yml` | GitHub | Actions, Required Checks, Issues (Alarm bei rotem main) |
| Sicherheit | `codeql.yml`, `codescanning-inbox.yml`, `dependency-review.yml`, `dependency-review-vollstaendig.mjs`, `dependabot-inbox.yml`, `scorecard.yml`, `secret-scan.yml`, `zizmor.yml` | GitHub | Code-Scanning, Dependency-Review, Dependabot |
| Board und Takt | `board-takt.yml`, `wiedervorlage.yml`, `ticket-drift.yml`, `festgefahren.yml`, `audit-einordnung.yml`, `harness-doctor.yml` | GitHub | Actions, Issues, Labels |
| Verteilung und PR-Text | `factory-update.yml`, `internalrefs-pr-text.yml` | GitHub | Actions, PR-Text, Releases |

## Board

| Teil | Bestandteile | Git-Host | Was GitHub voraussetzt |
|---|---|---|---|
| Projects v2 | Position, Felder, Ansichten | GitHub | Projects v2 per GraphQL |
| Issues als Tickets | Labels, Assignee-Claim, Milestones | GitHub | Issues-API |
| Beziehungen | native Blocker-Kante, Sub-Issues | GitHub | Issue-Beziehungen |

## Weitere

| Teil | Bestandteile | Git-Host | Was GitHub voraussetzt |
|---|---|---|---|
| Agenten- und Skill-Texte, Regeln | `.claude/agents/`, `.agents/skills/`, AGENTS.md: `gh issue`, `gh pr create`, `gh pr merge --auto`, PR-Gating | GitHub | PR-Ablauf und Board sind als `gh`-Befehle beschrieben |
| Dienste | Dependabot, Code-Scanning, Secret-Scanning, Private Vulnerability Reporting | GitHub | GitHub-Dienste |
| Lokale Werkzeuge | `.githooks/pre-push`, Langfuse, Playwright | hostneutral | nichts |

Die einzige `gh`-Naht ist `gh-cli.mjs` (erzwungen durch `test/harness/gh-cli.test.ts`); eine spätere Anbindung bliebe begrenzt. Entscheidung und Auslöser für eine Neubewertung: [ADR 0032](adr/0032-git-host-bindung.md).
