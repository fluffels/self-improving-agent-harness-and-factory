/* repo-form / sync-stand-lib / relativ-pfad (#101 L4a, L4b, L5d, L16): Blatt-Module ohne Projektbezug, eine Quelle je Form. */
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as formRaw from "../scripts/repo-form.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as standRaw from "../scripts/sync-stand-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as pfadRaw from "../scripts/relativ-pfad.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as syncLibRaw from "../scripts/factory-sync-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as claimsRaw from "../scripts/claims-pruefen.mjs";

const F = formRaw as unknown as { istRepoForm(r: unknown): boolean; zerlegeRepo(r: unknown): { owner: string; name: string }; gleichesRepo(a: unknown, b: unknown): boolean };
const S = standRaw as unknown as { STAND_PFAD: string; syncStandAusText(t: unknown): { zustand: string; stand: unknown }; quelleRepoAusText(t: unknown): string | undefined };
const P = pfadRaw as unknown as { istRelativPosix(p: string): boolean };
const SL = syncLibRaw as unknown as Record<string, unknown>;
const C = claimsRaw as unknown as { aliasAbfragen(n: number[], repo?: string): { query: string }[] };

describe("istRepoForm / zerlegeRepo: strenge Form, weil owner/name ungeprüft in GraphQL-Text gehen", () => {
  test("gültige Formen", () => {
    for (const r of ["a/b", "acme/demo-x", "A.b_c/d.e-f"]) expect(F.istRepoForm(r), r).toBe(true);
    expect(F.zerlegeRepo("a/b")).toEqual({ owner: "a", name: "b" });
  });
  test("Anführungszeichen, Leerraum, Segmentzahl und Nicht-String sind keine Form", () => {
    for (const r of ['a"x/b', "a/b\"){x", "a/b/c", "a b/c", "/b", "a/", "", "x", 5, undefined, null]) {
      expect(F.istRepoForm(r), String(r)).toBe(false);
      expect(() => F.zerlegeRepo(r), String(r)).toThrow(/owner\/name[\s\S]*Fix:/);
    }
  });
  test("gleichesRepo: ohne Groß-/Kleinschreibung, Nicht-String nie gleich", () => {
    expect(F.gleichesRepo("A/b", "a/B")).toBe(true);
    expect(F.gleichesRepo("a/b", "a/c")).toBe(false);
    expect(F.gleichesRepo(undefined, undefined)).toBe(false);
  });
  test("claims-pruefen nutzt dieselbe Form: kein Anführungszeichen im GraphQL-Text", () => {
    expect(() => C.aliasAbfragen([1], 'a"x/b')).toThrow(/Ungültiges Repo/);
    expect(C.aliasAbfragen([1], "a/b")[0].query).toContain('repository(owner:"a",name:"b")');
  });
});

describe("sync-stand-lib", () => {
  test("quelleRepoAusText: kaputtes JSON und Nicht-Form ergeben undefined, Form das Repo", () => {
    expect(S.quelleRepoAusText("{kaputt")).toBeUndefined();
    expect(S.quelleRepoAusText(null)).toBeUndefined();
    expect(S.quelleRepoAusText('{"repo":"a b/c"}')).toBeUndefined();
    expect(S.quelleRepoAusText('{"repo":"a/b"}')).toBe("a/b");
  });
  test("syncStandAusText: fehlt, kaputt, ok", () => {
    expect(S.syncStandAusText(undefined)).toEqual({ zustand: "fehlt", stand: null });
    expect(S.syncStandAusText(null)).toEqual({ zustand: "fehlt", stand: null });
    expect(S.syncStandAusText("[]").zustand).toBe("kaputt");
    expect(S.syncStandAusText("null").zustand).toBe("kaputt");
    expect(S.syncStandAusText("{x").zustand).toBe("kaputt");
    expect(S.syncStandAusText('{"a":1}')).toEqual({ zustand: "ok", stand: { a: 1 } });
  });
  test("factory-sync-lib führt die Namen unverändert weiter (Bezieher importieren von dort)", () => {
    for (const k of ["STAND_PFAD", "syncStandAusText", "quelleRepoAusText", "liesSyncStand"]) expect(SL[k], k).toBe((standRaw as Record<string, unknown>)[k]);
    expect(S.STAND_PFAD).toBe(".factory/sync-stand.json");
  });
  test("Blatt: sync-stand-lib, repo-form und relativ-pfad importieren weder child_process noch eine Config-Lib", () => {
    const stand = readFileSync(new URL("../scripts/sync-stand-lib.mjs", import.meta.url), "utf8");
    expect(stand).not.toContain("child_process");
    expect([...stand.matchAll(/from "([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["./repo-form.mjs", "node:fs", "node:path"]);
    for (const f of ["repo-form", "relativ-pfad"]) expect(readFileSync(new URL(`../scripts/${f}.mjs`, import.meta.url), "utf8"), f).not.toMatch(/^import /m);
  });
});

describe("relativ-pfad", () => {
  test("istRelativPosix", () => {
    expect(P.istRelativPosix("src/a")).toBe(true);
    for (const p of ["src/", "../a", "./a", "a//b", "a\\b", "C:/a", "/a"]) expect(P.istRelativPosix(p), p).toBe(false);
  });
});
