import { describe, expect, it } from "vitest";
// @ts-expect-error reines ESM-Skript ohne Typen
import { fruehesterMilestone, geschlosseneMilestones, geschlossenSeit, milestoneAus, titelBereinigt, vorrangHinweis } from "../scripts/milestone-lib.mjs";

const m = (nummer: number, faellig: string | null, state = "open") => ({ nummer, titel: `M${nummer}`, state, faellig });

describe("milestoneAus (factory#194)", () => {
  it("normalisiert die REST-Form", () => {
    expect(milestoneAus({ number: 3, title: "Erste", state: "open", due_on: "2026-12-01T00:00:00Z" })).toEqual({ nummer: 3, titel: "Erste", state: "open", faellig: "2026-12-01T00:00:00Z" });
    expect(milestoneAus({ number: 3, title: "Erste", state: "open", due_on: null })?.faellig).toBeNull();
  });
  it.each([[null], [undefined], ["x"], [{}], [{ number: "3", title: "a", state: "open" }], [{ number: 3, title: "a", state: "weird" }]])("unerwartete Form %j gibt null", (roh) => {
    expect(milestoneAus(roh)).toBeNull();
  });
});

describe("fruehesterMilestone", () => {
  it("sortiert nach Fälligkeit, ohne Fälligkeit dahinter, Gleichstand nach Nummer", () => {
    expect(fruehesterMilestone([m(1, "2026-12-01T00:00:00Z"), m(2, "2026-11-01T00:00:00Z")])?.nummer).toBe(2);
    expect(fruehesterMilestone([m(1, null), m(2, "2027-01-01T00:00:00Z")])?.nummer).toBe(2);
    expect(fruehesterMilestone([m(5, null), m(4, null)])?.nummer).toBe(4);
    expect(fruehesterMilestone([m(9, "2026-11-01T00:00:00Z"), m(8, "2026-11-01T00:00:00Z")])?.nummer).toBe(8);
  });
  it("ignoriert geschlossene; ohne offene null", () => {
    expect(fruehesterMilestone([m(1, "2026-01-01T00:00:00Z", "closed"), m(2, null)])?.nummer).toBe(2);
    expect(fruehesterMilestone([m(1, null, "closed")])).toBeNull();
    expect(fruehesterMilestone([])).toBeNull();
  });
});

describe("Texte", () => {
  it("titelBereinigt entfernt Umbrüche und Steuerzeichen", () => {
    expect(titelBereinigt("a\nb\u0000c|d")).toBe("a b c|d");
    expect(titelBereinigt("x".repeat(100)).length).toBe(80);
  });
  it("vorrangHinweis nennt Fälligkeit oder ihr Fehlen", () => {
    expect(vorrangHinweis(m(1, "2026-12-01T10:00:00Z"))).toBe("Milestone-Vorrang: „M1“ (fällig 2026-12-01)");
    expect(vorrangHinweis(m(1, null))).toBe("Milestone-Vorrang: „M1“ (ohne Fälligkeit)");
  });
});

describe("geschlosseneMilestones und geschlossenSeit", () => {
  const seiten = [[{ number: 1, title: "A", closed_at: "2026-11-02T00:00:00Z" }, { number: 2, title: "B", closed_at: null }], [{ number: 3, title: "C", closed_at: "2026-11-04T00:00:00Z" }]];
  it("normalisiert Seiten; wieder geöffneter (closed_at null) zählt nicht", () => {
    expect(geschlosseneMilestones(seiten).map((x: { nummer: number }) => x.nummer)).toEqual([1, 3]);
  });
  it("wirft bei falscher Seitenform", () => {
    expect(() => geschlosseneMilestones({})).toThrow();
    expect(() => geschlosseneMilestones([{}])).toThrow();
  });
  it("seit zählt echt später (nicht gleich)", () => {
    const l = geschlosseneMilestones(seiten);
    expect(geschlossenSeit(l, "2026-11-02T00:00:00Z").map((x: { nummer: number }) => x.nummer)).toEqual([3]);
    expect(geschlossenSeit(l, "2026-11-01T00:00:00Z").map((x: { nummer: number }) => x.nummer)).toEqual([1, 3]);
    expect(geschlossenSeit(l, "kaputt")).toEqual([]);
  });
});
