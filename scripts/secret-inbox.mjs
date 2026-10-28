#!/usr/bin/env node
/**
 * Secret-Inbox (#92): macht Secret-Funde zu Board-Arbeit und hält wöchentlich ein Prüf-Ticket für die Security-Tabs offen.
 *  (a) Quellen: der gitleaks-Bericht über die ganze Git-Historie (`--bericht <pfad>`, JSON) und die offenen GitHub-Secret-Scanning-Alerts.
 *      Übernommen werden NUR Regel, Datei, Zeile, Commit und Fingerprint bzw. Typ, Nummer, URL und erster Fundort. Das Feld `secret`/`Secret`/`Match`
 *      wird nie gelesen oder ausgegeben (ein Fund im öffentlichen Repo ist ohnehin kompromittiert, der Wert gehört nicht in Ticket oder Log).
 *  (b) ≥ 1 Fund → EIN Ticket `🔒 Security: Secret rotieren/widerrufen` ganz oben im Board (`platziereOben`), ein offenes Ticket wird aktualisiert;
 *      0 Funde → das offene Ticket wird geschlossen, aber nur, wenn jede Quelle, die in seiner Tabelle steht, in diesem Lauf lesbar war (fail-closed).
 *  (c) EIN Ticket `🔍 Security-Tabs prüfen`, ganz oben im Board, genau eines offen (ein offenes wird wiederverwendet, weitere werden geschlossen).
 * GitHub-Secret-Alerts sind mit dem Workflow-Token oft nicht lesbar (403/404): dann steht eine GRENZE-Zeile im Log und der Lauf geht mit gitleaks weiter.
 * Ohne `--bericht` werden nur die Alerts gelesen (lokaler Lauf mit gh-Login). Ein nicht lesbarer oder ungültiger Bericht ist Exit 1.
 *
 * Aufruf: node scripts/secret-inbox.mjs [--bericht <pfad>] [--dry-run]   (Workflow: .github/workflows/secret-scan.yml)
 * Die Funktionen oben sind pur und getestet (test/secret-inbox.test.ts); die Aufrufe von gh unten nicht.
 */
import { readFileSync } from "node:fs";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { fehlerText, ghJson, ghText } from "./gh-cli.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { ladeBoardLibs, vertrauterOwner, zielAktionen } from "./inbox-start-lib.mjs";
import { ladeProjektConfig, labelAus } from "./projekt-config-lib.mjs";

export const ZIEL_TITEL = "🔒 Security: Secret rotieren/widerrufen";
export const CHECK_TITEL = "🔍 Security-Tabs prüfen";
const QUELLE_GITLEAKS = "gitleaks";
const QUELLE_ALERT = "github-alert";
const MAX_ZEILEN = 50;

/** Zelle für die Tabelle: nur sichtbarer Text, ohne `|`, Backticks und Zeilenumbrüche, höchstens 120 Zeichen. Pur. */
const zelle = (x) =>
  String(x ?? "")
    .replace(/[|`\r\n]+/g, " ")
    .trim()
    .slice(0, 120) || "-";

/**
 * Funde aus dem gitleaks-JSON-Bericht (Liste). Nur `RuleID`, `File`, `StartLine`, `Commit`, `Fingerprint`; `Secret`/`Match` bleiben außen vor.
 * Keine Liste wirft (nie still „keine Funde“). Pur.
 */
export function befundeAusGitleaks(bericht) {
  if (!Array.isArray(bericht)) throw new Error("gitleaks-Bericht ist keine Liste.");
  return bericht.map((f) => ({
    quelle: QUELLE_GITLEAKS,
    typ: zelle(f?.RuleID),
    ort: `${zelle(f?.File)}:${Number.isInteger(f?.StartLine) ? f.StartLine : "?"}`,
    commit: zelle(String(f?.Commit ?? "").slice(0, 12)),
    kennung: zelle(f?.Fingerprint),
  }));
}

/**
 * Offene Funde aus der REST-Liste `secret-scanning/alerts`. Nur `secret_type_display_name`, `number`, `html_url` und der erste Fundort
 * (`orte`: Map Nummer → `{ path, start_line, commit_sha }`); das Feld `secret` wird nie gelesen. Keine Liste oder eine Nummer ohne Ganzzahl wirft. Pur.
 */
export function befundeAusAlerts(liste, orte = new Map()) {
  if (!Array.isArray(liste)) throw new Error("Secret-Alerts sind keine Liste.");
  return liste
    .filter((a) => a?.state === "open")
    .map((a) => {
      if (!Number.isInteger(a.number)) throw new Error("Secret-Alert ohne Nummer.");
      const o = orte.get(a.number);
      return {
        quelle: QUELLE_ALERT,
        typ: zelle(a.secret_type_display_name),
        ort: o?.path ? `${zelle(o.path)}:${Number.isInteger(o.start_line) ? o.start_line : "?"}` : "-",
        commit: zelle(String(o?.commit_sha ?? "").slice(0, 12)),
        kennung: `#${a.number} ${zelle(a.html_url)}`,
      };
    });
}

const zeile = (b) => `| ${b.quelle} | ${b.typ} | ${b.ort} | ${b.commit} | ${b.kennung} |`;

/** Ticket-Body: feste Reihenfolge der Schritte und die Tabelle der Funde (ohne Wert). Pur. */
export function issueBody(befunde) {
  const sichtbar = befunde.slice(0, MAX_ZEILEN);
  const rest = befunde.length - sichtbar.length;
  return [
    `Der Secret-Scan (gitleaks über die Historie, GitHub-Secret-Scanning) meldet ${befunde.length} Fund(e). Die Werte stehen bewusst nicht hier.`,
    "",
    "| Quelle | Typ | Datei:Zeile | Commit | Fingerprint |",
    "| --- | --- | --- | --- | --- |",
    ...sichtbar.map(zeile),
    ...(rest > 0 ? [``, `… und ${rest} weitere (vollständig im Lauf-Artefakt bzw. per Neulauf).`] : []),
    "",
    "Reihenfolge, nicht umstellen:",
    "1. **Beim Anbieter widerrufen bzw. rotieren.** Im öffentlichen Repo ist ein Secret sofort kompromittiert; Entfernen aus dem Code reicht nie.",
    "2. **Erst danach schließen:** GitHub-Alert als `revoked` schließen (Fehlalarm: `false_positive` mit Grund) bzw. den Fingerprint mit Begründung in `.gitleaksignore` eintragen.",
    "3. **Historie erst zuletzt bereinigen** (nur wenn nötig; das Rotieren war der eigentliche Schutz).",
    "",
    "Secret-Alerts nie mit dem Wert in den Kontext holen: `gh api repos/<repo>/secret-scanning/alerts --jq '.[] | {number,state,secret_type_display_name,html_url}'`.",
    "",
    "Mechanik: docs/ticket-reihenfolge.md › Secret-Inbox. Das Ticket schließt sich, wenn der nächste Lauf keinen Fund mehr meldet.",
  ].join("\n");
}

/** Quellen, die in der Tabelle eines Ticket-Bodys vorkommen. Pur. */
const quellenImBody = (body) => [QUELLE_GITLEAKS, QUELLE_ALERT].filter((q) => String(body ?? "").includes(`| ${q} |`));

/** Kennungen (Fingerprint bzw. Alert-Nummer), die im alten Body noch nicht als Tabellenzelle standen (exakt, kein Teilstring: `…:1` steckt in `…:12`). Pur. */
const neueKennungen = (befunde, altBody) => befunde.filter((b) => !String(altBody ?? "").includes(`| ${b.kennung} |`)).map((b) => b.kennung);

/**
 * Plan fürs Secret-Ticket. `offenesIssue` = `{ number, body }` oder null; `gelesen` = Menge der Quellen, die dieser Lauf lesen konnte.
 * `{ art: "anlegen"|"aktualisieren"|"schliessen"|"nichts", nummer?, body?, neue? }`. Geschlossen wird nur, wenn jede Quelle der Tabelle gelesen wurde. Pur.
 */
export function plane({ befunde, offenesIssue, gelesen = new Set([QUELLE_GITLEAKS, QUELLE_ALERT]) }) {
  if (befunde.length > 0) {
    const body = issueBody(befunde);
    if (!offenesIssue) return { art: "anlegen", body };
    if (String(offenesIssue.body ?? "").replaceAll("\r\n", "\n") === body) return { art: "nichts", nummer: offenesIssue.number };
    return { art: "aktualisieren", nummer: offenesIssue.number, body, neue: neueKennungen(befunde, offenesIssue.body) };
  }
  if (!offenesIssue) return { art: "nichts" };
  const ungelesen = quellenImBody(offenesIssue.body).filter((q) => !gelesen.has(q));
  if (ungelesen.length > 0) return { art: "nichts", nummer: offenesIssue.number, ungelesen };
  return { art: "schliessen", nummer: offenesIssue.number };
}

/** Body des Wochen-Tickets „Security-Tabs prüfen“. Pur. */
export function checkBody(repo = "<repo>") {
  return [
    "Wöchentliche Sichtung der Security-Tabs mit dem lokalen gh-Login (kein neues Secret nötig). Jeder Punkt: lesen, Funde beheben oder einordnen, Ergebnis hier kommentieren, dann das Ticket schließen.",
    "",
    "- [ ] **Secret-Scanning-Tab.** Lesen NUR so, dass der Wert nie in den Kontext kommt: `gh api repos/" + repo + "/secret-scanning/alerts --jq '.[] | {number,state,secret_type_display_name,html_url}'` (nie ohne `--jq`, nie das Feld `secret`). Ein offener Alert wird zum Ticket `" + ZIEL_TITEL + "` (ohne Wert): `node scripts/secret-inbox.mjs`. Ein Secret-Alert schließt sich NIE selbst, auch nicht nach dem Entfernen aus dem Code: erst beim Anbieter widerrufen bzw. rotieren, dann den Alert manuell als `revoked` schließen (Fehlalarm: `false_positive` mit Grund).",
    "- [ ] **Code-Scanning-Tab (CodeQL, Scorecard).** `gh api \"repos/" + repo + "/code-scanning/alerts?state=open\" --jq '.[] | {number,tool:.tool.name,rule:.rule.id,severity:.rule.security_severity_level}'`. Beheben; der Alert schließt sich selbst, sobald der Fund behoben ist und der Scan neu läuft. Sonst mit Grund dismissen.",
    "- [ ] **Dependabot-Alerts.** `gh api \"repos/" + repo + "/dependabot/alerts?state=open\" --jq '.[] | {number,package:.dependency.package.name,severity:.security_advisory.severity}'`. Upgrade; der Alert schließt sich selbst, sobald die Abhängigkeit behoben ist.",
    "- [ ] **Security-Advisories und PVR-Meldungen.** `gh api repos/" + repo + "/security-advisories --jq '.[] | {ghsa_id,state,severity}'`. Meldungen beantworten bzw. einordnen; sie schließen sich nur durch eine Entscheidung (veröffentlichen, schließen).",
    "",
    "Mechanik: docs/ticket-reihenfolge.md › Secret-Inbox.",
  ].join("\n");
}

/** Plan fürs Prüf-Ticket: genau eines bleibt offen (das kleinste), weitere werden geschlossen. `offene` = `[{ number }]`. Pur. */
export function planeCheck({ offene, repo }) {
  const sortiert = [...offene].sort((a, b) => a.number - b.number);
  if (sortiert.length === 0) return { art: "anlegen", body: checkBody(repo), schliessen: [] };
  return { art: "nichts", nummer: sortiert[0].number, schliessen: sortiert.slice(1).map((o) => o.number) };
}

const KOMMENTAR_LEER = "Keine offenen Secret-Funde mehr, automatisch geschlossen.";

/** Legt ein Ticket an und sortiert es oben ein. Rückgabe: true bei Fehler. */
function legeObenAn({ titel, body, art }, io, log) {
  try {
    const nr = io.legeIssueAn(titel, body);
    log(`Ticket angelegt: #${nr} (${titel})`);
    if (!io.projectToken) log("::warning::PROJECT_TOKEN fehlt: das Ticket steht nicht oben im Board.");
    else if (!io.sortiereEin(nr, art)) {
      log(`::error::Einsortieren von #${nr} an die Board-Spitze fehlgeschlagen.`);
      return true;
    }
    return false;
  } catch (err) {
    log(`::error::Ticket "${titel}" nicht angelegt: ${fehlerText(err)}`);
    return true;
  }
}

/** Führt den Secret-Plan aus. Rückgabe: true bei Fehler. */
function fuehreSecretAus(plan, io, log) {
  if (plan.art === "anlegen") return legeObenAn({ titel: ZIEL_TITEL, body: plan.body, art: "security" }, io, log);
  try {
    if (plan.art === "aktualisieren") {
      io.aktualisiere(plan.nummer, plan.body);
      if (plan.neue.length > 0) io.kommentiere(plan.nummer, `Neu seit dem letzten Lauf: ${plan.neue.join(", ")}`);
      log(`Ticket #${plan.nummer} aktualisiert.`);
    } else if (plan.art === "schliessen") {
      io.schliesse(plan.nummer, KOMMENTAR_LEER);
      log(`Ticket #${plan.nummer} geschlossen.`);
    } else if (plan.ungelesen) {
      log(`::warning::Ticket #${plan.nummer} bleibt offen: Quelle(n) ${plan.ungelesen.join(", ")} in diesem Lauf nicht lesbar.`);
    }
    return false;
  } catch (err) {
    log(`::error::Secret-Ticket unvollständig: ${fehlerText(err)}`);
    return true;
  }
}

/** Führt den Prüf-Ticket-Plan aus. Rückgabe: true bei Fehler. */
function fuehreCheckAus(plan, io, log) {
  let rot = false;
  if (plan.art === "anlegen") rot = legeObenAn({ titel: CHECK_TITEL, body: plan.body, art: "security-tabs" }, io, log);
  for (const nr of plan.schliessen) {
    try {
      io.schliesse(nr, "Doppeltes Prüf-Ticket, es bleibt genau eines offen.");
      log(`Doppeltes Ticket #${nr} geschlossen.`);
    } catch (err) {
      log(`::error::#${nr} nicht geschlossen: ${fehlerText(err)}`);
      rot = true;
    }
  }
  return rot;
}

/** Trockenlauf: gibt beide Pläne nur aus. */
function trockenAus(secret, check, log) {
  log(`[dry-run] Secret-Ticket: ${secret.art}${secret.nummer ? ` #${secret.nummer}` : ""}`);
  if (secret.body) log(`[dry-run] ${secret.body.split("\n").slice(0, 8).join("\n[dry-run] ")}`);
  log(`[dry-run] Prüf-Ticket: ${check.art}${check.nummer ? ` #${check.nummer}` : ""}${check.schliessen.length ? `, schließe ${check.schliessen.map((n) => `#${n}`).join(", ")}` : ""}`);
  return 0;
}

/** HTTP-Status aus einer gh-Fehlermeldung (`HTTP 403`) oder null. Pur. */
export const statusAus = (err) => /HTTP (\d{3})/.exec(String(err?.stderr ?? "") + String(err?.message ?? err ?? ""))?.[1] ?? null;

/** Liest die Alerts; 403/404 ist die belegte Token-Grenze (GRENZE, weiter), jeder andere Fehler ein Lesefehler. Rückgabe `{ befunde } | { grenze } | { fehler }`. */
function leseAlerts(io, log) {
  try {
    const liste = io.ladeAlerts();
    const orte = new Map();
    for (const a of Array.isArray(liste) ? liste : []) if (a?.state === "open" && Number.isInteger(a.number)) orte.set(a.number, io.ladeOrt(a.number));
    return { befunde: befundeAusAlerts(liste, orte) };
  } catch (err) {
    const status = statusAus(err);
    if (status === "403" || status === "404") {
      log(`GRENZE GitHub-Secret-Alerts nicht lesbar (${status}): Token mit „Secret scanning alerts: read“ nötig`);
      return { grenze: true };
    }
    log(`::error::Secret-Alerts nicht lesbar: ${fehlerText(err)}`);
    return { fehler: true };
  }
}

/** Ein Lauf: Bericht und Alerts lesen, beide Tickets planen, ausführen. Ungültiger Bericht ist Exit 1 vor jeder Änderung. */
export function lauf({ io, trocken = false }) {
  const log = io.log ?? console.log;
  const befunde = [];
  const gelesen = new Set();
  if (io.ladeBericht) {
    try {
      befunde.push(...befundeAusGitleaks(JSON.parse(io.ladeBericht())));
      gelesen.add(QUELLE_GITLEAKS);
    } catch (err) {
      log(`::error::gitleaks-Bericht nicht lesbar oder ungültig: ${fehlerText(err)}`);
      return 1;
    }
  }
  const alerts = leseAlerts(io, log);
  if (alerts.befunde) {
    befunde.push(...alerts.befunde);
    gelesen.add(QUELLE_ALERT);
  }
  let kontext;
  try {
    kontext = io.ladeKontext();
  } catch (err) {
    log(`::error::Offene Tickets nicht lesbar: ${fehlerText(err)}`);
    return 1;
  }
  const secret = plane({ befunde, offenesIssue: kontext.offenesIssue, gelesen });
  const check = planeCheck({ offene: kontext.checkIssues, repo: io.repo });
  if (trocken) return trockenAus(secret, check, log);
  const rot = [fuehreSecretAus(secret, io, log), fuehreCheckAus(check, io, log), alerts.fehler === true];
  if (secret.art === "nichts" && check.art === "nichts" && befunde.length === 0) log("Secret-Inbox: nichts Neues.");
  return rot.includes(true) ? 1 : 0;
}

// ---- IO (ungetestet) ----

/** Einstieg. `deps` (Tests): `ladeConfig()`, `ladeLibs()`, `lies(pfad)`, `gh` (`{ text(args, opt), json(args, opt) }`, Standard: echtes gh), `log`, `err`. Rückgabe: Exit-Code. */
export async function main(argv = process.argv.slice(2), { ladeLibs = ladeBoardLibs, ladeConfig = () => ladeProjektConfig(), lies = (p) => readFileSync(p, "utf8"), gh = { text: ghText, json: ghJson }, log = console.log, err = console.error } = {}) {
  const { werte, fehler } = flagsLesen(argv, { "dry-run": { type: "boolean" }, bericht: { type: "string" } });
  if (fehler) {
    err(`${fehler.text}\nAufruf: node scripts/secret-inbox.mjs [--bericht <pfad>] [--dry-run]`);
    return AUFRUF_EXIT;
  }
  let config;
  let libs;
  try {
    config = ladeConfig();
    libs = await ladeLibs();
  } catch (e) {
    log(`::error::Secret-Inbox: Projekt-Config nicht lesbar: ${fehlerText(e)}`);
    return AUFRUF_EXIT;
  }
  const { REPO, ladeSammelKontext, vertrauteIssues } = libs;
  const aktion = zielAktionen({ gh, libs, label: labelAus(config, "harness") });
  const io = {
    repo: REPO,
    ladeBericht: werte.bericht === undefined ? undefined : () => lies(werte.bericht),
    ladeAlerts: () => JSON.parse(gh.text(["api", "--paginate", "--slurp", `repos/${REPO}/secret-scanning/alerts?state=open&per_page=100`])).flat(),
    // Nur die Felder des ersten Fundorts; `--jq` lässt jeden Wert außen vor.
    ladeOrt: (nr) => {
      try {
        return JSON.parse(gh.text(["api", `repos/${REPO}/secret-scanning/alerts/${nr}/locations?per_page=1`, "--jq", ".[0].details // {} | {path,start_line,commit_sha}"]));
      } catch {
        return null;
      }
    },
    ladeKontext: () => {
      const kontext = ladeSammelKontext({ ladeKommentare: () => [] });
      const { rohe, offene } = kontext;
      const vertraut = new Set(vertrauteIssues(rohe, vertrauterOwner(kontext, libs)).map((i) => i.number));
      const mit = (titel) => offene.filter((i) => i.titel === titel && vertraut.has(i.number)).sort((a, b) => a.number - b.number);
      const erstes = mit(ZIEL_TITEL)[0];
      const offenesIssue = erstes ? { number: erstes.number, body: aktion.holeBody(erstes.number) } : null;
      return { offenesIssue, checkIssues: mit(CHECK_TITEL).map((i) => ({ number: i.number })) };
    },
    projectToken: process.env.PROJECT_TOKEN,
    log,
    legeIssueAn: aktion.legeIssueAn,
    sortiereEin: (nr, art) => {
      try {
        aktion.platziere(nr, art);
        return true;
      } catch {
        return false;
      }
    },
    aktualisiere: aktion.aktualisiere,
    kommentiere: aktion.kommentiere,
    schliesse: aktion.schliesse,
  };
  return lauf({ io, trocken: werte["dry-run"] === true });
}

if (istDirektaufruf(import.meta.url)) process.exitCode = await main();
