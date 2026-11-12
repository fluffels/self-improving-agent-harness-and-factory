# ADR 0034: Kein zusätzlicher KI-Reviewer in der CI

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-11-12 · Ticket: factory#27

## Status

**Akzeptiert.** Beantwortet factory#27: Die Claude-Code-GitHub-Action (`anthropics/claude-code-action`) und der Managed-Dienst „Code Review“ (Produktname von Anthropic) werden nicht als zweite Review-Instanz in die CI aufgenommen. Es entsteht kein Workflow, kein Secret und keine App-Installation. Die Rückstellung vom 2026-10-05 (Token-Ziel der Harness-Phase) ist damit beantwortet.

## Kontext

Die geforderte Unabhängigkeit besteht schon: Jede Lens ist ein frischer Kritiker, der letzte Blick ist nie der des Fixers (AGENTS.md › Mehr-Perspektiven-Review, quellprojekt#1012), dazu kommt die Holdout-Abnahme (ADR 0022 §2). Die Vorbedingungen quellprojekt#1065 und quellprojekt#1198 sind seit 2026-10-05 geschlossen. Offen war, ob ein dritter, CI-seitiger Blick einen Mehrwert bringt, der seine Kosten und Risiken trägt.

## Optionen

| Option | Bewertung |
|---|---|
| **A: Action mit API-Key, berichtend** | Abrechnung je Token plus GitHub-Actions-Minuten; braucht ein Secret im öffentlichen Repo. |
| **B: Action mit Abo-OAuth-Token** (`claude setup-token`) | Läufe zählen gegen die Abo-Limits, also gegen das Kontingent, das die Harness-Phase senken soll; unbeaufsichtigter Dauerbetrieb in CI liegt laut Legal-Seite in einer Grauzone („ordinary, individual usage“). |
| **C: Managed Code Review** | Nur für Team und Enterprise, Einrichtung durch Org-Owner, braucht die Claude-GitHub-App; kein Festpreis, Usage-Credits zusätzlich zum Plan, Kosten steigen mit Stufe, PR-Größe und Zahl der Pushes. |
| **D: Action nur auf `@claude review`** | Spart Läufe, ist aber ein Handauslöser: kein unabhängiger Blick auf jeden PR, und das Secret bleibt nötig. |
| **E (gewählt): kein CI-Reviewer**, Lenses und Holdout bleiben | Keine Mehrkosten, kein neues Secret, keine neue Angriffsfläche. |

## Entscheidung

Entscheidung: E, weil Kosten, Planverfügbarkeit und Sicherheitsrisiko gegen einen CI-Reviewer sprechen und es keinen Beleg für eine Lücke der Lenses gibt (ADR 0027 §2: Härten braucht dieselbe Evidenz wie Lockern).

- **Kosten.** Offizielle Zahl je Review: keine; Drittquellen nennen 15–25 $, unbelegt und hier nicht als Fakt gewertet. Eigene Größenordnung, **Schätzung**: 437 Lens-Läufe, Σ 225,80 $ (Opus 5.5) im Fenster 2026-10-07T12:00Z bis 2026-10-09T12:18Z (Quelle: `docs/model-routing.md` › Lens-Kostenstruktur), also rund 0,52 $ je Lauf; 63 gemergte PRs vom 2026-11-05 bis 2026-11-11 (gezählt mit `gh pr list --state merged --search "merged:2026-11-05..2026-11-11"`, Dependabot eingeschlossen). Ergebnis: mindestens rund 33 $ pro Woche bei einem lens-großen Pass je PR, bei Review je Push ein Vielfaches. Mit OAuth-Token wäre dasselbe Volumen Abo-Kontingent, das die Harness-Phase senken soll.
- **Planverfügbarkeit.** Claude Code Review ist nur für Team und Enterprise verfügbar und braucht die Claude-GitHub-App; ohne diese Pläne bleiben `/code-review` lokal, Ultrareview oder eine eigene CI mit API-Key bzw. Cloud-Zugang. Welcher Plan vorliegt, steht nicht im Repo und gehört nicht in diesen öffentlichen ADR; die Entscheidung hängt davon nicht ab, weil Kosten und Sicherheit sie allein tragen.
- **Sicherheit.** Bei Fork-PRs gibt GitHub keine Secrets heraus: die Action reviewt nur Branches desselben Repos, Code Review überspringt Drafts und Forks, PRs Dritter bekämen also keinen Review (eigene Agenten-PRs haben schon Lenses und Holdout). `pull_request_target` ist in der Fabrik ausgeschlossen (`docs/sicherheit-agenten.md`). Ein CI-Reviewer verarbeitet PR-Text, hält ein Secret und postet nach außen, das verletzt die Rule-of-Two (`docs/sicherheit-agenten.md`); die Action filtert Prompt-Injection nur teilweise („new bypasses may exist“, security.md der Action). Die Claude-GitHub-App verlangt breite Rechte (u. a. Workflows lesen und schreiben, Administration lesen, Repository-Hooks lesen und schreiben), das widerspricht minimalen Token-Rechten, zumal die Leitplanken unter `.github/workflows` liegen. Ein Secret anlegen oder die App installieren wäre ein Pre-Flight-Stopp (Secrets, Repo-Einstellungen).
- **Required-Check oder berichtend:** entfällt, ein Pilot ist nicht vorgesehen (die Action würde nur berichten, die Check-Run endet laut Doku nicht als Fehlschlag).
- **Gate-Config-Änderung** (quellprojekt#1069): entfällt, es gibt keinen Workflow, keinen Leitplanken-Pfad und keinen Audit-Kommentar; `maintainer-approved` wird seit ADR 0014 nicht mehr gesetzt.
- **Akzeptanzkriterium „Pilot bei Ja“:** entfällt, die Antwort lautet Nein.

## Konsequenzen

- Unter `.github/workflows/` kommt nichts dazu; die Review-Kette bleibt Lenses plus Holdout-Abnahme.
- Der Kostenwert oben ist eine Schätzung mit Rohwerten und Fenster, keine Messung des Dienstes.
- Die Gründe gelten anbieterunabhängig für jeden KI-Reviewer in der CI, auch für Codex-Läufe.

## Re-Evaluierung

Neu bewerten, wenn eines eintritt: (a) drei Status-Läufe in Folge zeigen Nacharbeit (`Folge #`/Revert, `scripts/factory-kennzahlen.mjs` › Nacharbeit) mit echten Defekten, die im Diff sichtbar waren und keine Lens gefunden hat (Evidenzregel analog ADR 0027 §2); (b) die Code-Review-Seite nennt Verfügbarkeit für den vorhandenen Plan ohne Zusatz-Credits. Prüftermin sonst 2027-05-12.

## Quellen

Abruf 2026-11-12: https://code.claude.com/docs/en/code-review, https://code.claude.com/docs/en/legal-and-compliance, https://code.claude.com/docs/en/code-review-costs, https://code.claude.com/docs/en/github-actions, https://code.claude.com/docs/en/authentication, https://github.com/anthropics/claude-code-action/blob/main/docs/security.md, https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md
