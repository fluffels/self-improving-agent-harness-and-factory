/* Doctor-Punkt `Sicherheits-Module` (factory#119, factory#139): `modulPunkt` in harness-doctor-lib.mjs. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/harness-doctor-lib.mjs";

interface Punkt {
  punkt: string;
  ok: boolean;
  nichtPruefbar?: boolean;
  befund?: string;
  fix?: string;
  hinweis?: string;
}
const modulPunkt = (raw as unknown as { modulPunkt: (c: unknown, m: unknown, o?: { configPfad?: string; manifestFehler?: string | null }) => Punkt | null }).modulPunkt;

const manifest = { eintraege: [{ pfad: "a.yml", modul: "codeql" }, { pfad: "b.yml", modul: "zizmor" }, { pfad: "c.yml", modul: "codeql" }, { pfad: "d.mjs" }] };

describe("modulPunkt (Doctor)", () => {
  test("Schlüssel fehlt: Lücke mit Fix", () => {
    const p = modulPunkt({}, manifest, { configPfad: "cfg.json" }) as Punkt;
    expect(p).toMatchObject({ punkt: "Sicherheits-Module", ok: false });
    expect(p.befund).toContain("module");
    expect(p.fix).toContain("cfg.json");
  });
  test("Teilauswahl: OK mit Hinweis auf die nicht gewählten Module", () => {
    expect(modulPunkt({ module: ["zizmor"] }, manifest)).toEqual({ punkt: "Sicherheits-Module", ok: true, hinweis: "nicht gewählt: codeql" });
  });
  test("alle gewählt: OK ohne Hinweis", () => {
    expect(modulPunkt({ module: ["zizmor", "codeql"], codeql: { sprachen: ["python"] } }, manifest)).toEqual({ punkt: "Sicherheits-Module", ok: true });
  });
  test("leere Wahl ist bewusst: OK mit Hinweis auf alle", () => {
    expect(modulPunkt({ module: [] }, manifest)).toEqual({ punkt: "Sicherheits-Module", ok: true, hinweis: "nicht gewählt: codeql, zizmor" });
  });
  test("kein Punkt, wenn es nichts zu prüfen gibt: Manifest fehlt oder kennt keine Module und die Config wählt nichts", () => {
    expect(modulPunkt({ module: ["x"] }, null)).toBeNull();
    expect(modulPunkt({}, undefined)).toBeNull();
    expect(modulPunkt({}, { eintraege: [{ pfad: "d.mjs" }] })).toBeNull();
  });
  test("ein Manifest ohne Module, aber eine Config mit module-Namen ist eine Lücke (unbekannter Name)", () => {
    expect(modulPunkt({ module: ["x"] }, { eintraege: [{ pfad: "d.mjs" }] })).toMatchObject({ ok: false });
  });
  test("unbekannter Name und fehlende Sprachen sind Lücken", () => {
    expect(modulPunkt({ module: ["nope"] }, manifest)).toMatchObject({ ok: false });
    expect(modulPunkt({ module: ["nope"] }, manifest)?.fix).toContain("Namen");
    expect(modulPunkt({ module: ["codeql"] }, manifest)).toMatchObject({ ok: false });
    expect(modulPunkt({ module: ["codeql"] }, manifest)?.fix).toContain("codeql.sprachen");
  });
  test("Manifest nicht lesbar: nicht prüfbar mit Fix statt fehlender Zeile (factory#139)", () => {
    const p = modulPunkt({}, null, { configPfad: "cfg.json", manifestFehler: "ENOENT" }) as Punkt;
    expect(p).toMatchObject({ punkt: "Sicherheits-Module", ok: false, nichtPruefbar: true });
    expect(p.befund).toContain("ENOENT");
    expect(p.fix).toContain("Factory-Tag");
  });
});
