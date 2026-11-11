/* @harness-waechter: Kern-Texte nennen den Läufer `node scripts/gate-befehl.mjs <name>` statt der fünf festen npm-Befehle (factory#186). */
/**
 * Scan-Wächter für die verteilten Kern-Texte (factory#186, Fortschreibung zu ADR 0022 in
 * docs/adr/fortschreibungen/0022-182-gate-befehle.md): Die Gate-Befehle eines Projekts stehen in seiner Config
 * (`befehle`), die Texte nennen den Läufer, nie das Build-Werkzeug. Rot ist jede Fundstelle von `npm ci`,
 * `npm run verify`, `npm run verify:kompakt`, `npm run verify:changed` oder `npm run test:coverage`
 * (auch als `run-script`, mit `-s` oder mit vorangestelltem `--prefix <pfad>` / `-C <pfad>`), dazu (factory#193) `npx vitest`,
 * `npx eslint` und `npm test` (auch mit Präfix): gezielte Testläufe gehen über `node scripts/gate-befehl.mjs testGezielt <datei>`;
 * `verify:full`, `check:*`, `npm install` und andere `npx …` bleiben frei. Zusatzregel: das Wort nach `gate-befehl.mjs`
 * ist ein Name aus `GATE_BEFEHL_NAMEN` oder der Platzhalter `<name>`.
 *
 * Scan-Umfang (geschlossene Liste): (a) `AGENTS.md` ohne Projekt-Block (fehlt ein Marker, wird nichts maskiert),
 * (b) alle versionierten `.claude/agents/*.md`, (c) alle versionierten `.agents/skills/**\/*.md`, (d) die `.md`-Einträge
 * des Besitz-Manifests (ganze Datei bzw. Block-Spanne), (e) die Generator-Ausgabe `setupDateien` für `.codex/agents/*.toml`
 * (die Dateien selbst sind gitignoriert und lokal erzeugt), (f) die Nicht-Kommentarzeilen von `.github/workflows/ci.yml`.
 * Ausnahmen stehen in `AUSNAHMEN` mit Grund.
 * Grenze: kein Semantik-Prüfer. Begriffe wie „das verify:kompakt der Stufe 0“ ohne `npm`, andere Werkzeugaufrufe
 * und Dateien außerhalb des Umfangs bleiben frei; nur im Factory-Repo
 * (der Wächter liegt nicht im Besitz-Manifest).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as besitzRaw from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as gateRaw from "../../scripts/gate-befehl-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as codexRaw from "../../scripts/codex-lib.mjs";
import { SCHNAPPSCHUSS_ENDE, SCHNAPPSCHUSS_START } from "../support/entfernte-pfade";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as markdownRaw from "../../scripts/docs-gen/markdown.mjs";
import { projektBlockZeilen } from "../support/projekt-block";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as namenRaw from "../../scripts/regex-lib.mjs";
import { lies, repoDateien } from "./repo-texte";

type Einheit = { pfad: string; block?: string; schluessel?: string };
const besitz = besitzRaw as unknown as {
  PROJEKT_BLOCK_START: string;
  PROJEKT_BLOCK_ENDE: string;
  besitzSpannen(einheiten: Einheit[], pfad: string, text: string): [number, number][];
  manifestAusText(text: string | null): { manifest?: { eintraege: Einheit[] } };
};
const gate = gateRaw as unknown as { GATE_BEFEHL_NAMEN: readonly string[]; STANDARD_BEFEHLE: Readonly<Record<string, string | null>> };
const { escapeRegex } = namenRaw as unknown as { escapeRegex: (text: string) => string };
const NAMEN = gate.GATE_BEFEHL_NAMEN;
const STANDARD_WERTE = Object.values(gate.STANDARD_BEFEHLE).filter((w): w is string => w !== null);
const codex = codexRaw as unknown as { setupDateien(m: unknown, c: unknown, u: string): Record<string, string> };
const markdown = markdownRaw as unknown as { schnappschussBloecke(zeilen: string[]): { bloecke: [number, number][] } };

/** Skriptnamen der `npm run <skript>`-Standardbefehle, längste zuerst (Alternative ohne Vorrang-Fehler). */
const SKRIPT_NAMEN = STANDARD_WERTE.flatMap((w) => /^npm run (\S+)$/.exec(w)?.[1] ?? []).sort((a, b) => b.length - a.length);
const SKRIPTE = `(?:${SKRIPT_NAMEN.map(escapeRegex).join("|")})`;
const NPM_VOR = String.raw`(?:(?:--prefix|-C)\s+\S+\s+|-\S+\s+)*`;
const REGELN = [
  { name: "npm ci", muster: new RegExp(String.raw`\bnpm\s+${NPM_VOR}ci(?![\w:-])`) },
  { name: "npm run <gate-skript>", muster: new RegExp(String.raw`\bnpm\s+${NPM_VOR}run(?:-script)?\s+(?:-\S+\s+)*${SKRIPTE}(?![\w:-])`) },
  { name: "npx vitest|eslint", muster: new RegExp(String.raw`\bnpx\s+(?:vitest|eslint)\b`) },
  { name: "npm test", muster: new RegExp(String.raw`\bnpm\s+${NPM_VOR}test\b`) },
];
const LAEUFER = /gate-befehl\.mjs\s+(?:--\S+\s+)*([^\s`'"|;&)]+)/g;

type Ausnahme = { art: "projekt-block" | "schnappschuss-block" | "pfad"; praefix?: string; grund: string };
/** Die geschlossene Liste der Ausnahmen, jede mit Grund. */
const AUSNAHMEN: Ausnahme[] = [
  { art: "projekt-block", grund: "der Projekt-Block der AGENTS.md gehört dem Projekt und nennt dessen eigene Befehle" },
  { art: "schnappschuss-block", grund: "datierte Schnappschuss-Blöcke tragen den damaligen Wortlaut bewusst" },
  { art: "pfad", praefix: "docs/adr/", grund: "Historie: ADRs und Fortschreibungen nennen die damals geltenden Befehle" },
];
const hat = (art: Ausnahme["art"]) => AUSNAHMEN.some((a) => a.art === art);

const FIX = `durch \`node scripts/gate-befehl.mjs <name>\` ersetzen (Namen: ${NAMEN.join(", ")})`;

/** Funde eines Textes: `pfad:zeile: regel — fix`. `istAgentsMd` schaltet die Projekt-Block-Ausnahme, `zeilenOffset` rechnet Block-Spannen auf Dateizeilen um. */
function funde(pfad: string, text: string, opt: { istAgentsMd?: boolean; zeilenOffset?: number; yaml?: boolean } = {}): string[] {
  if (AUSNAHMEN.some((a) => a.art === "pfad" && a.praefix !== undefined && pfad.startsWith(a.praefix))) return [];
  const zeilen = text.split("\n");
  const frei = new Set<number>();
  const maskiere = (von: number, bis: number) => {
    for (let i = von; i <= bis; i++) frei.add(i);
  };
  if (opt.istAgentsMd && hat("projekt-block")) {
    const pb = projektBlockZeilen(text);
    if (pb) maskiere(pb[0], pb[1]);
  }
  if (hat("schnappschuss-block")) for (const [s, e] of markdown.schnappschussBloecke(zeilen).bloecke) maskiere(s, e);
  const ausgabe: string[] = [];
  zeilen.forEach((zeile, i) => {
    if (frei.has(i) || (opt.yaml && zeile.trim().startsWith("#"))) return;
    const ort = `${pfad}:${i + 1 + (opt.zeilenOffset ?? 0)}`;
    for (const r of REGELN) if (r.muster.test(zeile)) ausgabe.push(`${ort}: ${r.name} — ${FIX}`);
    for (const m of zeile.matchAll(LAEUFER)) {
      const wort = m[1].replace(/[.,;:]+$/, "");
      if (!NAMEN.includes(wort) && wort !== "<name>") ausgabe.push(`${ort}: gate-befehl.mjs ${wort} — kein Gate-Name (Namen: ${NAMEN.join(", ")})`);
    }
  });
  return ausgabe;
}

type Quelle = { pfad: string; fund: string[] };
function projekt(): { agenten: Record<string, string> } {
  return JSON.parse(readFileSync(".factory/projekt.json", "utf8")) as { agenten: Record<string, string> };
}
function codexAusgabe(): Record<string, string> {
  const mcp = { mcpServers: { playwright: { command: "npx", args: ["--probe"] } } };
  return codex.setupDateien(mcp, projekt(), "https://example.test/api/public/mcp");
}
function manifestMd(): { pfad: string; text: string; spannen: [number, number][] }[] {
  const m = besitz.manifestAusText(lies(".factory/besitz.json")).manifest;
  const einheiten = m?.eintraege ?? [];
  const pfade = [...new Set(einheiten.map((e) => e.pfad).filter((p) => p.endsWith(".md")))];
  return pfade.map((pfad) => {
    const text = lies(pfad);
    return { pfad, text, spannen: besitz.besitzSpannen(einheiten, pfad, text) };
  });
}
function scanUmfang(): { quellen: Quelle[]; zaehler: Record<string, number> } {
  const quellen: Quelle[] = [];
  const zaehler = { agents: 0, agenten: 0, skills: 0, manifest: 0, codex: 0, ci: 0 };
  const gesehen = new Set<string>();
  const ganz = (pfad: string, z: keyof typeof zaehler) => {
    gesehen.add(pfad);
    zaehler[z] += 1;
    quellen.push({ pfad, fund: funde(pfad, lies(pfad), { istAgentsMd: pfad === "AGENTS.md" || pfad === ".claude/agents/lens-kern-je-rolle.md" }) }); // die Arm-B-Lens (factory#235) trägt den Projekt-Block der AGENTS.md
  };
  ganz("AGENTS.md", "agents");
  for (const f of repoDateien().filter((p) => /^\.claude\/agents\/[^/]+\.md$/.test(p))) ganz(f, "agenten");
  for (const f of repoDateien().filter((p) => /^\.agents\/skills\/.+\.md$/.test(p))) ganz(f, "skills");
  for (const e of manifestMd()) {
    if (gesehen.has(e.pfad)) continue;
    zaehler.manifest += 1;
    for (const [a, b] of e.spannen) quellen.push({ pfad: e.pfad, fund: funde(e.pfad, e.text.slice(a, b), { zeilenOffset: e.text.slice(0, a).split("\n").length - 1 }) });
  }
  for (const [pfad, inhalt] of Object.entries(codexAusgabe()).filter(([p]) => /^\.codex\/agents\/[^/]+\.toml$/.test(p))) {
    zaehler.codex += 1;
    quellen.push({ pfad, fund: funde(pfad, inhalt) });
  }
  zaehler.ci = 1;
  quellen.push({ pfad: ".github/workflows/ci.yml", fund: funde(".github/workflows/ci.yml", lies(".github/workflows/ci.yml"), { yaml: true }) });
  return { quellen, zaehler };
}

describe("Gate-Befehle in den Kern-Texten (factory#186)", () => {
  it("der Bestand nennt keinen festen npm-Gate-Befehl", () => {
    const alle = scanUmfang().quellen.flatMap((q) => q.fund);
    expect(alle, `Fundstellen:\n${alle.join("\n")}`).toEqual([]);
  });

  it("Leerlauf-Schutz: der Scan-Umfang ist nicht leer", () => {
    const { zaehler } = scanUmfang();
    expect(zaehler.agents).toBe(1);
    expect(zaehler.agenten).toBeGreaterThanOrEqual(5);
    expect(zaehler.skills).toBeGreaterThanOrEqual(3);
    expect(manifestMd().length).toBeGreaterThanOrEqual(10);
    expect(zaehler.manifest).toBeGreaterThanOrEqual(3);
    expect(zaehler.codex).toBeGreaterThanOrEqual(5);
    expect(repoDateien()).toContain(".agents/skills/review-lenses/SKILL.md");
    expect(repoDateien()).toContain(".agents/skills/factory/ablauf.md");
  });

  it("Leerlauf-Schutz: der Kern-Block der AGENTS.md nennt den Läufer, der Projekt-Block ist maskiert", () => {
    const agents = lies("AGENTS.md");
    expect(agents).toContain("node scripts/gate-befehl.mjs verifyKompakt");
    expect(projektBlockZeilen(agents)).not.toBeNull();
    expect(lies(".github/workflows/ci.yml")).toContain("node scripts/gate-befehl.mjs verify");
  });

  it("jede Ausnahme trägt einen Grund", () => {
    for (const a of AUSNAHMEN) expect(a.grund.trim().length).toBeGreaterThan(10);
  });
});

describe("Regeln auf synthetischem Text", () => {
  // Jeder Standardbefehl ist ein Fund; neue Werte in STANDARD_BEFEHLE brauchen eine Regel (sonst rot).
  const FESTE = STANDARD_WERTE;
  it("Leerlauf-Schutz: die Standardbefehle sind nicht leer, die Skriptliste ist aus ihnen abgeleitet", () => {
    expect(FESTE.length).toBeGreaterThanOrEqual(5);
    expect(SKRIPT_NAMEN).toContain("verify");
  });
  it.each(FESTE)("%s in einer Agentendatei ist ein Fund", (befehl) => {
    expect(funde(".claude/agents/x.md", `Fahre \`${befehl}\` einmal.`)).toHaveLength(1);
  });
  it("Formen mit Präfix und Flags sind Funde", () => {
    for (const z of ["npm --prefix x run verify:kompakt", "npm -C x run-script verify", "npm run -s verify:changed", "npm ci --no-audit --no-fund"]) {
      expect(funde("a.md", z), z).toHaveLength(1);
    }
  });
  it("Test-Werkzeug-Aufrufe sind Funde (npx vitest/eslint, npm test, auch mit Präfix)", () => {
    for (const z of ["npx vitest run x", "npx eslint scripts/a.mjs", "npx  vitest", "npm test", "npm --prefix x test -- y", "npm -C x test", "npm -s test"]) {
      expect(funde("a.md", z), z).toHaveLength(1);
    }
  });
  it("Grenzfälle ohne Fund", () => {
    for (const z of ["npm run verify:full", "npm run check:size", "npm install", "das verify:kompakt der Stufe 0", "npx playwright test", "npx vitestx", "npm run test:unit", "node scripts/gate-befehl.mjs testGezielt a.ts"]) {
      expect(funde("a.md", z), z).toEqual([]);
    }
  });
  it("Projekt-Block der AGENTS.md ist frei, der Kern-Block nicht", () => {
    const { PROJEKT_BLOCK_START: s, PROJEKT_BLOCK_ENDE: e } = besitz;
    const kern = `Kern npm run verify:kompakt\n${s}\nProjekt npm run verify:kompakt\n${e}\n`;
    expect(funde("AGENTS.md", kern, { istAgentsMd: true })).toHaveLength(1);
    expect(funde("AGENTS.md", `${s}\nProjekt npm run verify:kompakt\n${e}\n`, { istAgentsMd: true })).toEqual([]);
    expect(funde("AGENTS.md", `${s}\nProjekt npm run verify:kompakt\n`, { istAgentsMd: true })).toHaveLength(1); // Ende fehlt: nichts maskiert
    expect(funde("a.md", `${s}\nnpm run verify:kompakt\n${e}\n`)).toHaveLength(1); // nur AGENTS.md hat die Ausnahme
  });
  it("datierter Schnappschuss-Block ist frei, ein Start ohne Ende maskiert nichts", () => {
    expect(funde("a.md", `${SCHNAPPSCHUSS_START}\n2026-01-01\nnpm run verify\n${SCHNAPPSCHUSS_ENDE}\n`)).toEqual([]);
    expect(funde("a.md", `${SCHNAPPSCHUSS_START}\n2026-01-01\nnpm run verify\n`)).toHaveLength(1);
  });
  it("Historie unter docs/adr/ ist frei", () => {
    expect(funde("docs/adr/x.md", "npm run verify")).toEqual([]);
    expect(funde("docs/x.md", "npm run verify")).toHaveLength(1);
  });
  it("das Wort nach gate-befehl.mjs muss ein Gate-Name oder <name> sein", () => {
    expect(funde("a.md", "node scripts/gate-befehl.mjs verifyKompakt")).toEqual([]);
    expect(funde("a.md", "node scripts/gate-befehl.mjs <name>`")).toEqual([]);
    expect(funde("a.md", "node scripts/gate-befehl.mjs --zeigen verify.")).toEqual([]);
    expect(funde("a.md", "node scripts/gate-befehl.mjs verify:kompakt")).toHaveLength(1);
    expect(funde("a.md", "node scripts/gate-befehl.mjs lint")).toHaveLength(1);
  });
  it("ci.yml: Befehl in einer Zeile ist ein Fund, im Kommentar nicht", () => {
    expect(funde("ci.yml", "        run: npm run verify", { yaml: true })).toHaveLength(1);
    expect(funde("ci.yml", "      # npm run verify", { yaml: true })).toEqual([]);
    expect(funde("ci.yml", "        run: node scripts/gate-befehl.mjs verify", { yaml: true })).toEqual([]);
  });
  it("Zeilenzahl der Funde in Block-Spannen rechnet den Versatz ein", () => {
    expect(funde("a.md", "x\nnpm ci", { zeilenOffset: 10 })[0]).toContain("a.md:12:");
  });
  it("Codex: ein Toml-Text mit npm ci ist ein Fund, die Generator-Ausgabe ist sauber", () => {
    expect(funde(".codex/agents/x.toml", 'developer_instructions = "darin npm ci"')).toHaveLength(1);
    const toml = Object.entries(codexAusgabe()).filter(([p]) => p.endsWith(".toml") && p.startsWith(".codex/agents/"));
    expect(toml.length).toBeGreaterThanOrEqual(5);
    for (const [p, t] of toml) expect(funde(p, t), p).toEqual([]);
  });
});
