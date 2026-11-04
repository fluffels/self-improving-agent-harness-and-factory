# Fortschreibung #162 (2026-11-04): Harness-Sammelticket an die Spitze, ohne Klemmung und Selbstkorrektur

Ergänzt [ADR 0016](../0016-langfuse-takt-woechentlich.md) und löst zwei Teile der [Fortschreibung #1888](0016-1888-haertungs-takt-nach-fuellstand.md) sowie der Fortschreibung quellprojekt#1390 ab: „hinter den Kopf“ und die Selbstkorrektur auf die Position laut AGENTS.md.

## Kontext

- **Gegenläufige Mechaniken:** ein volles Sammelticket sollte das nächste Ticket sein, stand nach dem Takt aber „hinter dem Kopf“, also hinter Status-, Dependabot- und Forum-Ticket; `board-place` klemmte jedes neue Ticket hinter das Sammelticket und schob es bei jedem Einsortieren auf die Position laut AGENTS.md zurück. Das Sammelticket wanderte so je nach Lauf vor und zurück, und die Klemmung machte `--top` für alles außer Notfällen unvorhersehbar.
- **Messgröße ist der Füllstand:** wann ein Sammelticket drankommt, entscheidet der Härtungs-Takt allein; Position und Klemmung dazu sind Rauschen.

## Entscheidung

Entscheidung: ab `HARNESS_TAKT_KOMMENTARE` Befund-Kommentaren steht das ungeclaimte Harness-Sammelticket an der Spitze des Factory-Boards, nur hinter den 🚨-/🔒-Notfällen und vor dem Status-Ticket, weil ein volles Sammelticket wie ein Notfall das nächste Ticket sein soll und nur echte Notfälle davor gehören.

- **Takt:** eine Regel statt zwei. `entscheideHarnessTakt` kennt nur `nach-oben` und `nichts`; `spitzenEnde` (`scripts/board-lib.mjs`, Arten `rot-main` und `security`) bestimmt den Anker: das letzte 🚨/🔒-Item im Kopf, sonst die Spitze. Idempotent: steht es dort, bewegt sich nichts. Unter der Schwelle bewegt der Takt nichts, auch nicht zurück; ist ein Vorgänger in Arbeit, wartet er.
- **Status-Ticket:** der Status-Schritt des Takts bewegt nur, wenn er ein Ticket anlegt oder eines an die Spitze holt (`ziehListeNach` mit `itemId`); ein zweiter Lauf am selben Montag bewegt nichts. Legt ein Lauf ein Status-Ticket an, steht es kurz oben, der Harness-Schritt desselben Laufs setzt das volle Sammelticket davor.
- **Entfallen:** die Klemmung in `board-place` (`klemmeAnker`, `sammelblock`) und die Selbstkorrektur (`planMitKorrektur`, `positionOderWarnung`, die Regel `auf-position`, `position` in `entscheideHarnessTakt`). `--top`, `--after` und `--position` setzen den Anker wörtlich.
- **Codequalität-Sammelticket (factory#156):** seine Anlageposition „hinter dem Kopf und dem Sammelblock“ wird zu „hinter dem Kopf, ohne Klemmung hinter andere Sammeltickets“; das Füllstand-Gate hält es unverändert zurück.
- **Unverändert:** die Anlage auf der Position laut AGENTS.md (`sammelticket-anlegen`, `sammelticketKorrektur`); `langfuse --top` setzt das Langfuse-Sammelticket jetzt wörtlich an die Spitze.

## Verworfen

- **Hinter den Kopf lassen:** ein volles Sammelticket stünde hinter dem Status-Ticket und seinen Verwandten, obwohl es wie ein Notfall wirken soll.
- **Vor alle Kopf-Items, auch Notfälle:** ein roter `main` oder ein Security-Fund gehen vor.

## Folgen

- Neue `--top`-Tickets können vor einem leeren Sammelticket stehen; das ist gewollt, ein leeres Sammelticket nimmt die Auswahl ohnehin nicht (`füllt sich`).
- Ein Sammelticket, das nach einem gescheiterten Anlegen am Board-Ende steht, bleibt dort, bis der Füllstand es nach vorn holt; die Anlage meldet das beim Prüfen.
- **Re-Evaluierung:** wenn ein Sammelticket trotz vollem Füllstand nicht an die Spitze kommt (Takt-Log), diese Entscheidung gegen den Fehlerpfad prüfen.
