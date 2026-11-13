/* Bedingte Dateien der Kerne (factory#309, factory#310, L32 aus factory#393): ein Prüfer mit Katalog je Kern. Ein Kern (`SKILL.md` des Review-Skills, `.claude/agents/factory-umsetzer.md`)
 * enthält nur den Ablauf; Sonderfälle stehen in Dateien daneben und werden nur bei Eintritt ihrer Bedingung gelesen. Dazu die Plattform-Weiche des Umsetzers.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft wird (`bedingteDateienBefunde(kern, eingabe)`, geschlossener Katalog `KATALOG`, genau zwei Kerne): (a) der Kern nennt jede bedingte Datei mit vollem Pfad, die Zeile enthält die Bedingungs-Tokens
 * (je Kern, leer = nur der Pfad); (b) die Datei existiert, steht in `AGENTEN_SKILL_BUDGETS` und im Besitz-Manifest, ihr Kopf nennt den Kern; (c) jede Datei im Ordner nach dem Namensmuster des Kerns
 * steht im Katalog (Waise rot), ein Verweis ohne Datei ist rot; (d) nur mit `codexQuelle`: Codex-Rolle und gemeinsames Skill-Verzeichnis. Plattform-Weiche (eigener Block): Windows-Sonderfälle (`WINDOWS_TOKENS`)
 * stehen nicht im Kern-Rumpf (ohne Frontmatter und Projektwerte-Block), die weiteren Leser (`WEICHE_LESER`) ebenso.
 * Grenze: geprüft wird die Verdrahtung, nicht das Lesen im Lauf; die Windows-Tokens sind eine geschlossene Liste. Verfall: Prüftermin laut `.github/wiedervorlagen.json` (Eintrag `regeln-verfall-2027-03`, ADR 0027). Begriffe: `docs/harness-glossar.md` › Plattform-Weiche, Bedingte Datei (Skill). */
import { describe, test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// @ts-expect-error: kein .d.ts für das .mjs-Skript.
import * as budgetRaw from "../../scripts/kontext-budget-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Skript.
import * as codexRollenRaw from "../../scripts/codex-rollen.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Skript.
import * as skillPfadeRaw from "../../scripts/skill-pfade.mjs";
import { escapeRe } from "../support/regex";

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const { AGENTEN_SKILL_BUDGETS } = budgetRaw as { AGENTEN_SKILL_BUDGETS: { file: string; budget: number }[] };
const { rollenFuer } = codexRollenRaw as { rollenFuer: (config: unknown) => { name: string; quelle: string }[] };
const { QUELL_VERZEICHNIS } = skillPfadeRaw as { QUELL_VERZEICHNIS: string };

interface Kern {
  kern: string;
  ordner: string;
  muster: RegExp;
  codexQuelle: string | null;
  harmlos: string[];
  dateien: { datei: string; tokens: string[] }[];
}
/** Geschlossener Katalog: je Kern Ordner, Namensmuster, Codex-Quelle (oder null) und die bedingten Dateien samt Tokens, die die Bedingungszeile im Kern nennen muss. */
const KATALOG: Kern[] = [
  {
    kern: ".agents/skills/review-lenses/SKILL.md",
    ordner: ".agents/skills/review-lenses",
    muster: /^ablauf-.+\.md$/,
    codexQuelle: null,
    harmlos: ["alt-ablauf-x.md", "ablauf-x.md.orig", "brille-x.md"],
    dateien: ["abnahme-fix", "klasse-hoch", "merge-main", "nachweis", "zusatzpass"].map((n) => ({ datei: `ablauf-${n}.md`, tokens: [] })),
  },
  {
    kern: ".claude/agents/factory-umsetzer.md",
    ordner: ".agents/skills/factory",
    muster: /^(umsetzer|plattform)-.*\.md$/,
    codexQuelle: "factory-umsetzer",
    harmlos: ["ablauf-fremd.md", "alt-umsetzer-x.md", "umsetzer-x.md.orig", "SKILL.md"],
    dateien: [
      { datei: "plattform-windows.md", tokens: ["process.platform", "win32"] },
      { datei: "umsetzer-gruppen.md", tokens: ["GRUPPEN"] },
      { datei: "umsetzer-guard-proben.md", tokens: ["Guard", "anker-liste"] },
      { datei: "umsetzer-browser.md", tokens: ["Browser", "Langfuse-Status"] },
      { datei: "umsetzer-pr-merge.md", tokens: ["pr-warten", "Exit 1"] },
      { datei: "umsetzer-fortsetzung.md", tokens: ["bestanden", "fix", "handoff"] },
    ],
  },
];
const UMSETZER = KATALOG[1];
const { ordner: ORDNER, kern: KERN } = UMSETZER;

/** Windows-Sonderfälle: sie gehören hinter die Plattform-Weiche (`plattform-windows.md`), nicht in den Kern-Rumpf. */
const WINDOWS_TOKENS = ["taskkill", "$LASTEXITCODE", "PowerShell", "CRLF", "MSYS_NO_PATHCONV", "Git-Bash", "execSync", "Test-Path"];
/** Weitere Leser der Plattform-Weiche (factory#400 L23, geschlossene Liste, nur diese fünf Dateien): Windows-Sonderfälle stehen nur in `plattform-windows.md`.
 *  `weiche`: die Datei nennt die Weiche in einem Satz (`win32` und der Pfad); ohne: der Leser hat sie schon (Umsetzer bzw. Lens). */
const WEICHE_LESER: { datei: string; weiche: boolean }[] = [
  { datei: ".claude/agents/factory-lens.md", weiche: true },
  { datei: ".agents/skills/factory/ablauf.md", weiche: true },
  { datei: ".agents/skills/review-lenses/ablauf-merge-main.md", weiche: false },
  { datei: ".agents/skills/review-lenses/brille-test-adaequanz.md", weiche: false },
];
/** Der Satz der Weiche (Bedingung und Ort im Kern). */
const WEICHE = /Ergibt `node -p process\.platform` den Wert `win32`[^\n]*liest du vor Schritt 1 `\.agents\/skills\/factory\/plattform-windows\.md`/;

interface Eingabe {
  kern: string;
  lies: (pfad: string) => string | null;
  budgets: { file: string; budget: number }[];
  besitz: string[];
  ordnerDateien: string[];
  rollen: { name: string; quelle: string }[];
  quellVerzeichnis: string;
}

/** Text ohne Frontmatter und Projektwerte-Block (erwartet LF; der Aufrufer normalisiert CRLF). */
function rumpf(kern: string): string {
  const t = kern.replace(/^---\n[\s\S]*?\n---\n/, "");
  const a = t.indexOf("<!-- factory:projektwerte:start -->");
  const endMarke = "<!-- factory:projektwerte:end -->";
  const b = t.indexOf(endMarke);
  return a >= 0 && b > a ? t.slice(0, a) + t.slice(b + endMarke.length) : t;
}

/** Die im Kern mit vollem Pfad genannten Dateien des Ordners, die auf das Muster des Kerns passen (sortiert, ohne Dubletten). */
function genannt(k: Kern, kern: string): string[] {
  const roh = [...kern.matchAll(new RegExp(`${escapeRe(k.ordner)}/([a-z0-9-]+\\.md)`, "g"))].map((m) => m[1]);
  return [...new Set(roh.filter((d) => k.muster.test(d)))].sort();
}

/** Befunde zur Verdrahtung der bedingten Dateien eines Kerns (leer = in Ordnung). */
export function bedingteDateienBefunde(k: Kern, e: Eingabe): string[] {
  const out: string[] = [];
  const kern = e.kern.replace(/\r\n/g, "\n");
  for (const { datei, tokens } of k.dateien) {
    const pfad = `${k.ordner}/${datei}`;
    const zeilen = kern.split("\n").filter((z) => z.includes(pfad));
    if (zeilen.length === 0) out.push(`${datei}: der Kern nennt den Pfad ${pfad} nicht`);
    else {
      const fehlend = tokens.filter((t) => !zeilen.some((z) => z.includes(t)));
      if (fehlend.length > 0) out.push(`${datei}: die Zeile mit dem Pfad nennt die Bedingung nicht (fehlt: ${fehlend.join(", ")})`);
    }
    const text = e.lies(pfad);
    if (text === null) out.push(`${datei}: die Datei fehlt`);
    else if (!text.slice(0, 600).includes(k.kern)) out.push(`${datei}: der Kopf nennt den Kern ${k.kern} nicht`);
    if (!e.budgets.some((b) => b.file === pfad)) out.push(`${datei}: kein Eintrag in AGENTEN_SKILL_BUDGETS`);
    if (!e.besitz.includes(pfad)) out.push(`${datei}: kein Eintrag im Besitz-Manifest`);
    if (k.codexQuelle !== null) {
      if (!e.rollen.some((r) => r.quelle === k.codexQuelle)) out.push(`${datei}: keine Codex-Rolle mit Quelle ${k.codexQuelle}`);
      if (!pfad.startsWith(`${e.quellVerzeichnis}/`)) out.push(`${datei}: liegt nicht im gemeinsamen Skill-Verzeichnis ${e.quellVerzeichnis}`);
    }
  }
  const erwartet = new Set(k.dateien.map((b) => b.datei));
  for (const d of e.ordnerDateien) if (k.muster.test(d) && !erwartet.has(d)) out.push(`${d}: Waise, steht nicht im Katalog (Kern, Budget und Manifest mitziehen)`);
  for (const g of genannt(k, kern)) if (!e.ordnerDateien.includes(g)) out.push(`Verweis ohne Datei: ${g}`);
  return out;
}

/** Befunde zur Plattform-Weiche im Kern des Umsetzers (leer = in Ordnung). */
export function plattformWeicheBefunde(kernText: string): string[] {
  const out: string[] = [];
  const kern = kernText.replace(/\r\n/g, "\n");
  if (!WEICHE.test(kern)) out.push("Plattform-Weiche: der Kern nennt Bedingung (`node -p process.platform` = `win32`) und Ort (`plattform-windows.md`) nicht in einem Satz");
  const body = rumpf(kern);
  for (const t of WINDOWS_TOKENS) if (body.includes(t)) out.push(`Windows-Sonderfall „${t}“ steht im Kern-Rumpf statt hinter der Plattform-Weiche`);
  return out;
}

/** Befunde zu den weiteren Weiche-Lesern (leer = in Ordnung). */
export function weicheLeserBefunde(lies: (pfad: string) => string | null): string[] {
  const out: string[] = [];
  for (const { datei, weiche } of WEICHE_LESER) {
    const text = lies(datei);
    if (text === null) {
      out.push(`${datei}: die Datei fehlt`);
      continue;
    }
    const body = rumpf(text.replace(/\r\n/g, "\n"));
    for (const w of WINDOWS_TOKENS) if (body.includes(w)) out.push(`${datei}: Windows-Sonderfall „${w}“ steht ohne Plattform-Weiche im Text`);
    if (weiche && !body.split("\n").some((z) => z.includes("win32") && z.includes(`${ORDNER}/plattform-windows.md`))) out.push(`${datei}: nennt die Plattform-Weiche (win32, plattform-windows.md) nicht`);
  }
  return out;
}

const lesen = (pfad: string): string | null => (existsSync(WURZEL + pfad) ? readFileSync(WURZEL + pfad, "utf8") : null);
const echt = (k: Kern): Eingabe => ({
  kern: readFileSync(WURZEL + k.kern, "utf8"),
  lies: lesen,
  budgets: AGENTEN_SKILL_BUDGETS,
  besitz: (JSON.parse(readFileSync(WURZEL + ".factory/besitz.json", "utf8")) as { eintraege: { pfad: string }[] }).eintraege.map((x) => x.pfad),
  ordnerDateien: readdirSync(WURZEL + k.ordner),
  rollen: rollenFuer({ agenten: { planer: "p-x", umsetzer: "u-x", lens: "l-x", gruppe: "g-x" } }),
  quellVerzeichnis: QUELL_VERZEICHNIS,
});
const befund = (k: Kern, e: Eingabe): string => bedingteDateienBefunde(k, e).join("\n");
describe("Bedingte Dateien je Kern (ein Prüfer, Katalog mit genau zwei Kernen)", () => {
  test("der Katalog nennt genau die beiden Kerne (die Schleifen unten sind nicht leer)", () =>
    assert.deepEqual(KATALOG.map((k) => k.kern), [".agents/skills/review-lenses/SKILL.md", ".claude/agents/factory-umsetzer.md"]));

  for (const k of KATALOG) {
    describe(k.kern, () => {
      test("echter Stand: Pfade, Bedingungen, Köpfe, Budgets, Manifest, Waisen und Verweise sind in Ordnung (auch mit CRLF); der Ordner enthält genau die Katalogdateien", () => {
        const e = echt(k);
        assert.deepEqual(bedingteDateienBefunde(k, e), []);
        assert.deepEqual(bedingteDateienBefunde(k, { ...e, kern: e.kern.replace(/\n/g, "\r\n") }), [], "CRLF-Checkout");
      });

      test("Negativfall (L32): ein entfernter Verweis macht jede einzelne bedingte Datei rot (der Kern nennt den Pfad nicht)", () => {
        const e = echt(k);
        for (const { datei } of k.dateien) {
          const kern = e.kern.split(`${k.ordner}/${datei}`).join("weg");
          assert.notEqual(kern, e.kern, `${datei}: der Pfad steht im Kern`);
          assert.match(befund(k, { ...e, kern }), new RegExp(`${escapeRe(datei)}: der Kern nennt den Pfad`), datei);
        }
      });

      test("Negativfall Waise: eine Datei nach Muster im Ordner ohne Katalogeintrag ist rot, eine andere Datei, ein Namensanfang mitten im Namen und eine Endung dahinter nicht", () => {
        const e = echt(k);
        for (const neu of k === UMSETZER ? ["umsetzer-neu.md", "plattform-neu.md"] : ["ablauf-neu.md"])
          assert.match(befund(k, { ...e, ordnerDateien: [...e.ordnerDateien, neu] }), new RegExp(`${escapeRe(neu)}: Waise`), "jede Alternative des Musters");
        assert.deepEqual(bedingteDateienBefunde(k, { ...e, ordnerDateien: [...e.ordnerDateien, ...k.harmlos] }), []);
      });

      test("Negativfall: ein Verweis auf eine Datei, die es nicht gibt, ein fehlender Budget- oder Manifest-Eintrag sind rot", () => {
        const e = echt(k);
        const { datei } = k.dateien[0];
        const pfad = `${k.ordner}/${datei}`;
        const weg = `${datei.split("-")[0]}-weg.md`;
        assert.match(befund(k, { ...e, kern: `${e.kern}\n${k.ordner}/${weg}\n` }), new RegExp(`Verweis ohne Datei: ${escapeRe(weg)}`));
        assert.doesNotMatch(befund(k, { ...e, kern: `${e.kern}\n${k.ordner}/ticket-weg.md\n` }), /Verweis ohne Datei/, "ein Name außerhalb des Musters ist kein Verweis des Kerns");
        assert.match(befund(k, { ...e, budgets: e.budgets.filter((b) => b.file !== pfad) }), new RegExp(`${escapeRe(datei)}: kein Eintrag in AGENTEN_SKILL_BUDGETS`));
        assert.match(befund(k, { ...e, besitz: e.besitz.filter((p) => p !== pfad) }), new RegExp(`${escapeRe(datei)}: kein Eintrag im Besitz-Manifest`));
      });

      test("Negativfall Datei und Kopf: eine fehlende Datei und ein Kopf ohne Kern-Pfad sind rot; das Kopf-Fenster endet bei Zeichen 600", () => {
        const e = echt(k);
        const [a, b] = k.dateien.map((d) => `${k.ordner}/${d.datei}`);
        const lies = (p: string): string | null => (p === a ? null : p === b ? "# Titel\n\nohne Verweis" : e.lies(p));
        const text = befund(k, { ...e, lies });
        assert.match(text, /: die Datei fehlt/);
        assert.match(text, /: der Kopf nennt den Kern/);
        const mit = (vorlauf: number) => (p: string): string | null => (p === b ? `${"x".repeat(vorlauf)} ${k.kern}` : e.lies(p));
        assert.match(befund(k, { ...e, lies: mit(700) }), /: der Kopf nennt den Kern/);
        assert.doesNotMatch(befund(k, { ...e, lies: mit(500) }), /: der Kopf nennt den Kern/);
      });

    });
  }

  test("Negativfall Bedingung und Codex: der Pfad ohne sein Token ist rot (nur der Umsetzer-Kern hat Tokens und Codex-Quelle)", () => {
    const e = echt(UMSETZER);
    const ohneToken = e.kern.split("\n").map((z) => (z.includes(`${ORDNER}/umsetzer-gruppen.md`) ? z.split("GRUPPEN").join("X") : z)).join("\n");
    assert.match(befund(UMSETZER, { ...e, kern: ohneToken }), /umsetzer-gruppen\.md: die Zeile mit dem Pfad nennt die Bedingung nicht \(fehlt: GRUPPEN\)/);
    assert.deepEqual(KATALOG[0].dateien.flatMap((d) => d.tokens), [], "Review-Skill: mehr Pflicht wäre Härten ohne Evidenz");
    assert.match(befund(UMSETZER, { ...e, rollen: e.rollen.map((r) => (r.quelle === "factory-umsetzer" ? { ...r, quelle: "anderer-umsetzer" } : r)) }), /keine Codex-Rolle mit Quelle factory-umsetzer/);
    assert.match(befund(UMSETZER, { ...e, quellVerzeichnis: ".andere/skills" }), /liegt nicht im gemeinsamen Skill-Verzeichnis/);
    assert.deepEqual(bedingteDateienBefunde(KATALOG[0], { ...echt(KATALOG[0]), rollen: [], quellVerzeichnis: ".andere/skills" }), []);
  });
});

describe("Plattform-Weiche des Umsetzers (factory#310)", () => {
  const kernText = readFileSync(WURZEL + KERN, "utf8");
  const weiche = (kern: string): string => plattformWeicheBefunde(kern).join("\n");
  test("echter Stand: der Satz der Weiche steht, der Kern-Rumpf trägt keinen Windows-Sonderfall", () => {
    assert.deepEqual(plattformWeicheBefunde(kernText), []);
  });

  test("Negativfall Weiche: jede Komponente des Satzes zählt (Eigenschaft, Wert, Zeitpunkt, Ort), auch ein Zeilenumbruch dazwischen", () => {
    for (const [von, nach] of [
      ["process.platform", "os.platform"],
      ["`win32`", "`other`"],
      ["liest du vor Schritt 1", "liest du nach Schritt 1"],
      ["liest du vor Schritt 1", "\nliest du vor Schritt 1"],
      ["factory/plattform-windows.md`.", "factory/plattform-linux.md`."],
    ]) {
      const kern = kernText.split(von).join(nach);
      assert.notEqual(kern, kernText, `Muster „${von}“ muss treffen`);
      assert.match(weiche(kern), /Plattform-Weiche: der Kern nennt Bedingung/, von);
    }
  });

  test("Negativfall Weiche: ein Windows-Sonderfall im Kern-Rumpf (taskkill) ist rot, im Frontmatter oder Projektwerte-Block nicht", () => {
    assert.match(weiche(`${kernText}\nBeende per taskkill /PID <pid>.\n`), /Windows-Sonderfall „taskkill“ steht im Kern-Rumpf/);
    const imBlock = kernText.replace("<!-- factory:projektwerte:start -->", "<!-- factory:projektwerte:start -->\ntaskkill PowerShell CRLF");
    assert.deepEqual(plattformWeicheBefunde(imBlock), []);
  });

  test("Frontmatter-Strip: sparsam (eine Trennlinie im Rumpf versteckt kein Token) und ein Token im Frontmatter zählt nicht", () => {
    assert.match(weiche(`${kernText}\ntaskkill\n\n---\n\nRest\n`), /Windows-Sonderfall „taskkill“/);
    assert.deepEqual(plattformWeicheBefunde(kernText.replace(/^---\n/, "---\ntaskkill: x\n")), []);
    const ohneFm = kernText.replace(/^---\n[\s\S]*?\n---\n/, "");
    assert.match(weiche(`${ohneFm}\n---\ntaskkill\n---\n`), /Windows-Sonderfall „taskkill“/, "ohne Frontmatter: kein Strip über Rumpf-Trennlinien (Anker ^)");
    assert.deepEqual(plattformWeicheBefunde(kernText.replace(/^---\n/, "---\nx: a---\ntaskkill: y\n")), [], "ein Wert, der auf --- endet, beendet das Frontmatter nicht");
    assert.match(weiche(`---x\ntaskkill\n---\n${ohneFm}`), /Windows-Sonderfall „taskkill“/, "ein Kopf `---x` ist kein Frontmatter");
    assert.deepEqual(plattformWeicheBefunde(kernText.replace(/^---\n/, "---\nx: a\n---x\ntaskkill: y\n")), [], "eine Zeile ---x beendet das Frontmatter nicht");
    assert.ok(kernText.includes("**vor** dem Nachweis-Commit `git fetch origin` und `origin/main` einmergen"), "Abnahme-Absatz: fetch vor dem Merge");
  });

  test("jedes Windows-Token im Kern-Rumpf ist rot; ohne Projektwerte-Block zählt der ganze Text; CRLF-Checkout ist in Ordnung", () => {
    const ohneBlock = kernText.split("<!-- factory:projektwerte:start -->").join("").split("<!-- factory:projektwerte:end -->").join("");
    assert.deepEqual(plattformWeicheBefunde(ohneBlock), []);
    assert.deepEqual(plattformWeicheBefunde(kernText.replace(/\n/g, "\r\n")), []);
    for (const t of ["taskkill", "$LASTEXITCODE", "PowerShell", "CRLF", "MSYS_NO_PATHCONV", "Git-Bash", "execSync"]) assert.ok(weiche(`${ohneBlock}\n${t}\n`).includes(`Windows-Sonderfall „${t}“`), t);
  });

  test("Windows-Sonderfälle stehen in der Plattform-Datei (die Weiche verschiebt sie, sie entfallen nicht)", () => {
    const windows = readFileSync(WURZEL + `${ORDNER}/plattform-windows.md`, "utf8");
    for (const t of ["taskkill", "$LASTEXITCODE", "CRLF", "execSync", "Test-Path", "Backslash-Ausdruck"]) assert.ok(windows.includes(t), `plattform-windows.md ohne „${t}“`);
  });

  test("L23: die weiteren Leser tragen keine Windows-Sonderfälle, Lens und Hauptchat-Ablauf nennen die Weiche (echter Stand)", () => {
    assert.deepEqual(weicheLeserBefunde(lesen), []);
  });

  test("L23 Negativfall: taskkill im Lens-Text und eine Lens ohne Weiche-Satz sind rot", () => {
    const lens = ".claude/agents/factory-lens.md";
    const echtLens = readFileSync(WURZEL + lens, "utf8");
    const mitTaskkill = (p: string): string | null => (p === lens ? echtLens + "\ntaskkill /PID 1\n" : lesen(p));
    assert.match(weicheLeserBefunde(mitTaskkill).join("\n"), /factory-lens\.md: Windows-Sonderfall „taskkill“/);
    const ohneWeiche = (p: string): string | null => (p === lens ? echtLens.split("plattform-windows.md").join("x.md") : lesen(p));
    assert.match(weicheLeserBefunde(ohneWeiche).join("\n"), /factory-lens\.md: nennt die Plattform-Weiche/);
  });

  test("L33: Fix- und Ersetzungs-Skript-Regel steht plattformneutral im Umsetzer-Kern, nicht mehr nur hinter der Windows-Weiche", () => {
    const kern = rumpf(kernText);
    assert.match(kern, /Fix-Skript/);
    assert.match(kern, /Ersetzungs-Skript/);
    const windows = readFileSync(WURZEL + `${ORDNER}/plattform-windows.md`, "utf8");
    assert.doesNotMatch(windows, /Fix-Skript|Ersetzungs-Skript/);
  });
});
