// blockSpanne und MANIFEST_PFAD der Besitz-Lib (#101 L25/L26): eine Auslegung der Block-Spanne für einheitText und docdrift.
import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as besitzRoh from "../scripts/besitz-lib.mjs";

interface E {
  pfad: string;
  block?: string;
  schluessel?: string;
}

const { besitzSpannen, blockSpanne, einheitAusId, einheitId, einheitText, istWorkflowEinheit, manifestAusText, markerEnde, markerStart, MANIFEST_PFAD } = besitzRoh as unknown as {
  besitzSpannen: (einheiten: E[], pfad: string, text: string) => [number, number][];
  einheitAusId: (id: string) => E;
  einheitId: (e: E) => string;
  istWorkflowEinheit: (e: E) => boolean;
  manifestAusText: (text: string | null) => { manifest?: { eintraege: E[] }; fehler?: string; text?: string };
  blockSpanne: (text: string, block: string) => [number, number] | null;
  einheitText: (e: { pfad: string; block: string }, text: string) => string | null;
  markerEnde: (id: string) => string;
  markerStart: (id: string) => string;
  MANIFEST_PFAD: string;
};

describe("blockSpanne", () => {
  test("Normalfall: Start der beiden Marker", () => {
    const text = `x\n${markerStart("k")}\ninnen\n${markerEnde("k")}\ny`;
    expect(blockSpanne(text, "k")).toEqual([text.indexOf(markerStart("k")), text.indexOf(markerEnde("k"))]);
  });
  test("fehlendes Ende oder fehlender Start: null", () => {
    expect(blockSpanne(`${markerStart("k")}\n`, "k")).toBeNull();
    expect(blockSpanne(`${markerEnde("k")}\n`, "k")).toBeNull();
    expect(blockSpanne("", "k")).toBeNull();
  });
  test("Ende vor Start: null", () => {
    expect(blockSpanne(`${markerEnde("k")}\n${markerStart("k")}`, "k")).toBeNull();
  });
  test("einheitText nutzt dieselbe Spanne", () => {
    const text = `x${markerStart("k")}i${markerEnde("k")}y`;
    expect(einheitText({ pfad: "a.md", block: "k" }, text)).toBe(`${markerStart("k")}i${markerEnde("k")}`);
    expect(einheitText({ pfad: "a.md", block: "k" }, `${markerEnde("k")}${markerStart("k")}`)).toBeNull();
  });
  test("MANIFEST_PFAD", () => {
    expect(MANIFEST_PFAD).toBe(".factory/besitz.json");
  });
});

describe("einheitAusId (Gegenstück zu einheitId)", () => {
  test.each([{ pfad: "a.md" }, { pfad: "a.md", block: "k" }, { pfad: "a.json", schluessel: "s" }])("Rundreise %j", (e) => {
    expect(einheitAusId(einheitId(e))).toEqual(e);
  });
  test("ein Schlüssel mit Schrägstrich im Namen bleibt ganz", () => {
    expect(einheitAusId("a.json#/x/y")).toEqual({ pfad: "a.json", schluessel: "x/y" });
  });
});

describe("besitzSpannen", () => {
  const text = `x\n${markerStart("k")}\ni\n${markerEnde("k")}\ny`;
  test("ganze Datei: alles; Block: blockSpanne; Schlüssel und fremde Pfade: keine", () => {
    expect(besitzSpannen([{ pfad: "a.md" }], "a.md", text)).toEqual([[0, text.length]]);
    expect(besitzSpannen([{ pfad: "a.md", block: "k" }], "a.md", text)).toEqual([blockSpanne(text, "k")]);
    expect(besitzSpannen([{ pfad: "a.md", schluessel: "s" }, { pfad: "b.md" }], "a.md", text)).toEqual([]);
  });
  test("kaputte Marker: keine Spanne; Marker im Code: das erste Vorkommen gilt (Auslegung des Syncs)", () => {
    expect(besitzSpannen([{ pfad: "a.md", block: "k" }], "a.md", markerStart("k"))).toEqual([]);
    const imCode = `\`\`\`\n${markerStart("k")}\n\`\`\`\n${text}`;
    expect(besitzSpannen([{ pfad: "a.md", block: "k" }], "a.md", imCode)[0][0]).toBe(imCode.indexOf(markerStart("k")));
  });
});

describe("manifestAusText", () => {
  test("gültig: das Manifest", () => {
    expect(manifestAusText('{"eintraege":[]}')).toEqual({ manifest: { eintraege: [] } });
  });
  test.each([
    [null, "fehlt", `${MANIFEST_PFAD} fehlt`],
    ["kein json", "json", `${MANIFEST_PFAD} ist kein gültiges JSON`],
    ['{"version":1}', "eintraege", `${MANIFEST_PFAD} hat keine Liste 'eintraege'`],
    ["null", "eintraege", `${MANIFEST_PFAD} hat keine Liste 'eintraege'`],
  ])("Fehler %j", (text, fehler, meldung) => {
    expect(manifestAusText(text)).toEqual({ fehler, text: meldung });
  });
});

describe("pflichtChecksFehler nutzt istWorkflowEinheit", () => {
  const { pflichtChecksFehler } = besitzRoh as unknown as { pflichtChecksFehler: (e: E & { pflichtChecks?: unknown }) => string[] };
  test("an einer Workflow-Datei gültig, an jeder anderen Einheit ein Fehler", () => {
    expect(pflichtChecksFehler({ pfad: ".github/workflows/ci.yml", pflichtChecks: ["verify"] })).toEqual([]);
    expect(pflichtChecksFehler({ pfad: "scripts/a.mjs", pflichtChecks: ["verify"] })).toHaveLength(1);
    expect(pflichtChecksFehler({ pfad: ".github/workflows/ci.yml", block: "k", pflichtChecks: ["verify"] })).toHaveLength(1);
  });
});

describe("istWorkflowEinheit", () => {
  test("nur eine ganze Workflow-Datei im Workflow-Ordner", () => {
    expect(istWorkflowEinheit({ pfad: ".github/workflows/ci.yml" })).toBe(true);
    expect(istWorkflowEinheit({ pfad: ".github/workflows/ci.yaml" })).toBe(true);
    expect(istWorkflowEinheit({ pfad: ".github/workflows/ci.yml", block: "k" })).toBe(false);
    expect(istWorkflowEinheit({ pfad: ".github/workflows/ci.yml", schluessel: "s" })).toBe(false);
    expect(istWorkflowEinheit({ pfad: ".github/workflows/sub/ci.yml" })).toBe(false);
    expect(istWorkflowEinheit({ pfad: ".github/workflows/ci.txt" })).toBe(false);
  });
});
