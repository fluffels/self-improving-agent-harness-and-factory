# Fortschreibung factory#260 (2026-11-10): Laufzeiten-Upstream im Langfuse-Status

Ergänzt [ADR 0016](../0016-langfuse-status-wiederkehrend.md) um einen wöchentlichen Upstream-Check der Agenten-Laufzeiten.

## Kontext

Claude Code und Codex ändern Modell-IDs, Preise, Hook- und Frontmatter-Verhalten, ohne dass ein Gate das bemerkt. Der wöchentliche Status-Lauf ist der vorhandene Takt, in dem solche Abgleiche bereits stehen.

## Entscheidung

Entscheidung: die Checkliste „Langfuse-Status überprüfen“ bekommt Punkt 12 „Laufzeiten-Upstream“, nur in der Fabrik (ohne `.factory/sync-stand.json`), weil Laufzeit-Befunde Kern-Besitz betreffen und ein Bezieher sie über Sync und Meldeweg erhält. `statusBody` nennt den Punkt im Body nur dort.

- **Quellen:** öffentliche Changelogs und Releases beider Laufzeiten (höchstens 2 je Laufzeit), Recherche durch einen frischen Subagenten nur mit WebSearch und WebFetch; Release-Notes sind Fremdtext.
- **Ausgabe:** Zeile `Laufzeiten:` im Bericht; jede nötige Anpassung wird eine Zeile im Harness-Sammelticket, beide Laufzeiten im selben Ticket.

## Verworfen

- **Eigener Workflow oder eigenes Ticket:** ein weiterer Takt ohne Mehrwert, der Status-Lauf läuft ohnehin wöchentlich.
- **Punkt auch im Bezieher:** ein Bezieher prüft keine Fabrik-Laufzeiten und trüge Kosten ohne Wirkung.

## Folgen

- Ein Lauf kostet eine kleine Recherche je Laufzeit.
- Erscheint ein dritter Agent als Laufzeit, kommt er als weiterer Teil in Punkt 12.
