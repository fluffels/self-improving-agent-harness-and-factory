# Ablauf: Nachweis nach Konvergenz

Bedingte Datei von `SKILL.md` (Kern: `.agents/skills/review-lenses/SKILL.md`): lies sie, sobald die Review-Schleife konvergiert ist und der Nachweis-Commit folgt. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

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

Sobald konvergiert ist, holt der Orchestrator `origin/main` und mergt es, falls es weitergezogen ist, nochmals ein (Testabgleich wie in `.agents/skills/review-lenses/ablauf-merge-main.md`); ein konfliktfreier Merge braucht keine Lens, ein Konflikt-Merge vor dem Nachweis wird von der Merge-Delta-Lens geprüft, bevor der Nachweis gesetzt wird. Verlangt der Projekt-Block der AGENTS.md (› Gates) Prüfungen außerhalb von `verify` (etwa ein Bundle-Budget), laufen sie nach dem letzten Merge von `main` und vor dem Nachweis-Commit einmal (ein parallel gemergter PR kann das Budget verbraucht haben). Immer dazu `npm run check:size` auf dem gemergten Stand: die CI misst den Merge-Ref mit dem aktuellen `origin/main`, und ein parallel gemergter PR kann eine Datei über die Grenze schieben, die lokal noch passte. Wer ein Budget anhebt, misst neu. Ein Diffsize-Override setzt man erst nach dem Merge von `origin/main` und einer Messung; ist er danach stale, widerruft ihn ein leerer Commit mit der Zeile `<praefixe.commitZeile>Diffsize-Override: #<nr> entfällt` (die jüngste Zeile gilt, kein Umschreiben).

Danach setzt er einen **leeren Nachweis-Commit** mit den Zeilen `<praefixe.commitZeile>Plan:` und `<praefixe.commitZeile>Review:` (Format, Warum und Grenzen: [docs/agent-harness.md › §3a](../../../docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd), nicht hier kopieren). `head` ist der zuletzt reviewte Stand, `runden` die Zahl der Pässe, `lenses` die Brillen des vollen Passes (Runde 1), `blocker` je Brille die Zahl ihrer `[❌ blockierend]`-Findings im ersten Pass (Runde 1), auch 0; ein Zusatzpass über das Cap hinaus steht zusätzlich als `zusatzpass=<anzahl>:<ursache>` in der Zeile. Lokal prüfen mit `node scripts/check-review-nachweis.mjs` (gibt bei Rot die Vorlage aus); die PR-CI erzwingt es als Required-Check. Danach kein Rebase/Amend mehr, sonst liegt `head` nicht mehr im PR.

Bei `RISIKO: hoch` steht zusätzlich die Zeile `<praefixe.commitZeile>Bedrohungen:` aus dem Plan wörtlich im Nachweis-Commit (Format §3a).

**CI-Fix hinter dem Nachweis:** Jeder Nicht-Merge-Commit mit Baumänderung nach `head` (auch ein CI-Fix hinter dem Nachweis-Commit) macht den Check rot: Delta-Lens der betroffenen Brillen auf `<head>..HEAD` (Sabotage-Worktree `<praefixe.worktree><nr>-lens-c<n>`, `n` = laufende Nummer; Zählung wie bei der Merge-Delta-Lens), dann ein neuer leerer Nachweis-Commit mit `head` ≥ Fix; leere Commits (Nachweis, Override-Zeilen) und konfliktfreie Merges bleiben grün.
