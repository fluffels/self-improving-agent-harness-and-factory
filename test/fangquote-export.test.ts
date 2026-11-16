/* Fangquote-Export (factory#607): Verhalten von scripts/fangquote-export.mjs. IO ist injiziert, nur Fixtures. */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as exportModul from "../scripts/fangquote-export.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { leseMesspunkte } from "../scripts/aenderungsregister-lib.mjs";

const ex = exportModul as unknown as {
  waechterDateien: (o: string, d: { wurzel: string; liste: (p: string) => string[] }) => string[];
  lauf: (a: string[], d: Record<string, unknown>) => { exitCode: number; text: string };
};
const lese = leseMesspunkte as (j: unknown, p: string) => { quelle: string; punkte: { parameter: string; wert: number; einheitId: string }[] };

const A = "test/harness/a.test.ts";
const B = "test/harness/b.test.ts";
const pkg = { name: "beispiel", version: "1.0.0", scripts: { lint: "x", test: "vitest run", verify: "npm run lint && npm test" } };
const z = (sek: number, text: string) => `Tests\tVerify\t2026-11-01T10:00:${String(sek).padStart(2, "0")}.1Z ${text}`;
const ciLog = (fehlerBlock: string[]) =>
  [z(0, "##[group]Run npm test"), z(1, "> beispiel@1.0.0 test"), ...fehlerBlock.map((t, i) => z(2 + i, t)), z(30, " Test Files  1 failed | 1 passed (2)"), z(31, "##[error]Process completed with exit code 1.")].join("\n");
const basis = (log: string, extra: Record<string, unknown> = {}) => ({
  bezieher: false, dateien: [A, B], pkg, findeSessions: () => [], liesDatei: () => log, jetzt: () => Date.parse("2026-11-02T00:00:00Z"), ...extra,
});
const ARGS = ["--von", "2026-11-01", "--bis", "2026-11-02", "--ci-log", "x.txt"];

describe("lauf", () => {
  test("ein roter Wächter ergibt 1, der grüne daneben 0; das Ergebnis besteht leseMesspunkte", () => {
    const r = ex.lauf(ARGS, basis(ciLog([` FAIL  ${A} > t`, "AssertionError: x"])));
    expect(r.exitCode).toBe(0);
    const e = lese(JSON.parse(r.text), "x");
    expect(e.quelle).toBe("gate-fundquote");
    expect(e.punkte.map((p) => [p.parameter, p.wert])).toEqual([[A, 1], [B, 0]]);
    expect(new Set(e.punkte.map((p) => p.einheitId)).size).toBe(1);
  });

  test("Negativfall: ein Zeitlimit ist kein Fang, die Datei bekommt in diesem Lauf keinen Punkt", () => {
    const r = ex.lauf(ARGS, basis(ciLog([` FAIL  ${A} > t`, "Error: Test timed out in 5000ms."])));
    expect(lese(JSON.parse(r.text), "x").punkte.map((p) => [p.parameter, p.wert])).toEqual([[B, 0]]);
  });

  test("Negativfall: ohne Logs im Fenster keine Punkte, die Lücke nennt den Grund (nie eine 0)", () => {
    const r = ex.lauf(["--von", "2026-11-01", "--bis", "2026-11-02"], basis(""));
    const e = JSON.parse(r.text) as { punkte: unknown[]; luecke: string };
    expect(e.punkte).toEqual([]);
    expect(e.luecke).toMatch(/keine Logs im Fenster/);
  });

  test("Läufe ohne Vitest-Ausgabe (nur Kopfzeile) liefern ebenfalls eine Lücke, keine Nullen", () => {
    const log = [z(0, "##[group]Run npm run lint"), z(1, "> beispiel@1.0.0 lint"), z(2, "fertig")].join("\n");
    const e = JSON.parse(ex.lauf(ARGS, basis(log)).text) as { punkte: unknown[]; luecke: string };
    expect(e.punkte).toEqual([]);
    expect(e.luecke).toMatch(/keine gezählten Läufe mit Vitest-Ausgabe/);
  });

  test("ohne Testdateien unter dem Ordner ist es eine Lücke mit Ordnernamen", () => {
    const e = JSON.parse(ex.lauf([...ARGS, "--waechter-dir", "test/leer"], basis(ciLog([]), { dateien: [] })).text) as { luecke: string };
    expect(e.luecke).toBe("keine Testdateien unter test/leer");
  });

  test("Bezieher: Abbruch mit Exit 4 und dem Wort fabrik-eigen", () => {
    const r = ex.lauf(ARGS, basis("", { bezieher: true }));
    expect(r.exitCode).toBe(4);
    expect(r.text).toContain("fabrik-eigen");
  });

  test("Aufruffehler des Kern-Skripts bleiben Exit 2 mit Text; --waechter-dir ohne Wert ebenso", () => {
    expect(ex.lauf(["--von", "kaputt"], basis("")).exitCode).toBe(2);
    expect(ex.lauf(["--waechter-dir"], basis("")).exitCode).toBe(2);
  });
});

describe("Hilfen", () => {
  test("waechterDateien: nur Testdateien, mit / und relativ zur Wurzel, sortiert", () => {
    const liste = () => ["b.test.ts", "sub\\a.spec.mts", "hilfe.ts", "README.md"];
    expect(ex.waechterDateien("test/harness", { wurzel: "/w", liste })).toEqual(["test/harness/b.test.ts", "test/harness/sub/a.spec.mts"]);
  });
});
