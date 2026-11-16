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
  { ziel: "AGENTS.md#kein-secret-key-im-agentenlauf", grund: "Klasse Sicherheit (Secret-Key)" },
  { ziel: "AGENTS.md#human-in-the-loop-checkpoints--die-entscheidung-gaten-nicht-den-ganzen-lauf", grund: "Klasse Irreversibles, Außenwirkung und Datenverlust (Löschen)" },
  { ziel: "test/harness/settings-permissions.test.ts", grund: "Klasse deny-/ask-Listen" },
  { ziel: "test/harness/berechtigungen-kern.test.ts", grund: "Klasse deny-/ask-Listen" },
];

const pfadVon = (ziel) => String(ziel).split("#")[0];

/** Pur: ist das Ziel einer Verfall-Zeile durch die Sicherheits-Ausnahmeliste vom Verfall ausgenommen? */
export const istSicherheitsAusnahme = (ziel, ausnahmen = SICHERHEITS_AUSNAHMEN) =>
  ausnahmen.some((a) => (a.ziel.includes("#") ? a.ziel === ziel : a.ziel === pfadVon(ziel)));

/** Pur: GitHub-Anker einer Überschrift oder des Titels einer fett markierten Regel (klein, ohne Satzzeichen, Leerraum zu Bindestrich). */
export const ankerVon = (text) =>
  String(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

/** Pur: Titel jeder fett markierten Regel (Listenpunkt `- **Titel** …`, auch eingerückt) in `AGENTS.md`, ohne Schlusszeichen `:` und `.`. */
export const fettRegeln = (agentsText) =>
  [...String(agentsText).matchAll(/^\s*- \*\*(.+?)\*\*/gm)].map((m) => {
    const titel = m[1].trim().replace(/[:.]+$/, "");
    return { titel, anker: ankerVon(titel) };
  });

/** Pur: alle Anker einer Markdown-Datei (Überschriften) und, bei `AGENTS.md`, der fett markierten Regeln. */
export const ankerAus = (text, mitFettRegeln = false) => {
  const anker = new Set();
  let imCode = false;
  for (const zeile of String(text).split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(zeile)) imCode = !imCode;
    const m = !imCode && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(zeile);
    if (m) anker.add(ankerVon(m[1]));
  }
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
  const fenster = { von: plusTage(heute, -VERFALL_TAGE), bis: heute };
  const punkte = exporte.flatMap((e) => e.punkte);
  const aus = { heute, fenster, kandidaten: [], nichtMessbar: [], ausgenommen: [], nichtFaellig: 0, mitFang: [] };
  for (const z of zeilen.filter((x) => x?.art === "verfall")) {
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
