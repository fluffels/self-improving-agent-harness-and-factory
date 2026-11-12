// Gate-Befehle (factory#182): Block `befehle` der Projekt-Config und der Läufer `node scripts/gate-befehl.mjs <name>`.
// Die Sammelbefehle (Installation, verify, verify:kompakt, verify:changed, Abdeckung) stehen je Projekt in der Config;
// pre-push, CI und alle Laufzeiten rufen denselben Läufer, damit Kern-Texte kein Build-Werkzeug nennen. Ohne Block gelten die npm-Standards.
// Lib ohne Direktaufruf-Guard; importiert nur flag-lib und quellwurzeln-lib (beide ohne Config-Lib, kein Zyklus; der Lader wird injiziert).
// testGezielt (L8): weicht `befehle.testGezielt` vom Standard ab und nennt `struktur.endungen` eine Endung außerhalb von JS/TS, teilt `laeuferAufteilung` die Pfade auf: JS/TS-Dateien außerhalb der Quellwurzeln
// (oder mit einer Endung, die nicht in `struktur.endungen` steht) gehen an den Standard `npx vitest run`, Dateien mit Endung aus `struktur.endungen` und Ordner an den Projekt-Befehl, alles andere endet mit Exit 2.
// Grenze: die Aufteilung kennt nur Endung und Quellwurzel, keine Test-Konvention; ein JS/TS-Test in einer Quellwurzel mit `.ts` in `struktur.endungen` bleibt beim Projekt-Befehl.
// Grenze: endet der Befehl selbst mit 2, ist das vom Aufruf-Fehler nur an der Fix-Zeile auf stderr zu unterscheiden.
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { quellenAus, STANDARD_ENDUNGEN, wurzelPraefixe } from "./quellwurzeln-lib.mjs";

export const STANDARD_BEFEHLE = Object.freeze({
  install: "npm ci",
  verify: "npm run verify",
  verifyKompakt: "npm run verify:kompakt",
  verifyChanged: "npm run verify:changed",
  coverage: "npm run test:coverage",
  testGezielt: "npx vitest run",
  mutation: null, // opt-in (factory#299): null = nicht eingerichtet
  e2e: null, // opt-in (factory#246): null = nicht eingerichtet; gehört zum Block `e2e` der Config
});

export const GATE_BEFEHL_NAMEN = Object.freeze(Object.keys(STANDARD_BEFEHLE));

/** Art des Prüflaufs je Gate-Befehl (Werkzeugmessung zählt `voll`/`gezielt`; null = kein Prüflauf); Schlüssel = `GATE_BEFEHL_NAMEN`. */
export const PRUEFLAUF_ART = Object.freeze({ install: null, verify: "voll", verifyKompakt: "voll", verifyChanged: "gezielt", coverage: null, testGezielt: null, mutation: null, e2e: null });

/** Adapter-Vertrag Mutation (factory#299): Umgebungsvariablen, über die `node scripts/mutation-lauf.mjs` Eingabe (Zeilenbereiche als JSON) und Ausgabe (Bericht) übergibt. */
export const MUTATION_UMGEBUNG = Object.freeze({ bereiche: "FACTORY_MUTATION_BEREICHE", bericht: "FACTORY_MUTATION_BERICHT" });
const MUTATION_NAME = "mutation";

/** Adapter-Vertrag e2e-Gate-Profil (factory#246): Umgebungsvariable, über die die CI-Matrix den Browser-Namen an `befehle.e2e` übergibt. */
export const E2E_UMGEBUNG = Object.freeze({ browser: "FACTORY_E2E_BROWSER" });

/** Der einzige Name, der Pfade annimmt; sie werden in doppelten Anführungszeichen an die Befehlszeile angehängt. */
export const PFAD_NAME = "testGezielt";
/** Erlaubte Zeichen eines angehängten Pfads (keine Shell-Metazeichen, kein Leerzeichen). */
const PFAD_MUSTER = /^[\w./\\:@+=,-]+$/;

/** Anfang der Zeile, die der Gate-Befehl vor dem Lauf auf stderr druckt (`▶ Gate-Befehl <name>: <befehl>`); gate-fundquote erkennt Läufe daran. */
export const KOPF_PRAEFIX = "▶ Gate-Befehl ";

/** Flag, das nur die Befehlszeile ausgibt, statt sie zu starten. */
export const ZEIGEN_FLAG = "--zeigen";

const istName = (name) => typeof name === "string" && Object.hasOwn(STANDARD_BEFEHLE, name);
const istBefehl = (w) => typeof w === "string" && w.trim() !== "";

/** Pur: Formfehler des optionalen Blocks `befehle` (leer = gültig, auch ohne Block). */
export function pruefeBefehle(block) {
  if (block === undefined) return [];
  if (block === null || typeof block !== "object" || Array.isArray(block)) return ["befehle muss ein Objekt (Name → Befehlszeile) sein"];
  return Object.keys(block).flatMap((k) => {
    if (!istName(k)) return [`befehle.${k} ist kein bekannter Name (erlaubt: ${GATE_BEFEHL_NAMEN.join(", ")})`];
    if (!istBefehl(block[k])) return [`befehle.${k} muss eine nicht-leere Befehlszeile (String) sein`];
    if (/[\r\n]/.test(block[k])) return [`befehle.${k} muss eine einzelne Zeile sein (kein Zeilenumbruch)`];
    return [];
  });
}

/** Pur: wirksamer Befehl zu `name`; unbekannter Name oder kaputter Block wirft mit Fix-Zeile. */
export function befehlAus(config, name) {
  if (!istName(name)) throw new Error(`unbekannter Gate-Befehl „${name}“.\nFix: einen Namen aus ${GATE_BEFEHL_NAMEN.join(", ")} angeben.`);
  const block = config?.befehle;
  const fehler = pruefeBefehle(block);
  if (fehler.length > 0) throw new Error(`befehle in der Projekt-Config ungültig: ${fehler.join("; ")}\nFix: den Block befehle der Projekt-Config korrigieren.`);
  return block?.[name] ?? STANDARD_BEFEHLE[name];
}

/** Startet die Befehlszeile als String in der Shell (Windows: sonst scheitert npm.cmd); liefert den Exit-Code (fail-closed: Signal und Startfehler = 1). */
export function fuehreAus(befehl, { spawn, cwd, err }) {
  const r = spawn(befehl, { shell: true, stdio: "inherit", cwd });
  if (r.error) {
    err(`✖ Gate-Befehl konnte nicht starten: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

/** Aufruf-Fehler: Meldung samt Fix-Zeile auf stderr, Exit 2. */
function aufrufFehler(err, text) {
  err(text);
  return AUFRUF_EXIT;
}

/** Pur: Fehlertext, wenn `mutation` ohne beide Vertrags-Umgebungsvariablen gestartet würde (das Werkzeug mutierte sonst das ganze Projekt), sonst null. */
function mutationUmgebungFehler(name, env) {
  if (name !== MUTATION_NAME || Object.values(MUTATION_UMGEBUNG).every((v) => env[v])) return null;
  return `${name} braucht die Umgebungsvariablen ${Object.values(MUTATION_UMGEBUNG).join(" und ")} (sonst mutiert das Werkzeug das ganze Projekt).\nFix: über node scripts/mutation-lauf.mjs aufrufen.`;
}

/** Pur: liest Name, Pfade und `--zeigen` aus `argv`; Rückgabe `{ name, pfade, nurZeigen }` oder `{ meldung }` (Aufruf-Fehler samt Fix-Zeile). */
function argumenteLesen(argv) {
  const { werte, positionale, fehler } = flagsLesen(argv, { [ZEIGEN_FLAG.slice(2)]: { type: "boolean" } }, { positionale: true });
  const hinweis = `Fix: node scripts/gate-befehl.mjs <name> [${ZEIGEN_FLAG}] mit name aus ${GATE_BEFEHL_NAMEN.join(", ")}`;
  if (fehler) return { meldung: `${fehler.text}\n${hinweis}` };
  const name = positionale[0];
  const mitPfaden = name === PFAD_NAME;
  if (!mitPfaden && positionale.length !== 1) return { meldung: `genau ein Gate-Befehl-Name erwartet (Pfade nimmt nur ${PFAD_NAME} an).\n${hinweis}` };
  const pfade = mitPfaden ? positionale.slice(1) : [];
  if (mitPfaden && pfade.length === 0) return { meldung: `${PFAD_NAME} braucht mindestens einen Pfad.\nFix: node scripts/gate-befehl.mjs ${PFAD_NAME} <datei> [<datei> …]` };
  const schlecht = pfade.find((x) => !PFAD_MUSTER.test(x));
  if (schlecht !== undefined) return { meldung: `Pfad „${schlecht}“ enthält unerlaubte Zeichen (erlaubt: Buchstaben, Ziffern, _ . / \\ : @ + = , -).\nFix: einen einfachen Pfad ohne Leerzeichen und Shell-Zeichen angeben.` };
  return { name, pfade, nurZeigen: Boolean(werte[ZEIGEN_FLAG.slice(2)]) };
}

const MIT_ENDUNG = (pfad, endungen) => endungen.some((e) => pfad.endsWith(e));

/** Pur: der Pfad relativ zu `cwd` in POSIX-Schreibweise (Backslashes → /, absoluter Pfad unter `cwd` gekürzt). */
function relativZu(pfad, cwd) {
  const p = pfad.replace(/\\/g, "/");
  const wurzel = `${String(cwd).replace(/\\/g, "/").replace(/\/$/, "")}/`;
  return p.startsWith(wurzel) ? p.slice(wurzel.length) : p;
}

/**
 * Pur: teilt die Pfade von `testGezielt` auf die Läufer auf (L8). Rückgabe `{ laeufe: [{ befehl, pfade }] }` (Projekt-Befehl zuerst, dann Vitest; leere Läufer entfallen)
 * oder `{ meldung }` (Pfad ohne passenden Läufer, Aufruf-Fehler samt Fix-Zeile). Ohne abweichenden Befehl oder ohne Endung außerhalb von JS/TS in `struktur.endungen` ein Lauf mit allen Pfaden.
 * Wirft die Fehler von `quellenAus` (fehlende `struktur.quelle`).
 */
export function laeuferAufteilung(pfade, config, cwd) {
  const projekt = befehlAus(config, PFAD_NAME);
  const endungen = config?.struktur?.endungen;
  const fremd = Array.isArray(endungen) && endungen.some((e) => !STANDARD_ENDUNGEN.includes(e));
  if (!fremd || projekt === STANDARD_BEFEHLE[PFAD_NAME]) return { laeufe: [{ befehl: projekt, pfade }] };
  const { wurzeln } = quellenAus(config);
  const projektPfade = [];
  const vitestPfade = [];
  for (const pfad of pfade) {
    const rel = relativZu(pfad, cwd);
    const jsTs = MIT_ENDUNG(rel, STANDARD_ENDUNGEN);
    const eigene = MIT_ENDUNG(rel, endungen);
    if (jsTs && (!eigene || wurzelPraefixe(rel, wurzeln).length === 0)) vitestPfade.push(pfad);
    else if (eigene || !rel.split("/").at(-1).includes(".")) projektPfade.push(pfad);
    else return { meldung: `Pfad „${pfad}“ hat keinen passenden Läufer (Endung weder in struktur.endungen noch JS/TS).\nFix: den Test mit seinem eigenen Läufer starten oder die Endung in struktur.endungen eintragen.` };
  }
  return { laeufe: [{ befehl: projekt, pfade: projektPfade }, { befehl: STANDARD_BEFEHLE[PFAD_NAME], pfade: vitestPfade }].filter((l) => l.pfade.length > 0) };
}

/** Befehlszeile samt in doppelten Anführungszeichen angehängten Pfaden. */
const mitPfaden = (befehl, pfade) => (pfade.length > 0 ? `${befehl} ${pfade.map((x) => `"${x}"`).join(" ")}` : befehl);

/** Startet alle Läufe (keiner bricht die anderen ab) und gibt den ersten Exit ≠ 0 zurück, sonst 0. */
function fuehreLaeufeAus(name, zeilen, { spawn, cwd, err }) {
  let exit = 0;
  for (const z of zeilen) {
    err(`${KOPF_PRAEFIX}${name}: ${z}`);
    const code = fuehreAus(z, { spawn, cwd, err });
    if (exit === 0) exit = code;
  }
  return exit;
}

/** Pur: die zu startenden Befehlszeilen: `{ befehl, zeilen }` (`befehl` null = nicht eingerichtet) oder `{ meldung }`; wirft die Fehler von `befehlAus` und `quellenAus`. */
function zeilenAus(name, pfade, config, cwd) {
  const befehl = befehlAus(config, name);
  if (befehl === null || pfade.length === 0) return { befehl, zeilen: [befehl] };
  const { laeufe, meldung } = laeuferAufteilung(pfade, config, cwd);
  return meldung === undefined ? { befehl, zeilen: laeufe.map((l) => mitPfaden(l.befehl, l.pfade)) } : { meldung };
}

/** Einstieg: `<name> [--zeigen]` (`testGezielt` zusätzlich mit Pfaden); gibt den Exit-Code zurück (der Einstieg setzt `process.exitCode`). */
export function cli(argv, { lade, spawn, cwd, out = console.log, err = console.error, env = process.env }) {
  const { meldung, name, pfade, nurZeigen } = argumenteLesen(argv);
  if (meldung !== undefined) return aufrufFehler(err, meldung);
  let aufloesung;
  try {
    if (!istName(name)) befehlAus({}, name);
    aufloesung = zeilenAus(name, pfade, lade(), cwd);
  } catch (e) {
    return aufrufFehler(err, e.message);
  }
  if (aufloesung.meldung !== undefined) return aufrufFehler(err, aufloesung.meldung);
  const { befehl, zeilen } = aufloesung;
  if (befehl === null) {
    out(`${name}: nicht eingerichtet`);
    return 0;
  }
  const umgebungsFehler = nurZeigen ? null : mutationUmgebungFehler(name, env);
  if (umgebungsFehler !== null) return aufrufFehler(err, umgebungsFehler);
  if (nurZeigen) {
    for (const z of zeilen) out(z);
    return 0;
  }
  return fuehreLaeufeAus(name, zeilen, { spawn, cwd, err });
}
