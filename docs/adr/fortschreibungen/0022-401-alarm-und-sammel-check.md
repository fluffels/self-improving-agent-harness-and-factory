# Fortschreibung #401 (2026-11-12): Alarm bei rotem main und Sammel-Check

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (Kern-Schnitt und Verteilung). Die Fortschreibung [#1932](0022-1932-kern-jobs-und-regeln.md) hatte den Alarm-Job in die `ci.yml`-Vorlage gelegt; der Shell-Block wohnt jetzt im Kern.

## Kontext

- **`needs` wirkt nur innerhalb eines Workflows:** der Alarm-Job von `ci.yml` sah nur die Jobs dieser Datei. Ein Bezieher mit weiteren Workflows als Required Check (Sammel-Check) bekam bei einem roten `main` dort keinen Alarm; kein Wächter prüfte, ob ein neuer Job im `needs` des Sammel-Jobs fehlt, sodass der Required Check ihn nicht deckte.

## Entscheidungen

- **Wiederverwendbarer Kern-Workflow `alarm-rot-main.yml` (`workflow_call`):** die Schritte des Alarm-Jobs (Dedup über den Titel-Präfix, Board-Position per `board-place.mjs`, `PROJECT_TOKEN` optional) liegen unverändert dort. Das Alarm-Label kommt als Pflicht-Input `label` (nur über `env`, nie im `run:`); die Fabrik übergibt `area:harness`. `PROJECT_TOKEN` wird einzeln durchgereicht, nie `secrets: inherit`. Oben `permissions: {}`, der Job trägt `contents: read` und `issues: write`. Eine Concurrency-Gruppe `alarm-rot-main` ohne Abbruch lässt gleichzeitige Alarme nacheinander laufen. Grenze: GitHub hält je Gruppe nur einen laufenden und einen wartenden Lauf; ein dritter gleichzeitiger Alarm verdrängt den wartenden zweiten, das Issue bleibt eines.
- **Config `sammelChecks`:** optionale Liste `{ workflow, job }` (Dateiname unter `.github/workflows/`, Job-ID des Sammel-Jobs). Eine Liste statt fester Workflow-Namen, weil der Kern kein Projektwort trägt (Projekt-Leitfrage).
- **Doctor-Punkt `Sammel-Check`:** je Eintrag steht jeder Job des Workflows (außer dem Sammel-Job und den Alarm-Aufrufen) im `needs` des Sammel-Jobs, und es gibt einen Job mit `uses: ./.github/workflows/alarm-rot-main.yml`, dessen `needs` den Sammel-Job nennt und dessen `if` `failure()` und `github.event_name == 'push'` enthält; der Workflow läuft auf `push`. Gelesen wird in Blockform ohne `yaml` (`blockformJobs`), weil der Wochenlauf kein `npm ci` hat; eine nicht lesbare Form macht den Punkt nicht prüfbar. Ohne `sammelChecks` ist der Punkt `OK` mit Hinweis.
- **Der Alarm-Job braucht nur `needs: [<sammel-job>]`:** `failure()` gilt für alle Vorfahren in der `needs`-Kette.

## Verworfen

- **`workflow_run`-Auslöser:** startet erst nach Ende des Quell-Workflows, nur für den Standardzweig und mit eigener Kontext-Rekonstruktion (Commit, Lauf-URL); der Aufruf per `uses` behält den Kontext des roten Laufs.
- **Polling der Check-Läufe:** eine Dauerlast ohne Gewinn gegenüber einem Job im selben Lauf.

## Grenzen

- Ob der Sammel-Job selbst `if: always()` trägt (sonst würde ein roter Vorgänger ihn überspringen und der Required Check bliebe grün-neutral), prüft der Punkt nicht; das ist als Zeile im Harness-Sammelticket festgehalten.
- Ein Bezieher übernimmt die Änderung über den Sync: `alarm-rot-main.yml` kommt als neue Kern-Datei, die `ci.yml`-Vorlage ist Projekt-Besitz und muss den Aufruf selbst tragen (Migrationszeile im Commit).
