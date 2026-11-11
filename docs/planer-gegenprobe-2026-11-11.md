# Planer-Gegenprobe 2026-11-11: Opus `high` gegen Opus `xhigh` für die Planer-Klasse `high` (factory#311)

> 📸 **Momentaufnahme vom 2026-11-11 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Evidenz nach [ADR 0027](adr/0027-regeln-lockern.md) (Klasse K2) für die Umstellung in [model-routing.md › Planer-Effort nach Ticketklasse](model-routing.md#planer-effort-nach-ticketklasse-factory311). Vorlage und Vorgänger: [Planer-Gegenprobe 2026-10-16](planer-gegenprobe-2026-10-16.md), dort stand `high` am Sammelticket-Plan zuletzt rot.

**Frage.** Verpasst Opus `high` bei Tickets der Planer-Klasse `high` (Sammeltickets und das Status-Ticket, [Klassifikation](../scripts/planer-effort.mjs)) mehr Akzeptanzkriterien, Sammelzeilen oder nötige Dateien als Opus `xhigh`, und hat es mehr Falschspuren?

**Entscheidungsregel (vor dem ersten Lauf festgelegt, mit diesem Commit).**

- **Arme:** R = Opus `xhigh` (heutige Definition, Referenz), H = Opus `high`. Beide über den aktuellen Opus-Release der Maschine (Alias `opus`).
- **Tickets (n = 5):** gemergte Tickets dieses Repos, für die `node scripts/planer-effort.mjs --issue <nr>` `high` liefert: factory#294, factory#283, factory#280, factory#258 (Sammeltickets) und factory#252 (Status-Ticket). Je Ticket und Arm ein Lauf (10 Läufe). Der Checkout ist der erste Elternteil des Squash-Commits des gemergten PRs (Export ohne Git-Historie), die Planer-Definition ist in allen Checkouts die aktuelle; der Prompt ist in beiden Armen bytegleich (Titel und Body des Tickets plus ein fester Zusatz: Stand = dieser Checkout, Kommentare nach dem Claim gehören nicht zum Ticket).
- **Richter:** blind, ein Opus-Lauf je Ticket mit `xhigh`-Standard der Sitzung; bekommt Ticket, Dateiliste und Text des gemergten PRs und die beiden Pläne gemischt als A/B. Er zählt je Plan **Verpasser** (Akzeptanzkriterium oder Sammelzeile des gemergten PRs ohne Schritt im Plan, oder eine nötige Datei der Dateiliste fehlt) und **Falschspuren** (ein Schritt widerspricht einem Akzeptanzkriterium oder dem gemergten Ergebnis).
- **Wechsel auf `high` nur, wenn alles zutrifft:** (1) Σ Verpasser von H ≤ Σ Verpasser von R, (2) in keinem Ticket verpasst H ein Akzeptanzkriterium oder eine Zeile, die R abdeckt, (3) Σ Falschspuren von H ≤ die von R. Ein Kostenkriterium entfällt: die Ersparnis von rund −51 % gilt als gemessen ([Gegenprobe 2026-10-16](planer-gegenprobe-2026-10-16.md)), hier zählt nur, ob die Qualität hält.
- **Sonst** meldet der Umsetzer `entscheidung-noetig` mit den Rohwerten und stellt nicht um.
- **Deckel** 30 $ aufgezeichnet (Schätzung rund 14 $); wird er erreicht, endet die Gegenprobe als „Deckel“ ohne Entscheidung.

**Ergebnis: kein Wechsel, `high` besteht die Regel nicht; der Planer bleibt Opus `xhigh`.** H verpasst Σ 28 Kriterien, Zeilen oder Dateien gegen 22 bei R (Kriterium 1 verfehlt), in factory#294 die Zeile L13 und in factory#258 fünf Dateien, die R abdeckt (Kriterium 2 verfehlt), und hat mehr Falschspuren (17 gegen 16, Kriterium 3 knapp verfehlt). Der Abstand ist klein und ein Richter-Lauf je Ticket ist ein grobes Maß; die Regel war vorab streng gewählt und gilt, wie sie steht. Das deckt sich mit dem Befund vom 2026-10-16 (H 3 gegen 1 Verpasser).

**Läufe** (Headless, `claude -p … --agent sih-planer --model opus --effort <xhigh|high> --allowedTools "Read,Grep,Glob,Bash"`, `total_cost_usd` aus der Ausgabe, Requests = `num_turns`, Session = Lauf-Session, Checkout und Prompt je Ticket in beiden Armen gleich; die Läufe liefen fünf gleichzeitig):

| Ticket | Arm | Kosten ($) | Requests | Minuten | Session |
|---|---|--:|--:|--:|---|
| factory#294 | R | 2,42 | 13 | 9,0 | 2722ba69 |
| factory#294 | H | 1,42 | 12 | 4,1 | e1ff216f |
| factory#283 | R | 1,88 | 14 | 6,8 | 401d8b07 |
| factory#283 | H | 0,88 | 7 | 2,4 | e74bdaa9 |
| factory#280 | R | 2,29 | 14 | 8,3 | 5bb81574 |
| factory#280 | H | 1,15 | 12 | 3,8 | 35369715 |
| factory#258 | R | 2,13 | 22 | 7,7 | c95b8e23 |
| factory#258 | H | 1,13 | 17 | 3,2 | 8a41a68d |
| factory#252 | R | 1,26 | 9 | 3,2 | b8d7d66a |
| factory#252 | H | 0,74 | 11 | 1,5 | c5e6d61c |

Σ R 9,98 $ (Ø 2,00), H 5,31 $ (Ø 1,06), das sind −47 % je Lauf.

**Richter** (blind, ein Opus-Lauf je Ticket mit `--effort xhigh`, ohne Werkzeuge, 0,30 bis 0,71 $, Σ 2,45 $; Zuordnung A/B zu den Armen fest, vor dem Urteil nicht bekannt, nach dem Urteil aufgelöst). Verpasser / Falschspuren je Ticket:

| Ticket | R | H | verpasst von H, nicht von R |
|---|---|---|---|
| factory#294 | 2 / 2 | 4 / 3 | Zeile L13, `test/factory-kennzahlen-datenbasis.test.ts` |
| factory#283 | 3 / 2 | 3 / 3 | |
| factory#280 | 15 / 10 | 14 / 8 | |
| factory#258 | 2 / 2 | 7 / 3 | `scripts/codex-lib.mjs`, `test/harness/codex-setup.test.ts`, `scripts/langfuse-takt.mjs`, `test/langfuse-takt.test.ts`, `docs/harness-glossar.md` |
| factory#252 | 0 / 0 | 0 / 0 | |
| Σ | 22 / 16 | 28 / 17 | |

**Kosten der Gegenprobe:** 9,98 + 5,31 + 2,45 = 17,74 $, unter dem Deckel 30 $ (Schätzung 14 $).

**Grenzen.**
- Ein Lauf je Arm und Ticket, ein Richter je Ticket, n = 5: die Summen sind klein und streuen. In factory#280 (Sammelticket mit 17 Zeilen und Deckel) zählt der Richter für beide Arme 14 bis 15 Verpasser, weil der Plan nur einen Teil der Zeilen wählen darf und der gemergte PR andere umsetzte; dieses Ticket trägt wenig Unterscheidung bei. Ohne factory#280 stehen die Summen bei 7 gegen 14 Verpasser.
- Die Basismenge ist eng: die Klasse `high` besteht heute nur aus Sammeltickets und dem Status-Ticket; vier der fünf Tickets sind Sammeltickets.
- Der Planer lief als Hauptthread-Agent (`--agent`), nicht als gespawnter Subagent, die Checkouts sind Exporte ohne Git-Historie, und die Planer-Definition ist in allen Checkouts die aktuelle. Die Kommentare des Tickets bis zum Claim stehen im Prompt (die Sammelzeilen stehen dort, nicht im Body).
- Der Richter bekam nicht die Requirement-Treue-Blocker der Runde 1, nur Ticket, PR-Text und Dateiliste; er bewertet den Plan gegen das Endergebnis, nicht gegen den Zwischenstand.
- Ausgangswert für den Rückfall-Trigger (`node scripts/lauf-ergebnis.mjs --von 2026-10-28T00:00:00Z --bis 2026-11-12T00:00:00Z --json`, Feld `blocker` der Brille `requirement-treue` je gemergtem PR): alle PRs Ø 1,51 je PR (Σ 115 bei 76 PRs mit Blockerfeld), PRs der Klasse `high` Ø 2,76 (Σ 69 bei 25 PRs). Die Klasse `high` liegt schon heute klar über dem Gesamtwert; ein Trigger gegen 1,51 wäre für sie immer ausgelöst.

**Befunde.** Zwei Kosmetik-Zeilen im Harness-Sammelticket (factory#303): die doppelte Sammelticket-Erkennung per Regex neben der Titelliste, und der Hinweis, dass Sammelzeilen in den Kommentaren stehen (Messläufe laden sie bis zum ersten `assigned`-Ereignis).

**Wiedervorlage.** Nur ein neuer Opus-Release; Rezept wie hier, die Entscheidungsregel vorher festlegen. Die Klassen-Idee (Planer-Effort nach Ticketart) ist damit verworfen, solange `high` die Regel verfehlt; das Skript zur Klassenbestimmung wurde nicht übernommen (ungenutzt).
