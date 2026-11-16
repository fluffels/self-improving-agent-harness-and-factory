// Kein Shebang, kein Direktaufruf-Guard: pure Lib der Fabrik-eigenen Token-Analyse (factory#518, Teil 5/9).
/**
 * Freigabeliste, Allowlist lesender Befehle, Ablage-Prüfung und Analyse-Schnappschuss. Pur: kein Dateizugriff, kein Prozess; der Aufrufer löst
 * Pfade vorab per realpath auf (`real` ist injizierbar). Meldungen nennen nie einen Namen aus der Liste, nur `Bezieher <k>`.
 */
import { isAbsolute, relative, resolve } from "node:path";

/** Anzeigename eines Bezieher-Verzeichnisses: nur die Nummer in der Liste, nie der Name. */
export const BEZIEHER_PRAEFIX = "Bezieher ";
export const bezieherLabel = (k) => `${BEZIEHER_PRAEFIX}${k}`;

/** Freigabeliste: ein absoluter Pfad je Zeile, `#` leitet einen Kommentar ein, Leerzeilen zählen nicht. Wirft bei relativem Pfad (nur die Zeilennummer). */
export function parseFreigabeliste(text) {
  const pfade = [];
  String(text ?? "")
    .split(/\r?\n/)
    .forEach((roh, i) => {
      const zeile = roh.replace(/(^|\s)#.*$/, "").trim();
      if (zeile === "") return;
      if (!isAbsolute(zeile)) throw new Error(`Freigabeliste Zeile ${i + 1}: absoluter Pfad erwartet`);
      if (!pfade.includes(zeile)) pfade.push(zeile);
    });
  return pfade;
}

const GITHUB_URLS = [/^https:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\//, /^git@github\.com:([^/]+)\//, /^ssh:\/\/git@github\.com\/([^/]+)\//];

/** Eigentümer des Remotes `origin` aus dem Text einer `.git/config`; `null` bei anderem Host, ohne `origin` oder ohne `url`. */
export function remoteEigentuemer(gitConfigText) {
  let abschnitt = "";
  for (const roh of String(gitConfigText ?? "").split(/\r?\n/)) {
    const zeile = roh.trim();
    const kopf = /^\[(.+)\]$/.exec(zeile);
    if (kopf) {
      abschnitt = kopf[1].trim();
      continue;
    }
    const url = abschnitt === 'remote "origin"' ? /^url\s*=\s*(.+)$/.exec(zeile) : null;
    if (!url) continue;
    for (const muster of GITHUB_URLS) {
      const treffer = muster.exec(url[1].trim());
      if (treffer) return treffer[1];
    }
    return null;
  }
  return null;
}

/** Freigabe eines Verzeichnisses der Liste: Git-Checkout und Remote-Eigentümer gleich dem angemeldeten Konto (Groß-/Kleinschreibung egal). Fail-closed. */
export function pruefeBezieher({ istCheckout, eigentuemer, login }) {
  if (!istCheckout) return { ok: false, grund: "kein Git-Checkout" };
  if (!login) return { ok: false, grund: "angemeldetes Konto nicht ermittelbar" };
  if (!eigentuemer) return { ok: false, grund: "Remote-Eigentümer nicht erkennbar" };
  if (eigentuemer.toLowerCase() !== String(login).toLowerCase()) return { ok: false, grund: "Remote-Eigentümer passt nicht zum angemeldeten Konto" };
  return { ok: true, grund: "" };
}

/** Geschlossene Allowlist (AK 3). Alles andere wird abgelehnt. */
const GIT_UNTERBEFEHLE = ["log", "ls-files", "show"];
const WC_OPTIONEN = ["-l", "-c", "-w", "-m"];
/** Optionen, die einen lesenden Git-Befehl schreiben, Programme starten oder fremde Dateien lesen lassen. */
const GIT_VERBOTEN = [/^--output/, /^-o$/, /^-c$/, /^--ext-diff$/, /^--textconv$/, /^--exec/, /^--upload-pack/, /^--config/, /^-O/, /^--open-files-in-pager/, /^--(git-dir|work-tree|namespace)/];

/** Liegt `pfad` auf oder unter einer der Wurzeln? Pur über `path.relative`. */
export function liegtUnter(pfad, wurzeln) {
  return wurzeln.some((w) => {
    const rel = relative(resolve(w), resolve(pfad));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  });
}

const abgelehnt = (grund) => ({ ok: false, grund });
const identitaet = (p) => p;
function pruefeGit(argv, wurzel, real) {
  if (argv[1] !== "-C" || typeof argv[2] !== "string" || real(argv[2]) !== real(wurzel)) return abgelehnt("git nur mit -C auf die freigegebene Wurzel");
  if (!GIT_UNTERBEFEHLE.includes(argv[3])) return abgelehnt("Git-Unterbefehl nicht in der Allowlist");
  if (argv.slice(4).some((a) => GIT_VERBOTEN.some((m) => m.test(a)))) return abgelehnt("verbotene Git-Option");
  return { ok: true, grund: "" };
}

function pruefeWc(argv, wurzel, real) {
  const rest = argv.slice(1);
  const dateien = rest.filter((a) => !a.startsWith("-"));
  if (rest.some((a) => a.startsWith("-") && !WC_OPTIONEN.includes(a))) return abgelehnt("wc-Option nicht in der Allowlist");
  if (dateien.length === 0) return abgelehnt("wc ohne Datei (liest Standardeingabe)");
  if (!dateien.every((d) => liegtUnter(real(resolve(wurzel, d)), [real(wurzel)]))) return abgelehnt("wc-Datei außerhalb der freigegebenen Wurzel");
  return { ok: true, grund: "" };
}

/** Prüft ein argv gegen die Allowlist (`git -C <wurzel> log|ls-files|show …`, `wc -l|-c|-w|-m <Datei unter wurzel>`); fail-closed. */
export function pruefeBefehl(argv, { wurzel, real = identitaet }) {
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((a) => typeof a !== "string")) return abgelehnt("kein argv");
  if (argv[0] === "git") return pruefeGit(argv, wurzel, real);
  if (argv[0] === "wc") return pruefeWc(argv, wurzel, real);
  return abgelehnt("Programm nicht in der Allowlist");
}

/** Das endgültige argv: festes Präfix gegen Pager, fsmonitor und Hooks aus der Konfiguration des Bezieher-Repos; der Aufrufer setzt kein `-c`. */
export function befehlMitSchutz(argv) {
  if (argv[0] !== "git") return argv;
  const [, , wurzel, unter, ...rest] = argv;
  const diff = unter === "ls-files" ? [] : ["--no-ext-diff", "--no-textconv"];
  return ["git", "--no-pager", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", wurzel, unter, ...diff, ...rest];
}

export const SCHUTZ_UMGEBUNG = { GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };

/** Ablage (oder Freigabeliste) muss außerhalb von Repo, Worktrees und Bezieher-Checkouts liegen; Pfade bereits aufgelöst. */
export function pruefeAblage({ ablage, repoWurzel, worktrees = [], bezieherWurzeln = [], art = "Ablage" }) {
  if (!ablage || !isAbsolute(ablage)) return { ok: false, grund: `${art}: absoluter Pfad erforderlich` };
  if (liegtUnter(ablage, [repoWurzel, ...worktrees])) return { ok: false, grund: `${art} liegt im Repo oder in einem Worktree` };
  if (liegtUnter(ablage, bezieherWurzeln)) return { ok: false, grund: `${art} liegt in einem Bezieher-Checkout` };
  return { ok: true, grund: "" };
}

/** Enthält der Text einen Verzeichnisnamen (letztes Pfadsegment) aus der Freigabeliste? Schutz gegen Namensleck in Ausgabe und Ablage. */
export function enthaeltNamen(text, pfade) {
  const haystack = String(text).toLowerCase();
  return pfade.some((p) => {
    const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    return Boolean(name) && haystack.includes(name.toLowerCase());
  });
}

const DATEI = /^analyse-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.json$/;
const laufnummer = (m) => (m[2] ? Number(m[2]) : 1);

/** Der Dateiname (mit `.json`) des jüngsten Schnappschusses unter den Namen, sonst `null`. */
export function letzterSchnappschuss(dateinamen) {
  const treffer = dateinamen.map((n) => ({ n, m: DATEI.exec(n) })).filter((x) => x.m);
  treffer.sort((a, b) => a.m[1].localeCompare(b.m[1]) || laufnummer(a.m) - laufnummer(b.m));
  return treffer.length ? treffer[treffer.length - 1].n : null;
}

/** Basisname (ohne Endung) des neuen Schnappschusses: `analyse-<Datum>`, am selben Tag `-2`, `-3` … */
export function schnappschussName(datum, dateinamen) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new Error("Datum muss JJJJ-MM-TT sein");
  const nummern = dateinamen.map((n) => DATEI.exec(n)).filter((m) => m && m[1] === datum).map(laufnummer);
  return nummern.length ? `analyse-${datum}-${Math.max(...nummern) + 1}` : `analyse-${datum}`;
}

const zahl = (v) => typeof v === "number" && Number.isFinite(v);
const wert = (v) => (zahl(v) ? String(v) : "Lücke");

function aenderung(vorher, nachher) {
  if (!zahl(vorher) || !zahl(nachher)) return "Lücke";
  const d = nachher - vorher;
  return d > 0 ? `+${d}` : String(d);
}

/**
 * Lesefassung des Analyse-Schnappschusses mit Vorher/Nachher-Tabelle. `vorher` ist das geparste JSON des letzten Schnappschusses oder `null`.
 * Ein fehlender Wert steht als „Lücke“, nie als 0; Bezieher-Zeilen sind eine Lücke, wenn sich die Anzahl der Bezieher geändert hat.
 */
export function schnappschussMarkdown({ datum, anzahlBezieher, kennzahlen, vorher }) {
  const alt = vorher?.kennzahlen ?? {};
  const anzahlGleich = vorher != null && vorher.anzahlBezieher === anzahlBezieher;
  const namen = [...Object.keys(kennzahlen), ...Object.keys(alt).filter((n) => !(n in kennzahlen))];
  const zeilen = namen.map((n) => {
    const v = n.startsWith(BEZIEHER_PRAEFIX) && !anzahlGleich ? undefined : alt[n];
    if (vorher == null) return `| ${n} | erster Schnappschuss | ${wert(kennzahlen[n])} | – |`;
    return `| ${n} | ${wert(v)} | ${wert(kennzahlen[n])} | ${aenderung(v, kennzahlen[n])} |`;
  });
  return [`# Analyse-Schnappschuss ${datum}`, "", `Bezieher in der Freigabeliste: ${anzahlBezieher}`, "", "| Messgröße | Vorher | Nachher | Änderung |", "| --- | --- | --- | --- |", ...zeilen, ""].join("\n");
}
