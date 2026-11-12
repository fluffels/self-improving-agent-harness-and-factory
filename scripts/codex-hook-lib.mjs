// Kein Einstieg, kein Direktaufruf (Konvention quellprojekt#1398): Lib des Einstiegs `scripts/codex-hook.mjs`; wird von ihm, von codex-lib.mjs (Registrierung) und von
// test/harness/codex-hook.test.ts importiert. Payload-Format und Grenzen: docs/codex/einstieg.md § Codex-Hook-Schnittstelle.
/**
 * Codex-Hook-Adapter (factory#364): übersetzt Codex-Werkzeugaufrufe (`exec_command`/Shell, `apply_patch`, `spawn_agent`) in die Claude-Form und fragt den
 * bestehenden Dispatcher (`dispatch` in `scripts/pretooluse-dispatch.mjs`, Einstieg `scripts/pretooluse-hook.mjs`); die Guard-Logik wird nicht kopiert.
 *
 *  - Shell:       Worktree-, gh- und Stdin-Skript-Guard über den Dispatcher (Werkzeug `Bash`), danach die `Bash(...)`-Regeln aus `permissions.deny`/`permissions.ask`
 *                 der `.claude/settings.json` je Befehlssegment (Claude wendet sie selbst an, Codex nicht: `gh issue delete`, `git push --force` …)
 *  - apply_patch: jedes Schreibziel des Patches als Claude-`Write` an den Schreibziel-Guard des Dispatchers (kein Schreiben in den Haupt-Checkout oder nach `.git`); Selbstschutz für `.codex`
 *  - spawn_agent: zuerst der Tracing-Ausfallstopp (Langfuse-Health, `scripts/langfuse-health.mjs`; Ausfall ergibt Deny, kein Spawn, factory#365), dann Lens-Auftrag- und
 *                 Holdout-Guard über den Dispatcher (Werkzeug `Agent`); Codex bleibt immer bei Arm A der A/B-Messung
 * Fail-closed für diese drei Werkzeuge: unlesbares Payload, unbekanntes Feldformat, werfender oder nicht ladbarer Guard ergibt ein Deny mit Grund; ein `ask` des Dispatchers wird ein Deny,
 * weil Codex keine Rückfrage kennt. Andere Werkzeugnamen bleiben unberührt (keine Ausgabe).
 *
 * Bekannte Grenzen (Details und Quellen in docs/codex/einstieg.md): `write_stdin`, direkte Dateiwerkzeuge außer `apply_patch`, MCP und `send_message`/`followup_task` lösen keinen
 * geprüften Pfad aus; ein `-c`-Argument aus gemischten Quotes (`bash -c "curl x"'y'`) zerlegt die `Bash(...)`-Regelprüfung nicht (nur ein vollständig gequotetes Argument wird entquotet); Hook-Fehler und Timeout sind beim Host fail-open; die Wirkung im echten Codex-Lauf belegt factory#367.
 *
 * Reines Node-Skript (nur Builtins); der Dispatcher wird dynamisch geladen, damit ein Ladefehler ein Deny statt eines Prozessabbruchs (fail-open beim Host) ergibt.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { MAX_INTERPRETER, buildDenyOutput } from "./hook-io.mjs";

/** Werkzeugname im Codex-Payload → Art der Übersetzung. `Bash` ist der dokumentierte `tool_name` der Shell (auch für `exec_command`); `spawn_agent` passt laut Doku auch auf den Matcher `Agent`. */
export const CODEX_HOOK_WERKZEUGE = { Bash: "shell", exec_command: "shell", apply_patch: "patch", spawn_agent: "agent", Agent: "agent" };
/** Fester Timeout der Registrierung in Sekunden (der Host behandelt Timeout fail-open: knapp genug zum Messwert, weit unter dem Standard von 600). */
export const CODEX_HOOK_TIMEOUT_S = 30;

const q = (grund) => buildDenyOutput(`Codex-Hook (fail-closed): ${grund}`);
const istText = (v) => typeof v === "string" && v !== "";

/** Lädt Dispatcher und Segmentierer erst bei Bedarf; ein Ladefehler wird zum Deny des Aufrufers. */
const ladeStandard = async () => ({
  dispatch: (await import("./pretooluse-dispatch.mjs")).dispatch,
  segmente: (await import("./gh-guard-hook.mjs")).segmente,
});

/** Schreibziele eines `apply_patch`-Textes (Begin/End-Rahmen, `Add|Update|Delete File`, `Move to`); `null` bei unbekannter Form (fail-closed). */
export function patchZiele(patch) {
  if (typeof patch !== "string") return null;
  const zeilen = patch.replace(/\r\n/g, "\n").split("\n");
  if (zeilen[0] !== "*** Begin Patch" || !zeilen.includes("*** End Patch")) return null;
  const ziele = [];
  for (const z of zeilen) {
    if (!z.startsWith("*** ")) continue;
    const m = /^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/.exec(z);
    if (m) ziele.push(m[2].trim());
    else if (z !== "*** Begin Patch" && z !== "*** End Patch" && z !== "*** End of File") return null;
  }
  return ziele.length > 0 && ziele.every((p) => p !== "") ? ziele : null;
}

/** Muster einer `Bash(...)`-Regel gegen ein Segment: `<präfix>:*` als Präfix mit Wortgrenze, sonst Glob (`*` steht für beliebigen Text, alles andere wörtlich). */
function musterTrifft(muster, seg) {
  if (muster.endsWith(":*")) {
    const praefix = muster.slice(0, -2);
    return seg === praefix || seg.startsWith(`${praefix} `);
  }
  return new RegExp(`^${muster.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`, "s").test(seg);
}

const ZUWEISUNG = /^[A-Za-z_][A-Za-z0-9_]*=/;
const WRAPPER = new Set(["command", "exec", "nohup", "time"]);
const INTERPRETER = new Set(["bash", "sh", "zsh", "dash"]);
const SHELL_FLAGS = new Set(["-c", "-lc"]);

/** Wörter eines Segments, getrennt an Leerraum außerhalb von Quotes (Quotes bleiben im Wort). */
const woerter = (seg) => seg.match(/(?:'[^']*'|"(?:\\.|[^"\\])*"|\S)+/g) ?? [];

/** Basisname eines Programmworts: Verzeichnis (auch Windows-Backslash) und `.exe` fallen weg. */
const basisname = (wort) => wort.replace(/\\/g, "/").split("/").pop().replace(/\.exe$/i, "");

/** Streift Zuweisungen, `env` (mit `-i`, `-u <n>`, `--`, Zuweisungen), `command`, `exec`, `nohup`, `time` vorn ab. */
function ohneWrapper(w) {
  let t = w;
  for (;;) {
    const kopf = t[0] ?? "";
    const basis = basisname(kopf);
    if (ZUWEISUNG.test(kopf) || WRAPPER.has(basis)) t = t.slice(1);
    else if (basis === "env") t = envOptionen(t.slice(1));
    else return t;
  }
}

function envOptionen(w) {
  let t = w;
  for (;;) {
    if (t[0] === "-i" || t[0] === "--") t = t.slice(1);
    else if (t[0] === "-u") t = t.slice(2);
    else return t;
  }
}

/** Der Inhalt eines vollständig gequoteten Worts (`'…'` wörtlich, `"…"` mit `\"` und `\\`), sonst `null`. */
function entquote(wort) {
  const einfach = /^'([^']*)'$/.exec(wort);
  if (einfach) return einfach[1];
  const doppelt = /^"((?:\\["\\]|[^"\\])*)"$/.exec(wort);
  return doppelt ? doppelt[1].replace(/\\(["\\])/g, "$1") : null;
}

/** Der Befehlstext hinter `bash|sh|zsh|dash -c|-lc "<ein Argument>"`, sonst `null`. */
function interpreterText(w) {
  const [shell, flag, arg] = w;
  return w.length === 3 && INTERPRETER.has(shell) && SHELL_FLAGS.has(flag) ? entquote(arg) : null;
}

/** Das Originalsegment plus normalisierte Formen (Leerraum zusammengezogen, Wrapper und Pfad abgestreift, `sh -c`-Text rekursiv bis Tiefe 3), damit Regeln auch Wrapper-Formen treffen. */
export function varianten(seg, segmente, tiefe = 0) {
  const w = woerter(seg);
  const roh = ohneWrapper(w);
  const kern = roh.length > 0 ? [basisname(roh[0]), ...roh.slice(1)] : roh;
  const out = new Set([seg, kern.join(" ")]);
  const inner = tiefe < MAX_INTERPRETER ? interpreterText(kern) : null;
  if (inner !== null) for (const s of segmente(inner)) for (const v of varianten(s.trim(), segmente, tiefe + 1)) out.add(v);
  return [...out];
}

/** Wendet die `Bash(...)`-Regeln der Berechtigungsliste auf jedes Segment und jede Variante (siehe `varianten`) an (Formen siehe `musterTrifft`). Gibt die erste Fundstelle oder `null`. */
function regelTreffer(befehl, regeln, segmente) {
  for (const seg of segmente(befehl).map((s) => s.trim())) {
    for (const variante of varianten(seg, segmente)) {
      for (const regel of regeln) {
        const m = /^Bash\((.*)\)$/s.exec(regel);
        if (m && musterTrifft(m[1], variante)) return { regel, segment: seg };
      }
    }
  }
  return null;
}

function berechtigungen(repoRoot, lies) {
  const text = lies(join(repoRoot, ".claude", "settings.json"));
  const p = JSON.parse(text).permissions ?? {};
  const liste = (k) => (Array.isArray(p[k]) ? p[k].filter((r) => typeof r === "string") : []);
  return { deny: liste("deny"), ask: liste("ask") };
}

function uebersetzeShell(eingabe, data) {
  if (!istText(eingabe.command)) return { grund: "Shell-Aufruf ohne Textbefehl (tool_input.command)" };
  if (eingabe.workdir !== undefined && !istText(eingabe.workdir)) return { grund: "Shell-Aufruf mit unlesbarem workdir" };
  if (!istText(data.cwd)) return { grund: "Payload ohne cwd" };
  const cwd = eingabe.workdir === undefined ? data.cwd : resolve(data.cwd, eingabe.workdir);
  return { payloads: [{ tool_name: "Bash", cwd, tool_input: { command: eingabe.command } }] };
}

function uebersetzePatch(eingabe, data) {
  const ziele = patchZiele(eingabe.command);
  if (!ziele) return { grund: "apply_patch-Text nicht lesbar (Begin/End-Rahmen oder Zielzeile fehlt, unbekannte Direktive)" };
  if (!istText(data.cwd)) return { grund: "Payload ohne cwd" };
  const verboten = ziele.find((z) => z.replace(/\\/g, "/").toLowerCase().split("/").includes(".codex"));
  if (verboten) return { grund: `Schreibziel ${verboten} liegt in .codex (Hook-Registrierung und Rollen ändert nur das Setup)` };
  return { payloads: ziele.map((file_path) => ({ tool_name: "Write", cwd: data.cwd, tool_input: { file_path } })) };
}

function uebersetzeAgent(eingabe) {
  if (!istText(eingabe.message)) return { grund: "spawn_agent ohne Textauftrag (tool_input.message)" };
  if (eingabe.agent_type !== undefined && !istText(eingabe.agent_type)) return { grund: "spawn_agent mit unlesbarem agent_type" };
  return { payloads: [{ tool_name: "Agent", tool_input: { subagent_type: eingabe.agent_type, prompt: eingabe.message } }] };
}

const UEBERSETZER = { shell: uebersetzeShell, patch: uebersetzePatch, agent: uebersetzeAgent };

/** Der Dispatcher-Lauf für alle Teil-Payloads: erstes Deny gewinnt, ein `ask` wird ein Deny, ein geworfener Guard ebenso; sonst `null`. */
function befrage(dispatch, payloads, repoRoot) {
  const fehler = [];
  const deps = { beiFehler: (e) => fehler.push(e), bezieher: () => true };
  for (const p of payloads) {
    const out = dispatch(JSON.stringify(p), repoRoot, undefined, undefined, deps)?.hookSpecificOutput;
    if (fehler.length > 0) return q(`Guard hat einen Fehler geworfen (${String(fehler[0]?.message ?? fehler[0])})`);
    if (out?.permissionDecision === "deny") return buildDenyOutput(out.permissionDecisionReason);
    if (out?.permissionDecision === "ask") return buildDenyOutput(`Codex kennt keine Rückfrage, darum verweigert: ${out.permissionDecisionReason}`);
  }
  return null;
}

/** `Bash`-Regeln aus `.claude/settings.json` (deny, dann ask) auf einen Shell-Befehl; unlesbare Quelle ist ein Deny mit Fix-Zeile. */
function befrageRegeln(befehl, repoRoot, { lies, segmente }) {
  let regeln;
  try {
    regeln = berechtigungen(repoRoot, lies);
  } catch (e) {
    return q(`.claude/settings.json nicht lesbar (${e.message}); Datei aus dem Repo wiederherstellen (git checkout -- .claude/settings.json im eigenen Worktree)`);
  }
  const deny = regelTreffer(befehl, regeln.deny, segmente);
  if (deny) return buildDenyOutput(`Berechtigungsregel ${deny.regel} (.claude/settings.json) verbietet \`${deny.segment}\`.`);
  const ask = regelTreffer(befehl, regeln.ask, segmente);
  return ask ? buildDenyOutput(`Codex kennt keine Rückfrage, darum verweigert: Berechtigungsregel ${ask.regel} (.claude/settings.json) verlangt bei \`${ask.segment}\` eine Bestätigung der Maintainerin.`) : null;
}

const istObjekt = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Payload-Text → `{ antwort }` (Deny oder `null` für ein fremdes Werkzeug) oder `{ art, eingabe, payloads }` für die Dispatcher-Frage. */
function lesePayload(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { antwort: q("Payload ist kein lesbares JSON") };
  }
  if (!istObjekt(data) || typeof data.tool_name !== "string") return { antwort: q("Payload ohne tool_name") };
  const art = Object.hasOwn(CODEX_HOOK_WERKZEUGE, data.tool_name) ? CODEX_HOOK_WERKZEUGE[data.tool_name] : null;
  if (art === null) return { antwort: null }; // fremdes Werkzeug: unberührt
  if (!istObjekt(data.tool_input)) return { antwort: q(`tool_input von ${data.tool_name} fehlt oder ist kein Objekt`) };
  const { payloads, grund } = UEBERSETZER[art](data.tool_input, data);
  return grund ? { antwort: q(grund) } : { art, eingabe: data.tool_input, payloads };
}

/** Tracing-Ausfallstopp für `spawn_agent`: Deny bei nicht erreichbarem Langfuse oder werfender Prüfung, sonst `null`. `deps.health` ersetzt die Prüfung (Tests). */
async function tracingStopp(deps) {
  const health = deps.health ?? (async () => (await import("./langfuse-health.mjs")).pruefeLangfuseAusUmgebung());
  let urteil;
  try {
    urteil = await health();
  } catch (e) {
    urteil = { ok: false, grund: `Health-Prüfung gescheitert: ${String(e?.message ?? e)}` };
  }
  if (urteil?.ok === true) return null;
  return buildDenyOutput(`Tracing-Ausfallstopp: ${urteil?.grund ?? "Health ohne Urteil"}. Ohne erreichbares Langfuse startet keine Rolle (spawn_agent verweigert); Langfuse starten, dann erneut.`);
}

/**
 * Entscheidet für ein Codex-Hook-Payload (Text): Deny-Output-Objekt oder `null` (durchlassen); wirft nie.
 * `deps.lade` ersetzt das Laden des Dispatchers, `deps.lies` das Lesen der settings.json (Tests).
 */
export async function entscheide(text, repoRoot, deps = {}) {
  try {
    const gelesen = lesePayload(text);
    if (gelesen.antwort !== undefined) return gelesen.antwort;
    const { art, eingabe, payloads } = gelesen;
    if (art === "agent") {
      const stopp = await tracingStopp(deps);
      if (stopp) return stopp;
    }
    const { dispatch, segmente } = await (deps.lade ?? ladeStandard)();
    const denied = befrage(dispatch, payloads, repoRoot);
    if (denied || art !== "shell") return denied;
    return befrageRegeln(eingabe.command, repoRoot, { lies: deps.lies ?? ((p) => readFileSync(p, "utf8")), segmente });
  } catch (e) {
    return q(`interner Fehler (${String(e?.message ?? e)})`);
  }
}
