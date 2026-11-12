// Kein Shebang, kein Direktaufruf: pure Lib der Sicherheitsprüfung (factory#388, Fortschreibung ADR 0031). Der Monatslauf `sicherheitspruefung.mjs` gleicht Sicherheits- und Konfigurationspunkte des
// eigenen Repos gegen die Soll-Liste `.github/sicherheitspruefung.json` ab und legt bei Abweichungen genau ein Ticket im eigenen Repo an (Tabelle Punkt, Ist, Soll, Fix). Ohne Modell, ohne Netz in dieser Lib.
//
// Soll-Liste: `kern` (vom Sync verteilt, Besitz-Schlüssel) und `projekt` (vom Bezieher gepflegt, der Sync lässt ihn unberührt). Der Bezieher erweitert nur über bekannte Punktnamen (`PUNKTE`), Manifest-Muster
// und begründete Ausnahmen, nie über frei definierte Abfragen. Ein unbekannter Punkt, ein unbekannter Schlüssel und eine Ausnahme ohne `grund` sind Konfigurationsfehler (Exit 2 im Einstieg).
//
// Grenzen: Verweise wie `#12` in Pfaden gehen unmaskiert in die Tabelle (die Quelle ist der eigene, PR-gegatete Checkout); Required-Check-Pin hängt am Ruleset-Spiegel und fehlt ohne ihn still; „nicht prüfbar“ zählt als Abweichung (fail-closed; der Fix nennt das fehlende Recht). CodeQL-Ist: bei gewähltem Modul `codeql` die Sprachen der Projekt-Config, sonst das Default-Setup
// des Repos; ein von Hand gepflegter CodeQL-Workflow ohne das Modul wird nicht gelesen (dann `codeqlOhne` mit Grund oder das Modul wählen). Die Sprachen-Zuordnung (`kern.codeql`) kennt nur die dort
// eingetragenen Sprachen. Das Ticket trägt nur Zustände und Pfade, nie Secret-Werte, Alert-Inhalte oder Konten.
import { luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";
import { SICHERHEIT_PUNKTE } from "./harness-doctor-sicherheit.mjs";
import { istFremdeingang } from "./fremdtext-lib.mjs";

/** Titelpräfix des Tickets der Sicherheitsprüfung (der Monat folgt; höchstens ein offenes Ticket über alle Monate). */
export const TITEL_PRAEFIX = "🛡️ Sicherheitsprüfung ";
/** Marker im Body: Dedupe-Schlüssel neben Titelpräfix und vertrautem Autor. */
export const MARKER = "<!-- sicherheitspruefung -->";
/** Obergrenze des Berichts in Zeichen (GitHub erlaubt 65 536 je Body). */
export const BERICHT_MAX = 60_000;
const ZELLE_MAX = 400;

/** Soll-Text je Punktname (SSOT: die Spalte „Soll“ des Tickets). Der Schlüssel ist der Punktname ohne Zusatz (`Required-Check` gilt für `Required-Check <ctx>`). */
export const SOLL_JE_PUNKT = {
  "Secret Scanning": "aktiviert",
  "Push Protection": "aktiviert",
  "Non-Provider-Patterns": "aktiviert (GitHub Secret Protection)",
  "Validity Checks": "aktiviert (GitHub Secret Protection)",
  PVR: "Private Vulnerability Reporting aktiviert",
  "Dependabot Security Updates": "aktiviert",
  "Dependabot Alerts": "aktiviert",
  "Code-Scanning": "CodeQL als Regel im Ruleset des Standard-Branches, Schwellen wie im Spiegel",
  "SHA-Pinning": "Actions nur per Commit-SHA",
  Ruleset: "Ruleset für den Standard-Branch aktiv",
  "Required-Check": "alle Pflicht-Checks im Ruleset",
  "Required-Check-Pin": "Pflicht-Checks an die erwartete App gebunden",
  "Ruleset-Spiegel": "Ruleset auf dem Server gleich dem Spiegel im Repo",
  "Admin-Recht": "Token mit Admin-Recht am Repo",
  Actions: "GitHub Actions im Repo erlaubt",
  "Dependabot-Abdeckung": "je Manifest ein Dependabot-Eintrag für Ökosystem und Verzeichnis",
  "CodeQL-Sprachen": "alle analysierbaren Sprachen des Repos in CodeQL",
};
/** Die geschlossene Liste der Punktnamen, die eine Soll-Liste nennen darf. */
export const PUNKTE = [...new Set([...SICHERHEIT_PUNKTE, ...Object.keys(SOLL_JE_PUNKT)])];
/** Die einzigen Punkte, die ein Bezieher mit Grund abwählen darf (`projekt.punkteOhne`): sie hängen an Ruleset, Spiegel und Code-Scanning-Modul, die ein Projekt nicht haben muss. Alles andere (Secret Scanning, Push Protection, Dependabot, Admin-Recht, CodeQL-Sprachen) bleibt Pflicht. */
export const ABWAEHLBAR = ["Ruleset", "Required-Check", "Required-Check-Pin", "Ruleset-Spiegel", "Code-Scanning"];
/** Punkte des Prüflaufs (Harness-Doctor), deren Ergebnis nie fehlen darf: fehlt es, ist der Punkt „nicht prüfbar“. */
const PFLICHT_DOCTOR = ["Secret Scanning", "Push Protection", "Dependabot Security Updates", "Code-Scanning", "Ruleset", "Ruleset-Spiegel", "Admin-Recht"];

const fehler = (text) => new Error(`${text}\nFix: .github/sicherheitspruefung.json prüfen (Struktur und Punktnamen: docs/agent-harness.md (Fabrik) § 2.2)`);
const istObjekt = (w) => w !== null && typeof w === "object" && !Array.isArray(w);
const textFeld = (w) => typeof w === "string" && w.trim() !== "";

function pruefeListe(w, was, element) {
  if (w === undefined) return [];
  if (!Array.isArray(w)) throw fehler(`${was} muss eine Liste sein`);
  w.forEach((e, i) => element(e, `${was}[${i}]`));
  return w;
}
const verzeichnisPfad = (e, was) => {
  if (typeof e.pfad === "string" && (/[*?]/.test(e.pfad) || /^[/.]*$/.test(e.pfad))) throw fehler(`${was}: \`pfad\` muss ein einzelnes Verzeichnis sein (kein Muster, nicht die Wurzel)`);
};
const mitGrund = (feld, weiter = () => undefined) => (e, was) => {
  if (!istObjekt(e) || !textFeld(e[feld])) throw fehler(`${was}: Feld \`${feld}\` fehlt`);
  if (!textFeld(e.grund)) throw fehler(`${was}: Feld \`grund\` fehlt (eine Ausnahme braucht eine Begründung)`);
  weiter(e, was);
};
const manifestEintrag = (e, was) => {
  if (!istObjekt(e) || !textFeld(e.oekosystem) || !textFeld(e.datei)) throw fehler(`${was}: Felder \`oekosystem\` und \`datei\` fehlen`);
};
const punktListe = (w, was) =>
  pruefeListe(w, was, (p, name) => {
    if (!PUNKTE.includes(p)) throw fehler(`${name}: unbekannter Punkt „${String(p)}“ (erlaubt: ${PUNKTE.join(", ")})`);
  });

/**
 * Lädt und führt die Soll-Liste zusammen: `{ punkte, manifeste, codeql, ausnahmen, codeqlOhne }`. `kern` ist Pflicht, `projekt` optional; `projekt.punkte` und `projekt.manifeste` ergänzen nur.
 * Wirft bei ungültigem JSON, unbekanntem Schlüssel oder Punkt und bei einer Ausnahme ohne `grund` (Exit 2 im Einstieg). Pur.
 */
export function ladeSollListe(text) {
  let w;
  try {
    w = JSON.parse(String(text));
  } catch (e) {
    throw fehler(`kein gültiges JSON (${e.message})`);
  }
  if (!istObjekt(w) || !istObjekt(w.kern)) throw fehler("Schlüssel `kern` fehlt");
  const fremd = Object.keys(w).filter((k) => k !== "kern" && k !== "projekt");
  if (fremd.length > 0) throw fehler(`unbekannter Schlüssel auf oberster Ebene: ${fremd.join(", ")}`);
  const p = w.projekt ?? {};
  if (!istObjekt(p)) throw fehler("`projekt` muss ein Objekt sein");
  const unbekannt = Object.keys(p).filter((k) => !["punkte", "punkteOhne", "manifeste", "ausnahmen", "codeqlOhne"].includes(k));
  if (unbekannt.length > 0) throw fehler(`unbekannter Schlüssel in \`projekt\`: ${unbekannt.join(", ")}`);
  if (!istObjekt(w.kern.codeql ?? {})) throw fehler("kern.codeql muss ein Objekt (Sprache → CodeQL-Sprache) sein");
  const punkteOhne = pruefeListe(p.punkteOhne, "projekt.punkteOhne", mitGrund("punkt", (e, was) => {
    if (!ABWAEHLBAR.includes(e.punkt)) throw fehler(`${was}: „${e.punkt}“ ist nicht abwählbar (erlaubt: ${ABWAEHLBAR.join(", ")})`);
  }));
  const punkte = [...new Set([...punktListe(w.kern.punkte, "kern.punkte"), ...punktListe(p.punkte, "projekt.punkte")])].filter((n) => !punkteOhne.some((o) => o.punkt === n));
  if (punkte.length === 0) throw fehler("die Punktliste ist leer (alle Punkte abgewählt)");
  return {
    punkte,
    punkteOhne,
    manifeste: [...pruefeListe(w.kern.manifeste, "kern.manifeste", manifestEintrag), ...pruefeListe(p.manifeste, "projekt.manifeste", manifestEintrag)],
    codeql: w.kern.codeql ?? {},
    ausnahmen: pruefeListe(p.ausnahmen, "projekt.ausnahmen", mitGrund("pfad", verzeichnisPfad)),
    codeqlOhne: pruefeListe(p.codeqlOhne, "projekt.codeqlOhne", mitGrund("sprache")),
  };
}

const trifft = (punkt, name) => punkt === name || String(punkt).startsWith(`${name} `);

/** Filtert die Ergebnisse des Prüflaufs auf die Punkte der Soll-Liste; fehlt das Ergebnis eines Doctor-Pflichtpunkts der Liste, kommt ein „nicht prüfbar“ dazu. Pur. */
export function filtere(ergebnisse, punkte) {
  const treffer = ergebnisse.filter((r) => punkte.some((n) => trifft(r.punkt, n)));
  const da = (n) => [n, ...(ERSATZ[n] ?? [])].some((m) => ergebnisse.some((r) => trifft(r.punkt, m)));
  const fehlend = PFLICHT_DOCTOR.filter((n) => punkte.includes(n) && !da(n));
  return [...treffer, ...fehlend.map((n) => nichtPruefbar(n, FEHLT_BEFUND[n] ?? FEHLT_BEFUND_STANDARD, FEHLT_FIX[n] ?? FEHLT_FIX_STANDARD))];
}

/** Der Doctor meldet `Ruleset` nur im Soll-Zustand (`OK`) oder ohne jeden Required Check; fehlt ein Pflicht-Check, steht dort nur `Required-Check <ctx>`: auch das belegt, dass die Regeln gelesen wurden. */
const ERSATZ = { Ruleset: ["Required-Check"] };
const FEHLT_BEFUND_STANDARD = "kein Ergebnis des Prüflaufs (Token ohne Admin-Recht)";
const FEHLT_FIX_STANDARD = "Prüflauf mit einem Token mit Admin-Recht wiederholen (Secret PROJECT_TOKEN)";
const FEHLT_BEFUND = { "Ruleset-Spiegel": "kein Ergebnis des Prüflaufs (Token ohne Admin-Recht, oder der Ruleset-Spiegel der Projekt-Config hat keine id)" };
const FEHLT_FIX = {
  "Ruleset-Spiegel": FEHLT_FIX_STANDARD + " und die id des Rulesets im Spiegel eintragen; hat das Projekt kein Ruleset, mit Grund in projekt.punkteOhne abwählen",
  "Code-Scanning": FEHLT_FIX_STANDARD + "; hat das Projekt kein Code-Scanning-Modul, mit Grund in projekt.punkteOhne abwählen",
  Ruleset: FEHLT_FIX_STANDARD + "; hat das Projekt kein Ruleset (privates Repo ohne Plan), mit Grund in projekt.punkteOhne abwählen",
};

/** Der Punkt `Dependabot Alerts` aus dem HTTP-Status von `repos/<repo>/vulnerability-alerts` (204: an; 404 mit Admin-Recht: aus; sonst nicht prüfbar). Pur. */
export function pruefeAlerts({ status, admin, repo }) {
  const punkt = "Dependabot Alerts";
  if (status === 204) return { punkt, ok: true };
  if (status === 404 && admin) {
    return { ...luecke(punkt, "Dependabot Alerts sind aus", `Einstellungen > Advanced Security > Dependabot alerts aktivieren (oder nach Pre-Flight-Freigabe: gh api -X PUT repos/${repo}/vulnerability-alerts)`), soll: SOLL_JE_PUNKT[punkt] };
  }
  const grund = status === 404 ? "ohne Admin-Recht nicht lesbar (404)" : `Antwort ${status ?? "ohne Status"} nicht auswertbar`;
  return nichtPruefbar(punkt, `Dependabot Alerts: ${grund}`, "mit einem Token mit Admin-Recht prüfen (Secret PROJECT_TOKEN), dann erneut prüfen");
}

const NORM = { javascript: "javascript-typescript", typescript: "javascript-typescript", java: "java-kotlin", kotlin: "java-kotlin", c: "c-cpp", cpp: "c-cpp" };
const norm = (s) => NORM[String(s).toLowerCase()] ?? String(s).toLowerCase();

/** Die CodeQL-Sprachen, die das Repo haben sollte: Linguist-Sprachen (`languages`) über die Zuordnung `kern`, plus `actions` bei Workflows, abzüglich `ohne`. Pur. */
export function sollSprachen({ languages, kern, workflows, ohne = [] }) {
  const aus = new Set(Object.keys(languages).map((l) => kern[l]).filter(Boolean));
  if (workflows) aus.add("actions");
  for (const o of ohne) aus.delete(o.sprache);
  return [...aus].sort();
}

/** Die CodeQL-Sprachen, die das Repo hat: Modul `codeql` gewählt → `config.codeql.sprachen`, sonst das Default-Setup (`{ wert: { state, languages } }` oder `{ fehler }`). `{ sprachen }` oder `{ fehler }`. Pur. */
export function istSprachen({ config, defaultSetup }) {
  if ((config.module ?? []).includes("codeql")) return { sprachen: (config.codeql?.sprachen ?? []).map(norm) };
  if (defaultSetup?.fehler !== undefined || defaultSetup?.wert === undefined) return { fehler: defaultSetup?.fehler ?? "keine Antwort" };
  const w = defaultSetup.wert;
  return { sprachen: w.state === "configured" ? (w.languages ?? []).map(norm) : [], state: w.state };
}

/** Der Punkt `CodeQL-Sprachen`: Soll gegen Ist; Quelle nicht lesbar → nicht prüfbar. `eingabe`: `{ languages, kern, workflows, ohne, ist }`. Pur. */
export function pruefeCodeql({ languages, kern, workflows, ohne, ist }) {
  const punkt = "CodeQL-Sprachen";
  if (ist.fehler !== undefined || languages === undefined) return nichtPruefbar(punkt, `CodeQL-Sprachen: Quelle nicht lesbar (${ist.fehler ?? "Sprachen des Repos nicht lesbar"})`, "mit einem Token mit Leserecht auf das Repo prüfen (Secret PROJECT_TOKEN), dann erneut prüfen");
  const soll = sollSprachen({ languages, kern, workflows, ohne });
  const fehlt = soll.filter((s) => !ist.sprachen.includes(s));
  if (fehlt.length === 0) return { punkt, ok: true };
  const istText = ist.sprachen.length > 0 ? ist.sprachen.join(", ") : ist.state ? `Default-Setup ${ist.state}` : "keine";
  return { ...luecke(punkt, `CodeQL deckt ${fehlt.join(", ")} nicht ab (Ist: ${istText})`, `Sprachen in CodeQL ergänzen (Modul codeql: codeql.sprachen in der Projekt-Config) oder mit Grund in projekt.codeqlOhne eintragen`), soll: `CodeQL für ${soll.join(", ")}` };
}

const ZWS = String.fromCharCode(0x200b);
/** Macht Text für eine Markdown-Tabellenzelle sicher: eine Zeile, `|`, Backtick, spitze Klammern und `@` entschärft, Länge gedeckelt. Pur. */
export const zelle = (t) => {
  const s = String(t ?? "").replace(/\s*\r?\n\s*/g, " ").split("|").join("\\|").replace(/`/g, "'").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/@/g, `@${ZWS}`);
  return s.length > ZELLE_MAX ? `${s.slice(0, ZELLE_MAX)}…` : s;
};

const sollFuer = (r) => r.soll ?? SOLL_JE_PUNKT[Object.keys(SOLL_JE_PUNKT).filter((n) => trifft(r.punkt, n)).sort((a, b) => b.length - a.length)[0]] ?? "grün laut Harness-Doctor";

/** Titel des Tickets: `🛡️ Sicherheitsprüfung <JJJJ-MM>`. Pur. */
export const berichtTitel = (datum) => `${TITEL_PRAEFIX}${String(datum).slice(0, 7)}`;

/** Markdown-Body: Marker, Tabelle Punkt/Ist/Soll/Fix je Abweichung, danach die aktiven Ausnahmen mit Grund; über `BERICHT_MAX` gekürzt. Pur und deterministisch. */
export function berichtText({ abweichungen, ausnahmen = [], codeqlOhne = [], punkteOhne = [], datum }) {
  const kopf = [MARKER, `Monatliche Sicherheits- und Konfigurationsprüfung (${String(datum).slice(0, 10)}): ${abweichungen.length} Abweichung(en) vom Soll. Nicht prüfbare Punkte zählen als Abweichung; der Fix nennt dann das fehlende Recht. Mechanik: docs/agent-harness.md (Fabrik) § 2.2. Ein offenes Ticket unterdrückt neue Läufe: nach dem Beheben schließen.`, "", "| Punkt | Ist | Soll | Fix |", "| --- | --- | --- | --- |"];
  const fuss = [];
  const aus = [...ausnahmen.map((a) => `- Dependabot-Ausnahme \`${zelle(a.pfad)}\`: ${zelle(a.grund)}`), ...codeqlOhne.map((a) => `- CodeQL ohne \`${zelle(a.sprache)}\`: ${zelle(a.grund)}`), ...punkteOhne.map((a) => `- Punkt abgewählt \`${zelle(a.punkt)}\`: ${zelle(a.grund)}`)];
  if (aus.length > 0) fuss.push("", "Aktive Ausnahmen der Soll-Liste (projekt):", ...aus);
  const zeilen = abweichungen.map((r) => `| ${zelle(r.punkt)} | ${zelle(r.befund)} | ${zelle(sollFuer(r))} | ${zelle(r.fix)} |`);
  const voll = [...kopf, ...zeilen, ...fuss].join("\n");
  if (voll.length <= BERICHT_MAX) return voll;
  let n = zeilen.length;
  const kuerzung = (k) => [...kopf, ...zeilen.slice(0, k), `… ${zeilen.length - k} weitere Zeile(n) gekürzt`, ...fuss].join("\n");
  while (n > 0 && kuerzung(n).length > BERICHT_MAX) n--;
  return kuerzung(n);
}

/** Ist `issue` (`{ title, body, user, labels }`) ein Ticket der Sicherheitsprüfung: Marker im Body, Titelpräfix und vertrauter Autor (kein Fremdeingang)? Nur ein solches Ticket unterdrückt den Lauf. Pur. */
export const istTicket = (issue, owner, config) =>
  String(issue?.body ?? "").includes(MARKER) && String(issue?.title ?? "").startsWith(TITEL_PRAEFIX) && !istFremdeingang({ user: issue.user, labels: issue.labels }, owner, { config }).fremdeingang;

/** Die Entscheidung des Laufs: `nichts` (keine Abweichung oder schon ein offenes vertrautes Ticket der Sicherheitsprüfung, auch ein geclaimtes), sonst `anlegen`. Pur. */
export function entscheide({ abweichungen, offene, owner, config }) {
  if (abweichungen.length === 0) return { aktion: "nichts", grund: "keine Abweichung vom Soll", warnungen: [] };
  const da = offene.filter((i) => istTicket(i, owner, config));
  if (da.length > 0) return { aktion: "nichts", grund: `Ticket #${da[0].number} der Sicherheitsprüfung ist noch offen`, warnungen: [] };
  return { aktion: "anlegen", grund: `${abweichungen.length} Abweichung(en), kein offenes Ticket`, warnungen: [] };
}
