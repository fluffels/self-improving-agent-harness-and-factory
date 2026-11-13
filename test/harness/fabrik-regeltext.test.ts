/* Fabrik-Regeltext-Wächter (factory#222, Fortschreibung zu ADR 0022, Form 4 aus factory#154): Regeltext, der nur für die Fabrik gilt, steht nicht in verteilten
 * Markdown-Einheiten, sondern im Projekt-Block der AGENTS.md oder auf einer Factory-Seite. Gilt ein Satz in beiden Rollen, trägt ihn
 * `test/harness/fabrik-regeltext-inventur.json` mit Ausschnitt und Grund ein.
 *
 * Scan-Umfang (geschlossen): jeder Manifest-Eintrag mit `wirdVerteilt(e)` und Pfad `*.md`, als Ganzdatei oder als Block (Zeilenversatz wie im Befunde-Wächter).
 * Suchliste (geschlossen, ohne Groß-/Kleinschreibung): Factory-Repo, Fabrik, upstream, ohne Sync-Stand, sync-stand.json, Rolle `factory`. Gezählt wird je Treffer.
 * Einordnung: `verweis` (Fabrik-Verweis `<x>.md (Fabrik)`, factory#177), `beide` (Eintrag der Inventur umschließt den Treffer in derselben Zeile), sonst `offen` = Fehler.
 * Grenzen: Heuristik mit einer Wortliste; Wörter außerhalb der Liste („Bezieher“, „Factory-Board“) fallen durch, Laufzeittexte in `.mjs` und Workflows sind nicht gescannt,
 * Codeblöcke werden mitgescannt. Der Ausschnitt bricht bei geänderter Formulierung (dann neu einordnen). Re-Evaluierung: mehr als 15 Einträge „beide“ oder wiederholte
 * Fehltreffer: Wächter enger fassen oder streichen (Wiedervorlage `regeln-verfall-2027-03`).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
import { ladeBesitzManifest } from "../support/besitz-anker";

const { blockSpanne, einheitId, wirdVerteilt } = rawBesitz as unknown as {
  blockSpanne: (text: string, block: string) => [number, number] | null;
  einheitId: (e: { pfad: string; block?: string; schluessel?: string }) => string;
  wirdVerteilt: (e: { ring: string }) => boolean;
};

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const SUCHLISTE = /Factory-Repo|Fabrik|upstream|ohne Sync-Stand|sync-stand\.json|Rolle `factory`/gi;
const VERWEIS = /\.md \(Fabrik\)$/i;
const INVENTUR = "test/harness/fabrik-regeltext-inventur.json";
const WEG = "Regeltext nur für die Fabrik gehört in den Projekt-Block der AGENTS.md oder auf eine Factory-Seite (Form 4, Fortschreibung factory#154); gilt er in beiden Rollen: Eintrag mit Grund in test/harness/fabrik-regeltext-inventur.json";

export type Einheit = { id: string; text: string; ab: number };
export type InventurEintrag = { einheit: string; ausschnitt: string; einordnung: string; grund: string };
export type Treffer = { id: string; zeile: number; wort: string; einordnung: "verweis" | "beide" | "offen"; eintrag?: InventurEintrag };

const deckt = (e: InventurEintrag, id: string, zeile: string, von: number, bis: number): boolean => {
  if (e.einheit !== id || e.ausschnitt === "") return false;
  for (let p = zeile.indexOf(e.ausschnitt); p >= 0; p = zeile.indexOf(e.ausschnitt, p + 1)) if (p <= von && p + e.ausschnitt.length >= bis) return true;
  return false;
};

/** Pur: ein Element je Treffer der Suchliste; `ab` ist die Zeilennummer der ersten Zeile des Textes. */
export function inventur(einheiten: Einheit[], eintraege: InventurEintrag[]): Treffer[] {
  return einheiten.flatMap((u) =>
    u.text.split("\n").flatMap((zeile, i) =>
      [...zeile.matchAll(SUCHLISTE)].map((m): Treffer => {
        const von = m.index ?? 0;
        const bis = von + m[0].length;
        const base = { id: u.id, zeile: u.ab + i, wort: m[0] };
        if (m[0].toLowerCase() === "fabrik" && VERWEIS.test(zeile.slice(0, bis + 1))) return { ...base, einordnung: "verweis" };
        const eintrag = eintraege.find((e) => deckt(e, u.id, zeile, von, bis));
        return eintrag ? { ...base, einordnung: "beide", eintrag } : { ...base, einordnung: "offen" };
      }),
    ),
  );
}

/** Pur: Meldungen (leer = grün): offene Treffer, stale Einträge, leerer Grund, falsche Einordnung. */
export function meldungen(einheiten: Einheit[], eintraege: InventurEintrag[]): string[] {
  const t = inventur(einheiten, eintraege);
  const benutzt = new Set(t.flatMap((x) => (x.eintrag ? [x.eintrag] : [])));
  return [
    ...t.filter((x) => x.einordnung === "offen").map((x) => `${x.id}:${x.zeile}: Fundstelle „${x.wort}“ ohne Einordnung: ${WEG}`),
    ...eintraege.filter((e) => !benutzt.has(e)).map((e) => `Inventur-Eintrag ohne Treffer (stale): ${e.einheit} „${e.ausschnitt}“; Eintrag entfernen oder neu einordnen`),
    ...eintraege.filter((e) => e.grund.trim() === "").map((e) => `Inventur-Eintrag ohne Grund: ${e.einheit} „${e.ausschnitt}“`),
    ...eintraege.filter((e) => e.einordnung !== "beide").map((e) => `Inventur-Eintrag mit Einordnung „${e.einordnung}“: ${e.einheit} „${e.ausschnitt}“; nur „beide“ wird eingetragen, nur Fabrik umziehen statt eintragen`),
  ];
}

type Eintrag = { pfad: string; ring: string; block?: string; schluessel?: string };
const lies = (pfad: string) => readFileSync(`${WURZEL}${pfad}`, "utf8");

/** Die verteilten Markdown-Einheiten (Ganzdatei oder Block) des Besitz-Manifests. */
function umfang(eintraege: Eintrag[] = ladeBesitzManifest<Eintrag>().eintraege): Einheit[] {
  const gesehen = new Map<string, Einheit>();
  for (const e of eintraege.filter((x) => wirdVerteilt(x) && x.pfad.endsWith(".md"))) {
    const id = einheitId(e);
    if (gesehen.has(id)) continue;
    const text = lies(e.pfad);
    if (e.block === undefined) {
      gesehen.set(id, { id, text, ab: 1 });
      continue;
    }
    const s = blockSpanne(text, e.block);
    if (s === null) throw new Error(`${e.pfad}: Block ${e.block} nicht gefunden (Marker fehlen)`);
    gesehen.set(id, { id, text: text.slice(s[0], s[1]), ab: text.slice(0, s[0]).split("\n").length });
  }
  return [...gesehen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const ladeInventur = (): InventurEintrag[] => (JSON.parse(lies(INVENTUR)) as { eintraege: InventurEintrag[] }).eintraege;
const einheit = (text: string, id = "x.md", ab = 1): Einheit => ({ id, text, ab });
const eintrag = (ausschnitt: string, id = "x.md", extra: Partial<InventurEintrag> = {}): InventurEintrag => ({ einheit: id, ausschnitt, einordnung: "beide", grund: "g", ...extra });

describe("Fabrik-Regeltext in verteilten Texten (factory#222)", () => {
  test("der echte Scan ist leer: jede Fundstelle ist Verweis oder in der Inventur als „beide“ eingeordnet", () => {
    expect(meldungen(umfang(), ladeInventur())).toEqual([]);
  });

  test("Beleg der Inventur: ohne Einträge ist jeder Treffer offen oder ein Verweis (7 Verweise, 8 Treffer „beide“)", () => {
    const t = inventur(umfang(), []);
    expect(t.filter((x) => x.einordnung === "verweis")).toHaveLength(7);
    expect(t.filter((x) => x.einordnung === "offen").length).toBe(8);
  });

  test("ein Treffer ohne Eintrag ist offen und die Meldung nennt den Weg (AK1-Negativfall)", () => {
    const m = meldungen([einheit("a\nEin Satz über das Factory-Repo.", "x.md", 5)], []);
    expect(m).toHaveLength(1);
    expect(m[0]).toContain("x.md:6: Fundstelle „Factory-Repo“ ohne Einordnung");
    expect(m[0]).toContain("Projekt-Block der AGENTS.md");
    expect(m[0]).toContain("fabrik-regeltext-inventur.json");
  });

  test("AK3-Negativfall: ein nur für die Fabrik geltender Satz wird offen", () => {
    const t = inventur([einheit("die Baseline `test/harness/kern-literale-baseline.json` (nur im Factory-Repo) sinkt nur;")], []);
    expect(t.map((x) => x.einordnung)).toEqual(["offen"]);
  });

  test("jede Alternative der Suchliste trifft, ohne Groß-/Kleinschreibung", () => {
    for (const z of ["im Factory-Repo", "die Fabrik", "Upstream", "ohne Sync-Stand", "`.factory/sync-stand.json`", "Rolle `factory`", "im FACTORY-REPO"]) expect(inventur([einheit(z)], []), z).toHaveLength(1);
    expect(inventur([einheit("Bezieher und Factory-Board")], [])).toEqual([]);
  });

  test("Verweisform `<x>.md (Fabrik)` ist verweis, ein blankes „Fabrik“ in derselben Zeile bleibt offen (je Treffer)", () => {
    const t = inventur([einheit("docs/a.md (Fabrik) § 2 und die Fabrik selbst")], []);
    expect(t.map((x) => x.einordnung)).toEqual(["verweis", "offen"]);
    expect(inventur([einheit("docs/a.md (Fabrik)")], [])[0]?.einordnung).toBe("verweis");
    expect(inventur([einheit("a (Fabrik)")], [])[0]?.einordnung).toBe("offen");
  });

  test("ein Ausschnitt deckt nur den Treffer, den er umschließt, nur in seiner Einheit und Zeile", () => {
    const text = "die Fabrik hier und anderswo die Fabrik";
    expect(inventur([einheit(text)], [eintrag("hier und anderswo die Fabrik")]).map((x) => x.einordnung)).toEqual(["offen", "beide"]);
    expect(inventur([einheit(text)], [eintrag("die Fabrik", "y.md")]).map((x) => x.einordnung)).toEqual(["offen", "offen"]);
    expect(inventur([einheit("a\nb Fabrik")], [eintrag("a b Fabrik")]).map((x) => x.einordnung)).toEqual(["offen"]);
    expect(inventur([einheit("Fabrik")], [eintrag("")]).map((x) => x.einordnung)).toEqual(["offen"]);
  });

  test("rot bei stale Eintrag, leerem Grund und Einordnung „nur Fabrik“", () => {
    const e = [einheit("die Fabrik")];
    expect(meldungen(e, [eintrag("die Fabrik"), eintrag("Phantom")])).toEqual([expect.stringContaining("stale): x.md „Phantom“")]);
    expect(meldungen(e, [eintrag("die Fabrik", "x.md", { grund: " " })])).toEqual([expect.stringContaining("ohne Grund")]);
    expect(meldungen(e, [eintrag("die Fabrik", "x.md", { einordnung: "nur Fabrik" })])).toEqual([expect.stringContaining("umziehen statt eintragen")]);
  });

  test("Blockversatz: die Zeilennummer zählt ab `ab`", () => {
    expect(inventur([einheit("x\nFabrik", "x.md", 10)], [])[0]?.zeile).toBe(11);
  });

  test("fail-closed: die Scan-Menge enthält Kern-Block, Umsetzer und Factory-Skill; der Kern-Block ist nicht leer", () => {
    const u = umfang();
    const ids = u.map((x) => x.id);
    expect(ids).toContain("AGENTS.md#kern");
    expect(ids).toContain(".claude/agents/factory-umsetzer.md");
    expect(ids).toContain(".agents/skills/factory/SKILL.md");
    expect(u.find((x) => x.id === "AGENTS.md#kern")?.text.length).toBeGreaterThan(1000);
  });
});
