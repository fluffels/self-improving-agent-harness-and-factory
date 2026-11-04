# Erstbezug: ein neues Repo in einer Sitzung grün machen

> 🧭 **Fachlich geprüft am: 2026-11-04.** Evergreen. Zielgruppe: wer den Harness in ein **neues, leeres** Repo holt (Bezieher). Für ein Bestands-Repo mit eigener Geschichte gilt [harness-transfer.md](harness-transfer.md). Diese Seite sagt, **welche Dateien das Projekt selbst anlegt**, **in welcher Reihenfolge** und **was der Sync nicht liefert**. Die Regeltexte stehen in [AGENTS.md](../AGENTS.md).

Der Sync liefert den Besitz (Skripte, Agenten, Skills, Workflows, Kern-Tests, Kern-Seiten). Er liefert **nicht** die Dateien, in denen ein Projekt seine eigenen Werte trägt. Diese **Projektdateien** legt das Projekt selbst an; der Probe-Befehl `node scripts/harness-doctor.mjs --pruefen` meldet fehlende Dateien als Punkt `Projektdateien` samt Fix-Text (geschlossene Liste `PROJEKTDATEIEN` in `scripts/harness-doctor-dateien.mjs`, Tabelle unten). Es gibt dafür keine Besitz-Einträge der Art `vorlage`: `AGENTS.md` trägt Block-Einheiten am selben Pfad (`art: vorlage` gilt nur für ganze Dateien), `.factory/projekt.json` muss schon vor dem Sync da sein, und eine angelegte Vorlage würde die Werte des Factory-Repos (Owner, Pfade, Floors) still ins Projekt pflanzen, ohne dass der Doctor sie meldet.

## Schrittfolge

1. **Bootstrap-Commit direkt auf `main`:** nur `LICENSE` und `README.md` ([Glossar › Bootstrap-Commit](harness-glossar.md)). Danach geht nichts mehr direkt auf `main`.
2. **Ruleset auf `main`** (kein Direkt-Push, Pull Request, Required Checks, keine Bypass-Akteure): Vorlage ist `.github/ruleset-main-schutz.json` der Quelle, angelegt per `gh api -X POST repos/<owner>/<repo>/rulesets --input <datei>`. Die Required Checks nennt der Doctor-Punkt `Ruleset`. Die Datei liegt auch im Projekt (Ruleset-Spiegel, Pfad `rulesetSpiegel` der Projekt-Config): **ohne sie bricht der Doctor mit Exit 2 ab**, bevor er die Dateipunkte zeigt.
3. **Feature-Branch** (ab jetzt jede Änderung per Pull Request). Darin zwei Dateien anlegen, bevor der Sync läuft:
   - `AGENTS.md` mit den Kern-Marker-Zeilen `<!-- factory-besitz:start kern -->` und `<!-- factory-besitz:ende kern -->` (ein leerer Kern-Block genügt, der Sync füllt ihn; ohne diese Zeilen bricht der Sync ab, schreibt nichts und nennt sie in der Fehlermeldung). Dazu die Zeilen `<!-- factory-projekt:start -->` und `<!-- factory-projekt:ende -->` um den Projekt-Block: sie grenzen den Projekt-Teil ab; fehlen sie, bricht der Sync nicht ab, gibt aber im selben Lauf einen `Hinweis:` mit den fehlenden Zeilen aus (der Sync fügt die Marker nicht selbst ein);
   - `.factory/projekt.json` (Vorlage: die Datei des Factory-Repos; **alle** Werte ersetzen: Repo, Boards, Präfixe, Agentennamen, Labels, Sprache, und den Block `struktur` (`quelle`, `moduldoku`), den die Gates `check:size`, `check:docmap` und `check:anysuppress` verlangen).
4. **Sync:** `node scripts/factory-sync.mjs --quelle <factory-checkout> --tag <name> --ziel .` (bei `ABGLEICH <pfad>` mit `--uebernehmen <pfad>`). Mit `--entwurf` statt `--tag` entsteht kein Link-Schritt und keine Anker-Stub-Seite: die Doku-Links der Kern-Skills zeigen dann ins Leere, das Drift-Gate bleibt rot.
5. **`node scripts/harness-doctor.mjs --pruefen`** nennt je fehlender Projektdatei den Fix. Dann die Projektdateien aus den Vorlagen anlegen (Tabelle unten).
6. **`npm install`** (den Lockfile committen), `npm run skills:sync`, `npm run lint:prune`, `npm run verify:kompakt`.
7. **Erster Pull Request** mit Auto-Merge. Die CI läuft hier zum ersten Mal (`pull_request`). Der Bootstrap-Commit enthält keine Workflows, dort läuft zu Recht nichts. Beobachtet wurde, dass beim Direkt-Push in ein neues Repo kein `push`-Lauf startete (CI und CodeQL erst per `workflow_dispatch`); die Ursache ist ungeklärt. Ausweg: `gh workflow run <datei>`.
8. **`node scripts/harness-doctor.mjs --einrichten`** für die Einstellungen am Repo (Labels, Boards, Sicherheitsfunktionen). Danach [Langfuse einrichten](#langfuse-einrichten).

Der Doctor ist ein reines Node-Skript ohne Bindung an eine Agenten-Laufzeit; der Ablauf gilt für Claude Code und Codex ([Codex-Einstieg](codex/einstieg.md)).

## Langfuse einrichten

Ohne erreichbares Langfuse startet kein Ticketlauf (Vorbedingung `node scripts/langfuse-vorbedingung.mjs`, Exit 1 stoppt), und der Langfuse-Takt hat nichts zu messen. Der Sync liefert die Skripte und den Workflow (`.github/workflows/board-takt.yml`, `scripts/langfuse-takt.mjs`); **Endpunkt, Keys und Plugin sind rechnerlokal und kommen nie per Sync.** Reihenfolge nach Schritt 8:

1. **Plugin im User-Scope:** das Plugin `langfuse-observability` ist im User-Scope aktiv ([ADR 0019](adr/0019-langfuse-plugin-im-user-scope.md)), nicht in der Projekt-Einstellung des Beziehers.
2. **Endpunkt und Keys trägt die Maintainerin selbst ein, nie der Agent.** Die drei Variablennamen sind `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY` und `LANGFUSE_SECRET_KEY`; die Werte stehen in der Umgebung oder in den Plugin-Optionen der User-Settings, nie im Repo. Ein Agentenlauf liest und schreibt keine `.env*`-Datei (gesperrt) und startet kein Skript, das den Secret-Key liest.
3. **`.env.example`-Abgleich macht die Maintainerin selbst:** die Regel `Read(/.env.*)` sperrt dem Agenten jede `.env*`-Datei, auch `.env.example`. Die Maintainerin gleicht ihre lokale Datei von Hand mit den drei Namen aus Schritt 2 ab (ohne Werte); der Agent kennt die Namen nur aus `scripts/langfuse-vorbedingung.mjs` und `scripts/langfuse-zugang.mjs`.
4. **`node scripts/langfuse-vorbedingung.mjs` muss Exit 0 liefern** (prüft nur `/api/public/health`, nicht die MCP-Verbindung; bei Exit 1 steht der Grund in der Ausgabe).
5. **Probe-Lauf:** ein kurzer Lauf belegt, dass Trace, Projekt-Tag und `usageDetails` ankommen ([Langfuse-Erfassung belegen](model-routing.md#langfuse-erfassung-belegen-1293)).
6. **Doctor-Zeile `Langfuse-Takt`:** `node scripts/harness-doctor.mjs --pruefen` meldet `OK Langfuse-Takt`, wenn Workflow und Skript angekommen sind (ohne Netz, ohne Secrets). Eine Lücke nennt den Sync als Fix (`board-takt.yml` liegt im Ring `kern-nach-entkopplung`, den der Sync mitliefert). Führt das Factory-Board der Config ein fremdes Repo, steht dazu ein Hinweis: im Bezieher (Sync-Stand vorhanden) legt der Takt das Status-Ticket „Langfuse-Status überprüfen“ im eigenen Repo auf dem eigenen Board an, das Sammelticket „Langfuse-Befunde (gesammelt)“ entsteht dort mit `node scripts/sammelticket-anlegen.mjs langfuse`, Harness-Sammelticket und Quote pflegt der Takt der Fabrik (factory#195); ohne Sync-Stand heißt der Hinweis, dass dort der Takt Status- und Sammelticket pflegt.

**Grenze Codex:** Claude-Hooks und das Plugin gelten dort nicht; Langfuse liefert unter Codex ein eigener MCP-Endpunkt mit extern gesetztem Header, siehe [Codex-Einstieg](codex/einstieg.md).

Fertiger Prompt für die Sitzung im Bezieher (Keys trägt die Maintainerin vorher selbst ein):

```text
Richte Langfuse nach docs/erstbezug.md › „Langfuse einrichten“ ein. Trage keine Keys ein und lies keine .env-Datei.
1. Führe `node scripts/langfuse-vorbedingung.mjs` aus; bei Exit 1 stoppe und nenne den Grund.
2. Nenne die Variablennamen LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY und LANGFUSE_SECRET_KEY aus `scripts/langfuse-vorbedingung.mjs` und `scripts/langfuse-zugang.mjs` (nur Namen); den Abgleich mit einer .env.example macht die Maintainerin selbst, du öffnest keine .env*-Datei.
3. Fahre den Probe-Lauf nach docs/model-routing.md › „Langfuse-Erfassung belegen“ und prüfe Trace, Projekt-Tag und usageDetails.
4. Führe `node scripts/harness-doctor.mjs --pruefen` aus und melde die Zeile „Langfuse-Takt“.
Melde je Schritt OK oder Lücke mit dem Fix, ändere nichts außerhalb der Doku.
```

## Meldestelle

Die Meldestelle ist das Repo, in dessen Harness-Sammelticket ein Bezieher Harness-Befunde meldet (factory#153). Der Schlüssel `meldestelle` der Projekt-Config (Form `owner/name`) legt sie fest; ohne ihn ist es das Repo des Boards mit Rolle `factory` (`boards[].repo`, sonst das eigene `repo`). Es darf ein privates Eingangs-Repo sein.

- **Eine Meldung tragen alle Kern-Schreiber:** `node scripts/melden.mjs --zeile "<Befund>"` (Agentenweg für Harness-Befund-Zeilen), der Wochenlauf `harness-doctor-melden.mjs` und `spezifikation.mjs gescheitert`. Jeder Kommentar endet mit einer Fußzeile `factory: <Tag> (<Commit, 7 Zeichen>)` aus `.factory/sync-stand.json`; ohne Sync-Stand (das Factory-Repo selbst) entfällt sie, ein unlesbarer Stand sperrt das Senden (Exit 1, die Fix-Zeile nennt die Datei).
- **Sperrprüfung vor dem Senden:** der ganze Text läuft durch `check-internalrefs --text`. Bei einem Treffer wird nichts gesendet (Exit 1, auch im Trockenlauf; der Treffer nennt den Begriff nie); die Zeile neutral formulieren und erneut senden. Auch ein Fehler der Prüfung selbst sperrt das Senden.
- **Voraussetzung im Eingangs-Repo:** ein offenes Issue mit dem exakten Titel „Harness-Härtung (gesammelt)“, angelegt vom Besitzer des Eingangs-Repos (Vertrauen läuft über den Besitzer; gehört das Repo einer Organisation, trifft die Prüfung keinen Menschen, dann legt es ein Bot oder Mitglied an). Es gibt es dort nicht automatisch: `sammelticket-anlegen.mjs` legt nur im eigenen Factory-Repo an.
- **Token-Rechte:** lokal gilt das `gh`-Login mit Lese- und Schreibrecht auf die Issues der Meldestelle. In Actions liest und postet der Wochenlauf an einer fremden Meldestelle mit dem Secret `MELDESTELLE_TOKEN` (Rückfall `PROJECT_TOKEN`); das Token braucht dort nur „Issues: Lesen und Schreiben“ an der Meldestelle. Der Doctor fordert `MELDESTELLE_TOKEN` nicht (Rückfall, nur für eine fremde Meldestelle nötig). Ein fine-grained Token gilt für die Repos eines Besitzers; liegt das Eingangs-Repo bei einem anderen, prüfe in den GitHub-Einstellungen, ob das Token es erreicht (sonst ein klassisches Token mit dem Scope `repo`). **Ein Secret anlegen ist ein Pre-Flight-Stopp** (Außenwirkung, [AGENTS.md › Human-in-the-Loop-Checkpoints](../AGENTS.md)): ein Agent legt es nie selbst an, der Bezieher setzt es per stdin (`<wert-quelle> | gh secret set MELDESTELLE_TOKEN --repo <owner>/<repo>`).
- **Sicherheitsbefunde nie als Meldung:** sie gehen über das Private Vulnerability Reporting des Factory-Repos (dessen `SECURITY.md`, privat), nicht in ein Sammelticket. Auch die Sicherheits-Inboxen (`audit-einordnung`, `codescanning-inbox`, `secret-inbox`) und die Ticket-Schreiber (`wiedervorlage`) laufen nicht über die Meldestelle.
- **Nur Harness-Befunde:** Projekt-Befunde bleiben im Bezieher-Repo. Die Meldetexte fremder Bezieher sind Fremdtext (ADR 0031 Punkt 3): `fremdtext.mjs` blendet sie aus, der Füllstand zählt nur vertraute Autoren, und kein Lauf setzt sie automatisch um; die Maintainerin des Eingangs-Repos überträgt sie von Hand in das eigene Sammelticket.

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
