# Fortschreibung #268 (2026-11-10): Deckel je Sammelticket-Lauf, Rest ins Folge-Sammelticket

Ergänzt [ADR 0026](../0026-sammelticket-gruppen.md). Löst für den einzelnen Lauf die Aussage „keine Zeilengrenze“ (quellprojekt#1687) und für die nicht gewählten Zeilen „kein Rest-Übertrag“ (quellprojekt#1311) ab. Die Gruppen (Entscheidung 2) bleiben.

## Kontext

Seit der Abschaffung der Generationsgrenze wachsen Sammel-PRs mit dem Rückstau. Rohwerte (Quelle: `gh pr view <nr> --json changedFiles,additions,deletions` und die `SIH-Review:`-Zeile des Squash-Commits; `runden=` zählt Review-**Pässe**, siehe `scripts/check-review-nachweis.mjs`):

| PR (Ticket) | Zeilen | Dateien | Diff | runden | Blocker arch/req/test | Override |
| --- | --- | --- | --- | --- | --- | --- |
| #266 (factory#260) | 17 | 49 | +1090/−90 | 3 | 0/3/8 | ja |
| #264 (factory#247) | 34 | 80 | +1929/−182 | 5 | 1/4/5 | ja |
| #251 (factory#238) | 31 | 71 | +1132/−225 | 4 plus 1 Zusatzpass | 0/1/4 | ja |
| #250 (factory#220) | 58 | 96 | +1522/−283 | 2 | 1/4/5 | ja |
| #261 (factory#258, Vergleich) | nicht erhoben | 14 | +253/−21 | 2 und 3 | 1/0/3 | nein |

Die Dateizahlen sind `changedFiles` des PR (das Ticket nennt 71–102; die Abweichung ist eine andere Zählung, nicht nachgeprüft). Die Review-Pässe wuchsen mit der Breite (4–5 bei 31–34 Zeilen gegenüber 2–3 bei 14 Dateien), `check:diffsize` ist per Override Dauerzustand, ein Lauf dauert laut Messung des Tickets 80–120 min und kostet 20–33 $ (Untergrenze, ein Ein-Zeilen-Ticket 3,5 $ und 27 min).

## Optionen

- **(a) Status quo:** verworfen, der Override ist Dauerzustand und die Reviews werden breit.
- **(b) Generationsgrenze im Takt zurück:** verworfen, Handarbeit und Takt-Code, wie in ADR 0026 schon abgelöst.
- **(c) Nur `check:diffsize`, ohne Zeilenzahl:** verworfen, die Datei-Grenze allein sagt dem Planer nicht, wie viele Zeilen er wählt.
- **(d) Takt-Schwelle senken:** verworfen, sie deckelt keinen einzelnen Lauf.
- **(e) Deckel je Lauf in AGENTS.md, Rest ins Folge-Sammelticket:** gewählt.

## Entscheidung

**Entscheidung: ein Lauf nimmt höchstens den Deckel laut AGENTS.md (Zahl nur dort, SSOT) und die Dateigrenze von `check:diffsize`, das Strengere gilt; die gewählten Zeilen werden komplett umgesetzt, weil der Rest, Dazugekommenes und Funde außerhalb des Scopes (Lens, Abnahme) je eine Zeile im Folge-Sammelticket werden und nie in denselben PR wachsen.** Zwölf Zeilen, weil ADR 0026 sie bei der Re-Evaluierung nannte, der Baseline-Median bei elf liegt und die letzten Läufe 1,7 bis 3 Dateien je Zeile brauchten (die Dateigrenze greift meist früher). Der Planer wählt in Kommentar-Reihenfolge, älteste zuerst (`DECKEL: …`-Zeile im Plan), der Umsetzer verkleinert nur vom Ende her. Der Board-Takt bleibt unverändert: übertragene Zeilen sind Kommentare vertrauter Autoren und zählen zum Füllstand, ab der Schwelle holt der Takt den Nachfolger nach dem Merge. Ein `Diffsize-Override` gilt nur noch für eine einzelne Zeile, die allein darüber liegt. Kein Skript erzwingt den Deckel; der Wächter `test/harness/sammelticket-deckel.test.ts` bindet die Zahl an eine Stelle und schlägt an, wenn der Wortlaut den Rest wieder in denselben PR zieht.

## Konsequenzen

- **Gegenseite:** jeder PR trägt feste Kosten (Untergrenze 3,5 $ und 27 min je Lauf laut Ticket; die Anteile von verify, Review und CI an der Laufzeit sind im Plan genannt, nicht nachgemessen). Mehr, kleinere Läufe zahlen diese öfter, und es droht Rückstau, wenn mehr Zeilen hereinkommen, als ein Lauf schafft. Dagegen stehen kürzere, billigere Reviews je Lauf. Je Zeile sind größere Läufe gemessen billiger (docs/model-routing.md, Messung der Sammeltickets: ab 12 Zeilen im Median 0,35 $ je Zeile gegenüber 0,43 $ insgesamt, weil sich die festen PR-Kosten verteilen); dass kleinere Läufe je Zeile teurer werden, ist damit belegt als Richtung, die Größe misst die Re-Evaluierung.
- **Takt:** mehr, kleinere Läufe über der Schwelle; ein Rest unter 10 Kommentaren wartet auf neue Befunde, ab 10 wird nach dem Merge sofort geholt.
- **Gruppen** bleiben unverändert; unter dem Deckel ist offen, ob sie sich lohnen.

## Re-Evaluierung

Über die nächsten drei gedeckelten Harness-Läufe: kein Diffsize-Override, `runden` höchstens 3 je Review-Zeile, und die offenen Zeilen im ungeclaimten Sammelticket (`zaehleBefundZeilen`) nach dem Lauf höchstens doppelt so viele wie der Deckel. Sonst stehen Deckel oder Takt-Schwelle neu zur Wahl.
