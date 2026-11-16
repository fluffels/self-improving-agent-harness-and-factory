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

Der Pass zählt in `runden` mit; ist das Review-Cap (samt Zusatzpass) dadurch überschritten, trägt die Review-Zeile `abnahmefix=1`. Auch ein Fix nur am PR-Text ist ein Durchgang: der neue Nachweis-Commit trägt `runden` ≥ `durchgaenge`, sonst ist „Abnahme-Nachweis“ rot. `abnahmefix=1` deckt nur die erste Delta-Runde; jede weitere (Abnahme-Fix, Delta-Lens nach CI-Fix) ist ein Zusatzpass (`ablauf-zusatzpass.md`), zusammen höchstens 3 (`MAX_ZUSATZPAESSE`). Sollte-Funde im Arm `schlank`: verwerfen (`lens-filter --verwerfen`, Begründung im PR) oder fixen; ein Fix braucht einen weiteren Pass (über dem Cap `Zusatzpass: R<k> Abnahme-Fix`); ein konvergierter Pass schreibt keine `Runde`-Zeile.
