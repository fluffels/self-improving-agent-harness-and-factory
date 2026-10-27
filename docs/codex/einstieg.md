# Codex im Harness

Der Codex-Adapter ist ein **Einrichtungs- und Review-Prototyp** für die lokale Codex CLI 0.164.0. Die Freigabe autonomer Ticketläufe fehlt. Der Einstieg aus [AGENTS.md](../../AGENTS.md) endet deshalb auch bei vollständig aussehenden Offline-Belegen mit Exit 1. Ein ausdrücklich beauftragter Implementierungs-PR wie #79 ist keine bestandene Ende-zu-Ende-Abnahme dieses Adapters.

## Gemeinsame Quellen und native Rollen

`AGENTS.md` bleibt die Regelquelle, `.agents/skills/` die Skillquelle. Codex benötigt keine Kopien der Claude-Skillzeiger. `scripts/codex-setup.mjs` erzeugt native `.codex/agents/*.toml` mit `name`, `description`, `developer_instructions` und Effort. Fachliche Quellen bleiben `.claude/agents/*.md`; deren Frontmatter und Claude-API-Beispiele sind keine Codex-Konfiguration:

| Phase | Codex-Rolle / Aufruf in dieser Sitzung | Gemeinsame Quelle |
|---|---|---|
| Planung | Name aus `agenten.planer`, `collaboration.spawn_agent` | `factory-planer.md` |
| Umsetzung / Gruppen | `agenten.umsetzer` / `agenten.gruppe` | `factory-umsetzer.md` / `factory-gruppe.md` |
| Architektur, Requirements, Tests | je eigener Auftrag an `agenten.lens` | `factory-lens.md`, Skill `review-lenses` |
| Exploration | `explore` | `explore.md` |
| Szenarien / Abnahme | `holdout-szenario` / `holdout-abnahme` | gleichnamige Dateien |
| Rückmeldung / Fortsetzung | `collaboration.send_message` / `followup_task` | gemeinsamer Ticketablauf |
| Quarantäne | **keine freigegebene Rolle** | Sicherheitsregeln in `AGENTS.md` |

Eine generierte Rolle ist erst nach erneutem Laden und tatsächlicher Discovery nutzbar. Die angebotenen Rollen können davon abweichen; ein Fallback auf `default` ist keine Probe der Custom-Agent-Datei. Planung und Lenses erhalten `high`, Umsetzung und Explore `medium`; das Modell wird von der Elternsession geerbt. Der Probebericht nennt den tatsächlich aufgelösten Modellnamen. Claude-Aliase haben keine belegte Codex-Entsprechung; dies ist keine Kosten- oder Qualitätsäquivalenz zur Claude-Phasenmatrix.

## Reproduzierbares Setup

Voraussetzungen: Repository samt Projektkonfiguration, Node gemäß `package.json`, installierte Codex CLI und ein erreichbarer **Streamable-HTTP-MCP-Dienst für Langfuse**. Seine URL ist keine Langfuse-Weboberfläche oder Public-API-URL. Der Adapter installiert oder hostet diesen Dienst nicht. Die konkrete Bereitstellung und das frische Gesamtsetup bleiben Teil der offenen Abnahme.

```powershell
npm.cmd ci
node scripts/codex-setup.mjs --langfuse-url https://mcp.example.test/langfuse
node scripts/codex-setup.mjs --langfuse-url https://mcp.example.test/langfuse --write
```

Die Beispieladresse ersetzen. Ohne `--write` werden nur geplante Pfade ausgegeben. Identische Dateien bleiben unverändert; ein abweichender lokaler Entwurf stoppt das ganze Setup vor dem ersten Schreibvorgang. Es gibt keinen Force-Modus. Vor manueller Zusammenführung den Entwurf separat prüfen. Setup folgt keinen Symlinks; parallele Änderungen während der Generierung sind keine unterstützte Transaktion.

Playwright-Befehl und Argumente kommen aus `.mcp.json`, nicht aus einer zweiten Versionsliste. Langfuse erhält eine Lese-Toolliste. Beide Server stehen auf `required = true`. Zugangsdaten kommen zur Laufzeit über `LANGFUSE_MCP_TOKEN` aus der Umgebung; der Generator liest keine Tokenwerte, Langfuse-Secret-Dateien oder privaten User-Settings. Ein Dienst mit anderem Auth-Verfahren ist noch nicht praktisch geprüft. Generierte Konfiguration bleibt lokal und ignoriert. In einem Konsumenten kommen die Generatoren über `.factory/besitz.json`; ein Sync in ein anderes Repository ist kein Setup-Schritt.

Anschließend in einer **neuen, vertrauenswürdig eingerichteten Codex-Sitzung** die Config mit `codex --strict-config doctor --summary` prüfen, Rollenangebot und echte MCP-Toolaufrufe erfassen. `codex mcp list` oder Doctor allein belegen keine nutzbaren Verbindungen. In einer bereits laufenden Sitzung fehlen unter Umständen weiterhin Playwright oder neu erzeugte Rollen. Die CLI-Diagnose eines separaten Prozesses belegt nicht die Berechtigungen einer laufenden App-Sitzung.

## Berechtigungen ohne ständige Unterbrechungen

Claude-`permissions.allow` wird von Codex nicht übernommen. `:workspace` hält unter anderem `.git`, `.agents` und `.codex` schreibgeschützt; eingeschränktes Netzwerk erzeugt zusätzliche Eskalationen für GitHub und Paketinstallation. Das kann Routine-Rückfragen trotz beauftragter Ticketarbeit erklären. Der angezeigte UI-Modus einer laufenden Sitzung wird vom Adapter nicht festgestellt.

Der Generator liefert einen **inaktiven** User-Scope-Baustein `.codex/berechtigungen.toml.example`: Profil `harness`, abgeleitet von `:workspace`, gezielte Schreibrechte auf diese drei Metadatenpfade und Netzwerkziele für GitHub/npm. Zur späteren Einrichtung gehören im User-Scope zusätzlich `default_permissions = "harness"` und `[features] network_proxy = true`. Domainregeln begrenzen Verkehr nur mit aktivem Proxy; zusätzliche Paketziele und Zugriff auf einen lokalen MCP-Dienst sind in einer echten Probe zu prüfen. Rechte für `.aws` werden nicht erweitert. Breite Shell-, `node`- oder `git`-Freigaben sind nicht Teil des Templates.

Ein Repo-Template stellt eine laufende Sitzung nicht nachträglich um. **Approve for me** kann geeignete Genehmigungsanfragen automatisch prüfen; es hebt die Sandbox nicht auf. `approval_policy = "never"` allein lässt blockierte Befehle scheitern. Weder diese Einstellung noch pauschaler Vollzugriff ersetzen die fehlende Schutzabnahme. Der Adapter schreibt keine globale Konfiguration und aktiviert kein Permission-Profil automatisch.

## Sicherheits- und Hook-Abbildung

Codex unterstützt Hooks. Die folgenden bestehenden Registrierungen sind trotzdem **nicht portiert oder als wirksam nachgewiesen**. Der Prototyp registriert keine Claude-Hookdatei unter einem anderen Namen.

| Claude-Registrierung / Funktion | Codex-Stand und verbleibende Grenze |
|---|---|
| `SessionStart`: `haupt-sync`, Sandbox-Diagnose, MCP-Ausfall, Langfuse-Health | Skripte manuell nutzbar; keine automatische Codex-Registrierung oder MCP-Discovery belegt |
| `SessionStart` / `SessionEnd`: Langfuse-Abgleich | Claude-Transkripte und Plugin sind kein Codex-Exporter; keine automatische Nachlieferung zugesagt |
| `PreToolUse`: Worktree-, GitHub- und Stdin-Skript-Guard | Codex-Payload und Toolabdeckung separat zu prüfen; Lesen der Skripte schafft keinen technischen Schutz |
| `Agent` / `SendMessage`: Lens-Auftrag und Holdout-Trennung | getrennte Rollen/Prompts möglich; keine technische Verhinderung falsch adressierter Szenarien belegt |
| `SubagentHandback`: Umsetzer-Abschluss | keine belegte Entsprechung des Claude-Ereignisses |
| `Stop` / `SubagentStop`: Commit-/Worktree-Prüfung | manuelle Endkontrolle möglich; automatische Erzwingung fehlt |
| Git-/PR-Gates, Review-/Abnahme-Nachweise | dieselben Skripte und serverseitigen Required-Checks; kein Ersatz für PreToolUse-Schutz |
| Fremdtext | `fremdtext.mjs` verweigert unvertraute Autoren/Forum-Tickets; allgemeine Subagenten mit geerbter Shell/MCP sind keine Quarantäne |

Hook-Fehler und Timeouts können ohne Werkzeugblockade enden. `exec_command`, `spawn_agent` und `apply_patch` haben dokumentierte Matcher-Aliase, aber etwa `write_stdin` erzeugt kein neues `PreToolUse`; gehostete Websuche ist nicht überall erfasst. Die Sicherheitsprobe muss die tatsächlich angebotenen Werkzeuge und Nebenwirkungen testen, einschließlich direkter Dateiwerkzeuge, privater Connectoren und schreibender MCPs. Eine Prompt-Anweisung „nur lesen“ ist keine separate Sandbox.

## Vorprüfung und Nachweisformat

`node scripts/codex-vorpruefung.mjs [--belege <JSON-Datei>]` liest ausschließlich. Exit 2 bedeutet Aufruffehler, Exit 1 einen gesperrten Einstieg. Es startet weder Claim noch Umsetzung. Die Belegdiagnose prüft Version, Rollen-/MCP-Inventar und Roh-Observations; **auch eine vollständige Datei schaltet keinen autonomen Lauf frei**. Offline-Dateien könnten manipuliert sein und sind keine signierte Laufzeitattestierung.

Belegdatei im temporären Ordner: `version` aus `codex --version` ohne Präfix, `sessionId` des Probe-Laufs, `rollen` als Liste tatsächlich entdeckter Namen, `tools` als Liste erfolgreich aufgerufener Server (`playwright`, `langfuse`), `observations` als Array aus dem Langfuse-MCP-Export. Die Diagnose erwartet `id`, dieselbe `sessionId`, `type`, `tags`, `metadata` und `usageDetails`; Repo-Tag ist `project:<Repositoryname>` aus `.factory/projekt.json`. Haupt-/Sub-Generationen benötigen `agent_role`, unterschiedliche `agent_id`, verknüpfte `parent_thread_id` und Verbrauch (`input`, `output`). Ein sichtbarer Spawn-Werkzeugaufruf allein genügt nicht. Die konkrete Exporter-Abbildung ist zu prüfen, nicht durch erfundene Metadaten zu ergänzen.

Noch erforderlich: frisches Gesamtsetup, tatsächlich nutzbare Custom-Rollen und MCPs, Negativproben ihrer Ausfälle, isolierte Quarantäneprobe, Hook-Denials samt Fehlerpfaden sowie ein abgegrenztes Probe-Ticket mit unabhängigem Review und Holdout-Abnahme. Langfuse muss dabei Hauptagent, Subagenten und Tools samt Verbrauch und richtiger Repo-Zuordnung zeigen. Erst diese Belege können eine Änderung der sperrenden Vorprüfung rechtfertigen. Der Healthcheck ist nur Erreichbarkeit.

## Offizielle Quellen

Dokumentationsbasis (Stand 2026-10-27): [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Hooks](https://learn.chatgpt.com/docs/hooks), [MCP](https://learn.chatgpt.com/docs/extend/mcp), [Permissions](https://learn.chatgpt.com/docs/permissions), [Permission modes](https://learn.chatgpt.com/docs/permission-modes) und [erweiterte Konfiguration](https://learn.chatgpt.com/docs/config-file/config-advanced). OTel gehört in den User-Scope; projektlokale OTel-Einträge werden ignoriert. OTel-Logs sind nicht automatisch Langfuse-Generationen. Die Quellen beschreiben Produktfähigkeiten, keine bestandene Probe dieses Harness.
