/* Sicherheits-Module im Sync (factory#119): planeSync verteilt eine Einheit mit `modul` nur, wenn die Ziel-Config das Modul wählt.
 * Pur über Speicher-Leser; die Ziel-Config entsteht in einem Temp-Ordner und läuft durch `ladeProjektConfig` (inklusive Formprüfung). */
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSync from "../scripts/factory-sync.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawPc from "../scripts/projekt-config-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../scripts/check-factory-drift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../scripts/besitz-lib.mjs";

interface Plan {
  fehler: string[];
  meldungen: string[];
  dateien: Map<string, { text: string; neu: boolean }>;
  stand: { einheiten: Record<string, string> } | null;
}
interface PlanArgs {
  quelleLies(p: string): string | null;
  zielLies(p: string): string | null;
  zielConfig(): unknown;
}
const sync = rawSync as unknown as { planeSync(a: PlanArgs): Plan };
const pc = rawPc as unknown as { ladeProjektConfig(o: { rootDir: string }): unknown; ROLLEN_PFADE: Record<string, string>; PROJEKT_ROLLEN: string[] };

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ROLLEN = Object.entries(pc.ROLLEN_PFADE).filter(([r]) => !pc.PROJEKT_ROLLEN.includes(r)).map(([, p]) => p);
const CODEQL = ".github/workflows/codeql.yml";
const ZIZMOR = ".github/workflows/zizmor.yml";
const DEPENDABOT = ".github/workflows/dependabot-inbox.yml";
const MANIFEST = {
  version: 3,
  eintraege: [
    ...ROLLEN.map((pfad) => ({ pfad, ring: "kern", quelle: "t" })),
    { pfad: "scripts/a.mjs", ring: "kern", quelle: "t" },
    { pfad: CODEQL, ring: "kern", modul: "codeql", quelle: "t" },
    { pfad: ZIZMOR, ring: "kern", modul: "zizmor", quelle: "t" },
    { pfad: DEPENDABOT, ring: "kern", modul: "dependabot-inbox", quelle: "t" },
  ],
};
const QUELLE: Record<string, string> = {
  ".factory/besitz.json": JSON.stringify(MANIFEST, null, 2) + "\n",
  "scripts/a.mjs": "export const a = 1;\n",
  [CODEQL]: "m:\n# factory:projektwert codeql.sprachen\n  language: [alt]\n",
  [ZIZMOR]: "name: zizmor\n",
  [DEPENDABOT]: "name: dependabot\n",
  ...Object.fromEntries(ROLLEN.map((p) => [p, "rolle\n"])),
};

/** Ziel-Ordner mit der echten Config dieses Repos, Schlüssel `module` und `codeql` nach Bedarf ersetzt. */
function zielOrdner(aendere: (c: Record<string, unknown>) => void): string {
  const z = mkdtempSync(join(tmpdir(), "fsmod-"));
  temps.push(z);
  const c = JSON.parse(readFileSync(join(WURZEL, ".factory/projekt.json"), "utf8")) as Record<string, unknown>;
  c.repo = "acme/demo";
  delete c.berechtigungen;
  delete c.sandbox;
  delete c.module;
  delete c.codeql;
  aendere(c);
  mkdirSync(join(z, ".factory"), { recursive: true });
  writeFileSync(join(z, ".factory/projekt.json"), JSON.stringify(c, null, 2) + "\n");
  return z;
}
function plane(aendere: (c: Record<string, unknown>) => void, ziel: Record<string, string> = {}): Plan {
  const z = zielOrdner(aendere);
  return sync.planeSync({ quelleLies: (p) => QUELLE[p] ?? null, zielLies: (p) => ziel[p] ?? null, zielConfig: () => pc.ladeProjektConfig({ rootDir: z }) });
}
const namen = (p: Plan): string[] => [...p.dateien.keys()].filter((k) => k.startsWith(".github/")).sort();

describe("planeSync und Sicherheits-Module", () => {
  test("(z) Negativfall e2e-Profil (factory#246): eine Config ohne e2e erzeugt keine Meldung und keine e2e-Datei", () => {
    const p = plane(() => undefined);
    expect(p.fehler).toEqual([]);
    expect(p.meldungen.join("\n")).not.toMatch(/e2e/i);
    expect([...p.dateien.keys()].filter((k) => /e2e/i.test(k))).toEqual([]);
  });
  test("(a) ohne Schlüssel module gilt der Standard: nur dependabot-inbox", () => {
    const p = plane(() => undefined);
    expect(p.fehler).toEqual([]);
    expect(namen(p)).toEqual([DEPENDABOT]);
    expect(p.meldungen.join("\n")).toContain("Module: gewählt dependabot-inbox; nicht gewählt codeql, zizmor");
    expect(p.dateien.has("scripts/a.mjs")).toBe(true);
  });
  test("(a2) liegt im Ziel eine Datei am Pfad einer nicht gewählten Moduleinheit, kommt ein Hinweis (kein Fehler, nichts geschrieben)", () => {
    const p = plane(() => undefined, { [CODEQL]: "eigene Kopie\n" });
    expect(p.fehler).toEqual([]);
    expect(p.meldungen.join("\n")).toContain(`Modul 'codeql' nicht gewählt, im Ziel liegt ${CODEQL} (Modulkopie): Modul wählen, Datei löschen oder in modulKopien (.factory/projekt.json) mit Grund führen`);
    expect(p.meldungen.join("\n")).not.toContain(`im Ziel liegt ${ZIZMOR}`);
    expect(p.dateien.has(CODEQL)).toBe(false);
  });
  test("(a2b) eine begründete Modulkopie erzeugt keinen Hinweis, eine andere weiter", () => {
    const p = plane((c) => {
      c.modulKopien = [{ datei: CODEQL, grund: "bewusst eigene Fassung" }];
    }, { [CODEQL]: "eigene Kopie\n", [ZIZMOR]: "auch eine\n" });
    expect(p.fehler).toEqual([]);
    expect(p.meldungen.join("\n")).not.toContain(`im Ziel liegt ${CODEQL}`);
    expect(p.meldungen.join("\n")).toContain(`im Ziel liegt ${ZIZMOR}`);
  });
  test("(a3) ein gewähltes Modul mit Zieldatei gibt keinen Hinweis", () => {
    const p = plane((c) => {
      c.module = ["zizmor"];
    }, { [ZIZMOR]: "alt\n" });
    expect(p.meldungen.join("\n")).not.toContain("im Ziel liegt");
  });
  test("(b) eine Teilauswahl verteilt genau die gewählten Moduleinheiten", () => {
    const p = plane((c) => {
      c.module = ["zizmor"];
    });
    expect(p.fehler).toEqual([]);
    expect(namen(p)).toEqual([ZIZMOR]);
    expect(Object.keys(p.stand?.einheiten ?? {})).not.toContain(CODEQL);
  });
  test("(b2) eine leere Wahl ist gültig und verteilt kein Modul", () => {
    const p = plane((c) => {
      c.module = [];
    });
    expect(p.fehler).toEqual([]);
    expect(namen(p)).toEqual([]);
    expect(p.meldungen.join("\n")).toContain("gewählt keine");
  });
  test("(c) ein unbekannter Name ist ein Fehler mit Fix, geschrieben wird nichts", () => {
    const p = plane((c) => {
      c.module = ["gibtsnicht"];
    });
    expect(p.fehler.join("\n")).toMatch(/gibtsnicht.*Fix:/s);
    expect(p.dateien.size).toBe(0);
  });
  test("(d) codeql.sprachen wird als Flow-Liste in den Workflow gerendert", () => {
    const p = plane((c) => {
      c.module = ["codeql"];
      c.codeql = { sprachen: ["python"] };
    });
    expect(p.fehler).toEqual([]);
    expect(p.dateien.get(CODEQL)?.text).toContain("  language: [python]");
  });
  test("(e) Negativfall: codeql gewählt ohne Sprachen ist ein Config-Fehler mit Fix und liefert keinen Workflow", () => {
    for (const aendere of [
      (c: Record<string, unknown>) => {
        c.module = ["codeql"];
      },
      (c: Record<string, unknown>) => {
        c.module = ["codeql"];
        c.codeql = { sprachen: [] };
      },
    ]) {
      const p = plane(aendere);
      expect(p.fehler.join("\n")).toMatch(/Ziel-Config: .*codeql\.sprachen.*Fix:/s);
      expect(p.dateien.has(CODEQL)).toBe(false);
    }
  });
  test("(f) ein abgewähltes Modul im alten Stand ergibt eine Meldung, nichts wird gelöscht", () => {
    const stand = JSON.stringify({ version: 2, quelle: { commit: "0".repeat(40), tag: "v1", sauber: true }, manifest: "x", einheiten: { [CODEQL]: "sha256:00" } });
    const p = plane((c) => {
      c.module = [];
    }, { ".factory/sync-stand.json": stand });
    expect(p.fehler).toEqual([]);
    expect(p.meldungen.join("\n")).toContain(`Modul 'codeql' nicht gewählt (Einheit '${CODEQL}'), im Ziel nicht gelöscht`);
    expect(p.dateien.has(CODEQL)).toBe(false);
  });
  test("eine nicht lesbare Ziel-Config ist ein Fehler, kein stilles Verteilen aller Module", () => {
    const p = sync.planeSync({
      quelleLies: (q) => QUELLE[q] ?? null,
      zielLies: () => null,
      zielConfig: () => {
        throw new Error("kaputt");
      },
    });
    expect(p.fehler).toEqual(["Ziel-Config: kaputt"]);
    expect(p.dateien.size).toBe(0);
  });
  test("ein Manifest ohne modul-Einträge liest die Ziel-Config nicht", () => {
    const m = { version: 2, eintraege: MANIFEST.eintraege.filter((e) => !("modul" in e)) };
    const p = sync.planeSync({
      quelleLies: (q) => (q === ".factory/besitz.json" ? JSON.stringify(m) : (QUELLE[q] ?? null)),
      zielLies: () => null,
      zielConfig: () => {
        throw new Error("nicht rufen");
      },
    });
    expect(p.fehler).toEqual([]);
    expect(p.meldungen.join("\n")).not.toContain("Module:");
  });
});


// ── Drift-Gate ────────────────────────────────────────────────────────────────
const drift = rawDrift as unknown as { pruefeDrift(lies: (p: string) => string | null): { fehler: string[]; einheiten: number } };
const besitz = rawBesitz as unknown as { einheitHash(e: unknown, t: string): string; einheitId(e: unknown): string; textHash(t: string): string };
const mitModul = MANIFEST.eintraege.filter((e) => e.pfad.startsWith(".github/"));

/** Projekt-Dateien mit passendem Sync-Stand über `einheiten`; `config` ist der Text der Projekt-Config (`null` = fehlt). Moduldateien außerhalb von `einheiten` fehlen im Projekt, außer `kopien` (factory#244: dann liegen sie als Modulkopie da). */
function projekt(config: string | null, einheiten = mitModul, kopien = false): (p: string) => string | null {
  const dateien: Record<string, string> = { ...QUELLE };
  if (!kopien) for (const e of mitModul.filter((m) => !einheiten.includes(m))) delete dateien[e.pfad];
  const stand = { version: 2, quelle: { commit: "0".repeat(40), tag: "v1", sauber: true }, manifest: besitz.textHash(QUELLE[".factory/besitz.json"]), einheiten: Object.fromEntries([...MANIFEST.eintraege.filter((e) => !e.pfad.startsWith(".github/")), ...einheiten].map((e) => [besitz.einheitId(e), besitz.einheitHash(e, dateien[e.pfad] ?? "")])) };
  dateien[".factory/sync-stand.json"] = JSON.stringify(stand);
  if (config !== null) dateien[".factory/projekt.json"] = config;
  return (p) => dateien[p] ?? null;
}
const cfg = (c: Record<string, unknown>): string => JSON.stringify(c);

describe("Drift-Gate und Sicherheits-Module", () => {
  test("ein nicht gewähltes Modul ohne Stand-Eintrag ist kein Fehler; ein Projektwert-Marker in YAML ändert den Hash nicht", () => {
    const r = drift.pruefeDrift(projekt(cfg({ module: ["codeql", "dependabot-inbox"], codeql: { sprachen: ["python"] } }), mitModul.filter((e) => e.pfad !== ZIZMOR)));
    expect(r.fehler).toEqual([]);
  });
  test("Standard ohne Schlüssel module: nur dependabot-inbox muss im Stand stehen", () => {
    expect(drift.pruefeDrift(projekt(cfg({}), mitModul.filter((e) => e.pfad === DEPENDABOT))).fehler).toEqual([]);
  });
  test("ein gewähltes Modul, das nicht im Stand steht, ist rot", () => {
    const r = drift.pruefeDrift(projekt(cfg({ module: ["zizmor", "dependabot-inbox"] }), mitModul.filter((e) => e.pfad === DEPENDABOT)));
    expect(r.fehler.join("\n")).toContain(`${ZIZMOR}: im Manifest, aber nicht im Sync-Stand`);
  });
  test("eine Stand-Einheit eines abgewählten Moduls ist rot mit Weg", () => {
    const r = drift.pruefeDrift(projekt(cfg({ module: ["dependabot-inbox"] })));
    const f = r.fehler.join("\n");
    expect(f).toContain(`${ZIZMOR}: im Sync-Stand, Modul 'zizmor' ist aber nicht gewählt`);
    expect(f).toContain("Weg:");
    expect(r.fehler).toHaveLength(2);
  });
  describe("Modulkopien (factory#244)", () => {
    const nurDep = mitModul.filter((e) => e.pfad === DEPENDABOT);
    const grund = { datei: ZIZMOR, grund: "Projekt führt den Workflow selbst" };
    const lauf = (c: Record<string, unknown>, einheiten = nurDep) => drift.pruefeDrift(projekt(cfg(c), einheiten, true)).fehler;
    test("eine Kopie ohne Grund ist rot und nennt die drei Wege", () => {
      const f = lauf({});
      expect(f.filter((m) => m.includes(ZIZMOR))).toHaveLength(1);
      const m = f.join("\n");
      expect(m).toContain("Modulkopie");
      expect(m).toContain("Modul in module wählen");
      expect(m).toContain("--uebernehmen");
      expect(m).toContain("Datei löschen");
      expect(m).toContain("modulKopien");
    });
    test("mit Grund in modulKopien ist es grün", () => {
      expect(lauf({ modulKopien: [grund, { datei: CODEQL, grund: "ebenso" }] })).toEqual([]);
    });
    test("kein Befund, wenn die Datei fehlt", () => {
      expect(drift.pruefeDrift(projekt(cfg({}), nurDep, false)).fehler).toEqual([]);
    });
    test("veraltete Einträge sind rot: Modul gewählt, keine Moduleinheit, Datei fehlt", () => {
      const gewaehlt = lauf({ module: ["zizmor", "dependabot-inbox"], modulKopien: [grund] }, mitModul.filter((e) => e.pfad !== CODEQL));
      expect(gewaehlt.join("\n")).toContain(`modulKopien nennt ${ZIZMOR}, das Modul ist aber gewählt`);
      expect(lauf({ modulKopien: [{ datei: "scripts/a.mjs", grund: "x" }] }).join("\n")).toContain("gehört zu keiner Moduleinheit");
      const fehlt = drift.pruefeDrift(projekt(cfg({ modulKopien: [{ datei: CODEQL, grund: "x" }] }), nurDep, false)).fehler;
      expect(fehlt.join("\n")).toContain(`modulKopien nennt ${CODEQL}, die Datei fehlt`);
    });
    test("eine abgewählte Stand-Einheit wird genau einmal gemeldet (kein zusätzlicher Kopien-Befund)", () => {
      const f = drift.pruefeDrift(projekt(cfg({ module: ["dependabot-inbox"] }), mitModul, true)).fehler;
      expect(f.filter((m) => m.includes(ZIZMOR))).toHaveLength(1);
    });
    test("ein Formfehler in modulKopien ist rot über Modul-Wahl, ohne zusätzliche Kopien-Befunde", () => {
      const f = lauf({ modulKopien: [{ datei: ZIZMOR, grund: "" }] });
      expect(f.join("\n")).toMatch(/Modul-Wahl: modulKopien\[0\]\.grund.*Fix:/s);
      expect(f.join("\n")).not.toContain("Modulkopie (Projektdatei");
      expect(f.filter((m) => m.includes(ZIZMOR) && !m.startsWith("Modul-Wahl"))).toEqual([]);
    });
  });
  test("ein unbekannter Name ist rot mit Fix", () => {
    expect(drift.pruefeDrift(projekt(cfg({ module: ["gibtsnicht", "zizmor", "codeql"], codeql: { sprachen: ["a"] } }))).fehler.join("\n")).toMatch(/Modul-Wahl: .*gibtsnicht.*Fix:/s);
  });
  test("eine unbestimmbare Wahl meldet auch bei einem Stand ohne Moduleinheiten nur den einen Fehler", () => {
    const f = drift.pruefeDrift(projekt("{kaputt", mitModul.filter((e) => e.pfad === DEPENDABOT))).fehler;
    expect(f).toHaveLength(1);
    expect(f[0]).toContain("Modul-Auswahl nicht bestimmbar");
  });
  test("ein Formfehler der Wahl ist rot mit Fix (module keine Liste, codeql ohne Sprachen)", () => {
    expect(drift.pruefeDrift(projekt(cfg({ module: "zizmor" }))).fehler.join("\n")).toMatch(/Modul-Wahl: module muss eine Liste.*Fix:/s);
    expect(drift.pruefeDrift(projekt(cfg({ module: ["codeql", "zizmor", "dependabot-inbox"] }))).fehler.join("\n")).toMatch(/Modul-Wahl: .*codeql\.sprachen.*Fix:/s);
  });
  test("eine kaputte oder fehlende Config ergibt genau einen Fehler, keinen je Einheit", () => {
    for (const config of ["{kaputt", null, "[]x", "[]", "5", "null"]) {
      const f = drift.pruefeDrift(projekt(config)).fehler;
      expect(f).toHaveLength(1);
      expect(f[0]).toContain("Modul-Auswahl nicht bestimmbar");
    }
  });
});
