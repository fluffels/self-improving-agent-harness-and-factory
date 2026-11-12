import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { pruefeAudit } from "../scripts/projekt-config-bloecke.mjs";

const pruefe = pruefeAudit as (b: unknown) => string[];

describe("pruefeAudit (factory#395 L54)", () => {
  test("ohne Block, leere Liste und gültige Verzeichnisse: keine Fehler", () => {
    expect(pruefe(undefined)).toEqual([]);
    expect(pruefe({ verzeichnisse: [] })).toEqual([]);
    expect(pruefe({ verzeichnisse: ["frontend", "tools/web"] })).toEqual([]);
  });

  test.each(["/etc", "C:/x", "../x", "a/../b", "a\\b", ".", "", "  ", "a//b", "a/"])("lehnt %j ab", (p) => {
    expect(pruefe({ verzeichnisse: [p] }).join("\n")).toMatch(/audit\.verzeichnisse\[0\]/);
  });

  test("Nicht-Text, kein Objekt, unbekannter Schlüssel, fehlende Liste und Doppelte sind Fehler", () => {
    expect(pruefe({ verzeichnisse: [3] }).join("\n")).toMatch(/audit\.verzeichnisse\[0\] muss ein nicht-leerer/);
    for (const kein of [null, [], "x", 3]) expect(pruefe(kein).join("\n")).toMatch(/audit muss ein Objekt/);
    expect(pruefe({ verzeichnisse: [], extra: 1 }).join("\n")).toMatch(/audit\.extra ist kein bekannter Schlüssel/);
    expect(pruefe({}).join("\n")).toMatch(/audit\.verzeichnisse muss eine Liste/);
    expect(pruefe({ verzeichnisse: "frontend" }).join("\n")).toMatch(/audit\.verzeichnisse muss eine Liste/);
    expect(pruefe({ verzeichnisse: ["a", "a"] }).join("\n")).toMatch(/audit\.verzeichnisse enthält a doppelt/);
    expect(pruefe({ verzeichnisse: ["a", "a", "a"] })).toEqual(["audit.verzeichnisse enthält a doppelt"]);
    expect(pruefe({ verzeichnisse: [3, 3] }).join("\n")).not.toMatch(/doppelt/);
  });
});

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawV from "../scripts/audit-verzeichnisse.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/audit-verzeichnisse-lib.mjs";

type Fuehre = (prog: string, args: string[], opts: { cwd: string; stdio?: string }) => string;
const NpmJson = rawLib as unknown as { npmAuditJson: (v: string, extra: string[], deps: { fuehreAus: Fuehre; wurzel: string }) => unknown };

describe("npmAuditJson", () => {
  const ok = JSON.stringify({ vulnerabilities: {} });
  test("liest JSON von stdout, cwd ist Wurzel/Verzeichnis, extra wird angehängt", () => {
    const gerufen: { args: string[]; cwd: string }[] = [];
    const fuehreAus: Fuehre = (_p, args, opts) => (gerufen.push({ args, cwd: opts.cwd }), ok);
    expect(NpmJson.npmAuditJson("frontend", ["--omit=dev"], { fuehreAus, wurzel: "/w" })).toEqual({ vulnerabilities: {} });
    expect(gerufen[0]).toEqual({ args: ["audit", "--json", "--omit=dev"], cwd: "/w/frontend" });
  });
  test("Exit 1 mit stdout (Funde) liefert das JSON, ohne stdout wirft der Fehler", () => {
    const mitFunden: Fuehre = () => { throw Object.assign(new Error("exit 1"), { stdout: ok }); };
    const ohne: Fuehre = () => { throw new Error("npm fehlt"); };
    expect(NpmJson.npmAuditJson(".", [], { fuehreAus: mitFunden, wurzel: "/w" })).toEqual({ vulnerabilities: {} });
    expect(() => NpmJson.npmAuditJson(".", [], { fuehreAus: ohne, wurzel: "/w" })).toThrow("npm fehlt");
  });
});

const LaufLib = rawLib as unknown as { npmAuditLauf: (v: string, args: string[], deps: { fuehreAus: Fuehre; wurzel: string }) => number };

describe("npmAuditLauf (Standard-Lauf des CI-Gates)", () => {
  const mit = (f: (...a: Parameters<Fuehre>) => string) => LaufLib.npmAuditLauf("frontend", ["--audit-level=high"], { fuehreAus: f, wurzel: "/w" });
  test("npm Exit 0: 0; cwd ist Wurzel/Verzeichnis, Argumente beginnen mit audit", () => {
    const gerufen: { args: string[]; cwd: string; stdio?: string }[] = [];
    expect(mit((_p, args, o) => (gerufen.push({ args, cwd: o.cwd, stdio: o.stdio }), ""))).toBe(0);
    expect(gerufen[0]).toEqual({ args: ["audit", "--audit-level=high"], cwd: "/w/frontend", stdio: "inherit" });
  });
  test("npm Exit 1 bleibt 1, Exit 5 bleibt 5", () => {
    expect(mit(() => { throw Object.assign(new Error("x"), { status: 1 }); })).toBe(1);
    expect(mit(() => { throw Object.assign(new Error("x"), { status: 5 }); })).toBe(5);
  });
  test("fail-closed: Signal (status null), Status 0 im Fehler oder nicht startbar zählt als 1", () => {
    expect(mit(() => { throw Object.assign(new Error("sig"), { status: null }); })).toBe(1);
    expect(mit(() => { throw Object.assign(new Error("x"), { status: 0 }); })).toBe(1);
    expect(mit(() => { throw new Error("ENOENT"); })).toBe(1);
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- genau dieser Wurf (kein Error-Objekt) ist der Testfall
    expect(mit(() => { throw undefined; })).toBe(1);
  });
});

type Lauf = (verzeichnis: string, args: string[]) => number;
const V = rawV as unknown as {
  main: (argv: string[], deps: { ladeConfig: () => unknown; fuehreAus: Lauf; log: (t: string) => void; err: (t: string) => void }) => number;
};

const V2 = rawLib as unknown as { auditVerzeichnisse: (config: unknown) => string[] };

describe("auditVerzeichnisse", () => {
  test("ohne Block nur die Wurzel, mit Block Wurzel plus Verzeichnisse", () => {
    expect(V2.auditVerzeichnisse({})).toEqual(["."]);
    expect(V2.auditVerzeichnisse(undefined)).toEqual(["."]);
    expect(V2.auditVerzeichnisse({ audit: { verzeichnisse: [] } })).toEqual(["."]);
    expect(V2.auditVerzeichnisse({ audit: { verzeichnisse: ["frontend"] } })).toEqual([".", "frontend"]);
  });
});

describe("main (npm audit je Verzeichnis)", () => {
  const lauf = (codes: Record<string, number>, config: unknown = { audit: { verzeichnisse: ["frontend"] } }) => {
    const gerufen: string[][] = [];
    const log: string[] = [];
    const fuehreAus: Lauf = (v, args) => {
      gerufen.push([v, ...args]);
      return codes[v] ?? 0;
    };
    const run = (argv: string[]) => V.main(argv, { ladeConfig: () => config, fuehreAus, log: (t) => log.push(t), err: (t) => log.push(t) });
    return { run, gerufen, log };
  };

  test("Wurzel grün, frontend rot: Exit 1, beide Verzeichnisse geprüft", () => {
    const l = lauf({ ".": 0, frontend: 1 });
    expect(l.run(["--audit-level", "high"])).toBe(1);
    expect(l.gerufen.map((g) => g[0])).toEqual([".", "frontend"]);
    expect(l.gerufen[1]).toContain("--audit-level=high");
    expect(l.log).toContain("✖ Advisories ab high in: frontend");
  });

  test("Wurzel rot bricht nicht ab: auch frontend läuft", () => {
    const l = lauf({ ".": 1 });
    expect(l.run(["--audit-level", "high"])).toBe(1);
    expect(l.gerufen).toHaveLength(2);
  });

  test("alle grün: Exit 0; ohne Block nur die Wurzel", () => {
    expect(lauf({}).run(["--audit-level", "high"])).toBe(0);
    const ohne = lauf({}, {});
    expect(ohne.run(["--audit-level", "critical"])).toBe(0);
    expect(ohne.gerufen.map((g) => g[0])).toEqual(["."]);
  });

  test.each([[[]], [["--audit-level"]], [["--audit-level", "sehr-hoch"]], [["--audit-level", "high", "extra"]]])("falsche Bedienung %j: Exit 2, kein npm-Aufruf", (argv) => {
    const l = lauf({});
    expect(l.run(argv)).toBe(2);
    expect(l.gerufen).toEqual([]);
  });

  test("nicht lesbare Config: Exit 2", () => {
    const fuehreAus: Lauf = () => 0;
    const log: string[] = [];
    const code = V.main(["--audit-level", "high"], { ladeConfig: () => { throw new Error("kaputt"); }, fuehreAus, log: (t) => log.push(t), err: (t) => log.push(t) });
    expect(code).toBe(2);
    expect(log.join("\n")).toMatch(/kaputt/);
  });
});
