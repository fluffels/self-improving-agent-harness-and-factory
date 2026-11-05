/* Testhilfe `quelleAusConfig` (factory#202 L3): eine Wurzel als String, eine Liste mehrerer Wurzeln wirft statt still die erste zu nehmen. */
import { describe, expect, test } from "vitest";
import { quelleAusConfig } from "./support/struktur-quelle";

describe("quelleAusConfig", () => {
  test("liefert die einzelne Quellwurzel", () => {
    expect(quelleAusConfig({ struktur: { quelle: "src", moduldoku: null } })).toBe("src");
  });
  test("wirft bei einer Liste mehrerer Wurzeln und nennt quellenAus", () => {
    expect(() => quelleAusConfig({ struktur: { quelle: ["a", "b"], moduldoku: null } })).toThrow(/quellenAus/);
  });
});
