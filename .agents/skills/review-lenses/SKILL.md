---
name: review-lenses
description: Gestaffelter Mehr-Perspektiven-Review des Ticket-Diffs: erst `gate-befehl verifyKompakt`, bei Grün die Lenses (Code: Architektur, Requirement-Treue, Test-Adäquanz; reines Markdown: eine Doku-Lens). Auslösen bei "Lens-Review", "Mehr-Augen-Review", "Review mit Lenses", "gestaffelter Review".
---

# Mehr-Perspektiven-Review mit Gate-Short-Circuit

**Codex:** Die `Agent`-/`SendMessage`-Beispiele und Claude-Hook-Guards unten sind für Codex nicht registriert oder nicht als wirksam nachgewiesen (Grenze bis zur Freigabe des Codex-Adapters). Tatsächliche Aufrufe, Feature-Reduktionen und offene Schutzgrenzen: [Codex](../../../docs/codex/einstieg.md). Der gesperrte Codex-Einstieg aus `AGENTS.md` gilt auch hier.

Gestaffelter Review: **erst die deterministischen Gates, dann (nur bei Grün) die Lenses.** Kein Ersatz für die CI-Gates, sondern eine Schicht davor; **kein Auto-Merge** (das Mergen bleibt der [Ticket-Ablauf](../factory/ablauf.md)). Regeln: [AGENTS.md](../../../AGENTS.md), Begründungen: [docs/agent-harness.md › §3a](../../../docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd).

Werte für `<gruppe.schlüssel>` stehen im Block darunter.

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
| `skills.abschluss` | `brain-input` |
<!-- factory:projektwerte:end -->

## Was ist „der Diff"? — einmal materialisieren, nicht pro Lens erheben (#1034)

Die Änderungen des Tickets gegen `origin/main`. **Der Diff wird EINMAL in eine Patch-Datei geschrieben; die Lenses bekommen den Pfad**:

```bash
TMP=$(mktemp -d)                                        # Scratch-Ordner der Session
git fetch origin
git status --porcelain                                  # MUSS leer sein — s.u.
git diff origin/main...HEAD --stat                      # Überblick: welche Dateien
git diff origin/main...HEAD > "$TMP/<praefixe.worktree><nr>-r<runde>.patch"   # die EINE Grundlage aller Lenses
git rev-parse HEAD                                      # Frische-Guard, s.u.
```

Der Drei-Punkt-Diff zeigt genau den Slice, den `check:diffsize` misst; ein Zwei-Punkt-Diff (auch „plus Arbeitsbaum“) ist verboten. Er enthält **nur Committetes**: vorher `git status --porcelain` prüfen, sonst reviewt niemand die letzte Änderung. Die Patch-Datei liegt im Scratch-Ordner, nicht im Worktree.

⚠️ **Frische-Guard.** Der Patch trägt die Rundennummer, jede Lens prüft mit `git rev-parse HEAD`, dass der Stand zum Patch passt. Weicht der HEAD ab: Patch neu schreiben **und die Abweichung melden**, nicht den alten Stand reviewen.

### Kontext-Diät je Lens (#1034)

Kontext-Diät, Findings-Format, Pflichtsatz und Blocker-Maßstab stehen in der Lens-Definition, die Prüfpunkte in `brille-<brille>.md` neben dieser Datei (die Lens liest sie von `origin/main`). Der Orchestrator kopiert nichts in den Prompt.

## Ablauf — Stufe 0 zuerst, dann (nur bei Grün) die Lenses

### Stufe 0 — deterministische Gates (der Short-Circuit)

**Immer zuerst.** Vor der ersten Stufe 0 `git fetch origin`; ist `origin/main` weiter, `git merge origin/main`, Konflikte jetzt lösen, danach [Nach jedem Merge von `main`](#nach-jedem-merge-von-main). Dann das SSOT-Aggregat aller Gates (es ist der **eine** volle Lauf vor dem Review, AGENTS.md § Zwei-Stufen-Prüfung; fehlt im Worktree die Installation, einmal `node scripts/gate-befehl.mjs install`):

```bash
node scripts/gate-befehl.mjs verifyKompakt   # Gate-Befehl der Projekt-Config, alle Gates, Ausgabe nur bei Rot
```

- **Exit ≠ 0:** **HIER STOPPEN**, das rote Gate mit Fehlerausgabe berichten, **KEINEN Lens-Pass** starten.
- **Exit == 0:** weiter zu den Lenses.

### Die Lens-Pässe (nur nach grüner Stufe 0)

**Welche Lenses laufen — die Review-Staffel (quellprojekt#1265):**

- **Runde 1:** Listet `git diff --name-only origin/main...HEAD` **nur `*.md`-Dateien** ⇒ läuft **eine Lens 4 — Doku**. Sonst laufen **Lens 1–3**.
- **Ab Runde 2:** nur die Brillen, die in der Vorrunde **blockiert** haben, auf dem **Delta-Patch** des Fixes (`git diff <Vorrunden-HEAD>..HEAD > "$TMP/<praefixe.worktree><nr>-r<runde>-delta.patch"`), mit ihren Vorrunden-Blockern als Prüfliste. Ändert der Fix Nicht-Markdown, läuft **Test-Adäquanz immer mit**.
- **Runde 1 ist der erste Lens-Pass** und hat immer den vollen Satz der Diff-Art. Liefert eine Brille keinen Bericht, wird sie einmal auf demselben Stand nachgeholt, bevor gefixt wird. Rote `verify`-Fixe davor zählen nicht als Fix-Runde.
- **Fail-closed:** Fehlt die Dateiliste, gab es keinen Vorrunden-Pass, fiel eine Lens aus, wechselte die Diff-Art oder wurde rebased: der volle Satz auf dem vollen Patch.
- Merge von `main` ist kein Fix-Pass (`git show --remerge-diff --format= <M>` ist das Delta einer Konfliktauflösung); Rechnung und Ablauf in `.agents/skills/review-lenses/ablauf-merge-main.md`.

**Jede Lens läuft als eigener Subagent auf dem starken Tier**, nie inline im Orchestrator:

```
Agent({
  subagent_type: "<agenten.lens>",
  description: "Lens <Architektur|Requirement-Treue|Test-Adäquanz|Doku> R<runde>",   // R<runde> zählt die Messung (token-baseline)
  // kein model/effort am Spawn: beides steht im Frontmatter von .claude/agents/factory-lens.md (opus/high, docs/model-routing.md §1)
  prompt: "Brille: <architektur|requirement-treue|test-adaequanz|doku> · Arbeitsverzeichnis: <worktree> · Patch: <TMP>/<praefixe.worktree><nr>-r<runde>.patch · erwarteter HEAD: <sha> · Probe-Protokoll: <Commit-SHAs mit Protokoll | keins> (nur Test-Lens) · ab Runde 2: Delta-Patch + Vorrunden-Blocker dieser Brille · Plan-Prüfliste: <Plan-Abschnitt 4 und 7 (nur Requirement- und Test-Lens), sonst „entfällt“ WÖRTLICH>"
})
```

Der PreToolUse-Guard `scripts/lens-auftrag-guard.mjs` weist einen Auftrag mit offenem `<…>`, ohne Commit-Hash bei `erwarteter HEAD:` oder ohne `Brille: <Schlüssel>` am Anfang ab (Abhilfe in seiner Meldung): Werte einsetzen, neu spawnen. Lens-Worktree-Namen tragen genau eine Endung: `-lens-r<runde>` Review-Pass, `-lens-m<n>` Merge-Delta, `-lens-a<n>` Abnahme-Fix-Delta, `-lens-c<n>` CI-Fix-Delta.

Fehlt ein Bericht, fordert ihn der Orchestrator einmal per `SendMessage` an, ohne Neu-Spawn. Kennt das Agent-Tool `<agenten.lens>` nicht („Agent type '<agenten.lens>' not found“): einmal mit `general-purpose` und `model: "opus"` spawnen, Prompt `Brille: <…> ·` und: „Lies zuerst die Lens-Definition vom Stand `origin/main` (`git -C <Arbeitsverzeichnis> show origin/main:.claude/agents/factory-lens.md`) und befolge deren Rumpf.“

⚠️ **Die Lenses lesen, sie schreiben nicht** (die Lens-Definition sagt „du liest, du änderst nichts“); **die Sabotage-Proben der Test-Lens laufen nie im Feature-Worktree**, sondern je Runde in einem eigenen Lens-Worktree `<praefixe.worktree><nr>-lens-r<runde>` (`git -C <feature-worktree> worktree add --detach <absoluter Pfad> <erwarteter HEAD>`, danach `git worktree remove --force`). Pfade, Entfernen, Stop-Hook: `.claude/agents/factory-lens.md`, FAQ.

**Messbehauptungen** in Diff, PR oder Zusammenfassung: gib der Lens die Rohwerte mit (Session-IDs, Zeitfenster, Zählung je Quelle), sonst meldet sie „nicht belegt“.

Am Ende **ein Gesamt-Verdikt** über alle gelaufenen Lenses (mergefähig ✅ / erst nachbessern ❌), vom Orchestrator aus den Lens-Verdikten gebildet. Funde außerhalb des Ticket-Scopes trägt er ein: Harness → Zeile mit Klasse und Beleg (AGENTS.md § Harness-Befunde sind Zeilen, keine Tickets; ohne Beleg nur im Bericht), Produkt-/Inhalts-Befund → Issue, gebündelt (AGENTS.md § Befunde sofort festhalten), nicht inline mitfixen.

## Als beschränkte Konvergenzschleife im Ticket-Ablauf (#1012)

Im Ticket-Ablauf ist der Review vor dem PR **Pflicht**, als **beschränkte review↔fix-Konvergenzschleife**:

1. Lenses nach der Staffel auf den **aktuellen** Stand (AGENTS.md § Mehr-Perspektiven-Review): Runde 1 der volle Diff, ab Runde 2 die blockierten Brillen auf dem Delta.
2. Keine blockierenden Findings mehr ⇒ **konvergiert**, weiter zum PR. Was blockiert, regelt der Blocker-Maßstab (Begründung in [docs/agent-harness.md](../../../docs/agent-harness.md#4-die-sichere-autonomie-schleife)).
3. Sonst nachbessern, erst wenn **alle Berichte der Runde da sind** (solange eine Lens läuft, kein Edit und kein Commit im Feature-Worktree; **warten heißt: den Turn mit einer kurzen Statuszeile beenden, ohne `SubagentHandback`**, jeder Lens-Bericht setzt den Lauf fort; kein `Monitor`, kein `sleep`), dann **zurück zu 1**. Jeder Fix-Commit trägt im Body die Zeile `Runde <n>: lenses=<alle Brillen des Passes> blocker=<brille>:<k>,…` (`blocker`: je Brille ein Eintrag, `:0` ohne Blocker; Beispiel `Runde 1: lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:0,requirement-treue:1,test-adaequanz:2`; Doku `lenses=doku blocker=doku:<k>`, Abnahme `lenses=abnahme blocker=abnahme:<k>`).
4. **Cap 2** Fix-Runden, also höchstens 3 Pässe (AGENTS.md § Mehr-Perspektiven-Review). **Strittige Blocker** (Kritiker und Umsetzer uneins, Fix-Richtung offen) entscheidet der Umsetzer ausgewogen: A/B-Vergleich, Nachrecherche, bei Bedarf ein frischer Subagent; Ergebnis als „Entscheidung: X, weil Y“ im PR, auch vor jedem Festgefahren-Abbruch. Bleibt ein Blocker: **Hand-off** (Festgefahren) an den Hauptchat (`ablauf.md` › `festgefahren`), kein PR mit bekannten Blockern.
   - Cap erschöpft, Blocker belegt: `.agents/skills/review-lenses/ablauf-zusatzpass.md`.
   - Abnahme-Urteil `fix`: `.agents/skills/review-lenses/ablauf-abnahme-fix.md`.

### Nach jedem Merge von `main`

Bei jedem Merge von `origin/main` in den Branch zuerst `.agents/skills/review-lenses/ablauf-merge-main.md` lesen, beginnend mit `node scripts/merge-testabgleich.mjs`.

### Nachweis nach Konvergenz (#1270)

Nach der Konvergenz `.agents/skills/review-lenses/ablauf-nachweis.md` lesen: ein leerer Nachweis-Commit mit den Zeilen `<praefixe.commitZeile>Plan:` und `<praefixe.commitZeile>Review:`, lokal geprüft mit `node scripts/check-review-nachweis.mjs`.

Regel-Heimat: [AGENTS.md › Mehr-Perspektiven-Review](../../../AGENTS.md), Rundengrenze `MAX_FIX_RUNDEN` in `scripts/nachweis-lib.mjs`. Ablauf-Änderungen gehören in docs/AGENTS.md, nicht (nur) hierher.
