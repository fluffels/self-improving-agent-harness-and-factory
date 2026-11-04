/* Meldestelle (factory#153): Stand-Zeile, Sperrprüfung vor dem Senden, Token, der Einstieg `melden.mjs` und der Wächter über alle Schreiber.
 * Der echte Negativfall holt den verbotenen Begriff über `decodeTerms()` zur Laufzeit, er steht nie im Klartext im Repo. */
import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawLib from "../scripts/meldung-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMelden from "../scripts/melden.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import { decodeTerms } from "../scripts/check-internalrefs.mjs";

type Stand = { zustand: "fehlt" | "kaputt" | "ok"; stand: { quelle?: { tag?: string; commit?: string } } | null };
interface Lib {
  factoryStand(s: Stand): string | null;
  meldungsText(zeilen: string[], stand: string | null): string;
  meldestelleToken(a: { stelle: string; eigenes: string; env: Record<string, string | undefined> }): string | undefined;
  textSauber(text: string, exec?: (...a: unknown[]) => { status: number | null; signal?: string | null; error?: Error }): boolean;
  bereiteMeldung(zeilen: string[], o?: { pruefe?: (t: string) => boolean; stand?: string | null }): { ok: boolean; text?: string; grund?: string };
}
interface Melden {
  alsListenpunkt(z: string): string;
  main(argv: string[], deps: Record<string, unknown>): Promise<number>;
}
const lib = rawLib as unknown as Lib;
const melden = rawMelden as unknown as Melden;

const ok = (tag: string | undefined, commit: string | undefined): Stand => ({ zustand: "ok", stand: { quelle: { ...(tag === undefined ? {} : { tag }), ...(commit === undefined ? {} : { commit }) } } });

describe("factoryStand und meldungsText (AK2)", () => {
  test("ok mit Tag und Commit: Tag und die ersten sieben Zeichen des Commits", () => {
    expect(lib.factoryStand(ok("v0.6.0", "abcdef0123456789"))).toBe("factory: v0.6.0 (abcdef0)");
  });
  test("ok ohne Tag: ohne Tag; ohne Commit: unbekannt", () => {
    expect(lib.factoryStand(ok(undefined, "abcdef0123456789"))).toBe("factory: ohne Tag (abcdef0)");
    expect(lib.factoryStand(ok("v1.0.0", undefined))).toBe("factory: v1.0.0 (unbekannt)");
  });
  test("Grenzfälle der Felder: Stand ohne quelle, leere Strings und Nicht-Strings zählen als fehlend", () => {
    expect(lib.factoryStand({ zustand: "ok", stand: {} })).toBe("factory: ohne Tag (unbekannt)");
    expect(lib.factoryStand(ok("", ""))).toBe("factory: ohne Tag (unbekannt)");
    expect(lib.factoryStand({ zustand: "ok", stand: { quelle: { tag: null, commit: 5 } } } as unknown as Stand)).toBe("factory: ohne Tag (unbekannt)");
  });
  test("kein Sync-Stand (Upstream): keine Zeile; kaputter Stand: unbekannt, trotzdem eine Zeile", () => {
    expect(lib.factoryStand({ zustand: "fehlt", stand: null })).toBeNull();
    expect(lib.factoryStand({ zustand: "kaputt", stand: null })).toBe("factory: unbekannt (Sync-Stand unlesbar)");
  });
  test("meldungsText: Zeilen, Leerzeile, Stand; ohne Stand unverändert", () => {
    expect(lib.meldungsText(["a", "b"], "factory: v1 (abc1234)")).toBe("a\nb\n\nfactory: v1 (abc1234)");
    expect(lib.meldungsText(["a", "b"], null)).toBe("a\nb");
  });
});

describe("meldestelleToken", () => {
  const env = { PROJECT_TOKEN: "pt", MELDESTELLE_TOKEN: "mt" };
  test("eigenes Repo (auch anders geschrieben): kein Token, obwohl beide gesetzt sind", () => {
    expect(lib.meldestelleToken({ stelle: "acme/proj", eigenes: "acme/proj", env })).toBeUndefined();
    expect(lib.meldestelleToken({ stelle: "Acme/Proj", eigenes: "acme/proj", env })).toBeUndefined();
  });
  test("fremde Meldestelle: MELDESTELLE_TOKEN, sonst PROJECT_TOKEN, sonst keins", () => {
    expect(lib.meldestelleToken({ stelle: "eingang/privat", eigenes: "acme/proj", env })).toBe("mt");
    expect(lib.meldestelleToken({ stelle: "eingang/privat", eigenes: "acme/proj", env: { PROJECT_TOKEN: "pt", MELDESTELLE_TOKEN: "" } })).toBe("pt");
    expect(lib.meldestelleToken({ stelle: "eingang/privat", eigenes: "acme/proj", env: {} })).toBeUndefined();
  });
});

describe("textSauber (AK3)", () => {
  const exec = (r: { status: number | null; signal?: string | null; error?: Error }) => () => r;
  test("nur Exit 0 ist sauber; Treffer (1), Aufruffehler (2), Signal und Startfehler sperren", () => {
    expect(lib.textSauber("x", exec({ status: 0 }))).toBe(true);
    expect(lib.textSauber("x", exec({ status: 1 }))).toBe(false);
    expect(lib.textSauber("x", exec({ status: 2 }))).toBe(false);
    expect(lib.textSauber("x", exec({ status: null, signal: "SIGTERM" }))).toBe(false);
    expect(lib.textSauber("x", exec({ status: null, error: new Error("ENOENT") }))).toBe(false);
    expect(lib.textSauber("x", exec({ status: 0, error: new Error("EPERM") }))).toBe(false);
  });
  test("echter Kindprozess: neutraler Text ist sauber", () => {
    expect(lib.textSauber("- [ ] 2026-01-01 Gate X meldet Y. Fix: Z")).toBe(true);
  });
  const begriff = (decodeTerms as () => string[])()[0];
  test.skipIf(begriff === undefined)("echter Kindprozess: ein Begriff der Sperrliste sperrt (Negativfall)", () => {
    expect(lib.textSauber(`- [ ] Befund mit ${begriff} im Text`)).toBe(false);
  });
});

describe("bereiteMeldung", () => {
  test("sauber: Text mit Stand-Zeile; die Prüfung sieht den ganzen Text samt Stand", () => {
    const gesehen: string[] = [];
    const m = lib.bereiteMeldung(["- [ ] a"], { stand: "factory: v1 (abc1234)", pruefe: (t) => (gesehen.push(t), true) });
    expect(m).toEqual({ ok: true, text: "- [ ] a\n\nfactory: v1 (abc1234)" });
    expect(gesehen).toEqual(["- [ ] a\n\nfactory: v1 (abc1234)"]);
  });
  test("Treffer: ok false mit Grund und Fix, kein Text", () => {
    const m = lib.bereiteMeldung(["- [ ] a"], { stand: null, pruefe: () => false });
    expect(m.ok).toBe(false);
    expect(m.text).toBeUndefined();
    expect(m.grund).toMatch(/check-internalrefs --text[\s\S]*Fix:/);
  });
  describe("liest .factory/sync-stand.json der Wurzel (AK2)", () => {
    const wurzeln: string[] = [];
    afterEach(() => {
      for (const w of wurzeln.splice(0)) rmSync(w, { recursive: true, force: true });
    });
    const wurzel = (stand: string | null): string => {
      const w = mkdtempSync(join(tmpdir(), "meldung-"));
      wurzeln.push(w);
      if (stand !== null) {
        mkdirSync(join(w, ".factory"));
        writeFileSync(join(w, ".factory", "sync-stand.json"), stand);
      }
      return w;
    };
    const mit = (w: string) => (lib.bereiteMeldung as unknown as (z: string[], o: { wurzel: string; pruefe: () => boolean }) => { text: string })(["- [ ] a"], { wurzel: w, pruefe: () => true }).text;
    test("Stand mit Tag und Commit: Fußzeile", () => {
      expect(mit(wurzel('{"quelle":{"tag":"v1.2.3","commit":"abcdef0123"}}'))).toBe("- [ ] a\n\nfactory: v1.2.3 (abcdef0)");
    });
    test("ohne Datei bleibt der Text unverändert", () => {
      expect(mit(wurzel(null))).toBe("- [ ] a");
    });
    test("unlesbarer Stand: nichts wird gesendet, die Fix-Zeile nennt die Datei, die Sperrprüfung läuft nicht", () => {
      for (const inhalt of ["{", "[]", "null"]) {
        let geprueft = 0;
        const m = (lib.bereiteMeldung as unknown as (z: string[], o: { wurzel: string; pruefe: () => boolean }) => { ok: boolean; text?: string; grund?: string })(["- [ ] a"], { wurzel: wurzel(inhalt), pruefe: () => (geprueft++, true) });
        expect(m.ok, inhalt).toBe(false);
        expect(m.text).toBeUndefined();
        expect(m.grund).toMatch(/\.factory\/sync-stand\.json ist nicht lesbar[\s\S]*Fix:/);
        expect(geprueft).toBe(0);
      }
    });
  });
});

describe("melden.mjs (AK1, AK2, AK3)", () => {
  const sammel = (nr: number | null) => ({
    MELDESTELLE: "eingang/privat",
    REPO: "acme/proj",
    ladeSammelKontext: (io: { repo: string; token?: string }) => ({ offene: [], repoGesehen: io.repo, tokenGesehen: io.token }),
    waehleSammelticket: () => (nr === null ? null : { number: nr }),
    postZeilen: () => undefined,
  });
  function fahre(argv: string[], o: { nr?: number | null; treffer?: boolean; env?: Record<string, string>; postWirft?: boolean } = {}) {
    const posts: unknown[][] = [];
    const log: string[] = [];
    const err: string[] = [];
    const libs = { ...sammel(o.nr === undefined ? 77 : o.nr), postZeilen: (...a: unknown[]) => { if (o.postWirft) throw new Error("HTTP 403"); posts.push(a); } };
    const gesehen: string[][] = [];
    const bereite = (z: string[]) => {
      gesehen.push(z);
      return o.treffer ? { ok: false, grund: "Meldung nicht gesendet: check-internalrefs --text meldet einen Treffer\nFix: neutral" } : { ok: true, text: `${z.join("\n")}\n\nfactory: v1 (abc1234)` };
    };
    return melden.main(argv, { ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), env: o.env ?? { MELDESTELLE_TOKEN: "mt" }, log: (s: string) => log.push(s), err: (s: string) => err.push(s), bereite }).then((code) => ({ code, posts, log, err, gesehen }));
  }

  test("alsListenpunkt: Präfix ergänzt, nie verdoppelt, Umbrüche werden Leerzeichen", () => {
    expect(melden.alsListenpunkt("Befund")).toBe("- [ ] Befund");
    expect(melden.alsListenpunkt("- [ ] Befund")).toBe("- [ ] Befund");
    expect(melden.alsListenpunkt("a\n  b")).toBe("- [ ] a b");
  });
  test("ohne --zeile, mit unbekanntem Flag oder Positional: Exit 2 mit Aufruf, nichts gepostet", async () => {
    for (const argv of [[], ["--quatsch"], ["x"], ["--dry-run"]]) {
      const r = await fahre(argv);
      expect(r.code, argv.join(" ")).toBe(2);
      expect(r.err.join("\n")).toContain("Aufruf: node scripts/melden.mjs");
      expect(r.posts).toEqual([]);
    }
  });
  test("postet die Zeilen samt Stand an die Meldestelle mit MELDESTELLE_TOKEN", async () => {
    const r = await fahre(["--zeile", "Gate A kaputt. Fix: B", "--zeile", "- [ ] zweite"]);
    expect(r.code).toBe(0);
    expect(r.gesehen).toEqual([["- [ ] Gate A kaputt. Fix: B", "- [ ] zweite"]]);
    expect(r.posts).toEqual([[77, "- [ ] Gate A kaputt. Fix: B\n- [ ] zweite\n\nfactory: v1 (abc1234)", "eingang/privat", "mt"]]);
  });
  test("Treffer der Sperrprüfung: Exit 1, nichts gepostet, auch im Trockenlauf", async () => {
    for (const extra of [[], ["--dry-run"]]) {
      const r = await fahre(["--zeile", "x", ...extra], { treffer: true });
      expect(r.code).toBe(1);
      expect(r.posts).toEqual([]);
      expect(r.err.join("\n")).toMatch(/check-internalrefs --text/);
    }
  });
  test("Trockenlauf zeigt Text samt Stand-Zeile und postet nicht", async () => {
    const r = await fahre(["--zeile", "x", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.posts).toEqual([]);
    expect(r.log.join("\n")).toMatch(/\[dry-run\][\s\S]*- \[ \] x[\s\S]*factory: v1 \(abc1234\)/);
  });
  test("kein ungeclaimtes Sammelticket: Exit 1 mit Fix, nichts gepostet", async () => {
    const r = await fahre(["--zeile", "x"], { nr: null });
    expect(r.code).toBe(1);
    expect(r.posts).toEqual([]);
    expect(r.err.join("\n")).toMatch(/Fix:.*sammelticket-anlegen/);
  });
  test("Post-Fehler (kein Schreibrecht): Exit 1 mit klarer Meldung", async () => {
    const r = await fahre(["--zeile", "x"], { postWirft: true });
    expect(r.code).toBe(1);
    expect(r.err.join("\n")).toMatch(/keine Schreibrechte auf eingang\/privat[\s\S]*Fix:/);
  });
  test("leere oder nur aus Leerraum bestehende Zeile: Exit 2, nichts gepostet", async () => {
    for (const z of ["", "   "]) {
      const r = await fahre(["--zeile", z]);
      expect(r.code).toBe(2);
      expect(r.posts).toEqual([]);
    }
  });
  test("Config-/Import-Fehler: Exit 2", async () => {
    const code = await melden.main(["--zeile", "x"], { ladeConfig: () => ({}), ladeLibs: () => Promise.reject(new Error("Import kaputt")), err: () => undefined, log: () => undefined });
    expect(code).toBe(2);
  });
});

describe("Wächter: jeder Schreiber nach postZeilen geht durch bereiteMeldung (AK1, AK3)", () => {
  // Bewusst ausgeklammert (Sicherheits-Inboxen, eigenes Folge-Ticket des PR); eine Ausnahme ohne postZeilen( ist stale und rot.
  const AUSNAHMEN = new Set(["audit-einordnung.mjs", "codescanning-inbox.mjs"]);
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
  const dateien = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? dateien(join(d, e.name)) : e.name.endsWith(".mjs") ? [join(d, e.name)] : []));
  const mitPost = dateien(dir).filter((f) => !f.endsWith("inbox-lib.mjs") && readFileSync(f, "utf8").includes("postZeilen("));
  const name = (f: string) => f.split(/[\\/]/).pop() as string;

  test("Heuristik findet die bekannten Schreiber (Wächter nicht vakuös)", () => {
    const namen = mitPost.map(name);
    for (const n of ["harness-doctor-melden.mjs", "spezifikation.mjs", "melden.mjs", "audit-einordnung.mjs"]) expect(namen).toContain(n);
  });
  test("jedes Skript mit postZeilen( ruft bereiteMeldung( auf oder steht in der Ausnahmeliste", () => {
    const ohne = mitPost.filter((f) => !readFileSync(f, "utf8").includes("bereiteMeldung(") && !AUSNAHMEN.has(name(f))).map(name);
    expect(ohne).toEqual([]);
  });
  test("keine stale Ausnahme: jedes Skript der Liste ruft postZeilen( noch auf und nutzt bereiteMeldung nicht", () => {
    const namen = new Map(mitPost.map((f) => [name(f), readFileSync(f, "utf8")]));
    for (const a of AUSNAHMEN) {
      expect(namen.has(a), `${a} ruft postZeilen( nicht mehr auf: Ausnahme streichen`).toBe(true);
      expect(namen.get(a)?.includes("bereiteMeldung("), `${a} nutzt bereiteMeldung: Ausnahme streichen`).toBe(false);
    }
  });
});
