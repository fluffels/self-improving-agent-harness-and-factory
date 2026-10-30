#!/usr/bin/env node
/**
 * Herkunftsform für Ticketnummern (#95): stellt nackte drei- und vierstellige Ticketnummern `#<nr>` in Factory-Seiten (Markdown unter `docs/`
 * ohne Historie) und in `AGENTS.md` auf eine Form um, die ihre Herkunft nennt. Bezieher übernehmen die Seiten; eine nackte Nummer wäre dort
 * mehrdeutig (Ticket des Quellprojekts oder des eigenen Repos).
 *  - `n >= ab`  → `quellprojekt#<n>` (Ticket des Quellprojekts, dem der Harness entstammt)
 *  - `100 <= n < ab` → `factory#<n>` (Ticket des Factory-Repos)
 *  `ab` ist die erste Nummer, die das Factory-Repo noch nicht vergeben hat (höchste Issue- oder PR-Nummer + 1); Pflicht, kein Standard.
 * Unverändert bleiben: Überschriftszeilen (ihr Anker trägt die Nummer), Code-Fences und Inline-Code, GEN-Blöcke, Linkziele `](…)`, URLs und der
 * Linktext von http(s)-Links sowie schon präfixierte Formen (`owner/repo#12`, `x.md#1234`, `quellprojekt#1234`). Idempotent, Zeilenenden bleiben.
 * Bewusste Grenze: Nummern mit ein oder zwei Ziffern sind außerhalb des Umfangs (der Wächter `factory-seiten` zählt nur 3 und 4 Ziffern).
 *
 * Aufruf: node scripts/herkunftsform.mjs --ab <n> [--schreiben] [<datei> …]
 * Standard ist ein Probelauf (schreibt nichts, nennt die Zahl der Umstellungen je Datei); ohne Dateiangabe: alle Factory-Seiten und `AGENTS.md`.
 * Exit 0 = ok, 2 = falscher Aufruf.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { collectMarkdown, GEN_MARKER } from "./docs-gen/markdown.mjs";

const WURZEL = fileURLToPath(new URL("../", import.meta.url));
/** Eine nackte Ticketnummer: kein Wort-, Punkt- oder Bindestrich-Zeichen davor (sonst Präfix oder Dateianker), keine Wortzeichen dahinter. */
export const NUMMER = /(?<![\p{L}\p{N}_.-])#(\d{3,4})(?![\p{L}\p{N}_])/gu;
/** Geschützte Stücke einer Zeile (Capture-Split, ungerade Indizes): http(s)-Link samt Text, nackte URL, Inline-Code, Linkziel. */
const GESCHUETZT = /(\[[^\]\n]*\]\(<?https?:\/\/[^)\s>]*>?[^)\n]*\)|https?:\/\/\S+|`[^`\n]*`|\]\([^)\n]*\))/;
const UEBERSCHRIFT = /^\s{0,3}#{1,6}(\s|$)/;
const FENCE = /^\s{0,3}(```|~~~)/;

/** Ist `pfad` (repo-relativ, `/`) eine Factory-Seite: Markdown unter `docs/` ohne Historie (Spiegel von `istKernSeite` im Wächter `factory-seiten`). */
export function istFactorySeite(pfad) {
  if (!pfad.startsWith("docs/") || !pfad.endsWith(".md")) return false;
  if (pfad.startsWith("docs/adr/") || pfad === "docs/lessons-learned.md") return false;
  return !/^docs\/[^/]*-gegenprobe-[^/]*\.md$/.test(pfad);
}

/** Standardliste: alle Factory-Seiten unter `wurzel` (sortiert) und `AGENTS.md`. */
export function standardDateien(wurzel = WURZEL) {
  return [...collectMarkdown(wurzel, ["docs"]).filter(istFactorySeite), "AGENTS.md"];
}

/** Stellt die nackten Nummern eines Textstücks um; `zaehler` zählt die Umstellungen je Form. Pur bis auf `zaehler`. */
function stueck(text, ab, zaehler) {
  return text.replace(NUMMER, (treffer, ziffern) => {
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
 * Stellt alle nackten Ticketnummern (3 oder 4 Ziffern) eines Dokuments um. `ab` = erste Nummer des Quellprojekts (ganze Zahl ≥ 101).
 * Liefert den neuen Text und die Zahl der Umstellungen je Form.
 */
export function umschreiben(text, { ab }) {
  if (!Number.isInteger(ab) || ab < 101) throw new Error(`ab muss eine ganze Zahl ab 101 sein (erste Nummer des Quellprojekts), war: ${String(ab)}`);
  const zaehler = { quellprojekt: 0, factory: 0 };
  let fence = false;
  let gen = false;
  const zeilen = text.split(/(?<=\n)/).map((z) => {
    const art = GEN_MARKER.exec(z.replace(/\r?\n$/, ""))?.[3];
    if (art === "START") gen = true;
    const raus = gen || art !== undefined;
    if (art === "END") gen = false;
    if (raus) return z;
    if (FENCE.test(z)) {
      fence = !fence;
      return z;
    }
    return fence || UEBERSCHRIFT.test(z) ? z : zeile(z, ab, zaehler);
  });
  return { text: zeilen.join(""), ...zaehler };
}

/** Liest die Aufrufargumente; `fehler` ist gesetzt, wenn der Aufruf nicht stimmt. */
export function parseArgs(argv) {
  const out = { schreiben: false, ab: null, dateien: [], fehler: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--schreiben") out.schreiben = true;
    else if (a === "--ab") out.ab = /^\d+$/.test(argv[i + 1] ?? "") ? Number(argv[++i]) : null;
    else if (a.startsWith("--")) out.fehler = `unbekanntes Flag ${a}`;
    else out.dateien.push(a);
  }
  if (out.fehler === null && (out.ab === null || out.ab < 101)) out.fehler = "--ab <n> ist Pflicht (ganze Zahl ab 101: erste Nummer des Quellprojekts, höchste Issue-/PR-Nummer des Factory-Repos + 1)";
  return out;
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
