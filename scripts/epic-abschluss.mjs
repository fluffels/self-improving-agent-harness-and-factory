#!/usr/bin/env node
/**
 * Epic-Abschluss (factory#507 L4): ein aufgeteiltes Epic bleibt offen und schließt, sobald sein letztes Kind geschlossen ist.
 *
 *   node scripts/epic-abschluss.mjs <kind-nr>   # Elternteil des geschlossenen Kindes prüfen, bei „alle Kinder zu“ kommentieren und schließen
 *   node scripts/epic-abschluss.mjs --alle      # alle offenen Epics des Repos so prüfen (täglicher Rückfall)
 *
 * Läuft im Workflow `epic-abschluss.yml` mit `GITHUB_TOKEN` (`issues: write`) ohne Install: nur Node-Builtins und relative Importe. Gelesen werden nur
 * Nummern und Zustände (nie Titel oder Text), der Kommentar hat festen Text mit Nummern. Repo aus `GITHUB_REPOSITORY`; Entscheidung und Grenzen: `epic-lib.mjs`.
 */
import { AUFRUF_EXIT, direktaufruf, flagsLesen } from "./flag-lib.mjs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { istRepoForm, zerlegeRepo } from "./repo-form.mjs";
import { abschlussEntscheidung } from "./epic-lib.mjs";

const EP = "parent{ number state repository{ nameWithOwner } subIssues(first:100){ totalCount nodes{ number state } } }";
const FRAGE_ELTERN = `query($o:String!,$n:String!,$k:Int!){ repository(owner:$o,name:$n){ issue(number:$k){ ${EP} } } }`;
const FRAGE_ALLE =
  "query($o:String!,$n:String!,$c:String){ repository(owner:$o,name:$n){ issues(states:OPEN, first:100, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ number state repository{ nameWithOwner } subIssues(first:100){ totalCount nodes{ number state } } } } } }";
const MAX_SEITEN = 20;
const AUFRUF = "Aufruf: node scripts/epic-abschluss.mjs <kind-nr> | --alle";

/** Pur: der feste Kommentartext (nur Nummern, kein Fremdtext). */
export const abschlussKommentar = (kinder) => `Alle ${kinder.length} Kinder geschlossen (${kinder.map((n) => `#${n}`).join(", ")}): Epic abgeschlossen.`;

/** Pur: prüft den Aufruf; `{ fehler }`, `{ kind }` oder `{ alle }`. Läuft vor jedem I/O. */
export function pruefe(argv) {
  const r = flagsLesen(argv, { alle: { type: "boolean" } }, { positionale: true });
  if (r.fehler) return { fehler: r.fehler.text };
  if (r.werte.alle) return r.positionale.length ? { fehler: "--alle und <kind-nr> schließen sich aus" } : { alle: true };
  const [nr, ...rest] = r.positionale;
  if (rest.length || !/^[1-9]\d{0,9}$/.test(nr ?? "")) return { fehler: "<kind-nr> fehlt oder ist keine positive Ganzzahl" };
  return { kind: Number(nr) };
}

/** Das eine Elternteil: Entscheidung, bei `schliessen` Kommentar und Close. Gibt die Ausgabezeile zurück. */
function bearbeite(parent, io) {
  const e = abschlussEntscheidung({ repo: io.repo, parent });
  const nr = parent?.number;
  if (e.aktion !== "schliessen") return e.aktion === "offen" ? `EPIC #${nr}: bleibt offen (${e.grund})` : `EPIC: nichts zu tun (${e.grund})`;
  io.schliesse(nr, abschlussKommentar(parent.subIssues.nodes.map((k) => k.number)));
  return `EPIC #${nr}: geschlossen (${e.grund})`;
}

/** Ausführung mit eingespritztem `io` (`repo`, `elternteil(kind)`, `offeneEpics()`, `schliesse(nr, text)`); Ergebnis `{ code, out, err }`. */
export function fuehreAus(argv, io) {
  const p = pruefe(argv);
  if (p.fehler) return { code: AUFRUF_EXIT, out: "", err: `${p.fehler}\n${AUFRUF}\n` };
  try {
    const eltern = p.alle ? io.offeneEpics() : [io.elternteil(p.kind)];
    const zeilen = eltern.map((e) => bearbeite(e, io));
    return { code: 0, out: `${zeilen.join("\n") || "Keine offenen Epics."}\n`, err: "" };
  } catch (e) {
    return { code: 1, out: "", err: `✖ ${fehlerText(e)}\nFix: GITHUB_REPOSITORY (owner/name), Token mit issues: write und gh prüfen\n` };
  }
}

/** Das echte io über `gh` (`exec` ist die Test-Naht von gh-cli). */
export function macheIo(repo, { exec } = {}) {
  const { owner, name } = zerlegeRepo(repo);
  const abfrage = (query, vars) => ghJson(["api", "graphql", "-f", `query=${query}`, "-f", `o=${owner}`, "-f", `n=${name}`, ...vars], { exec });
  return {
    repo,
    elternteil: (kind) => abfrage(FRAGE_ELTERN, ["-F", `k=${kind}`]).data.repository.issue?.parent ?? null,
    offeneEpics() {
      const alle = [];
      let cursor = null;
      for (let seite = 0; seite < MAX_SEITEN; seite += 1) {
        const r = abfrage(FRAGE_ALLE, cursor ? ["-f", `c=${cursor}`] : []).data.repository.issues;
        alle.push(...r.nodes.filter((i) => i.subIssues.totalCount > 0));
        if (!r.pageInfo.hasNextPage) return alle;
        cursor = r.pageInfo.endCursor;
      }
      throw new Error(`mehr als ${MAX_SEITEN} Seiten offener Issues`);
    },
    schliesse(nr, text) {
      ghText(["issue", "comment", String(nr), "--repo", repo, "--body", text], { exec });
      ghText(["issue", "close", String(nr), "--repo", repo, "--reason", "completed"], { exec });
    },
  };
}

function io() {
  const repo = process.env.GITHUB_REPOSITORY;
  if (istRepoForm(repo)) return macheIo(repo);
  // `direktaufruf` hat keinen Fehlerweg für `io`: der Fehler kommt erst beim Zugriff und wird von `fuehreAus` gemeldet.
  const wirf = () => {
    throw new Error("GITHUB_REPOSITORY fehlt oder hat nicht die Form owner/name");
  };
  return { repo, elternteil: wirf, offeneEpics: wirf, schliesse: wirf };
}

if (istDirektaufruf(import.meta.url)) {
  direktaufruf(process.argv.slice(2), {
    pruefe,
    fehlerErgebnis: (_argv, vorab) => ({ code: AUFRUF_EXIT, out: "", err: `${vorab.fehler}\n${AUFRUF}\n` }),
    io,
    fuehreAus,
  });
}
