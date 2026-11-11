---
name: review-lenses
description: Gestaffelter Mehr-Perspektiven-Review des Ticket-Diffs: erst `gate-befehl verifyKompakt`, bei Grün die Lenses (Code: Architektur, Requirement-Treue, Test-Adäquanz; reines Markdown: eine Doku-Lens). Auslösen bei "Lens-Review", "Mehr-Augen-Review", "Review mit Lenses", "gestaffelter Review".
---

# Mehr-Perspektiven-Review mit Gate-Short-Circuit

**Codex:** Die `Agent`-/`SendMessage`-Beispiele und Claude-Hook-Guards unten sind für Codex nicht registriert oder nicht als wirksam nachgewiesen (Grenze bis zur Freigabe des Codex-Adapters). Tatsächliche Aufrufe, Feature-Reduktionen und offene Schutzgrenzen: [Codex](../../../docs/codex/einstieg.md). Der gesperrte Codex-Einstieg aus `AGENTS.md` gilt auch hier.

Ein **gestaffelter** Review des aktuellen Ticket-Diffs — Vorbild sind produktiv eingesetzte KI-Entwicklungspipelines (quellprojekt#532). Die Idee: **erst die billigen, verlässlichen deterministischen Gates, dann die teuren LLM-Lenses — und die Lenses nur, wenn die Gates grün sind.** Das gibt zuerst das sicherste Feedback und verbrennt keine Tokens auf einem Diff, der schon an einem Gate scheitert.

> Kein Ersatz für die CI-Gates, sondern eine Schicht **davor/darüber** (Feinschliff vor `main`). **Kein Auto-Merge** — der Review liefert Findings, das Mergen bleibt der normale [Ticket-Ablauf](../factory/ablauf.md). Regeln/Begründungen: **[AGENTS.md](../../../AGENTS.md)**; die Harness-Gesamtsicht: [docs/agent-harness.md](../../../docs/agent-harness.md).

Werte für die Platzhalter `<gruppe.schlüssel>` dieser Datei (Lens-Name, Präfixe) stehen im Block darunter und werden wörtlich eingesetzt.

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

Die Änderungen des aktuellen Tickets gegen `origin/main` — im Worktree-Ablauf des Tickets also alles auf dem Feature-Branch. **Der Diff wird EINMAL in eine Patch-Datei geschrieben; die Lenses bekommen den Pfad**, statt jede ihren eigenen `git diff` zu fahren:

```bash
TMP=$(mktemp -d)                                        # Scratch-Ordner der Session
git fetch origin
git status --porcelain                                  # MUSS leer sein — s.u.
git diff origin/main...HEAD --stat                      # Überblick: welche Dateien
git diff origin/main...HEAD > "$TMP/<praefixe.worktree><nr>-r<runde>.patch"   # die EINE Grundlage aller Lenses
git rev-parse HEAD                                      # Frische-Guard, s.u.
```

**Warum Drei-Punkt (`origin/main...HEAD`)** statt `git diff main`: so sieht der Review genau den Slice, den `check:diffsize`/`check:diffcoverage` messen — ein Zwei-Punkt-Diff gegen ein lokal veraltetes `main` zieht fremde Zeilen mit hinein.

⚠️ **Erst committen, sonst reviewt niemand deine letzte Änderung.** Drei-Punkt gegen `HEAD` enthält **nur Committetes**; ein Zwei-Punkt `git diff main` erhöbe auch den Arbeitsbaum („plus noch Uncommittetes") und ist verboten. Der Frische-Guard unten vergleicht nur `HEAD`; die Abweichung „Arbeitsbaum ≠ HEAD" ist für ihn strukturell unsichtbar. Wer den Review mitten in der Arbeit anstößt, bekommt sonst ein „ok" über Code, den keine Lens gesehen hat. Darum `git status --porcelain` **vor** dem Schreiben prüfen.

**Warum überhaupt eine Datei:** gemessen an quellprojekt#1021 kostete ein Review 878k Tokens, und der dominante Anteil war **Beschaffung, nicht Analyse** — derselbe Diff fünfmal erhoben, die geänderten Dateien fünfmal vollständig gelesen, die Root-Kontextdateien von jeder Lens erneut geöffnet. Das produziert keinen einzigen zusätzlichen Befund.

**Ablage im Temp-/Scratch-Ordner, nicht im Worktree** — eine untracked Datei dort verunreinigt `git status` und könnte mitcommittet werden.

⚠️ **Frische-Guard — der gefährliche Fehlerfall.** Die Patch-Datei trägt die **Runden-Nummer**, und jede Lens prüft mit einem `git rev-parse HEAD`, dass der Stand zu dem passt, bei dem der Patch geschrieben wurde. Ohne das liest Runde 2 der Konvergenzschleife (unten) den Patch aus Runde 1 und attestiert Fixes, die sie nie gesehen hat — ein Review, der von außen grün aussieht und nichts geprüft hat. Weicht der HEAD ab: Patch neu schreiben **und die Abweichung melden**, nicht den alten Stand reviewen.

### Kontext-Diät je Lens (#1034)

Kontext-Diät, Findings-Format, Pflichtsatz und Blocker-Maßstab stehen in der Lens-Definition. Die Prüfpunkte je Brille stehen in `brille-<brille>.md` neben dieser Datei, die Lens liest sie selbst vom Stand `origin/main`. Der Orchestrator kopiert keine Blöcke in den Prompt.

## Ablauf — Stufe 0 zuerst, dann (nur bei Grün) die Lenses

### Stufe 0 — deterministische Gates (der Short-Circuit)

**Immer zuerst.** Vor der ersten Stufe 0: `git fetch origin`; ist `origin/main` weiter, `git merge origin/main` und Konflikte jetzt lösen (ein Merge nach der Konvergenz kostet Delta-Lens und neuen Nachweis; ist `origin/main` bis dahin weitergezogen, wird es direkt vor dem Nachweis-Commit nochmals eingemergt, siehe unten); danach [Nach jedem Merge von `main`](#nach-jedem-merge-von-main). Dann das SSOT-Aggregat aller Gates (quellprojekt#527):

```bash
node scripts/gate-befehl.mjs verifyKompakt   # Gate-Befehl der Projekt-Config (Standard: die verify-Kette des Projekts), alle Gates, Ausgabe nur bei Rot
```

- **Exit ≠ 0 (rot):** **HIER STOPPEN.** Berichte, welches Gate rot ist, mit der Fehlerausgabe — und **starte KEINEN Lens-Pass** (das ist der Short-Circuit: kein LLM-Token auf einen Diff, der schon deterministisch scheitert). Das gerötete Gate zuerst grün machen (im normalen Ticket-Ablauf), dann den Review erneut anstoßen.
- **Exit == 0 (grün):** weiter zu den Lenses.

> Warum `verify:kompakt` statt einer eigenen Kommandokette: das Skript liest dieselbe **eine** gepflegte Gate-Quelle (quellprojekt#527) — so kann der Review nicht gegen eine veraltete Teilmenge der Gates prüfen — und läuft nach einem Rot weiter, damit ein Fix alle Funde auf einmal behebt. Es ist der **eine** volle Lauf vor dem Review (AGENTS.md § Zwei-Stufen-Prüfung), kein zweiter. Fehlt im Worktree die Installation, einmal `node scripts/gate-befehl.mjs install` (quellprojekt#1119).

### Die Lens-Pässe (nur nach grüner Stufe 0)

**Jeder Lens ist ein eigener, fokussierter Pass** — nicht ein vermischter „schau mal drüber"-Blick. Jeweils **nur** durch die eine Brille lesen, dann strukturierte Findings ausgeben (Format unten).

**Welche Lenses laufen — die Review-Staffel (quellprojekt#1265).** Der Sockel je Lens ist fix, gespart wird an der **Zahl** der Lenses. Die Regel:

- **Runde 1:** Listet `git diff --name-only origin/main...HEAD` **nur `*.md`-Dateien** (auch Harness-Markdown), läuft **eine Lens 4 — Doku**. Sonst laufen **Lens 1–3**, außer bei Größenstufe S (nächster Punkt): auch ein kleiner `src`-Diff kann das persistierte Format brechen.
- **Größenstufe S (factory#271):** vor jedem Lens-Pass und vor dem Nachweis `node scripts/groessenstufe.mjs` (rechnet den Diff gegen die Basis, dieselbe Zahl wie der Wächter). Bei `STUFE: S` und Code-Diff läuft **eine** Lens `Brille: kombiniert` statt Lens 1–3 (Delta-Runden ebenso, sie liest die drei Teil-Brillen), ein reiner Markdown-Diff bleibt bei Lens 4. Bei `voll`, auch wenn der Diff nach Runde 1 über die Grenze wächst (fail-closed): der volle Satz auf dem vollen Patch.
- **Ab Runde 2:** nur die Brillen, die in der Vorrunde **blockiert** haben, auf dem **Delta-Patch** des Fixes (`git diff <Vorrunden-HEAD>..HEAD > "$TMP/<praefixe.worktree><nr>-r<runde>-delta.patch"`), mit ihren Vorrunden-Blockern als Prüfliste; der volle Patch bleibt Referenz für gezielte Zugriffe. Ändert der Fix Nicht-Markdown, läuft **Test-Adäquanz immer mit**.
- **Runde 1 ist der erste Lens-Pass** und hat immer den vollen Satz der Diff-Art (Code: alle drei Brillen). Liefert eine Brille keinen Bericht, wird sie einmal auf demselben Stand nachgeholt, bevor gefixt wird; das ist kein eigener Pass. Rote `verify`-Fixe davor zählen nicht als Fix-Runde (eigene Grenze: drei Fix-Versuche, dann Hand-off).
- **Fail-closed:** Fehlt die Dateiliste, gab es keinen Vorrunden-Pass (`verify` war rot), fiel eine Lens aus, hat die Diff-Art gewechselt oder wurde rebased: der volle Satz auf dem vollen Patch.
- **Merge von `main` in den Branch ist kein Fix-Pass.** Konfliktfrei zählt er nicht als Runde; das Delta der nächsten Runde sind nur die Fixes (`git diff <Vorrunden-HEAD>..<M>^1` plus `git diff <M>..HEAD`, `M` = Merge-Commit). Mit Konflikt kommt die Auflösung (`git show --remerge-diff --format= <M>`) ins Delta und zählt wie ein Fix, nicht wie ein voller Pass. Rebase mitten in der Schleife vermeiden (er erzwingt den vollen Satz und macht den Nachweis-`head` ungültig): `main` vor Runde 1 einmergen (Stufe 0, erster Punkt); den Nachweis direkt nach der Konvergenz setzen und pushen. Danach nur bei einem echten Konflikt erneut einmergen (`gh pr view <nr> --json mergeable`): das Ruleset verlangt keinen aktuellen Stand. Ein Merge von `main` NACH dem Nachweis-Commit: Weg im Abschnitt [Nach jedem Merge von `main`](#nach-jedem-merge-von-main), Begründung in [docs/agent-harness.md › §3a](../../../docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd).

**Jede Lens läuft als eigener Subagent auf dem starken Tier (quellprojekt#1035)** — nie inline im orchestrierenden Agenten (Hauptagent oder Umsetzer):

```
Agent({
  subagent_type: "<agenten.lens>",
  description: "Lens <Architektur|Requirement-Treue|Test-Adäquanz|Kombiniert|Doku> R<runde>",   // R<runde> zählt die Messung (token-baseline)
  // kein model/effort am Spawn: beides steht im Frontmatter von .claude/agents/factory-lens.md (opus/high, docs/model-routing.md §1)
  prompt: "Brille: <architektur|requirement-treue|test-adaequanz|kombiniert|doku> · Arbeitsverzeichnis: <worktree> · Patch: <TMP>/<praefixe.worktree><nr>-r<runde>.patch · erwarteter HEAD: <sha> · Probe-Protokoll: <Commit-SHAs mit Protokoll | keins> (nur Test- und Kombi-Lens) · ab Runde 2: Delta-Patch + Vorrunden-Blocker dieser Brille · Plan-Prüfliste: <Plan-Abschnitt 4 und 7 (nur Requirement-, Test- und Kombi-Lens), sonst „entfällt“ WÖRTLICH>"
})
```

Ein PreToolUse-Guard (`scripts/lens-auftrag-guard.mjs`) verweigert den Spawn, wenn ein Kopf-Feld noch `<…>` trägt, `erwarteter HEAD:` nicht mit einem Commit-Hash beginnt oder `… WÖRTLICH>` stehen blieb, und ein Auftrag, der nicht mit `Brille: <Schlüssel>` beginnt (R5, ein Schlüssel aus `BEKANNTE_LENSES`: architektur, requirement-treue, test-adaequanz, kombiniert, doku), wird ebenfalls abgewiesen: Werte einsetzen, neu spawnen. Die Plan-Prüfliste kopierst du wörtlich aus dem Plan. Lens-Worktree-Namen tragen genau eine von vier Endungen (Quelle `scripts/ticket-namen.mjs`): `-lens-r<runde>` Review-Pass, `-lens-m<n>` Merge-Delta-Lens, `-lens-a<n>` Abnahme-Fix-Delta, `-lens-c<n>` CI-Fix-Delta; jede andere (`-lens-b1`) weist der Guard ab, der Lens-Edit-Guard ließe dort keine Sabotage zu. Ein Zusatz in derselben Zeile wie ein Feldwert zählt zum Wert: Felder ohne `<…>`-Zusatz schreiben, Erklärungen in eine eigene Zeile.

Die Lens liest ihre Brille vom Stand `origin/main`, nie aus dem Feature-Worktree: sonst änderte ein PR die Brille, die ihn prüft. Fehlt trotzdem ein Bericht, fordert ihn der Orchestrator einmal per `SendMessage` an, ohne Neu-Spawn.

Kennt das Agent-Tool `<agenten.lens>` nicht („Agent type '<agenten.lens>' not found“, eine Session, die vor dem Anlegen der Definition gestartet wurde): einmal mit `general-purpose` und `model: "opus"` spawnen, der Prompt beginnt mit `Brille: <…> ·` (Schlüssel wie oben), dann: „Lies zuerst die Lens-Definition vom Stand `origin/main` (`git -C <Arbeitsverzeichnis> show origin/main:.claude/agents/factory-lens.md`) und befolge deren Rumpf.“ Der Bericht vermerkt den Fallback.

⚠️ **Die Lenses lesen, sie schreiben nicht — mit genau einer Ausnahme.** Parallele Subagenten teilen sich **einen** Worktree. Fährt einer Sabotage-Proben (die Red-Green-Prüfung der Test-Lens, s.o.) oder „hilft" mit einem Edit, prüfen die anderen gegen eine veränderte Basis und melden Findings, die gegen den echten Stand nicht reproduzierbar sind — beim Einführungs-PR dieses Umbaus (quellprojekt#1035) genau so passiert. Darum: **die Lens-Definition sagt ausdrücklich „du liest, du änderst nichts"**, und die **Sabotage-Proben der Test-Lens laufen nie im Feature-Worktree**, sondern je Runde in einem eigenen **Lens-Worktree** (`git -C <feature-worktree> worktree add --detach <absoluter Pfad des Hauptrepos>/.claude/worktrees/<praefixe.worktree><nr>-lens-r<runde> <erwarteter HEAD>`; im Arbeitsplatz liegt der Lens-Worktree im Worktree-Ordner des Repos aus `node scripts/arbeitsplatz.mjs pfade` (`<wurzel>/.claude/worktrees/<repo>`), nicht unter `<hauptrepo>/.claude/worktrees`; darin einmal `node scripts/gate-befehl.mjs install`, Tests per `node <lens-worktree>/scripts/gate-befehl.mjs testGezielt <datei>` (der Läufer setzt das Arbeitsverzeichnis selbst), danach `git worktree remove --force`); der Pfad ist **immer absolut**, ein relativer löst sich gegen das `-C`-Verzeichnis auf und legt den Lens-Worktree im Feature-Worktree an. Belegt wird das Entfernen mit `git worktree list` ohne den Pfad und `Test-Path` = `False` (Git-Bash: `test -e <pfad>` scheitert), die Unversehrtheit mit leerem `git status --porcelain` im Feature-Worktree. Bleibt ein Lens-Worktree stehen, entfernt ihn der Stop-Hook, sobald `<praefixe.worktree><nr>` weg und er älter als 5 Minuten ist. Für einen fremden Klon: `git -C <klon> worktree add --detach <klon>/.claude/worktrees/<präfix><nr>-lens-r<runde> <erwarteter HEAD>` (`<präfix>` ist das Worktree-Präfix aus der Config des Klons, das der Lens-Edit-Guard liest). Die Lens-Definition wiederholt diesen Fremd-Klon-Weg nicht; er steht hier und in der FAQ.

Warum überhaupt Subagenten:
- **Der Review darf nicht mit dem Coding-Tier mitrutschen (quellprojekt#1035).** Orchestriert wird der Review auf dem Skill-Pfad vom Umsetzer (Sonnet, dort ist der Zeiger des Skills vorgeladen, der auf diese Quelle verweist), ohne ihn vom Hauptagenten auf dem Session-Modell (Stand: [docs/model-routing.md](../../../docs/model-routing.md)). Liefe eine Lens inline in einem von beiden, reviewte der Coding-Tier — die eine Konventionshälfte repariert, die andere still kaputt. Ein Subagent mit eigenem Modell im Frontmatter (die Lens-Definition) umgeht das vollständig.
- **Kein Self-Grading — schon vorher gefordert (quellprojekt#1012), jetzt auch strukturell erfüllt.** Inline urteilt derselbe Kontext, der den Code gerade geschrieben hat; die Konvergenzschleife unten verlangt ohnehin „frische, unabhängige Kritiker". Der Subagent macht aus der Verhaltensregel eine Eigenschaft des Ablaufs — und ist **billiger**, weil er nur Patch + Auftrag sieht statt der vollen Ticket-Historie.
**Messbehauptungen** in Diff, PR oder Zusammenfassung: gib der Lens die Rohwerte mit (Session-IDs, Zeitfenster, Zählung je Quelle); sie hat keine Langfuse-Tools und prüft sonst nur die Transkript-Seite per `node scripts/token-baseline.mjs --session <id>`; ohne Rohwerte meldet sie „nicht belegt“ (Hinweis).

Am Ende **ein Gesamt-Verdikt** über alle gelaufenen Lenses (mergefähig ✅ / erst nachbessern ❌), vom Orchestrator aus den Lens-Verdikten gebildet. Die Vorschläge der Lenses zu Funden außerhalb des Ticket-Scopes trägt er ein: Harness → Zeile mit Klasse und Beleg (AGENTS.md § Harness-Befunde sind Zeilen, keine Tickets; ohne Beleg nur im Bericht), Produkt-/Inhalts-Befund → Issue, zusammengehörige gebündelt (AGENTS.md § Befunde sofort festhalten). Nicht inline mitfixen — oberste Regel.

## Als beschränkte Konvergenzschleife im Ticket-Ablauf (#1012)

Im Ticket-Ablauf ist dieser Review **Pflicht** vor dem PR — und läuft nicht einmalig, sondern als **beschränkte review↔fix-Konvergenzschleife** (Marktstandard 2026, generator-critic + capped reflexion):

1. Lenses nach der Staffel oben auf den **aktuellen** Stand (Regel: AGENTS.md § Mehr-Perspektiven-Review): Runde 1 der volle Diff, ab Runde 2 die blockierten Brillen auf dem Delta des Fixes.
2. Keine blockierenden Findings mehr ⇒ **konvergiert**, weiter zum PR. Was blockiert, regelt der Blocker-Maßstab (Kurzfassung in der Lens-Definition, Begründung in [docs/agent-harness.md](../../../docs/agent-harness.md#4-die-sichere-autonomie-schleife)): bei Guard-/Parser-Code ist ein neuer Umweg eine „Bekannte Grenze“, kein Blocker.
3. Sonst nachbessern, erst wenn **alle Berichte der Runde da sind** (solange eine Lens läuft, kein Edit und kein Commit im Feature-Worktree; **warten heißt: den Turn mit einer kurzen Statuszeile beenden, ohne `SubagentHandback`**: laufende eigene Subagenten halten den Lauf offen, jeder Lens-Bericht setzt ihn fort. Kein `Monitor`, kein `sleep`, kein Pollen der `.output`-Dateien), dann **zurück zu 1**. Jeder Fix-Commit trägt im Body die Zeile `Runde <n>: lenses=<alle Brillen des Passes> blocker=<brille>:<k>,…`: `lenses` nennt jede Brille, die der Pass fuhr, `blocker` einen Eintrag je Brille davon, `:0` für eine Brille ohne Blocker (Beispiel `Runde 1: lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:0,requirement-treue:1,test-adaequanz:2`; bei Doku `lenses=doku blocker=doku:<k>`, bei der Abnahme `lenses=abnahme blocker=abnahme:<k>`). Kein Skript parst die Zeile; die Fortsetzung eines Laufs liest daraus die Runde-1-Blocker für die Review-Zeile.
4. **Cap 2** Fix-Runden, also höchstens 3 Pässe (Regel: AGENTS.md § Mehr-Perspektiven-Review); danach fährt der Umsetzer **Zusatzpässe ohne Rückfrage** (Ursache im PR-Text, Nachweis `zusatzpass=<n>:<ursache>`, nicht `<praefixe.commitZeile>Review-Override`), höchstens 3 (der Lens-Worktree zählt die Runde weiter: `-lens-r4` bis `-lens-r6`), jeden nur, solange er **belegte** Funde behebt und die Blockerzahl gegenüber dem Vorpass sinkt. **Belegt** heißt: der Fund hat einen Repro oder Beleg an Test oder Doku (roter Test, fehlender Guard, widersprüchliche oder verwaiste Doku-Stelle); ein Architektur- oder Requirement-Blocker ist nie belegt in diesem Sinn. **Strittige Blocker** (Kritiker und Umsetzer uneins, Fix-Richtung offen) entscheidet der Umsetzer ausgewogen: A/B-Vergleich der Lösungen, Nachrecherche (Code, ADRs, Quellen), bei Bedarf ein frischer kritischer Subagent ohne Vorwissen; Ergebnis als „Entscheidung: X, weil Y“ im PR. Dieselbe Entscheidung steht vor jedem Festgefahren-Abbruch. Bleibt ein Blocker (Zusatzpässe erschöpft, Blockerzahl steigt oder Blocker nicht belegt, Entscheidung ergibt keine tragfähige Lösung), **Hand-off** (Festgefahren) an den Hauptchat, der nach dem Entscheidungsprotokoll entscheidet (`ablauf.md` › `festgefahren`): am Issue das Festgefahren-Label der Projekt-Config (`labels.festgefahren`) setzen, einen konsolidierten Kommentar posten (Blocker, Versuche, Optionen), assigned bleiben; kein PR mit bekannten Blockern. Mehr als 3 Zusatzpässe gibt nur die Maintainerin frei (Nachweis: `<praefixe.commitZeile>Review-Override:` mit Freigabe-Beleg, sonst ist die Review-Zeile rot). Eine **Abnahme-Fix-Runde** (Urteil `fix` der Holdout-Abnahme nach der Konvergenz) hat ein **eigenes Budget** von einer Delta-Runde, ohne Rückfrage und unabhängig vom Review-Cap: der Fix wird gemacht, dann prüft **eine** Delta-Lens auf `<abnahme-head>..HEAD` (Sabotage-Worktree `<praefixe.worktree><nr>-lens-a<n>`) nur Test-Adäquanz und Requirement-Treue (ist der Fix reine Doku, die Doku-Brille), danach neuer Nachweis-Commit und erneuter Abnahme-Durchgang. Der Pass zählt in `runden` mit; ist das Review-Cap (samt Zusatzpass) dadurch überschritten, trägt die Review-Zeile `abnahmefix=1` (höchstens einmal je PR). `abnahmefix=1` deckt nur die Delta-Runde des ersten Abnahme-Fixes; jede weitere Runde (ein weiterer Abnahme-Fix, eine Delta-Lens nach CI-Fix) ist ein Zusatzpass. Review- und Abnahme-Zusatzpässe zählen gemeinsam, höchstens 3 (`MAX_ZUSATZPAESSE`); mehr ist rot, außer mit `<praefixe.commitZeile>Review-Override:` samt Freigabe-Beleg der Maintainerin. Ein zweiter Abnahme-Fix-Pass geht also den Weg Zusatzpass bzw. Hand-off. Findet die Delta-Lens Blocker, gilt der Weg wie bei jedem Pass (belegt: Zusatzpass, sonst Hand-off). Auch eine Delta-Lens nach CI-Fix oder Konflikt-Merge hinter einer bestandenen Abnahme zählt als Pass (Feld `runden` der Review-Zeile + 1, über dem Cap mit Zusatzpass): die CI erzwingt `durchgaenge ≤ runden`.

### Nach jedem Merge von `main`

Gilt für jeden Merge von `origin/main` in den Branch (Stufe 0, echter Konflikt, Merge vor dem Auto-Merge bei einer Gate-Verschärfung); `M` = Merge-Commit. `node scripts/check-abnahme-nachweis.mjs` zeigt lokal (ohne PR-Umgebung) einen Konflikt-Merge hinter der Abnahme.

**Zuerst der Testabgleich (quellprojekt#1579):** direkt nach dem Merge, bei einem Konflikt vor dem Merge-Commit, `node scripts/merge-testabgleich.mjs`. Exit 2 heißt kein Merge, nichts zu prüfen (z.B. nach „Already up to date“, wenn HEAD nicht auf einem Merge-Commit steht; steht HEAD auf einem älteren Merge-Commit, wird dieser erneut geprüft, Exit 0 oder 1); den Exit in PowerShell aus `$LASTEXITCODE` lesen, nicht aus `$?`. Exit 1 heißt, ein Test von `main` (oder vom Branch) fehlt im Ergebnis, ohne dass die andere Seite ihn bewusst entfernt hat: wieder einfügen, bevor weitergemacht wird. Sonst fällt ein stillschweigend verlorener Test erst der Test-Lens per Sabotage auf (Delta-Pass: drei Lenses plus neuer Nachweis-Commit). Meldet das Skript zusätzlich „Wächter-Lauf nötig: node scripts/gate-befehl.mjs testGezielt test/harness“ (beide Seiten haben Dateien unter `.claude/`, `.github/`, `docs/`, `test/harness/`, `README.md` oder eine `AGENTS.md` geändert, auch verschiedene; Wächter über andere Pfade erkennt es nicht), diesen Lauf vor dem Weitermachen fahren: ein Wächter kann nur an der Kombination beider Seiten rot sein. In Stufe 0 deckt das folgende `verify:kompakt` diesen Lauf ab (sein Testlauf schließt `test/harness` ein), dort entfällt er.

1. **Verschobener Code:** Hat der Branch Funktionen aus einer Datei in neue Dateien verschoben, landen parallele `main`-Änderungen an ihnen in der alten Datei oder fallen bei der Auflösung weg. Je Quell-Datei `<basis>` = `git merge-base <M>^1 <M>^2`, dann `git diff <basis> <M>^2 -- <alte datei>` lesen (beim Auflösen vor dem Commit `git merge-base HEAD MERGE_HEAD` und `MERGE_HEAD` statt `<M>^2`). Jede Änderung an einer verschobenen Funktion in die neue Datei übertragen, betroffene Tests gezielt fahren. Die Übertragung zählt als Fix (vor Runde 1 Teil des vollen Patches, sonst Delta der nächsten Runde bzw. der Merge-Delta-Lens).
2. **Konflikt-Merge nach dem Nachweis-Commit:** Ist `git show --remerge-diff --format= <M>` nicht leer, ist der Nachweis-Check rot (Warum: §3a). Weg:
   1. Einmal `node scripts/gate-befehl.mjs verifyKompakt` (Short-Circuit-Regel wie in Stufe 0).
   2. Patch schreiben: `git show --remerge-diff --format= <M> > "$TMP/<praefixe.worktree><nr>-merge.patch"`, bei späteren Commits `git diff <M>..HEAD` anhängen.
   3. Delta-Lens: reine `*.md`-Auflösung eine Doku-Brille, sonst die drei Code-Brillen (deren Sabotage-Worktree heißt `<praefixe.worktree><nr>-lens-m<n>`, `n` = laufende Merge-Nummer); je mit `Patch:`, `Delta-Patch:`, `erwarteter HEAD:` und dem Auftrag „prüfe die Konflikt-Auflösung“, Spawn-Vorlage wie oben. Blockiert eine Brille: fixen, dieselbe Brille einmal auf dem Fix-Delta; blockiert sie weiter, Hand-off `festgefahren`.
   4. Neuer leerer Nachweis-Commit hinter dem Merge: `<praefixe.commitZeile>Plan:` unverändert, `<praefixe.commitZeile>Review:` mit `head` = zuletzt reviewter Stand (≥ `M`), `runden`, `lenses`, `blocker` wie im bisherigen Nachweis (die Merge-Lens ist kein Pass der Schleife; hinter einer bestandenen Abnahme zählt sie als Pass, `runden` + 1). Lokal `node scripts/check-review-nachweis.mjs`, im PR-Text nennen, dass der Merge nach dem Review kam.
3. **Doku-Konflikt (`docs/module/*.md`, vor allem `sim.md`):** Vor dem Auflösen lesen, was `main` wirklich geändert hat: `git diff $(git merge-base HEAD MERGE_HEAD) MERGE_HEAD -- <datei>`. Die von `main` geänderten Einträge übernehmen, die eigenen darauf neu anwenden (nie blind „ours“ oder „theirs“ wählen: dabei gehen Zeilen der Gegenseite still verloren). `sim.md` führt ein Modul je Listeneintrag mit Leerzeile dazwischen, damit Änderungen an Nachbarn konfliktfrei mergen. Danach `npm run check:docmap` und `npm run check:docdrift`.
4. **Breitensuche vor der Merge-Delta-Lens (auch nach konfliktfreiem Merge):** Entfernt oder benennt der Branch Namen oder Pfade um (Datei, Funktion, Skript, Label, Regel-Begriff), wiederhole vor der Delta-Lens die Breitensuche des Tickets (`grep` über das ganze Repo nach dem alten Namen) auf dem **gemergten** Stand: `main` kann neue Verweise darauf mitbringen, die die Delta-Lens nur zufällig findet. Funde sind Fix des Branches und gehören ins Delta.

### Nachweis nach Konvergenz (#1270)

Sobald konvergiert ist, holt der Orchestrator `origin/main` und mergt es, falls es weitergezogen ist, nochmals ein (Testabgleich wie oben); ein konfliktfreier Merge braucht keine Lens, ein Konflikt-Merge vor dem Nachweis wird von der Merge-Delta-Lens (Stufe oben) geprüft, bevor der Nachweis gesetzt wird. Verlangt der Projekt-Block der AGENTS.md (› Gates) Prüfungen außerhalb von `verify` (etwa ein Bundle-Budget), laufen sie nach dem letzten Merge von `main` und vor dem Nachweis-Commit einmal (ein parallel gemergter PR kann das Budget verbraucht haben). Immer dazu `npm run check:size` auf dem gemergten Stand: die CI misst den Merge-Ref mit dem aktuellen `origin/main`, und ein parallel gemergter PR kann eine Datei über die Grenze schieben, die lokal noch passte. Wer ein Budget anhebt, misst neu. Ein Diffsize-Override setzt man erst nach dem Merge von `origin/main` und einer Messung; ist er danach stale, widerruft ihn ein leerer Commit mit der Zeile `<praefixe.commitZeile>Diffsize-Override: #<nr> entfällt` (die jüngste Zeile gilt, kein Umschreiben). Danach setzt er einen **leeren Nachweis-Commit** mit den Zeilen `<praefixe.commitZeile>Plan:` und `<praefixe.commitZeile>Review:` (Format, Warum und Grenzen: [docs/agent-harness.md › §3a](../../../docs/agent-harness.md#3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd), nicht hier kopieren). `head` ist der zuletzt reviewte Stand, `runden` die Zahl der Pässe, `lenses` die Brillen des vollen Passes (Runde 1), `blocker` je Brille die Zahl ihrer `[❌ blockierend]`-Findings im ersten Pass (Runde 1), auch 0; ein Zusatzpass über das Cap hinaus steht zusätzlich als `zusatzpass=<anzahl>:<ursache>` in der Zeile. Lokal prüfen mit `node scripts/check-review-nachweis.mjs` (gibt bei Rot die Vorlage aus); die PR-CI erzwingt es als Required-Check. Danach kein Rebase/Amend mehr, sonst liegt `head` nicht mehr im PR. **Jeder Nicht-Merge-Commit mit Baumänderung nach `head`** (auch ein CI-Fix hinter dem Nachweis-Commit) macht den Check rot: Delta-Lens der betroffenen Brillen auf `<head>..HEAD` (Sabotage-Worktree `<praefixe.worktree><nr>-lens-c<n>`, `n` = laufende Nummer; Zählung wie bei der Merge-Delta-Lens, [Nach jedem Merge von `main`](#nach-jedem-merge-von-main)), dann ein neuer leerer Nachweis-Commit mit `head` ≥ Fix; leere Commits (Nachweis, Override-Zeilen) und konfliktfreie Merges bleiben grün.

Regel-Heimat: [AGENTS.md › Mehr-Perspektiven-Review](../../../AGENTS.md). Die Rundengrenze steht in `scripts/nachweis-lib.mjs` (`MAX_FIX_RUNDEN`).

## Wichtig

- **Short-Circuit ist hart.** Rote Stufe 0 ⇒ **keine** Lens-Pässe. Der Beweis ist der Exit-Code von `node scripts/gate-befehl.mjs verifyKompakt` (≠ 0), nicht ein Bauchgefühl.
- **Nicht die CI ersetzen.** Die Gates laufen ohnehin vor dem PR lokal (das eine `verify:kompakt` der Stufe 0) und in der CI als Required-Checks nochmal — dieser Skill hängt sich **davor** und ergänzt die LLM-Lenses. **Kein Auto-Merge.**
- **Ablauf-Änderungen** gehören in [docs/agent-harness.md](../../../docs/agent-harness.md) (Harness-Sicht) bzw. [AGENTS.md](../../../AGENTS.md), nicht (nur) in diese Skill-Datei — der Skill ist ein dünner Zeiger auf die Repo-SSOT.
