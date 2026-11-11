// Mutationslauf (factory#299), nur berichtend: `node scripts/mutation-lauf.mjs`.
// Bildet den Diff gegen die Merge-Base (nur Code-Dateien ohne Tests) als Zeilenbereiche, ruft den Gate-Befehl `mutation`
// (Adapter-Vertrag: Bereiche als JSON-Datei, Pfad in der Umgebungsvariable `MUTATION_UMGEBUNG.bereiche`; Bericht im Schema
// „mutation-testing-elements“, Pfad in `MUTATION_UMGEBUNG.bericht`) und gibt je überlebendem oder nicht abgedecktem Mutanten
// eine Zeile `datei:zeile | mutator | ersatz` plus Summenzeile aus. Exit 0 auch mit überlebenden Mutanten; 1 bei Fehlern
// (fehlender oder kaputter Bericht, Werkzeug-Exit ≠ 0, keine Basis); 2 bei Aufruf-Fehlern.
// Grenzen: gemessen wird nur der committete Stand (`basis...HEAD`), nicht der Arbeitsbaum; Tests erkennt der Kern nur am Namen
// (Pfadsegment test/tests/__tests__, *.test.*, *.spec.*); das Werkzeug muss Zeilenbereiche oder ganze Dateien annehmen, der Kern
// filtert den Bericht nach den Bereichen; dynamisch gebaute Regexes mutiert ein Werkzeug nur, wenn es sie als Literal sieht.
// Lib mit Einstieg nur über `istDirektaufruf`; `git`, `spawn`, Dateizugriff und Umgebung werden injiziert.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isMeasured, parseDiffLines, resolveBase } from "./check-basis.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { normalizePath } from "./relativ-pfad.mjs";
import { MUTATION_UMGEBUNG } from "./gate-befehl-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { quellenAus } from "./quellwurzeln-lib.mjs";

const BEKANNTE_STATUS = new Set(["Killed", "Survived", "NoCoverage", "Timeout", "CompileError", "RuntimeError", "Ignored", "Pending"]);
const TEST_SEGMENTE = new Set(["test", "tests", "__tests__"]);
const MAX_ERSATZ = 80;

/** Pur: ist `pfad` eine Test-Datei (Pfadsegment test/tests/__tests__ oder *.test.*, *.spec.*; deckt `test/support`)? */
export function istTestPfad(pfad) {
  const teile = pfad.split("/");
  return teile.slice(0, -1).some((s) => TEST_SEGMENTE.has(s)) || /\.(?:test|spec)\.[^/]+$/.test(pfad);
}

/** Pur: Zeilenbereiche `[{ datei, von, bis }]` (sortiert, `bis` inklusiv) der Code-Dateien aus einem `git diff -U0`-Text. */
export function bereicheAusDiff(diffText, quellen) {
  const bereiche = [];
  for (const [datei, zeilen] of [...parseDiffLines(diffText)].sort(([a], [b]) => a.localeCompare(b))) {
    if (!isMeasured(datei, quellen) || istTestPfad(datei)) continue;
    let von = null;
    let bis = null;
    for (const z of [...zeilen].sort((a, b) => a - b)) {
      if (von !== null && z === bis + 1) {
        bis = z;
        continue;
      }
      if (von !== null) bereiche.push({ datei, von, bis });
      von = z;
      bis = z;
    }
    if (von !== null) bereiche.push({ datei, von, bis });
  }
  return bereiche;
}

const alsPosix = (p) => p.replace(/\\/g, "/");

/** Pur: macht aus einem Berichtsschlüssel (absolut, Windows-Trenner, `./`) einen Pfad relativ zur Wurzel. */
function relativ(schluessel, wurzel) {
  const k = normalizePath(schluessel);
  const w = alsPosix(wurzel).replace(/\/+$/, "");
  return k.startsWith(`${w}/`) ? k.slice(w.length + 1) : k;
}

/** Pur: Berichtstext → `{ mutanten }` (je `{ datei, zeile, mutator, ersatz, status }`) oder `{ fehler }` (fail-closed). */
export function berichtLesen(text, wurzel) {
  let bericht;
  try {
    bericht = JSON.parse(text);
  } catch (e) {
    return { fehler: `Bericht ist kein gültiges JSON (${e instanceof Error ? e.message : String(e)})` };
  }
  const files = bericht?.files;
  if (files === null || typeof files !== "object" || Array.isArray(files)) return { fehler: "Bericht ohne Objekt „files“" };
  const mutanten = [];
  for (const [schluessel, datei] of Object.entries(files)) {
    if (!Array.isArray(datei?.mutants)) return { fehler: `Bericht: „mutants“ von ${schluessel} ist kein Array` };
    for (const m of datei.mutants) {
      const fehler = mutantMangel(m);
      if (fehler !== null) return { fehler: `Bericht: ${fehler} in ${schluessel}` };
      mutanten.push({ datei: relativ(schluessel, wurzel), zeile: m.location.start.line, mutator: String(m.mutatorName ?? "?"), ersatz: m.replacement, status: m.status });
    }
  }
  return { mutanten };
}

/** Pur: Mangel eines Berichts-Mutanten (unbekannter Status, keine Startzeile) oder null. */
function mutantMangel(m) {
  if (!BEKANNTE_STATUS.has(m?.status)) return `unbekannter Status „${String(m?.status)}“`;
  return Number.isInteger(m.location?.start?.line) ? null : "Mutant ohne Startzeile";
}

/** Pur: nur Mutanten, deren Startzeile in einem Bereich der Datei liegt; `verworfen` zählt den Rest. */
export function aufBereicheFiltern(mutanten, bereiche) {
  const innen = mutanten.filter((m) => bereiche.some((b) => b.datei === m.datei && m.zeile >= b.von && m.zeile <= b.bis));
  return { mutanten: innen, verworfen: mutanten.length - innen.length };
}

const einzeilig = (t) => {
  const s = String(t).replace(/\s+/g, " ").trim().replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  return s.length > MAX_ERSATZ ? `${s.slice(0, MAX_ERSATZ - 1)}…` : s;
};
const zeileVon = (m) => `${m.datei}:${m.zeile} | ${einzeilig(m.mutator)} | ${m.ersatz === undefined || m.ersatz === null ? "–" : einzeilig(m.ersatz)}`;
const sortiert = (liste) => [...liste].sort((a, b) => a.datei.localeCompare(b.datei) || a.zeile - b.zeile);

/** Pur: Ausgabezeilen (Abschnitte der Überlebenden und nicht Abgedeckten, Summenzeile). */
export function formatiere(mutanten, verworfen = 0) {
  const zaehle = (s) => mutanten.filter((m) => m.status === s).length;
  const ueberlebt = sortiert(mutanten.filter((m) => m.status === "Survived"));
  const ohne = sortiert(mutanten.filter((m) => m.status === "NoCoverage"));
  const bekannt = ueberlebt.length + ohne.length + zaehle("Killed") + zaehle("Timeout");
  const zeilen = [];
  if (ueberlebt.length > 0) zeilen.push(`überlebt (${ueberlebt.length}):`, ...ueberlebt.map(zeileVon));
  if (ohne.length > 0) zeilen.push(`ohne Abdeckung (${ohne.length}):`, ...ohne.map(zeileVon));
  const rest = ` · außerhalb der Bereiche verworfen ${verworfen}`;
  zeilen.push(`Mutanten: ${mutanten.length} · getötet ${zaehle("Killed")} · überlebt ${ueberlebt.length} · ohne Abdeckung ${ohne.length} · Timeout ${zaehle("Timeout")} · sonstige ${mutanten.length - bekannt}${verworfen > 0 ? rest : ""}`);
  return zeilen;
}

const ohneEingerichtet = (config) => config?.befehle?.mutation === undefined;

/** Einstieg mit injizierten Nähten; gibt den Exit-Code zurück. */
export function cli(argv, io) {
  const { lade, git, spawn, lies, schreibe, tempOrdner, entferne, env, wurzel, out, err } = io;
  const { fehler } = flagsLesen(argv, {});
  if (fehler) {
    err(`${fehler.text}\nFix: node scripts/mutation-lauf.mjs ohne Argumente aufrufen.`);
    return AUFRUF_EXIT;
  }
  const config = lade();
  if (ohneEingerichtet(config)) {
    out("mutation: nicht eingerichtet");
    return 0;
  }
  const basis = resolveBase((args) => git(args), env);
  if (basis === null) {
    err("✖ mutation-lauf: keine Vergleichs-Basis gefunden.\nFix: FACTORY_DIFF_BASE setzen oder origin/main holen (git fetch origin).");
    return 1;
  }
  const bereiche = bereicheAusDiff(git(["diff", "-U0", "-M", "--no-color", "--no-ext-diff", `${basis}...HEAD`]), quellenAus(config));
  if (bereiche.length === 0) {
    out("mutation: keine Code-Zeilen");
    return 0;
  }
  const ordner = tempOrdner();
  try {
    return lauf({ bereiche, ordner, spawn, lies, schreibe, env, wurzel, out, err });
  } finally {
    entferne(ordner);
  }
}

function lauf({ bereiche, ordner, spawn, lies, schreibe, env, wurzel, out, err }) {
  const bereichePfad = join(ordner, "bereiche.json");
  const berichtPfad = join(ordner, "bericht.json");
  schreibe(bereichePfad, JSON.stringify({ version: 1, bereiche }));
  const r = spawn(process.execPath, [join(wurzel, "scripts", "gate-befehl.mjs"), "mutation"], {
    cwd: wurzel,
    env: { ...env, [MUTATION_UMGEBUNG.bereiche]: bereichePfad, [MUTATION_UMGEBUNG.bericht]: berichtPfad },
    stdio: ["ignore", 2, 2],
  });
  if (r.error || r.status !== 0) {
    err(`✖ mutation-lauf: Mutationswerkzeug endete mit ${r.error ? r.error.message : `Exit ${r.status}`}.\nFix: Werkzeug-Ausgabe oben prüfen; befehle.mutation der Projekt-Config muss den Bericht nach ${MUTATION_UMGEBUNG.bericht} schreiben.`);
    return 1;
  }
  let text;
  try {
    text = lies(berichtPfad);
  } catch (e) {
    err(`✖ mutation-lauf: Bericht fehlt (${e instanceof Error ? e.message : String(e)}).\nFix: das Werkzeug muss den Bericht nach ${MUTATION_UMGEBUNG.bericht} schreiben (Schema mutation-testing-elements).`);
    return 1;
  }
  const gelesen = berichtLesen(text, wurzel);
  if (gelesen.fehler !== undefined) {
    err(`✖ mutation-lauf: ${gelesen.fehler}.\nFix: Bericht im Schema mutation-testing-elements schreiben.`);
    return 1;
  }
  const { mutanten, verworfen } = aufBereicheFiltern(gelesen.mutanten, bereiche);
  for (const z of formatiere(mutanten, verworfen)) out(z);
  return 0;
}

/** Die echten Nähte (git, Spawn, Dateien, Temp-Ordner) für `cli`; getrennt von `main`, damit ein Test sie ohne Kindprozess prüfen kann. */
export function echteNaehte(wurzel, env = process.env) {
  return {
    lade: () => ladeProjektConfig(),
    git: (args) => execFileSync("git", args, { cwd: wurzel, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }),
    spawn: spawnSync,
    lies: (p) => readFileSync(p, "utf8"),
    schreibe: (p, t) => writeFileSync(p, t),
    tempOrdner: () => mkdtempSync(join(tmpdir(), "mutation-lauf-")),
    entferne: (p) => rmSync(p, { recursive: true, force: true }),
    env,
    wurzel,
    out: console.log,
    err: console.error,
  };
}

function main(argv) {
  const wurzel = join(import.meta.dirname, "..");
  process.exitCode = cli(argv, echteNaehte(wurzel));
}

if (istDirektaufruf(import.meta.url)) main(process.argv.slice(2));
