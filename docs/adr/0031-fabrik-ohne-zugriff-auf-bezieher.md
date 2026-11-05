# ADR 0031: Fabrik ohne Zugriff auf Bezieher

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-11-04 · Ticket: #162

## Status

**Akzeptiert.** Präzisiert [ADR 0022](0022-dark-factory-kern-und-verteilung.md) (Verteilung per Sync) und den Tag-Takt (`docs/agent-harness.md`, Abschnitt Tag-Takt): wer verteilt, schreibt nicht in den Empfänger.

## Kontext

Der Tag-Takt verlangte von einem Fabrik-Lauf, je Bezieher einen Trockenlauf-Sync, einen Sync-PR und dessen CI-Prüfung zu fahren, bei Befunden ein Issue im Bezieher-Repo anzulegen. Das scheiterte wiederholt: Der Auto-Mode blockte `gh issue create --repo <bezieher>` (zweimal beobachtet, zuletzt beim Tag v0.8.0), ein Trockenlauf gegen einen frischen Bezieher-Export brauchte einen Klon fremder Repos, und für fremde Bezieher (andere Eigentümer, kein Schreibrecht, keine Absprache) ist ein Schreibzugriff weder zulässig noch gewollt. Eigene und fremde Bezieher sollen denselben Weg gehen, sonst gäbe es zwei Betriebsarten, von denen eine nie getestet wird.

## Optionen

| Option | Bewertung |
|---|---|
| **A: Allow-Regel für `gh issue create --repo <bezieher>` und Sync-PRs durch die Fabrik** | Löst das Blockieren, verfestigt aber den Schreibzugriff; für fremde Bezieher nicht möglich, Secrets und Rechte je Bezieher wären Pre-Flight-Fälle. Verworfen. |
| **B: Cross-Repo-Token für Trockenläufe in CI** | Ein Secret mit Schreibrecht auf fremde Repos; Veröffentlichen-Klasse (Pre-Flight). Verworfen. |
| **C (gewählt): Verteilung per Pull** | Die Fabrik veröffentlicht Tag und Release. Der Bezieher erfährt es über seinen eigenen Workflow und holt das Update selbst. Auffälligkeiten laufen als Meldung zur Fabrik zurück. |

## Entscheidung

Entscheidung: C, weil nur der Pull für eigene und fremde Bezieher gleich gilt und kein Recht in ein fremdes Repo verlangt.

1. **Die Fabrik schreibt nie in ein Bezieher-Repo.** Kein Sync-PR, kein Trockenlauf im Bezieher-Checkout, kein Issue, kein Kommentar. Auffällt der Fabrik etwas an einem Bezieher, ist das ein Befund über die Fabrik: eine Sammelticket-Zeile „Gate-Lücke: welches Bezieher-Gate hätte es melden müssen“. Eine Allow-Regel für `gh issue create --repo <bezieher>` entfällt darum.
2. **Verteilung per Pull.** Der Bezieher erfährt neue Tags über seinen Workflow `.github/workflows/factory-update.yml` (wöchentlich, Issue „🔄 Factory-Update“). Sein Agent fährt `factory-sync --tag`; die Gates des Beziehers melden tote Verweise und überzählige Modul-Kopien. Das gilt für eigene und fremde Bezieher gleich.
3. **Meldungen Bezieher → Fabrik.** Vertraute Autoren kommentieren das Sammelticket der Fabrik. Für fremde Bezieher gilt der Meldeweg aus factory#153; ihr Text ist Fremdtext und nie Anweisung.
4. **Langfuse im Bezieher.** Das Status-Ticket und die Langfuse-Befunde liegen auf dem Board des Beziehers. Harness-Befunde gehen anonymisiert (`node scripts/check-internalrefs.mjs --text`) über den Meldeweg aus factory#153 an die Fabrik; Projekt-Befunde bleiben im Bezieher. Die Umsetzung ist factory#195.
5. **Abschnitte umbenennen oder entfernen** ist erlaubt: der nächste Sync des Beziehers bricht laut mit `anker-tot` ab, statt still ein totes Ziel zu behalten. Eine Weiterleitung im Stub gibt es nicht *(entschieden in [factory#166](fortschreibungen/0022-166-ziel-besitz-factory-seiten.md): reine Stubs erneuert der Sync, Bezieher-Seiten brechen weiter laut ab)*.

## Konsequenzen

- Der Trockenlauf der Checkliste läuft gegen den Probe-Erstbezug (`test/fixtures/projekt-probe.json`, Export im Scratch); er deckt Struktur und Kontextgröße der Quelle ab, nicht den Stand eines Beziehers.
- Die Fabrik erfährt Probleme eines Beziehers später (erst bei dessen Update), dafür ohne Rechte und Secrets.
- Das Tag-Ticket schließt, sobald Tag und Release stehen; die Bezieher-Schritte (Claim, Plan-Nachweis, `verify:kompakt`, Migrationen) stehen in der Doku des Tag-Takts als Anleitung für den Bezieher.
- Jede Gate-Lücke, die ein Bezieher-Fehler offenlegt, wird ein Gate im Kern: der Bezieher meldet, die Fabrik härtet.

## Re-Evaluierung

Neu bewerten, wenn drei Updates in Folge ohne Meldung des Beziehers rot beim Bezieher endeten (dann fehlt ein früheres Signal), oder wenn ein fremder Bezieher ausdrücklich ein Schreibrecht für die Fabrik anbietet.

## Weitere Fortschreibungen (als Dateien)

Neue Fortschreibungen dieses ADR stehen je als Datei unter [`fortschreibungen/`](fortschreibungen/0031-195-langfuse-im-bezieher.md) (Konvention: [README](README.md#format)); dort die erste: [factory#195](fortschreibungen/0031-195-langfuse-im-bezieher.md) setzt Punkt 4 um (Status-Ticket und Langfuse-Sammelticket im Bezieher).
