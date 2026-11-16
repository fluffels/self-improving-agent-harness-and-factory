// Kein Shebang: Lib (pure Logik), der Einstieg ist scripts/token-analyse-ausloesen.mjs.
/**
 * Auslöser der Token-Analyse (factory#578, Teil 8/9 von factory#518): reine Logik für Erkennung, Dedupe und Monatstakt.
 * FABRIK-EIGEN: nicht im Besitz-Manifest, nie an Bezieher verteilt. Der Notfall-Eintrag `token-analyse` in `NOTFAELLE` (board-lib.mjs) trägt
 * denselben Marker; `test/harness/token-analyse-notfall.test.ts` bindet beide aneinander.
 */

/** Titelmarker des Analyse-Tickets (Kopf-Item, Art `token-analyse`). */
export const MARKER = "💸 Token-Analyse";
/** Body-Marker (eigene Zeile): kennzeichnet ein Analyse-Ticket, dessen Titel den Marker nicht trägt. */
export const BODY_MARKER = "<!-- token-analyse -->";
/** Die Anlässe der Auslösung (`--anlass`). */
export const ANLAESSE = ["monatlich", "manuell", "kosten"];

/** Der Marker im Body, über den `wiedervorlage.mjs` ein Ticket zu einem Eintrag wiederfindet (gleiche Form, ein Test hält sie fest; ein Skript importiert nie ein Einstiegsskript). */
export const markerFuer = (id) => `<!-- wiedervorlage:${id} -->`;

/** True für ein echtes Kalenderdatum `JJJJ-MM-TT`. Pur. */
export function istDatum(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const TAKT_ID = /^token-analyse-(\d{4})-(\d{2})$/;
const TAKT_ART = "analyse-takt";

/** Pur: ist das Issue ein Analyse-Ticket? Titel enthält den Marker, oder der Body trägt den Body-Marker als eigene Zeile (Fließtext und Backticks zählen nicht). */
export function istAnalyseTicket({ title, body } = {}) {
  return String(title ?? "").includes(MARKER) || /^<!-- token-analyse -->\s*$/m.test(String(body ?? ""));
}

/** Pur: der anstehende Monatseintrag (frühester `token-analyse-<JJJJ-MM>` mit `art: analyse-takt`) oder null. */
export function anstehenderTakt(eintraege) {
  const liste = (eintraege ?? []).filter((e) => TAKT_ID.test(String(e?.id ?? "")) && e.art === TAKT_ART);
  liste.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return liste[0] ?? null;
}

/** Pur: der Monatseintrag zu einem Fälligkeitstag `JJJJ-MM-TT` (id `token-analyse-<JJJJ-MM>`); die Datei `.github/wiedervorlagen.json` trägt genau diese Form. */
export function taktEintrag(faellig) {
  return {
    id: `token-analyse-${faellig.slice(0, 7)}`,
    art: TAKT_ART,
    faellig,
    titel: `${MARKER} monatlich (factory#518)`,
    text: "Analyse per Skill `token-analyse` durchführen (Vorgabe: `.agents/skills/token-analyse/SKILL.md`). Vorher `node scripts/token-analyse-ausloesen.mjs --anlass monatlich` (dedupliziert gegen ein schon offenes Analyse-Ticket), am Schluss des Skills `node scripts/token-analyse-ausloesen.mjs --fortschreiben`: das löscht diesen Eintrag und schreibt den nächsten (Lauf plus ein Monat).",
  };
}

/** Pur: `heute` plus ein Monat als `JJJJ-MM-TT`; der Tag wird auf das Monatsende gekürzt (31.01. wird 28./29.02.). */
export function plusEinMonat(heute) {
  const [j, m, t] = heute.split("-").map(Number);
  const jahr = m === 12 ? j + 1 : j;
  const monat = m === 12 ? 1 : m + 1;
  const ende = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return `${jahr}-${String(monat).padStart(2, "0")}-${String(Math.min(t, ende)).padStart(2, "0")}`;
}

/** Pur: die Liste ohne alle Monatseinträge, dazu der nächste (Lauf plus ein Monat). Andere Einträge (auch `token-analyse-budget-576`) bleiben unberührt. */
export function fortschreiben(eintraege, heute) {
  const rest = (eintraege ?? []).filter((e) => !(TAKT_ID.test(String(e?.id ?? "")) && e.art === TAKT_ART));
  return [...rest, taktEintrag(plusEinMonat(heute))];
}

/** Pur: der Kommentartext einer Auslösung. */
const kommentarText = (anlass, heute, grund, weitere) =>
  `Auslösung der Token-Analyse am ${heute} (Anlass: ${anlass})${grund ? `: ${grund}` : ""}. Es ist schon ein Analyse-Ticket offen, darum entsteht kein zweites.${weitere.length > 0 ? ` Weitere offene Analyse-Tickets: ${weitere.map((n) => `#${n}`).join(", ")}.` : ""}`;

/**
 * Pur: die Aktion einer Auslösung. `offene` = offene Issues `{ number, title, body }`.
 * - ein Analyse-Ticket offen (bei mehreren das älteste): `{ art: "kommentieren", nummer, titelNeu, kommentar }`; `titelNeu` setzt den Marker vor den Titel, wenn er fehlt, sonst null.
 * - sonst `{ art: "anlegen", titel, body, hinweis? }`; der Body trägt Body-Marker und (mit Monatseintrag) den Wiedervorlage-Marker, ohne Eintrag steht ein `hinweis`.
 * Ein unbekannter Anlass wirft.
 */
export function planeAusloesung({ offene, anlass, heute, eintraege, grund }) {
  if (!ANLAESSE.includes(anlass)) throw new Error(`unbekannter Anlass „${anlass}“ (erlaubt: ${ANLAESSE.join(", ")})`);
  const treffer = (offene ?? []).filter(istAnalyseTicket).sort((a, b) => a.number - b.number);
  if (treffer.length > 0) {
    const [erstes, ...rest] = treffer;
    const titel = String(erstes.title ?? "");
    return {
      art: "kommentieren",
      nummer: erstes.number,
      titelNeu: titel.includes(MARKER) ? null : `${MARKER}: ${titel}`,
      kommentar: kommentarText(anlass, heute, grund, rest.map((t) => t.number)),
    };
  }
  const takt = anstehenderTakt(eintraege);
  const zeilen = [BODY_MARKER];
  if (takt) zeilen.push(markerFuer(takt.id));
  zeilen.push(
    "",
    `Token-Analyse ausgelöst am ${heute} (Anlass: ${anlass})${grund ? `: ${grund}` : ""}.`,
    "",
    "Ablauf: Skill `token-analyse` (`.agents/skills/token-analyse/SKILL.md`), am Schluss `node scripts/token-analyse-ausloesen.mjs --fortschreiben`, dann dieses Ticket schließen.",
  );
  return {
    art: "anlegen",
    titel: `${MARKER} ${heute} (Anlass: ${anlass})`,
    body: zeilen.join("\n"),
    ...(takt ? {} : { hinweis: "kein Monatseintrag `token-analyse-<JJJJ-MM>` in .github/wiedervorlagen.json: der Takt ist nicht gesetzt (`--fortschreiben` legt ihn an)" }),
  };
}
