// Blatt-Modul ohne Importe (factory#119): Sicherheits-Module als wählbarer Besitz; die Libs für Besitz und Config nutzen sie, ein Zyklus wäre sonst unvermeidbar.
// Eine Besitz-Einheit mit Manifest-Feld `modul` wird nur an Bezieher verteilt, die den Namen in der Config-Liste `module` gewählt haben; ohne den Schlüssel gilt `MODUL_STANDARD`.
// Die erlaubten Namen sind die `modul`-Felder des Manifests (eine Quelle). Pfade der Config für Meldungen reicht der Aufrufer als `configPfad` herein.
// Modulkopien (factory#244): eine Datei am Pfad einer Moduleinheit eines nicht gewählten Moduls ist nur mit Eintrag `{ datei, grund }` in der Config-Liste `modulKopien` geduldet.
// Bekannte Grenze: geprüft wird nur die Form und die Namensmenge, nicht ob der Bezieher die Workflows des Moduls tatsächlich braucht.

/** Module, die ohne Schlüssel `module` in der Config gelten (der Stand vor factory#119). */
export const MODUL_STANDARD = ["dependabot-inbox"];
/** Form eines Modulnamens und einer CodeQL-Sprache. */
export const NAME_MUSTER = /^[a-z][a-z0-9-]*$/;
/** Modul, dessen Workflow die Sprachen der Config braucht. */
const CODEQL = "codeql";

const istListe = (w) => Array.isArray(w);

/** Ist die Einheit eine Moduleinheit? Nur ein Text in `modul` zählt; alles andere (auch `modul: 5`) behandeln Wahl und Aufteilung wie keines, die Validierung (`modulFehler`) meldet es. */
export const istModulEinheit = (e) => typeof e.modul === "string";

/** Alle Modulnamen des Manifests, sortiert und ohne Doppelte. */
export const modulNamenAus = (manifest) => [...new Set((manifest?.eintraege ?? []).filter(istModulEinheit).map((e) => e.modul))].sort();

/** Gewählte Module der Config; fehlt der Schlüssel, gilt der Standard. */
export const gewaehlteModule = (config) => (istListe(config?.module) ? config.module : MODUL_STANDARD);

/** Wird die Einheit verteilt? Ohne `modul` immer, sonst nur bei gewähltem Modul. */
export const modulGewaehlt = (e, gewaehlt) => !istModulEinheit(e) || gewaehlt.includes(e.modul);

/** Darf `von` die Einheit `nach` lokal importieren? Eine Einheit ohne `modul` importiert keine Moduleinheit, eine Moduleinheit nur ihr eigenes Modul oder Einheiten ohne `modul`. */
export const modulImportErlaubt = (von, nach) => !istModulEinheit(nach) || nach.modul === von.modul;

const namenListe = (l) => istListe(l) && l.every((n) => typeof n === "string" && NAME_MUSTER.test(n));
const SPRACHEN_FIX = 'codeql.sprachen als nicht leere Liste eintragen, z. B. ["javascript-typescript"]';

function moduleFehler(m) {
  if (m === undefined) return [];
  if (!namenListe(m)) return [`module muss eine Liste von Namen (Kleinbuchstaben, Ziffern, '-') sein\nFix: module als Liste eintragen, z. B. ["dependabot-inbox"]`];
  return new Set(m).size === m.length ? [] : ["module enthält einen Namen doppelt\nFix: den doppelten Namen entfernen"];
}

function sprachenFehler(c, m) {
  const s = c?.sprachen;
  const formFalsch = c !== undefined && (c === null || typeof c !== "object" || (s !== undefined && !namenListe(s)));
  if (formFalsch) return [`codeql.sprachen muss eine Liste von Sprachen (Kleinbuchstaben, Ziffern, '-') sein\nFix: ${SPRACHEN_FIX}`];
  if (istListe(m) && m.includes(CODEQL) && !(istListe(s) && s.length > 0)) {
    return [`Modul ${CODEQL} ist gewählt, aber codeql.sprachen fehlt oder ist leer (ein Workflow ohne Sprachen ist wertlos)\nFix: ${SPRACHEN_FIX}`];
  }
  return [];
}

const KOPIEN_FIX = 'modulKopien als Liste aus { "datei": "<repo-relativer Pfad>", "grund": "<Begründung>" } eintragen';
const textOk = (w) => typeof w === "string" && w.trim() !== "";
const posixOk = (p) => textOk(p) && !p.includes("\\") && !p.startsWith("/") && p.split("/").every((s) => s !== "" && s !== "." && s !== "..");

function kopieFehler(k, i) {
  if (k === null || typeof k !== "object" || Array.isArray(k)) return [`modulKopien[${i}] muss ein Objekt { datei, grund } sein\nFix: ${KOPIEN_FIX}`];
  const f = [];
  if (!posixOk(k.datei)) f.push(`modulKopien[${i}].datei muss ein repo-relativer POSIX-Pfad sein\nFix: ${KOPIEN_FIX}`);
  if (!textOk(k.grund)) f.push(`modulKopien[${i}].grund muss ein nicht leerer Text sein (warum das Modul bewusst fehlt und die Datei bleibt)\nFix: ${KOPIEN_FIX}`);
  return f;
}

/** Form von `modulKopien` (optional): Liste aus `{ datei, grund }`, `datei` je einmal. */
function kopienFehler(liste) {
  if (liste === undefined) return [];
  if (!istListe(liste)) return [`modulKopien muss eine Liste sein\nFix: ${KOPIEN_FIX}`];
  const fehler = liste.flatMap(kopieFehler);
  const dateien = liste.map((k) => k?.datei).filter((d) => typeof d === "string");
  const doppelt = [...new Set(dateien.filter((d, i) => dateien.indexOf(d) !== i))];
  return [...fehler, ...doppelt.map((d) => `modulKopien enthält ${d} doppelt\nFix: den doppelten Eintrag entfernen`)];
}

/** Fehler der Form von `module`, `codeql.sprachen` und `modulKopien` in der Config (leer = in Ordnung); Namen gegen das Manifest prüft `modulWahl`. */
export const modulFormFehler = (config) => [...moduleFehler(config?.module), ...sprachenFehler(config?.codeql, config?.module), ...kopienFehler(config?.modulKopien)];

/**
 * Befunde zu Dateien an Pfaden nicht gewählter Module (factory#244): `[{ pfad, art, modul? }]`. `art`: `ohne-grund` (Datei da, Modul abgewählt, nicht im Stand, nicht begründet),
 * `modul-gewaehlt`, `keine-moduleinheit`, `fehlt` (veralteter Eintrag in `modulKopien`). `gewaehlt`/`unbestimmt` wie bei `modulAufteilung`; `vorhanden(pfad)` und `imStand(einheit)` liefert der Aufrufer.
 */
export function modulKopienBefunde(manifest, { gewaehlt, unbestimmt }, { vorhanden, imStand, kopien }) {
  if (unbestimmt) return [];
  const einheiten = (manifest?.eintraege ?? []).filter(istModulEinheit);
  const begruendet = new Set(kopien.map((k) => k.datei));
  const ohneGrund = einheiten.filter((e) => !modulGewaehlt(e, gewaehlt) && vorhanden(e.pfad) && !imStand(e) && !begruendet.has(e.pfad));
  const befunde = [...new Map(ohneGrund.map((e) => [e.pfad, { pfad: e.pfad, art: "ohne-grund", modul: e.modul }])).values()];
  for (const k of kopien) {
    const art = veraltetArt(einheiten.filter((e) => e.pfad === k.datei), gewaehlt, vorhanden(k.datei));
    if (art !== null) befunde.push({ pfad: k.datei, art });
  }
  return befunde;
}

function veraltetArt(einheiten, gewaehlt, vorhanden) {
  if (einheiten.length === 0) return "keine-moduleinheit";
  if (einheiten.some((e) => modulGewaehlt(e, gewaehlt))) return "modul-gewaehlt";
  return vorhanden ? null : "fehlt";
}

/** Modulwahl gegen das Manifest: `{ gewaehlt, erlaubt, nichtGewaehlt, fehlt, fehler }`; `fehlt` heißt, der Schlüssel `module` steht nicht in der Config. */
export function modulWahl(config, manifest, { configPfad = "die Projekt-Config" } = {}) {
  const gewaehlt = gewaehlteModule(config);
  const erlaubt = modulNamenAus(manifest);
  const fehler = gewaehlt
    .filter((n) => !erlaubt.includes(n))
    .map((n) => `unbekanntes Modul '${n}' in module (${configPfad})\nFix: einen wählbaren Namen eintragen (${erlaubt.join(", ") || "keine"}) oder den Eintrag entfernen`);
  return { gewaehlt, erlaubt, nichtGewaehlt: erlaubt.filter((n) => !gewaehlt.includes(n)), fehlt: !istListe(config?.module), fehler };
}

/** Manifest-Fehler des Felds `modul` an einer Einheit (leer = gültig oder nicht gesetzt): Name nach Muster, nur an ganzen Dateien, keine Vorlage (`pflichtChecks` sind erlaubt: der Doctor verlangt sie nur, wenn die Workflow-Datei im Repo liegt), nicht im Ring `oberflaeche`. */
export function modulFehler(e) {
  // Roh prüfen, nicht über istModulEinheit: `modul: 5` ist eine Moduleinheit mit ungültigem Namen und muss gemeldet werden.
  if (e.modul === undefined) return [];
  if (typeof e.modul !== "string" || !NAME_MUSTER.test(e.modul)) return ["modul muss ein Name aus Kleinbuchstaben, Ziffern und '-' sein"];
  const f = [];
  if (e.block !== undefined || e.schluessel !== undefined) f.push("modul nur an einer ganzen Datei (kein block, kein schluessel)");
  if (e.art !== undefined) f.push("modul und art zugleich (eine Vorlage gehört keinem Modul)");
  if (e.ring === "oberflaeche") f.push("modul nicht im Ring oberflaeche");
  return f;
}

/** Kennt das Manifest wählbare Module? Ohne gibt es nichts zu wählen. */
export const manifestKenntModule = (manifest) => modulNamenAus(manifest).length > 0;

/**
 * Teilt die verteilten Einheiten nach der Modulwahl: `{ aktiv, abgewaehlt, modulIds }`. `aktiv` sind Einheiten ohne Modul und Einheiten gewählter Module (bei `unbestimmt`
 * nur die ohne Modul), `abgewaehlt` mappt Einheits-ID auf den Modulnamen eines nicht gewählten Moduls, `modulIds` sind alle Moduleinheiten. `idVon` bildet die Einheits-ID.
 */
export function modulAufteilung(verteilt, idVon, { gewaehlt, unbestimmt }) {
  const aufteilung = { aktiv: [], abgewaehlt: new Map(), modulIds: new Set() };
  for (const e of verteilt) {
    if (!istModulEinheit(e)) aufteilung.aktiv.push(e);
    else {
      aufteilung.modulIds.add(idVon(e));
      if (!unbestimmt && !modulGewaehlt(e, gewaehlt)) aufteilung.abgewaehlt.set(idVon(e), e.modul);
      else if (!unbestimmt) aufteilung.aktiv.push(e);
    }
  }
  return aufteilung;
}
