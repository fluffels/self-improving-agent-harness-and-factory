# ADR 0030: Team-Betrieb im Pod, Anforderungen und offene Entscheidungen

> Architecture Decision Record. Format: Kontext → Optionen → Entscheidung → Konsequenzen → Re-Evaluierung.
> Status: **vorgeschlagen** · Datum: 2026-10-28 · Ticket: #90

## Status

**Vorgeschlagen.** Konkretisiert [ADR 0025](0025-sandbox-als-austauschbare-laufumgebung.md) für eine Laufumgebung auf Kubernetes. Ein Teil ist entschieden (Sandbox, Image-Pinning), ein Teil bewusst offen (Auth und Lizenz, Headless-Betrieb), ein Teil nur als Idee festgehalten. Der Pod-Bau beginnt erst, wenn die Auth-Frage entschieden ist.

## Kontext

Läufe sollen im Namen eines Teams in einem Pod laufen statt in einer persönlichen Sitzung. Dafür fehlt eine Reihe von Festlegungen. Dieser ADR sammelt sie an einem Ort, trennt Entschiedenes von Offenem und schreibt nichts fest, was nur die Maintainerin entscheiden kann.

## 1. Auth und Lizenz: offen

**Entscheidung der Maintainerin vor dem Pod-Bau.** Läufe im Namen des Teams brauchen vermutlich API-Schlüssel statt einer persönlichen Subscription. Kriterien für die Wahl:

- **Kosten** je Lauf und je Ticket.
- **Secret-Handling** nach Stufe V3 der Sandbox ([ADR 0025](0025-sandbox-als-austauschbare-laufumgebung.md)): wie der Schlüssel in den Pod kommt, ohne im Repo oder im Image zu liegen.
- **Rate-Limits** bei parallelen Läufen.
- **Kostenexport**: die Langfuse-Kosten müssen je Ticket exportierbar sein.

## 2. Sandbox V1/V2 auf Kubernetes: entschieden

Anforderungen auf dem Vertrag aus [ADR 0025](0025-sandbox-als-austauschbare-laufumgebung.md); verletzt eine auch nur teilweise, gilt der Pod als nicht gesandboxt:

- **Egress** per `NetworkPolicy` plus Egress-Proxy-Sidecar; der Proxy schreibt ein Protokoll je Lauf (erlaubte und geblockte Ziele), das ausgewertet werden kann.
- **Clone-Strategie:** Vollklon oder Partial Clone, kein Shallow-Clone bei Branch-Arbeit (Merge-Basis und Merge-Prüfungen brauchen die Historie).
- **Abhängigkeiten:** `npm ci` im eigenen Volume des Pods, nie ein zwischen Host und Container oder zwischen Läufen geteiltes `node_modules`.

## 3. Images pinnen: entschieden

Agent-Images werden per Digest gepinnt. Ein Update läuft per PR mit Probe-Lauf, der die Hooks und die Langfuse-Erfassung nachweist (#1293).

## 4. Ideen, nicht entschieden

- **A/B-Vergleich von Varianten:** ein Variantenlabel (Modell, Prompt, Skill-Stand) als Trace-Metadatum, damit Tokens und Schleifen je Variante vergleichbar werden.
- **Autonomiequote:** Anteil der Tickets ohne menschlichen Eingriff, abgeleitet aus `lauf-ergebnis.mjs` und der Festgefahren-Quote. Was ein „Eingriff“ ist, ist offen.
- **Ticket-Modus** („schrittweise“ gegen „vollautomatisch“) als projektneutraler Konfigurationsschalter, passend zu den Checkpoints (#1012).
- **Headless-Betrieb** (CronJob oder Queue, `claude -p`): hängt an der Auth-Entscheidung aus Abschnitt 1. Als weitere Ideen: eine Review-Feedback-Schleife, die externe Review-Kommentare als Fremdtext (#1433) einarbeitet, und die CVE-Analyse als Zusatzjob.

## Konsequenzen

- Vor dem Pod-Bau braucht es genau eine Entscheidung (Abschnitt 1); danach wird der Status auf **akzeptiert** gesetzt oder der ADR durch eine Fortschreibung verknüpft.
- Die Abschnitte 2 und 3 sind als Anforderungen an einen Pod-Bau prüfbar und gehören in dessen Abnahme.
- Die Ideen aus Abschnitt 4 werden bei Bedarf Zeilen eines Sammeltickets, keine eigenen Tickets.

## Re-Evaluierung

Bei der Entscheidung zur Auth-Frage und vor dem ersten Pod-Lauf.
