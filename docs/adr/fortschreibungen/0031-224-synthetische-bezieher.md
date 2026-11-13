# Fortschreibung #224 (2026-11-13): Synthetische Bezieher für Profile ohne Stellvertreter

Ergänzt [ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)). Setzt [Fortschreibung #234](0031-234-probe-erstbezug-ci.md) und die Vor-Tag-Probe ([Fortschreibung #188](0031-188-vor-tag-probe.md)) für die Profile Java und Python fort; Punkt 1 des ADR bleibt (kein Fabrik-Lauf schreibt in ein Bezieher-Repo).

## Kontext

Die Vor-Tag-Probe prüft nur JS/TS-Bezieher (Probe-Erstbezug und gelistete eigene Bezieher). Ein Rot durch Factory-Besitz in einem Profil ohne Stellvertreter zeigte sich erst beim ersten echten Bezieher nach dem Tag, und ein gesetzter Tag wird nie verschoben (factory#215).

## Optionen

- **A: Profil-Fixture im Probe-Erstbezug, als CI-Matrix** (gewählt): `node scripts/probe-erstbezug.mjs --profil <name>` legt über das JS/TS-Fixture die Datei `test/fixtures/probe-profil/<name>.json`; ein CI-Job je Profil, die Checkliste des Tag-Tickets führt je Profil eine Zeile.
- **B: Handschritt mit `--probe`:** der Mensch trägt das Ergebnis ein. Verworfen: `ciZustand` liest nur `ci.yml`, ein Rot sperrt den Tag dort schon heute; ein Handschritt wird vergessen.
- **C: Matrix-Umbau des Jobs `Probe-Erstbezug`:** verworfen, der Name des Required Checks würde sich ändern (Ruleset, Pre-Flight).
- **D: echtes Maven und pytest im Job:** verworfen (Laufzeit, Werkzeug-Installation, kein Gewinn für Factory-Besitz-Rot, das in den Node-Gates entsteht).

## Entscheidung

Entscheidung: Option A, weil sie ohne Ruleset-Änderung und ohne Secret auskommt und die Profil-Liste aus den Dateien in `test/fixtures/probe-profil/` ableitet (`profilNamen` in `scripts/release-tag-lib.mjs`, einzige Quelle für Probe und Takt; ein Wächter koppelt die Matrix in `ci.yml` daran).

- **Profil-Datei:** `{ profil, titel, config, skripte, verifyZusatz, dateien, faelle }`; `pruefeProfil` lehnt Pfad-Traversal, geschützte Dateien (`AGENTS.md`, Projekt-Config, `package.json`), unbekannte `verifyZusatz` und ungültige `faelle` mit Exit 2 ab, bevor etwas geschrieben wird.
- **Stellvertreter:** Maven und pytest laufen nicht; die Skripte `test:java` bzw. `test:py` führen einen Node-Stellvertreter (Exit 0) und hängen an `verify`. Ein Rot durch Factory-Besitz entsteht in den Kern-Gates, die die Profil-Gestalt lesen (`check:docmap`, `check:size`, `check:docdrift`, Kontext-Budget); `test/probe-profil.test.ts` belegt in einem echten Klon, dass die Java- und Python-Quellen gemessen werden.
- **Tag-Takt:** je Profil eine Checklistenzeile mit Job und Handaufruf; die BLOCKER-Zeile der CI nennt die synthetischen Bezieher; ohne Profil-Dateien bleibt die Checkliste zeichengleich.
- **Gate-Lücke-Zeilen (factory#215):** jede erweitert den synthetischen Bezieher ihres Profils (ein Eintrag in `faelle` mit `quelle` der Form `factory#<nr> L<k>` und den betroffenen `dateien`) oder wird ein begründetes `nichtAbbildbar` dort. Ein JS/TS-Fall wird ein Test in „Negativfälle der Kette“ (`test/probe-erstbezug.test.ts`).
- **Kein Required Check:** ein PR, der ein Profil bricht, kann mergen; danach sperrt das Rot den Tag und alarmiert auf `main` (`alarm-red-main` hängt am Job).

## Konsequenzen

Zwei parallele CI-Jobs à rund 10 bis 40 s ohne Agentenlauf und ohne Secret; Rot im Profil-Job ist immer ein Blocker (kein Projekt-Rest).

**Bekannte Grenze:** Maven, pytest, ArchUnit und der echte Werkzeug-Aufruf werden nicht ausgeführt, nur die Gestalt (Quellwurzel, Endung, Docmap, Coverage-Bericht, Skripte) wird gelesen; der synthetische Bezieher ersetzt keinen echten Bezieher (keine Projekt-Blöcke, kein Projekt-Eigenes).

## Re-Evaluierung

Prüftermin (ADR 0027): 2027-05-13 oder der erste echte Java- bzw. Python-Bezieher, je nachdem, was früher kommt. Dann prüfen, ob die Fälle `faelle` einen Fund aus einem echten Bezieher abdecken oder ob der Stellvertreter durch einen echten Werkzeug-Aufruf ersetzt werden muss.
