/* @harness-waechter
 * Werkzeug-Vorprüfung (factory#260 L7): MCP-Server der Agent-Whitelists gegen `.mcp.json` und User-Scope, Node-Version gegen `.nvmrc`/`engines`,
 * Projekt-Befehle (`vorpruefung.befehle`), Exit-Codes der CLI und die Aufnahme in `codex-vorpruefung`. Dateisystem und Runner sind Stubs.
 *
 * Reines Node-Tooling ohne Declaration-File: Import über `unknown` auf ein lokales Interface. */
import { afterEach, describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/werkzeug-vorpruefung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBloecke from "../../scripts/projekt-config-bloecke.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawCodex from "../../scripts/codex-vorpruefung.mjs";

type Mangel = { text: string; fix: string };
type Lauf = { ok: boolean; grund: string };
type Werkzeug = {
  USER_SCOPE_MCP_SERVER: string[];
  BEFEHL_FRIST_MS: number;
  serverAusAgent: (t: string) => string[];
  serverAusRegeln: (r: string[]) => string[];
  unbekannteMcpServer: (r: string[], bekannt: string[]) => string[];
  bewerteMcp: (o: { agenten: { datei: string; text: string }[]; projekt: string[]; userScope?: string[] }) => Mangel[];
  versionTeile: (t: string) => number[] | null;
  bewerteNode: (o: { ist: string; nvmrc?: string | null; engines?: string | null }) => Mangel[];
  bewerteBefehle: (o: { befehle: { name: string; befehl: string[] }[]; laufe: (b: string[], f: number, cwd?: string) => Lauf; root?: string }) => Mangel[];
  laufeBefehl: (b: string[], f?: number, cwd?: string) => Lauf;
  werkzeugMaengel: (o?: Record<string, unknown>) => Mangel[];
  pruefeWerkzeuge: (o: { root: string; lies: (p: string) => string; liste: (p: string) => string[]; ist: string; config: unknown; laufe: (b: string[], f: number) => Lauf }) => Mangel[];
  main: (argv: string[], o?: Record<string, unknown>) => number;
};
const w = raw as unknown as Werkzeug;
const lib = rawLib as unknown as { ladeProjektConfig: () => unknown; vorpruefungAus: (c: unknown) => { befehle: unknown[]; userScopeServer: string[] }; pruefeProjektConfig: (c: unknown) => string[] };
const bloecke = rawBloecke as unknown as { pruefeVorpruefung: (b: unknown) => string[] };
const codex = rawCodex as unknown as { main: (argv: string[], o: Record<string, unknown>) => number };

const agent = (tools: string) => `---\nname: x\ntools: ${tools}\n---\ntext`;
const PW = agent("Read, mcp__playwright__browser_click, mcp__playwright__browser_close");
const LF = agent("Read, mcp__langfuse__getObservation");

/** Dateisystem-Stub: Pfad (relativ zu `/r/`) → Text; fehlend wirft wie readFileSync. */
function fs(dateien: Record<string, string>) {
  return {
    lies: (p: string) => {
      const k = p.replace(/\\/g, "/").replace("/r/", "");
      if (!(k in dateien)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return dateien[k];
    },
    liste: (p: string) => {
      const pre = p.replace(/\\/g, "/").replace("/r/", "") + "/";
      const namen = Object.keys(dateien).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length));
      if (namen.length === 0) throw new Error("ENOENT");
      return namen;
    },
  };
}
const ok: Lauf = { ok: true, grund: "" };
const lauf = (dateien: Record<string, string>, extra: Partial<Parameters<Werkzeug["pruefeWerkzeuge"]>[0]> = {}) =>
  w.pruefeWerkzeuge({ root: "/r", ...fs(dateien), ist: "22.23.4", config: {}, laufe: () => ok, ...extra });

describe("MCP-Server", () => {
  test("serverAusAgent liest nur mcp__<server>__ aus der tools-Zeile des Frontmatters", () => {
    expect(w.serverAusAgent(PW)).toEqual(["playwright"]);
    expect(w.serverAusAgent(agent("Read, mcp__a__x, mcp__b__y, mcp__a__z"))).toEqual(["a", "b"]);
    expect(w.serverAusAgent("---\nname: x\n---\ntools: mcp__a__x")).toEqual([]);
    expect(w.serverAusAgent("kein Frontmatter\ntools: mcp__a__x")).toEqual([]);
    expect(w.serverAusAgent(agent("Read, Bash"))).toEqual([]);
  });
  test("fehlende .mcp.json mit Playwright in der Whitelist ist ein Mangel mit Fix", () => {
    const m = lauf({ ".claude/agents/u.md": PW });
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain("playwright");
    expect(m[0].text).toContain(".claude/agents/u.md");
    expect(m[0].fix).toContain(".mcp.json");
  });
  test("mit eingetragenem Server ok", () => {
    expect(lauf({ ".claude/agents/u.md": PW, ".mcp.json": '{"mcpServers":{"playwright":{}}}' })).toEqual([]);
  });
  test("User-Scope-Server (langfuse) braucht keine .mcp.json", () => {
    expect(lauf({ ".claude/agents/u.md": LF })).toEqual([]);
    expect(w.USER_SCOPE_MCP_SERVER).toContain("langfuse");
  });
  test("ein unbekannter Server ist ein Mangel, mehrere Dateien werden zusammen genannt", () => {
    const m = lauf({ ".claude/agents/a.md": agent("mcp__neu__x"), ".claude/agents/b.md": agent("mcp__neu__y"), ".mcp.json": '{"mcpServers":{"playwright":{}}}' });
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain("a.md, .claude/agents/b.md");
  });
  test("nur Markdown-Dateien im Agentenordner zählen; .mcp.json ohne mcpServers kennt keinen Projekt-Server", () => {
    expect(lauf({ ".claude/agents/notiz.txt": PW })).toEqual([]);
    expect(lauf({ ".claude/agents/u.md": LF, ".mcp.json": "{}" })).toEqual([]);
    expect(lauf({ ".claude/agents/u.md": PW, ".mcp.json": "{}" })).toHaveLength(1);
  });
  test("kaputte .mcp.json ist ein Mangel", () => {
    const m = lauf({ ".mcp.json": "{kaputt" });
    expect(m.map((x) => x.text)).toEqual([".mcp.json ist kein gültiges JSON"]);
  });
  test("ein Agent ohne Frontmatter-Dateien und ohne Agentenordner bleibt ohne Mangel", () => {
    expect(lauf({})).toEqual([]);
  });
});

describe("Node-Version", () => {
  test("versionTeile", () => {
    expect(w.versionTeile("22.23.4")).toEqual([22, 23, 4]);
    expect(w.versionTeile(" v22.1\n")).toEqual([22, 1, 0]);
    expect(w.versionTeile("22")).toEqual([22, 0, 0]);
    expect(w.versionTeile("lts/*")).toBeNull();
    expect(w.versionTeile("22.x")).toBeNull();
  });
  test(".nvmrc höher ist ein Mangel, gleich oder niedriger ok", () => {
    const m = w.bewerteNode({ ist: "22.23.3", nvmrc: "22.23.4\n" });
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain(".nvmrc");
    expect(m[0].fix).toContain("22.23.4");
    expect(w.bewerteNode({ ist: "22.23.4", nvmrc: "22.23.4" })).toEqual([]);
    expect(w.bewerteNode({ ist: "24.0.0", nvmrc: "22.23.4" })).toEqual([]);
    expect(w.bewerteNode({ ist: "22.24.0", nvmrc: "22.23.4" })).toEqual([]);
    expect(w.bewerteNode({ ist: "20.99.99", nvmrc: "22.0.0" })).toHaveLength(1);
    expect(w.bewerteNode({ ist: "22.23.3", nvmrc: "22.23.4" })).toHaveLength(1);
  });
  test("nur engines.node (>=) gilt, wenn .nvmrc fehlt", () => {
    expect(w.bewerteNode({ ist: "22.0.0", engines: ">=22.23.4" })[0].text).toContain("engines.node");
    expect(w.bewerteNode({ ist: "22.23.4", engines: ">=22.23.4" })).toEqual([]);
    expect(w.bewerteNode({ ist: "22.0.0", nvmrc: "22.0.0", engines: ">=99.0.0" })).toEqual([]);
    expect(w.bewerteNode({ ist: "22.23.4", engines: " >= 22.23.4" })).toEqual([]);
    expect(w.bewerteNode({ ist: "22.0.0", engines: " >= 22.23.4" })).toHaveLength(1);
  });
  test("weder .nvmrc noch engines: übersprungen", () => {
    expect(w.bewerteNode({ ist: "1.0.0" })).toEqual([]);
    expect(lauf({ "package.json": "{}" })).toEqual([]);
  });
  test("kaputte Angabe oder kaputte laufende Version ist ein Mangel (fail-closed)", () => {
    expect(w.bewerteNode({ ist: "22.0.0", nvmrc: "lts/*" })[0].text).toContain("nicht prüfbar");
    expect(w.bewerteNode({ ist: "22.0.0", engines: "^22" })[0].text).toContain("nicht prüfbar");
    expect(w.bewerteNode({ ist: "22.0.0", engines: "22.0.0" })[0].fix).toContain(">=");
    expect(w.bewerteNode({ ist: "kaputt", nvmrc: "22" })[0].text).toContain("nicht prüfbar");
    expect(lauf({ "package.json": "{kaputt" }).map((x) => x.text)[0]).toContain("nicht prüfbar");
  });
  test("pruefeWerkzeuge liest .nvmrc vor package.json", () => {
    expect(lauf({ ".nvmrc": "22.23.4", "package.json": '{"engines":{"node":">=1.0.0"}}' }, { ist: "22.0.0" })).toHaveLength(1);
    expect(lauf({ "package.json": '{"engines":{"node":">=22.23.4"}}' }, { ist: "22.0.0" })).toHaveLength(1);
  });
});

describe("Projekt-Werkzeuge", () => {
  const befehle = [{ name: "Docker", befehl: ["docker", "info"] }];
  test("fehlender Block: keine Befehle, kein Lauf", () => {
    expect(lib.vorpruefungAus({}).befehle).toEqual([]);
    expect(lib.vorpruefungAus({ vorpruefung: {} }).befehle).toEqual([]);
    expect(lauf({}, { laufe: () => { throw new Error("darf nicht laufen"); } })).toEqual([]);
  });
  test("ok, ENOENT, Exit 1 und Timeout", () => {
    expect(w.bewerteBefehle({ befehle, laufe: () => ok })).toEqual([]);
    const m = w.bewerteBefehle({ befehle, laufe: () => ({ ok: false, grund: "Exit 1" }) });
    expect(m[0].text).toBe("Werkzeug „Docker“ nicht bereit: docker info → Exit 1");
    expect(m[0].fix).toContain("docker info");
    const gesehen: number[] = [];
    w.bewerteBefehle({ befehle, laufe: (_b, f) => { gesehen.push(f); return ok; } });
    expect(gesehen).toEqual([10_000]);
  });
  test("laufeBefehl: echter Prozess für ok, Exit != 0, ENOENT und Timeout", () => {
    const node = process.execPath;
    expect(w.laufeBefehl([node, "-e", "process.exit(0)"])).toEqual({ ok: true, grund: "" });
    expect(w.laufeBefehl([node, "-e", "process.exit(3)"])).toEqual({ ok: false, grund: "Exit 3" });
    expect(w.laufeBefehl(["gibt-es-nicht-sih-260"]).grund).toBe("Programm nicht gefunden (ENOENT)");
    expect(w.laufeBefehl([node, "-e", "setTimeout(()=>{},5000)"], 200).grund).toBe("Timeout nach 200 ms");
  });
  test("pruefeWerkzeuge reicht den Config-Block an den Runner", () => {
    const gesehen: string[][] = [];
    const m = lauf({}, { config: { vorpruefung: { befehle } }, laufe: (b) => { gesehen.push(b); return { ok: false, grund: "ENOENT" }; } });
    expect(gesehen).toEqual([["docker", "info"]]);
    expect(m).toHaveLength(1);
  });
  test("ungültiger Block: Mangel mit Fix, kein Lauf", () => {
    const m = lauf({}, { config: { vorpruefung: { befehle: [{ name: "x", befehl: "docker info" }] } }, laufe: () => { throw new Error("nie"); } });
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain("vorpruefung.befehle[0].befehl");
    expect(m[0].fix).toContain("Block vorpruefung");
  });
  test("Form des Blocks: jede Regel einzeln", () => {
    const f = (v: unknown) => lib.pruefeProjektConfig({ vorpruefung: v }).filter((e) => e.startsWith("vorpruefung"));
    expect(f({ befehle: befehle })).toEqual([]);
    expect(f({})).toEqual([]);
    expect(f(undefined)).toEqual([]);
    expect(f([])).toEqual(["vorpruefung muss ein Objekt mit der Liste befehle sein"]);
    expect(f({ x: 1 })).toEqual(["vorpruefung.x ist kein bekannter Schlüssel (erlaubt: befehle, userScopeServer)"]);
    expect(f({ befehle: "x" })).toEqual(["vorpruefung.befehle muss eine Liste von { name, befehl } sein"]);
    expect(f({ befehle: [{ befehl: ["a"] }] })).toEqual(["vorpruefung.befehle[0].name muss ein nicht-leerer String sein"]);
    expect(f({ befehle: [{ name: "a", befehl: [] }] })).toHaveLength(1);
    expect(f({ befehle: [{ name: "a", befehl: ["a", ""] }] })).toHaveLength(1);
    expect(f({ befehle: [{ name: "a", befehl: ["a"] }, { name: "a", befehl: ["b"] }] })).toEqual(["vorpruefung.befehle[1].name „a“ steht doppelt"]);
  });
});

describe("CLI und Codex", () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, o: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) } };
  };
  test("Exit 0 ohne Mangel", () => {
    const x = io();
    expect(w.main([], { ...x.o, root: "/r", lade: () => ({}), ...fs({}), laufe: () => ok })).toBe(0);
    expect(x.out).toEqual(["Werkzeug-Vorprüfung ok"]);
    expect(x.err).toEqual([]);
  });
  test("Exit 1 mit Mangel- und Fix-Zeile", () => {
    const x = io();
    expect(w.main([], { ...x.o, root: "/r", lade: () => ({}), ...fs({ ".claude/agents/u.md": PW }) })).toBe(1);
    expect(x.err[0]).toMatch(/^Mangel: MCP-Server „playwright“ fehlt/);
    expect(x.err[1]).toMatch(/^Fix: /);
  });
  test("Exit 1 bei unlesbarer Config, der Rest läuft trotzdem", () => {
    const x = io();
    expect(w.main([], { ...x.o, root: "/r", lade: () => { throw new Error("kaputt\nFix: x"); }, ...fs({}) })).toBe(1);
    expect(x.err[0]).toBe("Mangel: Projekt-Config nicht lesbar: kaputt");
  });
  test("Exit 2 bei unbekanntem Argument", () => {
    const x = io();
    expect(w.main(["--x"], x.o)).toBe(2);
    expect(x.err[0]).toContain("Aufruf: node scripts/werkzeug-vorpruefung.mjs");
  });
  test("echter Lauf im Repo ist grün", () => {
    const x = io();
    expect(w.main([], x.o)).toBe(0);
  });
  test("codex-vorpruefung nimmt Werkzeug-Mängel auf", () => {
    const out: string[] = [];
    const code = codex.main([], { out: (s: string) => out.push(s), err: () => {}, lade: () => lib.ladeProjektConfig(), root: "/nirgends", werkzeug: () => [{ text: "T", fix: "F" }] });
    expect(code).toBe(1);
    expect((JSON.parse(out[0]) as { maengel: string[] }).maengel).toContain("Werkzeug-Vorprüfung: T (Fix: F)");
    out.length = 0;
    codex.main([], { out: (s: string) => out.push(s), err: () => {}, lade: () => lib.ladeProjektConfig(), root: "/nirgends", werkzeug: () => [] });
    expect((JSON.parse(out[0]) as { maengel: string[] }).maengel.some((m: string) => m.startsWith("Werkzeug-Vorprüfung"))).toBe(false);
  });
});

describe("Review-Runde 1 (factory#260): echter Runner, Wurzel als cwd, Signal und EACCES", () => {
  const temps: string[] = [];
  afterEach(() => { for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true }); });
  const tempRoot = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), "werkzeug-"))); temps.push(d); return d; };
  const node = process.execPath;
  const block = (befehl: string[]) => ({ vorpruefung: { befehle: [{ name: "Probe", befehl }] } });
  const posix = process.platform !== "win32";

  test("werkzeugMaengel ohne injiziertes laufe startet den Befehl wirklich (Exit 1 = Mangel, Exit 0 = ok)", () => {
    const root = tempRoot();
    const m = w.werkzeugMaengel({ root, lade: () => block([node, "-e", "process.exit(1)"]), ist: "22.23.4" });
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain("Werkzeug „Probe“ nicht bereit");
    expect(m[0].text).toContain("Exit 1");
    expect(w.werkzeugMaengel({ root, lade: () => block([node, "-e", "process.exit(0)"]), ist: "22.23.4" })).toEqual([]);
  });
  test("main ohne injiziertes laufe: Exit 1 bei fehlschlagendem, 0 bei gelingendem Befehl", () => {
    const root = tempRoot();
    const stumm = { out: () => {}, err: () => {} };
    expect(w.main([], { ...stumm, root, lade: () => block([node, "-e", "process.exit(1)"]), ist: "22.23.4" })).toBe(1);
    expect(w.main([], { ...stumm, root, lade: () => block([node, "-e", "process.exit(0)"]), ist: "22.23.4" })).toBe(0);
  });
  test("Default-Lader: die Projekt-Config unter root/.factory/projekt.json liefert den Block vorpruefung (ohne injiziertes lade)", () => {
    const root = tempRoot();
    const repoConfig = JSON.parse(readFileSync(new URL("../../.factory/projekt.json", import.meta.url), "utf8")) as Record<string, unknown>;
    mkdirSync(join(root, ".factory"));
    const schreibe = (befehl: string[]) => writeFileSync(join(root, ".factory", "projekt.json"), JSON.stringify({ ...repoConfig, ...block(befehl) }));
    schreibe([node, "-e", "process.exit(1)"]);
    const m = w.werkzeugMaengel({ root, ist: "22.23.4" });
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain("Werkzeug „Probe“ nicht bereit");
    schreibe([node, "-e", "process.exit(0)"]);
    expect(w.werkzeugMaengel({ root, ist: "22.23.4" })).toEqual([]);
  });
  test("bewerteBefehle hat keinen Default-Runner: ohne laufe wirft der Aufruf, der Runner kommt immer von pruefeWerkzeuge", () => {
    const ohneLaufe = { befehle: [{ name: "Probe", befehl: [node, "-e", "process.exit(0)"] }] } as unknown as Parameters<Werkzeug["bewerteBefehle"]>[0];
    expect(() => w.bewerteBefehle(ohneLaufe)).toThrow(TypeError);
  });
  test("der Befehl läuft mit der Repo-Wurzel als cwd (werkzeugMaengel reicht root bis spawnSync durch)", () => {
    const root = tempRoot();
    const prog = `process.exit(require("fs").realpathSync(process.cwd()) === ${JSON.stringify(root)} ? 0 : 1)`;
    expect(w.werkzeugMaengel({ root, lade: () => block([node, "-e", prog]), ist: "22.23.4" })).toEqual([]);
    expect(w.laufeBefehl([node, "-e", prog], 5000, root)).toEqual({ ok: true, grund: "" });
    expect(w.laufeBefehl([node, "-e", prog], 5000, tempRoot()).ok).toBe(false);
  });
  test.skipIf(!posix)("Datei ohne x-Bit: der Grund nennt EACCES statt „Exit null“ (r.error wird ausgewertet; unter Windows läuft der Befehl über die Shell)", () => {
    const d = tempRoot();
    const datei = join(d, "ohne-x");
    writeFileSync(datei, "#!/bin/sh\nexit 0\n");
    chmodSync(datei, 0o644);
    const r = w.laufeBefehl([datei]);
    expect(r.ok).toBe(false);
    expect(r.grund).not.toBe("Exit null");
    expect(r.grund).toContain("EACCES");
  });
  test.skipIf(!posix)("per Signal beendeter Prozess: eigener Grundtext „Signal <name>“ statt „Exit null“", () => {
    expect(w.laufeBefehl([node, "-e", "process.kill(process.pid, 'SIGKILL')"])).toEqual({ ok: false, grund: "Signal SIGKILL" });
  });
  test("unlesbare Config: der Mangel steht neben den Mängeln der übrigen Prüfungen (kein Abbruch)", () => {
    const m = w.werkzeugMaengel({ root: "/r", ...fs({ ".claude/agents/u.md": PW }), lade: () => { throw new Error("kaputt\nFix: x"); }, ist: "22.23.4", laufe: () => ok });
    expect(m.map((x) => x.text)).toEqual(["Projekt-Config nicht lesbar: kaputt", expect.stringContaining("MCP-Server „playwright“ fehlt")]);
  });
  test("unlesbare gelistete Agent-Datei: leerer Text, kein Server, kein Absturz", () => {
    const m = w.pruefeWerkzeuge({ root: "/r", liste: () => ["a.md"], lies: () => { throw new Error("EACCES"); }, ist: "22.23.4", config: {}, laufe: () => ok });
    expect(m).toEqual([]);
  });
  test("bewerteNode: der Fix der .nvmrc trägt kein „>=“, der von engines.node schon", () => {
    expect(w.bewerteNode({ ist: "22.0.0", nvmrc: "kaputt" })[0].fix).not.toContain(">=");
    expect(w.bewerteNode({ ist: "22.0.0", engines: "kaputt" })[0].fix).toContain(">=");
  });
  test("Regex-Anker: versionTeile und serverAusAgent verlangen den Anfang", () => {
    expect(w.versionTeile("x22.1.0")).toBeNull();
    expect(w.serverAusAgent(agent("Bash(mcp__x__y)"))).toEqual([]);
    expect(w.serverAusAgent(agent("Read,  mcp__x__y"))).toEqual(["x"]);
  });
  test("Form des Blocks: ein Eintrag, der kein Objekt ist, ist ein Formfehler und kein TypeError", () => {
    const f = (v: unknown) => lib.pruefeProjektConfig({ vorpruefung: v }).filter((e) => e.startsWith("vorpruefung"));
    const erwartet = ["vorpruefung.befehle[0].name muss ein nicht-leerer String sein"];
    expect(f({ befehle: [null] })).toEqual(erwartet);
    expect(f({ befehle: ["x"] })).toEqual(erwartet);
  });
  test("Einstieg als Prozess: Exit 2 bei unbekanntem Argument und Exit 0 im Repo", () => {
    const skript = fileURLToPath(new URL("../../scripts/werkzeug-vorpruefung.mjs", import.meta.url));
    expect(spawnSync(node, [skript, "--x"], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync(node, [skript], { encoding: "utf8" }).status).toBe(0);
  });
  test("codex-vorpruefung: die Standard-Verdrahtung reicht root und lade an die Werkzeug-Vorprüfung", () => {
    const root = tempRoot();
    mkdirSync(join(root, ".claude", "agents"), { recursive: true });
    writeFileSync(join(root, ".claude", "agents", "u.md"), PW);
    const out: string[] = [];
    codex.main([], { out: (s: string) => out.push(s), err: () => {}, root, lade: () => ({ ...(lib.ladeProjektConfig() as object), ...block([node, "-e", "process.exit(1)"]) }) });
    const maengel = (JSON.parse(out[0]) as { maengel: string[] }).maengel;
    expect(maengel.some((m) => m.startsWith("Werkzeug-Vorprüfung: MCP-Server „playwright“ fehlt"))).toBe(true);
    expect(maengel.some((m) => m.startsWith("Werkzeug-Vorprüfung: Werkzeug „Probe“ nicht bereit"))).toBe(true);
  });
});

describe("User-Scope-Server der Projekt-Config (factory#263 L5, L6)", () => {
  const agentX = { ".claude/agents/u.md": agent("mcp__x__t") };
  const stub = (lade: () => unknown, dateien: Record<string, string> = agentX) => w.werkzeugMaengel({ root: "/r", ...fs(dateien), ist: "22.23.4", laufe: () => ok, lade });
  test("Formprüfung userScopeServer: gültige Liste ok; Nicht-Liste, leerer, Nicht-String- und Sonderzeichen-Eintrag sowie unbekannter Schlüssel sind Fehler", () => {
    expect(bloecke.pruefeVorpruefung({ userScopeServer: ["x", "a-b_1"] })).toEqual([]);
    expect(bloecke.pruefeVorpruefung({ userScopeServer: "x" })).toEqual(["vorpruefung.userScopeServer muss eine Liste von Servernamen sein"]);
    expect(bloecke.pruefeVorpruefung({ userScopeServer: [""] })[0]).toContain("userScopeServer[0]");
    expect(bloecke.pruefeVorpruefung({ userScopeServer: [1] })[0]).toContain("userScopeServer[0]");
    expect(bloecke.pruefeVorpruefung({ userScopeServer: ["a b"] })[0]).toContain("userScopeServer[0]");
    expect(bloecke.pruefeVorpruefung({ foo: 1 })).toEqual(["vorpruefung.foo ist kein bekannter Schlüssel (erlaubt: befehle, userScopeServer)"]);
  });
  test("vorpruefungAus liefert userScopeServer, ohne Angabe eine leere Liste; kaputte Form wirft mit Fix, der den Schlüssel nennt", () => {
    expect(lib.vorpruefungAus({}).userScopeServer).toEqual([]);
    expect(lib.vorpruefungAus({ vorpruefung: { befehle: [] } }).userScopeServer).toEqual([]);
    expect(lib.vorpruefungAus({ vorpruefung: { userScopeServer: ["x"] } }).userScopeServer).toEqual(["x"]);
    expect(() => lib.vorpruefungAus({ vorpruefung: { userScopeServer: "x" } })).toThrow(/Fix: .*userScopeServer/);
  });
  test("werkzeugMaengel: Server aus der Config ist bekannt, ohne Config ein Mangel mit Hinweis auf den Schlüssel; langfuse bleibt Kern-Basis", () => {
    expect(stub(() => ({ vorpruefung: { userScopeServer: ["x"] } }))).toEqual([]);
    const ohne = stub(() => ({}));
    expect(ohne).toHaveLength(1);
    expect(ohne[0].fix).toContain("vorpruefung.userScopeServer");
    expect(stub(() => ({ vorpruefung: { userScopeServer: ["x"] } }), { ".claude/agents/u.md": LF })).toEqual([]);
  });
  test("geteilte Funktion: Form ohne Tool, Form mit Tool, Bash-Regel ignoriert, Duplikate einmal", () => {
    expect(w.serverAusRegeln(["mcp__a__t", "mcp__b", "Bash(npm:*)", "mcp__a__u", "Read"])).toEqual(["a", "b"]);
    expect(w.unbekannteMcpServer(["mcp__langfuse__getObservation", "mcp__playwright", "Bash(npm:*)"], ["langfuse", "playwright"])).toEqual([]);
    expect(w.unbekannteMcpServer(["mcp__langfuse2__getObservation", "mcp__neu", "mcp__neu__x"], ["langfuse", "playwright"])).toEqual(["langfuse2", "neu"]);
    expect(w.serverAusAgent(agent("Read, mcp__a"))).toEqual(["a"]);
  });
  test("serverAusRegeln: Namen beginnen und enden nicht mit Unterstrich, Leerraum außen zählt nicht", () => {
    expect(w.serverAusRegeln(["mcp___x__t", "mcp___x"])).toEqual([]);
    expect(w.serverAusRegeln(["mcp__a_", "mcp__a_ "])).toEqual([]);
    expect(w.serverAusRegeln([" mcp__a ", "mcp__b__t "])).toEqual(["a", "b"]);
  });
  test("kaputte Config und MCP-Agent: Config-Mangel und der fehlende Server werden beide gemeldet", () => {
    const m = stub(() => ({ vorpruefung: { userScopeServer: "x" } }));
    expect(m).toHaveLength(2);
    expect(m.some((x) => x.text.includes("userScopeServer"))).toBe(true);
    expect(m.some((x) => x.text.includes("„x“ fehlt") || x.text.includes('"x"'))).toBe(true);
  });
});
