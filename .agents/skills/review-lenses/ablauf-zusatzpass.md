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

Nach dem Cap fährt der Umsetzer **Zusatzpässe ohne Rückfrage** (Ursache im PR-Text, Nachweis `zusatzpass=<n>:<ursache>`), höchstens 3 (der Lens-Worktree zählt weiter: `-lens-r4-<brille>` bis `-lens-r6-<brille>`), jeden nur bei steigender Evidenz: der Vorpass meldet einen **belegten** Blocker einer **neuen Blocker-Klasse** (Brille plus verletzter Prüfpunkt der Brillen-Datei; neu = in keinem früheren Pass dieses PRs blockiert, derselbe Prüfpunkt an anderer Stelle gilt als bekannt; die Ursache nennt die Klasse) und die Blockerzahl sinkt gegenüber dem Vorpass. **Belegt** heißt: Repro oder Beleg an Test oder Doku (roter Test, fehlender Guard, widersprüchliche oder verwaiste Doku); ein Architektur- oder Requirement-Blocker ist nie belegt in diesem Sinn.

**Zulässig ist ein Review-Zusatzpass nur mit einem Vorpass-Fund der Schwere `❌ blockierend`** (factory#534): `🔶 sollte` und `⚠️ Hinweis` rechtfertigen keinen Zusatzpass, auch nicht im Arm `vollablauf`. Das prüft keine Maschine (die Schwere des Vorpasses steht in keinem für Guard oder CI lesbaren Artefakt), die Entscheidung im Kopf-Feld und in der Commit-Zeile nennt den Fund.

**Technisch erzwungen (factory#534):** Ein Lens-Auftrag mit Worktree `-lens-r<k>-` und k über 3 trägt im Kopf das Feld `Zusatzpass: <Brille>:<Prüfpunkt> · Entscheidung: <X>, weil <Y>` (Brille und Prüfpunkt der neuen Blocker-Klasse); fehlt es oder ist ein Teil leer oder ein Platzhalter, weist `scripts/lens-auftrag-guard.mjs` den Spawn ab (Regel R6). Die Delta-Worktrees `-lens-m/a/c<n>` sperrt der Guard nicht (bewusste Grenze). Jeder Pass über dem Cap, auch ein Abnahme-Fix-, CI-Fix- oder Merge-Delta, trägt außerdem je eine Commit-Zeile `<praefixe.commitZeile>Zusatzpass: R<k> <Ursache> — Entscheidung: <X>, weil <Y>` (Ursache: `Zusatzpass`, `Abnahme-Fix`, `CI-Fix-Delta` oder `Merge-Delta`; k von 4 bis `runden`, je einmal), sonst ist `check-review-nachweis` rot. Dieselbe Prüfung verlangt `runden` ≥ höchste Commit-Zeile `Runde <n>:` + 1.

Ohne neue Klasse, bei steigender Blockerzahl, unbelegtem Blocker oder ohne tragfähige Lösung: **Hand-off** (Festgefahren) an den Hauptchat statt weiterer Runde, der nach dem Entscheidungsprotokoll entscheidet (`ablauf.md` › `festgefahren`): am Issue das Festgefahren-Label der Projekt-Config (`labels.festgefahren`) setzen, einen konsolidierten Kommentar posten (Blocker, Versuche, Optionen), assigned bleiben; kein PR mit bekannten Blockern.

Review- und Abnahme-Zusatzpässe zählen gemeinsam, höchstens 3 (`MAX_ZUSATZPAESSE` in `scripts/nachweis-lib.mjs`); mehr gibt nur die Maintainerin frei (`<praefixe.commitZeile>Review-Override:` mit Freigabe-Beleg, sonst ist die Review-Zeile rot). Auch eine Delta-Lens nach CI-Fix oder Konflikt-Merge hinter einer bestandenen Abnahme zählt als Pass (Feld `runden` der Review-Zeile + 1, über dem Cap mit Zusatzpass): die CI erzwingt `durchgaenge ≤ runden` (ohne `szenario`-Durchgänge).
