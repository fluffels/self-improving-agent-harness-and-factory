# Fortschreibung #541 (2026-11-15): Proben vorab bewerten, Modellwechsel nach Anbieter-Empfehlung

Ergänzt [ADR 0027](../0027-regeln-lockern.md) (Punkte 2 und 7, Klasse K2); die Ledger-Zeilen bleiben unverändert (Punkt 8). Der Abschnitt steht als Datei, weil die Zahl angehängter `## Fortschreibung`-Abschnitte je ADR eingefroren ist ([README](../README.md#format)).

## Kontext

- **Probe ohne Vorab-Bewertung:** die Gegenprobe factory#546 (Opus `medium` und Sonnet-Architektur gegen Opus `high` als Lens) verbrannte 53 Läufe und 29,81 $ aufgezeichnete Kosten und wurde ohne Entscheidung abgebrochen; ein unabhängiger Reviewer hatte den Nutzen vorab nicht gegen die Kosten gehalten ([model-routing](../../model-routing.md#lens-gegenprobe-1580)).
- **Modellwechsel nach eigener Messung:** jedes neue Release löste bisher eine eigene Gegenprobe aus (Beleg factory#546). Der Anbieter veröffentlicht Empfehlungen (Beleg factory#513: Prompting-Seite zu Opus 5, Stand 2026-11-15), die eine Messung nicht ersetzt, aber vorab informiert.
- Das geplante Änderungsregister (factory#557, geschlossen) kommt nicht; seine Aufgabe, jede Änderung mit Prüftermin zu versehen, übernimmt die Ledger-Zeile mit Wiedervorlage.

## Entscheidung

Entscheidung: Proben werden vorab bewertet und Modellwechsel folgen der Anbieter-Empfehlung mit nachträglicher Prüfung, weil eine Messung, die mehr kostet als sie erspart, die Regel nicht prüfbar macht, sondern nur Geld verbrennt.

1. **Probe-Ticket vorab bewertet.** Ein Probe-Ticket (synthetische Gegenprobe, Messlauf) nennt vor dem ersten Lauf: die Wirkung je möglichem Ergebnis (welche Entscheidung folgt) und die erwarteten Kosten gegen die erwartete Ersparnis; ein unabhängiger Reviewer (nicht der Planer) bestätigt das. Fehlt die Wirkung je Ergebnis oder sind die Kosten höher als die Ersparnis, entfällt die Probe: stattdessen wird umgebaut, mit Rückfall-Trigger als Ledger-Zeile und Wiedervorlage in `.github/wiedervorlagen.json`.
2. **K2 und Punkt 2, Evidenz.** Eine veröffentlichte Anbieter-Empfehlung mit Quelle und Stand gilt als Evidenz „Doku-Zitat mit Datum“ (Punkt 2). Ein neues Modell wird entsprechend umgebaut und über den Rückfall-Trigger rückwirkend geprüft, nicht über eigene Messläufe vorab.
3. **Grenze.** Punkt 6 bleibt: Regeln gegen seltene, schwere Schäden sind so nie lockerbar.

## Folgen

- `docs/model-routing.md` ersetzt „bei jedem neuen Release eine Gegenprobe“ durch den Ablauf aus Punkt 2; alte Gegenproben bleiben als Historie mit Zahlen stehen.
- Prüftermin: Punkt (15) des Sammeleintrags `regeln-verfall-2027-03` in `.github/wiedervorlagen.json` (factory#573; vorher eigener Eintrag mit Termin 2027-01-15).

## Re-Evaluierung

Prüftermin 2027-03-01 (Punkt (15) von `regeln-verfall-2027-03`; der frühere eigene Termin 2027-01-15 entfiel mit der Faltung, factory#573). Auslöser für Verschärfung: ein Modellwechsel nach Empfehlung zieht Nacharbeit (Revert oder `Folge #` binnen 14 Tagen) nach sich, oder ein Probe-Ticket lief ohne Vorab-Bewertung.
