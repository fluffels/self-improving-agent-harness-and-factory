# Fortschreibung #237 (2026-11-13): Raum-Vertrag und Budget-Ratchet

Ergänzt [ADR 0035](../0035-kontext-vertrag-kern-und-bezieher.md), Konsequenzen: Umsetzung der Entscheidung (Variante A, Kern-Block plus fester Projekt-Raum in `AGENTS.md`) als Gate. Herkunft: Epic Kontext-Budget (factory#228), Teil 5.

Der Kontext-Vertrag bleibt (12.800 Raum, 15.200 Kern, 28.000 Gesamt), darum keine `Bezieher-Migration`-Zeile und `.factory/besitz.json` unverändert (die Gate-Dateien liegen schon im Ring `kern`, der neue Wächter ist fabrik-eigen).

- **Raum-Vertrag als Wächter:** `test/harness/raum-vertrag.test.ts` prüft die Gleichung, den echten Kern gegen sein Budget und per Red-Green den Kern bei Budget plus 1; `check:contextsize` prüft in der Fabrik zusätzlich `kernRaumBefund` (jetzt auch eine Lücke). Der Kern kann damit nie über seine Grenze wachsen, ohne dass Pflicht-Checks (`build-test`, `Probe-Erstbezug`) rot sind; `tag-takt` sperrt den Tag bei roter CI.
- **Knapp-Signal:** für `AGENTS.md` heißt „knapp“ im Sync-Hinweis: Projekt-Block über dem Projekt-Raum bei noch passendem Gesamtbudget; die 5-%-Regel überlappte damit (factory#220 L57) und bleibt für andere Dateien. `ueberBudget` und `knappeBudgets` teilen eine Schleife.
- **Ratchet mit Beleg:** eine Mechanik (`kontext-budget-ratchet.test.ts`) für alle Budgets; Anheben braucht `SIH-Budget-Beleg: <Link zur Messung> <Begründung>`, der Projekt-Raum darf nur mit Beleg und `Bezieher-Migration` sinken. Pflicht-Literale und ein Scan stellen sicher, dass kein Ausdruck und kein Werkzeug ein Budget am Ratchet vorbei bewegt. Prüftermin: `regeln-verfall-2027-03` (ADR 0027).
