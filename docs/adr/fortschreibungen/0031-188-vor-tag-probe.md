# Fortschreibung #188 (2026-11-05): Vor-Tag-Probe je Bezieher

Ergänzt [ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md): vor dem Tag läuft jeder gelistete Bezieher lesend gegen den Stand. Herkunft: das Epic Java-Profil (factory#171), Teil 8; die Akzeptanzkriterien verlangen, dass „rot“ eines Beziehers das Taggen verhindert.

## Kontext

- **Lücke:** der Tag-Takt prüfte nur den Probe-Erstbezug (Fixture im Scratch). Ob ein echter Bezieher mit dem neuen Stand grün bleibt, zeigte erst sein Factory-Update nach dem Tag; ein gesetzter Tag wird nie verschoben, ein Fehler kostet also einen Patch-Tag.
- **Grenze von ADR 0031:** Punkt 1 (die Fabrik schreibt nie in einen Bezieher) steht. Ein Cross-Repo-CI scheidet aus: es bräuchte ein Secret mit Zugriff auf fremde Repos.

## Optionen

- **A: Klon im Scratch, lesend (gewählt).** Ein Mensch oder Agent klont den Bezieher (öffentlich oder mit eigenem Zugang) in einen Scratch-Ordner, entfernt dort `origin`, synct aus einem ebenfalls lokalen Quell-Klon mit lokalem Tag fährt die mechanischen Update-Schritte und dann dessen `verify`. Es entsteht nichts im Bezieher-Repo.
- **B: Cross-Repo-Workflow mit Secret.** Verworfen wie in ADR 0031: ein Token mit Zugriff auf fremde Repos, das zudem die Betriebsart für eigene und fremde Bezieher trennt.
- **C: nichts tun.** Verworfen: der Fehler zeigte sich sonst erst nach dem Tag.

## Entscheidung

Entscheidung: Option A, weil Punkt 1 der ADR (kein Schreibzugriff) unberührt bleibt, ein Scratch-Klon nicht der Checkout des Beziehers ist und kein Secret nötig ist. Wächter `test/tag-takt.test.ts` verbietet weiter jeden Schreibweg (Push, PR, Issue, `--repo`, Workflow-Aufruf, Cross-Repo-Token); gestrichen wurde nur das Verbot „Trockenlauf-Sync je Bezieher“, weil genau das jetzt lesend erlaubt ist.

- **Liste:** der optionale Schlüssel `bezieher` der Projekt-Config (`owner/name`, ohne Doppelte, ohne das eigene Repo; `bezieherAus`), nur in der Fabrik wirksam; der Kern nennt keinen Namen.
- **Ablauf:** die Checkliste des Tag-Tickets enthält je Bezieher die Befehle und eine Zeile (`Probe ausstehend`); `--entwurf --trocken` ist nur die Vorschau (Exit ≠ 0 ist ein Blocker), `verify` ist erst nach dem Sync mit lokalem Tag grün, denn nach `--entwurf` ist es per Konstruktion rot (Drift-Gate ohne Tag, Doku-Links ohne Anker-Stubs).
- **Bedeutung von „grün“ (Entscheidung der Maintainerin, Probe-Lauf 2026-11-05):** ein Sync mit Tag macht keinen Bezieher grün; danach braucht jeder Bezieher die mechanischen Update-Schritte (`lint:prune`, `projektwerte --write`, `docs:gen`, `check:factorylinks --schreiben`), die die Probe vor `verify` fährt. „Grün“ heißt: kein Rot durch Factory-Besitz. Rest-Rot nur im Projekt (eigene Docs, Projektkopien von Kern-Tests, Projekt-Block) ist ein Befund bzw. eine Bezieher-Migration; Rot durch Factory-Besitz (etwa das Kontext-Budget nach dem Sync) ist ein benannter Blocker für den nächsten Tag (Pre-Flight); er steht als Sammelticket-Zeile „Gate-Lücke“ im Harness-Sammelticket, nicht als eigenes Ticket (AGENTS.md: Harness-Befunde sind Zeilen).
- **Ergebnis:** `node scripts/tag-takt.mjs --probe <owner/name>=<exit>` je Bezieher (0 = kein Rot durch Factory-Besitz, sonst ≠ 0 nach dem Urteil der Probe) gibt die Checkliste aus und endet mit Exit 1 bei einem Blocker oder einem Bezieher ohne Ergebnis (fail-closed), mit Exit 2 bei einem Aufruf- oder Config-Fehler. `--probe` wirkt nur in der Fabrik: in einem Bezieher (Sync-Stand vorhanden) tut es nichts.
- **Migration:** die Commit-Zeile `Bezieher-Migration` eines Besitz-PRs landet wie bisher im Tag-Ticket; ein Bezieher mit neuem Konfig-Bedarf (etwa das Java-Profil) steht damit im Tag-Ticket.

## Folgen

- **Vertrauen:** `install` und `verify` im Klon führen Bezieher-Code aus (npm-Skripte, Tests). Die Liste gehört nur Bezieher, deren Code die Maintainerin vertraut.
- **Kein Automat:** die Ergebnisse trägt der Mensch oder Agent ein; die Checkliste ist die Quelle. Neu bewerten ab mehr als drei gelisteten Bezieherinnen oder wenn ein Bezieher ein Schreibrecht für einen Runner anbietet.
- **Grenze:** die Probe belegt den Stand zum Zeitpunkt des Laufs; ein Bezieher mit offenem Branch oder lokalen Änderungen wird nicht abgebildet.

## Nachtrag factory#215 (2026-11-06): Stellvertreter je Profil, Projekt-Rest, Haken

- **Stellvertreter je Profil:** die Probe prüft nur Profile, für die es einen lesbaren Bezieher gibt. JS/TS: der Probe-Erstbezug und die gelisteten eigenen Bezieher (beide JS/TS; Profile der Bezieher nur lesend per `gh api repos/<r>/languages`, nie namentlich in der Doku). Java: keiner; belegt ist es nur durch den einmaligen Probe-Lauf (factory#187, [Java-Profil](../../harness-transfer.md#java-profil)). Python: keiner; es gibt nur die Werkzeugtabelle der Transfer-Doku. Ein Java- oder Python-Rot zeigt sich also erst beim ersten echten Bezieher dieses Profils; die Lücke führt factory#224 (synthetischer Bezieher je Profil im Tag-Takt).
- **Projekt-Rest (L5):** `--probe <owner/name>=rest` meldet „grün mit Projekt-Rest“ (Exit 0, im Log „als Befund festhalten“): Rot nur im Projekt des Beziehers ist kein Blocker, muss aber als Befund bzw. Bezieher-Migration festgehalten werden; kein Ersatz für ein fehlendes Ergebnis. Geändert in factory#220: meldet der Sync nur `Kontextbudget knapp` (eine Warnung, kein Rot), bleibt das Ergebnis 0; die Warnung ist ein Befund, kein `=rest`.
- **Repo-Schreibweise (L3):** `--probe` gleicht Repos ohne Groß-/Kleinschreibung ab (`gleichesRepo`), ordnet unter dem Namen der Config zu und erkennt Dubletten in anderer Schreibung (Exit 2).
- **Haken (L4):** ein Takt-Lauf übernimmt die Haken des offenen Tag-Tickets (`uebernimmHaken`): eine Zeile, die vorher abgehakt war und im neuen Body textgleich vorkommt, bleibt abgehakt; geänderter Text verliert den Haken.
- **Rückmeldungen (L6):** eine Checklistenzeile verlangt die Sichtung der Rückmeldungen fremder Bezieher über die Meldestelle, je Auffälligkeit eine Sammelticket-Zeile „Gate-Lücke“.

## Nachtrag factory#234 (2026-11-10): Probe-Erstbezug in der CI

- **Lücke:** der Trockenlauf der Checkliste (`--entwurf --trocken`) lief von Hand und zeigte nur die Vorschau, nicht ein volles `verifyKompakt`; ein Kern-Budget-Überschuss oder ein toter Kern-Verweis fiel erst im ersten echten Bezieher auf.
- **Entscheidung:** `scripts/probe-erstbezug.mjs` ersetzt den Handschritt und läuft als CI-Job `Probe-Erstbezug` (`ci.yml`): Fixture-Projekt mit `AGENTS.md` (Kern-Marker, Füll-Block in Größe von `PROJEKT_BLOCK_RAUM`), Sync aus einem lokalen Klon mit lokalem Tag, mechanische Update-Schritte, `verifyKompakt`. Jeder Fund ist rot, eine leere Ergebnisliste nie grün. `PROJEKT_BLOCK_RAUM` ist seitdem lückenlos (`KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM` = Gesamtbudget), sonst ließe sich der Negativfall „Kern ein Zeichen über dem Budget“ bei vollem Raum nie auslösen.
- **Wirkung:** der Job ist kein Required Check (eine Ruleset-Änderung ist ein Pre-Flight-Stopp); Rot wirkt über den Blocker „CI des Commits rot“ im Tag-Ticket (`ciCheckliste`) und den Alarm auf `main` (`alarm-red-main`).
- **Grenze:** er ersetzt keinen echten Bezieher (keine echten Projekt-Blöcke, kein Projekt-Eigenes, nur JS/TS; andere Profile: factory#224). Die Sync-Warnung `Kontextbudget knapp` ist kein Fund.
