/* Harness-Doctor, Punkt `Ruleset-Spiegel` (factory#247 L3): gleicht den Spiegel in Git (`rulesetSpiegel` der Projekt-Config) mit dem Ruleset auf dem Server ab:
 * `name`, `requiredChecks` (Menge), `codeScanning` (Werkzeug und beide Schwellen) und `bypassActors`. Ersetzt den Handbefehl `gh api repos/<repo>/rulesets/<id>`.
 *
 * Nur im lokalen `--pruefen`: `bypass_actors` liefert GitHub nur mit Admin-Recht, das Token des Wochenlaufs hat es nicht. Fehlt das Feld oder scheitert der Endpunkt
 * (403, 404, Netz), ist der Punkt `NICHT PRÜFBAR` (fail-closed), nie still grün. Ein Spiegel ohne `id` oder ein Aufruf ohne `lesen` lässt den Punkt aus (`rulesetPunkte`). Pur bis auf die Naht `lesen(args)` (liefert die geparste
 * Antwort, wirft bei einem Fehler; der Aufrufer reicht `gh` herein). Importiert nur die Ergebnis-Form und die Schwellen-Zuordnung des Sicherheitspunkts. Der Spiegel kommt vom Lader (`ladeRulesetSpiegel`),
 * der `name`, `requiredChecks`, `codeScanning` (fehlt → `[]`) und `bypassActors` als gültig garantiert; darum steht hier kein Rückfall für diese Felder (die Live-Antwort bleibt ungeprüft: fehlt `rules`, ist `requiredChecks` eine Lücke).
 */
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { SCHWELLEN_FELDER } from "./harness-doctor-sicherheit.mjs";

const PUNKT = "Ruleset-Spiegel";
const PIN_PUNKT = "Required-Check-Pin";
const LINK = "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository";
const FIX_PRUEFEN = "mit einem Konto mit Admin-Recht prüfen (gh auth status), dann erneut mit `node scripts/harness-doctor.mjs --pruefen` prüfen";

const sortiert = (liste) => liste.map((e) => JSON.stringify(e)).sort();
const gleich = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const checksAus = (regeln) => regeln.filter((r) => r.type === "required_status_checks").flatMap((r) => (r.parameters?.required_status_checks ?? []).map((c) => c.context)).sort();
const werkzeugeAus = (regeln) => regeln.filter((r) => r.type === "code_scanning").flatMap((r) => r.parameters?.code_scanning_tools ?? [])
  .map((w) => ({ tool: w.tool, ...Object.fromEntries(SCHWELLEN_FELDER.map(([soll, ist]) => [soll, w[ist]])) }))
  .sort((a, b) => String(a.tool).localeCompare(String(b.tool)));

/** Die Felder, die vom Spiegel abweichen (Namen wie im Spiegel). */
function abweichungen(spiegel, live) {
  const regeln = Array.isArray(live.rules) ? live.rules : [];
  const sollWerkzeuge = [...spiegel.codeScanning].sort((a, b) => String(a.tool).localeCompare(String(b.tool)));
  return [
    live.name !== spiegel.name && "name",
    !gleich(checksAus(regeln), [...spiegel.requiredChecks].sort()) && "requiredChecks",
    !gleich(werkzeugeAus(regeln), sollWerkzeuge.map((e) => ({ tool: e.tool, ...Object.fromEntries(SCHWELLEN_FELDER.map(([soll]) => [soll, e[soll]])) }))) && "codeScanning",
    !gleich(sortiert(live.bypass_actors), sortiert(spiegel.bypassActors)) && "bypassActors",
  ].filter(Boolean);
}

const FIX_PIN = "je Kontext integration_id der Quell-App setzen (GitHub Actions; ID prüfbar per gh api repos/<repo>/commits/<sha>/check-runs --jq '[.check_runs[].app.id]|unique'); die Ruleset-Änderung ist Pre-Flight, danach den Spiegel nachziehen";

/** Der Punkt `Required-Check-Pin` (factory#375 L51) aus den Branch-Regeln (`rules/branches/<branch>`, ohne Admin-Recht, auch im Wochenlauf): `regeln` ist das Ergebnis von `hole` (`{ wert }` oder `{ fehler }`). Required Checks ohne `integration_id` (jede App könnte den Kontext melden) sind eine Lücke; ohne Regel `required_status_checks` ein leeres Ergebnis; ein Lesefehler ist `NICHT PRÜFBAR`. */
export function pinPunkt(regeln) {
  if (regeln.fehler !== undefined) return [nichtPruefbar(PIN_PUNKT, `Regeln auf dem Branch nicht lesbar (${regeln.fehler})`, "gh auth status prüfen, dann den Doctor erneut starten", LINK)];
  const liste = Array.isArray(regeln.wert) ? regeln.wert : [];
  const checks = liste.filter((r) => r.type === "required_status_checks").flatMap((r) => r.parameters?.required_status_checks ?? []);
  if (checks.length === 0) return [];
  const offen = checks.filter((c) => c.integration_id == null).map((c) => c.context).sort();
  if (offen.length === 0) return [gut(PIN_PUNKT)];
  return [luecke(PIN_PUNKT, `Required Checks ohne integration_id: ${offen.join(", ")}`, FIX_PIN, LINK)];
}

/** Die Zeilen des Punkts für `pruefLauf`: leer ohne `lesen` (Wochenlauf, `--einrichten`), ohne Spiegel oder ohne `id` im Spiegel (dann ist der Abgleich nicht angefordert), sonst der Spiegel-Punkt (der Pin-Punkt kommt aus `pinPunkt`, factory#375 L51). */
export const rulesetPunkte = ({ spiegel, repo, lesen }) => (typeof lesen === "function" && spiegel?.id != null ? rulesetErgebnisse({ spiegel, repo, lesen }) : []);

/** Der Punkt `Ruleset-Spiegel`: ein Ergebnis (`gut`, `luecke` oder `nichtPruefbar`). */
export const pruefeRulesetSpiegel = (e) => rulesetErgebnisse(e)[0];

/** Der Spiegel-Abgleich aus einem Lesevorgang (bei Lesefehler oder fehlendem `bypass_actors` nicht prüfbar, fail-closed). */
function rulesetErgebnisse({ spiegel, repo, lesen }) {
  const nicht = (grund) => [nichtPruefbar(PUNKT, grund, FIX_PRUEFEN, LINK)];
  let live;
  try {
    live = lesen(["api", `repos/${repo}/rulesets/${spiegel.id}`]);
  } catch (e) {
    return nicht(`Ruleset ${spiegel.id} nicht lesbar (${String(e?.message ?? e).split("\n")[0]})`);
  }
  if (live === null || typeof live !== "object") return nicht(`Ruleset ${spiegel.id}: Antwort ist kein Objekt`);
  if (!Array.isArray(live.bypass_actors)) return nicht("bypass_actors fehlt in der Antwort (sichtbar nur mit Admin-Recht)");
  const felder = abweichungen(spiegel, live);
  const abgleich = felder.length === 0 ? gut(PUNKT) : luecke(PUNKT, `Ruleset ${spiegel.id} weicht vom Spiegel ab: ${felder.join(", ")}`, "den Spiegel im selben PR nachziehen oder das Ruleset angleichen (Pre-Flight)", LINK);
  return [abgleich];
}
