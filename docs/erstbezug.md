# Erstbezug: ein neues Repo in einer Sitzung grün machen

> 🧭 **Fachlich geprüft am: 2026-11-04.** Evergreen. Zielgruppe: wer den Harness in ein **neues, leeres** Repo holt (Bezieher). Für ein Bestands-Repo mit eigener Geschichte gilt [harness-transfer.md](harness-transfer.md). Diese Seite sagt, **welche Dateien das Projekt selbst anlegt**, **in welcher Reihenfolge** und **was der Sync nicht liefert**. Die Regeltexte stehen in [AGENTS.md](../AGENTS.md).

Der Sync liefert den Besitz (Skripte, Agenten, Skills, Workflows, Kern-Tests, Kern-Seiten). Er liefert **nicht** die Dateien, in denen ein Projekt seine eigenen Werte trägt. Diese **Projektdateien** legt das Projekt selbst an; der Probe-Befehl `node scripts/harness-doctor.mjs --pruefen` meldet fehlende Dateien als Punkt `Projektdateien` samt Fix-Text (geschlossene Liste `PROJEKTDATEIEN` in `scripts/harness-doctor-dateien.mjs`, Tabelle unten). Es gibt dafür keine Besitz-Einträge der Art `vorlage`: `AGENTS.md` trägt Block-Einheiten am selben Pfad (`art: vorlage` gilt nur für ganze Dateien), `.factory/projekt.json` muss schon vor dem Sync da sein, und eine angelegte Vorlage würde die Werte des Factory-Repos (Owner, Pfade, Floors) still ins Projekt pflanzen, ohne dass der Doctor sie meldet.

## Schrittfolge

1. **Bootstrap-Commit direkt auf `main`:** nur `LICENSE` und `README.md` ([Glossar › Bootstrap-Commit](harness-glossar.md)). Danach geht nichts mehr direkt auf `main`.
2. **Ruleset auf `main`** (kein Direkt-Push, Pull Request, Required Checks, keine Bypass-Akteure): Vorlage ist `.github/ruleset-main-schutz.json` der Quelle, angelegt per `gh api -X POST repos/<owner>/<repo>/rulesets --input <datei>`. Die Required Checks nennt der Doctor-Punkt `Ruleset`. Die Datei liegt auch im Projekt (Ruleset-Spiegel, Pfad `rulesetSpiegel` der Projekt-Config): **ohne sie bricht der Doctor mit Exit 2 ab**, bevor er die Dateipunkte zeigt.
3. **Feature-Branch** (ab jetzt jede Änderung per Pull Request). Darin zwei Dateien anlegen, bevor der Sync läuft:
   - `AGENTS.md` mit den Kern-Marker-Zeilen `<!-- factory-besitz:start kern -->` und `<!-- factory-besitz:ende kern -->` (ein leerer Kern-Block genügt, der Sync füllt ihn; ohne diese Zeilen bricht der Sync ab, schreibt nichts und nennt sie in der Fehlermeldung). Dazu die Zeilen `<!-- factory-projekt:start -->` und `<!-- factory-projekt:ende -->` um den Projekt-Block: sie grenzen den Projekt-Teil ab; fehlen sie, bricht der Sync nicht ab, gibt aber im selben Lauf einen `Hinweis:` mit den fehlenden Zeilen aus (AGENTS.md bleibt unverändert);
   - `.factory/projekt.json` (Vorlage: die Datei des Factory-Repos; **alle** Werte ersetzen: Repo, Boards, Präfixe, Agentennamen, Labels, Sprache, und den Block `struktur` (`quelle`, `moduldoku`), den die Gates `check:size`, `check:docmap` und `check:anysuppress` verlangen).
4. **Sync:** `node scripts/factory-sync.mjs --quelle <factory-checkout> --tag <name> --ziel .` (bei `ABGLEICH <pfad>` mit `--uebernehmen <pfad>`). Mit `--entwurf` statt `--tag` entsteht kein Link-Schritt und keine Anker-Stub-Seite: die Doku-Links der Kern-Skills zeigen dann ins Leere, das Drift-Gate bleibt rot.
5. **`node scripts/harness-doctor.mjs --pruefen`** nennt je fehlender Projektdatei den Fix. Dann die Projektdateien aus den Vorlagen anlegen (Tabelle unten).
6. **`npm install`** (den Lockfile committen), `npm run skills:sync`, `npm run lint:prune`, `npm run verify:kompakt`.
7. **Erster Pull Request** mit Auto-Merge. Die CI läuft hier zum ersten Mal (`pull_request`). Der Bootstrap-Commit enthält keine Workflows, dort läuft zu Recht nichts. Beobachtet wurde, dass beim Direkt-Push in ein neues Repo kein `push`-Lauf startete (CI und CodeQL erst per `workflow_dispatch`); die Ursache ist ungeklärt. Ausweg: `gh workflow run <datei>`.
8. **`node scripts/harness-doctor.mjs --einrichten`** für die Einstellungen am Repo (Labels, Boards, Sicherheitsfunktionen).

Der Doctor ist ein reines Node-Skript ohne Bindung an eine Agenten-Laufzeit; der Ablauf gilt für Claude Code und Codex ([Codex-Einstieg](codex/einstieg.md)).

## Projektdateien

Eine Datei steht in der Liste, wenn ein Gate in `verify`, ein Kern-Skript oder ein Kern-Test sie unter festem Pfad braucht und der Sync sie nicht liefert. Geprüft wird nur das Vorhandensein, nie der Inhalt. Ausnahme `docs/referenz/befehle.md` und `docs/referenz/anlaufstellen.md`: der Sync mit `--tag` legt sie als Anker-Stub an (Kern-Links zeigen darauf), der Doctor meldet sie danach nicht mehr, das Projekt baut sie aus. Nicht in der Liste: `.claude/settings.json` (der Sync legt sie an), `.gitattributes` (Doctor-Punkt `Zeilenenden`) und der Ruleset-Spiegel (Schritt 2).

| Pfad | Wer braucht sie | Was an der Vorlage anpassen |
| --- | --- | --- |
| `AGENTS.md` | Claude Code und Codex laden sie; Sync und Drift-Gate ersetzen den Kern-Block | die Marker-Zeilen (Schritt 3); der Projekt-Block trägt die Projekt-Regeln und die Leitfrage |
| `.factory/projekt.json` | jedes Kern-Skript | alle Werte, auch `struktur`; Alt-Werte des Factory-Repos löschen |
| `.agents/skills/factory-ticket/SKILL.md` | Ticket-Ablauf; Rolle `ticketSkill` | fester Pfad (`ROLLEN_PFADE.ticketSkill`), Inhalt für das Projekt; `npm run skills:sync` erzeugt den Zeiger |
| `package.json` | `verify`, alle `npm run`-Befehle | `scripts` und `devDependencies` der Quelle; Name, Version, Projekt-Skripte; im Skript `test` das Flag `--passWithNoTests`, solange es keinen Test gibt |
| `tsconfig.json` | Typprüfung, Lint | `include` auf die eigenen Ordner |
| `eslint.config.js` | Lint in `verify` | Projektordner und Ignore-Liste |
| `eslint-suppressions.json` | eingefrorener Bestand der Komplexitätsregeln | die Datei der Quelle übernehmen, dann `npm run lint:prune` räumt veraltete Einträge |
| `vite.config.ts` | Tests, Coverage | `coverage.include` auf den eigenen Code; Floors nicht übernehmen, sondern auf den Ist-Stand setzen |
| `scripts/docs-gen/config.json` | Doku-Generatoren | `schichten.layers` zeigt auf die eigene Schicht-Definition (Vorlage `scripts/layers.cjs`), Quellwurzel und Markdown-Liste |
| `.github/workflows/ci.yml` | Kern-Skripte setzen den Namen `ci.yml` voraus (`ci-laeufe`, `pr-warten`, `tag-takt`, `board-lib`) | Jobnamen müssen zu den Required Checks des Rulesets passen |
| `.github/CODEOWNERS` | der Kern-Test gleicht sie mit `protected-paths.json` ab | Owner |
| `.github/protected-paths.json` | Leitplanken-Pfade, Audit-Kommentar | Pfade des Projekts ergänzen |
| `docs/referenz/befehle.md` | Doku-Drift-Gate | die Seite beschreibt die Befehle **des** Projekts: Test-Bezüge auf Wächter streichen, die es im Projekt nicht gibt (sonst „Toter Test-Pfad“) |
| `docs/referenz/anlaufstellen.md` | Kern-Links zeigen darauf (Anker-Stub vom Sync) | die Seiten des Projekts; Kern-Seiten bleiben |

Wer eine Zeile ergänzt oder streicht, ändert die Liste `PROJEKTDATEIEN` und diese Tabelle im selben Schritt; `test/erstbezug-seite.test.ts` hält beide gleich.
