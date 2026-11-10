// Probe-Erstbezug (factory#234), nur in der Fabrik: baut im Scratch einen simulierten Bezieher (Fixture-Projekt aus `test/fixtures/projekt-probe.json`, Projektdateien aus der Quelle, eine
// `AGENTS.md` mit Kern-Markern und einem Füll-Block in Größe von `PROJEKT_BLOCK_RAUM`), synct ihn aus einem lokalen Klon der Quelle mit lokalem Tag, fährt die mechanischen Update-Schritte
// (`UPDATE_SCHRITTE`) und dann `verifyKompakt`. Jeder Fund ist rot (Exit 1); eine leere Ergebnisliste ist nie grün. CI-Job und Checkliste des Tag-Takts rufen es gleich auf:
// `node scripts/probe-erstbezug.mjs --quelle <checkout> --scratch <leerer ordner>`; Exit 0 grün, 1 Fund, 2 Aufruf.
// Liegt nicht in `.factory/besitz.json`: es braucht die Fabrik-Fixture. Konvention #1398: kein Import aus einem Einstieg; Sync, Projektwerte und Gates laufen nur als Kindprozess.
// Grenzen: geprüft wird der Commit `HEAD` der Quelle (nicht der Arbeitsbaum), nur das JS/TS-Profil (andere Profile: factory#224), ohne echte Projekt-Blöcke und Projekt-Eigenes;
// der Probe-Erstbezug ersetzt keinen echten Bezieher. Die Sync-Warnung `Kontextbudget knapp` ist kein Fund (factory#220).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { istDirektaufruf } from "./direktaufruf.mjs";
import { AUFRUF_EXIT, flagsLesen } from "./flag-lib.mjs";
import { fehlerText } from "./gh-cli.mjs";
import { markerEnde, markerStart, PROJEKT_BLOCK_ENDE, PROJEKT_BLOCK_START } from "./besitz-lib.mjs";
import { PROJEKTDATEIEN } from "./harness-doctor-dateien.mjs";
import { PROJEKT_CONFIG } from "./projekt-config-lib.mjs";
import { countChars, KERN_BLOCK_BUDGET, kernBlockZeichen, PROJEKT_BLOCK_RAUM } from "./kontext-budget-lib.mjs";
import { mechanischeSchritte, UPDATE_SCHRITTE } from "./release-tag-lib.mjs";

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
 * Fixture plus Overlay, `package.json` bekommt den Probe-Namen; alles andere ist eine wörtliche Kopie.
 */
export function projektdatei({ pfad, text, raum, overlay = PROBE_OVERLAY }) {
  if (pfad === "AGENTS.md") return fuellAgentsMd({ raum });
  if (pfad === PROJEKT_CONFIG) return `${JSON.stringify(mische(JSON.parse(text), overlay), null, 2)}\n`;
  if (pfad === "package.json") return `${JSON.stringify(ohneTestZwang(JSON.parse(text)), null, 2)}\n`;
  return text;
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
export function probeSchritte({ quelle, scratch, tag, sha }) {
  const q = join(scratch, "quelle");
  const b = join(scratch, "bezieher");
  const sync = [process.execPath, join(q, "scripts", "factory-sync.mjs"), "--quelle", q, "--ziel", b];
  const k = (id, argv, cwd) => ({ id, argv, cwd, kritisch: true });
  const mechanisch = UPDATE_SCHRITTE.filter((s) => s.mechanisch).map((s) => s.id);
  const mech = mechanischeSchritte(PFAD_TOKEN).map((befehl, i) => ({ id: mechanisch[i], argv: teile(befehl).map((t) => t.replaceAll(PFAD_TOKEN, q)), cwd: b, kritisch: false }));
  const verify = UPDATE_SCHRITTE.find((s) => s.id === "verify");
  return [
    k("klon", ["git", "clone", "--quiet", quelle, q], scratch),
    k("klon-origin", ["git", "-C", q, "remote", "remove", "origin"], scratch),
    k("tag", ["git", "-C", q, "tag", tag, sha], scratch),
    k("detach", ["git", "-C", q, "checkout", "--quiet", "--detach", sha], scratch),
    { id: "fixture", art: "fixture", cwd: b, kritisch: true },
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

/** Pur: Messzeile der Fixture-`AGENTS.md` gegen die Budgets (Kern-Block, Raum, Gesamt), `null` wenn die Marker fehlen. */
export function messZeile(text) {
  const kern = kernBlockZeichen(text, { start: markerStart("kern"), ende: markerEnde("kern") });
  if (kern === null) return null;
  const gesamt = countChars(text);
  return `Messung Fixture-AGENTS.md: Kern-Block ${kern} (Budget ${KERN_BLOCK_BUDGET}), Raum ${gesamt - kern} (Soll ${PROJEKT_BLOCK_RAUM}), gesamt ${gesamt} (Budget ${KERN_BLOCK_BUDGET + PROJEKT_BLOCK_RAUM})`;
}

/** Pur: liegt `pfad` in `ordner` oder ist er es selbst (relativer Pfad leer)? `relative` liefert bei einem anderen Laufwerk einen absoluten Pfad: dann nein. */
export const liegtIn = (ordner, pfad, p = { relative, isAbsolute, sep }) => {
  const rel = p.relative(ordner, pfad);
  return rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
};

/** Aufruf-Fehler als Text oder `null`: `--quelle`/`--scratch` Pflicht, Scratch leer und außerhalb der Quelle, Quelle ein Git-Repo, keine Leerzeichen in den Pfaden (die Schrittbefehle sind Wort-Listen). */
export function aufrufFehler(argv, io) {
  const r = flagsLesen(argv, { quelle: { type: "string" }, scratch: { type: "string" } }, { pflicht: ["quelle", "scratch"] });
  if (r.fehler) return { text: r.fehler.text };
  const quelle = resolve(r.werte.quelle);
  const scratch = resolve(r.werte.scratch);
  if (/\s/u.test(quelle + scratch)) return { text: "Pfade mit Leerzeichen gehen nicht (die Befehle der Schrittliste sind Wort-Listen)" };
  if (!io.istGitRepo(quelle)) return { text: `--quelle ${quelle} ist kein Git-Repo` };
  if (liegtIn(quelle, scratch)) return { text: `--scratch ${scratch} liegt in der Quelle ${quelle}` };
  if (!io.istLeer(scratch)) return { text: `--scratch ${scratch} ist nicht leer` };
  return { quelle, scratch };
}

/** Baut die Projektdateien des Fixture-Projekts nach `ziel` (Quelle: der Klon `von`). `io` = `{ lies, schreibe }`. */
export function baueFixture({ von, ziel, raum, io }) {
  for (const pfad of fixturePfade()) {
    const text = pfad === "AGENTS.md" ? "" : io.lies(join(von, quellPfadFuer(pfad)));
    if (text === null) throw new Error(`Projektdatei ${pfad} fehlt in der Quelle (${quellPfadFuer(pfad)})`);
    io.schreibe(join(ziel, pfad), projektdatei({ pfad, text, raum }));
  }
}

/** Führt die Schritte nacheinander aus (`io.fuehre(schritt)` → Exit oder `null`), bricht nach einem kritischen Rot ab. → `[{ id, status }]`. */
export function fuehreSchritte(schritte, io) {
  const ergebnisse = [];
  for (const s of schritte) {
    io.melde(`--- ${s.id}`);
    const status = s.art ? io[s.art](s) : io.fuehre(s);
    ergebnisse.push({ id: s.id, status });
    if (status !== 0 && s.kritisch) break;
  }
  return ergebnisse;
}

/** Hauptablauf mit Nähten `io`: → `{ code, out, err }`. */
export function main(argv, io) {
  const a = aufrufFehler(argv, io);
  if (a.text) return { code: AUFRUF_EXIT, out: "", err: `${a.text}\nAufruf: node scripts/probe-erstbezug.mjs --quelle <checkout> --scratch <leerer ordner> (geprüft wird der Commit HEAD der Quelle)\n` };
  const sha = io.kopf(a.quelle);
  if (!sha) return { code: AUFRUF_EXIT, out: "", err: `HEAD der Quelle ${a.quelle} nicht lesbar\n` };
  const ergebnisse = fuehreSchritte(probeSchritte({ quelle: a.quelle, scratch: a.scratch, tag: PROBE_TAG, sha }), io.mitScratch(a.scratch));
  const mess = messZeile(io.lies(join(a.scratch, "bezieher", "AGENTS.md")) ?? "");
  const urteil = probeUrteil(ergebnisse);
  return { code: urteil.code, out: `${[mess ?? "Messung nicht möglich (AGENTS.md des Fixture-Projekts fehlt oder ohne Marker)", ...urteil.zeilen].join("\n")}\n`, err: "" };
}

/** Echte Nähte: Dateisystem, `spawnSync` (Ausgabe der Schritte standardmäßig geerbt, `stdio` überschreibt es; ohne Zeitlimit, damit kein Prozessbaum zurückbleibt). */
export function echteNaehte(stdio = "inherit") {
  const lies = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const lauf = (argv, cwd) => spawnSync(argv[0], argv.slice(1), { cwd, env: kindUmgebung(process.env), stdio }).status;
  const io = {
    lies,
    istGitRepo: (p) => spawnSync("git", ["-C", p, "rev-parse", "--git-dir"], { stdio: "ignore" }).status === 0,
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
        fuehre: (s) => lauf(s.argv, s.cwd),
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
            baueFixture({ von: join(scratch, "quelle"), ziel: s.cwd, raum: PROJEKT_BLOCK_RAUM, io: { lies, schreibe: (p, t) => (mkdirSync(dirname(p), { recursive: true }), writeFileSync(p, t)) } });
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
