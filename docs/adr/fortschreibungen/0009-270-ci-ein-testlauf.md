# Fortschreibung #270 (2026-11-12): Ein Testlauf mit Coverage in der CI

Ergänzt [ADR 0009](../0009-pr-gating-required-checks.md) und [ADR 0026](../0026-sammelticket-gruppen.md): Die CI fährt die Vitest-Suite je Lauf einmal, instrumentiert, statt zweimal. Herkunft: factory#270.

## Kontext: Messwerte (Stand 2026-11-11)

- **CI, 6 grüne Läufe** (`gh run view <id> --json jobs`, Dauer aus `startedAt`/`completedAt`): 3× `push` auf `main` (Run-IDs 43116485399, 43115935622, 43114727968) und 3× PR (43116159103, 43115486900, 43114330491).
  - Job „Tests, Typecheck & Builds“: 119–187 s. Darin „Verify“ 68–109 s und „Coverage-Gate“ 41–64 s (zweite, instrumentierte Suite).
  - Job „Probe-Erstbezug“: 27–38 s (Schritt 14–19 s), Security-Audit 7–13 s, Doku-Aktualität 5–14 s; beide parallel zu `build-test`.
- **Lokal** (macOS, `verifyKompakt`, 54 s gesamt): typecheck 3 s, lint 10 s, test 40 s, alle `check:*` je unter 1 s. Suite 38,96 s ohne und 37,66 s mit `--coverage`: die Instrumentierung kostet lokal nichts Messbares, der zweite Lauf war reiner Doppelaufwand.
- **Gate-Aussage vorher gleich nachher:** Summen aus `coverage/coverage-summary.json` (lines 93,63 % = 17550/18742, branches 91,74 % = 17619/19204, functions 93,6 %, statements 93,33 %), 283 Testdateien; `check:diffcoverage` liest denselben `coverage/lcov.info`. Die Tests stiegen nur um die zwei neuen Wächter (10137 → 10139).

## Entscheidung

- **Mechanismus:** Entscheidung: `coverage.enabled` in `vite.config.ts` hängt an `FACTORY_COVERAGE=1`, gesetzt nur am Verify-Schritt der CI; der Schritt „Coverage-Gate“ entfällt, `check:diffcoverage` läuft danach auf dem Bericht des Verify-Laufs. Weil die Kette in `verify` die eine SSOT bleibt, lokal nichts ändert und weder ein neues npm-Skript noch ein Kern-Skript berührt wird. Verworfen: `verify` auf `test:coverage` umstellen (bremst lokal, bricht die Engung in `verify:changed`). Lokal bleibt `verify:full` unverändert (Env-Zuweisungen in npm-Skripten sind unter Windows nicht portabel); `STANDARD_BEFEHLE.coverage` bleibt für Bezieher-CI und lokalen Gebrauch.
- **Gate-Umfang unverändert:** Floors (`thresholds` `lines: 89`, `branches: 87`) und Diff-Coverage gelten wie zuvor, eine Schwelle sinkt nicht. Ein Floor-Rot erscheint jetzt als roter Schritt „Verify“ mit der Zeile „does not meet global threshold“ am Ende des Logs. Bei einem Testfehler entsteht wie zuvor kein Bericht.
- **`probe-erstbezug` (Gate-Entscheidung):** Entscheidung: läuft weiter auf jedem PR und auf `main`, ohne Pfadfilter, weil der Job parallel in 27–38 s gegen 119–187 s von `build-test` läuft (Wandzeit-Ersparnis 0 s) und ein Pfadfilter auf einem Required Check eine kernrelevante Änderung übersehen könnte (der Sync wirkt auf den ganzen Commit). Er fährt außerdem nicht die Suite der Fabrik, sondern das `verifyKompakt` des Fixture-Bezügers.
- **Typecheck inkrementell:** Entscheidung: nein, weil `tsc` lokal 3 s braucht und die CI ohne Cache läuft (Ersparnis höchstens 3 s plus Zustandsdatei).
- **Lint-Cache:** Entscheidung: nein, weil `eslint --cache` bei typbewussten Regeln nicht verlässlich ist und die Gate-Aussage aufweichte.
- **Tests splitten/sharden:** Entscheidung: nein, weil es den Required-Job „Tests, Typecheck & Builds“ teilte, eine Ruleset-Änderung (Pre-Flight-Stopp) verlangte und die Regel „eine Kette“ bräche; Vitest nutzt in der CI ohnehin alle Kerne.

## Bezieher

Keine Wirkung: nur die Factory-CI ändert sich, `gate-befehl.mjs` und `package.json` bleiben gleich (kein Sync-Doku-Eintrag, keine Bezieher-Migration).

## Re-Evaluierung und Rückweg

- `probe-erstbezug`: neu bewerten, wenn der Job in 3 aufeinanderfolgenden Läufen länger dauert als `build-test`.
- Die Nachher-Zeiten des ersten PR-Laufs stehen als PR-Kommentar zu factory#270 (Erwartung als Hypothese: Job 30–50 s kürzer).
- Rückweg: Env-Zeile und Schalter entfernen, Schritt „Coverage-Gate“ (`node scripts/gate-befehl.mjs coverage`) wieder einfügen; der Wächter in `test/harness/verify-script.test.ts` hält den heutigen Zustand fest.
