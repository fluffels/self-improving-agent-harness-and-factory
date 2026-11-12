# Fortschreibung #396 (2026-11-12): Kalender-Prüftermin der Größenstufe S und messbarer Trigger der Ausgabe-Diät

Ergänzt [ADR 0027](../0027-regeln-lockern.md): zwei Ledger-Zeilen vom 2026-11-11 hatten einen Rückfall-Trigger, der in der Fabrik nicht oder nicht eigens prüfbar war. Beide werden prüfbar, ohne dass eine Regel sich ändert; die Ledger-Zeilen bleiben unverändert (Punkt 8).

## Kontext

- **Größenstufe S (factory#271):** der Trigger „keine messbare Einsparung nach 5 S-Läufen“ setzt fünf S-Läufe voraus. Der Grundschutz schließt in der Fabrik `/scripts/` und `/test/harness/` aus; von 40 Squash-Commits auf `origin/main` (2026-11-06 bis 2026-11-11) wären 2 `S` gewesen, beide Doku ([model-routing](../../model-routing.md#größenstufe-s-factory271)). Fällt kaum ein Diff auf `S`, bleibt der Prüftermin aus, und die Regel wird nie geprüft.
- **Ausgabe-Diät (factory#310):** die Ausnahme „für den Umsetzer entfallen `git diff --stat` zuerst und der knappe Test-Reporter“ trug keinen eigenen Trigger. Die Trigger der Zeile (rote Läufe von `check-review-nachweis`, Lauf ohne gelesene bedingte Datei) messen die Auslagerung der bedingten Dateien, nicht die Diät.

## Entscheidung

Entscheidung: die Größenstufe S bekommt zusätzlich zum Zähler einen Kalendertermin, und die Ausnahme der Ausgabe-Diät bekommt eine eigene Messgröße, weil ein Trigger, der ausbleiben oder nicht gemessen werden kann, die Regel nie prüfbar macht (ADR 0027, Verfallsdatum je Regel).

1. **Größenstufe S, Kalendertermin.** Der Sammeleintrag `regeln-verfall-2027-03` in `.github/wiedervorlagen.json` (2027-03-01) prüft die Stufe, je nachdem was zuerst eintritt: der Status-Lauf nach dem fünften S-Lauf oder dieser Termin. Am Termin zählen die S-PRs seit 2026-11-11 (`git log --grep` auf `lenses=kombiniert`, `— skizze`, `— klein`). Ab 5 gilt die Nachmessung aus [model-routing](../../model-routing.md#größenstufe-s-factory271); darunter wird mit den vorhandenen gemessen und die Zahl als Grund genannt, danach bleibt die Stufe, oder sie wird nach Punkt 4 zurückgenommen bzw. die Grenze gesenkt.
2. **Ausgabe-Diät, messbarer Trigger.** Messgröße: Tool-Ergebnis-Tokens je Umsetzer-Request, weil sie die Diät vom Sockel-Effekt desselben PRs trennen (die Kürzung des Kerns liegt im `cacheRead`, nicht im Zuwachs durch Tool-Ergebnisse). Befehl: `node scripts/kontext-treiber.mjs --von <A> --bis <B> --agent sih-umsetzer --je-ticket --json`; Wert = `gesamt.wachstum.ergebnis` geteilt durch `gesamt.gesamt.requests` (Σ Tool-Ergebnis-Tokens des Fensters je Request; die Ausgabe führt das Wachstum nur gesamt, keinen Median je Ticket). Schwelle (K1-Standard): der Wert über die drei Status-Läufe nach dem Merge von factory#310 zusammen liegt über dem Basiswert → Revert der Ausnahme per PR (die Ausgabe-Diät gilt wieder für den Umsetzer).
3. **Basiswert (einmal gemessen).** Fenster 14 Tage vor dem Merge von factory#310 (2026-10-28 bis 2026-11-11 16:32 UTC): 30 Tickets, 3.318 Requests, Tool-Ergebnis-Wachstum 1.450.117 Tokens, also **437,0** je Request. Fenster ab dem Merge bis 2026-11-12: 35 Tickets, 2.929 Requests, 1.160.666 Tokens, also 396,3 je Request (nur Orientierung: das Fenster ist kürzer als drei Status-Läufe und kein Beleg).

## Folgen

- Die Ledger-Zeilen vom 2026-11-11 (Größenstufe S, factory#310) bleiben unverändert; diese Fortschreibung ist ihre Prüfvorschrift. Ein Auslösen bekommt den Vermerk „ausgelöst“ (Punkt 8).
- `docs/model-routing.md` nennt den Kalendertermin; der Sammeleintrag `regeln-verfall-2027-03` trägt beide Prüfungen.
- Kein Secret-Key nötig: `kontext-treiber` liest lokale Transkripte.

## Re-Evaluierung

Prüftermin: `regeln-verfall-2027-03` (2027-03-01). Frage: Fiel der Messwert der Ausgabe-Diät über die Basis, oder gab es S-Läufe in der Fabrik? Ohne Fund und Beleg: Entscheidung „bleibt“ oder Lockern nach ADR 0027.
