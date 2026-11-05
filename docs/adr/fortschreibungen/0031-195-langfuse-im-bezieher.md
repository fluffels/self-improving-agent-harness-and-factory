# Fortschreibung #195 (2026-11-04): Langfuse-Takt im Bezieher

Setzt Punkt 4 von [ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md) um (Status-Ticket und Langfuse-Befunde auf dem Board des Beziehers). Herkunft: Befundzeile L29 aus factory#162.

## Kontext

- **Takt:** führt das Factory-Board der Config ein fremdes Repo (im Bezieher der Normalfall), lief der Board-Takt dort nur als Wächter (`nurWaechter`); das Status-Ticket „Langfuse-Status überprüfen“ entstand nie im Bezieher.
- **Sammelticket:** `sammelticket-anlegen langfuse` legte das Ticket im Repo des Factory-Boards an, also in der Fabrik, in die ein Bezieher nicht schreibt.

## Entscheidung

Entscheidung: im Bezieher (`.factory/sync-stand.json` vorhanden) liegen Status-Ticket und Sammelticket „Langfuse-Befunde (gesammelt)“ im eigenen Repo; Board und Label gibt `langfuseZiel` vor (`scripts/projekt-config-lib.mjs`), weil die Trennregel bleibt, kein neuer Config-Schlüssel nötig ist und keine Migration anfällt.

- **Board und Label:** führt das Factory-Board das eigene Repo, gilt die Rolle `factory` mit Harness-Label (voller Takt wie bisher). Sonst das Produkt-Board ohne Label. Führt kein Board das eigene Repo, wirft `langfuseZiel` mit einer Fix-Zeile (der Takt fällt dann auf den Wächter zurück). Upstream (ohne Sync-Stand) behält den bisherigen Wert.
- **Vorgänger ohne Label:** die Liste der geschlossenen Issues filtert nach dem Harness-Label und fehlt im Bezieher. Der Takt fragt darum einmal per GraphQL-Titelsuche (`statusSucheAnfrage`) und gleicht sie mit der REST-Liste der offenen Issues ab. Widersprechen sie sich (die Suche kennt ein offenes Ticket, die Liste nicht) oder scheitert die Suche, bleibt das Status-Ticket aus (fail-closed, Warnung); der Board-Wächter läuft trotzdem.
- **Fenster:** im Bezieher zählen nur die Commits von `main` des eigenen Repos; Harness-Sammelticket und Produktquote pflegt der Takt der Fabrik.
- **Meldeweg für Harness-Befunde:** factory#153 (Meldeweg an die Fabrik) ist noch offen. Bis dahin gilt der bestehende Weg (Kommentar-Zeile im Harness-Sammelticket des Ziel-Repos der Fabrik), davor verpflichtend `node scripts/check-internalrefs.mjs --text` mit `&&` (Treffer: nichts senden). Der Weg steht im Body des Status-Tickets und in `docs/ticket-reihenfolge.md`; factory#153 tauscht später nur das Ziel, einen eigenen Sender baut dieses Ticket nicht.
  - **Nachtrag 2026-11-05 (factory#153, factory#208):** der Meldeweg steht: `node scripts/melden.mjs` sendet an die Meldestelle (Config-Schlüssel `meldestelle`, Standard das Repo des Factory-Boards) mit Factory-Stand und Sperrprüfung ([Erstbezug › Meldestelle](../../erstbezug.md#meldestelle)). Der Doctor-Wochenlauf und `spezifikation gescheitert` nutzen denselben Zugang; an einer fremden Meldestelle tragen Meldungen `owner/name#n`, der Doctor erkennt eigene Zeilen über `gh api user` und prüft in `--pruefen` den Punkt `Meldestelle`.

## Verworfen

- **Neuer Config-Schlüssel für das Langfuse-Ziel:** die Trennregel und `boards[].repo` reichen aus, ein Schlüssel brächte eine Migration für jeden Bezieher.
- **Label des Status-Tickets im Bezieher erzwingen:** das Harness-Label führt dort auf das Board der Fabrik (Trennregel); ein Label ohne Board-Bezug gäbe es nicht.

## Folgen

- Die Titelsuche kostet eine zusätzliche GraphQL-Abfrage je Takt im Bezieher; Upstream bleibt unverändert.
- Ein Bezieher, dessen Factory-Board das eigene Repo führt, fährt weiter den vollen Takt samt Harness-Sammelticket (nicht Teil dieser Entscheidung).
- **Re-Evaluierung:** wenn factory#153 den Meldeweg liefert, das Ziel im Body und in der Doku darauf umstellen.
