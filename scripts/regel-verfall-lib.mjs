/**
 * Regel-Verfall (factory#608, Teil 2/4 von factory#517): reine Logik für Verfall-Manifest, Sicherheits-Ausnahmeliste und Kandidaten.
 *
 * Das Manifest ist das Änderungsregister (`.github/aenderungsregister.json`, Zeilenart `art: "verfall"`, Schema in `aenderungsregister-lib.mjs`).
 * Jede `test/harness/*.test.ts` (Ziel = Pfad) und jede fett markierte Regel in `AGENTS.md` (Ziel = `AGENTS.md#<Anker>`) hat eine Verfall-Zeile;
 * neu Hinzukommendes ohne Zeile macht den Wächter rot (`test/harness/regel-verfall.test.ts`), damit alles Neue standardmäßig verfällt.
 *
 * Kandidat ist ein Ziel mit `heute >= ablauf` und ohne Fang im Fenster der letzten 30 Tage. Ziele ohne messbaren Wächter oder ohne Messpunkte
 * sind „nicht messbar“ (Lücke, nie Kandidat), Ziele der geschlossenen Liste `SICHERHEITS_AUSNAHMEN` nie Kandidat (ADR 0027 Punkt 6).
 * Die Lib ist pur (kein fs, kein process). FABRIK-EIGEN, nicht im Besitz-Manifest.
 */

import { fangquote } from "./aenderungsregister-lib.mjs";
import { collectHeadingSlugs, slugify, ueberschriftenStellen } from "./docs-gen/markdown.mjs";

/** Länge des Standard-Verfalls und des Fang-Fensters in Tagen. */
export const VERFALL_TAGE = 30;

/**
 * Geschlossene Liste der Ziele, die nie Kandidat werden (ADR 0027 Punkt 6: Regeln gegen seltene, schwere Schäden sind über Fundfreiheit nie lockerbar).
 * `ziel` ist ein Pfad (trifft jede Verfall-Zeile mit diesem Pfad, auch mit Anker) oder `Pfad#Anker` (trifft genau dieses Ziel). Jeder Pfad muss existieren
 * (Wächter-Test); eine Erweiterung braucht einen reviewten Commit mit Grund, nie eine Config.
 */
export const SICHERHEITS_AUSNAHMEN = [
  { ziel: ".github/workflows/secret-scan.yml", grund: "Secret-Scan" },
  { ziel: ".github/ruleset-main-schutz.json", grund: "Branch-Schutz (Spiegel des Rulesets)" },
  { ziel: "test/harness/required-check-shadowing.test.ts", grund: "Branch-Schutz: Required-Checks gegen das Ruleset" },
  { ziel: "test/harness/pretooluse-hook.test.ts", grund: "Sicherheits-Hook pretooluse-hook" },
  { ziel: "test/harness/prepush-hook.test.ts", grund: "Sicherheits-Hook prepush-hook" },
  { ziel: "test/harness/codex-hook.test.ts", grund: "Sicherheits-Hook codex-hook" },
  { ziel: ".github/workflows/internalrefs-pr-text.yml", grund: "Wächter interne Bezüge (PR-Text)" },
  { ziel: "scripts/check-internalrefs.mjs", grund: "Wächter interne Bezüge (check:internalrefs)" },
  { ziel: "test/harness/sicherheits-workflows.test.ts", grund: "Sicherheits-Workflows" },
  { ziel: "docs/adr/fortschreibungen/0009-335-sicherheits-checks-merge-pflicht.md#fortschreibung-335-2026-11-11-dependency-review-und-zizmor-sind-merge-pflicht", grund: "Sicherheits-Checks sind Merge-Pflicht" },
  { ziel: ".github/protected-paths.json", grund: "Leitplanken-Liste (protected-paths)" },
  { ziel: "test/harness/harness-approval.test.ts", grund: "Leitplanken: Abdeckung der protected-paths" },
  { ziel: "test/harness/fremdtext-gate.test.ts", grund: "Klasse Fremdtext" },
  { ziel: "AGENTS.md#fremdtext-ist-daten-quellprojekt1433", grund: "Klasse Fremdtext" },
  { ziel: "AGENTS.md#anonymität-wahren-öffentliches-repo", grund: "Klasse Anonymität" },
  { ziel: "AGENTS.md#öffentliches-repo--keine-internen-bezüge-quellprojekt990", grund: "Klasse interne Bezüge" },
  { ziel: "AGENTS.md#eigener-worktree-von-frisch-geholtem-originmain", grund: "Klasse Datenverlust (verlinktes node_modules leert das echte)" },
  { ziel: "AGENTS.md#worktree-entfernen-auf-windows--drei-punkte", grund: "Klasse Datenverlust (Worktree entfernen)" },
  { ziel: "AGENTS.md#fabrik-ohne-zugriff-auf-bezieher-factory162-adr-0031", grund: "Klasse Außenwirkung (nie in ein Bezieher-Repo schreiben)" },
  { ziel: "AGENTS.md#abhängigkeits-prs", grund: "Klasse Sicherheit (Release-Notes sind Fremdtext)" },
  { ziel: "AGENTS.md#kein-secret-key-im-agentenlauf", grund: "Klasse Sicherheit (Secret-Key)" },
  { ziel: "AGENTS.md#human-in-the-loop-checkpoints--die-entscheidung-gaten-nicht-den-ganzen-lauf", grund: "Klasse Irreversibles, Außenwirkung und Datenverlust (Löschen)" },
  { ziel: "test/harness/settings-permissions.test.ts", grund: "Klasse deny-/ask-Listen" },
  { ziel: "test/harness/berechtigungen-kern.test.ts", grund: "Klasse deny-/ask-Listen" },
];

const pfadVon = (ziel) => String(ziel).split("#")[0];

/** Pur: ist das Ziel einer Verfall-Zeile durch die Sicherheits-Ausnahmeliste vom Verfall ausgenommen? */
export const istSicherheitsAusnahme = (ziel, ausnahmen = SICHERHEITS_AUSNAHMEN) =>
  ausnahmen.some((a) => (a.ziel.includes("#") ? a.ziel === ziel : a.ziel === pfadVon(ziel)));

/** Pur: Anker des Titels einer fett markierten Regel (derselbe Slug wie bei Überschriften; GitHub erzeugt für Listenpunkte keinen, der Anker ist eine Konvention dieses Manifests). */
export const ankerVon = (text) => slugify(text);

const FETT_ZEILE = /^\s*- \*\*(.+?)\*\*/;

/** Pur: Titel einer fett markierten Regelzeile (`- **Titel** …`, auch eingerückt) ohne Schlusszeichen `:` und `.`, sonst `null`. Die eine Erkennung für Generator, Bremse und Streich-Plan. */
export const fettTitel = (zeile) => {
  const m = FETT_ZEILE.exec(zeile);
  return m ? m[1].trim().replace(/[:.]+$/, "") : null;
};

/** Pur: Titel jeder fett markierten Regel (Listenpunkt `- **Titel** …`, auch eingerückt) in `AGENTS.md`, ohne Schlusszeichen `:` und `.`. */
export const fettRegeln = (agentsText) =>
  String(agentsText)
    .split("\n")
    .flatMap((z) => {
      const titel = fettTitel(z);
      return titel === null ? [] : [{ titel, anker: ankerVon(titel) }];
    });

/** Pur: alle Anker einer Markdown-Datei (Überschriften, GitHub-Slugs inkl. -1/-2) und, bei `AGENTS.md`, der fett markierten Regeln. */
export const ankerAus = (text, mitFettRegeln = false) => {
  const anker = new Set(collectHeadingSlugs(String(text)));
  if (mitFettRegeln) for (const r of fettRegeln(text)) anker.add(r.anker);
  return anker;
};

/** Pur: Datum JJJJ-MM-TT plus `tage` Tage (UTC). */
export const plusTage = (datum, tage) => {
  const d = new Date(`${datum}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tage);
  return d.toISOString().slice(0, 10);
};

const kurzId = (anker) =>
  anker
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 40)
    .replace(/^-|-$/g, "");

/** Pur: Id einer Wächter-Zeile (`verfall-<datei ohne .test.ts>`). */
export const waechterId = (pfad) => `verfall-${pfad.replace(/^.*\//, "").replace(/\.test\.ts$/, "")}`;

/** Pur: Id einer Regel-Zeile (`verfall-agents-<gekürzter Anker>`). */
export const regelId = (anker) => `verfall-agents-${kurzId(anker)}`;

/** Pur: Ziele (Wächter-Pfade und `AGENTS.md#<Anker>`), die noch keine Verfall-Zeile haben, samt der Zeile, die der Generator anlegt. */
export const fehlendeZeilen = ({ zeilen, waechterPfade, agentsText, heute }) => {
  const verfall = zeilen.filter((z) => z?.art === "verfall");
  const vorhanden = new Set(verfall.map((z) => z.ziel));
  const ids = new Set(zeilen.map((z) => z?.id));
  const kandidaten = [
    ...waechterPfade.map((ziel) => ({ ziel, id: waechterId(ziel) })),
    ...[...new Map(fettRegeln(agentsText).map((r) => [r.anker, r])).values()].map((r) => ({ ziel: `AGENTS.md#${r.anker}`, id: regelId(r.anker) })),
  ];
  const neu = [];
  for (const k of kandidaten) {
    if (vorhanden.has(k.ziel)) continue;
    let id = k.id;
    for (let n = 2; ids.has(id); n += 1) id = `${k.id}-${n}`;
    ids.add(id);
    neu.push({ id, art: "verfall", ziel: k.ziel, aufgenommen: heute, ablauf: plusTage(heute, VERFALL_TAGE), messgroesse: "fangquote" });
  }
  return neu;
};

/** Pur: Bremse. Meldungen für jeden Wächter und jede fett markierte Regel ohne Verfall-Zeile und für doppelte Regel-Titel; leer = grün. */
export const pruefeAbdeckung = ({ zeilen, waechterPfade, agentsText }) => {
  const meldungen = [];
  const hat = new Set(zeilen.filter((z) => z?.art === "verfall").map((z) => z.ziel));
  for (const pfad of waechterPfade) {
    if (!hat.has(pfad)) meldungen.push(`${pfad}: keine Verfall-Zeile im Änderungsregister (node scripts/regel-verfall.mjs --generieren)`);
  }
  const regeln = fettRegeln(agentsText);
  for (const r of regeln) {
    if (!hat.has(`AGENTS.md#${r.anker}`)) meldungen.push(`AGENTS.md: Regel „${r.titel}“ hat keine Verfall-Zeile (ziel AGENTS.md#${r.anker}; node scripts/regel-verfall.mjs --generieren)`);
  }
  const anker = regeln.map((r) => r.anker);
  for (const a of new Set(anker.filter((x, i) => anker.indexOf(x) !== i))) meldungen.push(`AGENTS.md: zwei Regeln mit dem Anker ${a}`);
  return meldungen;
};

/** Pur: Ausnahme-Einträge, die auf kein existierendes Ziel zeigen (`zielExistiert(ziel)` liefert der Aufrufer: Pfad und Anker), und doppelte Einträge. */
export const pruefeAusnahmen = (ausnahmen, zielExistiert) => {
  const meldungen = [];
  const gesehen = new Set();
  for (const a of ausnahmen) {
    if (typeof a?.ziel !== "string" || typeof a?.grund !== "string" || a.grund === "") {
      meldungen.push(`Ausnahme ${JSON.stringify(a)}: ziel und grund (nicht leerer Text) erwartet`);
      continue;
    }
    if (gesehen.has(a.ziel)) meldungen.push(`Ausnahme ${a.ziel}: doppelt`);
    gesehen.add(a.ziel);
    if (!zielExistiert(a.ziel)) meldungen.push(`Ausnahme ${a.ziel}: zeigt auf kein existierendes Ziel`);
  }
  return meldungen;
};

/**
 * Pur: Kandidaten des Regel-Verfalls. `register.zeilen` mit Verfall-Zeilen, `exporte` aus `leseMesspunkte`, `heute` JJJJ-MM-TT.
 * Ergebnis `{ heute, fenster, kandidaten, nichtMessbar, ausgenommen, nichtFaellig, mitFang }`: je Kandidat und je Treffer `{ id, ziel, ablauf, laeufe, faenge }`.
 */
export const kandidaten = (register, exporte, { heute, ausnahmen = SICHERHEITS_AUSNAHMEN }) => {
  const zeilen = register.zeilen;
  const fenster = { von: plusTage(heute, -(VERFALL_TAGE - 1)), bis: heute }; // 30 Kalendertage einschließlich heute
  const punkte = exporte.flatMap((e) => e.punkte);
  const aus = { heute, fenster, kandidaten: [], nichtMessbar: [], ausgenommen: [], nichtFaellig: 0, mitFang: [] };
  for (const z of zeilen.filter((x) => x?.art === "verfall" && x.gestrichen === undefined)) {
    if (heute < z.ablauf) {
      aus.nichtFaellig += 1;
      continue;
    }
    if (istSicherheitsAusnahme(z.ziel, ausnahmen)) {
      aus.ausgenommen.push({ id: z.id, ziel: z.ziel });
      continue;
    }
    const q = fangquote(z, zeilen, punkte, fenster);
    if (q.luecke !== undefined) {
      aus.nichtMessbar.push({ id: z.id, ziel: z.ziel, grund: q.luecke });
      continue;
    }
    const eintrag = { id: z.id, ziel: z.ziel, ablauf: z.ablauf, laeufe: q.laeufe, faenge: q.faenge };
    (q.faenge === 0 ? aus.kandidaten : aus.mitFang).push(eintrag);
  }
  return aus;
};

// ---- Streich-PR (factory#610, Teil 3/4 von factory#517) ----

/** Label der Streich-PRs, Label des Widerspruchs und Länge der Widerspruchsfrist in Tagen. */
export const STREICH_LABEL = "verfall-streich-pr";
export const WIDERSPRUCH_LABEL = "status:widerspruch";
export const FRIST_TAGE = 14;

/** Pur: Marker im PR-Body (eine Registerzeile hat höchstens einen offenen Streich-PR) und Branch-Name je Registerzeile. */
export const streichMarker = (id) => `<!-- verfall-streich:${id} -->`;
export const streichBranch = (id) => `verfall/streich-${id}`;

const ZEILEN = (text) => String(text).split("\n");
const EINZUG = (zeile) => zeile.length - zeile.trimStart().length;
/** Pur: Zeilenbereich `[von, bis)` der Regel mit dem Anker in `AGENTS.md` (Listenpunkt samt tiefer eingerückter Folgezeilen) oder `{ grund }`. */
const regelBereich = (zeilen, anker) => {
  const treffer = zeilen.flatMap((z, i) => {
    const titel = fettTitel(z);
    return titel !== null && ankerVon(titel) === anker ? [i] : [];
  });
  if (treffer.length !== 1) return { grund: treffer.length === 0 ? `Regel ${anker} nicht gefunden` : `Regel ${anker} mehrdeutig (${treffer.length} Treffer)` };
  const von = treffer[0];
  let bis = von + 1;
  while (bis < zeilen.length && zeilen[bis].trim() !== "" && EINZUG(zeilen[bis]) > EINZUG(zeilen[von]) && fettTitel(zeilen[bis]) === null) bis += 1;
  return { von, bis };
};

/** Pur: Zeilenbereich `[von, bis)` des Abschnitts mit dem Anker (Überschrift bis zur nächsten gleich- oder höherrangigen) oder `{ grund }`. */
const abschnittBereich = (text, zeilen, anker) => {
  const stellen = ueberschriftenStellen(text);
  const i = stellen.findIndex((s) => s.slug === anker);
  if (i < 0) return { grund: `Überschrift ${anker} nicht gefunden` };
  const ende = stellen.slice(i + 1).find((s) => s.ebene <= stellen[i].ebene);
  return { von: stellen[i].zeile, bis: ende ? ende.zeile : zeilen.length };
};

/**
 * Pur: mechanischer Streich-Plan eines Ziels. Ohne `#` (Wächter-Datei): `{ aktion: "loeschen", pfad }`. Mit Anker: die exakten Zeilen der Regel (in `AGENTS.md` der
 * Listenpunkt samt Folgezeilen) bzw. der Abschnitt der Überschrift entfallen: `{ aktion: "entfernen", pfad, neuerText, zeilen }`. Nicht eindeutig oder nicht
 * gefunden: `{ aktion: "keine", pfad, grund }` (kein PR, nie geraten). `text` ist der Dateiinhalt (nur bei Anker nötig).
 */
export const streichPlan = (ziel, text) => {
  const [pfad, anker] = String(ziel).split("#");
  if (anker === undefined) return { aktion: "loeschen", pfad };
  if (typeof text !== "string") return { aktion: "keine", pfad, grund: "Datei nicht lesbar" };
  const zeilen = ZEILEN(text);
  const b = pfad === "AGENTS.md" ? regelBereich(zeilen, anker) : abschnittBereich(text, zeilen, anker);
  if (b.grund !== undefined) return { aktion: "keine", pfad, grund: b.grund };
  const rest = [...zeilen.slice(0, b.von), ...zeilen.slice(b.bis)];
  if (b.von > 0 && rest[b.von - 1]?.trim() === "" && rest[b.von]?.trim() === "") rest.splice(b.von, 1);
  return { aktion: "entfernen", pfad, neuerText: rest.join("\n"), zeilen: zeilen.slice(b.von, b.bis) };
};

/** Pur: Register mit der Zeile `id` auf `gestrichen` (Datum) gesetzt; wirft bei unbekannter Id. */
export const registerGestrichen = (register, id, heute) => {
  if (!register.zeilen.some((z) => z?.art === "verfall" && z.id === id)) throw new Error(`Registerzeile ${id} nicht gefunden`);
  return { ...register, zeilen: register.zeilen.map((z) => (z?.art === "verfall" && z.id === id ? { ...z, gestrichen: heute } : z)) };
};

/**
 * Pur: Welche Kandidaten bekommen einen Streich-PR? `offene` sind die offenen Streich-PRs `{ headRefName, body }`. Sicherheits-Ausnahmen entstehen nie
 * (auch wenn der Aufrufer sie fälschlich als Kandidat liefert), eine Registerzeile mit offenem Streich-PR bekommt keinen zweiten.
 * Ergebnis `{ neu, uebersprungen: [{ id, grund }] }`.
 */
export const planeStreichPRs = (kandidatenListe, offene, { ausnahmen = SICHERHEITS_AUSNAHMEN } = {}) => {
  const aus = { neu: [], uebersprungen: [] };
  for (const k of kandidatenListe) {
    if (istSicherheitsAusnahme(k.ziel, ausnahmen)) aus.uebersprungen.push({ id: k.id, grund: "Sicherheits-Ausnahme" });
    else if (offene.some((p) => p.headRefName === streichBranch(k.id) || String(p.body ?? "").includes(streichMarker(k.id)))) aus.uebersprungen.push({ id: k.id, grund: "Streich-PR schon offen" });
    else aus.neu.push(k);
  }
  return aus;
};

/**
 * Pur: die Nachweis-Zeilen der Streich-Commits. Ein Streich-PR ist kein Ticketlauf (kein Planer, keine Lens, keine Abnahme); die Widerspruchsfrist ersetzt den Review.
 * Beide Override-Zeilen tragen die Pflicht-Begründung (`#<nr> <warum>`), das Abnahme-Gate verlangt sonst eine Abnahme-Zeile und der PR bliebe dauerhaft rot.
 */
export const NACHWEIS_ZEILEN = [
  "SIH-Review-Override: #517 mechanische Streichung des Standard-Verfalls, die Widerspruchsfrist von 14 Tagen ersetzt den Lens-Review",
  "SIH-Abnahme-Override: #517 mechanische Streichung des Standard-Verfalls ohne Ticket und ohne Kriterien",
];

/** Pur: Audit-Kommentar nach dem Merge (AGENTS.md § Human-in-the-Loop-Checkpoints; ein Streich-PR trifft Wächter-Tests und Regeln, also Leitplanken). */
export const auditKommentar = (ziel) =>
  `🛡️ Leitplanken-Änderung selbst gemergt\n\n- **Was:** \`${ziel}\` gestrichen (Standard-Verfall, ADR 0027 Fortschreibung factory#517).\n- **Warum:** kein Fang im Fenster von ${VERFALL_TAGE} Tagen, Widerspruchsfrist von ${FRIST_TAGE} Tagen ohne Widerspruch, Required Checks grün.\n- **Reverten:** Revert dieses PRs.`;

/** Pur: Titel, Commit-Nachricht und Body des Streich-PRs (Fangquote, Fenster, Rohwerte, Widerspruch, Umkehr). */
export const streichText = (k, { fenster, heute, plan }) => {
  const frist = plusTage(heute, FRIST_TAGE);
  const was = plan.aktion === "loeschen" ? `Datei \`${plan.pfad}\` löschen` : `${plan.zeilen.length} Zeile(n) in \`${plan.pfad}\` entfernen`;
  const body = [
    streichMarker(k.id),
    `Regel-Verfall (factory#610, Standard-Verfall nach ADR 0027 Fortschreibung factory#517): \`${k.ziel}\` ist seit ${k.ablauf} fällig und hat im Fenster keinen Fang.`,
    "",
    `- **Fangquote:** ${k.faenge} Fänge in ${k.laeufe} Läufen (Fenster ${fenster.von} bis ${fenster.bis}, ${VERFALL_TAGE} Tage)`,
    `- **Rohwerte:** id \`${k.id}\`, ziel \`${k.ziel}\`, ablauf ${k.ablauf}, laeufe ${k.laeufe}, faenge ${k.faenge}`,
    `- **Änderung (mechanisch):** ${was}; Registerzeile \`${k.id}\` bekommt \`gestrichen: ${heute}\``,
    `- **Widerspruchsfrist:** bis ${frist} (${FRIST_TAGE} Tage ab Anlage). Widerspruch: Label \`${WIDERSPRUCH_LABEL}\` oder ein Kommentar einer vertrauten Person; dann mergt \`--faellige-mergen\` nie.`,
    "- **Umkehr:** Revert dieses PRs. Auf einem Streich-PR nicht kommentieren, außer um zu widersprechen: jeder Kommentar einer vertrauten Person (auch des eigenen Kontos) zählt als Widerspruch.",
    "- **Hinweis:** Verweise anderer Dateien auf das Gestrichene (Anker, `durch`) macht das Gate rot; dann ist der PR zu schließen oder die Verweise sind im PR nachzuziehen.",
  ].join("\n");
  return { titel: `Regel-Verfall: ${k.ziel} streichen`, nachweis: NACHWEIS_ZEILEN, commit: `Regel-Verfall: ${k.ziel} streichen (${k.id})`, body };
};

/** Pur: Widerspruch = Label `status:widerspruch` oder ein nicht leerer Beitrag (Kommentar, Review) einer vertrauten Person (`teile`: `{ vertraut, text }` je Beitrag, ohne den PR-Body). */
export const hatWiderspruch = (labels, teile) =>
  labels.includes(WIDERSPRUCH_LABEL) || teile.some((t) => t.vertraut === true && String(t.text ?? "").trim() !== "");

/** Pur: alle Required Checks grün (`gh pr checks --required --json name,bucket`); leere oder fehlende Liste ist nie grün (fail-closed). */
export const checksGruen = (checks) => Array.isArray(checks) && checks.length > 0 && checks.every((c) => c?.bucket === "pass" || c?.bucket === "skipping");

/** Pur: Frist abgelaufen? `angelegt` ISO-Zeitpunkt, `jetzt` Date. */
export const fristAbgelaufen = (angelegt, jetzt) => {
  const t = Date.parse(angelegt);
  return Number.isFinite(t) && t + FRIST_TAGE * 86_400_000 <= jetzt.getTime();
};

/** Pur: Merge-Entscheidung `{ merge, grund }`; alle drei Bedingungen (Frist, kein Widerspruch, Required Checks grün) müssen gelten, Widerspruch zuerst. */
export const mergeEntscheidung = ({ labels, teile, checks, angelegt, jetzt }) => {
  if (hatWiderspruch(labels, teile)) return { merge: false, grund: "Widerspruch" };
  if (!fristAbgelaufen(angelegt, jetzt)) return { merge: false, grund: `Frist (${FRIST_TAGE} Tage) läuft noch` };
  if (!checksGruen(checks)) return { merge: false, grund: "Required Checks nicht grün" };
  return { merge: true, grund: "Frist abgelaufen, kein Widerspruch, Checks grün" };
};

/** Pur: Markdown-Bericht zu `kandidaten()`; Zahlen je Zeile, „nicht messbar“ getrennt. */
export const renderKandidaten = (e) => {
  const z = [`# Regel-Verfall: Kandidaten`, "", `Stand: ${e.heute}, Fenster ${e.fenster.von} bis ${e.fenster.bis} (${VERFALL_TAGE} Tage)`, ""];
  z.push(`## Kandidaten (fällig, kein Fang im Fenster): ${e.kandidaten.length}`);
  z.push(...e.kandidaten.map((k) => `- ${k.id} (${k.ziel}): ${k.faenge} Fänge in ${k.laeufe} Läufen, abgelaufen seit ${k.ablauf}`));
  z.push("", `## Mit Fang (kein Kandidat): ${e.mitFang.length}`);
  z.push(...e.mitFang.map((k) => `- ${k.id} (${k.ziel}): ${k.faenge} Fänge in ${k.laeufe} Läufen`));
  z.push("", `## Nicht messbar (Lücke, nie Kandidat): ${e.nichtMessbar.length}`);
  z.push(...e.nichtMessbar.map((k) => `- ${k.id} (${k.ziel}): ${k.grund}`));
  z.push("", `## Sicherheits-Ausnahme (nie Kandidat): ${e.ausgenommen.length}`);
  z.push(...e.ausgenommen.map((k) => `- ${k.id} (${k.ziel})`));
  z.push("", `Noch nicht fällig: ${e.nichtFaellig}`);
  return z.join("\n");
};
