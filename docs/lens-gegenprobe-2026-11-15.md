# Lens-Gegenprobe 2026-11-15: Effort `medium` und Sonnet für die Architektur-Brille (factory#546)

> 📸 **Momentaufnahme vom 2026-11-15 — wird nicht aktualisiert** ([Lebenszyklus-Regel](referenz/doku-vorlagen.md#schnappschuss-analyse-audit-review)).
>
> Teil 1/2 des Epics factory#513. Zahlen, Regel, Rezept und Rohwerte dieses Laufs; die gültige Entscheidung steht in [model-routing.md](model-routing.md#lens-gegenprobe-1580). Vorlage: [lens-gegenprobe-2026-10-09.md](lens-gegenprobe-2026-10-09.md).

**Frage.** Reicht der Lens-Effort `medium` (Opus) statt `high`, und reicht Sonnet für die Brille mit der geringsten Trefferquote? Gemessen auf denselben historischen Runde-1-Patches, nach Schwere statt nach Blockerzahl.

**Wahl der Brille.** Lens-Trefferquote je Brille im festen Fenster `node scripts/lauf-ergebnis.mjs --von 2026-11-01T00:00:00Z --bis 2026-11-15T23:59:00Z --json` (184 PRs): Architektur 34/148 = 23,0 %, Sicherheit 6/25 = 24,0 %, Doku 11/27 = 40,7 %, Requirement-Treue 94/149 = 63,1 %, Test-Adäquanz 141/150 = 94,0 %; Kombi 0/2 zählt nicht. Gewählt: Architektur.

**Arme.**
- **R** (Referenz): `sih-lens` unverändert, Opus mit Effort `high` (Frontmatter von `.claude/agents/factory-lens.md`), frisch gelaufen.
- **M**: Opus mit Effort `medium`, für alle fünf Brillen (der Effort im Frontmatter gilt für alle Brillen), per `effort: "medium"` am Spawn.
- **S**: `model: "sonnet"` nur für die Architektur-Brille, Effort bleibt `high` aus dem Frontmatter.

## Entscheidungsregel (vor dem ersten Lauf festgelegt; Zeitstempel: Commit dieser Seite im Draft-PR)

Ein Arm wird nur übernommen, wenn alle vier gelten:

- **(a)** er verpasst in keinem Patch und keiner Brille ein echtes `❌`-Problem, das R findet;
- **(b)** er verpasst in Summe höchstens ein echtes `⚠️`-Problem mehr als R (Legende: AK 4 (b) `⚠️`-Fund = Schwere `🔶 sollte` des Glossars, Symbol-Form laut [Glossar › Schwere](harness-glossar.md); `⚠️ Hinweis` zählt für (b) nicht);
- **(c)** er meldet in Summe höchstens einen falschen Fund mehr als R (alle Schweren);
- **(d)** seine Summe der aufgezeichneten Kosten liegt höchstens bei 0,8 × der von R (mindestens 20 % weniger).

Ein Arm, der einen echten `❌`-Fund verpasst, den R findet, wird nicht übernommen, auch wenn er billiger ist. Die Blockerzahl allein entscheidet nichts.

**Operationalisierung.**
- *Fund* = eine Zeile `- [<Schwere>] …` im Bericht der Lens (Vorschläge außerhalb des Scopes zählen nicht).
- Ein blinder Opus-Richter (Arm, Modell und eigene Schwere verborgen) vergibt je Fund eine Problem-ID (gleiche Sache über Läufe und Brillen eines Patches = gleiche ID), das Urteil echt/falsch und die Schwere nach `factory-lens.md` § Blocker-Maßstab und [Glossar](harness-glossar.md).
- *Gefunden*: Hat ein Problem P beim Richter `❌` oder `🔶`, gilt es nur als gefunden, wenn der Lauf es als `❌` oder `🔶` meldet (nur `⚠️ Hinweis` = verpasst, „Herabstufung“); hat P beim Richter `Hinweis`, zählt jede Meldung.
- *Verpasst* je Patch und Brille: U = Vereinigung der echten Probleme aus R, dem Arm und dem historischen Runde-1-Lauf derselben Brille; verpasst je Schwere = Probleme aus U, die der Lauf nicht findet (R und Arm je gegen U).
- Summen (b), (c), (d) über die Patch-Brille-Paare des Arms: M alle fünf Brillen, S nur Architektur gegen R-Architektur.
- Ungültige Läufe (ohne Bericht, falscher HEAD, Modell ≠ Arm, bei M `medium` nicht auf allen Assistant-Zeilen belegt, Verweigerung): einmal wiederholen, sonst fällt das Paar für alle Arme heraus; ihre Kosten zählen zum Deckel.
- **Effort-Beleg** je Lauf (auch R und S): Zählung des Feldes `effort` der Assistant-Zeilen des Transkripts (Einzeiler im Rezept); ein M-Lauf ohne reines `medium` zählt nicht.
- **Deckel 40 $**: Σ aufgezeichneter Kosten aller Gegenprobe-Subagenten (Lenses, Richter, ungültige Läufe) ab dem Regel-Commit, nach jedem Batch geprüft; bei ≥ 40 $ endet die Gegenprobe als „Deckel“ ohne Wechsel.
- R, M und S laufen am selben UTC-Tag (2026-11-15), die Arme je Patch im selben Batch.

## Patches

Runde-1-HEAD und Brillen-Aufträge aus den Transkripten der historischen Lenses (`node scripts/subagent-laufzeit.mjs --agent sih-lens --von 2026-11-01T00:00:00Z --json`, Feld `datei`, `erwarteter HEAD:` im ersten User-Eintrag). Der Prompt je Patch und Brille ist der historische Runde-1-Auftrag bytegleich in allen Armen; ersetzt sind nur `Arbeitsverzeichnis:` und `Patch:` (und die Lens-Worktree-Pfade der Test-Lens), eingefügt ist ` · Ticket: #<ursprünglich>` hinter `Brille:`.

| Patch | PR | Ticket | Runde-1-HEAD | Diff-Art | Historische Runde-1-Funde `❌` (Arch/Req/Test/Sich/Doku) |
|---|---|---|---|---|---|
| p1 | #343 | factory#335 | `228c510b8521` | Code (13 Dateien, 216 Zeilen) | 1 / 2 / 0 / – / – |
| p2 | #372 | factory#248 | `aae42a1392ba` | Code (8 Dateien, 353 Zeilen) | 1 / 0 / 2 / – / – |
| p3 | #296 | factory#283 | `f7c2d82bd793` | Code (11 Dateien, 286 Zeilen) | 1 / 1 / 1 / – / – |
| p4 | #359 | factory#270 | `ad1abfba9868` | Code, Risiko hoch (6 Dateien, 182 Zeilen) | 0 / 0 / 2 / 0 / – |
| p5 | #493 | factory#479 | `cb385581cef8` | Code, Risiko hoch (12 Dateien, 266 Zeilen) | 0 / 0 / 1 / 0 / – |
| p6 | #355 | factory#353 | `24d1967affe8` | nur Markdown (1 Datei, 13 Zeilen) | – / – / – / – / 1 |
| p7 | #351 | factory#338 | `27bba3cbd3c7` | nur Markdown (2 Dateien, 28 Zeilen) | – / – / – / – / 1 |
| p8 | #491 | factory#476 | `4937eb152ab0` | nur Markdown (1 Datei, 31 Zeilen) | – / – / – / – / 0 |

Zählung der historischen Funde: Zeilen `- [❌ …]` im Bericht der Runde-1-Lens (Roh-Zählung vor dem Richter). Auswahlgründe: ≥ 5 Code-Patches (p1 bis p5), ≥ 2 mit Architektur-Fund in Runde 1 (p1, p2, p3), ≥ 2 Risikoklasse hoch mit Sicherheits-Brille (p4, p5; ein Patch mit Sicherheits-Fund war im Kostenrahmen nicht unterzubringen: eine Grenze), ≥ 3 reine Markdown-Patches (p6 bis p8, davon p6 und p7 mit, p8 ohne Doku-Fund), je Brille mindestens ein Patch mit und einer ohne Runde-1-Fund. Ersatzpatches, falls ein Paar ausfällt: PR #370 (factory#358, Code, Sicherheits-Brille), PR #448 (factory#436, Markdown). Die Patches sind klein gewählt, weil der Deckel 40 $ beträgt.

Prompt-Prüfsummen (sha256, erste 12 Zeichen; je Paar in R, M und S gleich): p1 arch `bd0e1454e728`, req `af4009ded805`, test `3889291d6564`; p2 arch `5987de847230`, req `80323d772d2f`, test `b552e94d28a9`; p3 arch `389b439e99ea`, req `ebe261654a77`, test `a0af6447b3a5`; p4 arch `e638a7d88c67`, req `bf7f268aaa2d`, sich `1c17237a6166`, test `a1b3919bf7fe`; p5 arch `b28f92adc188`, req `ece220a721bc`, sich `308b79df0748`, test `523305eb755b`; p6 doku `a1ed2c5a3fa2`; p7 doku `f69d802dbbb8`; p8 doku `f91eef8daef2`.

## Ergebnis

folgt.

## Läufe

folgt.

## Richter

folgt.

## Grenzen

folgt.

## Rezept

folgt.

## Wiedervorlage

folgt.
