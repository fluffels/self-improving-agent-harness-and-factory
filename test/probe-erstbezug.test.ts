/* Probe-Erstbezug (factory#234): reine Teile (Füll-Block, Schrittliste, Urteil), Aufruf-Fehler und die Negativfälle der Kette (Budget, toter Kern-Verweis) gegen einen echten Klon. */
import { describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/probe-erstbezug.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as budgetRaw from "../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as releaseRaw from "../scripts/release-tag-lib.mjs";

type Schritt = { id: string; argv?: string[]; cwd: string; kritisch: boolean; art?: string };
type Io = Record<string, unknown>;
const P = raw as unknown as {
  PROBE_TAG: string;
  FIXTURE_PFAD: string;
  ZUSATZ_DATEIEN: string[];
  fuellAgentsMd: (a: { raum: number }) => string;
  projektdatei: (a: { pfad: string; text: string; raum: number; overlay?: Record<string, unknown> }) => string | null;
  fixturePfade: () => string[];
  kindUmgebung: (env: Record<string, string | undefined>) => Record<string, string | undefined>;
  teile: (b: string) => string[];
  probeSchritte: (a: { quelle: string; scratch: string; tag: string; sha: string }) => Schritt[];
  probeUrteil: (e: unknown) => { code: number; zeilen: string[] };
  messZeile: (t: string) => string | null;
  befehleErgaenzung: (t: string) => string;
  aufrufFehler: (argv: string[], io: Io) => { text?: string; quelle?: string; scratch?: string };
  baueFixture: (a: { von: string; ziel: string; raum: number; io: Io }) => void;
  fuehreSchritte: (s: Schritt[], io: Io) => { id: string; status: number | null }[];
  main: (argv: string[], io: Io) => { code: number; out: string; err: string };
  echteNaehte: (stdio?: string) => { istGitRepo: (p: string) => boolean; istLeer: (p: string) => boolean; kopf: (p: string) => string | null; lies: (p: string) => string | null; mitScratch: (s: string) => Io };
};
const B = budgetRaw as unknown as { KERN_BLOCK_BUDGET: number; PROJEKT_BLOCK_RAUM: number; kernBlockZeichen: (t: string, m: { start: string; ende: string }) => number | null; countChars: (t: string) => number };
const R = releaseRaw as unknown as { mechanischeSchritte: (q: string) => string[] };

const WURZEL = resolve(import.meta.dirname, "..");
const START = "<!-- factory-besitz:start kern -->";
const ENDE = "<!-- factory-besitz:ende kern -->";
const MARKER = { start: START, ende: ENDE };
const raumVon = (t: string): number => B.countChars(t) - (B.kernBlockZeichen(t, MARKER) as number);

const temp = <T>(fn: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), "probe-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("fuellAgentsMd", () => {
  /** Kleinster Raum, den das Gerüst zulässt. */
  const minRaum = (): number => {
    for (let raum = 0; ; raum++) {
      try {
        P.fuellAgentsMd({ raum });
        return raum;
      } catch {
        /* zu klein */
      }
    }
  };

  it("liefert für jeden Raum genau diese Zeichen außerhalb des Kern-Blocks", () => {
    const min = minRaum();
    for (const raum of [min, min + 1, min + 79, min + 80, min + 81, 1000, B.PROJEKT_BLOCK_RAUM]) {
      expect(raumVon(P.fuellAgentsMd({ raum }))).toBe(raum);
    }
  });

  it("wirft, wenn der Raum kleiner als das Gerüst ist oder keine ganze Zahl", () => {
    const min = minRaum();
    expect(() => P.fuellAgentsMd({ raum: min - 1 })).toThrow(/kleiner als das Gerüst/);
    expect(() => P.fuellAgentsMd({ raum: min + 0.5 })).toThrow(/kleiner als das Gerüst/);
  });

  it("trägt jeden Marker genau einmal, nur den Titel als Überschrift und keine Steuerbytes, Links oder CR", () => {
    const t = P.fuellAgentsMd({ raum: B.PROJEKT_BLOCK_RAUM });
    for (const m of [START, ENDE, "<!-- factory-projekt:start -->", "<!-- factory-projekt:ende -->"]) expect(t.split(m).length).toBe(2);
    expect(t.split("\n").filter((z) => z.startsWith("#"))).toEqual(["# AGENTS.md (Probe-Erstbezug)"]);
    expect(t).not.toContain("\r");
    expect(t).not.toMatch(/\]\(/);
    expect([...t].some((c) => c.charCodeAt(0) < 32 && c !== "\n")).toBe(false);
  });

  it("enthält kein Wort der Umschrift-Liste der Fixture", () => {
    const fixture = JSON.parse(readFileSync(join(WURZEL, P.FIXTURE_PFAD), "utf8")) as { sprache: { umschrift: string[] } };
    const t = P.fuellAgentsMd({ raum: B.PROJEKT_BLOCK_RAUM }).toLowerCase();
    for (const wort of fixture.sprache.umschrift) expect(t.includes(wort), wort).toBe(false);
  });
});

describe("projektdatei und fixturePfade", () => {
  it("AGENTS.md ist der Füll-Block, die Config die Fixture plus Overlay, package.json bekommt --passWithNoTests", () => {
    expect(P.projektdatei({ pfad: "AGENTS.md", text: "egal", raum: 3000 })).toBe(P.fuellAgentsMd({ raum: 3000 }));
    const cfg = P.projektdatei({ pfad: ".factory/projekt.json", text: '{"a":{"b":1,"c":2},"x":1}', raum: 0, overlay: { a: { b: 9 }, y: 2 } });
    expect(JSON.parse(cfg as string)).toEqual({ a: { b: 9, c: 2 }, x: 1, y: 2 });
    const pkg = JSON.parse(P.projektdatei({ pfad: "package.json", text: '{"name":"n","scripts":{"test":"vitest run","a":"b"}}', raum: 0 }) as string) as { name: string; scripts: Record<string, string> };
    expect(pkg.scripts.test).toBe("vitest run --passWithNoTests");
    expect(pkg.scripts.a).toBe("b");
    expect(pkg.name).toBe("n");
    expect((JSON.parse(P.projektdatei({ pfad: "package.json", text: '{"name":"n"}', raum: 0 }) as string) as { scripts: Record<string, string> }).scripts.test).toBe("vitest run --passWithNoTests");
  });

  it("die Config-Mischung ersetzt Nicht-Objekte, Arrays und null, statt sie zu verschmelzen; ohne Overlay bleibt die Fixture unverändert", () => {
    const cfg = (text: string, overlay?: Record<string, unknown>) => JSON.parse(P.projektdatei({ pfad: ".factory/projekt.json", text, raum: 0, overlay }) as string) as unknown;
    expect(cfg('{"a":"str"}', { a: { b: 1 } })).toEqual({ a: { b: 1 } });
    expect(cfg('{"l":{"x":1}}', { l: [1] })).toEqual({ l: [1] });
    expect(cfg('{"a":{"x":1}}', { a: null })).toEqual({ a: null });
    expect(cfg('{"x":1}')).toEqual({ x: 1 });
  });

  it("die Anker-Stubs baut die Probe nicht, jede andere Datei ist eine wörtliche Kopie", () => {
    expect(P.projektdatei({ pfad: "docs/referenz/befehle.md", text: "x", raum: 0 })).toBeNull();
    expect(P.projektdatei({ pfad: "docs/referenz/anlaufstellen.md", text: "x", raum: 0 })).toBeNull();
    expect(P.projektdatei({ pfad: "tsconfig.json", text: "wörtlich\r\n", raum: 0 })).toBe("wörtlich\r\n");
  });

  it("fixturePfade nennt AGENTS.md, die Config und die Zusatzdateien, aber keinen Stub", () => {
    const pfade = P.fixturePfade();
    expect(pfade).toContain("AGENTS.md");
    expect(pfade).toContain(".factory/projekt.json");
    for (const z of P.ZUSATZ_DATEIEN) expect(pfade).toContain(z);
    expect(pfade.some((p) => p.startsWith("docs/referenz/"))).toBe(false);
  });
});

describe("kindUmgebung", () => {
  it("entfernt Diff-Basis, Config-Überschreibungen und Vitest-Variablen, behält den Rest", () => {
    const aus = P.kindUmgebung({ FACTORY_DIFF_BASE: "a", FACTORY_PROJEKT_CONFIG: "b", FACTORY_PROJEKT_WURZEL: "c", VITEST: "true", VITEST_POOL_ID: "1", PATH: "/bin", FACTORY_ANDERES: "d" });
    expect(aus).toEqual({ PATH: "/bin", FACTORY_ANDERES: "d" });
  });
});

describe("teile", () => {
  it("zerlegt an beliebigem Leerraum ohne leere Wörter", () => {
    expect(P.teile("  npm   run\tx ")).toEqual(["npm", "run", "x"]);
  });
});

describe("probeSchritte", () => {
  const schritte = P.probeSchritte({ quelle: "/q", scratch: "/s", tag: "tag-x", sha: "abc123" });
  const ids = schritte.map((s) => s.id);

  it("fährt Klon, lokalen Tag, Fixture, Sync, Installation, die mechanischen Schritte und zuletzt verifyKompakt in dieser Reihenfolge", () => {
    expect(ids).toEqual(["klon", "klon-origin", "tag", "detach", "fixture", "fixture-init", "fixture-add", "fixture-commit", "sync-vorschau", "sync-tag", "befehle", "install", "lint-prune", "projektwerte", "docs-gen", "factorylinks", "verifyKompakt"]);
    expect(schritte.at(-1)?.argv).toEqual(["node", "scripts/gate-befehl.mjs", "verifyKompakt"]);
    expect(schritte.find((s) => s.id === "tag")?.argv).toEqual(["git", "-C", join("/s", "quelle"), "tag", "tag-x", "abc123"]);
    expect(schritte.find((s) => s.id === "sync-tag")?.argv?.slice(-2)).toEqual(["--tag", "tag-x"]);
    expect(schritte.find((s) => s.id === "sync-vorschau")?.argv?.slice(-2)).toEqual(["--entwurf", "--trocken"]);
  });

  it("enthält jeden mechanischen Update-Schritt aus UPDATE_SCHRITTE mit der Quelle des Scratch-Klons", () => {
    const erwartet = R.mechanischeSchritte(join("/s", "quelle"));
    const echt = schritte.filter((s) => ["lint-prune", "projektwerte", "docs-gen", "factorylinks"].includes(s.id)).map((s) => (s.argv as string[]).join(" "));
    expect(echt).toEqual(erwartet);
  });

  it("Aufbau, Sync und Installation sind kritisch (Abbruch), die mechanischen Schritte und verify nicht", () => {
    const kritisch = Object.fromEntries(schritte.map((s) => [s.id, s.kritisch]));
    for (const id of ["klon", "tag", "fixture", "sync-tag", "befehle", "install"]) expect(kritisch[id], id).toBe(true);
    for (const id of ["lint-prune", "projektwerte", "docs-gen", "factorylinks", "verifyKompakt"]) expect(kritisch[id], id).toBe(false);
  });

  it("schreibt nirgends: kein push, kein gh, kein --repo, nur ein lokaler Tag, origin nur entfernt", () => {
    const worte = schritte.flatMap((s) => s.argv ?? []);
    for (const verboten of ["push", "gh", "--repo", "pr", "issue"]) expect(worte, verboten).not.toContain(verboten);
    expect(worte.filter((w) => w === "origin")).toEqual(["origin"]);
    const klon = schritte.find((s) => s.id === "klon-origin")?.argv as string[];
    expect(klon.slice(-3)).toEqual(["remote", "remove", "origin"]);
  });

  it("der echte Checkout kommt nur im Klon-Schritt vor", () => {
    const mitQuelle = schritte.filter((s) => (s.argv ?? []).includes("/q")).map((s) => s.id);
    expect(mitQuelle).toEqual(["klon"]);
  });
});

describe("probeUrteil", () => {
  it("eine leere oder fehlende Ergebnisliste ist rot, nie übersprungen", () => {
    for (const leer of [[], undefined, null]) {
      const u = P.probeUrteil(leer);
      expect(u.code).toBe(1);
      expect(u.zeilen.join("\n")).toMatch(/kein Schritt/);
      expect(u.zeilen.join("\n")).not.toMatch(/übersprungen/i);
    }
  });

  it("grün nur, wenn alle Schritte 0 haben; jede rote Zeile nennt Schritt und Exit", () => {
    expect(P.probeUrteil([{ id: "a", status: 0 }, { id: "b", status: 0 }])).toEqual({ code: 0, zeilen: ["GRÜN: 2 Schritte ohne Fund"] });
    const rot = P.probeUrteil([{ id: "a", status: 0 }, { id: "check", status: 1 }, { id: "x", status: null }]);
    expect(rot.code).toBe(1);
    expect(rot.zeilen[0]).toBe("ROT check: Exit 1");
    expect(rot.zeilen[1]).toMatch(/^ROT x: Exit kein Exit/);
  });
});

describe("messZeile und befehleErgaenzung", () => {
  it("meldet Kern-Block, Raum und Gesamt gegen die Budgets, ohne Marker null", () => {
    const t = P.fuellAgentsMd({ raum: B.PROJEKT_BLOCK_RAUM });
    const z = P.messZeile(t) as string;
    expect(z).toContain(`Kern-Block ${B.kernBlockZeichen(t, MARKER)}`);
    expect(z).toContain(`Raum ${B.PROJEKT_BLOCK_RAUM} (Soll ${B.PROJEKT_BLOCK_RAUM})`);
    expect(z).toContain(`Budget ${B.KERN_BLOCK_BUDGET + B.PROJEKT_BLOCK_RAUM})`);
    expect(P.messZeile("ohne Marker")).toBeNull();
  });

  it("nennt jedes npm-Skript einmal, auch ohne scripts", () => {
    expect(P.befehleErgaenzung('{"scripts":{"a":"x","b:c":"y"}}')).toMatch(/`npm run a`\n- `npm run b:c`/);
    expect(P.befehleErgaenzung("{}")).not.toContain("npm run");
  });
});

describe("aufrufFehler und main", () => {
  const io = (s: Partial<{ git: boolean; leer: boolean; kopf: string | null }> = {}): Io => ({
    istGitRepo: () => s.git ?? true,
    istLeer: () => s.leer ?? true,
    kopf: () => (s.kopf === undefined ? "abc" : s.kopf),
    lies: () => null,
  });

  it("jeder Aufruf-Fehler ist Exit 2 mit Grund: Flag fehlt, Quelle kein Repo, Scratch nicht leer oder in der Quelle, Leerzeichen, HEAD nicht lesbar", () => {
    const f = (argv: string[], i: Io = io()) => P.main(argv, i);
    expect(f([]).code).toBe(2);
    expect(f(["--quelle", "/q"]).err).toMatch(/--scratch fehlt/);
    expect(f(["--scratch", "/s"]).err).toMatch(/--quelle fehlt/);
    expect(f(["--quelle", "/q", "--scratch", "/s", "--x"]).code).toBe(2);
    expect(f(["--quelle", "/q", "--scratch", "/s"], io({ git: false })).err).toMatch(/kein Git-Repo/);
    expect(f(["--quelle", "/q", "--scratch", "/s"], io({ leer: false })).err).toMatch(/nicht leer/);
    expect(f(["--quelle", "/q", "--scratch", "/q/unter"]).err).toMatch(/liegt in der Quelle/);
    expect(f(["--quelle", "/q", "--scratch", "/q"]).err).toMatch(/liegt in der Quelle/);
    expect(f(["--quelle", "/q x", "--scratch", "/s"]).err).toMatch(/Leerzeichen/);
    expect(f(["--quelle", "/q", "--scratch", "/s"], io({ kopf: null })).err).toMatch(/HEAD der Quelle/);
    expect(f(["--quelle", "/q", "--scratch", "/s"], io({ kopf: null })).code).toBe(2);
  });

  it("liegt der Scratch in der Quelle? Ein Ordner namens ..x darin zählt dazu, ein Nachbar und ein Elternordner nicht", () => {
    expect(P.aufrufFehler(["--quelle", "/q", "--scratch", "/q/..x"], io()).text).toMatch(/liegt in der Quelle/);
    expect(P.aufrufFehler(["--quelle", "/q", "--scratch", "/q/a/b"], io()).text).toMatch(/liegt in der Quelle/);
    expect(P.aufrufFehler(["--quelle", "/q", "--scratch", "/"], io()).text).toBeUndefined();
    expect(P.aufrufFehler(["--quelle", "/q", "--scratch", "/q2"], io()).text).toBeUndefined();
  });

  it("ein Scratch neben der Quelle ist gültig", () => {
    expect(P.aufrufFehler(["--quelle", "/q", "--scratch", "/qq"], io())).toEqual({ quelle: resolve("/q"), scratch: resolve("/qq") });
  });

  const fake = (status: (id: string) => number | null, gelaufen: string[]): Io => ({
    ...io(),
    lies: () => P.fuellAgentsMd({ raum: B.PROJEKT_BLOCK_RAUM }),
    mitScratch: () => ({
      melde: () => undefined,
      fuehre: (s: Schritt) => (gelaufen.push(s.id), status(s.id)),
      fixture: (s: Schritt) => (gelaufen.push(s.id), status(s.id)),
      befehle: (s: Schritt) => (gelaufen.push(s.id), status(s.id)),
    }),
  });

  it("alle Schritte laufen, grün endet nie als übersprungen; bei einem roten Gate Exit 1 mit dem Schritt", () => {
    const gruen: string[] = [];
    const g = P.main(["--quelle", "/q", "--scratch", "/s"], fake(() => 0, gruen));
    expect(g.code).toBe(0);
    expect(gruen.at(-1)).toBe("verifyKompakt");
    expect(g.out).toMatch(/GRÜN: 17 Schritte/);
    expect(g.out).not.toMatch(/übersprungen/i);
    const lief: string[] = [];
    const r = P.main(["--quelle", "/q", "--scratch", "/s"], fake((id) => (id === "verifyKompakt" ? 1 : 0), lief));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/ROT verifyKompakt: Exit 1/);
    expect(r.out).toMatch(/Messung Fixture-AGENTS.md/);
  });

  it("ein kritisches Rot bricht ab, ein Rot eines mechanischen Schritts nicht (alle Funde auf einmal)", () => {
    const a: string[] = [];
    const r = P.main(["--quelle", "/q", "--scratch", "/s"], fake((id) => (id === "sync-tag" ? 3 : 0), a));
    expect(r.code).toBe(1);
    expect(a.at(-1)).toBe("sync-tag");
    const b: string[] = [];
    const r2 = P.main(["--quelle", "/q", "--scratch", "/s"], fake((id) => (id === "docs-gen" ? 1 : 0), b));
    expect(r2.code).toBe(1);
    expect(b).toContain("verifyKompakt");
  });

  it("fehlt die AGENTS.md des Fixture-Projekts, steht das in der Ausgabe und das Urteil bleibt maßgeblich", () => {
    const e = { ...fake(() => 0, []), lies: () => null };
    const r = P.main(["--quelle", "/q", "--scratch", "/s"], e);
    expect(r.out).toMatch(/Messung nicht möglich/);
    expect(r.code).toBe(0);
  });
});

describe("fuehreSchritte und baueFixture", () => {
  it("meldet jeden Schritt und ruft für art die gleichnamige Naht", () => {
    const aufrufe: string[] = [];
    const io = { melde: (t: string) => aufrufe.push(t), fuehre: () => 0, fixture: () => (aufrufe.push("F"), 0), befehle: () => 0 };
    const e = P.fuehreSchritte([{ id: "a", argv: ["x"], cwd: "/", kritisch: true }, { id: "f", art: "fixture", cwd: "/", kritisch: true }], io);
    expect(e).toEqual([{ id: "a", status: 0 }, { id: "f", status: 0 }]);
    expect(aufrufe).toEqual(["--- a", "--- f", "F"]);
  });

  it("baueFixture schreibt die Projektdateien aus der Quelle, die Config aus der Fixture, nie einen Stub", () => {
    const geschrieben: Record<string, string> = {};
    const quelle: Record<string, string> = Object.fromEntries(P.fixturePfade().filter((p) => p !== "AGENTS.md").map((p) => [join("/von", p === ".factory/projekt.json" ? P.FIXTURE_PFAD : p), p === "package.json" ? '{"scripts":{}}' : p === ".factory/projekt.json" ? "{}" : `inhalt ${p}`]));
    P.baueFixture({ von: "/von", ziel: "/ziel", raum: 2000, io: { lies: (p: string) => quelle[p] ?? null, schreibe: (p: string, t: string) => (geschrieben[p] = t) } });
    expect(geschrieben[join("/ziel", "AGENTS.md")]).toBe(P.fuellAgentsMd({ raum: 2000 }));
    expect(geschrieben[join("/ziel", "tsconfig.json")]).toBe("inhalt tsconfig.json");
    expect(Object.keys(geschrieben).some((p) => p.includes("referenz"))).toBe(false);
  });

  it("baueFixture wirft, wenn eine Projektdatei in der Quelle fehlt", () => {
    expect(() => P.baueFixture({ von: "/von", ziel: "/ziel", raum: 2000, io: { lies: () => null, schreibe: () => undefined } })).toThrow(/fehlt in der Quelle/);
  });
});

describe("echte Nähte", () => {
  it("istGitRepo, istLeer und kopf lesen das Dateisystem", () => {
    temp((dir) => {
      const n = P.echteNaehte();
      expect(n.istGitRepo(dir)).toBe(false);
      expect(n.istGitRepo(join(dir, "gibtsnicht"))).toBe(false);
      expect(n.istLeer(join(dir, "gibtsnicht"))).toBe(true);
      expect(n.istLeer(dir)).toBe(true);
      writeFileSync(join(dir, "a"), "x");
      expect(n.istLeer(dir)).toBe(false);
      expect(n.lies(join(dir, "a"))).toBe("x");
      expect(n.lies(join(dir, "b"))).toBeNull();
      expect(n.kopf(dir)).toBeNull();
      spawnSync("git", ["init", "-q", "-b", "main", dir]);
      expect(n.istGitRepo(dir)).toBe(true);
      spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@e.invalid", "commit", "-q", "--allow-empty", "-m", "x"]);
      expect(n.kopf(dir)).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  it("die Schritte fixture und befehle melden einen Fehler auf stderr und liefern Exit 1; befehle ergänzt die Seite sonst", () => {
    temp((dir) => {
      const io = P.echteNaehte("ignore").mitScratch(join(dir, "s")) as { fixture: (s: unknown) => number; befehle: (s: unknown) => number };
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      try {
        expect(io.fixture({ cwd: join(dir, "b") })).toBe(1);
        expect(io.befehle({ cwd: join(dir, "b") })).toBe(1);
        expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/fehlt in der Quelle[\s\S]*ENOENT/);
      } finally {
        stderr.mockRestore();
      }
      mkdirSync(join(dir, "b", "docs", "referenz"), { recursive: true });
      writeFileSync(join(dir, "b", "docs", "referenz", "befehle.md"), "# Befehle\n");
      writeFileSync(join(dir, "b", "package.json"), '{"scripts":{"a":"x"}}');
      expect(io.befehle({ cwd: join(dir, "b") })).toBe(0);
      expect(readFileSync(join(dir, "b", "docs", "referenz", "befehle.md"), "utf8")).toBe("# Befehle\n\n## Befehle des Probe-Projekts\n\n- `npm run a`\n");
    });
  });

  it("das Skript endet bei einer Quelle ohne Projektdateien rot mit Exit 1 und nennt den Schritt (Direktaufruf, nie grün)", () => {
    temp((dir) => {
      const q = join(dir, "q");
      mkdirSync(q);
      spawnSync("git", ["init", "-q", "-b", "main", q]);
      spawnSync("git", ["-C", q, "-c", "user.name=t", "-c", "user.email=t@e.invalid", "commit", "-q", "--allow-empty", "-m", "x"]);
      const r = spawnSync(process.execPath, [join(WURZEL, "scripts", "probe-erstbezug.mjs"), "--quelle", q, "--scratch", join(dir, "s")], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stdout).toMatch(/--- klon[\s\S]*--- fixture[\s\S]*ROT fixture: Exit 1/);
      expect(r.stdout).not.toMatch(/übersprungen|GRÜN/i);
      expect(r.stderr).toMatch(/fehlt in der Quelle/);
    });
  });

  it("das Skript meldet Aufruf-Fehler als Exit 2 (Direktaufruf)", () => {
    const r = spawnSync(process.execPath, [join(WURZEL, "scripts", "probe-erstbezug.mjs")], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/--quelle fehlt/);
  });
});

/* Integration: echte Kette gegen einen Klon der Quelle (HEAD, ohne Netz), je Fall ein eigener Klon-Commit und Scratch. Ohne `install` und ohne verifyKompakt: das eine Gate per Skript im Fixture-Projekt. */
describe("Negativfälle der Kette (echter Klon)", () => {
  const TIMEOUT = 180_000;
  const git = (cwd: string, ...args: string[]): void => {
    const r = spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@e.invalid", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  const kern = (text: string): { vor: string; kern: string; nach: string } => {
    const a = text.indexOf(START);
    const b = text.indexOf(ENDE);
    return { vor: text.slice(0, a), kern: text.slice(a, b), nach: text.slice(b) };
  };

  /** Klon der Quelle mit einer Änderung an der AGENTS.md (`aender` bekommt den Text), als Commit. */
  const klon = (dir: string, aender: (t: string) => string): string => {
    const k = join(dir, "klon");
    spawnSync("git", ["clone", "-q", WURZEL, k], { encoding: "utf8" });
    const p = join(k, "AGENTS.md");
    writeFileSync(p, aender(readFileSync(p, "utf8")));
    git(k, "commit", "-q", "-a", "--allow-empty", "-m", "Sabotage");
    return k;
  };

  /** Fixture bis nach dem Sync und `projektwerte --write` bauen; → Pfad des Fixture-Projekts. */
  const bezieher = (dir: string, k: string, name: string): string => {
    const scratch = join(dir, name);
    const naehte = P.echteNaehte("ignore");
    const sha = naehte.kopf(k) as string;
    const alle = P.probeSchritte({ quelle: k, scratch, tag: P.PROBE_TAG, sha });
    const bis = alle.findIndex((s) => s.id === "projektwerte");
    const kette = alle.slice(0, bis + 1).filter((s) => s.id !== "install" && s.id !== "lint-prune");
    const io = { ...naehte.mitScratch(scratch), melde: () => undefined };
    const ergebnisse = P.fuehreSchritte(kette, io);
    expect(ergebnisse.filter((e) => e.status !== 0 && ["klon", "tag", "fixture", "sync-tag", "befehle"].includes(e.id))).toEqual([]);
    return join(scratch, "bezieher");
  };

  const lauf = (cwd: string, skript: string): { status: number | null; text: string } => {
    const r = spawnSync(process.execPath, [join(cwd, "scripts", skript)], { cwd, encoding: "utf8", timeout: 60_000 });
    return { status: r.status, text: `${r.stdout}${r.stderr}` };
  };

  it("Budget: der Kern ein Zeichen über dem Gesamtbudget macht check:contextsize rot, genau am Budget grün", { timeout: TIMEOUT }, () => {
    temp((dir) => {
      const messung = bezieher(dir, klon(dir, (t) => t), "s0");
      const text0 = readFileSync(join(messung, "AGENTS.md"), "utf8");
      const gesamt0 = B.countChars(text0);
      const gesamtBudget = B.KERN_BLOCK_BUDGET + B.PROJEKT_BLOCK_RAUM;
      expect(raumVon(text0)).toBe(B.PROJEKT_BLOCK_RAUM);
      expect(gesamt0).toBeLessThanOrEqual(gesamtBudget);
      const polster = gesamtBudget - gesamt0;
      const fuell = (n: number) => (t: string) => {
        const { vor, kern: k, nach } = kern(t);
        return `${vor}${k.replace(/\n$/, "")}${"x".repeat(n)}\n${nach}`;
      };
      const grenze = bezieher(dir, klon(join(dir, "g"), fuell(polster)), "s1");
      expect(B.countChars(readFileSync(join(grenze, "AGENTS.md"), "utf8"))).toBe(gesamtBudget);
      expect(lauf(grenze, "check-context-size.mjs").status).toBe(0);
      const drueber = bezieher(dir, klon(join(dir, "d"), fuell(polster + 1)), "s2");
      expect(B.countChars(readFileSync(join(drueber, "AGENTS.md"), "utf8"))).toBe(gesamtBudget + 1);
      const r = lauf(drueber, "check-context-size.mjs");
      expect(r.status).toBe(1);
      expect(r.text).toMatch(/✖ [^\n]*AGENTS\.md/);
    });
  });

  it("Toter Verweis: ein Kern-Link auf eine Überschrift, die nur im Projekt-Block der Fabrik steht, macht check:docdrift rot", { timeout: TIMEOUT }, () => {
    const agents = readFileSync(join(WURZEL, "AGENTS.md"), "utf8");
    const { kern: kernTeil, nach } = kern(agents);
    expect(kernTeil).not.toMatch(/^#+\s+Gates\s*$/m);
    expect(nach).toMatch(/^#+\s+Gates\s*$/m);
    temp((dir) => {
      const ohne = bezieher(dir, klon(dir, (t) => t), "s0");
      expect(lauf(ohne, "check-docdrift.mjs")).toMatchObject({ status: 0 });
      const k = klon(join(dir, "t"), (t) => t.replace(`\n${ENDE}`, `\n[Gates](#gates)\n${ENDE}`));
      const mit = bezieher(dir, k, "s1");
      const r = lauf(mit, "check-docdrift.mjs");
      expect(r.status).toBe(1);
      expect(r.text).toMatch(/Toter Anker[^\n]*#gates/);
    });
  });
});
