/* Bedingte Dateien des Umsetzers und Plattform-Weiche (factory#310): der Kern `.claude/agents/factory-umsetzer.md` enthält nur den Ablauf;
 * Sonderfälle stehen in Dateien neben dem Ablauf-Skill `.agents/skills/factory/` und werden nur bei Eintritt ihrer Bedingung gelesen.
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/ (#1165).
 *
 * Geprüft wird (reine Funktion `bedingteDateienBefunde`, geschlossener Katalog `BEDINGTE`):
 *  (a) der Kern nennt jede bedingte Datei mit vollem Pfad, und die Zeile mit dem Pfad enthält die Bedingungs-Tokens der Datei;
 *  (b) die Datei existiert, steht in `AGENTEN_SKILL_BUDGETS` und im Besitz-Manifest, ihr Kopf nennt den Kern-Pfad;
 *  (c) geschlossene Menge: jede `umsetzer-*.md` und `plattform-*.md` im Ordner steht im Katalog (eine Waise ist rot);
 *  (d) Plattform-Weiche: Windows-Sonderfälle (`WINDOWS_TOKENS`) stehen nicht im Kern-Rumpf (ohne Frontmatter und Projektwerte-Block);
 *  (e) beide Laufzeiten erreichen die Dateien: die Codex-Rolle des Umsetzers liest `factory-umsetzer` als Quelle, und die Dateien liegen im gemeinsamen Skill-Verzeichnis.
 * Grenze: geprüft wird die Verdrahtung (Pfad, Bedingung, Budget, Manifest, Weiche), nicht ob ein Lauf die Datei bei Eintritt der Bedingung tatsächlich liest;
 * die Windows-Tokens sind eine geschlossene Liste, ein neuer Sonderfall mit anderem Wort fällt im Review auf. Der Rumpf-Check (d) kennt nur Groß-/Kleinschreibung wie in der Liste.
 * Verfall: Prüftermin laut `.github/wiedervorlagen.json` (Eintrag `regeln-verfall-2027-03`, ADR 0027). Begriffe: `docs/harness-glossar.md` › Plattform-Weiche, Bedingte Datei (Skill). */
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

const WURZEL = fileURLToPath(new URL("../../", import.meta.url));
const KERN = ".claude/agents/factory-umsetzer.md";
const ORDNER = ".agents/skills/factory";
const { AGENTEN_SKILL_BUDGETS } = budgetRaw as { AGENTEN_SKILL_BUDGETS: { file: string; budget: number }[] };
const { rollenFuer } = codexRollenRaw as { rollenFuer: (config: unknown) => { name: string; quelle: string }[] };
const { QUELL_VERZEICHNIS } = skillPfadeRaw as { QUELL_VERZEICHNIS: string };

/** Geschlossener Katalog: Datei und die Tokens, die die Bedingungszeile im Kern nennen muss. */
const BEDINGTE: { datei: string; tokens: string[] }[] = [
  { datei: "plattform-windows.md", tokens: ["process.platform", "win32"] },
  { datei: "umsetzer-gruppen.md", tokens: ["GRUPPEN"] },
  { datei: "umsetzer-guard-proben.md", tokens: ["Guard", "anker-liste"] },
  { datei: "umsetzer-browser.md", tokens: ["Browser", "Langfuse-Status"] },
  { datei: "umsetzer-pr-merge.md", tokens: ["pr-warten", "Exit 1"] },
  { datei: "umsetzer-fortsetzung.md", tokens: ["bestanden", "fix", "handoff"] },
];
/** Windows-Sonderfälle: sie gehören hinter die Plattform-Weiche (`plattform-windows.md`), nicht in den Kern-Rumpf. */
const WINDOWS_TOKENS = ["taskkill", "$LASTEXITCODE", "PowerShell", "CRLF", "MSYS_NO_PATHCONV", "Git-Bash", "execSync", "Test-Path"];
/** Weitere Leser der Plattform-Weiche (factory#400 L23, geschlossene Liste, nur diese fünf Dateien): Windows-Sonderfälle stehen nur in `plattform-windows.md`.
 *  `weiche`: die Datei nennt die Weiche in einem Satz (`win32` und der Pfad); ohne: der Leser hat sie schon (Umsetzer bzw. Lens). */
const WEICHE_LESER: { datei: string; weiche: boolean }[] = [
  { datei: ".claude/agents/factory-lens.md", weiche: true },
  { datei: ".claude/agents/lens-kern-je-rolle.md", weiche: true },
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

/** Kern ohne Frontmatter und Projektwerte-Block (erwartet LF; der Aufrufer normalisiert CRLF). */
function rumpf(kern: string): string {
  const t = kern.replace(/^---\n[\s\S]*?\n---\n/, "");
  const a = t.indexOf("<!-- factory:projektwerte:start -->");
  const endMarke = "<!-- factory:projektwerte:end -->";
  const b = t.indexOf(endMarke);
  return a >= 0 && b > a ? t.slice(0, a) + t.slice(b + endMarke.length) : t;
}

/** Befunde zur Verdrahtung der bedingten Dateien (leer = in Ordnung). */
export function bedingteDateienBefunde(e: Eingabe): string[] {
  const out: string[] = [];
  const kern = e.kern.replace(/\r\n/g, "\n");
  if (!WEICHE.test(kern)) out.push("Plattform-Weiche: der Kern nennt Bedingung (`node -p process.platform` = `win32`) und Ort (`plattform-windows.md`) nicht in einem Satz");
  for (const { datei, tokens } of BEDINGTE) {
    const pfad = `${ORDNER}/${datei}`;
    const zeilen = kern.split("\n").filter((z) => z.includes(pfad));
    if (zeilen.length === 0) out.push(`${datei}: der Kern nennt den Pfad ${pfad} nicht`);
    else {
      const fehlend = tokens.filter((t) => !zeilen.some((z) => z.includes(t)));
      if (fehlend.length > 0) out.push(`${datei}: die Zeile mit dem Pfad nennt die Bedingung nicht (fehlt: ${fehlend.join(", ")})`);
    }
    const text = e.lies(pfad);
    if (text === null) out.push(`${datei}: die Datei fehlt`);
    else if (!text.slice(0, 600).includes(KERN)) out.push(`${datei}: der Kopf nennt den Kern ${KERN} nicht`);
    if (!e.budgets.some((b) => b.file === pfad)) out.push(`${datei}: kein Eintrag in AGENTEN_SKILL_BUDGETS`);
    if (!e.besitz.includes(pfad)) out.push(`${datei}: kein Eintrag im Besitz-Manifest`);
    if (!e.rollen.some((r) => r.quelle === "factory-umsetzer")) out.push(`${datei}: keine Codex-Rolle mit Quelle factory-umsetzer`);
    if (!pfad.startsWith(`${e.quellVerzeichnis}/`)) out.push(`${datei}: liegt nicht im gemeinsamen Skill-Verzeichnis ${e.quellVerzeichnis}`);
  }
  const erwartet = new Set(BEDINGTE.map((b) => b.datei));
  for (const d of e.ordnerDateien) if (/^(umsetzer|plattform)-.*\.md$/.test(d) && !erwartet.has(d)) out.push(`${d}: Waise, steht nicht im Katalog (Kern, Budget und Manifest mitziehen)`);
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
const echt = (): Eingabe => ({
  kern: readFileSync(WURZEL + KERN, "utf8"),
  lies: lesen,
  budgets: AGENTEN_SKILL_BUDGETS,
  besitz: (JSON.parse(readFileSync(WURZEL + ".factory/besitz.json", "utf8")) as { eintraege: { pfad: string }[] }).eintraege.map((x) => x.pfad),
  ordnerDateien: readdirSync(WURZEL + ORDNER),
  rollen: rollenFuer({ agenten: { planer: "p-x", umsetzer: "u-x", lens: "l-x", gruppe: "g-x" } }),
  quellVerzeichnis: QUELL_VERZEICHNIS,
});

describe("Bedingte Dateien des Umsetzers und Plattform-Weiche (factory#310)", () => {
  test("echter Stand: Weiche, Pfade, Bedingungen, Budgets, Manifest, Waisen und Windows-Rumpf sind in Ordnung", () => {
    assert.deepEqual(bedingteDateienBefunde(echt()), []);
  });

  test("Negativfall Weiche: fehlt der Satz mit `process.platform`/`win32`, ist es rot", () => {
    const e = echt();
    assert.match(bedingteDateienBefunde({ ...e, kern: e.kern.split("`win32`").join("`other`") }).join("\n"), /Plattform-Weiche: der Kern nennt Bedingung/);
  });

  test("Negativfall Weiche: jede Komponente des Satzes zählt (Eigenschaft, Wert, Zeitpunkt, Ort)", () => {
    const e = echt();
    for (const [von, nach] of [
      ["process.platform", "os.platform"],
      ["den Wert `win32`", "den Wert `linux`"],
      ["liest du vor Schritt 1", "liest du nach Schritt 1"],
      ["factory/plattform-windows.md`.", "factory/plattform-linux.md`."],
    ]) {
      const kern = e.kern.split(von).join(nach);
      assert.notEqual(kern, e.kern, `Muster „${von}“ muss treffen`);
      assert.match(bedingteDateienBefunde({ ...e, kern }).join("\n"), /Plattform-Weiche: der Kern nennt Bedingung/, von);
    }
  });

  test("Negativfall Weiche: ein Windows-Sonderfall im Kern-Rumpf (taskkill) ist rot, im Frontmatter oder Projektwerte-Block nicht", () => {
    const e = echt();
    assert.match(bedingteDateienBefunde({ ...e, kern: `${e.kern}\nBeende per taskkill /PID <pid>.\n` }).join("\n"), /Windows-Sonderfall „taskkill“ steht im Kern-Rumpf/);
    const imBlock = e.kern.replace("<!-- factory:projektwerte:start -->", "<!-- factory:projektwerte:start -->\ntaskkill PowerShell CRLF");
    assert.deepEqual(bedingteDateienBefunde({ ...e, kern: imBlock }), []);
  });

  test("Negativfall Waise: eine umsetzer-*.md im Ordner ohne Katalogeintrag ist rot", () => {
    const e = echt();
    assert.match(bedingteDateienBefunde({ ...e, ordnerDateien: [...e.ordnerDateien, "umsetzer-neu.md"] }).join("\n"), /umsetzer-neu\.md: Waise/);
    assert.match(bedingteDateienBefunde({ ...e, ordnerDateien: [...e.ordnerDateien, "plattform-neu.md"] }).join("\n"), /plattform-neu\.md: Waise/);
    assert.deepEqual(bedingteDateienBefunde({ ...e, ordnerDateien: [...e.ordnerDateien, "ablauf-fremd.md"] }), [], "andere Dateien im Ordner zählen nicht");
  });

  test("Frontmatter-Strip: sparsam (eine Trennlinie im Rumpf versteckt kein Token) und ein Token im Frontmatter zählt nicht", () => {
    const e = echt();
    assert.match(bedingteDateienBefunde({ ...e, kern: `${e.kern}\ntaskkill\n\n---\n\nRest\n` }).join("\n"), /Windows-Sonderfall „taskkill“/);
    assert.deepEqual(bedingteDateienBefunde({ ...e, kern: e.kern.replace(/^---\n/, "---\ntaskkill: x\n") }), []);
    const ohneFm = e.kern.replace(/^---\n[\s\S]*?\n---\n/, "");
    assert.match(bedingteDateienBefunde({ ...e, kern: `${ohneFm}\n---\ntaskkill\n---\n` }).join("\n"), /Windows-Sonderfall „taskkill“/, "ohne Frontmatter: kein Strip über Rumpf-Trennlinien (Anker ^)");
    assert.deepEqual(bedingteDateienBefunde({ ...e, kern: e.kern.replace(/^---\n/, "---\nx: a---\ntaskkill: y\n") }), [], "ein Wert, der auf --- endet, beendet das Frontmatter nicht");
    assert.match(bedingteDateienBefunde({ ...e, kern: `---x\ntaskkill\n---\n${ohneFm}` }).join("\n"), /Windows-Sonderfall „taskkill“/, "ein Kopf `---x` ist kein Frontmatter");
    assert.deepEqual(bedingteDateienBefunde({ ...e, kern: e.kern.replace(/^---\n/, "---\nx: a\n---x\ntaskkill: y\n") }), [], "eine Zeile ---x beendet das Frontmatter nicht");
    assert.ok(e.kern.includes("**vor** dem Nachweis-Commit `git fetch origin` und `origin/main` einmergen"), "Abnahme-Absatz: fetch vor dem Merge");
  });

  test("Waise: Anker beidseitig (`^` und `$`), Präfix mitten im Namen und Endung dahinter zählen nicht", () => {
    const e = echt();
    assert.deepEqual(bedingteDateienBefunde({ ...e, ordnerDateien: [...e.ordnerDateien, "alt-umsetzer-x.md"] }), []);
    assert.deepEqual(bedingteDateienBefunde({ ...e, ordnerDateien: [...e.ordnerDateien, "umsetzer-x.md.orig"] }), []);
  });

  test("Weiche: Bedingung und Ort in verschiedenen Zeilen sind nicht ein Satz, also rot", () => {
    const e = echt();
    const kern = e.kern.split("liest du vor Schritt 1").join("\nliest du vor Schritt 1");
    assert.notEqual(kern, e.kern);
    assert.match(bedingteDateienBefunde({ ...e, kern }).join("\n"), /Plattform-Weiche: der Kern nennt Bedingung/);
  });

  test("Kopf-Fenster beidseitig: der Kern-Pfad hinter Zeichen 600 ist rot, knapp innerhalb nicht", () => {
    const e = echt();
    const mit = (vorlauf: number) => (p: string): string | null => (p.endsWith("umsetzer-browser.md") ? `${"x".repeat(vorlauf)} ${KERN}` : e.lies(p));
    assert.match(bedingteDateienBefunde({ ...e, lies: mit(700) }).join("\n"), /umsetzer-browser\.md: der Kopf nennt den Kern/);
    assert.doesNotMatch(bedingteDateienBefunde({ ...e, lies: mit(500) }).join("\n"), /umsetzer-browser\.md: der Kopf nennt den Kern/);
  });

  test("Rumpf ohne Projektwerte-Block: der ganze Text zählt, ein Windows-Token ist rot", () => {
    const e = echt();
    const ohneBlock = e.kern.split("<!-- factory:projektwerte:start -->").join("").split("<!-- factory:projektwerte:end -->").join("");
    assert.deepEqual(bedingteDateienBefunde({ ...e, kern: ohneBlock }), []);
    assert.match(bedingteDateienBefunde({ ...e, kern: `${ohneBlock}\ntaskkill\n` }).join("\n"), /Windows-Sonderfall „taskkill“/);
  });

  test("jedes Windows-Token im Kern-Rumpf ist rot", () => {
    const e = echt();
    for (const t of ["taskkill", "$LASTEXITCODE", "PowerShell", "CRLF", "MSYS_NO_PATHCONV", "Git-Bash", "execSync"]) assert.ok(bedingteDateienBefunde({ ...e, kern: `${e.kern}\n${t}\n` }).join("\n").includes(`Windows-Sonderfall „${t}“`), t);
  });

  test("CRLF-Checkout: der echte Kern mit \\r\\n ist in Ordnung (Frontmatter wird trotzdem abgetrennt)", () => {
    const e = echt();
    assert.deepEqual(bedingteDateienBefunde({ ...e, kern: e.kern.replace(/\n/g, "\r\n") }), []);
  });

  test("Negativfall Budget und Manifest: ein fehlender Eintrag je Datei ist rot", () => {
    const e = echt();
    const pfad = `${ORDNER}/umsetzer-gruppen.md`;
    assert.match(bedingteDateienBefunde({ ...e, budgets: e.budgets.filter((b) => b.file !== pfad) }).join("\n"), /umsetzer-gruppen\.md: kein Eintrag in AGENTEN_SKILL_BUDGETS/);
    assert.match(bedingteDateienBefunde({ ...e, besitz: e.besitz.filter((p) => p !== pfad) }).join("\n"), /umsetzer-gruppen\.md: kein Eintrag im Besitz-Manifest/);
  });

  test("Negativfall Bedingung: der Pfad ohne sein Bedingungs-Token und ein fehlender Pfad sind rot", () => {
    const e = echt();
    const ohneToken = e.kern.split("\n").map((z) => (z.includes(`${ORDNER}/umsetzer-gruppen.md`) ? z.split("GRUPPEN").join("X") : z)).join("\n");
    assert.match(bedingteDateienBefunde({ ...e, kern: ohneToken }).join("\n"), /umsetzer-gruppen\.md: die Zeile mit dem Pfad nennt die Bedingung nicht \(fehlt: GRUPPEN\)/);
    const ohnePfad = e.kern.split(`${ORDNER}/umsetzer-fortsetzung.md`).join("weg");
    assert.match(bedingteDateienBefunde({ ...e, kern: ohnePfad }).join("\n"), /umsetzer-fortsetzung\.md: der Kern nennt den Pfad/);
  });

  test("Negativfall Datei und Kopf: eine fehlende Datei und ein Kopf ohne Kern-Pfad sind rot", () => {
    const e = echt();
    const lies = (p: string): string | null => (p.endsWith("plattform-windows.md") ? null : p.endsWith("umsetzer-browser.md") ? "# Titel\n\nohne Verweis" : e.lies(p));
    const befund = bedingteDateienBefunde({ ...e, lies }).join("\n");
    assert.match(befund, /plattform-windows\.md: die Datei fehlt/);
    assert.match(befund, /umsetzer-browser\.md: der Kopf nennt den Kern/);
  });

  test("Negativfall Codex: ohne Rolle mit Quelle factory-umsetzer, oder mit anderem Skill-Verzeichnis, ist es rot", () => {
    const e = echt();
    const umbenannt = e.rollen.map((r) => (r.quelle === "factory-umsetzer" ? { ...r, quelle: "anderer-umsetzer" } : r));
    assert.match(bedingteDateienBefunde({ ...e, rollen: umbenannt }).join("\n"), /keine Codex-Rolle mit Quelle factory-umsetzer/);
    assert.match(bedingteDateienBefunde({ ...e, quellVerzeichnis: ".andere/skills" }).join("\n"), /liegt nicht im gemeinsamen Skill-Verzeichnis/);
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
    const kern = rumpf(readFileSync(WURZEL + KERN, "utf8"));
    assert.match(kern, /Fix-Skript/);
    assert.match(kern, /Ersetzungs-Skript/);
    const windows = readFileSync(WURZEL + `${ORDNER}/plattform-windows.md`, "utf8");
    assert.doesNotMatch(windows, /Fix-Skript|Ersetzungs-Skript/);
  });
});
