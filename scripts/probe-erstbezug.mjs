// Probe-Erstbezug (factory#234), nur in der Fabrik: baut im Scratch einen simulierten Bezieher (Fixture-Projekt aus `test/fixtures/projekt-probe.json`, Projektdateien aus der Quelle, eine
// `AGENTS.md` mit Kern-Markern und einem Füll-Block in Größe von `PROJEKT_BLOCK_RAUM`), synct ihn aus einem lokalen Klon der Quelle mit lokalem Tag, fährt die mechanischen Update-Schritte
// (`UPDATE_SCHRITTE`) und dann `verifyKompakt`. Jeder Fund ist rot (Exit 1); eine leere Ergebnisliste ist nie grün. CI-Job und Checkliste des Tag-Takts rufen es gleich auf:
// `node scripts/probe-erstbezug.mjs --quelle <checkout> --scratch <leerer ordner> [--profil <name>]`; Exit 0 grün, 1 Fund, 2 Aufruf.
// `--profil <name>` (factory#224, synthetischer Bezieher): legt über das JS/TS-Fixture die Datei `test/fixtures/probe-profil/<name>.json` (Config-Overlay, Skripte, Dateien); Maven und pytest laufen dabei nicht, ein
// Node-Attrappe steht an ihrer Stelle in der `verify`-Kette (Rot durch Factory-Besitz entsteht in den Node-Gates, die die Profil-Gestalt lesen).
// Liegt nicht in `.factory/besitz.json`: es braucht die Fabrik-Fixture. Konvention #1398: kein Import aus einem Einstieg; Sync, Projektwerte und Gates laufen nur als Kindprozess.
// Grenzen: geprüft wird der Commit `HEAD` der Quelle (nicht der Arbeitsbaum; nur die Profil-Datei `--profil` liest `profilLaden` aus dem Arbeitsbaum von `--quelle`, in der CI ist beides gleich), ohne `--profil` nur das JS/TS-Profil (Java und Python: synthetische Bezieher, factory#224), ohne echte Projekt-Blöcke und Projekt-Eigenes;
// der Probe-Erstbezug ersetzt keinen echten Bezieher. Die Sync-Warnung `Kontextbudget knapp` (Projekt-Block über dem Projekt-Raum) ist kein Fund (factory#220, factory#237).
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, fstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { fehlerText } from "./gh-cli.mjs";
import { markerEnde, markerStart, PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "./besitz-lib.mjs";
import { PROJEKTDATEIEN } from "./harness-doctor-dateien.mjs";
import { PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { countChars, KERN_BLOCK_BUDGET, kernBlockZeichen, PROJEKT_BLOCK_RAUM } from "./kontext-budget-lib.mjs";
import { mechanischeSchritte, PROFIL_NAME, PROFIL_ORDNER, profilNamen, UPDATE_SCHRITTE } from "./release-tag-lib.mjs";

/** Name des lokalen Tags, den der Probe-Erstbezug in seinem Quell-Klon setzt (nie in der echten Quelle). */
export const PROBE_TAG = "probe-erstbezug";
/** Die Fixture-Config der Fabrik; im Fixture-Projekt liegt sie als `.factory/projekt.json`. */
export const FIXTURE_PFAD = "test/fixtures/projekt-probe.json";
/** Dateien, die der Sync nicht liefert und die der Probe-Erstbezug mit den Projektdateien aus der Quelle übernimmt (ergänzend zu `PROJEKTDATEIEN`). */
export const ZUSATZ_DATEIEN = Object.freeze(["package-lock.json", ".gitattributes", ".nvmrc", ".gitignore"]);
/** Anker-Stubs legt der Sync selbst an: diese Projektdateien baut die Probe bewusst nicht. */
const SYNC_STUBS = new Set(["docs/referenz/befehle.md", "docs/referenz/anlaufstellen.md"]);
/** Probe-lokale Ergänzungen der Fixture-Config (nur, wo die Fixture etwas nicht trägt); leer, solange die Fixture genügt. */
export const PROBE_OVERLAY = Object.freeze({});
/** Umgebungsvariablen, die ein Kindprozess nicht erben darf (sie verfälschen Diff-Basis, Config und Test-Lauf der Probe). */
const GESPERRTE_UMGEBUNG = ["FACTORY_DIFF_BASE", "FACTORY_PROJEKT_CONFIG", "FACTORY_PROJEKT_WURZEL"];
const IDENTITAET = ["-c", "user.name=probe-erstbezug", "-c", "user.email=probe@example.invalid"];
const PFAD_TOKEN = "<pfad>";
const TITEL = "# AGENTS.md (Probe-Erstbezug)\n\n";
const ZEILE = 80;

const geruest = (fuell) => `${TITEL}${markerStart("kern")}\n${markerEnde("kern")}\n\n${PROJEKT_BLOCK_START}\n${fuell}${PROJEKT_BLOCK_ENDE}\n`;
const raumVon = (text) => countChars(text) - /** @type {number} */ (kernBlockZeichen(text, { start: markerStart("kern"), ende: markerEnde("kern") }));

/**
 * Pur: Text der Fixture-`AGENTS.md`: leerer Kern-Block, Projekt-Block mit Füll-Zeilen. Außerhalb des Kern-Blocks (alles vor dem Start- und ab dem Ende-Marker, wie `kernBlockZeichen` zählt)
 * stehen genau `raum` Zeichen. Wirft, wenn `raum` kleiner als das Gerüst ist. Der Füll-Block trägt nur `x` und Zeilenumbrüche (keine Überschrift, kein Link, kein Wort der Umschrift-Liste).
 */
export function fuellAgentsMd({ raum }) {
  const leer = raumVon(geruest(""));
  if (!Number.isInteger(raum) || raum < leer) throw new Error(`Raum ${raum} ist kleiner als das Gerüst der AGENTS.md (${leer} Zeichen)`);
  const n = raum - leer;
  const rest = n % ZEILE;
  const fuell = `${`${"x".repeat(ZEILE - 1)}\n`.repeat(Math.floor(n / ZEILE))}${rest > 0 ? `${"x".repeat(rest - 1)}\n` : ""}`;
  return geruest(fuell);
}

/** Das Fixture-Projekt hat keine eigenen Tests (der Sync liefert keine Kern-Tests): `--passWithNoTests` im Test-Skript, sonst wäre `test` per Konstruktion rot. */
const ohneTestZwang = (pkg) => ({ ...pkg, scripts: { ...pkg.scripts, test: `${pkg.scripts?.test ?? "vitest run"} --passWithNoTests` } });

const mische = (basis, ueber) => {
  const aus = { ...basis };
  for (const [k, v] of Object.entries(ueber)) aus[k] = v && typeof v === "object" && !Array.isArray(v) && aus[k] && typeof aus[k] === "object" ? mische(aus[k], v) : v;
  return aus;
};

/** Quellpfad (im Klon) für eine Datei des Fixture-Projekts: die Config kommt aus der Fixture. */
export const quellPfadFuer = (pfad) => (pfad === PROJEKT_CONFIG ? FIXTURE_PFAD : pfad);

/**
 * Pur: Inhalt einer Datei des Fixture-Projekts aus dem Text der Quelle (die Anker-Stubs des Syncs fehlen in `fixturePfade`). `AGENTS.md` ist der Füll-Block (`text` unbenutzt), die Config die
 * Fixture plus Overlay, `package.json` behält den Namen und bekommt `--passWithNoTests` am Test-Skript; alles andere ist eine wörtliche Kopie.
 */
export function projektdatei({ pfad, text, raum, overlay = PROBE_OVERLAY, profil = null }) {
  if (pfad === "AGENTS.md") return fuellAgentsMd({ raum });
  if (pfad === PROJEKT_CONFIG) return `${JSON.stringify(mische(JSON.parse(text), mische(overlay, profil?.config ?? {})), null, 2)}\n`;
  if (pfad === "package.json") return `${JSON.stringify(mitProfil(ohneTestZwang(JSON.parse(text)), profil), null, 2)}\n`;
  return text;
}

/** Pur: die `package.json` mit den Skripten des Profils; `verify` bekommt `&& npm run <x>` je `verifyZusatz`. Ohne Profil unverändert. */
function mitProfil(pkg, profil) {
  if (!profil) return pkg;
  const scripts = { ...pkg.scripts, ...profil.skripte };
  for (const x of profil.verifyZusatz ?? []) scripts.verify = `${scripts.verify} && npm run ${x}`;
  return { ...pkg, scripts };
}

const PROFIL_SCHLUESSEL = /^[\w:.-]+$/u;
const GESCHUETZT = new Set(["AGENTS.md", PROJEKT_CONFIG, "package.json"]);
const FALL_QUELLE = /^factory#\d+ L\d+$/u;
/** Schlüssel des Config-Overlays, die ein Profil setzen darf (Quellwurzel, Coverage); alles andere (etwa befehle) bliebe ein Weg, Kern-Gates zu umgehen. */
const OVERLAY_SCHLUESSEL = ["struktur", "coverage"];

const istObjekt = (x) => Boolean(x) && typeof x === "object" && !Array.isArray(x);
const normal = (pfad) => posix.normalize(pfad.replaceAll("\\", "/"));
const unsicher = (pfad) => typeof pfad !== "string" || pfad === "" || isAbsolute(pfad) || pfad.split(/[\\/]/u).includes("..");

function dateienFehler(dateien) {
  if (!istObjekt(dateien)) return ["dateien muss ein Objekt {pfad: text} sein"];
  return Object.entries(dateien).flatMap(([pfad, text]) => {
    if (unsicher(pfad)) return [`dateien: Pfad ${JSON.stringify(pfad)} ist absolut, leer oder enthält ..`];
    const n = normal(pfad);
    return [
      ...(GESCHUETZT.has(n) ? [`dateien: ${pfad} gehört dem Aufbau (AGENTS.md, Projekt-Config, package.json) und ist nicht überschreibbar`] : []),
      ...(n === ".git" || n.startsWith(".git/") ? [`dateien: ${pfad} liegt in .git und ist nicht überschreibbar`] : []),
      ...(typeof text === "string" ? [] : [`dateien: Inhalt von ${pfad} ist kein Text`]),
    ];
  });
}

function skripteFehler({ skripte = {}, verifyZusatz = [] }) {
  if (!istObjekt(skripte)) return ["skripte muss ein Objekt {name: befehl} sein"];
  if (!Array.isArray(verifyZusatz)) return ["verifyZusatz muss eine Liste sein"];
  const namen = Object.keys(skripte);
  return [
    ...namen.filter((n) => !PROFIL_SCHLUESSEL.test(n)).map((n) => `skripte: Name ${JSON.stringify(n)} außerhalb von [\\w:.-]`),
    ...verifyZusatz.filter((x) => !namen.includes(x)).map((x) => `verifyZusatz: ${x} steht nicht in skripte`),
  ];
}

function fallFehler(fall, i, def) {
  const f = `faelle[${i}]`;
  if (!istObjekt(fall)) return [`${f}: muss ein Objekt sein`];
  const pfade = Array.isArray(fall.dateien) ? fall.dateien : [];
  const hat = pfade.length > 0;
  const nein = typeof fall.nichtAbbildbar === "string" && fall.nichtAbbildbar.trim() !== "";
  const imProfil = (x) => typeof x === "string" && (Object.hasOwn(def.dateien ?? {}, x) || (x.startsWith("config:") && x.length > 7));
  return [
    ...(FALL_QUELLE.test(fall.quelle ?? "") ? [] : [`${f}: quelle fehlt oder hat nicht die Form "factory#<nr> L<k>"`]),
    ...(hat === nein ? [`${f}: genau eines von dateien (Pfade des Profils) und nichtAbbildbar (Begründung) ist nötig`] : []),
    ...pfade.filter((x) => !imProfil(x)).map((x) => `${f}: ${String(x)} steht nicht in dateien (oder config:<schlüssel>)`),
  ];
}

const overlayFehler = (config) => (config === undefined ? [] : istObjekt(config) ? Object.keys(config).filter((k) => !OVERLAY_SCHLUESSEL.includes(k)).map((k) => `config: Schlüssel ${k} ist nicht erlaubt (nur ${OVERLAY_SCHLUESSEL.join(", ")})`) : ["config muss ein Objekt sein"]);

/** Pur: Fehlerliste einer Profil-Definition (`[]` = gültig); `name` ist der Dateiname ohne `.json`. Nichts davon wird geschrieben, bevor die Liste leer ist. */
export function pruefeProfil(def, name) {
  if (!istObjekt(def)) return ["Profil ist kein Objekt"];
  return [
    ...(def.profil === name ? [] : [`profil ${JSON.stringify(def.profil)} passt nicht zum Dateinamen ${name}`]),
    ...overlayFehler(def.config),
    ...skripteFehler(def),
    ...dateienFehler(def.dateien ?? {}),
    ...(Array.isArray(def.faelle ?? []) ? (def.faelle ?? []).flatMap((fall, i) => fallFehler(fall, i, def)) : ["faelle muss eine Liste sein"]),
  ];
}

/** Pur: Pfade des Fixture-Projekts in fester Reihenfolge (die geschlossene Liste `PROJEKTDATEIEN` plus `ZUSATZ_DATEIEN`, ohne die Anker-Stubs). */
export const fixturePfade = () => [...PROJEKTDATEIEN.map((d) => d.pfad), ...ZUSATZ_DATEIEN].filter((p) => !SYNC_STUBS.has(p));

/** Pur: Ergänzung der Befehle-Seite des Fixture-Projekts: jedes npm-Skript der `package.json` einmal erwähnt (das Gate `check:docdrift` verlangt das von jedem Projekt; der Sync legt nur einen Stub mit Überschriften an). */
export function befehleErgaenzung(packageText) {
  const namen = Object.keys(JSON.parse(packageText).scripts ?? {});
  return `\n## Befehle des Probe-Projekts\n\n${namen.map((n) => `- \`npm run ${n}\``).join("\n")}\n`;
}

/** Pur: die Umgebung für Kindprozesse ohne Diff-Basis, Config-Überschreibung und Vitest-Variablen. */
export function kindUmgebung(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !GESPERRTE_UMGEBUNG.includes(k) && !k.startsWith("VITEST")));
}

export const teile = (befehl) => befehl.split(/\s/u).filter(Boolean);

/**
 * Pur: die geordnete Schrittliste `[{ id, argv, cwd, kritisch }]` (oder `{ id, art: "fixture", cwd }` für den Aufbau der Projektdateien). `kritisch` = ein Rot bricht ab (Aufbau, Sync,
 * Installation); danach fährt die Probe jeden Schritt, damit sie alle Funde auf einmal zeigt. `quelle` ist der echte Checkout (nur zum Klonen), `scratch` der leere Arbeitsordner.
 */
export function probeSchritte({ quelle, scratch, tag, sha, profil = null }) {
  const q = join(scratch, "quelle");
  const b = join(scratch, "bezieher");
  const sync = [process.execPath, join(q, "scripts", "factory-sync.mjs"), "--quelle", q, "--ziel", b];
  const k = (id, argv, cwd) => ({ id, argv, cwd, kritisch: true });
  const mechanisch = UPDATE_SCHRITTE.filter((s) => s.mechanisch).map((s) => s.id);
  const mech = mechanischeSchritte(PFAD_TOKEN).map((befehl, i) => ({ id: mechanisch[i], argv: teile(befehl).map((t) => t.replaceAll(PFAD_TOKEN, q)), cwd: b, kritisch: false }));
  const verify = UPDATE_SCHRITTE.find((s) => s.id === "verify");
  return [
    k("klon", ["git", "clone", "--no-local", "--quiet", quelle, q], scratch),
    k("klon-origin", ["git", "-C", q, "remote", "remove", "origin"], scratch),
    k("tag", ["git", "-C", q, "tag", tag, sha], scratch),
    k("detach", ["git", "-C", q, "checkout", "--quiet", "--detach", sha], scratch),
    { id: "fixture", art: "fixture", cwd: b, kritisch: true, profil },
    k("fixture-init", ["git", "init", "--quiet", "-b", "main", b], scratch),
    k("fixture-add", ["git", "-C", b, "add", "-A"], scratch),
    k("fixture-commit", ["git", "-C", b, ...IDENTITAET, "commit", "--quiet", "-m", "Probe-Erstbezug"], scratch),
    k("sync-vorschau", [...sync, "--entwurf", "--trocken"], b),
    k("sync-tag", [...sync, "--tag", tag], b),
    { id: "befehle", art: "befehle", cwd: b, kritisch: true },
    k("install", teile("node scripts/gate-befehl.mjs install"), b),
    ...mech,
    { id: "verifyKompakt", argv: teile(verify.befehl), cwd: b, kritisch: false },
  ];
}

/** Pur: Urteil über die Ergebnisse `[{ id, status }]`: Exit 0 nur, wenn mindestens ein Schritt lief und alle 0 hatten. Eine leere Liste ist rot (nie „übersprungen“). → `{ code, zeilen }`. */
export function probeUrteil(ergebnisse) {
  if (!Array.isArray(ergebnisse) || ergebnisse.length === 0) return { code: 1, zeilen: ["ROT: kein Schritt der Probe ist gelaufen (leere Ergebnisliste zählt nie als grün)"] };
  const rot = ergebnisse.filter((e) => e.status !== 0);
  if (rot.length === 0) return { code: 0, zeilen: [`GRÜN: ${ergebnisse.length} Schritte ohne Fund`] };
  return { code: 1, zeilen: rot.map((e) => `ROT ${e.id}: Exit ${e.status ?? "kein Exit (Abbruch oder Zeitüberschreitung)"}`) };
}

/** Pur: Gründe, aus denen der Raum-Vertrag bei den Messwerten verletzt ist (Kern über Budget, Raum ungleich Soll, Gesamt über dem Gesamtbudget); leer = eingehalten. */
function vertragsGruende({ kern, raum, gesamt }) {
  const gruende = [];
  if (kern > KERN_BLOCK_BUDGET) gruende.push(`Kern-Block ${kern} > Budget ${KERN_BLOCK_BUDGET}`);
  if (raum !== PROJEKT_BLOCK_RAUM) gruende.push(`Raum ${raum} ≠ Soll ${PROJEKT_BLOCK_RAUM}`);
  if (gesamt > KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM) gruende.push(`Summe ${gesamt} > Gesamtbudget ${KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM}`);
  return gruende;
}

/** Pur: Messzeile der Fixture-`AGENTS.md` gegen die Budgets (Kern-Block, Raum, Gesamt) samt Raum-Vertrag (nur Info, das Urteil bleibt unverändert; factory#237), `null` wenn die Marker fehlen. */
export function messZeile(text) {
  const kern = kernBlockZeichen(text, { start: markerStart("kern"), ende: markerEnde("kern") });
  if (kern === null) return null;
  const gesamt = countChars(text);
  const gruende = vertragsGruende({ kern, raum: gesamt - kern, gesamt });
  const vertrag = gruende.length === 0 ? "eingehalten" : `verletzt — ${gruende.join("; ")}`;
  return `Messung Fixture-AGENTS.md: Kern-Block ${kern} (Budget ${KERN_BLOCK_BUDGET}), Raum ${gesamt - kern} (Soll ${PROJEKT_BLOCK_RAUM}), gesamt ${gesamt} (Budget ${KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM}) · Raum-Vertrag: ${vertrag}`;
}

/** Pur: liegt `pfad` in `ordner` oder ist er es selbst (relativer Pfad leer)? `relative` liefert bei einem anderen Laufwerk einen absoluten Pfad: dann nein. */
export const liegtIn = (ordner, pfad, p = { relative, isAbsolute, sep }) => {
  const rel = p.relative(ordner, pfad);
  return rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
};

/** Liest und prüft das Profil `name` aus dem Arbeitsbaum der Quelle: `{ profil }` oder `{ text }` (Aufruf-Fehler mit der Liste bekannter Profile). */
function profilLaden(name, quelle, io) {
  const bekannt = profilNamen(io.liste?.(join(quelle, PROFIL_ORDNER)) ?? []).join(", ") || "keine";
  if (!PROFIL_NAME.test(name)) return { text: `--profil ${JSON.stringify(name)}: ungültiger Name (bekannt: ${bekannt})` };
  const roh = io.lies(join(quelle, PROFIL_ORDNER, `${name}.json`));
  if (roh === null) return { text: `--profil ${name}: Datei ${PROFIL_ORDNER}/${name}.json fehlt in der Quelle (bekannt: ${bekannt})` };
  let def;
  try {
    def = JSON.parse(roh);
  } catch (e) {
    return { text: `--profil ${name}: kein gültiges JSON (${fehlerText(e)})` };
  }
  const fehler = pruefeProfil(def, name);
  return fehler.length > 0 ? { text: `--profil ${name} ungültig:\n- ${fehler.join("\n- ")}` } : { profil: def };
}

/** Aufruf-Fehler als Text oder `null`: `--quelle`/`--scratch` Pflicht, Scratch leer und außerhalb der Quelle, Quelle ein Git-Repo, keine Leerzeichen in den Pfaden (die Schrittbefehle sind Wort-Listen). */
export function aufrufFehler(argv, io) {
  const r = flagsLesen(argv, { quelle: { type: "string" }, scratch: { type: "string" }, profil: { type: "string" } }, { pflicht: ["quelle", "scratch"] });
  if (r.fehler) return { text: r.fehler.text };
  const quelle = resolve(r.werte.quelle);
  const scratch = resolve(r.werte.scratch);
  if (/\s/u.test(quelle + scratch)) return { text: "Pfade mit Leerzeichen gehen nicht (die Befehle der Schrittliste sind Wort-Listen)" };
  if (!io.istGitRepo(quelle)) return { text: `--quelle ${quelle} ist kein Git-Repo` };
  if (liegtIn(quelle, scratch)) return { text: `--scratch ${scratch} liegt in der Quelle ${quelle}` };
  if (!io.istLeer(scratch)) return { text: `--scratch ${scratch} ist nicht leer` };
  if (r.werte.profil === undefined) return { quelle, scratch };
  const p = profilLaden(r.werte.profil, quelle, io);
  return p.text ? p : { quelle, scratch, profil: p.profil };
}

/** Baut die Projektdateien des Fixture-Projekts nach `ziel` (Quelle: der Klon `von`). `io` = `{ lies, schreibe }`. */
export function baueFixture({ von, ziel, raum, io, profil = null }) {
  for (const pfad of fixturePfade()) {
    const text = pfad === "AGENTS.md" ? "" : io.lies(join(von, quellPfadFuer(pfad)));
    if (text === null) throw new Error(`Projektdatei ${pfad} fehlt in der Quelle (${quellPfadFuer(pfad)})`);
    io.schreibe(join(ziel, pfad), projektdatei({ pfad, text, raum, profil }));
  }
  for (const [pfad, text] of Object.entries(profil?.dateien ?? {})) io.schreibe(join(ziel, pfad), text);
}

/** Führt die Schritte nacheinander aus (`io.fuehre(schritt)` → Exit oder `null`), bricht nach einem kritischen Rot ab. → `[{ id, status, stderr? }]` (`stderr` = Ende der Fehlerausgabe, falls die Naht `stderrRest(id)` hat). */
export function fuehreSchritte(schritte, io) {
  const ergebnisse = [];
  for (const s of schritte) {
    io.melde(`--- ${s.id}`);
    const status = s.art ? io[s.art](s) : io.fuehre(s);
    const rest = status !== 0 ? io.stderrRest?.(s.id) : undefined;
    ergebnisse.push(rest ? { id: s.id, status, stderr: rest } : { id: s.id, status });
    if (status !== 0 && s.kritisch) break;
  }
  return ergebnisse;
}

/** Hauptablauf mit Nähten `io`: → `{ code, out, err }`. */
export function main(argv, io) {
  const a = aufrufFehler(argv, io);
  if (a.text) return { code: AUFRUF_EXIT, out: "", err: `${a.text}\nAufruf: node scripts/probe-erstbezug.mjs --quelle <checkout> --scratch <leerer ordner> [--profil <name>] (geprüft wird der Commit HEAD der Quelle)\n` };
  const sha = io.kopf(a.quelle);
  if (!sha) return { code: AUFRUF_EXIT, out: "", err: `HEAD der Quelle ${a.quelle} nicht lesbar\n` };
  const ergebnisse = fuehreSchritte(probeSchritte({ quelle: a.quelle, scratch: a.scratch, tag: PROBE_TAG, sha, profil: a.profil ?? null }), io.mitScratch(a.scratch));
  const mess = messZeile(io.lies(join(a.scratch, "bezieher", "AGENTS.md")) ?? "");
  const urteil = probeUrteil(ergebnisse);
  const kopf = a.profil ? [`Profil: ${a.profil.profil} (synthetischer Bezieher, factory#224)`] : [];
  return { code: urteil.code, out: `${[...kopf, mess ?? "Messung nicht möglich (AGENTS.md des Fixture-Projekts fehlt oder ohne Marker)", ...urteil.zeilen].join("\n")}\n`, err: "" };
}

/** Zeichen vom Ende der Fehlerausgabe eines Schritts, die `stderrRest` behält. */
const STDERR_REST = 2000;

/** Letzte `STDERR_REST` Zeichen der Datei hinter `fd`: nur das Ende wird gelesen (Fenster in Bytes, weil ein Zeichen bis zu 4 Bytes hat; ein am Fensteranfang angeschnittenes Zeichen fällt beim Kürzen weg). */
function stderrEnde(fd) {
  const groesse = fstatSync(fd).size;
  const laenge = Math.min(groesse, STDERR_REST * 4 + 3);
  const puffer = Buffer.alloc(laenge);
  let gelesen = 0;
  while (gelesen < laenge) {
    const n = readSync(fd, puffer, gelesen, laenge - gelesen, groesse - laenge + gelesen);
    if (n === 0) break;
    gelesen += n;
  }
  return puffer.subarray(0, gelesen).toString("utf8").slice(-STDERR_REST);
}

/** Echte Nähte: Dateisystem, `spawn` (Standard `spawnSync`; Ausgabe der Schritte standardmäßig geerbt, `stdio` überschreibt es, `"stderr"` ignoriert stdout und leitet stderr in eine Temp-Datei, von der `stderrRest` nur das Ende liest: kein Pipe-Puffer, kein `maxBuffer`, das Kind wird nie wegen zu viel Ausgabe abgebrochen; ohne Zeitlimit, damit kein Prozessbaum zurückbleibt). */
export function echteNaehte(stdio = "inherit", { spawn = spawnSync } = {}) {
  const lies = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const reste = new Map();
  const lauf = (argv, cwd, id) => {
    if (stdio !== "stderr") return spawn(argv[0], argv.slice(1), { cwd, env: kindUmgebung(process.env), stdio, encoding: "utf8" }).status;
    const ordner = mkdtempSync(join(tmpdir(), "probe-stderr-"));
    const fd = openSync(join(ordner, "stderr.log"), "w+");
    try {
      const r = spawn(argv[0], argv.slice(1), { cwd, env: kindUmgebung(process.env), stdio: ["ignore", "ignore", fd], encoding: "utf8" });
      reste.set(id, stderrEnde(fd));
      return r.status;
    } finally {
      closeSync(fd);
      rmSync(ordner, { recursive: true, force: true });
    }
  };
  const io = {
    lies,
    istGitRepo: (p) => spawnSync("git", ["-C", p, "rev-parse", "--git-dir"], { stdio: "ignore" }).status === 0,
    liste: (p) => (existsSync(p) ? readdirSync(p) : []),
    istLeer: (p) => !existsSync(p) || readdirSync(p).length === 0,
    kopf: (p) => {
      const r = spawnSync("git", ["-C", p, "rev-parse", "HEAD"], { encoding: "utf8" });
      return r.status === 0 ? r.stdout.trim() : null;
    },
    melde: (t) => process.stdout.write(`${t}\n`),
    mitScratch: (scratch) => {
      mkdirSync(scratch, { recursive: true });
      return {
        ...io,
        fuehre: (s) => lauf(s.argv, s.cwd, s.id),
        stderrRest: (id) => reste.get(id),
        befehle: (s) => {
          try {
            const seite = join(s.cwd, "docs", "referenz", "befehle.md");
            writeFileSync(seite, `${readFileSync(seite, "utf8")}${befehleErgaenzung(readFileSync(join(s.cwd, "package.json"), "utf8"))}`);
            return 0;
          } catch (e) {
            process.stderr.write(`${fehlerText(e)}\n`);
            return 1;
          }
        },
        fixture: (s) => {
          try {
            baueFixture({ von: join(scratch, "quelle"), ziel: s.cwd, raum: PROJEKT_BLOCK_RAUM, profil: s.profil ?? null, io: { lies, schreibe: (p, t) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, t)) } });
            return 0;
          } catch (e) {
            process.stderr.write(`${fehlerText(e)}\n`);
            return 1;
          }
        },
      };
    },
  };
  return io;
}

if (istDirektaufruf(import.meta.url)) {
  const r = main(process.argv.slice(2), echteNaehte());
  process.stdout.write(r.out);
  process.stderr.write(r.err);
  process.exitCode = r.code;
}
