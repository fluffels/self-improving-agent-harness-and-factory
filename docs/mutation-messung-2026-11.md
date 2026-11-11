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

## Prüfaufträge (Ergebnis)

Alle am eigenen Diff dieses Tickets (Werkzeug: `@stryker-mutator/core` und `@stryker-mutator/vitest-runner` 10.1.1, vitest 5.1.0, Node 22; nur diese Seite und der Projektanteil nennen das Werkzeug).

1. **Zeilenbereiche in `mutate`: ja.** `datei:von-bis` mutiert nur Mutanten, die in diesen Zeilen beginnen, `bis` ist inklusiv (Probe auf `scripts/mutation-lauf.mjs`: `100-100` ergab nur Zeile 100, `100-101` beide Zeilen, `99-100` nur die Mutanten von Zeile 100, weil Zeile 99 keine hat). Ein Mutant zählt für den Bereich, in dem er **beginnt**; ein mehrzeiliger Ausdruck, der davor beginnt, fehlt. Der Kern filtert den Bericht trotzdem nach den Bereichen (zweites Netz).
2. **Mutantenaktivierung in Kindprozessen: nein.** Der Vitest-Läufer aktiviert den Mutanten im Test-Worker (`inject('activeMutant')`), nicht über die Umgebungsvariable `__STRYKER_ACTIVE_MUTANT__`, die ein gespawntes Kind erben würde; auch die Abdeckung kommt nur aus dem Worker-Prozess. Belegt an `main()` von `scripts/mutation-lauf.mjs` (Zeilen 176 bis 199, nur ein Smoke-Test spawnt das Skript): unter `coverageAnalysis` `perTest`, `all` und `off` (mit `vitest.related: false` und einer Test-Auswahl, die den Smoke-Test einschließt) ergaben sich jeweils identisch 24 `NoCoverage`, 1 `Killed`, 1 `Survived`, 1 `Timeout`: der Wechsel des Modus ändert nichts. Folge: Code, den nur ein Kindprozess ausführt, erscheint als `NoCoverage`; das wird je Lauf in der Spalte „Kindprozess“ ausgewiesen und zählt als „äquivalent/irrelevant (Kindprozess)“. Gewählt ist `perTest` (schnellster Modus, gleiches Ergebnis).
3. **Sandbox und git.** Mit der Sandbox-Kopie (Standard) scheitert schon der Probelauf, weil Tests `git ls-files` und den Diff lesen; die Config setzt `inPlace: true` (nur sinnvoll im committeten, sauberen Worktree; ein abgebrochener Lauf kann `stryker-setup-*.js` und `.stryker-tmp/` zurücklassen, beides ist in `.gitignore`). Der Läufer startet standardmäßig mit `pool: threads`, ein Test mit `process.chdir()` scheitert dort; die Config setzt `vitest.pool: "forks"`.
4. **Dynamisch gebaute Regexes als Grenze.** Ein Mutationswerkzeug mutiert nur Regex-Literale (Mutator `Regex`); eine mit `new RegExp(<Zeichenkette>)` gebaute Regex ist für das Werkzeug eine Zeichenkette (ausgeschlossen, siehe Mutator-Ausschluss) und wird nicht komponentenweise verfälscht. Der Vollsweep der Test-Lens über Regex-Komponenten bleibt dort die einzige Prüfung.
5. **Weitere Werkzeuge mit dem Berichtschema: offene Grenze.** Das Schema „mutation-testing-elements“ ist ein veröffentlichtes JSON-Schema des Projekts `mutation-testing-elements`; hier belegt ist nur das Werkzeug oben, das es schreibt. Ob ein Werkzeug für andere Sprachen (Java, Python) es liefert, wurde nicht geprüft; der Kern verlangt nur `files[*].mutants[*]` mit `status`, `mutatorName`, `replacement` und `location.start.line`.

## Kalibrierung und Mutator-Ausschluss (vor dem ersten Mess-PR festgelegt)

Eigener Diff dieses Tickets (`scripts/gate-befehl-lib.mjs`, `scripts/mutation-lauf.mjs`; Werkzeug-Standard ohne Ausschluss):

| Stand | Dauer | Mutanten | getötet | überlebt | ohne Abdeckung |
|---|--:|--:|--:|--:|--:|
| erster Lauf | 3 min 35 s | 360 | 291 | 44 | 25 |
| `StringLiteral` ausgeschlossen, Tests nachgeschärft | 2 min 6 s | 289 aktiv (81 ignoriert) | 249 | 24 | 16 |
| zusätzlich `ObjectLiteral` ausgeschlossen, weitere Lücken geschlossen | 2 min 23 s | 269 aktiv (104 ignoriert) | 246 | 10 | 13 |

Handklassifikation der 44 Überlebenden des ersten Laufs: 17 waren Meldungstexte (`StringLiteral`: Fix- und Fehlerzeilen, die kein Test wörtlich bindet), 8 Options- und Rückgabeobjekte (`ObjectLiteral`: der Wegfall ändert den Exit-Code nicht oder wird nicht beobachtet), 19 betrafen Code (davon zehn echte Lücken in meinen Tests: Sortierung, Grenzwert der Kürzung, Anker einer Regex, Null-Werte im Bericht, Auslassen der Fehlerzeile; sie sind mit Tests geschlossen). **Mutator-Ausschluss für die Messung: `StringLiteral` und `ObjectLiteral`**, Begründung wie angegeben; alle anderen Mutatoren bleiben, auch `Regex`, `ConditionalExpression`, `EqualityOperator` und `OptionalChaining` (die Blocker der Sabotage-Klasse betreffen Bedingungen und Regex-Komponenten).

Die letzten 10 Überlebenden am eigenen Diff sind alle „äquivalent/irrelevant“ (nicht erreichbarer Zweig, `catch` mit gleichem Ergebnis, Einstiegs-Guard `istDirektaufruf`, Parameter, die kein Aufrufer leer lässt), davon eine Zeile (`scripts/gate-befehl-lib.mjs:77`), die das Werkzeug als überlebend meldet, während eine händische Sabotage derselben Teilbedingungen Tests rot macht (Werkzeug-Artefakt der Testzuordnung, zählt als irrelevant). Die 13 `NoCoverage` sind `main()` (Kindprozess).

## Messung und Urteil

(folgt)
