# Fortschreibung #388 (2026-11-12): Sicherheitsprüfung im Bezieher

Setzt Punkt 1 und 4 von [ADR 0031](../0031-fabrik-ohne-zugriff-auf-bezieher.md) für eine neue Aufgabe um: Bezieher bekommen eine wiederkehrende Sicherheits- und Konfigurationsprüfung, die im Bezieher läuft. Herkunft: Befundzeile L45 aus factory#375; Beleg: ein Bezieher, dessen `dependabot.yml` nur npm im Wurzelverzeichnis und GitHub Actions abdeckte, Teilprojekte blieben unbemerkt.

## Kontext

- **Schreibgrenze:** die Fabrik schreibt nie in einen Bezieher; ein Prüf-Ticket kann sie dort nicht anlegen. Der Takt muss im Bezieher laufen.
- **Vorhandene Prüfung:** der Harness-Doctor kennt Secret-Scanning, Push-Protection, Ruleset und Required Checks; sein Wochenlauf meldet an die Meldestelle der Fabrik, nicht ins eigene Repo, und kennt weder Dependabot-Abdeckung noch Alerts noch CodeQL-Sprachen.

## Entscheidung

Entscheidung: ein monatlicher Workflow ohne Modell (`sicherheitspruefung.yml`, Ring `kern`, geht mit dem Sync an jeden Bezieher) startet `node scripts/sicherheitspruefung.mjs`. Das Skript ruft den Prüflauf des Harness-Doctors auf, filtert ihn auf die Punkte der Soll-Liste, ergänzt `Dependabot-Abdeckung`, `Dependabot Alerts` und `CodeQL-Sprachen` und legt bei Abweichungen **ein** Ticket im eigenen Repo an (Tabelle Punkt, Ist, Soll, Fix).

- **Soll-Liste:** `.github/sicherheitspruefung.json` mit den Schlüsseln `kern` (Besitz-Schlüssel, der Sync setzt nur ihn, nach dem Muster der Schlüssel-Einheiten von `.claude/settings.json`) und `projekt` (der Bezieher pflegt ihn, der Sync lässt ihn unberührt). Der Bezieher erweitert nur über bekannte Punktnamen, Manifest-Muster, begründete Ausnahmen und `codeqlOhne`; frei definierte Abfragen gibt es nicht, ein unbekannter Punkt oder eine Ausnahme ohne `grund` ist ein Konfigurationsfehler.
- **Schreibweg:** gelesen wird nur mit `PROJECT_TOKEN` (GET), geschrieben nur mit `github.token` ins eigene Repo (`gh issue create --repo <eigenes>`). Weicht `GITHUB_REPOSITORY` vom Repo der Projekt-Config ab, endet der Lauf vor jedem Schreibaufruf. Es gibt keinen Meldestellen-Pfad.
- **Dedupe:** höchstens ein offenes Ticket (Titelpräfix ohne Monat, Marker im Body, vertrauter Autor, auch geclaimt) und eine Zweitabfrage vor dem Anlegen. Ein offenes Ticket unterdrückt neue Läufe vollständig, auch neue Abweichungen: kein Kommentar, kein Update.
- **Fail-closed:** ein nicht prüfbarer Punkt zählt als Abweichung; der Fix nennt das fehlende Recht. Die Datei `dependabot.yml` liest ein eigener Text-Leser, kein YAML-Paket: der Job hat kein `npm ci`, aber Schreibrecht und ein PAT.

## Verworfen

- **Routine oder Agent in der Fabrik:** bräuchte Schreibzugriff auf den Bezieher (Punkt 1).
- **Erweiterung des Doctor-Wochenlaufs:** der meldet an die Meldestelle der Fabrik; Projektzustände gehören ins eigene Repo.
- **Vorlage mit Projekt-Block (`art: vorlage`):** ein Block in einer JSON-Datei ist unnötig, ein Besitz-Schlüssel reicht und ist erprobt.

## Folgen

- Fabrik und Bezieher bekommen denselben Takt; in der Fabrik laufen die Prüfpunkte gegen ihr eigenes Repo.
- Die Sicherheitspunkte erscheinen im Bezieher doppelt: im Doctor-Wochenlauf (Meldestelle) und im Monatsticket. Ob der Wochenlauf sie im Bezieher auslassen sollte, ist offen.
- **Re-Evaluierung:** bis 2027-05-12 prüfen, ob die Manifest-Heuristik (Workspaces, Maven-Aggregatoren) zu Fehlalarmen führt und ob die Punktliste ausreicht.
