# Sicherheitsrichtlinie

## Sicherheitslücke melden

Bitte melde eine Sicherheitslücke **nicht** als öffentliches Issue, sondern vertraulich über GitHubs Private Vulnerability Reporting: im Repository unter **Security → Advisories → Report a vulnerability** (Pfad `/security/advisories/new`). Der Bericht bleibt bis zur Veröffentlichung eines Advisories privat.

Hilfreich sind: betroffene Datei oder Workflow, eine kurze Beschreibung der Auswirkung, Schritte zum Nachstellen und, falls vorhanden, ein Lösungsvorschlag.

## Umfang

Dieses Repository ist ein Harness aus Skripten, Workflows, Hooks und Doku, kein ausgeliefertes Produkt. Im Umfang liegen zum Beispiel Rechteausweitung über Workflows, ungewollte Preisgabe von Secrets, umgehbare Schutzmechanismen (Gates, Hooks) und anfällige Abhängigkeiten.

## Was du erwarten kannst

Die Pflege erfolgt ehrenamtlich und ohne feste Reaktionszeit; ein bestätigter Fund wird über einen privaten Advisory-Entwurf behoben und danach veröffentlicht. Nur der aktuelle Stand von `main` wird betreut.

Welche automatischen Prüfungen laufen (CodeQL, Dependency Review, zizmor, Secret-Scan, Dependabot), steht in [docs/agent-harness.md](docs/agent-harness.md#code-scanning-und-posture-codeqlyml-scorecardyml-875) und [docs/sicherheit-agenten.md](docs/sicherheit-agenten.md).
