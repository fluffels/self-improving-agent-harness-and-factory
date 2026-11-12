/**
 * Helfer des Kern-Verweis-Wächters `besitz-abschnittsverweise.test.ts` (factory#245): Scans über Besitz-Text, die strenge Form für
 * Verweise auf Fabrik-Seiten, die Prüfung der Verweise auf AGENTS.md und die Ankerliste. Reiner Helfer ohne eigenen Test-Marker
 * (Präzedenz `repo-texte.ts`); liegt in test/harness/, damit eine Änderung eine Audit-Spur hinterlässt. Die Regeln stehen im
 * Kopfkommentar des Wächters.
 *
 * Die Muster der Nebenformen (Fabrik-Verweis, `Projekt-Block ›`, `AGENTS.md (§`) werden aus `ABSCHNITT_VERWEIS` von
 * `check:docdrift` abgeleitet (Vorspann ersetzt), nicht kopiert; ändert sich dessen Vorspann, bricht `abgeleitet` laut.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";

// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawDrift from "../../scripts/check-docdrift.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawTagTakt from "../../scripts/tag-takt.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawBesitz from "../../scripts/besitz-lib.mjs";
// @ts-expect-error: kein .d.ts für das .mjs-Tooling-Skript.
import * as rawMarkdown from "../../scripts/docs-gen/markdown.mjs";
import { projektBlock } from "../support/projekt-block";

export interface Verweis {
  pfad: string;
  trenner: string;
  segmente: string[];
  index: number;
}
export interface Einheit {
  pfad: string;
  block?: string;
  schluessel?: string;
  ring?: string;
}
export interface Fund {
  datei: string;
  ziel: string;
  segment: string;
}
export interface StrengFund extends Fund {
  grund: string;
}
export interface BesitzDatei {
  datei: string;
  text: string;
  spannen: [number, number][];
}

const drift = rawDrift as unknown as {
  ABSCHNITT_VERWEIS: RegExp;
  abschnittVerweise: (text: string, o: { istMarkdown: boolean }) => Verweis[];
  abschnittTitel: (md: string) => string[][];
  abschnittTrifft: (segment: string, titel: string[][]) => boolean;
  linkStellen: (md: string) => { start: number; path: string; anchor: string; bild: boolean }[];
  linkZiel: (datei: string, pfad: string) => string;
};
const markdown = rawMarkdown as unknown as {
  codeMaskiert: (md: string) => string;
  ueberschriftenStellen: (md: string) => { ebene: number; slug: string; zeile: number }[];
};
const besitz = rawBesitz as unknown as {
  besitzSpannen: (einheiten: Einheit[], pfad: string, text: string) => [number, number][];
  einheitText: (e: { pfad: string; block?: string }, text: string) => string | null;
  wirdVerteilt: (e: Einheit) => boolean;
  istGanzeDatei: (e: Einheit) => boolean;
};

export const ENDUNGEN = /\.(md|mjs|cjs|js)$/;
export const VORLAGE = ".factory/produkt/vorlagen/AGENTS.md.vorlage";
/** Pfad der Ankerliste: eine Quelle, `tag-takt.mjs` (liest sie am Tag und an HEAD). */
export const ANKERLISTE: string = (rawTagTakt as unknown as { ANKER_LISTE: string }).ANKER_LISTE;

// ── Muster aus ABSCHNITT_VERWEIS abgeleitet (factory#245 L12b) ────────────────────────────────────────────────────

const VORSPANN = String.raw`([\w./-]*\w\.md) (›|§)`;

/** Ersetzt den Vorspann `<pfad>.md ›|§` von `ABSCHNITT_VERWEIS` durch `vorspann` (Gruppen: 1 Ziel, 2 Trenner, 3 Abschnittstext). Wirft, wenn der Vorspann nicht mehr dort steht. */
export function abgeleitet(vorspann: string, original: RegExp = drift.ABSCHNITT_VERWEIS): RegExp {
  const quelle = original.source;
  const neu = quelle.replace(VORSPANN, vorspann);
  if (neu === quelle) throw new Error("ABSCHNITT_VERWEIS trägt den erwarteten Vorspann nicht mehr: Ableitung in kern-verweise.ts nachziehen");
  return new RegExp(neu, original.flags);
}

/** Fabrik-Verweis `<pfad>.md (Fabrik) › A` (die Gate-Regex erkennt ihn nie, also prüft der Bezieher ihn nie). */
export const FABRIK_VERWEIS = abgeleitet(String.raw`([\w./-]*\w\.md) \(Fabrik\) (›|§)`);
/** `Projekt-Block › A` bzw. `§ A`: Verweis auf den Projekt-Block der AGENTS.md. */
export const PROJEKT_BLOCK_VERWEIS = abgeleitet(String.raw`(Projekt-Block) (›|§)`);
/** `AGENTS.md (§ A`: Klammerform des Verweises auf AGENTS.md. */
export const AGENTS_KLAMMER_VERWEIS = abgeleitet(String.raw`(AGENTS\.md) \((§)`);

/** Verweise nach einem abgeleiteten Muster (gleiche Segmentlogik wie `abschnittVerweise`); `istMarkdown` maskiert Code vorher. */
export function verweiseNachMuster(muster: RegExp, text: string, istMarkdown: boolean): Verweis[] {
  const quelle = istMarkdown ? markdown.codeMaskiert(text) : text;
  const treffer: Verweis[] = [];
  for (const m of quelle.matchAll(muster)) {
    const start = (m.index ?? 0) + m[0].length - m[3].length;
    const roh = istMarkdown ? text.slice(start, start + m[3].length).split("`")[0] : m[3];
    const segmente = roh
      .split(" › ")
      .map((s) => s.trim())
      .filter((s) => s !== "" && !s.startsWith("<"));
    if (segmente.length > 0) treffer.push({ pfad: m[1], trenner: m[2], segmente, index: m.index ?? 0 });
  }
  return treffer;
}

// ── Besitz-Dateien ────────────────────────────────────────────────────────────────────────────────────────────────

/** Gemeinsame Ermittlung: Besitz-Dateien samt Spannen. `wurzel` trägt `.factory/besitz.json`; `alle` nimmt auch nicht verteilte Einheiten (Ring oberflaeche) mit. */
export function besitzDateien(wurzel: string, endung: RegExp, alle = false): { lies: (p: string) => string | null; einheiten: Einheit[]; verteilt: Einheit[]; dateien: BesitzDatei[] } {
  const lies = (p: string): string | null => {
    const a = join(wurzel, p);
    return existsSync(a) && statSync(a).isFile() ? readFileSync(a, "utf8").replace(/\r/g, "") : null;
  };
  const manifest = JSON.parse(lies(".factory/besitz.json") ?? "{}") as { eintraege: Einheit[] };
  const verteilt = manifest.eintraege.filter(besitz.wirdVerteilt);
  const einheiten = (alle ? manifest.eintraege : verteilt).filter((e) => e.schluessel === undefined);
  const dateien: BesitzDatei[] = [];
  for (const datei of new Set(einheiten.map((e) => e.pfad))) {
    if (!endung.test(datei) || /^docs\/adr\//.test(datei) || /\d{4}-\d{2}-\d{2}/.test(datei)) continue;
    const text = lies(datei);
    if (text !== null) dateien.push({ datei, text, spannen: besitz.besitzSpannen(einheiten, datei, text) });
  }
  return { lies, einheiten, verteilt, dateien };
}

const imSpann = (spannen: [number, number][], index: number): boolean => spannen.some(([a, b]) => index >= a && index <= b);

/** Ziel eines Verweises: Pfad wörtlich oder relativ zur verweisenden Datei, der erste, der existiert. */
function zielVon(datei: string, pfad: string, lies: (p: string) => string | null): string | undefined {
  return [pfad, posix.join(posix.dirname(datei), pfad)].map((p) => posix.normalize(p)).filter((p) => !p.startsWith("..")).find((p) => lies(p) !== null);
}

// ── Ankerliste (geschlossen, JSON neben dem Wächter) ──────────────────────────────────────────────────────────────

/** Die geschlossene Ankerliste `KERN_LINK_ANKER` aus `test/harness/kern-link-anker.json` (sortiertes Array von `docs/<x>.md#<anker>`). */
export function ladeKernLinkAnker(wurzel: string): string[] {
  return JSON.parse(readFileSync(join(wurzel, ANKERLISTE), "utf8")) as string[];
}

/** Link-Anker `docs/<x>.md#<anker>` in Besitz-Spannen verteilter Einheiten (`endung`), deren Ziel keine ganze Besitz-Datei ist (die kommt mit ihren Überschriften an). */
export function scanneLinkAnker(wurzel: string, endung = /\.md$/): { anker: Set<string>; links: number } {
  const { lies, einheiten, dateien } = besitzDateien(wurzel, endung);
  const ganzeDateien = new Set(einheiten.filter(besitz.istGanzeDatei).map((e) => e.pfad));
  const anker = new Set<string>();
  let links = 0;
  for (const { datei, text, spannen } of dateien) {
    for (const l of drift.linkStellen(text)) {
      if (l.anchor === "" || !l.path.endsWith(".md") || !imSpann(spannen, l.start)) continue;
      const ziel = drift.linkZiel(datei, l.path);
      if (!ziel.startsWith("docs/") || lies(ziel) === null || ganzeDateien.has(ziel)) continue;
      links++;
      anker.add(`${ziel}#${l.anchor}`);
    }
  }
  return { anker, links };
}

export const ANKER_MELDUNG = "neuen Anker in kern-link-anker.json aufnehmen und eine `SIH-Bezieher-Migration:`-Zeile schreiben (Bezieher mit eigener Seite brauchen die Überschrift)";

/** Meldungen (leer = grün): neue Anker und (außer `nurNeue`) Einträge der Liste, die kein Besitz-Text mehr setzt. */
export function vergleicheAnker(gefunden: Set<string>, erlaubt: Set<string>, nurNeue = false): string[] {
  return [
    ...[...gefunden].filter((a) => !erlaubt.has(a)).sort().map((a) => `${a}: ${ANKER_MELDUNG}`),
    ...(nurNeue ? [] : [...erlaubt].filter((a) => !gefunden.has(a)).sort().map((a) => `${a}: kein Besitz-Text setzt diesen Anker mehr, aus kern-link-anker.json streichen`)),
  ];
}

// ── Strenge Form für Verweise auf Fabrik-Seiten ───────────────────────────────────────────────────────────────────

/** Der Weg für eine Meldung der strengen Form (factory#245 L12c): alle drei erlaubten Formen. */
export const STRENG_MELDUNG =
  "Erlaubt sind: (1) ein Markdown-Link `[<pfad>.md › A](<relativ>/<pfad>.md#<anker>)` mit genau einem Segment, dessen Anker in kern-link-anker.json steht " +
  "(neuer Anker: Kern-.md-Link setzen, Listeneintrag und eine `SIH-Bezieher-Migration:`-Zeile), (2) `AGENTS.md § <Titel>` mit einem Titel des Kern-Blocks, " +
  "(3) die Fabrik-Form `<pfad>.md (Fabrik) › A` (auch `§`, auch Ketten): sie prüft nur die Fabrik, nie der Bezieher.";

/** Meldungstext zu den Funden der strengen Form. */
export function strengMeldung(funde: StrengFund[]): string {
  return `Verweise auf Fabrik-Seiten ohne strenge Form:\n${funde.map((f) => `${f.datei} -> ${f.ziel}: ${f.segment} (${f.grund})`).join("\n")}\n${STRENG_MELDUNG}`;
}

/**
 * Strenge Form: jeder Verweis (Muster 8, Code nicht maskiert) aus Besitz-Text auf eine Fabrik-Seite (Ziel ungleich AGENTS.md, keine ganze Besitz-Datei)
 * ist nur grün als (a) Link-Text eines Markdown-Links, der (b) dieselbe Seite verlinkt, (c) mit einem Anker der Ankerliste, bei (d) genau einem Segment,
 * das (e) die Überschrift dieses Ankers trifft.
 */
export function strengeFunde(wurzel: string, erlaubt: Set<string>): { funde: StrengFund[]; verweise: number } {
  const { lies, einheiten, dateien } = besitzDateien(wurzel, ENDUNGEN);
  const ganzeDateien = new Set(einheiten.filter(besitz.istGanzeDatei).map((e) => e.pfad));
  const funde: StrengFund[] = [];
  let verweise = 0;
  for (const { datei, text, spannen } of dateien) {
    const stellen = drift.linkStellen(text);
    for (const v of drift.abschnittVerweise(text, { istMarkdown: false })) {
      const ziel = zielVon(datei, v.pfad, lies);
      if (!imSpann(spannen, v.index) || ziel === undefined || ziel === "AGENTS.md" || ganzeDateien.has(ziel)) continue;
      verweise++;
      const grund = strengPruefung(datei, v, ziel, stellen, erlaubt, lies);
      if (grund !== null) funde.push({ datei, ziel, segment: v.segmente.join(" › "), grund });
    }
  }
  return { funde, verweise };
}

/** `null` = streng genug, sonst der Grund (Prüfpunkte (a) bis (e) in `strengeFunde`). */
function strengPruefung(datei: string, v: Verweis, ziel: string, stellen: ReturnType<typeof drift.linkStellen>, erlaubt: Set<string>, lies: (p: string) => string | null): string | null {
  const l = stellen.find((s) => s.start + 1 === v.index);
  if (l === undefined) return "(a) kein Link-Text eines Markdown-Links";
  if (drift.linkZiel(datei, l.path) !== ziel) return "(b) der Link zeigt auf eine andere Seite";
  if (!erlaubt.has(`${ziel}#${l.anchor}`)) return "(c) Anker nicht in der Ankerliste";
  if (v.segmente.length !== 1) return "(d) mehr als ein Segment";
  const zeilen = (lies(ziel) ?? "").split("\n");
  const kopf = markdown.ueberschriftenStellen(lies(ziel) ?? "").find((h) => h.slug === l.anchor);
  if (kopf === undefined || !drift.abschnittTrifft(v.segmente[0], drift.abschnittTitel(zeilen[kopf.zeile]))) return "(e) das Segment trifft die Überschrift des Ankers nicht";
  return null;
}

// ── Fabrik-Verweise ───────────────────────────────────────────────────────────────────────────────────────────────

/** Fabrik-Verweise in Besitz-Spannen aller Manifest-Einheiten (auch Ring oberflaeche), geprüft gegen die VOLLE Fabrik-Seite (Überschriften und Fettdruck-Anfänge). Fehlt die Seite, ist das ein Fund. */
export function scanneFabrik(wurzel: string): { funde: Fund[]; verweise: number } {
  const { lies, dateien } = besitzDateien(wurzel, ENDUNGEN, true);
  const funde: Fund[] = [];
  let verweise = 0;
  for (const { datei, text, spannen } of dateien) {
    for (const v of verweiseNachMuster(FABRIK_VERWEIS, text, datei.endsWith(".md"))) {
      if (!imSpann(spannen, v.index)) continue;
      verweise++;
      const ziel = zielVon(datei, v.pfad, lies);
      if (ziel === undefined) {
        funde.push({ datei, ziel: `${v.pfad} (fehlt)`, segment: v.segmente[0] });
        continue;
      }
      const titel = drift.abschnittTitel(lies(ziel) ?? "");
      const tot = v.segmente.find((s) => !drift.abschnittTrifft(s, titel));
      if (tot !== undefined) funde.push({ datei, ziel, segment: tot });
    }
  }
  return { funde, verweise };
}

// ── Verweise auf AGENTS.md (Kern-Block, Projekt-Block) ────────────────────────────────────────────────────────────

export type AgentsZiel = "AGENTS.md" | "CLAUDE.md" | "Projekt-Block";
/** Form des Verweises: 1 `AGENTS.md §|›`, 2 `AGENTS.md (§`, 3 `Projekt-Block ›|§`, 4 bares `§` im Absatz, 5 `AGENTS.md „X"` (auch `AGENTS.md § „X"`). */
export type AgentsForm = 1 | 2 | 3 | 4 | 5;
export interface AgentsVerweis {
  ziel: AgentsZiel;
  segmente: string[];
  form: AgentsForm;
}

const ZIELE: Record<string, AgentsZiel> = { "AGENTS.md": "AGENTS.md", "CLAUDE.md": "CLAUDE.md", "Projekt-Block": "Projekt-Block" };
const zielName = (datei: string): AgentsZiel | null => ZIELE[datei.split("/").pop() ?? ""] ?? null;

/** Gruppe 1: Dateiname, 2: Trenner, 3: quotierter Begriff, 4: freier Begriff bis zum Terminator (Absatzlogik der Formen 4 und 5). */
const ABSATZ_RE = /(?=[\w./-]+\.md|Projekt-Block|§|›)(?:([\w./-]+\.md|Projekt-Block)[\s(]*)?(§|›)?\s*(?:„([^"“\n]{2,160})["“]|([^\n,.;:()[\]+—„"“…§›]{2,160}))/g;

/** Formen 4 und 5 (absatzweise, damit ein bares `§` die Zieldatei nur aus SEINEM Absatz erbt): bares `§ X` erbt die Zieldatei des letzten `<datei> § …` im Absatz, `AGENTS.md „X"` zitiert. `…` trennt Fragmente nur im Zitat. Pur. */
export function absatzVerweise(text: string): AgentsVerweis[] {
  const verweise: AgentsVerweis[] = [];
  for (const absatz of text.split(/\n\s*\n/)) {
    let geerbt: AgentsZiel | null = null;
    for (const m of absatz.matchAll(ABSATZ_RE)) {
      const [, datei, trenner, zitat, frei] = m;
      let form: AgentsForm | null = null;
      if (trenner === "§") form = datei === undefined ? 4 : null;
      if (datei !== undefined && zitat !== undefined) form = 5; // quotiert: Muster 8 sieht `„` nicht als Abschnittstext
      if (trenner === "§" && datei !== undefined) geerbt = zielName(datei);
      if (form === null) continue;
      const ziel = form === 4 ? geerbt : zielName(datei ?? "");
      if (ziel === null) continue;
      const segmente = (zitat ?? frei ?? "")
        .split("…")
        .map((s) => s.replace(/[`*„“”"]/g, "").replace(/\s+/g, " ").trim())
        .filter((s) => s.length >= 3);
      if (segmente.length > 0) verweise.push({ ziel, segmente, form });
    }
  }
  return verweise;
}

/** Formen 1 bis 3 (Muster 8 und seine abgeleiteten Nebenformen, Code nicht maskiert). Das Ziel muss AGENTS.md, Projekt-Block oder CLAUDE.md heißen (sonst entfällt der Verweis). Pur. */
export function musterVerweise(text: string): AgentsVerweis[] {
  const tabelle: [RegExp, AgentsForm][] = [[drift.ABSCHNITT_VERWEIS, 1], [AGENTS_KLAMMER_VERWEIS, 2], [PROJEKT_BLOCK_VERWEIS, 3]];
  return tabelle.flatMap(([re, form]) =>
    verweiseNachMuster(re, text, false).flatMap((v) => {
      const ziel = zielName(v.pfad);
      return ziel === null ? [] : [{ ziel, segmente: v.segmente, form }];
    }),
  );
}

/** Der Text der „AGENTS-Vorlage des Zielprojekts“: die Vorlage, wo sie liegt; sonst der Projekt-Block der eigenen AGENTS.md; ohne beides leer (streng). Pur. */
export function vorlageOderProjektBlock(vorlageText: string | null, agentsText: string): string {
  if (vorlageText !== null) return vorlageText;
  return projektBlock(agentsText) ?? "";
}

/** Titel je Ziel: der Kern-Block, der Projekt-Block (Vorlage), ohne Ziel (CLAUDE.md gibt es nicht). */
export interface Titel {
  "AGENTS.md": string[][];
  "Projekt-Block": string[][];
  "CLAUDE.md": string[][];
}

/** Titel für einen Kern-Verweis (Kern-Block, Vorlage bzw. Projekt-Block) und für einen Verweis außerhalb des Kerns (ganze AGENTS.md). Pur. */
export function titelVon(agentsText: string, vorlageText: string | null): { kern: Titel; ganz: Titel } {
  const kernBlock = besitz.einheitText({ pfad: "AGENTS.md", block: "kern" }, agentsText) ?? "";
  const projekt = drift.abschnittTitel(vorlageOderProjektBlock(vorlageText, agentsText));
  const ganz = drift.abschnittTitel(agentsText);
  return {
    kern: { "AGENTS.md": drift.abschnittTitel(kernBlock), "Projekt-Block": projekt, "CLAUDE.md": [] },
    ganz: { "AGENTS.md": ganz, "Projekt-Block": drift.abschnittTitel(projektBlock(agentsText) ?? ""), "CLAUDE.md": [] },
  };
}

/** Meldet die Segmente der Verweise, die ihr Ziel nicht trifft: `<ziel> <segment>` je Fund. Pur. */
export function tote(verweise: AgentsVerweis[], titel: Titel): string[] {
  return verweise.flatMap((v) => v.segmente.filter((s) => !drift.abschnittTrifft(s, titel[v.ziel])).map((s) => `${v.ziel} (Form ${v.form}) ${s}`));
}

export interface AgentsScan {
  funde: string[];
  verweise: Record<AgentsForm, number>;
  dateien: Set<string>;
}

/** Wo Formen 4 und 5 gelten: Kern-Dateien (ganze Dateien) und Dateien außerhalb unter `.claude/` und `.agents/` (W8). */
const ABSATZ_ORT = /^\.(claude|agents)\//;

/**
 * Alle Verweise auf AGENTS.md und den Projekt-Block (Formen 1 bis 5, Kopfkommentar des Wächters). Kern-Einheiten: Formen 1 bis 3 in den Besitz-Spannen
 * gegen den Kern-Block bzw. die Vorlage, Formen 4 und 5 in ganzen Kern-Dateien unter `.claude/` und `.agents/`. `ausserhalb`: weitere Dateien
 * (repo-relativ; Kern-Dateien darin entfallen), alle Formen gegen die ganze AGENTS.md.
 */
export function scanneAgents(wurzel: string, ausserhalb: string[]): AgentsScan {
  const { lies, einheiten, dateien } = besitzDateien(wurzel, ENDUNGEN);
  const agents = lies("AGENTS.md") ?? "";
  const titel = titelVon(agents, lies(VORLAGE));
  const ganzeDateien = new Set(einheiten.filter(besitz.istGanzeDatei).map((e) => e.pfad));
  const scan: AgentsScan = { funde: [], verweise: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, dateien: new Set() };
  const melde = (datei: string, vs: AgentsVerweis[], t: Titel): void => {
    for (const v of vs) scan.verweise[v.form]++;
    if (vs.length > 0) scan.dateien.add(datei);
    scan.funde.push(...tote(vs, t).map((f) => `${datei}: ${f}`));
  };
  for (const { datei, text, spannen } of dateien) {
    const innen = spannen.map(([a, b]) => text.slice(a, b + 1)).join("\n");
    melde(datei, musterVerweise(innen), titel.kern);
    if (ganzeDateien.has(datei) && ABSATZ_ORT.test(datei)) melde(datei, absatzVerweise(text), titel.kern);
  }
  for (const datei of ausserhalb) {
    const text = lies(datei);
    if (text === null || ganzeDateien.has(datei) || dateien.some((d) => d.datei === datei)) continue;
    melde(datei, [...musterVerweise(text), ...absatzVerweise(text)], titel.ganz);
  }
  return scan;
}
