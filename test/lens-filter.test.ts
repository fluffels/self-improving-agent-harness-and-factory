/* Filterdurchlauf (factory#532): Parser, Fixliste, Arme, Verwerfen und CLI. Kern aus scripts/lens-filter.mjs, Arm aus scripts/nachweis-lib.mjs. */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/lens-filter.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as libRaw from "../scripts/nachweis-lib.mjs";

type Fix = { id: string; schwere: string; ort: string; brillen: string[]; befunde: string[] };
type Erg = { arm: string | null; fixliste: Fix[]; verworfen: { id: string; begruendung: string }[]; rundenZeile: string; pass: string };
const L = raw as unknown as {
  parseBerichte: (t: string) => { lens: string; funde: { schwere: string; befund: string; ort: string }[] }[];
  bildeFixliste: (l: unknown) => Fix[];
  verwerfe: (f: Fix[], a: { id: string; begruendung: string }[], arm: string | null) => { fixliste: Fix[]; verworfen: unknown[] };
  filtere: (o: { text: string; runde: number; ticket?: number | null; verwerfen?: { id: string; begruendung: string }[] }) => Erg;
  formatiere: (e: Erg) => string;
  liesArgumente: (a: string[]) => { runde: number; ticket: number | null; verwerfen: { id: string; begruendung: string }[] };
};
const { armAusTicket } = libRaw as unknown as { armAusTicket: (n: unknown) => string };
const SKRIPT = fileURLToPath(new URL("../scripts/lens-filter.mjs", import.meta.url));

const B = (name: string, ...zeilen: string[]) => `## Lens: ${name}\nVerdikt: x\n\n${zeilen.join("\n")}\n`;
const BLOCK = (ort: string, text = "Regression") => `- [❌ blockierend] ${text} — \`${ort}\` — Beleg`;
const SOLL = (ort: string, text = "Lücke") => `- [🔶 sollte]      ${text} — \`${ort}\` — Beleg`;
const HIN = (ort: string) => `- [⚠️ Hinweis]     Grenze — \`${ort}\` — Beleg`;

describe("armAusTicket", () => {
  test("durch 4 teilbar ⇒ vollablauf, sonst schlank", () => {
    for (const n of [4, 8, 532, 1000]) expect(armAusTicket(n)).toBe("vollablauf");
    for (const n of [1, 2, 3, 533, 534]) expect(armAusTicket(n)).toBe("schlank");
  });
  test("ungültige Nummern werfen", () => {
    for (const n of [0, -4, 1.5, Number.NaN, "532", null]) expect(() => armAusTicket(n)).toThrow();
  });
});

describe("parseBerichte", () => {
  test("liest Brillen, Schweren, Ort und Befund; Kombi-Lens und Umlaute", () => {
    const l = L.parseBerichte(B("Test-Adäquanz", BLOCK("a/b.mjs:12-14"), SOLL("x.ts:1"), HIN("y.ts:2")) + B("Kombiniert"));
    expect(l.map((x) => x.lens)).toEqual(["test-adaequanz", "kombiniert"]);
    expect(l[0].funde.map((f) => f.schwere)).toEqual(["blockierend", "sollte", "hinweis"]);
    expect(l[0].funde[0]).toMatchObject({ befund: "Regression", ort: "a/b.mjs:12-14" });
    expect(l[1].funde).toEqual([]);
  });
  test("Fehler: kein Lens-Block, unbekannte Brille, doppelte Brille", () => {
    expect(() => L.parseBerichte("nur Text")).toThrow(/kein Lens-Block/);
    expect(() => L.parseBerichte(B("Wetter"))).toThrow(/unbekannte Brille/);
    expect(() => L.parseBerichte(B("Doku") + B("doku"))).toThrow(/doppelt/);
  });
});

describe("Prüfbereich der Fundzeilen (L7, L8)", () => {
  const kopf = (verdikt: string, rest: string) => `## Lens: Doku\n${verdikt}${rest}`;
  test("L7: Fund direkt unter Verdikt, danach Scope-Absatz: 1 Hinweis, kein Fehler", () => {
    const t = kopf("Verdikt: x\n", `${HIN("a.md:1")}\n\nScope-Vorschläge:\n- Muster — \`x:1\`\n`);
    expect(L.parseBerichte(t)[0].funde).toHaveLength(1);
  });
  test("L8: unbekannte Marke, fehlendes '- ' und Liste ohne Marke werfen mit Lens und Zeile", () => {
    for (const zeile of ["- [❓ wichtig] Text — `a:1`", "[🔶 sollte] Text — `a:1`", "- a — `x:1`"]) {
      expect(() => L.parseBerichte(B("Doku", zeile))).toThrow(`Brille doku: Fundzeile ohne gültige Schwere-Marke oder ohne führendes "- ": ${zeile}`);
    }
  });
  test("L8: CLI Exit 2 bei Formfehler", () => {
    const r = spawnSync(process.execPath, [SKRIPT, "--runde", "1"], { input: B("Doku", "- [❓ wichtig] Text — `a:1`"), encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/doku/);
  });
  test("mehrere Leerzeilen nach Verdikt und Leerzeile vor Verdikt sind gültig", () => {
    expect(L.parseBerichte(kopf("Verdikt: x\n\n\n\n", `${HIN("a.md:1")}\n`))[0].funde).toHaveLength(1);
    expect(L.parseBerichte(`## Lens: Doku\n\nVerdikt: x\n\n${HIN("a.md:1")}\n`)[0].funde).toHaveLength(1);
  });
  test("Text nach der ersten Leerzeile hinter dem Fund-Absatz wird nicht geprüft", () => {
    const t = B("Doku", HIN("a.md:1")) + "\n- Protokoll — `x:1`\n[❓ x] frei\n";
    expect(L.parseBerichte(t)[0].funde).toHaveLength(1);
  });
});

describe("Fixliste und Runde-Zeile", () => {
  const text = B("Architektur", SOLL("b.ts:2"), BLOCK("a.ts:1"), HIN("h.ts:1")) + B("Requirement-Treue", BLOCK("A.ts:1"), SOLL("c.ts:3")) + B("Test-Adäquanz");
  test("gleiche Fundstelle und Schwere über Brillen wird ein Eintrag, Reihenfolge Schwere dann Ort, Hinweise fehlen", () => {
    const e = L.filtere({ text, runde: 1 });
    expect(e.fixliste.map((f) => [f.id, f.schwere, f.ort, f.brillen])).toEqual([
      ["F1", "blockierend", "a.ts:1", ["architektur", "requirement-treue"]],
      ["F2", "sollte", "b.ts:2", ["architektur"]],
      ["F3", "sollte", "c.ts:3", ["requirement-treue"]],
    ]);
  });
  test("gleiche Fundstelle mit unterschiedlicher Schwere bleibt getrennt, die Schwere ändert der Filter nie", () => {
    const e = L.filtere({ text: B("Architektur", BLOCK("a.ts:1")) + B("Doku", SOLL("a.ts:1")), runde: 1 });
    expect(e.fixliste.map((f) => f.schwere)).toEqual(["blockierend", "sollte"]);
  });
  test("Runde-Zeile zählt je Brille über die Original-Funde, Brille ohne Funde :0", () => {
    expect(L.filtere({ text, runde: 2 }).rundenZeile).toBe(
      "Runde 2: lenses=architektur,requirement-treue,test-adaequanz blocker=architektur:1,requirement-treue:1,test-adaequanz:0 sollte=architektur:1,requirement-treue:1,test-adaequanz:0 hinweis=architektur:1,requirement-treue:0,test-adaequanz:0",
    );
  });
  test("--runde muss eine ganze Zahl ≥ 1 sein", () => {
    expect(() => L.filtere({ text, runde: 0 })).toThrow(/--runde/);
    expect(() => L.filtere({ text, runde: Number.NaN })).toThrow(/--runde/);
  });
});

describe("Arme und Pass-Urteil", () => {
  test("ein Hinweis allein konvergiert in beiden Armen", () => {
    const t = B("Doku", HIN("x.md:1"));
    expect(L.filtere({ text: t, runde: 1 }).pass).toBe("konvergiert");
    expect(L.filtere({ text: t, runde: 1, ticket: 533 }).pass).toBe("konvergiert");
  });
  test("vollablauf: sollte löst Delta aus; ohne --ticket gleich, keine Arm-Zeile", () => {
    const t = B("Doku", SOLL("x.md:1"));
    expect(L.filtere({ text: t, runde: 1, ticket: 532 })).toMatchObject({ arm: "vollablauf", pass: "delta-noetig" });
    const ohne = L.filtere({ text: t, runde: 1 });
    expect(ohne).toMatchObject({ arm: null, pass: "delta-noetig" });
    expect(L.formatiere(ohne)).not.toMatch(/^arm=/m);
  });
  test("schlank: sollte verworfen mit Begründung konvergiert, blockierend nie; unverworfenes sollte (gefixt) zieht Delta nach", () => {
    const t = B("Doku", SOLL("x.md:1"));
    const e = L.filtere({ text: t, runde: 1, ticket: 533, verwerfen: [{ id: "F1", begruendung: "Bekannte Grenze, kein Verhaltensfehler" }] });
    expect(e).toMatchObject({ arm: "schlank", pass: "konvergiert", fixliste: [] });
    expect(e.verworfen).toHaveLength(1);
    expect(L.filtere({ text: t, runde: 1, ticket: 533 }).pass).toBe("delta-noetig");
    expect(L.formatiere(e)).toMatch(/arm=schlank\npass: konvergiert/);
  });
});

describe("Verwerfen: Negativfälle (K5)", () => {
  const fix = (): Fix[] => L.bildeFixliste(L.parseBerichte(B("Doku", BLOCK("a.md:1"), SOLL("b.md:2"))));
  test("blockierender Fund: Fehler, nichts verworfen (auch nicht der gültige zweite Auftrag)", () => {
    const f = fix();
    const vorher = JSON.stringify(f);
    expect(() => L.verwerfe(f, [{ id: "F2", begruendung: "gut" }, { id: "F1", begruendung: "gut" }], "schlank")).toThrow(/blockierend/);
    expect(JSON.stringify(f)).toBe(vorher);
  });
  test.each(["", "…", "...", "-", "  ", "<…>"])("leere Begründung %j: Fehler", (b) => {
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: b }], "schlank")).toThrow(/Begründung/);
  });
  test("unbekannte ID, doppelte ID und Arm vollablauf bzw. ohne Arm: Fehler", () => {
    expect(() => L.verwerfe(fix(), [{ id: "F9", begruendung: "x y" }], "schlank")).toThrow(/unbekannte/);
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: "x y" }, { id: "F2", begruendung: "x y" }], "schlank")).toThrow(/doppelt/);
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: "x y" }], "vollablauf")).toThrow(/nur im Arm schlank/);
    expect(() => L.verwerfe(fix(), [{ id: "F2", begruendung: "x y" }], null)).toThrow(/nur im Arm schlank/);
  });
});

describe("liesArgumente", () => {
  test("Argumente, Begründung darf = enthalten", () => {
    expect(L.liesArgumente(["--runde", "2", "--ticket", "533", "--verwerfen", "F1=a=b"])).toEqual({ runde: 2, ticket: 533, verwerfen: [{ id: "F1", begruendung: "a=b" }] });
  });
  test("Fehler: fehlender Wert, kaputtes Verwerfen, unbekanntes Argument", () => {
    expect(() => L.liesArgumente(["--runde"])).toThrow();
    expect(() => L.liesArgumente(["--verwerfen", "F1"])).toThrow(/F<k>=/);
    expect(() => L.liesArgumente(["--foo"])).toThrow(/unbekannt/i);
  });
});

describe("CLI", () => {
  const lauf = (args: string[], input: string) => spawnSync(process.execPath, [SKRIPT, ...args], { input, encoding: "utf8" });
  const text = B("Doku", BLOCK("a.md:1"), SOLL("b.md:2"));
  test("Exit 0 mit Fixliste, Runde-Zeile, Arm und pass", () => {
    const r = lauf(["--runde", "1", "--ticket", "533", "--verwerfen", "F2=Kosmetik, kein Verhaltensfehler"], text);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/F1 \[blockierend\]/);
    expect(r.stdout).toMatch(/verworfen F2/);
    expect(r.stdout).toMatch(/Runde 1: lenses=doku blocker=doku:1 sollte=doku:1 hinweis=doku:0/);
    expect(r.stdout).toMatch(/pass: delta-noetig/);
  });
  test("Exit 2: Verwerfen eines blockierenden Funds, leere Begründung, fehlende --runde, kein Bericht", () => {
    expect(lauf(["--runde", "1", "--ticket", "533", "--verwerfen", "F1=guter Grund"], text).status).toBe(2);
    expect(lauf(["--runde", "1", "--ticket", "533", "--verwerfen", "F2=…"], text).status).toBe(2);
    expect(lauf([], text).status).toBe(2);
    expect(lauf(["--runde", "1"], "leer").status).toBe(2);
  });
});

describe("Fundstelle, Zusammenfassen, Sortierung (Review-Runde 1)", () => {
  const ortSicher = (zeile: string) => L.parseBerichte(B("Doku", zeile))[0].funde[0];
  test("Code im Befundtext ist nicht die Fundstelle: zwei Funde mit Backticks im Text bleiben getrennt", () => {
    const a = "- [🔶 sollte] Feld `arm=` fehlt — `scripts/a.mjs:74` — Beleg";
    const b = "- [🔶 sollte] Feld `arm=` fehlt — `docs/b.md:28` — Beleg";
    const e = L.filtere({ text: B("Architektur", a) + B("Doku", b), runde: 1 });
    expect(e.fixliste.map((f) => f.ort)).toEqual(["docs/b.md:28", "scripts/a.mjs:74"]);
    expect(e.fixliste[0].befunde[0]).toBe("Feld `arm=` fehlt");
  });
  test("ohne Trenner gilt der letzte Backtick-Abschnitt in Pfad-Form, ohne Pfad-Form kein Ort", () => {
    expect(ortSicher("- [🔶 sollte] x `code` bei `a/b.ts:3`").ort).toBe("a/b.ts:3");
    expect(ortSicher("- [🔶 sollte] nur `code` im Text").ort).toBe("");
    expect(ortSicher("- [🔶 sollte] x — `` — y").ort).toBe("");
    expect(ortSicher("- [🔶 sollte] x — ` a.ts:1 ` — y").ort).toBe("a.ts:1");
  });
  test("Fundstelle: erster Abschnitt nach dem Trenner, auch wenn der Beleg selbst Code in Backticks trägt", () => {
    expect(ortSicher("- [🔶 sollte] x — `a/b.ts:1` — `c.ts` ist betroffen").ort).toBe("a/b.ts:1");
    expect(ortSicher("- [🔶 sollte] x — `a.ts:1` — siehe `b.ts:2`").ort).toBe("a.ts:1");
    expect(ortSicher("- [🔶 sollte] x — `README` — Beleg").ort).toBe("README");
    expect(ortSicher("- [🔶 sollte] Datei `c.ts` falsch – `a.ts:1` – Beleg").ort).toBe("a.ts:1");
    expect(ortSicher("- [🔶 sollte] x —`a.ts:1`").ort).toBe("a.ts:1");
  });
  test("Trenner-Regel: Halbgeviertstrich einzeln, kein Leerraum nach dem Trenner, Anker am Ende, einfacher Bindestrich ist kein Trenner", () => {
    expect(ortSicher("- [🔶 sollte] x – `README` – siehe `b.ts:2`").ort).toBe("README");
    expect(ortSicher("- [🔶 sollte] x —`README` siehe `b.ts:2`").ort).toBe("README");
    expect(ortSicher("- [🔶 sollte] x — y `foo` z — `README`").ort).toBe("README");
    expect(ortSicher("- [🔶 sollte] Flag - `--force` fehlt — `README`").ort).toBe("README");
  });
  test("Pfad-Form ohne Trenner: jede Alternative einzeln (/, ., :zeile), der letzte Treffer gilt", () => {
    for (const ort of ["docs/README", "README.md", "Makefile:3"]) expect(ortSicher(`- [🔶 sollte] Code \`x\` bei \`${ort}\``).ort).toBe(ort);
    expect(ortSicher("- [🔶 sollte] `a.ts:1` und `b.ts:2` kaputt").ort).toBe("b.ts:2");
  });
  test("FUND_RE: Quantoren der Klammer und des Striches", () => {
    expect(ortSicher("-[sollte] x — `a.ts:1`").schwere).toBe("sollte");
    expect(ortSicher("- [sollte] x — `a.ts:1`").schwere).toBe("sollte");
    expect(ortSicher("- [❌  blockierend] x — `a.ts:1`").schwere).toBe("blockierend");
  });
  test("Sortierung: Schwere vor Fundstelle, gleich schwere nach Fundstelle unabhängig von der Eingabereihenfolge", () => {
    const e = L.filtere({ text: B("Doku", SOLL("a.ts:1"), BLOCK("z.ts:1"), SOLL("c.ts:1"), SOLL("b.ts:1")), runde: 1 });
    expect(e.fixliste.map((f) => f.ort)).toEqual(["z.ts:1", "a.ts:1", "b.ts:1", "c.ts:1"]);
  });
  test("Fundstellen werden normalisiert (Backslash, Leerraum, Groß-/Kleinschreibung), Brillen nur einmal gelistet", () => {
    const e = L.filtere({ text: B("Doku", SOLL("a\\b.md: 1"), SOLL("A/B.md:1")) + B("Architektur", SOLL("a/b.md:1")), runde: 1 });
    expect(e.fixliste).toHaveLength(1);
    expect(e.fixliste[0].brillen).toEqual(["doku", "architektur"]);
  });
  test("Funde ohne Ort: gleicher Befundtext (ohne Groß-/Kleinschreibung) ein Eintrag, anderer getrennt, Ort (ohne Ort)", () => {
    const o = (t: string) => `- [🔶 sollte] ${t}`;
    const e = L.filtere({ text: B("Doku", o("Lücke A"), o("lücke a"), o("Lücke B")), runde: 1 });
    expect(e.fixliste.map((f) => f.ort)).toEqual(["(ohne Ort)", "(ohne Ort)"]);
  });
  test("CRLF-Berichte werden gelesen", () => {
    const e = L.filtere({ text: B("Doku", BLOCK("a.md:1")).replace(/\n/g, "\r\n"), runde: 1 });
    expect(e.fixliste).toHaveLength(1);
  });
  test("Zeilenform: Klammerinhalt mit anderem Wort, Einrückung, fehlende Leerzeichen, Groß-/Kleinschreibung des Kopfs", () => {
    expect(L.parseBerichte(B("Doku", "- [nicht blockierend] x — `a.md:1`"))[0].funde).toEqual([]);
    expect(L.parseBerichte(B("Doku", "  - [❌blockierend]x — `a.md:1` — b"))[0].funde).toHaveLength(1);
    expect(L.parseBerichte(B("Doku", "Text - [❌ blockierend] x — `a.md:1`"))[0].funde).toEqual([]);
    expect(L.parseBerichte("## lens: doku\n- [⚠️ Hinweis] x — `a.md:1` — b\n")[0].funde).toHaveLength(1);
  });
  test("Funde vor dem ersten Lens-Kopf zählen nicht; leere Fixliste steht als (leer)", () => {
    const l = L.parseBerichte(`${BLOCK("v.md:1")}\n${B("Doku")}`);
    expect(l[0].funde).toEqual([]);
    expect(L.formatiere(L.filtere({ text: B("Doku", HIN("a.md:1")), runde: 1 }))).toMatch(/\(leer\)/);
  });
  test("Argumente: strenge Zahlen und F-IDs", () => {
    for (const a of [["--ticket", "1e3"], ["--ticket", "5x"], ["--runde", "x1"], ["--verwerfen", "xF1=a"], ["--verwerfen", "F=a"], ["--verwerfen", "F1x=a"]]) {
      expect(() => L.liesArgumente(a)).toThrow();
    }
    expect(L.liesArgumente(["--runde", "3"])).toMatchObject({ runde: 3, ticket: null });
  });
});
