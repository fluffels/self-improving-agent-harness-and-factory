# Fortschreibung #518 (2026-11-16): Änderungsregister trägt die Prüfung

Ergänzt [ADR 0027](../0027-regeln-lockern.md) (Punkte 4 und 8); die Ledger-Zeilen bleiben unverändert (Punkt 8). Teil 1/9 von factory#518, gebaut in factory#571.

## Regel

- **Registerzeile je Umstellung statt Einzel-Wiedervorlage.** Jede Umstellung der Fabrik bekommt eine Zeile in `.github/aenderungsregister.json` (Schema und Katalog: `scripts/aenderungsregister-lib.mjs`, Wächter `test/harness/aenderungsregister.test.ts`): Datum, Änderung, erwartete Wirkung, Messgröße aus dem Katalog `MESSGROESSEN`, Basis, Toleranz (Richtung und Schwelle eines Qualitätsmaßes), Rückfall, Prüftermin (Standard Datum + 28 Tage, Abweichung nur mit `pruefTerminGrund`), Mindestdaten.
- **Keine zwei Wahrheiten:** das Register trägt die Prüfung, die Ledger-Zeile in ADR 0027 den begründenden Beleg. Das Feld `adr` (`datum`, `pr` wörtlich wie in der PR-Spalte) zeigt auf die Ledger-Zeile; der Wächter prüft beide Richtungen.
- **Ab 2026-11-17** nennt jede neue Ledger-Zeile `Register: \`<id>\`` (Spalte Rückfall-Trigger). Die Zuordnung älterer Zeilen steht nur im Feld `adr` des Registers: Punkt 8 verbietet Zusätze in alten Zeilen, eine Zuordnungstabelle gibt es nicht.
- Der Bau misst nichts; die Messung folgt in den weiteren Teilen von factory#518.

## Erstbefüllung (factory#573)

- Nennt eine Ledger-Zeile vor 2026-11-17 eine Wiedervorlage-Id, trägt die Registerzeile mit `adr` auf diese Zeile die Prüfung, die Wiedervorlage entfällt; die Ledger-Zeile bleibt unverändert (Punkt 8).
- Wiedervorlagen tragen ein Pflichtfeld `art` aus `frist`, `abhaengigkeit`, `sicherheit`, `upstream`, `analyse-takt`; `umstellung` und `regel` sind verboten (Wächter `test/harness/wiedervorlagen-art.test.ts`). Die Ausnahme für den Sammeleintrag entfiel mit factory#574 (siehe unten).
- Eine Wiedervorlage ohne Katalog-Messgröße oder ohne Ledger-Zeile (Beispiel `sicherheits-lens-kosten-334`: Kosten je Brille und je Risikoklasse fehlen) bleibt mit `art` stehen, bis der Katalog sie trägt.

## Verfall und Fangquote (factory#607)

- Das Register kennt die Zeilenart `art: "verfall"` (Pflichtfelder `id`, `ziel`, `aufgenommen`, `ablauf`, `messgroesse: fangquote`; `durch` nur bei Regeln, Ziel mit Anker `#`, Ids der erzwingenden Wächter). Das Manifest des Regel-Verfalls ist damit das Änderungsregister, keine eigene Datei.
- Messgröße `fangquote` (Qualitätsmaß, Quelle `gate-fundquote`, Parameter `ziel`): Anteil der Testläufe mit rotem Wächter. Ein Rot durch Zeitlimit, Abbruch oder Infrastruktur zählt nicht als Fang; fehlende Logs und eine Regel ohne `durch` sind eine Lücke mit Grund, nie 0.

## Standard-Verfall (factory#608)

- Jede `test/harness/*.test.ts` und jede fett markierte Regel in `AGENTS.md` hat eine Verfall-Zeile (`node scripts/regel-verfall.mjs --generieren`: `ablauf` = `aufgenommen` + 30 Tage, Ziele mit Zeile werden übersprungen). Eine neue Datei oder Regel ohne Zeile macht `test/harness/regel-verfall.test.ts` rot; so verfällt Neues standardmäßig (Bremse der Härtungsschleife).
- `node scripts/regel-verfall.mjs --kandidaten` nennt jedes Ziel mit `heute >= ablauf` und ohne Fang in den letzten 30 Tagen samt Läufen und Fängen; Lücken (Regel ohne `durch`, keine Messpunkte) stehen getrennt als „nicht messbar“ und sind nie Kandidat. Die geschlossene Liste `SICHERHEITS_AUSNAHMEN` (`scripts/regel-verfall-lib.mjs`) nimmt die Klassen aus ADR 0027 Punkt 6 aus; ein Eintrag ohne existierendes Ziel ist rot. Ein Ziel mit Anker prüft der Wächter als Überschrift, in `AGENTS.md` auch als Titel einer fett markierten Regel.
- Prüftermin: Registerzeile `verfall-regel-verfall` (`ablauf` 2026-12-16): Fand der Wächter in 30 Tagen echte Lücken (neue Datei oder Regel ohne Zeile, Ausnahme ohne Ziel), oder erzeugte er nur Handarbeit durch umbenannte Regel-Titel (ändert sich der Titel, ändert sich der Anker und die Verfallsuhr beginnt neu)? Und: bekommen die AGENTS.md-Regel-Zeilen ein `durch`, damit sie messbar werden (heute dauerhaft „nicht messbar“)?

## Auflösung des Sammeleintrags (factory#574)

- Der Sammeleintrag der Wiedervorlagen (Prüftermin 2027-03-01) ist aufgelöst: jede seiner Regeln und Wächter ist eine Registerzeile `art: "verfall"`, `messgroesse: fangquote`, `ablauf` 2027-03-01 (der zugesagte Termin), `aufgenommen` das Merge-Datum des einführenden PR. Ids: `verfall-<wächterdatei>` für Wächter-Tests unter `test/harness/`, `verfall-<name>-<nr>` für Regeln. Der Wächter `test/harness/entfernte-pfade.test.ts` hält den alten Namen aus dem Repo (Ausnahme: das Ledger in ADR 0027, Punkt 8).
- Regeln ohne `durch` sind eine Lücke (die Fangquote ist dann „keine Daten“, nie 0); die Analyse aus factory#576 bewertet sie von Hand.
- Das Schema hat kein Textfeld; die Prüffragen des Sammeleintrags stehen hier, je Id eine:
  - `verfall-kontext-budget-ratchet`, `verfall-verbleib`: Hat das Zeichen-Budget je Agenten- und Skill-Datei oder der Verbleib-Wächter echte Funde gebracht (rote Läufe aus dem Ratchet, ein verlorener Verbleib), und stimmt der Umsetzer-Sockel noch mit der Basis in `docs/model-routing.md`?
  - `verfall-brillen-dateien-308`, `verfall-lens-auftrag-zusatzpass`: Brillen-Dateien `brille-<Schlüssel>.md` und Regel R5 des Lens-Auftrag-Guards (Kopf-Feld `Brille:`): Rückfall-Trigger der Ledger-Zeile vom 2026-11-11.
  - `verfall-plattform-weiche-310`, `verfall-bedingte-dateien`: Plattform-Weiche und sechs bedingte Dateien des Umsetzers: Rückfall-Trigger der Ledger-Zeile vom 2026-11-11.
  - `verfall-risikoklasse-333`: Nachmessung wie in `docs/model-routing.md`, Fehlalarme der Teilwort-Muster gegen echte Treffer.
  - `verfall-sweep-tiefe-272`, `verfall-zusatzpass-272`: Rückfall-Trigger der Ledger-Zeile vom 2026-11-11; Blieb ein echter Blocker liegen, weil der Hand-off ohne neue Klasse griff?
  - `verfall-sicherheits-checks-335`, `verfall-sicherheits-workflows`: Blockiert eine Regel zu oft ohne echten Fund (Dependency-Graph-Ausfall, zizmor-Fehlalarm)?
  - `verfall-modulkopien-244`: Hat das Drift-Gate in Bezieher-Läufen echte Modulkopien gefunden oder nur Fehlalarme? Ohne Fund lockern oder streichen.
  - `verfall-eingangsgrenze-sammelzeilen`: Gingen durch die Grenze belegte Kosmetik- oder Hypothese-Befunde verloren, die später als Defekt wiederkamen? Ja: lockern oder streichen.
  - `verfall-workflow-skripte` (factory#394): Meldete der Wächter echte Lücken (Skripte ohne Schutzlisten-Eintrag, Importe außerhalb der Builtins) oder nur Fehlalarme?
  - `verfall-risikostufe-01-529`, `verfall-risikostufe-ablauf`: Nachmessung der Läufe mit `lenses=kombiniert` oder `— stufe` seit 2026-11-11 (ab 5 wie in `docs/model-routing.md`, Kombi-Lens-Grenze); danach bleibt die Stufe, oder Revert bzw. niedrigere Grenze nach ADR 0027 Punkt 4.
  - `verfall-waechter-voll-396`: Wächter-Tests sind `SWEEP: voll`; Fund auf Wächter-Hilfslogik in einem nur dadurch vollen PR: bleibt, sonst Lockern-Kandidat.
  - `verfall-ausgabe-diaet-310`: `node scripts/kontext-treiber.mjs --von <A> --bis <B> --agent sih-umsetzer --je-ticket --json`, Wert `gesamt.wachstum.ergebnis` und `gesamt.gesamt.requests` gegen die Basis 437,0 (2026-10-28 bis 2026-11-11); liegt der Wert der drei Status-Läufe nach dem Merge von factory#310 darüber: Revert der Ausnahme per PR.
  - `verfall-fabrik-regeltext` (factory#222): Brachte der Form-4-Wächter echte Funde, oder sind es über 15 Einträge „beide“ bzw. wiederholte Fehltreffer?
  - `verfall-raum-vertrag`, `verfall-budget-beleg-237`: Wurde der Wächter je rot und war es richtig, wurde der Beleg missbraucht (Link ohne Messung)?
  - `verfall-basis-nachlauf-499`: Fand der Schritt einen semantischen Konflikt oder Basis-Wechsel (Step-Log „Basis-Nachlauf“), oder kostete er nur CI-Minuten? Ohne Fund: streichen.
  - `verfall-kern-laufzeittexte` (factory#481, dritte Regel): Wurde der Wächter je rot und war es richtig, oder blieb er durch eine Lücke des Kommentar-Strips still?
  - `verfall-review-nachweis` (factory#530, Pflichtfelder `sollte=` und `hinweis=`, `bewerteSchwereFelder`): Zeigte `kennzahlen.schwere` von `lauf-ergebnis` echte Unterschiede je Schwere, oder blieb `hinweis` überall 0?
  - `verfall-epic-abschluss-507`: Hat der Workflow je ein Epic zu früh oder gar nicht geschlossen (Verdrängung durch die Concurrency-Gruppe, Kinder nur im Body)?
  - `verfall-skript-verweise` (factory#507): Fand der Wächter einen echten toten Verweis oder nur Fehlalarme durch Kommentartext?
  - `verfall-probe-vorab-541`: `git log --since 2026-11-15 --grep 'Folge #'` und `node scripts/lauf-ergebnis.mjs --von <Merge von factory#541> --bis <Termin> --json`: Gab es ein Probe-Ticket mit Vorab-Bewertung oder einen Modellwechsel, dessen Umbau Nacharbeit auslöste? Ohne Fall um 8 Wochen schieben.
  - `verfall-token-budget-560`, `verfall-token-budget-regel`: Aus vorhandenen Daten, ohne eigenen Messlauf: Wurde die Regel verletzt (Gegenprobe, Messlauf oder Zusatzpass im Lauf; Beleg: PR-Texte und `Review:`-Zeilen seit dem Merge von factory#560), und löste ein Verstoß Nacharbeit aus (`Folge #` binnen 14 Tagen)? Danach schärfen, um 8 Wochen schieben oder löschen.
  - `verfall-agent-harness-gliederung`: Gliederungs-Wächter der `docs/agent-harness.md`: Fund oder Fehlalarm; ohne Fund lockern oder streichen.
- Die Auslösung am Termin kommt erst mit den Folgekindern von factory#518 (factory#608 Regel-Verfall-Leser, factory#578 Auslöser); bis dahin gibt der Ablauf kein Signal, das wird hingenommen. Sicherheitsrelevante Zeilen (`verfall-sicherheits-workflows`, `verfall-sicherheits-checks-335`) gehören in die Ausnahmeliste von factory#608.
- `aufgenommen` der Wächter-Zeilen `verfall-lens-auftrag-zusatzpass` und `verfall-bedingte-dateien` ist das Datum der Regel (2026-11-11), nicht der Datei.
- Am Termin entscheidet die Evidenz je Zeile (ADR 0027 Punkt 2): belegter Fund, die Regel bleibt; kein Fund, sie wird Lockern-Kandidat.

## Re-Evaluierung

Prüftermin 2026-12-14: legt jede neue Ledger-Zeile eine Registerzeile an, bleibt die Regel; entsteht daneben weiter eine Einzel-Wiedervorlage je Umstellung, wird der Wächter um diese Prüfung erweitert.
