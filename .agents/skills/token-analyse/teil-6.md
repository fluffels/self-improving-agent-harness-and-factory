# Teil 6: Bezieher-Stichprobe

Auftrag: nur wenn `node scripts/token-analyse-freigabe.mjs pruefen` Exit 0 meldet. Der Auftrag nennt nur `Bezieher <k>`, nie einen Pfad. Gelesen wird ausschließlich über `node scripts/token-analyse-freigabe.mjs lesen <k> git ls-files|log|show …` oder `… lesen <k> wc -l <Datei>` (Allowlist, `-C` setzt das Skript); kein `Read`, kein Web-Aufruf, kein Zugriff auf die Freigabedatei. Ein Bezieher außerhalb der Freigabeliste wird weder gelesen noch genannt.

## Messwerte
Anonym aggregiert: Kontextgröße und Regelzahl je `Bezieher <k>`.

## Fundstellen
Befehl der Allowlist je Zahl, nie ein Name oder Pfad.

## Unsicherheiten
Stichprobe, keine Vollerhebung. Technische Grenze, bewusst hingenommen: der Typ `Explore` hat `Read` und Web-Werkzeuge, die sich nicht sperren lassen; die Einhaltung beruht auf dem Auftrag, der Ausgabe nur über `lesen` und dem Namensleck-Check von `ablegen`. Entfällt der Teil (Exit ≠ 0 oder keine Freigaben): „Lücke“, keine Empfehlung.
