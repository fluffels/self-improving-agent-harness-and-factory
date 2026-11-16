/* Besitz-Profil im Sync (factory#519): planeSync verteilt eine Einheit mit `profil: "voll"` nur bei Profil voll (Standard), nie bei minimal.
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
  quelleStand?: { commit: string; tag: string; sauber: boolean };
}
const sync = rawSync as unknown as { planeSync(a: PlanArgs): Plan };
const pc = rawPc as unknown as { ladeProjektConfig(o: { rootDir: string }): unknown; ROLLEN_PFADE: Record<string, string>; PROJEKT_ROLLEN: string[] };
const drift = rawDrift as unknown as { pruefeDrift(lies: (p: string) => string | null): { fehler: string[]; einheiten: number } };

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
const temps: string[] = [];
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ROLLEN = Object.entries(pc.ROLLEN_PFADE).filter(([r]) => !pc.PROJEKT_ROLLEN.includes(r)).map(([, p]) => p);
const HOOK = "scripts/pretooluse-hook.mjs";
const VOLL = "scripts/cockpit.mjs";
const MANIFEST = {
  version: 3,
  eintraege: [
    ...ROLLEN.map((pfad) => ({ pfad, ring: "kern", quelle: "t" })),
    { pfad: HOOK, ring: "kern", quelle: "t" },
    { pfad: VOLL, ring: "kern", profil: "voll", quelle: "t" },
  ],
};
const QUELLE: Record<string, string> = {
  ".factory/besitz.json": JSON.stringify(MANIFEST, null, 2) + "\n",
  [HOOK]: "export const h = 1;\n",
  [VOLL]: "export const v = 1;\n",
  ...Object.fromEntries(ROLLEN.map((p) => [p, "rolle\n"])),
};

function configText(aendere: (c: Record<string, unknown>) => void): string {
  const c = JSON.parse(readFileSync(join(WURZEL, ".factory/projekt.json"), "utf8")) as Record<string, unknown>;
  c.repo = "acme/demo";
  delete c.berechtigungen;
  delete c.sandbox;
  delete c.module;
  delete c.codeql;
  delete c.profil;
  aendere(c);
  return JSON.stringify(c, null, 2) + "\n";
}
function zielOrdner(aendere: (c: Record<string, unknown>) => void): string {
  const z = mkdtempSync(join(tmpdir(), "fsprofil-"));
  temps.push(z);
  mkdirSync(join(z, ".factory"), { recursive: true });
  writeFileSync(join(z, ".factory/projekt.json"), configText(aendere));
  return z;
}
function plane(aendere: (c: Record<string, unknown>) => void, ziel: Record<string, string> = {}): Plan {
  const z = zielOrdner(aendere);
  return sync.planeSync({ quelleLies: (p) => QUELLE[p] ?? null, zielLies: (p) => ziel[p] ?? null, zielConfig: () => pc.ladeProjektConfig({ rootDir: z }), quelleStand: { commit: "abc", tag: "v1", sauber: true } });
}
/** Schreibt einen Plan in eine Dateimenge (Pfad -> Text), wie der Sync es im Ziel täte. */
const anwenden = (p: Plan, basis: Record<string, string>): Record<string, string> => ({ ...basis, ...Object.fromEntries([...p.dateien].map(([k, v]) => [k, v.text])) });

describe("planeSync und Besitz-Profil", () => {
  test("ohne Schlüssel profil gilt voll: die Einheit wird verteilt", () => {
    const p = plane(() => undefined);
    expect(p.fehler).toEqual([]);
    expect(p.dateien.has(VOLL)).toBe(true);
    expect(p.dateien.has(HOOK)).toBe(true);
    expect(p.meldungen.join("\n")).not.toContain("Profil:");
  });
  test("profil minimal verteilt keine voll-Einheit und führt sie nicht im Sync-Stand, der Hook bleibt", () => {
    const p = plane((c) => {
      c.profil = "minimal";
    });
    expect(p.fehler).toEqual([]);
    expect(p.dateien.has(VOLL)).toBe(false);
    expect(p.dateien.has(HOOK)).toBe(true);
    expect(Object.keys(p.stand?.einheiten ?? {})).not.toContain(VOLL);
    expect(Object.keys(p.stand?.einheiten ?? {})).toContain(HOOK);
  });
  test("ein unbekannter Profilname ist ein Fehler mit Fix, geschrieben wird nichts", () => {
    const p = plane((c) => {
      c.profil = "klein";
    });
    expect(p.fehler.join("\n")).toMatch(/profil.*Fix:/s);
    expect(p.dateien.size).toBe(0);
  });
  test("Wechsel voll auf minimal löscht nichts und meldet einen Hinweis", () => {
    const voll = plane(() => undefined);
    const ziel = anwenden(voll, {});
    const p = plane((c) => {
      c.profil = "minimal";
    }, ziel);
    expect(p.fehler).toEqual([]);
    expect(p.meldungen.join("\n")).toContain(`Profil minimal: ${VOLL} ist kein Besitz mehr`);
    expect(p.dateien.has(VOLL)).toBe(false);
  });
  test("Drift: minimal ohne voll-Datei grün, ohne Schlüssel rot (AK3), fehlender Hook bei minimal rot (AK4)", () => {
    const minimal = (c: Record<string, unknown>) => void (c.profil = "minimal");
    const p = plane(minimal);
    const dateien: Record<string, string> = { ...anwenden(p, {}), ".factory/projekt.json": configText(minimal) };
    const lies = (d: Record<string, string>) => (pfad: string): string | null => d[pfad] ?? null;
    expect(drift.pruefeDrift(lies(dateien)).fehler).toEqual([]);
    const ohneSchluessel = { ...dateien, ".factory/projekt.json": configText(() => undefined) };
    expect(drift.pruefeDrift(lies(ohneSchluessel)).fehler.join("\n")).toContain(`${VOLL}: im Manifest, aber nicht im Sync-Stand`);
    const { [HOOK]: _weg, ...ohneHook } = dateien;
    expect(drift.pruefeDrift(lies(ohneHook)).fehler.join("\n")).toContain(`${HOOK}: Besitz fehlt`);
  });
  test("Drift: eine voll-Einheit im Sync-Stand bei Profil minimal ist rot mit Weg (neu syncen)", () => {
    const voll = plane(() => undefined);
    const dateien: Record<string, string> = { ...anwenden(voll, {}), ".factory/projekt.json": configText((c) => void (c.profil = "minimal")) };
    const f = drift.pruefeDrift((pfad) => dateien[pfad] ?? null).fehler.join("\n");
    expect(f).toContain(`${VOLL}: im Sync-Stand, Profil 'minimal' verteilt sie aber nicht`);
  });
});
