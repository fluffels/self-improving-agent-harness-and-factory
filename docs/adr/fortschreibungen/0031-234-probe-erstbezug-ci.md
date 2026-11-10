# Fortschreibung #234 (2026-11-10): Probe-Erstbezug in der CI

Ergänzt [ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md), Konsequenz „Trockenlauf gegen den Probe-Erstbezug“: der Probe-Erstbezug läuft jetzt als CI-Job mit vollem `verifyKompakt`. Herkunft: Epic Kontext-Budget (factory#228), Teil 2.

## Kontext

- **Lücke:** der Trockenlauf der Checkliste (`--entwurf --trocken`) lief von Hand und zeigte nur die Vorschau, nicht ein volles `verifyKompakt`; ein Kern-Budget-Überschuss oder ein toter Kern-Verweis fiel erst im ersten echten Bezieher auf.

## Entscheidung

- `scripts/probe-erstbezug.mjs` ersetzt den Handschritt und läuft als CI-Job `Probe-Erstbezug` (`ci.yml`): Fixture-Projekt mit `AGENTS.md` (Kern-Marker, Füll-Block in Größe von `PROJEKT_BLOCK_RAUM`), Sync aus einem lokalen Klon mit lokalem Tag, mechanische Update-Schritte, `verifyKompakt`. Jeder Fund ist rot, eine leere Ergebnisliste nie grün.
- `PROJEKT_BLOCK_RAUM` ist seitdem lückenlos (`KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM` = Gesamtbudget), sonst ließe sich der Negativfall „Kern ein Zeichen über dem Budget“ bei vollem Raum nie auslösen.
- Der Job ist kein Required Check (eine Ruleset-Änderung ist ein Pre-Flight-Stopp); Rot wirkt über den Blocker „CI des Commits rot“ im Tag-Ticket (`ciCheckliste`, nur als Checklistenzeile, nicht als Exit-Code von `--probe`) und den Alarm auf `main` (`alarm-red-main`).

## Grenze

- Er ersetzt keinen echten Bezieher (keine echten Projekt-Blöcke, kein Projekt-Eigenes, nur JS/TS; andere Profile: factory#224). Die Sync-Warnung `Kontextbudget knapp` ist kein Fund.
