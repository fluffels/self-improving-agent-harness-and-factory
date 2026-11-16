# Folge-Ticket der Token-Analyse

Jeder Lauf legt genau ein Folge-Ticket „Analyse-Optimierung <Datum>“ an; das Skript `node scripts/token-analyse-tickets.mjs --review <datei>` erzeugt Titel und Body und legt es über `spezifikation.mjs anlegen` an (Spezifikations-Prüfung). Ein zweiter Aufruf im selben Lauf legt kein zweites an (Lauf-Protokoll in der Ablage, danach Suche nach dem Titel).

Feste Frage: was haben wir vergessen?

Prüfpunkte, je mit Beleg zu beantworten:

- Messgrößen-Liste des Änderungsregisters zeitgemäß (neue Modelle, Preise, Claude-Code-Funktionen, Empfehlungen)
- Toleranzen und Prüffristen sinnvoll
- Umstellungen ohne Registerzeile
- Messgrößen ohne Auswertbarkeit (Dauer-Lücke)
- fehlender Analysebereich
- eingebaute Claude-Code-Befehle

Quellen sind die Abschnitte `## Unsicherheiten` der Teilberichte und der Bericht der Webrecherche (Teil 5); der Hauptchat trägt sie im Plan unter `folge` ein (`unsicherheiten`, `recherche`), verallgemeinert und ohne Namen, Pfade und Inhalte. Ein Prüfpunkt ohne Beleg gilt als nicht geprüft, nie als „nichts vergessen“.
