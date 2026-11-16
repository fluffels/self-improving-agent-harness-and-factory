/* @harness-waechter – Fitness-Function, im geschützten test/harness/ (factory#604 L3): Doku-Pflicht bei Verhaltens-Änderungen.
 * Prüflogik aus scripts/check-doku-pflicht.mjs (eine Quelle); git ist injiziert, README und Config sind reine Werte. */
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FREMD } from "../support/fremd-config";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../../scripts/check-doku-pflicht.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as sliceRaw from "../../scripts/slice-override.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as bloeckeRaw from "../../scripts/projekt-config-bloecke.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as configRaw from "../../scripts/projekt-config-lib.mjs";

type Urteil = { verhalten: string[]; doku: string[]; rot: boolean; allowed: boolean; stale: boolean };
const m = raw as unknown as {
  bewerte: (a: { dateien: string[]; agentsKernGeaendert?: boolean; override?: string | null }) => Urteil;
  kernBlockGeaendert: (alt: string | null, neu: string | null) => boolean;
  pruefeReadme: (a: { readme: string | null; seitenVorhanden: (p: string) => boolean; abschnitte?: string[] }) => string[];
  laufe: (a: { config: unknown; rootDir: string; runGit: (args: string[]) => string; env?: Record<string, string>; log: (s: string) => void; err: (s: string) => void }) => number;
  checkReadmeAusConfig: (c: unknown, rootDir: string) => string[];
  checkReadme: (a: { rootDir: string; abschnitte?: string[] }) => string[];
  checkDokuPflichtSlice: (a: { runGit: (args: string[]) => string; env?: Record<string, string>; zeilen: { dokuOverride: string } }) => Record<string, unknown>;
};
const { commitZeilenAus } = sliceRaw as unknown as { commitZeilenAus: (c: unknown) => { dokuOverride: string } };
const { pruefeDokuPflicht } = bloeckeRaw as unknown as { pruefeDokuPflicht: (b: unknown) => string[] };

const { pruefeProjektConfig } = configRaw as unknown as { pruefeProjektConfig: (w: unknown) => string[] };

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

describe("Slice mit AGENTS.md und Basis", () => {
  const block = (kern: string) => `${START}\n${kern}\n${ENDE}\nRest`;
  const git = (basis: string, kopf: string) => (args: string[]): string => {
    if (args[0] === "rev-parse") return "base1\n";
    if (args[0] === "diff") return "AGENTS.md\n";
    if (args[0] === "log") return "";
    if (args[0] === "show") return args[1] === "base1:AGENTS.md" ? basis : kopf;
    throw new Error(`unerwartet: ${args.join(" ")}`);
  };
  const lauf = (g: (a: string[]) => string) => m.checkDokuPflichtSlice({ runGit: g, env: { FACTORY_DIFF_BASE: "base1" }, zeilen: Z });
  it("geänderter Kern-Block ohne Doku ist rot, gleicher Kern-Block grün", () => {
    expect(lauf(git(block("a"), block("b")))).toMatchObject({ rot: true });
    expect(lauf(git(block("a"), block("a")))).toMatchObject({ rot: false });
  });
  it("ohne auflösbare Basis: übersprungen", () => {
    const keine = (): string => {
      throw new Error("keine Basis");
    };
    expect(m.checkDokuPflichtSlice({ runGit: keine, env: {}, zeilen: Z })).toEqual({ skipped: true });
  });
});

describe("checkReadme gegen die Platte", () => {
  const mitReadme = (text: string | null, seiten: string[], fn: (wurzel: string) => void) => {
    const wurzel = mkdtempSync(join(tmpdir(), "dokupflicht-"));
    try {
      if (text !== null) writeFileSync(join(wurzel, "README.md"), text);
      for (const s of seiten) {
        mkdirSync(join(wurzel, s, ".."), { recursive: true });
        writeFileSync(join(wurzel, s), "x");
      }
      fn(wurzel);
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  };
  it("konfigurierter Abschnitt fehlt: Befund; vorhanden: keiner", () => {
    mitReadme("# T\n\n## Status\n", [], (w) => {
      expect(m.checkReadme({ rootDir: w, abschnitte: ["Lizenz"] })).toHaveLength(1);
      expect(m.checkReadme({ rootDir: w, abschnitte: ["Status"] })).toEqual([]);
    });
  });
  it("die Abschnitte kommen aus dokuPflicht.readmeAbschnitte der Config", () => {
    mitReadme("# T\n\n## Status\n", [], (w) => {
      expect(m.checkReadmeAusConfig({ dokuPflicht: { readmeAbschnitte: ["Lizenz"] } }, w)).toHaveLength(1);
      expect(m.checkReadmeAusConfig({ dokuPflicht: { readmeAbschnitte: ["Status"] } }, w)).toEqual([]);
      expect(m.checkReadmeAusConfig({}, w)).toEqual([]);
    });
  });
  it("Verweis wird nur bei existierender Zielseite verlangt", () => {
    mitReadme("# T\n", ["docs/referenz/befehle.md"], (w) => {
      expect(m.checkReadme({ rootDir: w })).toEqual(["README.md verweist nicht auf docs/referenz/befehle.md"]);
    });
  });
  it("README ohne Zielseiten und ohne Liste: nichts; ohne README: nichts", () => {
    mitReadme("# T\n", [], (w) => expect(m.checkReadme({ rootDir: w })).toEqual([]));
    mitReadme(null, [], (w) => expect(m.checkReadme({ rootDir: w })).toEqual([]));
  });
});

describe("laufe: Exit-Code und Meldungen", () => {
  const git = (dateien: string[], msgs: string) => (args: string[]): string => {
    if (args[0] === "rev-parse") return "base1\n";
    if (args[0] === "diff") return dateien.join("\n");
    if (args[0] === "log") return msgs;
    throw new Error("unerwartet");
  };
  const lauf = (dateien: string[], msgs: string, config: unknown = FREMD) => {
    const ausgabe: string[] = [];
    const w = mkdtempSync(join(tmpdir(), "dokupflicht-lauf-"));
    try {
      const code = m.laufe({ config, rootDir: w, runGit: git(dateien, msgs), env: { FACTORY_DIFF_BASE: "base1" }, log: (s) => ausgabe.push(s), err: (s) => ausgabe.push(s) });
      return { code, text: ausgabe.join("\n") };
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  };
  it("Verhalten ohne Doku: Exit 1 mit Fix-Hinweis", () => {
    const r = lauf(["scripts/a.mjs"], "");
    expect(r.code).toBe(1);
    expect(r.text).toContain(Z.dokuOverride);
  });
  it("Verhalten mit Doku: Exit 0", () => {
    expect(lauf(["scripts/a.mjs", "docs/x.md"], "").code).toBe(0);
  });
  it("Override: Exit 0 mit Hinweis; stale: Exit 1", () => {
    const zeile = `${Z.dokuOverride}: #5 Refactor`;
    const erlaubt = lauf(["scripts/a.mjs"], zeile);
    expect(erlaubt.code).toBe(0);
    expect(erlaubt.text).toContain("geduldet");
    const stale = lauf(["scripts/a.mjs", "docs/x.md"], zeile);
    expect(stale.code).toBe(1);
    expect(stale.text).toContain("stale");
  });
  it("README-Befund macht den Lauf rot, auch ohne Slice-Problem", () => {
    const r = lauf(["docs/x.md"], "", { ...FREMD, dokuPflicht: { readmeAbschnitte: ["Gibtsnicht"] } });
    expect(r.code).toBe(1);
    expect(r.text).toContain("README.md");
  });
});

describe("H2-Erkennung der README", () => {
  const ok = (readme: string) => m.pruefeReadme({ readme, seitenVorhanden: () => false, abschnitte: ["Status"] });
  it("CRLF und Leerraum am Ende zählen, ein H2 ohne Leerzeichen nicht", () => {
    expect(ok("# T\r\n## Status\r\n")).toEqual([]);
    expect(ok("# T\n## Status  \n")).toEqual([]);
    expect(ok("# T\n##Status\n")).toHaveLength(1);
  });
});

describe("Config-Block dokuPflicht", () => {
  it("die Config-Prüfung meldet einen kaputten Block", () => {
    expect(pruefeProjektConfig({ ...FREMD, dokuPflicht: "x" }).join()).toMatch(/dokuPflicht/);
    expect(pruefeProjektConfig({ ...FREMD, dokuPflicht: { readmeAbschnitte: ["Status"] } }).join()).not.toMatch(/dokuPflicht/);
  });
  it("Einrückung vor # zählt als #", () => {
    expect(pruefeDokuPflicht({ readmeAbschnitte: [" ## X"] })).toHaveLength(1);
  });
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
