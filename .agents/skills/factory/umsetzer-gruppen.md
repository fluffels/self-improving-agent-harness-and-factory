# Umsetzer: Gruppen

Bedingte Datei des Umsetzers (Kern: `.claude/agents/factory-umsetzer.md`): lies sie, sobald der Plan einen Block `GRUPPEN` hat. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

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

**Gruppen (quellprojekt#1647, ADR 0026):** Hat der Plan einen Block `GRUPPEN` (`GRUPPE <k>/<n> <Name>: L<x>, … | Dateien: … | nach: <k|->`), startest du nach Worktree und Installation (`node scripts/gate-befehl.mjs install`) je Gruppe in Plan-Reihenfolge einen frischen Gruppen-Umsetzer (`Agent({ subagent_type: "<agenten.gruppe>", … })`, ohne `isolation`, ein Worktree für alle). Prompt: Zeile 1 `GRUPPE <k>/<n> #<nr> <Name>`, Zeile 2 `Ticket: #<nr> <Titel>`, dann `Worktree: <abs>`, `Branch: <name>`, die Plan-Kopfzeile mit dem gemeinsamen Abschnitt und nur dem Abschnitt der Gruppe, zuletzt die Berichte der Vorgruppen (keine Chat-Historie). Die Gruppen laufen nacheinander; übergeben wird nur über Commits und Bericht. Bei einem großen Sammelticket mergst du nach der letzten Gruppe und vor Stufe 0 einmal `origin/main` ein (Konflikte in Kern-Dateien löst du ohne Projektliterale auf). Nach der letzten Gruppe, vor dem Review, nennt dein Commit die Gesamtzahl `Guard-Liste: <n> Anker` des Branch-Diffs (`node scripts/anker-liste.mjs`); `guardListeWarnung` wertet die jüngste Zeile. Die `ENTSCHEIDUNGEN`, `ABWEICHUNGEN` (auch in den Auftrag der Requirement-Treue-Lens) und die `SELBSTCHECK`-Zeile jeder Gruppe übernimmst du in den PR-Text („Entscheidung: X, weil Y“; die Blöcke aus den Gruppen-Commits holst du per `git log origin/main..HEAD --format=%B`). Danach liest du die Kommentare erneut (ein Nachzügler wird eine Zeile im Folge-Sammelticket, nie Teil dieses PR) und fährst verify, Review, PR und Merge wie sonst; Fixes aus verify und Lenses machst du selbst und gezielt. Meldet eine Gruppe `entscheidung-noetig`, gibst du das über den normalen Hand-off weiter. Scheitert der Spawn (Typ unbekannt, Spawn-Tiefe), setzt du die Gruppen selbst nacheinander um. **Planwechsel bei laufender Gruppe (factory#283):** kein `TaskStop` am Gruppen-Umsetzer (nur der Besitzer darf; der Hauptchat schickt dir den neuen Plan per `SendMessage`). Setze die Marke `touch "$(git -C "<worktree>" rev-parse --path-format=absolute --git-path gruppe-stopp)"`, warte auf den Bericht der Gruppe, sichere Ungesichertes per `git -C <worktree> stash push -u -m "gruppe <k> verworfen"`, nimm Commits verworfener Zeilen per `git revert --no-edit <sha>` zurück, entferne die Marke (`rm -f` auf denselben Pfad) und starte dann die Gruppen des neuen Plans. Übernimmst du einen vorhandenen Worktree (Schritt 1, Fortsetzung) und liegt dort eine verwaiste Marke (der Hauptchat setzte sie nach einem `TaskStop` des Vorgängers), warte, bis der Worktree ruht: `git -C <worktree> status --porcelain` und `git -C <worktree> diff HEAD` sind bei zwei Messungen im Abstand von 5 Minuten gleich (bei gesetzter Marke committet ein noch laufender Gruppen-Umsetzer nie, ändert aber bis zu seiner nächsten Prüfung noch Dateien), und entferne sie vor der ersten Gruppe mit `rm -f` auf denselben Pfad.

**Pflege-Marker (Schritt 3):** Bei Gruppen setzt der Umsetzer den Schritt samt Markern einmal nach der letzten Gruppe; Gruppen-Umsetzer setzen keine Marker.
