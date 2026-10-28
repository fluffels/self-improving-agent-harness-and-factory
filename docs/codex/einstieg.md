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
| `exec_command`: Worktree und Stdin | gemeinsame Guards vor nativem `command/exec`; kanonisches cwd innerhalb der festen Host-Worktreewurzel, starre `workspaceWrite`-Policy, Temp-Ausnahmen ausgeschlossen; unbekannte Parameter verweigert |
| GitHub | gemeinsamer API-Guard vorhanden; zusätzliche Claude-Settings sind nicht portiert, deshalb gesamter erkennbarer `gh`-CLI-Pfad im Host geschlossen |
| `write_stdin` | kein neues PreToolUse; vollständig entzogen, Host bietet weder Session-ID noch Stdin-Fortsetzung |
| `spawn_agent`, `send_message`, `followup_task` | gemeinsame Lens-Auftrags- und Holdout-Guards fachlich abgebildet; Nachricht bleibt Nachricht, Empfängerrolle wird nicht aus Payload erraten; ohne kontrollierten Executor stoppt der Host jeden dieser Abläufe |
| `apply_patch`, Lens-Edit | ohne vollständige Patch-/Pfad-Erfassung kein Executor; alle Patches abgewiesen, damit auch jeder unerlaubte Lens-Edit |
| direkte Dateiwerkzeuge, schreibende MCPs, `functions.exec` und innere Tools | keine Route im Host; toolarme Engine bietet diese Zugänge nicht an und weist erzwungene Aufrufe technisch zurück; keine Sicherheit für parallele freie App-Sitzungen |
| Abschluss / `Stop` / `SubagentStop` | gemeinsamer Abschlusskern fachlich abgebildet; kein geschützter Agentenlauf mit Abschlussereignis implementiert, deshalb abhängiger Ablauf gesperrt |
| Git-/PR-Gates und Nachweise | bleiben bestehen; ersetzen keinen PreToolUse-Schutz |
| Fremdtext | `fremdtext.mjs` bleibt Autorengate; bereits beschaffte Daten verarbeitet eine getrennte toolarme Elterninstanz ohne MCPs und geerbte Authvariablen; keine Websuche und keine zusätzliche Quellenbeschaffung |

Im Host führen Guard-Wurf, Timeout, ungültiges JSON, unbekannte Entscheidung und jeder Exit ungleich 0 zu **null Executor-Aufrufen**. Nur vollständiges `allow` mit Exit 0 erreicht den nativen Sandbox-Executor. Der frühere direkte Shellstart wurde durch `command/exec` ersetzt; `process/spawn` und ein ungeschützter Fallback sind keine Route. Der Executor übernimmt weder eine Policy noch Schreibwurzeln vom Aufrufer. Vor jeder Aktion schreibt ein festes Kontrollprogramm zuerst einen Marker im eigenen Serverprofil und versucht danach den externen Canary zu überschreiben, unter derselben Policy wie die Nutzeraktion. Beide Dateiinhalte und der tatsächliche Denial werden geprüft; stdout allein ist kein Beleg. Das fasst zwei Kontrollen in einem Prozess zusammen, ohne eine Schreibwurzel hinzuzufügen. Eine nicht wirksame Sandbox, Versionsabweichung, fehlerhafte Kontrolle oder ein generischer RPC-Fehler stoppt vor der Nutzeraktion.

Für CLI 0.164.0 unter Windows setzt ausschließlich das temporäre Profil `[windows] sandbox="unelevated"`. Ohne diesen Modus ließ selbst eine explizite `workspaceWrite`-Policy den externen Fixture-Schreibzugriff zu. Die belegte Kombination erlaubt den Innenwrite und verweigert externes `Set-Content`; `excludeSlashTmp=true`, `excludeTmpdirEnvVar=true` und `networkAccess=false` bleiben bei Kontrolle und Aktion gesetzt. Der separate Canary liegt außerhalb von Worktree **und** Serverprofil, da der eigene temporäre Server-cwd ebenfalls als Betriebsverzeichnis beschreibbar sein kann. Es erfolgen keine globale Sandbox-Einrichtung oder OS-Kontenänderungen. Ein fehlendes Backend stoppt; andere Plattformen erhalten keine ungeprüfte Freigabe aus einer Konfigurationsdatei.

Die Schreibgrenze ist keine vollständige Secret-/Leseisolation: 0.164.0 bietet hier kein `readOnlyAccess`/`readableRoots`, und ein externer harmloser Lesemarker war lesbar. Der Host ist deshalb kein Fremdtext-Eingang; dessen separate toolarme Elterninstanz bleibt unverändert. Gemeinsame Git-Metadaten außerhalb des Worktrees erhalten keine Zusatzfreigabe; abhängige Git-Schreibbefehle können deshalb verweigert werden. Der native Windows-Denial kann als spezifischer RPC-Sandboxfehler statt als Exitcode eintreffen. Ein beliebiger RPC-Fehler zählt nicht als bestandene Negativkontrolle. `outputBytesCap` wird wegen der belegten Windows-Inkompatibilität nicht übergeben; der administrative Client behält sein begrenztes Antwortvolumen und seine Prozessfrist. `command/exec` ist ein eigener Erfassungspfad für die Tracing-Abnahme, kein behaupteter nativer Hook-/Modellspan.

Auch Agentenregistries sind kein erlaubter Werkzeugpfad: `collaboration.list_agents` kann ungefragt Final-Payloads anderer Phasen ausgeben und damit Holdout-Inhalte an einen Umsetzer liefern. Im geschlossenen Profil fehlen solche Agentenwerkzeuge; der Host verweigert den unbekannten Namen. Eine konventionelle explizit beauftragte Umsetzung in einer freien Frontend-Sitzung belegt deshalb keine technische Holdout-Isolation.

Eine Aktion geht als JSON über stdin an `node scripts/codex-geschuetzt.mjs`:

```json
{"tool_name":"exec_command","cwd":"<absoluter eigener Checkout>","tool_input":{"cmd":"Write-Output HOST_OK","shell":"powershell"}}
```

Nur `bash` und `powershell` sind unterstützte Shellwerte. Der Host liest keine Authdateien; Server und Shell erhalten die bestehende Umgebungs-Allowlist mit frischen Home-/AppData-Verzeichnissen. Geerbte Auth-, Proxy- und private Konfigurationsvariablen werden nicht übernommen. Die weiterhin mögliche Dateilektüre wird dadurch nicht als Secret-Isolation ausgegeben.

Die GitHub-Sperre ist konservativ: Auch `gh` beziehungsweise `gh.exe` als Wort in einem Daten- oder Suchbefehl führt zum Stopp. Dieser kleine unterstützte Befehlssprachumfang ersetzt keine allgemeine Shell-Freigabe.

`node scripts/codex-fremdtext.mjs http://127.0.0.1:<port>/v1` erhält ausschließlich die bereits beschafften Daten über stdin. Eine frische Elterninstanz nutzt eigene HOME-/CODEX_HOME-/AppData-Verzeichnisse, eine explizite Umgebungs-Allowlist, keine Authkopien, keine MCPs und deaktivierte Apps, Plugins, Memories, Shell, Multi-Agenten, Ziele, Bilder, Permissions und Websuche. Bis zu sicherem Hostauth ist ausschließlich ein ausdrücklich eingerichteter lokaler authfreier Provider unterstützt. Die separate Home-Umgebung ist **keine OS-Dateiisolierung**: CLI-Startkontext kann lokale Skillbeschreibungen enthalten. Die Sicherheitsgrenze für modellgesteuerte Zugriffe ist der belegte Toolentzug; OS-Datei- und Netzzugriffe beliebiger Programme werden nicht attestiert.

Die echte Engine-Probe erzwingt Aufrufe über einen harmlosen SSE-Responses-Provider. Inventar: ausschließlich `request_user_input`; Default-Modus verweigert auch dieses Tool. `exec_command`, `apply_patch`, `functions.exec`, ein unbekanntes Tool und ein schreibendes MCP werden als `unsupported call` zurückgewiesen; externe Fixture-Marker bleiben unverändert. Die Textkontrolle liefert `FIXTURE_OK`. Reproduzierbar ohne echte Tokens:

```powershell
$env:CODEX_SCHUTZ_PROBE = (Get-Command codex).Source
npx vitest run test/harness/codex-fremdtext.test.ts test/harness/codex-geschuetzt.test.ts test/harness/codex-sandbox.test.ts
Remove-Item Env:CODEX_SCHUTZ_PROBE
```

Mit dieser Variable führt die Testkonfiguration Dateien seriell aus: parallele native Sandbox-/Engine-Prozesse können unter Windows die unveränderten Testfristen verbrauchen. Ohne diese Variable überspringt der portable Testsatz nur die echte installierte CLI-Probe und behält Dateiparallelität. Prozessgrenzen, Payloads, gemeinsame Guards und Executor-Aufrufzahlen werden regulär getestet. Der Testprovider verwendet erfundene Fixture-Verbrauchswerte; sie sind kein echter Modellverbrauch oder Tracing-Beleg. Der Inventartransport schließt zuerst stdin, wartet kurz auf reguläres EOF-Ende und erzwingt sonst das Prozessbaumende; vor der Profilentfernung ist das `close`-Ereignis abgewartet.

### Begrenzte Windows-Prozesse

Der generische `prozess()`-Adapter benötigt unter Windows x64 das vorhandene .NET Framework mit `Framework64/v4.0.30319/csc.exe` und Windows PowerShell für die ACL-Prüfung. Beim Modulimport bereitet er innerhalb eines eigenen Zehn-Sekunden-Budgets einen nativen Supervisor vor. Es werden keine Pakete installiert und keine Binärdateien ins Repo geschrieben. Die Prozessfrist beginnt erst am bisherigen Aufruf von `prozess()` und umfasst Requestdatei und Supervisorstart; sie wird nicht neu gestartet. Compiler-, Vorbereitungs- und Validierungsfehler stoppen vor dem Zielstart. Native Testfixtures verwenden dieselbe bereinigte Profilumgebung mit PATH, TEMP/TMP und eigenen Homepfaden wie der unterstützte Laufzeitpfad.

Ein fester benutzerspezifischer Cache unter dem vom Betriebssystem ermittelten LocalApplicationData-Ordner bleibt zwischen Aufrufen erhalten; temporär gesetzte HOME-/LOCALAPPDATA-Werte wählen ihn nicht aus. Der Schlüssel bindet C#-Quelle, Protokollversion, x64, Compileroptionen und Compilerhash. Ein privates Staging wird kompiliert, auf PE/x64 geprüft und mit echter Jobanlage, Limit und Leerabfrage erprobt, bevor Manifest und Artefakt atomar veröffentlicht werden. Ein begrenztes Lock verhindert Teilprodukte bei Parallelimporten. Wiederverwendung prüft Pfad, Dateien, Eigentum, ACL, Quelle, Manifest und Exehash; sie startet die Einsatzprobe nicht erneut. Umleitungen und zusätzliche Zugriffsrechte werden abgelehnt. Cache und Artefakte erlauben ausschließlich der eigenen Benutzeridentität und SYSTEM Vollzugriff. Ein beschädigter Cache wird weder überschrieben noch durch einen direkten Zielstart umgangen. Gleichberechtigte lokale Prozesse können Cache und Manifest gemeinsam verändern; gegen sie versprechen die Hashes keine Herkunftsgarantie.

Der Supervisor erzeugt das Ziel angehalten, ordnet es zwingend einem nicht vererbbaren Job Object ohne Breakaway zu und setzt es erst danach fort. Seine native Deadline läuft unabhängig vom Node-Eventloop. Timeout und Elternende beenden den Job; der normale Abschluss wartet auf `ActiveProcesses=0`, der Node-Adapter zusätzlich auf geschlossene Ausgabeströme. `KILL_ON_JOB_CLOSE` beendet Nachkommen auch bei Supervisorabbruch. Argumente, cwd und explizite Umgebung werden strukturiert übertragen; stdin sowie stdout/stderr bleiben getrennte Datenkanäle. Dienste, WMI oder andere außerhalb der Jobvererbung gestartete Prozesse sind von dieser Prozessbaumgarantie nicht umfasst. Der POSIX-Pfad verwendet weiterhin Prozessgruppen; der Inventartransport besitzt seinen gesonderten EOF-/Cleanup-Pfad.

Die zusätzlichen Windows-Nachweise laufen mit `npx vitest run test/harness/codex-prozess-windows.test.ts test/harness/codex-prozess-cache.test.ts`. Sie ergänzen den obigen unveränderten nativen Drei-Dateien-Lauf.

Die Node-seitige Cache-, Manifest-, PE-, Ausgabe- und Fehlerlogik wird am Originalmodul auch unter Linux getestet; nur Compiler, Windows-ACL-Aufruf und nativer Kindprozess werden dafür ersetzt. Diese Tests attestieren keine Windows-Kernelwirkung. Echte C#-, ACL- und Prozessbaumproben bleiben zusätzliche Windows-Nachweise; für vollständige Läufe mit nativen Prozessen gilt der oben dokumentierte serielle Modus `CODEX_SCHUTZ_PROBE`.

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

## Laufzeit-Verträge

`test/harness/laufzeit-vertraege.test.ts` hält Claude und Codex hermetisch in `verify` zusammen: Skill-Zeiger, Rollenquellen, Hook-Tabelle und die AGENTS.md-Größe gegen das Codex-Standardlimit. PreToolUse teilt sieben Auswertungsmodule mit `codex-hook-lib.mjs`; der Adapter unterstützt den begrenzten Einzelaktionshost und verweigert weitere Werkzeugpfade ohne kontrollierten Executor. Die übrigen Hook-Pfade bleiben ohne Codex-Adapter mit benannter Grenze #84. Ein echter Codex-Lauf ist in CI nicht möglich und gehört zur Gesamtabnahme #86.

## Quellen

Dokumentationsbasis vom 2026-10-27: [Custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Hooks](https://learn.chatgpt.com/docs/hooks), [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [Permissions](https://learn.chatgpt.com/docs/permissions), [App-Server](https://learn.chatgpt.com/docs/app-server), [erweiterte Konfiguration](https://learn.chatgpt.com/docs/config-file/config-advanced) und [Langfuse MCP/Auth](https://langfuse.com/docs/api-and-data-platform/features/mcp-server). OTel gehört in den User-Scope; OTel-Logs sind nicht automatisch Langfuse-Generationen. Produktdokumentation ersetzt keine Harness-Probe.
