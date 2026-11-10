/* Eingangsfilter für Harness-Zeilen (factory#269) – Klasse, Beleg und Verfall stehen genau einmal (AGENTS.md § Harness-Befunde sind Zeilen).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Regel: Eine Harness-Zeile hat eine Klasse und einen Beleg; Kosmetik und Hypothese ohne Schutzbereich brauchen einen Verfall; Sicherheit, Fremdtext
 * und Datenverlust verfallen nie. Die Erzeuger-Texte verweisen auf die Regel, statt sie zu wiederholen.
 *
 * Bewusste Grenze: geprüft werden nur die geschlossene Liste ERZEUGER (je eine Zeile je Datei), das Zeilenformat an Beispielen und die
 * Ausgabe von `zeileFuer` und `gescheitertZeile`. Die Sicherheits-Inboxen (`Audit:`, `Code-Scanning:`) behalten ihr festes Format und sind
 * ausgenommen; der Beleg wird nur syntaktisch geprüft (Wort oder Zahl), ein inhaltsleerer Beleg wie „keiner“ besteht, und der Verfall muss das letzte Feld der Zeile sein (steht danach noch Text, hängt `mitVerfall` einen neuen an); eine Umformulierung eines Erzeuger-Textes, die die Verweis-Wörter behält, erkennt der Test nicht.
 */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTitel from "../../scripts/sammelticket-titel.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMelden from "../../scripts/melden.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDoctor from "../../scripts/harness-doctor-melden.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawSpez from "../../scripts/spezifikation.mjs";

type Pruefung = { ok: boolean; fehler?: string; klasse?: string; schutz?: string | null; beleg?: string; verfall?: string | null };
const titel = rawTitel as unknown as {
  ZEILEN_KLASSEN: string[]; SCHUTZBEREICHE: string[]; VERFALL_TAGE: number;
  pruefeBefundZeile(z: string, o?: { heute?: string }): Pruefung; mitVerfall(z: string, heute: string): string;
};
const melden = rawMelden as unknown as {
  main(argv: string[], deps: Record<string, unknown>): Promise<number>;
};
const doctor = rawDoctor as unknown as {
  zeileFuer(l: { punkt: string; befund: string; fix: string; nichtPruefbar?: boolean }, heute: string): string;
  lauf(a: { io: Record<string, unknown> }): number;
  plane(a: { luecken: { punkt: string; befund: string; fix: string }[]; kommentare: never[]; owner: string; heute: string }): string[];
};
const spez = rawSpez as unknown as { gescheitertZeile(a: { nr: number; mangel: string; heute: string }): string; gescheitertBekannt(nr: number, k: { user: { login: string; type: string }; body: string }[], owner: string): boolean };

const lies = (rel: string): string => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), "utf8");
const zeileMit = (rel: string, muster: RegExp): string => {
  const z = lies(rel).split("\n").filter((l) => muster.test(l));
  assert.equal(z.length, 1, `${rel}: ${muster} muss genau eine Zeile treffen, gefunden ${z.length}`);
  return z[0];
};

const HEUTE = "2026-11-10";
const gut = (z: string, o: { heute?: string } = {}) => titel.pruefeBefundZeile(z, o);

describe("Zeilenformat: Klasse, Beleg, Verfall (factory#269)", () => {
  test("gültige Zeilen", () => {
    assert.equal(gut("- [ ] Defekt: Gate X lässt Y durch Beleg: test/x.test.ts:12").ok, true);
    assert.equal(gut("- [ ] Blocker: MCP fällt aus Beleg: Fehlerausgabe `spawn ENOENT`").ok, true);
    assert.equal(gut("- [ ] Kosmetik: Tippfehler Beleg: docs/a.md:3 Verfall: 2026-12-08").ok, true);
    assert.equal(gut("- [ ] Hypothese: Umgehung denkbar Beleg: docs/a.md:3 Verfall: 2026-12-08 (aus #12)").ok, true);
    const s = gut("- [ ] Hypothese (Sicherheit): Token könnte leaken");
    assert.deepEqual([s.ok, s.klasse, s.schutz], [true, "Hypothese", "Sicherheit"]);
  });
  test("ohne Klasse, unbekannte Klasse, falsche Schreibweise", () => {
    for (const z of ["- [ ] Gate kaputt Beleg: x1", "- [ ] Idee: etwas Beleg: x1", "- [ ] defekt: etwas Beleg: x1", "- [ ] Defekt:etwas Beleg: x1"]) assert.equal(gut(z).ok, false, z);
    assert.match(gut("- [ ] Idee: etwas Beleg: x1").fehler ?? "", /unbekannte Klasse/);
    assert.match(gut("- [ ] Gate kaputt Beleg: x1").fehler ?? "", /keine Klasse/);
    assert.match(gut("- [ ] Idee: ohne Beleg").fehler ?? "", /unbekannte Klasse/);
    assert.match(gut("- [ ] Hypothese (Foo): x Verfall: 2026-12-08").fehler ?? "", /unbekannter Schutzbereich/);
  });
  test("ohne Beleg oder nur Satzzeichen als Beleg", () => {
    assert.match(gut("- [ ] Defekt: etwas ohne Nachweis").fehler ?? "", /kein Beleg/);
    assert.equal(gut("- [ ] Defekt: etwas Beleg: ...").ok, false);
    assert.equal(gut("- [ ] Hypothese (Datenverlust): ohne Beleg").ok, true);
    assert.match(gut("- [ ] Hypothese: x Verfall: 2026-12-08").fehler ?? "", /kein Beleg/);
    assert.match(gut("- [ ] Kosmetik: x Beleg: Verfall: 2026-12-08").fehler ?? "", /kein Beleg/);
    assert.equal(gut("- [ ] Defekt: x Beleg: 42").ok, true);
    assert.equal(gut("- [ ] Defekt: x Beleg: y1 Verfall:").beleg, "y1 Verfall:", "ein Verfall ohne Wert ist kein Feld");
    assert.equal(gut("- [ ] Defekt: x Beleg: mitVerfall: 2026-12-08").ok, true, "nur ein eigenes Wort Verfall: ist das Feld");
    assert.equal(gut("- [ ] Defekt: mitVerfall setzt Verfall: doppelt Beleg: test/a.ts:3").ok, true, "Verfall: im Befund-Text ist kein Verfallsfeld");
    assert.equal(gut("- [ ] Kosmetik: Feld Verfall: fehlt im Glossar Beleg: docs/a.md:3 Verfall: 2026-12-08").ok, true);
    assert.equal(titel.mitVerfall("- [ ] Kosmetik: Feld Verfall: fehlt Beleg: docs/a.md:3", "2026-11-20"), "- [ ] Kosmetik: Feld Verfall: fehlt Beleg: docs/a.md:3 Verfall: 2026-12-18");
    assert.equal(gut("- [ ] Defekt: x Beleg: (aus #1) (aus #2)").ok, false);
    assert.equal(gut("- [ ] Defekt (Sicherheit): ohne Beleg").ok, false);
  });
  test("Verfall: Pflicht bei Kosmetik und Hypothese, sonst verboten, gültiges Datum, nicht verfallen", () => {
    assert.match(gut("- [ ] Kosmetik: x Beleg: y1").fehler ?? "", /braucht `Verfall/);
    assert.match(gut("- [ ] Defekt: x Beleg: y1 Verfall: 2026-12-08").fehler ?? "", /Verfall nur bei/);
    assert.match(gut("- [ ] Hypothese (Sicherheit): x Verfall: 2026-12-08").fehler ?? "", /Verfall nur bei/);
    for (const d of ["2026-13-01", "2026-02-30", "26-1-1", "morgen"]) assert.match(gut(`- [ ] Kosmetik: x Beleg: y1 Verfall: ${d}`).fehler ?? "", /kein gültiges Datum/, d);
    assert.match(gut("- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-11-09", { heute: HEUTE }).fehler ?? "", /verfallen/);
    assert.equal(gut("- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-11-10", { heute: HEUTE }).ok, true);
  });
  test("keine offene Checkbox-Zeile", () => {
    for (const z of ["- [x] Defekt: x Beleg: y1", "Defekt: x Beleg: y1", ""]) assert.equal(gut(z).ok, false, z);
  });
  test("mitVerfall: Monatsgrenze, Defekt, vorhandenes Datum und Schutzbereich bleiben", () => {
    assert.equal(titel.VERFALL_TAGE, 28);
    assert.equal(titel.mitVerfall("- [ ] Kosmetik: x Beleg: y1", "2026-11-20"), "- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-12-18");
    const bleibt = ["- [ ] Defekt: x Beleg: y1", "- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-12-01", "- [ ] Hypothese (Sicherheit): x", "kein Listenpunkt"];
    for (const z of bleibt) assert.equal(titel.mitVerfall(z, "2026-11-20"), z);
    const uebertrag = ["- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-12-08 (aus #12) (aus #20)", "- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-12-08"];
    uebertrag.push("- [ ] Kosmetik: x Beleg: y1 Verfall:2026-12-08", "- [ ] Kosmetik: x Beleg: y1 Verfall:2026-12-08 (aus #12)");
    for (const z of uebertrag) assert.equal(titel.mitVerfall(z, "2026-11-20"), z, "Übertrag verlängert den Verfall nie");
  });
});

describe("Regel-SSOT in AGENTS.md und ticket-reihenfolge.md", () => {
  const befunde = zeileMit("AGENTS.md", /^- \*\*Harness-Befunde sind Zeilen/);
  test("AGENTS.md nennt Klassen, Schutzbereiche, Beleg und die Verfallsfrist in Wochen", () => {
    for (const w of [...titel.ZEILEN_KLASSEN, ...titel.SCHUTZBEREICHE]) assert.ok(befunde.includes(`\`${w}\``), `AGENTS.md ohne ${w}`);
    assert.ok(befunde.includes("Beleg"));
    assert.ok(befunde.includes(`${titel.VERFALL_TAGE / 7} Wochen`));
  });
  test("„Kein Parken“ nennt den Verfall", () => {
    assert.match(zeileMit("AGENTS.md", /^- \*\*Kein Parken/), /Verfall .* kein Parken/);
  });
  test("das Format-Beispiel der Mechanik besteht die Prüfung", () => {
    const bsp = /Beispiel: `(- \[ \] [^`]+)`/.exec(lies("docs/ticket-reihenfolge.md"));
    assert.ok(bsp, "Beispiel fehlt in docs/ticket-reihenfolge.md");
    assert.equal(gut(bsp[1]).ok, true);
  });
});

describe("Erzeuger verweisen auf die Regel (geschlossene Liste)", () => {
  const ERZEUGER: { datei: string; zeile: RegExp }[] = [
    { datei: ".claude/agents/factory-planer.md", zeile: /^8\. \*\*Befunde\*\*/ },
    { datei: ".claude/agents/factory-umsetzer.md", zeile: /^\*\*Sammeltickets \(Titel/ },
    { datei: ".claude/agents/factory-umsetzer.md", zeile: /^Befunde außerhalb des Tickets/ },
    { datei: ".agents/skills/review-lenses/SKILL.md", zeile: /^Am Ende \*\*ein Gesamt-Verdikt/ },
    { datei: ".agents/skills/factory/ablauf.md", zeile: /^Fehlerwege: Fehlt ein Bericht/ },
    { datei: "docs/model-routing.md", zeile: /^\*\*Eingangsfilter \(factory#269\)/ },
    { datei: "docs/ticket-reihenfolge.md", zeile: /^Der Workflow \[`harness-doctor\.yml`\]/ },
  ];
  for (const { datei, zeile } of ERZEUGER) {
    test(`${datei}: ${zeile.source.slice(0, 30)}`, () => {
      const z = zeileMit(datei, zeile);
      assert.ok(z.includes("Klasse und Beleg"), "ohne „Klasse und Beleg“");
      assert.ok(z.includes("§ Harness-Befunde sind Zeilen"), "ohne Verweis „§ Harness-Befunde sind Zeilen“");
      assert.ok(!titel.ZEILEN_KLASSEN.every((k) => z.includes(k)), "zählt alle vier Klassen auf (Regel nur einmal)");
    });
  }
  test("der Planer: Hypothese nur geprüft, eigene Planzeile VERFALLEN", () => {
    const z = zeileMit(".claude/agents/factory-planer.md", /^\*\*Sammeltickets \(Titel/);
    assert.ok(z.includes("Hypothese nur geprüft"));
    assert.ok(z.includes("`VERFALLEN:"));
  });
});

describe("Erzeuger-Ausgaben bestehen die Prüfung", () => {
  const l = { punkt: "Secret A", befund: "Ausgabe: leer", fix: "setzen" };
  test("Doctor: LÜCKE und NICHT PRÜFBAR", () => {
    assert.equal(gut(doctor.zeileFuer(l, HEUTE)).ok, true);
    assert.equal(gut(doctor.zeileFuer({ ...l, nichtPruefbar: true }, HEUTE)).ok, true);
  });
  test("Doctor-Lauf: ein Punkt ohne Beleg steht nur als Warnung im Log, nichts wird gepostet", () => {
    const log: string[] = [];
    const posts: unknown[] = [];
    const io = { ermittle: () => [{ ...l, befund: "" }], kontext: () => ({ kommentare: [], owner: "o", ziel: 1 }), bereite: (z: string[]) => ({ ok: true, text: z.join("\n") }), postZeilen: (...a: unknown[]) => posts.push(a), heute: HEUTE, log: (x: string) => log.push(x) };
    doctor.lauf({ io });
    assert.ok(log.some((x) => /::warning::.*Secret A ohne Beleg, nur im Bericht/.test(x)), log.join("\n"));
    assert.deepEqual(posts, []);
  });
  test("Doctor: ein leerer Befund wird keine Zeile", () => {
    assert.deepEqual(doctor.plane({ luecken: [{ ...l, befund: "" }], kommentare: [], owner: "o", heute: HEUTE }), []);
    assert.equal(doctor.plane({ luecken: [l], kommentare: [], owner: "o", heute: HEUTE }).length, 1);
  });
  test("eine Altzeile der gescheiterten Reparatur ohne Klasse gilt weiter als bekannt", () => {
    const alt = "- [ ] 2026-10-22 Reparatur gescheitert: #7 (Negativfall fehlt). Fix: Body nachziehen";
    assert.equal(spez.gescheitertBekannt(7, [{ user: { login: "o", type: "User" }, body: alt }], "o"), true);
  });
  test("gescheiterte Reparatur: Beleg ist der Mangel, ohne Mangel keine gültige Zeile", () => {
    assert.equal(gut(spez.gescheitertZeile({ nr: 7, mangel: "Negativfall fehlt", heute: HEUTE })).ok, true);
    assert.equal(gut(spez.gescheitertZeile({ nr: 7, mangel: "", heute: HEUTE })).ok, false);
  });
});

describe("melden.mjs lehnt ab und ergänzt den Verfall", () => {
  const lauf = async (zeile: string, heute = HEUTE) => {
    const err: string[] = [];
    const geseh: string[][] = [];
    const libs = { MELDESTELLE: "a/b", REPO: "a/b", ladeSammelKontext: () => ({ offene: [] }), waehleSammelticket: () => ({ number: 1 }), postZeilen: () => undefined };
    const code = await melden.main(["--zeile", zeile, "--dry-run"], {
      ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), env: {}, log: () => undefined, err: (s: string) => err.push(s), heute: () => heute,
      bereite: (z: string[]) => (geseh.push(z), { ok: true, text: z.join("\n") }),
    });
    return { code, err: err.join("\n"), geseh };
  };
  test("ohne Klasse und Beleg: Exit 2, nichts bereitet", async () => {
    const r = await lauf("Gate kaputt");
    assert.equal(r.code, 2);
    assert.deepEqual(r.geseh, []);
    assert.match(r.err, /Format:.*Beispiel:/s);
  });
  test("Kosmetik ohne Verfall bekommt heute plus 28 Tage", async () => {
    const r = await lauf("Kosmetik: x Beleg: y1");
    assert.equal(r.code, 0);
    assert.deepEqual(r.geseh, [["- [ ] Kosmetik: x Beleg: y1 Verfall: 2026-12-08"]]);
  });
  test("leerer Beleg bei Kosmetik: Exit 2 (der ergänzte Verfall ist kein Beleg)", async () => {
    const r = await lauf("Kosmetik: Tippfehler Beleg:");
    assert.equal(r.code, 2);
    assert.deepEqual(r.geseh, []);
  });
  test("mehrere Zeilen: ist eine schlecht, Exit 2 und nichts bereitet", async () => {
    const err: string[] = [];
    const geseh: string[][] = [];
    const libs = { MELDESTELLE: "a/b", REPO: "a/b", ladeSammelKontext: () => ({ offene: [] }), waehleSammelticket: () => ({ number: 1 }), postZeilen: () => undefined };
    const code = await melden.main(["--zeile", "Defekt: a Beleg: b1", "--zeile", "Gate kaputt", "--dry-run"], { ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), env: {}, log: () => undefined, err: (s: string) => err.push(s), heute: () => HEUTE, bereite: (z: string[]) => (geseh.push(z), { ok: true, text: "t" }) });
    assert.equal(code, 2);
    assert.deepEqual(geseh, []);
  });
  test("Standard-heute (ohne Einspritzung): der ergänzte Verfall ist ein ISO-Datum", async () => {
    const geseh: string[][] = [];
    const libs = { MELDESTELLE: "a/b", REPO: "a/b", ladeSammelKontext: () => ({ offene: [] }), waehleSammelticket: () => ({ number: 1 }), postZeilen: () => undefined };
    const code = await melden.main(["--zeile", "Kosmetik: x Beleg: y1", "--dry-run"], { ladeConfig: () => ({}), ladeLibs: () => Promise.resolve(libs), env: {}, log: () => undefined, err: () => undefined, bereite: (z: string[]) => (geseh.push(z), { ok: true, text: "t" }) });
    assert.equal(code, 0);
    assert.match(geseh[0][0], /Verfall: \d{4}-\d{2}-\d{2}$/);
  });
  test("verfallene Zeile: Exit 2", async () => {
    assert.equal((await lauf("Kosmetik: x Beleg: y1 Verfall: 2026-11-01")).code, 2);
  });
});
