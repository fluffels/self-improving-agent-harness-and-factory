/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#604 L3): Doku-Pflicht bei Verhaltens-Änderungen.
 * Prüflogik aus scripts/check-doku-pflicht.mjs (eine Quelle); git ist injiziert, README und Config sind reine Werte. */
import { describe, it, expect } from "vitest";
import { FREMD } from "../support/fremd-config";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/check-doku-pflicht.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as bloeckeRaw from "../../scripts/projekt-config-bloecke.mjs";

type Urteil = { verhalten: string[]; doku: string[]; rot: boolean; allowed: boolean; stale: boolean };
const m = raw as unknown as {
  bewerte: (a: { dateien: string[]; agentsKernGeaendert?: boolean; override?: string | null }) => Urteil;
  kernBlockGeaendert: (alt: string | null, neu: string | null) => boolean;
  pruefeReadme: (a: { readme: string | null; seitenVorhanden: (p: string) => boolean; abschnitte?: string[] }) => string[];
  checkDokuPflichtSlice: (a: { runGit: (args: string[]) => string; env?: Record<string, string>; zeilen: { dokuOverride: string } }) => Record<string, unknown>;
};
const { commitZeilenAus } = sliceRaw as unknown as { commitZeilenAus: (c: unknown) => { dokuOverride: string } };
const { pruefeDokuPflicht } = bloeckeRaw as unknown as { pruefeDokuPflicht: (b: unknown) => string[] };

const Z = commitZeilenAus(FREMD);
const START = "<!-- factory-besitz:start kern -->";
const ENDE = "<!-- factory-besitz:ende kern -->";

describe("bewerte", () => {
  it("scripts ohne Doku ist rot", () => {
    expect(m.bewerte({ dateien: ["scripts/x.mjs"] }).rot).toBe(true);
  });
  it("scripts mit docs oder README ist grün", () => {
    expect(m.bewerte({ dateien: ["scripts/x.mjs", "docs/a.md"] }).rot).toBe(false);
    expect(m.bewerte({ dateien: ["scripts/x.mjs", "README.md"] }).rot).toBe(false);
  });
  it("nur Tests oder nur Doku sind kein Verhalten", () => {
    expect(m.bewerte({ dateien: ["test/x.test.ts"] }).rot).toBe(false);
    expect(m.bewerte({ dateien: ["docs/a.md"] }).rot).toBe(false);
  });
  it("Agenten und Skills ohne Doku sind rot", () => {
    for (const p of [".claude/agents/x.md", ".agents/skills/a/SKILL.md", ".claude/skills/a/SKILL.md"]) {
      expect(m.bewerte({ dateien: [p] }).rot, p).toBe(true);
    }
  });
  it("AGENTS.md zählt nur mit geändertem Kern-Block", () => {
    expect(m.bewerte({ dateien: ["AGENTS.md"], agentsKernGeaendert: false }).rot).toBe(false);
    expect(m.bewerte({ dateien: ["AGENTS.md"], agentsKernGeaendert: true }).rot).toBe(true);
    expect(m.bewerte({ dateien: ["AGENTS.md", "docs/a.md"], agentsKernGeaendert: true }).rot).toBe(false);
  });
  it("Override lässt durch (allowed), ohne Bedarf ist er stale", () => {
    const u = m.bewerte({ dateien: ["scripts/x.mjs"], override: "#1 Refactor" });
    expect(u).toMatchObject({ rot: false, allowed: true, stale: false });
    const s = m.bewerte({ dateien: ["scripts/x.mjs", "docs/a.md"], override: "#1 Refactor" });
    expect(s).toMatchObject({ rot: false, allowed: false, stale: true });
  });
});

describe("kernBlockGeaendert", () => {
  const text = (kern: string, rest: string) => `${START}\n${kern}\n${ENDE}\n${rest}`;
  it("Änderung nur außerhalb des Blocks: nein; im Block: ja", () => {
    expect(m.kernBlockGeaendert(text("a", "x"), text("a", "y"))).toBe(false);
    expect(m.kernBlockGeaendert(text("a", "x"), text("b", "x"))).toBe(true);
  });
  it("fehlende Marker oder Fassung: ja (fail-closed)", () => {
    expect(m.kernBlockGeaendert("ohne", text("a", "x"))).toBe(true);
    expect(m.kernBlockGeaendert(null, text("a", "x"))).toBe(true);
  });
});

describe("Override aus Commit-Zeilen", () => {
  const git = (msgs: string, dateien: string[]) => (args: string[]): string => {
    if (args[0] === "rev-parse") return "base1\n";
    if (args[0] === "diff") return dateien.join("\n");
    if (args[0] === "log") return msgs;
    throw new Error(`unerwartet: ${args.join(" ")}`);
  };
  const lauf = (msgs: string) => m.checkDokuPflichtSlice({ runGit: git(msgs, ["scripts/x.mjs"]), env: { FACTORY_DIFF_BASE: "base1" }, zeilen: Z });
  it("gültiger Override: allowed", () => {
    expect(lauf(`${Z.dokuOverride}: #5 nur Refactor`)).toMatchObject({ rot: false, allowed: true });
  });
  it("Override ohne Grund ist ungültig und rot", () => {
    expect(lauf(`${Z.dokuOverride}: #5`)).toMatchObject({ rot: true, invalidOverrides: [expect.stringContaining("#5")] });
  });
  it("kein Override: rot", () => {
    expect(lauf("chore: x")).toMatchObject({ rot: true, allowed: false });
  });
  it("nicht messbarer Diff: übersprungen", () => {
    const kaputt = (args: string[]): string => {
      if (args[0] === "rev-parse") return "base1\n";
      throw new Error("shallow");
    };
    expect(m.checkDokuPflichtSlice({ runGit: kaputt, env: { FACTORY_DIFF_BASE: "base1" }, zeilen: Z })).toEqual({ skipped: true });
  });
});

describe("pruefeReadme", () => {
  const alle = () => true;
  const gut = "# T\n\nSiehe docs/referenz/befehle.md und docs/referenz/anlaufstellen.md.\n\n## Status\n";
  it("README mit beiden Verweisen ist grün", () => {
    expect(m.pruefeReadme({ readme: gut, seitenVorhanden: alle })).toEqual([]);
  });
  it("fehlender Verweis ist rot, jeder einzeln", () => {
    const r = m.pruefeReadme({ readme: "# T\n\ndocs/referenz/befehle.md\n", seitenVorhanden: alle });
    expect(r).toEqual(["README.md verweist nicht auf docs/referenz/anlaufstellen.md"]);
  });
  it("Verweis nur auf existierende Zielseiten verlangt", () => {
    expect(m.pruefeReadme({ readme: "# T\n", seitenVorhanden: () => false })).toEqual([]);
  });
  it("konfigurierter H2-Abschnitt fehlt: rot; vorhanden: grün", () => {
    expect(m.pruefeReadme({ readme: gut, seitenVorhanden: alle, abschnitte: ["Lizenz"] })).toEqual(["README.md hat keinen Abschnitt „## Lizenz“"]);
    expect(m.pruefeReadme({ readme: gut, seitenVorhanden: alle, abschnitte: ["Status"] })).toEqual([]);
  });
  it("ein H3 oder Fließtext ersetzt den H2 nicht", () => {
    expect(m.pruefeReadme({ readme: `${gut}\n### Lizenz\nLizenz\n`, seitenVorhanden: alle, abschnitte: ["Lizenz"] })).toHaveLength(1);
  });
  it("ohne README: nur ein Befund, wenn etwas verlangt wird", () => {
    expect(m.pruefeReadme({ readme: null, seitenVorhanden: () => false })).toEqual([]);
    expect(m.pruefeReadme({ readme: null, seitenVorhanden: alle })).toEqual(["README.md fehlt"]);
  });
});

describe("Config-Block dokuPflicht", () => {
  it("fehlend oder gültig: keine Fehler", () => {
    expect(pruefeDokuPflicht(undefined)).toEqual([]);
    expect(pruefeDokuPflicht({ readmeAbschnitte: ["Status"] })).toEqual([]);
    expect(pruefeDokuPflicht({})).toEqual([]);
  });
  it("falsche Form: Fehler", () => {
    expect(pruefeDokuPflicht("x")).toHaveLength(1);
    expect(pruefeDokuPflicht({ andere: 1 })[0]).toMatch(/kein bekannter Schlüssel/);
    expect(pruefeDokuPflicht({ readmeAbschnitte: "Status" })[0]).toMatch(/Liste/);
    expect(pruefeDokuPflicht({ readmeAbschnitte: [""] })).toHaveLength(1);
    expect(pruefeDokuPflicht({ readmeAbschnitte: ["## Status"] })).toHaveLength(1);
    expect(pruefeDokuPflicht({ readmeAbschnitte: ["A", "A"] })[0]).toMatch(/doppelt/);
  });
});
