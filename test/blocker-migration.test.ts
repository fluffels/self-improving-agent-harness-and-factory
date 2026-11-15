import { describe, expect, test } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/blocker-migration.mjs";
import { echteSpezifikation } from "./support/echte-sprache";

const SPRACHE = echteSpezifikation();
const REPO = "o/r";
type Kante = { nummer: number; blockerNummer: number; issueNodeId: string; blockerNodeId: string };
type Seite = { issues: object[]; weiter: string | null };
type Ergebnis = { code: number; out: string; err: string };
type Io = { repo: string; sprache: unknown; ladeSeite: (nach: string | null) => Seite; setze: (i: string, b: string) => void; loese?: (i: string, b: string) => void };
const M = raw as unknown as {
  fehlendeKanten: (a: object) => { kanten: Kante[]; uebersprungen: { nummer: number; ref: string; grund: string }[] };
  geschlosseneKanten: (a: object) => { kanten: Kante[]; uebersprungen: { nummer: number; ref: string; grund: string }[] };
  migriere: (a: { anwenden: boolean; loesen?: boolean }, io: Io) => Ergebnis;
  fuehreAus: (argv: string[], io: object) => Ergebnis;
  direktLauf: (argv: string[], fuehre?: (argv: string[]) => Ergebnis) => Ergebnis;
  echteIo: (repo: string, naht: { gh: (a: string[], o: unknown) => unknown; env: object }) => { ladeSeite: (n: string | null) => Seite; setze: (i: string, b: string) => void; loese: (i: string, b: string) => void };
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

describe("geschlosseneKanten", () => {
  const kante = (nummer: number, state: string, repo = REPO) => ({ nummer, repo, state, id: `B${nummer}` });
  const mit = (nummer: number, nativ: object[], zugewiesen = false) => ({ nummer, id: `I${nummer}`, body: "", zugewiesen, nativ });
  const geschl = (issues: object[]) => M.geschlosseneKanten({ issues, repo: REPO });
  test("native Kante auf einen geschlossenen Blocker im eigenen Repo ergibt eine Kante", () => {
    expect(geschl([mit(1, [kante(2, "CLOSED")])])).toEqual({ kanten: [{ nummer: 1, blockerNummer: 2, issueNodeId: "I1", blockerNodeId: "B2" }], uebersprungen: [] });
  });
  test("offener Blocker: keine Kante", () => {
    expect(geschl([mit(1, [kante(2, "OPEN")])]).kanten).toEqual([]);
  });
  test("Kante in ein fremdes Repo bleibt, auch wenn sie geschlossen ist", () => {
    expect(geschl([mit(1, [kante(2, "CLOSED", "x/y")])]).kanten).toEqual([]);
  });
  test("Ticket mit Assignee wird übersprungen, Grund Assignee", () => {
    expect(geschl([mit(1, [kante(2, "CLOSED")], true)])).toEqual({ kanten: [], uebersprungen: [{ nummer: 1, ref: "#2", grund: "Assignee" }] });
  });
  test("Assignee ohne geschlossene Kante ergibt keinen Skip-Eintrag", () => {
    expect(geschl([mit(1, [kante(2, "OPEN")], true)]).uebersprungen).toEqual([]);
  });
  test("ohne Kanten leer; nur die geschlossenen von mehreren werden gelöst", () => {
    expect(geschl([mit(1, [])])).toEqual({ kanten: [], uebersprungen: [] });
    expect(geschl([mit(1, [kante(2, "OPEN"), kante(3, "CLOSED")])]).kanten.map((k) => k.blockerNummer)).toEqual([3]);
  });
});

describe("migriere --loesen", () => {
  const nativ = [{ nummer: 2, repo: REPO, state: "CLOSED", id: "B2" }, { nummer: 3, repo: REPO, state: "CLOSED", id: "B3" }];
  const seite = { issues: [{ nummer: 1, id: "I1", body: "", zugewiesen: false, nativ }], weiter: null };
  const lio = (gesetzt: unknown[][], loese: (i: string, b: string) => void) => ({
    repo: REPO,
    sprache: SPRACHE,
    ladeSeite: () => seite,
    setze: (i: string, b: string) => gesetzt.push(["setze", i, b]),
    loese,
  });
  test("Trockenlauf: Zeilen „würde lösen“, keine Mutation", () => {
    const got: unknown[][] = [];
    const r = M.migriere({ anwenden: false, loesen: true }, lio(got, (i, b) => got.push([i, b])));
    expect(got).toEqual([]);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^würde lösen: #1 ← #2$/m);
    expect(r.out).toMatch(/^würde lösen: #1 ← #3$/m);
    expect(r.out).toMatch(/1 Abfragen, 0 Mutationen/);
  });
  test("--anwenden: io.loese je Kante, Kostenzeile, setze nie", () => {
    const got: unknown[][] = [];
    const r = M.migriere({ anwenden: true, loesen: true }, lio(got, (i, b) => got.push([i, b])));
    expect(got).toEqual([["I1", "B2"], ["I1", "B3"]]);
    expect(r.out).toMatch(/^löse: #1 ← #2$/m);
    expect(r.out).toMatch(/1 Abfragen, 2 Mutationen/);
  });
  test("scheitert eine Mutation: Exit 1, die übrigen laufen weiter", () => {
    const got: unknown[][] = [];
    const r = M.migriere({ anwenden: true, loesen: true }, lio(got, (i, b) => { got.push([i, b]); if (b === "B2") throw new Error("403"); }));
    expect(got).toHaveLength(2);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/#1 ← #2.*403/);
  });
  test("Übersprungene Tickets mit Assignee stehen mit Grund in der Ausgabe", () => {
    const s = { issues: [{ nummer: 1, id: "I1", body: "", zugewiesen: true, nativ }], weiter: null };
    const r = M.migriere({ anwenden: false, loesen: true }, { ...lio([], () => {}), ladeSeite: () => s });
    expect(r.out).toMatch(/^Übersprungen \(2\):\n {2}#1 #2: Assignee/m);
  });
  test("Ladefehler: Exit 1", () => {
    const r = M.migriere({ anwenden: true, loesen: true }, { ...lio([], () => {}), ladeSeite: () => { throw new Error("gh kaputt"); } });
    expect(r.code).toBe(1);
  });
  test("fuehreAus erkennt --loesen", () => {
    const got: unknown[][] = [];
    const r = M.fuehreAus(["--loesen", "--anwenden"], lio(got, (i, b) => got.push([i, b])));
    expect(got).toHaveLength(2);
    expect(r.out).toMatch(/^löse: /m);
    expect(M.fuehreAus(["--loesen"], lio(got, () => {})).out).toMatch(/^würde lösen: /m);
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
  const knoten = (n: number, blocker: { number: number; repo: string }[] = []) => ({ id: `N${n}`, number: n, body: n === 1 ? "blockiert durch #2" : "", assignees: { totalCount: n === 2 ? 1 : 0 }, blockedBy: { nodes: blocker.map((b) => ({ id: `B${b.number}`, number: b.number, state: "CLOSED", repository: { nameWithOwner: b.repo } })) } });
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
    expect(s1).toEqual({ issues: [{ nummer: 1, id: "N1", body: "blockiert durch #2", zugewiesen: false, nativ: [{ nummer: 5, repo: "x/y", state: "CLOSED", id: "B5" }] }], weiter: "C1" });
    expect(aufrufe[0]?.args.find((a) => a.startsWith("query="))).toMatch(/assignees\(first:1\)\{ ?totalCount ?\}/);
    expect(aufrufe[0]?.args.some((a) => a.startsWith("after="))).toBe(false);
    const s2 = echt.ladeSeite("C1");
    expect(s2.weiter).toBeNull();
    expect(s2.issues.map((i) => (i as { nummer: number }).nummer)).toEqual([2]);
    expect((s2.issues[0] as { zugewiesen: boolean }).zugewiesen).toBe(true);
    expect(aufrufe[1]?.args).toContain("after=C1");
    expect(aufrufe[1]?.args).toContain("owner=o");
    expect(aufrufe[1]?.args).toContain("name=r");
    echt.setze("I1", "I2");
    const mutation = aufrufe[2]?.args ?? [];
    expect(mutation).toContain("i=I1");
    expect(mutation).toContain("b=I2");
  });
  test("loese ruft removeBlockedBy mit issueId und blockingIssueId", () => {
    const aufrufe: { args: string[]; opts: unknown }[] = [];
    const echt = M.echteIo("o/r", { gh: (args, opts) => (aufrufe.push({ args, opts }), {}), env: { PROJECT_TOKEN: "pt" } });
    echt.loese("I1", "B2");
    const args = aufrufe[0]?.args ?? [];
    expect(args.find((a) => a.startsWith("query="))).toMatch(/mutation\(\$i:ID!,\$b:ID!\)\{ removeBlockedBy\(input:\{issueId:\$i, blockingIssueId:\$b\}\)/);
    expect(args).toContain("i=I1");
    expect(args).toContain("b=B2");
  });
});

describe("direktLauf (Modul-catch des Direktaufrufs)", () => {
  test("ein geworfener Fehler wird zu Exit 1 mit Fehlerzeile, nichts auf stdout", () => {
    const r = M.direktLauf([], () => {
      throw new Error("kaputt");
    });
    expect([r.code, r.out]).toEqual([1, ""]);
    expect(r.err).toMatch(/^✖ .*kaputt\n$/);
  });

  test("ohne Fehler wird das Ergebnis unverändert durchgereicht", () => {
    const ok = { code: 0, out: "fertig\n", err: "" };
    expect(M.direktLauf(["--x"], (argv) => (argv[0] === "--x" ? ok : { code: 9, out: "", err: "" }))).toBe(ok);
  });
});
