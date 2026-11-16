# ADR 0036: Ticket-Tag an jeder Generation: der Nachlieferer ist der einzige Sender

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Revert-Weg → Re-Evaluierung.
> Status: **akzeptiert** · Datum: 2026-11-16 · Ticket: factory#521 (Teil von factory#510)

## Status

**Akzeptiert.** Präzisiert [ADR 0019](0019-langfuse-plugin-im-user-scope.md) (das Plugin bleibt im User-Scope für fremde Repos aktiv, kein Widerspruch: nur im Projekt-Scope entfällt der Generations-Sender) und löst den Erfassungsweg von [ADR 0023](0023-transkript-quelle-der-wahrheit-langfuse-abgleich.md) im Projekt-Scope ab (dort war das Plugin der Sender, der Nachlieferer nur der Lückenfüller). Die Umsetzung ist factory#524.

## Kontext

Kosten je Ticket brauchen an jeder Generation ein filterbares Feld `<praefixe.worktree><nr>` („Ticket-Tag“, [Glossar](../harness-glossar.md)). Belege aus vorhandenen Quellen und je einem lesenden `getObservation` (2026-11-16, nur Schlüsselnamen):

- **Heute:** `LLM Call` trägt die Tags `claude-code`, `skill:<name>` und das Projekt-Tag; `Subagent LLM Call` zusätzlich `subagent-skill:<name>`. Die Metadaten sind nur Hook-Technik (`history`, `tool_count`, `assistant_index`, `assistant_text`, `speed`, `scope.*`, `resourceAttributes.*`), keine Zuordnungs-Metadaten, kein Ticket. `environment` ist der Projektname. Die Tags stehen an der Observation selbst.
- **Env pro Turn:** `CC_LANGFUSE_TRACE_TAGS` hängt je Session beim Start fest ([Trace-Tag](../model-routing.md#langfuse-hook-patch-pflegen-10841122)). Eine Env-Änderung während der Session wirkt nicht.
- **Plugin-Option:** Die öffentliche Plugin-Doku war im Rahmen dieses Tickets nicht lesbar (ein Abruf, HTTP 404; nicht weiter geprüft, Token-Budget). Belegte Grenze: Die Repo-Doku kennt nur den Session-Tag über `CC_LANGFUSE_TRACE_TAGS`, keine Option je Turn.
- **Nachträglich taggen:** Langfuse v4 ändert Beobachtungen nach der Ingestion nicht (factory#288, verworfen); der Hook-Patch bleibt lokal (ADR 0023).
- **Abgleich-Traces** tragen `<praefixe.worktree><nr>` schon, aber nur bei passendem Branch (Teilmenge, [Hook-Patch](../langfuse-hook-patch.md)).

## Optionen

Bewertet nur nach: Doppelzählung, parallele Sessions im selben Checkout, mehrere Tickets je Session, Bezieher ohne Projektwort.

- **A. Env pro Turn: verworfen.** Der Wert hängt ab Sessionstart fest, trennt also keine mehreren Tickets je Session, und parallele Sessions im selben Checkout teilen dieselbe Settings-Datei.
- **B. Plugin-Option oder Patch: verworfen.** Es gibt keine Option für Tags je Turn, ein Patch am Plugin widerspräche ADR 0023 (der Hook-Patch bleibt lokal) und träfe jeden Bezieher.
- **C. Der Nachlieferer als einziger Sender: gewählt.** Er setzt das Ticket je Call aus den Claim-Fenstern des Haupttranskripts (Zeitraum zwischen Claim und Freigabe eines Tickets), unabhängig von Env und Projektwort (das Repo kommt aus der Projekt-Config); mehrere Tickets je Session und parallele Sessions trennt das Fenster je Call.

## Entscheidung

Option C. Im Projekt-Scope sendet das Plugin keine Generations mehr, der Nachlieferer sendet jede Generation mit Ticket-Tag. Im User-Scope fremder Repos bleibt das Plugin unverändert aktiv (ADR 0019).

**Negativfall (ausgeschlossen):** jeder Weg, der dieselben Calls zweimal mit Kosten nach Langfuse schreibt (Plugin und Nachlieferer zugleich), und jeder Weg, der Live-Daten ändert (Nachtaggen, Löschen; vgl. ADR 0023 „Dubletten nur melden“). Darum gilt ein Stichtag: Generations davor bleiben unverändert, ohne Ticket-Tag.

## Konsequenzen

- Offene Umsetzungsfrage für factory#524: Mit den Plugin-Generations entfallen womöglich auch die Plugin-Spans (TOOL-Events, die `token-baseline.mjs --langfuse` nutzt). Ob das ganze Plugin oder nur die Generations im Projekt-Scope wegfallen, entscheidet factory#524.
- Alte Generations bleiben ohne Ticket-Tag; Kosten je Ticket gelten erst ab dem Stichtag aus Langfuse, davor aus dem Transkript.
- Nachlieferer und Transkript bleiben die Quelle der Wahrheit (ADR 0023).

## Revert-Weg

Das Plugin im Projekt-Scope wieder einschalten und den Nachlieferer auf reines Lückenfüllen zurücksetzen (Stand ADR 0023). Daten bleiben unberührt, nichts wird gelöscht oder umgeschrieben.

## Re-Evaluierung

Wenn Langfuse Updates an Generations erlaubt oder das Plugin Tags je Turn anbietet.
