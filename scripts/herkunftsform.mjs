#!/usr/bin/env node
/**
 * Herkunftsform für Ticketnummern (#95): stellt nackte Ticketnummern `#<nr>` mit ein bis vier Ziffern in Factory-Seiten (Markdown unter `docs/`
 * ohne Historie), Agententexten (`.claude/agents`), Skill-Quellen (`.agents/skills`) und in `AGENTS.md` auf eine Form um, die ihre Herkunft nennt. Bezieher übernehmen die Seiten; eine nackte Nummer wäre dort
 * mehrdeutig (Ticket des Quellprojekts oder des eigenen Repos).
 *  - `n >= ab`  → `quellprojekt#<n>` (Ticket des Quellprojekts, dem der Harness entstammt)
 *  - `n < ab` → `factory#<n>` (Ticket des Factory-Repos; bis 99 nur die Kurzform, siehe unten)
 *  `ab` ist die erste Nummer, die das Factory-Repo noch nicht vergeben hat (höchste Issue- oder PR-Nummer + 1); Pflicht, kein Standard.
 * Unverändert bleiben: Überschriftszeilen (ihr Anker trägt die Nummer), Code-Fences und Inline-Code, GEN-Blöcke, Linkziele `](…)`, URLs und der
 * Linktext von http(s)-Links sowie schon präfixierte Formen (`owner/repo#12`, `x.md#1234`, `quellprojekt#1234`). Idempotent, Zeilenenden bleiben.
 * Migrationswerkzeug: die Schwelle `ab` ist nur zum Zeitpunkt des Laufs eindeutig; neue Nummern schreibt man von Hand in der richtigen Form (der Wächter meldet sie).
 * Nummern mit ein oder zwei Ziffern gehören fast immer dem Factory-Repo (`factory#`); Nummern des Quellprojekts schreibt man vorher von Hand als `quellprojekt#<n>`.
 * Bewusste Grenze: Überschriften und Code bleiben unberührt (auch für die Kurzform); `NUMMER` (3 und 4 Ziffern) zählt der Wächter `factory-seiten` gegen eine Baseline,
 * `KURZE_NUMMER` (1 und 2 Ziffern) ohne Baseline und außerhalb von Überschriften und Code.
 *
 * Aufruf: node scripts/herkunftsform.mjs --ab <n> [--schreiben] [<datei> …]
 * Standard ist ein Probelauf (schreibt nichts, nennt die Zahl der Umstellungen je Datei); ohne Dateiangabe: alle Factory-Seiten, Agententexte, Skill-Quellen und `AGENTS.md`.
 * Exit 0 = ok, 2 = falscher Aufruf.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { QUELL_VERZEICHNIS } from "./skill-pfade.mjs";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { collectMarkdown, fenceMaske, GEN_MARKER } from "./docs-gen/markdown.mjs";
import { flagsLesen } from "./flag-lib.mjs";

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
/** Eine nackte Ticketnummer: kein Wort-, Punkt- oder Bindestrich-Zeichen davor (sonst Präfix oder Dateianker), keine Wortzeichen dahinter. */
export const NUMMER = /(?<![\p{L}\p{N}_.-])#(\d{3,4})(?![\p{L}\p{N}_])/gu;
/** Dieselbe Form mit ein oder zwei Ziffern: der Wächter `factory-seiten` verbietet sie ohne Baseline (außerhalb von Überschriften und Code). */
export const KURZE_NUMMER = /(?<![\p{L}\p{N}_.-])#(\d{1,2})(?![\p{L}\p{N}_])/gu;
/** Alle Längen (1 bis 4 Ziffern), was die Umstellung ersetzt. */
const ALLE_NUMMERN = /(?<![\p{L}\p{N}_.-])#(\d{1,4})(?![\p{L}\p{N}_])/gu;
/** Geschützte Stücke einer Zeile (Capture-Split, ungerade Indizes): http(s)-Link samt Text, nackte URL, Inline-Code, Linkziel. */
const GESCHUETZT = /(\[[^\]\n]*\]\(<?https?:\/\/[^)\s>]*>?[^)\n]*\)|https?:\/\/\S+|`[^`\n]*`|\]\([^)\n]*\))/;
const UEBERSCHRIFT = /^\s{0,3}#{1,6}(\s|$)/;

/** Ist `pfad` (repo-relativ, `/`) eine Factory-Seite: Markdown unter `docs/` ohne Historie (Spiegel von `istKernSeite` im Wächter `factory-seiten`). */
// (Agententexte und Skill-Quellen kommen in `standardDateien` hinzu.)
export function istFactorySeite(pfad) {
  if (!pfad.startsWith("docs/") || !pfad.endsWith(".md")) return false;
  if (pfad.startsWith("docs/adr/") || pfad === "docs/lessons-learned.md") return false;
  return !/^docs\/[^/]*-gegenprobe-[^/]*\.md$/.test(pfad);
}

/** Standardliste: alle Factory-Seiten, Agententexte (`.claude/agents`) und Skill-Quellen (`.agents/skills`, nicht die Zeiger unter `.claude/skills/`) unter `wurzel` sowie `AGENTS.md`. */
export function standardDateien(wurzel = WURZEL) {
  return [...collectMarkdown(wurzel, ["docs"]).filter(istFactorySeite), ...collectMarkdown(wurzel, [".claude/agents", QUELL_VERZEICHNIS]), "AGENTS.md"];
}

/** Stellt die nackten Nummern eines Textstücks um; `zaehler` zählt die Umstellungen je Form. Pur bis auf `zaehler`. */
function stueck(text, ab, zaehler) {
  return text.replace(ALLE_NUMMERN, (treffer, ziffern) => {
    if (Number(ziffern) >= ab) {
      zaehler.quellprojekt += 1;
      return `quellprojekt${treffer}`;
    }
    zaehler.factory += 1;
    return `factory${treffer}`;
  });
}

/** Eine Textzeile: geschützte Stücke bleiben, der Rest wird umgestellt. */
function zeile(text, ab, zaehler) {
  return text
    .split(GESCHUETZT)
    .map((s, i) => (i % 2 === 1 ? s : stueck(s, ab, zaehler)))
    .join("");
}

/**
 * Stellt alle nackten Ticketnummern (1 bis 4 Ziffern) eines Dokuments um. `ab` = erste vom Factory-Repo noch nicht vergebene Nummer (ganze Zahl ≥ 101).
 * Liefert den neuen Text und die Zahl der Umstellungen je Form.
 */
export function umschreiben(text, { ab }) {
  if (!Number.isInteger(ab) || ab < 101) throw new Error(`ab muss eine ganze Zahl ab 101 sein (erste vom Factory-Repo noch nicht vergebene Nummer), war: ${String(ab)}`);
  const zaehler = { quellprojekt: 0, factory: 0 };
  let gen = false;
  const stuecke = text.split(/(?<=\n)/);
  const imFence = fenceMaske(stuecke.map((z) => z.replace(/\r?\n$/, "")));
  const zeilen = stuecke.map((z, i) => {
    const art = GEN_MARKER.exec(z.replace(/\r?\n$/, ""))?.[3];
    if (art === "START") gen = true;
    const raus = gen || art !== undefined;
    if (art === "END") gen = false;
    return raus || imFence[i] || UEBERSCHRIFT.test(z) ? z : zeile(z, ab, zaehler);
  });
  return { text: zeilen.join(""), ...zaehler };
}

/** Liest die Aufrufargumente; `fehler` ist gesetzt, wenn der Aufruf nicht stimmt. */
export function parseArgs(argv) {
  const r = flagsLesen(argv, { ab: { type: "string" }, schreiben: { type: "boolean" } }, { positionale: true, pflicht: ["ab"] });
  const ab = /^\d+$/.test(r.werte.ab ?? "") ? Number(r.werte.ab) : null;
  const ungueltig = r.fehler === null && (ab === null || ab < 101) ? "--ab <n> muss eine ganze Zahl ab 101 sein (erste vom Factory-Repo noch nicht vergebene Nummer: höchste Issue-/PR-Nummer + 1)" : null;
  return { schreiben: r.werte.schreiben === true, ab, dateien: r.positionale, fehler: r.fehler?.text ?? ungueltig };
}

/** CLI: Probelauf oder Schreiben; gibt den Exit-Code zurück. */
export function main(argv = process.argv.slice(2), wurzel = WURZEL) {
  const a = parseArgs(argv);
  if (a.fehler) {
    console.error(`✖ herkunftsform: ${a.fehler}`);
    return 2;
  }
  let summe = 0;
  for (const pfad of a.dateien.length > 0 ? a.dateien : standardDateien(wurzel)) {
    const voll = a.dateien.length > 0 ? pfad : wurzel + pfad;
    const r = umschreiben(readFileSync(voll, "utf8"), { ab: a.ab });
    const n = r.quellprojekt + r.factory;
    if (n === 0) continue;
    summe += n;
    if (a.schreiben) writeFileSync(voll, r.text);
    console.log(`${pfad}: ${r.quellprojekt}x quellprojekt#, ${r.factory}x factory#`);
  }
  console.log(`${a.schreiben ? "umgestellt" : "Probelauf (nichts geschrieben)"}: ${summe} Nummern`);
  return 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
