# Fortschreibung #154 (2026-11-06): Eine Engine, markierte Fabrik-Abweichungen

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (Kern-Schnitt: Ringe, Besitz-Manifest, Sync) und beantwortet die Zeile „Zwei Engines“ aus factory#139; die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

## Ausgangslage

Die Fabrik ist selbst ein Projekt des Harness: sie verteilt den Kern und nutzt ihn zugleich (Dogfooding). Manches gilt nur in der Fabrik (Sammelticket „Harness-Härtung“, Board-Rolle `factory`, Tag-Takt). Offen war, ob dafür eine zweite Engine nötig ist, wo die Grenze zwischen verteiltem Kern und Fabrik-Eigenem liegt und woran eine nicht erlaubte Abweichung rot wird. Die Abweichungen waren bis auf eine Form schon geprüft; die eine ungeprüfte Form war Verhalten im Kern-Code (eine Stelle in `scripts/projekt-config-lib.mjs`, die den Sync-Stand selbst per Dateiprobe las).

## Optionen

- **A, zwei Engines (eine Kopie des Kerns für die Fabrik):** verworfen. Doppelte Pflege, Drift zwischen den Kopien, und die Fabrik prüfte nicht mehr, was sie verteilt.
- **B, ein Verteil-Branch neben `main`:** verworfen. Tags leisten den zeitlichen Abstand schon (Sync nur vom Tag, [Fortschreibung quellprojekt#1871](0022-1871-sync-vom-tag.md)); ein zweiter Branch bräuchte ein Ruleset, und das ist Pre-Flight.
- **C, Fabrik-Blöcke in Kern-Dateien, die der Sync herausschneidet:** vorerst verworfen. Das wäre eine neue Sync- und Hash-Semantik; sie ist ein Auslöser der Re-Evaluierung.
- **D, eine Engine mit geschlossener Liste markierter Abweichungen (gewählt).**

## Entscheidungen

- **Eine Engine.** Es gibt keine zweite Kopie und keine Feature-Flags. Ein Experiment vor dem Verteilen ist immer Form 1 oder 2 der Tabelle.
- **Grenze.** Kern ist, was als Besitz-Einheit verteilt wird (`wirdVerteilt` in `scripts/besitz-lib.mjs`: Ringe `kern`, `kern-nach-entkopplung` und gewählte Module). Fabrik-intern ist der Ring `oberflaeche`, die Art `projekt` in `test/harness/kern-abdeckung.json`, jede Datei ohne Manifest-Eintrag, der Projekt-Block der AGENTS.md, `.factory/projekt.json` und die Factory-Seiten.
- **Erlaubte Abweichungen sind eine geschlossene Liste.** Jede Form hat eine Markierung und eine Prüfung; eine neue Form braucht eine Fortschreibung dieser Datei.

| Form | Markierung | Prüfung |
| --- | --- | --- |
| 1, Datei nur in der Fabrik | Ring `oberflaeche` oder `kern-abdeckung.json` | Kern-Abdeckung (mit Negativfall), Ring-Regel, Import-Hülle in `test/harness/kern-reinheit.test.ts` |
| 2, Verhalten im Kern-Code | Aufruf von `istBezieher(wurzel)` aus `scripts/sync-stand-lib.mjs` (Rollen-Schalter) | `test/harness/rollen-schalter.test.ts` (neu) |
| 3, Wert | Projekt-Config und Projektwert-Blöcke | Kern-Reinheit (Literale), Drift-Gate (Projektwert-Stellen) |
| 4, Regeltext nur für die Fabrik | Projekt-Block der AGENTS.md oder Factory-Seite | kein Wächter (bekannte Grenze), siehe factory#222 |
| 5, zeitlich: `main` vor dem Tag | Release-Tag | Tag-Takt und Vor-Tag-Probe; im Bezieher das Drift-Gate mit Herkunft vom Tag |

- **Rollen-Schalter.** `istBezieher(wurzel)` ist die Stelle für Rollen-Weichen im verteilten Code: Sync-Stand vorhanden heißt Bezieher, ein kaputter Inhalt zählt als Bezieher (fail-closed), eine nicht lesbare Datei wie eine fehlende. Daneben verzweigen Prüfer auf das Feld `zustand` von `liesSyncStand` bzw. `syncStandAusText` aus derselben Heimat (etwa `scripts/check-docdrift.mjs`, `scripts/check-factory-drift.mjs`, `scripts/factory-update-check.mjs`); sie gehen über den Format-Leser und sind erlaubt, jeder ordnet `kaputt` selbst fail-closed für seinen Zweck ein (das Doku-Drift-Gate prüft dann voll). Bei Rollen-Weichen gilt `istBezieher`. `test/harness/rollen-schalter.test.ts` wird rot, wenn eine verteilte Skript-Datei den Sync-Stand selbst probt (Datei-Aufruf mit `sync-stand` oder `STAND_PFAD` auf derselben Zeile, oder das nackte Pfad-Literal); die Meldung nennt den Weg. Das ist der benannte Check für das Negativkriterium: eine unmarkierte Abweichung der Form 2 macht ihn rot.
- **Übergang Fabrik-intern nach Kern.** Ein PR setzt den Manifest-Eintrag oder hebt den Ring an und streicht den `kern-abdeckung`-Eintrag; eine Weiche hinter `istBezieher` entfällt. Das ist ein Besitz-PR im Tag-Takt; danach Vor-Tag-Probe, dann „ja, taggen“ (Pre-Flight), dann holen die Bezieher selbst ([ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md)). Der Rückweg ist das Absenken des Rings: der Sync meldet „wird nicht mehr verteilt“ und löscht im Ziel nie.
- **Einordnung „Sammelticket nur in der Factory“.** Form 2: `scripts/sammelticket-anlegen.mjs` lehnt die Art `harness` im Bezieher über `istBezieher` ab. Form 3: Board-Rolle `factory` und `meldestelle` in der Projekt-Config. Form 4: der Regeltext im Kern-Block nennt beide Rollen; er bleibt vorerst, weil Bezieher die Gegenregel brauchen, und factory#221 baut ihn ab.
- **Fundstelle behoben.** Die eine unmarkierte Stelle (`langfuseRepoAusgeben` in `scripts/projekt-config-lib.mjs`) nutzt jetzt `istBezieher`; die Import-Hülle wächst um genau eine Blattdatei. Folge: ein nicht lesbarer Sync-Stand gilt wie ein fehlender als Fabrik (vorher wegen der Dateiprobe als Bezieher); ein vorhandener, aber kaputter Stand bleibt Bezieher.
- **Form:** Fortschreibung zu ADR 0022 statt neuer ADR, weil die Entscheidung den Kern-Schnitt präzisiert (wie [Fortschreibung factory#166](0022-166-ziel-besitz-factory-seiten.md)). Keine neue AGENTS.md-Zeile: das Gate erzwingt die Regel, seine Meldung nennt den Weg, das Kern-Block-Budget bleibt geschont.

## Probe (Rohwerte)

Der Wächter wurde vor der Korrektur geschrieben und lief rot genau an der einen Fundstelle:

```
scripts/projekt-config-lib.mjs:616: M1 Datei-Aufruf auf den Sync-Stand: Fabrik/Bezieher nur über istBezieher(wurzel) aus scripts/sync-stand-lib.mjs unterscheiden (Fortschreibung factory#154 zu ADR 0022)
```

Nach der Korrektur ist der Scan über die verteilten Skript-Dateien leer. Sabotagen (je per Edit, danach zurück): die Fundstelle zurück auf die Dateiprobe, das Muster M1 verfälscht, das Muster M2 verfälscht, die Ausnahme der Heimatdatei entfernt; jede macht mindestens einen Test rot. Ein Dateisystem-Zugriff auf den Sync-Stand außerhalb von `sync-stand-lib.mjs` kam sonst in `scripts/**` nicht vor (Suche nach `existsSync|readFileSync|statSync|accessSync|lstatSync` mit `sync-stand` oder `STAND_PFAD`).

## Bekannte Grenzen

- Der Wächter ist eine zeilenweise Heuristik: berechnete Pfade (Variable, Template mit `${…}`, auch ein Template-Literal ohne Interpolation), eine zweite Rollenregel wie `existsSync(MANIFEST_PFAD)` in `scripts/check-context-size.mjs`, Shell-Proben (`test -f`) in Workflows und Rollenerkennung über andere Signale sieht er nicht. Inhaltsleser über einen injizierten Leser (`syncStandAusText(lies(STAND_PFAD))`) sind bewusst erlaubt, weil sie über den einzigen Format-Leser gehen.
- Form 4 (Regeltext) hat keinen Wächter; Inventur und Entscheidung dazu stehen in factory#222.

## Folgetickets

- factory#221: Harness-Befunde in Fabrik und Bezieher über `melden.mjs`, der Rollenfall verschwindet aus dem Kern-Text.
- factory#222 (blockiert durch factory#221): Fabrik-Regeln in verteilten Texten, Inventur und Umzug, Entscheidung zu einem Wächter für Form 4.

## Re-Evaluierung

Wenn der Rollen-Schalter an mehr als einer Handvoll Stellen nötig wird oder eine Form außerhalb der Tabelle auftaucht (dann Option C neu prüfen), oder wenn die Heuristik des Wächters wiederholt an berechneten Pfaden vorbeiläuft.
