# ADR 0033: Ticket-Drift als deterministischer Monatslauf

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-11-12 · Ticket: factory#28

## Status

**Akzeptiert.** Beantwortet factory#28: Offene Tickets werden wiederkehrend maschinell gegen den Code vorgeprüft. Die Rückstellung vom 2026-10-05 (Token-Kosten einer eigenen Routine, Integration in den Wochenbericht) gilt nicht mehr.

## Kontext

Das Ticket-Review vom 2026-09-29 fand bei 74 offenen Tickets veraltete Pfade, Zeilen und Zahlen, Duplikate und unbegründete Rückstellungen. Ein Teil davon ist rein mechanisch prüfbar (Pfad fehlt, Blocker geschlossen, ähnlicher Titel); die Bewertung braucht ein Urteil. Die Rückstellung nannte als Hindernis die Token-Kosten einer eigenen Routine und schlug den Wochenbericht (factory#313/factory#314) als Träger vor.

## Optionen

| Option | Bewertung |
|---|---|
| **A: Claude-Code-Routine oder `/schedule`** mit Modell-Lauf | Kostet je Lauf Tokens, braucht ein Claude-Konto am Ziel; kein Test kann belegen, dass nur der Bericht entsteht. |
| **B: Integration in den Wochenbericht** (factory#313/factory#314) | Der Bericht läuft lokal mit Langfuse-Secrets und gehört fachlich zu Langfuse; ein Bezieher ohne Langfuse bekäme den Check nicht. |
| **C (gewählt): GitHub-Action-Cron mit Node-Skript** (`scripts/ticket-drift.mjs`), Bewertung später durch einen Agenten | Der Lauf kostet 0 Tokens, braucht nur `gh` und den Checkout und passt zu `wiedervorlage.yml`; die Schreibgrenze ist per Verhaltenstest beweisbar. |

## Entscheidung

Entscheidung: C, weil der Lauf deterministisch ist (kein Modell, keine Secrets außer `PROJECT_TOKEN` fürs Board), für jeden Bezieher gleich läuft und die Zusage „schließt nichts selbst“ per Test belegt wird. Die Rückstellung gilt damit nicht mehr: ihr Grund (Token-Kosten) entfällt, und der Wochenbericht ist der falsche Träger. Der Lauf legt genau ein offenes Bericht-Issue „🔎 Ticket-Drift-Bericht <JJJJ-MM>“ an (Marker im Body) oder aktualisiert es (Body und Titel-Monat); ein Bericht mit Assignee bleibt unberührt. Schreibziel ist nur ein Issue mit Marker, Titelpräfix und vertrautem Autor, nie ein fremdes Issue mit zitiertem Marker. Ein neuer Bericht kommt ans Ende der Todo-Spalte, nicht an die Spitze: `--top` ohne Notfall-Art ließe den Kopf des Boards bei 0 enden. Die Bewertung der Befunde steht in `.agents/skills/factory/ticket-drift.md` und läuft, wenn das Bericht-Ticket dran ist.

## Konsequenzen

- Prüfliste und Grenzen: [docs/agent-harness.md](../agent-harness.md) § 2.2. Falsch-Positive (`zeile-verschoben`, Duplikat-Paare) sind Kandidaten, kein Urteil.
- Der Workflow hat `issues: write` und das Board-PAT; der Bericht entsteht als vertrauter Bot und trägt darum nur Nummern, Pfade der Whitelist, Daten und Zählungen, keine Logins und keine Zitate.
- Bezieher bekommen Skript und Workflow per Sync; ohne `PROJECT_TOKEN` steht der Bericht nicht im Board (Warnung).

## Re-Evaluierung

Prüftermin 2027-02-10 (Wiedervorlage `ticket-drift-28`, nach drei Läufen): Befunde je Lauf und wie viele zu einer Ticket-Änderung führten. Bei weniger als einem verwertbaren Befund je Lauf wird der Takt ein Quartal oder der Workflow gestrichen (ADR 0027).
