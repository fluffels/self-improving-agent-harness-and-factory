# Modell-Routing: Messhistorie 2026

> 📸 **Momentaufnahme vom 2026-11-11 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Datierte Messungen und Entscheidungen, die aus [Modell-Routing](model-routing.md) ausgelagert sind: Baseline und Langfuse-Nachmessung der Modellwahl (2026-09-29 bis 2026-10-05) sowie die Auswertungen des beendeten Phasen-Schnitts (quellprojekt#1593, factory#272). Der heutige Stand steht in `model-routing.md`.

<!-- schnappschuss:start -->

### Baseline (Stand 2026-09-29, alle vier Läufe vor quellprojekt#1065/quellprojekt#1067)

„Tokens" = Input + Cache-Write + Cache-Read + Output ohne Nachlauf; Input allein liegt je Lauf unter 300 und ist weggelassen. Die Phasen-Spalten zeigen den Anteil an diesen Tokens in %.

| Lauf | Calls | Tokens | davon Cache-Read | Cache-Write | Output | Auswahl | Planung | Umsetzung | Review | CI/Merge | Recherche | Modell Umsetzung | Review-Runden | CI-Fix | Rückfragen | ohne Nacharbeit |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|--:|---|
| quellprojekt#1026 (Workflow-Bugfix) | 60 | 6.781k | 95 % | 320k | 21k | 12 | – | 60 | 17 | 12 | – | `claude-opus-5-5` | 1 | 0 | 0 | ja |
| quellprojekt#1064 (Kontext-Gate) | 133 | 20.514k | 95 % | 883k | 49k | 3 | 9 | 65 | 12 | 3 | 8 | `claude-opus-5-5` | 2 | 0 | 1 | ja |
| quellprojekt#1069 (Harness-Regel)¹ | 84 | 18.592k | 96 % | 678k | 72k | –¹ | – | 64 | 30 | 6 | – | `claude-opus-5-5` | 2 | 0 | 1 | ja |
| quellprojekt#1072 (ADR, Doku)¹ | 22 | 6.542k | 98 % | 140k | 18k | –¹ | – | 65 | 8 | 27 | – | `claude-opus-5-5` | 1 | 0 | 1 | ja |

¹ quellprojekt#1069 und quellprojekt#1072 liefen in derselben Session und sind ab dem jeweiligen Claim geschnitten (`--from`); ihre Auswahl ist deshalb nicht gemessen.

**Was die Baseline zeigt:**
- **Die Umsetzung lief in allen vier Läufen auf Opus 5.5, nie auf Sonnet.** quellprojekt#1026 und quellprojekt#1064 hatten den Projekt-Skill (Ticket-Skill des Quellprojekts) geladen (`model: sonnet` im Frontmatter; der Hebel war ab quellprojekt#1065 `settings.json`, seit quellprojekt#1280 der Subagent `<agenten.umsetzer>`, §2), trotzdem kam **kein einziger** Hauptagent-Call von Sonnet. Die Modelle an **Subagenten** greifen dagegen: in quellprojekt#1064 lief der Planer auf `claude-opus-5`, die Recherche auf `claude-sonnet-5-5`. Es hakt also am Frontmatter-Override des Hauptagenten — der größte Hebel für quellprojekt#1065. (`test/harness/model-routing.test.ts` prüft nur, dass die Zeile da ist, nicht, dass sie wirkt.)
- **95–98 % der Tokens sind Cache-Reads**, also der pro Call neu gelesene Kontext. Weniger Calls und ein kleinerer Grundkontext sparen mehr als kürzere Antworten.
- **Loops sind schon billig:** kein einziger roter CI-Push, 1–2 Review-Runden, höchstens eine Rückfrage. Die Kosten stecken in der Umsetzung (60–65 %) und im Review (bis 30 %).
- **Die Planung fehlt bei drei von vier Läufen.** Nur quellprojekt#1064 hat den `<agenten.planer>` gerufen; quellprojekt#1026 lief über den Skill und übersprang ihn trotzdem.
- **Grenze der Baseline:** alle vier sind Harness-/Doku-Tickets ohne Produktcode unter `src/`. Ein `src/`-Lauf wird bei Gelegenheit ergänzt; bis dahin nur Harness-Tickets gegen diese Zeilen vergleichen.

### Langfuse-Nachmessung 28.09.–05.10.2026 (vor quellprojekt#1065)

Quelle: Langfuse, alle Calls der Woche nach Modell.

| Modell | Rolle | Calls | Kosten | Anteil |
|---|---|--:|--:|--:|
| `claude-opus-5-5` | Hauptagent | 3.399 | 209,60 $ | 88 % |
| `claude-opus-5` | Planer, Lenses | 272 | 27,56 $ | 12 % |
| `claude-haiku-4-5` | Recherche | 39 | 0,64 $ | <1 % |
| `claude-sonnet-5-5` | ein Trace (29.09.) | 45 | 0 $¹ | 0 % |

¹ Langfuse hat für `claude-sonnet-5-5` keinen Preis hinterlegt (quellprojekt#1123).

In rund 22 Traces mit Tag `skill:<projekt>` (Ticket-Skill des Quellprojekts): 1.284 Calls Opus 5.5, 257 Opus 5, 9 Haiku, **0 Sonnet**. Das belegt Bug #98898 (§2): das Skill-Frontmatter wirkt beim Skill-Tool nicht, daher (von quellprojekt#1065 bis quellprojekt#1280) der Projekt-Default in `settings.json`.

**Erwartete Ersparnis** durch den Sonnet-Hauptagenten: etwa ein Viertel, nicht die Hälfte. Cache-Reads kosten bei Opus 5.5 und Sonnet 5.5 gleich viel (0,20 $/Mio) und machen 44 % der Kosten aus. Gemessen: [Nachmessung nach quellprojekt#1065/quellprojekt#1198](model-routing.md#nachmessung-nach-10651198-1206).

#### Auswertung und Entscheidung (quellprojekt#1593)

**Ergebnis: keine Entscheidung (AK 3/5: ein Arm unter n = 10), der Mechanismus bleibt samt Paritätsregel.** Die Gruppe `pr` hat nur 8 Tickets, die tatsächlich übergeben haben (n < 10, AK 3/5 quellprojekt#1593); die Nachmessung steht als Zeile in quellprojekt#1775 („Langfuse-Befunde (gesammelt)“), seitdem als Wiedervorlage `phasen-schnitt-nachmessung`. Die Zielmessung (AK 4 quellprojekt#1583) ist mit Rohwerten berichtet und **verfehlt**.

**Messfehler (Ursprung quellprojekt#1579, aufgefallen bei der Auswertung von quellprojekt#1592; korrigiert in quellprojekt#1593; die vorläufigen Zahlen aus quellprojekt#1592 und seinem Plan nicht zitieren).** `ticketAusLauf` wertete `patch.ticket` und ein `worktrees/<praefixe.worktree><nr>` im Prompt vor der Kopfzeile `Ticket #<nr>:` aus (vier Läufe landeten beim falschen Ticket), und `sammel` prüfte den ganzen Prompt statt der Titelzeile (vier Tickets galten fälschlich als Sammeltickets). Jetzt gewinnt die Kopfzeile in Zeile 1, `sammel` liest nur Zeile 1. Frühere Auswertungen mit dieser Zuordnung (auch die Sammel-Anteile der Schnappschüsse quellprojekt#1559 und quellprojekt#1591 in [model-routing.md](model-routing.md)) können abweichen; sie bleiben als Schnappschuss stehen.

**Befehle und Fenster.** `--von` = Merge quellprojekt#1592 (PR quellprojekt#1650) `2026-10-15T23:08:10Z`, `--bis` = Start dieses Laufs `2026-10-16T20:53:55Z`, `--ohne 1592 --ohne 1593`; Menge = Tickets mit gemergtem PR bis `--bis` und ohne offenen Lauf (`node scripts/lauf-ergebnis.mjs --von … --bis … --start-agent <agenten.umsetzer> --ohne 1592 --ohne 1593 --json`: 37 PRs). Ausgeschlossen: quellprojekt#1628 (Lauf offen: Transkript endet mit einem Tool ohne Ergebnis) sowie quellprojekt#1742, quellprojekt#1740, quellprojekt#1763 (kein gemergter PR zu `--bis`). Ausgewertet: 36 Tickets mit `kontext-treiber … --je-ticket --ticket <Menge> [--json]` (Spalten je Ticket: `schnitt`, `kosten`, `nachfolger`, `promptZeichenNachfolger`), Qualität per `lauf-ergebnis … --json`. Der Hauptchat-Zuschlag je Nachfolger ist eine Schätzung: `promptZeichenNachfolger / 4 × 10 $/Mio` (Output-Preis Sonnet aus `preise.mjs`).

**Probe (AK 1) sauber** (je Gruppe der erste Lauf mit `Schnitt:`-Zeile nach dem Merge; quellprojekt#1628 hatte keine Zeile): `verify` quellprojekt#1646, `pr` quellprojekt#1659. Belege: (a) der Nachfolger meldet `pruefe --nonce` = `uebernehmbar`, HEAD und Branch stimmen mit dem Block `UEBERGABE` (quellprojekt#1659: Nachfolger 02:39:52Z, HEAD `7fa542c`; quellprojekt#1646: 03:08Z, HEAD `89f42b5`); (b) beide Vorgänger enden mit `ERGEBNIS: uebergabe`, `SCHNITT:` und `UEBERGABE:`, kein Deny des Wächters und kein SubagentStop-Block (die einzige Ablehnung im Paar, im Nachfolger von quellprojekt#1646 um 03:10Z, kam vom Auto-Mode-Klassifikator „Irreversible Local Destruction“, nicht von einem Hook; die Hook-Fehler der Session zählen Hauptchat, Planer und Lenses mit und sind dem Paar nicht zuordenbar); (c) der Lock wurde übernommen und von den Nachfolgern mit `freigeben` (Exit 0) gelöscht; (d) beide Spawns stehen im Langfuse-Trace: quellprojekt#1659 Trace `4fceca826e2cb0aac16deeadfdd66af5`, Observations `ca834dc664b5df4d` („Subagent: Umsetzung quellprojekt#1659“) und `5be9b77dbc51363b` („… Nachfolger“); quellprojekt#1646 Session `9186cae3-b4b2-4fec-a74f-3de61697ef07` mit „Subagent: Umsetzung quellprojekt#1646“ und „… Nachfolger“ (`queryMetrics`, Zählung je Name). Aber: fünf Tickets mit `Schnitt: pr` (quellprojekt#1421, quellprojekt#1667, quellprojekt#1698, quellprojekt#1067, quellprojekt#1729) haben nie übergeben, weil der Umsetzer die Zeile nicht kannte (der Skill der Session war aktuell, die Agenten-Definition im Hauptchat nicht; die Umsetzer erwähnen den Schnitt nirgends). Die Probe des Mechanismus selbst ist sauber; die fünf Tickets zeigen, dass die Gruppe `pr` nach der Zeile nicht die Behandlung bekam (zusätzlich ein Grund für „keine Entscheidung“, AK 5). Das ist ein Zuordnungsfehler der Gruppe, kein Fehler des Mechanismus; die Gruppenbildung nach tatsächlicher Übergabe wurde nach Sichtung der Daten gewählt und ist hier offengelegt; im Werkzeug steht `schnitt` die Zeile des Prompts, `nachfolger` die tatsächliche Übergabe.

| Gruppe (Median je Ticket) | n (Sammel) | mit Nachfolger | Kosten ($) | + Zuschlag | Ø Kontext je Call | ab verify ($, Σ-Anteil) | ab CI-Warten ($, Σ-Anteil) | Kontext 1. Call Nachfolger | Nachlese Σ (Median) |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|
| `verify` | 10 (2) | 10 | 1,99 | 2,00 | 118,8k | 1,31 (62 %) | 0,21 (17 %) | 55,8k | 80 (6,5) |
| `pr` (Zeile `Schnitt: pr`) | 13 (1) | 8 | 2,40 | 2,42 | 153,4k | 1,52 (67 %) | 0,25 (21 %) | 55,4k | 9 (1) |
| `pr`, nur mit Übergabe | 8 | 8 | 2,02 | 2,03 | | 1,15 | 0,22 | 55k | 9 (1) |
| `ohne` (keine Zeile) | 13 (3) | 0 | 2,57 | 2,57 | 151,5k | 1,29 (58 %) | 0,16 (16 %) | | |
| alle | 36 (6) | 18 | 2,37 | 2,38 | 143,0k | 1,44 (63 %) | 0,21 (18 %) | 55,6k | 89 (1,5) |

Basis (quellprojekt#1559): Σ ab verify 166 $ von 268 $ (62 %), Σ ab CI-Warten 62 $ von 259 $ (24 %). Qualität je Gruppe (Übergabe tatsächlich, `lauf-ergebnis`): `verify` 10 Tickets, Runde 1 mit Blocker 10, Test-Adäquanz-Blocker 8, Ø Runden 2,70, CI-Fix Σ 3, festgefahren 1; `pr` mit Übergabe 8, 8, 7, 2,50, 1, 0; `ohne` 13, 10, 9, 2,15, 4, 0; `pr` ohne Übergabe 5, 5, 5, 3,00, 2, 1. Die Ursache der CI-Fixes (eigener Fehler, Drift, Infrastruktur) ist nicht je Lauf zugeordnet, die Entscheidung hing nicht an der Qualität. **Abbruchregel quellprojekt#1591 je Gruppe (nur zur Einordnung, n skaliert):** (1) Runde 1 mit Blocker löst aus bei `verify` (10/10) und `pr` mit Übergabe (8/8), nicht bei `ohne` (10/13); nach Regel (3) ist das ein Veto in beiden Armen (die Lenses laufen bei `pr` noch im Vorgänger vor dem Schnitt, dort liegt die Differenz also eher an der Ticketmischung; bei `verify` laufen sie im Nachfolger, ein Zusammenhang mit dem Schnitt ist dort nicht auszuschließen). (3) löst aus bei `verify` (festgefahren 1, CI-Fix Σ 3) und bei `ohne` (CI-Fix Σ 4): der CI-Fix-Anteil ist damit kein Effekt des Schnitts (die Ursachen „eigener Fehler“ sind nicht je Lauf getrennt, also nur grob), das festgefahrene `verify`-Ticket (quellprojekt#1646, Sammelticket) bleibt ohne Gegenstück in `ohne`; `pr` mit Übergabe löst nicht aus. (2) Test-Adäquanz-Blocker nur berichtet (Trefferquote 8/10, 7/8, 9/13; Median je PR nicht ausgewertet). (4) Nacharbeit ist bis 2026-10-26 offen (Folge-Zählung: 1 je Gruppe `pr`/`ohne`, 0 bei `verify`, vorläufig; die Schwelle liegt bei 4 Treffern).

**Regel (vorab festgelegt, quellprojekt#1593) und Anwendung.** (0) Beide Schnitt-Gruppen n ≥ 10 abgeschlossene Tickets und Probe sauber, sonst keine Entscheidung. (1) Primärwert: Median Kosten je Ticket plus Hauptchat-Zuschlag mindestens 10 % unter `ohne`. (2) Mechanik-Wächter: Median der Kosten ab dem eigenen Schnittpunkt nicht über `ohne`. (3) Qualitäts-Veto: Abbruchregel quellprojekt#1591 (1)–(4), nur CI-Fixes „eigener Fehler“, löst sie auch in `ohne` aus, ist sie kein Effekt des Schnitts. Anwendung: `pr` mit Übergabe hat n = 8, Punkt (0) scheitert, keine Entscheidung. **Zur Information:** zählte man nach der Zeile (n = 13), bestünde `verify` (1) mit −22 %, verfehlte aber (2) knapp (1,31 $ gegen 1,29 $ ab verify, die Ersparnis liegt vor dem Schnittpunkt, also in der Ticketmischung), `pr` verfehlte (1) (−6 %) und (2) (0,25 $ gegen 0,16 $ ab CI-Warten); beide Arme fielen durch, es bliebe kein Schnitt, und der Mechanismus würde entfernt (AK 3); als Vorbefund für die Nachmessung gilt: in beiden Lesarten verfehlt der Schnitt den Mechanik-Wächter. Die Nachmessung zählt darum nur Tickets mit `nachfolger > 0` und braucht Sessions mit aktueller Umsetzer-Definition. Die Abbruchregel ist von Hand angewandt: die Ursachen-Zuordnung nach Regel 3 (quellprojekt#1646) ist nicht maschinell, `lauf-ergebnis` liefert nur Rohzahlen je Gruppe.

**Zielmessung (AK 4 quellprojekt#1583): verfehlt.** Ziel Ø Kontext je Call < 120k und Median Kosten je Lauf ≤ 0,74 $ (−30 % von 1,05 $). Rohwerte (`kontext-treiber`, Fenster des Messbefehls oben, 36 Tickets): **je Lauf** (62 Umsetzer-Läufe) Median 1,19 $, Ø Kontext je Call 143,0k (Median der Läufe 107,6k); **je Ticket** Median 2,37 $, Ø Kontext 143,0k. Beitrag je Hebel mit seinem Fenster:

| Hebel | Fenster | Median Kosten je Lauf | Ø Kontext je Call |
|---|---|--:|--:|
| Basis (quellprojekt#1541) | vor quellprojekt#1588 | 1,05 $ | |
| quellprojekt#1588/quellprojekt#1559 | 2026-10-09T11:41:26Z bis 2026-10-15T16:29:03Z | 2,54 $ | 222k |
| quellprojekt#1590/quellprojekt#1591 (effort low, verworfen) | 2026-10-15T16:30:26Z bis 21:46:15Z, `--ohne` 1561 1588 1590 1591 1598 1568, 14 Läufe | 1,20 $ | 118,6k |
| quellprojekt#1592 (Phasen-Schnitt, effort medium) | 2026-10-15T23:08:10Z bis 2026-10-16T20:53:55Z, 62 Läufe | 1,19 $ | 143,0k |

Vorsicht beim Vergleich je Lauf: der Schnitt teilt ein Ticket in zwei Läufe (62 Läufe auf 36 Tickets) und senkt den Median je Lauf dadurch mechanisch; je Ticket sind es 2,37 $. Die Vergleichsbasis quellprojekt#1591 entscheidet nicht (effort low ist zurückgenommen); Primärkontrolle ist `ohne` im selben Fenster. **Offenlegung:** der Planer sah vorläufige Zahlen; der Primärwert stand schon in quellprojekt#1592, Mechanik-Wächter und Qualitäts-Veto sind hier vor der Auswertung fixiert worden.

#### Auswertung und Entscheidung (factory#272)

**Entscheidung: der Phasen-Schnitt wird beendet (kein `Schnitt:` mehr im Erst-Spawn, ein Ticket läuft in einem Umsetzer bis zum Merge), weil der Arm `pr` die vorab festgelegte Regel (quellprojekt#1593 Punkte (0) bis (3)) nicht erfüllt: n = 3 Tickets mit Übergabe statt mindestens 10 (Punkt (0)), und der Mechanik-Wächter (2) fällt knapp durch.** Die Regel stand vor der Auswertung fest: erfüllt der Arm `pr` mit Übergabe (0) bis (3), wird auf `pr` begrenzt (Tickets mit langer CI-Wartezeit), in jedem anderen Fall beendet.

**Fenster und Befehle.** `--von` = `2026-10-16T20:53:55Z` (Ende des Fensters quellprojekt#1593), `--bis` = `2026-11-11T20:22:55Z`, `--ohne 272`: `node scripts/kontext-treiber.mjs --von … --bis … --je-ticket --ohne 272 --json` und `node scripts/lauf-ergebnis.mjs --von … --bis … --start-agent <agenten.umsetzer> --ohne 272 --json` (lokale Transkripte, git, gh; kein Secret-Key); je Arm dieselbe Abfrage mit `--ticket <nr>` über die Tickets des Arms. **Grenze der Datenlage:** auf diesem Rechner liegen Transkripte erst ab 2026-11-10 vor (frühere Läufe liegen nicht lokal), das Fenster trägt 36 Tickets (erster Start 2026-11-10T15:58Z, letzter 2026-11-11T20:02Z); die 26 Tage seit Beginn der Messung (2026-10-15) liegen knapp unter der Frist von vier Wochen, die Entscheidung folgt der vorab gesetzten Regel „in jedem anderen Fall beenden“. Gruppen nach tatsächlicher Übergabe (`nachfolger > 0`), Hauptchat-Zuschlag wie oben (`promptZeichenNachfolger / 4 × 10 $/Mio`).

| Gruppe (Median je Ticket) | n (Sammel) | Kosten ($) | + Zuschlag | ab verify ($) | ab CI-Warten ($) |
|---|--:|--:|--:|--:|--:|
| `verify` mit Übergabe | 11 (4) | 2,90 | 2,92 | 1,31 | 0,29 |
| `pr` mit Übergabe | 3 (3) | 2,46 | 2,47 | 1,62 | 0,18 |
| `ohne` | 9 (4) | 3,25 | 3,25 | 1,57 | 0,17 |

Nach der Zeile `Schnitt:` gezählt: `verify` 14 Tickets, `pr` 13, `ohne` 9 (die Mediane dieser Zählung schwanken mit dem Messzeitpunkt, ein Lauf war noch offen, und gehen nicht in die Entscheidung ein); die 13 `pr`-Tickets enthalten nur 3 mit tatsächlicher Übergabe (Sammelticket-Anteil 3 von 3, bei `ohne` 4 von 9), das Median-Ergebnis des Arms `pr` ist damit vor allem Ticketmischung. Qualität (`lauf-ergebnis`, alle 32 PRs des Fensters): Runde 1 mit Blocker 30 von 32, Test-Adäquanz-Blocker in 28 von 29 Code-PRs (126 Blocker, 4,3 je PR), CI-Fix Σ 4, festgefahren Σ 2.

**Regelanwendung.** (0) `pr` mit Übergabe n = 3 < 10: verfehlt (`verify` mit n = 11 bestünde). (1) Primärwert `pr`: 2,47 $ gegen 3,25 $ (−24 %), `verify`: 2,92 $ gegen 3,25 $ (−10,2 %), beide mit Ticketmischung als Störgröße (Sammelanteil 3/3, 4/11, 4/9). (2) Mechanik-Wächter: `pr` 0,18 $ ab CI-Warten gegen 0,17 $ bei `ohne` (knapp über der Kontrolle, Punkt verfehlt, wie schon in quellprojekt#1593 mit 0,25 $ gegen 0,16 $); `verify` 1,31 $ gegen 1,57 $ ab verify bestanden. (3) Qualitäts-Veto nicht ausgewertet, die Entscheidung hängt nicht daran. Der Nachfolger startet je Übergabe mit rund 55k Kontext (quellprojekt#1593) und kostet einen zusätzlichen Spawn samt Übergabe-Prompt des Hauptchats; die Ersparnis liegt vor dem Schnittpunkt, also in der Ticketmischung (so schon in quellprojekt#1593). **Beendet statt begrenzt**, weil der einzige Arm, der auf Tickets mit langer CI-Wartezeit hätte begrenzen können (`pr`), die Regel nicht erfüllt. Die Kostenzahl „Review 38 bis 40 %“ aus dem Ticket sind Angaben der Maintainerin und hier nicht nachgemessen.

**Folgen.** `.agents/skills/factory/ablauf.md`: Spawn-Vorlage ohne `Schnitt:`-Zeile, Absatz „Phasen-Schnitt beendet“. Der Vertrag (`ticket-lock.mjs` `uebergeben`, `uebernehmen --nachfolger`, `umsetzer-abschluss.mjs` R4/R5, Abschnitt „Einstieg nach Übergabe“) ruhte für Sessions mit älterer Definition; der Rückbau erfolgte in factory#399 (Stand in [model-routing.md](model-routing.md#phasen-schnitt-vertrag-ab-regel-messrezept)). Fortschreibung: [ADR 0028, factory#272](adr/fortschreibungen/0028-272-phasen-schnitt-beendet.md). Die Gegenprobe-Abschnitte zum Lens-Modell in [model-routing.md](model-routing.md) bleiben unverändert, das Lens-Modell bleibt Opus.

<!-- schnappschuss:ende -->
