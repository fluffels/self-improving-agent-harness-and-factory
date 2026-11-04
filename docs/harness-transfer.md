# Harness übertragen: Einführungspfad für ein fremdes Bestands-Repo

> 🧭 **Fachlich geprüft am: 2026-10-08.** Evergreen. Zielgruppe: wer den Harness dieses Repos (Agenten-Regeln, Gates, Lebende Doku, Review) in ein **bestehendes** Repo in beliebiger Sprache holen will. Die Regeltexte stehen nicht hier, sondern in [AGENTS.md](../AGENTS.md) und [agent-harness.md](agent-harness.md); diese Seite sagt, **in welcher Reihenfolge** man sie einführt und **was auf dem Weg weh tut**. Das Leitbild „Bitte → Mauer“ (was als Bitte in `AGENTS.md` beginnt, wird ein Gate): [agent-harness.md › Leitplanken-Schichten](agent-harness.md#leitplanken-schichten-bitte-und-mauer). Warum Doku generiert wird: [ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md). Wie das gewachsen ist: [README › Wie das gewachsen ist](../README.md).

## Grundregel: Bestand einfrieren statt sanieren

Ein Brownfield-Repo besteht den ersten Lauf jedes neuen Gates nicht, und ein Gate, das beim Einschalten rot ist, wird ausgeschaltet. Darum gilt für jede Stufe dasselbe Muster, das dieses Repo selbst nutzt:

1. **Ist messen und in eine Baseline-Datei schreiben** (alles, was heute verletzt).
2. **Das Gate ist rot bei Neuem oder Verschlechtertem**, grün bei Bestand.
3. **Stale Einträge werden abgeräumt** (behobene Verletzungen verschwinden aus der Baseline, sonst wächst sie als Altlast zurück).
4. **Schwellen bewegen sich nur in die strenge Richtung** (kein Grün-durch-Aufweichen, [AGENTS.md › Git, PR und Merge](../AGENTS.md#git-pr-und-merge)).

Belege im Repo: [`eslint-suppressions.json`](../eslint-suppressions.json) (Komplexität je Funktion, abräumen mit `npm run lint:prune`), [`any-suppressions.json`](../any-suppressions.json) (Deckel für begründete `any`), die `ALLOWLIST` von `check:size` (Dateien über 800 Zeilen, nur mit offenem Split-Ticket), die Coverage-Floors je Schicht in [`vite.config.ts`](../vite.config.ts) (nur anheben) und die Emoji-Baseline der Wächter. Generierte Zeilen (`GEN:`-Abschnitte) zählen für `check:diffsize` nicht, ein neuer Generator bläht also den Slice-Deckel nicht auf.

## Reifestufen

Aufwand ist qualitativ (klein, mittel, groß) und an den Tickets des [Quellprojekts](https://github.com/fluffels/kubernia) belegt, die die Stufe eingeführt haben; keine Stundenangaben, die niemand gemessen hat.

| Stufe | Was | Aufwand | Nutzen | Typische Brownfield-Hürde | Bestand einfrieren | Beleg hier |
|---|---|---|---|---|---|---|
| 1 | `AGENTS.md` mit SSOT-Regeln | klein | Agenten (und Menschen) lesen dieselbe Regelquelle; ein Größen-Gate hält sie kurz | verstreute, widersprüchliche Bestandsdoku; niemand weiß, welche Regel gilt | die gelebte Praxis aufschreiben, nicht die gewünschte | [AGENTS.md](../AGENTS.md), `check:contextsize`, [ADR 0013](adr/0013-docs-als-agentengepflegtes-wiki.md), [ADR 0015](adr/0015-projekt-brain.md) |
| 2 | Generierte Doku-Abschnitte + `check:docgen` | mittel | Zählbares und Aufzählungen veralten nicht mehr still | der erste Lauf deckt Drift auf (das ist der Befund, kein Fehler des Werkzeugs) | Abschnitte erst dort einführen, wo die Quelle sauber ist; der Rest bleibt Prosa | quellprojekt#1355 (`110a0b4`), quellprojekt#1392 (`1cd7d63`), [ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md) |
| 3 | Schichtregel + Diagramm == Regel | mittel bis groß | Architekturregeln sind ein Gate, das Diagramm leitet sich aus derselben Tabelle ab | Bestandsverstöße und Zyklen; das Soll startet grob und wird verfeinert | bekannte Verstöße in die Baseline des Werkzeugs, Soll zuerst auf wenige Grobschichten | quellprojekt#1368 (`10d27a6`), [`scripts/layers.cjs`](../scripts/layers.cjs), schichtregeln.md |
| 4 | PR-Gating + Mehr-Perspektiven-Review | mittel | nichts Rotes erreicht `main`; Review ist nicht der Agent, der den Code schrieb | Branch-Schutz braucht Admin- und Team-Absprache; flakige Tests machen Required Checks unbenutzbar | flakige Tests zuerst isolieren oder aus den Required Checks lassen | [ADR 0009](adr/0009-pr-gating-required-checks.md), [ADR 0012](adr/0012-harness-autonomie-audit-spur.md), [ADR 0014](adr/0014-leitplanken-ohne-label-riegel.md), quellprojekt#1012, quellprojekt#1270 |
| 5 | Modell-Routing + Messung | mittel | Kosten je Phase sichtbar, Modellwahl ist Konfiguration statt Gewohnheit | Telemetrie und Datenschutz; eine belastbare Baseline braucht Wochen an Daten | Messung vor Optimierung: erst Baseline über mehrere Wochen, dann Schwellen | [model-routing.md](model-routing.md), [ADR 0015](adr/0015-projekt-brain.md), [ADR 0016](adr/0016-langfuse-takt-woechentlich.md), [ADR 0019](adr/0019-langfuse-plugin-im-user-scope.md) |

**Stufe 1** ist die billigste und wirkt sofort. Eine Regel steht genau einmal (in `AGENTS.md`), alles andere verlinkt. Die Hürde ist nicht das Schreiben, sondern das Entscheiden, welche der widersprüchlichen Altregeln gilt. **Stufe 2** ist der Hebel für alles Weitere: wer Tabellen und Zählungen aus Code ableitet, muss nicht mehr glauben, dass die Doku stimmt. **Stufe 3** ist der Kern von „Diagramm == Regel“: ein Diagramm, das nicht aus der geprüften Regel erzeugt wird, ist eine Behauptung. **Stufe 4** macht aus Bitten Mauern; ohne Branch-Schutz ist alles davor freiwillig. **Stufe 5** ist die einzige, die man weglassen kann, ohne dass die Stufen davor schlechter werden.

## Werkzeug-Mapping je Sprache (Stufe 3)

Der Schichtgedanke ist sprachneutral, das Werkzeug nicht. Alle Angaben sind an der jeweiligen Werkzeug-Doku belegt.

| Ökosystem | Schichtregel prüfen | Ist-Graph / Diagramm | Bestand einfrieren | Coverage (`check:diffcoverage`) | Quelle |
|---|---|---|---|---|---|
| JS/TS | dependency-cruiser, Regeln in der Config (hier abgeleitet aus `SCHICHT_MODELL`) | `--output-type mermaid`, Verdichten mit `--collapse` | `--baseline` (der frühere `depcruise-baseline` ist ein Alias), danach `--ignore-known` | `lcov` (Vitest/Istanbul-Reporter `lcov`) | [CLI-Doku](https://github.com/sverweij/dependency-cruiser/blob/main/doc/cli.md) |
| Python | Tach (Modulgrenzen) oder import-linter (Verträge `layers`, `forbidden`, `independence`) | Tach: `tach show --mermaid`, `tach map`, `tach sync` | import-linter: `ignore_imports` je bekanntem Verstoß | `lcov` über `coverage lcov` | [coverage.py](https://coverage.readthedocs.io/en/latest/cmd.html#cmd-lcov), [Tach](https://docs.gauge.sh/usage/commands), [import-linter](https://import-linter.readthedocs.io/en/stable/contract_types/) |
| JVM | ArchUnit; ein PlantUML-Komponentendiagramm ist direkt die Regel (`adhereToPlantUmlDiagram`) | das PlantUML-Diagramm selbst ist die Quelle | `FreezingArchRule.freeze(...)` speichert bestehende Verstöße, später melden nur neue | `jacoco` (JaCoCo-XML, `jacoco-maven-plugin`, Ziel `report`; Angular-Teil: `lcov`) | [ArchUnit-Guide](https://www.archunit.org/userguide/html/000_Index.html), [JaCoCo-Maven](https://www.jacoco.org/jacoco/trunk/doc/report-mojo.html) |
| sprachneutral | LikeC4 prüft **keinen Code**: `likec4 validate` prüft Syntax und Layout-Drift des Modells, `likec4 build` erzeugt eine statische Seite | Diagramm aus dem Architekturmodell | entfällt; ein handgeschriebenes Modell driftet, wenn kein Test es gegen die Schichtquelle hält | entfällt | [LikeC4-CLI](https://likec4.dev/tooling/cli/) |

**Quellwurzeln und Endungen (factory#181):** `struktur.quelle` der Projekt-Config nimmt einen Pfad oder eine Liste von Pfaden bzw. Globs (etwa `*/src/main/java` bei mehreren Gradle-Modulen), `struktur.endungen` die Dateiendungen mit Punkt (etwa `.java`; Standard ist die JS/TS-Familie) und `struktur.ohne` Ausschlüsse als Globs (etwa `**/*.spec.ts`). `check:size` misst alle Wurzeln mit der Endungsliste (`ohne` gilt dort nicht); `check:docmap` liest ebenfalls alle Wurzeln (Standard-Endung dort nur `.ts`, `ohne` gilt) und kennt `struktur.docmapEinheit: "ordner"` (ein Ordner mit direkter Quelldatei, etwa ein Java-Paket, ist ein Modul); `check:diffcoverage` misst die geänderten Zeilen aller Quellwurzeln (Endungsliste, `ohne` gilt, Typdeklarationen nie) gegen die Coverage-Berichte `coverage.berichte` der Projekt-Config: eine Liste `{ format: "lcov" | "jacoco", pfad, basis? }`, `pfad` auch als Glob (etwa `*/target/site/jacoco/jacoco.xml` bei mehreren Gradle-Modulen); ohne den Block gilt `coverage/lcov.info` (factory#185). Begriffe: [Coverage-Bericht, Quellwurzel, Endungsliste, Docmap-Einheit](harness-glossar.md).

Hinweise zur Wahl: Für **JS/TS** und **Python** liefert das Werkzeug den Graphen mit, Soll und Ist lassen sich vergleichen. Auf der **JVM** ist das Diagramm schon die Regel, ein zweites Soll-Diagramm wäre doppelt. LikeC4 ist ein Darstellungswerkzeug; wer es nutzt, braucht einen eigenen Test, der Modell und Schichtquelle abgleicht, sonst gilt „Diagramm == Regel“ nicht.

**Ist-Adapter:** der Generator `schichten-ist` liest jede JSON-Ausgabe der Form `{ "modules": [ { "source": "…", "dependencies": [ { "resolved": "…" } ] } ] }` (die Form von dependency-cruiser). Für Python genügt ein kleines Skript, das die Import-Zeilen liest und diese Form ausgibt; [`test/docgen-fremdrepo.test.ts`](../test/docgen-fremdrepo.test.ts) macht das mit einem Mini-Repo vor.

## docs-gen in ein anderes Repo übernehmen (Stufe 2 und 3)

Der Generator-Kern hängt nicht am [Quellprojekt](https://github.com/fluffels/kubernia). Belegt ist das durch einen Test, der ein Mini-Repo (Python, ohne `package.json`, ohne `src/`) mit eigener Config, eigener Schicht-Definition und eigenem Generator (über `generatoren`) durch den Kern fährt ([`test/docgen-fremdrepo.test.ts`](../test/docgen-fremdrepo.test.ts)) und durch einen Wächter, der prüft, dass die Kern-Module nur `node:*` und andere Kern-Module importieren.

**Ist-Zustand ist Übernahme per Kopie, kein Paket.** Zum Kopieren:

- Kern: `scripts/docs-gen.mjs` (Engine), `scripts/docs-gen/markdown.mjs`, `adr.mjs`, `zeitleiste.mjs`, `schichten.mjs`, dazu `registry.mjs`: sie führt nur Kern- und Harness-Generatoren, eigene Generatoren des Projekts nennt die Config im Schlüssel `generatoren` (`{ <marker>: { datei, name } }`), eine eigene Registry ist nicht nötig, wenn die Harness-Generatoren, die `registry.mjs` statisch importiert (`gates`, `diagramme`, `harness-inventar`, `harness-kennzahlen` samt deren Importen), mitkopiert werden; sonst übergibt das Projekt eigene `generators`.
- Nicht Kern: `harness-inventar`, `harness-kennzahlen`, `diagramme` und `ruleset-spiegel` setzen Claude Code und GitHub voraus (`harness-kennzahlen` zählt zudem npm-Ketten und GitHub-Workflows); `gates` setzt npm-Skripte voraus (für einen anderen Task-Runner, etwa Make, ist ein eigener Generator nötig); `save-versionen` und die Quest-Generatoren sind projektspezifisch und stehen nicht in der Registry, sondern in der Config des Projekts (`generatoren`). Welche Kern- und Harness-Generatoren es gibt, zeigt die gruppierte [Registry](../scripts/docs-gen/registry.mjs).

**Was das Projekt festlegt (alles in einer Config-Datei, `--config <pfad>`):**

- `markdown`: welche Dateien und Ordner nach `GEN:`-Markern durchsucht werden.
- `adr.ordner`, `zeitleiste.meilensteine`: Quellen für ADR-Liste und Zeitleiste.
- `schichten.layers` (Pfad zur Schicht-Definition) und `schichten.cruise` (Node-Aufruf, der die Import-Graph-JSON auf stdout liefert).
- `schichten.pruefbefehl` (optional): der Befehl der Schichtprüfung, den die Fehlermeldungen nennen. Das Code-Verzeichnis steht außerdem im Cruise-Aufruf, im Collapse-Muster, im Coverage-`include` und in den Ausnahmen der Werkzeug-Config; sie ziehen nicht automatisch mit `quellwurzel` bzw. `quellwurzeln` mit.
- `befehl` (optional): der Befehl, den Hinweiszeile und `Fix:`-Text nennen, Standard `npm run docs:gen`.

**Vertrag der Schicht-Definition:** eine CommonJS-Datei, die `SCHICHT_MODELL` exportiert (nur Daten; Prüfung und Ableitung liegen im Kern, [`scripts/schichten-kern.cjs`](../scripts/schichten-kern.cjs)). Das Modell trägt `quellwurzel` (das Code-Verzeichnis mit Slash, etwa `wetter/`) oder stattdessen `quellwurzeln` (eine nicht-leere Liste solcher Verzeichnisse, keins unter einem anderen, etwa Maven-Module und ein Angular-Frontend; nie beide zugleich), optional `endungen` (Endungen der Quelldateien mit Punkt, etwa `[".java"]`, Standard `[".ts"]`; nicht zu verwechseln mit `struktur.endungen` der Projekt-Config), `schichten` (je `id`, `label`, `wurzeln`, `muster`, `darf`; genau eine Auffang-Schicht mit `muster: null`) und `extern`. Die Muster baut `musterAus(quellwurzeln, wurzeln, nurDatei, endungen)` über alle Wurzeln und Endungen; jedes `muster` muss mit der Wurzel-Alternative `^(w1|w2|…)` (bei einer `quellwurzel`: `^<quellwurzel>`) in Modell-Reihenfolge beginnen, wie `musterAus` sie baut, und ist `endungen` gesetzt, auf diese Endungen enden (`musterAus` bekommt dieselben `endungen` wie das Modell); Wurzel-Namen der Schichten dürfen Großbuchstaben tragen (`^[A-Za-z0-9][A-Za-z0-9_-]*$`), sind aber ohne Groß-/Kleinschreibung eindeutig; der `.d.ts`-Ausschluss der Regeln gilt nur für Modelle mit `.ts`; `endungen` wirken auf die Datei-Token (Einzeldatei je Wurzel, in Muster und Coverage-Glob), unter einem Schicht-Ordner zählt jede Datei, gleich welcher Endung (factory#184). Alles, was nicht in `darf` steht, ist verboten. Der Kern prüft das Modell fail-closed (`pruefeModell`), auch Quellwurzel und IDs; ein von der Projektdatei mitgelieferter Prüfer wird ignoriert. Die Prüfung ist streng (etwa nur Kleinbuchstaben, Ziffern, `-` und `_` in der Quellwurzel), ein Fremd-Repo muss sich ihr anpassen. Die Regeln des Werkzeugs (hier die von dependency-cruiser) leitet der Kern aus dem Modell ab (`verbotsRegeln`, `layerOfAus`, `coverageGlobsAus`), wie [`scripts/layers.cjs`](../scripts/layers.cjs) es vormacht. Ein Kern-Modul importiert die Schichtdaten nie statisch, sondern lädt sie über `schichten.layers`.

## Form der Vorlage ([ADR 0022](adr/0022-dark-factory-kern-und-verteilung.md))

Der Weg in ein neues, leeres Repo (Bootstrap-Commit, Ruleset, erster Pull Request, die Projektdateien, die der Sync nicht liefert): [Erstbezug](erstbezug.md).

Entschieden: ein Factory-Repo als Quelle, verteilt per Sync mit Besitz-Manifest; Projektwerte kommen zur Laufzeit aus einer Projekt-Config. Es gibt kein eigenes docs-gen-Paket, der docs-gen-Kern ist ein Baustein des Kerns. Die Veröffentlichung ist entschieden: Factory-Repo öffentlich unter `fluffels`, alle Rechte vorbehalten, kein Marketplace-Eintrag, keine externen Beiträge ([Fortschreibung quellprojekt#1706](adr/0022-dark-factory-kern-und-verteilung.md#fortschreibung-1706-2026-10-16-veröffentlichungsentscheidung)); das Repo entsteht mit F10.

Für Projekte, in deren Repo vom Harness nichts liegen darf, gilt die Betriebsart Arbeitsplatz statt der eingebetteten Vorlage: [ADR 0022, Fortschreibung quellprojekt#1829](adr/0022-dark-factory-kern-und-verteilung.md#fortschreibung-1829-2026-10-22-betrieb-ohne-harness-im-projekt-repo-arbeitsplatz).

Der Design-Schritt für Tickets mit Oberfläche ist optional (factory#172): ein Bezieher mit Oberfläche trägt in `.factory/projekt.json` den Block `design` ein (`label` und `freigabe` als Labelnamen, `system` als Pfad der Design-System-Seite); ohne Block gibt es den Schritt nicht. Ein Ticket mit dem Design-Label ohne Freigabe-Label geht nicht in die Umsetzung. Entscheidung: [Fortschreibung zu ADR 0028](adr/fortschreibungen/0028-172-design-schritt.md).

Die Sammelbefehle der Gates sind je Projekt setzbar (factory#182): ein Bezieher mit anderem Build-Werkzeug trägt in `.factory/projekt.json` den Block `befehle` ein (`install`, `verify`, `verifyKompakt`, `verifyChanged`, `coverage` als Befehlszeilen; fehlende Namen behalten den npm-Standard). pre-push ruft `node scripts/gate-befehl.mjs <name>` (die Kern-Texte der Skills und Agenten stellt factory#186 um); ein eigenes `install` muss die npm-Installation einschließen; die eigene `ci.yml` (Projektbesitz) stellt der Bezieher selbst auf den Läufer um. Die Wurzel-`package.json` bleibt Task-Runner des Harness, denn Harness-Gates, `docs-gen` und `verify-lauf` setzen npm-Skripte voraus. Entscheidung: [Fortschreibung zu ADR 0022](adr/fortschreibungen/0022-182-gate-befehle.md).

Der Abschluss-Skill am Sitzungsende ist optional (factory#139): ein Bezieher setzt `skills.abschluss` in `.factory/projekt.json` auf `null` (empfohlen, kein Skill) oder auf den Namen eines eigenen Skills, etwa den Brain-Skill eines Starter-Kits. Eine Maintainerin kann ihn lokal per `FACTORY_ABSCHLUSS_SKILL` setzen (`aus` schaltet ihn ab); `node scripts/projekt-config.mjs abschluss` nennt den wirksamen Namen oder `keiner`. Das Projekt-Brain (`docs/`, [ADR 0015](adr/0015-projekt-brain.md)) bleibt in jedem Fall Pflicht.

Der Produktname ist „Self-Improving Agent Harness and Factory“. Er gilt als source-available: der Quelltext ist einsehbar, die Nutzung bleibt vorbehalten, er ist nicht als Open Source lizenziert.

Das Sync-Werkzeug (`npm run factory:sync`, ADR 0022 F9) überträgt den Besitz aus einem Tag der Quelle (`--tag <name>`), für den Stand eines Projekts nie aus dem Arbeitsbaum, das Drift-Gate (`npm run check:factorydrift`) hält ihn im Projekt unverändert und ist ohne Tag oder bei einem unsauberen Quellstand rot (quellprojekt#1871); nur `--entwurf` liest den Arbeitsbaum, zur Probe. Eine ganze Datei, die das Ziel schon in abweichender Fassung hat und die noch nicht im Sync-Stand steht, überschreibt der Sync nie still (`ABGLEICH`, erst `--uebernehmen <pfad>`); Vorlagen (`art: vorlage`, etwa `.github/dependabot.yml`) legt er nur an, wenn sie fehlen (factory#118); eine Einheit mit `modul` (Sicherheits-Module: CodeQL, Scorecard, Secret-Scan, Dependency Review, zizmor, Code-Scanning-Inbox, Audit-Einordnung, Dependabot-Inbox) verteilt er nur, wenn das Ziel das Modul in `module` der Projekt-Config gewählt hat (ohne den Schlüssel gilt nur `dependabot-inbox`; `codeql` braucht `codeql.sprachen`), und löscht beim Abwählen nichts, das Drift-Gate bleibt bis zum nächsten Sync rot; das Manifest steht dafür in Version 3, ein älteres Sync-Werkzeug bricht ab, das eine Update über diese Grenze fährt der Bezieher mit dem Werkzeug der Quelle (`node <quelle>/scripts/factory-sync.mjs --quelle <quelle> --tag <name> --ziel .`, factory#119); `art` verlangt Manifest-Version 2, `modul` Version 3. Der Ist-Zustand bleibt eine Kopie, bis F10 die Quelle als eigenes Repo einführt.

Wer den Harness übernimmt, schließt eine vertragskonforme Sandbox an ([ADR 0025](adr/0025-sandbox-als-austauschbare-laufumgebung.md), [Sandbox anbinden](sandbox-anbinden.md)).

## Java-Profil

**Zweck.** Ein Maven-Multi-Modul-Projekt (Spring Boot) mit Angular-Frontend und ArchUnit nimmt den Harness ohne Kern-Code des Profils auf: die Projekt-Config, die Wurzel-`package.json` als Task-Runner und ein Rezept für den ArchUnit-Ratchet genügen. Belegt ist das durch einen Probe-Lauf (factory#187): ein Probe-Repo mit zwei Maven-Modulen (`domain` als reines Java, `app` mit Spring Boot) und einer Angular-App, im Container gebaut, ohne GitHub-Repo und ohne Push. Die Befehle und Exit-Codes stehen im Pull Request zu factory#187; die Probe fuhr zuerst den Entwurfs-Sync (`factory-sync --entwurf`, Exit 0; `verify` ist dort per Konstruktion rot durch `check:docdrift` und `check:factorydrift`), danach den Sync mit lokalem Tag im Scratch-Klon der Quelle (`factory-sync --tag`), danach waren `verify` und `check:diffcoverage` grün.

**Projekt-Config.** Der Block `struktur` nimmt Listen, `coverage.berichte` die beiden Berichtsarten, `befehle` die Sammelbefehle (Begriffe: [Quellwurzel, Endungsliste, Docmap-Einheit, Coverage-Bericht, Gate-Befehl](harness-glossar.md)):

```json
{
  "struktur": {
    "quelle": ["backend/*/src/main/java", "frontend/src/app"],
    "endungen": [".java", ".ts"],
    "ohne": ["**/*.spec.ts"],
    "docmapEinheit": "ordner",
    "moduldoku": "docs/module"
  },
  "coverage": {
    "berichte": [
      { "format": "jacoco", "pfad": "backend/*/target/site/jacoco/jacoco.xml" },
      { "format": "lcov", "pfad": "frontend/coverage/frontend/lcov.info", "basis": "frontend" }
    ]
  },
  "befehle": {
    "install": "npm ci && npm --prefix frontend ci",
    "coverage": "npm --silent run coverage",
    "testGezielt": "node tools/test-gezielt.mjs"
  }
}
```

- **Globs:** `struktur.quelle` als Liste löst Globs je Eintrag auf; ein Glob ohne Treffer ist ein Fehler mit Fix-Zeile. Maven-Ausgabeordner (`target`, in Gradle `build`, im Frontend `out`) sind keine Skip-Einträge des Glob-Walkers, darum steht in den Globs kein `**`, sondern der Pfad bis zum Modulordner (`backend/*/src/main/java`); ein `**` liefe durch `target` und alle Modulordner.
- **`ohne`** gilt für `check:docmap`, `check:anysuppress` und `check:diffcoverage`, **nicht** für `check:size`: ein großer Spec ist auch ein God-File.
- **`docmapEinheit: "ordner"`:** ein Java-Paket (Ordner mit direkter Quelldatei) ist ein Modul, die Tiefendoc unter `struktur.moduldoku` nennt den Paketpfad in Backticks. Eine neue `.java`-Datei in einem neuen Paket macht `check:docmap` rot; in einem schon genannten Paket nicht. Wer jede Datei einzeln führen will, setzt `"datei"` (dann ist jede neue Datei rot).
- **`basis`** gilt nur für `lcov`: Vitest und Angular schreiben `SF:`-Pfade relativ zum Frontend-Ordner, `basis` setzt ihn davor. JaCoCo-XML nennt Dateien als `paket/Datei.java`; der Leser ordnet sie per Suffix den Quellwurzeln zu und braucht kein `basis`.
- **Schichtmodell für `check:diffcoverage`:** das Gate misst je Schicht (Floors), liest dafür `schichten.layers` aus `scripts/docs-gen/config.json` und bricht ohne diesen Schlüssel mit `schichten.layers fehlt` ab. Die Schicht-Definition des Projekts (CommonJS, Vertrag in [docs-gen übernehmen](#docs-gen-in-ein-anderes-repo-übernehmen-stufe-2-und-3)) trägt für das Java-Profil `quellwurzeln` ohne Glob, je Maven-Modul bis ins Basis-Paket (etwa `backend/app/src/main/java/de/beispiel/probe/app/`) und `endungen: [".java", ".ts"]`; die Schicht-Wurzeln sind Unterordner dieser Wurzeln (etwa `web`, `repo`), alles übrige fällt in die Auffang-Schicht.

**Wurzel-`package.json` als Task-Runner.** Harness-Gates, `docs-gen` und `verify-lauf` setzen npm-Skripte voraus ([Fortschreibung zu ADR 0022](adr/fortschreibungen/0022-182-gate-befehle.md)); Maven und Angular hängen darum als npm-Skripte in der `verify`-Kette, jeder Schritt ein einfaches Skript (die Kette wird in Schritte zerlegt, `verify:kompakt` meldet jeden einzeln):

```json
{
  "scripts": {
    "check:archstore": "node tools/archunit-store.mjs",
    "test:java": "node tools/mvn.mjs -B verify",
    "test:web": "npm --prefix frontend run test:coverage",
    "coverage": "npm --silent run test:java && npm --silent run test:web",
    "test": "vitest run --passWithNoTests",
    "verify": "<Kern-Gates der Quelle> && npm run <archstore> && npm run <java> && npm run <web> && npm test"
  }
}
```

**In der `verify`-Kette** steht jeder Schritt zwingend als `npm run <name>` (oder `npm test`): `verify-lauf` und der Doku-Drift-Wächter zerlegen nur diese Form, ein Kettenschritt in anderer Form (etwa `npm --silent run <name>` oder ein Name mit Zeichen außerhalb von `[\w:.-]`) bricht `verify-lauf` mit „kein einfaches npm-Skript“ und gilt dem Doku-Drift-Wächter als Rohbefehl statt als Schritt; was das Skript `<name>` selbst ausführt, ist frei. Das Beispiel nennt die Namen der Schritte darum als Platzhalter: `<archstore>` ist `check:archstore`, `<java>` ist `test:java`, `<web>` ist `test:web` (der Doku-Drift-Wächter der Quelle läse sie sonst als Skripte der Quelle). Außerhalb der Kette (`coverage`, `befehle`) schreibt das Beispiel `npm --silent run <name>` (ohne npm-Kopfzeile, sonst gleich `npm run`); im Projekt genügt dort `npm run <name>`.

`frontend/package.json` trägt `"test:coverage": "ng test --no-watch --coverage --coverage-reporters=lcov"` und `@vitest/coverage-v8` (Angular mit dem Vitest-Läufer; der Bericht liegt unter `frontend/coverage/<app>/lcov.info`). JaCoCo: `jacoco-maven-plugin` im Eltern-POM mit `prepare-agent` und `report` (Phase `verify`), der Bericht liegt je Modul unter `target/site/jacoco/jacoco.xml`. `.gitattributes` braucht `* text=auto eol=lf` und für den Wrapper `*.cmd text eol=crlf` (sonst meldet der Doctor `Zeilenenden`).

**`./mvnw` geht in cmd.exe nicht.** Unter Windows laufen npm-Skripte in `cmd.exe`, dort ist `./mvnw` kein gültiger Befehl. Der Node-Starter `tools/mvn.mjs` ruft `mvnw.cmd` (Windows) bzw. `./mvnw` (sonst) im Ordner `backend`; alternativ steht `mvn` im PATH:

```js
import { spawnSync } from "node:child_process";
const windows = process.platform === "win32";
const r = spawnSync(windows ? "mvnw.cmd" : "./mvnw", process.argv.slice(2), { cwd: "backend", stdio: "inherit", shell: windows });
process.exit(r.status ?? 1);
```

**Gate-Befehle.** Die sechs Namen des Blocks `befehle` sind `install`, `verify`, `verifyKompakt`, `verifyChanged`, `coverage` und `testGezielt`; ein fehlender Name behält den npm-Standard (`npm ci`, `npm run verify`, `npm run verify:kompakt`, `npm run verify:changed`, `npm run test:coverage`, `npx vitest run`). Aufruf überall gleich: `node scripts/gate-befehl.mjs <name>` (Hintergrund: [Gate-Befehl](harness-glossar.md), [Fortschreibung factory#182](adr/fortschreibungen/0022-182-gate-befehle.md)). **`testGezielt`** ist der einzige Name mit Positionsargumenten: `node scripts/gate-befehl.mjs testGezielt <datei> [<datei> …]` hängt die Pfade in doppelten Anführungszeichen an die Befehlszeile an; erlaubt sind Buchstaben, Ziffern und `_ . / \ : @ + = , -`, alles andere (Leerzeichen, Shell-Metazeichen) endet mit Exit 2. Maven kennt keine Dateipfade als Argumente, darum bekommt `testGezielt` einen Wrapper: `tools/test-gezielt.mjs` ordnet `backend/<modul>/…/<Klasse>.java` dem Modul zu und ruft `-pl <modul> -am -Dtest=<Klasse>,<Klasse>Test`, `frontend/…/*.ts` dem Angular-Läufer (`ng test --include <pfad>`), alles andere `vitest`. `verify:changed` kürzt nur Lint und Vitest auf die geänderten Dateien; Maven und Angular laufen dort voll, und ohne `test/`-Ordner meldet es „Slice nicht lesbar“ und fährt Lint und Test voll.

**Coverage-Leser (Ports und Adapter).** Der Port ist `ladeAbdeckung` in `scripts/coverage-berichte.mjs`: er liest alle `coverage.berichte` und liefert Zeilen- und Zweigabdeckung je Repo-Pfad an `check:diffcoverage`. Jede Berichtsart ist ein Adapter:

| Format | Adapter | Zuordnung zum Repo-Pfad | Zählweise |
|---|---|---|---|
| `lcov` (Vitest/Istanbul, Angular, `coverage lcov` bei Python) | `parseLcov`, Zweige `parseLcovBranches` | `SF:` relativ, davor `basis` | Zeilen über `DA:`, Zweige über `BRDA:` |
| `jacoco` (JaCoCo-XML) | `parseJacoco` | `paket/Datei.java` per Suffix gegen die Quellwurzeln, kein `basis`; dieselbe Datei unter zwei Quellwurzeln ist mehrdeutig (rot) | nur Zeilen mit `<line>` zählen, gedeckt bei `ci > 0`; `mb`/`cb` speisen „teilweise getestet“ |

Dieselbe Datei in mehreren Berichten wird gemischt; jeder konfigurierte Bericht ist Pflicht (ein Glob ohne Treffer ist ein Fehler). Ein neuer Adapter ist eine neue `format`-Zeile im Kern, kein Projekt-Code.

**ArchUnit mit eingefrorenem Bestand.** Das Muster ist das der [Grundregel](#grundregel-bestand-einfrieren-statt-sanieren), umgesetzt mit `FreezingArchRule.freeze(...)`:

- `src/test/resources/archunit.properties` je Modul mit `freeze.store.default.path=src/test/resources/archunit_store`, `freeze.store.default.allowStoreCreation=false` und `freeze.refreeze=false`; der Store (`stored.rules` plus eine Datei je Regel mit den Verstößen) ist **eingecheckt**. `freeze.refreeze` steht nie auf `true`: ein Refreeze schriebe jeden neuen Verstoß in den Store und machte die Regel wirkungslos.
- Den Store legt man **einmal** an: `./mvnw verify -Darchunit.freeze.store.default.allowStoreCreation=true`, dann einchecken.
- Semantik (im Probe-Lauf belegt): eine **neue** Verletzung macht den Test rot, die Meldung nennt die Regel („was violated (n times)“); eine **eingefrorene** bleibt grün, auch wenn sich ihre Zeilennummer verschiebt (der Store bleibt dann unverändert); eine **gelöste** Verletzung wird beim nächsten Lauf aus dem Store entfernt (der Store schrumpft, Diff mit einchecken).
- Grenze von `allowStoreCreation=false`: es verhindert nur, dass ein **fehlender** Store neu entsteht (der Lauf endet mit „Creating new violation store is disabled“). Eine **neue Regel** mit Verstößen legt ArchUnit trotzdem im vorhandenen Store an und der Lauf bleibt grün; `freeze.store.default.allowStoreUpdate=false` ließe sie scheitern („Updating frozen violations is disabled“), sperrt aber jede Store-Änderung. Diese Lücke schließt der Store-Wächter.
- **Store-Wächter `check:archstore`** (Projektdatei des Profils, kein Kern-Gate: nur ein Projekt mit ArchUnit-Store braucht ihn): Rot, wenn (1) `freeze.refreeze=true` in einer getrackten `archunit.properties`, in der `pom.xml` (`archunit.freeze.refreeze` mit `true`), in `.mvn/maven.config`, `.mvn/jvm.config` oder einem Skript der Wurzel-`package.json` steht; (2) der Store gegenüber der Basis **wächst**: je Regeldatei (Schlüssel = Dateiname, `stored.rules` ausgenommen) die Mengen-Differenz der nicht-leeren Zeilen HEAD gegen Basis; eine neue Zeile oder eine neue Regeldatei ist rot, ein Rückgang grün. Basis wie im Kern (`FACTORY_DIFF_BASE`, sonst Merge-Base mit `origin/main`, sonst `main`). Ventil: die Commit-Zeile `<praefixe.commitZeile>ArchStore-Override: #<nr> warum` in `git log <basis>..HEAD`, nur mit offenem Ticket. Grenzen: Heuristik auf Mustern, ein nur lokal auf der Kommandozeile gesetztes `-D` ist unsichtbar (seine Wirkung fängt die Wachstumsprüfung); eine umbenannte Regel zählt als neue Regel; ohne ermittelbare Basis (kein `origin/main`, kein `main`) entfällt die Wachstumsprüfung still; eine auskommentierte Zeile `# freeze.refreeze=true` ist ein Fehlalarm; der Dateifilter liest auch `frontend/package.json`; das Rezept ist in der Factory nicht getestet, der Probe-Lauf hat es belegt.

```js
// check:archstore (Projektdatei des Java-Profils, kein Kern-Gate): ArchUnit-Ratchet nur in die strenge Richtung.
// Rot, wenn (1) freeze.refreeze=true gesetzt ist: getrackte archunit.properties, pom.xml (archunit.freeze.refreeze mit true),
// .mvn/maven.config, .mvn/jvm.config oder ein Skript der Wurzel-package.json; (2) der eingecheckte Store gegenüber der Basis wächst
// (je Regeldatei neue nicht-leere Zeile oder neue Regeldatei; stored.rules ausgenommen). Ventil: Commit-Zeile `<praefixe.commitZeile>ArchStore-Override: #<nr> warum`.
// Grenze: ein nur lokal auf der Kommandozeile gesetztes -D ist unsichtbar, seine Wirkung fängt die Wachstumsprüfung. Heuristik, kein Beweis.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const versuche = (f) => { try { return f(); } catch { return ""; } };
const base = process.env.FACTORY_DIFF_BASE || versuche(() => git("merge-base", "origin/main", "HEAD")) || versuche(() => git("merge-base", "main", "HEAD"));
const dateien = git("ls-files").split("\n");
const fehler = [];
const praefix = JSON.parse(readFileSync(".factory/projekt.json", "utf8")).praefixe.commitZeile;

const REFREEZE = /freeze\.refreeze\s*[=:]\s*true|archunit\.freeze\.refreeze(?:=|<\/|>)\s*true/i;
for (const f of dateien.filter((d) => /(^|\/)(archunit\.properties|pom\.xml|maven\.config|jvm\.config|package\.json)$/.test(d))) {
  if (REFREEZE.test(readFileSync(f, "utf8"))) fehler.push(`${f}: freeze.refreeze=true`);
}

const zeilen = (txt) => new Set(txt.split("\n").map((z) => z.trim()).filter(Boolean));
const stores = dateien.filter((d) => /(^|\/)archunit_store\/[^/]+$/.test(d) && !d.endsWith("/stored.rules"));
const ventil = base ? versuche(() => git("log", `${base}..HEAD`, "--format=%B")).includes(`${praefix}ArchStore-Override: #`) : false;
for (const f of base ? stores : []) {
  const alt = zeilen(versuche(() => git("show", `${base}:${f}`)));
  const neu = [...zeilen(readFileSync(f, "utf8"))].filter((z) => !alt.has(z));
  if (neu.length && !ventil) fehler.push(`${f}: ${neu.length} neue Verstoßzeile(n), der Store darf nur schrumpfen`);
}
if (fehler.length) {
  console.error(`check:archstore rot:\n${fehler.map((f) => `  - ${f}`).join("\n")}\nFix: Verletzung beheben statt einfrieren; Ausnahme nur mit Commit-Zeile ${praefix}ArchStore-Override: #<nr> warum.`);
  process.exit(1);
}
console.log(`check:archstore grün (${stores.length} Regeldatei(en), Basis ${base ? base.slice(0, 7) : "keine"})`);
```

**Ablauf der Übernahme.** [Erstbezug](erstbezug.md) gilt unverändert; für dieses Profil gehören dazu: ein Board mit Rolle `factory` in `.factory/projekt.json` (der Sync bricht sonst ab), `.gitattributes`, `node scripts/projektwerte.mjs --write` nach dem Sync, ein `test`-Skript mit `--passWithNoTests` (der Sync liefert keine Projekt-Tests), die beiden Referenzseiten mit je einer `Kern:`-Zeile auf die Seite der Quelle samt `npm run check:factorylinks -- --schreiben --quelle <klon>`, die Schicht-Definition für `check:diffcoverage` und die Tiefendoc je Paket. Nach dem Entwurfs-Sync (`--entwurf`) ist `verify` per Konstruktion rot: `check:docdrift` (Doku-Links der Kern-Skills ohne Anker-Stubs) und `check:factorydrift` (Sync-Stand ohne Tag; Hinweis an factory#188); grün wird es erst mit `--tag`. Der erste Sync-PR braucht `<praefixe.commitZeile>Diffsize-Override: #<nr> warum`, weil der Besitz auf einmal kommt.

## Gliederung für Artikel oder Vortrag

**These: „Ein Diagramm ist eine Regel.“** Agenten brauchen Mauern statt Bitten, und eine Doku, die aus derselben Quelle entsteht wie die Prüfung, kann nicht lügen.

1. **Vorher.** Die README-Gate-Tabelle nannte 7 von 12 Gates ([ADR 0017](adr/0017-lebende-doku-generierte-abschnitte.md), Kontext); ein Architektur-PNG ohne Quelle, entfernt in `102cb7a` (quellprojekt#1369); falsche Aussagen in der README, die quellprojekt#1354 gesammelt hat.
2. **Das Muster.** Bitte → Mauer ([agent-harness.md › Leitplanken-Schichten](agent-harness.md#leitplanken-schichten-bitte-und-mauer)): jede wiederholte Bitte an einen Agenten wird zum Gate.
3. **Nachher, belegt aus Git.** Generierte Gate-Tabelle und Inventar (`110a0b4`), Schichten Soll und Ist in README und arc42 §5 (`10d27a6`), Agenten-Ablauf, Sequenz und Leitplanken-Schichten (`102cb7a`), Produkt-Diagramme (`1d83039`). Jeder Beleg ist mit `git show <sha> --stat` reproduzierbar.
4. **Diagramme.** Die generierten Schichten- und Agenten-Diagramme in [README](../README.md), arc42 und [agent-harness.md](agent-harness.md#leitplanken-schichten-bitte-und-mauer) (Quellen: quellprojekt#1368, quellprojekt#1369).
5. **Übertragung.** Die Reifestufen oben, Bestand per Baseline einfrieren, das Werkzeug-Mapping, der Fremd-Repo-Test als Beleg.
6. **Grenzen, ehrlich.** MCP-Server sind nie Quelle eines Gates; der Ist-Graph wird bei Wachstum unleserlich und muss verdichtet werden; ein handgeschriebenes LikeC4-Modell driftet ohne Abgleichtest; ein Generator für Nicht-npm-Task-Runner fehlt.
7. **Öffentliche Quellen zum Weiterlesen:** Cyrille Martraire, *Living Documentation* (Doku aus der Quelle ableiten); OpenAI, „Harness engineering“ (Umgebung statt Prompt als Hebel).
