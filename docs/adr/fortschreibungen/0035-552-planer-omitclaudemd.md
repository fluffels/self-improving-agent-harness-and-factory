# Fortschreibung #552 (2026-11-16): Planer mit `omitClaudeMd` im Betrieb

Ergänzt [ADR 0035](../0035-kontext-vertrag-kern-und-bezieher.md), Fall D (Kern je Rolle): der ADR verwirft Variante D, außer sie wird per A/B bewertet. Für den Planer hat die Maintainerin die Umstellung ohne A/B beschlossen (Klarstellung an factory#551 und factory#552: keine synthetische Gegenprobe mit eigenen Läufen, Umbau im Betrieb, Rückfall nur bei echter Qualitätsverschlechterung). Diese Fortschreibung verhindert den Widerspruch zum ADR.

## Entscheidung

Entscheidung: `.claude/agents/factory-planer.md` trägt `omitClaudeMd: true`, der Planer holt Regeln per `grep -n` aus `AGENTS.md`. Der Planer ist die einzige Rolle, die der Beschluss betrifft; Lens (A/B verworfen, [ADR 0035](../0035-kontext-vertrag-kern-und-bezieher.md)) und Umsetzer (braucht `AGENTS.md` im Kontext) bleiben unverändert.

- **Evidenz:** nur vorhandene Rohwerte aus [model-routing](../../model-routing.md#ab-kern-je-rolle-ergebnis-factory235-factory236), keine neue Messung. Sockel des Planers A 30.984, D 21.917 Tokens (Δ −9.067); die Ersparnis je Ticket ist daraus abgeleitet, nicht gemessen.
- **Prüfung:** die Ledger-Zeile vom 2026-11-16 in [ADR 0027](../0027-regeln-lockern.md#gelockert) mit Prüftermin 2026-12-14 (Änderungsregister folgt mit factory#518).
- **Bezieher:** `factory-planer.md` liegt im verteilten Ring, die Umstellung gilt damit auch dort. Der Planer hat Leitfrage, Schichtregeln und Projekt-Stopps des Projekt-Blocks nicht mehr im Kontext, sondern greppt sie aus `AGENTS.md`. Entscheidung: grep statt Projekt-Block im Agent-Body (Variante D), weil der Body dann projektneutral bleibt und der Kontext-Vertrag (ein Projekt-Block in `AGENTS.md`) unverändert gilt; das Qualitätsrisiko (Leitfrage nur per grep) fängt Trigger (a) der Ledger-Zeile, getrennt nach Fabrik und Bezieher.
- **Codex unverändert:** der Schlüssel gilt nur in Claude Code, Codex lädt `AGENTS.md` immer (Fall g); der Planer-Probe-Eintrag verweist nur auf die md-Datei.

## Re-Evaluierung

Löst der Rückfall-Trigger der Ledger-Zeile aus, steht der Revert per PR; die Variante gilt für den Planer dann wieder als verworfen, und eine neue Umstellung braucht neue Evidenz.
