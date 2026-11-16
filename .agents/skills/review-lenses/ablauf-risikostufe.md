# Ablauf: Risikostufe 0 und 1 (factory#527)

Bedingte Datei von `SKILL.md` (Kern: `.agents/skills/review-lenses/SKILL.md`): lies sie nach der berechneten Stufe (auch bei einem Lauf mit Planer), sobald `node scripts/risikostufe.mjs` für den Diff `RISIKOSTUFE: 0` oder `RISIKOSTUFE: 1` meldet. Werte für die Platzhalter `<gruppe.schlüssel>` stehen im Block darunter und werden wörtlich eingesetzt.

<!-- factory:projektwerte:start -->
Projektwerte aus `.factory/projekt.json` (generiert von `node scripts/projektwerte.mjs --write`, nicht von Hand ändern).

| Schlüssel | Wert |
| --- | --- |
| `praefixe.commitZeile` | `SIH-` |
| `praefixe.branch` | `feature/sih-` |
| `praefixe.worktree` | `sih-` |
| `agenten.planer` | `sih-planer` |
| `agenten.umsetzer` | `sih-umsetzer` |
| `agenten.lens` | `sih-lens` |
| `agenten.gruppe` | `sih-gruppe` |
| `agenten.ticketSkill` | `sih-ticket` |
| `labels.harness` | `area:harness` |
| `labels.festgefahren` | `status:festgefahren` |
| `labels.forum` | `forum` |
| `labels.dependabotInbox` | `area:harness` |
| `labels.entscheidung` | `status:entscheidung-noetig` |
| `skills.abschluss` | — |
<!-- factory:projektwerte:end -->

- **Stufe 0:** kein Lens-Pass. Stufe 0 der Staffel (`verifyKompakt`) bleibt; Nachweis `<praefixe.commitZeile>Review: ohne — stufe 0`.
- **Stufe 1:** Runde 1 mit dem vollen Satz der Diff-Art (Staffel in `SKILL.md`), danach höchstens **ein** Delta-Pass der blockierten Brillen (Cap 1, also `runden=2` höchstens; `MAX_REVIEW_PAESSE_STUFE1` im Wächter). Bleiben Blocker, ist das der Hand-off an den Hauptchat bzw. `ablauf-zusatzpass.md` wie bisher.
- Steigt die Stufe bei einem Fix, rechnet `risikostufe.mjs` vor jedem Pass neu; eine höhere Stufe als die Prognose bricht den Lauf ab (`abgebrochen — Risikostufe überschritten`, `.agents/skills/factory/umsetzer-risikostufe.md`).
