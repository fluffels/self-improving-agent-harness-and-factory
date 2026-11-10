/* Harness-Doctor, Punkt `Board-Ansicht` (factory#247 L7, L9): reiner Punkt mit eingespeister Lese-Naht, kein Netz (der Punkt `Git-Hooks` steht in harness-doctor-githooks.test.ts). */
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { boardPunkte as rawBoardPunkte, BOARD_QUERY as rawQuery } from "../scripts/harness-doctor-board.mjs";

interface Ergebnis { punkt: string; ok: boolean; nichtPruefbar?: boolean; befund?: string; fix?: string; hinweis?: string }
type Antwort = unknown;
const boardPunkte = rawBoardPunkte as (a: { config: unknown; lesen: (args: string[]) => Antwort }) => Ergebnis[];
const BOARD_QUERY = rawQuery as string;

/** Wirft einen beliebigen Wert (auch Nicht-Error): die Lese-Nähte können alles werfen. */
const wirf = (wert: unknown): never => {
  throw wert;
};
const REPO = "acme/proj";
const CONFIG = { repo: REPO, boards: [{ rolle: "factory", besitzer: "acme", nummer: 2, projectId: "p_eins" }] };
const WF = [{ name: "Auto-add sub-issues to project", enabled: true }, { name: "Auto-archive items", enabled: true }];
const antwort = (over: { views?: unknown; workflows?: unknown } = {}) => ({
  data: { node: { views: "views" in over ? over.views : { nodes: [{ number: 1, filter: `-status:Done repo:${REPO}`, sortByFields: { nodes: [] } }] }, workflows: "workflows" in over ? over.workflows : { nodes: WF } } },
});
const lauf = (a: Antwort, config: unknown = CONFIG) => boardPunkte({ config, lesen: () => a });

describe("Board-Ansicht", () => {
  test("alles wie gewünscht: OK, die Abfrage nennt Projekt-ID, Ansichten, Sortierung und Workflows", () => {
    const aufrufe: string[][] = [];
    const r = boardPunkte({ config: CONFIG, lesen: (a) => { aufrufe.push(a); return antwort(); } });
    expect(r).toEqual([{ punkt: "Board-Ansicht", ok: true }]);
    expect(aufrufe).toHaveLength(1);
    expect(aufrufe[0]).toContain("id=p_eins");
    for (const wort of ["views", "filter", "sortByFields", "workflows", "enabled", "number"]) expect(BOARD_QUERY).toContain(wort);
  });
  test("Standardansicht ist die kleinste Nummer, nicht die erste in der Liste", () => {
    const views = { nodes: [{ number: 3, filter: "", sortByFields: { nodes: [] } }, { number: 1, filter: `-status:Done repo:${REPO}`, sortByFields: { nodes: [] } }] };
    expect(lauf(antwort({ views }))[0].ok).toBe(true);
  });
  test("Filter ohne -status:Done: Lücke mit Fix, der den Filter nennt", () => {
    const views = { nodes: [{ number: 1, filter: `repo:${REPO}`, sortByFields: { nodes: [] } }] };
    const p = lauf(antwort({ views }))[0];
    expect(p.ok).toBe(false);
    expect(p.nichtPruefbar).toBeUndefined();
    expect(p.befund).toContain("-status:Done");
    expect(p.fix).toContain(`-status:Done repo:${REPO}`);
  });
  test("Filter ohne repo des Boards oder mit fremdem Repo: Lücke", () => {
    for (const filter of ["-status:Done", "-status:Done repo:acme/anderes"]) {
      const p = lauf(antwort({ views: { nodes: [{ number: 1, filter, sortByFields: { nodes: [] } }] } }))[0];
      expect(p.ok, filter).toBe(false);
      expect(p.befund, filter).toContain(`repo:${REPO}`);
    }
  });
  test("das Repo steht beim Board, wenn es dort gesetzt ist (Vorrang vor dem Projekt-Repo); Groß-/Kleinschreibung zählt nicht", () => {
    const config = { repo: REPO, boards: [{ rolle: "produkt", besitzer: "acme", nummer: 1, projectId: "p_zwei", repo: "Acme/Prod" }] };
    const views = { nodes: [{ number: 1, filter: "-status:Done repo:acme/prod", sortByFields: { nodes: [] } }] };
    expect(lauf(antwort({ views }), config)[0].ok).toBe(true);
  });
  test("Sortierung gesetzt: Lücke (die manuelle Reihenfolge wäre aus)", () => {
    const views = { nodes: [{ number: 1, filter: `-status:Done repo:${REPO}`, sortByFields: { nodes: [{ direction: "ASC", field: { name: "Title" } }] } }] };
    const p = lauf(antwort({ views }))[0];
    expect(p.ok).toBe(false);
    expect(p.befund).toContain("Sortierung");
    expect(p.befund).toContain("Title");
    expect(p.fix).toContain("board-place");
  });
  test("Auto-archive aus oder fehlend: Lücke", () => {
    for (const nodes of [[{ name: "Auto-archive items", enabled: false }], [{ name: "Item closed", enabled: true }]]) {
      const p = lauf(antwort({ workflows: { nodes } }))[0];
      expect(p.ok).toBe(false);
      expect(p.befund).toContain("Auto-archive items");
    }
  });
  test("mehrere Abweichungen stehen zusammen in einem Befund", () => {
    const views = { nodes: [{ number: 1, filter: "", sortByFields: { nodes: [{ direction: "ASC", field: { name: "Title" } }] } }] };
    const p = lauf(antwort({ views, workflows: { nodes: [] } }))[0];
    expect(p.befund).toContain("-status:Done");
    expect(p.befund).toContain("Sortierung");
    expect(p.befund).toContain("Auto-archive items");
  });
  describe("NICHT PRÜFBAR statt grün", () => {
    const nicht = (a: Antwort, config: unknown = CONFIG) => {
      const r = lauf(a, config);
      expect(r).toHaveLength(1);
      expect(r[0].ok).toBe(false);
      expect(r[0].nichtPruefbar).toBe(true);
      return r[0];
    };
    test("Lesefehler (403, Netz)", () => {
      const r = boardPunkte({ config: CONFIG, lesen: () => { throw new Error("HTTP 403 Resource not accessible"); } });
      expect(r[0].nichtPruefbar).toBe(true);
      expect(r[0].befund).toContain("403");
    });
    test("Antwort ohne Projekt (Node null) oder ohne Daten", () => {
      nicht({ data: { node: null } });
      nicht({});
      nicht(null);
    });
    test("Feld fehlt in der Antwort: Ansichten, Filter, Sortierung, Workflows", () => {
      nicht(antwort({ views: null }));
      expect(nicht(antwort({ views: { nodes: [] } })).befund).toContain("views");
      nicht(antwort({ views: { nodes: [{ number: 1, sortByFields: { nodes: [] } }] } }));
      nicht(antwort({ views: { nodes: [{ number: 1, filter: `-status:Done repo:${REPO}` }] } }));
      nicht(antwort({ workflows: null }));
    });
    test("nichtPruefbar-Befund nennt, was fehlt (Grenze: nur Felder, die GraphQL liefert)", () => {
      expect(nicht(antwort({ workflows: null })).befund).toContain("workflows");
    });
    test("Board ohne projectId oder Config ohne Boards", () => {
      nicht(antwort(), { repo: REPO, boards: [{ rolle: "factory", besitzer: "acme", nummer: 2 }] });
      expect(boardPunkte({ config: { repo: REPO }, lesen: () => antwort() })).toEqual([]);
      expect(boardPunkte({ config: { repo: REPO, boards: [] }, lesen: () => antwort() })).toEqual([]);
      expect(boardPunkte({ config: null, lesen: () => antwort() })).toEqual([]);
    });
  });
  test("Randformen der Antwort: Einträge ohne Nummer oder null zählen nicht als Ansicht, Sortierung ohne Feldnamen, null-Workflow", () => {
    const gut = { number: 2, filter: `-status:Done repo:${REPO}`, sortByFields: { nodes: [] } };
    expect(lauf(antwort({ views: { nodes: [null, { filter: "", sortByFields: { nodes: [] } }, gut] } }))[0].ok).toBe(true);
    const sortiert = { ...gut, sortByFields: { nodes: [{ direction: "ASC" }, null] } };
    expect(lauf(antwort({ views: { nodes: [sortiert] } }))[0].befund).toContain("?, ?");
    expect(lauf(antwort({ workflows: { nodes: [null, ...WF] } }))[0].ok).toBe(true);
  });
  test("Lesefehler ohne Error-Objekt (Text) und leere projectId", () => {
    const r = boardPunkte({ config: CONFIG, lesen: () => wirf("kaputt") });
    expect(r[0].befund).toContain("kaputt");
    expect(boardPunkte({ config: CONFIG, lesen: () => wirf(null) })[0].nichtPruefbar).toBe(true);
    const leer = lauf(antwort(), { repo: REPO, boards: [{ rolle: "factory", nummer: 2, projectId: "" }] });
    expect(leer[0].nichtPruefbar).toBe(true);
    expect(leer[0].befund).toContain("projectId");
  });
  test("ein Board ohne Rolle und Nummer wird mit Platzhaltern benannt; ein null-Eintrag in boards wird übergangen", () => {
    const r = boardPunkte({ config: { repo: REPO, boards: [null, { projectId: "p_x" }] }, lesen: () => antwort({ workflows: { nodes: [] } }) });
    expect(r).toHaveLength(1);
    expect(r[0].befund).toContain("Board ? (Nr. ?)");
  });
  test("Lücke und nicht prüfbares Board zusammen: die Lücke gewinnt, das andere steht als nicht prüfbar im Befund", () => {
    const config = { repo: REPO, boards: [{ rolle: "produkt", nummer: 1, projectId: "p_a" }, { rolle: "factory", nummer: 2 }] };
    const r = boardPunkte({ config, lesen: () => antwort({ workflows: { nodes: [] } }) });
    expect(r[0].nichtPruefbar).toBeUndefined();
    expect(r[0].ok).toBe(false);
    expect(r[0].befund).toContain("Auto-archive items");
    expect(r[0].befund).toContain("Board factory (Nr. 2): nicht prüfbar");
  });
  test("mehrere Boards: ein Ergebnis fasst sie zusammen, die Lücke nennt das Board", () => {
    const config = { repo: REPO, boards: [{ rolle: "produkt", besitzer: "acme", nummer: 1, projectId: "p_a", repo: "acme/prod" }, { rolle: "factory", besitzer: "acme", nummer: 2, projectId: "p_b" }] };
    const lesen = (a: string[]) => (a.includes("id=p_a") ? antwort({ views: { nodes: [{ number: 1, filter: "-status:Done repo:acme/prod", sortByFields: { nodes: [] } }] } }) : antwort({ workflows: { nodes: [] } }));
    const r = boardPunkte({ config, lesen });
    expect(r).toHaveLength(1);
    expect(r[0].ok).toBe(false);
    expect(r[0].befund).toContain("factory");
    expect(r[0].befund).not.toContain("produkt");
  });
});
