// Kein Shebang, kein Direktaufruf: Lib der Risikostufe (factory#525). Das Einstiegsskript `risikostufe.mjs` ruft sie auf (Konvention: Einstiegsskripte importieren nicht voneinander).
/**
 * Risikostufe 0, 1 oder 2 eines Diffs (factory#525, Teil 1/5 des Epics factory#511): deterministisch aus Pfaden und Größe, nie behauptet. Die Stufe wirkt auf die Nachweis-Wächter (factory#526: `check-review-nachweis`, `check-abnahme-nachweis`).
 *
 * Reihenfolge (die erste zutreffende gilt, Treffer der Schritte 2 bis 4 werden gesammelt):
 *  1. Fail-closed ist Stufe 2: Basis, Leitplanken oder Risiko-Muster nicht ladbar oder leer, Dateiliste leer oder nicht lesbar, von git quotierter Pfad, Binärdatei (ohne Zeilenzahl), git-Fehler.
 *  2. Ein Pfad trifft die feste Stufe-2-Basis (`.github/risikostufe-basis.json`: Hooks, CI-Workflows, Agent-Einstellungen, MCP-Config, Abhängigkeits-Manifeste und Lockfiles, Selbstschutz;
 *     Groß-/Kleinschreibung egal). Eine Projekt-Config ersetzt sie nie.
 *  3. Ein Pfad trifft die Leitplanken-Gruppe `gate` aus `.github/protected-paths.json`; fehlt die Gruppe, gelten alle Leitplanken.
 *  4. Risikoklasse hoch (`bestimmeRisikoklasse`, Muster der Projekt-Config bzw. Standardliste).
 *  5. Stufe 0 nur bei (A) reinem `*.md`-Diff ohne Leitplanken- oder Grundschutz-Pfad oder (B) Größenstufe S mit Sweep `stichprobe` (nur Doku und Testdateien außerhalb von `test/harness/`).
 *  6. Sonst Stufe 1 (Produktionscode ist nie Stufe 0, Leitplanken-Markdown mindestens Stufe 1).
 *
 * Der Abschnittsname steht in `sprache.spezifikation.pfade` der Projekt-Config (deutsch „Pfade“); fehlt der Schlüssel, ist `--ticket` Stufe 2 (fail-closed).
 * Eingang `--ticket`: nur die Listenzeilen im Abschnitt dieses Namens (Formen: `-`, `*`, `+`, `1.` oder `1)`; der Pfad ist der erste Inline-Code-Span, sonst das erste Wort; Fließtext, Code-Fences und
 * der übrige Ticket-Text sind kein Eingang). Ein fehlender oder leerer Abschnitt, ein Glob (`*`, `?`, `[`) oder eine Zeile ohne Pfad ist Stufe 2. Die Prognose kennt keine Zeilen und prüft jeden Pfad zusätzlich als Verzeichnis.
 */
import { readFileSync } from "node:fs";
import { schutzlistenMuster, trifftLeitplanke } from "./besitz-extraktion.mjs";
import { bestimmeGroessenstufe, bestimmeRisikoklasse, GRUNDSCHUTZ, istDokuDiff, ladeRisikoMuster, parseNumstatNoRenames, risikoDerBasis, TESTDATEI, vereinigeRisiko } from "./groessenstufe-lib.mjs";
import { abschnitt } from "./spezifikation-lib.mjs";

const BASIS_URL = new URL("../.github/risikostufe-basis.json", import.meta.url);
const LEITPLANKEN_URL = new URL("../.github/protected-paths.json", import.meta.url);

export const meldung = (e) => (e instanceof Error ? e.message : String(e));
const istText = (x) => typeof x === "string" && x.trim() !== "";

/** Lädt die feste Stufe-2-Basis: `{kategorien: {name: muster[]}, muster}`; wirft bei fehlender Datei, kaputtem JSON, ungültiger oder leerer Kategorie und null Mustern. Die Text-Taste `beschreibung` wird ignoriert. */
export function ladeStufe2Basis(quelle = BASIS_URL) {
  const roh = JSON.parse(readFileSync(quelle, "utf8"));
  if (roh === null || typeof roh !== "object" || Array.isArray(roh)) throw new TypeError("Stufe-2-Basis: kein Objekt");
  const kategorien = {};
  for (const [name, wert] of Object.entries(roh)) {
    if (name === "beschreibung" && typeof wert === "string") continue;
    if (!Array.isArray(wert) || wert.length === 0 || !wert.every(istText)) throw new TypeError(`Stufe-2-Basis: Kategorie ${name} ist keine nicht-leere Liste von Pfadmustern`);
    kategorien[name] = wert;
  }
  const muster = Object.values(kategorien).flat();
  if (muster.length === 0) throw new TypeError("Stufe-2-Basis: keine Muster");
  return { kategorien, muster };
}

/** Der Text von `.github/protected-paths.json` (wirft, wenn die Datei fehlt). */
export const ladeLeitplankenText = (quelle = LEITPLANKEN_URL) => readFileSync(quelle, "utf8");

/** Alle Leitplanken-Muster der Datei (`schutzlistenMuster`); `null` bei kaputtem JSON. */
export const alleLeitplanken = (text) => schutzlistenMuster(text);

/** Die Stufe-2-Leitplanken: `{gruppe: "gate", muster}` oder, fehlt die Gruppe `gate`, `{gruppe: "alle", muster}`; kaputtes JSON oder eine Gruppe `gate`, die kein Array ist: `null`. Pur. */
export function stufe2Leitplanken(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (json === null || typeof json !== "object") return null;
  if (json.gate === undefined) {
    const muster = schutzlistenMuster(text);
    return muster === null ? null : { gruppe: "alle", muster };
  }
  return Array.isArray(json.gate) ? { gruppe: "gate", muster: json.gate.filter((x) => typeof x === "string") } : null;
}

const leer = (m) => !Array.isArray(m) || m.length === 0;

/** Grund, warum die Listen nicht reichen (Basis, Leitplanken, Risiko-Muster), sonst `null`. Pur. */
function listenGrund({ basis, leitplanken, risiko }) {
  if (leer(basis?.muster) || typeof basis.kategorien !== "object") return "Stufe-2-Basis nicht geladen oder leer";
  if (leer(leitplanken?.gate?.muster) || leer(leitplanken?.alle)) return "Leitplanken (protected-paths) nicht geladen oder leer";
  return risikoGrund(risiko);
}

/** Grund, warum die Risiko-Muster nicht nutzbar sind (fehlen, leer, mit `fehler`), sonst `null`. Pur. */
function risikoGrund(risiko) {
  if (!leer(risiko?.muster) && !risiko?.fehler?.length) return null;
  return `Risiko-Muster nicht ladbar: ${risiko?.fehler?.join("; ") ?? "keine Muster geladen"}`;
}

/** Grund, warum die Dateiliste nicht prüfbar ist (leer, Eintrag ohne Pfad, quotiert, binär), sonst `null`. Pur. */
function listeGrund(eintraege, prognose) {
  if (leer(eintraege)) return "keine Dateiliste (leer oder nicht lesbar)";
  for (const e of eintraege) {
    if (!istText(e?.pfad)) return "Dateiliste nicht lesbar (Eintrag ohne Pfad)";
    if (e.pfad.startsWith('"')) return `Pfad von git quotiert (${e.pfad}): nicht prüfbar`;
    if (!prognose && !Number.isInteger(e.zeilen)) return `${e.pfad} ist binär oder ohne lesbare Zeilenzahl`;
  }
  return null;
}

/** Der Grund, warum nichts berechnet werden kann (fail-closed, Stufe 2), sonst `null`. Pur. */
const failClosedGrund = ({ eintraege, prognose, ...listen }) => listenGrund(listen) ?? listeGrund(eintraege, prognose);

const alsVerzeichnis = (p) => `${p.replace(/\/+$/, "")}/x`;

/** Treffer `[{pfad, muster, liste}]` der Pfade gegen eine Mustermenge; `klein` vergleicht ohne Groß-/Kleinschreibung, `prognose` prüft jeden Pfad zusätzlich als Verzeichnis. Pur. */
function treffer(pfade, muster, liste, { klein = false, prognose = false } = {}) {
  const norm = (s) => (klein ? s.toLowerCase() : s);
  return pfade.flatMap((pfad) =>
    muster
      .filter((m) => (prognose ? [pfad, alsVerzeichnis(pfad)] : [pfad]).some((k) => trifftLeitplanke(norm(k), [norm(m)])))
      .map((m) => ({ pfad, muster: m, liste })),
  );
}

/** Alle Stufe-2-Treffer: Basis, Leitplanken-Gruppe, Risikoklasse hoch (ohne Dubletten). Pur. */
function stufe2Treffer(pfade, { basis, leitplanken, risiko, prognose }) {
  const alle = [];
  for (const [kat, muster] of Object.entries(basis.kategorien)) alle.push(...treffer(pfade, muster, `basis:${kat}`, { klein: true, prognose }));
  alle.push(...treffer(pfade, leitplanken.gate.muster, `leitplanken:${leitplanken.gate.gruppe}`, { prognose }));
  const klasse = bestimmeRisikoklasse(pfade, risiko);
  const verz = prognose && klasse.klasse !== "doku" ? bestimmeRisikoklasse(pfade.map(alsVerzeichnis), risiko) : null;
  if (klasse.klasse === "hoch") alle.push(...klasse.treffer.map((t) => ({ pfad: t.pfad, muster: t.muster, liste: "risiko" })));
  if (verz?.klasse === "hoch") alle.push(...verz.treffer.map((t) => ({ pfad: t.pfad.replace(/\/x$/, ""), muster: t.muster, liste: "risiko" })));
  return alle.filter((t, i) => alle.findIndex((u) => u.pfad === t.pfad && u.muster === t.muster && u.liste === t.liste) === i);
}

const ohneDubletten = (xs) => [...new Set(xs)];

/** Der Pfad, der eine Stufe 1 auslöst (factory#526, für die Meldung der Nachweis-Wächter): erster Schutz-Treffer, sonst nach der Regel der Sweep-Tiefe (`bestimmeSweeptiefe`, gleiche Bausteine) der erste Pfad, der weder Doku noch Testdatei ist, sonst der erste Pfad (Wächter-Tests unter `test/harness/` stehen im Grundschutz und sind schon ein Schutz-Treffer). Pur. */
function ausloeserPfad(pfade, geschuetzt) {
  const code = pfade.find((p) => !istDokuDiff([p]) && !TESTDATEI.test(p));
  return geschuetzt[0]?.pfad ?? code ?? pfade[0];
}

/**
 * Bestimmt die Risikostufe. `eintraege`: `[{pfad, zeilen}]` (`zeilen` `null` = binär; bei `prognose` darf es fehlen); `basis`: `ladeStufe2Basis`; `leitplanken`: `{gate: stufe2Leitplanken, alle: alleLeitplanken}`;
 * `risiko`: `risikoMusterAus`. Liefert `{stufe, gruende, treffer: [{pfad, muster, liste}], pfade}`, bei Stufe 1 zusätzlich `ausloeser` (der auslösende Pfad). Pur.
 */
export function bestimmeRisikostufe({ eintraege, basis, leitplanken, risiko, prognose = false }) {
  const grund = failClosedGrund({ eintraege, basis, leitplanken, risiko, prognose });
  if (grund !== null) return { stufe: 2, gruende: [grund], treffer: [], pfade: [] };
  const pfade = eintraege.map((e) => e.pfad);
  const t2 = stufe2Treffer(pfade, { basis, leitplanken, risiko, prognose });
  if (t2.length > 0) return { stufe: 2, gruende: t2.map((t) => `${t.pfad} trifft ${t.muster} (${t.liste})`), treffer: t2, pfade };
  const geschuetzt = treffer(pfade, [...leitplanken.alle, ...GRUNDSCHUTZ], "schutz", { prognose });
  if (istDokuDiff(pfade) && geschuetzt.length === 0) return { stufe: 0, gruende: ["nur *.md ohne Leitplanken- oder Grundschutz-Pfad"], treffer: [], pfade };
  const groesse = bestimmeGroessenstufe({ eintraege, muster: leitplanken.alle, prognose, risiko });
  if (groesse.stufe === "S" && groesse.sweep.tiefe === "stichprobe") return { stufe: 0, gruende: ["Größenstufe S, nur Doku und Testdateien außerhalb von test/harness/"], treffer: [], pfade };
  const gruende = ohneDubletten([...(groesse.sweep.tiefe === "voll" ? groesse.sweep.gruende : []), ...groesse.gruende]);
  return { stufe: 1, gruende, treffer: [], pfade, ausloeser: ausloeserPfad(pfade, geschuetzt) };
}

const normPfad = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");

/** Die Pfade aus dem Abschnitt `name` (Config `sprache.spezifikation.pfade`, kein Standardwert) eines Ticket-Bodys: `{pfade, fehler}` (`fehler` ist `null` oder ein Text; jeder Fehler ist Stufe 2). Sonstiger Text ist kein Eingang. Pur. */
export function pfadeAusTicket(body, name) {
  if (typeof name !== "string" || name.trim() === "") return { pfade: [], fehler: "sprache.spezifikation.pfade fehlt (Name des Ticket-Abschnitts mit der Pfadliste in der Projekt-Config eintragen)" };
  const zeilen = abschnitt(body, [name.trim()]);
  if (zeilen === null) return { pfade: [], fehler: `Abschnitt „${name}“ fehlt` };
  const listen = zeilen.map((z) => /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(z)).filter((m) => m !== null);
  if (listen.length === 0) return { pfade: [], fehler: `Abschnitt „${name}“ ohne Listenzeile (leer)` };
  const pfade = [];
  for (const m of listen) {
    const rest = m[1].replace(/^\[[ xX]\]\s*/, "");
    const roh = /`([^`]+)`/.exec(rest)?.[1] ?? /^\S+/.exec(rest)?.[0].replace(/[,;:]+$/, "") ?? "";
    const pfad = normPfad(roh.trim());
    if (pfad === "") return { pfade: [], fehler: `Listenzeile ohne Pfad: ${m[1]}` };
    if (/[*?[]/.test(pfad)) return { pfade: [], fehler: `Glob nicht prüfbar: ${pfad}` };
    pfade.push(pfad);
  }
  return { pfade, fehler: null };
}

/** Lädt Basis, Leitplanken und Risiko-Muster über die injizierten Lader: `{fehler: string[], basis, leitplanken, risiko}`; jeder Ladefehler steht in `fehler`. */
export function ladeEingaenge({ ladeBasis = () => ladeStufe2Basis(), ladeText = () => ladeLeitplankenText(), ladeRisiko = () => ladeRisikoMuster(), ladeRisikoBasis = null } = {}) {
  const fehler = [];
  const hole = (name, f) => {
    try {
      return f();
    } catch (e) {
      fehler.push(`${name} nicht ladbar: ${meldung(e)}`);
      return null;
    }
  };
  const basis = hole("Stufe-2-Basis", ladeBasis);
  const text = hole("Leitplanken", ladeText);
  const leitplanken = text === null ? null : { gate: stufe2Leitplanken(text), alle: alleLeitplanken(text) };
  if (leitplanken !== null && leitplanken.gate === null) fehler.push("Leitplanken nicht ladbar: .github/protected-paths.json ist kein gültiges JSON oder die Gruppe gate ist kein Array");
  const risiko = hole("Projekt-Config", () => (ladeRisikoBasis === null ? ladeRisiko() : vereinigeRisiko(ladeRisikoBasis(), ladeRisiko())));
  return { fehler, basis, leitplanken, risiko };
}

export const zwei = (grund) => ({ stufe: 2, gruende: [grund], treffer: [], pfade: [] });

/** Die Risikostufe des Diffs `base...head` (mit `zweiPunkt`: `base..head`, für einen Commit `sha^..sha`) über die injizierte git-Funktion; jeder Fehler ist Stufe 2 mit Grund. `core.quotepath=off` hält Umlaut-Pfade unquotiert. */
export function risikostufeAusGit(git, base, head = "HEAD", { ladeBasis, ladeText, ladeRisiko, ladeRisikoBasis = () => risikoDerBasis(git, base), zweiPunkt = false } = {}) {
  const e = ladeEingaenge({ ladeBasis, ladeText, ladeRisiko, ladeRisikoBasis });
  if (e.fehler.length > 0) return zwei(e.fehler.join("; "));
  try {
    const ausgabe = git(["-c", "core.quotepath=off", "diff", "--numstat", "--no-renames", `${base}${zweiPunkt ? ".." : "..."}${head}`]);
    return bestimmeRisikostufe({ eintraege: parseNumstatNoRenames(ausgabe), basis: e.basis, leitplanken: e.leitplanken, risiko: e.risiko });
  } catch (err) {
    return zwei(`git-Fehler beim Zählen des Diffs: ${meldung(err)}`);
  }
}

/** Die Prognose aus geplanten Pfaden (ohne Zeilen); leere Liste und Ladefehler sind Stufe 2. */
export function risikostufeAusPfaden(pfade, { ladeBasis, ladeText, ladeRisiko } = {}) {
  const e = ladeEingaenge({ ladeBasis, ladeText, ladeRisiko });
  if (e.fehler.length > 0) return zwei(e.fehler.join("; "));
  return bestimmeRisikostufe({ eintraege: pfade.map((pfad) => ({ pfad: normPfad(pfad) })), basis: e.basis, leitplanken: e.leitplanken, risiko: e.risiko, prognose: true });
}

/** Die wirksame Liste: `{zeilen: [{muster, quelle}], fehler: string[]}` aus Basis, Leitplanken und Risiko-Muster; ein nicht ladbarer Teil steht in `fehler`. */
export function wirksameListe({ ladeBasis, ladeText, ladeRisiko } = {}) {
  const e = ladeEingaenge({ ladeBasis, ladeText, ladeRisiko });
  const zeilen = [];
  for (const [kat, muster] of Object.entries(e.basis?.kategorien ?? {})) zeilen.push(...muster.map((m) => ({ muster: m, quelle: `basis:${kat}` })));
  if (e.leitplanken?.gate) zeilen.push(...e.leitplanken.gate.muster.map((m) => ({ muster: m, quelle: `leitplanken:${e.leitplanken.gate.gruppe}` })));
  if (Array.isArray(e.risiko?.muster)) zeilen.push(...e.risiko.muster.map((m) => ({ muster: m, quelle: `risiko:${e.risiko.quelle}` })));
  else if (e.risiko !== null) e.fehler.push(`Risiko-Muster nicht ladbar: ${e.risiko.fehler?.join("; ") ?? "keine Muster"}`);
  return { zeilen, fehler: e.fehler };
}
