# Umsetzer: Abnahme-Urteile

Bedingte Datei des Umsetzers (Kern: `.claude/agents/factory-umsetzer.md`): lies sie, sobald der Hauptchat dich nach `ERGEBNIS: abnahme` mit `bestanden`, `fix` oder `handoff` fortsetzt.

## Abnahme-Urteile

Nach `ERGEBNIS: abnahme` prüft der Hauptchat und setzt dich per Nachricht fort (Urteil und Belege, nie mit Szenarien). Die Nachricht heißt:
- `bestanden` mit der fertigen Abnahme-Zeile: Worktree prüfen (`git status --porcelain` leer, HEAD = `head`, sonst `abgebrochen`), leerer Commit mit genau dieser Zeile, Push, warten, bis `gh pr view <pr> --json headRefOid -q .headRefOid` gleich `git rev-parse HEAD` ist (sonst läuft CI doppelt, durch `ready_for_review` und `cancel-in-progress` in `ci.yml`: der Kopf-Abgleich fängt den Lauf des alten Kopfes, die HINWEIS-Zeile in `pr-warten` den Fall gleichen Kopfes), erst dann `gh pr ready <pr>`, `gh pr merge <pr> --squash --delete-branch --auto`, dann Schritt 5.
- `fix` mit den Belegen der nicht erfüllten Kriterien: Worktree prüfen wie oben, der Fix mit eigenem Budget von einer Delta-Runde (`review-lenses`, Commit-Zeile `Runde <n>: lenses=abnahme blocker=abnahme:<k>`), dann **eine** Delta-Lens auf `<abnahme-head>..HEAD` nur mit Test-Adäquanz und Requirement-Treue (bei reiner Doku die Doku-Brille), ohne Rückfrage; jede Weiche, die der Fix entscheidet, steht als „Entscheidung: X, weil Y“ im PR-Text, nicht nur im Code; neuer Nachweis-Commit (ist das Review-Cap samt Zusatzpass damit überschritten, mit `abnahmefix=1` in der Review-Zeile), Push, erneut `ERGEBNIS: abnahme`. Ist dieses Budget erschöpft (ein zweiter Abnahme-Fix) und kein belegter Zusatzpass möglich: `festgefahren` mit `FESTGEFAHREN: review`.
- `handoff` mit den Gründen (bei „nicht prüfbar“ steht der Ticket-Kommentar schon; bei einem Werkzeug-Abbruch gibt es keinen, den Abbruch entscheidet der Hauptchat nach `docs/factory/entscheidungsprotokoll.md`): setze am PR das Festgefahren-Label der Projekt-Config (`labels.festgefahren`; ohne es nähme die Claim-Prüfung das Ticket nach wenigen Stunden wieder auf), dann `festgefahren` mit `FESTGEFAHREN: abnahme`; der PR bleibt Entwurf, der Worktree bleibt stehen (Wächter R8 verlangt Entwurf ohne Auto-Merge und das Label am PR).

Ist der Worktree nach einer Abnahme verändert (nicht sauber oder HEAD ≠ `head`), meldest du `abgebrochen`.
