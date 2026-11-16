/* Wächter für den Sitzungsabschluss (#1572 Z5, #1723, factory#569): der Ticket-Skill (Schritt 5) ruft den privaten Abschluss-Skill
 * (nutzerlokal: `FACTORY_ABSCHLUSS_SKILL`, optional: `node scripts/projekt-config.mjs abschluss` nennt den wirksamen Namen oder `keiner`) IMMER auf, sofern wirksam gesetzt; der Schritt entfällt nur, wenn dieser Aufruf mit unbekanntem Skill scheitert
 * (dann Zeile `Hinweis: Abschluss-Skill <name> unbekannt`, kein Abbruch). Davor schreibt der Umsetzer den Repo-Abschluss (Schritt 3) ins Repo, unabhängig vom privaten Skill. Seit #1723 nennen AGENTS.md, der Skill
 * und der Umsetzer auch das Feld `BEFUNDE:` und den Fortsetzungs-Pfad („mach mit <nr> weiter“).
 *
 * @harness-waechter – einziger Durchsetzer seiner Regel, darum im geschützten test/harness/.
 *
 * Warum: „falls er in der Session verfügbar ist“ ließ den Hauptchat den Schritt am Sitzungsende überspringen, weil eine
 * spätere, kürzere Skill-Liste den Abschluss-Skill nicht mehr nannte. Eine Skill-Liste ist kein Beleg für Nichtverfügbarkeit.
 *
 * Dazu (factory#569): der Kern-Text nennt keinen bestimmten privaten Skill. Der Scan (`abschlussNamenFunde`) prüft eine geschlossene Dateiliste (AGENTS.md, Skills, Agenten, docs/ ohne docs/historie/ und docs/adr/, beide historisch und nie umgeschrieben) auf
 * (a) den Platzhalter für den Abschluss-Skill außerhalb des Projektwerte-Blocks, (b) einen Skill-Aufruf mit festem Namen, (c) einen Namen in der Fabrik-Config (nur upstream) und (d) den Wert der lokalen Variable.
 * Bewusste Grenze: eine freie Nennung ohne diese Muster findet der Scan nicht; die CI kennt keinen Nutzernamen, (d) wirkt nur lokal.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { projektConfig } from "../support/fremd-config";
import { liesMitProjektwerten, TICKET_ABLAUF } from "../support/ticket-ablauf";

const norm = (t: string) => t.replace(/\s+/g, " ");
const lies = (pfad: string) => norm(rohLesen(pfad));
/** Der Ablauf und die AGENTS.md werden mit den Projektwerten gelesen (ADR 0022 F10), alles andere roh. */
const rohLesen = (pfad: string): string => (pfad === TICKET_ABLAUF || pfad === "AGENTS.md" ? liesMitProjektwerten(pfad) : readFileSync(new URL(`../../${pfad}`, import.meta.url), "utf8"));
const SKILLS = [".agents/skills/factory/ablauf.md"];

describe("Sitzungsabschluss ruft den privaten Abschluss-Skill immer auf, sofern wirksam gesetzt (#1572)", () => {
  test.each(SKILLS)("%s: Aufruf-Wortlaut und Satz zur Skill-Liste stehen da", (pfad) => {
    const t = lies(pfad);
    expect(t).toContain('Skill({ skill: "<wirksamer Name>" })');
    expect(t).toContain("eine spätere, kürzere Skill-Liste ist kein Beleg");
  });

  test.each(SKILLS)("%s: kein Vorab-Gate „falls verfügbar“ neben dem Abschluss-Skill", (pfad) => {
    const t = lies(pfad);
    expect(t).not.toMatch(/falls er in der Session verfügbar ist/);
    expect(t).not.toMatch(/Abschluss-Skill[^.]{0,40}falls verfügbar/);
  });

  test("der Ticket-Skill lässt den Schritt nur bei unbekanntem Skill entfallen", () => {
    expect(lies(SKILLS[0])).toMatch(/entfällt nur, wenn dieser Aufruf mit unbekanntem Skill scheitert/);
  });
});

/** Pflichtstellen je Datei (#1723): Fehlt eine, ist das Prädikat nicht leer. Prüft nur Text, nicht Verhalten. */
const PFLICHT: Record<string, { name: string; muster: RegExp }[]> = {
  "AGENTS.md": [
    { name: "Bullet", muster: /\*\*Abschluss ohne offene Befunde\.\*\*/ },
    { name: "Fortsetzungsauftrag ohne Skill", muster: /mach mit <nr> weiter/ },
    { name: "privater Abschluss-Skill, sofern lokal gesetzt", muster: /Danach, falls lokal gesetzt, der private Abschluss-Skill/ },
    { name: "Repo-Abschluss", muster: /Repo-Abschluss/ },
    { name: "nie als Frage", muster: /nie als Frage/ },
    { name: "nur aus Evidenz", muster: /nur aus Evidenz/ },
    { name: "gemergter PR erledigt es nicht mehr", muster: /gemergter PR/ },
    { name: "sofort, Hauptchat direkt nach dem Bericht", muster: /\*\*sofort\*\* ein[^\n]*direkt nach dem Bericht/ },
    { name: "Harness-Befunde nur per melden.mjs", muster: /Eintragen nur per `node scripts\/melden\.mjs`/ },
  ],
  ".agents/skills/factory/ablauf.md": [
    { name: "BEFUNDE:-Feld im Sitzungsabschluss", muster: /\*\*Sitzungsabschluss\.\*\*[^\n]*BEFUNDE:/ },
    { name: "Fortsetzungs-Pfad im Schritt 5", muster: /\*\*Sitzungsabschluss\.\*\*[^\n]*mach mit <nr> weiter[^\n]*<wirksamer Name>/ },
    { name: "wirksamer Name aus projekt-config.mjs abschluss", muster: /\*\*Sitzungsabschluss\.\*\*[^\n]*node scripts\/projekt-config\.mjs abschluss[^\n]*`keiner` entfällt der Aufruf/ },
    { name: "Abschluss-Skill im Abschluss", muster: /Skill\(\{ skill: "<wirksamer Name>" \}\)/ },
    { name: "unbekannter Skill ist ein Hinweis, kein Abbruch", muster: /Hinweis: Abschluss-Skill <name> unbekannt/ },
    { name: "Repo-Abschluss läuft vor dem privaten Skill", muster: /Repo-Abschluss \(Schritt 3 des Umsetzers\) läuft davor und unabhängig/ },
    { name: "Codex: Skill per Namen, sonst derselbe Hinweis", muster: /Codex-Skill-Mechanik per Namen/ },
    { name: "Verweis auf die Regel", muster: /AGENTS\.md § Abschluss ohne offene Befunde/ },
    { name: "sofortiger Eintrag nach dem Umsetzer-Bericht", muster: /\*\*Direkt nach dem Umsetzer-Bericht\*\*[^\n]*sofort ein/ },
  ],
  ".claude/agents/factory-umsetzer.md": [
    { name: "Repo-Abschluss direkt ohne Rückfrage", muster: /\*\*Repo-Abschluss \(Projekt-Brain pflegen\)\*\*[^\n]*direkt und ohne Rückfrage/ },
    { name: "Formatzeile mit Ziel-Ticket oder keine", muster: /^BEFUNDE: .*→ #<nr>.*keine/m },
    { name: "Eintragspflicht vor dem Bericht", muster: /Vor dem Bericht trägst du jeden Befund selbst ein/ },
    { name: "liegen gelassene Lens-Hinweise", muster: /liegen gelassene, zutreffende Lens-Hinweise/ },
    { name: "Bekannte Grenze ist kein Befund", muster: /„Bekannte Grenze“[^.]*sind kein Befund/ },
  ],
};

/** Liste der fehlenden Pflichtstellen einer Datei (leer = vollständig). */
function abschlussLuecken(pfad: string, text: string): string[] {
  return (PFLICHT[pfad] ?? []).filter((p) => !p.muster.test(text)).map((p) => `${pfad}: ${p.name}`);
}


describe("Abschluss ohne offene Befunde, auch im Fortsetzungs-Pfad (#1723)", () => {
  test.each(Object.keys(PFLICHT))("%s: alle Pflichtstellen stehen da", (pfad) => {
    expect(abschlussLuecken(pfad, rohLesen(pfad))).toEqual([]);
  });

  test("Gegenbeispiel: Fassung ohne BEFUNDE: wird rot, in Skill und Umsetzer", () => {
    for (const pfad of Object.keys(PFLICHT).filter((p) => p !== "AGENTS.md")) {
      const ohne = rohLesen(pfad).replace(/BEFUNDE:/g, "BEFUND-");
      expect(abschlussLuecken(pfad, ohne).length, pfad).toBeGreaterThan(0);
    }
  });

  test("Gegenbeispiel: Schritt 5 ohne Fortsetzungs-Satz, AGENTS.md ohne Abschluss-Skill und ohne Evidenz-Klausel werden rot", () => {
    const skill = ".agents/skills/factory/ablauf.md";
    expect(abschlussLuecken(skill, rohLesen(skill).replace(/mach mit <nr> weiter/g, "weiter")).length).toBeGreaterThan(0);
    expect(abschlussLuecken(skill, rohLesen(skill).replace("weiter“, „weiter“) oder Ad-hoc-Auftrag", "weiter“, „weiter“)\n\n- oder Ad-hoc-Auftrag")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace("Danach, falls lokal gesetzt, der private Abschluss-Skill", "Danach etwas")).length).toBeGreaterThan(0);
    expect(abschlussLuecken(skill, rohLesen(skill).replace("node scripts/projekt-config.mjs abschluss", "etwas")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace(/nur aus Evidenz/g, "gern")).length).toBeGreaterThan(0);
    expect(abschlussLuecken("AGENTS.md", rohLesen("AGENTS.md").replace(/gemergter PR/g, "PR")).length).toBeGreaterThan(0);
  });

  test("Gegenbeispiel: Umsetzer ohne Lens-Hinweis-Satz oder ohne Bekannte-Grenze-Ausnahme wird rot", () => {
    const umsetzer = ".claude/agents/factory-umsetzer.md";
    expect(abschlussLuecken(umsetzer, rohLesen(umsetzer).replace("liegen gelassene, zutreffende Lens-Hinweise", "alle Lens-Hinweise")).length).toBeGreaterThan(0);
    expect(abschlussLuecken(umsetzer, rohLesen(umsetzer).replace("„Bekannte Grenze“ (Kopfkommentar des Guards, PR-Text) sind kein Befund", "„Bekannte Grenze“ (Kopfkommentar des Guards, PR-Text) sind ein Hinweis")).length).toBeGreaterThan(0);
  });

  test("Gegenbeispiel: BEFUNDE: nur im Zwischen-Hand-off, nicht im Sitzungsabschluss, wird rot", () => {
    const skill = ".agents/skills/factory/ablauf.md";
    expect(abschlussLuecken(skill, rohLesen(skill).replace("jede `BEFUNDE:`-Zeile des Umsetzers", "jede Befund-Zeile des Umsetzers")).length).toBeGreaterThan(0);
  });

  test("SSOT: „nie als Frage“ steht genau einmal in AGENTS.md und in keinem Skill- oder Agententext", () => {
    expect(rohLesen("AGENTS.md").match(/nie als Frage/g)?.length).toBe(1);
    for (const pfad of Object.keys(PFLICHT).filter((p) => p !== "AGENTS.md")) expect(rohLesen(pfad), pfad).not.toMatch(/nie als Frage/);
  });
});

/** Geschlossene Scan-Liste des Kern-Texts (factory#569): AGENTS.md, Skills, Agenten und docs/ ohne docs/historie/ und docs/adr/ (historisch). */
function kernTextDateien(): { pfad: string; text: string }[] {
  const wurzel = new URL("../../", import.meta.url);
  const pfade = ["AGENTS.md"];
  for (const basis of [".agents/skills", ".claude/agents", "docs"]) {
    for (const rel of readdirSync(new URL(basis + "/", wurzel), { recursive: true }) as string[]) {
      const p = `${basis}/${rel.split("\\").join("/")}`;
      if (p.endsWith(".md") && !p.startsWith("docs/historie/") && !p.startsWith("docs/adr/")) pfade.push(p);
    }
  }
  return pfade.map((pfad) => ({ pfad, text: rohLesen(pfad) }));
}

const PROJEKTWERTE_BLOCK = /<!-- factory:projektwerte:start -->[\s\S]*?<!-- factory:projektwerte:end -->/g;
const PLATZHALTER = "<skills.abschluss>";
const SKILL_AUFRUF = /Skill\(\{ skill: "([^"]*)" \}\)/g;

/** Funde des Kern-Text-Scans: Platzhalter, fester Skill-Name im Aufruf, Config-Wert der Fabrik (nur upstream) und Wert der lokalen Variable. */
function abschlussNamenFunde(dateien: { pfad: string; text: string }[], opt: { konfigWert: string | null | undefined; upstream: boolean; privat: string | undefined }): string[] {
  const funde: string[] = [];
  if (opt.upstream && opt.konfigWert !== null) funde.push("(c) skills.abschluss der Fabrik-Config ist nicht null");
  for (const d of dateien) {
    const ohneBlock = d.text.replace(PROJEKTWERTE_BLOCK, "");
    if (ohneBlock.includes(PLATZHALTER)) funde.push(`(a) ${d.pfad}: Platzhalter für den Abschluss-Skill`);
    for (const m of ohneBlock.matchAll(SKILL_AUFRUF)) if (!/^<[^>]+>$/.test(m[1])) funde.push(`(b) ${d.pfad}: Skill-Aufruf mit festem Namen „${m[1]}“`);
    if (opt.privat && opt.privat !== "aus" && d.text.includes(opt.privat)) funde.push(`(d) ${d.pfad}: Wert von FACTORY_ABSCHLUSS_SKILL`);
  }
  return funde;
}

describe("Kern-Text nennt keinen bestimmten privaten Abschluss-Skill (factory#569)", () => {
  const upstream = !existsSync(new URL("../../.factory/sync-stand.json", import.meta.url));
  const opt = { konfigWert: projektConfig().skills.abschluss as string | null | undefined, upstream, privat: process.env.FACTORY_ABSCHLUSS_SKILL };

  test("der echte Kern-Text ist frei von Platzhalter, festem Skill-Aufruf, Config-Wert und lokalem Namen", () => {
    const dateien = kernTextDateien();
    expect(dateien.length).toBeGreaterThan(50);
    expect(abschlussNamenFunde(dateien, opt)).toEqual([]);
  });

  test("Gegenbeispiel (a): Platzhalter außerhalb des Projektwerte-Blocks wird gefunden, innerhalb nicht", () => {
    const block = "<!-- factory:projektwerte:start -->\n| `skills.abschluss` | — |\n" + PLATZHALTER + "\n<!-- factory:projektwerte:end -->";
    expect(abschlussNamenFunde([{ pfad: "x.md", text: block }], { ...opt, privat: undefined, upstream: false })).toEqual([]);
    expect(abschlussNamenFunde([{ pfad: "x.md", text: `${block}\nrufe ${PLATZHALTER}` }], { ...opt, privat: undefined, upstream: false }).length).toBe(1);
  });

  test("Gegenbeispiel (b): fester Skill-Name im Aufruf wird gefunden, ein <…>-Platzhalter nicht", () => {
    const o = { ...opt, privat: undefined, upstream: false };
    expect(abschlussNamenFunde([{ pfad: "x.md", text: 'Skill({ skill: "<wirksamer Name>" })' }], o)).toEqual([]);
    expect(abschlussNamenFunde([{ pfad: "x.md", text: 'Skill({ skill: "mein-skill" })' }], o).length).toBe(1);
  });

  test("Gegenbeispiel (c): ein Config-Wert ungleich null wird upstream gefunden, bei Beziehern nicht", () => {
    expect(abschlussNamenFunde([], { konfigWert: "x", upstream: true, privat: undefined }).length).toBe(1);
    expect(abschlussNamenFunde([], { konfigWert: "x", upstream: false, privat: undefined })).toEqual([]);
    expect(abschlussNamenFunde([], { konfigWert: null, upstream: true, privat: undefined })).toEqual([]);
  });

  test("Gegenbeispiel (d): der Wert der Variable wird gefunden, `aus` und leer nicht", () => {
    const d = [{ pfad: "x.md", text: "nutzt privat-system" }];
    const o = { konfigWert: null, upstream: false };
    expect(abschlussNamenFunde(d, { ...o, privat: "privat-system" }).length).toBe(1);
    expect(abschlussNamenFunde(d, { ...o, privat: "aus" })).toEqual([]);
    expect(abschlussNamenFunde(d, { ...o, privat: "" })).toEqual([]);
    expect(abschlussNamenFunde(d, { ...o, privat: undefined })).toEqual([]);
  });
});
