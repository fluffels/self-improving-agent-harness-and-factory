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
| 4, Regeltext nur für die Fabrik | Projekt-Block der AGENTS.md oder Factory-Seite | `test/harness/fabrik-regeltext.test.ts` mit Inventur `test/harness/fabrik-regeltext-inventur.json` (factory#222) |
| 5, zeitlich: `main` vor dem Tag | Release-Tag | Tag-Takt und Vor-Tag-Probe; im Bezieher das Drift-Gate mit Herkunft vom Tag |

- **Rollen-Schalter.** `istBezieher(wurzel)` ist die Stelle für Rollen-Weichen im verteilten Code: Sync-Stand vorhanden heißt Bezieher, ein kaputter Inhalt zählt als Bezieher (fail-closed), eine nicht lesbare Datei wie eine fehlende. Daneben verzweigen Prüfer auf das Feld `zustand` von `liesSyncStand` bzw. `syncStandAusText` aus derselben Heimat (etwa `scripts/check-docdrift.mjs`, `scripts/check-factory-drift.mjs`, `scripts/factory-update-check.mjs`); sie gehen über den Format-Leser und sind erlaubt, jeder ordnet `kaputt` selbst fail-closed für seinen Zweck ein (das Doku-Drift-Gate prüft dann voll). Bei Rollen-Weichen gilt `istBezieher`. `test/harness/rollen-schalter.test.ts` wird rot, wenn eine verteilte Skript-Datei den Sync-Stand selbst probt (Datei-Aufruf mit `sync-stand` oder `STAND_PFAD` auf derselben Zeile, oder das nackte Pfad-Literal); die Meldung nennt den Weg. Das ist der benannte Check für das Negativkriterium: eine unmarkierte Abweichung der Form 2 macht ihn rot.
- **Übergang Fabrik-intern nach Kern.** Ein PR setzt den Manifest-Eintrag oder hebt den Ring an und streicht den `kern-abdeckung`-Eintrag; eine Weiche hinter `istBezieher` entfällt. Das ist ein Besitz-PR im Tag-Takt; danach Vor-Tag-Probe, dann „ja, taggen“ (Pre-Flight), dann holen die Bezieher selbst ([ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md)). Der Rückweg ist das Absenken des Rings: der Sync meldet „wird nicht mehr verteilt“ und löscht im Ziel nie.
- **Einordnung „Sammelticket nur in der Factory“.** Form 2: `scripts/sammelticket-anlegen.mjs` lehnt die Art `harness` im Bezieher über `istBezieher` ab. Form 3: Board-Rolle `factory` und `meldestelle` in der Projekt-Config. Form 4: der Regeltext im Kern-Block nennt beide Rollen; er bleibt vorerst, weil Bezieher die Gegenregel brauchen, und factory#221 baut ihn ab (siehe Nachtrag factory#221).
- **Fundstelle behoben.** Die eine unmarkierte Stelle (`langfuseRepoAusgeben` in `scripts/projekt-config-lib.mjs`) nutzt jetzt `istBezieher`; die Import-Hülle wächst um genau eine Blattdatei. Folge: ein nicht lesbarer Sync-Stand gilt wie ein fehlender als Fabrik (vorher wegen der Dateiprobe als Bezieher); ein vorhandener, aber kaputter Stand bleibt Bezieher.
- **Form:** Fortschreibung zu ADR 0022 statt neuer ADR, weil die Entscheidung den Kern-Schnitt präzisiert (wie [Fortschreibung factory#166](0022-166-ziel-besitz-factory-seiten.md)). Keine neue AGENTS.md-Zeile: das Gate erzwingt die Regel, seine Meldung nennt den Weg, das Kern-Block-Budget bleibt geschont.

## Probe (Rohwerte)

Der Wächter wurde vor der Korrektur geschrieben und lief rot genau an der einen Fundstelle:

```
scripts/projekt-config-lib.mjs:616: M1 Datei-Aufruf auf den Sync-Stand: Fabrik/Bezieher nur über istBezieher(wurzel) aus scripts/sync-stand-lib.mjs unterscheiden (Fortschreibung factory#154 zu ADR 0022)
```

Nachtrag factory#220 (L7): der Meldungstext des Wächters lautet seitdem: „M1 Datei-Aufruf auf den Sync-Stand: Rollen-Weichen nur über istBezieher(wurzel) aus scripts/sync-stand-lib.mjs, Prüfer über das Feld zustand von liesSyncStand (Fortschreibung factory#154 zu ADR 0022)“ (die Rollen-Weiche ist `istBezieher`, der Prüfer liest das Feld `zustand`).

Nach der Korrektur ist der Scan über die verteilten Skript-Dateien leer. Sabotagen (je per Edit, danach zurück): die Fundstelle zurück auf die Dateiprobe, das Muster M1 verfälscht, das Muster M2 verfälscht, die Ausnahme der Heimatdatei entfernt; jede macht mindestens einen Test rot. Ein Dateisystem-Zugriff auf den Sync-Stand außerhalb von `sync-stand-lib.mjs` kam sonst in `scripts/**` nicht vor (Suche nach `existsSync|readFileSync|statSync|accessSync|lstatSync` mit `sync-stand` oder `STAND_PFAD`).

## Nachtrag factory#221

Harness-Befunde laufen in Fabrik und Bezieher über `node scripts/melden.mjs`; in der Fabrik (kein Sync-Stand, Meldestelle ist das eigene Repo) trägt es ins jüngste ungeclaimte Harness-Sammelticket ein (Test mit injizierter API, `test/meldung-lib.test.ts`), ohne Sammelticket Exit 1 mit der Fix-Zeile. Der Rollen-Text ist aus dem Kern-Block und den verteilten Agenten- und Skill-Texten abgebaut; die Fix-Zeile der Agentenvariante ist rollenneutral. Das Anlegen (`sammelticket-anlegen.mjs harness`, Position 4 des Factory-Boards) steht nur noch im Projekt-Block (Form 4, Regeltext nur für die Fabrik). `test/harness/harness-befunde-melden.test.ts` ist der benannte Check: er wird rot, wenn Kern-Block oder eine verteilte Datei unter `.claude/agents/` oder `.agents/skills/` für Harness-Befunde eine Rolle nennt (Heuristik mit zwei Wortlisten; Factory-Seiten, Projekt-Block und `.mjs`-Laufzeittexte sind nicht gescannt, der Rest bleibt factory#222).

## Nachtrag factory#222

Inventur (Stand 684f9b6) über die verteilten Markdown-Einheiten (35 Einheiten, 19 Treffer; der Wächter scannt 34, ohne den generierten Zeiger; geschlossene Suchliste: „Factory-Repo“, „Fabrik“, „upstream“, „ohne Sync-Stand“, „sync-stand.json“, „Rolle `factory`“, je Treffer gezählt):

| Fundstelle | Einordnung |
| --- | --- |
| `AGENTS.md#kern` Zeile 9 „Änderungen nur upstream“ | beide (Bezieher-Regel) |
| `AGENTS.md#kern` Zeile 9 „ohne `.factory/sync-stand.json` ist dieses Repo selbst upstream“ (2 Treffer) | nur Fabrik, umgezogen in den Projekt-Block (Blockquote „Dieses Repository ist der Harness selbst“) |
| `.claude/agents/factory-umsetzer.md` Schritt 2, Satz über Kern-Einheiten samt „(nur im Factory-Repo)“ | nur Fabrik, umgezogen nach `docs/agent-harness.md` › Kern-Reinheits-Wächter (Bullet „Kern-Prosa“) |
| 7 Fabrik-Verweise `<x>.md (Fabrik)` (Umsetzer 2, review-lenses 2, factory/ablauf 2, ticket-drift 1) | beide (Verweisform, factory#177), vom Wächter automatisch eingeordnet |
| Planer 2, `docs/codex/einstieg.md`, `brille-architektur.md`, `factory/SKILL.md` 2 | beide, mit Grund in der Inventur-JSON; der generierte Zeiger `.claude/skills/factory/SKILL.md` (1 Treffer, gleicher Text wie die Quelle) ist vom Scan ausgenommen |

Entscheidung zum Wächter: ja, `test/harness/fabrik-regeltext.test.ts`. Form 4 war die einzige Form ohne Prüfung, die Inventur fand zwei unbewachte Fundstellen „nur Fabrik“ (ADR 0027: Evidenz), die Kosten sind gering. Eine Fundstelle ohne Einordnung ist rot; „beide“ steht mit Ausschnitt und Grund in `fabrik-regeltext-inventur.json` (Ausschnitt statt Zeilennummer: bricht nur bei geänderter Formulierung, dann soll neu eingeordnet werden); „nur Fabrik“ wird nie eingetragen, sondern umgezogen. Negativfall: der verfälschte Satz „(nur im Factory-Repo)“ im Umsetzer macht den Scan rot.

Messwerte Red-Green (je per Edit verfälscht, `git diff --stat` belegte die Änderung, danach zurück): Umsetzer-Satz zurück 2 Tests rot; Inventur-Eintrag gelöscht 1 rot; Phantom-Eintrag 1 rot (stale); `upstream` aus der Suchliste 3 rot; Verweisform gebrochen 3 rot.

Gegenprobe Bezieher-Export (`node scripts/probe-erstbezug.mjs`, Exit 0, GRÜN 17 Schritte): im Export steht „Änderungen nur upstream (`npm run check:factorydrift` nennt den Weg)“ (AGENTS.md Zeile 9) und „Prüfungen außerhalb von `verify` laut Projekt-Block“ (Umsetzer, 1 Treffer); „selbst upstream“ und „kern-literale-baseline“ fehlen (grep Exit 1). Budgets: Kern-Block 15.182 (Budget 15.300 auf 15.200 gesenkt), Projekt-Raum 12.700 auf 12.800, Summe 28.000.

Re-Evaluierung: mehr als 15 Einträge „beide“ oder wiederholte Fehltreffer: Wächter enger fassen oder streichen (Prüftermin `regeln-verfall-2027-03`).

## Bekannte Grenzen

- Der Wächter ist eine zeilenweise Heuristik: berechnete Pfade (Variable, Template mit `${…}`, auch ein Template-Literal ohne Interpolation), eine zweite Rollenregel wie `existsSync(MANIFEST_PFAD)` in `scripts/check-context-size.mjs`, Shell-Proben (`test -f`) in Workflows und Rollenerkennung über andere Signale sieht er nicht. Inhaltsleser über einen injizierten Leser (`syncStandAusText(lies(STAND_PFAD))`) sind bewusst erlaubt, weil sie über den einzigen Format-Leser gehen.
- Form 4 (Regeltext) hat zwei Wächter: für Harness-Befunde `test/harness/harness-befunde-melden.test.ts` (Nachtrag factory#221) und allgemein `test/harness/fabrik-regeltext.test.ts` (Nachtrag factory#222). Beide sind Wortlisten-Heuristiken: eine Umschreibung ohne Listenwort (etwa „Bezieher“, „Factory-Board“) fällt durch, Laufzeittexte in `.mjs` und Workflows sind nicht gescannt.

## Folgetickets

- factory#221: Harness-Befunde in Fabrik und Bezieher über `melden.mjs`, der Rollenfall verschwindet aus dem Kern-Text.
- factory#222 (erledigt, Nachtrag unten): Fabrik-Regeln in verteilten Texten, Inventur und Umzug, Wächter für Form 4.

## Re-Evaluierung

Wenn der Rollen-Schalter an mehr als einer Handvoll Stellen nötig wird oder eine Form außerhalb der Tabelle auftaucht (dann Option C neu prüfen), oder wenn die Heuristik des Wächters wiederholt an berechneten Pfaden vorbeiläuft.
