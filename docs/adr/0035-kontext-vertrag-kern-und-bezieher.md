# ADR 0035: Kontext-Vertrag Kern und Bezieher

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-11-13 · Ticket: factory#236 (Teil 4 von 5 des Epics factory#228)

## Status

**Akzeptiert.** Die Fabrik behält den Ist-Zustand als Kontext-Vertrag: Kern- und Projekttext stehen gemeinsam in der einen Root-Kontextdatei `AGENTS.md`, der Kern in einem Kern-Block mit Kern-Block-Budget, dazu ein fester Raum für den Projekt-Block (Wächter und Ratchet: factory#237). Der A/B-Test „Kern je Rolle“ (factory#235) ist ausgewertet und beendet, Arm B und seine Kern-Fläche sind zurückgebaut. Das beantwortet die Akzeptanzkriterien 3 und 4 des Epics factory#228.

## Kontext

Das Epic factory#228 fragte, ob sich der Kontext-Sockel der Rollen senken lässt, ohne dass Bezieher ihren Projekt-Block verlieren. Teil 1 (factory#233) hat die Ladewege von Claude Code und Codex gemessen ([Probe-Befund](../model-routing.md#kontext-budget-kern-auslagerung-factory233), Claude Code 2.1.319, `codex-cli` 0.166.0), Teil 3 (factory#235) die Variante D an der Lens als A/B an echten Tickets. Regel und Rezept standen vorab in `docs/model-routing.md`; die Auswertung folgt dieser Regel unverändert:

1. mindestens 10 gültige Tickets je Arm;
2. Primärwert: Median der Lens-Kosten je Ticket in Arm B mindestens 10 % unter Arm A, Gesamtkosten werden berichtet;
3. Qualitäts-Veto: Anteil PRs mit Blocker in Runde 1 in B höchstens 10 Prozentpunkte unter A, Nacharbeit (`Folge #`) in B nicht höher als in A, Abnahme im ersten Durchgang in B höchstens 10 Prozentpunkte seltener als in A; sonst bleibt A.

## Messung

Fenster: `--von 2026-11-12T00:32:37Z` (Merge von factory#235) bis `--bis 2026-11-13T07:20:06Z`, ohne das Ticket factory#235 selbst. Gerade Ticketnummer lief in Arm A (`sih-lens`, mit `AGENTS.md`), ungerade in Arm B (`lens-kern-je-rolle`, `omitClaudeMd: true`, Projekt-Block im Rumpf, Kern-Regeln per `grep`). Alle Werte stammen aus lokalen Transkripten, git und GitHub (ohne Langfuse, ohne Secret-Key), Preise aus `scripts/preise.mjs`; keiner ist geschätzt. Befehle (Exit 0, `ungueltig` leer, ausgeschlossen: factory#235; bei `kontext-treiber` zusätzlich factory#436, dessen Lens-Läufe um 07:17 und 07:19 UTC schon im Fenster liefen, dessen PR aber noch nicht gemergt war und darum bei `lauf-ergebnis` nicht erscheint):

```
node scripts/lauf-ergebnis.mjs --von 2026-11-12T00:32:37Z --bis 2026-11-13T07:20:06Z --start-agent sih-umsetzer --ohne 235 --je-agent sih-lens --je-agent lens-kern-je-rolle --json
node scripts/kontext-treiber.mjs --von 2026-11-12T00:32:37Z --bis 2026-11-13T07:20:06Z --je-ticket --ohne 235 --ohne 436 --agent sih-lens --agent lens-kern-je-rolle --json
node scripts/factory-kennzahlen.mjs --von 2026-11-12T00:32:37Z --bis 2026-11-13T07:20:06Z --json     # Gesamtkosten je Ticket (Claim-Sessions)
node scripts/subagent-laufzeit.mjs --agent <typ> --von 2026-11-12T00:32:37Z --bis 2026-11-13T07:20:06Z --json
```

**Rohwerte je Arm** (Median je Ticket, wo nicht anders genannt):

| Kennzahl | Arm A (mit `AGENTS.md`) | Arm B (ohne Root-Kontext) |
|---|---|---|
| Gültige Tickets | 22 | 20 |
| Lens-Kosten je Ticket, Median (Σ / Mittel) | 4,849 $ (108,48 $ / 4,93 $) | 4,892 $ (103,09 $ / 5,15 $), +0,9 % |
| Gesamtkosten je Ticket, Median (Σ) | 11,26 $ (258,38 $) | 12,85 $ (254,42 $), +14,1 % |
| Lens-Anteil an den Gesamtkosten, Median je Ticket (Σ-Quote) | 42,8 % (42,0 %) | 38,1 % (40,5 %) |
| Lens-Sockel (erster Call, Median je Ticket laut `kontext-treiber`; Median je Lauf laut `subagent-laufzeit` ohne ticketlose Läufe und ohne factory#436: 23.481 gegen 14.393, Δ −9.088) | 23.119 Tokens | 14.079,5 Tokens (Δ −9.040) |
| Requests je Lens-Ticket, Median | 93 | 103 |
| PRs mit Blocker in Runde 1 | 21/22 (95,5 %) | 18/20 (90,0 %) |
| Runde-1-Blocker je Brille (PRs mit Treffer/PRs, Σ Blocker) | Architektur 6/20 (6), Requirement-Treue 9/20 (12), Test-Adäquanz 20/20 (66), Sicherheit 4/7 (4), Doku 1/2 (1) | Architektur 7/18 (7), Requirement-Treue 10/18 (16), Test-Adäquanz 17/18 (74), Sicherheit 2/7 (2), Doku 1/1 (1), Kombi 0/1 (0) |
| Rote Gates: CI-Fix Σ / festgefahren Σ | 6 / 3 | 0 / 2 |
| Abnahme im ersten Durchgang (gemessen) | 9/15 = 60,0 % (7 entfällt, 0 Override) | 10/14 = 71,4 % (4 entfällt, 2 Override: factory#245, factory#149) |
| Nacharbeit `Folge #` / `nein` / noch offen | 2 (factory#248, factory#28) / 0 / 20 | 1 (factory#363) / 0 / 19 |

Je Ticket (Lens-Kosten aus `kontext-treiber --je-ticket`, Gesamtkosten aus `factory-kennzahlen`, Runde-1-Blocker Σ aller Brillen, Abnahme-Durchgänge laut `lauf-ergebnis`):

Arm A
| Ticket | PR | Lens $ | Gesamt $ | R1-Blocker | Abnahme | Nacharbeit |
|---|---|---|---|---|---|---|
| #246 | #369 | 2.70 | 7.33 | 1 | 1 Durchg. | offen |
| #358 | #370 | 7.54 | 14.80 | 3 | entfällt | offen |
| #248 | #372 | 2.67 | 6.21 | 3 | 1 Durchg. | folge |
| #374 | #376 | 1.85 | 3.71 | 1 | entfällt | offen |
| #362 | #378 | 5.13 | 11.03 | 7 | entfällt | offen |
| #364 | #380 | 7.52 | 21.96 | 13 | 3 Durchg. | offen |
| #354 | #381 | 2.84 | 5.98 | 3 | entfällt | offen |
| #244 | #384 | 6.82 | 12.12 | 4 | 1 Durchg. | offen |
| #28 | #391 | 7.45 | 15.60 | 6 | 1 Durchg. | folge |
| #382 | #408 | 8.20 | 15.58 | 8 | entfällt | offen |
| #394 | #415 | 6.59 | 11.49 | 3 | entfällt | offen |
| #398 | #416 | 3.18 | 10.54 | 2 | 2 Durchg. | offen |
| #396 | #417 | 6.18 | 13.24 | 8 | 1 Durchg. | offen |
| #402 | #420 | 5.28 | 17.60 | 7 | 4 Durchg. | offen |
| #400 | #422 | 3.81 | 10.68 | 1 | 2 Durchg. | offen |
| #406 | #423 | 4.57 | 12.08 | 2 | 1 Durchg. | offen |
| #404 | #425 | 5.43 | 14.37 | 3 | 2 Durchg. | offen |
| #26 | #429 | 0.83 | 4.91 | 1 | 1 Durchg. | offen |
| #428 | #442 | 0.86 | 5.13 | 0 | 1 Durchg. | offen |
| #426 | #444 | 4.29 | 9.29 | 2 | entfällt | offen |
| #388 | #445 | 11.52 | 26.99 | 10 | 2 Durchg. | offen |
| #222 | #446 | 3.24 | 7.75 | 1 | 1 Durchg. | offen |

Arm B
| Ticket | PR | Lens $ | Gesamt $ | R1-Blocker | Abnahme | Nacharbeit |
|---|---|---|---|---|---|---|
| #363 | #371 | 2.99 | 8.61 | 6 | 1 Durchg. | folge |
| #245 | #377 | 10.30 | 24.27 | 7 | Override (entfällt) | offen |
| #375 | #389 | 8.36 | 19.54 | 9 | entfällt | offen |
| #379 | #390 | 6.93 | 13.98 | 7 | entfällt | offen |
| #383 | #392 | 0.69 | 2.93 | 0 | entfällt | offen |
| #395 | #410 | 5.83 | 14.44 | 12 | 1 Durchg. | offen |
| #411 | #412 | 2.74 | 7.58 | 0 | 1 Durchg. | offen |
| #397 | #414 | 5.09 | 11.18 | 5 | 1 Durchg. | offen |
| #399 | #418 | 4.69 | 12.39 | 3 | 1 Durchg. | offen |
| #403 | #419 | 3.53 | 9.85 | 1 | 1 Durchg. | offen |
| #401 | #421 | 9.53 | 20.79 | 11 | 2 Durchg. | offen |
| #405 | #424 | 5.29 | 17.39 | 3 | 3 Durchg. | offen |
| #27 | #427 | 0.82 | 3.46 | 1 | 1 Durchg. | offen |
| #33 | #430 | 1.78 | 5.22 | 1 | 1 Durchg. | offen |
| #407 | #431 | 4.30 | 10.00 | 6 | 1 Durchg. | offen |
| #23 | #432 | 4.43 | 13.31 | 4 | 2 Durchg. | offen |
| #221 | #434 | 3.66 | 9.64 | 1 | 1 Durchg. | offen |
| #365 | #435 | 5.95 | 15.60 | 6 | 2 Durchg. | offen |
| #149 | #438 | 8.30 | 19.14 | 8 | Override (entfällt) | offen |
| #413 | #443 | 7.85 | 15.10 | 9 | entfällt | offen |

Claim-Sessions der Lens-Läufe (Messgrundlage, Arm A, 22): 15037fd3-3846-4226-aabf-3ec5877a502d 1e2d34b6-6f29-43fb-829e-a6a570d64705 124d15fe-319b-4c90-be37-979aac851d11 6eb39c8a-ef92-42f0-b032-aa4723035132 510a66e7-3bae-4f87-8cb4-982bacf17fb5 1f54d1cd-58b7-47eb-aa72-8561710184cc 76ec1570-7dfd-426d-9c16-e3dd7641a12f 921d8f0f-f8e6-463d-a62a-0b1222b4e8e5 24722609-1be5-4609-9bb8-38d7e6014988 f55c642f-8f8f-401b-9356-76c5edbdd52f bd7bda1a-265a-475c-9f63-194ff1459dac b86e53c5-bc2a-4493-b95b-e9161f88af0b 877d4655-4b63-41b5-8938-500456f80f4c b66a7ac1-f960-4caf-b0ee-4fa83cda0079 91061369-6591-45d1-b5c1-ab4ef28aed36 aafdaa04-7551-4b7a-8341-9d1dfc50fb3d daa13676-cd28-48f0-81de-39193f5e2f55 a2d79c8c-817a-4486-adf0-7715d5477c95 2f35a9f5-d3ab-4b4b-b308-9e3439217666 2e45e77a-3296-4f53-992c-cbf66b85b225 4fb7e20b-d56f-4ee1-b7cc-736a2311ac43 e69f3b24-cfbb-4666-8500-a876fc0b532e

Arm B (20): d1c5641f-9629-4bbf-ad3a-9d811e0f1ee2 3cbd2295-f4d2-4838-8f80-3fabd3ac40b0 90a34ee4-64b7-483d-aff7-a23c61104dc8 151261fb-25c6-4ffb-97da-7e11ab3609bd 0733d802-51de-4f4c-83ce-d9720850d4be bceb67d9-f9fe-4b3e-a791-9741dc405c62 170681cf-b820-47d2-a35c-7b3d06eb1eb4 f98e79de-8aff-4058-8e29-932de944d9b2 12e72c7a-3ab3-4690-9a75-9d514e22437b 47594d36-4be2-4305-82c7-9f70f0fff29e 7cfd83eb-507b-4061-a393-48a531846011 8d80d7a5-0d11-489f-8079-6528051f8fec 2775a1ab-4429-448e-bcda-31877d69454b 2766a743-97c8-49ac-8fa6-52cb71ece559 0ec3d0b2-19a0-4720-b06f-24da7f5f79cc 2ce9536f-f10a-408f-b402-9cc89270d0e9 73719cfb-cc8c-4f70-a402-017f8360c8bf 18af9f88-2733-458a-b283-d32e95daed5f 2db341b8-016b-4acb-b673-4a417bce9989 277fb42c-0fce-44ea-8283-063fcc9bfe01

## Optionen

| Option | Bewertung |
|---|---|
| **A (gewählt): Kern-Block in `AGENTS.md` mit Kern-Block-Budget und festem Raum für den Projekt-Block** | Ist-Zustand. Läuft in Claude Code und Codex gleich, `AGENTS.md` bleibt die eine Root-Kontextdatei. |
| **B: Kern auslagern per `@kern.md`-Import** | Verworfen: Codex löst keinen Import auf (Probe Fall a: Kontrollwort ja, Importwort nein), der Kern fehlte dort ganz. B spart auch keinen Sockel: +118 Tokens je Rolle, +35.873 Tokens bzw. +0,011 $ je Ticket, weil die Einbindung dieselben Zeichen lädt. |
| **C: Gesamtbudget für `AGENTS.md` erhöhen** | Verworfen: +12.675 Tokens Sockel je Rolle, +1,071 $ je Ticket (+3.244.067 Tokens je Ticket). Codex schneidet `AGENTS.md` über `project_doc_max_bytes` (32.768 Bytes) ab (Fall b1: Wort bei Byte 46.520 nicht geladen); das Budget stiege außerdem gegen die Ratchet-Richtung (AGENTS.md › Kein Grün-durch-Aufweichen). |
| **D: Kern je Rolle** (Rollen ohne Root-Kontext, Projekt-Block im Agent-Body) | Verworfen: Claude Code trägt es technisch (`omitClaudeMd`, Sockel-Δ −9.067 Tokens, Teil 1), die A/B-Messung an der Lens zeigt aber keine Kostensenkung (Tabelle oben). In Codex nicht umsetzbar: Rollen sind Forks und erben `AGENTS.md` mit dem Verlauf (Fall g). |

## Entscheidung

Entscheidung: A, weil die A/B-Regel entschieden ist und nichts Besseres belegt.

- **Primärwert verfehlt.** Median der Lens-Kosten je Ticket: Arm B 4,892 $ gegen Arm A 4,849 $, also +0,9 % statt mindestens 10 % darunter. Die Regel verlangt B nur bei erfülltem Primärwert und gehaltenem Veto; schon der Primärwert fehlt, das Qualitäts-Veto kann das Ergebnis nur noch bei A halten und ändert es nicht. Voraussetzung 1 war erfüllt (22 und 20 gültige Tickets), kein Ticket ungültig (Abbruch bei weniger als 10 Tickets je Arm: nicht ausgelöst).
- **Gesamtkosten.** Median je Ticket B 12,85 $ gegen A 11,26 $ (+14,1 %), Σ 254,42 $ (20 Tickets) gegen 258,38 $ (22 Tickets); der Lens-Anteil sank im Median von 42,8 % auf 38,1 %, in der Summe von 42,0 % auf 40,5 %. Die Gesamtkosten sind kein Entscheidungswert, bestätigen aber keine Ersparnis.
- **Warum ein kleinerer Sockel nicht spart (ungeprüfte Hypothese).** Arm B hat 103 statt 93 Requests je Lens-Ticket und braucht vermutlich Kern-Regeln per `grep` nach; Σ der Lens-Kosten je Kostenart (Arm B gegen Arm A, 20 gegen 22 Tickets): Cache-Lesen 22,5 $ gegen 22,6 $, Cache-Schreiben 44,8 $ gegen 51,6 $, Ausgabe 35,8 $ gegen 34,3 $. Eine Ursachenprüfung der Requests (Transkript-Lektüre) ist nicht erfolgt und für die Entscheidung nicht nötig.
- **Qualitäts-Veto (berichtet, nicht entscheidend).** Runde-1-Blocker: B 5,5 Prozentpunkte unter A (Toleranz 10, bestanden). Abnahme im ersten Durchgang: B 11,4 Prozentpunkte über A (bestanden). Nacharbeit: noch offen, die 14-Tage-Frist (`NACHARBEIT_TAGE`, `scripts/lauf-ergebnis.mjs`) läuft für die ersten Tickets frühestens am 2026-11-26 ab; vorläufig `Folge #` 1 in B gegen 2 in A. Das Veto hätte nur A halten können; die Entscheidung wartet darum nicht auf die Fristen.
- **Grenze der Messung.** Arm B misst nur die Lens; Planer und Umsetzer ohne Root-Kontext sind nicht Teil der Messung. Die Aussage „Kern je Rolle spart nichts“ gilt damit für die Lens. Variante D bleibt für Planer und Umsetzer technisch möglich (Teil 1: Sockel-Δ −9.067 Tokens je Rolle), ist aber ungemessen und in Codex nicht umsetzbar.
- **A/B-Regel beendet.** Die unterlegene Definition (Arm B), die Arm-Wahl (`lens-arm`), die Guard-Regel R6, die Besitz- und Protected-Paths-Einträge, ihre Wächter und die Wiedervorlage `kern-je-rolle-ab-235` sind entfernt; der Skill `review-lenses` spawnt wieder fest `<agenten.lens>`.
- **Offenlegung (Abweichung von der Rückbau-Liste in `docs/model-routing.md`).** Die Mehr-Typ-Flags der Messskripte bleiben (`--je-agent` in `lauf-ergebnis.mjs`, mehrfaches `--agent` in `kontext-treiber.mjs`) und `armeZuordnen` zieht von `lens-arm-lib.mjs` nach `mess-lib.mjs`: sie sind generisch, projektneutral, tragen die Re-Evaluierung unten und halten den Diff klein. Ein Wächter (`test/harness/entfernte-pfade.test.ts`) hält die Namen des Rückbaus draußen. Grenze: die Phasen-Erkennung von `kontext-treiber` (`istLinse`) kennt wieder nur `agenten.lens`; eine künftige Lens-A/B mit mehreren Typen muss sie wieder auf mehrere Typen erweitern, sonst öffnet ein Spawn des zweiten Typs keine Review-Phase (die Lens-Kosten bleiben richtig, die Phasenwerte des Umsetzers nicht).

## Konsequenzen

- **Kontext-Vertrag für Bezieher unverändert:** Kern-Block in `AGENTS.md`, der Projekt-Block hat festen Raum (factory#237), kein Import, keine Rollen-Aufteilung. Bezieher laufen schon immer in Arm A; es ändert sich nichts an ihrem Kontext.
- Bezieher, die `scripts/lens-arm.mjs` und `scripts/lens-arm-lib.mjs` per Sync erhalten haben, löschen sie selbst: der Sync entfernt keine Dateien (kein `unlinkSync`/`rmSync` in `scripts/factory-sync*.mjs`). Der Tag wird unter v1 ein Minor.
- Eine vor dem Merge gestartete Session kennt den Arm-B-Typ noch; der Guard behandelt ihn nicht mehr als Lens-Spawn (keine Auftragsprüfung für diesen Typ), Tools, Hooks und deny sind unverändert. Die Messung ist beendet, das Risiko akzeptiert.
- Transkripte behalten den Typ `lens-kern-je-rolle`; die Messskripte filtern nur nach dem Typ-String, es gibt keine Datenmigration. Wer die Messung nachrechnet, nimmt den Typ als zweites `--agent`.
- Lehre fürs Messdesign (übertragbar, auch in `docs/model-routing.md`): das Regel-Ende liegt mindestens 14 Tage nach dem 10. Ticket je Arm, sonst ist die Nacharbeit beim Entscheiden offen.

## Weitere Fortschreibungen (als Dateien)

Neue Fortschreibungen dieses ADR stehen je als Datei unter [`fortschreibungen/`](fortschreibungen/0035-237-raum-vertrag-ratchet.md) (Konvention: [README](README.md#format)); dort die erste: [factory#237](fortschreibungen/0035-237-raum-vertrag-ratchet.md) setzt die Entscheidung als Raum-Vertrag-Wächter und Budget-Ratchet um.

## Re-Evaluierung

Neu bewerten bei einer neuen Version von Claude Code oder Codex, deren Release-Notes das Laden von Kontextdateien betreffen: Import-Auflösung in Codex, Standardwert von `project_doc_max_bytes`, Rollen in Codex nicht mehr als Fork, Semantik von `omitClaudeMd`. Dann die Probe aus Teil 1 wiederholen (Rezept in `docs/model-routing.md` › Kontext-Budget: Kern-Auslagerung). Variante D wird nur neu bewertet per A/B, das Lens, Planer und Umsetzer misst. Ohne solche Version kein Prüftermin und keine datierte Wiedervorlage; der Prüftermin der Wächter-Regel zum Raum für den Projekt-Block liegt bei factory#237.
