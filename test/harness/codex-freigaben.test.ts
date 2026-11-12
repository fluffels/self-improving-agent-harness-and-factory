/* @harness-waechter: Die Codex-Freigabetabelle verlangt je Version einen Diagnose-Beleg (https-URL) und je Nachweis 1-5 `offen` oder einen Beleg; im Repo-Stand ist keine Version autonom freigegeben.
 * Scan-Grenzen: `export * from` und dynamisches `import()` in der Tabelle sowie ein Re-Export der Tabelle über andere Dateien sind nicht erfasst (Scan iii bzw. ii).
 * Scan-Grenzen (geschlossene Listen): Versionsliteral nur in drei Codex-Dateien geprüft; Importe der Tabelle nur direkt unter scripts/, ein transitiver Import über die Vorprüfung ist nicht erfasst. */
import { expect, test } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error: Node-Tooling ohne Declaration-Datei.
import * as raw from "../../scripts/codex-freigaben.mjs";
type Tabelle = Record<string, unknown>;
const f = raw as unknown as { BELEG_URL_QUELLE: string; FREIGABEN: Tabelle; istBelegUrl: (v: unknown) => boolean; tabellenMaengel: (t: Tabelle) => string[]; offeneNachweise: (e: unknown) => number[] };
const URL_OK = "https://api.github.com/repositories/1/pulls/1";
const beleg = { beleg: URL_OK };
const voll = () => ({ diagnose: URL_OK, nachweise: { 1: beleg, 2: beleg, 3: beleg, 4: beleg, 5: beleg } as Record<string, unknown> });
const eine = (e: unknown, v = "1.2.3") => f.tabellenMaengel({ [v]: e });

test("die Tabelle des Repo-Stands ist wohlgeformt", () => {
  expect(f.tabellenMaengel(f.FREIGABEN)).toEqual([]);
  expect(eine(voll())).toEqual([]);
});
test("jeder Formfehler ist ein eigener Mangel", () => {
  const ohneDiagnose = { ...voll(), diagnose: undefined };
  for (const e of [ohneDiagnose, { ...voll(), diagnose: "http://x.example/1" }, { ...voll(), diagnose: "pull/82" }]) expect(eine(e)).toEqual([expect.stringContaining("Diagnose-Beleg")]);
  const mit = (k: string, w: unknown) => ({ ...voll(), nachweise: { ...voll().nachweise, [k]: w } });
  expect(eine(mit("2", { beleg: "" }))).toEqual([expect.stringContaining("Nachweis 2")]);
  expect(eine(mit("2", { beleg: "ftp://x.example/a" }))).toEqual([expect.stringContaining("Nachweis 2")]);
  expect(eine(mit("3", null))).toEqual([expect.stringContaining("Nachweis 3")]);
  expect(eine(mit("3", "grenze"))).toEqual([expect.stringContaining("Nachweis 3")]);
  expect(eine(mit("3", { beleg: URL_OK, extra: 1 }))).toEqual([expect.stringContaining("Nachweis 3")]);
  const ohne5 = voll(); delete ohne5.nachweise["5"];
  expect(eine(ohne5)).toEqual([expect.stringContaining("genau 1-5")]);
  expect(eine(mit("6", "offen"))).toEqual([expect.stringContaining("genau 1-5")]);
  expect(eine(voll(), "x")).toEqual([expect.stringContaining("keine Version")]);
  expect(eine(null)).toEqual([expect.stringContaining("Eintrag fehlt")]);
  expect(eine({ diagnose: URL_OK, nachweise: null }).join()).toContain("genau 1-5");
});
test("istBelegUrl: nur die API-Form per Repo-ID mit abschließender ID (eine Stelle: BELEG_URL_QUELLE)", () => {
  expect(f.istBelegUrl(URL_OK)).toBe(true);
  for (const v of ["https://api.github.com/repositories/1/actions/runs/2", "https://api.github.com/repositories/1/issues/comments/5", "https://api.github.com/repositories/1434788646/pulls/82"]) expect(f.istBelegUrl(v), v).toBe(true);
  const nein = ["http://a.example/x", "ftp://a.example", "", "x", 5, null, "https://u:p@a.example/x", "https://u@a.example/x", "https://:p@a.example/x", ["https://a.example/x"],
    "https://a.example/x", "https://github.com/o/r/pull/1", "https://api.github.com/repos/o/r/pulls/1", "https://api.github.com/repositories/1/pulls/82?x=1", "https://api.github.com/repositories/1/pulls/82#a",
    "https://api.github.com/repositories/1/actions/secrets", "xhttps://api.github.com/repositories/1/pulls/82", "https://api.github.com/repositories/1/pulls/82/files/1", "https://api.github.com/repositories/1/pulls/x?y=1/2", ["https://api.github.com/repositories/1/pulls/82"], "https://u:p@api.github.com/repositories/1/pulls/82", "https://api.github.com/repositories/1/pulls/82\n"];
  for (const v of nein) expect(f.istBelegUrl(v), String(v)).toBe(false);
});
test("offeneNachweise: nur gültige Belege zählen als erbracht (fail-closed)", () => {
  expect(f.offeneNachweise(voll())).toEqual([]);
  expect(f.offeneNachweise({ nachweise: { ...voll().nachweise, 3: "offen" } })).toEqual([3]);
  expect(f.offeneNachweise({ nachweise: { ...voll().nachweise, 1: { beleg: "" } } })).toEqual([1]);
  expect(f.offeneNachweise(undefined)).toEqual([1, 2, 3, 4, 5]);
});
test("Repo-Stand: keine Version ist autonom freigegeben", () => {
  // Kind 6 (factory#368) stellt diese Aussage um.
  for (const [v, e] of Object.entries(f.FREIGABEN)) expect(f.offeneNachweise(e), v).not.toEqual([]);
});
const lies = (p: string) => readFileSync(p, "utf8");
test("kein Versionsliteral in belege, vorpruefung und lib", () => {
  for (const p of ["scripts/codex-belege.mjs", "scripts/codex-vorpruefung.mjs", "scripts/codex-lib.mjs"]) {
    const text = lies(p);
    expect(text.match(/(?<![\w.])\d+\.\d+\.\d+(?![\w.])/g) ?? [], p).toEqual([]);
  }
});
test("nur die Vorprüfung importiert die Tabelle; sie selbst ist pur", () => {
  const nennen = readdirSync("scripts", { recursive: true, encoding: "utf8" }).filter((p) => p.endsWith(".mjs") && p !== "codex-freigaben.mjs" && lies(join("scripts", p)).includes("codex-freigaben"));
  expect(nennen).toEqual(["codex-vorpruefung.mjs"]);
  expect(lies("scripts/codex-freigaben.mjs")).not.toMatch(/^\s*import[\s{(]/m);
});
test("freigabeMaengel: belegte Version keine oder ungültig, Versionsschlüssel exakt x.y.z", () => {
  const g = raw as unknown as { freigabeMaengel: (a: { installiert: string | null; belegt?: unknown; tabelle: Tabelle }) => string[] };
  const t = { "1.2.3": voll() };
  expect(g.freigabeMaengel({ installiert: "1.2.3", belegt: undefined, tabelle: t })).toEqual(["Codex CLI 1.2.3 weicht von der belegten Version keine ab"]);
  expect(g.freigabeMaengel({ installiert: "1.2.3", belegt: "böse\nzeile", tabelle: t })).toEqual(["Codex CLI 1.2.3 weicht von der belegten Version ungültig ab"]);
  expect(g.freigabeMaengel({ installiert: "1.2.3", belegt: "1.2.3", tabelle: t })).toEqual([]);
  for (const v of ["v1.2.3", "1.2.3.4", "1.2", "1x2x3", "1x2.3", "1.2x3"]) expect(eine(voll(), v)).toEqual([expect.stringContaining("keine Version")]);
  for (const v of ["10.0.0", "0.164.10", "10.20.30"]) expect(eine(voll(), v)).toEqual([]);
  expect(g.freigabeMaengel({ installiert: "1.2.3", belegt: ["1.2.3"], tabelle: t })).toEqual(["Codex CLI 1.2.3 weicht von der belegten Version ungültig ab"]);
  expect(g.freigabeMaengel({ installiert: undefined as unknown as null, belegt: "1.2.3", tabelle: t })).toEqual([expect.stringContaining("nicht ermittelbar")]);
  expect(g.freigabeMaengel({ installiert: "1.2.3", belegt: "1.2.3", tabelle: undefined as unknown as Tabelle })).toEqual([expect.stringContaining("nicht in der Freigabetabelle")]);
  expect(f.tabellenMaengel(undefined as unknown as Tabelle)).toEqual([]);
  for (const x of ["x", 5]) expect(eine(x)).toEqual([expect.stringContaining("Eintrag fehlt")]);
  const mitNull = { diagnose: URL_OK, nachweise: { ...voll().nachweise, 3: null } };
  expect(f.offeneNachweise(mitNull)).toEqual([3]);
  expect(g.freigabeMaengel({ installiert: "1.2.3", belegt: "1.2.3", tabelle: { "1.2.3": mitNull } }).join("\n")).toContain("Nachweise 3 ");
});
