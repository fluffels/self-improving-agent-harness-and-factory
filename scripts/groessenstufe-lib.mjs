// Kein Shebang, kein Direktaufruf: Lib der Größenstufe (factory#271). Das Einstiegsskript `groessenstufe.mjs` ruft sie auf, ebenso die
// Nachweis-Wächter (Konvention #1398: Einstiegsskripte importieren nicht voneinander; der Glob /scripts/*-lib.mjs gehört in protected-paths).
/**
 * Größenstufe eines Diffs (factory#271): die eine Stelle (SSOT) für „klein“. Gleiche Pflicht, kleinere Besetzung: Stufe `S` darf mit
 * Planer-Skizze (oder `Plan: ohne — klein: <Begründung>`), einer Kombi-Lens statt drei Brillen und ohne Abnahme bei nicht beobachtbarem
 * Verhalten auskommen; alles andere ist `voll`. Die Stufe wird aus dem Diff berechnet (Umsetzer und Wächter rechnen dasselbe), nie behauptet.
 *
 * Kriterium `S`, alle Bedingungen gemeinsam:
 *  - höchstens `GROESSENSTUFE_S.maxDateien` Dateien und `GROESSENSTUFE_S.maxZeilen` Zeilen (hinzugefügt + gelöscht laut
 *    `git diff --numstat --no-renames`, ohne Ausnahme für generierte Dateien, auch reines Markdown hat keinen Freibetrag);
 *  - kein Pfad aus `.github/protected-paths.json` (alle Gruppen) und keiner aus `GRUNDSCHUTZ` (Harness-Pfade, Gates, Hooks, Agenten, Skills,
 *    Abhängigkeiten), auch bei einer einzigen Zeile; ein Umzug zählt als Löschen plus Anlegen (`--no-renames`), trifft also den alten Pfad mit.
 *  - kein Pfad der Risikoklasse hoch (factory#333, `bestimmeRisikoklasse`: Muster der Projekt-Config `risiko.hoch`, sonst `RISIKO_STANDARDLISTE`; ein reiner `*.md`-Diff ist `doku`, `istDokuDiff` ist die einzige Stelle dieser Regel).
 * Fail-closed (immer `voll`, Risikoklasse `hoch`): nicht ladbare oder ungültige Risiko-Muster, leere oder nicht lesbare Dateiliste, Binärdatei (numstat `-`), ein von git quotierter Pfad, nicht ladbare
 * Schutzliste, git-Fehler. Die Schutzliste kommt vom Arbeitsbaum; eine Änderung an `.github/` ist wegen `GRUNDSCHUTZ` ohnehin `voll`.
 * Die Prognose (`prognose: true`, Planer vor der Umsetzung) kennt keine Zeilen und prüft nur Dateizahl und Pfade.
 */
import { readFileSync } from "node:fs";
import { schutzlistenMuster, trifftLeitplanke } from "./besitz-extraktion.mjs";
import { pruefeRisiko } from "./projekt-config-bloecke.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";

/** Obergrenzen der Stufe S (Summe über den ganzen Diff). */
export const GROESSENSTUFE_S = Object.freeze({ maxDateien: 3, maxZeilen: 60 });

/** Pfade, die nie Stufe S sind, auch wenn `.github/protected-paths.json` sie nicht (oder in einem Bezieher anders) nennt (Muster wie CODEOWNERS, `trifftLeitplanke`). */
export const GRUNDSCHUTZ = Object.freeze([
  "AGENTS.md",
  "/.claude/",
  "/.agents/",
  "/.githooks/",
  "/.github/",
  "/.factory/",
  "/.codex/",
  "/.mcp.json",
  "/scripts/",
  "/test/harness/",
  "/package.json",
  "/package-lock.json",
]);

/** Standardliste der Risikoklasse hoch (factory#333): projektneutrale Pfadmuster (Syntax wie `.github/protected-paths.json`, Groß-/Kleinschreibung egal).
 *  Gilt ohne Projekt-Config-Block `risiko`; ein Block ersetzt sie (nicht additiv). Teilwort-Muster sind bewusst grob: Fehlalarme gehen in die strenge Richtung. */
export const RISIKO_STANDARDLISTE = Object.freeze([
  // Hooks, Guards, CI
  "/.githooks/", "/.claude/hooks/", "/.claude/settings.json", "/.codex/", "/.mcp.json", "/.github/workflows/", "*guard*",
  // Authentifizierung und Berechtigung
  "*auth*", "*login*", "*session*", "*permission*",
  // Krypto und Geheimnisse
  "*crypt*", "*secret*", "*credential*", "*password*", ".env*", "*.pem", "*.key",
  // Personenbezogene Daten
  "*privacy*", "*consent*", "*personal*", "*gdpr*", "*dsgvo*",
  // Persistenz
  "*migration*", "*persist*", "*storage*", "*database*", "db/",
]);

const STANDARD_RISIKO = Object.freeze({ muster: RISIKO_STANDARDLISTE, quelle: "Standardliste" });

/** Wahr nur bei nicht-leerem Array, dessen Einträge alle nicht-leere Texte auf `.md` sind: die einzige Stelle der Doku-Regel (factory#333). Pur. */
export function istDokuDiff(pfade) {
  if (!Array.isArray(pfade) || pfade.length === 0) return false;
  if (pfade.some((d) => typeof d !== "string" || d.trim() === "")) return false;
  return pfade.every((d) => /\.md$/i.test(d.trim()));
}

/** Die Risiko-Muster aus einer geladenen Projekt-Config: ohne Block `risiko` die Standardliste, sonst `risiko.hoch` (ersetzt sie); ein ungültiger Block ergibt `muster: null` samt `fehler`. Pur. */
export function risikoMusterAus(config) {
  if (config?.risiko === undefined) return { ...STANDARD_RISIKO };
  const fehler = pruefeRisiko(config.risiko);
  if (fehler.length > 0) return { muster: null, quelle: "Projekt-Config", fehler };
  return { muster: config.risiko.hoch, quelle: "Projekt-Config" };
}

/** Lädt die Risiko-Muster aus der Projekt-Config (ungeprüft geladen, geprüft wird nur der Block `risiko`); wirft, wenn die Config fehlt oder kein JSON ist. */
export function ladeRisikoMuster({ pfad } = {}) {
  return risikoMusterAus(ladeProjektConfig({ pfad, pruefen: false }));
}

const pfadFehler = (p) => {
  if (typeof p !== "string" || p.trim() === "") return "Dateiliste nicht lesbar (Eintrag ohne Pfad)";
  return p.startsWith('"') ? `Pfad von git quotiert (${p}): nicht prüfbar` : null;
};

/**
 * Die Risikoklasse eines Diffs (factory#333): `{klasse: "hoch" | "normal" | "doku", quelle, treffer: [{pfad, muster}], gruende}`.
 * Reihenfolge: nicht lesbare Pfadliste → hoch (fail-closed); reiner `*.md`-Diff → doku (Vorrang vor Mustertreffern im Namen); keine Muster → hoch;
 * ein Pfad trifft ein Muster → hoch; sonst normal. `risiko`: `{muster, quelle, fehler?}` (`risikoMusterAus`). Pur.
 */
export function bestimmeRisikoklasse(pfade, risiko) {
  const quelle = risiko?.quelle ?? "Standardliste";
  const hoch = (gruende, treffer = []) => ({ klasse: "hoch", quelle, treffer, gruende });
  if (!Array.isArray(pfade) || pfade.length === 0) return hoch(["keine Dateiliste (leer oder nicht lesbar)"]);
  const kaputt = pfade.map(pfadFehler).find((f) => f !== null);
  if (kaputt) return hoch([kaputt]);
  if (istDokuDiff(pfade)) return { klasse: "doku", quelle, treffer: [], gruende: ["nur *.md"] };
  const muster = risiko?.muster;
  if (!Array.isArray(muster) || muster.length === 0) return hoch(risiko?.fehler?.length ? risiko.fehler : ["keine Risiko-Muster geladen"]);
  const treffer = pfade.flatMap((pfad) => muster.filter((m) => trifftLeitplanke(pfad.toLowerCase(), [String(m).toLowerCase()])).map((m) => ({ pfad, muster: m })));
  if (treffer.length > 0) return hoch(treffer.map((t) => `${t.pfad} trifft ${t.muster} (${quelle})`), treffer);
  return { klasse: "normal", quelle, treffer: [], gruende: [`kein Pfad trifft ein Risiko-Muster (${quelle})`] };
}

/** Grund für die Größenstufe bei Klasse hoch: erster Treffer bzw. Grund, mit der Zahl der weiteren. */
function risikoGrund(r) {
  const [erster, ...rest] = r.gruende;
  return `Risikoklasse hoch: ${erster}${rest.length > 0 ? ` (+${rest.length} weitere)` : ""}`;
}

/** Risiko-Block eines fail-closed Ergebnisses ohne Rechnung (Schutzliste, git oder Config nicht ladbar). */
const risikoHoch = (grund, quelle = "Standardliste") => ({ klasse: "hoch", quelle, treffer: [], gruende: [grund] });

/**
 * Liest `git diff --numstat --no-renames` (Zeile `<hinzu>\t<weg>\t<pfad>`) in `[{pfad, zeilen}]`; `zeilen` ist die Summe, bei Binärdateien (`-`) `null`.
 * Eine Zeile, die nicht passt, wird ein Eintrag mit `pfad: null` (der Aufrufer wertet sie fail-closed). Pur.
 */
export function parseNumstatNoRenames(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .filter((z) => z.trim() !== "")
    .map((z) => {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(z);
      if (!m) return { pfad: null, zeilen: null };
      return { pfad: m[3], zeilen: m[1] === "-" || m[2] === "-" ? null : Number(m[1]) + Number(m[2]) };
    });
}

/** Gründe, warum ein einzelner Eintrag den Diff `voll` macht (leer = unauffällig). */
function eintragsGruende(e, muster, prognose) {
  if (typeof e?.pfad !== "string" || e.pfad.trim() === "") return ["Dateiliste nicht lesbar (Eintrag ohne Pfad)"];
  if (e.pfad.startsWith('"')) return [`Pfad von git quotiert (${e.pfad}): nicht prüfbar`];
  const gruende = [];
  if (trifftLeitplanke(e.pfad, muster)) gruende.push(`${e.pfad} liegt in einem geschützten Pfad (Leitplanke, Gate, Hook, Agent oder Skill)`);
  if (!prognose && !Number.isInteger(e.zeilen)) gruende.push(`${e.pfad} ist binär oder ohne lesbare Zeilenzahl (Zeilen nicht zählbar)`);
  return gruende;
}

/**
 * Bestimmt die Größenstufe. `eintraege`: `[{pfad, zeilen}]` (`zeilen` `null` = binär; bei `prognose` darf es fehlen); `muster`: die Muster aus
 * `.github/protected-paths.json` (Pflicht, ein leeres Array ist ein Ladefehler und wird `voll`); `GRUNDSCHUTZ` kommt immer dazu.
 * `risiko` (`risikoMusterAus`, Standard: `RISIKO_STANDARDLISTE`): Klasse `hoch` ist nie `S` (factory#333). Der Standard dient Pur-Tests, echte Aufrufer übergeben ihn.
 * Liefert `{stufe: "S" | "voll", gruende: [...], risiko}`; `gruende` ist bei `S` leer. Pur.
 */
export function bestimmeGroessenstufe({ eintraege, muster, prognose = false, risiko = STANDARD_RISIKO }) {
  const klasse = bestimmeRisikoklasse(Array.isArray(eintraege) ? eintraege.map((e) => e?.pfad) : null, risiko);
  const voll = (...gruende) => ({ stufe: "voll", gruende, risiko: klasse });
  if (!Array.isArray(muster) || muster.length === 0) return voll("Schutzliste (protected-paths) leer oder nicht geladen");
  if (!Array.isArray(eintraege) || eintraege.length === 0) return voll("keine Dateiliste (leer oder nicht lesbar)");
  const alle = [...muster, ...GRUNDSCHUTZ];
  const gruende = eintraege.flatMap((e) => eintragsGruende(e, alle, prognose));
  if (eintraege.length > GROESSENSTUFE_S.maxDateien) gruende.push(`${eintraege.length} Dateien (höchstens ${GROESSENSTUFE_S.maxDateien})`);
  if (!prognose) {
    const summe = eintraege.reduce((a, e) => a + (Number.isInteger(e?.zeilen) ? e.zeilen : 0), 0);
    if (summe > GROESSENSTUFE_S.maxZeilen) gruende.push(`${summe} Zeilen (höchstens ${GROESSENSTUFE_S.maxZeilen})`);
  }
  if (klasse.klasse === "hoch") gruende.push(risikoGrund(klasse));
  return { stufe: gruende.length === 0 ? "S" : "voll", gruende, risiko: klasse };
}

/** Leitplanken-Muster: Vereinigung der String-Arrays in `.github/protected-paths.json` des Arbeitsbaums; wirft, wenn die Datei fehlt oder kein JSON ist. */
export function ladeLeitplankenMuster(quelle = new URL("../.github/protected-paths.json", import.meta.url)) {
  const muster = schutzlistenMuster(readFileSync(quelle, "utf8"));
  if (muster === null) throw new SyntaxError(".github/protected-paths.json: kein gültiges JSON");
  return muster;
}

/**
 * Die Größenstufe des Diffs `base...head` über die injizierte git-Funktion (`git(args)` liefert stdout, wirft bei Fehler). Fail-closed:
 * ein Fehler beim Laden der Schutzliste, der Risiko-Muster oder bei git ist `voll` (Risikoklasse `hoch`) mit dem Grund. Mit `zweiPunkt` gilt `base..head`
 * (für einen einzelnen Commit `sha^..sha`). `ladeRisiko` liefert die Risiko-Muster (Standard: Projekt-Config des Repos).
 */
export function groessenstufeAusGit(git, base, head = "HEAD", { ladeMuster = ladeLeitplankenMuster, ladeRisiko = () => ladeRisikoMuster(), zweiPunkt = false } = {}) {
  const meldung = (e) => (e instanceof Error ? e.message : String(e));
  let risiko;
  try {
    risiko = ladeRisiko();
  } catch (e) {
    risiko = { muster: null, quelle: "Projekt-Config", fehler: [`Projekt-Config nicht ladbar: ${meldung(e)}`] };
  }
  let muster;
  try {
    muster = ladeMuster();
  } catch (e) {
    const grund = `Schutzliste nicht ladbar: ${meldung(e)}`;
    return { stufe: "voll", gruende: [grund], risiko: risikoHoch(grund, risiko.quelle) };
  }
  try {
    const ausgabe = git(["diff", "--numstat", "--no-renames", `${base}${zweiPunkt ? ".." : "..."}${head}`]);
    return bestimmeGroessenstufe({ eintraege: parseNumstatNoRenames(ausgabe), muster, risiko });
  } catch (e) {
    const grund = `git-Fehler beim Zählen des Diffs: ${meldung(e)}`;
    return { stufe: "voll", gruende: [grund], risiko: risikoHoch(grund, risiko.quelle) };
  }
}
