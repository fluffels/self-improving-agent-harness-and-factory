# Codex im Harness

Der Adapter ist ein **Einrichtungs- und Review-Prototyp** für die lokale Codex CLI 0.164.0. Autonome Ticketläufe sind nicht freigegeben. Der Einstieg aus [AGENTS.md](../../AGENTS.md) endet auch mit vollständig aussehenden Offline-Belegen mit Exit 1. Die Versionsprüfung ist absichtlich auf diesen geprüften Stand begrenzt; andere Versionen benötigen eine neue Prüfung. Ein beauftragter Implementierungs-PR ist keine bestandene Ende-zu-Ende-Abnahme.

Der Adapter umfasst Setup, Rollenquellen, Belegdiagnose und zwei begrenzte Schutzeinstiege: einen Einzelaktionshost und eine toolarme Fremdtext-Elterninstanz. Korrekte Tracing-Zuordnung samt Ausfallerkennung und ein isoliertes Gesamtsetup mit Probeauftrag bleiben separat abzunehmen. Erst die Gesamtabnahme kann eine autonome Freigabe begründen; freie App-/CLI-Shells sind durch diese Eingänge nicht geschützt.

## Gemeinsame Quellen und Rollen

`AGENTS.md` bleibt die Regelquelle, `.agents/skills/` die Skillquelle. Der Generator benötigt keine Claude-Skillkopien. Die Rollen stehen einmal in `scripts/codex-rollen.mjs`; Setup, Quellenprüfung und Belegdiagnose verwenden dieselbe Tabelle. Native `.codex/agents/*.toml` enthalten `name`, `description`, Effort, Instruktionen und unterstützte Feature-Reduktionen. Die fachlichen Quellen bleiben `.claude/agents/*.md`; deren Frontmatter und Claude-API-Beispiele sind keine Codex-Konfiguration.

| Phase | Codex-Rolle | Fachliche Quelle |
|---|---|---|
| Planung | Name aus `agenten.planer` | `factory-planer.md` |
| Umsetzung / Gruppen | `agenten.umsetzer` / `agenten.gruppe` | `factory-umsetzer.md` / `factory-gruppe.md` |
| Architektur, Requirements, Tests | je unabhängiger Auftrag an `agenten.lens` | `factory-lens.md`, Skill `review-lenses` |
| Exploration | `explore` | `explore.md` |
| Szenarien / Abnahme | `holdout-szenario` / `holdout-abnahme` | gleichnamige Dateien |
| Quarantäne | **keine freigegebene Rolle** | Sicherheitsregeln in `AGENTS.md` |

Eine erzeugte Rolle ist erst nach erneutem Laden und tatsächlicher Discovery nutzbar. Ein Spawn von `default` belegt keine Custom-Agent-Datei. Planung und Lenses verwenden `high`, Umsetzung und Explore `medium`; das Modell wird geerbt und im Probebericht anhand der Laufmetadaten benannt. Claude-Aliase haben keine belegte Codex-Entsprechung. Der Hauptagent übergibt den fachlichen Rollenvertrag aus der gemeinsamen Quelle; der Szenario-Agent erhält nur diesen Vertrag und das Ticket, keine zusätzliche Quellenbeschaffung.

Alle Rollen reduzieren `apps`, `plugins`, `memories` und `request_permissions_tool`; der Szenario-Agent zusätzlich `shell_tool`. Die Lens behält die für isolierte Sabotage nötigen Werkzeuge. Diese Reduktionen sind **keine** vollständige Tool-Allowlist, Read-only-Sandbox oder Quarantäne. `sandbox_mode`, `approval_policy` und `mcp_servers` lassen sich durch eine Custom-Agent-Datei nicht unabhängig von der Elternsession überschreiben. Eine TOML-Datei oder ein Prompt-Verbot allein belegt keine Rechteisolation.

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

Fehlt der konfigurierte `agent_type`, ist das eine fehlende Rolle; `default` ist kein gleichwertiger Nachweis. Holdout-Szenarien bleiben beim Hauptagenten und gehen ausschließlich an den unabhängigen Abnahme-Agenten. Die fachlichen Auftragsguards sind im Codex-Adapter abgebildet; ein technischer Executor für Agenten-/Nachrichtenpfade fehlt weiterhin. Der geschützte Host stoppt diese abhängigen Abläufe vor dem Start.

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

Anschließend in einer neu geladenen, vertrauenswürdig eingerichteten Sitzung `codex --strict-config doctor --summary`, tatsächliche Rollen-Discovery und echte MCP-Aufrufe prüfen. Doctor oder eine Serverliste allein belegen keine nutzbare Verbindung. Generierte Konfiguration bleibt lokal; im Konsumenten kommen die Generatoren über das Besitz-Manifest. Ein Konsumenten-Sync gehört nicht zum Setup.

## Windows-Probe

Für Codex CLI 0.164.0 unter Windows wurde `command = "npx"` mit einem lokalen, offline installierten harmlosen MCP-Fixture-Paket geprüft. Ein isolierter temporärer App-Server erhielt `initialize`, `initialized` und `mcpServerStatus/list`. Serverinformationen und das deklarierte `ping`-Werkzeug waren sichtbar, `toolsError` war null; ein Fixture-Marker belegte den Initialize-Aufruf. Direkter Node-Start und `cmd /d /c npx` waren ebenfalls erfolgreich. Ein `cmd`-Wrapper ist für diesen belegten `npx`-Start daher nicht nötig. Diese Probe belegt weder das echte Playwright-Paket, einen Browseraufruf noch die Langfuse-Authentifizierung oder Modell-/Subagent-Erfassung. Hilfsprozesse wurden beendet. Die Probe nutzte keine persönlichen Konfigurationen oder Secrets und keine Modellabfrage; npm lief im Offlinemodus. Netzwerkverkehr des App-Servers wurde nicht mitgeschnitten.

Die im Implementierungs-PR dokumentierten zusätzlichen Rollen- und Browserproben belegen tatsächliche Aufrufe aller sieben Custom-Rollen mit Modell, Effort und Verbrauch sowie einen modellgesteuerten Playwright-Aufruf auf eine lokale Fixture mit erfolgreichem Schließen des Browsers. Ohne Kontextvererbung hatten die Rollen eigene Agent-IDs und direkte Elternbezüge. Der falsche Repo-Tag und fehlerhafte Identitäten bei Kontextvererbung bleiben offen; die Proben belegen weder technische Quarantäne noch vollständiges Tracing. Die dort verlinkte negative Gesamtabnahme samt Negativproben bleibt maßgeblich für die noch fehlende Gesamtfreigabe.

## Offene Full-Access-Diskrepanz (K3/K6)

Ungeklärt bleibt, weshalb eine berichtete Full-Access-Oberfläche und unterschiedliche Genehmigungsanforderungen bei Hauptagent und allgemeinen Subagenten zusammen auftreten konnten. Die technische Ursache ist nicht nachgewiesen. Ein separater CLI-Doctor beschreibt nicht automatisch die Rechte einer laufenden App-Sitzung; aktuelle uneingeschränkte Befehle erklären frühere Grenzen ebenfalls nicht. Der Generator erzeugt deshalb kein pauschales `.git`-/`.agents`-/`.codex`-Schreibprofil und ändert keine globale Einstellung.

Geplante Vergleichsprobe: zwei separat konfigurierte, harmlose Elternsessions mit dokumentierter Read-only- beziehungsweise Workspace-Grenze; jeweils dieselbe **explizite Custom-Rolle**, identischer Marker-Lese-/Schreibauftrag in einem Testordner und erfasstes tatsächliches Tool-/MCP-Angebot. Vorher private Connectoren und Secrets aus der Probeumgebung ausschließen. Sandbox-, Genehmigungs- und blockierte Zugriffsresultate mit Laufmetadaten vergleichen. `collaboration.spawn_agent` bietet hier kein `sandbox`-Feld; eine getrennte Kind-Sandbox darf nicht durch erfundene Argumente behauptet werden. Diese Vergleichsprobe ist offen. `approval_policy = "never"` allein erlaubt keine blockierten Aktionen; ein Moduswechsel ist kein Ersatz für die Schutzabnahme.

## Sicherheits- und Hook-Abbildung

Das Setup erzeugt `.codex/hooks.json` und ein geschlossenes Referenzprofil `.codex/geschlossen.config.toml`. Der Host erzeugt für jede Aktion ein frisches temporäres Profil aus derselben Quelle, registriert ausschließlich den lokalen Adapter und prüft nativ `hooks/list`. Nur diese selbst erzeugte Registrierung erhält über `config/value/write` unter `hooks.state.<key>.trusted_hash` Vertrauen; anschließend werden Version, Fehlerliste, aktivierter vertrauenswürdiger Hook und leeres MCP-Inventar erneut geprüft. Fremde Profile und attestierende JSON-Dateien sind kein Host-Eingang.

**Natives Hook-Inventar ist kein Ausführungsnachweis.** Die reale CLI-Probe 0.164.0 mit harmlosem lokalem Responses-Provider zeigte trotz vertrauenswürdig gelistetem Hook einen veränderten Schreibmarker und keinen Hook-Eventmarker: Matcher `.*` sowie `exec_command`, `code_mode_host` aus/ein. Eine freie native Shell bleibt daher gesperrt. Der Einzelaktionshost startet keine Engine-Shell, sondern erzwingt den separaten Guardprozess selbst. Das native Inventar ist eine zusätzliche Vorbedingung, seine beobachtete Wirkungslosigkeit wird damit nicht als Denial ausgegeben.

| Bestehender Schutz / Werkzeugpfad | Tatsächlich unterstützter Eingang und Grenze |
|---|---|
| `SessionStart`: Haupt-Sync, Sandbox-/MCP-Diagnose und Langfuse-Health | manuelle Skripte sind keine automatische Codex-Registrierung |
| `SessionStart` / `SessionEnd`: Langfuse-Abgleich | Claude-Transkripte/Plugin sind kein reproduzierbarer Codex-Exporter |
| `exec_command`: Worktree und Stdin | gemeinsamer Bash-/PowerShell-Worktree-Guard und Stdin-Guard im separaten Hostprozess; explizites absolutes Repo-cwd, `cmd` und bekannte Shell erforderlich; unbekannte Parameter verweigert |
| GitHub | gemeinsamer API-Guard vorhanden; zusätzliche Claude-Settings sind nicht portiert, deshalb gesamter erkennbarer `gh`-CLI-Pfad im Host geschlossen |
| `write_stdin` | kein neues PreToolUse; vollständig entzogen, Host bietet weder Session-ID noch Stdin-Fortsetzung |
| `spawn_agent`, `send_message`, `followup_task` | gemeinsame Lens-Auftrags- und Holdout-Guards fachlich abgebildet; Nachricht bleibt Nachricht, Empfängerrolle wird nicht aus Payload erraten; ohne kontrollierten Executor stoppt der Host jeden dieser Abläufe |
| `apply_patch`, Lens-Edit | ohne vollständige Patch-/Pfad-Erfassung kein Executor; alle Patches abgewiesen, damit auch jeder unerlaubte Lens-Edit |
| direkte Dateiwerkzeuge, schreibende MCPs, `functions.exec` und innere Tools | keine Route im Host; toolarme Engine bietet diese Zugänge nicht an und weist erzwungene Aufrufe technisch zurück; keine Sicherheit für parallele freie App-Sitzungen |
| Abschluss / `Stop` / `SubagentStop` | gemeinsamer Abschlusskern fachlich abgebildet; kein geschützter Agentenlauf mit Abschlussereignis implementiert, deshalb abhängiger Ablauf gesperrt |
| Git-/PR-Gates und Nachweise | bleiben bestehen; ersetzen keinen PreToolUse-Schutz |
| Fremdtext | `fremdtext.mjs` bleibt Autorengate; bereits beschaffte Daten verarbeitet eine getrennte toolarme Elterninstanz ohne MCPs und geerbte Authvariablen; keine Websuche und keine zusätzliche Quellenbeschaffung |

Im Host führen Guard-Wurf, Timeout, ungültiges JSON, unbekannte Entscheidung und jeder Exit ungleich 0 zu **null Executor-Aufrufen**. Nur vollständiges `allow` mit Exit 0 führt exakt eine Kopie der geprüften Aktion aus. Die gemeinsamen Shellparser behalten ihre dokumentierten Grenzen (etwa Programmcode in aufgerufenen Skripten); der Host ist keine Betriebssystem-Sandbox gegen beliebige Shellprogramme. Er schützt seinen eigenen Einstieg, weder beliebige Clients noch globale Konfigurationen.

Auch Agentenregistries sind kein erlaubter Werkzeugpfad: `collaboration.list_agents` kann ungefragt Final-Payloads anderer Phasen ausgeben und damit Holdout-Inhalte an einen Umsetzer liefern. Im geschlossenen Profil fehlen solche Agentenwerkzeuge; der Host verweigert den unbekannten Namen. Eine konventionelle explizit beauftragte Umsetzung in einer freien Frontend-Sitzung belegt deshalb keine technische Holdout-Isolation.

Eine Aktion geht als JSON über stdin an `node scripts/codex-geschuetzt.mjs`:

```json
{"tool_name":"exec_command","cwd":"<absoluter eigener Checkout>","tool_input":{"cmd":"Write-Output HOST_OK","shell":"powershell"}}
```

Nur `bash` und `powershell` sind unterstützte Shellwerte. Der Host liest keine Authdateien; die autorisierte Shellaktion selbst läuft mit der Umgebung des aufrufenden Hosts. Sie ist ausdrücklich kein Fremdtext-Eingang.

Die GitHub-Sperre ist konservativ: Auch `gh` beziehungsweise `gh.exe` als Wort in einem Daten- oder Suchbefehl führt zum Stopp. Dieser kleine unterstützte Befehlssprachumfang ersetzt keine allgemeine Shell-Freigabe.

`node scripts/codex-fremdtext.mjs http://127.0.0.1:<port>/v1` erhält ausschließlich die bereits beschafften Daten über stdin. Eine frische Elterninstanz nutzt eigene HOME-/CODEX_HOME-/AppData-Verzeichnisse, eine explizite Umgebungs-Allowlist, keine Authkopien, keine MCPs und deaktivierte Apps, Plugins, Memories, Shell, Multi-Agenten, Ziele, Bilder, Permissions und Websuche. Bis zu sicherem Hostauth ist ausschließlich ein ausdrücklich eingerichteter lokaler authfreier Provider unterstützt. Die separate Home-Umgebung ist **keine OS-Dateiisolierung**: CLI-Startkontext kann lokale Skillbeschreibungen enthalten. Die Sicherheitsgrenze für modellgesteuerte Zugriffe ist der belegte Toolentzug; OS-Datei- und Netzzugriffe beliebiger Programme werden nicht attestiert.

Die echte Engine-Probe erzwingt Aufrufe über einen harmlosen SSE-Responses-Provider. Inventar: ausschließlich `request_user_input`; Default-Modus verweigert auch dieses Tool. `exec_command`, `apply_patch`, `functions.exec`, ein unbekanntes Tool und ein schreibendes MCP werden als `unsupported call` zurückgewiesen; externe Fixture-Marker bleiben unverändert. Die Textkontrolle liefert `FIXTURE_OK`. Reproduzierbar ohne echte Tokens:

```powershell
$env:CODEX_SCHUTZ_PROBE = (Get-Command codex).Source
npx vitest run test/harness/codex-fremdtext.test.ts
Remove-Item Env:CODEX_SCHUTZ_PROBE
```

Ohne diese Variable überspringt der portable Testsatz nur die echte installierte CLI-Probe. Prozessgrenzen, Payloads, gemeinsame Guards und Executor-Aufrufzahlen werden regulär getestet. Der Testprovider verwendet erfundene Fixture-Verbrauchswerte; sie sind kein echter Modellverbrauch oder Tracing-Beleg.

## Vorprüfung und Nachweisformat

`node scripts/codex-vorpruefung.mjs [--belege <JSON-Datei>]` liest ausschließlich. Exit 2 bedeutet Aufruffehler, Exit 1 den gesperrten Einstieg. Weder Claim noch Umsetzung werden gestartet. Vollständige Offline-Daten heben diese Sperre nicht auf; JSON ist selbst attestierbar und keine signierte Laufzeitattestierung.

Die Datei enthält `version`, `sessionId`, tatsächlich entdeckte `rollen`, erfolgreich aufgerufene MCP-Server in `tools` sowie rohe Langfuse-`observations`. Jede Observation braucht ID, dieselbe Session, Repo-Tag `project:<Repositoryname>` aus der Projektkonfiguration, Typ, Metadaten und für Generations gültigen Verbrauch (`input`, `output`). Identische Wiederholungen einer Observation-ID zählen einmal; widersprüchliche Zeilen derselben ID werden verworfen und diagnostiziert. Haupt-/Unteragenten haben unterschiedliche nichtleere `agent_id`; `parent_thread_id` muss direkt oder transitiv über etwa den Umsetzer zum eindeutigen Hauptagenten führen. Zyklen, unverbundene Ketten und widersprüchliche Eltern-/Rollenidentitäten gelten auch an der Root nicht als Beleg.

Für **jede** erwartete Custom-Rolle ist eine eigene verknüpfte Generation mit Verbrauch nötig. Der Rollenname stammt aus dem echten flachen Metadatum `agent_source.subagent.thread_spawn.agent_role` oder der gleich aufgebauten verschachtelten Struktur; widersprüchliche Formen werden abgelehnt. Ein `rollen`-Inventar, `metadata.agent_role = "subagent"`, eine Generation der Rolle `default` oder ein Spawn-Tool allein beweisen keine Custom-Rolle. Exportfelder werden nicht zum Bestehen erfunden. Unterschiedliche Exporterformate und Reproduzierbarkeit müssen real geprüft werden.

Eine spätere Änderung des sperrenden Einstiegs benötigt zusammen diese überprüfbaren Nachweise:

1. Frisches Gesamtsetup: native Rollen-Discovery und realer Einsatz aller relevanten Custom-Rollen; Rollen-/Modell-/Effort-Laufmetadaten und Quellenbezug stimmen.
2. Echte Playwright-/Langfuse-Aufrufe samt sicherer Authentifizierung; jeweils fehlender Server und fehlende Rolle stoppen den abhängigen Ablauf.
3. Isolierte Rechteprobe, geklärte Eltern-/Kind-Rechte und Hook-Denials einschließlich Fehler-/Timeoutpfaden, direkter Dateiwerkzeuge und Fremdtexte.
4. Vollständiger Export: Hauptagent, alle Rollen und relevante Werkzeuge mit Repo-/Session-/Elternverknüpfung und Verbrauch; Tracing-Ausfall stoppt nachvollziehbar.
5. Abgegrenztes Probe-Ticket gemäß unabhängigem Review und Holdout-Abnahme, einschließlich Negativfällen. Ein Healthcheck allein genügt nicht.

Der beobachtete `private-codex-exporter` 1.1.0 liegt außerhalb des Repositories und wird vom Setup weder installiert noch konfiguriert. Tatsächliche Custom-Rollen sind in den dokumentierten Proben erfasst; kanonische Repo-Zuordnung, Identitäten bei Kontextvererbung und vollständige Werkzeugerfassung sind damit noch nicht belegt. Seine reproduzierbare Bereitstellung und Exportvollständigkeit gehören zu den Tracing- und Gesamtsetup-Arbeiten. Allgemeine Subagent-Generationen allein schließen diese Lücken nicht.

Die Prüfung muss anhand echter Laufdaten erfolgen; die Liste selbst erteilt keine Freigabe. Die Schutz-, Tracing- und Gesamtanforderungen bleiben in den verlinkten Nachfolgern offen. Eine bestandene Teilabnahme des Prototyps ersetzt sie nicht.

## Quellen

Dokumentationsbasis vom 2026-10-27: [Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Hooks](https://learn.chatgpt.com/docs/hooks), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Permissions](https://learn.chatgpt.com/docs/permissions), [App-Server](https://learn.chatgpt.com/docs/app-server), [erweiterte Konfiguration](https://learn.chatgpt.com/docs/config-file/config-advanced) und [Langfuse MCP/Auth](https://langfuse.com/docs/api-and-data-platform/features/mcp-server). OTel gehört in den User-Scope; OTel-Logs sind nicht automatisch Langfuse-Generationen. Produktdokumentation ersetzt keine Harness-Probe.
