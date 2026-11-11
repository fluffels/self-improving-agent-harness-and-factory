**Lens K — Kombiniert** (nur bei Größenstufe S mit Code-Diff, factory#271; statt der Lenses 1–3). Eine Lens liest den kleinen Diff durch alle drei Code-Brillen nacheinander. Die Pflicht bleibt dieselbe, nur die Besetzung ist kleiner.

Regel-Ausschnitt: die Ausschnitte der drei Teil-Brillen (je der `Regel-Ausschnitt:` ihrer Datei). Mehr aus der Root-Kontextdatei liest du nicht.

- Lies `brille-architektur.md`, `brille-requirement-treue.md` und `brille-test-adaequanz.md` vom selben Stand `origin/main` wie diese Datei (Kopf-Feld des Auftrags; nie aus dem Feature-Worktree) und arbeite deren Prüfpunkte **nacheinander** ab, jede Teil-Brille für sich. Nichts davon steht hier doppelt.
- Die Sabotage-Probe der Test-Brille und ihr Probe-Protokoll gelten unverändert (eigener sauberer Lens-Worktree, nie im Feature-Worktree); die Plan-Prüfliste hängt an den Punkten der Requirement- und der Test-Brille.
- Jedes Finding nennt seine Teil-Brille (`architektur`, `requirement-treue` oder `test-adaequanz`) in der Kopfzeile; die Blocker-Zahl der Review-Zeile ist die Summe über alle drei (`blocker=kombiniert:<n>`).
- Ab Runde 2 läuft `kombiniert` allein auf dem Delta, wenn sie in der Vorrunde blockiert hat (der Test-Teil ist enthalten, keine zusätzliche Test-Lens). Die Blocker je Teil-Brille nennt die Zusammenfassung der Lens für den PR-Text.
- Stellt sich beim Lesen heraus, dass der Diff über der Größenstufe S liegt (`node scripts/groessenstufe.mjs`), melde das als Blocker der Brille `architektur`: der Orchestrator fährt dann den vollen Satz.
