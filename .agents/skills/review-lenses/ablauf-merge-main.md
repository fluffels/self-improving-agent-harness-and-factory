# Ablauf: Nach jedem Merge von `main`

Bedingte Datei von `SKILL.md` (Kern: `.agents/skills/review-lenses/SKILL.md`): lies sie, sobald `origin/main` in den Branch gemergt wird. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

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

Gilt für jeden Merge von `origin/main` in den Branch (Stufe 0, echter Konflikt, Merge vor dem Auto-Merge bei einer Gate-Verschärfung); `M` = Merge-Commit. `node scripts/check-abnahme-nachweis.mjs` zeigt lokal (ohne PR-Umgebung) einen Konflikt-Merge hinter der Abnahme.

**Delta-Rechnung (Review-Staffel):** Ein Merge von `main` in den Branch ist kein Fix-Pass. Konfliktfrei zählt er nicht als Runde; das Delta der nächsten Runde sind nur die Fixes (`git diff <Vorrunden-HEAD>..<M>^1` plus `git diff <M>..HEAD`). Mit Konflikt kommt die Auflösung (`git show --remerge-diff --format= <M>`) ins Delta und zählt wie ein Fix, nicht wie ein voller Pass. Rebase mitten in der Schleife vermeiden (er erzwingt den vollen Satz und macht den Nachweis-`head` ungültig): `main` vor Runde 1 einmergen (Stufe 0, erster Punkt), den Nachweis direkt nach der Konvergenz setzen und pushen. Danach nur bei einem echten Konflikt erneut einmergen (`gh pr view <nr> --json mergeable`): das Ruleset verlangt keinen aktuellen Stand. Begründung: [docs/agent-harness.md › §3a](../../../docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd).

**Zuerst der Testabgleich (quellprojekt#1579):** direkt nach dem Merge, bei einem Konflikt vor dem Merge-Commit, `node scripts/merge-testabgleich.mjs`. Exit 2 heißt kein Merge, nichts zu prüfen (z.B. nach „Already up to date“, wenn HEAD nicht auf einem Merge-Commit steht; steht HEAD auf einem älteren Merge-Commit, wird dieser erneut geprüft, Exit 0 oder 1). Exit 1 heißt, ein Test von `main` (oder vom Branch) fehlt im Ergebnis, ohne dass die andere Seite ihn bewusst entfernt hat: wieder einfügen, bevor weitergemacht wird. Sonst fällt ein stillschweigend verlorener Test erst der Test-Lens per Sabotage auf (Delta-Pass: drei Lenses plus neuer Nachweis-Commit). Meldet das Skript zusätzlich „Wächter-Lauf nötig: node scripts/gate-befehl.mjs testGezielt test/harness“ (beide Seiten haben Dateien unter `.claude/`, `.github/`, `docs/`, `test/harness/`, `README.md` oder eine `AGENTS.md` geändert, auch verschiedene; Wächter über andere Pfade erkennt es nicht), diesen Lauf vor dem Weitermachen fahren: ein Wächter kann nur an der Kombination beider Seiten rot sein. In Stufe 0 deckt das folgende `verify:kompakt` diesen Lauf ab (sein Testlauf schließt `test/harness` ein), dort entfällt er.

1. **Verschobener Code:** Hat der Branch Funktionen aus einer Datei in neue Dateien verschoben, landen parallele `main`-Änderungen an ihnen in der alten Datei oder fallen bei der Auflösung weg. Je Quell-Datei `<basis>` = `git merge-base <M>^1 <M>^2`, dann `git diff <basis> <M>^2 -- <alte datei>` lesen (beim Auflösen vor dem Commit `git merge-base HEAD MERGE_HEAD` und `MERGE_HEAD` statt `<M>^2`). Jede Änderung an einer verschobenen Funktion in die neue Datei übertragen, betroffene Tests gezielt fahren. Die Übertragung zählt als Fix (vor Runde 1 Teil des vollen Patches, sonst Delta der nächsten Runde bzw. der Merge-Delta-Lens).
2. **Konflikt-Merge nach dem Nachweis-Commit:** Ist `git show --remerge-diff --format= <M>` nicht leer, ist der Nachweis-Check rot (Warum: §3a). Weg:
   1. Einmal `node scripts/gate-befehl.mjs verifyKompakt` (Short-Circuit-Regel wie in Stufe 0).
   2. Patch schreiben: `git show --remerge-diff --format= <M> > "$TMP/<praefixe.worktree><nr>-merge.patch"`, bei späteren Commits `git diff <M>..HEAD` anhängen.
   3. Delta-Lens: reine `*.md`-Auflösung eine Doku-Brille, sonst die drei Code-Brillen (deren Sabotage-Worktree heißt `<praefixe.worktree><nr>-lens-m<n>`, `n` = laufende Merge-Nummer); je mit `Patch:`, `Delta-Patch:`, `erwarteter HEAD:` und dem Auftrag „prüfe die Konflikt-Auflösung“, Spawn-Vorlage in `.agents/skills/review-lenses/SKILL.md`. Blockiert eine Brille: fixen, dieselbe Brille einmal auf dem Fix-Delta; blockiert sie weiter, Hand-off `festgefahren`.
   4. Neuer leerer Nachweis-Commit hinter dem Merge: `<praefixe.commitZeile>Plan:` unverändert, `<praefixe.commitZeile>Review:` mit `head` = zuletzt reviewter Stand (≥ `M`), `runden`, `lenses`, `blocker` wie im bisherigen Nachweis (die Merge-Lens ist kein Pass der Schleife; hinter einer bestandenen Abnahme zählt sie als Pass, `runden` + 1). Lokal `node scripts/check-review-nachweis.mjs`, im PR-Text nennen, dass der Merge nach dem Review kam.
3. **Doku-Konflikt in einer listenförmigen Modul-Seite (`docs/module/*.md`):** Vor dem Auflösen lesen, was `main` wirklich geändert hat: `git diff $(git merge-base HEAD MERGE_HEAD) MERGE_HEAD -- <datei>`. Die von `main` geänderten Einträge übernehmen, die eigenen darauf neu anwenden (nie blind „ours“ oder „theirs“ wählen: dabei gehen Zeilen der Gegenseite still verloren). Eine solche Seite führt je Listeneintrag ein Modul mit Leerzeile dazwischen, damit Änderungen an Nachbarn konfliktfrei mergen. Danach `npm run check:docmap` und `npm run check:docdrift`.
4. **Breitensuche vor der Merge-Delta-Lens (auch nach konfliktfreiem Merge):** Entfernt oder benennt der Branch Namen oder Pfade um (Datei, Funktion, Skript, Label, Regel-Begriff), wiederhole vor der Delta-Lens die Breitensuche des Tickets (`grep` über das ganze Repo nach dem alten Namen) auf dem **gemergten** Stand: `main` kann neue Verweise darauf mitbringen, die die Delta-Lens nur zufällig findet. Funde sind Fix des Branches und gehören ins Delta.
