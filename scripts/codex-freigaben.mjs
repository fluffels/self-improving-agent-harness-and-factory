// Codex-Freigabetabelle (factory#363): einzige Quelle, welche Codex-CLI-Version autonom laufen darf.
// Rein und ohne Import. Ein Eintrag je geprüfter Version: Diagnose-Beleg plus Nachweise 1-5
// (docs/codex/einstieg.md § Vorprüfung), je `"offen"` oder `{ beleg: <https-URL> }`.
// Freigabe nur per reviewtem PR mit Beleg je Nachweis; Belege in API-Form per Repo-ID.
const VERSION = /^\d+\.\d+\.\d+$/;
const NUMMERN = ["1", "2", "3", "4", "5"];

export const FREIGABEN = Object.freeze({
  "0.164.0": {
    diagnose: "https://api.github.com/repositories/1434788646/pulls/82",
    nachweise: { 1: "offen", 2: "offen", 3: "offen", 4: "offen", 5: "offen" },
  },
});

export function istBelegUrl(v) {
  if (typeof v !== "string") return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.username === "" && u.password === "";
  } catch { return false; }
}

const gueltigerNachweis = (w) => w === "offen" || (w !== null && typeof w === "object" && Object.keys(w).join() === "beleg" && istBelegUrl(w.beleg));
const belegt = (w) => w !== null && typeof w === "object" && istBelegUrl(w.beleg);

function eintragMaengel(version, e) {
  const m = [];
  if (!VERSION.test(version)) m.push(`Freigabetabelle: Schlüssel "${version}" ist keine Version x.y.z`);
  if (e === null || typeof e !== "object") return [...m, `Freigabetabelle ${version}: Eintrag fehlt`];
  if (!istBelegUrl(e.diagnose)) m.push(`Freigabetabelle ${version}: Diagnose-Beleg ist keine https-URL`);
  const n = e.nachweise !== null && typeof e.nachweise === "object" ? e.nachweise : {};
  if (Object.keys(n).sort().join() !== NUMMERN.join()) m.push(`Freigabetabelle ${version}: Nachweise müssen genau 1-5 heißen`);
  for (const k of Object.keys(n)) if (!gueltigerNachweis(n[k])) m.push(`Freigabetabelle ${version}: Nachweis ${k} ist weder "offen" noch { beleg: https-URL }`);
  return m;
}

export function tabellenMaengel(tabelle) {
  return Object.entries(tabelle ?? {}).flatMap(([v, e]) => eintragMaengel(v, e));
}

// Fail-closed: alles außer einem gültigen Beleg zählt als offen.
export function offeneNachweise(eintrag) {
  const n = eintrag?.nachweise ?? {};
  return NUMMERN.filter((k) => !belegt(n[k])).map(Number);
}

export function freigabeMaengel({ installiert, belegt: belegteVersion, tabelle }) {
  const m = tabellenMaengel(tabelle);
  if (installiert === null || installiert === undefined) {
    return [...m, "Codex CLI nicht ermittelbar: `codex --version` nicht ausführbar oder ohne Versionsnummer (kein `codex` im PATH?)"];
  }
  if (belegteVersion !== installiert) {
    const b = typeof belegteVersion === "string" && VERSION.test(belegteVersion) ? belegteVersion : belegteVersion === undefined ? "keine" : "ungültig";
    m.push(`Codex CLI ${installiert} weicht von der belegten Version ${b} ab`);
  }
  if (!Object.hasOwn(tabelle ?? {}, installiert)) {
    m.push(`Codex CLI ${installiert} steht nicht in der Freigabetabelle (neue Prüfung nur per reviewtem PR)`);
    return m;
  }
  const offen = offeneNachweise(tabelle[installiert]);
  if (offen.length) m.push(`Autonomer Codex-Ticketlauf gesperrt: Nachweise ${offen.join(", ")} für Codex CLI ${installiert} offen (Freigabetabelle codex-freigaben)`);
  return m;
}
