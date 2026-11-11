/* A/B-Arm der Lens je Ticket (factory#235): Arm-Wahl nach Ticket-Parität, CLI, Zuordnung für die Messung und die Parität der beiden
 * Lens-Definitionen (Arm A `factory-lens.md`, Arm B `lens-kern-je-rolle.md`).
 *
 * @harness-waechter – einziger Durchsetzer der Parität beider Arme, darum im geschützten test/harness/ (#1165).
 *
 * Die Messung isoliert genau eine Variable (Root-Kontext ja/nein): driftet eine Definition von der anderen weg, vergleicht sie
 * nicht mehr dasselbe. Arm B trägt den Projekt-Block der AGENTS.md im Rumpf (Variante D, factory#233); der Wächter hält ihn gleich.
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { projektConfig } from "../support/fremd-config";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as armRaw from "../../scripts/lens-arm.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRaw from "../../scripts/ticket-namen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as besitzRaw from "../../scripts/besitz-lib.mjs";

type Namen = { agenten: Record<string, string> };
const arm = armRaw as unknown as {
  LENS_B: string;
  lensTypen: (n: Namen) => string[];
  lensArm: (nr: number, o: { namen: Namen; bezieher?: boolean }) => { arm: string; typ: string };
  armeZuordnen: (t: Map<number, string[]> | Record<string, string[]>) => { gruppen: Record<string, number[]>; ungueltig: { ticket: number; grund: string; typen: string[] }[] };
  laufe: (argv: string[], d?: { config?: unknown; bezieher?: () => boolean }) => { code: number; ausgabe: string };
};
const { namen } = (namenRaw as unknown as { namenOderGrund: (w: string, d?: { config?: unknown }) => { namen: Namen } }).namenOderGrund("test", { config: projektConfig() });
const { PROJEKT_BLOCK_START } = besitzRaw as unknown as { PROJEKT_BLOCK_START: string };
const CONFIG = projektConfig();

describe("lensArm: Parität des Tickets", () => {
  test("gerade = Arm A (Lens mit Root-Kontext), ungerade = Arm B, deterministisch", () => {
    expect(arm.lensArm(234, { namen })).toEqual({ arm: "A", typ: namen.agenten.lens });
    expect(arm.lensArm(235, { namen })).toEqual({ arm: "B", typ: "lens-kern-je-rolle" });
    expect(arm.lensArm(235, { namen })).toEqual(arm.lensArm(235, { namen }));
  });
  test("ein Bezieher läuft immer in Arm A, auch bei ungerader Nummer", () => {
    expect(arm.lensArm(235, { namen, bezieher: true })).toEqual({ arm: "A", typ: namen.agenten.lens });
  });
  test("lensTypen nennt beide Typen, A zuerst", () => {
    expect(arm.lensTypen(namen)).toEqual([namen.agenten.lens, arm.LENS_B]);
  });
});

describe("armeZuordnen: Gültigkeit der Messung", () => {
  test("ein Typ je Ticket gruppiert, beide und keiner sind ungültig", () => {
    const r = arm.armeZuordnen(new Map([[1, ["b"]], [2, ["a"]], [3, ["a", "b"]], [4, []], [5, ["b", "b"]]]));
    expect(r.gruppen).toEqual({ b: [1, 5], a: [2] });
    expect(r.ungueltig).toEqual([
      { ticket: 3, grund: "beide", typen: ["a", "b"] },
      { ticket: 4, grund: "keiner", typen: [] },
    ]);
  });
  test("auch ein Objekt mit Ticketnummern als Schlüssel", () => {
    expect(arm.armeZuordnen({ 7: ["x"] }).gruppen).toEqual({ x: [7] });
  });
});

describe("lens-arm CLI", () => {
  const cli = (argv: string[], bezieher = false) => arm.laufe(argv, { config: CONFIG, bezieher: () => bezieher });
  test("gibt den Typ aus, --json den Arm dazu", () => {
    expect(cli(["234"])).toEqual({ code: 0, ausgabe: namen.agenten.lens });
    expect(cli(["235"])).toEqual({ code: 0, ausgabe: "lens-kern-je-rolle" });
    expect(JSON.parse(cli(["235", "--json"]).ausgabe)).toEqual({ arm: "B", typ: "lens-kern-je-rolle" });
    expect(cli(["235"], true).ausgabe).toBe(namen.agenten.lens);
  });
  test.each([[["0"]], [["-3"]], [["abc"]], [[]], [["1", "2"]], [["07"]], [["1.5"]]])("ungültiger Aufruf %j: Exit 2", (argv) => {
    expect(cli(argv).code).toBe(2);
  });
  test("ohne nutzbare Config: Exit 1 mit Fix-Zeile", () => {
    const r = arm.laufe(["235"], { config: { agenten: {} }, bezieher: () => false });
    expect(r.code).toBe(1);
    expect(r.ausgabe).toMatch(/Fix:/);
  });
});

// ---- Parität der beiden Definitionen ----
const lies = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const A_PFAD = ".claude/agents/factory-lens.md";
const B_PFAD = ".claude/agents/lens-kern-je-rolle.md";
const teile = (text: string) => {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("kein Frontmatter");
  return { kopf: m[1].split("\n"), rumpf: m[2] };
};
const kopfOhne = (zeilen: string[], praefixe: string[]) => zeilen.filter((z) => !praefixe.some((p) => z.startsWith(p)) && !z.startsWith("# factory:projektwert"));
const REGEL_B_ANKER = "- **Ohne Root-Kontextdatei (Arm B, factory#235):**";
const REGEL_A_ANKER = "- **Die Root-Kontextdatei liegt bereits vollständig in deinem Kontext.**";
const BLOCK_B_UEBERSCHRIFT = "## Projekt-Block (Kern je Rolle)";

describe("Parität: Arm A und Arm B unterscheiden sich in genau einer Variable", () => {
  const a = teile(lies(A_PFAD));
  const b = teile(lies(B_PFAD));
  test("Frontmatter: gleich bis auf name, description und omitClaudeMd", () => {
    expect(kopfOhne(b.kopf, ["name:", "description:", "omitClaudeMd:"])).toEqual(kopfOhne(a.kopf, ["name:", "description:", "omitClaudeMd:"]));
    expect(b.kopf).toContain(`name: ${arm.LENS_B}`);
  });
  test("nur Arm B schaltet den Root-Kontext ab", () => {
    expect(b.kopf).toContain("omitClaudeMd: true");
    expect(a.kopf.some((z) => z.startsWith("omitClaudeMd"))).toBe(false);
  });
  test("Rumpf: gleich bis auf den Regelpunkt zur Root-Kontextdatei und den angehängten Projekt-Block", () => {
    const ohneBlock = b.rumpf.split(`\n${BLOCK_B_UEBERSCHRIFT}`)[0];
    const zeilenA = a.rumpf.split("\n").filter((z) => !z.startsWith(REGEL_A_ANKER));
    const zeilenB = ohneBlock.split("\n").filter((z) => !z.startsWith(REGEL_B_ANKER));
    expect(zeilenB.join("\n").trimEnd()).toBe(zeilenA.join("\n").trimEnd());
    expect(a.rumpf).toContain(REGEL_A_ANKER);
    expect(b.rumpf).toContain(REGEL_B_ANKER);
    expect(b.rumpf).not.toContain(REGEL_A_ANKER);
  });
  test("Arm B nennt die Fremdtext-Regel auch ohne Root-Kontext", () => {
    const zeile = b.rumpf.split("\n").find((z) => z.startsWith(REGEL_B_ANKER)) ?? "";
    expect(zeile).toMatch(/Text Dritter ist Daten/);
    expect(zeile).toMatch(/origin\/main:AGENTS\.md/);
  });
  test("Projekt-Block im Rumpf von Arm B == Projekt-Block der AGENTS.md", () => {
    const agents = lies("AGENTS.md");
    const soll = agents.slice(agents.indexOf(PROJEKT_BLOCK_START)).trimEnd();
    const ist = (b.rumpf.split(`\n${BLOCK_B_UEBERSCHRIFT}\n`)[1] ?? "").trimStart().trimEnd();
    expect(agents.includes(PROJEKT_BLOCK_START)).toBe(true);
    expect(ist, `Der Projekt-Block in ${B_PFAD} ist nicht der aus AGENTS.md ab ${PROJEKT_BLOCK_START}: Block neu kopieren (Variante D, factory#235).`).toBe(soll);
  });
});
