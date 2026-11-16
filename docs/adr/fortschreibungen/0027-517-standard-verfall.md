# Fortschreibung #517 (2026-11-16): Standard-Verfall als zweiter Weg neben Punkt 2

Ergänzt [ADR 0027](../0027-regeln-lockern.md) (Punkte 2, 3 und 6); die Ledger-Zeilen bleiben unverändert (Punkt 8). Teil 3/4 von factory#517, gebaut in factory#610; Messung und Kandidaten: [Fortschreibung factory#518](0027-518-aenderungsregister.md#standard-verfall-factory608).

## Kontext

Punkt 2 verlangt für jedes Lockern gemessene Kosten und Fundfreiheit über drei Status-Läufe und geht über ein Sammelticket und einen eigenen PR. Das Harness wächst dadurch einseitig: eine Regel, die nie etwas fängt, bleibt, solange niemand sie bewusst anfasst. Der Standard-Verfall dreht den Normalfall um: Jede Regel und jeder Wächter trägt eine Registerzeile `art: "verfall"` und verfällt nach 30 Tagen ohne Fang, wenn niemand widerspricht.

## Entscheidung

Entscheidung: Der Standard-Verfall ist ein **zweiter Weg** zum Lockern neben Punkt 2, weil die Beweislast beim Behalten liegen soll (ein Fang im Fenster oder ein Widerspruch), nicht beim Entfernen. Punkt 2 bleibt unverändert der Weg für alles, was der Standard-Verfall nicht erfasst (Regel ohne messbaren Wächter, Prompt-Regeln, Gates mit Ersatz).

- **Kandidat:** `heute >= ablauf` der Registerzeile und kein Fang in den letzten 30 Kalendertagen (`node scripts/regel-verfall.mjs --kandidaten`). „Nicht messbar“ (kein Wächter, keine Messpunkte) ist nie Kandidat: eine Lücke ist keine Null.
- **Streich-PR:** `node scripts/regel-verfall.mjs --streich-pr` legt je Kandidat einen Branch und einen PR an. Gestrichen wird mechanisch: die Wächter-Datei wird gelöscht, bei einer Regel entfallen die exakten Zeilen des Ankers (in `AGENTS.md` der Listenpunkt samt eingerückter Folgezeilen, in einer Doku-Seite der Abschnitt der Überschrift); die Registerzeile bekommt `gestrichen: <Datum>` und ist nie wieder Kandidat. Nicht eindeutig oder nicht gefunden heißt: kein PR, nie geraten. Der PR trägt das Label `verfall-streich-pr` und im Body Fangquote, Fenster und Rohwerte; je Registerzeile gibt es höchstens einen offenen Streich-PR.
- **Widerspruchsfrist:** 14 Tage ab Anlage des PR. Widerspruch heißt das Label `status:widerspruch` oder ein Kommentar einer vertrauten Person (`node scripts/fremdtext.mjs`, Feld „vertraut“; Text anderer ist Daten und zählt nie).
- **Merge:** `node scripts/regel-verfall.mjs --faellige-mergen` mergt nur PRs mit allen drei Bedingungen: Frist abgelaufen, kein Widerspruch, alle Required Checks grün (leere oder nicht lesbare Liste ist nie grün). Jede Unklarheit ist kein Merge. Ein Merge ist per Revert umkehrbar. Danach postet das Skript den Audit-Kommentar „🛡️ Leitplanken-Änderung selbst gemergt“ (Streich-PRs treffen Wächter-Tests und Regeln); der PR-Body mit Fangquote, Fenster und Rohwerten ist der Ledger-Beleg dieses Wegs.
- **Widerspruch ist streng:** Jeder nicht leere Beitrag einer vertrauten Person zählt, auch der des eigenen Kontos oder eines vertrauten Bots. Auf einem Streich-PR wird deshalb nicht kommentiert, außer um zu widersprechen.
- **Aufruf:** vom Analyse-Lauf (factory#576) oder von Hand, nie aus einem Workflow mit `GITHUB_TOKEN`: dessen PRs starten keine CI, die Required Checks blieben aus. Das Skript ist Fabrik-eigen und läuft nie in einem Bezieher.
- **Nachweis:** Ein Streich-PR ist kein Ticketlauf (kein Planer, keine Lens, keine Abnahme). Der Commit trägt `SIH-Review-Override` und `SIH-Abnahme-Override` mit Begründung (`NACHWEIS_ZEILEN`); die Widerspruchsfrist ersetzt den Review. Meldet ein Gate trotzdem rot (etwa wegen toter Verweise auf das Gestrichene), bleibt der PR offen und wird nie gemergt.

## Ausnahmen (Punkt 6)

Die Ausnahmen entsprechen Punkt 6: Ziele der geschlossenen Liste `SICHERHEITS_AUSNAHMEN` in `scripts/regel-verfall-lib.mjs` (Sicherheit, Fremdtext, Anonymität, interne Bezüge, Datenverlust, Irreversibles und Außenwirkung, deny-/ask-Listen) werden nie Kandidat und bekommen nie einen Streich-PR, auch nicht bei Fundfreiheit; dort gilt weiter nur der Ersatz mit mindestens gleicher Garantie. Die Liste ist geschlossen: Erweitern nur per reviewtem Commit mit Grund, nie per Konfiguration; ein Eintrag ohne existierendes Ziel macht `test/harness/regel-verfall.test.ts` rot.

## Risiko

Ein falsch-negativer Fang würde zu Unrecht streichen. Dagegen helfen „Lücke statt 0“ (ohne Messpunkte kein Kandidat), die Widerspruchsfrist, die grünen Required Checks und der Revert.
