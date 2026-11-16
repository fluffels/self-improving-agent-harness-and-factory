# Fortschreibung #529 (2026-11-16): Größenstufe S ist in Risikostufe 0/1 aufgegangen

Ergänzt [ADR 0027](../0027-regeln-lockern.md) (Punkt 4, Rückfall-Trigger der Größenstufe S aus factory#271 und der Registerzeile `verfall-risikostufe-01-529`, früher Punkt 11a eines Sammeleintrags); die Ledger-Zeilen bleiben unverändert (Punkt 8). Teil 5/5 des Epics factory#511. Der Abschnitt steht als Datei, weil die Zahl angehängter `## Fortschreibung`-Abschnitte je ADR eingefroren ist ([README](../README.md#format)).

## Kontext

- Die Größenstufe `S` (factory#271) war neben der Risikostufe (factory#525 bis factory#528) eine zweite Größenklasse mit eigenen Nachweis-Formen: Planer-Skizze, `Plan: ohne — klein: …` und `Abnahme: entfaellt — klein: …`. Seit factory#526 und factory#527 deckt die Risikostufe 0/1 dieselben Fälle ab (Plan ohne Planer, Abnahme entfällt, Review mit Kombi-Lens), nur aus Pfaden berechnet statt aus einer zweiten Größenrechnung.
- Zwei Größenklassen mit je eigenen Zeilenformen kosteten Doppelpflege in Skripten, Skills, Agenten und Doku (Beleg: factory#529, Liste der Fundstellen im PR).

## Entscheidung

Entscheidung: die Größenstufe `S` ist keine eigene Stufe mehr, weil die Risikostufe 0/1 ihre Wirkung trägt und eine zweite Klasse nur Doppelpflege erzeugt.

- Die Grenze selbst bleibt als **Kombi-Lens-Grenze** (`KOMBI: ja|nein` aus `node scripts/risikostufe.mjs`; bei Risikostufe ≤ 1 und Code-Diff genügt `lenses=kombiniert`) und als **Trivial-Grenze** (Risikostufe 0, Regel 5B in `scripts/risikostufe-lib.mjs`). Rechenlogik und Konstante `GROESSENSTUFE_S` bleiben in `scripts/groessenstufe-lib.mjs` (Name unverändert, Umbenennen sprengte den Slice).
- `RISIKO:` und `SWEEP:` gibt `node scripts/risikostufe.mjs` aus (neu dazu `KOMBI:`); `scripts/groessenstufe.mjs` ist entfernt (Ersatz für Bezieher mit eigenen Aufrufen: `node scripts/risikostufe.mjs`).
- Die Skizzen- und Klein-Form der Plan- und der Abnahme-Zeile sind entfernt. `check-review-nachweis` und `check-abnahme-nachweis` erkennen die Altformen weiter und weisen sie bei jeder Stufe ab, mit einem Hinweis auf `Plan: ohne — stufe <0|1>` bzw. `Abnahme: entfaellt — stufe <0|1>`. `test/harness/entfernte-pfade.test.ts` hält die entfernten Namen aus verteilten Dateien fern.
- Die Registerzeile `verfall-risikostufe-01-529` prüft jetzt die Risikostufe 0/1 (Läufe mit `lenses=kombiniert` oder `— stufe`) statt der Größenstufe `S`.

## Konsequenzen

- Eine Eigenschaft weniger zum Pflegen; die Nachweis-Zeilen kennen nur noch die Stufen-Form.
- Die Messbasis der Größenstufe (2 von 40 Commits, 2026-11-11) bleibt als Schnappschuss in `docs/model-routing.md` erhalten.

## Re-Evaluierung

Prüftermin 2027-03-01 (Registerzeile `verfall-risikostufe-01-529`): Nachmessung wie in `docs/model-routing.md` (Kombi-Lens-Grenze); liefert die Kombi-Lens-Grenze keine Einsparung oder fand ein Folge-Fix einen Fehler, den der volle Satz gefunden hätte, wird die Grenze `GROESSENSTUFE_S` gesenkt oder die Kombi-Lens gestrichen (ADR 0027 Punkt 4).
