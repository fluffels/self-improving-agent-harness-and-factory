# Architekturentscheidungen (ADRs)

> Index und Vorlage. Die Tabelle unten wird aus den ADR-Köpfen erzeugt (`npm run docs:gen`, Generator `adr-liste`, [ADR 0017](0017-lebende-doku-generierte-abschnitte.md)); die Zeitleiste in der [README](../../README.md) nutzt dieselben Köpfe. **Wann welcher ADR zu lesen ist:** [Anlaufstellen](../referenz/anlaufstellen.md).

<!-- GEN:adr-liste START -->
<!-- Generiert von npm run docs:gen – nicht von Hand ändern. -->

| ADR | Titel | Status | Datum |
|---|---|---|---|
| [0008](/docs/adr/0008-ki-agenten-harness.md) | KI-Agenten-Harness als Entwicklungsmodell | akzeptiert | 01.07.2026 |
| [0009](/docs/adr/0009-pr-gating-required-checks.md) | PR-Gating mit Required-Checks auf `main` (statt Direkt-Push) | akzeptiert | 03.07.2026 |
| [0012](/docs/adr/0012-harness-autonomie-audit-spur.md) | Harness-Autonomie — Audit-Spur statt Merge-Freigabe, Fokus der Harness-Phase | akzeptiert | 28.09.2026 |
| [0013](/docs/adr/0013-docs-als-agentengepflegtes-wiki.md) | `docs/` als agentengepflegtes Wiki — kein zweiter Wissensspeicher, kein externes Brain | akzeptiert | 29.09.2026 |
| [0014](/docs/adr/0014-leitplanken-ohne-label-riegel.md) | Leitplanken ohne Label-Riegel — Audit-Kommentar und Verhaltensregel statt CI-Job | akzeptiert | 06.10.2026 |
| [0015](/docs/adr/0015-projekt-brain.md) | Projekt-Brain — `docs/` nach Second-Brain-Prinzipien, token-sparsam und messbar | akzeptiert | 07.10.2026 |
| [0016](/docs/adr/0016-langfuse-takt-woechentlich.md) | Langfuse-Takt — wöchentlicher Workflow statt Board-Position | akzeptiert | 07.10.2026 |
| [0017](/docs/adr/0017-lebende-doku-generierte-abschnitte.md) | Lebende Doku — generierte Abschnitte, und ein Diagramm ist eine Regel | akzeptiert | 07.10.2026 |
| [0019](/docs/adr/0019-langfuse-plugin-im-user-scope.md) | Das Langfuse-Plugin bleibt auch im User-Scope aktiv | akzeptiert | 07.10.2026 |
| [0021](/docs/adr/0021-agenten-sandbox-wsl2.md) | Agenten-Sandbox über eine eigene WSL2-Distribution | akzeptiert | 08.10.2026 |
| [0022](/docs/adr/0022-dark-factory-kern-und-verteilung.md) | Dark Factory — Kern-Schnitt des Harness und Verteilung per Sync mit Besitz-Manifest | akzeptiert, Workflow-Pfad entfernt: präzisiert durch ADR 0028, Ring Oberfläche: präzisiert durch ADR 0029, Ticket-Ablauf im Ring kern und Produkt-Skill im Projekt: präzisiert durch ADR 0028, Fortschreibung #1806, Betrieb ohne Harness im Projekt-Repo: Fortschreibung #1829 | 08.10.2026 |
| [0023](/docs/adr/0023-transkript-quelle-der-wahrheit-langfuse-abgleich.md) | Das Transkript ist die Quelle der Wahrheit, Langfuse wird abgeglichen | akzeptiert | 09.10.2026 |
| [0025](/docs/adr/0025-sandbox-als-austauschbare-laufumgebung.md) | Sandbox als austauschbare Laufumgebung | akzeptiert | 16.10.2026 |
| [0026](/docs/adr/0026-sammelticket-gruppen.md) | Sammeltickets in Gruppen mit frischem Kontext, Generationsgrenze statt Wachstum | akzeptiert, Entscheidung 3 abgelöst (#1687), Workflow-Pfad entfernt: präzisiert durch ADR 0028 | 16.10.2026 |
| [0027](/docs/adr/0027-regeln-lockern.md) | Regeln, Gates und Lenses evidenzbasiert lockern | akzeptiert | 16.10.2026 |
| [0028](/docs/adr/0028-ein-ticket-ablauf.md) | Genau ein Ticket-Ablauf, der Workflow-Pfad entfällt | akzeptiert | 16.10.2026 |
| [0029](/docs/adr/0029-harness-cockpit.md) | Harness-Cockpit als Ring „Oberfläche“ im Factory-Repo, Eigenbau, nur lesend | akzeptiert | 16.10.2026 |
| [0030](/docs/adr/0030-team-betrieb-pod.md) | Team-Betrieb im Pod, Anforderungen und offene Entscheidungen | vorgeschlagen | 28.10.2026 |

<!-- GEN:adr-liste END -->

## Format

- **Historisch:** ein ADR wird nie umgeschrieben, sondern verknüpft; die Regel steht in AGENTS.md › Projekt-Brain pflegen. Ein Nachtrag zu einer laufenden Entscheidung ist eine eigene Datei `fortschreibungen/<NNNN>-<ticket>-<slug>.md` mit erster Zeile `# Fortschreibung #<Ticket> (JJJJ-MM-TT): <Thema>`; das ADR trägt am Ende einen Zeiger `fortschreibungen/<NNNN>-…` (Abschnitt „Weitere Fortschreibungen (als Dateien)“). Die älteren angehängten `## Fortschreibung`-Abschnitte bleiben stehen, ihre Zahl je ADR ist eingefroren (`test/harness/adr-fortschreibung.test.ts`).
- **Dateiname** `NNNN-kurzer-slug.md` (ASCII, vierstellig fortlaufend), **erste Zeile** `# ADR NNNN: Titel` (die Nummer muss zum Dateinamen passen).
- **Kopf-Format** (vom Generator erzwungen, sonst ist `check:docgen` rot): vor der ersten `##`-Überschrift die Zeile `> Status: **<Status>** · Datum: JJJJ-MM-TT · Ticket: #<nr>`. Das Datum ist ein gültiges Kalenderdatum und hat nichts dahinter hängen. Das ältere Listenformat `- **Status:** <Status> (JJJJ-MM-TT)` wird weiter gelesen, für neue ADRs gilt das Blockquote-Format.
- **Abschnittsfolge:** Status, Kontext, Optionen (mit Bewertung), Entscheidung („Entscheidung: X, weil Y“), Konsequenzen, Re-Evaluierung (nachprüfbarer Auslöser statt „für immer“).
- **Index:** die Tabelle oben zieht `npm run docs:gen` nach; die „wann lesen“-Zeile steht in [Anlaufstellen](../referenz/anlaufstellen.md).

## Vorlage

```markdown
# ADR NNNN: Titel

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **akzeptiert** · Datum: JJJJ-MM-TT · Ticket: #<nr>

## Status

**Akzeptiert.** Präzisiert/löst ab: [ADR MMMM](MMMM-slug.md) (falls zutreffend).

## Kontext

Welches Problem, welche Zwänge, was wurde gemessen?

## Optionen

| Option | Bewertung |
|---|---|
| **A** | … |
| **B (gewählt)** | … |

## Entscheidung

Entscheidung: **X**, weil Y.

## Konsequenzen

Was folgt daraus, was wird schwerer?

## Re-Evaluierung

Unter welcher nachprüfbaren Bedingung wird neu entschieden?
```
