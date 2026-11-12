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
  factoryStand(s: Stand, eigenes?: string | null): string | null;
  istStandZeile(z: string): boolean;
  meldungsText(zeilen: string[], stand: string | null): string;
  meldestelleToken(a: { stelle: string; eigenes: string; env: Record<string, string | undefined> }): string | undefined;
  textSauber(text: string, exec?: (...a: unknown[]) => { status: number | null; signal?: string | null; error?: Error }): boolean;
  bereiteMeldung(zeilen: string[], o?: { wurzel?: string; pruefe?: (t: string) => boolean; stand?: string | null; herkunft?: string | null; eigenes?: string | null }): { ok: boolean; text?: string; grund?: string };
  meldestelleZugang(a: { stelle: string; eigenes: string; env: Record<string, string | undefined> }): { stelle: string; fremd: boolean; herkunft: string | null; token: string | undefined };
  nummernMitHerkunft(text: string, herkunft: string | null): string;
  eigenerLogin(a: { zugang: { fremd: boolean; token?: string }; api: (args: string[], o: { token?: string }) => unknown; warn: (z: string) => void }): string | null;
  zeileBekannt(a: { kommentare: { user: { login: string; type: string } | null; body: string }[]; owner: string; eigen?: string | null; schluessel: string }): boolean;
  keinSammelticketText(a: { fuer: string; ci?: boolean; trenner?: string }): string;
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
  test("kein Sync-Stand (Upstream): keine Zeile; kaputter Stand (nur die pure Funktion; bereiteMeldung sperrt vorher): unbekannt", () => {
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
    const mit = (w: string) => lib.bereiteMeldung(["- [ ] a"], { wurzel: w, pruefe: () => true }).text;
    test("Stand mit Tag und Commit: Fußzeile", () => {
      expect(mit(wurzel('{"quelle":{"tag":"v1.2.3","commit":"abcdef0123"}}'))).toBe("- [ ] a\n\nfactory: v1.2.3 (abcdef0)");
    });
    test("ohne Datei bleibt der Text unverändert", () => {
      expect(mit(wurzel(null))).toBe("- [ ] a");
    });
    test("unlesbarer Stand: nichts wird gesendet, die Fix-Zeile nennt die Datei, die Sperrprüfung läuft nicht", () => {
      for (const inhalt of ["{", "[]", "null"]) {
        let geprueft = 0;
        const m = lib.bereiteMeldung(["- [ ] a"], { wurzel: wurzel(inhalt), pruefe: () => (geprueft++, true) });
        expect(m.ok, inhalt).toBe(false);
        expect(m.text).toBeUndefined();
        expect(m.grund).toMatch(/\.factory\/sync-stand\.json ist nicht lesbar[\s\S]*Fix:/);
        expect(geprueft).toBe(0);
        expect(m.grund).toMatch(/Fix:.*\.factory\/sync-stand\.json/);
      }
    });
    test("stand: null (ausdrücklich keine Fußzeile) liest die Datei nicht, auch wenn sie unlesbar wäre", () => {
      expect(lib.bereiteMeldung(["- [ ] a"], { wurzel: wurzel("{"), stand: null, pruefe: () => true })).toEqual({ ok: true, text: "- [ ] a" });
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
    const r = await fahre(["--zeile", "Defekt: Gate A kaputt. Beleg: Z. Fix: B", "--zeile", "- [ ] Defekt: zweite Beleg: Z"]);
    expect(r.code).toBe(0);
    expect(r.gesehen).toEqual([["- [ ] Defekt: Gate A kaputt. Beleg: Z. Fix: B", "- [ ] Defekt: zweite Beleg: Z"]]);
    expect(r.posts).toEqual([[77, "- [ ] Defekt: Gate A kaputt. Beleg: Z. Fix: B\n- [ ] Defekt: zweite Beleg: Z\n\nfactory: v1 (abc1234)", "eingang/privat", "mt"]]);
  });
  test("Treffer der Sperrprüfung: Exit 1, nichts gepostet, auch im Trockenlauf", async () => {
    for (const extra of [[], ["--dry-run"]]) {
      const r = await fahre(["--zeile", "Defekt: x Beleg: y", ...extra], { treffer: true });
      expect(r.code).toBe(1);
      expect(r.posts).toEqual([]);
      expect(r.err.join("\n")).toMatch(/check-internalrefs --text/);
    }
  });
  test("Trockenlauf zeigt Text samt Stand-Zeile und postet nicht", async () => {
    const r = await fahre(["--zeile", "Defekt: x Beleg: y", "--dry-run"]);
    expect(r.code).toBe(0);
    expect(r.posts).toEqual([]);
    expect(r.log.join("\n")).toMatch(/\[dry-run\][\s\S]*- \[ \] Defekt: x Beleg: y[\s\S]*factory: v1 \(abc1234\)/);
  });
  test("kein ungeclaimtes Sammelticket: Exit 1 mit Fix, nichts gepostet", async () => {
    const r = await fahre(["--zeile", "Defekt: x Beleg: y"], { nr: null });
    expect(r.code).toBe(1);
    expect(r.posts).toEqual([]);
    expect(r.err.join("\n")).toMatch(/Fix:.*sammelticket-anlegen/);
  });
  test("Post-Fehler (kein Schreibrecht): Exit 1 mit klarer Meldung", async () => {
    const r = await fahre(["--zeile", "Defekt: x Beleg: y"], { postWirft: true });
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
    const code = await melden.main(["--zeile", "Defekt: x Beleg: y"], { ladeConfig: () => ({}), ladeLibs: () => Promise.reject(new Error("Import kaputt")), err: () => undefined, log: () => undefined });
    expect(code).toBe(2);
  });
});

describe("melden.mjs in der Fabrik (factory#221 AK1): kein Sync-Stand, Meldestelle ist das eigene Repo", () => {
  const REPO = "fabrik/harness";
  const TITEL = "Harness-Härtung (gesammelt)";
  const wurzeln: string[] = [];
  afterEach(() => {
    for (const w of wurzeln.splice(0)) rmSync(w, { recursive: true, force: true });
  });
  const roh = (number: number, title: string, assignee?: string) => ({ number, title, created_at: "2026-01-01T00:00:00Z", assignees: assignee ? [{ login: assignee }] : [] });
  const einzel = (nr: number): unknown => {
    if (nr === 25) return { state: "open", assignees: [{ login: "x" }], user: { login: "fabrik", type: "User" } };
    return { state: "open", assignees: [], user: { login: "fabrik", type: "User" } };
  };
  // Der echte Auswahlweg (ladeSammelKontext, waehleSammelticket) gegen injizierte Liste und Einzelabrufe: kein gemocktes `waehleSammelticket`.
  async function fahre(offene: unknown[]) {
    // @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
    const inbox = (await import("../scripts/inbox-lib.mjs")) as { ladeSammelKontext(io: object): unknown; waehleSammelticket: (...a: unknown[]) => unknown };
    const wurzel = mkdtempSync(join(tmpdir(), "melden-fabrik-"));
    wurzeln.push(wurzel);
    const posts: unknown[][] = [];
    const err: string[] = [];
    const aufrufe: { args: string[]; token: unknown }[] = [];
    const api = (args: string[], o: { token?: string }) => {
      aufrufe.push({ args, token: o.token });
      return einzel(Number(args[1].split("/").pop()));
    };
    const libs = {
      MELDESTELLE: REPO,
      REPO,
      ladeSammelKontext: (io: object) => inbox.ladeSammelKontext({ ...io, ladeOffene: () => [offene], ladeKommentare: () => [] }),
      waehleSammelticket: (o: unknown, r: string, a: unknown) => inbox.waehleSammelticket(o, r, a, TITEL),
      postZeilen: (...a: unknown[]) => { posts.push(a); },
    };
    const code = await melden.main(["--zeile", "Defekt: x Beleg: #5 y"], {
      ladeConfig: () => ({}),
      ladeLibs: () => Promise.resolve(libs),
      env: { MELDESTELLE_TOKEN: "mt", PROJECT_TOKEN: "pt" },
      log: () => undefined,
      err: (s: string) => err.push(s),
      api,
      bereite: (z: string[], o: object) => lib.bereiteMeldung(z, { wurzel, pruefe: () => true, ...o }),
    });
    return { code, posts, err: err.join("\n"), aufrufe };
  }

  test("schreibt ins jüngste ungeclaimte Sammelticket: ohne Stand-Zeile, ohne Herkunft, ohne Token", async () => {
    const r = await fahre([roh(10, TITEL), roh(20, TITEL), roh(25, TITEL), roh(30, TITEL, "x"), roh(40, "Fremder Titel")]);
    expect(r.code).toBe(0);
    expect(r.posts).toEqual([[20, "- [ ] Defekt: x Beleg: #5 y", REPO, undefined]]);
    expect(r.aufrufe.length).toBeGreaterThan(0);
    for (const a of r.aufrufe) {
      expect(a.args.slice(0, 1)).toEqual(["api"]);
      expect(a.args[1]).toMatch(/^repos\/fabrik\/harness\/issues\/\d+$/);
      expect(a.token).toBeUndefined();
    }
  });
  test("ohne ungeclaimtes Sammelticket: Exit 1 mit Fix-Zeile, nichts gepostet, nichts angelegt", async () => {
    const r = await fahre([roh(30, TITEL, "x"), roh(40, "Fremder Titel")]);
    expect(r.code).toBe(1);
    expect(r.posts).toEqual([]);
    expect(r.err).toMatch(/kein ungeclaimtes Harness-Sammelticket in fabrik\/harness/);
    expect(r.err).toMatch(/Fix: node scripts\/sammelticket-anlegen\.mjs harness/);
    for (const a of r.aufrufe) expect(a.args.join(" ")).not.toMatch(/issue.*create|-f title/);
  });
});

describe("meldestelleZugang (factory#208 L11): ein Zugang für alle Schreiber", () => {
  const env = { MELDESTELLE_TOKEN: "mt", PROJECT_TOKEN: "pt" };
  test("fremde Stelle: fremd, Herkunft ist das eigene Repo, Token wie meldestelleToken", () => {
    expect(lib.meldestelleZugang({ stelle: "eingang/privat", eigenes: "acme/proj", env })).toEqual({ stelle: "eingang/privat", fremd: true, herkunft: "acme/proj", token: "mt" });
  });
  test("eigene Stelle (auch anders geschrieben): nicht fremd, keine Herkunft, kein Token", () => {
    expect(lib.meldestelleZugang({ stelle: "Acme/Proj", eigenes: "acme/proj", env })).toEqual({ stelle: "Acme/Proj", fremd: false, herkunft: null, token: undefined });
  });
});

describe("nummernMitHerkunft und bereiteMeldung mit Herkunft (factory#208 L7)", () => {
  test("nackte #n bekommen owner/name; Nummern mit Herkunft und Nicht-Nummern bleiben", () => {
    expect(lib.nummernMitHerkunft("Reparatur #12 und #7, aber factory#153, a/b#3, x#4, ##5, #12ab und #abc, Ende #9.", "acme/proj")).toBe(
      "Reparatur acme/proj#12 und acme/proj#7, aber factory#153, a/b#3, x#4, ##5, #12ab und #abc, Ende acme/proj#9.",
    );
  });
  test("ohne Herkunft (eigene Stelle) bleibt der Text unverändert", () => {
    expect(lib.nummernMitHerkunft("Reparatur #12", null)).toBe("Reparatur #12");
  });
  test("bereiteMeldung schreibt die Herkunft vor der Sperrprüfung (sie sieht owner/name#n) und in den Text", () => {
    const gesehen: string[] = [];
    const r = lib.bereiteMeldung(["- [ ] gescheitert: #12 (x)"], { stand: null, herkunft: "acme/proj", pruefe: (t) => (gesehen.push(t), true) });
    expect(r).toEqual({ ok: true, text: "- [ ] gescheitert: acme/proj#12 (x)" });
    expect(gesehen).toEqual(["- [ ] gescheitert: acme/proj#12 (x)"]);
  });
  test("ein Treffer der Sperrprüfung im umgeschriebenen Text sperrt (die Herkunft kann selbst der Treffer sein)", () => {
    const r = lib.bereiteMeldung(["#12"], { stand: null, herkunft: "acme/proj", pruefe: (t) => !t.includes("acme/proj#") });
    expect(r.ok).toBe(false);
  });
  test("ohne herkunft (Standard) bleiben nackte Nummern stehen", () => {
    expect(lib.bereiteMeldung(["- [ ] x #4"], { stand: null, pruefe: () => true })).toEqual({ ok: true, text: "- [ ] x #4" });
  });
  test("ohne wurzel (Standard: Repo-Wurzel des Skripts, im Quellrepo ohne Sync-Stand): Text ohne Stand-Zeile", () => {
    expect(lib.bereiteMeldung(["- [ ] x"], { pruefe: () => true })).toEqual({ ok: true, text: "- [ ] x" });
  });
});

describe("eigenerLogin und zeileBekannt (factory#208 L6): Dedupe am eigenen Konto", () => {
  const fremd = { fremd: true, token: "mt" };
  test("fremde Stelle: der Login aus gh api user, mit dem Token der Stelle", () => {
    const aufrufe: unknown[][] = [];
    const login = lib.eigenerLogin({ zugang: fremd, api: (a, o) => (aufrufe.push([a, o]), { login: "fremdkonto" }), warn: () => undefined });
    expect(login).toBe("fremdkonto");
    expect(aufrufe).toEqual([[["api", "user"], { token: "mt" }]]);
  });
  test("eigene Stelle: kein Aufruf, kein Login", () => {
    const gerufen: string[] = [];
    expect(lib.eigenerLogin({ zugang: { fremd: false }, api: () => (gerufen.push("api"), { login: "x" }), warn: (z) => gerufen.push(z) })).toBeNull();
    expect(gerufen).toEqual([]);
  });
  test("Antwort null oder ohne Objekt: wie ein fehlender Login (Warnzeile, null)", () => {
    const warn: string[] = [];
    expect(lib.eigenerLogin({ zugang: fremd, api: () => null, warn: (z) => warn.push(z) })).toBeNull();
    expect(warn).toHaveLength(1);
    expect(warn[0]).toMatch(/^HINWEIS Dedupe: gh api user liefert keinen Login/);
  });
  test("leerer Login zählt wie ein fehlender (Warnzeile, null)", () => {
    const warn: string[] = [];
    expect(lib.eigenerLogin({ zugang: fremd, api: () => ({ login: "" }), warn: (z) => warn.push(z) })).toBeNull();
    expect(warn).toHaveLength(1);
  });
  test("Fehler oder fehlender Login: null und eine Warnzeile mit Grund", () => {
    const warn: string[] = [];
    expect(lib.eigenerLogin({ zugang: fremd, api: () => { throw new Error("HTTP 403\nzweite Zeile"); }, warn: (z) => warn.push(z) })).toBeNull();
    expect(lib.eigenerLogin({ zugang: fremd, api: () => ({}), warn: (z) => warn.push(z) })).toBeNull();
    expect(warn).toHaveLength(2);
    expect(warn[0]).toMatch(/^HINWEIS Dedupe: eigenes Konto nicht lesbar \(HTTP 403\)/);
    expect(warn[0]).not.toContain("zweite Zeile");
    expect(warn[1]).toMatch(/^HINWEIS Dedupe: gh api user liefert keinen Login/);
  });
  const zeile = "- [ ] 2026-11-05 Punkt: Befund";
  const k = (login: string | null, body = zeile) => ({ user: login === null ? null : { login, type: "User" }, body });
  test("eigenes Konto zählt als vertraut (Groß-/Kleinschreibung egal), ein Fremder nie, ohne eigen nur der Owner", () => {
    expect(lib.zeileBekannt({ kommentare: [k("Fremdkonto")], owner: "eingang", eigen: "fremdkonto", schluessel: "Punkt: " })).toBe(true);
    expect(lib.zeileBekannt({ kommentare: [k("fremdkonto")], owner: "eingang", eigen: null, schluessel: "Punkt: " })).toBe(false);
    expect(lib.zeileBekannt({ kommentare: [k("fremdkonto")], owner: "eingang", schluessel: "Punkt: " })).toBe(false);
    expect(lib.zeileBekannt({ kommentare: [k("anderer")], owner: "eingang", eigen: "fremdkonto", schluessel: "Punkt: " })).toBe(false);
    expect(lib.zeileBekannt({ kommentare: [k("eingang")], owner: "eingang", schluessel: "Punkt: " })).toBe(true);
    expect(lib.zeileBekannt({ kommentare: [k(null)], owner: "eingang", eigen: "", schluessel: "Punkt: " })).toBe(false);
  });
  test("Kommentar ohne Body oder ohne user zählt nie als bekannt, wirft nicht", () => {
    const k = [{ user: { login: "eingang", type: "User" } } as unknown as { user: { login: string; type: string }; body: string }, { user: null, body: zeile }];
    expect(lib.zeileBekannt({ kommentare: [...k, null as never], owner: "eingang", eigen: "x", schluessel: "Punkt: " })).toBe(false);
    expect(lib.zeileBekannt({ kommentare: [{ body: zeile } as never], owner: "eingang", eigen: "x", schluessel: "Punkt: " })).toBe(false);
  });
  test("nur offene Listenzeilen mit dem Schlüssel zählen", () => {
    expect(lib.zeileBekannt({ kommentare: [k("eingang", "- [x] 2026 Punkt: Befund")], owner: "eingang", schluessel: "Punkt: " })).toBe(false);
    expect(lib.zeileBekannt({ kommentare: [k("eingang", "Text\n* [ ] Punkt: Befund")], owner: "eingang", schluessel: "Punkt: " })).toBe(true);
  });
});

describe("keinSammelticketText (factory#208 L24): ein Wortlaut für alle Schreiber", () => {
  test("Agentenvariante: rollenneutraler Wortlaut samt „Zeile unter BEFUNDE im Bericht nennen“", () => {
    expect(lib.keinSammelticketText({ fuer: "in eingang/privat" })).toBe(
      "kein ungeclaimtes Harness-Sammelticket in eingang/privat\nFix: node scripts/sammelticket-anlegen.mjs harness; ohne Zugriff auf die Meldestelle die Zeile unter BEFUNDE im Bericht nennen",
    );
  });
  test("CI-Variante: kein Bericht, stattdessen Sammelticket anlegen lassen und der nächste Wochenlauf meldet erneut; Trenner wählbar", () => {
    expect(lib.keinSammelticketText({ fuer: "für 2 neue Zeile(n)", ci: true, trenner: " " })).toBe(
      "kein ungeclaimtes Harness-Sammelticket für 2 neue Zeile(n) Fix: node scripts/sammelticket-anlegen.mjs harness; im Bezieher an der Meldestelle ein Harness-Sammelticket anlegen lassen, der nächste Wochenlauf meldet die Zeilen erneut",
    );
  });
  test("die drei Schreiber haben den Text nicht mehr als eigene Zeichenkette (nur meldung-lib trägt ihn)", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
    for (const f of ["melden.mjs", "harness-doctor-melden.mjs", "spezifikation.mjs"]) {
      const q = readFileSync(join(dir, f), "utf8");
      expect(q, f).not.toContain("kein ungeclaimtes Harness-Sammelticket");
      expect(q, f).toMatch(/keinSammelticketText\(/);
    }
  });
});

describe("melden.mjs reicht die Herkunft an bereite (factory#208 L7, Lens-Test)", () => {
  const libs = (stelle: string) => ({ MELDESTELLE: stelle, REPO: "acme/proj", ladeSammelKontext: () => ({ offene: [] }), waehleSammelticket: () => ({ number: 5 }), postZeilen: () => undefined });
  const lauf = async (stelle: string) => {
    const opt: unknown[] = [];
    await melden.main(["--zeile", "Defekt: x #3 Beleg: y"], { ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs(stelle)), env: { MELDESTELLE_TOKEN: "mt" }, log: () => undefined, err: () => undefined, bereite: (_z: string[], o: unknown) => (opt.push(o), { ok: true, text: "t" }) });
    return opt;
  };
  test("fremde Meldestelle: herkunft ist das eigene Repo; eigene Stelle: null", async () => {
    expect(await lauf("eingang/privat")).toEqual([{ herkunft: "acme/proj", eigenes: "acme/proj" }]);
    expect(await lauf("acme/proj")).toEqual([{ herkunft: null, eigenes: "acme/proj" }]);
  });
});

describe("Stand-Zeile nennt das eigene Repo (factory#238 L25)", () => {
  const wurzeln: string[] = [];
  afterEach(() => {
    for (const w of wurzeln.splice(0)) rmSync(w, { recursive: true, force: true });
  });
  const wurzelMitStand = (): string => {
    const w = mkdtempSync(join(tmpdir(), "meldung-eigenes-"));
    wurzeln.push(w);
    mkdirSync(join(w, ".factory"));
    writeFileSync(join(w, ".factory", "sync-stand.json"), '{"quelle":{"tag":"v0.9.0","commit":"13131bcdeadbeef"}}');
    return w;
  };
  const ZEILE = "factory: v0.9.0 (13131bc) · acme/proj";
  test("factoryStand hängt das eigene Repo an; ohne eigenes Repo bleibt die Zeile unverändert", () => {
    expect(lib.factoryStand(ok("v0.9.0", "13131bcdeadbeef"), "acme/proj")).toBe(ZEILE);
    expect(lib.factoryStand(ok("v0.9.0", "13131bcdeadbeef"))).toBe("factory: v0.9.0 (13131bc)");
    expect(lib.factoryStand({ zustand: "fehlt", stand: null }, "acme/proj")).toBeNull();
  });
  test("bereiteMeldung mit Sync-Stand schreibt die Fußzeile samt eigenem Repo, auch bei fremder Meldestelle", () => {
    const eigen = lib.bereiteMeldung(["- [ ] a"], { wurzel: wurzelMitStand(), pruefe: () => true, eigenes: "acme/proj" });
    expect(eigen.text).toBe(`- [ ] a\n\n${ZEILE}`);
    const fremd = lib.bereiteMeldung(["- [ ] a #3"], { wurzel: wurzelMitStand(), pruefe: () => true, eigenes: "acme/proj", herkunft: "acme/proj" });
    expect(fremd.text).toBe(`- [ ] a acme/proj#3\n\n${ZEILE}`);
    expect(lib.bereiteMeldung(["- [ ] a"], { wurzel: wurzelMitStand(), pruefe: () => true }).text).toBe("- [ ] a\n\nfactory: v0.9.0 (13131bc)");
  });
  test("ohne Sync-Stand (Upstream) bleibt die Meldung ohne Fußzeile, auch mit eigenem Repo", () => {
    const leer = mkdtempSync(join(tmpdir(), "meldung-eigenes-"));
    wurzeln.push(leer);
    expect(lib.bereiteMeldung(["- [ ] a"], { wurzel: leer, pruefe: () => true, eigenes: "acme/proj" }).text).toBe("- [ ] a");
  });
  test("--dry-run zeigt die Fußzeile mit dem eigenen Repo (echtes bereiteMeldung)", async () => {
    const log: string[] = [];
    const wurzel = wurzelMitStand();
    const libs = { MELDESTELLE: "eingang/privat", REPO: "acme/proj", ladeSammelKontext: () => ({ offene: [] }), waehleSammelticket: () => ({ number: 5 }), postZeilen: () => undefined };
    const code = await melden.main(["--zeile", "Defekt: x Beleg: y", "--dry-run"], { ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), env: { MELDESTELLE_TOKEN: "mt" }, log: (z: string) => log.push(z), err: () => undefined, bereite: (z: string[], o: object) => lib.bereiteMeldung(z, { wurzel, pruefe: () => true, ...o }) });
    expect(code).toBe(0);
    expect(log.join("\n")).toContain(ZEILE);
  });
  test("istStandZeile erkennt die Zeile mit Repo-Zusatz (Rundlauf) und lehnt kaputte Zusätze ab", () => {
    expect(lib.istStandZeile(ZEILE)).toBe(true);
    expect(lib.factoryStand({ zustand: "kaputt", stand: null }, "acme/proj")).toBe("factory: unbekannt (Sync-Stand unlesbar) · acme/proj");
    expect(lib.istStandZeile(lib.factoryStand({ zustand: "kaputt", stand: null }, "acme/proj") as string)).toBe(true);
    for (const z of ["factory: v0.9.0 (13131bc) · my-org/my-repo", "factory: v0.9.0 (13131bc) · my.org/repo.js"]) expect(lib.istStandZeile(z), z).toBe(true);
    for (const z of ["factory: v0.9.0 (13131bc) · ", "factory: v0.9.0 (13131bc) · acme", "factory: v0.9.0 (13131bc) · acme/proj danach", "factory: v0.9.0 (13131bc) ·acme/proj"]) expect(lib.istStandZeile(z), z).toBe(false);
  });
});

describe("Wächter: jeder Schreiber nach postZeilen geht durch bereiteMeldung (AK1, AK3)", () => {
  // Keine Ausnahmen (factory#153): auch die Sicherheits-Inboxen prüfen ihre Zeilen vor dem Post.
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts");
  const dateien = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? dateien(join(d, e.name)) : e.name.endsWith(".mjs") ? [join(d, e.name)] : []));
  // Quelltext ohne Kommentare: ein Aufruf zählt nur als Code (`name(`), nie über einen Import oder eine Kommentarzeile.
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const ruft = (q: string, name: string) => new RegExp(`(?<![\\w])${name}\\(`).test(q);
  // `inbox-lib` definiert `postZeilen`, `inbox-start-lib` reicht es im Bezieher mit dem eigenen Ziel-Repo weiter: beide senden nichts selbst, die Schreiber prüfen vorher.
  const mitPost = dateien(dir).filter((f) => !/inbox(-start)?-lib\.mjs$/.test(f) && ruft(code(f), "postZeilen"));
  const name = (f: string) => f.split(/[\\/]/).pop() as string;

  test("Heuristik findet die bekannten Schreiber (Wächter nicht vakuös)", () => {
    const namen = mitPost.map(name);
    for (const n of ["harness-doctor-melden.mjs", "spezifikation.mjs", "melden.mjs", "audit-einordnung.mjs", "codescanning-inbox.mjs"]) expect(namen).toContain(n);
  });
  test("jedes Skript mit postZeilen( ruft bereiteMeldung( auf", () => {
    const ohne = mitPost.filter((f) => !ruft(code(f), "bereiteMeldung")).map(name);
    expect(ohne).toEqual([]);
  });
});

describe("istStandZeile (factory#152): erkennt genau die Zeilen, die factoryStand erzeugt", () => {
  test("Rundlauf über alle Formen von factoryStand", () => {
    const formen: Stand[] = [ok("v0.6.0", "abcdef0123456789"), ok(undefined, "abcdef0123456789"), ok("v1.0.0", undefined), ok("", ""), { zustand: "kaputt", stand: null }];
    for (const f of formen) {
      const zeile = lib.factoryStand(f);
      expect(zeile).not.toBeNull();
      expect(lib.istStandZeile(zeile as string)).toBe(true);
    }
  });
  test("Positivfälle: jede Hex-Ziffer 0-9 und a-f ist in der Commit-Kurzform erlaubt", () => {
    for (const commit of ["1234567", "89abcde", "0f0f0f0", "9876543"]) expect(lib.istStandZeile(`factory: v1 (${commit})`)).toBe(true);
    expect(lib.istStandZeile("factory: unbekannt (unbekannt)")).toBe(true);
    expect(lib.istStandZeile("factory: x (abcdef0)")).toBe(true);
    expect(lib.istStandZeile("factory: v10.20.30-rc.1+build.42 (abcdef0)")).toBe(true);
    expect(lib.istStandZeile("factory: v1 (beta) (abcdef0)")).toBe(true);
  });
  test("Negativfälle am Literal und an den Leerzeichen", () => {
    for (const zeile of ["factory: v1\t(abcdef0)", "factory; v1 (abcdef0)", "factori: v1 (abcdef0)", "factory v1 (abcdef0)","factory:v1 (abcdef0)", "factory:\tv1 (abcdef0)", "factory: v1(abcdef0)", "Factory: v1 (abcdef0)", "faktory: v1 (abcdef0)", "factory: unbekannt (sync-stand unlesbar)"]) expect(lib.istStandZeile(zeile)).toBe(false);
    for (const zeile of ["factory: v1 (abcdef0", "factory: v1 abcdef0)"]) expect(lib.istStandZeile(zeile)).toBe(false);
  });
  test("Negativfälle an den Klammern und am Literal der unlesbaren Stand-Zeile", () => {
    expect(lib.istStandZeile("factory: v1 [abcdef0)")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (abcdef0]")).toBe(false);
    for (const zeichen of ["/", ":", "`"]) expect(lib.istStandZeile(`factory: v1 (abcde${zeichen}0)`)).toBe(false);
    for (const klammerInhalt of ["", "x", "unbekanntunbekannt", "unbekanntt", "unbekannt0", "Unbekannt", "xnbekannt", "unbexannt", "unbekannx", "vielleich"]) expect(lib.istStandZeile(`factory: v1 (${klammerInhalt})`)).toBe(false);
    expect(lib.istStandZeile("factory: unbekannt (Sync-Stand unlesbar) danach Text")).toBe(false);
    expect(lib.istStandZeile("siehe factory: unbekannt (Sync-Stand unlesbar)")).toBe(false);
  });
  test("Negativfälle: freier Text, factory: mitten in der Zeile, falscher Commit, leer", () => {
    expect(lib.istStandZeile("factory: das ist ein Satz")).toBe(false);
    expect(lib.istStandZeile("siehe factory: v1 (abcdef0)")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (ZZZ)")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (abcdef0) danach Text")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (abcdef)")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (abcdefg)")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (abcdef01)")).toBe(false);
    expect(lib.istStandZeile("factory:  (abcdef0)")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (ABCDEF0)")).toBe(false);
    expect(lib.istStandZeile("factory: v1 (abcdef012)")).toBe(false);
    expect(lib.istStandZeile("")).toBe(false);
    expect(lib.istStandZeile(undefined as unknown as string)).toBe(false);
  });
});
