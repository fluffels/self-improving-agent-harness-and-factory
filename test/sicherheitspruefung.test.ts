/**
 * Sicherheitsprüfung (factory#388): Einstieg mit eingespeisten Nähten, Schreibgrenze, Workflow-Wächter und Sync-Erhalt der Soll-Liste.
 * @probe-echte-dateien liest die echten Quellen `scripts/sicherheitspruefung*.mjs`, `.github/workflows/sicherheitspruefung.yml`, `.github/sicherheitspruefung.json` und `.factory/besitz.json`.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as skriptRaw from "../scripts/sicherheitspruefung.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as cfgRaw from "../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as syncRaw from "../scripts/factory-sync-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/sicherheitspruefung-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const lies = (p: string) => readFileSync(`${WURZEL}${p}`, "utf8");
const S = skriptRaw as unknown as { main: (argv: string[], deps: Record<string, unknown>) => Promise<number> };
const L = libRaw as unknown as { MARKER: string; TITEL_PRAEFIX: string };
const C = cfgRaw as unknown as { ladeProjektConfig: () => { repo: string; labels: { forum: string } } & Record<string, unknown> };
const config = C.ladeProjektConfig();
const REPO: string = config.repo;
const owner = REPO.split("/")[0];

const SOLL = JSON.stringify({ kern: { punkte: ["Secret Scanning", "Admin-Recht", "Dependabot Alerts", "Dependabot-Abdeckung", "CodeQL-Sprachen"], codeql: { JavaScript: "javascript-typescript" } } });
const DEPENDABOT_OK = 'updates:\n  - package-ecosystem: "npm"\n    directory: "/"\n  - package-ecosystem: "github-actions"\n    directory: "/"\n';
const DOCTOR_OK = [{ punkt: "Secret Scanning", ok: true }, { punkt: "Admin-Recht", ok: true }];
const DOCTOR_LUECKE = [{ punkt: "Secret Scanning", ok: false, befund: "aus", fix: "aktivieren" }, { punkt: "Admin-Recht", ok: true }];
const ticket = (extra: Record<string, unknown> = {}) => ({ number: 5, title: `${L.TITEL_PRAEFIX}2026-10`, body: `${L.MARKER}\nx`, author: { login: owner, is_bot: false }, labels: [], ...extra });

type Lauf = { code: number; schreib: string[][]; bodies: string[]; lesen: string[][]; board: string[][]; out: string; doctor: number };
type Opt = { frischFehler?: boolean; sprachen?: Record<string, number>; lesePkg?: (p: string) => string | null; boardFehler?: boolean; dateien?: string[]; config?: Record<string, unknown>; doctor?: unknown[]; issues?: unknown[]; frisch?: unknown[]; env?: Record<string, string>; argv?: string[]; soll?: string | null; dependabot?: string; alerts?: number; doctorFehler?: boolean; antwort?: string };

/** Alle Nähte eingespeist; ein Schreibaufruf wird nur aufgezeichnet (nie ein echtes gh). */
async function lauf(o: Opt = {}): Promise<Lauf> {
  const r: Lauf = { code: -1, schreib: [], bodies: [], lesen: [], board: [], out: "", doctor: 0 };
  const out: string[] = [];
  const dateien = { ".github/sicherheitspruefung.json": o.soll === undefined ? SOLL : o.soll, ".github/dependabot.yml": o.dependabot ?? DEPENDABOT_OK } as Record<string, string | null>;
  r.code = await S.main(o.argv ?? [], {
    ladeConfig: () => o.config ?? config,
    ladeLibs: () => Promise.resolve({ REPO, platziereAmEnde: (nr: number, token: string) => { r.board.push([String(nr), token]); if (o.boardFehler) throw new Error("Board nicht erreichbar"); } }),
    doctor: () => {
      r.doctor++;
      if (o.doctorFehler) throw new Error("Ruleset-Spiegel kaputt");
      return { ergebnis: o.doctor ?? DOCTOR_OK };
    },
    gh: (args: string[]) => {
      r.lesen.push(args);
      const a = args.join(" ");
      if (a.includes("vulnerability-alerts")) {
        const status = o.alerts ?? 204;
        if (status === 204) return "";
        throw Object.assign(new Error(`gh: HTTP ${status}`), { stderr: `HTTP ${status}` });
      }
      if (a.includes("/languages")) return JSON.stringify(o.sprachen ?? { JavaScript: 100 });
      if (a.includes("code-scanning/default-setup")) return JSON.stringify({ state: "configured", languages: ["javascript-typescript", "actions"] });
      if (args[0] === "issue") return JSON.stringify(o.issues ?? []);
      if (a.includes("issues?state=open")) {
        if (o.frischFehler) throw new Error("HTTP 502");
        // echte Form von gh api --paginate --slurp: ein Array von Seiten, das Ticket steht auf Seite 2
        return JSON.stringify(args.includes("--slurp") ? [[], o.frisch ?? []] : (o.frisch ?? []));
      }
      return "{}";
    },
    schreibe: (args: string[], input: string) => {
      r.schreib.push(args);
      r.bodies.push(input);
      return o.antwort ?? `https://github.com/${REPO}/issues/77\n`;
    },
    lese: (p: string) => (p in dateien ? dateien[p] : o.lesePkg?.(p) ?? null),
    dateien: () => o.dateien ?? ["package.json", ".github/workflows/ci.yml"],
    env: o.env ?? { PROJECT_TOKEN: "t" },
    heute: "2031-04-09",
    log: (m: string) => out.push(m),
    err: (m: string) => out.push(m),
  });
  r.out = out.join("\n");
  return r;
}

describe("sicherheitspruefung.mjs", () => {
  test("Negativfall: alles gleich dem Soll → kein Schreibaufruf, kein Board-Aufruf, nur eine Log-Zeile", async () => {
    const r = await lauf();
    expect(r.code).toBe(0);
    expect(r.schreib).toEqual([]);
    expect(r.board).toEqual([]);
    expect(r.lesen.some((a) => a[0] === "issue")).toBe(false);
    expect(r.out).toMatch(/nichts zu tun/);
    expect(r.lesen.some((a) => a.join(" ").includes("default-setup"))).toBe(false);
  });

  test("Zeile Secret PROJECT_TOKEN nur in Actions und nur ohne Token", async () => {
    const mit = await lauf({ doctor: DOCTOR_LUECKE, env: { GITHUB_ACTIONS: "true", PROJECT_TOKEN: "t" } });
    expect(mit.bodies[0]).not.toContain("Secret PROJECT_TOKEN");
    const lokal = await lauf({ doctor: DOCTOR_LUECKE, env: {} });
    expect(lokal.bodies[0]).not.toContain("Secret PROJECT_TOKEN");
  });

  test("Alerts-404 ohne Admin-Recht des Prüflaufs ist nicht prüfbar, nicht aus", async () => {
    const r = await lauf({ doctor: [{ punkt: "Secret Scanning", ok: true }, { punkt: "Admin-Recht", ok: false, befund: "kein Admin", fix: "x" }], alerts: 404 });
    expect(r.bodies[0]).toContain("ohne Admin-Recht nicht lesbar");
    expect(r.bodies[0]).not.toContain("Dependabot Alerts sind aus");
  });

  test("Abweichung: genau ein issue create im eigenen Repo mit Marker und Label, danach Board-Aufruf mit Token", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE });
    expect(r.code).toBe(0);
    expect(r.schreib).toHaveLength(1);
    expect(r.schreib[0].slice(0, 4)).toEqual(["issue", "create", "--repo", REPO]);
    expect(r.schreib[0]).toContain("--title");
    expect(r.schreib[0]).toContain("🛡️ Sicherheitsprüfung 2031-04");
    expect(r.bodies[0]).toContain("(2031-04-09)");
    expect(r.bodies[0].startsWith(L.MARKER)).toBe(true);
    expect(r.bodies[0]).toContain("| Secret Scanning | aus | aktiviert | aktivieren |");
    expect(r.board).toEqual([["77", "t"]]);
  });

  test("das Label der Config steht am Ticket (eigenes Repo führt das Board)", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE });
    const label = (config as unknown as { labels: { dependabotInbox: string } }).labels.dependabotInbox;
    expect(r.schreib[0].slice(-2)).toEqual(["--label", label]);
  });

  test("Board-Fehler nach dem Anlegen ist nur eine Warnung, das Ticket bleibt", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE, boardFehler: true });
    expect(r.code).toBe(0);
    expect(r.schreib).toHaveLength(1);
    expect(r.out).toMatch(/::warning::Ticket #77 angelegt, aber nicht ans Ende/);
  });

  test("Punkte außerhalb der Soll-Liste werden nicht geprüft (keine Alerts-, Sprachen- und Dependabot-Aufrufe)", async () => {
    const r = await lauf({ soll: JSON.stringify({ kern: { punkte: ["Secret Scanning"] } }), dependabot: "kaputt" });
    expect(r.code).toBe(0);
    expect(r.lesen.filter((a) => a.join(" ").includes("repos/")).length).toBe(0);
    expect(r.schreib).toEqual([]);
  });

  test("ohne Modul codeql kommt das Ist aus dem Default-Setup; fehlende Sprache ist eine Abweichung", async () => {
    const ok = await lauf({ config: { ...config, module: [] } });
    expect(ok.schreib).toEqual([]);
    expect(ok.lesen.some((a) => a.join(" ").includes("code-scanning/default-setup"))).toBe(true);
    const kern = JSON.stringify({ kern: { punkte: ["CodeQL-Sprachen"], codeql: { JavaScript: "javascript-typescript", Python: "python" } } });
    const luecke = await lauf({ config: { ...config, module: [] }, soll: kern, doctor: [], sprachen: { JavaScript: 100, Python: 5 } });
    expect(luecke.bodies[0]).toContain("python");
  });

  test("npm-Workspaces aus der package.json des Verzeichnisses decken ab", async () => {
    const pkg = (p: string) => (p === "package.json" ? JSON.stringify({ workspaces: ["frontend"] }) : null);
    const r = await lauf({ dateien: ["package.json", "frontend/package.json"], lesePkg: pkg });
    expect(r.schreib).toEqual([]);
    const ohne = await lauf({ dateien: ["package.json", "frontend/package.json"] });
    expect(ohne.bodies[0]).toContain("npm /frontend");
  });

  describe("Projektschlüssel und Verdrahtung", () => {
    const soll = (projekt: Record<string, unknown>, punkte = ["Dependabot-Abdeckung", "CodeQL-Sprachen"]) => JSON.stringify({ kern: { punkte, codeql: { JavaScript: "javascript-typescript", Python: "python" } }, projekt });
    const mitFrontend = { dateien: ["package.json", "frontend/package.json", ".github/workflows/ci.yml"], doctor: [] };

    test("projekt.ausnahmen nimmt ein Verzeichnis aus; ohne sie entsteht die Lücke; die Ausnahme steht im Ticket", async () => {
      expect((await lauf({ ...mitFrontend, soll: soll({}) })).bodies[0]).toContain("npm /frontend");
      expect((await lauf({ ...mitFrontend, soll: soll({ ausnahmen: [{ pfad: "frontend", grund: "Fixture" }] }) })).schreib).toEqual([]);
      const mit = await lauf({ ...mitFrontend, soll: soll({ ausnahmen: [{ pfad: "frontend", grund: "Fixture" }] }, ["Dependabot-Abdeckung", "Secret Scanning"]), doctor: DOCTOR_LUECKE });
      expect(mit.bodies[0]).toContain("Dependabot-Ausnahme `frontend`: Fixture");
      expect(mit.out).toContain("Sicherheitsprüfung: Dependabot-Ausnahme frontend: Fixture");
    });

    test("projekt.manifeste ergänzt ein Ökosystem", async () => {
      const r = await lauf({ dateien: ["x/mix.exs"], doctor: [], soll: soll({ manifeste: [{ oekosystem: "mix", datei: "mix.exs" }] }, ["Dependabot-Abdeckung"]) });
      expect(r.bodies[0]).toContain("mix /x");
    });

    test("projekt.codeqlOhne nimmt eine Sprache aus und steht im Ticket", async () => {
      const basis = { doctor: [], sprachen: { JavaScript: 1, Python: 2 }, dateien: ["package.json"] };
      expect((await lauf({ ...basis, soll: soll({}, ["CodeQL-Sprachen"]) })).bodies[0]).toContain("python");
      expect((await lauf({ ...basis, soll: soll({ codeqlOhne: [{ sprache: "python", grund: "Skripte" }] }, ["CodeQL-Sprachen"]) })).schreib).toEqual([]);
      const r = await lauf({ ...basis, doctor: DOCTOR_LUECKE, soll: soll({ codeqlOhne: [{ sprache: "python", grund: "Skripte" }] }, ["CodeQL-Sprachen", "Secret Scanning"]) });
      expect(r.bodies[0]).toContain("CodeQL ohne `python`: Skripte");
      expect(r.out).toContain("Sicherheitsprüfung: CodeQL ohne python: Skripte");
    });

    test("actions zählt nur mit getrackten Workflows", async () => {
      const cfg = { ...config, codeql: { sprachen: ["javascript-typescript"] } };
      const basis = { config: cfg, doctor: [], soll: soll({}, ["CodeQL-Sprachen"]) };
      expect((await lauf({ ...basis, dateien: ["package.json"] })).schreib).toEqual([]);
      expect((await lauf({ ...basis, dateien: ["package.json", ".github/workflows/ci.yml"] })).bodies[0]).toContain("actions");
    });

    test("punkteOhne wählt einen Punkt ab; ein fehlender Ruleset-Spiegel nennt den Fix", async () => {
      const kern = ["Secret Scanning", "Ruleset-Spiegel"];
      const ohneSpiegel = await lauf({ doctor: DOCTOR_OK, soll: soll({}, kern) });
      expect(ohneSpiegel.bodies[0]).toMatch(/\| Ruleset-Spiegel \| kein Ergebnis des Prüflaufs.*punkteOhne/);
      const abgewaehlt = await lauf({ doctor: DOCTOR_OK, soll: soll({ punkteOhne: [{ punkt: "Ruleset-Spiegel", grund: "kein Spiegel" }] }, kern) });
      expect(abgewaehlt.schreib).toEqual([]);
      expect(abgewaehlt.out).toContain("Sicherheitsprüfung: Punkt abgewählt Ruleset-Spiegel: kein Spiegel");
      const mitLuecke = await lauf({ doctor: DOCTOR_LUECKE, soll: soll({ punkteOhne: [{ punkt: "Ruleset-Spiegel", grund: "kein Spiegel" }] }, ["Secret Scanning", ...kern]) });
      expect(mitLuecke.bodies[0]).toContain("Punkt abgewählt `Ruleset-Spiegel`: kein Spiegel");
    });

    test("verschachtelte package.json eines Workspace-Wurzelverzeichnisses wird gelesen", async () => {
      const dependabot = 'updates:\n  - package-ecosystem: npm\n    directory: "/web"\n  - package-ecosystem: github-actions\n    directory: "/"\n';
      const pkg = (p: string) => (p === "web/package.json" ? JSON.stringify({ workspaces: ["apps/*"] }) : null);
      const r = await lauf({ dateien: ["web/package.json", "web/apps/a/package.json", ".github/workflows/ci.yml"], lesePkg: pkg, dependabot, doctor: [], soll: soll({}, ["Dependabot-Abdeckung"]) });
      expect(r.schreib).toEqual([]);
    });

    test("das Label steht nur am Ticket, wenn sein Board dieses Repo führt", async () => {
      const fremd = { ...config, boards: (config as unknown as { boards: Record<string, unknown>[] }).boards.map((b) => ({ ...b, repo: "fremd/x" })) };
      const r = await lauf({ doctor: DOCTOR_LUECKE, config: fremd });
      expect(r.schreib).toHaveLength(1);
      expect(r.schreib[0]).not.toContain("--label");
    });

    test("ein offenes Ticket mit Label forum unterdrückt den Lauf nicht", async () => {
      const r = await lauf({ doctor: DOCTOR_LUECKE, issues: [ticket({ labels: [{ name: config.labels.forum }] })] });
      expect(r.schreib).toHaveLength(1);
    });

    test("Zweitabfrage schlägt fehl → kein Anlegen, Warnung (fail-closed)", async () => {
      const r = await lauf({ doctor: DOCTOR_LUECKE, frischFehler: true });
      expect(r.code).toBe(0);
      expect(r.schreib).toEqual([]);
      expect(r.out).toMatch(/::warning::.*Zweitabfrage vor dem Anlegen fehlgeschlagen/);
    });

    test("Ticketnummer 0 in der Antwort ist ein Fehler", async () => {
      const r = await lauf({ doctor: DOCTOR_LUECKE, antwort: `https://github.com/${REPO}/issues/0` });
      expect(r.code).toBe(1);
    });
  });

  test("Dependabot-Lücke aus den Dateien erzeugt eine Zeile mit Ist, Soll und Fix", async () => {
    const r = await lauf({ dependabot: 'updates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n' });
    expect(r.schreib).toHaveLength(1);
    expect(r.bodies[0]).toMatch(/Dependabot-Abdeckung npm \/ \| kein Eintrag für npm in \/ .* \| je Manifest ein Dependabot-Eintrag .* \| in \.github\/dependabot\.yml/);
  });

  test("Alerts aus (404 mit Admin-Recht) ist eine Abweichung, 403 ist nicht prüfbar und zählt auch", async () => {
    expect((await lauf({ alerts: 404 })).bodies[0]).toContain("| Dependabot Alerts | Dependabot Alerts sind aus |");
    expect((await lauf({ alerts: 403 })).bodies[0]).toContain("nicht auswertbar");
  });

  test("Negativfall: offenes vertrautes Ticket → kein Schreibaufruf", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE, issues: [ticket()] });
    expect(r.code).toBe(0);
    expect(r.schreib).toEqual([]);
    expect(r.board).toEqual([]);
    expect(r.out).toMatch(/#5 der Sicherheitsprüfung ist noch offen/);
  });

  test("ein Pull Request mit Marker in der frischen Liste zählt nicht als Ticket", async () => {
    const pr = [{ number: 6, title: `${L.TITEL_PRAEFIX}2026-11`, body: L.MARKER, user: { login: owner, type: "User" }, labels: [], pull_request: {} }];
    expect((await lauf({ doctor: DOCTOR_LUECKE, frisch: pr })).schreib).toHaveLength(1);
  });

  test("Ticket eines Fremden mit Marker unterdrückt den Lauf nicht", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE, issues: [ticket({ author: { login: "fremd", is_bot: false } })] });
    expect(r.schreib).toHaveLength(1);
  });

  test("Zweitabfrage kennt ein frisches Ticket, die Liste nicht → kein Anlegen, Warnung", async () => {
    const frisch = [{ number: 6, title: `${L.TITEL_PRAEFIX}2026-11`, body: L.MARKER, user: { login: owner, type: "User" }, labels: [] }];
    const r = await lauf({ doctor: DOCTOR_LUECKE, frisch });
    expect(r.schreib).toEqual([]);
    expect(r.out).toMatch(/Zweitabfrage/);
    expect(r.lesen.some((a) => a.includes("--paginate") && a.includes("--slurp"))).toBe(true);
  });

  test("--dry-run: Bericht und Entscheidung auf stdout, kein Schreibaufruf", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE, argv: ["--dry-run"] });
    expect(r.code).toBe(0);
    expect(r.schreib).toEqual([]);
    expect(r.board).toEqual([]);
    expect(r.out).toContain("[dry-run] Entscheidung: anlegen");
    expect(r.out).toContain("| Secret Scanning |");
  });

  test("GITHUB_REPOSITORY weicht vom Repo der Config ab → Exit 1 vor jedem Aufruf", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE, env: { PROJECT_TOKEN: "t", GITHUB_REPOSITORY: "fremd/anderes" } });
    expect(r.code).toBe(1);
    expect(r.doctor).toBe(0);
    expect(r.lesen).toEqual([]);
    expect(r.schreib).toEqual([]);
    expect(r.out).toMatch(/nichts getan/);
  });

  test("ohne PROJECT_TOKEN in Actions: zusätzliche Zeile Secret PROJECT_TOKEN; das Ticket entsteht, das Board nur mit Warnung", async () => {
    const r = await lauf({ env: { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: REPO } });
    expect(r.schreib).toHaveLength(1);
    expect(r.bodies[0]).toContain("| Secret PROJECT_TOKEN |");
    expect(r.board).toEqual([]);
    expect(r.out).toMatch(/::warning::PROJECT_TOKEN fehlt/);
  });

  test.each([
    ["fehlt", null, /sicherheitspruefung\.json fehlt/],
    ["kein JSON", "{", /kein gültiges JSON/],
    ["unbekannter Punkt", JSON.stringify({ kern: { punkte: ["Erfunden"] } }), /unbekannter Punkt/],
  ])("Konfigurationsfehler (%s): Exit 2 ohne Schreibaufruf", async (_n, soll, muster) => {
    const r = await lauf({ soll, doctor: DOCTOR_LUECKE });
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/Soll-Liste ungültig/);
    expect(r.out).toMatch(muster);
    expect(r.schreib).toEqual([]);
  });

  test("Fehlerpfade: Doctor wirft, Issue-Liste am Limit, Nummer nicht lesbar → Exit 1", async () => {
    expect((await lauf({ doctorFehler: true })).code).toBe(1);
    const voll = Array.from({ length: 1000 }, (_, i) => ticket({ number: i + 10, title: "x", body: "" }));
    const limit = await lauf({ doctor: DOCTOR_LUECKE, issues: voll });
    expect(limit.code).toBe(1);
    expect(limit.schreib).toEqual([]);
    const nummer = await lauf({ doctor: DOCTOR_LUECKE, antwort: "kein link" });
    expect(nummer.code).toBe(1);
    expect(nummer.out).toMatch(/Nummer nicht lesbar/);
  });

  test("Aufrufer mit unbekanntem Flag → Exit 2", async () => {
    expect((await lauf({ argv: ["--foo"] })).code).toBe(2);
  });

  test("Wächter Schreibgrenze: jeder Schreibaufruf trägt das eigene Repo, nichts außer issue create", async () => {
    const r = await lauf({ doctor: DOCTOR_LUECKE });
    for (const a of r.schreib) {
      expect(a.slice(0, 2)).toEqual(["issue", "create"]);
      expect(a[a.indexOf("--repo") + 1]).toBe(REPO);
    }
    const quelle = lies("scripts/sicherheitspruefung.mjs");
    expect([...quelle.matchAll(/"--repo", ([^,\]]+)/g)].map((m) => m[1])).toEqual(["repo", "repo"]);
    expect(quelle).not.toMatch(/MELDESTELLE|melden\.mjs|meldestelle/i);
    expect(quelle).not.toMatch(/"(close|comment|edit|delete|lock)"/);
  });
});

describe("Workflow sicherheitspruefung.yml", () => {
  type Schritt = { uses?: string; with?: Record<string, unknown>; run?: string };
  const wf = parse(lies(".github/workflows/sicherheitspruefung.yml")) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, { permissions?: unknown; steps: Schritt[] }> };
  const text = lies(".github/workflows/sicherheitspruefung.yml");
  test("nur schedule und workflow_dispatch, kein pull_request_target", () => {
    expect(Object.keys(wf.on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });
  test("Rechte oben genau contents: read und issues: write", () => {
    expect(wf.permissions).toEqual({ contents: "read", issues: "write" });
    expect(Object.values(wf.jobs).every((j) => j.permissions === undefined)).toBe(true);
  });
  test("kein Meldestellen-Token, kein --repo, checkout ohne persistierte Credentials, Actions per SHA, kein npm ci", () => {
    expect(text).not.toMatch(/MELDESTELLE_TOKEN|--repo/);
    const schritte = wf.jobs.sicherheitspruefung.steps;
    expect(schritte[0].with?.["persist-credentials"]).toBe(false);
    for (const s of schritte.filter((x) => x.uses)) expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    expect(text).not.toMatch(/npm (ci|install)/);
  });
  test("trocken kommt über env, nicht als Ausdruck im run-Block", () => {
    const run = wf.jobs.sicherheitspruefung.steps.at(-1)?.run ?? "";
    expect(run).not.toContain("${{");
    expect(run).toContain("--dry-run");
  });
});

describe("Soll-Liste im Sync", () => {
  const besitz = JSON.parse(lies(".factory/besitz.json")) as { eintraege: { pfad: string }[] };
  const eintraege = besitz.eintraege.filter((e) => e.pfad === ".github/sicherheitspruefung.json");
  const sync = syncRaw as unknown as { wendeTeileAn: (e: unknown[], src: string, ziel: string | null, cfg: unknown, erg?: unknown) => string; pruefeErgebnis: (p: string, e: unknown[], src: string, ziel: string | null, ergebnis: string) => string[] };
  const src = lies(".github/sicherheitspruefung.json");
  type Sollform = { kern: unknown; projekt?: unknown };
  const quelle = JSON.parse(src) as Sollform;

  test("das Manifest führt die Datei als Besitz-Schlüssel kern, ohne Modul", () => {
    expect(eintraege).toHaveLength(1);
    expect(eintraege[0]).toMatchObject({ schluessel: "kern", ring: "kern" });
    expect(eintraege[0]).not.toHaveProperty("modul");
  });
  test("der Sync setzt nur kern: projekt bleibt, ein veralteter kern gleicht der Quelle", () => {
    const ziel = JSON.stringify({ kern: { punkte: ["Secret Scanning"] }, projekt: { punkte: ["PVR"], ausnahmen: [{ pfad: "x", grund: "g" }] } }, null, 2) + "\n";
    const ergebnis = sync.wendeTeileAn(eintraege, src, ziel, {});
    const neu = JSON.parse(ergebnis) as Sollform;
    expect(neu.projekt).toEqual({ punkte: ["PVR"], ausnahmen: [{ pfad: "x", grund: "g" }] });
    expect(neu.kern).toEqual(quelle.kern);
    expect(sync.pruefeErgebnis(".github/sicherheitspruefung.json", eintraege, src, ziel, ergebnis)).toEqual([]);
  });
  test("Bezieher ohne Datei bekommt nur kern, den Projektschlüssel legt er selbst an", () => {
    const neu = JSON.parse(sync.wendeTeileAn(eintraege, src, null, {})) as Sollform;
    expect(Object.keys(neu)).toEqual(["kern"]);
  });
  test("pruefeErgebnis meldet einen veränderten Projektschlüssel", () => {
    const ziel = JSON.stringify({ kern: {}, projekt: { punkte: [] } });
    const kaputt = JSON.stringify({ kern: quelle.kern, projekt: { punkte: ["PVR"] } });
    expect(sync.pruefeErgebnis(".github/sicherheitspruefung.json", eintraege, src, ziel, kaputt).join()).toMatch(/Projektschlüssel 'projekt' wurde verändert/);
  });
});
