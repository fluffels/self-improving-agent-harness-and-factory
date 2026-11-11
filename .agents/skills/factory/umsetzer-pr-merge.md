# Umsetzer: PR bis zum Merge, CI-Fehler und Festgefahren

Bedingte Datei des Umsetzers (Kern: `.claude/agents/factory-umsetzer.md`): lies sie, sobald du in Schritt 5 `main` einmergen musst, ein Fix-Commit nach dem Nachweis-Commit nötig ist oder `pr-warten` mit Exit 1 oder 3 antwortet. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

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

**Merge von `main` (Schritt 5):** Verschärft der Diff ein Gate oder Schema (Pflichtfeld, strengere Regel), merge direkt vor dem Auto-Merge `origin/main` ein und fahre das betroffene Gate erneut: ein parallel gemergter PR kann einen Verstoß gegen die Verschärfung mitbringen, den die CI auf dem alten Stand nicht sah (quellprojekt#1449). Nach jedem solchen Merge einmal `node scripts/gate-befehl.mjs verifyKompakt` voll, nicht nur den roten Check: Wächter mit Baseline je Datei reagieren auf parallel Gemergtes.

**Nachweis-Folgen:** Ein Fix-Commit mit Baumänderung nach dem Nachweis-Commit (CI-Fix) macht `check-review-nachweis` rot: Delta-Lens der betroffenen Brillen auf `<head>..HEAD`, dann ein neuer leerer Nachweis-Commit mit `head` ≥ Fix (`review-lenses` › Nachweis nach Konvergenz); vor dem Push `node scripts/check-review-nachweis.mjs` lokal grün, dann **ein** Push (Fix und Nachweis zusammen, sonst steht der Check zwischendurch rot und ein `festgefahren`-Zähler läuft mit). Ein Merge von `main` mit Konflikt nach dem Review-head macht den Review-Nachweis rot („Konflikt-Merge … nach dem Review: Auflösung per Delta-Lens prüfen“), und eine Abnahme, die vor dem neuen Review-head liegt, den Abnahme-Nachweis („Abnahme: head=… ist kein Nachfahre des Review-head …“): nach einem Konflikt-Merge also vor dem Push Delta-Review der Auflösung, neuer Nachweis und erneute Abnahme. Liegt die bestandene Abnahme schon hinter dem alten `head`, braucht der neue Stand einen neuen Durchgang: `gh pr ready <pr> --undo`, `gh pr merge <pr> --disable-auto`, `ERGEBNIS: abnahme`.

**CI-Fehler und `pr-warten`:** Bei Exit 1 mit `HINWEIS … CANCELLED ohne laufenden Geschwister-Lauf` (ein durch Concurrency abgebrochener Duplikat-Lauf hält den PR trotz grünem Pflicht-Check auf BLOCKED): kein `gh run rerun` (ein Rerun behält Ereignis samt `draft`), stattdessen leerer Commit mit Push (quellprojekt#1327). Sonst bei Exit 1: Run-ID aus der URL der `ROT`-Zeile, `gh run view <run-id> --log-failed | tail -n 80` (ohne Run-ID `gh pr checks <nr>`), fixen und pushen. Bei Exit 3 `KONFLIKT`: `origin/main` einmergen (Schritt 5); `GRÜN OHNE AUTO-MERGE`: `gh pr merge <nr> --squash --delete-branch --auto` setzen; `GH-FEHLER`: einmal erneut, dann `entscheidung-noetig`; Exit 3 kann auch ein Aufruf-Fehler sein (unbekanntes Flag, Flag ohne Wert, doppeltes Flag, falsche PR-Nummer; Meldung auf stderr): den Aufruf korrigieren. Nach 6 Aufrufen ohne Fortschritt melde `entscheidung-noetig`. Wartest du nicht blockierend (Pause über 5 min), läuft der Prompt-Cache ab und der ganze Kontext wird neu geschrieben ([Umsetzer-Kontext](../../../docs/model-routing.md#umsetzer-kontext)).

**Festgefahren:** `festgefahren` bei offenem PR gilt erst nach dem Protokoll (AGENTS.md § Festgefahren-Protokoll: drei Fix-Versuche, PR-Kommentar, Label `<labels.festgefahren>`). Steckst du in der Review-Schleife am Cap statt an der CI, setze `FESTGEFAHREN: review`, ohne die Zeile gilt `ci`; **jedes** `festgefahren` setzt das Label (`labels.festgefahren`): bei `FESTGEFAHREN: review` mit offenem PR am PR (`gh pr edit <pr> --add-label <labels.festgefahren>`), ohne PR am Issue (`gh issue edit <nr> --add-label <labels.festgefahren>`), sonst nähme die Claim-Prüfung das Ticket wieder auf.

**Hooks:** Zwei Hooks prüfen den Bericht (`scripts/umsetzer-abschluss.mjs`, Regeln im Kopf der Datei): ein `PreToolUse`-Wächter auf `SubagentHandback` verweigert vor der Zustellung einen Bericht ohne gültiges Format und prüft den PR-Stand; der `SubagentStop`-Hook prüft nach der Zustellung den PR-Stand.
