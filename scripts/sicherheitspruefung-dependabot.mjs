// Kein Shebang, kein Direktaufruf: pure Lib der Sicherheitsprüfung (factory#388). Prüft, ob `.github/dependabot.yml` jedes Manifest des Repos abdeckt
// (Ökosystem und Verzeichnis), ohne Modell und ohne Netz; Dateiliste und Dateitexte reicht der Aufrufer herein.
//
// Der Text-Leser kennt nur, was die Prüfung braucht: je Eintrag unter `updates:` die Schlüssel `package-ecosystem`, `directory` und `directories` (Block- oder Flow-Liste,
// Anführungszeichen, Kommentare). Er ist bewusst kein YAML-Parser (der Job hat kein `npm ci`, ein Paket wäre dort Fremdcode mit Schreibrecht): fehlt `updates:` oder ein Eintrag
// ohne Ökosystem oder Verzeichnis, ist der Punkt „nicht prüfbar“ (fail-closed).
//
// Grenzen (bewusst nicht erfasst): Anker und Aliase, `multi-ecosystem-groups`, Manifeste außerhalb der geschlossenen Liste `MANIFESTE` (Erweiterung: `projekt.manifeste` der Soll-Liste),
// Maven-`<modules>` und Gradle-`settings.gradle` (ein Vorfahr-Verzeichnis mit eigenem Manifest desselben Ökosystems gilt als Aggregator), `.gitignore`d Dateien (Quelle ist `git ls-files`).
import { gut, luecke, nichtPruefbar } from "./harness-doctor-ergebnis.mjs";

const PUNKT = "Dependabot-Abdeckung";
const DATEI = ".github/dependabot.yml";

/** Die geschlossene Manifest-Liste je Ökosystem (Dateiname-Test). GitHub Actions hat die eigene Regel `WORKFLOW`. */
export const MANIFESTE = [
  ["npm", (b) => b === "package.json"],
  ["maven", (b) => b === "pom.xml"],
  ["gradle", (b) => /^build\.gradle(\.kts)?$/.test(b)],
  ["docker", (b) => b === "Dockerfile" || b.startsWith("Dockerfile.")],
  ["pip", (b) => b === "requirements.txt" || b === "pyproject.toml"],
  ["gomod", (b) => b === "go.mod"],
  ["cargo", (b) => b === "Cargo.toml"],
];
const WORKFLOW = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const AGGREGATOR = new Set(["maven", "gradle"]);

const entquote = (w) => w.trim().replace(/^(["'])(.*)\1$/, "$2");
const einzug = (z) => z.length - z.trimStart().length;

/** Entfernt einen Kommentar am Zeilenende (`#` am Anfang oder nach Leerraum, außerhalb von Anführungszeichen). Pur. */
export function ohneKommentar(zeile) {
  let q = null;
  for (let i = 0; i < zeile.length; i++) {
    const c = zeile[i];
    if (q) q = c === q ? null : q;
    else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(zeile[i - 1]))) return zeile.slice(0, i);
  }
  return zeile;
}

const flowListe = (w) => w.replace(/^\[|\]$/g, "").split(",").map(entquote).filter((s) => s !== "");

/** Die Zeilen unter `updates:` (ohne Kommentare, Leerzeilen), bis der nächste Schlüssel ohne Einzug beginnt; `null`, wenn `updates:` fehlt. */
function updatesZeilen(text) {
  const alle = String(text).replace(/\r/g, "").split("\n").map(ohneKommentar);
  const start = alle.findIndex((z) => /^updates:\s*$/.test(z));
  if (start < 0) return null;
  const rest = alle.slice(start + 1).filter((z) => z.trim() !== "");
  const ende = rest.findIndex((z) => einzug(z) === 0 && !z.startsWith("-"));
  return ende < 0 ? rest : rest.slice(0, ende);
}

/** Zerlegt die Zeilen in Einträge (Beginn: `- ` im kleinsten Einzug der Liste). */
function eintragsBloecke(zeilen) {
  const dash = zeilen.filter((z) => z.trimStart().startsWith("- ")).map(einzug);
  if (dash.length === 0) return [];
  const basis = Math.min(...dash);
  const bloecke = [];
  for (const z of zeilen) {
    if (einzug(z) === basis && z.trimStart().startsWith("- ")) bloecke.push([]);
    if (bloecke.length > 0) bloecke.at(-1).push(z);
  }
  return bloecke;
}

/** Liest `{ oekosystem, verzeichnisse }` aus einem Eintrag; `null`, wenn Ökosystem oder Verzeichnis fehlen. */
function liesEintrag(zeilen) {
  const kopf = zeilen.map((z, i) => (i === 0 ? z.replace(/^(\s*)-\s+/, "$1  ") : z));
  const schluesselEinzug = einzug(kopf[0]);
  let oekosystem;
  const verz = [];
  for (let i = 0; i < kopf.length; i++) {
    if (einzug(kopf[i]) !== schluesselEinzug) continue;
    const m = /^\s*([\w-]+):\s*(.*)$/.exec(kopf[i]);
    if (!m) continue;
    m[2] = m[2].trim();
    if (m[1] === "package-ecosystem") oekosystem = entquote(m[2]);
    else if (m[1] === "directory" && m[2] !== "") verz.push(entquote(m[2]));
    else if (m[1] === "directories") verz.push(...(m[2].startsWith("[") ? flowListe(m[2]) : blockListe(kopf, i, schluesselEinzug)));
  }
  return oekosystem && verz.length > 0 ? { oekosystem, verzeichnisse: verz } : null;
}

function blockListe(zeilen, ab, schluesselEinzug) {
  const werte = [];
  for (const z of zeilen.slice(ab + 1)) {
    const t = z.trim();
    if (!t.startsWith("-") || einzug(z) < schluesselEinzug) break;
    werte.push(entquote(t.slice(1)));
  }
  return werte;
}

/** Liest `dependabot.yml`: `{ eintraege: [{ oekosystem, verzeichnisse }] }` oder `{ fehler }` (fail-closed). Pur. */
export function liesDependabot(text) {
  const zeilen = updatesZeilen(text);
  if (zeilen === null) return { fehler: "kein Abschnitt `updates:` gefunden" };
  const eintraege = [];
  for (const b of eintragsBloecke(zeilen)) {
    const e = liesEintrag(b);
    if (!e) return { fehler: "ein Eintrag unter `updates:` hat kein `package-ecosystem` oder kein `directory`/`directories`" };
    eintraege.push(e);
  }
  return eintraege.length === 0 ? { fehler: "`updates:` enthält keinen Eintrag" } : { eintraege };
}

const normVerz = (v) => (`/${String(v).replace(/^\/+|\/+$/g, "")}`);
/** Glob → Regex: Zeichen maskieren, dann `**` (beliebig tief) und `*` (ein Segment) über Teilen am Doppelstern. */
const globRegex = (muster) => {
  const teil = (s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${normVerz(muster).split("**").map(teil).join(".*")}$`);
};
/** Trifft das Verzeichnis `verz` das Muster `muster` (`*` ein Segment, `**` beliebig tief)? Pur. */
export const passtVerzeichnis = (muster, verz) => globRegex(muster).test(normVerz(verz));

const verzeichnisVon = (datei) => normVerz(datei.includes("/") ? datei.slice(0, datei.lastIndexOf("/")) : "");

/** Die Manifeste der getrackten Dateien: `[{ oekosystem, verzeichnis, datei }]`. `projekt`: `{ manifeste: [{ oekosystem, datei }], ausnahmen: [{ pfad }] }`. `node_modules` zählt nie. Pur. */
export function findeManifeste(dateien, { manifeste = [], ausnahmen = [] } = {}) {
  const ausgenommen = (verz) => ausnahmen.some((a) => passtVerzeichnis(a.pfad, verz) || normVerz(verz).startsWith(`${normVerz(a.pfad)}/`));
  const treffer = [];
  for (const datei of dateien) {
    if (datei.split("/").includes("node_modules")) continue;
    const basis = datei.split("/").at(-1);
    const oe = WORKFLOW.test(datei) ? "github-actions" : [...MANIFESTE, ...manifeste.map((m) => [m.oekosystem, (b) => b === m.datei])].find(([, test]) => test(basis))?.[0];
    if (oe) treffer.push({ oekosystem: oe, verzeichnis: oe === "github-actions" ? "/" : verzeichnisVon(datei), datei });
  }
  return treffer.filter((t) => !ausgenommen(t.verzeichnis));
}

const direkt = (eintraege, oe, verz) => eintraege.some((e) => e.oekosystem === oe && e.verzeichnisse.some((m) => passtVerzeichnis(m, verz)));
const vorfahren = (verz) => normVerz(verz).split("/").filter(Boolean).map((_, i, teile) => normVerz(teile.slice(0, i).join("/")));

/** Workspace-Muster des `package.json` in `verz` (Array oder `.packages`), relativ zu `verz`; ohne Negationen. */
function workspaces(lese, verz) {
  const pkg = lese(verz);
  const w = Array.isArray(pkg?.workspaces) ? pkg.workspaces : pkg?.workspaces?.packages;
  return (Array.isArray(w) ? w : []).filter((p) => typeof p === "string" && !p.startsWith("!")).map((p) => normVerz(`${verz === "/" ? "" : verz}/${p.replace(/^\.\//, "")}`));
}

/** Ist das Manifest `m` abgedeckt: direkt, per npm-Workspace eines abgedeckten Vorfahren oder per Maven-/Gradle-Aggregator (abgedeckter Vorfahr mit eigenem Manifest)? Pur bis auf `lesePackageJson`. */
function abgedeckt(m, { eintraege, alle, lesePackageJson }) {
  if (direkt(eintraege, m.oekosystem, m.verzeichnis)) return true;
  const ahnen = vorfahren(m.verzeichnis).filter((a) => direkt(eintraege, m.oekosystem, a));
  if (m.oekosystem === "npm") return ahnen.some((a) => workspaces(lesePackageJson, a).some((p) => passtVerzeichnis(p, m.verzeichnis)));
  return AGGREGATOR.has(m.oekosystem) && ahnen.some((a) => alle.some((x) => x.oekosystem === m.oekosystem && x.verzeichnis === a));
}

const fixFuer = (oe, verz) => `in ${DATEI} unter updates einen Eintrag ergänzen: package-ecosystem "${oe}", directory "${verz}", schedule interval "weekly"`;

/**
 * Die Ergebnisse des Punkts `Dependabot-Abdeckung`: je fehlendem Paar (Ökosystem, Verzeichnis) eine Lücke mit `befund` (Ist), `soll` und `fix`; nichts fehlt: `gut`;
 * `dependabot.yml` fehlt bei vorhandenen Manifesten: eine Lücke; nicht lesbar: nicht prüfbar. `eingabe`: `{ dateien, dependabotText, lesePackageJson(verz), projekt }`. Pur bis auf `lesePackageJson`.
 */
export function pruefeDependabot({ dateien, dependabotText, lesePackageJson = () => null, projekt = {} }) {
  const alle = findeManifeste(dateien, projekt);
  if (alle.length === 0) return [gut(PUNKT)];
  const soll = "je Manifest ein Dependabot-Eintrag für Ökosystem und Verzeichnis";
  if (dependabotText == null) return [{ ...luecke(PUNKT, `${DATEI} fehlt, ${alle.length} Manifest(e) vorhanden`, `${DATEI} anlegen und alle Manifeste eintragen`), soll }];
  const gelesen = liesDependabot(dependabotText);
  if (gelesen.fehler) return [nichtPruefbar(PUNKT, `${DATEI} nicht lesbar (${gelesen.fehler})`, `${DATEI} prüfen (Struktur: updates mit package-ecosystem und directory)`)];
  const fehlend = new Map();
  for (const m of alle) if (!abgedeckt(m, { eintraege: gelesen.eintraege, alle, lesePackageJson })) fehlend.set(`${m.oekosystem} ${m.verzeichnis}`, m);
  if (fehlend.size === 0) return [gut(PUNKT)];
  return [...fehlend.values()].map((m) => ({ ...luecke(`${PUNKT} ${m.oekosystem} ${m.verzeichnis}`, `kein Eintrag für ${m.oekosystem} in ${m.verzeichnis} (Manifest ${m.datei})`, fixFuer(m.oekosystem, m.verzeichnis)), soll }));
}
