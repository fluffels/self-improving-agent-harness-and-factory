/* tag-takt führt neue Einträge der Ankerliste der Kern-Links seit dem Tag als Bezieher-Migration auf (factory#245 L1). */
import { describe, expect, it } from "vitest";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as raw from "../scripts/tag-takt.mjs";
import { FREMD } from "./support/fremd-config";

type Io = Record<string, unknown>;
const T = raw as unknown as {
  ANKER_LISTE: string;
  neueKernLinkAnker: (alt: string | null, neu: string | null) => string[];
  tagBody: (a: Record<string, unknown>) => string;
  lauf: (a: { io: Io; trocken?: boolean }) => number;
};

const liste = (...e: string[]): string => JSON.stringify(e);
const KEY = `${FREMD.praefixe.commitZeile}Sync-Dringlich`;
const JETZT = new Date("2026-06-20T12:00:00Z");
const TAG = "v1.2.3";
const HEAD = "d".repeat(40);
const MANIFEST = { eintraege: [{ pfad: "scripts/a.mjs", ring: "kern" }] };

describe("neueKernLinkAnker (reine Funktion)", () => {
  it("nennt neue Einträge sortiert, Altes und Gleichstand nicht", () => {
    expect(T.neueKernLinkAnker(liste("docs/a.md#eins"), liste("docs/a.md#eins", "docs/c.md#drei", "docs/b.md#zwei"))).toEqual(["docs/b.md#zwei", "docs/c.md#drei"]);
    expect(T.neueKernLinkAnker(liste("docs/a.md#eins"), liste("docs/a.md#eins"))).toEqual([]);
  });
  it("fail-open: ohne Basis (null), unlesbares JSON oder Nicht-Array bleibt es leer", () => {
    expect(T.neueKernLinkAnker(null, liste("docs/a.md#eins"))).toEqual([]);
    expect(T.neueKernLinkAnker("{kaputt", liste("docs/a.md#eins"))).toEqual([]);
    expect(T.neueKernLinkAnker('{"a":1}', liste("docs/a.md#eins"))).toEqual([]);
    expect(T.neueKernLinkAnker(liste(), null)).toEqual([]);
  });
  it("Missbrauchsschutz: nur Einträge im Format docs/<x>.md#<anker> ohne Backtick und Leerzeichen", () => {
    const boese = ["README.md#x", "docs/a.md", "docs/a.md#x y", "docs/a.md#x`; rm -rf", "docs/a.md#ok", 7];
    expect(T.neueKernLinkAnker(liste(), JSON.stringify(boese))).toEqual(["docs/a.md#ok"]);
  });
  it("Pfad der Liste ist die JSON-Datei neben dem Wächter", () => {
    expect(T.ANKER_LISTE).toBe("test/harness/kern-link-anker.json");
  });
});

describe("tagBody: Abschnitt Bezieher-Migration", () => {
  const basis = { tag: "v1.3.0", letzterTag: TAG, sha: HEAD, prs: [], aeltestes: { datum: "2026-06-01T00:00:00Z", sha: "a".repeat(40) }, ausloeser: ["x"], ci: { zustand: "gruen", url: null } };
  it("ein neuer Anker steht als Zeile Ankerliste, auch neben einer Migrationszeile; „keine gemeldet“ nur, wenn beides leer ist", () => {
    const mit = T.tagBody({ ...basis, ankerNeu: ["docs/a.md#neu"] });
    expect(mit).toContain("- Ankerliste: `docs/a.md#neu` neu (Bezieher mit eigener Seite braucht die Überschrift)");
    expect(mit).not.toContain("keine gemeldet");
    const beide = T.tagBody({ ...basis, migrationen: [{ pr: "#7", text: "Hinweis" }], ankerNeu: ["docs/a.md#neu"] });
    expect(beide).toContain("- #7 Hinweis");
    expect(beide).toContain("- Ankerliste: `docs/a.md#neu`");
    expect(T.tagBody(basis)).toContain("- keine gemeldet");
  });
});

describe("lauf: die Ankerliste am Tag und an HEAD", () => {
  const eins = (k: number): string => `\x1e${String(k).repeat(40)}\x1f2026-06-0${k}T00:00:00Z\x1ffeat: a (#${k})\x1f\n\nscripts/a.mjs\n`;
  const lauf = (zeige: (ref: string, pfad: string) => string | null): string => {
    const texte: string[] = [];
    T.lauf({
      io: {
        istBezieher: () => false,
        tags: () => [TAG],
        ladeLog: () => eins(1) + eins(2) + eins(3),
        ladeManifest: () => MANIFEST,
        headSha: () => HEAD,
        ladeLaeufe: () => [],
        ladeOffene: () => [],
        frischeOffene: () => [],
        dringlichKey: KEY,
        jetzt: () => JETZT,
        projectToken: "t",
        legeIssueAn: (_t: string, b: string) => {
          texte.push(b);
          return "5";
        },
        sortiereEin: () => true,
        zeigeDatei: zeige,
        log: () => undefined,
      },
      trocken: false,
    });
    return texte[0] ?? "";
  };
  const ANKER = "test/harness/kern-link-anker.json";

  it("ein Eintrag, der seit dem Tag dazukam, steht im Tag-Ticket", () => {
    const body = lauf((ref, pfad) => (pfad === ANKER ? (ref === TAG ? liste("docs/a.md#alt") : liste("docs/a.md#alt", "docs/b.md#neu")) : null));
    expect(body).toContain("- Ankerliste: `docs/b.md#neu` neu");
    expect(body).not.toContain("`docs/a.md#alt`");
  });

  it("fehlt die Liste am Tag (erster Tag mit Liste), bleibt es still und ein Lesefehler bricht den Takt nicht", () => {
    expect(lauf((ref, pfad) => (pfad === ANKER && ref !== TAG ? liste("docs/b.md#neu") : null))).not.toContain("Ankerliste:");
    const wirft = lauf((_ref, pfad) => {
      if (pfad === ANKER) throw new Error("git show kaputt");
      return null;
    });
    expect(wirft).toContain("keine gemeldet");
  });
});
