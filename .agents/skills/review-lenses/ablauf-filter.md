# Filterdurchlauf und Stichprobenarm (factory#532)

Bedingte Datei von `SKILL.md` (Kern: `.agents/skills/review-lenses/SKILL.md`): lies sie nach jeder Review-Runde.

Nach jeder Runde, wenn alle Berichte da sind: Berichte über stdin an `node scripts/lens-filter.mjs --runde <n> --ticket <nr>`. Ausgabe: Fixliste (`F1…Fn`, gleiche Fundstelle und Schwere über Brillen zusammengefasst, die Schwere ändert der Filter nie), die fertige `Runde <n>:`-Zeile für den Fix-Commit, die Zeile `arm=` und `pass: konvergiert|delta-noetig`.

**Arm** aus der Ticketnummer (`armAusTicket`): durch 4 teilbar ⇒ `vollablauf`, sonst `schlank`. Das Feld `arm=<vollablauf|schlank>` gehört in die Review-Zeile des Nachweis-Commits (Pflicht bei Ticket-Branches, ohne Ticket verboten; ein unpassender Wert macht `check-review-nachweis` rot).

- `vollablauf` (Kontrollarm): blockierend und sollte lösen eine Fix-Runde aus; null davon ⇒ konvergiert.
- `schlank`: ein Pass ohne `❌ blockierend` konvergiert. Jeden `🔶 sollte` verwirfst du mit Begründung (`--verwerfen F<k>=<Begründung>`, im PR-Text festhalten) oder fixt ihn; ein Fix zieht einen Delta-Pass nach sich (der letzte Blick ist nie der Fixer). Hinweise lösen nichts aus. Bei `runden=1` verlangt das Gate nur `blocker`-Summe 0.
- Verwerfen: nur im Arm `schlank`, nie ein blockierender Fund, nie mit leerer Begründung (leer, `…`, `-`): Exit 2, nichts wird verworfen. Ohne `--ticket` verhält sich der Filter wie `vollablauf`, ohne `arm=`.
