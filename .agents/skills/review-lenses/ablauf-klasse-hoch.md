# Ablauf: Risikoklasse hoch

Bedingte Datei von `SKILL.md` (Kern: `.agents/skills/review-lenses/SKILL.md`): lies sie, sobald `node scripts/groessenstufe.mjs` in der Zeile `RISIKO` `hoch` meldet (factory#334). Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

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

**Runde 1:** zusätzlich zu den Code-Brillen läuft die Lens `sicherheit` (`brille-sicherheit.md`) auf demselben Patch und demselben Stand, als eigener Subagent. Ihre Plan-Prüfliste ist der Abschnitt „Bedrohungen und Datenflüsse“ des Plans **wörtlich**. Sie zählt als Brille der Runde 1 (`lenses=…,sicherheit`, `blocker=…,sicherheit:<n>`), nicht als eigene Runde oder Zusatzpass.

**Fehlt der Abschnitt** (die Prognose des Planers war nicht hoch, der Plan lautet `ohne`, etwa ein Factory-Sync im Bezieher): der Orchestrator spawnt vor dem Pass `<agenten.planer>` mit `Nur Bedrohungsabschnitt #<nr> · Arbeitsverzeichnis: <worktree> · Pfade: <git diff --name-only origin/main...HEAD>`. Der Umsetzer schreibt den Abschnitt nie selbst, auch nicht bei einem Sync-PR; einziges Ventil ist `<praefixe.commitZeile>Review-Override:` mit Begründung. Liegt `brille-sicherheit.md` noch nicht auf `origin/main` (erster Sync mit dieser Regel im Bezieher), kann die Lens ihre Brille nicht lesen: dieser eine Sync-PR mergt mit `<praefixe.commitZeile>Review-Override: #<nr> Bootstrap Sicherheits-Brille`.

**Ab Runde 2 und bei jeder Delta-Lens** (Fix, Merge, Abnahme-Fix, CI-Fix) läuft `sicherheit` mit, wenn sie in der Vorrunde blockiert hat oder `node scripts/groessenstufe.mjs --pfade <Delta-Pfade>` `RISIKO: hoch` meldet. Wird der Diff erst nach Runde 1 hoch (Wechsel der Diff-Art): voller Satz samt `sicherheit` auf dem vollen Patch.

**Nachweis:** `lenses` und `blocker` der Review-Zeile nennen `sicherheit`, der Nachweis-Commit trägt die Zeile `<praefixe.commitZeile>Bedrohungen:` aus dem Plan wörtlich (Format: docs/agent-harness.md §3a). Ohne beides bleibt `check-review-nachweis` rot.
