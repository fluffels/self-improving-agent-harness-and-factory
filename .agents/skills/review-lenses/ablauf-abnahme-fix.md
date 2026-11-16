# Ablauf: Abnahme-Fix-Runde

Bedingte Datei von `SKILL.md` (Kern: `.agents/skills/review-lenses/SKILL.md`): lies sie, sobald die Holdout-Abnahme nach der Konvergenz das Urteil `fix` liefert. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

<!-- factory:projektwerte:start -->
Projektwerte aus `.factory/projekt.json` (generiert von `node scripts/projektwerte.mjs --write`, nicht von Hand ändern).

| Schlüssel | Wert |
| --- | --- |
| `praefixe.commitZeile` | `SIH-` |
| `praefixe.branch` | `feature/sih-` |
| `praefixe.worktree` | `sih-` |
| `agenten.planer` | `sih-planer` |
| `agenten.umsetzer` | `sih-umsetzer` |
| `agenten.lens` | `sih-lens` |
| `agenten.gruppe` | `sih-gruppe` |
| `agenten.ticketSkill` | `sih-ticket` |
| `labels.harness` | `area:harness` |
| `labels.festgefahren` | `status:festgefahren` |
| `labels.forum` | `forum` |
| `labels.dependabotInbox` | `area:harness` |
| `labels.entscheidung` | `status:entscheidung-noetig` |
| `skills.abschluss` | — |
<!-- factory:projektwerte:end -->

Eine **Abnahme-Fix-Runde** hat ein **eigenes Budget** von einer Delta-Runde, ohne Rückfrage, unabhängig vom Review-Cap: der Fix wird gemacht, dann prüft **eine** Delta-Lens auf `<abnahme-head>..HEAD` (Sabotage-Worktree `<praefixe.worktree><nr>-lens-a<n>`) nur Test-Adäquanz und Requirement-Treue (reine Doku: Doku-Brille), danach neuer Nachweis-Commit, erneute Abnahme. Der Fix-Commit trägt `Runde <n>:` (n = bisheriges `runden`); über dem Cap `Zusatzpass: R<k> Abnahme-Fix` (`ablauf-zusatzpass.md`).

Der Pass zählt in `runden` mit; ist das Review-Cap (samt Zusatzpass) dadurch überschritten, trägt die Review-Zeile `abnahmefix=1` (höchstens einmal je PR). Auch ein Fix nur am PR-Text ist ein Durchgang: der neue Nachweis-Commit trägt `runden` ≥ `durchgaenge`, sonst ist „Abnahme-Nachweis“ rot. `abnahmefix=1` deckt nur die Delta-Runde des ersten Abnahme-Fixes; jede weitere Runde (weiterer Abnahme-Fix, Delta-Lens nach CI-Fix) ist ein Zusatzpass (`.agents/skills/review-lenses/ablauf-zusatzpass.md`). Review- und Abnahme-Zusatzpässe zählen gemeinsam, höchstens 3 (`MAX_ZUSATZPAESSE`). Findet die Delta-Lens Blocker, gilt der Weg wie bei jedem Pass (belegt: Zusatzpass, sonst Hand-off). Sollte-Funde der Delta-Lens im Arm `schlank` werden ohne weiteren Pass verworfen (`lens-filter --verwerfen`, Begründung im PR) oder gefixt; ein Fix zieht einen weiteren Pass nach sich, über dem Cap mit `Zusatzpass: R<k> Abnahme-Fix`; ein konvergierter Pass schreibt keine `Runde`-Zeile.
