# Plan-Review der Token-Analyse (Teil 7)

Nach der Zusammenfassung schreibt der Hauptchat einen Plan. Angelegt wird erst nach dem Review, nie vorher. Ablauf: Analyse, Plan (noch nichts angelegt), Review, Anlegen, Umsetzung.

## Plan-Vorlage

Der Plan hat diese Pflichtteile; fehlt einer, ist er unvollständig, und der Review startet nicht:

- `## Rückbau-Kandidaten`: je Kandidat die Regel oder das Gate, der Beleg (Kennzahl aus der Belegtabelle, Fundstelle) und das Qualitätsrisiko.
- `## Umstellungen`: Wechsel von Modell, Effort, Takt oder Schwelle, je mit Beleg.
- `## Entscheidung Status-Ticket`: behalten, ändern oder abschaffen, mit Beleg.
- `## Neue Registerzeilen`: je Umstellung die Zeile des Änderungsregisters (`docs/model-routing.md` › Änderungsregister).
- `## Ticketentwürfe`: je Entwurf Titel, Body mit Zielen und Akzeptanzkriterien samt Negativfall, Reihenfolge (`nach`, `weil`) und Abhängigkeiten (`blocker`); ein Ticket nur mit Ausnahme (`session-groesse`, `notfall`, `ausserhalb-harness`), sonst eine Zeile über `node scripts/melden.mjs`.
- `## Vorab-Bewertung je Probe-Ticket`: Nutzen, Kosten und Abbruchkriterium, bevor ein Probe-Ticket entsteht; ein Probe-Ticket ohne diese Bewertung weist das Skript ab.
- `## Bezieher-Analysen` als Tabelle `| Analyse | wo | warum | Bezieher-Schalter |`; der Schalter nennt Name, Ort in der Bezieher-Config und Standard „an“. Steht er auf „aus“, ist das eine Lücke, nicht „eingehalten“.

Zahlen im Plan stehen nur verallgemeinert (Kennzahlen ohne Namen, Pfade und Inhalte), denn Tickets und Zeilen sind öffentlich.

## Auftrag an den Reviewer

Ein frischer, unabhängiger Reviewer ohne Vorgeschichte prüft jeden Planteil, nie der Hauptchat, der den Plan schrieb. Spawn: ein frischer Agent (nie `fork`), subagent_type "Explore", Modell und Effort laut Tabelle „Token-Analyse: Plan-Review“ in `docs/model-routing.md` §1, je nach Tragweite des Teils. Er bekommt nur den Planteil, die Belegtabelle und die Fundstellen, nie rohe Transkripte; Web und Schreiben sind ihm verboten. Der Auftrag lautet:

- jede Empfehlung zu widerlegen versuchen;
- die Messung auf Gültigkeit prüfen: Fenster, Überlappung, Lücken, Preisbasis;
- das Qualitätsrisiko je Rückbau benennen;
- die Ticketentwürfe auf Vollständigkeit, Schnitt und Negativfälle prüfen;
- suchen, was fehlt.

Ergebnis je Planteil: `bestätigt`, `bedingt` (der Plan wird nachgezogen, der Teil erneut geprüft) oder `abgelehnt` (mit Grund). Ein Durchgang je Teil, ein zweiter nur nach `bedingt`; ein dritter ist ein Formfehler. Jeder Spawn zählt ins Lauf-Budget (`BUDGET_USD` im Skill), die Budgetprüfung vor jedem Spawn gilt auch hier.

## Review-Datei

Der Hauptchat schreibt die Urteile in eine JSON-Datei im Scratchpad, den Plan daneben (Formate: Kopf von `scripts/token-analyse-tickets-lib.mjs`; die Kennung des Reviewers ist die agentId seines Spawns, die des Plans die Session-ID des Hauptchats):

`{ version:1, lauf, plan:"<Pfad>", status:"abgeschlossen"|"abgebrochen", urteile:[{ teil, durchgang, reviewer:{ kennung, modell, effort }, urteil, grund }] }`

Dann `node scripts/token-analyse-tickets.mjs --review <datei>` (`--dry-run` zeigt nur die Aufrufe). Das Skript legt nur bestätigte Teile an und gibt jeden Fehlschlag fail-closed zurück: fehlt der Review oder bricht er ab, entsteht nichts. Ein Reviewer mit derselben Kennung wie ein Autor des Plans oder eines Teilberichts, oder mit Modell oder Effort außerhalb der Tabelle, ergibt `ungeprüft`. Abgelehntes steht mit Grund im Schnappschuss.
