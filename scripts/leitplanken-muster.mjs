// Blatt-Modul, keine lokalen Imports: die EINE Quelle der Muster, mit denen der Fitness-Anteil von harness-approval Texte scannt
// (factory#149): der Kern-Wächter test/harness/harness-approval.test.ts, der Scan-Helfer test/harness/repo-texte.ts und der
// Doctor-Punkt `Leitplanken-Quelle` (harness-doctor-dateien.mjs) lesen dieselben Definitionen. Dieses Modul ist selbst Ankerdatei
// (`istAnkerDatei`) und vom Scan der abgelösten Begriffe und der Kriterien ausgenommen: es trägt die Muster zwangsläufig im Wortlaut.
// Grenze: die Fundfunktionen prüfen Text-Muster, nicht deren Bedeutung; ein umformulierter Begriff bleibt unsichtbar.

/**
 * Begriffe der abgelösten Label-Mechanik (ADR 0014): der frühere CI-Riegel samt Label, seine Job-Bezeichnung (Required-Check-Kontext
 * im Ruleset) und der Pflicht-Begriff. In ADRs bleibt die Historie stehen; sonst darf keine versionierte Datei sie mehr tragen.
 */
export const ABGELOEST = [
  /maintainer-approved/i,
  /gate-change-guard/i,
  /Gate-Config-Aenderungsschutz/i,
  /Label-Pflicht/i,
  /Label selbst/i,
  /bis die Maintainerin entschieden hat/i,
  /legt die Maintainerin fest/i,
  /Optik-Abstimmung/i,
  /Optik[^.\n]{0,60}(per|mit|braucht)[^.\n]{0,20}Rückfrage/i,
  /(Optik|Stil|Look)[^.\n]{0,40}mit der Maintainerin abstimmen/i,
  /(was|wie) in (\*\*)?einen(\*\*)? PR pass(t|en)/i,
  /Rest und neue Befunde ins nächste Sammelticket/i,
  /zweite Hälfte[^.\n]{0,80}(Sammelticket|übertrag)/i,
  /erste Hälfte[^.\n]{0,80}(PR|Sammelticket)/i,
];

/** Die Kriterien des Pflicht-Stopps stehen nur in AGENTS.md; alle anderen Stellen verweisen darauf (quellprojekt#1311). */
export const KRITERIEN = [/Ruleset\/Secrets\/Repo-Einstellungen/, /am Ruleset, an Secrets/, /Löschen, Ruleset/];

/**
 * Marker im Dateikopf jedes Wächter-Tests (quellprojekt#1165). Erst er macht den Ordner prüfbar: ohne ihn hieße „vier Einträge vergessen“
 * nur noch „den Ordner vergessen“. Erkannt nur als eigene Kommentar-Zeile, damit eine Erwähnung im Fließtext oder Code nicht zählt.
 * Grenze: ein Wächter, der weder Marker noch Ordner bekommt, bleibt unsichtbar.
 */
export const WAECHTER_MARKER = /^\s*(?:\/\*+|\*)?\s*@harness-waechter(?![\w-])/m;

/** Der geschützte Ordner der Wächter-Tests (Präfix, kein Glob: `normalizeProtected` kürzt jedes Glob ab dem `*`). */
export const WAECHTER_ORDNER = "test/harness/";

/**
 * Bewusst tiefen-unabhängige Einträge (quellprojekt#1168): ohne führenden `/` schützen sie die Datei auf JEDER Ebene (CODEOWNERS und Substring-Abgleich).
 * Jede modul-lokale AGENTS.md ist eine Agenten-Anweisung und damit Leitplanke. Geschlossene Liste: jeder andere unverankerte Eintrag ist ein Fehler.
 */
export const TIEFENUNABHAENGIG = ["AGENTS.md"];

/** Dateiendungen, die die Text-Wächter scannen. */
export const SCAN_ENDUNGEN = /\.(md|js|mjs|cjs|ts|json|yml|yaml)$/;

/** Der Kern-Wächter mit den Ankerlisten (Pfad im Quell-Repo und in jedem Bezieher, dem der Sync ihn liefert). */
export const KERN_WAECHTER = "test/harness/harness-approval.test.ts";

/** Dieses Modul selbst. */
export const MUSTER_MODUL = "scripts/leitplanken-muster.mjs";

/** Projekt-Teil der Stopps-Prüfung, falls ein Projekt einen mitbringt: `test/harness/<name>stopps-projekt.test.ts` (neutrales Muster). */
export const PROJEKT_TEIL_MUSTER = /^test\/harness\/[\w-]*stopps-projekt\.test\.ts$/;

/** Dateien mit den Ankerlisten der festen Stopps (Kern-Wächter, dieses Modul, Projekt-Teil): vom Kriterien-Scan ausgenommen. */
export const istAnkerDatei = (pfad) => pfad === KERN_WAECHTER || pfad === MUSTER_MODUL || PROJEKT_TEIL_MUSTER.test(pfad);

/**
 * Der Agenten-Kontext: Dateien, die ein Agent liest oder ausführt und in denen eine Anleitung stehen kann (Doku, Prompts,
 * Skills, Workflows, Hooks, Skripte, Wächter). Alle `*.md` überall (auch modul-lokale AGENTS.md), die Wurzeldateien und
 * die Harness-Ordner. Nicht dazu: Produktcode (`src/`), Produkttests (`test/` außer `test/harness/`; Grenze wie `.github/protected-paths.json`), Assets, Lockfile.
 */
export const AGENTEN_KONTEXT = (pfad) => {
  if (pfad === "package-lock.json") return false;
  return /\.md$/.test(pfad) || !pfad.includes("/") || /^(?:docs|\.claude|\.agents|\.github|\.githooks|scripts|test\/harness)\//.test(pfad);
};

/** Eine gescannte Datei: Agenten-Kontext mit Scan-Endung (oder CODEOWNERS). */
export const istScanDatei = (pfad) => AGENTEN_KONTEXT(pfad) && (SCAN_ENDUNGEN.test(pfad) || pfad === ".github/CODEOWNERS");

/**
 * Warum lässt sich aus diesen Mustern KEINE Alternation bauen? Die Alternation über `source` verliert Flags und
 * nummeriert Gruppen um. Meldet abweichende Flags, Rückverweise (`\1`–`\9`, `\k<name>`) und Muster, die sich nicht
 * mit den Flags des ersten Musters bauen lassen. Leere Liste: kombinierbar.
 */
export function vorfilterProbleme(muster) {
  const probleme = [];
  if (muster.length === 0) return ["keine Muster"];
  const flags = muster[0].flags;
  for (const m of muster) {
    // `g`/`y` machen `.test()` zustandsbehaftet (lastIndex): der Vorfilter könnte bei der nächsten Datei falsch-negativ werden.
    if (/[gy]/.test(m.flags)) probleme.push(`Flag g/y zustandsbehaftet: ${String(m)}`);
    if (m.flags !== flags) probleme.push(`Flags weichen ab: ${String(m)} (erwartet "${flags}")`);
    // Rückverweis nur, wenn der Backslash nicht selbst maskiert ist (gerade Zahl Backslashes davor).
    if (/(?<!\\)(?:\\\\)*\\(?:[1-9]|k<)/.test(m.source)) probleme.push(`Rückverweis im Muster: ${String(m)}`);
  }
  if (probleme.length === 0) {
    try {
      new RegExp(muster.map((m) => m.source).join("|"), flags);
    } catch (e) {
      probleme.push(`Alternation nicht baubar: ${e.message}`);
    }
  }
  return probleme;
}

/** Eine Alternation über alle Muster, oder `null`, wenn sie sich nicht sicher bauen lässt (dann alle Muster einzeln laufen lassen). */
export function baueVorfilter(muster) {
  if (vorfilterProbleme(muster).length > 0) return null;
  try {
    return new RegExp(muster.map((m) => m.source).join("|"), muster[0].flags);
  } catch {
    return null;
  }
}

const ABGELOEST_VORFILTER = baueVorfilter(ABGELOEST);
const KRITERIEN_VORFILTER = baueVorfilter(KRITERIEN);

/** Fundstellen der Muster in `dateien` (Pfad → Text), ohne die Pfade, die `ausnahme` ausnimmt; der Vorfilter spart die Einzelläufe. */
function fundstellen(dateien, muster, vorfilter, ausnahme) {
  const funde = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (ausnahme(pfad)) continue;
    if (vorfilter && !vorfilter.test(inhalt)) continue;
    for (const m of muster) if (m.test(inhalt)) funde.push(`${pfad}: ${String(m)}`);
  }
  return funde;
}

/** Fundstellen der abgelösten Begriffe; ADRs (Historie), der Kern-Wächter und dieses Modul zählen nicht (der Projekt-Teil schon). */
export const abgeloesteFundstellen = (dateien) =>
  fundstellen(dateien, ABGELOEST, ABGELOEST_VORFILTER, (p) => p.startsWith("docs/adr/") || p === KERN_WAECHTER || p === MUSTER_MODUL);

/** Fundstellen der ausgeschriebenen Kriterienliste außerhalb von AGENTS.md; ADRs (Historie) und die Ankerdateien zählen nicht. */
export const kriterienKopien = (dateien) =>
  fundstellen(dateien, KRITERIEN, KRITERIEN_VORFILTER, (p) => p === "AGENTS.md" || p.startsWith("docs/adr/") || istAnkerDatei(p));

/** Eine `*.test.ts` unter `test/` (verankert, beliebig tief; `src/test/x.test.ts` und `x.test.tsx` zählen nicht). */
export const istTestDatei = (pfad) => /^test\/.*\.test\.ts$/.test(pfad);

/** Wächter-Tests (Marker als eigene Kommentarzeile) unter `test/`, die außerhalb des geschützten Ordners liegen. */
export function waechterAusserhalb(dateien) {
  return Object.entries(dateien)
    .filter(([pfad, inhalt]) => istTestDatei(pfad) && !pfad.startsWith(WAECHTER_ORDNER) && WAECHTER_MARKER.test(inhalt))
    .map(([pfad]) => `${pfad}: trägt @harness-waechter, liegt aber außerhalb von ${WAECHTER_ORDNER} (ungeschützt)`);
}
