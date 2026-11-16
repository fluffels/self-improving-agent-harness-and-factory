/**
 * Ticket-Anlage der Token-Analyse nach dem Plan-Review (factory#518, Teil 7/9). Fabrik-eigen, nicht im Besitz, nie in einem Bezieher.
 *   node scripts/token-analyse-tickets.mjs --review <datei> [--dry-run]
 * `<datei>` ist die Review-Datei (Format: Kopf von `token-analyse-tickets-lib.mjs`), sie nennt den Plan über `plan`. Fail-closed in drei Phasen:
 * erst alles prüfen (Review vollständig und abgeschlossen, Formen, Urteile, Sperrprüfung jedes öffentlichen Textes, Dublette des Folge-Tickets, Schnappschuss
 * in `FACTORY_ANALYSE_ABLAGE`), dann anlegen (Zeilen über `melden.mjs`, Tickets über `spezifikation.mjs anlegen`, genau ein Folge-Ticket je Lauf), dann der
 * Abschnitt „Plan-Review“ im jüngsten Schnappschuss. Ein Lauf-Protokoll `analyse-<Datum>-tickets.json` in der Ablage verhindert doppeltes Anlegen beim erneuten Aufruf.
 * Exit: 0 gut, 1 Abbruch oder Teil nicht angelegt (ungeprüft, abgewiesen), 2 Aufruf, 4 Bezieher. Der Body eines Tickets wird nie ausgegeben.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { flagsLesen } from "./flag-lib.mjs";
import { ghJson } from "./gh-cli.mjs";
import { istBezieher } from "./sync-stand-lib.mjs";
import { ablageFehler, abhaengigkeiten, ladeListe, realMitVorfahr } from "./token-analyse-ablage-lib.mjs";
import { letzterSchnappschuss } from "./token-analyse-freigabe-lib.mjs";
import { abschnittEinsetzen, folgeTicketBody, oeffentlichSauber, pruefeEingabe, reviewAbschnittMarkdown, urteileJeTeil } from "./token-analyse-tickets-lib.mjs";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const AUFRUF = "Aufruf: node scripts/token-analyse-tickets.mjs --review <datei> [--dry-run]";
const ab = (code, ...zeilen) => ({ code, zeilen });

function standardRunner(argv, { input, cwd } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8", shell: false, input, cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Nummer eines schon vorhandenen Folge-Tickets zum Titel (alle Zustände) oder `null`; wirft, wenn `gh` nicht antwortet. */
function standardSuche(titel) {
  const repo = JSON.parse(readFileSync(join(WURZEL, ".factory", "projekt.json"), "utf8")).repo;
  const liste = ghJson(["issue", "list", "--repo", repo, "--search", `in:title "${titel}"`, "--state", "all", "--limit", "20", "--json", "number,title"]);
  return liste.find((i) => i.title === titel)?.number ?? null;
}

function liesJson(pfad, lies) {
  try {
    return { wert: JSON.parse(lies(pfad, "utf8")) };
  } catch (e) {
    return { fehler: `${pfad}: nicht lesbar (${e.message})` };
  }
}

const bezug = (v, nummern) => String(v).replace(/^teil:(.+)$/, (_, id) => String(nummern[id] ?? "").replace(/^#/, ""));

/** Die geplanten Aufrufe in Plan-Reihenfolge; `nummern` löst `teil:<id>` auf (erst beim Anlegen bekannt, deshalb eine Funktion je Aufruf). */
function aktionen(plan, ergebnisse, protokoll, folgeVorhanden) {
  const aus = [];
  for (const e of ergebnisse) {
    const teil = plan.teile.find((t) => t.id === e.id);
    if (e.ergebnis !== "anlegen" || protokoll.teile[e.id]) continue;
    if (teil.art === "zeile") aus.push({ id: e.id, art: "zeile", texte: [teil.zeile], zeile: teil.zeile });
    else aus.push({ id: e.id, art: "ticket", texte: [teil.ticket.titel, teil.ticket.body], ticket: teil.ticket });
  }
  if (!protokoll.folge && folgeVorhanden === null) {
    const f = folgeTicketBody({ datum: plan.datum, unsicherheiten: plan.folge.unsicherheiten, recherche: plan.folge.recherche });
    aus.push({ id: "folge", art: "ticket", texte: [f.titel, f.body], ticket: { titel: f.titel, body: f.body, label: plan.folge.label, nach: plan.folge.nach, weil: plan.folge.weil } });
  }
  return aus;
}

function sperrFehler(aktionsListe, extra, namen, d) {
  for (const text of [...aktionsListe.flatMap((a) => a.texte), ...extra]) {
    const s = oeffentlichSauber(text, namen);
    if (!s.ok) return s.grund;
    const r = d.runner([process.execPath, "scripts/check-internalrefs.mjs", "--text"], { input: text, cwd: WURZEL });
    if (r.status !== 0) return "Sperrprüfung (check-internalrefs --text) meldet einen Treffer";
  }
  return null;
}

function ausfuehren(a, nummern, d, dryRun) {
  const ticket = a.ticket;
  if (a.art === "zeile") return dryRun ? { ok: true, ref: "(trocken)" } : fertig(d.runner([process.execPath, "scripts/melden.mjs", "--zeile", a.zeile], { cwd: WURZEL }), "Zeile");
  const blocker = (ticket.blocker ?? []).flatMap((b) => ["--blocker", bezug(b, nummern)]);
  const ordner = mkdtempSync(join(tmpdir(), "analyse-tickets-"));
  try {
    const datei = join(ordner, "body.md");
    writeFileSync(datei, ticket.body);
    const argv = [process.execPath, "scripts/spezifikation.mjs", "anlegen", "--titel", ticket.titel, "--body-datei", datei, "--label", ticket.label, "--nach", bezug(ticket.nach, nummern), "--weil", ticket.weil, ...blocker];
    if (dryRun) return { ok: true, ref: "(trocken)" };
    return fertig(d.runner(argv, { cwd: WURZEL }), "Ticket");
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function fertig(r, was) {
  if (r.status !== 0) return { ok: false, ref: `${was}: Anlage fehlgeschlagen (Exit ${r.status})` };
  const nr = /#(\d+)/.exec(r.stdout)?.[1];
  return { ok: true, ref: nr ? `#${nr}` : "angelegt" };
}

/** Phase 1: alles prüfen, nichts schreiben. `{ fehler }` oder `{ kontext }` für die Phasen 2 und 3. */
function vorbereiten(args, env, d) {
  const rev = liesJson(args.review, d.lies);
  if (rev.fehler) return { fehler: `Review fehlt oder unlesbar: ${rev.fehler}; nichts angelegt` };
  const review = rev.wert;
  if (review?.status !== "abgeschlossen") return { fehler: "Review nicht abgeschlossen (fehlt oder abgebrochen): nichts angelegt" };
  if (!Array.isArray(review.urteile) || review.urteile.length === 0) return { fehler: "Review ohne Urteile: nichts angelegt" };
  const pl = liesJson(resolve(dirname(args.review), String(review.plan ?? "")), d.lies);
  if (pl.fehler) return { fehler: `Plan fehlt oder unlesbar: ${pl.fehler}; nichts angelegt` };
  const plan = pl.wert;
  const formfehler = pruefeEingabe(plan, review);
  if (formfehler.length > 0) return { fehler: `Eingabe fehlerhaft, nichts angelegt:\n${formfehler.map((f) => `  - ${f}`).join("\n")}` };
  const liste = ladeListe(env);
  if (liste.fehler) return { fehler: `${liste.fehler}: nichts angelegt` };
  const ablage = ablageFehler(env, abhaengigkeiten({ repoWurzel: d.repoWurzel, worktrees: d.worktrees }), (liste.pfade ?? []).map(realMitVorfahr));
  if (ablage.fehler) return { fehler: ablage.fehler.replace("abgebrochen, nichts geschrieben", "nichts angelegt") };
  return { kontext: { plan, review, namen: liste.pfade ?? [], ablage: ablage.ablage } };
}

function planeProtokoll(k, d) {
  const pfad = join(k.ablage, `analyse-${k.plan.datum}-tickets.json`);
  const alle = existsSync(pfad) ? liesJson(pfad, d.lies) : { wert: {} };
  if (alle.fehler) return { fehler: `Lauf-Protokoll unlesbar (${alle.fehler}): nichts angelegt` };
  return { pfad, alle: alle.wert, neu: !existsSync(pfad), mein: alle.wert[k.plan.lauf] ?? { teile: {}, folge: null } };
}

function schnappschuss(ablage) {
  const name = letzterSchnappschuss(readdirSync(ablage));
  return name ? join(ablage, name.replace(/\.json$/, ".md")) : null;
}

/** Phase 2 und 3. Schreibt das Protokoll nach jedem Anlegen, damit ein Abbruch mittendrin nichts doppelt anlegt. */
function anlegen(k, p, liste, d, dryRun) {
  const nummern = { ...p.mein.teile };
  const ausgabe = [];
  let ok = true;
  const sichere = () => {
    if (dryRun) return;
    p.alle[k.plan.lauf] = p.mein;
    writeFileSync(p.pfad, `${JSON.stringify(p.alle, null, 2)}\n`, p.neu ? { flag: "wx" } : {});
    p.neu = false;
  };
  for (const a of liste) {
    const r = ausfuehren(a, nummern, d, dryRun);
    ausgabe.push(`${a.id}: ${r.ref}`);
    if (!r.ok) {
      ok = false;
      break;
    }
    if (a.id === "folge") p.mein.folge = r.ref;
    else p.mein.teile[a.id] = r.ref;
    nummern[a.id] = r.ref;
    sichere();
  }
  return { ok, ausgabe, nummern };
}

/** Das schon vorhandene Folge-Ticket des Laufs: erst das Lauf-Protokoll, dann die Suche nach dem Titel; `{ nummer }` oder `{ fehler }` (Suche scheitert: fail-closed). */
function folgeVorhanden(k, p, d) {
  if (p.mein.folge) return { nummer: p.mein.folge };
  try {
    return { nummer: d.suche(folgeTicketBody({ datum: k.plan.datum }).titel) };
  } catch (e) {
    return { fehler: `Dubletten-Suche des Folge-Tickets fehlgeschlagen (${e.message}): nichts angelegt` };
  }
}

/** Phase 1 und die Planung der Aufrufe: alles prüfen, nichts schreiben. */
function planen(review, env, d) {
  const v = vorbereiten({ review }, env, d);
  if (v.fehler) return v;
  const k = v.kontext;
  const ergebnisse = urteileJeTeil(k.plan, k.review);
  const p = planeProtokoll(k, d);
  if (p.fehler) return p;
  const md = schnappschuss(k.ablage);
  if (md === null) return { fehler: "Kein Analyse-Schnappschuss in der Ablage: nichts angelegt" };
  const dublette = folgeVorhanden(k, p, d);
  if (dublette.fehler) return dublette;
  const liste = aktionen(k.plan, ergebnisse, p.mein, dublette.nummer);
  const grund = sperrFehler(liste, [reviewAbschnittMarkdown(ergebnisse, k.plan.lauf)], k.namen, d);
  if (grund) return { fehler: `${grund}: nichts angelegt` };
  return { k, ergebnisse, p, md, liste, vorhanden: dublette.nummer };
}

/** Einstieg. `deps` (Tests): `bezieher`, `repoWurzel`, `worktrees`, `runner`, `suche`, `lies`. */
export function cli(argv, env = process.env, deps = {}) {
  const bezieher = deps.bezieher ?? (istBezieher(WURZEL) || istBezieher(process.cwd()));
  if (bezieher) return ab(4, "Abbruch: fabrik-eigen. token-analyse-tickets läuft nur in der Fabrik, nie in einem Bezieher.");
  const { werte, fehler } = flagsLesen(argv, { review: { type: "string" }, "dry-run": { type: "boolean" } });
  if (fehler || !werte.review) return ab(2, `${fehler?.text ?? "--review fehlt"}\n${AUFRUF}`);
  const d = { runner: standardRunner, suche: standardSuche, lies: readFileSync, repoWurzel: WURZEL, worktrees: undefined, ...deps };
  const g = planen(werte.review, env, d);
  if (g.fehler) return ab(1, g.fehler);
  return schliesse(g, anlegen(g.k, g.p, g.liste, d, werte["dry-run"] === true), werte["dry-run"] === true);
}

/** Phase 3: Abschnitt „Plan-Review“ in den Schnappschuss, dann Meldung und Exit-Code. */
function schliesse(g, r, trocken) {
  if (!trocken) {
    const verweise = g.ergebnisse.map((e) => ({ ...e, verweis: r.nummern[e.id] }));
    writeFileSync(g.md, abschnittEinsetzen(readFileSync(g.md, "utf8"), reviewAbschnittMarkdown(verweise, g.k.plan.lauf)));
  }
  const folge = g.vorhanden === null ? [] : [`Folge-Ticket schon angelegt ${typeof g.vorhanden === "number" ? `#${g.vorhanden}` : g.vorhanden}: kein zweites`];
  const nicht = g.ergebnisse.filter((e) => ["ungeprüft", "abgewiesen"].includes(e.ergebnis)).map((e) => `${e.id}: ${e.ergebnis} (${e.grund})`);
  return { code: r.ok && nicht.length === 0 ? 0 : 1, zeilen: [...r.ausgabe, ...folge, ...nicht] };
}

if (istDirektaufruf(import.meta.url)) {
  const r = cli(process.argv.slice(2));
  process.stdout.write(`${r.zeilen.join("\n")}\n`);
  process.exitCode = r.code;
}
