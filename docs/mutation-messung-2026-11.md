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

Handklassifikation der 44 Überlebenden des ersten Laufs: 13 waren Meldungstexte (`StringLiteral`: Fix- und Fehlerzeilen, die kein Test wörtlich bindet), 4 Options- und Rückgabeobjekte (`ObjectLiteral`: der Wegfall ändert den Exit-Code nicht oder wird nicht beobachtet), 27 betrafen Code (davon zehn echte Lücken in meinen Tests: Sortierung, Grenzwert der Kürzung, Anker einer Regex, Null-Werte im Bericht, Auslassen der Fehlerzeile; sie sind mit Tests geschlossen). **Mutator-Ausschluss für die Messung: `StringLiteral` und `ObjectLiteral`**, Begründung wie angegeben; alle anderen Mutatoren bleiben, auch `Regex`, `ConditionalExpression`, `EqualityOperator` und `OptionalChaining` (die Blocker der Sabotage-Klasse betreffen Bedingungen und Regex-Komponenten).

Die letzten 10 Überlebenden am eigenen Diff sind alle „äquivalent/irrelevant“ (nicht erreichbarer Zweig, `catch` mit gleichem Ergebnis, Einstiegs-Guard `istDirektaufruf`, Parameter, die kein Aufrufer leer lässt), davon eine Zeile (`scripts/gate-befehl-lib.mjs:77`), die das Werkzeug als überlebend meldet, während eine händische Sabotage derselben Teilbedingungen Tests rot macht (Werkzeug-Artefakt der Testzuordnung, zählt als irrelevant). Die 13 `NoCoverage` sind `main()` (Kindprozess).

## Messung und Urteil

Die Entscheidungsregel stand im Commit `ef35aea`, der Mutator-Ausschluss samt Prüfaufträgen im Commit `3c1dd38` des Branches (beide vor dem ersten Mess-PR; nach dem Squash-Merge nur noch über den PR erreichbar). Messbeginn für die Auswahl: `--bis 2026-11-11T10:30:00Z`. Gemessen wurde auf einem Mac (Node 22, vitest 5.1.0, Werkzeug 10.1.1) mit warmem npm-Cache, je Lauf ein eigener Scratchpad-Worktree mit eigenem `npm ci` und anschließendem `npm i --no-save` der beiden Werkzeug-Pakete.

### PR-Auswahl

Top zehn nach Blockern der Test-Lens (Rohwerte `lauf-ergebnis`), Klassen nach der vorab festgelegten Regel (Zählung per Skript über den Squash-Diff, Heuristik für Regex-Literale: Literal am Ausdrucksanfang oder nach `= ( , : ! & | ? [`, plus `new RegExp`):

| PR | Blocker Test-Lens | Code-Dateien | hinzugefügte Code-Zeilen | R je Zeile | G je Zeile | Test startet Skript (K) |
|---|--:|--:|--:|--:|--:|---|
| factory#174 | 11 | 16 | 199 | 0,065 | 0,131 | ja |
| factory#108 | 10 | 4 | 335 | 0,024 | 0,173 | ja |
| factory#136 | 10 | 6 | 417 | 0,026 | 0,223 | ja |
| factory#214 | 9 | 35 | 538 | 0,022 | 0,190 | ja |
| factory#297 | 9 | 5 | 321 | 0,000 | 0,121 | ja |
| factory#304 | 9 | 2 | 452 | 0,004 | 0,179 | ja |
| factory#120 | 8 | 3 | 240 | 0,158 | 0,138 | nein |
| factory#229 | 8 | 4 | 455 | 0,042 | 0,301 | ja |
| factory#266 | 8 | 14 | 361 | 0,028 | 0,235 | ja |
| factory#6 | 7 | 5 | 132 | 0,015 | 0,144 | ja |

Vergabe: K an den PR mit den meisten Blockern, factory#174; R an die höchste Dichte der übrigen, factory#120; G an die höchste Dichte der dann übrigen, factory#229. Fast jeder PR startet Skripte aus Tests; die Klasse K trennt darum nicht, die Regel vergibt sie an den ersten.

**Stände.** (a) Eltern-Commit des ersten Fix-Commits mit der Zeile `Runde 1:`, (b) dieser Fix-Commit, (c) gemergter Squash-Stand (Diff `<c>^1...<c>`):

| PR | (a) | (b) | (c) |
|---|---|---|---|
| factory#174 | `f6c18763` | `f5c88e4b` | `6dd69760` |
| factory#120 | `34ca9724` | `75cc3310` | `00d995a7` |
| factory#229 | `12923c52` | `24a22103` | `26b3c9a5` |

Auffälligkeit bei factory#120: der Fix-Commit mit der Zeile `Runde 1:` ändert nur `docs/model-routing.md`; die Code- und Test-Fixes der Runde 1 stehen im davor liegenden `wip(harness): Runde-1-Fixes`-Commit, also schon im Stand (a). Dort unterscheiden sich (a) und (b) im Code nicht (identische Zählung). Ergänzend, außerhalb der Regel, wurde der Stand `3e76a140` (Eltern des `wip`-Commits) gemessen.

### Rohwerte

Laufzeit wall-clock je Lauf (nur der erfolgreiche Lauf, ohne `npm ci`); „aktiv“ = ohne die durch den Mutator-Ausschluss ignorierten Mutanten; „Fehler“ = `RuntimeError` (zählt als erkannt); „Kindprozess“ = Anteil `NoCoverage` an den Überlebenden (`Survived` plus `NoCoverage`), Untergrenze des Kindprozess-Anteils, weil ein nur per Spawn getesteter Code, der als `Survived` erscheint, hier nicht erkannt wird. Alle Läufe lagen weit unter 30 min, keiner wurde abgebrochen, der Bericht-Parser lehnte keinen Bericht ab, der Kern-Filter verwarf keinen Mutanten (Spalte „verworfen“ ist überall 0).

| PR | Stand | Code-Zeilen | Laufzeit | aktiv | getötet | überlebt | ohne Abdeckung | Timeout | Fehler | Kindprozess |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| factory#174 | a | 177 | 0:33 | 232 | 134 | 61 | 7 | 3 | 27 | 10 % |
| factory#174 | b | 199 | 0:34 | 286 | 203 | 46 | 6 | 3 | 28 | 12 % |
| factory#174 | c | 199 | 1:11 | 259 | 188 | 40 | 6 | 3 | 22 | 13 % |
| factory#120 | a | 236 | 0:20 | 354 | 272 | 65 | 15 | 2 | 0 | 19 % |
| factory#120 | b | 236 | 0:19 | 354 | 272 | 65 | 15 | 2 | 0 | 19 % |
| factory#120 | c | 240 | 0:22 | 364 | 285 | 71 | 6 | 2 | 0 | 8 % |
| factory#229 | a | 455 | 0:59 | 717 | 581 | 119 | 3 | 14 | 0 | 2 % |
| factory#229 | b | 455 | 1:07 | 717 | 625 | 77 | 1 | 14 | 0 | 1 % |
| factory#229 | c | 455 | 0:55 | 717 | 630 | 72 | 1 | 14 | 0 | 1 % |
| factory#120 (ergänzend) | `3e76a140` | 218 | 0:21 | 326 | 243 | 67 | 15 | 1 | 0 | 18 % |

**Messabweichungen (offen genannt).**

- Bei factory#174 scheitert der Probelauf, weil zwei Tests (`test/sammelticket-anlegen.test.ts` › „Verdrahtung der Selbstkorrektur“, `test/tag-takt-main.test.ts` › „gitEcht fängt stderr ab“) den Quelltext oder das Standard-Error eines Skripts prüfen, das das Werkzeug an Ort und Stelle instrumentiert; beide Tests wurden in allen drei Ständen im Scratchpad-Worktree mit `test.skip` ausgeschaltet. Das ist eine Eigenschaft des Werkzeugs im Modus `inPlace` und dieses Repos (viele Tests lesen Quelltext), kein Fehler des Messaufbaus; ein Projekt mit solchen Wächter-Tests braucht eine Test-Ausnahmeliste im Projektanteil.
- Die Laufzeiten gelten für warmen Cache, die Maschine mit mehreren Kernen und den Zeilenbereich des Diffs; Median über die neun Läufe der Regel: 34 s (sortiert 19, 20, 22, 33, 34, 55, 59, 67, 71 s).
- `npm ci` im frischen Worktree: ohne die beiden Pakete 0,64 s und 95 MB `node_modules`, mit ihnen 1,39 s und 171 MB (warmer Cache, ein Lauf je Variante; die Größe gilt auch für kalte CI-Läufe, die Zeit dort nicht). `npm audit --audit-level=high` bleibt grün; zwei Befunde der Stufe „moderate“ (`qs` über `typed-rest-client` des Werkzeugs) stehen im Bericht.

### Überdeckung der Blocker der Sabotage-Klasse (Bedingung 2)

Quelle der Funde: die Commit-Message des Fix-Commits (b) samt Selbstcheck und die neuen Tests (a)→(b), weil die PRs die einzelnen Lens-Funde nicht wörtlich tragen. Die Themen der Funde sind unten die Zeilen; „Überlebender in (a)“ heißt: auf der zugeordneten Code-Zeile trägt (a) einen Mutanten mit Status `Survived` oder `NoCoverage`. Nicht zuordenbare Themen stehen im Nenner.

| PR | Fund (Thema der Sabotage-Klasse) | Zeile in (a) | Überlebender in (a) |
|---|---|---|---|
| factory#174 | Fettdruck-Anker nur am Zeilenanfang | `check-docdrift.mjs:262` (Regex) | ja |
| factory#174 | Titel ohne Wörter lässt keinen Verweis durch | `:280` (`l > 0`) | ja |
| factory#174 | Herkunftsklammer, Link, ASCII-Strich im Titel | `:248`, `:250`, `:251` (Regex) | ja |
| factory#174 | Fenster ist genau zwei Wörter | `:280` (`Math.min`) | ja |
| factory#174 | Scan-Umfang (Unterordner, `.cjs`, `node_modules`) | `:288` | ja |
| factory#174 | `istZiel` / Ausnahme-Spannen | `:313` | ja |
| factory#174 | Kern-Sicht (Spannen aus Besitz-Text) | `:308`, `:313` | ja |
| factory#174 | Stoppzeichen beenden den Abschnittstext | Extraktionsregex | nein |
| factory#174 | Kette im Audit: jedes Segment | Ketten-Schleife | nein |
| factory#174 | CLI-Ziel | CLI-Ausgabe | nein |
| factory#120 | Lookahead je Schlüsselwort | `anker-liste.mjs:28`, `:29`, `:30`, `:42` (Regex) | ja |
| factory#120 | Arrow ohne Klammern | `:58` (Regex) | ja |
| factory#120 | gleichnamige Methoden zweier Klassen | `:59` (Regex) | ja |
| factory#120 | Regex-Literal am Zeilenanfang | `:55` (Regex) | ja |
| factory#120 | Division ist kein Regex | `:55` (Regex) | ja |
| factory#120 | nicht lesbare neue Datei fehlt statt zu werfen | `:154` bis `:156` (`catch`) | ja |
| factory#120 | Quell-Filter (Testdatei im Diff) | `istQuelle` | nein (im wip-Stand schon getötet) |
| factory#120 | `neueDateien`-Default | `git ls-files` | nein (im wip-Stand schon getötet) |
| factory#120 | `lauf` liest ungetrackte Nicht-Quelldateien nicht | nicht zuordenbar | nein |
| factory#229 | Spiegel `undefined` | `harness-doctor-dateien.mjs:253` | ja |
| factory#229 | `workflows` nicht übergeben | `:259` | ja |
| factory#229 | Leser-Guards (vier der acht Blocker; die Commit-Message nennt vier andere Themen einzeln) | `workflow-blockform.mjs:106`, `:107`, `:112`, `:134`, `:165`, `:171`, `:198`, `:278`, `:288`, `:305` | ja (4) |
| factory#229 | Orakel-Reihenfolge der `DATEI_PUNKTE` | `:276` | nein |
| factory#229 | Soll-Liste kein Array | `:256` | nein |

**Überdeckung gesamt: 19 von 27 Blockern (70 %)** (factory#174 7 von 10, factory#120 6 von 9, factory#229 6 von 8; die Ledger-Zahl der Blocker ist 9, 8 und 8, die Commit-Messages nennen bei factory#174 zehn und bei factory#120 neun Themen, dort ist der Nenner die Themenzahl). Bedingung 2 (mindestens 2/3) ist damit knapp erfüllt. Die Zuordnung ist Handarbeit und das Ergebnis zuordnungsabhängig. Mit dem Ergänzungsstand vor den `wip`-Fixes (`3e76a140`) statt (a) liegt die Überdeckung bei factory#120 bei mindestens 8 von 9 (gesamt 21 von 27, 78 %). Liest man „überdeckt“ strenger als „der Mutant überlebt in (a) und der Fix-Test tötet ihn“, ergibt die Regel bei factory#120 (a)=(b) null von 9 (gesamt 13 von 27, 48 %), mit dem Ergänzungsstand 4 von 9 (gesamt 17 von 27, 63 %); bei factory#174 und factory#229 ändert sich nichts. Dass die Tests der Runde 1 genau diese Mutanten töten, zeigt die Verschiebung von (a) nach (b): bei factory#229 sinken die Überlebenden von 119 auf 77 (31 Mutanten verschwinden, keiner kommt hinzu), bei factory#174 von 61 auf 46 (26 verschwinden, 11 kommen durch neuen Code hinzu).

### Äquivalente und irrelevante Überlebende (Bedingung 3)

Alle 196 Überlebenden der drei Stände (c) wurden von Hand gelesen (Zeile, Mutator, Ersatz) und klassifiziert; der Anhang nennt jede Zeile mit ihrer Klasse. Klassen für „äquivalent/irrelevant“:

- **E1 Kindprozess:** `NoCoverage`-Code, der nur über einen Spawn läuft (Einstiegs-Guard, `direktaufruf`, Ausgabe-Schleife des CLI).
- **E2 Grenzvergleich:** `<` gegen `<=` an `.length`, wo das Lesen hinter dem Ende `undefined` liefert und nichts ändert; `slice` an der Grenze.
- **E3 Heuristik-Regex:** Anker, Quantor oder Klasse, deren Wegfall nur bei unüblichem Text (Mehrfach-Leerzeichen, `export  const`) oder nach der folgenden Normalisierung nichts ändert; dazu die 34 Quantor- und Klassenmutanten der drei Kopf-Regexes von `anker-liste.mjs` (Heuristik zum Funktionskopf).
- **E4 sonstiges:** Default-Parameter, nie genutzt; Puffergröße; Cache; Meldungstext; Eintritts-Guard `istDirektaufruf`.

| PR | Überlebende (c) | E1 | E2 | E3 | E4 | echte Lücke |
|---|--:|--:|--:|--:|--:|--:|
| factory#174 | 46 | 6 | 5 | 6 | 3 | 26 |
| factory#120 | 77 | 6 | 1 | 38 | 6 | 26 |
| factory#229 | 73 | 0 | 8 | 1 | 4 | 60 |
| gesamt | 196 | 12 | 14 | 45 | 13 | 112 |

**84 von 196 (43 %) sind äquivalent oder irrelevant.** Erlaubt wären 20 %. Auch ohne die 34 Kopf-Regex-Mutanten (strengste Lesart von E3) bleibt es bei 50 von 196 (26 %). Ein weiterer Mutator-Ausschluss würde das Ergebnis nicht retten: die äquivalenten Überlebenden liegen in denselben Mutatoren (`Regex`, `ConditionalExpression`, `EqualityOperator`, `BlockStatement`, `ArrowFunction`, `ArrayDeclaration`, `MethodExpression`), die auch die echten Lücken tragen. Die Kalibrierung auf dem eigenen Diff zeigt dasselbe Muster: nach dem Ausschluss waren alle 10 verbleibenden Überlebenden äquivalent oder irrelevant.

### Anhang: Klassifikation je Überlebendem im Stand (c)

**factory#174, Stand (c), 46 Überlebende** (Klasse E1 bis E4 = äquivalent/irrelevant, R = echte Lücke): E1 6, E2 5, E3 6, E4 3, R 26.

```text
1 check-docdrift.mjs:437 BlockStatement E1
2 check-docdrift.mjs:438 BooleanLiteral E1
3 check-docdrift.mjs:439 ConditionalExpression E1
4 check-docdrift.mjs:439 ConditionalExpression E1
5 check-docdrift.mjs:439 EqualityOperator E1
6 check-docdrift.mjs:442 CallExpression E1
7 check-docdrift.mjs:232 BooleanLiteral R
8 check-docdrift.mjs:312 EqualityOperator R
9 check-docdrift.mjs:312 EqualityOperator R
10 check-docdrift.mjs:330 ConditionalExpression R
11 check-docdrift.mjs:223 ArrayDeclaration R
12 check-docdrift.mjs:250 Regex R
13 check-docdrift.mjs:250 Regex R
14 check-docdrift.mjs:252 Regex E3
15 check-docdrift.mjs:251 Regex E3
16 check-docdrift.mjs:253 Regex R
17 check-docdrift.mjs:253 Regex R
18 check-docdrift.mjs:253 Regex R
19 check-docdrift.mjs:260 Regex E3
20 check-docdrift.mjs:260 Regex E3
21 check-docdrift.mjs:260 Regex R
22 check-docdrift.mjs:261 Regex R
23 check-docdrift.mjs:261 Regex R
24 check-docdrift.mjs:261 Regex R
25 check-docdrift.mjs:261 Regex R
26 check-docdrift.mjs:265 Regex R
27 check-docdrift.mjs:265 Regex E3
28 check-docdrift.mjs:265 Regex R
29 check-docdrift.mjs:265 Regex R
30 check-docdrift.mjs:265 Regex E3
31 check-docdrift.mjs:265 Regex R
32 check-docdrift.mjs:278 LogicalOperator E2
33 check-docdrift.mjs:278 ConditionalExpression E2
34 check-docdrift.mjs:278 ConditionalExpression E2
35 check-docdrift.mjs:278 EqualityOperator E2
36 check-docdrift.mjs:278 EqualityOperator E2
37 check-docdrift.mjs:288 Regex R
38 check-docdrift.mjs:298 ConditionalExpression E4
39 check-docdrift.mjs:303 BooleanLiteral R
40 check-docdrift.mjs:303 BooleanLiteral R
41 check-docdrift.mjs:305 Regex R
42 check-docdrift.mjs:305 Regex R
43 check-docdrift.mjs:307 ArrayDeclaration E4
44 audit-einordnung.mjs:131 MethodExpression E4
45 langfuse-takt.mjs:122 Regex R
46 langfuse-takt.mjs:122 Regex R
```

**factory#120, Stand (c), 77 Überlebende** (Klasse E1 bis E4 = äquivalent/irrelevant, R = echte Lücke): E1 6, E2 1, E3 38, E4 6, R 26.

```text
1 anker-liste.mjs:169 BlockStatement E1
2 anker-liste.mjs:170 MethodExpression E1
3 anker-liste.mjs:171 ArrowFunction E1
4 anker-liste.mjs:171 OptionalChaining E1
5 anker-liste.mjs:172 ArrowFunction E1
6 anker-liste.mjs:174 ArrowFunction E1
7 anker-liste.mjs:70 EqualityOperator R
8 anker-liste.mjs:70 ConditionalExpression R
9 anker-liste.mjs:70 EqualityOperator R
10 anker-liste.mjs:70 EqualityOperator R
11 anker-liste.mjs:73 AssignmentOperator R
12 anker-liste.mjs:72 EqualityOperator E2
13 anker-liste.mjs:76 MethodExpression R
14 anker-liste.mjs:74 ArithmeticOperator R
15 anker-liste.mjs:81 Regex E3
16 anker-liste.mjs:97 MethodExpression R
17 anker-liste.mjs:112 ArrayDeclaration E4
18 anker-liste.mjs:157 ArithmeticOperator E4
19 anker-liste.mjs:157 ArithmeticOperator E4
20 anker-liste.mjs:161 BlockStatement E4
21 anker-liste.mjs:28 Regex R
22 anker-liste.mjs:29 Regex R
23 anker-liste.mjs:30 Regex R
24 anker-liste.mjs:42 Regex R
25 anker-liste.mjs:55 Regex R
26 anker-liste.mjs:55 Regex R
27 anker-liste.mjs:55 Regex R
28 anker-liste.mjs:55 Regex R
29 anker-liste.mjs:55 Regex R
30 anker-liste.mjs:55 Regex R
31 anker-liste.mjs:57 Regex E3
32 anker-liste.mjs:57 Regex E3
33 anker-liste.mjs:57 Regex E3
34 anker-liste.mjs:57 Regex E3
35 anker-liste.mjs:57 Regex E3
36 anker-liste.mjs:57 Regex E3
37 anker-liste.mjs:57 Regex E3
38 anker-liste.mjs:57 Regex E3
39 anker-liste.mjs:57 Regex E3
40 anker-liste.mjs:57 Regex E3
41 anker-liste.mjs:57 Regex E3
42 anker-liste.mjs:58 Regex E3
43 anker-liste.mjs:57 Regex E3
44 anker-liste.mjs:58 Regex E3
45 anker-liste.mjs:58 Regex E3
46 anker-liste.mjs:58 Regex E3
47 anker-liste.mjs:58 Regex E3
48 anker-liste.mjs:58 Regex E3
49 anker-liste.mjs:58 Regex E3
50 anker-liste.mjs:58 Regex E3
51 anker-liste.mjs:58 Regex E3
52 anker-liste.mjs:58 Regex E3
53 anker-liste.mjs:58 Regex E3
54 anker-liste.mjs:59 Regex E3
55 anker-liste.mjs:59 Regex E3
56 anker-liste.mjs:59 Regex E3
57 anker-liste.mjs:59 Regex E3
58 anker-liste.mjs:59 Regex E3
59 anker-liste.mjs:59 Regex E3
60 anker-liste.mjs:59 Regex E3
61 anker-liste.mjs:59 Regex E3
62 anker-liste.mjs:59 Regex E3
63 anker-liste.mjs:59 Regex E3
64 anker-liste.mjs:59 Regex E3
65 anker-liste.mjs:169 ConditionalExpression E4
66 anker-liste.mjs:169 ConditionalExpression E4
67 check-basis.mjs:64 BooleanLiteral R
68 check-basis.mjs:47 Regex E3
69 check-basis.mjs:72 MethodExpression R
70 check-basis.mjs:73 Regex R
71 check-basis.mjs:78 Regex E3
72 check-basis.mjs:76 MethodExpression R
73 check-basis.mjs:78 Regex R
74 check-basis.mjs:79 ConditionalExpression R
75 check-basis.mjs:82 LogicalOperator R
76 check-basis.mjs:82 ConditionalExpression R
77 check-basis.mjs:98 Regex E3
```

**factory#229, Stand (c), 73 Überlebende** (Klasse E1 bis E4 = äquivalent/irrelevant, R = echte Lücke): E1 0, E2 8, E3 1, E4 4, R 60.

```text
1 workflow-blockform.mjs:168 UpdateOperator R
2 workflow-blockform.mjs:61 ConditionalExpression E4
3 workflow-blockform.mjs:62 ConditionalExpression E4
4 workflow-blockform.mjs:62 Regex R
5 workflow-blockform.mjs:62 EqualityOperator R
6 workflow-blockform.mjs:33 Regex E3
7 workflow-blockform.mjs:47 ConditionalExpression R
8 workflow-blockform.mjs:47 Regex R
9 workflow-blockform.mjs:85 ConditionalExpression R
10 workflow-blockform.mjs:47 Regex R
11 workflow-blockform.mjs:101 EqualityOperator R
12 workflow-blockform.mjs:101 ConditionalExpression R
13 workflow-blockform.mjs:106 EqualityOperator R
14 workflow-blockform.mjs:119 MethodExpression R
15 workflow-blockform.mjs:120 Regex R
16 workflow-blockform.mjs:130 ConditionalExpression R
17 workflow-blockform.mjs:130 EqualityOperator E2
18 workflow-blockform.mjs:153 Regex R
19 workflow-blockform.mjs:164 Regex R
20 workflow-blockform.mjs:164 Regex R
21 workflow-blockform.mjs:164 Regex R
22 workflow-blockform.mjs:134 ConditionalExpression E2
23 workflow-blockform.mjs:164 Regex R
24 workflow-blockform.mjs:168 ConditionalExpression R
25 workflow-blockform.mjs:168 EqualityOperator E2
26 workflow-blockform.mjs:166 LogicalOperator R
27 workflow-blockform.mjs:168 ConditionalExpression R
28 workflow-blockform.mjs:134 EqualityOperator E2
29 workflow-blockform.mjs:168 EqualityOperator R
30 workflow-blockform.mjs:168 Regex R
31 workflow-blockform.mjs:169 ConditionalExpression R
32 workflow-blockform.mjs:169 EqualityOperator E2
33 workflow-blockform.mjs:172 EqualityOperator R
34 workflow-blockform.mjs:175 ConditionalExpression E2
35 workflow-blockform.mjs:175 EqualityOperator E2
36 workflow-blockform.mjs:179 ConditionalExpression R
37 workflow-blockform.mjs:202 Regex R
38 workflow-blockform.mjs:186 Regex R
39 workflow-blockform.mjs:210 ConditionalExpression R
40 workflow-blockform.mjs:221 Regex R
41 workflow-blockform.mjs:221 Regex R
42 workflow-blockform.mjs:221 Regex R
43 workflow-blockform.mjs:221 Regex R
44 workflow-blockform.mjs:222 ConditionalExpression R
45 workflow-blockform.mjs:212 Regex R
46 workflow-blockform.mjs:213 ConditionalExpression R
47 workflow-blockform.mjs:212 Regex R
48 workflow-blockform.mjs:226 MethodExpression R
49 workflow-blockform.mjs:242 EqualityOperator E2
50 workflow-blockform.mjs:271 ConditionalExpression R
51 workflow-blockform.mjs:283 BooleanLiteral R
52 workflow-blockform.mjs:263 ConditionalExpression R
53 workflow-blockform.mjs:285 MethodExpression R
54 workflow-blockform.mjs:288 ConditionalExpression R
55 workflow-blockform.mjs:292 ConditionalExpression R
56 workflow-blockform.mjs:301 ConditionalExpression R
57 workflow-blockform.mjs:271 ConditionalExpression R
58 workflow-blockform.mjs:305 ConditionalExpression R
59 workflow-blockform.mjs:306 ConditionalExpression R
60 workflow-blockform.mjs:342 Regex R
61 workflow-blockform.mjs:342 Regex R
62 workflow-blockform.mjs:342 Regex R
63 workflow-blockform.mjs:340 ConditionalExpression R
64 workflow-blockform.mjs:340 LogicalOperator R
65 workflow-blockform.mjs:341 ConditionalExpression R
66 workflow-blockform.mjs:362 ConditionalExpression R
67 workflow-blockform.mjs:341 UnaryOperator R
68 workflow-blockform.mjs:341 Regex R
69 workflow-blockform.mjs:359 BooleanLiteral R
70 workflow-blockform.mjs:91 Regex R
71 workflow-blockform.mjs:91 Regex R
72 harness-doctor-dateien.mjs:282 ArrayDeclaration E4
73 harness-doctor-dateien.mjs:282 ArrayDeclaration E4
```

### Bewertung

| Bedingung | Messwert | Grenze | erfüllt |
|---|---|---|---|
| (i) Median-Laufzeit je Diff | 34 s | 10 min | ja |
| (ii) Überdeckung der Blocker der Sabotage-Klasse | 19 von 27 (70 %) | mindestens 2/3 | ja, knapp und zuordnungsabhängig |
| (iii) äquivalent oder irrelevant unter den Überlebenden | 84 von 196 (43 %) | höchstens 20 % | nein |

Der Mutationslauf findet die Lücken der Test-Lens in Sekunden bis wenigen Minuten, aber auf drei echte Lücken kommen zwei äquivalente oder irrelevante Überlebende (112 zu 84): in den Heuristik-Regexes und Grenzvergleichen dieses Repos ist fast jeder zweite Überlebende ohne Wirkung, und jede Zeile müsste ein Mensch oder Agent erst lesen. Der Projektanteil bleibt als opt-in Gate-Befehl stehen (Bezieher werden nicht gezwungen), seine Entfernung ist als Zeile im Sammelticket eingetragen.

**Wiedervorlage:** wenn eine Heuristik-Regex-Klasse sich per Mutator-Ausschluss sauber abtrennen lässt (Werkzeug-Option für Regex-Quantoren, ohne die Anker zu verlieren) oder ein Bezieher mit weniger Heuristik-Code den Lauf einrichtet.

Urteil: nicht brauchbar (Bedingung 3: 84 von 196 Überlebenden, 43 %, sind äquivalent oder irrelevant, erlaubt sind 20 %)
