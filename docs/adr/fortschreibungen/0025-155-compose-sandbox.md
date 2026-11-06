# Fortschreibung #155 (2026-11-06): Compose-Sandbox mit Egress-Proxy

Ergänzt [ADR 0025](../0025-sandbox-als-austauschbare-laufumgebung.md) um die Probe einer Compose-Sandbox mit Egress-Proxy (ein Stack je Bezieher) gegen den Sandbox-Vertrag V0 bis V3; die Fortschreibung steht als Datei (siehe [Fortschreibung zu ADR 0013](0013-1860-fortschreibungen-als-dateien.md)). Herkunft: factory#139, Sandbox-Reihe factory#67.

## Ausgangslage

Der ADR führt die „Eigene Container-Sandbox“ ohne Probe-Belege (`unbelegt`, „Sache des Projekts“). Eine Compose-Sandbox mit Egress-Proxy ist eine Ausprägung davon (Soll-Merkmal `AGENT_SANDBOX=container`, V6). Geprüft wurden V0 bis V3; V4 bis V7 und der Ticket-Ablauf bleiben bei factory#67.

## Nachweise (bereinigt, 2026-11-06)

Stand im Container: Commit e5aeb29. Die Proben liefen im laufenden Stack, die Rohausgabe steht nicht im Repo; Namen von Stack, Registry, Hosts, Mounts und Pfaden sind bewusst weggelassen.

- **Umgebung:** Linux-Kernel 5.15 (WSL2-Kernel), Marker `/.dockerenv` vorhanden. `AGENT_SANDBOX` ist im Container nicht gesetzt.
- **`sandbox-doctor --check`** (Exit 0, ein `--streng` gibt es noch nicht): OK „Plattform WSL2 unterstützt die Sandbox“, OK „User-Settings: keine Secrets im env-Block“; FEHLT bei bwrap, socat, drei wsl.conf-Einträgen (automount, interop, appendWindowsPath), „User-Settings: kein sandbox-Block“ und der Verhaltensprobe „Schreiben ins Home gelang, die Sandbox greift hier nicht“.
- **V0:** der Agent-Prozess läuft im Container, eine Instanz sichtbar; die Grenze ist der Container (Marker, eigenes Dateisystem).
- **V1:** die Schreibprobe im Workspace gelang (gewollt, rw); `/mnt/c`, `/c`, `/host` sind nicht sichtbar. Zusätzlich gemountet: ein schreibbares Brain-Verzeichnis, Caches, das schreibbare Home des Agenten und mehrere schreibgeschützte Konfigurations-Mounts (Egress-CA, verwaltete Settings, Skill-Quellen, SSH-Material, Registry-Konfiguration, `CLAUDE.md`). Der Workspace-Mount stammt aus einem Windows-Laufwerks-Mount; welcher Host-Ordner gebunden ist, zeigt die Mount-Liste nicht.
- **V2:** `api.github.com` und `registry.npmjs.org` antworten mit HTTP 200; `example.com` scheitert (Verbindung abgewiesen); `host.docker.internal` wird vom Proxy mit HTTP 403 verweigert. Der Langfuse-Endpunkt ist erreichbar (HTTP 200, Beobachtung zu V5).
- **V3:** im Container-ENV stehen die Namen `GH_TOKEN` und `LANGFUSE_SECRET_KEY` (Werte nicht gelesen, nicht gedruckt). Klartext-Treffer auf `ghp_`, `gho_`, `github_pat_`, `sk-ant-`, `sk-lf-`: 0. `~/.config/gh/hosts.yml` und `~/.git-credentials` sind nicht lesbar.
- **Betriebsbeobachtung (keine Vertragszeile):** der Stack war drei Tage aus und mit leerem Passwort nicht startbar.

## Vergleichstabelle

Klassen wie in [ADR 0025 › Fortschreibung #1827](../0025-sandbox-als-austauschbare-laufumgebung.md#beleg-klassen-und-quellen): `ja (Probe)`, `ja (Doku/Konfiguration)`, `nein`, `unbelegt`; dazu hier `Lücke → factory#<nr>` für eine Probe, die einen Vertragspunkt nicht erfüllt oder nicht belegt, obwohl der Vertrag Belege verlangt.

| Variante | V0 | V1 | V2 | V3 | Quelle |
|---|---|---|---|---|---|
| WSL2 + Claude-Code-Sandbox | ja (Doku/Konfiguration), nur Shell-Befehle | Konfiguration belegt, Probe offen bis factory#43 | Konfiguration belegt, Probe offen | Maskierung, Probe offen | ADR 0025 › #1827 |
| Docker Sandboxes (`sbx`) | ja (Doku) | ja (Doku) | ja (Doku) | ja (Doku) für unterstützte Anbieter; Langfuse unbelegt | ADR 0025 › #1827 |
| Eigene Container-Sandbox (allgemein) | unbelegt | unbelegt | Domain-Proxy nötig | Secret-Store des Projekts | ADR 0025 › #1827 |
| Cloud-Sitzung | ja (Doku) | ja (Doku) | Konfiguration belegt, Probe offen | erfüllbar; Langfuse unbelegt | ADR 0025 › #1827 |
| **Compose-Sandbox mit Egress-Proxy** | ja (Probe); Merkmal V6 nicht gesetzt (Lücke → factory#227) | ja (Probe) für den Workspace; Host-Sichtbarkeit jenseits davon unbelegt, gebundener Host-Ordner unbelegt (Lücke → factory#227) | ja (Probe) | Lücke → factory#227 | diese Fortschreibung |

## Einordnung

- **Variante:** Ausprägung der „Eigenen Container-Sandbox“ (Soll-Merkmal `AGENT_SANDBOX=container`, im Stack noch nicht gesetzt); es entsteht keine neue Variantenspalte im ADR.
- **V3 gegen den Vertragstext:** V3 verlangt „kein Token im Klartext in der Sandbox (nicht in Umgebungsvariablen …)“, erlaubt sind nur Proxy-Injection oder Maskierung. Die Namen `GH_TOKEN` und `LANGFUSE_SECRET_KEY` im Agenten-ENV erfüllen das nicht belegt: die Werte sind nicht geprüft, und null Treffer auf bekannte Präfixe schließen Klartext nicht aus (ein Schlüssel ohne bekanntes Präfix fiele durch). Der dokumentierte Prüfweg für `--streng` (Präfix-Scan, Token-Dateien nicht lesbar) wäre nach diesen Nachweisen grün; die Fortschreibung urteilt strenger nach dem Anforderungstext, weil dort Platzhalter oder Maskierung verlangt sind und belegt sein müssen. Ein Lauf im Container kann den Langfuse-Secret-Key aus seiner Umgebung lesen, falls der Wert Klartext ist, was `AGENTS.md` › „Kein Secret-Key im Agentenlauf“ ausschließen will. Zusatz-Mounts (schreibbares Home und Brain-Verzeichnis, schreibgeschütztes SSH-Material) sind gegen V1 und V3 nicht bewertet. Nach der binären Regel aus [ADR 0025 › Nicht gesandboxt](../0025-sandbox-als-austauschbare-laufumgebung.md#nicht-gesandboxt) gilt die Compose-Sandbox damit als **nicht gesandboxt, bis factory#227 geschlossen ist**.
- **V6:** der Vertrag verlangt `AGENT_SANDBOX=container` im Image-ENV; der Stack setzt es nicht. Das ist eine Lücke auf Stack-Seite (V6, factory#227), unabhängig davon, dass der Doktor die Variable noch nicht auswertet (factory#44); auch sie hält die Variante auf „nicht gesandboxt“.
- **Empfehlung:** nicht empfohlen bis Probe des Ticket-Ablaufs (factory#67) und bis die Lücken geschlossen sind. Standardweg WSL2 und Rückfallweg `sbx` bleiben unverändert; ein Wechsel braucht ein neues ADR.
- **Lesart von `sandbox-doctor --check`:** die Zeilen zu bwrap, socat, wsl.conf, User-Settings (sandbox-Block) und der Home-Schreibprobe sind WSL2-Merkmale. Laut ADR 0025 › Konsequenzen sind es berichtende Variantenprüfungen, kein Verstoß des Containers gegen V0 bis V3; der Doktor nennt die Variante nicht und erkennt `AGENT_SANDBOX` nicht.

## Abweichung: persönliche Skills mit Präfix

In der Compose-Sandbox heißen die persönlichen Skills des Agenten `personal-<name>` (etwa `personal-brain-input`); daneben gibt es Projektskills mit anderem Präfix und einen Ordner `synced`. Der Abschluss-Skill aus `skills.abschluss` (`brain-input`) existiert dort unpräfixiert nicht, `node scripts/projekt-config.mjs abschluss` liefert aber weiter diesen Namen; `Skill({ skill: "brain-input" })` läuft im Container ins Leere. Abhilfe: `FACTORY_ABSCHLUSS_SKILL=<präfixierter Name>` im Container-ENV (factory#139, Wert `aus` schaltet den Abschluss-Skill ab); `projekt-config.mjs abschluss` zeigt danach den wirksamen Namen. Das ist eine Abweichung der Variante, keine Vertragszeile, und steht in [Sandbox anbinden](../../sandbox-anbinden.md#eigene-container-sandbox-anbinden).

## Lücken und Folgetickets

| Lücke | Vertrag | Folgeticket |
|---|---|---|
| Stack setzt `AGENT_SANDBOX` nicht (Image-ENV) | V6 | factory#227 |
| Der Doktor wertet `AGENT_SANDBOX` nicht aus und meldet im Container WSL2-Merkmale als FEHLT, ohne die Variante zu nennen; es gibt noch kein `--streng` | V0, V6 | factory#44 (Kommentar) |
| Namen `GH_TOKEN` und `LANGFUSE_SECRET_KEY` im Agenten-ENV, Werte nicht belegt als Platzhalter | V3 | factory#227 |
| Gebundener Host-Ordner des Workspace, Sichtbarkeit jenseits davon und Zusatz-Mounts (schreibbar, SSH-Material) gegen V1/V3 unbelegt | V1, V3 | factory#227 |
| V4 bis V7 und Ticket-Ablauf (Worktree, `verify`, `gh pr`) nicht geprobt | V4 bis V7 | factory#67 (Kommentar) |

## Neu entscheiden, wenn

factory#227 geschlossen ist (dann wechseln V3, V1 und V6 der Compose-Zeile, ein Ja macht die Variante erst mit factory#67 empfehlbar); `sandbox-doctor` die Variante `container` erkennt (factory#44); factory#67 den Ticket-Ablauf geprobt hat; der Stack seinen ENV-Aufbau oder den Workspace-Mount ändert.
