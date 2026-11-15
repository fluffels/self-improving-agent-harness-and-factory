# Planer-Gegenprobe 2026-11-15: Opus `medium` und `high` gegen Opus `xhigh` (factory#547)

> 📸 **Momentaufnahme vom 2026-11-15 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Evidenz nach [ADR 0027](adr/0027-regeln-lockern.md) (Klasse K2) für die Frage des Planer-Efforts in [model-routing.md › Planer-Kosten](model-routing.md#planer-kosten-1558). Vorlage und Vorgänger: [Planer-Gegenprobe 2026-11-11](planer-gegenprobe-2026-11-11.md) (nur `high`, nur Sammeltickets und Status-Ticket, `high` verfehlte die Regel).

**Frage.** Wie viel kostet der Planer mit Opus `medium` und `high` weniger als mit `xhigh`, und lassen die billigeren Stufen auf einer Mischung aus Ticketarten mehr oder schwerere Verpasser und Falschspuren zu?

**Arme.** R = Opus `xhigh` (Ist-Stand, Referenz), H = Opus `high`, M = Opus `medium`; Alias `opus`, in allen Läufen am selben Tag auf demselben aufgelösten Modell.

**Auswahl (n = 6, vor dem ersten Lauf festgelegt).** Gemergte Tickets dieses Repos, Merge vor 2026-11-15T00:00:00Z (UTC), je das zuletzt gemergte passende; jeder PR klassifiziert mit `node scripts/groessenstufe.mjs --commit <squash-sha> --json`. Kategorien disjunkt in dieser Reihenfolge: Sammelticket (Titel „(gesammelt)“); unter den übrigen Risikoklasse `hoch`; Risikoklasse `doku` mit Stufe `voll`; dreimal Risikoklasse `normal` mit Stufe `voll`. Epic-Weichen sind ausgenommen. Am 2026-11-14 wurde nichts gemergt; übersprungen sind Doku-PRs der Stufe `S` (PR 489, 486, 484, 482).

| Kategorie | Ticket | PR | Squash-Commit | Merge (UTC) |
|---|---|---|---|---|
| Sammelticket | factory#463 | 485 | a56836a25e | 2026-11-13 18:11 |
| Risiko hoch | factory#224 | 483 | eb99efb71d | 2026-11-13 18:04 |
| Doku voll | factory#469 | 487 | 5a2d734344 | 2026-11-13 18:44 |
| Code voll | factory#459 | 466 | 4ac27573ff | 2026-11-13 17:09 |
| Code voll | factory#457 | 464 | 5bc60aafa2 | 2026-11-13 15:49 |
| Code voll | factory#456 | 462 | cc37799647 | 2026-11-13 15:20 |

Ein Ticket mit Fremdeingang (`FREMDEINGANG` in `node scripts/fremdtext.mjs --issue <nr>`) würde durch den nächsten Treffer seiner Kategorie ersetzt; keines der sechs hat einen (geprüft).

**Rezept.** Je Ticket ein Export `git archive <squash-sha>^` (erster Elternteil, ohne Git-Historie), darin die Planer-Definition vom Stand dieser Seite. Alle Arme eines Tickets nutzen denselben Export und einen bytegleichen Prompt (Titel und Body aus der Fremdtext-Ausgabe, Kommentare bis zur Claim-Zeit, fester Zusatz „Messlauf …“, sha256 je Prompt in den Rohwerten). Aufruf: `env -u CLAUDE_CODE_EFFORT_LEVEL claude -p "$(cat prompt)" --agent sih-planer --model opus --effort <xhigh|high|medium> --allowedTools "Read,Grep,Glob,Bash" --disallowedTools "Bash(gh:*)" --max-budget-usd 8 --output-format json`. Je Ticket laufen die drei Arme parallel, die Tickets nacheinander. Gemessen: `total_cost_usd`, Requests (`num_turns`), Minuten (`duration_ms`), Session, Modell aus `modelUsage`, Effort-Feld im Transkript.

**Gültigkeit.** Alle Läufe am selben UTC-Tag auf demselben aufgelösten Opus-Modell (Modellname je Lauf in den Rohwerten); ein Modellwechsel zwischen den Armen oder ein Tageswechsel macht die Gegenprobe ungültig. Der Effort je Lauf wird im Transkript belegt (Vorprobe vor den Läufen); wirkt `--effort` nicht gegen das Frontmatter, bekommt jeder Arm einen eigenen Export mit dem Frontmatter-Effort des Arms (Abweichung steht hier). Der Start eines Laufs braucht mindestens 3 h bis 24:00 UTC. Die Planer-Definition im Messlauf hat den Blob-Hash `f941062eeddee6e331b981c92f261f74ea924c7a`.

**Richter.** Blind, ein Opus-Lauf je Ticket mit `--effort xhigh`, ohne Werkzeuge. Eingaben: Ticket wie im Prompt, zum gemergten PR Titel, Text und Dateiliste mit +/−, die Schwere-Skala der Lens (`.claude/agents/factory-lens.md`, Abschnitt Blocker-Maßstab) wörtlich, die drei Pläne als A/B/C in zufälliger Zuordnung (vor dem Urteil in einer Datei festgehalten, nach dem Urteil aufgelöst). Er listet je Plan jeden **Verpasser** (Akzeptanzkriterium, Sammelzeile oder nötige Datei des gemergten PRs ohne Schritt im Plan) und jede **Falschspur** (ein Schritt widerspricht einem Kriterium oder dem gemergten Ergebnis) als Zeile `Plan | Art | Bezug | Schwere | Beleg` mit der Schwere `❌ blockierend`, `⚠️ sollte` oder `💡 hinweis`. Dasselbe Problem in mehreren Plänen bekommt denselben Wortlaut als `Bezug`. Eine Sammelzeile, die der PR nicht umsetzt und die der Plan begründet in REST oder VERFALLEN legt, ist kein Verpasser.

**Entscheidungsregel (vor dem ersten Lauf festgelegt und committet).** Übernommen wird höchstens die günstigste Stufe X aus {H, M}, die alles erfüllt:

- (a) in keinem Ticket ein `❌`-Verpasser oder eine `❌`-Falschspur, deren `Bezug` bei R desselben Tickets nicht ebenfalls `❌` ist (hat R denselben `Bezug` nur mit `⚠️`, zählt der `❌` von X als neu);
- (b) Σ `⚠️` (Verpasser plus Falschspuren) von X höchstens Σ `⚠️` von R plus 1;
- (c) Σ Falschspuren (alle Schweren) von X höchstens die von R;
- (d) Σ Kosten von X höchstens 0,8 × Σ Kosten von R (mindestens 20 % billiger).

Negativfall: eine Stufe mit einem `❌`, das R nicht hat, wird nicht übernommen, auch wenn sie billiger ist. Bestehen beide Stufen, gilt die günstigere (`medium`); besteht nur `high`, gilt `high`; besteht keine, bleibt `xhigh`. Ausfall: ohne `PLAN #<nr>`-Kopf, mit `is_error` oder bei erreichtem Budget einmal wiederholen (beide Kosten zählen); fällt H oder M erneut aus, ist dieser Arm durchgefallen; fällt R erneut aus, ist die Gegenprobe ungültig (Verbleib). Fehlt eine Gültigkeitsbedingung, folgt Verbleib mit Grund.

**Deckel** 40 $ aufgezeichnet (Schätzung rund 25 bis 27 $), inklusive Vorprobe, Wiederholungen und Richter. Vor jedem Ticket-Block gilt: Σ bisher plus 3 × teuerster bisheriger Lauf plus 1 $ (Richter) über 40 $ beendet die Gegenprobe als „Deckel“ ohne Wechsel.

**Ergebnis: steht aus.**
