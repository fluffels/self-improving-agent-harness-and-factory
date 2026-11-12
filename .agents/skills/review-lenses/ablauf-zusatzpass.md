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
| `skills.abschluss` | `brain-input` |
<!-- factory:projektwerte:end -->

Nach dem Cap fährt der Umsetzer **Zusatzpässe ohne Rückfrage** (Ursache im PR-Text, Nachweis `zusatzpass=<n>:<ursache>`), höchstens 3 (der Lens-Worktree zählt die Runde weiter: `-lens-r4` bis `-lens-r6`), jeden nur bei steigender Evidenz: der Vorpass meldet einen **belegten** Blocker einer **neuen Blocker-Klasse** (Brille plus verletzter Prüfpunkt der Brillen-Datei; neu = in keinem früheren Pass dieses PRs blockiert, derselbe Prüfpunkt an anderer Stelle gilt als bekannt; die Ursache nennt die Klasse) und die Blockerzahl sinkt gegenüber dem Vorpass. **Belegt** heißt: Repro oder Beleg an Test oder Doku (roter Test, fehlender Guard, widersprüchliche oder verwaiste Doku-Stelle); ein Architektur- oder Requirement-Blocker ist nie belegt in diesem Sinn.

Ohne neue Klasse, bei steigender Blockerzahl, unbelegtem Blocker oder ohne tragfähige Lösung: **Hand-off** (Festgefahren) an den Hauptchat statt weiterer Runde, der nach dem Entscheidungsprotokoll entscheidet (`ablauf.md` › `festgefahren`): am Issue das Festgefahren-Label der Projekt-Config (`labels.festgefahren`) setzen, einen konsolidierten Kommentar posten (Blocker, Versuche, Optionen), assigned bleiben; kein PR mit bekannten Blockern.

Review- und Abnahme-Zusatzpässe zählen gemeinsam, höchstens 3 (`MAX_ZUSATZPAESSE` in `scripts/nachweis-lib.mjs`); mehr gibt nur die Maintainerin frei (`<praefixe.commitZeile>Review-Override:` mit Freigabe-Beleg, sonst ist die Review-Zeile rot). Auch eine Delta-Lens nach CI-Fix oder Konflikt-Merge hinter einer bestandenen Abnahme zählt als Pass (Feld `runden` der Review-Zeile + 1, über dem Cap mit Zusatzpass): die CI erzwingt `durchgaenge ≤ runden` (ohne Durchgänge, die nur wegen `ursache=szenario` nicht bestanden).
