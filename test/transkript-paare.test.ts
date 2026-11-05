/* toolPaare (factory#202 L13): tool_use und tool_result über die ID verknüpfen; synthetische Zeilen. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTranskript from "../scripts/transkript.mjs";

type Paar = { id: string | null; use: { row: Record<string, unknown>; block: Record<string, unknown> }; ergebnis: { row: Record<string, unknown>; block: Record<string, unknown> } | null };
const toolPaare = (rawTranskript as unknown as { toolPaare: (z: unknown[], o?: { istAufruf?: (row: unknown, block: unknown) => boolean }) => Paar[] }).toolPaare;

const use = (id: string | undefined, name = "Bash", extra = {}) => ({ type: "assistant", message: { content: [{ type: "tool_use", id, name, ...extra }] } });
const res = (id: string, text = "ok", extra = {}) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, content: text, ...extra }] } });

describe("toolPaare", () => {
  test("verknüpft Aufruf und Ergebnis über die ID, offene Aufrufe haben ergebnis null", () => {
    const zeilen = [use("a"), use("b"), res("a", "A")];
    const paare = toolPaare(zeilen);
    expect(paare.map((p) => p.id)).toEqual(["a", "b"]);
    expect(paare[0].use.row).toBe(zeilen[0]);
    expect(paare[0].ergebnis?.row).toBe(zeilen[2]);
    expect(paare[0].ergebnis?.block.content).toBe("A");
    expect(paare[1].ergebnis).toBeNull();
  });

  test("die erste Fassung einer ID gilt, auch beim Ergebnis (Haupt- und Subagent-Datei)", () => {
    const paare = toolPaare([use("a", "Read"), use("a", "Grep"), res("a", "erst"), res("a", "zweit")]);
    expect(paare).toHaveLength(1);
    expect(paare[0].use.block.name).toBe("Read");
    expect(paare[0].ergebnis?.block.content).toBe("erst");
  });

  test("Ergebnis ohne Aufruf wird ignoriert; Aufrufe ohne ID bleiben ohne Ergebnis", () => {
    const paare = toolPaare([res("x"), use(undefined), res("undefined")]);
    expect(paare).toHaveLength(1);
    expect(paare[0].id).toBeNull();
    expect(paare[0].ergebnis).toBeNull();
  });

  test("Standard-Wähler: ein tool_use-Block in einer User-Zeile ist kein Aufruf", () => {
    const falsch = { type: "user", message: { content: [{ type: "tool_use", id: "u1", name: "Bash" }] } };
    expect(toolPaare([falsch, res("u1")])).toEqual([]);
  });

  test("istAufruf wählt die Aufrufe; ein Ergebnis zu einem abgewählten Aufruf zählt als ohne Aufruf", () => {
    const paare = toolPaare([use("a", "Read"), use("b", "Bash"), res("a"), res("b")], { istAufruf: (_r: unknown, b: unknown) => (b as { name: string }).name === "Bash" });
    expect(paare.map((p) => p.id)).toEqual(["b"]);
    expect(paare[0].ergebnis).not.toBeNull();
  });

  test("mehrere Blöcke je Zeile und tool_result nur in User-Zeilen", () => {
    const zeile = { type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "X" }, { type: "tool_use", id: "b", name: "Y" }] } };
    const falsch = { type: "assistant", message: { content: [{ type: "tool_result", tool_use_id: "a" }] } };
    const paare = toolPaare([zeile, falsch, { type: "attachment" }, null, res("b")]);
    expect(paare.map((p) => [p.id, p.ergebnis !== null])).toEqual([["a", false], ["b", true]]);
  });
});
