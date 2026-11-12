// Nur Node-Builtins und Blatt-Module (der Wochenlauf des Doctors hat kein `npm ci`).
/* Harness-Doctor, Punkt `Sammel-Check` (factory#401): jeder Workflow aus `sammelChecks` der Projekt-Config hat einen Sammel-Job, der per `needs` an allen anderen Jobs seines Workflows hängt
 * (ein Required Check deckt so eine wechselnde Job-Menge; `needs` wirkt nur innerhalb eines Workflows), und einen Alarm-Job, der bei rotem Lauf auf main das Alarm-Issue öffnet.
 *
 *   L53 (needs-Vollständigkeit): jeder Schlüssel unter `jobs` steht in `needs` des Sammel-Jobs. Ausgenommen sind der Sammel-Job selbst und Jobs mit `uses: ./.github/workflows/alarm-rot-main.yml`.
 *   L52 (Alarm bei rotem main): es gibt einen Job mit genau diesem `uses`, dessen `needs` den Sammel-Job nennt und dessen `if` `failure()` und `github.event_name == 'push'` enthält; der Workflow läuft auf `push`.
 *
 * Gelesen wird in Blockform ohne `yaml` (`blockformJobs`); eine nicht lesbare Datei macht den Punkt nicht prüfbar. Grenzen: `if: always()` im Sammel-Job prüft der Punkt nicht; das `if` des Alarm-Jobs ist eine Textsuche (`failure() || github.event_name == 'push'` besteht), und er prüft den Auslöser `push`, nicht den Branch `main` (ein Push-Auslöser ohne `branches` ließe den Alarm auch für Feature-Branches laufen).
 * Ohne `sammelChecks` ist der Punkt OK mit Hinweis (nur ein Bezieher mit Produkt-CI konfiguriert ihn); die Fabrik selbst hat keine Produkt-CI. */
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { blockformJobs } from "./workflow-blockform.mjs";

const PUNKT = "Sammel-Check";
const ALARM_USES = "./.github/workflows/alarm-rot-main.yml";
const PRUEFEN = "node scripts/harness-doctor.mjs --pruefen";

const aufruf = (job) => `  alarm-rot-main:\n    needs: [${job}]\n    if: failure() && github.event_name == 'push'\n    permissions: { contents: read, issues: write }\n    uses: ${ALARM_USES}\n    with: { label: <Alarm-Label> }\n    secrets: { PROJECT_TOKEN: \${{ secrets.PROJECT_TOKEN }} }`;

/** Die Lücken eines gelesenen Workflows `{ ausloeser, jobs }` für den Sammel-Job `job`; je Lücke `{ befund, fix }`. */
function luecken({ ausloeser, jobs }, workflow, job) {
  const sammel = jobs.find((j) => j.id === job);
  if (!sammel) return [{ befund: `${workflow}: der Sammel-Job „${job}“ fehlt`, fix: `den Job „${job}“ mit \`needs: [<alle anderen Jobs>]\` anlegen oder \`sammelChecks\` der Projekt-Config korrigieren` }];
  return [...needsLuecke(jobs, sammel, workflow), ...alarmLuecke(jobs, ausloeser, job, workflow)];
}

/** Hängt der Job `j` (über beliebig viele Stufen) per `needs` an `ziel`? Ein solcher Job kann nie im `needs` von `ziel` stehen (Zyklus). */
function haengtAn(jobs, j, ziel, besucht = new Set()) {
  if (besucht.has(j.id)) return false;
  besucht.add(j.id);
  return j.needs.some((n) => n === ziel || jobs.some((k) => k.id === n && haengtAn(jobs, k, ziel, besucht)));
}

function needsLuecke(jobs, sammel, workflow) {
  const pflicht = jobs.filter((j) => j.id !== sammel.id && j.uses !== ALARM_USES && !haengtAn(jobs, j, sammel.id));
  const fehlend = pflicht.filter((j) => !sammel.needs.includes(j.id)).map((j) => j.id);
  if (fehlend.length === 0) return [];
  const alle = pflicht.map((j) => j.id);
  return [{ befund: `${workflow}: der Sammel-Job „${sammel.id}“ wartet nicht auf ${fehlend.map((j) => `„${j}“`).join(", ")} (needs)`, fix: `\`needs: [${alle.join(", ")}]\` im Job „${sammel.id}“ setzen (ohne den Eintrag deckt der Required Check den Job nicht), dann ${PRUEFEN}` }];
}

function alarmLuecke(jobs, ausloeser, job, workflow) {
  const alarme = jobs.filter((j) => j.uses === ALARM_USES);
  const alarm = alarme.find((j) => j.needs.includes(job)) ?? alarme[0];
  const fix = `den Alarm-Aufruf ergänzen, dann ${PRUEFEN}:\n${aufruf(job)}`;
  if (alarm === undefined) return [{ befund: `${workflow}: kein Job ruft ${ALARM_USES} auf (ein roter main bliebe ohne Alarm-Issue)`, fix }];
  const fehlt = [];
  if (!alarm.needs.includes(job)) fehlt.push(`needs nennt „${job}“ nicht`);
  const wenn = String(alarm.if);
  if (!/failure\(\)/.test(wenn)) fehlt.push("if enthält kein failure()");
  if (!/github\.event_name\s*==\s*['"]push['"]/.test(wenn)) fehlt.push("if enthält nicht github.event_name == 'push'");
  if (!ausloeser.includes("push")) fehlt.push("der Workflow läuft nicht auf push");
  return fehlt.length === 0 ? [] : [{ befund: `${workflow}: Alarm-Job „${alarm.id}“: ${fehlt.join("; ")}`, fix }];
}

/** Ergebnis für einen Eintrag `{ workflow, job }`: `{ luecken }` oder `{ nichtPruefbar }`. */
function eintragPruefen(e, workflows) {
  if (e === null || typeof e !== "object") return { nichtPruefbar: "ein Eintrag von sammelChecks ist kein Objekt { workflow, job }" };
  const datei = (workflows ?? []).find((w) => w.pfad === e.workflow);
  if (!datei) return { luecken: [{ befund: `${e.workflow}: Workflow-Datei fehlt unter .github/workflows/`, fix: `die Datei anlegen oder \`sammelChecks\` der Projekt-Config korrigieren` }] };
  const gelesen = blockformJobs(datei.text);
  if (gelesen.fehler) return { nichtPruefbar: `${e.workflow}:${gelesen.fehler.zeile} ${gelesen.fehler.konstrukt}` };
  return { luecken: luecken(gelesen, e.workflow, e.job) };
}

/** Der Punkt `Sammel-Check` aus `config.sammelChecks` und den Workflow-Dateien `[{ pfad, text }]`. Pur. */
export function sammelCheckPunkt({ config, workflows, vorAbbruch = false }) {
  if (vorAbbruch) return nichtPruefbar(PUNKT, "Config bzw. Workflows nicht geladen (Vorab-Abbruch)", `erst die Fehler der Projekt-Config beheben, dann ${PRUEFEN}`);
  const liste = config?.sammelChecks;
  if (liste === undefined) return gut(PUNKT, "keine Sammel-Checks konfiguriert (sammelChecks der Projekt-Config)");
  if (!Array.isArray(liste)) return nichtPruefbar(PUNKT, "sammelChecks der Projekt-Config ist keine Liste", `\`sammelChecks\` als Liste aus { workflow, job } schreiben, dann ${PRUEFEN}`);
  const ergebnisse = liste.map((e) => eintragPruefen(e, workflows));
  const nicht = ergebnisse.filter((r) => r.nichtPruefbar).map((r) => r.nichtPruefbar);
  if (nicht.length > 0) return nichtPruefbar(PUNKT, `Workflow in einer Form, die der Blockform-Leser nicht liest: ${nicht.join("; ")}`, "in Blockform schreiben (`on:`, `jobs:` und `needs:` als eingerückte Mappings und Listen, ohne Flow-Mapping, Anker, Alias, Tag), dann erneut prüfen");
  const alle = ergebnisse.flatMap((r) => r.luecken);
  if (alle.length === 0) return gut(PUNKT);
  return luecke(PUNKT, alle.map((l) => l.befund).join("; "), alle.map((l) => l.fix).join("; "));
}
