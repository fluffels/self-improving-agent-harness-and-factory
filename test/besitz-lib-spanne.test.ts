// blockSpanne und MANIFEST_PFAD der Besitz-Lib (#101 L25/L26): eine Auslegung der Block-Spanne für einheitText und docdrift.
import { describe, expect, test } from "vitest";
import * as besitzRoh from "../scripts/besitz-lib.mjs";

const { blockSpanne, einheitText, markerEnde, markerStart, MANIFEST_PFAD } = besitzRoh as unknown as {
  blockSpanne: (text: string, block: string) => [number, number] | null;
  einheitText: (e: { pfad: string; block: string }, text: string) => string | null;
  markerEnde: (id: string) => string;
  markerStart: (id: string) => string;
  MANIFEST_PFAD: string;
};

describe("blockSpanne", () => {
  test("Normalfall: Start der beiden Marker", () => {
    const text = `x\n${markerStart("k")}\ninnen\n${markerEnde("k")}\ny`;
    expect(blockSpanne(text, "k")).toEqual([text.indexOf(markerStart("k")), text.indexOf(markerEnde("k"))]);
  });
  test("fehlendes Ende oder fehlender Start: null", () => {
    expect(blockSpanne(`${markerStart("k")}\n`, "k")).toBeNull();
    expect(blockSpanne(`${markerEnde("k")}\n`, "k")).toBeNull();
    expect(blockSpanne("", "k")).toBeNull();
  });
  test("Ende vor Start: null", () => {
    expect(blockSpanne(`${markerEnde("k")}\n${markerStart("k")}`, "k")).toBeNull();
  });
  test("einheitText nutzt dieselbe Spanne", () => {
    const text = `x${markerStart("k")}i${markerEnde("k")}y`;
    expect(einheitText({ pfad: "a.md", block: "k" }, text)).toBe(`${markerStart("k")}i${markerEnde("k")}`);
    expect(einheitText({ pfad: "a.md", block: "k" }, `${markerEnde("k")}${markerStart("k")}`)).toBeNull();
  });
  test("MANIFEST_PFAD", () => {
    expect(MANIFEST_PFAD).toBe(".factory/besitz.json");
  });
});
