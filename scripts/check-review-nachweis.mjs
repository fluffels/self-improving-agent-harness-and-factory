// Kein Shebang — wie check-diffsize.mjs: wird per `node scripts/check-review-nachweis.mjs`
// gestartet (CI + lokal) UND von test/review-nachweis.test.ts importiert.
/**
 * Review- und Plan-Nachweis-Wächter (#1270) — macht Planungspass und Review-Konvergenz
 * pfadunabhängig prüfbar.
 *
 * Hintergrund: Review-Pflicht, Cap 2 Fix-Runden und der Planer sind im Skill-Pfad
 * Verhaltensregeln: ein PR ohne Review-Runde, mit Überschreitung der Obergrenze oder ohne
 * Planer fiel nirgends auf. Dieser Wächter verlangt im Slice (Commits `<basis>..HEAD`) zwei
 * Zeilen am Zeilenanfang einer Commit-Message, gleiches Muster wie der Diffsize-Override (Präfix `praefixe.commitZeile`, Planer
 * `agenten.planer` der Projekt-Config; kein Standardwert, ein fehlender Schlüssel ist rot):
 *
 *   <praefixe.commitZeile>Plan: <Planer>               |  <praefixe.commitZeile>Plan: ohne — <Begründung>
 *   <praefixe.commitZeile>Review: head=<sha> runden=<1..3> lenses=<Brillen des vollen Passes (Runde 1), kommagetrennt>
 *                 blocker=<brille>:<n>,… verdikt=ok   (blocker optional, #1123: Runde-1-Blocker je Brille)
 *   Optional `zusatzpass=<anzahl>:<ursache>` (#1561, #1693): bis zu drei Pässe über das Cap hinaus ohne Rückfrage (Ursache im PR, Review- und Abnahme-Zusatzpässe zählen gemeinsam); mehr ist rot, außer mit Review-Override samt Freigabe-Beleg (factory#162 L10); erhöht die Obergrenze.
 *   Optional `abnahmefix=1` (#1808): die eine Delta-Runde nach einem Abnahme-Fix, eigenes Budget neben dem Cap (Obergrenze + 1, nur bei überschrittenem Review-Cap).
 *
 * Geprüft wird Konsistenz und Existenz, nicht Wahrheit: der Nachweis ist Selbstauskunft.
 * Aus einer stillen Auslassung wird so eine bewusste Falschangabe; die unabhängige Prüfung
 * ist ein CI-Reviewer (#1117). `head` muss im Slice liegen, die Lens-Brillen müssen zur
 * Diff-Art passen (reiner Markdown-Diff → doku, sonst die drei Code-Brillen).
 *
 * Ein Merge von `main` NACH dem Review mit Konflikt-Auflösung ist ungeprüfter Code im PR: der Wächter holt jeden Merge in
 * `<head>..HEAD` und prüft ihn mit `git show --remerge-diff` (git ≥ 2.36). Zeigt der Merge eine Auflösung, ist der Check rot:
 * die Auflösung per Delta-Lens reviewen, dann einen neuen Nachweis setzen (head ≥ Merge). Konfliktfreie Merges (auch der synthetische
 * Merge-Commit des PR-Checkouts) bleiben grün. Ebenso rot ist jeder Nicht-Merge-Commit in `<head>..HEAD` (ohne die Commits der Basis) mit
 * Baumänderung (`git diff-tree`): Code nach dem Review ist ungeprüft, der letzte Fixer gibt nie das finale OK. Leere Commits (Nachweis,
 * Override-Zeilen) bleiben grün; ein Fix danach braucht Delta-Lens und neuen Nachweis mit head ≥ Fix. Ein git-Fehler ist rot.
 *
 * Druckventil: `<praefixe.commitZeile>Review-Override: #<nr> <warum>` (Pflicht-Begründung), z.B. für Revert-PRs.
 * Bewusst KEIN npm-`check:*`-Skript und nicht in `verify`: verify läuft vor dem Review, der
 * Nachweis entsteht erst danach (Vorbild: check-festgefahren.mjs). Lokal:
 *   node scripts/check-review-nachweis.mjs
 *
 * Größenstufe (factory#271): der Wächter berechnet sie aus dem Diff (`groessenstufe-lib.mjs`, nie vom Umsetzer behauptet). Nur bei `S` genügen
 * `<praefixe.commitZeile>Plan: <Planer> — skizze`, `Plan: ohne — klein: <Begründung>` und bei Code-Diff `lenses=kombiniert` statt der drei Code-Brillen;
 * bei `voll` sind diese Varianten rot, `klein` ohne Begründung immer. Die Risikoklasse hoch (Pfadmuster der Projekt-Config `risiko.hoch`, sonst Standardliste,
 * factory#333) ist nie `S`; die Doku-Regel (nur `*.md`) steht nur in `groessenstufe-lib.mjs` (`istDokuDiff`). Der Nachweis bleibt Pflicht, nur die Besetzung ist kleiner.
 * Bei Risikoklasse hoch verlangt `bewerteKlasseHoch` zusätzlich die Zeile `<praefixe.commitZeile>Bedrohungen:` (vier Teile, kein leerer) und die Brille `sicherheit` in `lenses` (factory#334); bei `normal` und `doku` entfällt beides.
 *
 * Mit `--config <pfad>` liest der Wächter eine andere Projekt-Config (Test, fremdes Projekt), sonst die des Repos.
 *
 * Hinweis (kein Fehler, Exit-Code gleich): die jüngste Commit-Zeile `Guard-Liste: <n> Anker` (Selbstcheck des Umsetzers) wird mit der Ankerzahl des Diffs
 * aus `scripts/anker-liste.mjs` verglichen; Abweichung oder fehlende Zeile bei vorhandenen Ankern gibt eine `::warning::`-Zeile (`guardListeWarnung`).
 * Grenzen: die jüngste Zeile muss die Gesamtzahl der Anker des Branches nennen, oder die Zeilen aller Commits (je Gruppe) ergeben summiert die Gesamtzahl (verglichen wird mit dem Gesamt-Diff gegen die Basis, nicht mit dem Anteil eines Commits); `anker-liste.mjs` kennt
 * kein `--config`, das Kind liest immer die Config des Repos, auch bei `--config` hier.
 *
 * Reines Node-Skript (nur Builtins, check-basis.mjs und anker-liste.mjs); die Bewertung ist pur exportiert.
 */

import { istDirektaufruf } from "./direktaufruf.mjs";
import { execFileSync } from "node:child_process";
import { resolveBase } from "./check-basis.mjs";
import { trenneConfigArg } from "./projekt-config-lib.mjs";
import { factorySeiteIn } from "./factory-seite.mjs";
import { fileURLToPath } from "node:url";
import { aktiverOverride, commitImSlice, ladeCommitZeilen, ladeCommitZeilenOderBeende, meldeUngueltigeOverrides, parseOverrideTrailers } from "./slice-override.mjs";
import { BEDROHUNGS_TEILE, BEKANNTE_LENSES, CODE_LENSES, KOMBI_LENS, MAX_FIX_RUNDEN, MAX_REVIEW_PAESSE, MAX_ZUSATZPAESSE, SICHERHEITS_LENS, kleinGrund, parseNachweis } from "./nachweis-lib.mjs";
import { groessenstufeAusGit, istDokuDiff, ladeRisikoMuster } from "./groessenstufe-lib.mjs";

// parseNachweis lebt im neutralen Modul nachweis-lib.mjs (auch das Messskript token-baseline.mjs liest die Zeilen);
// hier bleibt der Export für die Aufrufer und Tests dieses Gates.
export { parseNachweis };

// Die Cap-Konstanten leben in nachweis-lib.mjs (auch das Abnahme-Gate nennt sie); hier bleibt der Export für Aufrufer und Tests.
export { MAX_FIX_RUNDEN, MAX_REVIEW_PAESSE };

const WURZEL = fileURLToPath(new URL("..", import.meta.url));
// Die Brillen-Schlüssel leben in nachweis-lib.mjs (auch der Lens-Auftrag-Guard braucht sie, ohne dieses Gate zu importieren); hier bleibt der Export.
export { BEKANNTE_LENSES };

/** Die Vorlage, die bei Rot ausgegeben wird (SSOT des Formats: Factory-Seite docs/agent-harness.md §3a); Schlüssel und Planer aus `zeilen`. */
export const vorlage = (zeilen) =>
  `${zeilen.plan}: ${zeilen.planer}\n` +
  `${zeilen.review}: head=<sha-des-zuletzt-reviewten-Stands> runden=<1..${MAX_REVIEW_PAESSE}> ` +
  `lenses=architektur,requirement-treue,test-adaequanz ` +
  `blocker=architektur:<n>,requirement-treue:<n>,test-adaequanz:<n> verdikt=ok  ` +
  `(bei reinem Markdown-Diff: lenses=doku blocker=doku:<n>)\n` +
  `Nur bei Größenstufe S (node scripts/groessenstufe.mjs): ${zeilen.plan}: ${zeilen.planer} — skizze | ${zeilen.plan}: ohne — klein: <Begründung>; ` +
  `bei Code-Diff lenses=kombiniert blocker=kombiniert:<n>\n` +
  `Bei Risikoklasse hoch (Zeile RISIKO von node scripts/groessenstufe.mjs): lenses=…,sicherheit blocker=…,sicherheit:<n> und ` +
  `${zeilen.bedrohungen}: daten=… | grenzen=… | missbrauch=… | datenschutz=… (wörtlich aus dem Plan)`;

/** Welche Brillen Runde 1 mindestens abdecken muss: nur `*.md` → doku, sonst die drei
 *  Code-Brillen. Leere oder kaputte Dateiliste → voller Code-Satz (fail-closed). Gleiche
 *  Regel der Review-Staffel (Skill `review-lenses`, Wächter review-staffel.test.ts). */
export function pflichtLenses(dateien) {
  return istDokuDiff(dateien) ? ["doku"] : [...CODE_LENSES];
}

/** Prüft das optionale Feld `blocker=` (#1123): je Brille die Zahl der Runde-1-Blocker. Fehlt es, ist die
 *  Zeile gültig (alte Zeilen). Pure. */
function bewerteBlocker(review, zeilen) {
  const R = zeilen.review;
  const fehler = [];
  const eintraege = review.blocker;
  if (eintraege.length === 0) return [`${R}: blocker ist leer (erwartet: blocker=<brille>:<n>,… je Brille der Runde 1).`];
  const gesehen = new Set();
  for (const { lens, n } of eintraege) {
    if (!BEKANNTE_LENSES.includes(lens)) fehler.push(`${R}: blocker nennt unbekannte Brille "${lens}" (bekannt: ${BEKANNTE_LENSES.join(", ")}).`);
    if (!Number.isInteger(n) || n < 0) fehler.push(`${R}: blocker=${lens}:${n} ist keine ganze Zahl ≥ 0.`);
    if (gesehen.has(lens)) fehler.push(`${R}: blocker nennt die Brille ${lens} doppelt.`);
    gesehen.add(lens);
  }
  if (review.runden === 1) {
    const summe = eintraege.reduce((a, e) => a + (Number.isInteger(e.n) ? e.n : 0), 0);
    if (summe > 0) fehler.push(`${R}: Runde 1 meldete Blocker, aber es gab kein Fix-Pass (runden=1).`);
    const gleich = eintraege.length === review.lenses.length && review.lenses.every((l) => gesehen.has(l));
    if (!gleich) fehler.push(`${R}: runden=1, aber die Brillen von blocker (${[...gesehen].join(",")}) weichen von lenses (${review.lenses.join(",")}) ab.`);
  }
  return fehler;
}

/** Das Feld `zusatzpass=<anzahl>:<ursache>`: ungültig oder über `MAX_ZUSATZPAESSE` (Review- und Abnahme-Zusatzpässe zählen gemeinsam) ist rot;
 *  mehr als die Zahl gibt nur die Maintainerin frei (Review-Override samt Freigabe-Beleg). Pure. */
function bewerteZusatzpass(zp, zeilen) {
  const R = zeilen.review;
  if (zp && "ungueltig" in zp) {
    return [`${R}: zusatzpass=${zp.ungueltig} ungültig (erwartet: zusatzpass=<anzahl ≥ 1>:<Ursache>).`];
  }
  if (zp && zp.anzahl > MAX_ZUSATZPAESSE) {
    return [
      `${R}: zusatzpass=${zp.anzahl} überschreitet die Freigabe ohne Rückfrage (höchstens ${MAX_ZUSATZPAESSE}, Review- und Abnahme-Zusatzpässe zusammen). ` +
        `Mehr gibt nur die Maintainerin frei: ${zeilen.reviewOverride}: #<nr> <Freigabe-Beleg>.`,
    ];
  }
  return [];
}

/** Prüft `runden` gegen die Obergrenze samt optionalem `zusatzpass=<anzahl>:<ursache>` (#1561, #1693): bis zu drei Pässe über das Cap
 *  fährt der Umsetzer ohne Rückfrage, mehr gibt nur die Maintainerin frei; der Nachweis bleibt Selbstauskunft.
 *  Ohne Überschreitung ist ein Zusatzpass ein Fehler. Pure. */
function bewerteRunden(review, zeilen) {
  const R = zeilen.review;
  const zp = review.zusatzpass ?? null;
  const zpFehler = bewerteZusatzpass(zp, zeilen);
  if (zpFehler.length) return zpFehler;
  const af = review.abnahmefix ?? null;
  if (af && typeof af === "object") {
    return [`${R}: abnahmefix=${af.ungueltig} ungültig (erwartet: abnahmefix=1, die eine Delta-Runde nach einem Abnahme-Fix).`];
  }
  const reviewErlaubt = MAX_REVIEW_PAESSE + (zp ? zp.anzahl : 0);
  const erlaubt = reviewErlaubt + (af ? 1 : 0);
  if (review.runden > erlaubt) {
    return [
      `${R}: runden=${review.runden} überschreitet die Obergrenze (Cap ${MAX_FIX_RUNDEN} Fix-Runden = höchstens ${erlaubt} Pässe). ` +
        `Bis zu ${MAX_ZUSATZPAESSE} Zusatzpässe nach dem Cap fährt der Umsetzer ohne Rückfrage (mehr nur mit Freigabe): zusatzpass=<anzahl>:<Ursache> in die ${R}-Zeile; ` +
        `die eine Delta-Runde nach einem Abnahme-Fix steht als abnahmefix=1.`,
    ];
  }
  if (zp && review.runden <= MAX_REVIEW_PAESSE) {
    return [`${R}: zusatzpass ist nur bei runden > ${MAX_REVIEW_PAESSE} zulässig (runden=${review.runden}).`];
  }
  if (af && review.runden <= reviewErlaubt) {
    return [`${R}: abnahmefix ist nur bei runden > ${reviewErlaubt} zulässig (das Review-Cap ist nicht überschritten, runden=${review.runden}).`];
  }
  return [];
}

/** Plan-Zeile gegen die Größenstufe (factory#271): `skizze` und `ohne — klein: <Begründung>` nur bei `S`, `klein` ohne Begründung nie; jeder andere Grund bleibt wie bisher. Pure. */
function bewertePlan(plan, stufe, zeilen) {
  const P = zeilen.plan;
  if (!plan) return [`${P}-Zeile fehlt (Planungspass nicht nachgewiesen).`];
  if (plan.art === "ungueltig") {
    return [`${P} ungültig: "${plan.zeile}" (erlaubt: "${zeilen.planer}", "${zeilen.planer} — skizze" oder "ohne — <Begründung>").`];
  }
  const klein = plan.art === "ohne" ? kleinGrund(plan.grund) : null;
  if (klein?.art === "klein-ohne-begruendung") return [`${P}: "ohne — klein" braucht eine Begründung ("ohne — klein: <Begründung>").`];
  const art = plan.art === "skizze" ? "skizze" : klein ? "ohne — klein" : null;
  return art !== null && stufe !== "S" ? [`${P}: "${art}" gilt nur bei Größenstufe S (berechnet aus dem Diff: ${stufe}); hier ist der volle Planer-Lauf nötig.`] : [];
}

/** Lens-Satz der Runde 1 gegen die Diff-Art und die Größenstufe: die Pflicht-Brillen oder der volle Code-Satz; bei `S` und Code-Diff genügt `kombiniert` (factory#271). Pure. */
function bewerteLensSatz(review, dateien, stufe, zeilen) {
  const R = zeilen.review;
  const pflicht = pflichtLenses(dateien);
  const fehlend = pflicht.filter((l) => !review.lenses.includes(l));
  const codeVoll = CODE_LENSES.every((l) => review.lenses.includes(l));
  const kombi = review.lenses.includes(KOMBI_LENS);
  if (fehlend.length === 0 || codeVoll || (kombi && stufe === "S" && pflicht.length > 1)) return [];
  const kombiHinweis = kombi ? ` ${KOMBI_LENS} genügt nur bei Größenstufe S mit Code-Diff (berechnet aus dem Diff: ${stufe}).` : "";
  return [
    `${R}: lenses fehlt ${fehlend.join(", ")} (Pflicht für diese Diff-Art: ${pflicht.join(", ")}).${kombiHinweis} ` +
      `Erwartet: lenses=${pflicht.join(",")} (kleingeschrieben, ASCII, ae/oe/ue statt Umlaute).`,
  ];
}

/** Ein Teil der Bedrohungs-Zeile gilt als leer: leer oder nur ein Platzhalter (der Parser hat den Wert getrimmt) (`…`, `...`, `-`, `<…>`). */
const istLeer = (wert) => wert === undefined || /^(?:…|\.{3}|-|<[^>]*>)?$/.test(wert);

/** Fehler der Bedrohungs-Zeile (Klasse hoch): fehlende Zeile, leere, fehlende, doppelte, unbekannte oder schlüssellose Teile. Pur. */
function bedrohungsFehler(b, zeilen, hinweis) {
  const B = zeilen.bedrohungen;
  if (!b) return [`${B}-Zeile fehlt (${hinweis}): ${B}: ${BEDROHUNGS_TEILE.map((t) => `${t}=…`).join(" | ")}.`];
  const fehler = BEDROHUNGS_TEILE.filter((t) => istLeer(b.teile[t])).map((t) => `${B}: Teil ${t} fehlt oder ist leer (${hinweis}).`);
  if (b.unbekannt.length > 0) fehler.push(`${B}: unbekannte Teile ${b.unbekannt.join(", ")} (erlaubt: ${BEDROHUNGS_TEILE.join(", ")}).`);
  if (b.doppelt.length > 0) fehler.push(`${B}: Teile doppelt: ${b.doppelt.join(", ")}.`);
  if (b.ohneSchluessel.length > 0) fehler.push(`${B}: Teil ohne \`=\` (erwartet <teil>=<wert>): ${b.ohneSchluessel.join(" | ")}.`);
  return fehler;
}

/** Risikoklasse hoch (factory#334): die einzige Stelle der Prüfregel. Verlangt die Bedrohungs-Zeile (vier nicht leere Teile) und, sobald eine Review-Zeile da ist,
 *  die Brille `sicherheit` in `lenses`. Bei `normal` und `doku` weder verlangt noch bewertet. Pur. */
export function bewerteKlasseHoch(nachweis, risiko, zeilen) {
  if ((risiko?.klasse ?? "hoch") !== "hoch") return []; // ohne Angabe fail-closed hoch
  const hinweis = `Risikoklasse hoch: ${risiko?.gruende?.[0] ?? "Risikoklasse nicht übergeben (fail-closed)"}; Abschnitt beim ${zeilen.planer} holen, nie selbst schreiben; Skill review-lenses › ablauf-klasse-hoch.md`;
  const fehler = bedrohungsFehler(nachweis.bedrohungen, zeilen, hinweis);
  if (nachweis.review && !nachweis.review.lenses.includes(SICHERHEITS_LENS)) {
    fehler.push(`${zeilen.review}: lenses fehlt ${SICHERHEITS_LENS} (${hinweis}).`);
  }
  return fehler;
}

/** Bewertet einen geparsten Nachweis. `headBekannt`: der SHA lässt sich als Commit auflösen;
 *  `headImSlice`: er liegt in `<basis>..HEAD`. Liefert alle Fehler (leer = ok). Pure. */
export function bewerteNachweis({ nachweis, dateien, headBekannt, headImSlice, konfliktMerges = [], aenderungsCommits = [], zeilen, stufe = "voll", risiko }) {
  if (!zeilen) throw new Error("bewerteNachweis braucht die Commit-Zeilen (commitZeilen), keinen Standardwert");
  const R = zeilen.review;
  const fehler = [];
  for (const { sha, dateien: geaendert } of aenderungsCommits) {
    const namen = geaendert.slice(0, 5).join(", ") + (geaendert.length > 5 ? ", …" : "");
    const kopf = nachweis.review?.head ? nachweis.review.head : "<head>";
    fehler.push(
      `Commit ${sha} nach dem Review ändert ${namen}: Delta-Lens der betroffenen Brillen auf ${kopf}..HEAD, dann neuer Nachweis (head ≥ ${sha}). ` +
        `Schritte: Skill review-lenses › Nachweis nach Konvergenz.`,
    );
  }
  for (const sha of konfliktMerges) {
    fehler.push(
      `Konflikt-Merge ${sha} nach dem Review: Auflösung per Delta-Lens prüfen, dann neuer Nachweis (head ≥ ${sha}). ` +
        `Besser: main VOR Runde 1 oder erst nach dem Nachweis einmergen, wenn der Merge konfliktfrei ist. ` +
        `Schritte: Skill review-lenses › Nach jedem Merge von main.`,
    );
  }
  const { plan, review } = nachweis;
  fehler.push(...bewertePlan(plan, stufe, zeilen), ...bewerteKlasseHoch(nachweis, risiko, zeilen));
  if (!review) {
    fehler.push(`${R}-Zeile fehlt (Review-Konvergenz nicht nachgewiesen).`);
    return fehler;
  }
  if (review.head === null) fehler.push(`${R}: head fehlt oder ist kein SHA.`);
  else if (!headBekannt) fehler.push(`${R}: head=${review.head} ist kein bekannter Commit.`);
  else if (!headImSlice) {
    fehler.push(`${R}: head=${review.head} liegt nicht im Slice dieses PRs (Rebase/Amend nach dem Review?).`);
  }
  if (!Number.isInteger(review.runden) || review.runden < 1) {
    fehler.push(`${R}: runden fehlt oder ist keine Zahl ≥ 1.`);
  } else {
    fehler.push(...bewerteRunden(review, zeilen));
  }
  fehler.push(...bewerteLensSatz(review, dateien, stufe, zeilen));
  const unbekannt = review.lenses.filter((l) => !BEKANNTE_LENSES.includes(l));
  if (unbekannt.length > 0) {
    fehler.push(`${R}: lenses enthält unbekannte Brille(n) ${unbekannt.join(", ")} (bekannt: ${BEKANNTE_LENSES.join(", ")}).`);
  }
  if (review.blocker !== null) fehler.push(...bewerteBlocker(review, zeilen));
  if (review.verdikt !== "ok") fehler.push(`${R}: verdikt=${review.verdikt ?? "(fehlt)"} ist nicht ok.`);
  return fehler;
}

/**
 * Pur: Warnung, wenn weder die jüngste Zeile `Guard-Liste: <n> Anker` (am Zeilenanfang einer Commit-Message, der Selbstcheck des Umsetzers) noch die
 * Summe aller solcher Zeilen (Commits je Gruppe) zur Ankerzahl `ist` des Diffs passt (`scripts/anker-liste.mjs`); ohne Zeile nur, wenn der Diff Anker hat. Sonst `null`. Nie ein Fehler (Exit-Code gleich).
 */
export function guardListeWarnung({ messages, ist }) {
  const treffer = [...String(messages).replace(/\r/g, "").matchAll(/^Guard-Liste: (\d+) Anker\b/gm)];
  if (treffer.length === 0) return ist > 0 ? `::warning::Guard-Liste: keine Zeile \`Guard-Liste: <n> Anker\` in den Commits, der Diff hat ${ist} Anker (node scripts/anker-liste.mjs)` : null;
  const genannt = Number(treffer[treffer.length - 1][1]);
  const summe = treffer.reduce((s, t) => s + Number(t[1]), 0);
  return genannt === ist || summe === ist ? null : `::warning::Guard-Liste nennt ${genannt} Anker, der Diff hat ${ist} Anker (node scripts/anker-liste.mjs)`;
}

/** Die Warnung zu `messages` mit der Ankerzahl aus `ankerZahl()`; ohne `ankerZahl` (der Aufruf wirft) oder bei einem Fehler dort `null` (eine Warnung bricht nie ab). */
function guardWarnungOderNull(messages, ankerZahl) {
  try {
    return guardListeWarnung({ messages, ist: ankerZahl() });
  } catch {
    return null;
  }
}

/** Führt die Prüfung gegen git aus. `runGit`/`env`/`ladeZeilen` injizierbar (Test; `ladeZeilen` liest standardmäßig die echte Projekt-Config).
 *  Fail-closed: ein Ladefehler der Config, eine nicht auflösbare Basis oder ein git-Fehler ist rot. Basis == HEAD ist grün (nichts zu prüfen). */
export function checkReviewNachweis({ runGit, env = process.env, ladeZeilen = ladeCommitZeilen, ladeRisiko, ankerZahl } = {}) {
  let zeilen;
  try {
    zeilen = ladeZeilen();
  } catch (e) {
    return { ok: false, fehler: [e instanceof Error ? e.message : String(e)] };
  }
  const git = runGit ?? ((args) => execFileSync("git", args, { encoding: "utf8" }));
  const base = resolveBase(git, env);
  if (!base) return { ok: false, fehler: ["Keine Vergleichs-Basis auflösbar (flacher Checkout?) — Nachweis nicht prüfbar."] };
  try {
    const head = git(["rev-parse", "HEAD"]).trim();
    if (head === base) return { ok: true, skipped: true, fehler: [] };
    // `--reverse`: chronologisch, damit der JÜNGSTE Nachweis (`lastLine`) und die jüngste Override-Zeile gelten (Z8a).
    const messages = git(["log", "--reverse", "--format=%B", `${base}..HEAD`]);
    const ov = parseOverrideTrailers(messages, zeilen.reviewOverride);
    // Die jüngste gültige Zeile entscheidet; ein Widerruf (`#<nr> entfällt`) ist kein Override (wie bei den übrigen Gates).
    const grund = aktiverOverride(messages, zeilen.reviewOverride);
    if (grund !== null) {
      return { ok: true, override: grund, fehler: [], invalid: ov.invalid };
    }
    const nachweis = parseNachweis(messages, zeilen);
    const dateien = git(["diff", "--name-only", `${base}...HEAD`])
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "");
    let hd = { bekannt: false, imSlice: false, konfliktMerges: [], aenderungsCommits: [] };
    let commitsNachReview = null;
    if (nachweis.review?.head) {
      hd = commitImSlice(git, base, nachweis.review.head);
      if (hd.imSlice) commitsNachReview = Number(git(["rev-list", "--count", "--no-merges", `${hd.sha}..HEAD`]).trim());
    }
    const groesse = groessenstufeAusGit(git, base, "HEAD", { ladeRisiko });
    const fehler = bewerteNachweis({
      nachweis,
      dateien,
      headBekannt: hd.bekannt,
      headImSlice: hd.imSlice,
      konfliktMerges: hd.konfliktMerges,
      aenderungsCommits: hd.aenderungsCommits,
      zeilen,
      stufe: groesse.stufe,
      risiko: groesse.risiko,
    });
    return {
      ok: fehler.length === 0,
      fehler,
      invalid: ov.invalid,
      commitsNachReview,
      blockerFehlt: nachweis.review?.blocker === null,
      guardWarnung: guardWarnungOderNull(messages, ankerZahl),
      zusatzpass: nachweis.review?.zusatzpass && "grund" in nachweis.review.zusatzpass ? nachweis.review.zusatzpass : null,
    };
  } catch (e) {
    return { ok: false, fehler: [`git-Fehler beim Prüfen des Nachweises: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

/** CLI-Zeile zum Zusatzpass; `null` ohne gültigen Zusatzpass. Pur. */
export const zusatzpassZeile = (r) => (r.zusatzpass ? `• Zusatzpass: ${r.zusatzpass.grund}` : null);

/** Die Ankerzahl des Diffs gegen die Basis: das Einstiegsskript `anker-liste.mjs --json` als Kindprozess (kein Import eines Einstiegsskripts); wirft bei Fehler. */
function ankerZahlImDiff() {
  const skript = fileURLToPath(new URL("./anker-liste.mjs", import.meta.url));
  const liste = JSON.parse(execFileSync(process.execPath, [skript, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  return liste.reduce((summe, e) => summe + e.anker.length, 0);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function main(argv = process.argv.slice(2)) {
  const getrennt = trenneConfigArg(argv);
  if (getrennt.fehler) {
    console.error(getrennt.fehler);
    process.exit(1);
  }
  // Die Config wird vor jedem git-Aufruf geladen: ein Ladefehler endet mit Exit 1 und der Meldung des Laders (Pfad, Schlüssel, Fix:).
  const zeilen = ladeCommitZeilenOderBeende({ laden: () => ladeCommitZeilen({ pfad: getrennt.pfad }) });
  const r = checkReviewNachweis({ ladeZeilen: () => zeilen, ladeRisiko: () => ladeRisikoMuster({ pfad: getrennt.pfad }), ankerZahl: ankerZahlImDiff });
  if (r.skipped) {
    console.log("• check-review-nachweis: Basis == HEAD, nichts zu prüfen.");
    return;
  }
  if (r.override) {
    console.log(`• geduldet: ${zeilen.reviewOverride} — ${r.override}`);
    console.log("✔ Review-/Plan-Nachweis ok (Override mit Begründung).");
    return;
  }
  meldeUngueltigeOverrides(r.invalid);
  if (r.ok) {
    if (typeof r.commitsNachReview === "number") {
      console.log(`• ${r.commitsNachReview} Commit(s) nach dem reviewten Stand (inkl. Nachweis-Commit).`);
    }
    if (r.guardWarnung) console.log(r.guardWarnung);
    if (r.blockerFehlt) console.log("• Hinweis: blocker= fehlt (Messung #1123).");
    const zusatz = zusatzpassZeile(r);
    if (zusatz) console.log(zusatz);
    console.log("✔ Review-/Plan-Nachweis ok.");
    return;
  }
  console.error("✖ Review-/Plan-Nachweis fehlt oder ist ungültig (#1270):");
  for (const f of r.fehler) console.error(`  - ${f}`);
  console.error(
    `\nNach Konvergenz des Reviews einen leeren Nachweis-Commit setzen (Format: ${factorySeiteIn(WURZEL, "docs/agent-harness.md", "3a-langfassung-der-harten-regeln-ausgelagert-aus-agentsmd")}), ` +
      `beide Zeilen in einer Commit-Message:\nVorlage:\n${vorlage(zeilen).replace(/^/gm, "  ")}\n` +
      `Bewusste Ausnahme (z.B. Revert-PR) mit Pflicht-Begründung: ${zeilen.reviewOverride}: #<nr> <warum>`,
  );
  process.exit(1);
}

if (istDirektaufruf(import.meta.url)) main();
