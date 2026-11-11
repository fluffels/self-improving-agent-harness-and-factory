/* Werkzeug-Vorprüfung (factory#260 L7): Bewertung und Prüfungen ohne Direktaufruf (Einstiegsskripte importieren nicht voneinander); der Einstieg ist werkzeug-vorpruefung.mjs.
 * Ändert nichts, führt nur die deklarierten Prüfbefehle aus (in der Repo-Wurzel, 10 s Frist). */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { frontmatterBlock } from "./skill-pfade.mjs";
import { ladeProjektConfig, vorpruefungAus } from "./projekt-config-lib.mjs";

/** Kern-Basis der MCP-Server im User-Scope, die nie in `.mcp.json` stehen (docs/model-routing.md nennt sie); die Projekt-Config ergänzt per `vorpruefung.userScopeServer`. */
export const USER_SCOPE_MCP_SERVER = ["langfuse"];
export const BEFEHL_FRIST_MS = 10_000;
export const USAGE = "Aufruf: node scripts/werkzeug-vorpruefung.mjs";

/** Pur: die Server-Namen aus Regeln der Form `mcp__<server>__<tool>` oder `mcp__<server>` (ohne Tool, allow-Form); andere Regeln zählen nicht, jeder Server einmal. */
export function serverAusRegeln(regeln) {
  const namen = regeln.map((r) => /^\s*mcp__([^_\s](?:\S*?[^_\s])??)(?:__\S*)?\s*$/.exec(r)?.[1]).filter(Boolean);
  return [...new Set(namen)];
}

/** Pur: Server aus `regeln`, die nicht in `bekannt` stehen. */
export function unbekannteMcpServer(regeln, bekannt) {
  return serverAusRegeln(regeln).filter((s) => !bekannt.includes(s));
}

/** Pur: die Server-Namen aus den `mcp__<server>[__<tool>]`-Einträgen der `tools:`-Zeile eines Agent-Textes. */
export function serverAusAgent(text) {
  const zeile = /^tools:(.*)$/m.exec(frontmatterBlock(text) ?? "")?.[1] ?? "";
  return serverAusRegeln(zeile.split(","));
}

/** Pur: Mängel für Server, die weder in `.mcp.json` (`projekt`, Liste der Schlüssel) noch im User-Scope stehen. `agenten`: `[{ datei, text }]`. */
export function bewerteMcp({ agenten, bekannt }) {
  const kennt = new Set(bekannt);
  const fehlend = new Map();
  for (const { datei, text } of agenten) {
    for (const s of serverAusAgent(text)) if (!kennt.has(s)) fehlend.set(s, [...(fehlend.get(s) ?? []), datei]);
  }
  return [...fehlend].map(([server, dateien]) => ({
    text: `MCP-Server „${server}“ fehlt: ${dateien.join(", ")} nennt mcp__${server}__-Werkzeuge, aber .mcp.json hat keinen Eintrag „${server}“`,
    fix: `den Server „${server}“ in .mcp.json eintragen (Vorlage: .mcp.json der Factory; ein User-Scope-Server steht in vorpruefung.userScopeServer der Projekt-Config)`,
  }));
}

/** Pur: `[major, minor, patch]` aus `22.23.4`, `v22.23`, `22` (fehlende Teile 0), sonst null. */
export function versionTeile(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(text).trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

const mindestens = (ist, soll) => {
  for (let i = 0; i < 3; i++) if (ist[i] !== soll[i]) return ist[i] > soll[i];
  return true;
};

const GROESSER_GLEICH = /^\s*>=\s*/;

/** Pur: Mangel, wenn die laufende Node-Version unter der Soll-Version liegt. Soll: `.nvmrc` (Text) vor `engines.node` (`>=x.y.z`); beides null: nichts zu prüfen. */
export function bewerteNode({ ist, nvmrc = null, engines = null }) {
  const quelle = nvmrc !== null ? { name: ".nvmrc", roh: nvmrc, soll: versionTeile(nvmrc) }
    : engines !== null ? { name: "engines.node", roh: engines, soll: GROESSER_GLEICH.test(engines) ? versionTeile(engines.replace(GROESSER_GLEICH, "")) : null } : null;
  if (!quelle) return [];
  const istTeile = versionTeile(ist);
  const roh = String(quelle.roh).trim();
  if (!quelle.soll || !istTeile) {
    return [{ text: `Node-Version nicht prüfbar: ${quelle.name} „${roh}“ oder die laufende Version „${ist}“ ist unlesbar`, fix: `${quelle.name} als Version x.y.z schreiben${quelle.name === "engines.node" ? " (mit Präfix >=)" : ""}` }];
  }
  return mindestens(istTeile, quelle.soll) ? [] : [{ text: `Node ${ist} ist älter als ${quelle.name} (${roh})`, fix: `Node auf mindestens ${quelle.soll.join(".")} heben (etwa per nvm)` }];
}

/** Führt einen Befehl mit Frist im Verzeichnis `cwd` (Repo-Wurzel; ohne Angabe das aktuelle) aus: `{ ok, grund }`. Wirft nie. */
export function laufeBefehl(befehl, fristMs = BEFEHL_FRIST_MS, cwd = undefined) {
  const r = spawnSync(befehl[0], befehl.slice(1), { timeout: fristMs, stdio: "ignore", shell: process.platform === "win32", cwd });
  if (r.error?.code === "ETIMEDOUT") return { ok: false, grund: `Timeout nach ${fristMs} ms` };
  if (r.error?.code === "ENOENT") return { ok: false, grund: "Programm nicht gefunden (ENOENT)" };
  if (r.error) return { ok: false, grund: r.error.message };
  if (r.signal) return { ok: false, grund: `Signal ${r.signal}` };
  return r.status === 0 ? { ok: true, grund: "" } : { ok: false, grund: `Exit ${r.status}` };
}

/** Mängel der Projekt-Befehle (`vorpruefung.befehle`); der Runner wird injiziert und läuft in `root`. */
export function bewerteBefehle({ befehle, laufe, root }) {
  return befehle.flatMap(({ name, befehl }) => {
    const r = laufe(befehl, BEFEHL_FRIST_MS, root);
    return r.ok ? [] : [{ text: `Werkzeug „${name}“ nicht bereit: ${befehl.join(" ")} → ${r.grund}`, fix: `„${name}“ installieren oder starten, dann ${befehl.join(" ")} prüfen` }];
  });
}

const lesen = (root, pfad, lies) => {
  try { return lies(join(root, pfad)); } catch { return null; }
};

function agentenTexte(root, lies, liste) {
  let namen = [];
  try { namen = liste(join(root, ".claude", "agents")).filter((n) => n.endsWith(".md")).sort(); } catch { /* kein Agentenordner: nichts zu prüfen */ }
  return namen.map((n) => ({ datei: `.claude/agents/${n}`, text: lesen(root, `.claude/agents/${n}`, lies) ?? "" }));
}

function mcpServerSchluessel(root, lies, maengel) {
  const roh = lesen(root, ".mcp.json", lies);
  if (roh === null) return [];
  try { return Object.keys(JSON.parse(roh)?.mcpServers ?? {}); } catch {
    maengel.push({ text: ".mcp.json ist kein gültiges JSON", fix: ".mcp.json reparieren (JSON mit Schlüssel mcpServers)" });
    return [];
  }
}

function enginesNode(root, lies) {
  const roh = lesen(root, "package.json", lies);
  if (roh === null) return null;
  try { return JSON.parse(roh)?.engines?.node ?? null; } catch { return "unlesbar"; }
}

/** Alle Prüfungen gegen `root`; gibt `[{ text, fix }]` zurück. Wirft nie. */
export function pruefeWerkzeuge({ root, lies = (p) => readFileSync(p, "utf8"), liste = (p) => readdirSync(p), ist = process.versions.node, config, laufe = laufeBefehl }) {
  const maengel = [];
  const projekt = mcpServerSchluessel(root, lies, maengel);
  maengel.push(...bewerteNode({ ist, nvmrc: lesen(root, ".nvmrc", lies), engines: enginesNode(root, lies) }));
  const { vorpruefung, mangel } = vorpruefungMitMangel(config);
  maengel.push(...mangel, ...bewerteBefehle({ befehle: vorpruefung.befehle, laufe, root }));
  maengel.push(...bewerteMcp({ agenten: agentenTexte(root, lies, liste), bekannt: bekannteMcpServer(projekt, config) }));
  return maengel;
}

/** Die Vorprüfung der Projekt-Config; eine ungültige Form ergibt eine leere Vorprüfung und genau einen Mangel (`mangel`, Liste). */
export function vorpruefungMitMangel(config) {
  try {
    return { vorpruefung: vorpruefungAus(config), mangel: [] };
  } catch (e) {
    const [text, fix] = String(e.message).split("\nFix: ");
    return { vorpruefung: { befehle: [], userScopeServer: [] }, mangel: [{ text, fix: fix ?? "den Block vorpruefung der Projekt-Config korrigieren" }] };
  }
}

/** Alle bekannten MCP-Server: Projekt (`.mcp.json`), Kern-User-Scope und `vorpruefung.userScopeServer` der Config (ungültig: nur die ersten beiden). */
export function bekannteMcpServer(projekt, config) {
  return [...projekt, ...USER_SCOPE_MCP_SERVER, ...vorpruefungMitMangel(config).vorpruefung.userScopeServer];
}

/** Wie `pruefeWerkzeuge` mit geladener Projekt-Config (nur der Block `vorpruefung` zählt); ist sie nicht lesbar, ist das ein Mangel. */
export function werkzeugMaengel({ root = fileURLToPath(new URL("../", import.meta.url)), lade = () => ladeProjektConfig({ rootDir: root }), ...rest } = {}) {
  let config;
  try { config = lade(); } catch (e) {
    return [{ text: `Projekt-Config nicht lesbar: ${String(e.message).split("\n")[0]}`, fix: "die Projekt-Config reparieren (der Fehlertext von ladeProjektConfig nennt den Block)" }, ...pruefeWerkzeuge({ root, config: {}, ...rest })];
  }
  return pruefeWerkzeuge({ root, config, ...rest });
}
