# Ablauf: Zusatzpässe nach dem Review-Cap

Bedingte Datei von `SKILL.md` (Kern: `.agents/skills/review-lenses/SKILL.md`): lies sie, sobald nach dem Cap (2 Fix-Runden, höchstens 3 Pässe) noch Blocker bleiben. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

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

Nach dem Cap fährt der Umsetzer **Zusatzpässe ohne Rückfrage** (Nachweis `zusatzpass=<n>:<ursache>`), höchstens 3 (Worktree `-lens-r4-` bis `-lens-r6-`), nur bei steigender Evidenz: der Vorpass meldet einen **belegten** `❌ blockierend`-Fund einer **neuen Blocker-Klasse** (Brille plus Prüfpunkt; neu = in keinem früheren Pass blockiert) und die Blockerzahl sinkt. `🔶 sollte` und Hinweise rechtfertigen nie einen Zusatzpass. **Belegt** heißt Repro oder Beleg an Test oder Doku; Architektur- und Requirement-Blocker sind nie belegt.

**Erzwingung (factory#534):** Ein Auftrag mit Worktree `-lens-r<k>-` (ab Pass 4 im Prompt nennen), k > 3, trägt im Kopf `Zusatzpass: <Brille>:<Prüfpunkt> · Entscheidung: <X>, weil <Y>` (Brille: Schlüssel oder Name), sonst weist ihn der Lens-Auftrag-Guard ab (Delta-Worktrees `m/a/c` bleiben offen). Jeder Pass über dem Cap, auch Abnahme-Fix, CI-Fix- und Merge-Delta, braucht eine Commit-Zeile `<praefixe.commitZeile>Zusatzpass: R<k> <Ursache> — Entscheidung: <X>, weil <Y>` (Ursache `Zusatzpass`, `Abnahme-Fix`, `CI-Fix-Delta`, `Merge-Delta`; k = 4 bis `runden`), und `runden` ≥ höchste `Runde <n>:` + 1, sonst rot.

Ohne neue Klasse: **Hand-off** an den Hauptchat statt weiterer Runde: Label `labels.festgefahren` am Issue, ein konsolidierter Kommentar (Blocker, Versuche, Optionen), assigned bleiben.

Review- und Abnahme-Zusatzpässe zählen gemeinsam, höchstens 3 (`MAX_ZUSATZPAESSE`); mehr gibt nur die Maintainerin frei (`<praefixe.commitZeile>Review-Override:` mit Freigabe-Beleg). Auch eine Delta-Lens nach CI-Fix oder Konflikt-Merge hinter einer bestandenen Abnahme zählt als Pass (`runden` + 1): die CI erzwingt `durchgaenge ≤ runden`.
