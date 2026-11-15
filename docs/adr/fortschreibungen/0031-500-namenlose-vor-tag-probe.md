# Fortschreibung #500 (2026-11-15): Namenlose Vor-Tag-Probe ohne Bezieher-Liste

Ergänzt [ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)). Überholt die Option A von [Fortschreibung #188](0031-188-vor-tag-probe.md) (Vor-Tag-Probe je Bezieher der Projekt-Config); [Fortschreibung #224](0031-224-synthetische-bezieher.md) und [Fortschreibung #234](0031-234-probe-erstbezug-ci.md) bleiben die Grundlage der namenlosen Prüfung. Herkunft: Sammelticket factory#490, Zeile L2 (aus factory#373). Punkt 1 des ADR bleibt (kein Fabrik-Lauf schreibt in ein Bezieher-Repo).

## Kontext

- **Namensliste:** der Schlüssel `bezieher` der Projekt-Config führte die Namen der Bezieher der Fabrik (`bezieherAus`), die Kern-Reinheit zählte sie als Begriff (`begriffeAus`), und das Tag-Ticket verlangte je Name einen Probe-Lauf, dessen Ergebnis ein Mensch mit `tag-takt --probe` eintrug.
- **Wirkung:** die Fabrik trug damit Namen, die sie nicht tragen soll (Leitfrage „Funktioniert das für jedes Projekt, ohne ein Projektwort zu tragen?“). Der Schutz ist schmal: er galt nur für Bezieher mit vertrautem Code und war ein Handschritt ohne Automat.
- **Ersatz vorhanden:** der Probe-Erstbezug (Fortschreibung #234) und der synthetische Bezieher je Profil (Fortschreibung #224) prüfen den Stand namenlos in der CI; ein Rot sperrt über die CI-Zeile den Tag.

## Optionen

- **A: Schlüssel und Probe je Bezieher streichen (gewählt).** Die Fabrik führt keine Namen ihrer Bezieher; vor dem Tag prüfen nur Probe-Erstbezug und synthetische Bezieher je Profil.
- **B: nur die Kern-Reinheit lösen** (`begriffeAus` liest den Schlüssel nicht mehr, die Liste bliebe für die Probe). Verworfen: die Namen blieben in der Config der Fabrik.
- **C: Cross-Repo-CI je Bezieher.** Verworfen wie in ADR 0031: es bräuchte ein Secret mit Zugriff auf fremde Repos.

## Entscheidung

Entscheidung: Option A, weil die Fabrik ohne Namen ihrer Bezieher auskommt und der echte Stand eines Beziehers sich ohnehin erst bei dessen Update zeigt (Gates des Beziehers, Meldung als Sammelticket-Zeile „Gate-Lücke“).

- **Config:** `.factory/projekt.json` hat keinen Schlüssel `bezieher` mehr; `pruefeProjektConfig` weist ihn über die Tabelle `ENTFALLENE_SCHLUESSEL` ab (auch leer), mit der Fix-Zeile „Schlüssel entfernen“. Ein Bezieher, der ihn führte, entfernt ihn (Zeile `Bezieher-Migration` des Besitz-PRs).
- **Tag-Ticket:** keine Probe-Zeilen je Bezieher; die Checkliste behält den Probe-Erstbezug und je Profil die Zeile „Synthetischer Bezieher“.
- **`tag-takt --probe`:** entfällt; ein Aufruf endet mit Exit 2 und dem Hinweis auf den Probe-Erstbezug (`scripts/probe-erstbezug.mjs`) und die CI-Zeile.
- **Kern-Reinheit:** `begriffeAus` liest kein `bezieher` mehr; das Gate jedes Beziehers deckt dessen Namen über das eigene `repo` ab.
- **Projekt-Rest:** der Begriff bleibt, meint aber nur das Rot im Bezieher nach einem Update, das nur Bezieher-Eigenes betrifft; die namenlose Probe kennt keinen.
- **Wächter:** `test/harness/entfernte-pfade.test.ts` scannt eine geschlossene Liste (`--probe`, `bezieherProbe`, `probeErgebnisse`, der Schlüssel `bezieher`) über alle getrackten Dateien; ADRs bleiben historisch.

## Konsequenzen

Kein Handschritt je Bezieher mehr, die Token-Kosten der Probe entfallen. Verlorener Schutz: ein Rot, das nur ein echter Bezieher mit seinem eigenen Stand erzeugt, zeigt sich erst bei dessen Update; ein gesetzter Tag wird nie verschoben, der Fix ist ein Patch-Tag. Breaking für Skript-Nutzer: die Exporte `bezieherAus`, `bezieherProbe`, `probeErgebnisse` und `probeEinstieg` entfallen.

## Re-Evaluierung

Prüftermin (ADR 0027): 2027-05-15. Prüfen, ob die Abweisung des Schlüssels und der `--probe`-Hinweis gehen können (kein Bezieher führt ihn mehr), und ob ein Bezieher-Rot gemeldet wurde, das ein Fall in `faelle` eines synthetischen Beziehers hätte sein müssen.
