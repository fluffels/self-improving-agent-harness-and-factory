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
