// Kein Shebang: wird per `node scripts/regel-verfall.mjs` gestartet UND von test/harness/regel-verfall.test.ts importiert.
/**
 * Regel-Verfall (factory#608, Teil 2/4 von factory#517), ohne Agent, ohne Netz und Secret-Key:
 *
 *   node scripts/regel-verfall.mjs --kandidaten [--export <datei>…] [--heute JJJJ-MM-TT] [--json] [--register <datei>]
 *   node scripts/regel-verfall.mjs --generieren [--heute JJJJ-MM-TT] [--trocken] [--register <datei>]
 *   node scripts/regel-verfall.mjs --streich-pr [--export <datei>…] [--heute JJJJ-MM-TT] [--trocken] [--register <datei>]
 *   node scripts/regel-verfall.mjs --faellige-mergen [--trocken]
 *
 * `--kandidaten` listet jedes Ziel mit `heute >= ablauf` und ohne Fang in den letzten 30 Tagen (Messpunkte-Export der Quelle gate-fundquote:
 * `node scripts/gate-fundquote.mjs --waechter-dir test/harness`); „nicht messbar“ (kein Wächter, keine Messpunkte) steht getrennt und ist nie Kandidat,
 * Ziele der Liste `SICHERHEITS_AUSNAHMEN` sind nie Kandidat. `--generieren` legt für jede `test/harness/*.test.ts` und jede fett markierte Regel in
 * `AGENTS.md` ohne Verfall-Zeile eine an (`ablauf` = `aufgenommen` + 30 Tage), bestehende Zeilen bleiben unberührt.
 * `--streich-pr` (factory#610) legt je Kandidat ohne offenen Streich-PR einen Branch und einen PR an (Datei löschen bzw. die exakten Ankerzeilen entfernen, Registerzeile
 * `gestrichen`, Label `verfall-streich-pr`, Fangquote, Fenster und Rohwerte im Body); Sicherheits-Ausnahmen entstehen nie. `--faellige-mergen` mergt nur offene Streich-PRs mit
 * abgelaufener Widerspruchsfrist (14 Tage), ohne Widerspruch (Label `status:widerspruch` oder Kommentar einer vertrauten Person laut `fremdtext.mjs`) und mit grünen Required Checks.
 * Aufruf nur vom Analyse-Lauf oder von Hand, nie aus einem Workflow mit `GITHUB_TOKEN` (solche PRs starten keine CI); beide Modi brauchen `gh` und `git` mit Schreibrecht.
 * FABRIK-EIGEN: das Skript wird nie an Bezieher verteilt und bricht dort ab (Exit 4).
 * Exit 0 Bericht, 1 Lese- oder Registerfehler, 2 Aufruffehler, 4 Abbruch im Bezieher.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { istDatum, leseMesspunkte, pruefeRegister } from "./aenderungsregister-lib.mjs";
import { ghText } from "./gh-cli.mjs";
import { istVertraut, prBeitraege } from "./fremdtext-lib.mjs";
import {
  STREICH_LABEL,
  ankerAus,
  auditKommentar,
  fehlendeZeilen,
  kandidaten,
  mergeEntscheidung,
  planeStreichPRs,
  registerGestrichen,
  renderKandidaten,
  streichBranch,
  streichPlan,
  streichText,
} from "./regel-verfall-lib.mjs";

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
const REGISTER = join(WURZEL, ".github", "aenderungsregister.json");

export const aufrufHilfe = () =>
  "Aufruf: node scripts/regel-verfall.mjs --kandidaten [--export <datei>…] [--heute JJJJ-MM-TT] [--json] [--register <datei>]\n" +
  "        node scripts/regel-verfall.mjs --generieren [--heute JJJJ-MM-TT] [--trocken] [--register <datei>]\n" +
  "        node scripts/regel-verfall.mjs --streich-pr [--export <datei>…] [--heute JJJJ-MM-TT] [--trocken] [--register <datei>]\n" +
  "        node scripts/regel-verfall.mjs --faellige-mergen [--trocken]\n" +
  "Doku: Glossar-Zeilen Standard-Verfall und Sicherheits-Ausnahmeliste in docs/harness-glossar.md (factory#517).";

export function parseArgs(argv) {
  const optionen = {
    kandidaten: { type: "boolean" },
    generieren: { type: "boolean" },
    "streich-pr": { type: "boolean" },
    "faellige-mergen": { type: "boolean" },
    export: { type: "string", multiple: true },
    json: { type: "boolean" },
    heute: { type: "string" },
    trocken: { type: "boolean" },
    register: { type: "string" },
  };
  const { werte, fehler } = flagsLesen(argv, optionen);
  const a = {
    kandidaten: werte.kandidaten === true,
    generieren: werte.generieren === true,
    streichPr: werte["streich-pr"] === true,
    faelligeMergen: werte["faellige-mergen"] === true,
    exporte: werte.export ?? [],
    json: werte.json === true,
    heute: werte.heute,
    trocken: werte.trocken === true,
    register: werte.register ?? REGISTER,
  };
  if (fehler) a.fehler = fehler.text;
  else if ([a.kandidaten, a.generieren, a.streichPr, a.faelligeMergen].filter(Boolean).length !== 1) a.fehler = "genau einen Modus wählen: --kandidaten, --generieren, --streich-pr oder --faellige-mergen";
  else if (a.heute !== undefined && !istDatum(a.heute)) a.fehler = `--heute: Datum JJJJ-MM-TT erwartet, nicht ${a.heute}`;
  return a;
}

/** Wächter-Dateien: jede `test/harness/*.test.ts` (Pfad relativ zur Wurzel, sortiert). */
export const waechterPfade = (wurzel = WURZEL) =>
  readdirSync(join(wurzel, "test", "harness"))
    .filter((n) => n.endsWith(".test.ts"))
    .sort()
    .map((n) => `test/harness/${n}`);

/** Existiert das Ziel (Pfad, bei `#` auch der Anker als Überschrift oder bei `AGENTS.md` als fett markierte Regel)? */
export const zielExistiert = (ziel, wurzel = WURZEL) => {
  const [pfad, anker] = ziel.split("#");
  const voll = join(wurzel, pfad);
  if (!existsSync(voll)) return false;
  if (anker === undefined) return true;
  return pfad.endsWith(".md") && ankerAus(readFileSync(voll, "utf8"), pfad === "AGENTS.md").has(anker);
};

function ladeRegister(pfad, lies) {
  let register;
  try {
    register = JSON.parse(lies(pfad, "utf8"));
  } catch (e) {
    throw new Error(`Register ${pfad}: kein lesbares JSON (${e.message})`, { cause: e });
  }
  const fehler = pruefeRegister(register?.zeilen);
  if (fehler.length > 0) throw new Error(`Register ungültig:\n${fehler.join("\n")}`);
  return register;
}

function ladeExporte(pfade, lies) {
  const exporte = [];
  for (const pfad of pfade) {
    try {
      exporte.push(leseMesspunkte(JSON.parse(lies(pfad, "utf8")), pfad));
    } catch (e) {
      throw new Error(e.message.startsWith(pfad) ? e.message : `--export ${pfad}: ${e.message}`, { cause: e });
    }
  }
  return exporte;
}

const REGISTER_REL = ".github/aenderungsregister.json";
const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
const ghStandard = (args) => ghText(args, { timeout: 60_000 });

/** IO: Beiträge eines PR (Kommentare, Reviews, Review-Kommentare) mit der Vertrauensprüfung des Fremdtext-Gates (`fremdtext-lib.mjs`, dieselbe Liste wie `fremdtext.mjs`); jeder Fehler wirft (fail-closed: dann kein Merge). */
export const fremdtextTeile = (nr, gh = ghStandard) => {
  const json = (args) => JSON.parse(gh(args));
  const owner = json(["api", "repos/{owner}/{repo}"]).owner?.login;
  if (!owner) throw new Error("Repo-Owner nicht ermittelbar");
  return prBeitraege(nr, json).map((b) => ({ vertraut: istVertraut(b.user, owner), text: b.body ?? "" }));
};

/** IO: Required Checks eines PR (`gh pr checks` endet bei rot oder offen mit Exit ≠ 0, die JSON-Ausgabe steht dann in `stdout` des Fehlers); nicht lesbar ist `null`. */
export const pflichtChecks = (nr, gh = ghStandard) => {
  let roh;
  try {
    roh = gh(["pr", "checks", String(nr), "--required", "--json", "name,bucket"]);
  } catch (e) {
    roh = e?.stdout;
  }
  try {
    return JSON.parse(String(roh));
  } catch {
    return null;
  }
};

/** IO: Streich-PR für einen Kandidaten in einem frischen Worktree von `origin/main` (Haupt-Checkout bleibt unberührt); Rückgabe: PR-URL oder „übersprungen: <Grund>“. */
export function streichAnlegen(k, { fenster, heute }, io = { git, gh: ghStandard, wurzel: WURZEL }) {
  const { git, gh } = io;
  const tmp = mkdtempSync(join(tmpdir(), "regel-verfall-"));
  const wt = join(tmp, "wt");
  const branch = streichBranch(k.id);
  try {
    git(["-C", io.wurzel, "fetch", "origin", "main"]);
    git(["-C", io.wurzel, "worktree", "add", "-b", branch, wt, "origin/main"]);
    const datei = join(wt, k.ziel.split("#")[0]);
    const plan = streichPlan(k.ziel, existsSync(datei) ? readFileSync(datei, "utf8") : undefined);
    if (plan.aktion === "keine") return `übersprungen: ${plan.grund}`;
    if (plan.aktion === "loeschen") unlinkSync(datei);
    else writeFileSync(datei, plan.neuerText);
    const registerDatei = join(wt, REGISTER_REL);
    writeFileSync(registerDatei, `${JSON.stringify(registerGestrichen(JSON.parse(readFileSync(registerDatei, "utf8")), k.id, heute), null, 2)}\n`);
    const text = streichText(k, { fenster, heute, plan });
    git(["-C", wt, "add", "-A"]);
    git(["-C", wt, "commit", "-m", text.commit, ...text.nachweis.flatMap((z) => ["-m", z])]);
    git(["-C", wt, "push", "-u", "origin", branch]);
    try {
      gh(["label", "create", STREICH_LABEL, "--description", "Streich-PR des Regel-Verfalls (factory#517)", "--color", "ededed"]);
    } catch {
      // Label existiert schon.
    }
    return gh(["pr", "create", "--base", "main", "--head", branch, "--title", text.titel, "--body", text.body, "--label", STREICH_LABEL]).trim();
  } finally {
    try {
      git(["-C", io.wurzel, "worktree", "remove", "--force", wt]);
      git(["-C", io.wurzel, "branch", "-D", branch]);
    } catch {
      // schon weg
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

const offeneStreichPRs = (d, felder) => JSON.parse(d.gh(["pr", "list", "--label", STREICH_LABEL, "--state", "open", "--limit", "200", "--json", felder]));

/** Modus `--streich-pr`: je Kandidat ohne offenen Streich-PR ein PR; Fehler eines Kandidaten stoppen die übrigen nicht, Exit 1 am Ende. */
function streichPrModus(args, register, d, heute) {
  const e = kandidaten(register, ladeExporte(args.exporte, d.lies), { heute });
  const plan = planeStreichPRs(e.kandidaten, offeneStreichPRs(d, "number,headRefName,body"));
  const zeilen = plan.uebersprungen.map((u) => `- ${u.id}: übersprungen (${u.grund})`);
  let fehler = 0;
  for (const k of plan.neu) {
    if (args.trocken) {
      zeilen.push(`- ${k.id} (${k.ziel}): Trocken, würde einen Streich-PR anlegen`);
      continue;
    }
    try {
      zeilen.push(`- ${k.id} (${k.ziel}): ${d.streichAnlegen(k, { fenster: e.fenster, heute })}`);
    } catch (err) {
      fehler += 1;
      zeilen.push(`- ${k.id} (${k.ziel}): Fehler: ${err.message}`);
    }
  }
  return { exitCode: fehler > 0 ? 1 : 0, text: `Streich-PRs: ${plan.neu.length} neu, ${plan.uebersprungen.length} übersprungen${zeilen.map((z) => `\n${z}`).join("")}` };
}

/** Das Ziel steht im Body des Streich-PRs (`ziel \`<ziel>\`` in den Rohwerten); ohne Treffer „unbekannt“. */
const zielAusBody = (body) => /ziel `([^`]+)`/.exec(String(body ?? ""))?.[1] ?? "unbekannt";

/** Modus `--faellige-mergen`: mergt jeden offenen Streich-PR, bei dem Frist, Widerspruchsfreiheit und grüne Required Checks gelten; jede Unklarheit ist kein Merge. */
function faelligeMergenModus(args, d) {
  const zeilen = [];
  let fehler = 0;
  for (const pr of offeneStreichPRs(d, "number,createdAt,labels,body")) {
    try {
      const ent = mergeEntscheidung({ labels: pr.labels.map((l) => l.name), teile: d.fremdtext(pr.number), checks: d.checks(pr.number), angelegt: pr.createdAt, jetzt: d.jetzt() });
      if (ent.merge && !args.trocken) {
        d.gh(["pr", "merge", String(pr.number), "--squash", "--delete-branch"]);
        d.gh(["pr", "comment", String(pr.number), "--body", auditKommentar(zielAusBody(pr.body))]);
      }
      zeilen.push(`- #${pr.number}: ${ent.merge ? (args.trocken ? "Trocken, würde mergen" : "gemergt") : `nicht gemergt (${ent.grund})`}`);
    } catch (err) {
      fehler += 1;
      zeilen.push(`- #${pr.number}: nicht gemergt (Fehler: ${err.message})`);
    }
  }
  return { exitCode: fehler > 0 ? 1 : 0, text: `Fällige Streich-PRs: ${zeilen.length} offen${zeilen.map((z) => `\n${z}`).join("")}` };
}

/** Ablauf ohne `process.exit` (testbar): `{ exitCode, text }`. `deps` (Tests): `heute`, `jetzt`, `bezieher`, `lies`, `schreibe`, `waechter`, `agentsText`, `gh`, `fremdtext`, `checks`, `streichAnlegen`. */
export function ausfuehren(args, deps = {}) {
  const d = {
    heute: new Date().toISOString().slice(0, 10),
    bezieher: istBezieher(WURZEL) || istBezieher(process.cwd()),
    lies: readFileSync,
    schreibe: writeFileSync,
    waechter: () => waechterPfade(),
    agentsText: () => readFileSync(join(WURZEL, "AGENTS.md"), "utf8"),
    jetzt: () => new Date(),
    gh: ghStandard,
    fremdtext: fremdtextTeile,
    checks: pflichtChecks,
    streichAnlegen,
    ...deps,
  };
  if (d.bezieher) return { exitCode: 4, text: "Abbruch: fabrik-eigen. Der Regel-Verfall wird nie an Bezieher verteilt und läuft dort nie." };
  if (args.fehler) return { exitCode: AUFRUF_EXIT, text: `${args.fehler}\n${aufrufHilfe()}` };
  const heute = args.heute ?? d.heute;
  try {
    if (args.faelligeMergen) return faelligeMergenModus(args, d);
    const register = ladeRegister(args.register, d.lies);
    if (args.streichPr) return streichPrModus(args, register, d, heute);
    if (args.generieren) {
      const neu = fehlendeZeilen({ zeilen: register.zeilen, waechterPfade: d.waechter(), agentsText: d.agentsText(), heute });
      if (!args.trocken && neu.length > 0) d.schreibe(args.register, `${JSON.stringify({ ...register, zeilen: [...register.zeilen, ...neu] }, null, 2)}\n`);
      return { exitCode: 0, text: `${args.trocken ? "Trocken: würde anlegen" : "Angelegt"}: ${neu.length} Verfall-Zeilen${neu.map((z) => `\n- ${z.id} (${z.ziel})`).join("")}` };
    }
    const ergebnis = kandidaten(register, ladeExporte(args.exporte, d.lies), { heute });
    return { exitCode: 0, text: args.json ? JSON.stringify(ergebnis, null, 2) : renderKandidaten(ergebnis) };
  } catch (e) {
    return { exitCode: 1, text: `Fehler: ${e.message}` };
  }
}

function main() {
  const { exitCode, text } = ausfuehren(parseArgs(process.argv.slice(2)));
  (exitCode === 0 ? console.log : console.error)(text);
  process.exitCode = exitCode;
}

if (istDirektaufruf(import.meta.url)) main();
