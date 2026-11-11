/* Planer-Klasse (factory#311): jede Regel (a) bis (e) der Klassifikation, fail-closed bei unbekannt, und die CLI-Hülle mit injiziertem gh. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as roh from "../scripts/planer-effort.mjs";

interface Ticket {
  titel?: unknown;
  labels?: unknown;
}
interface Ergebnis {
  effort: string;
  grund: string;
}
interface Lauf {
  out: string;
  err: string;
  code: number;
}
const { planerKlasse, lauf } = roh as unknown as {
  planerKlasse: (t?: Ticket, c?: unknown) => Ergebnis;
  lauf: (argv: string[], io: unknown) => Lauf;
};

const config = { labels: { entscheidung: "status:entscheidung-noetig" }, design: { label: "design", freigabe: "design-ok", system: "x" } };
const sammel = "Harness-Härtung (gesammelt)";

describe("planerKlasse", () => {
  test("(c) ein Sammelticket aus der Liste ist high", () => {
    for (const titel of [sammel, "Langfuse-Befunde (gesammelt)", "Codequalität (gesammelt)"]) {
      expect(planerKlasse({ titel, labels: [] }, config)).toEqual({ effort: "high", grund: "Sammelticket" });
    }
  });
  test("(d) das Status-Ticket ist high", () => {
    expect(planerKlasse({ titel: "Langfuse-Status überprüfen", labels: [] }, config)).toEqual({ effort: "high", grund: "Routine (Status-Ticket)" });
  });
  test("(a) das Entscheidungs-Label schlägt das Sammelticket", () => {
    expect(planerKlasse({ titel: sammel, labels: ["status:entscheidung-noetig"] }, config)).toEqual({ effort: "xhigh", grund: "offene Entscheidung" });
  });
  test("(a) das Design-Label schlägt das Sammelticket, ohne Groß-/Kleinschreibung", () => {
    expect(planerKlasse({ titel: sammel, labels: ["Design"] }, config)).toEqual({ effort: "xhigh", grund: "Design" });
  });
  test("(b) Epic und Phase sind xhigh, auch mit Emoji", () => {
    for (const titel of ["Epic: Kontext-Diät", "📦 Phase 2", "epic Umbau"]) {
      expect(planerKlasse({ titel, labels: [] }, config)).toEqual({ effort: "xhigh", grund: "Epic-Aufteilung" });
    }
  });
  test("(e) ein Titel mit (gesammelt) außerhalb der Liste ist xhigh", () => {
    expect(planerKlasse({ titel: "Sicherheit: Rest-Befunde (gesammelt)", labels: [] }, config).effort).toBe("xhigh");
  });
  test("(e) gewöhnliche Architektur ist xhigh, mit Grund fail-closed", () => {
    expect(planerKlasse({ titel: "Planer-Effort nach Ticketart", labels: [] }, config)).toEqual({ effort: "xhigh", grund: "unbekannt/Architektur (fail-closed)" });
  });
  test("(e) fehlender, leerer oder falsch getypter Titel und fehlende Labels sind xhigh", () => {
    expect(planerKlasse({ titel: undefined }, config).effort).toBe("xhigh");
    expect(planerKlasse({ titel: "", labels: [] }, config).effort).toBe("xhigh");
    expect(planerKlasse({ titel: 5, labels: "x" }, config).effort).toBe("xhigh");
    expect(planerKlasse(undefined, undefined).effort).toBe("xhigh");
  });
  test("ein Sammeltitel mit Umgebungs-Leerraum zählt, ein Teiltitel nicht", () => {
    expect(planerKlasse({ titel: `  ${sammel} `, labels: [] }, config).effort).toBe("high");
    expect(planerKlasse({ titel: `${sammel} plus`, labels: [] }, config).effort).toBe("xhigh");
  });
  test("ohne Entscheidungs-Label in der Config greift nur das Design-Label", () => {
    expect(planerKlasse({ titel: sammel, labels: ["status:entscheidung-noetig"] }, { labels: {} }).effort).toBe("high");
  });
});

describe("lauf (CLI-Hülle)", () => {
  const io = (ticket: unknown) => ({ ticket: () => ticket, config: () => config });
  test("gibt eine Zeile mit Effort und Grund aus, Exit 0", () => {
    expect(lauf(["--issue", "7"], io({ title: sammel, labels: [{ name: "area:harness" }] }))).toEqual({ out: "high Sammelticket\n", err: "", code: 0 });
  });
  test("Labels als Objekte werden gelesen", () => {
    expect(lauf(["--issue", "7"], io({ title: sammel, labels: [{ name: "status:entscheidung-noetig" }] })).out).toBe("xhigh offene Entscheidung\n");
  });
  test("ein gh-Fehler gibt xhigh nicht bestimmbar, Exit 2", () => {
    const r = lauf(["--issue", "7"], {
      ticket: () => {
        throw new Error("gh: nicht gefunden\nzweite Zeile");
      },
      config: () => config,
    });
    expect(r.out).toBe("xhigh nicht bestimmbar: gh: nicht gefunden\n");
    expect(r.code).toBe(2);
  });
  test("ein Config-Fehler ist ebenfalls fail-closed", () => {
    const r = lauf(["--issue", "7"], {
      ticket: () => ({ title: sammel, labels: [] }),
      config: () => {
        throw new Error("Config fehlt");
      },
    });
    expect(r.out).toBe("xhigh nicht bestimmbar: Config fehlt\n");
    expect(r.code).toBe(2);
  });
  test("ein unbekanntes Flag, ein fehlendes --issue und eine falsche Nummer sind Aufruf-Fehler", () => {
    for (const argv of [["--issue", "7", "--x"], [], ["--issue", "abc"], ["--issue", "0"]]) {
      const r = lauf(argv, io({ title: sammel, labels: [] }));
      expect(r.code).toBe(2);
      expect(r.out.startsWith("xhigh nicht bestimmbar:")).toBe(true);
    }
  });
});
