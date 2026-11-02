# Fortschreibung factory#94 (2026-11-02): Kern-Tests aufteilen, Bezieher-Fitness-Checks im Harness-Doctor

Ergänzt [ADR 0022](../0022-dark-factory-kern-und-verteilung.md) (Harness-Doctor, Fortschreibung [#116](0022-116-doctor-sicherheitspunkte.md)); die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)).

- **Ausgangslage:** fünf Kern-Tests prüfen nicht nur Besitz, sondern auch Projektdateien. Ein Bezieher hielt dafür Projekt-Kopien (`agents-md-native-projekt`, `required-check-shadowing-projekt`, `line-endings-projekt`, `harness-approval-projekt`, `modell-projekt`), die mit dem Kern auseinanderlaufen und beim Bezieher gepflegt werden müssen. Herkunft: Befund aus dem Quellprojekt zu factory#78 (Bezieher-Check).
- **Entscheidung (Aufteilung):** jeder dieser Tests zerfällt in einen Unit-Anteil (Parser, Erkennung, Red-Green auf Fixtures, Besitz-Dateien; bleibt Kern-Test im Factory-Repo) und einen Bezieher-Fitness-Anteil (Regel gegen die Projektdateien des Beziehers). Beide rufen dieselben Funktionen; der Fitness-Anteil läuft als Punkt des Harness-Doctors.
- **Entscheidung (Ort):** ein Doctor-Punkt im Besitz (`scripts/harness-doctor-dateien.mjs`, Ring `kern`), weil er per Sync und Wochenlauf ohne weitere Verdrahtung in jedem Bezieher läuft und zum Zweck des Doctors passt (Voraussetzungen der Factory im Projekt). Verworfen: eine Testdatei im Besitz (Test-Hülle und Extraktionsregeln erlauben keine Bezieher-Tests, im Bezieher fehlt die Test-Infrastruktur), das Drift-Gate (verwässert dessen Verantwortung) und ein neues `check:*` (der Sync fasst die `package.json` nicht an).
- **Entscheidung (Ablauf):** `--pruefen` und der Wochenlauf geben `dateien` an `pruefLauf`, `--einrichten` nicht (wie Langfuse: die Punkte ändern nichts). Die Punkte brauchen kein Token. Fehlt Git oder der Index, ist `Zeilenenden` `NICHT PRÜFBAR` mit Fix, nie still grün; `Root-Kontextdatei` wird trotzdem bewertet.
- **Entscheidung (Zeilenenden im Bezieher):** unter `.claude/` und `.agents/` gilt streng `eol=lf` (funktional: der Berechtigungsdialog lehnt Steuerzeichen ab); jede andere Textdatei braucht eine eol-Regel (`lf` oder ausdrücklich `crlf`); der Index enthält kein `crlf` und kein `mixed`. Binär (Index `-text`, Attribut `-text`) und leer sind ausgenommen. Die strenge globale Regel `eol=lf` ist eine Wahl des Factory-Repos und bleibt dort Kern-Test.
- **Entscheidung (Prosa-Scan):** der Scan auf abgelegte Rollen der `CLAUDE.md` bleibt Kern-Test des Factory-Repos, weil seine Begriffe aus der Geschichte der Quelle stammen. Ein Bezieher mit dieser Geschichte prüft seine Doku als `projekt-test`.

## Inventar

| Kern-Test | Unit-Anteil (bleibt Kern-Test) | Bezieher-Fitness-Anteil | Ort im Bezieher | Projekt-Kopie |
|---|---|---|---|---|
| agents-md-native | Erkennung der Varianten (Unterordner nicht), Rollen-Erkennung Red-Green, Scan-Umfang `.claude/` | keine `CLAUDE.md`, `.claude/CLAUDE.md` oder `CLAUDE.local.md` im Root (auch ungetrackt) | Doctor-Punkt `Root-Kontextdatei` | entfällt; der Prosa-Scan bleibt Kern-Test des Factory-Repos |
| line-endings | Parser, Binär-Fixture, `text=auto` für Binärdateien, strenge globale Regel des Factory-Repos | `.claude/**`, `.agents/**` und `LF_BEISPIELE` haben `eol=lf`; jede andere Textdatei hat eine eol-Regel; der Index enthält kein `crlf`/`mixed` | Doctor-Punkt `Zeilenenden` | entfällt |
| required-check-shadowing | `nameWerte`, `beansprucht`, `verstoesse`, `istWorkflowDatei`, Spiegel-Form | echte Workflows gegen den Spiegel: jeder Kontext hat genau eine Quelle | offen, Folge-Issue (braucht `yaml` bzw. einen Weg je PR) | bleibt bis dahin |
| harness-approval | Normalisierung, Parser, Anker-Form, Marker-Erkennung, Vorfilter, Red-Green der Scans; Kern-Block-Stopps (Besitz, im Bezieher hält sie das Drift-Gate) | CODEOWNERS spiegelt die Quelle; jede AGENTS.md ist geschützt; `@harness-waechter` steht nur in `test/harness/`; keine Kopie der Pre-Flight-Kriterien und keine abgelöste Label-Mechanik in Projekt-Texten | offen, Folge-Issue | bleibt |
| model-routing (Kopie `modell-projekt`) | Frontmatter-Parser, Tier-Erkennung, Matrix- und Phasen-Abgleich auf Fixtures; Besitz-Agenten (Drift-Gate) | Projekt-Agenten mit Alias und Effort, kein harter Pin, eindeutige Agent-Namen, Hauptchat-Modell in `.claude/settings.json`, Projekt-Phasen-Tabelle gegen Frontmatter | offen, Folge-Issue | bleibt |

## Bekannte Grenzen

- Im Wochenlauf ohne `PROJECT_TOKEN` meldet `ermittleLuecken` nur die Lücke zum Token; die Dateipunkte entfallen dann.
- Ein CI-Checkout sieht ungetrackte Dateien wie `CLAUDE.local.md` nicht; nur ein lokales `--pruefen` sieht sie.
- Die Regel `Root-Kontextdatei` betrifft nur Claude Code (Codex liest AGENTS.md ohnehin); der Doctor-Punkt selbst läuft in jeder Laufzeit.
- Umgesetzt sind zwei von fünf Regeln; Required-Check-Quellen, Leitplanken-Quelle und Modell-Routing folgen in einem eigenen Issue, bis dahin bleiben deren Projekt-Kopien. Der Bezieher kann nach dem nächsten Sync `agents-md-native-projekt` (ohne Prosa-Teil) und `line-endings-projekt` streichen.

- **Re-Evaluierung:** wenn die übrigen drei Regeln als Doctor-Punkte umgezogen sind (die Tabelle wird dort fortgeschrieben) oder wenn ein Bezieher eine strengere globale eol-Regel verlangt.
