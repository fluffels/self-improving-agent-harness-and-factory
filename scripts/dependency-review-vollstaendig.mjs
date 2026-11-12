#!/usr/bin/env node
/**
 * Dependency Review ohne Paging-Lücke (factory#395): ergänzt `actions/dependency-review-action`, die die Compare-API mit `per_page=5` ruft;
 * die API pagt nach Manifest und liefert ohne Link-Header nur das erste, ein Advisory in einem späteren Manifest (z. B. `pom.xml` neben
 * `package-lock.json`) bliebe unbemerkt. Dieses Skript fragt `dependency-graph/compare/<basis>...<kopf>` mit `--paginate` ab und wird rot
 * (Exit 1), wenn eine hinzugefügte oder geänderte Abhängigkeit ein Advisory ab der Schwere trägt.
 *
 * Aufruf: BASIS=<sha> KOPF=<sha> GITHUB_REPOSITORY=<owner/name> node scripts/dependency-review-vollstaendig.mjs --schwere <low|moderate|high|critical>
 * Exit: 0 kein Befund, 1 Befund, 2 falsche Bedienung, ungültige Eingabe oder Abfrage nicht möglich (fail-closed, auch ohne Dependency Graph).
 * Zählt: entfernte Abhängigkeiten nie, Dev-Scope nie; `runtime` und `unknown` ja; unbekannter Schwere-Text gilt als Treffer.
 * Bekannte Grenze: kein `allow-ghsas`, keine Lizenzprüfung (die Action bleibt davor und prüft Lizenzen).
 * Die Funktionen oben sind pur und getestet (test/dependency-review-vollstaendig.test.ts); die Abfrage `ladeVergleich` ist die IO-Naht.
 */
import { istDirektaufruf } from "./direktaufruf.mjs";
import { ghText } from "./gh-cli.mjs";

const RANG = { low: 1, moderate: 2, high: 3, critical: 4 };
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[\w.-]+\/[\w.-]+$/;
const EXIT_AUFRUF = 2;

function trifft(vuln, schwelle) {
  const text = String(vuln?.severity ?? "").toLowerCase();
  return !Object.hasOwn(RANG, text) || RANG[text] >= schwelle;
}

/** Pur: Befunde `{ manifest, name, version, ghsa, schwere }` aus der Compare-Antwort (Liste der Änderungen aller Manifeste). Wirft bei Nicht-Liste. */
export function befundeAusVergleich(eintraege, { schwere }) {
  if (!Array.isArray(eintraege)) throw new Error("Unerwartete Compare-Antwort (keine Liste).");
  if (eintraege.some((e) => e === null || typeof e !== "object" || Array.isArray(e))) throw new Error("Unerwartete Compare-Antwort (Eintrag ohne Objekt).");
  const schwelle = RANG[schwere];
  return eintraege
    .filter((e) => e?.change_type !== "removed" && e?.scope !== "development")
    .flatMap((e) =>
      (Array.isArray(e?.vulnerabilities) ? e.vulnerabilities : [])
        .filter((v) => trifft(v, schwelle))
        .map((v) => ({ manifest: String(e.manifest ?? "?"), name: String(e.name ?? "?"), version: String(e.version ?? "?"), ghsa: String(v?.advisory_ghsa_id ?? "?"), schwere: String(v?.severity ?? "unbekannt") })),
    );
}

/** Pur: verflacht die Seitenliste von `--slurp` zu einer Liste; jede Seite muss eine Liste sein, sonst wirft sie (fail-closed, kein stilles „kein Advisory“). */
export function flacheSeiten(seiten) {
  if (!Array.isArray(seiten) || seiten.some((s) => !Array.isArray(s))) throw new Error("Unerwartete Compare-Antwort (Seite ohne Liste).");
  return seiten.flat();
}

/** IO-Naht: alle Seiten der Compare-API ohne `per_page` (`--slurp` liefert eine Liste von Seiten). `lese` ist die Test-Naht für `ghText`. */
export function ladeVergleich(repo, basis, kopf, lese = ghText) {
  return flacheSeiten(JSON.parse(lese(["api", "--paginate", "--slurp", `repos/${repo}/dependency-graph/compare/${basis}...${kopf}`])));
}

function eingabe(argv, env) {
  const [flag, schwere, ...rest] = argv;
  if (flag !== "--schwere" || !Object.hasOwn(RANG, schwere) || rest.length > 0) return { fehler: `Aufruf: node scripts/dependency-review-vollstaendig.mjs --schwere <${Object.keys(RANG).join("|")}>` };
  const { GITHUB_REPOSITORY: repo = "", BASIS: basis = "", KOPF: kopf = "" } = env;
  if (!REPO.test(repo) || repo.split("/").some((t) => t === "." || t === "..")) return { fehler: "GITHUB_REPOSITORY muss die Form owner/name haben" };
  if (!SHA.test(basis) || !SHA.test(kopf)) return { fehler: "BASIS und KOPF müssen je ein 40-stelliger Commit-Hash (hex) sein" };
  return { schwere, repo, basis, kopf };
}

/** Einstieg. `deps` (Tests): `env`, `ladeVergleich(repo, basis, kopf)`, `log`, `err`. Rückgabe: Exit-Code. */
export function main(argv = process.argv.slice(2), { env = process.env, ladeVergleich: lade = (r, b, k) => ladeVergleich(r, b, k), log = console.log, err = console.error } = {}) {
  const e = eingabe(argv, env);
  if (e.fehler) {
    err(`✖ ${e.fehler}`);
    return EXIT_AUFRUF;
  }
  let befunde;
  try {
    befunde = befundeAusVergleich(lade(e.repo, e.basis, e.kopf), { schwere: e.schwere });
  } catch (fehl) {
    err(`✖ Compare-Abfrage fehlgeschlagen: ${fehl instanceof Error ? fehl.message : fehl}`);
    return EXIT_AUFRUF;
  }
  for (const b of befunde) log(`✖ ${b.ghsa} (${b.schwere}) in ${b.name} ${b.version} (${b.manifest})`);
  log(befunde.length > 0 ? `Dependency Review (vollständig): ${befunde.length} Befund(e) ab ${e.schwere}.` : `Dependency Review (vollständig): kein Advisory ab ${e.schwere}.`);
  return befunde.length > 0 ? 1 : 0;
}

if (istDirektaufruf(import.meta.url)) process.exitCode = main();
