import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/herkunftsform.mjs";

type Ergebnis = { text: string; quellprojekt: number; factory: number };
type Args = { schreiben: boolean; ab: number | null; dateien: string[]; fehler: string | null };
const H = raw as unknown as {
  umschreiben: (t: string, o: { ab: number }) => Ergebnis;
  parseArgs: (a: string[]) => Args;
  main: (a: string[], wurzel: string) => number;
  standardDateien: (wurzel: string) => string[];
  istFactorySeite: (p: string) => boolean;
};
const AB = 120;
const u = (t: string): string => H.umschreiben(t, { ab: AB }).text;

describe("umschreiben: Ziel der Nummer", () => {
  it("eine vier- und eine dreistellige Nummer ab `ab` werden quellprojekt#", () => {
    expect(u("siehe #1234 und #120.")).toBe("siehe quellprojekt#1234 und quellprojekt#120.");
  });
  it("eine Nummer von 100 bis unter `ab` wird factory#", () => {
    const r = H.umschreiben("#100 #119 #120", { ab: AB });
    expect(r.text).toBe("factory#100 factory#119 quellprojekt#120");
    expect(r.factory).toBe(2);
    expect(r.quellprojekt).toBe(1);
  });
  it("ein- und zweistellige sowie fünfstellige Nummern bleiben", () => {
    expect(u("#5 #12 #12345 #99")).toBe("#5 #12 #12345 #99");
  });
  it("Klammer, Schrägstrich, Sternchen, eckige Klammer und Zeilenanfang erlauben die Umstellung; beide Nummern in (#992/#1087)", () => {
    expect(u("(#992/#1087) *#1234* [#1234]\n#1234 am Anfang")).toBe("(quellprojekt#992/quellprojekt#1087) *quellprojekt#1234* [quellprojekt#1234]\nquellprojekt#1234 am Anfang");
  });
  it("Buchstaben, Ziffern, Unterstrich direkt nach der Nummer verhindern die Umstellung", () => {
    expect(u("#123abc #1234_x #1234ä")).toBe("#123abc #1234_x #1234ä");
  });
});

describe("umschreiben: unverändert", () => {
  it("schon präfixierte Formen und Dateianker", () => {
    const t = "kubernia#1883 owner/repo#1234 x.md#1234 quellprojekt#1234 a-b#1234 a_b#1234";
    expect(u(t)).toBe(t);
  });
  it("Überschriftszeilen (Anker), auch eingerückt bis drei Leerzeichen", () => {
    expect(u("## Titel (#1875)\n   # Eins #1234\n")).toBe("## Titel (#1875)\n   # Eins #1234\n");
  });
  it("eine Zeile mit `#` ohne Leerzeichen ist keine Überschrift und wird umgestellt", () => {
    expect(u("#1234 steht vorn")).toBe("quellprojekt#1234 steht vorn");
  });
  it("Code-Fences (auch ~~~) und Inline-Code; Text davor und danach wird umgestellt", () => {
    expect(u("#1234\n```\n#1234\n```\n#1234\n~~~\n#1234\n~~~\n`#1234` #1234")).toBe(
      "quellprojekt#1234\n```\n#1234\n```\nquellprojekt#1234\n~~~\n#1234\n~~~\n`#1234` quellprojekt#1234",
    );
  });
  it("GEN-Blöcke samt Markerzeilen", () => {
    expect(u("#1234\n<!-- GEN:x START -->\n#1234\n<!-- GEN:x END -->\n#1234")).toBe("quellprojekt#1234\n<!-- GEN:x START -->\n#1234\n<!-- GEN:x END -->\nquellprojekt#1234");
  });
  it("Linkziele, http-Links samt Text und nackte URLs, aber nicht der Text eines relativen Links", () => {
    expect(u("[a](x.md#1234) [#1949](https://github.com/o/r/issues/1949) https://x.de/#1234 [#1234](x.md)")).toBe(
      "[a](x.md#1234) [#1949](https://github.com/o/r/issues/1949) https://x.de/#1234 [quellprojekt#1234](x.md)",
    );
  });
});

describe("umschreiben: Hülle", () => {
  it("ist idempotent", () => {
    const eins = u("a #1234 b #100 (#992)\n");
    expect(u(eins)).toBe(eins);
  });
  it("lässt CRLF und fehlenden Schlusszeilenumbruch unverändert", () => {
    expect(u("a #1234\r\nb #1234")).toBe("a quellprojekt#1234\r\nb quellprojekt#1234");
  });
  it("ohne Treffer ist der Text gleich und die Zähler sind 0", () => {
    expect(H.umschreiben("nichts", { ab: AB })).toEqual({ text: "nichts", quellprojekt: 0, factory: 0 });
  });
  it("ein unbrauchbares `ab` wirft", () => {
    expect(() => H.umschreiben("x", { ab: 100 })).toThrow(/ab muss/);
    expect(() => H.umschreiben("x", { ab: Number.NaN })).toThrow(/ab muss/);
  });
});

describe("parseArgs", () => {
  it("--ab ist Pflicht und mindestens 101", () => {
    expect(H.parseArgs([]).fehler).toMatch(/--ab/);
    expect(H.parseArgs(["--ab"]).fehler).toMatch(/--ab/);
    expect(H.parseArgs(["--ab", "x"]).fehler).toMatch(/--ab/);
    expect(H.parseArgs(["--ab", "100"]).fehler).toMatch(/--ab/);
    expect(H.parseArgs(["--ab", "101"]).fehler).toBeNull();
  });
  it("Flags und Dateien", () => {
    expect(H.parseArgs(["--ab", "120", "--schreiben", "a.md"])).toEqual({ schreiben: true, ab: 120, dateien: ["a.md"], fehler: null });
    expect(H.parseArgs(["--ab", "120", "--x"]).fehler).toMatch(/unbekanntes Flag --x/);
  });
});

describe("main", () => {
  const ordner: string[] = [];
  afterEach(() => {
    for (const o of ordner.splice(0)) rmSync(o, { recursive: true, force: true });
  });
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), "herkunftsform-")) + "/";
    ordner.push(dir);
    for (const [f, t] of Object.entries({ "docs/a.md": "x #1234\n", "docs/adr/b.md": "#1234\n", "AGENTS.md": "y #1235\n", "README.md": "#1236\n" })) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), t);
    }
    return dir;
  }
  it("Probelauf schreibt nichts, --schreiben stellt Factory-Seiten und AGENTS.md um, die Historie und README nicht", () => {
    const dir = repo();
    expect(H.main(["--ab", "120"], dir)).toBe(0);
    expect(readFileSync(dir + "docs/a.md", "utf8")).toBe("x #1234\n");
    expect(H.main(["--ab", "120", "--schreiben"], dir)).toBe(0);
    expect(readFileSync(dir + "docs/a.md", "utf8")).toBe("x quellprojekt#1234\n");
    expect(readFileSync(dir + "AGENTS.md", "utf8")).toBe("y quellprojekt#1235\n");
    expect(readFileSync(dir + "docs/adr/b.md", "utf8")).toBe("#1234\n");
    expect(readFileSync(dir + "README.md", "utf8")).toBe("#1236\n");
  });
  it("ohne --ab: Exit 2 und nichts geschrieben", () => {
    const dir = repo();
    expect(H.main(["--schreiben"], dir)).toBe(2);
    expect(readFileSync(dir + "docs/a.md", "utf8")).toBe("x #1234\n");
  });
  it("eine genannte Datei wird (relativ zum Aufruf) bearbeitet, die Standardliste entfällt", () => {
    const dir = repo();
    expect(H.main(["--ab", "120", "--schreiben", dir + "README.md"], dir)).toBe(0);
    expect(readFileSync(dir + "README.md", "utf8")).toBe("quellprojekt#1236\n");
    expect(readFileSync(dir + "docs/a.md", "utf8")).toBe("x #1234\n");
  });
});

describe("Standardliste", () => {
  it("istFactorySeite: Seiten ja, Historie, Gegenprobe, Nicht-Markdown nein", () => {
    expect(H.istFactorySeite("docs/model-routing.md")).toBe(true);
    expect(H.istFactorySeite("docs/referenz/befehle.md")).toBe(true);
    expect(H.istFactorySeite("docs/adr/0022-x.md")).toBe(false);
    expect(H.istFactorySeite("docs/lessons-learned.md")).toBe(false);
    expect(H.istFactorySeite("docs/x-gegenprobe-1.md")).toBe(false);
    expect(H.istFactorySeite("docs/sub/x-gegenprobe-1.md")).toBe(true);
    expect(H.istFactorySeite("docs/a.mmd")).toBe(false);
    expect(H.istFactorySeite("README.md")).toBe(false);
  });
});
