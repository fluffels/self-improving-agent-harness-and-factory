# Codex im Harness

> 🧭 **Fachlich geprüft am: 2026-11-12.**

Der Adapter ist ein **Einrichtungs- und Review-Prototyp** für die lokale Codex CLI. Ob ein autonomer Ticketlauf erlaubt ist, entscheidet allein die **Freigabetabelle** `scripts/codex-freigaben.mjs`: je geprüfter CLI-Version ein Diagnose-Beleg und die fünf Nachweise unten, je Nachweis `offen` oder ein Beleg. Nur eine installierte Version, deren Eintrag alle fünf Nachweise mit Beleg führt, lässt den Einstieg aus [AGENTS.md](../../AGENTS.md) mit Exit 0 enden; heute ist keine Version freigegeben, auch vollständig aussehende Offline-Belege enden mit Exit 1. Eine neue Version braucht einen neuen Tabelleneintrag per reviewtem PR. Ein beauftragter Implementierungs-PR ist keine bestandene Ende-zu-Ende-Abnahme.

Der Prototyp umfasst Setup, Rollenquellen und Belegdiagnose. Die vollständige Unterstützung benötigt drei weitere Arbeitspakete: Hooks und Quarantäne, korrekte Tracing-Zuordnung samt Ausfallerkennung sowie ein isoliertes Gesamtsetup mit Probeauftrag. Die konkreten Nachfolger und Rohbelege sind im zugehörigen Implementierungs-PR verlinkt. Erst die Gesamtabnahme kann eine autonome Freigabe begründen.

## Gemeinsame Quellen und Rollen

`AGENTS.md` bleibt die Regelquelle, `.agents/skills/` die Skillquelle. Der Generator benötigt keine Claude-Skillkopien. Die Rollen stehen einmal in `scripts/codex-rollen.mjs`; Setup, Quellenprüfung und Belegdiagnose verwenden dieselbe Tabelle. Native `.codex/agents/*.toml` enthalten `name`, `description`, Effort, Instruktionen und unterstützte Feature-Reduktionen. Die fachlichen Quellen bleiben `.claude/agents/*.md`; deren Frontmatter und Claude-API-Beispiele sind keine Codex-Konfiguration.

| Phase | Codex-Rolle | Fachliche Quelle |
|---|---|---|
| Planung | Name aus `agenten.planer` | `factory-planer.md` |
| Umsetzung / Gruppen | `agenten.umsetzer` / `agenten.gruppe` | `factory-umsetzer.md` (Kern; bedingte Dateien `.agents/skills/factory/plattform-windows.md` und `umsetzer-*.md`, die der Kern bei Eintritt ihrer Bedingung nennt, gehören zur Rolle) / `factory-gruppe.md` |
| Architektur, Requirements, Tests | je unabhängiger Auftrag an `agenten.lens` | `factory-lens.md`, Skill `review-lenses` |
| Exploration | `explore` | `explore.md` |
| Szenarien / Abnahme | `holdout-szenario` / `holdout-abnahme` | gleichnamige Dateien |
| Quarantäne | **keine freigegebene Rolle** | Sicherheitsregeln in `AGENTS.md` |

Eine erzeugte Rolle ist erst nach erneutem Laden und tatsächlicher Discovery nutzbar. Ein Spawn von `default` belegt keine Custom-Agent-Datei. Planung, Lenses und die beiden Holdout-Rollen verwenden `high`, Umsetzung, Gruppen und Explore `medium` (Tabelle `ROLLEN` in `scripts/codex-rollen.mjs`); das Modell wird geerbt und im Probebericht anhand der Laufmetadaten benannt. Claude-Aliase haben keine belegte Codex-Entsprechung. Der Hauptagent übergibt den fachlichen Rollenvertrag aus der gemeinsamen Quelle; der Szenario-Agent erhält nur diesen Vertrag und das Ticket, keine zusätzliche Quellenbeschaffung.

Alle Rollen reduzieren `apps`, `plugins`, `memories` und `request_permissions_tool`; der Szenario-Agent zusätzlich `shell_tool`. Die Lens behält die für isolierte Sabotage nötigen Werkzeuge. **Read-Pflicht der Rollenquellen:** wo die Claude-Skills `Read` verlangen, entspricht in Codex `exec_command` mit einem Node-Lesebefehl; Pfad- und Holdout-Grenzen bleiben unverändert, Shell-Lesen ist kein Quarantäne-Grund (die generierten Rollentexte nennen das; die praktische Prüfung gehört zur Gesamtabnahme factory#367). Diese Reduktionen sind **keine** vollständige Tool-Allowlist, Read-only-Sandbox oder Quarantäne. `sandbox_mode`, `approval_policy` und `mcp_servers` lassen sich durch eine Custom-Agent-Datei nicht unabhängig von der Elternsession überschreiben. Eine TOML-Datei oder ein Prompt-Verbot allein belegt keine Rechteisolation.

## Konkrete Aufrufe

Die aktuelle Schnittstelle bietet `collaboration.spawn_agent`, `send_message` und `followup_task`; sie ist vor dem Lauf erneut zu prüfen. `Agent` und `SendMessage` aus den Claude-Skills werden nicht blind umbenannt. Beispiel mit bereits geladener Projektkonfiguration und geprüftem Ticket:

```javascript
const planer = await collaboration.spawn_agent({
  task_name: "planung", agent_type: config.agenten.planer, fork_turns: "none",
  message: `Plane Ticket #${ticket.nummer}: ${ticket.body}`,
});
await collaboration.send_message({ target: planer.task_name, message: "Ergänzung zur laufenden Planung: ..." });
await collaboration.followup_task({ target: planer.task_name, message: "Prüfe den Restauftrag am aktuellen Stand: ..." });
```

Fehlt der konfigurierte `agent_type`, ist das eine fehlende Rolle; `default` ist kein gleichwertiger Nachweis. Holdout-Szenarien bleiben beim Hauptagenten und gehen ausschließlich an den unabhängigen Abnahme-Agenten. Von den technischen Claude-Guards deckt der [Codex-Hook-Adapter](#codex-hook-schnittstelle-und-adapter-factory364) `lens-auftrag` und `holdout-auftrag` für `spawn_agent` ab (Wirkung im echten Lauf: factory#367); `lens-edit`, `holdout-guard` (Schreibgrenze der Abnahme, Lesegrenze des Szenario-Agenten) und die Nachrichtentrennung für `send_message`/`followup_task` sind nicht portiert.

## Reproduzierbares Setup

Voraussetzungen: vollständiges Quellrepo, Node gemäß `package.json`, Codex CLI und ein erreichbarer Langfuse-MCP-Endpunkt. Langfuse stellt einen eigenen Streamable-HTTP-Endpunkt unter `/api/public/mcp` bereit; eine Weboberflächen-URL oder irgendein anderer Public-API-Endpunkt genügt nicht. Der Generator hostet keinen Dienst und liest keine Authentifizierungswerte.

```powershell
npm.cmd ci
node scripts/codex-setup.mjs --langfuse-url https://langfuse.example.test/api/public/mcp --ausgabe ./codex-vorschau
node scripts/codex-setup.mjs --langfuse-url https://langfuse.example.test/api/public/mcp --ausgabe ./codex-vorschau --write
```

Die Beispieladresse ersetzen. `--ausgabe` bestimmt den Ausgabeordner, darunter entsteht `.codex/`; ohne Option ist das Quellrepo das Ziel. `.mcp.json`, Projektkonfiguration und Rollenquellen werden immer aus dem Quellrepo des Skripts gelesen. Ein leerer Ausgabeordner braucht diese Quellen nicht selbst zu enthalten. Ohne `--write` gibt es nur eine Vorschau und keine Dateierstellung.

Vor dem Schreiben werden reguläre Quelldateien, Zielroot samt bestehenden Vorfahren, alle Zielpfade und Kollisionen geprüft. Symlinks/Junctions werden nicht verfolgt, auch nicht in Vorfahren des Ausgabeordners. Metadatenverzeichnisse wie `.git`/`.agents` und die globale Codex-Konfiguration sind keine Ausgabeziele. Identische Dateien bleiben unberührt; ein abweichender Entwurf stoppt vor dem ersten Schreibvorgang. Es gibt weder Force-Modus noch automatische Zusammenführung oder Entfernung bestehender Konfiguration. Gleichzeitige fremde Dateisystemänderungen während der Generierung sind keine unterstützte Transaktion.

Playwright-Befehl und Argumente kommen aus `.mcp.json`; Langfuse erhält eine Lese-Toolliste. Beide Server sind `required = true`. Der Host bezieht einen **vollständigen** Authorization-Header aus der extern gesetzten Variable `LANGFUSE_MCP_AUTHORIZATION`:

```toml
env_http_headers = { Authorization = "LANGFUSE_MCP_AUTHORIZATION" }
```

Beim direkten Langfuse-Endpunkt ist das ein Basic-Header mit Public-/Secret-Key. Der Header und seine Base64-Darstellung sind secretäquivalent. Sie gehören weder ins Repo noch in Logs, Ausgabe oder Prompts. Der Generator liest und erzeugt sie nicht und greift nicht auf Key-Dateien zu. Das Bereitstellen der Authentifizierung durch den MCP-Host ist kein Agentenskript zum Auslesen des Langfuse-Secret-Keys; die Regel aus `AGENTS.md` bleibt bestehen. Daraus folgt **keine** Isolation gegenüber geerbter Shell, Umgebungsvariablen oder privaten MCP-Verbindungen. Die konkrete sichere Bereitstellung und der echte authentifizierte MCP-Aufruf bleiben zu prüfen.

**Modus `--langfuse-auth host`:** lässt `env_http_headers` weg (Standard `env`, ungültiger Wert Exit 2); `required = true` und die Lese-Toolliste bleiben. Der MCP-Host liefert dann die Anmeldung selbst. Die Wirkung ist eine **Beobachtung aus einem Bezieher-Pilot** und in der Fabrik nicht geprüft.

Das Setup schreibt außerdem `.codex/hooks.json` (PreToolUse-Hook auf `node scripts/codex-hook.mjs`, fester Timeout, [Schnittstelle](#codex-hook-schnittstelle-und-adapter-factory364)); die Datei ist lokal und ungetrackt (im Zielrepo sorgt das Setup dafür, factory#397: ist eine der erzeugten Dateien dort noch nicht ignoriert, legt es `.codex/.gitignore` an, die sich selbst mitignoriert; die Projekt-`.gitignore` bleibt unberührt, ist alles schon ignoriert, ändert sich nichts), `node scripts/codex-vorpruefung.mjs` meldet eine fehlende oder abweichende Registrierung (und eine inline `[hooks]`-Tabelle in `.codex/config.toml`) als Mangel. Codex lädt Projekt-Hooks nur bei vertrauter `.codex/`-Ebene, neue oder geänderte Hooks laufen erst nach der Prüfung per `/hooks`.

Anschließend in einer neu geladenen, vertrauenswürdig eingerichteten Sitzung `codex --strict-config doctor --summary`, tatsächliche Rollen-Discovery und echte MCP-Aufrufe prüfen. Doctor oder eine Serverliste allein belegen keine nutzbare Verbindung. Generierte Konfiguration bleibt lokal; im Konsumenten kommen die Generatoren über das Besitz-Manifest. Ein Konsumenten-Sync gehört nicht zum Setup.

## Windows-Probe

Für Codex CLI 0.164.0 unter Windows wurde `command = "npx"` mit einem lokalen, offline installierten harmlosen MCP-Fixture-Paket geprüft. Ein isolierter temporärer App-Server erhielt `initialize`, `initialized` und `mcpServerStatus/list`. Serverinformationen und das deklarierte `ping`-Werkzeug waren sichtbar, `toolsError` war null; ein Fixture-Marker belegte den Initialize-Aufruf. Direkter Node-Start und `cmd /d /c npx` waren ebenfalls erfolgreich. Ein `cmd`-Wrapper ist für diesen belegten `npx`-Start daher nicht nötig. Diese Probe belegt weder das echte Playwright-Paket, einen Browseraufruf noch die Langfuse-Authentifizierung oder Modell-/Subagent-Erfassung. Hilfsprozesse wurden beendet. Die Probe nutzte keine persönlichen Konfigurationen oder Secrets und keine Modellabfrage; npm lief im Offlinemodus. Netzwerkverkehr des App-Servers wurde nicht mitgeschnitten.

Die im Implementierungs-PR dokumentierten zusätzlichen Rollen- und Browserproben belegen tatsächliche Aufrufe aller sieben Custom-Rollen mit Modell, Effort und Verbrauch sowie einen modellgesteuerten Playwright-Aufruf auf eine lokale Fixture mit erfolgreichem Schließen des Browsers. Ohne Kontextvererbung hatten die Rollen eigene Agent-IDs und direkte Elternbezüge. Der falsche Repo-Tag und fehlerhafte Identitäten bei Kontextvererbung bleiben offen; die Proben belegen weder technische Quarantäne noch vollständiges Tracing. Die dort verlinkte negative Gesamtabnahme samt Negativproben bleibt maßgeblich für die noch fehlende Gesamtfreigabe.

## Offene Full-Access-Diskrepanz (K3/K6)

Ungeklärt bleibt, weshalb eine berichtete Full-Access-Oberfläche und unterschiedliche Genehmigungsanforderungen bei Hauptagent und allgemeinen Subagenten zusammen auftreten konnten. Die technische Ursache ist nicht nachgewiesen. Ein separater CLI-Doctor beschreibt nicht automatisch die Rechte einer laufenden App-Sitzung; aktuelle uneingeschränkte Befehle erklären frühere Grenzen ebenfalls nicht. Der Generator erzeugt deshalb kein pauschales `.git`-/`.agents`-/`.codex`-Schreibprofil und ändert keine globale Einstellung.

Geplante Vergleichsprobe: zwei separat konfigurierte, harmlose Elternsessions mit dokumentierter Read-only- beziehungsweise Workspace-Grenze; jeweils dieselbe **explizite Custom-Rolle**, identischer Marker-Lese-/Schreibauftrag in einem Testordner und erfasstes tatsächliches Tool-/MCP-Angebot. Vorher private Connectoren und Secrets aus der Probeumgebung ausschließen. Sandbox-, Genehmigungs- und blockierte Zugriffsresultate mit Laufmetadaten vergleichen. `collaboration.spawn_agent` bietet hier kein `sandbox`-Feld; eine getrennte Kind-Sandbox darf nicht durch erfundene Argumente behauptet werden. Diese Vergleichsprobe ist offen. `approval_policy = "never"` allein erlaubt keine blockierten Aktionen; ein Moduswechsel ist kein Ersatz für die Schutzabnahme.

## Sicherheits- und Hook-Abbildung

Codex unterstützt Hooks; die folgenden Claude-Registrierungen sind trotzdem **für Codex nicht registriert oder nicht als wirksam nachgewiesen** (Grenze bis zur Freigabe des Codex-Adapters):

| Bestehender Schutz | Codex-Stand |
|---|---|
| `SessionStart`: Haupt-Sync, Sandbox-/MCP-Diagnose | manuelle Skripte sind keine automatische Codex-Registrierung; Grenzen je Zeile im [Abschnitt Sitzungs-Hooks](#tracing-ausfallstopp-und-sitzungs-hooks-factory365) |
| `SessionStart`: Langfuse-Health (`langfuse-vorbedingung.mjs`) | Tracing-Ausfallstopp (factory#365): Vorprüfung `scripts/codex-vorpruefung.mjs` (Mangel „Tracing-Ausfall“, Exit 1) und Health-Prüfung vor `spawn_agent` im Adapter |
| `SessionStart` / `SessionEnd`: Langfuse-Abgleich (`SessionStart` startet zusätzlich den Wochenbericht-Lauf) | Claude-Transkripte/Plugin sind kein reproduzierbarer Codex-Exporter |
| `PreToolUse`: Worktree-, GitHub-, Stdin-Skript-Guard, inkl. Stash-Sperre (`worktree-guard-hook.mjs`, Test in `codex-hook.test.ts`) und destruktive `gh`-Unterbefehle hinter Wrappern (`gh-guard-hook.mjs`, factory#397; aus ask wird Deny) | Adapter `scripts/codex-hook.mjs` für `exec_command`/Shell und `apply_patch` (Schreibziele); Wirkung im echten Codex-Lauf erst mit factory#367 belegt |
| Lens-Auftrags- und Holdout-Auftrags-Guard | Adapter für `spawn_agent` (immer Arm A der A/B-Messung); Wirkung erst mit factory#367 belegt |
| Lens-Edit-Guard, Holdout-Nachrichtentrennung (`send_message`, `followup_task`), `holdout-guard.mjs` (Schreibgrenze der Abnahme, Lesegrenze des Szenario-Agenten) | **nicht abgedeckt**: keine technische Erzwingung für Codex; Feature-Reduktion ersetzt diese Guards nicht |
| `SubagentHandback`, `Stop` / `SubagentStop` | keine belegte Codex-Abschluss-/Commit-/Worktree-Erzwingung (Grenze mit Begründung im [Abschnitt Sitzungs-Hooks](#tracing-ausfallstopp-und-sitzungs-hooks-factory365)) |
| Git-/PR-Gates und Nachweise | bleiben bestehen; ersetzen keinen PreToolUse-Schutz |
| Fremdtext | bestehendes `fremdtext.mjs` verweigert unvertraute Autoren/Forum-Tickets; allgemeine Subagenten sind keine Quarantäne |

Hook-Fehler und Timeouts können beim Host ohne Werkzeugblockade enden (fail-open, außerhalb unserer Kontrolle; der Adapter verweigert bei eigenem Fehler selbst). Dokumentierte Matcher-Aliase für `exec_command`, `spawn_agent` und `apply_patch` belegen nicht alle Pfade: etwa `write_stdin` hat kein neues PreToolUse, gehostete Websuche ist nicht überall erfasst. Direkte Dateiwerkzeuge, private Connectoren und schreibende MCPs gehören deshalb in die reale Negativprobe.

## Codex-Hook-Schnittstelle und Adapter (factory#364)

Quelle aller Angaben: [Hooks](https://learn.chatgpt.com/docs/hooks), abgerufen am 2026-11-12 (Zusammenfassung der Seite, Version nicht belegt; die Doku warnt, Schemas auf `main` könnten Felder enthalten, die im Release fehlen). Test-Fixtures folgen nur den hier genannten Formen; **nicht dokumentiert** heißt: der Adapter verweigert fail-closed, bis factory#367 das echte Format belegt.

- **Registrierung:** `<repo>/.codex/hooks.json` oder inline `[hooks]` in `<repo>/.codex/config.toml` (beides wird geladen; das Setup nutzt `hooks.json`). Form: `{"hooks":{"PreToolUse":[{"matcher":"<Regex auf tool_name>","hooks":[{"type":"command","command":"…","timeout":30}]}]}}`; `timeout` in Sekunden (Standard 600). Projekt-Hooks laden nur bei vertrauter `.codex/`-Ebene; neue oder geänderte Hooks werden bis zur Prüfung per `/hooks` übersprungen.
- **Arbeitsverzeichnis:** der Befehl läuft im Session-`cwd`; ein relativer Befehl wie `node scripts/codex-hook.mjs` setzt voraus, dass die Session im Repo-Wurzelordner läuft (die Doku empfiehlt die Auflösung über die Git-Wurzel). Grenze, solange factory#367 es nicht belegt.
- **Payload (stdin):** `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `turn_id`, `tool_name`, `tool_use_id`, `tool_input`. Shell-Befehle (auch `exec_command`) melden `tool_name: "Bash"` mit `tool_input.command`; `apply_patch` meldet `tool_name: "apply_patch"` mit dem Patchtext in `tool_input.command`; `spawn_agent` passt auch auf den Matcher `Agent`. Nicht dokumentiert: `tool_input` von `spawn_agent` (der Adapter erwartet `agent_type` und `message`), das Feld `workdir` der Shell (der Adapter wertet es aus, falls vorhanden), die Grammatik des Patchtextes (der Adapter erwartet `*** Begin Patch`, `Add|Update|Delete File`, `Move to`, `End Patch` und verweigert jede andere Direktive), die Shell von `exec_command` unter Windows (der Adapter behandelt `Bash` und `exec_command` als Shell).
- **Deny:** `hookSpecificOutput.permissionDecision: "deny"` samt `permissionDecisionReason` auf stdout (wie `buildDenyOutput`), alternativ Exit 2 mit Grund auf stderr. `ask` wird nicht unterstützt: der Lauf gilt als fehlgeschlagen und das Werkzeug läuft; der Adapter macht darum aus jedem `ask` ein Deny. Ungültige Ausgabe, Fehler und Timeout lassen das Werkzeug laufen (fail-open beim Host); die Doku nennt Hooks „a useful guardrail, not a complete enforcement boundary“.
- **Ohne PreToolUse:** `write_stdin` (löst es für einen schon geprüften Befehl nicht erneut aus), gehostete Websuche, einzelne spezialisierte Werkzeugpfade.

**Fixtures:** die Tests des Adapters folgen den hier genannten dokumentierten Formen; `spawn_agent` folgt dem Aufrufbeispiel `collaboration.spawn_agent({ agent_type, message })` weiter oben in dieser Seite, weil die Hook-Seite sein `tool_input` nicht beschreibt. Als **Annahme** gekennzeichnet (undokumentiert, nur fail-closed abgesichert, Beleg durch factory#367) sind `workdir`, `tool_name: "exec_command"`, der Alias `Agent` (als `tool_name` im Payload; der Matcher-Alias ist dokumentiert) und die Patch-Direktiven.

**Adapter `scripts/codex-hook.mjs`:** übersetzt in die Claude-Form und ruft `dispatch` aus `scripts/pretooluse-dispatch.mjs` (Lib; der Einstieg `scripts/pretooluse-hook.mjs` re-exportiert es), es gibt keine Kopie der Guard-Logik. Shell → `Bash` (Worktree-, gh-, Stdin-Skript-Guard) und danach die `Bash(…)`-Regeln aus `permissions.deny`/`permissions.ask` der `.claude/settings.json` je Befehlssegment (so greift `gh issue delete`, das Claude nur über `ask` fängt); `apply_patch` → je Schreibziel ein `Write` an den Schreibziel-Guard (Haupt-Checkout und `.git` gesperrt, Selbstschutz für `.codex`); `spawn_agent` (und der Alias `Agent`) → `Agent` (Lens-Auftrags- und Holdout-Auftrags-Guard, Codex bleibt bei Arm A). Unlesbares Payload, unbekanntes Feldformat, werfender oder nicht ladbarer Guard und unlesbare `settings.json` ergeben für diese Werkzeuge ein Deny; andere Werkzeugnamen bleiben unberührt.

**Grenzen:** `write_stdin`, direkte Dateiwerkzeuge außer `apply_patch`, MCP, `send_message`/`followup_task`, gehostete Websuche; Hook-Trust beim Host (die Vorprüfung sieht ihn nicht, globale Codex-Dateien liest sie nicht); Fehler und Timeout beim Host fail-open; relativer `command`; Schreibzugriffe aus der Shell ohne Pfad-Guard (wie bei Claude); Push auf `main` aus einem Worktree (Serverschutz wie bei Claude); ob ein Lauf in einem verlinkten Worktree die `.codex/hooks.json` des Haupt-Checkouts lädt, ist offen; liegt der Adapter selbst (`scripts/codex-hook*.mjs`, `scripts/pretooluse-dispatch.mjs`) oder `.claude/settings.json` im Arbeitsbaum der Session, kann `apply_patch` dort schreiben (Schutz erst am PR über die Leitplanken, wie bei Claude); die Berechtigungsregeln liest der Adapter nur aus `.claude/settings.json` des Repos (nicht aus `settings.local.json`, Nutzer- oder Managed-Einstellungen) und gleicht je Befehlssegment wörtlich ab (Glob mit `*`, Präfix mit `:*`): erkannt werden vorangestellte Zuweisungen, `env` (mit `-i`, `-u <n>`, `--`), `command`, `exec`, `nohup`, `time`, Pfadformen (`/bin/rm`, Windows-Pfad mit `.exe`), `bash|sh|zsh|dash -c|-lc` mit genau einem gequoteten Argument (rekursiv bis Tiefe 3) und mehrfache Leerzeichen; nicht erkannt werden Optionen vor dem Unterbefehl (`git -C x push --force`), Variablen oder verschachtelte Quotes im Interpreter-String, `eval` und weitere Wrapper (außerdem registriert Codex die Frontmatter-Hooks der Lens nicht: Edit-Pfad-Sperre und Hintergrund-Sperre fehlen dort) (die destruktiven `gh`-Unterbefehle fängt davon unabhängig der gh-Guard, auch hinter `env`, Zuweisung, Pfad und `bash -c`, nicht aber mit Optionen zwischen den Unterbefehl-Wörtern); Schreibziele mit `.git` oder `.codex` sperrt er in jeder Schreibweise, `.git` zusätzlich über einen Symlink am aufgelösten Ort (ein Symlink auf `.codex` und Windows-Aliasformen wie `.git.`, Kurznamen oder ADS-Pfade erkennt er nicht); Schreiben aus der Shell bleibt ohne Pfad-Guard (nur die Shell kann einen Symlink anlegen). Die reale Wirkung und die Langfuse-Erfassung in Codex belegt factory#367.

## Tracing-Ausfallstopp und Sitzungs-Hooks (factory#365)

**Tracing-Ausfallstopp:** Ein Codex-Lauf beginnt nicht und spawnt keine Rolle, solange Langfuse nicht erreichbar ist. Zwei Stellen, beide über `pruefeLangfuseAusUmgebung` in `scripts/langfuse-health.mjs` (GET `<Adresse>/api/public/health`, Frist `FRIST_MS` = 3 s, kein Secret-Key):

- **Vorprüfung** (`node scripts/codex-vorpruefung.mjs`): unerreichbar, Frist überschritten, HTTP ≠ 200 oder ein 200 ohne gültigen Body (JSON mit `status` = „OK“, wie `/api/public/health` ihn liefert) ergibt den Mangel „Tracing-Ausfall“ und Exit 1, auch bei sonst vollständiger Freigabe.
- **Hook-Adapter** (`scripts/codex-hook-lib.mjs`): vor `spawn_agent` (Alias Agent) und vor dem Dispatcher; Ausfall oder werfende Prüfung ergibt ein Deny „Tracing-Ausfallstopp“, kein Spawn. Bei Erreichbarkeit bleibt der Guard-Entscheid (Lens-Auftrag, Holdout) unverändert. Shell und `apply_patch` rufen die Health nicht; die Latenz bei Ausfall beträgt höchstens 3 s je Aufruf.

**Adresse:** `LANGFUSE_BASE_URL`, sonst die Plugin-Optionen der Claude-User-Settings, sonst `http://localhost:3000` (wie `langfuse-vorbedingung.mjs`, das unter Claude unverändert bleibt). Den Exporter-Endpunkt im Codex-User-Scope liest die Prüfung nicht; weicht er von der Adresse ab, ist `LANGFUSE_BASE_URL` zu setzen.

**Grenze:** Den Ausfall des externen Exporters bei erreichbarem Langfuse erkennt nur die nachträgliche Belegdiagnose (`--belege`); ein Live-Abgleich bräuchte den Secret-Key im Agentenlauf.

**Hook-Ereignisse von Codex** (offizielle Hook-Doku https://learn.chatgpt.com/docs/hooks, abgerufen am 2026-11-12): `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStart`, `SubagentStop`, `Stop`, `PreModelRequest`, `PostModelRequest`, `Interrupt`, `SessionStart`, `SessionEnd`. `SessionStart` (Matcher auf `source`: startup, resume, clear, compact, fork) fügt stdout als Kontext hinzu; `SessionEnd` ist beratend, Standard 1 s, höchstens 3 s; `Stop` und `SubagentStop` kennen `stop_hook_active`, ein Block setzt den Turn fort und auf stdout ist nur JSON gültig. Die Statuszeile (`tui.status_line`, Konfigurationsreferenz, ebenfalls am 2026-11-12 abgerufen) ist eine Liste eingebauter Elemente, ohne Befehl. Der Abgleich beruht auf Zusammenfassungen der Seiten, nicht auf zeichengenauem Text.

**Die übrigen Zeilen der Hook-Tabelle** (`test/harness/laufzeit-vertraege.test.ts`, Wächter V3/V5): nur `langfuse-vorbedingung` hat einen Codex-Adapter (die Vorprüfung). Die sechs anderen sind bewusst Grenzen, weil eine Registrierung ohne Wirkungsbeleg Verhalten einführte, das erst factory#367 prüft und factory#368 übernimmt:

| Zeile | Grenze |
|---|---|
| `haupt-sync` | `SessionStart` existiert, ist nicht registriert; Schritt 0 des Ticket-Skills hebt den Hauptcheckout selbst, ohne `Sitzungsbasis:` setzt der Skill den Umsetzer-Zusatz fail-closed (factory#367, factory#368) |
| `langfuse-abgleich-hook` | `SessionStart`/`SessionEnd` existieren; der Nachlieferer liest Claude-Transkripte, Codex exportiert über den externen Exporter (factory#367) |
| `sandbox-doctor` | `SessionStart` existiert; der Doktor prüft die Claude-Sandbox, die Rechteprobe von Codex ist Nachweis 3 (factory#367) |
| `mcp-ausfall` | `SessionStart` existiert; das Skript liest die MCP-Logs von Claude Code, Codex prüft beim Start nativ über `required = true`, ein Ausfall mitten im Lauf bleibt ohne Meldung (factory#367) |
| `stop-verify-hook` | `Stop`/`SubagentStop` existieren; Rollenname in `agent_type` und Abschlussformat (`last_assistant_message` statt Handback) sind unbelegt; Waisen-Worktrees räumt man unter Codex von Hand (`node scripts/cleanup-worktrees.mjs --fix`) (factory#367, factory#368) |
| `statusline` | die Codex-Statuszeile kennt keinen Befehl; der Kontingent-Snapshot fehlt unter Codex (factory#249) |

## Vorprüfung und Nachweisformat

`node scripts/codex-vorpruefung.mjs [--belege <JSON-Datei>]` ändert nichts (die Werkzeug-Vorprüfung führt nur die deklarierten Prüfbefehle aus; die Versionsabfrage startet `codex --version`, unter Windows `codex.cmd`). Exit 2 bedeutet Aufruffehler, Exit 1 den gesperrten Einstieg, Exit 0 die Freigabe: die Version aus `codex --version` stimmt mit `version` der Belege überein, steht in der Freigabetabelle mit allen fünf Nachweisen belegt, und kein anderer Mangel liegt vor. Je ein eigener Mangel: keine ermittelbare Version (kein `codex` im PATH), Abweichung zwischen installierter und belegter Version, Version nicht in der Tabelle; offene Nachweise nennt die Sperrzeile mit ihren Nummern. Weder Claim noch Umsetzung werden gestartet. Sie fragt zusätzlich die Langfuse-Health ab (Tracing-Ausfallstopp, [Abschnitt](#tracing-ausfallstopp-und-sitzungs-hooks-factory365)); ein Ausfall ist ein eigener Mangel „Tracing-Ausfall“. Sie meldet außerdem veraltete oder verwaiste lokale Rollen-Dateien in `.codex/agents/` (Vergleich mit dem Setup-Soll; Behebung: Datei löschen, `node scripts/codex-setup.mjs --langfuse-url <URL> --write`). Sie hängt außerdem die Mängel der Werkzeug-Vorprüfung (`node scripts/werkzeug-vorpruefung.mjs`: MCP-Server, Node-Version, Projekt-Befehle) als Zeilen `Werkzeug-Vorprüfung: …` an `maengel` an; die MCP-Verbindung selbst prüft Codex mit `required = true` nativ. Vollständige Offline-Daten allein heben diese Sperre nicht auf (ohne Tabelleneintrag der Version bleibt Exit 1); JSON ist selbst attestierbar und keine signierte Laufzeitattestierung.

Die Datei enthält `version`, `sessionId`, tatsächlich entdeckte `rollen`, erfolgreich aufgerufene MCP-Server in `tools` sowie rohe Langfuse-`observations`. Jede Observation braucht ID, dieselbe Session, Repo-Tag `project:<Repositoryname>` aus der Projektkonfiguration, Typ, Metadaten und für Generations gültigen Verbrauch (`input`, `output`). Identische Wiederholungen einer Observation-ID zählen einmal; widersprüchliche Zeilen derselben ID werden verworfen und diagnostiziert. Haupt-/Unteragenten haben unterschiedliche nichtleere `agent_id`; `parent_thread_id` muss direkt oder transitiv über etwa den Umsetzer zum eindeutigen Hauptagenten führen. Zyklen, unverbundene Ketten und widersprüchliche Eltern-/Rollenidentitäten gelten auch an der Root nicht als Beleg.

Für **jede** erwartete Custom-Rolle ist eine eigene verknüpfte Generation mit Verbrauch nötig. Der Rollenname stammt aus dem echten flachen Metadatum `agent_source.subagent.thread_spawn.agent_role` oder der gleich aufgebauten verschachtelten Struktur; widersprüchliche Formen werden abgelehnt. Ein `rollen`-Inventar, `metadata.agent_role = "subagent"`, eine Generation der Rolle `default` oder ein Spawn-Tool allein beweisen keine Custom-Rolle. Exportfelder werden nicht zum Bestehen erfunden. Unterschiedliche Exporterformate und Reproduzierbarkeit müssen real geprüft werden.

Ein Tabelleneintrag führt je Nachweis einen überprüfbaren Beleg, zusammen diese fünf:

1. Frisches Gesamtsetup: native Rollen-Discovery und realer Einsatz aller relevanten Custom-Rollen; Rollen-/Modell-/Effort-Laufmetadaten und Quellenbezug stimmen.
2. Echte Playwright-/Langfuse-Aufrufe samt sicherer Authentifizierung; jeweils fehlender Server und fehlende Rolle stoppen den abhängigen Ablauf.
3. Isolierte Rechteprobe, geklärte Eltern-/Kind-Rechte und Hook-Denials einschließlich Fehler-/Timeoutpfaden, direkter Dateiwerkzeuge und Fremdtexte.
4. Vollständiger Export: Hauptagent, alle Rollen und relevante Werkzeuge mit Repo-/Session-/Elternverknüpfung und Verbrauch; Tracing-Ausfall stoppt nachvollziehbar.
5. Abgegrenztes Probe-Ticket gemäß unabhängigem Review und Holdout-Abnahme, einschließlich Negativfällen. Ein Healthcheck allein genügt nicht.

Der beobachtete `private-codex-exporter` 1.1.0 liegt außerhalb des Repositories und wird vom Setup weder installiert noch konfiguriert. Tatsächliche Custom-Rollen sind in den dokumentierten Proben erfasst; kanonische Repo-Zuordnung, Identitäten bei Kontextvererbung und vollständige Werkzeugerfassung sind damit noch nicht belegt. Seine reproduzierbare Bereitstellung und Exportvollständigkeit gehören zu den Tracing- und Gesamtsetup-Arbeiten. Allgemeine Subagent-Generationen allein schließen diese Lücken nicht.

**Tabellenformat und Freigabeweg:** `FREIGABEN` bildet die Version `x.y.z` auf `{ diagnose, nachweise }` ab; `diagnose` ist die Beleg-URL des Diagnose-Belegs (PR, Kommentar, Lauf), `nachweise` führt genau die Schlüssel 1 bis 5, je `"offen"` oder `{ beleg: <Beleg-URL> }`. Belege stehen in API-Form per Repo-ID `https://api.github.com/repositories/<id>/…/<id>` (Kern-Dateien tragen weder Owner noch Repo-Namen); das Muster steht an einer Stelle, `BELEG_URL_QUELLE` in `scripts/codex-freigaben.mjs` (`istBelegUrl` und der Git-Host-Wächter bauen daraus), die Web-Adresse liefert `gh api <url> --jq .html_url`. Eine Freigabe entsteht nur per reviewtem PR (Leitplanke mit Audit-Kommentar) mit Beleg je Nachweis; ein ungültiger Wert zählt als offen, und ein Wächter-Test der Tabelle verlangt Diagnose-Beleg und diese Form. Startbestand: `0.164.0` mit Diagnose-Beleg factory#82, alle fünf Nachweise offen (die Nachweise erbringen factory#367 und factory#368).

Die Prüfung muss anhand echter Laufdaten erfolgen; die Liste selbst erteilt keine Freigabe. Die Schutz-, Tracing- und Gesamtanforderungen bleiben in den verlinkten Nachfolgern offen. Eine bestandene Teilabnahme des Prototyps ersetzt sie nicht.

## Laufzeit-Verträge

`test/harness/laufzeit-vertraege.test.ts` hält Claude und Codex hermetisch in `verify` zusammen: Skill-Zeiger, Rollenquellen, Hook-Tabelle (der `PreToolUse`-Dispatcher hat den Adapter `scripts/codex-hook.mjs`, dessen transitive Importe den Dispatcher und seine Guards decken; die Zeile `langfuse-vorbedingung` mit dem Adapter `codex-vorpruefung.mjs`, die übrigen Hooks ohne Codex-Adapter mit Ereignisbezug und Grenze factory#367, factory#368 bzw. factory#249; V5 gleicht die Ereignisliste des Abschnitts Tracing-Ausfallstopp mit dem Wächter ab) und die AGENTS.md-Größe gegen das Codex-Standardlimit. Ein echter Codex-Lauf ist in CI nicht möglich und gehört zur Gesamtabnahme factory#367 (Epic factory#249).

## Quellen

Hook-Schnittstelle abgerufen am 2026-11-12 (siehe Abschnitt Codex-Hook-Schnittstelle). Dokumentationsbasis vom 2026-10-27: [Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Hooks](https://learn.chatgpt.com/docs/hooks), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Permissions](https://learn.chatgpt.com/docs/permissions), [App-Server](https://learn.chatgpt.com/docs/app-server), [erweiterte Konfiguration](https://learn.chatgpt.com/docs/config-file/config-advanced) und [Langfuse MCP/Auth](https://langfuse.com/docs/api-and-data-platform/features/mcp-server). OTel gehört in den User-Scope; OTel-Logs sind nicht automatisch Langfuse-Generationen. Produktdokumentation ersetzt keine Harness-Probe.
