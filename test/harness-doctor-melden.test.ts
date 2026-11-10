/* Harness-Doctor, Wochenlauf (#1800): jede Lücke wird eine Zeile im Harness-Sammelticket, bekannte Punkte nicht noch einmal.
 * Alle IO-Teile sind Fakes (kein Netz); `lauf` ist die öffentliche Einstiegsfunktion, `ermittleLuecken` die Token-Weiche in Actions. */
import { describe, test, vi } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMelden from "../scripts/harness-doctor-melden.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDoctor from "../scripts/harness-doctor.mjs";

interface Luecke { punkt: string; befund: string; fix: string; nichtPruefbar?: boolean }
interface Kommentar { user: { login: string; type: string } | null; body: string }
interface Io {
  ermittle: () => Luecke[];
  kontext: () => { kommentare: Kommentar[]; owner: string; ziel: number | null; eigen?: string | null };
  bereite: (zeilen: string[]) => { ok: boolean; text?: string; grund?: string };
  postZeilen: (nr: number, text: string) => void;
  heute: string;
  log: (s: string) => void;
}
interface Melden {
  lauf(a: { io: Io; trocken?: boolean }): number;
  ermittleLuecken(a: { env: Record<string, string>; repo: string; pruefe: () => { ok: boolean; punkt: string; befund?: string; fix?: string }[] }): Luecke[];
  istBekannt(punkt: string, kommentare: Kommentar[], owner: string, art?: string, eigen?: string | null): boolean;
  plane(a: { luecken: Luecke[]; kommentare: Kommentar[]; owner: string; heute: string; eigen?: string | null }): string[];
  main(argv: string[], deps: { env?: Record<string, string>; api?: (a: string[], o?: unknown) => unknown; bereite?: (zeilen: string[], o?: { herkunft?: string | null }) => { ok: boolean; text?: string; grund?: string }; ladeConfig: () => unknown; ladeLibs: () => Promise<unknown>; log: (s: string) => void; err: (s: string) => void; pruefLauf?: (a: Record<string, unknown>) => { ergebnis: unknown[] } }): Promise<number>;
}
const melden = rawMelden as unknown as Melden;

const OWNER = "acme";
const ICH = { login: "acme", type: "User" };
const L1: Luecke = { punkt: "Secret PROJECT_TOKEN", befund: "PROJECT_TOKEN fehlt (ein Workflow liest es)", fix: "gh secret set PROJECT_TOKEN --repo acme/demo" };
const L2: Luecke = { punkt: "Label forum", befund: 'Label "forum" fehlt', fix: 'gh label create "forum" --repo acme/demo' };
const NP: Luecke = { punkt: "PVR", befund: "private-vulnerability-reporting nicht lesbar (HTTP 404)", fix: "mit einem Konto mit Admin-Recht prüfen", nichtPruefbar: true };
const zeile = (l: Luecke, kopf = "- [ ]"): string => `${kopf} 2026-10-01 Harness-Doctor (Wochenlauf): ${l.nichtPruefbar ? "NICHT PRÜFBAR" : "LÜCKE"} ${l.punkt}: ${l.befund} Fix: ${l.fix}`;

const bereiteStub: Io["bereite"] = (zeilen) => ({ ok: true, text: zeilen.join("\n") });
interface Welt { eigen?: string | null; treffer?: boolean; stand?: string; luecken?: Luecke[]; kommentare?: Kommentar[]; ziel?: number | null; postWirft?: boolean; ermittleWirft?: boolean; kontextWirft?: boolean }
function fahre(w: Welt, trocken = false): { code: number; log: string[]; posts: { nr: number; text: string }[] } {
  const log: string[] = [];
  const posts: { nr: number; text: string }[] = [];
  const io: Io = {
    ermittle: () => {
      if (w.ermittleWirft) throw new Error("Projekt-Config fehlt");
      return w.luecken ?? [];
    },
    kontext: () => {
      if (w.kontextWirft) throw new Error("HTTP 502");
      return { kommentare: w.kommentare ?? [], owner: OWNER, ziel: w.ziel === undefined ? 1814 : w.ziel, eigen: w.eigen ?? null };
    },
    bereite: (zeilen) => (w.treffer ? { ok: false, grund: "Meldung nicht gesendet: check-internalrefs --text meldet einen Treffer\nFix: neutral formulieren" } : { ok: true, text: w.stand ? `${zeilen.join("\n")}\n\n${w.stand}` : zeilen.join("\n") }),
    postZeilen: (nr, text) => {
      if (w.postWirft) throw new Error("HTTP 403");
      posts.push({ nr, text });
    },
    heute: "2026-10-21",
    log: (s) => log.push(s),
  };
  return { code: melden.lauf({ io, trocken }), log, posts };
}

describe("harness-doctor-melden: lauf", () => {
  test("keine Lücke: kein Post, Exit 0, der Langfuse-Hinweis steht im Log", () => {
    const r = fahre({});
    assert.equal(r.code, 0);
    assert.deepEqual(r.posts, []);
    assert.ok(r.log.includes("Harness-Doctor (Wochenlauf): nichts Neues"));
    assert.ok(r.log.some((z) => z.startsWith("HINWEIS Langfuse: im Wochenlauf nicht geprüft")));
  });

  test("neue Lücken: genau ein Kommentar im Zeilenformat mit Datum und Fix, an das ungeclaimte Sammelticket", () => {
    const r = fahre({ luecken: [L1, L2] });
    assert.equal(r.code, 0);
    assert.equal(r.posts.length, 1);
    assert.equal(r.posts[0].nr, 1814);
    assert.deepEqual(r.posts[0].text.split("\n"), [zeile(L1).replace("2026-10-01", "2026-10-21"), zeile(L2).replace("2026-10-01", "2026-10-21")]);
  });

  test("Meldestelle (factory#153): der Factory-Stand steht als Fußzeile im Post-Body; ohne Stand bleibt der Body unverändert", () => {
    const mit = fahre({ luecken: [L1], stand: "factory: v0.6.0 (abc1234)" });
    assert.equal(mit.posts[0].text, `${zeile(L1).replace("2026-10-01", "2026-10-21")}\n\nfactory: v0.6.0 (abc1234)`);
    const ohne = fahre({ luecken: [L1] });
    assert.equal(ohne.posts[0].text, zeile(L1).replace("2026-10-01", "2026-10-21"));
  });

  test("Meldestelle (factory#153): der Trockenlauf zeigt die Stand-Fußzeile", () => {
    const r = fahre({ luecken: [L1], stand: "factory: v0.6.0 (abc1234)" }, true);
    assert.ok(r.log.some((z) => z.startsWith("[dry-run] ") && z.endsWith("factory: v0.6.0 (abc1234)")));
  });

  test("Meldestelle (factory#153): Treffer der Sperrprüfung → nichts gepostet, Exit 1, auch im Trockenlauf; Fehlerzeile mit Fix", () => {
    for (const trocken of [false, true]) {
      const r = fahre({ luecken: [L1], treffer: true }, trocken);
      assert.equal(r.code, 1);
      assert.deepEqual(r.posts, []);
      assert.ok(r.log.some((z) => /^::error::.*check-internalrefs --text.*Fix:/.test(z)));
      assert.equal(r.log.some((z) => z.includes("[dry-run]")), false);
    }
  });

  test("ein mehrzeiliger Befund wird einzeilig (eine Zeile pro Lücke)", () => {
    const r = fahre({ luecken: [{ ...L1, befund: "erste\nzweite" }] });
    assert.equal(r.posts[0].text.split("\n").length, 1);
    assert.match(r.posts[0].text, /LÜCKE Secret PROJECT_TOKEN: erste zweite Fix:/);
  });

  test("offene Zeile eines vertrauten Autors: still; abgehakte Zeile, fremder Autor und anderer Punkt: wird gemeldet", () => {
    const still = fahre({ luecken: [L1], kommentare: [{ user: ICH, body: `Notiz\n${zeile(L1)}` }] });
    assert.deepEqual(still.posts, []);
    assert.ok(still.log.some((z) => z.includes("nichts Neues")));
    const erledigt = fahre({ luecken: [L1], kommentare: [{ user: ICH, body: zeile(L1, "- [x]") }] });
    assert.equal(erledigt.posts.length, 1);
    const fremd = fahre({ luecken: [L1], kommentare: [{ user: { login: "fremd", type: "User" }, body: zeile(L1) }] });
    assert.equal(fremd.posts.length, 1);
    const ohneAutor = fahre({ luecken: [L1], kommentare: [{ user: null, body: zeile(L1) }] });
    assert.equal(ohneAutor.posts.length, 1);
    const anderer = fahre({ luecken: [L1, L2], kommentare: [{ user: ICH, body: zeile(L1) }] });
    assert.equal(anderer.posts[0].text.split("\n").length, 1);
    assert.match(anderer.posts[0].text, /LÜCKE Label forum:/);
  });

  test("der Schlüssel ist der Punkt, nicht der Befund; ein Punkt mit gleichem Präfix zählt nicht als bekannt", () => {
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: zeile({ ...L1, befund: "ganz anderer Text" }) }], OWNER), true);
    assert.equal(melden.istBekannt("Secret PROJECT", [{ user: ICH, body: zeile(L1) }], OWNER), false);
    assert.equal(melden.istBekannt(L1.punkt, [{ user: { login: "github-actions[bot]", type: "Bot" }, body: zeile(L1) }], OWNER), true);
  });

  test("ein nicht prüfbarer Punkt wird als Zeile NICHT PRÜFBAR ins Sammelticket geschrieben (factory#116)", () => {
    const r = fahre({ luecken: [NP] });
    assert.equal(r.posts.length, 1);
    assert.equal(r.posts[0].text, "- [ ] 2026-10-21 Harness-Doctor (Wochenlauf): NICHT PRÜFBAR PVR: private-vulnerability-reporting nicht lesbar (HTTP 404) Fix: mit einem Konto mit Admin-Recht prüfen");
  });

  test("Abgleich mit der Art: eine offene NICHT-PRÜFBAR-Zeile hält still, eine LÜCKE-Zeile desselben Punkts verdeckt sie nicht und umgekehrt", () => {
    assert.deepEqual(fahre({ luecken: [NP], kommentare: [{ user: ICH, body: zeile(NP) }] }).posts, []);
    assert.equal(fahre({ luecken: [NP], kommentare: [{ user: ICH, body: zeile({ ...NP, nichtPruefbar: false }) }] }).posts.length, 1);
    assert.equal(fahre({ luecken: [{ ...NP, nichtPruefbar: false }], kommentare: [{ user: ICH, body: zeile(NP) }] }).posts.length, 1);
    assert.equal(melden.istBekannt("PVR", [{ user: ICH, body: zeile(NP) }], OWNER, "NICHT PRÜFBAR"), true);
    assert.equal(melden.istBekannt("PVR", [{ user: ICH, body: zeile(NP) }], OWNER), false);
  });

  test("schluesselFuer ohne Art ist der alte LÜCKE-Schlüssel", () => {
    assert.equal((rawMelden as { schluesselFuer: (p: string) => string }).schluesselFuer("Secret X"), "Harness-Doctor (Wochenlauf): LÜCKE Secret X: ");
  });

  test("ermittleLuecken reicht nichtPruefbar durch", () => {
    const l = melden.ermittleLuecken({ env: {}, repo: "acme/demo", pruefe: () => [{ ok: false, punkt: "PVR", befund: "b", fix: "f", nichtPruefbar: true } as never] });
    assert.equal(l[0].nichtPruefbar, true);
  });

  test("alte LÜCKE-Zeilen gelten weiter (ohne Art-Angabe ist die Art LÜCKE)", () => {
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: zeile(L1) }], OWNER, "LÜCKE"), true);
  });

  test("offene Zeile mit *-Spiegelstrich, eingerückt oder mit Windows-Zeilenenden zählt als bekannt", () => {
    const z = zeile(L1);
    for (const body of [z.replace("- [ ]", "* [ ]"), `  ${z}`, `Notiz\r\n${z}\r\nEnde`]) {
      assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body }], OWNER), true, body);
    }
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: z.replace("- [ ]", "[ ]") }], OWNER), false);
    // linke Grenze: eine zitierte oder durch eine abgehakte Zeile erwähnte offene Zeile ist keine offene Zeile
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: `> ${z}` }], OWNER), false);
    assert.equal(melden.istBekannt(L1.punkt, [{ user: ICH, body: `- [x] ersetzt ${z}` }], OWNER), false);
  });

  test("ohne ungeclaimtes Sammelticket: alles schon gemeldet bleibt grün (nichts zu posten), eine neue Lücke ist ::error::", () => {
    const still = fahre({ luecken: [L1], ziel: null, kommentare: [{ user: ICH, body: zeile(L1) }] });
    assert.equal(still.code, 0);
    assert.deepEqual(still.posts, []);
    assert.equal(fahre({ luecken: [L1], ziel: null }).code, 1);
  });

  test("zwei Lücken desselben Punkts: beide in Lauf 1, danach in Lauf 2 keine", () => {
    const a: Luecke = { punkt: "Board produkt", befund: "projectId falsch", fix: "prüfen" };
    const b: Luecke = { punkt: "Board produkt", befund: "nummer falsch", fix: "prüfen" };
    const eins = fahre({ luecken: [a, b] });
    assert.equal(eins.posts[0].text.split("\n").length, 2);
    const zwei = fahre({ luecken: [a, b], kommentare: [{ user: ICH, body: eins.posts[0].text }] });
    assert.deepEqual(zwei.posts, []);
  });

  test("Dry-Run: Zeilen im Log, kein Post, Exit 0", () => {
    const r = fahre({ luecken: [L1] }, true);
    assert.equal(r.code, 0);
    assert.deepEqual(r.posts, []);
    assert.ok(r.log.some((z) => z.startsWith("[dry-run] - [ ] 2026-10-21 Harness-Doctor (Wochenlauf): LÜCKE Secret PROJECT_TOKEN:")));
  });

  test("Fehlerfälle sind ::error:: mit Fix und Exit 1: kein Sammelticket, Post wirft, Sammelticket nicht lesbar, Doctor nicht lauffähig", () => {
    const faelle: [Welt, RegExp][] = [
      [{ luecken: [L1], ziel: null }, /::error::.*kein ungeclaimtes Harness-Sammelticket.*Fix: node scripts\/sammelticket-anlegen\.mjs harness/],
      [{ luecken: [L1], postWirft: true }, /::error::.*nicht gepostet.*HTTP 403.*Fix:/],
      [{ luecken: [L1], kontextWirft: true }, /::error::.*Sammelticket nicht lesbar.*HTTP 502.*Fix:/],
      [{ ermittleWirft: true }, /::error::.*Doctor nicht lauffähig.*Projekt-Config fehlt.*Fix:/],
    ];
    for (const [welt, muster] of faelle) {
      const r = fahre(welt);
      assert.equal(r.code, 1, JSON.stringify(welt));
      assert.ok(r.log.some((z) => muster.test(z)), `${JSON.stringify(welt)}: ${r.log.join(" | ")}`);
      assert.deepEqual(r.posts, []);
    }
  });
});

describe("harness-doctor-melden: eigenes Konto an einer fremden Meldestelle (factory#208 L6)", () => {
  const FREMD = { login: "fremdkonto", type: "User" };
  test("istBekannt: die Zeile des eigenen Kontos zählt mit eigen, ohne eigen nicht (Owner ist ein anderer)", () => {
    assert.equal(melden.istBekannt(L1.punkt, [{ user: FREMD, body: zeile(L1) }], "eingang", "LÜCKE", "fremdkonto"), true);
    assert.equal(melden.istBekannt(L1.punkt, [{ user: FREMD, body: zeile(L1) }], "eingang"), false);
    assert.equal(melden.istBekannt(L1.punkt, [{ user: FREMD, body: zeile(L1) }], "eingang", "LÜCKE", "anderes"), false);
  });
  test("plane: eine eigene bekannte Zeile erzeugt keine Dublette, eine andere Lücke kommt", () => {
    const a = { luecken: [L1, L2], kommentare: [{ user: FREMD, body: zeile(L1) }], owner: "eingang", heute: "2026-11-05" };
    assert.equal(melden.plane({ ...a, eigen: "fremdkonto" }).length, 1);
    assert.equal(melden.plane(a).length, 2);
  });
  test("lauf: kontext().eigen geht in die Dedupe (wöchentliche Dubletten entfallen)", () => {
    const r = fahre({ luecken: [L1], kommentare: [{ user: FREMD, body: zeile(L1) }], eigen: "fremdkonto" });
    assert.equal(r.code, 0);
    assert.deepEqual(r.posts, []);
    assert.equal(fahre({ luecken: [L1], kommentare: [{ user: FREMD, body: zeile(L1) }] }).posts.length, 1);
  });
});

describe("harness-doctor-melden: CI-Variante des Fix-Texts (factory#208 L24)", () => {
  test("kein Sammelticket: voller Wortlaut ohne Verweis auf einen Bericht", () => {
    const r = fahre({ luecken: [L1], ziel: null });
    assert.ok(r.log.includes("::error::Harness-Doctor (Wochenlauf): kein ungeclaimtes Harness-Sammelticket für 1 neue Zeile(n) Fix: node scripts/sammelticket-anlegen.mjs harness; im Bezieher an der Meldestelle ein Harness-Sammelticket anlegen lassen, der nächste Wochenlauf meldet die Zeilen erneut"), r.log.join(" | "));
    assert.ok(!r.log.join(" ").includes("BEFUNDE"));
  });
});

describe("harness-doctor-melden: ermittleLuecken", () => {
  const ergebnis = [{ ok: true, punkt: "Labels" }, { ok: false, punkt: "Ruleset", befund: "fehlt", fix: "anlegen" }];
  test("in Actions ohne PROJECT_TOKEN: genau die Secret-Lücke, der Doctor wird nie gefragt", () => {
    const l = melden.ermittleLuecken({ env: { GITHUB_ACTIONS: "true" }, repo: "acme/demo", pruefe: () => assert.fail("kein Prüfaufruf ohne Token") });
    assert.deepEqual(l, [{ punkt: "Secret PROJECT_TOKEN", befund: "im Wochenlauf leer, der Doctor kann nicht prüfen", fix: "Wert per stdin, ohne TTY: `<wert-quelle> | gh secret set PROJECT_TOKEN --repo acme/demo` (z. B. `Get-Clipboard | …`)" }]);
  });
  test("mit Token oder außerhalb von Actions: nur die Lücken des Doctors", () => {
    const umgebungen: Record<string, string>[] = [{ GITHUB_ACTIONS: "true", PROJECT_TOKEN: "x" }, {}];
    for (const env of umgebungen) {
      assert.deepEqual(melden.ermittleLuecken({ env, repo: "acme/demo", pruefe: () => ergebnis }).map((l) => l.punkt), ["Ruleset"]);
    }
  });
});

describe("harness-doctor-melden: main (W15 Vorprüfung vor dem dynamischen Import)", () => {
  test("kaputte Config → ::error:: mit Exit 2, die Board-Libs werden nie importiert", async () => {
    const log: string[] = [];
    let importiert = false;
    const code = await melden.main([], {
      ladeConfig: () => { throw new Error("Projekt-Config fehlt: x\nFix: anlegen"); },
      ladeLibs: () => { importiert = true; return Promise.resolve({}); },
      log: (s) => log.push(s),
      err: () => undefined,
    });
    assert.equal(code, 2);
    assert.equal(importiert, false);
    assert.match(log.join("\n"), /^::error::Harness-Doctor \(Wochenlauf\): Projekt-Config nicht lesbar: Projekt-Config fehlt: x\nFix: anlegen$/);
  });
  test("ein Import-Fehler der Libs (z. B. Config beim Import) → ebenfalls ::error:: Exit 2", async () => {
    const log: string[] = [];
    const code = await melden.main([], { ladeConfig: () => ({}), ladeLibs: () => Promise.reject(new Error("Import kaputt")), log: (s) => log.push(s), err: () => undefined });
    assert.equal(code, 2);
    assert.match(log[0], /^::error::.*Import kaputt/);
  });
  test("factory#220 L39: die Dateipunkte des Wochenlaufs tragen Factory-Update (Standardverdrahtung wie --pruefen, Lens R1)", async () => {
    const bezieher = mkdtempSync(join(tmpdir(), "melden-fu-"));
    try {
      mkdirSync(join(bezieher, ".factory"), { recursive: true });
      writeFileSync(join(bezieher, ".factory", "sync-stand.json"), "{}");
      let punkte: { punkt: string; ok: boolean }[] = [];
      const libs = { REPO: "acme/proj", ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [], owner: "acme" }), waehleSammelticket: (o: { number: number }[]) => o[0], postZeilen: () => undefined };
      const pruefLauf = (a: { dateien: (x: { rootDir: string; config: unknown }) => { punkt: string; ok: boolean }[] }) => {
        punkte = a.dateien({ rootDir: bezieher, config: { repo: "acme/proj" } });
        return { ergebnis: [] };
      };
      const deps = { bereite: bereiteStub, ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: () => undefined, err: () => undefined, env: {}, pruefLauf };
      assert.equal(await melden.main(["--dry-run"], deps as never), 0);
      assert.ok(punkte.some((p) => p.punkt === "Factory-Update" && !p.ok), JSON.stringify(punkte));
    } finally {
      rmSync(bezieher, { recursive: true, force: true });
    }
  });
  test("Gutfall (#1821 L23d): Config lesbar, injizierte Libs, Lücke aus dem leeren Token → Zeile geht an das Sammelticket", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("PROJECT_TOKEN", "");
    try {
      const gepostet: [number, string][] = [];
      const log: string[] = [];
      const libs = {
        REPO: "acme/proj",
        ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [], owner: "acme" }),
        waehleSammelticket: (offene: { number: number }[]) => offene[0],
        postZeilen: (nr: number, text: string) => gepostet.push([nr, text]),
      };
      const deps = { bereite: bereiteStub, ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: (s: string) => log.push(s), err: () => undefined };
      assert.equal(await melden.main(["--dry-run"], deps), 0);
      assert.deepEqual(gepostet, [], "Trockenlauf schreibt nichts");
      assert.match(log.join("\n"), /\[dry-run\] - \[ \] .*LÜCKE Secret PROJECT_TOKEN/);
      assert.equal(await melden.main([], deps), 0);
      assert.equal(gepostet.length, 1);
      assert.equal(gepostet[0][0], 55);
      assert.match(gepostet[0][1], /LÜCKE Secret PROJECT_TOKEN.*gh secret set PROJECT_TOKEN --repo acme\/proj/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  test("Wochenlauf ruft den Doctor-Lauf mit rootDir und gh, langfuse null, dateien und ohne umgebung", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "");
    try {
      const aufrufe: Record<string, unknown>[] = [];
      const libs = { REPO: "acme/proj", ladeSammelKontext: () => ({ offene: [], kommentare: [], owner: "acme" }), waehleSammelticket: () => undefined, postZeilen: () => assert.fail("keine Lücke, nichts zu posten") };
      const code = await melden.main(["--dry-run"], {
        ladeConfig: () => ({}),
        ladeLibs: () => Promise.resolve(libs),
        log: () => undefined,
        err: () => undefined,
        pruefLauf: (a) => {
          aufrufe.push(a);
          return { ergebnis: [] };
        },
      });
      assert.equal(code, 0);
      assert.equal(aufrufe.length, 1);
      assert.equal(typeof aufrufe[0].rootDir, "string");
      assert.equal(typeof aufrufe[0].gh, "function");
      assert.equal(aufrufe[0].langfuse, null);
      assert.equal(typeof aufrufe[0].dateien, "function", "der Wochenlauf prüft die Dateipunkte des Beziehers (factory#94)");
      assert.equal("umgebung" in aufrufe[0], false, "der Wochenlauf prüft keine Altnamen der Runner-Umgebung");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  test("Wochenlauf (factory#208 L8): `dateien` trägt den Punkt Meldestelle, gelesen wird mit dem Token der injizierten env", async () => {
    const lesungen: unknown[][] = [];
    let dateien: ((a: { rootDir: string; config: unknown }) => { punkt: string; ok: boolean }[]) | undefined;
    const libs = { REPO: "acme/proj", ladeSammelKontext: () => ({ offene: [], kommentare: [], owner: "acme" }), waehleSammelticket: () => undefined, postZeilen: () => assert.fail("nichts zu posten") };
    const code = await melden.main(["--dry-run"], {
      env: { MELDESTELLE_TOKEN: "mt" },
      api: (...a: unknown[]) => { lesungen.push(a); return { has_issues: true }; },
      ladeConfig: () => ({}),
      ladeLibs: () => Promise.resolve(libs),
      log: () => undefined,
      err: () => undefined,
      pruefLauf: (a) => { dateien = a.dateien as typeof dateien; return { ergebnis: [] }; },
    });
    assert.equal(code, 0);
    const wurzel = mkdtempSync(join(tmpdir(), "meldestelle-"));
    let punkte: { punkt: string; ok: boolean }[];
    try {
      punkte = dateien?.({ rootDir: wurzel, config: { repo: "acme/proj", meldestelle: "eingang/privat" } }) ?? [];
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
    assert.deepEqual(punkte.filter((p) => p.punkt === "Meldestelle"), [{ punkt: "Meldestelle", ok: true }]);
    assert.deepEqual(lesungen[0], [["api", "repos/eingang/privat"], { token: "mt", timeout: 30000 }]);
  });
  test("Wochenlauf (L16a): `dateien` hat genau die Punktnamen der Standard-Dateipunkte von harness-doctor.mjs, keine eigene Liste", async () => {
    const lesen = () => ({ has_issues: true, state: "active" });
    type Punkte = (a: { rootDir: string; config: unknown }) => { punkt: string }[];
    let dateien: Punkte | undefined;
    const libs = { REPO: "acme/proj", ladeSammelKontext: () => ({ offene: [], kommentare: [], owner: "acme" }), waehleSammelticket: () => undefined, postZeilen: () => assert.fail("nichts zu posten") };
    await melden.main(["--dry-run"], {
      env: { MELDESTELLE_TOKEN: "mt" },
      api: lesen,
      ladeConfig: () => ({}),
      ladeLibs: () => Promise.resolve(libs),
      log: () => undefined,
      err: () => undefined,
      pruefLauf: (a) => { dateien = a.dateien as Punkte; return { ergebnis: [] }; },
    });
    const wurzel = mkdtempSync(join(tmpdir(), "l16a-"));
    try {
      const config = { repo: "acme/proj", meldestelle: "eingang/privat" };
      const doktor = rawDoctor.dateienStandard({ env: { MELDESTELLE_TOKEN: "mt" }, lesen }) as Punkte;
      const namen = (f?: Punkte) => (f?.({ rootDir: wurzel, config }) ?? []).map((p) => p.punkt);
      assert.ok(namen(doktor).length > 7, "Gegenprobe: die Standardliste trägt mehr als die Basis-Dateipunkte");
      assert.deepEqual(namen(dateien), namen(doktor));
    } finally {
      rmSync(wurzel, { recursive: true, force: true });
    }
  });
  describe("L13a (#97): der Token kommt aus der injizierten env, nie aus dem Prozess; fremdes und eigenes Ziel-Repo getrennt", () => {
    const lauf = async (ziel: string, env: Record<string, string>) => {
      const gepostet: unknown[][] = [];
      const libs = {
        REPO: "acme/proj",
        ZIEL: ziel,
        ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [], owner: "acme" }),
        waehleSammelticket: (o: { number: number }[]) => o[0],
        postZeilen: (...a: unknown[]) => gepostet.push(a),
      };
      const pruefe = () => ({ ergebnis: [{ ok: false, punkt: "X", befund: "b", fix: "f" }] });
      const code = await melden.main([], { env, bereite: bereiteStub, ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: () => undefined, err: () => undefined, pruefLauf: pruefe });
      assert.equal(code, 0);
      return gepostet[0]?.slice(2, 4);
    };
    test("fremdes Ziel-Repo mit PROJECT_TOKEN: postZeilen bekommt Ziel-Repo und Token", async () => {
      assert.deepEqual(await lauf("acme/ziel", { GITHUB_ACTIONS: "true", PROJECT_TOKEN: "pt" }), ["acme/ziel", "pt"]);
    });
    test("Meldestelle (factory#153): MELDESTELLE schlägt ZIEL; MELDESTELLE_TOKEN schlägt PROJECT_TOKEN", async () => {
      const gepostet: unknown[][] = [];
      const libs = { REPO: "acme/proj", ZIEL: "acme/ziel", MELDESTELLE: "eingang/privat", ladeSammelKontext: (io: { repo: string }) => ({ offene: [{ number: 55 }], kommentare: [], owner: io.repo.split("/")[0] }), waehleSammelticket: (o: { number: number }[]) => o[0], postZeilen: (...a: unknown[]) => gepostet.push(a) };
      const env = { GITHUB_ACTIONS: "true", PROJECT_TOKEN: "pt", MELDESTELLE_TOKEN: "mt" };
      const pruefe = () => ({ ergebnis: [{ ok: false, punkt: "X", befund: "b", fix: "f" }] });
      assert.equal(await melden.main([], { env, bereite: bereiteStub, ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: () => undefined, err: () => undefined, pruefLauf: pruefe }), 0);
      assert.deepEqual(gepostet[0]?.slice(2, 4), ["eingang/privat", "mt"]);
    });
    test("eigenes Ziel-Repo (auch anders geschrieben): kein Token, obwohl PROJECT_TOKEN gesetzt ist", async () => {
      assert.deepEqual(await lauf("acme/proj", { GITHUB_ACTIONS: "true", PROJECT_TOKEN: "pt" }), ["acme/proj", undefined]);
      assert.deepEqual(await lauf("Acme/Proj", { GITHUB_ACTIONS: "true", PROJECT_TOKEN: "pt" }), ["Acme/Proj", undefined]);
    });
    test("fremdes Ziel-Repo ohne PROJECT_TOKEN in der env: kein Token (die Prozess-Umgebung zählt nicht)", async () => {
      vi.stubEnv("PROJECT_TOKEN", "aus-dem-prozess");
      try {
        assert.deepEqual(await lauf("acme/ziel", { GITHUB_ACTIONS: "true", PROJECT_TOKEN: "x" }).then((r) => r?.[1]), "x");
        const gepostet: unknown[][] = [];
        const libs = { REPO: "acme/proj", ZIEL: "acme/ziel", ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [], owner: "acme" }), waehleSammelticket: (o: { number: number }[]) => o[0], postZeilen: (...a: unknown[]) => gepostet.push(a) };
        await melden.main([], { env: { GITHUB_ACTIONS: "true" }, bereite: bereiteStub, ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: () => undefined, err: () => undefined });
        assert.equal(gepostet.length, 1);
        assert.equal(gepostet[0]?.[3], undefined);
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });
  test("fremde Meldestelle (factory#208): bereite bekommt die Herkunft, eigen kommt per api aus gh api user, die Meldung geht ohne Dublette", async () => {
    const aufrufe: unknown[][] = [];
    const herkunft: unknown[] = [];
    const gepostet: unknown[][] = [];
    const zeilenText = zeile(L1);
    const libs = { REPO: "acme/proj", MELDESTELLE: "eingang/privat", ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [{ user: { login: "fremdkonto", type: "User" }, body: zeilenText }], owner: "eingang" }), waehleSammelticket: (o: { number: number }[]) => o[0], postZeilen: (...a: unknown[]) => gepostet.push(a) };
    const api = (a: string[], o: unknown) => (aufrufe.push([a, o]), { login: "fremdkonto" });
    const deps = { env: { GITHUB_ACTIONS: "true", MELDESTELLE_TOKEN: "mt", PROJECT_TOKEN: "pt" }, api, bereite: (z: string[], o?: { herkunft?: string | null }) => (herkunft.push(o), { ok: true, text: z.join("\n") }), ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: () => undefined, err: () => undefined };
    const luecke = { ok: false, punkt: L1.punkt, befund: "anders", fix: "f" };
    assert.equal(await melden.main([], { ...deps, pruefLauf: () => ({ ergebnis: [luecke] }) }), 0);
    assert.deepEqual(aufrufe[0], [["api", "user"], { token: "mt" }]);
    assert.deepEqual(gepostet, [], "die eigene Zeile des fremden Kontos ist bekannt");
    assert.equal(await melden.main([], { ...deps, pruefLauf: () => ({ ergebnis: [{ ...luecke, punkt: "Neu" }] }) }), 0);
    assert.deepEqual(herkunft, [{ herkunft: "acme/proj", eigenes: "acme/proj" }]);
    assert.equal(gepostet.length, 1);
  });
  test("Standard-bereite (ohne Injektion) schreibt die Herkunft in die Meldung: nackte #n werden owner/name#n", async () => {
    const log: string[] = [];
    const libs = { REPO: "acme/proj", MELDESTELLE: "eingang/privat", ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [], owner: "eingang" }), waehleSammelticket: (o: { number: number }[]) => o[0], postZeilen: () => assert.fail("Trockenlauf") };
    const code = await melden.main(["--dry-run"], { env: { GITHUB_ACTIONS: "true", MELDESTELLE_TOKEN: "mt", PROJECT_TOKEN: "pt" }, api: () => ({ login: "fremdkonto" }), ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: (s) => log.push(s), err: () => undefined, pruefLauf: () => ({ ergebnis: [{ ok: false, punkt: "Neu", befund: "Issue #12 fehlt", fix: "f" }] }) });
    assert.equal(code, 0);
    assert.ok(log.some((z) => z.startsWith("[dry-run]") && z.includes("Issue acme/proj#12 fehlt")), log.join(" | "));
  });
  test("fremde Meldestelle ohne ungeclaimtes Sammelticket (waehleSammelticket liefert nichts): ::error:: mit Fix, Exit 1, nichts gepostet", async () => {
    const log: string[] = [];
    const libs = { REPO: "acme/proj", MELDESTELLE: "eingang/privat", ladeSammelKontext: () => ({ offene: [], kommentare: [], owner: "eingang" }), waehleSammelticket: () => undefined, postZeilen: () => assert.fail("kein Ziel") };
    const code = await melden.main([], { env: { GITHUB_ACTIONS: "true", MELDESTELLE_TOKEN: "mt", PROJECT_TOKEN: "pt" }, api: () => ({ login: "x" }), bereite: bereiteStub, ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: (s) => log.push(s), err: () => undefined, pruefLauf: () => ({ ergebnis: [{ ok: false, punkt: "Neu", befund: "b", fix: "f" }] }) });
    assert.equal(code, 1);
    assert.ok(log.some((z) => z.includes("kein ungeclaimtes Harness-Sammelticket für 1 neue Zeile(n)")), log.join(" | "));
  });
  test("gh api user schlägt fehl: Warnzeile, Rückfall auf den Owner (eigene Zeile gilt dann nicht als bekannt)", async () => {
    const log: string[] = [];
    const gepostet: unknown[][] = [];
    const libs = { REPO: "acme/proj", MELDESTELLE: "eingang/privat", ladeSammelKontext: () => ({ offene: [{ number: 55 }], kommentare: [{ user: { login: "fremdkonto", type: "User" }, body: zeile(L1) }], owner: "eingang" }), waehleSammelticket: (o: { number: number }[]) => o[0], postZeilen: (...a: unknown[]) => gepostet.push(a) };
    const api = () => { throw new Error("HTTP 403"); };
    const code = await melden.main([], { env: { GITHUB_ACTIONS: "true", MELDESTELLE_TOKEN: "mt", PROJECT_TOKEN: "pt" }, api, bereite: bereiteStub, ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), log: (s) => log.push(s), err: () => undefined, pruefLauf: () => ({ ergebnis: [{ ok: false, punkt: L1.punkt, befund: "b", fix: "f" }] }) });
    assert.equal(code, 0);
    assert.ok(log.some((z) => z.startsWith("HINWEIS Dedupe: eigenes Konto nicht lesbar (HTTP 403)")), log.join(" | "));
    assert.equal(gepostet.length, 1);
  });
  test("unbekanntes Flag → Exit 2 vor jeder Config", async () => {
    const code = await melden.main(["--quatsch"], { ladeConfig: () => assert.fail("keine Config"), ladeLibs: () => assert.fail("kein Import"), log: () => undefined, err: () => undefined });
    assert.equal(code, 2);
  });
});
