# Fortschreibung #411 (2026-11-12): Füllstand nach offenen Befund-Zeilen

Ergänzt [ADR 0016](../0016-langfuse-takt-woechentlich.md) und löst die Zählweise „je Kommentar“ der [Fortschreibung quellprojekt#1888](0016-1888-haertungs-takt-nach-fuellstand.md) samt Nachtrag factory#215 ab. Schwelle, Auswahl und Takt-Mechanik bleiben.

## Kontext

- **Kommentare fassen Zeilen zusammen:** `melden.mjs` und der Doctor-Wochenlauf posten mehrere Befund-Zeilen in einem Kommentar (`meldungsText` in `scripts/meldung-lib.mjs`). Ein volles Sammelticket mit 12 Zeilen in vier Kommentaren erreichte die Schwelle 10 nie; der Takt löste nicht aus, obwohl Arbeit für einen Lauf bereitlag.
- **Zeilen sind die Arbeitseinheit:** ein Lauf nimmt höchstens den Deckel laut AGENTS.md an Zeilen; der Füllstand soll messen, wie viele Zeilen offen sind.

## Entscheidung

Entscheidung: der Füllstand zählt die offenen Checkbox-Zeilen (`- [ ]`, `BEFUND_ZEILE_OFFEN`) in Kommentaren vertrauter Nicht-Bot-Autoren, weil die Zeile die Einheit der Arbeit ist und die Kommentargröße vom Poster abhängt.

- **Zählweise:** `befundKommentare` summiert `offeneBefundZeilen` über die Kommentare vertrauter Nicht-Bot-Autoren; ein Kommentar mit 3 offenen Zeilen zählt 3. Abgehakte Zeilen (`- [x]`), Fließtext ohne Checkbox sowie Kommentare fremder, Bot- und anonymer Autoren zählen nicht. Die Namen `befundKommentare`, `HARNESS_TAKT_KOMMENTARE` und `LANGFUSE_TAKT_KOMMENTARE` bleiben (exportierte Kern-Namen, historische Fortschreibungen verweisen auf sie); nur die Bedeutung ändert sich.
- **Schwelle:** ab 10 offenen Befund-Zeilen greift der Härtungs-Takt, wie bisher (Ratchet: sie sinkt nie, ein Anheben nur per reviewtem Commit mit Begründung). Sie passt zum Deckel von 12 Zeilen je Lauf.
- **Meldungen:** die Auswahl überspringt mit „füllt sich (k/10 offene Befund-Zeilen)“, der Takt nennt im Log „Füllstand k/10 offene Befund-Zeilen“. Dieselbe Zählung gilt für das Codequalität-Sammelticket (Auswahl) und den Langfuse-Takt (Schwelle 1: eine offene Zeile).
- **Unverändert:** die Poster (`melden.mjs`, Doctor) und `zaehleBefundZeilen` in `scripts/sammelticket-anlegen.mjs`.
- **Fail-closed:** unverändert, ein Ladefehler bewegt nichts.

## Verworfen

- **Kommentare weiter zählen und die Poster einzeln posten lassen:** ändert die Poster und macht viele Kommentare je Lauf; die Zählung der Zeilen ist die kleinere, ortsnahe Änderung.
- **Schwelle senken:** widerspricht dem Ratchet; die Zählung selbst war falsch, nicht die Zahl.
- **Umbenennen (`befundZeilen`, `HARNESS_TAKT_ZEILEN`):** kostet Änderungen in mehreren Dateien und historischen Verweisen ohne Verhaltensgewinn.

## Folgen

- Ein Sammelticket füllt sich früher; nach dem Merge kann das offene Sammelticket beim nächsten Push-Takt sofort an die Spitze springen. Das ist gewollt.
- Dubletten zählen doppelt; sie zu vermeiden bleibt Textregel der Erzeuger.
- Der Langfuse-Takt zählt einen Kommentar nur mit `- [x]` nicht mehr: abgehakt ist keine offene Arbeit.
- Die Doku-Bindung in `test/board-takt.test.ts` liest die Literale „ab 10 offenen Befund-Zeilen“ und „füllt sich (k/10 offene Befund-Zeilen)“ aus dieser Datei; der Wächter `test/harness/entfernte-pfade.test.ts` hält die alte Wendung aus Doku und Code.
