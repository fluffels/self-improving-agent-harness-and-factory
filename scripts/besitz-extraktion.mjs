// Extraktionsliste und Import-Auslegung (ADR 0022 F10, Fortschreibung factory#492): Art einer Datei laut `.factory/extraktion.json` (`artVon`), Muster-Semantik (`musterRegex`, `trifftLeitplanke`),
// Auslegung der Schutzlisten-Datei und die eine Import-Auslegung der Wächter (`importeAus`, `relativeImporte`). Die Struktur-Prüfung der Liste, Bezug und Test-Hülle sind gestrichen (kein Aufrufer). Importe: `regex-lib` (`escapeRegex`) und aus `besitz-lib` nur `normalisiereEol`; besitz-lib importiert diese Datei nie (zyklenfrei).
import { normalisiereEol } from "./besitz-lib.mjs";
import { escapeRegex } from "./regex-lib.mjs";

// ── Extraktionsliste (ADR 0022 F10) ──────────────────────────────────────────
// `.factory/extraktion.json` ordnet die Testdateien der Fabrik ein (Kern-Tests, Test-Hilfen, Fixtures); ein Eintrag hat genau eines von
// `muster` (Pfadmuster, `*` = ein Pfadsegment-Teil, nie über `/`) oder `ring` (nur `nur-factory`), dazu `art` und `grund`. Die Struktur prüft kein Wächter.

/** Pfad der Extraktionsliste. */
export const EXTRAKTION_PFAD = ".factory/extraktion.json";

const TEST_DATEI = /^test\/.*\.test\.ts$/;
/** Ist `pfad` eine Testdatei (unter `test/`, Endung `.test.ts`)? Die eine Regel für Liste und Fremd-Config-Probe. */
export const istTestDatei = (pfad) => TEST_DATEI.test(pfad);

/**
 * Hinweise auf Projektkopien von Test-Hilfen (`art: "test-hilfe"`, ohne Glob), die von der Quelle abweichen: die Hilfe wird nicht verteilt (sie zieht erst ins Factory-Repo),
 * eine veraltete Kopie im Ziel fällt sonst erst im Kern-Test auf. Zeilenenden egal; fehlt die Kopie, die Liste oder ist sie kaputt, gibt es nichts zu melden.
 */
export function testHilfeKopienAbweichend({ quelleLies, zielLies }) {
  const text = quelleLies(EXTRAKTION_PFAD);
  let eintraege;
  try {
    eintraege = text === null ? [] : JSON.parse(text).eintraege;
  } catch {
    return [];
  }
  const pfade = (Array.isArray(eintraege) ? eintraege : []).filter((e) => e?.art === "test-hilfe" && typeof e.muster === "string" && !e.muster.includes("*")).map((e) => e.muster);
  return pfade
    .filter((pfad) => {
      const ziel = zielLies(pfad);
      const quelle = quelleLies(pfad);
      return ziel !== null && quelle !== null && normalisiereEol(ziel) !== normalisiereEol(quelle);
    })
    .map((pfad) => `Projektkopie ${pfad} weicht von der Quelle ab (Test-Hilfe, nicht verteilt; von Hand abgleichen oder entfernen)`);
}

/** Regex eines Pfadmusters: `*` steht für beliebig viele Zeichen außer `/`, alles andere wörtlich (maskiert per `escapeRegex`). */
export const musterRegex = (muster) => new RegExp(`^${muster.split("*").map(escapeRegex).join("[^/]*")}$`);

/** Alle String-Muster einer Schutzlisten-Datei (`.github/protected-paths.json`): Vereinigung aller String-Arrays; `null` bei kaputtem JSON. Die eine Auslegung der Datei. */
export function schutzlistenMuster(text) {
  try {
    return Object.values(JSON.parse(text)).flatMap((v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []));
  } catch {
    return null;
  }
}

/**
 * Pflicht-Review-Liste (factory#348): die Einträge der Gruppe `pflichtReview`, die CODEOWNERS genau spiegelt. Fehlt die Gruppe,
 * spiegelt CODEOWNERS die ganze Schutzliste (`schutzlistenMuster`); kaputtes JSON oder eine Gruppe, die kein Array ist: `null`.
 */
export function pflichtReviewMuster(text) {
  try {
    const gruppe = JSON.parse(text).pflichtReview;
    if (gruppe === undefined) return schutzlistenMuster(text);
    return Array.isArray(gruppe) ? gruppe.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/**
 * Trifft `pfad` (Repo-relativ, `/`) eines der Muster? CODEOWNERS-Teilmenge: führendes `/` verankert an der Wurzel;
 * ohne `/` (außer am Ende) auf jeder Ebene; `/` am Ende = Verzeichnis-Präfix; `*` = beliebige Zeichen außer `/`;
 * ein Muster, das ein Elternverzeichnis trifft, trifft alle Dateien darin.
 */
export function trifftLeitplanke(pfad, muster) {
  const teile = String(pfad).split("/").filter(Boolean);
  return muster.some((roh) => {
    const verzeichnis = roh.endsWith("/");
    const kern = roh.replace(/^\//, "").replace(/\/$/, "");
    const segmente = kern.split("/").map(musterRegex);
    const verankert = roh.startsWith("/") || kern.includes("/");
    const starts = verankert ? [0] : teile.map((_, i) => i);
    return starts.some((start) => {
      const rest = teile.slice(start);
      if (rest.length < segmente.length + (verzeichnis ? 1 : 0)) return false;
      return segmente.every((re, i) => re.test(rest[i]));
    });
  });
}

// Vorkompilierte Muster je Liste (Schlüssel: das Listen-Objekt); ändert sich die Eintragsliste (anderes Array oder andere Länge), wird neu kompiliert.
const KOMPILIERT = new WeakMap();
const kompilierteMuster = (liste) => {
  const eintraege = liste.eintraege ?? [];
  const alt = KOMPILIERT.get(liste);
  if (alt && alt.eintraege === eintraege && alt.laenge === eintraege.length) return alt.muster;
  const muster = eintraege.filter((x) => typeof x.muster === "string").map((x) => ({ re: musterRegex(x.muster), art: x.art }));
  KOMPILIERT.set(liste, { eintraege, laenge: eintraege.length, muster });
  return muster;
};

/** Art der Datei laut Muster-Einträgen der Liste (`null`: nicht eingeordnet); die Muster sind je Liste einmal kompiliert. */
export function artVon(liste, pfad) {
  return kompilierteMuster(liste).find((m) => m.re.test(pfad))?.art ?? null;
}

// ── Import-Auslegung ────────────────────────────────────────────────────────

/**
 * Alle Importspezifizierer eines Quelltexts (ohne Auflösung, mit `node:*` und Paketnamen): statische `import`/`export … from` (auch Side-Effect), dynamisches `import` mit Literal,
 * `require` mit Literal, `createRequire` mit anschließendem Aufruf und die großzügige Aufruf-Form (schließende Klammer, dann Literal in Klammern; fail-closed). Nicht erkannt: ein dynamischer Pfad (`require(pfad)`).
 */
export function importeAus(text) {
  return [
    ...new Set([
      ...[...text.matchAll(/^\s*(?:import|export)\s+(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/gm)].map((m) => m[1]),
      ...[...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\s+["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\bcreateRequire\([^)]*\)\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
      ...[...text.matchAll(/\)\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ]),
  ];
}

/** Relative Spezifizierer (`./`, `../`) eines Quelltexts. Grenze (fail-closed, keine Kommentar-Erkennung): ein require-Aufruf mit relativem Pfad in einem Kommentar zählt wie ein echter Import. */
export const relativeImporte = (text) => [...new Set(importeAus(text).filter((s) => /^\.{1,2}\//.test(s)))];
