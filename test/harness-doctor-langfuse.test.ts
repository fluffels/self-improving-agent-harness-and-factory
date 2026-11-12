/* Harness-Doctor, Punkt `Langfuse` (factory#362 L30): `langfusePunkt` liest die `--json`-Ausgabe von langfuse-vorbedingung.mjs und unterscheidet
 * "Langfuse nicht erreichbar" (starten) von "MCP-Verbindung der Session getrennt" (neu verbinden). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { langfusePunkt as raw } from "../scripts/harness-doctor-langfuse.mjs";

interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string }
const punkt = raw as (lf: { status?: number | null; stdout?: string; stderr?: string }) => Ergebnis;
const json = (o: unknown, status = 0) => punkt({ status, stdout: JSON.stringify(o) });

describe("Langfuse-Punkt (langfusePunkt)", () => {
  test("nicht erreichbar: Lücke mit Grund und Fix `Langfuse starten`", () => {
    const x = json({ erreichbar: false, grund: "Langfuse aus.", mcp: null }, 1);
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBeUndefined();
    expect(x.befund).toBe("Langfuse aus.");
    expect(x.fix).toContain("Langfuse starten");
  });
  test("nicht erreichbar ohne Grund: Standardbefund", () => {
    expect(json({ erreichbar: false }, 1).befund).toBe("Langfuse nicht erreichbar");
  });
  test("erreichbar, MCP getrennt: Lücke mit Fix `/mcp`, nicht `Langfuse starten`", () => {
    const x = json({ erreichbar: true, grund: null, mcp: { status: "getrennt", code: "X", zeit: "t" } });
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBeUndefined();
    expect(x.fix).toContain("/mcp");
    expect(x.fix).toContain("neu verbinden");
    expect(x.fix).not.toContain("Langfuse starten");
  });
  test("erreichbar, MCP verbunden: OK", () => {
    expect(json({ erreichbar: true, grund: null, mcp: { status: "verbunden" } }).ok).toBe(true);
  });
  test("erreichbar, MCP nicht prüfbar (kein Claude Code): OK", () => {
    expect(json({ erreichbar: true, grund: null, mcp: { status: "nicht-pruefbar", grund: "keine Claude-Code-Session" } }).ok).toBe(true);
  });
  test("erreichbar ohne mcp-Feld: OK", () => {
    expect(json({ erreichbar: true, grund: null }).ok).toBe(true);
  });
  test("unlesbares JSON: nicht prüfbar mit Fix auf --json", () => {
    const x = punkt({ status: 1, stdout: "kein json", stderr: "Boom" });
    expect(x.nichtPruefbar).toBe(true);
    expect(x.fix).toContain("node scripts/langfuse-vorbedingung.mjs --json");
    expect(x.befund).toContain("(Boom)");
  });
  test("unlesbar ohne stderr oder ohne Ergebnis: nicht prüfbar, ohne Klammer und ohne `undefined`", () => {
    const x = punkt({ status: 1, stdout: "kein json" });
    expect(x.nichtPruefbar).toBe(true);
    expect(x.befund).not.toContain("(");
    expect(x.befund).not.toContain("undefined");
    expect((raw as (a: unknown) => Ergebnis)(undefined).nichtPruefbar).toBe(true);
  });
  test("Objekt ohne erreichbar-Feld: Lücke (nur `true` gilt als erreichbar)", () => {
    const x = json({});
    expect(x.ok).toBe(false);
    expect(x.nichtPruefbar).toBeUndefined();
  });
  test("leere Ausgabe: nicht prüfbar", () => {
    expect(punkt({ status: null }).nichtPruefbar).toBe(true);
  });
  test("JSON ohne Objekt: nicht prüfbar", () => {
    expect(punkt({ status: 0, stdout: "null" }).nichtPruefbar).toBe(true);
  });
});
