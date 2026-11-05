import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/blocker-migration.mjs";
import { echteSpezifikation } from "./support/echte-sprache";

const SPRACHE = echteSpezifikation();
const REPO = "o/r";
type Kante = { nummer: number; blockerNummer: number; issueNodeId: string; blockerNodeId: string };
type Seite = { issues: object[]; weiter: string | null };
type Ergebnis = { code: number; out: string; err: string };
type Io = { repo: string; sprache: unknown; ladeSeite: (nach: string | null) => Seite; setze: (i: string, b: string) => void };
const M = raw as unknown as {
  fehlendeKanten: (a: object) => { kanten: Kante[]; uebersprungen: { nummer: number; ref: string; grund: string }[] };
  migriere: (a: { anwenden: boolean }, io: Io) => Ergebnis;
  fuehreAus: (argv: string[], io: object) => Ergebnis;
  direktLauf: (argv: string[], fuehre?: (argv: string[]) => Ergebnis) => Ergebnis;
  echteIo: (repo: string, naht: { gh: (a: string[], o: unknown) => unknown; env: object }) => { ladeSeite: (n: string | null) => Seite; setze: (i: string, b: string) => void };
};
const fehlend = M.fehlendeKanten;
const issue = (nummer: number, body = "", nativ: { nummer: number; repo?: string }[] = []) => ({
  nummer,
  id: `I${nummer}`,
  body,
  nativ: nativ.map((n) => ({ nummer: n.nummer, repo: n.repo ?? REPO })),
});
const lauf = (issues: object[]) => fehlend({ issues, repo: REPO, sprache: SPRACHE });

describe("fehlendeKanten", () => {
  test("offener Textblocker ohne native Kante ergibt eine Kante", () => {
    const r = lauf([issue(1, "blockiert durch #2"), issue(2)]);
    expect(r.kanten).toEqual([{ nummer: 1, blockerNummer: 2, issueNodeId: "I1", blockerNodeId: "I2" }]);
    expect(r.uebersprungen).toEqual([]);
  });
  test("geschlossener Blocker (nicht unter den offenen) wird übersprungen und gelistet", () => {
    const r = lauf([issue(1, "blockiert durch #9")]);
    expect(r.kanten).toEqual([]);
    expect(r.uebersprungen).toEqual([{ nummer: 1, ref: "#9", grund: "Blocker nicht offen" }]);
  });
  test("schon nativ gesetzte Kante wird abgezogen", () => {
    const r = lauf([issue(1, "blockiert durch #2", [{ nummer: 2 }]), issue(2)]);
    expect(r.kanten).toEqual([]);
    expect(r.uebersprungen).toEqual([]);
  });
  test("native Kante gleicher Nummer aus einem fremden Repo deckt den eigenen Blocker nicht ab", () => {
    const r = lauf([issue(1, "blockiert durch #2", [{ nummer: 2, repo: "x/y" }]), issue(2)]);
    expect(r.kanten.map((k) => k.blockerNummer)).toEqual([2]);
  });
  test("fremdes Repo wird übersprungen und gelistet, auch in Verweis-URL-Form", () => {
    const r = lauf([issue(1, "blockiert durch x/y#5, https://github.com/a/b/issues/6")]);
    expect(r.kanten).toEqual([]);
    expect(r.uebersprungen.map((u) => [u.ref, u.grund])).toEqual([["x/y#5", "fremdes Repo"], ["a/b#6", "fremdes Repo"]]);
  });
  test("qualifizierter Verweis aufs eigene Repo zählt als eigener Blocker", () => {
    const r = lauf([issue(1, `blockiert durch ${REPO}#2`), issue(2)]);
    expect(r.kanten.map((k) => k.blockerNummer)).toEqual([2]);
  });
  test("mehrere Blocker: nur die fehlenden Kanten", () => {
    const r = lauf([issue(1, "blockiert durch #2, #3, #4", [{ nummer: 3 }]), issue(2), issue(3), issue(4)]);
    expect(r.kanten.map((k) => k.blockerNummer)).toEqual([2, 4]);
  });
  test("Idempotenz: nach dem Setzen der Kanten bleibt nichts übrig", () => {
    const erst = lauf([issue(1, "blockiert durch #2, #3"), issue(2), issue(3)]);
    const danach = lauf([issue(1, "blockiert durch #2, #3", erst.kanten.map((k) => ({ nummer: k.blockerNummer }))), issue(2), issue(3)]);
    expect(danach.kanten).toEqual([]);
  });
  test("Issue ohne Blocker-Zeile und ein Selbstverweis erzeugen nichts", () => {
    expect(lauf([issue(1, "kein Blocker"), issue(2, "blockiert durch #2")]).kanten).toEqual([]);
  });
});

describe("migriere (injizierte I/O)", () => {
  const seiten = [[issue(1, "blockiert durch #2"), issue(2)]];
  const io = (mutationen: unknown[][], extra: object = {}) => ({
    repo: REPO,
    sprache: SPRACHE,
    ladeSeite: (nach: string | null) => ({ issues: nach === null ? seiten[0] : [], weiter: null }),
    setze: (i: string, b: string) => mutationen.push([i, b]),
    ...extra,
  });
  test("Trockenlauf: Ausgabe mit Kanten und Kostenzeile, keine Mutation", () => {
    const mut: unknown[][] = [];
    const r = M.migriere({ anwenden: false }, io(mut));
    expect(mut).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/#1 ← #2/);
    expect(r.out).toMatch(/1 Abfragen, 0 Mutationen/);
  });
  test("--anwenden: eine Mutation je Kante", () => {
    const mut: unknown[][] = [];
    const r = M.migriere({ anwenden: true }, io(mut));
    expect(mut).toEqual([["I1", "I2"]]);
    expect(r.out).toMatch(/1 Abfragen, 1 Mutationen/);
  });
  test("Seiten werden bis zum Ende geladen", () => {
    const abfragen: (string | null)[] = [];
    const r = M.migriere({ anwenden: false }, io([], {
      ladeSeite: (nach: string | null) => (abfragen.push(nach), nach === null ? { issues: [issue(1, "blockiert durch #2")], weiter: "C1" } : { issues: [issue(2)], weiter: null }),
    }));
    expect(abfragen).toEqual([null, "C1"]);
    expect(r.out).toMatch(/#1 ← #2/);
    expect(r.out).toMatch(/2 Abfragen/);
  });
  test("gh-Fehler beim Setzen: Exit 1, übrige Kanten laufen weiter", () => {
    const mut: unknown[][] = [];
    const r = M.migriere({ anwenden: true }, io(mut, {
      ladeSeite: () => ({ issues: [issue(1, "blockiert durch #2, #3"), issue(2), issue(3)], weiter: null }),
      setze: (i: string, b: string) => { mut.push([i, b]); if (b === "I2") throw new Error("403"); },
    }));
    expect(mut).toHaveLength(2);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/#1 ← #2.*403/);
  });
  test("Aufruffehler: unbekanntes Flag und ein Repo ohne owner/name-Form ergeben Exit 2", () => {
    expect(M.fuehreAus(["--bogus"], {}).code).toBe(2);
    expect(M.fuehreAus(["--repo", "ohne-slash"], {}).code).toBe(2);
  });
  test("--repo und --anwenden gelangen in den Lauf", () => {
    const mut: unknown[][] = [];
    const r = M.fuehreAus(["--repo", "a/b", "--anwenden"], io(mut, { repo: undefined }));
    expect(r.out).toMatch(/in a\/b/);
    expect(mut).toEqual([["I1", "I2"]]);
  });
  test("Ladefehler: Exit 1 mit ✖-Zeile, nichts wird gesetzt", () => {
    const mut: unknown[][] = [];
    const r = M.migriere({ anwenden: true }, io(mut, { ladeSeite: () => { throw new Error("gh kaputt"); } }));
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/Issues nicht ladbar: gh kaputt/);
    expect(mut).toEqual([]);
  });
  test("Übersprungene Blocker stehen mit Zahl und Grund in der Ausgabe, Kopfzeile nennt Modus und Repo", () => {
    const seite = { issues: [issue(1, "blockiert durch #9")], weiter: null };
    const trocken = M.migriere({ anwenden: false }, io([], { ladeSeite: () => seite }));
    expect(trocken.out).toMatch(/^Trockenlauf, würde setzen 0 Kante\(n\) in o\/r:/m);
    expect(trocken.out).toMatch(/^Übersprungen \(1\):\n {2}#1 .*#9/m);
    const echt = M.migriere({ anwenden: true }, io([], { ladeSeite: () => seite }));
    expect(echt.out).toMatch(/^Setze 0 Kante\(n\) in o\/r:/m);
    const ohne = M.migriere({ anwenden: false }, io([]));
    expect(ohne.out).not.toMatch(/Übersprungen/);
  });
});

describe("echteIo (gefälschtes gh)", () => {
  const knoten = (n: number, blocker: { number: number; repo: string }[] = []) => ({ id: `N${n}`, number: n, body: n === 1 ? "blockiert durch #2" : "", blockedBy: { nodes: blocker.map((b) => ({ number: b.number, repository: { nameWithOwner: b.repo } })) } });
  test("bildet die GraphQL-Antwort ab und paginiert über den Cursor; setze nutzt addBlockedBy", () => {
    const aufrufe: { args: string[]; opts: unknown }[] = [];
    const gh = (args: string[], opts: unknown) => {
      aufrufe.push({ args, opts });
      if (args.some((a) => a.startsWith("query=mutation"))) return {};
      const seite2 = args.includes("after=C1");
      return { data: { repository: { issues: { nodes: seite2 ? [knoten(2)] : [knoten(1, [{ number: 5, repo: "x/y" }])], pageInfo: { hasNextPage: !seite2, endCursor: seite2 ? null : "C1" } } } } };
    };
    const echt = M.echteIo("o/r", { gh, env: { PROJECT_TOKEN: "pt" } });
    const s1 = echt.ladeSeite(null);
    expect(s1).toEqual({ issues: [{ nummer: 1, id: "N1", body: "blockiert durch #2", nativ: [{ nummer: 5, repo: "x/y" }] }], weiter: "C1" });
    expect(aufrufe[0]?.args.some((a) => a.startsWith("after="))).toBe(false);
    const s2 = echt.ladeSeite("C1");
    expect(s2.weiter).toBeNull();
    expect(s2.issues.map((i) => (i as { nummer: number }).nummer)).toEqual([2]);
    expect(aufrufe[1]?.args).toContain("after=C1");
    expect(aufrufe[1]?.args).toContain("owner=o");
    expect(aufrufe[1]?.args).toContain("name=r");
    echt.setze("I1", "I2");
    const mutation = aufrufe[2]?.args ?? [];
    expect(mutation).toContain("i=I1");
    expect(mutation).toContain("b=I2");
  });
});

describe("direktLauf (Modul-catch des Direktaufrufs)", () => {
  test("ein geworfener Fehler wird zu Exit 1 mit Fehlerzeile, nichts auf stdout", () => {
    const r = M.direktLauf([], () => {
      throw new Error("kaputt");
    });
    expect(r).toEqual({ code: 1, out: "", err: expect.stringMatching(/^✖ .*kaputt\n$/) });
  });

  test("ohne Fehler wird das Ergebnis unverändert durchgereicht", () => {
    const ok = { code: 0, out: "fertig\n", err: "" };
    expect(M.direktLauf(["--x"], (argv) => (argv[0] === "--x" ? ok : { code: 9, out: "", err: "" }))).toBe(ok);
  });
});
