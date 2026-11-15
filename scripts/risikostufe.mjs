// Kein Shebang (Konvention der Skripte, die ein Test importiert).
/**
 * Risikostufe des Diffs (factory#525): 0, 1 oder 2. Die Regel (Stufe-2-Basis, Leitplanken-Gruppe `gate`, Risikoklasse hoch, Stufe 0, Fail-closed) steht in
 * `risikostufe-lib.mjs`; dieses Skript ist der Einstieg. Es wirkt noch nicht auf Ablauf und CI.
 *
 *   node scripts/risikostufe.mjs                  Diff gegen die Vergleichs-Basis (wie die Gates, `resolveBase`) bis HEAD
 *   node scripts/risikostufe.mjs --commit <sha>   ein einzelner Commit (`<sha>^..<sha>`)
 *   node scripts/risikostufe.mjs --pfade <p…>     Prognose aus geplanten Pfaden (ohne Zeilen)
 *   node scripts/risikostufe.mjs --ticket <nr>    Prognose aus dem Abschnitt „Pfade“ des Tickets (nur der Body, kein sonstiger Text)
 *   node scripts/risikostufe.mjs --liste          die wirksame Muster-Liste (`<muster>⇥<quelle>`); nicht ladbar: Zeile „nicht ladbar“ und Exit 1
 *   --json                                        Treffer und Gründe als JSON
 *
 * Ausgabe: `RISIKOSTUFE: <0|1|2> — <Gründe>`; Exit 0 bei berechneter Stufe, 2 bei einem Aufruf-Fehler (`AUFRUF_EXIT`). Jeder Fehler beim Rechnen ist Stufe 2 (fail-closed), kein Absturz.
 */
import { execFileSync } from "node:child_process";
import { resolveBase } from "./check-basis.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { fehlerText, ghJson } from "./gh-cli.mjs";
import { istFremdeingang } from "./fremdtext-lib.mjs";
import { ladeProjektConfig } from "./projekt-config-lib.mjs";
import { pfadeAusTicket, risikostufeAusGit, risikostufeAusPfaden, wirksameListe } from "./risikostufe-lib.mjs";

const AUFRUF = "Aufruf: node scripts/risikostufe.mjs [--commit <sha> | --pfade <pfad…> | --ticket <nr> | --liste] [--json]";
const FLAGS = { commit: { type: "string" }, ticket: { type: "string" }, pfade: { type: "boolean" }, liste: { type: "boolean" }, json: { type: "boolean" } };
const MAX_GRUENDE_TEXT = 5;

/** Die Zeile für Menschen: `RISIKOSTUFE: <n> — <Gründe>`, höchstens `MAX_GRUENDE_TEXT` Gründe plus Zahl der weiteren (`--json` trägt alle). Pur. */
export const stufeZeile = ({ stufe, gruende }) => {
  const rest = gruende.length - MAX_GRUENDE_TEXT;
  return `RISIKOSTUFE: ${stufe} — ${gruende.slice(0, MAX_GRUENDE_TEXT).join("; ")}${rest > 0 ? ` (+${rest} weitere)` : ""}`;
};

const zwei = (grund) => ({ stufe: 2, gruende: [grund], treffer: [], pfade: [] });
const aufrufFehler = (text) => ({ code: AUFRUF_EXIT, ausgabe: `${text}\n${AUFRUF}` });

/** Prüft die Flag-Kombination: genau ein Modus, Positionale nur zu `--pfade`, `--ticket` nur als Zahl. Liefert den Fehlertext oder `null`. Pur. */
function aufrufFehlerText({ commit, ticket, pfade, liste }, pos) {
  const modi = [commit !== undefined, ticket !== undefined, pfade === true, liste === true].filter(Boolean).length;
  if (modi > 1) return "nur ein Modus (--commit, --pfade, --ticket, --liste) je Aufruf";
  if (pos.length > 0 && !pfade) return `Unbekanntes Argument: ${pos[0]}`;
  if (ticket !== undefined && !/^\d+$/.test(ticket)) return "--ticket braucht eine Ticketnummer";
  return null;
}

/** Die Pfade aus dem Ticket: `{pfade}` oder `{grund}` (Stufe 2) bei Lese-, Config-, Fremdeingang- und Parserfehlern; gelesen wird nur der Body. */
function ticketEingang(nr, { ghJson: gh, ladeConfig }) {
  let repo;
  let issue;
  try {
    repo = gh(["api", "repos/{owner}/{repo}"]);
    issue = gh(["api", `repos/{owner}/{repo}/issues/${nr}`]);
  } catch (e) {
    return { grund: `Ticket #${nr} nicht lesbar: ${fehlerText(e)}` };
  }
  if (issue?.pull_request) return { grund: `#${nr} ist ein PR, kein Ticket` };
  const owner = repo?.owner?.login;
  if (typeof owner !== "string" || owner === "") return { grund: "Repo-Besitzer nicht lesbar" };
  try {
    const f = istFremdeingang(issue, owner, { config: ladeConfig() });
    if (f.fremdeingang) return { grund: `#${nr} ist ein Fremdeingang (${f.grund}): nicht ausgewertet` };
  } catch (e) {
    return { grund: `Fremdeingang-Prüfung nicht möglich: ${meldung(e)}` };
  }
  const p = pfadeAusTicket(issue.body);
  return p.fehler === null ? { pfade: p.pfade } : { grund: `Ticket #${nr}: ${p.fehler}` };
}

const meldung = (e) => (e instanceof Error ? e.message : String(e));

function listeAusgabe(io, json) {
  const l = wirksameListe(io);
  const fehlerZeilen = l.fehler.map((f) => `nicht ladbar: ${f.replace(/ nicht ladbar:/, " —")}`);
  const ausgabe = json ? JSON.stringify({ zeilen: l.zeilen, fehler: l.fehler }) : [...l.zeilen.map((z) => `${z.muster}\t${z.quelle}`), ...fehlerZeilen].join("\n");
  return { code: l.fehler.length > 0 ? 1 : 0, ausgabe };
}

/** Rechnet die Stufe zu `argv`; alle I/O-Naht injizierbar. Liefert `{code, ausgabe}` (Exit-Code und stdout/stderr-Text). */
export function laufe(argv, io = {}) {
  const { git = (a) => execFileSync("git", a, { encoding: "utf8" }), env = process.env, ghJson: gh = (a) => ghJson(a), ladeConfig = () => ladeProjektConfig({ pruefen: false }), ...lader } = io;
  const r = flagsLesen(argv, FLAGS, { positionale: true });
  if (r.fehler) return aufrufFehler(r.fehler.text);
  const { commit, ticket, pfade, liste, json } = r.werte;
  const fehler = aufrufFehlerText(r.werte, r.positionale);
  if (fehler !== null) return aufrufFehler(fehler);
  if (liste) return listeAusgabe(lader, json);
  const antwort = (e) => ({ code: 0, ausgabe: json ? JSON.stringify({ stufe: e.stufe, gruende: e.gruende, treffer: e.treffer, pfade: e.pfade }) : stufeZeile(e) });
  if (pfade) return antwort(risikostufeAusPfaden(r.positionale, lader));
  if (ticket !== undefined) {
    const e = ticketEingang(ticket, { ghJson: gh, ladeConfig });
    return antwort(e.pfade ? risikostufeAusPfaden(e.pfade, lader) : zwei(e.grund));
  }
  if (commit !== undefined) return antwort(risikostufeAusGit(git, `${commit}^`, commit, { ...lader, zweiPunkt: true }));
  const base = resolveBase(git, env);
  return antwort(base ? risikostufeAusGit(git, base, "HEAD", lader) : zwei("keine Vergleichs-Basis auflösbar"));
}

function main(argv = process.argv.slice(2)) {
  const r = laufe(argv);
  (r.code === 2 ? console.error : console.log)(r.ausgabe);
  process.exit(r.code);
}

if (istDirektaufruf(import.meta.url)) main();
