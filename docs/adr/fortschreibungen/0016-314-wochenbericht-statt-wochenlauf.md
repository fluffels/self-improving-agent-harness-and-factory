# Fortschreibung #314 (2026-11-11): Wochenbericht statt fester Wochenlauf

Ergänzt [ADR 0016](../0016-langfuse-takt-woechentlich.md) um den lokalen Wochenbericht-Lauf (Kind 2 von factory#278, baut auf dem Skript aus factory#313 auf) und stellt das Anlegen des Status-Tickets auf einen Anlass um.

## Kontext

Das Status-Ticket entstand bisher nach Zeit und Aktivität (Merge-Zahl, Ticket-Merges), unabhängig davon, ob die Daten etwas Auffälliges zeigten. factory#313 liefert die deterministischen Teile der Checkliste als Wochenbericht samt Urteil „Agent-Lauf nötig“. Ein Workflow auf GitHub kann ihn nicht erzeugen: die Langfuse-Instanz läuft lokal, kein Workflow hat Langfuse-Secrets.

## Entscheidung

Entscheidung: der Wochenbericht läuft **lokal** als zweites losgelöstes Kind des SessionStart-Hooks (`langfuse-wochenbericht.mjs --ausloeser sessionstart`), nicht in GitHub Actions, weil die Instanz und der Secret-Key nur auf der Maschine der Ticket-Läufe liegen und der Hook dort ohnehin bei jedem Start läuft. Die **Auslösung** des Status-Tickets geht per `workflow_dispatch` mit dem Input `langfuse_anlass` an `board-takt.yml`, weil der Board-Takt die Entscheidung (Mindestabstand, Zweitabfrage, Board-Position) schon trägt und der Input nur per `env` ins Skript kommt. Die **Ablage** ist eine Datei je Woche (`~/.claude/state/langfuse-wochenbericht/<owner>__<repo>/<montag>.json` und `.md`), weil der Lauf damit idempotent ist (ein Claim je Woche, der Stand steht in der `.json`) und der Status-Lauf die Berichte seit dem Vorgänger lesen kann.

Mit dem Config-Schlüssel `langfuseWochenbericht` legt der Takt das Status-Ticket nur noch an bei einem nicht leeren Anlass (Schwelle, fehlender Bericht, Woche ohne Daten) oder am Montags-Cron nach `wochenOhneLaufMax` Wochen ohne Status-Ticket (Höchstabstand, ohne Vorgänger sofort; ohne das Feld kein Höchstabstand, nur eine Warnung). Ohne den Schlüssel bleibt alles wie in ADR 0016. Ein Wochenbericht-Lauf, der nicht auslösen kann (Langfuse unerreichbar, Maschine aus), erzeugt nie ein stilles „alles in Ordnung“: ohne Bericht gibt es keinen Erfolgsstand, ab Donnerstag 00:00Z nach dem Wochenende wird der fehlende Bericht selbst gemeldet.

## Re-Evaluierung der Takt-Zahlen

- `MIN_MERGES` (5), `MIN_TICKET_MERGES_PUSH` (50) und `PUSH_RUHETAGE` (Fr bis So) **legen mit dem Schlüssel nicht mehr an**: Aktivität allein ist kein Anlass, die Daten entscheiden. Die Konstanten bleiben für den Fall ohne Schlüssel (Bezieher ohne Wochenbericht). Das Hochschieben eines offenen ungeclaimten Tickets (`nach-oben`) bleibt, auch für den Push-Auslöser mit seiner Untergrenze.
- `MIN_ABSTAND_STUNDEN` (24) bleibt: er schützt vor einem Doppel-Ticket nach dem Abschluss des Vorgängers, auch bei einem Anlass.
- Der Re-Evaluierungs-Trigger „drei Läufe ohne Befund“ ist durch die Schwellen abgelöst: ein Lauf entsteht nur noch bei einer Überschreitung. Der Trigger „über 5 % Wochenbudget“ wird neu bewertet: die Kostenwoche steht jede Woche im Wochenbericht, das Δ-Schwellenfeld `kostenAnstiegProzent` löst den Lauf aus; die Verdichtungszeile im nächsten Status-Lauf liest sie aus den Wochenberichten.
- **Die Messung entfällt nicht:** Erfassung und Bericht laufen unverändert jede Woche (die Berichte liegen lokal, auch ohne Status-Ticket), nur der teure Agent-Lauf entsteht bei einem Anlass; die Verdichtungszeile im nächsten Status-Lauf deckt die Wochen seit dem Vorgänger ab.

## Codex-Grenze

Codex hat keinen registrierten SessionStart-Hook ([Codex-Einstieg](../../codex/einstieg.md)); der Auslöser des Wochenbericht-Laufs ist damit nur Claude Code. Der Bericht führt die Codex-Kosten trotzdem (Quelle `codex`), solange die Daten in Langfuse stehen. Wer nur mit Codex arbeitet, löst den Lauf nicht aus; der Höchstabstand ist dort das Netz.

## Grenzen

- Verpasste Wochen (Maschine aus bis zum Montag danach) werden nicht nachgeholt; der Höchstabstand fängt das auf.
- Eine hängende Meldung (Dispatch scheitert) verfällt mit dem nächsten Montag: der Stand `melden` gilt nur für die Woche des Montags im Dateinamen.
- Ein Anlass bei offenem Status-Ticket führt nur zu `nach-oben`, kein zweites Ticket entsteht.
- Der Anlass im öffentlichen Body nennt nur Klasse und Schwellenzahlen; roher Fehlertext bleibt im lokalen Log.

## Folgen

- Eine zusätzliche lokale Logzeile je SessionStart nach Fälligkeit; kein Mehraufwand für die Session (losgelöst).
- **Prüftermin (ADR 0027):** Eintrag `wochenbericht-takt-314` in `.github/wiedervorlagen.json`: nach rund 13 Wochen prüfen, ob jeder Anlass einen echten Befund brachte und ob der Höchstabstand je eine verpasste Woche auffing; sonst Schwellen lockern oder die Regel streichen.
