# Mutationslauf-Messung 2026-11 (factory#299)

> 📸 **Momentaufnahme vom 2026-11-11 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Messung des berichtenden Mutationslaufs ([Fortschreibung factory#299](adr/fortschreibungen/0022-299-mutation-adapter.md)) an drei gemergten Code-PRs mit vorab festgelegten Brauchbarkeitskriterien. Teil des Epics factory#275. Vorbild im Aufbau: [Lens-Gegenprobe 2026-10-15](lens-gegenprobe-2026-10-15.md).

**Frage.** Taugt ein Mutationslauf auf den Diff-Zeilen als Ergänzung der Test-Lens, also findet er die Lücken, die die Test-Lens in Runde 1 als „Sabotage“-Blocker meldet, in vertretbarer Zeit und mit wenig Rauschen?

## Entscheidungsregel (vor dem ersten Messlauf festgelegt, mit diesem Commit)

**Brauchbarkeit (wörtlich aus factory#299, nicht nachträglich verschoben):**

1. Median-Laufzeit je Diff höchstens 10 min lokal.
2. Mindestens 2/3 der Runde-1-Blocker der Sabotage-Klasse überdeckt.
3. Höchstens 20 % der Überlebenden äquivalent oder irrelevant (nach Mutator-Ausschluss, den die Messung festlegt).

**Präzisierungen (ebenfalls vorab):**

- **Laufzeit:** wall-clock je Lauf, Median über alle neun Läufe (drei PRs mal drei Stände). Ein Lauf über 30 min wird mit `SIGINT` beendet und zählt als „> 30 min“; überschreitet die Messung 30 min je Diff, meldet der Umsetzer das, statt ein Urteil zu erfinden.
- **Überlebend** in (2) und (3) heißt `Survived` oder `NoCoverage`; die Aufteilung wird ausgewiesen.
- **Sabotage-Klasse:** ein Runde-1-Blocker der Test-Lens, dessen Beleg lautet „Code-Stelle verfälscht oder entfernt, Tests bleiben grün“ oder „Guard, Zweig oder Regex-Komponente ohne Test, der bei Verfälschung rot wird“. Nicht dazu: fehlende Szenarien der Akzeptanzkriterien ohne Code-Stelle, Teststruktur und Testnamen, Flakiness, Fixture-Realismus.
- **Überdeckung:** Anteil der Blocker der Sabotage-Klasse, deren Zeile im Stand (a) einen überlebenden Mutanten trägt. Zeilenzuordnung: die Code-Zeile in (a), deren Verhalten der Fund nennt; nennt er nur einen Guard oder eine Funktion, die Bedingungszeile; ist er nicht zuordenbar, bleibt er im Nenner.
- **Quellen der Funde:** Commit-Message des Fix-Commits (b), PR-Kommentare (per `node scripts/fremdtext.mjs --pr <nr>`), sonst der neue Test im Diff (a)→(b).
- **Kindprozess-Artefakte:** ein per Spawn getesteter Code, der als `NoCoverage` oder `Survived` erscheint, zählt als „äquivalent/irrelevant“, Unterklasse „Kindprozess“ (er schlägt gegen Bedingung 3).
- **Drei Stände je PR:** (a) Eltern-Commit des ersten Fix-Commits mit Zeile `Runde 1:`, (b) Fix-Commit Runde 1, (c) gemergter Stand (Diff `<c>^1...<c>`); für (a) und (b) die Merge-Base gegen `origin/main`.
- **PR-Auswahl:** `node scripts/lauf-ergebnis.mjs --von 2026-10-25T00:00:00Z --bis <Messbeginn> --json` (das Flag `--bis` ist Pflicht), die zehn PRs mit den meisten Blockern der Test-Lens. Klassen über die Code-Dateien (ohne Tests) des Squash-Diffs: K = ein Test des PRs startet ein Skript per `spawnSync`, `execFileSync` oder `spawn`; R = Regex-Literale plus `new RegExp` je hinzugefügter Zeile; G = `if (`, `throw` und frühe `return` je hinzugefügter Zeile. Vergabe der Reihe nach: zuerst K an den PR mit den meisten Blockern, dann R und G an die höchste Dichte der übrigen; kein PR doppelt.
- **Mutator-Ausschluss:** wird an der Kalibrierung auf dem eigenen Diff dieses Tickets festgelegt (Abschnitt „Kalibrierung“), mit Begründung je Mutator, und vor dem ersten Mess-PR committet; er ist die einzige Konfiguration für (2) und (3).
- **Grenze der Handklassifikation:** „echte Lücke“ oder „äquivalent/irrelevant“ je Überlebendem entscheidet ein Mensch-gleicher Leser (hier der Umsetzer) von Hand, ohne zweiten Leser; das Urteil trägt diese Unschärfe.

## Kalibrierung, Messung und Urteil

(folgt in den nächsten Commits dieses Branches)
