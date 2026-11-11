# Fortschreibung #348 (2026-11-11): Bot-Konto und Pflicht-Review-Liste, Entscheidung Status quo

Ergänzt [ADR 0014](../0014-leitplanken-ohne-label-riegel.md); Re-Evaluierungs-Kriterien dort. Herkunft: factory#279 (Bot-Identität), Teil 1/3 in factory#348.

- **Entscheidung: Status quo, weil Zweitidentität, Anonymität und Pflege mehr kosten, als die Garantie bringt, und ADR 0014 das Risiko per Audit-Kommentar und Revert abdeckt** (Pre-Flight-Antwort der Maintainerin, 2026-11-11: kein anonymes Zweitkonto vorhanden). Teil 2/3 (factory#349) und 3/3 (factory#350) entfallen.

## Optionen (Belege abgerufen 2026-11-11)

- **GitHub App.** Der Installations-Token läuft ab („The installation access token will expire after 1 hour.“, [Doku](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)); lange Agentenläufe brauchen Erneuerung und einen privaten Schlüssel auf der Maschine. Projects: die Doku nennt App-Rechte nur für Organisations- und Repository-Projects („You can control your app's permission to organization projects and to repository projects.“), für User-Projects empfiehlt sie ein PAT („personal access token (recommended for user projects)“, [Doku](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/automating-projects-using-actions)). Ein wörtlicher Satz „Apps können keine User-Projects verwalten“ wurde nicht gefunden; der Schluss ist indirekt. Entscheidung: verworfen, weil das Board an einem User-Konto hängt und der Token-Umlauf zusätzliche Pflege kostet; neu bewerten nach factory#69 (Organisations-Umzug).
- **Bot-Konto.** Die [GitHub-AGB](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service) („Account Requirements“) erlauben ein Maschinenkonto, das „set up by an individual human who accepts the Terms …, provides a valid email address, and is responsible for its actions“ ist, höchstens „one free machine account in addition to your free Personal Account“. Es braucht neutralen Namen, eigene Mail, 2FA, Collaborator-Einladung mit Schreibrecht und Board-Zugriff. Entscheidung: verworfen, weil die Maintainerin kein anonymes Zweitkonto hat und eines anzulegen die Anonymitätsregel (AGENTS.md) belastet.
- **Status quo.** Leitplanken-Diffs mergt der Agent selbst, danach der Audit-Kommentar „🛡️ Leitplanken-Änderung selbst gemergt“ mit *was*, *warum*, *wie reverten* (ADR 0014); Rückweg ist `git revert`. Entscheidung: bleibt.

## Pflicht-Review-Liste (kleine, eine Quelle)

Die Gruppe `pflichtReview` in `.github/protected-paths.json` führt höchstens 4 Pfade: `/.github/CODEOWNERS`, `/.github/workflows/`, `/.claude/settings.json`, `/.mcp.json`. `.github/CODEOWNERS` spiegelt genau diese Gruppe; ohne die Gruppe spiegelt es wie bisher die ganze Schutzliste (Bezieher: Anleitung statt Zwang, Funktion `pflichtReviewMuster` in `scripts/besitz-extraktion.mjs`, Wächter `test/harness/harness-approval.test.ts`). Alle Gruppen bleiben Leitplanken, `leitplankenMuster()` vereinigt sie weiter; die Audit-Prüfung über `protected-paths.json` wird nicht schmaler, nur der informative CODEOWNERS-Spiegel. CODEOWNERS bleibt informativ: das Ruleset verlangt keinen Code-Owner-Review.

**Künftige Änderung, nur mit getrennter Identität:** für Pfade der Pflicht-Review-Liste gilt „Leitplanken-Diffs sind kein Stopp-Grund“ dann nicht mehr; der Merge wartet auf die Freigabe der Maintainerin über die Ruleset-Regel „Code-Owner-Review“. Die übrigen Leitplanken bleiben Selbst-Merge mit Audit-Kommentar. Heute gilt die Regel unverändert, AGENTS.md ändert sich in diesem Ticket nicht.

## Zeitaufwand der Maintainerin je Review (Rohwerte)

Zeitraum 2026-10-26 bis 2026-11-11 (17 Tage), Stand 2c6733e, Squash-Commits auf `main`:

- `git log --oneline 2c6733e | wc -l` = **116** Commits.
- Je Pfad der Liste `git log --oneline 2c6733e -- <pfad> | wc -l`: `.github/workflows/` 21, `.claude/settings.json` 2, `.mcp.json` 1, Summe **24** (höchstens 24; die Vereinigung ohne CODEOWNERS sind 22).
- `.github/CODEOWNERS` 34 Commits; alle 34 änderten zugleich `.github/protected-paths.json` (Spiegelpflege der Vollliste, entfällt künftig); mit CODEOWNERS zusammen 45.
- Alle heutigen Leitplanken-Pfade (Vereinigung über `trifftLeitplanke`): 100 von 116 Commits.
- **Hypothese, ungemessen:** 5 bis 15 Minuten je Review ergeben 22 × 5–15 = 110–330 Minuten in 17 Tagen bei der kleinen Liste, gegenüber 100 × 5–15 = 500–1500 Minuten bei der Vollliste.

## Grenzen

- **Keine Credential-Trennung:** Agenten und Maintainerin teilen Konto und Token. Ein Code-Owner-Review ist darum keine unabhängige Freigabe (GitHub lässt den PR-Autor sich nicht selbst freigeben); erst eine getrennte Identität gäbe der Liste echte Wirkung.
- **Hook-Skripte** sind nur auditpflichtig, nicht auf der Pflicht-Review-Liste; ihre Registrierung `.claude/settings.json` steht darauf.
- **GitHub App** nach factory#69 neu bewerten.

## Re-Evaluierung

- factory#69 (Organisations-Umzug), weitere Beitragende, fremde Bezieher mit Schreibrecht, wiederholt fehlende Audit-Kommentare: Bot-Konto oder App neu bewerten.
- Rückweg dieser Änderung: `git revert` des PR (CODEOWNERS wieder die ganze Liste, Gruppe entfällt).
