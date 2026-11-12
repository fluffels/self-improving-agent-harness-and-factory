// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * Guard-Liste (#112): je geänderter Funktion die Anker (Verzweigungs- und Guard-Stellen) der Diff-Zeilen, damit der Selbstcheck des
 * Umsetzers und Lens 3 von derselben, nicht selbst gewählten Liste ausgehen. Kein Gate, Exit 0 (außer Aufruf-Fehler und fehlende Basis).
 *
 * Köpfe: Deklaration (auch `export default`, `async`, `function*`, generisch `f<T>(…)`), `const f = …=>` (auch `async`, generisch `<T>(…) =>`, mit Typannotation `const f: T = …`; ein Typ mit `=>` darin fehlt), Methode (auch `static`/`async`, mit Rückgabetyp) `name(…) {` (auch einzeilig) und Eigenschaft `name: (…) =>`/`name: function` (eine TS-Typzeile `name: (x) => T;` zählt ebenfalls als Kopf).
 * Bewusste Grenzen (Regex-Heuristik, kein AST): mehrzeilige Ausdrücke und Funktionsköpfe über mehrere Zeilen, verschachtelte oder zeilenübergreifende
 * Strings, verschachtelte Template-Literale und mehrzeilige `${…}` (die Ausdrücke einzeiliger `${…}` werten wir gegen `MUSTER` aus), Regex-Literale mit Anführungszeichen und Guards außerhalb der Musterliste (`MUSTER`) fehlen; die Lens ergänzt sie.
 * Verdrahtung reiner Helfer an der Aufrufstelle (`opt: helfer(…)` als Argument) ist keine Verzweigung und kein Anker; die Lens prüft sie.
 * Regex-Literale: erkannt nach Zeilenanfang oder einem Operator aus `[=>(,:;!&|?{}[]` (auch nach `=>`); ein Regex-Literal nach anderem Vorlauf (etwa `return /x/`) fehlt, eine Division bleibt eine Division.
 * Zuordnung: nächster vorangehender Funktionskopf; eine Zeile in Spalte 0 mit `}`, `const`/`let`/`var`/`class` (auch `export`) oder `if (istDirektaufruf(` beendet ihn, danach gilt `(Modulebene)` (factory#396 L64). Bewusste Grenzen: andere Spalte-0-Anweisungen nach einer Funktion (`main();`) zählen weiter zur vorigen Funktion; ein `}` in Spalte 0 in einem mehrzeiligen String oder Template beendet zu früh.
 * Shell (`*.sh`, factory#396 L2): eigene Musterliste `MUSTER_SHELL` (`if` samt `elif`, `[[`, `case`, `&&`, `||`), Köpfe `name() {` und `function name {`, `}` in Spalte 0 beendet die Funktion; Strings und `#`-Kommentare (auch Shebang) zählen nicht, `$#` und `${#a[@]}` bleiben Code. Bewusste Grenzen: `.bash`/`.zsh` und Dateien nur mit Shebang fehlen; Heredocs, `while`/`until`, `[ … ]` ohne `if` und `${x:-y}` ergeben keinen Anker.
 * Ungetrackte Dateien mit Nicht-ASCII-Namen (git quotet sie) fehlen.
 * Messumfang (`istGemessen`): Quellwurzeln und Endungsliste der Projekt-Config (`struktur.quelle`, `struktur.endungen`, `struktur.ohne`, auch die Listen- und Glob-Form) über `isMeasured`, dazu Nicht-Test-Dateien in jedem Unterverzeichnis mit einer Endung der Liste, der JS/TS-Familie oder `.sh` (nur hier, nicht in `check:size` und Coverage;Hilfsdateien wie `test/support/x.ts`, Werkzeugskripte `tools/x.mjs` auch bei Java-Profil); `*.test.*`/`*.spec.*`, `.d.ts`, Doku und Root-Dateien fehlen.
 * Bewusste Grenze: Testklassen ohne `.test.`/`.spec.` im Namen (Java: `RechnerTest.java`) zählen über die Ordner-Klausel als Hilfsdatei. Kein Gate.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { isMeasured, parseDiffLines, resolveBase } from "./check-basis.mjs";
import { normalizePath } from "./relativ-pfad.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { TESTDATEI } from "./groessenstufe-lib.mjs";
import { STANDARD_ENDUNGEN, quellenAus, quellenObjekt } from "./quellwurzeln-lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUFRUF = "Aufruf: node scripts/anker-liste.mjs [--basis <ref>] [--json]";
const FLAGS = { basis: { type: "string" }, json: { type: "boolean" } };
const MODULEBENE = "(Modulebene)";

/** Geschlossene Musterliste. `auf: "text"` prüft die Zeile ohne String-Inhalte und Kommentar, sonst zusätzlich ohne Regex-Literale. */
export const MUSTER = [
  { name: "if", re: /\bif\s*\(/ },
  { name: "switch", re: /\bswitch\s*\(/ },
  { name: "case", re: /^\s*case\b/ },
  { name: "ternär", re: /\s\?\s/ },
  { name: "??", re: /\?\?(?!=)/ },
  { name: "??=", re: /\?\?=/ },
  { name: "?.", re: /\?\.(?!\d)/ },
  { name: "||", re: /\|\|(?!=)/ },
  { name: "&&", re: /&&(?!=)/ },
  { name: "||=", re: /\|\|=/ },
  { name: "&&=", re: /&&=/ },
  { name: "catch", re: /\bcatch\b/ },
  { name: "throw", re: /\bthrow\b/ },
  { name: "Regex-Literal", re: /(?:^|[=>(,:;!&|?{}[])\s*\/(?![/*])/, auf: "text" },
  { name: "new RegExp", re: /\bnew\s+RegExp\b/ },
  { name: "<", re: /\s<\s/ },
  { name: "<=", re: /\s<=\s/ },
  { name: ">", re: /\s>\s/ },
  { name: ">=", re: /\s>=\s/ },
  { name: ".filter(", re: /\.filter\(/ },
  { name: ".find(", re: /\.find\(/ },
  { name: ".findIndex(", re: /\.findIndex\(/ },
  { name: ".some(", re: /\.some\(/ },
  { name: ".every(", re: /\.every\(/ },
];

const STRINGS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const TEMPLATE_AUSDRUCK = /\$\{/g;

/** Pur: die Ausdrücke aller ${…} eines einzeiligen Template-Literals, klammerbalanciert (Strings darin geleert); ein nicht schließender Ausdruck endet am Literalende. */
function templateAusdruecke(literal) {
  const ausdruecke = [];
  for (const m of literal.matchAll(TEMPLATE_AUSDRUCK)) {
    const start = m.index + 2;
    let tiefe = 1;
    let ende = start;
    for (; ende < literal.length && tiefe > 0; ende++) tiefe += literal[ende] === "{" ? 1 : literal[ende] === "}" ? -1 : 0;
    ausdruecke.push(literal.slice(start, tiefe === 0 ? ende - 1 : ende).replace(STRINGS, '""'));
  }
  return ausdruecke;
}

/** Pur: ersetzt jeden String durch "", ein Template-Literal zusätzlich um seine ${…}-Ausdrücke (angehängt, damit `MUSTER` sie sieht). */
const leereStrings = (zeile) => zeile.replace(STRINGS, (s) => (s.startsWith("`") ? ['""', ...templateAusdruecke(s)].join(" ") : '""'));
const REGEX_LITERAL = /(^\s*|[=>(,:;!&|?{}[]\s*)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+\/[dgimsuvy]*/g;
const KOPF = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)\s*(?:<[^(]*>\s*)?\(/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|(?:<[^(]*>\s*)?\(.*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/,
  /^\s+(?:static\s+)?(?:async\s+)?(?!(?:if|for|while|switch|catch|return|function)\b)([\w$]+)\s*\([^)]*\)\s*(?::[^{]+)?\{/,
  /^\s+(?:async\s+)?([\w$]+)\s*:\s*(?:async\s+)?(?:function\b|\(.*\)\s*(?::[^=]+)?=>|[\w$]+\s*=>)/,
];
/** Geschlossene Grenzliste (nur Spalte 0, geprüft nach dem Funktionskopf): ein schließendes `}`, `const`/`let`/`var`/`class` (auch `export`) und der Block `if (istDirektaufruf(…))` beenden die vorige Funktion, danach gilt `(Modulebene)` (factory#396 L64). */
const MODULEBENE_GRENZE = /^(?:\}|(?:export\s+)?(?:const|let|var|class)\b|if\s*\(\s*istDirektaufruf\()/;
const DEFAULT_PARAMETER = /[^=!<>]=(?![=>])/g;

/** Der Name der Funktion, deren Kopf die Zeile ist, sonst `undefined`. */
const kopfName = (text) => KOPF.map((re) => re.exec(text)?.[1]).find((n) => n !== undefined);

/** Die Parameterliste eines Funktionskopfs: von der ersten `(` bis zur passenden `)`; ohne Klammer vor dem `=>` (`x => …`) leer; ohne schließende Klammer (Kopf über mehrere Zeilen) der Rest der Zeile. */
function parameterListe(text) {
  const start = text.indexOf("(");
  const pfeil = text.indexOf("=>");
  if (start < 0 || (pfeil >= 0 && pfeil < start)) return "";
  let tiefe = 0;
  for (let i = start; i < text.length; i++) {
    tiefe += text[i] === "(" ? 1 : text[i] === ")" ? -1 : 0;
    if (tiefe === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/** Die Anker-Namen einer Zeile (ohne Kommentar- und String-Inhalte) in Tabellenreihenfolge; Kopfzeilen je Default-Parameter ein Anker „Default-Parameter“ zusätzlich. */
function jsAnkerNamen(zeile) {
  const text = leereStrings(zeile).replace(/\/\/.*$/, "");
  const ohneRegex = text.replace(REGEX_LITERAL, "$1 R");
  const namen = MUSTER.filter((m) => m.re.test(m.auf === "text" ? text : ohneRegex)).map((m) => m.name);
  const parameter = kopfName(text) === undefined ? "" : parameterListe(ohneRegex);
  const defaults = (parameter.match(DEFAULT_PARAMETER) ?? []).map(() => "Default-Parameter");
  return [...namen, ...defaults];
}

/** Shell (`*.sh`, factory#396 L2): geschlossene Musterliste, `elif` zählt als `if`; `[[` und `case` nur als Wort. */
export const MUSTER_SHELL = [
  { name: "if", re: /(?<![\w-])(?:if|elif)\s/ },
  { name: "[[", re: /(?:^|\s)\[\[\s/ },
  { name: "case", re: /^\s*case\s/ },
  { name: "&&", re: /&&/ },
  { name: "||", re: /\|\|/ },
];
const SHELL_STRINGS = /"(?:[^"\\]|\\.)*"|'[^']*'/g;
const SHELL_KOMMENTAR = /(?:^|\s)#.*$/;
const SHELL_KOEPFE = [/^\s*function\s+([\w:.-]+)\s*(?:\(\s*\))?\s*\{/, /^\s*([\w:.-]+)\s*\(\s*\)\s*\{/];

/** Pur: die Shell-Zeile ohne String-Inhalte (`""`) und ohne Kommentar (auch Shebang); `$#` und `${#a[@]}` bleiben Code. */
const shellBereinigt = (zeile) => zeile.replace(SHELL_STRINGS, '""').replace(SHELL_KOMMENTAR, "");

/** Dialekt je Endung: Köpfe, Text für die Kopf-Erkennung, Anker-Namen einer Zeile, Grenze zur Modulebene, Blockkommentar-Logik. */
const DIALEKT_JS = { kopf: (text) => kopfName(text.replace(STRINGS, '""')), namen: jsAnkerNamen, grenze: MODULEBENE_GRENZE, blockKommentar: true };
const DIALEKT_SHELL = {
  kopf: (text) => SHELL_KOEPFE.map((re) => re.exec(text)?.[1]).find((n) => n !== undefined),
  namen: (zeile) => {
    const text = shellBereinigt(zeile);
    return MUSTER_SHELL.filter((m) => m.re.test(text)).map((m) => m.name);
  },
  grenze: /^\}/,
  blockKommentar: false,
};
const SHELL_ENDUNGEN = [".sh"];
const dialektVon = (datei) => (SHELL_ENDUNGEN.some((e) => datei.endsWith(e)) ? DIALEKT_SHELL : DIALEKT_JS);

/** Anker einer Datei: nur die Zeilen in `zeilen` (`null` = alle), je Funktion gruppiert. */
function dateiAnker(datei, inhalt, zeilen) {
  const gruppen = new Map();
  const dialekt = dialektVon(datei);
  let funktion = { name: MODULEBENE, zeile: null };
  let imBlock = false;
  inhalt.split(/\r?\n/).forEach((roh, i) => {
    const n = i + 1;
    const t = roh.trim();
    const kommentar = dialekt.blockKommentar && (imBlock || t.startsWith("/*") || t.startsWith("*"));
    if (t.startsWith("/*") || imBlock) imBlock = !t.includes("*/");
    if (kommentar) return;
    const name = dialekt.kopf(roh);
    if (name !== undefined) funktion = { name, zeile: n };
    else if (dialekt.grenze.test(roh)) funktion = { name: MODULEBENE, zeile: null };
    if (zeilen !== null && !zeilen.has(n)) return;
    const namen = dialekt.namen(roh);
    if (namen.length === 0) return;
    const eintrag = gruppen.get(funktion.name + funktion.zeile) ?? { datei, funktion: funktion.name, zeile: funktion.zeile ?? n, anker: [] };
    eintrag.anker.push(...namen.map((muster) => ({ zeile: n, muster })));
    gruppen.set(funktion.name + funktion.zeile, eintrag);
  });
  return [...gruppen.values()];
}

/** Pur: `git diff -U0`-Text, neue Dateien `{ pfad, inhalt }`, `lies(pfad)` für den Stand einer geänderten Datei und `istQuelle(pfad)`. */
export function guardListe({ diffText, neueDateien = [], lies, istQuelle }) {
  const quellen = new Map();
  for (const [pfad, zeilen] of parseDiffLines(diffText)) {
    const inhalt = istQuelle(pfad) ? lies(pfad) : undefined;
    if (typeof inhalt === "string") quellen.set(pfad, { inhalt, zeilen });
  }
  for (const { pfad, inhalt } of neueDateien) {
    if (typeof inhalt === "string" && istQuelle(normalizePath(pfad))) quellen.set(normalizePath(pfad), { inhalt, zeilen: null });
  }
  return [...quellen].flatMap(([datei, { inhalt, zeilen }]) => dateiAnker(datei, inhalt, zeilen));
}

/** Pur: die Zahl aller Anker einer Guard-Liste. */
export const ankerSumme = (ergebnis) => ergebnis.reduce((s, e) => s + e.anker.length, 0);

/** Die Guard-Liste des Diffs gegen `basis` (geänderte und neue Quelldateien) mit injiziertem `git`, `lesen`, `istQuelle`. */
export function ankerImDiff(basis, { git, lesen, istQuelle }) {
  const neueDateien = git(["ls-files", "--others", "--exclude-standard"])
    .split(/\r?\n/)
    .filter((pfad) => istQuelle(normalizePath(pfad)))
    .map((pfad) => ({ pfad, inhalt: lesen(pfad) }));
  return guardListe({ diffText: git(["diff", "-U0", basis]), neueDateien, lies: lesen, istQuelle });
}

/** Eine Zeile je Funktion `datei:zeile funktion: <n> Anker (if×2 :41,:47; ?? :52)` plus Summe. */
export function formatiere(ergebnis) {
  if (ergebnis.length === 0) return "Guard-Liste: keine Anker im Diff.\n";
  const zeilen = ergebnis.map((e) => {
    const gruppen = new Map();
    for (const a of e.anker) gruppen.set(a.muster, [...(gruppen.get(a.muster) ?? []), `:${a.zeile}`]);
    const text = [...gruppen].map(([muster, orte]) => `${muster}${orte.length > 1 ? `×${orte.length}` : ""} ${orte.join(",")}`).join("; ");
    return `${e.datei}:${e.zeile} ${e.funktion}: ${e.anker.length} Anker (${text})`;
  });
  const summe = ankerSumme(ergebnis);
  return `${zeilen.join("\n")}\nSumme: ${summe} Anker in ${ergebnis.length} ${ergebnis.length === 1 ? "Funktion" : "Funktionen"}\n`;
}

/** Die CLI mit injiziertem `git(args)`, `lesen(pfad)` und `istQuelle`; Ergebnis `{ code, out, err }`. */
export function lauf(argv, { git, lesen, istQuelle }) {
  const r = flagsLesen(argv, FLAGS);
  if (r.fehler) return { code: 2, out: "", err: `✖ anker-liste: ${r.fehler.text}\n${AUFRUF}\n` };
  const basis = resolveBase(git, r.werte.basis === undefined ? process.env : { FACTORY_DIFF_BASE: r.werte.basis });
  if (basis === null) {
    return { code: 1, out: "", err: "✖ anker-liste: keine Vergleichs-Basis auflösbar\nFix: --basis <ref> angeben oder `git fetch origin` ausführen\n" };
  }
  const ergebnis = ankerImDiff(basis, { git, lesen, istQuelle });
  return { code: 0, out: r.werte.json ? `${JSON.stringify(ergebnis)}\n` : formatiere(ergebnis), err: "" };
}

/** Pur: Quellwurzeln und Endungsliste (`isMeasured`) oder das Verzeichnis als eigene Wurzel (`test/support/x.ts`, `tools/x.mjs`) mit Endungsliste plus JS/TS-Familie; Testdateien (`*.test.*`, `*.spec.*`, auch in der Quelle), Doku und Root-Dateien nie. */
export function istGemessen(pfad, quelle) {
  const q = quellenObjekt(quelle);
  const familie = { ...q, wurzeln: [posix.dirname(pfad)], endungen: [...new Set([...q.endungen, ...STANDARD_ENDUNGEN, ...SHELL_ENDUNGEN])] };
  return !TESTDATEI.test(pfad) && (isMeasured(pfad, q) || isMeasured(pfad, familie));
}

/** Die echte Umgebung: git im Repo-Root, Dateien relativ dazu (nicht lesbar: `undefined`), Quelle aus der Projekt-Config. */
export function echteUmgebung() {
  const quelle = quellenAus(ladeProjektConfig());
  return {
    git: (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }),
    lesen: (pfad) => {
      try {
        return readFileSync(join(ROOT, pfad), "utf8");
      } catch {
        return undefined;
      }
    },
    istQuelle: (pfad) => istGemessen(pfad, quelle),
  };
}

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe: (argv) => ({ fehler: flagsLesen(argv, FLAGS).fehler?.text }),
    fehlerErgebnis: (argv) => lauf(argv, {}),
    io: echteUmgebung,
    fuehreAus: (argv, io) => lauf(argv, io),
  });
}
